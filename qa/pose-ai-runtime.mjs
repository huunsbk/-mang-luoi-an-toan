import { chromium, webkit } from 'playwright';

const target = process.env.POSE_AI_QA_URL || 'https://giaovien-psi.vercel.app/pose-quiz/';
const moduleUrl = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.21/vision_bundle.mjs';
const wasmUrl = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.21/wasm';
const modelUrl = 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task';

async function run(name, browserType) {
  const browser = await browserType.launch({ headless: true });
  try {
    const page = await browser.newPage();
    const pageErrors = [];
    const failed = [];
    page.on('pageerror', e => pageErrors.push(String(e)));
    page.on('requestfailed', r => failed.push(`${r.method()} ${r.url()} :: ${r.failure()?.errorText || 'failed'}`));

    const response = await page.goto(target, { waitUntil: 'domcontentloaded', timeout: 60000 });
    if (!response || response.status() !== 200) {
      throw new Error(`${name}: Pose Quiz HTTP ${response?.status()}`);
    }

    const source = await (await page.request.get(target, { timeout: 60000 })).text();
    if (!source.includes("new Function('url', 'return import(url)')")) {
      throw new Error(`${name}: production/preview HTML does not contain native browser import escape`);
    }
    if (source.includes('const imported = await import(source.module)')) {
      throw new Error(`${name}: Babel-transformable dynamic import is still present`);
    }

    const smoke = await page.evaluate(async ({ moduleUrl, wasmUrl, modelUrl }) => {
      const nativeImport = new Function('url', 'return import(url)');
      const imported = await nativeImport(moduleUrl);
      const api = imported?.default && imported.default.FilesetResolver ? imported.default : imported;
      if (!api?.FilesetResolver || !api?.PoseLandmarker) {
        throw new Error('Missing FilesetResolver/PoseLandmarker exports');
      }

      const vision = await api.FilesetResolver.forVisionTasks(wasmUrl);
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
      return { ok, poseCount: result?.landmarks?.length ?? -1 };
    }, { moduleUrl, wasmUrl, modelUrl });

    console.log(name, 'MEDIAPIPE_SMOKE', JSON.stringify(smoke));
    console.log(name, 'PAGE_ERRORS', JSON.stringify(pageErrors));
    console.log(name, 'REQUEST_FAILED_COUNT', failed.length);

    if (!smoke.ok) throw new Error(`${name}: MediaPipe inference result is invalid`);
  } finally {
    await browser.close();
  }
}

await run('Chromium', chromium);
await run('WebKit', webkit);
console.log('POSE_AI_BROWSER_RUNTIME_OK');
