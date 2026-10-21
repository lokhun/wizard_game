import * as THREE from 'three';
import { G, xf, taper, lathe, shell, tube, extrude, deform, bumpy, robe, panel, mergeRaw, spikeRing, chainSkin, rng, vnoise, lerp, clamp, smooth, TAU } from './core.js';

// ---------------------------------------------------------------------------
// Reusable model parts. Functions named add* attach parts to rig bones.
// Weapons are built in "grip space": grip at origin, business end along +Z,
// and attached to a hand bone at the palm (y = -0.07 * scale).
// ---------------------------------------------------------------------------

export const HDR = (hex, k) => { const c = new THREE.Color(hex); return [c.r * k, c.g * k, c.b * k]; };
// metal tints (iron texture albedo is dark, so tints go above 1)
export const STEEL = [2.6, 2.6, 2.5];
export const RUSTY = [1.9, 1.45, 1.15];
export const DARKSTEEL = [1.25, 1.25, 1.35];
export const BRASS = [1.5, 1.2, 0.8];

// ------------------------------------------------------------- skulls ----
function craniumGeo() {
  const g = G.sph(0.1, 18, 14);
  return deform(g, (v) => {
    // longer back, flatter sides, narrower lower face
    if (v.z < 0) v.z *= 1.12;
    v.x *= 0.86;
    if (v.y < -0.02) { const k = clamp((-v.y - 0.02) / 0.08); v.x *= 1 - k * 0.35; v.z *= 1 - k * 0.15; if (v.z > 0) v.z += k * 0.01; }
    // brow ridge
    if (v.z > 0.05 && v.y > 0.0 && v.y < 0.04) v.z += 0.008;
    // temple dents
    v.x *= 1 - Math.exp(-((v.y - 0.01) ** 2) / 0.001) * Math.exp(-((v.z - 0.03) ** 2) / 0.002) * 0.12;
    // carve eye sockets
    if (v.z > 0.03) {
      const d2 = (Math.abs(v.x) - 0.036) ** 2 + (v.y - 0.0) ** 2;
      v.z -= Math.exp(-d2 / 0.0005) * 0.026;
    }
  });
}
let _cran;
export function addSkull(rig, head, jaw, o = {}) {
  const s = o.s ?? 1, y = o.y ?? 0.1, z = o.z ?? 0.01;
  const mat = o.mat ?? 'bone';
  const c = o.c ?? 0xd8ccb0, cfn = o.cfn;
  const tc = o.toothC ?? (Array.isArray(c) ? [c[0] * 1.02, c[1] * 0.97, c[2] * 0.82] : 0xe8dcc0);
  _cran = _cran ?? craniumGeo();
  rig.add(head, mat, _cran, { x: 0, y, z, s }, { c, cfn });
  // cheekbones with their arches running back toward the ears, maxilla
  rig.pair(head, head, mat, mergeRaw([xf(G.sph(0.022, 6, 5), { sx: 1.4, sy: 0.8 }), tube([[0.004, -0.002, -0.004], [0.017, 0.0, -0.035], [0.022, 0.004, -0.062]], 0.0065, 4, 4)]), { x: 0.05 * s, y: y - 0.025 * s, z: z + 0.065 * s, s }, { c, cfn });
  rig.add(head, mat, G.box(0.07, 0.035, 0.05), { y: y - 0.06 * s, z: z + 0.065 * s, s }, { c, cfn });
  // sockets, nose hole
  rig.pair(head, head, 'dark', G.sph(0.024, 8, 6), { x: 0.036 * s, y: y + 0.0 * s, z: z + 0.062 * s, sz: 0.7, s });
  rig.add(head, 'dark', G.cone(0.014, 0.03, 3), { y: y - 0.03 * s, z: z + 0.098 * s, rx: Math.PI, s });
  // teeth (upper)
  const tu = [];
  for (let i = 0; i < 8; i++) {
    const a = (i / 7 - 0.5) * 1.6;
    tu.push(xf(G.box(0.011, 0.018, 0.008), { x: Math.sin(a) * 0.032, y: -0.083, z: 0.068 + Math.cos(a) * 0.022, ry: a }));
  }
  rig.add(head, mat, mergeRaw(tu), { y, z, s }, { c: tc });
  // glowing eyes
  if (o.eye) {
    const e = HDR(o.eye, o.eyeK ?? 6);
    rig.pair(head, head, 'glow', G.sph(0.013 * (o.eyeR ?? 1), 6, 5), { x: 0.036 * s, y: y + 0.002 * s, z: z + 0.074 * s, s }, { c: e });
  }
  if (jaw) {
    const jg = mergeRaw([
      xf(G.tor(0.04, 0.009, 4, 10, Math.PI), { rx: -Math.PI / 2, ry: 0, sx: 1.05, sy: 1.3 }),
      xf(G.box(0.05, 0.02, 0.02), { z: 0.05, y: -0.012 }),
      xf(G.box(0.012, 0.05, 0.02), { x: 0.045, y: 0.02, z: 0.0 }),
      xf(G.box(0.012, 0.05, 0.02), { x: -0.045, y: 0.02, z: 0.0 }),
    ]);
    rig.add(jaw, mat, jg, { y: -0.005, z: 0.02, s, ry: Math.PI }, { c, cfn });
    const tl = [];
    for (let i = 0; i < 7; i++) {
      const a = (i / 6 - 0.5) * 1.5;
      tl.push(xf(G.box(0.01, 0.016, 0.008), { x: Math.sin(a) * 0.033, y: 0.008, z: 0.035 + Math.cos(a) * 0.026, ry: a }));
    }
    rig.add(jaw, mat, mergeRaw(tl), { s }, { c: tc });
  }
}

