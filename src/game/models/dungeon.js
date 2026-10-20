import * as THREE from 'three';
import { G, xf, lathe, shell, robe, panel, tube, taper, deform, bumpy, mergeRaw, chainSkin, rng, clamp, lerp, TAU, smooth, bump, easeOut } from './core.js';
import { humanSkeleton, humanoidPose, act2, ACT } from './humanoid.js';
import { addSkull, addSkeletonBody, addBoneHand, addFleshHand, addSword, addRoundShield, addAxe, addTowerShield, addClub, pointedHood, addFleshBody, pauldron, kettleHat, HDR, belt, rivets, addBow, hood, STEEL, RUSTY, DARKSTEEL, BRASS } from './parts.js';

const BONE_C = 0xe2d8c2;
const RUST = RUSTY;

// rusty nasal helm
function nasalHelm(r = 0.118) {
  return mergeRaw([
    lathe([[r, 0], [r * 1.02, 0.05], [r * 0.95, 0.1], [r * 0.7, 0.15], [r * 0.25, 0.175], [0.001, 0.18]], 14),
    xf(G.tor(r * 1.01, 0.008, 4, 18), { rx: Math.PI / 2, y: 0.005 }),
    xf(G.box(0.022, 0.09, 0.012), { z: r + 0.004, y: -0.03 }),
    xf(G.box(0.012, 0.16, 0.01), { z: 0, y: 0.1, rx: -0.15, sz: 1 }),
  ]);
}

function skeletonBase(rig, o = {}) {
  const D = humanSkeleton(rig, { thigh: 0.43, shin: 0.42, spine: 0.14, chest: 0.3, neck: 0.08, shoulderW: 0.18, upper: 0.3, fore: 0.27, jaw: [0.045, 0.03], ...o.dims });
  addSkeletonBody(rig, D, { c: o.boneC ?? BONE_C, grip: { R: true, L: o.gripL } });
  addSkull(rig, 'head', 'jaw', { eye: o.eye ?? 0x5fd8ff, eyeK: 7, c: o.boneC ?? BONE_C });
  return D;
}

// ------------------------------------------------------------ skeleton ----
export const skeleton = {
  id: 'skeleton', height: 1.8, radius: 0.4, eyeColor: 0x5fd8ff, defaultAttack: 'swing', attackTypes: ['swing', 'thrust'],
  build(rig) {
    const D = skeletonBase(rig);
    rig.add('head', 'iron', nasalHelm(), { y: 0.115, z: 0.005 }, { c: RUST });
    rig.add('armL', 'iron', pauldron(0.095, 3), { x: 0.025, y: -0.03, rz: 0.55, sy: 0.7 }, { c: RUST });
    rig.add('armL', 'leather', G.tor(0.06, 0.009, 4, 12), { y: -0.07, rx: Math.PI / 2 }, { c: 0x4a3020 });
    // harness strap across ribs
    rig.add('chest', 'leather', xf(G.tor(0.17, 0.012, 4, 20), { rx: Math.PI / 2, sz: 0.6 }), { y: 0.17, rz: 0.55, z: -0.005 }, { c: 0x4a3020 });
    rig.add('chest', 'iron', G.cyl(0.02, 0.02, 0.012, 8), { x: 0.06, y: 0.12, z: 0.1, rx: Math.PI / 2 }, { c: RUST });
    // belt + tattered loincloth
    rig.add('hips', 'leather', belt(0.14, 0.05, 0.75), { y: 0.02 }, { c: 0x3e2a1c });
    rig.add('hips', 'iron', G.box(0.05, 0.045, 0.015), { y: 0.02, z: 0.11 }, { c: RUST });
    rig.add('hips', 'cloth', panel(0.2, 0.38, { tatter: 0.35, seed: 4, curve: 0.05 }), { y: 0.0, z: 0.105 }, { c: 0x5a2420, anim: (v) => -v.y * 0.8 });
    rig.add('hips', 'cloth', panel(0.24, 0.42, { tatter: 0.4, seed: 9, curve: -0.05 }), { y: 0.0, z: -0.09 }, { c: 0x4a201c, anim: (v) => -v.y * 0.8 });
    // bracer on sword arm
    rig.add('foreR', 'leather', G.cyl(0.034, 0.03, 0.13, 8), { y: -0.17 }, { c: 0x4a3020 });
    addSword(rig, 'handR', { len: 0.78, notch: 0.35, bladeC: [2.1, 1.9, 1.7], seed: 3 });
    addRoundShield(rig, 'foreL', { r: 0.3, y: -0.14, x: 0.07 });
    rig.socket('muzzle', 'handR', 0, -0.07, 0.45);
    return D;
  },
  pose: humanoidPose,
  anim: {
    death: 'collapse', spawn: 'rise', armSwing: 0.35, knee: 0.8,
    rest: { armR: [-0.25, 0, -0.05], foreR: [-0.7, 0, 0], handR: [0.55, 0, 0], armL: [-0.25, -0.85, 0.2], foreL: [-1.3, 0, 0] },
    stance: (P) => { P.r('spine', 0.08); P.r('neck', 0.05); P.r('head', -0.1); P.r('shinL', 0.1); P.r('shinR', 0.1); P.r('thighL', -0.06); P.r('thighR', -0.06); },
    extra: (P, m, s, dt, k) => { if (!k.action) P.r('jaw', 0.08 + Math.max(0, Math.sin(m.time * 0.9)) * 0.12); },
  },
};



