// Usage: node scripts/shot.mjs "<query>" out.png [waitMs]
import { chromium } from 'playwright-core';
const [query = '', out = 'test-output/shot.png', wait = '4000'] = process.argv.slice(2);
const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('console', (m) => console.log('[console]', m.type(), m.text()));
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto('http://localhost:5173/' + query);
await page.waitForTimeout(+wait);
await page.screenshot({ path: out });
await browser.close();
