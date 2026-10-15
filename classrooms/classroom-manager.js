(function(){
'use strict';
const $=id=>document.getElementById(id),api=window.TeacherClassroomStore;
let client=null,user=null,classes=[],active=null,students=[],editing=null,editPhotoUrl='',newFile=null,busy=false,loadSerial=0;
const setStatus=(message,error=false)=>{const box=$('status');box.textContent=message;box.classList.toggle('error',error)};
function message(error){return error?.message||String(error)||'Lỗi không xác định.'}
async function action(callback){
 if(busy)return;
 busy=true;
 try{await callback()}catch(error){setStatus('⚠ '+message(error),true)}finally{busy=false}
}
function setAuth(logged){
 $('appPanel').hidden=!logged;$('loginPanel').hidden=logged;
 $('userEmail').textContent=logged?user.email:'';
}
async function authRefresh(){
 const {data:{user:current}}=await client.auth.getUser();
 user=current||null;setAuth(Boolean(user));
 if(user)await loadClasses();
}
async function login(event){
 event.preventDefault();
 await action(async()=>{
  const email=$('loginEmail').value.trim(),password=$('loginPass').value;
  const {data,error}=await client.auth.signInWithPassword({email,password});
  $('loginPass').value='';
  if(error)throw error;
  user=data.user;setAuth(true);await loadClasses();setStatus('✅ Đã đăng nhập tài khoản giáo viên.');
 });
}
async function logout(){
 await action(async()=>{
  const {error}=await client.auth.signOut();if(error)throw error;
  user=null;classes=[];active=null;students=[];setAuth(false);showClass();
  setStatus('Đã đăng xuất. Dữ liệu lớp học không còn hiển thị.');
 });
}
async function loadClasses(preferred=null){
 classes=await api.listClasses(client);
 const candidate=preferred||active?.id;
 active=classes.find(c=>c.id===candidate)||null;
 renderClasses();await selectClass(active?.id||null);
}
function renderClasses(){
 $('classList').replaceChildren();
 if(!classes.length){const p=document.createElement('p');p.className='tiny';p.textContent='Chưa có lớp học. Hãy tạo lớp đầu tiên.';$('classList').append(p);return}
 for(const c of classes){
  const row=document.createElement('button');row.type='button';
  row.className='class-item'+(c.id===active?.id?' active':'');row.style.width='100%';
  const name=document.createElement('strong');name.textContent=c.name;
  const info=document.createElement('span');info.textContent=c.school_year||c.grade||'';info.className='tiny';
  row.append(name,info);row.onclick=()=>action(()=>selectClass(c.id));
  $('classList').appendChild(row);
 }
}
async function createClass(event){
 event.preventDefault();
 await action(async()=>{
  const data=await api.createClass(client,{name:$('className').value,grade:$('classGrade').value,schoolYear:$('classYear').value});
  $('classForm').reset();await loadClasses(data.id);setStatus('✅ Đã tạo lớp '+data.name+'.');
 });
}
function showClass(){
 $('emptyState').hidden=Boolean(active);
 $('classWorkspace').hidden=!active;
 if(active)$('selectedClassTitle').textContent=active.name+' · '+(active.school_year||active.grade||'');
}
async function selectClass(id){
 const stamp=++loadSerial;
 active=classes.find(c=>c.id===id)||null;showClass();renderClasses();
 if(!active){students=[];renderStudents();return}
 const list=await api.listStudents(client,active.id);
 if(stamp!==loadSerial)return;
 students=list;renderStudents();setStatus('Đã nạp '+students.length+' học sinh của lớp '+active.name+'.');
}
function previewImage(s,canvas){
 const img=new Image();
 function paint(){const c=api.orbCanvas(s,img);const ctx=canvas.getContext('2d');ctx.clearRect(0,0,170,170);ctx.drawImage(c,0,0)}
 img.crossOrigin='anonymous';img.onload=paint;img.onerror=()=>paint();img.src=s.photoUrl||api.avatarSvg(s.avatar??0);
}
function renderStudents(){
 $('studentsCount').textContent=students.length+' em';
 $('studentsGrid').replaceChildren();
 if(!students.length){const p=document.createElement('p');p.className='tiny';p.textContent=active?'Lớp chưa có học sinh. Nhấn “Thêm học sinh” hoặc “Nhập danh sách”.':'Chưa chọn lớp.';$('studentsGrid').append(p);return}
 for(const student of students){
  const card=document.createElement('div');card.className='student-card';
  const canvas=document.createElement('canvas');canvas.className='orb';canvas.width=canvas.height=170;previewImage(student,canvas);
  const name=document.createElement('strong');name.textContent=student.name;
  const code=document.createElement('small');code.textContent=student.studentCode?'Mã: '+student.studentCode:'Màu '+(student.color+1)+' · Kiểu '+(student.style+1);
  const buttons=document.createElement('div');buttons.className='row';
  const edit=document.createElement('button');edit.textContent='✎ Sửa / ảnh';edit.onclick=()=>openEditor(student);
  const remove=document.createElement('button');remove.textContent='Xóa';remove.className='red';
  remove.onclick=()=>action(async()=>{
   if(!confirm('Xóa học sinh “'+student.name+'” khỏi lớp? Hành động không thể hoàn tác.'))return;
   await api.deleteStudent(client,active.id,student);await selectClass(active.id);
   setStatus('Đã xóa học sinh '+student.name+'.');
  });
  buttons.append(edit,remove);card.append(canvas,name,code,buttons);$('studentsGrid').appendChild(card);
 }
}
async function editClass(){
 if(!active)return;
 const name=prompt('Tên lớp:',active.name);if(name===null)return;
 const grade=prompt('Khối lớp:',active.grade||'');if(grade===null)return;
 const year=prompt('Năm học:',active.school_year||'');if(year===null)return;
 await action(async()=>{const id=active.id;await api.updateClass(client,id,{name,grade,schoolYear:year});await loadClasses(id);setStatus('Đã cập nhật thông tin lớp.')});
}
async function deleteClass(){
 if(!active)return;
 const c=active;
 if(!confirm('XÓA TOÀN BỘ lớp '+c.name+' và danh sách học sinh, ảnh chân dung đã lưu? Không thể hoàn tác.'))return;
 await action(async()=>{await api.deleteClass(client,c.id);active=null;await loadClasses();setStatus('Đã xóa lớp '+c.name+'.')});
}
function openEditor(student=null){
 if(!active)return;
 editing=student;newFile=null;editPhotoUrl=student?.photoUrl||'';
 $('studentDialogTitle').textContent=student?'Sửa học sinh & viên bi':'Thêm học sinh';
 $('studentName').value=student?.name||'';$('studentCode').value=student?.studentCode||'';
 $('orbColor').value=String(student?.color??(students.length%12));$('orbStyle').value=String(student?.style??(students.length%5));
 $('studentPhoto').value='';$('removePhoto').disabled=!student?.photoPath;
 refreshEditorOrb();$('studentDialog').showModal();
}
function refreshEditorOrb(){
 const preview={name:$('studentName').value||'?',avatar:editing?.avatar??students.length%24,color:Number($('orbColor').value),style:Number($('orbStyle').value)};
 const canvas=$('orbPreview');
 if(newFile){
  const url=URL.createObjectURL(newFile),img=new Image();
  img.onload=()=>{const c=api.orbCanvas(preview,img);canvas.getContext('2d').drawImage(c,0,0);URL.revokeObjectURL(url)};
  img.onerror=()=>{URL.revokeObjectURL(url);canvas.getContext('2d').drawImage(api.orbCanvas(preview),0,0)};
  img.src=url;return;
 }
 previewImage({...preview,photoUrl:editPhotoUrl},canvas);
}
async function saveStudent(event){
 event.preventDefault();
 await action(async()=>{
  if(!active)return;
  const fields={name:$('studentName').value,studentCode:$('studentCode').value,avatar:editing?.avatar??(students.length%24),color:Number($('orbColor').value),style:Number($('orbStyle').value),sortOrder:editing?.sortOrder??students.length,active:true};
  const row=await api.saveStudent(client,active.id,fields,editing?.id);
  if(newFile)await api.savePhoto(client,active.id,{...row,photoPath:editing?.photoPath||null},newFile);
  $('studentDialog').close();await selectClass(active.id);
  setStatus('✅ Đã lưu học sinh '+fields.name+' và hình viên bi.');
 });
}
async function removePhoto(){
 if(newFile){newFile=null;$('studentPhoto').value='';refreshEditorOrb();return}
 if(!editing?.photoPath)return;
 if(!confirm('Xóa ảnh chân dung đã lưu của học sinh?'))return;
 await action(async()=>{
  await api.removePhoto(client,active.id,editing);editPhotoUrl='';
  editing={...editing,photoPath:null,photoUrl:null};$('removePhoto').disabled=true;
  await selectClass(active.id);refreshEditorOrb();setStatus('Đã xóa ảnh của học sinh.');
 });
}
function downloadOrb(){
 const url=$('orbPreview').toDataURL('image/png'),anchor=document.createElement('a');
 anchor.href=url;anchor.download=('vien-bi-'+($('studentName').value||'hoc-sinh').trim().replace(/[^\p{L}\p{N}-]+/gu,'-')+'.png');
 document.body.appendChild(anchor);anchor.click();anchor.remove();
}
async function bulkAdd(){
 await action(async()=>{
  if(!active)return;
  const names=$('bulkNames').value.replace(/\r/g,'').split(/[\n;]+/).map(line=>line.replace(/^\s*\d+\s*[.)-]\s*/,'').trim()).filter(Boolean);
  const count=await api.addMany(client,active.id,names,students.length);
  $('bulkNames').value='';$('bulkPanel').hidden=true;await selectClass(active.id);
  setStatus('✅ Đã thêm '+count.length+' học sinh vào lớp '+active.name+'.');
 });
}
function init(){
 if(!api){setStatus('Không tải được bộ quản lý lớp học.',true);return}
 try{client=api.createClient()}catch(error){setStatus(message(error),true);return}
 $('loginForm').onsubmit=login;$('logoutButton').onclick=logout;$('classForm').onsubmit=createClass;
 $('editClass').onclick=editClass;$('deleteClass').onclick=deleteClass;$('newStudent').onclick=()=>openEditor();
 $('showBulk').onclick=()=>$('bulkPanel').hidden=!$('bulkPanel').hidden;
 $('bulkAdd').onclick=bulkAdd;$('studentForm').onsubmit=saveStudent;
 $('cancelStudent').onclick=()=>$('studentDialog').close();
 $('removePhoto').onclick=removePhoto;$('downloadOrb').onclick=downloadOrb;
 $('orbColor').onchange=refreshEditorOrb;$('orbStyle').onchange=refreshEditorOrb;$('studentName').oninput=refreshEditorOrb;
 $('studentPhoto').onchange=event=>{newFile=event.target.files?.[0]||null;refreshEditorOrb()};
 for(const [i,color] of api.COLORS.entries()){
  const option=new Option('Màu '+(i+1)+' · '+color,i);option.style.background=color;$('orbColor').append(option);
 }
 authRefresh().catch(error=>setStatus('⚠ '+message(error),true));
}
window.ClassroomManagerBridge={
 context:()=>({classId:active?.id||null,className:active?.name||'',students:students.map(st=>({...st}))}),
 async assignCroppedPhoto(classId,studentId,blob){
  if(!user||!active||active.id!==classId)throw Error('Lớp đã thay đổi, vui lòng mở lại ảnh lớp.');
  const student=students.find(st=>st.id===studentId);
  if(!student)throw Error('Học sinh không còn trong danh sách.');
  if(!(blob instanceof Blob)||blob.type!=='image/jpeg'||blob.size>2*1024*1024||blob.size<100)
   throw Error('Ảnh đại diện phải là JPEG hợp lệ dưới 2 MB.');
  await api.savePhoto(client,classId,student,blob);
  if(!active||active.id!==classId)throw Error('Lớp đã thay đổi trong khi lưu ảnh.');
  await selectClass(classId);
  const current=students.find(st=>st.id===studentId);
  setStatus('✅ Đã lưu ảnh chân dung cho '+student.name+'. Viên bi được cập nhật trong lớp học.');
  return {...current};
 },
 getOrbAvatar:(student)=>student.photoUrl||api.avatarSvg(student.avatar??0)
};
init();
})();
