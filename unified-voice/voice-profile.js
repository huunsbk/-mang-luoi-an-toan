/* MotionClass · Giọng hệ thống (một giọng Microsoft cho tên, câu dẫn, câu hỏi).
 * Lưu trên Supabase (teacher_voice_settings) để mọi máy — máy soạn bài và máy chiếu lớp — dùng cùng một giọng.
 *   MotionVoice.get(client)  → 'edge:namminh-b1' | hồ sơ giáo viên đã chọn
 *   MotionVoice.set(client, id)
 *   MotionVoice.label(id), MotionVoice.chip(id)
 */
(function(){
'use strict';
const DEFAULT='edge:namminh-b1';
// Bản sao nhãn của api/edge-tts.py (máy chủ trả danh sách chính thức qua GET /api/edge-tts).
let PROFILES=[
 {id:'edge:namminh-b1',reader:'NamMinh',label:'Nam · trẻ, tự tin'},
 {id:'edge:namminh-t1',reader:'NamMinh',label:'Nam · trầm ấm, chậm rãi'},
 {id:'edge:namminh-s1',reader:'NamMinh',label:'Nam · sôi nổi, hào hứng'},
 {id:'edge:hoaimy-d1',reader:'HoaiMy',label:'Nữ · dịu dàng, ấm áp'},
 {id:'edge:hoaimy-v1',reader:'HoaiMy',label:'Nữ · vui tươi, rõ ràng'}
];
const ID=/^edge:[a-z0-9-]{2,45}$/;
let cache=null;
async function loadProfiles(){
 try{const r=await fetch('/api/edge-tts',{cache:'no-store'});const j=await r.json();if(Array.isArray(j.profiles)&&j.profiles.length)PROFILES=j.profiles.map(p=>({id:p.id,reader:p.reader,label:p.label}))}catch(_){}
 return PROFILES;
}
function label(id){
 const p=PROFILES.find(x=>x.id===id);
 if(p)return(p.reader==='HoaiMy'?'HoaiMy · ':'NamMinh · ')+p.label;
 if(String(id).startsWith('studio:'))return'Google AI Studio (giọng cũ)';
 if(String(id).startsWith('nghi:'))return'NGHI-TTS (giọng cũ)';
 if(String(id).startsWith('edge:'))return'Microsoft · '+String(id).slice(5);
 return'Giọng thiết bị';
}
function chip(id){
 const s=String(id||'');
 if(s.startsWith('edge:'))return{icon:'🎙️',cls:'edge',text:label(s)};
 if(s.startsWith('studio:'))return{icon:'✨',cls:'old',text:'Google (cũ)'};
 if(s.startsWith('nghi:'))return{icon:'📱',cls:'old',text:'NGHI (cũ)'};
 return{icon:'🔈',cls:'device',text:'Giọng thiết bị'};
}
async function get(client){
 if(cache&&Date.now()-cache.at<60000)return cache.id;
 let id=DEFAULT;
 try{
  const {data:{session}}=await client.auth.getSession();
  if(session?.user){
   const {data,error}=await client.from('teacher_voice_settings').select('voice_id').eq('owner_id',session.user.id).maybeSingle();
   if(!error&&data?.voice_id&&ID.test(data.voice_id))id=data.voice_id;
  }
 }catch(_){}
 cache={id,at:Date.now()};return id;
}
async function set(client,id){
 if(!ID.test(String(id)))throw Error('Giọng đọc không hợp lệ.');
 const {data:{session}}=await client.auth.getSession();if(!session?.user)throw Error('Cần đăng nhập.');
 const {error}=await client.from('teacher_voice_settings').upsert({owner_id:session.user.id,voice_id:id,updated_at:new Date().toISOString()},{onConflict:'owner_id'});
 if(error)throw Error(error.message||'Không lưu được giọng hệ thống.');
 cache={id,at:Date.now()};
 try{localStorage.setItem('motionclass:system-voice',JSON.stringify({id,at:Date.now()}))}catch(_){}
 return id;
}
window.MotionVoice={DEFAULT,get,set,label,chip,loadProfiles,profiles:()=>PROFILES.slice(),clear:()=>{cache=null}};
window.addEventListener('storage',e=>{if(e.key==='motionclass:system-voice')cache=null});
})();
