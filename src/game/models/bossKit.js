import * as THREE from 'three';
import { clamp } from './core.js';

// ---------------------------------------------------------------------------
// Boss kit: tools the five boss models share on top of the rig system.
//
//  - FX meshes: a few plain additive meshes hung on bones (shockwave rings, auras,
//    glow sheets). They are not merged into the rig's material meshes, so each one
//    can fade on its own; each costs one draw call, so bosses use only a handful.
//    Materials are cloned per instance on first use.
//  - Ropes: verlet chains simulated in world space (so turning and lunging swing
//    them), aimed back onto bone chains. Chains, capes, slime strands.
//  - Two-bone arm IK, so a second hand stays on a two-handed haft.
// All per-frame work reuses module scratch objects: pose functions never allocate.
// ---------------------------------------------------------------------------

const _M = new THREE.Matrix4(), _C = new THREE.Matrix4(), _R = new THREE.Matrix4();
const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _q3 = new THREE.Quaternion();
const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3(), _s = new THREE.Vector3();
const _e = new THREE.Euler();

// ------------------------------------------------------------ fx meshes ----
const FX_BASE = new Map();
function fxBaseMat(kind) {
  if (FX_BASE.has(kind)) return FX_BASE.get(kind);
  const m = new THREE.MeshBasicMaterial({
    vertexColors: true, transparent: true, depthWrite: false, side: THREE.DoubleSide,
    blending: kind === 'normal' ? THREE.NormalBlending : THREE.AdditiveBlending, fog: true,
  });
  m.name = 'bossfx:' + kind;
  FX_BASE.set(kind, m);
  return m;
}
// colour a geometry per vertex: fn(v: Vector3, i) -> [r,g,b,a]
export function paint(geo, fn) {
  const p = geo.getAttribute('position');
  const col = new Float32Array(p.count * 4);
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) { v.fromBufferAttribute(p, i); const c = fn(v, i); col[i * 4] = c[0]; col[i * 4 + 1] = c[1]; col[i * 4 + 2] = c[2]; col[i * 4 + 3] = c[3] ?? 1; }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 4));
  return geo;
}
// add an fx mesh on a bone; the geometry should already carry an RGBA colour attribute (paint)
export function addFx(rig, bone, name, geo, o = {}) {
  const mesh = new THREE.Mesh(geo, fxBaseMat(o.blend ?? 'add'));
  mesh.name = 'fx:' + name;
  mesh.userData.fx = name;
  mesh.renderOrder = o.order ?? 8;
  mesh.frustumCulled = false;
  mesh.visible = false;
  if (o.x || o.y || o.z) mesh.position.set(o.x ?? 0, o.y ?? 0, o.z ?? 0);
  rig.bones[bone].add(mesh);
  return mesh;
}
// per-instance fx handles: { name: { mesh, mat } }. set(name, opacity, scale?) shows / hides.
export function fxOf(m) {
  let F = m.state.fx;
  if (F) return F;
  F = m.state.fx = { list: [] };
  m.root.traverse((o) => {
    if (!o.userData?.fx) return;
    const mat = o.material.clone();
    o.material = mat;
    o.castShadow = false;
    F[o.userData.fx] = { mesh: o, mat };
    F.list.push(F[o.userData.fx]);
  });
  const d = m.dispose;
  m.dispose = function () { for (const f of F.list) f.mat.dispose(); d.call(this); };
  return F;
}
// show an fx mesh at opacity a (hidden when ~0), optional uniform / xyz scale
export function fxSet(F, name, a, sx, sy, sz) {
  const f = F[name];
  if (!f) return;
  const on = a > 0.004;
  f.mesh.visible = on;
  if (!on) return;
  f.mat.opacity = Math.min(1, a);
  if (sx !== undefined) f.mesh.scale.set(Math.max(1e-3, sx), Math.max(1e-3, sy ?? sx), Math.max(1e-3, sz ?? sx));
}

