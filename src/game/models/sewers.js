import * as THREE from 'three';
import { G, xf, taper, lathe, shell, tube, deform, bumpy, shaggy, robe, panel, mergeRaw, chainSkin, vnoise, rng, clamp, lerp, smooth, bump, easeOut, TAU } from './core.js';
import { humanSkeleton, humanoidPose, act2, ACT } from './humanoid.js';
import { quadSkeleton, quadPose } from './quad.js';
import { addFleshBody, addFleshHand, hood, belt, HDR, RUSTY, DARKSTEEL, STEEL, axeHeadGeo, rivets } from './parts.js';
import { skullGeo } from '../../world/props.js';

const FUR = [0.34, 0.27, 0.21];
const PINK = 0xc98f86;
const TOOTH = 0xd9c27a;
const RAT_EYE = 0xff2a14;

// ------------------------------------------------------------ rat head ----
// head bone origin at the back of the skull, snout along +Z
function ratHead(rig, o = {}) {
  const s = o.s ?? 1, fur = o.fur ?? FUR, head = o.head ?? 'head', jaw = o.jaw ?? 'jaw';
  const mat = o.mat ?? 'fur';
  const cran = shaggy(xf(G.sph(0.07, 16, 12), { sx: 1.0, sy: 0.82, sz: 1.2 }), 0.016, 22, 5, [0, 0, -1], 0.7);
  rig.add(head, mat, cran, { y: 0.03 * s, z: 0.05 * s, s }, { c: fur });
  const sn = shaggy(xf(taper(0.056, 0.024, 0.14, 12, 3), { rx: -Math.PI / 2 + 0.2 }), 0.008, 30, 6, [0, 0, -1], 0.6);
  rig.add(head, mat, sn, { y: 0.03 * s, z: 0.08 * s, s }, { c: fur });
  const tipZ = 0.08 + 0.15 * Math.cos(0.2), tipY = 0.03 - 0.15 * Math.sin(0.2);
  rig.add(head, 'skin', G.sph(0.02, 8, 6), { y: tipY * s + 0.006 * s, z: tipZ * s, sx: 1.2, sy: 0.85, s }, { c: [1.3, 0.62, 0.6] });
  rig.pair(head, head, 'dark', G.sph(0.005, 4, 3), { x: 0.008 * s, y: (tipY + 0.008) * s, z: (tipZ + 0.017) * s, s });
  // incisors
  rig.pair(head, head, 'bone', G.box(0.012, 0.04, 0.007), { x: 0.007 * s, y: (tipY - 0.03) * s, z: (tipZ - 0.012) * s, rx: 0.2, s }, { c: TOOTH });
  // eyes (beady + glow)
  rig.pair(head, head, 'dark', G.sph(0.017, 8, 6), { x: 0.042 * s, y: 0.055 * s, z: 0.105 * s, s });
  rig.pair(head, head, 'glow', G.sph(0.012, 8, 6), { x: 0.048 * s, y: 0.057 * s, z: 0.113 * s, s }, { c: HDR(o.eye ?? RAT_EYE, 7) });
  // ears
  const ear = xf(G.sph(0.045, 10, 6), { sx: 1, sy: 1.1, sz: 0.22 });
  rig.pair(head, head, 'skin', ear, { x: 0.052 * s, y: 0.1 * s, z: 0.02 * s, ry: 0.55, rz: -0.35, s }, { c: [0.75, 0.45, 0.42] });
  rig.pair(head, head, 'skin', xf(G.sph(0.034, 8, 5), { sz: 0.15 }), { x: 0.058 * s, y: 0.1 * s, z: 0.03 * s, ry: 0.55, rz: -0.35, s }, { c: [1.2, 0.55, 0.55] });
  if (o.notch) rig.add(head, 'dark', G.box(0.02, 0.03, 0.03), { x: -0.08 * s, y: 0.13 * s, z: 0.02 * s, s });
  // whiskers
  const wh = [];
  for (let i = 0; i < 4; i++) wh.push(xf(G.cyl(0.0012, 0.0006, 0.13, 3), { y: 0.065, rz: -1.2 - i * 0.12, ry: -0.3 + i * 0.12 }));
  const whg = mergeRaw(wh);
  rig.pair(head, head, 'dark', whg, { x: 0.025 * s, y: (tipY + 0.002) * s, z: (tipZ - 0.03) * s, s }, { c: 0x6a6050 });
  // lower jaw
  rig.add(jaw, mat, xf(taper(0.034, 0.016, 0.11, 10, 2), { rx: -Math.PI / 2 + 0.15, sx: 1.1, sy: 0.7 }), { y: -0.005 * s, z: 0.0, s }, { c: fur });
  rig.add(jaw, 'dark', G.box(0.04, 0.02, 0.09), { y: 0.012 * s, z: 0.06 * s, s });
  rig.pair(jaw, jaw, 'bone', G.box(0.01, 0.03, 0.006), { x: 0.006 * s, y: 0.012 * s, z: 0.115 * s, rx: -0.15, s }, { c: TOOTH });
  if (o.muzzle !== false) rig.socket('muzzle', head, 0, (tipY - 0.03) * s, (tipZ + 0.02) * s);
}

