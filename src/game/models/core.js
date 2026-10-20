import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { makeSurfaceMaterial } from '../../render/textures.js';
import { creatureSurface } from './surfaces.js';

// ---------------------------------------------------------------------------
// Enemy model core: material library, geometry kit, rig builder and the
// per-instance runtime (pose damping, hit flash, status tint, muzzle orb).
//
// Every model is assembled from primitive parts attached to bones. At build
// time all parts sharing a material are merged into ONE rigidly skinned mesh
// (each vertex weighted 100% to its bone), so an enemy is only a handful of
// draw calls no matter how much detail it has. The built template is cached
// per type; instances clone the hierarchy (sharing geometry) and only clone
// their materials so flash / tint / fades stay per-instance.
// ---------------------------------------------------------------------------

export const TAU = Math.PI * 2;
export const clamp = (v, a = 0, b = 1) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smooth = (a, b, v) => { const t = clamp((v - a) / (b - a)); return t * t * (3 - 2 * t); };
export const easeOut = (t) => 1 - (1 - clamp(t)) ** 3;
export const easeIn = (t) => clamp(t) ** 2;
export const easeInOut = (t) => { t = clamp(t); return t * t * (3 - 2 * t); };
// 0 -> 1 -> 0 bump over [a,b]
export const bump = (a, b, v) => { const t = clamp((v - a) / (b - a)); return Math.sin(t * Math.PI); };

