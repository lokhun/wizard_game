import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// Geometry helpers for the wizard models. Everything returns plain
// BufferGeometry (position/normal/uv) so parts can be merged per material.

export const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);

// Global level-of-detail multiplier for segment counts, set around the
// construction of low-detail parts (avatars): withLOD(0.5, () => build()).
export const LOD = { k: 1 };
export function withLOD(k, fn) {
  const prev = LOD.k;
  LOD.k = k;
  try { return fn(); } finally { LOD.k = prev; }
}
const S = (n, min = 3) => (LOD.k >= 1 ? n : Math.max(min, Math.round(n * LOD.k)));

export function uvs(geo, su = 1, sv = 1) {
  const uv = geo.getAttribute('uv');
  if (!uv) return geo;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * su, uv.getY(i) * sv);
  return geo;
}

// transform a geometry in place: { x,y,z, rx,ry,rz, s | sx,sy,sz }
export function xf(geo, o = {}) {
  const s = o.s ?? 1;
  const m = new THREE.Matrix4().compose(
    new THREE.Vector3(o.x ?? 0, o.y ?? 0, o.z ?? 0),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(o.rx ?? 0, o.ry ?? 0, o.rz ?? 0, o.order ?? 'XYZ')),
    new THREE.Vector3(o.sx ?? s, o.sy ?? s, o.sz ?? s),
  );
  geo.applyMatrix4(m);
  return geo;
}

// Place a geometry built along +Y (from y=0 to y=1 after scaling by len)
// so it spans from a to b.
export function alongAB(geo, a, b) {
  const d = new THREE.Vector3().subVectors(b, a);
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.clone().normalize());
  const m = new THREE.Matrix4().compose(a, q, new THREE.Vector3(1, 1, 1));
  geo.applyMatrix4(m);
  return geo;
}

// Cylinder whose base sits at y=0
export function cyl(rTop, rBot, h, seg = 12, hseg = 1, open = false) {
  const g = new THREE.CylinderGeometry(rTop, rBot, h, S(seg, 5), hseg, open);
  g.translate(0, h / 2, 0);
  return uvs(g, Math.max(1, Math.round((rTop + rBot) * Math.PI * 4)) , Math.max(0.25, h * 3));
}

// cylinder between two points
export function cylAB(a, b, r0, r1 = r0, seg = 10, hseg = 1) {
  const len = a.distanceTo(b);
  const g = cyl(r1, r0, len, seg, hseg);
  return alongAB(g, a, b);
}

export function sphere(r, ws = 12, hs = 8, o) {
  const g = new THREE.SphereGeometry(r, S(ws, 5), S(hs, 4));
  return o ? xf(g, o) : g;
}

export function torus(R, r, rs = 8, ts = 24, arc = Math.PI * 2, o) {
  const g = new THREE.TorusGeometry(R, r, S(rs), S(ts, 6), arc);
  uvs(g, Math.max(1, Math.round(R * 20)), 1);
  return o ? xf(g, o) : g;
}

// profile: [[r, y], ...] from bottom to top
export function lathe(profile, seg = 16, phiStart = 0, phiLen = Math.PI * 2) {
  const pts = profile.map(([r, y]) => new THREE.Vector2(Math.max(r, 0), y));
  const g = new THREE.LatheGeometry(pts, S(seg, 5), phiStart, phiLen);
  return g;
}

// Tapered segment with rounded ends along -Z from 0 to -L (finger bone)
const segCache = new Map();
export function fingerSeg(L, r0, r1, rad = 8, flat = 0.85) {
  const key = `${L.toFixed(4)}:${r0.toFixed(4)}:${r1.toFixed(4)}:${rad}:${flat}`;
  if (segCache.has(key)) return segCache.get(key);
  const prof = [];
  const n = rad >= 8 ? 4 : 2;
  for (let i = 0; i <= n; i++) {
    const a = -Math.PI / 2 + (i / n) * Math.PI / 2;
    prof.push([r0 * Math.cos(a), r0 * Math.sin(a)]);
  }
  // knuckle bulge near base and a slight waist
  prof.push([r0 * 0.97 + r1 * 0.03, L * 0.35]);
  prof.push([r1 * 0.98, L * 0.75]);
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * Math.PI / 2;
    prof.push([r1 * Math.cos(a), L + r1 * Math.sin(a)]);
  }
  const g = lathe(prof, rad);
  g.rotateX(-Math.PI / 2); // +Y -> -Z
  g.scale(1, flat, 1);
  g.userData.shared = true;
  segCache.set(key, g);
  return g;
}

