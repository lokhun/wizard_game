import * as THREE from 'three';
import { G, xf, lathe, shell, robe, panel, tube, taper, extrude, deform, bumpy, mergeRaw, chainSkin, rng, vnoise, clamp, lerp, TAU, smooth, bump, easeOut, easeIn } from './core.js';
import { humanSkeleton, humanoidPose, act2, ACT } from './humanoid.js';
import { glowLevel, robeRing, embroideryOf } from './bossKit.js';
import { twoSided, addSkull, addSkeletonBody, addBoneHand, addFleshHand, addSword, swordGeo, addRoundShield, addAxe, addTowerShield, addClub, pointedHood, addFleshBody, pauldron, kettleHat, HDR, belt, rivets, addBow, hood, BONE_PALE, boneShade, thinBone, STEEL, RUSTY, DARKSTEEL, BRASS } from './parts.js';

const BONE_C = BONE_PALE;
const RUST = RUSTY;

// rusted iron: bare metal mottled with orange-brown rust blooms (iron albedo is dark: tints sit above 1)
const IRON_BARE = [1.5, 1.46, 1.45], IRON_RUST = [1.75, 1.05, 0.72];
function rustFn(seed = 0, amt = 1) {
  return (v) => {
    const n = vnoise(v.x * 11 + seed, v.y * 8, v.z * 11, 33 + seed), st = vnoise(v.x * 30, v.y * 3, v.z * 30, 7 + seed), d = 0.78 + 0.36 * vnoise(v.x * 45, v.y * 45, v.z * 45, 5);
    const r = smooth(0.38, 0.72, n * 0.8 + st * 0.3) * amt;
    return [lerp(IRON_BARE[0], IRON_RUST[0], r) * d, lerp(IRON_BARE[1], IRON_RUST[1], r) * d, lerp(IRON_BARE[2], IRON_RUST[2], r) * d];
  };
}
// faded, grimy cloth: base colour darkened toward a ragged hem and in blotches
function ragFn(c, hemY = -1, seed = 1) {
  return (v) => {
    const n = vnoise(v.x * 9 + seed, v.y * 9, v.z * 9, 11 + seed), k = (0.72 + 0.4 * n) * (1 - smooth(hemY + 0.12, hemY, v.y) * 0.45);
    return [c[0] * k, c[1] * k, c[2] * k];
  };
}

// segmented rusty spangenhelm: domed bowl, brow band, four riveted ribs, nasal; dented on one side
function spangenhelm() {
  const r = 0.112;
  const dome = lathe([[r, 0], [r * 1.012, 0.035], [r * 0.94, 0.08], [r * 0.72, 0.124], [r * 0.38, 0.152], [0.001, 0.166]], 12);
  deform(dome, (v) => { v.z *= 1.1; v.x *= 0.97; const dn = Math.exp(-((v.x - 0.07) ** 2 + (v.y - 0.09) ** 2 + (v.z - 0.03) ** 2) / 0.0012) * 0.016; v.x -= dn; });
  const ribs = [];
  for (let i = 0; i < 4; i++) {
    const a = Math.PI / 4 + i * Math.PI / 2, pts = [];
    for (let k = 0; k <= 4; k++) { const t = k / 4, ph = t * Math.PI / 2 * 0.96; pts.push([Math.sin(a) * Math.cos(ph) * (r + 0.004) * 0.97, 0.012 + Math.sin(ph) * 0.15, Math.cos(a) * Math.cos(ph) * (r + 0.004) * 1.1]); }
    ribs.push(tube(pts, 0.007, 6, 3));
  }
  return mergeRaw([
    dome,
    xf(G.tor(r * 1.02, 0.01, 4, 16), { rx: Math.PI / 2, y: 0.012, sx: 0.97, sy: 1.1 }),
    ...ribs,
    xf(G.box(0.024, 0.085, 0.012), { z: r * 1.1 + 0.006, y: -0.028 }),
    xf(G.oct(0.016), { y: 0.168 }),
    ...[0, 1, 2, 3, 4, 5, 6, 7].map((i) => { const a = (i / 8) * TAU + 0.2; return xf(G.oct(0.007), { x: Math.sin(a) * r * 1.0, y: 0.014, z: Math.cos(a) * r * 1.13 }); }),
  ]);
}

// Round shield, face toward +Z in shield space: planked, a faded painted cross, an iron boss and a
// broken, rimless bite out of one edge; an old arrow still stuck in it.
function skelShield(rig, bone, t, o = {}) {
  const r = o.r ?? 0.3, a0 = 2.35;
  const bite = (a) => { const d = Math.atan2(Math.sin(a - a0), Math.cos(a - a0)); return 0.2 * Math.exp(-((d / 0.24) ** 2)) * (0.75 + 0.25 * Math.sin(a * 37)); };
  const face = xf(G.cyl(r, r, 0.03, 22), { rx: Math.PI / 2 });
  deform(face, (v) => {
    const a = Math.atan2(v.y, v.x), rr = Math.hypot(v.x, v.y);
    if (rr > 1e-4) { const k = 1 - bite(a) * (rr / r) ** 3; v.x *= k; v.y *= k; }
    v.z += (1 - (v.x * v.x + v.y * v.y) / (r * r)) * 0.03 * Math.sign(v.z + 1e-4);
  });
  const paint = (v) => {
    const plank = Math.floor((v.x / r + 1) * 3.5), pk = 0.82 + (plank % 2) * 0.16 + vnoise(plank * 3.1, v.y * 5, 0, 4) * 0.12;
    const scr = vnoise(v.x * 40, v.y * 40, 0, 9), worn = smooth(0.45, 0.75, vnoise(v.x * 7 + 3, v.y * 7, 1, 3) + scr * 0.25);
    let c = (Math.abs(v.x + v.y * 0.15) < r * 0.13 || Math.abs(v.y - 0.02) < r * 0.13) ? [1.35, 0.98, 0.5] : [1.05, 0.3, 0.22];
    if (v.z < 0) c = [0.62, 0.5, 0.4];
    return [lerp(c[0], 0.95, worn) * pk, lerp(c[1], 0.78, worn) * pk, lerp(c[2], 0.62, worn) * pk];
  };
  rig.add(bone, 'wood', face, t, { cfn: paint });
  const IR = { cfn: rustFn(3) };
  rig.add(bone, 'iron', xf(G.tor(r, 0.016, 4, 22, TAU - 0.95), { rz: a0 + 0.475 }), t, IR);
  rig.add(bone, 'iron', mergeRaw([
    xf(G.sph(0.068, 9, 4, 0, TAU, 0, Math.PI / 2), { rx: Math.PI / 2, z: 0.03 }),
    xf(G.cyl(0.09, 0.09, 0.012, 10), { rx: Math.PI / 2, z: 0.032 }),
    ...[0, 1, 2, 3, 4, 5, 6, 7].map((i) => { const a = (i / 8) * TAU + 0.4; return Math.abs(Math.atan2(Math.sin(a - a0), Math.cos(a - a0))) < 0.45 ? null : xf(G.oct(0.011), { x: Math.cos(a) * r * 0.86, y: Math.sin(a) * r * 0.86, z: 0.032 }); }).filter(Boolean),
  ]), t, IR);
  if (o.arrow !== false) {
    const ar = { x: -0.09, y: 0.1, z: 0.02, rx: -0.45, ry: 0.3 };
    rig.add(bone, 'wood', xf(xf(G.cyl(0.0055, 0.0055, 0.4, 4), { rx: Math.PI / 2, z: 0.15 }), ar), t, { c: [0.85, 0.7, 0.5] });
    rig.add(bone, 'cloth', xf(mergeRaw([xf(G.box(0.003, 0.03, 0.07), { z: 0.31 }), xf(G.box(0.03, 0.003, 0.07), { z: 0.31 })]), ar), t, { c: [0.55, 0.5, 0.42] });
  }
}

function skelSword(rig, bone, o = {}) {
  const sw = swordGeo({ len: o.len ?? 0.8, w: o.w ?? 0.072, notch: 0.45, seed: o.seed ?? 3, guardW: 0.2, grip: 0.13 });
  const t = { y: -0.07 };
  rig.add(bone, 'iron', sw.blade, t, { cfn: rustFn(7, 0.75) });
  rig.add(bone, 'iron', mergeRaw([sw.guard, sw.pommel]), t, { cfn: rustFn(2, 1.2) });
  rig.add(bone, 'leather', sw.grip, t, { c: [0.45, 0.32, 0.24] });
}

// ------------------------------------------------- skeleton animation ----
// Shared by the warrior and archer: rattling idle, a jaw that chatters, sudden head twitches;
// a stagger that shakes every bone; a death where the body comes apart into a heap on the floor
// (skull bouncing off on its own), and a spawn that either claws up out of the floor or, after a
// collapse, snaps the heap back together piece by piece.
const SK_STAGGER = { spine: [-0.3, 0.18, 0.1], chest: [-0.28, 0.25, 0.05], neck: [-0.2, 0, 0], head: [-0.45, -0.4, 0.25], armL: [0.45, 0, 0.75], armR: [0.4, 0, -0.65], foreL: [-0.4, 0, 0], foreR: [-0.7, 0, 0], hips: [0, 0, 0, 0, -0.05, -0.12], thighL: [-0.35, 0, 0], shinL: [0.45, 0, 0], thighR: [0.15, 0, 0], jaw: [0.65, 0, 0] };
// mirror a pose dict left <-> right (swap L/R bones, negate yaw, roll and x offset)
function mirrorPose(src) {
  const out = {};
  for (const k in src) {
    const n = /[a-z]L$/.test(k) ? k.slice(0, -1) + 'R' : /[a-z]R$/.test(k) ? k.slice(0, -1) + 'L' : k;
    out[n] = src[k].map((x, i) => (i === 1 || i === 2 || i === 3 ? -x : x));
  }
  return out;
}
// The heap, in groups so death / reassembly can stage them: pelvis on the floor, legs splayed out flat,
// the ribcage tipped onto its side, arms fallen off the shoulders, the skull rolled away, jaw loose.
// Built for falling to the right (sd = 1) and mirrored for the left. (Skeleton hip height: 0.96.)
const SK_HIP = 0.96;
const SK_PILE_R = {
  hips: { hips: [-0.1, 0.3, 0, 0, -(SK_HIP - 0.13), -0.04] },
  legs: { thighL: [-1.52, 0, 0.35], shinL: [0.05, 0, 0], footL: [0.9, 0, 0], thighR: [-1.5, 0, -0.5], shinR: [-0.06, 0, 0], footR: [0.7, 0, 0] },
  torso: { spine: [-0.25, 0, 0.9, 0, -0.06, 0], chest: [0.15, 0.2, 0.5, 0, -0.04, 0], neck: [0.2, 0, 0.3] },
  arms: { armL: [-1.3, 0, -0.35, -0.36, -0.05, 0.18], foreL: [-0.5, 0, 0], handL: [0.4, 0, 0], armR: [-0.5, 0, 0.25], foreR: [-0.3, 0, 0], handR: [0.3, 0, 0] },
  head: { head: [0.5, 0.3, 1.0, -0.12, 0.1, 0.25], jaw: [0.7, 0, 0.2, 0, -0.02, 0.01] },
};
const SK_PILE = { 1: SK_PILE_R, [-1]: Object.fromEntries(Object.entries(SK_PILE_R).map(([k, v]) => [k, mirrorPose(v)])) };
const SK_HIT_R = { head: [-0.5, 0.2, 0], jaw: [0.6, 0, 0], chest: [-0.25, 0.2, 0], armL: [-0.6, 0, 0.6], armR: [-0.5, 0, -0.5], foreL: [-0.5, 0, 0], foreR: [-0.6, 0, 0] };
const SK_HIT = { 1: SK_HIT_R, [-1]: mirrorPose(SK_HIT_R) };
// knees buckled into a crouch: the bridge between standing and the heap (both ways)
const SK_CROUCH = { hips: [0.3, 0, 0, 0, -0.43, -0.05], thighL: [-1.3, 0, 0.2], thighR: [-1.25, 0, -0.2], shinL: [2.0, 0, 0], shinR: [2.0, 0, 0], footL: [-0.6, 0, 0], footR: [-0.6, 0, 0], spine: [0.25, 0, 0], head: [0.2, 0, 0] };
// ... then sat down hard, knees up, on the way to the heap
const SK_SIT = { hips: [-0.05, 0, 0, 0, -(SK_HIP - 0.27), -0.08], thighL: [-2.1, 0, 0.25], thighR: [-2.05, 0, -0.3], shinL: [1.7, 0, 0], shinR: [1.75, 0, 0], footL: [-0.3, 0, 0], footR: [-0.3, 0, 0] };
const SK_RISE = { armL: [-2.6, 0, 0.3], armR: [-2.4, 0, -0.3], foreL: [-0.4, 0, 0], foreR: [-0.6, 0, 0], spine: [0.3, 0, 0], head: [-0.4, 0, 0], jaw: [0.5, 0, 0] };
function skDeath(P, p, m) {
  const sd = m.seed > 0.5 ? 1 : -1, H = SK_PILE[sd];
  // the blow: head snaps back and arms fling; then the joints let go and everything drops (gravity: ease-in)
  P.apply(SK_HIT[sd], bump(0, 0.22, p));
  const a = easeIn(smooth(0.05, 0.3, p)), b = smooth(0.26, 0.44, p), k = smooth(0.42, 0.62, p);
  P.apply(SK_CROUCH, a * (1 - b)); P.apply(SK_SIT, b * (1 - k));
  P.apply(H.hips, k); P.apply(H.legs, k); P.apply(H.torso, smooth(0.28, 0.62, p)); P.apply(H.arms, smooth(0.32, 0.6, p)); P.apply(H.head, smooth(0.3, 0.66, p));
  // the skull lands last, bounces once and rocks to a stop; the eyes gutter out
  P.p('head', 0, (bump(0.62, 0.8, p) * 0.08 + bump(0.8, 0.9, p) * 0.025), 0);
  P.r('head', 0, 0, Math.sin(p * 18) * 0.15 * bump(0.6, 1, p));
  P.r('jaw', bump(0.65, 0.85, p) * 0.3);
  glowLevel(m, 1 - smooth(0.35, 0.75, p) * 0.97);
  return p < 0.6 ? 20 : 14;
}
function skSpawn(P, p, m) {
  const sd = m.seed > 0.5 ? 1 : -1, T = m.time;
  if (m.state.prevAnim === 'death') {
    // reassemble: legs pull straight, the pelvis hauls up, the ribcage rights itself, arms snap on,
    // and the skull hops back onto the neck; each piece arrives with a jerk, the eyes rekindle last
    const H = SK_PILE[sd];
    const kp = 1 - smooth(0.0, 0.22, p), ks = 1 - smooth(0.18, 0.42, p), kc = 1 - smooth(0.42, 0.72, p);
    P.apply(H.legs, kp); P.apply(H.hips, kp); P.apply(SK_SIT, (1 - kp) * ks); P.apply(SK_CROUCH, (1 - ks) * kc); P.apply(H.torso, 1 - smooth(0.25, 0.6, p));
    P.apply(H.arms, 1 - smooth(0.45, 0.72, p)); P.apply(H.head, 1 - smooth(0.62, 0.86, p));
    P.p('head', 0, bump(0.6, 0.8, p) * 0.12, 0);
    const rat = bump(0, 0.9, p) * 0.06;
    P.r('chest', Math.sin(T * 41) * rat, Math.sin(T * 37) * rat, 0); P.r('armL', Math.sin(T * 47) * rat * 2); P.r('armR', Math.sin(T * 43) * rat * 2);
    P.r('head', 0, Math.sin(p * 30) * 0.25 * bump(0.82, 1, p), 0); P.r('jaw', bump(0.8, 1, p) * 0.5);
    glowLevel(m, 0.03 + smooth(0.8, 0.95, p) * 0.97);
    return 18;
  }
  // claw up out of the floor
  glowLevel(m, 1);
  const u = easeOut(p), k = 1 - smooth(0.6, 1, p);
  P.p('base', 0, -(1 - u) * m.spec.height * 1.05, 0);
  P.apply(SK_RISE, k);
  P.r('armL', Math.sin(T * 9) * 0.25 * k); P.r('armR', Math.sin(T * 9 + 2) * 0.25 * k);
  P.r('base', Math.sin(T * 6) * 0.05 * k, 0, Math.sin(T * 5) * 0.06 * k);
  return 22;
}
// idle / walk life: chattering jaw, bony twitches, a loose skull that lags each step, a faint rattle
function skExtra(P, m, s, dt, k) {
  const T = m.time, an = s.anim;
  if (an === 'death' || an === 'spawn') return;
  // the eye-lights flare through a wind-up (the tell before the blow)
  glowLevel(m, an === 'windup' ? 1 + 0.9 * smooth(0, 1, s.progress) : 1);
  if (an === 'stagger') {
    const kk = s.t < 0.07 ? s.t / 0.07 : Math.exp(-(s.t - 0.07) * 4.5);
    const r = kk * 0.14;
    P.r('head', Math.sin(T * 43) * r, Math.sin(T * 37) * r * 1.5, Math.sin(T * 31) * r);
    P.r('jaw', Math.max(0, Math.sin(T * 29)) * kk * 0.5);
    P.r('armL', Math.sin(T * 39) * r); P.r('armR', Math.sin(T * 35 + 1) * r); P.r('foreL', Math.sin(T * 33) * r); P.r('foreR', Math.sin(T * 45) * r);
    return;
  }
  if (!k.action) {
    // jaw: slack, with bursts of chatter
    const burst = smooth(0.7, 0.85, Math.sin(T * 0.53 + m.seed * 11));
    P.r('jaw', 0.1 + Math.max(0, Math.sin(T * 0.9)) * 0.1 + Math.max(0, Math.sin(T * 34)) * 0.22 * burst);
    // sudden head twitches
    const ph = (T * 0.27 + m.seed * 3) % 1, j = ph < 0.05 ? Math.sin(ph / 0.05 * Math.PI) : 0, dir = Math.floor(T * 0.27 + m.seed * 3) % 2 ? 1 : -1;
    P.r('head', -0.06 * j, 0.25 * j * dir, 0.4 * j * dir * (1 - k.w));
  }
  // walking: the skull nods a beat behind the step, shoulders roll, a faint rattle
  const w = k.w;
  P.r('head', Math.sin(k.ph * 2 - 0.9) * 0.07 * w, 0, Math.sin(k.ph - 0.6) * 0.06 * w);
  P.r('chest', 0, 0, Math.sin(k.ph) * 0.05 * w);
  P.r('jaw', Math.max(0, Math.sin(k.ph * 2 + 0.6)) * 0.12 * w);
  const rt = 0.012 * w;
  P.r('foreL', Math.sin(T * 47) * rt); P.r('foreR', Math.sin(T * 43) * rt); P.r('handL', Math.sin(T * 51) * rt * 2); P.r('handR', Math.sin(T * 53) * rt * 2);
}
const SK_BASE = { death: skDeath, spawn: skSpawn, stagger: SK_STAGGER };

