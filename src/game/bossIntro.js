import * as THREE from 'three';
import { T } from '../world/levelgen.js';
import { SPR } from '../render/particles.js';

// A boss's entrance. Each of the five is staged: the camera leaves the wizard's eyes for a shot of
// the boss (low, in front of it, a slow push in), the realm reacts, the boss makes its entrance, its
// name comes up at the moment it arrives, and the camera glides back.
//
//   Mother of Filth   the cistern bubbles and heaves; she bursts up out of the filth
//   The Executioner   the torches gutter out; three heavy steps out of the dark, dragging the axe;
//                     the axe comes down, the room shakes, and the torches flare back up blood red
//   Stone Wyvern      lightning; it drops out of the storm and lands with a shockwave and flying rubble
//   Court Archmage    a rune circle, a pillar of light, the floating pages whirled up; he burns into
//                     being from the feet up and settles to the floor
//   The Hollow King   the lights die; the dead court's souls stream into the King on his throne; the
//                     braziers light one by one in violet; he lifts his head
//
// Every peer stages its own (from the boss's spawn); the host also holds the boss still until it ends
// (actor.introHold: its brain doesn't run, it isn't a target yet), and drives the anims everyone sees.
// The visual offsets (rising out of the floor, dropping from the sky, stepping forward) are each
// peer's own (actor.stageX/Y/Z on the model only). Esc, Space or a click skips the camera.

const _v = new THREE.Vector3(), _w = new THREE.Vector3(), _q = new THREE.Quaternion(), _m = new THREE.Matrix4(), _up = new THREE.Vector3(0, 1, 0);
const ease = (t) => { t = Math.max(0, Math.min(1, t)); return t * t * (3 - 2 * t); };
const KIND = { motherOfFilth: 'filth', executioner: 'headsman', stoneWyvern: 'wyvern', courtArchmage: 'archmage', hollowKing: 'king' };

export class BossIntro {
  constructor(g, a) {
    this.g = g; this.a = a; this.level = g.level;
    this.kind = KIND[a.type] ?? 'generic';
    this.S = STAGES[this.kind];
    this.dur = this.S.dur;
    this.t = 0;
    this.done = false;
    this.skipped = false;
    this.fired = new Set();
    // the boss's room, its torches (dimmed and relit by some entrances: restored at the end)
    const L = g.level;
    this.room = a.brain?.data?.room ?? L.rooms[L.roomId[L.idx(Math.floor(a.pos.x / T), Math.floor(a.pos.z / T))]] ?? null;
    const R = this.room;
    const x0 = R ? R.x * T - 1 : -1e9, z0 = R ? R.y * T - 1 : -1e9, x1 = R ? (R.x + R.w) * T + 1 : 1e9, z1 = R ? (R.y + R.h) * T + 1 : 1e9;
    this.torches = g.lights.torches.filter((t) => t.pos.x > x0 && t.pos.x < x1 && t.pos.z > z0 && t.pos.z < z1).map((t) => ({ t, i0: t.intensity, c0: t.color.clone() }));
    this.flames = (g.built?.flames ?? []).filter((f) => f.x > x0 && f.x < x1 && f.z > z0 && f.z < z1 && f.gpu === undefined);
    this.yaw0 = a.yaw;
    this.shot = this._frame();
    a.stageX = 0; a.stageY = this.S.y0 ?? 0; a.stageZ = 0;
    if (g.isHost) { a.introHold = this.dur; this._anim(this.S.anim0 ?? 'idle'); }
    this.S.start?.(this);
    this._onKey = (e) => { if (this.t > 0.6 && (e.type === 'mousedown' || e.code === 'Space' || e.code === 'Escape')) this.skip(); };
    addEventListener('keydown', this._onKey); addEventListener('mousedown', this._onKey);
  }