// Rounded box (spherified corners)
export function roundedBox(w, h, d, r, seg = 3) {
  seg = S(seg, 1);
  const g = new THREE.BoxGeometry(w, h, d, seg * 2, seg * 2, seg * 2);
  const p = g.getAttribute('position');
  const hw = w / 2 - r, hh = h / 2 - r, hd = d / 2 - r;
  const v = new THREE.Vector3(), c = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    c.set(THREE.MathUtils.clamp(v.x, -hw, hw), THREE.MathUtils.clamp(v.y, -hh, hh), THREE.MathUtils.clamp(v.z, -hd, hd));
    const dir = v.clone().sub(c);
    if (dir.lengthSq() < 1e-12) continue;
    dir.normalize().multiplyScalar(r);
    v.copy(c).add(dir);
    p.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  return g;
}

// -------- tiny deterministic noise ------------------------------------------
export function mulberry(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function hash3(x, y, z, s) {
  let h = (x * 374761393 + y * 668265263 + z * 2147483647 + s * 1442695041) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
export function vnoise(x, y, z, s = 0) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const xf_ = x - xi, yf = y - yi, zf = z - zi;
  const u = xf_ * xf_ * (3 - 2 * xf_), v = yf * yf * (3 - 2 * yf), w = zf * zf * (3 - 2 * zf);
  const L = (a, b, t) => a + (b - a) * t;
  const c = (dx, dy, dz) => hash3(xi + dx, yi + dy, zi + dz, s);
  return L(
    L(L(c(0, 0, 0), c(1, 0, 0), u), L(c(0, 1, 0), c(1, 1, 0), u), v),
    L(L(c(0, 0, 1), c(1, 0, 1), u), L(c(0, 1, 1), c(1, 1, 1), u), v), w) * 2 - 1;
}
export function fbm3(x, y, z, s = 0, oct = 3) {
  let a = 0.5, f = 1, t = 0;
  for (let i = 0; i < oct; i++) { t += a * vnoise(x * f, y * f, z * f, s + i * 17); a *= 0.5; f *= 2; }
  return t;
}

// displace vertices along their (smooth) normals with 3D noise; welded seams stay closed
export function noisify(geo, amp, freq, seed = 1, oct = 3) {
  if (!geo.getAttribute('normal')) geo.computeVertexNormals();
  const p = geo.getAttribute('position');
  const n = geo.getAttribute('normal');
  const accum = new Map();
  // average normals of coincident vertices so seams stay welded
  for (let i = 0; i < p.count; i++) {
    const k = `${p.getX(i).toFixed(4)},${p.getY(i).toFixed(4)},${p.getZ(i).toFixed(4)}`;
    const a = accum.get(k) || [0, 0, 0];
    a[0] += n.getX(i); a[1] += n.getY(i); a[2] += n.getZ(i);
    accum.set(k, a);
  }
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const k = `${x.toFixed(4)},${y.toFixed(4)},${z.toFixed(4)}`;
    const a = accum.get(k);
    const l = Math.hypot(a[0], a[1], a[2]) || 1;
    const d = fbm3(x * freq, y * freq, z * freq, seed, oct) * amp;
    p.setXYZ(i, x + a[0] / l * d, y + a[1] / l * d, z + a[2] / l * d);
  }
  geo.computeVertexNormals();
  return geo;
}

// per-vertex jitter keyed by position (keeps welded)
export function jitter(geo, amt, seed = 1) {
  const p = geo.getAttribute('position');
  const r = mulberry(seed);
  const map = new Map();
  for (let i = 0; i < p.count; i++) {
    const k = `${p.getX(i).toFixed(4)},${p.getY(i).toFixed(4)},${p.getZ(i).toFixed(4)}`;
    if (!map.has(k)) map.set(k, [r() * 2 - 1, r() * 2 - 1, r() * 2 - 1]);
    const j = map.get(k);
    p.setXYZ(i, p.getX(i) + j[0] * amt, p.getY(i) + j[1] * amt, p.getZ(i) + j[2] * amt);
  }
  geo.computeVertexNormals();
  return geo;
}

