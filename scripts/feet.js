// Standing and walking floor audit (run with smoke.mjs "?autostart=pyromancer&test=1&god=1&seed=4&floor=2[&types=a,b]" out.png 60000 scripts/feet.js).
// Spawns each enemy type, samples its skinned vertices while it idles and while it chases the wizard, and reports the
// lowest point against the floor in cm with the bone that carries it. A footed body should read about -4..+3 cm
// (feet planted; see the grounding in models/core.js); floaters and fliers read their hover height.
(async () => {
  while (!window.__game || window.__game.menuMode || !window.__game.player || window.__game.loadingFloor) await new Promise((r) => setTimeout(r, 200));
  await new Promise((r) => setTimeout(r, 400));
  const g = window.__game, T3 = window.__THREE, p = g.player; g.godMode = true;
  const { ENEMY_DEFS } = await import('/src/game/enemyDefs.js');
  for (const r of g.level.rooms) r.cleared = true;
  for (const a of [...g.actors.list]) { a.hp = 0; g.actors.kill(a, 0, 'holy'); }
  const room = g.level.rooms.filter((r) => r.type === 'combat').sort((a, b) => b.w * b.h - a.w * a.h)[0];
  const v = new T3.Vector3(), out = []; let lowBone = '';
  const qt = new URLSearchParams(location.search).get('types');
  const types = qt ? qt.split(',') : Object.keys(ENEMY_DEFS).filter((t) => !ENEMY_DEFS[t].hoarder && !ENEMY_DEFS[t].fly && ENEMY_DEFS[t].ai !== 'float');
  // the lowest point of the body this frame, relative to the floor under it
  const lowest = (a) => {
    a.model.root.updateMatrixWorld(true);
    let lo = Infinity;
    a.model.root.traverse((o) => {
      if (!o.isSkinnedMesh || !o.visible) return;
      const cnt = o.geometry.attributes.position.count, si = o.geometry.attributes.skinIndex, sw = o.geometry.attributes.skinWeight;
      for (let i = 0; i < cnt; i += 3) { o.getVertexPosition(i, v); v.applyMatrix4(o.matrixWorld); if (v.y < lo) { lo = v.y; let b = 0, w = -1; for (let k = 0; k < 4; k++) if (sw.getComponent(i, k) > w) { w = sw.getComponent(i, k); b = si.getComponent(i, k); } lowBone = o.skeleton.bones[b]?.name; } }
    });
    return lo - g.groundY(a.pos.x, a.pos.z);
  };
  for (const type of types) {
    // idle: dormant, standing
    p.pos.set(room.cx + 40, g.groundY(room.cx + 40, room.cz), room.cz);
    const a = g.actors.spawn(type, room.cx, room.cz, { hp: 1e6, dormant: true });
    window.__sim(1.5, 1 / 30);
    if (!a.model) { out.push(type + ' no model'); continue; }
    let idleBone = '', walkBone = '', idleMin = Infinity, idleMax = -Infinity;
    for (let i = 0; i < 12; i++) { window.__sim(0.1, 1 / 30); const l = lowest(a); if (l < idleMin) idleBone = lowBone; idleMin = Math.min(idleMin, l); idleMax = Math.max(idleMax, l); }
    // walking: wake it and let it chase the wizard across the room
    p.pos.set(room.cx + 9, g.groundY(room.cx + 9, room.cz), room.cz);
    a.dormant = false; g.actors.wake?.(a);
    window.__sim(0.6, 1 / 30);
    let walkMin = Infinity, walkMax = -Infinity, moving = 0;
    for (let i = 0; i < 16; i++) { window.__sim(0.06, 1 / 30); if (a.anim === 'move') { moving++; const l = lowest(a); if (l < walkMin) walkBone = lowBone; walkMin = Math.min(walkMin, l); walkMax = Math.max(walkMax, l); } p.pos.x = a.pos.x + 9; }
    const f = (x) => (Number.isFinite(x) ? (x * 100).toFixed(0) : '-');
    out.push(`${type}: idle ${f(idleMin)}..${f(idleMax)} cm, walk ${f(walkMin)}..${f(walkMax)} cm (${moving} moving) [${idleBone} / ${walkBone}] anim=${a.anim} state=${a.state}`);
    a.dead = true; a.hp = 0; g.actors.kill(a, 0, 'holy'); g.actors.remove?.(a); window.__sim(0.05, 1 / 30);
  }
  return out.join('\n');
})();
