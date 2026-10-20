import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TextureFactory, makeSurfaceMaterial } from '../src/render/textures.js';
import { CLASS_IDS, CLASS_META } from '../src/game/classMeta.js';
import { createViewModel, createAvatar } from '../src/game/wizardModels.js';

// Wizard model viewer.
//   ?mode=view&class=pyromancer&cast=thrust      first-person viewmodel
//   ?mode=avatar&class=cryomancer&anim=move      third-person avatar, orbit drag
//   ?mode=grid&anim=idle                          all 13 avatars in a row
// Extra params: hand=left|right|both, ct=<cast time s> (freeze the cast at that
// time), t=<time>, freeze=1, charge, power, speed, downed=1, dash=1, hurt,
// pitch, strafe, cp=<castProgress>, hud=0.
// Keys: <-/-> class, 1-8 cast styles (shift = left hand, alt = both),
// W walk, C hold to charge, Q dash, H hurt, X downed, P power, Space jump,
// A cycle avatar anims.

const P = new URLSearchParams(location.search);
const mode = P.get('mode') ?? 'view';
let classIdx = Math.max(0, CLASS_IDS.indexOf(P.get('class') ?? 'pyromancer'));
const num = (k, d) => (P.has(k) ? parseFloat(P.get(k)) : d);
const freeze = P.has('ct') || P.get('freeze') === '1';
const STYLES = ['flick', 'thrust', 'slam', 'raise', 'channel', 'swing', 'throw', 'snap'];
const ANIMS = ['idle', 'move', 'cast', 'downed', 'dead'];

const canvas = document.getElementById('c');
canvas.addEventListener('webglcontextlost', () => console.warn('WEBGL CONTEXT LOST'));
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
renderer.setSize(window.innerWidth, window.innerHeight, false);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.outputColorSpace = THREE.SRGBColorSpace;
const factory = new TextureFactory(renderer);
renderer.info.autoReset = false;

const hud = document.getElementById('hud');
if (P.get('hud') === '0') hud.style.display = 'none';

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x07080a);
let camera;
let composer;
let controls = null;

const state = {
  t: num('t', 0), speed: num('speed', 0), walk: num('speed', 0) > 0, charge: num('charge', 0), power: num('power', 0),
  downed: P.get('downed') === '1', dash: P.get('dash') === '1', hurt: num('hurt', 0),
  cast: null, castStart: 0, castStyle: P.get('cast'), castHand: P.get('hand') ?? null,
  look: { x: 0, y: 0 }, grounded: true, airUntil: 0,
  anim: P.get('anim') ?? 'idle', pitch: num('pitch', 0), strafe: num('strafe', 0), cp: num('cp', -1),
};

function makeComposer(sc, cam) {
  const size = renderer.getSize(new THREE.Vector2());
  const rt = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: 4 });
  const c = new EffectComposer(renderer, rt);
  c.setPixelRatio(renderer.getPixelRatio());
  c.addPass(new RenderPass(sc, cam));
  c.addPass(new UnrealBloomPass(new THREE.Vector2(size.x, size.y), 0.65, 0.55, 0.82));
  c.addPass(new OutputPass());
  return c;
}

// ---------------------------------------------------------------------------
let vm = null;
let avatars = [];
const labels = [];

function setupView() {
  camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.01, 10);
  const hemi = new THREE.HemisphereLight(0x2a3a52, 0x0a0806, 0.6);
  scene.add(hemi);
  const torch = new THREE.PointLight(0xff9a50, 2.5, 6, 2);
  torch.position.set(0.9, 0.5, 0.2);
  if (P.get('torch') === '0') torch.intensity = 0;
  if (P.get('dbg') === '1') {
    const d = new THREE.DirectionalLight(0xffffff, 2.5); d.position.set(0.5, 1, 1); scene.add(d);
    scene.add(new THREE.AmbientLight(0xffffff, 0.6));
  }
  scene.add(torch);
  // far backdrop wall so sway/bob reads against something
  const wall = new THREE.Mesh(new THREE.PlaneGeometry(14, 8), makeSurfaceMaterial(factory, 'dungeonWall', { color: 0x40403c }));
  wall.position.set(0, 0, -5);
  if (P.get('wall') !== '0') scene.add(wall);
  const wl = new THREE.PointLight(0xff8a3d, 6, 8, 2);
  wl.position.set(1.5, 0.5, -3.5);
  scene.add(wl);
  if (P.has('cam')) {
    // debug: inspect the viewmodel from another camera  cam=x,y,z&look=x,y,z&fov=..
    const c = P.get('cam').split(',').map(Number), l = (P.get('look') ?? '0.2,-0.2,-0.55').split(',').map(Number);
    camera.position.set(...c); camera.lookAt(...l); camera.fov = num('fov', 40); camera.updateProjectionMatrix();
  }
  composer = makeComposer(scene, camera);
  const cross = document.createElement('div'); cross.id = 'cross'; document.body.appendChild(cross);
  loadVM();
}

