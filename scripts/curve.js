// The power curve, measured (run with smoke.mjs, e.g.
//   node scripts/smoke.mjs "?autostart=pyromancer&test=1&norender=1&seed=4242&abyss" out.png 2000 scripts/curve.js
// A bot plays the whole run in __sim time: every main-path fight and boss of the five
// realms, then on into the Abyss (&depths=N, default 2), taking a tome from each reward
// (&pick=first|random|greedy, default random; greedy drafts for damage like a strong player) and every relic offered. Health is refilled every
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
  // greedy: a player drafting for damage (the order a strong build reaches for), finer rarity first among equals
  const GREED = ['multicast', 'empower', 'devastation', 'focus', 'haste', 'elemental', 'split', 'glass', 'pierce', 'elites', 'executioner', 'static', 'hexrune', 'velocity', 'echo', 'cdr', 'aoe', 'ember', 'venom', 'bloodrune', 'ult'];
  const greed = (t) => { const i = GREED.indexOf(t.def.id); return (i < 0 ? (t.def.aug ? 6.5 : 40) : i) - t.rarity * 0.6; };
  g.ui.chooseTome = (c, cb) => cb(pickMode === 'first' ? c[0] : pickMode === 'greedy' ? [...c].sort((a, b) => greed(a) - greed(b))[0] : c[Math.floor(Math.random() * c.length)]);
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
  // damage by source (element, tag, or a summon's), per depth: what a build leans on
  const src = {};
  const dm = g.actors.damage.bind(g.actors);
  g.actors.damage = (a, H) => { const b = a.hp; const r = dm(a, H); const k = 'D' + (g.abyss ?? 0) + ' ' + (g.actors.byId.get(H.src)?.faction === 'ally' ? 'summon' : (H.tag ? H.tag + '/' : '') + (H.el ?? '?')); src[k] = (src[k] ?? 0) + Math.max(0, b - a.hp); return r; };
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
  // single-target damage, the clean number: before each realm's guardian, a pinned dummy of the realm's own
  // stock takes 6 s of the build's fire (hp lost, so no overkill and no wave pacing), set against that realm's
  // typical foe health; ttkFoe is how long one ordinary foe lasts under that fire
  const dummy = () => {
    const roster = [...new Set(g.biome.enemies)];
    // (somewhere in plain sight: straight ahead could put it behind a courtyard statue)
    let at = { x: p.pos.x, z: p.pos.z - 9 };
    find: for (const r of [8, 6, 4]) for (let k = 0; k < 12; k++) {
      const ang = (k / 12) * Math.PI * 2, x = p.pos.x + Math.sin(ang) * r, z = p.pos.z - Math.cos(ang) * r;
      if (g.collision.cellBlocked(Math.floor(x / 2), Math.floor(z / 2), p.pos.y + 0.3) || g.collision.pushOut(x, z, 0.6)) continue;
      if (g.collision.los(p.pos.x, p.pos.y + 1.6, p.pos.z, x, g.groundY(x, z) + 1, z)) { at = { x, z }; break find; }
    }
    let hp = 0, n = 0;
    for (const t of roster) { const a = g.director.spawnEnemy(t, at.x, at.z, { noCredit: true }); if (!a) continue; hp += a.maxHp; n++; a.hp = 0; g.actors.kill(a, 0, 'holy'); }
    window.__sim(0.5);
    const a = g.director.spawnEnemy(roster[0], at.x, at.z, { noCredit: true });
    a.maxHp = a.hp = 1e9;
    window.__sim(1.2, 1 / 30, () => { a.pos.x = at.x; a.pos.z = at.z; });
    const h0 = a.hp; let frames = 0;
    window.__sim(6, 1 / 30, () => {
      frames++; p.hp = p.maxHp; if (p.downed) p.revive(1);
      a.pos.x = at.x; a.pos.z = at.z; a.kb.x = a.kb.z = 0;
      const dx = a.pos.x - p.pos.x, dz = a.pos.z - p.pos.z;
      p.yaw = Math.atan2(-dx, -dz); p.pitch = Math.atan2(a.pos.y + a.height * 0.5 - (p.pos.y + 1.6), Math.hypot(dx, dz));
      inp.mouse.left = true;
      if (frames % 70 === 0) inp.pressed.add('KeyQ');
      if (frames % 97 === 0) inp.pressed.add('KeyE');
      if (frames % 50 === 0) { inp.mouse.rightPressed = true; inp.mouse.right = true; }
      if (frames % 50 === 30) inp.mouse.right = false;
    });
    inp.mouse.left = false; inp.mouse.right = false;
    const st = (h0 - a.hp) / 6;
    a.hp = 0; g.actors.kill(a, 0, 'holy'); window.__sim(0.5);
    rows.push({ dummy: true, r: g.floorIndex, d: g.abyss ?? 0, foeHp: Math.round(hp / n), st: Math.round(st), ttkFoe: +(hp / n / st).toFixed(2),
      why: st > 0 ? '' : JSON.stringify({ los: g.collision.los(p.pos.x, p.pos.y + 1.6, p.pos.z, at.x, a.pos.y + a.height * 0.5, at.z), gap: +Math.hypot(at.x - p.pos.x, at.z - p.pos.z).toFixed(1), dummy: [a.anim, a.dormant, a.dead, +a.pos.y.toFixed(2), +g.groundY(at.x, at.z).toFixed(2), +p.pos.y.toFixed(2)], cast: p.canCast(), alive: p.alive, downed: p.downed, dead: p.dead, paused: g.paused, modal: !!g.ui.modalOpen, top: g.ui.modalStack?.at(-1)?.textContent?.slice(0, 120), cin: !!g.cinematic, locked: inp.locked, stun: p.stunT, ch: !!p.channel }) });
  };
  const wait = async (f) => { for (let k = 0; k < 600 && !f(); k++) await new Promise((r) => setTimeout(r, 100)); };
  for (let lap = 0; lap <= depths; lap++) {
    for (let f = lap === 0 ? g.floorIndex : 0; f < 5; f++) {
      await wait(() => !g.loadingFloor && !g.transitioning);
      const rooms = g.level.rooms.filter((r) => r.main && ['combat', 'elite', 'trial', 'boss'].includes(r.type)).sort((a, b) => a.order - b.order);
      let prev = null;
      for (const room of rooms) {
        if (room.type === 'boss' && prev) { p.pos.set(prev.cx, g.groundY(prev.cx, prev.cz), prev.cz + 4); dummy(); }
        prev = room;
        const row = fight(room, room.type === 'boss' ? 400 : 240);
        if (row.capped && room.type === 'boss') { rows.push({ stop: `boss not killed in 400 s at realm ${f + 1}, depth ${lap}` }); return report(); }
      }
      if (f < 4) { g.goNextFloor(); await wait(() => g.floorIndex === f + 1 && !g.loadingFloor && !g.transitioning); }
    }
    if (lap < depths) { g.descendAbyss(); await wait(() => (g.abyss ?? 0) === lap + 1 && g.floorIndex === 0 && !g.loadingFloor && !g.transitioning); }
  }
  return report();
  function report() {
    const top = {};
    for (const [k, v] of Object.entries(src)) { const d = k.split(' ')[0]; (top[d] ??= []).push([k.slice(d.length + 1), v]); }
    const lines = Object.entries(top).map(([d, l]) => { const t = l.reduce((a, x) => a + x[1], 0); return d + ' sources: ' + l.sort((a, b) => b[1] - a[1]).slice(0, 5).map(([k, v]) => k + ' ' + Math.round(v / t * 100) + '%').join(', '); });
    return [...lines, 'relics: ' + p.relics.map((r) => r.def.id + (r.stars ? '*' + r.stars : '')).join(' '), 'stats: dmg ' + p.stats.dmgMult.toFixed(2) + ' rate ' + (p.stats.rateMult ?? 0).toFixed(2) + ' crit ' + (p.stats.critChance ?? 0).toFixed(2) + '/' + (p.stats.critMult ?? 0).toFixed(2) + ' proj ' + p.stats.extraProj, ...rows.map((r) => (r.stop ? r.stop : r.dummy ? `R${r.r + 1} D${r.d} DUMMY  single-target ${String(r.st).padStart(6)}/s  foe hp ${String(r.foeHp).padStart(5)}  -> one foe lasts ${r.ttkFoe}s${r.why ? '  STUCK ' + r.why : ''}` : `R${r.r + 1} D${r.d} ${r.type.padEnd(6)} ttk ${String(r.ttk).padStart(5)}s  hurt ${String(r.hurt).padStart(5)} (${String(r.hurtMin).padStart(5)}/min)  dps ${String(r.dps).padStart(6)}  tomes ${r.tomes} relics ${r.relics}${r.capped ? '  CAPPED' : ''}`))];
  }
})();
