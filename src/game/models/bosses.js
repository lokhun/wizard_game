import * as THREE from 'three';
import { G, xf, taper, lathe, shell, tube, deform, bumpy, shaggy, robe, panel, mergeRaw, chainSkin, spikeRing, rng, vnoise, clamp, lerp, smooth, bump, easeOut, easeIn, easeInOut, TAU } from './core.js';
import { humanSkeleton, humanoidPose, act2, ACT } from './humanoid.js';
import {
  addSkull, addFleshHand, addBoneHand, addSword, swordGeo, addPlate, addTabard, greatHelm, hood, addWing, wingBones, flapWings, addCrystalStaff, addRoundShield,
  pauldron, rivets, twoSided, HDR, STEEL, RUSTY, DARKSTEEL, BLACKSTEEL, GOLDTRIM,
} from './parts.js';
import { buildHeadsman, HEADSMAN_ANIM } from './dungeon.js';
import { skullGeo } from '../../world/props.js';

import { motherOfFilth } from './bossFilth.js';

const _tmp = new THREE.Vector3();

import { executioner } from './bossHeadsman.js';

import { stoneWyvern } from './bossWyvern.js';

import { courtArchmage } from './bossArchmage.js';

// ================================================================= hollowKing ==
const HOLLOW = 0x9ad8ff;
export const hollowKing = {
  id: 'hollowKing', height: 5.3, radius: 1.3, boss: true, eyeColor: HOLLOW, magicColor: HOLLOW, defaultAttack: 'slam', attackTypes: ['seated', 'slam', 'sweep', 'thrust', 'summon', 'roar', 'beam'], flutter: 0.035, orbSize: 0.12,
  build(rig) {
    rig.scale = 2.15;
    const D = humanSkeleton(rig, { thigh: 0.52, shin: 0.5, ankle: 0.08, hipW: 0.12, spine: 0.2, chest: 0.4, neck: 0.1, shoulderW: 0.26, upper: 0.37, fore: 0.35 });
    rig.bone('crown', 'head', 0, 0.3, 0.0, { rate: 0.5 });
    // dark padded body under the plate
    const W = D.shoulderW;
    const tors = lathe([[0.001, -0.1], [W * 0.6, -0.08], [W * 0.66, 0.05], [W * 0.68, 0.05 + D.spine], [W * 0.78, 0.05 + D.spine + D.chest * 0.7], [W * 0.4, 0.05 + D.spine + D.chest + 0.03], [0.001, 0.08 + D.spine + D.chest]], 12);
    deform(tors, (v) => { v.z *= 0.7; });
    rig.add('hips', 'cloth', tors, {}, { c: [0.05, 0.04, 0.05], skin: chainSkin([['hips', 0.0], ['spine', 0.05 + D.spine * 0.45], ['chest', 0.05 + D.spine + D.chest * 0.25]], (v) => v.y) });
    for (const S of ['L', 'R']) { rig.add('arm' + S, 'cloth', taper(0.05, 0.04, D.upper, 8, 1), {}, { c: [0.05, 0.04, 0.05] }); rig.add('thigh' + S, 'cloth', taper(0.08, 0.06, D.thigh, 8, 1), {}, { c: [0.05, 0.04, 0.05] }); }
    const BK = [0.16, 0.15, 0.18];
    addPlate(rig, D, { mat: 'steel', c: BK, bulk: 1.18, pauldron: 0.17, trim: true, mailC: [0.35, 0.35, 0.4] });
    // spiked pauldron crests
    for (const S of ['L', 'R']) { const sx = S === 'L' ? 1 : -1; rig.add('arm' + S, 'gold', mergeRaw([0, 1, 2].map((i) => xf(G.cone(0.025, 0.16 - i * 0.03, 4), { x: sx * (0.02 + i * 0.05), y: 0.13 - i * 0.03, rz: -sx * (0.3 + i * 0.25) }))), {}, { c: GOLDTRIM }); }
    addTabard(rig, D, { c: [0.2, 0.03, 0.1], tatter: 0.35, seed: 9, len: 1.05, w: 0.75, emblem: mergeRaw([xf(G.box(0.16, 0.035, 0.01), {}), ...[-1, 0, 1].map((i) => xf(G.cone(0.025, i === 0 ? 0.1 : 0.07, 4), { x: i * 0.055, y: 0.05 }))]) });
    // tattered royal cape with ermine collar
    const cape = panel(0.8, 1.9, { ws: 8, hs: 12, tatter: 0.35, seed: 13, curve: 0.18, taperBot: 1.45 });
    rig.add('chest', 'cloth', cape, { y: D.chest - 0.01, z: -0.22, ry: Math.PI, rx: 0.08 }, { c: [0.22, 0.02, 0.08], anim: (v) => clamp(-v.y / 1.6) * 1.6, skin: chainSkin([['hips', -1.0], ['spine', -0.5], ['chest', -0.05]], (v) => v.y) });
    rig.add('chest', 'fur', bumpy(xf(G.tor(0.25, 0.075, 8, 22), { rx: Math.PI / 2, sz: 0.8 }), 0.012, 14, 7), { y: D.chest + 0.03 }, { cfn: (v) => (vnoise(v.x * 30, v.y * 30, v.z * 30, 3) > 0.82 ? [0.04, 0.04, 0.04] : [0.9, 0.88, 0.82]) });
    // hollow face: hood, void with eyes, floating spiked crown
    const h = hood(0.15, 0.15, { open: 0.3, peak: 0.3 });
    rig.add('head', 'cloth', h.shell, { y: 0.1, z: -0.01 }, { c: [0.06, 0.05, 0.07] });
    rig.add('head', 'steel', shell([[0.14, -0.0], [0.15, 0.1], [0.14, 0.2], [0.001, 0.27]], 0.01, 16), { y: 0.0, sz: 1.08 }, { c: BK });
    rig.add('head', 'dark', xf(G.sph(0.12, 12, 10), { sz: 0.85 }), { y: 0.11, z: 0.02 });
    rig.add('head', 'spirit', xf(G.sph(0.1, 10, 8), { sz: 0.5 }), { y: 0.11, z: 0.07 }, { c: HDR(HOLLOW, 0.35) });
    rig.pair('head', 'head', 'glow', xf(G.sph(0.018, 8, 6), { sx: 1.5, sy: 0.6 }), { x: 0.045, y: 0.125, z: 0.115, rz: -0.2 }, { c: HDR(HOLLOW, 10) });
    rig.add('head', 'gold', xf(G.box(0.16, 0.02, 0.03), {}), { y: 0.2, z: 0.13 }, { c: GOLDTRIM });
    const crownG = mergeRaw([xf(G.cyl(0.16, 0.15, 0.06, 18, true), {}), spikeRing(0.16, 9, 0.24, 0.03, 0.03, 0.15), spikeRing(0.15, 9, 0.12, 0.025, 0.03, 0.08)]);
    rig.add('crown', 'gold', crownG, { sz: 1.05 }, { c: [0.7, 0.55, 0.3] });
    rig.add('crown', 'glow', mergeRaw([0, 1, 3, 4, 6, 7].map((i) => xf(G.oct(0.026), { x: Math.sin((i + 0.5) / 9 * TAU) * 0.165, z: Math.cos((i + 0.5) / 9 * TAU) * 0.17, y: 0.03 }))), {}, { c: HDR(HOLLOW, 6) });
    rig.add('crown', 'spirit', xf(G.tor(0.18, 0.02, 4, 24), { rx: Math.PI / 2 }), { y: 0.06 }, { c: HDR(HOLLOW, 0.9) });
    // giant greatsword with a glowing fuller
    addSword(rig, 'handR', { len: 1.7, w: 0.13, th: 0.022, notch: 0.15, bladeC: [1.0, 1.0, 1.1], guardW: 0.46, grip: 0.32, guardMat: 'gold', guardC: GOLDTRIM, glowEdge: HDR(HOLLOW, 3), seed: 4 });
    rig.socket('muzzle', 'handR', 0, -0.07, 1.6);
    return D;
  },
  pose: humanoidPose,
  anim: {
    death: 'fall', spawn: 'rise', gait: 'plod', armSwing: 0.15, stride: 0.5, knee: 0.7, breath: 0.8, look: 0.5,
    rest: { armR: [-0.45, 0, 0.25], foreR: [-0.85, 0, 0], handR: [0.55, 0, 0], armL: [-0.5, 0, -0.32], foreL: [-1.0, 0, 0] },
    stance: (P) => P.apply({ spine: [0.04, 0, 0], thighL: [-0.1, 0, 0.08], thighR: [0.02, 0, -0.08], shinL: [0.14, 0, 0], shinR: [0.1, 0, 0] }),
    seated: (P, m) => {
      P.apply({ armR: [-0.55, 0, 0.3], foreR: [-0.95, 0, 0], handR: [2.9, 0, 0], armL: [-0.25, 0, 0.35], foreL: [-1.25, 0, 0], handL: [0.2, 0, 0], head: [0.25, 0, 0], neck: [0.1, 0, 0] });
      P.r('head', 0, Math.sin(m.time * 0.2) * 0.15, 0);
    },
    actions: {
      summon: act2(
        { armR: [-0.4, 0, 0.3], foreR: [-0.9, 0, 0], handR: [2.0, 0, 0], armL: [-0.5, 0, 0.5], foreL: [-1.2, 0, 0], chest: [0.2, 0, 0], head: [0.25, 0, 0] },
        { armR: [-0.5, 0, 0.3], foreR: [-0.9, 0, 0], handR: [2.9, 0, 0], armL: [-2.6, 0, 0.4], foreL: [-0.2, 0, 0], handL: [-0.6, 0, 0], chest: [-0.25, 0, 0], head: [-0.4, 0, 0], hips: [0, 0, 0, 0, -0.15, 0.1], thighL: [-0.6, 0, 0], shinL: [1.0, 0, 0], thighR: [0.2, 0, 0], shinR: [0.9, 0, 0] },
        { hit: 0.35, recover: 0.85 },
      ),
      beam: act2(
        { armR: [-0.8, 0, -0.2], foreR: [-1.2, 0, 0], handR: [0.4, 0, 0], armL: [-0.9, 0, 0.3], foreL: [-1.0, 0, 0], chest: [-0.25, -0.3, 0], head: [0.1, 0.3, 0] },
        { armR: [-1.5, 0, 0.3], foreR: [-0.05, 0, 0], handR: [0.0, 0, 0], armL: [-1.4, 0, -0.3], foreL: [-0.3, 0, 0], chest: [0.1, 0.2, 0], spine: [0.08, 0, 0], head: [0, -0.2, 0], hips: [0, 0, 0, 0, -0.06, 0.08] },
        { hit: 0.2, recover: 0.9, recoverAmt: 0.2 },
      ),
    },
    extra: (P, m, s, dt, k) => {
      P.r('crown', Math.sin(m.time * 0.6) * 0.05, m.time * 0.25, Math.sin(m.time * 0.5) * 0.05);
      P.p('crown', 0, 0.02 + Math.sin(m.time * 1.2) * 0.012, 0);
      if (s.anim === 'death') { P.p('crown', 0.2 * s.progress, -0.5 * smooth(0.5, 1, s.progress), 0.3 * s.progress); P.r('crown', 1.2 * s.progress, 0, 0.8 * s.progress); }
      if (k.action && (s.attackType === 'beam' || s.attackType === 'summon')) m.setOrb(s.anim === 'windup' ? 0.3 + 0.6 * s.progress : s.anim === 'cast' ? 1 : 1 - smooth(0.7, 1, s.progress));
    },
  },
};

export const BOSS_TYPES = [motherOfFilth, executioner, stoneWyvern, courtArchmage, hollowKing];