// ------------------------------------------------------------------ rat ----
export const rat = {
  id: 'rat', height: 0.5, radius: 0.4, length: 1.3, eyeColor: RAT_EYE, defaultAttack: 'bite', attackTypes: ['bite'],
  lunge: 0.45,
  build(rig) {
    const Q = quadSkeleton(rig, {
      bodyH: 0.27, len: 0.32, w: 0.075, wb: 0.085, legF: [0.1, 0.1, 0.04], legB: [0.12, 0.11, 0.045],
      neck: [0.04, 0.09], head: [0.0, 0.05], jaw: [-0.012, 0.086], tail: 7, tailSeg: 0.09, tailY: 0.0, tailZ: 0.15,
      stF: [0.2, -0.35, 0.15], stB: [-0.55, 1.0, -0.45],
    });
    // matted body, skinned smoothly between front and rear so the spine flexes
    const body = shaggy(xf(G.sph(0.16, 30, 20), { sx: 0.82, sy: 0.74, sz: 1.5 }), 0.038, 13, 4, [0, 0.15, -1], 0.8);
    const R = (v) => vnoise(v.x * 14, v.y * 14, v.z * 14, 3);
    rig.add('body', 'fur', body, { y: 0.03 }, {
      skin: chainSkin([['rear', -0.16], ['front', 0.16]], (v) => v.z),
      cfn: (v) => { const n = R(v); const back = clamp(v.y / 0.12); if (n > 0.74) return [0.75, 0.42, 0.38]; const k = 0.75 + 0.35 * vnoise(v.x * 30, v.y * 30, v.z * 30, 1) - back * 0.3; return [0.42 * k, 0.34 * k, 0.27 * k]; },
    });
    // spine ridge of matted tufts
    const tufts = [];
    for (let i = 0; i < 9; i++) tufts.push(xf(G.cone(0.025, 0.07, 4), { z: 0.2 - i * 0.055, y: 0.135 - Math.abs(i - 3) * 0.006, rx: -1.1 }));
    rig.add('body', 'fur', mergeRaw(tufts), { y: 0.03 }, { c: [0.2, 0.16, 0.13], skin: chainSkin([['rear', -0.16], ['front', 0.16]], (v) => v.z) });
    // sores
    const sores = [];
    const rr = rng(7);
    for (let i = 0; i < 6; i++) sores.push(xf(G.sph(0.018, 6, 4), { x: (rr() - 0.5) * 0.24, y: 0.04 + rr() * 0.07, z: (rr() - 0.5) * 0.4 }));
    rig.add('body', 'skin', mergeRaw(sores), { y: 0.03 }, { c: [1.0, 0.55, 0.25], skin: chainSkin([['rear', -0.16], ['front', 0.16]], (v) => v.z) });
    // neck scruff
    rig.add('neck', 'fur', shaggy(xf(G.sph(0.08, 14, 10), { sz: 1.2 }), 0.03, 14, 8, [0, 0, -1], 0.6), { y: 0.0, z: 0.0 }, { c: FUR });
    ratHead(rig, { s: 1.15 });
    // legs
    for (const S of ['L', 'R']) {
      const sx = S === 'L' ? 1 : -1;
      rig.add('legF' + S, 'fur', shaggy(G.sph(0.055, 10, 8), 0.02, 16, 2), { y: -0.02, sy: 1.4 }, { c: FUR });
      rig.add('legF' + S, 'fur', taper(0.032, 0.022, 0.1, 7, 2), {}, { c: FUR });
      rig.add('legF2' + S, 'skin', taper(0.02, 0.015, 0.1, 6, 2), {}, { c: [0.7, 0.45, 0.4] });
      rig.add('legB' + S, 'fur', shaggy(G.sph(0.075, 10, 8), 0.025, 16, 4), { y: -0.03, z: 0.01, sy: 1.3 }, { c: FUR });
      rig.add('legB2' + S, 'skin', taper(0.022, 0.016, 0.11, 6, 2), {}, { c: [0.7, 0.45, 0.4] });
      for (const F of ['F', 'B']) {
        const pb = 'paw' + F + S;
        rig.add(pb, 'skin', G.sph(0.024, 8, 5), { y: -0.03, z: 0.02, sx: 1.1, sy: 0.6, sz: 1.5 }, { c: [1.1, 0.62, 0.58] });
        for (let i = 0; i < 4; i++) rig.add(pb, 'bone', G.cone(0.005, 0.03, 4), { x: (i - 1.5) * 0.011, y: -0.04, z: 0.055, rx: Math.PI / 2 + 0.5 }, { c: 0x3a2e22 });
      }
      void sx;
    }
    // tail: one smooth tube skinned along the tail chain
    const pts = [];
    for (let i = 0; i <= 8; i++) pts.push([0, -i * 0.006, -0.1 - i * 0.075]);
    const chain = [['rear', 0.1], ...Array.from({ length: Q.tail }, (_, i) => ['tail' + i, Q.tailZ + i * Q.tailSeg])];
    rig.add('rear', 'skin', tube(pts, (u) => 0.026 * (1 - u * 0.85), 30, 6), {}, {
      skin: chainSkin(chain, (v) => -v.z),
      cfn: (v) => { const k = 0.85 + 0.15 * Math.sin(v.z * 160); return [0.95 * k, 0.6 * k, 0.56 * k]; },
    });
    return Q;
  },
  pose: quadPose,
  anim: { gait: 'bound', stride: 0.55, legAmp: 0.6, lift: 1.1, sniff: true, tailSway: 0.22, tailDroop: 0.04, lean: 0.06, breath: 3.0 },
};

