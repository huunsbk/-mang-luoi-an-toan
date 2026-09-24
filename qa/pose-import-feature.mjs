import { chromium, webkit, devices } from 'playwright';

const APP_URL = 'http://127.0.0.1:4173/pose-quiz/';
const authKey = 'sb-exfnarddchxzfewlztwb-auth-token';
const session = {
  access_token: 'qa-access-token',
  token_type: 'bearer',
  expires_in: 3600,
  expires_at: Math.floor(Date.now()/1000) + 3600,
  refresh_token: 'qa-refresh-token',
  user: {
    id: '00000000-0000-0000-0000-000000000999',
    aud: 'authenticated',
    role: 'authenticated',
    email: 'qa@example.com',
    email_confirmed_at: new Date().toISOString(),
    app_metadata: { provider: 'email', providers: ['email'] },
    user_metadata: {},
    created_at: new Date().toISOString()
  }
};

async function assertNoHorizontalOverflow(page, label) {
  const metrics = await page.evaluate(() => ({
    innerWidth: window.innerWidth,
    docWidth: document.documentElement.scrollWidth,
    bodyWidth: document.body.scrollWidth
  }));
  if (metrics.docWidth > metrics.innerWidth + 3 || metrics.bodyWidth > metrics.innerWidth + 3) {
    throw new Error(label + ' horizontal overflow: ' + JSON.stringify(metrics));
  }
}

async function assertInsideViewport(page, selector, label) {
  const box = await page.locator(selector).first().boundingBox();
  if (!box) throw new Error(label + ' is not visible');
  const viewport = page.viewportSize();
  if (!viewport) return;
  if (box.x < -2 || box.x + box.width > viewport.width + 2) {
    throw new Error(label + ' is clipped horizontally: ' + JSON.stringify({box, viewport}));
  }
}

function importQuestion(text, correctIndex = 1) {
  const poses = ['RAISE_LEFT','RAISE_RIGHT','BOTH_UP','CROSS_ARMS'];
  return {
    id: crypto.randomUUID(),
    text,
    image: null,
    audio: { data: null, name: '' },
    answers: ['A','B','C','D'].map((letter, idx) => ({
      text: letter + ' - đáp án',
      pose: poses[idx],
      isCorrect: idx === correctIndex,
      image: null
    }))
  };
}

