/* MotionClass · Nút "🎙️ Tạo giọng ngay" — mở trang Giọng thống nhất trong cửa sổ nhỏ ngay tại trang đang làm
 * (Lớp học, Ngân hàng câu hỏi), chỉ cho phần vừa thêm. Trang con cùng nguồn nên dùng chung phiên đăng nhập.
 *   UnifiedVoiceLauncher.open('class:<id>' | 'questions' | 'all', {onDone})
 *   UnifiedVoiceLauncher.setBadge(button, missing)   // cập nhật chữ trên nút
 */
(function(){
'use strict';
let overlay=null,frame=null,pending=0,doneCb=null;
function close(force=false){
 if(!overlay)return;
 if(!force&&pending>0&&!confirm('Còn '+pending+' đoạn giọng đã tạo nhưng chưa lưu. Vẫn đóng?'))return;
 overlay.remove();overlay=frame=null;pending=0;
 const cb=doneCb;doneCb=null;try{cb?.()}catch(_){}
}
function open(scope='all',{onDone}={}){
 if(overlay)close(true);
 doneCb=onDone||null;
 overlay=document.createElement('div');
 overlay.setAttribute('role','dialog');overlay.setAttribute('aria-modal','true');overlay.setAttribute('aria-label','Tạo giọng thống nhất');
 overlay.style.cssText='position:fixed;inset:0;z-index:9999;background:rgba(10,22,48,.55);display:flex;align-items:center;justify-content:center;padding:16px';
 const card=document.createElement('div');
 card.style.cssText='background:#f4f7fc;border-radius:18px;width:min(980px,100%);height:min(760px,100%);display:flex;flex-direction:column;overflow:hidden;box-shadow:0 20px 60px #0006';
 const bar=document.createElement('div');
 bar.style.cssText='display:flex;align-items:center;justify-content:space-between;gap:10px;padding:10px 14px;background:linear-gradient(120deg,#101d46,#173f87);color:#fff;font:700 15px system-ui,sans-serif';
 bar.textContent='🎙️ Giọng đọc';
 const x=document.createElement('button');x.type='button';x.textContent='✕ Đóng';x.id='uvLauncherClose';
 x.style.cssText='border:0;border-radius:9px;padding:7px 12px;font-weight:700;background:#ffffff22;color:#fff;cursor:pointer';
 x.onclick=()=>close();bar.append(x);
 frame=document.createElement('iframe');frame.title='Tạo giọng thống nhất';frame.id='uvLauncherFrame';
 frame.src='/unified-voice/?embed=1&scope='+encodeURIComponent(scope);
 frame.style.cssText='border:0;width:100%;flex:1;background:#f4f7fc';
 card.append(bar,frame);overlay.append(card);
 overlay.addEventListener('click',e=>{if(e.target===overlay)close()});
 document.addEventListener('keydown',function esc(e){if(!overlay){document.removeEventListener('keydown',esc);return}if(e.key==='Escape')close()});
 document.body.append(overlay);
}
window.addEventListener('message',e=>{
 if(e.origin!==location.origin||!frame||e.source!==frame.contentWindow)return;
 const d=e.data||{};
 if(d.type==='motionclass:uv-state')pending=Number(d.pending)||0;
 if(d.type==='motionclass:uv-done'){pending=0;try{localStorage.setItem('motionclass:shared-bank-sync',JSON.stringify({at:Date.now(),change:'audio.put',source:'unified-voice'}))}catch(_){}}
});
function setBadge(button,missing,what='đoạn'){
 if(!button)return;
 if(missing==null){button.textContent='🎙️ Tạo giọng ngay';button.dataset.missing='';return}
 button.dataset.missing=String(missing);
 button.textContent=missing>0?'🎙️ Tạo giọng ngay · thiếu '+missing+' '+what:'✅ Đủ giọng thống nhất';
 button.style.background=missing>0?'#fff1d6':'#e3f7ee';button.style.color=missing>0?'#8a5200':'#127a52';
}
/** Đếm tên học sinh của một lớp chưa có giọng thống nhất (so cả mã băm tên). */
let voiceId=null;
async function currentVoice(){
 if(voiceId)return voiceId;
 try{const r=await fetch('/api/edge-tts',{cache:'no-store'});const j=await r.json();voiceId=j.voiceId||'edge:namminh-b1'}catch(_){voiceId='edge:namminh-b1'}
 return voiceId;
}
/** Giọng hệ thống của giáo viên (trang Giọng đọc); chưa nạp MotionVoice thì dùng giọng mặc định của máy chủ. */
async function systemVoice(client){
 if(client&&window.MotionVoice)try{return await window.MotionVoice.get(client)}catch(_){}
 return currentVoice();
}
async function missingNames(client,classId,students){
 const CS=window.TeacherClassroomStore;if(!CS||!client||!classId)return null;
 const [voice,voices]=await Promise.all([systemVoice(client),CS.listStudentNameVoices(client,classId)]);
 let n=0;
 for(const s of students.filter(s=>s.active!==false)){
  const hash=await CS.studentNameHash(s.name);
  if(!voices.some(v=>v.studentId===s.id&&v.voiceId===voice&&v.nameHash===hash))n++;
 }
 return n;
}
window.UnifiedVoiceLauncher={open,close,setBadge,missingNames,currentVoice,systemVoice,isOpen:()=>!!overlay};
})();
