// Glare detector: plays a fight casting every slot and samples the rendered
// frame's mean brightness every 0.1 s, flagging moments the view washes out
// (stacked additive effects + bloom right at the lens). Run with smoke.mjs:
//   node scripts/smoke.mjs "?autostart=pyromancer&test=1&quality=high&floor=1&seed=77" out.png 3000 scripts/glare.js
// Reports the baseline (median), the worst samples with what was just cast,
// and how many samples went over 2.2x the baseline. ?stop=N: see below.
(async () => {
  while (!window.__game || window.__game.menuMode || !window.__game.player || window.__game.loadingFloor) await new Promise((r) => setTimeout(r, 200));
  const g = window.__game, p = g.player, inp = window.__input;
  g.godMode = true;
  window.__freeze = true;
  const R = g.renderer.renderer;
  const cv = document.createElement('canvas');
  cv.width = 64; cv.height = 36;
  const cx = cv.getContext('2d', { willReadFrequently: true });
  const lum = () => {
    g.renderer.render(performance.now() / 1000);
    cx.drawImage(R.domElement, 0, 0, 64, 36);
    const d = cx.getImageData(0, 0, 64, 30).data; // skip the HUD strip
    let s = 0;
    for (let i = 0; i < d.length; i += 4) s += d[i] * 0.3 + d[i + 1] * 0.59 + d[i + 2] * 0.11;
    return s / (d.length / 4);
  };
  const room = g.level.rooms.find((r) => r.type === 'combat' && r.main) ?? g.level.rooms.find((r) => r.type === 'combat');
  p.pos.set(room.cx, g.groundY(room.cx, room.cz), room.cz + room.h * 0.4);
  window.__sim(4);
  const aim = () => {
    let best = null, bd = 1e9;
    for (const a of g.actors.hostiles()) { const d = a.pos.distanceTo(p.pos); if (d < bd) { bd = d; best = a; } }
    if (best) { p.yaw = Math.atan2(-(best.pos.x - p.pos.x), -(best.pos.z - p.pos.z)); p.pitch = -0.08; }
  };
  const samples = [];
  let last = 'start';
  const run = (slot, key, sec) => {
    p.cds[slot] = 0; p.chargesLeft[slot] = Math.max(1, p.chargesLeft[slot] ?? 1); p.ult = 100;
    let f = 0;
    last = slot;
    for (let t = 0; t < sec; t += 0.1) {
      window.__sim(0.1, 1 / 30, () => {
        aim(); f++;
        if (f === 1 && key) inp.pressed.add(key);
        if (slot === 'secondary') { inp.mouse.right = true; if (f === 1) inp.mouse.rightPressed = true; }
        inp.mouse.left = slot === 'primary';
      });
      samples.push({ t: +g.time.toFixed(2), slot: last, l: lum() });
      if (stopAt && samples[samples.length - 1].l > stopAt) throw samples[samples.length - 1];
    }
    inp.mouse.left = inp.mouse.right = false;
  };
  // ?stop=N freezes the world on the first sample brighter than N, so the
  // closing screenshot shows that very frame
  const stopAt = +new URLSearchParams(location.search).get('stop') || 0;
  try {
    for (let round = 0; round < (+new URLSearchParams(location.search).get('rounds') || 1); round++) {
      run('primary', null, 1.2);
      run('ability1', 'KeyQ', 1.6);
      run('secondary', null, 1.6);
      run('ability2', 'KeyE', 1.6);
      run('ultimate', 'KeyR', 3);
    }
  } catch (hit) {
    if (!hit || hit.l === undefined) throw hit;
    // which glowing objects make it: hide each in turn and see how far the frame darkens
    const camP = g.renderer.camera.position, full = lum(), blame = [];
    const cands = [];
    g.scene.traverse((o) => { if ((o.isMesh || o.isSprite || o.isPoints) && o.visible && o.material && o.material.blending !== 1) cands.push(o); });
    for (const o of cands) {
      o.visible = false;
      const d = full - lum();
      o.visible = true;
      if (d < 2) continue;
      const m = o.material, wp = o.getWorldPosition(camP.clone());
      blame.push({ d: +d.toFixed(1), what: [o.name, o.type, m.type, m.name, o.geometry?.type].filter(Boolean).join('/'), uni: m.uniforms ? Object.keys(m.uniforms).join(',') : undefined, dist: +wp.distanceTo(camP).toFixed(1), scale: o.scale.toArray().map((v) => +v.toFixed(2)) });
    }
    blame.sort((a, b) => b.d - a.d);
    hit.blame = blame.slice(0, 5);
    // and what the eye is looking at: rays through a grid of screen points
    const seen = new Map();
    const cam = g.renderer.camera;
    const picks = [];
    const Ray = window.__THREE?.Raycaster;
    if (Ray) {
      const r = new Ray(), v = new window.__THREE.Vector2();
      for (let iy = 0; iy < 5; iy++) for (let ix = 0; ix < 8; ix++) {
        v.set(-0.875 + ix * 0.25, -0.8 + iy * 0.4);
        r.setFromCamera(v, cam);
        const h = r.intersectObjects(g.scene.children, true).find((x) => x.object.visible && !x.object.isPoints && x.object !== g.vfx.P.add.mesh && x.object !== g.vfx.P.alpha.mesh);
        if (!h) continue;
        const o = h.object, m = Array.isArray(o.material) ? o.material[0] : o.material;
        const key = o.uuid;
        if (seen.has(key)) { seen.get(key).n++; continue; }
        const chain = []; for (let q = o; q && chain.length < 4; q = q.parent) chain.push(q.name || q.type);
        const e = { n: 1, d: +h.distance.toFixed(1), mat: m?.type + ':' + (m?.name || ''), col: m?.color?.toArray().map((x) => +x.toFixed(2)), em: m?.emissive ? m.emissive.toArray().map((x) => +(x * (m.emissiveIntensity ?? 1)).toFixed(2)) : undefined, blend: m?.blending, chain: chain.join('<') };
        seen.set(key, e); picks.push(e);
      }
    }
    hit.picks = picks.sort((a, b) => b.n - a.n).slice(0, 8);
    // pin the offending frame over the page for the closing screenshot
    g.renderer.render(performance.now() / 1000);
    const shot = document.createElement('canvas');
    shot.width = R.domElement.width; shot.height = R.domElement.height;
    shot.getContext('2d').drawImage(R.domElement, 0, 0);
    shot.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;z-index:99999';
    document.body.appendChild(shot);
    return { stopped: hit, cls: p.classId };
  }
  window.__freeze = false;
  const ls = samples.map((s) => s.l).sort((a, b) => a - b);
  const base = ls[Math.floor(ls.length / 2)];
  const worst = [...samples].sort((a, b) => b.l - a.l).slice(0, 5).map((s) => `${s.slot}@${s.t}:${s.l.toFixed(0)}`);
  return { cls: p.classId, base: +base.toFixed(1), max: +ls[ls.length - 1].toFixed(1), over: samples.filter((s) => s.l > base * 2.2 && s.l > 45).length, n: samples.length, worst };
})()
