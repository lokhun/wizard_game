// Death-pose floor audit (run with smoke.mjs "?autostart=pyromancer&test=1&god=1&seed=4&floor=2[&types=a,b]" out.png 60000 scripts/sink.js).
// Kills each enemy type, lets its death pose settle, then samples its skinned vertices in world space: 'below' is the
// share more than 6 cm under the floor (a little is fine: robes, plates resting), 'deep' more than 25 cm (a body
// visibly sunk). A fall style or a per-model deathLift (models/humanoid.js) brings a bulky one back up.
(async () => {
  while (!window.__game || window.__game.menuMode || !window.__game.player || window.__game.loadingFloor) await new Promise((r) => setTimeout(r, 200));
  await new Promise((r) => setTimeout(r, 400));
  const g = window.__game, T3 = window.__THREE; g.godMode = true;
  const { ENEMY_DEFS, BOSS_DEFS } = await import('/src/game/enemyDefs.js');
  for (const r of g.level.rooms) r.cleared = true;
  const room = g.level.rooms.filter((r) => r.type === 'combat').sort((a, b) => b.w * b.h - a.w * a.h)[0];
  const v = new T3.Vector3(), out = [];
  const qt = new URLSearchParams(location.search).get('types');
  const types = qt ? qt.split(',') : [...Object.keys(ENEMY_DEFS), ...Object.keys(BOSS_DEFS)].filter((t) => !ENEMY_DEFS[t]?.hoarder);
  for (const type of types) {
    let a;
    try { a = g.actors.spawn(type, room.cx, room.cz, { hp: 10, dormant: true }); } catch (e) { out.push(type + ' ERR'); continue; }
    window.__sim(1.0, 1 / 30);
    const gy = g.groundY(a.pos.x, a.pos.z);
    g.actors.damage(a, { dmg: 1e6, el: 'physical', src: 'x' });
    // into the settled death pose, before the corpse starts to sink away
    for (let i = 0; i < 40 && a.model; i++) window.__sim(1 / 30, 1 / 30);
    if (!a.model) { out.push(type + ' (no model)'); continue; }
    a.model.root.updateMatrixWorld(true);
    let n = 0, below = 0, deep = 0;
    a.model.root.traverse((o) => {
      if (!o.isSkinnedMesh || !o.visible || o.material?.transparent) return;
      const cnt = o.geometry.attributes.position.count;
      for (let i = 0; i < cnt; i += 5) {
        o.getVertexPosition(i, v); v.applyMatrix4(o.matrixWorld);
        n++; if (v.y < gy - 0.06) below++; if (v.y < gy - 0.25) deep++;
      }
    });
    out.push([type, 'below', n ? Math.round(100 * below / n) : -1, 'deep', n ? Math.round(100 * deep / n) : -1, 'anim', a.anim].join(' '));
    g.actors.remove?.(a); window.__sim(0.05, 1 / 30);
  }
  return out.join('\n');
})();