// ----------------------------------------------------- skeleton bodies ----
// Pale, slightly cool bone that stays ivory under warm torchlight (the bone texture is yellow; a
// blue-leaning tint above 1 neutralises it), with grimy patches and a little per-vertex mottling.
export const BONE_PALE = [1.2, 1.17, 1.3];
export function boneShade(c = BONE_PALE, seed = 3, grime = 1) {
  return (v) => {
    const n = vnoise(v.x * 21 + seed, v.y * 21, v.z * 21, seed), d = vnoise(v.x * 63, v.y * 63, v.z * 63, seed + 5);
    const g = smooth(0.5, 0.8, n) * 0.42 * grime, k = 0.84 + d * 0.24;
    return [c[0] * k * (1 - g * 0.85), c[1] * k * (1 - g), c[2] * k * (1 - g * 1.3)];
  };
}
const linC = (c) => { if (Array.isArray(c)) return c; const k = new THREE.Color(c); return [k.r, k.g, k.b]; };
// Long bone hanging from y=0 to -len: rounded head, waisted shaft, flared (optionally flattened) condyles.
export function longBone(len, r, r0 = r * 1.7, r1 = r * 1.6, seg = 6, flat0 = 1, flat1 = 1.3) {
  const g = lathe([
    [0.001, -len - r1 * 0.5], [r1 * 0.8, -len - r1 * 0.3], [r1, -len + r1 * 0.25], [r1 * 0.68, -len + r1 * 1.1],
    [r * 1.06, -len * 0.75], [r, -len * 0.5], [r * 1.08, -len * 0.22], [r0 * 0.7, -r0 * 1.05], [r0, -r0 * 0.2], [r0 * 0.75, r0 * 0.45], [0.001, r0 * 0.62],
  ], seg);
  if (flat0 !== 1 || flat1 !== 1) deform(g, (v) => {
    const t1 = clamp((-v.y - len * 0.72) / (len * 0.28)), t0 = clamp((v.y + len * 0.28) / (len * 0.28));
    const f = 1 + t1 * (flat1 - 1) + t0 * (flat0 - 1);
    v.x *= f; v.z /= Math.sqrt(f);
  });
  return g;
}
// thin bone (radius, ulna, fibula): fewer rings
export function thinBone(len, r, r0 = r * 1.6, r1 = r * 1.5, seg = 5) {
  return lathe([[0.001, -len - r1 * 0.4], [r1, -len + r1 * 0.2], [r * 1.05, -len * 0.7], [r, -len * 0.4], [r0 * 0.8, -r0 * 1.1], [r0, -r0 * 0.1], [0.001, r0 * 0.5]], seg);
}
// Full skeleton on a humanSkeleton rig. Bones are drawn heavier than life (~1.4x) so the figure
// reads at fight distance: barrel ribcage, flared pelvis, knobbed joints, a vertebral column with
// processes. o: c (tint), cfn, th (thickness), grip {L,R}, armored (neck + hands only).
export function addSkeletonBody(rig, D, o = {}) {
  const mat = o.mat ?? 'bone';
  const s = o.s ?? 1, th = o.th ?? 1;
  const c = o.c ?? 0xd8ccb0;
  const cfn = o.cfn ?? (o.shade === false ? undefined : boneShade(linC(c), o.seed ?? 3, o.grime ?? 1));
  const B = { c: linC(c), cfn };
  if (o.armored) {
    // only what shows between plates: neck, hands
    rig.add('neck', mat, G.cyl(0.018, 0.022, D.neck + 0.02, 6), { y: D.neck / 2 }, B);
    for (const S of ['L', 'R']) addBoneHand(rig, 'hand' + S, S === 'L' ? 1 : -1, { mat, c, cfn, s, grip: o.grip?.[S] });
    return;
  }
  // pelvis: flared iliac wings, sacrum, hip sockets, ischia, pubic arch
  const pel = [];
  for (const sx of [-1, 1]) {
    pel.push(xf(G.sph(0.08, 9, 6), { x: sx * 0.08, y: 0.035, z: -0.005, sx: 0.4, sy: 1.0, sz: 1.1, ry: sx * 0.8, rz: -sx * 0.35 }));
    pel.push(xf(G.sph(0.032, 6, 4), { x: sx * 0.088, y: -0.035, z: 0.004 }));
    pel.push(xf(G.sph(0.025, 5, 4), { x: sx * 0.058, y: -0.075, z: -0.018, sy: 1.35 }));
  }
  pel.push(deform(xf(G.box(0.075, 0.11, 0.034, 1, 2, 1), { y: 0.008, z: -0.058, rx: 0.35 }), (v) => { v.x *= 1 - clamp((0.06 - v.y) / 0.12) * 0.55; }));
  pel.push(xf(G.tor(0.05, 0.014, 4, 9, Math.PI), { y: -0.045, z: 0.03, rx: -0.4, rz: Math.PI }));
  rig.add('hips', mat, mergeRaw(pel), { y: -0.01, s: s * th }, B);
  // lumbar vertebrae: bodies, spinous and transverse processes
  const lum = [];
  for (let i = 0; i < 4; i++) {
    const y = -0.03 + i * (D.spine + 0.02) / 4;
    lum.push(xf(G.cyl(0.025 * th, 0.027 * th, 0.026, 7), { y, z: -0.035 }), xf(G.box(0.014, 0.03, 0.044), { y: y - 0.004, z: -0.074, rx: 0.35 }), xf(G.box(0.085, 0.012, 0.016), { y, z: -0.045 }));
  }
  rig.add('spine', mat, mergeRaw(lum), { s }, B);
  // thoracic column
  const tho = [];
  for (let i = 0; i < 7; i++) { const y = 0.012 + i * D.chest * 0.132; tho.push(xf(G.cyl(0.021 * th, 0.023 * th, 0.026, 6), { y, z: -0.076 }), xf(G.box(0.012, 0.028, 0.048), { y: y - 0.012, z: -0.112, rx: 0.65 })); }
  rig.add('chest', mat, mergeRaw(tho), { s }, B);
  // barrel ribcage: seven ribs a side sweeping down from the spine to the sternum (the last two float)
  const RW = [0.09, 0.12, 0.143, 0.156, 0.158, 0.152, 0.138], ribs = [];
  for (let i = 0; i < RW.length; i++) {
    const t = i / (RW.length - 1), w = RW[i] * (o.ribW ?? 1);
    const yb = D.chest * (0.85 - t * 0.7), drop = 0.05 + t * 0.05, zf = 0.1 - t * 0.012, zb = -0.074;
    const pts = [[0.022, yb, zb + 0.004], [w * 0.62, yb + 0.004, zb - 0.012], [w, yb - drop * 0.25, -0.02], [w * 0.93, yb - drop * 0.6, 0.045]];
    if (i < 5) pts.push([w * 0.55, yb - drop * 0.95, zf - 0.006], [0.024, yb - drop * 0.8, zf + 0.008]);
    else pts.push([w * 0.68, yb - drop * 0.95, zf - 0.03]);
    ribs.push(tube(pts, (u) => 0.012 * th * (1 - u * 0.3), 7, 4));
  }
  const ribG = mergeRaw(ribs);
  rig.pair('chest', 'chest', mat, ribG, { s }, B);
  // sternum + manubrium, clavicles, shoulder blades
  rig.add('chest', mat, mergeRaw([xf(G.box(0.032, D.chest * 0.5, 0.017), { y: D.chest * 0.45, z: 0.104, rx: 0.12 }), xf(G.box(0.052, 0.045, 0.019), { y: D.chest * 0.73, z: 0.099, rx: 0.12 }), xf(G.cone(0.012, 0.03, 4), { y: D.chest * 0.17, z: 0.108, rx: Math.PI })]), { s }, B);
  const W = D.shoulderW;
  const clav = tube([[0.022, D.chest * 0.78, 0.098], [W * 0.5, D.chest - 0.015, 0.078], [W * 0.95, D.chest - D.shoulderDrop + 0.03, 0.012]], 0.011 * th, 6, 4);
  const scap = mergeRaw([xf(extrude([[0, 0], [0.09, 0.012], [0.028, -0.135]], 0.012), {}), xf(G.box(0.085, 0.014, 0.022), { x: 0.045, y: -0.025, z: -0.01, rz: 0.1 })]);
  rig.pair('chest', 'chest', mat, clav, {}, B);
  rig.pair('chest', 'chest', mat, scap, { x: 0.05, y: D.chest - 0.035, z: -0.1, ry: -0.4 }, B);
  // cervical vertebrae
  const nk = [];
  for (let i = 0; i < 3; i++) { const y = -0.004 + i * (D.neck + 0.03) / 3; nk.push(xf(G.cyl(0.019 * th, 0.021 * th, 0.022, 6), { y, z: -0.008 }), xf(G.box(0.01, 0.018, 0.032), { y: y - 0.004, z: -0.035, rx: 0.4 })); }
  rig.add('neck', mat, mergeRaw(nk), { s }, B);
  // limbs
  for (const S of ['L', 'R']) {
    const sd = S === 'L' ? 1 : -1;
    rig.add('arm' + S, mat, longBone(D.upper, 0.019 * th, 0.034 * th, 0.028 * th, 6, 1, 1.35), {}, B);
    rig.add('fore' + S, mat, mergeRaw([
      xf(thinBone(D.fore, 0.012 * th, 0.022 * th, 0.014 * th), { z: -0.012 }),
      xf(thinBone(D.fore * 0.97, 0.0115 * th, 0.016 * th, 0.021 * th), { x: sd * 0.017, z: 0.008, y: -D.fore * 0.03 }),
    ]), {}, B);
    rig.add('thigh' + S, mat, mergeRaw([longBone(D.thigh, 0.024 * th, 0.038 * th, 0.04 * th, 7, 1, 1.3), xf(G.sph(0.024 * th, 5, 4), { x: sd * 0.034, y: -0.03 })]), {}, B);
    rig.add('shin' + S, mat, mergeRaw([
      xf(longBone(D.shin, 0.021 * th, 0.038 * th, 0.027 * th, 7, 1.3, 1), { z: 0.004 }),
      xf(thinBone(D.shin * 0.92, 0.009 * th, 0.014 * th, 0.015 * th), { x: sd * 0.036, z: -0.012, y: -0.02 }),
      xf(G.sph(0.026 * th, 6, 5), { y: 0.008, z: 0.04, sz: 0.6, sy: 1.15 }), // kneecap
    ]), {}, B);
    // foot: talus, heel, metatarsals fanning into toes (sole at the floor, y = -ankle)
    const fy = -(D.ankle ?? 0.07);
    const ft = [xf(G.sph(0.03, 6, 5), { y: fy + 0.04, z: -0.008, sx: 0.85, sz: 1.3 }), xf(G.sph(0.028, 6, 4), { y: fy + 0.026, z: -0.045, sx: 0.8, sz: 1.15 })];
    for (let k = 0; k < 4; k++) { const x = (k - 1.5) * 0.018; ft.push(tube([[x * 0.5, fy + 0.03, 0.0], [x, fy + 0.016, 0.07], [x * 1.15, fy + 0.008, 0.12]], (u) => 0.0085 * th * (1 - u * 0.35), 4, 4)); }
    rig.add('foot' + S, mat, mergeRaw(ft), { s }, B);
    addBoneHand(rig, 'hand' + S, sd, { mat, c, cfn, s, th, grip: o.grip?.[S] });
  }
}

