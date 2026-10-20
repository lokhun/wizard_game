import * as THREE from 'three';
import { G, xf, taper, lathe, shell, tube, deform, bumpy, robe, panel, mergeRaw, chainSkin, spikeRing, rng, clamp, lerp, smooth, bump, easeOut, easeInOut, TAU } from './core.js';
import { humanSkeleton, humanoidPose, act2, ACT } from './humanoid.js';
import {
  addSkull, addSkeletonBody, addFleshBody, addFleshHand, addBoneHand, addPlate, addTabard, greatHelm, hood, addWing, wingBones, flapWings, addHalberd, addCrystalStaff, addTowerShield, bookGeo,
  pauldron, rivets, HDR, STEEL, RUSTY, DARKSTEEL, BLACKSTEEL, GOLDTRIM,
} from './parts.js';

// --------------------------------------------------------- animatedArmor ----
const VIOLET = 0xa45cff;
const GAPS = { head: [0, 0.06, 0.01], armL: [0.05, 0.01, 0], armR: [-0.05, 0.01, 0], foreL: [0, -0.045, 0], foreR: [0, -0.045, 0], handL: [0, -0.04, 0], handR: [0, -0.04, 0], chest: [0, 0.05, 0], shinL: [0, -0.04, 0], shinR: [0, -0.04, 0], thighL: [0.015, -0.03, 0], thighR: [-0.015, -0.03, 0], hips: [0, 0.11, 0] };
export const animatedArmor = {
  id: 'animatedArmor', height: 2.15, radius: 0.5, eyeColor: VIOLET, defaultAttack: 'thrust', attackTypes: ['thrust', 'sweep', 'slam'],
  build(rig) {
    const D = humanSkeleton(rig, { thigh: 0.48, shin: 0.47, spine: 0.17, chest: 0.34, neck: 0.08, shoulderW: 0.22, upper: 0.32, fore: 0.3 });
    const AC = [0.62, 0.6, 0.66];
    addPlate(rig, D, { mat: 'steel', c: AC, bulk: 1.05, pauldron: 0.13, trim: true, trimMat: 'iron', trimC: [0.9, 0.75, 1.1], mail: false });
    // hollow insides glow violet
    const core = HDR(VIOLET, 3.5), haze = HDR(VIOLET, 0.35);
    rig.add('chest', 'dark', xf(G.cyl(0.17, 0.15, 0.36, 10, true), { y: 0.12, sz: 0.75 }), {}, {});
    rig.add('chest', 'spirit', G.sph(0.16, 10, 8), { y: 0.18, sz: 0.7 }, { c: haze });
    rig.add('chest', 'glow', G.ico(0.045, 1), { y: 0.2, z: 0.02 }, { c: core });
    for (const [b, y, r] of [['armL', 0, 0.05], ['armR', 0, 0.05], ['foreL', 0.02, 0.035], ['foreR', 0.02, 0.035], ['handL', 0.02, 0.03], ['handR', 0.02, 0.03], ['thighL', 0.02, 0.06], ['thighR', 0.02, 0.06], ['shinL', 0.02, 0.045], ['shinR', 0.02, 0.045], ['neck', 0.0, 0.05], ['hips', 0.06, 0.09]]) {
      rig.add(b, 'spirit', G.sph(r * 1.5, 8, 6), { y }, { c: haze });
      rig.add(b, 'glow', G.sph(r * 0.45, 6, 5), { y }, { c: HDR(VIOLET, 2.2) });
    }
    // helm with violet visor glow and wisps leaking from the top
    rig.add('head', 'steel', greatHelm({ r: 0.13, h: 0.3 }), { y: -0.02 }, { c: AC });
    rig.add('head', 'iron', mergeRaw([xf(G.tor(0.135, 0.01, 4, 18), { rx: Math.PI / 2, y: 0.02, sy: 1.08 }), xf(G.box(0.014, 0.28, 0.03), { y: 0.13, z: 0.135 }), xf(G.cone(0.02, 0.1, 4), { y: 0.32 })]), {}, { c: [0.9, 0.75, 1.1] });
    rig.add('head', 'dark', G.box(0.11, 0.022, 0.03), { y: 0.15, z: 0.13 });
    rig.add('head', 'glow', G.box(0.1, 0.012, 0.012), { y: 0.15, z: 0.14 }, { c: HDR(VIOLET, 6) });
    rig.add('head', 'spirit', mergeRaw([0, 1, 2].map((i) => tube([[(i - 1) * 0.04, 0.27, 0], [(i - 1) * 0.06, 0.38, -0.04], [(i - 1) * 0.05, 0.5, -0.1]], (u) => 0.025 * (1 - u), 8, 5))), {}, { c: HDR(VIOLET, 0.5), anim: (v) => clamp((v.y - 0.27) * 5) });
    addHalberd(rig, 'handR', { len: 2.3, grip: 0.38, metalC: [1.6, 1.55, 1.7], glow: HDR(VIOLET, 3) });
    rig.socket('muzzle', 'handR', 0, -0.07, 1.4);
    return D;
  },
  pose: humanoidPose,
  anim: {
    death: 'apart', armSwing: 0.25, gait: 'plod', stride: 0.5, knee: 0.7, breath: 0.9,
    spawn: (P, p, m, s) => {
      // pieces drift in from all sides and lock together
      const k = 1 - easeOut(p);
      const sd = m.seed > 0.5 ? 1 : -1;
      P.p('head', 0.2 * k * sd, 0.5 * k, 0.1 * k); P.r('head', 1.5 * k, 2 * k, 0);
      P.p('armL', 0.35 * k, 0.2 * k, 0); P.p('armR', -0.35 * k, 0.15 * k, 0.1 * k); P.r('armL', 0, 0, 1.4 * k); P.r('armR', 0, 0, -1.4 * k);
      P.p('chest', 0, 0.25 * k, -0.15 * k); P.p('foreL', 0, -0.2 * k, 0.1 * k); P.p('foreR', 0, -0.2 * k, 0);
      P.p('hips', 0, -0.4 * k, 0); P.r('hips', 0.6 * k, 0, 0);
      m.setOpacity(smooth(0, 0.4, p));
      return 10;
    },
    rest: { armR: [-0.35, 0, 0.1], foreR: [-0.9, 0, 0], handR: [0.4, 0, 0], armL: [-0.2, 0, 0.12], foreL: [-0.5, 0, 0] },
    stance: (P, m, s) => {
      if (s.anim === 'death' || s.anim === 'spawn') return;
      let i = 0;
      for (const k in GAPS) { const g = GAPS[k], b = 1 + Math.sin(m.time * 2.1 + i * 1.3) * 0.3; P.p(k, g[0] * b, g[1] * b, g[2] * b); i++; }
      P.p('base', 0, -0.0, 0);
    },
    actions: {
      thrust: act2(
        { armR: [0.4, 0, -0.3], foreR: [-1.5, 0, 0], handR: [0.3, 0, 0], armL: [-0.9, 0, 0.1], foreL: [-1.2, 0, 0], chest: [-0.05, -0.6, 0], spine: [0, -0.2, 0], head: [0, 0.7, 0], hips: [0, 0, 0, 0, -0.06, -0.1], thighL: [-0.4, 0, 0], shinL: [0.6, 0, 0] },
        { armR: [-1.4, 0, 0.15], foreR: [-0.1, 0, 0], handR: [0.05, 0, 0], armL: [-1.2, 0, -0.3], foreL: [-0.5, 0, 0], chest: [0.15, 0.4, 0], spine: [0.15, 0.1, 0], head: [-0.1, -0.5, 0], hips: [0, 0, 0, 0, -0.12, 0.3], thighR: [-0.7, 0, 0], shinR: [0.5, 0, 0], thighL: [0.4, 0, 0] },
        { hit: 0.22 },
      ),
    },
    extra: (P, m) => { m.U.uFlutterSpeed.value = 2.0; },
  },
};