async function run(browserType, name, contextOptions = {}) {
  const browser = await browserType.launch({ headless: true });
  const context = await browser.newContext(contextOptions);
  const page = await context.newPage();
  const errors = [];
  const failed = [];
  page.on('pageerror', e => errors.push(String(e)));
  page.on('requestfailed', r => {
    if (!/googleapis\.com\/css|fonts\.gstatic\.com/.test(r.url())) {
      failed.push(r.url() + ' :: ' + (r.failure()?.errorText || 'failed'));
    }
  });
  page.on('dialog', d => d.accept());

  await page.addInitScript(({ key, value }) => {
    localStorage.setItem(key, value);
  }, { key: authKey, value: JSON.stringify(session) });

  await page.route('https://exfnarddchxzfewlztwb.supabase.co/functions/v1/pose-quiz-api**', async route => {
    const url = new URL(route.request().url());
    const action = url.searchParams.get('action') || '';
    let data = { ok: true };
    if (action === 'bootstrap') data = { ok: true, version: 'qa' };
    else if (action === 'groups.list') data = { ok: true, groups: [] };
    else if (action === 'questions.import.preview') {
      const questions = [importQuestion('Câu nhập nhanh số 1', 1), importQuestion('Câu nhập nhanh số 2', 0)];
      data = {
        ok: true,
        source: route.request().headers()['content-type']?.includes('multipart/form-data') ? 'excel' : 'paste',
        total: 2,
        valid_count: 2,
        invalid_count: 0,
        errors: [],
        mapping_errors: [],
        pose_mapping: {A:'RAISE_LEFT',B:'RAISE_RIGHT',C:'BOTH_UP',D:'CROSS_ARMS'},
        items: questions.map((question, idx) => ({ row: idx + 1, valid: true, errors: [], question }))
      };
    } else if (action === 'media.upload') {
      const ct = route.request().headers()['content-type'] || '';
      data = {
        ok: true,
        asset: {
          storage: 'pose-quiz-media',
          path: ct.includes('audio') ? 'qa/audio.wav' : 'qa/background.png',
          name: 'qa-media',
          mime: ct.includes('audio') ? 'audio/wav' : 'image/png',
          size: 64,
          url: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9WlZkAAAAASUVORK5CYII='
        }
      };
    } else if (action === 'game.start') {
      data = { ok: true, game_token: 'qa-game-token', index: 0, score: 0, total: 2 };
    } else if (action === 'game.check') {
      data = { ok: true, correct: true, feedback: 'correct', score: 1, total: 2, finished: false, next_index: 1, game_token: 'qa-next-token' };
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(data) });
  });

  await page.goto(APP_URL, { waitUntil: 'networkidle', timeout: 60000 });
  await page.getByRole('button', { name: /Soạn bài/i }).click();
  await page.getByText('THIẾT LẬP BÀI DẠY V9.9 CLOUD').waitFor();
  await assertNoHorizontalOverflow(page, name + ' editor');
  await assertInsideViewport(page, 'button:has-text("Nhập nhanh")', name + ' import button');

  await page.getByRole('button', { name: /Nhập nhanh/i }).click();
  await page.getByText('NHẬP NHANH CÂU HỎI', { exact: false }).waitFor();
  await assertNoHorizontalOverflow(page, name + ' import modal');
  await page.screenshot({ path: 'qa-pose-import-modal-' + name + '.png', fullPage: true });

  const pasted = [
    'Câu 1. Thiết bị nào dùng để nhập văn bản?',
    'A. Chuột',
    'B. Bàn phím',
    'C. Loa',
    'D. Máy in',
    'Đáp án: B'
  ].join('\n');
  await page.locator('textarea[placeholder*="Câu 1"]').fill(pasted);
  await page.getByRole('button', { name: /PHÂN TÍCH NỘI DUNG DÁN/i }).click();
  await page.getByText('2 câu', { exact: true }).waitFor();
  await page.getByText('Câu nhập nhanh số 1').waitFor();
  await page.getByRole('button', { name: /Thay toàn bộ câu/i }).click();
  await page.getByRole('button', { name: /NHẬP 2 CÂU HỢP LỆ/i }).click();
  await page.getByText('CÂU HỎI 2', { exact: true }).waitFor();

  await page.getByRole('button', { name: /Nhập nhanh/i }).click();
  const excelInput = page.locator('input[type="file"][accept*=".xlsx"]').first();
  await excelInput.setInputFiles({
    name: 'questions.xlsx',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer: Buffer.from('mock-xlsx')
  });
  await page.getByText('2 câu', { exact: true }).waitFor();
  await page.getByRole('button', { name: '✕' }).click();

  const themeSection = page.locator('section').filter({ hasText: 'Nền bài dạy' });
  await themeSection.locator('input[type="file"]').setInputFiles({
    name: 'background.png',
    mimeType: 'image/png',
    buffer: Buffer.from([137,80,78,71,13,10,26,10])
  });
  await themeSection.getByText('XEM TRƯỚC NỀN').waitFor();
  await themeSection.locator('input[type="range"]').fill('55');

  const audioSection = page.locator('section').filter({ hasText: 'Âm thanh toàn bài' });
  const audioInputs = audioSection.locator('input[type="file"]');
  await audioInputs.nth(1).setInputFiles({
    name: 'correct.wav',
    mimeType: 'audio/wav',
    buffer: Buffer.from('RIFFmockWAVE')
  });
  await audioSection.getByText('correct.wav').waitFor();
  await audioSection.locator('input[type="range"]').nth(1).fill('75');

  await page.getByRole('button', { name: /^Xong$/i }).click();
  await page.getByRole('button', { name: /^Bắt đầu$/i }).click();
  await page.getByText('CÂU 1', { exact: true }).waitFor({ timeout: 30000 });
  await assertNoHorizontalOverflow(page, name + ' game');
  await assertInsideViewport(page, '.pose-game-check', name + ' check button');
  await assertInsideViewport(page, '.pose-game-content', name + ' question panel');
  await assertInsideViewport(page, '.pose-camera-panel', name + ' camera panel');

  await page.screenshot({ path: 'qa-pose-import-' + name + '.png', fullPage: true });

  if (errors.length) throw new Error(name + ' page errors: ' + errors.join(' | '));
  const criticalFailed = failed.filter(u => !/mediapipe|camera|google/.test(u));
  if (criticalFailed.length) throw new Error(name + ' request failures: ' + criticalFailed.join(' | '));

  console.log('POSE_IMPORT_UI_' + name.toUpperCase() + '_OK');
  await browser.close();
}

await run(chromium, 'chromium');
await run(webkit, 'webkit', { ...devices['iPhone 13'], locale: 'vi-VN' });
