/* MotionClass classroom audio: 20 teacher-selected questions, quota-aware Gemini, consent-based NGHI fallback. */
(function(){
'use strict';
const BASE=['question','option_a','option_b','option_c','option_d'];
const PARTS=[...BASE,'answer','full'],PRE='Đáp án đúng là',POST='Em hãy suy nghĩ và lựa chọn một đáp án.';
const Q_CAP=20,GROUP_CAP=14,CHAR_CAP=850,DURATION_CAP=58,MIN_GAP=22500,DAILY_CAP=10;
const $=id=>document.getElementById(id),key=(id,part)=>id+'|'+part;
const err=e=>String(e?.message||e||'Lỗi chưa rõ').slice(0,300);
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
function plan(entries){
 const groups=[],dropped=[];
 for(const entry of entries){
  if(entry.text.length>CHAR_CAP){dropped.push(entry);continue}
  const cost=entry.text.length+5;
  let g=groups[groups.length-1];
  if(!g||g.entries.length>=GROUP_CAP||g.text.length+cost>CHAR_CAP||
     (g.text.length+cost)*.068+g.entries.length*.65>DURATION_CAP){
    g={entries:[],text:'',done:false,error:null};groups.push(g);
  }
  g.entries.push(entry);g.text+=(g.text?'\n\n\n\n':'')+entry.text;
 }
 return {groups,dropped};
}
function pacificDay(){
 return new Intl.DateTimeFormat('en-CA',{timeZone:'America/Los_Angeles',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
}
function getItem(k){try{return localStorage.getItem(k)}catch(_){return null}}
function putItem(k,v){try{localStorage.setItem(k,String(v))}catch(_){}}
const quotaKey=()=> 'motionclass:classroom20:requests:'+pacificDay();
function openDB(){
 return new Promise((resolve,reject)=>{
  if(!window.indexedDB)return reject(Error('Không có IndexedDB'));
  const request=window.indexedDB.open('motionclass-classroom20-wav-v1',1);
  request.onupgradeneeded=()=>{if(!request.result.objectStoreNames.contains('clips'))request.result.createObjectStore('clips')};
  request.onsuccess=()=>resolve(request.result);
  request.onerror=()=>reject(request.error);
 });
}
async function cacheGet(k){
 try{const db=await openDB(),value=await new Promise((resolve,reject)=>{
  const r=db.transaction('clips','readonly').objectStore('clips').get(k);
  r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);
 });db.close();return value&&Date.now()-value.created<86400000?value.blob:null}catch(_){return null}
}
async function cachePut(k,blob){
 try{const db=await openDB();await new Promise((resolve,reject)=>{
  const t=db.transaction('clips','readwrite');t.objectStore('clips').put({blob,created:Date.now()},k);
  t.oncomplete=resolve;t.onerror=()=>reject(t.error);
 });db.close()}catch(_){}
}
async function stitch(blobs,pauseSeconds=.18){
 const Audio=window.AudioContext||window.webkitAudioContext;
 if(!Audio)throw Error('Thiết bị không hỗ trợ Web Audio.');
 const context=new Audio({sampleRate:24000});
 try{
  const clips=[];
  for(const blob of blobs){
   const buffer=await context.decodeAudioData(await blob.arrayBuffer());
   const pcm=buffer.getChannelData(0),ratio=buffer.sampleRate/24000;
   const count=Math.max(1,Math.floor(pcm.length/ratio)),out=new Float32Array(count);
   for(let i=0;i<count;i++){const s=i*ratio,j=Math.floor(s),f=s-j;
    out[i]=(pcm[j]||0)*(1-f)+(pcm[Math.min(j+1,pcm.length-1)]||0)*f}
   clips.push(out);
  }
  const silence=Math.round(pauseSeconds*24000);
  const length=clips.reduce((s,c)=>s+c.length,0)+Math.max(0,clips.length-1)*silence;
  if(length<24000*.2||length*2+44>5*1024*1024)throw Error('WAV ghép vượt mức 5 MB cho phép.');
  const combined=new Float32Array(length);let at=0;
  for(const clip of clips){combined.set(clip,at);at+=clip.length+silence}
  return window.QuestionBatchAudio.wavPCM([combined],24000,0,length/24000);
 }finally{await context.close().catch(()=>{})}
}
function create(ctx){
 let working=false,stop=false,voice='',rows=[],pending=[],groups=[],urls=[];
 let existing=new Map(),localWavs=new Map(),hashes=new Map(),derivativeAdded=new Set();
 function status(text,bad=false){const el=$('classroom20Status');el.textContent=text;el.classList.toggle('error',bad)}
 function buttons(){
  $('classroom20Start').disabled=working;
  $('classroom20Stop').disabled=!working;
  $('classroom20Save').disabled=working||!pending.some(x=>x.approved&&x.listened);
  $('classroom20Fallback').disabled=working||!rows.length;
 }
 function reset(){
  urls.forEach(u=>URL.revokeObjectURL(u));urls=[];
  $('classroom20Plan').replaceChildren();$('classroom20Reviews').replaceChildren();
  rows=[];pending=[];groups=[];existing=new Map();localWavs=new Map();hashes=new Map();derivativeAdded=new Set();verifiedPin=null;
 }
 function showReview(entry,blob,quality){
  const item={entry,blob,approved:false,listened:false};
  const shell=document.createElement('div');shell.className='batch-review';
  const title=document.createElement('h3');title.textContent=entry.question.slice(0,80)+' · '+entry.part;
  const content=document.createElement('p');content.className='batch-text';content.textContent=entry.text;
  const hint=document.createElement('p');hint.className='batch-quality '+(quality==='candidate'?'ready':'warning');
  hint.textContent=quality==='candidate'?'Nghe đến hết để kiểm tra lời đọc.':'⚠ Điểm cắt chưa chắc chắn. Hãy nghe kỹ, không duyệt nếu mất chữ.';
  const audio=document.createElement('audio');audio.controls=true;audio.preload='none';
  const objectUrl=URL.createObjectURL(blob);urls.push(objectUrl);audio.src=objectUrl;
  const label=document.createElement('label');label.className='control-label';
  const check=document.createElement('input');check.type='checkbox';check.disabled=true;
  label.append(check,document.createTextNode(' Tôi đã nghe trọn và duyệt WAV này'));
  audio.onended=()=>{item.listened=true;check.disabled=false};
  check.onchange=()=>{item.approved=item.listened&&check.checked;buttons()};
  shell.append(title,content,hint,audio,label);
  item.node=shell;pending.push(item);$('classroom20Reviews').append(shell);buttons();
 }
 async function audioList(ids,provider){
  let result=[];for(let i=0;i<ids.length;i+=60){
   const response=await ctx.api('audio.list',{ids:ids.slice(i,i+60),voice_id:provider});
   result.push(...(response.items||[]));
  }return result;
 }
 async function analyze(){
  const chosen=ctx.selectedQuestions();
  if(!chosen.length||chosen.length>Q_CAP)throw Error('Hãy tích chọn từ 1 đến 20 câu hỏi của mình ở phía trên.');
  if(chosen.some(row=>!row.owned))throw Error('Chỉ được tạo giọng cho câu hỏi thuộc quyền sở hữu.');
  rows=[...chosen];
  const check=await ctx.studioCheck();
  if(!check.configured||!/^[a-f0-9]{16}$/.test(check.voiceVersion))
   throw Error('Google AI Studio chưa sẵn sàng; có thể chọn NGHI sau khi xác nhận.');
  voice='studio:'+check.voiceVersion;
  for(const q of rows)for(const part of PARTS){
   if(q.spoken?.[part])hashes.set(key(q.id,part),await ctx.hash(q.spoken[part]));
  }
  const list=await audioList(rows.map(q=>q.id),voice);
  const valid=new Set(rows.map(q=>q.id));
  for(const item of list)if(valid.has(item.id)&&hashes.get(key(item.id,item.part))===item.textHash)
   existing.set(key(item.id,item.part),item);
  const entries=[];let pre=false,post=false;
  for(const q of rows){
   for(const part of BASE)if(!existing.has(key(q.id,part))&&q.spoken?.[part])
    entries.push({id:q.id,part,text:q.spoken[part],question:q.text,hash:hashes.get(key(q.id,part))});
   if(!existing.has(key(q.id,'answer')))pre=true;
   if(!existing.has(key(q.id,'full')))post=true;
  }
  if(pre)entries.unshift({id:'_shared',part:'prefix',text:PRE,question:'Lời dẫn công bố đáp án'});
  if(post)entries.unshift({id:'_shared',part:'suffix',text:POST,question:'Lời kết toàn câu'});
  const output=plan(entries);if(output.dropped.length)
   throw Error(output.dropped.length+' đoạn vượt giới hạn một lượt; cần rút ngắn nội dung hoặc dùng NGHI.');
  groups=output.groups;
  const summary=document.createElement('p');summary.textContent=rows.length+' câu · '+existing.size+
   ' WAV Google đã có · '+entries.length+' đoạn cần đọc (đã loại lời đọc trùng) · '+groups.length+
   ' lượt Google dự kiến · ngân sách trình duyệt ghi nhận còn '+Math.max(0,DAILY_CAP-(Number(getItem(quotaKey()))||0))+'/'+DAILY_CAP+' lượt.';
  $('classroom20Plan').append(summary);
  for(let i=0;i<groups.length;i++){
   const div=document.createElement('p');div.className='batch-job';
   div.textContent='Lô '+(i+1)+': '+groups[i].entries.length+' đoạn / '+groups[i].text.length+' ký tự';
   $('classroom20Plan').append(div);
  }
 }
 async function waitSlot(){
  const k='motionclass:classroom20:last-request';
  let remain=Math.max(0,MIN_GAP-(Date.now()-(Number(getItem(k))||0)));
  while(remain>0){
   if(stop)throw Error('Đã dừng theo yêu cầu.');
   status('Chờ '+Math.ceil(remain/1000)+' giây trước lượt Google tiếp theo (giới hạn RPM)…');
   await sleep(Math.min(remain,900));
   remain=Math.max(0,MIN_GAP-(Date.now()-(Number(getItem(k))||0)));
  }
 }
 let verifiedPin=null;
 async function verifyTeacherPin(pin){
  if(verifiedPin===pin)return;
  const response=await fetch('/api/marble-tts',{method:'POST',
   headers:{'Content-Type':'application/json','X-Marble-Teacher-Code':pin},
   body:JSON.stringify({verifyOnly:true})});
  const body=await response.json().catch(()=>({}));
  if(!response.ok||body.verified!==true){
   const message=response.status===403
    ?(body.code==='INVALID_ORIGIN'
      ?'Nguồn yêu cầu bị từ chối. Vui lòng mở đúng giaovien-psi.vercel.app.'
      :'Mã giáo viên chưa đúng. Nhập chính xác MARBLE_TTS_PIN trong cấu hình Vercel, không nhập Gemini API key. Không tốn lượt Google.')
    :(body.error||'Không kiểm tra được mã giáo viên (HTTP '+response.status+').');
   throw Object.assign(Error(message),{status:response.status,code:body.code});
  }
  verifiedPin=pin;
 }
 async function createGroup(group){
  const cacheKey='speech-'+await ctx.hash(voice+'|'+group.entries.map(x=>key(x.id,x.part)+':'+x.text).join('|'));
  let blob=await cacheGet(cacheKey);
  if(!blob){
   if((Number(getItem(quotaKey()))||0)>=DAILY_CAP)
    throw Object.assign(Error('Đã ghi nhận đủ 10 lượt trên trình duyệt hôm nay. Chọn NGHI-TTS.'),{status:429});
   const field=$('classroom20TeacherPin');
   // Copy once for convenience. The dedicated input remains editable after a 403.
   if(!field.value){
    const fromBatch=$('batchTeacherPin')?.value||'';
    const fromStudio=$('studioTeacherPin')?.value||'';
    field.value=fromBatch||fromStudio;
   }
   // The teacher PIN is an exact secret: only trim to check emptiness, never
   // alter bytes of X-Marble-Teacher-Code (the old one-click flow did).
   const pin=field.value;
   if(!pin.trim())throw Error('Hãy nhập mã giáo viên MARBLE_TTS_PIN vào ô ngay trên nút tạo 20 câu. Đây không phải khóa Gemini API.');
   await verifyTeacherPin(pin);
   await waitSlot();if(stop)throw Error('Đã dừng.');
   const previousQuota=Number(getItem(quotaKey()))||0;
   const lastKey='motionclass:classroom20:last-request';
   const previousLast=getItem(lastKey);
   const sentAt=Date.now();
   putItem(quotaKey(),previousQuota+1);
   putItem(lastKey,sentAt);
   const response=await fetch('/api/marble-tts',{method:'POST',
    headers:{'Content-Type':'application/json','X-Marble-Teacher-Code':pin},
    body:JSON.stringify({text:group.text,batch:true,classroom20:true})});
   if(!response.ok){
    const body=await response.json().catch(()=>({}));
    // These status codes are rejected by our proxy before contacting Gemini.
    // They must not consume the local daily allowance or RPM waiting slot.
    if([400,401,403,413,422].includes(response.status)){
     if(Number(getItem(quotaKey()))===previousQuota+1)putItem(quotaKey(),previousQuota);
     if(getItem(lastKey)===String(sentAt))putItem(lastKey,previousLast||0);
    }
    const message=response.status===403
     ?(body.code==='INVALID_ORIGIN'
       ?'Trang gửi yêu cầu không hợp lệ. Mở đúng https://giaovien-psi.vercel.app rồi thử lại.'
       :'Mã giáo viên AI Studio không hợp lệ. Kiểm tra MARBLE_TTS_PIN trên Vercel và nhập lại vào ô ngay trên nút tạo 20 câu; không dùng Gemini API key. Lỗi 403 không trừ lượt Google.')
     :(body.error||'Google HTTP '+response.status);
    throw Object.assign(Error(message),{status:response.status,code:body.code});
   }
   blob=await response.blob();
   if(blob.size<45||blob.size>10*1024*1024)throw Error('Google WAV không hợp lệ hoặc vượt 10 MB.');
   await cachePut(cacheKey,blob);
  }
  const header=new Uint8Array(await blob.slice(0,12).arrayBuffer());
  const signature=String.fromCharCode(...header);
  if(!signature.startsWith('RIFF')||signature.slice(8,12)!=='WAVE')
   throw Error('Âm thanh trả về không phải WAV hợp lệ.');
  const A=window.AudioContext||window.webkitAudioContext;
  if(!A)throw Error('Không có Web Audio để cắt.');
  const ac=new A();
  try{
   const buffer=await ac.decodeAudioData(await blob.arrayBuffer());
   if(buffer.duration<.5)throw Error('WAV quá ngắn, không đủ lời đọc.');
   const cuts=window.QuestionBatchAudio.locate(buffer,group.entries);
   for(const c of cuts.segments){
    const wav=window.QuestionBatchAudio.wavPCM(c.channels,c.rate,c.start,c.end);
    if(c.entry.id==='_shared')localWavs.set(key('_shared',c.entry.part),wav);
    else showReview(c.entry,wav,c.quality);
   }
  }finally{await ac.close().catch(()=>{})}
 }
 async function start(){
  if(working)return;
  if(pending.length&&!confirm('Tạo đợt mới sẽ bỏ các WAV chưa lưu đang chờ duyệt. Tiếp tục?'))return;
  working=true;stop=false;reset();buttons();
  try{
   await analyze();
   let failure=null;
   for(let i=0;i<groups.length;i++){
    if(stop)break;
    status('Đang gọi Google lô '+(i+1)+'/'+groups.length+'…');
    try{await createGroup(groups[i]);groups[i].done=true}
    catch(e){groups[i].error=err(e);failure=e;break}
   }
   const count=groups.filter(g=>g.done).length;
   if(count===groups.length&&pending.length===0){await derive()}
   if(failure)status('⚠ Dừng tại lô '+(count+1)+'/'+groups.length+': '+err(failure)+
    '. Các WAV đã tạo vẫn chờ nghe duyệt; sau khi sửa lỗi có thể thử lại.',true);
   else status('Đã xử lý '+count+'/'+groups.length+' lượt. '+pending.length+
    ' WAV đang chờ nghe duyệt. '+(count<groups.length?'Có thể dùng NGHI cho phần còn thiếu.':'Nghe và duyệt trước khi lưu.'));
  }catch(e){status('⚠ '+err(e),true)}
  finally{working=false;buttons()}
 }
 async function uploadWithRetry(id,provider,part,blob,h){
  for(let attempt=0;attempt<3;attempt++){
   try{return await ctx.upload(id,provider,part,blob,h)}
   catch(e){if(!(e?.status===408||e?.status>=500||e instanceof TypeError)||attempt===2)throw e;
    await sleep(500*(attempt+1))}
  }
 }
 async function getPiece(id,part){
  const k=key(id,part);
  if(localWavs.has(k))return localWavs.get(k);
  const entry=existing.get(k);
  if(!entry)return null;
  if(!entry.url)throw Error('Thiếu liên kết WAV; cần đồng bộ lại.');
  const response=await fetch(entry.url);
  if(!response.ok)throw Error('WAV hiện có chưa tải được, hãy đồng bộ lại.');
  const blob=await response.blob();localWavs.set(k,blob);return blob;
 }
 async function derive(){
  let added=0;
  for(const q of rows){
   if(stop)break;
   const bases=await Promise.all(BASE.map(p=>getPiece(q.id,p)));
   if(bases.some(v=>!v))continue;
   const fullKey=key(q.id,'full'),answerKey=key(q.id,'answer');
   if(!existing.has(fullKey)&&!derivativeAdded.has(fullKey)&&localWavs.has(key('_shared','suffix'))){
    const blob=await stitch([...bases,localWavs.get(key('_shared','suffix'))],.2);
    showReview({id:q.id,part:'full',question:q.text,text:q.spoken.full,hash:hashes.get(fullKey)},blob,'needs-review');
    derivativeAdded.add(fullKey);added++;
   }
   if(!existing.has(answerKey)&&!derivativeAdded.has(answerKey)&&localWavs.has(key('_shared','prefix'))){
    const correct=String(q.correct||'').toLowerCase();
    const clip=await getPiece(q.id,'option_'+correct);
    if(!clip)continue;
    const blob=await stitch([localWavs.get(key('_shared','prefix')),clip],.08);
    showReview({id:q.id,part:'answer',question:q.text,text:q.spoken.answer,hash:hashes.get(answerKey)},blob,'needs-review');
    derivativeAdded.add(answerKey);added++;
   }
  }
  return added;
 }
 async function save(){
  if(working)return;
  const approved=pending.filter(p=>p.approved&&p.listened);
  if(!approved.length)return status('Hãy nghe và duyệt ít nhất một WAV.');
  if(!confirm('Lưu '+approved.length+' WAV Google đã nghe và duyệt vào Supabase?'))return;
  working=true;stop=false;buttons();let uploaded=0;
  try{
   const check=await ctx.studioCheck();
   if('studio:'+check.voiceVersion!==voice)throw Error('Giọng AI Studio đã đổi phiên bản.');
   for(const p of approved){
    if(stop)break;
    const e=p.entry,k=key(e.id,e.part);
    if(!existing.has(k)){
     await uploadWithRetry(e.id,voice,e.part,p.blob,e.hash);
     existing.set(k,{id:e.id,part:e.part,textHash:e.hash});
    }
    localWavs.set(k,p.blob);uploaded++;p.approved=false;p.node.remove();
    pending=pending.filter(z=>z!==p);
    status('Đang lưu '+uploaded+'/'+approved.length+' WAV đã duyệt…');
   }
   if(uploaded){await ctx.refresh();ctx.notify()}
   const composed=await derive();
   status('Đã lưu '+uploaded+' WAV. '+(composed?'Đã ghép thêm '+composed+' WAV toàn câu/đáp án để nghe duyệt lần cuối.':'Còn '+pending.length+' WAV cần duyệt.'));
  }catch(e){status('⚠ Đã lưu '+uploaded+' WAV, lỗi: '+err(e),true)}
  finally{working=false;buttons()}
 }
 async function fallback(){
  if(working||!rows.length||rows.length>Q_CAP||rows.some(q=>!q.owned))return;
  if(!confirm('Tạo đủ các WAV còn thiếu cho những câu chưa có đủ 7 WAV Google bằng NGHI-TTS? NGHI được lưu dưới giọng riêng, không ghi đè Gemini. Có thể phải tải mô hình khoảng 64 MB lần đầu.'))return;
  working=true;stop=false;buttons();let count=0;
  const model=$('voiceModel')?.value||'deepman3909',provider='nghi:'+model;
  try{
   const all=await audioList(rows.map(q=>q.id),provider),nghi=new Map();
   for(const f of all)nghi.set(key(f.id,f.part),f);
   const valid=async(q,part)=>{const f=nghi.get(key(q.id,part));return f&&f.textHash===await ctx.hash(q.spoken[part])?f:null};
   let pre=null,post=null;
   for(const q of rows){
    if(stop)break;
    if(PARTS.every(p=>existing.has(key(q.id,p))))continue;
    const clips=new Map();
    for(const part of BASE){
     const file=await valid(q,part);
     if(file){const res=await fetch(file.url);if(!res.ok)throw Error('Không thể tải NGHI WAV đã lưu.');clips.set(part,await res.blob());continue}
     status('NGHI-TTS đang tạo '+part+' – '+q.text.slice(0,35)+'…');
     const wav=await ctx.nghiMake(model,q.spoken[part]);
     await uploadWithRetry(q.id,provider,part,wav,await ctx.hash(q.spoken[part]));
     clips.set(part,wav);count++;
    }
    if(!await valid(q,'full')){
     if(!post)post=await ctx.nghiMake(model,POST);
     const wav=await stitch([...BASE.map(part=>clips.get(part)),post],.20);
     await uploadWithRetry(q.id,provider,'full',wav,await ctx.hash(q.spoken.full));count++;
    }
    if(!await valid(q,'answer')){
     if(!pre)pre=await ctx.nghiMake(model,PRE);
     const wav=await stitch([pre,clips.get('option_'+String(q.correct).toLowerCase())],.08);
     await uploadWithRetry(q.id,provider,'answer',wav,await ctx.hash(q.spoken.answer));count++;
    }
    status('NGHI đã tạo '+count+' WAV. Đang tiếp tục các câu còn thiếu…');
   }
   await ctx.refresh();ctx.notify();
   status('✅ NGHI-TTS đã lưu '+count+' WAV mới. WAV Google được giữ nguyên.');
  }catch(e){status('⚠ NGHI lưu được '+count+' WAV trước khi dừng: '+err(e),true)}
  finally{working=false;buttons()}
 }
 $('classroom20Start').onclick=()=>void start();
 $('classroom20Stop').onclick=()=>{stop=true;status('Sẽ dừng sau khi hoàn thành thao tác hiện tại.')};
 $('classroom20Save').onclick=()=>void save();
 $('classroom20Fallback').onclick=()=>void fallback();
 window.addEventListener('beforeunload',event=>{if(pending.length){event.preventDefault();event.returnValue=''}});
 buttons();
 return {start,save,fallback,getState:()=>({working,pending:pending.length,groups:groups.length})};
}
window.Classroom20={create,plan,stitch};
})();