// Finger chain in hand space. Palms face the body (-side * X); fingers hang along -Y in a
// row along Z (index at +Z) and curl toward the palm, wrapping a Z-axis handle at y≈-0.07.
function fingerPts(side, z, L, curl, y0, spread = 0) {
  const segs = [0.45, 0.32, 0.23];
  const bend = [0.12 + curl * 0.35, 0.25 + curl * 1.05, 0.2 + curl * 1.0];
  const pts = [new THREE.Vector3(side * 0.004, y0, z)];
  let phi = 0;
  for (let k = 0; k < 3; k++) {
    phi += bend[k];
    const p = pts[k].clone().add(new THREE.Vector3(-side * Math.sin(phi) * segs[k] * L, -Math.cos(phi) * segs[k] * L, spread * segs[k] * L));
    pts.push(p);
  }
  return { pts, phi };
}
// Bony hand: knobbed wrist, one smooth tube per digit (metacarpal through the phalanges) with a
// knuckle knob, so it stays chunky at a distance and cheap (~400 tris).
export function addBoneHand(rig, bone, side, o = {}) {
  const mat = o.mat ?? 'bone', s = o.s ?? 1, th = o.th ?? 1;
  const c = o.c != null ? linC(o.c) : undefined, cfn = o.cfn;
  const curl = o.grip ? 1 : (o.curl ?? 0.3);
  const parts = [xf(G.sph(0.02 * th, 6, 4), { y: -0.014, sx: 0.8, sz: 1.35 })];
  for (let i = 0; i < 4; i++) {
    const z = (1.5 - i) * 0.0135;
    const L = 0.062 * [0.9, 1, 0.95, 0.78][i] * (o.fingerLen ?? 1);
    const { pts } = fingerPts(side, z, L, curl, -0.05, (1.5 - i) * 0.08);
    parts.push(tube([new THREE.Vector3(0, -0.016, z * 0.5), new THREE.Vector3(side * 0.003, -0.034, z * 0.85), ...pts], (u) => (0.0062 - u * 0.0024) * th, 8, 4));
    parts.push(xf(G.oct(0.0072 * th), { x: pts[0].x, y: pts[0].y, z: pts[0].z }));
    if (o.claws) { const a = pts[3], b = pts[3].clone().sub(pts[2]).normalize(); parts.push(tube([a, a.clone().addScaledVector(b, o.claws * 0.6), a.clone().addScaledVector(b, o.claws).add(new THREE.Vector3(-side * 0.01 * curl, 0, 0))], (u) => 0.004 * (1 - u), 4, 3)); }
  }
  // thumb
  const tp = [[0, -0.015, 0.012], [-side * 0.004, -0.03, 0.03], [-side * (0.01 + curl * 0.014), -0.045 - curl * 0.01, 0.042 - curl * 0.012], [-side * (0.016 + curl * 0.02), -0.058, 0.046 - curl * 0.02]];
  parts.push(tube(tp, (u) => (0.0062 - u * 0.0018) * th, 6, 4));
  rig.add(bone, mat, mergeRaw(parts), { s }, { c, cfn });
}

