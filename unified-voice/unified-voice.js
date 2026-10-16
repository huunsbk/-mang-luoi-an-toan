/* MotionClass · Giọng thống nhất (Microsoft NamMinh) cho tên học sinh, câu dẫn kịch bản và câu hỏi.
 * - Mỗi đoạn được tạo riêng qua /api/edge-tts (mã giáo viên), không tốn lượt Google, không cần cắt WAV dài.
 * - Trình duyệt đổi MP3 → WAV 24 kHz đơn kênh, bỏ khoảng lặng đầu/cuối, rồi giáo viên bấm Lưu.
 * - Chỉ tạo phần CÒN THIẾU của đúng giọng này; WAV các giọng khác không bị đụng tới.
 */
(function(){
'use strict';
const $=id=>document.getElementById(id);
const CS=window.TeacherClassroomStore,S=window.TeacherScriptStore,AUDIO=window.QuestionBatchAudio,cfg=window.POSE_QUIZ_SUPABASE;
const PARTS=['question','option_a','option_b','option_c','option_d','answer','full'];
const QS=new URLSearchParams(location.search),EMBED=QS.get('embed')==='1',SCOPE=String(QS.get('scope')||'all');
const SCOPE_CLASS=SCOPE.startsWith('class:')?SCOPE.slice(6):'',ONLY_NAMES=!!SCOPE_CLASS,ONLY_QUESTIONS=SCOPE==='questions';
const PIN_KEY='motionclass:uv-pin',CONSENT_KEY='motionclass:uv-consent',AUTOSAVE_KEY='motionclass:uv-autosave';
const store={get(k,area=localStorage){try{return area.getItem(k)}catch(_){return null}},set(k,v,area=localStorage){try{v==null?area.removeItem(k):area.setItem(k,v)}catch(_){}}};
/** Báo trang mẹ (nút "Tạo giọng ngay") trạng thái, chỉ khi đang nhúng cùng nguồn. */
function notifyParent(msg){if(EMBED&&window.parent!==window)try{window.parent.postMessage(msg,location.origin)}catch(_){}}
const CHUNK=8,ID_RE=/^[0-9a-f]{8}-[0-9a-f-]{27,}$/i;
const message=e=>{const m=String(e?.message||e||'Không rõ lỗi');return /Failed to fetch|NetworkError/i.test(m)?'Không kết nối được máy chủ. Kiểm tra Internet rồi thử lại.':m.slice(0,300)};
function tell(text,bad=false){const n=$('status');n.textContent=text;n.classList.toggle('error',bad)}
const el=(t,x,c)=>{const n=document.createElement(t);if(x!==undefined)n.textContent=x;if(c)n.className=c;return n};

let lastMissing=null,maxStudents=0,c=null,VOICE='edge:namminh-b1',classes=[],plan={names:[],phrases:[],questions:[],totals:{}},reviews=[],running=false,stopping=false,verified='';

/* ---------- Kết nối ---------- */
async function edgeInfo(){
 const r=await fetch('/api/edge-tts',{cache:'no-store'});const j=await r.json().catch(()=>({}));
 if(!r.ok||!j.configured)throw Error('Máy chủ chưa sẵn sàng tạo giọng Microsoft.');
 VOICE=j.voiceId;$('voiceId').textContent=VOICE;
}
async function bankApi(action,body){
 const {data:{session}}=await c.auth.getSession();if(!session)throw Error('Phiên đăng nhập đã hết hạn, hãy đăng nhập lại.');
 const isForm=body instanceof FormData;
 const res=await fetch(cfg.url+'/functions/v1/shared-question-api',{method:'POST',
  headers:{Authorization:'Bearer '+session.access_token,apikey:cfg.publishableKey,...(isForm?{}:{'Content-Type':'application/json'})},
  body:isForm?body:JSON.stringify({action,...body})});
 const j=await res.json().catch(()=>({}));
 if(!res.ok||!j.ok)throw Error(j.error||('Ngân hàng câu hỏi lỗi '+res.status));
 return j;
}
async function sha256Raw(text){
 const b=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text));
 return Array.from(new Uint8Array(b),x=>x.toString(16).padStart(2,'0')).join('');
}

