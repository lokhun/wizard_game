import * as THREE from 'three';
import { V, mulberry, fbm3, sphere, tubeVar, xf } from './shapes.js';

// ---------------------------------------------------------------------------
// Sculpted heads for the third-person wizards. Authored around the head
// centre (origin), facing +Z, the character's left at +X, in metres; every
// part carries vertex colours (linear RGB) the batcher multiplies into its
// material: skin tone, lips, flush, socket shading, stubble and painted brows
// on the face; sclera, iris and pupil on the eyes; root-to-tip shading on
// hair and beards.
//
//  - the face is one sphere warped into a skull, its grid packed densely over
//    the face (about 3 mm apart round the eyes and mouth, 2 cm at the back of
//    the head) and pushed into features by smooth fields: brow ridge, eye
//    sockets, nose with its wings, cheekbones, lips and the crease between,
//    chin, jaw and temples
//  - eyeballs sit in the sockets under shell eyelids; ears are a curled shell
//    with a rolled rim
//  - hair, brows, beards and moustaches are clumps of tapered strands: folded
//    ribbons that follow the skull, then fall, over a darker under-layer so no
//    gap ever shows the scalp
// ---------------------------------------------------------------------------

const TAU = Math.PI * 2;
const sstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const g2 = (x, y, sx, sy) => Math.exp(-(x * x) / (sx * sx) - (y * y) / (sy * sy));
const lin = (hex) => { const c = new THREE.Color(hex); return [c.r, c.g, c.b]; };
const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const mul = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const mul3 = (a, b) => [a[0] * b[0], a[1] * b[1], a[2] * b[2]];

// eye centres (on the face plane) and the skull's half-extents
export const EYE = { x: 0.0305, y: 0.006, z: 0.0555, r: 0.0118 };
const SK = { x: 0.074, top: 0.094, zf: 0.087, zb: 0.097 };

// The skull's surface before the face is carved: an ellipsoid with a tapering
// jaw, a flatter face plane and a fuller back of the head. d: unit direction.
function skull(dx, dy, dz, out) {
  let x = SK.x * dx, y = SK.top * dy, z = (dz > 0 ? SK.zf : SK.zb) * dz;
  // jaw and chin: narrower and drawn forward below the cheekbones
  const k = sstep(-0.12, -0.95, dy);
  x *= 1 - 0.42 * k * k;
  y *= 1 + 0.17 * k;
  if (z < 0) z *= 1 - 0.62 * k; else z *= 1 - 0.1 * k;
  // the jaw angle: a slight corner below the ears
  x *= 1 + 0.06 * Math.exp(-Math.pow((dy + 0.5) / 0.18, 2)) * Math.max(0, 1 - Math.abs(dz) * 1.2);
  // temples in a little, the crown fuller behind
  x *= 1 - 0.05 * Math.exp(-Math.pow((dy - 0.35) / 0.2, 2)) * Math.max(0, dz);
  if (dz < 0 && dy > -0.2) z *= 1.04;
  // flatten the face plane
  if (z > 0.052) z = 0.052 + (z - 0.052) * 0.72;
  out.set(x, y, z);
  return out;
}