// ---------------------------------------------------------------- slime ----
export const slime = {
  id: 'slime', height: 1.0, radius: 0.55, eyeColor: 0x8aff3a, defaultAttack: 'lunge', attackTypes: ['lunge'], wobble: true,
  build(rig) {
    rig.bone('base', null);
    rig.bone('body', 'base');
    for (let i = 0; i < 5; i++) rig.bone('deb' + i, 'body', 0, 0.45, 0);
    for (let i = 0; i < 6; i++) rig.bone('bub' + i, 'body', 0, 0.1, 0);
    const g = G.sph(0.52, 40, 28);
    deform(g, (v) => {
      v.y += 0.5;
      const n = vnoise(v.x * 4, v.y * 4, v.z * 4, 2) - 0.5;
      const r = Math.hypot(v.x, v.z);
      const k = 1 + n * 0.12 + Math.exp(-((v.y - 0.15) ** 2) / 0.02) * 0.12;
      v.x *= k; v.z *= k;
      if (v.y < 0.12) { v.y = 0.12 - (0.12 - v.y) * 0.22; v.x *= 1.08; v.z *= 1.08; }
      // drippy lumps
      v.y += Math.max(0, n) * 0.06 * clamp(v.y);
      void r;
    });
    rig.add('body', 'slime', g, {}, {
      anim: (v) => smooth(0.05, 0.4, v.y),
      cfn: (v) => { const k = 0.45 + v.y * 0.7; return [0.22 * k, 0.75 * k, 0.12 * k]; },
    });
    // glowing nucleus
    rig.add('body', 'spirit', G.sph(0.16, 14, 10), { y: 0.42 }, { c: HDR(0x5aff2a, 0.22) });
    // floating debris: skull, bones, rusty blade, coins
    rig.add('deb0', 'bone', skullGeo(), { s: 1.6, ry: 0.4 }, { c: [1.3, 1.25, 1.1] });
    rig.add('deb0', 'glow', G.sph(0.014, 5, 4), { x: 0.04, y: 0.0, z: 0.105, s: 1.6 }, { c: HDR(0x8aff3a, 4) });
    rig.add('deb0', 'glow', G.sph(0.014, 5, 4), { x: -0.04, y: 0.0, z: 0.105, s: 1.6 }, { c: HDR(0x8aff3a, 4) });
    rig.add('deb1', 'bone', mergeRaw([xf(G.cyl(0.018, 0.018, 0.34, 6), {}), xf(G.sph(0.03, 6, 5), { y: 0.17, sx: 1.4 }), xf(G.sph(0.028, 6, 5), { y: -0.17, sx: 1.4 })]), { rz: 1.1, rx: 0.4 }, { c: 0xc8bba0 });
    rig.add('deb2', 'bone', mergeRaw([0, 1, 2, 3].map((i) => xf(G.tor(0.1 - i * 0.012, 0.009, 4, 10, Math.PI * 0.9), { y: i * 0.035, rx: 1.3 }))), { rz: 0.4 }, { c: 0xc8bba0 });
    rig.add('deb3', 'iron', mergeRaw([xf(G.box(0.04, 0.3, 0.008), { y: 0.1 }), xf(G.box(0.1, 0.02, 0.02), { y: -0.05 })]), { rz: 2.2, rx: 0.5 }, { c: RUSTY });
    rig.add('deb4', 'gold', mergeRaw([0, 1, 2, 3, 4].map((i) => xf(G.cyl(0.02, 0.02, 0.005, 8), { x: (i % 3) * 0.04, y: i * 0.02, z: (i % 2) * 0.03, rx: i }))), {}, { c: 0xffffff });
    for (let i = 0; i < 6; i++) rig.add('bub' + i, 'spirit', G.sph(0.03 + (i % 3) * 0.012, 8, 6), {}, { c: HDR(0xb0ff80, 0.5) });
    rig.socket('muzzle', 'body', 0, 0.7, 0.35);
    return {};
  },
  pose(m, s, P, dt) {
    const T = m.time, st = m.state, anim = s.anim, p = s.progress;
    let rate = 10;
    const spd = anim === 'death' ? 0 : s.speed;
    if (spd > 0.01) st.phase += (TAU * spd * dt) / 0.8;
    const mw = smooth(0.05, 0.4, spd);
    st.moveW = (st.moveW ?? 0) + (mw - (st.moveW ?? 0)) * (1 - Math.exp(-6 * dt));
    const w = st.moveW;
    const br = Math.sin(T * 2.3 + m.seed * 6);
    let sy = 1 + br * 0.05 + Math.sin(st.phase) * 0.13 * w;
    let sz = 1 + Math.cos(st.phase) * 0.06 * w;
    let wob = 0.035 + w * 0.025;
    P.r('body', 0.08 * w, Math.sin(T * 0.4) * 0.2, Math.sin(T * 0.9) * 0.03);
    if (anim === 'windup') {
      sy *= lerp(1, 0.68, smooth(0, 0.7, p)); sz *= 1.05; wob = 0.07;
      P.r('body', -0.18 * p); P.p('base', 0, 0, -0.12 * p);
      sy += Math.sin(T * 30) * 0.02 * p;
      rate = 8;
    } else if (anim === 'attack' || anim === 'cast') {
      const fly = bump(0, 0.55, p), land = bump(0.4, 0.85, p);
      P.p('base', 0, fly * 0.25, easeOut(p / 0.5) * 0.9 * (1 - smooth(0.7, 1, p) * 0.6));
      sz *= 1 + fly * 0.45; sy *= 1 - fly * 0.15 - land * 0.4;
      P.r('body', 0.25 * fly);
      wob = 0.09;
      rate = 22;
    } else if (anim === 'stagger') {
      const k = s.t < 0.06 ? s.t / 0.06 : Math.exp(-(s.t - 0.06) * 5);
      sy *= 1 - 0.25 * k + Math.sin(s.t * 30) * 0.08 * k; P.r('body', -0.25 * k, 0, 0.15 * k); wob = 0.1; rate = 30;
    } else if (anim === 'death') {
      const e = easeOut(p);
      sy = lerp(sy, 0.1, e); wob = 0.06 * (1 - e);
      m.setOpacity(1 - 0.45 * e);
      rate = 8;
    } else if (anim === 'spawn') {
      const e = easeOut(p);
      sy = lerp(0.08, 1, e) + Math.sin(p * 12) * 0.12 * (1 - p);
      m.setOpacity(0.4 + 0.6 * e);
      rate = 18;
    }
    const sxz = Math.min(1.55, 1 / Math.sqrt(Math.max(0.1, sy)));
    P.sc('body', sxz, sy, sxz * sz);
    m.U.uWobble.value += (wob - m.U.uWobble.value) * Math.min(1, dt * 6);
    // debris drifting inside
    const dead = anim === 'death' ? easeOut(p) : 0;
    const pos = [[0.05, 0.5, 0.12], [-0.15, 0.32, -0.05], [0.14, 0.28, -0.12], [-0.1, 0.62, 0.1], [0.08, 0.2, 0.2]];
    for (let i = 0; i < 5; i++) {
      const [x, y, z] = pos[i];
      P.p('deb' + i, x + Math.sin(T * 0.5 + i) * 0.04, (y - 0.45) + Math.sin(T * 0.7 + i * 2) * 0.04 - dead * (y - 0.1), z + Math.cos(T * 0.4 + i) * 0.04);
      P.r('deb' + i, Math.sin(T * 0.3 + i) * 0.4, T * 0.2 * (i % 2 ? 1 : -1) + i, Math.cos(T * 0.25 + i) * 0.3);
    }
    for (let i = 0; i < 6; i++) {
      const f = (T * (0.12 + i * 0.015) + i * 0.17) % 1;
      const a = i * 2.4;
      P.p('bub' + i, Math.cos(a) * 0.22 * (1 - f * 0.5), f * 0.75 * (1 - dead), Math.sin(a) * 0.2 * (1 - f * 0.5));
      P.s('bub' + i, Math.sin(f * Math.PI) * (1 - dead));
    }
    return rate;
  },
};

// --------------------------------------------------------- ghoul heads ----
function fleshCranium(o = {}) {
  const g = G.sph(0.1, 18, 14);
  deform(g, (v) => {
    v.x *= o.wide ?? 0.82; v.z *= 1.1;
    if (v.y < -0.02) { const k = clamp((-v.y - 0.02) / 0.08); v.x *= 1 - k * 0.3; v.z *= 1 - k * 0.1; }
    if (v.z > 0.03) {
      const d2 = (Math.abs(v.x) - 0.034) ** 2 + (v.y - 0.0) ** 2;
      v.z -= Math.exp(-d2 / 0.0006) * (o.sunk ?? 0.03);
      // brow ridge
      v.z += Math.exp(-((v.y - 0.03) ** 2) / 0.0002) * 0.012;
      // cheek hollows
      v.x *= 1 - Math.exp(-((v.y + 0.04) ** 2) / 0.0008) * 0.1;
    }
  });
  return bumpy(g, o.bump ?? 0.004, 20, o.seed ?? 3);
}
function addMonsterJaw(rig, jaw, o = {}) {
  const c = o.c, s = o.s ?? 1;
  const jg = G.box(0.085, 0.03, 0.1, 2, 1, 3);
  deform(jg, (v) => { const t = clamp((v.z + 0.05) / 0.1); v.x *= 1 - t * 0.35; v.y -= t * 0.006; });
  rig.add(jaw, o.mat ?? 'skin', jg, { y: -0.012 * s, z: 0.048 * s, s }, { c });
  rig.add(jaw, 'dark', G.box(0.06, 0.012, 0.08), { y: 0.006 * s, z: 0.05 * s, s });
  for (let i = 0; i < (o.teeth ?? 8); i++) {
    const a = (i / ((o.teeth ?? 8) - 1) - 0.5) * 2.0;
    rig.add(jaw, 'bone', G.cone(0.006, o.toothLen ?? 0.025, 4), { x: Math.sin(a) * 0.035 * s, y: 0.012 * s, z: (0.055 + Math.cos(a) * 0.04) * s, s }, { c: o.toothC ?? 0xcfc49a });
  }
}
function ghoulHead(rig, o = {}) {
  const c = o.c, s = o.s ?? 1;
  rig.add('head', 'skin', fleshCranium({ sunk: 0.032 }), { y: 0.1 * s, z: 0.01, s }, { c });
  rig.add('head', 'dark', G.box(0.05, 0.03, 0.02), { y: 0.06 * s, z: 0.095 * s, s }); // mouth cavity
  rig.pair('head', 'head', 'dark', G.box(0.007, 0.02, 0.01), { x: 0.007 * s, y: 0.085 * s, z: 0.11 * s, rz: 0.3, s }); // nose slits
  rig.pair('head', 'head', 'dark', G.sph(0.02, 8, 6), { x: 0.034 * s, y: 0.1 * s, z: 0.074 * s, s });
  rig.pair('head', 'head', 'glow', G.sph(0.0125, 8, 6), { x: 0.034 * s, y: 0.1 * s, z: 0.086 * s, s }, { c: HDR(o.eye ?? 0xd8ffe0, 5) });
  for (let i = 0; i < 8; i++) {
    const a = (i / 7 - 0.5) * 2.0;
    rig.add('head', 'bone', G.cone(0.006, 0.028, 4), { x: Math.sin(a) * 0.033 * s, y: 0.05 * s, z: (0.065 + Math.cos(a) * 0.035) * s, rx: Math.PI, s }, { c: 0xcfc49a });
  }
  // pointed ears
  rig.pair('head', 'head', 'skin', xf(G.cone(0.025, 0.09, 5), { sz: 0.35 }), { x: 0.08 * s, y: 0.12 * s, z: -0.0, rz: -1.15, ry: -0.3, s }, { c });
  addMonsterJaw(rig, 'jaw', { c, s, teeth: 8 });
  // lank wet hair strands
  const R = rng(o.seed ?? 11);
  for (let i = 0; i < (o.hair ?? 7); i++) {
    const a = (R() > 0.5 ? 1 : -1) * (0.9 + R() * 1.6);
    const x = Math.sin(a) * 0.08, z = Math.cos(a) * 0.08 - 0.01;
    const len = 0.12 + R() * 0.16;
    rig.add('head', 'leather', tube([[x, 0.18, z], [x * 1.25, 0.13, z * 1.2], [x * 1.3, 0.16 - len, z * 1.25 - 0.02]], 0.006, 6, 3), { s }, { c: [0.25, 0.3, 0.25], anim: (v) => clamp((0.15 - v.y) * 3) });
  }
}

