import * as THREE from 'three';
import { G, xf, taper, lathe, shell, tube, deform, bumpy, shaggy, robe, panel, mergeRaw, chainSkin, vnoise, rng, clamp, lerp, smooth, bump, easeOut, TAU } from './core.js';
import { humanSkeleton, humanoidPose, act2, ACT } from './humanoid.js';
import { quadSkeleton, quadPose } from './quad.js';
import { glowLevel } from './bossKit.js';
import { addFleshBody, addFleshHand, hood, belt, HDR, RUSTY, DARKSTEEL, STEEL, axeHeadGeo, rivets, boneShade } from './parts.js';
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
  const cran = shaggy(xf(G.sph(0.07, o.lo ? 11 : 16, o.lo ? 8 : 12), { sx: 1.0, sy: 0.82, sz: 1.2 }), 0.016, 22, 5, [0, 0, -1], 0.7);
  rig.add(head, mat, cran, { y: 0.03 * s, z: 0.05 * s, s }, { c: fur });
  const sn = shaggy(xf(taper(0.056, 0.024, 0.14, o.lo ? 8 : 12, o.lo ? 2 : 3), { rx: -Math.PI / 2 + 0.2 }), 0.008, 30, 6, [0, 0, -1], 0.6);
  rig.add(head, mat, sn, { y: 0.03 * s, z: 0.08 * s, s }, { c: fur });
  const tipZ = 0.08 + 0.15 * Math.cos(0.2), tipY = 0.03 - 0.15 * Math.sin(0.2);
  rig.add(head, 'skin', G.sph(0.02, 8, 6), { y: tipY * s + 0.006 * s, z: tipZ * s, sx: 1.2, sy: 0.85, s }, { c: [1.3, 0.62, 0.6] });
  rig.pair(head, head, 'dark', G.sph(0.005, 4, 3), { x: 0.008 * s, y: (tipY + 0.008) * s, z: (tipZ + 0.017) * s, s });
  // incisors
  rig.pair(head, head, 'bone', G.box(0.012, 0.04, 0.007), { x: 0.007 * s, y: (tipY - 0.03) * s, z: (tipZ - 0.012) * s, rx: 0.2, s }, { c: TOOTH });
  // eyes (beady + glow)
  rig.pair(head, head, 'dark', G.sph(0.017, 8, 6), { x: 0.042 * s, y: 0.055 * s, z: 0.105 * s, s });
  rig.pair(head, head, 'glow', xf(G.sph(0.011, 6, 4), { sx: 1.25, sy: 0.8 }), { x: 0.048 * s, y: 0.057 * s, z: 0.113 * s, rz: -0.25, s }, { c: HDR(o.eye ?? RAT_EYE, o.eyeK ?? 6) });
  // ears
  const ear = deform(xf(G.sph(0.045, o.lo ? 7 : 10, o.lo ? 5 : 6), { sx: 0.85, sy: 1.15, sz: 0.22 }), (v) => { if (v.x > 0.02 && v.y > 0.0) v.y -= 0.012; }); // torn
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
  // A dog-sized plague rat: hunched, arched spine bristling with matted tufts, mangy raw patches and
  // sores, scabbed pink paws on thick digitigrade legs, a long scaly tail. Built cheap: packs of six.
  build(rig) {
    const Q = quadSkeleton(rig, {
      bodyH: 0.27, len: 0.32, w: 0.075, wb: 0.085, legF: [0.1, 0.1, 0.04], legB: [0.12, 0.11, 0.045],
      neck: [0.04, 0.09], head: [0.0, 0.05], jaw: [-0.012, 0.086], tail: 7, tailSeg: 0.09, tailY: 0.0, tailZ: 0.15,
      stF: [0.2, -0.35, 0.15], stB: [-0.55, 1.0, -0.45],
    });
    const bodySkin = chainSkin([['rear', -0.16], ['front', 0.16]], (v) => v.z);
    // matted body with an arched back and heavy haunches, skinned between front and rear so the spine flexes
    const body = deform(xf(G.sph(0.16, 18, 13), { sx: 0.82, sy: 0.74, sz: 1.5 }), (v) => {
      const t = v.z / 0.24;
      v.y += Math.exp(-((t + 0.15) ** 2) / 0.3) * 0.035 * clamp(v.y / 0.1 + 0.5); // arched spine
      if (v.z < 0) { v.x *= 1 + clamp(-t) * 0.12; v.y *= 1 + clamp(-t) * 0.08; } // haunches
    });
    const R = (v) => vnoise(v.x * 14, v.y * 14, v.z * 14, 3);
    rig.add('body', 'fur', shaggy(body, 0.04, 13, 4, [0, 0.15, -1], 0.8), { y: 0.03 }, {
      skin: bodySkin,
      cfn: (v) => { const n = R(v); const back = clamp(v.y / 0.12); if (n > 0.74) return [0.7, 0.38, 0.34]; const k = 0.75 + 0.35 * vnoise(v.x * 30, v.y * 30, v.z * 30, 1) - back * 0.3; return [0.4 * k, 0.33 * k, 0.27 * k]; },
    });
    // spine ridge of matted tufts
    const tufts = [];
    for (let i = 0; i < 9; i++) tufts.push(xf(G.cone(0.026, 0.075, 4), { z: 0.2 - i * 0.055, y: 0.15 - Math.abs(i - 4) * 0.008, rx: -1.1, rz: (i % 2 - 0.5) * 0.4 }));
    rig.add('body', 'fur', mergeRaw(tufts), { y: 0.03 }, { c: [0.18, 0.15, 0.12], skin: bodySkin });
    // sores and a raw, ribbed bald patch on the flank
    const sores = [];
    const rr = rng(7);
    for (let i = 0; i < 4; i++) sores.push(xf(G.sph(0.02, 5, 4), { x: (rr() > 0.5 ? 1 : -1) * (0.08 + rr() * 0.04), y: 0.04 + rr() * 0.06, z: (rr() - 0.5) * 0.36 }));
    for (let i = 0; i < 3; i++) sores.push(xf(G.tor(0.05, 0.006, 3, 8, Math.PI * 0.7), { x: 0.12, y: 0.05, z: 0.03 + i * 0.035, ry: Math.PI / 2, rz: 2.0 }));
    rig.add('body', 'skin', mergeRaw(sores), { y: 0.03 }, { c: [0.95, 0.5, 0.36], skin: bodySkin });
    // neck scruff
    rig.add('neck', 'fur', shaggy(xf(G.sph(0.08, 10, 7), { sz: 1.2 }), 0.03, 14, 8, [0, 0, -1], 0.6), { y: 0.0, z: 0.0 }, { c: FUR });
    ratHead(rig, { s: 1.15, lo: true });
    // legs: furred upper legs, thick bare lower legs and splayed, clawed paws
    for (const S of ['L', 'R']) {
      rig.add('legF' + S, 'fur', shaggy(G.sph(0.058, 8, 6), 0.02, 16, 2), { y: -0.02, sy: 1.4 }, { c: FUR });
      rig.add('legF2' + S, 'skin', taper(0.026, 0.019, 0.1, 6, 1), {}, { c: [0.72, 0.45, 0.4] });
      rig.add('legB' + S, 'fur', shaggy(G.sph(0.08, 8, 6), 0.025, 16, 4), { y: -0.03, z: 0.01, sy: 1.3 }, { c: FUR });
      rig.add('legB2' + S, 'skin', taper(0.028, 0.02, 0.11, 6, 1), {}, { c: [0.72, 0.45, 0.4] });
      for (const F of ['F', 'B']) {
        const pb = 'paw' + F + S;
        rig.add(pb, 'skin', G.sph(0.026, 6, 4), { y: -0.03, z: 0.02, sx: 1.2, sy: 0.6, sz: 1.5 }, { c: [1.05, 0.6, 0.55] });
        rig.add(pb, 'bone', mergeRaw([0, 1, 2, 3].map((i) => xf(G.cone(0.0055, 0.032, 3), { x: (i - 1.5) * 0.012, y: -0.04, z: 0.058, rx: Math.PI / 2 + 0.5 }))), {}, { c: 0x3a2e22 });
      }
    }
    // tail: one smooth tube skinned along the tail chain, ringed like scales
    const pts = [];
    for (let i = 0; i <= 8; i++) pts.push([0, -i * 0.006, -0.1 - i * 0.075]);
    const chain = [['rear', 0.1], ...Array.from({ length: Q.tail }, (_, i) => ['tail' + i, Q.tailZ + i * Q.tailSeg])];
    rig.add('rear', 'skin', tube(pts, (u) => 0.028 * (1 - u * 0.85), 18, 5), {}, {
      skin: chainSkin(chain, (v) => -v.z),
      cfn: (v) => { const k = 0.8 + 0.2 * Math.sin(v.z * 160); return [0.9 * k, 0.56 * k, 0.52 * k]; },
    });
    return Q;
  },
  pose: quadPose,
  anim: {
    gait: 'bound', stride: 0.55, legAmp: 0.6, lift: 1.1, sniff: true, tailSway: 0.22, tailDroop: 0.04, lean: 0.06, breath: 3.0,
    // hackles up: the rat hunches and bristles, hissing, before it lunges
    actions: {
      bite: (P, ph, p, m) => {
        if (ph === 'windup') {
          const k = smooth(0, 0.5, p);
          P.apply(RAT_COIL, k);
          P.r('head', Math.sin(m.time * 40) * 0.035 * p, 0, 0); P.r('jaw', Math.sin(m.time * 31) * 0.1 * p);
          for (let i = 0; i < 7; i++) P.r('tail' + i, -0.08 * k, Math.sin(m.time * 14 - i) * 0.2 * k, 0);
          return 12;
        }
        const lunge = bump(0, 0.75, p), snap = smooth(0.2, 0.32, p);
        P.p('base', 0, lunge * 0.05, lunge * 0.45);
        P.r('body', 0.08 * lunge); P.r('front', 0.12 * lunge);
        P.r('neck', 0.3 * lunge); P.r('head', 0.25 * lunge);
        P.r('jaw', 0.95 * (1 - snap) + 0.1);
        P.r('legFL', -0.8 * lunge); P.r('legFR', -0.7 * lunge); P.r('legBL', 0.5 * lunge); P.r('legBR', 0.55 * lunge);
        return 28;
      },
    },
    extra: (P, m, s, dt, k) => {
      // twitchy: whole-body shudders now and then, ears flick
      if (!k.dead && !k.action) { const sh = smooth(0.9, 1, Math.sin(m.time * 0.8 + m.seed * 9)); P.r('body', 0, 0, Math.sin(m.time * 47) * 0.04 * sh); P.r('head', 0, Math.sin(m.time * 29) * 0.1 * sh, 0); }
    },
  },
};
const RAT_COIL = { body: [-0.1, 0, 0, 0, -0.03, -0.06], front: [-0.22, 0, 0], neck: [-0.3, 0, 0], head: [-0.3, 0, 0], jaw: [0.75, 0, 0], legBL: [-0.3, 0, 0], legBR: [-0.3, 0, 0], legB2L: [0.5, 0, 0], legB2R: [0.5, 0, 0], legFL: [0.15, 0, 0], legFR: [0.15, 0, 0] };

