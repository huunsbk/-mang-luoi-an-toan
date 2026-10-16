// QA: nút "🎙️ Tạo giọng ngay" ở Lớp học và Ngân hàng câu hỏi — mở cửa sổ nhúng, đã nhớ mã + đồng ý + tự lưu
// → tự tạo giọng Microsoft THẬT cho đúng phần còn thiếu rồi lưu; đóng cửa sổ thì nút báo đủ.
//   MARBLE_TTS_PIN=ma-giao-vien-dung-12 python3 qa/serve_portal.py 4175 &  node qa/unified-voice-launcher.mjs
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const BASE = process.env.UV_QA_BASE || 'http://127.0.0.1:4175';
const PIN = process.env.UV_QA_PIN || 'ma-giao-vien-dung-12';
const here = dirname(fileURLToPath(import.meta.url));
const fake = readFileSync(join(here, 'fake-supabase.js'), 'utf8');
const assert = (c, m) => { if (!c) throw new Error(m); };
const OWNER = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
const C5A = 'cccccccc-1111-4111-8111-cccccccccccc', C5B = 'cccccccc-2222-4222-8222-cccccccccccc';
const ST = ['5a5a5a5a-0001-4001-8001-000000000001', '5a5a5a5a-0002-4002-8002-000000000002', '5a5a5a5a-0003-4003-8003-000000000003', '5a5a5a5a-0004-4004-8004-000000000004'];
const Q1 = '11111111-aaaa-4aaa-8aaa-111111111111', Q2 = '22222222-aaaa-4aaa-8aaa-222222222222';
const spoken = (text, opts, correct) => {
  const p = v => /[.!?]$/.test(v) ? v : v + '.', k = ['A', 'B', 'C', 'D'], i = k.indexOf(correct);
  const w = { question: p(text), full: p(text) + ' ' + k.map((x, j) => 'Phương án ' + x + '. ' + p(opts[j])).join(' '), answer: 'Đáp án đúng là phương án ' + correct + '. ' + p(opts[i]) };
  k.forEach((x, j) => { w['option_' + x.toLowerCase()] = 'Phương án ' + x + '. ' + p(opts[j]); });
  return w;
};
const BANK = [
  { id: Q1, owned: true, text: 'Bộ phận nào giúp em nhập chữ vào máy tính?', options: ['Màn hình', 'Bàn phím', 'Chuột', 'Loa'], correct: 'B', subject: 'Tin học', lesson: 'Bài 1', grade: 'Lớp 3', visibility: 'private' },
  { id: Q2, owned: true, text: 'Thiết bị nào phát ra âm thanh?', options: ['Loa', 'Chuột', 'Bàn phím', 'Màn hình'], correct: 'A', subject: 'Tin học', lesson: 'Bài 1', grade: 'Lớp 3', visibility: 'private' }
].map(q => ({ ...q, spoken: spoken(q.text, q.options, q.correct) }));
const puts = [];

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext();
const page = await context.newPage();
const errors = [], apiActions = new Set();
page.on('pageerror', e => errors.push(String(e)));
page.on('dialog', d => d.accept());
await context.route('**/*', async route => {
  const req = route.request(), url = req.url();
  if (url.includes('@supabase/supabase-js')) return route.fulfill({ contentType: 'application/javascript', body: fake });
  if (url.includes('/functions/v1/shared-question-api')) {
    const ct = req.headers()['content-type'] || '';
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 200, body: 'ok' });
    if (ct.includes('multipart/form-data')) {
      const raw = req.postDataBuffer(), boundary = ct.split('boundary=')[1], fields = {};
      for (const part of raw.toString('latin1').split('--' + boundary)) {
        const m = part.match(/name="([^"]+)"/); if (!m || m[1] === 'audio') continue;
        fields[m[1]] = Buffer.from(part.split('\r\n\r\n').slice(1).join('\r\n\r\n').replace(/\r\n$/, ''), 'latin1').toString('utf8');
      }
      puts.push(fields);
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true }) });
    }
    const body = JSON.parse(req.postData() || '{}'); apiActions.add(body.action);
    if (body.action === 'bank.list') return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, items: BANK, nextOffset: null, facets: { subjects: ['Tin học'] } }) });
    if (body.action === 'audio.overview') {
      const items = [{ id: Q1, voiceId: 'edge:namminh-b1', part: 'full', current: true }, { id: Q2, voiceId: 'nghi:calmwoman3688', part: 'answer', current: true },
        ...puts.filter(p => body.ids.includes(p.id)).map(p => ({ id: p.id, voiceId: p.voice_id, part: p.part, current: true }))];
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, items }) });
    }
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, items: [] }) });
  }
  if (url.startsWith(BASE)) return route.continue();
  return route.abort();
});