// ---------------------------------------------------------------- noise ----
function hash3(x, y, z, s) {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(z | 0, 1274126177) ^ Math.imul(s | 0, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
export function vnoise(x, y, z, s = 0) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const xf = x - xi, yf = y - yi, zf = z - zi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf), w = zf * zf * (3 - 2 * zf);
  const c = (a, b, d) => hash3(xi + a, yi + b, zi + d, s);
  const x00 = lerp(c(0, 0, 0), c(1, 0, 0), u), x10 = lerp(c(0, 1, 0), c(1, 1, 0), u);
  const x01 = lerp(c(0, 0, 1), c(1, 0, 1), u), x11 = lerp(c(0, 1, 1), c(1, 1, 1), u);
  return lerp(lerp(x00, x10, v), lerp(x01, x11, v), w);
}
export function fbm3(x, y, z, s = 0, oct = 3) {
  let a = 0.5, f = 1, t = 0, n = 0;
  for (let i = 0; i < oct; i++) { n += a * vnoise(x * f, y * f, z * f, s + i * 17); t += a; a *= 0.5; f *= 2.03; }
  return n / t;
}
export function rng(seed = 1) {
  let s = seed >>> 0 || 1;
  return () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

// ------------------------------------------------------- geometry kit ----
export const G = {
  box: (w, h, d, ws = 1, hs = 1, ds = 1) => new THREE.BoxGeometry(w, h, d, ws, hs, ds),
  cyl: (rt, rb, h, seg = 10, open = false, hs = 1) => new THREE.CylinderGeometry(rt, rb, h, seg, hs, open),
  sph: (r, ws = 12, hs = 8, ...rest) => new THREE.SphereGeometry(r, ws, hs, ...rest),
  cone: (r, h, seg = 8, open = false) => new THREE.ConeGeometry(r, h, seg, 1, open),
  tor: (r, t, rs = 6, ts = 16, arc = TAU) => new THREE.TorusGeometry(r, t, rs, ts, arc),
  cap: (r, len, cs = 4, rs = 8) => new THREE.CapsuleGeometry(r, len, cs, rs),
  ico: (r, d = 0) => new THREE.IcosahedronGeometry(r, d),
  oct: (r) => new THREE.OctahedronGeometry(r, 0),
  dodec: (r) => new THREE.DodecahedronGeometry(r, 0),
};

// Transform a geometry (in place) by {x,y,z,rx,ry,rz,s,sx,sy,sz}
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _v = new THREE.Vector3(), _s = new THREE.Vector3();
export function xfMatrix(o = {}, out = new THREE.Matrix4()) {
  const s = o.s ?? 1;
  _e.set(o.rx ?? 0, o.ry ?? 0, o.rz ?? 0, o.order ?? 'XYZ');
  _q.setFromEuler(_e);
  return out.compose(_v.set(o.x ?? 0, o.y ?? 0, o.z ?? 0), _q, _s.set((o.sx ?? 1) * s, (o.sy ?? 1) * s, (o.sz ?? 1) * s));
}
export function xf(g, o) {
  const m = xfMatrix(o);
  g.applyMatrix4(m);
  if (m.determinant() < 0) flipWinding(g);
  return g;
}
function flipWinding(g) {
  if (!g.index) { g.setIndex([...Array(g.getAttribute('position').count).keys()]); }
  const idx = g.index.array;
  for (let i = 0; i < idx.length; i += 3) { const t = idx[i + 1]; idx[i + 1] = idx[i + 2]; idx[i + 2] = t; }
  g.index.needsUpdate = true;
}

// Limb segment: rounded taper from y=0 (radius r1) down to y=-len (radius r2)
export function taper(r1, r2, len, seg = 8, rings = 3) {
  const pts = [];
  const cap = 3;
  for (let i = 0; i <= cap; i++) { const a = (i / cap) * Math.PI / 2; pts.push(new THREE.Vector2(Math.sin(a) * r1 + 1e-4, Math.cos(a) * r1 * 0.8)); }
  for (let i = 1; i < rings; i++) { const t = i / rings; pts.push(new THREE.Vector2(lerp(r1, r2, t), -len * t)); }
  for (let i = 0; i <= cap; i++) { const a = Math.PI / 2 + (i / cap) * Math.PI / 2; pts.push(new THREE.Vector2(Math.sin(a) * r2 + 1e-4, -len + Math.cos(a) * r2 * 0.8)); }
  pts.reverse();
  return new THREE.LatheGeometry(pts, seg);
}
// Lathe from [[r,y],...] listed bottom to top
export function lathe(pts, seg = 12, phi0 = 0, phiLen = TAU) {
  return new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(Math.max(r, 1e-4), y)), seg, phi0, phiLen);
}
// Closed lathe shell with thickness (visible from both sides), outer profile bottom->top
export function shell(pts, th = 0.01, seg = 12, phi0 = 0, phiLen = TAU) {
  const inner = pts.slice().reverse().map(([r, y]) => [Math.max(1e-4, r - th), y - (r < th ? th : 0)]);
  const all = [...pts, ...inner, [pts[0][0], pts[0][1]]];
  return new THREE.LatheGeometry(all.map(([r, y]) => new THREE.Vector2(Math.max(r, 1e-4), y)), seg, phi0, phiLen);
}
// Tapered tube along a Catmull-Rom path. r: number or fn(u)->radius
export function tube(points, r, tubSeg = 12, radSeg = 6, closed = false) {
  const curve = new THREE.CatmullRomCurve3(points.map((p) => (p.isVector3 ? p : new THREE.Vector3(...p))));
  const frames = curve.computeFrenetFrames(tubSeg, false);
  const pos = [], nrm = [], idx = [], uv = [];
  const P = new THREE.Vector3(), N = new THREE.Vector3();
  for (let i = 0; i <= tubSeg; i++) {
    const u = i / tubSeg;
    curve.getPointAt(u, P);
    const rad = typeof r === 'function' ? r(u) : r;
    for (let j = 0; j <= radSeg; j++) {
      const a = (j / radSeg) * TAU;
      N.copy(frames.normals[i]).multiplyScalar(Math.cos(a)).addScaledVector(frames.binormals[i], Math.sin(a)).normalize();
      pos.push(P.x + N.x * rad, P.y + N.y * rad, P.z + N.z * rad);
      nrm.push(N.x, N.y, N.z);
      uv.push(u, j / radSeg);
    }
  }
  for (let i = 0; i < tubSeg; i++) for (let j = 0; j < radSeg; j++) {
    const a = i * (radSeg + 1) + j, b = (i + 1) * (radSeg + 1) + j;
    // wound so faces agree with the outward normals (T x B = -N, so a -> a+1 -> b)
    idx.push(a, a + 1, b, b, a + 1, b + 1);
  }
  // end caps
  if (!closed) {
    for (const [i, dir] of [[0, -1], [tubSeg, 1]]) {
      const c = pos.length / 3;
      curve.getPointAt(i / tubSeg, P);
      const T = frames.tangents[i];
      pos.push(P.x, P.y, P.z); nrm.push(T.x * dir, T.y * dir, T.z * dir); uv.push(0, 0);
      for (let j = 0; j < radSeg; j++) {
        const a = i * (radSeg + 1) + j;
        if (dir < 0) idx.push(c, a + 1, a); else idx.push(c, a, a + 1);
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
// Extruded 2D outline [[x,y],...] centered in z
export function extrude(outline, depth, bevel = 0, bevelSegs = 1) {
  const sh = new THREE.Shape(outline.map(([x, y]) => new THREE.Vector2(x, y)));
  const g = new THREE.ExtrudeGeometry(sh, { depth, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: bevelSegs, curveSegments: 4 });
  g.translate(0, 0, -depth / 2);
  return g;
}
// per-vertex deformation fn(v: Vector3, i) mutating v
export function deform(g, fn, recompute = true) {
  const p = g.getAttribute('position');
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) { v.fromBufferAttribute(p, i); fn(v, i); p.setXYZ(i, v.x, v.y, v.z); }
  p.needsUpdate = true;
  if (recompute) g.computeVertexNormals();
  return g;
}
// Weld seams so smooth normals don't show splits (drops uv; uvs are reprojected later)
export function weld(g) {
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', g.getAttribute('position'));
  if (g.index) out.setIndex(g.index);
  const m = mergeVertices(out, 1e-4);
  m.computeVertexNormals();
  return m;
}
// Organic noise displacement along normals (seam safe)
export function bumpy(g, amp, freq = 6, seed = 1, oct = 3) {
  g = weld(g);
  const p = g.getAttribute('position'), n = g.getAttribute('normal');
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const d = (fbm3(x * freq + 11, y * freq, z * freq, seed, oct) - 0.5) * 2 * amp;
    p.setXYZ(i, x + n.getX(i) * d, y + n.getY(i) * d, z + n.getZ(i) * d);
  }
  g.computeVertexNormals();
  return g;
}
// Matted fur: clumpy spikes pushed along normal and combed toward `dir`
export function shaggy(g, len, freq = 14, seed = 3, dir = [0, 0, -1], comb = 0.6) {
  g = weld(g);
  const p = g.getAttribute('position'), n = g.getAttribute('normal');
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    let k = vnoise(x * freq, y * freq, z * freq, seed);
    k = Math.pow(k, 2.2) * 1.6 + (vnoise(x * freq * 2.7, y * freq * 2.7, z * freq * 2.7, seed + 5) - 0.5) * 0.4;
    const d = k * len;
    p.setXYZ(i, x + (n.getX(i) + dir[0] * comb) * d, y + (n.getY(i) + dir[1] * comb) * d, z + (n.getZ(i) + dir[2] * comb) * d);
  }
  g.computeVertexNormals();
  return g;
}
// Robe / skirt: open cone with folds and a tattered hem. y from 0 (top) to -len.
export function robe(rTop, rBot, len, { seg = 18, rows = 6, folds = 7, foldAmp = 0.06, tatter = 0.12, seed = 1, flareZ = 0, open = 0 } = {}) {
  const g = new THREE.CylinderGeometry(rTop, rBot, len, seg, rows, true);
  g.translate(0, -len / 2, 0);
  const R = rng(seed);
  const cut = [];
  for (let j = 0; j <= seg; j++) cut.push(R());
  cut[seg] = cut[0];
  const p = g.getAttribute('position');
  for (let i = 0; i < p.count; i++) {
    let x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const t = -y / len; // 0 top .. 1 bottom
    const a = Math.atan2(x, z);
    const rr = Math.hypot(x, z);
    const fold = 1 + Math.sin(a * folds + seed) * foldAmp * t + (vnoise(a * 2 + 5, t * 3, seed, 9) - 0.5) * foldAmp * t;
    let nr = rr * fold;
    x = Math.sin(a) * nr; z = Math.cos(a) * nr + flareZ * t * t;
    // front opening gap
    if (open > 0 && Math.abs(a) < open) { x *= 1; }
    if (t > 0.999 && tatter > 0) {
      const j = Math.round(((a + Math.PI) / TAU) * seg) % (seg + 1);
      const c = cut[j];
      y += (j % 2 === 0 ? c : c * 0.35) * tatter * len;
    }
    p.setXYZ(i, x, y, z);
  }
  g.computeVertexNormals();
  return g;
}
// Flat cloth panel (cape / tabard / loincloth) hanging from y=0 to -h, in XY plane, z bulge.
export function panel(w, h, { ws = 6, hs = 6, tatter = 0.15, seed = 2, curve = 0.08, taperBot = 1 } = {}) {
  const g = new THREE.PlaneGeometry(w, h, ws, hs);
  g.translate(0, -h / 2, 0);
  const R = rng(seed);
  const cut = []; for (let j = 0; j <= ws; j++) cut.push(R());
  const p = g.getAttribute('position');
  for (let i = 0; i < p.count; i++) {
    let x = p.getX(i), y = p.getY(i);
    const t = -y / h;
    x *= lerp(1, taperBot, t);
    const u = x / (w / 2);
    let z = -(u * u) * curve + Math.sin(t * 7 + u * 3 + seed) * 0.015;
    if (t > 0.999) {
      const j = Math.round((p.getX(i) / w + 0.5) * ws);
      y += cut[j] * tatter * h * (j % 2 ? 1 : 0.4);
    }
    p.setXYZ(i, x, y, z);
  }
  g.computeVertexNormals();
  return g;
}
// Spiked / jagged ring of cones, e.g. crowns, collars
export function spikeRing(r, n, h, rb, y = 0, tilt = 0) {
  const parts = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU;
    parts.push(xf(G.cone(rb, h, 5), { x: Math.sin(a) * r, z: Math.cos(a) * r, y: y + h / 2, rx: Math.cos(a) * tilt, rz: -Math.sin(a) * tilt }));
  }
  return mergeRaw(parts);
}
// Merge raw geometries (position/normal only kept + uv) for kit composition
export function mergeRaw(geos) {
  const clean = geos.map((g) => {
    const o = new THREE.BufferGeometry();
    o.setAttribute('position', g.getAttribute('position'));
    if (!g.getAttribute('normal')) g.computeVertexNormals();
    o.setAttribute('normal', g.getAttribute('normal'));
    if (g.index) o.setIndex(g.index);
    else o.setIndex([...Array(g.getAttribute('position').count).keys()]);
    return o;
  });
  return mergeGeometries(clean, false);
}