function loadVM() {
  if (vm) { vm.dispose(); vm = null; }
  vm = createViewModel(CLASS_IDS[classIdx], { factory });
  scene.add(vm.root);
  if (P.get('stats') === '1') logTris(vm.root);
  if (P.has('hide')) vm.root.traverse((o) => { if (o.name === P.get('hide')) o.visible = false; });
}

function setupAvatar(grid) {
  camera = new THREE.PerspectiveCamera(grid ? 30 : 40, window.innerWidth / window.innerHeight, 0.05, 100);
  scene.fog = new THREE.FogExp2(0x07080a, grid ? 0.02 : 0.05);
  const floorMat = makeSurfaceMaterial(factory, 'flagstone');
  for (const k of ['map', 'normalMap', 'roughnessMap']) { /* textures are shared; tile via UVs instead */ }
  const fg = new THREE.PlaneGeometry(grid ? 30 : 10, grid ? 12 : 10);
  const uv = fg.getAttribute('uv');
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * (grid ? 10 : 3.3), uv.getY(i) * (grid ? 4 : 3.3));
  const floor = new THREE.Mesh(fg, floorMat);
  floor.rotation.x = -Math.PI / 2;
  scene.add(floor);
  scene.add(new THREE.HemisphereLight(0x3a4a62, 0x0a0806, 1.2));
  const torch = new THREE.PointLight(0xff9a50, grid ? 120 : 30, grid ? 40 : 14, 2);
  torch.position.set(grid ? 0 : 1.6, 2.4, grid ? 5 : 2.2);
  scene.add(torch);
  const rim = new THREE.PointLight(0x6080c0, grid ? 12 : 5, 12, 2);
  rim.position.set(-2, 2.5, -2.5);
  scene.add(rim);
  if (grid) {
    const n = CLASS_IDS.length;
    const sp = 1.15;
    CLASS_IDS.forEach((id, i) => {
      const a = createAvatar(id, { factory });
      a.root.position.x = (i - (n - 1) / 2) * sp;
      scene.add(a.root);
      avatars.push(a);
      const l = document.createElement('div'); l.className = 'label'; l.textContent = CLASS_META[id].name; document.body.appendChild(l);
      labels.push({ el: l, obj: a.root });
    });
    camera.position.set(0, 1.3, 16.5);
    controls = new OrbitControls(camera, canvas);
    controls.target.set(0, 1.0, 0);
  } else {
    loadAvatar();
    camera.position.set(1.2, 1.5, 3.4);
    controls = new OrbitControls(camera, canvas);
    controls.target.set(0, 1.0, 0);
  }
  // close-ups: cam=x,y,z&look=x,y,z&fov=..; fill=1 adds a soft key light for inspection
  if (P.has('cam')) {
    const c = P.get('cam').split(',').map(Number), l = (P.get('look') ?? '0,1,0').split(',').map(Number);
    camera.position.set(...c); controls.target.set(...l); camera.fov = num('fov', camera.fov); camera.updateProjectionMatrix();
  }
  if (P.get('fill') === '1') {
    const d = new THREE.DirectionalLight(0xfff0e0, 1.6); d.position.set(1.5, 3, 4); scene.add(d);
    const d2 = new THREE.DirectionalLight(0x8090c0, 0.5); d2.position.set(-3, 2, -2); scene.add(d2);
  }
  if (P.has('rot')) for (const a of avatars) a.root.rotation.y = num('rot', 0);
  controls.update();
  composer = makeComposer(scene, camera);
}

function loadAvatar() {
  for (const a of avatars) a.dispose();
  avatars = [createAvatar(CLASS_IDS[classIdx], { factory })];
  scene.add(avatars[0].root);
  if (P.get('stats') === '1') logTris(avatars[0].root);
}
window.__avatars = () => avatars;
// debug: per-avatar triangles and draw calls (one per visible mesh / sprite)
window.__avStats = () => avatars.map((a) => {
  let tris = 0, calls = 0;
  const mats = {};
  a.root.traverseVisible((o) => {
    if (!o.isMesh && !o.isSprite) return;
    calls++;
    const g = o.geometry;
    const n = o.isSprite ? 2 : (g.index ? g.index.count : g.getAttribute('position').count) / 3;
    tris += n;
    let pp = o, key = 'body';
    while (pp && pp !== a.root) { if (pp.name) { key = pp.name; break; } pp = pp.parent; }
    mats[key] = mats[key] ?? [0, 0];
    mats[key][0]++; mats[key][1] += Math.round(n);
  });
  return { id: a.root.name, tris: Math.round(tris), calls, mats, labels: a.stats?.labels };
});
// debug: triangle count per named part
function logTris(rootObj) {
  const tally = {};
  let total = 0;
  rootObj.traverse((o) => {
    if (!o.isMesh) return;
    let p = o, key = 'body';
    while (p) { if (p.name && p !== rootObj) { key = p.name; break; } p = p.parent; }
    const g = o.geometry;
    const n = (g.index ? g.index.count : g.getAttribute('position').count) / 3;
    tally[key] = (tally[key] ?? 0) + n; total += n;
  });
  console.warn('TRIS', Math.round(total), JSON.stringify(Object.fromEntries(Object.entries(tally).map(([k, v]) => [k, Math.round(v)]))));
}

