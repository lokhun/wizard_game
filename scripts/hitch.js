// Frame-time profiler for hitches (run with scripts/smoke.mjs, e.g.
//   node scripts/smoke.mjs "?autostart=pyromancer&test=1&quality=med&floor=0&seed=4242" out.png 3000 scripts/hitch.js
// Real-time frames (no __sim): walks into the first combat room to start a
// fight, then casts every ability. Reports the worst frames with a per-system
// breakdown and how many shader programs were compiled during each.
(async () => {
  while (!window.__game || !window.__game.player) await new Promise((r) => setTimeout(r, 200));
  await new Promise((r) => setTimeout(r, 2500));
  const g = window.__game, inp = window.__input, p = g.player;
  g.godMode = true;
  const R = g.renderer.renderer;
  // raw GPU work per frame: texture uploads, buffer uploads, shader compiles
  const gl = R.getContext();
  const wrapGL = (name, label, size) => {
    const f = gl[name].bind(gl);
    gl[name] = (...a) => { const t0 = performance.now(); try { return f(...a); } finally { if (cur) { cur[label + 'Ms'] = (cur[label + 'Ms'] ?? 0) + performance.now() - t0; cur[label + 'N'] = (cur[label + 'N'] ?? 0) + 1; if (size) cur[label + 'KB'] = (cur[label + 'KB'] ?? 0) + size(a) / 1024; } } };
  };
  const texBytes = (a) => { const v = a[a.length - 1]; if (v && v.byteLength) return v.byteLength; if (v && v.width) return v.width * v.height * 4; return (a[3] ?? 0) * (a[4] ?? 0) * 4; };
  wrapGL('texImage2D', 'tex', texBytes);
  wrapGL('texSubImage2D', 'texSub', texBytes);
  wrapGL('texImage3D', 'tex3', texBytes);
  wrapGL('bufferData', 'buf', (a) => a[1]?.byteLength ?? 0);
  wrapGL('linkProgram', 'link');
  wrapGL('getProgramParameter', 'progQ');
  const frames = [];
  const newProgs = [];
  let cur = null;
  const time = (obj, name, label) => {
    const f = obj[name].bind(obj);
    obj[name] = (...a) => { const t0 = performance.now(); try { return f(...a); } finally { if (cur) cur[label] = (cur[label] ?? 0) + performance.now() - t0; } };
  };
  // headless runs never get the click that starts audio: start it so its cost shows
  g.audio?.init();
  if (g.audio) { time(g.audio, 'play', 'audio'); time(g.audio, 'loop', 'audio'); time(g.audio, 'setMusic', 'audio'); time(g.audio, '_pump', 'audioPump'); }
  time(g, 'update', 'update');
  time(g.renderer, 'render', 'render');
  time(g.actors, 'update', 'actors');
  time(g.actors, 'spawn', 'spawn');
  time(g.director, 'update', 'director');
  time(g.spells, 'update', 'spells');
  time(g.vfx, 'update', 'vfx');
  time(g.particles, 'update', 'particles');
  time(g.lights, 'update', 'lights');
  if (g.ui?.update) time(g.ui, 'update', 'ui');
  let last = performance.now();
  let tag = 'idle';
  const tick = () => {
    const now = performance.now();
    if (cur) {
      cur.dt = now - last; cur.progs = R.info.programs.length; cur.tex = R.info.memory.textures; cur.geo = R.info.memory.geometries; frames.push(cur);
      if (cur.progs > cur.progs0) for (const pr of R.info.programs.slice(cur.progs0 - cur.progs)) newProgs.push(cur.tag + ': ' + pr.name + ' ' + String(pr.cacheKey).slice(0, 160));
    }
    last = now;
    cur = { tag, progs0: R.info.programs.length, tex0: R.info.memory.textures, geo0: R.info.memory.geometries };
    if (running) requestAnimationFrame(tick);
  };
  let running = true;
  requestAnimationFrame(tick);
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  await wait(4000);
  // walk into a combat room
  // ?room=boss walks into the boss arena instead (intro, phases, adds)
  const want = new URLSearchParams(location.search).get('room') ?? 'combat';
  const room = g.level.rooms.find((r) => r.type === want && r.main) ?? g.level.rooms.find((r) => r.type === want);
  tag = 'enter';
  p.pos.set(room.cx, g.groundY(room.cx, room.cz), room.cz);
  await wait(7000);
  // cast everything
  const aim = () => { let best = null, bd = 1e9; for (const a of g.actors.hostiles()) { const d = a.pos.distanceTo(p.pos); if (d < bd) { bd = d; best = a; } } if (best) { const dx = best.pos.x - p.pos.x, dz = best.pos.z - p.pos.z; p.yaw = Math.atan2(-dx, -dz); p.pitch = -0.1; } };
  for (const [k, lbl] of [['KeyQ', 'Q'], ['KeyE', 'E'], ['KeyR', 'R']]) {
    aim(); tag = 'cast' + lbl; if (k === 'KeyR') p.ult = 100; inp.pressed.add(k);
    await wait(2500);
  }
  tag = 'rmb'; aim(); inp.mouse.rightPressed = true; inp.mouse.right = true; await wait(2000); inp.mouse.right = false;
  tag = 'lmb'; inp.mouse.left = true; await wait(2500); inp.mouse.left = false;
  running = false;
  await wait(100);
  const sum = (k) => frames.reduce((s, f) => s + (f[k] ?? 0), 0);
  const med = [...frames].map((f) => f.dt).sort((a, b) => a - b)[Math.floor(frames.length / 2)];
  const worst = [...frames].sort((a, b) => b.dt - a.dt).slice(0, 14).map((f) => {
    const o = { tag: f.tag, dt: Math.round(f.dt), newProgs: f.progs - f.progs0, newTex: f.tex - f.tex0, newGeo: f.geo - f.geo0 };
    for (const k of ['update', 'render', 'actors', 'spawn', 'director', 'spells', 'vfx', 'particles', 'lights', 'ui', 'texMs', 'texKB', 'texN', 'texSubMs', 'texSubKB', 'bufMs', 'bufKB', 'bufN', 'linkMs', 'linkN', 'progQMs', 'audio', 'audioPump']) if (f[k] > 1) o[k] = Math.round(f[k]);
    return o;
  });
  const byTag = {};
  for (const f of frames) { const b = (byTag[f.tag] ??= { n: 0, max: 0, progs: 0, tex: 0, geo: 0 }); b.n++; b.max = Math.max(b.max, Math.round(f.dt)); b.progs += f.progs - f.progs0; b.tex += Math.max(0, f.tex - f.tex0); b.geo += Math.max(0, f.geo - f.geo0); }
  return { newProgs, frames: frames.length, medianMs: Math.round(med), programs: R.info.programs.length, byTag, worst, calls: R.info.render.calls };
})()
