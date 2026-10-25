// Every boss's gate (run with smoke.mjs "?autostart=pyromancer&test=1&norender=1&seed=4242", wait 3000).
// For each realm: wake the boss, take it just past the threshold that raises its gate, check a plain blow is
// turned away, then do what the gate asks (kill the brood, strike from behind, stand in the glyphs, slip the
// King's blows) and check it breaks and leaves the boss exposed; then raise it again and let it run out.
(async () => {
  while (!window.__game || window.__game.menuMode || !window.__game.player || window.__game.loadingFloor) await new Promise((r) => setTimeout(r, 200));
  await new Promise((r) => setTimeout(r, 300));
  const g = window.__game, p = g.player;
  g.godMode = true;
  const log = [], errs = [];
  window.addEventListener('error', (e) => errs.push(e.message));
  const AT = { motherOfFilth: 0.66, stoneWyvern: 0.6, courtArchmage: 0.33, hollowKing: 0.7 };
  const keep = () => { if (p.downed || p.dead) p.revive(1); p.hp = p.maxHp; };
  for (let f = 0; f < 5; f++) {
    if (g.floorIndex !== f) { g.loadFloor(f); while (g.loadingFloor) await new Promise((r) => setTimeout(r, 100)); }
    const room = g.level.bossRoom;
    p.pos.set(room.cx, g.groundY(room.cx, room.cz), room.cz + 7);
    let boss = null;
    for (let i = 0; i < 100 && !boss; i++) { window.__sim(0.1); boss = g.actors.list.find((a) => a.boss && !a.dead); }
    if (!boss) { log.push(`F${f}: FAIL no boss`); continue; }
    const B = boss.brain, at = AT[boss.type];
    if (!at) { log.push(`F${f} ${boss.type}: no gate (its own thresholds)`); boss.hp = 0; g.actors.kill(boss, 0, 'physical'); window.__sim(1); continue; }
    window.__sim(3, 1 / 30, keep); // (the intro)
    // walk it through the earlier phases to just over the gate's threshold, then cross it
    const cross = () => { boss.hp = boss.maxHp * (at + 0.02 + (g.difficulty?.bossEnrage ?? 0)); window.__sim(0.5, 1 / 30, keep); g.actors.damage(boss, { dmg: boss.maxHp * 0.05, src: p.id }); };
    if (boss.type === 'courtArchmage') { boss.hp = boss.maxHp * 0.62; window.__sim(3, 1 / 30, keep); for (const a of g.actors.list) if (!a.boss && a.faction === 'enemy') { a.hp = 0; g.actors.kill(a, 0, 'holy'); } }
    cross();
    let t = 0;
    for (; t < 6 && !B.gate; t += 0.1) window.__sim(0.1, 1 / 30, keep);
    if (!B.gate) { log.push(`FAIL F${f} ${boss.type}: no gate (phase ${B.phase}, hp ${(boss.hp / boss.maxHp).toFixed(2)})`); boss.hp = 0; g.actors.kill(boss, 0, 'physical'); window.__sim(1); continue; }
    const kind = B.gate.kind;
    B.invuln = 0;
    const hp0 = boss.hp;
    // a blow from in front: turned away
    const fx = Math.sin(boss.yaw), fz = Math.cos(boss.yaw);
    p.pos.set(boss.pos.x + fx * 5, boss.pos.y, boss.pos.z + fz * 5);
    g.actors.damage(boss, { dmg: boss.maxHp * 0.02, src: p.id, kbDir: [-fx, -fz] });
    const blocked = boss.hp === hp0;
    const uiOn = !document.querySelector('.boss-bar .bgate')?.classList.contains('hidden');
    const uiText = document.querySelector('.boss-bar .bgate')?.textContent;
    // what the gate asks
    const t0 = g.time;
    for (let i = 0; i < 400 && B.gate; i++) {
      if (kind === 'brood') { for (const id of B.gate.ids) { const m = g.actors.byId.get(id); if (m && !m.dead) { m.hp = 0; g.actors.kill(m, 0, 'holy'); break; } } }
      if (kind === 'stone') { const bx = Math.sin(boss.yaw), bz = Math.cos(boss.yaw); p.pos.set(boss.pos.x - bx * 4, boss.pos.y, boss.pos.z - bz * 4); B.invuln = 0; g.actors.damage(boss, { dmg: boss.maxHp * 0.008, src: p.id, kbDir: [bx, bz] }); }
      if (kind === 'ward') { const q = B.gate.gl.find((q) => !q.lit); if (q) p.pos.set(q.x, g.groundY(q.x, q.z), q.z); }
      if (kind === 'judgment' && i % 12 === 6) g.events.emit('perfectDodge');
      window.__sim(0.1, 1 / 30, keep);
    }
    const broke = !B.gate, took = (g.time - t0).toFixed(1), exposed = B.exposed > 0;
    const uiOff = document.querySelector('.boss-bar .bgate')?.classList.contains('hidden');
    // raised again and left alone: it runs out
    B.openGate(kind, 1.5, kind === 'brood' ? { ids: [], left: 1 } : kind === 'ward' ? { gl: [{ x: 0, z: 0, p: 0, lit: false }] } : kind === 'stone' ? { dealt: 0, need: 1e9, n: 100 } : { need: 99 });
    if (kind === 'brood') B.gate.ids = [-1]; // (none alive: it would break at once; a dead id keeps it held only for the timeout check below)
    window.__sim(2, 1 / 30, keep);
    const ranOut = !B.gate;
    const ok = blocked && broke && exposed && uiOn && uiOff && ranOut;
    log.push(`${ok ? 'ok  ' : 'FAIL'} F${f} ${boss.type} [${kind}] blocked=${blocked} ui="${uiText}" broke=${broke} in ${took}s exposed=${exposed} uiCleared=${uiOff} ranOut=${ranOut}`);
    boss.hp = 0; g.actors.kill(boss, 0, 'physical');
    window.__sim(1);
  }
  return { log, errs };
})();
