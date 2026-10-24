// Leak soak (run with smoke.mjs "?autostart=necromancer&test=1&god=1&seed=31" out.png 30000 scripts/soak.js; rendering on,
// so GPU resources get made): four passes through the five realms, a fight in each. Prints GPU geometries,
// textures, programs, scene objects and heap after each realm: from the second pass each column must hold
// flat (the first pass fills the per-type model caches). Heap needs --enable-precise-memory-info, else 0.
(async () => {
  while (!window.__game || window.__game.menuMode || !window.__game.player || window.__game.loadingFloor) await new Promise((r) => setTimeout(r, 200));
  const g = window.__game, R = g.renderer.renderer, p = g.player;
  g.godMode = true;
  const rows = [];
  const snap = (tag) => {
    window.gc?.();
    let objs = 0; g.scene.traverse(() => objs++);
    rows.push([tag, R.info.memory.geometries, R.info.memory.textures, R.info.programs.length, objs, Math.round((performance.memory?.usedJSHeapSize ?? 0) / 1048576), g.vfx.active?.length ?? -1, g.spells.projectiles.length, g.drops.length]);
  };
  for (let loop = 0; loop < 4; loop++) {
    for (let f = 0; f < 5; f++) {
      if (!(loop === 0 && f === 0)) { g.loadFloor(f); while (g.loadingFloor) await new Promise((r) => setTimeout(r, 100)); }
      const room = g.level.rooms.filter((r) => r.type === 'combat').sort((a, b) => b.w * b.h - a.w * a.h)[0];
      p.pos.set(room.cx - 6, g.groundY(room.cx - 6, room.cz), room.cz); p.yaw = Math.PI / 2;
      const roster = g.director.roster();
      for (let i = 0; i < 8; i++) g.director.spawnEnemy(roster[i % roster.length], room.cx + (i % 3), room.cz + (i % 4) - 2, { noCredit: true, elite: i === 3 });
      for (let i = 0; i < 160; i++) {
        let best = null, bd = 1e9; for (const a of g.actors.hostiles()) { const d = a.pos.distanceTo(p.pos); if (d < bd) { bd = d; best = a; } }
        if (best) { p.yaw = Math.atan2(-(best.pos.x - p.pos.x), -(best.pos.z - p.pos.z)); p.pitch = -0.05; }
        for (const s of ['primary', 'secondary', 'ability1', 'ability2']) { if (i % 7 === 0) { p.cds[s] = 0; p.chargesLeft[s] = Math.max(1, p.chargesLeft[s] ?? 1); try { p.tryCast(s); } catch (e) {} } }
        if (i === 60) { p.ult = 100; try { p.tryCast('ultimate'); } catch (e) {} }
        window.__sim(0.05, 1 / 30); p.hp = p.maxHp;
        if (i % 40 === 0) await new Promise((r) => requestAnimationFrame(r)); // (render now and then: GPU resources get made)
      }
      for (const a of [...g.actors.hostiles()]) { a.hp = 0; g.actors.kill(a, p.id, 'fire'); }
      window.__sim(2, 1 / 30);
      await new Promise((r) => requestAnimationFrame(r));
      snap(`L${loop} F${f}`);
    }
  }
  return 'tag geo tex progs sceneObjs heapMB vfx proj drops\n' + rows.map((r) => r.join(' ')).join('\n');
})();
