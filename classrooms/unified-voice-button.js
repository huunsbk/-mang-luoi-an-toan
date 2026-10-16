/* Lớp học · nút "🎙️ Tạo giọng ngay": đếm tên học sinh của lớp đang chọn còn thiếu giọng thống nhất,
 * bấm là mở cửa sổ tạo giọng chỉ cho lớp này; đóng cửa sổ thì đếm lại. */
(function(){
'use strict';
const btn=document.getElementById('uvClassVoice'),L=window.UnifiedVoiceLauncher,B=()=>window.ClassroomManagerBridge;
if(!btn||!L)return;
let serial=0;
async function update(){
 const t=++serial,ctx=B()?.context();
 if(!ctx?.classId){btn.hidden=true;return}
 btn.hidden=false;L.setBadge(btn,null);
 try{const n=await L.missingNames(B().getClient(),ctx.classId,ctx.students);if(t===serial)L.setBadge(btn,n,'tên')}catch(_){if(t===serial)L.setBadge(btn,null)}
}
btn.onclick=()=>{const ctx=B()?.context();if(ctx?.classId)L.open('class:'+ctx.classId,{onDone:update})};
window.addEventListener('motionclass:class-loaded',update);
})();
