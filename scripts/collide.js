// Collision audit (run with smoke.mjs "?autostart=pyromancer&test=1&norender=1&god=1&seed=4242", wait 3000;
// &fl=0..4 for one realm, all five by default). In each realm a wizard random-walks, dashes and jumps through
// every main-path room while its fight runs (Math.random seeded), and each sim step checks:
//  - the wizard's feet in a blocked cell (a wall, a closed door, a ledge too high to stand on),
//  - the wizard overlapping a prop collider by more than 15 cm,
//  - the wizard more than 25 cm below the floor under them,
//  - any living, grounded foe in a blocked cell or more than 25 cm below the floor,
//  - a wizard trying to walk who has not moved 10 cm in 3 s (stuck).
// Each problem prints once per kind and cell, with where it was. A clean realm prints "ok".
(async () => {
  while (!window.__game || window.__game.menuMode || !window.__game.player || window.__game.loadingFloor) await new Promise((r) => setTimeout(r, 200));
  await new Promise((r) => setTimeout(r, 300));
  let seed = 99; Math.random = () => { seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const g = window.__game, p = g.player, inp = window.__input, Q = new URLSearchParams(location.search);
  g.godMode = true;
  const floors = Q.get('fl') ? [+Q.get('fl')] : [0, 1, 2, 3, 4];
  const out = [], errs = [];
  window.addEventListener('error', (e) => errs.push(e.message));
  const T = 2;
  for (const f of floors) {
    if (g.floorIndex !== f) { g.loadFloor(f); while (g.loadingFloor) await new Promise((r) => setTimeout(r, 100)); }
    const C = g.collision; // (each floor builds its own)
    const seen = new Set(), found = [];
    const note = (kind, x, z, extra = '') => { const k = kind + Math.floor(x / T) + ',' + Math.floor(z / T); if (seen.has(k)) return; seen.add(k); found.push(`${kind} at (${x.toFixed(1)}, ${z.toFixed(1)})${extra}`); };
    const rooms = g.level.rooms.filter((r) => r.main && r.type !== 'boss');
    let steps = 0, stuckT = 0, lastX = 0, lastZ = 0, keys = ['KeyW'];
    for (const room of rooms) {
      p.pos.set(room.cx, g.groundY(room.cx, room.cz), room.cz);
      lastX = p.pos.x; lastZ = p.pos.z; stuckT = 0;
      for (let t = 0; t < 12; t += 0.1) {
        window.__sim(0.1, 1 / 30, () => {
          steps++;
          const settled = t > 0.5; // (dropped at a room's centre, where a statue may stand: let it push out)
          p.hp = p.maxHp; if (p.downed) p.revive(1);
          if (Math.random() < 0.04) { for (const k of keys) inp.down.delete(k); keys = [['KeyW'], ['KeyS'], ['KeyA'], ['KeyD'], ['KeyW', 'KeyA'], ['KeyW', 'KeyD']][Math.floor(Math.random() * 6)]; for (const k of keys) inp.down.add(k); p.yaw += (Math.random() - 0.5) * 2; }
          if (Math.random() < 0.02) inp.pressed.add('ShiftLeft');
          if (Math.random() < 0.03) inp.pressed.add('Space');
          inp.mouse.left = Math.random() < 0.5;
          // the wizard
          const cx = Math.floor(p.pos.x / T), cz = Math.floor(p.pos.z / T), fy = g.groundY(p.pos.x, p.pos.z);
          if (p.grounded && C.cellBlocked(cx, cz, p.pos.y + 0.05)) { const i = g.level.idx(cx, cz); note('wizard in a blocked cell', p.pos.x, p.pos.z, ` feet ${p.pos.y.toFixed(2)} floor ${fy.toFixed(2)} cell ${g.level.cells[i]} door ${C.dyn[i]} hgt ${g.level.hgt[i]}`); }
          const po = C.pushOut(p.pos.x, p.pos.z, (p.radius ?? 0.4) - 0.15);
          if (po && settled) note('wizard inside a prop', p.pos.x, p.pos.z);
          if (p.pos.y < fy - 0.25) note('wizard below the floor', p.pos.x, p.pos.z, ` ${p.pos.y.toFixed(2)} < ${fy.toFixed(2)}`);
          // foes
          for (const a of g.actors.list) {
            if (a.dead || !a.alive || a.flying || a.def?.fly || a.airT < a.airDur || a.hiddenT > 0) continue;
            const ay = g.groundY(a.pos.x, a.pos.z);
            if (C.cellBlocked(Math.floor(a.pos.x / T), Math.floor(a.pos.z / T), a.pos.y + 0.05)) note(`${a.type} in a blocked cell`, a.pos.x, a.pos.z, ` feet ${a.pos.y.toFixed(2)} floor ${ay.toFixed(2)}`);
            if (a.pos.y < ay - 0.25 && a.state !== 'spawn') note(`${a.type} below the floor`, a.pos.x, a.pos.z, ` ${a.pos.y.toFixed(2)} < ${ay.toFixed(2)}`);
          }
        });
        // stuck: trying to walk, and in 3 s not 10 cm from where it was
        if (Math.hypot(p.pos.x - lastX, p.pos.z - lastZ) > 0.1) { lastX = p.pos.x; lastZ = p.pos.z; stuckT = 0; } else if ((stuckT += 0.1) > 3) { note('wizard stuck', p.pos.x, p.pos.z); stuckT = 0; p.yaw += Math.PI; }
      }
    }
    for (const k of keys) inp.down.delete(k); inp.mouse.left = false;
    out.push(`${found.length ? 'FAIL' : 'ok  '} F${f} ${g.biome.id}: ${steps} steps over ${rooms.length} rooms${found.length ? '\n    ' + found.slice(0, 12).join('\n    ') + (found.length > 12 ? `\n    (+${found.length - 12} more)` : '') : ''}`);
  }
  return { log: out, errs };
})();