/* ---------- Đếm phần còn thiếu ---------- */
async function loadNames(){
 const pick=$('classPick').value;
 const ids=pick==='*'?classes.map(x=>x.id):pick?[pick]:[];
 const need=[];let total=0;
 for(const classId of ids){
  const cls=classes.find(x=>x.id===classId);
  const [students,voices]=await Promise.all([CS.listStudents(c,classId),CS.listStudentNameVoices(c,classId)]);
  const active=students.filter(s=>s.active!==false);total+=active.length;
  for(const s of active){
   const hash=await CS.studentNameHash(s.name);
   if(!voices.some(v=>v.studentId===s.id&&v.voiceId===VOICE&&v.nameHash===hash))
    need.push({kind:'name',classId,studentId:s.id,nameHash:hash,text:S.norm(s.name),style:'neutral',label:'Tên · '+(ids.length>1&&cls?cls.name+' · ':'')+s.name});
  }
 }
 return{need,total,students:total};
}
/** Mọi kịch bản (kể cả đang tắt, để bật lên là có giọng ngay) + kịch bản dựng sẵn
 *  (Đua bi dùng khi chưa có kịch bản và lấy mục còn trống từ đây). Số đọc đến số câu hỏi/học sinh thực tế. */
async function loadPhrases(maxNumber){
 const scripts=[...(await S.listScripts(c)),...(S.BUILTIN?[S.BUILTIN]:[])];
 const all=new Map();
 for(const sc of scripts)for(const p of S.scriptPhrases(sc,{maxNumber:Math.max(maxNumber,sc.slots?.options?.maxNumber||20),scoreNumbers:true}))if(!all.has(p.text))all.set(p.text,p);
 const have=new Set((await S.listPhraseAudio(c,{voiceId:VOICE,sign:false})).map(r=>S.norm(r.phrase)));
 const need=[...all.values()].filter(p=>!have.has(p.text)).map(p=>({kind:'phrase',text:p.text,style:p.style||'neutral',label:'Câu dẫn · '+p.text}));
 return{need,total:all.size,scripts:scripts.length};
}
async function loadQuestions(){
 const items=[];let offset=0;
 do{const r=await bankApi('bank.list',{limit:250,offset});items.push(...r.items);offset=r.nextOffset}while(offset!=null&&items.length<2000);
 const own=items.filter(q=>q.owned&&ID_RE.test(q.id)&&q.spoken);
 const current=new Set();
 for(let i=0;i<own.length;i+=100){
  const r=await bankApi('audio.overview',{ids:own.slice(i,i+100).map(q=>q.id)});
  for(const a of r.items||[])if(a.current&&a.voiceId===VOICE)current.add(a.id+'/'+a.part);
 }
 const need=[];
 for(const q of own)for(const part of PARTS){
  const text=q.spoken?.[part];if(!text||current.has(q.id+'/'+part))continue;
  need.push({kind:'question',questionId:q.id,part,text,style:'neutral',label:'Câu hỏi · '+q.text.slice(0,60)+' · '+part});
 }
 return{need,total:own.length*PARTS.length,questions:own.length,others:items.length-own.length,bankSize:items.length};
}
function showCover(key,have,total){
 $('c'+key).textContent=total?have+'/'+total:'0';
 $('b'+key).style.width=(total?Math.round(have/total*100):0)+'%';
}
async function refresh(){
 if(running)return;
 tell('⏳ Đang kiểm tra những phần còn thiếu với giọng '+VOICE+'...');
 try{
  const none={need:[],total:0,students:0,questions:0,others:0,bankSize:0};
  const [n,q]=await Promise.all([ONLY_QUESTIONS?none:loadNames(),ONLY_NAMES?none:loadQuestions()]);
  // Số thứ tự câu hỏi và điểm cuối giờ: đủ tới số câu trong ngân hàng / số học sinh lớn nhất.
  const p=await loadPhrases(Math.min(99,Math.max(20,q.bankSize,n.students,maxStudents)));
  plan={names:n.need,phrases:p.need,questions:q.need,totals:{n,p,q}};
  showCover('Names',n.total-n.need.length,n.total);
  showCover('Phrases',p.total-p.need.length,p.total);
  showCover('Questions',q.total-q.need.length,q.total);
  const missing=n.need.length+p.need.length+q.need.length;
  $('genStart').disabled=!missing;
  $('genStart').textContent=missing?'⚡ Tạo đủ '+missing+' đoạn còn thiếu':'✅ Đã đủ giọng thống nhất';
  lastMissing=missing;
  tell(missing?'Còn thiếu: '+[ONLY_QUESTIONS?'':n.need.length+' tên',p.need.length+' câu dẫn ('+(p.scripts-(S.BUILTIN?1:0))+' kịch bản + mặc định)',ONLY_NAMES?'':q.need.length+' phần câu hỏi ('+q.questions+' câu của bạn)'].filter(Boolean).join(' · ')+'.'+(q.others?' '+q.others+' câu của người khác không thể lưu giọng.':'')
   :'✅ Tên học sinh, câu dẫn và câu hỏi đều đã có giọng '+VOICE+'.');
 }catch(e){tell('⚠ '+message(e),true)}
}

