// Two-browser co-op check that a boss's moments reach the client: a gate rising (its colour, the line under
// the boss bar, the glyphs), a gate breaking and the EXPOSED window it leaves.
// Usage: (npx peerjs --port 9192 --path /wizard &) ; PORT=5190 PEER=9192 node scripts/coop-gates.mjs
import { chromium } from 'playwright-core';
const PORT = process.env.PORT ?? 5190, PEER = process.env.PEER ?? 9000;
const peerQ = `peerHost=127.0.0.1&peerPort=${PEER}&peerPath=/wizard&peerSecure=0&quality=low&test=1&norender=1&floor=3`;
const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--disable-renderer-backgrounding', '--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows'],
});
const errors = [];
const mk = async (tag) => {
  const p = await browser.newPage({ viewport: { width: 960, height: 540 } });
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
await both(() => { const g = window.__game; g.godMode = true; g.ui.chooseRelic = (c, cb) => cb(c[0]); g.ui.chooseTome = (c, cb) => cb(c[0]); for (const r of g.level.rooms) if (r.type !== 'boss') r.cleared = true; const b = g.level.bossRoom; g.player.pos.set(b.cx, g.groundY(b.cx, b.cz), b.cz + 8); });
await host.waitForFunction(() => window.__game.actors.list.some((a) => a.boss && !a.dead), null, { timeout: 60000 });
await client.waitForFunction(() => window.__game.actors.list.some((a) => a.boss && !a.dead), null, { timeout: 60000 });
await host.waitForTimeout(3500);
const read = () => { const g = window.__game, a = g.actors.list.find((x) => x.boss); const bar = document.querySelector('.boss-bar .bgate'); return { gate: a.gate?.k ?? null, n: a.gate?.n ?? null, glyphs: a.gate?.gl?.length ?? 0, bar: bar && !bar.classList.contains('hidden') ? bar.textContent : '', exposed: g.time < (a.exposedUntil ?? 0) }; };
// a gate rises on the host
await host.evaluate(() => { const B = window.__game.actors.list.find((a) => a.boss).brain, x = B.a.pos.x, z = B.a.pos.z; const gl = [{ x: x + 5, z, p: 0, lit: false }, { x: x - 5, z, p: 0, lit: false }]; B.openGate('ward', 30, { gl, fx: { gl: gl.flatMap((q) => [q.x, q.z]) } }); });
await client.waitForTimeout(1000);
// (it rose during the boss's entrance: its line must be under the bar once the name comes up)
for (const p of [host, client]) await p.waitForFunction(() => !window.__game.cinematic || window.__game.cinematic.done, null, { timeout: 60000 });
await client.waitForTimeout(300);
const up = await both(read);
console.log('gate up   (host, client):', JSON.stringify(up));
// one glyph burns, then it breaks
await host.evaluate(() => { const B = window.__game.actors.list.find((a) => a.boss).brain; B.gate.gl[0].lit = true; B.fx('glyph', { i: 0, x: B.gate.gl[0].x, z: B.gate.gl[0].z }); });
await client.waitForTimeout(600);
const lit = await client.evaluate(() => window.__game.actors.list.find((a) => a.boss).gate?.n);
await host.evaluate(() => window.__game.actors.list.find((a) => a.boss).brain.closeGate(true));
await client.waitForTimeout(800);
const down = await both(read);
console.log('gate down (host, client):', JSON.stringify(down), 'glyphs left on the client after one burned:', lit);
const ok = up[1].gate === 'ward' && up[1].glyphs === 2 && /Warding Glyphs/.test(up[1].bar) && lit === 1 && down[1].gate === null && down[1].exposed && !down[1].bar && !errors.length;
console.log(ok ? 'ok' : 'FAIL', errors);
await browser.close();
process.exit(ok ? 0 : 1);
