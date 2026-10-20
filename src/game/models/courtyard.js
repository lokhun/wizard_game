import * as THREE from 'three';
import { G, xf, taper, lathe, shell, tube, deform, bumpy, shaggy, robe, panel, mergeRaw, chainSkin, rng, vnoise, clamp, lerp, smooth, bump, easeOut, TAU } from './core.js';
import { humanSkeleton, humanoidPose, act2, ACT } from './humanoid.js';
import { quadSkeleton, quadPose } from './quad.js';
import { addSkull, addFleshBody, addFleshHand, addSword, swordGeo, addPlate, addTabard, greatHelm, hood, addWing, wingBones, flapWings, twoSided, pauldron, rivets, HDR, STEEL, RUSTY, DARKSTEEL, BLACKSTEEL, GOLDTRIM, addRoundShield } from './parts.js';

// cheap padded under-body (gambeson) so gaps between plates read as dark cloth
function paddedBody(rig, D, c = [0.16, 0.13, 0.11]) {
  const W = D.shoulderW;
  const tors = lathe([[0.001, -0.1], [W * 0.6, -0.08], [W * 0.66, 0.05], [W * 0.68, 0.05 + D.spine], [W * 0.78, 0.05 + D.spine + D.chest * 0.7], [W * 0.4, 0.05 + D.spine + D.chest + 0.03], [0.001, 0.08 + D.spine + D.chest]], 12);
  deform(tors, (v) => { v.z *= 0.7; });
  rig.add('hips', 'cloth', tors, {}, { c, skin: chainSkin([['hips', 0.0], ['spine', 0.05 + D.spine * 0.45], ['chest', 0.05 + D.spine + D.chest * 0.25]], (v) => v.y) });
  rig.add('neck', 'cloth', taper(0.05, 0.05, D.neck + 0.04, 8, 1), { y: D.neck + 0.02 }, { c });
  for (const S of ['L', 'R']) {
    rig.add('arm' + S, 'cloth', taper(0.048, 0.04, D.upper, 8, 1), {}, { c });
    rig.add('fore' + S, 'cloth', taper(0.042, 0.034, D.fore, 8, 1), {}, { c });
    rig.add('thigh' + S, 'cloth', taper(0.075, 0.055, D.thigh, 8, 1), {}, { c });
    rig.add('shin' + S, 'cloth', taper(0.055, 0.042, D.shin, 8, 1), {}, { c });
  }
}
function visorSlit(rig, eye, k = 6, y = 0.15, z = 0.135, w = 0.1) {
  rig.add('head', 'dark', G.box(w, 0.02, 0.03), { y, z });
  rig.add('head', 'glow', G.box(w * 0.85, 0.008, 0.012), { y, z: z + 0.008 }, { c: HDR(eye, k) });
  rig.add('head', 'dark', mergeRaw([0, 1, 2, 3, 4, 5].map((i) => xf(G.box(0.006, 0.02, 0.02), { x: 0.02 + (i % 3) * 0.018, y: y - 0.06 - Math.floor(i / 3) * 0.03, z: z + 0.003 }))));
}

// ---------------------------------------------------------- fallenKnight ----
const FK_EYE = 0x8fd8ff;
export const fallenKnight = {
  id: 'fallenKnight', height: 2.0, radius: 0.45, eyeColor: FK_EYE, defaultAttack: 'swing', attackTypes: ['swing', 'thrust', 'slam'], flutter: 0.035,
  build(rig) {
    const D = humanSkeleton(rig, { thigh: 0.47, shin: 0.46, spine: 0.17, chest: 0.33, neck: 0.08, shoulderW: 0.21, upper: 0.31, fore: 0.29 });
    paddedBody(rig, D);
    const BAT = [0.72, 0.68, 0.62];
    addPlate(rig, D, { mat: 'steel', c: BAT, bulk: 1.0, pauldron: 0.12, mailC: [0.7, 0.62, 0.55] });
    addTabard(rig, D, { c: [0.22, 0.2, 0.32], tatter: 0.5, seed: 3, len: 0.85, emblem: xf(G.tor(0.06, 0.012, 4, 12), {}), emblemMat: 'cloth', emblemC: [0.7, 0.6, 0.35] });
    // great helm, dented, with glowing visor slit
    rig.add('head', 'steel', deform(greatHelm({ r: 0.13, h: 0.3 }), (v) => { v.x += Math.sin(v.y * 30) * 0.003; if (v.x > 0.08 && v.y > 0.15) v.x -= 0.012; }), { y: -0.02 }, { c: BAT });
    visorSlit(rig, FK_EYE, 6, 0.15, 0.135);
    rig.add('head', 'iron', xf(G.box(0.012, 0.26, 0.03), { y: 0.13, z: 0.13 }), {}, { c: RUSTY });
    // broken arrows stuck in the back
    rig.add('chest', 'wood', mergeRaw([xf(G.cyl(0.006, 0.006, 0.3, 4), { x: 0.08, y: 0.22, z: -0.25, rx: -1.0, rz: 0.2 }), xf(G.cyl(0.006, 0.006, 0.22, 4), { x: -0.05, y: 0.12, z: -0.22, rx: -1.2, rz: -0.3 })]), {}, { c: [0.6, 0.45, 0.3] });
    rig.add('chest', 'cloth', mergeRaw([xf(G.box(0.004, 0.06, 0.03), { x: 0.12, y: 0.33, z: -0.35, rx: -1.0 })]), {}, { c: [0.5, 0.45, 0.4] });
    addSword(rig, 'handR', { len: 0.95, w: 0.07, notch: 0.25, bladeC: [1.8, 1.75, 1.7], guardW: 0.24, grip: 0.18, seed: 9 });
    rig.socket('muzzle', 'handR', 0, -0.07, 0.6);
    return D;
  },
  pose: humanoidPose,
  anim: {
    death: 'fall', spawn: 'rise', armSwing: 0.3, knee: 0.75, stride: 0.5, gait: 'plod',
    rest: { armR: [-0.3, 0, -0.05], foreR: [-0.75, 0, 0], handR: [0.6, 0, 0], armL: [-0.1, 0, 0.1], foreL: [-0.4, 0, 0] },
    stance: (P) => P.apply({ spine: [0.12, 0, 0], neck: [0.1, 0, 0], head: [0.1, 0.1, 0.05], thighL: [-0.05, 0, 0.05], thighR: [-0.05, 0, -0.05], shinL: [0.1, 0, 0], shinR: [0.1, 0, 0] }),
  },
};

