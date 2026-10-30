// CPU stress harness for big fights (run with scripts/smoke.mjs, e.g.
//   node scripts/smoke.mjs "?autostart=pyromancer&test=1&god=1&norender=1&floor=2&seed=4242&n=50" out.png 3000 scripts/stress.js
// A full party's worth of spells into a crowded room: the local player plus
// three replayed teammates (stormcaller, necromancer, cryomancer) cast every
// slot on cooldown at ~n enemies kept alive (beefed up so they last), with
// burning ground, poison pools and kegs. Math.random is seeded so runs repeat.
// Times each system inside __sim (no rendering) and reports per-frame ms
// (median of `reps` runs), frame-time percentiles, particles drawn vs alive and
// the heap growth per simulated second (noisy: GC runs whenever it likes).
// &reps=N (default 3), &sec=S simulated seconds per run (default 8), &fine=1 also
// times per-actor calls (AI, LOS, collision; adds overhead). &render=1 (without
// norender) also draws every simulated frame and times the renderer's CPU side
// ('render', with draw calls and triangles per frame).
(async () => {
  while (!window.__game || !window.__game.player || window.__game.loadingFloor) await new Promise((r) => setTimeout(r, 200));
  await new Promise((r) => setTimeout(r, 1000));
  const Q = new URLSearchParams(location.search);
  const N = +(Q.get('n') ?? 50), REPS = +(Q.get('reps') ?? 3), SEC = +(Q.get('sec') ?? 8);
  let seed = 12345;
  Math.random = () => { seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const g = window.__game, inp = window.__input, p = g.player, THREE = window.__THREE;
  g.godMode = true;
  const T = 2;
  const room = g.level.rooms.filter((r) => r.type === 'combat').sort((a, b) => b.w * b.h - a.w * a.h)[0];
  p.pos.set(room.cx, g.groundY(room.cx, room.cz), room.cz);
  const spot = () => {
    for (let k = 0; k < 40; k++) {
      const x = room.cx + (Math.random() - 0.5) * room.w * T * 0.8, z = room.cz + (Math.random() - 0.5) * room.h * T * 0.8;
      if (g.level.roomAt(x, z) === room && !g.collision.cellBlocked(Math.floor(x / T), Math.floor(z / T), 0.5) && Math.hypot(x - p.pos.x, z - p.pos.z) > 4) return { x, z };
    }
    return { x: room.cx + 3, z: room.cz + 3 };
  };
  // teammates (visual replays: their spells fly, collide and burst, the caster's own machine would deal the damage)
  const mates = ['stormcaller', 'necromancer', 'cryomancer'].map((c, i) => {
    g.addRemote({ id: 'bot' + i, name: 'Bot' + i, classId: c });
    const r = g.remotes.get('bot' + i);
    const ang = i * 2.1;
    r.net.x = r.pos.x = p.pos.x + Math.cos(ang) * 2.5; r.net.z = r.pos.z = p.pos.z + Math.sin(ang) * 2.5;
    r.net.y = r.pos.y = g.groundY(r.pos.x, r.pos.z);
    return r;
  });
  const roster = [...new Set(g.biome.enemies)];
  const fill = () => {
    let alive = 0;
    for (const a of g.actors.list) if (a.faction === 'enemy' && !a.dead) alive++;
    for (; alive < N; alive++) {
      const s = spot();
      const a = g.director.spawnEnemy(roster[alive % roster.length], s.x, s.z, { noCredit: true });
      a.maxHp = a.hp = a.maxHp * 12;
    }
  };
  const nearest = (from) => { let best = null, bd = 1e9; for (const a of g.actors.hostiles()) { const d = (a.pos.x - from.x) ** 2 + (a.pos.z - from.z) ** 2; if (d < bd) { bd = d; best = a; } } return best; };
  const SL = ['primary', 'secondary', 'ability1', 'ability2', 'ultimate'];
  let frame = 0;
  // particle instances drawn per frame (all of each ring, or just its live window) and alive
  const layers = ['add', 'addLong', 'alpha'].filter((k) => g.particles[k]);
  const pc = {};
  const sampleParticles = () => {
    for (const k of layers) {
      const L = g.particles[k], A = L.a.iTime.array, t = g.time;
      let n = 0;
      for (let i = 0; i < L.capacity; i++) { const a = t - A[i * 4]; if (a >= 0 && a <= A[i * 4 + 1]) n++; }
      const e = (pc[k] ??= { drawn: 0, live: 0, n: 0 });
      e.drawn += L.geo?.instanceCount ?? L.capacity; e.live += n; e.n++;
    }
  };
  const RENDER = Q.has('render');
  let calls = 0, tris = 0, rendered = 0;
  const drive = () => {
    frame++;
    if (RENDER) { g.renderer.render(g.time); const st = g.renderer.lastStats; calls += st.calls; tris += st.tris; rendered++; }
    if (frame % 30 === 0) sampleParticles();
    if (frame % 15 === 0) fill();
    const t = nearest(p.pos);
    if (t) {
      const dx = t.pos.x - p.pos.x, dz = t.pos.z - p.pos.z, dy = t.pos.y + t.height * 0.5 - (p.pos.y + 1.6);
      p.yaw = Math.atan2(-dx, -dz); p.pitch = Math.atan2(dy, Math.hypot(dx, dz));
    }
    inp.mouse.left = !!t;
    for (const k in p.cds) if (k !== 'primary') { p.cds[k] = 0; p.chargesLeft[k] = Math.max(1, p.chargesLeft[k]); }
    if (frame % 40 === 10) inp.pressed.add('KeyQ');
    if (frame % 40 === 30) inp.pressed.add('KeyE');
    if (frame % 90 === 5) { inp.mouse.rightPressed = true; inp.mouse.right = true; }
    if (frame % 90 === 60) inp.mouse.right = false;
    if (frame % 240 === 100) { p.ult = 100; inp.pressed.add('KeyR'); }
    mates.forEach((r, i) => {
      const tt = nearest(r.pos);
      if (!tt) return;
      const ap = new THREE.Vector3(tt.pos.x, tt.pos.y + tt.height * 0.5, tt.pos.z);
      r.net.yaw = Math.atan2(-(ap.x - r.pos.x), -(ap.z - r.pos.z));
      if ((frame + i * 7) % 12 === 0) {
        const n = Math.floor((frame + i * 7) / 12);
        const slot = n % 25 === 24 ? 'ultimate' : n % 5 === 0 ? SL[1 + (n / 5) % 3] : 'primary';
        const sp = r.cls.spells[slot];
        const o = r.muzzleWorld();
        const d = ap.clone().sub(o).normalize();
        if (sp.mode === 'channel') { r.replayCast({ slot, o: o.toArray(), d: d.toArray(), ap: ap.toArray(), chan: 1 }); r._chanEnd = frame + 40; }
        else r.replayCast({ slot, o: o.toArray(), d: d.toArray(), ap: ap.toArray() });
      }
      if (r._chanEnd === frame && r.channel) r.replayCast({ slot: r.channel.ctx.slot, chan: 0 });
    });
    // burning ground, poison pools and a keg now and then
    if (frame % 60 === 20) { const s = spot(); g.spawnPoolLocal(new THREE.Vector3(s.x, g.groundY(s.x, s.z), s.z), 2.5, 4, 0, frame % 120 === 20 ? 'enemyGreen' : 'enemyFire'); }
    if (frame % 150 === 75) { const k = g.level.breakables.find((b) => b.alive && b.type === 'keg'); if (k) g.breakProp(k.i, true); }
  };
  // time every system (wrapped methods accumulate into acc)
  const acc = {};
  const time = (obj, name, label) => {
    if (!obj || !obj[name]) return;
    const f = obj[name].bind(obj);
    obj[name] = (...a) => { const t0 = performance.now(); try { return f(...a); } finally { acc[label] = (acc[label] ?? 0) + performance.now() - t0; } };
  };
  time(g, 'update', 'total');
  // HUD glyphs rendered (each a measureText + stroke/fill into the atlas)
  { const mt = CanvasRenderingContext2D.prototype.measureText; CanvasRenderingContext2D.prototype.measureText = function (t) { acc.glyphRenders = (acc.glyphRenders ?? 0) + 1; return mt.call(this, t); }; }
  // per-frame totals too, for the spikes (GC, spawn and death bursts) behind a mean
  const frameTimes = [];
  { const f = g.update; g.update = (...a) => { const t0 = performance.now(); try { return f(...a); } finally { frameTimes.push(performance.now() - t0); } }; }
  time(p, 'update', 'player');
  time(g, '_interactions', 'interact');
  time(g.director, 'update', 'director');
  time(g.actors, 'update', 'actors');
  // per-actor calls are timed only with &fine=1: hundreds of wrapped calls a frame skew the totals
  if (Q.has('fine')) {
    time(g.actors, '_hostUpdate', 'actors.ai');
    time(g.actors, '_statusFx', 'actors.statusFx');
    time(g.actors.pathing, 'field', 'pathing');
    time(g.collision, 'los', 'los');
    const los0 = g.collision.los; g.collision.los = (...a) => { acc.losCalls = (acc.losCalls ?? 0) + 1; return los0(...a); };
    time(g.collision, 'move', 'collide');
  }
  time(g.spells, 'update', 'spells');
  time(g, '_updateHazards', 'hazards');
  time(g, '_updatePools', 'pools');
  time(g, '_updateDrops', 'drops');
  time(g.vfx, 'update', 'vfx');
  time(g.particles, 'update', 'particles');
  time(g.lights, 'update', 'lights');
  time(g.built, 'update', 'built');
  time(g.critters, 'update', 'critters');
  time(g.ui, 'update', 'ui');
  time(g, '_viewModel', 'viewmodel');
  if (Q.has('render')) time(g.renderer, 'render', 'render');
  for (const r of mates) time(r, 'update', 'remotes');
  // warm up: fill the room and let the fight get going
  fill();
  window.__sim(3, 1 / 60, drive);
  frameTimes.length = 0;
  const runs = [];
  const heap = () => performance.memory?.usedJSHeapSize ?? 0;
  // scripts/profile.mjs keeps just this window (the marker starts its
  // allocation sampling; the pause lets that command land before the sim)
  console.log('[stress] measuring');
  await new Promise((r) => setTimeout(r, 1500));
  console.profile('stress');
  for (let rep = 0; rep < REPS; rep++) {
    for (const k in acc) acc[k] = 0;
    const h0 = heap(), w0 = performance.now(), f0 = frame;
    window.__sim(SEC, 1 / 60, drive);
    const frames = frame - f0, wall = performance.now() - w0;
    const r = { wallMsPerFrame: wall / frames };
    const ft = frameTimes.splice(0).sort((a, b) => a - b);
    r.p95 = ft[Math.floor(ft.length * 0.95)]; r.p99 = ft[Math.floor(ft.length * 0.99)]; r.max = ft[ft.length - 1];
    for (const k in acc) r[k] = acc[k] / frames;
    r.heapKBPerSec = (heap() - h0) / 1024 / SEC;
    runs.push(r);
  }
  console.profileEnd('stress');
  console.log('[stress] done');
  await new Promise((r) => setTimeout(r, 1500));
  const med = {};
  for (const k of Object.keys(runs[0])) { const v = runs.map((r) => r[k]).sort((a, b) => a - b); med[k] = +v[Math.floor(v.length / 2)].toFixed(3); }
  return {
    n: N, alive: g.actors.list.filter((a) => !a.dead).length, actors: g.actors.list.length, proj: g.spells.projectiles.length, zones: g.spells.zones.length,
    hudGlyphs: { cached: g.ui?._tb?.size, pages: g.ui?._atlas?.pages.length, numbers: g.ui?.numbers?.length },
    particles: Object.fromEntries(layers.map((k) => [k, { drawn: Math.round(pc[k].drawn / pc[k].n), live: Math.round(pc[k].live / pc[k].n) }])),
    median: med, runs: runs.map((r) => +r.total.toFixed(2)),
    ...(RENDER ? { drawCalls: Math.round(calls / rendered), tris: Math.round(tris / rendered) } : {}),
  };
})()
