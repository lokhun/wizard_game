// Functional test of the Abyss (run with smoke.mjs "?autostart=pyromancer&test=1&norender=1&floor=4&abyss&seed=77", wait 3000).
// Kills the Hollow King, checks both portals open, descends, checks the run restarts at realm 1 deadlier
// with the victory banked, then dies in the Abyss: the summary must read won + fell at depth 1.
(async () => {
  while (!window.__game || window.__game.menuMode || !window.__game.player || window.__game.player.id !== 'solo' || window.__game.loadingFloor) await new Promise((r) => setTimeout(r, 200));
  await new Promise((r) => setTimeout(r, 300));
  const g = window.__game, inp = window.__input, p = g.player;
  const log = [], errs = [];
  window.addEventListener('error', (e) => errs.push(e.message));
  const keepAlive = () => { if (p.downed || p.dead) p.revive(1); p.hp = p.maxHp; };
  const aim = (t) => { const dx = t.x - p.pos.x, dz = t.z - p.pos.z, dy = (t.y ?? 1) - (p.pos.y + 1.6); p.yaw = Math.atan2(-dx, -dz); p.pitch = Math.atan2(dy, Math.hypot(dx, dz)); };
  const hp0 = g.director.hpScale(), dmg0 = g.director.dmgScale();
  const room = g.level.bossRoom;
  p.pos.set(room.cx, g.groundY(room.cx, room.cz), room.cz + 6);
  let t = 0;
  while (!g.interactables.some((i) => i.kind === 'abyssPortal') && t < 300) {
    window.__sim(0.5, 1 / 30, () => {
      keepAlive();
      const b = g.actors.hostiles().find((a) => a.boss);
      if (b && b.hp > b.maxHp * 0.02) b.hp = Math.min(b.hp, b.maxHp * 0.02); // skip the long fight
      let best = null, bd = 1e9;
      for (const a of g.actors.hostiles()) { const d = a.pos.distanceTo(p.pos); if (d < bd && !a.dormant) { bd = d; best = a; } }
      if (best) aim({ x: best.pos.x, y: best.pos.y + best.height * 0.5, z: best.pos.z });
      inp.mouse.left = !!best;
    });
    t += 0.5;
  }
  inp.mouse.left = false;
  const kinds = g.interactables.map((i) => i.kind).filter((k) => /Portal|portal/.test(k));
  log.push(`boss down after ${t}s; portals: ${kinds.join(',')}; ended=${g.ended}`);
  g.descendAbyss();
  for (let i = 0; i < 40 && (g.transitioning || g.loadingFloor); i++) { await new Promise((r) => setTimeout(r, 250)); window.__sim(0.25); }
  await new Promise((r) => setTimeout(r, 500));
  const r = g.meta.run;
  log.push(`after descent: abyss=${g.abyss} floor=${g.floorIndex} ended=${g.ended} hp=${p.hp}/${p.maxHp} run.won=${r?.won} run.abyss=${r?.abyss} winTime=${Math.round(r?.winTime)} curse=${JSON.stringify(g.difficulty.pacts)} heat=${g.difficulty.heat}`);
  log.push(`scale F5 hp ${hp0.toFixed(2)} dmg ${dmg0.toFixed(2)} -> abyss F1 hp ${g.director.hpScale().toFixed(2)} dmg ${g.director.dmgScale().toFixed(2)}`);
  log.push(`feats: ${r?.feats.join(',')}`);
  // fight the first room of the Abyss and note elites/twin affixes
  const main = g.level.rooms.filter((x) => x.main).sort((a, b) => a.order - b.order);
  const first = main[1];
  p.pos.set(first.cx, g.groundY(first.cx, first.cz), first.cz);
  window.__sim(2);
  const hs = g.actors.hostiles();
  log.push(`abyss room1 ${first.type}: ${hs.length} foes, elites ${hs.filter((a) => a.elite).length}, twin ${hs.filter((a) => a.affix2).length}, sample hp ${hs[0] ? Math.round(hs[0].maxHp) : '-'}`);
  // now die for real
  let summary = null;
  g.events.on('end', () => { setTimeout(() => { summary = document.querySelector('.rs-sub')?.textContent + ' | ' + document.querySelector('.rs-big')?.textContent + ' | ' + [...document.querySelectorAll('.rs-badge')].map((b) => b.textContent).join(' / '); }, 50); });
  for (let i = 0; i < 60 && !g.ended; i++) window.__sim(0.5, 1 / 30, () => { p.selfRevives = 0; if (!p.dead && !p.downed) p.takeDamage(p.maxHp * 2, 'physical', null); });
  await new Promise((r) => setTimeout(r, 400));
  log.push(`ended=${g.ended}; summary: ${summary}`);
  const prof = JSON.parse(localStorage.getItem(Object.keys(localStorage).find((k) => /profile/i.test(k))) ?? '{}');
  log.push(`profile: wins=${prof.wins} deaths=${prof.deaths} deepestAbyss=${prof.records?.deepestAbyss} pyro.bestAbyss=${prof.classes?.pyromancer?.bestAbyss} fastest=${prof.records?.fastestWin} nightmareWins=${prof.records?.nightmareWins} pyro.nightmare=${prof.classes?.pyromancer?.nightmare} feats=${Object.keys(prof.feats ?? {}).join(",")}`);
  return { log, errs };
})();