// --------------------------------------------------------------- grimoire ----
const RUNE = 0xc07aff;
export const grimoire = {
  id: 'grimoire', height: 1.45, radius: 0.35, flying: true, eyeColor: 0xff5af0, magicColor: RUNE, defaultAttack: 'bite', attackTypes: ['bite', 'cast'], orbSize: 0.06,
  build(rig) {
    rig.bone('base', null);
    rig.bone('book', 'base', 0, 1.15, 0);
    rig.bone('spine', 'book', 0, 0, -0.17);
    rig.bone('upper', 'spine', 0, 0.01, 0);
    rig.bone('lower', 'spine', 0, -0.01, 0);
    rig.bone('pageA', 'spine', 0, 0, 0); rig.bone('pageB', 'spine', 0, 0, 0);
    rig.bone('runes', 'book', 0, 0, 0);
    const W = 0.46, Dp = 0.36;
    const LEATHER = [0.45, 0.12, 0.14], PAGE = [0.95, 0.85, 0.62];
    for (const [b, sg] of [['upper', 1], ['lower', -1]]) {
      const cv = G.box(W + 0.04, 0.026, Dp + 0.02, 4, 1, 4);
      deform(cv, (v) => { v.y += sg * (1 - (v.x / (W / 2)) ** 2) * 0.01; });
      rig.add(b, 'leather', cv, { y: sg * 0.035, z: Dp / 2 }, { c: LEATHER });
      rig.add(b, 'bone', G.box(W, 0.045, Dp - 0.02, 4, 2, 2), { y: sg * 0.005, z: Dp / 2 - 0.005 }, { c: PAGE, cfn: (v) => { const k = 0.85 + 0.15 * Math.sin(v.y * 600); return [PAGE[0] * k, PAGE[1] * k, PAGE[2] * k]; } });
      // corner guards + raised bands
      rig.add(b, 'gold', mergeRaw([[-1, 1], [1, 1]].map(([x]) => xf(G.box(0.07, 0.034, 0.07), { x: x * (W / 2 - 0.015), z: Dp - 0.015 })).concat([xf(G.box(W + 0.05, 0.034, 0.03), { z: 0.02 })])), { y: sg * 0.035 }, { c: GOLDTRIM });
      // teeth along the fore edge and sides
      const teeth = [];
      for (let i = 0; i < 11; i++) teeth.push(xf(G.cone(0.014, 0.05 + (i % 2) * 0.02, 4), { x: (i / 10 - 0.5) * (W - 0.04), z: Dp - 0.025, y: -sg * 0.03, rx: sg > 0 ? Math.PI : 0 }));
      for (const x of [-1, 1]) for (let i = 0; i < 4; i++) teeth.push(xf(G.cone(0.011, 0.04, 4), { x: x * (W / 2 - 0.02), z: 0.12 + i * 0.055, y: -sg * 0.03, rx: sg > 0 ? Math.PI : 0 }));
      rig.add(b, 'bone', mergeRaw(teeth), {}, { c: [0.92, 0.88, 0.75] });
    }
    // cover eye + runes
    rig.add('upper', 'gold', xf(G.tor(0.07, 0.012, 5, 20), { rx: Math.PI / 2 }), { y: 0.05, z: Dp / 2 + 0.01 }, { c: GOLDTRIM });
    rig.add('upper', 'bone', xf(G.sph(0.06, 12, 8), { sy: 0.5 }), { y: 0.05, z: Dp / 2 + 0.01 }, { c: [0.95, 0.9, 0.8] });
    rig.add('upper', 'glow', xf(G.sph(0.03, 10, 8), { sy: 0.45 }), { y: 0.075, z: Dp / 2 + 0.015 }, { c: HDR(0xff5af0, 4) });
    rig.add('upper', 'dark', xf(G.box(0.012, 0.01, 0.04), {}), { y: 0.088, z: Dp / 2 + 0.015 });
    const glyphs = [];
    for (let i = 0; i < 10; i++) { const a = (i / 10) * TAU; glyphs.push(xf(G.box(0.02, 0.006, 0.006 + (i % 3) * 0.008), { x: Math.cos(a) * 0.12, z: Math.sin(a) * 0.12, ry: -a })); }
    rig.add('upper', 'glow', mergeRaw(glyphs), { y: 0.05, z: Dp / 2 + 0.01 }, { c: HDR(RUNE, 3) });
    // spine with ridges, ribbons
    rig.add('spine', 'leather', xf(G.cyl(0.05, 0.05, W + 0.04, 10, false, 1), { rz: Math.PI / 2, sz: 0.8 }), {}, { c: LEATHER });
    rig.add('spine', 'gold', mergeRaw([-0.15, 0, 0.15].map((x) => xf(G.tor(0.052, 0.008, 4, 12), { x, ry: Math.PI / 2, sx: 1 }))), {}, { c: GOLDTRIM });
    rig.add('spine', 'cloth', mergeRaw([tube([[0.1, -0.03, 0.0], [0.11, -0.15, -0.03], [0.1, -0.32, 0.0]], 0.012, 8, 3), tube([[-0.06, -0.03, 0.0], [-0.07, -0.12, -0.03], [-0.05, -0.26, 0.02]], 0.012, 8, 3)]), { sz: 0.4 }, { c: [0.6, 0.05, 0.1], anim: (v) => clamp(-v.y * 3) * 1.5 });
    // loose pages that flutter inside the mouth
    rig.add('pageA', 'bone', G.box(W - 0.06, 0.004, Dp - 0.04), { z: Dp / 2 }, { c: PAGE });
    rig.add('pageB', 'bone', G.box(W - 0.06, 0.004, Dp - 0.04), { z: Dp / 2 }, { c: PAGE });
    rig.add('spine', 'spirit', xf(G.box(W - 0.05, 0.004, Dp - 0.05), {}), { z: Dp / 2 }, { c: HDR(RUNE, 0.7) });
    // orbiting rune glyphs
    const ring = [];
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * TAU, at = { x: Math.cos(a) * 0.42, z: Math.sin(a) * 0.42, ry: -a + Math.PI / 2 };
      ring.push(xf(G.box(0.008, 0.07, 0.003), { ...at }), xf(G.box(0.04, 0.008, 0.003), { ...at, y: 0.02 + (i % 3) * 0.012 }), xf(G.box(0.006, 0.03, 0.003), { ...at, x: at.x + Math.sin(a) * 0.015, z: at.z - Math.cos(a) * 0.015, y: -0.025, rz: 0.6 }));
    }
    rig.add('runes', 'spirit', mergeRaw(ring), {}, { c: HDR(RUNE, 1.1) });
    rig.socket('muzzle', 'book', 0, 0, 0.18);
    return {};
  },
  pose(m, s, P, dt) {
    const T = m.time, st = m.state, anim = s.anim, p = s.progress;
    const spd = s.speed ?? 0;
    const mw = smooth(0.05, 0.6, spd);
    st.moveW = (st.moveW ?? 0) + (mw - (st.moveW ?? 0)) * (1 - Math.exp(-6 * dt));
    const w = st.moveW;
    let rate = 12;
    const bob = Math.sin(T * 1.7) * 0.06;
    let open = 0.25 + 0.12 * Math.sin(T * 3.2) + w * (0.2 + 0.25 * Math.sin(T * 9));
    P.p('base', 0, bob, 0);
    P.r('book', Math.sin(T * 1.1) * 0.08 + 0.25 * w, Math.sin(T * 0.6) * 0.25, Math.sin(T * 0.8) * 0.1);
    P.r('runes', 0, T * 0.8, 0);
    P.r('pageA', -Math.max(0, Math.sin(T * 4)) * open * 0.6); P.r('pageB', Math.max(0, Math.sin(T * 4 + 2)) * open * 0.4);
    let runeS = 0.85;
    if (anim === 'windup') {
      open = lerp(open, 1.15, smooth(0, 0.5, p)) + Math.sin(T * 30) * 0.04;
      P.p('book', 0, 0.08 * p, -0.18 * p); P.r('book', -0.35 * p);
      m.setOrb(s.attackType === 'cast' ? 0.3 + 0.6 * p : 0);
      runeS = 1 + 0.3 * p; rate = 10;
    } else if (anim === 'attack' || anim === 'cast') {
      if (s.attackType === 'cast' || anim === 'cast') {
        open = 1.0; runeS = 1.3; P.r('runes', 0, T * 3, 0);
        P.r('pageA', -1.0 - Math.sin(T * 20) * 0.6); P.r('pageB', 0.7 + Math.sin(T * 23) * 0.5);
        m.setOrb(anim === 'cast' ? 0.8 + 0.2 * Math.sin(T * 10) : 1 - smooth(0, 0.3, p));
      } else {
        const lunge = bump(0, 0.7, p), snap = smooth(0.18, 0.3, p);
        P.p('book', 0, -0.05 * lunge, 0.7 * lunge); P.r('book', 0.35 * lunge);
        open = lerp(1.15, 0.0, snap) + smooth(0.6, 1, p) * 0.3;
      }
      rate = 26;
    } else if (anim === 'stagger') {
      const k = s.t < 0.06 ? s.t / 0.06 : Math.exp(-(s.t - 0.06) * 5);
      P.r('book', -0.7 * k, 0.3 * k, 0.5 * k); P.p('book', 0, 0.05 * k, -0.15 * k); open += 0.5 * k; rate = 28;
    } else if (anim === 'death') {
      const fall = easeOut(smooth(0, 0.6, p));
      P.p('book', 0, -1.1 * fall + bump(0.55, 0.75, p) * 0.06, 0);
      P.p('base', 0, -bob * fall, 0);
      P.r('book', 0.0, 0.6 * p, (m.seed > 0.5 ? 1 : -1) * 0.12 * fall);
      open = lerp(0.6, 0.0, smooth(0.2, 0.7, p));
      runeS = 1 - smooth(0, 0.5, p);
      P.p('pageA', 0.3 * p, 0.5 * p - 1.0 * smooth(0.5, 1, p) * 0.4, 0.4 * p); P.r('pageA', -2 * p, 2 * p, 1 * p);
      P.p('pageB', -0.35 * p, 0.3 * p, 0.2 * p); P.r('pageB', 1.5 * p, -1 * p, 2 * p);
      rate = 10;
    } else if (anim === 'spawn') {
      const e = easeOut(p);
      P.s('book', lerp(0.05, 1, e)); P.r('book', 0, (1 - e) * 6, 0); open = 0.9 * e * (1 - smooth(0.8, 1, p) * 0.6);
      m.setOpacity(smooth(0, 0.5, p)); runeS = e; rate = 16;
    }
    P.r('upper', -open); P.r('lower', open * 0.55);
    P.s('runes', Math.max(0.001, runeS));
    return rate;
  },
};

