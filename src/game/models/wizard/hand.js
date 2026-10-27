import * as THREE from 'three';
import { fingerSeg, roundedBox, sphere, mergeGeos, lathe, xf, torus, cyl, V } from './shapes.js';

// ---------------------------------------------------------------------------
// Articulated stylised hand. Built as a RIGHT hand in its own frame:
//   wrist at the origin, fingers along -Z, palm facing -Y, thumb toward -X.
// Mirror with a parent scale.x = -1 for the left hand.
// Each finger is a chain of 3 joint groups whose rotation.x = -curl.
// ---------------------------------------------------------------------------

const FINGERS = [
  // knuckle x, y, z ; segment lengths ; radii (base..tip)
  { x: -0.028, y: 0.001, z: -0.089, L: [0.041, 0.025, 0.02], r: [0.0102, 0.0094, 0.0085, 0.0074], splay: -0.06 },
  { x: -0.0092, y: 0.002, z: -0.094, L: [0.045, 0.028, 0.021], r: [0.0105, 0.0097, 0.0087, 0.0076], splay: -0.015 },
  { x: 0.0102, y: 0.001, z: -0.091, L: [0.042, 0.026, 0.02], r: [0.0099, 0.0091, 0.0082, 0.0072], splay: 0.035 },
  { x: 0.0278, y: -0.002, z: -0.082, L: [0.033, 0.02, 0.018], r: [0.0089, 0.008, 0.0073, 0.0064], splay: 0.1 },
];
const THUMB = { x: -0.027, y: -0.008, z: -0.02, L: [0.04, 0.03, 0.025], r: [0.0138, 0.0122, 0.011, 0.0096] };

// Finger curls are authored; thumb joint angles are solved (below) so the
// thumb tip lands on target points, which is far easier than hand-tuning
// Euler angles. t = [yaw, pitch, roll, curl1, curl2].
const BASE_POSES = {
  relaxed: { f: [[0.25, 0.3, 0.2, 0], [0.3, 0.35, 0.22, 0], [0.38, 0.4, 0.25, 0], [0.45, 0.45, 0.3, 0]], thumb: [[-0.049, -0.024, -0.05], [-0.059, -0.034, -0.074], [-0.058, -0.042, -0.097]] },
  open: { f: [[0.12, 0.2, 0.12, -0.04], [0.18, 0.27, 0.16, 0], [0.27, 0.34, 0.22, 0.04], [0.38, 0.42, 0.28, 0.09]], thumb: [[-0.052, -0.016, -0.046], [-0.071, -0.02, -0.066], [-0.086, -0.022, -0.086]] },
  cradle: { f: [[0.3, 0.32, 0.18, -0.05], [0.32, 0.36, 0.2, 0], [0.38, 0.4, 0.22, 0.05], [0.48, 0.45, 0.25, 0.12]], thumb: [[-0.05, -0.022, -0.048], [-0.066, -0.03, -0.068], [-0.076, -0.034, -0.09]] },
  spread: { f: [[-0.05, 0.05, 0.05, -0.2], [-0.05, 0.04, 0.04, -0.03], [0.0, 0.06, 0.05, 0.13], [0.05, 0.08, 0.06, 0.32]], thumb: [[-0.054, -0.012, -0.04], [-0.077, -0.012, -0.056], [-0.099, -0.01, -0.07]] },
  claw: { f: [[0.35, 0.95, 0.75, -0.18], [0.3, 1.0, 0.8, -0.03], [0.38, 1.0, 0.8, 0.12], [0.45, 1.0, 0.8, 0.3]], thumb: [[-0.052, -0.022, -0.045], [-0.067, -0.036, -0.062], [-0.068, -0.054, -0.078]] },
  fist: { f: [[1.35, 1.6, 0.9, 0], [1.35, 1.65, 0.9, 0], [1.35, 1.65, 0.9, 0], [1.35, 1.6, 0.9, 0]], thumb: [[-0.045, -0.032, -0.046], [-0.034, -0.052, -0.07], [-0.012, -0.058, -0.088]] },
  point: { f: [[0.05, 0.05, 0.05, -0.04], [1.35, 1.6, 0.9, 0], [1.35, 1.65, 0.9, 0], [1.35, 1.6, 0.9, 0]], thumb: [[-0.045, -0.032, -0.046], [-0.032, -0.052, -0.07], [-0.008, -0.058, -0.09]] },
  snapPre: { f: [[0.25, 0.25, 0.15, -0.05], [0.65, 0.75, 0.35, 0], [1.3, 1.55, 0.9, 0], [1.35, 1.55, 0.9, 0]], thumb: 'midtip' },
  snapPost: { f: [[0.2, 0.2, 0.1, -0.05], [1.45, 1.4, 0.7, 0], [1.3, 1.55, 0.9, 0], [1.35, 1.55, 0.9, 0]], thumb: [[-0.052, -0.02, -0.046], [-0.066, -0.03, -0.07], [-0.07, -0.034, -0.094]] },
};