// ----------------------------------------------------------- materials ----
const MAT_DEFS = {
  bone: { surf: 'bone', seed: 2, env: 0.25, normalScale: 1.2 },
  iron: { surf: 'iron', seed: 3, env: 0.9, normalScale: 1.2 },
  gold: { surf: 'gold', seed: 4, env: 1.0 },
  leather: { surf: 'leather', seed: 5, env: 0.25, normalScale: 1.4 },
  cloth: { csurf: 'wool', seed: 6, env: 0.12, side: THREE.DoubleSide, normalScale: 1.0, uv: 1.4 },
  wood: { surf: 'wood', seed: 7, env: 0.15 },
  skin: { csurf: 'flesh', seed: 8, env: 0.35, normalScale: 1.2, uv: 2.2 },
  fur: { csurf: 'fur', seed: 9, env: 0.1, normalScale: 1.4, uv: 1.8 },
  steel: { csurf: 'steel', seed: 15, env: 1.1, normalScale: 0.8 },
  mail: { csurf: 'mail', seed: 16, env: 0.9, normalScale: 1.0, uv: 1.0 },
  scales: { csurf: 'scales', seed: 17, env: 0.3, normalScale: 1.2, uv: 1.2 },
  stone: { csurf: 'weathered', seed: 10, env: 0.2, normalScale: 1.2, uv: 1.3 },
  magma: { csurf: 'charred', seed: 11, env: 0.15, normalScale: 1.2, cracks: true, uv: 1.4 },
  magmastone: { csurf: 'magmastone', seed: 12, env: 0.15, normalScale: 1.2, cracks: true, uv: 0.9 },
};
export const MAT_KEYS = [...Object.keys(MAT_DEFS), 'slime', 'ghost', 'glow', 'spirit', 'dark'];
const libCache = new WeakMap();

