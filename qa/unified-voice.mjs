// QA: trang 🎙️ Giọng đọc — một nơi quản lý giọng cho tên, câu dẫn, câu hỏi (giọng Microsoft THẬT qua /api/edge-tts).
//   MARBLE_TTS_PIN=ma-giao-vien-dung-12 python3 qa/serve_portal.py 4175 &  node qa/unified-voice.mjs
// Kiểm: đếm trạng thái (có / thiếu / nội dung đã sửa), lọc + tìm, tạo tất cả phần thiếu (tự lưu), nghe,
// xóa từng đoạn, tạo lại với sắc thái khác, chọn nhiều để xóa, đổi người đọc (nghe thử + áp dụng), giữ nguyên WAV giọng cũ,
// chế độ nhúng theo một câu hỏi, máy chủ chặn mã giọng lạ.
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const BASE = process.env.UV_QA_BASE || 'http://127.0.0.1:4175';
const PIN = process.env.UV_QA_PIN || 'ma-giao-vien-dung-12';
const here = dirname(fileURLToPath(import.meta.url));
const fake = readFileSync(join(here, 'fake-supabase.js'), 'utf8');
const assert = (c, m) => { if (!c) throw new Error(m); };
const sha = t => createHash('sha256').update(t, 'utf8').digest('hex');
const OWNER = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa', C5A = 'cccccccc-1111-4111-8111-cccccccccccc', C5B = 'cccccccc-2222-4222-8222-cccccccccccc';
const ST = ['5a5a5a5a-0001-4001-8001-000000000001', '5a5a5a5a-0002-4002-8002-000000000002', '5a5a5a5a-0003-4003-8003-000000000003', '5a5a5a5a-0004-4004-8004-000000000004'];
const Q1 = '11111111-aaaa-4aaa-8aaa-111111111111', Q2 = '22222222-aaaa-4aaa-8aaa-222222222222', QX = '33333333-aaaa-4aaa-8aaa-333333333333';
const B1 = 'edge:namminh-b1', MY = 'edge:hoaimy-v1';
const spoken = (text, opts, correct) => {
  const p = v => /[.!?]$/.test(v) ? v : v + '.', k = ['A', 'B', 'C', 'D'], i = k.indexOf(correct);
  const w = { question: p(text), full: p(text) + ' ' + k.map((x, j) => 'Phương án ' + x + '. ' + p(opts[j])).join(' ') + ' Em hãy suy nghĩ và lựa chọn một đáp án.', answer: 'Đáp án đúng là phương án ' + correct + '. ' + p(opts[i]) };
  k.forEach((x, j) => { w['option_' + x.toLowerCase()] = 'Phương án ' + x + '. ' + p(opts[j]); });
  return w;
};
const BANK = [
  { id: Q1, owned: true, subject: 'Tin học', lesson: 'Bài 1', text: 'Bộ phận nào giúp em nhập chữ vào máy tính?', options: ['Màn hình', 'Bàn phím', 'Chuột', 'Loa'], correct: 'B' },
  { id: Q2, owned: true, subject: 'Tin học', lesson: 'Bài 2', text: 'Thiết bị nào phát ra âm thanh?', options: ['Loa', 'Chuột', 'Bàn phím', 'Màn hình'], correct: 'A' },
  { id: QX, owned: false, subject: 'Tin học', lesson: 'Bài 1', text: 'Câu của giáo viên khác?', options: ['A1', 'B1', 'C1', 'D1'], correct: 'C' }
].map(q => ({ ...q, spoken: spoken(q.text, q.options, q.correct) }));
// Q2 có giải thích (giáo viên điền) → thêm phần đọc 'explain'.
BANK[1].spoken.explain = 'Loa là thiết bị phát ra âm thanh.';
// Kho WAV câu hỏi giả lập: Q1 có "full" (giọng hệ thống, đúng nội dung), "answer" (giọng hệ thống nhưng nội dung đã sửa), NGHI cũ.
const qaudio = [{ id: Q1, voiceId: B1, part: 'full', current: true }, { id: Q1, voiceId: B1, part: 'answer', current: false }, { id: Q1, voiceId: 'nghi:calmwoman3688', part: 'answer', current: true }];
const puts = [], deletes = [];
const tinyWav = (() => { const n = 400, b = Buffer.alloc(44 + n * 2); b.write('RIFF', 0); b.writeUInt32LE(36 + n * 2, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(8000, 24); b.writeUInt32LE(16000, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(n * 2, 40); return b; })();

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext();
const page = await context.newPage();
const errors = [], ttsBodies = [];
page.on('pageerror', e => errors.push(String(e)));
page.on('dialog', d => d.accept());
page.on('request', r => { if (r.url().endsWith('/api/edge-tts') && r.method() === 'POST') ttsBodies.push(JSON.parse(r.postData() || '{}')); });
await context.route('**/*', async route => {
  const req = route.request(), url = req.url();
  if (url.includes('@supabase/supabase-js')) return route.fulfill({ contentType: 'application/javascript', body: fake });
  if (url.includes('/qa-media/')) return route.fulfill({ contentType: 'audio/wav', body: tinyWav });
  if (url.includes('/functions/v1/shared-question-api')) {
    const ct = req.headers()['content-type'] || '';
    if (ct.includes('multipart/form-data')) {
      const raw = req.postDataBuffer(), boundary = ct.split('boundary=')[1], f = {}; let wavHead = '';
      for (const part of raw.toString('latin1').split('--' + boundary)) {
        const m = part.match(/name="([^"]+)"/); if (!m) continue;
        const body = part.split('\r\n\r\n').slice(1).join('\r\n\r\n').replace(/\r\n$/, '');
        if (m[1] === 'audio') wavHead = body.slice(0, 4) + body.slice(8, 12); else f[m[1]] = Buffer.from(body, 'latin1').toString('utf8');
      }
      puts.push({ ...f, wavHead });
      const i = qaudio.findIndex(a => a.id === f.id && a.voiceId === f.voice_id && a.part === f.part); if (i >= 0) qaudio.splice(i, 1);
      qaudio.push({ id: f.id, voiceId: f.voice_id, part: f.part, current: true });
      return route.fulfill({ contentType: 'application/json', body: '{"ok":true}' });
    }
    const body = JSON.parse(req.postData() || '{}');
    const json = o => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, ...o }) });
    if (body.action === 'bank.list') return json({ items: BANK, nextOffset: null });
    if (body.action === 'audio.overview') return json({ items: qaudio.filter(a => body.ids.includes(a.id)) });
    if (body.action === 'audio.list') return json({ items: qaudio.filter(a => body.ids.includes(a.id) && a.voiceId === body.voice_id).map(a => ({ ...a, url: location0 + '/qa-media/q/' + a.id + '-' + a.part + '.wav' })) });
    if (body.action === 'audio.delete') { deletes.push(body); const i = qaudio.findIndex(a => a.id === body.id && a.voiceId === body.voice_id && a.part === body.part); if (i >= 0) qaudio.splice(i, 1); return json({ deleted: i >= 0 }); }
    return route.fulfill({ status: 400, contentType: 'application/json', body: '{"ok":false,"error":"không hỗ trợ"}' });
  }
  if (url.startsWith(BASE)) return route.continue();
  return route.abort();
});
const location0 = BASE;

