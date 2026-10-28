// Two-browser co-op check of falling and getting up: a wizard goes down and the other revives them by
// holding interact; a wizard who bleeds out returns when the chamber is cleared; when both are down the
// run ends in defeat on both machines, with its summary.
// Usage: (npx peerjs --port 9192 --path /wizard &) ; PORT=5190 PEER=9192 node scripts/coop-down.mjs
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
const st = (p) => p.evaluate(() => { const q = window.__game.player; return { down: q.downed, dead: q.dead, hp: Math.round(q.hp), ended: window.__game.ended }; });
// the host walks into a fight (the client is drawn in); the foes are made harmless, the wizards mortal
await host.evaluate(() => { const g = window.__game; const r = g.level.rooms.filter((x) => x.type === 'combat').sort((a, b) => b.w * b.h - a.w * a.h)[0]; g.player.pos.set(r.cx, g.groundY(r.cx, r.cz), r.cz); });
await host.waitForFunction(() => window.__game.director.active, null, { timeout: 120000 });
await host.waitForTimeout(3000);
await host.evaluate(() => { for (const a of window.__game.actors.list) if (a.faction === 'enemy') { a.dmgMult = 0; a.stunT = 999; } });
// 1. the client falls; the host sees it, walks over and holds interact
await client.evaluate(() => { const p = window.__game.player; p.invuln = 0; p.takeDamage(99999, 'physical', null, { cause: 'a test' }); });
await host.waitForFunction(() => [...window.__game.remotes.values()][0]?.downed, null, { timeout: 30000 }).catch(() => {});
ok('client down, seen by the host', await host.evaluate(() => [...window.__game.remotes.values()][0]?.downed), JSON.stringify(await st(client)));
await host.evaluate(() => { const g = window.__game, r = [...g.remotes.values()][0]; g.player.pos.set(r.pos.x + 1, r.pos.y, r.pos.z); window.__input.down.add('KeyF'); });
await client.waitForFunction(() => !window.__game.player.downed, null, { timeout: 30000 }).catch(() => {});
await host.evaluate(() => window.__input.down.delete('KeyF'));
const r1 = await st(client);
ok('revived by holding interact', !r1.down && !r1.dead && r1.hp > 0, JSON.stringify(r1));
// 2. the client bleeds out, and returns when the chamber is cleared
await client.evaluate(() => { const p = window.__game.player; p.invuln = 0; p.takeDamage(99999, 'physical', null, { cause: 'a test' }); });
await client.waitForFunction(() => window.__game.player.downed, null, { timeout: 30000 }).catch(() => {});
await client.evaluate(() => { window.__game.player.downT = 0.1; });
await client.waitForFunction(() => window.__game.player.dead, null, { timeout: 30000 }).catch(() => {});
ok('bled out', (await st(client)).dead, JSON.stringify(await st(client)));
await host.evaluate(() => { const g = window.__game; for (const a of [...g.actors.hostiles()]) { a.hp = 0; g.actors.kill(a, g.player.id, 'fire'); } });
for (let i = 0; i < 30 && (await host.evaluate(() => !!window.__game.director.active)); i++) {
  await host.evaluate(() => { const g = window.__game; for (const a of [...g.actors.hostiles()]) { a.hp = 0; g.actors.kill(a, g.player.id, 'fire'); } });
  await host.waitForTimeout(1000);
}
await client.waitForFunction(() => !window.__game.player.dead && !window.__game.player.downed, null, { timeout: 30000 }).catch(() => {});
const r2 = await st(client);
ok('back when the chamber was cleared', !r2.dead && !r2.down && r2.hp > 0, JSON.stringify(r2));
// 3. both fall: defeat on both, with the summary
for (const p of [client, host]) await p.evaluate(() => { const q = window.__game.player; q.invuln = 0; q.selfRevives = 0; q.takeDamage(99999, 'physical', null, { cause: 'a test' }); });
for (const p of [host, client]) await p.waitForFunction(() => window.__game.ended, null, { timeout: 30000 }).catch(() => {});
await host.waitForTimeout(2500);
const end = await Promise.all([host, client].map((p) => p.evaluate(() => ({ ended: window.__game.ended, summary: !!document.querySelector('.modal') && /RUN SUMMARY/i.test(document.querySelector('.modal').innerText) }))));
ok('defeat on both, with the summary', end.every((e) => e.ended && e.summary), JSON.stringify(end));
console.log(log.join('\n'));
const pass = log.every((l) => l.startsWith('ok')) && !errors.length;
console.log(pass ? 'ok' : 'FAIL', errors);
await browser.close();
process.exit(pass ? 0 : 1);
