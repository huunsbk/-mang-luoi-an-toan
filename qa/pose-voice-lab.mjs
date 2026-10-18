import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { TextEncoder, TextDecoder } from 'node:util';

const index = fs.readFileSync('pose-quiz/index.html','utf8');
for (const marker of [
  'PoseQuizVoiceRuntime',
  'voiceNarration',
  '🔊 ĐANG DÙNG GIỌNG',
  '🔇 KHÔNG DÙNG GIỌNG',
  'bankQuestionId',
  '/classrooms/classroom-store.js',
  '/scripts/script-store.js',
  '/unified-voice/voice-profile.js',
  '⏭ BỎ QUA LỜI ĐỌC',
  'voiceRunIdRef'
]) assert(index.includes(marker), 'Thiếu marker: '+marker);

assert(!index.includes('currentQuestion?.id, feedback, voiceGameVolume'), 'Effect đọc không được phụ thuộc voiceGameVolume vì sẽ hủy phiên đọc khi kéo âm lượng.');
assert(!index.includes("skipNarration('watchdog')"), 'Không được dùng watchdog tổng theo thời gian ước lượng vì có thể ngắt nhầm narration.');
assert(!index.includes('Lời đọc bị gián đoạn — hệ thống đã mở khóa trả lời'), 'Không được hiện cảnh báo gián đoạn giả khi chỉ thay đổi âm lượng.');

const context = {
  console,
  crypto: webcrypto,
  TextEncoder,
  TextDecoder,
  Blob,
  setTimeout,
  clearTimeout,
  URL: { revokeObjectURL(){}, createObjectURL(){ return 'blob:test'; } },
  fetch: async () => ({ ok:true, json:async()=>({ok:true,items:[]}) }),
  Audio: class {
    constructor(url){ this.url=url; this.volume=1; this.paused=true; }
    play(){
      this.paused=false;
      if(!String(this.url||'').startsWith('stuck://')) setTimeout(()=>this.onended?.(),0);
      return Promise.resolve();
    }
    pause(){ this.paused=true; }
  },
  SpeechSynthesisUtterance: class { constructor(text){ this.text=text; } },
  speechSynthesis: {
    speak(u){ setTimeout(()=>u.onend?.(),0); },
    cancel(){}, pause(){}, resume(){}
  }
};
context.window = context;
context.globalThis = context;
context.POSE_QUIZ_SUPABASE = context.window.POSE_QUIZ_SUPABASE = {url:'https://example.supabase.co',publishableKey:'pk'};
vm.createContext(context);

vm.runInContext(fs.readFileSync('scripts/script-store.js','utf8'), context, {filename:'script-store.js'});

const store=context.window.TeacherScriptStore;
store.listScripts=async()=>[{id:'script-1',title:'Kịch bản thử',theme:'custom',isActive:true,slots:{
  intro:['Bắt đầu nhé!'],
  call:['Mời em {tên} trả lời. Câu hỏi số {số}.'],
  correct:['Chính xác! {đáp án} Chúc mừng em {tên}!'],
  wrong:['Chưa đúng. {đáp án} Em cố gắng nhé!'],
  summary:['Đã hoàn thành {đúng} trên {tổng} câu.']
}}];
store.listPhraseAudio=async()=>[];

const students=[
  {id:'s1',name:'An',active:true},
  {id:'s2',name:'Bình',active:true},
  {id:'s3',name:'Chi',active:true}
];
context.window.TeacherClassroomStore={
  listClasses:async()=>[{id:'c1',name:'5A2',grade:5,school_year:'2026-2027'}],
  listStudents:async(_c,id)=>id==='c1'?students:[],
  listStudentNameVoices:async()=>[],
  studentNameHash:async name=>'hash-'+name
};
context.window.MotionVoice={
  get:async()=> 'edge:namminh-b1',
  label:id=>'TEST '+id
};

vm.runInContext(fs.readFileSync('pose-quiz/voice-runtime.js','utf8'), context, {filename:'voice-runtime.js'});
const R=context.window.PoseQuizVoiceRuntime;
assert(R, 'PoseQuizVoiceRuntime không được tạo.');

const spoken=R.spoken({
  text:'Thiết bị nào dùng để nhập chữ?',
  answers:[
    {text:'Chuột',isCorrect:false},
    {text:'Bàn phím',isCorrect:true},
    {text:'Màn hình',isCorrect:false},
    {text:'Loa',isCorrect:false}
  ]
});
assert.equal(spoken.answer,'Đáp án đúng là phương án B. Bàn phím.');
assert(spoken.full.includes('Phương án D. Loa.'));

const client={auth:{getSession:async()=>({data:{session:{access_token:'token'}}})}};
const opts=await R.editorOptions(client);
assert.equal(opts.scripts.length,2);
assert.equal(opts.classes[0].name,'5A2');
assert.equal(opts.voiceId,'edge:namminh-b1');

const question={
  id:'q1',
  text:'2 cộng 2 bằng mấy?',
  answers:[
    {text:'3',isCorrect:false},{text:'4',isCorrect:true},{text:'5',isCorrect:false},{text:'6',isCorrect:false}
  ]
};
const settings={
  voiceNarration:{enabled:true,scriptId:'script-1',classroomId:'c1'},
  questions:[question]
};
const runtime=R.create({client,volume:0});
const info=await runtime.load(settings);
assert.equal(info.classSize,3);
const called=[];
for(let i=0;i<3;i++){
  const r=await runtime.presentQuestion(question,i,{onStudent:s=>called.push(s?.id)});
  assert(r.student);
}
assert.equal(new Set(called).size,3,'Túi xáo trộn phải gọi đủ 3 học sinh trước khi lặp.');

const noClass=R.create({client,volume:0});
await noClass.load({...settings,voiceNarration:{enabled:true,scriptId:'script-1',classroomId:''}});
const noClassResult=await noClass.presentQuestion(question,0,{});
assert.equal(noClassResult.student,null,'Không chọn lớp thì không được gọi tên học sinh.');

const off=R.create({client,volume:0});
await off.load({...settings,voiceNarration:{enabled:false,scriptId:'script-1',classroomId:'c1'}});
const offResult=await off.presentQuestion(question,0,{});
assert.equal(offResult.played,false,'Tắt giọng đọc thì runtime không được phát lời.');

// Stop/skip phải giải phóng ngay Promise đang chờ audio, không để voiceBusy kẹt vô hạn.
store.listPhraseAudio=async()=>[{phrase:'Bắt đầu nhé!',voiceId:'edge:namminh-b1',url:'stuck://intro'}];
const stuck=R.create({client,volume:1});
await stuck.load(settings);
const pending=stuck.presentQuestion(question,0,{intro:true});
setTimeout(()=>stuck.stop(),20);
const stoppedResult=await Promise.race([
  pending,
  new Promise((_,reject)=>setTimeout(()=>reject(new Error('stop() không giải phóng narration đang chờ.')),800))
]);
assert.equal(stoppedResult.played,false,'Sau stop(), narration phải kết thúc ở trạng thái không phát.');

console.log('POSE_VOICE_LAB_QA_OK');