// Dữ liệu mẫu: 2 lớp; 5A: An (WAV hệ thống nhưng TÊN ĐÃ SỬA), Mai (chỉ có WAV Google cũ), Dín (chưa có); 5B: Đức.
await page.goto(BASE + '/unified-voice/');
const seed = await page.evaluate(async ({ OWNER, C5A, C5B, ST, B1 }) => {
  const S = window.TeacherScriptStore;
  const stu = (id, cls, n, i) => ({ id, owner_id: OWNER, class_id: cls, full_name: n, student_code: '', avatar_index: i, orb_color: i, orb_style: 0, photo_path: null, sort_order: i, is_active: true });
  const script = S.cleanScript(JSON.parse(JSON.stringify(S.TEMPLATES[1])));
  const off = S.cleanScript(JSON.parse(JSON.stringify(S.TEMPLATES[2])));
  const db = { tables: {
    teacher_classrooms: [{ id: C5A, owner_id: OWNER, name: '5A', grade: '5', school_year: '2026–2027' }, { id: C5B, owner_id: OWNER, name: '5B', grade: '5', school_year: '2026–2027' }],
    teacher_classroom_students: [stu(ST[0], C5A, 'Nguyễn Văn An', 0), stu(ST[1], C5A, 'Triệu Thị Thanh Mai', 1), stu(ST[2], C5A, 'Lý A Dín', 2), stu(ST[3], C5B, 'Hoàng Minh Đức', 0)],
    teacher_student_name_audio: [
      { id: crypto.randomUUID(), owner_id: OWNER, class_id: C5A, student_id: ST[0], voice_id: B1, name_hash: 'f'.repeat(64), storage_path: OWNER + '/a.wav', size_bytes: 100, updated_at: '' },
      { id: crypto.randomUUID(), owner_id: OWNER, class_id: C5A, student_id: ST[1], voice_id: 'studio:ea9246ceeac13ba0', name_hash: 'e'.repeat(64), storage_path: OWNER + '/b.wav', size_bytes: 100, updated_at: '' }],
    teacher_voice_scripts: [{ id: crypto.randomUUID(), owner_id: OWNER, title: script.title, theme: script.theme, slots: script.slots, is_active: true, sort_order: 0 },
      { id: crypto.randomUUID(), owner_id: OWNER, title: off.title, theme: off.theme, slots: off.slots, is_active: false, sort_order: 1 }],
    teacher_phrase_audio: [{ id: crypto.randomUUID(), owner_id: OWNER, voice_id: B1, text_hash: await S.hashText('Mời em'), phrase: 'Mời em', storage_path: OWNER + '/edge-namminh-b1/m.wav', size_bytes: 100 }],
    teacher_voice_settings: []
  }, files: {}, session: { access_token: 'fake', user: { id: OWNER, email: 'giaovien@example.com' } } };
  localStorage.setItem('__fakeSupabaseDB', JSON.stringify(db));
  const all = new Set();
  for (const sc of [script, off, S.BUILTIN]) for (const p of S.scriptPhrases(sc, { maxNumber: 20, scoreNumbers: true })) all.add(p.text);
  return { phrases: all.size };
}, { OWNER, C5A, C5B, ST, B1 });
await page.reload();
await page.waitForFunction(() => window.__unifiedVoiceTest?.state().loaded, null, { timeout: 20000 });
const st = () => page.evaluate(() => window.__unifiedVoiceTest.state());
const db = () => page.evaluate(() => JSON.parse(localStorage.getItem('__fakeSupabaseDB')).tables);
let s0 = await st();

