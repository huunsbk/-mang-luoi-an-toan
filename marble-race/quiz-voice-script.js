/* MotionClass — Kịch bản lời dẫn cho chế độ Học tập của Đua bi.
 *
 * Kịch bản được soạn ở /scripts/ (TeacherScriptStore). Mỗi lượt hỏi ghép:
 *   • đoạn câu dẫn: WAV đã duyệt trong teacher_phrase_audio (tạo trước theo lô ở trang Kịch bản);
 *   • {tên}: WAV tên học sinh (MarbleNameAudio);
 *   • câu hỏi và {đáp án}: WAV ngân hàng câu hỏi (MarbleSharedBankAudio);
 *   • {số}: WAV "Câu hỏi số ba." dùng chung cho mọi kịch bản.
 * Thứ tự dự phòng từng đoạn: WAV đã lưu → âm thanh đã chuẩn bị → NGHI-TTS trên thiết bị → giọng thiết bị.
 * Mô-đun KHÔNG BAO GIỜ gọi Google AI Studio; câu dẫn bằng Google chỉ được tạo theo lô ở trang Kịch bản.
 */
(function(){
'use strict';
const $=id=>document.getElementById(id);
const hooks=()=>window.MarbleQuizHooks||null;
const S=()=>window.TeacherScriptStore||null;
const SETTINGS_KEY='motionclass:marble-quiz-script-v2',ROTATE_KEY='motionclass:marble-quiz-script-rotate';
const KEYS=['A','B','C','D'];
const PARTS=['question','option_a','option_b','option_c','option_d'];
const STREAK_MARKS=new Set([3,5,10,15,20]);
const LINK_TTL=45*60*1000;

/* Kịch bản dựng sẵn — dùng khi chưa đăng nhập hoặc chưa có kịch bản nào. */
const BUILTIN=window.TeacherScriptStore?.BUILTIN||{id:'builtin',title:'Mặc định (có sẵn)',slots:{
 intro:['Tất cả các bạn đã về đích. Bây giờ, chúng ta cùng bước vào phần trả lời câu hỏi nhé!'],
 call:['Mời em {tên} trả lời. Câu hỏi số {số}.'],
 think:['Em hãy suy nghĩ thật kỹ trước khi trả lời nhé!'],
 correct:['Chính xác! {đáp án} Chúc mừng em {tên}! Em làm rất tốt!','Đúng rồi! {đáp án} Chúc mừng em {tên}! Em thật xuất sắc!','Rất chính xác! {đáp án} Chúc mừng em {tên}! Cả lớp cho bạn một tràng pháo tay nào!'],
 wrong:['Chưa chính xác rồi. {đáp án} Em cần cố gắng hơn nhé!','Rất tiếc, chưa đúng rồi. {đáp án} Không sao cả, lần sau em sẽ làm tốt hơn!','Chưa chính xác rồi. {đáp án} Em hãy ghi nhớ đáp án này nhé!'],
 fiveLeft:['Còn năm giây!'],timeUp:['Hết giờ! Mời em chọn đáp án.'],
 streak:['Đã có {chuỗi} bạn liên tiếp trả lời đúng. Cả lớp thật tuyệt vời!'],
 summary:['Cả lớp đã trả lời đúng {đúng} trên {tổng} câu hỏi. Cảm ơn các em đã tham gia, chúc các em học thật tốt!'],
 options:{maxNumber:20}}};

/* ---------- Thiết lập ---------- */
let settings={enabled:true,think:0,streak:true,pick:'rotate-race',strict:true};
function loadSettings(){
 try{const raw=JSON.parse(localStorage.getItem(SETTINGS_KEY)||'null');
  if(raw&&typeof raw==='object')settings={enabled:raw.enabled!==false,think:[0,10,15,20,30].includes(Number(raw.think))?Number(raw.think):0,
   streak:raw.streak!==false,pick:typeof raw.pick==='string'&&raw.pick?raw.pick:'rotate-race',strict:raw.strict!==false};
 }catch(_){}
}
function saveSettings(){try{localStorage.setItem(SETTINGS_KEY,JSON.stringify(settings))}catch(_){}}

/* ---------- Kho kịch bản + WAV câu dẫn ---------- */
let library={scripts:[],phrases:new Map(),loadedAt:0,status:'Chưa nạp kịch bản từ MotionClass.'},client=null,loading=null;
let lessonScript=null;const turnScript=new Map();
function activeScripts(){return library.scripts.filter(s=>s.isActive!==false)}
async function loadLibrary(force=false){
 if(loading)return loading;
 if(!force&&library.loadedAt&&Date.now()-library.loadedAt<LINK_TTL)return library;
 const store=S();if(!store)return library;
 loading=(async()=>{
  try{
   client=client||store.createClient();
   const {data:{session}}=await client.auth.getSession();
   if(!session?.user){library={scripts:[],phrases:new Map(),loadedAt:Date.now(),status:'Chưa đăng nhập MotionClass: dùng kịch bản mặc định, câu dẫn đọc bằng giọng dự phòng.'};return library}
   const [scripts,rows]=await Promise.all([store.listScripts(client),store.listPhraseAudio(client)]);
   const phrases=new Map();
   for(const r of rows){if(!r.url)continue;const k=store.norm(r.phrase);if(!phrases.has(k))phrases.set(k,new Map());phrases.get(k).set(r.voiceId,r.url)}
   library={scripts,phrases,loadedAt:Date.now(),status:'Đã nạp '+scripts.filter(s=>s.isActive!==false).length+' kịch bản đang bật · '+rows.length+' WAV câu dẫn.'};
  }catch(e){
   const msg=String(e?.message||e);
   library={...library,loadedAt:Date.now(),status:/does not exist|teacher_voice_scripts|teacher_phrase_audio/i.test(msg)?'Kho kịch bản chưa được kích hoạt trên MotionClass; đang dùng kịch bản mặc định.':'Chưa nạp được kịch bản: '+msg.slice(0,140)};
  }finally{loading=null;renderPicker()}
  return library;
 })();
 return loading;
}
function chooseFor(studentId,{newLesson=false}={}){
 const list=activeScripts();
 if(!list.length||settings.pick==='builtin')return BUILTIN;
 if(settings.pick.startsWith('id:'))return list.find(s=>'id:'+s.id===settings.pick)||list[0];
 if(settings.pick==='random-turn'){
  const prev=turnScript.get('last');let pick=list[Math.floor(Math.random()*list.length)];
  if(list.length>1&&pick.id===prev)pick=list[(list.indexOf(pick)+1)%list.length];
  turnScript.set('last',pick.id);turnScript.set(studentId,pick);return pick;
 }
 // rotate-race: đổi kịch bản mỗi cuộc đua (mỗi lần bắt đầu phần trả lời), lần lượt theo danh sách.
 if(newLesson||!lessonScript||!list.some(s=>s.id===lessonScript.id)){
  let i=0;try{i=(Number(localStorage.getItem(ROTATE_KEY))||0)%list.length;localStorage.setItem(ROTATE_KEY,String(i+1))}catch(_){}
  lessonScript=list[i];
 }
 return lessonScript;
}
function scriptFor(studentId){return(settings.pick==='random-turn'&&turnScript.get(studentId))||lessonScript||chooseFor(studentId)}
const lastPick=new Map();
function variant(script,key){
 const list=(script.slots?.[key]?.length?script.slots[key]:BUILTIN.slots[key])||[];
 if(list.length<2)return list[0]||'';
 const tag=script.id+':'+key;let i=Math.floor(Math.random()*list.length);
 if(i===lastPick.get(tag))i=(i+1)%list.length;lastPick.set(tag,i);return list[i];
}

/* ---------- Bộ đệm WAV trong bộ nhớ ----------
 * Tải trước (trong lúc bi đang chạy) và tải song song mọi đoạn của một lượt; phát từ Blob nên bắt đầu ngay,
 * không phải chờ mạng giữa các đoạn. Giới hạn số mục để không phình bộ nhớ. */
const MEDIA_MAX=260,media=new Map();
function fetchMedia(url){
 if(!url||typeof url!=='string')return Promise.resolve(null);
 if(media.has(url)){const t=media.get(url);media.delete(url);media.set(url,t);return t}
 const task=fetch(url).then(async res=>{
  if(!res.ok)throw Error('WAV chưa tải được');
  const blob=await res.blob();if(blob.size<45)throw Error('WAV rỗng');return blob;
 }).catch(e=>{media.delete(url);throw e});
 media.set(url,task);
 while(media.size>MEDIA_MAX)media.delete(media.keys().next().value);
 return task;
}
const quiet=p=>{p?.catch?.(()=>{});return p};

/* ---------- Trình phát tuần tự ---------- */
let run=0,currentAudio=null,currentUrl=null,thinkTimer=null,lastPlan=[];
const SILENT='data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=';
let unlocked=false;
function unlockAudio(){if(unlocked)return;unlocked=true;try{const a=new Audio(SILENT);a.volume=0;a.play().catch(()=>{unlocked=false})}catch(_){unlocked=false}}
document.addEventListener('pointerdown',unlockAudio,{passive:true});
document.addEventListener('keydown',unlockAudio,{passive:true});
function releaseAudio(){
 if(currentAudio){try{currentAudio.pause()}catch(_){}currentAudio.onended=currentAudio.onerror=null;currentAudio.removeAttribute('src');currentAudio=null}
 if(currentUrl){URL.revokeObjectURL(currentUrl);currentUrl=null}
}
function stopThinkTimer(){if(thinkTimer){clearInterval(thinkTimer);thinkTimer=null}const box=$('quizThinkTimer');if(box){box.hidden=true;box.classList.remove('urgent','over')}}
function stop(){run++;releaseAudio();stopThinkTimer();try{if('speechSynthesis' in window)speechSynthesis.cancel()}catch(_){}}
const wait=ms=>new Promise(r=>setTimeout(r,ms));
function playSource(src,token){
 return new Promise(resolve=>{
  if(token!==run)return resolve('stopped');
  releaseAudio();const h=hooks();const audio=new Audio();currentAudio=audio;
  audio.preload='auto';audio.volume=h?h.volume():1;
  if(src instanceof Blob){currentUrl=URL.createObjectURL(src);audio.src=currentUrl}else audio.src=src;
  let started=false,done=false;
  const finish=r=>{if(done)return;done=true;clearTimeout(guard);audio.onended=audio.onerror=audio.onplaying=null;resolve(r)};
  const guard=setTimeout(()=>{if(!started)finish('failed')},4500);// link hỏng/hết hạn không làm treo lượt hỏi
  audio.onplaying=()=>{started=true};audio.onended=()=>finish('ok');audio.onerror=()=>finish('failed');
  audio.play().then(()=>{started=true}).catch(()=>finish('failed'));
 });
}
function speakDevice(text,token){
 return new Promise(resolve=>{
  if(token!==run||!text)return resolve('stopped');
  if(!('speechSynthesis' in window)||!('SpeechSynthesisUtterance' in window))return resolve('unsupported');
  const h=hooks(),u=new SpeechSynthesisUtterance(text);u.lang='vi-VN';const voice=h?.deviceVoice?.();if(voice)u.voice=voice;
  u.rate=.92;u.pitch=.94;u.volume=h?h.volume():1;
  let done=false;const finish=r=>{if(done)return;done=true;clearTimeout(guard);resolve(r)};
  const guard=setTimeout(()=>finish('timeout'),1500+text.length*110);
  u.onend=()=>finish('ok');u.onerror=()=>finish('failed');
  try{speechSynthesis.speak(u)}catch(_){finish('failed')}
 });
}
async function resolvePrepared(text){
 const h=hooks();const cached=h?.cachedClip?.(text);if(cached)return{source:'prepared',media:cached};
 if(h?.nghiReady?.()){try{const blob=await Promise.race([h.nghiClip(text),wait(6000).then(()=>null)]);if(blob)return{source:'nghi',media:blob}}catch(_){}}
 return{source:'device',media:null};
}
async function resolve(seg){
 if(seg.url){
  try{const blob=await Promise.race([fetchMedia(seg.url),wait(5000).then(()=>null)]);if(blob)return{...seg,source:seg.urlSource||'saved',media:blob}}catch(_){}
  return{...seg,source:seg.urlSource||'saved',media:seg.url};
 }
 if(seg.loader){try{const blob=await Promise.race([seg.loader(),wait(4000).then(()=>null)]);if(blob)return{...seg,source:seg.urlSource||'saved',media:blob,fromLoader:true}}catch(_){}}
 return{...seg,...await resolvePrepared(seg.text)};
}
async function playPlan(plan,token){
 // Bắt đầu tải mọi đoạn cùng lúc, nhưng phát đoạn 1 ngay khi đoạn 1 sẵn sàng (không chờ cả lượt).
 const tasks=[];
 const push=seg=>tasks.push(resolve(seg).catch(()=>({...seg,source:'device',media:null})));
 const lazy=plan.filter(seg=>seg.lazy);
 for(const seg of plan)if(!seg.lazy)push(seg);
 // Đoạn "lazy" (câu hỏi): danh sách đoạn đến sau, nối vào cuối rồi tải song song.
 const lazyReady=Promise.all(lazy.map(l=>l.lazy.then(list=>{for(const seg of list)push(seg)}).catch(()=>{})));
 lazyReady.then(()=>Promise.all(tasks)).then(resolved=>{if(token===run){lastPlan=resolved.map(({kind,source,text})=>({kind,source,text}));reportMissing(resolved)}});
 for(let i=0;;i++){
  if(i>=tasks.length){await lazyReady;if(i>=tasks.length)break}
  const seg=await tasks[i];
  if(token!==run)return false;
  let result='failed';
  if(seg.media)result=await playSource(seg.media,token);
  if(token!==run)return false;
  if(result!=='ok'&&result!=='stopped'){
   if(seg.url||seg.fromLoader){const fb=await resolvePrepared(seg.text);if(fb.media)result=await playSource(fb.media,token)}
   if(result!=='ok'&&token===run)await speakDevice(seg.text,token);
  }
  if(token!==run)return false;
  await wait(seg.gap??120);
 }
 if(token===run){const resolved=await Promise.all(tasks);lastPlan=resolved.map(({kind,source,text})=>({kind,source,text}))}
 return token===run;
}

/** Chế độ một giọng: báo rõ đoạn nào chưa có WAV của giọng đang chọn. */
function reportMissing(resolved){
 const info=$('quizScriptVoiceGap');if(!info)return;
 const voice=hooks()?.preferredVoice?.()||'device';
 if(voice==='device'){info.hidden=true;return}
 const miss=resolved.filter(s=>s.source==='device'||s.source==='nghi');
 if(!miss.length){info.hidden=true;return}
 const kinds={name:'tên',phrase:'câu dẫn',question:'câu hỏi'};
 const parts=[...new Set(miss.map(s=>kinds[s.kind]||s.kind))].join(', ');
 info.hidden=false;info.textContent='⚠ Lượt vừa rồi có '+miss.length+' đoạn ('+parts+') chưa có WAV giọng '+voice+' nên đọc bằng giọng thiết bị. ';
 const a=document.createElement('a');a.href='/unified-voice/';a.target='_blank';a.rel='noopener';a.textContent='Tạo đủ ở trang Giọng thống nhất ↗';info.append(a);
}
/* ---------- Dữ liệu WAV ---------- */
/** Giáo viên chọn "Giọng thiết bị" thì mọi đoạn đều đọc bằng thiết bị, kể cả khi đã có WAV. */
const deviceOnly=()=>hooks()?.preferredVoice?.()==='device';
function phraseUrl(text){
 if(deviceOnly())return null;
 const store=S();const variants=library.phrases.get(store?store.norm(text):text);if(!variants)return null;
 const preferred=hooks()?.preferredVoice?.();
 if(settings.strict)return variants.get(preferred)||null;
 return variants.get(preferred)||[...variants.values()][0]||null;
}
function phraseSegment(text,gap){return{kind:'phrase',text,url:phraseUrl(text),urlSource:'saved-phrase',gap}}
function nameSegment(student){
 const voice=hooks()?.preferredVoice?.()||'device',api=window.MarbleNameAudio;
 // loadBlob kiểm tra RIFF/WAVE và dùng WAV giọng khác đã lưu khi thiếu đúng giọng.
 const loader=voice!=='device'&&api?.loadBlob?()=>api.loadBlob(student.id,voice,{strict:settings.strict}):null;
 const url=!loader&&voice!=='device'?api?.url?.(student.id,voice)||null:null;
 return{kind:'name',text:student.name,studentId:student.id,url,loader,urlSource:'saved-name',gap:160};
}
async function questionAudio(question){
 if(deviceOnly()||!question?.bankId||!window.MarbleSharedBankAudio?.urls)return new Map();
 try{const map=await Promise.race([window.MarbleSharedBankAudio.urls([question.bankId],{strict:settings.strict}),wait(2500).then(()=>null)]);return map?.get(question.bankId)||new Map()}
 catch(_){return new Map()}
}
function spokenParts(q){
 const h=hooks(),spoken=q.bankSpoken||{};
 return{full:h.questionText(q),answer:h.answerText(q),question:spoken.question,option_a:spoken.option_a,option_b:spoken.option_b,option_c:spoken.option_c,option_d:spoken.option_d};
}
/** Câu hỏi: ưu tiên 5 WAV lẻ (+ câu nhắc suy nghĩ của kịch bản), rồi WAV đọc cả câu
 *  (đã có câu "Em hãy suy nghĩ và lựa chọn một đáp án"), cuối cùng là văn bản. */
async function questionSegments(q,script){
 const h=hooks(),spoken=spokenParts(q),urls=await questionAudio(q);
 const has=part=>spoken[part]&&(urls.get(part)||h.cachedClip(spoken[part]));
 const seg=(part,gap)=>({kind:'question',part,text:spoken[part],url:urls.get(part)||null,urlSource:'saved-question',gap});
 const think=()=>templateSegments(variant(script,'think'),{});
 if(PARTS.every(has))return[...PARTS.map((p,i)=>seg(p,i?260:340)),...think()];
 if(has('full'))return[seg('full',220)];
 const plain=String(q.text||'').trim(),line=/[.!?]$/.test(plain)?plain:plain+'.';
 const opts=KEYS.map(k=>{const v=String(q.options?.[k]||'').trim();return'Phương án '+k+'. '+v+(/[.!?]$/.test(v)?'':'.')}).join(' ');
 return[{kind:'question',part:'text',text:line+' '+opts,gap:220},...think()];
}
async function answerSegment(q){
 const spoken=spokenParts(q),urls=await questionAudio(q);
 return{kind:'question',part:'answer',text:spoken.answer,url:urls.get('answer')||null,urlSource:'saved-question',gap:220};
}
/** Ghép một mẫu câu thành các đoạn phát. ctx: {student, number, streak, right, total, answer} */
function templateSegments(template,ctx){
 const store=S();if(!store||!template)return[];
 const out=[];
 for(const t of store.tokenize(template)){
  if(t.type==='text')out.push(phraseSegment(t.text,140));
  else if(t.type==='bound'){const v=t.key==='số'?ctx.number:ctx.streak;if(v!==undefined)out.push(phraseSegment(store.boundText(t,v),220))}
  else if(t.type==='name'&&ctx.student)out.push(nameSegment(ctx.student));
  else if(t.type==='answer'&&ctx.answer)out.push(ctx.answer);
  else if(t.type==='number'){const v=t.key==='đúng'?ctx.right:ctx.total;if(v!==undefined)out.push(phraseSegment(store.numberWords(v),90))}
 }
 return out;
}

/* ---------- Đếm giờ suy nghĩ ---------- */
function startThinkTimer(token,script){
 stopThinkTimer();const seconds=settings.think;if(!seconds)return;
 const box=$('quizThinkTimer');if(!box)return;
 let left=seconds;box.hidden=false;box.textContent='⏱ '+left+' giây suy nghĩ';
 thinkTimer=setInterval(()=>{
  if(token!==run){stopThinkTimer();return}
  left--;
  if(left>0){box.textContent='⏱ Còn '+left+' giây';box.classList.toggle('urgent',left<=5);
   if(left===5&&seconds>=10&&hooks()?.voiceOn())playPlan(templateSegments(variant(script,'fiveLeft'),{}),token);return}
  clearInterval(thinkTimer);thinkTimer=null;
  box.textContent='⏰ Hết giờ! Mời em chọn đáp án';box.classList.remove('urgent');box.classList.add('over');
  if(hooks()?.voiceOn())playPlan(templateSegments(variant(script,'timeUp'),{}),token);
 },1000);
}

/* ---------- Tải trước (trong lúc bi đang chạy) ----------
 * warm({questions,students}): nạp kho kịch bản, link WAV của mọi câu hỏi (1 lượt gọi), WAV tên mọi học sinh,
 * WAV câu dẫn của kịch bản có thể dùng, và WAV các phần của 2 câu hỏi đầu. Khi đọc câu n thì tải tiếp câu n+1, n+2. */
let warmState={questions:[],at:0};
async function pool(items,limit,fn){
 let i=0;const next=async()=>{while(i<items.length){const it=items[i++];try{await fn(it)}catch(_){}}};
 await Promise.all(Array.from({length:Math.min(limit,items.length)},next));
}
async function warmQuestions(list){
 const h=hooks();if(!h||deviceOnly())return;
 const ids=[...new Set(list.map(q=>q?.bankId).filter(Boolean))];if(!ids.length||!window.MarbleSharedBankAudio?.urls)return;
 let map;try{map=await window.MarbleSharedBankAudio.urls(ids,{strict:settings.strict})}catch(_){return}
 const urls=[];for(const id of ids)for(const u of(map?.get(id)||new Map()).values())urls.push(u);
 await pool(urls,4,u=>fetchMedia(u));
}
function scriptsInPlay(){
 const list=activeScripts();
 if(!list.length||settings.pick==='builtin')return[BUILTIN];
 if(settings.pick.startsWith('id:'))return[list.find(s=>'id:'+s.id===settings.pick)||list[0]];
 if(settings.pick==='random-turn')return list;
 // rotate-race: kịch bản của cuộc đua sắp tới (chưa đổi lượt luân phiên).
 let i=0;try{i=(Number(localStorage.getItem(ROTATE_KEY))||0)%list.length}catch(_){}
 return[list[i]];
}
async function warm({questions=[],students=[]}={}){
 const h=hooks(),store=S();if(!h||!settings.enabled)return{ok:false};
 warmState={questions:questions.slice(),at:Date.now()};
 if(deviceOnly())return{ok:true,device:true};
 const voice=h.preferredVoice?.();
 await Promise.race([loadLibrary(),wait(8000)]).catch(()=>{});
 const jobs=[];
 // Tên học sinh (nhỏ, ~50 KB mỗi em).
 if(voice&&voice!=='device'&&window.MarbleNameAudio?.loadBlob)
  jobs.push(pool(students,4,st=>window.MarbleNameAudio.loadBlob(st.id,voice,{strict:settings.strict})));
 // Câu dẫn: bỏ số thứ tự không dùng tới; giữ số của các câu sẽ hỏi và số chuỗi đúng.
 if(store){
  const nums=new Set(questions.map(q=>q?.num).filter(Boolean));
  const urls=new Set();
  for(const sc of scriptsInPlay())for(const p of store.scriptPhrases(sc)){
   if(p.number!==undefined&&p.slot!=='streak'&&!nums.has(p.number))continue;
   const u=phraseUrl(p.text);if(u)urls.add(u);
  }
  jobs.push(pool([...urls],4,u=>fetchMedia(u)));
 }
 // Link WAV mọi câu hỏi (một lượt gọi) + tải trước 2 câu đầu.
 jobs.push((async()=>{
  const ids=[...new Set(questions.map(q=>q?.bankId).filter(Boolean))];
  if(ids.length&&window.MarbleSharedBankAudio?.urls)try{await window.MarbleSharedBankAudio.urls(ids,{strict:settings.strict})}catch(_){}
  await warmQuestions(questions.slice(0,2));
 })());
 await Promise.all(jobs);
 return{ok:true,cached:media.size};
}
function warmAfter(question){
 const list=warmState.questions;if(!list.length)return;
 const i=list.indexOf(question);if(i<0)return;
 quiet(warmQuestions([list[(i+1)%list.length],list[(i+2)%list.length]]));
}

/* ---------- Kịch bản công khai ---------- */
async function call(student,question,{intro=false,force=false}={}){
 const h=hooks();if(!h||!student||!question)return false;
 h.stopGame();const token=++run;h.soundReady();
 // Kho kịch bản đã nạp sẵn (warm) thì không chờ; quá hạn thì làm mới ở nền. Chỉ lần đầu mới chờ tối đa 1,2 giây.
 if(library.loadedAt)quiet(loadLibrary());else await Promise.race([loadLibrary(),wait(1200)]).catch(()=>{});
 if(token!==run)return false;
 const script=intro?chooseFor(student.id,{newLesson:true}):(settings.pick==='random-turn'?chooseFor(student.id):scriptFor(student.id));
 renderPicker();
 if(!force&&!h.voiceOn()){startThinkTimer(token,script);return false}
 try{quiet(window.MarbleNameAudio?.refreshIfStale?.())}catch(_){}// làm mới ở nền, không chặn lượt gọi
 const plan=[];
 if(intro)plan.push(...templateSegments(variant(script,'intro'),{}));
 if(plan.length)plan[plan.length-1].gap=380;
 plan.push(...templateSegments(variant(script,'call'),{student,number:question.num}));
 if(plan.length)plan[plan.length-1].gap=320;
 // Lời dẫn + tên phát ngay; phần câu hỏi được lấy song song và nối vào khi sẵn sàng.
 const qTask=questionSegments(question,script);
 warmAfter(question);
 const finished=await playPlan([...plan,{kind:'lazy',lazy:qTask}],token);
 if(finished&&!force)startThinkTimer(token,script);
 return finished;
}
async function result(student,question,correct,{force=false}={}){
 const h=hooks();if(!h||!student||!question)return;
 h.stopGame();const token=++run;
 if(!force&&!h.voiceOn())return;
 const script=scriptFor(student.id);
 const answerTask=answerSegment(question);// lấy WAV đáp án song song với tiếng chuông
 await wait(correct?380:320);// để tiếng chuông đúng/sai kịp vang
 if(token!==run)return;
 const answer=await answerTask;
 const plan=templateSegments(variant(script,correct?'correct':'wrong'),{student,answer});
 if(settings.streak&&correct){
  const answers=h.answers?.()||[];let streak=0;
  for(let i=answers.length-1;i>=0&&answers[i].correct;i--)streak++;
  if(STREAK_MARKS.has(streak)){if(plan.length)plan[plan.length-1].gap=260;plan.push(...templateSegments(variant(script,'streak'),{streak}))}
 }
 if(token!==run)return;
 await playPlan(plan,token);
}
async function summary(right,total){
 const h=hooks();if(!h||!total)return;
 h.stopGame();const token=++run;if(!h.voiceOn())return;
 const script=lessonScript||chooseFor('summary');
 await wait(450);if(token!==run)return;
 await playPlan(templateSegments(variant(script,'summary'),{right,total}),token);
}
/** Đoạn câu dẫn để nút "Chuẩn bị" tạo trước — CHỈ khi dùng NGHI-TTS (miễn phí, trên thiết bị).
 *  Với Google AI Studio, câu dẫn được tạo theo lô ở trang Kịch bản để tiết kiệm lượt gọi. */
function prepTexts(questions,students){
 const store=S(),h=hooks();
 if(!settings.enabled||!store||h?.mode?.()!=='nghi')return[];
 const scripts=settings.pick==='builtin'||!activeScripts().length?[BUILTIN]:settings.pick.startsWith('id:')?[chooseFor('prep')]:activeScripts();
 const max=Math.max(1,...(questions||[]).map(q=>q.num||1));
 const list=[];
 for(const sc of scripts)for(const p of store.scriptPhrases({...sc,slots:{...sc.slots,options:{maxNumber:Math.min(max,sc.slots?.options?.maxNumber||20)}}}))if(!phraseUrl(p.text))list.push(p.text);
 for(const s of students||[])if(!window.MarbleNameAudio?.has?.(s.id))list.push(s.name);
 return list;
}

/* ---------- Giao diện ---------- */
function renderPicker(){
 const sel=$('quizScriptPick');if(!sel)return;
 const keep=settings.pick;sel.replaceChildren();
 sel.append(new Option('🔁 Đổi kịch bản mỗi cuộc đua','rotate-race'),new Option('🎲 Ngẫu nhiên mỗi lượt hỏi','random-turn'),new Option('Mặc định có sẵn','builtin'));
 for(const s of activeScripts())sel.append(new Option('📜 '+s.title,'id:'+s.id));
 sel.value=[...sel.options].some(o=>o.value===keep)?keep:'rotate-race';
 const now=lessonScript?' · Đang dùng: '+lessonScript.title:'';
 const info=$('quizScriptLibrary');if(info)info.textContent=library.status+now;
}
function injectUI(){
 const style=document.createElement('style');
 style.textContent='.quiz-think{margin:10px 0 0;padding:9px 14px;border-radius:14px;background:#eef3ff;border:2px solid #9fb6ea;color:#28407a;font-weight:950;font-size:clamp(14px,2vw,20px);text-align:center}'+
  '.quiz-think.urgent{background:#fff4d6;border-color:#f1b43c;color:#8a5200;animation:wrongShake .38s}.quiz-think.over{background:#ffe1e6;border-color:#f08da0;color:#a23250}'+
  '#quizScriptBox select{width:100%;padding:7px;border-radius:8px;color:#fff;background:#15386c;border:1px solid #678ac4}#quizScriptBox a{color:#8fe3ff}';
 document.head.appendChild(style);
 const feedback=$('quizFeedback');
 if(feedback&&!$('quizThinkTimer')){const t=document.createElement('div');t.id='quizThinkTimer';t.className='quiz-think';t.hidden=true;t.setAttribute('role','timer');t.setAttribute('aria-live','polite');feedback.after(t)}
 // Đặt ngay dưới khung "Chọn giọng đã lưu"; bản cũ dùng khung chuẩn bị giọng.
 const anchor=$('raceSavedAudioStatus')?.parentElement||$('aiPrepStatus');if(!anchor||$('quizScriptBox'))return;
 const box=document.createElement('div');box.id='quizScriptBox';box.style.cssText='margin-top:12px;padding-top:10px;border-top:1px dashed #4f72ad';
 box.innerHTML=
  '<div class="switchrow"><label for="quizScriptOn">🎬 Kịch bản lời dẫn: gọi tên → đọc câu hỏi → công bố kết quả</label><input class="switch" type="checkbox" id="quizScriptOn"></div>'+
  '<div class="field"><label for="quizScriptPick">📜 Kịch bản sử dụng</label><a href="/scripts/" target="_blank" rel="noopener">Quản lý ↗</a></div><select id="quizScriptPick"></select>'+
  '<div class="sub" id="quizScriptLibrary"></div>'+
  '<div class="field"><label for="quizThink">⏱ Thời gian suy nghĩ sau khi đọc câu hỏi</label><select id="quizThink" style="width:auto"><option value="0">Tắt</option><option value="10">10 giây</option><option value="15">15 giây</option><option value="20">20 giây</option><option value="30">30 giây</option></select></div>'+
  '<div class="switchrow"><label for="quizStreak">🔥 Khen cả lớp khi nhiều bạn đúng liên tiếp</label><input class="switch" type="checkbox" id="quizStreak"></div>'+
  '<div class="switchrow"><label for="quizStrict">🎯 Chỉ dùng một giọng (không lấy WAV giọng khác bù vào)</label><input class="switch" type="checkbox" id="quizStrict"></div>'+
  '<div class="sub" id="quizScriptVoiceGap" hidden style="color:#ffd99a"></div>'+
  '<div class="btnrow"><button class="btn fill" id="quizScriptPreview" type="button">▶ Nghe thử (đúng)</button><button class="btn fill" id="quizScriptPreviewWrong" type="button">▶ Thử (sai)</button><button class="btn" id="quizScriptReload" type="button" title="Nạp lại kịch bản và WAV">⟳</button></div>'+
  '<div class="sub" id="quizScriptInfo">Câu dẫn phát từ WAV đã tạo ở trang Kịch bản; tên và câu hỏi từ WAV đã lưu, theo giọng đang chọn ở trên. Thiếu đoạn nào sẽ đọc bằng giọng thiết bị. Không tự gọi Google AI Studio.</div>';
 anchor.after(box);
 $('quizScriptOn').checked=settings.enabled;$('quizThink').value=String(settings.think);$('quizStreak').checked=settings.streak;$('quizStrict').checked=settings.strict;
 $('quizStrict').onchange=()=>{settings.strict=$('quizStrict').checked;saveSettings();window.MarbleSharedBankAudio?.clear?.()};
 $('quizScriptOn').onchange=()=>{settings.enabled=$('quizScriptOn').checked;saveSettings();if(!settings.enabled)stop()};
 $('quizThink').onchange=()=>{settings.think=Number($('quizThink').value)||0;saveSettings()};
 $('quizStreak').onchange=()=>{settings.streak=$('quizStreak').checked;saveSettings()};
 $('quizScriptPick').onchange=()=>{settings.pick=$('quizScriptPick').value;lessonScript=null;turnScript.clear();saveSettings();renderPicker()};
 $('quizScriptReload').onclick=()=>{loadLibrary(true)};
 const preview=async correct=>{
  const sample=hooks()?.sample?.();
  if(!sample){$('quizScriptInfo').textContent='Hãy nạp danh sách học sinh và ít nhất một câu hỏi hợp lệ để nghe thử.';return}
  if(!await call(sample.student,sample.question,{force:true,intro:false}))return;
  await result(sample.student,sample.question,correct,{force:true});
  $('quizScriptInfo').textContent='Đã phát thử “'+(scriptFor(sample.student.id)?.title||'')+'”. Nguồn: '+describe(lastPlan)+'.';
 };
 $('quizScriptPreview').onclick=()=>{unlockAudio();preview(true)};
 $('quizScriptPreviewWrong').onclick=()=>{unlockAudio();preview(false)};
 renderPicker();
}
function describe(plan){
 const label={'phrase:saved-phrase':'câu dẫn từ WAV','name:saved-name':'tên từ WAV','question:saved-question':'câu hỏi/đáp án từ WAV',
  'phrase:prepared':'câu dẫn đã chuẩn bị','phrase:nghi':'câu dẫn bằng NGHI','phrase:device':'câu dẫn bằng giọng thiết bị',
  'name:device':'tên bằng giọng thiết bị','name:nghi':'tên bằng NGHI','question:device':'câu hỏi bằng giọng thiết bị','question:prepared':'câu hỏi đã chuẩn bị','question:nghi':'câu hỏi bằng NGHI'};
 return [...new Set(plan.map(x=>label[x.kind+':'+x.source]||x.kind+':'+x.source))].join(', ');
}

loadSettings();
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',injectUI);else injectUI();
window.addEventListener('focus',()=>{if(Date.now()-library.loadedAt>LINK_TTL)loadLibrary(true)});
setTimeout(()=>loadLibrary(),300);
window.MarbleQuizScript={
 enabled:()=>settings.enabled,call,result,summary,stop,prepTexts,reload:()=>loadLibrary(true),
 settings:()=>({...settings}),builtin:BUILTIN,warm,_mediaCache:()=>media.size,
 _lastPlan:()=>lastPlan.slice(),_library:()=>({scripts:library.scripts.map(s=>s.title),phrases:library.phrases.size,status:library.status}),
 _current:()=>lessonScript?.title||null,_setLibrary:(scripts,rows)=>{const store=S(),phrases=new Map();for(const r of rows){const k=store.norm(r.phrase);if(!phrases.has(k))phrases.set(k,new Map());phrases.get(k).set(r.voiceId,r.url)}library={scripts,phrases,loadedAt:Date.now()+864e5,status:'test'};renderPicker()}
};
})();