// ---- forward kinematics helpers (match buildHand's joint setup) -----------
const _fk = (() => {
  const mk = (def, isThumb) => {
    const j0 = new THREE.Object3D(); j0.rotation.order = 'YXZ'; j0.position.set(def.x, def.y, def.z);
    const j1 = new THREE.Object3D(); j1.rotation.order = 'YXZ'; j1.position.set(0, 0, -def.L[0]); j0.add(j1);
    const j2 = new THREE.Object3D(); j2.rotation.order = 'YXZ'; j2.position.set(0, 0, -def.L[1]); j1.add(j2);
    const tip = new THREE.Object3D(); tip.position.set(0, 0, -def.L[2]); j2.add(tip);
    return { j0, j1, j2, tip, def, isThumb };
  };
  return { thumb: mk(THUMB, true), fingers: FINGERS.map((f) => mk(f, false)) };
})();
const _p = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
function fkThumb(t) {
  const c = _fk.thumb;
  c.j0.rotation.set(t[1], t[0], t[2]);
  c.j1.rotation.set(-t[3], 0, 0);
  c.j2.rotation.set(-t[4], 0, 0);
  c.j0.updateMatrixWorld(true);
  _p[0].setFromMatrixPosition(c.j1.matrixWorld);
  _p[1].setFromMatrixPosition(c.j2.matrixWorld);
  _p[2].setFromMatrixPosition(c.tip.matrixWorld);
  return _p;
}
export function fingerTip(i, f) {
  const c = _fk.fingers[i];
  c.j0.rotation.set(-f[0], -(c.def.splay + f[3]), 0);
  c.j1.rotation.set(-f[1], 0, 0);
  c.j2.rotation.set(-f[2], 0, 0);
  c.j0.updateMatrixWorld(true);
  return new THREE.Vector3().setFromMatrixPosition(c.tip.matrixWorld);
}

// coordinate descent: thumb joint params so joint ends hit the targets
function solveThumb(targets, init = [0.6, -0.4, -0.9, 0.3, 0.3]) {
  const t = init.slice();
  const W = [0.6, 1, 1.6];
  const cost = () => {
    const p = fkThumb(t);
    let c = 0;
    for (let i = 0; i < 3; i++) c += W[i] * p[i].distanceToSquared(targets[i]);
    // keep the roll near natural so the nail faces outward, curls positive
    c += 0.00002 * (t[2] + 0.9) * (t[2] + 0.9);
    c += t[3] < -0.1 ? (t[3] + 0.1) * (t[3] + 0.1) * 0.01 : 0;
    c += t[4] < -0.1 ? (t[4] + 0.1) * (t[4] + 0.1) * 0.01 : 0;
    return c;
  };
  let best = cost();
  let step = 0.3;
  for (let it = 0; it < 120 && step > 0.002; it++) {
    let improved = false;
    for (let k = 0; k < 5; k++) {
      for (const d of [step, -step]) {
        t[k] += d;
        const c = cost();
        if (c < best) { best = c; improved = true; } else t[k] -= d;
      }
    }
    if (!improved) step *= 0.5;
  }
  return t;
}

