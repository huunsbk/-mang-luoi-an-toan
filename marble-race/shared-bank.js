/* Shared Learning Bank v1: compatible with AI Pose Quiz, Marble Race and future classroom games.
 * Only uses MotionClass public key + authenticated Supabase session. Never exposes a server secret.
 * Assets stay in private Supabase Storage and are accessed through short-lived signed URLs.
 */
(function(){
'use strict';
const $=id=>document.getElementById(id);
const hooks=window.MarbleSharedBankHooks;
const settings=window.POSE_QUIZ_SUPABASE;
let client=null,rows=[],selected=new Set(),session=null,loadCount=0;
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
  info.append(title,meta);label.append(checkbox,info);fragment.appendChild(label);
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
 status('Đã tải '+rows.length+' câu hỏi. Tổng quyền truy cập: '+result.totalAccessible+' câu; chọn câu để thêm vào trò chơi.');
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
 if(s?.user)await fetchAllFacets();
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
 status('✓ Đã thêm '+added+' câu vào Đua bi. '+(items.length-added)+' câu có thể đã tồn tại.');
 if(hooks.isNghi())await loadSavedVoice(items.filter(i=>hooks.questions().some(q=>q.id===i.id)));
}
function sha256(value){
 return crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))
  .then(bytes=>Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,'0')).join(''));
}
async function fetchVoiceRows(items){
 const valid=items.filter(x=>idpattern.test(x.id));
 if(!valid.length)return [];
 return (await api('audio.list',{ids:valid.map(x=>x.id),voice_id:hooks.voice().id})).items||[];
}
async function loadSavedVoice(explicit=null){
 if(!hooks.isNghi()){status('Chọn nguồn giọng NGHI-TTS để nạp tệp âm thanh tương ứng.');return}
 const bankQuestions=hooks.questions();
 const requested=explicit||bankQuestions;
 if(!requested.length){status('Chưa có câu hỏi liên kết với Supabase trong Đua bi.');return}
 const items=await fetchVoiceRows(requested);
 const byId=new Map(bankQuestions.map(q=>[q.id,q]));
 let loaded=0,stale=0;
 for(const item of items){
  const question=byId.get(item.id);
  const speech=question?.spoken?.[item.part];
  if(!speech)continue;
  if(await sha256(speech)!==item.textHash){stale++;continue}
  const response=await fetch(item.url);
  if(!response.ok)continue;
  const blob=await response.blob();
  if(blob.size){
   hooks.storeClip(speech,blob);
   loaded++;
  }
 }
 status('⬇ Đã nạp '+loaded+' đoạn âm thanh vào bộ nhớ. '+(stale?'Có '+stale+' đoạn cũ cần tạo lại.':'Có thể chơi và phát ngay.'));
 return loaded;
}
async function saveVoices(){
 if(!hooks.isNghi())throw Error('Hãy chọn nguồn giọng NGHI-TTS trước khi tạo âm thanh.');
 const items=validateChoice(selectedRows()).filter(x=>x.owned);
 if(!items.length)throw Error('Không có câu thuộc quyền sở hữu được chọn để lưu giọng.');
 let done=0;
 for(const item of items){
  for(const part of ['full','answer']){
   status('🎙️ Đang tạo giọng '+hooks.voice().id+' · câu '+(done/2+1)+'/'+items.length+' · '+part);
   const clip=await hooks.generateClip(item.spoken[part]);
   await uploadAudio(item,part,clip);
   hooks.storeClip(item.spoken[part],clip);
   done++;
  }
 }
 status('✅ Đã lưu '+done+' đoạn âm thanh lên kho riêng tư Supabase. Các trò chơi khác có thể tải và phát lại.');
}
async function downloadPack(){
 const items=validateChoice(selectedRows());
 if(!window.JSZip)throw Error('Không tải được thư viện tạo ZIP. Hãy kiểm tra Internet.');
 const zip=new JSZip();
 const voice=hooks.voice().id;
 const meta={schema_version:'shared-learning-bank-v1',exported_at:new Date().toISOString(),voice_id:voice,
  questions:items.map(i=>({id:i.id,subject:i.subject,lesson:i.lesson,text:i.text,options:i.options,correct:i.correct,spoken:i.spoken,hasImage:!!i.imageUrl}))};
 zip.file('questions.json',JSON.stringify(meta,null,2));
 const audios=hooks.isNghi()?await fetchVoiceRows(items):[];
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
  try{const resp=await fetch(item.imageUrl);if(resp.ok)zip.file('images/'+item.id+'.jpg',await resp.blob())}catch(_e){}
 }
 status('📦 Đang đóng gói '+items.length+' câu hỏi và '+n+' tệp giọng đọc...');
 const blob=await zip.generateAsync({type:'blob',compression:'DEFLATE',compressionOptions:{level:5}});
 const url=URL.createObjectURL(blob);
 const anchor=document.createElement('a');anchor.href=url;anchor.download='ngan-hang-hoc-lieu-'+new Date().toISOString().slice(0,10)+'.zip';
 document.body.appendChild(anchor);anchor.click();anchor.remove();setTimeout(()=>URL.revokeObjectURL(url),6000);
 status('✅ Đã tạo gói ZIP: '+items.length+' câu, '+n+' tệp âm thanh hiện có.');
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
 $('bankLoadVoice').onclick=()=>withButton('bankLoadVoice',()=>loadSavedVoice());
 $('bankSaveVoice').onclick=()=>withButton('bankSaveVoice',saveVoices);
 $('bankExport').onclick=()=>withButton('bankExport',downloadPack);
 client.auth.onAuthStateChange((evt,s)=>{if(evt==='SIGNED_OUT'){updateSessionUI(null)}});
}
if(!hooks||!settings?.url||!settings?.publishableKey||!window.supabase){
 status('Không tải được cấu hình MotionClass hoặc bộ thư viện Supabase.',true);return;
}
client=window.supabase.createClient(settings.url,settings.publishableKey,{
 auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}
});
bind();
refreshLogin().catch(e=>status('⚠ '+errorMessage(e),true));
window.MarbleSharedBankUI={loadSavedVoice,exportSelected:downloadPack,load:fetchBank};
})();
