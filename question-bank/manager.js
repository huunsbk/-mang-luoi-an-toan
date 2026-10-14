/* Shared question bank administration — authenticated Supabase MotionClass. */
(function(){
'use strict';
const $=id=>document.getElementById(id),cfg=window.POSE_QUIZ_SUPABASE;
const ENDPOINT=cfg?.url+'/functions/v1/shared-question-api';
const PARTS={full:'Đọc cả câu + A–D',question:'Nội dung câu hỏi',option_a:'Phương án A',option_b:'Phương án B',option_c:'Phương án C',option_d:'Phương án D',answer:'Công bố đáp án'};
const K=['A','B','C','D'];
let supabase=null,rows=[],selected=new Set(),editing=null,editingStamp=null,busy=false,files=[],audioURLs=new Map(),queue=0;
function report(where,message,error=false){const el=$(where);el.textContent=message;el.classList.toggle('error',error)}
function issue(e){return String(e?.message||e||'Lỗi không xác định').slice(0,400)}
async function run(task){
 if(busy)return;busy=true;
 try{await task()}catch(e){report('editStatus','⚠ '+issue(e),true);report('audioStatus','⚠ '+issue(e),true)}
 finally{busy=false}
}
async function auth(){
 const {data:{session},error}=await supabase.auth.getSession();
 if(error||!session?.access_token)throw Error('Vui lòng đăng nhập MotionClass.');
 return session;
}
async function api(action,data={}){
 const session=await auth();
 const result=await fetch(ENDPOINT,{method:'POST',headers:{Authorization:'Bearer '+session.access_token,apikey:cfg.publishableKey,'Content-Type':'application/json'},body:JSON.stringify({action,...data})});
 const body=await result.json().catch(()=>({}));
 if(!result.ok||!body.ok)throw Object.assign(new Error(body.error||'API lỗi HTTP '+result.status),{partial:body.partial,completed:body.items||[],failedIndex:body.failedIndex});
 return body;
}
async function uploadVoice(id,voice,part,blob){
 const session=await auth();
 const form=new FormData();form.set('action','audio.put');form.set('id',id);form.set('voice_id',voice);form.set('part',part);
 form.set('audio',new File([blob],part+'.wav',{type:'audio/wav'}));
 const r=await fetch(ENDPOINT,{method:'POST',headers:{Authorization:'Bearer '+session.access_token,apikey:cfg.publishableKey},body:form});
 const data=await r.json().catch(()=>({}));
 if(!r.ok||!data.ok)throw Error(data.error||'Không lưu được âm thanh');
 return data;
}
function fill(el,values,all,previous){
 el.replaceChildren(new Option(all,'ALL'));
 values.filter(x=>x).sort((a,b)=>String(a).localeCompare(String(b),'vi')).forEach(s=>el.append(new Option(s,s)));
 el.value=values.includes(previous)?previous:'ALL';
}
function showEditor(item=null){
 editing=item;editingStamp=item?.updatedAt||null;
 $('editId').value=item?.id||'';$('subject').value=item?.subject||$('filterSubject').value.replace('ALL','')||'Tin học';
 $('lesson').value=item?.lesson||'';$('question').value=item?.text||'';
 K.forEach((k,i)=>{$('option'+k).value=item?.options?.[i]||''});
 $('correct').value=item?.correct||'A';$('visibility').value=item?.visibility||'private';
 $('visibility').querySelector('option[value=group]').disabled=item?.visibility!=='group';
 $('deleteQuestion').disabled=!item?.owned;$('duplicateQuestion').disabled=!item;
 $('uploadQuestionImage').disabled=!item?.id||!item?.owned;
 $('removeQuestionImage').disabled=!item?.id||!item?.owned||!item?.imageUrl;
 $('saveQuestion').disabled=Boolean(item&&!item.owned);
 $('editorImage').hidden=!item?.imageUrl;
 if(item?.imageUrl){$('editorImage').replaceChildren();let img=new Image();img.src=item.imageUrl;img.alt='Hình minh họa câu hỏi';img.style.cssText='max-height:140px;max-width:100%;border-radius:10px';$('editorImage').append(img)}
 report('editStatus',item?(item.owned?'Đang sửa câu hỏi của bạn. Bấm Lưu để cập nhật cho mọi trò chơi.':'Đây là câu hỏi chia sẻ, chỉ chủ sở hữu được sửa.'):'Đang tạo câu hỏi mới.');
 draw();showAudio().catch(()=>{});
}
function formItem(){
 return{id:$('editId').value||undefined,subject:$('subject').value.trim(),lesson:$('lesson').value.trim(),text:$('question').value.trim(),options:K.map(k=>$('option'+k).value.trim()),correct:$('correct').value,
  visibility:$('visibility').value,expected_updated_at:editingStamp||undefined};
}
function renderList(){
 const list=$('questionList');list.replaceChildren();
 const subject=$('filterSubject').value,lesson=$('filterLesson').value,query=$('filterSearch').value.trim().toLocaleLowerCase('vi'),mine=$('onlyMine').checked;
 const filtered=rows.filter(r=>(!mine||r.owned)&&(subject==='ALL'||r.subject===subject)&&(lesson==='ALL'||r.lesson===lesson)&&(!query||String(r.text).toLocaleLowerCase('vi').includes(query)));
 if(!filtered.length){const p=document.createElement('p');p.className='muted';p.style.padding='10px';p.textContent='Không có câu hỏi phù hợp.';list.append(p)}
 for(const item of filtered){
  const row=document.createElement('div');row.className='item'+(editing?.id===item.id?' active':'');
  const check=document.createElement('input');check.type='checkbox';check.checked=selected.has(item.id);
  check.ariaLabel='Chọn '+item.text;check.onchange=()=>{if(check.checked)selected.add(item.id);else selected.delete(item.id)};
  const btn=document.createElement('button');btn.className='itembutton';btn.type='button';
  const title=document.createElement('strong');title.textContent=item.text;
  const small=document.createElement('small');small.textContent=item.subject+' · '+item.lesson+' · '+(item.owned?'Của tôi':item.visibility==='public'?'Công khai':'Nhóm');
  btn.append(title,small);btn.onclick=()=>showEditor(item);
  row.append(check,btn);list.append(row);
 }
 $('bankTotals').textContent=rows.length+' câu có quyền truy cập · Đang hiển thị '+filtered.length;
}
async function reload(preserveEditor=true){
 const old=preserveEditor?editing?.id:null,sub=$('filterSubject').value,lesson=$('filterLesson').value;
 const data=await api('bank.list',{subject:'ALL',lesson:'ALL',search:''});rows=data.items||[];
 selected=new Set([...selected].filter(id=>rows.some(x=>x.id===id)));
 fill($('filterSubject'),data.facets?.subjects||[],'Tất cả môn học',sub);
 const lessons=[...new Set(rows.filter(r=>$('filterSubject').value==='ALL'||r.subject===$('filterSubject').value).map(r=>r.lesson))];
 fill($('filterLesson'),lessons,'Tất cả bài học',lesson);
 const active=rows.find(x=>x.id===old);
 if(old&&!active)showEditor(null);else if(active)showEditor(active);
 renderList();
 report('editStatus','✅ Đã tải '+rows.length+' câu hỏi từ ngân hàng MotionClass.');
}
async function login(e){
 e.preventDefault();await run(async()=>{
  const {data,error}=await supabase.auth.signInWithPassword({email:$('loginEmail').value.trim(),password:$('loginPass').value});
  $('loginPass').value='';if(error)throw error;
  await sessionChanged(data.user);report('editStatus','Đăng nhập thành công.');
 });
}
async function sessionChanged(user){
 $('loginPanel').hidden=!!user;$('appPanel').hidden=!user;$('userLabel').textContent=user?'👤 '+user.email:'';
 if(!user){rows=[];selected.clear();renderList();return}
 await reload(false);
}
async function saveQuestion(){
 await run(async()=>{
  const item=formItem();
  const result=await api('bank.save',{item});
  const saved=result.items?.[0];if(!saved)throw Error('Máy chủ chưa trả về mã câu hỏi mới.');
  report('editStatus','✅ Đã '+(saved.created?'tạo':'cập nhật')+' câu hỏi trong ngân hàng.');await reload(false);
  showEditor(rows.find(r=>r.id===saved.id)||null);
 });
}
async function deleteQuestion(){
 if(!editing?.owned)return;
 if(!confirm('Xóa vĩnh viễn câu hỏi này cùng các âm thanh dùng chung?'))return;
 await run(async()=>{await api('bank.delete',{id:editing.id});showEditor(null);await reload(false);report('editStatus','Đã xóa câu hỏi thành công.')});
}
async function jpegFile(file){
 if(!file||!file.type.startsWith("image/"))throw Error('Hãy chọn tệp ảnh JPEG, PNG hoặc WebP.');
 if(file.size>15*1024*1024)throw Error('Ảnh gốc quá 15 MB. Hãy giảm kích thước trước.');
 const img=await createImageBitmap(file),scale=Math.min(1,1280/Math.max(img.width,img.height));
 const canvas=document.createElement('canvas');canvas.width=Math.round(img.width*scale);canvas.height=Math.round(img.height*scale);
 canvas.getContext('2d').drawImage(img,0,0,canvas.width,canvas.height);
 img.close?.();
 return await new Promise((resolve,reject)=>canvas.toBlob(blob=>blob?resolve(blob):reject(Error('Không xử lý được ảnh.')),'image/jpeg',.84));
}
async function uploadQuestionImage(){
 await run(async()=>{
  if(!editing?.id||!editing.owned)throw Error('Hãy lưu câu hỏi thuộc quyền sở hữu trước khi tải ảnh.');
  const file=$('questionImageFile').files?.[0];
  if(!file)throw Error('Chưa chọn ảnh minh họa.');
  const blob=await jpegFile(file);
  const session=await auth(),form=new FormData();
  form.set('action','image.put');form.set('id',editing.id);form.set('image',new File([blob],'minh-hoa.jpg',{type:'image/jpeg'}));
  const response=await fetch(ENDPOINT,{method:'POST',headers:{Authorization:'Bearer '+session.access_token,apikey:cfg.publishableKey},body:form});
  const result=await response.json().catch(()=>({}));
  if(!response.ok||!result.ok)throw Error(result.error||'Không tải được hình ảnh.');
  $('questionImageFile').value='';const id=editing.id;
  await reload(false);showEditor(rows.find(r=>r.id===id)||null);
  report('editStatus','✅ Đã lưu hình minh họa vào câu hỏi, có thể sử dụng chung trong các trò chơi.');
 });
}
async function deleteQuestionImage(){
 if(!editing?.id||!editing.owned||!editing.imageUrl)return;
 if(!confirm('Xóa hình minh họa khỏi câu hỏi?'))return;
 await run(async()=>{
  const id=editing.id;await api('image.delete',{id});
  await reload(false);showEditor(rows.find(r=>r.id===id)||null);
  report('editStatus','Đã xóa hình minh họa khỏi câu hỏi.');
 });
}
async function bulkDelete(){
 const owned=rows.filter(r=>selected.has(r.id)&&r.owned);
 if(!owned.length){report('editStatus','Hãy chọn câu hỏi thuộc quyền sở hữu.',true);return}
 if(!confirm('Xóa '+owned.length+' câu hỏi đã chọn? Không thể hoàn tác.'))return;
 await run(async()=>{
  let count=0;
  for(const r of owned){await api('bank.delete',{id:r.id});count++}
  await reload(false);report('editStatus','Đã xóa '+count+' câu hỏi.');
 });
}
function parseText(text){
 const records=[],errors=[];let q=null,part=null;
 function commit(){if(!q)return;
  if(!q.text||K.some(k=>!q.options[k])||!K.includes(q.correct))errors.push('Câu '+q.num+' chưa có đủ nội dung, bốn phương án hoặc đáp án.');
  else records.push({text:q.text,options:K.map(k=>q.options[k]),correct:q.correct});
 }
 for(const raw of String(text).replace(/\r/g,'').split('\n')){
  const line=raw.trim();if(!line)continue;
  const heading=line.match(/^(?:Câu|Cau)\s*(\d+)\s*[.:)\-]\s*(.*)$/i);
  if(heading){commit();q={num:Number(heading[1]),text:heading[2],options:{},correct:''};part='text';continue}
  if(!q){errors.push('Nội dung cần bắt đầu bằng Câu 1: ...');continue}
  const answer=line.match(/^(?:Đáp\s*án\s*(?:đúng)?|Dap\s*an\s*(?:dung)?)\s*:\s*([ABCD])\s*[.)]?$/i);
  if(answer){q.correct=answer[1].toUpperCase();part='correct';continue}
  const opt=line.match(/^([ABCD])(?:\s*[.):\-]\s*|\s+)(.*)$/i);
  if(opt){part=opt[1].toUpperCase();q.options[part]=opt[2].trim();continue}
  if(part==='text')q.text+=' '+line;else if(K.includes(part))q.options[part]+=' '+line;
 }
 commit();return{items:records,errors};
}
function bulkItems(){
 const raw=$('bulkText').value.trim();
 if(!raw)throw Error('Chưa có nội dung câu hỏi để nhập.');
 let parsed;
 if(raw.startsWith('{')||raw.startsWith('[')){
  const data=JSON.parse(raw),list=Array.isArray(data)?data:data.questions||data.items||[];
  if(!Array.isArray(list))throw Error('JSON cần một danh sách câu hỏi.');
  parsed={items:list.map(r=>{
   const opts=r.options||r.answers;
   return {text:r.text||r.question,options:Array.isArray(opts)?opts.map(x=>typeof x==='object'?x.text:x):K.map(k=>opts?.[k]),correct:r.correct||r.answer||K[(r.answers||[]).findIndex(x=>x.isCorrect)]};
  }),errors:[]};
 }else parsed=parseText(raw);
 if(parsed.errors.length)throw Error(parsed.errors.slice(0,5).join('\n'));
 if(!parsed.items.length)throw Error('Không tìm thấy câu hỏi hợp lệ.');
 if(parsed.items.length>100)throw Error('Tối đa 100 câu/lần. Hãy chia thành nhiều đợt.');
 return parsed.items.map(i=>({...i,subject:$('bulkSubject').value.trim(),lesson:$('bulkLesson').value.trim(),visibility:$('bulkPublic').checked?'public':'private'}));
}
async function bulkSave(){
 await run(async()=>{
  const items=bulkItems();
  if(!items[0].subject||!items[0].lesson)throw Error('Hãy nhập môn học và bài học.');
  const existing=new Set(rows.filter(r=>r.owned).map(r=>JSON.stringify([r.text.trim(),r.options,r.correct,r.subject,r.lesson])));
  const filtered=items.filter(r=>{const key=JSON.stringify([r.text.trim(),r.options.map(s=>String(s).trim()),r.correct,r.subject,r.lesson]);if(existing.has(key))return false;existing.add(key);return true});
  if(!filtered.length){report('bulkStatus','Các câu hỏi này đã tồn tại; không tạo bản trùng.');return}
  const result=await api('bank.save_many',{items:filtered});
  $('bulkText').value='';report('bulkStatus','✅ Đã lưu '+result.created+' câu. Bỏ qua '+(items.length-filtered.length)+' câu trùng.');
  await reload();
 });
}
function download(name,data,type){
 const blob=new Blob([data],{type}),url=URL.createObjectURL(blob),a=document.createElement('a');
 a.href=url;a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1500);
}
function exportQuestions(csv=false){
 const list=rows.filter(x=>selected.size?selected.has(x.id):true);
 if(!list.length){report('editStatus','Chưa có câu hỏi để xuất.',true);return}
 if(!csv){
  download('ngan-hang-cau-hoi.json',JSON.stringify({schema:'shared-bank-v1',exportedAt:new Date().toISOString(),questions:list},null,2),'application/json;charset=utf-8');
 }else{
  const esc=x=>'"'+String(x??'').replaceAll('"','""')+'"';
  const lines=[['ID','Môn','Bài','Câu hỏi','A','B','C','D','Đáp án','Phạm vi'].map(esc).join(',')];
  for(const item of list)lines.push([item.id,item.subject,item.lesson,item.text,...item.options,item.correct,item.visibility].map(esc).join(','));
  download('ngan-hang-cau-hoi.csv','\ufeff'+lines.join('\r\n'),'text/csv;charset=utf-8');
 }
 report('editStatus','✅ Đã xuất '+list.length+' câu hỏi.');
}
class LocalVoice{
 constructor(){this.worker=null;this.voice='';this.pending=new Map();this.counter=0}
 stop(){this.worker?.terminate();this.worker=null;this.voice='';for(const p of this.pending.values())p.reject(Error('Đã chuyển giọng.'));this.pending.clear()}
 message(type,text,voice){
  const id=++this.counter;
  return new Promise((resolve,reject)=>{this.pending.set(id,{resolve,reject});this.worker.postMessage({type,id,text,modelName:voice})});
 }
 async ensure(voice){
  if(this.worker&&this.voice===voice)return;
  this.stop();this.voice=voice;const worker=new Worker('/marble-race/voice/piper-worker.js');this.worker=worker;
  worker.onmessage=e=>{if(worker!==this.worker)return;const msg=e.data||{};
   if(msg.type==='progress'){report('audioStatus','⏳ '+(msg.detail||'Đang tải mô hình'));return}
   const p=this.pending.get(msg.id);if(!p)return;this.pending.delete(msg.id);
   if(msg.type==='error')p.reject(Error(msg.message||'Không tạo được giọng đọc.'));
   else if(msg.type==='audio')p.resolve(new Blob([msg.audio],{type:'audio/wav'}));
   else if(msg.type==='ready')p.resolve(msg);
  };
  worker.onerror=e=>{this.stop();report('audioStatus','Lỗi nạp mô hình: '+e.message,true)};
  await this.message('init',null,voice);
 }
 async make(voice,text){await this.ensure(voice);return this.message('speak',text,voice)}
}
const voiceEngine=new LocalVoice();
const hash=async text=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text))),b=>b.toString(16).padStart(2,'0')).join('');
async function audioMetadata(ids){
 if(!ids.length)return[];
 return (await api('audio.list',{ids,voice_id:'nghi:'+$('voiceModel').value})).items||[];
}
async function showAudio(){
 const box=$('audioGrid');box.replaceChildren();
 if(!editing?.id){report('audioStatus','Chọn câu đã lưu để xem âm thanh.');return}
 const voice='nghi:'+$('voiceModel').value;
 const metadata=await audioMetadata([editing.id]);
 if(!editing||voice!=='nghi:'+$('voiceModel').value)return;
 for(const [part,label] of Object.entries(PARTS)){
  const container=document.createElement('div');container.className='audio-cell';
  const title=document.createElement('span');title.textContent=label;container.append(title);
  const file=metadata.find(x=>x.id===editing.id&&x.part===part);
  if(file){
   const text=editing.spoken?.[part];
   const current=!!text&&(await hash(text)===file.textHash);
   if(current){
    const play=document.createElement('button');play.textContent='▶ Nghe';play.type='button';
    play.onclick=async()=>{try{await new Audio(file.url).play()}catch(e){report('audioStatus',issue(e),true)}};
    const link=document.createElement('a');link.href=file.url;link.target='_blank';link.rel='noopener';link.download=part+'.wav';link.textContent='↓ WAV';link.className='buttonlink';
    container.append(play,link);
   }else{const old=document.createElement('small');old.textContent='Cũ · cần tạo lại';container.append(old)}
  }else{const empty=document.createElement('small');empty.textContent='Chưa có âm thanh';container.append(empty)}
  box.append(container);
 }
 report('audioStatus','Giọng '+$('voiceModel').value+' · chỉ những bản khớp nội dung mới được phát.');
}
async function voiceFor(items,parts){
 const mine=items.filter(i=>i.owned);
 if(!mine.length)throw Error('Chỉ chủ sở hữu câu hỏi được tạo và lưu giọng lên kho.');
 const model=$('voiceModel').value,voice='nghi:'+model;
 let completed=0,skipped=0;
 for(const item of mine){
  const metadata=await audioMetadata([item.id]);
  for(const part of parts){
   if(voice!=='nghi:'+$('voiceModel').value)throw Error('Giọng đang được đổi, đã dừng để tránh gán nhầm.');
   const content=item.spoken?.[part];if(!content)continue;
   if(metadata.some(m=>m.part===part&&m.textHash===null))continue;
   const fingerprint=await hash(content);
   if(metadata.some(m=>m.part===part&&m.textHash===fingerprint)){skipped++;continue}
   report('audioStatus','🎙️ '+model+' · '+item.text.slice(0,45)+' · '+PARTS[part]+' ...');
   const clip=await voiceEngine.make(model,content);
   if(voice!=='nghi:'+$('voiceModel').value)throw Error('Đã thay đổi giọng, hủy lưu âm thanh.');
   await uploadVoice(item.id,voice,part,clip);completed++;
  }
 }
 report('audioStatus','✅ Đã lưu '+completed+' đoạn âm thanh mới · '+skipped+' đoạn đã có được giữ lại.');
 await showAudio();
}
async function init(){
 if(!cfg?.url||!cfg?.publishableKey||!window.supabase){report('editStatus','Không tải được kết nối MotionClass.',true);return}
 supabase=window.supabase.createClient(cfg.url,cfg.publishableKey,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}});
 $('loginForm').onsubmit=login;
 $('logout').onclick=()=>run(async()=>{await supabase.auth.signOut();showEditor(null);await sessionChanged(null)});
 $('reloadBank').onclick=()=>run(()=>reload());
 $('filterSubject').onchange=()=>{fill($('filterLesson'),[...new Set(rows.filter(r=>$('filterSubject').value==='ALL'||r.subject===$('filterSubject').value).map(r=>r.lesson))],'Tất cả bài học','ALL');renderList()};
 $('filterLesson').onchange=renderList;$('filterSearch').oninput=renderList;$('onlyMine').onchange=renderList;
 $('newQuestion').onclick=()=>showEditor(null);
 $('saveQuestion').onclick=saveQuestion;$('deleteQuestion').onclick=deleteQuestion;$('bulkDelete').onclick=bulkDelete;
 $('uploadQuestionImage').onclick=uploadQuestionImage;$('removeQuestionImage').onclick=deleteQuestionImage;
 $('duplicateQuestion').onclick=()=>{if(!editing)return;const clone={...editing,id:null,owned:true,visibility:'private',updatedAt:null};showEditor(clone);$('editId').value='';editing=null;editingStamp=null;report('editStatus','Đang nhân bản thành câu hỏi mới.')};
 $('selectAll').onclick=()=>{rows.filter(r=>r.owned&&(!$('onlyMine').checked||r.owned)).forEach(r=>selected.add(r.id));renderList()};
 $('unselectAll').onclick=()=>{selected.clear();renderList()};
 $('exportJson').onclick=()=>exportQuestions(false);$('exportCsv').onclick=()=>exportQuestions(true);
 $('bulkPreview').onclick=()=>{try{const items=bulkItems();report('bulkStatus','✅ Hợp lệ '+items.length+' câu. Chọn Lưu tất cả để đưa vào ngân hàng.')}catch(e){report('bulkStatus','⚠ '+issue(e),true)}};
 $('bulkSave').onclick=bulkSave;
 $('bulkFile').onchange=async e=>{const file=e.target.files?.[0];if(!file)return;try{if(file.size>1024*1024)throw Error('Tệp tối đa 1 MB.');$('bulkText').value=await file.text();report('bulkStatus','Đã nạp tệp '+file.name+'. Nhấn Kiểm tra.')}catch(err){report('bulkStatus','⚠ '+issue(err),true)}};
 $('audioRefresh').onclick=()=>run(showAudio);
 $('audioGenerate').onclick=()=>run(async()=>{if(!editing?.id)throw Error('Hãy lưu câu hỏi trước khi tạo giọng.');await voiceFor([editing],Object.keys(PARTS))});
 $('audioBatch').onclick=()=>run(async()=>{const chosen=rows.filter(r=>selected.has(r.id)&&r.owned);if(!chosen.length)throw Error('Hãy chọn các câu hỏi của bạn ở danh sách.');await voiceFor(chosen,['full','answer'])});
 $('voiceModel').onchange=()=>{voiceEngine.stop();showAudio().catch(e=>report('audioStatus',issue(e),true))};
 const {data:{session}}=await supabase.auth.getSession();
 await sessionChanged(session?.user||null);
}
init().catch(e=>report('editStatus',issue(e),true));
})();