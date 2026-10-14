/* NGHI-TTS Piper voice runtime for the classroom game.
 * Piper/ONNX synthesis is performed locally in this Web Worker.
 * Attribution: https://github.com/nghimestudio/nghitts (Apache-2.0 source).
 * Model deepman3909 hosted by third-party mirror, not redistributed with this site.
 * NOTE: Model copyright/licensing must be reviewed separately from code licensing.
 * Third-party WASM + model files are downloaded during first initialization.
 */
'use strict';
const MODEL_NAME='deepman3909';
const MODEL_BASE='/marble-race/voice/';
const PHONEMIZER_BASE='https://cdn.jsdelivr.net/npm/@diffusionstudio/piper-wasm@1.0.0/build/piper_phonemize';
const ORT_DIST='https://cdn.jsdelivr.net/npm/onnxruntime-web@1.22.0/dist/';
let model=null, config=null, ort=null, phonemizer=null, ready=null;
function report(stage,detail){self.postMessage({type:'progress',stage,detail})}
function description(error){return error instanceof Error?error.message:String(error)}
async function fetchCached(url){
 let cache=null;
 try{if(self.caches)cache=await caches.open('marble-piper-assets-v1')}catch(_e){}
 if(cache){try{const cached=await cache.match(url);if(cached)return cached}catch(_e){}}
 const response=await fetch(url,{mode:'cors'});
 if(!response.ok)throw Error('Không tải được tài nguyên giọng đọc (HTTP '+response.status+'): '+url);
 if(cache){try{await cache.put(url,response.clone())}catch(_e){}}
 return response;
}
async function init(){
 if(model)return;
 report('loading','Đang tải mô hình NGHI-TTS khoảng 64 MB. Lần đầu có thể mất vài phút.');
 // Import the Piper phonemizer's Emscripten-generated classic script.
 importScripts(PHONEMIZER_BASE+'.js');
 if(typeof self.createPiperPhonemize!=='function')throw Error('Không thể khởi tạo bộ chuyển âm vị Piper.');
 phonemizer=self.createPiperPhonemize;
 ort=await import('https://esm.sh/onnxruntime-web@1.22.0?bundle');
 ort.env.wasm.numThreads=1; // works without SharedArrayBuffer on iOS Safari
 ort.env.wasm.simd=true;
 ort.env.wasm.wasmPaths=ORT_DIST;
 const [cfgResponse,modelResponse]=await Promise.all([
   fetchCached(MODEL_BASE+MODEL_NAME+'.onnx.json'),
   fetchCached(MODEL_BASE+MODEL_NAME+'.onnx')
 ]);
 config=await cfgResponse.json();
 if(!config.phoneme_id_map||config.espeak?.voice!=='vi')throw Error('Cấu hình giọng Piper không phải tiếng Việt.');
 const bytes=await modelResponse.arrayBuffer();
 if(bytes.byteLength<30000000)throw Error('Tệp mô hình ONNX không đầy đủ.');
 report('initializing','Đang nạp giọng nam tiếng Việt vào bộ nhớ.');
 model=await ort.InferenceSession.create(bytes,{executionProviders:['wasm']});
 report('ready','Giọng NGHI-TTS đã sẵn sàng trên thiết bị.');
}
async function idsFor(text){
 const input=JSON.stringify([{text:text.trim()}]);
 return await new Promise(async(resolve,reject)=>{
  let settled=false;
  try{
   const instance=await phonemizer({
    print:data=>{if(settled)return;try{
     const parsed=JSON.parse(data);
     const result=parsed.phoneme_ids;
     if(!Array.isArray(result)||!result.length)throw Error('Không nhận được âm vị.');
     settled=true;resolve(result.map(Number));
    }catch(e){settled=true;reject(e)}},
    printErr:()=>{},
    locateFile:name=>name.endsWith('.wasm')?PHONEMIZER_BASE+'.wasm':
                     name.endsWith('.data')?PHONEMIZER_BASE+'.data':name
   });
   instance.callMain(['-l','vi','--input',input,'--espeak_data','/espeak-ng-data']);
  }catch(e){if(!settled){settled=true;reject(e)}}
 });
}
function wav(samples,rate){
 const out=new ArrayBuffer(44+samples.length*2),v=new DataView(out);
 function label(offset,str){for(let i=0;i<str.length;i++)v.setUint8(offset+i,str.charCodeAt(i))}
 label(0,'RIFF');v.setUint32(4,36+samples.length*2,true);label(8,'WAVE');label(12,'fmt ');
 v.setUint32(16,16,true);v.setUint16(20,1,true);v.setUint16(22,1,true);
 v.setUint32(24,rate,true);v.setUint32(28,rate*2,true);
 v.setUint16(32,2,true);v.setUint16(34,16,true);
 label(36,'data');v.setUint32(40,samples.length*2,true);
 for(let i=0;i<samples.length;i++){const s=Math.max(-1,Math.min(1,samples[i]));v.setInt16(44+i*2,s<0?s*32768:s*32767,true)}
 return out;
}
function segments(text){
 // Keep sentences small enough for phones; preserve Vietnamese punctuation.
 const s=String(text).replace(/\s+/g,' ').trim();
 if(!s)return [];
 const result=[];
 for(const t of (s.match(/[^.!?;]+[.!?;]?/g)||[s])){
  let rest=t.trim();
  while(rest.length>165){
   let cut=rest.lastIndexOf(' ',165);if(cut<60)cut=165;
   result.push(rest.slice(0,cut));rest=rest.slice(cut).trim();
  }
  if(rest)result.push(rest);
 }
 return result;
}
async function synth(text){
 if(!model)throw Error('Mô hình giọng đọc chưa được nạp.');
 const chunks=segments(text),pieces=[];
 let total=0;
 for(const item of chunks){
  const ids=await idsFor(item);
  const input={
   input:new ort.Tensor('int64',BigInt64Array.from(ids.map(BigInt)),[1,ids.length]),
   input_lengths:new ort.Tensor('int64',BigInt64Array.from([BigInt(ids.length)]),[1]),
   scales:new ort.Tensor('float32',Float32Array.from([.667,1,.8]),[3])
  };
  const result=await model.run(input);
  const floats=result.output?.data;
  if(!floats||!floats.length)throw Error('Không tạo được âm thanh ONNX.');
  const copy=new Float32Array(floats);pieces.push(copy);total+=copy.length;
  if(total>2400000)throw Error('Đoạn âm thanh quá dài trên thiết bị.');
 }
 const merged=new Float32Array(total);let at=0;
 for(const piece of pieces){merged.set(piece,at);at+=piece.length}
 return wav(merged,config.audio.sample_rate||22050);
}
self.onmessage=async event=>{
 const {type,id,text}=event.data||{};
 try{
  if(type==='init'){
   if(!ready)ready=init();
   await ready;
   self.postMessage({type:'ready',id,model:MODEL_NAME});
  }else if(type==='speak'){
   if(!ready)ready=init();
   await ready;
   if(typeof text!=='string'||text.length>1800)throw Error('Độ dài văn bản không hợp lệ.');
   const audio=await synth(text);
   self.postMessage({type:'audio',id,audio},[audio]);
  }
 }catch(error){
  if(type==='init')ready=null;
  self.postMessage({type:'error',id,message:description(error)});
 }
};
