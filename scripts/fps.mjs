// Frame-rate A/B harness on the real GPU (Windows: Edge + ANGLE/D3D11; elsewhere
// set BROWSER to a Chrome/Edge binary). Uncapped rAF (--disable-gpu-vsync,
// --disable-frame-rate-limit) so headroom above the refresh rate shows.
//
//   node scripts/fps.mjs --builds base=http://localhost:4200/,new=http://localhost:4201/ \
//     --quality high,medium --floors 0,2 --scen explore,fight,heavy --reps 2 --rounds 4 --sec 3
//
// Paired windows: every build is loaded side by side in one browser, and the
// measured windows alternate between them (--rounds per scenario, --sec each,
// order rotating) while the other pages are frozen (CDP lifecycle state), so a
// shared, busy machine slows both builds alike instead of whichever ran
// second. Dynamic resolution is off (pinned at --res, default 1) so both builds
// render the same pixels. Scenarios:
//   explore  every room cleared; walk the main path room to room at running pace
//   fight    the first combat room, entered for real: the director's waves, god
//            mode, primary held on the nearest foe, abilities on cooldown
//   heavy    scripts/stress.js in real time: the largest combat room, ~n enemies
//            kept alive, three replayed teammates casting every slot
// Per scenario and build: avg fps, median of the windows' fps, 1% low (fps
// over the worst 1% of frames), p99 frame, CPU ms per frame in game.update and
// renderer.render, draw calls, triangles, and with --gpu the GPU ms per pass.
// Every window goes to --out (JSON lines); `--summary file.jsonl` re-prints a
// table from such a file.
import { chromium } from 'playwright-core';
import fs from 'fs';