// Smooth fields carving the face, in metres on the face plane (x across,
// y up; returns the forward push, + out of the face).
function faceField(x, y, o) {
  const ax = Math.abs(x);
  let d = 0;
  // brow ridge: an arched band over the eyes, heavier for the old and stern
  const browY = 0.025 + 0.004 * Math.min(1, ax / 0.04) - 0.003 * Math.max(0, (ax - 0.04) / 0.02);
  d += (0.0042 + 0.002 * (o.brow ?? 0)) * Math.exp(-Math.pow((y - browY) / 0.0075, 2)) * sstep(0.06, 0.035, ax);
  // glabella between the brows
  d += 0.0022 * g2(x, y - 0.021, 0.012, 0.01);
  // eye sockets: a soft pit, deepest just under the brow
  const ex = ax - EYE.x, ey = y - EYE.y;
  d -= 0.0105 * g2(ex, ey + 0.001, 0.0175, 0.0135);
  // the eye opening itself (an almond) is cut deeper so the eyeball shows
  const alm = Math.pow(ex / 0.0125, 2) + Math.pow((ey + 0.0005 - 0.0018 * Math.max(0, -ex / 0.0125)) / 0.0062, 2);
  d -= 0.006 * Math.exp(-alm * alm * 1.6);
  // under-eye bags with age
  d += 0.0018 * (o.age ?? 0.3) * g2(ex + 0.001, ey + 0.015, 0.012, 0.004);
  // nose: a ridge from the bridge to the tip, wider and higher toward the tip
  const ny = y; // ~0.012 bridge .. -0.031 tip .. -0.04 base
  const nk = o.nose ?? 1;
  const nh = ny > 0.012 ? 0.003 * Math.exp(-Math.pow((ny - 0.012) / 0.008, 2))
    : ny > -0.031 ? 0.003 + (0.025 * nk - 0.003) * Math.pow((0.012 - ny) / 0.043, 1.25) + 0.0025 * (o.hook ?? 0) * Math.sin(Math.PI * (0.012 - ny) / 0.043)
      : (0.025 * nk) * Math.max(0, 1 - Math.pow((-0.031 - ny) / 0.011, 2));
  const nw = 0.0055 + 0.0065 * sstep(0.012, -0.03, ny);
  d += nh * Math.exp(-Math.pow(x / nw, 2) * 1.4);
  // nose wings (alae) either side of the tip, and the groove that bounds them
  d += 0.0085 * g2(ax - 0.0125, y + 0.033, 0.0062, 0.0055);
  d -= 0.002 * g2(ax - 0.02, y + 0.03, 0.002, 0.008);
  // cheekbones and the hollow below them
  d += 0.0065 * g2(ax - 0.044, y + 0.012, 0.017, 0.009);
  d -= (0.0025 + 0.002 * (o.gaunt ?? 0)) * g2(ax - 0.047, y + 0.042, 0.013, 0.012);
  // nasolabial folds: from the nose wings down past the mouth corners
  const fl = ax - (0.019 + (-(y + 0.035)) * 0.32);
  d += 0.0018 * Math.exp(-Math.pow(fl / 0.004, 2)) * sstep(-0.028, -0.036, y) * sstep(-0.075, -0.06, y);
  // muzzle: the mouth sits on a gently rounded mound
  d += 0.004 * g2(x, y + 0.058, 0.03, 0.022);
  // philtrum: a shallow groove down the middle of the upper lip
  d -= 0.0012 * g2(x, y + 0.046, 0.0035, 0.006);
  // lips: upper and lower, fuller at the middle, the lower one fuller
  const lw = Math.exp(-Math.pow(x / 0.021, 4));
  d += 0.0052 * lw * Math.exp(-Math.pow((y + 0.0535) / 0.0042, 2));
  d += 0.0062 * lw * Math.exp(-Math.pow((y + 0.0645) / 0.0048, 2));
  // the crease between them, and dimples at the corners
  d -= 0.0034 * Math.exp(-Math.pow(x / 0.023, 6)) * Math.exp(-Math.pow((y + 0.0585) / 0.0018, 2));
  d -= 0.002 * g2(ax - 0.024, y + 0.059, 0.003, 0.004);
  // the groove under the lower lip, then the chin
  d -= 0.0022 * g2(x, y + 0.076, 0.016, 0.0045);
  d += (0.0078 + 0.003 * (o.chin ?? 0)) * g2(x, y + 0.091, 0.017, 0.012);
  return d;
}

// Face paint (multiplies the skin tone): lips, flush, sockets, stubble, brows.
function facePaint(x, y, z, o) {
  const ax = Math.abs(x);
  const front = sstep(0.0, 0.07, z);
  let c = [1, 1, 1];
  // sockets shaded, a little cool and violet under the eye
  const ex = ax - EYE.x, ey = y - EYE.y;
  const sock = g2(ex, ey + 0.002, 0.016, 0.012) * front;
  c = mix(c, [0.55, 0.47, 0.5], sock * 0.75);
  c = mix(c, [0.82, 0.74, 0.8], g2(ex + 0.002, ey + 0.016, 0.012, 0.005) * front * 0.6);
  // flush over the cheeks, nose tip and ears' side
  const flush = (g2(ax - 0.042, y + 0.025, 0.02, 0.016) * 0.55 + g2(x, y + 0.028, 0.012, 0.012) * 0.6) * front * (o.flush ?? 1);
  c = mul3(c, mix([1, 1, 1], [1.04, 0.86, 0.84], flush));
  // lips
  const lw = Math.exp(-Math.pow(x / 0.0215, 4));
  const lip = lw * (Math.exp(-Math.pow((y + 0.0535) / 0.0038, 2)) * 0.8 + Math.exp(-Math.pow((y + 0.0645) / 0.0048, 2))) * front;
  c = mul3(c, mix([1, 1, 1], o.lipCol ?? [0.92, 0.6, 0.6], Math.min(1, lip)));
  // the line between the lips, nostrils
  c = mul(c, 1 - 0.65 * Math.exp(-Math.pow(x / 0.022, 6)) * Math.exp(-Math.pow((y + 0.0585) / 0.0016, 2)) * front);
  c = mul(c, 1 - 0.7 * g2(ax - 0.0075, y + 0.0385, 0.0035, 0.0022) * front);
  // stubble (or a shaved beard line) over the jaw, chin and upper lip
  if (o.stubble) {
    const jaw = sstep(-0.03, -0.055, y) * (1 - g2(x, y + 0.06, 0.02, 0.009) * 0.9);
    const lipZone = g2(x, y + 0.046, 0.022, 0.005);
    const sideburn = sstep(-0.0, -0.02, y) * sstep(0.055, 0.07, ax) * (1 - sstep(0.0, 0.03, -z));
    const st = Math.min(1, (jaw * sstep(0.02, 0.045, ax + 0.025) + lipZone + sideburn) * o.stubble);
    const n = 0.85 + 0.15 * fbm3(x * 900, y * 900, z * 900, 3, 1);
    c = mix(c, mul3(o.stubbleCol ?? [0.45, 0.42, 0.44], [n, n, n]), st * 0.5);
  }
  // painted brows (thick, tapering outward), in the hair colour
  if (o.browCol) {
    const t = ax / 0.052;
    const by = 0.0265 + 0.006 * Math.sin(Math.min(1, t) * Math.PI * 0.8) - 0.004 * Math.max(0, t - 0.8);
    const bw = 0.0042 * (1.15 - 0.6 * Math.min(1, t));
    const b = Math.exp(-Math.pow((y - by) / bw, 2)) * sstep(1.12, 0.92, t) * sstep(0.08, 0.2, t) * front;
    const n = 0.7 + 0.3 * Math.abs(Math.sin(x * 2400 + y * 900));
    c = mix(c, o.browCol, Math.min(1, b * 1.2) * n);
  }
  // shade beneath the jaw
  c = mul(c, 0.62 + 0.38 * sstep(-0.12, -0.06, y + Math.max(0, z) * 0.6));
  return c;
}

