/* AI Pose Quiz · Voice/Class runtime (LAB branch only)
 * Reuses MotionClass shared stores: scripts, system voice, classrooms, student-name WAVs,
 * and shared question WAVs. No Google/AI Studio generation happens during gameplay.
 */
(function(){
'use strict';

const cfg=window.POSE_QUIZ_SUPABASE;
const S=()=>window.TeacherScriptStore;
const C=()=>window.TeacherClassroomStore;
const V=()=>window.MotionVoice;
const K=['A','B','C','D'];
const PARTS=['question','option_a','option_b','option_c','option_d'];
const endpoint=()=>cfg?.url+'/functions/v1/shared-question-api';

const norm=s=>String(s||'').normalize('NFC').replace(/\s+/g,' ').trim();
const punctuation=value=>{const t=norm(value);return /[.!?]$/.test(t)?t:t+'.'};
const mediaSrc=value=>!value?null:(typeof value==='string'?value:(value.url||value.signedUrl||null));
async function sha256(text){
 const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(String(text)));
 return Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,'0')).join('');
}
function spoken(question){
 const answers=Array.isArray(question?.answers)?question.answers.slice(0,4):[];
 if(!norm(question?.text)||answers.length!==4)return null;
 const correct=answers.findIndex(a=>a?.isCorrect===true);
 if(correct<0)return null;
 const out={
  question:punctuation(question.text),
  full:punctuation(question.text)+' '+K.map((k,i)=>'Phương án '+k+'. '+punctuation(answers[i]?.text)).join(' ')+' Em hãy suy nghĩ và lựa chọn một đáp án.',
  answer:'Đáp án đúng là phương án '+K[correct]+'. '+punctuation(answers[correct]?.text)
 };
 K.forEach((k,i)=>out['option_'+k.toLowerCase()]='Phương án '+k+'. '+punctuation(answers[i]?.text));
 const explanation=norm(question?.explanation);
 if(explanation)out.explain=punctuation(explanation);
 return out;
}
function cleanNoNameTemplate(template){
 return norm(String(template||'')
  .replace(/\{tên\}/gu,'')
  .replace(/\s+([,.;:!?])/gu,'$1')
  .replace(/([,.;:!?]){2,}/gu,'$1'));
}
function randomChoice(list,lastIndex=-1){
 if(!list?.length)return'';
 if(list.length===1)return list[0];
 let i=Math.floor(Math.random()*list.length);
 if(i===lastIndex)i=(i+1)%list.length;
 return list[i];
}

async function api(client,action,body={}){
 const {data:{session},error}=await client.auth.getSession();
 if(error||!session?.access_token)throw Error('Phiên đăng nhập đã hết hạn.');
 const response=await fetch(endpoint(),{
  method:'POST',
  headers:{Authorization:'Bearer '+session.access_token,apikey:cfg.publishableKey,'Content-Type':'application/json'},
  body:JSON.stringify({action,...body})
 });
 const data=await response.json().catch(()=>({}));
 if(!response.ok||!data.ok)throw Error(data.error||('Kho học liệu lỗi HTTP '+response.status));
 return data;
}

async function editorOptions(client){
 const store=S(),classes=C(),voice=V();
 if(!store||!classes||!voice)throw Error('Chưa tải đủ mô-đun MotionClass.');
 const [scripts,classRows,voiceId]=await Promise.all([
  store.listScripts(client),
  classes.listClasses(client),
  voice.get(client)
 ]);
 return{
  scripts:[store.BUILTIN,...scripts.filter(x=>x.isActive!==false)],
  classes:classRows,
  voiceId,
  voiceLabel:voice.label(voiceId)
 };
}

