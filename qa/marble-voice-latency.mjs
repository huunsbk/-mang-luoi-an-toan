// QA: Đua bi phải có tiếng NGAY sau khi bấm (mạng chậm giả lập), và mọi nút bấm cắt giọng đang đọc ngay.
//   python3 qa/serve_portal.py 4174 &  node qa/marble-voice-latency.mjs
// Mạng giả lập: mỗi WAV mất 600 ms, mỗi lượt hỏi link WAV câu hỏi mất 1200 ms.
import { chromium } from 'playwright';

const BASE = process.env.MARBLE_QA_BASE || 'http://127.0.0.1:4174';
const WAV_DELAY = 600, LINK_DELAY = 1200, PLAY_MS = 350;
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
const errors = [];
let wavFetches = 0;
page.on('pageerror', e => errors.push(String(e)));
const tinyWav = (() => {
  const n = 400, b = Buffer.alloc(44 + n * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + n * 2, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(8000, 24); b.writeUInt32LE(16000, 28);
  b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(n * 2, 40); return b;
})();
await page.route('**/*', async route => {
  const url = route.request().url();
  if (url.includes('/qa-media/')) { wavFetches++; await new Promise(r => setTimeout(r, WAV_DELAY)); return route.fulfill({ status: 200, contentType: 'audio/wav', body: tinyWav }); }
  if (url.startsWith(BASE)) return route.continue();
  return route.abort();
});
await page.addInitScript(PLAY_MS => {
  window.__log = []; window.__t0 = 0;
  // Đo từ đúng lúc trình duyệt nhận cú bấm (không tính độ trễ của công cụ kiểm thử).
  document.addEventListener('click', () => { if (window.__armed) { window.__armed = false; window.__t0 = performance.now(); window.__log.length = 0; } }, true);
  // Gắn tên tệp cho Blob tải từ /qa-media/ để nhật ký ghi đúng đoạn nào đang phát.
  const of = window.fetch.bind(window), names = new Map(), oc = URL.createObjectURL.bind(URL);
  window.fetch = async (...a) => { const r = await of(...a); const u = String(a[0]?.url || a[0]); if (!u.includes('/qa-media/')) return r;
    const b = await r.blob(); b.__qaName = u.split('/').pop(); return { ok: r.ok, status: r.status, blob: async () => b }; };
  URL.createObjectURL = b => { const u = oc(b); if (b?.__qaName) names.set(u, b.__qaName); return u; };
  HTMLMediaElement.prototype.play = function () {
    let src = this.currentSrc || this.src || ''; if (names.has(src)) src = names.get(src);
    if (src.startsWith('data:')) return Promise.resolve();
    window.__log.push({ what: 'wav:' + src.split('/').pop(), at: performance.now() - window.__t0, el: this });
    this.__timer = setTimeout(() => { this.onplaying?.(); this.__end = setTimeout(() => this.onended?.(), PLAY_MS); }, 5);
    return Promise.resolve();
  };
  HTMLMediaElement.prototype.pause = function () { clearTimeout(this.__timer); clearTimeout(this.__end); window.__log.push({ what: 'pause', at: performance.now() - window.__t0 }); };
  class U { constructor(t) { this.text = t; } }
  Object.defineProperty(window, 'speechSynthesis', { value: { speak(u) { window.__log.push({ what: 'say:' + u.text, at: performance.now() - window.__t0 }); setTimeout(() => u.onend?.(), PLAY_MS); }, cancel() {}, getVoices() { return []; }, addEventListener() {}, removeEventListener() {} }, configurable: true });
  Object.defineProperty(window, 'SpeechSynthesisUtterance', { value: U, configurable: true });
  try { localStorage.clear(); } catch (_) {}
}, PLAY_MS);

await page.goto(BASE + '/marble-race/', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.MarbleQuizScript && window.TeacherScriptStore);
const REPORT = process.env.REPORT_ONLY === '1', notes = [];
const assert = (c, m) => { if (!c) { if (REPORT) notes.push(m); else throw new Error(m); } };
const VOICE = 'edge:namminh-b1';
const ids = ['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222', '33333333-3333-4333-8333-333333333333'];
let linkCalls = 0;
await page.exposeFunction('__linkCall', () => { linkCalls++; });
await page.evaluate(({ ids, VOICE, LINK_DELAY }) => {
  document.getElementById('names').value = 'Nguyễn Văn An\nTriệu Thị Thanh Mai\nHoàng Văn Bình\nNông Thị Lan\nLý A Dín';
  document.getElementById('create').click();
  document.querySelector('.mode-choice[data-mode="learn"]').click();
  const P = ['question', 'option_a', 'option_b', 'option_c', 'option_d', 'answer', 'full'];
  const mk = (id, text, opts, correct) => {
    const p = v => /[.!?]$/.test(v) ? v : v + '.', keys = ['A', 'B', 'C', 'D'], i = keys.indexOf(correct);
    return { id, text, options: opts, correct, spoken: { question: p(text), full: p(text) + ' x', answer: 'Đáp án đúng là phương án ' + correct + '. ' + p(opts[i]),
      option_a: 'Phương án A. ' + p(opts[0]), option_b: 'Phương án B. ' + p(opts[1]), option_c: 'Phương án C. ' + p(opts[2]), option_d: 'Phương án D. ' + p(opts[3]) } };
  };
  window.MarbleSharedBankHooks.importQuestions([
    mk(ids[0], 'Bộ phận nào giúp em nhập chữ vào máy tính?', ['Màn hình', 'Bàn phím', 'Chuột', 'Loa'], 'B'),
    mk(ids[1], 'Khi ngồi máy tính, tư thế nào đúng?', ['Cong lưng', 'Thẳng lưng', 'Nằm', 'Nghiêng'], 'B'),
    mk(ids[2], 'Thiết bị nào phát ra âm thanh?', ['Loa', 'Chuột', 'Bàn phím', 'Màn hình'], 'A')
  ]);
  // Hỏi link WAV câu hỏi: chậm 1,2 giây mỗi lượt gọi (như edge function), có bộ đệm như bản thật.
  const cache = new Map();
  window.MarbleSharedBankAudio = { urls: async list => {
    const miss = list.filter(id => !cache.has(id));
    if (miss.length) { window.__linkCall(); await new Promise(r => setTimeout(r, LINK_DELAY)); for (const id of miss) cache.set(id, new Map(P.map((k, j) => [k, location.origin + '/qa-media/q' + (ids.indexOf(id) + 1) + '-' + k + '.wav']))); }
    return new Map(list.map(id => [id, cache.get(id)]));
  } };
  // Tên học sinh: WAV qua mạng chậm, có bộ đệm như MarbleNameAudio thật.
  const names = new Map();
  window.MarbleNameAudio = { has: () => true, play: async () => false, clear() {}, refreshVoiceStatus() {},
    refreshIfStale: () => new Promise(r => setTimeout(r, 3000)),// làm mới chậm: KHÔNG được chặn lượt gọi
    loadBlob: (id, voice) => { if (!names.has(id)) names.set(id, fetch(location.origin + '/qa-media/name-' + id.slice(0, 8) + '.wav').then(r => r.blob())); return names.get(id); } };
  const sel = document.getElementById('raceSavedVoice'); sel.append(new Option('🎙️ Microsoft NamMinh đã lưu', VOICE)); sel.value = VOICE;
  // Mọi câu dẫn của kịch bản mặc định đã có WAV giọng thống nhất.
  const S = window.TeacherScriptStore; let n = 0;
  const rows = S.scriptPhrases(S.BUILTIN, { maxNumber: 20, scoreNumbers: true }).map(p => ({ phrase: p.text, voiceId: VOICE, url: location.origin + '/qa-media/phrase-' + (n++) + '.wav' }));
  window.MarbleQuizScript._setLibrary([], rows);
}, { ids, VOICE, LINK_DELAY });

// Đua: warm chạy trong lúc bi chạy.
await page.click('#start');
if (!REPORT) await page.waitForFunction(() => !!window.__quizWarm);
const warmT = Date.now();
for (let i = 0; i < 40; i++) { await page.evaluate(() => window.__marbleTest.advance(5)); if ((await page.evaluate(() => window.__marbleTest.getState())).done) break; }
const warmInfo = await page.evaluate(() => window.__quizWarm || null);
const warmSeconds = ((Date.now() - warmT) / 1000).toFixed(1);
assert(warmInfo?.ok && warmInfo.cached > 20, 'Chưa tải trước giọng trong lúc đua: ' + JSON.stringify(warmInfo));
await page.waitForSelector('#rankOverlay:not([hidden])');

const press = async sel => { await page.evaluate(() => { window.__log.length = 0; window.__armed = true; }); wavFetches = 0; linkCalls = 0; await page.click(sel); };
const firstSound = async () => { await page.waitForFunction(() => window.__log.some(x => x.what.startsWith('wav:') || x.what.startsWith('say:')), null, { timeout: 8000 }); return page.evaluate(() => window.__log.find(x => x.what.startsWith('wav:') || x.what.startsWith('say:'))); };
const plain = () => page.evaluate(() => window.__log.map(x => ({ what: x.what, at: Math.round(x.at) })));

// 1) Bấm "Bắt đầu" phần câu hỏi → có tiếng gần như ngay, không chờ mạng.
await press('#rankStart');
let first = await firstSound();
await page.waitForFunction(() => window.__log.some(x => /q1-full\.wav|q1-question\.wav/.test(x.what)), null, { timeout: 15000 });
let log1 = await plain();
assert(first.at < 600, 'Lượt 1: tiếng đầu tiên sau ' + Math.round(first.at) + ' ms (yêu cầu < 2 giây, mục tiêu < 0,6 giây)');
assert(log1.every(x => !x.what.startsWith('say:')), 'Lượt 1 phải toàn WAV giọng thống nhất: ' + JSON.stringify(log1));
const gaps1 = log1.filter(x => x.what.startsWith('wav:')).map((x, i, a) => i ? x.at - a[i - 1].at : 0);
assert(Math.max(...gaps1) < PLAY_MS + 450, 'Có khoảng lặng chờ mạng giữa các đoạn: ' + JSON.stringify(gaps1));
const call1 = { firstMs: Math.round(first.at), wavFetches, linkCalls };

// 2) Đang đọc câu hỏi mà bấm đáp án → giọng cũ dừng ngay, lời nhận xét bắt đầu sau tiếng chuông ngắn.
await page.waitForTimeout(200);
await press('.quiz-answer[data-key="B"]');
await page.waitForFunction(() => window.__log.some(x => x.what === 'pause'), null, { timeout: 3000 });
let ans = await plain();
const pauseAt = ans.find(x => x.what === 'pause').at;
first = await firstSound();
const answerMs = Math.round(first.at);
assert(pauseAt < 80, 'Giọng cũ không dừng ngay khi bấm đáp án: ' + pauseAt + ' ms');
assert(first.at < 800, 'Lời nhận xét bắt đầu sau ' + Math.round(first.at) + ' ms');
await page.waitForTimeout(1600);
ans = await plain();
assert(ans.some(x => x.what === 'wav:q1-answer.wav'), 'Thiếu WAV đáp án: ' + JSON.stringify(ans));

// 3) Học sinh tiếp theo (câu 2 đã được tải trước khi đang đọc câu 1) → có tiếng ngay, không gọi lại link.
await press('#quizNext');
first = await firstSound();
await page.waitForFunction(() => window.__log.some(x => /q2-question\.wav|q2-full\.wav/.test(x.what)), null, { timeout: 15000 });
const call2 = { firstMs: Math.round(first.at), wavFetches, linkCalls };
assert(first.at < 600, 'Lượt 2: tiếng đầu tiên sau ' + call2.firstMs + ' ms');
const qStart2 = (await plain()).find(x => /q2-question\.wav|q2-full\.wav/.test(x.what)).at;

// 4) Bấm "Đọc lại"/"Học sinh tiếp theo"/đóng giữa chừng → dừng ngay.
await page.waitForTimeout(150);
await page.evaluate(() => { window.__log.length = 0; window.__t0 = performance.now(); });
await page.evaluate(() => window.MarbleQuizHooks.stopGame());
const stopLog = await plain();
assert(stopLog.some(x => x.what === 'pause' && x.at < 50), 'Lệnh dừng không cắt giọng ngay: ' + JSON.stringify(stopLog));
await page.waitForTimeout(900);
assert((await plain()).filter(x => x.what.startsWith('wav:')).length === 0, 'Sau khi dừng vẫn còn phát tiếp đoạn sau');

assert(errors.length === 0, 'Lỗi trang: ' + errors.join(' | '));
console.log(REPORT ? 'REPORT' : 'MARBLE_VOICE_LATENCY_OK', JSON.stringify({ notes, warmSeconds, cached: warmInfo?.cached, call1, answerMs, call2, question2StartsAtMs: Math.round(qStart2), pauseMs: Math.round(pauseAt) }));
await browser.close();