// ---------------------------------------------------------- courtSorcerer ----
const ARCANE = 0x6a8cff;
export const courtSorcerer = {
  id: 'courtSorcerer', height: 2.05, radius: 0.42, flying: true, eyeColor: 0x9ad0ff, magicColor: ARCANE, defaultAttack: 'cast', attackTypes: ['cast', 'beam', 'summon'], orbSize: 0.08, flutter: 0.035,
  build(rig) {
    const D = humanSkeleton(rig, { thigh: 0.44, shin: 0.43, spine: 0.16, chest: 0.31, neck: 0.09, shoulderW: 0.19, upper: 0.3, fore: 0.28 });
    const BLUE = [0.1, 0.1, 0.3], INNER = [0.35, 0.3, 0.22];
    // inner robe + split outer robe falling to the floor
    rig.add('hips', 'cloth', robe(0.18, 0.3, D.hipH + 0.06, { seg: 20, rows: 6, folds: 7, foldAmp: 0.05, tatter: 0.05, seed: 3 }), { y: 0.04 }, { c: INNER, anim: (v) => clamp(-v.y / 1.0) });
    const outer = new THREE.CylinderGeometry(0.2, 0.36, D.hipH + 0.1, 22, 6, true, 0.45, TAU - 0.9);
    xf(outer, { y: -(D.hipH + 0.1) / 2 });
    deform(outer, (v) => { const a = Math.atan2(v.x, v.z); const r = Math.hypot(v.x, v.z); const k = 1 + Math.sin(a * 7) * 0.05 * (-v.y); v.x *= k; v.z *= k; void r; });
    rig.add('hips', 'cloth', outer, { y: 0.1 }, { c: BLUE, anim: (v) => clamp(-v.y / 1.0) * 1.2, cfn: (v) => (v.y < -(D.hipH - 0.05) ? GOLDTRIM : BLUE) });
    rig.add('chest', 'cloth', lathe([[0.16, -0.08], [0.2, 0.12], [0.22, 0.24], [0.14, 0.32], [0.07, 0.34]], 14), { sz: 0.82 }, { c: BLUE });
    rig.add('hips', 'gold', xf(G.tor(0.19, 0.022, 5, 18), { rx: Math.PI / 2, sz: 0.8 }), { y: 0.1 }, { c: GOLDTRIM });
    rig.add('hips', 'gold', mergeRaw([xf(G.box(0.07, 0.07, 0.02), { z: 0.16, y: 0.1 }), xf(G.box(0.05, 0.5, 0.01), { z: 0.17, y: -0.18 })]), {}, { c: GOLDTRIM });
    // mantle + very high flared collar
    rig.add('chest', 'cloth', robe(0.12, 0.3, 0.25, { seg: 16, rows: 2, folds: 6, foldAmp: 0.06, tatter: 0.0, seed: 6 }), { y: D.chest + 0.06, sz: 0.85 }, { c: [0.16, 0.12, 0.38], cfn: (v) => (v.y < -0.21 ? GOLDTRIM : [0.16, 0.12, 0.38]) });
    const collar = new THREE.CylinderGeometry(0.2, 0.1, 0.32, 16, 2, true, Math.PI * 0.62, Math.PI * 0.76);
    xf(collar, { y: 0.16 });
    rig.add('chest', 'cloth', twoSidedCollar(collar), { y: D.chest + 0.02, z: -0.02 }, { c: [0.14, 0.1, 0.32] });
    rig.add('chest', 'gold', xf(new THREE.TorusGeometry(0.2, 0.01, 4, 16, Math.PI * 0.76), { rx: Math.PI / 2, rz: -Math.PI * 0.88 }), { y: D.chest + 0.34, z: -0.02 }, { c: GOLDTRIM });
    // head: hood + porcelain mask with glowing eye slits
    const h = hood(0.13, 0.12, { open: 0.3, peak: 0.6 });
    rig.add('head', 'cloth', h.shell, { y: 0.1, z: -0.01 }, { c: [0.08, 0.07, 0.2] });
    rig.add('head', 'dark', G.sph(0.105, 10, 8), { y: 0.1, z: -0.0 });
    const mask = new THREE.SphereGeometry(0.1, 14, 10, -Math.PI * 0.4, Math.PI * 0.8, Math.PI * 0.2, Math.PI * 0.62);
    rig.add('head', 'gold', deform(mask, (v) => { v.z *= 1.05; if (Math.abs(v.x) < 0.012 && v.y < 0.02) v.z += 0.012; }), { y: 0.1, z: 0.025, ry: Math.PI / 2 * 0 }, { c: [1.3, 1.25, 1.15] });
    rig.pair('head', 'head', 'dark', xf(G.box(0.04, 0.012, 0.02), { rz: 0.2 }), { x: 0.035, y: 0.115, z: 0.118 });
    rig.pair('head', 'head', 'glow', xf(G.box(0.03, 0.006, 0.01), { rz: 0.2 }), { x: 0.035, y: 0.115, z: 0.124 }, { c: HDR(0x9ad0ff, 6) });
    rig.add('head', 'gold', mergeRaw([xf(G.tor(0.11, 0.008, 4, 16), { rx: Math.PI / 2, y: 0.17, sz: 1.05 }), xf(G.oct(0.02), { y: 0.19, z: 0.11 })]), {}, { c: GOLDTRIM });
    // bell sleeves + gloved hands
    for (const S of ['L', 'R']) {
      const sx = S === 'L' ? 1 : -1;
      rig.add('arm' + S, 'cloth', robe(0.06, 0.08, D.upper + 0.02, { seg: 10, rows: 2, folds: 4, tatter: 0, seed: 2 }), { y: 0.02 }, { c: BLUE });
      rig.add('fore' + S, 'cloth', robe(0.07, 0.15, D.fore * 0.95, { seg: 14, rows: 2, folds: 5, foldAmp: 0.1, tatter: 0.0, seed: 5 + sx }), {}, { c: BLUE, anim: (v) => clamp(-v.y * 3) * 0.6, cfn: (v) => (v.y < -D.fore * 0.85 ? GOLDTRIM : BLUE) });
      addFleshHand(rig, 'hand' + S, sx, { mat: 'leather', c: [0.25, 0.18, 0.2], m: 0.85, grip: S === 'R' });
    }
    // chained tome at the hip
    rig.add('hips', 'leather', G.box(0.14, 0.18, 0.05), { x: 0.2, y: -0.12, z: 0.05, rz: 0.15 }, { c: [0.3, 0.1, 0.12] });
    const st = addCrystalStaff(rig, 'handR', { len: 1.95, color: ARCANE, k: 3.5 });
    rig.socket('muzzle', 'handR', 0, -0.07, st.tip);
    return D;
  },
  pose: humanoidPose,
  anim: {
    gait: 'float', hover: 0.12, death: 'fall', spawn: 'materialize', caster: true, idleOrb: 0.18, look: 0.7,
    rest: { armR: [-0.3, 0, -0.08], foreR: [-1.2, 0, 0], handR: [0.0, 0, 0], armL: [-0.25, 0, 0.1], foreL: [-0.9, 0.4, 0] },
    stance: (P) => P.apply({ spine: [-0.03, 0, 0], head: [0.05, 0, 0] }),
    actions: {
      cast: act2(
        { armR: [-0.5, 0, -0.3], foreR: [-1.5, 0, 0], handR: [0.3, 0, 0], armL: [-1.4, 0, 0.5], foreL: [-0.6, 0, 0], handL: [-0.6, 0, 0], chest: [-0.2, -0.25, 0], head: [-0.1, 0.2, 0] },
        { armR: [-1.45, 0, 0.15], foreR: [-0.3, 0, 0], handR: [-0.8, 0, 0], armL: [-0.4, 0, 0.5], foreL: [-0.8, 0, 0], chest: [0.15, 0.2, 0], spine: [0.08, 0, 0], head: [0, -0.15, 0] },
        { hit: 0.3, recover: 0.85, recoverAmt: 0.3 },
      ),
      beam: act2(
        { armR: [-0.9, 0, -0.2], foreR: [-1.2, 0, 0], handR: [-0.3, 0, 0], armL: [-0.9, 0, 0.2], foreL: [-1.2, 0, 0], chest: [-0.2, 0, 0], head: [0.1, 0, 0] },
        { armR: [-1.5, 0, 0.15], foreR: [-0.15, 0, 0], handR: [-1.2, 0, 0], armL: [-1.5, 0, -0.25], foreL: [-0.1, 0, 0], chest: [0.12, 0, 0], spine: [0.06, 0, 0] },
        { hit: 0.2, recover: 0.92, recoverAmt: 0.2, strikeExtra: (P, p, m) => { P.r('armR', Math.sin(m.time * 41) * 0.012); P.r('armL', Math.sin(m.time * 37) * 0.012); } },
      ),
    },
  },
};
function twoSidedCollar(g) {
  const ng = g.clone();
  const idx = ng.index.array;
  const n = idx.length;
  const all = new Uint32Array(n * 2);
  all.set(idx);
  for (let i = 0; i < n; i += 3) { all[n + i] = idx[i]; all[n + i + 1] = idx[i + 2]; all[n + i + 2] = idx[i + 1]; }
  ng.setIndex(new THREE.BufferAttribute(all, 1));
  return ng;
}