  // where the camera stands for the shot: in front of the boss (it faces into its arena), a little to one
  // side and low, far enough to take in all of it; nearer if a wall or pillar is in the way
  _frame() {
    const a = this.a, L = this.level, S = this.S;
    const fx = Math.sin(this.yaw0), fz = Math.cos(this.yaw0), sx = fz, sz = -fx;
    const H = Math.max(1.8, a.height);
    const open = (x, z, y) => {
      const cx = Math.floor(x / T), cz = Math.floor(z / T);
      if (!L.inb(cx, cz)) return false;
      const i = L.idx(cx, cz);
      return L.cells[i] === 1 && L.floorAt(x, z) < y - 0.6 && (L.ceil[i] ?? 99) > y + 0.3 && !L.colliders.some((c) => Math.hypot(c.x - x, c.z - z) < (c.r ?? 0.5) + 0.6);
    };
    // and nothing standing between it and the boss (a pillar on the line hid the whole entrance)
    const C = this.g.collision;
    const sees = (x, z) => {
      const dx = a.pos.x - x, dz = a.pos.z - z, len = Math.hypot(dx, dz), n = Math.ceil(len / 0.5);
      for (let k = 1; k < n; k++) {
        if (len * (1 - k / n) < a.radius + 0.5) break;
        const px = x + (dx * k) / n, pz = z + (dz * k) / n;
        if (C.cellOpaque(Math.floor(px / T), Math.floor(pz / T)) || C.pushOut(px, pz, 0.3)) return false;
      }
      return true;
    };
    const dist = S.dist ?? H * 2.6 + 3, side = S.side ?? 0.35, up = S.camY ?? 1.3;
    for (const clear of [true, false]) for (const sd of [1, -1]) for (let d = dist; d >= 3.5; d -= 0.75) {
      const x = a.pos.x + fx * d + sx * d * side * sd, z = a.pos.z + fz * d + sz * d * side * sd;
      const y = L.floorAt(x, z) + up;
      if (open(x, z, y) && (!clear || sees(x, z))) return { x, y, z, d };
    }
    return { x: a.pos.x + fx * 4, y: a.pos.y + up, z: a.pos.z + fz * 4, d: 4 };
  }

  // (host) the anim everyone sees while the boss is held
  _anim(name, type = null, k = 0) {
    const a = this.a;
    if (!this.g.isHost) return;
    if (a.anim !== name || (type && a.attackType !== type)) { a.anim = name; a.animT = 0; a.progress = k; }
    if (type !== null) { a.attackType = type; a.brainAttackType = type; }
  }

  // run fn once, the first frame the timeline passes t
  at(t, fn) { if (this.t >= t && !this.fired.has(t)) { this.fired.add(t); fn(); } }

  skip() { if (!this.skipped) { this.skipped = true; this.t = Math.max(this.t, this.dur - 0.7); } }

  // the room's torches at k of their own brightness (0 dark), tinted toward col by c
  lights(k, col = null, c = 0) {
    for (const e of this.torches) {
      e.t.intensity = e.i0 * k;
      if (col) e.t.color.copy(e.c0).lerp(col, c); else e.t.color.copy(e.c0);
    }
    for (const f of this.flames) f.out = k < 0.15;
  }

  update(cam, dt) {
    const g = this.g, a = this.a;
    if (this.done) return false;
    this.t += dt;
    if (!a || a.dead || g.level !== this.level || this.t >= this.dur) { this.end(); return false; }
    // the host's hold runs on the same clock (a skip lets the boss loose with the camera)
    if (g.isHost) a.introHold = this.dur - this.t;
    this.S.step(this, this.t, dt);
    if (g.isHost && a.anim !== 'idle' && a.anim !== 'move' && a.anim !== 'spawn') a.progress = Math.min(1, a.progress + dt / (this.animDur ?? 1.2));
    // the camera: out to the shot, a slow push in, back to the wizard's eyes
    const t = this.t, D = this.dur;
    const e = ease(t / 0.75) * (1 - ease((t - (D - 0.8)) / 0.8));
    const sh = this.shot, push = ease(t / D) * 0.22;
    const lx = a.pos.x + a.stageX, ly = a.pos.y + a.stageY + (this.S.lookY ?? 0.62) * Math.max(1.6, a.height), lz = a.pos.z + a.stageZ;
    _v.set(sh.x + (lx - sh.x) * push, sh.y, sh.z + (lz - sh.z) * push);
    cam.position.lerp(_v, e);
    _m.lookAt(cam.position, _w.set(lx, ly, lz), _up);
    _q.setFromRotationMatrix(_m);
    cam.quaternion.slerp(_q, e);
    cam.fov = g.renderer.baseFov - 14 * e;
    cam.updateProjectionMatrix();
    return true;
  }

