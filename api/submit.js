const SUPABASE_URL='https://ykckqcykxfhpfqptckxk.supabase.co';
const API_KEY='sb_publishable_2pfQHPjlGmtgOgGO0qaHXA_zGrwUZwT';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
module.exports=async function handler(req,res){
  res.setHeader('Cache-Control','no-store');
  if(req.method!=='POST') return res.status(405).json({error:'Method not allowed'});
  const b=typeof req.body==='string'?JSON.parse(req.body||'{}'):(req.body||{});
  const room=String(b.room||''),participant=String(b.participant||''),name=String(b.name||'').trim(),answer=String(b.answer||'').trim();
  if(!UUID.test(room)||!UUID.test(participant)) return res.status(400).json({error:'Mã kết nối không hợp lệ'});
  if(name.length<1||name.length>50) return res.status(400).json({error:'Tên phải có từ 1 đến 50 ký tự'});
  if(answer.length<2||answer.length>180) return res.status(400).json({error:'Câu trả lời phải có từ 2 đến 180 ký tự'});
  try{
    const r=await fetch(SUPABASE_URL+'/rest/v1/rpc/safety_submit_answer',{method:'POST',headers:{'Content-Type':'application/json','apikey':API_KEY},body:JSON.stringify({p_room_id:room,p_participant_id:participant,p_name:name,p_answer:answer})});
    const text=await r.text();
    if(!r.ok) throw new Error(text||('Supabase '+r.status));
    return res.status(200).json({ok:true});
  }catch(e){return res.status(502).json({error:'Không gửi được câu trả lời',detail:String(e.message||e).slice(0,180)})}
}