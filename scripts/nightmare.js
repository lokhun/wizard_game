// Functional test of Nightmare (run with smoke.mjs "?autostart=pyromancer&test=1&norender=1&seed=4242&floor=1&nightmare", wait 3000).
// Checks the knobs and label, that foes chain melee blows and loose follow-up shots, that a flawless
// chamber grants a Dread Mark (+5% damage) and a hurt one does not, that no tome comes Common, and that
// a boss looses dread rings and leaves a relic beside its tome. Every line should read ok.
(async () => {
  while (!window.__game || window.__game.menuMode || !window.__game.player || window.__game.player.id !== 'solo' || window.__game.loadingFloor) await new Promise((r) => setTimeout(r, 200));
  await new Promise((r) => setTimeout(r, 300));
  const g = window.__game, inp = window.__input, p = g.player, D = g.difficulty;
  const log = [], errs = [];
  window.addEventListener('error', (e) => errs.push(e.message));
  const ok = (name, cond, extra = '') => log.push(`${cond ? 'ok  ' : 'FAIL'} ${name} ${extra}`);
  ok('knobs', D.nightmare && D.heat === 10 && D.aiCd < 1 && D.minRarity === 1, `heat ${D.heat}`);
  ok('label', /Nightmare/.test(document.querySelector('.hud')?.textContent ?? document.body.textContent));
  // count combos and follow-up shots
  let combos = 0, taps = 0;
  const A = g.actors, ob = A._beginAttack.bind(A), os = A._strike.bind(A);
  A._beginAttack = (a, at, t) => { if (a.state === 'recover') combos++; return ob(a, at, t); };
  A._strike = (a, t, d) => { if (a._tap) taps++; return os(a, t, d); };
  const aim = (x) => { const dx = x.pos.x - p.pos.x, dz = x.pos.z - p.pos.z; p.yaw = Math.atan2(-dx, -dz); p.pitch = Math.atan2(x.pos.y + x.height * 0.5 - p.pos.y - 1.6, Math.hypot(dx, dz)); };
  const fight = (room, immune) => {
    const td = p.takeDamage;
    if (immune) p.takeDamage = () => 0;
    p.pos.set(room.cx, g.groundY(room.cx, room.cz), room.cz);
    let t = 0;
    window.__sim(0.5);
    while ((g.director.active || g.actors.hostiles().some((a) => !a.dormant && a.homeRoom === room)) && t < 150) {
      window.__sim(0.5, 1 / 30, () => {
        if (p.downed || p.dead) p.revive(1);
        if (!immune) p.hp = p.maxHp;
        let best = null, bd = 1e9;
        for (const x of g.actors.hostiles()) { const d = x.pos.distanceTo(p.pos); if (d < bd && !x.dormant) { bd = d; best = x; } }
        if (best) aim(best);
        inp.mouse.left = !!best;
        if (best && bd > 10) inp.down.add('KeyW'); else inp.down.delete('KeyW'); // close in on foes that keep their distance
      });
      t += 0.5;
    }
    inp.mouse.left = false;
    inp.down.clear();
    p.takeDamage = td;
    return t;
  };
  const main = g.level.rooms.filter((r) => r.main && r.type === 'combat').sort((a, b) => a.order - b.order);
  const dm0 = p.stats.dmgMult;
  // a passive spell first (no stagger from our fire): melee chains, archers double-tap
  { const td = p.takeDamage; p.takeDamage = () => 0; p.pos.set(main[0].cx, g.groundY(main[0].cx, main[0].cz), main[0].cz); window.__sim(20); p.takeDamage = td; }
  ok('combos and follow-up shots', combos > 0 && taps > 0, `combos ${combos}, follow-ups ${taps}`);
  fight(main[0], false);
  ok('hurt chamber: no mark', p.dread === 0, `dread ${p.dread}`);
  fight(main[1], true);
  ok('flawless chamber: a mark', p.dread === 1 && Math.abs(p.stats.dmgMult - dm0 - 0.05) < 1e-6, `dread ${p.dread}, dmgMult ${dm0.toFixed(2)} -> ${p.stats.dmgMult.toFixed(2)}, HUD ${document.querySelector('#dreadTxt')?.textContent}`);
  const peds = g.interactables.filter((i) => i.kind === 'pedestal');
  ok('no Common tomes', peds.length > 0 && peds.every((i) => (i.minRarity ?? 0) >= 1), peds.map((i) => i.minRarity).join(','));
  // the boss: dread rings, then a relic beside the tome
  let dreads = 0; const ofx = g.bossFx.bind(g);
  g.bossFx = (k, a, e) => { if (k === 'dread') dreads++; return ofx(k, a, e); };
  const room = g.level.bossRoom;
  p.pos.set(room.cx, g.groundY(room.cx, room.cz), room.cz + 6);
  window.__sim(25, 1 / 30, () => { if (p.downed || p.dead) p.revive(1); p.hp = p.maxHp; });
  ok('dread rings', dreads >= 2, `${dreads} in 25 s`);
  let t = 0;
  while (!g.interactables.some((i) => i.kind === 'portal') && t < 200) {
    window.__sim(0.5, 1 / 30, () => {
      if (p.downed || p.dead) p.revive(1); p.hp = p.maxHp;
      let best = null, bd = 1e9;
      for (const x of g.actors.hostiles()) { x.hp = Math.min(x.hp, 1); const d = x.pos.distanceTo(p.pos); if (d < bd && !x.dormant) { bd = d; best = x; } }
      if (best) aim(best);
      inp.mouse.left = !!best;
    });
    t += 0.5;
  }
  inp.mouse.left = false;
  const bp = g.interactables.filter((i) => i.kind === 'pedestal' && g.level.roomAt(i.pos.x, i.pos.z) === room);
  ok('boss relic', bp.some((i) => i.relic) && bp.some((i) => !i.relic), bp.map((i) => (i.relic ? 'relic' : 'tome')).join(','));
  return { log, errs };
})();
