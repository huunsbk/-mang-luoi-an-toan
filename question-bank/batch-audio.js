/* MotionClass Gemini TTS batcher. No audio uploads before human review.
   Text-to-boundary alignment is heuristic; listening is compulsory. */
(function(){
'use strict';
const PARTS=['question','option_a','option_b','option_c','option_d','answer','full'];
const CAP=60, MAX_SEGMENTS=5;
const $=id=>document.getElementById(id);
const key=e=>e.id+'/'+e.part;
const format=n=>Number(n).toFixed(2);
const err=e=>String(e?.message||e||'Không rõ lỗi').slice(0,300);
function wavPCM(channels,rate,start,end){
 const a=channels[0],lo=Math.max(0,Math.floor(start*rate)),hi=Math.min(a.length,Math.ceil(end*rate));
 if(hi-lo<rate*0.15)throw Error('Đoạn âm thanh quá ngắn, vui lòng chỉnh lại điểm cắt.');
 const count=hi-lo,raw=new ArrayBuffer(44+count*2),v=new DataView(raw);
 function str(p,s){for(let i=0;i<s.length;i++)v.setUint8(p+i,s.charCodeAt(i))}
 str(0,'RIFF');v.setUint32(4,36+count*2,true);str(8,'WAVE');str(12,'fmt ');
 v.setUint32(16,16,true);v.setUint16(20,1,true);v.setUint16(22,1,true);
 v.setUint32(24,rate,true);v.setUint32(28,rate*2,true);v.setUint16(32,2,true);
 v.setUint16(34,16,true);str(36,'data');v.setUint32(40,count*2,true);
 for(let i=0;i<count;i++){
  let x=0;for(const channel of channels)x+=channel[lo+i]||0;
  x=Math.max(-1,Math.min(1,x/channels.length));
  v.setInt16(44+i*2,x<0?Math.round(x*32768):Math.round(x*32767),true);
 }
 return new Blob([raw],{type:'audio/wav'});
}
function energyMap(channel,rate){
 const step=Math.max(1,Math.round(rate*0.02)),out=[];
 for(let start=0;start<channel.length;start+=step){
  let sum=0,end=Math.min(channel.length,start+step);
  for(let i=start;i<end;i++)sum+=channel[i]*channel[i];
  out.push(Math.sqrt(sum/(end-start)));
 }
 return {samples:out,frame:step/rate};
}
function locate(buffer,entries){
 const mono=new Float32Array(buffer.length);
 for(let c=0;c<buffer.numberOfChannels;c++){
  const channel=buffer.getChannelData(c);
  for(let i=0;i<mono.length;i++)mono[i]+=channel[i]/buffer.numberOfChannels;
 }
 const {samples,frame}=energyMap(mono,buffer.sampleRate);
 const peaks=[...samples].sort((a,b)=>a-b);
 const high=peaks[Math.floor(peaks.length*0.85)]||0;
 if(high<0.002)throw Error('AI Studio trả WAV gần như im lặng. Không thể cắt.');
 const limit=Math.max(0.003,high*0.14),minRun=10;
 const candidates=[];
 let first=-1;
 for(let i=0;i<=samples.length;i++){
  if(i<samples.length&&samples[i]<limit){if(first<0)first=i}
  else if(first>=0){const frames=i-first;if(frames>=minRun)candidates.push({at:(first+i)*frame/2,width:frames*frame});first=-1}
 }
 const N=entries.length,weights=entries.map(e=>Math.max(12,[...e.text].length)),total=weights.reduce((a,b)=>a+b,0);
 const duration=buffer.duration,bounds=[0],conf=[];
 for(let n=1;n<N;n++){
  const proportion=weights.slice(0,n).reduce((a,b)=>a+b,0)/total;
  const ideal=duration*proportion;
  const prev=bounds[bounds.length-1];
  const available=candidates.filter(p=>p.at>prev+0.28&&p.at<duration-0.28);
  available.sort((a,b)=>Math.abs(a.at-ideal)-Math.min(a.width,0.8)*0.25-(Math.abs(b.at-ideal)-Math.min(b.width,0.8)*0.25));
  const found=available[0];
  const within=found&&Math.abs(found.at-ideal)<Math.max(0.9,duration*0.21);
  const target=within?found.at:Math.max(prev+0.25,Math.min(duration-0.25,ideal));
  bounds.push(target);
  conf.push({found:Boolean(within),gap:found?Math.abs(found.at-ideal):duration,width:within?found.width:0});
 }
 bounds.push(duration);
 const segments=[];
 for(let i=0;i<N;i++){
  const start=bounds[i],end=bounds[i+1],span=end-start,cps=weights[i]/Math.max(span,.1);
  const left=i===0?true:conf[i-1].found,right=i===N-1?true:conf[i].found;
  const feasible=span>.45&&cps>=3&&cps<=43;
  const quality=feasible&&left&&right?'candidate':'needs-review';
  segments.push({entry:entries[i],buffer,start,end,max:duration,channels:Array.from({length:buffer.numberOfChannels},(_,ch)=>buffer.getChannelData(ch)),rate:buffer.sampleRate,quality,
    note:!feasible?'Thời lượng không tương xứng hoặc quá ngắn.':!left||!right?'Không tìm được khoảng lặng rõ gần điểm cắt.':'Điểm cắt dựa vào khoảng lặng; cần nghe để xác nhận đủ chữ.',
    listened:false,approved:false,url:null});
 }
 return {segments,candidates:candidates.length,duration};
}
function plan(entries,maxChars){
 const batches=[],missing=[],single=[],sorted=[...entries];
 for(const e of sorted){
  if(e.text.length>1800){missing.push(e);continue}
  const last=batches[batches.length-1];
  if(last&&last.entries.length<MAX_SEGMENTS&&last.text.length+e.text.length+5<=maxChars){
   last.entries.push(e);last.text+='\n\n\n\n'+e.text;
  }else{
   batches.push({entries:[e],text:e.text,done:false,generated:false,error:null});
  }
 }
 return {batches,missing};
}
function create(ctx){
 let selectedRows=[],groups=[],pending=[],running=false,cancel=false,voice='',generation=0;
 let objects=new Set();
 function status(text,fail=false){const el=$('batchStatus');el.textContent=text;el.classList.toggle('error',fail)}
 function revokeAll(){for(const url of objects)URL.revokeObjectURL(url);objects.clear()}
 function reset(){generation++;cancel=true;revokeAll();groups=[];pending=[];$('batchPlan').replaceChildren();$('batchReviews').replaceChildren();$('batchGenerate').disabled=true;$('batchApproveSave').disabled=true;$('batchDiscard').disabled=true}
 function activeIds(){return selectedRows.map(r=>r.id)}
 function open(){
  if(running){status('Đang tạo WAV. Hãy dừng sau lô hiện tại nếu muốn thay đổi.');return}
  const owned=ctx.rows().filter(r=>ctx.selected().has(r.id)&&r.owned);
  selectedRows=owned.length?owned:(ctx.current()?.owned?[ctx.current()]:[]);
  status('Đã chọn '+selectedRows.length+' câu hỏi thuộc quyền sở hữu. Nhấn Phân tích và lập lô.');
 }
 function setButtons(){
  $('batchGenerate').disabled=running||!groups.some(g=>!g.done);
  $('batchCancel').disabled=!running;
  $('batchAnalyze').disabled=running;
  $('batchApproveSave').disabled=running||!pending.some(x=>x.approved);
  $('batchDiscard').disabled=running||!pending.length;
 }
 async function analyze(){
  if(running)return;
  if(pending.length&&!confirm('Bỏ các đoạn đã cắt nhưng chưa lưu để lập lô mới?'))return;
  reset();
  try{
   if(!selectedRows.length||selectedRows.length>CAP)throw Error('Chọn từ 1 đến '+CAP+' câu hỏi của mình trước khi tạo.');
   const info=await ctx.studioCheck();
   if(!info.configured||!/^[a-f0-9]{16}$/.test(info.voiceVersion))throw Error('Google AI Studio chưa kết nối. Kiểm tra API key/PIN và cấu hình Vercel.');
   voice='studio:'+info.voiceVersion;
   const previous=new Set();
   for(let i=0;i<selectedRows.length;i+=60){
    const files=(await ctx.api('audio.list',{ids:selectedRows.slice(i,i+60).map(r=>r.id),voice_id:voice})).items||[];
    for(const file of files){
     const original=selectedRows.find(x=>x.id===file.id);
     const text=String(original?.spoken?.[file.part]||'').trim();
     if(text&&file.textHash===await ctx.hash(text))previous.add(file.id+'/'+file.part);
    }
   }
   const entries=[];
   for(const q of selectedRows)for(const part of PARTS){
    const text=String(q.spoken?.[part]||'').trim();
    if(!text||previous.has(q.id+'/'+part))continue;
    entries.push({id:q.id,part,text,question:q.text,hash:await ctx.hash(text)});
   }
   const limit=Number($('batchMaxLength').value)||1200,planned=plan(entries,limit);
   groups=planned.batches;
   const surface=$('batchPlan');surface.replaceChildren();
   const head=document.createElement('p');
   head.textContent='Số câu: '+selectedRows.length+' · '+previous.size+' WAV đã có được giữ nguyên · '+entries.length+' đoạn cần tạo · '+groups.length+' lượt AI dự kiến (so với '+entries.length+' lượt tạo riêng).';
   surface.append(head);
   for(let i=0;i<groups.length;i++){
    const g=groups[i],div=document.createElement('div');div.className='batch-job';
    div.textContent='Lô '+(i+1)+': '+g.entries.length+' đoạn · '+[...g.text].length+' ký tự. '+g.entries.map(e=>e.question.slice(0,23)+' / '+e.part).join(' · ');
    surface.append(div);
   }
   if(planned.missing.length){
    const w=document.createElement('p');w.className='batch-quality warning';w.textContent='⚠ '+planned.missing.length+' đoạn vượt giới hạn 1.800 ký tự, chưa thể tạo trong chế độ này.';surface.append(w);
   }
   status(entries.length?'Đã lập lô. Nhấn Tạo và cắt WAV. Không dữ liệu nào được tải lên Supabase.':'Tất cả đoạn âm thanh đã có (hoặc không có nội dung đọc). Không cần gọi Google.');
   setButtons();
  }catch(e){status('⚠ '+err(e),true)}
 }
 async function requestBatch(group){
  const pin=$('batchTeacherPin').value;
  if(!pin.trim())throw Error('Hãy nhập mã giáo viên AI Studio.');
  const response=await fetch('/api/marble-tts',{method:'POST',headers:{'Content-Type':'application/json','X-Marble-Teacher-Code':pin},
   body:JSON.stringify({text:group.text,batch:true})});
  if(!response.ok){
   const message=await response.json().catch(()=>({}));
   const problem=new Error(message.error||'Google AI Studio HTTP '+response.status);
   problem.status=response.status;throw problem;
  }
  const blob=await response.blob();
  if(blob.size<64||blob.size>4*1024*1024)throw Error('WAV dài có kích thước không hợp lệ.');
  const signature=String.fromCharCode(...new Uint8Array(await blob.slice(0,12).arrayBuffer()));
  if(!signature.startsWith('RIFF')||signature.slice(8,12)!=='WAVE')throw Error('Máy chủ không trả WAV hợp lệ.');
  const A=window.AudioContext||window.webkitAudioContext;
  if(!A)throw Error('Trình duyệt không hỗ trợ xử lý WAV bằng Web Audio.');
  const audioContext=new A();
  try{
   const samples=await audioContext.decodeAudioData(await blob.arrayBuffer());
   if(samples.duration<0.4)throw Error('Tệp WAV quá ngắn, có thể Google đã không đọc toàn bộ lô.');
   return locate(samples,group.entries);
  }finally{await audioContext.close().catch(()=>{})}
 }
 function drawWave(canvas,seg){
  const context=canvas.getContext('2d'),width=640,height=68;
  canvas.width=width;canvas.height=height;context.clearRect(0,0,width,height);
  context.fillStyle='#173251';context.fillRect(0,0,width,height);
  const samples=seg.channels[0],stride=Math.max(1,Math.floor(samples.length/width));
  context.fillStyle='#8bd1ed';
  for(let x=0;x<width;x++){
   const from=x*stride,to=Math.min(samples.length,from+stride);let peak=0;
   for(let i=from;i<to;i++)peak=Math.max(peak,Math.abs(samples[i]));
   context.fillRect(x,height/2-peak*30,1,Math.max(1,peak*60));
  }
  context.fillStyle='#ffd166';
  for(const t of [seg.start,seg.end])context.fillRect(Math.min(width-2,Math.max(0,t/seg.max*width)),0,2,height);
 }
 function review(seg,index){
  const shell=document.createElement('div');shell.className='batch-review';
  const heading=document.createElement('h3');heading.textContent=(index+1)+'. '+seg.entry.question.slice(0,85)+' · '+seg.entry.part;
  const content=document.createElement('div');content.className='batch-text';content.textContent=seg.entry.text;
  const wave=document.createElement('canvas');wave.setAttribute('aria-label','Sóng âm và điểm bắt đầu/kết thúc của đoạn');
  const line=document.createElement('div');line.className='row';
  const first=document.createElement('label');first.textContent='Bắt đầu (giây)';
  const start=document.createElement('input');start.type='number';start.min='0';start.max=format(seg.max);start.step='0.05';start.value=format(seg.start);first.append(start);
  const second=document.createElement('label');second.textContent='Kết thúc (giây)';
  const end=document.createElement('input');end.type='number';end.min='0';end.max=format(seg.max);end.step='0.05';end.value=format(seg.end);second.append(end);
  line.append(first,second);
  const buttons=document.createElement('div');buttons.className='row';
  const listen=document.createElement('button');listen.type='button';listen.textContent='▶ Nghe đủ đoạn';
  const approve=document.createElement('label');approve.className='control-label';
  const checked=document.createElement('input');checked.type='checkbox';checked.disabled=true;
  approve.append(checked,document.createTextNode(' Tôi đã nghe và duyệt đoạn này'));
  const quality=document.createElement('p');quality.className='batch-quality '+(seg.quality==='candidate'?'ready':'warning');
  quality.textContent=(seg.quality==='candidate'?'◉ Đã dò thấy khoảng lặng; cần nghe xác nhận. ':'⚠ Cần chỉnh hoặc nghe kỹ. ')+seg.note;
  function refresh(){
   const a=Number(start.value),b=Number(end.value);
   if(!Number.isFinite(a)||!Number.isFinite(b)||a<0||b>seg.max||b-a<0.15){
    quality.textContent='⚠ Điểm cắt không hợp lệ hoặc quá ngắn.';checked.checked=false;seg.approved=false;checked.disabled=true;setButtons();return;
   }
   seg.start=a;seg.end=b;seg.approved=false;seg.listened=false;checked.checked=false;checked.disabled=true;
   drawWave(wave,seg);setButtons();
  }
  start.addEventListener('change',refresh);end.addEventListener('change',refresh);
  listen.onclick=async()=>{
   listen.disabled=true;
   try{
    const url=URL.createObjectURL(wavPCM(seg.channels,seg.rate,seg.start,seg.end));objects.add(url);
    const audio=new Audio(url);
    await new Promise((resolve,reject)=>{
     audio.onended=()=>{seg.listened=true;checked.disabled=false;quality.textContent='✓ Đã nghe hết đoạn. Nếu đủ chữ, tích vào ô duyệt.';resolve()};
     audio.onerror=()=>reject(Error('Không phát được WAV; hãy kiểm tra và thử lại.'));
     audio.play().catch(reject);
    });
    URL.revokeObjectURL(url);objects.delete(url);
   }catch(e){quality.textContent='⚠ '+err(e)}
   finally{listen.disabled=false}
  };
  checked.onchange=()=>{seg.approved=Boolean(checked.checked&&seg.listened);setButtons()};
  buttons.append(listen,approve);
  shell.append(heading,content,wave,line,quality,buttons);drawWave(wave,seg);
  return shell;
 }
 async function generate(){
  if(running)return;
  if(!groups.length)return status('Chưa có lô cần tạo.');
  if(!$('batchTeacherPin').value.trim())return status('⚠ Hãy nhập mã truy cập Google AI Studio.',true);
  running=true;cancel=false;const myGeneration=generation;setButtons();
  try{
   const check=await ctx.studioCheck();
   if('studio:'+check.voiceVersion!==voice)throw Error('Giọng AI Studio đã thay đổi. Cần phân tích lại.');
   let processedInRun=0;
   // Decode at most four batches at once: avoids accumulating too much audio in iPhone memory.
   for(let i=0;i<groups.length;i++){
    const g=groups[i];if(cancel||myGeneration!==generation||processedInRun>=4)break;if(g.done)continue;
    processedInRun++;
    status('Đang gọi Google AI Studio cho lô '+(i+1)+'/'+groups.length+' ('+g.entries.length+' đoạn).');
    try{
     const cut=await requestBatch(g);
     for(const seg of cut.segments){pending.push(seg);$('batchReviews').append(review(seg,pending.length-1))}
     g.done=true;g.generated=true;
    }catch(e){
     g.error=err(e);
     status('⚠ Lô '+(i+1)+' chưa thành công: '+g.error+'. Các lô đã cắt vẫn giữ để duyệt.',true);
     // Stop when quota is hit, or when segmentation is impossible; no automatic retries.
     break;
    }
   }
   const remain=groups.filter(g=>!g.done).length;
   if(!remain)status('Đã tạo '+pending.length+' đoạn WAV. Hãy nghe lần lượt và duyệt trước khi lưu.');
   else if(!cancel&&groups.some(g=>g.generated)&&!groups.some(g=>g.error))
     status('Đã tạo '+pending.length+' đoạn để nghe duyệt. Còn '+remain+' lô; sau khi kiểm tra các đoạn hiện tại, nhấn Tạo và cắt WAV lần nữa.');
  }finally{running=false;setButtons()}
 }
 async function save(){
  if(running)return;
  const approved=pending.filter(x=>x.approved&&x.listened);
  if(!approved.length)return status('Chưa có đoạn nào được nghe và duyệt.',true);
  if(!confirm('Lưu '+approved.length+' đoạn đã nghe và duyệt vào Supabase? Đoạn chưa duyệt sẽ không lưu.'))return;
  running=true;setButtons();let uploaded=0,skipped=0;
  try{
   const check=await ctx.studioCheck();
   if('studio:'+check.voiceVersion!==voice)throw Error('Phiên bản giọng Gemini đã đổi. Không thể lưu nhầm giọng.');
   const latest=[];let offset=0;
   for(let pass=0;pass<40;pass++){
    const data=await ctx.api('bank.list',{subject:'ALL',lesson:'ALL',search:'',offset,limit:250});
    latest.push(...(data.items||[]));if(data.nextOffset==null)break;offset=data.nextOffset;
   }
   const lookup=new Map(latest.map(r=>[r.id,r]));
   const unique=[...new Set(approved.map(x=>x.entry.id))];
   const existing=new Map();
   for(const id of unique){
    const found=lookup.get(id);
    if(!found?.owned)throw Error('Câu hỏi đã bị xóa hoặc không còn quyền chỉnh sửa.');
    existing.set(id,(await ctx.api('audio.list',{ids:[id],voice_id:voice})).items||[]);
   }
   for(const x of approved){
    const current=lookup.get(x.entry.id);
    if(await ctx.hash(current?.spoken?.[x.entry.part]||'')!==x.entry.hash)
     throw Error('Nội dung câu hỏi đã thay đổi. Dừng lưu để tránh gắn nhầm WAV.');
    if(existing.get(x.entry.id).some(r=>r.part===x.entry.part&&r.textHash===x.entry.hash)){
     skipped++;x.approved=false;continue;
    }
    await ctx.upload(x.entry.id,voice,x.entry.part,wavPCM(x.channels,x.rate,x.start,x.end));
    uploaded++;x.approved=false;existing.get(x.entry.id).push({part:x.entry.part,textHash:x.entry.hash});
    status('Đang lưu WAV đã duyệt '+uploaded+'/'+approved.length+' lên Supabase...');
   }
   const saved=new Set(approved.filter(x=>!x.approved).map(x=>x.entry.id+'/'+x.entry.part));
   pending=pending.filter(x=>!saved.has(x.entry.id+'/'+x.entry.part));
   $('batchReviews').replaceChildren();
   pending.forEach((segment,index)=>$('batchReviews').append(review(segment,index)));
   await ctx.refresh();ctx.notify();
   status('✅ Đã lưu '+uploaded+' WAV đã duyệt, bỏ qua '+skipped+' tệp trùng. Còn '+pending.length+' đoạn chưa duyệt; chúng vẫn ở trên trang để nghe tiếp.');
  }catch(e){status('⚠ Đã lưu '+uploaded+' WAV trước khi dừng: '+err(e),true)}
  finally{running=false;setButtons()}
 }
 $('batchAnalyze').onclick=()=>void analyze();
 $('batchGenerate').onclick=()=>void generate();
 $('batchCancel').onclick=()=>{cancel=true;status('Sẽ dừng sau khi xử lý xong lô đang gọi API.')};
 $('batchApproveSave').onclick=()=>void save();
 $('batchDiscard').onclick=()=>{if(confirm('Bỏ toàn bộ WAV chưa lưu?')){reset();status('Đã bỏ các đoạn chưa lưu; không thay đổi Supabase.')}};
 return {open,reset,getState:()=>({groups:groups.length,pending:pending.length,done:groups.filter(g=>g.done).length,voice})};
}
window.QuestionBatchAudio={create,plan,locate,wavPCM};
})();
