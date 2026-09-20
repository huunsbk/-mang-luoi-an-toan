const SUPABASE_URL='https://ykckqcykxfhpfqptckxk.supabase.co';
const API_KEY='sb_publishable_2pfQHPjlGmtgOgGO0qaHXA_zGrwUZwT';
const ROOM='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const PERSON='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
async function rpc(name,body){const r=await fetch(SUPABASE_URL+'/rest/v1/rpc/'+name,{method:'POST',headers:{'Content-Type':'application/json','apikey':API_KEY},body:JSON.stringify(body)});const t=await r.text();if(!r.ok)throw new Error(t||('HTTP '+r.status));return t?JSON.parse(t):null}
module.exports=async function handler(req,res){
  res.setHeader('Cache-Control','no-store');
  if(req.method!=='GET') return res.status(405).json({ok:false});
  const started=Date.now();
  try{
    await rpc('safety_submit_answer',{p_room_id:ROOM,p_participant_id:PERSON,p_name:'Health Check',p_answer:'Kết nối hệ thống hoạt động'});
    const rows=await rpc('safety_get_answers',{p_room_id:ROOM});
    const pass=Array.isArray(rows)&&rows.some(x=>x.participant_id===PERSON&&x.answer==='Kết nối hệ thống hoạt động');
    return res.status(pass?200:503).json({ok:pass,app:'mang-luoi-an-toan',version:'2.1.0',database:pass?'ok':'mismatch',latency_ms:Date.now()-started});
  }catch(e){return res.status(503).json({ok:false,app:'mang-luoi-an-toan',version:'2.1.0',database:'error',error:String(e.message||e).slice(0,200)})}
}