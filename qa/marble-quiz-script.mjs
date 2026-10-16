// QA: kịch bản lời dẫn Đua bi (gọi tên → đọc câu hỏi → công bố kết quả).
// Chạy với máy chủ Python thật của cổng (server.Handler) để kiểm tra cả danh sách đường dẫn được phép.
//   python3 qa/serve_portal.py 4174 &  node qa/marble-quiz-script.mjs
import { chromium } from 'playwright';

const BASE = process.env.MARBLE_QA_BASE || 'http://127.0.0.1:4174';
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
const errors = [], external = [], ttsPosts = [];
page.on('pageerror', e => errors.push(String(e)));
page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|ERR_FAILED|net::/.test(m.text())) errors.push('console: ' + m.text()); });
// WAV hợp lệ 0,05 giây cho mọi đường dẫn giả lập /qa-media/ (trừ link cố tình hỏng).
const tinyWav = (() => {
  const n = 400, b = Buffer.alloc(44 + n * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + n * 2, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(8000, 24); b.writeUInt32LE(16000, 28);
  b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(n * 2, 40); return b;
})();
await page.route('**/*', route => {
  const url = route.request().url();
  if (url.includes('/qa-media/') && !url.includes('broken')) return route.fulfill({ status: 200, contentType: 'audio/wav', body: tinyWav });
  if (url.includes('/api/marble-tts') && route.request().method() === 'POST') ttsPosts.push(url);
  if (url.startsWith(BASE)) return route.continue();
  external.push(url); return route.abort();
});

// Giả lập phát âm thanh và giọng thiết bị để ghi lại đúng thứ tự từng đoạn.
await page.addInitScript(() => {
  window.__log = [];
  const blobNames = new Map(), origCreate = URL.createObjectURL.bind(URL);
  URL.createObjectURL = b => { const u = origCreate(b); if (b && b.__qaName) blobNames.set(u, b.__qaName); return u; };
  HTMLMediaElement.prototype.play = function () {
    let src = this.currentSrc || this.src || '';
    if (blobNames.has(src)) src = blobNames.get(src);
    if (src.startsWith('data:')) return Promise.resolve();
    window.__log.push('wav:' + src.split('/').pop());
    setTimeout(() => {
      if (src.includes('broken')) { this.dispatchEvent(new Event('error')); this.onerror?.(); return; }
      this.onplaying?.(); setTimeout(() => this.onended?.(), 15);
    }, 5);
    return src.includes('broken') ? Promise.reject(new Error('broken')) : Promise.resolve();
  };
  HTMLMediaElement.prototype.pause = function () {};
  class FakeUtterance { constructor(t) { this.text = t; } }
  const synth = {
    speak(u) { window.__log.push('say:' + u.text); setTimeout(() => u.onend?.(), 10); },
    cancel() {}, getVoices() { return []; }, addEventListener() {}, removeEventListener() {}, onvoiceschanged: null
  };
  Object.defineProperty(window, 'speechSynthesis', { value: synth, configurable: true });
  Object.defineProperty(window, 'SpeechSynthesisUtterance', { value: FakeUtterance, configurable: true });
  try { localStorage.clear(); } catch (_) {}
});

const res = await page.goto(BASE + '/marble-race/', { waitUntil: 'domcontentloaded' });
if (res.status() !== 200) throw new Error('marble-race HTTP ' + res.status());
const js = await page.request.get(BASE + '/marble-race/quiz-voice-script.js');
if (js.status() !== 200 || !(js.headers()['content-type'] || '').includes('javascript'))
  throw new Error('quiz-voice-script.js không được máy chủ phục vụ đúng: HTTP ' + js.status());
await page.waitForFunction(() => window.MarbleQuizScript && document.getElementById('quizScriptOn'));

const assert = (cond, msg) => { if (!cond) throw new Error(msg); };
const log = () => page.evaluate(() => window.__log.slice());
const clear = () => page.evaluate(() => { window.__log.length = 0; });
const settle = async (ms = 1800) => page.waitForTimeout(ms);
const L = {
  intro: 'Tất cả các bạn đã về đích. Bây giờ, chúng ta cùng bước vào phần trả lời câu hỏi nhé!',
  think: 'Em hãy suy nghĩ thật kỹ trước khi trả lời nhé!',
  correctOpen: ['Chính xác!', 'Đúng rồi!', 'Rất chính xác!'],
  praise: ['Em làm rất tốt!', 'Em thật xuất sắc!', 'Cả lớp cho bạn một tràng pháo tay nào!'],
  wrongOpen: ['Chưa chính xác rồi.', 'Rất tiếc, chưa đúng rồi.'],
  encourage: ['Em cần cố gắng hơn nhé!', 'Không sao cả, lần sau em sẽ làm tốt hơn!', 'Em hãy ghi nhớ đáp án này nhé!'],
  five: 'Còn năm giây!', up: 'Hết giờ! Mời em chọn đáp án.'
};

// Lớp 5 học sinh, 3 câu hỏi liên kết ngân hàng (id giả lập).
const ids = ['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222', '33333333-3333-4333-8333-333333333333'];
await page.evaluate(({ ids }) => {
  document.getElementById('names').value = 'Nguyễn Văn An\nTriệu Thị Thanh Mai\nHoàng Văn Bình\nNông Thị Lan\nLý A Dín';
  document.getElementById('create').click();
  document.querySelector('.mode-choice[data-mode="learn"]').click();
  const mk = (id, text, opts, correct) => {
    const p = v => /[.!?]$/.test(v) ? v : v + '.';
    const keys = ['A', 'B', 'C', 'D'], i = keys.indexOf(correct);
    return { id, text, options: opts, correct, spoken: {
      question: p(text), full: p(text) + ' ' + keys.map((k, j) => 'Phương án ' + k + '. ' + p(opts[j])).join(' ') + ' Em hãy suy nghĩ và lựa chọn một đáp án.',
      answer: 'Đáp án đúng là phương án ' + correct + '. ' + p(opts[i]),
      option_a: 'Phương án A. ' + p(opts[0]), option_b: 'Phương án B. ' + p(opts[1]), option_c: 'Phương án C. ' + p(opts[2]), option_d: 'Phương án D. ' + p(opts[3]) } };
  };
  document.getElementById('questionsInput').value = '';
  window.MarbleSharedBankHooks.importQuestions([
    mk(ids[0], 'Bộ phận nào giúp em nhập chữ vào máy tính?', ['Màn hình', 'Bàn phím', 'Chuột', 'Loa'], 'B'),
    mk(ids[1], 'Khi ngồi máy tính, tư thế nào đúng?', ['Cong lưng', 'Thẳng lưng', 'Nằm', 'Nghiêng'], 'B'),
    mk(ids[2], 'Thiết bị nào phát ra âm thanh?', ['Loa', 'Chuột', 'Bàn phím', 'Màn hình'], 'A')
  ]);
}, { ids });

// WAV giả lập: tên học sinh 1 và 4 (học sinh 4 có link hỏng); câu 1 có full+answer, câu 2 đủ phần lẻ, câu 3 không có WAV.
await page.evaluate(({ ids }) => {
  const st = window.__marbleTest.getState();
  window.__students = st;
  const parts = {
    [ids[0]]: { full: 'q1-full.wav', answer: 'q1-answer.wav' },
    [ids[1]]: { question: 'q2-question.wav', option_a: 'q2-a.wav', option_b: 'q2-b.wav', option_c: 'q2-c.wav', option_d: 'q2-d.wav', full: 'q2-full.wav', answer: 'q2-answer.wav' },
    [ids[2]]: {}
  };
  window.MarbleSharedBankAudio = { urls: async list => new Map(list.map(id => [id, new Map(Object.entries(parts[id] || {}).map(([k, v]) => [k, location.origin + '/qa-media/' + v]))])) };
  window.__nameUrls = {};
  // Giống MarbleNameAudio thật: loadBlob tải và kiểm tra WAV, ném lỗi khi WAV hỏng.
  window.MarbleNameAudio = { has: id => !!window.__nameUrls[id], play: async () => false, clear() {}, refreshVoiceStatus() {}, refreshIfStale: async () => {},
    loadBlob: async (id, voice) => { const u = window.__nameUrls[id]; if (!u || voice === 'device') return null; if (u.includes('broken')) throw Error('WAV tên không hợp lệ');
      const b = await (await fetch(u)).blob(); b.__qaName = u.split('/').pop(); return b; } };
  // Chọn giọng đã lưu (giống khi kho có WAV giọng Google).
  const sel = document.getElementById('raceSavedVoice'); sel.append(new Option('✨ Google đã lưu', 'studio:0123456789abcdef')); sel.value = 'studio:0123456789abcdef';
}, { ids });

// Đua đến khi tất cả về đích.
await page.click('#start');
for (let i = 0; i < 40; i++) {
  await page.evaluate(() => window.__marbleTest.advance(5));
  if ((await page.evaluate(() => window.__marbleTest.getState())).done) break;
}
const st = await page.evaluate(() => window.__marbleTest.getState());
assert(st.done && st.studyFinishers.length === 5 && st.questionCount === 3, 'Cuộc đua học tập chưa hoàn tất: ' + JSON.stringify(st));
const order = st.studyFinishers;
await page.evaluate(order => { window.__nameUrls[order[0]] = location.origin + '/qa-media/name-1.wav'; window.__nameUrls[order[3]] = location.origin + '/qa-media/broken-name.wav'; }, order);
await page.waitForSelector('#rankOverlay:not([hidden])');
await page.selectOption('#quizThink', '10');
const studentName = async () => page.textContent('#quizStudentName');

// 1) Học sinh 1 · câu 1 (WAV đọc cả câu): mở đầu + gọi tên bằng WAV, không lặp câu nhắc suy nghĩ.
await clear(); await page.click('#rankStart'); await settle();
let s1 = await studentName(), a = await log();
assert(JSON.stringify(a.slice(0, 6)) === JSON.stringify(['say:' + L.intro, 'say:Mời em', 'wav:name-1.wav', 'say:trả lời.', 'say:Câu hỏi số một.', 'wav:q1-full.wav']),
  'Sai thứ tự lượt gọi 1: ' + JSON.stringify(a));
assert(!a.includes('say:' + L.think), 'Lặp câu nhắc suy nghĩ khi WAV đọc cả câu đã có');
assert(await page.isVisible('#quizThinkTimer'), 'Không hiện đồng hồ suy nghĩ');

// 2) Trả lời ĐÚNG: Chính xác → WAV đáp án → Chúc mừng em → tên → lời khen.
await clear(); await page.click('.quiz-answer[data-key="B"]'); await settle(1600);
a = await log();
assert(L.correctOpen.map(x => 'say:' + x).includes(a[0]) && a[1] === 'wav:q1-answer.wav' && a[2] === 'say:Chúc mừng em' && a[3] === 'wav:name-1.wav' && L.praise.map(x => 'say:' + x).includes(a[4]),
  'Sai kịch bản trả lời đúng: ' + JSON.stringify(a));
assert(await page.isHidden('#quizThinkTimer'), 'Đồng hồ suy nghĩ không dừng sau khi chấm');

// 3) Học sinh 2 · câu 2 (đủ WAV lẻ): tên chưa có WAV → giọng thiết bị; có câu nhắc suy nghĩ.
await clear(); await page.click('#quizNext');
await page.waitForFunction(t => window.__log.includes('say:' + t), L.think, { timeout: 8000 }); await settle(300);
const s2 = await studentName(); a = await log();
assert(JSON.stringify(a) === JSON.stringify(['say:Mời em', 'say:' + s2, 'say:trả lời.', 'say:Câu hỏi số hai.', 'wav:q2-question.wav', 'wav:q2-a.wav', 'wav:q2-b.wav', 'wav:q2-c.wav', 'wav:q2-d.wav', 'say:' + L.think]),
  'Sai lượt gọi 2: ' + JSON.stringify(a));

// 4) Trả lời SAI: Chưa chính xác → WAV đáp án → lời động viên.
await clear(); await page.click('.quiz-answer[data-key="A"]'); await settle(1500);
a = await log();
assert(L.wrongOpen.map(x => 'say:' + x).includes(a[0]) && a[1] === 'wav:q2-answer.wav' && L.encourage.map(x => 'say:' + x).includes(a[2]) && a.length === 3,
  'Sai kịch bản trả lời sai: ' + JSON.stringify(a));

// 5) Học sinh 3 · câu 3 (không WAV): đọc văn bản, đếm ngược "Còn năm giây" rồi "Hết giờ".
await clear(); await page.click('#quizNext');
await page.waitForFunction(t => window.__log.includes('say:' + t), L.think, { timeout: 8000 });
a = await log();
assert(a.some(x => x.startsWith('say:Thiết bị nào phát ra âm thanh?')) && a.includes('say:' + L.think), 'Lượt 3 không đọc văn bản dự phòng: ' + JSON.stringify(a));
await page.waitForFunction(five => window.__log.includes('say:' + five), L.five, { timeout: 9000 });
await page.waitForFunction(up => window.__log.includes('say:' + up), L.up, { timeout: 9000 });
assert((await page.textContent('#quizThinkTimer')).includes('Hết giờ'), 'Đồng hồ không báo hết giờ');
await page.click('.quiz-answer[data-key="A"]'); await settle(1500);

// 6) Học sinh 4 · câu 1: WAV tên hỏng → tự đọc tên bằng giọng thiết bị, không treo.
await clear(); await page.click('#quizNext'); await settle(1500);
const s4 = await studentName(); a = await log();
assert(a[0] === 'say:Mời em' && a[1] === 'say:' + s4 && a[2] === 'say:trả lời.' && a[3] === 'say:Câu hỏi số một.' && a[4] === 'wav:q1-full.wav', 'Không dự phòng khi WAV tên hỏng: ' + JSON.stringify(a));
await page.click('.quiz-answer[data-key="B"]'); await settle(1600);

// 7) Học sinh 5 · câu 2 đúng → 3 bạn đúng liên tiếp → khen cả lớp.
await clear(); await page.click('#quizNext'); await settle(1200);
await clear(); await page.click('.quiz-answer[data-key="B"]');
await page.waitForFunction(() => window.__log.includes('say:bạn liên tiếp trả lời đúng. Cả lớp thật tuyệt vời!'), null, { timeout: 8000 });
a = await log();
assert(a.at(-2) === 'say:Đã có ba' && a.at(-1) === 'say:bạn liên tiếp trả lời đúng. Cả lớp thật tuyệt vời!', 'Thiếu lời khen chuỗi đúng: ' + JSON.stringify(a));

// 8) Tổng kết cuối giờ.
await clear(); await page.click('#quizNext');
await page.waitForFunction(() => window.__log.some(x => x.startsWith('say:câu hỏi. Cảm ơn')), null, { timeout: 8000 });
a = await log();
assert(JSON.stringify(a.slice(-5)) === JSON.stringify(['say:Cả lớp đã trả lời đúng', 'say:bốn', 'say:trên', 'say:năm', 'say:câu hỏi. Cảm ơn các em đã tham gia, chúc các em học thật tốt!']), 'Thiếu lời tổng kết: ' + JSON.stringify(a));

// 9) Kho kịch bản: WAV câu dẫn đã lưu + luân phiên kịch bản mỗi cuộc đua + ngẫu nhiên mỗi lượt.
await page.click('#rankClose').catch(() => {});
const lib = await page.evaluate(() => {
  const S = window.TeacherScriptStore, T = S.TEMPLATES;
  const scripts = [1, 2].map((k, i) => ({ id: 'bbbbbbbb-000' + i + '-4000-8000-00000000000' + i, isActive: true, ...S.cleanScript(JSON.parse(JSON.stringify(T[k]))) }));
  const rows = []; let n = 0;
  for (const p of S.scriptPhrases(scripts[0])) rows.push({ phrase: p.text, voiceId: 'studio:0123456789abcdef', url: location.origin + '/qa-media/phrase-' + (n++) + '.wav' });
  window.MarbleQuizScript._setLibrary(scripts, rows);
  return { titles: scripts.map(s => s.title), phrases: rows.length, second: S.scriptPhrases(scripts[1]).map(p => p.text) };
});
const opts = await page.$$eval('#quizScriptPick option', o => o.map(x => x.value));
assert(opts.includes('rotate-race') && opts.includes('random-turn') && opts.filter(v => v.startsWith('id:')).length === 2, 'Danh sách chọn kịch bản sai: ' + opts);
await page.selectOption('#quizScriptPick', 'rotate-race');
const callWith = async intro => { await clear(); await page.evaluate(i => { const st = window.MarbleQuizHooks.sample(); return window.MarbleQuizScript.call(st.student, st.question, { intro: i, force: true }); }, intro); return page.evaluate(() => ({ cur: window.MarbleQuizScript._current(), log: window.__log.slice(), plan: window.MarbleQuizScript._lastPlan() })); };
const r1 = await callWith(true), r2 = await callWith(true);
assert(r1.cur && r2.cur && r1.cur !== r2.cur && lib.titles.includes(r1.cur) && lib.titles.includes(r2.cur), 'Không đổi kịch bản giữa hai cuộc đua: ' + r1.cur + ' / ' + r2.cur);
const withWav = r1.cur === lib.titles[0] ? r1 : r2, withoutWav = r1.cur === lib.titles[0] ? r2 : r1;
assert(withWav.log.some(x => x.startsWith('wav:phrase-')) && withWav.plan.filter(p => p.kind === 'phrase').every(p => p.source === 'saved-phrase'), 'Kịch bản có WAV câu dẫn nhưng không phát từ WAV: ' + JSON.stringify(withWav.plan));
const shared = withoutWav.plan.find(p => p.text === 'Câu hỏi số một.'), own = withoutWav.plan.find(p => p.kind === 'phrase' && lib.second.includes(p.text) && p.text !== 'Câu hỏi số một.');
assert(shared?.source === 'saved-phrase' && own?.source === 'device', 'Kịch bản 2 phải dùng chung WAV “Câu hỏi số một.” và đọc dự phòng phần riêng: ' + JSON.stringify(withoutWav.plan));
const r3 = await callWith(false);
assert(r3.cur === r2.cur, 'Trong cùng cuộc đua phải giữ nguyên kịch bản');
// Ngẫu nhiên mỗi lượt: phần công bố kết quả dùng ĐÚNG kịch bản đã gọi học sinh đó.
await page.selectOption('#quizScriptPick', 'random-turn');
for (let i = 0; i < 4; i++) {
  await clear();
  const same = await page.evaluate(async () => {
    const st = window.MarbleQuizHooks.sample(), S = window.TeacherScriptStore;
    await window.MarbleQuizScript.call(st.student, st.question, { force: true });
    const callTexts = window.MarbleQuizScript._lastPlan().filter(p => p.kind === 'phrase').map(p => p.text);
    await window.MarbleQuizScript.result(st.student, st.question, true, { force: true });
    const resTexts = window.MarbleQuizScript._lastPlan().filter(p => p.kind === 'phrase').map(p => p.text);
    const owner = t => [...document.querySelectorAll('#quizScriptPick option')].length && t;
    return { callTexts, resTexts };
  });
  const scriptOf = t => lib.second.includes(t) ? 2 : 1;
  const a1 = new Set(same.callTexts.filter(t => !t.startsWith('Câu hỏi số')).map(scriptOf)), a2 = new Set(same.resTexts.map(scriptOf));
  assert(a1.size === 1 && a2.size === 1 && [...a1][0] === [...a2][0], 'Kết quả dùng kịch bản khác với lúc gọi: ' + JSON.stringify(same));
}
// Đua bi không tạo giọng: không đưa câu dẫn vào hàng đợi tạo âm thanh.
assert(await page.evaluate(() => window.MarbleQuizScript.prepTexts([{ num: 1 }], []).length) === 0, 'Đua bi vẫn đưa câu dẫn vào hàng đợi tạo giọng');
// Chọn "Giọng thiết bị" → không phát bất kỳ WAV nào.
await page.evaluate(() => { document.getElementById('raceSavedVoice').value = 'device'; });
const dev = await callWith(false);
assert(!dev.log.some(x => x.startsWith('wav:')) && dev.log.length > 3, 'Chọn giọng thiết bị nhưng vẫn phát WAV: ' + JSON.stringify(dev.log));
await page.evaluate(() => { document.getElementById('raceSavedVoice').value = 'studio:0123456789abcdef'; });

// 10) Tắt kịch bản → trò chơi quay về cách đọc cũ.
await page.click('#rankClose').catch(() => {});
await page.evaluate(() => { const c = document.getElementById('quizScriptOn'); c.checked = false; c.dispatchEvent(new Event('change')); });
assert(!(await page.evaluate(() => window.MarbleQuizScript.enabled())), 'Không tắt được kịch bản');

assert(ttsPosts.length === 0, 'Kịch bản đã gọi Google AI Studio: ' + ttsPosts.join(','));
assert(errors.length === 0, 'Lỗi trang: ' + errors.join(' | '));
console.log('MARBLE_QUIZ_SCRIPT_OK', JSON.stringify({ students: [s1, s2, s4], blockedExternal: external.length }));
await browser.close();
