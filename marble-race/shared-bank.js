/* Shared Learning Bank v1: compatible with AI Pose Quiz, Marble Race and future classroom games.
 * Only uses MotionClass public key + authenticated Supabase session. Never exposes a server secret.
 * Assets stay in private Supabase Storage and are accessed through short-lived signed URLs.
 */
(function(){
'use strict';
const $=id=>document.getElementById(id);
const hooks=window.MarbleSharedBankHooks;
const settings=window.POSE_QUIZ_SUPABASE;
let client=null,rows=[],selected=new Set(),session=null,loadCount=0,voiceInventory=new Map(),lastAudioInventoryCheck=0,nameVoiceInventory=new Map();
const sharedEndpoint=settings?.url+'/functions/v1/shared-question-api';
const idpattern=/^[0-9a-f]{8}-[0-9a-f-]{27,}$/i;
function status(message,error=false){
 const node=$('bankStatus');if(!node)return;
 node.textContent=message;node.style.color=error?'#ffc5c5':'#aeeaf7';
}
function selectedRows(){
 return rows.filter(item=>selected.has(item.id));
}
function errorMessage(error){return String(error?.message||error||'Không rõ lỗi').slice(0,300)}
async function api(action,body={}){
 if(!client)throw Error('Không thể khởi tạo kết nối Supabase.');
 const {data:{session:current},error}=await client.auth.getSession();
 if(error||!current?.access_token)throw Error('Vui lòng đăng nhập lại MotionClass.');
 const res=await fetch(sharedEndpoint,{
  method:'POST',
  headers:{'Authorization':'Bearer '+current.access_token,'apikey':settings.publishableKey,'Content-Type':'application/json'},
  body:JSON.stringify({action,...body})
 });
 const result=await res.json().catch(()=>({}));
 if(!res.ok||!result.ok)throw Error(result.error||'Không thể truy cập ngân hàng câu hỏi ('+res.status+').');
 return result;
}
async function uploadAudio(row,part,blob){
 if(!row.owned)throw Error('Chỉ chủ sở hữu được lưu giọng đọc cho câu hỏi này.');
 const {data:{session:current}}=await client.auth.getSession();
 if(!current?.access_token)throw Error('Phiên đăng nhập đã hết hạn.');
 const form=new FormData();
 form.set('action','audio.put');form.set('id',row.id);form.set('part',part);
 form.set('voice_id',hooks.voice().id);
 form.set('audio',new File([blob],part+'.wav',{type:'audio/wav'}));
 const res=await fetch(sharedEndpoint,{
  method:'POST',headers:{Authorization:'Bearer '+current.access_token,apikey:settings.publishableKey},
  body:form
 });
 const value=await res.json().catch(()=>({}));
 if(!res.ok||!value.ok)throw Error(value.error||'Không lưu được tệp âm thanh.');
 return value;
}
function announceSync(change='audio.put'){
 try{localStorage.setItem('motionclass:shared-bank-sync',JSON.stringify({at:Date.now(),change,source:'marble-race'}))}catch(_){}
}
async function refreshVoiceInventory(){
 if(!rows.length){voiceInventory.clear();return}
 const map=new Map();
 for(let i=0;i<rows.length;i+=100){
  const result=await api('audio.overview',{ids:rows.slice(i,i+100).map(x=>x.id)});
  for(const item of result.items||[]){if(!map.has(item.id))map.set(item.id,[]);map.get(item.id).push(item)}
 }
 voiceInventory=map;lastAudioInventoryCheck=Date.now();render();refreshSavedVoiceChoices();
}
function refreshSavedVoiceChoices(){
 const select=$('raceSavedVoice');if(!select)return;
 const previous=select.value||sessionStorage.getItem('marble.saved.voice')||'';
 const totals=new Map();
 for(const items of voiceInventory.values())for(const file of items){
  if(!file.current||!['full','answer'].includes(file.part))continue;
  totals.set(file.voiceId,(totals.get(file.voiceId)||0)+1);
 }
 select.replaceChildren(new Option('Giọng thiết bị (khi chưa có WAV)','device'));
 const voices=new Set([...totals.keys(),...nameVoiceInventory.keys()]);
 for(const id of [...voices].sort((a,b)=>(totals.get(b)||0)-(totals.get(a)||0))){
  if(!/^(studio:[a-f0-9]{16}|nghi:[a-z0-9]{2,45}|edge:[a-z0-9-]{2,45})$/.test(id))continue;
  const q=totals.get(id)||0,n=nameVoiceInventory.get(id)||0;
  select.append(new Option((id.startsWith('studio:')?'✨ Google đã lưu':id.startsWith('edge:')?'🎙️ Microsoft NamMinh đã lưu':'🎙️ NGHI đã lưu')+
   ' · '+[q?q+' WAV câu hỏi':'',n?n+' tên':''].filter(Boolean).join(' · '),id));
 }
 const preferred=[previous,[...totals.keys()][0],[...nameVoiceInventory.keys()][0],'device'].find(id=>id&&[...select.options].some(o=>o.value===id));
 select.value=preferred||'device';
 $('raceSavedAudioStatus').textContent=totals.size||nameVoiceInventory.size
  ?'Đã tìm thấy '+[...totals.values()].reduce((a,b)=>a+b,0)+' WAV câu hỏi/đáp án và '+
   [...nameVoiceInventory.values()].reduce((a,b)=>a+b,0)+' WAV tên học sinh. Nạp giọng đã lưu, không gọi API tạo mới.'
  :'Chưa có WAV hợp lệ trong bộ lọc. Dùng giọng thiết bị hoặc tạo tại Ngân hàng câu hỏi / Quản lý lớp.';
}
function render(rowsToShow=rows){
 const box=$('bankList');
 box.replaceChildren();
 if(!rowsToShow.length){const p=document.createElement('p');p.textContent='Không tìm thấy câu hỏi phù hợp.';box.appendChild(p);return}
 const fragment=document.createDocumentFragment();
 for(const item of rowsToShow){
  const label=document.createElement('label');
  label.style.cssText='display:flex;gap:8px;align-items:flex-start;padding:8px;border-bottom:1px solid #2a5184;cursor:pointer;font-size:13px';
  const checkbox=document.createElement('input');checkbox.type='checkbox';checkbox.value=item.id;checkbox.checked=selected.has(item.id);
  checkbox.style.cssText='width:20px;height:20px;flex:none';
  checkbox.onchange=()=>{if(checkbox.checked)selected.add(item.id);else selected.delete(item.id);renderCount()};
  const info=document.createElement('span');info.style.cssText='line-height:1.5';
  const title=document.createElement('strong');title.textContent=item.text;
  const meta=document.createElement('span');meta.style.cssText='display:block;color:#b2cef0;font-size:11px';
  meta.textContent=(item.subject||'Môn học')+' / '+(item.lesson||'Bài học')+' · '+(item.owned?'Của tôi':item.visibility==='public'?'Công khai':'Được chia sẻ')+(item.imageUrl?' · Có hình ảnh':'');
  const parts=voiceInventory.get(item.id)||[],valid=parts.filter(x=>x.current),stale=parts.filter(x=>!x.current);
  const badge=document.createElement('span');
  badge.style.cssText='display:inline-block;border-radius:22px;padding:3px 8px;margin-top:4px;font-size:11px;font-weight:700;background:'+(valid.length?'#dff8e8;color:#075a41':stale.length?'#ffeacc;color:#82500d':'#284a70;color:#d4e5fa');
  const voices=[...new Set(valid.map(x=>x.voiceId))];
  badge.textContent=valid.length?'🎙 '+voices.length+' giọng · '+valid.length+' WAV':stale.length?'⚠ Âm thanh cũ':'Chưa có giọng';
  info.append(title,meta,badge);label.append(checkbox,info);fragment.appendChild(label);
 }
 box.appendChild(fragment);renderCount();
}
function renderCount(){
 $('bankSelectAll').textContent='✓ Chọn tất cả ('+selected.size+')';
}
function fillOptions(el,values,allLabel,previous){
 el.replaceChildren();
 const all=new Option(allLabel,'ALL');el.appendChild(all);
 for(const text of values)el.appendChild(new Option(text,text));
 el.value=values.includes(previous)?previous:'ALL';
}
async function fetchBank(){
 const index=++loadCount;
 const result=await api('bank.list',{subject:$('bankSubject').value,lesson:$('bankLesson').value,search:$('bankSearch').value});
 if(index!==loadCount)return;
 rows=result.items||[];
 fillOptions($('bankSubject'),result.facets?.subjects||[],'Tất cả môn học',$('bankSubject').value);
 fillOptions($('bankLesson'),result.facets?.lessons||[],'Tất cả bài học',$('bankLesson').value);
 render();
 try{await refreshVoiceInventory()}catch(e){status('Đã tải câu hỏi, nhưng chưa kiểm tra được trạng thái giọng: '+errorMessage(e),true);return}
 status('Đã tải '+rows.length+' câu. Huy hiệu xanh là giọng đã lưu trên Supabase và có thể dùng lại.');
}
async function fetchAllFacets(){
 $('bankSubject').value='ALL';$('bankLesson').value='ALL';$('bankSearch').value='';
 await fetchBank();
}
function updateSessionUI(user){
 session=user;
 $('bankLoginSection').hidden=Boolean(user);
 $('bankUserSection').hidden=!user;
 $('bankWho').textContent=user?'Đăng nhập: '+(user.email||'Tài khoản giáo viên'):'';
 if(!user){rows=[];selected.clear();$('bankList').replaceChildren();status('Chưa đăng nhập MotionClass.')}
}
async function refreshLogin(){
 const {data:{session:s},error}=await client.auth.getSession();
 if(error)throw error;
 updateSessionUI(s?.user||null);
 if(s?.user){await fetchAllFacets();if(hooks.questions().length)await loadSavedVoice().catch(e=>status('Chưa tải được WAV của bộ câu hỏi đang dùng: '+errorMessage(e),true))}
}
async function withButton(id,task){
 const button=$(id);if(button.disabled)return;
 button.disabled=true;
 try{await task()}catch(e){status('⚠ '+errorMessage(e),true)}finally{button.disabled=false}
}
function validateChoice(items){
 if(!items.length)throw Error('Hãy chọn ít nhất một câu hỏi.');
 if(items.length>120)throw Error('Chỉ xử lý tối đa 120 câu một lần.');
 return items;
}
async function chooseQuestions(){
 const items=validateChoice(selectedRows());
 const added=hooks.importQuestions(items);
 status('✓ Đã nạp '+added+' câu mới từ Ngân hàng câu hỏi, đang tải WAV đã lưu...');
 try{await loadSavedVoice()}catch(e){status('Đã nạp câu hỏi; chưa tải đủ WAV: '+errorMessage(e)+'. Có thể dùng giọng thiết bị.',true)}
}
function sha256(value){
 return crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))
  .then(bytes=>Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,'0')).join(''));
}
async function readySharedVoice(creating=false){
 let selected=hooks.voice();
 if(selected.kind==='studio'){
  await hooks.checkStudio();
  selected=hooks.voice();
  if(!/^studio:[a-f0-9]{16}$/.test(selected.id))
   throw Error('Không xác định được phiên bản giọng AI Studio. Kiểm tra kết nối Internet.');
  if(creating&&!hooks.isStudioConfigured())throw Error('Google AI Studio chưa có API key hoặc mã giáo viên trên Vercel.');
  if(creating&&!hooks.hasStudioPin())throw Error('Hãy nhập mã truy cập AI Studio trong mục Giọng đọc.');
 }else if(selected.kind!=='nghi'){
  throw Error('Chọn NGHI-TTS hoặc Google AI Studio để lưu hoặc nạp giọng đọc.');
 }
 return selected;
}
async function fetchVoiceRows(items,voiceId=hooks.voice().id){
 const valid=items.filter(x=>idpattern.test(x.id));
 if(!valid.length)return [];
 if(!/^(studio:[a-f0-9]{16}|nghi:[a-z0-9]{2,45}|edge:[a-z0-9-]{2,45})$/.test(voiceId))return [];
 const out=[];
 for(let i=0;i<valid.length;i+=80){
  const data=await api('audio.list',{ids:valid.slice(i,i+80).map(x=>x.id),voice_id:voiceId});
  out.push(...(data.items||[]));
 }
 return out;
}
async function loadSavedVoice(explicit=null){
 const targetVoice=hooks.voice().id;
 const bankQuestions=hooks.questions();
 const requested=explicit||bankQuestions;
 if(!requested.length){status('Chưa có câu hỏi từ Ngân hàng câu hỏi trong Đua bi.');return 0}
 if(targetVoice==='device'){
  status('Đang chọn giọng thiết bị; không gọi Google hoặc NGHI để tạo âm thanh.');
  return 0;
 }
 const items=await fetchVoiceRows(requested,targetVoice);
 const byId=new Map(bankQuestions.map(q=>[q.id,q]));
 let loaded=0,stale=0,unavailable=0;
 for(const item of items){
  if(!['full','answer'].includes(item.part))continue;
  const question=byId.get(item.id);
  const speech=question?.spoken?.[item.part];
  if(!speech)continue;
  if(await sha256(speech)!==item.textHash){stale++;continue}
  try{
   const response=await fetch(item.url);
   if(!response.ok){unavailable++;continue}
   const blob=await response.blob();
   const header=String.fromCharCode(...new Uint8Array(await blob.slice(0,12).arrayBuffer()));
   if(blob.size>44 && header.startsWith('RIFF') && header.slice(8,12)==='WAVE'){
    hooks.storeClip(speech,blob,targetVoice);loaded++;
   }else unavailable++;
  }catch(_e){unavailable++}
 }
 const total=requested.length*2;
 status('🔊 Đã nạp '+loaded+'/'+total+' WAV câu hỏi và đáp án cho giọng '+targetVoice+'.'+
  (stale?' '+stale+' WAV cũ không khớp nội dung.':'')+
  (unavailable?' '+unavailable+' WAV tạm thời không truy cập được.':'')+
  ' Phần chưa có sẽ dùng giọng thiết bị, không gọi API tạo mới.');
 $('raceSavedAudioStatus').textContent='Đã nạp '+loaded+'/'+total+' WAV từ Ngân hàng câu hỏi · '+targetVoice;
 return loaded;
}
async function saveVoices(){
 const selectedVoice=await readySharedVoice(true);
 const items=validateChoice(selectedRows()).filter(x=>x.owned);
 if(!items.length)throw Error('Không có câu thuộc quyền sở hữu được chọn để lưu giọng.');
 const voice=selectedVoice.id,existing=await fetchVoiceRows(items);
 const hashes=new Map(existing.map(x=>[x.id+':'+x.part,x.textHash]));
 let created=0,skipped=0;
 for(const item of items){
  for(const part of ['full','answer']){
   if(hooks.voice().id!==voice)throw Error('Đã đổi giọng khi đang lưu. Hãy thử lại với giọng mới.');
   const text=item.spoken[part];
   if(hashes.get(item.id+':'+part)===await sha256(text)){skipped++;continue}
   status('🎙️ Đang tạo giọng '+voice+' · câu '+item.text.slice(0,35)+'... · '+part);
   const clip=await hooks.generateClip(text);
   if(hooks.voice().id!==voice)throw Error('Đã đổi giọng khi đang tạo. Không tải nhầm giọng lên Supabase.');
   await uploadAudio(item,part,clip);
   hooks.storeClip(text,clip);
   created++;
  }
 }
 await refreshVoiceInventory();announceSync('audio.put');
 status('✅ Đã đồng bộ: '+created+' WAV mới, '+skipped+' WAV đã lưu được giữ nguyên. Mở Ngân hàng câu hỏi để nghe/tải.');
}
async function downloadPack(){
 const items=validateChoice(selectedRows());
 if(!window.JSZip)throw Error('Không tải được thư viện tạo ZIP. Hãy kiểm tra Internet.');
 const zip=new JSZip();
 const voice=(await readySharedVoice(false)).id;
 const meta={schema_version:'shared-learning-bank-v1',exported_at:new Date().toISOString(),voice_id:voice,
  questions:items.map(i=>({id:i.id,subject:i.subject,lesson:i.lesson,text:i.text,options:i.options,correct:i.correct,spoken:i.spoken,hasImage:!!i.imageUrl}))};
 zip.file('questions.json',JSON.stringify(meta,null,2));
 const audios=await fetchVoiceRows(items);
 let n=0;
 for(const file of audios){
  if(!['full','answer'].includes(file.part))continue;
  const q=items.find(i=>i.id===file.id);
  if(!q||await sha256(q.spoken[file.part])!==file.textHash)continue;
  const resp=await fetch(file.url);
  if(resp.ok){zip.file('audio/'+file.id+'/'+voice.replace(':','-')+'/'+file.part+'.wav',await resp.blob());n++}
 }
 for(const item of items){
  if(!item.imageUrl)continue;
  try{const resp=await fetch(item.imageUrl);if(resp.ok){const file=await resp.blob();const ext=file.type==='image/png'?'png':file.type==='image/webp'?'webp':file.type==='image/gif'?'gif':'jpg';zip.file('images/'+item.id+'.'+ext,file)}}catch(_e){}
 }
 status('📦 Đang đóng gói '+items.length+' câu hỏi và '+n+' tệp giọng đọc...');
 const blob=await zip.generateAsync({type:'blob',compression:'DEFLATE',compressionOptions:{level:5}});
 const url=URL.createObjectURL(blob);
 const anchor=document.createElement('a');anchor.href=url;anchor.download='ngan-hang-hoc-lieu-'+new Date().toISOString().slice(0,10)+'.zip';
 document.body.appendChild(anchor);anchor.click();anchor.remove();setTimeout(()=>URL.revokeObjectURL(url),6000);
 status('✅ Đã tạo gói ZIP: '+items.length+' câu, '+n+' tệp âm thanh hiện có.');
}
async function listAllAccessible(){
 const items=[];let offset=0;
 for(let page=0;page<40;page++){
  const result=await api('bank.list',{subject:'ALL',lesson:'ALL',search:'',offset,limit:250});
  items.push(...(result.items||[]));
  if(result.nextOffset==null)break;
  offset=result.nextOffset;
 }
 return items;
}
async function quickSave(includeVoice=false){
 const current=hooks.currentQuestions();
 if(!current.length)throw Error('Hãy nhập ít nhất một câu hỏi hợp lệ trước khi lưu.');
 if(current.length>100)throw Error('Mỗi lượt lưu tối đa 100 câu, hãy chia ngân hàng thành nhiều đợt.');
 const subject=$('quickBankSubject').value.trim(),lesson=$('quickBankLesson').value.trim();
 const grade=Number($('quickBankGrade').value);
 if(!Number.isInteger(grade)||grade<1||grade>12)throw Error('Hãy chọn lớp từ 1 đến 12 trước khi lưu vào ngân hàng.');
 const visibility=$('quickBankPublic').checked?'public':'private';
 if(!subject||!lesson)throw Error('Hãy nhập môn học và bài học để phân loại câu hỏi.');
 const sharedVoice=includeVoice?await readySharedVoice(true):null;
 try{await authCheck()}catch(err){
  $('sharedBankPanel').open=true;
  $('bankEmail').focus();
  throw Error('Hãy đăng nhập MotionClass trong mục Ngân hàng câu hỏi bên dưới rồi bấm Lưu lại.');
 }
 const mine=(await listAllAccessible()).filter(q=>q.owned);
 const originals=current.map(q=>{
  const linked=mine.find(x=>x.id===q.id);
  const match=mine.find(x=>x.text.trim()===q.text.trim()&&x.correct===q.correct&&x.subject===subject&&x.lesson===lesson&&x.grade===grade&&x.options.every((v,i)=>v.trim()===q.options[i].trim()));
  const found=linked||match;
  return{...q,id:found?.id,grade,subject,lesson,visibility,expected_updated_at:found?.updatedAt};
 });
 const send=originals.map(({id,num,...item})=>({id,...item}));
 $('quickBankStatus').textContent='☁ Đang lưu '+send.length+' câu hỏi lên ngân hàng MotionClass...';
 const result=await api('bank.save_many',{items:send});
 if(result.items?.length!==send.length)throw Error('Số câu hỏi máy chủ xác nhận không đầy đủ, vui lòng kiểm tra lại trước khi lưu tiếp.');
 hooks.linkSaved(originals,result.items);
 await fetchAllFacets();
 const ids=result.items.map(r=>r.id);
 const owned=(await listAllAccessible()).filter(item=>ids.includes(item.id)&&item.owned);
 let voicesSaved=0,already=0;
 if(includeVoice){
  const voice=sharedVoice.id;
  const prior=await api('audio.list',{ids,voice_id:voice});
  for(const row of owned){
   for(const part of ['full','answer']){
    const text=row.spoken[part];
    const digest=await sha256(text);
    if((prior.items||[]).some(x=>x.id===row.id&&x.part===part&&x.textHash===digest)){already++;continue}
    if(hooks.voice().id!==voice)throw Error('Đã chuyển giọng NGHI-TTS trong khi lưu. Đã lưu câu hỏi, vui lòng thử tạo giọng lại.');
    $('quickBankStatus').textContent='🎙️ Đang tạo giọng '+voice+' cho câu '+(voicesSaved+already+1)+'/'+(owned.length*2)+'...';
    const clip=await hooks.generateClip(text);
    if(hooks.voice().id!==voice)throw Error('Giọng đã thay đổi, ngừng lưu âm thanh để tránh nhầm.');
    await uploadAudio(row,part,clip);hooks.storeClip(text,clip);voicesSaved++;
   }
  }
 }
 await refreshVoiceInventory();announceSync(includeVoice?'audio.put':'questions.saved');
 $('quickBankStatus').textContent='✅ Đã lưu '+result.items.length+' câu hỏi ('+result.created+' mới, '+result.updated+' cập nhật).'+(includeVoice?' Đã đồng bộ âm thanh: '+voicesSaved+' WAV mới, '+already+' WAV đã có.':'')+' Kiểm tra và nghe tại Ngân hàng câu hỏi.';
 status('☁ Đã cập nhật ngân hàng câu hỏi chung, có thể lấy lại trên các trò chơi khác.');
}
async function authCheck(){
 if(!client)throw Error('Chưa kết nối Supabase');
 const {data:{session:s},error}=await client.auth.getSession();
 if(error||!s?.access_token)throw Error('Chưa đăng nhập');
}
function bind(){
 $('bankLogin').onclick=()=>withButton('bankLogin',async()=>{
  const email=$('bankEmail').value.trim(),password=$('bankPassword').value;
  if(!email||!password)throw Error('Cần nhập email và mật khẩu tài khoản AI Pose Quiz.');
  const {data,error}=await client.auth.signInWithPassword({email,password});
  $('bankPassword').value='';
  if(error)throw error;updateSessionUI(data.user);await fetchAllFacets();
 });
 $('bankLogout').onclick=()=>withButton('bankLogout',async()=>{await client.auth.signOut();updateSessionUI(null)});
 $('bankRefresh').onclick=()=>withButton('bankRefresh',fetchBank);
 $('bankSubject').onchange=()=>withButton('bankRefresh',async()=>{$('bankLesson').value='ALL';await fetchBank()});
 $('bankLesson').onchange=()=>withButton('bankRefresh',fetchBank);
 $('bankSearch').onchange=()=>withButton('bankRefresh',fetchBank);
 $('bankSelectAll').onclick=()=>{
  const all=rows.every(q=>selected.has(q.id));
  for(const item of rows){if(all)selected.delete(item.id);else selected.add(item.id)}
  render();
 };
 $('bankImport').onclick=()=>withButton('bankImport',chooseQuestions);
 $('quickBankSave').onclick=()=>withButton('quickBankSave',async()=>{
  try{await quickSave(false)}catch(e){$('quickBankStatus').textContent='⚠ '+errorMessage(e);throw e}
 });
 $('quickBankSaveAudio').onclick=()=>withButton('quickBankSaveAudio',async()=>{
  try{await quickSave(true)}catch(e){$('quickBankStatus').textContent='⚠ '+errorMessage(e);throw e}
 });
 $('bankLoadVoice').onclick=()=>withButton('bankLoadVoice',()=>loadSavedVoice());
 $('raceSavedVoice').onchange=()=>withButton('bankLoadVoice',async()=>{
  const voice=$('raceSavedVoice').value;
  sessionStorage.setItem('marble.saved.voice',voice);
  hooks.onSavedVoiceChange?.();
  await loadSavedVoice();
  window.MarbleNameAudio?.refreshVoiceStatus?.();
 });
 $('bankSaveVoice').onclick=()=>withButton('bankSaveVoice',saveVoices);
 $('bankExport').onclick=()=>withButton('bankExport',downloadPack);
 client.auth.onAuthStateChange((evt,s)=>{if(evt==='SIGNED_OUT'){updateSessionUI(null)}});
 window.addEventListener('storage',e=>{if(e.key==='motionclass:shared-bank-sync'&&session)refreshVoiceInventory().catch(()=>{})});
 window.addEventListener('focus',()=>{if(session&&Date.now()-lastAudioInventoryCheck>2000)refreshVoiceInventory().catch(()=>{})});
}
if(!hooks||!settings?.url||!settings?.publishableKey||!window.supabase){
 status('Không tải được cấu hình MotionClass hoặc bộ thư viện Supabase.',true);return;
}
client=window.supabase.createClient(settings.url,settings.publishableKey,{
 auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}
});
bind();
refreshLogin().catch(e=>status('⚠ '+errorMessage(e),true));
window.MarbleSharedBankUI={loadSavedVoice,exportSelected:downloadPack,load:fetchBank,refreshSavedVoiceChoices,
 registerNameVoices(items){
  nameVoiceInventory=new Map();
  for(const item of items||[])if(item.url)nameVoiceInventory.set(item.voiceId,(nameVoiceInventory.get(item.voiceId)||0)+1);
  refreshSavedVoiceChoices();
 }};