function makeEnv(renderer) {
  const scene = new THREE.Scene();
  const geo = new THREE.SphereGeometry(10, 48, 24);
  const col = [];
  const p = geo.getAttribute('position');
  const c = new THREE.Color();
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i) / 10, a = Math.atan2(p.getX(i), p.getZ(i));
    c.setRGB(0.05, 0.055, 0.07);
    c.lerp(new THREE.Color(0.22, 0.12, 0.05), smooth(0.4, -0.2, y));
    const torch = Math.max(0, Math.cos(a * 2 + 0.5)) ** 8 * smooth(-0.3, 0.1, y) * smooth(0.6, 0.2, y);
    c.r += torch * 2.4; c.g += torch * 1.1; c.b += torch * 0.35;
    const sky = smooth(0.5, 1, y);
    c.r += sky * 0.12; c.g += sky * 0.16; c.b += sky * 0.24;
    col.push(c.r, c.g, c.b);
  }
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  scene.add(new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide })));
  const pm = new THREE.PMREMGenerator(renderer);
  const rt = pm.fromScene(scene, 0.02);
  pm.dispose();
  geo.dispose();
  return rt.texture;
}

export function materialLib(factory) {
  let lib = libCache.get(factory);
  if (lib) return lib;
  const env = makeEnv(factory.renderer);
  const mats = new Map();
  lib = (key) => {
    if (mats.has(key)) return mats.get(key);
    let m;
    const d = MAT_DEFS[key];
    if (d && d.csurf) {
      const t = creatureSurface(factory.renderer, d.csurf, d.size ?? 512, d.seed);
      m = new THREE.MeshStandardMaterial({ map: t.map, normalMap: t.normalMap, roughnessMap: t.ormMap, metalnessMap: t.ormMap, aoMap: t.ormMap, roughness: 1, metalness: 1, vertexColors: true, side: d.side ?? THREE.FrontSide, normalScale: new THREE.Vector2(d.normalScale ?? 1, d.normalScale ?? 1) });
      m.envMap = env; m.envMapIntensity = d.env;
      if (d.cracks) m.userData.cracks = { alpha: true };
    } else if (d) {
      m = makeSurfaceMaterial(factory, d.surf, { size: d.size ?? 512, seed: d.seed, vertexColors: true, side: d.side, normalScale: d.normalScale ?? 1 });
      m.envMap = env; m.envMapIntensity = d.env;
      if (d.cracks) m.userData.cracks = { lo: d.crackLo ?? 0.045, hi: d.crackHi ?? 0.012 };
    } else if (key === 'slime') {
      const t = factory.get('dirt', 512, 13);
      m = new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.16, metalness: 0.0, normalMap: t.normalMap, normalScale: new THREE.Vector2(0.3, 0.3), transparent: true, opacity: 0.5, depthWrite: false, emissive: 0x071a04, emissiveIntensity: 1 });
      m.envMap = env; m.envMapIntensity = 1.0;
    } else if (key === 'ghost') {
      const t = factory.get('cloth', 512, 14);
      m = new THREE.MeshStandardMaterial({ map: t.map, color: 0xffffff, vertexColors: true, roughness: 0.9, metalness: 0, transparent: true, opacity: 0.62, depthWrite: false, side: THREE.DoubleSide, emissive: 0x123a40, emissiveIntensity: 1 });
      m.envMap = env; m.envMapIntensity = 0.3;
    } else if (key === 'glow') {
      m = new THREE.MeshBasicMaterial({ vertexColors: true });
    } else if (key === 'spirit') {
      m = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    } else if (key === 'dark') {
      m = new THREE.MeshStandardMaterial({ color: 0x050403, vertexColors: true, roughness: 0.9, metalness: 0 });
    } else throw new Error('unknown enemy material ' + key);
    m.name = 'enemy:' + key;
    mats.set(key, m);
    return m;
  };
  lib.env = env;
  libCache.set(factory, lib);
  return lib;
}

// Per-instance shader extensions: cloth flutter, jelly wobble, emissive cracks
const VCHUNK = /* glsl */ `
#ifdef EN_FLUTTER
  {
    float fw = aAnim;
    float ph = uTime * uFlutterSpeed;
    transformed.x += (sin(ph * 3.1 + position.y * 4.0 + position.z * 3.0) * 0.6 + sin(ph * 5.3 + position.x * 7.0) * 0.4) * fw * uFlutter;
    transformed.z += (sin(ph * 2.3 + position.y * 3.0 + position.x * 5.0 + 1.3)) * fw * uFlutter * 1.2;
    transformed.y += sin(ph * 2.9 + position.x * 4.0) * fw * uFlutter * 0.35;
    transformed += uDrag * fw;
  }
#endif
#ifdef EN_WOBBLE
  {
    float w = sin(uTime * 2.7 + position.y * 5.0 + position.x * 3.0) * 0.5 + sin(uTime * 3.9 + position.z * 6.0 - position.y * 2.0) * 0.5;
    transformed += objectNormal * w * uWobble * aAnim;
  }
#endif
`;
const FCHUNK = /* glsl */ `
#ifdef EN_CRACKS
  {
    float crack = texture2D(roughnessMap, vRoughnessMapUv).a;
    float pulse = 0.7 + 0.3 * sin(uTime * 2.6 + vMapUv.x * 13.0 + vMapUv.y * 7.0);
    totalEmissiveRadiance += uCrack * crack * pulse;
  }
#endif
`;