// -------------------------------------------------------------------- imp ----
const FIRE = 0xff7a1a;
export const imp = {
  id: 'imp', height: 1.5, radius: 0.35, flying: true, eyeColor: 0xffd23a, magicColor: FIRE, defaultAttack: 'cast', attackTypes: ['cast', 'claw'], crackColor: 0xff6a10, crackIntensity: 4, orbSize: 0.07,
  build(rig) {
    const D = humanSkeleton(rig, { thigh: 0.2, shin: 0.2, ankle: 0.05, hipW: 0.06, spine: 0.08, chest: 0.17, neck: 0.04, shoulderW: 0.11, shoulderDrop: 0.03, upper: 0.17, fore: 0.17, jaw: [0.0, 0.07] });
    wingBones(rig, 'chest', 0.05, D.chest * 0.85, -0.07, 0.6, 0.42);
    let prev = 'hips';
    for (let i = 0; i < 6; i++) { rig.bone('tail' + i, prev, 0, -0.01, i === 0 ? -0.06 : -0.075, { rate: 0.65 }); prev = 'tail' + i; }
    const SK = [1.25, 0.62, 0.5];
    addFleshBody(rig, D, { mat: 'magma', c: SK, muscle: 0.75, seed: 51, rough: 1.2, belly: 0.03, bellyY: 0.07, claws: 0.035, toeClaws: true, clawC: 0x1a1210 });
    // big head with grin, horns, ears
    const hd = deform(G.sph(0.1, 16, 12), (v) => { v.z *= 1.05; if (v.y < -0.02) { v.x *= 1.08; } if (v.z > 0.05 && v.y > 0.0) v.z += 0.01; });
    rig.add('head', 'magma', bumpy(hd, 0.006, 12, 3), { y: 0.09, z: 0.01 }, { c: SK });
    rig.add('head', 'magma', xf(G.box(0.15, 0.025, 0.05), { y: 0.14, z: 0.075, rx: 0.4 }), {}, { c: SK });
    rig.pair('head', 'head', 'bone', tube([[0.05, 0.15, 0.03], [0.1, 0.22, 0.0], [0.12, 0.3, -0.07], [0.1, 0.33, -0.15]], (u) => 0.024 * (1 - u * 0.85), 12, 6), {}, { c: [0.25, 0.18, 0.15] });
    rig.pair('head', 'head', 'magma', xf(G.cone(0.035, 0.13, 4), { sz: 0.3 }), { x: 0.1, y: 0.11, z: -0.0, rz: -1.25, ry: -0.25 }, { c: SK });
    rig.pair('head', 'head', 'dark', G.sph(0.022, 8, 6), { x: 0.04, y: 0.105, z: 0.085, sz: 0.6 });
    rig.pair('head', 'head', 'glow', xf(G.sph(0.016, 8, 6), { sx: 1.2, sy: 0.75 }), { x: 0.043, y: 0.107, z: 0.095, rz: -0.3 }, { c: HDR(0xffd23a, 7) });
    rig.add('head', 'glow', xf(G.box(0.1, 0.018, 0.03), {}), { y: 0.045, z: 0.085 }, { c: HDR(FIRE, 3) });
    rig.add('head', 'bone', mergeRaw(Array.from({ length: 10 }, (_, i) => { const a = (i / 9 - 0.5) * 2.2; return xf(G.cone(0.006, 0.022, 4), { x: Math.sin(a) * 0.05, y: 0.055, z: 0.06 + Math.cos(a) * 0.03, rx: Math.PI }); })), {}, { c: [0.95, 0.85, 0.6] });
    rig.add('jaw', 'magma', xf(G.box(0.1, 0.025, 0.07), { y: 0.03, z: 0.04 }), {}, { c: SK });
    rig.add('jaw', 'bone', mergeRaw(Array.from({ length: 8 }, (_, i) => { const a = (i / 7 - 0.5) * 2.0; return xf(G.cone(0.006, 0.02, 4), { x: Math.sin(a) * 0.045, y: 0.05, z: 0.04 + Math.cos(a) * 0.03 }); })), {}, { c: [0.95, 0.85, 0.6] });
    // wings + spade tail
    addWing(rig, 1, { span: 0.6, mat: 'leather', c: [0.5, 0.12, 0.08], boneC: [0.3, 0.1, 0.08], claw: true, fingers: 3 });
    addWing(rig, -1, { span: 0.6, mat: 'leather', c: [0.5, 0.12, 0.08], boneC: [0.3, 0.1, 0.08], claw: true, fingers: 3 });
    const pts = []; for (let i = 0; i <= 6; i++) pts.push([0, -0.01 - i * 0.01, -0.05 - i * 0.075]);
    const chain = [['hips', 0.04], ...Array.from({ length: 6 }, (_, i) => ['tail' + i, 0.06 + i * 0.075])];
    rig.add('hips', 'magma', tube(pts, (u) => 0.025 * (1 - u * 0.7), 24, 6), {}, { c: SK, skin: chainSkin(chain, (v) => -v.z) });
    rig.add('tail5', 'magma', xf(G.cone(0.045, 0.1, 4), { z: -0.08, rx: -Math.PI / 2, sy: 0.3 }), {}, { c: SK });
    // loincloth scrap
    rig.add('hips', 'cloth', panel(0.12, 0.12, { tatter: 0.4, seed: 4 }), { y: -0.02, z: 0.075 }, { c: [0.15, 0.08, 0.06], anim: (v) => -v.y * 2 });
    rig.socket('muzzle', 'handR', 0, -0.1, 0.04);
    return D;
  },
  pose: humanoidPose,
  anim: {
    gait: 'float', hover: 0.85, death: 'dissipate', spawn: 'materialize', caster: true, look: 1.2, breath: 2.6,
    stance: (P) => P.apply({ thighL: [-0.7, 0, 0.2], thighR: [-0.4, 0, -0.2], shinL: [1.3, 0, 0], shinR: [1.0, 0, 0], spine: [0.15, 0, 0], neck: [-0.1, 0, 0], armL: [-0.4, 0, 0.2], armR: [-0.3, 0, -0.2], foreL: [-1.0, 0, 0], foreR: [-0.9, 0, 0] }),
    actions: {
      cast: act2(
        { armR: [-2.6, 0, -0.3], foreR: [-0.9, 0, 0], handR: [-0.5, 0, 0], armL: [-0.8, 0, 0.5], foreL: [-1.0, 0, 0], chest: [-0.3, -0.4, 0], head: [-0.1, 0.3, 0], jaw: [0.5, 0, 0] },
        { armR: [-1.3, 0, 0.2], foreR: [-0.1, 0, 0], handR: [-0.4, 0, 0], armL: [-0.2, 0, 0.6], foreL: [-0.6, 0, 0], chest: [0.3, 0.35, 0], spine: [0.15, 0, 0], head: [-0.1, -0.2, 0], jaw: [0.3, 0, 0] },
        { hit: 0.25, recover: 0.8 },
      ),
    },
    extra: (P, m, s, dt, k) => {
      const dead = s.anim === 'death';
      m.state.flap = (m.state.flap ?? 0) + dt * (dead ? 4 : 16 + k.w * 4);
      flapWings(P, m.state.flap, dead ? 0.3 : 0.7, 0.2, 0);
      P.p('base', 0, Math.sin(m.state.flap) * 0.04, 0);
      for (let i = 0; i < 6; i++) P.r('tail' + i, 0.35 - i * 0.05 + Math.sin(m.time * 3 - i * 0.7) * 0.15, Math.sin(m.time * 2.1 - i * 0.6) * 0.25, 0);
      if (!k.action) P.r('jaw', 0.2 + Math.sin(m.time * 4) * 0.08);
      if (!k.action && !dead) m.setOrb(0.25 + Math.sin(m.time * 5) * 0.05);
    },
  },
};

