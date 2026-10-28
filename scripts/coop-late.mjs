// Two-browser co-op check of joining mid-boss: the host fights a boss alone, a second wizard joins the
// party mid-fight. The joiner must land in the fight with the boss's bar up and the camera its own (no
// entrance replayed for it: that took the camera for 6 s with the boss already swinging).
// Usage: (npx peerjs --port 9192 --path /wizard &) ; PORT=5190 PEER=9192 node scripts/coop-late.mjs
import { chromium } from 'playwright-core';
const PORT = process.env.PORT ?? 5190, PEER = process.env.PEER ?? 9000;
const peerQ = `peerHost=127.0.0.1&peerPort=${PEER}&peerPath=/wizard&peerSecure=0&quality=low&test=1&norender=1&floor=1`;
// (a browser each: two pages of one browser are a tab in front and one behind, and the one behind gets
// no animation frames, so its game barely moves)
const browsers = [];
const launchOne = async () => { const b = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--disable-renderer-backgrounding', '--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows'],
}); browsers.push(b); return b; };
const browser = { close: () => Promise.all(browsers.map((b) => b.close())) };
const errors = [];
const mk = async (tag) => {
  const p = await (await launchOne()).newPage({ viewport: { width: 960, height: 540 } });
  p.on('pageerror', (e) => { errors.push(tag + ': ' + e.message); console.log(`[${tag} pageerror]`, e.message); });
  return p;
};
const host = await mk('host');
await host.goto(`http://localhost:${PORT}/?${peerQ}`, { timeout: 180000 });
await host.waitForFunction(() => document.querySelector('#bHost'), null, { timeout: 180000 });
await host.$eval('#bHost', (b) => b.click());
await host.waitForFunction(() => document.querySelector('#lobbyCode')?.textContent?.length >= 5, null, { timeout: 120000 });
const code = await host.$eval('#lobbyCode', (e) => e.textContent);
await host.$eval('#bGo', (b) => b.click());
await host.waitForFunction(() => window.__game && !window.__game.menuMode && !window.__game.loadingFloor, null, { timeout: 240000 });
// the host alone walks into the boss and lets its entrance play out
await host.evaluate(() => { const g = window.__game; g.godMode = true; for (const r of g.level.rooms) if (r.type !== 'boss') r.cleared = true; const b = g.level.bossRoom; g.player.pos.set(b.cx, g.groundY(b.cx, b.cz), b.cz + 8); });
await host.waitForFunction(() => window.__game.actors.list.some((a) => a.boss && !a.dead) && (!window.__game.cinematic || window.__game.cinematic.done), null, { timeout: 120000 });
console.log('host fighting', await host.evaluate(() => window.__game.actors.list.find((a) => a.boss).type));
// a second wizard joins mid-fight
const client = await mk('client');
await client.goto(`http://localhost:${PORT}/?${peerQ}&join=${code}`, { timeout: 180000 });
await client.waitForFunction(() => window.__game && !window.__game.menuMode && !window.__game.loadingFloor && window.__game.actors.list.some((a) => a.boss), null, { timeout: 240000 });
await client.waitForTimeout(1500);
const st = await client.evaluate(() => {
  const g = window.__game, bar = document.querySelector('.boss-bar');
  return { cine: !!g.cinematic && !g.cinematic.done, bar: !!bar && !bar.classList.contains('hidden'), name: document.querySelector('.boss-bar .bname')?.textContent, letterbox: !!g.ui._lb && parseFloat(g.ui._lb.children[0].style.height) > 0 };
});
console.log('client', JSON.stringify(st));
const ok = !st.cine && !st.letterbox && st.bar && !!st.name && !errors.length;
console.log(ok ? 'ok' : 'FAIL', errors);
await browser.close();
process.exit(ok ? 0 : 1);