// ---------------------------------------------------------------- slime ----
export const slime = {
  id: 'slime', height: 1.0, radius: 0.55, eyeColor: 0x8aff3a, defaultAttack: 'lunge', attackTypes: ['lunge'], wobble: true,
  build(rig) {
    rig.bone('base', null);
    rig.bone('body', 'base');
    for (let i = 0; i < 5; i++) rig.bone('deb' + i, 'body', 0, 0.37, 0);
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
      // the squashed base came out 9 cm up: it rests on the floor instead of hovering over it
      v.y -= 0.08;
      void r;
    });
    rig.add('body', 'slime', g, {}, {
      anim: (v) => smooth(0.05, 0.4, v.y),
      cfn: (v) => { const k = 0.45 + v.y * 0.7; return [0.22 * k, 0.75 * k, 0.12 * k]; },
    });
    // glowing nucleus
    rig.add('body', 'spirit', G.sph(0.16, 14, 10), { y: 0.34 }, { c: HDR(0x5aff2a, 0.22) });
    // floating debris: skull, bones, rusty blade, coins
    rig.add('deb0', 'bone', skullGeo(), { s: 1.6, ry: 0.4 }, { cfn: boneShade([1.0, 1.08, 0.85], 3, 1.4) });
    // a drowned man's rusty kettle hat still on the skull
    rig.add('deb0', 'iron', mergeRaw([lathe([[0.1, 0], [0.1, 0.05], [0.085, 0.1], [0.045, 0.13], [0.001, 0.135]], 10), xf(lathe([[0.15, -0.012], [0.15, 0.0], [0.095, 0.02]], 12), {})]), { y: 0.06, ry: 0.4, rz: 0.35, s: 1.25 }, { c: RUSTY });
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
  const c = o.c, cfn = o.cfn, s = o.s ?? 1;
  // long, narrow, skull-tight head with deep sockets, jutting cheekbones and no lips
  const cran = G.sph(0.1, 20, 16);
  deform(cran, (v) => {
    v.x *= 0.76; v.z *= 1.22; v.y *= 1.08;
    if (v.y < -0.01) { const k = clamp((-v.y - 0.01) / 0.09); v.x *= 1 - k * 0.42; v.z += k * 0.018; }
    if (v.z > 0.03) {
      const d2 = (Math.abs(v.x) - 0.033) ** 2 + (v.y - 0.012) ** 2;
      v.z -= Math.exp(-d2 / 0.0005) * 0.04;
      v.z += Math.exp(-((v.y - 0.04) ** 2) / 0.00025) * 0.014;
      v.x *= 1 - Math.exp(-((v.y + 0.035) ** 2) / 0.0007) * 0.22;
      if (Math.abs(v.x) < 0.012 && v.y > -0.03 && v.y < 0.01) v.z -= 0.012; // collapsed nose
    }
    if (v.y > 0.05 && v.z < 0) v.z -= (v.y - 0.05) * 0.35; // elongated back of the skull
  });
  rig.add('head', 'skin', bumpy(cran, 0.0035, 22, 3), { y: 0.1 * s, z: 0.015, s }, { c, cfn });
  rig.pair('head', 'head', 'skin', xf(G.sph(0.016, 7, 5), { sx: 0.6, sy: 0.45, sz: 1.6 }), { x: 0.045 * s, y: 0.08 * s, z: 0.08 * s, ry: 0.4, s }, { c }); // cheekbones
  rig.add('head', 'dark', xf(G.box(0.06, 0.028, 0.03), {}), { y: 0.055 * s, z: 0.1 * s, s }); // mouth cavity
  rig.pair('head', 'head', 'dark', G.box(0.006, 0.022, 0.012), { x: 0.007 * s, y: 0.092 * s, z: 0.124 * s, rz: 0.35, s }); // nose slits
  rig.pair('head', 'head', 'dark', G.sph(0.021, 8, 6), { x: 0.033 * s, y: 0.112 * s, z: 0.088 * s, s });
  rig.pair('head', 'head', 'glow', G.sph(0.0075, 6, 5), { x: 0.033 * s, y: 0.112 * s, z: 0.106 * s, s }, { c: HDR(o.eye ?? 0xd8ffe0, 6) });
  // upper needle teeth, uneven
  const R = rng(o.seed ?? 11);
  const tu = [];
  for (let i = 0; i < 12; i++) { const a = (i / 11 - 0.5) * 2.3; tu.push(xf(G.cone(0.0045, 0.022 + R() * 0.02, 4), { x: Math.sin(a) * 0.034, y: 0.048, z: 0.07 + Math.cos(a) * 0.036, rx: Math.PI + (R() - 0.5) * 0.3, rz: (R() - 0.5) * 0.3 })); }
  rig.add('head', 'bone', mergeRaw(tu), { s }, { c: [0.7, 0.66, 0.45] });
  // pointed, torn ears
  rig.pair('head', 'head', 'skin', xf(G.cone(0.026, 0.12, 5), { sz: 0.3 }), { x: 0.075 * s, y: 0.125 * s, z: -0.01, rz: -1.2, ry: -0.35, s }, { c });
  // long hanging jaw with needle teeth
  const jg = G.box(0.08, 0.026, 0.13, 2, 1, 4);
  deform(jg, (v) => { const t = clamp((v.z + 0.065) / 0.13); v.x *= 1 - t * 0.45; v.y -= t * 0.012; });
  rig.add('jaw', 'skin', jg, { y: -0.012 * s, z: 0.06 * s, s }, { c });
  rig.add('jaw', 'dark', G.box(0.055, 0.01, 0.1), { y: 0.004 * s, z: 0.06 * s, s });
  const tl = [];
  for (let i = 0; i < 10; i++) { const a = (i / 9 - 0.5) * 2.0; tl.push(xf(G.cone(0.0045, 0.02 + R() * 0.016, 4), { x: Math.sin(a) * 0.03, y: 0.008, z: 0.075 + Math.cos(a) * 0.045, rz: (R() - 0.5) * 0.4 })); }
  rig.add('jaw', 'bone', mergeRaw(tl), { s }, { c: [0.7, 0.66, 0.45] });
  // sparse, lank wet hair
  // strands plastered to the skull, trailing off the back of the head
  for (let i = 0; i < (o.hair ?? 7); i++) {
    const x = (R() - 0.5) * 0.11, len = 0.1 + R() * 0.14;
    rig.add('head', 'dark', tube([[x * 0.6, 0.205, 0.02], [x, 0.19, -0.07], [x * 1.2, 0.13, -0.13], [x * 1.3, 0.13 - len, -0.15 - len * 0.3]], (u) => 0.0055 * (1 - u * 0.5), 6, 3), { s }, { c: [1, 1.1, 1], anim: (v) => clamp((0.13 - v.y) * 4) });
  }
}

