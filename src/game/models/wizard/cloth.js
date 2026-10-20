import * as THREE from 'three';

// ---------------------------------------------------------------------------
// Verlet cloth chains for the avatars. Each chain is a pinned anchor plus a
// few free points simulated in world space (so the character's own motion
// produces drag, lag and overshoot), constrained by segment lengths, ring
// spacing to the neighbouring chains, leg / body capsules and the ground,
// and pulled softly back toward the authored rest shape. The result is
// written as rotations of a bone chain that skins the skirt, coat, cape and
// dangling trinkets on the GPU.
// ---------------------------------------------------------------------------

const DOWN = new THREE.Vector3(0, -1, 0);
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _d = new THREE.Vector3(), _e = new THREE.Vector3();
const _q = new THREE.Quaternion(), _qi = new THREE.Quaternion(), _qw = new THREE.Quaternion();
const _m = new THREE.Matrix4(), _s = new THREE.Vector3();

export class Cloth {
  constructor(root) {
    this.root = root;
    this.chains = [];
    this.rings = [];
    this.caps = []; // { a, ao, b, bo, r, A, B }
    this.cones = []; // { node, inv, y0, y1, r0x, r0z, r1x, r1z, applies(chain) }
    this.wind = new THREE.Vector3(); // gusty wind (accel, world)
    this.flow = new THREE.Vector3(); // steady air drag (accel, world)
    this.gust = 0;
    this.first = true;
    this.t = 0;
    this.gravK = 1; // gravity on 'pose' chains (skirts: only when not upright)
  }

  // parent: node the chain hangs from. pts: rest points in ROOT space (bind,
  // pts[0] = anchor). opts: stiff (shape memory /s), damp (/s), grav, r (point radius)
  addChain(parent, pts, opts = {}) {
    const root = this.root;
    root.updateMatrixWorld(true);
    const n = pts.length - 1;
    const bones = [];
    const lens = [];
    let par = parent;
    // world quaternion of the parent at bind
    parent.matrixWorld.decompose(_a, _qw, _s);
    const qw = _qw.clone();
    const anchorLocal = parent.worldToLocal(pts[0].clone().applyMatrix4(root.matrixWorld));
    for (let k = 0; k < n; k++) {
      const b = new THREE.Object3D();
      b.name = (opts.name ?? 'cloth') + k;
      if (k === 0) b.position.copy(anchorLocal); else b.position.set(0, -lens[k - 1], 0);
      const L = pts[k + 1].distanceTo(pts[k]);
      lens.push(L);
      _d.subVectors(pts[k + 1], pts[k]).normalize();
      _qi.copy(qw).invert();
      _e.copy(_d).applyQuaternion(_qi);
      b.quaternion.setFromUnitVectors(DOWN, _e);
      qw.multiply(b.quaternion);
      par.add(b);
      bones.push(b);
      par = b;
    }
    // rest points in the parent's local frame
    parent.updateMatrixWorld(true);
    _m.copy(parent.matrixWorld).invert();
    const rest = pts.map((p) => p.clone().applyMatrix4(root.matrixWorld).applyMatrix4(_m));
    const c = {
      parent, bones, lens, rest, n, bindQ: bones.map((b) => b.quaternion.clone()),
      p: pts.map(() => new THREE.Vector3()), o: pts.map(() => new THREE.Vector3()),
      a0: new THREE.Vector3(), a1: new THREE.Vector3(),
      stiff: opts.stiff ?? 6, damp: opts.damp ?? 2.5, grav: opts.grav ?? 1, r: opts.r ?? 0.02,
      wind: opts.wind ?? 1, coll: opts.coll ?? 1, cone: opts.cone ?? true, ground: opts.ground ?? 0.015,
      phase: opts.phase ?? Math.random() * 10, gravPose: !!opts.gravPose,
      // keep-out: points stay at least this fraction of their rest distance from the parent's Y axis
      keepOut: opts.keepOut ?? 0, inv: new THREE.Matrix4(), restR: null,
    };
    c.restR = rest.map((p) => Math.hypot(p.x, p.z));
    this.chains.push(c);
    return c;
  }

