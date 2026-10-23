// The power curve, measured (run with smoke.mjs, e.g.
//   node scripts/smoke.mjs "?autostart=pyromancer&test=1&norender=1&seed=4242&abyss" out.png 2000 scripts/curve.js
// A bot plays the whole run in __sim time: every main-path fight and boss of the five
// realms, then on into the Abyss (&depths=N, default 2), taking a tome from each reward
// (&pick=first|random, default random) and every relic offered. Health is refilled every
// frame, so it never dies: what's measured is how hard each fight is for the build it has
// by then. Per room: seconds to clear, damage taken in max-health units (and per minute),
// damage dealt per second. &rs seeds Math.random. The arc to aim for: realm 1 slow and
// dangerous, the middle realms fast (the build is online), bosses always a fight, the Abyss
// climbing until it can't be cleared.
(async () => {
  while (!window.__game || !window.__game.player || window.__game.loadingFloor || window.__game.menuMode || window.__game.player.id !== 'solo' || !window.__sim) await new Promise((r) => setTimeout(r, 200));
  await new Promise((r) => setTimeout(r, 500));
  const Q = new URLSearchParams(location.search);
  let seed = +(Q.get('rs') ?? 7);
  Math.random = () => { seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const g = window.__game, p = g.player, inp = window.__input;
  const depths = +(Q.get('depths') ?? 2), pickMode = Q.get('pick') ?? 'random';
  g.abyssUnlocked = true;
  g.ui.chooseTome = (c, cb) => cb(pickMode === 'first' ? c[0] : c[Math.floor(Math.random() * c.length)]);
  g.ui.chooseRelic = (c, cb) => cb(c[0]);
  let hurt = 0, dealt = 0;
  g.events.on('hurt', (d) => { hurt += d / p.maxHp; });
  const dmg0 = () => g.stats?.damage ?? 0;
  const aim = () => {
    let best = null, bd = 1e9;
    for (const a of g.actors.hostiles()) { if (a.dormant) continue; const d = a.pos.distanceTo(p.pos); if (d < bd) { bd = d; best = a; } }
    if (!best) return null;
    const dx = best.pos.x - p.pos.x, dz = best.pos.z - p.pos.z, dy = best.pos.y + best.height * 0.5 - (p.pos.y + 1.6);
    p.yaw = Math.atan2(-dx, -dz); p.pitch = Math.atan2(dy, Math.hypot(dx, dz));
    return { d: bd };
  };
  const rows = [];
  const fight = (room, cap) => {
    hurt = 0; const d0 = dmg0();
    p.pos.set(room.cx, g.groundY(room.cx, room.cz), room.cz + (room.type === 'boss' ? 8 : 0));
    let t = 0, frames = 0;
    window.__sim(0.5);
    while ((g.director.active || (room.type === 'boss' && !room.cleared && g.actors.hostiles().some((a) => a.boss))) && t < cap) {
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
        if (p.ult >= 100) inp.pressed.add('KeyR');
        if (frames % 50 === 0) { inp.mouse.rightPressed = true; inp.mouse.right = true; }
        if (frames % 50 === 30) inp.mouse.right = false;
        if (frames % 120 === 0) inp.pressed.add('ShiftLeft');
      });
      t += 0.5;
    }
    inp.down.clear(); inp.mouse.left = false; inp.mouse.right = false;
    window.__sim(1.5);
    // the reward
    for (const it of [...g.interactables]) if (it.kind === 'pedestal' && it.pos.distanceTo(p.pos) < 40) g.interact(it);
    dealt = dmg0() - d0;
    const row = { r: g.floorIndex, d: g.abyss ?? 0, type: room.type, ttk: t, hurt: +hurt.toFixed(2), hurtMin: +(hurt / Math.max(t, 1) * 60).toFixed(2), dps: Math.round(dealt / Math.max(t, 1)), tomes: p.upgrades.length, relics: p.relics?.length ?? 0, capped: t >= cap };
    rows.push(row);
    return row;
  };
  const wait = async (f) => { for (let k = 0; k < 600 && !f(); k++) await new Promise((r) => setTimeout(r, 100)); };
  for (let lap = 0; lap <= depths; lap++) {
    for (let f = lap === 0 ? g.floorIndex : 0; f < 5; f++) {
      await wait(() => !g.loadingFloor && !g.transitioning);
      const rooms = g.level.rooms.filter((r) => r.main && ['combat', 'elite', 'trial', 'boss'].includes(r.type)).sort((a, b) => a.order - b.order);
      for (const room of rooms) {
        const row = fight(room, room.type === 'boss' ? 400 : 240);
        if (row.capped && room.type === 'boss') { rows.push({ stop: `boss not killed in 400 s at realm ${f + 1}, depth ${lap}` }); return report(); }
      }
      if (f < 4) { g.goNextFloor(); await wait(() => g.floorIndex === f + 1 && !g.loadingFloor && !g.transitioning); }
    }
    if (lap < depths) { g.descendAbyss(); await wait(() => (g.abyss ?? 0) === lap + 1 && g.floorIndex === 0 && !g.loadingFloor && !g.transitioning); }
  }
  return report();
  function report() {
    return rows.map((r) => (r.stop ? r.stop : `R${r.r + 1} D${r.d} ${r.type.padEnd(6)} ttk ${String(r.ttk).padStart(5)}s  hurt ${String(r.hurt).padStart(5)} (${String(r.hurtMin).padStart(5)}/min)  dps ${String(r.dps).padStart(6)}  tomes ${r.tomes} relics ${r.relics}${r.capped ? '  CAPPED' : ''}`));
  }
})();
