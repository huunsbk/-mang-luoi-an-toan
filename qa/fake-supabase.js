/* Supabase giả lập trong trình duyệt cho QA (bảng + Storage + Auth trong bộ nhớ, lưu qua localStorage). */
(function(){
const KEY='__fakeSupabaseDB';
const load=()=>{try{return JSON.parse(localStorage.getItem(KEY))||{tables:{},files:{},session:null}}catch(_){return{tables:{},files:{},session:null}}};
let db=load();const persist=()=>localStorage.setItem(KEY,JSON.stringify(db));
const USER={id:'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa',email:'giaovien@example.com'};
const uuid=()=>crypto.randomUUID();
window.__fakeDB=()=>db;window.__fakeLog=window.__fakeLog||[];
// Đọc lại mỗi lần truy vấn: trang mẹ và cửa sổ nhúng (iframe) dùng chung một kho giả lập.
function table(name){db=load();return db.tables[name]||(db.tables[name]=[])}
function query(name){
 let filters=[],op='select',payload=null,single=false,conflict=null,lim=1e9;
 const api={
  select(){if(op==='select')op='select';return api},
  eq(col,v){filters.push(r=>r[col]===v);return api},order(){return api},limit(n){lim=n;return api},
  insert(row){op='insert';payload=row;return api},update(row){op='update';payload=row;return api},
  delete(){op='delete';return api},upsert(row,opt){op='upsert';payload=row;conflict=opt?.onConflict?.split(',');return api},
  single(){single=true;return api},maybeSingle(){single=true;return api},
  then(res,rej){return Promise.resolve(exec()).then(res,rej)}
 };
 function exec(){
  window.__fakeLog.push(op+':'+name);
  // Giả lập đúng lỗi thật khi chưa áp dụng migration (PostgREST 404 / PGRST205).
  if(localStorage.getItem('__fakeMissingTables')==='1'&&/^teacher_(voice_scripts|phrase_audio)$/.test(name))
   return{data:null,error:{code:'PGRST205',message:"Could not find the table 'public."+name+"' in the schema cache"}};
  const t=table(name),match=r=>filters.every(f=>f(r));let out;
  if(op==='select')out=t.filter(match).slice(0,lim);
  else if(op==='insert'){const row={id:uuid(),owner_id:USER.id,created_at:new Date().toISOString(),sort_order:0,...payload};t.push(row);out=[row]}
  else if(op==='update'){out=t.filter(match);out.forEach(r=>Object.assign(r,payload))}
  else if(op==='delete'){out=t.filter(match);db.tables[name]=t.filter(r=>!match(r))}
  else if(op==='upsert'){const ex=t.find(r=>conflict.every(k=>r[k]===payload[k]));if(ex){Object.assign(ex,payload);out=[ex]}else{const row={id:uuid(),...payload};t.push(row);out=[row]}}
  persist();
  return{data:single?out[0]||null:out,error:null};
 }
 return api;
}
const storage={from(bucket){return{
 async upload(path,blob){const b=await blob.arrayBuffer();db.files[bucket+'/'+path]=b.byteLength;persist();window.__fakeLog.push('upload:'+path);return{data:{path},error:null}},
 async createSignedUrls(paths){return{data:paths.map(p=>({signedUrl:location.origin+'/qa-media/signed/'+encodeURIComponent(p),error:null})),error:null}},
 async remove(paths){for(const p of paths)delete db.files[bucket+'/'+p];persist();return{data:paths,error:null}}
}}};
const auth={
 async getSession(){return{data:{session:db.session},error:null}},
 async getUser(){return db.session?{data:{user:USER},error:null}:{data:{user:null},error:{message:'no user'}}},
 async signInWithPassword(){db.session={access_token:'fake',user:USER};persist();return{data:{user:USER,session:db.session},error:null}},
 async signOut(){db.session=null;persist();return{error:null}},
 onAuthStateChange(){return{data:{subscription:{unsubscribe(){}}}}}
};
window.supabase={createClient(){return{from:query,storage,auth}}};
})();