// ---------------------------------------------------------------- ghoul ----
const GHOUL_SKIN = [0.31, 0.44, 0.42];
// claws: both arms flung up and back, body coiled low and twisted, jaw gaping; then a raking slash
// with the right that drags the left after it
const GH_RAKE = act2(
  { armR: [-2.55, 0.25, -0.95], armL: [-2.2, -0.2, 0.95], foreR: [-1.25, 0, 0], foreL: [-1.15, 0, 0], handR: [-0.55, 0, 0], handL: [-0.5, 0, 0], chest: [-0.28, -0.4, 0], spine: [0.05, -0.18, 0], neck: [0.25, 0, 0], head: [0.3, 0.4, 0], jaw: [0.85, 0, 0], hips: [0, -0.18, 0, 0, -0.1, -0.08], thighL: [-0.55, 0, 0.1], shinL: [0.75, 0, 0], thighR: [0.2, 0, -0.1], shinR: [0.6, 0, 0] },
  { armR: [-0.35, -0.3, 0.8], armL: [-1.4, 0.3, -0.35], foreR: [-0.25, 0, 0], foreL: [-0.7, 0, 0], handR: [0.5, 0, 0], handL: [0.3, 0, 0], chest: [0.55, 0.5, 0], spine: [0.3, 0.18, 0], neck: [-0.2, 0, 0], head: [-0.25, -0.4, 0], jaw: [0.95, 0, 0], hips: [0, 0.18, 0, 0, -0.14, 0.28], thighR: [-0.75, 0, 0], shinR: [0.7, 0, 0], thighL: [0.35, 0, 0], shinL: [0.4, 0, 0] },
  { hit: 0.22, tremble: 0.045, strikeExtra: (P, p) => { const k = bump(0.22, 0.7, p); P.r('armL', 1.1 * k, 0, -0.6 * k); P.r('chest', 0, -0.25 * k, 0); } },
);
// pounce: sinks into a deep crouch, arms swept back, head low, quivering; then launches, stretched out
const GH_POUNCE = act2(
  { hips: [0.25, 0, 0, 0, -0.32, -0.14], thighL: [-1.25, 0, 0.22], thighR: [-1.1, 0, -0.22], shinL: [1.9, 0, 0], shinR: [1.8, 0, 0], footL: [-0.5, 0, 0], footR: [-0.5, 0, 0], spine: [0.3, 0, 0], chest: [0.25, 0, 0], neck: [-0.45, 0, 0], head: [-0.5, 0, 0], armL: [0.75, 0, 0.55], armR: [0.75, 0, -0.55], foreL: [-0.35, 0, 0], foreR: [-0.35, 0, 0], handL: [-0.5, 0, 0], handR: [-0.5, 0, 0], jaw: [0.6, 0, 0] },
  { hips: [0.55, 0, 0, 0, 0.1, 0.3], thighL: [0.55, 0, 0.1], thighR: [0.35, 0, -0.1], shinL: [0.35, 0, 0], shinR: [0.6, 0, 0], footL: [0.5, 0, 0], footR: [0.5, 0, 0], spine: [0.1, 0, 0], chest: [0.05, 0, 0], neck: [-0.55, 0, 0], head: [-0.45, 0, 0], armL: [-2.35, 0, 0.45], armR: [-2.35, 0, -0.45], foreL: [-0.2, 0, 0], foreR: [-0.2, 0, 0], handL: [-0.5, 0, 0], handR: [-0.5, 0, 0], jaw: [1.05, 0, 0] },
  { hit: 0.3, recover: 0.7, tremble: 0.06, windupRate: 7 },
);
const GH_STAGGER = { spine: [-0.35, 0.2, 0.1], chest: [-0.3, 0.25, 0], neck: [0.2, 0, 0], head: [-0.5, -0.35, 0.3], armL: [0.5, 0, 0.9], armR: [0.45, 0, -0.8], foreL: [-0.8, 0, 0], foreR: [-0.9, 0, 0], hips: [0, 0, 0, 0, -0.06, -0.14], thighL: [-0.4, 0, 0], shinL: [0.55, 0, 0], jaw: [0.9, 0, 0] };
// A drowned thing: wiry, long-armed and hunched under a hump of muscle, a rotten burial shroud
// clinging to its back, lank wet hair, river weed and barnacles, a shackle trailing its chain.
export const ghoul = {
  id: 'ghoul', height: 1.6, radius: 0.42, eyeColor: 0xd8ffe0, defaultAttack: 'claw', attackTypes: ['claw', 'swipe', 'bite'],
  flutter: 0.045,
  build(rig) {
    const D = humanSkeleton(rig, { thigh: 0.45, shin: 0.44, hipW: 0.11, spine: 0.17, chest: 0.32, neck: 0.15, neckZ: 0.02, shoulderW: 0.21, upper: 0.37, fore: 0.37, jaw: [0.055, 0.02] });
    // sickly pale flesh, rotting blotches, darker toward hands and feet
    const rot = (v) => {
      const n = vnoise(v.x * 7 + 3, v.y * 7, v.z * 7, 21), n2 = vnoise(v.x * 23, v.y * 23, v.z * 23, 5);
      const k = 0.78 + n2 * 0.35;
      if (n > 0.68) return [0.12 * k, 0.15 * k, 0.1 * k];
      if (n > 0.6) return [0.28 * k, 0.3 * k, 0.21 * k];
      return [GHOUL_SKIN[0] * k, GHOUL_SKIN[1] * k, GHOUL_SKIN[2] * k];
    };
    addFleshBody(rig, D, { c: GHOUL_SKIN, cfn: rot, limbSeg: 10, gaunt: 0.75, muscle: 1.3, torsoW: 1.14, depth: 1.12, claws: 0.09, toeClaws: true, clawC: [0.12, 0.1, 0.08], ribC: [0.48, 0.55, 0.48], hunch: 0.14, seed: 5, rough: 1.8, veins: true, veinC: [0.25, 0.32, 0.3], hand: { c: [0.3, 0.33, 0.28], m: 1.08, claws: 0.1, fingerLen: 1.5, curl: 0.55, clawC: [0.1, 0.08, 0.07] } });
    ghoulHead(rig, { c: GHOUL_SKIN, cfn: rot, hair: 10, s: 1.12 });
    const torsoSkin = chainSkin([['hips', 0.0], ['spine', 0.05 + D.spine * 0.45], ['chest', 0.05 + D.spine + D.chest * 0.25]], (v) => v.y);
    // hump of knotted muscle over the shoulders, knobbly spine
    rig.add('chest', 'skin', bumpy(xf(G.sph(0.14, 10, 7), { sx: 1.45, sy: 0.7, sz: 0.85 }), 0.012, 9, 4), { y: D.chest * 0.82, z: -0.07, rx: -0.3 }, { cfn: rot });
    rig.add('hips', 'skin', mergeRaw([0, 1, 2, 3, 4, 5, 6, 7].map((i) => xf(G.sph(0.022, 6, 4), { y: 0.06 + i * 0.06, z: -0.1 - Math.sin(i / 7 * Math.PI) * 0.035 - (i > 4 ? (i - 4) * 0.025 : 0), sz: 1.4 }))), {}, { c: GHOUL_SKIN, skin: torsoSkin });
    // rotten burial shroud: a ragged hood-cowl round the shoulders and a long tatter down the back
    const SHROUD = [0.17, 0.19, 0.15];
    rig.add('chest', 'cloth', robe(0.13, 0.3, 0.22, { seg: 16, rows: 3, folds: 7, foldAmp: 0.14, tatter: 0.6, seed: 13 }), { y: D.chest + 0.07, z: -0.03, sz: 0.85, rx: -0.15 }, { c: SHROUD, anim: (v) => clamp(-v.y * 4) * 0.6 });
    rig.add('chest', 'cloth', panel(0.36, 0.78, { ws: 5, hs: 7, tatter: 0.6, seed: 17, curve: 0.14, taperBot: 0.6 }), { y: D.chest + 0.02, z: -0.16, ry: Math.PI, rx: 0.25 }, {
      cfn: (v) => { const k = 0.7 + 0.45 * vnoise(v.x * 9, v.y * 9, 3, 7); return [SHROUD[0] * k, SHROUD[1] * k * 1.05, SHROUD[2] * k]; },
      anim: (v) => clamp(-v.y / 0.7) * 1.4,
      skin: chainSkin([['hips', -D.spine - 0.5], ['spine', -D.spine * 0.5], ['chest', 0.0]], (v) => v.y),
    });
    // rope belt + shredded loincloth
    rig.add('hips', 'leather', xf(G.tor(0.13, 0.012, 5, 18), { rx: Math.PI / 2, sz: 0.72 }), { y: -0.01 }, { c: 0x4a3e2a });
    rig.add('hips', 'cloth', panel(0.18, 0.4, { tatter: 0.6, seed: 3, curve: 0.04, taperBot: 0.5 }), { y: -0.01, z: 0.095 }, { c: [0.22, 0.2, 0.14], anim: (v) => -v.y * 1.2 });
    rig.add('hips', 'cloth', panel(0.22, 0.32, { tatter: 0.6, seed: 8, curve: -0.04, taperBot: 0.5 }), { y: -0.01, z: -0.09 }, { c: [0.18, 0.17, 0.12], anim: (v) => -v.y * 1.2 });
    // drowned: hanging weed and barnacles, a rusted shackle trailing its broken chain
    for (const [b, x, y, z, len] of [['armL', 0.03, -0.05, 0.02, 0.3], ['armR', -0.02, -0.08, -0.02, 0.25], ['foreL', 0.02, -0.12, 0, 0.22], ['thighR', -0.04, -0.1, 0.03, 0.28], ['chest', 0.1, D.chest - 0.02, -0.12, 0.35]]) {
      rig.add(b, 'cloth', tube([[x, y, z], [x + 0.02, y - len * 0.5, z + 0.02], [x - 0.01, y - len, z]], (u) => 0.009 * (1 - u * 0.6), 6, 3), {}, { c: 0x1c3214, anim: (v) => clamp((y - v.y) * 3) });
    }
    const R = rng(21);
    rig.add('armL', 'stone', mergeRaw(Array.from({ length: 9 }, () => xf(G.cone(0.012, 0.018, 5), { x: 0.04 + R() * 0.02, y: -0.04 - R() * 0.16, z: (R() - 0.5) * 0.06, rz: -1.2 }))), {}, { c: 0x9a9a8a });
    rig.add('chest', 'stone', mergeRaw(Array.from({ length: 6 }, () => xf(G.cone(0.013, 0.018, 5), { x: (R() - 0.5) * 0.2, y: D.chest * (0.5 + R() * 0.4), z: -0.15 - R() * 0.03, rx: -1.3 }))), {}, { c: 0x8a8a7a });
    const links = Array.from({ length: 9 }, (_, i) => xf(G.tor(0.018, 0.0055, 3, 6), { y: -0.36 - i * 0.034, x: 0.03 + Math.sin(i * 0.6) * 0.01, ry: (i % 2) * 1.57, sy: 1.35 }));
    rig.add('foreR', 'iron', mergeRaw([xf(G.tor(0.045, 0.011, 4, 12), { rx: Math.PI / 2, y: -0.3 }), ...links]), {}, { c: RUSTY, anim: (v) => clamp((-v.y - 0.32) * 4) });
    rig.socket('muzzle', 'handR', 0, -0.14, 0.02);
    return D;
  },
  pose: humanoidPose,
  anim: {
    death: 'fall', spawn: 'rise', armSwing: 0.3, knee: 1.05, stride: 0.62, armOut: 0.18, breath: 2.6, stagger: GH_STAGGER,
    stance: (P) => {
      P.apply({ spine: [0.5, 0, 0], chest: [0.42, 0, 0], neck: [-0.38, 0, 0], head: [-0.55, 0, 0], thighL: [-0.45, 0, 0.09], thighR: [-0.36, 0, -0.09], shinL: [0.72, 0, 0], shinR: [0.62, 0, 0], footL: [-0.24, 0, 0], footR: [-0.24, 0, 0], hips: [0.1, 0, 0, 0, -0.12, -0.05], armL: [-0.4, 0.2, 0.08], armR: [-0.34, -0.2, -0.08], foreL: [-0.5, 0, 0], foreR: [-0.42, 0, 0], handL: [-0.2, 0, 0], handR: [-0.25, 0, 0] });
    },
    actions: { swing: GH_RAKE, claw: GH_RAKE, swipe: GH_RAKE, charge: GH_POUNCE },
    deathExtra: (P, p, m) => { const k = bump(0.75, 1, p) * 0.12; P.r('handL', Math.sin(m.time * 23) * k); P.r('handR', Math.sin(m.time * 19 + 1) * k); P.r('footL', Math.sin(m.time * 17) * k); P.r('jaw', 0.6 * smooth(0.5, 1, p)); },
    extra: (P, m, s, dt, k) => {
      const T = m.time;
      if (!k.action) P.r('jaw', 0.32 + Math.sin(T * 1.3) * 0.12);
      glowLevel(m, s.anim === 'windup' ? 1 + 0.9 * smooth(0, 1, s.progress) : 1);
      // ragged breathing: the hunched back heaves
      P.r('chest', Math.max(0, Math.sin(T * 2.6 + m.seed * 5)) * 0.05, 0, 0);
      // finger twitches and sudden head jerks
      P.r('handL', Math.sin(T * 7.3) * 0.1 * Math.max(0, Math.sin(T * 0.9)), 0, 0);
      P.r('handR', Math.sin(T * 6.1 + 1) * 0.1 * Math.max(0, Math.sin(T * 1.1 + 2)), 0, 0);
      if (s.anim === 'idle' || s.anim === 'move') {
        const ph = (T * 0.31 + m.seed * 3) % 1;
        const j = ph < 0.06 ? Math.sin(ph / 0.06 * Math.PI) : 0;
        const dir = Math.floor(T * 0.31 + m.seed * 3) % 2 ? 1 : -1;
        P.r('head', -0.1 * j, 0.35 * j * dir, 0.55 * j * dir);
        P.r('neck', 0, 0, 0.2 * j * dir);
        // a lurching, loose-limbed gait: the head bobs low on each step, arms dangle and swing wide
        P.r('neck', Math.max(0, Math.sin(k.ph * 2)) * 0.12 * k.w, 0, 0);
        P.r('chest', 0, Math.sin(k.ph) * 0.12 * k.w, Math.sin(k.ph) * 0.06 * k.w);
        P.r('armL', 0, 0, Math.abs(Math.sin(k.ph)) * 0.15 * k.w); P.r('armR', 0, 0, -Math.abs(Math.sin(k.ph)) * 0.15 * k.w);
      }
    },
  },
};