// Shared rim light for every enemy: a faint edge glow so silhouettes separate from
// dark rooms without flattening the torch-lit look. Colour is set per realm.
export const RIM = { uRim: { value: new THREE.Color(0.22, 0.2, 0.2) } };
export function setEnemyRim(color, k = 1) { RIM.uRim.value.set(color).multiplyScalar(k); }
const RIM_CHUNK = `
#ifdef EN_RIM
  {
    // use the smooth geometric normal, not the bumpy mapped one, so only true silhouette edges catch it
    // abs(): the back of double-sided cloth faces away from the eye and would otherwise rim-light whole
    float ndv = clamp(abs(dot(normalize(vNormal), normalize(vViewPosition))), 0.0, 1.0);
    totalEmissiveRadiance += uRim * pow(1.0 - ndv, 4.0) * 1.6;
  }
#endif
`;

export function patchInstanceMaterial(mat, U, feats) {
  const keyBits = [];
  if (!mat.isMeshBasicMaterial) keyBits.push('R');
  if (feats.flutter) keyBits.push('F');
  if (feats.wobble && !mat.isMeshBasicMaterial) keyBits.push('W');
  if (feats.cracks) keyBits.push('C');
  if (!keyBits.length) return;
  mat.defines = { ...(mat.defines || {}) };
  if (keyBits.includes('F')) mat.defines.EN_FLUTTER = '';
  if (keyBits.includes('W')) mat.defines.EN_WOBBLE = '';
  if (keyBits.includes('C')) mat.defines.EN_CRACKS = '';
  if (keyBits.includes('R')) mat.defines.EN_RIM = '';
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, U, RIM);
    if (keyBits.includes('R')) {
      sh.fragmentShader = 'uniform vec3 uRim;\n' + sh.fragmentShader.replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n' + RIM_CHUNK);
    }
    sh.vertexShader = 'attribute float aAnim;\nuniform float uTime, uFlutter, uFlutterSpeed, uWobble;\nuniform vec3 uDrag;\n' +
      sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n' + VCHUNK);
    if (keyBits.includes('C')) {
      sh.fragmentShader = 'uniform float uTime, uCrackLo, uCrackHi;\nuniform vec3 uCrack;\n' +
        sh.fragmentShader.replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n' + FCHUNK);
    }
  };
  mat.customProgramCacheKey = () => 'enemyfx:' + keyBits.join('');
}

// ------------------------------------------------------------ rig build ----
function toColor(c) {
  if (c == null) return [1, 1, 1];
  if (Array.isArray(c)) return c;
  const col = new THREE.Color(c);
  return [col.r, col.g, col.b];
}

const _lv = new THREE.Vector3();
// Skin weights along a chain of bones: chain = [[boneName, posAlongAxis], ...] sorted by pos.
export function chainSkin(chain, axisFn) {
  return (v) => {
    const t = axisFn(v);
    if (t <= chain[0][1]) return [[chain[0][0], 1]];
    for (let i = 0; i < chain.length - 1; i++) {
      const a = chain[i], b = chain[i + 1];
      if (t <= b[1]) { const u = (t - a[1]) / (b[1] - a[1]); return [[a[0], 1 - u], [b[0], u]]; }
    }
    return [[chain[chain.length - 1][0], 1]];
  };
}

