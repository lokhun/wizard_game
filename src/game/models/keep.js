import * as THREE from 'three';
import { G, xf, taper, lathe, shell, tube, deform, bumpy, robe, panel, mergeRaw, chainSkin, spikeRing, rng, vnoise, clamp, lerp, smooth, bump, easeOut, easeIn, easeInOut, TAU } from './core.js';
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
// Tall pointed cowl with an open face. Bottom at y=0 (head bone), tip leaning back.
function cowlGeo(o = {}) {
  const prof = o.prof ?? [[-0.04, 0.17], [0.06, 0.155], [0.15, 0.145], [0.22, 0.125], [0.3, 0.085], [0.38, 0.04], [0.44, 0.005]];
  const AS = 22, TS = prof.length - 1;
  const gap = (y) => (y < 0.2 ? (o.gap ?? 1.15) * (1 - smooth(0.12, 0.2, y) * 0.45) : 0);
  const pos = [], idx = [];
  for (let i = 0; i <= TS; i++) for (let j = 0; j <= AS; j++) {
    const [y, r] = prof[i];
    const a = (j / AS) * TAU - Math.PI; // a=0 front
    const back = y > 0.2 ? (y - 0.2) ** 1.5 * (o.lean ?? 0.9) : 0;
    const fold = 1 + Math.sin(a * 5 + y * 8) * 0.03;
    pos.push(Math.sin(a) * r * fold, y, Math.cos(a) * r * fold * 1.08 - back + (y < 0.12 && Math.abs(a) < 1.2 ? 0.02 : 0));
  }
  for (let i = 0; i < TS; i++) for (let j = 0; j < AS; j++) {
    const ac = ((j + 0.5) / AS) * TAU - Math.PI, yc = (prof[i][0] + prof[i + 1][0]) / 2;
    if (Math.abs(ac) < gap(yc) / 2) continue;
    const a = i * (AS + 1) + j, b = a + AS + 1;
    idx.push(a, b, a + 1, b, b + 1, a + 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx); g.computeVertexNormals();
  // gold trim along the face opening
  const edge = [];
  for (const sd of [-1, 1]) for (let i = 0; i <= TS; i++) { const [y, r] = prof[i]; const gp = gap(y); if (gp <= 0.01) break; edge.push([sd, y, r, gp]); }
  const L = edge.filter((e) => e[0] < 0), Rr = edge.filter((e) => e[0] > 0);
  const pt = ([sd, y, r, gp]) => [Math.sin(sd * gp / 2) * r, y, Math.cos(sd * gp / 2) * r * 1.08 + (y < 0.12 ? 0.02 : 0)];
  const path = [...L.map(pt), [0, 0.215, 0.135], ...Rr.slice().reverse().map(pt)];
  return { g, trim: tube(path, 0.009, 24, 4) };
}


export const courtSorcerer = {
  id: 'courtSorcerer', height: 2.3, radius: 0.42, flying: true, eyeColor: 0x9ad0ff, magicColor: ARCANE, defaultAttack: 'cast', attackTypes: ['cast', 'beam', 'summon'], orbSize: 0.08, flutter: 0.035,
  build(rig) {
    const D = humanSkeleton(rig, { thigh: 0.44, shin: 0.43, spine: 0.16, chest: 0.31, neck: 0.09, shoulderW: 0.19, upper: 0.3, fore: 0.28 });
    rig.bone('shards', 'base', 0, 1.25, 0, { rate: 0.6 });
    for (let i = 0; i < 3; i++) rig.bone('shard' + i, 'shards', Math.cos(i / 3 * TAU) * 0.55, 0, Math.sin(i / 3 * TAU) * 0.55);
    const BLUE = [0.07, 0.08, 0.26], MID = [0.16, 0.12, 0.42], INNER = [0.42, 0.36, 0.26], GOLDC = [1.0, 0.82, 0.5];
    const hem = (y0, base) => (v) => (v.y < y0 ? GOLDTRIM : (v.y < y0 + 0.05 ? [base[0] * 0.5, base[1] * 0.5, base[2] * 0.5] : base));
    // inner robe (cream), outer split robe (deep blue) with gold hem bands
    rig.add('hips', 'cloth', robe(0.18, 0.31, D.hipH + 0.06, { seg: 22, rows: 6, folds: 8, foldAmp: 0.05, tatter: 0.0, seed: 3 }), { y: 0.04 }, { anim: (v) => clamp(-v.y / 1.0), cfn: hem(-(D.hipH - 0.04), INNER) });
    const outer = new THREE.CylinderGeometry(0.2, 0.4, D.hipH + 0.12, 24, 6, true, 0.42, TAU - 0.84);
    xf(outer, { y: -(D.hipH + 0.12) / 2 });
    deform(outer, (v) => { const a = Math.atan2(v.x, v.z); const k = 1 + Math.sin(a * 8) * 0.05 * (-v.y); v.x *= k; v.z *= k; });
    rig.add('hips', 'cloth', outer, { y: 0.1 }, { anim: (v) => clamp(-v.y / 1.0) * 1.2, cfn: (v) => { const a = Math.abs(Math.atan2(v.x, v.z)); if (a < 0.5) return GOLDTRIM; return hem(-(D.hipH - 0.02), BLUE)(v); } });
    // front panel with glowing sigils
    rig.add('hips', 'cloth', panel(0.15, D.hipH - 0.05, { ws: 2, hs: 6, tatter: 0, seed: 1, curve: 0.02 }), { y: 0.08, z: 0.19, rx: 0.12 }, { c: MID, anim: (v) => clamp(-v.y / 0.9) * 0.8 });
    rig.add('hips', 'glow', mergeRaw([0, 1, 2, 3].map((i) => xf(G.tor(0.025 - i * 0.002, 0.004, 3, 10), { y: -0.08 - i * 0.18, z: 0.012 }))), { y: 0.08, z: 0.19, rx: 0.12 }, { c: HDR(ARCANE, 3), anim: (v) => clamp(-v.y / 0.9) * 0.8 });
    // torso, sash and chained amulet
    rig.add('chest', 'cloth', lathe([[0.16, -0.08], [0.2, 0.12], [0.22, 0.24], [0.14, 0.32], [0.07, 0.34]], 16), { sz: 0.82 }, { c: BLUE });
    rig.add('chest', 'gold', mergeRaw([xf(G.box(0.05, 0.32, 0.01), { x: 0.06, y: 0.14, z: 0.17, rz: -0.12 }), xf(G.box(0.05, 0.32, 0.01), { x: -0.06, y: 0.14, z: 0.17, rz: 0.12 })]), {}, { c: GOLDC });
    rig.add('hips', 'cloth', xf(G.tor(0.2, 0.03, 5, 20), { rx: Math.PI / 2, sz: 0.8 }), { y: 0.1 }, { c: [0.35, 0.06, 0.08] });
    rig.add('hips', 'cloth', mergeRaw([panel(0.06, 0.42, { tatter: 0.15, seed: 4 }), xf(panel(0.05, 0.34, { tatter: 0.15, seed: 6 }), { x: 0.05 })]), { x: 0.13, y: 0.09, z: 0.12, ry: 0.6 }, { c: [0.35, 0.06, 0.08], anim: (v) => -v.y * 1.5 });
    rig.add('chest', 'gold', mergeRaw([tube([[-0.08, 0.3, 0.12], [0, 0.14, 0.2], [0.08, 0.3, 0.12]], 0.004, 10, 3), xf(G.cyl(0.035, 0.035, 0.012, 10), { y: 0.13, z: 0.205, rx: Math.PI / 2 })]), {}, { c: GOLDC });
    rig.add('chest', 'glow', G.oct(0.018), { y: 0.13, z: 0.215, sz: 0.5 }, { c: HDR(ARCANE, 4) });
    // layered mantle with gold edge, tall flared collar with spikes
    rig.add('chest', 'cloth', robe(0.12, 0.32, 0.27, { seg: 18, rows: 2, folds: 7, foldAmp: 0.08, tatter: 0.0, seed: 6 }), { y: D.chest + 0.06, sz: 0.85 }, { cfn: hem(-0.23, MID) });
    const collar = new THREE.CylinderGeometry(0.26, 0.11, 0.4, 18, 2, true, Math.PI * 0.6, Math.PI * 0.8);
    deform(collar, (v) => { v.y += 0.2; const a = Math.atan2(v.x, v.z); if (v.y > 0.35) v.y += Math.max(0, Math.cos((a - Math.PI) * 6)) * 0.03; });
    rig.add('chest', 'cloth', twoSidedCollar(collar), { y: D.chest + 0.02, z: -0.03 }, { cfn: (v) => (v.y > 0.36 ? GOLDTRIM : [0.1, 0.07, 0.26]) });
    // cowl and porcelain mask
    const cw = cowlGeo({ gap: 1.2, lean: 1.1 });
    rig.add('head', 'cloth', cw.g, { y: 0.03, z: -0.015 }, { c: [0.06, 0.06, 0.2], anim: (v) => clamp((v.y - 0.25) * 4) * 0.4 });
    rig.add('head', 'gold', cw.trim, { y: 0.03, z: -0.015 }, { c: GOLDC });
    rig.add('head', 'dark', G.sph(0.112, 12, 10), { y: 0.1, z: -0.01 });
    const mask = new THREE.SphereGeometry(0.098, 18, 14, Math.PI * 0.14, Math.PI * 0.72, Math.PI * 0.18, Math.PI * 0.66);
    deform(mask, (v) => {
      v.z *= 1.1;
      if (Math.abs(v.x) < 0.012 && v.y < 0.03 && v.y > -0.03) v.z += 0.014 * (1 - Math.abs(v.x) / 0.012); // nose ridge
      const e = Math.exp(-(((Math.abs(v.x) - 0.033) ** 2) / 0.0003 + ((v.y - 0.012) ** 2) / 0.00015));
      v.z -= e * 0.012; // eye recesses
      if (v.y < -0.05) v.x *= 0.85; // narrow chin
    });
    rig.add('head', 'bone', mask, { y: 0.1, z: 0.03 }, { cfn: (v) => (Math.abs(Math.abs(v.x) - 0.033) < 0.006 && v.y < 0.0 && v.y > -0.05 && Math.abs(v.x) > 0.02 ? [0.2, 0.25, 0.6] : [1.35, 1.32, 1.25]) });
    rig.pair('head', 'head', 'dark', xf(G.sph(0.016, 8, 6), { sx: 1.5, sy: 0.55, sz: 0.5 }), { x: 0.033, y: 0.112, z: 0.128, rz: -0.25 });
    rig.pair('head', 'head', 'glow', xf(G.sph(0.009, 8, 6), { sx: 1.5, sy: 0.6 }), { x: 0.033, y: 0.112, z: 0.134, rz: -0.25 }, { c: HDR(0x9ad0ff, 7) });
    rig.add('head', 'dark', G.box(0.03, 0.004, 0.01), { y: 0.058, z: 0.128 });
    rig.add('head', 'gold', mergeRaw([tube([[-0.06, 0.16, 0.1], [-0.03, 0.142, 0.122], [0, 0.152, 0.13], [0.03, 0.142, 0.122], [0.06, 0.16, 0.1]], 0.004, 12, 3), xf(G.oct(0.014), { y: 0.165, z: 0.128 })]), {}, { c: GOLDC });
    // bell sleeves with gold cuffs + gloved hands with rings
    for (const S of ['L', 'R']) {
      const sx = S === 'L' ? 1 : -1;
      rig.add('arm' + S, 'cloth', robe(0.06, 0.08, D.upper + 0.02, { seg: 10, rows: 2, folds: 4, tatter: 0, seed: 2 }), { y: 0.02 }, { c: BLUE });
      rig.add('fore' + S, 'cloth', robe(0.07, 0.17, D.fore * 0.98, { seg: 16, rows: 3, folds: 6, foldAmp: 0.12, tatter: 0.0, seed: 5 + sx }), {}, { anim: (v) => clamp(-v.y * 3) * 0.7, cfn: hem(-D.fore * 0.86, BLUE) });
      addFleshHand(rig, 'hand' + S, sx, { mat: 'leather', c: [0.16, 0.12, 0.2], m: 0.85, grip: S === 'R', fingerLen: 1.15 });
      rig.add('hand' + S, 'glow', G.tor(0.01, 0.0035, 3, 8), { y: -0.09, z: 0.02, rx: Math.PI / 2 }, { c: HDR(ARCANE, 3) });
    }
    // chained tome at the hip
    rig.add('hips', 'leather', G.box(0.14, 0.18, 0.05), { x: -0.2, y: -0.12, z: 0.05, rz: -0.15 }, { c: [0.3, 0.1, 0.12] });
    rig.add('hips', 'gold', mergeRaw([xf(G.box(0.15, 0.02, 0.055), { x: -0.2, y: -0.06, z: 0.05, rz: -0.15 }), xf(G.oct(0.02), { x: -0.2, y: -0.12, z: 0.08 })]), {}, { c: GOLDC });
    // orbiting arcane shards
    for (let i = 0; i < 3; i++) {
      rig.add('shard' + i, 'glow', xf(G.oct(0.03), { sy: 2.4 }), {}, { c: HDR(ARCANE, 2.5) });
      rig.add('shard' + i, 'spirit', xf(G.oct(0.05), { sy: 2.0 }), {}, { c: HDR(ARCANE, 0.3) });
    }
    const st = addCrystalStaff(rig, 'handR', { len: 2.0, color: ARCANE, k: 3.5, crystalR: 0.06 });
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
    extra: (P, m, s, dt, k) => {
      const T = m.time;
      m.state.orb = (m.state.orb ?? 0) + dt * (k.action ? 3 : 0.9);
      const dead = s.anim === 'death' ? s.progress : 0;
      P.r('shards', 0, m.state.orb, 0);
      P.p('shards', 0, Math.sin(T * 1.1) * 0.06 - dead * 1.1, 0);
      for (let i = 0; i < 3; i++) { P.p('shard' + i, 0, Math.sin(T * 1.7 + i * 2) * 0.07, 0); P.r('shard' + i, 0, T * 2 + i, 0.2); P.s('shard' + i, Math.max(0.01, (k.action ? 1.3 : 1) * (1 - dead))); }
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

// ---------------------------------------------------------------- grimWarden ----
// The Grim Warden: a towering, empty suit of rusted black-iron plate held together by
// violet ghost-light (it leaks from the visor, the neck, elbows and knees), wrapped in
// padlocked chains and a rotten cloak, carrying a huge two-handed maul.
//
// The rig is weapon-driven. pose() damps the skeleton itself and returns 0 (the engine's
// pass then only writes bones), places the maul, and solves both arms onto the haft
// with an analytic two-bone IK against this frame's final chest transform, so the
// gauntlets never slip. The maul is either keyed in chest space (attacks, stagger),
// planted head-down on the floor in model space (idle), or dragged behind on its face
// with the right fist (move); the modes cross-fade.
// Death: every plate is a "piece" bone. Each piece topples from wherever the live pose
// has it to a resting pose on the floor (its height found from its own vertices), the
// pieces falling in a cascade while the ghost-lights wink out from the knees up to the
// visor. Spawn runs the same thing backwards: the pile reassembles and the light kindles.
const GW_EYE = 0xa070ff;
const GW_IRON = [0.5, 0.49, 0.53], GW_RUST = [1.15, 0.7, 0.5], GW_CLOAK = [0.075, 0.068, 0.072];
const GW_L = 1.62; // butt -> maul head centre
const GW_HX = 0.16, GW_HY = 0.31, GW_HZ = 0.16; // maul head half extents (X, long Y, Z along the haft)
const GW_GRIP = 0.1; // hand bone -> haft axis (palm)
// rusted black iron: rust blooms + streaks running down, bright pitted edges
function gwRust(v) {
  const n = vnoise(v.x * 6 + 7, v.y * 4, v.z * 6, 91), st = vnoise(v.x * 26, v.y * 2.2, v.z * 26, 17), d = 0.82 + 0.32 * vnoise(v.x * 30, v.y * 30, v.z * 30, 4);
  const r = smooth(0.56, 0.78, n * 0.75 + st * 0.4);
  return [lerp(GW_IRON[0], GW_RUST[0], r) * d, lerp(GW_IRON[1], GW_RUST[1], r) * d, lerp(GW_IRON[2], GW_RUST[2], r) * d];
}
// core.tube() winds inward while its normals point out: re-wind triangles to agree with their normals
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
// inner face of a sheet as its own surface (reversed, flipped normals, pushed in by d) so a cloak's
// back reads as dark lining from the front (no z-fight with the outer face)
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
// chain links along a closed path (array of Vector3), long axis along the path, alternating twist
function chainLoop(path, r = 0.03, t = 0.008, closed = true, skip = null) {
  const out = [], m = new THREE.Matrix4(), X = new THREE.Vector3(), Y = new THREE.Vector3(), Z = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
  const n = path.length;
  for (let i = 0; i < (closed ? n : n - 1); i++) {
    const p0 = path[i], p1 = path[(i + 1) % n];
    if (skip && skip(p0)) continue;
    Y.subVectors(p1, p0);
    const len = Y.length(); Y.normalize();
    X.crossVectors(up, Y); if (X.lengthSq() < 1e-6) X.set(1, 0, 0); X.normalize();
    Z.crossVectors(X, Y);
    if (i % 2) { const tx = X.clone(); X.copy(Z); Z.copy(tx).negate(); }
    m.makeBasis(X, Y, Z).setPosition((p0.x + p1.x) / 2, (p0.y + p1.y) / 2, (p0.z + p1.z) / 2);
    const g = G.tor(r, t, 3, 5);
    g.scale(1, Math.max(1, len / (2 * r) * 1.05), 1);
    out.push(g.applyMatrix4(m));
  }
  return mergeRaw(out);
}
// points round the torso at height y (bone space), ellipse rx/rz, tilted about Z by tz, every `step` metres
function torsoRing(rx, rz, y, tz, tx = 0, step = 0.075) {
  const per = Math.PI * (3 * (rx + rz) - Math.sqrt((3 * rx + rz) * (rx + 3 * rz)));
  const n = Math.max(8, Math.round(per / step)), pts = [];
  const e = new THREE.Euler(tx, 0, tz);
  for (let i = 0; i < n; i++) { const a = (i / n) * TAU; pts.push(new THREE.Vector3(Math.sin(a) * rx, 0, Math.cos(a) * rz).applyEuler(e).add(new THREE.Vector3(0, y, 0))); }
  return pts;
}

// tube-shaped limb plate hanging from y=0, flared at both ends (10 sides)
const gwPlate = (r1, r2, len, flare = 0.012) => shell([[r2 + flare, -len], [r2, -len + 0.025], [r1, -0.025], [r1 + flare, 0]], 0.01, 10);

// ---- warden poses (module level: pose() never allocates)
const GW_UPPER = { spine: [0.1, 0, 0], chest: [0.12, 0, 0], neck: [0.1, 0, 0], head: [-0.12, 0, 0] };
const GW_LEGS = { hips: [0, 0, 0, 0, -0.04, 0], thighL: [-0.1, 0, 0.1], thighR: [-0.06, 0, -0.1], shinL: [0.16, 0, 0], shinR: [0.12, 0, 0], footL: [-0.06, 0, -0.1], footR: [-0.06, 0, 0.1] };
const GW_STAGGER = { spine: [-0.22, 0.08, 0.04], chest: [-0.2, 0.12, 0], neck: [-0.1, 0, 0], head: [-0.25, -0.15, 0.06], hips: [-0.06, 0, 0, 0, -0.03, -0.12], thighL: [-0.32, 0, 0.06], shinL: [0.35, 0, 0], thighR: [0.22, 0, -0.06], shinR: [0.15, 0, 0], footR: [0.1, 0, 0] };
// overhead: rear back with the maul high behind the head, then a crushing slam into the floor ahead
const GW_OH_W = { spine: [-0.2, 0, 0], chest: [-0.22, 0.05, 0], neck: [0.05, 0, 0], head: [0.12, 0, 0], hips: [0, 0, 0, 0, -0.06, -0.1], thighL: [-0.42, 0, 0.12], shinL: [0.3, 0, 0], thighR: [0.28, 0, -0.1], shinR: [0.2, 0, 0], footL: [0.12, 0, 0], footR: [-0.2, 0, 0] };
const GW_OH_S = { spine: [0.42, 0, 0], chest: [0.36, 0, 0], neck: [-0.1, 0, 0], head: [-0.35, 0, 0], hips: [0.08, 0, 0, 0, -0.3, 0.2], thighL: [-0.95, 0, 0.12], shinL: [1.0, 0, 0], footL: [-0.05, 0, 0], thighR: [0.15, 0, -0.1], shinR: [0.75, 0, 0], footR: [-0.4, 0, 0] };
// sweep: wound up to the right, then a wide flat swing across to the left
const GW_SW_W = { spine: [0.05, -0.32, 0], chest: [0.02, -0.7, 0], head: [0, 0.75, 0], neck: [0, 0.2, 0], hips: [0, -0.25, 0, 0, -0.12, -0.04], thighL: [-0.35, 0, 0.14], shinL: [0.45, 0, 0], thighR: [0.12, 0, -0.14], shinR: [0.4, 0, 0] };
const GW_SW_S = { spine: [0.12, 0.38, 0], chest: [0.12, 0.85, 0], head: [-0.05, -0.85, 0], neck: [0, -0.25, 0], hips: [0, 0.32, 0, 0, -0.16, 0.12], thighL: [0.18, 0, 0.12], shinL: [0.35, 0, 0], thighR: [-0.55, 0, -0.12], shinR: [0.55, 0, 0], footL: [0.15, 0, 0] };
// maul keys in chest space: [gripX, gripY, gripZ, yaw, pitch, roll, gL, gR] (grips: distance from the butt)
const GW_K_HOLD = [-0.08, 0.12, 0.42, 0.55, 0.95, 0, 0.14, 0.62];
const GW_K_LIFT = [-0.2, 0.3, 0.36, -0.25, 1.55, 0, 0.14, 0.5];
const GW_K_UP = [-0.04, 0.98, -0.06, 0, 2.05, 0, 0.14, 0.44];
const GW_K_SLAM = [-0.06, 0.18, 0.46, 0, 0.36, 0, 0.14, 0.44];
const GW_K_SW_W = [-0.42, -0.25, -0.05, -1.3, 0.1, 1.57, 0.14, 0.5];
const GW_K_SW_S = [0.4, -0.28, 0.3, 0.7, -0.05, 1.57, 0.14, 0.5];
const GW_PLANT = { hx: -0.2, hz: 1.3, bx: -0.04, bz: 0.46, gL: 0.08, gR: 0.25 };
const GW_DEATH0 = { spine: [0.18, 0, 0.04], chest: [0.16, 0, 0], head: [0.35, 0.1, 0.1], neck: [0.15, 0, 0], hips: [0, 0, 0, 0, -0.08, 0], thighL: [-0.12, 0, 0.1], shinL: [0.25, 0, 0], thighR: [-0.1, 0, -0.1], shinR: [0.22, 0, 0] };
// ghost-light bones: [bone, parent, x, y, z, glow radius, wink-out time in death progress]
const GW_GHOSTS = [['gKL', 'shinL', 0, 0.0, -0.01, 0.055, 0.13], ['gKR', 'shinR', 0, 0.0, -0.01, 0.055, 0.14], ['gEL', 'foreL', 0, 0.01, 0, 0.05, 0.17], ['gER', 'foreR', 0, 0.01, 0, 0.05, 0.18], ['gW', 'spine', 0, 0.02, 0, 0.11, 0.2], ['gC', 'chest', 0, 0.22, 0.02, 0.13, 0.23], ['gN', 'neck', 0, 0.125, 0.005, 0.075, 0.27], ['gV', 'head', 0, 0.2, 0.1, 0.0, 0.34]];
// death pile: [bone, fall dir x, z (model), topple angle, spin, travel, delay, duration, lift]
// (start / duration: everything lets go as the light fails; fall time ~ sqrt(drop height), so the pile lands bottom-up)
const GW_PILE = [
  ['maul', -0.92, 0.4, 0, 0, 0.3, 0.1, 0.26, 0],
  ['footL', 0.6, 0.3, 0.55, 0.3, 0.05, 0.2, 0.12, 0], ['footR', -0.6, 0.1, 0.5, -0.4, 0.05, 0.21, 0.12, 0],
  ['shinL', 0.9, 0.45, 1.5, 0.4, 0.42, 0.2, 0.24, 0], ['shinR', -0.85, -0.5, 1.5, -0.3, 0.4, 0.21, 0.24, 0],
  ['thighL', 0.5, 0.85, 1.45, 0.2, 0.32, 0.25, 0.3, 0.0], ['thighR', -0.7, 0.7, 1.5, -0.6, 0.34, 0.24, 0.3, 0.0],
  ['hips', 0, 1, 0.25, 0.3, 0.05, 0.26, 0.32, 0.0], ['spine', 0.3, -1, 0.5, 0, 0.12, 0.28, 0.34, 0.02],
  ['handL', 0.95, 0.3, 1.5, 0.6, 0.3, 0.27, 0.34, 0], ['handR', -0.9, 0.5, 1.4, -0.4, 0.28, 0.26, 0.34, 0],
  ['foreL', 1, -0.15, 1.5, 0.9, 0.4, 0.28, 0.36, 0], ['foreR', -1, 0.1, 1.5, -1.0, 0.38, 0.28, 0.36, 0],
  ['armL', 0.9, -0.45, 1.6, 0.4, 0.45, 0.3, 0.4, 0.02], ['armR', -0.85, -0.55, 1.6, -0.5, 0.45, 0.29, 0.4, 0.02],
  ['chest', 0.15, -1, 1.45, 0.25, 0.3, 0.3, 0.4, 0.1], ['neck', -0.3, -1, 1.2, 0, 0.4, 0.32, 0.42, 0.05],
  ['head', 1, 0.25, 1.62, 2.2, 0.95, 0.33, 0.48, 0],
  ['cape0', 0.1, -1, 1.5, 0, 0.55, 0.31, 0.42, 0.04], ['cape1', 0.12, -1, 1.57, 0, 0.98, 0.33, 0.46, 0.015], ['cape2', 0.14, -1, 1.57, 0, 1.42, 0.35, 0.5, 0.005],
];

const _w = { M: new THREE.Matrix4(), M2: new THREE.Matrix4(), B: new THREE.Matrix4(), v: new THREE.Vector3(), v2: new THREE.Vector3(), v3: new THREE.Vector3(), S: new THREE.Vector3(), W: new THREE.Vector3(), E: new THREE.Vector3(), A: new THREE.Vector3(), Bv: new THREE.Vector3(), a: new THREE.Vector3(), b: new THREE.Vector3(), c: new THREE.Vector3(), f: new THREE.Vector3(), y: new THREE.Vector3(), x: new THREE.Vector3(), z: new THREE.Vector3(), q: new THREE.Quaternion(), q2: new THREE.Quaternion(), q3: new THREE.Quaternion(), qc: new THREE.Quaternion(), e: new THREE.Euler(), s: new THREE.Vector3(), p: new THREE.Vector3() };
const _UPV = new THREE.Vector3(0, 1, 0);
// quaternion of a maul frame from heading yaw, pitch (may run past +-90 deg, over the top) and roll about the haft
function maulQ(yaw, pitch, roll, out) {
  const z = _w.z.set(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch));
  const x0 = _w.x.set(Math.cos(yaw), 0, -Math.sin(yaw));
  const y0 = _w.y.crossVectors(z, x0);
  x0.multiplyScalar(Math.cos(roll)).addScaledVector(y0, Math.sin(roll));
  _w.y.crossVectors(z, x0);
  _w.B.makeBasis(x0, _w.y, z);
  return out.setFromRotationMatrix(_w.B);
}
// maul frame from a haft direction z, lateral axis from world up (roll 0)
function maulQdir(z, out) {
  _w.x.crossVectors(_UPV, z); if (_w.x.lengthSq() < 1e-8) _w.x.set(1, 0, 0); _w.x.normalize();
  _w.y.crossVectors(z, _w.x);
  _w.B.makeBasis(_w.x, _w.y, z);
  return out.setFromRotationMatrix(_w.B);
}
// how high the maul head's centre must sit for its lowest corner to touch the floor, for frame q
function headLift(q) {
  _w.a.set(1, 0, 0).applyQuaternion(q); _w.b.set(0, 1, 0).applyQuaternion(q); _w.c.set(0, 0, 1).applyQuaternion(q);
  return GW_HX * Math.abs(_w.a.y) + GW_HY * Math.abs(_w.b.y) + GW_HZ * Math.abs(_w.c.y) + 0.006;
}
// lowest point of the maul head above the floor, for a maul at butt height py with frame q
function headLow(q, py) { return py + GW_L * _w.v3.set(0, 0, 1).applyQuaternion(q).y - headLift(q); }
function snapLocal(P, i, e, pos) {
  const o = i * 9;
  P.tgt[o] = P.cur[o] = e.x; P.tgt[o + 1] = P.cur[o + 1] = e.y; P.tgt[o + 2] = P.cur[o + 2] = e.z;
  if (pos) { const r = P.rest[i]; P.tgt[o + 3] = P.cur[o + 3] = pos.x - r.x; P.tgt[o + 4] = P.cur[o + 4] = pos.y - r.y; P.tgt[o + 5] = P.cur[o + 5] = pos.z - r.z; }
}
// model matrices of every bone from a pose buffer array (P.cur), parents first (P.bones is depth-first)
function poseModel(m, arr, out) {
  const P = m.P, W = m.state.wd;
  for (let i = 0; i < P.n; i++) {
    const o = i * 9, r = P.rest[i];
    _w.e.set(arr[o], arr[o + 1], arr[o + 2]);
    _w.q.setFromEuler(_w.e);
    _w.p.set(r.x + arr[o + 3], r.y + arr[o + 4], r.z + arr[o + 5]);
    _w.s.set(Math.max(1e-4, arr[o + 6]), Math.max(1e-4, arr[o + 7]), Math.max(1e-4, arr[o + 8]));
    out[i].compose(_w.p, _w.q, _w.s);
    if (W.parent[i] >= 0) out[i].premultiply(out[W.parent[i]]);
  }
}
function wardenState(m) {
  const P = m.P, mats = () => P.bones.map(() => new THREE.Matrix4());
  const W = {
    parent: P.bones.map((b) => P.idx.get(b.parent?.name) ?? -1), Mc: mats(), Mn: mats(), clean: new Float32Array(P.cur.length), dirty: false,
    key: new Float32Array(8), modes: new Float32Array(4), yh: [new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 0, 1)], gL: 0.1, gR: 0.3, lastP: 0,
    pile: GW_PILE.map((r) => ({ i: P.idx.get(r[0]), dx: r[1], dz: r[2], tip: r[3], spin: r[4], dist: r[5], d: r[6], dur: r[7], lift: r[8] })),
    ghosts: GW_GHOSTS.map((g) => ({ i: P.idx.get(g[0]), t: g[6] })), iMaul: P.idx.get('maul'), iChest: P.idx.get('chest'), iCape: P.idx.get('cape0'), iHandR: P.idx.get('handR'),
    iArm: [P.idx.get('armL'), P.idx.get('armR')], iFore: [P.idx.get('foreL'), P.idx.get('foreR')], iHand: [P.idx.get('handL'), P.idx.get('handR')], armB: [m.bones.armL, m.bones.armR],
    ghostName: GW_GHOSTS.map((g) => g[0]),
    tmpP: new THREE.Vector3(), tmpQ: new THREE.Quaternion(), tmpQ2: new THREE.Quaternion(), tmpS: new THREE.Vector3(),
  };
  W.key.set(GW_K_HOLD);
  W.modes[1] = 1; // start planted
  W.pile.forEach((p) => { const l = Math.sqrt((p.dx) * (p.dx) + (p.dz) * (p.dz)) || 1; p.dx /= l; p.dz /= l; });
  return W;
}
// each piece's bone-local vertices (rigid, weight ~1), sampled once per type, for finding floor contact
function pieceHull(m) {
  const spec = m.spec;
  if (spec._hull) return spec._hull;
  const hull = {}, sk = m.skeleton, v = new THREE.Vector3();
  for (const r of GW_PILE) {
    const bi = sk.bones.indexOf(m.bones[r[0]]), pts = [];
    for (const ms of m.meshes) {
      const g = ms.geometry, pos = g.getAttribute('position'), si = g.getAttribute('skinIndex'), sw = g.getAttribute('skinWeight');
      for (let i = 0; i < pos.count; i++) if (si.getX(i) === bi && sw.getX(i) > 0.99) { v.fromBufferAttribute(pos, i).applyMatrix4(sk.boneInverses[bi]); pts.push(v.x, v.y, v.z); }
    }
    const stride = Math.max(1, Math.floor(pts.length / 3 / 220));
    const keep = [];
    for (let k = 0; k < pts.length; k += 3 * stride) keep.push(pts[k], pts[k + 1], pts[k + 2]);
    hull[r[0]] = new Float32Array(keep.length ? keep : [0, 0, 0]);
  }
  return (spec._hull = hull);
}

// analytic two-bone arm IK onto a haft point g (model space), hand gripping along haft dir z
function armIK(m, P, W, side, g, z, pole, wIK) {
  if (wIK < 1e-3) return;
  const D = m.spec.dims, k = side > 0 ? 0 : 1;
  const ia = W.iArm[k], ifo = W.iFore[k], ih = W.iHand[k], ic = W.iChest;
  const U = D.upper, F = D.fore;
  const C = W.Mc[ic];
  C.decompose(_w.v, _w.qc, _w.s);
  const ab = W.armB[k];
  _w.S.copy(ab.position).applyMatrix4(C); // shoulder
  const yh = W.yh[side > 0 ? 0 : 1];
  let bend = 0;
  for (let it = 0; it < 2; it++) {
    _w.W.copy(g).addScaledVector(yh, GW_GRIP);
    _w.A.subVectors(_w.W, _w.S);
    const d0 = Math.sqrt(_w.A.x * _w.A.x + _w.A.y * _w.A.y + _w.A.z * _w.A.z) || 1;
    _w.A.multiplyScalar(1 / d0);
    const d = clamp(d0, Math.abs(U - F) + 0.02, U + F - 0.004);
    bend = Math.PI - Math.acos(clamp((U * U + F * F - d * d) / (2 * U * F), -1, 1));
    // arm-local wrist and elbow-offset frames -> model frames
    _w.a.set(0, -U - F * Math.cos(bend), F * Math.sin(bend)).normalize();
    _w.b.set(0, -U, 0).addScaledVector(_w.a, U * _w.a.y).normalize(); // elbow, perpendicular to the wrist line
    if (_w.b.lengthSq() < 0.5) _w.b.set(0, 0, -1);
    _w.c.crossVectors(_w.a, _w.b);
    _w.M.makeBasis(_w.a, _w.b, _w.c);
    _w.Bv.copy(pole).applyQuaternion(_w.qc).addScaledVector(_w.A, -pole.dot(_w.A)).normalize();
    _w.v.crossVectors(_w.A, _w.Bv);
    _w.M2.makeBasis(_w.A, _w.Bv, _w.v);
    _w.M2.multiply(_w.M.transpose());
    _w.q.setFromRotationMatrix(_w.M2); // arm model rotation
    // forearm direction -> palm orientation for the next pass
    _w.E.set(0, -U, 0).applyQuaternion(_w.q).add(_w.S);
    _w.f.subVectors(_w.W, _w.E).normalize();
    _w.v2.copy(_w.f).addScaledVector(z, -_w.f.dot(z));
    if (_w.v2.lengthSq() > 1e-6) yh.copy(_w.v2).normalize().negate();
  }
  // arm local = chest^-1 * arm
  _w.q2.copy(_w.qc).invert().multiply(_w.q);
  _w.e.setFromQuaternion(_w.q2, 'XYZ');
  const cur = P.cur, tgt = P.tgt;
  let o = ia * 9;
  cur[o] = tgt[o] = cur[o] + (_w.e.x - cur[o]) * wIK; cur[o + 1] = tgt[o + 1] = cur[o + 1] + (_w.e.y - cur[o + 1]) * wIK; cur[o + 2] = tgt[o + 2] = cur[o + 2] + (_w.e.z - cur[o + 2]) * wIK;
  o = ifo * 9;
  cur[o] = tgt[o] = cur[o] + (-bend - cur[o]) * wIK; cur[o + 1] = tgt[o + 1] = cur[o + 1] * (1 - wIK); cur[o + 2] = tgt[o + 2] = cur[o + 2] * (1 - wIK);
  // hand: +Z along the haft, fingers (-Y) wrapping over it, relative to the forearm frame
  _w.x.crossVectors(yh, z).normalize();
  _w.y.crossVectors(z, _w.x);
  _w.M.makeBasis(_w.x, _w.y, z);
  _w.q3.setFromRotationMatrix(_w.M);
  _w.e.set(-bend, 0, 0); _w.q2.setFromEuler(_w.e);
  _w.q.multiply(_w.q2).invert().multiply(_w.q3);
  _w.e.setFromQuaternion(_w.q, 'XYZ');
  o = ih * 9;
  cur[o] = tgt[o] = cur[o] + (_w.e.x - cur[o]) * wIK; cur[o + 1] = tgt[o + 1] = cur[o + 1] + (_w.e.y - cur[o + 1]) * wIK; cur[o + 2] = tgt[o + 2] = cur[o + 2] + (_w.e.z - cur[o + 2]) * wIK;
}
function ikWrite(P, i, x, y, z, w) {
  const k = i * 9, cur = P.cur, tgt = P.tgt;
  cur[k] = tgt[k] = lerp(cur[k], x, w); cur[k + 1] = tgt[k + 1] = lerp(cur[k + 1], y, w); cur[k + 2] = tgt[k + 2] = lerp(cur[k + 2], z, w);
}

// blend a maul key (chest-space params) between two keys
function keyLerp(out, a, b, u) { for (let k = 0; k < 8; k++) out[k] = lerp(a[k], b[k], u); return out; }

function wardenMaul(m, s, P, dt) {
  const W = m.state.wd, an = s.anim, T = m.time, w = m.state.moveW ?? 0;
  const ic = W.iChest, im = W.iMaul;
  poseModel(m, P.cur, W.Mc);
  const C = W.Mc[ic];
  // mode weights: 0 keyed (chest space), 1 planted (idle), 2 dragged (move)
  const action = an === 'windup' || an === 'attack' || an === 'cast';
  const tk = action || an === 'stagger' ? 1 : 0, td = tk ? 0 : smooth(0.1, 0.6, w), tp = 1 - tk - td;
  const kr = 1 - Math.exp(-8 * dt);
  W.modes[0] += (tk - W.modes[0]) * kr; W.modes[1] += (tp - W.modes[1]) * kr; W.modes[2] += (td - W.modes[2]) * kr;
  if (an === 'spawn' || dt === 0 && W.modes[0] + W.modes[1] + W.modes[2] < 0.5) { W.modes[0] = tk; W.modes[1] = tp; W.modes[2] = td; }
  if (!action && an === 'stagger') W.key.set(GW_K_HOLD);
  // keyed frame (chest space -> model)
  const K = W.key;
  maulQ(K[3], K[4], K[5], _w.q);
  _w.v.set(K[0], K[1], K[2]).addScaledVector(_w.z.set(0, 0, 1).applyQuaternion(_w.q), -(K[6] + K[7]) / 2); // butt
  C.decompose(_w.p, _w.qc, _w.s);
  const pos = W.tmpP.copy(_w.v).applyMatrix4(C), rot = W.tmpQ.copy(_w.qc).multiply(_w.q);
  // the head never goes through the floor: pivot the haft up about the grips until its lowest corner touches
  {
    const gm = (K[6] + K[7]) / 2;
    _w.z.set(0, 0, 1).applyQuaternion(rot);
    if (headLow(rot, pos.y) < 0) {
      _w.f.crossVectors(_w.z, _UPV); if (_w.f.lengthSq() < 1e-6) _w.f.set(1, 0, 0).applyQuaternion(rot); _w.f.normalize();
      _w.E.copy(pos).addScaledVector(_w.z, gm); // grip centre (pivot)
      let lo = 0, hi = 1.4;
      for (let it = 0; it < 14; it++) {
        const a = (lo + hi) / 2;
        _w.q3.setFromAxisAngle(_w.f, a).multiply(rot);
        _w.v2.copy(pos).sub(_w.E).applyAxisAngle(_w.f, a).add(_w.E);
        if (headLow(_w.q3, _w.v2.y) < 0) lo = a; else hi = a;
      }
      _w.q3.setFromAxisAngle(_w.f, hi);
      pos.sub(_w.E).applyQuaternion(_w.q3).add(_w.E);
      rot.premultiply(_w.q3);
    }
  }
  let gL = K[6], gR = K[7], tot = W.modes[0];
  // planted: head fixed on the floor, butt held near the belly (slow sway), butt height solved
  if (W.modes[1] > 1e-3) {
    const pl = GW_PLANT, sw = Math.sin(T * 0.55 + m.seed * 3), br = Math.sin(T * 1.0 + m.seed * 6);
    _w.v.set(pl.bx + sw * 0.03, 0, pl.bz + br * 0.01); // butt xz
    _w.v2.set(pl.hx, GW_HZ + 0.02, pl.hz); // head centre
    for (let it = 0; it < 3; it++) {
      const dxz = Math.sqrt((_w.v2.x - _w.v.x) * (_w.v2.x - _w.v.x) + (_w.v2.z - _w.v.z) * (_w.v2.z - _w.v.z));
      _w.v.y = _w.v2.y + Math.sqrt(Math.max(0.01, GW_L * GW_L - dxz * dxz));
      _w.z.subVectors(_w.v2, _w.v).normalize();
      maulQdir(_w.z, _w.q2);
      _w.v2.y = headLift(_w.q2);
    }
    const k = W.modes[1] / (tot + W.modes[1]);
    pos.lerp(_w.v, k); rot.slerp(_w.q2, k); gL = lerp(gL, pl.gL, k); gR = lerp(gR, pl.gR, k); tot += W.modes[1];
  }
  // dragged: right fist (FK) holds the butt end, head scraping on its face behind; pitch solved so it touches
  if (W.modes[2] > 1e-3) {
    const ih = W.iHandR;
    poseModel(m, P.tgt, W.Mn);
    _w.p.set(0, -GW_GRIP, 0).applyMatrix4(W.Mn[ih]); // fist grip
    const yaw = Math.PI + 0.85, g = 0.14;
    let lo = -1.4, hi = 0.3, pitch = -0.5;
    for (let it = 0; it < 18; it++) {
      pitch = (lo + hi) / 2;
      _w.z.set(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch));
      maulQdir(_w.z, _w.q2);
      const hy = _w.p.y + (GW_L - g) * Math.sin(pitch);
      if (hy > headLift(_w.q2) + Math.max(0, Math.cos(m.state.phase * 2)) * 0.02 * w) hi = pitch; else lo = pitch;
    }
    _w.v.copy(_w.p).addScaledVector(_w.z, -g);
    const k = W.modes[2] / (tot + W.modes[2]);
    pos.lerp(_w.v, k); rot.slerp(_w.q2, k); gR = lerp(gR, g, k); tot += W.modes[2];
  }
  // the cloak hangs from the shoulders by its own weight (heading only), swinging back as it walks
  {
    const icp = W.iCape;
    _w.v.set(0, 0, 1).applyQuaternion(_w.qc);
    const yaw = Math.atan2(_w.v.x, _w.v.z);
    _w.e.set(0.05 + 0.32 * w + (an === 'stagger' ? 0.25 : 0), yaw, 0, 'YXZ');
    _w.q.setFromEuler(_w.e);
    if (!W.capeQ) W.capeQ = _w.q.clone();
    W.capeQ.slerp(_w.q, dt > 0 ? 1 - Math.exp(-5 * dt) : 0);
    _w.q2.copy(_w.qc).invert().multiply(W.capeQ);
    _w.e.setFromQuaternion(_w.q2, 'XYZ');
    ikWrite(P, icp, _w.e.x, _w.e.y, _w.e.z, 0.9);
    _w.e.order = 'XYZ';
  }
  // write the maul bone (child of chest): local = chest^-1 * model
  _w.M.compose(pos, rot, _w.s.set(1, 1, 1));
  _w.M2.copy(C).invert().multiply(_w.M);
  _w.M2.decompose(_w.p, _w.q, _w.s);
  _w.e.setFromQuaternion(_w.q, 'XYZ');
  snapLocal(P, im, _w.e, _w.p);
  // both fists onto the haft (the left lets go while dragging)
  _w.z.set(0, 0, 1).applyQuaternion(rot);
  const zc = W.f ?? (W.f = new THREE.Vector3());
  zc.copy(_w.z);
  const gpt = W.g ?? (W.g = new THREE.Vector3());
  gpt.copy(pos).addScaledVector(zc, gR);
  armIK(m, P, W, -1, gpt, zc, GW_POLE_R, 1);
  gpt.copy(pos).addScaledVector(zc, gL);
  armIK(m, P, W, 1, gpt, zc, GW_POLE_L, 1 - W.modes[2]);
}
const GW_POLE_L = new THREE.Vector3(1, -0.55, -0.35).normalize(), GW_POLE_R = new THREE.Vector3(-1, -0.55, -0.35).normalize();

// pieces fall from the live pose (clean) to the floor pile; k: per-piece progress function
function wardenPile(m, s, P, prog) {
  const W = m.state.wd, hull = pieceHull(m), T = m.time;
  const spawn = s.anim === 'spawn';
  poseModel(m, P.cur, W.Mc);
  for (let i = 0; i < P.n; i++) W.Mn[i].copy(W.Mc[i]);
  const isPiece = W.isPiece ?? (W.isPiece = (() => { const a = new Int16Array(P.n).fill(-1); W.pile.forEach((p, k) => (a[p.i] = k)); return a; })());
  for (let i = 0; i < P.n; i++) {
    const k = isPiece[i];
    const par = W.parent[i];
    if (k < 0) { // non-piece: follow its (possibly falling) parent
      if (par >= 0) { _w.M.copy(W.Mc[par]).invert().multiply(W.Mc[i]); W.Mn[i].multiplyMatrices(W.Mn[par], _w.M); }
      continue;
    }
    const pc = W.pile[k];
    const s0 = pc.i === W.iMaul ? 0.5 : 0.04 + (pc.d - 0.2) * 2.0;
    const ur = (prog - pc.d) / pc.dur;
    const u = spawn ? 1 - smooth(s0, s0 + pc.dur * 0.9, prog) : clamp(ur);
    if (u <= 0) { if (par >= 0) { _w.M.copy(W.Mc[par]).invert().multiply(W.Mc[i]); W.Mn[i].multiplyMatrices(W.Mn[par], _w.M); } continue; }
    W.Mc[i].decompose(W.tmpP, W.tmpQ, W.tmpS);
    // resting orientation: toppled toward (dx, dz), spun about the vertical
    _w.v.set(pc.dz, 0, -pc.dx);
    _w.q.setFromAxisAngle(_w.v, pc.tip);
    _w.q2.setFromAxisAngle(_UPV, pc.spin);
    _w.q.multiply(_w.q2);
    if (pc.i === W.iMaul) { // the maul lands flat: haft along the fall direction, head on its side
      _w.z.set(pc.dx, -0.07, pc.dz).normalize();
      _w.x.set(0, 1, 0).addScaledVector(_w.z, -_w.z.y).normalize();
      _w.y.crossVectors(_w.z, _w.x);
      _w.B.makeBasis(_w.x, _w.y, _w.z); _w.q.setFromRotationMatrix(_w.B);
    }
    // floor contact from the piece's own vertices
    const H = hull[GW_PILE[k][0]];
    let mn = 1e9;
    for (let j = 0; j < H.length; j += 3) { _w.v.set(H[j], H[j + 1], H[j + 2]).applyQuaternion(_w.q); if (_w.v.y < mn) mn = _w.v.y; }
    const restY = -mn + pc.lift + 0.004;
    const ue = easeIn(u), us = smooth(0, 1, u);
    _w.p.set(lerp(W.tmpP.x, W.tmpP.x * 0.85 + pc.dx * pc.dist, us), lerp(W.tmpP.y, restY, ue), lerp(W.tmpP.z, W.tmpP.z * 0.85 + pc.dz * pc.dist, us));
    if (!spawn) _w.p.y += bump(1, 1.22, ur) * 0.045 * (1 - pc.lift * 4); // clatters once after landing
    _w.q2.copy(W.tmpQ).slerp(_w.q, us);
    W.Mn[i].compose(_w.p, _w.q2, W.tmpS);
    // back into the parent's (new) frame
    _w.M.copy(par >= 0 ? W.Mn[par] : _w.M2.identity()).invert().multiply(W.Mn[i]);
    _w.M.decompose(_w.p, _w.q, _w.s);
    _w.e.setFromQuaternion(_w.q, 'XYZ');
    snapLocal(P, i, _w.e, _w.p);
  }
  // ghost-light winks out knees -> visor (flaring first); spawn kindles it again at the end
  for (let n = 0; n < W.ghosts.length; n++) {
    const gh = W.ghosts[n];
    let g;
    if (spawn) g = smooth(0.72 + gh.t * 0.4, 0.8 + gh.t * 0.4, prog) * (1 + bump(0.8 + gh.t * 0.4, 0.92 + gh.t * 0.4, prog) * 0.6);
    else g = (1 - smooth(gh.t, gh.t + 0.06, prog)) * (1 + bump(gh.t - 0.1, gh.t, prog) * (0.2 + 0.25 * Math.sin(T * 47 + gh.i)));
    const o = gh.i * 9, sc = Math.max(0.001, g);
    P.cur[o + 6] = P.cur[o + 7] = P.cur[o + 8] = P.tgt[o + 6] = P.tgt[o + 7] = P.tgt[o + 8] = sc;
  }
}

function wardenAction(name) {
  return (P, ph, p, m) => {
    const W = m.state.wd, T = m.time;
    if (!W) return 10;
    if (name === 'overhead') {
      if (ph === 'windup') {
        const u = smooth(0, 0.75, p);
        P.apply(GW_OH_W, smooth(0, 0.6, p));
        keyLerp(W.key, GW_K_LIFT, GW_K_UP, u);
        if (p < 0.25) keyLerp(W.key, GW_K_HOLD, W.key, smooth(0, 0.25, p));
        const tr = smooth(0.6, 1, p) * 0.02;
        P.r('chest', Math.sin(T * 31) * tr, Math.sin(T * 23) * tr); P.p('hips', 0, Math.sin(T * 27) * tr * 0.3, 0);
        return 7;
      }
      const hit = 0.24, u = easeIn(clamp(p / hit)), rec = smooth(0.62, 1, p) * 0.45;
      P.blend(GW_OH_W, GW_OH_S, smooth(0, hit, p), 1 - rec);
      keyLerp(W.key, GW_K_UP, GW_K_SLAM, u);
      if (rec > 0) keyLerp(W.key, W.key, GW_K_HOLD, rec);
      // impact: the whole suit jolts, plates rattle
      const j = bump(hit, hit + 0.12, p);
      P.p('hips', 0, -j * 0.06, 0); P.r('chest', j * 0.08); P.r('head', -j * 0.1, Math.sin(T * 50) * j * 0.05);
      return p < hit ? 30 : 18;
    }
    // sweep
    if (ph === 'windup') {
      P.apply(GW_SW_W, smooth(0, 0.7, p));
      keyLerp(W.key, GW_K_HOLD, GW_K_SW_W, smooth(0, 0.75, p));
      const tr = smooth(0.6, 1, p) * 0.02;
      P.r('chest', 0, Math.sin(T * 29) * tr);
      return 7;
    }
    const hit = 0.32, u = smooth(0, hit, p), rec = smooth(0.66, 1, p) * 0.5;
    P.blend(GW_SW_W, GW_SW_S, u, 1 - rec);
    keyLerp(W.key, GW_K_SW_W, GW_K_SW_S, easeInOut(u));
    if (rec > 0) keyLerp(W.key, W.key, GW_K_HOLD, rec);
    return 24;
  };
}

export const grimWarden = {
  id: 'grimWarden', height: 2.6, radius: 0.75, eyeColor: GW_EYE, magicColor: GW_EYE, defaultAttack: 'overhead', attackTypes: ['overhead', 'sweep'], flutter: 0.045,
  build(rig) {
    const D = humanSkeleton(rig, { thigh: 0.56, shin: 0.55, ankle: 0.09, hipW: 0.16, spine: 0.22, chest: 0.5, neck: 0.1, shoulderW: 0.36, shoulderDrop: 0.1, upper: 0.44, fore: 0.42 });
    rig.bone('maul', 'chest', 0, 0, 0);
    rig.bone('cape0', 'chest', 0, D.chest - 0.04, -0.27, { rate: 0.6 });
    rig.bone('cape1', 'cape0', 0, -0.55, -0.02, { rate: 0.5 });
    rig.bone('cape2', 'cape1', 0, -0.55, 0, { rate: 0.4 });
    for (const g of GW_GHOSTS) rig.bone(g[0], g[1], g[2], g[3], g[4]);
    const W = D.shoulderW;
    const IRON = { cfn: gwRust };
    const core = HDR(GW_EYE, 3.2), haze = HDR(GW_EYE, 0.32);

    // --- cuirass: barrel chest, keel ridge, hunched back, open neck; rust holes leaking light
    const cu = lathe([[W * 0.72, -0.14], [W * 0.82, -0.02], [W * 0.92, D.chest * 0.35], [W * 0.98, D.chest * 0.7], [W * 0.86, D.chest * 0.93], [W * 0.52, D.chest + 0.04], [W * 0.33, D.chest + 0.07]], 20);
    deform(cu, (v) => {
      v.z *= 0.8;
      if (v.z > 0) v.z += Math.max(0, 1 - Math.abs(v.x) / (W * 0.7)) * 0.06 * clamp(1 - Math.abs(v.y - D.chest * 0.45) / D.chest);
      if (v.z < 0) v.z -= clamp((v.y - D.chest * 0.35) / (D.chest * 0.6)) ** 2 * 0.08;
      const dn = Math.exp(-((v.x - 0.14) ** 2 + (v.y - D.chest * 0.55) ** 2) / 0.006) * 0.025 + Math.exp(-((v.x + 0.2) ** 2 + (v.y - D.chest * 0.2) ** 2) / 0.004) * 0.018;
      if (v.z > 0) v.z -= dn;
    });
    rig.add('chest', 'iron', cu, {}, IRON);
    rig.add('chest', 'iron', mergeRaw([xf(G.tor(W * 0.84, 0.014, 3, 18), { rx: Math.PI / 2, y: -0.1, sz: 0.8 }), xf(G.tor(W * 0.5, 0.016, 3, 14), { rx: Math.PI / 2, y: D.chest + 0.035, sz: 0.82 })]), {}, IRON);
    rig.add('chest', 'iron', rivets([...Array(10)].map((_, i) => { const a = (i / 10 - 0.5) * 2.6; return [Math.sin(a) * W * 0.86, -0.08, Math.cos(a) * W * 0.86 * 0.8 + 0.01]; }), 0.014), {}, { c: GW_RUST });
    rig.add('chest', 'dark', xf(G.cyl(W * 0.7, W * 0.62, D.chest + 0.1, 10, false), { y: D.chest / 2, sz: 0.75 }));
    rig.add('chest', 'dark', mergeRaw([xf(G.sph(0.03, 6, 4), { x: -0.17, y: D.chest * 0.62, z: W * 0.8 + 0.01, sz: 0.4 }), xf(G.sph(0.022, 6, 4), { x: 0.2, y: D.chest * 0.32, z: W * 0.78 + 0.0, sz: 0.4 })]));
    rig.add('gC', 'glow', mergeRaw([xf(G.sph(0.018, 6, 4), { x: -0.17, y: D.chest * 0.62 - 0.22, z: W * 0.8 - 0.004, sz: 0.4 }), xf(G.sph(0.013, 6, 4), { x: 0.2, y: D.chest * 0.32 - 0.22, z: W * 0.78 - 0.01, sz: 0.4 })]), {}, { c: HDR(GW_EYE, 4) });
    // abdomen lames + faulds + tassets over a dark mail skirt
    for (let i = 0; i < 2; i++) rig.add('spine', 'iron', shell([[W * (0.74 - i * 0.03), -0.0 - i * 0.09], [W * (0.78 - i * 0.03), 0.09 - i * 0.09]], 0.01, 18), { y: 0.08, sz: 0.78 }, IRON);
    for (let i = 0; i < 3; i++) rig.add('hips', 'iron', shell([[W * (0.84 + i * 0.05), -0.07 - i * 0.07], [W * (0.78 + i * 0.05), -0.0 - i * 0.07]], 0.01, 15), { y: 0.06, sz: 0.78 }, IRON);
    rig.pair('hips', 'hips', 'iron', deform(mergeRaw([xf(G.box(0.22, 0.3, 0.014, 2, 3, 1), { y: -0.15 }), xf(G.box(0.22, 0.02, 0.026), { y: -0.3 }), xf(G.box(0.22, 0.02, 0.026), { y: -0.1 })]), (v) => { v.z -= v.x * v.x * 1.2; }), { x: W * 0.42, y: -0.15, z: W * 0.62, rx: 0.12, ry: 0.32 }, IRON);
    rig.add('hips', 'mail', robe(W * 0.72, W * 0.92, D.thigh * 0.75, { seg: 16, rows: 3, folds: 7, foldAmp: 0.04, tatter: 0.12, seed: 5 }), { y: -0.05, sz: 0.82 }, { c: [0.32, 0.29, 0.3], skin: (v) => { const t = clamp((-v.y - 0.05) / (D.thigh * 0.7)) * 0.8, l = clamp(0.5 + v.x * 3); return [['hips', 1 - t], ['thighL', t * l], ['thighR', t * (1 - l)]]; } });
    rig.add('hips', 'dark', xf(G.cyl(W * 0.68, W * 0.6, 0.3, 10, false), { y: -0.06, sz: 0.75 }));
    rig.add('gW', 'spirit', G.sph(0.18, 7, 4), { sy: 0.5, sz: 0.7 }, { c: haze });
    rig.add('gW', 'glow', xf(G.tor(W * 0.6, 0.006, 3, 18), { rx: Math.PI / 2, sz: 0.78 }), {}, { c: HDR(GW_EYE, 1.1) });

    // --- chains wound round the torso, a heavy padlock on the breast, a loose end hanging
    rig.add('chest', 'iron', chainLoop(torsoRing(W * 0.98, W * 0.83, D.chest * 0.42, 0.32, 0.06, 0.1), 0.038, 0.011, true, (p) => p.z < -W * 0.45), {}, { c: [1.05, 0.85, 0.75] });
    rig.add('spine', 'iron', chainLoop(torsoRing(W * 0.82, W * 0.68, 0.12, -0.2, 0, 0.1), 0.038, 0.011, true, (p) => p.z < -W * 0.35), {}, { c: [1.05, 0.85, 0.75] });
    const hang = [];
    for (let i = 0; i <= 6; i++) hang.push(new THREE.Vector3(-W * 0.62 + Math.sin(i * 0.5) * 0.02, 0.1 - i * 0.07, W * 0.42 + i * 0.006));
    rig.add('spine', 'iron', chainLoop(hang, 0.034, 0.01, false), {}, { c: [1.05, 0.85, 0.75] });
    const lockT = { x: 0.035, y: D.chest * 0.42 + 0.01 - 0.12, z: W * 0.83 + 0.06, rz: 0.12 };
    rig.add('chest', 'iron', mergeRaw([xf(G.box(0.16, 0.13, 0.065, 2, 2, 1), { y: -0.03 }), xf(G.cyl(0.08, 0.08, 0.065, 12, false, 1), { rx: Math.PI / 2, y: -0.095 }), xf(G.tor(0.052, 0.015, 4, 10, Math.PI), { y: 0.035 }), xf(G.box(0.17, 0.02, 0.07), { y: 0.03 })]), lockT, { c: [1.3, 0.95, 0.7] });
    rig.add('chest', 'dark', mergeRaw([xf(G.cyl(0.014, 0.014, 0.02, 6), { rx: Math.PI / 2, y: -0.045, z: 0.03 }), xf(G.box(0.01, 0.034, 0.02), { y: -0.072, z: 0.03 })]), lockT);

    // --- gorget, ghost-lit neck gap, great helm with a glowing visor slit
    rig.add('neck', 'iron', lathe([[0.15, -0.06], [0.155, 0.0], [0.135, 0.06], [0.12, 0.09]], 16), { sz: 0.95 }, IRON);
    rig.add('neck', 'iron', xf(G.tor(0.152, 0.012, 4, 18), { rx: Math.PI / 2, y: -0.03 }), {}, IRON);
    rig.add('neck', 'dark', xf(G.cyl(0.085, 0.095, 0.22, 8), { y: 0.08 }));
    rig.add('gN', 'spirit', G.sph(0.13, 7, 4), { sy: 0.55 }, { c: haze });
    rig.add('gN', 'glow', xf(G.tor(0.1, 0.014, 3, 16), { rx: Math.PI / 2 }), {}, { c: HDR(GW_EYE, 2.6) });
    const helm = lathe([[0.15, -0.02], [0.162, 0.06], [0.168, 0.2], [0.155, 0.3], [0.12, 0.37], [0.06, 0.41], [0.001, 0.425]], 18);
    deform(helm, (v) => {
      v.z *= 1.08;
      if (v.z > 0) v.z += Math.max(0, 1 - Math.abs(v.x) / 0.1) * 0.035 * clamp((0.38 - v.y) / 0.3); // keel down the face
      const dn = Math.exp(-((v.x + 0.1) ** 2 + (v.y - 0.3) ** 2) / 0.003) * 0.018; if (v.z > 0) v.z -= dn;
    });
    rig.add('head', 'iron', helm, { y: 0.04 }, IRON);
    rig.add('head', 'iron', mergeRaw([xf(G.tor(0.164, 0.012, 4, 20), { rx: Math.PI / 2, y: 0.11, sy: 1.08 }), xf(G.tor(0.16, 0.011, 4, 20), { rx: Math.PI / 2, y: 0.3, sy: 1.08 }), xf(G.cone(0.025, 0.12, 4), { y: 0.5, ry: Math.PI / 4 })]), { y: 0.0 }, IRON);
    rig.add('head', 'iron', rivets([...Array(10)].map((_, i) => { const a = (i / 10) * TAU; return [Math.sin(a) * 0.172, 0.11, Math.cos(a) * 0.172 * 1.08]; }), 0.012), {}, { c: GW_RUST });
    rig.add('head', 'dark', mergeRaw([xf(G.box(0.24, 0.035, 0.06), { y: 0.22, z: 0.165 }), ...[0, 1, 2, 3, 4, 5].map((i) => xf(G.box(0.012, 0.03, 0.05), { x: (i % 3 - 1) * 0.04 + (i < 3 ? 0 : 0.02) * 0, y: 0.13 - Math.floor(i / 3) * 0.04, z: 0.172, ry: (i % 3 - 1) * 0.3 }))]));
    rig.add('gV', 'glow', xf(G.box(0.23, 0.014, 0.012), { z: 0.075 }), {}, { c: HDR(GW_EYE, 7) });
    rig.add('gV', 'spirit', mergeRaw([xf(G.sph(0.09, 6, 4), { sy: 0.25, sz: 0.4, z: 0.08 }), ...[-1, 1].map((sx) => outward(tube([[sx * 0.06, 0.0, 0.09], [sx * 0.1, 0.04, 0.0], [sx * 0.12, 0.08, -0.16]], (u) => 0.018 * (1 - u), 8, 4)))]), {}, { c: HDR(GW_EYE, 0.45), anim: (v) => clamp(-v.z * 4) * 0.8 });
    rig.add('head', 'dark', xf(G.sph(0.14, 8, 6), { y: 0.18, sz: 1.05 }));

    // --- shoulders: towering layered pauldrons with raised haute-pieces, a rotten mantle under them
    for (const S of ['L', 'R']) {
      const sx = S === 'L' ? 1 : -1;
      const pd = mergeRaw([shell([[0.23, -0.03], [0.222, 0.07], [0.17, 0.145], [0.001, 0.185]], 0.012, 12), ...[1, 2].map((k) => shell([[0.235 + k * 0.018, -0.03 - k * 0.075], [0.232 + k * 0.016, 0.035 - k * 0.075]], 0.012, 11))]);
      rig.add('arm' + S, 'iron', pd, { x: sx * 0.04, y: 0.04, rz: sx * 0.36, sz: 0.92 }, IRON);
      // raised ridge along the crown of the pauldron
      rig.add('arm' + S, 'iron', xf(G.box(0.03, 0.05, 0.3), { y: 0.215, x: sx * 0.07, rz: sx * 0.36 }), {}, IRON);
      rig.add('arm' + S, 'iron', rivets([[sx * 0.12, 0.1, 0.16], [sx * 0.18, 0.05, 0.13], [sx * 0.22, -0.02, 0.09], [sx * 0.12, 0.1, -0.16], [sx * 0.18, 0.05, -0.13]], 0.014), {}, { c: GW_RUST });
      // arms: rerebrace, ghost-lit elbow, couter cup behind it, vambrace, gauntlet
      rig.add('arm' + S, 'iron', gwPlate(0.085, 0.075, D.upper * 0.62), { y: -D.upper * 0.22 }, IRON);
      rig.add('arm' + S, 'dark', xf(G.cyl(0.055, 0.05, D.upper * 0.8, 6, true), { y: -D.upper * 0.45 }), {});
      rig.add('fore' + S, 'iron', mergeRaw([xf(G.sph(0.075, 10, 8, 0, TAU, 0, Math.PI * 0.55), { rx: -Math.PI / 2 - 0.25, z: -0.025 }), xf(G.cone(0.07, 0.11, 6), { z: -0.09, rx: -Math.PI / 2, sx: 1.3, sy: 0.4 })]), { y: 0.0 }, IRON);
      rig.add('fore' + S, 'iron', gwPlate(0.075, 0.068, D.fore * 0.66), { y: -D.fore * 0.2 }, IRON);
      rig.add('fore' + S, 'dark', xf(G.cyl(0.05, 0.045, D.fore * 0.8, 6, true), { y: -D.fore * 0.5 }), {});
      rig.add('g' + 'E' + S, 'spirit', G.sph(0.09, 6, 4), {}, { c: haze });
      rig.add('g' + 'E' + S, 'glow', G.sph(0.03, 5, 4), {}, { c: core });
      // gauntlet: flared cuff, back plate, knuckle lame, finger plates curled round the haft at y = -GW_GRIP
      const gt = [lathe([[0.1, 0.06], [0.078, -0.03]], 12), xf(G.box(0.08, 0.1, 0.11), { x: sx * 0.035, y: -0.065 }), xf(G.box(0.085, 0.03, 0.12), { x: sx * 0.045, y: -0.12 })];
      for (let k = 0; k < 3; k++) { const a = 0.35 + k * 0.6; gt.push(xf(G.box(0.03, 0.062, 0.115), { x: sx * (0.02 - Math.sin(a) * 0.045) - sx * 0.02, y: -GW_GRIP - Math.cos(a) * 0.045, rz: sx * a })); }
      gt.push(xf(G.box(0.04, 0.07, 0.035), { x: -sx * 0.035, y: -0.07, z: 0.065, rz: -sx * 0.5 }));
      rig.add('hand' + S, 'iron', mergeRaw(gt), {}, IRON);
      rig.add('hand' + S, 'dark', G.cyl(0.045, 0.045, 0.06, 8), { y: 0.0 });
      // legs: cuisse, ghost-lit knee, poleyn, greave, sabaton
      rig.add('thigh' + S, 'iron', gwPlate(0.135, 0.112, D.thigh * 0.74), { y: -D.thigh * 0.06 }, IRON);
      rig.add('thigh' + S, 'dark', xf(G.cyl(0.1, 0.085, D.thigh * 0.8, 6, true), { y: -D.thigh * 0.45 }), {});
      rig.add('shin' + S, 'iron', mergeRaw([xf(G.sph(0.1, 10, 8, 0, TAU, 0, Math.PI * 0.55), { rx: Math.PI / 2 + 0.2, z: 0.045 }), xf(G.cone(0.085, 0.12, 6), { z: 0.03, x: sx * 0.08, rz: -sx * Math.PI / 2, sy: 0.45 })]), { y: -0.01 }, IRON);
      rig.add('shin' + S, 'iron', gwPlate(0.112, 0.088, D.shin * 0.8), { y: -D.shin * 0.13 }, IRON);
      rig.add('shin' + S, 'dark', xf(G.cyl(0.08, 0.065, D.shin * 0.8, 6, true), { y: -D.shin * 0.5 }), {});
      rig.add('g' + 'K' + S, 'spirit', G.sph(0.1, 6, 4), { z: -0.02 }, { c: haze });
      rig.add('g' + 'K' + S, 'glow', G.sph(0.032, 5, 4), { z: -0.04 }, { c: core });
      // sabaton: a domed shell over the foot, arched lames across the instep, an ankle cuff, a thick sole
      const sab = [xf(G.sph(0.095, 10, 6, 0, TAU, 0, Math.PI / 2), { sx: 1.0, sy: 0.85, sz: 1.95, y: -0.1, z: 0.075 }), xf(G.box(0.18, 0.03, 0.38), { y: -0.1, z: 0.075 }), xf(G.cyl(0.085, 0.095, 0.08, 10, true), { y: -0.05 })];
      for (let k = 0; k < 3; k++) sab.push(xf(new THREE.CylinderGeometry(0.1 - k * 0.006, 0.1 - k * 0.006, 0.06, 8, 1, true, -Math.PI / 2, Math.PI), { rz: Math.PI / 2, y: -0.1, z: 0.13 + k * 0.05, sy: 1, sx: 0.8 }));
      rig.add('foot' + S, 'iron', mergeRaw(sab), {}, IRON);
    }
    const mant = robe(0.17, 0.42, 0.3, { seg: 20, rows: 3, folds: 8, foldAmp: 0.12, tatter: 0.5, seed: 12 });
    rig.add('chest', 'cloth', mant, { y: D.chest + 0.06, sz: 0.85 }, { c: GW_CLOAK, anim: (v) => clamp(-v.y * 3) * 0.8 });
    rig.add('chest', 'cloth', lining(mant, 0.005), { y: D.chest + 0.06, sz: 0.85 }, { c: [0.04, 0.035, 0.04], anim: (v) => clamp(-v.y * 3) * 0.8 });
    // tattered cloak on its lagging chain of bones
    const capeLen = 1.68;
    const cape = panel(0.98, capeLen, { ws: 11, hs: 14, tatter: 0.55, seed: 21, curve: 0.32, taperBot: 1.3 });
    deform(cape, (v) => { const t = clamp(-v.y / capeLen); v.z += Math.sin(v.x * 15 + 0.6) * (0.012 + 0.05 * t) + Math.sin(v.x * 31 + v.y * 3) * 0.01 * t; }, true);
    const capeSkin = chainSkin([['cape2', -1.2], ['cape1', -0.62], ['cape0', -0.08]], (v) => v.y), capeAnim = (v) => clamp(-v.y / capeLen) * 1.6;
    rig.add('cape0', 'cloth', lining(cape, 0.006), { ry: Math.PI, rx: 0.06 }, { c: [0.045, 0.04, 0.045], anim: capeAnim, skin: capeSkin });
    rig.add('cape0', 'cloth', cape, { ry: Math.PI, rx: 0.06 }, {
      cfn: (v) => { const k = 0.8 + 0.4 * vnoise(v.x * 9, v.y * 6, 1, 3); return [GW_CLOAK[0] * k * 1.3, GW_CLOAK[1] * k, GW_CLOAK[2] * k * 0.9]; },
      anim: capeAnim,
      skin: capeSkin,
    });

    // --- the maul: iron haft wrapped at the grips, banded block head (maul space: butt at 0, head along +Z)
    const HZ = GW_L;
    rig.add('maul', 'iron', mergeRaw([xf(G.cyl(0.04, 0.044, HZ + GW_HZ, 10), { rx: Math.PI / 2, z: (HZ + GW_HZ) / 2 }), xf(G.sph(0.062, 10, 8), { z: -0.02 }), xf(G.cyl(0.055, 0.05, 0.06, 10), { rx: Math.PI / 2, z: 0.03 }), ...[0, 1, 2, 3].map((k) => xf(G.box(0.018, 0.016, 0.4), { x: Math.cos(k * Math.PI / 2) * 0.046, y: Math.sin(k * Math.PI / 2) * 0.046, z: HZ - GW_HZ - 0.18 }))]), {}, IRON);
    rig.add('maul', 'leather', mergeRaw([0, 1, 2, 3, 4, 5, 6].map((k) => xf(G.cyl(0.05, 0.05, 0.09, 8, true), { rx: Math.PI / 2 + (k % 2 ? 0.12 : -0.12), z: 0.1 + k * 0.088 }))), {}, { c: [0.38, 0.3, 0.26] });
    const head = G.box(GW_HX * 2, GW_HY * 2, GW_HZ * 2, 3, 6, 3);
    deform(head, (v) => { // chamfered, battered block
      const cx = Math.abs(v.x) / GW_HX, cz = Math.abs(v.z) / GW_HZ, k = Math.max(0, cx + cz - 1.55) * 0.05;
      v.x *= 1 - k * 2.5; v.z *= 1 - k * 2.5;
      const e = Math.abs(v.y) / GW_HY; if (e > 0.9) { v.x *= 1 - (e - 0.9) * 0.6; v.z *= 1 - (e - 0.9) * 0.6; }
      v.x += (vnoise(v.y * 9, v.z * 9, 3, 41) - 0.5) * 0.012;
    });
    rig.add('maul', 'iron', head, { z: HZ }, IRON);
    rig.add('maul', 'iron', mergeRaw([...[-0.2, 0.2].map((y) => xf(G.box(GW_HX * 2 + 0.03, 0.05, GW_HZ * 2 + 0.03), { y })), ...[-1, 1].map((sy) => xf(G.box(GW_HX * 2 - 0.05, 0.03, GW_HZ * 2 - 0.05), { y: sy * (GW_HY + 0.012) })), xf(G.cyl(0.07, 0.085, 0.06, 10), { rx: Math.PI / 2, z: -GW_HZ - 0.02 }), xf(G.cyl(0.05, 0.06, 0.05, 8), { rx: Math.PI / 2, z: GW_HZ + 0.02 })]), { z: HZ }, { c: [1.0, 0.9, 0.85] });
    rig.add('maul', 'iron', rivets([...[-0.2, 0.2].flatMap((y) => [-1, 1].flatMap((sx) => [[sx * (GW_HX + 0.016), y, -0.08], [sx * (GW_HX + 0.016), y, 0.08]]))], 0.016), { z: HZ }, { c: GW_RUST });
    rig.socket('muzzle', 'maul', 0, 0, HZ);
    return D;
  },
  pose(m, s, P, dt) {
    const st = m.state;
    let W = st.wd;
    if (!W) W = st.wd = wardenState(m);
    // undo last frame's pile override so the animated pose keeps running underneath it
    if (W.dirty) { P.cur.set(W.clean); W.dirty = false; }
    const an = s.anim, T = m.time;
    const r = humanoidPose(m, s, P, dt);
    const w = st.moveW ?? 0;
    if (an !== 'death' && an !== 'spawn') {
      // heavy footfalls: each step jolts the suit and rattles the helm
      if (w > 0.02) { const hit = Math.abs(Math.cos(st.phase)) ** 8 * w; P.p('hips', 0, -hit * 0.04, 0); P.r('chest', hit * 0.05, 0, Math.sin(st.phase) * 0.03 * w); P.r('head', -hit * 0.06); P.p('head', 0, hit * 0.012, 0); }
      // the plates hover a hair apart on the ghost-light (helm, pauldrons breathe off the body)
      const g = 0.5 + 0.5 * Math.sin(T * 1.3 + m.seed * 5);
      P.p('head', 0, 0.035 + g * 0.012, 0.01); P.p('armL', 0.012 * g, 0.008 * g, 0); P.p('armR', -0.012 * g, 0.008 * g, 0);
      P.p('neck', 0, 0.012 + g * 0.006, 0); P.p('shinL', 0, -0.02 - g * 0.006, 0); P.p('shinR', 0, -0.02 - g * 0.006, 0);
      for (let n = 0; n < W.ghosts.length; n++) P.s(W.ghostName[n], 0.92 + 0.12 * Math.sin(T * 5.3 + W.ghosts[n].i * 1.7) * Math.sin(T * 1.7 + W.ghosts[n].i));
    }
    m.setOrb(0);
    P.damp(dt, r);
    wardenMaul(m, s, P, dt);
    if (an === 'death' || an === 'spawn') {
      W.clean.set(P.cur);
      W.dirty = true;
      wardenPile(m, s, P, s.progress);
    }
    return 0; // damped above; the engine's pass only writes the bones
  },
  anim: {
    gait: 'plod', armSwing: 0.1, stride: 0.38, strideK: 0.1, knee: 0.55, breath: 0.8, look: 0.3, armOut: 0.05, rate: 8,
    stance: (P, m, s) => {
      if (s.anim === 'death' || s.anim === 'spawn') return;
      P.apply(GW_UPPER);
      P.apply(GW_LEGS, 1 - (m.state.moveW ?? 0));
    },
    stagger: GW_STAGGER,
    actions: { overhead: wardenAction('overhead'), sweep: wardenAction('sweep'), cast: wardenAction('overhead') },
    // the light fails: a shudder, the suit sags (the pieces then fall away from this pose)
    death: (P, p, m) => { const a = smooth(0, 0.3, p); P.apply(GW_UPPER, 1 - a); P.apply(GW_LEGS, 1 - a); P.apply(GW_DEATH0, a); const sh = bump(0, 0.25, p) * 0.04; P.r('chest', Math.sin(m.time * 41) * sh, Math.sin(m.time * 37) * sh); P.r('head', Math.sin(m.time * 33) * sh * 2); return 10; },
    spawn: (P, p, m) => { P.apply(GW_UPPER); P.apply(GW_LEGS); return 12; },
  },
};

export const KEEP_TYPES = [animatedArmor, grimoire, courtSorcerer, imp, archivistLich, royalGuard, grimWarden];