// ---------------------------------------------------------------- ghoul ----
const GHOUL_SKIN = [0.26, 0.42, 0.34];
export const ghoul = {
  id: 'ghoul', height: 1.65, radius: 0.42, eyeColor: 0xd8ffe0, defaultAttack: 'claw', attackTypes: ['claw', 'swipe', 'bite'],
  flutter: 0.04,
  build(rig) {
    const D = humanSkeleton(rig, { thigh: 0.45, shin: 0.44, spine: 0.15, chest: 0.32, neck: 0.11, shoulderW: 0.19, upper: 0.33, fore: 0.31, jaw: [0.06, 0.02] });
    const rot = (v) => { const n = vnoise(v.x * 7 + 3, v.y * 7, v.z * 7, 21), n2 = vnoise(v.x * 23, v.y * 23, v.z * 23, 5); const k = 0.8 + n2 * 0.35; return n > 0.66 ? [0.12 * k, 0.17 * k, 0.11 * k] : [GHOUL_SKIN[0] * k, GHOUL_SKIN[1] * k, GHOUL_SKIN[2] * k]; };
    addFleshBody(rig, D, { c: GHOUL_SKIN, cfn: rot, gaunt: 1, muscle: 0.78, claws: 0.075, toeClaws: true, ribC: [0.5, 0.6, 0.56], hunch: 0.05, seed: 5, rough: 1.4 });
    ghoulHead(rig, { c: GHOUL_SKIN });
    // spine bumps
    rig.add('hips', 'skin', mergeRaw([0, 1, 2, 3, 4, 5, 6].map((i) => xf(G.sph(0.018, 6, 4), { y: 0.1 + i * 0.055, z: -0.105 - Math.sin(i / 6 * Math.PI) * 0.015 }))), {}, { c: GHOUL_SKIN });
    // rope belt + tattered loincloth
    rig.add('hips', 'leather', xf(G.tor(0.135, 0.012, 5, 18), { rx: Math.PI / 2, sz: 0.72 }), { y: 0.0 }, { c: 0x5a4a32 });
    rig.add('hips', 'cloth', panel(0.2, 0.4, { tatter: 0.45, seed: 3, curve: 0.04, taperBot: 0.7 }), { y: 0.0, z: 0.1 }, { c: 0x4a4434, anim: (v) => -v.y * 0.9 });
    rig.add('hips', 'cloth', panel(0.22, 0.32, { tatter: 0.5, seed: 8, curve: -0.04, taperBot: 0.6 }), { y: 0.0, z: -0.09 }, { c: 0x3c3a2c, anim: (v) => -v.y * 0.9 });
    // drowned: hanging weed and barnacles
    const R = rng(21);
    for (const [b, x, y, z, len] of [['armL', 0.03, -0.05, 0.02, 0.3], ['armR', -0.02, -0.08, -0.02, 0.25], ['chest', 0.12, 0.26, -0.06, 0.35], ['foreL', 0.02, -0.12, 0, 0.2]]) {
      rig.add(b, 'cloth', tube([[x, y, z], [x + 0.02, y - len * 0.5, z + 0.02], [x - 0.01, y - len, z]], 0.008, 8, 3), {}, { c: 0x203a18, anim: (v) => clamp((y - v.y) * 3) });
    }
    rig.add('armL', 'stone', mergeRaw(Array.from({ length: 7 }, () => xf(G.cone(0.012, 0.018, 5), { x: 0.04 + R() * 0.03, y: -0.02 - R() * 0.12, z: (R() - 0.5) * 0.06, rz: -1.2 }))), {}, { c: 0x9a9a8a });
    rig.socket('muzzle', 'handR', 0, -0.12, 0.02);
    return D;
  },
  pose: humanoidPose,
  anim: {
    death: 'fall', spawn: 'rise', armSwing: 0.25, knee: 1.0, stride: 0.6, armOut: 0.18,
    stance: (P) => {
      P.apply({ spine: [0.42, 0, 0], chest: [0.38, 0, 0], neck: [-0.5, 0, 0], head: [-0.32, 0, 0], thighL: [-0.38, 0, 0.06], thighR: [-0.3, 0, -0.06], shinL: [0.6, 0, 0], shinR: [0.52, 0, 0], footL: [-0.22, 0, 0], footR: [-0.22, 0, 0], hips: [0.08, 0, 0, 0, -0.09, -0.04], armL: [-0.35, 0, 0], armR: [-0.3, 0, 0], foreL: [-0.45, 0, 0], foreR: [-0.4, 0, 0], handL: [-0.3, 0, 0], handR: [-0.3, 0, 0] });
    },
    extra: (P, m, s, dt, k) => {
      if (!k.action) P.r('jaw', 0.15 + Math.sin(m.time * 1.3) * 0.08);
      P.r('foreL', 0, Math.sin(m.time * 0.8) * 0.1); // twitchy fingers
    },
  },
};

