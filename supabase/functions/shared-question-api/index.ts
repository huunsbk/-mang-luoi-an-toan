import { createClient } from "npm:@supabase/supabase-js@2.116.0";

// A versioned, authenticated and game-agnostic facade over the existing Pose Quiz question bank.
// Does not change /functions/v1/pose-quiz-api or the original questions.
const URL = Deno.env.get("SUPABASE_URL")!;
function secret() {
  const modern = Deno.env.get("SUPABASE_SECRET_KEYS");
  if (modern) {
    try {
      const obj=JSON.parse(modern);
      const key=obj.default||Object.values(obj)[0];
      if(typeof key==="string"&&key) return key;
    } catch (_) {}
  }
  const old=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!old) throw new Error("Chưa cấu hình khóa Supabase máy chủ.");
  return old;
}
const admin=createClient(URL,secret(),{auth:{persistSession:false,autoRefreshToken:false}});
const HEADERS={
  "Access-Control-Allow-Origin":"*",
  "Access-Control-Allow-Headers":"authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods":"POST, OPTIONS",
  "Cache-Control":"no-store",
  "X-Content-Type-Options":"nosniff"
};
function answer(payload:unknown,status=200) {
  return new Response(JSON.stringify(payload),{status,headers:{...HEADERS,"Content-Type":"application/json; charset=utf-8"}});
}
function fail(msg:string,status:number) {return answer({ok:false,error:msg},status)}
function requireIds(ids:unknown) {
  if(!Array.isArray(ids)||ids.length>120)throw Object.assign(new Error("Chỉ được chọn tối đa 120 câu mỗi lần."),{status:400});
  const list=[...new Set(ids.map(String))];
  if(list.some(s=>!/^[0-9a-f]{8}-[0-9a-f-]{27,}$/.test(s)))throw Object.assign(new Error("Mã câu hỏi không hợp lệ."),{status:400});
  return list;
}
async function userFor(req:Request) {
  const jwt=(req.headers.get("authorization")||"").replace(/^Bearer\s+/i,"").trim();
  if(!jwt)throw Object.assign(new Error("Vui lòng đăng nhập tài khoản MotionClass."),{status:401});
  const {data,error}=await admin.auth.getUser(jwt);
  if(error||!data.user)throw Object.assign(new Error("Phiên đăng nhập không hợp lệ."),{status:401});
  return data.user;
}
async function accessible(userId:string) {
  const [myGroups,myMembers]=await Promise.all([
    admin.from("pose_quiz_groups").select("id").eq("owner_id",userId),
    admin.from("pose_quiz_group_members").select("group_id").eq("user_id",userId)
  ]);
  if(myGroups.error)throw myGroups.error;
  if(myMembers.error)throw myMembers.error;
  const groupIds=[...new Set([...(myGroups.data||[]).map(r=>r.id),...(myMembers.data||[]).map(r=>r.group_id)])];
  const columns="id,user_id,subject_name,lesson_name,grade,visibility,group_id,question,updated_at";
  const requests=[
    admin.from("pose_quiz_question_bank").select(columns).eq("user_id",userId).limit(1000),
    admin.from("pose_quiz_question_bank").select(columns).eq("visibility","public").limit(1000)
  ];
  if(groupIds.length)requests.push(admin.from("pose_quiz_question_bank").select(columns).eq("visibility","group").in("group_id",groupIds).limit(1000));
  const sets=await Promise.all(requests);
  const rows=new Map<string,any>();
  for(const res of sets) {
    if(res.error)throw res.error;
    for(const row of res.data||[])rows.set(row.id,row);
  }
  return [...rows.values()].sort((a,b)=>String(b.updated_at).localeCompare(String(a.updated_at)));
}
const keys=["A","B","C","D"];
const AUDIO_PARTS=["full","question","option_a","option_b","option_c","option_d","answer","explain"];
function punctuation(value:string) {
  value=String(value||"").trim();
  return /[.!?]$/.test(value)?value:value+".";
}
function spoken(row:any) {
  const q=row.question||{};
  const options:Array<any>=Array.isArray(q.answers)?q.answers:[];
  if(!String(q.text||"").trim()||options.length!==4||options.filter((x:any)=>x.isCorrect===true).length!==1
    ||options.some((x:any)=>!String(x.text||"").trim())) return null;
  const answer=options.findIndex((x:any)=>x.isCorrect===true);
  const words:Record<string,string>={
    question:punctuation(q.text),
    full:punctuation(q.text)+" "+keys.map((k,i)=>"Phương án "+k+". "+punctuation(options[i].text)).join(" ")+" Em hãy suy nghĩ và lựa chọn một đáp án.",
    answer:"Đáp án đúng là phương án "+keys[answer]+". "+punctuation(options[answer].text)
  };
  keys.forEach((k,i)=>{words["option_"+k.toLowerCase()]="Phương án "+k+". "+punctuation(options[i].text)});
  // Giải thích (không bắt buộc): giáo viên điền thì có thêm phần đọc "explain", đọc nối sau đáp án.
  const explanation=String(q.explanation||"").replace(/\s+/g," ").trim();
  if(explanation)words.explain=punctuation(explanation);
  return {correct:keys[answer],options:options.map((x:any)=>String(x.text)),spoken:words,explanation};
}
async function hashString(s:string) {
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(s)))]
    .map(b=>b.toString(16).padStart(2,"0")).join("");
}
async function imageUrl(data:any) {
  const image=data?.image;
  if(!image?.path||typeof image.path!=="string")return null;
  const bucket=["pose-quiz-media","shared-question-images"].includes(image.storage)?image.storage:null;
  if(!bucket)return null;
  const {data:link,error}=await admin.storage.from(bucket).createSignedUrl(image.path,3600);
  return error?null:link.signedUrl;
}
async function listQuestions(req:Request,userId:string,body:any) {
  const rows=await accessible(userId);
  const subject=String(body.subject||"ALL"),lesson=String(body.lesson||"ALL"),q=String(body.search||"").toLocaleLowerCase("vi").slice(0,180);
  const usable=rows.filter(row=>spoken(row)!==null);
  const subjects=[...new Set(usable.map(r=>r.subject_name))].sort((a,b)=>a.localeCompare(b,"vi"));
  const lessons=[...new Set(usable.filter(r=>subject==="ALL"||r.subject_name===subject).map(r=>r.lesson_name))]
    .sort((a,b)=>a.localeCompare(b,"vi"));
  const allFiltered=usable.filter(r=>(subject==="ALL"||r.subject_name===subject)&&
    (lesson==="ALL"||r.lesson_name===lesson)&&(!q||String(r.question.text).toLocaleLowerCase("vi").includes(q)));
  const offset=Math.min(10000,Math.max(0,Math.floor(Number(body.offset)||0)));
  const limit=Math.min(250,Math.max(1,Math.floor(Number(body.limit)||250)));
  const filtered=allFiltered.slice(offset,offset+limit);
  const items=await Promise.all(filtered.map(async row=>{
    const normalized=spoken(row)!;
    return {id:row.id,subject:row.subject_name,lesson:row.lesson_name,grade:row.grade??null,visibility:row.visibility,owned:row.user_id===userId,
      text:row.question.text,options:normalized.options,correct:normalized.correct,spoken:normalized.spoken,explanation:normalized.explanation||"",
      imageUrl:await imageUrl(row.question),updatedAt:row.updated_at};
  }));
  return {ok:true,version:"shared-bank-v1",items,facets:{subjects,lessons},totalAccessible:usable.length,totalFiltered:allFiltered.length,nextOffset:offset+limit<allFiltered.length?offset+limit:null};
}
async function allowedRows(userId:string,ids:string[]) {
  const rows=await accessible(userId),map=new Map(rows.map(r=>[r.id,r]));
  if(ids.some(id=>!map.has(id)))throw Object.assign(new Error("Không có quyền xem một hoặc nhiều câu hỏi."),{status:403});
  return map;
}
/** Lightweight inventory for list views; no private WAV URLs or extra download traffic. */
async function audioOverview(userId:string,body:any) {
  const ids=requireIds(body.ids);
  const access=await allowedRows(userId,ids);
  if(!ids.length)return {ok:true,items:[]};
  const {data,error}=await admin.from("shared_question_audio")
    .select("bank_question_id,voice_id,part,text_hash,size_bytes,updated_at")
    .in("bank_question_id",ids);
  if(error)throw error;
  const digestCache=new Map<string,string>();
  const items=await Promise.all((data||[]).map(async record=>{
    const question=access.get(record.bank_question_id);
    const text=spoken(question)?.spoken?.[record.part];
    const hashKey=record.bank_question_id+":"+record.part;
    let digest=digestCache.get(hashKey);
    if(text&&!digest){digest=await hashString(text);digestCache.set(hashKey,digest)}
    return {id:record.bank_question_id,voiceId:record.voice_id,part:record.part,
      current:!!digest&&digest===record.text_hash,sizeBytes:record.size_bytes,
      updatedAt:record.updated_at};
  }));
  return {ok:true,items};
}
function validAudioVoiceId(value:string) {
  // One fixed 16-hex server-side hash per Google AI Studio configured voice;
  // the TTS API key and teacher PIN remain in Vercel and are never stored here.
  // edge:<giọng>-v<n>: giọng Microsoft (NamMinh...) tạo trước, mỗi đoạn một tệp.
  return /^nghi:[a-z0-9]{2,45}$/.test(value)||/^studio:[a-f0-9]{16}$/.test(value)||/^edge:[a-z0-9-]{2,45}$/.test(value);
}
function voiceFolder(value:string) {
  if(value.startsWith("studio:"))return "studio-"+value.slice(7);
  if(value.startsWith("edge:"))return "edge-"+value.slice(5);
  return value.slice(5);
}
async function audioList(userId:string,body:any) {
  const ids=requireIds(body.ids);
  await allowedRows(userId,ids);
  if(!ids.length)return {ok:true,items:[]};
  const voice=String(body.voice_id||"");
  if(!validAudioVoiceId(voice))throw Object.assign(new Error("Mã giọng đọc không hợp lệ."),{status:400});
  const {data,error}=await admin.from("shared_question_audio").select("bank_question_id,voice_id,part,text_hash,storage_path")
    .in("bank_question_id",ids).eq("voice_id",voice);
  if(error)throw error;
  const result=[];
  for(const item of data||[]) {
    const {data:link,error:linkError}=await admin.storage.from("shared-question-voices").createSignedUrl(item.storage_path,3600);
    if(!linkError)result.push({id:item.bank_question_id,voiceId:item.voice_id,part:item.part,textHash:item.text_hash,url:link.signedUrl});
  }
  return {ok:true,items:result};
}
async function putAudio(userId:string,form:FormData) {
  const id=String(form.get("id")||"");
  const voice=String(form.get("voice_id")||"");
  const part=String(form.get("part")||"");
  if(!validAudioVoiceId(voice))throw Object.assign(new Error("Mã giọng không hợp lệ."),{status:400});
  if(!AUDIO_PARTS.includes(part))
    throw Object.assign(new Error("Loại âm thanh không hợp lệ."),{status:400});
  const {data:row,error:lookupError}=await admin.from("pose_quiz_question_bank").select("id,user_id,question").eq("id",id).maybeSingle();
  if(lookupError)throw lookupError;
  if(!row||row.user_id!==userId)throw Object.assign(new Error("Chỉ người sở hữu câu hỏi được lưu giọng lên kho."),{status:403});
  const content=spoken(row)?.spoken[part];
  if(!content)throw Object.assign(new Error("Câu hỏi chưa đủ nội dung hoặc đáp án."),{status:422});
  const file=form.get("audio");
  if(!(file instanceof File)||file.size<45||file.size>5242880)
    throw Object.assign(new Error("Âm thanh WAV phải có dung lượng tối đa 5 MB."),{status:413});
  const header=new Uint8Array(await file.slice(0,12).arrayBuffer());
  const ascii=String.fromCharCode(...header);
  if(!ascii.startsWith("RIFF")||ascii.slice(8,12)!=="WAVE")throw Object.assign(new Error("Tệp âm thanh WAV không hợp lệ."),{status:415});
  const digest=await hashString(content);
  // Optional only for reviewed batch WAVs. Never trust client text hashes.
  const expected=String(form.get("expected_text_hash")||"");
  if(expected){
    if(!/^[a-f0-9]{64}$/.test(expected))
      throw Object.assign(new Error("Mã xác minh nội dung WAV không hợp lệ."),{status:422});
    if(expected!==digest)
      throw Object.assign(new Error("Nội dung câu hỏi đã thay đổi. Vui lòng tạo lại WAV cho nội dung mới."),{status:409});
    // If a prior attempt succeeded but the response was lost, avoid re-uploading.
    const {data:existing,error:readError}=await admin.from("shared_question_audio")
      .select("text_hash,storage_path")
      .eq("bank_question_id",id).eq("voice_id",voice).eq("part",part).maybeSingle();
    if(readError)throw readError;
    if(existing?.text_hash===digest){
      const {error:missing}=await admin.storage.from("shared-question-voices")
        .createSignedUrl(existing.storage_path,60);
      if(!missing)return {ok:true,id,part,voice_id:voice,textHash:digest,skipped:true};
    }
  }
  const path=userId+"/"+id+"/"+voiceFolder(voice)+"/"+part+"-"+digest+".wav";
  const blob=new Blob([await file.arrayBuffer()],{type:"audio/wav"});
  const {error:uploadError}=await admin.storage.from("shared-question-voices").upload(path,blob,{contentType:"audio/wav",upsert:true});
  if(uploadError)throw uploadError;
  const {error:dbError}=await admin.from("shared_question_audio").upsert({
    bank_question_id:id,voice_id:voice,part,text_hash:digest,storage_path:path,mime_type:"audio/wav",
    size_bytes:file.size,updated_at:new Date().toISOString()
  },{onConflict:"bank_question_id,voice_id,part"});
  if(dbError)throw dbError;
  return {ok:true,id,part,voice_id:voice,textHash:digest};
}
// Shared CRUD keeps Pose Quiz's existing JSON format, IDs, poses and media fields.
const POSES=["RAISE_LEFT","RAISE_RIGHT","BOTH_UP","CROSS_ARMS"];
function questionInput(raw:any){
 if(!raw||typeof raw!=="object")throw Object.assign(new Error("Thiếu dữ liệu câu hỏi."),{status:400});
 const text=String(raw.text||"").trim(),opts=Array.isArray(raw.options)?raw.options.map((s:unknown)=>String(s||"").trim()):[];
 const correct=String(raw.correct||"").toUpperCase();
 const subject=String(raw.subject||"").trim(),lesson=String(raw.lesson||"").trim();
 const visibility=String(raw.visibility||"private");
 // Older clients may omit grade; explicit values must be an integer from 1 through 12.
 const suppliedGrade=raw.grade!==undefined&&raw.grade!==null&&String(raw.grade).trim()!=="";
 const grade=suppliedGrade?Number(raw.grade):null;
 if(suppliedGrade&&(!Number.isInteger(grade)||grade<1||grade>12))
  throw Object.assign(new Error("Lớp phải là một số nguyên từ 1 đến 12."),{status:422});
 if(!text||text.length>1600||opts.length!==4||opts.some((s:string)=>!s||s.length>800)||!keys.includes(correct))
  throw Object.assign(new Error("Cần nội dung câu hỏi, đủ bốn phương án A–D và một đáp án đúng."),{status:422});
 if(!subject||!lesson||subject.length>120||lesson.length>200)
  throw Object.assign(new Error("Hãy chọn môn học và bài học (độ dài hợp lệ)."),{status:422});
 if(!["private","public","group"].includes(visibility))throw Object.assign(new Error("Phạm vi chia sẻ không hợp lệ."),{status:422});
 // Giải thích: không bắt buộc; undefined = giữ nguyên giá trị cũ (trò chơi khác lưu câu hỏi không làm mất giải thích).
 const explanation=raw.explanation===undefined?undefined:String(raw.explanation||"").replace(/\s+/g," ").trim();
 if(explanation&&explanation.length>1000)throw Object.assign(new Error("Giải thích tối đa 1000 ký tự."),{status:422});
 return{text,opts,correct,subject,lesson,visibility,grade,explanation};
}
async function upsertOne(userId:string,raw:any){
 const v=questionInput(raw),id=String(raw.id||"");
 let stored:any=null;
 if(id){
  const {data,error}=await admin.from("pose_quiz_question_bank").select("id,user_id,question,grade,visibility,group_id,updated_at").eq("id",id).maybeSingle();
  if(error)throw error;
  if(!data||data.user_id!==userId)throw Object.assign(new Error("Không có quyền sửa câu hỏi này."),{status:403});
  if(raw.expected_updated_at&&String(raw.expected_updated_at)!==String(data.updated_at))
   throw Object.assign(new Error("Câu hỏi đã được thay đổi ở nơi khác. Hãy tải lại trước khi lưu."),{status:409});
  stored=data;
  if(v.visibility==="group"&&data.visibility!=="group")
   throw Object.assign(new Error("Không thể tạo chia sẻ theo nhóm nếu câu hỏi chưa thuộc nhóm."),{status:422});
 }
 if(!stored&&v.visibility==="group")
  throw Object.assign(new Error("Hãy lưu ở chế độ riêng tư hoặc công khai trước."),{status:422});
 const old=stored?.question||{},answers=Array.isArray(old.answers)?old.answers:[];
 const question={
  ...old,id:old.id||crypto.randomUUID(),text:v.text,
  answers:v.opts.map((value:string,i:number)=>({
   ...(answers[i]||{}),pose:answers[i]?.pose||POSES[i],image:answers[i]?.image??null,text:value,isCorrect:keys[i]===v.correct
  })),
  image:old.image??null,audio:old.audio??null,
  explanation:v.explanation===undefined?(old.explanation||""):v.explanation
 };
 const record={subject_name:v.subject,lesson_name:v.lesson,grade:raw.grade===undefined?(stored?.grade??null):v.grade,
  visibility:stored?.visibility==="group"&&raw.visibility===undefined?"group":v.visibility,
  question,updated_at:new Date().toISOString()};
 if(stored){
  const {data,error}=await admin.from("pose_quiz_question_bank").update(record).eq("id",stored.id).eq("user_id",userId).select("id,updated_at").single();
  if(error)throw error;
  return{id:data.id,updatedAt:data.updated_at,created:false};
 }
 const {data,error}=await admin.from("pose_quiz_question_bank").insert({...record,user_id:userId}).select("id,updated_at").single();
 if(error)throw error;
 return{id:data.id,updatedAt:data.updated_at,created:true};
}
async function saveMany(userId:string,body:any){
 if(!Array.isArray(body.items)||body.items.length<1||body.items.length>100)
  throw Object.assign(new Error("Chỉ lưu từ 1 đến 100 câu hỏi mỗi lần."),{status:400});
 // Validate all entries before the first write. On a partial failure return completed IDs.
 for(const item of body.items)questionInput(item);
 const results=[];
 for(const item of body.items){
  try{results.push(await upsertOne(userId,item))}
  catch(error:any){return{ok:false,partial:true,items:results,error:String(error.message||error),failedIndex:results.length}}
 }
 return{ok:true,items:results,created:results.filter((r:any)=>r.created).length,updated:results.filter((r:any)=>!r.created).length};
}
async function deleteOne(userId:string,body:any){
 const id=String(body.id||"");
 if(!/^[0-9a-f-]{36}$/i.test(id))throw Object.assign(new Error("Mã câu hỏi không hợp lệ."),{status:400});
 const {data,error}=await admin.from("pose_quiz_question_bank").select("id,user_id").eq("id",id).maybeSingle();
 if(error)throw error;
 if(!data||data.user_id!==userId)throw Object.assign(new Error("Chỉ được xóa câu hỏi của chính mình."),{status:403});
 const {error:delError}=await admin.from("pose_quiz_question_bank").delete().eq("id",id).eq("user_id",userId);
 if(delError)throw delError;
 // Remove orphaned voice objects; audio metadata cascades via foreign key.
 const prefix=userId+"/"+id+"/";
 const {data:voices}=await admin.storage.from("shared-question-voices").list(prefix,{limit:100});
 for(const folder of voices||[]){
  const folderPath=prefix+folder.name;
  const {data:objects}=await admin.storage.from("shared-question-voices").list(folderPath,{limit:100});
  const paths=(objects||[]).filter(v=>v.name.endsWith(".wav")).map(v=>folderPath+"/"+v.name);
  if(paths.length)await admin.storage.from("shared-question-voices").remove(paths);
 }
 return{ok:true,id};
}
async function imageOwner(userId:string,id:string){
 if(!/^[0-9a-f-]{36}$/i.test(id))throw Object.assign(new Error("Mã câu hỏi không hợp lệ."),{status:400});
 const {data,error}=await admin.from("pose_quiz_question_bank").select("id,user_id,question").eq("id",id).maybeSingle();
 if(error)throw error;
 if(!data||data.user_id!==userId)throw Object.assign(new Error("Chỉ chủ sở hữu được thay ảnh của câu hỏi."),{status:403});
 return data;
}
/** Delete every stored voice/part/version for one question, not the question itself.
 * Re-check the owner server-side and permit deletion only within this user's private prefix. */
