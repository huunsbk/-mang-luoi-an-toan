import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const code=fs.readFileSync('island-survival/engine.js','utf8');
const ctx={window:{},console,Math,Date};
vm.createContext(ctx);vm.runInContext(code,ctx,{filename:'engine.js'});
const E=ctx.window.IslandEngine;
assert(E,'Engine chưa được định nghĩa.');
assert.equal(E.demoQuestions.length,24);
const players=Array.from({length:35},(_,i)=>({id:'student-'+i,name:'Học sinh '+(i+1)}));
const G=E.create({teamCount:4,rounds:2,timeLimit:15,students:players,questions:E.demoQuestions,seed:123});
assert.equal(G.state.teams.length,4);
assert.equal(G.state.questions.length,8);
assert.equal(new Set(G.state.questions.map(q=>q.id)).size,8,'Không được lặp câu trong cùng trận.');
assert.equal(G.state.teams.reduce((n,t)=>n+t.students.length,0),35);
assert.equal(Math.max(...G.state.teams.map(t=>t.students.length))-Math.min(...G.state.teams.map(t=>t.students.length)),1);
assert(G.start());
assert.equal(G.state.phase,'reading');
assert(!G.choose('A'),'Không chấm khi học sinh còn đọc câu hỏi.');
assert(G.ready());assert.equal(G.state.phase,'ready');
assert(!G.choose('A'),'Không chấm khi chưa bắt đầu trả lời.');
assert(G.beginAnswer());
const seconds=G.state.seconds;
G.pause();G.tick();assert.equal(G.state.seconds,seconds,'Tạm dừng phải đóng băng bộ đếm.');G.pause();
for(let i=0;i<8;i++){
 if(i>0){assert.equal(G.state.phase,'reading');assert(G.ready());assert(G.beginAnswer());}
 assert.equal(G.state.phase,'answer');
 const q=G.currentQuestion();
 const team=G.activeTeam();
 if(i%2===0){assert(G.choose(q.correct));assert.equal(team.materials,2);}
 else assert(G.choose('Z')===true,'Chọn không hợp lệ được ghi nhận như bỏ qua');
 assert.equal(G.state.phase,'feedback');
 if(i%2===0)assert(G.build('shield'));
 else assert(G.build('save'));
 assert.equal(G.state.phase,'transition');
 assert(G.next());
 if((i+1)%4===0){
   assert.equal(G.state.phase,'event');
   const h=G.state.teams.map(t=>t.health);
   assert(G.resolveEvent());
   assert.equal(G.state.phase,'event_done');
   assert(!G.resolveEvent(),'Biến cố không được áp dụng hai lần');
   G.state.teams.forEach((t,k)=>assert(t.health<=h[k]));
   assert(G.next());
 }
}
assert.equal(G.state.phase,'finished','Trận phải kết thúc khi đủ lượt, không mắc kẹt.');
assert.equal(G.state.history.filter(x=>x.questionId).length,8);
assert.equal(G.standings().length,4);
for(const t of G.standings()){
 assert(t.score.total>=0&&t.score.total<=100);
 assert(t.score.knowledge<=70&&t.score.survival<=20&&t.score.strategy<=10);
}
const staticHtml=fs.readFileSync('island-survival/index.html','utf8');
const required=['id="world"','id="main-action"','id="voice-enabled"','id="control"','id="class-select"','id="bank-list"','data-tab="team"','island-survival/scene3d.js','island-survival/pose-control.js'];
required.forEach(x=>assert(staticHtml.includes(x),'Thiếu giao diện '+x));
const src3D=fs.readFileSync('island-survival/scene3d.js','utf8');
assert(src3D.includes('new WebGLRenderer('),'Phải có dựng 3D WebGL thật.');
assert(src3D.includes("three.module.js"),'Phải có thư viện Three.js.');
assert(src3D.includes('createFallback'),'Phải có cơ chế giảm cấp nếu không hỗ trợ WebGL.');
const route=fs.readFileSync('server.py','utf8');
for(const p of ['island-survival/index.html','island-survival/app.js','island-survival/scene3d.js'])assert(route.includes(p),'Thiếu server route '+p);
console.log('ISLAND_ENGINE_QA_PASS · 8 turns · 2 fair hazards · no duplicate questions · 3D routes present');