// grid parameterisation: dense over the face, sparse behind and at the poles
function warpU(s) { return Math.PI * (0.3 * s + 0.7 * s * s * s); } // s -1..1 -> azimuth, 0 = front
function warpV(t) {
  // polar angle: 10% of rows to 0-60 deg, 74% to 60-165 deg, the rest to the neck
  const a = 60 / 180, b = 165 / 180;
  if (t < 0.12) return Math.PI * a * (t / 0.12);
  if (t < 0.88) return Math.PI * (a + (b - a) * ((t - 0.12) / 0.76));
  return Math.PI * (b + (1 - b) * ((t - 0.88) / 0.12));
}

// The face: { geo } in head space with vertex colours.
//  o.col: skin (linear rgb), o.shade, o.desat, o.hood (cowl shadow over the eyes)
//  o.detail: 1 (open face) .. 0.6 (hooded, mostly in shadow)
//  o.stubble, o.stubbleCol, o.browCol, o.age, o.nose, o.hook, o.chin, o.gaunt, o.brow
export function faceGeo(o = {}) {
  const det = o.detail ?? 1;
  const cols = Math.round(60 * det), rows = Math.round(54 * det);
  const skin = o.col ?? lin(0xc89880);
  const tone = (c) => {
    const s = mul3(skin, c);
    const l = (s[0] + s[1] + s[2]) / 3;
    return mul(mix(s, [l, l, l], o.desat ?? 0.25), o.shade ?? 1);
  };
  const hoodK = (y, z) => (o.hood ? 0.32 + 0.68 * sstep(0.02, -0.075, y) * (0.7 + 0.3 * sstep(0.07, 0.03, z)) : 1);
  const pos = new Float32Array((cols + 1) * (rows + 1) * 3), col = new Float32Array(pos.length), uv = new Float32Array((cols + 1) * (rows + 1) * 2);
  const P = V();
  let i = 0;
  for (let r = 0; r <= rows; r++) {
    const th = warpV(r / rows);
    for (let c = 0; c <= cols; c++) {
      const ph = warpU((c / cols) * 2 - 1);
      const dx = Math.sin(th) * Math.sin(ph), dy = Math.cos(th), dz = Math.sin(th) * Math.cos(ph);
      skull(dx, dy, dz, P);
      // carve the face, faded out toward the sides and under the chin
      const fm = sstep(0.18, 0.62, dz) * sstep(-0.99, -0.86, dy);
      if (fm > 0) P.z += faceField(P.x, P.y, o) * fm;
      // a faint skin noise so the light breaks up a little
      const n = fbm3(P.x * 160, P.y * 160, P.z * 160, 7, 2) * 0.0006;
      P.x += dx * n; P.y += dy * n; P.z += dz * n;
      pos[i * 3] = P.x; pos[i * 3 + 1] = P.y; pos[i * 3 + 2] = P.z;
      const k = tone(facePaint(P.x, P.y, P.z, o));
      const h = hoodK(P.y, P.z);
      col[i * 3] = k[0] * h; col[i * 3 + 1] = k[1] * h; col[i * 3 + 2] = k[2] * h;
      uv[i * 2] = (c / cols) * 4; uv[i * 2 + 1] = (1 - r / rows) * 4;
      i++;
    }
  }
  const idx = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const a = r * (cols + 1) + c, b = a + cols + 1;
    if (r > 0) idx.push(a, b, a + 1);
    if (r < rows - 1) idx.push(b, b + 1, a + 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  // weld the seam at the back of the head and the poles
  const n = g.getAttribute('normal');
  for (let r = 0; r <= rows; r++) {
    const a = r * (cols + 1), b = a + cols;
    const nx = n.getX(a) + n.getX(b), ny = n.getY(a) + n.getY(b), nz = n.getZ(a) + n.getZ(b), l = Math.hypot(nx, ny, nz) || 1;
    n.setXYZ(a, nx / l, ny / l, nz / l); n.setXYZ(b, nx / l, ny / l, nz / l);
  }
  for (const r of [0, rows]) {
    let sx = 0, sy = 0, sz = 0;
    for (let c = 0; c <= cols; c++) { const k = r * (cols + 1) + c; sx += n.getX(k); sy += n.getY(k); sz += n.getZ(k); }
    const l = Math.hypot(sx, sy, sz) || 1;
    for (let c = 0; c <= cols; c++) n.setXYZ(r * (cols + 1) + c, sx / l, sy / l, sz / l);
  }
  return g;
}

// the skull's outer surface along a direction (for hair roots and caps)
export function scalpPt(dx, dy, dz, lift = 0, out = V()) {
  const l = Math.hypot(dx, dy, dz) || 1;
  skull(dx / l, dy / l, dz / l, out);
  const m = out.length() || 1;
  return out.multiplyScalar((m + lift) / m);
}

// Eyes: eyeballs (sclera, a coloured iris with a darker rim, the pupil) and
// shell lids. Returns { balls, lids, irises } (irises: small discs over the
// pupils for a glow material, to catch the class colour). gaze tilts them.
export function eyeGeo(o = {}) {
  const iris = o.iris ?? lin(0x4a5a3a);
  const lidCol = o.lidCol ?? [1, 1, 1];
  const balls = [], lids = [], irises = [];
  for (const s of [1, -1]) {
    const e = new THREE.SphereGeometry(EYE.r, 16, 12);
    e.rotateX(Math.PI / 2); // pole forward
    const p = e.getAttribute('position');
    const col = [];
    for (let i = 0; i < p.count; i++) {
      const z = p.getZ(i) / EYE.r; // 1 at the front
      const a = Math.acos(Math.min(1, Math.max(-1, z))); // angle from forward
      let c = [0.78, 0.74, 0.7];
      c = mix(c, [0.62, 0.42, 0.4], sstep(0.9, 1.6, a) * 0.5); // veined, darker toward the back
      if (a < 0.5) c = mix(iris, mul(iris, 0.45), sstep(0.3, 0.48, a)); // iris, its rim darker
      if (a < 0.2) c = [0.02, 0.02, 0.02]; // pupil
      col.push(...c);
    }
    e.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    xf(e, { x: s * EYE.x, y: EYE.y, z: EYE.z, ry: -s * 0.08 });
    balls.push(e);
    const d = new THREE.CircleGeometry(EYE.r * 0.2, 10);
    xf(d, { x: s * EYE.x - s * 0.0009, y: EYE.y, z: EYE.z + EYE.r + 0.0003, ry: -s * 0.08 });
    irises.push(d);
    // upper lid: a shell over the top of the ball, its edge rolled; the lower a thinner one
    for (const [up, cover, tilt] of [[1, 1.08, 0.36], [-1, 0.72, 0.3]]) {
      const lid = new THREE.SphereGeometry(EYE.r * 1.12, 16, 6, 0, TAU, 0, cover);
      if (up < 0) lid.rotateX(Math.PI);
      lid.rotateX(up * tilt);
      const lp = lid.getAttribute('position');
      const lc = [];
      for (let i = 0; i < lp.count; i++) {
        // the rim (edge of the shell) darker: lashes on the upper lid
        const yy = lp.getY(i) * up;
        const edge = sstep(EYE.r * 0.55, EYE.r * 0.2, yy);
        lc.push(...mul(lidCol, up > 0 ? 1 - 0.75 * edge : 0.9 - 0.15 * edge));
      }
      lid.setAttribute('color', new THREE.Float32BufferAttribute(lc, 3));
      xf(lid, { x: s * EYE.x, y: EYE.y + up * 0.0004, z: EYE.z, ry: -s * 0.08 });
      lids.push(lid);
    }
  }
  return { balls, lids, irises };
}

// An ear: a curled shell with a rolled rim (helix), a lobe and a dark canal.
export function earGeo(s, o = {}) {
  const col = o.col ?? [1, 1, 1];
  const H = 0.058, W = 0.03;
  const parts = [];
  // the shell: a squashed half-ellipsoid opening outward
  const shell = new THREE.SphereGeometry(1, 14, 10, 0, Math.PI);
  const p = shell.getAttribute('position');
  const sc = [];
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    // narrower at the lobe, bowl-shaped
    const w = W * (0.75 + 0.25 * sstep(-1, 0.3, y));
    p.setXYZ(i, z * 0.006 + 0.002, y * H * 0.5, x * w * 0.5);
    const bowl = 1 - Math.abs(x) * 0.0;
    sc.push(...mul(col, 0.7 + 0.25 * bowl * sstep(-0.8, 0.6, y)));
  }
  shell.setAttribute('color', new THREE.Float32BufferAttribute(sc, 3));
  shell.computeVertexNormals();
  parts.push(shell);
  // helix: a rolled rim around the top and back
  const rim = [];
  for (let i = 0; i <= 10; i++) {
    const a = -0.4 + (i / 10) * 3.4; // from the front top, over, down the back
    rim.push(V(0.006, Math.cos(a) * H * 0.47, -Math.sin(a) * W * 0.47 + W * 0.05));
  }
  const helix = tubeVar(rim, (t) => 0.0034 * (1 - 0.35 * t), 14, 5, true);
  paintAll(helix, col);
  parts.push(helix);
  // antihelix ridge inside the bowl, lobe, canal
  const ah = tubeVar([V(0.004, 0.016, -0.006), V(0.005, 0.004, -0.009), V(0.005, -0.01, -0.005)], 0.002, 6, 4, true);
  paintAll(ah, mul(col, 0.92));
  parts.push(ah);
  const lobe = sphere(0.0075, 8, 6, { x: 0.004, y: -H * 0.43, z: W * 0.06, sx: 0.7, sy: 1.15 });
  paintAll(lobe, mul(col, 1.02));
  parts.push(lobe);
  const canal = sphere(0.0045, 6, 4, { x: 0.0015, y: -0.004, z: 0.004, sx: 0.5 });
  paintAll(canal, mul(col, 0.25));
  parts.push(canal);
  const out = mergeColored(parts);
  // angled back and out from the side of the head
  xf(out, { ry: -0.25, rz: 0.08 });
  if (s < 0) { out.scale(-1, 1, 1); flipWinding(out); }
  xf(out, { x: s * (SK.x - 0.004), y: -0.012, z: -0.006 });
  return out;
}

