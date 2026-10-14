/* Batch portrait assignment from one class photograph.
 * Manual face selection (no face recognition), same interaction as Marble Race.
 * The original group photo never leaves the browser. Only 320x320 JPEG crops
 * are uploaded through ClassroomManagerBridge / private Supabase Storage.
 */
(function(){
'use strict';
const $=id=>document.getElementById(id);
const bridge=window.ClassroomManagerBridge;
if(!bridge)return;
const dialog=$('batchPhotoDialog'),canvas=$('batchPhotoCanvas'),ctx=canvas.getContext('2d');
let classId=null,image=null,selection=null,zoom=1,panX=0,panY=0,pointer=null,busy=false;
let marked=new Map(),students=[],lastInfo='',loadToken=0;
const clamp=(v,min,max)=>Math.max(min,Math.min(max,v));
function context(){return bridge.context()}
function getGeometry(){
 const width=canvas.clientWidth||660,height=canvas.clientHeight||380;
 const scale=image?Math.min(width/image.naturalWidth,height/image.naturalHeight)*zoom:1;
 return{width,height,scale,ox:width/2+panX-(image?.naturalWidth||0)*scale/2,oy:height/2+panY-(image?.naturalHeight||0)*scale/2};
}
function paint(){
 if(!dialog.open)return;
 const rect=getGeometry(),dpr=Math.min(devicePixelRatio||1,2);
 const w=Math.ceil(rect.width*dpr),h=Math.ceil(rect.height*dpr);
 if(canvas.width!==w||canvas.height!==h){canvas.width=w;canvas.height=h}
 ctx.setTransform(dpr,0,0,dpr,0,0);
 ctx.clearRect(0,0,rect.width,rect.height);
 ctx.fillStyle='#0d203d';ctx.fillRect(0,0,rect.width,rect.height);
 if(!image){ctx.fillStyle='#e7f2ff';ctx.font='bold 16px system-ui';ctx.textAlign='center';ctx.fillText('Chọn ảnh chung cả lớp để bắt đầu',rect.width/2,rect.height/2);return}
 ctx.drawImage(image,rect.ox,rect.oy,image.naturalWidth*rect.scale,image.naturalHeight*rect.scale);
 for(const [id,point] of marked){
  const st=students.find(s=>s.id===id);if(!st)continue;
  const x=rect.ox+point.x*rect.scale,y=rect.oy+point.y*rect.scale;
  ctx.save();ctx.shadowColor='#1d825d';ctx.shadowBlur=9;
  ctx.fillStyle='#079d78';ctx.strokeStyle='#fff';ctx.lineWidth=2;
  ctx.beginPath();ctx.arc(x,y,13,0,2*Math.PI);ctx.fill();ctx.stroke();
  ctx.shadowBlur=0;ctx.fillStyle='#fff';ctx.font='bold 15px system-ui';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText('✓',x,y);ctx.restore();
 }
 if(selection){
  const x=rect.ox+selection.x*rect.scale,y=rect.oy+selection.y*rect.scale,radius=Number($('batchCropSize').value);
  ctx.save();ctx.lineWidth=4;ctx.strokeStyle='#fff';ctx.shadowColor='#16dafa';ctx.shadowBlur=15;
  ctx.beginPath();ctx.arc(x,y,radius,0,Math.PI*2);ctx.stroke();
  ctx.shadowBlur=0;ctx.lineWidth=2;ctx.strokeStyle='#10bde8';ctx.setLineDash([6,6]);
  ctx.beginPath();ctx.arc(x,y,radius+6,0,Math.PI*2);ctx.stroke();ctx.restore();
 }
}
function cropCanvas(){
 if(!image||!selection)return null;
 const geom=getGeometry(),radius=Number($('batchCropSize').value)/geom.scale;
 const side=Math.min(image.naturalWidth,image.naturalHeight,radius*2);
 if(!Number.isFinite(side)||side<=0)return null;
 const left=clamp(selection.x-side/2,0,Math.max(0,image.naturalWidth-side));
 const top=clamp(selection.y-side/2,0,Math.max(0,image.naturalHeight-side));
 const crop=document.createElement('canvas');crop.width=crop.height=320;
 crop.getContext('2d').drawImage(image,left,top,side,side,0,0,320,320);
 return crop;
}
function updatePreview(){
 const root=$('batchPreview');root.replaceChildren();
 const crop=cropCanvas();
 if(crop){const photo=new Image();photo.src=crop.toDataURL('image/jpeg',.84);photo.alt='Ảnh chân dung đang chọn';root.append(photo)}
 else{const message=document.createElement('span');message.className='tiny';message.textContent='Chưa chọn khuôn mặt';root.append(message)}
 $('batchCandidateWrap').hidden=!selection;
 renderStudents();paint();
}
function setNotice(message,error=false){
 lastInfo=message;$('batchNext').textContent=message;
 $('batchNext').classList.toggle('batch-error',error);
 $('batchNext').classList.toggle('batch-done',!error&&marked.size>0);
}
function progress(){
 const count=students.filter(s=>Boolean(s.photoPath)).length;
 $('batchProgressText').textContent='Đã có ảnh: '+count+'/'+students.length+' em. Vừa gán từ ảnh này: '+marked.size+' em.';
 $('batchProgressFill').style.width=(students.length?Math.round(100*count/students.length):0)+'%';
 $('batchDone').textContent='✓ Xong ('+count+'/'+students.length+' đã có ảnh)';
}
function normalized(text){return String(text||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/đ/g,'d').toLowerCase().replace(/[^a-z0-9]/g,'')}
function renderStudents(){
 const root=$('batchStudentList');root.replaceChildren();
 if(!selection)return;
 const term=normalized($('batchNameSearch').value.trim()),onlyMissing=$('batchOnlyMissing').checked;
 const options=students.filter(s=>normalized(s.name).includes(term)&&(!onlyMissing||!s.photoPath));
 if(!options.length){const p=document.createElement('p');p.textContent=onlyMissing?'Không còn học sinh chưa có ảnh phù hợp. Bỏ bộ lọc để thay ảnh.':'Không tìm thấy học sinh.';p.className='tiny';p.style.padding='10px';root.append(p);return}
 for(const student of options){
  const button=document.createElement('button');button.type='button';button.disabled=busy;button.dataset.studentId=student.id;
  const img=new Image();img.alt='';img.src=bridge.getOrbAvatar(student);
  const title=document.createElement('span');title.textContent=student.name;
  const flag=document.createElement('small');flag.textContent=student.photoPath?'Đã có ảnh · thay':'Chưa có ảnh';
  button.append(img,title,flag);button.onclick=()=>assign(student.id);root.append(button);
 }
}
function setBusy(value){busy=value;$('batchDone').disabled=value;$('batchPhotoClose').disabled=value;
 $('batchPhotoFile').disabled=value;$('batchPhotoCamera').disabled=value;renderStudents()}
function blobFor(crop){
 return new Promise((resolve,reject)=>crop.toBlob(blob=>blob?resolve(blob):reject(Error('Không cắt được ảnh.')),'image/jpeg',.84));
}
async function assign(studentId){
 if(busy||!selection||!image||!classId)return;
 const st=students.find(s=>s.id===studentId),point={...selection};
 if(!st)return;
 if(st.photoPath&&!confirm('Thay ảnh đã có của '+st.name+' bằng khuôn mặt mới?'))return;
 let crop;
 try{crop=cropCanvas()}catch(error){setNotice('Không thể lấy vùng ảnh: '+error.message,true);return}
 if(!crop)return;
 setBusy(true);setNotice('⏳ Đang lưu ảnh cho '+st.name+' lên kho ảnh riêng tư...');
 try{
  const blob=await blobFor(crop);
  const result=await bridge.assignCroppedPhoto(classId,st.id,blob);
  if(!dialog.open||context().classId!==classId)throw Error('Lớp học đã thay đổi.');
  const refreshed=context();students=refreshed.students;
  if(!result.photoPath)throw Error('Lưu xong nhưng chưa nhận được ảnh đại diện.');
  marked.set(st.id,point);
  selection=null;$('batchNameSearch').value='';
  progress();updatePreview();
  const rest=students.filter(s=>!s.photoPath).length;
  setNotice(rest>0?'✅ Đã gán '+st.name+'. Tiếp tục chạm một khuôn mặt khác trên CÙNG ẢNH NÀY. Còn '+rest+' học sinh chưa có ảnh.':'🎉 Tất cả học sinh đã có ảnh. Có thể nhấn Xong hoặc thay ảnh em khác.');
 }catch(error){
  setNotice('⚠ Không lưu được ảnh cho '+st.name+': '+(error?.message||String(error))+'. Hãy thử lại.',true);
 }finally{setBusy(false);paint()}
}
function clearSelection(){selection=null;$('batchNameSearch').value='';updatePreview()}
function setZoom(value){
 zoom=clamp(Number(value)||1,1,5);$('batchZoom').value=String(zoom);
 $('batchZoomValue').textContent=Math.round(100*zoom)+'%';updatePreview();
}
function open(){
 const state=context();
 if(!state.classId||!state.students.length){alert('Hãy chọn lớp có học sinh trong Quản lý lớp học trước.');return}
 classId=state.classId;students=state.students;marked.clear();
 image=null;selection=null;panX=panY=0;zoom=1;loadToken++;
 $('batchPhotoFile').value='';$('batchPhotoCamera').value='';
 $('batchCropSize').value='48';$('batchNameSearch').value='';$('batchOnlyMissing').checked=true;
 dialog.showModal();setZoom(1);progress();
 $('batchCandidateWrap').hidden=true;
 setNotice('Chụp hoặc tải một ảnh chung, chạm khuôn mặt đầu tiên rồi gán tên.');
 requestAnimationFrame(paint);
}
function close(){
 if(busy)return;
 loadToken++;image=null;selection=null;pointer=null;marked.clear();
 $('batchPhotoFile').value='';$('batchPhotoCamera').value='';dialog.close();
}
async function takePhoto(file){
 if(busy||!file)return;
 if(!file.type.startsWith('image/')){setNotice('Vui lòng chọn ảnh JPG, PNG, HEIC được trình duyệt hỗ trợ.',true);return}
 if(file.size>30*1024*1024){setNotice('Ảnh lớn hơn 30 MB. Vui lòng chọn ảnh nhỏ hơn.',true);return}
 const marker=++loadToken,url=URL.createObjectURL(file);
 setNotice('⏳ Đang đọc ảnh lớp trên thiết bị...');
 try{
  const img=new Image();img.src=url;await img.decode();
  if(marker!==loadToken||!dialog.open)return;
  if(img.naturalWidth*img.naturalHeight>48000000)throw Error('Ảnh vượt 48 megapixel; hãy giảm độ phân giải.');
  image=img;marked.clear();selection=null;panX=panY=0;zoom=1;
  $('batchCropSize').value='48';$('batchNameSearch').value='';setZoom(1);
  setNotice('✅ Ảnh lớp đã tải. Chạm tâm khuôn mặt, chọn tên rồi tiếp tục các khuôn mặt khác mà không tải lại ảnh.');
 }catch(e){if(marker===loadToken)setNotice('Không mở được ảnh: '+(e.message||String(e)),true)}
 finally{URL.revokeObjectURL(url);$('batchPhotoFile').value='';$('batchPhotoCamera').value=''}
}
$('batchPhotoOpen').onclick=open;$('batchPhotoClose').onclick=close;$('batchDone').onclick=close;
dialog.addEventListener('cancel',event=>{event.preventDefault();close()});
$('batchPhotoFile').onchange=e=>takePhoto(e.target.files?.[0]);
$('batchPhotoCamera').onchange=e=>takePhoto(e.target.files?.[0]);
$('batchZoom').oninput=e=>setZoom(e.target.value);
$('batchZoomIn').onclick=()=>setZoom(zoom+.3);$('batchZoomOut').onclick=()=>setZoom(zoom-.3);
$('batchResetView').onclick=()=>{panX=panY=0;setZoom(1)};
$('batchCropSize').oninput=updatePreview;
$('batchClearSelection').onclick=clearSelection;
$('batchNameSearch').oninput=renderStudents;$('batchOnlyMissing').onchange=renderStudents;
canvas.onpointerdown=e=>{
 if(busy||!image)return;
 pointer={id:e.pointerId,x:e.clientX,y:e.clientY,oldX:panX,oldY:panY,moved:false};
 canvas.setPointerCapture(e.pointerId);
};
canvas.onpointermove=e=>{
 if(!pointer||pointer.id!==e.pointerId)return;
 const dx=e.clientX-pointer.x,dy=e.clientY-pointer.y;
 if(Math.hypot(dx,dy)>7)pointer.moved=true;
 if(pointer.moved){panX=pointer.oldX+dx;panY=pointer.oldY+dy;paint()}
};
canvas.onpointerup=e=>{
 if(!pointer||pointer.id!==e.pointerId)return;
 const p=pointer;pointer=null;
 if(p.moved||busy||!image)return;
 const rect=canvas.getBoundingClientRect(),g=getGeometry();
 const x=(e.clientX-rect.left-g.ox)/g.scale,y=(e.clientY-rect.top-g.oy)/g.scale;
 if(x<0||y<0||x>image.naturalWidth||y>image.naturalHeight){setNotice('Hãy chạm vào khuôn mặt nằm trong ảnh.',true);return}
 selection={x,y};updatePreview();setNotice('Đã chọn khuôn mặt. Chọn tên học sinh trong danh sách bên phải.');
};
canvas.onpointercancel=()=>{pointer=null};
canvas.addEventListener('wheel',e=>{if(!image)return;e.preventDefault();setZoom(zoom+(e.deltaY<0?.2:-.2))},{passive:false});
window.addEventListener('resize',()=>{if(dialog.open)requestAnimationFrame(paint)});
window.ClassroomBatchPhoto={open,close,getState:()=>({open:dialog.open,hasImage:!!image,selected:!!selection,marked:marked.size,students:students.length,sourceId:classId,notice:lastInfo}),selectForTest:(x,y)=>{if(!image)return;selection={x,y};updatePreview()}};
})();