  end() {
    if (this.done) return;
    this.done = true;
    const g = this.g, a = this.a;
    removeEventListener('keydown', this._onKey); removeEventListener('mousedown', this._onKey);
    if (a) { a.stageX = 0; a.stageY = 0; a.stageZ = 0; if (g.isHost) a.introHold = 0; }
    if (g.level === this.level) { this.lights(1); this.S.end?.(this); }
    if (!this.named) { this.named = true; if (a && !a.dead) g.ui?.bossIntro(a); }
    g.ui?.letterbox(false);
    g.renderer.camera.fov = g.renderer.baseFov;
    g.renderer.camera.updateProjectionMatrix();
  }

  // the boss's name comes up, the roar, the music's downbeat: the moment it has arrived
  reveal(shake = 0.6) {
    const g = this.g, a = this.a;
    if (!this.named) { this.named = true; g.ui?.bossIntro(a); g.ui?.cineTitle?.(a.def.name, a.def.title ?? '', this.S.color ?? '#ff7050', Math.max(2, this.dur - this.t - 0.4)); }
    g.vfx.addShake(shake);
    g.audio?.play('boss_roar', { pos: a.pos });
    a.model?.bossFx?.('phase', { n: 0 });
  }

  // helpers
  feet() { const a = this.a; return _w.set(a.pos.x + a.stageX, a.pos.y + 0.1, a.pos.z + a.stageZ); }
}

// ------------------------------------------------------------------ the five entrances
const VIOLET = new THREE.Color(0x9a5cff), BLOOD = new THREE.Color(0xff2a14);