// ---------------------------------------------------------- archivistLich ----
const SOUL = 0x5aff8a;
export const archivistLich = {
  id: 'archivistLich', height: 2.55, radius: 0.55, flying: true, elite: true, eyeColor: SOUL, magicColor: SOUL, defaultAttack: 'cast', attackTypes: ['cast', 'summon', 'beam'], orbSize: 0.09, flutter: 0.035,
  build(rig) {
    const D = humanSkeleton(rig, { thigh: 0.5, shin: 0.48, spine: 0.2, chest: 0.36, neck: 0.1, shoulderW: 0.23, upper: 0.34, fore: 0.32, jaw: [0.045, 0.03] });
    rig.bone('orbit', 'base', 0, 1.35, 0);
    for (let i = 0; i < 3; i++) rig.bone('bk' + i, 'orbit', Math.cos(i / 3 * TAU) * 0.75, 0, Math.sin(i / 3 * TAU) * 0.75);
    const ROBE = [0.06, 0.12, 0.08], RICH = [0.2, 0.05, 0.05];
    // layered robes
    rig.add('hips', 'cloth', robe(0.2, 0.36, D.hipH + 0.05, { seg: 22, rows: 6, folds: 8, foldAmp: 0.06, tatter: 0.15, seed: 4 }), { y: 0.04 }, { c: ROBE, anim: (v) => clamp(-v.y / 1.0) * 1.1, cfn: (v) => (Math.abs(v.y + D.hipH * 0.95) < 0.03 ? GOLDTRIM : ROBE) });
    const coat = new THREE.CylinderGeometry(0.22, 0.42, D.hipH + 0.15, 24, 6, true, 0.35, TAU - 0.7);
    xf(coat, { y: -(D.hipH + 0.15) / 2 });
    rig.add('hips', 'cloth', coat, { y: 0.12 }, { c: RICH, anim: (v) => clamp(-v.y / 1.1) * 1.3, cfn: (v) => { const a = Math.atan2(v.x, v.z); return (Math.abs(Math.abs(a) - 0.35) < 0.06 || v.y < -(D.hipH + 0.05)) ? GOLDTRIM : RICH; } });
    rig.add('chest', 'cloth', lathe([[0.17, -0.08], [0.22, 0.14], [0.24, 0.27], [0.15, 0.36], [0.07, 0.38]], 14), { sz: 0.8 }, { c: RICH });
    rig.add('chest', 'gold', mergeRaw([xf(G.box(0.05, 0.35, 0.012), { x: 0.06, y: 0.16, z: 0.19, rz: -0.15 }), xf(G.box(0.05, 0.35, 0.012), { x: -0.06, y: 0.16, z: 0.19, rz: 0.15 }), xf(G.oct(0.035), { y: 0.3, z: 0.2 })]), {}, { c: GOLDTRIM });
    rig.add('chest', 'glow', G.oct(0.02), { y: 0.3, z: 0.225 }, { c: HDR(SOUL, 4) });
    // fur-trimmed mantle + tall collar
    rig.add('chest', 'fur', bumpy(xf(G.tor(0.2, 0.06, 8, 20), { rx: Math.PI / 2, sz: 0.8 }), 0.015, 14, 3), { y: D.chest + 0.02 }, { c: [0.7, 0.68, 0.62] });
    rig.add('chest', 'cloth', robe(0.16, 0.36, 0.32, { seg: 18, rows: 2, folds: 6, foldAmp: 0.06, tatter: 0.25, seed: 7 }), { y: D.chest + 0.02, sz: 0.85 }, { c: RICH, anim: (v) => clamp(-v.y * 2.5) * 0.5 });
    const collar = new THREE.CylinderGeometry(0.22, 0.12, 0.36, 16, 2, true, Math.PI * 0.6, Math.PI * 0.8);
    xf(collar, { y: 0.18 });
    rig.add('chest', 'cloth', twoSidedCollar(collar), { y: D.chest + 0.03, z: -0.03 }, { c: [0.12, 0.25, 0.15] });
    // skull with soul-fire eyes and crown
    addSkull(rig, 'head', 'jaw', { eye: SOUL, eyeK: 8, c: [0.75, 0.72, 0.6], s: 1.15 });
    rig.pair('head', 'head', 'spirit', tube([[0.04, 0.12, 0.09], [0.05, 0.18, 0.06], [0.03, 0.28, 0.02]], (u) => 0.022 * (1 - u), 8, 5), {}, { c: HDR(SOUL, 0.9), anim: 1 });
    rig.add('head', 'gold', mergeRaw([xf(G.cyl(0.115, 0.11, 0.05, 16, true), { y: 0.215 }), spikeRing(0.115, 8, 0.11, 0.022, 0.24, 0.12)]), { sz: 1.08 }, { c: GOLDTRIM });
    rig.add('head', 'glow', mergeRaw([0, 2, 4, 6].map((i) => xf(G.oct(0.014), { x: Math.sin(i / 8 * TAU) * 0.12, z: Math.cos(i / 8 * TAU) * 0.12 * 1.08, y: 0.22 }))), {}, { c: HDR(SOUL, 3) });
    // sleeves + skeletal hands
    for (const S of ['L', 'R']) {
      const sx = S === 'L' ? 1 : -1;
      rig.add('arm' + S, 'cloth', robe(0.07, 0.09, D.upper + 0.02, { seg: 10, rows: 2, folds: 4, tatter: 0, seed: 2 }), { y: 0.02 }, { c: RICH });
      rig.add('fore' + S, 'cloth', robe(0.08, 0.16, D.fore * 0.9, { seg: 14, rows: 2, folds: 5, foldAmp: 0.12, tatter: 0.3, seed: 5 + sx }), {}, { c: RICH, anim: (v) => clamp(-v.y * 3) * 0.6 });
      addBoneHand(rig, 'hand' + S, sx, { mat: 'bone', c: [0.75, 0.72, 0.6], s: 1.4, grip: S === 'R' });
    }
    // belt with hanging scroll cases and keys
    rig.add('hips', 'leather', xf(G.tor(0.2, 0.018, 4, 18), { rx: Math.PI / 2, sz: 0.8 }), { y: 0.1 }, { c: [0.25, 0.15, 0.1] });
    rig.add('hips', 'bone', mergeRaw([xf(G.cyl(0.025, 0.025, 0.2, 8), { x: 0.17, y: -0.02, z: 0.08, rz: 0.15 }), xf(G.cyl(0.02, 0.02, 0.16, 8), { x: -0.16, y: 0.0, z: 0.1, rz: -0.2 })]), {}, { c: [0.9, 0.82, 0.62] });
    // orbiting tomes
    const bk = bookGeo(0.24, 0.18, 0.05);
    const colors = [[0.35, 0.08, 0.1], [0.08, 0.2, 0.12], [0.12, 0.1, 0.3]];
    for (let i = 0; i < 3; i++) {
      rig.add('bk' + i, 'leather', bk.cover, { rx: -0.3, z: -0.09 }, { c: colors[i] });
      rig.add('bk' + i, 'leather', bk.cover, { rx: 0.3 + Math.PI, z: 0.09, y: 0.0 }, { c: colors[i] });
      rig.add('bk' + i, 'bone', bk.pages, { rx: -0.3, z: -0.09 }, { c: [0.95, 0.88, 0.7] });
      rig.add('bk' + i, 'glow', xf(G.box(0.12, 0.004, 0.08), {}), { y: 0.06, z: -0.0 }, { c: HDR(SOUL, 1.5) });
    }
    const st = addCrystalStaff(rig, 'handR', { len: 2.1, color: SOUL, k: 3.5, shaftMat: 'bone', shaftC: [0.7, 0.66, 0.55], crystalR: 0.06 });
    rig.add('handR', 'bone', xf(skullMini(), {}), { y: -0.07, z: st.tip - 0.3, rx: -Math.PI / 2 }, { c: [0.85, 0.8, 0.68] });
    rig.socket('muzzle', 'handR', 0, -0.07, st.tip);
    return D;
  },
  pose: humanoidPose,
  anim: {
    gait: 'float', hover: 0.12, death: 'dissipate', spawn: 'materialize', caster: true, idleOrb: 0.2, look: 0.6, breath: 0.9,
    rest: { armR: [-0.3, 0, -0.08], foreR: [-1.2, 0, 0], handR: [0.0, 0, 0], armL: [-0.4, 0, 0.15], foreL: [-1.1, 0.5, 0], handL: [-0.3, 0, 0] },
    stance: (P) => P.apply({ spine: [0.08, 0, 0], neck: [0.05, 0, 0], head: [0.05, 0, 0] }),
    actions: {
      cast: act2(
        { armR: [-0.5, 0, -0.3], foreR: [-1.5, 0, 0], handR: [0.3, 0, 0], armL: [-1.6, 0, 0.6], foreL: [-0.4, 0, 0], handL: [-0.8, 0, 0], chest: [-0.2, -0.25, 0], head: [-0.15, 0.2, 0], jaw: [0.4, 0, 0] },
        { armR: [-1.45, 0, 0.15], foreR: [-0.3, 0, 0], handR: [-0.8, 0, 0], armL: [-0.4, 0, 0.5], foreL: [-0.8, 0, 0], chest: [0.15, 0.2, 0], spine: [0.08, 0, 0], head: [0, -0.15, 0], jaw: [0.6, 0, 0] },
        { hit: 0.3, recover: 0.85, recoverAmt: 0.3 },
      ),
    },
    extra: (P, m, s, dt, k) => {
      const T = m.time;
      const fast = k.action ? 2.5 : 1;
      m.state.orb = (m.state.orb ?? 0) + dt * 0.6 * fast;
      const dead = s.anim === 'death' ? s.progress : 0;
      P.r('orbit', 0, m.state.orb, 0);
      P.p('orbit', 0, Math.sin(T * 0.9) * 0.05 - dead * 1.2, 0);
      for (let i = 0; i < 3; i++) { P.p('bk' + i, 0, Math.sin(T * 1.3 + i * 2) * 0.08, 0); P.r('bk' + i, Math.sin(T * 1.1 + i) * 0.2, -m.state.orb + i, Math.sin(T * 0.9 + i) * 0.15); P.s('bk' + i, 1 - dead * 0.8); }
      if (!k.action) P.r('jaw', 0.05 + Math.max(0, Math.sin(T * 0.7)) * 0.1);
    },
  },
};
function skullMini() {
  return mergeRaw([xf(G.sph(0.06, 10, 8), { sz: 1.15 }), xf(G.box(0.05, 0.03, 0.04), { y: -0.05, z: 0.03 })]);
}

