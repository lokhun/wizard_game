import * as THREE from 'three';
import { mulberry, fbm3, roundedBox, sphere, torus, lathe, xf, noisify, tubeVar, leaf, feather, gear, crystal } from './shapes.js';

// ---------------------------------------------------------------------------
// Geometry for the third-person wizard bodies. Everything is authored in the
// avatar's ROOT space in its bind pose (origin at the feet, facing +Z, the
// character's left at +X) and carries per-vertex colours (linear RGB) that
// the batcher multiplies into a white base material. Fold relief, grime,
// fold occlusion, trims and scorch marks all live in those colours.
// ---------------------------------------------------------------------------

export const TAU = Math.PI * 2;
export const BODY_Y = { hips: 0.97, spine: 1.02, chest: 1.26, neck: 1.51, head: 1.62, shoulder: 1.455, knee: 0.49, ankle: 0.075, hipJ: 0.94 };
export const SHOULDER_X = 0.195, HIP_X = 0.095;
export const BELT_Y = 1.035;
export const SKIRT_TOP = 0.985;

const lin = (hex) => { const c = new THREE.Color(hex); return [c.r, c.g, c.b]; };
export const C = lin;
const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const mul = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
export const cmix = mix, cmul = mul;
const sstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
export const smoothstep = sstep;

// ---- body silhouette ---------------------------------------------------------
// y, half-width, front depth, back depth
const BODY = [
  [0.78, 0.168, 0.125, 0.135],
  [0.9, 0.178, 0.13, 0.142],
  [0.98, 0.17, 0.12, 0.122],
  [1.05, 0.16, 0.114, 0.108],
  [1.15, 0.167, 0.123, 0.111],
  [1.25, 0.178, 0.134, 0.116],
  [1.34, 0.19, 0.134, 0.12],
  [1.4, 0.196, 0.122, 0.115],
  [1.435, 0.184, 0.108, 0.106],
  [1.465, 0.152, 0.092, 0.094],
  [1.495, 0.105, 0.074, 0.078],
  [1.525, 0.064, 0.058, 0.062],
  [1.6, 0.054, 0.052, 0.054],
];
function catmull(p0, p1, p2, p3, t) {
  const t2 = t * t, t3 = t2 * t;
  return 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
}
const _br = { rx: 0, zf: 0, zb: 0 };
export function bodyR(y, out = _br) {
  const n = BODY.length;
  if (y <= BODY[0][0]) { out.rx = BODY[0][1]; out.zf = BODY[0][2]; out.zb = BODY[0][3]; return out; }
  if (y >= BODY[n - 1][0]) { out.rx = BODY[n - 1][1]; out.zf = BODY[n - 1][2]; out.zb = BODY[n - 1][3]; return out; }
  let i = 0;
  while (i < n - 2 && BODY[i + 1][0] < y) i++;
  const t = (y - BODY[i][0]) / (BODY[i + 1][0] - BODY[i][0]);
  const g = (k, j) => BODY[Math.min(n - 1, Math.max(0, k))][j];
  out.rx = catmull(g(i - 1, 1), g(i, 1), g(i + 1, 1), g(i + 2, 1), t);
  out.zf = catmull(g(i - 1, 2), g(i, 2), g(i + 1, 2), g(i + 2, 2), t);
  out.zb = catmull(g(i - 1, 3), g(i, 3), g(i + 1, 3), g(i + 2, 3), t);
  return out;
}
// superellipse point on a cross-section
const se = (v, e) => Math.sign(v) * Math.pow(Math.abs(v), e);
export function ringPt(rx, zf, zb, a, e = 0.85) {
  const s = Math.sin(a), c = Math.cos(a);
  return [rx * se(s, e), (c > 0 ? zf : zb) * se(c, e)];
}

