/* MotionClass · Kho kịch bản lời dẫn dùng chung (trang Quản lý kịch bản, Đua bi và trò chơi sau này).
 * Chỉ dùng publishable key + phiên đăng nhập giáo viên; RLS giới hạn theo chủ sở hữu.
 *
 * Mẫu câu có chỗ trống:
 *   {tên}     → WAV tên học sinh đã lưu
 *   {số}      → số thứ tự câu hỏi, đọc LIỀN với đoạn đứng trước ("trả lời câu hỏi số ba")
 *   {đáp án}  → WAV công bố đáp án của câu hỏi
 *   {chuỗi}   → số bạn đúng liên tiếp (3, 5, 10, 15, 20), đọc liền với đoạn đứng trước
 *   {đúng} {tổng} → số liệu cuối giờ, đọc trực tiếp bằng giọng dự phòng (không tạo trước)
 * Mỗi mẫu được tách thành các ĐOẠN; WAV của đoạn khóa theo SHA-256 nội dung + giọng,
 * nên các kịch bản có đoạn trùng nhau dùng chung WAV, không tốn thêm lượt Google.
 */
(function(){
'use strict';
const config=window.POSE_QUIZ_SUPABASE;
const PHRASE_BUCKET='teacher-phrase-voices';
const MAX_VARIANTS=4,MAX_TEMPLATE=260,MAX_PHRASE=220;
const STREAK_VALUES=[3,5,10,15,20];

const SLOTS=[
 {key:'intro',label:'Mở đầu phần trả lời',hint:'Đọc một lần khi bắt đầu hỏi.',allowed:[]},
 {key:'call',label:'Gọi học sinh',hint:'Bắt buộc có {tên}. Sau câu này, hệ thống phát WAV câu hỏi.',allowed:['tên','số'],required:['tên']},
 {key:'think',label:'Nhắc suy nghĩ',hint:'Đọc sau câu hỏi (bỏ qua nếu WAV đọc cả câu đã có câu nhắc).',allowed:[]},
 {key:'correct',label:'Khi trả lời đúng',hint:'Nên có {đáp án} và {tên}.',allowed:['tên','đáp án']},
 {key:'wrong',label:'Khi trả lời sai',hint:'Nên có {đáp án}.',allowed:['tên','đáp án']},
 {key:'fiveLeft',label:'Còn 5 giây',hint:'Dùng khi bật đồng hồ suy nghĩ.',allowed:[]},
 {key:'timeUp',label:'Hết giờ',hint:'Dùng khi bật đồng hồ suy nghĩ.',allowed:[]},
 {key:'streak',label:'Nhiều bạn đúng liên tiếp',hint:'Dùng {chuỗi}: 3, 5, 10, 15, 20 bạn.',allowed:['chuỗi']},
 {key:'summary',label:'Tổng kết cuối giờ',hint:'{đúng} và {tổng} đọc bằng giọng dự phòng; muốn toàn bộ bằng WAV thì không dùng hai chỗ trống này.',allowed:['đúng','tổng']}
];
const PLACEHOLDER=/\{(tên|số|đáp án|đúng|tổng|chuỗi)\}/gu;
const BOUND=new Set(['số','chuỗi']);

const TEMPLATES=[
 {theme:'am-ap',title:'Ấm áp – nhẹ nhàng',slots:{
  intro:['Tất cả các bạn đã về đích. Bây giờ, chúng ta cùng bước vào phần trả lời câu hỏi nhé!'],
  call:['Mời em {tên} trả lời. Câu hỏi số {số}.','Bây giờ, mời em {tên}. Câu hỏi số {số}.'],
  think:['Em hãy suy nghĩ thật kỹ trước khi trả lời nhé!'],
  correct:['Chính xác! {đáp án} Chúc mừng em {tên}! Em làm rất tốt!','Đúng rồi! {đáp án} Chúc mừng em {tên}! Em thật xuất sắc!'],
  wrong:['Chưa chính xác rồi. {đáp án} Em cần cố gắng hơn nhé!','Rất tiếc, chưa đúng rồi. {đáp án} Không sao cả, lần sau em sẽ làm tốt hơn!'],
  fiveLeft:['Còn năm giây!'],timeUp:['Hết giờ! Mời em chọn đáp án.'],
  streak:['Đã có {chuỗi} bạn liên tiếp trả lời đúng. Cả lớp thật tuyệt vời!'],
  summary:['Chúng ta đã hoàn thành phần trả lời câu hỏi. Cảm ơn các em đã tham gia, chúc các em học thật tốt!']}},
 {theme:'duong-dua',title:'Đường đua sôi động',slots:{
  intro:['Các tay đua đã về đích! Bây giờ là vòng đua trí tuệ, các em đã sẵn sàng chưa?'],
  call:['Tay đua {tên} ơi, mời em trả lời. Câu hỏi số {số}.'],
  think:['Bình tĩnh nào, hãy suy nghĩ thật kỹ rồi mới chọn nhé!'],
  correct:['Tuyệt vời! {đáp án} Tay đua {tên} đã về đích với đáp án đúng!','Xuất sắc! {đáp án} Chúc mừng tay đua {tên}!'],
  wrong:['Ôi, tiếc quá! {đáp án} Vòng sau em sẽ tăng tốc tốt hơn nhé!'],
  fiveLeft:['Năm giây cuối cùng!'],timeUp:['Hết giờ rồi! Tay đua hãy chọn đáp án nào.'],
  streak:['{chuỗi} tay đua liên tiếp trả lời đúng. Cả đoàn đua thật đỉnh!'],
  summary:['Vòng đua trí tuệ đã kết thúc. Cảm ơn tất cả các tay đua!']}},
 {theme:'nha-khoa-hoc',title:'Nhà khoa học nhí',slots:{
  intro:['Phòng thí nghiệm tri thức đã mở cửa! Các nhà khoa học nhí, chúng ta bắt đầu nhé!'],
  call:['Nhà khoa học nhí {tên}, mời em trả lời. Câu hỏi số {số}.'],
  think:['Hãy quan sát và suy luận thật cẩn thận nhé!'],
  correct:['Thí nghiệm thành công! {đáp án} Giỏi lắm, nhà khoa học {tên}!'],
  wrong:['Thí nghiệm chưa thành công. {đáp án} Nhà khoa học nào cũng cần thử lại, em cố lên nhé!'],
  fiveLeft:['Còn năm giây!'],timeUp:['Hết giờ quan sát! Mời em đưa ra kết luận.'],
  streak:['Đã có {chuỗi} nhà khoa học liên tiếp tìm ra đáp án đúng!'],
  summary:['Buổi thí nghiệm hôm nay đã kết thúc. Cảm ơn các nhà khoa học nhí!']}},
 {theme:'phieu-luu',title:'Phiêu lưu tìm kho báu',slots:{
  intro:['Chuyến phiêu lưu tìm kho báu tri thức bắt đầu!'],
  call:['Mời em {tên} mở khóa kho báu. Câu hỏi số {số}.'],
  think:['Kho báu chỉ mở với đáp án đúng, em hãy suy nghĩ thật kỹ nhé!'],
  correct:['Mở khóa thành công! {đáp án} Hoan hô {tên}!'],
  wrong:['Kho báu chưa mở rồi. {đáp án} Mình cùng cố gắng ở câu sau nhé!'],
  fiveLeft:['Còn năm giây!'],timeUp:['Hết giờ! Mời em chọn chìa khóa.'],
  streak:['{chuỗi} nhà thám hiểm liên tiếp đã mở được kho báu!'],
  summary:['Chuyến phiêu lưu hôm nay đã kết thúc. Cảm ơn các nhà thám hiểm!']}}
];

/* Kịch bản dựng sẵn — Đua bi dùng khi chưa có kịch bản, và lấy mục còn trống của kịch bản giáo viên từ đây. */
const BUILTIN={id:'builtin',title:'Mặc định (có sẵn)',slots:{
 intro:['Tất cả các bạn đã về đích. Bây giờ, chúng ta cùng bước vào phần trả lời câu hỏi nhé!'],
 call:['Mời em {tên} trả lời. Câu hỏi số {số}.'],
 think:['Em hãy suy nghĩ thật kỹ trước khi trả lời nhé!'],
 correct:['Chính xác! {đáp án} Chúc mừng em {tên}! Em làm rất tốt!','Đúng rồi! {đáp án} Chúc mừng em {tên}! Em thật xuất sắc!','Rất chính xác! {đáp án} Chúc mừng em {tên}! Cả lớp cho bạn một tràng pháo tay nào!'],
 wrong:['Chưa chính xác rồi. {đáp án} Em cần cố gắng hơn nhé!','Rất tiếc, chưa đúng rồi. {đáp án} Không sao cả, lần sau em sẽ làm tốt hơn!','Chưa chính xác rồi. {đáp án} Em hãy ghi nhớ đáp án này nhé!'],
 fiveLeft:['Còn năm giây!'],timeUp:['Hết giờ! Mời em chọn đáp án.'],
 streak:['Đã có {chuỗi} bạn liên tiếp trả lời đúng. Cả lớp thật tuyệt vời!'],
 summary:['Cả lớp đã trả lời đúng {đúng} trên {tổng} câu hỏi. Cảm ơn các em đã tham gia, chúc các em học thật tốt!'],
 options:{maxNumber:20}}};

const norm=s=>String(s||'').normalize('NFC').replace(/\s+/g,' ').trim();
const DIGITS=['không','một','hai','ba','bốn','năm','sáu','bảy','tám','chín'];
function numberWords(n){
 n=Math.floor(Number(n));
 if(!Number.isFinite(n)||n<0||n>99)return String(n);
 if(n<10)return DIGITS[n];
 const tens=Math.floor(n/10),unit=n%10;
 const head=tens===1?'mười':DIGITS[tens]+' mươi';
 if(!unit)return head;
 if(unit===5)return head+' lăm';
 if(unit===1&&tens>1)return head+' mốt';
 if(unit===4&&tens>1)return head+' tư';
 return head+' '+DIGITS[unit];
}
function stripLeadPunct(s){return s.replace(/^[\s,.;:!?…-]+/u,'')}
function hasWords(s){return /[\p{L}\p{N}]/u.test(s)}
const BOUND_WORDS=3;
/** Tách một mẫu thành các token phát lần lượt.
 *  {số}/{chuỗi} chỉ đọc liền với tối đa 3 từ sát bên ("câu hỏi số ba"), phần còn lại là đoạn riêng,
 *  để mọi kịch bản có cụm "câu hỏi số {số}" dùng CHUNG một bộ WAV số thứ tự. */
function tokenize(template){
 const src=norm(template);let last=0,m;PLACEHOLDER.lastIndex=0;
 const pieces=[];
 while((m=PLACEHOLDER.exec(src))){pieces.push({type:'text',text:src.slice(last,m.index)});pieces.push({type:'slot',key:m[1]});last=m.index+m[0].length}
 pieces.push({type:'text',text:src.slice(last)});
 // Gắn từ lân cận vào chỗ trống số.
 for(let i=0;i<pieces.length;i++){
  const p=pieces[i];if(p.type!=='slot'||!BOUND.has(p.key))continue;
  const before=pieces[i-1],after=pieces[i+1];
  const tailMatch=after?.text.match(/^\s*([,.;:!?…]+)/u);
  p.tail=tailMatch?tailMatch[1]:'';if(tailMatch)after.text=after.text.slice(tailMatch[0].length);
  const clause=before?before.text.replace(/\s+$/u,''):'';
  const cut=Math.max(clause.lastIndexOf(','),clause.lastIndexOf('.'),clause.lastIndexOf('!'),clause.lastIndexOf('?'),clause.lastIndexOf(';'),clause.lastIndexOf(':'));
  const words=clause.slice(cut+1).trim().split(' ').filter(Boolean);
  if(words.length){
   const take=words.slice(-BOUND_WORDS);p.prefix=take.join(' ');
   before.text=clause.slice(0,cut+1)+' '+words.slice(0,words.length-take.length).join(' ');
   p.suffix='';
  }else{
   // Mẫu bắt đầu bằng số: gắn với các từ đứng sau ("ba tay đua").
   p.prefix='';
   const next=after?after.text.trim().split(' ').filter(Boolean):[];
   if(!tailMatch&&next.length){const take=next.slice(0,BOUND_WORDS-1);p.suffix=take.join(' ');after.text=next.slice(take.length).join(' ')}
   else p.suffix='';
  }
 }
 const out=[];
 for(const p of pieces){
  if(p.type==='text'){const text=norm(stripLeadPunct(p.text));if(text&&hasWords(text))out.push({type:'text',text})}
  else if(BOUND.has(p.key))out.push({type:'bound',key:p.key,prefix:p.prefix,suffix:p.suffix,tail:p.tail});
  else out.push({type:p.key==='tên'?'name':p.key==='đáp án'?'answer':'number',key:p.key});
 }
 return out;
}
function boundText(token,value){return norm([token.prefix,numberWords(value),token.suffix].filter(Boolean).join(' ')+(token.tail||''))}
function validateTemplate(slotKey,template){
 const slot=SLOTS.find(s=>s.key===slotKey);if(!slot)throw Error('Mục kịch bản không hợp lệ.');
 const text=norm(template);
 if(!text)return null;
 if(text.length>MAX_TEMPLATE)throw Error(slot.label+': mỗi câu tối đa '+MAX_TEMPLATE+' ký tự.');
 const used=[...text.matchAll(PLACEHOLDER)].map(m=>m[1]);
 const stray=text.replace(PLACEHOLDER,'').match(/\{[^}]*\}/u);
 if(stray)throw Error(slot.label+': chỗ trống “'+stray[0]+'” không được hỗ trợ.');
 for(const key of used)if(!slot.allowed.includes(key))throw Error(slot.label+': không dùng được {'+key+'} ở mục này.');
 for(const key of slot.required||[])if(!used.includes(key))throw Error(slot.label+': cần có {'+key+'}.');
 for(const t of tokenize(text))if((t.type==='text'&&t.text.length>MAX_PHRASE)||(t.type==='bound'&&(t.prefix+t.suffix).length>MAX_PHRASE-20))throw Error(slot.label+': đoạn giữa hai chỗ trống quá dài.');
 return text;
}
function cleanScript(input){
 const title=norm(input.title).slice(0,80);if(!title)throw Error('Cần đặt tên kịch bản.');
 const slots={};
 for(const slot of SLOTS){
  const list=(Array.isArray(input.slots?.[slot.key])?input.slots[slot.key]:[]).map(t=>validateTemplate(slot.key,t)).filter(Boolean);
  if(list.length>MAX_VARIANTS)throw Error(slot.label+': tối đa '+MAX_VARIANTS+' cách nói.');
  slots[slot.key]=[...new Set(list)];
 }
 if(!slots.call.length)throw Error('Kịch bản cần ít nhất một câu gọi học sinh có {tên}.');
 const maxNumber=Math.max(1,Math.min(60,Math.floor(Number(input.slots?.options?.maxNumber??input.maxNumber)||20)));
 slots.options={maxNumber};
 return{title,theme:norm(input.theme||'custom').slice(0,40)||'custom',slots,isActive:input.isActive!==false};
}
/** Mọi đoạn cần có WAV của một kịch bản (không trùng lặp). */
/** Sắc thái đọc của từng đoạn (dùng khi tạo giọng biểu cảm, ví dụ giọng Microsoft):
 *  câu nhận xét đúng: mở đầu "cheer" → "Chúc mừng em" "congrats" → lời khen "praise";
 *  câu nhận xét sai: mở đầu "soft" → lời động viên "encourage". */
const SLOT_STYLE={intro:'lively',call:'neutral',think:'neutral',fiveLeft:'alert',timeUp:'alert',streak:'lively',summary:'lively'};
function tokenStyles(slotKey,tokens){
 if(slotKey!=='correct'&&slotKey!=='wrong')return tokens.map(()=>SLOT_STYLE[slotKey]||'neutral');
 const ai=tokens.findIndex(t=>t.type==='answer'),ni=tokens.findIndex((t,i)=>t.type==='name'&&i>ai);
 return tokens.map((t,i)=>{
  if(slotKey==='wrong')return (ai>=0?i<ai:i===tokens.findIndex(x=>x.type==='text'))?'soft':'encourage';
  if(ai>=0?i<ai:i===tokens.findIndex(x=>x.type==='text'))return 'cheer';
  if(ni>=0&&i<ni)return 'congrats';
  return 'praise';
 });
}
/** opts.maxNumber ghi đè số lớn nhất cần đọc ({số}, {đúng}, {tổng}) — trang Giọng thống nhất dùng
 *  số câu hỏi/học sinh thực tế để không thiếu "Câu hỏi số hai mươi mốt" hay "ba mươi tư". */
function scriptPhrases(script,opts={}){
 const set=new Map(),max=Math.max(1,Math.min(99,Math.floor(Number(opts.maxNumber||script.slots?.options?.maxNumber||20))));
 const add=(text,meta)=>{const t=norm(text);if(t&&!set.has(t))set.set(t,meta)};
 for(const slot of SLOTS)for(const template of script.slots?.[slot.key]||[]){
  const tokens=tokenize(template),styles=tokenStyles(slot.key,tokens);
  tokens.forEach((tok,i)=>{
   if(tok.type==='text')add(tok.text,{slot:slot.key,style:styles[i]});
   else if(tok.type==='bound'){
    const values=tok.key==='chuỗi'?STREAK_VALUES:Array.from({length:max},(_,i)=>i+1);
    for(const v of values)add(boundText(tok,v),{slot:slot.key,number:v,style:styles[i]});
   }else if(tok.type==='number'&&opts.scoreNumbers){
    // {đúng}/{tổng} cuối giờ: đọc số đứng riêng, từ "không" đến số lớn nhất. Chỉ khi yêu cầu
    // (giọng Microsoft miễn phí); trang Kịch bản/Google không tạo để tiết kiệm lượt gọi.
    for(let v=0;v<=max;v++)add(numberWords(v),{slot:slot.key,number:v,style:styles[i]});
   }
  });
 }
 return [...set.entries()].map(([text,meta])=>({text,...meta}));
}

function client(){
 if(!window.supabase?.createClient||!config?.url||!config?.publishableKey)throw Error('Không tải được Supabase. Kiểm tra Internet và thử lại.');
 return window.supabase.createClient(config.url,config.publishableKey,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}});
}
function err(result){if(result.error)throw Error(result.error.message||'Không thể truy cập MotionClass.');return result.data}
async function user(c){const {data,error}=await c.auth.getUser();if(error||!data.user)throw Error('Cần đăng nhập tài khoản MotionClass.');return data.user}
async function hashText(value){
 const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(norm(value)));
 return Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,'0')).join('');
}
function validateVoice(voice){if(!/^(studio:[0-9a-f]{16}|nghi:[a-z0-9]{2,45}|edge:[a-z0-9-]{2,45})$/.test(String(voice)))throw Error('Mã giọng đọc không hợp lệ.');return voice}
const assertId=id=>{if(!/^[0-9a-f-]{36}$/i.test(String(id)))throw Error('Mã kịch bản không hợp lệ.');return id};
function fromRow(r){return{id:r.id,title:r.title,theme:r.theme,slots:r.slots||{},isActive:r.is_active!==false,sortOrder:r.sort_order||0,updatedAt:r.updated_at}}