// ---------------------------------------------------------------- royalGuard ----
const RG_EYE = 0x6ad6ff;
export const royalGuard = {
  id: 'royalGuard', height: 2.25, radius: 0.55, eyeColor: RG_EYE, defaultAttack: 'thrust', attackTypes: ['thrust', 'sweep', 'bash'], flutter: 0.035,
  build(rig) {
    const D = humanSkeleton(rig, { thigh: 0.52, shin: 0.5, spine: 0.18, chest: 0.36, neck: 0.09, shoulderW: 0.23, upper: 0.35, fore: 0.32, jaw: [0.045, 0.03] });
    addSkeletonBody(rig, D, { c: [0.85, 0.82, 0.72], grip: { R: true, L: true }, armored: true });
    const BK = [0.2, 0.2, 0.23];
    addPlate(rig, D, { mat: 'steel', c: BK, bulk: 1.1, pauldron: 0.14, trim: true, mailC: [0.45, 0.45, 0.5] });
    addTabard(rig, D, { c: [0.06, 0.05, 0.06], tatter: 0.15, seed: 4, len: 0.95, w: 0.8, emblem: mergeRaw([xf(G.box(0.14, 0.03, 0.01), {}), ...[-1, 0, 1].map((i) => xf(G.cone(0.02, 0.07, 4), { x: i * 0.05, y: 0.045 }))]), cfn: (v) => (Math.abs(v.x) > 0.17 ? GOLDTRIM : [0.06, 0.05, 0.06]) });
    // skull under an open-faced, crested helm
    addSkull(rig, 'head', 'jaw', { eye: RG_EYE, eyeK: 7, c: [0.85, 0.82, 0.72] });
    const helm = shell([[0.135, 0.06], [0.14, 0.13], [0.13, 0.2], [0.09, 0.25], [0.001, 0.27]], 0.01, 16);
    rig.add('head', 'steel', helm, { y: 0.01, sz: 1.1 }, { c: BK });
    rig.add('head', 'steel', mergeRaw([xf(G.box(0.03, 0.15, 0.14), { x: 0.12, y: 0.03, z: 0.0 }), xf(G.box(0.03, 0.15, 0.14), { x: -0.12, y: 0.03, z: 0.0 }), xf(G.box(0.24, 0.12, 0.03), { y: 0.06, z: -0.13 })]), {}, { c: BK });
    rig.add('head', 'gold', mergeRaw([xf(G.tor(0.142, 0.01, 4, 20), { rx: Math.PI / 2, y: 0.13, sy: 1.1 }), xf(G.box(0.02, 0.14, 0.32), { y: 0.3, z: -0.02 }), xf(G.box(0.012, 0.18, 0.02), { y: 0.13, z: 0.15 })]), {}, { c: GOLDTRIM });
    addTowerShield(rig, 'foreL', { w: 0.62, h: 1.1, y: -0.18, c: BK, rimC: GOLDTRIM, mat: 'steel', rimMat: 'gold', emblem: (r, b, t) => r.add(b, 'gold', mergeRaw([xf(G.tor(0.12, 0.02, 4, 16), { z: 0.07 }), xf(G.box(0.03, 0.5, 0.02), { z: 0.07 }), xf(G.box(0.3, 0.03, 0.02), { z: 0.07, y: 0.08 })]), t, { c: GOLDTRIM }) });
    addHalberd(rig, 'handR', { len: 2.4, grip: 0.38, metalC: [1.4, 1.4, 1.5], trimC: GOLDTRIM });
    rig.socket('muzzle', 'handR', 0, -0.07, 1.4);
    return D;
  },
  pose: humanoidPose,
  anim: {
    death: 'collapse', spawn: 'rise', gait: 'plod', armSwing: 0.15, stride: 0.5, knee: 0.7,
    rest: { armR: [-0.3, 0, 0.0], foreR: [-1.15, 0, 0], handR: [-0.2, 0, 0], armL: [-0.3, -0.9, 0.25], foreL: [-1.3, 0, 0] },
    stance: (P) => P.apply({ spine: [0.05, 0, 0], thighL: [-0.06, 0, 0.04], thighR: [-0.06, 0, -0.04], shinL: [0.1, 0, 0], shinR: [0.1, 0, 0] }),
    actions: {
      bash: act2(
        { armL: [-0.1, -1.2, 0.5], foreL: [-1.5, 0, 0], chest: [-0.1, 0.5, 0], spine: [0, 0.2, 0], hips: [0, 0, 0, 0, -0.05, -0.1], thighR: [-0.4, 0, 0], shinR: [0.6, 0, 0] },
        { armL: [-0.9, -0.9, 0.2], foreL: [-1.0, 0, 0], chest: [0.2, -0.3, 0], spine: [0.15, -0.1, 0], hips: [0, 0, 0, 0, -0.08, 0.35], thighL: [-0.7, 0, 0], shinL: [0.6, 0, 0] },
        { hit: 0.22 },
      ),
      thrust: act2(
        { armR: [0.4, 0, -0.3], foreR: [-1.5, 0, 0], handR: [0.3, 0, 0], armL: [-0.3, -0.9, 0.25], foreL: [-1.3, 0, 0], chest: [-0.05, -0.4, 0], head: [0, 0.4, 0], hips: [0, 0, 0, 0, -0.06, -0.1], thighL: [-0.4, 0, 0], shinL: [0.6, 0, 0] },
        { armR: [-1.4, 0, 0.15], foreR: [-0.1, 0, 0], handR: [0.05, 0, 0], armL: [-0.4, -0.9, 0.25], foreL: [-1.3, 0, 0], chest: [0.15, 0.3, 0], spine: [0.15, 0.1, 0], head: [-0.1, -0.3, 0], hips: [0, 0, 0, 0, -0.12, 0.3], thighR: [-0.7, 0, 0], shinR: [0.5, 0, 0] },
        { hit: 0.22 },
      ),
    },
  },
};

export const KEEP_TYPES = [animatedArmor, grimoire, courtSorcerer, imp, archivistLich, royalGuard];