export class Rig {
  constructor() {
    this.root = new THREE.Group();
    this.bones = {};
    this.boneList = [];
    this.parts = [];
    this.uvScale = 1.6;
  }
  bone(name, parent, x = 0, y = 0, z = 0, opts = {}) {
    const b = new THREE.Bone();
    b.name = name;
    b.position.set(x, y, z);
    if (opts.rate) b.userData.rate = opts.rate;
    (parent ? this.bones[parent] : this.root).add(b);
    this.bones[name] = b;
    this.boneList.push(b);
    return b;
  }
  has(name) { return !!this.bones[name]; }
  // add a part: geometry in bone-local space transformed by t
  // opts: c (color hex | [r,g,b] linear, can be >1 for glow), anim (number | fn(localPos)->weight), uv (scale | false keeps uv)
  add(bone, mat, geo, t = {}, opts = {}) {
    if (!this.bones[bone]) throw new Error('no bone ' + bone);
    this.parts.push({ bone, mat, geo, t, opts });
    return this;
  }
  // mirrored pair helper: adds part at +x on boneL and mirrored at -x on boneR
  pair(boneL, boneR, mat, geo, t = {}, opts = {}) {
    this.add(boneL, mat, geo, t, opts);
    this.add(boneR, mat, geo, { ...t, x: -(t.x ?? 0), ry: -(t.ry ?? 0), rz: -(t.rz ?? 0), sx: -(t.sx ?? 1) }, opts);
    return this;
  }
  socket(name, bone, x = 0, y = 0, z = 0) {
    const o = new THREE.Object3D();
    o.name = name;
    o.position.set(x, y, z);
    this.bones[bone].add(o);
    return o;
  }
  finish(lib) {
    this.root.updateMatrixWorld(true);
    const byMat = new Map();
    const boneIndex = new Map(this.boneList.map((b, i) => [b, i]));
    const local = new THREE.Matrix4(), full = new THREE.Matrix4(), nm = new THREE.Matrix3();
    const v = new THREE.Vector3(), n = new THREE.Vector3();
    let tris = 0;
    for (const part of this.parts) {
      const src = part.geo;
      const bone = this.bones[part.bone];
      xfMatrix(part.t, local);
      full.multiplyMatrices(bone.matrixWorld, local);
      nm.getNormalMatrix(full);
      const sp = src.getAttribute('position');
      if (!src.getAttribute('normal')) src.computeVertexNormals();
      const sn = src.getAttribute('normal');
      const cnt = sp.count;
      const pos = new Float32Array(cnt * 3), nrm = new Float32Array(cnt * 3), uv = new Float32Array(cnt * 2), col = new Float32Array(cnt * 3), an = new Float32Array(cnt);
      const si = new Uint16Array(cnt * 4), sw = new Float32Array(cnt * 4);
      const c = toColor(part.opts.c);
      const bi = boneIndex.get(bone);
      const animFn = part.opts.anim;
      const keepUV = part.opts.uv === false && src.getAttribute('uv');
      const su = src.getAttribute('uv');
      const uvS = typeof part.opts.uv === 'number' ? part.opts.uv : (MAT_DEFS[part.mat]?.uv ?? this.uvScale);
      const colFn = part.opts.cfn;
      const skinFn = part.opts.skin; // fn(local pos in bone space) -> [[boneName, w], ...]
      for (let i = 0; i < cnt; i++) {
        v.fromBufferAttribute(sp, i);
        if (animFn !== undefined) an[i] = typeof animFn === 'function' ? animFn(v) : animFn;
        if (colFn) { const cc = colFn(v); col[i * 3] = cc[0]; col[i * 3 + 1] = cc[1]; col[i * 3 + 2] = cc[2]; } else { col[i * 3] = c[0]; col[i * 3 + 1] = c[1]; col[i * 3 + 2] = c[2]; }
        v.applyMatrix4(local);
        const lx = v.x, ly = v.y, lz = v.z;
        v.applyMatrix4(bone.matrixWorld);
        n.fromBufferAttribute(sn, i).applyMatrix3(nm).normalize();
        pos[i * 3] = v.x; pos[i * 3 + 1] = v.y; pos[i * 3 + 2] = v.z;
        nrm[i * 3] = n.x; nrm[i * 3 + 1] = n.y; nrm[i * 3 + 2] = n.z;
        if (keepUV) { uv[i * 2] = su.getX(i); uv[i * 2 + 1] = su.getY(i); } else {
          // box projection in part space (keeps texture glued to the part)
          const ax = Math.abs(n.x), ay = Math.abs(n.y), az = Math.abs(n.z);
          let a, b2;
          if (ax >= ay && ax >= az) { a = lz; b2 = ly; } else if (ay >= az) { a = lx; b2 = lz; } else { a = lx; b2 = ly; }
          uv[i * 2] = a * uvS + bi * 0.37; uv[i * 2 + 1] = b2 * uvS + bi * 0.21;
        }
        if (skinFn) {
          const ws = skinFn(_lv.set(lx, ly, lz));
          let tot = 0;
          for (let k = 0; k < Math.min(4, ws.length); k++) tot += ws[k][1];
          for (let k = 0; k < Math.min(4, ws.length); k++) {
            const bb = this.bones[ws[k][0]];
            if (!bb) throw new Error('skin: no bone ' + ws[k][0]);
            si[i * 4 + k] = boneIndex.get(bb); sw[i * 4 + k] = ws[k][1] / (tot || 1);
          }
        } else { si[i * 4] = bi; sw[i * 4] = 1; }
      }
      let index;
      if (src.index) index = Array.from(src.index.array);
      else index = [...Array(cnt).keys()];
      if (full.determinant() < 0) for (let i = 0; i < index.length; i += 3) { const t = index[i + 1]; index[i + 1] = index[i + 2]; index[i + 2] = t; }
      tris += index.length / 3;
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
      g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
      g.setAttribute('color', new THREE.BufferAttribute(col, 3));
      g.setAttribute('aAnim', new THREE.BufferAttribute(an, 1));
      g.setAttribute('skinIndex', new THREE.BufferAttribute(si, 4));
      g.setAttribute('skinWeight', new THREE.BufferAttribute(sw, 4));
      g.setIndex(index);
      if (!byMat.has(part.mat)) byMat.set(part.mat, []);
      byMat.get(part.mat).push(g);
    }
    const skeleton = new THREE.Skeleton(this.boneList);
    const order = { dark: 0, bone: 1, glow: 3, slime: 5, ghost: 6, spirit: 7 };
    for (const [key, geos] of byMat) {
      const geo = mergeGeometries(geos, false);
      geos.forEach((g) => g.dispose());
      const mesh = new THREE.SkinnedMesh(geo, lib(key));
      mesh.name = 'mesh:' + key;
      mesh.userData.matKey = key;
      mesh.renderOrder = order[key] ?? 2;
      mesh.bind(skeleton);
      this.root.add(mesh);
    }
    this.tris = tris;
    // uniform model scale: wrap bones + meshes in a scaled group (skinning stays correct
    // because bones and meshes share the scaled ancestor)
    if (this.scale && this.scale !== 1) {
      const sc = new THREE.Group();
      sc.name = 'scaler';
      sc.scale.setScalar(this.scale);
      for (const c of [...this.root.children]) sc.add(c);
      this.root.add(sc);
    }
    return this.root;
  }
}

