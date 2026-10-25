// Functional test of the mechanical pacts (run with smoke.mjs "?autostart=pyromancer&test=1&norender=1&seed=4242", wait 3000).
// Sets every pact at full rank, reloads floor 2 and checks each knob takes hold: omens on every fight past the
// first, two tome choices, slower dash, champions with two affixes, slain foes bursting, waves coming early,
// richer gold and luckier tomes. Every line should read ok.
(async () => {
  while (!window.__game || window.__game.menuMode || !window.__game.player || window.__game.player.id !== 'solo' || window.__game.loadingFloor) await new Promise((r) => setTimeout(r, 200));
  await new Promise((r) => setTimeout(r, 300));
  const g = window.__game, inp = window.__input, p = g.player;
  const { difficultyFor, PACTS } = await import('/src/meta/pacts.js');
  const { generateLevel } = await import('/src/world/levelgen.js');
  const { rollTomes } = window.__upgrades;
  const log = [], errs = [];
  window.addEventListener('error', (e) => errs.push(e.message));
  const ok = (name, cond, extra = '') => log.push(`${cond ? 'ok  ' : 'FAIL'} ${name} ${extra}`);
  const all = Object.fromEntries(PACTS.map((x) => [x.id, x.max]));
  const base = difficultyFor({});
  g.difficulty = difficultyFor(all);
  ok('heat', g.difficulty.heat === 37, g.difficulty.heat);
  // omens: every fight from order 2 bears a mod
  const L0 = generateLevel(4242, 2, null, { omens: 0 }), L2 = generateLevel(4242, 2, null, { omens: 2 });
  const fights = (L) => L.rooms.filter((r) => r.main && r.type === 'combat' && r.order >= 2);
  ok('omens', fights(L2).every((r) => r.mod) && fights(L0).filter((r) => r.mod).length < fights(L2).length, `${fights(L0).filter((r) => r.mod).length} -> ${fights(L2).filter((r) => r.mod).length}/${fights(L2).length}`);
  // narrow path
  ok('narrow', g.difficulty.tomeChoices === 2 && base.tomeChoices === 3);
  // heat luck: rarer tomes more often
  let rare0 = 0, rare1 = 0;
  g.difficulty = base; for (let i = 0; i < 400; i++) rare0 += rollTomes(p, 3).filter((c) => c.rarity >= 2).length;
  g.difficulty = difficultyFor(all); for (let i = 0; i < 400; i++) rare1 += rollTomes(p, 3).filter((c) => c.rarity >= 2).length;
  ok('tome luck', rare1 > rare0 * 1.2, `${rare0} -> ${rare1} epic+ in 1200 rolls`);
  // leaden steps: dash recharge
  const dashT = (d) => { g.difficulty = d; p.dashCharges = 0; p.dashRecharge = 0.01; window.__sim(0.05); let t = 0; while (p.dashCharges < p.stats.dashCharges && t < 30) { window.__sim(0.1); t += 0.1; } return t; };
  const t0 = dashT(base), t1 = dashT(difficultyFor(all));
  ok('leaden', t1 > t0 * 1.3, `${t0.toFixed(1)}s -> ${t1.toFixed(1)}s`);
  // old wounds: regeneration and lifesteal stop at 75% / 50% health; an orb still heals past it
  const healTo = (d) => { g.difficulty = d; p.stats.regen = 40; p.stats.lifesteal = 1; p.hp = p.maxHp * 0.2; p.lastDamageT = -99; window.__sim(3); p._sustainLeft = p.maxHp; p.onDealtDamage?.(500, false, null, 'other'); return p.hp / p.maxHp; };
  const w0 = healTo(base), w1 = healTo(difficultyFor({ wounds: 1 })), w2 = healTo(difficultyFor({ wounds: 2 }));
  p.heal(p.maxHp); const orb = p.hp / p.maxHp;
  p.recomputeStats();
  ok('old wounds', w0 > 0.99 && Math.abs(w1 - 0.75) < 0.01 && Math.abs(w2 - 0.5) < 0.01 && orb > 0.99, `heals stop at ${(w0 * 100).toFixed(0)}% / ${(w1 * 100).toFixed(0)}% / ${(w2 * 100).toFixed(0)}%, an orb heals to ${(orb * 100).toFixed(0)}%`);
  g.difficulty = difficultyFor(all);
  // reload floor 2 under the pacts and fight: champions should carry two affixes, slain foes burst, waves come early
  g.loadFloor(2);
  while (g.loadingFloor) await new Promise((r) => setTimeout(r, 100));
  const hz = []; const ob = g.broadcastHazard.bind(g);
  g.broadcastHazard = (h) => { hz.push(h); return ob(h); };
  const waves = []; const main = g.level.rooms.filter((r) => r.main).sort((a, b) => a.order - b.order);
  let twin = 0, elites = 0, gold0 = g.stats.gold ?? 0;
  for (const room of main.slice(1, 6)) {
    if (room.type === 'boss' || room.type === 'shop') continue;
    p.pos.set(room.cx, g.groundY(room.cx, room.cz), room.cz);
    let t = 0;
    window.__sim(0.5);
    while (g.director.active && t < 120) {
      window.__sim(0.5, 1 / 30, () => {
        if (p.downed || p.dead) p.revive(1); p.hp = p.maxHp;
        const a = g.director.active;
        if (a && a.waveIdx !== waves.at(-1)?.w) waves.push({ w: a.waveIdx, alive: g.actors.hostiles().filter((x) => !x.dormant).length });
        let best = null, bd = 1e9;
        for (const x of g.actors.hostiles()) { if (x.elite) { elites += x._seen ? 0 : 1; twin += !x._seen && x.affix2 ? 1 : 0; x._seen = 1; } const d = x.pos.distanceTo(p.pos); if (d < bd && !x.dormant) { bd = d; best = x; } }
        if (best) { const dx = best.pos.x - p.pos.x, dz = best.pos.z - p.pos.z; p.yaw = Math.atan2(-dx, -dz); p.pitch = Math.atan2(best.pos.y + best.height * 0.5 - p.pos.y - 1.6, Math.hypot(dx, dz)); }
        inp.mouse.left = !!best;
      });
      t += 0.5;
    }
    inp.mouse.left = false;
  }
  ok('volatile', hz.filter((h) => h.el === 'enemyFire' && h.delay === 1.0).length > 5, `${hz.length} hazards`);
  ok('exalted', elites === 0 || twin === elites, `${twin}/${elites} elites with two affixes`);
  ok('relentless', waves.filter((w) => w.w > 0).some((w) => w.alive > 2), JSON.stringify(waves.slice(0, 8)));
  ok('gold', g.difficulty.goldMult > 2, g.difficulty.goldMult.toFixed(2) + ` (gathered ${Math.round((g.stats.gold ?? 0) - gold0)})`);
  return { log, errs };
})();