// debug: one articulated hand in a pose, seen from 4 sides  ?mode=hand&pose=open&style=bare
async function setupHand() {
  const { buildHand, POSES, gripPose } = await import('../src/game/models/wizard/hand.js');
  const { getKit } = await import('../src/game/models/wizard/kit.js');
  const kit = getKit(factory);
  camera = new THREE.PerspectiveCamera(30, window.innerWidth / window.innerHeight, 0.01, 10);
  camera.position.set(0, 0, 0.9); camera.lookAt(0, 0, 0);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x404040, 1.5));
  const d = new THREE.DirectionalLight(0xffffff, 2.5); d.position.set(1, 2, 2); scene.add(d);
  const style = P.get('style') ?? 'bare';
  const poseName = P.get('pose') ?? 'open';
  const views = [[0, 0, 0], [-Math.PI / 2, 0, 0], [Math.PI / 2, 0, 0], [0, Math.PI / 2, 0]];
  views.forEach((r, i) => {
    const h = buildHand({ style, glove: kit.glove(0x6a4a34), skin: kit.skin(0xe0b8a0), nail: kit.plain(0xd8b0a8, 0.4), claws: P.get('claws') === '1', armor: kit.steel() });
    const pose = poseName === 'grip' ? gripPose(0.0175).pose : POSES[poseName];
    h.setPose(pose);
    const g = new THREE.Group(); g.add(h.group); h.group.position.set(0, 0, 0.06);
    g.rotation.set(...r);
    g.position.set((i % 2 ? 0.13 : -0.13), (i < 2 ? 0.1 : -0.1), 0);
    scene.add(g);
    if (poseName === 'grip') {
      const gp = gripPose(0.0175).gripPos;
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.0175, 0.0175, 0.2, 12), kit.plain(0x6a5040));
      pole.rotation.z = Math.PI / 2; pole.position.copy(gp); h.group.add(pole);
    }
  });
  composer = makeComposer(scene, camera);
}

// ---------------------------------------------------------------------------
function startCast(style, hand) {
  state.cast = { slot: style === 'raise' ? 'ultimate' : style === 'throw' || style === 'snap' ? 'ability1' : 'primary', hand, style, t: 0 };
  state.castStart = state.t;
}

window.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
    classIdx = (classIdx + (e.key === 'ArrowRight' ? 1 : CLASS_IDS.length - 1)) % CLASS_IDS.length;
    if (mode === 'view') loadVM(); else if (mode === 'avatar') loadAvatar();
  }
  const n = e.code && e.code.startsWith('Digit') ? parseInt(e.code.slice(5), 10) : NaN;
  if (n >= 1 && n <= 8) {
    const style = STYLES[n - 1];
    const hand = e.altKey ? 'both' : e.shiftKey ? 'left' : style === 'throw' || style === 'snap' ? 'left' : style === 'raise' ? 'both' : 'right';
    startCast(style, hand);
  }
  const k = e.key.toLowerCase();
  if (k === 'w') state.walk = !state.walk;
  if (k === 'c') state.charging = true;
  if (k === 'q') { state.dash = true; setTimeout(() => (state.dash = false), 250); }
  if (k === 'h') state.hurt = 1;
  if (k === 'x') state.downed = !state.downed;
  if (k === 'p') state.power = state.power > 0 ? 0 : 1;
  if (k === ' ') { state.grounded = false; state.airUntil = state.t + 0.6; }
  if (k === 'a') state.anim = ANIMS[(ANIMS.indexOf(state.anim) + 1) % ANIMS.length];
});
window.addEventListener('keyup', (e) => { if (e.key.toLowerCase() === 'c') state.charging = false; });
window.addEventListener('mousemove', (e) => {
  if (mode !== 'view' || !e.buttons) return;
  state.look.x += e.movementX; state.look.y += e.movementY;
});
window.addEventListener('resize', () => {
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  composer.setSize(window.innerWidth, window.innerHeight);
});

