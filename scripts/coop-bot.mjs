// Two-browser co-op playthrough over a real PeerJS link, in real time: both wizards run a bot
// (aim at the nearest foe, cast everything, take the first tome), the host walks the main path
// room by room and the director draws the client in. Nightmare by default (&nightmare on the
// host), starting at FLOOR (default 3) so the late bosses and their signature moves come over
// the wire. The client pings a foe once a room. Reports per room and floor, then errors.
// Usage: (npx peerjs --host 127.0.0.1 --port 9192 --path /wizard &) ; PORT=5190 PEER=9192 FLOOR=3 node scripts/coop-bot.mjs
import { chromium } from 'playwright-core';
const PORT = process.env.PORT ?? 5190, PEER = process.env.PEER ?? 9000, FLOOR = +(process.env.FLOOR ?? 3), NM = process.env.NM !== '0';
const peerQ = `peerHost=127.0.0.1&peerPort=${PEER}&peerPath=/wizard&peerSecure=0&quality=low&test=1&norender=1&floor=${FLOOR}${NM ? '&nightmare' : ''}`;
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
  p.on('pageerror', (e) => { errors.push(tag + ': ' + e.message); console.log(`[${tag} pageerror]`, e.message, (e.stack ?? '').split('\n').slice(1, 3).join(' | ')); });
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
await client.$eval('.card[data-id="stormcaller"]', (b) => b.click());
await client.$eval('#bGo', (b) => b.click());
await host.waitForTimeout(1500);
await host.$eval('.card[data-id="necromancer"]', (b) => b.click()).catch(() => {});
await host.$eval('#bGo', (b) => b.click());
for (const p of [host, client]) await p.waitForFunction(() => window.__game && !window.__game.menuMode && window.__game.remotes.size === 1 && !window.__game.loadingFloor, null, { timeout: 240000 });
const both = async (fn, arg) => [await host.evaluate(fn, arg), await client.evaluate(fn, arg)];
console.log('in run; nightmare:', JSON.stringify(await both(() => !!window.__game.difficulty.nightmare)));
// both bots: aim, cast, take tomes and relics, never die
await both(() => {
  const g = window.__game, inp = window.__input;
  g.godMode = true;
  g.ui.chooseRelic = (c, cb) => cb(c[0]);
  g.ui.chooseTome = (c, cb) => cb(c[0]);
  let f = 0;
  window.__bot = setInterval(() => {
    const p = g.player;
    if (p.downed) p.revive(1);
    let best = null, bd = 1e9;
    for (const a of g.actors.hostiles()) { if (a.dormant) continue; const d = a.pos.distanceTo(p.pos); if (d < bd) { bd = d; best = a; } }
    inp.mouse.left = !!best;
    if (best) {
      const dx = best.pos.x - p.pos.x, dz = best.pos.z - p.pos.z;
      p.yaw = Math.atan2(-dx, -dz); p.pitch = Math.atan2(best.pos.y + best.height * 0.5 - p.pos.y - 1.6, Math.hypot(dx, dz));
      if (bd > 12) inp.down.add('KeyW'); else inp.down.delete('KeyW');
    } else inp.down.delete('KeyW');
    if (++f % 25 === 0) inp.pressed.add('KeyQ');
    if (f % 37 === 0) inp.pressed.add('KeyE');
    if (p.ult >= 100) inp.pressed.add('KeyR');
    // take whatever reward stands near
    for (const it of g.interactables) if ((it.kind === 'pedestal') && !it.usedBy?.has(p.id) && it.pos.distanceTo(p.pos) < 30) { g.interact(it); break; }
  }, 50);
});
const t0 = Date.now();
let pings = 0;
for (let floor = FLOOR; floor < 5; floor++) {
  const rooms = await host.evaluate(() => window.__game.level.rooms.filter((r) => r.main).sort((a, b) => a.order - b.order).slice(1).map((r) => [r.id, r.type]));
  for (const [id, type] of rooms) {
    const rt = Date.now();
    await host.evaluate((id) => { const g = window.__game, r = g.level.rooms[id]; g.player.pos.set(r.cx, g.groundY(r.cx, r.cz), r.cz); }, id);
    await host.waitForTimeout(1500);
    // the client marks a foe for its friend
    if (await client.evaluate(() => { const g = window.__game, p = g.player, a = g.actors.hostiles().find((x) => !x.dormant); if (!a) return false; const dx = a.pos.x - p.pos.x, dz = a.pos.z - p.pos.z; p.yaw = Math.atan2(-dx, -dz); p.pitch = Math.atan2(a.pos.y + a.height * 0.5 - p.pos.y - 1.6, Math.hypot(dx, dz)); window.__input.pressed.add('KeyG'); return true; })) pings++;
    await host.waitForFunction((id) => { const g = window.__game, r = g.level.rooms[id]; return r.cleared && !g.director.active && (r.type !== 'boss' || g.ended || g.interactables.some((i) => /ortal/.test(i.kind))); }, id, { timeout: 300000, polling: 500 }).catch(() => console.log('  TIMEOUT'));
    const st = await both(() => { const g = window.__game, p = g.player; return `F${g.floorIndex} hp ${Math.round(p.hp)}/${p.maxHp} dmg ${Math.round(p.damageDealt ?? 0)} tomes ${p.upgrades.length} dread ${p.dread}`; });
    console.log(`F${floor} ${type.padEnd(7)} ${((Date.now() - rt) / 1000).toFixed(0)}s | host ${st[0]} | client ${st[1]}`);
  }
  if (floor < 4) {
    await host.evaluate(() => window.__game.goNextFloor());
    for (const p of [host, client]) await p.waitForFunction((f) => window.__game.floorIndex === f && !window.__game.loadingFloor && !window.__game.transitioning, floor + 1, { timeout: 240000 });
    await host.waitForTimeout(1000);
  }
}
const hostPings = await host.evaluate(() => window.__game.pings.filter((x) => x.kind === 'foe').length);
const same = await both(() => window.__game.level.rooms.map((r) => r.type).join(''));
console.log(`done in ${((Date.now() - t0) / 1000).toFixed(0)}s; client pings sent ${pings}, foe pings alive on host now ${hostPings}; same floor ${same[0] === same[1]}; ended ${JSON.stringify(await both(() => window.__game.ended))}`);
console.log('errors:', errors.length);
await browser.close();
