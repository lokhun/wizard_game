// Two-browser co-op smoke test against a local PeerJS server.
// Usage: (npx peerjs --port 9000 --path /wizard &) ; node scripts/coop-test.mjs
import { chromium } from 'playwright-core';
const PORT = process.env.PORT ?? 5190;
const peerQ = 'peerHost=127.0.0.1&peerPort=9000&peerPath=/wizard&peerSecure=0&quality=low&test=1&norender=1';
const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--disable-renderer-backgrounding', '--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows'],
});
const mk = async (tag) => {
  const p = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  p.on('pageerror', (e) => console.log(`[${tag} pageerror]`, e.message));
  p.on('console', (m) => { if (m.type() === 'error') console.log(`[${tag} err]`, m.text().slice(0, 300)); });
  return p;
};
const host = await mk('host');
await host.goto(`http://localhost:${PORT}/?${peerQ}`);
await host.waitForFunction(() => document.querySelector('#bHost'), null, { timeout: 120000 });
await host.$eval('#bHost', (b) => b.click()); // DOM click: actionability checks crawl on a loaded machine
await host.waitForFunction(() => document.querySelector('#lobbyCode')?.textContent?.length >= 5, null, { timeout: 60000 });
const code = await host.$eval('#lobbyCode', (e) => e.textContent);
console.log('party code', code);
const client = await mk('client');
await client.goto(`http://localhost:${PORT}/?${peerQ}&join=${code}`);
await client.waitForFunction(() => document.querySelector('#lobbyPlayers')?.children.length >= 2, null, { timeout: 120000 });
console.log('client sees lobby:', await client.$eval('#lobbyPlayers', (e) => e.textContent.replace(/\s+/g, ' ')));
// client picks a class then readies; host starts
await client.$eval('.card[data-id="lightbinder"]', (b) => b.click());
await client.$eval('#bGo', (b) => b.click());
await host.waitForTimeout(1500);
console.log('host lobby:', await host.$eval('#lobbyPlayers', (e) => e.textContent.replace(/\s+/g, ' ')));
await host.$eval('#bGo', (b) => b.click());
await host.waitForFunction(() => window.__game && !window.__game.menuMode && window.__game.remotes.size === 1, null, { timeout: 120000 });
await client.waitForFunction(() => window.__game && !window.__game.menuMode && window.__game.remotes.size === 1, null, { timeout: 120000 });
console.log('both in run');
await host.evaluate(() => { window.__lastPs = null; window.__net.on((m) => { if (m.t === 'ps') window.__lastPs = m; }); });
await client.evaluate(() => { window.__lastPs = null; window.__net.on((m) => { if (m.t === 'ps') window.__lastPs = m; }); });
await host.waitForTimeout(4000);
console.log('host lastPs', await host.evaluate(() => JSON.stringify(window.__lastPs)), 'floor', await host.evaluate(() => window.__game.floorIndex), 'remotes', await host.evaluate(() => JSON.stringify([...window.__game.remotes.keys()])));
console.log('client lastPs', await client.evaluate(() => JSON.stringify(window.__lastPs)), 'remotes', await client.evaluate(() => JSON.stringify([...window.__game.remotes.keys()])), 'me', await client.evaluate(() => window.__game.player.id));
console.log('host rx', await host.evaluate(() => JSON.stringify(window.__net?.rx)), 'client rx', await client.evaluate(() => JSON.stringify(window.__net?.rx)));
console.log('fast channel', 'host:', await host.evaluate(() => window.__net?.fast?.size ?? -1), 'client:', await client.evaluate(() => !!window.__net?.fastConn?.open));
// host walks into a combat room; client follows via teleport
await host.evaluate(() => { const g = window.__game; const r = g.level.rooms.find((x) => x.type === 'combat'); g.player.pos.set(r.cx, 0, r.cz); });
await host.waitForTimeout(12000);
const hs = await host.evaluate(() => { const g = window.__game; return { actors: g.actors.list.length, remote: [...g.remotes.values()].map((r) => [r.name, r.classId, r.pos.toArray().map((v) => v.toFixed(1))]), active: !!g.director.active }; });
const cs = await client.evaluate(() => { const g = window.__game; return { actors: g.actors.list.length, me: g.player.pos.toArray().map((v) => v.toFixed(1)), remote: [...g.remotes.values()].map((r) => [r.name, r.classId, r.pos.toArray().map((v) => v.toFixed(1))]), locked: g.level.rooms.some((r) => r.doors.some((d) => g.collision.dyn[g.level.doors[d].cells[0]])) }; });
console.log('host state', JSON.stringify(hs));
console.log('client state', JSON.stringify(cs));
// client casts at an enemy: verify host receives damage
const before = await host.evaluate(() => window.__game.stats.damage);
console.log('client hostiles', await client.evaluate(() => window.__game.actors.hostiles().length), 'client fps-ish rx', await client.evaluate(() => JSON.stringify(window.__net.rx)));
await client.evaluate(() => {
  const g = window.__game; const inp = window.__input;
  window.__aimT = setInterval(() => {
    const p = g.player; let best = null, bd = 1e9;
    for (const a of g.actors.hostiles()) { const d = a.pos.distanceTo(p.pos); if (d < bd) { bd = d; best = a; } }
    if (!best) return;
    const dx = best.pos.x - p.pos.x, dz = best.pos.z - p.pos.z, dy = best.pos.y + best.height * 0.5 - (p.pos.y + 1.6);
    p.yaw = Math.atan2(-dx, -dz); p.pitch = Math.atan2(dy, Math.hypot(dx, dz));
    inp.mouse.left = true;
  }, 100);
});
await client.waitForTimeout(6000);
await client.evaluate(() => { clearInterval(window.__aimT); window.__input.mouse.left = false; });
console.log('client aim', await client.evaluate(() => { const g = window.__game, p = g.player; const ai = p.aimInfo(); const h = g.actors.hostiles().slice(0, 4).map((a) => [a.type, a.pos.toArray().map((v) => +v.toFixed(1)), +a.height.toFixed(2), +a.radius.toFixed(2), a.state, a.anim]); return JSON.stringify({ me: p.pos.toArray().map((v) => +v.toFixed(1)), eye: g.renderer.camera.position.toArray().map((v) => +v.toFixed(1)), yaw: p.yaw, pitch: p.pitch, aimActor: ai.actor?.type, aimPt: ai.point.toArray().map((v) => +v.toFixed(1)), h }); }));
console.log('client manual', await client.evaluate(() => {
  const g = window.__game, THREE_V = g.player.pos.constructor;
  const a = g.actors.hostiles()[0];
  const o = g.player.eye.clone();
  const t = new THREE_V(a.pos.x, a.pos.y + a.height * 0.5, a.pos.z);
  const d = t.clone().sub(o).normalize();
  let hits = 0; const orig = g.hitActor.bind(g); g.hitActor = (...args) => { hits++; return orig(...args); };
  const pr = g.spells.spawn({ local: true, faction: 'player', owner: g.player.id, el: 'holy', pos: o, vel: d.multiplyScalar(30), radius: 0.2, life: 2, hit: { dmg: 5, el: 'holy' } });
  const log = [];
  for (let i = 0; i < 20 && !pr.dead; i++) { g.spells.update(1 / 30); log.push(pr.pos.toArray().map((v) => +v.toFixed(2)).join(',') + (pr.dead ? ' DEAD' : '')); }
  g.hitActor = orig;
  return JSON.stringify({ hits, target: a.pos.toArray(), h: a.height, r: a.radius, o: o.toArray(), log: log.slice(0, 6), inList: g.actors.hostiles().includes(a), alive: a.alive });
}));
console.log('client debug', await client.evaluate(() => { const g = window.__game, p = g.player; return JSON.stringify({ alive: p.alive, downed: p.downed, dead: p.dead, paused: g.paused, modal: g.ui.modalOpen, cine: !!g.cinematic, locked: window.__input.locked, proj: g.spells.projectiles.length, rate: p.rateTimer, hp: p.hp, ended: g.ended, menu: g.menuMode, cast: p.castAnim?.slot, stun: p.stunT }); }));
const hostHp = await host.evaluate(() => window.__game.actors.list.map((a) => Math.round(a.hp)).join(','));
console.log('enemy hp on host after client fire:', hostHp, 'client dealt', await client.evaluate(() => Math.round(window.__game.stats.damage)));
// screenshots skipped (norender)
//await host.screenshot({ path: 'test-output/coop-host.png', timeout: 120000 });
//await client.screenshot({ path: 'test-output/coop-client.png', timeout: 120000 });
await browser.close();
void before;