// soft ring in the XZ plane (r0..r1) with alpha fading to 0 at both edges, peak at `peak` (0..1 across)
export function softRing(r0, r1, seg = 48, col = [1, 1, 1], peak = 0.5, rings = 4) {
  const pos = [], c = [], idx = [];
  for (let k = 0; k <= rings; k++) {
    const u = k / rings, r = r0 + (r1 - r0) * u;
    const a = u < peak ? u / peak : (1 - u) / (1 - peak);
    for (let i = 0; i <= seg; i++) { const t = (i / seg) * Math.PI * 2; pos.push(Math.sin(t) * r, 0, Math.cos(t) * r); c.push(col[0], col[1], col[2], a * a * (3 - 2 * a)); }
  }
  for (let k = 0; k < rings; k++) for (let i = 0; i < seg; i++) { const a = k * (seg + 1) + i, b = a + seg + 1; idx.push(a, b, a + 1, b, b + 1, a + 1); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(c, 4));
  g.setIndex(idx);
  return g;
}
// soft disc (alpha 1 at the centre fading out), XZ plane
export function softDisc(r, seg = 32, col = [1, 1, 1], pow = 1.5) {
  const g = softRing(0.0001, r, seg, col, 0.001, 5);
  const c = g.getAttribute('color');
  for (let i = 0; i < c.count; i++) { const k = Math.floor(i / (seg + 1)) / 5; c.setW(i, Math.pow(1 - k, pow)); }
  return g;
}
// vertical soft column (cylinder shell) fading at top and bottom: auras, light shafts
export function softColumn(r0, r1, h, seg = 24, col = [1, 1, 1], rows = 6) {
  const g = new THREE.CylinderGeometry(r1, r0, h, seg, rows, true);
  g.translate(0, h / 2, 0);
  return paint(g, (v) => { const t = v.y / h; const a = Math.sin(Math.PI * clamp(t)) ** 1.5 * (1 - t * 0.4); return [col[0], col[1], col[2], a]; });
}

// ------------------------------------------------------- bone matrices ----
// model-space matrix of a bone from its current local transforms (up to, not including, m.root)
export function boneModel(m, b, out) {
  out.identity();
  for (let o = b; o && o !== m.root; o = o.parent) { _C.compose(o.position, o.quaternion, o.scale); out.premultiply(_C); }
  return out;
}
// world matrix of a bone, from the root's current transform (the root's parent is the scene)
export function boneWorld(m, b, out) {
  boneModel(m, b, out);
  m.root.updateMatrix();
  out.premultiply(m.root.matrix);
  return out;
}
// write a bone's local rotation as target, current and the bone itself (no damping lag)
export function snapRot(m, name, e) {
  const P = m.P, i = P.idx.get(name);
  if (i === undefined) return;
  const o = i * 9;
  P.tgt[o] = P.cur[o] = e.x; P.tgt[o + 1] = P.cur[o + 1] = e.y; P.tgt[o + 2] = P.cur[o + 2] = e.z;
  P.bones[i].rotation.set(e.x, e.y, e.z);
}
// blend a bone's current rotation toward euler e by weight w (writes bone + buffers)
export function blendRot(m, name, e, w) {
  if (w >= 0.999) return snapRot(m, name, e);
  const P = m.P, i = P.idx.get(name);
  if (i === undefined || w <= 0.001) return;
  const b = P.bones[i];
  _q3.setFromEuler(e);
  b.quaternion.slerp(_q3, w);
  _e.setFromQuaternion(b.quaternion, 'XYZ');
  snapRot(m, name, _e);
}

