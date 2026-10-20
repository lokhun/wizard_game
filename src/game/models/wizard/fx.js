import * as THREE from 'three';
import { flameTongue, mulberry, LOD } from './shapes.js';
import { flameTexture, glowTexture } from './surfaces.js';

// Small animated effect pieces built from meshes (no particle system).

// smooth pseudo-noise in [-1,1] from a sum of sines
export function wob(t, seed = 0) {
  return (Math.sin(t * 1.7 + seed * 1.3) * 0.5 + Math.sin(t * 2.9 + seed * 2.1) * 0.3 + Math.sin(t * 5.3 + seed * 0.7) * 0.2);
}
// faster flicker
export function flick(t, seed = 0) {
  return (Math.sin(t * 13.1 + seed) * 0.4 + Math.sin(t * 23.7 + seed * 1.9) * 0.35 + Math.sin(t * 7.3 + seed * 3.1) * 0.25);
}

// Jagged lightning bolt rendered as a 4-sided dynamic tube.
export class Bolt {
  constructor(material, segs = 8, radius = 0.0018) {
    this.segs = segs;
    this.radius = radius;
    const n = (segs + 1) * 4;
    this.pos = new Float32Array(n * 3);
    const idx = [];
    for (let i = 0; i < segs; i++) {
      for (let j = 0; j < 4; j++) {
        const a = i * 4 + j, b = i * 4 + ((j + 1) % 4), c = (i + 1) * 4 + j, d = (i + 1) * 4 + ((j + 1) % 4);
        idx.push(a, c, b, b, c, d);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    g.setIndex(idx);
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 10);
    this.mesh = new THREE.Mesh(g, material);
    this.mesh.frustumCulled = false;
    this.pts = Array.from({ length: segs + 1 }, () => new THREE.Vector3());
    this._t = new THREE.Vector3(); this._n = new THREE.Vector3(); this._b = new THREE.Vector3();
  }
  // a, b: endpoints in the mesh's parent space
  set(a, b, amp, rnd = Math.random, taper = true) {
    const { pts, segs } = this;
    const d = this._t.subVectors(b, a);
    const len = d.length() || 1e-4;
    d.multiplyScalar(1 / len);
    const up = Math.abs(d.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
    const n1 = this._n.crossVectors(d, up).normalize();
    const n2 = this._b.crossVectors(d, n1).normalize();
    for (let i = 0; i <= segs; i++) {
      const t = i / segs;
      const env = Math.sin(t * Math.PI);
      const o1 = (rnd() * 2 - 1) * amp * len * env;
      const o2 = (rnd() * 2 - 1) * amp * len * env;
      pts[i].copy(a).lerp(b, t).addScaledVector(n1, o1).addScaledVector(n2, o2);
    }
    const p = this.pos;
    for (let i = 0; i <= segs; i++) {
      const r = this.radius * (taper ? 0.4 + 0.6 * Math.sin(Math.PI * (0.15 + 0.7 * i / segs)) : 1);
      for (let j = 0; j < 4; j++) {
        const a2 = (j / 4) * Math.PI * 2;
        const ox = Math.cos(a2) * r, oy = Math.sin(a2) * r;
        const k = (i * 4 + j) * 3;
        p[k] = pts[i].x + n1.x * ox + n2.x * oy;
        p[k + 1] = pts[i].y + n1.y * ox + n2.y * oy;
        p[k + 2] = pts[i].z + n1.z * ox + n2.z * oy;
      }
    }
    this.mesh.geometry.attributes.position.needsUpdate = true;
  }
  dispose() { this.mesh.geometry.dispose(); }
}

// Cluster of flickering flame tongues (two layers: outer color, inner hot core)
export class FlameCluster {
  constructor(kit, color, color2, opts = {}) {
    const n = LOD.k < 1 ? Math.max(1, Math.ceil((opts.count ?? 5) * 0.5)) : (opts.count ?? 5);
    const size = opts.size ?? 0.05;
    this.group = new THREE.Group();
    this.items = [];
    const rnd = mulberry(opts.seed ?? 7);
    const tex = flameTexture();
    this.outer = kit.glow(color, opts.intensity ?? 2.2, { additive: true, map: tex, side: THREE.DoubleSide });
    this.inner = kit.glow(color2, (opts.intensity ?? 2.2) * 1.2, { additive: true, map: tex, side: THREE.DoubleSide });
    const geos = [0, 1, 2].map((i) => flameTongue(1, 0.32, (opts.seed ?? 7) + i));
    const spread = opts.spread ?? size * 0.6;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + rnd();
      const r = i === 0 ? 0 : spread * (0.4 + rnd() * 0.6);
      const outer = new THREE.Mesh(geos[i % 3], this.outer);
      const s = size * (i === 0 ? 1.15 : 0.6 + rnd() * 0.4);
      outer.position.set(Math.cos(a) * r, 0, Math.sin(a) * r);
      outer.scale.set(s * 0.8, s * 1.6, s * 0.8);
      const inner = new THREE.Mesh(geos[(i + 1) % 3], this.inner);
      inner.scale.set(0.55, 0.6, 0.55);
      inner.position.y = 0.02;
      outer.add(inner);
      outer.renderOrder = 5;
      this.group.add(outer);
      this.items.push({ m: outer, s, seed: rnd() * 100, base: outer.position.clone() });
    }
    if (opts.points) {
      // explicit anchor points instead of a ring
      opts.points.forEach((p, i) => { if (this.items[i]) { this.items[i].base.copy(p); this.items[i].m.position.copy(p); } });
    }
  }
  update(t, k = 1) {
    for (const it of this.items) {
      const f = 0.75 + 0.35 * flick(t * 1.2, it.seed) * 0.8;
      it.m.scale.set(it.s * 0.8 * (0.9 + 0.1 * f), it.s * 1.6 * f * k, it.s * 0.8 * (0.9 + 0.1 * f));
      it.m.rotation.y = t * 2 + it.seed;
      it.m.rotation.z = wob(t * 3, it.seed) * 0.15;
      it.m.position.y = it.base.y + Math.max(0, flick(t, it.seed + 3)) * it.s * 0.15;
    }
  }
  get materials() { return [this.outer, this.inner]; }
}

// Damped pendulum hanging from a pivot. Responds to the pivot's acceleration.
export class Pendulum {
  constructor(stiff = 18, damp = 2.2) {
    this.ax = 0; this.az = 0; this.vx = 0; this.vz = 0;
    this.k = stiff; this.c = damp;
  }
  // accel: THREE.Vector3 in the pivot's parent frame (m/s^2)
  step(dt, accel, gain = 1) {
    const n = Math.max(1, Math.ceil(dt / 0.008));
    const h = dt / n;
    for (let i = 0; i < n; i++) {
      this.vx += (-this.k * this.ax - this.c * this.vx + accel.x * gain) * h;
      this.vz += (-this.k * this.az - this.c * this.vz - accel.z * gain) * h;
      this.ax += this.vx * h; this.az += this.vz * h;
    }
    this.ax = THREE.MathUtils.clamp(this.ax, -1.0, 1.0);
    this.az = THREE.MathUtils.clamp(this.az, -1.0, 1.0);
  }
}

export function haloSprite(kit, color, size, intensity = 1.5) {
  const m = new THREE.SpriteMaterial({ map: glowTexture(), color: new THREE.Color(color).multiplyScalar(intensity), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: false });
  m.userData.glow = { base: new THREE.Color(color), intensity };
  const s = new THREE.Sprite(m);
  s.scale.setScalar(size);
  s.renderOrder = 6;
  return s;
}

// Orient a hanging pivot so its +Y matches upRef's +Y (gravity), then apply
// a pendulum swing (ax about Z, az about X).
const _m1 = new THREE.Matrix4(), _m2 = new THREE.Matrix4(), _qe = new THREE.Quaternion(), _eu = new THREE.Euler();
const _pv = new THREE.Vector3(), _sv = new THREE.Vector3();
export function hangFrom(pivot, upRef, ax, az) {
  if (!pivot.parent || !upRef) return;
  pivot.parent.updateWorldMatrix(true, false);
  upRef.updateWorldMatrix(true, false);
  // desired world rotation = upRef rotation (ignoring its scale) * swing
  upRef.matrixWorld.decompose(_pv, _qe, _sv);
  _m2.makeRotationFromQuaternion(_qe).multiply(_m1.makeRotationFromEuler(_eu.set(az, 0, ax)));
  // local = inverse(parent rotation/scale) * desired
  _m1.copy(pivot.parent.matrixWorld).setPosition(0, 0, 0).invert().multiply(_m2);
  const mirrored = _m1.determinant() < 0;
  if (mirrored) _m1.scale(_sv.set(-1, 1, 1));
  _m1.decompose(_pv, pivot.quaternion, _sv);
  pivot.scale.set(mirrored ? -_sv.x : _sv.x, _sv.y, _sv.z);
}
