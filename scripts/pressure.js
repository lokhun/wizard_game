// Balance check (run with smoke.mjs, e.g.
//   node scripts/smoke.mjs "?autostart=pyromancer&test=1&norender=1&seed=4242&floor=2&party=4" out.png 2000 scripts/pressure.js
// The player fights the floor's first combat rooms (&rooms=N, default 3) against the director's real
// waves, scaled for &party=N players, with health refilled every frame. Reports damage taken (in
// max-health units) per minute and seconds per room; &rs seeds Math.random. Compare builds on the
// same seed. With party=4 one wizard draws all the aggro: per player, divide by about 4.
(async () => {
  while (!window.__game || !window.__game.player || window.__game.loadingFloor || window.__game.menuMode || window.__game.player.id !== "solo" || !window.__sim) await new Promise((r) => setTimeout(r, 200));
  await new Promise((r) => setTimeout(r, 500));
  const Q = new URLSearchParams(location.search);
  const party = +(Q.get('party') ?? 1);
  let seed = +(Q.get('rs') ?? 7);
  Math.random = () => { seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const g = window.__game, p = g.player, inp = window.__input;
  g.director.partySize = () => party;
  let hurt = 0;
  g.events.on('hurt', (d) => { hurt += d / p.maxHp; });
  const aim = () => {
    let best = null, bd = 1e9;
    for (const a of g.actors.hostiles()) { const d = a.pos.distanceTo(p.pos); if (d < bd) { bd = d; best = a; } }
    if (!best) return null;
    const dx = best.pos.x - p.pos.x, dz = best.pos.z - p.pos.z, dy = best.pos.y + best.height * 0.5 - (p.pos.y + 1.6);
    p.yaw = Math.atan2(-dx, -dz); p.pitch = Math.atan2(dy, Math.hypot(dx, dz));
    return { d: bd };
  };
  const rooms = g.level.rooms.filter((r) => r.main && r.type === 'combat').sort((a, b) => a.order - b.order).slice(0, +(Q.get('rooms') ?? 3));
  let secs = 0, n = 0;
  for (const room of rooms) {
    p.pos.set(room.cx, g.groundY(room.cx, room.cz), room.cz);
    let t = 0, frames = 0;
    window.__sim(0.5);
    while (g.director.active && t < 150) {
      window.__sim(0.5, 1 / 30, () => {
        frames++;
        p.hp = p.maxHp; if (p.downed) p.revive(1);
        const tgt = aim();
        inp.mouse.left = !!tgt;
        if (frames % 90 < 45) { inp.down.add('KeyA'); inp.down.delete('KeyD'); } else { inp.down.add('KeyD'); inp.down.delete('KeyA'); }
        if (tgt && tgt.d < 5) inp.down.add('KeyS'); else inp.down.delete('KeyS');
        if (tgt && tgt.d > 14) inp.down.add('KeyW'); else inp.down.delete('KeyW');
        if (frames % 70 === 0) inp.pressed.add('KeyQ');
        if (frames % 97 === 0) inp.pressed.add('KeyE');
        if (frames % 50 === 0) { inp.mouse.rightPressed = true; inp.mouse.right = true; }
        if (frames % 50 === 30) inp.mouse.right = false;
        if (frames % 120 === 0) inp.pressed.add('ShiftLeft');
      });
      t += 0.5;
    }
    inp.down.clear(); inp.mouse.left = false; inp.mouse.right = false;
    secs += t; n++;
  }
  return { floor: g.floorIndex, party, cls: p.classId, hurtPerMin: +(hurt / secs * 60).toFixed(2), secPerRoom: +(secs / n).toFixed(1), hurtPerRoom: +(hurt / n).toFixed(2) };
})()
