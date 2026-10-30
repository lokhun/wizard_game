import * as THREE from 'three';
import { mulberry, fbm3, roundedBox, sphere, torus, xf, noisify, tubeVar, leaf, feather, gear, crystal } from './shapes.js';

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
  // (a numeric key per half-millimetre cell: string keys cost more than the rest of a garment)
  const m = new Map();
  const ids = new Float64Array(p.count);
  for (let i = 0; i < p.count; i++) {
    const k = ((Math.round(p.getX(i) * 2e3) + 4096) * 8192 + (Math.round(p.getY(i) * 2e3) + 4096)) * 8192 + (Math.round(p.getZ(i) * 2e3) + 4096);
    ids[i] = k;
    let a = m.get(k);
    if (!a) { a = [0, 0, 0]; m.set(k, a); }
    a[0] += n.getX(i); a[1] += n.getY(i); a[2] += n.getZ(i);
  }
  for (let i = 0; i < p.count; i++) {
    const a = m.get(ids[i]);
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
  // the cloth's offset from its cross-section at (a, y): drape folds and pinches
  const FO = { f: 0, amp: 0, off: 0 };
  const foldAt = (a, y, tt) => {
    let f = 0;
    let amp = fold.amp(tt, y);
    if (amp > 0 && o.pipe) {
      // pipe folds: round ridges hanging from the waist with narrow valleys between, each its
      // own depth, wandering a little as they fall; a finer ripple and noise over them
      const u = (a * fold.n) / TAU + 0.18 * Math.sin(y * 3.1 + ph1) + 0.08 * fbm3(a * 3, y * 2, 1.5, o.seed ?? 1, 2);
      const p = Math.cos(TAU * u);
      f = 2 * Math.pow((p + 1) / 2, 0.55) - 1;
      amp *= 0.65 + 0.7 * J[(Math.floor(u + 0.5) % 61 + 61) % 61];
      f += 0.22 * Math.sin(a * fold.n * 2.6 + ph2 - y * 2.3) * tt + 0.18 * fbm3(a * 2.2, y * 3, 0.5, o.seed ?? 1, 2);
      f = Math.max(-1, Math.min(1, f));
    } else if (amp > 0) {
      // two octaves of vertical waves that drift with height
      f = 0.62 * Math.sin(a * fold.n + ph1 + y * 1.7) + 0.38 * Math.sin(a * fold.n * 2.17 + ph2 - y * 2.3) + 0.35 * fbm3(a * 2.2, y * 3, 0.5, o.seed ?? 1, 2);
      f = Math.max(-1, Math.min(1, f));
    }
    let off = amp * f;
    if (o.pinch) for (const pc of o.pinch) {
      const d = (y - pc.y) / pc.w;
      off -= pc.k * Math.exp(-d * d);
      if (pc.ripple) off += pc.ripple * Math.sin(a * 23 + ph1) * Math.exp(-Math.pow((y - pc.y + pc.w * 1.6) / pc.w, 2));
    }
    FO.f = f; FO.amp = amp; FO.off = off;
    return FO;
  };
  // a point on the finished cloth (folds and the draped hem included; not tatters), `lift`
  // metres out from it: for trims and embroidery laid over the garment
  const R2 = { rx: 0, zf: 0, zb: 0 };
  const surf = (a, y, lift = 0, out = new THREE.Vector3()) => {
    const tt = Math.min(1, Math.max(0, (y - o.y0) / (o.y1 - o.y0)));
    o.R(y, R2);
    const fo = foldAt(a, y, tt);
    const [px, pz] = ringPt(R2.rx + fo.off + lift, R2.zf + fo.off + lift, R2.zb + fo.off + lift, a, o.e ?? 0.85);
    const yy = o.pipe && tt > 0.7 ? y - fo.f * fo.amp * 0.9 * sstep(0.7, 1, tt) : y;
    return out.set(px, yy, pz);
  };
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
        const fo = foldAt(a, y, tt);
        const f = fo.f, amp = fo.amp;
        let off = fo.off;
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
        // a draped hem: the ridges hang a little lower than the valleys
        if (o.pipe && tt > 0.7) yy -= f * amp * 0.9 * sstep(0.7, 1, tt);
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
  const out = geos.length === 1 ? geos[0] : cat(geos);
  out.userData.surf = surf;
  return out;
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
    // compression creases (a sleeve bunching at the elbow): rings running a little diagonal
    if (o.creases) for (const c of o.creases) {
      const d = (y - c.y) / c.w;
      if (Math.abs(d) > 3) continue;
      const k = 1 + c.k * Math.exp(-d * d) * (0.5 + 0.5 * Math.sin((y - c.y) * (c.n ?? 160) + Math.sin(a + ph) * 1.6 + a * 0.5));
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
  // the last: half-width along the foot (tz 0 heel .. 1 toe), narrow heel, broad ball, rounded toe
  const L = 0.25, z0 = 0.045 - L / 2;
  const hw = (tz) => 0.047 * (0.8 + 0.2 * sstep(0, 0.35, tz)) * (1 - 0.22 * sstep(0.72, 1, tz)) * (o.pointy ? 1 - 0.25 * sstep(0.6, 1, tz) : 1);
  const foot = roundedBox(0.096, 0.085, L, 0.038, 4);
  const p = foot.getAttribute('position');
  for (let i = 0; i < p.count; i++) {
    let x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const tz = (z + L / 2) / L;
    x *= hw(tz) / 0.048;
    if (y > 0) y *= 1 - 0.55 * Math.max(0, tz - 0.45) / 0.55;
    if (o.pointy) z += Math.max(0, tz - 0.8) * 0.06 * (1 - Math.abs(x) / 0.05);
    p.setXYZ(i, x + side * 0.004, y, z);
  }
  foot.computeVertexNormals();
  xf(foot, { x: ax, y: 0.054, z: 0.045 });
  // a toe cap (its seam a dark line across the vamp, worn paler at the toe), creases over the
  // instep, a stitched welt above the sole
  paint(foot, (x, y, z) => {
    const tz = (z - z0) / L;
    let k = 0.85 + 0.25 * sstep(0.02, 0.09, y);
    k *= 1 - 0.45 * Math.exp(-Math.pow((tz - 0.74 - Math.pow((x - ax) / 0.05, 2) * 0.06) / 0.012, 2));
    k *= 1 + 0.2 * sstep(0.8, 1, tz);
    k *= 1 - 0.12 * Math.max(0, Math.sin(tz * 70)) * Math.exp(-Math.pow((tz - 0.6) / 0.08, 2)) * sstep(0.04, 0.07, y);
    if (y < 0.03) k *= Math.sin(z * 260) > 0 ? 1.2 : 0.8;
    return mul(leather, k);
  });
  // sole and heel: extruded from the foot's own outline, so they never stick out past it
  const outline = (t0, t1, grow) => {
    const sh = new THREE.Shape();
    const n = 18;
    for (let i = 0; i <= n; i++) { const tz = t0 + (t1 - t0) * (i / n); const pt = [hw(tz) + grow, z0 + tz * L]; if (i === 0) sh.moveTo(...pt); else sh.lineTo(...pt); }
    if (t1 >= 1) for (let i = 1; i < 6; i++) { const a = (i / 6) * Math.PI; sh.lineTo(Math.cos(a) * (hw(1) + grow), z0 + L + Math.sin(a) * 0.012); }
    for (let i = n; i >= 0; i--) { const tz = t0 + (t1 - t0) * (i / n); sh.lineTo(-hw(tz) - grow, z0 + tz * L); }
    if (t0 <= 0) for (let i = 1; i < 6; i++) { const a = Math.PI + (i / 6) * Math.PI; sh.lineTo(Math.cos(a) * (hw(0) + grow), z0 + Math.sin(a) * 0.01); }
    return sh;
  };
  const slab = (sh, d, y) => xf(new THREE.ExtrudeGeometry(sh, { depth: d, bevelEnabled: true, bevelThickness: 0.002, bevelSize: 0.002, bevelSegments: 1, curveSegments: 4 }), { rx: Math.PI / 2, x: ax + side * 0.004, y: y + d });
  const sole = paint(slab(outline(0, 1, 0.004), 0.012, 0.006), (x, y) => mul(dark, y > 0.016 ? 0.9 : 0.6));
  const heel = paint(slab(outline(0, 0.3, 0.003), 0.008, 0.0), (x, y) => mul(dark, Math.sin(y * 700) > 0.3 ? 0.45 : 0.65));
  const top = o.height ?? 0.3;
  // the shaft up the calf, slouching into creases over the ankle, with a folded cuff (stitched)
  const shaftProf = [[0.05, top + 0.01], [0.064, top], [0.066, top - 0.045], [0.058, top - 0.05], [0.058, top * 0.55]];
  for (let k = 1; k <= 8; k++) shaftProf.push([0.058 - 0.007 * (k / 8), top * 0.55 - (top * 0.55 - 0.03) * (k / 8)]);
  shaftProf.push([0.052, 0.0]);
  const shaft = limb(ax, ay, 0, shaftProf, { seg: 16, folds: 0.03, creases: [{ y: 0.06, w: 0.04, k: 0.08, n: 120 }], paint: (x, y) => {
    if (y > top - 0.05) return mul(leather, Math.abs(y - (top - 0.04)) < 0.004 ? (Math.sin(Math.atan2(x, -0.01) * 40) > 0 ? 1.35 : 0.9) : 1.12);
    return mul(leather, (0.8 + 0.25 * (y / top)) * (1 - 0.18 * Math.exp(-Math.pow((y - 0.06) / 0.03, 2)) * (0.5 + 0.5 * Math.sin(y * 120))));
  } });
  const parts = [foot, sole, shaft];
  parts.splice(2, 0, heel);
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
  return { foot: cat([foot, sole, heel]), shaft: cat(parts.slice(3)) };
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

// ---- embroidered bands ----------------------------------------------------------------
// A raised band of embroidery laid along a path over a garment: seven threads across (the
// middle puffed out by `th`), the pattern painted from the arc length s (m) and the position
// across v (-1..1). pts / nrm: Vector3 arrays.
export function bandGeo(pts, nrm, w, th, paintFn) {
  const across = [-0.5, -0.36, -0.18, 0, 0.18, 0.36, 0.5];
  const m = across.length, n = pts.length;
  const pos = [], col = [], uv = [], idx = [];
  const T = new THREE.Vector3(), S = new THREE.Vector3(), N = new THREE.Vector3(), q = new THREE.Vector3();
  let len = 0;
  for (let i = 0; i < n; i++) {
    if (i > 0) len += pts[i].distanceTo(pts[i - 1]);
    T.subVectors(pts[Math.min(n - 1, i + 1)], pts[Math.max(0, i - 1)]).normalize();
    N.copy(nrm[i]).normalize();
    S.crossVectors(N, T).normalize();
    for (let j = 0; j < m; j++) {
      const v = across[j] * 2;
      q.copy(pts[i]).addScaledVector(S, across[j] * w).addScaledVector(N, th * (1 - v * v * 0.8));
      pos.push(q.x, q.y, q.z);
      uv.push(j / (m - 1), len * 6);
      col.push(...paintFn(len, v));
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
// embroidery patterns: (s, v) -> rgb. base: the band's ground, motif: the thread, P: repeat (m)
export function embroidery(kind, base, motif, P = 0.05) {
  const fr = (x) => x - Math.floor(x);
  const h1 = (k) => fr(Math.sin(k * 127.1 + 311.7) * 43758.5453);
  const edge = (v) => Math.abs(v) > 0.8;
  return (s, v) => {
    const u = s / P, q = Math.abs(fr(u) - 0.5) * 2; // 0 mid-repeat .. 1 at its ends
    let on = edge(v);
    switch (kind) {
      case 'vine': { // a winding stem with leaves either side
        const c = 0.5 * Math.sin(u * TAU);
        on = on || Math.abs(v - c) < 0.2 || (Math.abs(v + 0.55 * Math.sign(c)) < 0.18 && q < 0.25);
        break;
      }
      case 'diamond': { // a chain of lozenges, a dot in each
        on = on || Math.abs(Math.abs(v) * 1.15 - (1 - q)) < 0.22 || (q > 0.85 && Math.abs(v) < 0.2);
        break;
      }
      case 'zigzag': { // lightning: a sharp zigzag between the borders
        const z = (1 - q * 2) * 0.62;
        on = on || Math.abs(v - z) < 0.22;
        break;
      }
      case 'runes': { // blocky glyphs in cells, bars between
        const cell = Math.floor(u * 3), g = h1(cell);
        const x = fr(u * 3);
        on = on || (x < 0.12) || (x > 0.3 && x < 0.85 && ((g > 0.5 && Math.abs(v) < 0.3) || (g < 0.35 && Math.abs(Math.abs(v) - 0.45) < 0.15) || (g >= 0.35 && g <= 0.5 && Math.abs(v - (x - 0.55) * 2.6) < 0.25)));
        break;
      }
      case 'stitch': { // a welted leather edge: a row of stitches along each side
        const x = fr(u * 6);
        on = (Math.abs(Math.abs(v) - 0.62) < 0.13 && x < 0.55) || Math.abs(v) > 0.9;
        break;
      }
      case 'flame': { // tongues rising from the lower border
        const hgt = 0.35 + 0.5 * Math.pow(1 - q, 1.5) + 0.15 * Math.sin(u * 17);
        on = on || (v + 1) / 2 < hgt * (1 - Math.abs(fr(u * 2) - 0.5) * 1.2);
        break;
      }
      default:
    }
    return on ? motif : base;
  };
}

// ---- belt and accessories ---------------------------------------------------------
// belt band hugging an elliptic waist (rx, rz) at height y
export function beltGeo(rx, rz, y, h, col, o = {}) {
  // rolled edges, and a row of stitches just inside each (lighter dashes on a pressed line)
  const prof = [[0.985, -h / 2 - 0.002], [1, -h / 2], [1.002, -h * 0.34], [1.002, -h * 0.3], [1.004, 0], [1.002, h * 0.3], [1.002, h * 0.34], [1, h / 2], [0.985, h / 2 + 0.002]];
  const seg = 96;
  const pos = [], uv = [], cl = [];
  const last = prof.length - 1;
  for (let r = 0; r < prof.length; r++) for (let c = 0; c <= seg; c++) {
    const a = (c / seg) * TAU;
    const k = prof[r][0];
    pos.push(Math.sin(a) * rx * k, y + prof[r][1], Math.cos(a) * rz * k);
    uv.push(c / seg * 6, r * 0.05);
    const st = o.studs && c % 4 === 0 && r === 4 ? 1.25 : 1;
    const stitch = (r === 2 || r === 3 || r === 5 || r === 6) ? (c % 2 ? 1.3 : 0.72) : 1;
    cl.push(...mul(col, (r === 0 || r === last ? 0.6 : r === 1 || r === last - 1 ? 0.85 : 1) * st * stitch));
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