// ---------------------------------------------------------- bilespitter ----
const BILE_SKIN = [0.62, 0.62, 0.4];
const BILE = 0x9bff2a;
export const bilespitter = {
  id: 'bilespitter', height: 1.72, radius: 0.5, eyeColor: 0xc8ff40, magicColor: BILE, defaultAttack: 'spit', attackTypes: ['spit', 'swing'], orbSize: 0.08,
  build(rig) {
    const D = humanSkeleton(rig, { thigh: 0.42, shin: 0.4, spine: 0.2, chest: 0.3, neck: 0.06, shoulderW: 0.21, upper: 0.28, fore: 0.27, hipW: 0.12, jaw: [0.045, 0.03] });
    rig.bone('belly', 'hips', 0, 0.08, 0.08, { rate: 0.6 });
    const mott = (v) => { const n = vnoise(v.x * 9, v.y * 9, v.z * 9, 4); const k = 0.8 + 0.3 * n; return n > 0.68 ? [0.55, 0.62, 0.35] : [0.66 * k, 0.66 * k, 0.45 * k]; };
    addFleshBody(rig, D, { c: BILE_SKIN, muscle: 1.25, seed: 9, rough: 1.6, belly: 0.06, depth: 1.15 });
    // distended belly: taut, sagging flesh sac lit from within by glowing veins and blisters
    const sac = deform(bumpy(G.sph(0.25, 26, 18), 0.014, 6, 2), (v) => { if (v.y < 0) { v.y *= 1.18; v.z += v.y * 0.2; } if (v.z < 0) v.z *= 0.45; });
    rig.add('belly', 'skin', sac, { z: 0.05, sy: 0.95 }, { anim: 0.3, cfn: (v) => { const n = vnoise(v.x * 9, v.y * 9, v.z * 9, 6); const k = 0.85 + n * 0.3; return n > 0.6 ? [0.42 * k, 0.5 * k, 0.2 * k] : [0.62 * k, 0.6 * k, 0.32 * k]; } });
    rig.add('belly', 'spirit', deform(G.sph(0.262, 20, 14), (v) => { if (v.y < 0) { v.y *= 1.18; v.z += v.y * 0.2; } if (v.z < 0) v.z *= 0.45; }), { z: 0.05, sy: 0.95 }, { c: HDR(BILE, 0.12) });
    const R = rng(12);
    const veins = [];
    for (let i = 0; i < 6; i++) {
      const a = -1.2 + i * 0.48 + (R() - 0.5) * 0.3, pts = [];
      for (let k = 0; k <= 5; k++) { const t = -1.0 + k * 0.38; const rr = 0.255; pts.push([Math.sin(a + (R() - 0.5) * 0.35) * Math.cos(t) * rr, Math.sin(t) * rr * 1.1, 0.05 + Math.max(0.05, Math.cos(a) * Math.cos(t)) * rr * 0.98]); }
      veins.push(tube(pts, (u) => 0.0045 * (1 - Math.abs(u - 0.5)), 12, 3));
      const mid = pts[2 + (i % 2)]; veins.push(tube([mid, [mid[0] + (R() - 0.5) * 0.12, mid[1] - 0.05, mid[2]], [mid[0] + (R() - 0.5) * 0.18, mid[1] - 0.1, mid[2] - 0.03]], 0.003, 6, 3));
    }
    rig.add('belly', 'glow', mergeRaw(veins), { sy: 0.95 }, { c: HDR(BILE, 1.0) });
    // stretch-mark navel
    rig.add('belly', 'dark', xf(G.sph(0.02, 6, 4), { sz: 0.4 }), { y: 0.02, z: 0.3 });
    // pustules
    const pust = [], pustG = [];
    for (const [b, n, r, y0, y1] of [['chest', 9, 0.16, 0.05, 0.3], ['armL', 4, 0.06, -0.25, 0], ['armR', 4, 0.06, -0.25, 0], ['thighL', 3, 0.08, -0.3, 0], ['neck', 2, 0.06, 0, 0.08]]) {
      for (let i = 0; i < n; i++) {
        const a = R() * TAU, y = lerp(y0, y1, R());
        const pos = { x: Math.sin(a) * r * (b === 'chest' ? 1 : 1), y, z: Math.cos(a) * r * (b === 'chest' ? 0.7 : 1) };
        const sz = 0.018 + R() * 0.02;
        pust.push([b, xf(G.sph(sz, 7, 5), pos)]);
        pustG.push([b, xf(G.sph(sz * 0.55, 5, 4), { ...pos, x: pos.x * 1.08, z: pos.z * 1.08 })]);
      }
    }
    for (const [b, g] of pust) rig.add(b, 'skin', g, {}, { c: [0.75, 0.75, 0.38] });
    for (const [b, g] of pustG) rig.add(b, 'glow', g, {}, { c: HDR(BILE, 2.2) });
    // swollen bald head with wide maw
    rig.add('head', 'skin', bumpy(xf(G.sph(0.11, 16, 12), { sx: 1.05, sy: 0.95, sz: 1.0 }), 0.012, 8, 4), { y: 0.11, z: 0.0 }, { cfn: mott });
    rig.add('head', 'skin', bumpy(G.sph(0.06, 10, 8), 0.01, 10, 3), { x: -0.06, y: 0.17, z: 0.03 }, { c: [0.75, 0.72, 0.42] });
    rig.add('head', 'dark', G.box(0.08, 0.04, 0.04), { y: 0.065, z: 0.08 });
    rig.pair('head', 'head', 'dark', G.sph(0.016, 6, 5), { x: 0.035, y: 0.125, z: 0.085 });
    rig.pair('head', 'head', 'glow', G.sph(0.01, 6, 5), { x: 0.036, y: 0.125, z: 0.096 }, { c: HDR(0xd8ff40, 5) });
    for (let i = 0; i < 9; i++) { const a = (i / 8 - 0.5) * 2.2; rig.add('head', 'bone', G.cone(0.007, 0.022, 4), { x: Math.sin(a) * 0.045, y: 0.07, z: 0.06 + Math.cos(a) * 0.04, rx: Math.PI }, { c: 0xb0a060 }); }
    addMonsterJaw(rig, 'jaw', { c: [0.6, 0.6, 0.4], s: 1.25, teeth: 9 });
    // drool
    rig.add('jaw', 'slime', tube([[0.02, 0, 0.1], [0.025, -0.08, 0.11], [0.02, -0.16, 0.1]], (u) => 0.008 * (1 - u * 0.5), 6, 4), {}, { c: [0.5, 1.2, 0.3], anim: 1 });
    // filthy rag belt / apron scrap and wrist wraps
    rig.add('hips', 'cloth', panel(0.3, 0.32, { tatter: 0.45, seed: 6, curve: 0.1 }), { y: -0.02, z: 0.14 }, { c: 0x4a4030, anim: (v) => -v.y });
    rig.add('hips', 'leather', xf(G.tor(0.16, 0.016, 5, 18), { rx: Math.PI / 2, sz: 0.8 }), { y: -0.01 }, { c: 0x3a2c1e });
    rig.add('foreL', 'cloth', G.cyl(0.045, 0.04, 0.12, 8, true), { y: -0.2 }, { c: 0x6a5a40 });
    rig.socket('muzzle', 'jaw', 0, 0.03, 0.14);
    return D;
  },
  pose: humanoidPose,
  anim: {
    death: 'fallBack', spawn: 'rise', gait: 'plod', armSwing: 0.35, armOut: 0.3, stride: 0.45,
    stance: (P) => P.apply({ spine: [-0.08, 0, 0], chest: [0.18, 0, 0], neck: [-0.15, 0, 0], head: [0.05, 0, 0], thighL: [0, 0, 0.08], thighR: [0, 0, -0.08], foreL: [-0.3, 0, 0], foreR: [-0.3, 0, 0] }),
    actions: {
      spit: act2(
        { neck: [-0.4, 0, 0], head: [-0.5, 0, 0], jaw: [0.5, 0, 0], chest: [-0.3, 0, 0], spine: [-0.1, 0, 0], armR: [0.2, 0, -0.6], armL: [0.2, 0, 0.6], foreR: [-0.6, 0, 0], foreL: [-0.6, 0, 0] },
        { neck: [0.4, 0, 0], head: [0.3, 0, 0], jaw: [1.0, 0, 0], chest: [0.35, 0, 0], spine: [0.15, 0, 0], armR: [0.4, 0, -0.4], armL: [0.4, 0, 0.4], hips: [0, 0, 0, 0, -0.04, 0.08] },
        { hit: 0.2, tremble: 0.04, windupExtra: (P, p, m) => { P.s('belly', 1 + 0.14 * p + Math.sin(m.time * 22) * 0.05 * p); m.setOrb(0.2 + 0.7 * p); }, strikeExtra: (P, p, m) => { P.s('belly', 1 - 0.12 * bump(0, 0.4, p)); m.setOrb(1 - smooth(0.05, 0.3, p)); } },
      ),
    },
    extra: (P, m, s, dt, k) => {
      P.s('belly', 1 + Math.sin(m.time * 2.6) * 0.035);
      if (!k.action) P.r('jaw', 0.2 + Math.sin(m.time * 0.9) * 0.08);
    },
  },
};

