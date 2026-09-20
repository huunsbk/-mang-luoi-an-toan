const QRCode=require('qrcode');
module.exports=async function handler(req,res){
  res.setHeader('Cache-Control','no-store');
  if(req.method!=='GET') return res.status(405).send('Method not allowed');
  const text=String(req.query.text||'').slice(0,1200);
  if(!text) return res.status(400).send('Missing text');
  try{
    const svg=await QRCode.toString(text,{type:'svg',errorCorrectionLevel:'M',margin:2,width:300,color:{dark:'#173b6d',light:'#ffffff'}});
    res.setHeader('Content-Type','image/svg+xml; charset=utf-8');
    return res.status(200).send(svg);
  }catch(e){return res.status(500).send('QR error')}
}