/* Marble Race adapter to the shared classroom manager. Uses the teacher's MotionClass session. */
(function(){
'use strict';
const $=id=>document.getElementById(id),store=window.TeacherClassroomStore,game=window.MarbleClassroomHooks;
let client=null,classes=[],busy=false;
let savedNames=new Map(),voiceAudio=null,activeVoiceClass=null;
function clearNames(){
 if(voiceAudio){voiceAudio.pause();voiceAudio.src='';voiceAudio=null}
 savedNames.clear();activeVoiceClass=null;
 $('raceNameSelect').replaceChildren(new Option('— Chọn học sinh —',''));
 $('raceNamePlay').disabled=true;
}
async function syncNameAudio(c,classId,students){
 clearNames();
 const items=await store.listStudentNameVoices(c,classId);
 if(activeVoiceClass && activeVoiceClass!==classId)return;
 activeVoiceClass=classId;
 const hashes=await Promise.all(students.map(async st=>[st.id,await store.studentNameHash(st.name)]));
 const hashById=new Map(hashes);
 for(const item of items){
  if(item.url && hashById.get(item.studentId)===item.nameHash){
   if(!savedNames.has(item.studentId))savedNames.set(item.studentId,[]);
   savedNames.get(item.studentId).push(item);
  }
 }
 for(const student of students){
  if(savedNames.has(student.id))$('raceNameSelect').append(new Option(student.name,student.id));
 }
 $('raceNamePlay').disabled=$('raceNameSelect').options.length<2;
}
function playSavedName(studentId){
 const preferred=game.preferredVoice?.()||'';
 const variants=savedNames.get(studentId)||[];
 const picked=variants.find(x=>x.voiceId===preferred);
 if(!picked?.url)return false;
 if(voiceAudio){voiceAudio.pause();voiceAudio.src=''}
 const audio=new Audio(picked.url);voiceAudio=audio;
 audio.volume=Math.max(.05,Math.min(1,Number($('winVol').value||80)/100));
 audio.play().catch(()=>{});
 return true;
}
window.MarbleNameAudio={has:(id)=>savedNames.has(id),play:playSavedName,clear:clearNames};

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
 select.replaceChildren(new Option('— Danh sách tự nhập trên thiết bị —',''));
 for(const item of classes)select.append(new Option(item.name+(item.school_year?' · '+item.school_year:''),item.id));
 if(classes.some(c=>c.id===selected))select.value=selected;
 status('Đã kết nối MotionClass. Có '+classes.length+' lớp; chọn lớp rồi nhấn “Nạp lớp và viên bi”.');
 return classes;
}
async function loadClass(id){
 if(!id){clearNames();status('Chế độ danh sách tự nhập. Muốn chuyển sang danh sách mới, hãy dùng nút Tạo viên bi.');return}
 if(game.isRunning())throw Error('Không thể thay lớp trong khi đang đua.');
 const c=await getClient();
 const data=await store.listStudents(c,id);
 if(!data.length)throw Error('Lớp học chưa có học sinh. Hãy thêm trong Quản lý lớp học.');
 await game.importRoster(id,data);
 try{await syncNameAudio(c,id,data)}catch(e){status('Đã nạp lớp; chưa tải được WAV tên đã lưu: '+(e.message||String(e)),true)}

 const picked=classes.find(x=>x.id===id);
 status('✅ Đã đồng bộ '+data.length+' học sinh từ lớp '+(picked?.name||'đã chọn')+', bao gồm ảnh và kiểu viên bi.');
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
 if(!playSavedName(id))status('Chưa có WAV phù hợp với nguồn giọng đã chọn. Chọn đúng giọng trong mục Nguồn giọng đọc.',true);
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