function skeletonBase(rig, o = {}) {
  const D = humanSkeleton(rig, { thigh: 0.43, shin: 0.42, spine: 0.14, chest: 0.3, neck: 0.08, shoulderW: 0.18, upper: 0.3, fore: 0.27, jaw: [0.045, 0.03], ...o.dims });
  addSkeletonBody(rig, D, { c: o.boneC ?? BONE_C, grip: { R: true, L: o.gripL }, seed: o.seed ?? 3, th: 1.12 });
  addSkull(rig, 'head', 'jaw', { eye: o.eye ?? 0x5fd8ff, eyeK: 8, eyeR: 1.35, c: o.boneC ?? BONE_C, cfn: boneShade(o.boneC ?? BONE_C, 9), s: 1.06 });
  return D;
}

// ------------------------------------------------------------ skeleton ----
// A dead man-at-arms: rusty spangenhelm with a mail aventail, a torn mail mantle over the
// shoulders, a crimson rag of a surcoat, belt and baldric, a notched sword and a broken shield.
const SK_SWING = act2(
  { armR: [-2.7, 0.35, -0.75], foreR: [-1.35, 0, 0], handR: [-0.35, 0, 0], armL: [-0.72, -0.8, 0.38], foreL: [-1.2, 0, 0], chest: [-0.12, -0.65, 0], spine: [-0.06, -0.28, 0], neck: [0, 0.2, 0], head: [0.15, 0.45, 0], jaw: [0.55, 0, 0], hips: [0, -0.1, 0, 0, -0.07, -0.06], thighL: [-0.5, 0, 0.06], shinL: [0.45, 0, 0], thighR: [0.3, 0, -0.06], shinR: [0.35, 0, 0], footR: [-0.2, 0, 0] },
  { armR: [-0.45, -0.45, 0.65], foreR: [-0.12, 0, 0], handR: [0.65, 0, 0], armL: [0.1, -0.3, 0.55], foreL: [-0.7, 0, 0], chest: [0.38, 0.7, 0], spine: [0.22, 0.3, 0], neck: [0, -0.15, 0], head: [-0.2, -0.45, 0], jaw: [0.25, 0, 0], hips: [0, 0.15, 0, 0, -0.12, 0.2], thighL: [0.35, 0, 0], shinL: [0.35, 0, 0], thighR: [-0.6, 0, 0], shinR: [0.55, 0, 0] },
  { hit: 0.26, tremble: 0.035, recover: 0.6, strikeExtra: (P, p) => { const o = bump(0.18, 0.5, p) * 0.25; P.r('handR', o); P.r('foreR', -o * 0.5); } },
);
export const skeleton = {
  id: 'skeleton', height: 1.8, radius: 0.4, eyeColor: 0x5fd8ff, defaultAttack: 'swing', attackTypes: ['swing', 'thrust'], flutter: 0.035,
  build(rig) {
    const D = skeletonBase(rig);
    const IRON = { cfn: rustFn(1) }, LEA = [0.62, 0.46, 0.36], CRIM = [0.42, 0.075, 0.06];
    // helm + mail aventail hanging round the back and sides of the skull
    rig.add('head', 'iron', spangenhelm(), { y: 0.118, z: 0.006 }, IRON);
    rig.add('head', 'mail', coatSkirt(0.118, 0.15, 0.15, { seg: 16, rows: 2, gapTop: 1.7, gapBot: 2.1, folds: 7, foldAmp: 0.06, tatter: 0.35, seed: 4 }), { y: 0.135, z: 0.0, sz: 1.08 }, { c: [0.62, 0.5, 0.42], anim: (v) => clamp(-v.y * 5) * 0.5 });
    // torn mail mantle over the shoulders, a mail sleeve on the sword arm
    rig.add('chest', 'mail', robe(0.12, 0.27, 0.21, { seg: 18, rows: 3, folds: 7, foldAmp: 0.08, tatter: 0.55, seed: 6 }), { y: D.chest + 0.05, z: -0.005, sz: 0.82 }, { c: [0.6, 0.48, 0.4], anim: (v) => clamp(-v.y * 4) * 0.4 });
    rig.add('armR', 'mail', robe(0.046, 0.052, 0.16, { seg: 9, rows: 1, folds: 4, foldAmp: 0.06, tatter: 0.5, seed: 3 }), { y: 0.03 }, { c: [0.6, 0.48, 0.4] });
    // crimson surcoat remnant: one torn strip hanging from the left shoulder over the ribs
    rig.add('chest', 'cloth', panel(0.11, 0.6, { ws: 2, hs: 6, tatter: 0.5, seed: 7, curve: 0.02, taperBot: 0.7 }), { x: 0.065, y: D.chest - 0.01, z: 0.125, rz: 0.12, rx: 0.06 }, {
      cfn: ragFn(CRIM, -0.6, 2), anim: (v) => clamp(-v.y / 0.6) * 1.1,
      skin: chainSkin([['hips', -D.spine - 0.4], ['spine', -D.spine * 0.5], ['chest', 0.0]], (v) => v.y),
    });
    // belt with a rusty buckle, pouch, crimson loin flaps front and back
    rig.add('hips', 'leather', xf(G.cyl(0.146, 0.14, 0.045, 14, true), { sz: 0.76 }), { y: 0.035 }, { c: LEA });
    rig.add('hips', 'iron', mergeRaw([xf(G.box(0.05, 0.045, 0.012), {}), xf(G.box(0.008, 0.045, 0.016), { x: 0.012 })]), { y: 0.035, z: 0.113 }, IRON);
    rig.add('hips', 'leather', mergeRaw([xf(G.box(0.07, 0.08, 0.04), { x: -0.12, y: -0.01, z: 0.07, ry: -0.7 }), xf(G.box(0.075, 0.025, 0.045), { x: -0.12, y: 0.03, z: 0.071, ry: -0.7 })]), {}, { c: [0.5, 0.36, 0.26] });
    rig.add('hips', 'cloth', panel(0.2, 0.42, { ws: 4, hs: 5, tatter: 0.45, seed: 4, curve: 0.05 }), { y: 0.02, z: 0.112 }, { cfn: ragFn(CRIM, -0.42, 5), anim: (v) => -v.y * 1.6 });
    rig.add('hips', 'cloth', panel(0.25, 0.48, { ws: 4, hs: 5, tatter: 0.5, seed: 9, curve: -0.05 }), { y: 0.02, z: -0.1, ry: Math.PI }, { cfn: ragFn([0.34, 0.07, 0.06], -0.48, 8), anim: (v) => -v.y * 1.6 });
    // baldric across the ribcage, front and back
    const bal = tube([[-0.135, D.chest + 0.01, 0.02], [-0.085, D.chest * 0.8, 0.112], [0.0, D.chest * 0.5, 0.124], [0.09, D.chest * 0.18, 0.118], [0.15, -0.02, 0.06]], 0.011, 14, 4);
    const balB = tube([[-0.135, D.chest + 0.01, 0.02], [-0.09, D.chest * 0.8, -0.118], [0.0, D.chest * 0.45, -0.13], [0.15, -0.02, -0.04]], 0.011, 10, 4);
    rig.add('chest', 'leather', mergeRaw([bal, balB]), {}, { c: [0.45, 0.32, 0.24] });
    rig.add('chest', 'iron', xf(G.tor(0.016, 0.005, 3, 8), {}), { x: 0.0, y: D.chest * 0.5, z: 0.13 }, IRON);
    // shield arm: rusty pauldron and a strapped vambrace; sword arm: leather bracer
    rig.add('armL', 'iron', pauldron(0.085, 2), { x: 0.02, y: -0.02, rz: 0.55, sy: 0.75 }, IRON);
    rig.add('armL', 'leather', xf(G.tor(0.052, 0.008, 3, 10), { rx: Math.PI / 2 }), { y: -0.08 }, { c: LEA });
    rig.add('foreL', 'leather', mergeRaw([xf(G.cyl(0.036, 0.031, 0.14, 8, true), { y: -0.17 }), xf(G.tor(0.037, 0.006, 3, 8), { rx: Math.PI / 2, y: -0.12 }), xf(G.tor(0.033, 0.006, 3, 8), { rx: Math.PI / 2, y: -0.21 })]), {}, { c: LEA });
    rig.add('foreR', 'leather', mergeRaw([xf(G.cyl(0.034, 0.03, 0.12, 8, true), { y: -0.18 }), xf(G.tor(0.035, 0.006, 3, 8), { rx: Math.PI / 2, y: -0.15 })]), {}, { c: [0.42, 0.3, 0.22] });
    // a knee cop on the left, a dented greave on the right shin, rag wraps round the right foot
    rig.add('shinL', 'iron', mergeRaw([xf(G.sph(0.05, 8, 5, 0, TAU, 0, Math.PI * 0.55), { rx: Math.PI / 2 + 0.25, z: 0.03 })]), { y: 0.0 }, IRON);
    rig.add('shinR', 'iron', new THREE.CylinderGeometry(0.046, 0.04, 0.22, 8, 1, true, -Math.PI * 0.55, Math.PI * 1.1), { y: -0.2, z: 0.008 }, IRON);
    rig.add('footR', 'cloth', mergeRaw([xf(G.cyl(0.042, 0.046, 0.035, 8, true), { y: -0.035, z: 0.0, rx: 0.3 }), xf(G.cyl(0.04, 0.042, 0.03, 8, true), { y: -0.05, z: 0.06, rx: 1.3, sx: 1.1, sz: 0.7 })]), {}, { c: [0.32, 0.28, 0.22] });
    skelSword(rig, 'handR', { len: 0.8, seed: 3 });
    skelShield(rig, 'foreL', { x: 0.075, y: -0.14, z: 0, ry: Math.PI / 2 }, { r: 0.3 });
    rig.socket('muzzle', 'handR', 0, -0.07, 0.45);
    return D;
  },
  pose: humanoidPose,
  anim: {
    ...SK_BASE, armSwing: 0.35, knee: 0.85, stride: 0.5, breath: 1.4,
    rest: { armR: [-0.22, 0, -0.06], foreR: [-0.6, 0, 0], handR: [0.5, 0, 0], armL: [-0.3, -0.85, 0.22], foreL: [-1.3, 0, 0] },
    stance: (P) => { P.r('spine', 0.1); P.r('chest', 0.06); P.r('neck', 0.08); P.r('head', -0.14); P.r('shinL', 0.14); P.r('shinR', 0.12); P.r('thighL', -0.09, 0, 0.03); P.r('thighR', -0.05, 0, -0.03); },
    actions: { swing: SK_SWING },
    extra: skExtra,
  },
};

