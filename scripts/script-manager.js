/* MotionClass · Trang Quản lý kịch bản lời dẫn.
 * Tối ưu lượt Google AI Studio (tài khoản miễn phí):
 *  1. Mỗi đoạn câu dẫn khóa theo SHA-256 nội dung + giọng → dùng chung giữa mọi kịch bản, không tạo lại.
 *  2. Gom nhiều đoạn vào một lượt gọi (xếp lô kiểu first-fit giảm dần theo thời lượng ước tính).
 *  3. WAV gốc giữ 7 ngày trong IndexedDB → cắt lại không cần gọi Google.
 *  4. Gọi tuần tự, giãn cách 22,5 giây, dừng ngay khi gặp 429; bộ đếm lượt/ngày dùng chung với
 *     tạo giọng tên học sinh và ngân hàng câu hỏi (chỉ là cơ chế bảo vệ trên trình duyệt).
 *  5. Không lưu WAV nào chưa được giáo viên nghe hết và duyệt.
 */
(function(){
'use strict';
const $=id=>document.getElementById(id);
const S=window.TeacherScriptStore,AUDIO=window.QuestionBatchAudio;
const API_CHARS=1800,PAUSE=.72,RPM_GAP=22500,DAY_CAP=10,SEP='\n\n\n\n';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const message=e=>String(e?.message||e||'Không rõ lỗi').slice(0,320);
const el=(tag,text,cls)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n};
function tell(id,text,bad=false){const n=$(id);if(!n)return;n.textContent=text;n.classList.toggle('error',bad)}

/* ---------- Ước tính & gom lô ---------- */
const words=t=>S.norm(t).split(' ').filter(Boolean).length;
function estimatedSeconds(text){return Math.max(1.1,words(text)/2.25)+PAUSE}
function estimatedTokens(text){return Math.ceil([...text].length*.75+words(text)*.55+24)}
/** First-fit giảm dần: đoạn dài xếp trước để lấp đầy lô, giảm tổng số lượt gọi. */
function pack(entries,{maxChars=1600,maxSeconds=58,maxSegments=20}={}){
 maxChars=Math.min(API_CHARS,Math.max(300,maxChars));
 const items=entries.map((e,i)=>({...e,i,sec:estimatedSeconds(e.text),len:[...e.text].length}))
  .sort((a,b)=>b.sec-a.sec||b.len-a.len);
 const batches=[],rejected=[];
 for(const item of items){
  if(item.len>maxChars||item.sec>maxSeconds){rejected.push(item);continue}
  let target=null;
  for(const b of batches){
   if(b.entries.length>=maxSegments)continue;
   if(b.chars+SEP.length+item.len>maxChars||b.seconds+item.sec>maxSeconds)continue;
   target=b;break;
  }
  if(!target){target={entries:[],chars:-SEP.length,seconds:0};batches.push(target)}
  target.entries.push(item);target.chars+=SEP.length+item.len;target.seconds+=item.sec;
 }
 for(const b of batches){
  b.entries.sort((a,c)=>a.i-c.i);
  b.text=b.entries.map(e=>e.text).join(SEP);b.chars=[...b.text].length;b.tokens=estimatedTokens(b.text);
 }
 return{batches,rejected};
}

/* ---------- Bộ đếm lượt (dùng chung với các công cụ khác) ---------- */
const quotaDay=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/Los_Angeles',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const quotaKey=()=>'motionclass:classroom20:requests:'+quotaDay();
const rateKey='motionclass:classroom20:last-request';
const get=k=>{try{return localStorage.getItem(k)}catch(_){return null}};
const put=(k,v)=>{try{localStorage.setItem(k,String(v))}catch(_){}};
const usedToday=()=>Number(get(quotaKey()))||0;

/* ---------- WAV gốc trên thiết bị ---------- */
function openDB(){return new Promise((yes,no)=>{
 if(!window.indexedDB)return no(Error('Không hỗ trợ IndexedDB'));
 const req=indexedDB.open('motionclass-script-phrases-raw-v1',1);
 req.onupgradeneeded=()=>req.result.createObjectStore('wav');req.onsuccess=()=>yes(req.result);req.onerror=()=>no(req.error);
})}
async function rawGet(k){try{const db=await openDB(),v=await new Promise((yes,no)=>{const r=db.transaction('wav','readonly').objectStore('wav').get(k);r.onsuccess=()=>yes(r.result);r.onerror=()=>no(r.error)});db.close();return v&&Date.now()-v.date<7*864e5?v.blob:null}catch(_){return null}}
async function rawPut(k,blob){try{const db=await openDB();await new Promise((yes,no)=>{const t=db.transaction('wav','readwrite');t.objectStore('wav').put({date:Date.now(),blob},k);t.oncomplete=yes;t.onerror=()=>no(t.error)});db.close()}catch(_){}}

/* ---------- Trạng thái ---------- */
let c=null,scripts=[],currentId=null,voice=null,library=[],libByText=new Map(),dirty=false;
let genSelected=new Set(),running=false,stopping=false,verifiedCode='',reviews=[],urls=[];

function coverage(script){
 const phrases=S.scriptPhrases(script);
 const have=phrases.filter(p=>libByText.has(p.text)).length;
 return{have,total:phrases.length,phrases};
}
function setLibrary(rows){library=rows;libByText=new Map(rows.map(r=>[S.norm(r.phrase),r]))}

/* ---------- Đăng nhập ---------- */
async function boot(){
 try{c=S.createClient()}catch(e){tell('loginStatus',message(e),true);return}
 const {data:{session}}=await c.auth.getSession();
 if(session?.user)await enter(session.user);
 c.auth.onAuthStateChange((evt)=>{if(evt==='SIGNED_OUT'){$('appPanel').hidden=true;$('loginPanel').hidden=false}});
}
$('loginForm').onsubmit=async e=>{
 e.preventDefault();tell('loginStatus','Đang đăng nhập...');
 const {data,error}=await c.auth.signInWithPassword({email:$('loginEmail').value.trim(),password:$('loginPass').value});
 $('loginPass').value='';
 if(error)return tell('loginStatus','⚠ '+error.message,true);
 await enter(data.user);
};
$('logoutButton').onclick=async()=>{if(reviews.length&&!confirm('Còn WAV chưa lưu trong khung nghe duyệt. Vẫn đăng xuất?'))return;await c.auth.signOut()};
async function enter(user){
 $('loginPanel').hidden=true;$('appPanel').hidden=false;$('userEmail').textContent=user.email||'';
 await refreshAll();
}
async function checkStudio(){
 try{
  const res=await fetch('/api/marble-tts',{cache:'no-store'});
  const info=res.ok?await res.json():{};
  if(!info.configured||!/^[a-f0-9]{16}$/.test(info.voiceVersion||''))throw Error('Google AI Studio chưa được cấu hình trên Vercel.');
  voice='studio:'+info.voiceVersion;$('studioVoice').value=voice+(info.voiceType==='custom'?' · giọng riêng':' · giọng mặc định');
 }catch(e){voice=null;$('studioVoice').value='Chưa kết nối được Google AI Studio';tell('genStatus','⚠ '+message(e),true)}
}
async function refreshAll(){
 try{
  [scripts]=await Promise.all([S.listScripts(c),checkStudio()]);
  setLibrary(voice?await S.listPhraseAudio(c,{voiceId:voice}):[]);
  if(currentId&&!scripts.some(s=>s.id===currentId))currentId=null;
  if(!genSelected.size&&scripts.length)genSelected=new Set(scripts.filter(s=>s.isActive).slice(0,1).map(s=>s.id));
  for(const id of [...genSelected])if(!scripts.some(s=>s.id===id))genSelected.delete(id);
  renderList();renderEditor();renderPlan();renderLibrary();
 }catch(e){tell('editorStatus','⚠ '+message(e),true);
  if(/relation .* does not exist|teacher_voice_scripts/i.test(message(e)))tell('editorStatus','⚠ Cơ sở dữ liệu chưa có bảng kịch bản. Cần áp dụng migration teacher_voice_scripts.',true)}
}

/* ---------- Danh sách ---------- */
for(const t of S.TEMPLATES)$('templatePick').append(new Option(t.title,t.theme));
$('templatePick').value=S.TEMPLATES[0].theme;
async function create(input){
 if(dirty&&!confirm('Kịch bản đang sửa chưa lưu. Bỏ thay đổi?'))return;
 try{const saved=await S.saveScript(c,input);dirty=false;currentId=saved.id;genSelected.add(saved.id);await refreshAll();tell('editorStatus','✅ Đã tạo kịch bản “'+saved.title+'”.')}
 catch(e){tell('editorStatus','⚠ '+message(e),true)}
}
$('newFromTemplate').onclick=()=>{const t=S.TEMPLATES.find(x=>x.theme===$('templatePick').value)||S.TEMPLATES[0];create(JSON.parse(JSON.stringify(t)))};
$('newBlank').onclick=()=>create({title:'Kịch bản mới',theme:'custom',slots:{call:['Mời em {tên} trả lời. Câu hỏi số {số}.'],correct:['Chính xác! {đáp án} Chúc mừng em {tên}!'],wrong:['Chưa chính xác rồi. {đáp án} Em cố gắng hơn nhé!']}});
function renderList(){
 const root=$('scriptList');root.replaceChildren();
 if(!scripts.length)root.append(el('p','Chưa có kịch bản. Hãy tạo từ một mẫu.','tiny'));
 for(const s of scripts){
  const cov=coverage(s),item=el('div',undefined,'script-item'+(s.id===currentId?' active':''));
  item.append(el('strong',(s.isActive?'':'⏸ ')+s.title),el('span',cov.have+'/'+cov.total+' đoạn có giọng','tiny'));
  const meter=el('div',undefined,'meter'),bar=el('i');bar.style.width=(cov.total?Math.round(cov.have/cov.total*100):0)+'%';meter.append(bar);item.append(meter);
  item.onclick=()=>{if(s.id===currentId)return;if(dirty&&!confirm('Kịch bản đang sửa chưa lưu. Bỏ thay đổi?'))return;dirty=false;currentId=s.id;renderList();renderEditor();renderLibrary()};
  root.append(item);
 }
}

/* ---------- Soạn kịch bản ---------- */
function current(){return scripts.find(s=>s.id===currentId)||null}
function draft(){
 const slots={};
 for(const slot of S.SLOTS)slots[slot.key]=($('slot-'+slot.key)?.value||'').split('\n').map(S.norm).filter(Boolean);
 slots.options={maxNumber:Number($('maxNumber').value)||20};
 return{title:$('scriptTitle').value,theme:current()?.theme||'custom',slots,isActive:$('scriptActive').value==='1'};
}
function previewLine(template){
 const line=el('div',undefined,'preview-line');
 try{
  for(const t of S.tokenize(template)){
   if(t.type==='text'){const ok=libByText.has(t.text);const n=el(ok?'u':'span',t.text+' ');n.title=ok?'Đã có WAV':'Chưa có WAV';line.append(n)}
   else if(t.type==='bound'){const sample=S.boundText(t,3),n=el(libByText.has(sample)?'u':'span',sample+' ');n.title='Ví dụ với câu số 3';line.append(n)}
   else line.append(el('b',t.type==='name'?'[tên học sinh]':t.type==='answer'?'[WAV đáp án]':'[số '+t.key+']'),document.createTextNode(' '));
  }
 }catch(_){line.textContent=''}
 return line;
}
function renderEditor(){
 const s=current();
 $('emptyState').hidden=!!s;$('editor').hidden=!s;
 $('voicePanel').hidden=!scripts.length;$('libraryPanel').hidden=!scripts.length;
 if(!s)return;
 $('editorTitle').textContent='✏️ '+s.title;$('scriptTitle').value=s.title;
 $('maxNumber').value=s.slots?.options?.maxNumber||20;$('scriptActive').value=s.isActive?'1':'0';
 const root=$('slotEditor');root.replaceChildren();
 for(const slot of S.SLOTS){
  const box=el('div',undefined,'slot'),h=el('h3');h.append(el('span',slot.label));
  const chips=el('div',undefined,'chips');
  for(const key of slot.allowed){const b=el('button','{'+key+'}','small');b.type='button';b.onclick=()=>{const ta=$('slot-'+slot.key),p=ta.selectionStart??ta.value.length;ta.value=ta.value.slice(0,p)+'{'+key+'}'+ta.value.slice(ta.selectionEnd??p);ta.focus();ta.dispatchEvent(new Event('input'))};chips.append(b)}
  h.append(chips);box.append(h,el('div',slot.hint,'tiny'));
  const ta=el('textarea');ta.id='slot-'+slot.key;ta.rows=Math.max(2,(s.slots?.[slot.key]||[]).length+1);ta.value=(s.slots?.[slot.key]||[]).join('\n');
  ta.setAttribute('aria-label',slot.label+' – mỗi dòng một cách nói');
  const preview=el('div');
  const update=()=>{preview.replaceChildren(...ta.value.split('\n').map(S.norm).filter(Boolean).slice(0,4).map(previewLine))};
  ta.oninput=()=>{dirty=true;update()};update();
  box.append(ta,preview);root.append(box);
 }
 for(const id of ['scriptTitle','maxNumber','scriptActive'])$(id).oninput=$(id).onchange=()=>{dirty=true};
}
$('saveScript').onclick=async()=>{
 const s=current();if(!s)return;
 try{S.cleanScript(draft());const saved=await S.saveScript(c,draft(),s.id);dirty=false;currentId=saved.id;await refreshAll();tell('editorStatus','✅ Đã lưu kịch bản. Các đoạn mới sẽ hiện trong kế hoạch tạo giọng.')}
 catch(e){tell('editorStatus','⚠ '+message(e),true)}
};
$('deleteScript').onclick=async()=>{
 const s=current();if(!s||!confirm('Xóa kịch bản “'+s.title+'”? WAV câu dẫn vẫn giữ trong kho để kịch bản khác dùng chung.'))return;
 try{await S.deleteScript(c,s.id);dirty=false;currentId=null;genSelected.delete(s.id);await refreshAll();tell('editorStatus','Đã xóa kịch bản.')}
 catch(e){tell('editorStatus','⚠ '+message(e),true)}
};

/* ---------- Kế hoạch tạo giọng ---------- */
function limits(){return{maxChars:Number($('limitChars').value)||1600,maxSeconds:Number($('limitSeconds').value)||58,maxSegments:Number($('limitSegments').value)||20}}
function missingPhrases(){
 const all=new Map();let total=0;
 for(const s of scripts.filter(x=>genSelected.has(x.id))){
  for(const p of S.scriptPhrases(s)){total++;if(!all.has(p.text))all.set(p.text,{...p,scripts:[s.title]});else all.get(p.text).scripts.push(s.title)}
 }
 const unique=[...all.values()],missing=unique.filter(p=>!libByText.has(p.text));
 return{total,unique,missing};
}
function renderPlan(){
 const box=$('genScripts');box.replaceChildren();
 for(const s of scripts){
  const label=el('label',undefined,'chip');label.style.cursor='pointer';const cb=el('input');cb.type='checkbox';cb.style.width='auto';cb.style.marginRight='6px';
  cb.checked=genSelected.has(s.id);cb.onchange=()=>{cb.checked?genSelected.add(s.id):genSelected.delete(s.id);renderPlan()};
  label.append(cb,document.createTextNode(s.title));box.append(label);
 }
 const {total,unique,missing}=missingPhrases(),p=pack(missing,limits());
 $('qNeeded').textContent=missing.length;
 $('qReuse').textContent=unique.length?'Đã có sẵn '+(unique.length-missing.length)+'/'+unique.length+' đoạn · gộp trùng '+(total-unique.length)+' đoạn':'';
 $('qCalls').textContent=p.batches.length;
 $('qSegments').textContent=missing.length?'≈ '+(missing.length/Math.max(1,p.batches.length)).toFixed(1)+' đoạn/lượt':'';
 const used=usedToday();$('qToday').textContent=used+'/'+DAY_CAP;
 const list=$('planList');list.replaceChildren();
 p.batches.forEach((b,i)=>list.append(el('li','Lượt '+(i+1)+': '+b.entries.length+' đoạn · '+b.chars+' ký tự · ~'+Math.round(b.seconds)+' giây · ~'+b.tokens+' token ước tính')));
 if(p.rejected.length)list.append(el('li','⚠ '+p.rejected.length+' đoạn quá dài so với giới hạn lô, hãy rút ngắn.'));
 const left=DAY_CAP-used;
 $('genStart').disabled=running||!voice||!missing.length||left<=0;
 $('genStart').textContent=!missing.length?'✅ Các kịch bản đã chọn đủ giọng':left<p.batches.length?'⚡ Tạo '+Math.max(0,left)+'/'+p.batches.length+' lượt hôm nay (phần còn lại để ngày mai)':'⚡ Tạo giọng '+missing.length+' đoạn bằng '+p.batches.length+' lượt Google';
 return p;
}
for(const id of ['limitChars','limitSeconds','limitSegments'])$(id).onchange=renderPlan;

/* ---------- Gọi Google ---------- */
async function verifyCode(code){
 if(verifiedCode===code)return;
 const res=await fetch('/api/marble-tts',{method:'POST',headers:{'Content-Type':'application/json','X-Marble-Teacher-Code':code},body:JSON.stringify({verifyOnly:true})});
 const body=await res.json().catch(()=>({}));
 if(!res.ok||body.verified!==true)throw Error(res.status===403?'Mã giáo viên không đúng (MARBLE_TTS_PIN trên Vercel, không phải Gemini API key).':(body.error||'Chưa kiểm tra được mã giáo viên.'));
 verifiedCode=code;
}
async function waitSlot(){
 let remaining=Math.max(0,RPM_GAP-(Date.now()-(Number(get(rateKey))||0)));
 while(remaining>0){if(stopping)throw Error('Đã dừng theo yêu cầu.');tell('genStatus','⏳ Chờ '+Math.ceil(remaining/1000)+' giây để tôn trọng giới hạn yêu cầu/phút...');await sleep(Math.min(950,remaining));remaining=Math.max(0,RPM_GAP-(Date.now()-(Number(get(rateKey))||0)))}
}
async function fetchBatch(batch,code){
 const key='phrases:'+await S.hashText(voice+'|'+batch.text);
 let blob=await rawGet(key),fromCache=Boolean(blob);
 if(!blob){
  if(usedToday()>=DAY_CAP)throw Object.assign(Error('Đã dùng '+DAY_CAP+' lượt Google hôm nay trên trình duyệt này. Phần còn lại hãy tạo vào ngày mai.'),{quota:true});
  await waitSlot();if(stopping)throw Error('Đã dừng.');
  const prev=usedToday(),lastAt=get(rateKey),sentAt=Date.now();put(quotaKey(),prev+1);put(rateKey,sentAt);renderPlan();
  const res=await fetch('/api/marble-tts',{method:'POST',headers:{'Content-Type':'application/json','X-Marble-Teacher-Code':code},body:JSON.stringify({batch:true,classroom20:true,text:batch.text})});
  if(!res.ok){
   const body=await res.json().catch(()=>({}));
   // Bị từ chối trước khi tới Google: hoàn lại lượt đếm cục bộ.
   if([400,401,403,413,422].includes(res.status)){if(usedToday()===prev+1)put(quotaKey(),prev);if(get(rateKey)===String(sentAt))put(rateKey,lastAt||0);renderPlan()}
   throw Object.assign(Error(body.error||'Google HTTP '+res.status),{status:res.status});
  }
  blob=await res.blob();
  if(blob.size<45||blob.size>10*1024*1024)throw Error('WAV trả về trống hoặc vượt 10 MB.');
  await rawPut(key,blob);
 }
 const head=new Uint8Array(await blob.slice(0,12).arrayBuffer());
 if(String.fromCharCode(...head.slice(0,4))!=='RIFF'||String.fromCharCode(...head.slice(8,12))!=='WAVE')throw Error('Dịch vụ không trả WAV hợp lệ.');
 const A=window.AudioContext||window.webkitAudioContext;if(!A)throw Error('Trình duyệt chưa hỗ trợ cắt sóng âm.');
 const ctx=new A();
 try{
  const decoded=await ctx.decodeAudioData(await blob.arrayBuffer());
  const parts=AUDIO.locate(decoded,batch.entries.map(e=>({...e,text:e.text})));
  if(parts.segments.length!==batch.entries.length)throw Error('Không cắt đủ đoạn; WAV gốc vẫn được giữ trên thiết bị.');
  for(const seg of parts.segments)showReview(seg,voice);
 }finally{ctx.close().catch(()=>{})}
 return fromCache;
}
$('genStart').onclick=async()=>{
 if(running)return;
 if(dirty){tell('genStatus','Hãy lưu kịch bản đang sửa trước khi tạo giọng.',true);return}
 const code=$('studioPin').value;
 if(!code.trim())return tell('genStatus','Cần nhập mã giáo viên AI Studio (MARBLE_TTS_PIN).',true);
 const p=renderPlan();if(!p.batches.length)return;
 const left=DAY_CAP-usedToday(),planned=Math.min(left,p.batches.length);
 if(!confirm('Tạo giọng '+p.batches.slice(0,planned).reduce((a,b)=>a+b.entries.length,0)+' đoạn câu dẫn bằng '+planned+' lượt Google AI Studio?\nChỉ gửi nội dung câu dẫn, không gửi tên học sinh.'))return;
 running=true;stopping=false;$('genStop').disabled=false;renderPlan();
 let done=0,cached=0;
 try{
  await verifyCode(code);
  for(const batch of p.batches){
   if(stopping)break;
   tell('genStatus','🎙️ Đang tạo lượt '+(done+1)+'/'+p.batches.length+' ('+batch.entries.length+' đoạn)...');
   try{if(await fetchBatch(batch,code))cached++;done++}
   catch(e){
    const tail=e.status===429?' Google đang giới hạn lượt (429) – đã dừng, không gửi thêm yêu cầu.':'';
    tell('genStatus','⚠ Dừng sau '+done+'/'+p.batches.length+' lượt: '+message(e)+tail+' Các đoạn đã tạo vẫn ở khung nghe duyệt.',true);return;
   }
  }
  tell('genStatus','✅ Đã tạo '+done+' lượt'+(cached?' ('+cached+' lượt lấy lại từ WAV gốc trên thiết bị, không tốn lượt Google)':'')+'. Hãy nghe và duyệt '+reviews.length+' đoạn trước khi lưu.');
 }catch(e){tell('genStatus','⚠ '+message(e),true)}
 finally{running=false;$('genStop').disabled=true;renderPlan();updateReviewButtons()}
};
$('genStop').onclick=()=>{stopping=true;tell('genStatus','Sẽ dừng sau lượt hiện tại, không gọi thêm Google.')};

/* ---------- Nghe duyệt ---------- */
function renderWave(canvas,channels,start,end,duration){
 const x=canvas.getContext('2d');if(!x)return;const w=canvas.width,h=canvas.height,src=channels[0],n=src.length;
 x.fillStyle='#edf4ff';x.fillRect(0,0,w,h);x.fillStyle='#cee7ff';x.fillRect(w*start/duration,0,w*(end-start)/duration,h);
 for(let p=0;p<w;p++){const a=Math.floor(p*n/w),b=Math.min(n,Math.floor((p+1)*n/w));let amp=0;for(let j=a;j<b;j++)amp=Math.max(amp,Math.abs(src[j]));const span=Math.max(1,amp*h*.92);x.fillStyle=p>=w*start/duration&&p<=w*end/duration?'#1669d0':'#93a8c4';x.fillRect(p,(h-span)/2,1.5,span)}
 x.fillStyle='#0f59bb';x.fillRect(w*start/duration,0,2,h);x.fillRect(w*end/duration,0,2,h);
}
function showReview(seg,voiceId){
 $('reviewPanel').hidden=false;
 const duration=seg.max,wrap=el('div',undefined,'review');
 wrap.append(el('strong','“'+seg.entry.text+'”'),el('div',(seg.quality==='candidate'?'Điểm cắt ước tính theo khoảng lặng. ':'⚠ Cần chỉnh điểm cắt. ')+seg.note,'tiny'));
 const canvas=el('canvas');canvas.width=560;canvas.height=70;wrap.append(canvas);
 const ctrl=el('div',undefined,'split'),a=el('input'),b=el('input');
 for(const r of [a,b]){r.type='range';r.min='0';r.max=String(Math.round(duration*100));r.step='1'}
 a.value=String(Math.round(seg.start*100));b.value=String(Math.round(seg.end*100));
 const la=el('label','Bắt đầu'),lb=el('label','Kết thúc'),ca=el('div'),cb=el('div');ca.append(la,a);cb.append(lb,b);ctrl.append(ca,cb);wrap.append(ctrl);
 const times=el('div','','tiny'),audio=el('audio');audio.controls=true;audio.preload='auto';
 const approve=el('label'),check=el('input');check.type='checkbox';check.disabled=true;check.style.width='auto';
 approve.append(check,document.createTextNode(' Đã nghe hết, đoạn đọc đủ và không lẫn đoạn khác'));
 wrap.append(times,audio,approve);
 const state={entry:seg.entry,voiceId,listened:false,approved:false,blob:null,wrap,audio,check};
 const reclip=()=>{
  let s=Number(a.value)/100,e=Number(b.value)/100;
  if(e-s<.17){if(document.activeElement===a){s=Math.max(0,e-.17);a.value=String(Math.round(s*100))}else{e=Math.min(duration,s+.17);b.value=String(Math.round(e*100))}}
  try{state.blob=AUDIO.wavPCM(seg.channels,seg.rate,s,e)}catch(err){times.textContent='⚠ '+message(err);return}
  if(state.url)URL.revokeObjectURL(state.url);state.url=URL.createObjectURL(state.blob);urls.push(state.url);audio.src=state.url;
  times.textContent='Cắt '+s.toFixed(2)+'–'+e.toFixed(2)+' giây';
  state.listened=state.approved=false;check.checked=false;check.disabled=true;wrap.classList.remove('ok');
  renderWave(canvas,seg.channels,s,e,duration);updateReviewButtons();
 };
 a.oninput=b.oninput=reclip;
 audio.onended=()=>{state.listened=true;check.disabled=false;updateReviewButtons()};
 check.onchange=()=>{state.approved=state.listened&&check.checked;wrap.classList.toggle('ok',state.approved);updateReviewButtons()};
 reclip();reviews.push(state);$('reviewList').append(wrap);updateReviewButtons();
}
function updateReviewButtons(){
 $('saveApproved').disabled=running||!reviews.some(r=>r.approved);
 $('approveListened').disabled=!reviews.some(r=>r.listened&&!r.approved);
 $('playAll').disabled=!reviews.length;
 $('reviewPanel').hidden=!reviews.length;
}
let playAllRun=0;
$('playAll').onclick=async()=>{
 const token=++playAllRun;
 for(const r of reviews){
  if(token!==playAllRun)return;
  if(r.listened)continue;
  r.wrap.scrollIntoView({block:'nearest',behavior:'smooth'});
  await new Promise(done=>{const end=()=>{r.audio.removeEventListener('ended',end);r.audio.removeEventListener('error',end);done()};r.audio.addEventListener('ended',end);r.audio.addEventListener('error',end);r.audio.currentTime=0;r.audio.play().catch(end)});
  await sleep(250);
 }
};
$('approveListened').onclick=()=>{for(const r of reviews)if(r.listened&&!r.approved){r.check.checked=true;r.approved=true;r.wrap.classList.add('ok')}updateReviewButtons()};
$('saveApproved').onclick=async()=>{
 const chosen=reviews.filter(r=>r.approved);if(!chosen.length)return;
 if(!confirm('Lưu '+chosen.length+' WAV câu dẫn đã duyệt vào kho riêng tư?'))return;
 running=true;updateReviewButtons();let saved=0;
 try{
  for(const r of chosen){
   await S.savePhraseAudio(c,{voiceId:r.voiceId,phrase:r.entry.text,blob:r.blob});
   saved++;r.wrap.remove();reviews=reviews.filter(x=>x!==r);tell('genStatus','☁ Đã lưu '+saved+'/'+chosen.length+' WAV...');
  }
  setLibrary(await S.listPhraseAudio(c,{voiceId:voice}));
  tell('genStatus','✅ Đã lưu '+saved+' WAV câu dẫn. '+(reviews.length?reviews.length+' đoạn còn chờ duyệt.':''));
 }catch(e){tell('genStatus','⚠ Lưu được '+saved+' WAV; lỗi: '+message(e),true)}
 finally{running=false;renderList();renderEditor();renderPlan();renderLibrary();updateReviewButtons()}
};
window.addEventListener('beforeunload',e=>{if(reviews.length){e.preventDefault();e.returnValue=''}});

/* ---------- Kho WAV ---------- */
function usage(){
 const map=new Map();
 for(const s of scripts)for(const p of S.scriptPhrases(s)){if(!map.has(p.text))map.set(p.text,[]);map.get(p.text).push(s.title)}
 return map;
}
function renderLibrary(){
 const root=$('libraryList');root.replaceChildren();const used=usage();
 const unused=library.filter(r=>!used.has(S.norm(r.phrase)));
 $('libraryInfo').textContent=voice?library.length+' WAV với giọng '+voice+(unused.length?' · '+unused.length+' WAV không còn kịch bản nào dùng':''):'Chưa xác định được giọng Google.';
 $('cleanUnused').disabled=!unused.length;
 for(const r of [...library].sort((a,b)=>a.phrase.localeCompare(b.phrase,'vi'))){
  const row=el('div',undefined,'lib-row'),who=used.get(S.norm(r.phrase));
  row.append(el('span',r.phrase),el('span',who?[...new Set(who)].length+' kịch bản':'không dùng','tag'+(who?'':' unused')));
  if(r.url){const au=el('audio');au.controls=true;au.preload='none';au.src=r.url;row.append(au)}
  const del=el('button','✕','small red');del.type='button';del.title='Xóa WAV này';
  del.onclick=async()=>{if(!confirm('Xóa WAV “'+r.phrase+'”? Lần sau cần tạo lại sẽ tốn lượt Google.'))return;try{await S.deletePhraseAudio(c,r);setLibrary(await S.listPhraseAudio(c,{voiceId:voice}));renderList();renderEditor();renderPlan();renderLibrary()}catch(e){tell('genStatus','⚠ '+message(e),true)}};
  row.append(del);root.append(row);
 }
}
$('cleanUnused').onclick=async()=>{
 const used=usage(),unused=library.filter(r=>!used.has(S.norm(r.phrase)));
 if(!unused.length||!confirm('Xóa '+unused.length+' WAV không còn kịch bản nào dùng?'))return;
 try{for(const r of unused)await S.deletePhraseAudio(c,r);setLibrary(await S.listPhraseAudio(c,{voiceId:voice}));renderList();renderPlan();renderLibrary()}catch(e){tell('genStatus','⚠ '+message(e),true)}
};

/* ---------- Nghe thử kịch bản ---------- */
let previewRun=0;
function speak(text,token){return new Promise(done=>{
 if(token!==previewRun||!('speechSynthesis' in window))return done();
 const u=new SpeechSynthesisUtterance(text);u.lang='vi-VN';u.rate=.95;u.onend=u.onerror=()=>done();
 const guard=setTimeout(done,1500+text.length*110);u.onend=()=>{clearTimeout(guard);done()};speechSynthesis.speak(u);
})}
function playUrl(url,token){return new Promise(done=>{if(token!==previewRun)return done();const a=new Audio(url);a.onended=a.onerror=()=>done();a.play().catch(()=>done())})}
$('previewScript').onclick=async()=>{
 const s=current();if(!s)return;const token=++previewRun;try{speechSynthesis.cancel()}catch(_){}
 const pickFirst=key=>(dirty?draft():s).slots?.[key]?.[0];
 const sample={name:'Nguyễn Văn An',question:'Đây là câu hỏi mẫu.',answer:'Đáp án đúng là phương án B. Bàn phím.'};
 for(const key of ['intro','call','think','correct','wrong']){
  const template=pickFirst(key);if(!template)continue;
  for(const t of S.tokenize(template)){
   if(token!==previewRun)return;
   if(t.type==='text'||t.type==='bound'){const text=t.type==='text'?t.text:S.boundText(t,3),row=libByText.get(text);if(row?.url)await playUrl(row.url,token);else await speak(text,token)}
   else if(t.type==='name')await speak(sample.name,token);
   else if(t.type==='answer')await speak(sample.answer,token);
   else await speak('mười',token);
   await sleep(110);
  }
  if(key==='call')await speak(sample.question,token);
  await sleep(450);
 }
};

window.__scriptManagerTest={pack,estimatedSeconds,state:()=>({scripts:scripts.length,currentId,voice,library:library.length,reviews:reviews.length,running,genSelected:[...genSelected]})};
boot().catch(e=>tell('loginStatus','⚠ '+message(e),true));
})();
