/* Read-only MotionClass connectors: shared question bank, class, scripts, WAV. */
(function(global){
'use strict';
const config=()=>global.POSE_QUIZ_SUPABASE;
let client;
function getClient(){if(client)return client;if(!global.supabase)throw Error('Không tải được Supabase SDK.');
 const cfg=config();if(!cfg?.url||!cfg?.publishableKey)throw Error('Thiếu cấu hình MotionClass.');
 client=global.supabase.createClient(cfg.url,cfg.publishableKey,{auth:{persistSession:true,autoRefreshToken:true}});
 return client;
}
async function user(){const c=getClient(),{data:{session}}=await c.auth.getSession();return session?.user||null;}
async function signIn(email,password){const c=getClient();const {error}=await c.auth.signInWithPassword({email,password});if(error)throw Error(error.message);return user();}
async function signOut(){const {error}=await getClient().auth.signOut();if(error)throw Error(error.message);}
async function shared(action,payload={}){
 const c=getClient(),{data:{session}}=await c.auth.getSession();
 if(!session?.access_token)throw Error('Cần đăng nhập MotionClass.');
 const cfg=config(),response=await fetch(cfg.url+'/functions/v1/shared-question-api',{
  method:'POST',
  headers:{'Content-Type':'application/json',Authorization:'Bearer '+session.access_token,apikey:cfg.publishableKey},
  body:JSON.stringify({action,...payload})
 });
 const data=await response.json().catch(()=>({}));
 if(!response.ok||data.ok===false)throw Error(data.error||'Ngân hàng câu hỏi không phản hồi.');
 return data;
}
async function loadBank(){
 const result=await shared('bank.list',{subject:'ALL',lesson:'ALL',search:''});
 return (result.items||[]).map(row=>global.IslandEngine.normalizeQuestion({...row,source:'bank'})).filter(Boolean);
}
async function loadClasses(){
 const c=getClient();return global.TeacherClassroomStore.listClasses(c);
}
async function loadStudents(classId){
 if(!classId)return [];
 return (await global.TeacherClassroomStore.listStudents(getClient(),classId)).filter(s=>s.active!==false);
}
async function loadScripts(){
 const store=global.TeacherScriptStore,c=getClient();
 return [store.BUILTIN,...(await store.listScripts(c)).filter(s=>s.isActive!==false)];
}
async function sha256(text){
 const d=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(String(text)));
 return Array.from(new Uint8Array(d)).map(b=>b.toString(16).padStart(2,'0')).join('');
}
function sound(){
 const a=global.AudioContext||global.webkitAudioContext;let ctx=null;let volumes={music:.28,fx:.7,feedback:.85,voice:.9};
 let musicAudio=null,effect=null;
 const clamp=x=>Math.max(0,Math.min(1,Number(x)||0));
 function setVolume(k,v){volumes[k]=clamp(v);if(k==='music'&&musicAudio)musicAudio.volume=volumes.music;if(k==='voice'&&effect)effect.volume=volumes.voice;}
 function tone(ok){
  if(volumes.feedback===0||!a)return;
  try{ctx=ctx||new a();if(ctx.state==='suspended')ctx.resume().catch(()=>{});
   const frequencies=ok?[523,659,784]:[370,300];const t=ctx.currentTime;
   frequencies.forEach((freq,i)=>{const o=ctx.createOscillator(),g=ctx.createGain();o.type='sine';o.frequency.value=freq;g.gain.setValueAtTime(.00001,t+i*.13);g.gain.exponentialRampToValueAtTime(.11*volumes.feedback,t+i*.13+.02);g.gain.exponentialRampToValueAtTime(.00001,t+i*.13+.2);o.connect(g);g.connect(ctx.destination);o.start(t+i*.13);o.stop(t+i*.13+.21)});
  }catch(err){console.warn('Sound',err)}
 }
 function setMusic(url){
  if(musicAudio){musicAudio.pause();musicAudio.src='';musicAudio=null}
  if(!url)return;
  musicAudio=new Audio(url);musicAudio.loop=true;musicAudio.volume=volumes.music;
 }
 function playMusic(){musicAudio?.play().catch(()=>{})}
 function pauseMusic(){musicAudio?.pause()}
 function stop(){pauseMusic();if(ctx)ctx.suspend().catch(()=>{})}
 return{volumes,setVolume,tone,setMusic,playMusic,pauseMusic,stop};
}
function createVoice({sound:audio,settings,onStatus=()=>{}}={}){
 const store=global.TeacherScriptStore,voice=global.MotionVoice,c=getClient();
 let library=null,script=store.BUILTIN,voiceId='device',nameVoices=new Map(),phraseMap=new Map(),audioMap=new Map(),hashMap=new Map();
 let current=null,speech=null,generation=0,paused=false;
 const norm=text=>String(text||'').normalize('NFC').replace(/\s+/g,' ').trim();
 function stop(){
  generation++;
  try{current?.pause()}catch(_){}
  current=null;try{speechSynthesis.cancel()}catch(_){}
  speech=null;paused=false;onStatus('');
 }
 function pause(){paused=true;try{current?.pause()}catch(_){}try{speechSynthesis.pause()}catch(_){}}
 function resume(){paused=false;try{current?.play()}catch(_){}try{speechSynthesis.resume()}catch(_){}}
 async function load({scriptId='builtin',classId=null,questions=[]}={}){
  stop();
  voiceId=await voice.get(c);
  const [scripts,phrases,students,voices]=await Promise.all([
   store.listScripts(c),voiceId==='device'?Promise.resolve([]):store.listPhraseAudio(c,{voiceId,sign:true}),
   classId?global.TeacherClassroomStore.listStudents(c,classId):Promise.resolve([]),
   classId&&voiceId!=='device'?global.TeacherClassroomStore.listStudentNameVoices(c,classId):Promise.resolve([])
  ]);
  library={scripts,phrases};
  script=scriptId==='builtin'?store.BUILTIN:scripts.find(s=>s.id===scriptId)||store.BUILTIN;
  phraseMap=new Map(phrases.filter(r=>r.url).map(r=>[norm(r.phrase),r.url]));
  nameVoices=new Map();
  for(const st of students){const r=voices.find(v=>v.studentId===st.id&&v.voiceId===voiceId);
   if(r&&r.nameHash===await global.TeacherClassroomStore.studentNameHash(st.name))nameVoices.set(st.id,r.url);
  }
  audioMap=new Map();hashMap=new Map();
  const ids=[...new Set(questions.map(q=>q.id).filter(id=>/^[0-9a-f]{8}-[0-9a-f-]{27,}$/.test(String(id))))];
  if(ids.length&&voiceId!=='device'){
   for(let i=0;i<ids.length;i+=80){
    const result=await shared('audio.list',{ids:ids.slice(i,i+80),voice_id:voiceId});
    for(const row of result.items||[]){audioMap.set(row.id+':'+row.part,row.url);hashMap.set(row.id+':'+row.part,row.textHash)}
   }
  }
  return{voiceId,script:script.title,names:nameVoices.size,wavs:audioMap.size};
 }
 function template(slot,params={}){
  let raw=script?.slots?.[slot]?.[0]||store.BUILTIN.slots?.[slot]?.[0]||'';
  raw=raw.replace(/\{tên\}/g,params.name||'')
   .replace(/\{số\}/g,String(params.index||1))
   .replace(/\{đáp án\}/g,params.answer||'')
   .replace(/\{giải thích\}/g,params.explanation||'')
   .replace(/\{đúng\}/g,String(params.correct||0))
   .replace(/\{tổng\}/g,String(params.total||0));
  return norm(raw.replace(/\s+([,.!?])/g,'$1').replace(/\s+/g,' '));
 }
 function questionSpeech(q){
  const readable=q.spoken?.full;
  return readable||q.text+'. '+q.options.map((s,i)=>'Phương án '+['A','B','C','D'][i]+'. '+s+'.').join(' ')+' Em hãy chọn một đáp án.';
 }
 async function play(text,url=null,token=generation){
  if(token!==generation)return false;
  text=norm(text);if(!text)return true;
  onStatus(text);
  if(audio.volumes.voice<=0.001)return true;
  if(url){
   const a=new Audio(url);a.volume=audio.volumes.voice;current=a;
   const ok=await new Promise(resolve=>{
    let finished=false;const finish=x=>{if(finished)return;finished=true;clearTimeout(timer);a.onended=a.onerror=null;resolve(x)};
    const timer=setTimeout(()=>finish(false),Math.max(10000,Math.min(45000,text.length*160+7000)));
    a.onended=()=>finish(true);a.onerror=()=>finish(false);
    a.play().catch(()=>finish(false));
   });
   if(current===a)current=null;
   if(ok||token!==generation)return ok;
  }
  if(!('speechSynthesis'in global))return false;
  return new Promise(resolve=>{
   const utter=new SpeechSynthesisUtterance(text);speech=utter;utter.lang='vi-VN';utter.rate=.95;utter.volume=audio.volumes.voice;
   let done=false;const finish=v=>{if(done)return;done=true;clearTimeout(timer);if(speech===utter)speech=null;resolve(v)};
   const timer=setTimeout(()=>{try{speechSynthesis.cancel()}catch(_){}finish(false)},Math.min(45000,Math.max(12000,text.length*150+5000)));
   utter.onend=()=>finish(true);utter.onerror=()=>finish(false);
   try{speechSynthesis.speak(utter)}catch(_){finish(false)}
  });
 }
 async function speakQuestion(q,student,index){
  const token=generation;
  const name=student?.name||'';
  const call=template('call',{name,index});
  if(call)await play(call,phraseMap.get(call)||null,token);
  if(token!==generation)return;
  if(student&&nameVoices.has(student.id))await play(name,nameVoices.get(student.id),token);
  if(token!==generation)return;
  const text=questionSpeech(q);
  const url=audioMap.get(q.id+':full');
  const hash=hashMap.get(q.id+':full');
  const wavOkay=url&&hash&&await sha256(text)===hash;
  await play(text,wavOkay?url:null,token);
  if(token===generation)onStatus('');
 }
 async function speakResult(q,correct,name=''){
  const answer='Đáp án đúng là phương án '+q.correct+'. '+q.options[['A','B','C','D'].indexOf(q.correct)]+'.';
  const token=generation;
  await play(template(correct?'correct':'wrong',{name,answer,explanation:q.explanation||''}),null,token);
  if(token===generation)onStatus('');
 }
 async function speakEvent(kind){
  const text=kind==='wave'?'Chú ý, sóng lớn đang đến!':kind==='storm'?'Cơn bão mạnh đang tiến đến!':'Mặt đất đang rung chuyển!';
  await play(text);
  onStatus('');
 }
 function setVolume(value){audio.setVolume('voice',value);if(current)current.volume=audio.volumes.voice;if(speech)speech.volume=audio.volumes.voice;}
 return{load,speakQuestion,speakResult,speakEvent,stop,pause,resume,setVolume,
  get scriptName(){return script.title},get voiceId(){return voiceId}};
}
global.IslandMotion={getClient,user,signIn,signOut,shared,loadBank,loadClasses,loadStudents,loadScripts,sound,createVoice};
})(window);