  // keeps neighbouring chains (same level) at roughly their rest spacing
  addRing(chains, closed = true, lo = 0.75, hi = 1.3) {
    const pairs = [];
    for (let i = 0; i < chains.length - (closed ? 0 : 1); i++) {
      const a = chains[i], b = chains[(i + 1) % chains.length];
      const n = Math.min(a.n, b.n);
      for (let k = 1; k <= n; k++) {
        _a.copy(a.rest[k]).applyMatrix4(a.parent.matrixWorld);
        _b.copy(b.rest[k]).applyMatrix4(b.parent.matrixWorld);
        pairs.push({ a, b, k, d: _a.distanceTo(_b) });
      }
    }
    this.rings.push({ pairs, lo, hi });
  }

  // capsule between two nodes (local offsets), radius r
  addCapsule(a, ao, b, bo, r) {
    this.caps.push({ a, ao: ao.clone(), b, bo: bo.clone(), r, rr: r, A: new THREE.Vector3(), B: new THREE.Vector3() });
  }

  // elliptic cone around node's local Y axis between y0 (radii r0) and y1 (radii r1)
  addCone(node, y0, r0x, r0z, y1, r1x, r1z) {
    this.cones.push({ node, y0, y1, r0x, r0z, r1x, r1z, inv: new THREE.Matrix4(), mw: null });
  }

  restWorld(c, k, out) { return out.copy(c.rest[k]).applyMatrix4(c.parent.matrixWorld); }

  reset() {
    for (const c of this.chains) {
      for (let k = 0; k <= c.n; k++) { this.restWorld(c, k, c.p[k]); c.o[k].copy(c.p[k]); }
      c.a0.copy(c.p[0]); c.a1.copy(c.p[0]);
    }
    this.first = false;
  }

