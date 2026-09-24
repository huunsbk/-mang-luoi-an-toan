import { chromium, webkit } from 'playwright';

const BASE='http://127.0.0.1:4180';
const MODULE=BASE+'/mang-luoi-an-toan/';

async function run(browserType,name){
  const browser=await browserType.launch({headless:true});
  const context=await browser.newContext({locale:'vi-VN'});
  const host=await context.newPage();
  const errors=[];
  host.on('pageerror',e=>errors.push('host: '+String(e)));

  await host.goto(MODULE,{waitUntil:'domcontentloaded',timeout:60000});
  await host.locator('.title').filter({hasText:'BẢN ĐỒ PHẢN HỒI'}).waitFor();

  const question='Điều gì giúp buổi học trở nên hiệu quả hơn?';
  await host.locator('#operatorQuestion').fill(question);
  await host.locator('#wordLimit').fill('5');
  await host.locator('#startQuestion').click();
  await host.getByText(/Phòng đã mở/i).waitFor({timeout:30000});

  const joinUrl=await host.locator('#joinUrl').innerText();
  if(!joinUrl.includes('?room=')) throw new Error(name+': join URL missing room');

  const participant=await context.newPage();
  participant.on('pageerror',e=>errors.push('participant: '+String(e)));
  await participant.goto(joinUrl,{waitUntil:'domcontentloaded',timeout:60000});
  await participant.getByRole('heading',{name:'Bản đồ phản hồi'}).waitFor();
  await participant.locator('#name').fill('Nguyễn Văn Kiểm Thử');
  await participant.locator('#answer').fill('HỢP TÁC TÍCH CỰC');
  await participant.locator('#send').click();
  await participant.getByText('Đã gửi phản hồi!').waitFor({timeout:30000});

  await host.waitForFunction(()=>document.querySelector('#cnt')?.textContent==='1',{timeout:30000});
  await host.getByText('Nguyễn Văn Kiểm Thử',{exact:true}).waitFor({timeout:30000});

  host.once('dialog', async d=>{
    if(d.type()!=='prompt') throw new Error(name+': expected save title prompt');
    await d.accept('Phiên phản hồi QA '+name);
  });
  await host.locator('#saveResult').click();
  await host.getByText('✅ ĐÃ LƯU',{exact:true}).waitFor({timeout:30000});

  const libraryToken=await host.evaluate(()=>localStorage.getItem('feedback_library_token'));
  if(!libraryToken || !/^[0-9a-f-]{36}$/i.test(libraryToken)) throw new Error(name+': library token not persisted');

  // Reload proves history survives the live room/page session.
  await host.reload({waitUntil:'domcontentloaded'});
  await host.locator('#history').click();
  await host.getByText('Phiên phản hồi QA '+name,{exact:true}).waitFor({timeout:30000});
  await host.getByText(/1 người tham gia/).waitFor();

  // Rename.
  host.once('dialog',async d=>{await d.accept('Phiên đã đổi tên '+name)});
  await host.getByRole('button',{name:/Đổi tên/i}).click();
  await host.getByText('Phiên đã đổi tên '+name,{exact:true}).waitFor({timeout:30000});

  // Open the archived snapshot.
  await host.getByRole('button',{name:/Mở lại/i}).click();
  await host.getByText(/Đang xem kết quả đã lưu/i).waitFor({timeout:30000});
  await host.getByText('Nguyễn Văn Kiểm Thử',{exact:true}).waitFor();
  await host.getByText('HỢP TÁC TÍCH CỰC',{exact:true}).waitFor();
  if((await host.locator('#operatorQuestion').inputValue())!==question) throw new Error(name+': archived question not restored');
  if((await host.locator('#roomCode').innerText()).trim()!=='ĐÃ LƯU') throw new Error(name+': archived mode marker missing');

  // Open history again and delete.
  await host.locator('#history').click();
  await host.getByText('Phiên đã đổi tên '+name,{exact:true}).waitFor();
  host.once('dialog',async d=>{if(d.type()!=='confirm') throw new Error(name+': expected delete confirmation');await d.accept()});
  await host.getByRole('button',{name:/Xóa/i}).click();
  await host.getByText(/Chưa có kết quả nào được lưu/i).waitFor({timeout:30000});

  if(errors.length) throw new Error(name+' page errors: '+errors.join(' | '));
  console.log('FEEDBACK_RESULT_HISTORY_'+name.toUpperCase()+'_PASS');
  await browser.close();
}

await run(chromium,'chromium');
await run(webkit,'webkit');