async function deleteAllQuestionAudio(userId:string,body:any){
 const id=String(body.id||"");
 if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id))
  throw Object.assign(new Error("Mã câu hỏi không hợp lệ."),{status:422});
 await imageOwner(userId,id);
 const {data,error,count}=await admin.from("shared_question_audio")
  .select("voice_id,storage_path",{count:"exact"}).eq("bank_question_id",id);
 if(error)throw error;
 const records=data||[];
 if(count!==null&&count!==records.length)
  throw Object.assign(new Error("Câu hỏi có quá nhiều tệp WAV để xóa nhanh an toàn."),{status:409});
 if(!records.length)return {ok:true,id,deleted:0,voices:0};
 const paths:string[]=[],voices=new Set<string>();
 for(const record of records){
  const voice=String(record.voice_id||""),path=String(record.storage_path||"");
  const expected=userId+"/"+id+"/"+voiceFolder(voice)+"/";
  if(!validAudioVoiceId(voice)||!path.startsWith(expected)||!path.endsWith(".wav"))
   throw Object.assign(new Error("Đường dẫn WAV không hợp lệ; không xóa để tránh ảnh hưởng dữ liệu khác."),{status:409});
  voices.add(voice);
  paths.push(path);
 }
 // Remove private WAV objects before dropping their references. The DB is never
 // cleared when Storage reports a failure, so retry/recovery remains possible.
 const storage=admin.storage.from("shared-question-voices");
 for(let i=0;i<paths.length;i+=100){
  const {error:storageError}=await storage.remove(paths.slice(i,i+100));
  if(storageError)throw storageError;
 }
 const {data:removed,error:deleteError}=await admin.from("shared_question_audio")
  .delete().eq("bank_question_id",id).select("voice_id");
 if(deleteError)throw deleteError;
 return {ok:true,id,deleted:(removed||[]).length,voices:voices.size};
}
async function deleteAudioPart(userId:string,body:any){
 const id=String(body.id||""),voice=String(body.voice_id||""),part=String(body.part||"");
 await imageOwner(userId,id);
 if(!validAudioVoiceId(voice)||!AUDIO_PARTS.includes(part))
  throw Object.assign(new Error("Giọng đọc hoặc thành phần âm thanh không hợp lệ."),{status:422});
 const {data,error}=await admin.from("shared_question_audio").select("storage_path").eq("bank_question_id",id).eq("voice_id",voice).eq("part",part).maybeSingle();
 if(error)throw error;
 if(!data)return{ok:true,deleted:false};
 const {error:deleteError}=await admin.from("shared_question_audio").delete().eq("bank_question_id",id).eq("voice_id",voice).eq("part",part);
 if(deleteError)throw deleteError;
 const expected=userId+"/"+id+"/"+voiceFolder(voice)+"/";
 if(data.storage_path.startsWith(expected))
  await admin.storage.from("shared-question-voices").remove([data.storage_path]);
 return{ok:true,deleted:true};
}
async function uploadQuestionImage(userId:string,form:FormData){
 const id=String(form.get("id")||"");
 const original=await imageOwner(userId,id);
 const file=form.get("image");
 if(!(file instanceof File)||file.size<40||file.size>3145728)
  throw Object.assign(new Error("Hình ảnh phải nhỏ hơn 3 MB."),{status:413});
 const arr=new Uint8Array(await file.slice(0,16).arrayBuffer());
 const printable=String.fromCharCode(...arr);
 const jpeg=arr[0]===0xff&&arr[1]===0xd8&&arr[2]===0xff;
 const png=arr[0]===0x89&&printable.slice(1,4)==="PNG";
 const webp=printable.slice(0,4)==="RIFF"&&printable.slice(8,12)==="WEBP";
 if(!jpeg&&!png&&!webp)throw Object.assign(new Error("Chỉ nhận JPEG, PNG hoặc WEBP hợp lệ."),{status:415});
 const type=jpeg?"image/jpeg":png?"image/png":"image/webp";
 const ext=jpeg?"jpg":png?"png":"webp";
 // Reuse the existing Pose Quiz media bucket so both games can resolve signed images.
 // (Sửa 16/10/2026: dòng khai báo này trước đây bị dính vào chú thích nên tải ảnh bị lỗi.)
 const bucket="pose-quiz-media",path=userId+"/shared-bank-images/"+id+"/"+crypto.randomUUID()+"."+ext;
 const {error:upError}=await admin.storage.from(bucket).upload(path,new Blob([await file.arrayBuffer()],{type}),{contentType:type,upsert:false});
 if(upError)throw upError;
 const image={storage:bucket,path,name:"Hình minh họa câu hỏi",type};
 const {error:dbError}=await admin.from("pose_quiz_question_bank").update({question:{...original.question,image},updated_at:new Date().toISOString()})
  .eq("id",id).eq("user_id",userId);
 if(dbError){await admin.storage.from(bucket).remove([path]);throw dbError}
 if(original.question?.image?.storage===bucket&&String(original.question.image.path||"").startsWith(userId+"/shared-bank-images/"+id+"/"))
  await admin.storage.from(bucket).remove([original.question.image.path]);
 return{ok:true,id,imageUrl:await imageUrl({image})};
}
async function deleteQuestionImage(userId:string,body:any){
 const row=await imageOwner(userId,String(body.id||""));
 const old=row.question?.image;
 if(!old?.path)return{ok:true,id:row.id};
 const {error}=await admin.from("pose_quiz_question_bank").update({question:{...row.question,image:null},updated_at:new Date().toISOString()})
  .eq("id",row.id).eq("user_id",userId);
 if(error)throw error;
 // Never delete legacy Pose Quiz images; they may be referenced by other assets.
 if(old.storage==="pose-quiz-media"&&String(old.path||"").startsWith(userId+"/shared-bank-images/"+row.id+"/"))
  await admin.storage.from("pose-quiz-media").remove([old.path]);
 return{ok:true,id:row.id};
}
Deno.serve(async(req:Request)=>{
  if(req.method==="OPTIONS")return new Response("ok",{headers:HEADERS});
  if(req.method!=="POST")return fail("Chỉ hỗ trợ POST.",405);
  try {
    const user=await userFor(req);
    const isForm=(req.headers.get("content-type")||"").includes("multipart/form-data");
    if(isForm) {
      const form=await req.formData();
      if(form.get("action")==="audio.put")return answer(await putAudio(user.id,form));
      if(form.get("action")==="image.put")return answer(await uploadQuestionImage(user.id,form));
      return fail("Thao tác không được hỗ trợ.",400);
    }
    const body=await req.json();
    if(body?.action==="bank.list")return answer(await listQuestions(req,user.id,body));
    if(body?.action==="bank.save")return answer(await saveMany(user.id,{items:[body.item]}));
    if(body?.action==="bank.save_many"){
      const result=await saveMany(user.id,body);
      return answer(result,result.ok?200:207);
    }
    if(body?.action==="bank.delete")return answer(await deleteOne(user.id,body));
    if(body?.action==="image.delete")return answer(await deleteQuestionImage(user.id,body));
    if(body?.action==="audio.delete")return answer(await deleteAudioPart(user.id,body));
    if(body?.action==="audio.delete_all")return answer(await deleteAllQuestionAudio(user.id,body));
    if(body?.action==="audio.overview")return answer(await audioOverview(user.id,body));
    if(body?.action==="audio.list")return answer(await audioList(user.id,body));
    return fail("Lệnh không được hỗ trợ.",400);
  }catch(error:any){
    const message=String(error?.message||"Có lỗi tại ngân hàng câu hỏi.");
    const status=Number(error?.status)||(message.includes("size")?413:500);
    return fail(status>=500?"Dịch vụ ngân hàng học liệu tạm thời gặp lỗi.":message,status);
  }
});