// 1) Trạng thái từng loại đoạn.
assert(s0.voice === B1 && (await page.textContent('#voiceNow')).includes('trẻ, tự tin'), 'Giọng hệ thống mặc định sai: ' + s0.voice);
assert(JSON.stringify(s0.counts.name) === JSON.stringify({ total: 4, ok: 0, missing: 3, stale: 1 }), 'Đếm tên sai: ' + JSON.stringify(s0.counts.name));
assert(JSON.stringify(s0.counts.question) === JSON.stringify({ total: 15, ok: 1, missing: 13, stale: 1 }), 'Đếm câu hỏi sai (chỉ câu của mình, 7 phần + giải thích): ' + JSON.stringify(s0.counts.question));
assert(s0.counts.phrase.total === seed.phrases && s0.counts.phrase.ok === 1, 'Đếm câu dẫn sai (mọi kịch bản + mặc định): ' + JSON.stringify(s0.counts.phrase) + ' / ' + seed.phrases);
assert(s0.old['studio:ea9246ceeac13ba0']?.name === 1 && s0.old['nghi:calmwoman3688']?.question === 1, 'Không liệt kê giọng cũ đang được giữ: ' + JSON.stringify(s0.old));
assert(await page.isVisible('#oldPanel'), 'Không hiện mục giọng cũ');
const stale = await page.textContent('.item .chip.stale');
assert(/Nội dung đã sửa/.test(stale), 'Tên đã sửa không được đánh dấu ↻');