function create({client,volume=1}={}){
 if(!client)throw Error('Thiếu Supabase client.');
 let volumeValue=Math.max(0,Math.min(1,Number(volume)||0));
 let currentAudio=null,currentUrl=null,currentUtterance=null,currentAudioFinish=null,currentSpeechFinish=null,stopped=0,paused=false;
 let voiceId='device',script=null,phraseMap=new Map(),students=[],studentVoiceMap=new Map();
 let questionAudioMap=new Map(),questionHashMap=new Map(),shuffleBag=[],lastStudentId=null;
 let lessonSettings=null,loaded=false,lastVariant=new Map();

 function releaseAudio(){
  const finish=currentAudioFinish;
  currentAudioFinish=null;
  if(currentAudio){
   try{currentAudio.pause()}catch(_){}
   currentAudio.onended=currentAudio.onerror=currentAudio.onabort=currentAudio.onloadedmetadata=null;
   currentAudio=null;
  }
  if(currentUrl){URL.revokeObjectURL(currentUrl);currentUrl=null}
  if(finish)try{finish(false)}catch(_){}
 }
 function stop(){
  stopped++;paused=false;
  releaseAudio();
  const finishSpeech=currentSpeechFinish;
  currentSpeechFinish=null;
  try{speechSynthesis.cancel()}catch(_){}
  currentUtterance=null;
  if(finishSpeech)try{finishSpeech(false)}catch(_){}
 }
 function pause(){
  paused=true;
  try{currentAudio?.pause()}catch(_){}
  try{speechSynthesis.pause()}catch(_){}
 }
 function resume(){
  paused=false;
  try{if(currentAudio?.paused)currentAudio.play().catch(()=>{})}catch(_){}
  try{speechSynthesis.resume()}catch(_){}
 }
 function setVolume(v){
  volumeValue=Math.max(0,Math.min(1,Number(v)||0));
  if(currentAudio)currentAudio.volume=volumeValue;
  if(currentUtterance)currentUtterance.volume=volumeValue;
 }
 function variant(key){
  const base=S()?.BUILTIN;
  const list=(script?.slots?.[key]?.length?script.slots[key]:base?.slots?.[key])||[];
  if(!list.length)return'';
  if(list.length===1)return list[0];
  const prev=lastVariant.get(key)??-1;
  const value=randomChoice(list,prev);
  lastVariant.set(key,list.indexOf(value));
  return value;
 }
 function refillBag(){
  const active=students.filter(s=>s.active!==false);
  shuffleBag=active.slice();
  for(let i=shuffleBag.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[shuffleBag[i],shuffleBag[j]]=[shuffleBag[j],shuffleBag[i]]}
  if(shuffleBag.length>1&&shuffleBag[0]?.id===lastStudentId)[shuffleBag[0],shuffleBag[1]]=[shuffleBag[1],shuffleBag[0]];
 }
 function pickStudent(){
  if(!students.length)return null;
  if(!shuffleBag.length)refillBag();
  const student=shuffleBag.shift()||null;
  if(student)lastStudentId=student.id;
  return student;
 }
 function phraseUrl(text){
  return phraseMap.get(S()?.norm(text)||norm(text))||null;
 }
 function studentUrl(student){
  return student?.id?studentVoiceMap.get(student.id)||null:null;
 }
 function qKey(question){return String(question?.bankQuestionId||'');}
 function questionUrl(question,part){
  return questionAudioMap.get(qKey(question)+':'+part)||null;
 }
 function legacyQuestionAudio(question){return mediaSrc(question?.audio?.data)}

 async function playUrl(url,token){
  if(!url||token!==stopped)return false;
  releaseAudio();
  const a=new Audio(url);currentAudio=a;a.volume=volumeValue;a.preload='auto';
  return await new Promise(resolve=>{
   let done=false;
   let timer=setTimeout(()=>finish(false),25000);
   const armTimeout=ms=>{
    clearTimeout(timer);
    timer=setTimeout(()=>finish(false),Math.max(6000,Math.min(45000,ms)));
   };
   const finish=ok=>{
    if(done)return;
    done=true;
    clearTimeout(timer);
    if(currentAudioFinish===finish)currentAudioFinish=null;
    a.onended=a.onerror=a.onabort=a.onloadedmetadata=null;
    if(!ok){try{a.pause()}catch(_){}}
    if(currentAudio===a)currentAudio=null;
    resolve(ok);
   };
   currentAudioFinish=finish;
   a.onloadedmetadata=()=>{
    const duration=Number(a.duration);
    if(Number.isFinite(duration)&&duration>0)armTimeout(duration*1000+4000);
   };
   a.onended=()=>finish(true);
   a.onerror=()=>finish(false);
   a.onabort=()=>finish(false);
   a.play().catch(()=>finish(false));
  });
 }
 async function speak(text,token){
  text=norm(text);if(!text||token!==stopped)return false;
  if(volumeValue<=0.001)return true;
  if(!('speechSynthesis'in window)||!('SpeechSynthesisUtterance'in window))return false;
  return await new Promise(resolve=>{
   const u=new SpeechSynthesisUtterance(text);currentUtterance=u;u.lang='vi-VN';u.rate=.92;u.pitch=.96;u.volume=volumeValue;
   let done=false;
   const timeoutMs=Math.max(6000,Math.min(30000,text.length*140+4500));
   const timer=setTimeout(()=>{
    if(currentUtterance===u){try{speechSynthesis.cancel()}catch(_){}}
    finish(false);
   },timeoutMs);
   const finish=ok=>{
    if(done)return;
    done=true;
    clearTimeout(timer);
    if(currentSpeechFinish===finish)currentSpeechFinish=null;
    u.onend=u.onerror=null;
    if(currentUtterance===u)currentUtterance=null;
    resolve(ok);
   };
   currentSpeechFinish=finish;
   u.onend=()=>finish(true);
   u.onerror=()=>finish(false);
   try{speechSynthesis.speak(u)}catch(_){finish(false)}
  });
 }
 async function playSegment(seg,token){
  if(token!==stopped)return false;
  if(volumeValue<=0.001)return true;
  if(seg.url){const ok=await playUrl(seg.url,token);if(ok)return true}
  if(seg.legacyUrl){const ok=await playUrl(seg.legacyUrl,token);if(ok)return true}
  return speak(seg.text,token);
 }
 async function playPlan(plan){
  const token=stopped;
  for(const seg of plan){
   if(token!==stopped)return false;
   while(paused&&token===stopped)await new Promise(r=>setTimeout(r,80));
   await playSegment(seg,token);
   if(token!==stopped)return false;
   if(seg.gap)await new Promise(r=>setTimeout(r,seg.gap));
  }
  return token===stopped;
 }
 function templateSegments(template,ctx={}){
  const store=S();if(!store||!template)return[];
  const source=ctx.student?template:cleanNoNameTemplate(template);
  const out=[],tokens=store.tokenize(source),autoExplain=!tokens.some(t=>t.type==='explain');
  for(const t of tokens){
   if(t.type==='text')out.push({kind:'phrase',text:t.text,url:phraseUrl(t.text),gap:120});
   else if(t.type==='bound'){
    const value=t.key==='số'?ctx.number:ctx.streak;
    if(value!==undefined){const text=store.boundText(t,value);out.push({kind:'phrase',text,url:phraseUrl(text),gap:180})}
   }else if(t.type==='name'&&ctx.student){
    out.push({kind:'name',text:ctx.student.name,url:studentUrl(ctx.student),gap:140});
   }else if(t.type==='answer'&&ctx.answer){
    out.push(ctx.answer);if(autoExplain&&ctx.explain)out.push(ctx.explain);
   }else if(t.type==='explain'&&ctx.explain)out.push(ctx.explain);
   else if(t.type==='number'){
    const value=t.key==='đúng'?ctx.right:ctx.total;
    if(value!==undefined){const text=store.numberWords(value);out.push({kind:'phrase',text,url:phraseUrl(text),gap:100})}
   }
  }
  return out;
 }
 function questionSegments(question){
  const words=spoken(question);if(!words)return[];
  const available=part=>{
   const url=questionUrl(question,part);if(!url)return false;
   const expected=questionHashMap.get(qKey(question)+':'+part);
   return expected===words[part];
  };
  if(PARTS.every(available))return PARTS.map((part,i)=>({kind:'question',text:words[part],url:questionUrl(question,part),gap:i?170:230}));
  if(available('full'))return[{kind:'question',text:words.full,url:questionUrl(question,'full'),gap:220}];
  const legacy=legacyQuestionAudio(question);
  if(legacy)return[{kind:'question',text:words.full,legacyUrl:legacy,gap:220}];
  return[{kind:'question',text:words.full,gap:220}];
 }
 function answerSegments(question){
  const words=spoken(question);if(!words)return{answer:null,explain:null};
  const answerUrl=questionUrl(question,'answer'),answerText=words.answer;
  const explainUrl=words.explain?questionUrl(question,'explain'):null;
  return{
   answer:{kind:'question',text:answerText,url:answerUrl,gap:180},
   explain:words.explain?{kind:'question',text:words.explain,url:explainUrl,gap:180}:null
  };
 }

 async function loadQuestionAudio(settings){
  questionAudioMap=new Map();questionHashMap=new Map();
  const questions=settings.questions||[];
  const ids=[...new Set(questions.map(q=>q.bankQuestionId).filter(Boolean))];
  if(!ids.length||voiceId==='device')return;
  for(let i=0;i<ids.length;i+=80){
   const result=await api(client,'audio.list',{ids:ids.slice(i,i+80),voice_id:voiceId});
   for(const row of result.items||[]){
    questionAudioMap.set(row.id+':'+row.part,row.url);
    questionHashMap.set(row.id+':'+row.part,row.textHash);
   }
  }
  // Replace remote hash with the actual lesson text when it still matches the stored WAV.
  // This prevents a lesson edited after import from playing an obsolete bank WAV.
  for(const q of questions){
   const id=qKey(q),words=spoken(q);if(!id||!words)continue;
   for(const [part,text] of Object.entries(words)){
    const key=id+':'+part;if(!questionAudioMap.has(key))continue;
    const digest=await sha256(text);
    if(questionHashMap.get(key)!==digest){questionAudioMap.delete(key);questionHashMap.delete(key)}
    else questionHashMap.set(key,text);
   }
  }
 }
 async function load(settings){
  lessonSettings=settings;loaded=false;stop();
  const store=S(),classStore=C(),voice=V();
  if(!store||!classStore||!voice)throw Error('Thiếu mô-đun MotionClass dùng chung.');
  voiceId=await voice.get(client);
  const [scripts,phrases]=await Promise.all([
   store.listScripts(client),
   voiceId==='device'?Promise.resolve([]):store.listPhraseAudio(client,{voiceId,sign:true})
  ]);
  const scriptId=settings?.voiceNarration?.scriptId||'builtin';
  script=scriptId==='builtin'?store.BUILTIN:(scripts.find(x=>x.id===scriptId&&x.isActive!==false)||store.BUILTIN);
  phraseMap=new Map(phrases.filter(p=>p.url).map(p=>[store.norm(p.phrase),p.url]));

  students=[];studentVoiceMap=new Map();shuffleBag=[];lastStudentId=null;
  const classId=settings?.voiceNarration?.classroomId||'';
  if(classId){
   students=(await classStore.listStudents(client,classId)).filter(x=>x.active!==false);
   if(voiceId!=='device'){
    const rows=await classStore.listStudentNameVoices(client,classId);
    for(const row of rows){
     if(row.voiceId!==voiceId||!row.url)continue;
     const student=students.find(s=>s.id===row.studentId);if(!student)continue;
     const hash=await classStore.studentNameHash(student.name);
     if(hash===row.nameHash)studentVoiceMap.set(student.id,row.url);
    }
   }
   refillBag();
  }
  await loadQuestionAudio(settings);
  loaded=true;
  return{
   voiceId,voiceLabel:voice.label(voiceId),scriptTitle:script?.title||'Mặc định',
   classId,classSize:students.length,phraseCount:phraseMap.size,
   studentVoiceCount:studentVoiceMap.size,questionAudioCount:questionAudioMap.size
  };
 }
 async function presentQuestion(question,index,{intro=false,onStudent=null}={}){
  if(!loaded||!lessonSettings?.voiceNarration?.enabled)return{student:null,played:false};
  const student=lessonSettings.voiceNarration.classroomId?pickStudent():null;
  if(typeof onStudent==='function')try{onStudent(student)}catch(_){}
  const plan=[];
  if(intro)plan.push(...templateSegments(variant('intro'),{}));
  if(plan.length)plan[plan.length-1].gap=300;
  plan.push(...templateSegments(variant('call'),{student,number:index+1}));
  if(plan.length)plan[plan.length-1].gap=240;
  plan.push(...questionSegments(question));
  return{student,played:await playPlan(plan)};
 }
 async function result(question,student,correct){
  if(!loaded||!lessonSettings?.voiceNarration?.enabled)return false;
  const {answer,explain}=answerSegments(question);
  const plan=templateSegments(variant(correct?'correct':'wrong'),{student,answer,explain});
  return playPlan(plan);
 }
 async function summary(right,total){
  if(!loaded||!lessonSettings?.voiceNarration?.enabled)return false;
  return playPlan(templateSegments(variant('summary'),{right,total}));
 }

 return{load,presentQuestion,result,summary,stop,pause,resume,setVolume,pickStudent,
  info:()=>({loaded,voiceId,scriptTitle:script?.title||'',students:students.length,phraseCount:phraseMap.size,
   studentVoiceCount:studentVoiceMap.size,questionAudioCount:questionAudioMap.size})};
}

window.PoseQuizVoiceRuntime={editorOptions,create,spoken,sha256};
})();