export function flat(geo) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  g.computeVertexNormals();
  return g;
}

// Merge geometries (normalises attributes to position/normal/uv, non-indexed)
export function mergeGeos(geos) {
  const clean = geos.filter(Boolean).map((g) => {
    const gg = g.index ? g.toNonIndexed() : g;
    const out = new THREE.BufferGeometry();
    out.setAttribute('position', gg.getAttribute('position'));
    if (!gg.getAttribute('normal')) gg.computeVertexNormals();
    out.setAttribute('normal', gg.getAttribute('normal'));
    out.setAttribute('uv', gg.getAttribute('uv') ?? new THREE.Float32BufferAttribute(new Float32Array(gg.getAttribute('position').count * 2), 2));
    return out;
  });
  if (!clean.length) return new THREE.BufferGeometry();
  const m = mergeGeometries(clean, false);
  m.computeBoundingSphere();
  return m;
}

// Tube along points with a radius function r(t) (t 0..1); optional end caps.
export function tubeVar(points, radius, tseg = 24, rseg = 8, caps = true, closed = false) {
  tseg = S(tseg, 2); rseg = S(rseg, 3);
  const curve = new THREE.CatmullRomCurve3(points, closed, 'centripetal');
  const frames = curve.computeFrenetFrames(tseg, closed);
  const pos = [], nrm = [], uv = [], idx = [];
  const rf = typeof radius === 'function' ? radius : () => radius;
  const P = new THREE.Vector3(), N = new THREE.Vector3();
  const len = curve.getLength();
  for (let i = 0; i <= tseg; i++) {
    const t = i / tseg;
    curve.getPointAt(t, P);
    const r = rf(t);
    for (let j = 0; j <= rseg; j++) {
      const a = (j / rseg) * Math.PI * 2;
      const s = Math.sin(a), c = -Math.cos(a);
      N.set(0, 0, 0).addScaledVector(frames.normals[i], c).addScaledVector(frames.binormals[i], s).normalize();
      pos.push(P.x + N.x * r, P.y + N.y * r, P.z + N.z * r);
      nrm.push(N.x, N.y, N.z);
      uv.push(j / rseg, t * len * 4);
    }
  }
  for (let i = 0; i < tseg; i++) {
    for (let j = 0; j < rseg; j++) {
      const a = i * (rseg + 1) + j, b = (i + 1) * (rseg + 1) + j;
      idx.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  if (caps && !closed) {
    for (const end of [0, 1]) {
      const i = end ? tseg : 0;
      const t = end ? 1 : 0;
      curve.getPointAt(t, P);
      const T = curve.getTangentAt(t).multiplyScalar(end ? 1 : -1);
      const ci = pos.length / 3;
      pos.push(P.x, P.y, P.z); nrm.push(T.x, T.y, T.z); uv.push(0.5, 0.5);
      const ring = [];
      for (let j = 0; j <= rseg; j++) {
        const k = i * (rseg + 1) + j;
        ring.push(pos.length / 3);
        pos.push(pos[k * 3], pos[k * 3 + 1], pos[k * 3 + 2]);
        nrm.push(T.x, T.y, T.z); uv.push(0, 0);
      }
      for (let j = 0; j < rseg; j++) {
        if (end) idx.push(ci, ring[j], ring[j + 1]); else idx.push(ci, ring[j + 1], ring[j]);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

// helix points around Y axis
export function helixPts(r, y0, y1, turns, n = 64, phase = 0, rFn) {
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const a = phase + t * turns * Math.PI * 2;
    const rr = rFn ? rFn(t) : r;
    pts.push(V(Math.cos(a) * rr, y0 + (y1 - y0) * t, Math.sin(a) * rr));
  }
  return pts;
}

// Faceted crystal along +Y: base point at y=0, tip at y=len
export function crystal(len, rad, sides = 6, seed = 1, opts = {}) {
  const r = mulberry(seed);
  const base = opts.base ?? 0.18;
  const prof = [
    [0, 0],
    [rad * 0.8, len * base * 0.6],
    [rad, len * base],
    [rad * (0.85 + r() * 0.15), len * (0.62 + r() * 0.1)],
    [0, len],
  ];
  let g = lathe(prof, sides, r() * Math.PI);
  g = flat(g);
  // skew the tip slightly for an irregular cut
  const p = g.getAttribute('position');
  const sk = (r() - 0.5) * rad * 0.8, sk2 = (r() - 0.5) * rad * 0.8;
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i) / len;
    p.setX(i, p.getX(i) + sk * y * y);
    p.setZ(i, p.getZ(i) + sk2 * y * y);
  }
  g.computeVertexNormals();
  return g;
}

// Gear outline extruded along Z (centered)
export function gear(teeth, rIn, rOut, thick, hole = 0, bevel = false) {
  const s = new THREE.Shape();
  const n = teeth * 4;
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * Math.PI * 2;
    const k = i % 4;
    const r = k === 1 || k === 2 ? rOut : rIn;
    const x = Math.cos(a) * r, y = Math.sin(a) * r;
    if (i === 0) s.moveTo(x, y); else s.lineTo(x, y);
  }
  if (hole > 0) {
    const h = new THREE.Path();
    h.absarc(0, 0, hole, 0, Math.PI * 2, true);
    s.holes.push(h);
    // spokes as extra holes
  }
  const g = new THREE.ExtrudeGeometry(s, { depth: thick, bevelEnabled: bevel, bevelThickness: thick * 0.2, bevelSize: thick * 0.2, bevelSegments: 1, curveSegments: 6 });
  g.translate(0, 0, -thick / 2);
  return g;
}

// Leaf (in XY plane, stem at origin, pointing +Y) with a midrib fold and curl
export function leaf(len, wid, curl = 0.3, seg = 6) {
  const pos = [], uv = [], idx = [];
  const cols = 3;
  for (let i = 0; i <= seg; i++) {
    const t = i / seg;
    const w = Math.sin(Math.pow(t, 0.8) * Math.PI) * wid * (1 - t * 0.2);
    for (let j = 0; j < cols; j++) {
      const s = (j - 1);
      const x = s * w;
      const y = t * len;
      const fold = Math.abs(s) * w * 0.35; // V-fold along midrib
      const z = fold + Math.sin(t * Math.PI * 0.9) * curl * len * 0.3 + t * t * curl * len * 0.4;
      pos.push(x, y, z);
      uv.push(j / (cols - 1), t);
    }
  }
  for (let i = 0; i < seg; i++) {
    for (let j = 0; j < cols - 1; j++) {
      const a = i * cols + j, b = (i + 1) * cols + j;
      idx.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// Feather: thin quill + vane strips with notched edge, in XY plane, base at origin, along +Y
export function feather(len, wid, seed = 1) {
  const r = mulberry(seed);
  const pos = [], uv = [], idx = [];
  const seg = 10;
  for (let i = 0; i <= seg; i++) {
    const t = i / seg;
    const w = Math.sin(Math.min(1, t * 1.15) * Math.PI * 0.95 + 0.15) * wid * (t < 0.15 ? t / 0.15 : 1);
    const notch = r() < 0.3 ? 0.6 : 1;
    const bend = t * t * len * 0.12;
    pos.push(-w * notch, t * len, bend + w * 0.15);
    pos.push(0, t * len, bend);
    pos.push(w * (r() < 0.3 ? 0.65 : 1), t * len, bend + w * 0.15);
    uv.push(0, t, 0.5, t, 1, t);
  }
  for (let i = 0; i < seg; i++) {
    for (let j = 0; j < 2; j++) {
      const a = i * 3 + j, b = (i + 1) * 3 + j;
      idx.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// Flame tongue: a twisted cone-like lathe along +Y with wobble, open top
export function flameTongue(h, r, seed = 1) {
  const prof = [];
  const n = 8;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    prof.push([r * Math.sin(Math.pow(1 - t, 0.7) * Math.PI * 0.5 + 0.05) * (t < 0.15 ? 0.6 + t * 2.6 : 1), t * h]);
  }
  prof[n][0] = 0;
  const g = lathe(prof, 8);
  const p = g.getAttribute('position');
  const rr = mulberry(seed);
  const ph = rr() * 6;
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i) / h;
    p.setX(i, p.getX(i) + Math.sin(y * 4 + ph) * r * 0.5 * y);
    p.setZ(i, p.getZ(i) + Math.cos(y * 3 + ph) * r * 0.4 * y);
  }
  g.computeVertexNormals();
  return g;
}

// Skull, ~unit-ish size (cranium radius 0.1), facing +Z, centered at cranium
export function skullParts(scale = 1, detail = 1) {
  const ws = detail > 0.6 ? 20 : 12, hs = detail > 0.6 ? 14 : 9;
  const cran = new THREE.SphereGeometry(0.1, ws, hs);
  const p = cran.getAttribute('position');
  for (let i = 0; i < p.count; i++) {
    let x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    // elongate back, flatten sides, temple dents
    z *= 1.12; x *= 0.86;
    if (z < 0) z *= 1.08;
    if (y < -0.02) { const k = (-0.02 - y) / 0.08; x *= 1 - k * 0.15; }
    // brow ridge
    if (z > 0.06 && y > -0.02 && y < 0.03) z += 0.008;
    p.setXYZ(i, x, y, z);
  }
  cran.computeVertexNormals();
  // face block / maxilla
  const face = roundedBox(0.12, 0.08, 0.07, 0.025, 2);
  xf(face, { y: -0.055, z: 0.06 });
  // cheekbones
  const ckL = sphere(0.028, 8, 6, { x: 0.055, y: -0.035, z: 0.075, sx: 1.2, sy: 0.7, sz: 1 });
  const ckR = sphere(0.028, 8, 6, { x: -0.055, y: -0.035, z: 0.075, sx: 1.2, sy: 0.7, sz: 1 });
  // jaw
  const jaw = lathe([[0, 0], [0.05, 0.002], [0.055, 0.02], [0.05, 0.035], [0, 0.036]], 12, -Math.PI * 0.5, Math.PI);
  xf(jaw, { y: -0.135, z: 0.03, sx: 1, sy: 1, sz: 1.35, rx: 0 });
  // teeth row
  const teeth = [];
  for (let i = 0; i < 8; i++) {
    const a = -0.9 + (i / 7) * 1.8;
    teeth.push(xf(new THREE.BoxGeometry(0.011, 0.016, 0.008), { x: Math.sin(a) * 0.045, y: -0.098, z: 0.085 + Math.cos(a) * 0.02 - 0.02, ry: a }));
    teeth.push(xf(new THREE.BoxGeometry(0.01, 0.014, 0.008), { x: Math.sin(a) * 0.042, y: -0.115, z: 0.082 + Math.cos(a) * 0.018 - 0.02, ry: a }));
  }
  const bone = mergeGeos([cran, face, ckL, ckR, jaw, ...teeth]);
  bone.scale(scale, scale, scale);
  // eye sockets + nasal cavity (dark inserts)
  const sock = mergeGeos([
    sphere(0.026, 10, 8, { x: 0.036, y: -0.025, z: 0.088, sz: 0.6 }),
    sphere(0.026, 10, 8, { x: -0.036, y: -0.025, z: 0.088, sz: 0.6 }),
    xf(new THREE.ConeGeometry(0.012, 0.03, 3), { y: -0.06, z: 0.098, rx: Math.PI }),
  ]);
  sock.scale(scale, scale, scale);
  return { bone, sockets: sock, eyeL: V(0.036 * scale, -0.025 * scale, 0.1 * scale), eyeR: V(-0.036 * scale, -0.025 * scale, 0.1 * scale) };
}

// Simple branching twig generator: returns array of {pts, r0, r1}
export function branches(start, dir, len, r0, depth, rnd, out = []) {
  const pts = [start.clone()];
  const d = dir.clone().normalize();
  const n = 4;
  const p = start.clone();
  for (let i = 1; i <= n; i++) {
    d.x += (rnd() - 0.5) * 0.5; d.z += (rnd() - 0.5) * 0.5; d.y += (rnd() - 0.3) * 0.2;
    d.normalize();
    p.addScaledVector(d, len / n);
    pts.push(p.clone());
  }
  out.push({ pts, r0, r1: r0 * 0.45 });
  if (depth > 0) {
    const k = 1 + (rnd() < 0.5 ? 1 : 0);
    for (let i = 0; i < k; i++) {
      const at = pts[2 + Math.floor(rnd() * 2)];
      const nd = d.clone().add(V((rnd() - 0.5) * 1.6, rnd() * 0.5, (rnd() - 0.5) * 1.6)).normalize();
      branches(at, nd, len * 0.6, r0 * 0.55, depth - 1, rnd, out);
    }
  }
  return out;
}
