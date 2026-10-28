// Two-browser co-op check of encounter replication (mimic, secret wall, altar curse, champion).
// Usage: (npx peerjs --port 9192 --path /wizard &) ; PORT=5190 PEER=9192 node scripts/coop-encounters.mjs
// Both pages force the same encounters (?enc=), so they build the same floor.
import { chromium } from 'playwright-core';
const PORT = process.env.PORT ?? 5190, PEER = process.env.PEER ?? 9000;
const enc = 'mimic,secret,altar,champion';
// (a fixed seed: its layout has room for every forced encounter; a tight one drops a side room)
const peerQ = `peerHost=127.0.0.1&peerPort=${PEER}&peerPath=/wizard&peerSecure=0&quality=low&test=1&norender=1&floor=1&seed=4242&enc=${enc}`;
// (a browser each: two pages of one browser are one tab in front and one behind, and the one behind gets no
// animation frames, so its game barely moves)
const browsers = [];
const launch = () => chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--disable-renderer-backgrounding', '--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows'],
});
const browser = { close: () => Promise.all(browsers.map((b) => b.close())) };
const errors = [];
const mk = async (tag) => {
  const b = await launch(); browsers.push(b);
  const p = await b.newPage({ viewport: { width: 960, height: 540 } });
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
  const x = s.x - s.nx * 5, z = s.z - s.nz * 5;
  p.pos.set(x, g.groundY(x, z), z); // (on the floor: some host rooms stand on a raised dais)
  const dx = s.x - p.pos.x, dz = s.z - p.pos.z; p.yaw = Math.atan2(-dx, -dz); p.pitch = Math.atan2(g.groundY(s.x - s.nx, s.z - s.nz) + 1.2 - p.pos.y - 1.6, 5);
  window.__input.mouse.left = true;
});
await host.evaluate(() => { const g = window.__game, s = g.level.rooms.find((r) => r.secret).secret; g.level.rooms[s.host].cleared = true; });
await client.waitForFunction(() => window.__game.level.rooms.find((r) => r.secret)._secret.broken, null, { timeout: 60000 }).catch(async () => console.log('client at the wall:', await client.evaluate(() => { const g = window.__game, p = g.player, s = g.level.rooms.find((r) => r.secret).secret; return JSON.stringify({ cls: p.classId, pos: p.pos.toArray().map((v) => +v.toFixed(1)), yaw: +p.yaw.toFixed(2), pitch: +p.pitch.toFixed(2), wall: [s.x, s.z, s.nx, s.nz], t: +g.time.toFixed(1), proj: g.spells.projectiles.length, casts: p.castCount ?? null, modal: g.ui.modalOpen, locked: window.__input.locked }); })));
await client.waitForTimeout(1000);
await client.evaluate(() => { window.__input.mouse.left = false; });
const fails = [];
const secret = await both(() => { const g = window.__game, r = g.level.rooms.find((x) => x.secret); return [r._secret.broken, g.collision.dyn[r.secret.cell]]; });
if (!secret.every(([b, d]) => b && !d)) fails.push('secret');
console.log('secret broken (host, client):', JSON.stringify(await both(() => { const g = window.__game, r = g.level.rooms.find((x) => x.secret); return [r._secret.broken, g.collision.dyn[r.secret.cell]]; })));
// 2. the client opens the mimic; the host fights it
await both(() => { const g = window.__game, r = g.level.rooms.find((x) => x.mimicAt); g.player.pos.set(r.cx, g.groundY(r.cx, r.cz + 3), r.cz + 3); });
// (the host wakes the sleeping mimic once a wizard is in its vault: wait for it, a slow machine takes a while)
await host.waitForFunction(() => !!window.__game.level.rooms.find((x) => x.mimicAt)._mimic.actor, null, { timeout: 60000 }).catch(() => {});
await client.evaluate(() => { const g = window.__game; g.interact(g.interactables.find((i) => i.kind === 'mimic')); });
await host.waitForFunction(() => window.__game.level.rooms.find((x) => x.mimicAt)._mimic.sprung, null, { timeout: 30000 }).catch(() => {});
await host.waitForTimeout(1500);
const sprung = await both(() => { const g = window.__game, r = g.level.rooms.find((x) => x.mimicAt), m = g.actors.list.find((a) => a.type === 'mimic'); return [r._mimic.sprung, !!m, m?.dormant, r._locked]; });
console.log('mimic sprung (host, client):', JSON.stringify(sprung));
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
const mim = await both(() => { const g = window.__game, r = g.level.rooms.find((x) => x.mimicAt); return [r.cleared, g.interactables.filter((i) => i.kind === 'chest').length, g.interactables.filter((i) => i.kind === 'pedestal').length]; });
if (!sprung.every((x) => x[0])) fails.push('mimic spring');
if (!mim.every((m) => m[0]) || JSON.stringify(mim[0]) !== JSON.stringify(mim[1])) fails.push('mimic');
console.log('mimic dead, hoard chests (host, client):', JSON.stringify(mim));
// 3. the client takes the altar's curse: the host's next fight gains an elite
await client.evaluate(() => {
  const g = window.__game;
  g.ui.chooseBlessing = (list) => list[1].apply();
  g.interact(g.interactables.find((i) => i.kind === 'altar'));
});
await host.waitForTimeout(2000);
const curse = await both(() => window.__game.encounters.curse);
if (!(curse[0] > 0) || curse[0] !== curse[1]) fails.push('curse');
console.log('curse (host, client):', JSON.stringify(curse));
// 4. the champion: both see its name and bar
// (the secret step marks the secret's host room won: when that was the elite room, it must fight again)
await both(() => { const g = window.__game, r = g.level.rooms.find((x) => x.type === 'elite'); r.cleared = false; g.player.pos.set(r.cx, g.groundY(r.cx, r.cz), r.cz); });
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
await host.waitForFunction(() => window.__game.actors.list.some((a) => a.champion), null, { timeout: 240000 }).catch(async () => console.log('no champion:', await host.evaluate(() => { const g = window.__game, r = g.level.rooms.find((x) => x.type === 'elite'), p = g.player; return JSON.stringify({ room: [r.id, r.cleared, !!r.champ, r.cx, r.cz, r.w, r.h], at: g.level.roomAt(p.pos.x, p.pos.z)?.id, interior: g.director._interiorRoom(p.pos)?.id, active: g.director.active?.room.id ?? null, pos: p.pos.toArray().map((v) => +v.toFixed(1)), hostiles: g.actors.hostiles().length, t: +g.time.toFixed(1) }); })));
await host.waitForTimeout(1500);
const champ = await both(() => { const g = window.__game, a = g.actors.list.find((x) => x.champion); return a ? [a.def.name, a.def.title, Math.round(a.maxHp), g.ui.bossActor === a, g.level.rooms.find((x) => x.type === 'elite').cursed] : null; });
if (!champ[0] || JSON.stringify(champ[0]) !== JSON.stringify(champ[1])) fails.push('champion');
console.log('champion (host, client):', JSON.stringify(champ));
await host.evaluate(() => clearInterval(window.__aimT));
console.log('errors:', errors.length);
console.log(!fails.length && !errors.length ? 'ok' : 'FAIL ' + fails.join(','));
await browser.close();
process.exit(!fails.length && !errors.length ? 0 : 1);