/* ---------- MP3 → WAV (bỏ khoảng lặng) ---------- */
let decodeCtx=null;
function ctx(){
 if(decodeCtx)return decodeCtx;
 const A=window.AudioContext||window.webkitAudioContext;if(!A)throw Error('Trình duyệt chưa hỗ trợ xử lý âm thanh.');
 try{decodeCtx=new A({sampleRate:24000})}catch(_){decodeCtx=new A()}
 return decodeCtx;
}
async function mp3ToWav(b64){
 const bytes=Uint8Array.from(atob(b64),ch=>ch.charCodeAt(0));
 const buf=await ctx().decodeAudioData(bytes.buffer.slice(0));
 const ch=[...Array(buf.numberOfChannels)].map((_,i)=>buf.getChannelData(i)),d=ch[0],rate=buf.sampleRate;
 let a=0,b=d.length-1;const th=0.012;
 while(a<b&&Math.abs(d[a])<th)a++;while(b>a&&Math.abs(d[b])<th)b--;
 const start=Math.max(0,a/rate-0.04),end=Math.min(buf.duration,b/rate+0.08);
 const wav=AUDIO.wavPCM(ch,rate,start,Math.max(end,start+0.2));
 return{blob:wav,seconds:end-start};
}

/* ---------- Tạo giọng ---------- */
async function verifyPin(pin){
 if(verified===pin)return;
 const r=await fetch('/api/edge-tts',{method:'POST',headers:{'Content-Type':'application/json','X-Marble-Teacher-Code':pin},body:JSON.stringify({verifyOnly:true})});
 const j=await r.json().catch(()=>({}));
 if(!r.ok||!j.verified)throw Error(j.error||'Mã giáo viên chưa đúng.');
 verified=pin;
}
async function generate(){
 if(running)return;
 const pin=$('pin').value;
 if(!pin.trim())return tell('Hãy nhập mã giáo viên (MARBLE_TTS_PIN).',true);
 const jobs=[...plan.names,...plan.phrases,...plan.questions];
 if(!jobs.length)return;
 if(plan.names.length&&!$('consent').checked)return tell('Hãy tích ô đồng ý gửi họ tên học sinh tới Microsoft trước khi tạo.',true);
 running=true;stopping=false;$('genStart').disabled=true;$('genStop').disabled=false;$('refresh').disabled=true;
 let done=0,failed=0;
 try{
  await verifyPin(pin);
  store.set(PIN_KEY,$('rememberPin').checked?pin:null,sessionStorage);
  if($('consent').checked)store.set(CONSENT_KEY,'1');
  for(let i=0;i<jobs.length&&!stopping;i+=CHUNK){
   const chunk=jobs.slice(i,i+CHUNK);
   tell('🎙️ Đang tạo '+(i+1)+'–'+(i+chunk.length)+' / '+jobs.length+' đoạn...');
   const res=await fetch('/api/edge-tts',{method:'POST',headers:{'Content-Type':'application/json','X-Marble-Teacher-Code':pin},
    body:JSON.stringify({items:chunk.map(j=>({text:j.text,style:j.style}))})});
   const body=await res.json().catch(()=>({}));
   if(!res.ok)throw Error(body.error||('Máy chủ giọng đọc lỗi '+res.status));
   for(let k=0;k<chunk.length;k++){
    const r=body.items?.[k];
    if(!r?.ok){failed++;continue}
    try{const w=await mp3ToWav(r.audio);addReview(chunk[k],w)}catch(_){failed++}
   }
   done+=chunk.length;$('prog').style.width=Math.round(done/jobs.length*100)+'%';
  }
  tell((stopping?'⏹ Đã dừng. ':'✅ ')+'Đã tạo '+reviews.length+' đoạn'+(failed?', '+failed+' đoạn lỗi (bấm Kiểm tra lại rồi tạo tiếp)':'')+'. Nghe nhanh rồi bấm “Lưu các đoạn đã chọn”.',failed>0&&!reviews.length);
 }catch(e){tell('⚠ '+message(e)+(reviews.length?' · '+reviews.length+' đoạn đã tạo vẫn ở danh sách nghe duyệt.':''),true)}
 finally{running=false;$('genStop').disabled=true;$('refresh').disabled=false;$('genStart').disabled=false;notifyParent({type:'motionclass:uv-state',pending:reviews.length})}
 // Giọng Microsoft (không tốn lượt Google): nếu giáo viên bật "Tạo xong tự lưu" thì lưu luôn, không qua bước nghe.
 if(!stopping&&reviews.length&&$('autoSave').checked)await saveAll();
}
function addReview(job,{blob,seconds}){
 $('reviewPanel').hidden=false;
 const row=el('div',undefined,'item'),cb=el('input');cb.type='checkbox';cb.checked=true;cb.style.width='auto';
 const au=el('audio');au.controls=true;au.preload='none';const url=URL.createObjectURL(blob);au.src=url;
 row.append(cb,el('span',job.label+' · '+seconds.toFixed(1)+' giây'),el('span',job.style,'tag '+job.style),au);
 $('reviewList').append(row);
 reviews.push({job,blob,row,cb,au,url});
}
async function saveAll(){
 const chosen=reviews.filter(r=>r.cb.checked);if(!chosen.length||running)return;
 running=true;$('saveAll').disabled=true;let saved=0,errors=0,lastErr='',summary='';
 try{
  for(const r of chosen){
   const j=r.job;
   try{
    if(j.kind==='name')await CS.saveStudentNameVoice(c,{classId:j.classId,studentId:j.studentId,voiceId:VOICE,nameHash:j.nameHash,blob:r.blob});
    else if(j.kind==='phrase')await S.savePhraseAudio(c,{voiceId:VOICE,phrase:j.text,blob:r.blob});
    else{
     const form=new FormData();form.set('action','audio.put');form.set('id',j.questionId);form.set('part',j.part);form.set('voice_id',VOICE);
     form.set('expected_text_hash',await sha256Raw(j.text));form.set('audio',new File([r.blob],j.part+'.wav',{type:'audio/wav'}));
     await bankApi(null,form);
    }
    saved++;r.row.remove();URL.revokeObjectURL(r.url);reviews=reviews.filter(x=>x!==r);
   }catch(e){errors++;lastErr=message(e);r.row.style.background='#fff0f0'}
   tell('☁ Đã lưu '+saved+'/'+chosen.length+'...');$('prog').style.width=Math.round(saved/chosen.length*100)+'%';
  }
  try{localStorage.setItem('motionclass:shared-bank-sync',JSON.stringify({at:Date.now(),change:'audio.put',source:'unified-voice'}))}catch(_){}
  summary='✅ Đã lưu '+saved+' đoạn giọng '+VOICE+'.'+(errors?' ⚠ '+errors+' đoạn lỗi: '+lastErr:'');
 }finally{
  running=false;$('saveAll').disabled=false;if(!reviews.length)$('reviewPanel').hidden=true;
  await refresh();
  // Kết quả lưu hiện sau cùng để không bị dòng kiểm tra độ phủ che mất.
  if(summary)tell(summary+' '+$('status').textContent.replace(/^✅\s*/,''),errors>0);
  notifyParent({type:'motionclass:uv-state',pending:reviews.length});
  if(summary)notifyParent({type:'motionclass:uv-done',saved,errors,missing:lastMissing});
 }
}
let playRun=0;
$('playAll').onclick=async()=>{
 const t=++playRun;
 for(const r of reviews){if(t!==playRun)return;if(!r.cb.checked)continue;r.row.scrollIntoView({block:'nearest'});
  await new Promise(done=>{const end=()=>{r.au.onended=r.au.onerror=null;done()};r.au.onended=r.au.onerror=end;r.au.currentTime=0;r.au.play().catch(end)})}
};