// ---------------------------------------------------------- knightCaptain ----
const KC_EYE = 0xffb040;
export const knightCaptain = {
  id: 'knightCaptain', height: 2.6, radius: 0.6, eyeColor: KC_EYE, elite: true, defaultAttack: 'slam', attackTypes: ['slam', 'sweep', 'thrust', 'roar'], flutter: 0.04,
  build(rig) {
    const D = humanSkeleton(rig, { thigh: 0.58, shin: 0.56, ankle: 0.08, hipW: 0.13, spine: 0.22, chest: 0.42, neck: 0.1, shoulderW: 0.27, upper: 0.38, fore: 0.36 });
    paddedBody(rig, D, [0.1, 0.08, 0.08]);
    addPlate(rig, D, { mat: 'steel', c: BLACKSTEEL, bulk: 1.15, pauldron: 0.16, trim: true, mailC: [0.6, 0.6, 0.65] });
    addTabard(rig, D, { c: [0.45, 0.05, 0.06], tatter: 0.2, seed: 7, len: 1.05, w: 0.85, emblem: mergeRaw([xf(G.box(0.03, 0.22, 0.01), {}), xf(G.box(0.16, 0.03, 0.01), { y: 0.04 })]) });
    // cape
    const cape = panel(0.62, 1.55, { ws: 7, hs: 10, tatter: 0.18, seed: 11, curve: 0.12, taperBot: 1.3 });
    rig.add('chest', 'cloth', cape, { y: D.chest - 0.02, z: -0.2, ry: Math.PI, rx: 0.08 }, {
      c: [0.32, 0.03, 0.04],
      anim: (v) => clamp(-v.y / 1.3) * 1.6,
      skin: chainSkin([['hips', -1.0], ['spine', -0.5], ['chest', -0.05]], (v) => v.y),
    });
    rig.add('chest', 'gold', mergeRaw([xf(G.cyl(0.04, 0.04, 0.02, 10), { x: 0.2, y: D.chest - 0.03, z: 0.12, rx: Math.PI / 2 }), xf(G.cyl(0.04, 0.04, 0.02, 10), { x: -0.2, y: D.chest - 0.03, z: 0.12, rx: Math.PI / 2 })]), {}, { c: GOLDTRIM });
    // helm with crest, crown band and plume
    rig.add('head', 'steel', greatHelm({ r: 0.15, h: 0.34 }), { y: -0.02 }, { c: BLACKSTEEL });
    rig.add('head', 'gold', mergeRaw([xf(G.tor(0.158, 0.012, 4, 20), { rx: Math.PI / 2, y: 0.26, sy: 1.05 }), xf(G.box(0.014, 0.3, 0.04), { y: 0.14, z: 0.155 }), ...[0, 1, 2, 3, 4, 5, 6, 7].map((i) => xf(G.cone(0.02, 0.07, 4), { x: Math.sin(i / 8 * TAU) * 0.155, z: Math.cos(i / 8 * TAU) * 0.16, y: 0.3 }))]), {}, { c: GOLDTRIM });
    visorSlit(rig, KC_EYE, 7, 0.17, 0.155, 0.12);
    const R = rng(3);
    const plume = [];
    for (let i = 0; i < 7; i++) { const x = (i - 3) * 0.018; plume.push(tube([[x, 0.33, 0.05], [x * 1.5, 0.45, -0.05], [x * 2, 0.42 + R() * 0.05, -0.25], [x * 2.5, 0.25, -0.42 - R() * 0.08]], (u) => 0.03 * Math.sin(Math.PI * (0.15 + u * 0.85)), 12, 5)); }
    rig.add('head', 'cloth', mergeRaw(plume), {}, { c: [0.55, 0.04, 0.05], anim: (v) => clamp((0.4 - v.z) * 1.5) * 0.8 });
    // greatsword
    addSword(rig, 'handR', { len: 1.45, w: 0.1, th: 0.018, notch: 0.0, bladeC: [2.2, 2.2, 2.2], guardW: 0.42, grip: 0.3, guardMat: 'gold', guardC: GOLDTRIM, seed: 2 });
    rig.socket('muzzle', 'handR', 0, -0.07, 0.9);
    return D;
  },
  pose: humanoidPose,
  anim: {
    death: 'fall', spawn: 'rise', gait: 'plod', armSwing: 0.15, knee: 0.7, stride: 0.5, breath: 1.3,
    rest: { armR: [-0.45, 0, 0.25], foreR: [-0.85, 0, 0], handR: [0.55, 0, 0], armL: [-0.5, 0, -0.32], foreL: [-1.0, 0, 0] },
    stance: (P) => P.apply({ spine: [0.04, 0, 0], thighL: [-0.12, 0, 0.08], thighR: [0.02, 0, -0.08], shinL: [0.16, 0, 0], shinR: [0.1, 0, 0] }),
  },
};