// set a bone's local position / uniform scale directly (buffers + bone), e.g. for sim-driven bones
export function setBone(m, name, x, y, z, sc = 1) {
  const P = m.P, i = P.idx.get(name);
  if (i === undefined) return;
  const o = i * 9, r = P.rest[i];
  P.tgt[o + 3] = P.cur[o + 3] = x - r.x; P.tgt[o + 4] = P.cur[o + 4] = y - r.y; P.tgt[o + 5] = P.cur[o + 5] = z - r.z;
  P.tgt[o + 6] = P.cur[o + 6] = P.tgt[o + 7] = P.cur[o + 7] = P.tgt[o + 8] = P.cur[o + 8] = sc;
  P.bones[i].position.set(x, y, z); P.bones[i].scale.setScalar(Math.max(1e-4, sc));
}
// scale the instance's 'glow' material (eyes, runes, cracks drawn in glow) by k; cheap, change-detected
export function glowLevel(m, k, key = 'glow') {
  const st = m.state;
  st._glow = st._glow ?? {};
  if (Math.abs((st._glow[key] ?? 1) - k) < 0.02) return;
  for (const e of m.mats) if (e.key === key) {
    if (!e.base) e.base = e.color.clone();
    e.color.copy(e.base).multiplyScalar(k);
  }
  st._glow[key] = k;
  m._dirty = true;
}

// ---------------------------------------------------------------- ropes ----
// Verlet chain of n+1 points; point 0 is pinned to an anchor each step.
export class Rope {
  constructor(n, seg) {
    this.n = n;
    this.seg = Array.isArray(seg) ? seg : Array.from({ length: n }, () => seg);
    this.p = Array.from({ length: n + 1 }, () => new THREE.Vector3());
    this.o = Array.from({ length: n + 1 }, () => new THREE.Vector3());
    this.init = false;
  }
  // place the chain hanging along dir from the anchor (used on first step / teleports)
  reset(anchor, dir) {
    this.p[0].copy(anchor);
    for (let i = 1; i <= this.n; i++) this.p[i].copy(this.p[i - 1]).addScaledVector(dir, this.seg[i - 1]);
    for (let i = 0; i <= this.n; i++) this.o[i].copy(this.p[i]);
    this.init = true;
  }
  // o: { g (gravity m/s2), damp (per second), floor (world y), iters, spheres: [[Vector3, r]], stiff (0..1 pull toward goal), goal: fn(i, out) }
  step(anchor, dt, o = {}) {
    const n = this.n, p = this.p, pr = this.o;
    if (!this.init || p[0].distanceToSquared(anchor) > 25) { _v.set(0, -1, 0); this.reset(anchor, _v); }
    if (dt <= 0) return this;
    dt = Math.min(dt, 1 / 30);
    const g = (o.g ?? 9.8) * dt * dt, k = Math.exp(-(o.damp ?? 1.5) * dt);
    for (let i = 1; i <= n; i++) {
      const a = p[i], b = pr[i];
      const vx = (a.x - b.x) * k, vy = (a.y - b.y) * k, vz = (a.z - b.z) * k;
      b.copy(a);
      a.x += vx + (o.wx ?? 0) * dt * dt; a.y += vy - g; a.z += vz + (o.wz ?? 0) * dt * dt;
      if (o.goal && o.stiff) { o.goal(i, _v2); a.lerp(_v2, o.stiff); }
    }
    pr[0].copy(p[0]); p[0].copy(anchor);
    const it = o.iters ?? 3;
    for (let r = 0; r < it; r++) {
      for (let i = 0; i < n; i++) {
        const a = p[i], b = p[i + 1];
        _v.subVectors(b, a);
        const d = _v.length() || 1e-6, L = this.seg[i];
        const diff = (d - L) / d;
        if (i === 0) b.addScaledVector(_v, -diff);
        else { a.addScaledVector(_v, diff * 0.5); b.addScaledVector(_v, -diff * 0.5); }
      }
      if (o.spheres) for (const [c, rad] of o.spheres) for (let i = 1; i <= n; i++) {
        _v.subVectors(p[i], c); const d = _v.length();
        if (d < rad && d > 1e-6) p[i].addScaledVector(_v, (rad - d) / d);
      }
      if (o.floor !== undefined) for (let i = 1; i <= n; i++) if (p[i].y < o.floor) { p[i].y = o.floor; pr[i].x = lerpN(pr[i].x, p[i].x, 0.5); pr[i].z = lerpN(pr[i].z, p[i].z, 0.5); }
    }
    return this;
  }
}
const lerpN = (a, b, t) => a + (b - a) * t;

