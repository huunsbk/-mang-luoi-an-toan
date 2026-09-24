import { chromium, webkit } from 'playwright';

const APP_URL='http://127.0.0.1:4173/mang-luoi-an-toan/';
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9WlZkAAAAASUVORK5CYII=','base64');

const rows=[
  ['1','NGƯỜI LỚN ĐÁNG TIN CẬY LUÔN LẮNG NGHE VÀ HỖ TRỢ','Nguyễn Thị Minh Hằng giáo viên chủ nhiệm'],
  ['2','NGƯỜI LỚN ĐÁNG TIN CẬY LUÔN LẮNG NGHE VÀ HỖ TRỢ','Trần Hoàng Phương Anh'],
  ['3','NGƯỜI LỚN ĐÁNG TIN CẬY LUÔN LẮNG NGHE VÀ HỖ TRỢ','Lương Thị Ngọc Ánh trường PTDTBT'],
  ['4','NGƯỜI LỚN ĐÁNG TIN CẬY LUÔN LẮNG NGHE VÀ HỖ TRỢ','Nông Văn Thành'],
  ['5','NGƯỜI LỚN ĐÁNG TIN CẬY LUÔN LẮNG NGHE VÀ HỖ TRỢ','Hoàng Thị Thu Phương giáo viên cốt cán'],
  ['6','TỔNG ĐÀI QUỐC GIA BẢO VỆ TRẺ EM 111','Nguyễn Văn Hùng'],
  ['7','TỔNG ĐÀI QUỐC GIA BẢO VỆ TRẺ EM 111','Bàn Thị Hương Giang'],
  ['8','THẦY CÔ GIÁO VÀ NHÀ TRƯỜNG','Ma Thị Thanh Huyền'],
  ['9','CHA MẸ NGƯỜI CHĂM SÓC','Nguyễn Thị Thuỳ Dương'],
  ['10','CÔNG AN VÀ CƠ QUAN CHỨC NĂNG','Triệu Văn Quang'],
  ['11','BẠN BÈ ĐÁNG TIN CẬY','Đặng Thị Lan Anh'],
  ['12','TRUNG TÂM CÔNG TÁC XÃ HỘI','Phạm Văn Dũng'],
  ['13','CƠ SỞ Y TẾ GẦN NHẤT','Lý Thị Mai Hương'],
  ['14','ĐƯỜNG DÂY HỖ TRỢ AN TOÀN TRÊN MÔI TRƯỜNG MẠNG','Nguyễn Thị Phương Thảo'],
  ['15','ĐƯỜNG DÂY HỖ TRỢ AN TOÀN TRÊN MÔI TRƯỜNG MẠNG','Hoàng Văn Đức'],
  ['16','NGƯỜI CÓ TRÁCH NHIỆM TRONG CỘNG ĐỒNG','Dương Thị Bích Ngọc'],
  ['17','TỔ CHỨC BẢO VỆ TRẺ EM TẠI ĐỊA PHƯƠNG','Nông Thị Thu Trang'],
  ['18','NGƯỜI THÂN TRONG GIA ĐÌNH','Vi Thị Hồng Nhung']
].map(([id,answer,name],i)=>({
  id:'00000000-0000-4000-8000-'+String(100000000000+i).padStart(12,'0'),
  answer,
  participant_name:name,
  created_at:'2026-09-24T01:'+String(i).padStart(2,'0')+':00Z'
}));

function intersect(a,b,pad=2){
  return a.x < b.x+b.width-pad && a.x+a.width > b.x+pad &&
         a.y < b.y+b.height-pad && a.y+a.height > b.y+pad;
}

