// QA: trang Kịch bản lời dẫn — chỉ soạn nội dung (giọng quản lý ở trang Giọng đọc), không gọi Google, báo lỗi rõ khi thiếu bảng.
//   python3 qa/serve_portal.py 4174 &  node qa/scripts-manager.mjs
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const BASE = process.env.MARBLE_QA_BASE || 'http://127.0.0.1:4174';
const here = dirname(fileURLToPath(import.meta.url));
const fakeSupabase = readFileSync(join(here, 'fake-supabase.js'), 'utf8');
const assert = (c, m) => { if (!c) throw new Error(m); };

// WAV giả lập "giọng Google": mỗi đoạn là một chuỗi âm có độ dài theo số ký tự, cách nhau bởi khoảng lặng.
function speechLikeWav(text) {
  const rate = 24000, parts = text.split('\n\n\n\n'), chunks = [];
  const silence = n => new Float32Array(Math.round(rate * n));
  chunks.push(silence(0.25));
  parts.forEach((p, i) => {
    const sec = Math.max(0.55, [...p].length * 0.068), n = Math.round(rate * sec), tone = new Float32Array(n);
    for (let k = 0; k < n; k++) tone[k] = 0.35 * Math.sin(2 * Math.PI * (180 + 40 * (i % 5)) * k / rate) * (0.6 + 0.4 * Math.sin(k / 900));
    chunks.push(tone, silence(i === parts.length - 1 ? 0.3 : 0.62));
  });
  const total = chunks.reduce((a, c) => a + c.length, 0), b = Buffer.alloc(44 + total * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + total * 2, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(rate, 24); b.writeUInt32LE(rate * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(total * 2, 40);
  let o = 44; for (const c of chunks) for (const v of c) { b.writeInt16LE(Math.round(Math.max(-1, Math.min(1, v)) * 32767), o); o += 2; }
  return b;
}

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext();
const page = await context.newPage();
const errors = [], batchPosts = [];
let mode429 = false, googlePosts = 0;
page.on('pageerror', e => errors.push(String(e)));
page.on('dialog', d => d.accept());
await context.route('**/*', async route => {
  const req = route.request(), url = req.url();
  if (url.includes('@supabase/supabase-js')) return route.fulfill({ contentType: 'application/javascript', body: fakeSupabase });
  if (url.includes('/qa-media/')) return route.fulfill({ contentType: 'audio/wav', body: speechLikeWav('x') });
  if (url.endsWith('/api/marble-tts') && req.method() === 'GET') return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ configured: true, voiceVersion: '0123456789abcdef', voiceType: 'default' }) });
  if (url.endsWith('/api/marble-tts') && req.method() === 'POST') {
    googlePosts++;
    const body = JSON.parse(req.postData() || '{}');
    if (req.headers()['x-marble-teacher-code'] !== 'ma-giao-vien-dung-12') return route.fulfill({ status: 403, contentType: 'application/json', body: '{"error":"sai mã"}' });
    if (body.verifyOnly) return route.fulfill({ contentType: 'application/json', body: '{"ok":true,"verified":true}' });
    assert(body.batch === true && body.classroom20 === true && body.text.length <= 1800, 'Yêu cầu lô không hợp lệ: ' + JSON.stringify(body).slice(0, 200));
    batchPosts.push(body.text);
    if (mode429) return route.fulfill({ status: 429, contentType: 'application/json', body: '{"code":"RATE_LIMIT","error":"Gemini đang giới hạn lượt"}' });
    return route.fulfill({ contentType: 'audio/wav', body: speechLikeWav(body.text) });
  }
  if (url.startsWith(BASE)) return route.continue();
  return route.abort();
});
// Bỏ chờ giãn cách 22,5 giây trong QA (giữ logic, chỉ đặt mốc lần gọi trước về quá khứ).
await page.addInitScript(() => {
  const orig = Storage.prototype.getItem;
  Storage.prototype.getItem = function (k) { if (k === 'motionclass:classroom20:last-request') return '0'; return orig.call(this, k); };
});

const resp = await page.goto(BASE + '/scripts/');
assert(resp.status() === 200, '/scripts/ HTTP ' + resp.status());
for (const f of ['/scripts/script-store.js', '/scripts/script-manager.js']) {
  const r = await page.request.get(BASE + f);
  assert(r.status() === 200 && (r.headers()['content-type'] || '').includes('javascript'), f + ' không được máy chủ phục vụ');
}
const home = await (await page.request.get(BASE + '/')).text();
assert(home.includes('href="/scripts/"'), 'Trang cổng chưa có liên kết Kịch bản lời dẫn');