const v3 = (a) => new THREE.Vector3(a[0], a[1], a[2]);

// a flat vertex colour over a whole part (it multiplies the material's colour)
function paint(geo, [r, g, b]) {
  const n = geo.getAttribute('position').count, c = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { c[i * 3] = r; c[i * 3 + 1] = g; c[i * 3 + 2] = b; }
  geo.setAttribute('color', new THREE.Float32BufferAttribute(c, 3));
  return geo;
}

// A fingernail on the back of a last segment (L long, r at its tip): a curved plate following the flattened
// finger, from its middle to just past the end, with a pale half-moon at its root, the pink of the nail bed,
// darker folds at its sides and a pale free edge (vertex colours over the nail material)
const nailCache = new Map();
function nailGeo(L, r, rad) {
  const key = `${L.toFixed(4)}:${r.toFixed(4)}:${rad}`;
  if (nailCache.has(key)) return nailCache.get(key);
  const len = L * 0.6, arc = 1.6, hs = rad >= 8 ? 6 : 2;
  const g = new THREE.CylinderGeometry(r * 1.06, r * 1.04, len, rad >= 8 ? 10 : 5, hs, true, -arc / 2, arc);
  const p = g.getAttribute('position');
  const col = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const u = 0.5 - y / len; // 0 root .. 1 free edge
    const side = Math.abs(Math.atan2(x, z)) / (arc / 2);
    // (the plate dips toward the tip, following the rounded end; flatter than round, like the finger)
    p.setXYZ(i, x * 1.04, y, z * 0.74 - Math.max(0, u - 0.7) * r * 0.5);
    const lun = Math.exp(-Math.pow(u / 0.16, 2)) * (1 - side * side);
    const edge = Math.max(0, (u - 0.86) / 0.14);
    let c = 0.88 + 0.14 * lun + 0.22 * edge - 0.2 * Math.pow(side, 4);
    col[i * 3] = c; col[i * 3 + 1] = c * (1 - 0.03 * (1 - lun - edge)); col[i * 3 + 2] = c * (1 - 0.02 * (1 - lun - edge));
  }
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.rotateX(-Math.PI / 2); // (axis +Y -> -Z; the plate's middle, +Z, now on the back of the finger, +Y)
  g.translate(0, 0.0004, -(L * 0.92 + r * 0.45 - len / 2));
  g.computeVertexNormals();
  g.userData.shared = true;
  nailCache.set(key, g);
  return g;
}
export const POSES = {};
for (const [name, bp] of Object.entries(BASE_POSES)) {
  let targets;
  if (bp.thumb === 'midtip') {
    const tip = fingerTip(1, bp.f[1]);
    targets = [new THREE.Vector3(-0.048, -0.03, -0.05), new THREE.Vector3(-0.04, -0.05, -0.08), tip.add(new THREE.Vector3(-0.004, -0.012, 0.004))];
  } else targets = bp.thumb.map(v3);
  POSES[name] = { f: bp.f.map((r) => r.slice()), t: solveThumb(targets) };
}

export function lerpPose(a, b, k, out) {
  out = out || { f: [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]], t: [0, 0, 0, 0, 0] };
  for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) out.f[i][j] = a.f[i][j] + (b.f[i][j] - a.f[i][j]) * k;
  for (let j = 0; j < 5; j++) out.t[j] = a.t[j] + (b.t[j] - a.t[j]) * k;
  return out;
}
export function clonePose(p) { return { f: p.f.map((r) => r.slice()), t: p.t.slice() }; }

