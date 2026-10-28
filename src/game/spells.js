import * as THREE from 'three';
import { hitPoint } from './actors.js';
import { FX, fxOf, nearFade, clampHDR, orbMaterial } from '../render/vfx.js';
import { SPR } from '../render/particles.js';
import { rand } from '../core/rng.js';
import { segPointDist2 } from '../core/math.js';
import { GeoBuilder } from '../render/geo.js';
import { WATER_Y } from '../world/levelgen.js';

// ---------------------------------------------------------------------------
// Spell runtime: projectiles, zones, delayed actions and channel beams.
// The same spell code runs on the caster's machine (local=true: deals damage)
// and on co-op peers (local=false: visuals only), so everyone sees every spell.
// ---------------------------------------------------------------------------

// a direct hit on a weak point (Spells.update) deals this much more: aim pays
export const WEAK_MULT = 1.35;
// is (x, y, z) on a's weak point? the front of a long body; on an upright one its head: from the base of
// its head bone to the top of the head, where the head is now (it follows a lunge or a stoop); a body with no head bone (a
// slime, a grimoire), or a bone not yet placed, uses the top quarter of its hit capsule
export function isWeak(a, x, y, z) {
  if (a.hitL > a.hitR * 0.9) return (x - a.pos.x) * Math.sin(a.yaw) + (z - a.pos.z) * Math.cos(a.yaw) > a.hitL * 0.45;
  const y0 = a.pos.y + a.hitY0, y1 = a.pos.y + a.hitH;
  const hb = a.model?.bones?.head;
  if (hb) {
    const hy = hb.matrixWorld.elements[13];
    // (up to the top of the head, about a quarter of the bone's height above it: not a raised axe or a banner)
    if (hy > y0 + (y1 - y0) * 0.4 && hy < y1) return y >= hy - 0.06 && y <= hy + Math.max(0.3, (hy - y0) * 0.25);
  }
  return y >= y1 - (y1 - y0) * 0.25;
}
const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _ta = new THREE.Vector3(), _ts = new THREE.Vector3(), _tn = new THREE.Vector3();