const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const builds = arg('builds', 'base=http://localhost:4200/').split(',').map((s) => { const [n, u] = s.split('='); return { name: n, url: u }; });
const qualities = arg('quality', 'high').split(',');
const floors = arg('floors', '0').split(',').map(Number);
const scens = arg('scen', 'explore,fight,heavy').split(',');
const reps = +arg('reps', 2), rounds = +arg('rounds', 4), sec = +arg('sec', 3), res = +arg('res', 1), n = +arg('n', 40);
const [W, H] = arg('size', '1920x1080').split('x').map(Number);
const out = arg('out', 'test-output/fps.jsonl');
const extra = arg('query', ''); // extra URL params (diagnostic builds read them)
// --gpu passes: GPU ms per pass (EXT_disjoint_timer_query_webgl2) - scene (minus
// shadows), shadow map, viewmodel, bloom, final, SMAA. --gpu draws: also per
// draw call, grouped by what was drawn (slow; for finding the expensive things)
const gpuMode = arg('gpu', '');
// --cpuprof N: CDP CPU profile of each measured window, top N functions (self and inclusive)
const cpuprof = +arg('cpuprof', 0);
// --frozen: the world stops during each window (render cost of a fixed frame;
// with --gpu, the steadiest GPU comparison)
const frozen = process.argv.includes('--frozen');
const BROWSER = process.env.BROWSER ?? (process.platform === 'win32' ? 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' : undefined);

const init = ([quality]) => {
  try { localStorage.setItem('arcane-ascent-settings', JSON.stringify({ quality, dynamicRes: false, showFps: false, name: 'Bench', master: 0.8 })); } catch { /* ignore */ }
  window.__frames = [];
  let last = 0;
  const f = (t) => { if (last && window.__rec) window.__frames.push(t - last); last = t; requestAnimationFrame(f); };
  requestAnimationFrame(f);
};

// runs in the page: sets up one scenario's driver and plays its warm-up
const setupScenario = async ([scen, res, N, gpuMode]) => {
  const g = window.__game, p = g.player, inp = window.__input, THREE = window.__THREE, R = g.renderer;
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  let seed = 777;
  Math.random = () => { seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  g.godMode = true;
  R.setResScale(res);
  // CPU time of the two halves of a frame (wrapped once)
  if (!window.__wrapped) {
    window.__wrapped = true;
    window.__cpu = { upd: [], ren: [], calls: [], tris: [] };
    const u0 = g.update.bind(g);
    g.update = (dt) => { window.__drive?.(dt); const t0 = performance.now(); try { return u0(dt); } finally { if (window.__rec) window.__cpu.upd.push(performance.now() - t0); } };
    const r0 = R.render.bind(R);
    R.render = (t) => { const t0 = performance.now(); try { return r0(t); } finally { if (window.__rec) { const c = window.__cpu; c.ren.push(performance.now() - t0); c.calls.push(R.lastStats?.calls ?? 0); c.tris.push(R.lastStats?.tris ?? 0); } } };
  }
  if (gpuMode && !window.__gpuAcc) installGpuTimer(R, gpuMode === 'draws');
  if (window.__gpuAcc) for (const k in window.__gpuAcc) delete window.__gpuAcc[k];
  const T = 2, L = g.level, col = g.collision;
  const nearest = (from) => { let best = null, bd = 1e9; for (const a of g.actors.hostiles()) { const d = (a.pos.x - from.x) ** 2 + (a.pos.z - from.z) ** 2; if (d < bd) { bd = d; best = a; } } return best; };
  const aim = () => {
    const t = nearest(p.pos);
    if (t) { const dx = t.pos.x - p.pos.x, dz = t.pos.z - p.pos.z, dy = t.pos.y + t.height * 0.5 - (p.pos.y + 1.6); p.yaw = Math.atan2(-dx, -dz); p.pitch = Math.atan2(dy, Math.hypot(dx, dz)); }
    return t;
  };
  let frame = 0;
  // scripted input runs on a fixed 60 Hz clock, not per rendered frame, so a
  // faster build faces the same casts per second as a slower one
  const ticked = (fn) => { let acc = 0; return (dt) => { acc += dt; let k = 0; while (acc >= 1 / 60 && k++ < 8) { acc -= 1 / 60; fn(); } }; };
  let measureAfter = 1.5;
  if (scen === 'explore') {
    for (const r of L.rooms) r.cleared = true;
    // grid path (BFS over open cells) through the main rooms in order
    const main = L.rooms.filter((r) => r.main).sort((a, b) => a.order - b.order);
    const open = (x, y) => x >= 0 && y >= 0 && x < L.W && y < L.H && !col.cellBlocked(x, y, 0.45);
    const bfs = (ax, ay, bx, by) => {
      const prev = new Map(), k = (x, y) => y * L.W + x, q = [[ax, ay]];
      prev.set(k(ax, ay), -1);
      while (q.length) {
        const [x, y] = q.shift();
        if (x === bx && y === by) break;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const nx = x + dx, ny = y + dy; if (open(nx, ny) && !prev.has(k(nx, ny))) { prev.set(k(nx, ny), k(x, y)); q.push([nx, ny]); } }
      }
      const path = [];
      for (let c = k(bx, by); c !== -1 && c !== undefined; c = prev.get(c)) path.push([(c % L.W + 0.5) * T, (Math.floor(c / L.W) + 0.5) * T]);
      return path.reverse();
    };
    const cellOf = (r) => { let x = Math.floor(r.cx / T), y = Math.floor(r.cz / T); for (let s = 0; s < 6 && !open(x, y); s++) x++; return [x, y]; };
    let pts = [];
    for (let i = 0; i + 1 < main.length; i++) { const [ax, ay] = cellOf(main[i]), [bx, by] = cellOf(main[i + 1]); pts = pts.concat(bfs(ax, ay, bx, by)); }
    window.__walk = pts;
    // smooth the staircase a little and walk it at 6 m/s
    let i = 0, along = 0, yawS = null, walkT = 0;
    measureAfter = 1;
    window.__drive = (dt) => {
      frame++;
      along += 6 * dt;
      while (i + 1 < pts.length && along > Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1])) { along -= Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]); i++; }
      if (i + 1 >= pts.length) { i = 0; along = 0; }
      const a = pts[i], b = pts[i + 1], len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1, k = Math.min(1, along / len);
      const x = a[0] + (b[0] - a[0]) * k, z = a[1] + (b[1] - a[1]) * k;
      const c = pts[Math.min(pts.length - 1, i + 3)];
      const yaw = Math.atan2(-(c[0] - x), -(c[1] - z));
      yawS = yawS === null ? yaw : yawS + Math.atan2(Math.sin(yaw - yawS), Math.cos(yaw - yawS)) * Math.min(1, dt * 4);
      p.pos.set(x, g.groundY(x, z), z); p.vel?.set(0, 0, 0);
      walkT += dt;
      p.yaw = yawS + Math.sin(walkT * 1.2) * 0.35; p.pitch = Math.sin(walkT * 0.8) * 0.12;
    };
  } else if (scen === 'fight') {
    const room = L.rooms.filter((r) => r.main && r.type === 'combat').sort((a, b) => a.order - b.order)[0];
    room.cleared = false;
    p.pos.set(room.cx, g.groundY(room.cx, room.cz), room.cz);
    measureAfter = 2.5; // doors slam, the first wave summons in
    window.__drive = ticked(() => {
      frame++;
      const t = aim();
      inp.mouse.left = !!t;
      if (frame % 90 < 45) { inp.down.add('KeyA'); inp.down.delete('KeyD'); } else { inp.down.add('KeyD'); inp.down.delete('KeyA'); }
      if (frame % 120 === 10) inp.pressed.add('KeyQ');
      if (frame % 120 === 70) inp.pressed.add('KeyE');
    });
  } else if (scen === 'heavy') {
    for (const a of g.actors.list) if (a.faction === 'enemy' && !a.dead) { a.hp = 0; }
    const room = L.rooms.filter((r) => r.type === 'combat').sort((a, b) => b.w * b.h - a.w * a.h)[0];
    room.cleared = true;
    p.pos.set(room.cx, g.groundY(room.cx, room.cz), room.cz);
    const spot = () => {
      for (let k = 0; k < 40; k++) {
        const x = room.cx + (Math.random() - 0.5) * room.w * T * 0.8, z = room.cz + (Math.random() - 0.5) * room.h * T * 0.8;
        if (L.roomAt(x, z) === room && !col.cellBlocked(Math.floor(x / T), Math.floor(z / T), 0.5) && Math.hypot(x - p.pos.x, z - p.pos.z) > 4) return { x, z };
      }
      return { x: room.cx + 3, z: room.cz + 3 };
    };
    const mates = ['stormcaller', 'necromancer', 'cryomancer'].map((c, i) => {
      if (!g.remotes.get('bot' + i)) g.addRemote({ id: 'bot' + i, name: 'Bot' + i, classId: c });
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
      for (; alive < N; alive++) { const s = spot(); const a = g.director.spawnEnemy(roster[alive % roster.length], s.x, s.z, { noCredit: true }); a.maxHp = a.hp = a.maxHp * 12; }
    };
    const SL = ['primary', 'secondary', 'ability1', 'ability2', 'ultimate'];
    measureAfter = 8; // past the first ultimates (their effects warm up)
    fill();
    window.__drive = ticked(() => {
      frame++;
      if (frame % 15 === 0) fill();
      p.pos.set(room.cx, g.groundY(room.cx, room.cz), room.cz);
      const t = aim();
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
          const k = Math.floor((frame + i * 7) / 12);
          const slot = k % 25 === 24 ? 'ultimate' : k % 5 === 0 ? SL[1 + (k / 5) % 3] : 'primary';
          const sp = r.cls.spells[slot];
          const o = r.muzzleWorld();
          const d = ap.clone().sub(o).normalize();
          if (sp.mode === 'channel') { r.replayCast({ slot, o: o.toArray(), d: d.toArray(), ap: ap.toArray(), chan: 1 }); r._chanEnd = frame + 40; } else r.replayCast({ slot, o: o.toArray(), d: d.toArray(), ap: ap.toArray() });
        }
        if (r._chanEnd === frame && r.channel) r.replayCast({ slot: r.channel.ctx.slot, chan: 0 });
      });
      if (frame % 60 === 20) { const s = spot(); g.spawnPoolLocal(new THREE.Vector3(s.x, g.groundY(s.x, s.z), s.z), 2.5, 4, 0, frame % 120 === 20 ? 'enemyGreen' : 'enemyFire'); }
      if (frame % 150 === 75) { const k = L.breakables.find((b) => b.alive && b.type === 'keg'); if (k) g.breakProp(k.i, true); }
    });
  }
  await wait(measureAfter * 1000);
};

