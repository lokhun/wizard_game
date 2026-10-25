// Enemy model viewer: inspect every procedural enemy in every animation state.
// URL params: type, anim, attack, p (fixed progress), speed, sheet=1, grid=1,
//             yaw, pitch, dist (camera), clean=1 (hide UI), q (render quality)
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { Renderer } from '../src/render/renderer.js';
import { TextureFactory, makeSurfaceMaterial } from '../src/render/textures.js';
import { ENEMY_TYPES, createEnemyModel, enemyInfo } from '../src/game/enemyModels.js';

const params = new URLSearchParams(location.search);
if (params.get('clean')) document.body.classList.add('clean');
const R = new Renderer(document.getElementById('game'), params.get('q') ?? 'high');
R.renderer.info.autoReset = false;
const factory = new TextureFactory(R.renderer);
const scene = R.scene;
const cam = R.camera;
cam.fov = 40; cam.near = 0.05; cam.far = 200; cam.updateProjectionMatrix();
scene.background = new THREE.Color(0x0a0b0e);
scene.fog = new THREE.FogExp2(0x0a0b0e, 0.025);

// ---- environment: dark stone floor, warm torches, cool fill
const floorGeo = new THREE.PlaneGeometry(80, 80);
floorGeo.rotateX(-Math.PI / 2);
{ const uv = floorGeo.getAttribute('uv'); for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 20, uv.getY(i) * 20); }
const floor = new THREE.Mesh(floorGeo, makeSurfaceMaterial(factory, 'flagstone', { size: 1024, seed: 3, color: 0x9a948c }));
scene.add(floor);
scene.add(new THREE.HemisphereLight(0x3a4a58, 0x0c0907, +(params.get('amb') ?? 1.6)));
const torchA = new THREE.PointLight(0xff9440, 34, 16, 1.6); torchA.position.set(2.6, 3.0, 2.4); scene.add(torchA);
const torchB = new THREE.PointLight(0xff7a30, 20, 14, 1.6); torchB.position.set(-3.0, 2.4, -1.2); scene.add(torchB);
const rim = new THREE.DirectionalLight(0x8aa0ff, 0.35); rim.position.set(-2, 4, -6); scene.add(rim);
const torchMarks = [torchA, torchB].map((l) => { const m = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 6), new THREE.MeshBasicMaterial({ color: new THREE.Color(l.color).multiplyScalar(6) })); m.position.copy(l.position); scene.add(m); return m; });

const LI = +(params.get('li') ?? 0.45);
let lightScale = 1;
const controls = new OrbitControls(cam, R.renderer.domElement);
controls.enableDamping = true;

// ---- state
const SEQ = [['idle', 2.2], ['move', 3], ['windup', 0.9], ['attack', 0.7], ['idle', 1.0], ['cast', 1.6], ['stagger', 0.7], ['idle', 0.8], ['death', 1.6], ['dead', 1.0], ['spawn', 1.6]];
const ANIMS = ['idle', 'move', 'windup', 'attack', 'cast', 'stagger', 'death', 'spawn'];
const DUR = { windup: 0.9, attack: 0.7, cast: 1.6, death: 1.6, spawn: 1.6, stagger: 0.7 };
let typeIdx = Math.max(0, ENEMY_TYPES.indexOf(params.get('type') ?? 'skeleton'));
let mode = params.get('grid') ? 'grid' : params.get('sheet') ? 'sheet' : 'single';
let fixedAnim = params.get('anim');
let attack = params.get('attack');
const fixedP = params.has('p') ? +params.get('p') : null;
let auto = !fixedAnim;
let showMuzzle = !!params.get('muzzle');
const baseSpeed = params.has('speed') ? +params.get('speed') : null;
const actors = [];
let treadmill = 0;

function clearActors() { for (const a of actors) { a.model.dispose(); a.label?.remove(); } actors.length = 0; }

