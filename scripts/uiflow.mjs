// Menu walk-through: clicks through the main menu, settings (every slider and box moved), controls, how to
// play, the codex, the wizard select (Nightmare, Boss Rush, a pact), then into a run, the pause menu and its
// settings at the largest HUD scale, and back out. Fails on any page error or console error.
// Usage: PORT=5190 node scripts/uiflow.mjs [out-dir]
import { chromium } from 'playwright-core';
const PORT = process.env.PORT ?? 5190, OUT = process.argv[2] ?? 'test-output';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--disable-renderer-backgrounding', '--disable-background-timer-throttling'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [], steps = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error' && !/KHR_parallel|favicon/.test(m.text())) errors.push('console: ' + m.text()); });
const step = async (name, fn) => { try { await fn(); steps.push('ok   ' + name); } catch (e) { steps.push('FAIL ' + name + ': ' + e.message.split('\n')[0]); } };
// (forced: Playwright's "stable" check waits on animation frames, which the 3D backdrop makes slow under software rendering)
const click = (sel) => page.waitForSelector(sel, { state: 'attached', timeout: 30000 }).then(() => page.click(sel, { timeout: 15000, force: true })).catch((e) => { throw new Error(sel + ': ' + e.message.split('\n').slice(0, 6).join(' | ')); });
const has = (sel) => page.$(sel).then((x) => !!x);
await page.goto(`http://localhost:${PORT}/?test=1`, { timeout: 180000 });
await page.waitForSelector('#bSolo', { timeout: 180000 });
// settings: move everything
await step('settings', async () => {
  await click('#bSettings');
  // (a click landing while the backdrop's first heavy frames are drawn can be dropped: once more)
  if (!(await page.waitForSelector('.settings-box #sQual', { state: 'attached', timeout: 10000 }).catch(() => null))) await click('#bSettings');
  await page.waitForSelector('.settings-box #sQual', { state: 'attached', timeout: 30000 });
  await page.evaluate(() => {
    for (const r of document.querySelectorAll('.settings-box input[type=range]')) { r.value = r.max; r.dispatchEvent(new Event('input', { bubbles: true })); r.value = r.min; r.dispatchEvent(new Event('input', { bubbles: true })); r.value = (+r.min + +r.max) / 2; r.dispatchEvent(new Event('input', { bubbles: true })); }
    for (const c of document.querySelectorAll('.settings-box input[type=checkbox]')) { c.click(); c.click(); }
    // (to another quality and back: Done reloads the page only if it really changed)
    const s = document.querySelector('#sQual'), q0 = s.value; s.value = 'low'; s.dispatchEvent(new Event('change', { bubbles: true })); s.value = q0; s.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await click('#bKeys');
  await page.waitForTimeout(300);
  // rebind the first action to K, reset to defaults, back to settings
  await click('button[data-a]');
  await page.keyboard.press('KeyK');
  await page.waitForTimeout(200);
  await click('#kReset');
  await click('#kDone');
  await page.waitForTimeout(300);
  await click('.settings-box #bClose');
});
await step('how to play', async () => { await click('#bHelp'); await page.waitForTimeout(300); const c = await page.$('.modal:last-child #bClose'); if (c) await c.click(); else await page.keyboard.press('Escape'); });
await step('codex', async () => { if (!(await has('#bCodex'))) return; await click('#bCodex'); await page.waitForTimeout(500); const c = await page.$('.modal:last-child #bClose, #bClose'); if (c) await c.click(); else await page.keyboard.press('Escape'); });
await step('wizard select', async () => {
  await click('#bSolo');
  await page.waitForSelector('#bGo', { timeout: 15000 });
  if (await has('#bNight')) { await click('#bNight'); await page.waitForTimeout(200); await click('#bNight'); }
  if (await has('#bRush')) { await click('#bRush'); await page.waitForTimeout(200); await click('#bRush'); }
  const pact = await page.$('.cs-pacts [data-pact], .cs-pacts .pact');
  if (pact) { await pact.click(); await page.waitForTimeout(200); }
  await page.screenshot({ path: `${OUT}/ui-select.png` });
});
await step('into a run', async () => {
  await click('#bGo');
  await page.waitForFunction(() => window.__game && !window.__game.menuMode && !window.__game.loadingFloor && window.__game.player, null, { timeout: 180000 });
  await page.waitForTimeout(2000);
});
await step('pause, settings at the largest HUD', async () => {
  await page.evaluate(() => window.__input.onLockChange(false)); // (as losing the pointer lock does)
  await page.waitForTimeout(400);
  await click('#bSet');
  await page.waitForSelector('.settings-box #sHud', { state: 'attached', timeout: 30000 });
  await page.evaluate(() => { const r = document.querySelector('#sHud'); r.value = r.max; r.dispatchEvent(new Event('input', { bubbles: true })); });
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${OUT}/ui-hud130.png` });
  await click('.settings-box #bClose');
  await page.waitForTimeout(300);
  if (await has('#bRes')) await click('#bRes');
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${OUT}/ui-run-hud130.png` });
  // and back to the normal size for the next run
  await page.evaluate(() => { const g = window.__game; const s = g.settings ?? window.__settings; if (s) s.hudScale = 1; });
});
await step('abandon run', async () => {
  await page.evaluate(() => window.__input.onLockChange(false));
  await page.waitForTimeout(400);
  await click('#bQuit');
  await page.waitForSelector('#bSolo', { timeout: 30000 });
});
console.log(steps.join('\n'));
console.log(errors.length ? 'ERRORS\n' + errors.slice(0, 10).join('\n') : 'no errors');
await browser.close();
process.exit(errors.length || steps.some((s) => s.startsWith('FAIL')) ? 1 : 0);