// ------------------------------------------------------------------ hound ----
const EMBER = 0xff6a18;
export const hound = {
  id: 'hound', height: 1.0, radius: 0.5, length: 1.5, eyeColor: EMBER, magicColor: 0xff7a20, defaultAttack: 'bite', attackTypes: ['bite', 'charge', 'breath'], crackColor: 0xff5010, crackIntensity: 4, lunge: 0.8, orbSize: 0.07,
  build(rig) {
    const Q = quadSkeleton(rig, {
      bodyH: 0.66, len: 0.56, w: 0.12, wb: 0.11, legF: [0.28, 0.26, 0.1], legB: [0.3, 0.28, 0.12],
      neck: [0.1, 0.12], head: [0.12, 0.14], jaw: [-0.04, 0.05], tail: 6, tailSeg: 0.11, tailY: 0.05, tailZ: 0.12,
      stF: [0.1, -0.15, 0.05], stB: [-0.45, 0.85, -0.4],
    });
    const HIDE = [1.0, 0.92, 0.88];
    // gaunt ribcage chest, narrow waist, haunches
    const chest = deform(G.sph(0.22, 20, 14), (v) => { v.z *= 1.3; v.x *= 0.72; if (v.y < 0) v.y *= 1.25; });
    rig.add('front', 'magma', bumpy(chest, 0.012, 8, 3), { y: 0.0, z: 0.0 }, { c: HIDE });
    rig.add('body', 'magma', bumpy(xf(taper(0.12, 0.13, 0.42, 12, 3), { rx: Math.PI / 2 }), 0.01, 9, 4), { z: 0.2, y: 0.04 }, { c: HIDE, skin: chainSkin([['rear', -0.2], ['front', 0.15]], (v) => v.z) });
    const ribs = [];
    for (let i = 0; i < 6; i++) ribs.push(xf(G.tor(0.17 - i * 0.008, 0.012, 4, 14, Math.PI * 1.1), { z: -0.12 + i * 0.05, rz: -Math.PI * 0.05, ry: Math.PI / 2, rx: 0, sx: 1, sy: 1.25, x: 0, y: -0.03 }));
    rig.add('front', 'magma', mergeRaw(ribs), { sx: 0.95 }, { c: [0.8, 0.72, 0.68] });
    rig.add('rear', 'magma', bumpy(xf(G.sph(0.16, 14, 10), { sx: 0.95, sz: 1.2 }), 0.01, 9, 6), { y: 0.0, z: -0.04 }, { c: HIDE });
    // dorsal spikes
    const sp = [];
    for (let i = 0; i < 10; i++) sp.push(xf(G.cone(0.025, 0.1 + Math.sin(i / 9 * Math.PI) * 0.1, 4), { z: 0.3 - i * 0.075, y: 0.2 - Math.abs(i - 4) * 0.008, rx: -0.7 }));
    rig.add('body', 'bone', mergeRaw(sp), { y: 0.0 }, { c: [0.18, 0.14, 0.12], skin: chainSkin([['rear', -0.2], ['front', 0.2]], (v) => v.z) });
    // neck with spiky mane
    rig.add('neck', 'magma', bumpy(xf(taper(0.1, 0.085, 0.24, 10, 2), { rx: -Math.PI / 2 + 0.6 }), 0.01, 10, 5), { y: -0.02, z: -0.04 }, { c: HIDE });
    const mane = [];
    for (let i = 0; i < 9; i++) { const a = (i / 8 - 0.5) * 2.6; mane.push(xf(G.cone(0.022, 0.16, 4), { x: Math.sin(a) * 0.08, y: 0.06 + Math.cos(a) * 0.06, z: -0.02 + i * 0.01, rx: -1.2 + Math.cos(a) * 0.3, rz: -Math.sin(a) * 0.8 })); }
    rig.add('neck', 'bone', mergeRaw(mane), {}, { c: [0.16, 0.13, 0.11] });
    // head: long skull-like muzzle, horns, burning eyes and maw
    const skull = deform(G.sph(0.11, 16, 12), (v) => { v.z *= 1.35; v.x *= 0.85; if (v.z > 0.03) { v.y *= 0.8; v.x *= 0.85; } });
    rig.add('head', 'magma', bumpy(skull, 0.008, 12, 9), { y: 0.03, z: 0.04 }, { c: HIDE });
    rig.add('head', 'magma', bumpy(xf(taper(0.07, 0.04, 0.2, 10, 2), { rx: -Math.PI / 2 + 0.08, sx: 1.05, sy: 0.8 }), 0.006, 14, 3), { y: 0.02, z: 0.12 }, { c: HIDE });
    rig.pair('head', 'head', 'bone', tube([[0.05, 0.08, 0.02], [0.09, 0.15, -0.05], [0.1, 0.17, -0.16], [0.08, 0.13, -0.24]], (u) => 0.024 * (1 - u * 0.9), 10, 5), {}, { c: [0.2, 0.17, 0.15] });
    rig.pair('head', 'head', 'dark', G.sph(0.022, 8, 6), { x: 0.05, y: 0.07, z: 0.11, sz: 0.6 });
    rig.pair('head', 'head', 'glow', G.sph(0.015, 8, 6), { x: 0.055, y: 0.07, z: 0.122, sx: 1.4, sy: 0.7 }, { c: HDR(EMBER, 7) });
    rig.add('head', 'glow', G.box(0.06, 0.02, 0.2), { y: -0.02, z: 0.2 }, { c: HDR(EMBER, 3) });
    const teethU = [];
    for (let i = 0; i < 12; i++) { const s = i % 2 ? 1 : -1, z = 0.13 + Math.floor(i / 2) * 0.03; teethU.push(xf(G.cone(0.008, i < 2 ? 0.06 : 0.035, 4), { x: s * 0.035, y: -0.03, z: z + 0.03, rx: Math.PI })); }
    rig.add('head', 'bone', mergeRaw(teethU), {}, { c: [0.85, 0.78, 0.6] });
    rig.add('jaw', 'magma', bumpy(xf(taper(0.05, 0.03, 0.24, 10, 2), { rx: -Math.PI / 2 + 0.05, sy: 0.6 }), 0.005, 14, 2), { y: -0.01, z: 0.0 }, { c: HIDE });
    rig.add('jaw', 'glow', G.box(0.05, 0.015, 0.18), { y: 0.015, z: 0.13 }, { c: HDR(EMBER, 3) });
    const teethL = [];
    for (let i = 0; i < 10; i++) { const s = i % 2 ? 1 : -1; teethL.push(xf(G.cone(0.007, i < 2 ? 0.05 : 0.03, 4), { x: s * 0.028, y: 0.025, z: 0.08 + Math.floor(i / 2) * 0.03 })); }
    rig.add('jaw', 'bone', mergeRaw(teethL), {}, { c: [0.85, 0.78, 0.6] });
    rig.pair('head', 'head', 'magma', xf(G.cone(0.035, 0.1, 4), { sz: 0.4 }), { x: 0.07, y: 0.13, z: -0.03, rz: -0.5, rx: -0.4 }, { c: HIDE });
    // legs: sinewy, clawed
    for (const S of ['L', 'R']) {
      rig.add('legF' + S, 'magma', bumpy(taper(0.075, 0.05, Q.legF[0], 9, 2), 0.006, 12, 2), {}, { c: HIDE });
      rig.add('legF2' + S, 'magma', taper(0.045, 0.03, Q.legF[1], 8, 2), {}, { c: HIDE });
      rig.add('legB' + S, 'magma', bumpy(xf(taper(0.1, 0.05, Q.legB[0], 9, 2), { sz: 1.3 }), 0.008, 10, 7), {}, { c: HIDE });
      rig.add('legB2' + S, 'magma', taper(0.045, 0.03, Q.legB[1], 8, 2), {}, { c: HIDE });
      for (const F of ['F', 'B']) {
        rig.add('paw' + F + S, 'magma', xf(G.sph(0.045, 8, 6), { sx: 1.0, sy: 0.6, sz: 1.5 }), { y: -0.07, z: 0.03 }, { c: HIDE });
        rig.add('paw' + F + S, 'bone', mergeRaw([0, 1, 2, 3].map((i) => xf(G.cone(0.008, 0.05, 4), { x: (i - 1.5) * 0.018, y: -0.09, z: 0.09, rx: Math.PI / 2 + 0.5 }))), {}, { c: [0.1, 0.08, 0.07] });
      }
      rig.add('legB' + S, 'bone', G.cone(0.015, 0.08, 4), { y: -0.05, z: -0.1, rx: -2.2 }, { c: [0.16, 0.13, 0.11] });
    }
    // whip tail with barbed tip
    const pts = [];
    for (let i = 0; i <= 6; i++) pts.push([0, 0.05 - i * 0.02, -0.1 - i * 0.11]);
    const chain = [['rear', 0.08], ...Array.from({ length: Q.tail }, (_, i) => ['tail' + i, Q.tailZ + i * Q.tailSeg])];
    rig.add('rear', 'magma', tube(pts, (u) => 0.035 * (1 - u * 0.7), 24, 6), {}, { c: HIDE, skin: chainSkin(chain, (v) => -v.z) });
    rig.add('tail5', 'bone', mergeRaw([xf(G.cone(0.03, 0.12, 4), { z: -0.12, rx: -Math.PI / 2 }), xf(G.cone(0.015, 0.07, 4), { x: 0.03, z: -0.06, rx: -Math.PI / 2, rz: 0.6 }), xf(G.cone(0.015, 0.07, 4), { x: -0.03, z: -0.06, rx: -Math.PI / 2, rz: -0.6 })]), {}, { c: [0.16, 0.13, 0.11] });
    rig.socket('muzzle', 'head', 0, -0.02, 0.32);
    return Q;
  },
  pose: quadPose,
  anim: { gait: 'trot', stride: 1.3, legAmp: 0.55, lift: 1.0, tailSway: 0.12, tailDroop: 0.2, lean: 0.03, neckDown: 0.25, breath: 2.6, rate: 14,
    extra: (P, m, s, dt, k) => { if (!k.action && !k.dead) P.r('jaw', 0.12 + Math.sin(m.time * 3.1) * 0.06); P.r('neck', 0.2); P.r('head', -0.15); },
  },
};