// tracer streak: hot head at x = 1, fading tail toward x = 0, soft across y
function streakTexture() {
  const W = 128, H = 32, c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');
  const img = g.createImageData(W, H);
  for (let y = 0; y < H; y++) {
    const v = (y + 0.5) / H * 2 - 1;
    for (let x = 0; x < W; x++) {
      const u = x / (W - 1);
      // narrows toward the tail; the head end is rounded off
      const w = 0.25 + 0.75 * u;
      const across = Math.exp(-(v * v) / (w * w * 0.18));
      const along = Math.pow(u, 1.6) * Math.min(1, (1 - u) * 14 + 0.2);
      const k = Math.min(1, across * along * 1.3);
      const o = (y * W + x) * 4;
      img.data[o] = img.data[o + 1] = img.data[o + 2] = k * 255; img.data[o + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}

function glowTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255,255,255,1)');
  gr.addColorStop(0.2, 'rgba(255,255,255,0.85)');
  gr.addColorStop(0.5, 'rgba(255,255,255,0.2)');
  gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr;
  g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

// the mark of a hostile shot: a dark core inside a bright ring with four barbs.
// Tinted by the element, drawn normally blended, so an enemy bolt reads as
// something to dodge even in the colours of a wizard's own magic
function hostileTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  gr.addColorStop(0, 'rgba(0,0,0,0.55)');
  gr.addColorStop(0.36, 'rgba(0,0,0,0.65)');
  gr.addColorStop(0.44, 'rgba(255,255,255,1)');
  gr.addColorStop(0.52, 'rgba(255,255,255,0.9)');
  gr.addColorStop(0.62, 'rgba(255,255,255,0.25)');
  gr.addColorStop(0.75, 'rgba(255,255,255,0)');
  g.fillStyle = gr;
  g.fillRect(0, 0, 128, 128);
  g.fillStyle = 'rgba(255,255,255,0.95)';
  for (let k = 0; k < 4; k++) {
    const a = k * Math.PI / 2 + Math.PI / 4;
    g.beginPath();
    g.moveTo(64 + Math.cos(a) * 34, 64 + Math.sin(a) * 34);
    g.lineTo(64 + Math.cos(a + 0.22) * 46, 64 + Math.sin(a + 0.22) * 46);
    g.lineTo(64 + Math.cos(a) * 60, 64 + Math.sin(a) * 60);
    g.lineTo(64 + Math.cos(a - 0.22) * 46, 64 + Math.sin(a - 0.22) * 46);
    g.closePath(); g.fill();
  }
  return new THREE.CanvasTexture(c);
}

// emissive map for meteors: black crust with glowing fissures
function magmaTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#000'; g.fillRect(0, 0, 128, 128);
  g.strokeStyle = '#ff9a40'; g.lineCap = 'round';
  for (let i = 0; i < 26; i++) {
    let x = Math.random() * 128, y = Math.random() * 128;
    g.lineWidth = 1 + Math.random() * 2.5;
    g.beginPath(); g.moveTo(x, y);
    for (let k = 0; k < 5; k++) { x += (Math.random() - 0.5) * 30; y += (Math.random() - 0.5) * 30; g.lineTo(x, y); }
    g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const _hp = { x: 0, z: 0 };
const _wp = new THREE.Vector3();
// Arrows that miss stay where they land: stuck in the wall or the floor, quivering a moment, gone after a
// few seconds. A pool of 24 in one instanced mesh of the arrow (count kept at one zero-sized arrow, so its
// program compiles with the level's).
const ARROWS = 24, ARROW_LIFE = 6, _aq = new THREE.Quaternion(), _aw = new THREE.Quaternion(), _ap = new THREE.Vector3(), _ad = new THREE.Vector3(), _as = new THREE.Vector3(), _am = new THREE.Matrix4(), _az = new THREE.Vector3(0, 0, 1);
// what a shot leaves on the wall it strikes, by element (and how big): scorched, rimed or cracked stone
const WALL_MARK = { fire: ['scorch', 1.3], enemyFire: ['scorch', 1.1], lightning: ['scorch', 0.8], frost: ['frost', 1.2], earth: ['crack', 1.1], physical: ['crack', 0.8] };
const _wmP = new THREE.Vector3();

class StuckArrows {
  constructor(def) {
    this.mesh = new THREE.InstancedMesh(def.geo, def.mat, ARROWS);
    this.mesh.frustumCulled = false;
    this.mesh.name = 'stuckArrows';
    _am.makeScale(0, 0, 0);
    for (let i = 0; i < ARROWS; i++) this.mesh.setMatrixAt(i, _am);
    this.mesh.count = 1;
    this.tip = new Float32Array(ARROWS * 3); this.q = new Float32Array(ARROWS * 4); this.ax = new Float32Array(ARROWS * 3);
    this.age = new Float32Array(ARROWS).fill(ARROW_LIFE + 1);
    this.next = 0; this.live = 0;
  }
  // stuck at pos, having flown along dir: its head buried a hand's width in
  add(pos, dir) {
    const i = this.next; this.next = (this.next + 1) % ARROWS;
    _ad.copy(dir).normalize();
    if (_ad.lengthSq() < 0.5) return;
    this.tip[i * 3] = pos.x + _ad.x * 0.18; this.tip[i * 3 + 1] = pos.y + _ad.y * 0.18; this.tip[i * 3 + 2] = pos.z + _ad.z * 0.18;
    _aq.setFromUnitVectors(_az, _ad);
    this.q[i * 4] = _aq.x; this.q[i * 4 + 1] = _aq.y; this.q[i * 4 + 2] = _aq.z; this.q[i * 4 + 3] = _aq.w;
    // it quivers about an axis across its shaft
    _ap.set(-_ad.z, 0, _ad.x); if (_ap.lengthSq() < 1e-4) _ap.set(1, 0, 0);
    _ap.normalize(); this.ax[i * 3] = _ap.x; this.ax[i * 3 + 1] = _ap.y; this.ax[i * 3 + 2] = _ap.z;
    this.age[i] = 0;
    this.live = ARROW_LIFE + 0.5;
  }
  update(dt) {
    if (this.live <= -0.5) return;
    this.live -= dt;
    let top = 0;
    for (let i = 0; i < ARROWS; i++) {
      const age = (this.age[i] += dt);
      if (age > ARROW_LIFE) { if (age - dt <= ARROW_LIFE) { _am.makeScale(0, 0, 0); this.mesh.setMatrixAt(i, _am); } continue; }
      top = i + 1;
      // (settled and not yet fading: its matrix stands)
      if (age > 0.45 && age < ARROW_LIFE - 0.6) continue;
      const wob = Math.sin(age * 48) * Math.exp(-age * 9) * 0.22;
      _aw.setFromAxisAngle(_ap.set(this.ax[i * 3], this.ax[i * 3 + 1], this.ax[i * 3 + 2]), wob);
      _aq.set(this.q[i * 4], this.q[i * 4 + 1], this.q[i * 4 + 2], this.q[i * 4 + 3]).premultiply(_aw);
      // pivoting on its buried head; drawn back out as it fades
      const f = age > ARROW_LIFE - 0.6 ? (ARROW_LIFE - age) / 0.6 : 1;
      _ad.copy(_az).applyQuaternion(_aq);
      _ap.set(this.tip[i * 3], this.tip[i * 3 + 1], this.tip[i * 3 + 2]).addScaledVector(_ad, -0.4 * f);
      _as.setScalar(f);
      _am.compose(_ap, _aq, _as);
      this.mesh.setMatrixAt(i, _am);
    }
    this.mesh.count = Math.max(1, top);
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}

export class SpellRuntime {
  constructor(game) {
    this.g = game;
    this._eye = { x: 0, y: 0, z: 0, open: true }; // (an area's centre, as _seeFrom last set it)
    this.projectiles = [];
    this.zones = [];
    this.timers = [];
    // the spell slot whose code is running (set by the caster around a cast): every projectile, zone and
    // timer made meanwhile keeps it and restores it around its own callbacks, so damage dealt
    // seconds later still knows its spell (Player.dmgBy, the run summary's breakdown)
    this.slot = null;
    this.nextId = 1;
    this.glowTex = glowTexture();
    this.hostileTex = hostileTexture();
    this.hostileMats = new Map();
    this.spriteMats = new Map();
    this.meshCache = {};
    this.arrows = null; // (missed arrows stuck in walls and floors: StuckArrows)
    this._wmT = -1; // (the last wall mark: see _wallMark)
    this._buildMeshes();
    // (the stuck-arrow pool lives in the scene for good, from before the first prewarm, so its program
    // compiles with the level's and the prewarm's sweep of what it added leaves it be)
    this.arrows = new StuckArrows(this.meshCache.arrow);
    game.scene.add(this.arrows.mesh);
    // fast projectiles draw a streak along their path so they read in flight
    this.tracerGeo = new THREE.PlaneGeometry(1, 1).translate(-0.5, 0, 0);
    this.tracerTex = streakTexture();
    this.tracerMats = new Map();
    this.orbTime = { value: 0 };
    // every element's materials exist up front: nothing is created at cast time
    for (const el of Object.keys(FX)) { this._spriteMat(el); this._orbMat(el); this._tracerMat(el); }
  }

  // one of each projectile visual (core sprite, orb, tracer, every mesh), for
  // shader prewarming: materials differ per element only by colour, so one each
  // compiles them all
  warmObjects() {
    const out = [new THREE.Sprite(this._spriteMat('arcane')), new THREE.Sprite(this._hostileMat('enemy')), new THREE.Mesh(this.tracerGeo, this._tracerMat('arcane'))];
    for (const def of Object.values(this.meshCache)) out.push(new THREE.Mesh(def.geo, def.mat ?? this._orbMat('arcane')));
    return out;
  }

  _tracerMat(el) {
    if (this.tracerMats.has(el)) return this.tracerMats.get(el);
    const fx = fxOf(el);
    const c = clampHDR([fx.mid[0] * 0.5 + fx.core[0] * 0.4, fx.mid[1] * 0.5 + fx.core[1] * 0.4, fx.mid[2] * 0.5 + fx.core[2] * 0.4], 1.3);
    const m = nearFade(new THREE.MeshBasicMaterial({ map: this.tracerTex, color: new THREE.Color(c[0], c[1], c[2]), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, side: THREE.DoubleSide, fog: false }));
    this.tracerMats.set(el, m);
    return m;
  }

  _buildMeshes() {
    const M = this.meshCache;
    const shard = new THREE.OctahedronGeometry(0.12, 0);
    shard.scale(0.7, 0.7, 3.2);
    M.shard = { geo: shard, mat: new THREE.MeshStandardMaterial({ color: 0xbfefff, emissive: 0x4ab8ff, emissiveIntensity: 1.6, roughness: 0.1, metalness: 0.1, transparent: true, opacity: 0.9 }) };
    // venom thorn: a long barbed spine, dark green with a sickly glow
    const thorn = new THREE.ConeGeometry(0.05, 0.75, 5, 1);
    thorn.rotateX(Math.PI / 2);
    M.thorn = { geo: thorn, mat: new THREE.MeshStandardMaterial({ color: 0x3a4a14, emissive: 0x6aa020, emissiveIntensity: 0.9, roughness: 0.5, flatShading: true }) };
    const big = new THREE.OctahedronGeometry(0.3, 0);
    big.scale(0.8, 0.8, 4);
    M.bigShard = { geo: big, mat: M.shard.mat };
    const rock = new THREE.DodecahedronGeometry(0.22, 0);
    const magma = magmaTexture();
    M.rock = { geo: rock, mat: new THREE.MeshStandardMaterial({ color: 0x6a5a48, roughness: 0.95, emissive: 0x803810, emissiveIntensity: 1.0, emissiveMap: magma, flatShading: true }) };
    const meteor = new THREE.DodecahedronGeometry(0.9, 1);
    // charred rock glowing from within: dark faces, hot cracks via the emissive map
    M.meteor = { geo: meteor, mat: new THREE.MeshStandardMaterial({ color: 0x1a1210, roughness: 1, emissive: 0xff5010, emissiveIntensity: 2.2, emissiveMap: magma, flatShading: true }) };
    const boulder = new THREE.DodecahedronGeometry(2.2, 1);
    // cracked stone glowing from the heat of its fall
    M.boulder = { geo: boulder, mat: new THREE.MeshStandardMaterial({ color: 0x4a3e32, roughness: 1, emissive: 0xc05010, emissiveIntensity: 1.3, emissiveMap: magma, flatShading: true }) };
    const spear = new THREE.ConeGeometry(0.07, 1.4, 6);
    spear.rotateX(Math.PI / 2);
    M.spear = { geo: spear, mat: new THREE.MeshStandardMaterial({ color: 0xe8e0c8, roughness: 0.6, emissive: 0x204010, emissiveIntensity: 0.6 }) };
    const blade = new THREE.BoxGeometry(0.06, 0.012, 1.1);
    blade.translate(0, 0, 0.2);
    M.blade = { geo: blade, mat: nearFade(new THREE.MeshBasicMaterial({ color: new THREE.Color(0.5, 1.1, 1.8), transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false })) };
    // an arrow, head first along +z (the way it flies): a shaft, an iron head and three vanes of fletching
    const ab = new GeoBuilder(), am = new THREE.Matrix4();
    ab.addGeometry(new THREE.CylinderGeometry(0.013, 0.013, 0.74, 5).rotateX(Math.PI / 2), am.makeTranslation(0, 0, -0.03));
    ab.addGeometry(new THREE.ConeGeometry(0.028, 0.11, 4).rotateX(Math.PI / 2), am.makeTranslation(0, 0, 0.39));
    for (let k = 0; k < 3; k++) {
      const a = k / 3 * Math.PI * 2;
      ab.addGeometry(new THREE.BoxGeometry(0.003, 0.045, 0.13).translate(0, 0.03, 0).rotateZ(a), am.makeTranslation(0, 0, -0.32));
    }
    M.arrow = { geo: ab.build(), mat: new THREE.MeshStandardMaterial({ color: 0x4a3018, roughness: 0.8 }) };
    // wind blade: a thicker crescent tapered toward the horns, bulging forward
    const cres = new THREE.TorusGeometry(0.62, 0.075, 6, 24, Math.PI * 0.9);
    {
      const pa = cres.getAttribute('position');
      for (let i = 0; i < pa.count; i++) {
        const x = pa.getX(i), y = pa.getY(i), z = pa.getZ(i);
        const a = Math.atan2(y, x) / (Math.PI * 0.9); // 0..1 along the arc
        const taper = 0.25 + 0.75 * Math.sin(Math.min(1, Math.max(0, a)) * Math.PI);
        const r = Math.hypot(x, y), ring = 0.62;
        const k = ring + (r - ring) * taper;
        pa.setXYZ(i, x / r * k, y / r * k, z * taper * 0.8);
      }
      cres.computeVertexNormals();
    }
    cres.rotateZ(-Math.PI * 0.45);
    cres.rotateX(Math.PI / 2);
    cres.rotateY(-Math.PI / 2);
    // canted, so from behind it reads as a curved blade rather than a flat bar
    cres.rotateZ(0.55);
    // (fades hard near the lens: leaving the hand it was a white bar across the view)
    M.crescent = { geo: cres, mat: nearFade(new THREE.MeshBasicMaterial({ color: new THREE.Color(0.8, 1.2, 1.15), transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }), new THREE.Vector4(0.8, 7.0, 0.12, 0.45)) };
    const orb = new THREE.SphereGeometry(0.25, 16, 12);
    M.orb = { geo: orb, mat: null }; // per element basic material
    const flask = new THREE.SphereGeometry(0.12, 10, 8);
    M.flask = { geo: flask, mat: new THREE.MeshStandardMaterial({ color: 0x80c020, emissive: 0x406010, emissiveIntensity: 1.2, roughness: 0.1, transparent: true, opacity: 0.85 }) };
    this.orbMats = new Map();
  }

  _spriteMat(el) {
    if (this.spriteMats.has(el)) return this.spriteMats.get(el);
    const fx = fxOf(el);
    // core glow: brightest channel capped at ~1.4 and dimmed/shrunk near the lens
    const c = clampHDR([fx.core[0] * 0.75, fx.core[1] * 0.75, fx.core[2] * 0.75], 1.4);
    const m = nearFade(new THREE.SpriteMaterial({ map: this.glowTex, color: new THREE.Color(c[0], c[1], c[2]), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: false }));
    this.spriteMats.set(el, m);
    return m;
  }
  _hostileMat(el) {
    if (this.hostileMats.has(el)) return this.hostileMats.get(el);
    const fx = fxOf(el);
    const c = clampHDR([fx.mid[0] * 1.2, fx.mid[1] * 1.2, fx.mid[2] * 1.2], 1.6);
    // (same program as the core sprites: only the blending differs)
    const m = nearFade(new THREE.SpriteMaterial({ map: this.hostileTex, color: new THREE.Color(c[0], c[1], c[2]), depthWrite: false, transparent: true, fog: false }));
    this.hostileMats.set(el, m);
    return m;
  }
  _orbMat(el) {
    if (this.orbMats.has(el)) return this.orbMats.get(el);
    // churning element-coloured ball (shared program, see orbMaterial)
    const m = orbMaterial(fxOf(el), this.orbTime, el === 'fire' || el === 'enemyFire' ? 0 : 0.8);
    this.orbMats.set(el, m);
    return m;
  }

  // -------------------------------------------------------------- projectiles
  // p: { local, faction:'player'|'enemy', owner, el, pos, vel, radius, life, gravity, pierce, bounce,
  //      homing, hit:{dmg, st, kb, tag}, aoe:{radius,dmg,st}, onHit, onExpire, onTick, mesh, core, trail, light, spin }
  spawn(p) {
    const proj = {
      id: this.nextId++,
      slot: this.slot,
      local: p.local ?? true,
      faction: p.faction ?? 'player',
      owner: p.owner ?? 0,
      el: p.el ?? 'arcane',
      pos: p.pos.clone(),
      prev: p.pos.clone(),
      vel: p.vel.clone(),
      radius: p.radius ?? 0.25,
      life: p.life ?? 3,
      age: 0,
      gravity: p.gravity ?? 0,
      drag: p.drag ?? 0,
      pierce: p.pierce ?? 0,
      bounce: p.bounce ?? 0,
      homing: p.homing ?? 0,
      homingRange: p.homingRange ?? 18,
      homeOn: p.homeOn, // (an enemy shot homes only on the wizard it was loosed at)
      hit: p.hit ?? null,
      aoe: p.aoe ?? null,
      onHit: p.onHit,
      onExpire: p.onExpire,
      onTick: p.onTick,
      onWall: p.onWall,
      hitIds: new Set(),
      trail: p.trail ?? 1,
      lightI: p.light ?? 6,
      sticky: p.sticky ?? false,
      hostile: null,
      warned: false,
      stuck: false,
      dead: false,
      data: p.data ?? {},
      hitPlayers: p.hitPlayers ?? true,
      noWall: p.noWall ?? false,
      meshKind: p.mesh ?? null,
    };
    const fx = fxOf(proj.el);
    proj.lightColor = fx.light;
    // visual
    const group = new THREE.Group();
    group.position.copy(proj.pos);
    // big cores right at the muzzle blew the screen out: cap them (the light,
    // trail and mesh carry the size of heavier spells)
    // a teammate's shots are drawn quieter than your own and the enemy's: the fight stays readable
    const ally = proj.faction === 'player' && !proj.local;
    if (ally) { proj.trail *= 0.6; proj.lightI *= 0.5; }
    const coreSize = Math.min(p.core ?? 0.6, 0.85) * (ally ? 0.7 : 1);
    if (coreSize > 0) {
      const s = new THREE.Sprite(this._spriteMat(proj.el));
      s.scale.setScalar(coreSize);
      group.add(s);
      proj.sprite = s;
    }
    if (proj.faction === 'enemy' || proj.el.startsWith('enemy')) {
      const s = new THREE.Sprite(this._hostileMat(proj.el.startsWith('enemy') ? proj.el : 'enemy'));
      s.scale.setScalar(p.mesh === 'arrow' ? 0.42 : Math.max(0.55, coreSize * 1.5));
      s.renderOrder = -1; // (under the shot's own glow: the dark core rims it, never dims it)
      group.add(s);
      proj.hostile = s;
    }
    if (p.mesh) {
      const def = this.meshCache[p.mesh];
      const mesh = new THREE.Mesh(def.geo, def.mat ?? this._orbMat(proj.el));
      if (p.meshScale) mesh.scale.setScalar(p.meshScale);
      if (p.mesh === 'orb' || p.mesh === 'crescent') { proj.orbS = p.meshScale ?? 1; mesh.scale.setScalar(proj.orbS * 0.3); }
      group.add(mesh);
      proj.mesh = mesh;
      proj.spin = p.spin ?? (p.mesh === 'rock' || p.mesh === 'meteor' || p.mesh === 'boulder' ? 6 : 0);
    }
    if (p.tracer !== false && proj.vel.length() >= 18) {
      const t = new THREE.Mesh(this.tracerGeo, this._tracerMat(proj.el));
      t.matrixAutoUpdate = false;
      t.frustumCulled = false;
      t.visible = false;
      group.add(t);
      proj.tracer = t;
      proj.tracerW = Math.max(0.09, coreSize * 0.34) * (p.tracerW ?? 1);
    }
    this.g.scene.add(group);
    proj.group = group;
    this.projectiles.push(proj);
    return proj;
  }

  kill(proj, pos, hitActor = null) {
    if (proj.dead) return;
    proj.dead = true;
    if (proj.aoe) this.explode(proj, pos ?? proj.pos);
    proj.onExpire?.(proj, pos ?? proj.pos, hitActor);
  }

  explode(proj, pos) {
    const a = proj.aoe;
    const wet = this.g.waterAt(pos.x, pos.z), gy = this.g.groundY(pos.x, pos.z);
    if (a.vfx !== false) this.g.vfx.explosion(pos, a.el ?? proj.el, a.radius, { groundY: wet ? Math.max(gy, WATER_Y) : gy });
    if (a.sound !== false) this.g.audio?.play(a.radius > 3 ? 'explosion_big' : 'explosion', { pos });
    this.g.rattleHangers(pos, a.radius * 1.8 + 1.5, Math.min(1.5, 0.4 + a.radius * 0.25)); // (cages and chains overhead swing)
    if (wet && pos.y < WATER_Y + 1.2) this.g.splash(pos.x, pos.z, Math.min(3, 1 + a.radius * 0.4)); // (a blast on the water throws it up)
    if (proj.local) {
      if (proj.faction === 'player') {
        this.damageArea(pos, a.radius, { dmg: a.dmg, el: a.el ?? proj.el, st: a.st, kb: a.kb ?? 4, tag: a.tag, src: proj.owner }, proj.hitIds, a.excludeDirect ? proj.hitIds : null);
      }
    }
    if (proj.faction === 'enemy') this.g.enemyAreaHit?.(pos, a.radius, a.dmg, a.el ?? proj.el, a.st);
  }

  // damage all hostile actors in radius (from a local player)
  damageArea(pos, radius, H, _hitIds, exclude) {
    const hits = [];
    pos = new THREE.Vector3(pos.x, pos.y, pos.z);
    this.g.smashAt?.(pos, radius * 0.8);
    this._seeFrom(pos);
    for (const a of this.g.actors.hostiles()) {
      if (exclude && exclude.has(a.id)) continue;
      const c = hitPoint(a, pos.x, pos.z, _hp); // (a blast reaches a long body's nearest part)
      const dx = c.x - pos.x, dz = c.z - pos.z;
      const dy = (a.pos.y + a.height * 0.5) - pos.y;
      const r = radius + a.hitR;
      if (dx * dx + dz * dz > r * r || Math.abs(dy) > radius + a.hitH * 0.6) continue;
      if (!this._sees(a, c)) continue;
      const d = Math.sqrt(dx * dx + dz * dz);
      const fall = H.falloff ? Math.max(0.4, 1 - d / r) : 1;
      this.g.hitActor(a, { ...H, dmg: H.dmg * fall, kbDir: d > 0.01 ? [dx / d, dz / d] : [0, 1] }, new THREE.Vector3(a.pos.x, a.pos.y + a.height * 0.5, a.pos.z));
      hits.push(a);
    }
    return hits;
  }

  update(dt) {
    const g = this.g;
    const col = g.collision;
    this.orbTime.value = g.time;
    this.arrows?.update(dt);
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i];
      if (p.dead) { this._remove(i); continue; }
      this.slot = p.slot;
      p.age += dt;
      if (p.age >= p.life) { this.kill(p, p.pos); this._remove(i); continue; }
      p.onTick?.(p, dt);
      if (p.dead) { this._remove(i); continue; }
      if (p.stuck) {
        p.group.position.copy(p.pos);
        this._visual(p, dt);
        continue;
      }
      // homing
      if (p.homing > 0 && p.faction === 'player') {
        let best = null, bd = p.homingRange * p.homingRange;
        const sp = p.vel.length();
        _v.copy(p.vel).normalize();
        for (const a of g.actors.hostiles()) {
          if (p.hitIds.has(a.id)) continue;
          _v2.set(a.pos.x - p.pos.x, a.pos.y + a.height * 0.55 - p.pos.y, a.pos.z - p.pos.z);
          const d2 = _v2.lengthSq();
          if (d2 > bd) continue;
          if (_v2.normalize().dot(_v) < 0.2) continue;
          bd = d2; best = a;
        }
        if (best) {
          _v2.set(best.pos.x - p.pos.x, best.pos.y + best.height * 0.55 - p.pos.y, best.pos.z - p.pos.z).normalize().multiplyScalar(sp);
          p.vel.lerp(_v2, Math.min(1, p.homing * dt));
          p.vel.setLength(sp);
        }
      } else if (p.homing > 0 && p.faction === 'enemy' && g.player && !g.player.dead && p.age < 1.6 && (p.homeOn === undefined || p.homeOn === g.player.id)) {
        // Fair homing: it bends only toward the wizard it was loosed at (a shot at a teammate
        // never swerves onto you), only while they are ahead of it, never in its last 5 m (a late sidestep or
        // dash beats it), and only for its first 1.6 s
        _v2.set(g.player.pos.x - p.pos.x, g.player.pos.y + 1.2 - p.pos.y, g.player.pos.z - p.pos.z);
        const d = _v2.length();
        if (d > 5) {
          const sp = p.vel.length();
          _v2.divideScalar(d);
          if (_v2.dot(_v.copy(p.vel).divideScalar(sp || 1)) > 0.5) { // (within 60 deg: a boss's fanned orbs still curve in)
            p.vel.lerp(_v2.multiplyScalar(sp), Math.min(1, p.homing * dt));
            p.vel.setLength(sp);
          }
        }
      }
      if (p.gravity) p.vel.y -= p.gravity * dt;
      if (p.drag) p.vel.multiplyScalar(Math.exp(-p.drag * dt));
      p.prev.copy(p.pos);
      // substeps against walls
      const dist = p.vel.length() * dt;
      const steps = Math.max(1, Math.ceil(dist / 0.3));
      let wallHit = false;
      for (let s = 0; s < steps; s++) {
        p.pos.addScaledVector(p.vel, dt / steps);
        if (!p.noWall && col.pointSolid(p.pos.x, p.pos.y, p.pos.z)) {
          if (p.bounce > 0) {
            p.bounce--;
            // determine reflection normal by probing axes
            const px = p.pos.x - p.vel.x * dt / steps, pz = p.pos.z - p.vel.z * dt / steps, py = p.pos.y - p.vel.y * dt / steps;
            if (col.pointSolid(p.pos.x, py, pz)) p.vel.x *= -1;
            if (col.pointSolid(px, py, p.pos.z)) p.vel.z *= -1;
            if (col.pointSolid(px, p.pos.y, pz)) p.vel.y *= -0.6;
            p.pos.set(px, py, pz);
            g.vfx.impact(p.pos, p.el, 0.5);
            p.hitIds.clear();
            continue;
          }
          if (p.sticky) {
            p.pos.set(p.pos.x - p.vel.x * dt / steps, Math.max(g.groundY(p.pos.x, p.pos.z) + 0.15, p.pos.y - p.vel.y * dt / steps), p.pos.z - p.vel.z * dt / steps);
            p.stuck = true; p.vel.set(0, 0, 0);
            break;
          }
          wallHit = true;
          break;
        }
      }
      // step back slightly so effects spawn in front of the wall; actors along
      // the path up to the wall are still tested below before the wall impact
      if (wallHit) p.pos.addScaledVector(p.vel, -0.02 / Math.max(0.01, p.vel.length()));
      // actor collisions
      if (p.faction === 'player') {
        if (p.local && g.level.breakables.length) {
          const hitB = g.breakablesNear(p.pos, p.radius);
          if (hitB.length) {
            for (const b of hitB) g.breakProp(b.i, true);
            if (p.pierce <= 0 && !p.noWall) { g.vfx.impact(p.pos, p.el, 0.7); this.kill(p, p.pos); this._remove(i); continue; }
          }
        }
        for (const a of g.actors.hostiles()) {
          if (p.hitIds.has(a.id)) continue;
          const r = p.radius + a.hitR;
          const ay0 = a.pos.y + a.hitY0, ay1 = a.pos.y + a.hitH;
          // closest distance between the projectile's path and the actor's hit capsule
          // (its axis point nearest the projectile, at the projectile's height)
          const midY = Math.max(ay0, Math.min(ay1, p.pos.y));
          const c = hitPoint(a, p.pos.x, p.pos.z, _hp);
          const d2 = segPointDist2(p.prev.x, p.prev.y, p.prev.z, p.pos.x, p.pos.y, p.pos.z, c.x, midY, c.z);
          if (d2 > r * r) continue;
          if (p.pos.y < ay0 - p.radius - 0.2 || p.pos.y > ay1 + p.radius + 0.2) continue;
          p.hitIds.add(a.id);
          const hp = new THREE.Vector3(c.x, Math.max(ay0 + 0.3, Math.min(ay1 - 0.2, p.pos.y)), c.z);
          if (p.hit && p.local) {
            const vlen = p.vel.length() || 1;
            const weak = isWeak(a, c.x, p.pos.y, c.z);
            g.hitActor(a, { ...p.hit, src: p.owner, kbDir: [p.vel.x / vlen, p.vel.z / vlen], weak, dmg: p.hit.dmg * (weak ? WEAK_MULT : 1) }, hp);
          }
          p.onHit?.(p, a, hp);
          if (!p.aoe || p.pierce > 0) g.vfx.impact(hp, p.el, 0.7);
          if (p.pierce > 0) { p.pierce--; continue; }
          this.kill(p, hp, a);
          break;
        }
        if (p.dead) { this._remove(i); continue; }
      } else if (p.faction === 'enemy' && p.hitPlayers) {
        // enemy projectiles: each peer checks only its own player
        const pl = g.player;
        if (pl && pl.alive && !pl.downed) {
          const d2 = segPointDist2(p.prev.x, p.prev.y, p.prev.z, p.pos.x, p.pos.y, p.pos.z, pl.pos.x, Math.max(pl.pos.y + 0.3, Math.min(pl.pos.y + 1.6, p.pos.y)), pl.pos.z);
          const r = p.radius + 0.4;
          if (d2 < r * r) {
            if (pl.tryParry?.(p)) { this._remove(i); continue; }
            if (p.hit) pl.takeDamage(p.hit.dmg, p.el, p.pos, p.hit);
            p.onHit?.(p, null, p.pos);
            g.vfx.impact(p.pos, p.el, 0.8);
            this.kill(p, p.pos);
            this._remove(i);
            continue;
          }
        }
        // host: enemy projectiles vs allied minions
        if (g.isHost) {
          for (const a of g.actors.allies()) {
            const r = p.radius + a.radius;
            const dx = a.pos.x - p.pos.x, dz = a.pos.z - p.pos.z;
            if (dx * dx + dz * dz < r * r && p.pos.y > a.pos.y && p.pos.y < a.pos.y + a.height) {
              if (p.hit) g.actors.damage(a, { dmg: p.hit.dmg, el: p.el });
              g.vfx.impact(p.pos, p.el, 0.7);
              this.kill(p, p.pos);
              break;
            }
          }
          if (p.dead) { this._remove(i); continue; }
        }
      }
      if (wallHit) {
        if (p.meshKind === 'arrow') this.arrows?.add(p.pos, p.vel);
        else this._wallMark(p);
        if (p.onWall) p.onWall(p, p.pos);
        g.encounters?.wallHit(p); // secret walls crack under spells
        if (!p.aoe) g.vfx.impact(p.pos, p.el, 0.8);
        g.audio?.play('impact_' + soundEl(p.el), { pos: p.pos, volume: 0.6 });
        this.kill(p, p.pos);
        this._remove(i);
        continue;
      }
      // floor hit for arcing projectiles (over a channel, the water's surface: it splashes)
      const wet = g.waterAt(p.pos.x, p.pos.z), gy = wet ? Math.max(WATER_Y, g.groundY(p.pos.x, p.pos.z)) : g.groundY(p.pos.x, p.pos.z);
      if (p.pos.y < gy + 0.05 && !p.noWall) {
        p.pos.y = gy + 0.05;
        if (wet && !p.sticky) g.splash(p.pos.x, p.pos.z, p.aoe ? 0.6 : 0.8);
        if (p.sticky) { p.stuck = true; p.vel.set(0, 0, 0); }
        else if (p.bounce > 0) { p.bounce--; p.vel.y = Math.abs(p.vel.y) * 0.5; }
        else {
          if (p.meshKind === 'arrow' && !wet) this.arrows?.add(p.pos, p.vel);
          p.onWall?.(p, p.pos);
          if (!p.aoe) g.vfx.impact(p.pos, p.el, 0.8);
          this.kill(p, p.pos);
          this._remove(i);
          continue;
        }
      }
      p.group.position.copy(p.pos);
      this._visual(p, dt);
    }
    // zones
    for (let i = this.zones.length - 1; i >= 0; i--) {
      const z = this.zones[i];
      this.slot = z.slot;
      z.age += dt;
      z.acc += dt;
      z.visual?.(z, dt);
      while (z.acc >= z.interval) {
        z.acc -= z.interval;
        z.onTick?.(z);
      }
      if (z.age >= z.life) {
        z.onEnd?.(z);
        this.zones.splice(i, 1);
      }
    }
    // timers
    for (let i = this.timers.length - 1; i >= 0; i--) {
      const t = this.timers[i];
      t.t -= dt;
      if (t.t <= 0) {
        this.timers.splice(i, 1);
        this.slot = t.slot;
        t.fn();
      }
    }
    this.slot = null;
  }

  _visual(p, dt) {
    const g = this.g;
    if (p.trail > 0) g.vfx.trail(p.pos, p.vel, p.el, p.trail, dt);
    if (p.mesh) {
      // spell orbs swell out of the hand over their first instant instead of
      // appearing full size right in front of the lens
      if (p.orbS && p.age < 0.14) p.mesh.scale.setScalar(p.orbS * (0.3 + 0.7 * p.age / 0.14));
      else if (p.orbS) { p.mesh.scale.setScalar(p.orbS); p.orbS = 0; }
      if (p.spin) { p.mesh.rotation.x += p.spin * dt; p.mesh.rotation.y += p.spin * 0.7 * dt; }
      else if (p.vel.lengthSq() > 0.01) p.mesh.lookAt(_v.copy(p.pos).add(p.vel));
    }
    if (p.sprite) p.sprite.material.rotation += dt;
    if (p.hostile) p.hostile.material.rotation -= dt * 1.5;
    if (p.tracer) this._tracer(p);
    if (p.lightI > 0) g.lights.request(p.pos, p.lightColor, p.lightI, 7);
  }

  // stretch the streak back along the velocity (never past where the shot
  // started) and turn its face toward the camera around that axis
  _tracer(p) {
    const t = p.tracer;
    const speed = p.vel.length();
    const len = Math.min(speed * 0.045, 2.2, p.age * speed);
    if (speed < 4 || len < 0.05) { t.visible = false; return; }
    t.visible = true;
    _ta.copy(p.vel).divideScalar(speed);
    _tn.copy(this.g.renderer.camera.position).sub(p.pos);
    _ts.crossVectors(_ta, _tn);
    if (_ts.lengthSq() < 1e-8) { t.visible = false; return; }
    _ts.normalize();
    _tn.crossVectors(_ts, _ta);
    const w = p.tracerW;
    t.matrix.set(
      _ta.x * len, _ts.x * w, _tn.x, 0,
      _ta.y * len, _ts.y * w, _tn.y, 0,
      _ta.z * len, _ts.z * w, _tn.z, 0,
      0, 0, 0, 1);
    t.matrixWorldNeedsUpdate = true;
  }

  // the mark a shot leaves where it struck a wall (on the wall's face: the cells are 2 m, faces on their
  // edges); none on a pillar or prop, and a few a second at most however fast the volley
  _wallMark(p) {
    const mk = WALL_MARK[p.el], g = this.g;
    if (!mk || g.time - this._wmT < 0.12) return;
    const v = p.vel, l = v.length();
    if (l < 1) return;
    const ix = p.pos.x + v.x / l * 0.15, iz = p.pos.z + v.z / l * 0.15, cx = Math.floor(ix / 2), cz = Math.floor(iz / 2);
    if (!g.collision.cellBlocked(cx, cz, p.pos.y)) return;
    const bx = ix - v.x / l * 0.5, bz = iz - v.z / l * 0.5;
    let nx = 0, nz = 0, sx = p.pos.x, sz = p.pos.z;
    if (Math.floor(bx / 2) !== cx) { nx = v.x > 0 ? -1 : 1; sx = (cx + (nx > 0 ? 1 : 0)) * 2; }
    else if (Math.floor(bz / 2) !== cz) { nz = v.z > 0 ? -1 : 1; sz = (cz + (nz > 0 ? 1 : 0)) * 2; }
    else return;
    this._wmT = g.time;
    g.vfx.wallDecal(_wmP.set(sx, Math.max(p.pos.y, g.groundY(sx + nx * 0.5, sz + nz * 0.5) + 0.35), sz), nx, nz, mk[0], mk[1] * (0.8 + Math.random() * 0.4), 9);
  }

  _remove(i) {
    const p = this.projectiles[i];
    this.g.scene.remove(p.group);
    this.projectiles.splice(i, 1);
  }

  // -------------------------------------------------------------- zones & timers
  zone(z) {
    const zone = { age: 0, acc: 0, interval: 0.25, life: 3, slot: this.slot, ...z };
    this.zones.push(zone);
    return zone;
  }
  after(t, fn) { this.timers.push({ t, fn, slot: this.slot }); }

  clear() {
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i];
      p.local = false; p.aoe = null;
      try { p.onExpire?.(p, p.pos); } catch { /* ignore */ }
      this._remove(i);
    }
    for (const z of this.zones) { z.local = false; z.dmg = 0; z.healAllies = 0; try { z.onEnd?.(z); } catch { /* ignore */ } }
    this.zones.length = 0;
    this.timers.length = 0;
  }

  // -------------------------------------------------------------- queries
  // hostile actors hit by a ray, sorted by distance (stops at walls)
  // The first foe along a ray (the crosshair's probe, every few frames: allocation-free, same capsule
  // test as rayActors): returns it and writes where the ray meets it into out, or null.
  firstActor(ox, oy, oz, dx, dy, dz, maxDist, radius, out) {
    const g = this.g;
    const wall = g.collision.raycast(ox, oy, oz, dx, dy, dz, maxDist, 0.2);
    const hl = Math.hypot(dx, dz) || 1e-6;
    let best = wall, hit = null;
    for (const a of g.actors.hostiles()) {
      if (a.model?.disguised) continue; // (a mimic still posing as a chest gives nothing away)
      const fx = Math.sin(a.yaw), fz = Math.cos(a.yaw), r = a.hitR + radius;
      for (let k = a.hitL ? -2 : 0; k <= (a.hitL ? 2 : 0); k++) {
        const cx = a.pos.x + fx * a.hitL * k / 2, cz = a.pos.z + fz * a.hitL * k / 2;
        const tt = ((cx - ox) * dx + (cz - oz) * dz) / (hl * hl);
        if (tt < 0 || tt >= best) continue;
        const px = ox + dx * tt, py = oy + dy * tt, pz = oz + dz * tt;
        if ((cx - px) ** 2 + (cz - pz) ** 2 > r * r) continue;
        if (py < a.pos.y + a.hitY0 - radius || py > a.pos.y + a.hitH + radius) continue;
        best = tt; hit = a; out.set(px, py, pz);
      }
    }
    return hit;
  }

  rayActors(origin, dir, maxDist, radius = 0.2) {
    const g = this.g;
    const wall = g.collision.raycast(origin.x, origin.y, origin.z, dir.x, dir.y, dir.z, maxDist, 0.2);
    const out = [];
    for (const a of g.actors.hostiles()) {
      // closest approach of ray to actor axis
      // the ray against the hit capsule: test its axis at the centre and (for long
      // bodies) both ends and halfway, keep the nearest hit along the ray
      const hl = Math.hypot(dir.x, dir.z) || 1e-6;
      const fx = Math.sin(a.yaw), fz = Math.cos(a.yaw);
      const r = a.hitR + radius;
      let best = Infinity, bp = null;
      for (let k = a.hitL ? -2 : 0; k <= (a.hitL ? 2 : 0); k++) {
        const cx = a.pos.x + fx * a.hitL * k / 2, cz = a.pos.z + fz * a.hitL * k / 2;
        const tt = ((cx - origin.x) * dir.x + (cz - origin.z) * dir.z) / (hl * hl);
        if (tt < 0 || tt > wall || tt >= best) continue;
        const px = origin.x + dir.x * tt, py = origin.y + dir.y * tt, pz = origin.z + dir.z * tt;
        const dx = cx - px, dz = cz - pz;
        if (dx * dx + dz * dz > r * r) continue;
        if (py < a.pos.y + a.hitY0 - radius || py > a.pos.y + a.hitH + radius) continue;
        best = tt; bp = [px, py, pz];
      }
      if (bp) out.push({ actor: a, t: best, point: new THREE.Vector3(bp[0], bp[1], bp[2]) });
    }
    out.sort((a, b) => a.t - b.t);
    // a local wizard's bolt or beam that stops on a wall cracks a secret wall there, as a spell striking it does
    if (this.localCast) {
      const end = out.length ? out[0].t : wall;
      if (wall < maxDist && end > wall - 0.05) this.g.encounters?.smash(_wp.set(origin.x + dir.x * wall, origin.y + dir.y * wall, origin.z + dir.z * wall), 0.4);
      // and the barrels and crates it passes through on its way
      for (let t = 0.5; t < Math.min(end, maxDist); t += 0.5) {
        for (const b of this.g.breakablesNear(_wp.set(origin.x + dir.x * t, origin.y + dir.y * t, origin.z + dir.z * t), 0.25)) this.g.breakProp(b.i, true);
      }
    }
    return { hits: out, wall };
  }

  nearest(pos, maxDist, exclude, filter) {
    let best = null, bd = maxDist * maxDist;
    for (const a of this.g.actors.hostiles()) {
      if (exclude && exclude.has(a.id)) continue;
      if (filter && !filter(a)) continue;
      const dx = a.pos.x - pos.x, dz = a.pos.z - pos.z, dy = a.pos.y + a.height * 0.5 - pos.y;
      const d2 = dx * dx + dz * dz + dy * dy;
      // (a chain's next link or a seeker's quarry must be in sight: a bounce leapt through walls)
      if (d2 < bd && this.g.collision.los(pos.x, pos.y, pos.z, a.pos.x, a.pos.y + a.height * 0.5, a.pos.z)) { bd = d2; best = a; }
    }
    return best;
  }

  inRadius(pos, r) {
    const out = [];
    this._seeFrom(pos);
    for (const a of this.g.actors.hostiles()) {
      const c = hitPoint(a, pos.x, pos.z, _hp);
      const dx = c.x - pos.x, dz = c.z - pos.z;
      const rr = r + a.hitR;
      if (dx * dx + dz * dz <= rr * rr && this._sees(a, c)) out.push(a);
    }
    return out;
  }

  // An area reaches only what it can see from its heart: a rift, a nova or a blast ate through walls before
  // (scripts/walls.js: Transfusion and Void Rift reached foes behind 6 m of stone, and most ultimates). Seen
  // from just above the centre to the middle of the body. A centre in the stone (a star that burst on a wall)
  // looks from the nearest open point within a metre; with none, it sees everything, as before.
  _seeFrom(pos) {
    const g = this.g, E = this._eye, C = g.collision;
    E.x = pos.x; E.z = pos.z; E.y = Math.max(pos.y ?? 0, g.groundY(pos.x, pos.z)) + 0.8;
    E.open = !C.pointSolid(E.x, E.y, E.z);
    for (let k = 0; k < 16 && !E.open; k++) {
      const a = (k % 8) * (Math.PI / 4), r = k < 8 ? 0.6 : 1.1;
      const x = pos.x + Math.cos(a) * r, z = pos.z + Math.sin(a) * r;
      if (!C.pointSolid(x, E.y, z)) { E.x = x; E.z = z; E.open = true; }
    }
  }
  _sees(a, c) {
    const E = this._eye;
    return !E.open || this.g.collision.los(E.x, E.y, E.z, c.x, a.pos.y + a.height * 0.5, c.z);
  }

  inCone(origin, dir, range, halfAngle) {
    const out = [];
    const cosA = Math.cos(halfAngle);
    const hl = Math.hypot(dir.x, dir.z) || 1;
    const fx = dir.x / hl, fz = dir.z / hl;
    // a local wizard's blade (a short arc) that reaches a wall cracks a secret wall there
    if (this.localCast && range <= 6) {
      const w = this.g.collision.raycast(origin.x, origin.y, origin.z, fx, 0, fz, range, 0.2);
      if (w < range) this.g.encounters?.smash(_wp.set(origin.x + fx * w, origin.y, origin.z + fz * w), 0.5);
      // and the barrels and crates in its arc
      for (const b of this.g.breakablesNear(_wp.set(origin.x + fx * range * 0.5, origin.y, origin.z + fz * range * 0.5), range * 0.6)) {
        const dx = b.x - origin.x, dz = b.z - origin.z, d = Math.hypot(dx, dz) || 1;
        if (d - b.r <= range && (dx * fx + dz * fz) / d >= cosA) this.g.breakProp(b.i, true);
      }
    }
    for (const a of this.g.actors.hostiles()) {
      const c = hitPoint(a, origin.x, origin.z, _hp);
      const dx = c.x - origin.x, dz = c.z - origin.z;
      const d = Math.hypot(dx, dz);
      if (d - a.hitR > range) continue;
      if (d < a.hitR + 0.5) { out.push(a); continue; }
      if ((dx * fx + dz * fz) / d < cosA) continue;
      if (!this.g.collision.los(origin.x, origin.y, origin.z, a.pos.x, a.pos.y + a.height * 0.5, a.pos.z)) continue;
      out.push(a);
    }
    return out;
  }
}

// map element ids to sound families
export function soundEl(el) {
  switch (el) {
    case 'necrotic': return 'shadow';
    case 'enemy': case 'enemyPurple': return 'shadow';
    case 'enemyGreen': return 'poison';
    case 'enemyFire': return 'fire';
    case 'physical': return 'earth';
    default: return el;
  }
}

export { SPR, rand };
