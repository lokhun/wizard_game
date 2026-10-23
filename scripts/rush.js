// Functional test of Boss Rush (run with smoke.mjs "?autostart=pyromancer&test=1&norender=1&seed=4242&rush", wait 3000).
// For each realm: checks the party starts in the antechamber with its lecterns and every other chamber won,
// takes the tomes, walks into the boss, kills it and steps on; at the end the run must be won with a Boss
// Rush record. Every line should read ok.
(async () => {
  while (!window.__game || window.__game.menuMode || !window.__game.player || window.__game.player.id !== 'solo' || window.__game.loadingFloor) await new Promise((r) => setTimeout(r, 200));
  await new Promise((r) => setTimeout(r, 300));
  const g = window.__game, p = g.player, inp = window.__input;
  const log = [], errs = [];
  window.addEventListener('error', (e) => errs.push(e.message));
  const ok = (name, cond, extra = '') => log.push(`${cond ? 'ok  ' : 'FAIL'} ${name} ${extra}`);
  g.ui.chooseTome = (c, cb) => cb(c[0]); g.ui.chooseRelic = (c, cb) => cb(c[0]);
  const { rollTomes } = window.__upgrades;
  ok('rush on', !!g.difficulty.rush);
  for (let f = 0; f < 5; f++) {
    while (g.loadingFloor || g.transitioning) await new Promise((r) => setTimeout(r, 100));
    const L = g.level, boss = L.bossRoom, here = L.roomAt(p.pos.x, p.pos.z);
    const peds = g.interactables.filter((i) => i.kind === 'pedestal');
    const side = g.interactables.filter((i) => ['chest', 'shrine', 'shop', 'altar', 'gambler'].includes(i.kind)).length;
    const allWon = L.rooms.every((r) => r === boss || r.cleared);
    ok(`F${f} antechamber`, here && here !== boss && peds.length >= 3 && side === 0 && allWon && !boss.cleared, `${peds.length} lecterns (${peds.filter((x) => x.relic).length} relic), side rewards ${side}, hp ${p.hp}/${p.maxHp}`);
    for (const it of peds) if (it.pos.distanceTo(p.pos) < 25) g.interact(it);
    const tomes = p.upgrades.length;
    p.pos.set(boss.cx, g.groundY(boss.cx, boss.cz), boss.cz + 6);
    let t = 0;
    while (!g.ended && !g.interactables.some((i) => /ortal/.test(i.kind)) && t < 240) {
      window.__sim(0.5, 1 / 30, () => {
        if (p.downed || p.dead) p.revive(1); p.hp = p.maxHp; // (no god mode: the run must be recorded)
        let best = null, bd = 1e9;
        for (const a of g.actors.hostiles()) { if (a.boss) a.hp = Math.min(a.hp, a.maxHp * 0.03); const d = a.pos.distanceTo(p.pos); if (d < bd && !a.dormant) { bd = d; best = a; } }
        if (best) { const dx = best.pos.x - p.pos.x, dz = best.pos.z - p.pos.z; p.yaw = Math.atan2(-dx, -dz); p.pitch = Math.atan2(best.pos.y + best.height * 0.5 - p.pos.y - 1.6, Math.hypot(dx, dz)); }
        inp.mouse.left = !!best;
      });
      t += 0.5;
    }
    inp.mouse.left = false;
    ok(`F${f} boss`, g.ended || g.interactables.some((i) => /ortal/.test(i.kind)), `${t}s, tomes ${tomes}`);
    if (f < 4) { g.goNextFloor(); await new Promise((r) => setTimeout(r, 400)); }
  }
  await new Promise((r) => setTimeout(r, 1000));
  const prof = JSON.parse(localStorage.getItem(Object.keys(localStorage).find((k) => /profile/i.test(k))) ?? '{}');
  ok('won, recorded', g.ended && g.meta.run?.won && prof.records?.rushBest > 0 && !prof.records?.fastestWin, `rushBest ${prof.records?.rushBest} fastestWin ${prof.records?.fastestWin} feats ${Object.keys(prof.feats ?? {}).join(',')}`);
  return { log, errs };
})();