// runs in the page: records one window of `sec` seconds. frozen: the world
// holds still (rendering only) - in explore at a fixed spot per round, so every
// build draws the same frame
const measureWindow = async ([sec, frozen, scen, round]) => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const g = window.__game, R = g.renderer;
  if (frozen) {
    window.__freeze = true;
    const pts = window.__walk;
    if (scen === 'explore' && pts) {
      window.__heldDrive = window.__drive; window.__drive = null;
      const i = (round * 41) % (pts.length - 4), a = pts[i], b = pts[i + 3], p = g.player;
      p.pos.set(a[0], g.groundY(a[0], a[1]), a[1]); p.yaw = Math.atan2(-(b[0] - a[0]), -(b[1] - a[1])); p.pitch = 0;
      window.__freeze = false; await new Promise((r) => requestAnimationFrame(r)); await new Promise((r) => requestAnimationFrame(r)); window.__freeze = true;
      await wait(200);
    }
  }
  window.__frames.length = 0;
  for (const k in window.__cpu) window.__cpu[k].length = 0;
  if (window.__gpuAcc) { for (const k in window.__gpuAcc) delete window.__gpuAcc[k]; window.__gpuFrames.clear(); }
  window.__rec = true;
  console.profile('fps');
  await wait(sec * 1000);
  console.profileEnd('fps');
  window.__rec = false;
  window.__freeze = false;
  if (window.__heldDrive) { window.__drive = window.__heldDrive; window.__heldDrive = null; }
  const sum = (a) => a.reduce((s, v) => s + v, 0);
  const c = window.__cpu;
  return {
    frames: window.__frames.slice(), renList: c.ren.slice(), upd: sum(c.upd), ren: sum(c.ren), calls: sum(c.calls), tris: sum(c.tris) / 1000, n: c.ren.length,
    gpu: window.__gpuAcc ? JSON.parse(JSON.stringify(window.__gpuAcc)) : null,
    gpuFrames: window.__gpuFrames ? [...window.__gpuFrames.values()].map((F) => { let t = 0; for (const k in F) t += F[k]; F.total = t; return F; }) : null,
    enemies: g.actors.list.filter((a) => !a.dead).length, res: R.resScale,
  };
};