// ---- small geometry utilities -----------------------------------------------
export function paint(geo, c) {
  const n = geo.getAttribute('position').count;
  const a = new Float32Array(n * 3);
  if (typeof c === 'function') {
    const p = geo.getAttribute('position');
    for (let i = 0; i < n; i++) { const r = c(p.getX(i), p.getY(i), p.getZ(i), i); a[i * 3] = r[0]; a[i * 3 + 1] = r[1]; a[i * 3 + 2] = r[2]; }
  } else for (let i = 0; i < n; i++) { a[i * 3] = c[0]; a[i * 3 + 1] = c[1]; a[i * 3 + 2] = c[2]; }
  geo.setAttribute('color', new THREE.BufferAttribute(a, 3));
  return geo;
}
// merge keeping colours (non-indexed output)
export function cat(geos) {
  const list = geos.filter(Boolean).map((g) => (g.index ? g.toNonIndexed() : g));
  let n = 0;
  for (const g of list) n += g.getAttribute('position').count;
  const pos = new Float32Array(n * 3), nrm = new Float32Array(n * 3), uv = new Float32Array(n * 2), col = new Float32Array(n * 3).fill(1);
  let o = 0;
  for (const g of list) {
    if (!g.getAttribute('normal')) g.computeVertexNormals();
    const P = g.getAttribute('position'), N = g.getAttribute('normal'), U = g.getAttribute('uv'), K = g.getAttribute('color');
    for (let i = 0; i < P.count; i++) {
      pos[(o + i) * 3] = P.getX(i); pos[(o + i) * 3 + 1] = P.getY(i); pos[(o + i) * 3 + 2] = P.getZ(i);
      nrm[(o + i) * 3] = N.getX(i); nrm[(o + i) * 3 + 1] = N.getY(i); nrm[(o + i) * 3 + 2] = N.getZ(i);
      if (U) { uv[(o + i) * 2] = U.getX(i); uv[(o + i) * 2 + 1] = U.getY(i); }
      if (K) { col[(o + i) * 3] = K.getX(i); col[(o + i) * 3 + 1] = K.getY(i); col[(o + i) * 3 + 2] = K.getZ(i); }
    }
    o += P.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  out.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return out;
}
function gridGeo(pos, uv, col, cols, rows, flip, closedWeld) {
  const idx = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const a = r * (cols + 1) + c, b = a + cols + 1;
    if (flip) idx.push(a, a + 1, b, b, a + 1, b + 1); else idx.push(a, b, a + 1, b, b + 1, a + 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  if (closedWeld) weldNormals(g);
  return g;
}
// average normals of coincident vertices (closes lathe / ring seams)
export function weldNormals(g) {
  const p = g.getAttribute('position'), n = g.getAttribute('normal');
  const m = new Map();
  const key = (i) => `${Math.round(p.getX(i) * 2e3)},${Math.round(p.getY(i) * 2e3)},${Math.round(p.getZ(i) * 2e3)}`;
  for (let i = 0; i < p.count; i++) {
    const k = key(i);
    const a = m.get(k) || [0, 0, 0];
    a[0] += n.getX(i); a[1] += n.getY(i); a[2] += n.getZ(i);
    m.set(k, a);
  }
  for (let i = 0; i < p.count; i++) {
    const a = m.get(key(i));
    const l = Math.hypot(a[0], a[1], a[2]) || 1;
    n.setXYZ(i, a[0] / l, a[1] / l, a[2] / l);
  }
  return g;
}

// ---- garment shell -----------------------------------------------------------
// A tube of cloth around the vertical axis from y0 (top) to y1 (hem).
//  R(y) -> { rx, zf, zb } base cross-section (offset already applied)
//  panels: [[aStart(y), aEnd(y)], ...] angular spans (a = 0 at the front)
//  fold: { n, amp(t) }  vertical drape folds (t = 0 top .. 1 hem)
//  pinch: [{ y, w, k }] horizontal creases (belt line)
//  tatter, seed: ragged hem; trim: { col, edge (m), hem (m), raise }
//  paint(ctx) -> rgb   ctx = { t, a, y, f (fold -1..1), x, z, edge, hem }
//  flip: inward-facing (linings)
export function garment(o) {
  const rows = o.rows;
  const rnd = mulberry(o.seed ?? 1);
  const J = Array.from({ length: 64 }, () => rnd());
  const panels = o.panels ?? [[() => 0, () => TAU]];
  const geos = [];
  const fold = o.fold ?? { n: 7, amp: () => 0 };
  const ph1 = rnd() * 6, ph2 = rnd() * 6;
  const R = { rx: 0, zf: 0, zb: 0 };
  const ym = (o.y0 + o.y1) / 2;
  const spanTot = panels.reduce((t, [aS, aE]) => t + (aE(ym) - aS(ym)), 0);
  for (const [aS, aE] of panels) {
    const pos = [], uv = [], col = [];
    const cols = Math.max(3, Math.round(o.seg * (aE(ym) - aS(ym)) / Math.max(spanTot, 1e-3)));
    // column distribution: denser at the panel edges so trims stay crisp
    const us = [];
    const eU = o.trim?.edge ? 0.5 : 0;
    for (let c = 0; c <= cols; c++) {
      let u = c / cols;
      if (eU) u = u < 0.5 ? 0.5 * Math.pow(u * 2, 1.35) : 1 - 0.5 * Math.pow((1 - u) * 2, 1.35);
      us.push(u);
    }
    for (let r = 0; r <= rows; r++) {
      const t = r / rows;
      const tt = o.rowCurve ? o.rowCurve(t) : t;
      let y = o.y0 + (o.y1 - o.y0) * tt;
      o.R(y, R);
      const a0 = aS(y), a1 = aE(y);
      for (let c = 0; c <= cols; c++) {
        const u = us[c];
        const a = a0 + (a1 - a0) * u;
        // drape folds: two octaves of vertical waves that drift with height
        let f = 0;
        const amp = fold.amp(tt, y);
        if (amp > 0) {
          f = 0.62 * Math.sin(a * fold.n + ph1 + y * 1.7) + 0.38 * Math.sin(a * fold.n * 2.17 + ph2 - y * 2.3) + 0.35 * fbm3(a * 2.2, y * 3, 0.5, o.seed ?? 1, 2);
          f = Math.max(-1, Math.min(1, f));
        }
        let off = amp * f;
        if (o.pinch) for (const pc of o.pinch) {
          const d = (y - pc.y) / pc.w;
          off -= pc.k * Math.exp(-d * d);
          if (pc.ripple) off += pc.ripple * Math.sin(a * 23 + ph1) * Math.exp(-Math.pow((y - pc.y + pc.w * 1.6) / pc.w, 2));
        }
        // hem edge: distance to panel edges in metres
        const rr = (R.rx + R.zf) * 0.5;
        const edgeD = Math.min((a - a0) * rr, (a1 - a) * rr);
        const panelEdge = o.edgeAt ? o.edgeAt(a0, a1) : [true, true];
        const eDist = Math.min(panelEdge[0] ? (a - a0) * rr : 9, panelEdge[1] ? (a1 - a) * rr : 9);
        let hemD = (o.y1 - o.y0) * (1 - tt) * -1; // metres above the hem (positive)
        hemD = Math.abs(hemD);
        if (o.trim?.raise) {
          if (o.trim.edge && eDist < o.trim.edge) off += o.trim.raise;
          if (o.trim.hem && hemD < o.trim.hem) off += o.trim.raise;
        }
        if (o.quilt) {
          if (r % 2 === 1) off -= o.quilt.depth;
          if (c % 3 === 0) off -= o.quilt.depth * 0.6;
        }
        const [px, pz] = ringPt(R.rx + off, R.zf + off, R.zb + off, a, o.e ?? 0.85);
        // ragged hem
        let yy = y;
        if (r >= rows - 1 && o.tatter) {
          const j = J[Math.floor(((a % TAU) + TAU) % TAU / TAU * 61) % 61];
          const strip = (c % 3 === 0 ? 1 : c % 3 === 1 ? 0.35 : 0.6);
          const cut = o.tatter * (0.25 * j + 0.75 * j * strip) * (r === rows ? 1 : 0.35);
          yy += cut;
        }
        pos.push(px, yy, pz);
        uv.push(a * rr * 2.2, yy * 2.2);
        const ctx = { t: tt, a, y: yy, f, x: px, z: pz, edge: eDist, hem: hemD, u };
        col.push(...(o.paint ? o.paint(ctx) : [1, 1, 1]));
      }
    }
    geos.push(gridGeo(pos, uv, col, cols, rows, !!o.flip, o.weld !== false));
  }
  return geos.length === 1 ? geos[0] : cat(geos);
}

// Standard cloth painter: base colour, fold occlusion, trims, grime toward
// the hem, optional scorch / fade / moss patches.
export function clothPaint(o) {
  const base = o.col, trim = o.trim ?? null, seed = o.seed ?? 3;
  const grime = o.grime ?? 0.35, gcol = o.grimeCol ?? lin(0x2a241c);
  return (c) => {
    let k = 1 + c.f * (o.ao ?? 0.16);
    let col = base;
    if (o.fade) {
      const n = fbm3(c.x * 6, c.y * 4, c.z * 6, seed + 9, 3);
      col = mix(col, o.fadeCol ?? mul(base, 1.6), Math.max(0, n) * o.fade);
    }
    if (o.moss) {
      const n = fbm3(c.x * 5 + 3, c.y * 5, c.z * 5, seed + 4, 3);
      col = mix(col, o.mossCol, sstep(0.05, 0.35, n) * o.moss * (0.4 + 0.6 * c.t));
    }
    if (trim && ((o.trimEdge && c.edge < o.trimEdge) || (o.trimHem && c.hem < o.trimHem))) col = trim;
    if (o.band && Math.abs(c.hem - o.band.at) < o.band.w) col = o.band.col;
    const g = sstep(o.grimeFrom ?? 0.6, 1, c.t) * grime;
    col = mix(col, gcol, g);
    if (o.scorch) {
      const n = fbm3(c.x * 7, c.y * 9, c.z * 7, seed, 3);
      const s = sstep(o.scorch * 0.9, -0.1, c.hem - n * 0.12);
      col = mix(col, lin(0x0c0806), s * 0.92);
    }
    if (o.dark) k *= 1 - o.dark * sstep(o.darkFrom ?? 0.2, 0, c.t);
    return mul(col, k);
  };
}

// ---- tubes along the limbs ---------------------------------------------------
// prof: [[r, dy]] from top (dy = 0 at the joint) downward (dy < 0)
export function limb(jx, jy, jz, prof, o = {}) {
  const seg = o.seg ?? 12;
  const pts = prof.map(([r, y]) => new THREE.Vector2(Math.max(0.001, r), y)).reverse();
  const g = new THREE.LatheGeometry(pts, seg);
  const p = g.getAttribute('position');
  const rnd = mulberry(o.seed ?? 5);
  const ph = rnd() * 6;
  for (let i = 0; i < p.count; i++) {
    let x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const a = Math.atan2(x, z);
    if (o.folds) {
      const k = 1 + o.folds * (Math.sin(a * 5 + ph + y * 9) * 0.6 + Math.sin(a * 11 - y * 14) * 0.4);
      x *= k; z *= k;
    }
    x *= o.sx ?? 1; z *= o.sz ?? 1;
    if (o.bend) z += o.bend(y);
    p.setXYZ(i, x + jx, y + jy, z + jz);
  }
  g.computeVertexNormals();
  weldNormals(g);
  const u = g.getAttribute('uv');
  for (let i = 0; i < u.count; i++) u.setXY(i, u.getX(i) * 1.2, u.getY(i) * 1.5);
  return paint(g, o.paint ? (x, y, z) => o.paint(x - jx, y - jy, z - jz) : (o.col ?? [1, 1, 1]));
}

// ---- boots -------------------------------------------------------------------
export function bootGeo(side, o) {
  const ax = side * HIP_X, ay = BODY_Y.ankle;
  const leather = o.col, dark = mul(o.col, 0.45);
  // foot: rounded box with a tapered toe and heel
  const foot = roundedBox(0.096, 0.085, 0.25, 0.038, 2);
  const p = foot.getAttribute('position');
  for (let i = 0; i < p.count; i++) {
    let x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const tz = (z + 0.125) / 0.25; // 0 heel .. 1 toe
    x *= 1 - 0.18 * Math.max(0, tz - 0.6) / 0.4 + (tz < 0.2 ? -0.05 : 0);
    if (y > 0) y *= 1 - 0.55 * Math.max(0, tz - 0.45) / 0.55;
    if (o.pointy) z += Math.max(0, tz - 0.8) * 0.06 * (1 - Math.abs(x) / 0.05);
    p.setXYZ(i, x + side * 0.004, y, z);
  }
  foot.computeVertexNormals();
  xf(foot, { x: ax, y: 0.045, z: 0.045 });
  paint(foot, (x, y) => (y < 0.012 ? dark : mul(leather, 0.85 + 0.25 * sstep(0.02, 0.09, y))));
  const sole = paint(xf(roundedBox(0.1, 0.018, 0.26, 0.008, 1), { x: ax + side * 0.004, y: 0.009, z: 0.047 }), mul(dark, 0.7));
  // shaft up the calf, with a folded cuff
  const top = o.height ?? 0.3;
  const shaftProf = [[0.05, top + 0.01], [0.064, top], [0.066, top - 0.045], [0.058, top - 0.05], [0.058, top * 0.55], [0.05, 0.08], [0.052, 0.0]];
  const shaft = limb(ax, ay, 0, shaftProf.map(([r, y]) => [r, y]), { seg: 12, folds: 0.03, paint: (x, y) => (y > top - 0.05 ? mul(leather, 1.12) : mul(leather, 0.8 + 0.25 * (y / top))) });
  const parts = [foot, sole, shaft];
  if (o.fur) parts.push(paint(xf(noisify(torus(0.07, 0.028, 6, 14), 0.008, 40, side + 3, 2), { rx: Math.PI / 2, x: ax, y: ay + top - 0.01 }), o.fur));
  if (o.strap) {
    parts.push(paint(xf(torus(0.06, 0.007, 3, 10), { rx: Math.PI / 2, x: ax, y: ay + top * 0.45 }), mul(dark, 1.4)));
    parts.push(paint(xf(roundedBox(0.02, 0.022, 0.008, 0.003, 1), { x: ax + side * 0.058, y: ay + top * 0.45, z: 0.012, ry: side * 1.3 }), o.strap));
  }
  if (o.wrap) {
    const wp = [];
    for (let i = 0; i <= 12; i++) wp.push([0.058 + (i % 2) * 0.007, 0.26 - i * 0.018]);
    parts.push(limb(ax, ay, 0, wp, { seg: 10, folds: 0.04, paint: (x, y) => mul(o.wrap, 0.8 + 0.25 * Math.sin(y * 170)) }));
  }
  return { foot: cat([foot, sole]), shaft: cat(parts.slice(2)) };
}

// ---- head ----------------------------------------------------------------------
// A cranium with a tapering jaw, plus explicit brow ridge, nose, cheekbones,
// chin and dark eye sockets (a sphere fine enough to carve a nose would cost
// far more). Vertex colours darken the sockets and the underside; hooded
// faces get a deep cowl shadow over the eyes.
export function headGeo(o = {}) {
  const skin = o.col ?? lin(0x8a6a5a);
  const shade = o.shade ?? 1;
  const tone = (k) => {
    let c = mul(skin, k * shade);
    const l = (c[0] + c[1] + c[2]) / 3;
    return mix(c, [l, l, l], o.desat ?? 0.25);
  };
  const hoodK = (y) => (o.hood ? 0.4 + 0.6 * sstep(0.025, -0.08, y) : 1);
  const g = new THREE.SphereGeometry(0.09, 16, 12);
  const p = g.getAttribute('position');
  const cols = [];
  for (let i = 0; i < p.count; i++) {
    let x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    x *= 0.86; y *= 1.03;
    const front = Math.max(0, z / 0.09);
    if (y < -0.015) {
      const k = Math.min(1, (-0.015 - y) / 0.075);
      x *= 1 - 0.34 * k * k;
      y -= k * 0.012;
      if (z < 0) z *= 1 - 0.4 * k; else z *= 1 - 0.08 * k;
    }
    if (z < -0.02 && y > -0.03) z *= 1.07;
    // flatten the face plane a little
    if (z > 0.05) z = 0.05 + (z - 0.05) * 0.75;
    p.setXYZ(i, x, y, z);
    let k = (0.55 + 0.45 * sstep(-0.1, 0.02, y)) * (0.6 + 0.4 * Math.pow(front, 0.6));
    cols.push(...tone(k * hoodK(y)));
  }
  g.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
  g.computeVertexNormals();
  const uv = g.getAttribute('uv');
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 3, uv.getY(i) * 3);
  const part = (geo, k) => paint(geo, (x, y) => tone(k * hoodK(y)));
  // brow ridge: a flattened arc across the forehead
  const brow = torus(0.036, 0.009, 4, 12, Math.PI);
  xf(brow, { rx: Math.PI / 2 });
  brow.scale(1.25, 0.7, 0.85);
  xf(brow, { y: 0.017, z: 0.047 });
  // nose: a sheared wedge, narrow at the bridge and wide at the nostrils
  const nose = roundedBox(0.02, 0.044, 0.022, 0.007, 1);
  const np = nose.getAttribute('position');
  for (let i = 0; i < np.count; i++) {
    const x = np.getX(i), y = np.getY(i), z = np.getZ(i);
    const t = (0.022 - y) / 0.044; // 0 bridge .. 1 tip
    np.setXYZ(i, x * (0.55 + 0.6 * t), y, z * (0.5 + 0.6 * t) + t * 0.008);
  }
  nose.computeVertexNormals();
  xf(nose, { y: -0.018, z: 0.086, rx: 0.12 });
  const cheeks = cat([sphere(0.017, 6, 5, { x: 0.04, y: -0.02, z: 0.052, sx: 1.3, sy: 0.6, sz: 0.8 }), sphere(0.017, 6, 5, { x: -0.04, y: -0.02, z: 0.052, sx: 1.3, sy: 0.6, sz: 0.8 })]);
  const chin = sphere(0.022, 7, 5, { y: -0.086, z: 0.045, sx: 1.3, sy: 0.7, sz: 0.85 });
  const sockets = cat([sphere(0.014, 6, 5, { x: 0.029, y: 0.002, z: 0.064, sz: 0.5 }), sphere(0.014, 6, 5, { x: -0.029, y: 0.002, z: 0.064, sz: 0.5 })]);
  const mouth = xf(roundedBox(0.03, 0.004, 0.008, 0.002, 1), { y: -0.056, z: 0.072 });
  return cat([
    g, part(brow, 0.95), part(nose, 1.05), part(cheeks, 1.0), part(chin, 0.85),
    paint(sockets, tone(0.22 * (o.hood ? 0.5 : 1))), paint(mouth, tone(0.35)),
  ]);
}

// beard: layered fur shell hanging from the jaw. len = how far below the chin
export function beardGeo(o) {
  const len = o.len ?? 0.12;
  const prof = [[0.078, 0.0], [0.086, -0.03], [0.084, -0.06], [0.07, -0.07 - len * 0.3], [0.05, -0.07 - len * 0.65], [0.02, -0.07 - len], [0.0, -0.075 - len]];
  const g = lathe(prof, 16, -Math.PI * 0.62, Math.PI * 1.24);
  const p = g.getAttribute('position');
  const rnd = mulberry(o.seed ?? 4);
  const J = Array.from({ length: 20 }, () => rnd());
  for (let i = 0; i < p.count; i++) {
    let x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const a = Math.atan2(x, z);
    z *= 0.92;
    // mouth gap at the front top, fuller below the chin
    if (y < -0.075) { const k = Math.min(1, (-0.075 - y) / len); z += 0.02 * (1 - k) + 0.004; }
    // the long part drapes forward over the chest
    if (y < -0.08) z += (-0.08 - y) * 0.6;
    if (o.fork && y < -0.07 - len * 0.6) x += Math.sign(x) * 0.012 * ((-0.07 - len * 0.6 - y) / (len * 0.4));
    const j = J[Math.floor((a / Math.PI + 1) * 9.5) % 20];
    y -= j * 0.012 * Math.min(1, Math.max(0, (-0.06 - y) / 0.04));
    p.setXYZ(i, x * 0.92, y + 0.005, z + 0.016);
  }
  g.computeVertexNormals();
  noisify(g, 0.004, 60, o.seed ?? 4, 2);
  const u = g.getAttribute('uv');
  for (let i = 0; i < u.count; i++) u.setXY(i, u.getX(i) * 3, u.getY(i) * 1.5);
  const col = o.col;
  paint(g, (x, y) => mul(col, 0.75 + 0.35 * sstep(-0.2, -0.02, y)));
  // moustache
  const m = [];
  for (const s of [-1, 1]) {
    const pts = [new THREE.Vector3(s * 0.003, -0.044, 0.088), new THREE.Vector3(s * 0.02, -0.049, 0.082), new THREE.Vector3(s * 0.033, -0.062, 0.072), new THREE.Vector3(s * 0.037, -0.08, 0.064)];
    m.push(paint(tubeVar(pts, (t) => 0.006 * (1 - t * 0.6) + 0.002, 8, 5, true), mul(col, 0.9)));
  }
  return cat([g, ...m]);
}

// ---- ribbons (straps, stoles, sashes, sigils) -----------------------------------
// pts / nrm: Vector3 arrays (path and surface normal). w: width, th: thickness.
// edge: [rgb, fraction] for trimmed edges.
export function ribbon(pts, nrm, w, th, colFn, o = {}) {
  const pos = [], col = [], uv = [], idx = [];
  const n = pts.length;
  const T = new THREE.Vector3(), S = new THREE.Vector3(), N = new THREE.Vector3();
  const across = o.edge ? [-0.5, -0.5 + o.edge[1], 0.5 - o.edge[1], 0.5] : [-0.5, 0.5];
  const m = across.length;
  let len = 0;
  for (let i = 0; i < n; i++) {
    if (i > 0) len += pts[i].distanceTo(pts[i - 1]);
    T.subVectors(pts[Math.min(n - 1, i + 1)], pts[Math.max(0, i - 1)]).normalize();
    N.copy(nrm[i]).normalize();
    S.crossVectors(N, T).normalize();
    const ww = typeof w === 'function' ? w(i / (n - 1)) : w;
    for (let j = 0; j < m; j++) {
      const q = pts[i].clone().addScaledVector(S, across[j] * ww).addScaledVector(N, th);
      pos.push(q.x, q.y, q.z);
      uv.push(j / (m - 1), len * 4);
      const edge = o.edge && (j === 0 || j === m - 1);
      col.push(...(edge ? o.edge[0] : colFn(i / (n - 1), j)));
    }
  }
  for (let i = 0; i < n - 1; i++) for (let j = 0; j < m - 1; j++) {
    const a = i * m + j, b = a + m;
    idx.push(a, b, a + 1, b, b + 1, a + 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// ---- belt and accessories ---------------------------------------------------------
// belt band hugging an elliptic waist (rx, rz) at height y
export function beltGeo(rx, rz, y, h, col, o = {}) {
  const prof = [[0.985, -h / 2 - 0.002], [1, -h / 2], [1, h / 2], [0.985, h / 2 + 0.002]];
  const seg = 36;
  const pos = [], uv = [], cl = [];
  for (let r = 0; r < prof.length; r++) for (let c = 0; c <= seg; c++) {
    const a = (c / seg) * TAU;
    const k = prof[r][0];
    pos.push(Math.sin(a) * rx * k, y + prof[r][1], Math.cos(a) * rz * k);
    uv.push(c / seg * 6, r * 0.1);
    const st = o.studs && c % 3 === 0 && r === 1 ? 1.2 : 1;
    cl.push(...mul(col, (r === 0 || r === 3 ? 0.7 : 1) * st));
  }
  return gridGeo(pos, uv, cl, seg, prof.length - 1, false, true);
}
export function beltPt(rx, rz, y, a, out = new THREE.Vector3()) { return out.set(Math.sin(a) * rx, y, Math.cos(a) * rz); }
// orientation helper: local +Z faces outward from the waist at angle a
export function onBelt(geo, rx, rz, y, a, lift = 0, out = 0, tilt = 0) {
  const nx = Math.sin(a) / rx, nz = Math.cos(a) / rz;
  const ry = Math.atan2(nx, nz);
  const p = beltPt(rx, rz, y, a);
  return xf(geo, { rx: tilt, ry, x: p.x + Math.sin(ry) * out, y: p.y + lift, z: p.z + Math.cos(ry) * out, order: 'YXZ' });
}
export function buckleGeo(col, w = 0.05, h = 0.048) {
  const t = 0.008;
  return paint(cat([
    xf(roundedBox(w, t, t, 0.003, 1), { y: h / 2 - t / 2 }), xf(roundedBox(w, t, t, 0.003, 1), { y: -h / 2 + t / 2 }),
    xf(roundedBox(t, h, t, 0.003, 1), { x: w / 2 - t / 2 }), xf(roundedBox(t, h, t, 0.003, 1), { x: -w / 2 + t / 2 }),
    xf(roundedBox(0.004, h * 0.8, 0.006, 0.002, 1), { z: 0.003 }),
  ]), col);
}
export function pouchGeo(w, h, d, col, flapCol, btn) {
  const body = paint(roundedBox(w, h, d, Math.min(w, d) * 0.3, 1), (x, y) => mul(col, 0.8 + 0.3 * sstep(-h / 2, h / 2, y)));
  xf(body, { z: d / 2 });
  const flap = paint(xf(roundedBox(w * 1.04, h * 0.45, d * 0.25, 0.006, 1), { y: h * 0.3, z: d * 0.95 }), flapCol ?? mul(col, 0.8));
  const parts = [body, flap];
  if (btn) parts.push(paint(sphere(0.007, 6, 4, { y: h * 0.12, z: d * 1.1 }), btn));
  return cat(parts);
}
export function vialGeo(glassCol, corkCol) {
  return {
    glass: paint(cat([xf(new THREE.CylinderGeometry(0.012, 0.012, 0.045, 8), { y: 0.0 }), sphere(0.013, 8, 6, { y: -0.022 })]), glassCol),
    cork: paint(xf(new THREE.CylinderGeometry(0.0075, 0.008, 0.016, 6), { y: 0.03 }), corkCol),
  };
}
export function bookGeo(coverCol, pageCol, metalCol, s = 1) {
  const cover = paint(roundedBox(0.11 * s, 0.15 * s, 0.035 * s, 0.006, 1), (x, y, z) => mul(coverCol, Math.abs(z) > 0.015 * s ? 1 : 0.6));
  const pages = paint(xf(roundedBox(0.1 * s, 0.14 * s, 0.03 * s, 0.002, 1), { x: 0.006 * s }), pageCol);
  const corners = [];
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) corners.push(xf(roundedBox(0.022 * s, 0.022 * s, 0.038 * s, 0.003, 1), { x: sx * 0.045 * s, y: sy * 0.065 * s }));
  corners.push(xf(roundedBox(0.03 * s, 0.012 * s, 0.04 * s, 0.003, 1), { x: 0.05 * s }));
  return { leather: cover, pages, metal: paint(cat(corners), metalCol) };
}
export function scrollCaseGeo(col, capCol) {
  return {
    body: paint(xf(new THREE.CylinderGeometry(0.024, 0.024, 0.28, 10), {}), (x, y) => mul(col, 0.85 + 0.2 * Math.abs(Math.sin(y * 30)))),
    caps: paint(cat([xf(new THREE.CylinderGeometry(0.027, 0.027, 0.03, 10), { y: 0.14 }), xf(new THREE.CylinderGeometry(0.027, 0.027, 0.03, 10), { y: -0.14 }), xf(torus(0.026, 0.004, 4, 12), { rx: Math.PI / 2, y: 0.05 })]), capCol),
  };
}
export function chainGeo(a, b, col, r = 0.008) {
  const n = Math.max(2, Math.round(a.distanceTo(b) / (r * 2.8)));
  const g = [];
  const d = new THREE.Vector3().subVectors(b, a);
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.clone().normalize());
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n;
    const link = torus(r, r * 0.32, 3, 6);
    link.scale(1, 1.5, 1);
    if (i % 2) link.rotateY(Math.PI / 2);
    link.applyQuaternion(q);
    const p = a.clone().addScaledVector(d, t);
    link.translate(p.x, p.y, p.z);
    g.push(link);
  }
  return paint(cat(g), col);
}
export function cordGeo(a, b, col, r = 0.003) {
  return paint(tubeVar([a, a.clone().lerp(b, 0.5).add(new THREE.Vector3(0, -0.004, 0.002)), b], r, 6, 4, false), col);
}

// charms hung on cords (local space: hanging point at origin, item below)
export function charmGeo(kind, cols, seed = 1) {
  const rnd = mulberry(seed);
  switch (kind) {
    case 'bones': {
      const g = [];
      for (let i = 0; i < 3; i++) {
        const L = 0.05 + rnd() * 0.03;
        const b = cat([xf(new THREE.CylinderGeometry(0.005, 0.005, L, 5, 1, true), {}), sphere(0.008, 5, 3, { y: L / 2, sx: 1.4 }), sphere(0.008, 5, 3, { y: -L / 2, sx: 1.4 })]);
        xf(b, { x: (i - 1) * 0.016, y: -0.03 - L / 2 - rnd() * 0.02, rz: (rnd() - 0.5) * 0.4 });
        g.push(b);
      }
      return { bone: paint(cat(g), cols.bone) };
    }
    case 'skull': {
      const cr = sphere(0.022, 8, 6, { y: -0.04, sx: 0.9, sz: 1.1 });
      const jaw = xf(roundedBox(0.026, 0.016, 0.022, 0.006, 1), { y: -0.062, z: 0.006 });
      const sock = cat([sphere(0.0065, 5, 4, { x: 0.008, y: -0.043, z: 0.02 }), sphere(0.0065, 5, 4, { x: -0.008, y: -0.043, z: 0.02 })]);
      return { bone: paint(cat([cr, jaw]), cols.bone), void: sock };
    }
    case 'hourglass': {
      const glass = cat([xf(new THREE.ConeGeometry(0.014, 0.024, 8), { y: -0.026, rx: Math.PI }), xf(new THREE.ConeGeometry(0.014, 0.024, 8), { y: -0.05 })]);
      const frame = cat([xf(new THREE.CylinderGeometry(0.018, 0.018, 0.005, 8), { y: -0.012 }), xf(new THREE.CylinderGeometry(0.018, 0.018, 0.005, 8), { y: -0.064 }),
        ...[0, 1, 2].map((i) => xf(new THREE.CylinderGeometry(0.0018, 0.0018, 0.052, 4), { x: Math.sin(i * 2.1) * 0.016, z: Math.cos(i * 2.1) * 0.016, y: -0.038 }))]);
      return { glow: glass, metal: paint(frame, cols.metal) };
    }
    case 'gear': {
      const g = gear(9, 0.018, 0.024, 0.005, 0.007);
      xf(g, { y: -0.03 });
      return { metal: paint(g, cols.metal) };
    }
    case 'crystal': {
      const c = crystal(0.05, 0.012, 6, seed);
      xf(c, { rx: Math.PI, y: -0.008 });
      return { glow: c, metal: paint(xf(new THREE.CylinderGeometry(0.008, 0.01, 0.01, 6), { y: -0.005 }), cols.metal) };
    }
    case 'feathers': {
      const f = [];
      for (let i = 0; i < 3; i++) {
        const fg = feather(0.09 + rnd() * 0.04, 0.012, seed + i);
        xf(fg, { rz: Math.PI + (i - 1) * 0.35, ry: (rnd() - 0.5) * 0.6 });
        f.push(fg);
      }
      return { plainDS: paint(cat(f), cols.feather) };
    }
    case 'stone': {
      const s = noisify(sphere(0.02, 8, 6, { sy: 1.3 }), 0.004, 30, seed, 2);
      xf(s, { y: -0.03 });
      return { glow: s };
    }
    case 'herbs': {
      const g = [];
      for (let i = 0; i < 5; i++) {
        const l = leaf(0.06, 0.012, 0.2);
        xf(l, { rz: Math.PI + (i - 2) * 0.25, ry: rnd() * TAU, y: -0.01 });
        g.push(l);
      }
      return { plainDS: paint(cat(g), cols.leaf) };
    }
    default: return {};
  }
}