// ---------------------------------------------------------------------------
function stepView(dt) {
  if (state.cast) {
    state.cast.t = state.t - state.castStart;
    const S = state.cast.style;
    const dur = S === 'channel' ? 2.0 : S === 'raise' ? 1.6 : 0.6;
    if (state.cast.t > dur) state.cast = null;
  }
  if (!state.grounded && state.t > state.airUntil) state.grounded = true;
  const speedTarget = state.walk ? Math.max(0.0001, num('speed', 1)) : 0;
  state.speed += (speedTarget - state.speed) * Math.min(1, dt * 8);
  if (state.charging) state.charge = Math.min(1, state.charge + dt * 1.2);
  else if (!P.has('charge')) state.charge = Math.max(0, state.charge - dt * 4);
  vm.setPower(state.power);
  vm.update(dt, {
    t: state.t, speed: state.speed, grounded: state.grounded, look: state.look, cast: state.cast,
    charge: state.charge, dash: state.dash, hurt: state.hurt, downed: state.downed,
  });
  state.look.x = 0; state.look.y = 0;
  state.hurt = Math.max(0, state.hurt - dt * 3);
}

function stepAvatars(dt) {
  const anim = state.anim;
  const sp = anim === 'move' ? num('speed', 3.2) : 0;
  let cp = state.cp;
  if (cp < 0) cp = (state.t * 1.2) % 1;
  for (const a of avatars) {
    a.update(dt, { anim, t: state.t, speed: sp, pitch: state.pitch, castProgress: cp, strafe: state.strafe });
  }
}

function hudText() {
  const id = CLASS_IDS[classIdx];
  const m = CLASS_META[id];
  if (mode === 'view') return `${m.name} — ${m.focusDesc}\n[←/→] class  [1-8] ${STYLES.join(' ')} (shift=left, alt=both)\n[W] walk ${state.walk ? 'on' : 'off'}  [C] charge  [Q] dash  [H] hurt  [X] downed  [P] power  [Space] jump  drag = look`;
  if (mode === 'avatar') return `${m.name} — anim: ${state.anim}  [A] cycle anim  [←/→] class  drag to orbit`;
  return `All classes — anim: ${state.anim}  [A] cycle anim`;
}

function updateLabels() {
  const v = new THREE.Vector3();
  for (const l of labels) {
    v.setFromMatrixPosition(l.obj.matrixWorld); v.y += 2.15;
    v.project(camera);
    l.el.style.left = `${(v.x * 0.5 + 0.5) * window.innerWidth}px`;
    l.el.style.top = `${(-v.y * 0.5 + 0.5) * window.innerHeight}px`;
  }
}

if (mode === 'view') setupView(); else if (mode === 'hand') await setupHand(); else setupAvatar(mode === 'grid');

const step = mode === 'view' ? stepView : mode === 'hand' ? () => {} : stepAvatars;

if (freeze) {
  // deterministic: simulate up to the requested moment, then render once
  const ct = num('ct', -1);
  const T = Math.max(num('t', 1.5), ct >= 0 ? ct + 0.5 : 0);
  const dt = 1 / 60;
  state.t = 0;
  if (mode === 'view' && ct >= 0 && state.castStyle) {
    const hand = state.castHand ?? (['throw', 'snap'].includes(state.castStyle) ? 'left' : state.castStyle === 'raise' ? 'both' : 'right');
    const startAt = T - ct;
    while (state.t < T - 1e-6) {
      if (!state.cast && state.t >= startAt - 1e-6) startCast(state.castStyle, hand);
      if (state.cast) state.cast.t = state.t - state.castStart;
      stepNoExpire(dt);
      state.t += dt;
    }
  } else {
    while (state.t < T - 1e-6) { step(dt); state.t += dt; }
  }
  renderer.info.reset();
  composer.render();
  hud.textContent = hudText() + `\ntris ${renderer.info.render.triangles}  calls ${renderer.info.render.calls}`;
  updateLabels();
  // keep presenting the frozen frame (some compositors drop a single frame)
  let frames = 0;
  const hold = () => { composer.render(); if (++frames === 2) window.__ready = true; requestAnimationFrame(hold); };
  hold();
} else {
  if (state.castStyle && mode === 'view') {
    setInterval(() => startCast(state.castStyle, state.castHand ?? (['throw', 'snap'].includes(state.castStyle) ? 'left' : 'right')), 1400);
  }
  let last = performance.now();
  const loop = () => {
    const now = performance.now();
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    state.t += dt;
    step(dt);
    controls?.update();
    renderer.info.reset();
    composer.render();
    hud.textContent = hudText() + `\ntris ${renderer.info.render.triangles}  calls ${renderer.info.render.calls}`;
    updateLabels();
    window.__ready = true;
    requestAnimationFrame(loop);
  };
  loop();
}

function stepNoExpire(dt) {
  // like stepView, but keeps the cast alive (frozen screenshots of channel/raise)
  const keep = state.cast;
  stepView(dt);
  if (keep && !state.cast) state.cast = keep;
}