// Solve finger curls so the finger wraps around a pole along X at (py, pz)
// with radius R (pole radius + finger radius).
function wrapFinger(f, py, pz, R) {
  // 2D: u = forward (-z), v = palmward (-y)
  const bu = -f.z, bv = -f.y;
  const cu = -pz, cv = -py;
  const L1 = f.L[0];
  const dx = cu - bu, dy = cv - bv;
  const d = Math.hypot(dx, dy);
  let p1u, p1v;
  if (d > L1 + R || d < Math.abs(L1 - R)) {
    const a = Math.atan2(dy, dx);
    p1u = bu + Math.cos(a - 0.4) * L1; p1v = bv + Math.sin(a - 0.4) * L1;
  } else {
    const a = (L1 * L1 - R * R + d * d) / (2 * d);
    const h = Math.sqrt(Math.max(0, L1 * L1 - a * a));
    const mu = bu + (dx * a) / d, mv = bv + (dy * a) / d;
    const c1u = mu + (h * dy) / d, c1v = mv - (h * dx) / d;
    const c2u = mu - (h * dy) / d, c2v = mv + (h * dx) / d;
    if (c1u > c2u) { p1u = c1u; p1v = c1v; } else { p1u = c2u; p1v = c2v; }
  }
  const th1 = Math.atan2(p1v - bv, p1u - bu);
  let phi = Math.atan2(p1v - cv, p1u - cu);
  let pu = p1u, pv = p1v, prev = th1;
  const curls = [th1];
  for (let i = 1; i < 3; i++) {
    const al = 2 * Math.asin(Math.min(1, f.L[i] / (2 * R)));
    phi += al;
    const nu = cu + Math.cos(phi) * R, nv = cv + Math.sin(phi) * R;
    const th = Math.atan2(nv - pv, nu - pu);
    let dth = th - prev;
    while (dth < -Math.PI) dth += Math.PI * 2;
    while (dth > Math.PI) dth -= Math.PI * 2;
    curls.push(dth);
    prev = th; pu = nu; pv = nv;
  }
  return curls;
}

// Grip pose around a pole (radius r) along the hand X axis.
// Returns { pose, gripPos } where gripPos is the pole center in hand space.
const gripCache = new Map();
export function gripPose(r = 0.018, opts = {}) {
  const key = `${r}:${opts.dy ?? 0}:${opts.dz ?? 0}`;
  if (gripCache.has(key)) { const g = gripCache.get(key); return { pose: clonePose(g.pose), gripPos: g.gripPos.clone() }; }
  const py = -(0.015 + r) + (opts.dy ?? 0);
  const pz = -0.068 + (opts.dz ?? 0);
  const f = FINGERS.map((fi, i) => {
    const c = wrapFinger(fi, py, pz + i * 0.002, r + fi.r[1] * 0.95);
    return [c[0], c[1], c[2], fi.splay * 0.2];
  });
  // thumb wraps the near side of the pole, opposite to the fingers
  const R = r + 0.0115;
  const at = (x, a) => new THREE.Vector3(x, py + R * Math.sin(a), pz + R * Math.cos(a));
  const t = solveThumb([at(-0.046, 0.75), at(-0.05, -0.35), at(-0.044, -1.25)], [0.5, -0.8, -1.2, 0.4, 0.4]);
  const res = { pose: { f, t }, gripPos: new THREE.Vector3(0, py, pz) };
  gripCache.set(key, res);
  return { pose: clonePose(res.pose), gripPos: res.gripPos.clone() };
}