function paintAll(g, c) {
  const n = g.getAttribute('position').count;
  const a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { a[i * 3] = c[0]; a[i * 3 + 1] = c[1]; a[i * 3 + 2] = c[2]; }
  g.setAttribute('color', new THREE.BufferAttribute(a, 3));
  return g;
}
function flipWinding(g) {
  if (g.index) { const a = g.index.array; for (let i = 0; i < a.length; i += 3) { const t = a[i + 1]; a[i + 1] = a[i + 2]; a[i + 2] = t; } }
  else {
    for (const name of Object.keys(g.attributes)) {
      const at = g.getAttribute(name), s = at.itemSize, arr = at.array;
      for (let i = 0; i < at.count; i += 3) for (let k = 0; k < s; k++) { const t = arr[(i + 1) * s + k]; arr[(i + 1) * s + k] = arr[(i + 2) * s + k]; arr[(i + 2) * s + k] = t; }
    }
  }
  g.computeVertexNormals();
  return g;
}
// merge geometries that all carry colours (indexed or not) into one non-indexed geometry
export function mergeColored(list) {
  const geos = list.filter(Boolean).map((g) => (g.index ? g.toNonIndexed() : g));
  let n = 0;
  for (const g of geos) n += g.getAttribute('position').count;
  const pos = new Float32Array(n * 3), nrm = new Float32Array(n * 3), uv = new Float32Array(n * 2), col = new Float32Array(n * 3).fill(1);
  let o = 0;
  for (const g of geos) {
    if (!g.getAttribute('normal')) g.computeVertexNormals();
    const P = g.getAttribute('position'), N = g.getAttribute('normal'), U = g.getAttribute('uv'), K = g.getAttribute('color');
    pos.set(P.array.subarray(0, P.count * 3), o * 3);
    nrm.set(N.array.subarray(0, N.count * 3), o * 3);
    if (U) uv.set(U.array.subarray(0, U.count * 2), o * 2);
    if (K) col.set(K.array.subarray(0, K.count * 3), o * 3);
    o += P.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  out.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return out;
}

// ---- strands ------------------------------------------------------------------
// One clump of hair: a folded ribbon (three edges across, the middle one raised
// along `out` so it has a ridge to catch the light) along `pts`, `w(t)` wide.
// Colour: darker at the root and along the edges, a sheen down the middle,
// tips paler or darker by `tipK`.
function clump(pts, outs, w, col, o = {}) {
  const n = pts.length;
  const pos = [], cl = [], uv = [], idx = [];
  const T = V(), S = V(), N = V();
  const ridge = o.ridge ?? 0.35;
  const across = o.fine ? [-0.5, -0.17, 0.17, 0.5] : [-0.5, 0, 0.5];
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    T.subVectors(pts[Math.min(n - 1, i + 1)], pts[Math.max(0, i - 1)]).normalize();
    N.copy(outs[i]).normalize();
    S.crossVectors(N, T).normalize();
    const ww = w(t);
    for (let j = 0; j < across.length; j++) {
      const a = across[j];
      const lift = (1 - Math.abs(a) * 2) * ridge * ww;
      const q = pts[i].clone().addScaledVector(S, a * ww).addScaledVector(N, lift);
      pos.push(q.x, q.y, q.z);
      uv.push(j / (across.length - 1), t);
      const sheen = 0.78 + 0.32 * (1 - Math.abs(a) * 2) * (0.6 + 0.4 * Math.sin(t * 9 + (o.phase ?? 0)));
      const root = 0.55 + 0.45 * sstep(0, 0.25, t);
      const tip = 1 + (o.tipK ?? 0) * sstep(0.6, 1, t);
      cl.push(...mul(col, sheen * root * tip));
    }
  }
  const m = across.length;
  for (let i = 0; i < n - 1; i++) for (let j = 0; j < m - 1; j++) {
    const a = i * m + j, b = a + m;
    idx.push(a, b, a + 1, b, b + 1, a + 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(cl, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// Hair: strand clumps from a hairline round the back and sides of the skull,
// lying along it and then falling. o: { col, len, wild, short, part, top (cover
// the crown too), seed, back (only the back and sides: under a hat) }
export function hairGeo(o) {
  const rnd = mulberry(o.seed ?? 9);
  const col = o.col;
  const len = o.len ?? 0.1;
  const out = [];
  const N = o.n ?? 60;
  const P = V(), Q = V(), D = V();
  for (let i = 0; i < N; i++) {
    // root: azimuth round the head (0 = front), height on the skull
    const az = (o.back ? 0.75 + rnd() * 1.5 : rnd() * 2 - 1) * Math.PI * (o.back ? 1 : 1);
    const aBack = Math.abs(((az + Math.PI) % TAU + TAU) % TAU - Math.PI); // 0 front .. PI back
    // hairline: high at the forehead, lower over the ears and at the nape
    const lineY = aBack < 0.9 ? 0.55 - 0.15 * (aBack / 0.9) : 0.4 - 0.55 * sstep(0.9, 2.2, aBack);
    const top = o.top || !o.back ? 0.98 : 0.55;
    const dy = lineY + (top - lineY) * Math.pow(rnd(), 0.8);
    if (aBack < (o.top ? 1.15 : 0.95)) continue; // no fringe: the face stays clear (the cap draws the hairline)
    const ct = Math.sqrt(Math.max(0, 1 - dy * dy));
    scalpPt(Math.sin(az) * ct, dy, Math.cos(az) * ct, 0.002, P);
    // grow: along the skull downward (combed back from the front), then fall
    const pts = [P.clone()], outs = [];
    const L = len * (0.7 + 0.5 * rnd()) * (aBack > 2.2 ? 1 : 0.75 + 0.25 * aBack / 2.2);
    const steps = o.short ? 4 : 7;
    const lift = 0.004 + (o.wild ?? 0) * 0.01 * rnd();
    let cur = P.clone();
    // direction on the surface: away from the crown toward the nape/ears
    // (combed back: strands from the temples sweep behind the ears)
    let ang = az + Math.sign(az || 1) * 0.5 * sstep(1.9, 1.15, aBack) + (rnd() - 0.5) * 0.4;
    let ry = dy;
    const total = (o.short ? Math.min(L, 0.05) : L + 0.02);
    for (let k = 1; k <= steps; k++) {
      const f = k / steps;
      // follow the skull while above its widest band, then hang
      ry -= (total / steps) / 0.09;
      if (ry > -0.35) {
        const c2 = Math.sqrt(Math.max(0, 1 - Math.min(0.999, ry * ry)));
        scalpPt(Math.sin(ang) * c2, ry, Math.cos(ang) * c2, 0.003 + lift * f, Q);
        cur = Q.clone();
      } else {
        D.set(Math.sin(ang) * 0.15, -1, Math.cos(ang) * 0.25 - 0.15).normalize();
        cur = cur.clone().addScaledVector(D, total / steps);
        // hang clear of the neck and shoulders' line
        const r = Math.hypot(cur.x, cur.z);
        if (r < 0.07) { cur.x *= 0.07 / Math.max(r, 1e-4); cur.z *= 0.07 / Math.max(r, 1e-4); }
      }
      if (o.wild) cur.add(V((rnd() - 0.5) * 0.006 * o.wild, 0, (rnd() - 0.5) * 0.006 * o.wild));
      pts.push(cur);
      ang += (rnd() - 0.5) * 0.08 + Math.sign(ang || 1) * 0.06 * sstep(2.0, 1.2, aBack);
    }
    for (let k = 0; k < pts.length; k++) {
      const p = pts[k];
      outs.push(V(p.x, p.y * 0.3 + 0.02, p.z).normalize());
    }
    const w0 = (o.short ? 0.014 : 0.019) * (0.75 + 0.5 * rnd());
    const tone = mul(col, 0.8 + 0.4 * rnd());
    out.push(clump(pts, outs, (t) => w0 * (1 - 0.75 * Math.pow(t, 1.4)) + 0.0015, tone, { phase: rnd() * 6, tipK: o.tipK ?? 0.15, ridge: 0.3 }));
  }
  return mergeColored(out);
}

// A cap of hair under the strands, so no scalp shows between them.
export function hairCapGeo(o) {
  const g = new THREE.SphereGeometry(1, 20, 12, 0, TAU, 0, o.theta ?? 2.0);
  const p = g.getAttribute('position');
  const c = [];
  for (let i = 0; i < p.count; i++) {
    const dx = p.getX(i), dy = p.getY(i), dz = p.getZ(i);
    // pulled up off the forehead (a hairline) unless it has a fringe
    const front = Math.max(0, dz - 0.2) / 0.8;
    let yy = dy;
    if (!o.fringe && front > 0 && dy < 0.6) yy = 0.6 - (0.6 - dy) * (1 - front) * 0.35;
    const q = scalpPt(dx, yy, dz, 0.0025);
    p.setXYZ(i, q.x, q.y, q.z);
    c.push(...mul(o.col, (0.5 + 0.2 * sstep(-0.5, 0.8, dy)) * (0.85 + 0.15 * Math.sin(Math.atan2(dx, dz) * 37 + dy * 6))));
  }
  g.setAttribute('color', new THREE.Float32BufferAttribute(c, 3));
  g.computeVertexNormals();
  return g;
}

// where a beard grows: below a line from the sideburns down to the mouth's corners and
// under the lower lip (1 inside, fading over half a centimetre)
function beardZone(x, y, z) {
  const ax = Math.abs(x);
  const line = z < 0 ? -0.06 : ax < 0.026 ? -0.072 : -0.072 + Math.min(1, (ax - 0.026) / 0.045) * 0.068;
  return sstep(line + 0.004, line - 0.004, y);
}

// Beard and moustache: clumps from the jaw, chin, cheeks and upper lip, lying
// along the face and falling over the chest. o: { col, len, fork, seed, full }
export function beardGeo(o) {
  const rnd = mulberry(o.seed ?? 4);
  // the chest's front (head space: z of the clothing at height y), which the hanging part lies over
  const front = o.front ?? ((y) => 0.09 + Math.max(0, -0.1 - y) * 0.85);
  const col = o.col, len = o.len ?? 0.12;
  const out = [];
  const P = V();
  // under-layer: a shell over the jaw so the strands never show skin between them
  const under = new THREE.SphereGeometry(1, 30, 14, Math.PI * 0.5 - Math.PI * 0.62, Math.PI * 1.24, Math.PI * 0.5, Math.PI * 0.5);
  const up = under.getAttribute('position');
  const uc = [];
  for (let i = 0; i < up.count; i++) {
    const dx = up.getX(i), dy = up.getY(i), dz = up.getZ(i);
    const q = scalpPt(dx, dy, dz, 0);
    if (q.z > 0.03) q.z += faceField(q.x, q.y, {}) * sstep(0.18, 0.62, dz) * sstep(-0.99, -0.86, dy);
    // only where a beard grows: below a line from the sideburns to under the lower lip
    const m = beardZone(q.x, q.y, q.z);
    const lift = 0.004 * m - 0.008 * (1 - m);
    const l = Math.hypot(q.x, q.y, q.z) || 1;
    q.multiplyScalar((l + lift) / l);
    // the long part drapes down over the chest
    if (q.y < -0.09 && q.z > -0.03) {
      const k = Math.min(1, (-0.09 - q.y) / 0.025);
      q.y -= k * len * 0.45;
      q.z = Math.max(q.z + k * 0.01, (front(q.y) + 0.004) * sstep(0.075, 0.03, Math.abs(q.x)) + q.z * (1 - sstep(0.075, 0.03, Math.abs(q.x))));
    }
    up.setXYZ(i, q.x, q.y, q.z);
    uc.push(...mul(col, 0.42));
  }
  under.setAttribute('color', new THREE.Float32BufferAttribute(uc, 3));
  under.computeVertexNormals();
  out.push(under);
  // clumps from a band over the jaw (cheeks, chin, under the jaw): each lies along the face
  // down to the jawline, narrowing toward the chin, then falls over the chest
  const N = Math.round((o.n ?? 110) * (0.75 + len * 1.4));
  const Q = V();
  const onFace = (az, dy, lift, out) => {
    const ct = Math.sqrt(Math.max(0, 1 - dy * dy));
    scalpPt(Math.sin(az) * ct, dy, Math.cos(az) * ct, lift, out);
    if (out.z > 0.03) out.z += faceField(out.x, out.y, {}) * sstep(0.18, 0.62, Math.cos(az) * ct) * sstep(-0.99, -0.86, dy);
    return out;
  };
  for (let i = 0; i < N; i++) {
    const layer = i / N; // early clumps underneath, later ones on top and shorter
    let az = (rnd() * 2 - 1) * Math.PI * (0.5 - 0.1 * layer);
    let ay = -0.1 - rnd() * 0.8;
    onFace(az, ay, 0.004, P);
    if (beardZone(P.x, P.y, P.z) < 0.5) continue;
    const pts = [P.clone()], outs = [];
    const L = (0.04 + len * (Math.abs(az) < 1.0 ? 1 : 0.6)) * (0.75 + 0.4 * rnd()) * (1 - 0.25 * layer);
    const steps = 6;
    let cur = P.clone(), hanging = false;
    for (let k = 1; k <= steps; k++) {
      const step = L / steps;
      if (!hanging) {
        // down the face: toward the chin's middle
        ay -= step / 0.1;
        az *= 0.9;
        onFace(az, Math.max(-0.995, ay), 0.004 + 0.005 * (k / steps), Q);
        if (ay < -0.93 || Q.y < -0.105) hanging = true;
        cur = Q.clone();
      }
      if (hanging) {
        const fork = o.fork ? Math.sign(cur.x || az || 1) * 0.0035 : 0;
        cur = cur.clone().add(V(-cur.x * 0.05 + fork + (rnd() - 0.5) * 0.003, -step, (rnd() - 0.5) * 0.002));
        // over the collar and down the chest, never into it
        const fz = front(cur.y) + 0.006 + 0.004 * (1 - layer);
        if (Math.abs(cur.x) < 0.08) cur.z = Math.max(cur.z, fz);
      }
      pts.push(cur);
    }
    for (const p of pts) outs.push(V(p.x * 1.2, -0.1, Math.max(0.25, p.z + 0.06)).normalize());
    const w0 = (0.013 + 0.008 * rnd()) * (1 - 0.3 * layer);
    out.push(clump(pts, outs, (t) => w0 * (1 - 0.8 * Math.pow(t, 1.3)) + 0.0012, mul(col, 0.78 + 0.4 * rnd()), { phase: rnd() * 6, tipK: 0.12, ridge: 0.15 }));
  }
  // moustache: two sweeps from under the nose out over the lip corners
  for (const s of [1, -1]) for (let k = 0; k < 6; k++) {
    const y0 = -0.043 - k * 0.0014, z0 = 0.095 - k * 0.0016;
    const pts = [V(s * (0.003 + k * 0.002), y0, z0), V(s * 0.016, y0 - 0.006, z0 - 0.003), V(s * 0.027, y0 - 0.016, z0 - 0.011), V(s * (0.031 + k * 0.002), y0 - 0.03 - len * 0.12, z0 - 0.017)];
    const outs = pts.map((p) => V(p.x * 2, 0.3, 1).normalize());
    out.push(clump(pts, outs, (t) => 0.011 * (1 - 0.7 * t) + 0.0015, mul(col, 0.8 + 0.06 * k), { phase: k, tipK: 0.1, ridge: 0.4 }));
  }
  return mergeColored(out);
}

// Brows as short strands lying along the brow ridge (on top of the painted ones).
export function browGeo(o) {
  const rnd = mulberry(o.seed ?? 21);
  const out = [];
  for (const s of [1, -1]) for (let i = 0; i < 11; i++) {
    const t = i / 10;
    const x = s * (0.011 + t * 0.038);
    const y = 0.0255 + 0.006 * Math.sin(t * Math.PI * 0.8) - (o.stern ?? 0) * 0.004 * (1 - t) + (rnd() - 0.5) * 0.002;
    // on the skin: the skull's front plus the carved brow
    const P = scalpPt(x / SK.x, y / SK.top, 0.92, 0.0004);
    P.z += faceField(P.x, P.y, o);
    const L = 0.011 - 0.003 * t;
    const p1 = V(P.x + s * L * 0.55, P.y + 0.0016 - t * 0.0015, P.z - 0.0006 - 0.0025 * t);
    const p2 = V(P.x + s * L, P.y + 0.0004 - t * 0.003, P.z - 0.0022 - 0.004 * t);
    const pts = [P, p1, p2];
    const outs = pts.map(() => V(s * 0.25, 0.35, 1).normalize());
    out.push(clump(pts, outs, (u) => (0.0042 - 0.002 * t) * (1 - 0.7 * u) + 0.0006, mul(o.col, 0.75 + 0.35 * rnd()), { ridge: 0.2 }));
  }
  return mergeColored(out);
}

// A neck that meets the skull under the jaw, with the cords down to the collarbones.
export function neckGeo(o = {}) {
  const pts = [];
  // (it ends inside the skull, tucked up behind the jaw: the jaw is narrower than the neck)
  const prof = [[0.036, 0.135], [0.043, 0.11], [0.046, 0.07], [0.05, 0.025], [0.062, 0.0]];
  const g = new THREE.LatheGeometry(prof.map(([r, y]) => new THREE.Vector2(r, y)).reverse(), 18);
  void pts;
  const p = g.getAttribute('position');
  const c = [];
  for (let i = 0; i < p.count; i++) {
    let x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const a = Math.atan2(x, z);
    // a little deeper than wide; the cords either side at the front, the throat between
    z *= 1.06;
    const cord = Math.exp(-Math.pow((Math.abs(a) - 0.75) / 0.25, 2)) * sstep(0.0, 0.05, y) * sstep(0.16, 0.08, y);
    const k = 1 + cord * 0.08 + (o.adam ? 0.06 * Math.exp(-Math.pow(a / 0.25, 2)) * Math.exp(-Math.pow((y - 0.07) / 0.015, 2)) : 0);
    x *= k; z *= k;
    z -= 0.016 * sstep(0.03, 0.13, y);
    p.setXYZ(i, x, y, z);
    c.push(...(o.paint ? o.paint(y, a) : [1, 1, 1]));
  }
  g.setAttribute('color', new THREE.Float32BufferAttribute(c, 3));
  g.computeVertexNormals();
  return g;
}

