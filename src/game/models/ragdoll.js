// Physical deaths for the human-shaped foes (humanSkeleton rigs): the body goes limp at the killing blow and
// falls under its own weight instead of playing a canned fall. A handful of points (joints) joined by
// distance constraints along the bones, braces that keep the torso and pelvis rigid and limits that keep a
// limb from folding flat, integrated (Verlet) with gravity, the floor under each point and the walls; each
// frame the bones are turned to follow their points - limbs swing to aim at their next joint, the pelvis,
// spine, chest, neck and head take a whole frame from two axes (up the body, across it) so they don't spin
// on themselves. Hands, feet, jaws, weapons, capes and the rest ride on their bones as ever.
// Visual only, on each peer: started from the last blow's push, it settles within a second or two and
// then stops costing anything. Cost while live: ~20 points, ~40 constraints, 5 iterations at 90 Hz.
import * as THREE from 'three';

// the joints that become points, and the ones made up (a head's crown, to turn the head by)
const JOINTS = ['hips', 'spine', 'chest', 'neck', 'head', 'armL', 'foreL', 'handL', 'armR', 'foreR', 'handR', 'thighL', 'shinL', 'footL', 'thighR', 'shinR', 'footR'];
// stiff links: along the bones, and the braces that make the trunk one piece
const BONE_LINKS = [['hips', 'spine'], ['spine', 'chest'], ['chest', 'neck'], ['neck', 'head'], ['head', 'crown'],
  ['chest', 'armL'], ['armL', 'foreL'], ['foreL', 'handL'], ['chest', 'armR'], ['armR', 'foreR'], ['foreR', 'handR'],
  ['hips', 'thighL'], ['thighL', 'shinL'], ['shinL', 'footL'], ['hips', 'thighR'], ['thighR', 'shinR'], ['shinR', 'footR']];
const BRACES = [['thighL', 'thighR'], ['armL', 'armR'], ['spine', 'thighL'], ['spine', 'thighR'], ['chest', 'thighL'], ['chest', 'thighR'],
  ['hips', 'chest'], ['neck', 'armL'], ['neck', 'armR'], ['hips', 'armL'], ['hips', 'armR'], ['spine', 'armL'], ['spine', 'armR'], ['hips', 'neck']];
// loose: the head nods and rolls, but not right round
const SOFT = [['head', 'chest', 0.35], ['crown', 'neck', 0.35], ['crown', 'chest', 0.2]];
// a limb can fold, not past this share of its length (an elbow or knee bent double)
const FOLD = [['armL', 'handL', 0.45], ['armR', 'handR', 0.45], ['thighL', 'footL', 0.5], ['thighR', 'footR', 0.5]];
// how each bone is turned: [bone, parent bone it is solved under, kind, a, b, c, d]
//   frame: up = a->b, across = c->d; swing: aims a->b
const SOLVE = [
  ['hips', null, 'frame', 'hips', 'chest', 'thighR', 'thighL'],
  ['spine', 'hips', 'frame', 'spine', 'chest', 'thighR', 'thighL'],
  ['chest', 'spine', 'frame', 'chest', 'neck', 'armR', 'armL'],
  ['neck', 'chest', 'frame', 'neck', 'head', 'armR', 'armL'],
  ['head', 'neck', 'frame', 'head', 'crown', 'armR', 'armL'],
  ['armL', 'chest', 'swing', 'armL', 'foreL'], ['foreL', 'armL', 'swing', 'foreL', 'handL'],
  ['armR', 'chest', 'swing', 'armR', 'foreR'], ['foreR', 'armR', 'swing', 'foreR', 'handR'],
  ['thighL', 'hips', 'swing', 'thighL', 'shinL'], ['shinL', 'thighL', 'swing', 'shinL', 'footL'],
  ['thighR', 'hips', 'swing', 'thighR', 'shinR'], ['shinR', 'thighR', 'swing', 'shinR', 'footR'],
];
const STEP = 1 / 90, ITERS = 5, GRAV = 15;

const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion();
const _m = new THREE.Matrix4(), _m2 = new THREE.Matrix4();
const _x = new THREE.Vector3(), _y = new THREE.Vector3(), _z = new THREE.Vector3();

// may this body fall limp? (a humanSkeleton's joints, a plain fall; not a ghost, a pile of bones or a boss)
export function canRagdoll(m) {
  const A = m.spec.anim ?? {}, st = A.death ?? 'fall';
  if (m.spec.ragdoll === false || m.spec.boss || A.gait === 'float' || m._flying) return false;
  if (st !== 'fall' && st !== 'fallBack' && st !== 'kneel') return false;
  for (const n of ['hips', 'chest', 'neck', 'head', 'armL', 'foreL', 'armR', 'foreR', 'thighL', 'shinL', 'footL', 'thighR', 'shinR', 'footR']) if (!m.bones[n]) return false;
  return true;
}