export function buildHand(opts) {
  const {
    style = 'glove', glove, skin, armor, nail, cuff, claws = false, rings = [], detail = 1,
    cuffFlare = true, segMats = null,
  } = opts;
  const rad = detail >= 1 ? 10 : detail > 0.3 ? 6 : 4; // detail <= 0.3: avatar hands
  const group = new THREE.Group();
  group.name = 'hand';
  const matFor = (fi, si) => {
    if (segMats) return segMats(fi, si);
    if (style === 'bare') return skin;
    if (style === 'fingerless' || style === 'wrapped') return si === 0 ? glove : skin;
    return glove;
  };
  const palmMat = style === 'bare' ? skin : glove;
  // which vertex paint a segment gets: by its material (cloth wraps and custom materials: none)
  const segPaint = (mat) => (segMats ? null : mat === skin ? 'skin' : mat === glove && style !== 'wrapped' ? 'glove' : null);
  const meshes = [];
  const add = (parent, geo, mat) => {
    const m = new THREE.Mesh(geo, mat);
    parent.add(m); meshes.push(m);
    return m;
  };

  // --- palm ---------------------------------------------------------------
  // palm: superellipsoid slab, tapered toward the wrist, arched back,
  // with soft thenar / hypothenar pads merged in
  // (the sphere's poles turned to the knuckles and the wrist, where they're covered: at the middle of the
  // palm and the back of the hand they had pinched the skin's texture into a star)
  const palm = new THREE.SphereGeometry(1, detail >= 1 ? 40 : detail > 0.3 ? 14 : 10, detail >= 1 ? 36 : detail > 0.3 ? 10 : 8).rotateX(Math.PI / 2);
  const pp = palm.getAttribute('position');
  const se = (v, e) => Math.sign(v) * Math.pow(Math.abs(v), e);
  // vertex paint (it multiplies the material's colour, and survives the bake): on skin, veins on the back
  // of the hand, knuckles a little red, the palm's lines; on a glove, the stitched "points" down the back
  // and dark creases across the palm
  const paintPalm = style === 'bare' ? 'skin' : style === 'glove' || style === 'fingerless' || style === 'gauntlet' ? 'glove' : null;
  const pcol = paintPalm ? new Float32Array(pp.count * 3) : null;
  const g2 = (d, w) => Math.exp(-(d * d) / (w * w));
  for (let i = 0; i < pp.count; i++) {
    const nx = pp.getX(i), ny = pp.getY(i), nz = pp.getZ(i);
    let x = se(nx, 0.66) * 0.041, y = se(ny, 0.8) * 0.0145, z = se(nz, 0.6) * 0.05;
    const t = (z + 0.05) / 0.1; // 0 knuckles .. 1 wrist
    x *= 1 - t * 0.22;
    let r = 1, gg = 1, b = 1;
    if (y > 0) {
      y = y * (1 - t * 0.15) + 0.004 * Math.cos((x / 0.042) * Math.PI * 0.5) * y / 0.0145;
      const top = y / 0.0185;
      // extensor tendons fanning from the wrist to each knuckle
      let ten = 0;
      for (const fx of [-0.029, -0.0095, 0.0105, 0.0285]) { const cx = fx * (1 - t * 0.55); ten += Math.exp(-Math.pow((x - cx) / 0.0042, 2)); }
      y += 0.0011 * ten * Math.sin(Math.PI * Math.min(1, t * 1.25)) * top;
      if (paintPalm === 'skin') {
        // two veins winding up from the wrist, raised a hair and blue under the skin
        const fade = Math.min(1, Math.max(0, (t - 0.22) / 0.25));
        const v = g2(x - (-0.014 + 0.007 * Math.sin(t * 5.2 + 0.4)), 0.0024) + g2(x - (0.013 - 0.006 * Math.sin(t * 4.1 + 1.3)), 0.002) * 0.8
          + g2(x - (-0.002 + 0.012 * (t - 0.55)), 0.0016) * (t > 0.45 && t < 0.8 ? 0.6 : 0);
        y += 0.00075 * v * fade * top;
        r -= 0.1 * v * fade; gg -= 0.06 * v * fade; b += 0.02 * v * fade;
        // the knuckles: warmer
        const kn = g2(t, 0.12) * top;
        gg -= 0.08 * kn; b -= 0.09 * kn;
      } else if (paintPalm === 'glove') {
        // three stitched lines ("points") from between the knuckles toward the wrist
        let st = 0;
        for (const cx of [-0.019, 0.0005, 0.02]) st += g2(x - cx * (1 - t * 0.3), 0.0011) * (t > 0.14 && t < 0.62 ? 1 : 0);
        const dash = 0.5 + 0.5 * Math.sign(Math.sin(t * 160));
        r -= 0.35 * st - 0.12 * st * dash; gg -= 0.35 * st - 0.1 * st * dash; b -= 0.35 * st - 0.06 * st * dash;
        // worn paler over the knuckles
        const kn = g2(t, 0.1) * top * 0.12; r += kn; gg += kn; b += kn;
      }
    }
    else {
      y *= 1 + 0.25 * Math.exp(-Math.pow((x + 0.02) / 0.016, 2)) * Math.exp(-Math.pow((t - 0.62) / 0.3, 2)); // thenar pad
      y *= 1 + 0.15 * Math.exp(-Math.pow((x - 0.028) / 0.012, 2)) * (t > 0.3 ? 1 : t / 0.3); // hypothenar
      y += 0.002 * (1 - Math.cos((x / 0.042) * Math.PI * 0.5));
      if (paintPalm) {
        // the palm's lines: heart, head and life, pressed in a little and darker
        const u = x / 0.041;
        const heart = g2(t - (0.2 + 0.05 * u + 0.05 * u * u), 0.022) * (u > -0.55 ? 1 : 0);
        const head = g2(t - (0.36 - 0.07 * u), 0.02) * (u > -0.9 && u < 0.55 ? 1 : 0);
        const life = g2(Math.hypot((u + 0.62) / 0.55, (t - 0.78) / 0.5) - 1, 0.05) * (t > 0.3 ? 1 : 0) * (u < -0.05 ? 1 : 0);
        const cr = Math.min(1, heart + head + life);
        y += 0.0005 * cr * (-y / 0.0145);
        const k = paintPalm === 'skin' ? 0.16 : 0.24;
        r -= k * cr; gg -= k * 1.15 * cr; b -= k * 1.1 * cr;
        if (paintPalm === 'skin') { const pk = g2(u, 0.6) * g2(t - 0.5, 0.35) * 0.06; gg -= pk; b -= pk; }
      }
    }
    // knuckle line: pinky side shorter
    if (t < 0.2) z += Math.max(0, x) * 0.18 * (1 - t / 0.2);
    pp.setXYZ(i, x, y, z - 0.047);
    if (pcol) { pcol[i * 3] = r; pcol[i * 3 + 1] = gg; pcol[i * 3 + 2] = b; }
  }
  if (pcol) palm.setAttribute('color', new THREE.Float32BufferAttribute(pcol, 3));
  palm.computeVertexNormals();
  const palmParts = [palm,
    // fleshy thumb base (thenar) blended into the palm side
    sphere(0.017, rad, 8, { x: -0.025, y: -0.006, z: -0.03, sx: 0.9, sy: 0.75, sz: 1.5, ry: 0.4 }),
  ];
  // wrist + forearm stub reaching back into the sleeve
  const wr = lathe([[0.0305, -0.014], [0.029, 0.008], [0.0295, 0.03]], rad + 4);
  xf(wr, { rx: Math.PI / 2 });
  wr.scale(1, 0.66, 1);
  palmParts.push(wr);
  if (style !== 'gauntlet') {
    // the knuckles: low and broad (they had stood out like beads)
    for (const f of FINGERS) {
      const k = sphere(f.r[0] * 0.98, 12, 8, { x: f.x, y: 0.0068 + f.y, z: f.z + 0.004, sx: 1.08, sy: 0.5, sz: 1.05 });
      if (paintPalm) paint(k, paintPalm === 'skin' ? [1, 0.9, 0.88] : [1.1, 1.1, 1.1]);
      palmParts.push(k);
    }
  }
  add(group, mergeGeos(palmParts), palmMat);

  if (style === 'glove' && cuffFlare && cuff !== false && opts.handCuff) {
    const c = lathe([[0.0262, 0], [0.029, 0.006], [0.031, 0.025], [0.035, 0.045], [0.037, 0.05], [0.033, 0.052]], 18);
    xf(c, { rx: Math.PI / 2, z: 0.004 });
    c.scale(1, 0.78, 1);
    add(group, c, cuff || glove);
  }
  if (style === 'wrapped') {
    const bands = [];
    for (let i = 0; i < 5; i++) {
      const b = torus(0.035, 0.0045, 4, 14, Math.PI * 2, { z: -0.015 - i * 0.017, rz: i * 0.4 });
      b.scale(1.05, 0.5, 1);
      bands.push(b);
    }
    add(group, mergeGeos(bands), glove);
  }
  if (style === 'gauntlet' && armor) {
    // back-of-hand plates
    const plate = roundedBox(0.086, 0.012, 0.05, 0.005, 2);
    const plate2 = roundedBox(0.08, 0.012, 0.045, 0.005, 2);
    const p1 = xf(plate, { y: 0.017, z: -0.065, rx: 0.08 });
    const p2 = xf(plate2, { y: 0.019, z: -0.025, rx: -0.05 });
    const ridge = [];
    for (const f of FINGERS) ridge.push(sphere(0.01, 8, 6, { x: f.x, y: 0.014, z: f.z + 0.006, sy: 0.8 }));
    add(group, mergeGeos([p1, p2, ...ridge]), armor);
    const cuffG = lathe([[0.034, 0], [0.04, 0.03], [0.05, 0.075], [0.052, 0.08]], 12);
    xf(cuffG, { rx: Math.PI / 2, z: -0.01 });
    cuffG.scale(1, 0.82, 1);
    add(group, cuffG, armor);
  }

  // --- fingers ------------------------------------------------------------
  const fingers = [];
  const tips = [];
  FINGERS.forEach((f, fi) => {
    const joints = [];
    let parent = group;
    let px = f.x, py = f.y, pz = f.z;
    for (let s = 0; s < 3; s++) {
      const j = new THREE.Group();
      j.rotation.order = 'YXZ';
      j.position.set(px, py, pz);
      parent.add(j);
      const mat = matFor(fi, s);
      add(j, fingerSeg(f.L[s], f.r[s], f.r[s + 1], rad, 0.85, s === 2, segPaint(mat), s > 0), mat);
      if (style === 'gauntlet' && armor) {
        const pl = lathe([[f.r[s] * 1.32, 0], [f.r[s + 1] * 1.3, f.L[s] * 0.85]], 8, Math.PI * 0.5 + 0.35, Math.PI - 0.7);
        xf(pl, { rx: -Math.PI / 2, z: -0.002 });
        pl.scale(1, 0.95, 1);
        add(j, pl, armor);
      }
      if (s === 2) {
        if (nail && (style !== 'glove' && style !== 'gauntlet')) {
          const ng = claws
            ? xf(new THREE.ConeGeometry(f.r[3] * 0.85, 0.022, 6), { rx: -Math.PI / 2 - 0.35, y: -0.002, z: -f.L[2] - 0.006, sy: 1, sx: 0.8 })
            : nailGeo(f.L[2], f.r[3], rad);
          add(j, ng, nail);
        }
        const tip = new THREE.Object3D();
        tip.position.set(0, 0, -f.L[2] - f.r[3]);
        j.add(tip); tips.push(tip);
      }
      joints.push(j);
      parent = j;
      px = 0; py = 0; pz = -f.L[s];
    }
    for (const rg of rings) {
      if (rg.finger === fi) {
        const g = torus(f.r[rg.seg ?? 0] * 1.15, 0.0022, 6, 14, Math.PI * 2, { z: -f.L[rg.seg ?? 0] * 0.45 });
        add(joints[rg.seg ?? 0], g, rg.mat);
        if (rg.gem) add(joints[rg.seg ?? 0], sphere(0.0035, 8, 6, { y: f.r[0] * 1.15, z: -f.L[0] * 0.45 }), rg.gem);
      }
    }
    fingers.push({ joints, def: f });
  });

  // --- thumb --------------------------------------------------------------
  const tj = [];
  {
    let parent = group;
    let px = THUMB.x, py = THUMB.y, pz = THUMB.z;
    for (let s = 0; s < 3; s++) {
      const j = new THREE.Group();
      j.rotation.order = 'YXZ';
      j.position.set(px, py, pz);
      parent.add(j);
      const mat = s === 0 ? palmMat : matFor(0, s);
      add(j, fingerSeg(THUMB.L[s], THUMB.r[s], THUMB.r[s + 1], rad, s === 0 ? 0.8 : 0.85, s === 2, segPaint(mat), s > 0), mat);
      if (style === 'gauntlet' && armor && s > 0) {
        const pl = lathe([[THUMB.r[s] * 1.3, 0], [THUMB.r[s + 1] * 1.28, THUMB.L[s] * 0.85]], 8, Math.PI * 0.5 + 0.35, Math.PI - 0.7);
        xf(pl, { rx: -Math.PI / 2 });
        add(j, pl, armor);
      }
      if (s === 2) {
        if (nail && style !== 'glove' && style !== 'gauntlet') {
          const ng = claws
            ? xf(new THREE.ConeGeometry(THUMB.r[3] * 0.85, 0.022, 6), { rx: -Math.PI / 2 - 0.35, z: -THUMB.L[2] - 0.006, sx: 0.8 })
            : nailGeo(THUMB.L[2], THUMB.r[3] * 1.05, rad);
          add(j, ng, nail);
        }
        const tip = new THREE.Object3D();
        tip.position.set(0, 0, -THUMB.L[2] - THUMB.r[3]);
        j.add(tip); tips.push(tip);
      }
      tj.push(j);
      parent = j;
      px = 0; py = 0; pz = -THUMB.L[s];
    }
  }

  const palmCenter = new THREE.Object3D();
  palmCenter.position.set(0, -0.035, -0.06);
  group.add(palmCenter);

  const hand = {
    group, fingers, thumb: tj, tips, palmCenter, meshes, palmMat, style, cuffMat: style === 'glove' && cuff !== false ? (cuff || glove) : null,
    pose: clonePose(POSES.relaxed),
    setPose(p) {
      for (let i = 0; i < 4; i++) {
        const jf = fingers[i].joints, pf = p.f[i];
        jf[0].rotation.set(-pf[0], -(fingers[i].def.splay + pf[3]), 0);
        jf[1].rotation.set(-pf[1], 0, 0);
        jf[2].rotation.set(-pf[2], 0, 0);
      }
      tj[0].rotation.set(p.t[1], p.t[0], p.t[2]);
      tj[1].rotation.set(-p.t[3], 0, 0);
      tj[2].rotation.set(-p.t[4], 0, 0);
    },
  };
  hand.setPose(hand.pose);
  return hand;
}