// self and inclusive ms per frame by function over the measured window
function summarize(p, top, frames) {
  const byId = new Map(p.nodes.map((n) => [n.id, n]));
  const parent = new Map();
  for (const n of p.nodes) for (const c of n.children ?? []) parent.set(c, n.id);
  const short = (u) => (u || '').replace(/^.*\/(src|assets|node_modules)\//, '$1/').replace(/\?.*$/, '');
  const key = (n) => `${n.callFrame.functionName || '(anon)'} ${short(n.callFrame.url)}:${n.callFrame.lineNumber + 1}`;
  const incl = new Map(), self = new Map();
  for (let i = 0; i < p.samples.length; i++) {
    const dt = p.timeDeltas[i] ?? 0;
    let id = p.samples[i];
    self.set(key(byId.get(id)), (self.get(key(byId.get(id))) ?? 0) + dt);
    const seen = new Set();
    for (; id != null; id = parent.get(id)) { const k = key(byId.get(id)); if (!seen.has(k)) { seen.add(k); incl.set(k, (incl.get(k) ?? 0) + dt); } }
  }
  const fmt = (m) => [...m].filter(([k]) => !/^\((root|program|idle)\)/.test(k)).sort((a, b) => b[1] - a[1]).slice(0, top).map(([k, v]) => `${(v / 1000 / frames).toFixed(3).padStart(7)} ms/f  ${k}`).join('\n');
  return `-- inclusive\n${fmt(incl)}\n-- self\n${fmt(self)}`;
}

// GPU timer queries around each stage of the fused frame (queries can't nest:
// a stage is closed while the shadow map or a single draw is being timed and
// reopened after it, so stages add up to the whole frame)
function installGpuTimer(R, perDraw) {
  const r = R.renderer, gl = r.getContext(), ext = gl.getExtension('EXT_disjoint_timer_query_webgl2');
  if (!ext) return;
  const A = (window.__gpuAcc = {}), pending = [], free = [];
  let open = null, frameNo = 0;
  window.__gpuFrames = new Map(); // frame -> { label: ms }, for medians
  const begin = (label) => { const q = free.pop() ?? gl.createQuery(); gl.beginQuery(ext.TIME_ELAPSED_EXT, q); open = { q, label, f: frameNo }; };
  const end = () => { if (!open) return null; gl.endQuery(ext.TIME_ELAPSED_EXT); pending.push(open); const l = open.label; open = null; return l; };
  const add = (label, ms, n = 1) => { const e = (A[label] ??= [0, 0]); e[0] += ms; e[1] += n; };
  const poll = () => {
    while (pending.length) {
      const p = pending[0];
      if (!gl.getQueryParameter(p.q, gl.QUERY_RESULT_AVAILABLE)) break;
      pending.shift();
      const ok = !gl.getParameter(ext.GPU_DISJOINT_EXT);
      if (ok && window.__rec) {
        const ms = gl.getQueryParameter(p.q, gl.QUERY_RESULT) / 1e6;
        add(p.label, ms);
        if (!p.label.startsWith('d:')) { const F = window.__gpuFrames.get(p.f) ?? {}; F[p.label] = (F[p.label] ?? 0) + ms; window.__gpuFrames.set(p.f, F); }
      }
      free.push(p.q);
    }
  };
  const sm = r.shadowMap, smr = sm.render.bind(sm);
  sm.render = (...a) => { const l = end(); begin('shadow'); try { smr(...a); } finally { end(); if (l) begin(l); } };
  if (perDraw) {
    const key = (o, m) => {
      let n = o.name || '';
      for (let p = o.parent; !n && p && p.type !== 'Scene'; p = p.parent) n = p.name ? '^' + p.name : '';
      return 'd:' + (n.replace(/[\d_]+$/, '') || '?') + ' [' + (m.name || m.type) + (m.transparent ? ' T' : '') + ']';
    };
    const rbd = r.renderBufferDirect.bind(r);
    r.renderBufferDirect = (camera, scene, geo, mat, obj, group) => {
      const l = end();
      begin(key(obj, mat));
      try { return rbd(camera, scene, geo, mat, obj, group); } finally { end(); if (l) begin(l); }
    };
  }
  const time = (label, fn) => { begin(label); try { fn(); } finally { end(); } };
  if (!R.fused) { const r0 = R.render.bind(R); R.render = (t) => { poll(); frameNo++; if (window.__rec) add('frame', 0); time('total', () => r0(t)); }; return; }
  R._renderFused = function () {
    poll();
    frameNo++;
    if (window.__rec) add('frame', 0);
    const rt = this.sceneRT;
    r.setRenderTarget(rt);
    time('scene', () => r.render(this.scene, this.camera));
    time('view', () => this.viewPass.render(r, null, rt));
    time('bloom', () => this.bloomMips(rt));
    const u = this.finalMat.uniforms;
    u.tDiffuse.value = rt.texture;
    u.tBloom.value = this.bloom.renderTargetsHorizontal[0].texture;
    u.toneMappingExposure.value = r.toneMappingExposure;
    r.setRenderTarget(this.smaa ? this.ldrRT : null);
    time('final', () => this.finalQuad.render(r));
    if (this.smaa) time('smaa', () => this.smaa.render(r, null, this.ldrRT));
  };
}

const sum = (a) => a.reduce((s, v) => s + v, 0), mean = (a) => (a.length ? sum(a) / a.length : 0);
const med = (a) => { const v = a.slice().sort((x, y) => x - y); return v.length ? (v.length % 2 ? v[(v.length - 1) / 2] : (v[v.length / 2 - 1] + v[v.length / 2]) / 2) : 0; };
// pooled stats over a set of windows
function stats(ws) {
  const fr = ws.flatMap((w) => w.frames), srt = fr.slice().sort((a, b) => b - a);
  const worst = srt.slice(0, Math.max(1, Math.ceil(fr.length / 100)));
  const nr = sum(ws.map((w) => w.n)) || 1;
  const gpu = {};
  for (const w of ws) for (const [k, v] of Object.entries(w.gpu ?? {})) { const e = (gpu[k] ??= [0, 0]); e[0] += v[0]; e[1] += v[1]; }
  const nf = gpu.frame?.[1] || 1;
  const passes = Object.fromEntries(Object.entries(gpu).filter(([k]) => k !== 'frame' && !k.startsWith('d:')).sort((a, b) => b[1][0] - a[1][0]).map(([k, v]) => [k, +(v[0] / nf).toFixed(2)]));
  const draws = Object.entries(gpu).filter(([k]) => k.startsWith('d:')).sort((a, b) => b[1][0] - a[1][0]).slice(0, 25).map(([k, v]) => [k.slice(2) + ' x' + (v[1] / nf).toFixed(0), v[0] / nf]);
  const gf = ws.flatMap((w) => w.gpuFrames ?? []);
  const gmed = gf.length ? Object.fromEntries(['total', ...Object.keys(passes)].map((k) => [k, +med(gf.map((F) => F[k] ?? 0)).toFixed(2)])) : null;
  const rmed = med(ws.flatMap((w) => w.renList ?? []));
  return {
    gmed, rmed,
    fps: fr.length / (sum(fr) / 1000), medFps: med(ws.map((w) => w.frames.length / (sum(w.frames) / 1000))), low1: 1000 / mean(worst), p99: srt[Math.floor(fr.length / 100)] ?? 0,
    upd: sum(ws.map((w) => w.upd)) / nr, ren: sum(ws.map((w) => w.ren)) / nr, calls: sum(ws.map((w) => w.calls)) / nr, tris: sum(ws.map((w) => w.tris)) / nr,
    gpu: Object.keys(passes).length ? passes : null, draws, enemies: ws[ws.length - 1]?.enemies,
  };
}
const line = (name, r) => `${name.padEnd(8)} ${r.fps.toFixed(0).padStart(5)} fps (med ${r.medFps.toFixed(0).padStart(4)})  1%low ${r.low1.toFixed(0).padStart(4)}  p99 ${r.p99.toFixed(1).padStart(5)}ms  upd ${r.upd.toFixed(2)} ren ${r.ren.toFixed(2)}ms  calls ${r.calls.toFixed(0)} tris ${r.tris.toFixed(0)}k  alive ${r.enemies}${r.gpu ? '  gpu ' + JSON.stringify(r.gpu) : ''}${r.gmed ? '  gpu median ' + JSON.stringify(r.gmed) : ''}  ren median ${r.rmed.toFixed(2)}`;

function report(rows) {
  const keys = [...new Set(rows.map((r) => `${r.quality} f${r.floor} ${r.scen}`))];
  const names = [...new Set(rows.map((r) => r.build))];
  console.log('\npooled over every window (all reps):');
  for (const k of keys) {
    console.log(k);
    for (const b of names) {
      const ws = rows.filter((r) => `${r.quality} f${r.floor} ${r.scen}` === k && r.build === b);
      if (ws.length) console.log('  ' + line(b, stats(ws)));
    }
  }
}

if (arg('summary')) { report(fs.readFileSync(arg('summary'), 'utf8').trim().split('\n').map((l) => JSON.parse(l))); process.exit(0); }

const rows = [];
fs.mkdirSync(out.replace(/[^/\\]+$/, '') || '.', { recursive: true });
for (let rep = 0; rep < reps; rep++) {
  for (const quality of qualities) for (const floor of floors) {
    const browser = await chromium.launch({
      executablePath: BROWSER, headless: true,
      args: ['--enable-gpu', '--use-angle=d3d11', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required', '--disable-gpu-vsync', '--disable-frame-rate-limit'],
    });
    try {
      const pages = [];
      for (const b of builds) {
        const ctx = await browser.newContext({ viewport: { width: W, height: H } });
        const page = await ctx.newPage();
        const errors = [];
        page.on('pageerror', (e) => errors.push(e.message));
        await page.addInitScript(init, [quality]);
        if (gpuMode) await page.addInitScript(`window.installGpuTimer = ${installGpuTimer.toString()}`);
        const cdp = await ctx.newCDPSession(page);
        let profP = null;
        if (cpuprof) {
          await cdp.send('Profiler.enable');
          await cdp.send('Profiler.setSamplingInterval', { interval: 200 });
          cdp.on('Profiler.consoleProfileFinished', (e) => profP?.(e.profile));
        }
        await page.goto(`${b.url}?autostart=pyromancer&test=1&quality=${quality}&floor=${floor}&seed=4242${extra ? '&' + extra : ''}`, { timeout: 120000 });
        await page.waitForFunction(() => { const g = window.__game; return g && !g.menuMode && g.player?.id === 'solo' && !g.loadingFloor && g.level; }, null, { timeout: 120000, polling: 100 });
        await page.waitForTimeout(1500);
        if (rep === 0 && pages.length === 0) console.log('GPU:', await page.evaluate(() => { const gl = window.__game.renderer.renderer.getContext(); const e = gl.getExtension('WEBGL_debug_renderer_info'); return e ? gl.getParameter(e.UNMASKED_RENDERER_WEBGL) : '?'; }));
        const P = { b, page, cdp, errors, prof: (f) => { profP = f; } };
        P.freeze = () => cdp.send('Page.setWebLifecycleState', { state: 'frozen' });
        P.thaw = () => cdp.send('Page.setWebLifecycleState', { state: 'active' });
        await P.freeze();
        pages.push(P);
      }
      for (const scen of scens) {
        for (const P of pages) { await P.thaw(); await P.page.evaluate(setupScenario, [scen, res, n, gpuMode]); await P.freeze(); }
        const got = new Map(pages.map((P) => [P, []]));
        for (let r = 0; r < rounds; r++) {
          for (let i = 0; i < pages.length; i++) {
            const P = pages[(i + r + rep) % pages.length];
            await P.thaw();
            await P.page.waitForTimeout(400); // the first frames after a thaw carry the frozen gap
            const prof = cpuprof && r === 0 ? new Promise((res) => P.prof(res)) : null;
            const w = await P.page.evaluate(measureWindow, [sec, frozen, scen, r]);
            await P.freeze();
            if (prof) console.log(`[${P.b.name} ${quality} f${floor} ${scen}]\n` + summarize(await prof, cpuprof, w.frames.length));
            const row = { build: P.b.name, quality, floor, scen, rep, round: r, ...w, errors: P.errors.length };
            rows.push(row);
            got.get(P).push(row);
            fs.appendFileSync(out, JSON.stringify(row) + '\n');
          }
        }
        console.log(`${quality} f${floor} ${scen} (rep ${rep})`);
        for (const P of pages) {
          const st = stats(got.get(P));
          console.log('  ' + line(P.b.name, st) + (P.errors.length ? '  ERR ' + P.errors[0] : ''));
          if (gpuMode === 'draws') for (const [k, v] of st.draws) console.log('       ', v.toFixed(3).padStart(7), k);
        }
        for (const P of pages) { await P.thaw(); await P.page.evaluate(() => { window.__drive = null; const i = window.__input; i.mouse.left = i.mouse.right = false; i.down.clear(); }); await P.freeze(); }
      }
    } catch (e) { console.log(quality, floor, 'FAILED', e.message.split('\n')[0]); } finally { await browser.close(); }
  }
}
report(rows);