// ------------------------------------------------------- skeletonArcher ----
export const skeletonArcher = {
  id: 'skeletonArcher', height: 1.8, radius: 0.4, eyeColor: 0x5fd8ff, defaultAttack: 'shoot', attackTypes: ['shoot', 'swing'], flutter: 0.035,
  build(rig) {
    const D = skeletonBase(rig, { gripL: true });
    rig.bone('nock', 'handL', 0, -0.06, 0);
    rig.bone('arrow', 'nock', 0, 0, 0);
    // ragged hood and shoulder cape
    const h = hood(0.135, 0.2, { open: 0.26, peak: 0.9 });
    rig.add('head', 'cloth', h.shell, { y: 0.11, z: -0.01 }, { c: [0.24, 0.26, 0.2] });
    rig.add('chest', 'cloth', robe(0.13, 0.25, 0.32, { seg: 16, rows: 3, folds: 6, foldAmp: 0.12, tatter: 0.4, seed: 5 }), { y: D.chest + 0.03, sz: 0.8 }, { c: [0.22, 0.24, 0.18], anim: (v) => clamp(-v.y * 3) * 0.7 });
    rig.add('chest', 'cloth', panel(0.36, 0.75, { tatter: 0.45, seed: 12, curve: 0.08 }), { y: D.chest - 0.02, z: -0.12, ry: Math.PI }, { c: [0.2, 0.22, 0.17], anim: (v) => -v.y * 0.9 });
    // leather jerkin pieces
    rig.add('chest', 'leather', xf(G.cyl(0.15, 0.13, 0.16, 12, true), { sz: 0.75 }), { y: 0.07 }, { c: 0x5a3a24 });
    rig.add('hips', 'leather', belt(0.14, 0.05, 0.75), { y: 0.02 }, { c: 0x3e2a1c });
    rig.add('hips', 'cloth', panel(0.22, 0.34, { tatter: 0.45, seed: 2 }), { y: 0.0, z: 0.105 }, { c: [0.25, 0.22, 0.16], anim: (v) => -v.y * 0.8 });
    rig.add('foreL', 'leather', G.cyl(0.034, 0.03, 0.15, 8), { y: -0.16 }, { c: 0x4a3020 });
    // quiver with arrows on the back
    const qt = { x: -0.06, y: 0.12, z: -0.12, rz: -0.35, rx: 0.15 };
    rig.add('chest', 'leather', mergeRaw([xf(G.cyl(0.055, 0.045, 0.48, 10, false), { y: 0.0 }), xf(G.tor(0.056, 0.008, 4, 12), { y: 0.22, rx: Math.PI / 2 })]), qt, { c: 0x4a2c1a });
    const arrows = [], fl = [];
    for (let i = 0; i < 6; i++) { const a = i * 1.1, r = 0.025; arrows.push(xf(G.cyl(0.004, 0.004, 0.2, 3), { x: Math.cos(a) * r, z: Math.sin(a) * r, y: 0.32 })); fl.push(xf(G.box(0.003, 0.06, 0.025), { x: Math.cos(a) * r, z: Math.sin(a) * r, y: 0.4, ry: a })); }
    rig.add('chest', 'wood', mergeRaw(arrows), qt, { c: [0.8, 0.65, 0.45] });
    rig.add('chest', 'cloth', mergeRaw(fl), qt, { c: [0.7, 0.15, 0.1] });
    rig.add('chest', 'leather', xf(G.tor(0.2, 0.01, 4, 20), { rx: Math.PI / 2, sz: 0.65 }), { y: 0.17, rz: -0.6 }, { c: 0x3a2418 });
    // bow + nocked arrow (arrow only shown while drawing)
    addBow(rig, 'handL', 'nock', { len: 1.25 });
    rig.add('arrow', 'wood', xf(G.cyl(0.005, 0.005, 0.72, 4), { y: -0.36 }), {}, { c: [0.8, 0.65, 0.45] });
    rig.add('arrow', 'iron', xf(G.cone(0.014, 0.05, 4), { y: -0.74, rx: Math.PI }), {}, { c: STEEL });
    rig.add('arrow', 'cloth', xf(G.box(0.003, 0.07, 0.03), { y: -0.04 }), {}, { c: [0.7, 0.15, 0.1] });
    rig.socket('muzzle', 'nock', 0, -0.72, 0);
    return D;
  },
  pose: humanoidPose,
  anim: {
    death: 'collapse', spawn: 'rise', armSwing: 0.3,
    rest: { armL: [-0.35, 0, 0.05], foreL: [-0.5, 0, 0], handL: [0.3, 0, 0], armR: [-0.1, 0, -0.05], foreR: [-0.3, 0, 0] },
    stance: (P) => { P.r('spine', 0.06); P.r('head', -0.08); P.r('shinL', 0.1); P.r('shinR', 0.1); P.r('thighL', -0.06); P.r('thighR', -0.06); },
    actions: {
      shoot: (P, ph, p, m) => {
        const AIM = { armL: [-1.5, 0.75, 0], foreL: [0, 0, 0], handL: [0, 0, 0], armR: [-1.5, 0.55, 0], foreR: [-2.7, 0, 0], handR: [0, 0, 0], chest: [0, -0.75, 0], spine: [0, -0.15, 0], head: [0.05, 0.8, 0], neck: [0, 0.1, 0], thighL: [-0.15, 0, 0.1], thighR: [0.1, 0, -0.1] };
        if (ph === 'windup') {
          const d = smooth(0.15, 0.85, p);
          P.blend({ armL: [-0.9, 0.4, 0], foreL: [-0.3, 0, 0], armR: [-0.9, 0.5, 0], foreR: [-1.6, 0, 0], chest: [0, -0.4, 0], head: [0, 0.4, 0] }, AIM, smooth(0, 0.4, p));
          P.p('nock', 0, 0.42 * d, 0);
          P.s('arrow', 1);
          P.r('armL', Math.sin(m.time * 33) * 0.01 * d);
          return 12;
        }
        const rel = smooth(0, 0.1, p);
        P.apply(AIM, 1 - smooth(0.5, 1, p));
        P.r('foreR', 1.0 * rel * (1 - smooth(0.5, 1, p))); P.r('armR', 0, 0.4 * rel * (1 - smooth(0.5, 1, p)), 0);
        P.p('nock', 0, 0.42 * (1 - rel), 0);
        P.s('arrow', rel > 0.5 ? 0.001 : 1);
        return 30;
      },
    },
    extra: (P, m, s, dt, k) => { if (!(k.action && s.attackType === 'shoot')) P.s('arrow', 0.001); if (!k.action) P.r('jaw', 0.06 + Math.max(0, Math.sin(m.time * 0.9)) * 0.1); },
  },
};

