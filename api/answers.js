const SUPABASE_URL='https://ykckqcykxfhpfqptckxk.supabase.co';
const API_KEY='sb_publishable_2pfQHPjlGmtgOgGO0qaHXA_zGrwUZwT';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
module.exports=async function handler(req,res){
  res.setHeader('Cache-Control','no-store');
  if(req.method!=='GET') return res.status(405).json({error:'Method not allowed'});
  const room=String(req.query.room||'');
  if(!UUID.test(room)) return res.status(400).json({error:'Mã phòng không hợp lệ'});
  try{
    const r=await fetch(SUPABASE_URL+'/rest/v1/rpc/safety_get_answers',{method:'POST',headers:{'Content-Type':'application/json','apikey':API_KEY},body:JSON.stringify({p_room_id:room})});
    const text=await r.text();
    if(!r.ok) throw new Error(text||('Supabase '+r.status));
    const answers=text?JSON.parse(text):[];
    return res.status(200).json({ok:true,answers});
  }catch(e){return res.status(502).json({error:'Không đọc được dữ liệu lớp học',detail:String(e.message||e).slice(0,180)})}
}