// Aim a chain of bones (each the child of the previous) along rope points 0..n.
// axes[i]: the bone's rest direction toward its child in its own frame (unit Vector3), w: blend weight.
export function aimChain(m, names, rope, axes, w = 1) {
  const b0 = m.bones[names[0]];
  boneWorld(m, b0.parent, _M);
  _M.decompose(_v3, _q, _s); // parent world rotation
  for (let i = 0; i < names.length; i++) {
    const b = m.bones[names[i]];
    _v.subVectors(rope.p[i + 1], rope.p[i]).normalize();
    _q2.copy(_q).invert();
    _v.applyQuaternion(_q2); // desired dir in parent frame
    _q2.setFromUnitVectors(axes[i], _v);
    if (w < 0.999) { _q3.setFromEuler(b.rotation); _q2.slerpQuaternions(_q3, _q2, w); }
    _e.setFromQuaternion(_q2, 'XYZ');
    snapRot(m, names[i], _e);
    _q.multiply(_q2);
  }
}
// world position of a bone's origin (or of a local offset on it)
export function bonePos(m, b, out, x = 0, y = 0, z = 0) {
  boneWorld(m, b, _R);
  return out.set(x, y, z).applyMatrix4(_R);
}

// ------------------------------------------------------------------ IK ----
// Two-bone IK for a humanoid arm (arm -> fore -> hand, limbs along -Y). Moves the wrist
// (hand bone origin) to world point `target`, elbow bending toward world direction `pole`.
// w blends from the current pose. The hand keeps its current world rotation unless handQ is given.
const _S = new THREE.Vector3(), _T = new THREE.Vector3(), _E = new THREE.Vector3(), _A = new THREE.Vector3(), _B = new THREE.Vector3();
const _qa = new THREE.Quaternion(), _qf = new THREE.Quaternion(), _qp = new THREE.Quaternion(), _qh = new THREE.Quaternion(), _qw = new THREE.Quaternion();
const _DOWN = new THREE.Vector3(0, -1, 0);
export function armIK(m, side, target, pole, w = 1, handQ = null) {
  if (w <= 0.001) return;
  const S = side > 0 ? 'L' : 'R';
  const arm = m.bones['arm' + S], fore = m.bones['fore' + S], hand = m.bones['hand' + S];
  // current world rotation of the hand, to keep it
  boneWorld(m, hand, _M); _M.decompose(_v3, _qh, _s);
  if (handQ) _qh.copy(handQ);
  boneWorld(m, arm.parent, _M); _M.decompose(_v3, _qp, _s);
  const sc = _s.x; // uniform scale of the chest frame in world (model scale)
  _S.copy(arm.position).applyMatrix4(_M); // shoulder (world)
  const U = fore.position.length() * sc, F = hand.position.length() * sc;
  _T.subVectors(target, _S);
  let d = _T.length();
  const dd = clamp(d, Math.abs(U - F) + 1e-3, (U + F) * 0.999);
  _T.multiplyScalar(dd / (d || 1)); d = dd;
  // elbow: in the plane of (T, pole)
  const cosA = clamp((U * U + d * d - F * F) / (2 * U * d), -1, 1), sinA = Math.sqrt(1 - cosA * cosA);
  _A.copy(_T).normalize();
  _B.copy(pole).addScaledVector(_A, -pole.dot(_A));
  if (_B.lengthSq() < 1e-6) _B.set(0, 0, 1).addScaledVector(_A, -_A.z);
  _B.normalize();
  _E.copy(_S).addScaledVector(_A, U * cosA).addScaledVector(_B, U * sinA);
  // upper arm: local -Y toward elbow
  _v.subVectors(_E, _S).normalize().applyQuaternion(_qw.copy(_qp).invert());
  _qa.setFromUnitVectors(_DOWN, _v);
  // keep some of the current twist about the limb axis: blend from current
  const curA = _q3.setFromEuler(arm.rotation);
  _q.copy(curA).slerp(_qa, w);
  _e.setFromQuaternion(_q, 'XYZ'); snapRot(m, 'arm' + S, _e);
  // forearm
  _qw.copy(_qp).multiply(_q); // arm world rot
  _v.subVectors(_S.addScaledVector(_T, 1), _E).normalize().applyQuaternion(_q2.copy(_qw).invert()); // _S now = target
  _qf.setFromUnitVectors(_DOWN, _v);
  _q.copy(_q3.setFromEuler(fore.rotation)).slerp(_qf, w);
  _e.setFromQuaternion(_q, 'XYZ'); snapRot(m, 'fore' + S, _e);
  // hand: restore its world rotation
  _qw.multiply(_q);
  _q.copy(_qw).invert().multiply(_qh);
  _q2.setFromEuler(hand.rotation).slerp(_q, w);
  _e.setFromQuaternion(_q2, 'XYZ'); snapRot(m, 'hand' + S, _e);
}