// ----------------------------------------------------------------- wraith ----
const WRAITH_EYE = 0x9ff4ff;
export const wraith = {
  id: 'wraith', height: 2.2, radius: 0.45, flying: true, eyeColor: WRAITH_EYE, magicColor: 0x7fe8ff, defaultAttack: 'claw', attackTypes: ['claw', 'cast'], flutter: 0.06, orbSize: 0.07,
  build(rig) {
    const D = humanSkeleton(rig, { thigh: 0.42, shin: 0.4, spine: 0.18, chest: 0.32, neck: 0.1, shoulderW: 0.2, upper: 0.32, fore: 0.3 });
    const GH = [0.32, 0.42, 0.45];
    // main shroud: hangs from the shoulders down past the (missing) legs, skinned chest > spine > hips
    const len = 1.35;
    const sh = robe(0.2, 0.42, len, { seg: 24, rows: 10, folds: 8, foldAmp: 0.16, tatter: 0.45, seed: 7 });
    deform(sh, (v) => { v.z *= 0.85; if (v.y < -0.6) v.z -= (-v.y - 0.6) * 0.35; }, true);
    const topY = 0.05 + D.spine + D.chest + 0.02; // in hips space
    rig.add('hips', 'ghost', sh, { y: topY }, {
      c: GH,
      anim: (v) => clamp((-v.y - 0.15) / len) ** 1.3 * 2.2,
      skin: chainSkin([['hips', topY - len * 0.9], ['spine', 0.15], ['chest', topY - 0.25]], (v) => v.y + topY),
    });
    // inner dark layer so the shroud never looks hollow
    rig.add('chest', 'dark', xf(G.cyl(0.16, 0.22, 0.5, 10, false), { y: 0.1 }), {}, {});
    // ragged mantle over shoulders
    rig.add('chest', 'ghost', robe(0.12, 0.34, 0.42, { seg: 18, rows: 4, folds: 7, foldAmp: 0.18, tatter: 0.5, seed: 3 }), { y: D.chest + 0.05, sz: 0.85 }, { c: [0.26, 0.34, 0.38], anim: (v) => clamp(-v.y * 2.5) * 1.5 });
    // deep hood with void and piercing eyes
    const h = hood(0.16, 0.2, { open: 0.24, peak: 1.6 });
    rig.add('head', 'ghost', h.shell, { y: 0.1, z: -0.01 }, { c: [0.22, 0.28, 0.32] });
    rig.add('head', 'dark', xf(G.sph(0.12, 12, 10), { sz: 0.9 }), { y: 0.09, z: -0.005 });
    rig.pair('head', 'head', 'glow', xf(G.sph(0.016, 8, 6), { sx: 1.6, sy: 0.6 }), { x: 0.04, y: 0.1, z: 0.105, rz: -0.25 }, { c: HDR(WRAITH_EYE, 9) });
    rig.add('head', 'spirit', G.sph(0.06, 10, 8), { y: 0.1, z: 0.08, sx: 1.8, sy: 0.7, sz: 0.4 }, { c: HDR(WRAITH_EYE, 0.25) });
    // sleeves and skeletal hands
    for (const S of ['L', 'R']) {
      const sx = S === 'L' ? 1 : -1;
      rig.add('arm' + S, 'ghost', robe(0.07, 0.09, D.upper + 0.03, { seg: 10, rows: 2, folds: 4, tatter: 0, seed: 2 }), { y: 0.02 }, { c: GH });
      rig.add('fore' + S, 'ghost', robe(0.08, 0.14, D.fore * 0.95, { seg: 12, rows: 3, folds: 5, foldAmp: 0.15, tatter: 0.5, seed: 4 + sx }), {}, { c: GH, anim: (v) => clamp(-v.y * 3) * 1.4 });
      rig.add('fore' + S, 'bone', G.cyl(0.012, 0.01, D.fore * 0.6, 5), { y: -D.fore * 0.7 }, { c: [0.85, 0.85, 0.8] });
      addBoneHand(rig, 'hand' + S, sx, { mat: 'bone', c: [0.85, 0.85, 0.8], s: 1.35 });
      for (let i = 0; i < 4; i++) rig.add('hand' + S, 'bone', G.cone(0.005, 0.05, 4), { x: (i - 1.5) * 0.017, y: -0.13, z: 0.02, rx: Math.PI - 0.6 }, { c: [0.6, 0.6, 0.58] });
    }
    // spectral wisps trailing below
    const wisps = [];
    const R = rng(9);
    for (let i = 0; i < 7; i++) { const a = (i / 7) * TAU; wisps.push(tube([[Math.sin(a) * 0.28, 0, Math.cos(a) * 0.24], [Math.sin(a) * 0.32, -0.2, Math.cos(a) * 0.26 - 0.1], [Math.sin(a + 0.4) * 0.24, -0.45 - R() * 0.15, Math.cos(a) * 0.2 - 0.3]], (u) => 0.035 * (1 - u), 8, 5)); }
    rig.add('hips', 'spirit', mergeRaw(wisps), { y: -0.3 }, { c: HDR(0x7fe8ff, 0.07), anim: (v) => clamp(-v.y * 2) * 1.6 });
    // a broken chain shackle on one wrist
    rig.add('foreR', 'iron', mergeRaw([xf(G.tor(0.05, 0.012, 4, 10), { rx: Math.PI / 2, y: -0.22 }), ...[0, 1, 2].map((i) => xf(G.tor(0.022, 0.007, 4, 8), { y: -0.27 - i * 0.035, ry: (i % 2) * 1.57, x: 0.04 }))]), {}, { c: DARKSTEEL });
    rig.socket('muzzle', 'handR', 0, -0.1, 0.05);
    return D;
  },
  pose: humanoidPose,
  anim: {
    gait: 'float', hover: 0.42, death: 'dissipate', spawn: 'materialize', caster: false, look: 0.6,
    rest: { armL: [-0.35, 0, 0.15], foreL: [-0.6, 0, 0], armR: [-0.35, 0, -0.15], foreR: [-0.6, 0, 0], handL: [0.3, 0, 0], handR: [0.3, 0, 0] },
    stance: (P, m) => { P.apply({ spine: [0.15, 0, 0], chest: [0.12, 0, 0], neck: [-0.05, 0, 0], head: [-0.05, 0, 0] }); P.r('hips', Math.sin(m.time * 0.8) * 0.04, 0, Math.sin(m.time * 0.6) * 0.05); },
    actions: {
      claw: act2(
        { armR: [-2.5, 0, -0.6], armL: [-2.3, 0, 0.6], foreR: [-0.7, 0, 0], foreL: [-0.7, 0, 0], handR: [-0.4, 0, 0], handL: [-0.4, 0, 0], chest: [-0.35, 0, 0], spine: [-0.15, 0, 0], head: [-0.15, 0, 0] },
        { armR: [-0.8, 0, 0.5], armL: [-1.2, 0, -0.4], foreR: [-0.2, 0, 0], foreL: [-0.3, 0, 0], handR: [0.4, 0, 0], handL: [0.4, 0, 0], chest: [0.45, 0, 0], spine: [0.3, 0, 0], head: [0.2, 0, 0], base: [0, 0, 0, 0, -0.1, 0.35] },
        { hit: 0.25 },
      ),
      cast: act2(
        { armR: [-0.4, 0, -0.5], foreR: [-1.6, 0, 0], armL: [-0.4, 0, 0.5], foreL: [-1.6, 0, 0], chest: [-0.2, 0, 0], head: [-0.25, 0, 0] },
        { armR: [-1.6, 0, 0.1], foreR: [0, 0, 0], handR: [-0.5, 0, 0], armL: [-0.6, 0, 0.4], foreL: [-0.5, 0, 0], chest: [0.2, 0, 0], head: [0.1, 0, 0] },
        { hit: 0.25, recover: 0.85 },
      ),
    },
    extra: (P, m, s, dt) => { m.U.uFlutterSpeed.value = 1.6; },
  },
};