async function listScripts(c){
 await user(c);
 return err(await c.from('teacher_voice_scripts').select('id,title,theme,slots,is_active,sort_order,updated_at')
  .order('sort_order',{ascending:true}).order('created_at',{ascending:true}).limit(60)).map(fromRow);
}
async function saveScript(c,input,id=null){
 await user(c);const v=cleanScript(input);
 const row={title:v.title,theme:v.theme,slots:v.slots,is_active:v.isActive,updated_at:new Date().toISOString()};
 const q=id?c.from('teacher_voice_scripts').update(row).eq('id',assertId(id)):c.from('teacher_voice_scripts').insert(row);
 return fromRow(err(await q.select('id,title,theme,slots,is_active,sort_order,updated_at').single()));
}
async function deleteScript(c,id){await user(c);err(await c.from('teacher_voice_scripts').delete().eq('id',assertId(id)));return true}

async function listPhraseAudio(c,{voiceId=null,sign=true}={}){
 await user(c);
 let q=c.from('teacher_phrase_audio').select('id,voice_id,text_hash,phrase,storage_path,size_bytes,updated_at').limit(2000);
 if(voiceId)q=q.eq('voice_id',validateVoice(voiceId));
 const rows=err(await q);
 let urls=[];
 if(sign&&rows.length){
  for(let i=0;i<rows.length;i+=200){
   const {data,error}=await c.storage.from(PHRASE_BUCKET).createSignedUrls(rows.slice(i,i+200).map(r=>r.storage_path),3600);
   if(error)throw Error('Không lấy được đường dẫn WAV câu dẫn: '+error.message);
   urls.push(...(data||[]));
  }
 }
 return rows.map((r,i)=>({id:r.id,voiceId:r.voice_id,textHash:r.text_hash,phrase:r.phrase,storagePath:r.storage_path,sizeBytes:r.size_bytes,
  updatedAt:r.updated_at,url:sign?(urls[i]?.error?null:urls[i]?.signedUrl||null):null}));
}
async function savePhraseAudio(c,{voiceId,phrase,blob}){
 const u=await user(c);validateVoice(voiceId);
 const text=norm(phrase);if(!text||text.length>MAX_PHRASE)throw Error('Đoạn câu dẫn không hợp lệ.');
 if(!(blob instanceof Blob)||blob.size<45||blob.size>3*1024*1024)throw Error('WAV câu dẫn phải từ 45 byte đến 3 MB.');
 const head=new Uint8Array(await blob.slice(0,12).arrayBuffer());
 if(String.fromCharCode(...head.slice(0,4))!=='RIFF'||String.fromCharCode(...head.slice(8,12))!=='WAVE')throw Error('Tệp không phải WAV hợp lệ.');
 const textHash=await hashText(text),folder=voiceId.replace(':','-');
 // Tên tệp mới mỗi lần lưu: tạo lại một đoạn không bị bộ đệm trình duyệt/CDN phát nhầm WAV cũ.
 const old=err(await c.from('teacher_phrase_audio').select('storage_path').eq('voice_id',voiceId).eq('text_hash',textHash).limit(1));
 const path=u.id+'/'+folder+'/'+textHash+'-'+crypto.randomUUID().slice(0,8)+'.wav';
 err(await c.storage.from(PHRASE_BUCKET).upload(path,new Blob([await blob.arrayBuffer()],{type:'audio/wav'}),{contentType:'audio/wav',upsert:true,cacheControl:'3600'}));
 try{
  err(await c.from('teacher_phrase_audio').upsert({owner_id:u.id,voice_id:voiceId,text_hash:textHash,phrase:text,storage_path:path,
   size_bytes:blob.size,updated_at:new Date().toISOString()},{onConflict:'owner_id,voice_id,text_hash'}));
 }catch(e){await c.storage.from(PHRASE_BUCKET).remove([path]).catch(()=>{});throw e}
 const stale=(old||[]).map(r=>r.storage_path).filter(x=>x&&x!==path);
 if(stale.length)await c.storage.from(PHRASE_BUCKET).remove(stale).catch(()=>{});
 return{voiceId,textHash,phrase:text,storagePath:path};
}
async function deletePhraseAudio(c,row){
 await user(c);
 err(await c.from('teacher_phrase_audio').delete().eq('id',assertId(row.id)));
 if(row.storagePath)await c.storage.from(PHRASE_BUCKET).remove([row.storagePath]).catch(()=>{});
 return true;
}

window.TeacherScriptStore={SLOTS,BUILTIN,tokenStyles,TEMPLATES,STREAK_VALUES,createClient:client,user,norm,numberWords,tokenize,boundText,validateTemplate,cleanScript,
 scriptPhrases,hashText,listScripts,saveScript,deleteScript,listPhraseAudio,savePhraseAudio,deletePhraseAudio};
})();