// ---------------------------------------------------------------- gargoyle ----
const GARG_EYE = 0xffc23a;
export const gargoyle = {
  id: 'gargoyle', height: 2.0, radius: 0.5, flying: true, eyeColor: GARG_EYE, defaultAttack: 'claw', attackTypes: ['claw', 'slam'],
  build(rig) {
    const D = humanSkeleton(rig, { thigh: 0.36, shin: 0.36, ankle: 0.08, spine: 0.14, chest: 0.3, neck: 0.06, shoulderW: 0.2, upper: 0.3, fore: 0.3, jaw: [0.035, 0.06] });
    wingBones(rig, 'chest', 0.09, D.chest * 0.8, -0.12, 0.85, 0.42);
    let prev = 'hips';
    for (let i = 0; i < 6; i++) { rig.bone('tail' + i, prev, 0, i === 0 ? -0.02 : -0.02, i === 0 ? -0.12 : -0.12, { rate: 0.7 }); prev = 'tail' + i; }
    const ST = [0.95, 0.92, 0.88];
    addFleshBody(rig, D, { mat: 'stone', c: ST, muscle: 1.5, seed: 41, rough: 3, hunch: 0.06, claws: 0.07, toeClaws: true, clawC: 0x2a2826, torsoW: 1.05 });
    // head: brutish snout, horns, ears, fangs
    const hd = deform(G.sph(0.11, 16, 12), (v) => { v.z *= 1.1; if (v.y > 0.03 && v.z > 0.04) v.z += 0.015; if (v.y < -0.02) v.x *= 0.9; });
    rig.add('head', 'stone', bumpy(hd, 0.008, 10, 5), { y: 0.1, z: 0.02 }, { c: ST });
    rig.add('head', 'stone', bumpy(xf(G.box(0.12, 0.07, 0.1), { y: 0.05, z: 0.09 }), 0.004, 12, 2), {}, { c: ST });
    rig.add('head', 'stone', xf(G.box(0.15, 0.03, 0.04), { y: 0.15, z: 0.1, rx: 0.3 }), {}, { c: ST }); // brow
    rig.pair('head', 'head', 'stone', tube([[0.06, 0.17, 0.03], [0.12, 0.25, -0.01], [0.13, 0.33, -0.08], [0.1, 0.38, -0.16]], (u) => 0.028 * (1 - u * 0.85), 12, 6), {}, { c: [0.45, 0.43, 0.42] });
    rig.pair('head', 'head', 'stone', xf(G.cone(0.04, 0.13, 4), { sz: 0.35 }), { x: 0.1, y: 0.13, z: -0.0, rz: -1.0, ry: -0.3 }, { c: ST });
    rig.pair('head', 'head', 'dark', G.sph(0.02, 8, 6), { x: 0.04, y: 0.12, z: 0.11, sz: 0.6 });
    rig.pair('head', 'head', 'glow', G.sph(0.014, 8, 6), { x: 0.042, y: 0.12, z: 0.122 }, { c: HDR(GARG_EYE, 7) });
    rig.add('head', 'dark', G.box(0.09, 0.02, 0.05), { y: 0.035, z: 0.12 });
    rig.pair('head', 'head', 'stone', G.cone(0.012, 0.05, 4), { x: 0.035, y: 0.02, z: 0.13, rx: Math.PI }, { c: [0.75, 0.72, 0.68] });
    rig.add('jaw', 'stone', xf(G.box(0.1, 0.03, 0.09), { z: 0.045 }), {}, { c: ST });
    rig.pair('jaw', 'jaw', 'stone', G.cone(0.012, 0.05, 4), { x: 0.04, y: 0.03, z: 0.08 }, { c: [0.75, 0.72, 0.68] });
    // back spines
    rig.add('chest', 'stone', mergeRaw([0, 1, 2, 3].map((i) => xf(G.cone(0.025, 0.09, 4), { y: 0.05 + i * 0.07, z: -0.15, rx: -1.0 }))), {}, { c: [0.45, 0.43, 0.42] });
    // stone wings
    addWing(rig, 1, { span: 0.85, mat: 'stone', c: [0.5, 0.48, 0.46], boneC: [0.7, 0.68, 0.64], claw: true, fingers: 4, flutter: 0 });
    addWing(rig, -1, { span: 0.85, mat: 'stone', c: [0.5, 0.48, 0.46], boneC: [0.7, 0.68, 0.64], claw: true, fingers: 4, flutter: 0 });
    // spade tail
    const pts = []; for (let i = 0; i <= 6; i++) pts.push([0, -0.02 - i * 0.02, -0.1 - i * 0.12]);
    const chain = [['hips', 0.08], ...Array.from({ length: 6 }, (_, i) => ['tail' + i, 0.12 + i * 0.12])];
    rig.add('hips', 'stone', tube(pts, (u) => 0.045 * (1 - u * 0.75), 24, 6), {}, { c: ST, skin: chainSkin(chain, (v) => -v.z) });
    rig.add('tail5', 'stone', xf(G.cone(0.07, 0.16, 4), { z: -0.12, rx: -Math.PI / 2, sx: 1, sy: 0.3 }), {}, { c: ST });
    rig.socket('muzzle', 'head', 0, 0.05, 0.16);
    return D;
  },
  pose: humanoidPose,
  anim: {
    gait: 'float', hover: 0.4, death: 'apart', look: 0.7,
    spawn: (P, p, m) => {
      // statue awakening: crouched on the ground, trembles, then launches upward
      const k = 1 - smooth(0.55, 1, p);
      P.apply({ hips: [0.3, 0, 0, 0, -0.42, 0], thighL: [-1.7, 0, 0.3], thighR: [-1.7, 0, -0.3], shinL: [2.4, 0, 0], shinR: [2.4, 0, 0], spine: [0.4, 0, 0], chest: [0.2, 0, 0], head: [-0.4, 0, 0], armL: [-0.6, 0, 0.3], armR: [-0.6, 0, -0.3], foreL: [-0.9, 0, 0], foreR: [-0.9, 0, 0] }, k);
      P.p('base', 0, -0.55 * k, 0);
      const tr = bump(0.15, 0.55, p) * 0.03;
      P.r('chest', Math.sin(m.time * 60) * tr, Math.sin(m.time * 47) * tr);
      flapWings(P, m.time * 9, 0.8 * smooth(0.5, 0.8, p), 0.1, k);
      return 14;
    },
    stance: (P, m, s) => P.apply({ thighL: [-0.6, 0, 0.15], thighR: [-0.4, 0, -0.15], shinL: [1.1, 0, 0], shinR: [0.9, 0, 0], footL: [0.4, 0, 0], footR: [0.4, 0, 0], spine: [0.25, 0, 0], chest: [0.15, 0, 0], neck: [-0.2, 0, 0], head: [-0.2, 0, 0], armL: [-0.3, 0, 0], armR: [-0.3, 0, 0], foreL: [-0.6, 0, 0], foreR: [-0.6, 0, 0] }),
    actions: {
      claw: act2(
        { armR: [-2.5, 0, -0.6], armL: [-2.5, 0, 0.6], foreR: [-0.6, 0, 0], foreL: [-0.6, 0, 0], chest: [-0.3, 0, 0], head: [0.2, 0, 0], jaw: [0.6, 0, 0], base: [0, 0, 0, 0, 0.35, -0.3] },
        { armR: [-0.7, 0, 0.5], armL: [-0.7, 0, -0.5], foreR: [-0.2, 0, 0], foreL: [-0.2, 0, 0], chest: [0.5, 0, 0], spine: [0.3, 0, 0], head: [-0.2, 0, 0], jaw: [0.8, 0, 0], base: [0.3, 0, 0, 0, -0.35, 0.6] },
        { hit: 0.3 },
      ),
      slam: act2(
        { armR: [-2.9, 0, -0.3], armL: [-2.9, 0, 0.3], foreR: [-0.5, 0, 0], foreL: [-0.5, 0, 0], chest: [-0.35, 0, 0], base: [0, 0, 0, 0, 0.5, 0] },
        { armR: [-0.4, 0, 0.3], armL: [-0.4, 0, -0.3], chest: [0.6, 0, 0], spine: [0.3, 0, 0], base: [0, 0, 0, 0, -0.55, 0.3], thighL: [-1.0, 0, 0], thighR: [-1.0, 0, 0], shinL: [1.6, 0, 0], shinR: [1.6, 0, 0] },
        { hit: 0.22 },
      ),
    },
    extra: (P, m, s, dt, k) => {
      const dead = s.anim === 'death', sp = s.anim === 'spawn';
      if (!dead && !sp) {
        const fast = k.action ? 1.5 : 1 + k.w * 0.4;
        m.state.flap = (m.state.flap ?? 0) + dt * 8.5 * fast;
        flapWings(P, m.state.flap, 0.75, 0.15, 0);
        P.p('base', 0, Math.sin(m.state.flap) * 0.06, 0);
      } else if (dead) flapWings(P, 0, 0.3, -0.4 * s.progress, 0.6 * s.progress);
      for (let i = 0; i < 6; i++) P.r('tail' + i, 0.25 + Math.sin(m.time * 2 - i * 0.6) * 0.08, Math.sin(m.time * 1.4 - i * 0.7) * 0.15, 0);
    },
  },
};

