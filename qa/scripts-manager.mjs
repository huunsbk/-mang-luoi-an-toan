// QA: trang Quản lý kịch bản — gom lô, dùng chung WAV, cắt lại từ WAV gốc, nghe duyệt, lưu, dừng khi 429.
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
let mode429 = false;
page.on('pageerror', e => errors.push(String(e)));
page.on('dialog', d => d.accept());
await context.route('**/*', async route => {
  const req = route.request(), url = req.url();
  if (url.includes('@supabase/supabase-js')) return route.fulfill({ contentType: 'application/javascript', body: fakeSupabase });
  if (url.includes('/qa-media/')) return route.fulfill({ contentType: 'audio/wav', body: speechLikeWav('x') });
  if (url.endsWith('/api/marble-tts') && req.method() === 'GET') return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ configured: true, voiceVersion: '0123456789abcdef', voiceType: 'default' }) });
  if (url.endsWith('/api/marble-tts') && req.method() === 'POST') {
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

const num = async id => Number(await page.textContent('#' + id));
const quota = () => page.evaluate(() => { const d = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()); return Number(localStorage.getItem('motionclass:classroom20:requests:' + d)) || 0; });
async function approveAndSave(expected) {
  await page.waitForFunction(n => document.querySelectorAll('#reviewList .review').length === n, expected, { timeout: 20000 });
  await page.evaluate(() => document.querySelectorAll('#reviewList audio').forEach(a => a.dispatchEvent(new Event('ended'))));
  await page.click('#approveListened');
  await page.click('#saveApproved');
  await page.waitForFunction(() => /Đã lưu \d+ WAV câu dẫn/.test(document.getElementById('genStatus').textContent), null, { timeout: 20000 });
}

// 1) Kịch bản mẫu đầu tiên: số đoạn và số lượt dự kiến.
await page.selectOption('#templatePick', 'am-ap'); await page.click('#newFromTemplate');
await page.waitForSelector('#editor:not([hidden])');
const need1 = await num('qNeeded'), calls1 = await num('qCalls');
assert(need1 === 43 && calls1 >= 2 && calls1 <= 4, `Kế hoạch kịch bản 1 bất thường: ${need1} đoạn / ${calls1} lượt`);
const segText = await page.textContent('#qSegments');

// 2) Tạo giọng: đúng số lượt, đủ đoạn để nghe duyệt, bộ đếm tăng đúng.
await page.fill('#studioPin', 'ma-giao-vien-dung-12');
await page.click('#genStart');
await page.waitForFunction(() => /✅ Đã tạo/.test(document.getElementById('genStatus').textContent), null, { timeout: 30000 });
assert(batchPosts.length === calls1, `Đã gọi ${batchPosts.length} lượt, kế hoạch ${calls1}`);
assert(await quota() === calls1, 'Bộ đếm lượt/ngày không khớp');
const needsReview = await page.evaluate(() => [...document.querySelectorAll('#reviewList .review .tiny')].filter(n => n.textContent.startsWith('⚠')).length);
await approveAndSave(need1);
assert(await num('qNeeded') === 0, 'Sau khi lưu vẫn còn đoạn thiếu');
const lib1 = await page.evaluate(() => (window.__fakeDB().tables.teacher_phrase_audio || []).length);
assert(lib1 === need1, 'Kho WAV không đủ: ' + lib1);

// 3) Kịch bản thứ hai dùng chung đoạn đã có (bộ “Câu hỏi số …”), chỉ tạo phần mới.
await page.selectOption('#templatePick', 'duong-dua'); await page.click('#newFromTemplate');
await page.waitForFunction(() => document.querySelectorAll('#genScripts input:checked').length === 2);
const need2 = await num('qNeeded'), calls2 = await num('qCalls'), reuse2 = await page.textContent('#qReuse');
assert(need2 > 0 && need2 <= 39 - 20, `Kịch bản 2 không dùng chung đoạn số: còn ${need2} đoạn`);

// 4) Tạo kịch bản 2, rồi tải lại trang trước khi lưu → cắt lại từ WAV gốc, KHÔNG tốn thêm lượt Google.
const before = batchPosts.length;
await page.click('#genStart');
await page.waitForFunction(() => /✅ Đã tạo/.test(document.getElementById('genStatus').textContent), null, { timeout: 30000 });
assert(batchPosts.length - before === calls2, 'Số lượt kịch bản 2 không khớp kế hoạch');
await page.reload(); await page.waitForSelector('#appPanel:not([hidden])');
await page.evaluate(() => { const box = document.getElementById('genScripts'); });
await page.fill('#studioPin', 'ma-giao-vien-dung-12');
const before2 = batchPosts.length;
// Chọn lại 2 kịch bản để tạo (sau tải lại trang chỉ chọn mặc định 1 kịch bản đang bật).
await page.evaluate(() => document.querySelectorAll('#genScripts input').forEach(cb => { if (!cb.checked) { cb.checked = true; cb.dispatchEvent(new Event('change')); } }));
assert(await num('qNeeded') === need2, 'Kế hoạch sau tải lại không khớp');
await page.click('#genStart');
await page.waitForFunction(() => /lấy lại từ WAV gốc/.test(document.getElementById('genStatus').textContent), null, { timeout: 30000 });
assert(batchPosts.length === before2, 'Cắt lại từ WAV gốc nhưng vẫn gọi Google');
await approveAndSave(need2);
assert(await num('qNeeded') === 0, 'Kịch bản 2 vẫn thiếu đoạn');

// 5) Google trả 429 → dừng ngay, không gửi tiếp.
await page.selectOption('#templatePick', 'phieu-luu'); await page.click('#newFromTemplate');
await page.waitForFunction(() => Number(document.getElementById('qNeeded').textContent) > 0);
const calls3 = await num('qCalls'); mode429 = true; const before3 = batchPosts.length;
await page.click('#genStart');
await page.waitForFunction(() => /429/.test(document.getElementById('genStatus').textContent), null, { timeout: 20000 });
assert(batchPosts.length - before3 === 1, `Gặp 429 nhưng vẫn gửi ${batchPosts.length - before3} yêu cầu (kế hoạch ${calls3})`);
mode429 = false;

// 6) Hết hạn mức trên trình duyệt → nút tạo bị khóa.
await page.evaluate(() => { const d = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()); localStorage.setItem('motionclass:classroom20:requests:' + d, '10'); });
await page.fill('#limitSegments', '19'); await page.dispatchEvent('#limitSegments', 'change');
assert(await page.isDisabled('#genStart'), 'Đã hết 10 lượt nhưng nút tạo vẫn bật');

// 7) Kiểm tra mẫu: {tên} bắt buộc ở câu gọi; lưu chỉnh sửa.
await page.fill('#slot-call', 'Mời bạn trả lời');
await page.click('#saveScript');
assert((await page.textContent('#editorStatus')).includes('{tên}'), 'Không chặn câu gọi thiếu {tên}');

assert(errors.length === 0, 'Lỗi trang: ' + errors.join(' | '));
console.log('SCRIPTS_MANAGER_OK', JSON.stringify({ script1: { phrases: need1, calls: calls1, avg: segText, cutWarnings: needsReview }, script2: { newPhrases: need2, calls: calls2, reuse: reuse2 }, totalGoogleCalls: batchPosts.length }));
await browser.close();