// ------------------------------------------------------------ rat-men ----
function ratTail(rig, from, n, seg, r0, c = [0.95, 0.6, 0.56]) {
  let prev = from;
  for (let i = 0; i < n; i++) { rig.bone('tail' + i, prev, 0, i === 0 ? -0.02 : -seg * 0.25, i === 0 ? -0.12 : -seg, { rate: 0.7 }); prev = 'tail' + i; }
  const pts = [];
  for (let i = 0; i <= n; i++) pts.push([0, -0.02 - i * seg * 0.25, -0.1 - i * seg]);
  const chain = [[from, 0.08], ...Array.from({ length: n }, (_, i) => ['tail' + i, 0.12 + i * seg])];
  rig.add(from, 'skin', tube(pts, (u) => r0 * (1 - u * 0.85), n * 4, 6), {}, {
    skin: chainSkin(chain, (v) => -v.z),
    cfn: (v) => { const k = 0.85 + 0.15 * Math.sin(v.z * 140); return [c[0] * k, c[1] * k, c[2] * k]; },
  });
}
function tailSway(P, m, n, w = 0) {
  for (let i = 0; i < n; i++) P.r('tail' + i, 0.12 + Math.sin(m.time * 1.7 - i * 0.6) * 0.06, Math.sin(m.time * (1.3 + w * 3) - i * 0.7) * (0.12 + i * 0.03), 0);
}