// ------------------------------------------------------- skeletonArcher ----
// A dead bowman: deep ragged hood and a long cloak, quiver on the back, bracers and belt; the bow
// draws to the cheek (string skinned to the nock bone) with the arrow shown only while drawing.
export const skeletonArcher = {
  id: 'skeletonArcher', height: 1.8, radius: 0.4, eyeColor: 0x5fd8ff, defaultAttack: 'shoot', attackTypes: ['shoot', 'swing'], flutter: 0.04,
  build(rig) {
    const D = skeletonBase(rig, { gripL: true, seed: 5 });
    rig.bone('nock', 'handL', 0, -0.06, 0);
    rig.bone('arrow', 'nock', 0, 0, 0);
    const HOOD = [0.2, 0.22, 0.17], CLOAK = [0.15, 0.165, 0.13], LEA = [0.55, 0.4, 0.3];
    // deep hood with a peak, its cowl spilling onto the shoulders
    const h = hood(0.15, 0.22, { open: 0.24, peak: 1.4 });
    rig.add('head', 'cloth', h.shell, { y: 0.1, z: -0.018, rx: -0.08 }, { cfn: ragFn(HOOD, -2, 3) });
    rig.add('head', 'dark', xf(G.sph(0.1, 8, 6), { sz: 0.6 }), { y: 0.17, z: -0.05 });
    rig.add('chest', 'cloth', robe(0.12, 0.27, 0.3, { seg: 18, rows: 3, folds: 7, foldAmp: 0.12, tatter: 0.5, seed: 5 }), { y: D.chest + 0.05, sz: 0.82 }, { cfn: ragFn(HOOD, -0.25, 4), anim: (v) => clamp(-v.y * 3) * 0.7 });
    // long cloak down the back, skinned through the spine so it bends with the body
    const cloak = panel(0.42, 1.05, { ws: 6, hs: 8, tatter: 0.45, seed: 12, curve: 0.1, taperBot: 1.3 });
    rig.add('chest', 'cloth', cloak, { y: D.chest + 0.0, z: -0.14, ry: Math.PI, rx: 0.06 }, {
      cfn: ragFn(CLOAK, -0.9, 6), anim: (v) => clamp(-v.y / 0.95) * 1.5,
      skin: chainSkin([['hips', -D.spine - 0.55], ['spine', -D.spine * 0.5], ['chest', 0.0]], (v) => v.y),
    });
    // belt, a short rag at the front, bracers on both forearms
    rig.add('hips', 'leather', xf(G.cyl(0.146, 0.14, 0.04, 14, true), { sz: 0.76 }), { y: 0.035 }, { c: LEA });
    rig.add('hips', 'cloth', panel(0.18, 0.3, { tatter: 0.5, seed: 2 }), { y: 0.02, z: 0.112 }, { cfn: ragFn([0.26, 0.22, 0.15], -0.3, 7), anim: (v) => -v.y * 1.5 });
    rig.add('hips', 'leather', mergeRaw([xf(G.box(0.065, 0.075, 0.035), { x: 0.12, y: -0.01, z: 0.07, ry: 0.7 })]), {}, { c: [0.48, 0.34, 0.25] });
    for (const S of ['L', 'R']) rig.add('fore' + S, 'leather', mergeRaw([xf(G.cyl(0.036, 0.03, 0.15, 8, true), { y: -0.17 }), xf(G.tor(0.036, 0.006, 3, 8), { rx: Math.PI / 2, y: -0.13 })]), {}, { c: LEA });
    // quiver strap across the ribs and the quiver of arrows on the back
    const qt = { x: -0.06, y: 0.12, z: -0.16, rz: -0.35, rx: 0.15 };
    rig.add('chest', 'leather', mergeRaw([xf(G.cyl(0.055, 0.045, 0.48, 10, false), { y: 0.0 }), xf(G.tor(0.056, 0.008, 4, 12), { y: 0.22, rx: Math.PI / 2 }), xf(G.tor(0.05, 0.007, 4, 12), { y: -0.18, rx: Math.PI / 2 })]), qt, { c: [0.42, 0.27, 0.18] });
    const arrows = [], fl = [];
    for (let i = 0; i < 6; i++) { const a = i * 1.1, r = 0.025; arrows.push(xf(G.cyl(0.004, 0.004, 0.2, 3), { x: Math.cos(a) * r, z: Math.sin(a) * r, y: 0.32 })); fl.push(xf(G.box(0.003, 0.06, 0.025), { x: Math.cos(a) * r, z: Math.sin(a) * r, y: 0.4, ry: a })); }
    rig.add('chest', 'wood', mergeRaw(arrows), qt, { c: [0.8, 0.65, 0.45] });
    rig.add('chest', 'cloth', mergeRaw(fl), qt, { c: [0.55, 0.12, 0.08] });
    rig.add('chest', 'leather', mergeRaw([tube([[0.13, D.chest + 0.02, 0.03], [0.07, D.chest * 0.75, 0.115], [-0.02, D.chest * 0.42, 0.125], [-0.11, D.chest * 0.12, 0.105], [-0.15, -0.02, 0.04]], 0.01, 12, 4), tube([[0.13, D.chest + 0.02, 0.03], [0.08, D.chest * 0.75, -0.12], [-0.15, -0.02, -0.06]], 0.01, 8, 4)]), {}, { c: [0.4, 0.28, 0.2] });
    // bow + nocked arrow (arrow only shown while drawing)
    addBow(rig, 'handL', 'nock', { len: 1.25 });
    rig.add('arrow', 'wood', xf(G.cyl(0.005, 0.005, 0.72, 4), { y: -0.36 }), {}, { c: [0.8, 0.65, 0.45] });
    rig.add('arrow', 'iron', xf(G.cone(0.014, 0.05, 4), { y: -0.74, rx: Math.PI }), {}, { c: STEEL });
    rig.add('arrow', 'cloth', xf(G.box(0.003, 0.07, 0.03), { y: -0.04 }), {}, { c: [0.55, 0.12, 0.08] });
    rig.socket('muzzle', 'nock', 0, -0.72, 0);
    return D;
  },
  pose: humanoidPose,
  anim: {
    ...SK_BASE, armSwing: 0.3, knee: 0.85, stride: 0.5,
    rest: { armL: [-0.35, 0, 0.05], foreL: [-0.5, 0, 0], handL: [0.3, 0, 0], armR: [-0.1, 0, -0.05], foreR: [-0.3, 0, 0] },
    stance: (P) => { P.r('spine', 0.08); P.r('head', -0.1); P.r('shinL', 0.12); P.r('shinR', 0.12); P.r('thighL', -0.07); P.r('thighR', -0.07); },
    actions: {
      shoot: (P, ph, p, m) => {
        const AIM = { armL: [-1.5, 0.75, 0], foreL: [0, 0, 0], handL: [0, 0, 0], armR: [-1.5, 0.55, 0], foreR: [-2.7, 0, 0], handR: [0, 0, 0], chest: [0, -0.75, 0], spine: [0, -0.15, 0], head: [0.05, 0.8, 0], neck: [0, 0.1, 0], thighL: [-0.15, 0, 0.1], thighR: [0.1, 0, -0.1], jaw: [0.15, 0, 0] };
        if (ph === 'windup') {
          const d = smooth(0.15, 0.85, p);
          P.blend({ armL: [-0.9, 0.4, 0], foreL: [-0.3, 0, 0], armR: [-0.9, 0.5, 0], foreR: [-1.6, 0, 0], chest: [0, -0.4, 0], head: [0, 0.4, 0] }, AIM, smooth(0, 0.4, p));
          // lean back into the draw, the string arm creaking as it holds
          P.r('spine', -0.08 * d); P.r('chest', -0.05 * d);
          P.p('nock', 0, 0.42 * d, 0);
          P.s('arrow', 1);
          P.r('armL', Math.sin(m.time * 33) * 0.012 * d); P.r('armR', 0, Math.sin(m.time * 29) * 0.01 * d, 0);
          return 12;
        }
        const rel = smooth(0, 0.1, p), back = 1 - smooth(0.5, 1, p);
        P.apply(AIM, back);
        P.r('foreR', 1.0 * rel * back); P.r('armR', 0, 0.4 * rel * back, 0);
        P.r('chest', 0.08 * bump(0, 0.3, p)); P.r('armL', 0.12 * bump(0, 0.25, p));
        P.p('nock', 0, 0.42 * (1 - rel), 0);
        P.s('arrow', rel > 0.5 ? 0.001 : 1);
        return 30;
      },
    },
    extra: (P, m, s, dt, k) => { if (!(k.action && s.attackType === 'shoot')) P.s('arrow', 0.001); skExtra(P, m, s, dt, k); },
  },
};

// ----------------------------------------------------------------- wraith ----
// A hanged prisoner's ghost: a towering peaked hood over a void with two cold eyes, a long shroud
// that thins into trailing wisps, bone forearms reaching out of ragged sleeves, the broken shackle
// still on one wrist. Eyes and wisps flare as it winds up.
const WRAITH_EYE = 0x9ff4ff;
const WR_CLAW = act2(
  { armR: [-2.6, 0, -0.75], armL: [-2.4, 0, 0.75], foreR: [-0.8, 0, 0], foreL: [-0.8, 0, 0], handR: [-0.5, 0, 0], handL: [-0.5, 0, 0], chest: [-0.4, 0, 0], spine: [-0.18, 0, 0], neck: [-0.1, 0, 0], head: [-0.25, 0, 0], base: [0, 0, 0, 0, 0.18, -0.15] },
  { armR: [-0.75, 0, 0.55], armL: [-1.15, 0, -0.45], foreR: [-0.2, 0, 0], foreL: [-0.3, 0, 0], handR: [0.45, 0, 0], handL: [0.45, 0, 0], chest: [0.5, 0, 0], spine: [0.32, 0, 0], head: [0.25, 0, 0], base: [0, 0, 0, 0, -0.15, 0.45] },
  { hit: 0.25, tremble: 0.03 },
);
const WR_CAST = act2(
  { armR: [-0.4, 0, -0.5], foreR: [-1.6, 0, 0], armL: [-0.4, 0, 0.5], foreL: [-1.6, 0, 0], chest: [-0.25, 0, 0], head: [-0.3, 0, 0], base: [0, 0, 0, 0, 0.12, 0] },
  { armR: [-1.65, 0, 0.1], foreR: [0, 0, 0], handR: [-0.5, 0, 0], armL: [-0.6, 0, 0.4], foreL: [-0.5, 0, 0], chest: [0.25, 0, 0], head: [0.12, 0, 0] },
  { hit: 0.25, recover: 0.85 },
);
export const wraith = {
  id: 'wraith', height: 2.2, radius: 0.45, flying: true, eyeColor: WRAITH_EYE, magicColor: 0x7fe8ff, defaultAttack: 'claw', attackTypes: ['claw', 'cast'], flutter: 0.07, orbSize: 0.07,
  build(rig) {
    const D = humanSkeleton(rig, { thigh: 0.42, shin: 0.4, spine: 0.18, chest: 0.32, neck: 0.1, shoulderW: 0.2, upper: 0.32, fore: 0.3 });
    const GH = [0.3, 0.4, 0.44];
    const fade = (c, y0, y1) => (v) => { const k = 1 - smooth(y0, y1, -v.y) * 0.6; return [c[0] * k, c[1] * k, c[2] * k]; };
    // main shroud: hangs from the shoulders down past the (missing) legs, skinned chest > spine > hips
    const len = 1.45;
    const sh = robe(0.2, 0.46, len, { seg: 24, rows: 10, folds: 9, foldAmp: 0.18, tatter: 0.6, seed: 7 });
    deform(sh, (v) => { v.z *= 0.85; if (v.y < -0.6) v.z -= (-v.y - 0.6) * 0.4; }, true);
    const topY = 0.05 + D.spine + D.chest + 0.02; // in hips space
    rig.add('hips', 'ghost', sh, { y: topY }, {
      cfn: fade(GH, 0.6, len),
      anim: (v) => clamp((-v.y - 0.15) / len) ** 1.3 * 2.4,
      skin: chainSkin([['hips', topY - len * 0.9], ['spine', 0.15], ['chest', topY - 0.25]], (v) => v.y + topY),
    });
    // inner dark layer so the shroud never looks hollow
    rig.add('chest', 'dark', xf(G.cyl(0.16, 0.22, 0.5, 10, false), { y: 0.1 }), {}, {});
    // ragged mantle over shoulders, a second torn layer under it
    rig.add('chest', 'ghost', robe(0.12, 0.36, 0.46, { seg: 18, rows: 4, folds: 7, foldAmp: 0.2, tatter: 0.6, seed: 3 }), { y: D.chest + 0.06, sz: 0.85 }, { c: [0.26, 0.34, 0.38], anim: (v) => clamp(-v.y * 2.5) * 1.6 });
    rig.add('chest', 'ghost', robe(0.16, 0.42, 0.72, { seg: 16, rows: 4, folds: 6, foldAmp: 0.2, tatter: 0.7, seed: 12 }), { y: D.chest - 0.05, sz: 0.85 }, { cfn: fade([0.2, 0.27, 0.3], 0.2, 0.75), anim: (v) => clamp(-v.y * 2) * 1.8 });
    // towering peaked hood with a void and piercing eyes
    const h = hood(0.17, 0.2, { open: 0.24, peak: 2.4 });
    rig.add('head', 'ghost', h.shell, { y: 0.1, z: -0.015 }, { c: [0.22, 0.28, 0.32] });
    rig.add('head', 'dark', xf(G.sph(0.13, 12, 10), { sz: 0.9 }), { y: 0.09, z: -0.005 });
    rig.pair('head', 'head', 'glow', xf(G.sph(0.017, 8, 6), { sx: 1.7, sy: 0.55 }), { x: 0.042, y: 0.1, z: 0.11, rz: -0.28 }, { c: HDR(WRAITH_EYE, 9) });
    rig.add('head', 'spirit', G.sph(0.06, 10, 8), { y: 0.1, z: 0.08, sx: 1.8, sy: 0.7, sz: 0.4 }, { c: HDR(WRAITH_EYE, 0.28) });
    // sleeves and skeletal hands
    for (const S of ['L', 'R']) {
      const sx = S === 'L' ? 1 : -1;
      rig.add('arm' + S, 'ghost', robe(0.07, 0.09, D.upper + 0.03, { seg: 10, rows: 2, folds: 4, tatter: 0, seed: 2 }), { y: 0.02 }, { c: GH });
      rig.add('fore' + S, 'ghost', robe(0.08, 0.16, D.fore * 0.9, { seg: 12, rows: 3, folds: 5, foldAmp: 0.18, tatter: 0.6, seed: 4 + sx }), {}, { c: GH, anim: (v) => clamp(-v.y * 3) * 1.6 });
      rig.add('fore' + S, 'bone', mergeRaw([xf(thinBone(D.fore * 0.75, 0.011, 0.016, 0.016), { y: -D.fore * 0.32, x: 0.008 }), xf(thinBone(D.fore * 0.72, 0.01, 0.014, 0.017), { y: -D.fore * 0.33, x: -0.012 })]), {}, { cfn: boneShade([1.05, 1.1, 1.15], 4) });
      addBoneHand(rig, 'hand' + S, sx, { mat: 'bone', c: [1.0, 1.05, 1.1], s: 1.4, fingerLen: 1.25, curl: 0.45 });
      rig.add('hand' + S, 'bone', mergeRaw([0, 1, 2, 3].map((i) => xf(G.cone(0.006, 0.06, 3), { x: (i - 1.5) * 0.018, y: -0.135, z: 0.02, rx: Math.PI - 0.6 }))), {}, { c: [0.5, 0.52, 0.55] });
    }
    // spectral wisps trailing below
    const wisps = [];
    const R = rng(9);
    for (let i = 0; i < 8; i++) { const a = (i / 8) * TAU; wisps.push(tube([[Math.sin(a) * 0.3, 0, Math.cos(a) * 0.25], [Math.sin(a) * 0.34, -0.22, Math.cos(a) * 0.27 - 0.12], [Math.sin(a + 0.4) * 0.25, -0.5 - R() * 0.18, Math.cos(a) * 0.2 - 0.34]], (u) => 0.04 * (1 - u), 7, 4)); }
    rig.add('hips', 'spirit', mergeRaw(wisps), { y: -0.32 }, { c: HDR(0x7fe8ff, 0.08), anim: (v) => clamp(-v.y * 2) * 1.8 });
    // a broken chain shackle on one wrist
    rig.add('foreR', 'iron', mergeRaw([xf(G.tor(0.05, 0.012, 4, 10), { rx: Math.PI / 2, y: -0.22 }), ...[0, 1, 2, 3].map((i) => xf(G.tor(0.022, 0.007, 3, 6), { y: -0.27 - i * 0.035, ry: (i % 2) * 1.57, x: 0.04 }))]), {}, { c: DARKSTEEL, anim: (v) => clamp((-v.y - 0.25) * 6) * 0.6 });
    rig.socket('muzzle', 'handR', 0, -0.1, 0.05);
    return D;
  },
  pose: humanoidPose,
  anim: {
    gait: 'float', hover: 0.42, death: 'dissipate', spawn: 'materialize', caster: false, look: 0.6,
    rest: { armL: [-0.35, 0, 0.15], foreL: [-0.6, 0, 0], armR: [-0.35, 0, -0.15], foreR: [-0.6, 0, 0], handL: [0.3, 0, 0], handR: [0.3, 0, 0] },
    stance: (P, m) => { P.apply({ spine: [0.15, 0, 0], chest: [0.12, 0, 0], neck: [-0.05, 0, 0], head: [-0.05, 0, 0] }); P.r('hips', Math.sin(m.time * 0.8) * 0.04, 0, Math.sin(m.time * 0.6) * 0.05); },
    stagger: { spine: [-0.35, 0.15, 0.1], chest: [-0.3, 0.2, 0], head: [-0.4, -0.3, 0.2], armL: [0.4, 0, 0.8], armR: [0.4, 0, -0.8], foreL: [-0.4, 0, 0], foreR: [-0.4, 0, 0], base: [0, 0, 0, 0, 0.1, -0.2] },
    actions: { claw: WR_CLAW, swing: WR_CLAW, cast: WR_CAST },
    extra: (P, m, s, dt, k) => {
      const an = s.anim;
      m.U.uFlutterSpeed.value = an === 'windup' ? 2.6 : 1.6;
      // the eyes flare through a wind-up; fingers curl and uncurl as it drifts
      glowLevel(m, an === 'windup' ? 1 + 0.9 * smooth(0, 1, s.progress) : an === 'death' ? 1 - s.progress * 0.8 : 1);
      if (!k.action && an !== 'death') { P.r('handL', Math.sin(m.time * 1.7) * 0.25); P.r('handR', Math.sin(m.time * 1.5 + 2) * 0.25); P.r('head', 0, 0, Math.sin(m.time * 0.43) * 0.12); }
    },
  },
};

