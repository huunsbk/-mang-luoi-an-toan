/* Optional camera/A-B-C-D pose controller. No facial identification. */
(function(global){
'use strict';
function create({video,canvas,onAnswer=()=>{},onState=()=>{}}){
 let landmarker=null,stream=null,active=false,raf=0,selectedRegion=null,detected=null,heldAt=0,lastSubmitted=0;
 const m={RAISE_LEFT:'A',RAISE_RIGHT:'B',BOTH_UP:'C',CROSS_ARMS:'D'};
 const cx=canvas?.getContext('2d');
 function scorePose(points){
  if(!points?.length)return null;
  const p=i=>points[i],visible=i=>!!p(i)&&((p(i).visibility??1)>.35);
  if(![11,12,13,14,15,16].every(visible))return null;
  const leftUp=p(15).y<p(11).y-.06,rightUp=p(16).y<p(12).y-.06;
  const cross=Math.hypot(p(15).x-p(12).x,p(15).y-p(12).y)<.26&&Math.hypot(p(16).x-p(11).x,p(16).y-p(11).y)<.26;
  if(cross)return m.CROSS_ARMS;
  if(leftUp&&rightUp)return m.BOTH_UP;
  if(leftUp)return m.RAISE_LEFT;
  if(rightUp)return m.RAISE_RIGHT;
  return null; // neutral/no pose cannot submit.
 }
 function box(points){
  const ps=[11,12,23,24].map(i=>points[i]).filter(p=>p&&((p.visibility??1)>.2));
  if(ps.length<2)return null;
  const x=ps.reduce((sum,p)=>sum+p.x,0)/ps.length;
  const y=ps.reduce((sum,p)=>sum+p.y,0)/ps.length;
  return{x,y};
 }
 function chooseRegion(x,y){
  selectedRegion={x:Math.max(0,x-.22),y:Math.max(0,y-.33),w:.44,h:.66};
  selectedRegion.x=Math.min(1-selectedRegion.w,selectedRegion.x);
  selectedRegion.y=Math.min(1-selectedRegion.h,selectedRegion.y);
  onState('🔒 Đã khóa vùng trả lời. Học sinh có thể bước ra và quay lại.');
 }
 function inside(p){return p&&selectedRegion&&p.x>=selectedRegion.x&&p.x<=selectedRegion.x+selectedRegion.w&&p.y>=selectedRegion.y&&p.y<=selectedRegion.y+selectedRegion.h}
 function draw(poses){
  if(!cx||!video)return;
  const width=video.clientWidth,height=video.clientHeight,d=global.devicePixelRatio||1;
  if(canvas.width!==Math.round(width*d)||canvas.height!==Math.round(height*d)){canvas.width=width*d;canvas.height=height*d}
  cx.clearRect(0,0,canvas.width,canvas.height);
  cx.strokeStyle='#faca55';cx.lineWidth=4*d;
  if(selectedRegion){cx.strokeRect(selectedRegion.x*canvas.width,selectedRegion.y*canvas.height,selectedRegion.w*canvas.width,selectedRegion.h*canvas.height);}
  for(const p of poses){
   const center=box(p);if(!center)continue;const valid=inside(center);
   cx.beginPath();cx.strokeStyle=valid?'#55eb9b':'#fff6a1';cx.arc(center.x*canvas.width,center.y*canvas.height,13*d,0,Math.PI*2);cx.stroke();
  }
 }
 async function process(){
  if(!active||!landmarker||!video)return;
  try{
   if(video.readyState>=2){
    const result=landmarker.detectForVideo(video,performance.now());
    const poses=result.landmarks||[];
    if(!selectedRegion&&poses.length){const p=box(poses[0]);if(p)chooseRegion(p.x,p.y)}
    const person=poses.find(p=>inside(box(p)));
    const answer=person?scorePose(person):null;
    if(answer){
     if(answer!==detected){detected=answer;heldAt=performance.now()}
     if(performance.now()-heldAt>750&&performance.now()-lastSubmitted>1800){lastSubmitted=performance.now();onAnswer(answer);}
    }else{detected=null;heldAt=0;}
    onState(person?answer?'Nhận diện tư thế '+answer+' · giữ 0,75 giây':'🟢 Đã có học sinh trong vùng trả lời':'⏳ Chờ học sinh vào vùng trả lời');
    draw(poses);
   }
  }catch(e){onState('⚠ Lỗi nhận diện: '+e.message)}
  if(active)raf=requestAnimationFrame(process);
 }
 async function start(){
  if(active)return;
  if(!global.isSecureContext)throw Error('Camera chỉ hoạt động với HTTPS.');
  const mod=await import('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.22/+esm');
  const fileset=await mod.FilesetResolver.forVisionTasks('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.22/wasm');
  landmarker=await mod.PoseLandmarker.createFromOptions(fileset,{
   baseOptions:{modelAssetPath:'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task',delegate:'GPU'},
   runningMode:'VIDEO',numPoses:4,minPoseDetectionConfidence:.45,minPosePresenceConfidence:.45,minTrackingConfidence:.45
  }).catch(async()=>mod.PoseLandmarker.createFromOptions(fileset,{
   baseOptions:{modelAssetPath:'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task',delegate:'CPU'},
   runningMode:'VIDEO',numPoses:4
  }));
  stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:'user',width:{ideal:640},height:{ideal:480}},audio:false});
  video.srcObject=stream;await video.play();active=true;onState('Camera sẵn sàng. Chọn người đứng ở vùng trả lời.');
  raf=requestAnimationFrame(process);
 }
 function lockAtClick(e){
  if(!video?.clientWidth)return;const r=canvas.getBoundingClientRect();
  const px=(e.clientX-r.left)/r.width,py=(e.clientY-r.top)/r.height;
  // Video is mirrored by CSS, so translate user click to raw landmarks X.
  chooseRegion(1-px,py);
 }
 function stop(){active=false;cancelAnimationFrame(raf);stream?.getTracks().forEach(t=>t.stop());stream=null;
  try{landmarker?.close()}catch(_){}landmarker=null;selectedRegion=null;detected=null;if(video)video.srcObject=null;}
 return{start,stop,lockAtClick,get active(){return active}};
}
global.IslandPoseControl={create};
})(window);