const SHAMAN_GLOW = 0x6aff3a;
export const ratShaman = {
  id: 'ratShaman', height: 1.6, radius: 0.4, eyeColor: SHAMAN_GLOW, magicColor: SHAMAN_GLOW, defaultAttack: 'cast', attackTypes: ['cast', 'summon', 'swing'], orbSize: 0.075, flutter: 0.035,
  build(rig) {
    const D = humanSkeleton(rig, { thigh: 0.4, shin: 0.4, spine: 0.15, chest: 0.28, neck: 0.08, shoulderW: 0.17, upper: 0.27, fore: 0.26, jaw: [-0.014, 0.1] });
    const ROBE = 0x3d3a2a;
    // robe skirt + torso
    rig.add('hips', 'cloth', robe(0.17, 0.32, D.hipH - 0.08, { seg: 20, rows: 6, folds: 6, foldAmp: 0.1, tatter: 0.22, seed: 3 }), { y: 0.02 }, { c: ROBE, anim: (v) => clamp(-v.y / 0.7) });
    rig.add('hips', 'cloth', lathe([[0.17, 0.0], [0.16, 0.12], [0.17, 0.2]], 14), {}, { c: ROBE });
    rig.add('chest', 'cloth', lathe([[0.15, -0.05], [0.18, 0.12], [0.2, 0.22], [0.12, 0.3], [0.06, 0.32]], 14), { sz: 0.8 }, { c: ROBE });
    // ragged mantle
    rig.add('chest', 'cloth', robe(0.1, 0.27, 0.3, { seg: 16, rows: 3, folds: 5, foldAmp: 0.12, tatter: 0.35, seed: 9 }), { y: D.chest + 0.02, sz: 0.85 }, { c: 0x2e2c22, anim: (v) => clamp(-v.y * 2.5) * 0.6 });
    // hood
    const h = hood(0.14, 0.12, { open: 0.24, peak: 1.0 });
    rig.add('head', 'cloth', h.shell, { y: 0.06, z: -0.0, rx: -0.15 }, { c: 0x34301f });
    // rat head poking out
    ratHead(rig, { s: 1.35, mat: 'fur', eye: SHAMAN_GLOW, notch: true, muzzle: false });
    // sleeves + clawed pink hands
    for (const S of ['L', 'R']) {
      const sx = S === 'L' ? 1 : -1;
      rig.add('arm' + S, 'cloth', robe(0.06, 0.075, D.upper + 0.02, { seg: 10, rows: 2, folds: 4, tatter: 0.0, seed: 2 }), {}, { c: ROBE });
      rig.add('fore' + S, 'cloth', robe(0.065, 0.1, D.fore * 0.85, { seg: 10, rows: 2, folds: 4, tatter: 0.35, seed: 5 + sx }), {}, { c: ROBE, anim: (v) => clamp(-v.y * 3) * 0.5 });
      addFleshHand(rig, 'hand' + S, sx, { mat: 'skin', c: [0.95, 0.62, 0.58], m: 0.85, claws: 0.035, clawC: 0x2a2018, grip: S === 'R' });
      rig.add('foot' + S, 'skin', xf(G.sph(0.04, 8, 6), { y: -0.04, z: 0.05, sx: 0.9, sy: 0.5, sz: 2.0 }), {}, { c: [0.9, 0.58, 0.55] });
      for (let i = 0; i < 3; i++) rig.add('foot' + S, 'bone', G.cone(0.006, 0.035, 4), { x: (i - 1) * 0.02, y: -0.06, z: 0.13, rx: Math.PI / 2 + 0.4 }, { c: 0x2a2018 });
      rig.add('shin' + S, 'skin', taper(0.035, 0.025, D.shin, 6, 2), {}, { c: [0.75, 0.5, 0.45] });
    }
    // rope belt with pouches and bone charms
    rig.add('hips', 'leather', xf(G.tor(0.17, 0.013, 5, 18), { rx: Math.PI / 2, sz: 0.8 }), { y: 0.12 }, { c: 0x6a5434 });
    rig.add('hips', 'leather', xf(G.sph(0.05, 8, 6), { sy: 1.2 }), { x: 0.13, y: 0.06, z: 0.08 }, { c: 0x4a3420 });
    rig.add('hips', 'bone', mergeRaw([0, 1, 2].map((i) => xf(G.cyl(0.006, 0.006, 0.09, 4), { x: -0.08 + i * 0.03, y: 0.06, z: 0.13, rz: (i - 1) * 0.2 }))), {}, { c: 0xd8ccb0 });
    rig.add('chest', 'bone', mergeRaw(Array.from({ length: 9 }, (_, i) => { const a = (i / 8 - 0.5) * 2.2; return xf(G.cone(0.008, 0.035, 4), { x: Math.sin(a) * 0.13, y: D.chest - 0.06 - Math.cos(a) * 0.04, z: Math.cos(a) * 0.11, rx: Math.PI }); })), {}, { c: 0xe0d4b8 });
    ratTail(rig, 'hips', 6, 0.1, 0.03);
    // bone staff with skull and floating crystal
    const staffL = 1.55, grip = 0.5;
    const R = rng(4);
    const sp = []; for (let i = 0; i <= 8; i++) { const t = i / 8; sp.push([(R() - 0.5) * 0.03, (R() - 0.5) * 0.02, (t - grip) * staffL]); }
    const st0 = { y: -0.07 };
    rig.add('handR', 'bone', tube(sp, (u) => 0.02 * (1.1 - u * 0.3), 16, 6), st0, { c: 0xbdb096 });
    const tip = (1 - grip) * staffL;
    rig.add('handR', 'bone', skullGeo(), { ...st0, z: tip - 0.02, rx: -Math.PI / 2, s: 0.9 }, { c: 0xd8ccb0 });
    rig.add('handR', 'bone', mergeRaw([0, 1, 2, 3].map((i) => xf(G.cone(0.01, 0.12, 4), { x: Math.cos(i * 1.57) * 0.05, y: Math.sin(i * 1.57) * 0.05, z: tip + 0.1, rx: Math.PI / 2, rz: 0 }))), st0, { c: 0xbdb096 });
    rig.add('handR', 'leather', mergeRaw([xf(G.cyl(0.026, 0.026, 0.1, 6), { rx: Math.PI / 2, z: -0.0 }), xf(G.tor(0.024, 0.006, 4, 8), { z: tip - 0.12 })]), st0, { c: 0x4a3420 });
    rig.add('handR', 'glow', G.oct(0.04), { ...st0, z: tip + 0.17, sz: 1.6 }, { c: HDR(SHAMAN_GLOW, 3.5) });
    rig.add('handR', 'glow', mergeRaw([xf(G.sph(0.012, 5, 4), { x: 0.035, z: tip - 0.02, y: 0.01 }), xf(G.sph(0.012, 5, 4), { x: -0.035, z: tip - 0.02, y: 0.01 })]), { ...st0 }, { c: HDR(SHAMAN_GLOW, 4) });
    // dangling fetish
    rig.add('handR', 'leather', tube([[0.03, 0, tip - 0.12], [0.05, -0.05, tip - 0.14], [0.05, -0.12, tip - 0.15]], 0.004, 6, 3), st0, { c: 0x3a2a1a, anim: 1 });
    rig.socket('muzzle', 'handR', 0, -0.07, tip + 0.17);
    return D;
  },
  pose: humanoidPose,
  anim: {
    death: 'fall', spawn: 'rise', armSwing: 0.2, knee: 0.9, stride: 0.5, caster: true, idleOrb: 0.15,
    rest: { armR: [-0.35, 0, -0.05], foreR: [-1.05, 0, 0], handR: [0.2, 0, 0], armL: [-0.2, 0, 0.1], foreL: [-0.8, 0, 0] },
    stance: (P) => P.apply({ spine: [0.25, 0, 0], chest: [0.25, 0, 0], neck: [-0.25, 0, 0], head: [-0.25, 0, 0], thighL: [-0.2, 0, 0], thighR: [-0.2, 0, 0], shinL: [0.35, 0, 0], shinR: [0.35, 0, 0], footL: [-0.15, 0, 0], footR: [-0.15, 0, 0], hips: [0, 0, 0, 0, -0.04, 0] }),
    actions: {
      cast: act2(
        { armR: [-0.3, 0, -0.3], foreR: [-1.6, 0, 0], handR: [0.3, 0, 0], armL: [-1.0, 0, 0.6], foreL: [-0.9, 0, 0], chest: [-0.15, -0.3, 0], head: [-0.05, 0.2, 0], spine: [-0.05, 0, 0] },
        { armR: [-1.35, 0, 0.2], foreR: [-0.5, 0, 0], handR: [0.2, 0, 0], armL: [-0.5, 0, 0.3], foreL: [-0.6, 0, 0], chest: [0.15, 0.2, 0], spine: [0.1, 0, 0], head: [-0.1, -0.15, 0], hips: [0, 0, 0, 0, -0.03, 0.08] },
        { hit: 0.3, recover: 0.85, recoverAmt: 0.25, windupExtra: (P, p, m) => P.r('jaw', 0.4 * p + Math.sin(m.time * 25) * 0.1 * p) },
      ),
      summon: act2(
        { armR: [-0.7, 0, -0.2], foreR: [-1.2, 0, 0], handR: [0.4, 0, 0], armL: [-0.6, 0, 0.4], foreL: [-1.3, 0, 0], chest: [0.2, 0, 0], head: [0.2, 0, 0] },
        { armR: [-2.6, 0, -0.2], foreR: [-0.1, 0, 0], handR: [0.2, 0, 0], armL: [-2.4, 0, 0.5], foreL: [-0.3, 0, 0], chest: [-0.3, 0, 0], head: [-0.5, 0, 0], jaw: [0.6, 0, 0] },
        { hit: 0.4, recover: 0.85 },
      ),
    },
    extra: (P, m, s, dt, k) => { tailSway(P, m, 6, k.w); if (!k.action) P.r('jaw', Math.max(0, Math.sin(m.time * 11)) * 0.05); },
  },
};