// ---------------------------------------------------------- bilespitter ----
const BILE_SKIN = [0.62, 0.62, 0.4];
const BILE = 0x9bff2a;
export const bilespitter = {
  id: 'bilespitter', height: 1.72, radius: 0.5, eyeColor: 0xc8ff40, magicColor: BILE, defaultAttack: 'spit', attackTypes: ['spit', 'swing'], orbSize: 0.08,
  build(rig) {
    const D = humanSkeleton(rig, { thigh: 0.42, shin: 0.4, spine: 0.2, chest: 0.3, neck: 0.06, shoulderW: 0.23, upper: 0.29, fore: 0.28, hipW: 0.135, jaw: [0.045, 0.03] });
    rig.bone('belly', 'hips', 0, 0.07, 0.07, { rate: 0.6 });
    const mott = (v) => { const n = vnoise(v.x * 9, v.y * 9, v.z * 9, 4); const k = 0.8 + 0.3 * n; return n > 0.68 ? [0.42, 0.55, 0.3] : [0.55 * k, 0.58 * k, 0.38 * k]; };
    // sickly mottled hide: jaundiced yellow-grey with bruised green patches
    const hide = (v) => {
      const n = vnoise(v.x * 6 + 2, v.y * 6, v.z * 6, 14), d = vnoise(v.x * 22, v.y * 22, v.z * 22, 3);
      const k = 0.75 + d * 0.35;
      if (n > 0.64) return [0.24 * k, 0.34 * k, 0.15 * k];
      if (n < 0.3) return [0.5 * k, 0.4 * k, 0.3 * k];
      return [0.47 * k, 0.52 * k, 0.32 * k];
    };
    addFleshBody(rig, D, { c: BILE_SKIN, cfn: hide, limbSeg: 10, muscle: 1.75, seed: 9, rough: 1.6, belly: 0.12, bellyY: 0.1, depth: 1.28, torsoW: 1.15, hunch: 0.07, veins: true, veinC: [0.3, 0.35, 0.2], hand: { m: 1.1 } });
    // fat: a hump across the upper back, rolls over the hips, a sagging double chin
    rig.add('chest', 'skin', bumpy(xf(G.sph(0.17, 12, 8), { sx: 1.35, sy: 0.75, sz: 0.8 }), 0.012, 8, 6), { y: D.chest * 0.78, z: -0.07, rx: -0.25 }, { cfn: hide });
    rig.pair('hips', 'hips', 'skin', bumpy(xf(G.sph(0.11, 10, 7), { sx: 0.8, sy: 0.65, sz: 1.2 }), 0.01, 8, 2), { x: 0.2, y: 0.07, z: 0.02 }, { cfn: hide });
    rig.add('neck', 'skin', bumpy(xf(G.sph(0.085, 10, 7), { sx: 1.2, sy: 0.6, sz: 0.9 }), 0.008, 9, 3), { y: 0.0, z: 0.06 }, { cfn: hide });
    // distended gut: sagging, lumpy pear of stretched hide hanging over the belt
    const sacShape = (v) => {
      // pear: narrow top blending into the ribcage, heavy sagging bottom pushed forward
      const t = clamp((v.y + 0.25) / 0.5);
      const w = 0.72 + Math.sin(t * Math.PI * 0.9) * 0.38;
      v.x *= w * 1.05; v.z *= w;
      if (v.y < 0) { v.y *= 1.25; v.z += -v.y * 0.25; }
      if (v.z < 0) v.z *= 0.35;
      v.x += Math.sin(v.y * 9) * 0.01; // asymmetry
      v.z += Math.max(0, vnoise(v.x * 8, v.y * 8, v.z * 8, 4) - 0.55) * 0.03; // lumps
    };
    const sac = deform(bumpy(G.sph(0.25, 20, 14), 0.01, 7, 2), sacShape);
    rig.add('belly', 'skin', sac, { z: 0.02 }, {
      anim: 0.25,
      cfn: (v) => { const c0 = hide(v); const tight = clamp((v.z - 0.12) * 5); const n = vnoise(v.x * 30, v.y * 30, v.z * 30, 8); const g = n > 0.75 ? 0.4 : 0; return [c0[0] * (1 + tight * 0.15) - g * 0.1, c0[1] * (1 + tight * 0.2) + g * 0.15, c0[2] * (1 - tight * 0.2)]; },
    });
    // fold of flesh where the gut meets the chest, and a deep navel
    rig.add('belly', 'dark', xf(G.sph(0.022, 8, 6), { sx: 0.8, sz: 0.5 }), { y: -0.02, z: 0.285 });
    // glowing bile veins: wiggly, branching, brightest where the skin is thinnest (lower front)
    const R = rng(12);
    const veins = [], blisters = [], blisterG = [];
    const onSac = (x, y) => { const v = new THREE.Vector3(x, y, Math.sqrt(Math.max(0.003, 0.0625 - x * x - y * y))); sacShape(v); const n = v.clone().normalize(); v.addScaledVector(n, 0.016); return v; };
    for (let i = 0; i < 7; i++) {
      let x = -0.15 + (i / 6) * 0.3 + (R() - 0.5) * 0.03, y = -0.2 + R() * 0.08;
      const pts = [onSac(x, y)];
      for (let k = 0; k < 6; k++) { x += (R() - 0.5) * 0.05 - x * 0.08; y += 0.04 + R() * 0.02; pts.push(onSac(x, y)); if (k === 2 || (k === 4 && R() > 0.5)) { const bx = x + (R() > 0.5 ? 1 : -1) * 0.07; veins.push(tube([pts[pts.length - 1], onSac((x + bx) / 2, y + 0.03), onSac(bx, y + 0.07)], 0.0024, 4, 3)); } }
      veins.push(tube(pts, (u) => 0.0046 * (1 - u * 0.6), 9, 3));
    }
    for (let i = 0; i < 6; i++) { const p = onSac((R() - 0.5) * 0.3, -0.15 + R() * 0.25); const r = 0.012 + R() * 0.012; blisters.push(xf(G.sph(r, 6, 4), { x: p.x, y: p.y, z: p.z - 0.003, sz: 0.6 })); blisterG.push(xf(G.sph(r * 0.55, 4, 3), { x: p.x, y: p.y, z: p.z + r * 0.25 })); }
    rig.add('belly', 'glow', mergeRaw([...veins, ...blisterG]), { z: 0.02 }, { c: HDR(BILE, 0.9) });
    rig.add('belly', 'slime', mergeRaw(blisters), { z: 0.02 }, { c: [0.6, 1.0, 0.35] });
    // pustules
    const pust = [], pustG = [];
    for (const [b, n, r, y0, y1] of [['chest', 9, 0.16, 0.05, 0.3], ['armL', 4, 0.06, -0.25, 0], ['armR', 4, 0.06, -0.25, 0], ['thighL', 3, 0.08, -0.3, 0], ['neck', 2, 0.06, 0, 0.08]]) {
      for (let i = 0; i < n; i++) {
        const a = R() * TAU, y = lerp(y0, y1, R());
        const pos = { x: Math.sin(a) * r * (b === 'chest' ? 1 : 1), y, z: Math.cos(a) * r * (b === 'chest' ? 0.7 : 1) };
        const sz = 0.018 + R() * 0.02;
        pust.push([b, xf(G.sph(sz, 5, 4), pos)]);
        pustG.push([b, xf(G.sph(sz * 0.55, 4, 3), { ...pos, x: pos.x * 1.08, z: pos.z * 1.08 })]);
      }
    }
    for (const [b, g] of pust) rig.add(b, 'skin', g, {}, { c: [0.75, 0.75, 0.38] });
    for (const [b, g] of pustG) rig.add(b, 'glow', g, {}, { c: HDR(BILE, 2.2) });
    // swollen bald head with wide maw
    rig.add('head', 'skin', bumpy(xf(G.sph(0.11, 16, 12), { sx: 1.05, sy: 0.95, sz: 1.0 }), 0.014, 8, 4), { y: 0.11, z: 0.0 }, { cfn: mott });
    rig.add('head', 'skin', bumpy(G.sph(0.06, 10, 8), 0.01, 10, 3), { x: -0.06, y: 0.17, z: 0.03 }, { c: [0.75, 0.72, 0.42] });
    rig.add('head', 'dark', G.box(0.08, 0.04, 0.04), { y: 0.065, z: 0.08 });
    rig.pair('head', 'head', 'dark', G.sph(0.016, 6, 5), { x: 0.035, y: 0.125, z: 0.085 });
    rig.pair('head', 'head', 'glow', G.sph(0.01, 6, 5), { x: 0.036, y: 0.125, z: 0.096 }, { c: HDR(0xd8ff40, 5) });
    for (let i = 0; i < 9; i++) { const a = (i / 8 - 0.5) * 2.2; rig.add('head', 'bone', G.cone(0.007, 0.022, 4), { x: Math.sin(a) * 0.045, y: 0.07, z: 0.06 + Math.cos(a) * 0.04, rx: Math.PI }, { c: 0xb0a060 }); }
    addMonsterJaw(rig, 'jaw', { c: [0.6, 0.6, 0.4], s: 1.25, teeth: 9 });
    // bile welling in the throat (flares with the gut through a wind-up)
    rig.add('head', 'glow', xf(G.box(0.06, 0.03, 0.03), {}), { y: 0.068, z: 0.07 }, { c: HDR(BILE, 1.6) });
    rig.add('jaw', 'glow', xf(G.box(0.05, 0.01, 0.06), {}), { y: 0.004, z: 0.06 }, { c: HDR(BILE, 1.3) });
    // drool
    rig.add('jaw', 'slime', tube([[0.02, 0, 0.1], [0.025, -0.08, 0.11], [0.02, -0.16, 0.1]], (u) => 0.008 * (1 - u * 0.5), 6, 4), {}, { c: [0.5, 1.2, 0.3], anim: 1 });
    // filthy butcher's apron under the gut, rope belt, ragged breeches held up by braces, wrist wraps
    const stain = (base) => (v) => { const n = vnoise(v.x * 8 + 1, v.y * 8, 2, 31), k = 0.75 + 0.4 * vnoise(v.x * 30, v.y * 30, 0, 5), g = smooth(0.55, 0.75, n); return [lerp(base[0], 0.32, g) * k, lerp(base[1], 0.4, g) * k, lerp(base[2], 0.12, g) * k]; };
    rig.add('hips', 'leather', panel(0.42, 0.5, { ws: 5, hs: 6, tatter: 0.2, seed: 6, curve: 0.16, taperBot: 0.9 }), { y: -0.1, z: 0.3, rx: -0.05 }, { cfn: stain([0.75, 0.6, 0.45]), anim: (v) => clamp(-v.y / 0.5) * 0.8, skin: (v) => { const t = clamp((-v.y - 0.08) / 0.4) * 0.6, l = clamp(0.5 + v.x * 4); return [['hips', 1 - t], ['thighL', t * l], ['thighR', t * (1 - l)]]; } });
    rig.add('hips', 'leather', xf(G.tor(0.2, 0.017, 5, 18), { rx: Math.PI / 2, sz: 0.85 }), { y: -0.01 }, { c: 0x3a2c1e });
    for (const S of ['L', 'R']) {
      const sx = S === 'L' ? 1 : -1;
      rig.add('thigh' + S, 'cloth', robe(0.165, 0.135, D.thigh * 0.8, { seg: 10, rows: 2, folds: 5, foldAmp: 0.08, tatter: 0.35, seed: 3 + sx }), { y: 0.04 }, { cfn: stain([0.32, 0.28, 0.22]) });
      rig.add('chest', 'leather', tube([[sx * 0.1, -0.12, 0.27], [sx * 0.13, D.chest * 0.5, 0.21], [sx * 0.13, D.chest + 0.02, 0.06], [sx * 0.11, D.chest * 0.7, -0.17], [sx * 0.08, -0.12, -0.2]], 0.011, 14, 4), {}, { c: [0.35, 0.26, 0.18] });
    }
    rig.add('foreL', 'cloth', G.cyl(0.058, 0.052, 0.12, 8, true), { y: -0.2 }, { c: 0x6a5a40 });
    rig.add('foreR', 'cloth', G.cyl(0.058, 0.052, 0.09, 8, true), { y: -0.23 }, { c: 0x5a4a34 });
    rig.socket('muzzle', 'jaw', 0, 0.03, 0.14);
    return D;
  },
  pose: humanoidPose,
  anim: {
    death: 'fallBack', spawn: 'rise', gait: 'plod', armSwing: 0.3, armOut: 0.38, stride: 0.42, knee: 0.7, breath: 1.4,
    stance: (P) => P.apply({ spine: [-0.1, 0, 0], chest: [0.22, 0, 0], neck: [-0.2, 0, 0], head: [0.08, 0, 0], thighL: [-0.06, 0, 0.11], thighR: [-0.06, 0, -0.11], shinL: [0.12, 0, 0], shinR: [0.12, 0, 0], foreL: [-0.35, 0, 0], foreR: [-0.35, 0, 0] }),
    stagger: { spine: [-0.25, 0.1, 0.08], chest: [-0.2, 0.15, 0], head: [-0.4, -0.2, 0.15], jaw: [0.8, 0, 0], armL: [0.3, 0, 0.7], armR: [0.3, 0, -0.6], foreL: [-0.7, 0, 0], foreR: [-0.7, 0, 0], hips: [0, 0, 0, 0, -0.05, -0.1], thighL: [-0.3, 0, 0], shinL: [0.4, 0, 0] },
    actions: {
      spit: act2(
        { neck: [-0.4, 0, 0], head: [-0.5, 0, 0], jaw: [0.5, 0, 0], chest: [-0.3, 0, 0], spine: [-0.1, 0, 0], armR: [0.2, 0, -0.6], armL: [0.2, 0, 0.6], foreR: [-0.6, 0, 0], foreL: [-0.6, 0, 0] },
        { neck: [0.4, 0, 0], head: [0.3, 0, 0], jaw: [1.0, 0, 0], chest: [0.35, 0, 0], spine: [0.15, 0, 0], armR: [0.4, 0, -0.4], armL: [0.4, 0, 0.4], hips: [0, 0, 0, 0, -0.04, 0.08] },
        { hit: 0.2, tremble: 0.04, windupExtra: (P, p, m) => { P.s('belly', 1 + 0.14 * p + Math.sin(m.time * 22) * 0.05 * p); m.setOrb(0.2 + 0.7 * p); }, strikeExtra: (P, p, m) => { P.s('belly', 1 - 0.12 * bump(0, 0.4, p)); m.setOrb(1 - smooth(0.05, 0.3, p)); } },
      ),
    },
    extra: (P, m, s, dt, k) => {
      glowLevel(m, s.anim === 'windup' ? 1 + 1.3 * smooth(0, 1, s.progress) : s.anim === 'death' ? 1 - 0.7 * s.progress : 1 + 0.12 * Math.sin(m.time * 2.6));
      // the gut breathes and wobbles a beat behind each heavy step; a waddling roll of the hips
      P.s('belly', 1.12 + Math.sin(m.time * 2.6) * 0.035 + Math.abs(Math.sin(k.ph)) * 0.04 * k.w);
      P.r('belly', Math.sin(k.ph * 2 - 1.2) * 0.05 * k.w, 0, Math.sin(k.ph - 0.8) * 0.05 * k.w);
      P.r('hips', 0, 0, Math.sin(k.ph) * 0.07 * k.w); P.r('chest', 0, 0, -Math.sin(k.ph) * 0.05 * k.w);
      if (!k.action) P.r('jaw', 0.2 + Math.sin(m.time * 0.9) * 0.08 + Math.max(0, Math.sin(m.time * 9)) * 0.06 * smooth(0.6, 0.9, Math.sin(m.time * 0.4 + m.seed * 7)));
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
// A hunched rat-priest in a patched, rag-hung robe under a ragged hood, a mantle of matted hide, a
// necklace of little skulls, bottles and bones swinging from a rope belt, and a crooked bone staff
// topped with a skull and a green witch-light that flares as it casts.
const SH_CAST = act2(
  { armR: [-0.35, 0, -0.3], foreR: [-1.7, 0, 0], handR: [0.35, 0, 0], armL: [-1.25, 0, 0.7], foreL: [-0.8, 0, 0], handL: [-0.5, 0, 0], chest: [-0.2, -0.35, 0], head: [-0.15, 0.25, 0], spine: [-0.08, 0, 0], jaw: [0.45, 0, 0] },
  { armR: [-1.4, 0, 0.2], foreR: [-0.45, 0, 0], handR: [0.15, 0, 0], armL: [-0.45, 0, 0.35], foreL: [-0.6, 0, 0], chest: [0.2, 0.2, 0], spine: [0.12, 0, 0], head: [-0.1, -0.15, 0], hips: [0, 0, 0, 0, -0.03, 0.08], jaw: [0.2, 0, 0] },
  { hit: 0.3, recover: 0.85, recoverAmt: 0.25, tremble: 0.035, windupExtra: (P, p, m) => P.r('jaw', 0.25 * p + Math.sin(m.time * 25) * 0.12 * p) },
);
const SH_SUMMON = act2(
  { armR: [-0.7, 0, -0.2], foreR: [-1.2, 0, 0], handR: [0.4, 0, 0], armL: [-0.6, 0, 0.4], foreL: [-1.3, 0, 0], chest: [0.3, 0, 0], spine: [0.15, 0, 0], head: [0.3, 0, 0], hips: [0, 0, 0, 0, -0.08, 0] },
  { armR: [-2.7, 0, -0.2], foreR: [-0.1, 0, 0], handR: [0.2, 0, 0], armL: [-2.5, 0, 0.5], foreL: [-0.3, 0, 0], chest: [-0.35, 0, 0], spine: [-0.1, 0, 0], head: [-0.55, 0, 0], jaw: [0.8, 0, 0] },
  { hit: 0.4, recover: 0.85, tremble: 0.04 },
);
export const ratShaman = {
  id: 'ratShaman', height: 1.6, radius: 0.4, eyeColor: SHAMAN_GLOW, magicColor: SHAMAN_GLOW, defaultAttack: 'cast', attackTypes: ['cast', 'summon', 'swing'], orbSize: 0.075, flutter: 0.045,
  build(rig) {
    const D = humanSkeleton(rig, { thigh: 0.4, shin: 0.4, spine: 0.15, chest: 0.28, neck: 0.08, shoulderW: 0.17, upper: 0.27, fore: 0.26, jaw: [-0.014, 0.1] });
    const ROBE = [0.21, 0.19, 0.13];
    // patched robe: grimy base with darker and greener patches stitched on
    const patch = (base, sd = 1) => (v) => {
      const n = vnoise(v.x * 5 + sd, v.y * 5, v.z * 5, 41 + sd), k = 0.72 + 0.4 * vnoise(v.x * 20, v.y * 20, v.z * 20, 3);
      const c = n > 0.66 ? [0.17, 0.2, 0.12] : n < 0.3 ? [0.28, 0.21, 0.13] : base;
      return [c[0] * k, c[1] * k, c[2] * k];
    };
    rig.add('hips', 'cloth', robe(0.17, 0.33, D.hipH - 0.08, { seg: 20, rows: 6, folds: 7, foldAmp: 0.12, tatter: 0.35, seed: 3 }), { y: 0.02 }, { cfn: patch(ROBE, 1), anim: (v) => clamp(-v.y / 0.7) * 1.1 });
    rig.add('hips', 'cloth', lathe([[0.17, 0.0], [0.16, 0.12], [0.17, 0.2]], 14), {}, { cfn: patch(ROBE, 2) });
    rig.add('chest', 'cloth', lathe([[0.15, -0.05], [0.18, 0.12], [0.2, 0.22], [0.12, 0.3], [0.06, 0.32]], 14), { sz: 0.8 }, { cfn: patch(ROBE, 3) });
    // hanging rag strips round the robe
    const rags = [];
    for (let i = 0; i < 6; i++) { const a = (i / 6) * TAU + 0.3; rags.push(xf(panel(0.06, 0.32 + (i % 3) * 0.08, { ws: 1, hs: 4, tatter: 0.5, seed: 50 + i, curve: 0 }), { x: Math.sin(a) * 0.19, z: Math.cos(a) * 0.17, ry: a })); }
    rig.add('hips', 'cloth', mergeRaw(rags), { y: 0.1 }, { c: [0.2, 0.17, 0.11], anim: (v) => clamp(-v.y * 2.5) * 1.4 });
    // matted hide mantle over the hunched shoulders
    rig.add('chest', 'fur', shaggy(robe(0.11, 0.28, 0.26, { seg: 14, rows: 3, folds: 6, foldAmp: 0.12, tatter: 0.4, seed: 9 }), 0.025, 12, 5, [0, -1, 0], 0.5), { y: D.chest + 0.04, sz: 0.85 }, { c: [0.33, 0.27, 0.2], anim: (v) => clamp(-v.y * 2.5) * 0.4 });
    // ragged hood
    const h = hood(0.15, 0.14, { open: 0.22, peak: 1.3 });
    rig.add('head', 'cloth', h.shell, { y: 0.06, z: -0.01, rx: -0.15 }, { cfn: patch([0.19, 0.17, 0.11], 4) });
    // rat head poking out
    ratHead(rig, { s: 1.35, mat: 'fur', eye: SHAMAN_GLOW, notch: true, muzzle: false, lo: true });
    // necklace of tiny skulls and teeth
    const nk = [];
    for (let i = 0; i < 9; i++) { const a = (i / 8 - 0.5) * 2.2; nk.push(xf(G.cone(0.008, 0.035, 3), { x: Math.sin(a) * 0.13, y: D.chest - 0.06 - Math.cos(a) * 0.04, z: Math.cos(a) * 0.11, rx: Math.PI })); }
    for (const a of [-0.6, 0, 0.6]) nk.push(xf(G.sph(0.022, 6, 4), { x: Math.sin(a) * 0.13, y: D.chest - 0.1 - Math.cos(a) * 0.03, z: Math.cos(a) * 0.125, sz: 1.2 }));
    rig.add('chest', 'bone', mergeRaw(nk), {}, { cfn: boneShade([1.0, 0.97, 0.85], 6) });
    // sleeves + clawed pink hands
    for (const S of ['L', 'R']) {
      const sx = S === 'L' ? 1 : -1;
      rig.add('arm' + S, 'cloth', robe(0.06, 0.075, D.upper + 0.02, { seg: 10, rows: 2, folds: 4, tatter: 0.0, seed: 2 }), {}, { cfn: patch(ROBE, 5 + sx) });
      rig.add('fore' + S, 'cloth', robe(0.065, 0.11, D.fore * 0.85, { seg: 10, rows: 2, folds: 4, tatter: 0.4, seed: 5 + sx }), {}, { cfn: patch(ROBE, 7 + sx), anim: (v) => clamp(-v.y * 3) * 0.6 });
      addFleshHand(rig, 'hand' + S, sx, { mat: 'skin', c: [0.95, 0.62, 0.58], m: 0.85, claws: 0.035, clawC: 0x2a2018, grip: S === 'R' });
      rig.add('foot' + S, 'skin', xf(G.sph(0.04, 8, 6), { y: -0.04, z: 0.05, sx: 0.9, sy: 0.5, sz: 2.0 }), {}, { c: [0.9, 0.58, 0.55] });
      rig.add('foot' + S, 'bone', mergeRaw([0, 1, 2].map((i) => xf(G.cone(0.006, 0.035, 3), { x: (i - 1) * 0.02, y: -0.06, z: 0.13, rx: Math.PI / 2 + 0.4 }))), {}, { c: 0x2a2018 });
      rig.add('shin' + S, 'skin', taper(0.035, 0.025, D.shin, 6, 2), {}, { c: [0.75, 0.5, 0.45] });
    }
    // rope belt with pouches, a bone charm and two glowing bottles
    rig.add('hips', 'leather', xf(G.tor(0.17, 0.014, 5, 18), { rx: Math.PI / 2, sz: 0.8 }), { y: 0.12 }, { c: 0x6a5434 });
    rig.add('hips', 'leather', mergeRaw([xf(G.sph(0.05, 8, 6), { x: 0.13, y: 0.06, z: 0.08, sy: 1.2 }), xf(G.sph(0.04, 7, 5), { x: -0.14, y: 0.07, z: 0.07, sy: 1.25 })]), {}, { c: 0x4a3420 });
    rig.add('hips', 'bone', mergeRaw([0, 1, 2].map((i) => xf(G.cyl(0.006, 0.006, 0.09, 4), { x: -0.06 + i * 0.03, y: 0.06, z: 0.135, rz: (i - 1) * 0.2 }))), {}, { c: 0xd8ccb0 });
    rig.add('hips', 'glow', mergeRaw([xf(G.sph(0.018, 6, 4), { x: 0.06, y: 0.04, z: 0.135, sy: 1.4 }), xf(G.sph(0.015, 6, 4), { x: -0.17, y: 0.05, z: 0.05, sy: 1.4 })]), {}, { c: HDR(SHAMAN_GLOW, 1.4), anim: 0.6 });
    ratTail(rig, 'hips', 6, 0.1, 0.03);
    // crooked bone staff: a skull on top in a cage of bone prongs holding the witch-light, fetishes dangling
    const staffL = 1.6, grip = 0.5;
    const R = rng(4);
    const sp = []; for (let i = 0; i <= 8; i++) { const t = i / 8; sp.push([(R() - 0.5) * 0.04, (R() - 0.5) * 0.03, (t - grip) * staffL]); }
    const st0 = { y: -0.07 };
    rig.add('handR', 'bone', tube(sp, (u) => 0.021 * (1.1 - u * 0.3), 12, 5), st0, { cfn: boneShade([0.9, 0.82, 0.66], 2) });
    const tip = (1 - grip) * staffL;
    rig.add('handR', 'bone', skullGeo(), { ...st0, z: tip - 0.02, rx: -Math.PI / 2, s: 0.95 }, { cfn: boneShade([1.1, 1.05, 0.95], 5) });
    rig.add('handR', 'bone', mergeRaw([0, 1, 2, 3].map((i) => tube([[Math.cos(i * 1.57) * 0.03, Math.sin(i * 1.57) * 0.03, tip + 0.04], [Math.cos(i * 1.57) * 0.07, Math.sin(i * 1.57) * 0.07, tip + 0.13], [Math.cos(i * 1.57) * 0.025, Math.sin(i * 1.57) * 0.025, tip + 0.24]], (u) => 0.009 * (1 - u * 0.6), 6, 3))), st0, { c: [0.85, 0.78, 0.62] });
    rig.add('handR', 'leather', mergeRaw([xf(G.cyl(0.026, 0.026, 0.1, 6), { rx: Math.PI / 2, z: -0.0 }), xf(G.tor(0.024, 0.006, 4, 8), { z: tip - 0.12 })]), st0, { c: 0x4a3420 });
    rig.add('handR', 'glow', G.oct(0.042), { ...st0, z: tip + 0.14, sz: 1.6 }, { c: HDR(SHAMAN_GLOW, 3.5) });
    // the staff skull's face looks along hand +Y: dark sockets with witch-light pinpoints in them
    rig.add('handR', 'dark', mergeRaw([xf(G.sph(0.024, 6, 4), { x: 0.037, z: tip - 0.025, y: 0.112, sy: 0.6 }), xf(G.sph(0.024, 6, 4), { x: -0.037, z: tip - 0.025, y: 0.112, sy: 0.6 }), xf(G.cone(0.012, 0.025, 3), { z: tip - 0.055, y: 0.113, rx: Math.PI / 2 })]), { ...st0 });
    rig.add('handR', 'glow', mergeRaw([xf(G.sph(0.011, 5, 4), { x: 0.036, z: tip - 0.025, y: 0.12 }), xf(G.sph(0.011, 5, 4), { x: -0.036, z: tip - 0.025, y: 0.12 })]), { ...st0 }, { c: HDR(SHAMAN_GLOW, 5) });
    // dangling fetishes: cords with a feather and a tooth
    rig.add('handR', 'leather', mergeRaw([tube([[0.03, 0, tip - 0.12], [0.05, -0.05, tip - 0.14], [0.05, -0.14, tip - 0.15]], 0.004, 5, 3), tube([[-0.03, 0, tip - 0.12], [-0.045, -0.06, tip - 0.13], [-0.04, -0.12, tip - 0.13]], 0.004, 5, 3)]), st0, { c: 0x3a2a1a, anim: 1 });
    rig.add('handR', 'cloth', xf(G.box(0.004, 0.08, 0.02), { x: 0.05, y: -0.18, z: tip - 0.15 }), st0, { c: [0.35, 0.32, 0.28], anim: 1 });
    rig.socket('muzzle', 'handR', 0, -0.07, tip + 0.14);
    return D;
  },
  pose: humanoidPose,
  anim: {
    death: 'fall', spawn: 'rise', armSwing: 0.2, knee: 0.9, stride: 0.5, caster: true, idleOrb: 0.15,
    // the staff goes down flat with it, not standing out of the body with its skull in the stone (scripts/grip.js)
    deathGrip: [{ foreR: [-1.2, 0, 0], handR: [-0.4, 0, 1.2] }, { foreR: [0.4, 0, 0], handR: [-1.6, 0, 0.4] }],
    rest: { armR: [-0.35, 0, -0.05], foreR: [-1.05, 0, 0], handR: [0.2, 0, 0], armL: [-0.2, 0, 0.1], foreL: [-0.8, 0, 0] },
    stance: (P) => P.apply({ spine: [0.32, 0, 0], chest: [0.3, 0, 0], neck: [-0.3, 0, 0], head: [-0.3, 0, 0], thighL: [-0.22, 0, 0], thighR: [-0.22, 0, 0], shinL: [0.38, 0, 0], shinR: [0.38, 0, 0], footL: [-0.15, 0, 0], footR: [-0.15, 0, 0], hips: [0, 0, 0, 0, -0.05, 0] }),
    actions: { cast: SH_CAST, summon: SH_SUMMON },
    extra: (P, m, s, dt, k) => {
      tailSway(P, m, 6, k.w);
      const T = m.time;
      if (!k.action) {
        P.r('jaw', Math.max(0, Math.sin(T * 11)) * 0.05);
        // muttering over the staff: the free hand paws the air, the head bobs and twitches
        P.r('armL', Math.sin(T * 1.9) * 0.12, 0, 0); P.r('handL', Math.sin(T * 3.1) * 0.3, 0, 0);
        P.r('head', Math.sin(T * 2.3) * 0.05, Math.sin(T * 0.7 + m.seed * 4) * 0.2, 0);
      }
      glowLevel(m, s.anim === 'windup' || s.anim === 'cast' ? 1 + 0.6 * smooth(0, 1, s.progress) : 1);
    },
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
    // (deathLift: a belly this deep, face down, sank into the floor)
    death: 'fall', deathLift: 0.12, spawn: 'rise', gait: 'plod', armSwing: 0.3, armOut: 0.22, stride: 0.5, knee: 0.7,
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
