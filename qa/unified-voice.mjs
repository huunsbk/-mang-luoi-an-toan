// QA: trang Giọng thống nhất — đếm phần thiếu, tạo giọng Microsoft THẬT qua /api/edge-tts, MP3→WAV, lưu 3 kho.
//   MARBLE_TTS_PIN=ma-giao-vien-dung-12 python3 qa/serve_portal.py 4175 &  node qa/unified-voice.mjs
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
const OWNER = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa', CLASS = 'cccccccc-1111-4111-8111-cccccccccccc';
const CLASS2 = 'cccccccc-2222-4222-8222-cccccccccccc';
const ST = ['5a5a5a5a-0001-4001-8001-000000000001', '5a5a5a5a-0002-4002-8002-000000000002', '5a5a5a5a-0003-4003-8003-000000000003', '5a5a5a5a-0004-4004-8004-000000000004'];
const Q1 = '11111111-aaaa-4aaa-8aaa-111111111111', Q2 = '22222222-aaaa-4aaa-8aaa-222222222222', QX = '33333333-aaaa-4aaa-8aaa-333333333333';
const spoken = (text, opts, correct) => {
  const p = v => /[.!?]$/.test(v) ? v : v + '.', k = ['A', 'B', 'C', 'D'], i = k.indexOf(correct);
  const w = { question: p(text), full: p(text) + ' ' + k.map((x, j) => 'Phương án ' + x + '. ' + p(opts[j])).join(' ') + ' Em hãy suy nghĩ và lựa chọn một đáp án.', answer: 'Đáp án đúng là phương án ' + correct + '. ' + p(opts[i]) };
  k.forEach((x, j) => { w['option_' + x.toLowerCase()] = 'Phương án ' + x + '. ' + p(opts[j]); });
  return w;
};
const BANK = [
  { id: Q1, owned: true, text: 'Bộ phận nào giúp em nhập chữ vào máy tính?', options: ['Màn hình', 'Bàn phím', 'Chuột', 'Loa'], correct: 'B' },
  { id: Q2, owned: true, text: 'Thiết bị nào phát ra âm thanh?', options: ['Loa', 'Chuột', 'Bàn phím', 'Màn hình'], correct: 'A' },
  { id: QX, owned: false, text: 'Câu của giáo viên khác?', options: ['A1', 'B1', 'C1', 'D1'], correct: 'C' }
].map(q => ({ ...q, spoken: spoken(q.text, q.options, q.correct) }));
const puts = [];

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext();
const page = await context.newPage();
const errors = [];
page.on('pageerror', e => errors.push(String(e)));
page.on('dialog', d => d.accept());
await context.route('**/*', async route => {
  const req = route.request(), url = req.url();
  if (url.includes('@supabase/supabase-js')) return route.fulfill({ contentType: 'application/javascript', body: fake });
  if (url.includes('/functions/v1/shared-question-api')) {
    const ct = req.headers()['content-type'] || '';
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 200, body: 'ok' });
    if (ct.includes('multipart/form-data')) {
      const raw = req.postDataBuffer(), boundary = ct.split('boundary=')[1];
      const fields = {}; let wavHead = '';
      for (const part of raw.toString('latin1').split('--' + boundary)) {
        const m = part.match(/name="([^"]+)"/); if (!m) continue;
        const body = part.split('\r\n\r\n').slice(1).join('\r\n\r\n').replace(/\r\n$/, '');
        if (m[1] === 'audio') wavHead = body.slice(0, 4) + body.slice(8, 12); else fields[m[1]] = Buffer.from(body, 'latin1').toString('utf8');
      }
      puts.push({ ...fields, wavHead });
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true }) });
    }
    const body = JSON.parse(req.postData() || '{}');
    if (body.action === 'bank.list') return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, items: BANK, nextOffset: null }) });
    if (body.action === 'audio.overview') {
      const items = [{ id: Q1, voiceId: 'edge:namminh-b1', part: 'full', current: true }, { id: Q1, voiceId: 'nghi:calmwoman3688', part: 'answer', current: true },
        ...puts.filter(p => body.ids.includes(p.id)).map(p => ({ id: p.id, voiceId: p.voice_id, part: p.part, current: true }))];
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, items }) });
    }
    return route.fulfill({ status: 400, contentType: 'application/json', body: '{"ok":false,"error":"không hỗ trợ"}' });
  }
  if (url.includes('/qa-media/')) return route.fulfill({ contentType: 'audio/wav', body: Buffer.from('RIFF\0\0\0\0WAVE') });
  if (url.startsWith(BASE)) return route.continue();
  return route.abort();
});

