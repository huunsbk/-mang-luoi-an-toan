import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
const errors = [];
page.on('pageerror', e => errors.push(String(e)));

await page.goto('http://127.0.0.1:4173/', { waitUntil: 'networkidle' });

await page.getByText('AI Pose Quiz', { exact: true }).first().click();
await page.waitForURL('**/pose-quiz/');
await page.getByText('Cổng giáo viên', { exact: false }).first().click();
await page.waitForURL('http://127.0.0.1:4173/');

await page.getByText('Bốc thăm • Chia đội • Chia tổ', { exact: true }).click();
await page.waitForURL('**/boc-tham/');
await page.getByText('Cổng giáo viên', { exact: false }).first().click();
await page.waitForURL('http://127.0.0.1:4173/');

await page.getByText('Mạng lưới an toàn', { exact: true }).first().click();
await page.waitForURL('**/mang-luoi-an-toan/');
await page.getByText('Cổng giáo viên', { exact: false }).first().click();
await page.waitForURL('http://127.0.0.1:4173/');

if (errors.length) throw new Error(errors.join(' | '));
console.log('PORTAL_NAVIGATION_OK');
await browser.close();
