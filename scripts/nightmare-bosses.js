// Every boss's Nightmare signature move (run with smoke.mjs "?autostart=pyromancer&test=1&norender=1&seed=4242&nightmare", wait 3000).
// For each realm: load it, wake the boss, put it in its second phase and let it fight a god-mode wizard for
// 40 s. Each line reports how often the signature move came, how many hazards it laid and the slowest sim step.
(async () => {
  while (!window.__game || window.__game.menuMode || !window.__game.player || window.__game.loadingFloor) await new Promise((r) => setTimeout(r, 200));
  await new Promise((r) => setTimeout(r, 300));
  const g = window.__game, p = g.player;
  g.godMode = true;
  const { SCRIPTS } = await import('/src/game/bosses.js');
  const log = [], errs = [];
  window.addEventListener('error', (e) => errs.push(e.message));
  for (let f = 0; f < 5; f++) {
    if (g.floorIndex !== f) { g.loadFloor(f); while (g.loadingFloor) await new Promise((r) => setTimeout(r, 100)); }
    const room = g.level.bossRoom;
    p.pos.set(room.cx, g.groundY(room.cx, room.cz), room.cz + 7);
    let boss = null;
    for (let i = 0; i < 100 && !boss; i++) { window.__sim(0.1); boss = g.actors.list.find((a) => a.boss && !a.dead); }
    if (!boss) { log.push(`F${f}: FAIL no boss`); continue; }
    const S = SCRIPTS[boss.type], nm = S.nightmare;
    let uses = 0, hz = 0, worst = 0;
    const run = nm.run;
    nm.run = (B, t, d) => { uses++; const n0 = g.hazards.length; const r = run(B, t, d); hz = Math.max(hz, g.hazards.length - n0); return r; };
    boss.hp = boss.maxHp * 0.6; // second phase
    for (let t = 0; t < 40; t += 0.5) {
      const t0 = performance.now();
      window.__sim(0.5, 1 / 30, () => { if (p.downed || p.dead) p.revive(1); p.hp = p.maxHp; if (boss.hp < boss.maxHp * 0.4) boss.hp = boss.maxHp * 0.6; });
      worst = Math.max(worst, (performance.now() - t0) / 15);
    }
    nm.run = run;
    log.push(`${uses > 0 ? 'ok  ' : 'FAIL'} F${f} ${boss.type}: ${nm.title} x${uses}, ${hz} hazards at once, worst step ${worst.toFixed(1)} ms`);
    boss.hp = 0; g.actors.kill?.(boss, 0, 'physical');
    window.__sim(1);
  }
  return { log, errs };
})();