// 2) Lọc + tìm trên thẻ Câu dẫn.
await page.click('.tab[data-tab="phrase"]');
const groups = await page.$$eval('#groupFilter option', o => o.map(x => x.textContent));
assert(groups.includes('Số thứ tự câu hỏi') && groups.includes('Số điểm cuối giờ') && groups.includes('Khi trả lời đúng'), 'Thiếu nhóm câu dẫn: ' + groups);
await page.fill('#search', 'tay đua');
const found = await page.$$eval('#list .item .text b', b => b.map(x => x.textContent));
assert(found.length > 0 && found.every(t => /tay đua/i.test(t)), 'Tìm kiếm câu dẫn sai: ' + found.slice(0, 5));
await page.fill('#search', '');

// 3) Chưa nhập mã → báo rõ, không gửi gì.
await page.click('#genMissing');
assert(/mã giáo viên/i.test(await page.textContent('#status')), 'Không nhắc nhập mã giáo viên');
await page.fill('#pin', PIN); await page.click('#genMissing');
assert(/đồng ý/.test(await page.textContent('#status')), 'Không chặn khi chưa đồng ý gửi tên');
assert(ttsBodies.length === 0, 'Đã gửi Microsoft khi chưa đủ điều kiện');

// 4) Tạo tất cả phần thiếu (Microsoft thật) → tự lưu vào 3 kho.
await page.check('#consent'); await page.check('#rememberPin');
const t0 = Date.now(); await page.click('#genMissing');
await page.waitForFunction(() => /Đã tạo và lưu \d+ đoạn/.test(document.getElementById('status').textContent), null, { timeout: 300000 });
const genSeconds = ((Date.now() - t0) / 1000).toFixed(1);
let s1 = await st();
assert(['name', 'phrase', 'question'].every(k => s1.counts[k].ok === s1.counts[k].total), 'Chưa đủ giọng sau khi tạo: ' + JSON.stringify(s1.counts) + ' · ' + await page.textContent('#status'));
let t = await db();
assert(t.teacher_student_name_audio.filter(r => r.voice_id === B1).length === 4, 'Chưa lưu đủ 4 WAV tên');
assert(t.teacher_student_name_audio.some(r => r.voice_id.startsWith('studio:')), 'Đã xóa nhầm WAV giọng Google cũ');
assert(t.teacher_phrase_audio.filter(r => r.voice_id === B1).length === seed.phrases, 'Chưa lưu đủ câu dẫn');
assert(puts.length === 14 && puts.some(p => p.part === 'explain' && p.id === Q2) && puts.every(p => p.voice_id === B1 && p.wavHead === 'RIFFWAVE'), 'Lưu câu hỏi sai: ' + puts.length);
for (const p of puts) { const q = BANK.find(b => b.id === p.id); assert(q.owned && p.expected_text_hash === sha(q.spoken[p.part]), 'Mã xác minh nội dung câu hỏi sai'); }
assert(ttsBodies.filter(b => b.items).every(b => b.voiceId === B1 && b.items.length <= 8), 'Yêu cầu tạo giọng sai mã giọng hoặc quá 8 đoạn/lần');
const styles = new Set(ttsBodies.flatMap(b => (b.items || []).map(i => i.style)));
for (const x of ['cheer', 'praise', 'soft', 'encourage', 'lively', 'neutral']) assert(styles.has(x), 'Thiếu sắc thái ' + x);
assert(await page.evaluate(() => sessionStorage.getItem('motionclass:uv-pin')) === PIN, 'Chưa nhớ mã khi đã tích ô nhớ');