function addActor(type, x, z, opts = {}) {
  const model = createEnemyModel(type, { factory });
  model.root.position.set(x, 0, z);
  model.root.rotation.y = opts.ry ?? 0;
  scene.add(model.root);
  const info = enemyInfo(type);
  const a = { type, model, info, seq: 0, t: opts.t0 ?? 0, attackIdx: 0, anim: opts.anim ?? fixedAnim, p: opts.p ?? fixedP, attack: opts.attack ?? attack, x, z };
  actors.push(a);
  return a;
}

function speedFor(a) { return baseSpeed ?? Math.min(3.2, 1.6 * Math.max(0.6, a.info.height / 1.8) ** 0.6); }

function build() {
  clearActors();
  const type = ENEMY_TYPES[typeIdx];
  const info = enemyInfo(type);
  if (mode === 'single') {
    addActor(type, 0, 0);
    frame(info.height, Math.max(info.radius, info.height * 0.35));
  } else if (mode === 'sheet') {
    let states = [['idle', null], ['move', null], ['windup', 1], ['attack', 0.3], ['cast', 0.7], ['stagger', null], ['death', 0.5], ['death', 1], ['spawn', 0.5]];
    // custom list: states=idle,windup:1,attack:0.3@slam
    if (params.get('states')) states = params.get('states').split(',').map((x) => { const [a, at] = x.split('@'); const [an, p] = a.split(':'); return [an, p != null ? +p : null, at]; });
    const gap = Math.max(info.radius * 2.6, info.height * 0.62, 0.9);
    states.forEach(([an, p, at], i) => {
      const x = (i - (states.length - 1) / 2) * gap;
      addActor(type, x, 0, { anim: an, p, t0: an === 'stagger' ? 0.1 : 0, attack: at ?? attack });
    });
    frame(info.height, gap * states.length * 0.5);
    controls.target.y = info.height * 0.45;
  } else {
    // one row per biome group, bosses in the back row
    const rows = [[], [], [], [], []];
    const groupOf = { rat: 0, slime: 0, ghoul: 0, bilespitter: 0, ratShaman: 0, ratOgre: 0, skeleton: 1, skeletonArcher: 1, wraith: 1, jailer: 1, executionerGuard: 1, fallenKnight: 2, hound: 2, gargoyle: 2, battlePriest: 2, knightCaptain: 2 };
    for (const t of ENEMY_TYPES) { const inf = enemyInfo(t); rows[inf.boss ? 4 : groupOf[t] ?? 3].push(t); }
    let z = 0;
    rows.forEach((row) => {
      const ws = row.map((t) => { const inf = enemyInfo(t); return Math.max(inf.radius * 2.4, inf.height * 0.45, 1.2); });
      const total = ws.reduce((a, b) => a + b, 0);
      let x = -total / 2;
      const depth = Math.max(...row.map((t) => enemyInfo(t).radius * 2.4), 1.6);
      z -= depth / 2;
      row.forEach((t, i) => { addActor(t, x + ws[i] / 2, z, { anim: fixedAnim ?? 'idle', p: fixedP }); x += ws[i]; });
      z -= depth / 2 + 0.6;
    });
    controls.target.set(0, 0.8, z * 0.5);
    cam.position.set(0, 10, 8.5);
    lightScale = 4;
    torchA.position.set(4, 5, 3); torchB.position.set(-5, 4, -6);
    torchA.distance = 30; torchB.distance = 30;
    torchMarks.forEach((m, i) => m.position.copy([torchA, torchB][i].position));
  }
  // settle damping for fixed poses
  for (let i = 0; i < 90; i++) step(1 / 60, true);
  updateUI();
}