// --------------------------------------------------------------- ratOgre ----
export const ratOgre = {
  id: 'ratOgre', height: 2.8, radius: 0.9, eyeColor: RAT_EYE, elite: true, defaultAttack: 'slam', attackTypes: ['slam', 'swing', 'roar'],
  build(rig) {
    const D = humanSkeleton(rig, { thigh: 0.62, shin: 0.6, ankle: 0.1, hipW: 0.2, spine: 0.3, chest: 0.55, neck: 0.12, shoulderW: 0.42, shoulderDrop: 0.08, upper: 0.52, fore: 0.5, jaw: [-0.023, 0.17] });
    const HIDE = [0.42, 0.3, 0.29];
    addFleshBody(rig, D, { c: HIDE, muscle: 2.3, seed: 13, rough: 2.5, hunch: 0.12, depth: 1.1, claws: 0.06, toeClaws: true, grip: { R: true } });
    // shaggy fur mantle over hunched back and shoulders
    const mantle = shaggy(xf(G.sph(0.42, 24, 16, 0, TAU, 0, Math.PI * 0.6), { sx: 1.05, sz: 0.9 }), 0.09, 7, 3, [0, -0.3, -1], 0.8);
    rig.add('chest', 'fur', mantle, { y: D.chest * 0.62, z: -0.08, rx: -0.35 }, { c: FUR });
    for (const S of ['L', 'R']) {
      rig.add('fore' + S, 'fur', shaggy(xf(G.sph(0.11, 12, 10), { sy: 1.6 }), 0.04, 9, 4, [0, 1, 0], 0.4), { y: -0.18, z: -0.03 }, { c: FUR });
      rig.add('thigh' + S, 'fur', shaggy(xf(G.sph(0.16, 12, 10), { sy: 1.5 }), 0.05, 8, 2, [0, -1, -0.5], 0.5), { y: -0.18 }, { c: [0.28, 0.22, 0.17] });
    }
    // stitched hide: dark seams with cross stitches
    const seams = [];
    const seam = (pts) => { seams.push(tube(pts, 0.006, 12, 3)); const c = new THREE.CatmullRomCurve3(pts.map((p) => new THREE.Vector3(...p))); for (let i = 1; i < 10; i++) { const p = c.getPointAt(i / 10); const t = c.getTangentAt(i / 10); seams.push(xf(G.box(0.05, 0.006, 0.006), { x: p.x, y: p.y, z: p.z + 0.004, rz: Math.atan2(t.y, t.x) + Math.PI / 2 })); } };
    seam([[0.16, D.spine + 0.05, 0.3], [0.05, D.spine + 0.25, 0.33], [0.1, D.spine + 0.45, 0.3]]);
    seam([[-0.25, 0.1, 0.25], [-0.1, 0.22, 0.31], [0.05, 0.12, 0.31]]);
    rig.add('hips', 'leather', mergeRaw(seams), {}, { c: 0x1a120c });
    // rat head (big)
    ratHead(rig, { s: 2.3, fur: FUR, notch: true });
    rig.add('head', 'iron', xf(G.tor(0.09, 0.012, 5, 12), {}), { x: -0.13, y: 0.18, z: 0.03, ry: 1.3 }, { c: RUSTY }); // ear ring
    // spiked collar + chains
    rig.add('neck', 'leather', xf(G.cyl(0.17, 0.19, 0.1, 14, true), {}), { y: 0.02 }, { c: 0x2e2018 });
    rig.add('neck', 'iron', mergeRaw(Array.from({ length: 9 }, (_, i) => { const a = (i / 9) * TAU; return xf(G.cone(0.02, 0.07, 4), { x: Math.sin(a) * 0.19, z: Math.cos(a) * 0.19, y: 0.02, rx: Math.cos(a) * 1.57, rz: -Math.sin(a) * 1.57 }); })), {}, { c: RUSTY });
    const links = (n, from, dir, r = 0.03) => mergeRaw(Array.from({ length: n }, (_, i) => xf(G.tor(r, r * 0.28, 4, 8), { x: from[0] + dir[0] * i * r * 1.5, y: from[1] + dir[1] * i * r * 1.5, z: from[2] + dir[2] * i * r * 1.5, ry: (i % 2) * Math.PI / 2, rx: Math.atan2(dir[2], dir[1]) })));
    rig.add('foreL', 'iron', mergeRaw([0, 1, 2, 3].map((i) => xf(G.tor(0.12, 0.016, 4, 14), { y: -0.12 - i * 0.07, rx: Math.PI / 2 + (i % 2) * 0.2 }))), {}, { c: DARKSTEEL });
    rig.add('handL', 'iron', links(7, [0.06, 0, 0], [0, -1, 0.15], 0.04), {}, { c: DARKSTEEL, anim: (v) => clamp(-v.y * 2) });
    rig.add('chest', 'iron', links(16, [0.38, 0.5, 0.1], [-0.72, -0.5, 0.48], 0.035), {}, { c: DARKSTEEL });
    // belt + loincloth
    rig.add('hips', 'leather', xf(G.cyl(0.36, 0.36, 0.1, 16, true), { sz: 0.75 }), { y: 0.0 }, { c: 0x3a281a });
    rig.add('hips', 'iron', G.box(0.12, 0.1, 0.03), { y: 0.0, z: 0.28 }, { c: RUSTY });
    rig.add('hips', 'cloth', panel(0.45, 0.55, { tatter: 0.4, seed: 4, curve: 0.1 }), { y: -0.03, z: 0.27 }, { c: 0x40301e, anim: (v) => -v.y });
    rig.add('hips', 'leather', panel(0.55, 0.5, { tatter: 0.4, seed: 7, curve: -0.12 }), { y: -0.03, z: -0.22 }, { c: 0x3a2a1a, anim: (v) => -v.y * 0.6 });
    ratTail(rig, 'hips', 7, 0.18, 0.07);
    // huge rusty cleaver
    const cl = [[0, -0.04], [0.9, -0.06], [1.02, 0.02], [1.0, 0.36], [0.2, 0.32], [0.08, 0.1], [0, 0.06]];
    const blade = xf(new THREE.ExtrudeGeometry(new THREE.Shape(cl.map(([x, y]) => new THREE.Vector2(x, y))), { depth: 0.025, bevelEnabled: true, bevelThickness: 0.006, bevelSize: 0.006, bevelSegments: 1 }), { z: -0.0125 });
    xf(blade, { rx: Math.PI / 2, ry: -Math.PI / 2, rz: 0 });
    const t0 = { y: -0.1, z: 0.22, rx: 0 };
    rig.add('handR', 'steel', blade, { ...t0, rz: Math.PI / 2, rx: 0 }, { c: [0.75, 0.55, 0.42] });
    rig.add('handR', 'wood', xf(G.cyl(0.035, 0.04, 0.42, 8), { rx: Math.PI / 2 }), { y: -0.1, z: 0.0 }, { c: 0x6a4a30 });
    rig.add('handR', 'iron', rivets([[0.0, 0.03, 0.42], [0.0, 0.03, 0.62], [0.0, 0.03, 0.82]], 0.018), { y: -0.1 }, { c: RUSTY });
    rig.socket('muzzle', 'head', 0, 0.0, 0.5);
    return D;
  },
  pose: humanoidPose,
  anim: {
    death: 'fall', spawn: 'rise', gait: 'plod', armSwing: 0.3, armOut: 0.22, stride: 0.5, knee: 0.7,
    rest: { armR: [-0.3, 0, -0.1], foreR: [-0.6, 0, 0], handR: [0.4, 0, 0] },
    stance: (P) => P.apply({ spine: [0.25, 0, 0], chest: [0.3, 0, 0], neck: [-0.35, 0, 0], head: [-0.25, 0, 0], thighL: [-0.25, 0, 0.1], thighR: [-0.25, 0, -0.1], shinL: [0.4, 0, 0], shinR: [0.4, 0, 0], footL: [-0.15, 0, 0], footR: [-0.15, 0, 0], hips: [0, 0, 0, 0, -0.08, 0] }),
    actions: {
      slam: act2(
        { armR: [-2.9, 0.2, -0.3], foreR: [-1.0, 0, 0], handR: [-0.3, 0, 0], armL: [-0.6, 0, 0.6], foreL: [-0.8, 0, 0], chest: [-0.35, -0.3, 0], spine: [-0.2, 0, 0], head: [0.25, 0.2, 0], jaw: [0.7, 0, 0], hips: [0, 0, 0, 0, -0.04, -0.1] },
        { armR: [-0.4, 0, 0.3], foreR: [-0.2, 0, 0], handR: [0.9, 0, 0], armL: [0.3, 0, 0.6], foreL: [-0.5, 0, 0], chest: [0.55, 0.3, 0], spine: [0.35, 0.1, 0], head: [-0.3, -0.2, 0], jaw: [0.3, 0, 0], hips: [0, 0, 0, 0, -0.25, 0.25], thighR: [-0.9, 0, 0], shinR: [0.9, 0, 0], thighL: [0.2, 0, 0], shinL: [0.5, 0, 0] },
        { hit: 0.25, tremble: 0.04 },
      ),
    },
    extra: (P, m, s, dt, k) => { tailSway(P, m, 7, k.w); if (!k.action) P.r('jaw', 0.1 + Math.max(0, Math.sin(m.time * 0.7)) * 0.15); },
  },
};

export const SEWER_TYPES = [rat, slime, ghoul, bilespitter, ratShaman, ratOgre];