// right-handed frame from an up axis and a rough across axis, into m (columns x, y, z)
function frameOf(up, across, m) {
  _y.copy(up).normalize();
  _x.copy(across).addScaledVector(_y, -across.dot(_y));
  if (_x.lengthSq() < 1e-8) return false;
  _x.normalize();
  _z.crossVectors(_x, _y);
  m.makeBasis(_x, _y, _z);
  return true;
}

export class Ragdoll {
  // m: the EnemyInstance; o: { vx, vz } the push (world m/s), up (m/s), spin, carry: { x, z } its own motion
  constructor(m, o = {}) {
    this.m = m;
    m.root.updateMatrixWorld(true);
    const sc = (m.height ?? 1.8) / 1.8;
    this.sc = sc;
    const P = this.pts = {};
    const add = (name, pos, r) => { P[name] = { p: pos.clone(), q: pos.clone(), r, ground: false }; };
    for (const n of JOINTS) {
      const b = m.bones[n];
      if (!b) continue;
      const r = n === 'hips' || n === 'spine' || n === 'chest' ? 0.13 : n === 'head' ? 0.11 : /^hand|^foot/.test(n) ? 0.05 : 0.07;
      add(n, b.getWorldPosition(_v), r * sc);
    }
    if (!P.spine) add('spine', P.hips.p.clone().lerp(P.chest.p, 0.2), 0.13 * sc);
    // the crown: up the head from its joint, by the head's own up
    const hb = m.bones.head;
    hb.getWorldQuaternion(_q);
    add('crown', P.head.p.clone().add(_v.set(0, 0.24 * sc, 0).applyQuaternion(_q)), 0.1 * sc);
    if (!P.handL) add('handL', P.foreL.p.clone().add(_v.subVectors(P.foreL.p, P.armL.p).multiplyScalar(0.9)), 0.05 * sc);
    if (!P.handR) add('handR', P.foreR.p.clone().add(_v.subVectors(P.foreR.p, P.armR.p).multiplyScalar(0.9)), 0.05 * sc);
    // links, at the lengths they have now
    const link = (a, b, k, min = false) => { if (P[a] && P[b]) this.links.push({ a: P[a], b: P[b], d: P[a].p.distanceTo(P[b].p), k, min }); };
    this.links = [];
    for (const [a, b] of BONE_LINKS) link(a, b, 1);
    for (const [a, b] of BRACES) link(a, b, 0.9);
    for (const [a, b, k] of SOFT) link(a, b, k);
    for (const [a, b, f] of FOLD) {
      if (!P[a] || !P[b]) continue;
      const mid = a.startsWith('arm') ? 'fore' + a.slice(3) : 'shin' + a.slice(5);
      // (never more open than it is now: a body killed in a crouch would be flung up by its own legs)
      const len = P[a].p.distanceTo(P[mid].p) + P[mid].p.distanceTo(P[b].p);
      this.links.push({ a: P[a], b: P[b], d: Math.min(len * f, P[a].p.distanceTo(P[b].p) * 0.98), k: 1, min: true });
    }
    // (a point that starts in the floor - an ankle under a sole, a foot sunk into a step - lifts the whole
    // body by as much, all of a piece: moved on its own it would stretch a leg, and the stretch fling it up)
    if (o.floor) {
      let lift = 0;
      for (const n in P) { const pt = P[n]; lift = Math.max(lift, o.floor(pt.p.x, pt.p.z) + pt.r - pt.p.y); }
      if (lift > 0) for (const n in P) P[n].p.y += lift;
    }
    // the push: the upper body harder than the feet, so it topples the way it was struck
    const lo = P.footL.p.y, hi = P.crown.p.y, span = Math.max(0.3, hi - lo);
    const vx = o.vx ?? 0, vz = o.vz ?? 0, up = o.up ?? 1, spin = o.spin ?? 0, cx = o.carry?.x ?? 0, cz = o.carry?.z ?? 0;
    for (const n in P) {
      const pt = P[n], h = (pt.p.y - lo) / span;
      const w = 0.35 + 0.95 * h;
      // a little twist about the body's middle (the blow lands off-centre), and its own way of going
      const ox = pt.p.x - P.hips.p.x, oz = pt.p.z - P.hips.p.z;
      const vxi = vx * w + cx - oz * spin, vzi = vz * w + cz + ox * spin, vyi = up * (0.4 + 0.6 * h);
      pt.q.set(pt.p.x - vxi * STEP, pt.p.y - vyi * STEP, pt.p.z - vzi * STEP);
    }
    // each solved bone's starting world turn and the axes that drive it
    this.solve = [];
    for (const [bn, parent, kind, a, b, c, d] of SOLVE) {
      const bone = m.bones[bn];
      if (!bone || !P[a] || !P[b]) continue;
      const s = { bone, parent: parent ? m.bones[parent] : null, kind, a: P[a], b: P[b], c: P[c], d: P[d], q0: bone.getWorldQuaternion(new THREE.Quaternion()), w: new THREE.Quaternion() };
      if (kind === 'frame') {
        s.B0 = new THREE.Matrix4();
        if (!frameOf(_v.subVectors(s.b.p, s.a.p), _v2.subVectors(s.d.p, s.c.p), s.B0)) s.kind = 'swing';
      }
      if (s.kind === 'swing') s.d0 = new THREE.Vector3().subVectors(s.b.p, s.a.p).normalize();
      s.ps = s.parent ? this.solve.find((x) => x.bone === s.parent) ?? null : null; // (solved before it: parents come first)
      if (s.parent && !s.ps) continue;
      this.solve.push(s);
    }
    // the hips' parent stays where it is: its world turn and inverse, to set the hips' place and turn under it
    const hp = m.bones.hips.parent;
    this.parentQ = hp.getWorldQuaternion(new THREE.Quaternion());
    this.parentInv = new THREE.Matrix4().copy(hp.matrixWorld).invert();
    this.t = 0; this.still = 0; this.done = false; this.acc = 0;
  }