// ----------------------------------------------------------------- jailer ----
// The gaoler: a huge, pot-bellied brute in an iron bucket-mask and a leather apron, ring of keys
// and shackles at the belt, a chain over one shoulder. His shield is a torn-off cell door (bars you
// can see him through) and he swings a spiked ball on a chain.
// cell door in door space: width along X, height along Y, face toward +Z
function cellDoor(rig, bone, t, w = 0.64, h = 1.0) {
  const IR = { cfn: rustFn(5, 0.9) };
  const fr = [xf(G.box(w + 0.06, 0.06, 0.06), { y: h / 2 }), xf(G.box(w + 0.06, 0.06, 0.06), { y: -h / 2 }), xf(G.box(0.06, h, 0.06), { x: w / 2 }), xf(G.box(0.06, h, 0.06), { x: -w / 2 })];
  for (let i = 0; i < 5; i++) fr.push(xf(G.cyl(0.017, 0.017, h, 6, true), { x: (i - 2) * w / 5.4 }));
  for (const y of [-h * 0.24, h * 0.24]) fr.push(xf(G.box(w + 0.02, 0.055, 0.03), { y, z: 0.028 }));
  // hinge knuckles torn off on one side, spikes along the top, a heavy lock box
  fr.push(xf(G.cyl(0.03, 0.03, 0.1, 6), { x: -w / 2 - 0.035, y: h * 0.32 }), xf(G.cyl(0.03, 0.03, 0.1, 6), { x: -w / 2 - 0.035, y: -h * 0.32 }));
  for (let i = 0; i < 5; i++) fr.push(xf(G.cone(0.022, 0.09, 4), { x: (i - 2) * w / 5.4, y: h / 2 + 0.07 }));
  fr.push(xf(G.box(0.15, 0.17, 0.07), { x: w * 0.22, y: 0.02, z: 0.045 }));
  rig.add(bone, 'iron', mergeRaw(fr), t, IR);
  rig.add(bone, 'iron', rivets([-1, -0.5, 0, 0.5, 1].flatMap((x) => [[x * w * 0.44, -h * 0.24, 0.047], [x * w * 0.44, h * 0.24, 0.047]]), 0.012), t, { c: [1.6, 1.15, 0.85] });
  rig.add(bone, 'dark', mergeRaw([xf(G.cyl(0.012, 0.012, 0.02, 6), { rx: Math.PI / 2, x: w * 0.22, y: 0.04, z: 0.08 }), xf(G.box(0.01, 0.035, 0.02), { x: w * 0.22, y: 0.012, z: 0.08 })]), t);
}
const JL_SKIN = [0.42, 0.3, 0.26];
const jlSkin = (v) => {
  const n = vnoise(v.x * 6 + 4, v.y * 6, v.z * 6, 51), d = vnoise(v.x * 24, v.y * 24, v.z * 24, 8), k = 0.8 + d * 0.32;
  if (n > 0.7) return [0.3 * k, 0.2 * k, 0.22 * k]; // bruising, filth
  return [JL_SKIN[0] * k, JL_SKIN[1] * k, JL_SKIN[2] * k];
};
// overhead: the ball whirls above the head while he rears back behind the door, then everything slams down
const JL_SLAM = act2(
  { armR: [-2.75, 0.2, -0.25], foreR: [-0.55, 0, 0], handR: [0.2, 0, 0], armL: [-0.55, -0.7, 0.35], foreL: [-1.25, 0, 0], chest: [-0.28, 0.12, 0], spine: [-0.18, 0, 0], neck: [0.1, 0, 0], head: [0.15, 0, 0], hips: [0, 0, 0, 0, -0.06, -0.1], thighL: [-0.45, 0, 0.1], shinL: [0.35, 0, 0], thighR: [0.2, 0, -0.1], shinR: [0.25, 0, 0] },
  { armR: [-0.55, -0.2, 0.3], foreR: [-0.2, 0, 0], handR: [0.8, 0, 0], armL: [-0.15, -0.5, 0.3], foreL: [-0.8, 0, 0], chest: [0.5, 0, 0], spine: [0.38, 0, 0], neck: [-0.25, 0, 0], head: [-0.3, 0, 0], hips: [0, 0, 0, 0, -0.24, 0.18], thighL: [-0.95, 0, 0.1], shinL: [1.05, 0, 0], thighR: [0.15, 0, -0.1], shinR: [0.65, 0, 0] },
  { hit: 0.26, tremble: 0.035 },
);
// flail swing: wound back low and to the right with the ball circling, then whipped across
const JL_SWING = act2(
  { armR: [-1.1, 0.55, -1.0], foreR: [-0.7, 0, 0], handR: [0.3, 0, 0], armL: [-0.6, -0.85, 0.3], foreL: [-1.3, 0, 0], chest: [0, -0.7, 0], spine: [0.05, -0.3, 0], head: [0, 0.75, 0], hips: [0, -0.2, 0, 0, -0.09, -0.05], thighL: [-0.4, 0, 0.1], shinL: [0.45, 0, 0], thighR: [0.2, 0, -0.1], shinR: [0.4, 0, 0] },
  { armR: [-1.4, -0.5, 0.7], foreR: [-0.2, 0, 0], handR: [0.5, 0, 0], armL: [-0.3, -0.6, 0.3], foreL: [-1.1, 0, 0], chest: [0.15, 0.75, 0], spine: [0.12, 0.3, 0], head: [-0.1, -0.7, 0], hips: [0, 0.25, 0, 0, -0.12, 0.2], thighR: [-0.6, 0, -0.1], shinR: [0.55, 0, 0], thighL: [0.3, 0, 0.1] },
  { hit: 0.25, tremble: 0.03 },
);
export const jailer = {
  id: 'jailer', height: 2.4, radius: 0.7, eyeColor: 0xff8a3a, defaultAttack: 'slam', attackTypes: ['slam', 'swing', 'bash'], flutter: 0.03,
  build(rig) {
    const D = humanSkeleton(rig, { thigh: 0.52, shin: 0.5, ankle: 0.08, hipW: 0.17, spine: 0.25, chest: 0.45, neck: 0.08, shoulderW: 0.36, shoulderDrop: 0.08, upper: 0.42, fore: 0.4 });
    rig.bone('flail', 'handR', 0, -0.07, 0.55);
    addFleshBody(rig, D, { c: JL_SKIN, cfn: jlSkin, limbSeg: 10, muscle: 2.05, belly: 0.15, bellyY: 0.15, depth: 1.25, seed: 21, torsoW: 1.14, hunch: 0.05, veins: true, veinC: [0.36, 0.24, 0.24], grip: { R: true, L: true } });
    const LEA = [0.62, 0.45, 0.33];
    // leather apron, braces and belt
    rig.add('chest', 'leather', deform(panel(0.56, 1.2, { ws: 6, hs: 8, tatter: 0.1, seed: 3, curve: 0.24, taperBot: 0.85 }), (v) => { v.z += clamp(-v.y, 0, 0.5) * 0.17; }), { y: D.chest * 0.78, z: 0.29 }, {
      cfn: (v) => { const n = vnoise(v.x * 7, v.y * 6, 1, 23), k = 0.75 + 0.35 * vnoise(v.x * 25, v.y * 25, 0, 2), b = smooth(0.58, 0.78, n); return [lerp(0.78, 0.4, b) * k, lerp(0.58, 0.12, b) * k, lerp(0.44, 0.1, b) * k]; },
      skin: chainSkin([['thighL', -0.95], ['hips', -0.55], ['chest', 0.0]], (v) => v.y), anim: (v) => clamp((-v.y - 0.6) * 0.8) * 0.5,
    });
    rig.add('chest', 'leather', mergeRaw([xf(G.box(0.06, 0.5, 0.022), { x: 0.17, y: D.chest * 0.78, z: 0.25, rx: -0.55, rz: 0.1 }), xf(G.box(0.06, 0.5, 0.022), { x: -0.17, y: D.chest * 0.78, z: 0.25, rx: -0.55, rz: -0.1 })]), {}, { c: [0.45, 0.3, 0.2] });
    rig.add('hips', 'leather', xf(G.cyl(0.31, 0.31, 0.09, 18, true), { sz: 0.86 }), { y: 0.02 }, { c: [0.4, 0.28, 0.18] });
    rig.add('hips', 'iron', G.box(0.11, 0.1, 0.03), { y: 0.02, z: 0.275 }, { cfn: rustFn(2) });
    // heavy leather shoulder mantle under the mask
    rig.add('chest', 'leather', robe(0.17, 0.44, 0.26, { seg: 18, rows: 3, folds: 8, foldAmp: 0.09, tatter: 0.2, seed: 8 }), { y: D.chest + 0.06, sz: 0.85 }, { c: [0.32, 0.24, 0.18], anim: (v) => clamp(-v.y * 3) * 0.3 });
    // key ring + shackles on the belt, a chain slung over the left shoulder
    rig.add('hips', 'iron', mergeRaw([xf(G.tor(0.06, 0.009, 4, 12), { x: 0.26, y: -0.07, z: 0.13, ry: 1.0 }), ...[0, 1, 2, 3, 4].map((i) => xf(G.box(0.014, 0.1, 0.005), { x: 0.26 + (i - 2) * 0.02, y: -0.14, z: 0.14, rz: (i - 2) * 0.2 })), xf(G.tor(0.065, 0.013, 4, 12), { x: -0.27, y: -0.09, z: 0.06, ry: 1.3 }), xf(G.tor(0.065, 0.013, 4, 12), { x: -0.29, y: -0.17, z: 0.04, ry: 1.0, rx: 0.4 })]), {}, { cfn: rustFn(4) });
    const ch = [];
    for (let i = 0; i < 18; i++) { const u = i / 17, a = lerp(-0.5, 1.6, u); ch.push(xf(G.tor(0.032, 0.009, 3, 6), { x: lerp(0.24, -0.26, u), y: D.chest * 0.98 - Math.sin(u * Math.PI) * D.chest * 0.62, z: 0.25 * Math.cos(a * 0.7) * (u < 0.5 ? 1 : 1), ry: (i % 2) * Math.PI / 2 + 0.6, rz: 0.9 })); }
    rig.add('chest', 'iron', mergeRaw(ch), {}, { c: [1.3, 1.05, 0.9] });
    // trousers & boots, bracers
    for (const S of ['L', 'R']) {
      rig.add('thigh' + S, 'cloth', taper(0.16, 0.12, D.thigh + 0.05, 10, 2), { y: 0.03 }, { c: [0.28, 0.24, 0.2] });
      rig.add('shin' + S, 'leather', taper(0.11, 0.1, D.shin * 0.75, 10, 2), { y: -D.shin * 0.25 }, { c: [0.35, 0.24, 0.16] });
      rig.add('shin' + S, 'leather', shell([[0.125, -0.04], [0.13, 0.03]], 0.008, 10), { y: -D.shin * 0.25 }, { c: [0.3, 0.2, 0.14] });
      rig.add('foot' + S, 'leather', xf(G.sph(0.075, 10, 6), { sx: 1.05, sy: 0.6, sz: 1.9 }), { y: -0.04, z: 0.06 }, { c: [0.3, 0.2, 0.14] });
      rig.add('fore' + S, 'leather', mergeRaw([xf(G.cyl(0.085, 0.075, 0.22, 10), { y: -0.27 }), ...[-0.2, -0.32].map((y) => xf(G.tor(0.087, 0.01, 3, 10), { rx: Math.PI / 2, y }))]), {}, { c: [0.35, 0.24, 0.16] });
    }
    // iron mask helm: bucket with eye slits, breathing holes and rivets
    const helm = shell([[0.14, -0.02], [0.145, 0.12], [0.14, 0.22], [0.105, 0.27], [0.001, 0.285]], 0.012, 16);
    deform(helm, (v) => { v.z *= 1.08; if (v.z > 0) v.z += Math.max(0, 1 - Math.abs(v.x) / 0.14) * 0.02; });
    rig.add('head', 'iron', helm, { y: 0.0 }, { cfn: rustFn(6, 0.7) });
    rig.pair('head', 'head', 'dark', G.box(0.06, 0.016, 0.02), { x: 0.045, y: 0.15, z: 0.15 });
    rig.pair('head', 'head', 'glow', G.box(0.03, 0.008, 0.01), { x: 0.045, y: 0.15, z: 0.155 }, { c: HDR(0xff8a3a, 4.5) });
    rig.add('head', 'dark', mergeRaw([0, 1, 2, 3, 4, 5].map((i) => xf(G.cyl(0.006, 0.006, 0.02, 5), { x: (i % 3 - 1) * 0.025, y: 0.06 + Math.floor(i / 3) * 0.025, z: 0.16, rx: Math.PI / 2 }))));
    rig.add('head', 'iron', mergeRaw([xf(G.tor(0.147, 0.011, 4, 20), { rx: Math.PI / 2, y: 0.0, sy: 1.08 }), xf(G.box(0.022, 0.27, 0.02), { y: 0.13, z: 0.16 }), xf(G.tor(0.147, 0.011, 4, 20), { rx: Math.PI / 2, y: 0.2, sy: 1.08 })]), {}, { cfn: rustFn(3) });
    rig.add('head', 'iron', rivets(Array.from({ length: 10 }, (_, i) => { const a = (i / 10) * TAU; return [Math.sin(a) * 0.155, 0.1, Math.cos(a) * 0.155 * 1.08]; }), 0.011), {}, { c: [2.0, 1.2, 0.8] });
    // the cell-door shield on the left forearm, the flail on the right
    cellDoor(rig, 'foreL', { x: 0.08, y: -0.2, z: 0, ry: Math.PI / 2, rx: Math.PI / 2 });
    rig.add('handR', 'wood', xf(G.cyl(0.03, 0.035, 0.6, 8), { rx: Math.PI / 2, z: 0.22 }), { y: -0.07 }, { c: [0.6, 0.42, 0.3] });
    rig.add('handR', 'iron', mergeRaw([xf(G.cyl(0.042, 0.042, 0.07, 8), { rx: Math.PI / 2, z: 0.52 }), xf(G.tor(0.025, 0.008, 4, 8), { z: 0.56, ry: Math.PI / 2 })]), { y: -0.07 }, { cfn: rustFn(1) });
    const links = mergeRaw(Array.from({ length: 6 }, (_, i) => xf(G.tor(0.026, 0.009, 4, 8), { y: -0.035 - i * 0.047, ry: (i % 2) * Math.PI / 2, sy: 1.25 })));
    rig.add('flail', 'iron', links, {}, { c: [1.2, 1.05, 1.0] });
    const ball = mergeRaw([G.sph(0.13, 12, 9), ...Array.from({ length: 14 }, (_, i) => { const a = i * 2.4, b = Math.acos(1 - 2 * (i + 0.5) / 14); const d = new THREE.Vector3(Math.sin(b) * Math.cos(a), Math.cos(b), Math.sin(b) * Math.sin(a)); const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d); const e = new THREE.Euler().setFromQuaternion(q); return xf(G.cone(0.032, 0.1, 4), { x: d.x * 0.15, y: d.y * 0.15, z: d.z * 0.15, rx: e.x, ry: e.y, rz: e.z }); })]);
    rig.add('flail', 'iron', ball, { y: -0.4 }, { cfn: rustFn(9, 1.1) });
    rig.socket('muzzle', 'flail', 0, -0.4, 0);
    return D;
  },
  pose: humanoidPose,
  anim: {
    death: 'fall', spawn: 'rise', gait: 'plod', armSwing: 0.2, armOut: 0.28, stride: 0.42, knee: 0.7, breath: 1.2,
    // a corpse lays its weapon flat instead of standing it 1 m+ out of the body or the floor (scripts/grip.js)
    deathGrip: [{ foreR: [-1.6, 0, 0], handR: [-0.4, 0, -1.2], armL: [-1.2, 0, 0.4], foreL: [-0.8, 0, 0] }, { handR: [-1.6, 0, 0.8], armL: [1.6, 0, 0.8], foreL: [-0.8, 0, 0] }],
    rest: { armR: [-0.3, 0, -0.05], foreR: [-0.9, 0, 0], handR: [0.5, 0, 0], armL: [-0.32, -0.9, 0.28], foreL: [-1.3, 0, 0] },
    stance: (P) => P.apply({ spine: [0.08, 0, 0], chest: [0.1, 0, 0], neck: [-0.1, 0, 0], thighL: [-0.1, 0, 0.09], thighR: [-0.1, 0, -0.09], shinL: [0.18, 0, 0], shinR: [0.18, 0, 0], hips: [0, 0, 0, 0, -0.03, 0] }),
    stagger: { spine: [-0.18, 0.1, 0.05], chest: [-0.16, 0.15, 0], head: [-0.3, -0.2, 0.12], armR: [0.3, 0, -0.5], foreR: [-0.5, 0, 0], armL: [0.1, -0.6, 0.4], hips: [0, 0, 0, 0, -0.05, -0.1], thighL: [-0.3, 0, 0], shinL: [0.4, 0, 0] },
    actions: {
      slam: JL_SLAM, swing: JL_SWING,
      bash: act2(
        { armL: [-0.1, -1.2, 0.5], foreL: [-1.5, 0, 0], chest: [-0.1, 0.5, 0], spine: [0, 0.2, 0], hips: [0, 0, 0, 0, -0.05, -0.1], thighR: [-0.4, 0, 0], shinR: [0.6, 0, 0] },
        { armL: [-0.9, -0.9, 0.2], foreL: [-1.0, 0, 0], chest: [0.2, -0.3, 0], spine: [0.15, -0.1, 0], hips: [0, 0, 0, 0, -0.08, 0.35], thighL: [-0.7, 0, 0], shinL: [0.6, 0, 0] },
        { hit: 0.22 },
      ),
    },
    extra: (P, m, s, dt, k) => {
      // flail: pendulum lagging the hand; whirls overhead (slam) or at the side (swing) through the wind-up
      const T = m.time, an = s.anim;
      if (k.action && an === 'windup') {
        const sp = 9 + 7 * s.progress;
        if (s.attackType === 'slam') P.r('flail', -1.45 + Math.cos(T * sp) * 0.25, Math.sin(T * sp) * 1.4, Math.sin(T * sp) * 0.4);
        else P.r('flail', -1.2 + Math.cos(T * sp) * 1.0, 0, Math.sin(T * sp) * 1.3);
      } else if (k.action && an === 'attack') P.r('flail', 0.7 * (1 - s.progress) - 0.25, 0, 0);
      else if (an === 'death') P.r('flail', 0.6 * s.progress, 0, 0.4 * s.progress);
      else P.r('flail', Math.sin(T * 2.2) * 0.25 + 0.2 + k.w * Math.sin(k.ph) * 0.45, 0, Math.sin(T * 1.7) * 0.2);
      glowLevel(m, an === 'windup' ? 1 + smooth(0, 1, s.progress) : 1);
      // a heavy breather: shoulders heave, the mask tips with each breath
      P.r('chest', Math.max(0, Math.sin(T * 1.2 + m.seed * 4)) * 0.035, 0, 0); P.r('head', -Math.max(0, Math.sin(T * 1.2 + m.seed * 4)) * 0.05, 0, 0);
      P.r('hips', 0, 0, Math.sin(k.ph) * 0.05 * k.w);
    },
  },
};

