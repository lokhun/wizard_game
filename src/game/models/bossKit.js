import * as THREE from 'three';
import { clamp, smooth, bump } from './core.js';
import { bandGeo, embroidery } from './wizard/garments.js';

// ---------------------------------------------------------------------------
// Boss kit: tools the five boss models share on top of the rig system.
//
//  - FX meshes: a few additive sheets on their own bones (shockwave rings, auras, trails)
//    that fade on their own. They reuse the rig's material types (no new shaders) and
//    cost one draw call each, so bosses use only a handful.
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
// An fx is a rig part on its own bone ('fx_<name>') flagged `own`, so Rig.finish gives it a
// separate skinned mesh with a clone of a library material every enemy already uses ('glow'
// by default, the eyes' unlit material, switched to additive blending per instance). Same
// shader program: nothing new to compile, one extra draw call. It fades with its material
// opacity and moves, turns and sizes through its bone. Faces are doubled (the material is
// single-sided) and the RGBA colour attribute (paint, softRing ...) is premultiplied into
// RGB, since the material has no vertex alpha.
const FXP = Symbol('fx');
// colour a geometry per vertex: fn(v: Vector3, i) -> [r,g,b,a]
export function paint(geo, fn) {
  const p = geo.getAttribute('position');
  const col = new Float32Array(p.count * 4);
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) { v.fromBufferAttribute(p, i); const c = fn(v, i); col[i * 4] = c[0]; col[i * 4 + 1] = c[1]; col[i * 4 + 2] = c[2]; col[i * 4 + 3] = c[3] ?? 1; }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 4));
  return geo;
}
export function addFx(rig, bone, name, geo, o = {}) {
  const b = 'fx_' + name;
  rig.bone(b, bone, o.x ?? 0, o.y ?? 0, o.z ?? 0);
  const c = geo.getAttribute('color');
  const n = geo.getAttribute('position').count;
  const vcol = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const a = c && c.itemSize === 4 ? c.getW(i) : 1;
    vcol[i * 3] = (c ? c.getX(i) : 1) * a; vcol[i * 3 + 1] = (c ? c.getY(i) : 1) * a; vcol[i * 3 + 2] = (c ? c.getZ(i) : 1) * a;
  }
  if (c) geo.deleteAttribute('color');
  if (!o.mat) {
    // both faces, so the single-sided material shows it from either side
    if (!geo.index) geo.setIndex([...Array(n).keys()]);
    const ix = geo.index.array, two = new Uint32Array(ix.length * 2);
    two.set(ix);
    for (let t = 0; t < ix.length; t += 3) { two[ix.length + t] = ix[t]; two[ix.length + t + 1] = ix[t + 2]; two[ix.length + t + 2] = ix[t + 1]; }
    geo.setIndex(new THREE.BufferAttribute(two, 1));
  }
  rig.add(b, o.mat ?? 'glow', geo, {}, { own: name, vcol });
  return b;
}
// per-instance fx handles: F[name] = { mesh, e (its instance material entry), bone, x, y, z }
export function fxOf(m) {
  let F = m.state[FXP];
  if (F) return F;
  F = m.state[FXP] = { m };
  m.root.traverse((o) => {
    const n = o.userData?.fx;
    if (!n || !o.isSkinnedMesh) return;
    const e = m.mats.find((x) => x.m === o.material);
    if (e && o.material.isMeshBasicMaterial) {
      // additive, see-through: blending / depth state only, the compiled program is reused
      e.transparent = true; e.depthWrite = false;
      o.material.blending = THREE.AdditiveBlending; o.material.transparent = true; o.material.depthWrite = false; o.material.needsUpdate = true;
    }
    const bone = 'fx_' + n, r = m.P.rest[m.P.idx.get(bone)];
    o.castShadow = false;
    o.visible = false;
    F[n] = { mesh: o, e, bone, x: r.x, y: r.y, z: r.z, a: -1 };
  });
  return F;
}
// show an fx at opacity a (hidden when ~0), with an optional uniform / xyz scale on its bone
export function fxSet(F, name, a, sx = 1, sy = sx, sz = sx) {
  const f = F[name];
  if (!f) return;
  const on = a > 0.004;
  f.mesh.visible = on;
  const op = on ? Math.min(1, a) : 0;
  if (Math.abs(op - f.a) > 0.004) { f.a = op; if (f.e) { f.e.opacity = op; F.m._dirty = true; } }
  const P = F.m.P, i = P.idx.get(f.bone), o = i * 9, r = P.rest[i];
  P.tgt[o + 3] = P.cur[o + 3] = f.x - r.x; P.tgt[o + 4] = P.cur[o + 4] = f.y - r.y; P.tgt[o + 5] = P.cur[o + 5] = f.z - r.z;
  sx = Math.max(1e-3, sx); sy = Math.max(1e-3, sy); sz = Math.max(1e-3, sz);
  P.tgt[o + 6] = P.cur[o + 6] = sx; P.tgt[o + 7] = P.cur[o + 7] = sy; P.tgt[o + 8] = P.cur[o + 8] = sz;
  P.bones[i].position.set(f.x, f.y, f.z); P.bones[i].scale.set(sx, sy, sz);
}
// move an fx (its bone's local position) / turn it (euler or quaternion); call before fxSet
export function fxPos(F, name, x, y, z) { const f = F[name]; if (f) { f.x = x; f.y = y; f.z = z; } }
const _fe = new THREE.Euler();
export function fxRot(F, name, x, y, z) { const f = F[name]; if (f) snapRot(F.m, f.bone, _fe.set(x, y, z)); }
export function fxQuat(F, name, q) { const f = F[name]; if (f) snapRot(F.m, f.bone, _fe.setFromQuaternion(q, 'XYZ')); }

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
  for (const e of m.mats) if (e.key === key && !e.m.userData.fx) {
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
const _tQ = new THREE.Quaternion(), NOV = {};
export function aimTrail(F, name, ax) {
  const v = ax._v ?? NOV, vt = v.th ?? 0, vp = v.ph ?? 0;
  const th = ax.th, ph = ax.ph, ct = Math.cos(th), sT = Math.sin(th), cp = Math.cos(ph), sp = Math.sin(ph);
  _tY.set(sT * cp, sp, ct * cp);
  _tV.set(ct * cp, 0, -sT * cp).multiplyScalar(vt).addScaledVector(_tU.set(-sT * sp, cp, -ct * sp), vp);
  const speed = _tV.length();
  if (speed > 1e-3) {
    _tV.multiplyScalar(1 / speed);
    _tU.crossVectors(_tY, _tV);
    _tM.makeBasis(_tV, _tU, _tY);
    fxQuat(F, name, _tQ.setFromRotationMatrix(_tM));
    fxPos(F, name, ax.gx, ax.gy, ax.gz);
  }
  return speed;
}

// build-time helper: parameter (segment index + fraction) of the closest point on a polyline
// to v, for skinning tubes along bone chains without allocating per vertex
export function polyParam(pts) {
  const n = pts.length - 1, ax = new Float32Array(n * 6), len2 = new Float32Array(n);
  for (let i = 0; i < n; i++) { const a = pts[i], b = pts[i + 1]; ax.set([a.x, a.y, a.z, b.x - a.x, b.y - a.y, b.z - a.z], i * 6); len2[i] = (b.x - a.x) ** 2 + (b.y - a.y) ** 2 + (b.z - a.z) ** 2 || 1e-9; }
  return (v) => {
    let best = 0, bd = 1e9;
    for (let i = 0; i < n; i++) {
      const o = i * 6, px = v.x - ax[o], py = v.y - ax[o + 1], pz = v.z - ax[o + 2];
      const t = clamp((px * ax[o + 3] + py * ax[o + 4] + pz * ax[o + 5]) / len2[i]);
      const dx = px - ax[o + 3] * t, dy = py - ax[o + 4] * t, dz = pz - ax[o + 5] * t, d = dx * dx + dy * dy + dz * dz;
      if (d < bd) { bd = d; best = i + t; }
    }
    return best;
  };
}

// ------------------------------------------------------------ embroidery ----
// Embroidered bands laid over a robe() built with a surface (every robe has userData.surf):
// round it at t (0 top .. 1 hem) between angles a0 and a1, or down it at angle a from t0 to
// t1. pf: embroidery(kind, base, motif, P) from the wizards' garments (linear rgb). Returns
// { geo, vcol } for rig.add(bone, 'cloth', geo, t, { vcol }).
const lin3 = (c) => (Array.isArray(c) ? c : (() => { const k = new THREE.Color(c); return [k.r, k.g, k.b]; })());
export function embroideryOf(kind, base, motif, P) { return embroidery(kind, lin3(base), lin3(motif), P); }
function banded(g) { return { geo: g, vcol: g.getAttribute('color').array }; }
export function robeRing(robeGeo, t, w, pf, { a0 = -Math.PI, a1 = Math.PI, lift = 0.004, n = 0 } = {}) {
  const surf = robeGeo.userData.surf, pts = [], nrm = [];
  const N = n || Math.max(24, Math.round((a1 - a0) * 30));
  for (let i = 0; i <= N; i++) { const q = surf(a0 + (a1 - a0) * (i / N), t, lift); pts.push(q); nrm.push(new THREE.Vector3(q.x, 0, q.z).normalize()); }
  return banded(bandGeo(pts, nrm, w, w * 0.06, pf));
}
export function robeEdge(robeGeo, a, t0, t1, w, pf, { lift = 0.004, n = 40 } = {}) {
  const surf = robeGeo.userData.surf, pts = [], nrm = [];
  for (let i = 0; i <= n; i++) { const q = surf(a, t0 + (t1 - t0) * (i / n), lift); pts.push(q); nrm.push(new THREE.Vector3(q.x, 0, q.z).normalize()); }
  return banded(bandGeo(pts, nrm, w, w * 0.06, pf));
}
// a band over a panel() along a path of (u, t) points (its surface's +z side)
export function panelBand(panelGeo, path, w, pf, { lift = 0.004 } = {}) {
  const surf = panelGeo.userData.surf, pts = [], nrm = [];
  const e = 0.01;
  for (const [u, t] of path) {
    const q = surf(u, t, lift);
    const du = surf(u + e, t).sub(surf(u - e, t)), dt = surf(u, t + e).sub(surf(u, t - e));
    pts.push(q); nrm.push(new THREE.Vector3().crossVectors(du, dt).normalize().multiplyScalar(-1));
  }
  return banded(bandGeo(pts, nrm, w, w * 0.06, pf));
}

// A boss near its end shows it (the shared layer each boss's pose calls before its pose is eased): below ~40%
// of its health it sinks into a hunch and heaves for breath - slower, deeper, the shoulders riding each
// breath - and now and then a spasm of pain jerks the body and head; under ~20% a tremor runs through it.
// o: { hunch: [[bone, rx]...], breath: [[bone, rx]...], shoulders: [boneL, boneR], spasm: [body, head] }
// (bones a rig lacks are skipped by the pose buffer). Grows in over a second or two, never in a pop.
export function wounds(m, s, P, dt, o) {
  const st = m.state, T = m.time;
  const want = s.anim === 'death' || s.anim === 'spawn' ? 0 : smooth(0.42, 0.1, s.hpf ?? 1);
  st.woundK = (st.woundK ?? 0) + (want - (st.woundK ?? 0)) * Math.min(1, dt * 0.8);
  const k = st.woundK;
  if (k < 0.01) return;
  const br = Math.sin(T * 1.55 + 1.3), heave = 0.5 + 0.5 * br;
  for (const [b, rx] of o.hunch ?? []) P.r(b, rx * k);
  for (const [b, rx] of o.breath ?? []) P.r(b, -br * rx * k);
  if (o.shoulders) { P.r(o.shoulders[0], 0, 0, heave * 0.05 * k); P.r(o.shoulders[1], 0, 0, -heave * 0.05 * k); }
  // a spasm every few seconds: a quick hunch and a jerk of the head, gone in a third of a second
  if (st.spasmNext === undefined || T > st.spasmNext + 5) st.spasmNext = T + 2 + Math.random() * 3;
  if (T >= st.spasmNext) { st.spasmAt = T; st.spasmNext = T + 2.5 + Math.random() * 3.5; st.spasmS = Math.random() < 0.5 ? -1 : 1; }
  const sp = st.spasmAt !== undefined ? bump(0, 0.35, T - st.spasmAt) * k : 0;
  if (sp > 0 && o.spasm) { P.r(o.spasm[0], 0.12 * sp, 0.05 * sp * st.spasmS, 0.06 * sp * st.spasmS); P.r(o.spasm[1], -0.16 * sp, 0.12 * sp * st.spasmS, 0); }
  const tr = smooth(0.2, 0.08, s.hpf ?? 1) * k;
  if (tr > 0 && o.spasm) P.r(o.spasm[0], Math.sin(T * 23) * 0.008 * tr, 0, Math.sin(T * 19 + 1) * 0.008 * tr);
}