// Grip a haft: hand `side` closes around world point `grip` on a shaft running along world
// direction `axis`. The palm wraps the shaft from the forearm's side; `flip` reverses the
// grip (knuckles the other way). `pole`: world direction the elbow bends toward.
const _gY = new THREE.Vector3(), _gX = new THREE.Vector3(), _gZ = new THREE.Vector3(), _gW = new THREE.Vector3(), _gS = new THREE.Vector3(), _gM = new THREE.Matrix4(), _gQ = new THREE.Quaternion();
export function gripIK(m, side, grip, axis, pole, w = 1, flip = false, palm = 0.075) {
  if (w <= 0.001) return;
  const S = side > 0 ? 'L' : 'R';
  const arm = m.bones['arm' + S];
  boneWorld(m, arm.parent, _gM);
  _gS.copy(arm.position).applyMatrix4(_gM); // shoulder
  _gM.decompose(_v3, _gQ, _s);
  const sc = _s.x;
  _gZ.copy(axis).normalize(); if (flip) _gZ.negate();
  // wrist sits on the shoulder's side of the shaft
  _gY.subVectors(_gS, grip); _gY.addScaledVector(_gZ, -_gY.dot(_gZ));
  if (_gY.lengthSq() < 1e-8) _gY.set(0, 1, 0);
  _gY.normalize();
  _gX.crossVectors(_gY, _gZ).normalize();
  _gY.crossVectors(_gZ, _gX);
  _gM.makeBasis(_gX, _gY, _gZ);
  _gQ.setFromRotationMatrix(_gM);
  _gW.copy(grip).addScaledVector(_gY, palm * sc);
  armIK(m, side, _gW, pole, w, _gQ);
}

// critically damped (zeta < 1: a little overshoot) spring on a plain object's numeric fields
export function springTo(state, target, keys, dt, omega, zeta = 1) {
  const v = state._v ?? (state._v = {});
  const n = Math.max(1, Math.ceil(dt * omega / 0.5)), h = dt / n;
  for (const k of keys) {
    let x = state[k] ?? target[k], vk = v[k] ?? 0;
    for (let i = 0; i < n; i++) { vk += (omega * omega * (target[k] - x) - 2 * zeta * omega * vk) * h; x += vk * h; }
    v[k] = vk; state[k] = x;
  }
}

