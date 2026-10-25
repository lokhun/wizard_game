// Death-grip search (run in the model viewer: URL=http://localhost:5190/tools/models.html node scripts/smoke.mjs
// "?type=skeleton&anim=idle&clean=1&types=royalGuard,knightCaptain[&hand=R]" out.png 5000 scripts/grip.js).
// A corpse still gripping a long weapon held it as in life: a halberd standing 1.3 m out of the body, or the
// same length driven into the floor. For each type and each side the body can twist to as it falls, this
// settles the death pose under a grid of forearm/hand turns and keeps the one that lays everything the hand
// carries flattest on the floor (every point between the floor and 35 cm). Paste the result into the type's
// anim as deathGrip: [side0, side1] (models/humanoid.js applies it). bone=foreL scores what the forearm carries (a
// strapped shield, a chained cage) and turns the upper arm and forearm instead.
(async () => {
  while (!window.__ready) await new Promise((r) => setTimeout(r, 100));
  const q = new URLSearchParams(location.search);
  const { createEnemyModel } = await import('/src/game/enemyModels.js');
  const S = q.get('hand') ?? 'R', fore = (q.get('bone') ?? '').startsWith('fore'), out = [];
  for (const type of (q.get('types') ?? 'royalGuard').split(',')) {
    const res = [];
    for (const seed of [0.2, 0.8]) {
      const m = createEnemyModel(type, { factory: window.__factory });
      m.seed = seed;
      const A = m.spec.anim, V = m.root.position.constructor, v = new V();
      // the vertices the hand carries (the weapon with it)
      const pts = [];
      m.root.traverse((o) => {
        if (!o.isSkinnedMesh || o.userData.shadowProxy) return;
        const bi = o.skeleton.bones.indexOf(m.bones[(fore ? 'fore' : 'hand') + S]);
        if (bi < 0) return;
        const g = o.geometry, si = g.attributes.skinIndex, sw = g.attributes.skinWeight;
        for (let i = 0; i < g.attributes.position.count; i += 2) { let w = 0; for (let k = 0; k < 4; k++) if (si.getComponent(i, k) === bi) w += sw.getComponent(i, k); if (w > 0.5) pts.push([o, i]); }
      });
      const settle = (n) => { for (let i = 0; i < n; i++) m.update(1 / 30, { anim: 'death', progress: 1, t: 3 }); };
      const score = () => {
        m.root.updateMatrixWorld(true);
        let bad = 0, lo = Infinity, hi = -Infinity;
        for (const [o, i] of pts) { o.getVertexPosition(i, v); v.applyMatrix4(o.matrixWorld); lo = Math.min(lo, v.y); hi = Math.max(hi, v.y); bad = Math.max(bad, -v.y - 0.02, v.y - 0.35); }
        return [bad, lo, hi];
      };
      for (let i = 0; i < 90; i++) m.update(1 / 60, { anim: 'death', progress: Math.min(1, i / 60), t: i / 60 });
      const keep = A.deathGrip;
      A.deathGrip = null; settle(40);
      const [b0, lo0, hi0] = score();
      let best = [b0, null, lo0, hi0];
      // (outer joint turned about x, inner joint about x and z)
      const F = (fore ? 'arm' : 'fore') + S, H = (fore ? 'fore' : 'hand') + S;
      for (let fx = -1.6; fx <= 1.61; fx += 0.4) for (let hx = -1.6; hx <= 1.61; hx += 0.4) for (let hz = -1.2; hz <= 1.21; hz += 0.4) {
        const g = fore ? { [F]: [+fx.toFixed(1), 0, +hz.toFixed(1)], [H]: [+hx.toFixed(1), 0, 0] } : { [F]: [+fx.toFixed(1), 0, 0], [H]: [+hx.toFixed(1), 0, +hz.toFixed(1)] };
        A.deathGrip = [g, g]; settle(40);
        const [b, lo, hi] = score();
        if (b < best[0]) best = [b, g, lo, hi];
      }
      A.deathGrip = keep;
      res.push(`seed ${seed}: as is ${(lo0 * 100).toFixed(0)}..${(hi0 * 100).toFixed(0)} cm -> ${best[1] ? JSON.stringify(best[1]) : 'no better'} ${(best[2] * 100).toFixed(0)}..${(best[3] * 100).toFixed(0)} cm`);
      m.dispose();
    }
    out.push(type + ':\n  ' + res.join('\n  '));
  }
  return out.join('\n');
})();
