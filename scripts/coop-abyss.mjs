// Two-browser co-op check of the Abyss: the host fells the Hollow King, both see the two portals, the
// client steps into the Abyss portal and both land on the same depth-1 floor, the victory banked on each.
// Usage: (npx peerjs --port 9192 --path /wizard &) ; PORT=5190 PEER=9192 node scripts/coop-abyss.mjs
import { chromium } from 'playwright-core';
const PORT = process.env.PORT ?? 5190, PEER = process.env.PEER ?? 9000;
const peerQ = `peerHost=127.0.0.1&peerPort=${PEER}&peerPath=/wizard&peerSecure=0&quality=low&test=1&norender=1&floor=4&abyss&seed=77`;
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
const client = await mk('client');
await client.goto(`http://localhost:${PORT}/?${peerQ}&join=${code}`, { timeout: 180000 });
await client.waitForFunction(() => document.querySelector('#lobbyPlayers')?.children.length >= 2, null, { timeout: 180000 });
await client.$eval('#bGo', (b) => b.click());
await host.waitForTimeout(1500);
await host.$eval('#bGo', (b) => b.click());
for (const p of [host, client]) await p.waitForFunction(() => window.__game && !window.__game.menuMode && window.__game.remotes.size === 1 && !window.__game.loadingFloor, null, { timeout: 240000 });
const both = async (fn, arg) => [await host.evaluate(fn, arg), await client.evaluate(fn, arg)];
const layout = () => window.__game.level.rooms.map((r) => r.type + (r.mod ?? '')).join(' ');
console.log('same floor:', JSON.stringify(await both(layout)));
await both(() => { const g = window.__game; g.godMode = true; g.ui.chooseRelic = (c, cb) => cb(c[0]); g.ui.chooseTome = (c, cb) => cb(c[0]); });
await both(() => { const g = window.__game, r = g.level.bossRoom; g.player.pos.set(r.cx, g.groundY(r.cx, r.cz), r.cz + 6); });
await host.evaluate(() => {
  const g = window.__game;
  window.__aimT = setInterval(() => {
    const p = g.player; let best = null, bd = 1e9;
    for (const a of g.actors.hostiles()) { a.hp = Math.min(a.hp, 1); const d = a.pos.distanceTo(p.pos); if (d < bd && !a.dormant) { bd = d; best = a; } }
    if (!best) { window.__input.mouse.left = false; return; }
    const dx = best.pos.x - p.pos.x, dz = best.pos.z - p.pos.z; p.yaw = Math.atan2(-dx, -dz); p.pitch = Math.atan2(best.pos.y + best.height * 0.5 - p.pos.y - 1.6, Math.hypot(dx, dz));
    window.__input.mouse.left = true;
  }, 100);
});
for (const p of [host, client]) await p.waitForFunction(() => window.__game.interactables.some((i) => i.kind === 'abyssPortal'), null, { timeout: 240000 });
await host.evaluate(() => { clearInterval(window.__aimT); window.__input.mouse.left = false; });
console.log('portals (host, client):', JSON.stringify(await both(() => window.__game.interactables.map((i) => i.kind).filter((k) => /Portal/.test(k)))));
await client.evaluate(() => { const g = window.__game; g.interact(g.interactables.find((i) => i.kind === 'abyssPortal')); });
for (const p of [host, client]) await p.waitForFunction(() => window.__game.abyss === 1 && !window.__game.loadingFloor && !window.__game.transitioning, null, { timeout: 240000 });
await host.waitForTimeout(1500);
console.log('descended (host, client):', JSON.stringify(await both(() => { const g = window.__game; return [g.abyss, g.floorIndex, g.ended, g.meta?.run?.won, g.meta?.run?.abyss, g.player.dead]; })));
const [lh, lc] = await both(layout);
console.log('same abyss floor:', lh === lc);
console.log('errors:', errors.length);
await browser.close();