// -------------------------------------------------------- executionerGuard ----
export function buildHeadsman(rig, o = {}) {
  const boss = !!o.boss;
  const D = humanSkeleton(rig, { thigh: 0.54, shin: 0.52, ankle: 0.08, hipW: 0.15, spine: 0.24, chest: 0.48, neck: 0.1, shoulderW: 0.32, shoulderDrop: 0.06, upper: 0.42, fore: 0.4, jaw: boss ? [0.04, 0.05] : null });
  const SK = [0.5, 0.38, 0.32];
  const skinC = (v) => {
    const n = vnoise(v.x * 6 + 1, v.y * 6, v.z * 6, 41), d = vnoise(v.x * 25, v.y * 25, v.z * 25, 9);
    const k = 0.82 + d * 0.3;
    if (n > 0.7) return [0.34 * k, 0.24 * k, 0.24 * k]; // bruises / grime
    return [SK[0] * k * (0.95 + n * 0.1), SK[1] * k, SK[2] * k];
  };
  addFleshBody(rig, D, { c: SK, cfn: skinC, muscle: boss ? 1.9 : 1.75, seed: 31, torsoW: 1.08, grip: { R: true, L: true }, belly: boss ? 0.04 : 0, abs: true, veins: true, veinC: [0.42, 0.3, 0.28] });
  // torso surface (hips space) so straps and scars hug the body
  const W = D.shoulderW * 1.08, top = 0.05 + D.spine + D.chest;
  const prof = [[-0.1, 0], [-0.085, W * 0.55], [-0.02, W * 0.66], [0.05 + D.spine * 0.7, W * 0.64], [0.05 + D.spine + D.chest * 0.3, W * 0.68], [0.05 + D.spine + D.chest * 0.66, W * 0.8], [0.05 + D.spine + D.chest * 0.88, W * 0.78], [top + 0.03, W * 0.42]];
  const Rad = (y) => { for (let i = 0; i < prof.length - 1; i++) if (y <= prof[i + 1][0]) { const u = clamp((y - prof[i][0]) / (prof[i + 1][0] - prof[i][0])); return lerp(prof[i][1], prof[i + 1][1], u); } return prof[prof.length - 1][1]; };
  const surf = (x, y, sd = 1, off = 0.014) => { const R = Rad(y); const q = clamp(Math.abs(x) / R, 0, 0.98); return new THREE.Vector3(x, y, sd * (0.66 * R * Math.sqrt(1 - q * q) + off + (sd > 0 ? Math.exp(-((y - (0.05 + D.spine + D.chest * 0.62)) ** 2) / 0.006) * 0.012 : 0))); };
  const torsoSkin = chainSkin([['hips', 0.0], ['spine', 0.05 + D.spine * 0.45], ['chest', 0.05 + D.spine + D.chest * 0.25]], (v) => v.y);
  const ribbon = (pts, w, sd = 1) => {
    const pos = [], idx = [];
    const t = new THREE.Vector3(), n = new THREE.Vector3(), side = new THREE.Vector3();
    pts.forEach((p, i) => {
      t.copy(pts[Math.min(i + 1, pts.length - 1)]).sub(pts[Math.max(i - 1, 0)]).normalize();
      n.set(p.x, 0, p.z).normalize();
      side.crossVectors(t, n).normalize().multiplyScalar(w / 2);
      pos.push(p.x + side.x, p.y + side.y, p.z + side.z, p.x - side.x, p.y - side.y, p.z - side.z);
      if (i) { const a = (i - 1) * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx); g.computeVertexNormals();
    return twoSided(g);
  };
  const strapPath = (x0, x1, sd) => { const pts = []; for (let i = 0; i <= 12; i++) { const u = i / 12; pts.push(surf(lerp(x0, x1, u), lerp(top - 0.02, 0.03, u), sd)); } return pts; };
  // crossed leather harness (front + back) meeting in an iron ring over the sternum
  const straps = [ribbon(strapPath(W * 0.42, -W * 0.62, 1), 0.06), ribbon(strapPath(W * 0.42, -W * 0.62, -1), 0.06), ribbon([surf(W * 0.42, top - 0.02, 1), new THREE.Vector3(W * 0.44, top + 0.05, 0), surf(W * 0.42, top - 0.02, -1)], 0.06)];
  rig.add('hips', 'leather', mergeRaw(straps), {}, { c: [0.32, 0.2, 0.13], skin: torsoSkin });
  const ringP = surf(W * 0.06, 0.05 + D.spine + D.chest * 0.42, 1, 0.022);
  rig.add('hips', 'iron', mergeRaw([xf(G.tor(0.035, 0.009, 5, 14), { x: ringP.x, y: ringP.y, z: ringP.z }), ...[0.25, 0.55, 0.8].map((u) => { const p = strapPath(W * 0.42, -W * 0.62, 1)[Math.round(u * 12)]; return xf(G.cyl(0.009, 0.009, 0.008, 6), { x: p.x, y: p.y, z: p.z + 0.008, rx: Math.PI / 2 }); })]), {}, { c: RUSTY, skin: torsoSkin });
  // stitched scars
  const scarG = [], stitchG = [];
  const scar = (x0, y0, x1, y1, sd = 1) => {
    const pts = []; for (let i = 0; i <= 6; i++) { const u = i / 6; pts.push(surf(lerp(x0, x1, u) + Math.sin(u * 9) * 0.006, lerp(y0, y1, u), sd, 0.004)); }
    scarG.push(tube(pts, 0.0055, 12, 3));
    for (let i = 1; i < 6; i++) { const a = pts[i - 1], b = pts[i + 1]; const d = b.clone().sub(a); stitchG.push(xf(G.box(0.032, 0.004, 0.004), { x: pts[i].x, y: pts[i].y, z: pts[i].z + sd * 0.004, rz: Math.atan2(d.y, d.x) + Math.PI / 2 })); }
  };
  scar(W * 0.5, 0.05 + D.spine + D.chest * 0.75, -W * 0.15, 0.05 + D.spine + D.chest * 0.2);
  scar(-W * 0.45, 0.05 + D.spine * 0.8, -W * 0.1, 0.05 + D.spine * 0.3);
  scar(W * 0.3, 0.05 + D.spine + D.chest * 0.5, W * 0.6, 0.05 + D.spine + D.chest * 0.2, -1);
  scar(-W * 0.4, 0.05 + D.spine + D.chest * 0.8, W * 0.1, 0.05 + D.spine + D.chest * 0.3, -1);
  rig.add('hips', 'skin', mergeRaw(scarG), {}, { c: [0.62, 0.3, 0.28], skin: torsoSkin });
  rig.add('hips', 'leather', mergeRaw(stitchG), {}, { c: [0.12, 0.08, 0.06], skin: torsoSkin });
  // black hood with mantle, eye holes
  rig.add('head', 'cloth', pointedHood(0.13, { lean: 0.8 }), { y: 0.0 }, { c: [0.09, 0.08, 0.08] });
  // short hood cowl over the shoulders, longer at the back so the chest stays bare
  const cowl = robe(0.15, 0.36, 0.26, boss ? { seg: 56, rows: 10, folds: 11, foldAmp: 0.1, tatter: 0.3, seed: 4, pipe: true } : { seg: 18, rows: 3, folds: 7, foldAmp: 0.1, tatter: 0.3, seed: 4 });
  deform(cowl, (v) => { if (v.z > 0) v.y = Math.max(v.y, -0.12 - Math.abs(v.x) * 0.25); else v.y *= 1.4; }, true);
  rig.add('chest', 'cloth', cowl, { y: D.chest + 0.08, sz: 0.85 }, { c: [0.09, 0.08, 0.08], anim: (v) => clamp(-v.y * 2.5) * 0.5 });
  rig.pair('head', 'head', 'dark', xf(G.sph(0.024, 8, 6), { sx: 1.4, sz: 0.4 }), { x: 0.048, y: 0.14, z: 0.137 });
  rig.pair('head', 'head', 'glow', G.sph(0.011, 6, 5), { x: 0.046, y: 0.14, z: 0.14 }, { c: HDR(0xff3a20, boss ? 8 : 6) });
  if (boss) {
    // mouth slit in the hood showing a grim jaw
    rig.add('head', 'dark', G.box(0.06, 0.016, 0.02), { y: 0.06, z: 0.135 });
    rig.add('jaw', 'skin', xf(G.box(0.1, 0.03, 0.08), { z: 0.05 }), {}, { c: SK });
  }
  // belt, kilt, trousers, boots, bracers
  rig.add('hips', 'leather', xf(G.cyl(0.27, 0.27, 0.11, 18, true), { sz: 0.8 }), { y: 0.02 }, { c: [0.22, 0.15, 0.1] });
  rig.add('hips', 'iron', mergeRaw([xf(G.box(0.13, 0.11, 0.03), { y: 0.02, z: 0.23 }), xf(G.tor(0.035, 0.008, 4, 10), { y: 0.02, z: 0.25 })]), {}, { c: RUSTY });
  const kilt = robe(0.27, 0.38, 0.42, boss ? { seg: 60, rows: 12, folds: 9, foldAmp: 0.05, tatter: 0.15, seed: 6, pipe: true } : { seg: 10, rows: 2, folds: 5, foldAmp: 0.04, tatter: 0.15, seed: 6 });
  const kiltO = { anim: (v) => clamp(-v.y * 2) * 0.5, skin: chainSkin([['hips', -0.08], ['thighL', -0.5]], (v) => -v.y) };
  rig.add('hips', 'leather', kilt, { y: -0.02, sz: 0.85 }, { c: [0.16, 0.11, 0.08], ...kiltO });
  if (boss) {
    // (a boss's kilt: a stitched welt along its hem, and a stitched belt)
    const st = embroideryOf('stitch', [0.13, 0.09, 0.065], [0.5, 0.42, 0.3], 0.05);
    const b = robeRing(kilt, 0.8, 0.04, st, { lift: 0.004 });
    rig.add('hips', 'leather', b.geo, { y: -0.02, sz: 0.85 }, { vcol: b.vcol, ...kiltO });
  }
  rig.add('hips', 'iron', rivets(Array.from({ length: 10 }, (_, i) => { const a = (i / 10 - 0.5) * 2.4; return [Math.sin(a) * 0.29, -0.15, Math.cos(a) * 0.25]; }), 0.012), {}, { c: RUSTY });
  for (const S of ['L', 'R']) {
    rig.add('thigh' + S, 'cloth', taper(0.14, 0.105, D.thigh + 0.05, 10, 2), { y: 0.03 }, { c: [0.14, 0.12, 0.11] });
    rig.add('shin' + S, 'leather', taper(0.1, 0.085, D.shin * 0.8, 10, 2), { y: -D.shin * 0.2 }, { c: [0.22, 0.14, 0.1] });
    rig.add('foot' + S, 'leather', xf(G.sph(0.07, 10, 6), { sx: 1.05, sy: 0.6, sz: 1.9 }), { y: -0.04, z: 0.06 }, { c: [0.18, 0.12, 0.09] });
    rig.add('fore' + S, 'leather', G.cyl(0.075, 0.065, 0.22, 10), { y: -0.24 }, { c: [0.22, 0.14, 0.1] });
    rig.add('fore' + S, 'iron', mergeRaw([[0.07, 0.03], [-0.07, 0.03], [0, 0.075]].flatMap(([x, z]) => [-0.17, -0.26].map((y) => xf(G.cone(0.012, boss ? 0.05 : 0.025, 4), { x, y, z, rz: x > 0 ? -1.57 : x < 0 ? 1.57 : 0, rx: x === 0 ? 1.57 : 0 })))), {}, { c: RUSTY });
  }
  if (boss) {
    // iron collar with chains, trophies and hooks on the belt
    rig.add('neck', 'iron', mergeRaw([xf(G.cyl(0.13, 0.15, 0.07, 14, true), {}), xf(G.tor(0.03, 0.009, 4, 8), { z: 0.15, y: -0.02 })]), { y: 0.0 }, { c: DARKSTEEL });
    const links = (n, x0, y0, z0, dx, dy, dz, r = 0.028) => mergeRaw(Array.from({ length: n }, (_, i) => xf(G.tor(r, r * 0.3, 4, 8), { x: x0 + dx * i, y: y0 + dy * i, z: z0 + dz * i, ry: (i % 2) * Math.PI / 2, rx: Math.atan2(dz, dy) })));
    rig.add('chest', 'iron', links(18, 0.05, D.chest + 0.05, 0.16, 0.012, -0.04, 0.004), {}, { c: DARKSTEEL, anim: (v) => clamp((D.chest - v.y) * 1.5) * 0.5 });
    rig.add('hips', 'iron', links(9, 0.25, -0.02, 0.1, 0.0, -0.045, 0.0), {}, { c: DARKSTEEL, anim: (v) => clamp(-v.y * 2) });
    rig.add('hips', 'iron', xf(G.tor(0.05, 0.012, 4, 10, Math.PI * 1.3), { x: 0.25, y: -0.45, z: 0.1 }), {}, { c: RUSTY });
    rig.add('hips', 'bone', mergeRaw([xf(G.sph(0.06, 10, 8), { x: -0.22, y: -0.08, z: 0.16, sz: 1.15 }), xf(G.sph(0.05, 10, 8), { x: -0.3, y: -0.13, z: 0.04, sz: 1.15 })]), {}, { c: [0.85, 0.8, 0.68] });
    rig.add('hips', 'dark', mergeRaw([xf(G.sph(0.015, 5, 4), { x: -0.2, y: -0.07, z: 0.22 }), xf(G.sph(0.015, 5, 4), { x: -0.24, y: -0.07, z: 0.21 })]), {}, {});
    for (const S of ['L', 'R']) rig.add('arm' + S, 'iron', mergeRaw([0, 1, 2].map((i) => xf(G.tor(0.08, 0.014, 4, 12), { y: -0.12 - i * 0.08, rx: Math.PI / 2 + (i % 2) * 0.3 }))), {}, { c: DARKSTEEL });
  }
  // massive executioner's axe
  // (o.noAxe: the caller hangs its own weapon and muzzle)
  if (o.noAxe) return D;
  addAxe(rig, 'handR', { len: boss ? 1.95 : 1.75, grip: 0.18, headW: boss ? 0.62 : 0.5, headH: boss ? 0.78 : 0.62, headMat: 'steel', headC: [0.95, 0.92, 0.9], double: boss });
  if (boss) rig.add('handR', 'cloth', mergeRaw([tube([[0.0, 0.04, 1.2], [0.03, -0.08, 1.15], [0.0, -0.25, 1.18]], 0.012, 6, 3)]), { y: -0.07 }, { c: [0.3, 0.02, 0.02], anim: 1 });
  rig.socket('muzzle', 'handR', 0, -0.07, boss ? 1.4 : 1.2);
  return D;
}
const HEADSMAN_ANIM = {
  death: 'fall', spawn: 'rise', gait: 'plod', armSwing: 0.15, armOut: 0.2, stride: 0.45, knee: 0.75, breath: 1.3,
  rest: { armR: [-0.45, 0, 0.25], foreR: [-0.85, 0, 0], handR: [0.2, 0, 0], armL: [-0.55, 0, -0.35], foreL: [-1.05, 0, 0] },
  stance: (P) => P.apply({ spine: [0.06, 0, 0], chest: [0.05, 0, 0], thighL: [-0.08, 0, 0.06], thighR: [-0.08, 0, -0.06], shinL: [0.14, 0, 0], shinR: [0.14, 0, 0], hips: [0, 0, 0, 0, -0.02, 0] }),
};
export const executionerGuard = {
  id: 'executionerGuard', height: 2.5, radius: 0.65, eyeColor: 0xff3a20, elite: true, defaultAttack: 'slam', attackTypes: ['slam', 'sweep'],
  build(rig) { return buildHeadsman(rig, {}); },
  pose: humanoidPose,
  anim: {
    ...HEADSMAN_ANIM,
    // a corpse lays its weapon flat instead of standing it 1 m+ out of the body or the floor (scripts/grip.js)
    deathGrip: [{ foreR: [-0.8, 0, 0], handR: [-0.8, 0, -1.2] }, { handR: [-1.2, 0, 1.2] }],
    stagger: { spine: [-0.2, 0.1, 0.06], chest: [-0.18, 0.15, 0], head: [-0.3, -0.2, 0.1], armL: [0.2, 0, 0.4], foreL: [-0.5, 0, 0], hips: [0, 0, 0, 0, -0.05, -0.1], thighL: [-0.3, 0, 0], shinL: [0.4, 0, 0] },
    extra: (P, m, s, dt, k) => {
      // eyes burn hotter through the wind-up; a slow, heavy breath heaves the shoulders
      glowLevel(m, s.anim === 'windup' ? 1 + 1.1 * smooth(0, 1, s.progress) : s.anim === 'death' ? 1 - 0.9 * smooth(0.3, 0.9, s.progress) : 1);
      P.r('chest', Math.max(0, Math.sin(m.time * 1.3 + m.seed * 3)) * 0.04 * (k.action ? 0.3 : 1), 0, 0);
    },
  },
};
export { HEADSMAN_ANIM };

// ------------------------------------------------------------ plagueDoctor ----
// The Plague Surgeon: a gaunt prison surgeon in a waxed leather coat, wide hat and
// beaked mask. A smoking censer swings on a chain from the left fist (muzzle socket:
// the toxic flasks and the healing smoke both come out of it); a hooked bonesaw in
// the right.
//
// The censer is a real pendulum. pose() damps the skeleton itself and returns 0, so
// the engine's damping pass only writes bones; the censer is then simulated in model
// space against the hand's FINAL transform for this frame (position-based dynamics:
// gravity, a rigid chain, the floor) and its bone is set so the chain hangs from the
// fist toward the bob. Every swing (walk, throw, stagger, the fall) comes out of the
// hand's motion; the overhead censing whirl pulls the bob around a circle.
const PD_EYE = 0xb8e040, PD_TOXIC = 0x9be03c;
const PD_CHAIN = 0.42; // fist -> censer centre
const PD_FLOOR = 0.075; // censer radius: it rests on the floor at this height

// core.tube() winds its faces inward while its normals point outward (so from outside you see the far
// wall, lit from behind and caught by the rim light). Re-wind every triangle to agree with its normals.
function outward(g) {
  const p = g.getAttribute('position'), n = g.getAttribute('normal');
  if (!g.index) g.setIndex([...Array(p.count).keys()]);
  const idx = g.index.array, a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), s = new THREE.Vector3(), t = new THREE.Vector3();
  for (let k = 0; k < idx.length; k += 3) {
    a.fromBufferAttribute(p, idx[k]); b.fromBufferAttribute(p, idx[k + 1]); c.fromBufferAttribute(p, idx[k + 2]);
    b.sub(a); c.sub(a); b.cross(c);
    s.fromBufferAttribute(n, idx[k]).add(t.fromBufferAttribute(n, idx[k + 1])).add(t.fromBufferAttribute(n, idx[k + 2]));
    if (b.dot(s) < 0) { const q = idx[k + 1]; idx[k + 1] = idx[k + 2]; idx[k + 2] = q; }
  }
  g.index.needsUpdate = true;
  return g;
}
const tubeO = (...a) => outward(tube(...a));
// inner face of a single-sided sheet: reversed winding, flipped normals, pushed in by d (own colour, no z-fight)
function lining(g, d = 0.004) {
  const s = g.index ? g.toNonIndexed() : g.clone();
  const p = s.getAttribute('position'), n = s.getAttribute('normal');
  const pos = new Float32Array(p.count * 3), nrm = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i += 3) for (let k = 0; k < 3; k++) {
    const src = i + (2 - k), dst = (i + k) * 3;
    pos[dst] = p.getX(src) - n.getX(src) * d; pos[dst + 1] = p.getY(src) - n.getY(src) * d; pos[dst + 2] = p.getZ(src) - n.getZ(src) * d;
    nrm[dst] = -n.getX(src); nrm[dst + 1] = -n.getY(src); nrm[dst + 2] = -n.getZ(src);
  }
  const o = new THREE.BufferGeometry();
  o.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  o.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  return o;
}