// 5) Nghe một đoạn.
await page.click('.tab[data-tab="name"]');
await page.click('#list .item >> nth=0 >> button[title="Nghe"]');
await page.waitForFunction(() => document.querySelector('audio') === null, null, { timeout: 2000 }).catch(() => {});

// 6) Không ưng: xóa giọng một tên → thành ⛔; WAV Google cũ vẫn giữ.
const firstName = await page.textContent('#list .item >> nth=0 >> .text b');
await page.click('#list .item >> nth=0 >> button.del');
await page.waitForFunction(() => /Đã xóa giọng của 1 đoạn/.test(document.getElementById('status').textContent));
s1 = await st(); t = await db();
assert(s1.counts.name.missing === 1 && t.teacher_student_name_audio.filter(r => r.voice_id === B1).length === 3, 'Xóa một tên sai');
assert(t.teacher_student_name_audio.some(r => r.voice_id.startsWith('studio:')), 'Xóa nhầm giọng cũ');
// …rồi tạo lại với sắc thái khác.
await page.selectOption('#styleOverride', 'cheer');
const before = ttsBodies.length;
await page.click('#list .item >> nth=0 >> button.regen');
await page.waitForFunction(() => /Đã tạo và lưu 1 đoạn/.test(document.getElementById('status').textContent), null, { timeout: 60000 });
const regenBody = ttsBodies.slice(before).find(b => b.items);
assert(regenBody.items.length === 1 && regenBody.items[0].style === 'cheer' && regenBody.items[0].text === firstName, 'Tạo lại không dùng sắc thái đã chọn: ' + JSON.stringify(regenBody));
assert((await st()).counts.name.ok === 4, 'Tạo lại xong vẫn thiếu');
await page.selectOption('#styleOverride', '');

// 7) Chọn nhiều (Bài 2) → xóa giọng hàng loạt, chỉ đúng giọng hệ thống.
await page.click('.tab[data-tab="question"]');
await page.selectOption('#groupFilter', 'Tin học · Bài 2');
await page.check('#checkAll');
assert((await page.textContent('#selCount')).startsWith('8 '), 'Chọn tất cả đang hiện sai: ' + await page.textContent('#selCount'));
await page.click('#bulkDelete');
await page.waitForFunction(() => /Đã xóa giọng của 8 đoạn/.test(document.getElementById('status').textContent));
assert(deletes.length === 8 && deletes.every(d => d.id === Q2 && d.voice_id === B1), 'Xóa hàng loạt sai: ' + JSON.stringify(deletes.slice(0, 2)));
assert((await st()).counts.question.missing === 8, 'Sau khi xóa phải còn 8 phần thiếu');