// ----------------------------------------------------------------- jailer ----
export const jailer = {
  id: 'jailer', height: 2.4, radius: 0.7, eyeColor: 0xff8a3a, defaultAttack: 'slam', attackTypes: ['slam', 'swing', 'bash'],
  build(rig) {
    const D = humanSkeleton(rig, { thigh: 0.52, shin: 0.5, ankle: 0.08, hipW: 0.16, spine: 0.25, chest: 0.45, neck: 0.08, shoulderW: 0.33, shoulderDrop: 0.07, upper: 0.42, fore: 0.4 });
    rig.bone('flail', 'handR', 0, -0.07, 0.55);
    const SK = [0.42, 0.3, 0.26];
    addFleshBody(rig, D, { c: SK, muscle: 1.9, belly: 0.1, bellyY: 0.15, depth: 1.2, seed: 21, torsoW: 1.05, grip: { R: true, L: true } });
    // leather apron, straps and belt
    rig.add('chest', 'leather', panel(0.5, 1.15, { ws: 6, hs: 8, tatter: 0.08, seed: 3, curve: 0.18, taperBot: 0.85 }), { y: D.chest * 0.75, z: 0.2, rx: 0.08 }, { c: [0.75, 0.55, 0.42], skin: chainSkin([['thighL', -0.95], ['hips', -0.55], ['chest', 0.0]], (v) => v.y), anim: (v) => clamp((-v.y - 0.6) * 0.8) * 0.4 });
    rig.add('chest', 'leather', mergeRaw([xf(G.box(0.05, 0.62, 0.02), { x: 0.16, y: D.chest * 0.65, z: 0.19, rx: -0.4, rz: 0.1 }), xf(G.box(0.05, 0.62, 0.02), { x: -0.16, y: D.chest * 0.65, z: 0.19, rx: -0.4, rz: -0.1 })]), {}, { c: [0.45, 0.3, 0.2] });
    rig.add('hips', 'leather', xf(G.cyl(0.29, 0.29, 0.08, 18, true), { sz: 0.85 }), { y: 0.02 }, { c: [0.4, 0.28, 0.18] });
    rig.add('hips', 'iron', G.box(0.1, 0.09, 0.03), { y: 0.02, z: 0.26 }, { c: RUSTY });
    // key ring + shackles on the belt
    rig.add('hips', 'iron', mergeRaw([xf(G.tor(0.05, 0.008, 4, 12), { x: 0.24, y: -0.06, z: 0.12, ry: 1.0 }), ...[0, 1, 2, 3].map((i) => xf(G.box(0.012, 0.09, 0.004), { x: 0.24 + (i - 1.5) * 0.02, y: -0.13, z: 0.13, rz: (i - 1.5) * 0.2 })), xf(G.tor(0.06, 0.012, 4, 12), { x: -0.25, y: -0.08, z: 0.06, ry: 1.3 })]), {}, { c: RUSTY });
    // trousers & boots
    for (const S of ['L', 'R']) {
      rig.add('thigh' + S, 'cloth', taper(0.15, 0.11, D.thigh + 0.05, 10, 2), { y: 0.03 }, { c: [0.3, 0.26, 0.22] });
      rig.add('shin' + S, 'leather', taper(0.1, 0.09, D.shin * 0.75, 10, 2), { y: -D.shin * 0.25 }, { c: [0.35, 0.24, 0.16] });
      rig.add('foot' + S, 'leather', xf(G.sph(0.07, 10, 6), { sx: 1.05, sy: 0.6, sz: 1.9 }), { y: -0.04, z: 0.06 }, { c: [0.3, 0.2, 0.14] });
      rig.add('fore' + S, 'leather', G.cyl(0.08, 0.07, 0.2, 10), { y: -0.27 }, { c: [0.35, 0.24, 0.16] });
    }
    // iron mask helm: bucket with eye slits, breathing holes and rivets
    const helm = shell([[0.135, -0.02], [0.14, 0.12], [0.135, 0.22], [0.1, 0.27], [0.001, 0.285]], 0.012, 16);
    deform(helm, (v) => { v.z *= 1.08; if (v.z > 0) v.z += Math.max(0, 1 - Math.abs(v.x) / 0.14) * 0.02; });
    rig.add('head', 'iron', helm, { y: 0.0 }, { c: DARKSTEEL });
    rig.pair('head', 'head', 'dark', G.box(0.06, 0.016, 0.02), { x: 0.045, y: 0.15, z: 0.145 });
    rig.pair('head', 'head', 'glow', G.box(0.03, 0.008, 0.01), { x: 0.045, y: 0.15, z: 0.15 }, { c: HDR(0xff8a3a, 4) });
    rig.add('head', 'dark', mergeRaw([0, 1, 2, 3, 4, 5].map((i) => xf(G.cyl(0.006, 0.006, 0.02, 5), { x: (i % 3 - 1) * 0.025, y: 0.06 + Math.floor(i / 3) * 0.025, z: 0.155, rx: Math.PI / 2 }))));
    rig.add('head', 'iron', mergeRaw([xf(G.tor(0.142, 0.01, 4, 20), { rx: Math.PI / 2, y: 0.0, sy: 1.08 }), xf(G.box(0.02, 0.27, 0.02), { y: 0.13, z: 0.155 }), xf(G.tor(0.142, 0.01, 4, 20), { rx: Math.PI / 2, y: 0.2, sy: 1.08 })]), {}, { c: RUSTY });
    rig.add('head', 'iron', rivets(Array.from({ length: 12 }, (_, i) => { const a = (i / 12) * TAU; return [Math.sin(a) * 0.15, 0.1, Math.cos(a) * 0.15 * 1.08]; }), 0.01), {}, { c: RUSTY });
    // big iron shield on the left, flail on the right
    addTowerShield(rig, 'foreL', { w: 0.7, h: 1.05, y: -0.2, c: [0.4, 0.34, 0.3], rimC: RUSTY, spike: true });
    rig.add('handR', 'wood', xf(G.cyl(0.03, 0.035, 0.6, 8), { rx: Math.PI / 2, z: 0.22 }), { y: -0.07 }, { c: [0.6, 0.42, 0.3] });
    rig.add('handR', 'iron', xf(G.cyl(0.04, 0.04, 0.06, 8), { rx: Math.PI / 2, z: 0.52 }), { y: -0.07 }, { c: RUSTY });
    const links = mergeRaw(Array.from({ length: 6 }, (_, i) => xf(G.tor(0.025, 0.008, 4, 8), { y: -0.035 - i * 0.045, ry: (i % 2) * Math.PI / 2 })));
    rig.add('flail', 'iron', links, {}, { c: DARKSTEEL });
    const ball = mergeRaw([G.sph(0.13, 12, 9), ...Array.from({ length: 14 }, (_, i) => { const a = i * 2.4, b = Math.acos(1 - 2 * (i + 0.5) / 14); const d = new THREE.Vector3(Math.sin(b) * Math.cos(a), Math.cos(b), Math.sin(b) * Math.sin(a)); const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d); const e = new THREE.Euler().setFromQuaternion(q); return xf(G.cone(0.03, 0.09, 4), { x: d.x * 0.15, y: d.y * 0.15, z: d.z * 0.15, rx: e.x, ry: e.y, rz: e.z }); })]);
    rig.add('flail', 'iron', ball, { y: -0.4 }, { c: DARKSTEEL });
    rig.socket('muzzle', 'flail', 0, -0.4, 0);
    return D;
  },
  pose: humanoidPose,
  anim: {
    death: 'fall', spawn: 'rise', gait: 'plod', armSwing: 0.2, armOut: 0.25, stride: 0.42, knee: 0.7, breath: 1.2,
    rest: { armR: [-0.3, 0, -0.05], foreR: [-0.9, 0, 0], handR: [0.5, 0, 0], armL: [-0.3, -0.9, 0.25], foreL: [-1.3, 0, 0] },
    stance: (P) => P.apply({ spine: [0.08, 0, 0], chest: [0.1, 0, 0], neck: [-0.1, 0, 0], thighL: [-0.1, 0, 0.08], thighR: [-0.1, 0, -0.08], shinL: [0.18, 0, 0], shinR: [0.18, 0, 0], hips: [0, 0, 0, 0, -0.03, 0] }),
    actions: {
      bash: act2(
        { armL: [-0.1, -1.2, 0.5], foreL: [-1.5, 0, 0], chest: [-0.1, 0.5, 0], spine: [0, 0.2, 0], hips: [0, 0, 0, 0, -0.05, -0.1], thighR: [-0.4, 0, 0], shinR: [0.6, 0, 0] },
        { armL: [-0.9, -0.9, 0.2], foreL: [-1.0, 0, 0], chest: [0.2, -0.3, 0], spine: [0.15, -0.1, 0], hips: [0, 0, 0, 0, -0.08, 0.35], thighL: [-0.7, 0, 0], shinL: [0.6, 0, 0] },
        { hit: 0.22 },
      ),
    },
    extra: (P, m, s, dt, k) => {
      // flail pendulum (lags the hand), whirls during windup
      const T = m.time;
      if (k.action && s.anim === 'windup') { P.r('flail', -1.2 + Math.cos(T * 14) * 0.9, 0, Math.sin(T * 14) * 1.3); }
      else if (k.action && s.anim === 'attack') { P.r('flail', 0.6 * (1 - s.progress) - 0.2, 0, 0); }
      else P.r('flail', Math.sin(T * 2.2) * 0.25 + 0.2 + k.w * Math.sin(k.ph) * 0.4, 0, Math.sin(T * 1.7) * 0.2);
    },
  },
};

