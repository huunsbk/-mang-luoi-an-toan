/* Island Survival 3D — pure state machine and deterministic classroom scoring. */
(function(global) {
 'use strict';
 const NAMES=['Sao Vàng','Tia Chớp','Cầu Vồng','Sóng Xanh','Mặt Trời','Ngôi Sao'];
 const COLORS=['#F5B73C','#F56562','#50BDDB','#49BB85','#AB83EF','#F38CBD'];
 const ALPHABET=['A','B','C','D'];
 const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
 const numeric=x=>Number.isFinite(Number(x))?Number(x):0;
 const demoQuestions=[
  ['Bộ phận nào dùng để nhập chữ và số vào máy tính?',['Chuột','Màn hình','Bàn phím','Loa'],'C','Bàn phím giúp nhập chữ, số và các ký hiệu.'],
  ['Thiết bị nào thường dùng để điều khiển con trỏ trên màn hình?',['Loa','Chuột','Máy in','Micro'],'B','Chuột máy tính giúp di chuyển con trỏ và lựa chọn.'],
  ['Thông tin nào không nên chia sẻ công khai trên Internet?',['Tên một loài hoa','Mật khẩu cá nhân','Bài hát yêu thích','Tên môn học'],'B','Mật khẩu phải được giữ bí mật.'],
  ['Phím nào thường được dùng để xuống dòng khi gõ văn bản?',['Shift','Enter','Esc','Tab'],'B','Enter tạo dòng hoặc đoạn văn mới.'],
  ['Đâu là một trình duyệt web?',['Chrome','Paint','Calculator','Notepad'],'A','Chrome là trình duyệt để xem các trang web.'],
  ['Khi nhận được liên kết lạ, em nên làm gì?',['Nhấn ngay','Chia sẻ cho cả lớp','Kiểm tra nguồn và hỏi người lớn','Nhập mật khẩu'],'C','Kiểm tra độ tin cậy của đường dẫn trước khi mở.'],
  ['Bộ phận nào hiển thị hình ảnh của máy tính?',['Màn hình','Bàn phím','Thân máy','Chuột'],'A','Màn hình là thiết bị xuất thông tin bằng hình ảnh.'],
  ['Muốn lưu bài làm, phím tắt phổ biến là gì?',['Ctrl + P','Ctrl + V','Ctrl + C','Ctrl + S'],'D','Ctrl + S dùng để lưu tệp trong nhiều phần mềm.'],
  ['Một thư mục trên máy tính có thể chứa gì?',['Chỉ ảnh','Tệp và thư mục con','Chỉ âm thanh','Chỉ video'],'B','Một thư mục có thể chứa tệp và thư mục con.'],
  ['Hành động nào giúp bảo vệ mắt khi dùng máy tính?',['Ngồi rất gần','Nhìn không nghỉ','Nghỉ mắt và ngồi đúng tư thế','Tắt đèn phòng'],'C','Nghỉ định kỳ và giữ khoảng cách phù hợp giúp bảo vệ mắt.'],
  ['Trong Scratch, khối lệnh nào thường bắt đầu chương trình?',['Khi bấm cờ xanh','Đợi 1 giây','Di chuyển 10 bước','Nói Xin chào'],'A','Khối Khi bấm cờ xanh là một dạng sự kiện bắt đầu.'],
  ['Thiết bị nào dùng để nghe âm thanh từ máy tính?',['Máy in','Loa','Bàn phím','Máy quét'],'B','Loa là thiết bị xuất âm thanh.'],
  ['Mạng Internet có lợi ích nào sau đây?',['Tự động làm bài tập','Kết nối và tìm kiếm thông tin','Không cần học','Thay thế giáo viên'],'B','Internet giúp truy cập và trao đổi thông tin.'],
  ['Khi chưa chắc thông tin trên mạng đúng, em nên làm gì?',['Tin ngay','Đăng lại','Kiểm tra nguồn khác','Gửi mật khẩu'],'C','Đối chiếu nhiều nguồn đáng tin giúp kiểm chứng thông tin.'],
  ['Bộ phận nào giúp nhập giọng nói vào máy tính?',['Micro','Máy in','Loa','Màn hình'],'A','Micro thu âm thanh đưa vào máy tính.'],
  ['Biểu tượng ổ khóa cạnh địa chỉ HTTPS cho biết điều gì?',['Website luôn đúng','Kết nối được mã hóa','Trang không có quảng cáo','Máy tính hết virus'],'B','HTTPS giúp mã hóa kết nối nhưng không bảo đảm nội dung là đáng tin.'],
  ['Để chọn toàn bộ văn bản, ta thường nhấn gì?',['Ctrl + A','Ctrl + X','Ctrl + Y','Ctrl + Z'],'A','Ctrl + A thường chọn tất cả.'],
  ['Khi bạn bị bắt nạt trên mạng, cách xử lý phù hợp là gì?',['Đáp trả xúc phạm','Lưu bằng chứng và báo người lớn','Công khai mật khẩu','Im lặng mãi'],'B','Lưu bằng chứng và báo người lớn đáng tin giúp xử lý an toàn.'],
  ['Tệp có phần mở rộng .png thường chứa gì?',['Ảnh','Văn bản thuần','Nhạc MP3','Chương trình thực thi'],'A','PNG là định dạng tệp ảnh.'],
  ['Tổ hợp Ctrl + Z thường có tác dụng gì?',['Hoàn tác','Lưu tệp','Dán','In'],'A','Ctrl + Z hoàn tác thao tác gần nhất trong nhiều phần mềm.'],
  ['Phát biểu nào đúng về mật khẩu mạnh?',['Dùng ngày sinh','Chỉ dùng 123456','Khó đoán và không dùng lại','Chia sẻ cho bạn'],'C','Mật khẩu cần đủ mạnh và giữ bí mật.'],
  ['Muốn tìm một tệp đã lưu, ta có thể mở công cụ nào?',['File Explorer','Camera','Máy tính bỏ túi','Ghi âm'],'A','File Explorer giúp quản lý và tìm tệp trên Windows.'],
  ['Việc nào giúp tiết kiệm điện khi không dùng máy tính?',['Để màn hình sáng','Tắt máy đúng cách','Tăng âm lượng','Mở nhiều cửa sổ'],'B','Tắt máy đúng cách giúp tiết kiệm điện năng.'],
  ['Để đánh dấu một trang web hay dùng, trình duyệt có chức năng gì?',['Bookmarks','Print','Zoom','Reload'],'A','Dấu trang giúp lưu địa chỉ trang web để mở lại.']
 ].map((q,i)=>({id:'demo-'+(i+1),text:q[0],options:q[1],correct:q[2],explanation:q[3],grade:3,subject:'Tin học 3',lesson:'Ôn tập Tin học',source:'demo'}));
 function normalizeQuestion(item) {
  if(!item)return null;
  const options=Array.isArray(item.options)?item.options.slice(0,4):
    Array.isArray(item.answers)?item.answers.slice(0,4).map(a=>a.text):[];
  const correct=typeof item.correct==='string'?
    item.correct.toUpperCase():ALPHABET[(item.answers||[]).findIndex(a=>a.isCorrect===true)]||'';
  if(!item.text||options.length!==4||!ALPHABET.includes(correct))return null;
  return {id:String(item.id||item.bankQuestionId||''),text:String(item.text),options:options.map(String),correct,
   explanation:String(item.explanation||''),subject:item.subject||item.subject_name||'',lesson:item.lesson||item.lesson_name||'',
   grade:item.grade||null,imageUrl:item.imageUrl||null,source:item.source||'bank',spoken:item.spoken||null};
 }
 function seededRng(seed) {let v=(Number(seed)>>>0)||24681357;return ()=>{v=(Math.imul(v,1664525)+1013904223)>>>0;return v/4294967296;};}
 function shuffle(arr,rng){const a=arr.slice();for(let i=a.length-1;i>0;i--){const j=Math.floor(rng()*(i+1));[a[i],a[j]]=[a[j],a[i]];}return a;}
 function allocateTeams(students,count) {
  const teams=Array.from({length:count},(_,i)=>({id:'team-'+(i+1),name:NAMES[i],color:COLORS[i],students:[],health:3,maxHealth:3,materials:0,shield:0,bridges:0,correct:0,answered:0,strategic:0,events:[],history:[]}));
  students.forEach((student,i)=>teams[i%count].students.push({...student}));
  return teams;
 }
 function score(team,turns){return{
   knowledge:Math.round(70*team.correct/Math.max(1,turns)),
   survival:Math.round(20*team.health/Math.max(1,team.maxHealth)),
   strategy:Math.min(10,team.strategic*2+Math.min(4,team.bridges*2)),
   total:Math.round(70*team.correct/Math.max(1,turns))+Math.round(20*team.health/Math.max(1,team.maxHealth))+Math.min(10,team.strategic*2+Math.min(4,team.bridges*2))
  };}
 function create(config={}) {
  const count=clamp(Math.floor(numeric(config.teamCount)||4),2,6);
  const rounds=clamp(Math.floor(numeric(config.rounds)||2),1,5);
  const questions=(config.questions||demoQuestions).map(normalizeQuestion).filter(Boolean);
  if(questions.length<count*rounds)throw Error('Cần tối thiểu '+(count*rounds)+' câu hỏi khác nhau cho '+count+' đội × '+rounds+' vòng.');
  const seed=(Number(config.seed)>>>0)||Math.floor(Math.random()*4294967295);
  const rng=seededRng(seed);
  let students=Array.isArray(config.students)?config.students.filter(s=>s.active!==false).map(s=>({id:s.id||s.name,name:s.name||s.full_name||'Học sinh',photoUrl:s.photoUrl||null})):[];
  students=shuffle(students,rng);
  const teams=allocateTeams(students,count);
  const planned=shuffle(questions,rng).slice(0,count*rounds);
  const timeLimit=clamp(Math.floor(numeric(config.timeLimit)||15),5,60);
  const state={version:1,seed,config:{count,rounds,timeLimit,difficulty:config.difficulty||'balanced',classId:config.classId||null,voiceEnabled:!!config.voiceEnabled,scriptId:config.scriptId||'builtin'},teams,questions:planned,
    turn:0,phase:'lobby',chosen:null,activeStudent:null,seconds:timeLimit,paused:false,history:[],lastEvent:null,actionLock:false,deadline:0};
  function activeTeam(){return state.teams[state.turn%count];}
  function currentQuestion(){return state.questions[state.turn]||null;}
  function currentRound(){return Math.floor(state.turn/count)+1;}
  function currentStudent(){const team=activeTeam();return team?.students?.length?team.students[Math.floor(state.turn/count)%team.students.length]:null;}
  function start(){if(state.phase!=='lobby')return false;state.phase='reading';state.activeStudent=currentStudent();state.seconds=timeLimit;return true;}
  function ready(){if(state.phase!=='reading')return false;state.phase='ready';return true;}
  function beginAnswer(){if(state.phase!=='ready')return false;state.seconds=timeLimit;state.phase='answer';return true;}
  function tick(){if(state.paused||state.phase!=='answer')return false;state.seconds=Math.max(0,state.seconds-1);if(state.seconds===0)choose(null);return true;}
  function choose(letter){if(state.phase!=='answer')return false;
   const q=currentQuestion(),team=activeTeam();const selected=letter&&ALPHABET.includes(String(letter).toUpperCase())?String(letter).toUpperCase():null;
   const correct=selected===q.correct;
   team.answered++;if(correct){team.correct++;team.materials+=2;}
   state.chosen=selected;state.phase='feedback';
   const log={turn:state.turn,round:currentRound(),teamId:team.id,studentId:state.activeStudent?.id||null,questionId:q.id,
     answer:selected,correct,correctAnswer:q.correct,materials:team.materials};
   state.history.push(log);team.history.push(log);
   return true;
  }
  function build(action) {
   if(state.phase!=='feedback'&&state.phase!=='build')return false;
   const team=activeTeam();state.phase='build';
   const costs={shield:2,repair:3,bridge:2,save:0};
   if(!Object.hasOwn(costs,action))return false;
   if(team.materials<costs[action])return false;
   if(action==='repair'&&team.health===team.maxHealth)return false;
   team.materials-=costs[action];
   if(action==='shield')team.shield++;
   if(action==='repair')team.health=Math.min(team.maxHealth,team.health+1);
   if(action==='bridge')team.bridges++;
   if(action!=='save')team.strategic++;
   state.history.push({type:'build',turn:state.turn,teamId:team.id,action});
   state.phase='transition';return true;
  }
  function next(){
   if(state.phase!=='transition'&&state.phase!=='event_done')return false;
   if(state.phase==='transition' && (state.turn+1)%count===0){
    state.phase='event';state.lastEvent=chooseEvent(rng,state.config.difficulty);
    return true;
   }
   if(state.phase==='event_done' && state.turn+1>=planned.length){state.phase='finished';return true;}
   if(state.phase==='transition' && state.turn+1>=planned.length){state.phase='finished';return true;}
   state.turn++;state.phase='reading';state.seconds=timeLimit;state.chosen=null;state.activeStudent=currentStudent();return true;
  }
  function chooseEvent(rng,difficulty){
   const kind=['wave','storm','quake'][Math.floor(rng()*3)];
   return{kind,title:{wave:'Sóng lớn',storm:'Bão trên đảo',quake:'Rung chuyển đảo'}[kind],damage:difficulty==='easy'?0:1,applied:false};
  }
  function resolveEvent(){
   if(state.phase!=='event'||!state.lastEvent||state.lastEvent.applied)return false;
   const e=state.lastEvent;e.applied=true;e.outcomes=[];
   for(const t of state.teams){
    const defense=t.shield>0?1:0;if(defense)t.shield--;
    // Every team faces the same hazard magnitude; defense only helps those who earned shields.
    const damage=Math.max(0,e.damage-defense);
    t.health=clamp(t.health-damage,0,t.maxHealth);
    e.outcomes.push({teamId:t.id,damage,protected:!!defense,health:t.health});
    t.events.push({round:currentRound(),kind:e.kind,damage,protected:!!defense});
   }
   state.history.push({type:'event',round:currentRound(),kind:e.kind,outcomes:e.outcomes});
   state.phase='event_done';return true;
  }
  function standings(){return state.teams.map(t=>({...t,score:score(t,rounds)})).sort((a,b)=>b.score.total-a.score.total||b.score.knowledge-a.score.knowledge||b.score.survival-a.score.survival||a.id.localeCompare(b.id));}
  function pause(){state.paused=!state.paused;return state.paused;}
  return{state,activeTeam,currentQuestion,currentRound,currentStudent,start,ready,beginAnswer,tick,choose,build,next,resolveEvent,standings,pause,
    serialize:()=>JSON.parse(JSON.stringify({config:state.config,seed:state.seed,teams:state.teams,history:state.history,standings:standings().map(t=>({id:t.id,name:t.name,score:t.score}))}))};
 }
 global.IslandEngine={create,normalizeQuestion,demoQuestions,allocateTeams,seededRng,score};
})(window);
