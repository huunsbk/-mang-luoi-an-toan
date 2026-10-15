import { chromium, webkit } from 'playwright';

const target = process.env.POSE_AI_QA_URL || 'https://giaovien-psi.vercel.app/pose-quiz/';
const skipTarget = process.env.POSE_AI_SKIP_TARGET === '1';
const moduleUrl = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.21/vision_bundle.mjs';
const wasmUrl = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.21/wasm';
const modelUrl = 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task';

async function run(name, browserType, { fullInference = true, cameraSmoke = false } = {}) {
  const launchOptions = { headless: true };
  if (cameraSmoke) {
    launchOptions.args = [
      '--use-fake-device-for-media-stream',
      '--use-fake-ui-for-media-stream'
    ];
  }
  const browser = await browserType.launch(launchOptions);
  try {
    const page = await browser.newPage();
    const pageErrors = [];
    const failed = [];
    page.on('pageerror', e => pageErrors.push(String(e)));
    page.on('requestfailed', r => failed.push(`${r.method()} ${r.url()} :: ${r.failure()?.errorText || 'failed'}`));

    if (!skipTarget) {
      const response = await page.goto(target, { waitUntil: 'domcontentloaded', timeout: 60000 });
      if (!response || response.status() !== 200) {
        throw new Error(`${name}: Pose Quiz HTTP ${response?.status()}`);
      }

      const source = await (await page.request.get(target, { timeout: 60000 })).text();
      if (!source.includes("new Function('url', 'return import(url)')")) {
        throw new Error(`${name}: production HTML does not contain native browser import escape`);
      }
      if (source.includes('const imported = await import(source.module)')) {
        throw new Error(`${name}: Babel-transformable dynamic import is still present`);
      }
    } else {
      await page.setContent('<!doctype html><meta charset="utf-8"><title>Pose AI runtime smoke</title><canvas id="root"></canvas>');
    }

    if (cameraSmoke) {
      const cameraResult = await page.evaluate(async () => {
        if (typeof Camera !== 'function') {
          throw new Error('MediaPipe Camera utility is not available');
        }
        const video = document.createElement('video');
        video.playsInline = true;
        video.muted = true;
        video.style.position = 'fixed';
        video.style.left = '-9999px';
        document.body.appendChild(video);

        let frames = 0;
        const camera = new Camera(video, {
          onFrame: async () => { frames += 1; },
          width: 640,
          height: 480
        });

        try {
          await camera.start();
          await new Promise(resolve => setTimeout(resolve, 1200));
          const stream = video.srcObject;
          const tracks = stream?.getVideoTracks?.() || [];
          const live = tracks.some(track => track.readyState === 'live');
          return {
            ok: live && frames > 0,
            live,
            frames,
            readyState: video.readyState,
            videoWidth: video.videoWidth,
            videoHeight: video.videoHeight
          };
        } finally {
          try { camera.stop(); } catch (_) {}
          try { video.srcObject?.getTracks?.().forEach(track => track.stop()); } catch (_) {}
          video.remove();
        }
      });

      console.log(name, 'CAMERA_SMOKE', JSON.stringify(cameraResult));
      if (!cameraResult.ok) {
        throw new Error(`${name}: MediaPipe Camera did not produce a live video stream/frame`);
      }
    }

    const smoke = await page.evaluate(async ({ moduleUrl, wasmUrl, modelUrl, fullInference }) => {
      const nativeImport = new Function('url', 'return import(url)');
      const imported = await nativeImport(moduleUrl);
      const api = imported?.default && imported.default.FilesetResolver ? imported.default : imported;
      if (!api?.FilesetResolver || !api?.PoseLandmarker) {
        throw new Error('Missing FilesetResolver/PoseLandmarker exports');
      }

      const vision = await api.FilesetResolver.forVisionTasks(wasmUrl);
      if (!fullInference) {
        return { ok: true, stage: 'module+wasm', poseCount: null };
      }

      const landmarker = await api.PoseLandmarker.createFromOptions(vision, {
        baseOptions: { modelAssetPath: modelUrl, delegate: 'CPU' },
        runningMode: 'VIDEO',
        numPoses: 5,
        minPoseDetectionConfidence: 0.45,
        minPosePresenceConfidence: 0.45,
        minTrackingConfidence: 0.5,
        outputSegmentationMasks: false
      });

      const canvas = document.createElement('canvas');
      canvas.width = 96;
      canvas.height = 96;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#111827';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      const result = landmarker.detectForVideo(canvas, 1);
      const ok = Array.isArray(result?.landmarks);
      landmarker.close();
      return { ok, stage: 'full-inference', poseCount: result?.landmarks?.length ?? -1 };
    }, { moduleUrl, wasmUrl, modelUrl, fullInference });

    console.log(name, 'MEDIAPIPE_SMOKE', JSON.stringify(smoke));
    console.log(name, 'PAGE_ERRORS', JSON.stringify(pageErrors));
    console.log(name, 'REQUEST_FAILED_COUNT', failed.length);

    if (!smoke.ok) throw new Error(`${name}: MediaPipe inference result is invalid`);
  } finally {
    await browser.close();
  }
}

await run('Chromium', chromium, { fullInference: true, cameraSmoke: !skipTarget });
// Headless WebKit on GitHub runners has no usable WebGL context for MediaPipe inference.
// Validate native ESM import + WASM there; the existing iPhone QA validates the actual UI.
await run('WebKit', webkit, { fullInference: false });
console.log('POSE_AI_BROWSER_RUNTIME_OK');