// waxed, stained coat leather / pale waxed mask leather / blackened hat leather (on the leather surface)
const PD_COAT = [0.6, 0.55, 0.5], PD_MASK = [2.3, 2.05, 1.6], PD_HAT = [0.13, 0.12, 0.12], PD_GLOVE = [0.42, 0.36, 0.33];
const PD_BRASS = [0.78, 0.62, 0.42], PD_CLOTH = [0.16, 0.15, 0.14];
function coatStain(v) {
  const n = vnoise(v.x * 7 + 3, v.y * 5, v.z * 7, 61), d = vnoise(v.x * 19, v.y * 19, v.z * 19, 7);
  const k = 0.82 + d * 0.3;
  let c0 = PD_COAT[0] * k, c1 = PD_COAT[1] * k, c2 = PD_COAT[2] * k;
  if (n > 0.66) { const s = smooth(0.66, 0.8, n); c0 *= 1 - s * 0.35; c1 *= 1 - s * 0.15; c2 *= 1 - s * 0.45; } // bile-green stains
  else if (n < 0.28) { const s = smooth(0.28, 0.14, n); c0 *= 1 + s * 0.35; c1 *= 1 + s * 0.3; c2 *= 1 + s * 0.2; } // worn wax
  return [c0, c1, c2];
}

// Long coat skirt: open at the front, the opening widening toward a cut-away hem; y from 0 down to -len.
function coatSkirt(rTop, rBot, len, o = {}) {
  const seg = o.seg ?? 22, rows = o.rows ?? 7, g0 = o.gapTop ?? 0.3, g1 = o.gapBot ?? 1.0, seed = o.seed ?? 3;
  const folds = o.folds ?? 9, foldAmp = o.foldAmp ?? 0.07, tatter = o.tatter ?? 0.1;
  const g = new THREE.CylinderGeometry(rTop, rBot, len, seg, rows, true, g0 / 2, TAU - g0);
  g.translate(0, -len / 2, 0);
  const R = rng(seed), cut = [];
  for (let j = 0; j <= seg; j++) cut.push(R());
  const p = g.getAttribute('position');
  for (let i = 0; i < p.count; i++) {
    let x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const t = -y / len, j = i % (seg + 1), row = Math.floor(i / (seg + 1));
    const a0 = Math.atan2(x, z), sa = a0 < 0 ? -1 : 1;
    const gt = lerp(g0, g1, t * t);
    const a = sa * (gt / 2 + (Math.abs(a0) - g0 / 2) * (Math.PI - gt / 2) / (Math.PI - g0 / 2));
    const rr = Math.hypot(x, z) * (1 + Math.sin(a * folds + seed) * foldAmp * t + (vnoise(a * 2 + 5, t * 3, seed, 9) - 0.5) * foldAmp * t);
    // cut-away front: the front panels are shorter than the tails
    y *= lerp(0.84, 1.04, Math.abs(a) / Math.PI);
    if (row === rows && j > 0 && j < seg) y += (j % 2 === 0 ? cut[j] : cut[j] * 0.35) * tatter * len;
    p.setXYZ(i, Math.sin(a) * rr, y, Math.cos(a) * rr);
  }
  g.computeVertexNormals();
  return g;
}

// wide-brimmed hat: drooping brim ring (two-sided) + band; origin at the crown base
function hatBrim(r0, r1, AS = 28) {
  const pos = [], idx = [], RS = 3;
  for (let i = 0; i <= AS; i++) {
    const a = (i / AS) * TAU;
    for (let k = 0; k <= RS; k++) {
      const u = k / RS, r = lerp(r0, r1, u);
      // droops at front and back, a dent on the left, slight wave
      // droops at front and back, curls up at the very edge, a dent on the left, slight wave
      const y = -0.05 * u * u * (0.55 + 0.45 * Math.cos(a) ** 2) + 0.03 * smooth(0.7, 1, u) * (1 - 0.6 * Math.cos(a) ** 2) + 0.012 * u * Math.sin(a * 3 + 1) - 0.02 * u * Math.exp(-((a - 1.2) ** 2) / 0.15);
      pos.push(Math.sin(a) * r, y, Math.cos(a) * r);
    }
  }
  for (let i = 0; i < AS; i++) for (let k = 0; k < RS; k++) { const a = i * (RS + 1) + k, b = a + RS + 1; idx.push(a, b, a + 1, b, b + 1, a + 1); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx); g.computeVertexNormals();
  return twoSided(g);
}

// hooked bonesaw in grip space (+Z), teeth toward -Y
function bonesawGeo() {
  const out = [[0, 0.024], [0.4, 0.024], [0.44, 0.012], [0.462, -0.02], [0.452, -0.056], [0.432, -0.078], [0.424, -0.064], [0.432, -0.042], [0.418, -0.03]];
  for (let x = 0.4; x > 0.02; x -= 0.019) out.push([x, -0.03], [x - 0.0095, -0.044]);
  out.push([0.0, -0.034]);
  const blade = xf(extrude(out, 0.005, 0, 1), { ry: -Math.PI / 2 });
  return blade;
}

// shared pose bits (module level so pose() never allocates)
const PD_UPPER = { spine: [0.3, 0, 0], chest: [0.24, 0, 0], neck: [0.12, 0, 0], head: [-0.58, 0, 0] };
const PD_LEGS = { hips: [0.03, 0, 0, 0, -0.05, 0], thighL: [-0.24, 0, 0.05], thighR: [-0.08, 0, -0.06], shinL: [0.34, 0, 0], shinR: [0.26, 0, 0], footL: [-0.1, 0, 0], footR: [-0.18, 0, 0] };
const PD_REST = { armL: [-0.55, 0.1, 0.24], foreL: [-0.85, 0, 0], handL: [0.25, 0, 0.15], armR: [-0.12, 0, -0.1], foreR: [-0.5, 0, 0], handR: [1.25, 0, 0] };
const PD_CREEP = { spine: [0.12, 0, 0], chest: [0.06, 0, 0], head: [-0.12, 0, 0], hips: [0, 0, 0, 0, -0.06, 0] };
// cense: censer arm raised overhead, saw held out
const PD_CENSE = { armL: [-2.75, 0.1, 0.42], foreL: [-0.35, 0, 0], handL: [0, 0, 0], armR: [-0.5, 0, -0.55], foreR: [-0.9, 0, 0], handR: [0.9, 0, 0], chest: [-0.28, 0.12, 0], spine: [-0.14, 0, 0], neck: [-0.1, 0, 0], head: [-0.2, 0, 0], hips: [0, 0, 0, 0, -0.03, 0], thighL: [-0.12, 0, 0.08], thighR: [0.06, 0, -0.08], shinL: [0.15, 0, 0] };
const PD_CENSE_IN = { armL: [-1.6, 0.1, 0.35], foreL: [-1.0, 0, 0], chest: [-0.05, 0.2, 0], head: [-0.1, -0.15, 0], armR: [-0.3, 0, -0.35], foreR: [-0.8, 0, 0] };
const PD_STAGGER = { spine: [-0.32, 0.1, 0.06], chest: [-0.26, 0.2, 0], neck: [-0.15, 0, 0], head: [-0.45, -0.3, 0.15], armL: [0.3, 0, 0.75], foreL: [-0.3, 0, 0], armR: [0.35, 0, -0.7], foreR: [-0.5, 0, 0], handR: [0.4, 0, 0], hips: [0, 0, 0, 0, -0.04, -0.1], thighL: [-0.3, 0, 0], shinL: [0.4, 0, 0], thighR: [0.2, 0, 0] };
// death: to the knees, the mask droops onto the chest, then topples forward and aside
const PD_KNEEL = { hips: [0.12, 0, 0, 0, -0.42, -0.04], thighL: [-0.22, 0, 0.1], shinL: [1.65, 0, 0], footL: [1.05, 0, 0], thighR: [-0.12, 0, -0.1], shinR: [1.6, 0, 0], footR: [1.05, 0, 0], spine: [0.28, 0, 0], chest: [0.15, 0, 0], neck: [0.1, 0, 0], head: [0.1, 0, 0], armL: [0.05, 0, 0.18], foreL: [-0.35, 0, 0], armR: [0.1, 0, -0.18], foreR: [-0.35, 0, 0], handR: [0.4, 0, 0] };
const PD_DROOP = { neck: [0.5, 0, 0], head: [0.7, 0.15, 0.22], chest: [0.12, 0, 0], armL: [0.12, 0, -0.1], armR: [0.12, 0, 0.1] };
const PD_FALLEN = { hips: [1.42, 0.3, 0.12, 0, -0.86, 0.32], thighL: [-0.15, 0, 0.18], shinL: [0.45, 0, 0], thighR: [-0.35, 0, -0.1], shinR: [0.95, 0, 0], footL: [0.5, 0, 0], footR: [0.5, 0, 0], spine: [0.05, 0, -0.1], chest: [0, 0, 0], neck: [-0.15, 0, 0], head: [-0.15, 1.15, 0.1], armL: [-0.5, 0, 1.25], foreL: [-0.4, 0, 0], armR: [0.35, 0, -1.0], foreR: [-0.5, 0, 0], handR: [0.5, 0, 0] };

const _cM = new THREE.Matrix4(), _cC = new THREE.Matrix4(), _cH = new THREE.Vector3(), _cQh = new THREE.Quaternion(), _cQ = new THREE.Quaternion(), _cQs = new THREE.Quaternion();
const _cD = new THREE.Vector3(), _cT = new THREE.Vector3(), _cV = new THREE.Vector3(), _cS = new THREE.Vector3(), _cE = new THREE.Euler();
const _DOWN = new THREE.Vector3(0, -1, 0), _UP = new THREE.Vector3(0, 1, 0), _Y = new THREE.Vector3(0, 1, 0);
// model-space matrix of a bone from its current local transforms
function boneModel(m, b, out) {
  out.identity();
  for (let o = b; o && o !== m.root; o = o.parent) { _cC.compose(o.position, o.quaternion, o.scale); out.premultiply(_cC); }
  return out;
}
// write a bone's local rotation as both target and current (no damping lag)
function snapRot(P, name, e) {
  const o = P.idx.get(name) * 9;
  P.tgt[o] = P.cur[o] = e.x; P.tgt[o + 1] = P.cur[o + 1] = e.y; P.tgt[o + 2] = P.cur[o + 2] = e.z;
}

