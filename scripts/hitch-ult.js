// Real-time hitch check of a class's big spells (run with scripts/hitch-edge.mjs, e.g.
//   node scripts/hitch-edge.mjs "http://localhost:4173/?test=1&autostart=stormcaller&floor=0&seed=4242&n=30" scripts/hitch-ult.js --trace=t.json
// In the first combat room: the ultimate solo (a handful of foes), then the same in a crowd
// of ~n enemies (beefed up so they last), then every other slot once in the crowd. Each
// phase is a tag (ult:solo1, ult:solo2, ult:crowd1, ...), so hitch-edge reports frame times,
// program links and GPU-process compiles per phase.
(async () => {
  const Q = new URLSearchParams(location.search);
  const N = +(Q.get('n') ?? 30);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const tag = (t) => { window.__tag = t; };
  while (!window.__game?.player || window.__game.loadingFloor || window.__game.menuMode) await sleep(100);
  const g = window.__game, p = g.player, inp = window.__input, T = 2;
  g.godMode = true;
  // &gpusync=1: finish the GPU's work at the end of every render, so the render's own time
  // includes the GPU's (pipelining is lost; compare phases with each other, not with fps)
  const gpuMs = {};
  if (Q.get('gpusync')) {
    const R = g.renderer, gl = R.renderer.getContext(), px = new Uint8Array(4), render = R.render.bind(R);
    R.render = (t) => {
      const t0 = performance.now();
      render(t);
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
      (gpuMs[window.__tag] ??= []).push(performance.now() - t0);
    };
  }
  // &black=1: read five canvas pixels after every render and count the frames where all are
  // black (a NaN in some effect's shader blanks the whole frame through bloom)
  const black = {};
  if (Q.get('black')) {
    const R = g.renderer, gl = R.renderer.getContext(), px = new Uint8Array(4), render = R.render.bind(R);
    R.render = (t) => {
      render(t);
      const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight;
      let lit = 0;
      for (const [x, y] of [[0.5, 0.5], [0.25, 0.3], [0.75, 0.3], [0.25, 0.7], [0.75, 0.7]]) { gl.readPixels(Math.floor(w * x), Math.floor(h * y), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); lit += px[0] + px[1] + px[2]; }
      const b = (black[window.__tag] ??= { frames: 0, black: 0 });
      b.frames++; if (lit < 3) b.black++;
    };
  }
  tag('settle'); await sleep(2500);
  const room = g.level.rooms.filter((r) => r.main && r.type === 'combat').sort((a, b) => a.order - b.order)[0];
  p.pos.set(room.cx, g.groundY(room.cx, room.cz), room.cz);
  const hostiles = () => g.actors.hostiles().filter((a) => !a.dead);
  const aim = () => {
    let best = null, bd = 1e9;
    for (const a of hostiles()) { const d = a.pos.distanceTo(p.pos); if (d < bd) { bd = d; best = a; } }
    if (!best) return;
    const dx = best.pos.x - p.pos.x, dz = best.pos.z - p.pos.z, dy = best.pos.y + (best.height ?? 1.6) * 0.5 - (p.pos.y + 1.6);
    p.yaw = Math.atan2(-dx, -dz); p.pitch = Math.atan2(dy, Math.hypot(dx, dz));
  };
  const hold = async (ms) => { const t0 = performance.now(); while (performance.now() - t0 < ms) { aim(); p.hp = p.maxHp; await sleep(50); } };
  const spot = () => {
    for (let k = 0; k < 40; k++) {
      const x = room.cx + (Math.random() - 0.5) * room.w * T * 0.8, z = room.cz + (Math.random() - 0.5) * room.h * T * 0.8;
      if (g.level.roomAt(x, z) === room && !g.collision.cellBlocked(Math.floor(x / T), Math.floor(z / T), 0.5) && Math.hypot(x - p.pos.x, z - p.pos.z) > 5) return { x, z };
    }
    return { x: room.cx + 4, z: room.cz + 4 };
  };
  const fill = (n) => {
    let alive = hostiles().length;
    const roster = [...new Set(g.biome.enemies)];
    for (; alive < n; alive++) { const s = spot(); const a = g.director.spawnEnemy(roster[alive % roster.length], s.x, s.z, { noCredit: true }); a.maxHp = a.hp = a.maxHp * 20; }
  };
  const cd = () => { for (const k in p.cds ?? {}) p.cds[k] = 0; };
  const ult = async (name) => { cd(); p.ult = 100; aim(); tag(name); inp.pressed.add('KeyR'); await hold(9000); };
  // a few foes: the room's own first wave
  tag('enter'); await hold(4000);
  fill(4);
  tag('pre'); await hold(1500);
  await ult('ult:solo1');
  tag('gap'); await hold(1000);
  if (!Q.get('quick')) await ult('ult:solo2');
  // the crowd
  tag('fill'); fill(N); await hold(4000);
  await ult('ult:crowd1');
  tag('gap'); fill(N); await hold(1000);
  if (!Q.get('quick')) await ult('ult:crowd2');
  for (const [k, slot] of [['Mouse0', 'lmb'], ['Mouse2', 'rmb'], ['KeyQ', 'Q'], ['KeyE', 'E']]) {
    fill(N); cd(); tag('crowd:' + slot);
    if (k === 'Mouse0') { inp.mouse.left = true; await hold(2500); inp.mouse.left = false; } else if (k === 'Mouse2') { inp.mouse.rightPressed = true; inp.mouse.right = true; await hold(2500); inp.mouse.right = false; } else { inp.pressed.add(k); await hold(2500); }
  }
  tag('end'); await sleep(300);
  const pc = (v, q) => { const s = [...v].sort((a, b) => a - b); return +s[Math.min(s.length - 1, Math.floor(s.length * q))].toFixed(1); };
  const renderMs = Object.fromEntries(Object.entries(gpuMs).map(([k, v]) => [k, { med: pc(v, 0.5), p95: pc(v, 0.95), max: pc(v, 1) }]));
  const blackFrames = Object.fromEntries(Object.entries(black).filter(([, v]) => v.black));
  return { blackFrames, renderMs, programs: g.renderer.renderer.info.programs.length, prewarm: g._prewarmPrograms, alive: hostiles().length, ultSpell: p.cls?.spells?.ultimate?.name };
})()
