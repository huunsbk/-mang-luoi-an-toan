// QA: ô "Giải thích" của câu hỏi — soạn/nhập ở Ngân hàng câu hỏi, Đua bi đọc giải thích ngay sau đáp án (đúng và sai),
// câu không có giải thích thì bỏ qua; kịch bản cũ chưa có {giải thích} vẫn tự đọc sau {đáp án}.
//   python3 qa/serve_portal.py 4174 &  node qa/question-explanation.mjs
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const BASE = process.env.MARBLE_QA_BASE || 'http://127.0.0.1:4174';
const fake = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'fake-supabase.js'), 'utf8');
const assert = (c, m) => { if (!c) throw new Error(m); };
const browser = await chromium.launch({ headless: true });
const errors = [];
const tinyWav = (() => { const n = 400, b = Buffer.alloc(44 + n * 2); b.write('RIFF', 0); b.writeUInt32LE(36 + n * 2, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(8000, 24); b.writeUInt32LE(16000, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(n * 2, 40); return b; })();
const WHY = '12 nhân 24 bằng 288, vì 12 nhân 20 bằng 240 và 12 nhân 4 bằng 48.';

/* ---------- 1) Ngân hàng câu hỏi: soạn, xem, nhập hàng loạt ---------- */
{
  const page = await browser.newPage();
  page.on('pageerror', e => errors.push('bank: ' + e));
  page.on('dialog', d => d.accept());
  const saves = [];
  const BANK = [{ id: '11111111-aaaa-4aaa-8aaa-111111111111', owned: true, subject: 'Toán', lesson: 'Phép nhân', grade: 4, visibility: 'private', text: '12 nhân 24 bằng?', options: ['278', '288', '298', '308'], correct: 'B', explanation: WHY,
    spoken: { question: '12 nhân 24 bằng?', answer: 'Đáp án đúng là phương án B. 288.', explain: WHY }, updatedAt: '2026-10-16T00:00:00Z' }];
  await page.route('**/*', route => {
    const req = route.request(), url = req.url();
    if (url.includes('@supabase/supabase-js')) return route.fulfill({ contentType: 'application/javascript', body: fake });
    if (url.includes('/functions/v1/shared-question-api')) {
      const body = JSON.parse(req.postData() || '{}');
      if (body.action === 'bank.save' || body.action === 'bank.save_many') { const items = body.items || [body.item]; saves.push(...items); return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, items: items.map((x, i) => ({ id: x.id || 'bbbbbbbb-0000-4000-8000-00000000000' + i, created: !x.id })), created: items.length, updated: 0 }) }); }
      if (body.action === 'bank.list') return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, items: BANK, nextOffset: null, facets: { subjects: ['Toán'] } }) });
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, items: [] }) });
    }
    if (url.startsWith(BASE)) return route.continue();
    return route.abort();
  });
  await page.goto(BASE + '/question-bank/');
  await page.evaluate(() => localStorage.setItem('__fakeSupabaseDB', JSON.stringify({ tables: {}, files: {}, session: { access_token: 'fake', user: { id: 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa', email: 'gv@example.com' } } })));
  await page.reload();
  await page.waitForFunction(() => document.querySelectorAll('#questionList tr').length >= 1 && !/Đăng nhập/.test(document.getElementById('questionList').textContent), null, { timeout: 15000 });
  // Câu có giải thích: xem chi tiết có 💡, mở sửa thì ô giải thích đã điền.
  await page.evaluate(() => [...document.querySelectorAll('#questionList button')].find(b => /Xem|👁/.test(b.textContent))?.click());
  await page.waitForSelector('#previewView:not([hidden])');
  assert((await page.textContent('#previewOptions')).includes('💡 Giải thích: ' + WHY), 'Xem chi tiết không hiện giải thích');
  await page.click('#previewEdit');
  assert(await page.inputValue('#explanation') === WHY, 'Mở sửa không nạp giải thích');
  // Câu mới có giải thích.
  await page.evaluate(() => document.getElementById('newQuestion').click());
  await page.waitForFunction(() => document.getElementById('explanation').value === '');
  await page.selectOption('#editGrade', '3'); await page.fill('#subject', 'Toán'); await page.fill('#lesson', 'Phép cộng');
  await page.fill('#question', '5 cộng 5 bằng?'); await page.fill('#optionA', '9'); await page.fill('#optionB', '10'); await page.fill('#optionC', '11'); await page.fill('#optionD', '12');
  await page.selectOption('#correct', 'B'); await page.fill('#explanation', '  Năm   cộng năm bằng mười. ');
  await page.click('#saveQuestion');
  await page.waitForFunction(n => window.__saves === undefined, null).catch(() => {});
  await page.waitForTimeout(800);
  const saved = saves.at(-1);
  assert(saved?.text === '5 cộng 5 bằng?' && saved.explanation === 'Năm cộng năm bằng mười.', 'Lưu câu hỏi không kèm giải thích: ' + JSON.stringify(saved));
  // Nhập hàng loạt có dòng "Giải thích:" (và câu không có giải thích).
  await page.evaluate(() => document.getElementById('openImport').click());
  await page.selectOption('#bulkGrade', '3').catch(() => {});
  await page.fill('#bulkSubject', 'Toán').catch(() => {}); await page.fill('#bulkLesson', 'Ôn tập').catch(() => {});
  await page.fill('#bulkText', 'Câu 1: 2 nhân 3 bằng?\nA. 5\nB. 6\nC. 7\nD. 8\nĐáp án đúng: B\nGiải thích: Hai nhân ba bằng sáu,\nvì 3 + 3 = 6.\n\nCâu 2: 1 cộng 1 bằng?\nA. 1\nB. 2\nC. 3\nD. 4\nĐáp án đúng: B');
  const before = saves.length;
  await page.evaluate(() => [...document.querySelectorAll('button')].find(b => b.id === 'bulkSave' || /Lưu.*câu/.test(b.textContent) && b.closest('#importView'))?.click());
  await page.waitForFunction(n => true, null); await page.waitForTimeout(800);
  const bulk = saves.slice(before);
  assert(bulk.length === 2 && bulk[0].explanation === 'Hai nhân ba bằng sáu, vì 3 + 3 = 6.' && !bulk[1].explanation, 'Nhập hàng loạt chưa đọc dòng Giải thích: ' + JSON.stringify(bulk));
  await page.close();
}

/* ---------- 2) Đua bi: đọc giải thích ngay sau đáp án ---------- */
const page = await browser.newPage();
page.on('pageerror', e => errors.push('marble: ' + e));
await page.route('**/*', route => {
  const url = route.request().url();
  if (url.includes('/qa-media/')) return route.fulfill({ status: 200, contentType: 'audio/wav', body: tinyWav });
  if (url.startsWith(BASE)) return route.continue();
  return route.abort();
});
await page.addInitScript(() => {
  window.__log = [];
  const of = window.fetch.bind(window), names = new Map(), oc = URL.createObjectURL.bind(URL);
  window.fetch = async (...a) => { const r = await of(...a); const u = String(a[0]?.url || a[0]); if (!u.includes('/qa-media/') || !r.ok) return r; const b = await r.blob(); b.__qaName = u.split('/').pop(); return { ok: true, status: r.status, blob: async () => b }; };
  URL.createObjectURL = b => { const u = oc(b); if (b?.__qaName) names.set(u, b.__qaName); return u; };
  HTMLMediaElement.prototype.play = function () { let src = this.currentSrc || this.src || ''; if (names.has(src)) src = names.get(src); if (src.startsWith('data:')) return Promise.resolve(); window.__log.push('wav:' + src.split('/').pop()); setTimeout(() => { this.onplaying?.(); setTimeout(() => this.onended?.(), 15); }, 5); return Promise.resolve(); };
  HTMLMediaElement.prototype.pause = function () {};
  class U { constructor(t) { this.text = t; } }
  Object.defineProperty(window, 'speechSynthesis', { value: { speak(u) { window.__log.push('say:' + u.text); setTimeout(() => u.onend?.(), 10); }, cancel() {}, getVoices() { return []; }, addEventListener() {}, removeEventListener() {} }, configurable: true });
  Object.defineProperty(window, 'SpeechSynthesisUtterance', { value: U, configurable: true });
  try { localStorage.clear(); } catch (_) {}
});
await page.goto(BASE + '/marble-race/', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.MarbleQuizScript && window.MarbleSharedBankHooks);
const ids = ['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222'];
await page.evaluate(({ ids, WHY }) => {
  document.getElementById('names').value = 'An\nBình\nChi';
  document.getElementById('create').click();
  document.querySelector('.mode-choice[data-mode="learn"]').click();
  const sp = (text, opts, correct, explain) => { const p = v => /[.!?]$/.test(v) ? v : v + '.', k = ['A', 'B', 'C', 'D'], i = k.indexOf(correct);
    const w = { question: p(text), full: p(text) + ' x', answer: 'Đáp án đúng là phương án ' + correct + '. ' + p(opts[i]) }; k.forEach((x, j) => { w['option_' + x.toLowerCase()] = 'Phương án ' + x + '. ' + p(opts[j]); }); if (explain) w.explain = explain; return w; };
  window.MarbleSharedBankHooks.importQuestions([
    { id: ids[0], text: '12 nhân 24 bằng?', options: ['278', '288', '298', '308'], correct: 'B', explanation: WHY, spoken: sp('12 nhân 24 bằng?', ['278', '288', '298', '308'], 'B', WHY) },
    { id: ids[1], text: 'Thủ đô Việt Nam?', options: ['Huế', 'Hà Nội', 'Đà Nẵng', 'Vinh'], correct: 'B', spoken: sp('Thủ đô Việt Nam?', ['Huế', 'Hà Nội', 'Đà Nẵng', 'Vinh'], 'B') }
  ]);
  // Câu 3 gõ tay, có dòng "Giải thích:" (chưa có WAV → đọc bằng giọng thiết bị).
  const ta = document.getElementById('questionsInput');
  ta.value += '\n\nCâu 3: 5 cộng 5 bằng?\nA. 9\nB. 10\nC. 11\nD. 12\nĐáp án đúng: B\nGiải thích: Năm cộng năm bằng mười.';
  ta.dispatchEvent(new Event('input', { bubbles: true }));
  const parts = { [ids[0]]: { full: 'q1-full.wav', answer: 'q1-answer.wav', explain: 'q1-explain.wav' }, [ids[1]]: { full: 'q2-full.wav', answer: 'q2-answer.wav' } };
  window.MarbleSharedBankAudio = { urls: async list => new Map(list.map(id => [id, new Map(Object.entries(parts[id] || {}).map(([k, v]) => [k, location.origin + '/qa-media/' + v]))])) };
  window.MarbleNameAudio = { has: () => false, play: async () => false, clear() {}, refreshVoiceStatus() {}, refreshIfStale: async () => {}, loadBlob: async () => null };
  const sel = document.getElementById('raceSavedVoice'); sel.append(new Option('NamMinh', 'edge:namminh-b1')); sel.value = 'edge:namminh-b1';
}, { ids, WHY });
const info = await page.textContent('#questionInfo');
assert(!/vấn đề|không hợp lệ/i.test(info), 'Dòng “Giải thích:” bị báo lỗi khi nhập câu hỏi: ' + info);
await page.click('#start');
for (let i = 0; i < 40; i++) { await page.evaluate(() => window.__marbleTest.advance(5)); if ((await page.evaluate(() => window.__marbleTest.getState())).done) break; }
await page.waitForSelector('#rankOverlay:not([hidden])');
const log = () => page.evaluate(() => window.__log.slice());
const clear = () => page.evaluate(() => { window.__log.length = 0; });
await page.click('#rankStart'); await page.waitForTimeout(1500);

// Câu 1 trả lời ĐÚNG → đáp án rồi giải thích (WAV), rồi chúc mừng.
await clear(); await page.click('.quiz-answer[data-key="B"]'); await page.waitForTimeout(1500);
let a = await log();
let ia = a.indexOf('wav:q1-answer.wav');
assert(ia > 0 && a[ia + 1] === 'wav:q1-explain.wav' && a[ia + 2] === 'say:Chúc mừng em', 'Đúng: giải thích phải đọc ngay sau đáp án: ' + JSON.stringify(a));
assert((await page.textContent('#quizFeedbackText')).includes('💡 ' + WHY), 'Màn hình chưa hiện giải thích');

// Câu 2 (không có giải thích) trả lời SAI → bỏ qua giải thích.
await clear(); await page.click('#quizNext'); await page.waitForTimeout(1200);
await clear(); await page.click('.quiz-answer[data-key="A"]'); await page.waitForTimeout(1500);
a = await log();
ia = a.indexOf('wav:q2-answer.wav');
assert(ia > 0 && !a.some(x => /explain|Giải thích/.test(x)) && a.length === ia + 2, 'Câu không có giải thích phải bỏ qua: ' + JSON.stringify(a));
assert(!(await page.textContent('#quizFeedbackText')).includes('💡'), 'Câu không có giải thích vẫn hiện 💡');

// Câu 3 (gõ tay, chưa có WAV) trả lời SAI → giải thích đọc bằng giọng thiết bị, ngay sau đáp án.
await clear(); await page.click('#quizNext'); await page.waitForTimeout(1200);
await clear(); await page.click('.quiz-answer[data-key="A"]'); await page.waitForTimeout(1500);
a = await log();
const ie = a.indexOf('say:Năm cộng năm bằng mười.');
assert(ie > 0 && /Đáp án đúng là phương án B/.test(a[ie - 1]), 'Câu gõ tay: giải thích phải đọc sau đáp án: ' + JSON.stringify(a));

// Kịch bản cũ chưa có {giải thích} (giáo viên tạo trước khi có tính năng) → vẫn tự đọc sau {đáp án}.
const legacy = await page.evaluate(async ({ ids }) => {
  const S = window.TeacherScriptStore;
  const sc = { id: 'cccccccc-0000-4000-8000-000000000001', isActive: true, title: 'Cũ', theme: 'custom', slots: { call: ['Mời em {tên}. Câu hỏi số {số}.'], correct: ['Tuyệt vời! {đáp án} Hoan hô {tên}!'], wrong: ['Tiếc quá! {đáp án} Cố lên!'], options: { maxNumber: 20 } } };
  window.MarbleQuizScript._setLibrary([sc], []);
  window.__log.length = 0;
  const st = window.MarbleQuizHooks.sample(), q = window.__marbleTest && st.question;
  await window.MarbleQuizScript.result(st.student, q, true, { force: true });
  return { log: window.__log.slice(), allowed: S.SLOTS.find(s => s.key === 'correct').allowed, tmpl: S.TEMPLATES[0].slots.correct[0], builtin: S.BUILTIN.slots.wrong[0] };
}, { ids });
ia = legacy.log.indexOf('wav:q1-answer.wav');
assert(ia > 0 && legacy.log[ia + 1] === 'wav:q1-explain.wav', 'Kịch bản cũ: giải thích chưa tự đọc sau đáp án: ' + JSON.stringify(legacy.log));
assert(legacy.allowed.includes('giải thích') && legacy.tmpl.includes('{đáp án} {giải thích}') && legacy.builtin.includes('{đáp án} {giải thích}'), 'Mẫu kịch bản chưa có {giải thích}');

assert(errors.length === 0, 'Lỗi trang: ' + errors.join(' | '));
console.log('QUESTION_EXPLANATION_OK', JSON.stringify({ correctFlow: a.length, legacy: legacy.log.slice(0, 5) }));
await browser.close();
