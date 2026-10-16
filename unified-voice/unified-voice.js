/* MotionClass · Trang Giọng đọc — MỘT nơi quản lý giọng cho tên học sinh, câu dẫn kịch bản và câu hỏi.
 * - Một giọng hệ thống (Microsoft, chọn người đọc + chất giọng), lưu trên Supabase (MotionVoice).
 * - Danh sách từng đoạn: trạng thái (✅ có · ⛔ thiếu · ↻ nội dung đã sửa), nghe, tạo lại (đổi sắc thái), xóa.
 * - Tạo xong lưu ngay (giọng Microsoft, không tốn lượt Google). WAV các giọng khác không bị đụng tới.
 * - Nhúng được (?embed=1&scope=class:<id>|questions) cho nút "🎙️ Tạo giọng ngay" ở Lớp học / Ngân hàng câu hỏi.
 */
(function(){
'use strict';
const $=id=>document.getElementById(id);
const CS=window.TeacherClassroomStore,S=window.TeacherScriptStore,AUDIO=window.QuestionBatchAudio,cfg=window.POSE_QUIZ_SUPABASE,MV=window.MotionVoice;
const QS=new URLSearchParams(location.search),EMBED=QS.get('embed')==='1',SCOPE=String(QS.get('scope')||'all');
const SCOPE_CLASS=SCOPE.startsWith('class:')?SCOPE.slice(6):'',SCOPE_QUESTION=SCOPE.startsWith('question:')?SCOPE.slice(9):'',ONLY_QUESTIONS=SCOPE==='questions'||!!SCOPE_QUESTION;
const PIN_KEY='motionclass:uv-pin',CONSENT_KEY='motionclass:uv-consent',TAB_KEY='motionclass:uv-tab';
const PARTS=['question','option_a','option_b','option_c','option_d','answer','explain','full'];// 'explain' chỉ có khi giáo viên điền giải thích
const PART_LABEL={question:'Câu hỏi',option_a:'Phương án A',option_b:'Phương án B',option_c:'Phương án C',option_d:'Phương án D',answer:'Đáp án',explain:'Giải thích',full:'Đọc cả câu'};
const STYLE_LABEL={neutral:'trung tính',cheer:'vui mừng',praise:'khen ngợi',congrats:'chúc mừng',soft:'nhẹ nhàng',encourage:'động viên',lively:'sôi nổi',alert:'nhắc giờ'};
const CHUNK=8,ID_RE=/^[0-9a-f]{8}-[0-9a-f-]{27,}$/i;
const store={get(k,a=localStorage){try{return a.getItem(k)}catch(_){return null}},set(k,v,a=localStorage){try{v==null?a.removeItem(k):a.setItem(k,v)}catch(_){}}};
const message=e=>{const m=String(e?.message||e||'Không rõ lỗi');return /Failed to fetch|NetworkError/i.test(m)?'Không kết nối được máy chủ. Kiểm tra Internet rồi thử lại.':m.slice(0,300)};
const el=(t,x,c)=>{const n=document.createElement(t);if(x!==undefined)n.textContent=x;if(c)n.className=c;return n};
function tell(text,bad=false,id='status'){const n=$(id);n.textContent=text;n.classList.toggle('error',bad)}
function notifyParent(msg){if(EMBED&&window.parent!==window)try{window.parent.postMessage(msg,location.origin)}catch(_){}}

let c=null,VOICE=MV.DEFAULT,classes=[],tab='name',running=false,stopping=false,verified='',maxStudents=0,bankSize=0;
let rows={name:[],phrase:[],question:[]},old=new Map(),selected=new Set(),loaded=false;

/* ---------- Kết nối ---------- */
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
function countOld(voiceId,kind){
 if(voiceId===VOICE)return;
 if(!old.has(voiceId))old.set(voiceId,{name:0,phrase:0,question:0});
 old.get(voiceId)[kind]++;
}

/* ---------- Nạp danh sách đoạn ---------- */
async function loadNames(){
 const out=[];
 const list=SCOPE_CLASS?classes.filter(x=>x.id===SCOPE_CLASS):classes;
 for(const cls of list){
  const [students,voices]=await Promise.all([CS.listStudents(c,cls.id),CS.listStudentNameVoices(c,cls.id)]);
  const active=students.filter(s=>s.active!==false);maxStudents=Math.max(maxStudents,active.length);
  for(const v of voices)countOld(v.voiceId,'name');
  for(const s of active){
   const hash=await CS.studentNameHash(s.name),v=voices.find(x=>x.studentId===s.id&&x.voiceId===VOICE);
   out.push({key:'n:'+s.id,kind:'name',groupKey:cls.id,groupLabel:'Lớp '+cls.name,title:s.name,sub:'',text:S.norm(s.name),style:'neutral',
    status:v?(v.nameHash===hash?'ok':'stale'):'missing',url:v?.url||null,classId:cls.id,studentId:s.id,nameHash:hash});
  }
 }
 return out;
}
async function loadQuestions(){
 const items=[];let offset=0;
 do{const r=await bankApi('bank.list',{limit:250,offset});items.push(...r.items);offset=r.nextOffset}while(offset!=null&&items.length<2000);
 bankSize=items.length;
 const own=items.filter(q=>q.owned&&ID_RE.test(q.id)&&q.spoken);
 const mine=new Map(),withVoice=new Set();
 for(let i=0;i<own.length;i+=100){
  const r=await bankApi('audio.overview',{ids:own.slice(i,i+100).map(q=>q.id)});
  for(const a of r.items||[]){
   if(a.voiceId===VOICE){mine.set(a.id+'/'+a.part,a);withVoice.add(a.id)}
   else if(a.current)countOld(a.voiceId,'question');
  }
 }
 const urls=new Map(),ids=[...withVoice];
 for(let i=0;i<ids.length;i+=100){
  const r=await bankApi('audio.list',{ids:ids.slice(i,i+100),voice_id:VOICE});
  for(const a of r.items||[])urls.set(a.id+'/'+a.part,a.url);
 }
 const out=[];
 for(const q of own){
  const lesson=[q.subject,q.lesson].filter(Boolean).join(' · ')||'Chưa phân bài';
  for(const part of PARTS){
   const text=q.spoken?.[part];if(!text)continue;
   const a=mine.get(q.id+'/'+part);
   out.push({key:'q:'+q.id+':'+part,kind:'question',groupKey:lesson,groupLabel:lesson,title:PART_LABEL[part]+' — '+String(q.text||'').slice(0,70),sub:text,text,style:'neutral',
    status:a?(a.current?'ok':'stale'):'missing',url:urls.get(q.id+'/'+part)||null,questionId:q.id,part});
  }
 }
 return out;
}
const NUM_GROUP={call:'Số thứ tự câu hỏi',summary:'Số điểm cuối giờ',streak:'Số bạn đúng liên tiếp'};
async function loadPhrases(){
 const maxNumber=Math.min(99,Math.max(20,bankSize,maxStudents));
 const scripts=[...(await S.listScripts(c)),...(S.BUILTIN?[S.BUILTIN]:[])];
 const map=new Map();
 for(const sc of scripts)for(const p of S.scriptPhrases(sc,{maxNumber:Math.max(maxNumber,sc.slots?.options?.maxNumber||20),scoreNumbers:true})){
  if(!map.has(p.text))map.set(p.text,{...p,scripts:new Set()});
  map.get(p.text).scripts.add(sc.id==='builtin'?'Mặc định':sc.title);
 }
 const saved=await S.listPhraseAudio(c,{sign:true});
 const mine=new Map();
 for(const r of saved){if(r.voiceId===VOICE)mine.set(S.norm(r.phrase),r);else countOld(r.voiceId,'phrase')}
 const slotLabel=k=>(S.SLOTS.find(x=>x.key===k)?.label)||k;
 return [...map.values()].map(p=>{
  const r=mine.get(p.text),g=p.number!==undefined?(NUM_GROUP[p.slot]||'Số'):slotLabel(p.slot);
  return{key:'p:'+p.text,kind:'phrase',groupKey:g,groupLabel:g,title:p.text,sub:'Dùng trong: '+[...p.scripts].join(', ')+' · sắc thái '+(STYLE_LABEL[p.style]||p.style),
   text:p.text,style:p.style||'neutral',status:r?'ok':'missing',url:r?.url||null,phraseId:r?.id||null,storagePath:r?.storagePath||null};
 });
}
async function reload(){
 if(running)return null;
 tell('⏳ Đang tải danh sách đoạn đọc của giọng '+MV.label(VOICE)+'...');old=new Map();
 try{
  const [n,q]=await Promise.all([loadNames(),SCOPE_CLASS?Promise.resolve([]):loadQuestions()]);
  rows.name=n;rows.question=q;rows.phrase=await loadPhrases();
  loaded=true;selected.clear();renderAll();
  const miss=k=>rows[k].filter(r=>r.status!=='ok').length,total=miss('name')+miss('phrase')+miss('question');
  tell(total?'Còn '+total+' đoạn chưa có giọng hệ thống: '+miss('name')+' tên · '+miss('phrase')+' câu dẫn · '+miss('question')+' phần câu hỏi.':'✅ Mọi đoạn đều đã có giọng '+MV.label(VOICE)+'.');
  return total;
 }catch(e){tell('⚠ '+message(e),true);return null}
}

/* ---------- Hiển thị ---------- */
const STATUS={ok:['✅ Có giọng','ok'],missing:['⛔ Thiếu','missing'],stale:['↻ Nội dung đã sửa','stale']};
function visible(){
 const q=S.norm($('search').value).toLowerCase(),g=$('groupFilter').value,st=$('statusFilter').value;
 return rows[tab].filter(r=>(!SCOPE_QUESTION||r.kind!=='question'||r.questionId===SCOPE_QUESTION)&&(!g||r.groupKey===g)&&(!st||r.status===st)&&(!q||(r.title+' '+r.sub).toLowerCase().includes(q)));
}
function renderTabs(){
 for(const [k,id] of [['name','Name'],['phrase','Phrase'],['question','Question']]){
  const list=rows[k],ok=list.filter(r=>r.status==='ok').length;
  $('t'+id).textContent=list.length?ok+'/'+list.length+' có giọng':'0 đoạn';
  $('b'+id).style.width=(list.length?Math.round(ok/list.length*100):0)+'%';
 }
 document.querySelectorAll('.tab').forEach(b=>b.classList.toggle('active',b.dataset.tab===tab));
 const all=['name','phrase','question'].reduce((n,k)=>n+rows[k].filter(r=>r.status!=='ok').length,0);
 $('genMissing').disabled=running||!all;
 $('genMissing').textContent=all?'⚡ Tạo tất cả phần thiếu ('+all+')':'✅ Đã đủ giọng';
}
function renderGroups(){
 const sel=$('groupFilter'),prev=sel.value,groups=[...new Map(rows[tab].map(r=>[r.groupKey,r.groupLabel])).entries()];
 sel.replaceChildren(new Option(tab==='name'?'Tất cả lớp':tab==='phrase'?'Tất cả mục kịch bản':'Tất cả bài học',''),...groups.map(([k,l])=>new Option(l,k)));
 sel.value=groups.some(([k])=>k===prev)?prev:'';
}
function rowNode(r){
 const n=el('div',undefined,'item');n.dataset.key=r.key;
 const cb=el('input');cb.type='checkbox';cb.checked=selected.has(r.key);cb.setAttribute('aria-label','Chọn '+r.title);
 cb.onchange=()=>{cb.checked?selected.add(r.key):selected.delete(r.key);renderSel()};
 const t=el('div',undefined,'text');t.append(el('b',r.title));if(r.sub)t.append(el('span',r.sub));
 const [label,cls]=STATUS[r.status];
 const play=el('button','▶');play.type='button';play.title='Nghe';play.disabled=!r.url;play.onclick=()=>playRows([r]);
 const acts=el('div',undefined,'acts');
 const regen=el('button',r.status==='ok'?'↻':'⚡ Tạo');regen.type='button';regen.className='regen';regen.title=r.status==='ok'?'Tạo lại đoạn này':'Tạo giọng cho đoạn này';regen.disabled=running;regen.onclick=()=>generate([r],$('styleOverride').value);
 const del=el('button','🗑','danger del');del.type='button';del.title='Xóa giọng của đoạn này';del.disabled=running||r.status==='missing';del.onclick=()=>remove([r]);
 acts.append(regen,del);
 n.append(cb,t,el('span',label,'chip '+cls),play,acts);
 return n;
}
function renderList(){
 const box=$('list'),list=visible(),frag=document.createDocumentFragment();let g=null;
 for(const r of list){if(r.groupKey!==g){g=r.groupKey;frag.append(el('div',r.groupLabel,'group'))}frag.append(rowNode(r))}
 if(!list.length)frag.append(el('p',loaded?'Không có đoạn nào phù hợp bộ lọc.':'Đang tải...','tiny'));
 const top=box.scrollTop;box.replaceChildren(frag);box.scrollTop=top;renderSel();
}
function renderRow(r){const node=document.querySelector('.item[data-key="'+CSS.escape(r.key)+'"]');if(node)node.replaceWith(rowNode(r));renderTabs()}
function renderSel(){
 const vis=new Set(visible().map(r=>r.key)),n=[...selected].filter(k=>vis.has(k)).length;
 $('selCount').textContent=n+' đoạn đã chọn';$('checkAll').checked=n>0&&n===vis.size;
 for(const id of ['bulkPlay','bulkRegen','bulkDelete'])$(id).disabled=!n||running;
}
function renderOld(){
 const box=$('oldList');box.replaceChildren();$('oldPanel').hidden=!old.size;
 for(const [voice,n] of old){
  const parts=[n.name&&n.name+' tên',n.phrase&&n.phrase+' câu dẫn',n.question&&n.question+' phần câu hỏi'].filter(Boolean).join(' · ');
  box.append(el('div',MV.chip(voice).icon+' '+MV.label(voice)+': '+parts));
 }
}
function renderAll(){renderTabs();renderGroups();renderList();renderOld()}
function chosen(){const vis=new Set(visible().map(r=>r.key));return rows[tab].filter(r=>selected.has(r.key)&&vis.has(r.key))}

/* ---------- Nghe ---------- */
const player=new Audio();let playRun=0;
async function playRows(list){
 const t=++playRun;
 for(const r of list){
  if(t!==playRun)return;if(!r.url)continue;
  const node=document.querySelector('.item[data-key="'+CSS.escape(r.key)+'"]');node?.classList.add('playing');node?.scrollIntoView({block:'nearest'});
  await new Promise(done=>{player.onended=player.onerror=()=>done();player.src=r.url;player.play().catch(()=>done())});
  node?.classList.remove('playing');
 }
}

/* ---------- Tạo giọng (Microsoft) ---------- */
let decodeCtx=null;
function actx(){
 if(decodeCtx)return decodeCtx;
 const A=window.AudioContext||window.webkitAudioContext;if(!A)throw Error('Trình duyệt chưa hỗ trợ xử lý âm thanh.');
 try{decodeCtx=new A({sampleRate:24000})}catch(_){decodeCtx=new A()}
 return decodeCtx;
}
async function mp3ToWav(b64){
 const bytes=Uint8Array.from(atob(b64),ch=>ch.charCodeAt(0));
 const buf=await actx().decodeAudioData(bytes.buffer.slice(0));
 const ch=[...Array(buf.numberOfChannels)].map((_,i)=>buf.getChannelData(i)),d=ch[0],rate=buf.sampleRate;
 let a=0,b=d.length-1;const th=0.012;
 while(a<b&&Math.abs(d[a])<th)a++;while(b>a&&Math.abs(d[b])<th)b--;
 const start=Math.max(0,a/rate-0.04),end=Math.min(buf.duration,b/rate+0.08);
 return AUDIO.wavPCM(ch,rate,start,Math.max(end,start+0.2));
}
function pinValue(){const p=$('pin').value;if(!p.trim()){$('pin').focus();throw Error('Hãy nhập mã giáo viên (MARBLE_TTS_PIN) để tạo giọng.')}return p}
async function verifyPin(pin,voiceId=VOICE){
 if(verified===pin)return;
 const r=await fetch('/api/edge-tts',{method:'POST',headers:{'Content-Type':'application/json','X-Marble-Teacher-Code':pin},body:JSON.stringify({verifyOnly:true,voiceId})});
 const j=await r.json().catch(()=>({}));
 if(!r.ok||!j.verified)throw Error(j.error||'Mã giáo viên chưa đúng.');
 verified=pin;store.set(PIN_KEY,$('rememberPin').checked?pin:null,sessionStorage);
}
async function speak(pin,voiceId,items){
 const res=await fetch('/api/edge-tts',{method:'POST',headers:{'Content-Type':'application/json','X-Marble-Teacher-Code':pin},body:JSON.stringify({voiceId,items})});
 const body=await res.json().catch(()=>({}));
 if(!res.ok)throw Error(body.error||('Máy chủ giọng đọc lỗi '+res.status));
 return body.items||[];
}
async function saveRow(r,blob){
 if(r.kind==='name')await CS.saveStudentNameVoice(c,{classId:r.classId,studentId:r.studentId,voiceId:VOICE,nameHash:r.nameHash,blob});
 else if(r.kind==='phrase'){const saved=await S.savePhraseAudio(c,{voiceId:VOICE,phrase:r.text,blob});r.storagePath=saved.storagePath;r.phraseId=null}
 else{
  const form=new FormData();form.set('action','audio.put');form.set('id',r.questionId);form.set('part',r.part);form.set('voice_id',VOICE);
  form.set('expected_text_hash',await sha256Raw(r.text));form.set('audio',new File([blob],r.part+'.wav',{type:'audio/wav'}));
  await bankApi(null,form);
 }
 if(r.localUrl)URL.revokeObjectURL(r.localUrl);
 r.localUrl=r.url=URL.createObjectURL(blob);r.status='ok';
}
function busy(on){
 running=on;$('genStop').hidden=!on;$('refresh').disabled=on;$('profileApply').disabled=on||$('profilePick').value===VOICE;
 document.querySelectorAll('.item .regen,.item .del').forEach(b=>{b.disabled=on||(b.classList.contains('del')&&b.closest('.item').querySelector('.chip.missing'))});
 renderTabs();renderSel();
}
async function generate(list,styleOverride=''){
 if(running||!list.length)return 0;
 let done=0,failed=0,lastErr='';
 try{
  const pin=pinValue();
  if(list.some(r=>r.kind==='name')&&!$('consent').checked)throw Error('Hãy tích ô đồng ý gửi họ tên học sinh tới Microsoft trước khi tạo.');
  busy(true);stopping=false;$('prog').style.width='0%';
  await verifyPin(pin);
  for(let i=0;i<list.length&&!stopping;i+=CHUNK){
   const chunk=list.slice(i,i+CHUNK);
   tell('🎙️ Đang tạo và lưu '+(i+1)+'–'+(i+chunk.length)+' / '+list.length+' đoạn...');
   chunk.forEach(r=>document.querySelector('.item[data-key="'+CSS.escape(r.key)+'"]')?.classList.add('busy'));
   const out=await speak(pin,VOICE,chunk.map(r=>({text:r.text,style:styleOverride||r.style})));
   for(let k=0;k<chunk.length;k++){
    const r=chunk[k];
    try{if(!out[k]?.ok)throw Error(out[k]?.error||'Microsoft chưa trả về âm thanh.');await saveRow(r,await mp3ToWav(out[k].audio));done++}
    catch(e){failed++;lastErr=message(e)}
    renderRow(r);
   }
   $('prog').style.width=Math.round(Math.min(list.length,i+CHUNK)/list.length*100)+'%';
  }
  try{localStorage.setItem('motionclass:shared-bank-sync',JSON.stringify({at:Date.now(),change:'audio.put',source:'voice-hub'}))}catch(_){}
  tell((stopping?'⏹ Đã dừng. ':'✅ ')+'Đã tạo và lưu '+done+' đoạn bằng giọng '+MV.label(VOICE)+'.'+(failed?' ⚠ '+failed+' đoạn lỗi: '+lastErr+' — bấm tạo lại.':''),failed>0&&!done);
 }catch(e){tell('⚠ '+message(e)+(done?' · Đã lưu '+done+' đoạn.':''),true)}
 finally{busy(false);renderList();notifyParent({type:'motionclass:uv-done',saved:done,errors:failed})}
 return done;
}
async function remove(list){
 const have=list.filter(r=>r.status!=='missing');if(running||!have.length)return;
 if(!confirm('Xóa giọng của '+have.length+' đoạn? Các đoạn này sẽ thành “thiếu” cho tới khi tạo lại.'))return;
 busy(true);let n=0,lastErr='';
 for(const r of have){
  try{
   if(r.kind==='name')await CS.removeStudentNameVoice(c,r.studentId,VOICE);
   else if(r.kind==='phrase'){
    let row=r.phraseId?{id:r.phraseId,storagePath:r.storagePath}:null;
    if(!row){const all=await S.listPhraseAudio(c,{voiceId:VOICE,sign:false});const f=all.find(x=>S.norm(x.phrase)===r.text);row=f?{id:f.id,storagePath:f.storagePath}:null}
    if(row)await S.deletePhraseAudio(c,row);
   }else await bankApi('audio.delete',{id:r.questionId,voice_id:VOICE,part:r.part});
   if(r.localUrl)URL.revokeObjectURL(r.localUrl);
   r.url=r.localUrl=null;r.status='missing';r.phraseId=null;n++;renderRow(r);
  }catch(e){lastErr=message(e)}
 }
 busy(false);renderList();
 try{localStorage.setItem('motionclass:shared-bank-sync',JSON.stringify({at:Date.now(),change:'audio.delete',source:'voice-hub'}))}catch(_){}
 tell('🗑 Đã xóa giọng của '+n+' đoạn.'+(lastErr?' ⚠ '+lastErr:''),!!lastErr&&!n);
}

/* ---------- Đổi người đọc / chất giọng ---------- */
async function previewProfile(){
 const id=$('profilePick').value;
 try{
  const pin=pinValue();tell('🎧 Đang tạo câu nghe thử ('+MV.label(id)+')...',false,'voiceStatus');
  await verifyPin(pin,id);
  const out=await speak(pin,id,[{text:'Mời em Nguyễn Minh An trả lời. Câu hỏi số một.',style:'neutral'},{text:'Chính xác! Chúc mừng em, em làm rất tốt!',style:'cheer'},{text:'Chưa chính xác rồi. Không sao cả, lần sau em sẽ làm tốt hơn nhé!',style:'encourage'}]);
  tell('▶ Đang phát giọng '+MV.label(id)+' (nghe thử, chưa lưu gì).',false,'voiceStatus');
  for(const o of out){if(!o.ok)continue;await new Promise(done=>{player.onended=player.onerror=()=>done();player.src='data:audio/mpeg;base64,'+o.audio;player.play().catch(()=>done())})}
 }catch(e){tell('⚠ '+message(e),true,'voiceStatus')}
}
async function applyProfile(){
 const id=$('profilePick').value;if(id===VOICE||running)return;
 if(!confirm('Dùng giọng “'+MV.label(id)+'” cho toàn hệ thống?\nCác đoạn sẽ cần tạo lại bằng giọng mới (miễn phí, vài phút). WAV giọng hiện tại vẫn được giữ, có thể đổi lại bất cứ lúc nào.'))return;
 try{
  await MV.set(c,id);VOICE=id;showVoice();
  const total=await reload();
  tell('✅ Đã đổi giọng hệ thống sang '+MV.label(id)+'.'+(total?' Bấm “⚡ Tạo tất cả phần thiếu” để tạo '+total+' đoạn bằng giọng mới.':''),false,'voiceStatus');
 }catch(e){tell('⚠ '+message(e),true,'voiceStatus')}
}
function showVoice(){
 $('voiceNow').textContent=MV.label(VOICE);$('voiceId').textContent=VOICE;
 $('voiceIcon').textContent=VOICE.includes('hoaimy')?'👩‍🏫':'🧑‍🏫';
 $('profilePick').value=VOICE;$('profileApply').disabled=true;
}

/* ---------- Khởi động ---------- */
async function enter(user){
 $('loginPanel').hidden=true;$('appPanel').hidden=false;$('userEmail').textContent=user.email||'';
 try{
  const profiles=await MV.loadProfiles();
  $('profilePick').replaceChildren(...profiles.map(p=>new Option((p.reader==='HoaiMy'?'👩 HoaiMy · ':'👨 NamMinh · ')+p.label,p.id)));
  VOICE=await MV.get(c);
  if(!profiles.some(p=>p.id===VOICE))$('profilePick').append(new Option(MV.label(VOICE),VOICE));
  showVoice();
  classes=await CS.listClasses(c);
  tab=SCOPE_CLASS?'name':ONLY_QUESTIONS?'question':(['name','phrase','question'].includes(store.get(TAB_KEY))?store.get(TAB_KEY):'name');
  const missing=await reload();
  if(SCOPE_CLASS&&classes.some(x=>x.id===SCOPE_CLASS)){$('groupFilter').value=SCOPE_CLASS;renderList()}
  // Mở từ nút "Tạo giọng ngay": đã nhớ mã (+ đồng ý khi có tên) → tạo luôn phần thiếu của đúng phạm vi.
  if(EMBED&&missing>0&&$('pin').value){
   const scope=[...(ONLY_QUESTIONS?rows.question.filter(r=>!SCOPE_QUESTION||r.questionId===SCOPE_QUESTION):rows.name),...(SCOPE_QUESTION?[]:rows.phrase)].filter(r=>r.status!=='ok');
   if(scope.length&&(!scope.some(r=>r.kind==='name')||$('consent').checked))await generate(scope);
  }
 }catch(e){tell('⚠ '+message(e),true)}
}
document.querySelectorAll('.tab').forEach(b=>b.onclick=()=>{tab=b.dataset.tab;store.set(TAB_KEY,tab);selected.clear();$('search').value='';$('statusFilter').value='';renderTabs();renderGroups();renderList()});
$('search').oninput=renderList;$('groupFilter').onchange=renderList;$('statusFilter').onchange=renderList;
$('checkAll').onchange=()=>{const vis=visible();if($('checkAll').checked)vis.forEach(r=>selected.add(r.key));else vis.forEach(r=>selected.delete(r.key));renderList()};
$('genMissing').onclick=()=>generate(['name','phrase','question'].flatMap(k=>rows[k]).filter(r=>r.status!=='ok'));
$('genStop').onclick=()=>{stopping=true;tell('Sẽ dừng sau nhóm hiện tại.')};
$('refresh').onclick=()=>reload();
$('bulkPlay').onclick=()=>playRows(chosen());
$('bulkRegen').onclick=()=>generate(chosen(),$('styleOverride').value);
$('bulkDelete').onclick=()=>remove(chosen());
$('profilePick').onchange=()=>{$('profileApply').disabled=running||$('profilePick').value===VOICE};
$('profilePreview').onclick=previewProfile;$('profileApply').onclick=applyProfile;
$('pin').value=store.get(PIN_KEY,sessionStorage)||'';$('rememberPin').checked=!!$('pin').value||store.get(PIN_KEY+':on')==='1';
$('rememberPin').onchange=()=>{store.set(PIN_KEY+':on',$('rememberPin').checked?'1':'0');store.set(PIN_KEY,$('rememberPin').checked&&verified?verified:null,sessionStorage)};
$('consent').checked=store.get(CONSENT_KEY)==='1';$('consent').onchange=()=>store.set(CONSENT_KEY,$('consent').checked?'1':null);
if(EMBED)document.body.classList.add('embed');
$('loginForm').onsubmit=async e=>{
 e.preventDefault();$('loginStatus').textContent='Đang đăng nhập...';
 const {data,error}=await c.auth.signInWithPassword({email:$('loginEmail').value.trim(),password:$('loginPass').value});
 $('loginPass').value='';
 if(error){$('loginStatus').textContent='⚠ '+error.message;$('loginStatus').classList.add('error');return}
 await enter(data.user);
};
$('logoutButton').onclick=async()=>{await c.auth.signOut();location.reload()};
window.addEventListener('unhandledrejection',e=>tell('⚠ '+message(e.reason),true));
window.__unifiedVoiceTest={state:()=>({embed:EMBED,scope:SCOPE,voice:VOICE,tab,running,loaded,
 counts:Object.fromEntries(['name','phrase','question'].map(k=>[k,{total:rows[k].length,ok:rows[k].filter(r=>r.status==='ok').length,missing:rows[k].filter(r=>r.status==='missing').length,stale:rows[k].filter(r=>r.status==='stale').length}])),
 old:Object.fromEntries(old)}),rows:k=>rows[k].map(({key,status,style,text,groupLabel,url})=>({key,status,style,text,groupLabel,hasUrl:!!url}))};
(async()=>{
 try{c=CS.createClient()}catch(e){$('loginStatus').textContent='⚠ '+message(e);return}
 const {data:{session}}=await c.auth.getSession();
 if(session?.user)await enter(session.user);
})();
})();