// -------------------------------------------------------- flesh bodies ----
// Gaunt/muscular humanoid body built from organic tapered pieces. The torso is
// one mesh skinned smoothly across hips > spine > chest so bending stays seamless.
export function addFleshBody(rig, D, o = {}) {
  const mat = o.mat ?? 'skin';
  const c = o.c ?? 0x9aa58f;
  const m = o.muscle ?? 1; // limb thickness multiplier
  const g = o.gaunt ?? 0; // ribs showing
  const sd = o.seed ?? 3;
  const bump = (geo, a = 0.006) => bumpy(geo, a * (o.rough ?? 1), 18, sd);
  const W = D.shoulderW * (o.torsoW ?? 1);
  const top = 0.05 + D.spine + D.chest;
  const waist = 1 - g * 0.22;
  const tors = lathe([
    [0.001, -0.1], [W * 0.55, -0.085], [W * 0.66, -0.02], [W * 0.64 * waist, 0.05 + D.spine * 0.7], [W * 0.68 * (1 - g * 0.08), 0.05 + D.spine + D.chest * 0.3],
    [W * 0.8, 0.05 + D.spine + D.chest * 0.66], [W * 0.78, 0.05 + D.spine + D.chest * 0.88], [W * 0.42, top + 0.03], [0.001, top + 0.045],
  ], o.seg ?? 18, 0, TAU);
  deform(tors, (v) => {
    v.z *= 0.66 * (o.depth ?? 1);
    if (o.belly) { const k = Math.exp(-((v.y - (o.bellyY ?? 0.12)) ** 2) / 0.012); if (v.z > 0) v.z += k * o.belly; v.x *= 1 + k * o.belly * 0.6; }
    if (g > 0 && v.z > 0) { const k = Math.exp(-((v.y - (0.05 + D.spine * 0.6)) ** 2) / 0.006); v.z -= k * g * 0.03; }
    if (o.hunch) { const k = clamp((v.y - D.spine) / D.chest); if (v.z < 0) v.z -= k * k * o.hunch; }
    // spine furrow and chest plane
    if (v.z < 0) v.z += Math.exp(-(v.x * v.x) / 0.0012) * 0.015;
  });
  const torsoSkin = chainSkin([['hips', 0.0], ['spine', 0.05 + D.spine * 0.45], ['chest', 0.05 + D.spine + D.chest * 0.25]], (v) => v.y);
  const cfn = o.cfn;
  rig.add('hips', mat, bump(tors, 0.006), {}, { c, cfn, skin: torsoSkin });
  // pecs, traps, shoulder blades
  const pec = xf(G.sph(W * 0.42, 10, 8), { sx: 1.1, sy: 0.75, sz: 0.5 });
  rig.pair('chest', 'chest', mat, bump(pec, 0.004), { x: W * 0.36, y: D.chest * 0.66, z: W * 0.3 * (o.depth ?? 1), rz: 0.15 }, { c });
  rig.pair('chest', 'chest', mat, bump(xf(G.sph(W * 0.35, 10, 8), { sx: 1.3, sy: 0.7, sz: 0.8 }), 0.004), { x: W * 0.38, y: D.chest * 0.98, z: -0.02, rz: -0.45 }, { c });
  if (g > 0) {
    // ribs and collarbones showing through
    const ribs = [];
    for (let i = 0; i < 5; i++) {
      const y = D.chest * (0.18 + i * 0.12);
      ribs.push(xf(G.tor(W * 0.68 - Math.abs(i - 2) * 0.008, 0.008, 4, 14, Math.PI * 0.75), { y, z: 0.0, rx: -Math.PI / 2 + 0.25, rz: Math.PI * 0.125, sz: 0.66 * (o.depth ?? 1) }));
    }
    rig.add('chest', mat, mergeRaw(ribs), {}, { c: o.ribC ?? c });
  }
  const front = (y) => W * 0.42 * (o.depth ?? 1) * (y < 0.05 + D.spine ? (1 - g * 0.15) : 1);
  if (o.abs) {
    const ab = [];
    for (let r = 0; r < 3; r++) for (const sx of [-1, 1]) {
      const y = 0.05 + D.spine * (0.12 + r * 0.38);
      ab.push(xf(G.sph(W * 0.14, 8, 6), { x: sx * W * 0.15, y, z: front(y) - 0.012, sx: 1.05, sy: 0.75, sz: 0.38 }));
    }
    rig.add('hips', mat, mergeRaw(ab), {}, { c, skin: torsoSkin });
    // obliques + serratus fingers under the pecs
    rig.pair('hips', 'hips', mat, bump(G.sph(W * 0.2, 8, 6)), { x: W * 0.48, y: 0.06 + D.spine * 0.4, z: W * 0.18, sx: 0.55, sy: 1.3, sz: 0.9, rz: 0.15 }, { c, skin: torsoSkin });
    const ser = [];
    for (let i = 0; i < 3; i++) ser.push(xf(G.sph(W * 0.08, 6, 5), { x: W * 0.68, y: D.chest * (0.2 + i * 0.13), z: W * 0.26, sx: 0.5, sy: 0.6, sz: 1.3, ry: -0.6 }));
    rig.pair('chest', 'chest', mat, mergeRaw(ser), {}, { c });
  }
  if (g > 0) {
    // bony landmarks: hip crests, sternum, shoulder blades, collar notch
    rig.pair('hips', 'hips', mat, xf(G.sph(W * 0.16, 8, 6), { sx: 0.45, sy: 0.4, sz: 1.2 }), { x: W * 0.52, y: 0.02, z: W * 0.22, ry: 0.5 }, { c });
    rig.add('chest', mat, xf(G.box(0.022, D.chest * 0.55, 0.016), {}), { y: D.chest * 0.5, z: front(1) + 0.004, rx: -0.12 }, { c: o.ribC ?? c });
    rig.pair('chest', 'chest', mat, xf(G.sph(W * 0.32, 8, 6), { sx: 0.8, sy: 1.0, sz: 0.3 }), { x: W * 0.36, y: D.chest * 0.66, z: -W * 0.44, ry: 0.35 }, { c });
  }
  if (o.veins) {
    const R = rng(sd + 7);
    for (const S of ['L', 'R']) {
      const vs = [];
      for (let i = 0; i < 3; i++) { const a = (R() - 0.5) * 1.4; const r = 0.042 * m * 0.95; vs.push(tube([[Math.sin(a) * r, -0.04, Math.cos(a) * r], [Math.sin(a + 0.3) * r * 0.95, -D.fore * 0.45, Math.cos(a + 0.3) * r * 0.95], [Math.sin(a + 0.1) * r * 0.75, -D.fore * 0.9, Math.cos(a + 0.1) * r * 0.75]], 0.0045 * Math.sqrt(m), 8, 3)); }
      rig.add('fore' + S, mat, mergeRaw(vs), {}, { c: o.veinC ?? c });
    }
  }
  // glutes / pelvis mass
  rig.pair('hips', 'hips', mat, bump(G.sph(W * 0.4, 10, 8)), { x: W * 0.3, y: -0.05, z: -0.04, sz: 0.85 }, { c });
  // neck
  rig.add('neck', mat, bump(taper(0.05 * Math.sqrt(m), 0.048 * Math.sqrt(m), D.neck + 0.05, 9, 2)), { y: D.neck + 0.02 }, { c });
  // limbs: one continuous mesh per limb, skinned across the elbow / knee
  const U = D.upper, F = D.fore, T = D.thigh, Sh = D.shin;
  const gk = 1 - g * 0.25;
  const armProf = [[0.001, 0.05], [0.04 * m, 0.04], [0.052 * m, 0.0], [0.056 * m, -U * 0.15], [0.05 * m * gk, -U * 0.5], [0.046 * m * gk, -U * 0.7], [0.036 * m, -U * 0.95], [0.04 * m * gk, -U - F * 0.22], [0.036 * m * gk, -U - F * 0.5], [0.028 * m, -U - F * 0.88], [0.026 * m, -U - F], [0.001, -U - F - 0.01]];
  const legProf = [[0.001, 0.06], [0.06 * m, 0.05], [0.08 * m, 0.0], [0.08 * m * gk, -T * 0.3], [0.068 * m * gk, -T * 0.6], [0.052 * m, -T * 0.92], [0.05 * m, -T - 0.02], [0.054 * m * gk, -T - Sh * 0.25], [0.046 * m * gk, -T - Sh * 0.5], [0.034 * m, -T - Sh * 0.85], [0.032 * m, -T - Sh], [0.001, -T - Sh - 0.02]];
  const limb = (prof, flatZ) => {
    const geo = lathe(prof.slice().reverse(), o.limbSeg ?? 12);
    deform(geo, (v) => { v.z *= flatZ; });
    return bump(geo, 0.005);
  };
  for (const S of ['L', 'R']) {
    const sx = S === 'L' ? 1 : -1;
    rig.add('arm' + S, mat, limb(armProf, 0.92), {}, { c, cfn, skin: chainSkin([['arm' + S, U - 0.05], ['fore' + S, U + 0.05]], (v) => -v.y) });
    rig.add('arm' + S, mat, bump(G.sph(0.06 * m, 10, 8)), { y: -0.025, sx: 1.05, sy: 0.95 }, { c }); // deltoid
    rig.add('arm' + S, mat, bump(xf(G.sph(0.03 * m * gk, 8, 6), { sy: 2.4 })), { y: -U * 0.5, z: 0.025 * m }, { c }); // bicep
    if (g > 0) rig.add('fore' + S, mat, G.sph(0.028 * m, 6, 5), { y: 0.01, z: -0.025 }, { c }); // elbow knob
    rig.add('thigh' + S, mat, limb(legProf, 0.95), {}, { c, cfn, skin: chainSkin([['thigh' + S, T - 0.06], ['shin' + S, T + 0.06]], (v) => -v.y) });
    rig.add('shin' + S, mat, bump(G.sph(0.036 * m * gk, 8, 6)), { y: -Sh * 0.27, z: -0.025, sz: 1.2, sy: 2.0 }, { c }); // calf
    rig.add('shin' + S, mat, G.sph(0.032 * Math.sqrt(m), 6, 5), { y: 0.0, z: 0.03, sy: 0.9 }, { c }); // kneecap
    const ft = mergeRaw([xf(G.sph(0.045, 8, 6), { y: -0.04, z: 0.04, sx: 0.9, sy: 0.55, sz: 1.9 })]);
    rig.add('foot' + S, mat, ft, { s: m * 0.6 + 0.4 }, { c });
    if (o.toeClaws) for (let i = 0; i < 3; i++) rig.add('foot' + S, 'bone', G.cone(0.008, 0.05, 4), { x: (i - 1) * 0.025 * (m * 0.6 + 0.4), y: -0.06, z: 0.13 * (m * 0.6 + 0.4), rx: Math.PI / 2 + 0.4 }, { c: 0x2a241c });
    if (o.hands !== false) addFleshHand(rig, 'hand' + S, sx, { mat, c, m: Math.sqrt(m), claws: o.claws, clawC: o.clawC, grip: o.grip?.[S], ...o.hand });
  }
}
export function addFleshHand(rig, bone, side, o = {}) {
  const m = o.m ?? 1, mat = o.mat ?? 'skin', c = o.c;
  const curl = o.grip ? 1 : (o.curl ?? 0.35);
  const fl = (o.fingerLen ?? (o.claws ? 1.15 : 1));
  // palm: flattened rounded block, thin along X (palm faces the body)
  const palm = deform(G.sph(0.043, 8, 6), (v) => { v.x *= 0.5; v.y *= 1.1; if (v.y < 0) v.z *= 1.1; if (v.x * side < 0) v.x *= 0.7; });
  rig.add(bone, mat, palm, { y: -0.045 * m, s: m }, { c });
  const fingers = [], knuck = [];
  const clawG = [];
  for (let i = 0; i < 4; i++) {
    const z = (1.5 - i) * 0.0205;
    const L = 0.085 * [0.9, 1, 0.95, 0.75][i] * fl;
    const { pts, phi } = fingerPts(side, z, L, curl, -0.078, (1.5 - i) * 0.1);
    const r0 = 0.0105 * (i === 3 ? 0.85 : 1);
    fingers.push(tube(pts, (u) => r0 * (1 - u * 0.35), 5, 4));
    knuck.push(xf(G.oct(r0 * 1.25), { x: pts[0].x + side * 0.002, y: pts[0].y + 0.003, z: pts[0].z }));
    if (o.claws) {
      const a = pts[3], d = new THREE.Vector3(-side * Math.sin(phi + 0.35), -Math.cos(phi + 0.35), 0);
      clawG.push(tube([a.clone().addScaledVector(d, -0.004), a.clone().addScaledVector(d, o.claws * 0.55), a.clone().addScaledVector(d, o.claws).add(new THREE.Vector3(-side * 0.012, 0, 0))], (u) => 0.0078 * (1 - u * 0.95), 3, 3));
    }
  }
  // thumb (front side, opposing)
  const th = [[side * 0.002, -0.03, 0.03], [-side * 0.006, -0.055, 0.05], [-side * (0.014 + curl * 0.02), -0.078 - curl * 0.006, 0.058 - curl * 0.018], [-side * (0.02 + curl * 0.03), -0.095, 0.058 - curl * 0.03]];
  fingers.push(tube(th, (u) => 0.012 * (1 - u * 0.3), 5, 4));
  if (o.claws) { const a = new THREE.Vector3(...th[3]); clawG.push(tube([a, a.clone().add(new THREE.Vector3(-side * 0.01, -o.claws * 0.6, 0.005))], (u) => 0.0072 * (1 - u * 0.95), 3, 3)); }
  rig.add(bone, mat, mergeRaw([...fingers, ...knuck]), { s: m }, { c });
  if (clawG.length) rig.add(bone, 'bone', mergeRaw(clawG), { s: m }, { c: o.clawC ?? 0x2b2620 });
}