// -------------------------------------------------------- executionerGuard ----
export function buildHeadsman(rig, o = {}) {
  const boss = !!o.boss;
  const D = humanSkeleton(rig, { thigh: 0.54, shin: 0.52, ankle: 0.08, hipW: 0.15, spine: 0.24, chest: 0.48, neck: 0.1, shoulderW: 0.32, shoulderDrop: 0.06, upper: 0.42, fore: 0.4, jaw: boss ? [0.04, 0.05] : null });
  const SK = [0.5, 0.38, 0.32];
  addFleshBody(rig, D, { c: SK, muscle: boss ? 1.9 : 1.75, seed: 31, torsoW: 1.08, grip: { R: true, L: true }, belly: boss ? 0.04 : 0 });
  // scars
  rig.add('chest', 'skin', mergeRaw([tube([[0.18, 0.1, 0.19], [0.05, 0.2, 0.22], [-0.12, 0.34, 0.2]], 0.007, 10, 3), tube([[-0.15, 0.05, 0.2], [-0.05, 0.12, 0.22]], 0.006, 6, 3), tube([[0.2, 0.3, 0.16], [0.24, 0.38, 0.1]], 0.006, 6, 3)]), {}, { c: [0.7, 0.36, 0.32] });
  // black hood with mantle, eye holes
  rig.add('head', 'cloth', pointedHood(0.13, { lean: 0.8 }), { y: 0.0 }, { c: [0.09, 0.08, 0.08] });
  rig.add('chest', 'cloth', robe(0.16, 0.44, boss ? 0.42 : 0.34, { seg: 18, rows: 3, folds: 7, foldAmp: 0.1, tatter: 0.35, seed: 4 }), { y: D.chest + 0.08, sz: 0.85 }, { c: [0.09, 0.08, 0.08], anim: (v) => clamp(-v.y * 2.5) * 0.5 });
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
  rig.add('hips', 'leather', robe(0.27, 0.38, 0.42, { seg: 10, rows: 2, folds: 5, foldAmp: 0.04, tatter: 0.15, seed: 6 }), { y: -0.02, sz: 0.85 }, { c: [0.16, 0.11, 0.08], anim: (v) => clamp(-v.y * 2) * 0.5, skin: chainSkin([['hips', -0.08], ['thighL', -0.5]], (v) => -v.y) });
  rig.add('hips', 'iron', rivets(Array.from({ length: 10 }, (_, i) => { const a = (i / 10 - 0.5) * 2.4; return [Math.sin(a) * 0.29, -0.15, Math.cos(a) * 0.25]; }), 0.012), {}, { c: RUSTY });
  for (const S of ['L', 'R']) {
    rig.add('thigh' + S, 'cloth', taper(0.14, 0.105, D.thigh + 0.05, 10, 2), { y: 0.03 }, { c: [0.14, 0.12, 0.11] });
    rig.add('shin' + S, 'leather', taper(0.1, 0.085, D.shin * 0.8, 10, 2), { y: -D.shin * 0.2 }, { c: [0.22, 0.14, 0.1] });
    rig.add('foot' + S, 'leather', xf(G.sph(0.07, 10, 6), { sx: 1.05, sy: 0.6, sz: 1.9 }), { y: -0.04, z: 0.06 }, { c: [0.18, 0.12, 0.09] });
    rig.add('fore' + S, 'leather', G.cyl(0.075, 0.065, 0.22, 10), { y: -0.24 }, { c: [0.22, 0.14, 0.1] });
    rig.add('fore' + S, 'iron', mergeRaw([[0.07, 0.03], [-0.07, 0.03], [0, 0.075]].flatMap(([x, z]) => [-0.17, -0.26].map((y) => xf(G.cone(0.012, boss ? 0.05 : 0.025, 4), { x, y, z, rz: x > 0 ? -1.57 : x < 0 ? 1.57 : 0, rx: x === 0 ? 1.57 : 0 })))), {}, { c: RUSTY });
  }
  rig.add('chest', 'leather', xf(G.box(0.06, 0.85, 0.02), { y: D.chest * 0.5, rz: 0.75 }), { z: 0.0 }, { c: [0.22, 0.14, 0.1] });
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
  anim: HEADSMAN_ANIM,
};
export { HEADSMAN_ANIM };

export const DUNGEON_TYPES = [skeleton, skeletonArcher, wraith, jailer, executionerGuard];