function censerSim(m, s, dt) {
  const st = m.state, cb = m.bones.censer;
  boneModel(m, cb.parent, _cM);
  _cM.decompose(_cS, _cQh, _cV);
  _cH.copy(cb.position).applyMatrix4(_cM); // chain pivot at the fist
  let c = st.censer;
  if (!c) c = st.censer = { B: _cH.clone().addScaledVector(_DOWN, PD_CHAIN), prev: new THREE.Vector3(), v: new THREE.Vector3(), lean: new THREE.Vector3(), whirl: 0, whirlW: 0, spin: 0 };
  const an = s.anim;
  // overhead censing whirl: the bob is pulled around a tilted circle above the raised fist
  const cense = (an === 'cast' || (an === 'windup' && s.attackType === 'cense'));
  const whirlT = cense ? (an === 'cast' ? (st.cenSecond ? 1 - smooth(0.5, 0.9, s.progress) : smooth(0.04, 0.2, s.progress)) : smooth(0.4, 1, s.progress) * 0.7) : 0;
  if (dt > 0) {
    c.whirlW += (whirlT - c.whirlW) * (1 - Math.exp(-6 * dt));
    c.whirl += dt * (4 + 6.5 * c.whirlW);
    c.spin += dt * (0.4 + c.v.length() * 2.5);
    c.prev.copy(c.B);
    c.v.y -= 9.8 * dt;
    c.v.z -= 1.6 * (st.moveW ?? 0) * dt; // trails a little when creeping forward
    c.v.multiplyScalar(Math.exp(-(1.0 + 1.5 * (an === 'death' ? 1 : 0)) * dt));
    c.B.addScaledVector(c.v, dt);
    if (c.whirlW > 0.01) {
      const th = 1.2;
      _cT.set(Math.sin(th) * Math.cos(c.whirl), -Math.cos(th), Math.sin(th) * Math.sin(c.whirl)).multiplyScalar(PD_CHAIN).add(_cH);
      c.B.lerp(_cT, 1 - Math.exp(-14 * c.whirlW * dt));
    }
    // rigid chain, then the floor (keeping the chain length by sliding the bob outward on the floor)
    _cD.subVectors(c.B, _cH);
    c.B.copy(_cH).addScaledVector(_cD, PD_CHAIN / (_cD.length() || 1));
    if (an !== 'spawn' && c.B.y < PD_FLOOR) {
      const dy = PD_FLOOR - _cH.y, hd = Math.sqrt(Math.max(0, PD_CHAIN * PD_CHAIN - dy * dy));
      _cD.set(c.B.x - _cH.x, 0, c.B.z - _cH.z);
      if (_cD.lengthSq() < 1e-8) _cD.set(0, 0, 1);
      _cD.setLength(hd);
      c.B.set(_cH.x + _cD.x, PD_FLOOR, _cH.z + _cD.z);
      c.v.x *= Math.exp(-6 * dt); c.v.z *= Math.exp(-6 * dt);
    }
    _cV.subVectors(c.B, c.prev).divideScalar(dt);
    c.v.lerp(_cV, 0.9); // position-based velocity (keeps a hint of the integrated one for smoothness)
    if (c.v.lengthSq() > 400) c.v.setLength(20);
    // smoke leans away from the motion
    _cT.copy(c.v).multiplyScalar(-0.07);
    if (_cT.lengthSq() > 0.5) _cT.setLength(0.7);
    c.lean.lerp(_cT, 1 - Math.exp(-5 * dt));
  }
  // chain bone: local -Y toward the bob, spinning slowly about the chain
  _cD.subVectors(c.B, _cH).normalize();
  _cQ.setFromUnitVectors(_DOWN, _cD);
  _cQs.setFromAxisAngle(_Y, c.spin);
  _cQ.multiply(_cQs);
  _cQs.copy(_cQh).invert().multiply(_cQ);
  snapRot(m.P, 'censer', _cE.setFromQuaternion(_cQs, 'XYZ'));
  // smoke column stays upright (leaning with the motion) whatever the censer does
  _cT.copy(c.lean).add(_UP).normalize();
  _cQs.setFromUnitVectors(_UP, _cT);
  _cQ.invert().multiply(_cQs);
  snapRot(m.P, 'smoke', _cE.setFromQuaternion(_cQ, 'XYZ'));
}