// -------------------------------------------------------------- armor ----
// dome pauldron sitting on an arm bone
export function pauldron(r = 0.12, layers = 3) {
  const parts = [shell([[r, -0.02], [r * 0.97, 0.03], [r * 0.75, 0.08], [r * 0.4, 0.11], [0.001, 0.115]], 0.008, 12)];
  for (let i = 1; i < layers; i++) parts.push(shell([[r * (1.04 + i * 0.07), -0.025 - i * 0.04], [r * (1.0 + i * 0.06), 0.025 - i * 0.04]], 0.008, 12));
  return mergeRaw(parts);
}
export function rivets(points, r = 0.008) {
  return mergeRaw(points.map(([x, y, z]) => xf(G.sph(r, 4, 3), { x, y, z })));
}
// breastplate shell around chest bone
export function cuirass(D, o = {}) {
  const W = D.shoulderW * (o.w ?? 1);
  const h = D.chest + D.spine * (o.low ?? 0.6);
  const g = lathe([[W * 0.75, -D.spine * (o.low ?? 0.6)], [W * 0.85, -D.spine * 0.2], [W * 0.95, h * 0.45 - D.spine * 0.3], [W * 0.95, D.chest * 0.8], [W * 0.55, D.chest + 0.02], [W * 0.3, D.chest + 0.03]], 16);
  deform(g, (v) => {
    v.z *= 0.72 * (o.depth ?? 1);
    if (v.z > 0) v.z += Math.max(0, 1 - Math.abs(v.x) / W) * 0.035; // central ridge
  });
  return g;
}
export function belt(r, h = 0.05, sz = 0.7) {
  return xf(G.cyl(r, r, h, 16, true), { sz });
}
export function plateSkirt(r1, r2, len, n = 8, gap = 0.08) {
  const parts = [];
  for (let i = 0; i < n; i++) {
    const a0 = (i / n) * TAU + gap / 2, al = TAU / n - gap;
    const g = new THREE.CylinderGeometry(r1, r2, len, 3, 1, true, a0, al);
    parts.push(xf(g, { y: -len / 2 }));
  }
  return mergeRaw(parts);
}

// helmets (origin at head bone base)
export function greatHelm(o = {}) {
  const r = o.r ?? 0.125, h = o.h ?? 0.28;
  const shell = lathe([[r * 0.92, 0], [r, 0.04], [r * 1.02, h * 0.55], [r * 0.95, h * 0.8], [r * 0.6, h * 0.97], [0.001, h]], 14);
  deform(shell, (v) => { v.z *= 1.05; if (v.z > 0) v.z += Math.max(0, 1 - Math.abs(v.x) / r) * 0.025; });
  return shell;
}
export function kettleHat(r = 0.15) {
  return mergeRaw([
    lathe([[r * 0.68, 0], [r * 0.7, 0.06], [r * 0.6, 0.12], [r * 0.3, 0.16], [0.001, 0.17]], 12),
    xf(lathe([[r * 1.25, -0.02], [r * 1.25, -0.005], [r * 0.66, 0.02]], 14), {}),
  ]);
}

// --------------------------------------------------------------- cloth ----
export function hood(r = 0.15, len = 0.32, o = {}) {
  // open-front hood: partial sphere shell + drape
  const g = new THREE.SphereGeometry(r, 16, 10, Math.PI * (0.5 + (o.open ?? 0.22)), TAU - Math.PI * 2 * (o.open ?? 0.22), 0, Math.PI * 0.62);
  deform(g, (v) => { v.z *= 1.15; if (v.y > r * 0.6 && v.z < 0) { v.z -= (v.y - r * 0.6) * (o.peak ?? 1.2); v.y += (v.y - r * 0.6) * 0.4; } });
  const drape = robe(r * 0.92, r * 1.45, len, { seg: 14, rows: 3, folds: 5, foldAmp: 0.08, tatter: 0.2, seed: 7 });
  return { shell: g, drape };
}

// ------------------------------------------------------------ weapons ----
export function swordGeo(o = {}) {
  const L = o.len ?? 0.8, W = o.w ?? 0.075, th = o.th ?? 0.014;
  const grip = o.grip ?? 0.12;
  const R = rng(o.seed ?? 5);
  // blade outline with notches
  const pts = [[-W / 2, 0]];
  const n = 7;
  for (let i = 1; i < n; i++) { const t = i / n; pts.push([-W / 2 * (1 - t * 0.15) + (R() < (o.notch ?? 0.3) ? 0.008 : 0), t * L * 0.88]); }
  pts.push([0, L]);
  for (let i = n - 1; i > 0; i--) { const t = i / n; pts.push([W / 2 * (1 - t * 0.15) - (R() < (o.notch ?? 0.3) ? 0.008 : 0), t * L * 0.88]); }
  pts.push([W / 2, 0]);
  const blade = extrude(pts, th, 0.004, 1);
  deform(blade, (v) => { const k = 1 - Math.abs(v.x) / (W / 2); v.z *= 0.3 + 0.7 * clamp(k * 2); }, true);
  // into grip space: blade along +z
  xf(blade, { rx: Math.PI / 2, z: 0.0 });
  xf(blade, { rz: Math.PI / 2 });
  xf(blade, { z: 0.04 });
  const guard = xf(G.box(0.03, o.guardW ?? 0.2, 0.03), { z: 0.03 });
  const gripG = xf(G.cyl(0.016, 0.018, grip, 6), { rx: Math.PI / 2, z: -grip / 2 + 0.02 });
  const pommel = xf(G.sph(0.026, 6, 5), { z: -grip + 0.005 });
  return { blade, guard, grip: gripG, pommel };
}
export function addSword(rig, bone, o = {}) {
  const s = o.s ?? 1;
  const sw = swordGeo(o);
  const t = { y: o.y ?? -0.07 * s, z: o.z ?? 0, rx: o.rx ?? 0, ry: o.ry ?? 0, rz: o.rz ?? 0, s };
  rig.add(bone, o.bladeMat ?? 'iron', sw.blade, t, { c: o.bladeC ?? STEEL });
  rig.add(bone, o.guardMat ?? 'iron', sw.guard, t, { c: o.guardC ?? RUSTY });
  rig.add(bone, 'leather', sw.grip, t, { c: 0x5a3a24 });
  rig.add(bone, o.guardMat ?? 'iron', sw.pommel, t, { c: o.guardC ?? RUSTY });
  if (o.glowEdge) rig.add(bone, 'glow', xf(G.box(0.006, 0.004, (o.len ?? 0.8) * 0.85), { z: 0.04 + (o.len ?? 0.8) * 0.43, y: 0 }), t, { c: o.glowEdge });
}
// round wooden shield, face toward +Z
export function addRoundShield(rig, bone, o = {}) {
  const r = o.r ?? 0.3;
  // face normal points along local +X of the forearm (outward); arm poses turn it forward
  const t = { x: o.x ?? 0.06, y: o.y ?? -0.14, z: o.z ?? 0, rx: o.rx ?? 0, ry: (o.ry ?? 0) + Math.PI / 2, rz: o.rz ?? 0 };
  const face = xf(G.cyl(r, r, 0.035, 18), { rx: Math.PI / 2 });
  deform(face, (v) => { v.z += (1 - (v.x * v.x + v.y * v.y) / (r * r)) * 0.03 * Math.sign(v.z + 0.0001); }, true);
  rig.add(bone, 'wood', face, t, { c: o.woodC ?? 0x9a7a5a, cfn: (v) => { const k = Math.floor((v.x / r + 1) * 3); const s = 0.8 + (k % 2) * 0.3; return [1.3 * s, 1.05 * s, 0.85 * s]; } });
  rig.add(bone, 'iron', xf(G.tor(r, 0.018, 5, 24), {}), t, { c: o.rimC ?? RUSTY });
  rig.add(bone, 'iron', xf(new THREE.SphereGeometry(r * 0.22, 10, 6, 0, TAU, 0, Math.PI / 2), { rx: Math.PI / 2, z: 0.02 }), t, { c: o.rimC ?? RUSTY });
  rig.add(bone, 'iron', mergeRaw([xf(G.box(r * 1.9, 0.035, 0.012), { z: 0.03, y: r * 0.35 }), xf(G.box(r * 1.9, 0.035, 0.012), { z: 0.03, y: -r * 0.35 })]), t, { c: DARKSTEEL });
  const rv = [];
  for (let i = 0; i < 12; i++) { const a = (i / 12) * TAU; rv.push([Math.cos(a) * r * 0.9, Math.sin(a) * r * 0.9, 0.035]); }
  rig.add(bone, 'iron', rivets(rv, 0.009), t, { c: RUSTY });
}
export function axeHeadGeo(o = {}) {
  const w = o.w ?? 0.28, h = o.h ?? 0.36;
  const pts = [[0, -0.05], [w * 0.35, -0.07], [w * 0.75, -h * 0.45], [w, -h * 0.5], [w * 1.05, 0], [w, h * 0.5], [w * 0.75, h * 0.45], [w * 0.35, 0.07], [0, 0.05]];
  const g = extrude(pts, o.th ?? 0.03, 0.006, 1);
  deform(g, (v) => { v.z *= 0.35 + 0.65 * clamp(1 - v.x / (w * 1.05)); }, true);
  return g;
}