  // dt: frame time; scale: world scale of the rig; groundY: world floor height
  step(dt, scale = 1, groundY = 0, t = 0) {
    this.t = t;
    if (this.first) this.reset();
    for (let _i1 = 0, _a1 = this.caps; _i1 < _a1.length; _i1++) { const cp = _a1[_i1]; cp.A.copy(cp.ao).applyMatrix4(cp.a.matrixWorld); cp.B.copy(cp.bo).applyMatrix4(cp.b.matrixWorld); cp.rr = cp.r * scale; }
    for (let _i2 = 0, _a2 = this.cones; _i2 < _a2.length; _i2++) { const co = _a2[_i2]; co.inv.copy(co.node.matrixWorld).invert(); co.mw = co.node.matrixWorld; }
    for (let i = 0, prev = null; i < this.chains.length; i++) {
      const c = this.chains[i];
      if (!c.keepOut) continue;
      if (prev && prev.parent === c.parent) c.inv.copy(prev.inv); else c.inv.copy(c.parent.matrixWorld).invert();
      prev = c;
    }
    const sub = Math.max(1, Math.min(4, Math.ceil(dt / (1 / 60))));
    const h = dt / sub;
    const g = -9.8 * h * h;
    for (let _i3 = 0, _a3 = this.chains; _i3 < _a3.length; _i3++) { const c = _a3[_i3];
      c.a0.copy(c.a1);
      this.restWorld(c, 0, c.a1);
      if (c.a0.distanceToSquared(c.a1) > 1.2 * 1.2) {
        for (let k = 0; k <= c.n; k++) { this.restWorld(c, k, c.p[k]); c.o[k].copy(c.p[k]); }
        c.a0.copy(c.a1);
      }
    }
    for (let s = 1; s <= sub; s++) {
      const f = s / sub;
      for (let _i4 = 0, _a4 = this.chains; _i4 < _a4.length; _i4++) { const c = _a4[_i4];
        c.p[0].lerpVectors(c.a0, c.a1, f);
        const kd = Math.exp(-c.damp * h), ks = 1 - Math.exp(-c.stiff * h);
        for (let k = 1; k <= c.n; k++) {
          const p = c.p[k], o = c.o[k];
          _d.subVectors(p, o).multiplyScalar(kd);
          o.copy(p);
          p.add(_d);
          p.y += g * c.grav * (c.gravPose ? this.gravK : 1);
          p.addScaledVector(this.flow, c.wind * h * h * (0.4 + 0.6 * k / c.n));
          // wind gusts: stronger toward the free end
          const wk = (k / c.n) * c.wind * h * h;
          if (wk) {
            const gst = 0.6 + 0.4 * Math.sin(this.t * 1.3 + c.phase + k * 0.7) + 0.3 * Math.sin(this.t * 3.1 + c.phase * 2.3);
            p.addScaledVector(this.wind, wk * gst);
          }
          // shape memory toward the rest pose (in the parent frame)
          this.restWorld(c, k, _a);
          p.addScaledVector(_a.sub(p), ks);
        }
      }
      for (let it = 0; it < 2; it++) {
        for (let _i5 = 0, _a5 = this.chains; _i5 < _a5.length; _i5++) { const c = _a5[_i5];
          for (let k = 1; k <= c.n; k++) {
            const a = c.p[k - 1], b = c.p[k];
            _d.subVectors(b, a);
            const L = _d.length() || 1e-6, R = c.lens[k - 1] * scale;
            // pinned parent: move only the child
            b.addScaledVector(_d, (R - L) / L);
          }
        }
        for (let _i6 = 0, _a6 = this.rings; _i6 < _a6.length; _i6++) { const rg = _a6[_i6];
          for (let _i7 = 0, _a7 = rg.pairs; _i7 < _a7.length; _i7++) { const pr = _a7[_i7];
            const a = pr.a.p[pr.k], b = pr.b.p[pr.k];
            _d.subVectors(b, a);
            const L = _d.length() || 1e-6, R = pr.d * scale;
            let t = 0;
            if (L < R * rg.lo) t = R * rg.lo; else if (L > R * rg.hi) t = R * rg.hi; else continue;
            _d.multiplyScalar(((L - t) / L) * 0.5);
            a.add(_d); b.sub(_d);
          }
        }
        for (let _i8 = 0, _a8 = this.chains; _i8 < _a8.length; _i8++) { const c = _a8[_i8];
          if (!c.coll) continue;
          for (let k = 1; k <= c.n; k++) {
            const p = c.p[k];
            for (let _i10 = 0, _a10 = this.caps; _i10 < _a10.length; _i10++) { const cp = _a10[_i10]; pushCapsule(p, cp.A, cp.B, cp.rr + c.r * scale); }
            if (c.cone) for (let _i11 = 0, _a11 = this.cones; _i11 < _a11.length; _i11++) { const co = _a11[_i11]; pushCone(p, co, c.r); }
            if (c.keepOut) {
              _l.copy(p).applyMatrix4(c.inv);
              const r = Math.hypot(_l.x, _l.z), rm = c.restR[k] * c.keepOut;
              if (r < rm && r > 1e-5) { _l.x *= rm / r; _l.z *= rm / r; p.copy(_l.applyMatrix4(c.parent.matrixWorld)); }
            }
            if (p.y < groundY + c.ground * scale) p.y = groundY + c.ground * scale;
          }
        }
      }
    }
    // write bone rotations
    for (let _i9 = 0, _a9 = this.chains; _i9 < _a9.length; _i9++) { const c = _a9[_i9];
      c.parent.matrixWorld.decompose(_a, _qw, _s);
      for (let k = 0; k < c.n; k++) {
        _d.subVectors(c.p[k + 1], c.p[k]);
        if (_d.lengthSq() < 1e-10) { _qw.multiply(c.bones[k].quaternion); continue; }
        _d.normalize();
        _qi.copy(_qw).invert();
        _d.applyQuaternion(_qi);
        _q.setFromUnitVectors(DOWN, _d);
        c.bones[k].quaternion.copy(_q);
        _qw.multiply(_q);
      }
    }
  }
}

function pushCapsule(p, A, B, r) {
  _b.subVectors(B, A);
  const l2 = _b.lengthSq() || 1e-9;
  let t = _e.subVectors(p, A).dot(_b) / l2;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  _e.copy(A).addScaledVector(_b, t);
  _e.subVectors(p, _e);
  const d2 = _e.lengthSq();
  if (d2 >= r * r || d2 < 1e-12) return;
  const d = Math.sqrt(d2);
  p.addScaledVector(_e, (r - d) / d);
}

// keep p outside an elliptic cone (node-local Y axis); radii lerp y0 -> y1
const _l = new THREE.Vector3();
function pushCone(p, co, pr) {
  _l.copy(p).applyMatrix4(co.inv);
  const y = _l.y;
  if (y > co.y0 || y < co.y1) return;
  const t = (co.y0 - y) / (co.y0 - co.y1);
  const rx = co.r0x + (co.r1x - co.r0x) * t + pr, rz = co.r0z + (co.r1z - co.r0z) * t + pr;
  const e = (_l.x * _l.x) / (rx * rx) + (_l.z * _l.z) / (rz * rz);
  if (e >= 1 || e < 1e-8) return;
  const k = 1 / Math.sqrt(e);
  _l.x *= k; _l.z *= k;
  p.copy(_l.applyMatrix4(co.mw));
}