// ------------------------------------------------------------ battlePriest ----
const HOLY = 0xffd27a;
export const battlePriest = {
  id: 'battlePriest', height: 2.05, radius: 0.45, eyeColor: 0xffe08a, magicColor: HOLY, defaultAttack: 'cast', attackTypes: ['cast', 'swing', 'summon'], orbSize: 0.08, flutter: 0.03,
  build(rig) {
    const D = humanSkeleton(rig, { thigh: 0.45, shin: 0.44, spine: 0.16, chest: 0.32, neck: 0.08, shoulderW: 0.2, upper: 0.3, fore: 0.29, jaw: [0.045, 0.03] });
    rig.bone('censer', 'handL', 0, -0.08, 0.02, { rate: 0.5 });
    const ALB = [0.36, 0.33, 0.29], ROBE = [0.32, 0.05, 0.06];
    // layered robes: long alb, red chasuble front/back, gold stole
    rig.add('hips', 'cloth', robe(0.2, 0.36, D.hipH - 0.06, { seg: 22, rows: 6, folds: 8, foldAmp: 0.07, tatter: 0.18, seed: 5 }), { y: 0.06 }, { c: ALB, anim: (v) => clamp(-v.y / 0.9) * 0.9 });
    rig.add('hips', 'cloth', lathe([[0.2, 0.0], [0.19, 0.12], [0.2, 0.22]], 14), { y: 0.0 }, { c: ALB });
    rig.add('chest', 'cloth', lathe([[0.17, -0.05], [0.2, 0.14], [0.22, 0.24], [0.13, 0.32], [0.07, 0.34]], 14), { sz: 0.82 }, { c: ALB });
    for (const [z, ry] of [[1, 0], [-1, Math.PI]]) rig.add('chest', 'cloth', panel(0.38, 1.25, { ws: 5, hs: 8, tatter: 0.2, seed: 9 + z, curve: 0.08, taperBot: 0.75 }), { y: D.chest + 0.02, z: z * 0.19, ry, rx: 0.1 }, { c: ROBE, anim: (v) => clamp((-v.y - 0.3) / 1.0), skin: chainSkin([['hips', -D.spine - 0.4], ['spine', -D.spine * 0.5], ['chest', 0.0]], (v) => v.y) });
    rig.add('chest', 'gold', mergeRaw([xf(G.box(0.06, 1.1, 0.012), { x: 0.07, y: D.chest - 0.5, z: 0.17 }), xf(G.box(0.06, 1.1, 0.012), { x: -0.07, y: D.chest - 0.5, z: 0.17 }), xf(G.box(0.1, 0.12, 0.012), { x: 0.07, y: D.chest - 1.0, z: 0.172 }), xf(G.box(0.1, 0.12, 0.012), { x: -0.07, y: D.chest - 1.0, z: 0.172 })]), {}, { c: GOLDTRIM, skin: chainSkin([['hips', -D.spine - 0.4], ['spine', -D.spine * 0.5], ['chest', 0.0]], (v) => v.y - D.chest) });
    rig.add('chest', 'gold', xf(G.tor(0.15, 0.03, 5, 18), { rx: Math.PI / 2, y: D.chest + 0.02, sz: 0.85 }), {}, { c: GOLDTRIM });
    // desiccated skull face under a tall mitre
    addSkull(rig, 'head', 'jaw', { eye: 0xffe08a, eyeK: 6, c: [0.62, 0.52, 0.42] });
    const mitre = lathe([[0.115, 0.0], [0.12, 0.08], [0.11, 0.2], [0.06, 0.32], [0.001, 0.36]], 12);
    deform(mitre, (v) => { v.z *= 0.75; v.x *= 1.05; });
    rig.add('head', 'cloth', mitre, { y: 0.15 }, { c: [0.6, 0.55, 0.48] });
    rig.add('head', 'gold', mergeRaw([xf(G.tor(0.116, 0.012, 4, 16), { rx: Math.PI / 2, y: 0.17, sz: 0.75 }), xf(G.box(0.02, 0.28, 0.01), { y: 0.3, z: 0.085, rx: -0.12 }), xf(G.box(0.12, 0.02, 0.01), { y: 0.33, z: 0.08, rx: -0.12 })]), {}, { c: GOLDTRIM });
    // sleeves + bony hands
    for (const S of ['L', 'R']) {
      const sx = S === 'L' ? 1 : -1;
      rig.add('arm' + S, 'cloth', robe(0.065, 0.08, D.upper + 0.02, { seg: 10, rows: 2, folds: 4, tatter: 0, seed: 2 }), { y: 0.02 }, { c: ALB });
      rig.add('fore' + S, 'cloth', robe(0.07, 0.12, D.fore * 0.85, { seg: 12, rows: 2, folds: 5, foldAmp: 0.12, tatter: 0.25, seed: 5 + sx }), {}, { c: ALB, anim: (v) => clamp(-v.y * 3) * 0.6 });
      addFleshHand(rig, 'hand' + S, sx, { mat: 'bone', c: [0.62, 0.52, 0.42], m: 0.8, grip: true });
    }
    // holy-symbol staff (sun disc) in the right hand
    const L = 1.9, grip = 0.55, tip = L * (1 - grip);
    const st0 = { y: -0.07 };
    rig.add('handR', 'wood', xf(G.cyl(0.02, 0.024, L, 8), { rx: Math.PI / 2, z: (tip - L * grip) / 2 }), st0, { c: [0.45, 0.32, 0.22] });
    rig.add('handR', 'gold', mergeRaw([xf(G.tor(0.13, 0.016, 5, 24), {}), xf(G.tor(0.07, 0.01, 4, 16), {}), ...Array.from({ length: 12 }, (_, i) => { const a = (i / 12) * TAU; return xf(G.cone(0.016, i % 2 ? 0.07 : 0.12, 4), { x: Math.cos(a) * (0.13 + (i % 2 ? 0.035 : 0.06)), y: Math.sin(a) * (0.13 + (i % 2 ? 0.035 : 0.06)), rz: a - Math.PI / 2 }); })]), { ...st0, z: tip + 0.14, rx: Math.PI / 2 }, { c: GOLDTRIM });
    rig.add('handR', 'gold', xf(G.cyl(0.03, 0.03, 0.06, 8), { rx: Math.PI / 2, z: tip - 0.02 }), st0, { c: GOLDTRIM });
    rig.add('handR', 'glow', G.sph(0.045, 10, 8), { ...st0, z: tip + 0.14 }, { c: HDR(HOLY, 4) });
    // censer: chain + perforated brass pot with glowing coals
    rig.add('censer', 'gold', mergeRaw(Array.from({ length: 7 }, (_, i) => xf(G.tor(0.012, 0.004, 4, 6), { y: -0.02 - i * 0.025, ry: (i % 2) * 1.57 }))), {}, { c: GOLDTRIM });
    rig.add('censer', 'gold', mergeRaw([xf(lathe([[0.001, -0.08], [0.06, -0.06], [0.075, 0.0], [0.06, 0.04], [0.02, 0.07], [0.001, 0.09]], 10), { y: -0.27 }), xf(G.cone(0.015, 0.05, 6), { y: -0.17 })]), {}, { c: GOLDTRIM });
    rig.add('censer', 'glow', mergeRaw(Array.from({ length: 8 }, (_, i) => { const a = (i / 8) * TAU; return xf(G.sph(0.013, 5, 4), { x: Math.cos(a) * 0.072, z: Math.sin(a) * 0.072, y: -0.265 }); })), {}, { c: HDR(0xff9a30, 5) });
    rig.add('censer', 'spirit', G.sph(0.11, 10, 8), { y: -0.27 }, { c: HDR(0xff8a30, 0.18) });
    rig.socket('muzzle', 'handR', 0, -0.07, tip + 0.14);
    return D;
  },
  pose: humanoidPose,
  anim: {
    death: 'fallBack', spawn: 'rise', caster: true, idleOrb: 0.0, armSwing: 0.2, stride: 0.45, gait: 'plod',
    // staff held upright: hand bone local +Y maps up when the forearm is level, so the staff runs along hand +Y
    rest: { armR: [-0.3, 0, -0.08], foreR: [-1.15, 0, 0], handR: [0.0, 0, 0], armL: [-0.25, 0, 0.12], foreL: [-0.75, 0, 0] },
    stance: (P) => P.apply({ spine: [0.08, 0, 0], neck: [0.05, 0, 0], head: [0.08, 0, 0] }),
    actions: {
      cast: act2(
        { armR: [-0.5, 0, -0.2], foreR: [-1.5, 0, 0], handR: [0.3, 0, 0], armL: [-0.6, 0, 0.5], foreL: [-1.0, 0, 0], chest: [-0.15, 0, 0], head: [-0.15, 0, 0] },
        { armR: [-1.5, 0, 0.15], foreR: [-0.4, 0, 0], handR: [-0.6, 0, 0], armL: [-0.4, 0, 0.4], foreL: [-0.8, 0, 0], chest: [0.2, 0.1, 0], spine: [0.1, 0, 0], head: [-0.05, 0, 0], hips: [0, 0, 0, 0, -0.03, 0.08] },
        { hit: 0.3, recover: 0.85, recoverAmt: 0.3 },
      ),
      // swing the censer like a flail
      swing: act2(
        { armL: [-2.6, 0, 0.6], foreL: [-0.6, 0, 0], chest: [-0.15, 0.4, 0], spine: [0, 0.2, 0], head: [0, -0.4, 0] },
        { armL: [-0.6, 0, -0.5], foreL: [-0.2, 0, 0], chest: [0.3, -0.5, 0], spine: [0.15, -0.2, 0], head: [-0.1, 0.4, 0], hips: [0, 0, 0, 0, -0.08, 0.15] },
        { hit: 0.25 },
      ),
    },
    extra: (P, m, s, dt, k) => {
      const T = m.time;
      // censer pendulum, wild during swing attack
      if (k.action && s.attackType === 'swing') P.r('censer', s.anim === 'windup' ? -2.0 + Math.cos(T * 12) * 0.5 : 1.4 * (1 - s.progress), 0, s.anim === 'windup' ? Math.sin(T * 12) * 1.0 : 0);
      else P.r('censer', Math.sin(T * 2.4) * 0.45 + k.w * Math.sin(k.ph) * 0.3, 0, Math.sin(T * 1.9) * 0.15);
      if (!k.action) P.r('jaw', Math.max(0, Math.sin(T * 1.7)) * 0.15);
    },
  },
};

export const COURTYARD_TYPES = [fallenKnight, hound, gargoyle, battlePriest, knightCaptain];