// Staff with a head ornament; shaft along +Y from the hand (hand holds near middle)
export function addStaff(rig, bone, o = {}) {
  const L = o.len ?? 1.7, t0 = { y: o.y ?? -0.06, z: o.z ?? 0, rx: o.rx ?? 0, ry: o.ry ?? 0, rz: o.rz ?? 0 };
  const grip = o.grip ?? 0.55; // fraction from bottom where held
  const R = rng(o.seed ?? 4);
  // gnarled shaft: tube with wobble along Z (forward when arm hangs)
  const pts = [];
  for (let i = 0; i <= 8; i++) { const t = i / 8; pts.push([(R() - 0.5) * 0.03, (R() - 0.5) * 0.03, (t - grip) * L]); }
  const shaft = tube(pts, (u) => (o.r ?? 0.022) * (1.1 - u * 0.25), 16, 6);
  rig.add(bone, o.mat ?? 'wood', shaft, t0, { c: o.c ?? 0x6a4a30 });
  return { tip: (1 - grip) * L, t0 };
}

export function addBow(rig, hand, nockBone, o = {}) {
  // bow along local Z, limbs bowing toward -Y, string at +Y side
  const L = o.len ?? 1.2;
  const pts = [];
  for (let i = 0; i <= 10; i++) { const t = i / 10 - 0.5; pts.push([0, -0.1 * Math.cos(t * Math.PI) - 0.02 * Math.cos(t * Math.PI * 3), t * L]); }
  const t0 = { y: -0.06 };
  rig.add(hand, 'wood', tube(pts, (u) => 0.016 * (1 - Math.abs(u - 0.5) * 0.9), 20, 5), t0, { c: 0x5a3a22 });
  rig.add(hand, 'leather', xf(G.cyl(0.022, 0.022, 0.12, 6), { rx: Math.PI / 2, y: -0.1 }), t0, { c: 0x3a2418 });
  // string: tips skinned to hand, middle skinned to nock bone (pulled back when drawing)
  const tipY = -0.1 * Math.cos(Math.PI / 2) - 0.0;
  const sg = tube([[0, tipY, -L / 2], [0, tipY, 0], [0, tipY, L / 2]], 0.0035, 8, 3);
  rig.add(hand, 'bone', sg, t0, {
    c: 0xbfb49a,
    skin: (v) => { const k = 1 - Math.abs(v.z) / (L / 2); return [[hand, 1 - k], [nockBone, k]]; },
  });
}

// Two-handed axe: haft along +Z from the grip, blade hanging toward -Y.
export function addAxe(rig, bone, o = {}) {
  const L = o.len ?? 1.3, grip = o.grip ?? 0.25; // grip = fraction from the butt
  const t = { y: o.y ?? -0.07, z: 0, rx: o.rx ?? 0, s: o.s ?? 1 };
  const z0 = -L * grip, z1 = L * (1 - grip);
  rig.add(bone, 'wood', xf(G.cyl(0.024, 0.028, L, 8), { rx: Math.PI / 2, z: (z0 + z1) / 2 }), t, { c: o.haftC ?? [0.75, 0.55, 0.4] });
  rig.add(bone, 'leather', mergeRaw([0, 1, 2].map((i) => xf(G.cyl(0.03, 0.03, 0.08, 8), { rx: Math.PI / 2, z: z0 + 0.08 + i * 0.1 }))), t, { c: 0x3a2618 });
  rig.add(bone, 'iron', xf(G.cyl(0.032, 0.026, 0.06, 8), { rx: Math.PI / 2, z: z0 + 0.02 }), t, { c: o.metalC ?? DARKSTEEL });
  const hw = o.headW ?? 0.42, hh = o.headH ?? 0.5;
  const head = axeHeadGeo({ w: hw, h: hh, th: 0.035 });
  // blade outline lies in XY with edge at +X: rotate so the edge points -Y, flat faces ±X
  rig.add(bone, o.headMat ?? 'iron', xf(head, { rz: -Math.PI / 2, ry: Math.PI / 2 }), { ...t, z: z1 - hh * 0.35 }, { c: o.headC ?? STEEL });
  if (o.double) rig.add(bone, o.headMat ?? 'iron', xf(axeHeadGeo({ w: hw * 0.7, h: hh * 0.8, th: 0.03 }), { rz: Math.PI / 2, ry: Math.PI / 2 }), { ...t, z: z1 - hh * 0.35 }, { c: o.headC ?? STEEL });
  rig.add(bone, 'iron', mergeRaw([xf(G.box(0.07, 0.09, 0.16), { z: z1 - hh * 0.35 }), xf(G.cone(0.03, 0.14, 4), { z: z1 + 0.02, rx: Math.PI / 2 })]), t, { c: o.metalC ?? DARKSTEEL });
  return { tip: z1 };
}
// rectangular iron tower shield, face normal along local +X (outward on the left forearm)
export function addTowerShield(rig, bone, o = {}) {
  const w = o.w ?? 0.6, h = o.h ?? 1.0;
  // height runs along the forearm's local Z (vertical when the forearm is held level), width along the forearm
  const t = { x: o.x ?? 0.07, y: o.y ?? -0.15, z: o.z ?? 0, ry: Math.PI / 2, rx: Math.PI / 2 };
  const face = G.box(w, h, 0.04, 6, 8, 1);
  deform(face, (v) => { v.z += (1 - (v.x / (w / 2)) ** 2) * 0.05 * Math.sign(v.z + 1e-4) + (v.z > 0 ? (1 - (v.x / (w / 2)) ** 2) * 0.02 : 0); });
  rig.add(bone, o.mat ?? 'steel', face, t, { c: o.c ?? [0.35, 0.33, 0.32] });
  const rim = [xf(G.box(w + 0.04, 0.05, 0.07), { y: h / 2 }), xf(G.box(w + 0.04, 0.05, 0.07), { y: -h / 2 }), xf(G.box(0.05, h, 0.07), { x: w / 2 }), xf(G.box(0.05, h, 0.07), { x: -w / 2 })];
  rig.add(bone, o.rimMat ?? 'iron', mergeRaw(rim), t, { c: o.rimC ?? RUSTY });
  const rv = [];
  for (let i = 0; i < 5; i++) for (const x of [-1, 1]) rv.push([x * (w / 2 - 0.05), -h / 2 + 0.1 + i * (h - 0.2) / 4, 0.06]);
  rig.add(bone, 'iron', rivets(rv, 0.014), t, { c: o.rimC ?? RUSTY });
  if (o.emblem) o.emblem(rig, bone, t);
  if (o.spike) rig.add(bone, 'iron', xf(G.cone(0.05, 0.16, 6), { rx: Math.PI / 2, z: 0.1 }), t, { c: o.rimC ?? RUSTY });
}
// spiked club, along +Z
export function addClub(rig, bone, o = {}) {
  const L = o.len ?? 1.0;
  const t = { y: o.y ?? -0.07 };
  const pts = [[0.03, -0.12], [0.035, 0.2], [0.07, L * 0.6], [0.1, L * 0.85], [0.085, L], [0.001, L + 0.02]].map(([r, z]) => [r, z]);
  const club = xf(lathe(pts, 10), { rx: Math.PI / 2 });
  rig.add(bone, 'wood', bumpy(club, 0.01, 8, 3), t, { c: [0.7, 0.5, 0.36] });
  const sp = [];
  const R = rng(5);
  for (let i = 0; i < 14; i++) { const a = R() * TAU, z = L * (0.55 + R() * 0.4); const r = 0.085; sp.push(xf(G.cone(0.014, 0.08, 4), { x: Math.cos(a) * r, y: Math.sin(a) * r, z, rz: a - Math.PI / 2 })); }
  rig.add(bone, 'iron', mergeRaw(sp), t, { c: RUSTY });
  rig.add(bone, 'iron', mergeRaw([xf(G.cyl(0.08, 0.08, 0.04, 10), { rx: Math.PI / 2, z: L * 0.5 }), xf(G.cyl(0.095, 0.095, 0.04, 10), { rx: Math.PI / 2, z: L * 0.9 })]), t, { c: DARKSTEEL });
}
// executioner-style pointed hood with eye holes, origin at head bone
export function pointedHood(r = 0.13, o = {}) {
  const g = lathe([[r * 1.6, -0.12], [r * 1.25, -0.02], [r * 1.05, 0.06], [r * 1.1, 0.14], [r * 0.95, 0.22], [r * 0.6, 0.3], [r * 0.2, 0.37], [0.001, 0.39]], 16);
  deform(g, (v) => { v.z *= 1.05; if (v.y > 0.25) v.z -= (v.y - 0.25) * (o.lean ?? 0.6); });
  return g;
}

