/* Island Survival — teacher workflow + phase-driven 3D gameplay */
(function(){
'use strict';
const $=id=>document.getElementById(id);
const esc=v=>String(v??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const eng=window.IslandEngine,motion=window.IslandMotion;
let game=null,scene=null,pose=null,voice=null,studentList=[],classList=[],scripts=[],bank=eng.demoQuestions.slice();
let selectedIds=new Set(bank.map(x=>x.id)),bankMode='demo',currentClass='',readyAuth=null;
let ticker=null,eventTicker=null,voiceBusy=false,announcing=0,setupTab='lesson';
let audio=motion.sound(),activeSceneCount=0;
audio.setMusic('/pose-quiz/assets/default-bgm.mp3');
audio.setVolume('music',.25);
audio.setVolume('fx',.65);
audio.setVolume('feedback',.85);
audio.setVolume('voice',.9);
let toastTimer=null;
function toast(msg){const el=$('toast');el.textContent=msg;el.style.display='block';clearTimeout(toastTimer);toastTimer=setTimeout(()=>el.style.display='none',3600);}
function info(msg,good=false){$('setup-status').className=good?'status good':'status warn';$('setup-status').textContent=msg;}
function modal(title,body,buttons=''){
 $('modal-content').innerHTML='<h2>'+esc(title)+'</h2>'+body+(buttons?'<div class="row">'+buttons+'</div>':'');
 $('modal').hidden=false;
}
function closeModal(){$('modal').hidden=true}
$('modal').addEventListener('click',e=>{if(e.target.id==='modal')closeModal()});
function tab(name){setupTab=name;document.querySelectorAll('[data-tab]').forEach(t=>t.classList.toggle('active',t.dataset.tab===name));document.querySelectorAll('.tab-content').forEach(x=>x.hidden=x.id!=='tab-'+name)}
document.querySelectorAll('[data-tab]').forEach(el=>el.addEventListener('click',()=>tab(el.dataset.tab)));
function config(){
 return{
  teamCount:Number($('team-count').value),rounds:Number($('rounds').value),
  timeLimit:Number($('time-limit').value),difficulty:$('difficulty').value,
  control:$('control').value,voiceEnabled:$('voice-enabled').checked,
  scriptId:$('script-select').value,classId:currentClass||null,
  questions:bank.filter(q=>selectedIds.has(q.id)),students:studentList
 };
}
function markBank(){
 const box=$('bank-list'),query=$('search-bank').value.toLocaleLowerCase('vi').trim();
 const rows=bank.map((q,i)=>({q,i})).filter(({q})=>!query||[q.text,q.lesson,q.subject,...q.options].join(' ').toLocaleLowerCase('vi').includes(query));
 box.innerHTML=rows.slice(0,110).map(({q,i})=>'<label class="bank-item"><input type="checkbox" data-question="'+esc(q.id)+'" '+(selectedIds.has(q.id)?'checked':'')+'><span><strong>Câu '+(i+1)+': '+esc(q.text)+'</strong><small>'+esc([q.grade?'Lớp '+q.grade:'',q.subject,q.lesson].filter(Boolean).join(' · '))+' · Đáp án '+q.correct+'</small></span></label>').join('')||'<div class="status warn">Không tìm thấy câu hỏi. Thay đổi từ khóa tìm kiếm.</div>';
 $('bank-count').textContent=selectedIds.size+' câu đã chọn / '+bank.length+' câu có sẵn';
 const first=bank.find(q=>selectedIds.has(q.id))||bank[0];
 $('bank-lesson-label').textContent=first?[first.grade?'Lớp '+first.grade:'',first.subject,first.lesson].filter(Boolean).join(' · '):'Chưa chọn câu hỏi';
 box.querySelectorAll('[data-question]').forEach(input=>input.addEventListener('change',e=>{
  const id=e.currentTarget.dataset.question;if(e.currentTarget.checked)selectedIds.add(id);else selectedIds.delete(id);
  $('bank-count').textContent=selectedIds.size+' câu đã chọn / '+bank.length+' câu có sẵn';
 }));
}
$('search-bank').addEventListener('input',markBank);
$('select-demo').addEventListener('click',()=>{
 bank=eng.demoQuestions.slice();selectedIds=new Set(bank.map(q=>q.id));bankMode='demo';
 $('bank-status').textContent='Bộ 24 câu mẫu Tin học 3. Không ghi hay sửa Ngân hàng MotionClass.';markBank();info('✓ Sử dụng câu hỏi mẫu để thử trò chơi.',true);
});
function optionsFor(list,selected){return list.map(x=>'<option value="'+esc(x.id)+'" '+(x.id===selected?'selected':'')+'>'+esc(x.name||x.title)+'</option>').join('')}
async function session(){
 try{readyAuth=await motion.user();$('auth-status').textContent=readyAuth?'👤 '+readyAuth.email:'Chế độ trải nghiệm';
  $('open-login').textContent=readyAuth?'📚 Nạp MotionClass':'🔐 Kết nối MotionClass';
  return readyAuth;
 }catch(e){readyAuth=null;return null}
}
async function connect(){
 const u=await session();if(!u)throw Error('Hãy đăng nhập để nạp câu hỏi và lớp học.');
 info('⏳ Đang đọc Ngân hàng câu hỏi, lớp học và kịch bản...',false);
 const errors=[];
 try{const rows=await motion.loadBank();bank=rows;selectedIds.clear();bankMode='cloud';
  $('bank-status').textContent='Ngân hàng câu hỏi chung MotionClass: '+rows.length+' câu truy cập được. Tích chọn các câu cần sử dụng.';
  markBank();}catch(e){errors.push('Câu hỏi: '+e.message)}
 try{classList=await motion.loadClasses();$('class-select').innerHTML='<option value="">Không chọn lớp (thi theo đội mẫu)</option>'+optionsFor(classList,currentClass);}catch(e){errors.push('Lớp học: '+e.message)}
 try{scripts=await motion.loadScripts();$('script-select').innerHTML=scripts.map(s=>'<option value="'+esc(s.id)+'">'+esc(s.title)+'</option>').join('');$('script-select').disabled=!$('voice-enabled').checked;}catch(e){errors.push('Kịch bản: '+e.message)}
 info(errors.length?'Một số nguồn chưa tải được: '+errors.join(' | '):'✓ Đã đọc dữ liệu MotionClass. Chỉ đọc; không ghi đè Ngân hàng.',!errors.length);
}
function loginDialog(){
 if(readyAuth){connect().then(()=>{tab('lesson');toast('Đã nạp lại học liệu MotionClass')}).catch(e=>toast(e.message));return}
 modal('Đăng nhập MotionClass',
  '<p>Sử dụng chính tài khoản giáo viên đang dùng tại Cổng giáo viên. Preview chỉ đọc Ngân hàng câu hỏi, lớp và kịch bản.</p>'+
  '<form id="login-form"><div class="field"><label>Email tài khoản</label><input type="email" id="login-email" autocomplete="username" required placeholder="Email đăng nhập"></div>'+
  '<div class="field"><label>Mật khẩu</label><input type="password" id="login-password" autocomplete="current-password" required></div>'+
  '<div id="login-error" class="formmsg"></div><button type="submit" class="btn primary">🔐 Đăng nhập & Nạp học liệu</button></form>');
 $('login-form').addEventListener('submit',async e=>{
  e.preventDefault();const b=e.target.querySelector('button');b.disabled=true;$('login-error').textContent='';
  try{await motion.signIn($('login-email').value,$('login-password').value);closeModal();await session();await connect();toast('Đăng nhập thành công, đã tải học liệu');}
  catch(err){$('login-error').textContent='Không thực hiện được: '+err.message;}
  finally{b.disabled=false}
 });
}
$('open-login').addEventListener('click',loginDialog);
$('class-select').addEventListener('change',async e=>{
 currentClass=e.target.value;studentList=[];$('students-preview').innerHTML='';
 if(!currentClass){$('class-hint').textContent='Không chọn lớp: thi với tên đội mẫu, không gọi tên học sinh.';return}
 $('class-hint').textContent='Đang nạp học sinh từ MotionClass...';
 try{studentList=await motion.loadStudents(currentClass);
  $('students-preview').innerHTML=studentList.map(s=>'<span class="student-tag">'+esc(s.name)+'</span>').join('');
  $('class-hint').textContent=studentList.length+' học sinh · chia ngẫu nhiên và cân bằng số thành viên mỗi đội.';
 }catch(err){$('class-hint').textContent='⚠ '+err.message;toast(err.message)}
});
$('voice-enabled').addEventListener('change',e=>{
 $('script-select').disabled=!e.target.checked;
 if(e.target.checked&&!readyAuth){toast('Để dùng giọng đọc và kịch bản MotionClass, cần đăng nhập tài khoản giáo viên.');}
});
['music','fx','feedback','voice'].forEach(key=>{
 const el=$(key+'-volume');el.addEventListener('input',()=>{$(key+'-number').textContent=el.value;
  if(key==='voice'&&voice)voice.setVolume(el.value/100);else audio.setVolume(key,el.value/100);
 });
});
function saveSettings(){
 const c=config(),payload={version:1,teamCount:c.teamCount,rounds:c.rounds,timeLimit:c.timeLimit,difficulty:c.difficulty,control:c.control,voiceEnabled:c.voiceEnabled,scriptId:c.scriptId,classId:c.classId,
  questionIds:c.questions.map(q=>q.id),bankMode};
 try{localStorage.setItem('motionclass:island-preview-config',JSON.stringify(payload));toast('Đã lưu cấu hình thử trên trình duyệt (không lưu lên Supabase).')}
 catch(e){toast('Không lưu được cấu hình: '+e.message)}
}
function loadSettings(){
 try{
  const raw=localStorage.getItem('motionclass:island-preview-config');
  if(!raw)return toast('Chưa có cấu hình thử được lưu.');
  const c=JSON.parse(raw);
  for(const [id,v] of [['team-count',c.teamCount],['rounds',c.rounds],['time-limit',c.timeLimit],['difficulty',c.difficulty],['control',c.control],['script-select',c.scriptId]])if($(id)&&v!=null)$(id).value=v;
  $('voice-enabled').checked=!!c.voiceEnabled;$('script-select').disabled=!c.voiceEnabled;
  if(c.questionIds?.length){selectedIds=new Set(c.questionIds.filter(id=>bank.some(q=>q.id===id)));markBank()}
  toast('Đã mở cấu hình thử. Các câu hỏi phải có trong nguồn đang nạp.');
 }catch(e){toast('Cấu hình không hợp lệ: '+e.message)}
}
$('save-local').addEventListener('click',saveSettings);$('load-local').addEventListener('click',loadSettings);
function cameraStatus(view){
 const label=view.focusIndex>=0?'Đang xem: '+(game?.state.teams?.[view.focusIndex]?.name||['Sao Vàng','Tia Chớp','Cầu Vồng','Sóng Xanh','Mặt Trời','Ngôi Sao'][view.focusIndex]||'Đảo '+(view.focusIndex+1)):'Toàn cảnh';
 const zoomed=Math.round(50/Math.max(1,view.distance)*100);
 $('camera-status').textContent=label+' · '+zoomed+'%'+(view.mode==='canvas-fallback'?' · 2D':' · 3D');
}
async function rebuildScene(teams){
 if(scene){scene.destroy();scene=null}
 const id=++activeSceneCount;
 $('camera-status').textContent='Đang khởi tạo quần đảo...';
 document.querySelectorAll('[data-camera]').forEach(button=>button.disabled=true);
 try{
  const result=await window.IslandScene3D.create($('world'),teams,{onViewChange:cameraStatus});
  if(id!==activeSceneCount){result.destroy();return}
  scene=result;
  cameraStatus(result.getView());
  document.querySelectorAll('[data-camera]').forEach(button=>button.disabled=false);
  if(result.fallback)toast('Thiết bị không tải được WebGL: quần đảo đang chạy chế độ 2D có điều khiển.');
 }catch(err){
  console.error('Scene startup',err);
  $('camera-status').textContent='Không tải được quần đảo';
  toast('Không khởi tạo được sân khấu: '+err.message);
 }
}
const islandButtons=document.querySelectorAll('[data-camera]');
function cameraAction(action){
 if(!scene){toast('Quần đảo đang tải. Vui lòng thử lại.');return}
 switch(action){
  case 'left':scene.rotate(42,0);break;
  case 'right':scene.rotate(-42,0);break;
  case 'up':scene.rotate(0,24);break;
  case 'down':scene.rotate(0,-24);break;
  case 'zoom-in':scene.zoom(.78);break;
  case 'zoom-out':scene.zoom(1.28);break;
  case 'reset':scene.resetView();break;
  case 'next':
  case 'prev':{
   const i=scene.getView().focusIndex;
   const count=game?.state.teams?.length||Number($('team-count').value)||4;
   const index=action==='next'?(i+1)%count:(i<0?count-1:(i+count-1)%count);
   scene.focusIsland(index);
   break;
  }
 }
}
islandButtons.forEach(button=>button.addEventListener('click',()=>cameraAction(button.dataset.camera)));
$('world').addEventListener('keydown',event=>{
 const actions={ArrowLeft:'left',ArrowRight:'right',ArrowUp:'up',ArrowDown:'down',Home:'reset',Equal:'zoom-in',NumpadAdd:'zoom-in',Minus:'zoom-out',NumpadSubtract:'zoom-out'};
 if(actions[event.code]){event.preventDefault();event.stopPropagation();cameraAction(actions[event.code])}
});
function teamCards(){
 if(!game)return;
 const g=game,active=g.state.phase==='finished'?-1:g.state.turn%g.state.teams.length;
 $('team-board').innerHTML=g.state.teams.map((team,i)=>{
  const sc=eng.score(team,g.state.config.rounds);
  return'<div class="team-card '+(i===active?'active':'')+'" data-focus-island="'+i+'" role="button" tabindex="0" title="Nhấn để xem gần đảo '+esc(team.name)+'"><div class="team-name"><span class="team-dot" style="background:'+team.color+'"></span>'+esc(team.name)+'</div>'+
  '<div class="team-score">'+sc.total+' <small style="font-size:10px;color:#bcd9e7">/100 điểm</small></div>'+
  '<div class="team-meta"><span>❤️ '+team.health+'/3</span><span>🪵 '+team.materials+'</span><span>🛡️ '+team.shield+'</span><span>✅ '+team.correct+'</span></div></div>'
 }).join('');
 $('standings').innerHTML=g.standings().map((t,i)=>{
  return'<div class="board-item"><span><b style="color:'+t.color+'">'+(i+1)+'. '+esc(t.name)+'</b><br><small style="color:#93bac9">Kiến thức '+t.score.knowledge+' · An toàn '+t.score.survival+' · Chiến thuật '+t.score.strategy+'</small></span><span class="result-number">'+t.score.total+'</span></div>';
 }).join('');
}
$('team-board').addEventListener('click',event=>{
 const card=event.target.closest('[data-focus-island]');
 if(card)scene?.focusIsland(Number(card.dataset.focusIsland));
});
$('team-board').addEventListener('keydown',event=>{
 if(event.key!=='Enter'&&event.key!==' ')return;
 const card=event.target.closest('[data-focus-island]');
 if(!card)return;
 event.preventDefault();scene?.focusIsland(Number(card.dataset.focusIsland));
});
function setBanner(text){$('banner').hidden=!text;$('banner').textContent=text||''}
function endPhaseText(phase){
 return{lobby:'🏝️ SẢNH CHUẨN BỊ',reading:'📖 ĐỌC CÂU HỎI',ready:'🎯 SẴN SÀNG TRẢ LỜI',answer:'⏱ ĐANG TRẢ LỜI',
  feedback:'✅ CÔNG BỐ ĐÁP ÁN',build:'🛠️ XÂY DỰNG',transition:'⛵ CHUYỂN LƯỢT',event:'🌪️ BIẾN CỐ',event_done:'🛡️ KẾT QUẢ BIẾN CỐ',finished:'🏆 TỔNG KẾT'}[phase]||phase;
}
function button(text,action,style=''){return'<button type="button" class="btn '+style+'" data-game-action="'+action+'">'+text+'</button>'}
function buildQuestion(){
 if(!game)return;
 const g=game,s=g.state,p=s.phase,q=g.currentQuestion(),team=g.activeTeam();
 const qc=$('question-content');
 if(p==='lobby'){qc.innerHTML='<p class="question-text">🌴 Chào mừng đến Đảo sinh tồn!</p><p style="color:#52728a">Các đội bắt đầu cùng 3 điểm an toàn. Trả lời đúng nhận hai vật liệu, sau đó lựa chọn phòng thủ.</p>';return}
 if(p==='finished'){
  const rank=g.standings();qc.innerHTML='<p class="question-text">🏆 Chúc mừng '+esc(rank[0].name)+'!</p><p>Điểm cao nhất: <b>'+rank[0].score.total+'/100</b>. Bảng xếp hạng có thể xuất thành tệp JSON.</p>'+
   '<div class="row">'+button('⬇ Xuất kết quả','export','primary')+button('↺ Trở lại soạn trò chơi','reset')+'</div>';return;
 }
 if(p==='event'||p==='event_done'){
  const e=s.lastEvent;
  let blocks=e?.outcomes?.map(o=>{
   const t=s.teams.find(x=>x.id===o.teamId);
   return'<div class="board-item" style="color:#173451;background:#fff"><span>'+esc(t?.name)+'</span><b>'+(o.protected?'🛡️ Đã phòng thủ':'❤️ '+o.health+'/3')+'</b></div>';
  }).join('')||'';
  qc.innerHTML='<div class="question-head"><span>🌪️ THỬ THÁCH MÔI TRƯỜNG</span><span>VÒNG '+g.currentRound()+'</span></div>'+
   '<p class="question-text">'+(e?.kind==='wave'?'🌊':e?.kind==='storm'?'🌪️':'💥')+' '+esc(e?.title||'Biến cố')+'</p>'+
   '<p style="color:#4b6474">'+(p==='event'?'Sóng và gió tác động như nhau lên tất cả các đội. Lá chắn có thể giúp bảo vệ đảo.':'Biến cố kết thúc. Kết quả phòng thủ đã được cập nhật.')+'</p>'+blocks;
  return;
 }
 if(!q)return;
 if(p==='transition'){qc.innerHTML='<p class="question-text">⛵ Chuẩn bị lượt chơi tiếp theo</p><p style="color:#557289">Vật liệu và điểm số của đội đã được cập nhật.</p>';return}
 const chosen=s.chosen;
 const answers=q.options.map((option,i)=>{
  const letter='ABCD'[i],correct=(p==='feedback'||p==='build')&&letter===q.correct;
  const wrong=(p==='feedback'||p==='build')&&letter===chosen&&chosen!==q.correct;
  return'<button type="button" class="answer '+(correct?'correct':wrong?'wrong':'')+'" data-answer="'+letter+'" '+(p==='answer'?'':'disabled')+'>'+
   '<span class="letter">'+letter+'</span><span>'+esc(option)+'</span>'+(correct?' ✓':wrong?' ✕':'')+'</button>';
 }).join('');
 const explanatory=(p==='feedback'||p==='build')?'<div class="status '+(chosen===q.correct?'good':'warn')+'" style="margin-top:13px;color:#174260;background:#ecfff5">'+(chosen===q.correct?'✅ Chính xác! +2 vật liệu.':'💡 Đáp án đúng: '+q.correct+'.')+' '+esc(q.explanation||'')+'</div>':'';
 let extra='';
 if(p==='build'){
  const actions=[['shield','🛡️ Dựng lá chắn','2 🪵',team.materials>=2],['repair','❤️ Sửa chữa đảo','3 🪵',team.materials>=3&&team.health<3],['bridge','🌉 Xây cầu','2 🪵',team.materials>=2],['save','📦 Tích trữ','0 🪵',true]];
  extra='<div class="kicker">CHỌN CÔNG TRÌNH TRÊN ĐẢO · CÒN '+team.materials+' 🪵</div><div class="build-options">'+actions.map(a=>'<button class="btn" type="button" data-build="'+a[0]+'" '+(!a[3]?'disabled':'')+'>'+a[1]+'<br><span style="font-size:.85em">'+a[2]+'</span></button>').join('')+'</div>';
 }
 qc.innerHTML='<div class="question-head"><span>CÂU '+(s.turn+1)+' / '+s.questions.length+' · '+esc(team.name)+'</span><span>'+esc(s.activeStudent?.name||'Thi đấu theo đội')+'</span></div>'+
  '<p class="question-text">'+esc(q.text)+'</p>'+ (q.imageUrl?'<img alt="Hình minh họa câu hỏi" src="'+esc(q.imageUrl)+'" style="max-width:100%;max-height:180px;object-fit:contain;border-radius:12px;margin-bottom:12px">':'')+
  '<div class="answers">'+answers+'</div>'+explanatory+extra+
  '<div class="phase-line"><span style="font-weight:800;color:#42718c">'+(p==='reading'?'📖 Hãy đọc và suy nghĩ – đồng hồ chưa chạy':p==='ready'?'🎯 Sẵn sàng – nhấn Bắt đầu trả lời':p==='answer'?'⌨️ Bấm A/B/C/D hoặc chạm đáp án':p==='feedback'?'📚 Xem đáp án và giải thích':'🛠️ Chọn cách sử dụng vật liệu')+'</span>'+
  '<span class="countdown">'+(p==='answer'?s.seconds+'s':'—')+'</span></div>';
 qc.querySelectorAll('[data-answer]').forEach(b=>b.addEventListener('click',()=>handleAnswer(b.dataset.answer)));
 qc.querySelectorAll('[data-build]').forEach(b=>b.addEventListener('click',()=>build(b.dataset.build)));
}
$('question-content').addEventListener('click',event=>{
 const target=event.target.closest('[data-game-action]');
 if(!target)return;
 if(target.dataset.gameAction==='export')exportResult();
 else if(target.dataset.gameAction==='reset')reset();
});
function setToolbar(){
 const p=game?.state.phase||'lobby';
 // Câu hỏi, đáp án, vật liệu và nút tiến trình chỉ tồn tại trong sân khấu 3D.
 $('question-panel').dataset.phase=p;
 $('world-wrap').dataset.phase=p;
 document.body.classList.toggle('island-gameplay',Boolean(game));
 const map={lobby:'▶ Bắt đầu khám phá',reading:'✓ Đã đọc xong',ready:'▶ Bắt đầu trả lời',
  answer:'⌛ Đang trả lời',feedback:'🛠️ Chọn công trình',build:'🛠️ Hãy chọn công trình',transition:'➡ Tiếp lượt',event:'🌊 Đang có biến cố',event_done:'⛵ Vòng tiếp theo',finished:'↺ Chơi trận mới'};
 $('main-action').textContent=map[p]||'Tiếp tục';
 $('main-action').disabled=voiceBusy||['answer','build','event'].includes(p)||game?.state.paused;
 $('pause-button').disabled=!game||['lobby','finished'].includes(p);
 $('pause-button').textContent=game?.state.paused?'▶ Tiếp tục':'⏸ Tạm dừng';
 $('skip-voice').hidden=!voiceBusy;
 $('skip-animation').hidden=p!=='event';
 $('export-result').disabled=!game||game.state.phase!=='finished';
 $('stage-phase').textContent=endPhaseText(p);
 $('stage-turn').textContent=game?('VÒNG '+Math.min(game.currentRound(),game.state.config.rounds)+'/'+game.state.config.rounds+' · CÂU '+Math.min(game.state.turn+1,game.state.questions.length)+'/'+game.state.questions.length):'4 đội · 2 vòng';
 $('stage-time').textContent=p==='answer'?game.state.seconds+' GIÂY':p==='reading'?'ĐỌC CÂU HỎI':p==='event'?'CẢNH BÁO':p==='finished'?'HOÀN THÀNH':'CHỜ';
 $('current-round').textContent=game?'Vòng '+Math.min(game.currentRound(),game.state.config.rounds)+'/'+game.state.config.rounds:'Vòng 0/2';
 if(game){
  const t=game.activeTeam();$('island-active').textContent=game.state.phase==='finished'?'🏆 ĐẢO CHIẾN THẮNG':'ĐẢO '+(t?.name||'SINH TỒN').toUpperCase();
  $('island-sub').textContent=game.state.activeStudent?.name?'🎯 Mời '+game.state.activeStudent.name:'Bảo vệ đảo bằng kiến thức';
 }
}
function render(){
 setToolbar();teamCards();buildQuestion();
 const phase=game?.state.phase;
 if(game&&scene)scene.setActive(game.state.turn%game.state.teams.length);
 if(!game?.state.paused){
  setBanner(voiceBusy?'🎙️ ĐANG ĐỌC LỜI DẪN / CÂU HỎI...':
   phase==='reading'?'📖 Đọc câu hỏi – chưa tính thời gian':
   phase==='ready'?'🎯 Sẵn sàng trả lời':
   phase==='event'?'⚠️ BIẾN CỐ ĐANG DIỄN RA':
   phase==='finished'?'🏆 CHÚC MỪNG '+game.standings()[0].name.toUpperCase()+'!':null);
 }else setBanner('⏸ ĐÃ TẠM DỪNG – giáo viên có thể giải thích đáp án');
 $('event-notice').textContent=phase==='event_done'&&game.state.lastEvent?'🛡️ '+game.state.lastEvent.title+' đã kết thúc. Điểm an toàn được cập nhật công bằng.':'🌊 Biến cố chung diễn ra sau khi tất cả đội hoàn thành lượt trong vòng.';
}
async function prepareVoice(){
 voice?.stop();voice=null;
 if(!game.state.config.voiceEnabled)return;
 if(!readyAuth){toast('Chưa đăng nhập: bỏ qua lời đọc MotionClass, vẫn có thể chơi.');return;}
 try{
  voice=motion.createVoice({sound:audio,onStatus:message=>{$('island-sub').textContent=message?.slice(0,60)||'Sẵn sàng'}});
  const v=await voice.load({scriptId:game.state.config.scriptId,classId:game.state.config.classId,questions:game.state.questions});
  toast('Giọng: '+v.script+' · '+v.wavs+' WAV câu hỏi');
 }catch(e){voice=null;toast('Không tải được kịch bản/giọng: '+e.message)}
}
async function speakQuestion(){
 if(!voice||!game||game.state.phase!=='reading')return;
 const token=++announcing;voiceBusy=true;render();
 try{await voice.speakQuestion(game.currentQuestion(),game.state.activeStudent,game.state.turn+1);}
 catch(e){toast('Giọng đọc: '+e.message)}
 finally{if(announcing===token){voiceBusy=false;if(game?.state.phase==='reading')game.ready();render()}}
}
async function announceResult(correct){
 if(!voice)return;
 voiceBusy=true;const token=++announcing;render();
 try{await voice.speakResult(game.currentQuestion(),correct,game.state.activeStudent?.name||'')}
 catch(e){toast('Nhận xét: '+e.message)}
 finally{if(announcing===token){voiceBusy=false;render()}}
}
function stopTick(){clearInterval(ticker);ticker=null;clearInterval(eventTicker);eventTicker=null}
function startTick(){
 clearInterval(ticker);ticker=setInterval(()=>{
  if(!game||game.state.paused)return;
  if(game.state.phase==='answer'){
   game.tick();
   if(game.state.phase==='feedback'){
    audio.tone(false);
    render();
    announceResult(false);
   }else{
    // Không thay DOM các nút A/B/C/D mỗi giây: học sinh đang nhấn không bị mất mục tiêu.
    const clock=document.querySelector('#question-content .countdown');
    if(clock)clock.textContent=game.state.seconds+'s';
    $('stage-time').textContent=game.state.seconds+' GIÂY';
   }
  }
 },1000);
}
async function startGame(){
 const c=config();
 if(c.questions.length<c.teamCount*c.rounds){toast('Cần ít nhất '+c.teamCount*c.rounds+' câu hỏi, hiện chọn '+c.questions.length+'.');tab('lesson');return}
 if(c.voiceEnabled&&!readyAuth)toast('Muốn phát giọng MotionClass, cần đăng nhập trước khi bắt đầu.');
 try{
  stopTick();voice?.stop();pose?.stop();pose=null;
  game=eng.create(c);
  document.body.classList.add('island-gameplay');
  $('setup-panel').style.opacity='.7';
  $('setup-panel').style.pointerEvents='none';
  await rebuildScene(game.state.teams);
  audio.playMusic();await prepareVoice();
  game.start();startTick();render();if(voice)await speakQuestion();
 }catch(e){
  if(!game?.state||game.state.phase==='lobby'){
   game=null;
   document.body.classList.remove('island-gameplay');
   $('setup-panel').style.pointerEvents='auto';
   $('setup-panel').style.opacity='1';
  }
  info('⚠ '+e.message);toast(e.message);
 }
}
async function nextTurn(){
 if(!game)return;
 game.next();
 if(game.state.phase==='event'){await startEvent();return}
 if(game.state.phase==='finished'){finish();return}
 if(game.state.phase==='reading'){render();if(voice)await speakQuestion();}
 else render();
}
function handleAnswer(letter){
 if(!game||game.state.paused||voiceBusy||game.state.phase!=='answer')return;
 if(!game.choose(letter))return;
 audio.tone(letter===game.currentQuestion().correct);
 pose?.stop();$('posebox').hidden=true;
 render();announceResult(letter===game.currentQuestion().correct);
}
function build(action){if(!game||game.state.paused||voiceBusy)return;if(!game.build(action)){toast('Không đủ vật liệu hoặc đảo đã được phục hồi tối đa.');return}render();}
async function startEvent(){
 if(!game||game.state.phase!=='event')return;
 const e=game.state.lastEvent;
 scene?.setEvent(e.kind);
 render();
 if(voice)voice.speakEvent(e.kind).catch(()=>{});
 let elapsed=0;clearInterval(eventTicker);
 eventTicker=setInterval(()=>{
  if(!game||game.state.paused)return;
  elapsed+=100;
  if(elapsed>=3300)resolveEvent();
 },100);
}
function resolveEvent(){
 clearInterval(eventTicker);eventTicker=null;
 if(!game||game.state.phase!=='event')return;
 game.resolveEvent();scene?.setEvent(null);
 game.state.teams.forEach((t,i)=>scene?.setHealth(i,t.health));
 render();
}
function finish(){
 scene?.setEvent(null);
 voice?.stop();voiceBusy=false;
 $('setup-panel').style.pointerEvents='auto';$('setup-panel').style.opacity='1';
 const standings=game.standings();
 const record={date:new Date().toISOString(),rounds:game.state.config.rounds,questions:game.state.questions.length,
  rank:standings.map(t=>({team:t.name,score:t.score,correct:t.correct}))};
 try{const key='motionclass:island-preview-history',history=JSON.parse(localStorage.getItem(key)||'[]');history.unshift(record);
  localStorage.setItem(key,JSON.stringify(history.slice(0,20)))}catch(_){}
 render();
 setBanner('🏆 CHÚC MỪNG '+standings[0].name.toUpperCase()+' · '+standings[0].score.total+'/100 ĐIỂM');
 // Không mở modal toàn trang: trao giải và các nút kết quả nằm ngay trong quần đảo.

}
async function startAnswer(){
 if(!game||game.state.phase!=='ready')return;
 game.beginAnswer();render();
 if(config().control==='pose'){
  $('posebox').hidden=false;
  const video=$('posevideo'),canvas=$('posecanvas');
  pose=window.IslandPoseControl.create({video,canvas,onState:s=>{$('pose-status').textContent=s},
   onAnswer:letter=>{if(game?.state.phase==='answer')handleAnswer(letter)}});
  $('posecanvas').onclick=e=>pose?.lockAtClick(e);
  try{await pose.start()}catch(err){toast('Camera chưa sẵn sàng: '+err.message+'. Có thể dùng chuột hoặc bàn phím.');$('pose-status').textContent='⚠ '+err.message}
 }
}
async function mainAction(){
 if(!game||game.state.phase==='finished')return startGame();
 if(game.state.paused||voiceBusy)return;
 switch(game.state.phase){
 case 'reading':game.ready();render();break;
 case 'ready':await startAnswer();break;
 case 'feedback':game.state.phase='build';render();break;
 case 'transition':await nextTurn();break;
 case 'event_done':await nextTurn();break;
 }
}
$('main-action').addEventListener('click',mainAction);
$('pause-button').addEventListener('click',()=>{
 if(!game)return;const paused=game.pause();
 if(paused){voice?.pause();audio.pauseMusic()}else{voice?.resume();audio.playMusic()}
 render();
});
$('skip-voice').addEventListener('click',()=>{
 announcing++;voice?.stop();voiceBusy=false;
 if(game?.state.phase==='reading')game.ready();
 render();
});
$('skip-animation').addEventListener('click',resolveEvent);
function reset(){
 if(!confirm('Trở về Soạn trò chơi? Trận đang diễn ra sẽ không được lưu thành kết quả.'))return;
 stopTick();voice?.stop();voice=null;pose?.stop();pose=null;$('posebox').hidden=true;
 audio.pauseMusic();game=null;voiceBusy=false;announcing++;
 document.body.classList.remove('island-gameplay');
 $('setup-panel').style.opacity='1';$('setup-panel').style.pointerEvents='auto';
 $('team-board').innerHTML='';$('question-content').innerHTML='<p class="question-text">Sẵn sàng khám phá đảo sinh tồn?</p><p style="color:#52728a">Chọn cấu hình bên phải, sau đó nhấn Bắt đầu khám phá.</p>';
 $('standings').innerHTML='<div class="subtext">Điểm sẽ xuất hiện sau khi bắt đầu.</div>';
 rebuildScene(eng.allocateTeams([],Number($('team-count').value)));render();
}
$('reset-game').addEventListener('click',reset);
document.addEventListener('keydown',e=>{
 if(e.target.matches('input,select,textarea')||$('modal').hidden===false)return;
 if(game&&game.state.phase==='answer'&&!game.state.paused&&'abcdABCD'.includes(e.key)){
  e.preventDefault();handleAnswer(e.key.toUpperCase());
 }
 if(e.key===' '&&game){e.preventDefault();$('pause-button').click()}
});
$('export-result').addEventListener('click',exportResult);
function exportResult(){
 if(!game||game.state.phase!=='finished')return toast('Chỉ xuất kết quả khi trận đấu đã kết thúc.');
 const payload=game.serialize();payload.exportedAt=new Date().toISOString();
 const b=new Blob([JSON.stringify(payload,null,2)],{type:'application/json;charset=utf-8'});
 const url=URL.createObjectURL(b),link=document.createElement('a');link.href=url;link.download='dao-sinh-ton-ket-qua.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),500);
}
$('history-button').addEventListener('click',()=>{
 const list=JSON.parse(localStorage.getItem('motionclass:island-preview-history')||'[]');
 modal('🕘 Lịch sử chơi thử',
  '<p>Chỉ lưu trên trình duyệt này; không ghi dữ liệu bảng điểm lên Supabase.</p>'+
  (list.length?list.map(x=>'<div class="board-item"><span>'+esc(new Date(x.date).toLocaleString('vi-VN'))+' · '+x.rounds+' vòng</span><b>'+esc(x.rank[0]?.team||'')+' '+(x.rank[0]?.score.total||0)+'đ</b></div>').join(''):'<div class="status">Chưa có trận đã hoàn thành.</div>'),
  '<button class="btn" id="close-history">Đóng</button>');
 $('close-history').addEventListener('click',closeModal);
});
function init(){
 session().then(u=>{if(u)connect().catch(e=>info(e.message))});
 markBank();rebuildScene(eng.allocateTeams([],4));render();
 window.addEventListener('beforeunload',()=>{scene?.destroy();voice?.stop();pose?.stop();stopTick();audio.stop()});
}
init();
})();