function frame(h, halfW) {
  const yaw = +(params.get('yaw') ?? 0.55), pitch = +(params.get('pitch') ?? 0.12);
  const tf = Math.tan((cam.fov * Math.PI) / 360);
  const dist = +(params.get('dist') ?? Math.max((h * 0.5 / tf) * 1.35, (halfW / (tf * cam.aspect)) * 1.15, 2.0));
  const L = Math.max(2.2, h * 1.3, halfW * 0.8);
  torchA.position.set(L * 0.9, L * 1.0, L * 1.1); torchB.position.set(-L * 1.1, L * 0.8, -L * 0.4);
  torchA.distance = L * 6; torchB.distance = L * 6;
  lightScale = Math.pow(L / 2.2, 1.6);
  torchMarks.forEach((m, i) => m.position.copy([torchA, torchB][i].position));
  const ty = +(params.get('ty') ?? h * 0.5);
  controls.target.set(0, ty, 0);
  cam.position.set(Math.sin(yaw) * Math.cos(pitch) * dist, ty + Math.sin(pitch) * dist, Math.cos(yaw) * Math.cos(pitch) * dist);
}

function step(dt, settling = false) {
  for (const a of actors) {
    let anim, t, p, speed = 0, at = a.attack ?? null;
    const types = a.info.attackTypes;
    if (a.anim) {
      anim = a.anim;
      a.t += dt;
      const d = DUR[anim] ?? 1;
      if (a.p != null) { p = a.p; t = p * d; } else { t = a.t % (d + (anim === 'death' ? 1 : 0.3)); p = Math.min(1, t / d); }
      if (anim === 'stagger' && a.p == null) { t = a.t % 0.9; }
    } else {
      a.t += dt;
      let [an, d] = SEQ[a.seq];
      if (a.t > d) {
        a.t -= d; a.seq = (a.seq + 1) % SEQ.length;
        if (a.seq === 0) a.attackIdx++;
        [an, d] = SEQ[a.seq];
      }
      anim = an === 'dead' ? 'death' : an;
      t = a.t; p = an === 'dead' ? 1 : Math.min(1, a.t / d);
      if (anim === 'cast' && !attack) at = types.find((x) => ['cast', 'summon', 'beam', 'spit', 'shoot', 'breath'].includes(x)) ?? null;
    }
    if (anim === 'move') speed = speedFor(a);
    if (!at && (anim === 'windup' || anim === 'attack')) at = types[a.attackIdx % types.length];
    a.cur = { anim, t, p, at, speed };
    a.model.update(dt, { anim, t, speed, progress: p, attackType: at ?? undefined });
    if (!settling && mode === 'single' && anim === 'move' && !a.model.flying) treadmill += speed * dt;
  }
  if (mode === 'single') floor.position.z = -(treadmill % 4);
}

// ---- muzzle marker
const marker = new THREE.Mesh(new THREE.OctahedronGeometry(0.05), new THREE.MeshBasicMaterial({ color: 0xff00ff, wireframe: true, depthTest: false }));
marker.renderOrder = 99;
scene.add(marker);
const hbar = new THREE.Mesh(new THREE.RingGeometry(0.2, 0.23, 24), new THREE.MeshBasicMaterial({ color: 0x40ff60, side: THREE.DoubleSide, depthTest: false }));
hbar.rotation.x = -Math.PI / 2; hbar.renderOrder = 99; scene.add(hbar);