// --------------------------------------------------------- pose buffer ----
// Additive per-frame target pose. 9 floats per bone: rx ry rz px py pz sx sy sz
const K = 9;
export class PoseBuf {
  constructor(bones) {
    this.bones = bones;
    this.n = bones.length;
    this.idx = new Map(bones.map((b, i) => [b.name, i]));
    this.tgt = new Float32Array(this.n * K);
    this.cur = new Float32Array(this.n * K);
    this.rest = bones.map((b) => b.position.clone());
    this.rate = bones.map((b) => b.userData.rate ?? 1);
    for (let i = 0; i < this.n; i++) this.cur[i * K + 6] = this.cur[i * K + 7] = this.cur[i * K + 8] = 1;
    this.reset();
  }
  reset() { this.tgt.fill(0); for (let i = 0; i < this.n; i++) this.tgt[i * K + 6] = this.tgt[i * K + 7] = this.tgt[i * K + 8] = 1; }
  r(name, x = 0, y = 0, z = 0, w = 1) {
    const i = this.idx.get(name); if (i === undefined) return this;
    const o = i * K; this.tgt[o] += x * w; this.tgt[o + 1] += y * w; this.tgt[o + 2] += z * w; return this;
  }
  p(name, x = 0, y = 0, z = 0, w = 1) {
    const i = this.idx.get(name); if (i === undefined) return this;
    const o = i * K; this.tgt[o + 3] += x * w; this.tgt[o + 4] += y * w; this.tgt[o + 5] += z * w; return this;
  }
  s(name, s) { return this.sc(name, s, s, s); }
  sc(name, x, y, z) { const i = this.idx.get(name); if (i !== undefined) { const o = i * K; this.tgt[o + 6] *= x; this.tgt[o + 7] *= y; this.tgt[o + 8] *= z; } return this; }
  // apply a pose object { bone: [rx,ry,rz, px,py,pz] } with weight
  apply(pose, w = 1) {
    if (!pose || w === 0) return this;
    for (const k in pose) {
      const v = pose[k];
      this.r(k, v[0] ?? 0, v[1] ?? 0, v[2] ?? 0, w);
      if (v.length > 3) this.p(k, v[3] ?? 0, v[4] ?? 0, v[5] ?? 0, w);
    }
    return this;
  }
  blend(a, b, u, w = 1) { this.apply(a, (1 - u) * w); this.apply(b, u * w); return this; }
  get(name) { const i = this.idx.get(name); return i === undefined ? null : this.tgt.subarray(i * K, i * K + K); }
  damp(dt, rate) {
    const { tgt, cur, bones, rest } = this;
    for (let i = 0; i < this.n; i++) {
      const a = 1 - Math.exp(-rate * this.rate[i] * dt);
      const o = i * K;
      for (let k = 0; k < K; k++) cur[o + k] += (tgt[o + k] - cur[o + k]) * a;
      const b = bones[i];
      b.rotation.set(cur[o], cur[o + 1], cur[o + 2]);
      b.position.set(rest[i].x + cur[o + 3], rest[i].y + cur[o + 4], rest[i].z + cur[o + 5]);
      b.scale.set(Math.max(1e-4, cur[o + 6]), Math.max(1e-4, cur[o + 7]), Math.max(1e-4, cur[o + 8]));
    }
  }
  snap() { this.cur.set(this.tgt); }
}

// ------------------------------------------------------------ instance ----
const _white = new THREE.Color(1, 1, 1);
const orbGeoCache = new Map();
function orbGeo() {
  if (!orbGeoCache.has('o')) orbGeoCache.set('o', new THREE.IcosahedronGeometry(1, 2));
  return orbGeoCache.get('o');
}