// 8) Đổi người đọc: nghe thử (không lưu) rồi áp dụng cho toàn hệ thống.
await page.selectOption('#profilePick', MY);
const savedBefore = (await db()).teacher_phrase_audio.length;
await page.click('#profilePreview');
await page.waitForFunction(() => /Đang phát giọng|nghe thử/.test(document.getElementById('voiceStatus').textContent), null, { timeout: 60000 });
assert(ttsBodies.at(-1).voiceId === MY && (await db()).teacher_phrase_audio.length === savedBefore, 'Nghe thử phải dùng giọng đang chọn và không lưu gì');
await page.click('#profileApply');
await page.waitForFunction(() => window.__unifiedVoiceTest.state().voice === 'edge:hoaimy-v1' && window.__unifiedVoiceTest.state().loaded, null, { timeout: 20000 });
await page.waitForFunction(() => /Đã đổi giọng hệ thống/.test(document.getElementById('voiceStatus').textContent), null, { timeout: 20000 });
const s2 = await st(); t = await db();
assert(t.teacher_voice_settings[0]?.voice_id === MY, 'Chưa lưu giọng hệ thống: ' + JSON.stringify(t.teacher_voice_settings));
assert(s2.counts.name.ok === 0 && s2.counts.name.missing === 4 && s2.old[B1]?.name === 4, 'Đổi giọng: phải tính lại thiếu và giữ giọng cũ: ' + JSON.stringify(s2));
assert((await page.textContent('#voiceNow')).includes('HoaiMy'), 'Không hiện tên người đọc mới');
// Tạo tên bằng giọng mới.
await page.click('.tab[data-tab="name"]');
await page.check('#checkAll'); await page.click('#bulkRegen');
await page.waitForFunction(() => /Đã tạo và lưu 4 đoạn/.test(document.getElementById('status').textContent), null, { timeout: 60000 });
t = await db();
assert(t.teacher_student_name_audio.filter(r => r.voice_id === MY).length === 4 && t.teacher_student_name_audio.filter(r => r.voice_id === B1).length === 4, 'Giọng mới phải lưu riêng, giữ nguyên giọng cũ');
assert(ttsBodies.at(-1).voiceId === MY, 'Tạo bằng giọng mới nhưng gửi sai mã giọng');

// 9) Chế độ nhúng cho MỘT câu hỏi (nút 🎙 Giọng ở Ngân hàng câu hỏi).
const emb = await context.newPage();
emb.on('pageerror', e => errors.push('embed: ' + e));
await emb.goto(BASE + '/unified-voice/?embed=1&scope=question:' + Q1);
await emb.waitForFunction(() => window.__unifiedVoiceTest?.state().loaded, null, { timeout: 20000 });
await emb.waitForFunction(() => !window.__unifiedVoiceTest.state().running, null, { timeout: 120000 });
const embInfo = await emb.evaluate(() => ({ header: getComputedStyle(document.querySelector('header')).display, tab: window.__unifiedVoiceTest.state().tab, keys: [...document.querySelectorAll('#list .item')].map(n => n.dataset.key) }));
assert(embInfo.header === 'none' && embInfo.tab === 'question' && embInfo.keys.length === 7 && embInfo.keys.every(k => k.includes(Q1)), 'Nhúng theo câu hỏi sai: ' + JSON.stringify(embInfo));
await emb.close();

// 10) Máy chủ: chặn mã giọng lạ và mã giáo viên sai.
const bad = await page.request.post(BASE + '/api/edge-tts', { headers: { 'Content-Type': 'application/json', 'X-Marble-Teacher-Code': PIN, Origin: BASE }, data: { voiceId: 'edge:khong-co', items: [{ text: 'Xin chào', style: 'neutral' }] } });
assert(bad.status() === 422, 'Máy chủ phải chặn mã giọng lạ: ' + bad.status());
const wrong = await page.request.post(BASE + '/api/edge-tts', { headers: { 'Content-Type': 'application/json', 'X-Marble-Teacher-Code': 'sai-ma', Origin: BASE }, data: { voiceId: MY, verifyOnly: true } });
assert(wrong.status() === 403, 'Máy chủ phải chặn mã giáo viên sai');
const info = await (await page.request.get(BASE + '/api/edge-tts')).json();
assert(info.profiles?.length === 5 && info.profiles.some(p => p.id === B1) && info.profiles.some(p => p.reader === 'HoaiMy'), 'Danh sách hồ sơ giọng sai');

assert(errors.length === 0, 'Lỗi trang: ' + errors.join(' | '));
console.log('VOICE_HUB_OK', JSON.stringify({ before: s0.counts, generatedSeconds: genSeconds, ttsRequests: ttsBodies.length, deletes: deletes.length, newVoice: MY, embedRows: embInfo.keys.length }));
await browser.close();
