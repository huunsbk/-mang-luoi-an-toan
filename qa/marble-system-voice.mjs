// QA: Đua bi tự dùng GIỌNG HỆ THỐNG (chọn ở trang Giọng đọc) — không còn ô chọn giọng.
//   python3 qa/serve_portal.py 4174 &  node qa/marble-system-voice.mjs
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const BASE = process.env.MARBLE_QA_BASE || 'http://127.0.0.1:4174';
const fake = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'fake-supabase.js'), 'utf8');
const assert = (c, m) => { if (!c) throw new Error(m); };
const OWNER = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa', MY = 'edge:hoaimy-v1';
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
const errors = [];
page.on('pageerror', e => errors.push(String(e)));
await page.route('**/*', route => {
  const req = route.request(), url = req.url();
  if (url.includes('@supabase/supabase-js')) return route.fulfill({ contentType: 'application/javascript', body: fake });
  if (url.includes('/functions/v1/shared-question-api')) {
    const body = JSON.parse(req.postData() || '{}');
    if (body.action === 'bank.list') return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, items: [], nextOffset: null, facets: { subjects: [], lessons: [] } }) });
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, items: [] }) });
  }
  if (url.startsWith(BASE)) return route.continue();
  return route.abort();
});

// Chưa đăng nhập → giọng thiết bị, có thông báo.
await page.goto(BASE + '/marble-race/');
await page.evaluate(() => localStorage.clear());
await page.reload();
await page.waitForFunction(() => window.MotionVoice && document.getElementById('raceSystemVoice'));
assert(await page.isHidden('#raceSavedVoice'), 'Ô chọn giọng phải được ẩn');

// Đăng nhập, giáo viên đã chọn HoaiMy vui tươi ở trang Giọng đọc → Đua bi tự dùng giọng đó.
await page.evaluate(({ OWNER, MY }) => {
  localStorage.setItem('__fakeSupabaseDB', JSON.stringify({ tables: { teacher_voice_settings: [{ owner_id: OWNER, voice_id: MY }] }, files: {}, session: { access_token: 'fake', user: { id: OWNER, email: 'giaovien@example.com' } } }));
}, { OWNER, MY });
await page.reload();
await page.waitForFunction(MY => document.getElementById('raceSavedVoice').value === MY, MY, { timeout: 15000 });
const label = await page.textContent('#raceSystemVoice');
assert(/HoaiMy/.test(label) && /vui tươi/.test(label), 'Không hiện giọng hệ thống: ' + label);
const hookVoice = await page.evaluate(() => window.MarbleQuizHooks.preferredVoice());
assert(hookVoice === MY, 'Kịch bản lời dẫn chưa dùng giọng hệ thống: ' + hookVoice);
assert(await page.getAttribute('#raceSystemVoice + .sub a', 'href') === '/unified-voice/', 'Thiếu liên kết sang trang Giọng đọc');
assert(errors.length === 0, 'Lỗi trang: ' + errors.join(' | '));
console.log('MARBLE_SYSTEM_VOICE_OK', JSON.stringify({ label: label.trim(), hookVoice }));
await browser.close();
