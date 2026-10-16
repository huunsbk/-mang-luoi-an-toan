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
 await removeStudentNameVoices(c,student.id);
 err(await c.from('teacher_classroom_students').delete().eq('id',assertId(student.id)).eq('class_id',assertId(classId)));
 if(student.photoPath)await c.storage.from(BUCKET).remove([student.photoPath]);
}
async function deleteClass(c,classId){
 await user(c);
 const students=await listStudents(c,classId);
 // Remove audio files first; FK cascade handles the associated audio metadata.
 const audio=err(await c.from('teacher_student_name_audio').select('storage_path').eq('class_id',assertId(classId)).limit(500));
 for(let i=0;i<audio.length;i+=50){
  const result=await c.storage.from(VOICE_BUCKET).remove(audio.slice(i,i+50).map(r=>r.storage_path));
  if(result.error)throw Error('Không xóa được WAV tên học sinh: '+result.error.message);
 }
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
function avatarSvg(seed){const skins=['#f5c7a7','#e9b18f','#d9a483','#ecc4a7','#c99872','#f5d2b7'];const hairs=['#35253d','#1e2a40','#533a30','#282331','#4c3524'];const clothes=['#60b4fa','#d477ae','#6ac6a8','#9f8dec','#efa461','#64b3b5'];const s=seed%24,h=seed%5;const hair=hairs[(s*7+3)%5],skin=skins[s%6],cloth=clothes[(s*3+1)%6],back=COLORS[(s*5+2)%COLORS.length];const long=s%3===0;const fringe=s%4===0;
const svg=`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128"><defs><radialGradient id="bg"><stop stop-color="#fbffff"/><stop offset="1" stop-color="${back}"/></radialGradient><linearGradient id="shirt" x2="1" y2="1"><stop stop-color="#ffffff"/><stop offset="1" stop-color="${cloth}"/></linearGradient></defs><rect width="128" height="128" fill="url(#bg)"/><circle cx="102" cy="24" r="28" fill="#fff" opacity=".2"/><path d="M0 128 C10 88 41 89 64 89 C89 89 119 94 128 128" fill="url(#shirt)"/><path d="M42 94 L63 118 84 94" fill="#fcfcff"/><path d="M58 103 L64 109 70 103 67 125 62 125Z" fill="#2d6eaf"/>${long?`<path d="M33 58 Q25 12 63 15 Q103 9 100 59 L109 104 83 98 41 98 25 104Z" fill="${hair}"/>`:`<path d="M31 61 Q23 15 66 17 Q105 16 98 66 L85 50 40 55Z" fill="${hair}"/>`}<ellipse cx="64" cy="63" rx="28" ry="35" fill="${skin}"/><path d="M35 53 Q38 13 68 21 Q100 19 96 56 Q78 ${fringe?64:44} 66 39 Q48 59 35 53" fill="${hair}"/><ellipse cx="52" cy="65" rx="3.6" ry="4.6" fill="#222b43"/><ellipse cx="76" cy="65" rx="3.6" ry="4.6" fill="#222b43"/><circle cx="53" cy="63" r="1.2" fill="white"/><circle cx="77" cy="63" r="1.2" fill="white"/><path d="M56 80 Q64 88 72 80" stroke="#ad5969" stroke-width="2.8" fill="none" stroke-linecap="round"/><circle cx="43" cy="76" r="6" fill="#f48f99" opacity=".26"/><circle cx="86" cy="76" r="6" fill="#f48f99" opacity=".26"/></svg>`;
return 'data:image/svg+xml;charset=utf-8,'+encodeURIComponent(svg)}

function makeOrb(s){if(s.orb)return s.orb;const c=document.createElement('canvas');c.width=c.height=170;const x=c.getContext('2d');const mid=85,r=72,color=COLORS[s.color%COLORS.length],style=s.style%5;
const aura=x.createRadialGradient(mid,mid,35,mid,mid,85);aura.addColorStop(0,'#fff0');aura.addColorStop(.72,color+'16');aura.addColorStop(.94,color+'77');aura.addColorStop(1,color+'00');x.fillStyle=aura;x.fillRect(0,0,170,170);
x.save();x.beginPath();x.arc(mid,mid,r,0,Math.PI*2);x.clip();const bg=x.createRadialGradient(65,53,2,mid,mid,92);bg.addColorStop(0,'#e2ffff');bg.addColorStop(.38,color+'bd');bg.addColorStop(.74,'#103463');bg.addColorStop(1,'#050e2b');x.fillStyle=bg;x.fillRect(11,11,148,148);
if(s.image){x.save();x.globalAlpha=.98;x.beginPath();x.arc(mid,mid,52,0,Math.PI*2);x.clip();x.drawImage(s.image,33,33,104,104);x.restore()}
const edge=x.createRadialGradient(72,60,32,mid,mid,73);edge.addColorStop(0,'#ffffff00');edge.addColorStop(.68,'#ffffff00');edge.addColorStop(.83,color+'28');edge.addColorStop(.94,'#d4faff9c');edge.addColorStop(1,'#f7ffffdb');x.fillStyle=edge;x.fillRect(10,10,150,150);x.restore();
if(style===1){x.strokeStyle='#8cffffcc';x.lineWidth=3;x.beginPath();x.arc(mid,mid,66,-2.7,.2);x.stroke();x.strokeStyle='#f9a1ffcc';x.beginPath();x.arc(mid,mid,66,.4,2.7);x.stroke()}
else if(style===2){x.strokeStyle='#ffd279';x.lineWidth=5;x.beginPath();x.ellipse(mid,mid,74,22,-.52,0,Math.PI*2);x.stroke();x.strokeStyle='#fffae0';x.lineWidth=1.4;x.stroke()}
else if(style===3){x.strokeStyle=color;x.lineWidth=6;x.beginPath();x.arc(mid,mid,68,.4,3);x.stroke();for(let i=0;i<5;i++){let a=i*1.2;x.fillStyle='#fff2e2';x.beginPath();x.arc(mid+Math.cos(a)*65,mid+Math.sin(a)*65,2.4,0,7);x.fill()}}
else if(style===4){x.strokeStyle='#83f7ff';x.shadowBlur=10;x.shadowColor=color;x.lineWidth=6;for(let i=0;i<3;i++){x.beginPath();x.arc(mid,mid,67,i*2.09,i*2.09+1.35);x.stroke()}x.shadowBlur=0}
else{x.strokeStyle='#ffffffbb';x.lineWidth=2;x.beginPath();x.arc(mid,mid,66,0,7);x.stroke()}
x.save();x.beginPath();x.arc(mid,mid,68,0,7);x.clip();let gloss=x.createLinearGradient(32,20,137,144);gloss.addColorStop(0,'#fff9');gloss.addColorStop(.16,'#fffa');gloss.addColorStop(.32,'#fff1');gloss.addColorStop(.7,'#fff0');gloss.addColorStop(1,'#b5f9ff6e');x.fillStyle=gloss;x.beginPath();x.ellipse(66,40,48,24,-.45,0,7);x.fill();x.strokeStyle='#fff8';x.lineWidth=3;x.beginPath();x.arc(mid,mid,61,3.4,5.65);x.stroke();x.restore();s.orb=c;return c}

function orbCanvas(student,img=null){return makeOrb({...student,image:img,orb:null,color:bounded(student.color,0,11),style:bounded(student.style,0,4)})}

const VOICE_BUCKET='teacher-student-voices';
const hex=bytes=>Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');
async function hashText(value){
 if(!globalThis.crypto?.subtle)throw Error('Trình duyệt cần HTTPS để tạo mã SHA-256.');
 return hex(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(String(value)))));
}
async function studentNameHash(value){return hashText(cleanName(value))}
function validateVoiceId(voice){
 if(!/^(studio:[a-f0-9]{16}|nghi:[a-z0-9]{2,45}|edge:[a-z0-9-]{2,45})$/.test(String(voice)))throw Error('Mã giọng đọc không hợp lệ.');
 return voice;
}
async function listStudentNameVoices(c,classId){
 await user(c);
 const rows=err(await c.from('teacher_student_name_audio')
  .select('student_id,class_id,voice_id,name_hash,storage_path,size_bytes,updated_at')
  .eq('class_id',assertId(classId)).limit(500));
 if(!rows.length)return [];
 const paths=rows.map(x=>x.storage_path);
 const {data:urls,error}=await c.storage.from(VOICE_BUCKET).createSignedUrls(paths,3600);
 if(error)throw Error('Không lấy được đường dẫn giọng đọc: '+error.message);
 return rows.map((row,i)=>({
  studentId:row.student_id,classId:row.class_id,voiceId:row.voice_id,nameHash:row.name_hash,
  storagePath:row.storage_path,sizeBytes:row.size_bytes,updatedAt:row.updated_at,
  url:urls?.[i]?.error?null:urls?.[i]?.signedUrl||null
 }));
}
async function saveStudentNameVoice(c,{classId,studentId,voiceId,nameHash,blob}){
 const u=await user(c),id=assertId(studentId),cls=assertId(classId);
 validateVoiceId(voiceId);
 if(!/^[a-f0-9]{64}$/.test(nameHash))throw Error('Mã xác minh tên học sinh không hợp lệ.');
 if(!(blob instanceof Blob)||blob.size<45||blob.size>3*1024*1024||blob.type!=='audio/wav')
  throw Error('WAV học sinh phải từ 45 byte đến 3 MB.');
 const head=new Uint8Array(await blob.slice(0,12).arrayBuffer());
 if(String.fromCharCode(...head.slice(0,4))!=='RIFF'||String.fromCharCode(...head.slice(8,12))!=='WAVE')
  throw Error('Tệp không phải WAV RIFF hợp lệ.');
 const student=err(await c.from('teacher_classroom_students').select('id,full_name')
  .eq('id',id).eq('class_id',cls).eq('owner_id',u.id).single());
 if(await studentNameHash(student.full_name)!==nameHash)throw Error('Tên học sinh đã thay đổi. Không lưu giọng đọc cũ.');
 const oldRows=err(await c.from('teacher_student_name_audio').select('storage_path')
  .eq('student_id',id).eq('voice_id',voiceId).limit(1));
 const path=u.id+'/'+cls+'/'+id+'/'+voiceId.replace(':','-')+'-'+crypto.randomUUID()+'.wav';
 err(await c.storage.from(VOICE_BUCKET).upload(path,blob,{contentType:'audio/wav',upsert:false,cacheControl:'3600'}));
 try{
  err(await c.from('teacher_student_name_audio').upsert({
   owner_id:u.id,class_id:cls,student_id:id,voice_id:voiceId,name_hash:nameHash,
   storage_path:path,size_bytes:blob.size,mime_type:'audio/wav',updated_at:new Date().toISOString()
  },{onConflict:'student_id,voice_id'}).select('id').single());
 }catch(e){
  await c.storage.from(VOICE_BUCKET).remove([path]).catch(()=>{});
  throw e;
 }
 const stale=oldRows.map(r=>r.storage_path).filter(x=>x&&x!==path);
 if(stale.length)await c.storage.from(VOICE_BUCKET).remove(stale);
 return path;
}
async function removeStudentNameVoices(c,studentId){
 await user(c);const id=assertId(studentId);
 const rows=err(await c.from('teacher_student_name_audio').select('storage_path').eq('student_id',id));
 err(await c.from('teacher_student_name_audio').delete().eq('student_id',id));
 for(let i=0;i<rows.length;i+=50)await c.storage.from(VOICE_BUCKET).remove(rows.slice(i,i+50).map(r=>r.storage_path));
}

window.TeacherClassroomStore={createClient:client,user,listClasses,createClass,updateClass,deleteClass,listStudents,saveStudent,addMany,deleteStudent,savePhoto,removePhoto,signPhoto,hashText,studentNameHash,listStudentNameVoices,saveStudentNameVoice,removeStudentNameVoices,orbCanvas,avatarSvg,COLORS,BUCKET,VOICE_BUCKET};
})();