/* ---------- Khởi động ---------- */
async function enter(user){
 $('loginPanel').hidden=true;$('appPanel').hidden=false;$('userEmail').textContent=user.email||'';
 try{
  await edgeInfo();
  classes=await CS.listClasses(c);
  const sel=$('classPick');sel.replaceChildren(...(classes.length?[new Option('Tất cả lớp ('+classes.length+')','*'),...classes.map(x=>new Option(x.name+(x.school_year?' · '+x.school_year:''),x.id))]:[new Option('— Chưa có lớp —','')]));
  if(SCOPE_CLASS&&classes.some(x=>x.id===SCOPE_CLASS)){sel.value=SCOPE_CLASS;sel.disabled=true}
  else try{const last=localStorage.getItem('motionclass:unified-voice-class');if(last==='*'||classes.some(x=>x.id===last))sel.value=last}catch(_){}
  maxStudents=0;for(const x of classes){try{maxStudents=Math.max(maxStudents,(await CS.listStudents(c,x.id)).filter(s=>s.active!==false).length)}catch(_){}}
  await refresh();
  // Mở từ nút "Tạo giọng ngay": đã nhớ mã + đã đồng ý + bật tự lưu → chạy luôn, giáo viên không phải bấm thêm.
  if(EMBED&&lastMissing>0&&$('pin').value&&$('autoSave').checked&&(!plan.names.length||$('consent').checked)){tell('⚡ Đang tạo '+lastMissing+' đoạn còn thiếu...');await generate()}
 }catch(e){tell('⚠ '+message(e),true)}
}
$('pin').value=store.get(PIN_KEY,sessionStorage)||'';$('rememberPin').checked=!!$('pin').value||store.get(PIN_KEY+':on')==='1';
$('consent').checked=store.get(CONSENT_KEY)==='1';
$('autoSave').checked=store.get(AUTOSAVE_KEY)!=='0';
$('rememberPin').onchange=()=>{store.set(PIN_KEY+':on',$('rememberPin').checked?'1':'0');if(!$('rememberPin').checked)store.set(PIN_KEY,null,sessionStorage)};
$('autoSave').onchange=()=>store.set(AUTOSAVE_KEY,$('autoSave').checked?'1':'0');
$('consent').onchange=()=>store.set(CONSENT_KEY,$('consent').checked?'1':null);
if(EMBED)document.body.classList.add('embed');
$('cardQuestions').hidden=ONLY_NAMES;$('cardNames').hidden=ONLY_QUESTIONS;
$('classPick').onchange=()=>{if(SCOPE_CLASS)return;try{localStorage.setItem('motionclass:unified-voice-class',$('classPick').value)}catch(_){}refresh()};
$('refresh').onclick=refresh;
$('genStart').onclick=generate;
$('genStop').onclick=()=>{stopping=true;tell('Sẽ dừng sau nhóm hiện tại.')};
$('saveAll').onclick=saveAll;
$('loginForm').onsubmit=async e=>{
 e.preventDefault();tell('');$('loginStatus').textContent='Đang đăng nhập...';
 const {data,error}=await c.auth.signInWithPassword({email:$('loginEmail').value.trim(),password:$('loginPass').value});
 $('loginPass').value='';
 if(error){$('loginStatus').textContent='⚠ '+error.message;$('loginStatus').classList.add('error');return}
 await enter(data.user);
};
$('logoutButton').onclick=async()=>{if(reviews.length&&!confirm('Còn đoạn chưa lưu. Vẫn đăng xuất?'))return;await c.auth.signOut();location.reload()};
window.addEventListener('beforeunload',e=>{if(reviews.length){e.preventDefault();e.returnValue=''}});
window.addEventListener('unhandledrejection',e=>tell('⚠ '+message(e.reason),true));
window.__unifiedVoiceTest={state:()=>({embed:EMBED,scope:SCOPE,missing:lastMissing,voice:VOICE,plan:{names:plan.names.length,phrases:plan.phrases.length,questions:plan.questions.length},reviews:reviews.length,running})};
(async()=>{
 try{c=CS.createClient()}catch(e){$('loginStatus').textContent='⚠ '+message(e);return}
 const {data:{session}}=await c.auth.getSession();
 if(session?.user)await enter(session.user);
})();
})();