await page.fill('#loginEmail', 'giaovien@example.com'); await page.fill('#loginPass', 'x');
await page.click('#loginForm button[type=submit]');
await page.waitForSelector('#appPanel:not([hidden])');

// 0) Backend chưa có bảng (lỗi giáo viên gặp ngày 16/10): bấm "Tạo từ mẫu" PHẢI có phản hồi nhìn thấy.
await page.evaluate(() => localStorage.setItem('__fakeMissingTables', '1'));
await page.reload(); await page.waitForSelector('#appPanel:not([hidden])');
await page.waitForFunction(() => /chưa sẵn sàng/.test(document.getElementById('listStatus').textContent), null, { timeout: 8000 });
await page.click('#newFromTemplate');
await page.waitForFunction(() => /Chưa tạo được kịch bản/.test(document.getElementById('listStatus').textContent), null, { timeout: 8000 });
assert(await page.isVisible('#listStatus') && await page.isEnabled('#newFromTemplate'), 'Lỗi không hiển thị hoặc nút bị khóa vĩnh viễn');
const missingMsg = await page.textContent('#listStatus');
await page.evaluate(() => localStorage.removeItem('__fakeMissingTables'));
await page.reload(); await page.waitForSelector('#appPanel:not([hidden])');
await page.waitForFunction(() => /Chưa có kịch bản/.test(document.getElementById('listStatus').textContent), null, { timeout: 8000 });

// 1) Trang Kịch bản chỉ soạn nội dung: không còn khung tạo giọng Google; có liên kết sang trang Giọng đọc.
//    Thanh "có giọng" tính theo GIỌNG HỆ THỐNG (Microsoft) — seed sẵn WAV "Mời em" của edge:namminh-b1.
await page.evaluate(async () => {
  const db = JSON.parse(localStorage.getItem('__fakeSupabaseDB'));
  const S = window.TeacherScriptStore, owner = db.session.user.id;
  db.tables.teacher_phrase_audio = [{ id: crypto.randomUUID(), owner_id: owner, voice_id: 'edge:namminh-b1', text_hash: await S.hashText('Mời em'), phrase: 'Mời em', storage_path: owner + '/edge-namminh-b1/a.wav', size_bytes: 100 },
    { id: crypto.randomUUID(), owner_id: owner, voice_id: 'studio:0123456789abcdef', text_hash: await S.hashText('Câu hỏi số một.'), phrase: 'Câu hỏi số một.', storage_path: owner + '/studio/b.wav', size_bytes: 100 }];
  localStorage.setItem('__fakeSupabaseDB', JSON.stringify(db));
});
await page.reload(); await page.waitForSelector('#appPanel:not([hidden])');
await page.selectOption('#templatePick', 'am-ap'); await page.click('#newFromTemplate');
await page.waitForSelector('#editor:not([hidden])');
await page.waitForFunction(() => /✅ Đã tạo/.test(document.getElementById('listStatus').textContent));
assert(await page.isVisible('#slot-call') && (await page.inputValue('#scriptTitle')) === 'Ấm áp – nhẹ nhàng', 'Tạo xong nhưng không mở trình soạn kịch bản');
assert(await page.isHidden('#voicePanel') && await page.isHidden('#libraryPanel') && await page.isHidden('#reviewPanel'), 'Trang Kịch bản vẫn còn khung tạo giọng Google');
assert(await page.isVisible('#voiceHubLink') && (await page.getAttribute('#voiceHubLink a', 'href')) === '/unified-voice/', 'Thiếu liên kết sang trang Giọng đọc');
const cov = await page.textContent('#scriptList .script-item span');
assert(/^1\/\d+ đoạn có giọng$/.test(cov), 'Độ phủ phải tính theo giọng hệ thống Microsoft (chỉ “Mời em”), không tính WAV Google: ' + cov);

// 2) Kiểm tra mẫu: {tên} bắt buộc ở câu gọi; lưu chỉnh sửa hợp lệ.
await page.fill('#slot-call', 'Mời bạn trả lời');
await page.click('#saveScript');
assert((await page.textContent('#editorStatus')).includes('{tên}'), 'Không chặn câu gọi thiếu {tên}');
await page.fill('#slot-call', 'Mời em {tên} lên bảng. Câu hỏi số {số}.');
await page.click('#saveScript');
await page.waitForFunction(() => /Đã lưu/.test(document.getElementById('editorStatus').textContent), null, { timeout: 8000 });

assert(googlePosts === 0, 'Trang Kịch bản không được gọi Google: ' + googlePosts);
assert(errors.length === 0, 'Lỗi trang: ' + errors.join(' | '));
console.log('SCRIPTS_MANAGER_OK', JSON.stringify({ missingTableMessage: missingMsg.slice(0, 90), coverage: cov, googleCalls: googlePosts }));
await browser.close();
