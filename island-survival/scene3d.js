/* True WebGL 3D island world. Uses Three.js ES module, degrades to 2D canvas when unavailable. */
(function(global){
'use strict';
function createFallback(canvas,teams){
 global.__ISLAND_3D_MODE='canvas-fallback';
 const ctx=canvas.getContext('2d');let raf=0,active=0,event=null,running=true;
 function draw(){
  if(!running)return;
  const w=canvas.clientWidth||800,h=canvas.clientHeight||420,d=global.devicePixelRatio||1;
  if(canvas.width!==Math.round(w*d)||canvas.height!==Math.round(h*d)){canvas.width=Math.round(w*d);canvas.height=Math.round(h*d)}
  ctx.setTransform(d,0,0,d,0,0);
  const bg=ctx.createLinearGradient(0,0,0,h);bg.addColorStop(0,'#80ddf2');bg.addColorStop(1,'#087b9a');
  ctx.fillStyle=bg;ctx.fillRect(0,0,w,h);const t=performance.now()*.0008;
  for(let i=0;i<teams.length;i++){
   const a=(i/teams.length)*Math.PI*2-Math.PI/2;
   const x=w/2+Math.cos(a)*w*.31,y=h*.49+Math.sin(a)*h*.26;
   const r=Math.min(w/teams.length*.64,85);ctx.save();ctx.translate(x,y+Math.sin(t+i)*2);
   ctx.fillStyle='#1a5b49';ctx.beginPath();ctx.ellipse(0,15,r*.9,r*.45,0,0,Math.PI*2);ctx.fill();
   ctx.fillStyle='#e6cf8a';ctx.beginPath();ctx.ellipse(0,2,r,r*.5,0,0,Math.PI*2);ctx.fill();
   ctx.fillStyle='#55ba68';ctx.beginPath();ctx.ellipse(0,-3,r*.88,r*.42,0,0,Math.PI*2);ctx.fill();
   ctx.fillStyle=teams[i].color;ctx.fillRect(-5,-42,10,37);ctx.beginPath();ctx.moveTo(5,-43);ctx.lineTo(30,-34);ctx.lineTo(5,-25);ctx.fill();
   ctx.fillStyle='#fff';ctx.font='700 13px sans-serif';ctx.textAlign='center';ctx.fillText(teams[i].name,0,45);
   if(i===active){ctx.strokeStyle='#fff68c';ctx.lineWidth=4;ctx.beginPath();ctx.ellipse(0,-3,r+8,r*.5+7,0,0,Math.PI*2);ctx.stroke();}
   ctx.restore();
  }
  if(event){ctx.fillStyle='rgba(5,22,53,.18)';ctx.fillRect(0,0,w,h);ctx.font='72px sans-serif';ctx.textAlign='center';ctx.fillText(event==='wave'?'🌊':event==='storm'?'🌪️':'💥',w/2,h*.3)}
  raf=requestAnimationFrame(draw);
 }draw();
 return{setActive(i){active=i},setEvent(kind){event=kind||null},setTeams(){},setHealth(){},destroy(){running=false;cancelAnimationFrame(raf)},fallback:true};
}
async function create(canvas,teams,options={}){
 let T;
 try{T=await import('https://cdn.jsdelivr.net/npm/three@0.160.1/build/three.module.js')}catch(err){console.warn('Three.js unavailable, showing canvas fallback',err);return createFallback(canvas,teams)}
 if(!canvas||!global.WebGLRenderingContext)return createFallback(canvas,teams);
 const {Scene,Color,FogExp2,PerspectiveCamera,WebGLRenderer,AmbientLight,HemisphereLight,DirectionalLight,
  Mesh,MeshStandardMaterial,MeshBasicMaterial,SphereGeometry,CylinderGeometry,ConeGeometry,BoxGeometry,
  TorusGeometry,Group,Vector3,BufferGeometry,Float32BufferAttribute,Points,PointsMaterial,DoubleSide,MathUtils}=T;
 let renderer;
 try{renderer=new WebGLRenderer({canvas,antialias:true,alpha:false,powerPreference:'high-performance'})}catch(err){return createFallback(canvas,teams)}
 global.__ISLAND_3D_MODE='webgl-three';
 const scene=new Scene();scene.background=new Color('#98e8f8');scene.fog=new FogExp2('#98e8f8',.011);
 const camera=new PerspectiveCamera(43,1,.1,250);camera.position.set(0,31,48);camera.lookAt(0,0,0);
 renderer.setPixelRatio(Math.min(global.devicePixelRatio||1,1.7));
 renderer.shadowMap.enabled=true;renderer.shadowMap.type=T.PCFSoftShadowMap;
 renderer.outputColorSpace=T.SRGBColorSpace;
 renderer.toneMapping=T.ACESFilmicToneMapping;renderer.toneMappingExposure=1.4;
 scene.add(new HemisphereLight('#efffff','#477c7b',2.3));
 const sun=new DirectionalLight('#fff5d7',2.7);sun.position.set(-24,48,24);sun.castShadow=true;
 sun.shadow.mapSize.set(1024,1024);sun.shadow.camera.left=-48;sun.shadow.camera.right=48;sun.shadow.camera.top=48;sun.shadow.camera.bottom=-48;
 scene.add(sun);
 const sea=new Mesh(new CylinderGeometry(64,64,1.6,96),new MeshStandardMaterial({color:'#169db9',roughness:.34,metalness:.11,transparent:true,opacity:.88}));
 sea.position.y=-4;sea.receiveShadow=true;scene.add(sea);
 const seaRings=[];
 for(let r=7;r<=47;r+=8){const ring=new Mesh(new TorusGeometry(r,.10,5,100),new MeshBasicMaterial({color:'#e1ffff',transparent:true,opacity:.13}));
 ring.rotation.x=Math.PI/2;ring.position.y=-3.04;scene.add(ring);seaRings.push(ring)}
 const far=new Mesh(new CylinderGeometry(66,66,.1,96),new MeshBasicMaterial({color:'#4bc4d6'}));far.position.y=-5.15;scene.add(far);
 const dirt=new MeshStandardMaterial({color:'#825b3c',roughness:1}),sand=new MeshStandardMaterial({color:'#f6d59a',roughness:1}),
 grass=new MeshStandardMaterial({color:'#54b868',roughness:1}),grass2=new MeshStandardMaterial({color:'#82d379',roughness:1}),
 wood=new MeshStandardMaterial({color:'#97633e',roughness:.95}),woodTop=new MeshStandardMaterial({color:'#d8a16a',roughness:.91}),
 leaf=new MeshStandardMaterial({color:'#1a9156',roughness:.95}),leaf2=new MeshStandardMaterial({color:'#36af6b',roughness:.95}),
 roof=new MeshStandardMaterial({color:'#c96444',roughness:.91}),rock=new MeshStandardMaterial({color:'#aaa5a1',roughness:1});
 const flags=[];
 const islands=[],positions=[],halos=[];
 const count=teams.length;
 function mesh(geo,mat,parent,x=0,y=0,z=0){const a=new Mesh(geo,mat);a.position.set(x,y,z);a.castShadow=true;a.receiveShadow=true;parent.add(a);return a}
 function palm(parent,x,z,h=3.4){
   const trunk=mesh(new CylinderGeometry(.17,.26,h,8),wood,parent,x,h/2+.35,z);trunk.rotation.z=.08;
   const crown=new Group();crown.position.set(x,h+.36,z);parent.add(crown);
   for(let k=0;k<6;k++){
    const a=Math.PI*2*k/6;
    const frond=mesh(new ConeGeometry(.72,3.45,5),k%2?leaf:leaf2,crown,Math.cos(a)*1.3,-.33,Math.sin(a)*1.3);
    frond.rotation.z=-Math.PI/2;frond.rotation.y=a;
   }
   mesh(new SphereGeometry(.36,8,6),leaf2,crown,0,0,0);
   return crown;
 }
 function hut(parent,x,z) {
  const g=new Group();g.position.set(x,.3,z);parent.add(g);
  mesh(new BoxGeometry(2.4,1.8,2),woodTop,g,0,.95,0);
  const r=mesh(new ConeGeometry(2.05,1.85,4),roof,g,0,2.75,0);r.rotation.y=Math.PI/4;
  mesh(new BoxGeometry(.65,1.2,.15),wood,g,0,.6,1.04);
  mesh(new BoxGeometry(.46,.55,.15),new MeshStandardMaterial({color:'#5faecc',emissive:'#124d6a',emissiveIntensity:.3}),g,-.78,1.3,1.04);
 }
 function island(i) {
  const a=count===2?Math.PI*i:((Math.PI*2*i/count)-Math.PI/2);
  const radius=count<=4?18:20.5;
  const x=Math.cos(a)*radius,z=Math.sin(a)*radius*.75;
  positions.push([x,z]);
  const g=new Group();g.position.set(x,0,z);scene.add(g);
  mesh(new ConeGeometry(6.55,7.6,9),dirt,g,0,-2.8,0).rotation.y=i*.41;
  mesh(new CylinderGeometry(6.2,6.7,.85,10),sand,g,0,.18,0);
  mesh(new CylinderGeometry(5.45,5.94,.5,10),grass,g,0,.72,0);
  const outer=mesh(new TorusGeometry(6.4,.12,7,70),new MeshBasicMaterial({color:teams[i].color,transparent:true,opacity:.95}),g,0,.62,0);
  outer.rotation.x=Math.PI/2;
  palm(g,-3,-1.6,3.2);palm(g,3.0,-1.9,2.7);
  hut(g,-.4,.4);
  for(let k=0;k<5;k++)mesh(new DodecahedronGeometry(.3+.13*(k%2),0),rock,g,Math.sin(k*2.2)*4.3,1.0,Math.cos(k*2.8)*3.6);
  const pole=mesh(new CylinderGeometry(.08,.10,4.1,7),wood,g,3.55,2.7,2.5);
  const flagMat=new MeshStandardMaterial({color:teams[i].color,roughness:.95,side:DoubleSide});
  const flag=mesh(new BoxGeometry(1.65,.92,.07),flagMat,g,4.37,4.27,2.5);
  flags.push(flag);
  const figure=new Group();figure.position.set(-3.1,1.1,1.45);g.add(figure);
  mesh(new CylinderGeometry(.40,.47,1.05,11),new MeshStandardMaterial({color:teams[i].color}),figure,0,.6,0);
  mesh(new SphereGeometry(.38,12,10),new MeshStandardMaterial({color:'#f6c8a2'}),figure,0,1.42,0);
  mesh(new ConeGeometry(.52,.45,8),new MeshStandardMaterial({color:teams[i].color}),figure,0,1.86,0);
  const halo=mesh(new TorusGeometry(6.8,.23,7,64),new MeshBasicMaterial({color:'#fff6a9',transparent:true,opacity:.0}),g,0,.88,0);
  halo.rotation.x=Math.PI/2;halos.push(halo);
  islands.push({g,figure,grass:outer});
 }
 // Geometry helper missing in some modules? Destructure directly here.
 const DodecahedronGeometry=T.DodecahedronGeometry;
 for(let i=0;i<count;i++)island(i);
 // Animated bridges connect each island to the central gathering platform.
 const center=new Group();scene.add(center);
 mesh(new CylinderGeometry(4.6,5,.8,12),sand,center,0,-.85,0);
 mesh(new CylinderGeometry(4,4.35,.52,12),grass2,center,0,-.2,0);
 const fire=mesh(new ConeGeometry(.67,1.9,7),new MeshStandardMaterial({color:'#f6b74b',emissive:'#f17c28',emissiveIntensity:.9}),center,0,1.05,0);
 const bridges=[];
 for(let i=0;i<count;i++){
  const [x,z]=positions[i],len=Math.hypot(x,z),dirx=x/len,dirz=z/len;
  const bridge=new Group();bridge.position.set(dirx*(len+4)/2,.58,dirz*(len+4)/2);bridge.rotation.y=Math.atan2(-dirz,dirx);scene.add(bridge);
  const plankCount=Math.max(5,Math.floor((len-9)/1.1));
  const bs=[];
  for(let p=0;p<plankCount;p++){
   let xpos=(p-(plankCount-1)/2)*1.12;
   const plank=mesh(new BoxGeometry(.96,.25,2.02),woodTop,bridge,xpos,0,0);bs.push(plank);
  }
  const ropeMat=new MeshStandardMaterial({color:'#ccaa6a'});
  for(const side of [-1,1])mesh(new BoxGeometry(plankCount*1.12,.05,.05),ropeMat,bridge,0,.76,side*1.02);
  bridges.push({group:bridge,parts:bs,index:i});
 }
 const cloudMat=new MeshStandardMaterial({color:'#e1edf2',roughness:1,transparent:true,opacity:.72});
 const clouds=[];
 for(let k=0;k<8;k++){
  const c=new Group();const a=k*2.4;const x=Math.sin(a)*28,z=Math.cos(a)*25;
  c.position.set(x,13+(k%3)*2,z);scene.add(c);
  for(let j=0;j<4;j++)mesh(new SphereGeometry(1.6+j*.15,9,6),cloudMat,c,j*1.1-1.9,Math.sin(j)*.35,0);
  clouds.push(c);
 }
 // Quần đảo sử dụng camera quỹ đạo độc lập với đội đang thi đấu.
 // Giáo viên luôn có quyền quan sát bất kỳ đảo nào mà không thay đổi lượt chơi.
 const DEFAULT_YAW=-Math.PI*.49,DEFAULT_PITCH=.62,DEFAULT_DISTANCE=count>4?59:50;
 const view={yaw:DEFAULT_YAW,pitch:DEFAULT_PITCH,distance:DEFAULT_DISTANCE,targetX:0,targetZ:0,focusIndex:-1,mode:'webgl-three'};
 const controlsChanged=()=>{
   global.__ISLAND_VIEW={...view};
   options.onViewChange?.({...view});
 };
 const activePointers=new Map();
 let dragDistance=0,active=0,event=null,hasRendered=false,running=true;
 const raycaster=new T.Raycaster(),screenPoint=new T.Vector2();
 function rotate(dx=0,dy=0){
   view.yaw-=Number(dx||0)*.009;
   view.pitch=clamp(view.pitch+Number(dy||0)*.008,.27,1.34);
   controlsChanged();
 }
 function zoom(factor=1){
   const k=Number(factor);
   if(!Number.isFinite(k)||k<=0)return;
   view.distance=clamp(view.distance*k,13,95);
   controlsChanged();
 }
 function resetView(){
   Object.assign(view,{yaw:DEFAULT_YAW,pitch:DEFAULT_PITCH,distance:DEFAULT_DISTANCE,targetX:0,targetZ:0,focusIndex:-1});
   controlsChanged();
 }
 function focusIsland(index){
   const i=Number(index);
   if(!Number.isInteger(i)||i<0||i>=positions.length)return false;
   const [x,z]=positions[i];
   view.targetX=x;
   view.targetZ=z;
   view.distance=25;
   view.focusIndex=i;
   controlsChanged();
   return true;
 }
 function selectAt(clientX,clientY){
   const rect=canvas.getBoundingClientRect();
   if(rect.width<=0||rect.height<=0)return false;
   screenPoint.set((clientX-rect.left)/rect.width*2-1,-((clientY-rect.top)/rect.height*2-1));
   raycaster.setFromCamera(screenPoint,camera);
   for(const hit of raycaster.intersectObjects(islands.map(item=>item.g),true)){
     let parent=hit.object;
     while(parent){
       const index=islands.findIndex(item=>item.g===parent);
       if(index>=0)return focusIsland(index);
       parent=parent.parent;
     }
   }
   return false;
 }
 let animateId=0;
 const rayBg=new Color('#98e8f8');
 let lastW=0,lastH=0,t0=performance.now();
 function resize() {
  const w=Math.max(260,canvas.clientWidth||canvas.parentElement?.clientWidth||800),h=Math.max(180,canvas.clientHeight||canvas.parentElement?.clientHeight||450);
  if(w===lastW&&h===lastH)return;lastW=w;lastH=h;camera.aspect=w/h;camera.updateProjectionMatrix();renderer.setSize(w,h,false);
 }
 function render(now){
  if(!running)return;
  resize();
  const time=(now-t0)*.001;
  for(let i=0;i<islands.length;i++){
   const it=islands[i];it.figure.rotation.y=Math.sin(time*1.5+i)*.1;
   it.figure.position.y=1.1+Math.sin(time*2+i*.7)*.12;
   halos[i].material.opacity=i===active?.8:.03;
   halos[i].scale.setScalar(1+Math.sin(time*2)*.025);
  }
  fire.scale.y=1+Math.sin(time*5)*.22;
  for(let i=0;i<clouds.length;i++)clouds[i].position.x+=.0025*(1+i%3);
  seaRings.forEach((ring,i)=>{ring.material.opacity=.09+.04*Math.sin(time*(.6+i*.12));ring.scale.setScalar(1+.009*Math.sin(time*.7+i))});
  if(event==='storm'||event==='wave'){
   scene.fog.color.set('#627d91');scene.background.set('#789bad');sun.intensity=1.2;
   for(let k=0;k<bridges.length;k++){const b=bridges[k];b.group.rotation.z=Math.sin(time*8+k)*.017}
  }else if(event==='quake'){
   scene.background.copy(rayBg);scene.fog.color.copy(rayBg);
   islands.forEach((isle,i)=>{isle.g.rotation.z=Math.sin(time*24+i)*.03});
  }else{
   scene.background.copy(rayBg);scene.fog.color.copy(rayBg);sun.intensity=2.7;
   bridges.forEach(b=>{b.group.rotation.z=0});islands.forEach(isle=>{isle.g.rotation.z=0});
  }
  // Orbit camera: 360° ngang, góc nghiêng có giới hạn, zoom giữ tâm quan sát.
  const h=view.distance*Math.sin(view.pitch);
  const planar=view.distance*Math.cos(view.pitch);
  camera.position.set(view.targetX+Math.sin(view.yaw)*planar,h,view.targetZ+Math.cos(view.yaw)*planar);
  camera.lookAt(view.targetX,0,view.targetZ);
  renderer.render(scene,camera);hasRendered=true;
  animateId=requestAnimationFrame(render);
 }
 function pointerDown(e){
   if(e.pointerType==='mouse'&&e.button!==0)return;
   canvas.focus({preventScroll:true});
   try{canvas.setPointerCapture(e.pointerId)}catch(_){}
   activePointers.set(e.pointerId,{x:e.clientX,y:e.clientY,startX:e.clientX,startY:e.clientY});
   if(activePointers.size===1)dragDistance=0;
 }
 function pointerMove(e){
   const current=activePointers.get(e.pointerId);
   if(!current)return;
   const old=new Map(activePointers);
   activePointers.set(e.pointerId,{...current,x:e.clientX,y:e.clientY});
   if(activePointers.size===1){
     const dx=e.clientX-current.x,dy=e.clientY-current.y;
     dragDistance+=Math.hypot(dx,dy);
     rotate(dx,dy);
   }else if(activePointers.size===2){
     const keys=[...activePointers.keys()];
     const a=old.get(keys[0]),b=old.get(keys[1]);
     const c=activePointers.get(keys[0]),d=activePointers.get(keys[1]);
     const before=Math.hypot(a.x-b.x,a.y-b.y),after=Math.hypot(c.x-d.x,c.y-d.y);
     if(before>15&&after>15)zoom(before/after);
     dragDistance+=Math.abs(after-before);
   }
   e.preventDefault();
 }
 function pointerUp(e){
   const start=activePointers.get(e.pointerId);
   const wasSingle=activePointers.size===1;
   activePointers.delete(e.pointerId);
   if(wasSingle&&start&&dragDistance<7&&Math.hypot(e.clientX-start.startX,e.clientY-start.startY)<7)selectAt(e.clientX,e.clientY);
   try{if(canvas.hasPointerCapture(e.pointerId))canvas.releasePointerCapture(e.pointerId)}catch(_){}
 }
 function pointerCancel(e){activePointers.delete(e.pointerId)}
 function wheel(e){
   e.preventDefault();
   zoom(Math.exp(Math.sign(e.deltaY)*.13));
 }
 function doubleClick(e){e.preventDefault();resetView()}
 canvas.addEventListener('pointerdown',pointerDown);
 canvas.addEventListener('pointermove',pointerMove);
 canvas.addEventListener('pointerup',pointerUp);
 canvas.addEventListener('pointercancel',pointerCancel);
 canvas.addEventListener('lostpointercapture',pointerCancel);
 canvas.addEventListener('wheel',wheel,{passive:false});
 canvas.addEventListener('dblclick',doubleClick);
 canvas.style.touchAction='none';
 canvas.style.cursor='grab';
 controlsChanged();
 const resizeObserver=typeof ResizeObserver!=='undefined'?new ResizeObserver(resize):null;
 if(resizeObserver)resizeObserver.observe(canvas);
 animateId=requestAnimationFrame(render);
 return {
  setActive(i){active=Math.max(0,Math.min(count-1,Number(i)||0));},
  setEvent(kind){event=kind||null;},
  setHealth(teamIndex,value){const item=islands[teamIndex];if(item){item.grass.material.color.set(value<=0?'#ef725f':teams[teamIndex].color)}},
  setTeams(){},
  rotate,zoom,resetView,focusIsland,
  getView(){return {...view}},
  get ready(){return hasRendered},
  destroy(){
   running=false;cancelAnimationFrame(animateId);resizeObserver?.disconnect();
   canvas.removeEventListener('pointerdown',pointerDown);
   canvas.removeEventListener('pointermove',pointerMove);
   canvas.removeEventListener('pointerup',pointerUp);
   canvas.removeEventListener('pointercancel',pointerCancel);
   canvas.removeEventListener('lostpointercapture',pointerCancel);
   canvas.removeEventListener('wheel',wheel);
   canvas.removeEventListener('dblclick',doubleClick);
   activePointers.clear();
   scene.traverse(o=>{if(o.geometry)o.geometry.dispose();if(o.material){if(Array.isArray(o.material))o.material.forEach(m=>m.dispose());else o.material.dispose()}});
   renderer.dispose();
  }
 };
}
global.IslandScene3D={create};
})(window);