  // a blast nearby (centre, reach, strength in m/s at its heart): every point within reach is thrown off it
  // and a little up, harder the nearer; a body at rest wakes for another couple of seconds
  blast(c, R, k) {
    let hit = false;
    for (const n in this.pts) {
      const pt = this.pts[n];
      _v.subVectors(pt.p, c);
      const d = _v.length();
      if (d > R) continue;
      const f = k * (1 - d / R);
      _v.multiplyScalar(f / Math.max(0.3, d)); _v.y += f * 0.9;
      pt.q.addScaledVector(_v, -STEP);
      hit = true;
    }
    if (hit) { this.done = false; this.still = 0; this.t = Math.min(this.t, 1.5); }
    return hit;
  }

  step(dt, floor, wall) {
    if (this.done) return;
    this.t += dt;
    this.acc = Math.min(this.acc + dt, 0.1);
    const P = this.pts;
    let moved = 0;
    while (this.acc >= STEP) {
      this.acc -= STEP;
      for (const n in P) {
        const pt = P[n], p = pt.p, q = pt.q;
        const vx = (p.x - q.x) * 0.997, vy = (p.y - q.y) * 0.997, vz = (p.z - q.z) * 0.997;
        q.copy(p);
        p.x += vx; p.y += vy - GRAV * STEP * STEP; p.z += vz;
      }
      for (let it = 0; it < ITERS; it++) {
        for (const L of this.links) {
          const a = L.a.p, b = L.b.p;
          _v.subVectors(b, a);
          const d = _v.length();
          if (d < 1e-6 || (L.min && d >= L.d)) continue;
          const k = ((d - L.d) / d) * 0.5 * L.k;
          a.addScaledVector(_v, k); b.addScaledVector(_v, -k);
        }
        // the floor under each point, and the walls
        for (const n in P) {
          const pt = P[n], p = pt.p;
          if (wall && wall(p.x, p.z, p.y)) { p.x = pt.q.x; p.z = pt.q.z; }
          const fy = (floor ? floor(p.x, p.z) : 0) + pt.r;
          if (p.y < fy) {
            p.y = fy;
            // friction: the point's slide along the floor is mostly lost where it rests
            pt.q.x = p.x - (p.x - pt.q.x) * 0.55; pt.q.z = p.z - (p.z - pt.q.z) * 0.55;
            if (pt.q.y < p.y) pt.q.y = p.y;
            pt.ground = true;
          } else pt.ground = false;
        }
      }
      for (const n in P) moved = Math.max(moved, P[n].p.distanceToSquared(P[n].q));
    }
    this._pose();
    // at rest for a moment (or long enough): it stops here, posed as it lies
    this.still = moved < 4e-6 ? this.still + dt : 0; // (2 mm a step: what the braces still jostle at rest)
    if ((this.still > 0.35 && this.t > 0.6) || this.t > 3.5) this.done = true;
  }

  _pose() {
    for (const s of this.solve) {
      const b = s.bone;
      if (s.kind === 'frame') {
        if (frameOf(_v.subVectors(s.b.p, s.a.p), _v2.subVectors(s.d.p, s.c.p), _m)) {
          // R = B * B0^T: the turn that carries the starting frame onto this one
          _m2.copy(s.B0).transpose();
          _m.multiply(_m2);
          _q.setFromRotationMatrix(_m);
          s.w.copy(_q).multiply(s.q0);
        }
      } else {
        _v.subVectors(s.b.p, s.a.p);
        if (_v.lengthSq() > 1e-8) { _q.setFromUnitVectors(s.d0, _v.normalize()); s.w.copy(_q).multiply(s.q0); }
      }
      const pq = s.ps ? s.ps.w : this.parentQ;
      b.quaternion.copy(_q2.copy(pq).invert().multiply(s.w));
    }
    // the pelvis where its point is
    const hips = this.m.bones.hips;
    hips.position.copy(this.pts.hips.p).applyMatrix4(this.parentInv);
  }
}