// ------------------------------------------------------- weapons ----
// Orientation of a hafted weapon bone whose shaft runs along its local +Y and whose edge
// faces local +Z, from the haft's yaw th (0 = forward), pitch ph (+ up; past PI/2 it points
// back over the head) and roll ps of the edge about the haft. Writes a rotation basis.
const _hY = new THREE.Vector3(), _hU = new THREE.Vector3(), _hV = new THREE.Vector3(), _hZ = new THREE.Vector3(), _hX = new THREE.Vector3();
export function haftBasis(th, ph, ps, out) {
  const ct = Math.cos(th), sT = Math.sin(th), cp = Math.cos(ph), sp = Math.sin(ph);
  _hY.set(sT * cp, sp, ct * cp);
  _hU.set(-sT * sp, cp, -ct * sp);
  _hV.crossVectors(_hY, _hU);
  _hZ.copy(_hU).multiplyScalar(Math.cos(ps)).addScaledVector(_hV, Math.sin(ps));
  _hX.crossVectors(_hY, _hZ);
  return out.makeBasis(_hX, _hY, _hZ);
}
// Pose weapon bone `bone` (child of the chest) from params ax {th, ph, ps, gx, gy, gz} and
// close the hands on it: grips [{ side, y (along the haft), w, flip }], poles in chest space.
const _wM = new THREE.Matrix4(), _wQ = new THREE.Quaternion(), _wE = new THREE.Euler(), _wP = new THREE.Vector3(), _wS = new THREE.Vector3();
const _wG = new THREE.Vector3(), _wA = new THREE.Vector3(), _wPole = new THREE.Vector3();
export function wield(m, bone, ax, grips, poles) {
  haftBasis(ax.th, ax.ph, ax.ps, _wM);
  _wQ.setFromRotationMatrix(_wM);
  _wE.setFromQuaternion(_wQ, 'XYZ');
  snapRot(m, bone, _wE);
  setBone(m, bone, ax.gx, ax.gy, ax.gz, 1);
  boneWorld(m, m.bones[bone], _wM);
  _wA.setFromMatrixColumn(_wM, 1).normalize();
  for (let i = 0; i < grips.length; i++) {
    const g = grips[i];
    if (g.w <= 0.001) continue;
    boneWorld(m, m.bones[bone], _wM);
    _wG.set(0, g.y, 0).applyMatrix4(_wM);
    boneWorld(m, m.bones.chest, _wM);
    _wM.decompose(_wP, _wQ, _wS);
    const pl = poles[g.side > 0 ? 0 : 1];
    _wPole.set(pl[0], pl[1], pl[2]).applyQuaternion(_wQ);
    gripIK(m, g.side, _wG, _wA, _wPole, g.w, !!g.flip);
  }
}

// swing trail: an annular sector in its local XZ plane, leading edge on +Z, trailing toward -X
export function swingTrailGeo(r0, r1, span, col) {
  const pos = [], c = [], idx = [], A = 24, Rr = 3;
  for (let i = 0; i <= A; i++) {
    const u = i / A, a = -u * span;
    for (let k = 0; k <= Rr; k++) {
      const v = k / Rr, r = r0 + (r1 - r0) * v;
      pos.push(Math.sin(a) * r, 0, Math.cos(a) * r);
      c.push(col[0], col[1], col[2], (1 - u) ** 2.2 * Math.sin(Math.PI * (0.15 + v * 0.85)) * (0.4 + 0.6 * v));
    }
  }
  for (let i = 0; i < A; i++) for (let k = 0; k < Rr; k++) { const a = i * (Rr + 1) + k, b = a + Rr + 1; idx.push(a, b, a + 1, b, b + 1, a + 1); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(c, 4));
  g.setIndex(idx);
  return g;
}
// lay a swing trail (child of the weapon's parent) in the plane of the swing from the weapon
// params ax and their spring velocities ax._v; returns how fast the weapon is moving (rad/s)
const _tY = new THREE.Vector3(), _tV = new THREE.Vector3(), _tU = new THREE.Vector3(), _tM = new THREE.Matrix4();
export function aimTrail(mesh, ax) {
  const v = ax._v ?? {}, vt = v.th ?? 0, vp = v.ph ?? 0;
  const th = ax.th, ph = ax.ph, ct = Math.cos(th), sT = Math.sin(th), cp = Math.cos(ph), sp = Math.sin(ph);
  _tY.set(sT * cp, sp, ct * cp);
  _tV.set(ct * cp, 0, -sT * cp).multiplyScalar(vt).addScaledVector(_tU.set(-sT * sp, cp, -ct * sp), vp);
  const speed = _tV.length();
  if (speed > 1e-3) {
    _tV.multiplyScalar(1 / speed);
    _tU.crossVectors(_tY, _tV);
    _tM.makeBasis(_tV, _tU, _tY);
    mesh.quaternion.setFromRotationMatrix(_tM);
    mesh.position.set(ax.gx, ax.gy, ax.gz);
  }
  return speed;
}
