/* Student names: owner-only Supabase WAVs, smart Gemini batches, explicit consent, manual cut/review. */
(function(){
'use strict';
const $=id=>document.getElementById(id);
const STORE=()=>window.TeacherClassroomStore;
const CHARS=1600, TOKENS=6000, MAX_SECONDS=55, API_CHARS=1800, PAUSE=.72, RPM_GAP=22500, DAY_CAP=10;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const error=e=>String(e?.message||e||'Không rõ lỗi').slice(0,320);
const norm=s=>String(s||'').trim().replace(/\s+/g,' ');
function estimatedTokens(text){
 const chars=[...text].length, words=norm(text).split(' ').filter(Boolean).length;
 // Conservative estimator, NOT the provider's exact model token counter.
 return Math.ceil(chars*.75+words*.55+24);
}
function estimatedSeconds(text,segments=1){
 const words=norm(text).split(/\s+/u).filter(Boolean).length;
 return Math.max(1.1,words/2.25)+PAUSE*segments;
}
function pack(entries,opt={}){
 const maxChars=Math.min(API_CHARS,Math.max(120,Number(opt.maxChars)||CHARS));
 const maxTokens=Math.min(8192,Math.max(100,Number(opt.maxTokens)||TOKENS));
 const maxSeconds=Math.min(70,Math.max(10,Number(opt.maxSeconds)||MAX_SECONDS));
 const batches=[],rejected=[];
 for(const entry of entries){
  const name=norm(entry.name),text=name;
  if(!text){rejected.push(entry);continue}
  let batch=batches[batches.length-1],candidate=batch?[...batch.entries,entry]:[entry];
  const content=candidate.map(v=>norm(v.name)).join('\n\n\n\n');
  if(!batch||[...content].length>maxChars||estimatedTokens(content)>maxTokens||
     estimatedSeconds(content,candidate.length)>maxSeconds){
   batch={entries:[],text:'',tokens:0,seconds:0};batches.push(batch);candidate=[entry];
  }
  const batchText=candidate.map(v=>norm(v.name)).join('\n\n\n\n');
  if([...batchText].length>maxChars||estimatedTokens(batchText)>maxTokens||
     estimatedSeconds(batchText,candidate.length)>maxSeconds){
   batches.pop();rejected.push(entry);continue;
  }
  batch.entries=candidate;batch.text=batchText;batch.tokens=estimatedTokens(batchText);
  batch.seconds=estimatedSeconds(batchText,candidate.length);
 }
 return {batches,rejected,maxChars,maxTokens,maxSeconds};
}
const quotaDay=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/Los_Angeles',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const quotaKey=()=> 'motionclass:classroom20:requests:'+quotaDay();
const rateKey='motionclass:classroom20:last-request';
function get(k){try{return localStorage.getItem(k)}catch(_){return null}}
function put(k,v){try{localStorage.setItem(k,String(v))}catch(_){}}
function openDB(){return new Promise((yes,no)=>{
 if(!window.indexedDB)return no(Error('Không hỗ trợ IndexedDB'));
 const req=indexedDB.open('motionclass-student-names-raw-v1',1);
 req.onupgradeneeded=()=>req.result.createObjectStore('wav');
 req.onsuccess=()=>yes(req.result);req.onerror=()=>no(req.error);
})}
async function cached(k){
 try{const db=await openDB(),value=await new Promise((yes,no)=>{
  const rq=db.transaction('wav','readonly').objectStore('wav').get(k);
  rq.onsuccess=()=>yes(rq.result);rq.onerror=()=>no(rq.error);
 });db.close();return value&&Date.now()-value.date<7*86400000?value.blob:null}catch(_){return null}
}
async function cache(k,blob){
 try{const db=await openDB();await new Promise((yes,no)=>{
  const t=db.transaction('wav','readwrite');t.objectStore('wav').put({date:Date.now(),blob},k);
  t.oncomplete=yes;t.onerror=()=>no(t.error);
 });db.close()}catch(_){}
}
function renderWave(canvas,channels,start,end,duration){
 const x=canvas.getContext('2d');if(!x)return;
 const w=canvas.width,h=canvas.height,source=channels[0],count=source.length;
 x.fillStyle='#edf4ff';x.fillRect(0,0,w,h);
 x.fillStyle='#cee7ff';x.fillRect(w*start/duration,0,w*(end-start)/duration,h);
 for(let p=0;p<w;p++){
  const a=Math.floor(p*count/w),b=Math.min(count,Math.floor((p+1)*count/w));
  let amp=0;for(let j=a;j<b;j++)amp=Math.max(amp,Math.abs(source[j]));
  const span=Math.max(1,amp*h*.92);
  x.fillStyle=p>=w*start/duration&&p<=w*end/duration?'#1669d0':'#93a8c4';
  x.fillRect(p,(h-span)/2,1.5,span);
 }
 x.fillStyle='#0f59bb';x.fillRect(w*start/duration,0,2,h);x.fillRect(w*end/duration,0,2,h);
}
function create({context,client}){
 let running=false,stopping=false,selection=null,voice=null,existing=[],reviews=[],urls=[],verifiedCode='';
 const panel=$('studentTtsPanel'),store=STORE();
 const tell=(t,bad=false)=>{const el=$('studentTtsStatus');el.textContent=t;el.classList.toggle('error',bad)};
 const makeEl=(tag,content)=>{const el=document.createElement(tag);if(content!==undefined)el.textContent=content;return el};
 function buttons(){
  $('studentTtsStart').disabled=running||!context().classId;
  $('studentTtsStop').disabled=!running;
  $('studentTtsSave').disabled=running||!reviews.some(r=>r.approved&&r.listened);
 }
 function clean(){
  for(const url of urls)URL.revokeObjectURL(url);urls=[];
  reviews=[];$('studentTtsReviews').replaceChildren();$('studentTtsPlan').replaceChildren();
 }
 function nameRecords(students){return students.filter(s=>s.active!==false).map(s=>({id:s.id,name:norm(s.name)}))}
 async function getStored(classId){return store.listStudentNameVoices(client(),classId)}
 async function refresh(){
  const ctx=context(),cls=ctx.classId;
  if(!cls){selection=null;existing=[];panel.hidden=true;clean();buttons();return}
  panel.hidden=false;
  const recorded=await getStored(cls);
  if(context().classId!==cls)return;
  existing=recorded;
  if(!voice)try{voice=await checkStudio()}catch(_){voice=existing.find(x=>x.voiceId.startsWith('studio:'))?.voiceId||null}
  await renderExisting();
  $('studentTtsTotal').textContent=ctx.students.filter(s=>s.active!==false).length+' học sinh';
  buttons();
 }
 async function renderExisting(){
  const list=$('studentTtsSaved');list.replaceChildren();
  const ctx=context(),students=nameRecords(ctx.students),valid=new Map();
  for(const student of students)valid.set(student.id,await store.studentNameHash(student.name));
  const active=existing.filter(x=>x.voiceId===voice && x.url&&valid.get(x.studentId)===x.nameHash);
  const label=makeEl('p','WAV đã lưu hợp lệ với giọng đang chọn: '+active.length+'/'+students.length+'.');
  list.append(label);
  for(const row of active){
   const student=students.find(s=>s.id===row.studentId),line=makeEl('div');
   line.className='row';
   const span=makeEl('span',student?.name||'Học sinh');span.style.flex='1';
   const audio=makeEl('audio');audio.controls=true;audio.preload='none';audio.src=row.url;
   audio.style.maxWidth='210px';audio.style.width='210px';
   line.append(span,audio);list.append(line);
  }
 }
 function showReview(clip){
  const {entry,segment}=clip,duration=segment.max;
  const wrapper=makeEl('div');wrapper.className='name-audio-review';
  wrapper.append(makeEl('strong',entry.name+' · '+(segment.quality==='candidate'?'Vị trí cắt ước tính':'Cần chỉnh điểm cắt')));
  const waveform=makeEl('canvas');waveform.width=500;waveform.height=85;
  waveform.style.width='100%';waveform.style.maxWidth='680px';wrapper.append(waveform);
  const controls=makeEl('div');controls.className='split';
  const labelA=makeEl('label','Bắt đầu (giây)'),labelB=makeEl('label','Kết thúc (giây)');
  const start=makeEl('input'),end=makeEl('input');
  for(const ctrl of [start,end]){ctrl.type='range';ctrl.min='0';ctrl.max=String(Math.round(duration*100));ctrl.step='1'}
  start.value=String(Math.round(segment.start*100));end.value=String(Math.round(segment.end*100));
  const left=makeEl('div'),right=makeEl('div');left.append(labelA,start);right.append(labelB,end);controls.append(left,right);wrapper.append(controls);
  const times=makeEl('p');times.className='tiny';
  const audio=makeEl('audio');audio.controls=true;audio.preload='none';audio.style.maxWidth='100%';wrapper.append(times,audio);
  const approveLine=makeEl('label');const checkbox=makeEl('input');checkbox.type='checkbox';checkbox.disabled=true;
  approveLine.append(checkbox,document.createTextNode(' Đã nghe hết tên và kiểm tra điểm cắt chính xác'));
  wrapper.append(approveLine);
  const state={entry,listened:false,approved:false,blob:null,wrapper};
  const reclip=()=>{
   let begin=Number(start.value)/100,finish=Number(end.value)/100;
   if(finish-begin<.17){
    if(document.activeElement===start){begin=Math.max(0,finish-.17);start.value=String(Math.round(begin*100))}
    else {finish=Math.min(duration,begin+.17);end.value=String(Math.round(finish*100))}
   }
   const wav=window.QuestionBatchAudio.wavPCM(segment.channels,segment.rate,begin,finish);
   if(state.url)URL.revokeObjectURL(state.url);
   state.url=URL.createObjectURL(wav);urls.push(state.url);audio.src=state.url;state.blob=wav;
   times.textContent='Cắt từ '+begin.toFixed(2)+' đến '+finish.toFixed(2)+' giây. '+segment.note;
   state.listened=false;state.approved=false;checkbox.checked=false;checkbox.disabled=true;
   renderWave(waveform,segment.channels,begin,finish,duration);buttons();
  };
  start.oninput=end.oninput=reclip;audio.onended=()=>{state.listened=true;checkbox.disabled=false};
  checkbox.onchange=()=>{state.approved=state.listened&&checkbox.checked;buttons()};
  reclip();reviews.push(state);$('studentTtsReviews').append(wrapper);buttons();
 }
 async function checkStudio(){
  const res=await fetch('/api/marble-tts',{cache:'no-store'});
  if(!res.ok)throw Error('Máy chủ Google AI Studio không phản hồi.');
  const info=await res.json();
  if(!info.configured||!/^[a-f0-9]{16}$/.test(info.voiceVersion||''))throw Error('Chưa cấu hình Google AI Studio trong Vercel Production.');
  return 'studio:'+info.voiceVersion;
 }
 async function verifyCode(code){
  if(verifiedCode===code)return;
  const response=await fetch('/api/marble-tts',{method:'POST',
   headers:{'Content-Type':'application/json','X-Marble-Teacher-Code':code},
   body:JSON.stringify({verifyOnly:true})});
  const body=await response.json().catch(()=>({}));
  if(!response.ok||body.verified!==true)throw Error(response.status===403
    ?'Mã giáo viên không đúng, kiểm tra MARBLE_TTS_PIN trên Vercel (không phải Gemini API key).'
    :(body.error||'Chưa kiểm tra được mã giáo viên.'));
  verifiedCode=code;
 }
 async function waitSlot(){
  let remaining=Math.max(0,RPM_GAP-(Date.now()-(Number(get(rateKey))||0)));
  while(remaining>0){
   if(stopping)throw Error('Đã dừng theo yêu cầu.');
   tell('Đang chờ '+Math.ceil(remaining/1000)+' giây để tôn trọng giới hạn yêu cầu/phút...');
   await sleep(Math.min(remaining,950));remaining=Math.max(0,RPM_GAP-(Date.now()-(Number(get(rateKey))||0)));
  }
 }
 async function generate(group,code){
  const cacheKey='class-names:'+await store.studentNameHash(voice+'|'+group.entries.map(e=>e.id+':'+e.name).join('|'));
  let blob=await cached(cacheKey);
  if(!blob){
   if((Number(get(quotaKey()))||0)>=DAY_CAP)throw Error('Đã đạt 10 lượt Google ghi nhận trên trình duyệt. Hạn mức Google thực tế có thể khác.');
   await waitSlot();if(stopping)throw Error('Đã dừng.');
   const prev=Number(get(quotaKey()))||0,last=get(rateKey),sentAt=Date.now();
   put(quotaKey(),prev+1);put(rateKey,sentAt);
   const res=await fetch('/api/marble-tts',{method:'POST',headers:{'Content-Type':'application/json','X-Marble-Teacher-Code':code},
    body:JSON.stringify({batch:true,classroom20:true,text:group.text})});
   if(!res.ok){
    const body=await res.json().catch(()=>({}));
    if([400,401,403,413,422].includes(res.status)){
     if(Number(get(quotaKey()))===prev+1)put(quotaKey(),prev);
     if(get(rateKey)===String(sentAt))put(rateKey,last||0);
    }
    throw Object.assign(Error(body.error||'Google HTTP '+res.status),{status:res.status});
   }
   blob=await res.blob();if(blob.size>10*1024*1024||blob.size<45)throw Error('WAV dài vượt giới hạn 10 MB hoặc trống.');
   await cache(cacheKey,blob);
  }
  const riff=new Uint8Array(await blob.slice(0,12).arrayBuffer());
  if(String.fromCharCode(...riff.slice(0,4))!=='RIFF'||String.fromCharCode(...riff.slice(8,12))!=='WAVE')throw Error('Dịch vụ không trả WAV hợp lệ.');
  const A=window.AudioContext||window.webkitAudioContext;
  if(!A)throw Error('Trình duyệt chưa hỗ trợ cắt sóng âm.');
  const context=new A();
  try{
   const decoded=await context.decodeAudioData(await blob.arrayBuffer());
   if(decoded.duration<.4)throw Error('WAV gần như trống.');
   const parts=window.QuestionBatchAudio.locate(decoded,group.entries.map(e=>({...e,text:e.name})));
   if(parts.segments.length!==group.entries.length)throw Error('Không đủ đoạn để cắt WAV; WAV gốc vẫn lưu trên thiết bị.');
   for(const segment of parts.segments)showReview({entry:segment.entry,segment});
  }finally{await context.close().catch(()=>{})}
 }
 async function start(){
  if(running)return;
  if(reviews.length&&!confirm('Đợt mới sẽ xóa các WAV chưa lưu trong khung nghe duyệt (WAV gốc đã được lưu tạm). Tiếp tục?'))return;
  running=true;stopping=false;clean();buttons();
  try{
   const ctx=context();if(!ctx.classId||!ctx.students.length)throw Error('Chưa chọn lớp có học sinh.');
   const all=nameRecords(ctx.students);
   if(!all.length)throw Error('Chưa có học sinh đang học.');
   const code=$('studentTtsPin').value;
   if(!code.trim())throw Error('Cần nhập MARBLE_TTS_PIN của giáo viên, không phải khóa Gemini API.');
   voice=await checkStudio();
   const stored=await getStored(ctx.classId);existing=stored;
   const known=new Map(stored.filter(e=>e.voiceId===voice).map(e=>[e.studentId,e]));
   const missing=[];
   for(const row of all){
    const hash=await store.studentNameHash(row.name);
    if(known.get(row.id)?.nameHash===hash && known.get(row.id)?.url)continue;
    missing.push({...row,nameHash:hash});
   }
   if(!missing.length){tell('✅ Tất cả '+all.length+' học sinh đã có WAV hợp lệ với giọng Google đang chọn.');await renderExisting();return}
   if(!$('studentTtsConsent').checked||!confirm('Gửi '+missing.length+' họ tên học sinh tới Google AI Studio để tạo giọng đọc? Chỉ gửi tên; không gửi ảnh hoặc mã học sinh. Giáo viên phải bảo đảm có cơ sở phù hợp để xử lý dữ liệu này.'))throw Error('Chưa xác nhận quyền gửi tên học sinh lên Google.');
   const p=pack(missing,{maxChars:Number($('studentTtsMaxChars').value),maxTokens:Number($('studentTtsMaxTokens').value),maxSeconds:Number($('studentTtsMaxSeconds').value)});
   if(p.rejected.length)throw Error('Có '+p.rejected.length+' tên quá dài, cần chỉnh lại.');
   selection={classId:ctx.classId,voice,missing};
   const node=makeEl('p','Lớp '+ctx.className+': '+all.length+' em, '+(all.length-missing.length)+' WAV dùng lại, '+missing.length+' tên cần đọc; '+p.batches.length+' lượt AI dự kiến. Ngưỡng '+p.maxChars+' ký tự, '+p.maxTokens+' token ƯỚC TÍNH, '+p.maxSeconds+' giây/lô.');
   $('studentTtsPlan').append(node);
   for(let i=0;i<p.batches.length;i++){
    const b=p.batches[i];
    $('studentTtsPlan').append(makeEl('p','Lô '+(i+1)+': '+b.entries.length+' tên · '+[...b.text].length+' ký tự · ~'+b.tokens+' token · ~'+b.seconds.toFixed(1)+' giây'));
   }
   await verifyCode(code);
   let completed=0,problem='';
   for(let i=0;i<p.batches.length;i++){
    if(stopping||context().classId!==selection.classId)break;
    tell('Đang tạo lô '+(i+1)+'/'+p.batches.length+'…');
    try{await generate(p.batches[i],code);completed++}
    catch(e){problem=error(e);break}
   }
   if(problem)tell('⚠ Dừng sau '+completed+'/'+p.batches.length+' lô: '+problem+'. WAV đã tạo vẫn giữ để nghe duyệt.',true);
   else tell('Đã tạo '+completed+'/'+p.batches.length+' lô, '+reviews.length+' WAV cần nghe và duyệt trước khi lưu.');
  }catch(e){tell('⚠ '+error(e),true)}
  finally{running=false;buttons()}
 }
 async function save(){
  if(running)return;
  const chosen=reviews.filter(r=>r.approved&&r.listened);
  if(!chosen.length)return tell('Chưa có WAV được nghe và duyệt.',true);
  if(!confirm('Lưu '+chosen.length+' WAV tên học sinh vào kho riêng tư của lớp trên Supabase?'))return;
  running=true;stopping=false;buttons();let saved=0;
  try{
   for(const r of chosen){
    if(stopping)break;
    if(context().classId!==selection?.classId)throw Error('Đã đổi lớp trong khi lưu.');
    const current=context().students.find(x=>x.id===r.entry.id);
    if(!current)throw Error('Không còn học sinh '+r.entry.name);
    if(await store.studentNameHash(current.name)!==r.entry.nameHash)throw Error('Tên '+r.entry.name+' đã thay đổi, không thể lưu WAV cũ.');
    await store.saveStudentNameVoice(client(),{
     classId:selection.classId,studentId:r.entry.id,voiceId:selection.voice,nameHash:r.entry.nameHash,blob:r.blob
    });
    saved++;r.wrapper.remove();reviews=reviews.filter(x=>x!==r);
    tell('Đã lưu '+saved+'/'+chosen.length+' WAV đã duyệt.');
   }
   existing=await getStored(selection.classId);await renderExisting();
   tell('✅ Đã lưu '+saved+' WAV. '+reviews.length+' WAV đang chờ nghe và duyệt.');
  }catch(e){tell('⚠ Lưu được '+saved+' WAV; lỗi: '+error(e),true)}
  finally{running=false;buttons()}
 }
 $('studentTtsStart').onclick=()=>void start();
 $('studentTtsStop').onclick=()=>{stopping=true;tell('Sẽ dừng sau lô hiện tại, không gọi tiếp Google.')};
 $('studentTtsSave').onclick=()=>void save();
 window.addEventListener('beforeunload',e=>{if(reviews.length){e.preventDefault();e.returnValue=''}});
 refresh().catch(e=>tell('⚠ '+error(e),true));
 return {onClassChange:()=>{if(!running){selection=null;clean()}refresh().catch(e=>tell('⚠ '+error(e),true))},start,save,getState:()=>({running,queued:reviews.length,voice,existing:existing.length}),pack};
}
window.StudentNameBatch={create,pack,estimatedTokens,estimatedSeconds};
})();