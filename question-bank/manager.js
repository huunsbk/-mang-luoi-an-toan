/* Shared question bank administration — authenticated Supabase MotionClass. */
(function(){
'use strict';
const $=id=>document.getElementById(id),cfg=window.POSE_QUIZ_SUPABASE;
const ENDPOINT=cfg?.url+'/functions/v1/shared-question-api';
const PARTS={full:'Đọc cả câu + A–D',question:'Nội dung câu hỏi',option_a:'Phương án A',option_b:'Phương án B',option_c:'Phương án C',option_d:'Phương án D',answer:'Công bố đáp án'};
const K=['A','B','C','D'];
let supabase=null,rows=[],selected=new Set(),editing=null,editingStamp=null,busy=false,files=[],audioURLs=new Map(),queue=0;
let audioInventory=new Map(),audioListSerial=0,audioPanelSerial=0,audioLastCheck=0,audioInventorySerial=0,removingVoiceFiles=new Set();
let scope='all',activeScreen='list',visibleRows=[],editSnapshot='',isRestoringRoute=false,batchAudio=null;
let studioInfo={configured:false,voiceVersion:''},studioStoredVoiceId='',studioPreviewAudio=null,studioPreviewURL='';
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

const MODEL_NAMES={deepman3909:'Nam trầm',chieuthanh:'Nam',duyoryx3175:'Nam',vietthao3886:'Nam',calmwoman3688:'Nữ',banmai:'Nữ',ngocngan3701:'Nữ'};
function voiceLabel(model){return (MODEL_NAMES[model]||'Giọng')+' · '+model}
function voiceIdLabel(voice){
 if(voice.startsWith('studio:'))return '✨ Google AI Studio · '+voice.slice(7,15);
 return '🎙️ '+voiceLabel(voice.replace(/^nghi:/,''));
}
function activeVoiceId(){
 return $('audioProvider').value==='studio'?(studioStoredVoiceId||'studio:'+(studioInfo.voiceVersion||'')):'nghi:'+$('voiceModel').value;
}
function currentGenerationVoiceId(){
 return $('audioProvider').value==='studio'?'studio:'+studioInfo.voiceVersion:'nghi:'+$('voiceModel').value;
}
function switchVoiceProvider(value,keepStored=false){
 const studio=value==='studio';
 $('audioProvider').value=studio?'studio':'nghi';
 if(!keepStored)studioStoredVoiceId='';
 $('nghiVoiceControls').hidden=studio;
 $('studioVoiceControls').hidden=!studio;
 $('studioDetails').hidden=!studio;
 // Provider selection only changes UI; the caller awaits AI Studio discovery before opening a new voice.
}
async function checkStudioTTS(){
 $('studioStatus').textContent='⏳ Đang kiểm tra Google AI Studio...';
 try{
  const response=await fetch('/api/marble-tts',{cache:'no-store'});
  if(!response.ok)throw Error('Máy chủ AI Studio trả lỗi '+response.status);
  const data=await response.json(),version=String(data.voiceVersion||'');
  if(!/^[a-f0-9]{16}$/.test(version))throw Error('Không nhận được mã phiên bản giọng AI hợp lệ.');
  studioInfo={configured:data.configured===true,voiceVersion:version};
  $('studioStatus').textContent=studioInfo.configured?'✅ AI Studio sẵn sàng. Nhập mã giáo viên để tạo giọng hoặc nghe thử.':'⚠ AI Studio chưa được cấu hình trên Vercel. Các tệp WAV đã lưu vẫn nghe lại được.';
  return studioInfo;
 }catch(error){
  studioInfo={configured:false,voiceVersion:''};
  $('studioStatus').textContent='⚠ '+issue(error);
  return studioInfo;
 }
}
async function makeStudioClip(text){
 if(!studioInfo.configured||!/^[a-f0-9]{16}$/.test(studioInfo.voiceVersion))throw Error('Google AI Studio chưa sẵn sàng. Hãy nhấn Kiểm tra AI Studio.');
 const pin=$('studioTeacherPin').value;
 if(!pin.trim())throw Error('Vui lòng nhập mã truy cập AI Studio dành cho giáo viên.');
 if(String(text).length>1800)throw Error('Đoạn đọc quá dài với AI Studio (tối đa 1800 ký tự).');
 const response=await fetch('/api/marble-tts',{method:'POST',
   headers:{'Content-Type':'application/json','X-Marble-Teacher-Code':pin},body:JSON.stringify({text})});
 if(!response.ok){const msg=await response.json().catch(()=>({}));throw Error(msg.error||'Google AI Studio báo lỗi HTTP '+response.status)}
 const blob=await response.blob();
 const header=String.fromCharCode(...new Uint8Array(await blob.slice(0,12).arrayBuffer()));
 if(!header.startsWith('RIFF')||header.slice(8,12)!=='WAVE'||blob.size<45)throw Error('AI Studio không trả tệp WAV hợp lệ.');
 return blob;
}
async function playStudioPreview(){
 await run(async()=>{
  if(!studioInfo.configured)await checkStudioTTS();
  const content=editing?.spoken?.question||'Xin chào các em. Hôm nay chúng ta cùng học một bài thật thú vị.';
  report('audioStatus','✨ Đang tạo đoạn nghe thử từ Google AI Studio...');
  const clip=await makeStudioClip(content);
  if(studioPreviewAudio){studioPreviewAudio.pause();studioPreviewAudio=null}
  if(studioPreviewURL){URL.revokeObjectURL(studioPreviewURL);studioPreviewURL=''}
  const url=URL.createObjectURL(clip);studioPreviewURL=url;
  const a=new Audio(url);studioPreviewAudio=a;
  a.onended=()=>{if(studioPreviewAudio===a){studioPreviewAudio=null;URL.revokeObjectURL(url);studioPreviewURL=''}};
  await a.play();report('audioStatus','▶ Đang nghe thử giọng Google AI Studio (chưa lưu vào ngân hàng).');
 });
}
function inventoryFor(id){return audioInventory.get(id)||[]}
function audioInfo(row){
 const parts=inventoryFor(row.id),current=parts.filter(x=>x.current),stale=parts.filter(x=>!x.current);
 const voices=[...new Set(current.map(x=>x.voiceId))];
 return {total:parts.length,ready:current.length,stale:stale.length,voices,current};
}
function markSync(change='audio'){
 try{localStorage.setItem('motionclass:shared-bank-sync',JSON.stringify({at:Date.now(),change}))}catch(_){}
}
function showInventoryStats(){
 const withVoice=rows.filter(r=>audioInfo(r).ready>0).length;
 const stale=rows.filter(r=>audioInfo(r).stale>0).length;
 $('audioStats').textContent=withVoice+' có giọng · '+(rows.length-withVoice)+' chưa có'+(stale?' · '+stale+' cần cập nhật':'');
}
async function loadAudioInventory(){
 const serial=++audioInventorySerial;
 const ids=rows.map(x=>x.id).filter(Boolean);
 const collected=new Map();
 for(let i=0;i<ids.length;i+=100){
  const result=await api('audio.overview',{ids:ids.slice(i,i+100)});
  for(const file of result.items||[]){
   if(!collected.has(file.id))collected.set(file.id,[]);
   collected.get(file.id).push(file);
  }
 }
 if(serial!==audioInventorySerial)return;
 audioInventory=collected;audioLastCheck=Date.now();
 showInventoryStats();renderList();
}
async function refreshAudioState(force=false){
 if(!$('appPanel')||$('appPanel').hidden||!supabase||!rows.length)return;
 if(!force&&Date.now()-audioLastCheck<1500)return;
 const serial=++audioListSerial;
 try{
  await loadAudioInventory();
  if(serial!==audioListSerial)return;
  if(editing?.id)await showAudio();
 }catch(error){
  report('audioStatus','⚠ Không đồng bộ được kho âm thanh: '+issue(error),true);
 }
}
function ensureVoiceOption(model){
 const dropdown=$('voiceModel');
 if(![...dropdown.options].some(o=>o.value===model))dropdown.add(new Option('Giọng đã lưu · '+model,model));
}
function autoChooseVoice(item){
 if(!item?.id)return;
 const parts=inventoryFor(item.id);if(!parts.length)return;
 const choices=new Map();
 for(const part of parts)choices.set(part.voiceId,(choices.get(part.voiceId)||0)+(part.current?10:1));
 const favorite=[...choices.entries()].sort((a,b)=>b[1]-a[1])[0]?.[0];
 if(favorite?.startsWith('studio:')){switchVoiceProvider('studio',true);studioStoredVoiceId=favorite;void checkStudioTTS()}
 else if(favorite?.startsWith('nghi:')){switchVoiceProvider('nghi');const model=favorite.slice(5);ensureVoiceOption(model);$('voiceModel').value=model}
}
function drawAudioSummary(item){
 const area=$('audioOverview'),voices=$('audioVoiceList');area.replaceChildren();voices.replaceChildren();
 if(!item?.id){
  area.textContent='Chọn câu hỏi trong danh sách bên trái để xem giọng đọc và tệp WAV đã lưu.';
  $('audioVoiceHint').textContent='Chỉ cần lưu một lần trên Đua bi hoặc Ngân hàng: cả hai sử dụng chung kho âm thanh.';
  return;
 }
 const info=audioInfo(item),label=document.createElement('strong');
 label.textContent=info.ready?'✅ '+info.ready+' tệp WAV sử dụng được · '+info.voices.length+' giọng':'Chưa có tệp giọng đọc còn hiệu lực';
 area.append(label);
 const badge=document.createElement('span');badge.className='audio-chip '+(info.ready?'ready':info.stale?'stale':'empty');
 badge.textContent=info.stale?'⚠ '+info.stale+' tệp cũ cần tạo lại':info.ready?'Đã đồng bộ MotionClass':'Chưa có âm thanh';
 area.append(badge);
 const groups=new Map();
 for(const file of inventoryFor(item.id)){
  if(!groups.has(file.voiceId))groups.set(file.voiceId,{ready:0,stale:0});
  groups.get(file.voiceId)[file.current?'ready':'stale']++;
 }
 for(const [voice,counts] of groups){
  const button=document.createElement('button');button.type='button';
  button.className=activeVoiceId()===voice?'selected':'';
  button.textContent=voiceIdLabel(voice)+' · '+counts.ready+'/7'+(counts.stale?' · '+counts.stale+' cũ':'');
  button.title='Xem các tệp âm thanh đã lưu của '+voiceIdLabel(voice);
  button.onclick=()=>{
   if(voice.startsWith('studio:')){switchVoiceProvider('studio',true);studioStoredVoiceId=voice}
   else if(voice.startsWith('nghi:')){switchVoiceProvider('nghi');const model=voice.slice(5);ensureVoiceOption(model);$('voiceModel').value=model}
   voiceEngine.stop();showAudio().catch(e=>report('audioStatus',issue(e),true));
  };
  voices.append(button);
 }
 $('audioVoiceHint').textContent=groups.size?'Chọn một giọng đã lưu để nghe và tải WAV; những đoạn cũ cần tạo lại sau khi sửa câu hỏi.':'Chưa có giọng. Nhấn “Tạo / bổ sung đoạn còn thiếu” để lưu âm thanh.';
}
function showEditor(item=null){
 editing=item;editingStamp=item?.updatedAt||null;
 autoChooseVoice(item);
 $('editId').value=item?.id||'';$('subject').value=item?.subject||$('filterSubject').value.replace('ALL','')||'Tin học';
 const grade=item?.grade??(item?.id?Number((gradeOf(item).match(/\d+/)||[])[0]||0):Number(($('filterGrade').value.match(/\d+/)||[])[0]||0));
 $('editGrade').value=grade>=1&&grade<=12?String(grade):'';
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
 showAudio().catch(error=>report('audioStatus','⚠ '+issue(error),true));
}
function formItem(){
 const grade=Number($('editGrade').value);
 if(!Number.isInteger(grade)||grade<1||grade>12)throw Error('Vui lòng chọn lớp từ 1 đến 12 trước khi lưu câu hỏi.');
 return{id:$('editId').value||undefined,grade,subject:$('subject').value.trim(),lesson:$('lesson').value.trim(),text:$('question').value.trim(),options:K.map(k=>$('option'+k).value.trim()),correct:$('correct').value,
  visibility:$('visibility').value,expected_updated_at:editingStamp||undefined};
}

function gradeOf(row){
 const explicit=Number(row.grade);
 if(Number.isInteger(explicit)&&explicit>=1&&explicit<=12)return 'Lớp '+explicit;
 const candidates=[String(row.subject||''),String(row.lesson||'')];
 for(const str of candidates){
  let m=str.match(/(?:lớp|khối)\s*(1[0-2]|[1-9])(?:\D|$)/i)
       ||str.match(/(?:tin(?:\s*học)?|toán|ngữ\s*văn|khoa\s*học|công\s*nghệ)\s*(1[0-2]|[1-9])(?:\D|$)/i);
  if(m)return 'Lớp '+m[1];
 }
 return 'Chưa phân lớp';
}
function groupValue(item,by){
 if(by==='grade')return gradeOf(item);
 if(by==='subject')return item.subject||'Chưa xác định môn';
 if(by==='lesson')return (item.subject||'Chưa có môn')+' · '+(item.lesson||'Chưa có bài học');
 return '';
}
/** Remove all provider versions and all parts of a single owned question.
 * The backend checks the owner again; a client-side badge is never authority. */
async function deleteAllQuestionVoices(item){
 if(!item?.id||!item.owned||removingVoiceFiles.has(item.id))return;
 const info=audioInfo(item);
 if(!info.total)return;
 const voices=new Set(inventoryFor(item.id).map(x=>x.voiceId));
 if(!confirm('XÓA TOÀN BỘ GIỌNG ĐỌC?\n\nCâu hỏi: '+item.text+
  '\n\nSẽ xóa vĩnh viễn '+info.total+' tệp WAV của '+voices.size+
  ' giọng (bao gồm NGHI-TTS, Google AI Studio và tệp cũ).'+
  '\nNội dung câu hỏi và các phương án được giữ nguyên.\n\nThầy/cô có chắc chắn muốn xóa không?'))return;
 removingVoiceFiles.add(item.id);renderList();
 let notice='',failed=false;
 try{
  const result=await api('audio.delete_all',{id:item.id});
  await loadAudioInventory();
  markSync('audio.delete_all');
  if(editing?.id===item.id){
   if(activeScreen==='audio')await showAudio();
   else if(activeScreen==='preview')showPreview(item);
  }
  notice='✅ Đã xóa '+Number(result.deleted||0)+' tệp WAV thuộc '+Number(result.voices||0)+' giọng của câu hỏi. Nội dung câu hỏi được giữ nguyên.';
 }catch(error){
  failed=true;notice='⚠ Không xóa hết giọng đọc: '+issue(error)+'. Hãy tải lại và kiểm tra trạng thái.';
  await loadAudioInventory().catch(()=>{});
 }finally{
  removingVoiceFiles.delete(item.id);
  renderList();
  setListMessage(notice,failed);
  if(editing?.id===item.id&&activeScreen==='audio')report('audioStatus',notice,failed);
 }
}
function getFilteredRows(){
 const sub=$('filterSubject').value,lesson=$('filterLesson').value,grade=$('filterGrade').value;
 const audio=$('filterAudio').value,needle=$('filterSearch').value.trim().toLocaleLowerCase('vi');
 const mine=$('onlyMine').checked;
 return rows.filter(r=>
  (!mine||r.owned)&&
  (scope==='all'||r.visibility===scope)&&
  (sub==='ALL'||r.subject===sub)&&
  (lesson==='ALL'||r.lesson===lesson)&&
  (grade==='ALL'||gradeOf(r)===grade)&&
  (audio==='all'||(audio==='ready'&&audioInfo(r).ready>0)||(audio==='none'&&audioInfo(r).ready===0)||(audio==='stale'&&audioInfo(r).stale>0))&&
  (!needle||[r.text,...r.options,r.subject,r.lesson].join(' ').toLocaleLowerCase('vi').includes(needle))
 );
}
function pill(kind,value){const span=document.createElement('span');span.className='audio-chip '+kind;span.textContent=value;return span}
function action(label,handler){const b=document.createElement('button');b.type='button';b.textContent=label;b.onclick=handler;return b}
function renderList(){
 const body=$('questionList');body.replaceChildren();
 visibleRows=getFilteredRows();
 $('statTotal').textContent=rows.length;
 $('statMine').textContent=rows.filter(r=>r.owned).length;
 $('statVoice').textContent=rows.filter(r=>audioInfo(r).ready>0).length;
 $('statOld').textContent=rows.filter(r=>audioInfo(r).stale>0).length;
 for(const [id,vis] of [['scopeCountAll','all'],['scopeCountPrivate','private'],['scopeCountPublic','public'],['scopeCountGroup','group']]){
  $(''+id).textContent=rows.filter(r=>(!$('onlyMine').checked||r.owned)&&(vis==='all'||r.visibility===vis)).length;
 }
 document.querySelectorAll('.scope-tab').forEach(btn=>{
  const enabled=btn.dataset.scope===scope;btn.classList.toggle('active',enabled);btn.setAttribute('aria-selected',String(enabled));
 });
 $('listInfo').textContent='Đang hiển thị '+visibleRows.length+'/'+rows.length+' câu';
 $('selectedCount').textContent=selected.size?'Đã chọn '+selected.size+' câu hỏi':'Chưa chọn câu hỏi';
 $('bankTotals').textContent=rows.length+' câu hỏi';
 $('checkVisible').checked=visibleRows.length>0&&visibleRows.every(r=>selected.has(r.id));
 $('checkVisible').indeterminate=visibleRows.some(r=>selected.has(r.id))&&!$('checkVisible').checked;
 if(!visibleRows.length){
  const tr=document.createElement('tr'),td=document.createElement('td');td.colSpan=9;td.className='muted';td.style.padding='26px';td.textContent='Không tìm thấy câu hỏi phù hợp. Hãy thay đổi bộ lọc hoặc tạo câu hỏi mới.';tr.append(td);body.append(tr);return;
 }
 const by=$('groupBy').value,sorted=[...visibleRows].sort((a,b)=>{
  const groupA=groupValue(a,by),groupB=groupValue(b,by);
  return groupA.localeCompare(groupB,'vi')||String(a.text).localeCompare(String(b.text),'vi');
 });
 let prevGroup=null,index=0;
 for(const item of sorted){
  const group=groupValue(item,by);
  if(by!=='none'&&group!==prevGroup){
   const tr=document.createElement('tr');tr.className='group-row';const td=document.createElement('td');td.colSpan=9;
   const num=sorted.filter(r=>groupValue(r,by)===group).length;
   td.textContent='▸ '+group+' ('+num+' câu)';tr.append(td);body.append(tr);prevGroup=group;
  }
  const tr=document.createElement('tr');tr.className='resource-row'+(editing?.id===item.id?' active':'');
  const select=document.createElement('td');const checkbox=document.createElement('input');
  checkbox.type='checkbox';checkbox.checked=selected.has(item.id);
  checkbox.setAttribute('aria-label','Chọn '+item.text);
  checkbox.onchange=()=>{checkbox.checked?selected.add(item.id):selected.delete(item.id);renderList()};
  select.append(checkbox);tr.append(select);
  const serial=document.createElement('td');serial.textContent=String(++index);tr.append(serial);
  const title=document.createElement('td');title.className='title-cell';
  const btn=action(item.text,()=>openScreen('preview',item));btn.className='resource-title';btn.style.cssText='text-align:left;background:transparent;padding:0;font-size:14px;font-weight:760;color:#1b3769';
  const wrap=document.createElement('div');wrap.className='resource-title-wrap';
  const icon=document.createElement('div');icon.className='resource-thumb';icon.textContent='☑';icon.setAttribute('aria-hidden','true');
  const copy=document.createElement('div');copy.className='resource-copy';copy.append(btn);
  const small=document.createElement('small');small.textContent='Trắc nghiệm 4 lựa chọn'+(item.imageUrl?' · Có ảnh':'');copy.append(small);
  wrap.append(icon,copy);title.append(wrap);tr.append(title);
  const gradeTd=document.createElement('td');gradeTd.textContent=gradeOf(item);tr.append(gradeTd);
  const subjectTd=document.createElement('td');subjectTd.textContent=item.subject||'—';tr.append(subjectTd);
  const lessonTd=document.createElement('td');lessonTd.textContent=item.lesson||'—';tr.append(lessonTd);
  const visibility=document.createElement('td');const vis=document.createElement('span');vis.className='scope-label '+item.visibility;
  vis.textContent=item.visibility==='public'?'🌐 Công khai':item.visibility==='private'?'🔒 Riêng tư':'👥 Nhóm';visibility.append(vis);tr.append(visibility);
  const voices=document.createElement('td'),info=audioInfo(item);
  const wrapper=document.createElement('div');
  wrapper.className='voice-pill-wrap'+(item.owned&&info.total?' has-delete':'');
  const voiceCount=new Set(inventoryFor(item.id).map(file=>file.voiceId)).size;
  const badge=pill(info.ready?'ready':info.stale?'stale':'empty',
    info.ready?'🎙 '+info.voices.length+' giọng · '+info.ready+' WAV':
    info.stale?'⚠ '+voiceCount+' giọng · '+info.stale+' WAV cũ':'Chưa có giọng');
  wrapper.append(badge);
  if(item.owned&&info.total){
   const delVoice=document.createElement('button');delVoice.type='button';delVoice.className='voice-delete';
   delVoice.textContent='×';
   delVoice.title='Xóa tất cả '+info.total+' tệp WAV của câu hỏi (không xóa câu hỏi)';
   delVoice.setAttribute('aria-label','Xóa toàn bộ giọng đọc của câu: '+item.text);
   delVoice.disabled=removingVoiceFiles.has(item.id);
   delVoice.onclick=event=>{event.stopPropagation();void deleteAllQuestionVoices(item)};
   wrapper.append(delVoice);
  }
  voices.append(wrapper);tr.append(voices);
  const tdAction=document.createElement('td'),actions=document.createElement('div');actions.className='actions-inline';
  actions.append(action('👁 Xem',()=>openScreen('preview',item)));
  const edit=action('✏️ Sửa',()=>openScreen('edit',item));edit.disabled=!item.owned;actions.append(edit);
  actions.append(action('🎙 WAV',()=>openScreen('audio',item)));
  const extra=action('⋯',()=>{if(!item.owned){openScreen('preview',item);return}if(confirm('Xóa câu hỏi này? Âm thanh liên quan cũng sẽ bị xóa.')){void run(async()=>{await api('bank.delete',{id:item.id});selected.delete(item.id);await reload(false);setListMessage('Đã xóa câu hỏi.')})}});
  extra.className='more';extra.title=item.owned?'Xóa câu hỏi':'Xem câu hỏi';actions.append(extra);
  tdAction.append(actions);tr.append(tdAction);body.append(tr);
 }
}
function setListMessage(message,error=false){
 const text=$('listInfo');text.textContent=message;text.style.color=error?'#b82d46':'#246097';
}
function snapshot(){return JSON.stringify(['editGrade','subject','lesson','question','optionA','optionB','optionC','optionD','correct','visibility'].map(id=>$(id).value))}
function canLeaveEditor(){
 return activeScreen!=='edit'||!editSnapshot||snapshot()===editSnapshot||confirm('Câu hỏi chưa được lưu. Thầy/cô muốn rời màn hình biên tập?');
}
function showPreview(item){
 const meta=$('previewMeta');meta.replaceChildren();
 $('previewTitle').textContent='Chi tiết câu hỏi';
 $('previewQuestion').textContent=item.text;
 $('previewOptions').replaceChildren();
 K.forEach((letter,i)=>{
  const div=document.createElement('div');div.className='preview-option'+(item.correct===letter?' correct':'');
  const symbol=document.createElement('b');symbol.textContent=letter+'.';
  div.append(symbol,document.createTextNode(item.options[i]||''));if(item.correct===letter)div.append(document.createTextNode(' ✓ Đáp án đúng'));
  $('previewOptions').append(div);
 });
 for(const text of [gradeOf(item),item.subject,item.lesson,item.visibility==='public'?'Công khai':item.visibility==='private'?'Riêng tư':'Nhóm']){
  const chip=document.createElement('span');chip.className='pill';chip.textContent=text;meta.append(chip);
 }
 const info=audioInfo(item);
 $('previewAudioStatus').textContent=info.ready?'🎙 Đã có '+info.ready+' WAV của '+info.voices.length+' giọng đọc'+(info.stale?' · '+info.stale+' tệp cũ':''):'Chưa có giọng đọc hợp lệ'+(info.stale?' · '+info.stale+' tệp cũ':'');
 $('previewEdit').disabled=!item.owned;
 $('previewCopy').disabled=!item.owned;
}
function openScreen(screen,item=null,updateHash=true){
 if(!['list','preview','edit','audio','import','batch'].includes(screen))screen='list';
 if(!canLeaveEditor())return false;
 if(['preview','audio'].includes(screen)&&!item?.id)return false;
 if(item&&screen==='edit'&&!item.owned)return false;
 activeScreen=screen;
 document.querySelectorAll('.library-screen').forEach(view=>{view.hidden=view.id!==screen+'View'});
 if(['preview','edit','audio'].includes(screen)){showEditor(item);if(screen==='preview')showPreview(item)}
 if(screen==='edit')editSnapshot=snapshot();
 if(screen==='audio')$('audioPageTitle').textContent='🎙 Giọng đọc: '+item.text;
 if(screen==='batch')batchAudio?.open();
 if(screen==='list')renderList();
 if(updateHash){
  const hash=screen==='list'?'#library':screen==='import'?'#import':screen==='batch'?'#batch':screen==='edit'&&!item?.id?'#new':'#'+screen+'/'+encodeURIComponent(item?.id||'');
  if(location.hash!==hash)history.pushState({screen,id:item?.id},'',hash);
 }
 window.scrollTo({top:0,behavior:'instant'});
 return true;
}
function newQuestionScreen(){
 if(!openScreen('edit',null))return;
 showEditor(null);editSnapshot=snapshot();
 const url='#new';if(location.hash!==url)history.replaceState({screen:'edit'},'',url);
}
function cloneCurrent(){
 if(!editing?.owned)return;
 const copy={...editing,id:null,visibility:'private',updatedAt:null,owned:true};
 if(!openScreen('edit',null))return;
 showEditor(copy);$('editId').value='';editing=null;editingStamp=null;editSnapshot=snapshot();
 report('editStatus','Đang nhân bản thành một câu hỏi mới. Nhấn Lưu câu hỏi để hoàn tất.');
 history.replaceState({screen:'edit'},'','#new');
}
function restoreRoute(){
 if($('appPanel').hidden)return;
 const route=decodeURIComponent(location.hash.replace(/^#/,'')).split('/');
 const screen=route[0]==='new'?'edit':route[0]==='library'?'list':route[0];
 const item=rows.find(x=>x.id===route[1]);
 if(screen==='import')openScreen('import',null,false);
 else if(screen==='batch')openScreen('batch',null,false);
 else if(screen==='edit'&&route[0]==='new')newQuestionScreen();
 else if(['preview','edit','audio'].includes(screen)&&item)openScreen(screen,item,false);
 else openScreen('list',null,false);
}
async function reload(preserveEditor=true){
 const old=preserveEditor?editing?.id:null,sub=$('filterSubject').value,lesson=$('filterLesson').value,grade=$('filterGrade').value;
 let offset=0,data=null;const collected=[];
 for(let page=0;page<40;page++){
  data=await api('bank.list',{subject:'ALL',lesson:'ALL',search:'',offset,limit:250});
  collected.push(...(data.items||[]));
  if(data.nextOffset==null)break;
  offset=data.nextOffset;
 }
 rows=collected;
 selected=new Set([...selected].filter(id=>rows.some(x=>x.id===id)));
 fill($('filterSubject'),data.facets?.subjects||[],'Tất cả môn học',sub);
 const grades=Array.from({length:12},(_,i)=>'Lớp '+(i+1));
 if(rows.some(r=>gradeOf(r)==='Chưa phân lớp'))grades.push('Chưa phân lớp');
 const gradeSelect=$('filterGrade');
 gradeSelect.replaceChildren(new Option('Tất cả khối lớp','ALL'));
 for(const option of grades)gradeSelect.add(new Option(option,option));
 gradeSelect.value=grades.includes(grade)?grade:'ALL';
 const lessons=[...new Set(rows.filter(r=>$('filterSubject').value==='ALL'||r.subject===$('filterSubject').value).map(r=>r.lesson))];
 fill($('filterLesson'),lessons,'Tất cả bài học',lesson);
 const active=rows.find(x=>x.id===old);
 if(old&&!active)showEditor(null);else if(active)showEditor(active);
 renderList();
 await refreshAudioState(true);
 report('editStatus','✅ Đã tải '+rows.length+' câu hỏi và cập nhật trạng thái âm thanh từ MotionClass.');
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
 await reload(false);restoreRoute();
}
async function saveQuestion(){
 await run(async()=>{
  const item=formItem();
  const result=await api('bank.save',{item});
  const saved=result.items?.[0];if(!saved)throw Error('Máy chủ chưa trả về mã câu hỏi mới.');
  report('editStatus','✅ Đã '+(saved.created?'tạo':'cập nhật')+' câu hỏi trong ngân hàng.');await reload(false);
  const updated=rows.find(r=>r.id===saved.id);editSnapshot=snapshot();if(updated)openScreen('preview',updated);
 });
}
async function deleteQuestion(){
 if(!editing?.owned)return;
 if(!confirm('Xóa vĩnh viễn câu hỏi này cùng các âm thanh dùng chung?'))return;
 await run(async()=>{await api('bank.delete',{id:editing.id});selected.delete(editing.id);editSnapshot=snapshot();showEditor(null);await reload(false);openScreen('list');setListMessage('Đã xóa câu hỏi thành công.')});
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
  await reload(false);setListMessage('Đã xóa '+count+' câu hỏi.');
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
 const selectedGrade=Number($('bulkGrade').value);
 if(!Number.isInteger(selectedGrade)||selectedGrade<1||selectedGrade>12)throw Error('Chọn lớp áp dụng từ 1 đến 12 trước khi nhập câu hỏi.');
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
 return parsed.items.map(i=>({...i,grade:selectedGrade,subject:$('bulkSubject').value.trim(),lesson:$('bulkLesson').value.trim(),visibility:$('bulkPublic').checked?'public':'private'}));
}
async function bulkSave(){
 await run(async()=>{
  const items=bulkItems();
  if(!items[0].subject||!items[0].lesson)throw Error('Hãy nhập môn học và bài học.');
  const existing=new Set(rows.filter(r=>r.owned).map(r=>JSON.stringify([r.text.trim(),r.options,r.correct,r.subject,r.lesson,gradeOf(r)])));
  const filtered=items.filter(r=>{const key=JSON.stringify([r.text.trim(),r.options.map(s=>String(s).trim()),r.correct,r.subject,r.lesson,'Lớp '+r.grade]);if(existing.has(key))return false;existing.add(key);return true});
  if(!filtered.length){report('bulkStatus','Các câu hỏi này đã tồn tại; không tạo bản trùng.');return}
  const result=await api('bank.save_many',{items:filtered});
  $('bulkText').value='';report('bulkStatus','✅ Đã lưu '+result.created+' câu. Bỏ qua '+(items.length-filtered.length)+' câu trùng.');
  await reload();openScreen('list');setListMessage('Đã nhập thành công '+result.created+' câu hỏi.');
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
  const lines=[['ID','Lớp','Môn','Bài','Câu hỏi','A','B','C','D','Đáp án','Phạm vi'].map(esc).join(',')];
  for(const item of list)lines.push([item.id,item.grade??gradeOf(item),item.subject,item.lesson,item.text,...item.options,item.correct,item.visibility].map(esc).join(','));
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
 return (await api('audio.list',{ids,voice_id:activeVoiceId()})).items||[];
}
async function showAudio(){
 const serial=++audioPanelSerial,box=$('audioGrid'),item=editing;
 box.replaceChildren();drawAudioSummary(item);
 if(!item?.id){report('audioStatus','Chọn câu hỏi đã lưu để nghe hoặc tải tệp âm thanh.');return}
 const voice=activeVoiceId(),model=voice.replace(':','-');
 const metadata=await audioMetadata([item.id]);
 if(serial!==audioPanelSerial||editing?.id!==item.id||activeVoiceId()!==voice)return;
 const fingerprints=await Promise.all(Object.keys(PARTS).map(async part=>[part,item.spoken?.[part]?await hash(item.spoken[part]):null]));
 if(serial!==audioPanelSerial||editing?.id!==item.id||activeVoiceId()!==voice)return;
 const digests=new Map(fingerprints);let usable=0,stale=0;
 for(const [part,label] of Object.entries(PARTS)){
  const container=document.createElement('div');container.className='audio-cell';
  const title=document.createElement('span');title.textContent=label;container.append(title);
  const file=metadata.find(x=>x.id===item.id&&x.part===part);
  const current=Boolean(file&&digests.get(part)&&digests.get(part)===file.textHash);
  if(current){
   usable++;container.classList.add('ready');
   const info=document.createElement('span');info.className='audio-chip ready';info.textContent='✓ Đã lưu WAV';container.append(info);
   const actions=document.createElement('div');actions.className='audio-file-row';
   const play=document.createElement('button');play.type='button';play.textContent='▶ Nghe';
   play.onclick=async()=>{try{await new Audio(file.url).play()}catch(e){report('audioStatus','Không phát được âm thanh: '+issue(e),true)}};
   const link=document.createElement('button');link.type='button';link.textContent='↓ Tải WAV';link.className='buttonlink';
   link.onclick=async()=>{
    link.disabled=true;
    try{
     const response=await fetch(file.url);
     if(!response.ok)throw Error('Liên kết âm thanh đã hết hạn. Hãy nhấn Đồng bộ.');
     const blob=await response.blob(),url=URL.createObjectURL(blob),a=document.createElement('a');
     a.href=url;a.download='cau-hoi-'+item.id.slice(0,8)+'-'+model+'-'+part+'.wav';
     document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),12000);
    }catch(error){report('audioStatus','⚠ Không tải được WAV: '+issue(error),true)}
    finally{link.disabled=false}
   };
   actions.append(play,link);
   if(item.owned){
    const del=document.createElement('button');del.type='button';del.className='danger';del.textContent='Xóa WAV';
    del.onclick=()=>run(async()=>{
     if(!confirm('Xóa âm thanh “'+label+'” của giọng '+model+'?'))return;
     await api('audio.delete',{id:item.id,voice_id:voice,part});
     markSync('audio.delete');
     await refreshAudioState(true);
     report('audioStatus','Đã xóa WAV '+label+'. Câu hỏi vẫn còn nguyên.');
    });
    actions.append(del);
   }
   container.append(actions);
  }else if(file){stale++;container.classList.add('stale');const msg=document.createElement('span');msg.textContent='⚠ Tệp đã cũ — cần tạo lại sau khi thay nội dung';container.append(msg)}
  else{const missing=document.createElement('span');missing.textContent='Chưa có tệp WAV';missing.className='muted';container.append(missing)}
  box.append(container);
 }
 report('audioStatus','Đã tìm thấy '+usable+'/7 WAV của '+voiceIdLabel(voice)+'.'+(stale?' Có '+stale+' tệp cũ cần cập nhật.':'')+' Những tệp hiện hành có thể nghe và tải trực tiếp.');
 drawAudioSummary(item);
}
async function voiceFor(items,parts){
 const mine=items.filter(item=>item.owned);
 if(!mine.length)throw Error('Chỉ chủ sở hữu câu hỏi được tạo và lưu giọng.');
 const provider=$('audioProvider').value;
 if(provider==='studio'){
  await checkStudioTTS();
  if(!studioInfo.configured)throw Error('AI Studio chưa sẵn sàng trên Vercel.');
  if(!$('studioTeacherPin').value.trim())throw Error('Hãy nhập mã truy cập AI Studio dành cho giáo viên.');
 }
 const voice=currentGenerationVoiceId();
 if(!/^nghi:[a-z0-9]{2,45}$/.test(voice)&&!/^studio:[a-f0-9]{16}$/.test(voice))
  throw Error('Mã giọng không hợp lệ; hãy kiểm tra lại kết nối.');
 let completed=0,skipped=0;
 for(const item of mine){
  const metadata=(await api('audio.list',{ids:[item.id],voice_id:voice})).items||[];
  for(const part of parts){
   if(provider!==$('audioProvider').value||voice!==currentGenerationVoiceId())
    throw Error('Giọng đã được thay đổi. Đã dừng tạo để tránh lưu nhầm.');
   const content=item.spoken?.[part];if(!content)continue;
   const fingerprint=await hash(content);
   if(metadata.some(m=>m.part===part&&m.textHash===fingerprint)){skipped++;continue}
   report('audioStatus',(provider==='studio'?'✨ AI Studio':'🎙️ NGHI-TTS')+' · '+item.text.slice(0,45)+' · '+PARTS[part]+'...');
   const clip=provider==='studio'?await makeStudioClip(content):await voiceEngine.make($('voiceModel').value,content);
   if(provider!==$('audioProvider').value||voice!==currentGenerationVoiceId())
    throw Error('Giọng đã thay đổi khi đang tạo; đoạn này không được lưu.');
   await uploadVoice(item.id,voice,part,clip);completed++;
  }
 }
 if(provider==='studio')studioStoredVoiceId=voice;
 await refreshAudioState(true);
 markSync('audio.put');
 report('audioStatus','✅ Đã lưu '+completed+' WAV mới bằng '+voiceIdLabel(voice)+', giữ nguyên '+skipped+' đoạn đã có.');
}
async function init(){
 if(!cfg?.url||!cfg?.publishableKey||!window.supabase){report('editStatus','Không tải được kết nối MotionClass.',true);return}
 supabase=window.supabase.createClient(cfg.url,cfg.publishableKey,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}});
 $('loginForm').onsubmit=login;
 $('logout').onclick=()=>run(async()=>{await supabase.auth.signOut();showEditor(null);await sessionChanged(null)});
 $('reloadBank').onclick=()=>run(()=>reload());
 $('filterSubject').onchange=()=>{fill($('filterLesson'),[...new Set(rows.filter(r=>$('filterSubject').value==='ALL'||r.subject===$('filterSubject').value).map(r=>r.lesson))],'Tất cả bài học','ALL');renderList()};
 $('filterLesson').onchange=renderList;$('filterSearch').oninput=renderList;$('onlyMine').onchange=renderList;$('filterAudio').onchange=renderList;
 batchAudio=window.QuestionBatchAudio?.create({
  rows:()=>rows,current:()=>editing,selected:()=>selected,gradeOf,audioInfo,api,hash,upload:uploadVoice,
  studioCheck:checkStudioTTS,refresh:()=>refreshAudioState(true),notify:()=>markSync('audio.put')
 });
 $('newQuestion').onclick=newQuestionScreen;
 $('openBatchAudio').onclick=()=>openScreen('batch');
 $('goBatchAudio').onclick=()=>openScreen('batch');
 $('openImport').onclick=()=>openScreen('import');
 document.querySelectorAll('.backToList').forEach(b=>b.onclick=()=>openScreen('list'));
 document.querySelectorAll('.scope-tab').forEach(b=>b.onclick=()=>{scope=b.dataset.scope||'all';renderList()});
 $('groupBy').onchange=renderList;$('filterGrade').onchange=renderList;
 $('checkVisible').onchange=e=>{for(const r of getFilteredRows()){if(e.target.checked)selected.add(r.id);else selected.delete(r.id)}renderList()};
 $('previewEdit').onclick=()=>{if(editing?.owned)openScreen('edit',editing)};
 $('previewAudio').onclick=()=>{if(editing)openScreen('audio',editing)};
 $('previewCopy').onclick=cloneCurrent;
 $('audioToPreview').onclick=()=>{if(editing)openScreen('preview',editing)};
 $('audioToEdit').onclick=()=>{if(editing?.owned)openScreen('edit',editing)};
 window.addEventListener('popstate',restoreRoute);
 window.addEventListener('hashchange',()=>{if(!$('appPanel').hidden)restoreRoute()});
 $('saveQuestion').onclick=saveQuestion;$('deleteQuestion').onclick=deleteQuestion;$('bulkDelete').onclick=bulkDelete;
 $('uploadQuestionImage').onclick=uploadQuestionImage;$('removeQuestionImage').onclick=deleteQuestionImage;
 $('duplicateQuestion').onclick=cloneCurrent;
 $('selectAll').onclick=()=>{getFilteredRows().forEach(r=>selected.add(r.id));renderList()};
 $('unselectAll').onclick=()=>{selected.clear();renderList()};
 $('exportJson').onclick=()=>exportQuestions(false);$('exportCsv').onclick=()=>exportQuestions(true);
 $('bulkPreview').onclick=()=>{try{const items=bulkItems();report('bulkStatus','✅ Hợp lệ '+items.length+' câu. Chọn Lưu tất cả để đưa vào ngân hàng.')}catch(e){report('bulkStatus','⚠ '+issue(e),true)}};
 $('bulkSave').onclick=bulkSave;
 $('bulkFile').onchange=async e=>{const file=e.target.files?.[0];if(!file)return;try{if(file.size>1024*1024)throw Error('Tệp tối đa 1 MB.');$('bulkText').value=await file.text();report('bulkStatus','Đã nạp tệp '+file.name+'. Nhấn Kiểm tra.')}catch(err){report('bulkStatus','⚠ '+issue(err),true)}};
 $('audioRefresh').onclick=()=>run(()=>refreshAudioState(true));
 $('audioGenerate').onclick=()=>run(async()=>{if(!editing?.id)throw Error('Hãy lưu câu hỏi trước khi tạo giọng.');await voiceFor([editing],Object.keys(PARTS))});
 $('audioBatch').onclick=()=>{
  if($('audioProvider').value==='studio'){openScreen('batch');return}
  void run(async()=>{const chosen=rows.filter(r=>selected.has(r.id)&&r.owned);if(!chosen.length)throw Error('Hãy chọn các câu hỏi của bạn ở danh sách.');await voiceFor(chosen,['full','answer'])});
 };
 $('voiceModel').onchange=()=>{voiceEngine.stop();showAudio().catch(e=>report('audioStatus',issue(e),true))};
 $('audioProvider').onchange=()=>{
  voiceEngine.stop();switchVoiceProvider($('audioProvider').value);
  void(async()=>{
   if($('audioProvider').value==='studio'&&!studioInfo.voiceVersion)await checkStudioTTS();
   await showAudio();
  })().catch(e=>report('audioStatus',issue(e),true));
 };
 $('studioCheck').onclick=()=>void checkStudioTTS();
 $('studioPreview').onclick=playStudioPreview;
 window.addEventListener('storage',event=>{if(event.key==='motionclass:shared-bank-sync')refreshAudioState(true)});
 window.addEventListener('focus',()=>{if(Date.now()-audioLastCheck>1800)refreshAudioState(true)});
 document.addEventListener('visibilitychange',()=>{if(!document.hidden&&Date.now()-audioLastCheck>1800)refreshAudioState(true)});
 const {data:{session}}=await supabase.auth.getSession();
 await sessionChanged(session?.user||null);
}
init().catch(e=>report('editStatus',issue(e),true));
})();