import { chromium, webkit } from 'playwright';

const BASE='http://127.0.0.1:4173';
const ROOM='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

async function run(browserType,name){
  const browser=await browserType.launch({headless:true});
  const page=await browser.newPage({viewport:{width:1280,height:900}});
  const errors=[];
  page.on('pageerror',e=>errors.push(String(e)));

  await page.goto(BASE+'/',{waitUntil:'networkidle'});
  await page.getByText('Bản đồ phản hồi',{exact:true}).first().waitFor();
  await page.getByRole('link',{name:/MỞ BẢN ĐỒ PHẢN HỒI/i}).click();
  await page.waitForURL('**/mang-luoi-an-toan/');
  const hostTitle=page.locator('.title');
  await hostTitle.waitFor();
  if(!((await hostTitle.innerText()).replace(/\s+/g,' ').trim().includes('BẢN ĐỒ PHẢN HỒI'))) throw new Error(name+': host title not renamed');
  if((await page.title())!=='Bản đồ phản hồi') throw new Error(name+': wrong document title: '+await page.title());
  const body=(await page.locator('body').innerText()).toLowerCase();
  for(const old of ['mạng lưới an toàn','tập huấn bảo vệ trẻ em','tên của thầy/cô','mời thầy cô']){
    if(body.includes(old)) throw new Error(name+': legacy wording still visible: '+old);
  }

  await page.route('**/api/room?room=*',async route=>{
    await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({
      ok:true,
      room:{room_id:ROOM,question:'Một điều bạn muốn chia sẻ hôm nay là gì?',word_limit:5,created_at:new Date().toISOString(),updated_at:new Date().toISOString()}
    })});
  });
  await page.goto(BASE+'/mang-luoi-an-toan/?room='+ROOM,{waitUntil:'networkidle'});
  await page.getByRole('heading',{name:'Bản đồ phản hồi'}).waitFor();
  await page.getByText('Tên người tham gia',{exact:true}).waitFor();
  const input=page.locator('#name');
  if((await input.getAttribute('placeholder'))!=='Nhập tên người tham gia') throw new Error(name+': participant placeholder not renamed');
  const joinBody=(await page.locator('body').innerText()).toLowerCase();
  if(joinBody.includes('thầy/cô')||joinBody.includes('thầy cô')) throw new Error(name+': teacher wording remains in participant screen');

  if(errors.length) throw new Error(name+': page errors: '+errors.join(' | '));
  console.log('FEEDBACK_MAP_'+name.toUpperCase()+'_PASS');
  await browser.close();
}

await run(chromium,'chromium');
await run(webkit,'webkit');
