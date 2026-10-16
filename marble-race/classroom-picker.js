/* Marble Race adapter to the shared classroom manager. Uses the teacher's MotionClass session. */
(function(){
'use strict';
const $=id=>document.getElementById(id),store=window.TeacherClassroomStore,game=window.MarbleClassroomHooks;
let client=null,classes=[],busy=false;
let savedNames=new Map(),voiceAudio=null,activeVoiceClass=null,loadEpoch=0;
const nameBlobs=new Map();
function clearNames(){
 if(voiceAudio){voiceAudio.pause();voiceAudio.src='';voiceAudio=null}
 savedNames.clear();nameBlobs.clear();activeVoiceClass=null;loadEpoch++;
 window.MarbleSharedBankUI?.registerNameVoices?.([]);
 $('raceNameSelect').replaceChildren(new Option('— Chọn học sinh —',''));
 $('raceNamePlay').disabled=true;
}
function chosenClip(studentId,requestedVoice,strict=false){
 const variants=savedNames.get(studentId)||[];
 if(!variants.length||requestedVoice==='device')return null;
 if(strict)return variants.find(x=>x.voiceId===requestedVoice)||null;
 return variants.find(x=>x.voiceId===requestedVoice)||
  variants.find(x=>x.voiceId.startsWith('studio:'))||variants[0];
}
function refreshVoiceStatus(){
 const src=$('raceSavedVoice')?.value||'device',ctx=[...savedNames.keys()];
 const matching=src==='device'?0:ctx.filter(id=>savedNames.get(id)?.some(x=>x.voiceId===src)).length;
 const usable=src==='device'?0:ctx.length;
 $('raceNamePlay').disabled=src==='device'||!usable;
 $('raceNameStatus').textContent=src==='device'
  ?'Đang chọn giọng thiết bị; WAV tên đã lưu sẽ không phát.'
  :'Tên học sinh: '+matching+' WAV đúng giọng đã chọn, '+(usable-matching)+' WAV bằng giọng đã lưu khác (được sử dụng khi thiếu đúng giọng).';
}
let nameSync=null;// để làm mới đường dẫn ký (hết hạn sau 1 giờ)
async function syncNameAudio(c,classId,students){
 clearNames();const epoch=loadEpoch;
 nameSync={c,classId,students,at:Date.now()};
 const items=await store.listStudentNameVoices(c,classId);
 const hashes=await Promise.all(students.map(async st=>[st.id,await store.studentNameHash(st.name)]));
 if(epoch!==loadEpoch||game.currentClassId()!==classId)return;
 activeVoiceClass=classId;
 const hashById=new Map(hashes);
 for(const item of items){
  if(item.url&&hashById.get(item.studentId)===item.nameHash){
   if(!savedNames.has(item.studentId))savedNames.set(item.studentId,[]);
   savedNames.get(item.studentId).push(item);
  }
 }
 const select=$('raceNameSelect');
 for(const student of students)if(savedNames.has(student.id))select.append(new Option(student.name,student.id));
 window.MarbleSharedBankUI?.registerNameVoices?.([...savedNames.values()].flat());
 refreshVoiceStatus();
}
async function getNameBlob(studentId,voice,opts={}){
 const row=chosenClip(studentId,voice,opts.strict===true);
 if(!row)return null;
 const cacheKey=row.storagePath+':'+row.updatedAt;
 if(nameBlobs.has(cacheKey))return nameBlobs.get(cacheKey);
 const task=fetch(row.url,{cache:'no-store'}).then(async res=>{
  if(!res.ok)throw Error('WAV tên học sinh chưa tải được');
  const blob=await res.blob();
  const head=String.fromCharCode(...new Uint8Array(await blob.slice(0,12).arrayBuffer()));
  if(blob.size<45||!head.startsWith('RIFF')||head.slice(8,12)!=='WAVE')throw Error('WAV tên không hợp lệ');
  return blob;
 }).catch(e=>{nameBlobs.delete(cacheKey);throw e});
 nameBlobs.set(cacheKey,task);return task;
}
async function playSavedName(studentId){
 const voice=game.preferredVoice?.()||'device';
 if(voice==='device')return false;
 let blob;
 try{blob=await getNameBlob(studentId,voice)}catch(e){status('⚠ '+(e.message||e),true);return false}
 if(!blob)return false;
 if(voiceAudio){voiceAudio.pause();voiceAudio.src=''}
 const url=URL.createObjectURL(blob),audio=new Audio(url);voiceAudio=audio;
 audio.volume=Math.max(.05,Math.min(1,Number($('winVol').value||80)/100));
 audio.onended=()=>{URL.revokeObjectURL(url);if(voiceAudio===audio)voiceAudio=null};
 audio.onerror=()=>{URL.revokeObjectURL(url);if(voiceAudio===audio)voiceAudio=null};
 audio.play().catch(()=>{URL.revokeObjectURL(url);if(voiceAudio===audio)voiceAudio=null});
 return true;
}
window.MarbleNameAudio={
 has:id=>savedNames.has(id),play:playSavedName,loadBlob:getNameBlob,
 refreshVoiceStatus,clear:clearNames,
 async refreshIfStale(){
  if(!nameSync||Date.now()-nameSync.at<45*60*1000)return;
  const {c,classId,students}=nameSync;
  if(classId===game.currentClassId())await syncNameAudio(c,classId,students);
 }
};

function status(text,error=false){const box=$('raceClassStatus');box.textContent=text;box.style.color=error?'#ffbdc4':'#a4d5f4'}
async function getClient(){
 if(client)return client;
 if(!store)throw Error('Bộ quản lý lớp học chưa được tải.');
 client=store.createClient();return client;
}
async function refreshClasses(keepSelection=true){
 const c=await getClient();
 const {data:{user}}=await c.auth.getUser();
 if(!user){status('Cần đăng nhập MotionClass trong Quản lý lớp học, sau đó quay lại và nhấn Làm mới.',true);return []}
 classes=await store.listClasses(c);
 const select=$('raceClassSelect'),selected=keepSelection?(select.value||game.currentClassId()):'';
 select.replaceChildren(new Option('— Chọn lớp đã lưu —',''));
 for(const item of classes)select.append(new Option(item.name+(item.school_year?' · '+item.school_year:''),item.id));
 if(classes.some(c=>c.id===selected))select.value=selected;
 status('Đã kết nối MotionClass. Có '+classes.length+' lớp; chọn lớp rồi nhấn “Nạp lớp và viên bi”.');
 return classes;
}
async function loadClass(id){
 if(!id){clearNames();status('Hãy chọn lớp đã lưu trong Quản lý lớp học.');return}
 if(game.isRunning())throw Error('Không thể thay lớp trong khi đang đua.');
 const c=await getClient();
 const data=await store.listStudents(c,id);
 if(!data.length)throw Error('Lớp học chưa có học sinh. Hãy thêm trong Quản lý lớp học.');
 await game.importRoster(id,data);
 let audioError='';
 try{await syncNameAudio(c,id,data)}catch(e){audioError='WAV tên chưa nạp được: '+(e.message||String(e))}
 const picked=classes.find(x=>x.id===id);
 status('✅ Đã nạp '+data.length+' học sinh lớp '+(picked?.name||'đã chọn')+'. '+
  (audioError||'Đã đối chiếu '+savedNames.size+' WAV tên học sinh còn hợp lệ.'),Boolean(audioError));
}
async function guard(task){
 if(busy)return;busy=true;
 const load=$('raceClassLoad'),refresh=$('raceClassRefresh');
 load.disabled=refresh.disabled=true;
 try{await task()}catch(e){status('⚠ '+(e.message||String(e)),true)}
 finally{load.disabled=refresh.disabled=false;busy=false}
}
$('raceNamePlay').onclick=()=>{
 const id=$('raceNameSelect').value;
 if(!id)return;
 void playSavedName(id).then(ok=>{if(!ok)status('Chưa có WAV tên tương ứng với giọng đã chọn; vào Quản lý lớp học để kiểm tra.',true)});
};
$('raceClassRefresh').onclick=()=>guard(()=>refreshClasses(true));
$('raceClassLoad').onclick=()=>guard(()=>loadClass($('raceClassSelect').value));
$('raceClassSelect').onchange=()=>status($('raceClassSelect').value?'Đã chọn lớp. Nhấn “Nạp lớp và viên bi” để cập nhật toàn bộ.':'Chọn danh sách tự nhập hoặc một lớp trên Supabase.');
// Restore last selected cloud roster on page reload, without erasing manual data if offline.
(async()=>{
 try{
  const listed=await refreshClasses(true);
  const previous=game.currentClassId();
  if(previous&&listed.some(c=>c.id===previous)){ $('raceClassSelect').value=previous;await loadClass(previous) }
 }catch(e){status('⚠ Chưa đồng bộ lớp tự động: '+(e.message||String(e))+'. Có thể tiếp tục dùng danh sách trên thiết bị.',true)}
})();
})();
