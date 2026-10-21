// Two-browser co-op check of encounter replication (mimic, secret wall, altar curse, champion).
// Usage: (npx peerjs --port 9192 --path /wizard &) ; PORT=5190 PEER=9192 node scripts/coop-encounters.mjs
// Both pages force the same encounters (?enc=), so they build the same floor.
import { chromium } from 'playwright-core';
const PORT = process.env.PORT ?? 5190, PEER = process.env.PEER ?? 9000;
const enc = 'mimic,secret,altar,champion';
const peerQ = `peerHost=127.0.0.1&peerPort=${PEER}&peerPath=/wizard&peerSecure=0&quality=low&test=1&norender=1&floor=1&enc=${enc}`;
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
console.log('same floor:', JSON.stringify(await both(() => window.__game.level.rooms.map((r) => r.type + (r.mod ?? '') + (r.mimic ? 'M' : '')).join(' '))));
await both(() => { const g = window.__game; g.godMode = true; g.ui.chooseRelic = (c, cb) => cb(c[0]); g.ui.chooseTome = (c, cb) => cb(c[0]); });
// 1. the client breaks the secret wall with a spell
await client.evaluate(() => {
  const g = window.__game, p = g.player, sr = g.level.rooms.find((r) => r.secret), s = sr.secret;
  g.level.rooms[s.host].cleared = true;
  p.pos.set(s.x - s.nx * 5, 0, s.z - s.nz * 5);
  const dx = s.x - p.pos.x, dz = s.z - p.pos.z; p.yaw = Math.atan2(-dx, -dz); p.pitch = -0.05;
  window.__input.mouse.left = true;
});
await host.evaluate(() => { const g = window.__game, s = g.level.rooms.find((r) => r.secret).secret; g.level.rooms[s.host].cleared = true; });
await client.waitForTimeout(5000);
await client.evaluate(() => { window.__input.mouse.left = false; });
console.log('secret broken (host, client):', JSON.stringify(await both(() => { const g = window.__game, r = g.level.rooms.find((x) => x.secret); return [r._secret.broken, g.collision.dyn[r.secret.cell]]; })));
// 2. the client opens the mimic; the host fights it
await both(() => { const g = window.__game, r = g.level.rooms.find((x) => x.mimicAt); g.player.pos.set(r.cx, 0, r.cz + 3); });
await host.waitForTimeout(3000);
await client.evaluate(() => { const g = window.__game; g.interact(g.interactables.find((i) => i.kind === 'mimic')); });
await host.waitForTimeout(3000);
console.log('mimic sprung (host, client):', JSON.stringify(await both(() => { const g = window.__game, r = g.level.rooms.find((x) => x.mimicAt), m = g.actors.list.find((a) => a.type === 'mimic'); return [r._mimic.sprung, !!m, m?.dormant, r._locked]; })));
await host.evaluate(() => {
  const g = window.__game;
  window.__aimT = setInterval(() => {
    const p = g.player, m = g.actors.list.find((a) => a.type === 'mimic' && !a.dead);
    if (!m) { window.__input.mouse.left = false; return; }
    const dx = m.pos.x - p.pos.x, dz = m.pos.z - p.pos.z; p.yaw = Math.atan2(-dx, -dz); p.pitch = Math.atan2(m.pos.y + 0.6 - p.pos.y - 1.6, Math.hypot(dx, dz));
    window.__input.mouse.left = true;
  }, 100);
});
await host.waitForFunction(() => !window.__game.director.active, null, { timeout: 120000 });
await host.evaluate(() => clearInterval(window.__aimT));
await host.waitForTimeout(3000);
console.log('mimic dead, hoard chests (host, client):', JSON.stringify(await both(() => { const g = window.__game, r = g.level.rooms.find((x) => x.mimicAt); return [r.cleared, g.interactables.filter((i) => i.kind === 'chest').length, g.interactables.filter((i) => i.kind === 'pedestal').length]; })));
// 3. the client takes the altar's curse: the host's next fight gains an elite
await client.evaluate(() => {
  const g = window.__game;
  g.ui.chooseBlessing = (list) => list[1].apply();
  g.interact(g.interactables.find((i) => i.kind === 'altar'));
});
await host.waitForTimeout(2000);
console.log('curse (host, client):', JSON.stringify(await both(() => window.__game.encounters.curse)));
// 4. the champion: both see its name and bar
await both(() => { const g = window.__game, r = g.level.rooms.find((x) => x.type === 'elite'); g.player.pos.set(r.cx, 0, r.cz); });
await host.evaluate(() => {
  const g = window.__game;
  window.__aimT = setInterval(() => {
    const p = g.player; let best = null, bd = 1e9;
    for (const a of g.actors.hostiles()) { const d = a.pos.distanceTo(p.pos); if (d < bd) { bd = d; best = a; } }
    if (!best) { window.__input.mouse.left = false; return; }
    const dx = best.pos.x - p.pos.x, dz = best.pos.z - p.pos.z; p.yaw = Math.atan2(-dx, -dz); p.pitch = Math.atan2(best.pos.y + 1 - p.pos.y - 1.6, Math.hypot(dx, dz));
    window.__input.mouse.left = true;
  }, 100);
});
await host.waitForFunction(() => window.__game.actors.list.some((a) => a.champion), null, { timeout: 240000 }).catch(() => {});
await host.waitForTimeout(1500);
console.log('champion (host, client):', JSON.stringify(await both(() => { const g = window.__game, a = g.actors.list.find((x) => x.champion); return a ? [a.def.name, a.def.title, Math.round(a.maxHp), g.ui.bossActor === a, g.level.rooms.find((x) => x.type === 'elite').cursed] : null; })));
await host.evaluate(() => clearInterval(window.__aimT));
console.log('errors:', errors.length);
await browser.close();