// Dữ liệu: 2 lớp; 5A có 3 em (1 em đã có giọng thống nhất), 5B có 1 em. Đã nhớ mã trong thẻ + đã đồng ý.
await page.goto(BASE + '/classrooms/');
await page.evaluate(async ({ OWNER, C5A, C5B, ST, PIN }) => {
  const S = window.TeacherScriptStore, CS = window.TeacherClassroomStore;
  const names = ['Nguyễn Văn An', 'Triệu Thị Thanh Mai', 'Lý A Dín'];
  const stu = (id, cls, n, i) => ({ id, owner_id: OWNER, class_id: cls, full_name: n, student_code: '', avatar_index: i, orb_color: i, orb_style: 0, photo_path: null, sort_order: i, is_active: true });
  // Mọi câu dẫn đã có sẵn (để đo đúng phần "vừa thêm"): đánh dấu bằng cách lưu trước toàn bộ câu dẫn kịch bản mặc định.
  const db = { tables: {
    teacher_classrooms: [{ id: C5A, owner_id: OWNER, name: '5A', grade: '5', school_year: '2026–2027' }, { id: C5B, owner_id: OWNER, name: '5B', grade: '5', school_year: '2026–2027' }],
    teacher_classroom_students: [...names.map((n, i) => stu(ST[i], C5A, n, i)), stu(ST[3], C5B, 'Hoàng Minh Đức', 0)],
    teacher_student_name_audio: [{ id: crypto.randomUUID(), owner_id: OWNER, class_id: C5A, student_id: ST[0], voice_id: 'edge:namminh-b1', name_hash: await CS.studentNameHash(names[0]), storage_path: OWNER + '/x.wav', size_bytes: 100, updated_at: '' }],
    teacher_voice_scripts: [], teacher_phrase_audio: []
  }, files: {}, session: { access_token: 'fake', user: { id: OWNER, email: 'giaovien@example.com' } } };
  localStorage.setItem('__fakeSupabaseDB', JSON.stringify(db));
  localStorage.setItem('motionclass:uv-consent', '1');
  sessionStorage.setItem('motionclass:uv-pin', PIN);
}, { OWNER, C5A, C5B, ST, PIN });
await page.reload();
await page.waitForSelector('#appPanel:not([hidden])');
await page.locator('#classList').getByText('5A', { exact: false }).first().click();
await page.waitForFunction(() => /thiếu 2 tên/.test(document.getElementById('uvClassVoice').textContent), null, { timeout: 15000 });

// Bấm → cửa sổ nhúng tự tạo + tự lưu (không bấm thêm nút nào).
const t0 = Date.now();
await page.click('#uvClassVoice');
const frame = page.frameLocator('#uvLauncherFrame');
await frame.locator('#status').filter({ hasText: /Đã tạo và lưu \d+ đoạn/ }).waitFor({ timeout: 300000 });
const classSeconds = ((Date.now() - t0) / 1000).toFixed(1);
const inner = await page.frame({ url: /unified-voice/ }).evaluate(() => ({ ...window.__unifiedVoiceTest.state(), header: getComputedStyle(document.querySelector('header')).display, picked: groupFilter.value }));
assert(inner.embed && inner.header === 'none' && inner.tab === 'name' && inner.picked === 'cccccccc-1111-4111-8111-cccccccccccc' && inner.counts.name.total === 3, 'Cửa sổ nhúng chưa đúng lớp: ' + JSON.stringify(inner));
let db = JSON.parse(await page.evaluate(() => localStorage.getItem('__fakeSupabaseDB')));
const edgeNames = db.tables.teacher_student_name_audio.filter(r => r.voice_id === 'edge:namminh-b1');
assert(edgeNames.length === 3 && edgeNames.every(r => r.class_id === C5A), 'Phải lưu đúng 2 tên còn thiếu của lớp 5A (không đụng 5B): ' + edgeNames.length);
assert(db.tables.teacher_phrase_audio.length > 40, 'Câu dẫn mặc định chưa được tạo kèm: ' + db.tables.teacher_phrase_audio.length);
await page.click('#uvLauncherClose');
await page.waitForFunction(() => /Đủ giọng/.test(document.getElementById('uvClassVoice').textContent), null, { timeout: 15000 });
assert(!(await page.$('#uvLauncherFrame')), 'Cửa sổ chưa đóng');

// Ngân hàng câu hỏi: Q1 mới có 1/7 phần, Q2 chưa có phần nào ở giọng thống nhất → thiếu 2 câu.
await page.goto(BASE + '/question-bank/');
await page.waitForFunction(() => /thiếu 2 câu/.test(document.getElementById('uvBankVoice')?.textContent || ''), null, { timeout: 20000 });
await page.click('#uvBankVoice');
await frame.locator('#status').filter({ hasText: /Đã tạo và lưu \d+ đoạn/ }).waitFor({ timeout: 300000 });
const qInner = await page.frame({ url: /unified-voice/ }).evaluate(() => window.__unifiedVoiceTest.state());
assert(qInner.scope === 'questions', 'Sai phạm vi: ' + qInner.scope);
assert(puts.length === 13 && puts.every(p => p.voice_id === 'edge:namminh-b1'), 'Phải lưu đúng 13 phần câu hỏi còn thiếu: ' + puts.length);
db = JSON.parse(await page.evaluate(() => localStorage.getItem('__fakeSupabaseDB')));
assert(db.tables.teacher_student_name_audio.filter(r => r.voice_id === 'edge:namminh-b1').length === 3, 'Cửa sổ câu hỏi không được tạo tên học sinh');
await page.click('#uvLauncherClose');
await page.waitForFunction(() => /Đủ giọng/.test(document.getElementById('uvBankVoice').textContent), null, { timeout: 20000 });

// Không nhớ mã → cửa sổ chờ giáo viên nhập, không tự chạy.
await page.evaluate(() => sessionStorage.removeItem('motionclass:uv-pin'));
await page.click('#uvBankVoice');
await frame.locator('#status').filter({ hasText: /đều đã có giọng|Còn \d+ đoạn/ }).waitFor({ timeout: 20000 });
assert(await frame.locator('#pin').inputValue() === '', 'Mã không được tự điền khi chưa nhớ');
await page.click('#uvLauncherClose');

assert(errors.length === 0, 'Lỗi trang: ' + errors.join(' | '));
console.log('UNIFIED_VOICE_LAUNCHER_OK', JSON.stringify({ classSeconds, names: edgeNames.length, phrases: db.tables.teacher_phrase_audio.length, questionParts: puts.length, actions: [...apiActions] }));
await browser.close();
