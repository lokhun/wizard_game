// Usage: node scripts/smoke.mjs "<query>" out.png [waitMs] [script.js]
import { chromium } from 'playwright-core';
import fs from 'fs';
const [query = '', out = 'test-output/smoke.png', wait = '8000', scriptFile] = process.argv.slice(2);
const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('console', (m) => { const t = m.text(); if (m.type() === 'error' || m.type() === 'warning') { errors.push(t); } if (!t.includes('[vite]')) console.log('[console]', m.type(), t.slice(0, 400)); });
page.on('pageerror', (e) => { errors.push(e.message); console.log('[pageerror]', e.message, e.stack?.split('\n').slice(0, 4).join(' | ')); });
await page.goto(process.env.URL ? process.env.URL + query : 'http://localhost:' + (process.env.PORT ?? 5180) + '/' + query);
await page.waitForTimeout(+wait);
if (scriptFile) {
  const code = fs.readFileSync(scriptFile, 'utf8');
  const res = await page.evaluate(code);
  if (res !== undefined) console.log('[script]', JSON.stringify(res).slice(0, 20000));
}
await page.screenshot({ path: out, timeout: 120000 });
console.log('errors:', errors.length);
await browser.close();
