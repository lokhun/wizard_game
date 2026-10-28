// Two-browser co-op check of a wizard leaving mid-run: the client closes its page in a fight and the host
// plays on alone (solo again: it can pause); then a new client joins and the host leaves, and the client is
// told and brought back to the menu with no screen left over it.
// Usage: (npx peerjs --port 9192 --path /wizard &) ; PORT=5190 PEER=9192 node scripts/coop-leave.mjs
import { chromium } from 'playwright-core';
const PORT = process.env.PORT ?? 5190, PEER = process.env.PEER ?? 9000;
const peerQ = `peerHost=127.0.0.1&peerPort=${PEER}&peerPath=/wizard&peerSecure=0&quality=low&test=1&norender=1&floor=1`;
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
const log = [];
const ok = (name, cond, info = '') => { log.push(`${cond ? 'ok  ' : 'FAIL'} ${name} ${info}`); return cond; };
await host.evaluate(() => { const g = window.__game; const r = g.level.rooms.filter((x) => x.type === 'combat').sort((a, b) => b.w * b.h - a.w * a.h)[0]; g.player.pos.set(r.cx, g.groundY(r.cx, r.cz), r.cz); g.godMode = true; });
await host.waitForFunction(() => window.__game.director.active, null, { timeout: 120000 });
await host.waitForTimeout(2000);
// 1. the client leaves mid-fight
await client.close();
await host.waitForFunction(() => window.__game.remotes.size === 0, null, { timeout: 60000 }).catch(() => {});
const h1 = await host.evaluate(() => { const g = window.__game; return { remotes: g.remotes.size, solo: g.isSolo, ended: g.ended, active: !!g.director.active }; });
ok('host plays on alone, solo again', h1.remotes === 0 && h1.solo && !h1.ended, JSON.stringify(h1));
const t0 = await host.evaluate(() => window.__game.time);
await host.waitForTimeout(3000);
ok('its world still runs', (await host.evaluate(() => window.__game.time)) > t0 + 0.5);
// 2. a new wizard joins mid-run, a tome choice open on its screen; then the host leaves
const c2 = await mk('client2');
await c2.goto(`http://localhost:${PORT}/?${peerQ}&join=${code}`, { timeout: 180000 });
await c2.waitForFunction(() => window.__game && !window.__game.menuMode && !window.__game.loadingFloor && window.__game.remotes.size >= 1, null, { timeout: 240000 });
await c2.waitForTimeout(2000);
const rem = await c2.evaluate(() => [...window.__game.remotes.values()].map((r) => r.name + ':' + r.id));
ok('the new wizard sees only the host', rem.length === 1, JSON.stringify(rem) + ' host lobby ' + JSON.stringify(await host.evaluate(() => window.__lobby?.players?.map((p) => p.id))));
ok('host is a party again', !(await host.evaluate(() => window.__game.isSolo)));
await c2.evaluate(() => { const g = window.__game; g.interact({ kind: 'pedestal', usedBy: new Set() }); });
await c2.waitForTimeout(500);
await host.close();
await c2.waitForFunction(() => window.__game.menuMode, null, { timeout: 60000 }).catch(() => {});
await c2.waitForTimeout(1500);
const c = await c2.evaluate(() => ({ menu: window.__game.menuMode, modals: document.querySelectorAll('.modal').length, menuShown: !!document.querySelector('#menu:not(.hidden)'), hud: !document.querySelector('#hud')?.classList.contains('hidden') }));
ok('client back at the menu, nothing over it', c.menu && c.modals === 0 && c.menuShown && !c.hud, JSON.stringify(c));
console.log(log.join('\n'));
const pass = log.every((l) => l.startsWith('ok')) && !errors.length;
console.log(pass ? 'ok' : 'FAIL', errors);
await browser.close();
process.exit(pass ? 0 : 1);
