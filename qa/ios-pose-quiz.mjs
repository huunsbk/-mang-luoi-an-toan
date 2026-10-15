import { webkit, devices } from 'playwright';

const target = 'https://giaovien-psi.vercel.app/pose-quiz/?iosqa=1';
const browser = await webkit.launch({headless:true});
const context = await browser.newContext({
  ...devices['iPhone 13'],
  locale: 'vi-VN'
});
const page = await context.newPage();

const consoleLines = [];
const pageErrors = [];
const failed = [];
page.on('console', m => consoleLines.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', e => pageErrors.push(String(e)));
page.on('requestfailed', r => failed.push(`${r.method()} ${r.url()} :: ${r.failure()?.errorText || 'failed'}`));

const response = await page.goto(target, {waitUntil:'networkidle', timeout:60000});
console.log('HTTP', response?.status());
console.log('TITLE', await page.title());

await page.screenshot({path:'ios-pose-quiz.png', fullPage:true});

const bodyText = (await page.locator('body').innerText().catch(()=>'')) || '';
console.log('BODY_TEXT_START', JSON.stringify(bodyText.slice(0,1200)));
console.log('BODY_HTML_START', JSON.stringify((await page.locator('body').innerHTML()).slice(0,1800)));
console.log('CONSOLE', JSON.stringify(consoleLines, null, 2));
console.log('PAGE_ERRORS', JSON.stringify(pageErrors, null, 2));
console.log('REQUEST_FAILED', JSON.stringify(failed, null, 2));

const loginVisible = await page.getByText('ĐĂNG NHẬP', {exact:true}).first().isVisible().catch(()=>false);
const registerVisible = await page.getByText('ĐĂNG KÝ', {exact:true}).first().isVisible().catch(()=>false);
console.log('LOGIN_VISIBLE', loginVisible);
console.log('REGISTER_VISIBLE', registerVisible);

if (!response || response.status() !== 200) throw new Error('Pose Quiz HTTP not 200');
if (!loginVisible || !registerVisible) throw new Error('Pose Quiz auth UI is not visible in WebKit iPhone emulation');
if (pageErrors.length) throw new Error('WebKit page errors: '+pageErrors.join(' | '));

await browser.close();