// Dữ liệu mẫu: 1 lớp, 3 học sinh (1 em đã có WAV giọng Google), 2 kịch bản (1 đang bật), 1 WAV câu dẫn edge sẵn có.
await page.goto(BASE + '/unified-voice/');
const seed = await page.evaluate(async ({ OWNER, CLASS, CLASS2, ST }) => {
  const S = window.TeacherScriptStore, CS = window.TeacherClassroomStore;
  const names = ['Nguyễn Văn An', 'Triệu Thị Thanh Mai', 'Lý A Dín'];
  const script = S.cleanScript(JSON.parse(JSON.stringify(S.TEMPLATES[0])));
  const off = S.cleanScript(JSON.parse(JSON.stringify(S.TEMPLATES[1])));
  const db = { tables: {
    teacher_classrooms: [{ id: CLASS, owner_id: OWNER, name: '5A', grade: '5', school_year: '2026–2027' }, { id: CLASS2, owner_id: OWNER, name: '5B', grade: '5', school_year: '2026–2027' }],
    teacher_classroom_students: [...names.map((n, i) => ({ id: ST[i], owner_id: OWNER, class_id: CLASS, full_name: n, student_code: '', avatar_index: i, orb_color: i, orb_style: 0, photo_path: null, sort_order: i, is_active: true })),
      { id: ST[3], owner_id: OWNER, class_id: CLASS2, full_name: 'Hoàng Minh Đức', student_code: '', avatar_index: 3, orb_color: 3, orb_style: 0, photo_path: null, sort_order: 0, is_active: true }],
    teacher_student_name_audio: [{ id: crypto.randomUUID(), owner_id: OWNER, class_id: CLASS, student_id: ST[0], voice_id: 'studio:ea9246ceeac13ba0', name_hash: await CS.studentNameHash(names[0]), storage_path: OWNER + '/x.wav', size_bytes: 100, updated_at: '' }],
    teacher_voice_scripts: [{ id: crypto.randomUUID(), owner_id: OWNER, title: script.title, theme: script.theme, slots: script.slots, is_active: true, sort_order: 0 },
      { id: crypto.randomUUID(), owner_id: OWNER, title: off.title, theme: off.theme, slots: off.slots, is_active: false, sort_order: 1 }],
    teacher_phrase_audio: [{ id: crypto.randomUUID(), owner_id: OWNER, voice_id: 'edge:namminh-b1', text_hash: await S.hashText('Mời em'), phrase: 'Mời em', storage_path: OWNER + '/edge-namminh-b1/a.wav', size_bytes: 100 }]
  }, files: {}, session: { access_token: 'fake', user: { id: OWNER, email: 'giaovien@example.com' } } };
  localStorage.setItem('__fakeSupabaseDB', JSON.stringify(db));
  // Kỳ vọng: MỌI kịch bản (cả kịch bản đang tắt) + kịch bản dựng sẵn, số đọc tới 20, không trùng.
  const all = new Set();
  for (const sc of [script, off, S.BUILTIN]) for (const p of S.scriptPhrases(sc, { maxNumber: 20, scoreNumbers: true })) all.add(p.text);
  return { phrases: all.size, sample: ['Câu hỏi số hai mươi.', 'không', 'mười chín', 'Ôi, tiếc quá!'].map(t => all.has(t)) };
}, { OWNER, CLASS, CLASS2, ST });
assert(seed.sample.every(Boolean), 'Danh sách câu dẫn thiếu số thứ tự/điểm cuối giờ/kịch bản đang tắt: ' + seed.sample);
await page.reload();
await page.waitForSelector('#appPanel:not([hidden])');
await page.waitForFunction(() => /Còn thiếu/.test(document.getElementById('status').textContent), null, { timeout: 15000 });
const cover = await page.evaluate(() => ({ n: cNames.textContent, p: cPhrases.textContent, q: cQuestions.textContent }));
assert(cover.n === '0/4', 'Đếm tên sai (WAV giọng Google không được tính): ' + cover.n);
assert(cover.p === '1/' + seed.phrases, 'Đếm câu dẫn sai (mọi kịch bản + mặc định, trừ “Mời em” đã có): ' + cover.p);
assert(cover.q === '1/14', 'Đếm câu hỏi sai (chỉ câu của mình, 7 phần, chỉ giọng edge): ' + cover.q);
const missing = 4 + (seed.phrases - 1) + 13;
assert((await page.textContent('#genStart')).includes(String(missing)), 'Nút tạo không ghi đúng số đoạn thiếu');