const STAGES = {
  generic: {
    dur: 3.2,
    step(I, t) { I.at(0.9, () => I.reveal(0.5)); },
  },

  // the cistern heaves; she bursts up out of the filth
  filth: {
    dur: 5.2, y0: -4.5, lookY: 0.45, color: '#9ae060',
    step(I, t, dt) {
      const g = I.g, a = I.a, P = g.vfx.P;
      const f = I.feet();
      // bubbling, faster and wider as she comes
      if (t < 2.0 && Math.random() < dt * (6 + t * 14)) {
        const r = 0.5 + t * 1.2, ang = Math.random() * 6.283;
        P.glow({ x: f.x + Math.cos(ang) * r * Math.random(), y: f.y, z: f.z + Math.sin(ang) * r * Math.random(), vy: 1 + Math.random() * 2, r: 0.4, g: 0.9, b: 0.15, r2: 0.1, g2: 0.3, b2: 0.05, life: 0.6, size: 0.18 + Math.random() * 0.2, sprite: SPR.BUBBLE, gravity: 4, drag: 1 });
      }
      I.at(0.3, () => g.audio?.play('stone_grind', { pos: a.pos, volume: 0.6 }));
      I.at(0.6, () => g.vfx.addShake(0.15));
      I.at(1.2, () => { g.vfx.addShake(0.2); g.splash(f.x + 2, f.z, 2); g.splash(f.x - 2, f.z + 1, 2); });
      // she bursts up (an overshoot and a settle)
      if (t >= 1.8) {
        const u = Math.min(1, (t - 1.8) / 0.75);
        a.stageY = -4.5 * (1 - u) + Math.sin(u * Math.PI) * 0.6 * (1 - u * 0.4);
      }
      I.at(1.8, () => {
        g.vfx.burst(_v.set(f.x, f.y + 0.4, f.z), { element: 'enemyGreen', count: 90, speed: 9, upward: 2.5, life: 1.3, size: 0.35, sprite: SPR.BUBBLE, gravity: 9, solid: false });
        g.vfx.burst(_v.set(f.x, f.y + 0.2, f.z), { count: 40, speed: 6, upward: 2, life: 1.1, size: 0.12, sprite: SPR.DROP, color: [0.3, 0.5, 0.1], solid: true, gravity: 12 });
        g.vfx.smoke(_v.set(f.x, f.y + 0.5, f.z), { count: 10, size: 1.6, color: [0.12, 0.18, 0.06], alpha: 0.5, life: 2.2, spread: 2.2 });
        g.vfx.ring(_v.set(f.x, f.y, f.z), 7, [0.4, 1.4, 0.2], 0.8, 0.12);
        for (let k = 0; k < 6; k++) g.splash(f.x + Math.cos(k) * 4, f.z + Math.sin(k) * 4, 3);
        g.audio?.play('slime_squish', { pos: a.pos, volume: 1 });
        g.vfx.flash(_v.set(f.x, f.y + 2, f.z), 0x80ff40, 30, 14, 0.4);
      });
      I.at(2.35, () => { I._anim('cast'); I.animDur = 1.6; I.reveal(0.7); });
    },
  },

  // the torches gutter out; three heavy steps out of the dark, the axe dragging; it comes down; the
  // torches flare back blood red, then settle
  headsman: {
    dur: 5.6, lookY: 0.55, dist: 7.5, color: '#ff4a30',
    start(I) { I.a.stageZ = 0; },
    step(I, t, dt) {
      const g = I.g, a = I.a;
      // dark by 0.8 s; back (red, flaring) at the blow, settling to their own colour by the end
      const k = t < 3.2 ? Math.max(0.05, 1 - t / 0.8) : Math.min(1.6, 0.05 + (t - 3.2) * 5) - Math.max(0, (t - 3.6) * 0.4);
      I.lights(Math.max(0.05, Math.min(1.6, k)), BLOOD, t < 3.2 ? 0 : Math.max(0, 1 - (t - 3.2) / 2.2));
      // three steps forward out of the dark (a visual step: his body starts 2.4 m back)
      const fx = Math.sin(I.yaw0), fz = Math.cos(I.yaw0);
      const back = 2.4 * (1 - ease((t - 0.8) / 2.0));
      a.stageX = -fx * back; a.stageZ = -fz * back;
      if (t > 0.8 && t < 2.8) I._anim('move'); else if (t <= 0.8) I._anim('idle');
      for (const s of [1.05, 1.7, 2.35]) I.at(s, () => {
        const f = I.feet();
        g.audio?.play('boss_slam', { pos: f, volume: 0.45 });
        g.vfx.addShake(0.18);
        g.vfx.smoke(_v.set(f.x, f.y, f.z), { count: 4, size: 0.9, color: [0.2, 0.18, 0.16], alpha: 0.4, life: 1.4, spread: 0.8, rise: 0.3 });
      });
      // the axe dragging: sparks off the flags behind each step
      if (t > 0.8 && t < 2.8 && Math.random() < dt * 30) {
        const f = I.feet(), sd = Math.cos(I.yaw0), sz = -Math.sin(I.yaw0);
        g.vfx.P.glow({ x: f.x + sd * 0.7 - fx * 0.6, y: f.y + 0.05, z: f.z + sz * 0.7 - fz * 0.6, vx: (Math.random() - 0.5) * 3, vy: 1 + Math.random() * 2, vz: (Math.random() - 0.5) * 3, r: 3, g: 1.6, b: 0.5, life: 0.4, size: 0.03, sprite: SPR.SPARK, gravity: 9, drag: 1 });
      }
      I.at(2.8, () => { I._anim('attack', 'slam'); I.animDur = 0.8; });
      I.at(3.15, () => {
        const f = I.feet();
        g.vfx.ring(_v.set(f.x, f.y, f.z), 9, [2.4, 0.3, 0.15], 0.9, 0.1);
        g.vfx.burst(_v.set(f.x + fx * 1.6, f.y + 0.2, f.z + fz * 1.6), { count: 40, speed: 8, upward: 1.5, life: 0.7, size: 0.05, sprite: SPR.SPARK, color: [3, 1.4, 0.4], gravity: 10 });
        g.vfx.smoke(_v.set(f.x + fx * 1.6, f.y + 0.3, f.z + fz * 1.6), { count: 10, size: 1.3, color: [0.2, 0.17, 0.15], alpha: 0.5, life: 2, spread: 2.2, speed: 2 });
        // grit from the vault, the cages swinging
        const R = I.room;
        if (R) for (let k = 0; k < 40; k++) g.particles.solid({ x: (R.x + Math.random() * R.w) * T, y: Math.min(9, R.ceil ?? 8) - 0.3, z: (R.y + Math.random() * R.h) * T, vy: -1, r: 0.3, g: 0.27, b: 0.23, a: 0.7, life: 2.2, size: 0.03, sprite: SPR.CHUNK, gravity: 7 });
        g.rattleHangers?.(f, 30, 2.5);
        g.audio?.play('shockwave', { pos: f });
        I.reveal(0.9);
      });
    },
  },

  // lightning; it dives out of the storm and pulls up over the yard, its downdraft flattening the grass and
  // blasting the rain and dust off the stones (in its first phase it flies: there is no landing)
  wyvern: {
    dur: 5.4, y0: 26, lookY: 0.5, camY: 1.0, color: '#9ab8ff',
    start(I) { if (I.g.storm) I.g.storm._next = 0.15; },
    step(I, t, dt) {
      const g = I.g, a = I.a;
      // the dive: slow at first, then all at once, overshooting below its hover and rising back
      if (t < 2.6) {
        const u = Math.max(0, (t - 0.5) / 1.6);
        a.stageY = u < 1 ? 26 * (1 - u * u * u) : -1.2 * Math.sin(Math.min(1, (t - 2.1) / 0.5) * Math.PI);
        I._anim('attack', 'fly'); I.animDur = 2.2;
      } else a.stageY = 0;
      I.at(0.9, () => g.audio?.play('thunder', { volume: 0.8 }));
      I.at(2.1, () => {
        const f = I.feet(), gy = g.groundY(f.x, f.z);
        g.vfx.ring(_v.set(f.x, gy, f.z), 11, [1.2, 1.2, 1.3], 1.0, 0.16);
        g.vfx.ring(_v.set(f.x, gy, f.z), 6, [1.0, 1.0, 1.1], 0.7, 0.2);
        g.vfx.smoke(_v.set(f.x, gy + 0.3, f.z), { count: 16, size: 1.7, color: [0.32, 0.33, 0.36], alpha: 0.45, life: 2.2, spread: 3.5, speed: 5, rise: 0.25 });
        g.vfx.burst(_v.set(f.x, gy + 0.1, f.z), { count: 50, speed: 9, upward: 0.4, life: 0.9, size: 0.05, sprite: SPR.DROP, color: [0.6, 0.65, 0.75], solid: true, gravity: 6, jitter: 2 });
        g.audio?.play('shockwave', { pos: f, volume: 1 });
        g.vfx.addShake(0.6);
        g.vfx.flash(_v.set(f.x, gy + 3, f.z), 0xc8d8ff, 24, 18, 0.3);
      });
      I.at(2.7, () => { I._anim('cast'); I.animDur = 1.6; I.reveal(0.4); });
    },
  },

  // a rune circle, a pillar of light, the pages whirled up; he burns into being and settles
  archmage: {
    dur: 5.4, y0: 1.6, lookY: 0.6, anim0: 'spawn', color: '#c8a0ff',
    step(I, t, dt) {
      const g = I.g, a = I.a, P = g.vfx.P;
      const f = I.feet();
      I.lights(Math.max(0.35, 1 - t * 0.8), VIOLET, Math.min(1, t));
      I.at(0.2, () => { g.vfx.ring(_v.set(f.x, a.pos.y, f.z), 4, [1.2, 0.6, 2.6], 4.5, 0.08); g.audio?.play('summon', { pos: a.pos }); });
      // the pillar of light and the whirl of motes and pages round it
      if (t > 0.3 && t < 3.4) {
        g.lights.request(_v.set(f.x, a.pos.y + 2.5, f.z), 0xb080ff, 34 * Math.min(1, (t - 0.3) * 2), 12);
        if (Math.random() < dt * 60) {
          const ang = Math.random() * 6.283, r = 0.3 + Math.random() * 0.6;
          P.glow({ x: f.x + Math.cos(ang) * r, y: a.pos.y + Math.random() * 0.5, z: f.z + Math.sin(ang) * r, vy: 3 + Math.random() * 3, r: 1.2, g: 0.8, b: 2.6, life: 1, size: 0.07, sprite: SPR.GLOW, drag: 0.4 });
        }
        if (Math.random() < dt * 14) {
          const ang = Math.random() * 6.283, r = 2 + Math.random() * 2;
          P.solid({ x: f.x + Math.cos(ang) * r, y: a.pos.y + 0.3 + Math.random(), z: f.z + Math.sin(ang) * r, vx: -Math.sin(ang) * 3, vy: 1.6, vz: Math.cos(ang) * 3, r: 0.75, g: 0.66, b: 0.48, a: 0.9, life: 1.4, size: 0.1, sprite: SPR.CHUNK, spin: 6, drag: 0.6 });
        }
      }
      // he burns into being from the feet up (his own materialize: the spawn anim, its progress ours),
      // settling to the floor
      if (g.isHost && a.anim === 'spawn') a.progress = Math.max(0, Math.min(1, (t - 0.8) / 1.8));
      a.stageY = 1.6 * (1 - ease((t - 1.2) / 2.0));
      I.at(3.2, () => {
        g.vfx.flash(_v.set(f.x, a.pos.y + 2, f.z), 0xc0a0ff, 40, 14, 0.35);
        g.vfx.burst(_v.set(f.x, a.pos.y + 1.4, f.z), { count: 50, speed: 7, life: 0.9, size: 0.1, color: [1.4, 0.9, 3], sprite: SPR.GLOW });
        I._anim('cast'); I.animDur = 1.4;
        I.reveal(0.4);
      });
    },
  },

  // the lights die; the dead court's souls stream into the King on his throne; the braziers light
  // one by one, violet; he lifts his head
  king: {
    dur: 6.4, lookY: 0.5, dist: 7.5, side: 0.18, camY: 2.0, color: '#b48cff',
    start(I) {
      I._anim('idle', 'seated');
      // the braziers in the order they'll light: the nearest the throne last
      const a = I.a;
      I.order = I.torches.slice().sort((p, q) => Math.hypot(q.t.pos.x - a.pos.x, q.t.pos.z - a.pos.z) - Math.hypot(p.t.pos.x - a.pos.x, p.t.pos.z - a.pos.z));
      I.court = (I.g.built?.court?.list ?? []).filter((c) => Math.hypot(c[0] - a.pos.x, c[2] - a.pos.z) < 30);
    },
    step(I, t, dt) {
      const g = I.g, a = I.a, P = g.vfx.P;
      I._anim('idle', 'seated');
      // all dark, then each brazier relit in turn (2.6 s on, one every 0.3 s)
      const n = I.order.length;
      I.order.forEach((e, k) => {
        const on = 2.6 + k * 0.3;
        const lit = t > on ? Math.min(1, (t - on) * 4) : Math.max(0.03, 1 - t / 0.7);
        e.t.intensity = e.i0 * lit; e.t.color.copy(e.c0).lerp(VIOLET, t > on ? Math.max(0, 1 - (t - on) / 2.5) : 0);
        I.at(on + 0.0001 * k, () => {
          g.vfx.burst(_v.set(e.t.pos.x, e.t.pos.y + 0.2, e.t.pos.z), { count: 26, speed: 4, upward: 2, life: 0.7, size: 0.12, color: [1.6, 0.7, 2.8], sprite: SPR.FLAME });
          g.audio?.play('burn_tick', { pos: e.t.pos, volume: 0.9 });
        });
      });
      for (const f of I.flames) f.out = t < 2.6;
      // the court's souls drawn to the King, streaming up the hall
      if (t > 0.5 && t < 3.0 && I.court.length) {
        const tx = a.pos.x, ty = a.pos.y + a.height * 0.6, tz = a.pos.z;
        for (let k = 0; k < 3; k++) {
          if (Math.random() > dt * 75) continue;
          const c = I.court[(Math.random() * I.court.length) | 0];
          const sy = c[1] + 1.2, life = 1.1 + Math.random() * 0.5;
          P.glow({ x: c[0], y: sy, z: c[2], vx: (tx - c[0]) / life, vy: (ty - sy) / life, vz: (tz - c[2]) / life, r: 0.9, g: 1.1, b: 3.2, r2: 1.6, g2: 0.7, b2: 3.2, life, size: 0.24, size2: 0.08, sprite: SPR.WISP, drag: 0 });
        }
        g.lights.request(_v.set(a.pos.x, a.pos.y + 2, a.pos.z), 0x8090ff, 20 * Math.min(1, (t - 0.5) * 1.5), 10);
      }
      I.at(0.5, () => g.audio?.play('ghost_wail', { pos: a.pos, volume: 0.8 }));
      I.at(2.6 + n * 0.3 + 0.2, () => {
        g.vfx.ring(_v.set(a.pos.x, a.pos.y + 0.1, a.pos.z), 12, [1.4, 0.6, 2.6], 1.1, 0.1);
        g.vfx.flash(_v.set(a.pos.x, a.pos.y + 2.5, a.pos.z), 0xa070ff, 40, 16, 0.4);
        I._anim('cast', 'seated'); I.animDur = 1.6;
        I.reveal(0.6);
      });
    },
    end(I) { I._anim('idle', 'seated'); for (const f of I.flames) f.out = false; },
  },
};