// Bake a posed hand into a few static merged meshes (one per material) for
// the third-person avatars. Returns an object compatible with the hand FX
// builders: { group, tips, palmCenter, meshes }.
export function bakeHand(hand) {
  const g = hand.group;
  g.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(g.matrixWorld).invert();
  const byMat = new Map();
  const m = new THREE.Matrix4();
  for (const mesh of hand.meshes) {
    m.multiplyMatrices(inv, mesh.matrixWorld);
    const geo = mesh.geometry.clone().applyMatrix4(m);
    if (!byMat.has(mesh.material)) byMat.set(mesh.material, []);
    byMat.get(mesh.material).push(geo);
  }
  const out = new THREE.Group();
  out.name = 'bakedHand';
  const meshes = [];
  for (const [mat, geos] of byMat) {
    const mm = new THREE.Mesh(mergeGeos(geos), mat);
    out.add(mm); meshes.push(mm);
    geos.forEach((x) => x.dispose());
  }
  const toLocal = (o) => {
    const p = new THREE.Object3D();
    p.position.setFromMatrixPosition(o.matrixWorld).applyMatrix4(inv);
    // keep the tip's orientation too (flames on fingertips are rotated)
    const q = new THREE.Quaternion();
    o.getWorldQuaternion(q);
    const gq = new THREE.Quaternion(); g.getWorldQuaternion(gq);
    p.quaternion.copy(gq.invert().multiply(q));
    out.add(p);
    return p;
  };
  const tips = hand.tips.map(toLocal);
  const palmCenter = toLocal(hand.palmCenter);
  return { group: out, tips, palmCenter, meshes, palmMat: hand.palmMat, cuffMat: hand.cuffMat };
}