export const plagueDoctor = {
  id: 'plagueDoctor', height: 1.95, radius: 0.42, eyeColor: PD_EYE, magicColor: PD_TOXIC, defaultAttack: 'lob', attackTypes: ['lob', 'cense', 'saw'], flutter: 0.03, orbSize: 0.075,
  build(rig) {
    const D = humanSkeleton(rig, { thigh: 0.46, shin: 0.45, ankle: 0.07, hipW: 0.1, spine: 0.17, chest: 0.31, neck: 0.1, shoulderW: 0.19, shoulderDrop: 0.05, upper: 0.31, fore: 0.29 });
    rig.bone('censer', 'handL', 0, -0.075, 0.005);
    rig.bone('smoke', 'censer', 0, -PD_CHAIN + 0.075, 0);
    const W = D.shoulderW, top = 0.05 + D.spine + D.chest;
    const torsoSkin = chainSkin([['hips', 0.0], ['spine', 0.05 + D.spine * 0.45], ['chest', 0.05 + D.spine + D.chest * 0.25]], (v) => v.y);

    // --- coat: gaunt hunched body, long open skirt over the legs, shoulder capelet, high collar
    const tors = lathe([[0.001, -0.09], [W * 0.72, -0.07], [W * 0.8, 0.04], [W * 0.72, 0.05 + D.spine * 0.7], [W * 0.78, 0.05 + D.spine + D.chest * 0.35], [W * 0.9, 0.05 + D.spine + D.chest * 0.75], [W * 0.82, 0.05 + D.spine + D.chest * 0.95], [W * 0.42, top + 0.02], [0.001, top + 0.04]], 14);
    deform(tors, (v) => { v.z *= 0.68; const k = clamp((v.y - D.spine) / D.chest); if (v.z < 0) v.z -= k * k * 0.05; });
    rig.add('hips', 'leather', tors, {}, { cfn: coatStain, skin: torsoSkin, uv: 3 });
    const skirtLen = 0.84;
    const skirt = coatSkirt(W * 0.84, 0.33, skirtLen, { seed: 5, tatter: 0.12 });
    const skirtSkin = (v) => { const t = clamp((-v.y - 0.06) / (skirtLen * 0.85)) * lerp(0.85, 0.32, smooth(0.02, -0.2, v.z)), l = clamp(0.5 + v.x * 2.6); return [['hips', 1 - t], ['thighL', t * l], ['thighR', t * (1 - l)]]; };
    const skirtAnim = (v) => clamp((-v.y - 0.25) / skirtLen) * 1.1;
    rig.add('hips', 'leather', lining(skirt, 0.005), { y: 0.07, sz: 0.82 }, { c: [0.3, 0.25, 0.22], anim: skirtAnim, skin: skirtSkin, uv: 3 });
    rig.add('hips', 'leather', skirt, { y: 0.07, sz: 0.82 }, {
      uv: 3,
      cfn: (v) => { const c = coatStain(v); const k = 1 - smooth(-0.45, -0.8, v.y) * 0.45; return [c[0] * k, c[1] * k, c[2] * k]; },
      anim: skirtAnim,
      // front panels ride on the thighs, the tails mostly hang from the hips (a sharp left/right split at the back folds the hem)
      skin: skirtSkin,
    });
    rig.add('chest', 'leather', twoSided(robe(0.1, 0.3, 0.33, { seg: 24, rows: 4, folds: 9, foldAmp: 0.065, tatter: 0.3, seed: 11 })), { y: D.chest + 0.07, sz: 0.8 }, { cfn: coatStain, anim: (v) => clamp(-v.y * 3) * 0.6, uv: 3 });
    rig.add('chest', 'leather', shell([[0.07, 0], [0.078, 0.06], [0.092, 0.14]], 0.008, 12, 0.55, TAU - 1.1), { y: D.chest - 0.01, z: -0.01 }, { c: PD_COAT });
    // buttoned placket, belt with a brass buckle, pouches
    rig.add('chest', 'gold', rivets([0, 1, 2, 3, 4].map((i) => [0, D.chest * (0.82 - i * 0.16), 0.122 - Math.abs(i - 1.5) * 0.004]), 0.011), {}, { c: PD_BRASS });
    rig.add('hips', 'leather', xf(G.cyl(W * 0.84, W * 0.86, 0.05, 16, true), { sz: 0.74 }), { y: 0.06 }, { c: [0.32, 0.25, 0.2] });
    rig.add('hips', 'gold', mergeRaw([xf(G.box(0.055, 0.05, 0.012), {}), xf(G.box(0.012, 0.05, 0.016), { x: 0.012 })]), { y: 0.06, z: W * 0.86 * 0.74 + 0.005 }, { c: PD_BRASS });
    rig.add('hips', 'leather', mergeRaw([xf(G.box(0.08, 0.1, 0.045), { x: 0.13, y: -0.01, z: 0.075, ry: 0.6 }), xf(G.box(0.085, 0.03, 0.05), { x: 0.13, y: 0.04, z: 0.077, ry: 0.6 }), xf(G.box(0.07, 0.085, 0.04), { x: -0.14, y: 0.0, z: 0.06, ry: -0.7 })]), {}, { c: [0.45, 0.33, 0.25] });
    // blood-stained surgeon's apron tied at the waist over the coat
    const apron = panel(0.32, 0.6, { ws: 5, hs: 7, tatter: 0.12, seed: 14, curve: 0.08, taperBot: 1.15 });
    rig.add('hips', 'leather', apron, { y: 0.075, z: W * 0.86 * 0.74 + 0.012, rx: -0.06 }, {
      uv: 2.5,
      cfn: (v) => { const n = vnoise(v.x * 9 + 2, v.y * 7, 3, 77), d = 0.85 + 0.25 * vnoise(v.x * 30, v.y * 30, 1, 5); const bl = smooth(0.5, 0.72, n + smooth(-0.1, -0.5, v.y) * 0.25); return [lerp(2.3, 1.15, bl) * d, lerp(1.95, 0.32, bl) * d, lerp(1.5, 0.22, bl) * d]; },
      anim: (v) => clamp(-v.y / 0.6) * 0.6,
      skin: (v) => { const t = clamp((-v.y - 0.05) / 0.5) * 0.7, l = clamp(0.5 + v.x * 4); return [['hips', 1 - t], ['thighL', t * l], ['thighR', t * (1 - l)]]; },
    });
    // surgeon's tool roll on the right hip (handles poking out), two vials hung on cords at the left
    rig.add('hips', 'leather', xf(G.cyl(0.035, 0.035, 0.17, 8), { rz: Math.PI / 2 - 0.25 }), { x: -0.13, y: -0.06, z: 0.11, ry: -0.5 }, { c: [0.5, 0.38, 0.28] });
    rig.add('hips', 'steel', mergeRaw([0, 1, 2, 3].map((i) => xf(G.cyl(0.005, 0.006, 0.07, 5), { x: -0.04 + i * 0.026, y: 0.045 + (i % 2) * 0.012, z: 0.02 }))), { x: -0.13, y: -0.06, z: 0.11, ry: -0.5, rz: -0.25 }, { c: [0.85, 0.8, 0.75] });
    rig.add('hips', 'glow', mergeRaw([xf(G.sph(0.02, 7, 5), { x: 0.17, y: -0.15, z: 0.06, sy: 1.3 }), xf(G.sph(0.016, 7, 5), { x: 0.2, y: -0.11, z: 0.02, sy: 1.4 })]), {}, { c: HDR(PD_TOXIC, 1.2), anim: 0.5 });
    rig.add('hips', 'gold', mergeRaw([xf(G.cyl(0.007, 0.008, 0.02, 6), { x: 0.17, y: -0.115, z: 0.06 }), xf(G.cyl(0.006, 0.007, 0.018, 6), { x: 0.2, y: -0.08, z: 0.02 }), xf(G.cyl(0.002, 0.002, 0.1, 3), { x: 0.165, y: -0.06, z: 0.065, rz: 0.15 }), xf(G.cyl(0.002, 0.002, 0.08, 3), { x: 0.197, y: -0.035, z: 0.025, rz: 0.1 })]), {}, { c: PD_BRASS, anim: 0.5 });
    // bandolier of toxic flasks across the chest
    const strap = tubeO([[-0.13, D.chest + 0.03, 0.05], [-0.07, D.chest * 0.74, 0.118], [0.02, D.chest * 0.42, 0.13], [0.1, D.chest * 0.1, 0.12], [0.15, -0.06, 0.09]], 0.009, 16, 4);
    rig.add('chest', 'leather', xf(strap, { sz: 0.7 }), { z: 0.0 }, { c: [0.3, 0.22, 0.17] });
    rig.add('chest', 'leather', xf(tubeO([[-0.13, D.chest + 0.03, 0.05], [-0.1, D.chest + 0.04, -0.08], [0.0, D.chest * 0.5, -0.14], [0.15, -0.06, -0.08]], 0.009, 10, 4), {}), {}, { c: [0.3, 0.22, 0.17] });
    const fl = [[-0.06, 0.72], [0.0, 0.5], [0.055, 0.3], [0.1, 0.1]];
    rig.add('chest', 'glow', mergeRaw(fl.map(([x, y]) => xf(G.sph(0.021, 7, 5), { x, y: D.chest * y - 0.012, z: 0.128, sy: 1.25 }))), {}, { c: HDR(PD_TOXIC, 1.4) });
    rig.add('chest', 'gold', mergeRaw(fl.flatMap(([x, y]) => [xf(G.cyl(0.008, 0.01, 0.022, 6), { x, y: D.chest * y + 0.02, z: 0.128 }), xf(G.cyl(0.011, 0.011, 0.008, 6), { x, y: D.chest * y + 0.034, z: 0.128 })])), {}, { c: PD_BRASS });

    // --- head: hood, pale beaked mask with brass-rimmed glass eyes, wide-brimmed hat
    rig.add('neck', 'cloth', taper(0.05, 0.055, D.neck + 0.05, 8, 1), { y: D.neck + 0.02 }, { c: PD_CLOTH });
    // leather hood drawn tight over the skull, its cowl spilling onto the capelet
    const hoodG = deform(G.sph(0.118, 12, 9), (v) => { v.z *= 1.1; if (v.z < 0) v.z *= 1 + clamp(-v.y / 0.1) * 0.25; v.y *= 1.05; });
    rig.add('head', 'leather', hoodG, { y: 0.1, z: -0.015 }, { c: [0.42, 0.38, 0.34] });
    rig.add('head', 'leather', twoSided(robe(0.1, 0.19, 0.2, { seg: 14, rows: 2, folds: 6, foldAmp: 0.12, tatter: 0.25, seed: 6 })), { y: 0.07, z: -0.02 }, { cfn: coatStain, anim: (v) => clamp(-v.y * 4) * 0.5 });
    const face = new THREE.SphereGeometry(0.11, 16, 8, -Math.PI * 0.4, Math.PI * 0.8, Math.PI * 0.2, Math.PI * 0.42);
    rig.add('head', 'leather', face, { y: 0.1, z: 0.012, sz: 1.08 }, { c: PD_MASK, uv: 3.5 });
    const beakPts = [[0, 0.082, 0.07], [0, 0.07, 0.17], [0, 0.04, 0.27], [0, 0.0, 0.35], [0, -0.05, 0.415]];
    const beak = tubeO(beakPts, (u) => 0.062 * (1 - u) ** 0.85 + 0.005, 16, 10);
    deform(beak, (v) => { v.x *= 0.82; });
    rig.add('head', 'leather', beak, {}, { uv: 3.5, c: PD_MASK, cfn: (v) => { const k = 0.82 + 0.25 * vnoise(v.x * 30, v.y * 30, v.z * 30, 5) - smooth(0.25, 0.42, v.z) * 0.25; return [PD_MASK[0] * k, PD_MASK[1] * k, PD_MASK[2] * k]; } });
    // stitched seam along the beak ridge, nostril holes, a strap round the head
    rig.add('head', 'leather', tubeO(beakPts.map(([x, y, z], i) => [x, y + (0.062 * (1 - i / 4) ** 0.85 + 0.003) * 0.98, z]), 0.004, 12, 3), {}, { c: [0.9, 0.75, 0.55] });
    rig.add('head', 'dark', mergeRaw([xf(G.sph(0.008, 5, 4), { x: 0.021, y: 0.06, z: 0.2 }), xf(G.sph(0.008, 5, 4), { x: -0.021, y: 0.06, z: 0.2 })]));
    rig.add('head', 'leather', xf(G.tor(0.113, 0.009, 3, 18), { rx: Math.PI / 2 + 0.25, sz: 1.08 }), { y: 0.08, z: -0.005 }, { c: [0.35, 0.27, 0.21] });
    for (const sx of [-1, 1]) {
      const eye = { x: sx * 0.044, y: 0.118, z: 0.104, ry: sx * 0.3 };
      rig.add('head', 'gold', mergeRaw([xf(G.cyl(0.031, 0.033, 0.026, 12, true), { rx: Math.PI / 2 }), xf(G.tor(0.032, 0.006, 4, 12), { z: 0.013 })]), eye, { c: PD_BRASS });
      rig.add('head', 'glow', xf(G.cyl(0.027, 0.027, 0.006, 12), { rx: Math.PI / 2, z: 0.008 }), eye, { c: HDR(PD_EYE, 4.5) });
    }
    const crown = lathe([[0.124, 0], [0.126, 0.04], [0.12, 0.085], [0.11, 0.102], [0.06, 0.108], [0.001, 0.106]], 18);
    deform(crown, (v) => { if (v.y > 0.095) v.y -= Math.exp(-(v.x * v.x) / 0.002) * 0.012; }); // pinched top
    const hatT = { y: 0.168, z: -0.012, rx: 0.12, rz: 0.04 };
    rig.add('head', 'leather', crown, hatT, { c: PD_HAT, uv: 3 });
    rig.add('head', 'leather', hatBrim(0.118, 0.315), hatT, { c: PD_HAT, uv: 3 });
    rig.add('head', 'leather', xf(G.cyl(0.127, 0.127, 0.03, 18, true), { y: 0.022 }), hatT, { c: [0.6, 0.45, 0.35] });
    rig.add('head', 'gold', xf(G.box(0.035, 0.03, 0.012), { y: 0.022, x: 0.06, z: 0.112, ry: 0.5 }), hatT, { c: PD_BRASS });

    // --- arms: coat sleeves with turned-back cuffs, long leather gloves
    for (const S of ['L', 'R']) {
      const sx = S === 'L' ? 1 : -1;
      // creased coat sleeves, the forearm flaring into a wide turned-back cuff (lined)
      const up = robe(0.064, 0.058, D.upper + 0.04, { seg: 11, rows: 3, folds: 5, foldAmp: 0.09, tatter: 0, seed: 3 + sx });
      rig.add('arm' + S, 'leather', up, { y: 0.03 }, { cfn: coatStain, uv: 3 });
      rig.add('arm' + S, 'leather', G.sph(0.06, 9, 6), { y: -0.005, sy: 0.9 }, { cfn: coatStain, uv: 3 });
      const lo = robe(0.054, 0.07, D.fore * 0.72, { seg: 11, rows: 3, folds: 5, foldAmp: 0.1, tatter: 0.08, seed: 6 + sx });
      rig.add('fore' + S, 'leather', lo, { y: 0.0 }, { cfn: coatStain, uv: 3 });
      rig.add('fore' + S, 'leather', lining(lo, 0.004), { y: 0.0 }, { c: [0.25, 0.21, 0.19], uv: 3 });
      rig.add('fore' + S, 'leather', shell([[0.07, -0.035], [0.08, 0.035]], 0.006, 11), { y: -D.fore * 0.66 }, { c: [0.42, 0.37, 0.32], uv: 3 });
      rig.add('fore' + S, 'leather', shell([[0.036, -D.fore - 0.01], [0.04, -D.fore + 0.05], [0.058, -D.fore + 0.15]], 0.006, 10), {}, { c: PD_GLOVE });
      const np = rig.parts.length;
      addFleshHand(rig, 'hand' + S, sx, { mat: 'leather', c: PD_GLOVE, m: 0.92, grip: true, fingerLen: 1.12 });
      for (let i = np; i < rig.parts.length; i++) outward(rig.parts[i].geo);
      // legs: dark breeches, tall boots with folded cuffs
      rig.add('thigh' + S, 'cloth', taper(0.086, 0.064, D.thigh + 0.02, 9, 2), { y: 0.02 }, { c: [0.2, 0.18, 0.16] });
      rig.add('shin' + S, 'cloth', taper(0.062, 0.058, D.shin * 0.3, 9, 1), { y: 0.0 }, { c: [0.2, 0.18, 0.16] });
      rig.add('shin' + S, 'leather', taper(0.064, 0.052, D.shin * 0.82, 9, 2), { y: -D.shin * 0.18 }, { c: [0.3, 0.26, 0.23] });
      rig.add('shin' + S, 'leather', shell([[0.07, -0.05], [0.078, 0.035]], 0.007, 10), { y: -D.shin * 0.17 }, { c: [0.36, 0.3, 0.26] });
      rig.add('foot' + S, 'leather', mergeRaw([xf(G.sph(0.056, 10, 6), { y: -0.04, z: 0.06, sx: 0.9, sy: 0.62, sz: 2.0 }), xf(G.box(0.095, 0.024, 0.22), { y: -0.07, z: 0.055 }), xf(G.box(0.08, 0.04, 0.05), { y: -0.07, z: -0.04 })]), {}, { c: [0.24, 0.2, 0.18] });
    }

    // --- hooked bonesaw (right fist)
    const sawT = { y: -0.07 };
    rig.add('handR', 'steel', xf(bonesawGeo(), { z: 0.075 }), sawT, { c: [0.75, 0.7, 0.66], cfn: (v) => { const k = vnoise(v.y * 40, v.z * 18, 1, 13); return k > 0.62 ? [0.45, 0.17, 0.12] : [0.78, 0.73, 0.68]; } });
    rig.add('handR', 'leather', xf(G.cyl(0.017, 0.019, 0.14, 8), { rx: Math.PI / 2, z: 0.0 }), sawT, { c: [0.4, 0.3, 0.22] });
    rig.add('handR', 'gold', mergeRaw([xf(G.sph(0.024, 8, 6), { z: -0.08 }), xf(G.cyl(0.022, 0.02, 0.025, 8), { rx: Math.PI / 2, z: 0.07 }), xf(G.box(0.012, 0.06, 0.06), { z: 0.08, y: -0.005 }), ...[0.12, 0.2, 0.28, 0.36].map((z) => xf(G.cyl(0.004, 0.004, 0.012, 5), { rz: Math.PI / 2, z: z + 0.075, y: 0.016 }))]), sawT, { c: PD_BRASS });

    // --- censer on its chain (left fist): perforated brass globe, sickly embers, rising smoke
    const links = [];
    const nL = 10;
    for (let i = 0; i < nL; i++) links.push(xf(G.tor(0.014, 0.004, 3, 6), { y: -0.02 - i * ((PD_CHAIN - 0.12) / (nL - 1)), sy: 1.45, ry: (i % 2) * Math.PI / 2 }));
    rig.add('censer', 'gold', mergeRaw(links), {}, { c: [0.55, 0.45, 0.34] });
    const cz = -PD_CHAIN;
    const bowl = lathe([[0.001, -0.072], [0.03, -0.07], [0.054, -0.05], [0.066, -0.015], [0.064, 0.0]], 12);
    const lid = lathe([[0.062, 0.006], [0.06, 0.028], [0.046, 0.056], [0.024, 0.072], [0.001, 0.078]], 12);
    rig.add('censer', 'gold', mergeRaw([bowl, lid, xf(G.tor(0.066, 0.008, 4, 14), { rx: Math.PI / 2, y: 0.003 }), xf(G.cyl(0.03, 0.04, 0.016, 10), { y: -0.078 }), xf(G.tor(0.016, 0.005, 3, 8), { y: 0.092 }), ...[0, 1, 2, 3].map((i) => xf(G.box(0.012, 0.03, 0.012), { x: Math.sin(i * 1.57) * 0.067, z: Math.cos(i * 1.57) * 0.067, y: -0.012 }))]), { y: cz }, { c: PD_BRASS, cfn: (v) => { const k = 0.7 + 0.4 * vnoise(v.x * 40, v.y * 40, v.z * 40, 3); return [PD_BRASS[0] * k, PD_BRASS[1] * k * 0.97, PD_BRASS[2] * k * 0.9]; } });
    const holes = [];
    for (let i = 0; i < 8; i++) { const a = (i / 8) * TAU; holes.push(xf(G.box(0.012, 0.016, 0.006), { x: Math.sin(a) * 0.052, z: Math.cos(a) * 0.052, y: 0.036, ry: a, rx: -0.5 })); }
    for (let i = 0; i < 5; i++) { const a = (i / 5) * TAU + 0.3; holes.push(xf(G.sph(0.007, 5, 4), { x: Math.sin(a) * 0.028, z: Math.cos(a) * 0.028, y: 0.068 })); }
    rig.add('censer', 'glow', mergeRaw([...holes, xf(G.tor(0.0655, 0.0035, 3, 16), { rx: Math.PI / 2, y: -0.006 })]), { y: cz }, { c: HDR(PD_EYE, 3.2) });
    const wisps = [];
    const R = rng(23);
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * TAU, pts = [];
      for (let k = 0; k <= 7; k++) { const u = k / 7; pts.push([Math.sin(a + u * 4.5) * (0.012 + u * 0.07) + (R() - 0.5) * 0.03, 0.01 + u * (0.4 + i * 0.08), Math.cos(a + u * 4.5) * (0.012 + u * 0.07) + (R() - 0.5) * 0.03]); }
      wisps.push(tubeO(pts, (u) => 0.005 + u * 0.022, 18, 5));
    }
    rig.add('smoke', 'spirit', mergeRaw(wisps), {}, { cfn: (v) => { const k = 0.06 * (1 - smooth(0.15, 0.55, v.y)) + 0.012; return HDR(PD_TOXIC, k); }, anim: (v) => clamp(v.y * 2.4) * 1.6 });
    rig.socket('muzzle', 'censer', 0, cz, 0);
    return D;
  },
  pose(m, s, P, dt) {
    const st = m.state;
    if (s.anim === 'cast') {
      s.attackType = 'cense';
      // the game plays a heal as two 'cast' passes (raise, then mend + recover): the second only whirls down
      if (st.cenP != null && s.progress + 0.2 < st.cenP) st.cenSecond = true;
      st.cenP = s.progress;
    } else { st.cenP = null; st.cenSecond = false; }
    let r = humanoidPose(m, s, P, dt);
    const an = s.anim, T = m.time, w = m.state.moveW ?? 0;
    const action = an === 'windup' || an === 'attack' || an === 'cast';
    if (an !== 'death' && an !== 'spawn') {
      // creeping walk: lower and more hunched, head thrust forward
      P.apply(PD_CREEP, w);
      if (!action) {
        // idle: a slow hunched sway, the censer fist drifting in lazy circles, bird-like tilts of the beak
        const iw = 1 - w, sw = Math.sin(T * 0.7 + m.seed * 4);
        P.r('spine', 0, sw * 0.06 * iw, sw * 0.05 * iw); P.r('chest', 0, sw * 0.05 * iw, 0);
        P.r('armL', Math.sin(T * 1.25) * 0.09 * iw, 0, Math.cos(T * 1.25) * 0.07 * iw);
        const tilt = smooth(0.55, 0.75, Math.sin(T * 0.37 + m.seed * 7)) - smooth(0.55, 0.75, -Math.sin(T * 0.37 + m.seed * 7));
        P.r('head', 0, 0, tilt * 0.32 * iw);
      }
    }
    if (an === 'windup' || an === 'attack') m.setOrb(an === 'windup' ? (s.attackType === 'saw' ? 0 : 0.3 + 0.6 * smooth(0, 1, s.progress)) : (s.attackType === 'lob' ? 0.95 * (1 - smooth(0.2, 0.3, s.progress)) : 0));
    if (an === 'death') m.setOrb(0);
    P.damp(dt, r);
    censerSim(m, s, dt);
    return 0; // damped above; the engine's pass only writes the bones
  },
  anim: {
    gait: 'walk', armSwing: 0.14, stride: 0.38, strideK: 0.12, knee: 0.75, breath: 1.5, look: 0.45, armOut: 0.04, caster: true, rate: 11,
    // a corpse lays its weapon flat instead of standing it 1 m+ out of the body or the floor (scripts/grip.js)
    deathGrip: [{ foreR: [0.4, 0, 0], handR: [1.2, 0, -1.2] }, { foreR: [0.4, 0, 0], handR: [1.2, 0, -1.2] }],
    rest: PD_REST,
    stance: (P, m, s) => {
      if (s.anim === 'death') return;
      P.apply(PD_UPPER);
      P.apply(PD_LEGS, 1 - (m.state.moveW ?? 0));
    },
    stagger: PD_STAGGER,
    actions: {
      // underarm lob: the censer arm swings back low, then forward and up; the flask leaves the censer at the top of the arc
      lob: act2(
        { armL: [0.95, 0.25, 0.3], foreL: [-0.35, 0, 0], handL: [0.3, 0, 0], armR: [-0.35, 0, -0.35], foreR: [-0.9, 0, 0], handR: [1.1, 0, 0], chest: [0.05, 0.5, 0], spine: [0.12, 0.22, 0], head: [-0.15, -0.55, 0], hips: [0, 0.1, 0, 0, -0.09, -0.06], thighL: [-0.35, 0, 0.06], shinL: [0.35, 0, 0], thighR: [0.15, 0, -0.06], shinR: [0.45, 0, 0] },
        { armL: [-1.95, -0.1, 0.12], foreL: [-0.2, 0, 0], handL: [-0.3, 0, 0], armR: [0.25, 0, -0.45], foreR: [-0.6, 0, 0], handR: [1.1, 0, 0], chest: [-0.05, -0.4, 0], spine: [0.05, -0.18, 0], head: [-0.05, 0.4, 0], hips: [0, -0.12, 0, 0, -0.04, 0.16], thighL: [-0.6, 0, 0.04], shinL: [0.45, 0, 0], thighR: [0.4, 0, -0.04], shinR: [0.25, 0, 0], footR: [0.25, 0, 0] },
        { hit: 0.26, recover: 0.6, recoverAmt: 0.6, tremble: 0.015 },
      ),
      // censing: the censer is raised overhead and whirled in a wide circle, smoke pouring down
      cense: (P, ph, p, m) => {
        if (ph === 'windup') { P.blend(PD_CENSE_IN, PD_CENSE, smooth(0.2, 1, p)); return 8; }
        const second = m.state.cenSecond, up = second ? 1 : smooth(0, 0.18, p), down = second ? smooth(0.55, 1, p) : smooth(0.9, 1, p) * 0.25;
        P.apply(PD_CENSE_IN, (1 - up) + down * 0.6);
        P.apply(PD_CENSE, up * (1 - down * 0.6));
        // the fist drives the whirl in a small circle, body rocking with it
        const ph2 = m.state.censer ? m.state.censer.whirl : 0, k = up * (1 - down);
        P.r('armL', Math.sin(ph2) * 0.12 * k, 0, Math.cos(ph2) * 0.1 * k);
        P.r('chest', 0, Math.sin(ph2) * 0.05 * k, 0);
        return 9;
      },
      // quick hooked slash: saw cocked at the shoulder, then ripped down and across
      saw: act2(
        { armR: [-1.95, 0.25, -0.65], foreR: [-1.45, 0, 0], handR: [-0.2, 0, 0], armL: [-0.35, 0, 0.45], foreL: [-0.7, 0, 0], chest: [-0.08, -0.5, 0], spine: [0.02, -0.2, 0], head: [-0.1, 0.45, 0], hips: [0, -0.1, 0, 0, -0.05, -0.05], thighR: [0.2, 0, 0], shinR: [0.3, 0, 0], thighL: [-0.25, 0, 0], shinL: [0.25, 0, 0] },
        { armR: [-0.75, -0.35, 0.75], foreR: [-0.35, 0, 0], handR: [1.2, 0, 0], armL: [0.1, 0, 0.55], foreL: [-0.5, 0, 0], chest: [0.32, 0.55, 0], spine: [0.2, 0.2, 0], head: [-0.25, -0.5, 0], hips: [0, 0.12, 0, 0, -0.12, 0.2], thighR: [-0.65, 0, 0], shinR: [0.55, 0, 0], thighL: [0.3, 0, 0], shinL: [0.3, 0, 0] },
        { hit: 0.18, recover: 0.55, recoverAmt: 0.7, tremble: 0.02 },
      ),
    },
    death: (P, p, m) => plagueDeath(P, p, m),
    spawn: (P, p, m) => plagueSpawn(P, p, m),
  },
};
function plagueDeath(P, p, m) {
  const a = smooth(0, 0.3, p), d = smooth(0.24, 0.46, p), b = easeIn(smooth(0.52, 0.86, p));
  P.apply(PD_UPPER, 1 - a);
  P.apply(PD_REST, 1 - a);
  P.apply(PD_KNEEL, a * (1 - b));
  P.apply(PD_DROOP, d * (1 - b));
  P.apply(PD_FALLEN, b);
  // kneeling sway before it goes over; the hips arc over the knees rather than through the floor
  const sway = bump(0.3, 0.6, p);
  P.r('spine', 0, 0, Math.sin(m.time * 3.1) * 0.06 * sway);
  const arc = bump(0.52, 0.86, p);
  P.p('hips', 0, arc * 0.13 + bump(0, 0.3, p) * 0.1, arc * 0.08);
  P.r('thighL', -arc * 0.25); P.r('thighR', -arc * 0.25);
  const thud = bump(0.86, 0.96, p);
  P.p('hips', 0, thud * 0.03, 0); P.r('head', -thud * 0.12);
  return 11;
}
function plagueSpawn(P, p, m) {
  // crawls up out of the floor, unfolding from a crouch
  const u = easeOut(smooth(0, 0.72, p));
  P.p('base', 0, -(1 - u) * 2.0, 0);
  const k = 1 - smooth(0.5, 1, p);
  P.apply(PD_KNEEL, k * 0.75);
  P.apply(PD_DROOP, k * 0.6);
  P.r('base', Math.sin(m.time * 6) * 0.04 * k, 0, Math.sin(m.time * 5) * 0.05 * k);
  return 14;
}

export const DUNGEON_TYPES = [skeleton, skeletonArcher, wraith, jailer, executionerGuard, plagueDoctor];