export class EnemyInstance {
  constructor(spec, template, lib) {
    this.spec = spec;
    this.type = spec.id;
    this.root = SkeletonUtils.clone(template.root);
    this.root.name = 'enemy:' + spec.id;
    this.height = spec.height;
    this.radius = spec.radius;
    this._flying = !!spec.flying;
    this.eyeColor = spec.eyeColor;
    this.magicColor = spec.magicColor ?? spec.eyeColor;
    this.time = Math.random() * 100;
    this.seed = Math.random();
    this.state = { phase: Math.random() * TAU, lastAnim: null };
    this._flash = 0;
    this._tint = null; this._tintK = 0;
    this._opacity = 1;
    this._dirty = true;
    // uniforms shared by this instance's patched materials
    this.U = {
      uTime: { value: 0 }, uFlutter: { value: spec.flutter ?? 0.03 }, uFlutterSpeed: { value: 1 }, uWobble: { value: 0 },
      uDrag: { value: new THREE.Vector3() }, uCrack: { value: new THREE.Color(spec.crackColor ?? 0xff5a10).multiplyScalar(spec.crackIntensity ?? 3) },
      uCrackLo: { value: 0.045 }, uCrackHi: { value: 0.012 },
    };
    // per-instance materials
    const clones = new Map();
    this.mats = [];
    this.meshes = [];
    const bones = [];
    let skeleton = null;
    this.root.traverse((o) => {
      if (o.isBone) bones.push(o);
      if (o.isSkinnedMesh) {
        this.meshes.push(o);
        if (!skeleton) skeleton = o.skeleton; else o.skeleton = skeleton;
        const base = o.material;
        if (!clones.has(base)) {
          const m = base.clone();
          const key = o.userData.matKey;
          const cr = base.userData.cracks;
          patchInstanceMaterial(m, this.U, { flutter: true, wobble: !!spec.wobble, cracks: !!cr });
          clones.set(base, m);
          this.mats.push({ m, key, color: m.color.clone(), em: m.emissive ? m.emissive.clone().multiplyScalar(m.emissiveIntensity) : null, opacity: m.opacity, transparent: m.transparent, depthWrite: m.depthWrite });
        }
        o.material = clones.get(base);
        o.frustumCulled = true;
        o.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, spec.height * 0.5, 0), Math.max(spec.height, spec.length ?? 0) * 0.85 + 1);
      }
    });
    this.skeleton = skeleton;
    this.bones = {};
    bones.forEach((b) => (this.bones[b.name] = b));
    this.P = new PoseBuf(bones);
    this.sockets = {};
    this.root.traverse((o) => { if (!o.isBone && !o.isMesh && o !== this.root) this.sockets[o.name] = o; });
    this.muzzle = this.sockets.muzzle ?? this.root;
    // muzzle orb (per instance; hidden until it grows)
    const mc = new THREE.Color(this.magicColor);
    this.orbMat = new THREE.MeshBasicMaterial({ color: mc.clone().multiplyScalar(2.2) });
    this.haloMat = new THREE.MeshBasicMaterial({ color: mc.clone().multiplyScalar(0.6), transparent: true, opacity: 0.3, blending: THREE.AdditiveBlending, depthWrite: false });
    this.orb = new THREE.Mesh(orbGeo(), this.orbMat);
    this.halo = new THREE.Mesh(orbGeo(), this.haloMat);
    this.orb.add(this.halo); this.halo.scale.setScalar(1.5);
    this.orb.visible = false; this.orb.scale.setScalar(0.001);
    this.orbSize = spec.orbSize ?? 0.08;
    this._orbK = 0;
    this.muzzle.add(this.orb);
  }
  get flying() { return !!this._flying; }
  // force the flying pose on/off (types whose flight is anim-driven, e.g. stoneWyvern, also honour this)
  setFlying(b) { this._flyForce = !!b; this._flying = !!b || !!this.spec.flying; }
  flash(a = 1) { this._flash = Math.max(this._flash, clamp(a)); this._dirty = true; }
  setTint(hex, k = 1) {
    if (hex == null) { if (!this._tint) return; this._tint = null; this._tintK = 0; }
    else {
      if (this._tint && this._tintHex === hex && this._tintK === clamp(k)) return;
      this._tint = (this._tint ?? new THREE.Color()).set(hex); this._tintHex = hex; this._tintK = clamp(k);
    }
    this._dirty = true;
  }
  // called by poses during death / spawn; reset to 1 every frame otherwise
  setOpacity(o) { this._opTarget = o; }
  // grows the muzzle orb toward k (0..1)
  setOrb(k) { this._orbTarget = k; }
  _updateOrb(dt) {
    const tgt = this._orbTarget ?? 0;
    this._orbK += (tgt - this._orbK) * (1 - Math.exp(-10 * dt));
    const k = this._orbK;
    this.orb.visible = k > 0.02;
    const pulse = 1 + Math.sin(this.time * 18) * 0.08;
    this.orb.scale.setScalar(Math.max(0.001, k * this.orbSize * pulse));
    this.haloMat.opacity = 0.22 + 0.1 * Math.sin(this.time * 11);
  }
  _applyMats() {
    const f = this._flash, tk = this._tintK, tc = this._tint;
    const op = this._opacity;
    for (const e of this.mats) {
      const m = e.m;
      m.color.copy(e.color);
      if (tc) m.color.lerp(tc, tk * (m.isMeshBasicMaterial ? 0.3 : 0.45));
      if (m.isMeshBasicMaterial) {
        if (f > 0) m.color.lerp(_white, f * 0.5);
      } else {
        m.emissive.copy(e.em);
        if (tc) m.emissive.r += tc.r * tk * 0.22, m.emissive.g += tc.g * tk * 0.22, m.emissive.b += tc.b * tk * 0.22;
        if (f > 0) { m.emissive.r += f * 0.5; m.emissive.g += f * 0.47; m.emissive.b += f * 0.44; }
        m.emissiveIntensity = 1;
      }
      const o = e.opacity * op;
      const tr = e.transparent || op < 0.999;
      if (tr !== m.transparent) { m.transparent = tr; m.depthWrite = tr ? false : e.depthWrite; m.needsUpdate = true; }
      m.opacity = o;
    }
  }
  update(dt, s = {}) {
    dt = Math.min(dt, 0.1);
    this.time += dt;
    this.U.uTime.value = this.time;
    const st = this.state;
    const anim = s.anim ?? 'idle';
    if (anim !== st.lastAnim) { st.prevAnim = st.lastAnim; st.lastAnim = anim; st.animStart = this.time; }
    const S = { anim, t: s.t ?? this.time - st.animStart, speed: s.speed ?? 0, progress: clamp(s.progress ?? 0), attackType: s.attackType || this.spec.defaultAttack };
    this.P.reset();
    this._orbTarget = 0;
    this._opTarget = 1;
    let rate = 12;
    const r = this.spec.pose(this, S, this.P, dt);
    if (typeof r === 'number') rate = r;
    this.P.damp(dt, rate);
    if (Math.abs(this._opTarget - this._opacity) > 1e-3) { this._opacity = this._opTarget; this._dirty = true; }
    this._updateOrb(dt);
    if (this._flash > 0) { this._flash = Math.max(0, this._flash - dt * 8); this._dirty = true; }
    if (this._dirty) { this._applyMats(); this._dirty = this._flash > 0; }
  }
  dispose() {
    for (const e of this.mats) e.m.dispose();
    this.orbMat.dispose(); this.haloMat.dispose();
    if (this.skeleton) this.skeleton.dispose();
    this.root.removeFromParent();
  }
}
