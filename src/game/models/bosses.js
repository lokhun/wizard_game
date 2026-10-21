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

// ============================================================= courtArchmage ==
const ARC = 0x9a7aff;
export const courtArchmage = {
  id: 'courtArchmage', height: 4.6, radius: 1.0, boss: true, flying: true, eyeColor: 0xc8b0ff, magicColor: ARC, defaultAttack: 'cast', attackTypes: ['cast', 'summon', 'spin', 'beam'], orbSize: 0.12, flutter: 0.03,
  build(rig) {
    rig.scale = 1.85;
    const D = humanSkeleton(rig, { thigh: 0.45, shin: 0.44, spine: 0.17, chest: 0.33, neck: 0.09, shoulderW: 0.21, upper: 0.31, fore: 0.29 });
    for (let i = 0; i < 3; i++) rig.bone('halo' + i, 'head', 0, 0.36 + i * 0.07, -0.02, { rate: 0.6 });
    rig.bone('circleA', 'chest', 0, 0.15, -0.35, { rate: 0.5 });
    rig.bone('circleB', 'chest', 0, 0.2, -0.45, { rate: 0.4 });
    const VIOL = [0.18, 0.06, 0.3], GOLDC = [0.9, 0.75, 0.45], WHITE = [0.6, 0.55, 0.48];
    // three robe layers
    rig.add('hips', 'cloth', robe(0.19, 0.3, D.hipH + 0.15, { seg: 22, rows: 6, folds: 8, foldAmp: 0.05, tatter: 0.0, seed: 3 }), { y: 0.04 }, { c: WHITE, anim: (v) => clamp(-v.y / 1.0), cfn: (v) => (v.y < -(D.hipH + 0.08) ? GOLDTRIM : WHITE) });
    const mid = new THREE.CylinderGeometry(0.21, 0.4, D.hipH + 0.12, 24, 6, true, 0.5, TAU - 1.0);
    xf(mid, { y: -(D.hipH + 0.12) / 2 });
    deform(mid, (v) => { const a = Math.atan2(v.x, v.z); const k = 1 + Math.sin(a * 9) * 0.04 * (-v.y); v.x *= k; v.z *= k; });
    rig.add('hips', 'cloth', mid, { y: 0.1 }, { c: VIOL, anim: (v) => clamp(-v.y / 1.0) * 1.2, cfn: (v) => { const a = Math.atan2(v.x, v.z); return (Math.abs(Math.abs(a) - 0.5) < 0.05 || v.y < -(D.hipH + 0.04)) ? GOLDTRIM : VIOL; } });
    const outer = new THREE.CylinderGeometry(0.24, 0.55, D.hipH + 0.25, 24, 6, true, 1.4, TAU - 2.8);
    xf(outer, { y: -(D.hipH + 0.25) / 2 });
    rig.add('chest', 'cloth', outer, { y: -D.spine + 0.15, z: -0.03 }, { c: [0.08, 0.04, 0.16], anim: (v) => clamp(-v.y / 1.2) * 1.5, cfn: (v) => (v.y < -(D.hipH + 0.18) ? GOLDTRIM : [0.08, 0.04, 0.16]), skin: chainSkin([['hips', -1.2], ['chest', -0.1]], (v) => v.y) });
    rig.add('chest', 'cloth', lathe([[0.17, -0.08], [0.21, 0.14], [0.23, 0.25], [0.14, 0.33], [0.07, 0.35]], 14), { sz: 0.82 }, { c: VIOL });
    // ornate front panel with glowing sigils
    rig.add('chest', 'gold', panel(0.16, 0.95, { ws: 2, hs: 6, tatter: 0, seed: 1, curve: 0.02 }), { y: 0.3, z: 0.19 }, { c: GOLDC, skin: chainSkin([['hips', -0.6], ['chest', 0.0]], (v) => v.y), anim: (v) => clamp(-v.y - 0.4) * 0.6 });
    rig.add('chest', 'glow', mergeRaw([0, 1, 2, 3].map((i) => xf(G.oct(0.022), { y: 0.2 - i * 0.2, z: 0.2, sz: 0.3 }))), {}, { c: HDR(ARC, 3), skin: chainSkin([['hips', -0.6], ['chest', 0.0]], (v) => v.y) });
    // mantle w/ spiked shoulder pieces + tall collar
    rig.add('chest', 'cloth', robe(0.13, 0.33, 0.28, { seg: 18, rows: 2, folds: 7, foldAmp: 0.08, tatter: 0.0, seed: 6 }), { y: D.chest + 0.06, sz: 0.85 }, { c: VIOL, cfn: (v) => (v.y < -0.24 ? GOLDTRIM : VIOL) });
    rig.pair('chest', 'chest', 'gold', mergeRaw([pauldron(0.1, 2), xf(G.cone(0.025, 0.16, 4), { y: 0.14, rz: -0.4 }), xf(G.cone(0.02, 0.12, 4), { y: 0.1, x: 0.06, rz: -0.9 })]), { x: 0.2, y: D.chest - 0.02, rz: 0.4 }, { c: GOLDC });
    const collar = new THREE.CylinderGeometry(0.26, 0.12, 0.42, 18, 2, true, Math.PI * 0.55, Math.PI * 0.9);
    rig.add('chest', 'cloth', twoSided(xf(collar, { y: 0.21 })), { y: D.chest + 0.03, z: -0.03 }, { c: [0.12, 0.05, 0.22] });
    rig.add('chest', 'gold', xf(new THREE.TorusGeometry(0.26, 0.012, 4, 18, Math.PI * 0.9), { rx: Math.PI / 2, rz: -Math.PI * 0.95 }), { y: D.chest + 0.45, z: -0.03 }, { c: GOLDTRIM });
    // masked face in a deep hood
    const h = hood(0.135, 0.14, { open: 0.3, peak: 0.5 });
    rig.add('head', 'cloth', h.shell, { y: 0.1, z: -0.01 }, { c: [0.1, 0.04, 0.18] });
    rig.add('head', 'dark', G.sph(0.108, 10, 8), { y: 0.1 });
    const mask = new THREE.SphereGeometry(0.1, 16, 12, Math.PI * 0.08, Math.PI * 0.84, Math.PI * 0.12, Math.PI * 0.72);
    rig.add('head', 'gold', deform(mask, (v) => { if (Math.abs(v.x) < 0.015 && v.y < 0.03) v.z += 0.014; if (v.y < -0.04) v.x *= 0.85; }), { y: 0.1, z: 0.028 }, { c: [1.2, 1.05, 0.8] });
    rig.pair('head', 'head', 'dark', xf(G.box(0.045, 0.014, 0.02), { rz: 0.25 }), { x: 0.036, y: 0.118, z: 0.122 });
    rig.pair('head', 'head', 'glow', xf(G.box(0.035, 0.007, 0.01), { rz: 0.25 }), { x: 0.036, y: 0.118, z: 0.128 }, { c: HDR(0xc8b0ff, 7) });
    rig.add('head', 'glow', G.oct(0.016), { y: 0.17, z: 0.128 }, { c: HDR(ARC, 5) });
    rig.add('head', 'dark', G.box(0.05, 0.006, 0.01), { y: 0.06, z: 0.123 });
    // floating rune rings (crown)
    for (let i = 0; i < 3; i++) {
      const r = 0.2 - i * 0.04;
      rig.add('halo' + i, 'gold', xf(G.tor(r, 0.008, 4, 28), { rx: Math.PI / 2 }), {}, { c: GOLDTRIM });
      const gl = [];
      for (let k = 0; k < 10 - i * 2; k++) { const a = (k / (10 - i * 2)) * TAU; gl.push(xf(G.box(0.025, 0.03, 0.004), { x: Math.cos(a) * r, z: Math.sin(a) * r, ry: -a + Math.PI / 2 })); }
      rig.add('halo' + i, 'spirit', mergeRaw(gl), {}, { c: HDR(ARC, 2.5) });
    }
    // spell circles behind
    const circle = (r, n, seed) => {
      const parts = [xf(G.tor(r, 0.008, 3, 48), {}), xf(G.tor(r * 0.82, 0.005, 3, 48), {})];
      const pts = [];
      for (let k = 0; k < n; k++) { const a = (k / n) * TAU; pts.push([Math.cos(a) * r * 0.8, Math.sin(a) * r * 0.8]); }
      for (let k = 0; k < n; k++) { const a = pts[k], b = pts[(k + Math.floor(n / 2) - 1) % n]; const dx = b[0] - a[0], dy = b[1] - a[1]; const len = Math.hypot(dx, dy); parts.push(xf(G.box(len, 0.006, 0.003), { x: (a[0] + b[0]) / 2, y: (a[1] + b[1]) / 2, rz: Math.atan2(dy, dx) })); }
      for (let k = 0; k < n * 2; k++) { const a = (k / (n * 2)) * TAU + seed; parts.push(xf(G.box(0.03, 0.04, 0.003), { x: Math.cos(a) * r * 0.91, y: Math.sin(a) * r * 0.91, rz: a })); }
      return mergeRaw(parts);
    };
    rig.add('circleA', 'spirit', circle(0.62, 7, 0), {}, { c: HDR(ARC, 2.2) });
    rig.add('circleB', 'spirit', circle(0.36, 5, 1), {}, { c: HDR(0x6ab0ff, 2.0) });
    // sleeves + gloved hands
    for (const S of ['L', 'R']) {
      const sx = S === 'L' ? 1 : -1;
      rig.add('arm' + S, 'cloth', robe(0.065, 0.085, D.upper + 0.02, { seg: 10, rows: 2, folds: 4, tatter: 0, seed: 2 }), { y: 0.02 }, { c: VIOL });
      rig.add('fore' + S, 'cloth', robe(0.075, 0.17, D.fore * 0.95, { seg: 14, rows: 2, folds: 6, foldAmp: 0.1, tatter: 0.0, seed: 5 + sx }), {}, { c: VIOL, anim: (v) => clamp(-v.y * 3) * 0.6, cfn: (v) => (v.y < -D.fore * 0.85 ? GOLDTRIM : VIOL) });
      addFleshHand(rig, 'hand' + S, sx, { mat: 'leather', c: [0.2, 0.12, 0.22], m: 0.85, grip: S === 'R' });
      rig.add('hand' + S, 'gold', mergeRaw([xf(G.tor(0.01, 0.004, 3, 6), { x: 0.0, y: -0.09, rx: Math.PI / 2 })]), {}, { c: GOLDTRIM });
    }
    const st = addCrystalStaff(rig, 'handR', { len: 2.4, color: ARC, k: 4, crystalR: 0.08 });
    rig.add('handR', 'glow', mergeRaw([0, 1, 2].map((i) => { const a = i * 2.1; return xf(G.oct(0.025), { x: Math.cos(a) * 0.15, y: Math.sin(a) * 0.15, z: st.tip, sz: 2 }); })), { y: -0.07 }, { c: HDR(0x6ab0ff, 3) });
    rig.socket('muzzle', 'handR', 0, -0.07, st.tip);
    return D;
  },
  pose: humanoidPose,
  anim: {
    gait: 'float', hover: 0.3, death: 'dissipate', spawn: 'materialize', caster: true, idleOrb: 0.25, look: 0.5, breath: 1.0,
    rest: { armR: [-0.3, 0, -0.08], foreR: [-1.2, 0, 0], handR: [0.0, 0, 0], armL: [-0.5, 0, 0.25], foreL: [-1.0, 0.6, 0], handL: [-0.5, 0, 0.3] },
    stance: (P) => P.apply({ spine: [-0.03, 0, 0], head: [0.03, 0, 0] }),
    actions: {
      cast: act2(
        { armR: [-0.5, 0, -0.3], foreR: [-1.5, 0, 0], handR: [0.3, 0, 0], armL: [-1.6, 0, 0.6], foreL: [-0.5, 0, 0], handL: [-0.8, 0, 0], chest: [-0.2, -0.25, 0], head: [-0.1, 0.2, 0] },
        { armR: [-1.45, 0, 0.15], foreR: [-0.3, 0, 0], handR: [-0.8, 0, 0], armL: [-0.5, 0, 0.5], foreL: [-0.8, 0, 0], chest: [0.15, 0.2, 0], spine: [0.08, 0, 0], head: [0, -0.15, 0] },
        { hit: 0.3, recover: 0.85, recoverAmt: 0.3 },
      ),
      beam: act2(
        { armR: [-0.9, 0, -0.2], foreR: [-1.2, 0, 0], handR: [-0.3, 0, 0], armL: [-0.9, 0, 0.2], foreL: [-1.2, 0, 0], chest: [-0.25, 0, 0], head: [0.1, 0, 0] },
        { armR: [-1.5, 0, 0.15], foreR: [-0.15, 0, 0], handR: [-1.2, 0, 0], armL: [-1.5, 0, -0.25], foreL: [-0.1, 0, 0], chest: [0.12, 0, 0], spine: [0.06, 0, 0] },
        { hit: 0.2, recover: 0.92, recoverAmt: 0.2, strikeExtra: (P, p, m) => { P.r('armR', Math.sin(m.time * 41) * 0.012); P.r('armL', Math.sin(m.time * 37) * 0.012); } },
      ),
    },
    extra: (P, m, s, dt, k) => {
      const T = m.time, act = k.action;
      const fast = act ? (s.attackType === 'spin' && s.anim === 'attack' ? 6 : 2.2) : 1;
      m.state.rot = (m.state.rot ?? 0) + dt * fast;
      const r = m.state.rot;
      P.r('halo0', 0.2 + Math.sin(T * 0.7) * 0.1, r * 0.9, 0.1); P.r('halo1', -0.25, -r * 1.3, Math.sin(T * 0.5) * 0.2); P.r('halo2', 0.1, r * 1.8, -0.2);
      P.p('halo0', 0, Math.sin(T * 1.3) * 0.015, 0); P.p('halo1', 0, Math.sin(T * 1.1 + 1) * 0.015, 0);
      P.r('circleA', 0, 0, r * 0.5); P.r('circleB', 0, 0, -r * 0.8);
      const big = act ? 1.25 : 1;
      P.s('circleA', big); P.s('circleB', big);
      if (s.anim === 'death') { const d = 1 - s.progress; P.s('circleA', Math.max(0.01, d)); P.s('circleB', Math.max(0.01, d)); }
    },
  },
};

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