/* Kịch bản lời dẫn: đường dẫn WAV câu hỏi đã lưu, theo từng phần (full, answer, question, option_a..d).
 * Chỉ nhận WAV còn khớp nội dung hiện tại (server kiểm tra text_hash). Ưu tiên giọng đang chọn,
 * nếu không có thì dùng giọng khác đã lưu. Không tạo âm thanh mới, không gọi Google. */
const questionAudioCache=new Map(),QUESTION_AUDIO_TTL=45*60*1000;
async function questionAudioUrls(ids,opts={}){
 const wanted=[...new Set((ids||[]).filter(id=>idpattern.test(String(id))))];
 const out=new Map();
 if(!wanted.length||!client)return out;
 let wantVoice='';try{wantVoice=hooks.voice().id||''}catch(_){}
 const strict=opts.strict===true,cacheKey=id=>(strict?wantVoice+'|':'*|')+id;
 const fresh=id=>{const c=questionAudioCache.get(cacheKey(id));return c&&Date.now()-c.at<QUESTION_AUDIO_TTL};
 const missing=wanted.filter(id=>!fresh(id));
 if(missing.length){
  try{await authCheck()}catch(_){return out}
  let preferred='';try{preferred=hooks.voice().id||''}catch(_){}
  for(let i=0;i<missing.length;i+=100){
   const chunk=missing.slice(i,i+100);
   const overview=await api('audio.overview',{ids:chunk});
   const choice=new Map();// id -> part -> voice
   for(const item of overview.items||[]){
    if(!item.current||(strict&&item.voiceId!==wantVoice))continue;
    if(!choice.has(item.id))choice.set(item.id,new Map());
    const parts=choice.get(item.id),prior=parts.get(item.part);
    if(!prior||item.voiceId===preferred)parts.set(item.part,item.voiceId);
   }
   const byVoice=new Map();
   for(const [id,parts] of choice)for(const voice of parts.values()){
    if(!byVoice.has(voice))byVoice.set(voice,new Set());byVoice.get(voice).add(id);
   }
   const urls=new Map(chunk.map(id=>[id,new Map()]));
   for(const [voice,set] of byVoice){
    const listed=await api('audio.list',{ids:[...set],voice_id:voice});
    for(const item of listed.items||[]){
     if(choice.get(item.id)?.get(item.part)===voice&&item.url)urls.get(item.id)?.set(item.part,item.url);
    }
   }
   for(const [id,parts] of urls)questionAudioCache.set(cacheKey(id),{at:Date.now(),parts});
  }
 }
 for(const id of wanted)out.set(id,questionAudioCache.get(cacheKey(id))?.parts||new Map());
 return out;
}
window.MarbleSharedBankAudio={urls:questionAudioUrls,clear:()=>questionAudioCache.clear()};
window.addEventListener('storage',e=>{if(e.key==='motionclass:shared-bank-sync')questionAudioCache.clear()});
})();