// ------------------------------------------------------------ plate kit ----
export const BLACKSTEEL = [0.55, 0.55, 0.6];
export const GOLDTRIM = [1.0, 0.85, 0.55];
// duplicate faces with reversed winding so a thin sheet is visible from both sides
export function twoSided(geo) {
  const g = geo.index ? geo.toNonIndexed() : geo.clone();
  if (!g.getAttribute('normal')) g.computeVertexNormals();
  const p = g.getAttribute('position'), n = g.getAttribute('normal');
  const cnt = p.count;
  const pos = new Float32Array(cnt * 6), nrm = new Float32Array(cnt * 6);
  pos.set(p.array); nrm.set(n.array);
  for (let i = 0; i < cnt; i += 3) for (let k = 0; k < 3; k++) {
    const src = i + (2 - k), dst = cnt + i + k;
    pos[dst * 3] = p.getX(src); pos[dst * 3 + 1] = p.getY(src); pos[dst * 3 + 2] = p.getZ(src);
    nrm[dst * 3] = -n.getX(src); nrm[dst * 3 + 1] = -n.getY(src); nrm[dst * 3 + 2] = -n.getZ(src);
  }
  const o = new THREE.BufferGeometry();
  o.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  o.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  return o;
}
// tube-shaped limb plate (rerebrace / vambrace / cuisse / greave) hanging from y=0
export function limbPlate(r1, r2, len, flare = 0.01) {
  return shell([[r2 + flare, -len], [r2, -len + 0.02], [r1, -0.02], [r1 + flare, 0]], 0.008, 12);
}
export function couter(r = 0.05) {
  return mergeRaw([xf(G.sph(r, 10, 8, 0, TAU, 0, Math.PI * 0.6), { rx: -Math.PI / 2 - 0.3, z: -0.01 }), xf(G.cone(r * 0.9, r * 1.4, 6), { z: -r * 0.9, rx: -Math.PI / 2, sx: 1.4, sy: 0.4 })]);
}
export function addPlate(rig, D, o = {}) {
  const mat = o.mat ?? 'steel', c = o.c ?? BLACKSTEEL, tc = o.trimC ?? GOLDTRIM, trimMat = o.trimMat ?? 'gold';
  const b = o.bulk ?? 1;
  const W = D.shoulderW;
  // cuirass + backplate
  rig.add('chest', mat, cuirass(D, { w: 1.08 * b, depth: 1.15 * b, low: 0.75 }), {}, { c });
  if (o.trim) rig.add('chest', trimMat, mergeRaw([xf(G.tor(W * 0.55, 0.012, 4, 18), { rx: Math.PI / 2, y: D.chest - 0.01, sz: 0.8 }), xf(G.tor(W * 0.8 * b, 0.012, 4, 20), { rx: Math.PI / 2, y: -D.spine * 0.7, sz: 0.75 })]), {}, { c: tc });
  // gorget
  rig.add('neck', mat, lathe([[0.09 * b, -0.04], [0.085 * b, 0.02], [0.07 * b, 0.07]], 12), { y: -0.0 }, { c });
  // faulds: 3 overlapping hoops on the hips
  for (let i = 0; i < 3; i++) rig.add('hips', mat, shell([[W * (0.84 + i * 0.05) * b, -0.06 - i * 0.06], [W * (0.8 + i * 0.05) * b, -0.0 - i * 0.06]], 0.008, 16), { sz: 0.78 }, { c });
  // tassets
  rig.pair('hips', 'hips', mat, mergeRaw([xf(G.box(0.16, 0.2, 0.012), { y: -0.1 }), xf(G.box(0.16, 0.012, 0.02), { y: -0.2 })]), { x: W * 0.42 * b, y: -0.16, z: W * 0.62 * b, rx: 0.12, ry: 0.35 }, { c });
  for (const S of ['L', 'R']) {
    const sx = S === 'L' ? 1 : -1;
    const pr = (o.pauldron ?? 0.12) * b;
    rig.add('arm' + S, mat, pauldron(pr, 3), { x: sx * 0.02, y: 0.0, rz: sx * 0.45, sy: 0.85 }, { c });
    if (o.trim) rig.add('arm' + S, trimMat, xf(G.tor(pr * 1.17, 0.009, 4, 16), { rx: Math.PI / 2 }), { x: sx * 0.02, y: -0.1, rz: sx * 0.45, sy: 0.85 }, { c: tc });
    rig.add('arm' + S, mat, limbPlate(0.062 * b, 0.055 * b, D.upper * 0.6), { y: -D.upper * 0.28 }, { c });
    rig.add('fore' + S, mat, couter(0.055 * b), { y: 0.0, z: -0.0 }, { c });
    rig.add('fore' + S, mat, limbPlate(0.056 * b, 0.048 * b, D.fore * 0.75), { y: -D.fore * 0.15 }, { c });
    // gauntlet with flared cuff
    rig.add('hand' + S, mat, mergeRaw([lathe([[0.065 * b, 0.04], [0.05 * b, -0.02]], 10), xf(G.box(0.085 * b, 0.09, 0.05 * b), { y: -0.06 }), xf(G.box(0.08 * b, 0.05, 0.05 * b), { y: -0.12, z: 0.02, rx: -0.9 })]), {}, { c });
    rig.add('thigh' + S, mat, limbPlate(0.092 * b, 0.075 * b, D.thigh * 0.75), { y: -D.thigh * 0.12 }, { c });
    rig.add('shin' + S, mat, mergeRaw([xf(G.sph(0.06 * b, 10, 8, 0, TAU, 0, Math.PI * 0.55), { rx: Math.PI / 2 + 0.2, z: 0.02 }), xf(G.cone(0.05 * b, 0.07, 6), { z: 0.03, x: sx * 0.05, rz: -sx * Math.PI / 2, sy: 0.5 })]), { y: 0.0 }, { c });
    rig.add('shin' + S, mat, limbPlate(0.07 * b, 0.055 * b, D.shin * 0.85), { y: -D.shin * 0.1 }, { c });
    rig.add('foot' + S, mat, mergeRaw([xf(G.sph(0.06, 10, 6, 0, TAU, 0, Math.PI / 2), { sx: 1.15, sy: 0.9, sz: 2.0, y: -0.075, z: 0.05 }), xf(G.box(0.12, 0.02, 0.24), { y: -0.075, z: 0.05 })]), { s: b }, { c });
  }
  if (o.mail !== false) {
    rig.add('hips', 'mail', robe(W * 0.75 * b, W * 0.95 * b, D.thigh * 0.85, { seg: 16, rows: 3, folds: 6, foldAmp: 0.03, tatter: 0.04, seed: 2 }), { y: -0.03, sz: 0.85 }, { c: o.mailC ?? [0.9, 0.9, 0.95], skin: chainSkin([['hips', -0.15], ['thighL', -0.4]], (v) => -v.y) });
    for (const S of ['L', 'R']) rig.add('arm' + S, 'mail', G.cyl(0.05 * b, 0.045 * b, D.upper, 8, true), { y: -D.upper / 2 }, { c: o.mailC ?? [0.9, 0.9, 0.95] });
  }
}
// cloth tabard front+back panels skinned from chest down through hips
export function addTabard(rig, D, o = {}) {
  const W = D.shoulderW;
  const len = o.len ?? (D.spine + D.thigh * 0.9 + 0.3);
  const c = o.c ?? [0.4, 0.06, 0.06];
  for (const [z, ry, sd] of [[1, 0, 2], [-1, Math.PI, 5]]) {
    const pg = panel(W * (o.w ?? 0.95), len, { ws: 5, hs: 8, tatter: o.tatter ?? 0.25, seed: sd + (o.seed ?? 0), curve: 0.06 });
    rig.add('chest', 'cloth', pg, { y: D.chest * 0.85, z: z * W * 0.62 * (o.depth ?? 1), ry, rx: z * 0.05 }, {
      c: o.cfn ? undefined : c, cfn: o.cfn,
      anim: (v) => clamp((-v.y - D.chest * 0.6) / len) * 1.2,
      skin: chainSkin([['hips', -D.spine - 0.4], ['spine', -D.spine * 0.5], ['chest', 0.0]], (v) => v.y),
    });
  }
  if (o.emblem) rig.add('chest', o.emblemMat ?? 'gold', o.emblem, { y: D.chest * 0.45, z: W * 0.62 * (o.depth ?? 1) + 0.025 }, { c: o.emblemC ?? GOLDTRIM });
}
// bat / gargoyle wing: spread in the horizontal plane, leading edge along +X,
// membrane trailing back (-Z). Flap = rotation about Z, fold = rotation about Y.
// side: 1 left (+X), -1 right. bones wingX, wingX2 must exist (see wingBones).
export function addWing(rig, side, o = {}) {
  const S = side > 0 ? 'L' : 'R';
  const span = o.span ?? 1.0, mat = o.mat ?? 'leather', c = o.c ?? [0.5, 0.3, 0.25], boneMat = o.boneMat ?? mat, bc = o.boneC ?? c;
  const k = o.split ?? 0.42;
  const nF = o.fingers ?? 4;
  const lead = (u) => new THREE.Vector3(u * span, Math.sin(u * Math.PI) * 0.14 * span + (u > k ? (u - k) * 0.12 * span : 0), 0.02 * span * Math.sin(u * Math.PI));
  const depth = (u) => 0.62 * span * Math.sin(Math.min(1, u * 1.25) * Math.PI * 0.5) * (1 - Math.max(0, u - 0.85) * 3);
  const trail = (u) => { const f = u * nF; const sc = 1 - Math.sin((f % 1) * Math.PI) * (u > 0.2 ? 0.42 : 0); return new THREE.Vector3(u * span * 0.94, -0.06 * span * Math.sin(u * Math.PI), -depth(u) * sc - 0.05 * span); };
  const US = o.us ?? 20, VS = o.vs ?? 4, pos = [], idx = [];
  for (let i = 0; i <= US; i++) for (let j = 0; j <= VS; j++) { const u = i / US, v = j / VS; const p = lead(u).lerp(trail(u), v); p.y -= Math.sin(v * Math.PI) * 0.07 * span * Math.sin(u * Math.PI); pos.push(p.x, p.y, p.z); }
  for (let i = 0; i < US; i++) for (let j = 0; j < VS; j++) { const a = i * (VS + 1) + j, b2 = (i + 1) * (VS + 1) + j; idx.push(a, a + 1, b2, b2, a + 1, b2 + 1); }
  let mem = new THREE.BufferGeometry();
  mem.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  mem.setIndex(idx); mem.computeVertexNormals();
  mem = twoSided(mem);
  const root = 'wing' + S, mid = 'wing' + S + '2';
  const skin = chainSkin([[root, span * (k - 0.08)], [mid, span * (k + 0.08)]], (v) => v.x * side);
  const mir = side > 0 ? {} : { sx: -1 };
  rig.add(root, mat, mem, mir, { c, skin, anim: (v) => clamp(Math.abs(v.z) / span) * (o.flutter ?? 0.3) });
  // arm strut + finger bones running to the scallop points
  const struts = [tube([lead(0), lead(k * 0.5), lead(k)], (u) => 0.04 * span * (1 - u * 0.5), 8, 5)];
  for (let i = 0; i <= nF; i++) {
    const u = k + (1 - k) * (i / nF);
    const tp = i === nF ? lead(1) : trail(Math.min(1, u));
    struts.push(tube([lead(k), lead(k).lerp(tp, 0.5).add(new THREE.Vector3(0, 0.02 * span, 0)), tp], (t) => 0.018 * span * (1 - t * 0.7), 8, 4));
  }
  rig.add(root, boneMat, mergeRaw(struts), mir, { c: bc, skin });
  if (o.claw) rig.add(root, 'bone', G.cone(0.022 * span, 0.09 * span, 4), { ...mir, x: lead(k).x * side, y: lead(k).y + 0.04 * span, z: lead(k).z + 0.02 * span, rx: -0.4 }, { c: o.clawC ?? 0x1a1410, skin });
}
export function wingBones(rig, parent, x, y, z, span, k = 0.42) {
  for (const [S, sd] of [['L', 1], ['R', -1]]) {
    rig.bone('wing' + S, parent, sd * x, y, z, { rate: 0.9 });
    rig.bone('wing' + S + '2', 'wing' + S, sd * span * k, Math.sin(k * Math.PI) * 0.14 * span, 0.02 * span * Math.sin(k * Math.PI), { rate: 0.8 });
  }
}
// flap: amplitude a (rad), phase ph
// fold 0 = spread, 1 = folded back along the body (forearm sweeps back, fingers fold forward)
export function flapWings(P, ph, a = 0.7, base = 0.1, fold = 0) {
  const s = Math.sin(ph), s2 = Math.sin(ph - 0.8);
  const k = 1 - fold;
  const up = (base + s * a) * k + fold * 0.35;
  P.r('wingL', 0.1 * s * k, 0.25 * k + fold * 1.3, up); P.r('wingR', 0.1 * s * k, -(0.25 * k + fold * 1.3), -up);
  P.r('wingL2', 0, fold * 2.3, s2 * a * 0.5 * k - fold * 0.25); P.r('wingR2', 0, -fold * 2.3, -(s2 * a * 0.5 * k - fold * 0.25));
}

