// Usage: node scripts/filmstrip.mjs "<query>" setup.js outPrefix frames stepSec
// Runs setup.js in the page, then alternates __sim(step) and a screenshot, and
// tiles the frames into <outPrefix>_strip.png (needs python3 + PIL for tiling).
import { chromium } from 'playwright-core';
import fs from 'fs';
import { execSync } from 'child_process';
const [query, setup, out, frames = '6', step = '0.2'] = process.argv.slice(2);
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto('http://localhost:' + (process.env.PORT ?? 5190) + '/' + query);
await page.waitForTimeout(3000);
console.log('[setup]', JSON.stringify(await page.evaluate(fs.readFileSync(setup, 'utf8'))));
// hold the world still between steps so each frame shows exactly step seconds
await page.evaluate('window.__freeze = true');
const files = [];
for (let i = 0; i < +frames; i++) {
  await page.evaluate(`window.__sim(${step}, 1/30, window.__each); null`);
  await page.waitForTimeout(700);
  const f = `${out}_${i}.png`;
  await page.screenshot({ path: f });
  files.push(f);
}
await browser.close();
execSync('python3 - ' + [out + '_strip.png', ...files].map((f) => JSON.stringify(f)).join(' '), { input: `
import sys
from PIL import Image
out, fs = sys.argv[1], sys.argv[2:]
ims = [Image.open(f).resize((480, 270)) for f in fs]
cols = 3; rows = (len(ims) + cols - 1) // cols
s = Image.new('RGB', (480 * cols, 270 * rows))
for i, im in enumerate(ims): s.paste(im, ((i % cols) * 480, (i // cols) * 270))
s.save(out)
` });
console.log('strip', out + '_strip.png');