// Bắt buộc đồng ý gửi tên + kiểm tra mã giáo viên.
await page.fill('#pin', PIN); await page.click('#genStart');
assert(/đồng ý/.test(await page.textContent('#status')), 'Không chặn khi chưa đồng ý gửi tên');
await page.check('#consent'); await page.fill('#pin', 'sai-ma-giao-vien'); await page.click('#genStart');
await page.waitForFunction(() => /Mã giáo viên/.test(document.getElementById('status').textContent), null, { timeout: 15000 });

// Tạo thật bằng giọng Microsoft.
const t0 = Date.now();
await page.fill('#pin', PIN); await page.click('#genStart');
await page.waitForFunction(() => /Đã tạo \d+ đoạn/.test(document.getElementById('status').textContent), null, { timeout: 180000 });
const genSeconds = ((Date.now() - t0) / 1000).toFixed(1);
const review = await page.evaluate(async () => {
  const rows = [...document.querySelectorAll('#reviewList .item')];
  const tags = [...new Set(rows.map(r => r.querySelector('.tag').textContent))].sort();
  const checks = [];
  for (const r of rows.slice(0, 6)) {
    const buf = await (await fetch(r.querySelector('audio').src)).arrayBuffer(), b = new Uint8Array(buf);
    const head = String.fromCharCode(...b.slice(0, 4)) + String.fromCharCode(...b.slice(8, 12));
    const rate = new DataView(buf).getUint32(24, true), secs = (buf.byteLength - 44) / (rate * 2);
    checks.push({ head, rate, secs: +secs.toFixed(2), label: r.querySelector('span').textContent.slice(0, 40) });
  }
  return { count: rows.length, tags, checks, status: document.getElementById('status').textContent };
});
assert(review.count === missing, `Tạo ${review.count}/${missing} đoạn: ${review.status}`);
assert(review.checks.every(c => c.head === 'RIFFWAVE' && c.secs > 0.25 && c.secs < 30), 'WAV không hợp lệ: ' + JSON.stringify(review.checks));
for (const s of ['cheer', 'praise', 'congrats', 'soft', 'encourage', 'lively', 'neutral']) assert(review.tags.includes(s), 'Thiếu sắc thái ' + s + ': ' + review.tags);

// Lưu tất cả → kiểm tra 3 kho.
await page.click('#saveAll');
await page.waitForFunction(() => /✅ Đã lưu \d+ đoạn/.test(document.getElementById('status').textContent), null, { timeout: 60000 });
await page.waitForFunction(() => /Đã đủ giọng thống nhất/.test(document.getElementById('genStart').textContent), null, { timeout: 15000 });
const db = await page.evaluate(() => window.__fakeDB().tables);
const names = (db.teacher_student_name_audio || []).filter(r => r.voice_id === 'edge:namminh-b1');
const phrases = (db.teacher_phrase_audio || []).filter(r => r.voice_id === 'edge:namminh-b1');
assert(names.length === 4 && names.some(r => r.class_id === CLASS2), 'Chưa lưu đủ 4 WAV tên của cả 2 lớp: ' + names.length);
assert((db.teacher_student_name_audio || []).some(r => r.voice_id.startsWith('studio:')), 'Đã xóa nhầm WAV giọng Google cũ');
assert(phrases.length === seed.phrases, 'Chưa lưu đủ câu dẫn: ' + phrases.length);
assert(puts.length === 13 && puts.every(p => p.voice_id === 'edge:namminh-b1' && p.wavHead === 'RIFFWAVE'), 'Lưu câu hỏi sai: ' + JSON.stringify(puts.map(p => [p.part, p.voice_id, p.wavHead])));
for (const p of puts) { const q = BANK.find(b => b.id === p.id); assert(q.owned && p.expected_text_hash === sha(q.spoken[p.part]), 'Mã xác minh nội dung câu hỏi sai: ' + p.part); }
const after = await page.evaluate(() => ({ n: cNames.textContent, p: cPhrases.textContent, q: cQuestions.textContent }));
assert(after.n === '4/4' && after.q === '14/14' && after.p === seed.phrases + '/' + seed.phrases, 'Độ phủ sau khi lưu chưa đủ: ' + JSON.stringify(after));

assert(errors.length === 0, 'Lỗi trang: ' + errors.join(' | '));
console.log('UNIFIED_VOICE_OK', JSON.stringify({ before: cover, after, generated: review.count, seconds: genSeconds, sample: review.checks.slice(0, 3), tags: review.tags }));
await browser.close();