async function run(browserType,name){
  const browser=await browserType.launch({headless:true});
  const page=await browser.newPage({viewport:{width:1440,height:1050}});
  const pageErrors=[];
  page.on('pageerror',e=>pageErrors.push(String(e)));

  await page.route('**/api/room',async route=>{
    if(route.request().method()==='POST') return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({ok:true})});
    return route.continue();
  });
  await page.route('**/api/answers?**',async route=>{
    await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({answers:rows})});
  });
  await page.route('**/api/qr?**',async route=>{
    await route.fulfill({status:200,contentType:'image/png',body:png});
  });

  await page.goto(APP_URL,{waitUntil:'domcontentloaded',timeout:60000});
  await page.locator('#operatorQuestion').fill('Khi cần hỗ trợ để bảo đảm an toàn cho trẻ em, thầy cô có thể tìm đến ai hoặc nơi nào?');
  await page.locator('#wordLimit').fill('20');
  await page.locator('#startQuestion').click();
  await page.waitForFunction(()=>document.querySelector('#cnt')?.textContent==='18',{timeout:30000});
  await page.waitForTimeout(500);

  const report=await page.evaluate(()=>{
    const svg=document.querySelector('#net');
    const boxInfo=el=>{const b=el.getBBox();return{x:b.x,y:b.y,width:b.width,height:b.height}};
    const keywordChecks=[...document.querySelectorAll('.keywordGroup')].map(g=>{
      const rect=g.querySelector('.keywordNode').getBBox();
      const text=g.querySelector('.keywordText')?.getBBox();
      return{
        key:g.getAttribute('data-key'),
        rect:{x:rect.x,y:rect.y,width:rect.width,height:rect.height},
        text:text?{x:text.x,y:text.y,width:text.width,height:text.height}:null,
        content:g.querySelector('.keywordText')?.textContent||''
      };
    });
    const peopleChecks=[...document.querySelectorAll('.personGroup')].map(g=>{
      const rect=g.querySelector('.personNode').getBBox();
      const text=g.querySelector('.personText')?.getBBox();
      return{
        rect:{x:rect.x,y:rect.y,width:rect.width,height:rect.height},
        text:text?{x:text.x,y:text.y,width:text.width,height:text.height}:null,
        content:g.querySelector('.personText')?.textContent||''
      };
    });
    return{
      viewHeight:svg.viewBox.baseVal.height,
      clusters:[...document.querySelectorAll('.clusterGroup')].map(boxInfo),
      keywordChecks,
      peopleChecks,
      keywordCount:document.querySelectorAll('.keywordGroup').length,
      personCount:document.querySelectorAll('.personGroup').length
    };
  });

  if(report.keywordCount!==12) throw new Error(name+': expected 12 keyword groups, got '+report.keywordCount);
  if(report.personCount!==18) throw new Error(name+': expected 18 participant boxes, got '+report.personCount);
  if(report.viewHeight<=700) throw new Error(name+': SVG did not grow for dense content: '+report.viewHeight);

  for(const item of report.keywordChecks){
    if(!item.text) throw new Error(name+': missing keyword text');
    if(item.text.x < item.rect.x-1 || item.text.x+item.text.width > item.rect.x+item.rect.width+1 ||
       item.text.y < item.rect.y-1 || item.text.y+item.text.height > item.rect.y+item.rect.height+1){
      throw new Error(name+': keyword text escapes its adaptive frame: '+JSON.stringify(item));
    }
  }
  for(const item of report.peopleChecks){
    if(!item.text) throw new Error(name+': missing participant name text');
    if(item.text.x < item.rect.x-1 || item.text.x+item.text.width > item.rect.x+item.rect.width+1 ||
       item.text.y < item.rect.y-1 || item.text.y+item.text.height > item.rect.y+item.rect.height+1){
      throw new Error(name+': participant text escapes its frame: '+JSON.stringify(item));
    }
  }
  for(let i=0;i<report.clusters.length;i++){
    for(let j=i+1;j<report.clusters.length;j++){
      if(intersect(report.clusters[i],report.clusters[j],3)){
        throw new Error(name+': cluster overlap '+i+' / '+j+' '+JSON.stringify([report.clusters[i],report.clusters[j]]));
      }
    }
  }

  const firstLong=report.keywordChecks.find(x=>x.content.includes('NGƯỜI LỚN ĐÁNG TIN CẬY'));
  if(!firstLong || firstLong.rect.height<=58) throw new Error(name+': long keyword did not auto-grow vertically');
  if(!firstLong.content.includes('LUÔN LẮNG NGHE VÀ HỖ TRỢ')) throw new Error(name+': long keyword content was truncated');

  const longName=report.peopleChecks.find(x=>x.content.includes('Nguyễn Thị Minh Hằng giáo viên chủ nhiệm'));
  if(!longName || longName.rect.height<=34) throw new Error(name+': long participant name did not auto-grow vertically');

  await page.locator('#hideAll').click();
  await page.waitForTimeout(100);
  if(await page.locator('.keywordGroup.locked').count()!==12) throw new Error(name+': reveal-lock mode regression');
  await page.locator('#showAll').click();
  await page.waitForTimeout(100);

  await page.screenshot({path:'qa-safety-layout-'+name+'.png',fullPage:true});
  if(pageErrors.length) throw new Error(name+': page errors: '+pageErrors.join(' | '));
  console.log('SAFETY_LAYOUT_'+name.toUpperCase()+'_PASS',JSON.stringify({viewHeight:report.viewHeight,clusters:report.keywordCount,people:report.personCount}));
  await browser.close();
}

await run(chromium,'chromium');
await run(webkit,'webkit');
