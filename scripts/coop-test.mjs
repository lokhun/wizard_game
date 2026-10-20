// Two-browser co-op smoke test against a local PeerJS server.
// Usage: (npx peerjs --port 9000 --path /wizard &) ; node scripts/coop-test.mjs
import { chromium } from 'playwright-core';
const PORT = process.env.PORT ?? 5190;
const peerQ = 'peerHost=127.0.0.1&peerPort=9000&peerPath=/wizard&peerSecure=0&quality=low&test=1';
const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const mk = async (tag) => {
  const p = await browser.newPage({ viewport: { width: 960, height: 540 } });
  p.on('pageerror', (e) => console.log(`[${tag} pageerror]`, e.message));
  p.on('console', (m) => { if (m.type() === 'error') console.log(`[${tag} err]`, m.text().slice(0, 300)); });
  return p;
};
const host = await mk('host');
await host.goto(`http://localhost:${PORT}/?${peerQ}`);
await host.waitForFunction(() => document.querySelector('#bHost'), null, { timeout: 120000 });
await host.click('#bHost');
await host.waitForFunction(() => document.querySelector('#lobbyCode')?.textContent?.length >= 5, null, { timeout: 60000 });
const code = await host.$eval('#lobbyCode', (e) => e.textContent);
console.log('party code', code);
const client = await mk('client');
await client.goto(`http://localhost:${PORT}/?${peerQ}&join=${code}`);
await client.waitForFunction(() => document.querySelector('#lobbyPlayers')?.children.length >= 2, null, { timeout: 120000 });
console.log('client sees lobby:', await client.$eval('#lobbyPlayers', (e) => e.textContent.replace(/\s+/g, ' ')));
// client picks a class then readies; host starts
await client.click('.card[data-id="lightbinder"]');
await client.click('#bGo');
await host.waitForTimeout(1500);
console.log('host lobby:', await host.$eval('#lobbyPlayers', (e) => e.textContent.replace(/\s+/g, ' ')));
await host.click('#bGo');
await host.waitForFunction(() => window.__game && !window.__game.menuMode && window.__game.remotes.size === 1, null, { timeout: 120000 });
await client.waitForFunction(() => window.__game && !window.__game.menuMode && window.__game.remotes.size === 1, null, { timeout: 120000 });
console.log('both in run');
// host walks into a combat room; client follows via teleport
await host.evaluate(() => { const g = window.__game; const r = g.level.rooms.find((x) => x.type === 'combat'); g.player.pos.set(r.cx, 0, r.cz); });
await host.waitForTimeout(12000);
const hs = await host.evaluate(() => { const g = window.__game; return { actors: g.actors.list.length, remote: [...g.remotes.values()].map((r) => [r.name, r.classId, r.pos.toArray().map((v) => v.toFixed(1))]), active: !!g.director.active }; });
const cs = await client.evaluate(() => { const g = window.__game; return { actors: g.actors.list.length, me: g.player.pos.toArray().map((v) => v.toFixed(1)), remote: [...g.remotes.values()].map((r) => [r.name, r.classId, r.pos.toArray().map((v) => v.toFixed(1))]), locked: g.level.rooms.some((r) => r.doors.some((d) => g.collision.dyn[g.level.doors[d].cells[0]])) }; });
console.log('host state', JSON.stringify(hs));
console.log('client state', JSON.stringify(cs));
// client casts at an enemy: verify host receives damage
const before = await host.evaluate(() => window.__game.stats.damage);
await client.evaluate(() => {
  const g = window.__game; const inp = window.__input;
  const a = g.actors.hostiles()[0]; if (!a) return;
  const p = g.player; const dx = a.pos.x - p.pos.x, dz = a.pos.z - p.pos.z;
  p.yaw = Math.atan2(-dx, -dz); p.pitch = 0;
  inp.mouse.left = true;
});
await client.waitForTimeout(6000);
await client.evaluate(() => { window.__input.mouse.left = false; });
const hostHp = await host.evaluate(() => window.__game.actors.list.map((a) => Math.round(a.hp)).join(','));
console.log('enemy hp on host after client fire:', hostHp, 'client dealt', await client.evaluate(() => Math.round(window.__game.stats.damage)));
await host.screenshot({ path: 'test-output/coop-host.png', timeout: 120000 });
await client.screenshot({ path: 'test-output/coop-client.png', timeout: 120000 });
await browser.close();
void before;