// ---- UI
const ui = document.getElementById('ui');
const info = document.getElementById('info');
function btn(row, label, on, fn) { const b = document.createElement('button'); b.textContent = label; if (on) b.className = 'on'; b.onclick = fn; row.appendChild(b); return b; }
function updateUI() {
  ui.innerHTML = '';
  const r1 = document.createElement('div'); r1.className = 'row'; ui.appendChild(r1);
  ENEMY_TYPES.forEach((t, i) => btn(r1, t, i === typeIdx && mode !== 'grid', () => { typeIdx = i; if (mode === 'grid') mode = 'single'; attack = null; build(); }));
  const r2 = document.createElement('div'); r2.className = 'row'; ui.appendChild(r2);
  btn(r2, auto ? 'auto ✓' : 'auto', auto, () => { auto = !auto; fixedAnim = auto ? null : 'idle'; build(); });
  ANIMS.forEach((an, i) => btn(r2, `${i + 1} ${an}`, !auto && fixedAnim === an, () => { auto = false; fixedAnim = an; build(); }));
  btn(r2, 'single', mode === 'single', () => { mode = 'single'; build(); });
  btn(r2, 'sheet', mode === 'sheet', () => { mode = 'sheet'; build(); });
  btn(r2, 'grid', mode === 'grid', () => { mode = 'grid'; build(); });
  const r3 = document.createElement('div'); r3.className = 'row'; ui.appendChild(r3);
  const inf = enemyInfo(ENEMY_TYPES[typeIdx]);
  btn(r3, 'attack: auto', !attack, () => { attack = null; build(); });
  for (const at of inf.attackTypes) btn(r3, at, attack === at, () => { attack = at; build(); });
}

window.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowRight') { typeIdx = (typeIdx + 1) % ENEMY_TYPES.length; attack = null; build(); }
  else if (e.key === 'ArrowLeft') { typeIdx = (typeIdx + ENEMY_TYPES.length - 1) % ENEMY_TYPES.length; attack = null; build(); }
  else if (e.key >= '1' && e.key <= '8') { auto = false; fixedAnim = ANIMS[+e.key - 1]; build(); }
  else if (e.key === ' ') { auto = !auto; fixedAnim = auto ? null : 'idle'; build(); }
  else if (e.key === 'g') { mode = mode === 'grid' ? 'single' : 'grid'; build(); }
  else if (e.key === 's') { mode = mode === 'sheet' ? 'single' : 'sheet'; build(); }
  else if (e.key === 'm') showMuzzle = !showMuzzle;
  else if (e.key === 'h') document.body.classList.toggle('clean');
  else if (e.key === 'a') { const ats = enemyInfo(ENEMY_TYPES[typeIdx]).attackTypes; attack = ats[(ats.indexOf(attack) + 1) % ats.length]; build(); }
});

build();
let last = performance.now(), time = 0, frames = 0;
const tmp = new THREE.Vector3();
function loop() {
  const now = performance.now();
  const dt = Math.min(0.05, (now - last) / 1000); last = now; time += dt;
  step(params.get('frozen') ? 0 : dt);
  controls.update();
  const a0 = actors[0];
  marker.visible = showMuzzle && mode !== 'grid';
  hbar.visible = showMuzzle && mode === 'single';
  if (a0 && mode !== 'grid') {
    a0.model.muzzle.getWorldPosition(tmp); marker.position.copy(tmp);
    hbar.position.set(a0.model.root.position.x, a0.model.height, a0.model.root.position.z);
    hbar.scale.setScalar(a0.model.radius / 0.23);
  }
  const fl = Math.sin(time * 9.1) * 0.06 + Math.sin(time * 3.7) * 0.05;
  torchA.intensity = LI * lightScale * 34 * (1 - fl); torchB.intensity = LI * lightScale * 20 * (1 + fl);
  R.renderer.info.reset();
  R.render(time);
  frames++;
  if (frames === 3) window.__ready = true;
  if (frames % 10 === 1 && a0) {
    const c = a0.cur ?? {};
    info.textContent = `${a0.type}  h=${a0.model.height} r=${a0.model.radius} flying=${a0.model.flying}\n` +
      `anim=${c.anim} attack=${c.at ?? '-'} p=${(c.p ?? 0).toFixed(2)} speed=${(c.speed ?? 0).toFixed(1)}\n` +
      `tris(model)=${a0.model.tris} meshes=${a0.model.meshes.length} calls(frame)=${R.renderer.info.render.calls}`;
  }
  requestAnimationFrame(loop);
}
loop();
void torchMarks;
window.__actors = actors;
window.__R = R;
window.__factory = factory;
