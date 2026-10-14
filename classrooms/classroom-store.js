/* Shared school classroom roster. Uses Supabase Auth + owner-only RLS, never a service-role key. */
(function(){
'use strict';
const config=window.POSE_QUIZ_SUPABASE;
const COLORS=['#51dfff','#fb8aca','#ffcc63','#a88bff','#80e8a7','#ff8d73','#66a1ff','#fc7fe6','#73d7d0','#f99c4a','#9bdf7b','#f6d276'];
const BUCKET='teacher-student-photos';
const MAX_STUDENTS=150;
function client(){
 if(!window.supabase?.createClient||!config?.url||!config?.publishableKey)throw Error('Không tải được Supabase. Kiểm tra Internet và thử lại.');
 return window.supabase.createClient(config.url,config.publishableKey,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}});
}
function err(result){if(result.error)throw Error(result.error.message||'Không thể truy cập MotionClass.');return result.data}
function assertId(id){if(!/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(String(id)))throw Error('Mã lớp/học sinh không hợp lệ.');return id}
function cleanName(value,max=120){const v=String(value||'').trim().replace(/\s+/g,' ');if(!v||v.length>max)throw Error('Tên cần từ 1 đến '+max+' ký tự.');return v}
function bounded(n,lower,upper){n=Number(n);return Number.isInteger(n)?Math.max(lower,Math.min(upper,n)):lower}
function normalizeStudent(student){
 return{id:student.id,classId:student.class_id,name:student.full_name,studentCode:student.student_code,
 avatar:student.avatar_index,color:student.orb_color,style:student.orb_style,sortOrder:student.sort_order,
 active:student.is_active,photoPath:student.photo_path||null,photoUrl:student.photoUrl||null};
}
async function user(c){const {data,error}=await c.auth.getUser();if(error||!data.user)throw Error('Cần đăng nhập tài khoản MotionClass.');return data.user}
async function listClasses(c){await user(c);return err(await c.from('teacher_classrooms').select('id,name,grade,school_year,updated_at').order('name',{ascending:true}).limit(200))}
async function createClass(c,{name,grade='',schoolYear=''}){await user(c);return err(await c.from('teacher_classrooms').insert({name:cleanName(name,100),grade:String(grade).trim().slice(0,30),school_year:String(schoolYear).trim().slice(0,40)}).select().single())}
async function updateClass(c,id,{name,grade='',schoolYear=''}){await user(c);return err(await c.from('teacher_classrooms').update({name:cleanName(name,100),grade:String(grade).trim().slice(0,30),school_year:String(schoolYear).trim().slice(0,40),updated_at:new Date().toISOString()}).eq('id',assertId(id)).select().single())}
async function listStudents(c,classId){
 await user(c);
 const data=err(await c.from('teacher_classroom_students').select('id,class_id,full_name,student_code,avatar_index,orb_color,orb_style,photo_path,sort_order,is_active').eq('class_id',assertId(classId)).order('sort_order',{ascending:true}).order('created_at',{ascending:true}).limit(250));
 const students=data.map(normalizeStudent),paths=students.filter(s=>s.photoPath).map(s=>s.photoPath);
 if(paths.length){
  const {data:links,error}=await c.storage.from(BUCKET).createSignedUrls(paths,3600);
  if(error)throw Error('Không thể tải ảnh học sinh: '+error.message);
  const urls=new Map((links||[]).map((v,i)=>[paths[i],v.error?null:v.signedUrl]));
  for(const s of students)if(s.photoPath)s.photoUrl=urls.get(s.photoPath)||null;
 }
 return students;
}
async function saveStudent(c,classId,input,id=null){
 await user(c);
 const item={class_id:assertId(classId),full_name:cleanName(input.name),
 student_code:String(input.studentCode||'').trim().slice(0,50),
 avatar_index:bounded(input.avatar,0,23),orb_color:bounded(input.color,0,11),
 orb_style:bounded(input.style,0,4),sort_order:bounded(input.sortOrder,0,10000),is_active:input.active!==false,
 updated_at:new Date().toISOString()};
 if(id)return normalizeStudent(err(await c.from('teacher_classroom_students').update(item).eq('id',assertId(id)).eq('class_id',classId).select().single()));
 return normalizeStudent(err(await c.from('teacher_classroom_students').insert(item).select().single()));
}
async function addMany(c,classId,names,existingCount=0){
 await user(c);
 const values=[...new Set(names.map(v=>String(v).trim().replace(/\s+/g,' ')).filter(Boolean))].slice(0,MAX_STUDENTS);
 if(!values.length)throw Error('Chưa có học sinh nào.');
 if(values.length+existingCount>MAX_STUDENTS)throw Error('Một lớp tối đa '+MAX_STUDENTS+' học sinh.');
 for(const n of values)cleanName(n);
 const rows=values.map((name,i)=>({class_id:assertId(classId),full_name:name,sort_order:existingCount+i,avatar_index:i%24,orb_color:(existingCount+i)%12,orb_style:(existingCount+i)%5}));
 return err(await c.from('teacher_classroom_students').insert(rows).select('id'));
}
async function deleteStudent(c,classId,student){
 await user(c);
 err(await c.from('teacher_classroom_students').delete().eq('id',assertId(student.id)).eq('class_id',assertId(classId)));
 if(student.photoPath)await c.storage.from(BUCKET).remove([student.photoPath]);
}
async function deleteClass(c,classId){
 await user(c);
 const students=await listStudents(c,classId);
 err(await c.from('teacher_classrooms').delete().eq('id',assertId(classId)));
 const paths=students.map(s=>s.photoPath).filter(Boolean);
 for(let i=0;i<paths.length;i+=50)await c.storage.from(BUCKET).remove(paths.slice(i,i+50));
}
function imageToJpeg(file){
 if(!file?.type?.startsWith('image/'))throw Error('Chỉ chấp nhận ảnh học sinh.');
 if(file.size>12*1024*1024)throw Error('Ảnh quá 12 MB.');
 return new Promise((resolve,reject)=>{
  const objectUrl=URL.createObjectURL(file),im=new Image();
  im.onload=()=>{try{
   const canvas=document.createElement('canvas');canvas.width=canvas.height=320;
   const x=canvas.getContext('2d'),side=Math.min(im.naturalWidth,im.naturalHeight);
   x.drawImage(im,(im.naturalWidth-side)/2,(im.naturalHeight-side)/2,side,side,0,0,320,320);
   canvas.toBlob(blob=>{URL.revokeObjectURL(objectUrl);blob?resolve(blob):reject(Error('Không nén được ảnh học sinh.'))},'image/jpeg',.81);
  }catch(e){URL.revokeObjectURL(objectUrl);reject(e)}};
  im.onerror=()=>{URL.revokeObjectURL(objectUrl);reject(Error('Không đọc được tệp ảnh.'))};
  im.src=objectUrl;
 });
}
async function savePhoto(c,classId,student,file){
 const current=await user(c);
 const jpeg=await imageToJpeg(file);
 const photoPath=current.id+'/'+assertId(classId)+'/'+assertId(student.id)+'/'+crypto.randomUUID()+'.jpg';
 err(await c.storage.from(BUCKET).upload(photoPath,jpeg,{contentType:'image/jpeg',cacheControl:'3600',upsert:false}));
 try{
  const row=err(await c.from('teacher_classroom_students').update({photo_path:photoPath,updated_at:new Date().toISOString()}).eq('id',student.id).eq('class_id',classId).select().single());
  if(student.photoPath)await c.storage.from(BUCKET).remove([student.photoPath]);
  return row;
 }catch(e){await c.storage.from(BUCKET).remove([photoPath]);throw e}
}
async function removePhoto(c,classId,student){
 await user(c);
 err(await c.from('teacher_classroom_students').update({photo_path:null}).eq('id',student.id).eq('class_id',classId).select().single());
 if(student.photoPath)await c.storage.from(BUCKET).remove([student.photoPath]);
}
async function signPhoto(c,path){
 const {data,error}=await c.storage.from(BUCKET).createSignedUrl(path,3600);
 if(error)throw Error(error.message);
 return data.signedUrl;
}
function orbCanvas(student,img=null){
 const c=document.createElement('canvas');c.width=c.height=170;
 const x=c.getContext('2d'),mid=85,r=72,color=COLORS[bounded(student.color,0,11)],style=bounded(student.style,0,4);
 const aura=x.createRadialGradient(mid,mid,35,mid,mid,85);aura.addColorStop(0,'#fff0');aura.addColorStop(.72,color+'16');aura.addColorStop(.94,color+'77');aura.addColorStop(1,color+'00');x.fillStyle=aura;x.fillRect(0,0,170,170);
 x.save();x.beginPath();x.arc(mid,mid,r,0,Math.PI*2);x.clip();const bg=x.createRadialGradient(65,53,2,mid,mid,92);bg.addColorStop(0,'#e2ffff');bg.addColorStop(.38,color+'bd');bg.addColorStop(.74,'#103463');bg.addColorStop(1,'#050e2b');x.fillStyle=bg;x.fillRect(11,11,148,148);
 if(img?.complete&&img.naturalWidth){x.save();x.beginPath();x.arc(mid,mid,52,0,Math.PI*2);x.clip();x.drawImage(img,33,33,104,104);x.restore()}
 else{x.font='bold 42px system-ui';x.textAlign='center';x.textBaseline='middle';x.fillStyle='#fff';x.fillText(String(student.name||'?').trim().charAt(0).toUpperCase(),85,86)}
 const edge=x.createRadialGradient(72,60,32,mid,mid,73);edge.addColorStop(0,'#ffffff00');edge.addColorStop(.68,'#ffffff00');edge.addColorStop(.83,color+'28');edge.addColorStop(.94,'#d4faff9c');edge.addColorStop(1,'#f7ffffdb');x.fillStyle=edge;x.fillRect(10,10,150,150);x.restore();
 if(style===1){x.strokeStyle='#8cffffcc';x.lineWidth=3;x.beginPath();x.arc(mid,mid,66,-2.7,.2);x.stroke();x.strokeStyle='#f9a1ffcc';x.beginPath();x.arc(mid,mid,66,.4,2.7);x.stroke()}
 else if(style===2){x.strokeStyle='#ffd279';x.lineWidth=5;x.beginPath();x.ellipse(mid,mid,74,22,-.52,0,Math.PI*2);x.stroke()}
 else if(style===3){x.strokeStyle=color;x.lineWidth=6;x.beginPath();x.arc(mid,mid,68,.4,3);x.stroke()}
 else if(style===4){x.strokeStyle='#83f7ff';x.lineWidth=6;for(let i=0;i<3;i++){x.beginPath();x.arc(mid,mid,67,i*2.09,i*2.09+1.35);x.stroke()}}
 return c;
}
window.TeacherClassroomStore={createClient:client,user,listClasses,createClass,updateClass,deleteClass,listStudents,saveStudent,addMany,deleteStudent,savePhoto,removePhoto,signPhoto,orbCanvas,COLORS,BUCKET};
})();