// halberd: shaft along +Z from the grip, axe blade toward -Y, hook toward +Y, spear tip at the end
export function addHalberd(rig, bone, o = {}) {
  const L = o.len ?? 2.2, grip = o.grip ?? 0.35;
  const t = { y: o.y ?? -0.07 };
  const z0 = -L * grip, z1 = L * (1 - grip);
  rig.add(bone, 'wood', xf(G.cyl(0.02, 0.023, L, 8), { rx: Math.PI / 2, z: (z0 + z1) / 2 }), t, { c: o.shaftC ?? [0.45, 0.32, 0.24] });
  const mc = o.metalC ?? STEEL, mm = o.metalMat ?? 'steel';
  const head = axeHeadGeo({ w: 0.26, h: 0.34, th: 0.025 });
  rig.add(bone, mm, xf(head, { rz: -Math.PI / 2, ry: Math.PI / 2 }), { ...t, z: z1 - 0.28 }, { c: mc });
  rig.add(bone, mm, mergeRaw([
    xf(G.cone(0.035, 0.36, 4), { rx: Math.PI / 2, z: z1 + 0.05, sy: 0.35 }),
    xf(G.cone(0.025, 0.18, 4), { y: 0.1, z: z1 - 0.25, rx: 0.5, sz: 0.4 }),
    xf(G.box(0.05, 0.06, 0.32), { z: z1 - 0.27 }),
    xf(G.box(0.012, 0.03, 0.4), { y: 0.025, z: z1 - 0.55 }), xf(G.box(0.012, 0.03, 0.4), { y: -0.025, z: z1 - 0.55 }),
  ]), t, { c: mc });
  if (o.trimC) rig.add(bone, 'gold', mergeRaw([xf(G.cyl(0.03, 0.03, 0.04, 8), { rx: Math.PI / 2, z: z1 - 0.45 }), xf(G.cyl(0.03, 0.03, 0.04, 8), { rx: Math.PI / 2, z: z0 + 0.02 })]), t, { c: o.trimC });
  if (o.glow) rig.add(bone, 'glow', xf(G.box(0.006, 0.006, 0.3), { y: -0.27, z: z1 - 0.28 }), t, { c: o.glow });
  return { tip: z1 + 0.2 };
}
// mage staff with a crystal head held in a claw; along +Z
export function addCrystalStaff(rig, bone, o = {}) {
  const L = o.len ?? 1.9, grip = o.grip ?? 0.55, tip = L * (1 - grip);
  const t = { y: o.y ?? -0.07 };
  rig.add(bone, o.shaftMat ?? 'wood', xf(G.cyl(0.018, 0.022, L, 8), { rx: Math.PI / 2, z: (tip - L * grip) / 2 }), t, { c: o.shaftC ?? [0.25, 0.17, 0.14] });
  const gm = o.trimMat ?? 'gold', gc = o.trimC ?? GOLDTRIM;
  rig.add(bone, gm, mergeRaw([
    xf(G.cyl(0.03, 0.025, 0.08, 8), { rx: Math.PI / 2, z: tip - 0.04 }),
    xf(G.tor(0.028, 0.008, 4, 10), { z: tip - 0.25 }), xf(G.tor(0.028, 0.008, 4, 10), { z: -L * grip + 0.1 }),
    ...[0, 1, 2, 3].map((i) => { const a = i * Math.PI / 2; return tube([[Math.cos(a) * 0.02, Math.sin(a) * 0.02, tip], [Math.cos(a) * 0.07, Math.sin(a) * 0.07, tip + 0.1], [Math.cos(a) * 0.03, Math.sin(a) * 0.03, tip + 0.24]], (u) => 0.012 * (1 - u * 0.6), 8, 4); }),
  ]), t, { c: gc });
  rig.add(bone, 'glow', xf(G.oct(o.crystalR ?? 0.055), { sz: 1.9, rx: 0 }), { ...t, z: tip + 0.13 }, { c: HDR(o.color ?? 0x8a5aff, o.k ?? 3) });
  return { tip: tip + 0.13 };
}
// open book (cover + page block) lying in XZ, spine along X at z=0, opening toward +Z
export function bookGeo(w = 0.4, d = 0.3, th = 0.05) {
  return {
    cover: mergeRaw([xf(G.box(w + 0.03, 0.014, d + 0.02), { z: d / 2, y: 0 })]),
    pages: xf(G.box(w, th, d - 0.01), { z: d / 2, y: th / 2 + 0.007 }),
  };
}
