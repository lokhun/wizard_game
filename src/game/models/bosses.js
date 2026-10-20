import * as THREE from 'three';
import { G, xf, taper, lathe, shell, tube, deform, bumpy, shaggy, robe, panel, mergeRaw, chainSkin, spikeRing, rng, vnoise, clamp, lerp, smooth, bump, easeOut, easeIn, easeInOut, TAU } from './core.js';
import { humanSkeleton, humanoidPose, act2, ACT } from './humanoid.js';
import {
  addSkull, addFleshHand, addBoneHand, addSword, swordGeo, addPlate, addTabard, greatHelm, hood, addWing, wingBones, flapWings, addCrystalStaff, addRoundShield,
  pauldron, rivets, twoSided, HDR, STEEL, RUSTY, DARKSTEEL, BLACKSTEEL, GOLDTRIM,
} from './parts.js';
import { buildHeadsman, HEADSMAN_ANIM } from './dungeon.js';
import { skullGeo } from '../../world/props.js';

// ============================================================ motherOfFilth ==
const FILTH = 0x9bff3a;
const TENT = [[0.45, 1.25, 1.5], [-0.45, 1.25, 1.5], [1.35, 1.0, 1.2], [-1.35, 1.0, 1.2], [2.3, 0.7, 1.0], [-2.3, 0.7, 1.0], [2.9, 0.5, 0.8], [-2.9, 0.5, 0.8]]; // [angle, rootY, rootR]
const TSEG = 5, TLEN = 0.62;
export const motherOfFilth = {
  id: 'motherOfFilth', height: 4.6, radius: 2.4, boss: true, eyeColor: FILTH, magicColor: FILTH, defaultAttack: 'slam', attackTypes: ['slam', 'spit', 'summon', 'submerge'], wobble: true, orbSize: 0.22, length: 5,
  build(rig) {
    rig.bone('base', null);
    rig.bone('mass', 'base', 0, 0, 0, { rate: 0.8 });
    rig.bone('head', 'base', 0, 2.85, 1.75);
    rig.bone('jaw', 'head', 0, -0.17, 0.35);
    rig.bone('crown', 'head', 0, 0.62, 0.05, { rate: 0.6 });
    for (let i = 0; i < 4; i++) rig.bone('emb' + i, 'mass', 0, 1.5, 0);
    TENT.forEach(([a, y, r], t) => {
      const d = new THREE.Vector3(Math.sin(a), 0.4, Math.cos(a)).normalize();
      let prev = 'base';
      for (let k = 0; k < TSEG; k++) {
        const o = k === 0 ? new THREE.Vector3(Math.sin(a) * r, y, Math.cos(a) * r) : d.clone().multiplyScalar(TLEN);
        rig.bone(`t${t}_${k}`, prev, o.x, o.y, o.z, { rate: 0.7 });
        prev = `t${t}_${k}`;
      }
    });
    // the mass: huge lumpy translucent mound
    const g = G.sph(2.0, 56, 36);
    deform(g, (v) => {
      v.y = (v.y + 2.0) * 0.86;
      const n = vnoise(v.x * 1.2 + 4, v.y * 1.2, v.z * 1.2, 5) - 0.5;
      let k = 1 + n * 0.28;
      if (v.y < 0.9) k *= 1 + (0.9 - v.y) * 0.22;
      v.x *= k * 1.05; v.z *= k;
      if (v.z > 0.5 && v.y > 2.2) v.z += (v.y - 2.2) * 0.3;
    });
    rig.add('mass', 'slime', g, {}, {
      anim: (v) => smooth(0.1, 1.2, v.y),
      cfn: (v) => { const k = 0.4 + v.y * 0.2; const n = vnoise(v.x * 3, v.y * 3, v.z * 3, 2); return n > 0.62 ? [0.35 * k, 0.32 * k, 0.1 * k] : [0.2 * k, 0.5 * k, 0.1 * k]; },
    });
    rig.add('mass', 'spirit', G.sph(0.8, 16, 12), { y: 1.4, sy: 0.9 }, { c: HDR(FILTH, 0.1) });
    // sludge pool
    const pool = G.cyl(3.2, 3.4, 0.08, 40, false, 1);
    deform(pool, (v) => { const n = vnoise(v.x * 1.5, 0, v.z * 1.5, 8); const k = 0.75 + n * 0.4; v.x *= k; v.z *= k; });
    rig.add('base', 'slime', pool, { y: 0.03 }, { c: [0.12, 0.2, 0.05] });
    // embedded debris
    rig.add('emb0', 'bone', mergeRaw([skullGeo(), xf(skullGeo(), { x: 0.4, y: -0.3, ry: 1.5 })]), { s: 2.6 }, { c: [1.2, 1.15, 1.0] });
    const ribs = [];
    for (let i = 0; i < 6; i++) ribs.push(xf(G.tor(0.32 - Math.abs(i - 2.5) * 0.03, 0.03, 5, 14, Math.PI * 1.2), { y: i * 0.12, rx: 1.4, rz: 0.3 }));
    rig.add('emb1', 'bone', mergeRaw(ribs), {}, { c: [1.1, 1.05, 0.9] });
    rig.add('emb2', 'bone', mergeRaw([xf(G.cyl(0.045, 0.045, 0.9, 6), { rz: 1.0 }), xf(G.cyl(0.04, 0.04, 0.8, 6), { rz: -0.4, x: 0.3, y: 0.3 }), xf(G.sph(0.08, 6, 5), { x: 0.39, y: 0.25 })]), {}, { c: [1.1, 1.05, 0.9] });
    rig.add('emb3', 'iron', mergeRaw([xf(G.box(0.1, 1.1, 0.02), { rz: 0.8 }), xf(G.box(0.3, 0.05, 0.05), { rz: 0.8, x: -0.35, y: -0.35 })]), {}, { c: RUSTY });
    rig.add('emb3', 'iron', xf(G.sph(0.25, 12, 8, 0, TAU, 0, Math.PI / 2), { x: 0.5, y: 0.2, rx: 0.8 }), {}, { c: RUSTY });
    // glowing pustules + crust patches on the surface
    const R = rng(33);
    const pg = [], pc = [];
    for (let i = 0; i < 26; i++) {
      const a = R() * TAU, y = 0.3 + R() * 2.6;
      const rr = 2.0 * Math.sqrt(Math.max(0.05, 1 - ((y / 0.86 - 2.0) / 2.0) ** 2)) * 1.05 + 0.02;
      const p = { x: Math.sin(a) * rr, y, z: Math.cos(a) * rr };
      const s = 0.07 + R() * 0.12;
      pc.push(xf(G.sph(s, 8, 6), p));
      pg.push(xf(G.sph(s * 0.6, 6, 5), { ...p, x: p.x * 1.03, z: p.z * 1.03 }));
    }
    rig.add('mass', 'skin', mergeRaw(pc), {}, { c: [0.75, 0.75, 0.38] });
    rig.add('mass', 'glow', mergeRaw(pg), {}, { c: HDR(FILTH, 3.0) });
    // tentacles: one tube per tentacle skinned along its bone chain
    TENT.forEach(([a, y, r], t) => {
      const d = new THREE.Vector3(Math.sin(a), 0.4, Math.cos(a)).normalize();
      const root = new THREE.Vector3(Math.sin(a) * r, y, Math.cos(a) * r);
      const L = TSEG * TLEN + 0.4;
      const pts = [];
      for (let i = 0; i <= 6; i++) pts.push(root.clone().addScaledVector(d, -0.3 + (i / 6) * L));
      const geo = tube(pts, (u) => 0.32 * (1 - u * 0.85) + 0.02, 30, 8);
      const chain = [['base', -0.4], ...Array.from({ length: TSEG }, (_, k) => [`t${t}_${k}`, k * TLEN])];
      const proj = (v) => _tmp.copy(v).sub(root).dot(d);
      rig.add('base', 'skin', bumpy(geo, 0.02, 4, t), {}, {
        skin: chainSkin(chain, proj),
        cfn: (v) => { const u = clamp(proj(v) / L); const n = vnoise(v.x * 6, v.y * 6, v.z * 6, t); return [lerp(0.55, 0.85, u) * (0.8 + n * 0.4), lerp(0.62, 0.6, u) * (0.8 + n * 0.4), 0.32]; },
      });
      // suckers along the underside
      const su = [];
      for (let i = 1; i < 8; i++) { const p = root.clone().addScaledVector(d, i * 0.4); const rad = 0.26 * (1 - (i * 0.4 / L) * 0.85); su.push(xf(G.sph(rad * 0.3, 6, 4), { x: p.x, y: p.y - rad * 0.9, z: p.z, sy: 0.4 })); }
      rig.add('base', 'skin', mergeRaw(su), {}, { c: [0.75, 0.55, 0.45], skin: chainSkin(chain, proj) });
    });
    // crowned rat skull face
    const S = 4.4;
    const cran = deform(G.sph(0.075, 16, 12), (v) => { v.z *= 1.15; v.x *= 0.95; if (v.z > 0.03) { const d2 = (Math.abs(v.x) - 0.04) ** 2 + (v.y - 0.02) ** 2; v.z -= Math.exp(-d2 / 0.0004) * 0.03; } });
    rig.add('head', 'bone', cran, { s: S, y: 0.05 }, { c: [1.0, 0.95, 0.8] });
    rig.add('head', 'bone', xf(taper(0.05, 0.022, 0.17, 12, 3), { rx: -Math.PI / 2 + 0.25, sx: 1.1, sy: 0.75 }), { s: S, y: 0.02 * S, z: 0.06 * S }, { c: [1.0, 0.95, 0.8] });
    rig.pair('head', 'head', 'dark', G.sph(0.02, 8, 6), { x: 0.04 * S, y: 0.075 * S, z: 0.07 * S, s: S });
    rig.pair('head', 'head', 'glow', G.sph(0.011, 8, 6), { x: 0.042 * S, y: 0.075 * S, z: 0.078 * S, s: S }, { c: HDR(FILTH, 8) });
    rig.pair('head', 'head', 'dark', G.sph(0.008, 5, 4), { x: 0.01 * S, y: -0.005 * S, z: 0.22 * S, s: S });
    rig.pair('head', 'head', 'bone', G.box(0.016, 0.07, 0.01), { x: 0.01 * S, y: -0.04 * S, z: 0.2 * S, rx: 0.25, s: S }, { c: [1.2, 0.95, 0.4] });
    rig.add('jaw', 'bone', xf(taper(0.035, 0.014, 0.15, 10, 2), { rx: -Math.PI / 2 + 0.15, sy: 0.6 }), { s: S, z: -0.02 * S }, { c: [1.0, 0.95, 0.8] });
    rig.pair('jaw', 'jaw', 'bone', G.box(0.014, 0.06, 0.01), { x: 0.009 * S, y: 0.02 * S, z: 0.12 * S, rx: -0.2, s: S }, { c: [1.2, 0.95, 0.4] });
    rig.add('jaw', 'glow', G.box(0.04, 0.01, 0.1), { y: 0.02 * S, z: 0.06 * S, s: S }, { c: HDR(FILTH, 2) });
    rig.add('jaw', 'slime', mergeRaw([tube([[0.03, 0, 0.3], [0.04, -0.3, 0.32], [0.02, -0.7, 0.28]], (u) => 0.03 * (1 - u * 0.5), 8, 5), tube([[-0.06, 0, 0.25], [-0.07, -0.25, 0.27], [-0.06, -0.5, 0.25]], (u) => 0.025 * (1 - u * 0.5), 8, 5)]), {}, { c: [0.4, 1.0, 0.25], anim: 1 });
    // rusty crown
    rig.add('crown', 'gold', mergeRaw([xf(G.cyl(0.42, 0.4, 0.18, 14, true), {}), spikeRing(0.42, 7, 0.42, 0.08, 0.09, 0.12)]), { rz: 0.18, rx: -0.15 }, { c: [0.9, 0.7, 0.4] });
    rig.add('crown', 'glow', mergeRaw([0, 2, 4].map((i) => xf(G.oct(0.04), { x: Math.sin(i / 7 * TAU) * 0.43, z: Math.cos(i / 7 * TAU) * 0.43 }))), { rz: 0.18, rx: -0.15 }, { c: HDR(0x40ff60, 3) });
    rig.socket('muzzle', 'jaw', 0, 0.06, 0.45);
    return {};
  },
  pose(m, s, P, dt) {
    const T = m.time, anim = s.anim, p = s.progress, at = s.attackType, st = m.state;
    const spd = anim === 'death' ? 0 : s.speed;
    const mw = smooth(0.05, 0.6, spd);
    st.moveW = (st.moveW ?? 0) + (mw - (st.moveW ?? 0)) * (1 - Math.exp(-5 * dt));
    const w = st.moveW;
    if (spd > 0) st.phase += dt * spd * 1.6;
    let rate = 7;
    const br = Math.sin(T * 1.3);
    let sy = 1 + br * 0.035 + Math.sin(st.phase * 2) * 0.05 * w, sxz = 1 - br * 0.02;
    let wob = 0.09 + w * 0.05;
    P.r('mass', 0.04 * w, Math.sin(T * 0.3) * 0.05, Math.sin(T * 0.5) * 0.02);
    P.r('head', Math.sin(T * 0.7) * 0.08, Math.sin(T * 0.45) * 0.22, Math.sin(T * 0.6) * 0.07);
    P.p('head', 0, br * 0.06, 0);
    P.r('jaw', 0.12 + Math.max(0, Math.sin(T * 1.1)) * 0.15);
    P.r('crown', Math.sin(T * 0.9) * 0.05, 0, Math.sin(T * 0.7) * 0.06);
    for (let i = 0; i < 4; i++) { P.p('emb' + i, Math.sin(T * 0.2 + i * 2) * 0.6, (i - 1.5) * 0.4 + Math.sin(T * 0.3 + i) * 0.2, Math.cos(T * 0.25 + i * 1.7) * 0.5); P.r('emb' + i, T * 0.1 + i, T * 0.07 * (i % 2 ? 1 : -1), i); }
    // tentacle writhing: droop toward the ground plus travelling waves
    const tent = (t, droop, wave = 1, curl = 0, spread = 0) => {
      const [a] = TENT[t];
      const ax = Math.cos(a), az = -Math.sin(a); // horizontal axis perpendicular to the tentacle
      for (let k = 0; k < TSEG; k++) {
        const ph = T * 1.6 - k * 0.9 + t * 1.7;
        const d = droop * (k === 0 ? 0.6 : 0.35) + curl * (k + 1) * 0.12;
        const sway = Math.sin(ph) * 0.28 * wave;
        P.r(`t${t}_${k}`, ax * d + Math.cos(ph * 0.8) * 0.15 * wave, sway + spread * (k === 0 ? (t % 2 ? -1 : 1) : 0), az * d);
      }
    };
    const dead = anim === 'death';
    for (let t = 0; t < TENT.length; t++) tent(t, dead ? 0 : 0.35 + w * 0.15, dead ? 0.2 : 1.3 + w * 0.5, dead ? 0 : 0.35 + Math.sin(T * 0.8 + t) * 0.15);
    if (anim === 'windup' || anim === 'attack' || anim === 'cast') {
      rate = anim === 'attack' ? 18 : 9;
      if (at === 'slam') {
        if (anim === 'windup') { tent(0, -1.6 * smooth(0, 0.6, p), 0.3, -0.5); tent(1, -1.6 * smooth(0, 0.6, p), 0.3, -0.5); P.r('head', -0.25 * p); P.r('mass', -0.08 * p); P.p('mass', 0, 0, -0.3 * p); wob = 0.14; }
        else { const k = smooth(0.0, 0.3, p) * (1 - smooth(0.7, 1, p)); tent(0, 2.4 * k, 0.2, 0.8 * k); tent(1, 2.4 * k, 0.2, 0.8 * k); P.p('mass', 0, 0, 0.4 * bump(0, 0.6, p)); P.r('head', 0.2 * k); sy *= 1 - 0.12 * bump(0.15, 0.5, p); wob = 0.2; }
      } else if (at === 'spit') {
        if (anim === 'windup') { P.r('head', -0.45 * p); P.r('jaw', 0.8 * p); sy *= 1 + 0.08 * p; m.setOrb(0.3 + 0.7 * p); }
        else { P.r('head', 0.35 * bump(0, 0.6, p)); P.r('jaw', 1.0); P.p('head', 0, 0, 0.3 * bump(0, 0.6, p)); m.setOrb(1 - smooth(0.05, 0.3, p)); sy *= 1 - 0.06 * bump(0, 0.4, p); }
      } else if (at === 'summon') {
        for (let t = 0; t < TENT.length; t++) tent(t, -0.8 * smooth(0, 0.5, p), 1.8, 0, 0.3);
        P.r('head', -0.4 * smooth(0, 0.5, p)); P.r('jaw', 0.9 * smooth(0, 0.5, p));
        sy *= 1 + Math.sin(T * 9) * 0.04; wob = 0.18; m.setOrb(anim === 'attack' ? 0 : 0.6);
      } else if (at === 'submerge') {
        const k = anim === 'windup' ? 0.15 * p : easeIn(p);
        P.p('base', 0, -5.2 * k, 0); sy *= 1 - 0.3 * k;
        for (let t = 0; t < TENT.length; t++) tent(t, -0.6, 2.5);
        wob = 0.2;
      }
    } else if (anim === 'stagger') {
      const k = s.t < 0.08 ? s.t / 0.08 : Math.exp(-(s.t - 0.08) * 4);
      P.r('head', -0.35 * k, 0.2 * k, 0.15 * k); P.r('mass', -0.1 * k); sy *= 1 - 0.1 * k; wob = 0.25; rate = 20;
      for (let t = 0; t < TENT.length; t++) tent(t, -0.5 * k, 2);
    } else if (dead) {
      const e = easeOut(p);
      sy = lerp(sy, 0.16, e); sxz = lerp(1, 1.35, e); wob = 0.05;
      P.p('head', 0, -2.7 * e, 0.4 * e); P.r('head', 0.6 * e, 0.4 * e, 0.5 * e); P.r('jaw', 0.8 * e);
      P.p('crown', 0.3 * smooth(0.4, 1, p), -0.2 * smooth(0.4, 1, p), 0.2 * smooth(0.4, 1, p)); P.r('crown', 0.3 * p, 0, 1.3 * smooth(0.4, 1, p));
      for (let t = 0; t < TENT.length; t++) tent(t, 1.4 * e, 0.3 * (1 - e));
      for (let t = 0; t < TENT.length; t++) P.p(`t${t}_0`, 0, -TENT[t][1] * 0.85 * e, 0);
      m.setOpacity(1 - 0.3 * e);
      rate = 6;
    } else if (anim === 'spawn') {
      const e = easeOut(p);
      P.p('base', 0, -5.2 * (1 - e), 0);
      for (let t = 0; t < TENT.length; t++) tent(t, -0.6 * (1 - p), 2.5);
      rate = 12;
    }
    P.sc('mass', sxz, sy, sxz);
    m.U.uWobble.value += (wob - m.U.uWobble.value) * Math.min(1, dt * 5);
    return rate;
  },
};
const _tmp = new THREE.Vector3();

// =============================================================== executioner ==
export const executioner = {
  id: 'executioner', height: 4.6, radius: 1.2, boss: true, eyeColor: 0xff3a20, defaultAttack: 'slam', attackTypes: ['slam', 'sweep', 'charge', 'roar'],
  build(rig) { rig.scale = 1.8; return buildHeadsman(rig, { boss: true }); },
  pose: humanoidPose,
  anim: {
    ...HEADSMAN_ANIM, breath: 1.0, look: 0.6,
    actions: {
      charge: act2(
        { chest: [0.3, 0, 0], spine: [0.25, 0, 0], head: [-0.25, 0, 0], armR: [-0.6, 0, 0.3], foreR: [-0.9, 0, 0], handR: [0.4, 0, 0], armL: [-0.6, 0, -0.3], foreL: [-1.0, 0, 0], hips: [0, 0, 0, 0, -0.18, -0.15], thighL: [-0.8, 0, 0], shinL: [1.0, 0, 0], thighR: [0.3, 0, 0], shinR: [0.6, 0, 0] },
        { chest: [0.45, 0.3, 0], spine: [0.35, 0.2, 0], head: [-0.4, -0.2, 0], armR: [-1.2, 0, 0.4], foreR: [-0.4, 0, 0], handR: [0.8, 0, 0], armL: [-1.0, 0, -0.3], foreL: [-0.6, 0, 0], hips: [0, 0, 0, 0, -0.1, 0.2] },
        { hit: 0.15, recover: 0.85, recoverAmt: 0.25 },
      ),
    },
  },
};

// =============================================================== stoneWyvern ==
const MAGMA = 0xff5a14;
const NECK = 4, TAIL = 8;
const _magma = new THREE.Color(MAGMA);
export const stoneWyvern = {
  id: 'stoneWyvern', height: 3.6, radius: 1.6, length: 6.5, boss: true, eyeColor: 0xffa020, magicColor: 0xff6a18, defaultAttack: 'breath', attackTypes: ['breath', 'slam', 'sweep', 'fly', 'roar'], crackColor: MAGMA, crackIntensity: 3.5, orbSize: 0.18,
  build(rig) {
    rig.bone('base', null);
    rig.bone('body', 'base', 0, 1.75, -0.4);
    rig.bone('chest', 'body', 0, 0.2, 1.0);
    let prev = 'chest';
    const neckOff = [[0, 0.35, 0.45], [0, 0.33, 0.3], [0, 0.3, 0.26], [0, 0.26, 0.24]];
    for (let i = 0; i < NECK; i++) { rig.bone('neck' + i, prev, ...neckOff[i], { rate: 0.85 }); prev = 'neck' + i; }
    rig.bone('head', prev, 0, 0.18, 0.26);
    rig.bone('jaw', 'head', 0, -0.1, 0.12);
    prev = 'body';
    for (let i = 0; i < TAIL; i++) { rig.bone('tail' + i, prev, 0, i === 0 ? 0.05 : -0.02, i === 0 ? -0.6 : -0.45, { rate: 0.7 }); prev = 'tail' + i; }
    for (const [S, sd] of [['L', 1], ['R', -1]]) {
      rig.bone('thigh' + S, 'body', sd * 0.5, -0.05, 0.15);
      rig.bone('shin' + S, 'thigh' + S, 0, -0.85, 0);
      rig.bone('foot' + S, 'shin' + S, 0, -0.8, 0);
    }
    wingBones(rig, 'chest', 0.35, 0.35, -0.1, 3.0, 0.4);
    const ST = [1.0, 0.97, 0.94];
    // torso: one mass skinned from pelvis to chest
    const tors = G.sph(0.75, 28, 20);
    deform(tors, (v) => { v.z *= 1.6; v.x *= 0.85; if (v.z > 0.3) { v.y *= 1.05; } if (v.y < 0) v.y *= 0.9; });
    rig.add('body', 'magmastone', bumpy(tors, 0.03, 4, 2), { y: 0.1, z: 0.45 }, { c: ST, skin: chainSkin([['body', 0.0], ['chest', 0.9]], (v) => v.z) });
    // belly plates
    const bel = [];
    for (let i = 0; i < 9; i++) bel.push(xf(G.box(0.55 - Math.abs(i - 4) * 0.04, 0.05, 0.16), { y: -0.6 + Math.abs(i - 4) * 0.03, z: -0.25 + i * 0.16, rx: 0.1 }));
    rig.add('body', 'stone', mergeRaw(bel), { y: 0.1, z: 0.45 }, { c: [0.75, 0.65, 0.55], skin: chainSkin([['body', 0.0], ['chest', 0.9]], (v) => v.z) });
    // neck tube along the chain
    const np = [new THREE.Vector3(0, 0.0, 0.0)];
    const acc = new THREE.Vector3();
    for (let i = 0; i < NECK; i++) { acc.add(new THREE.Vector3(...neckOff[i])); np.push(acc.clone()); }
    np.push(acc.clone().add(new THREE.Vector3(0, 0.18, 0.26)));
    const nchain = [['chest', 0.0], ...Array.from({ length: NECK }, (_, i) => ['neck' + i, i + 1]), ['head', NECK + 1]];
    const along = (v) => { let best = 0, bd = 1e9; for (let i = 0; i < np.length - 1; i++) { const a = np[i], b = np[i + 1]; const ab = b.clone().sub(a); const t = clamp(v.clone().sub(a).dot(ab) / ab.lengthSq()); const d = v.distanceToSquared(a.clone().addScaledVector(ab, t)); if (d < bd) { bd = d; best = i + t; } } return best; };
    rig.add('chest', 'magmastone', bumpy(tube(np, (u) => 0.36 - u * 0.16, 24, 10), 0.02, 6, 4), {}, { c: ST, skin: chainSkin(nchain, along) });
    // dorsal spikes: neck, back, tail
    const spk = [];
    for (let i = 1; i < np.length - 1; i++) { const p = np[i]; spk.push(xf(G.cone(0.06, 0.28, 4), { x: p.x, y: p.y + 0.24, z: p.z - 0.05, rx: -0.6 })); }
    rig.add('chest', 'stone', mergeRaw(spk), {}, { c: [0.6, 0.55, 0.5], skin: chainSkin(nchain, along) });
    const bsp = [];
    for (let i = 0; i < 6; i++) bsp.push(xf(G.cone(0.08, 0.38 - Math.abs(i - 2.5) * 0.04, 4), { y: 0.72 - Math.abs(i - 2.5) * 0.04, z: 1.1 - i * 0.28, rx: -0.5 }));
    rig.add('body', 'stone', mergeRaw(bsp), {}, { c: [0.6, 0.55, 0.5], skin: chainSkin([['body', 0.0], ['chest', 0.9]], (v) => v.z) });
    // head
    const hd = G.box(0.38, 0.3, 0.55, 3, 3, 4);
    deform(hd, (v) => { const t = clamp((v.z + 0.27) / 0.55); v.x *= 1 - t * 0.35; v.y *= 1 - t * 0.35; if (v.y > 0) v.y += Math.sin(t * Math.PI) * 0.03; });
    rig.add('head', 'magmastone', bumpy(hd, 0.012, 9, 7), { y: 0.05, z: 0.25 }, { c: ST });
    rig.add('head', 'stone', mergeRaw([xf(G.box(0.42, 0.06, 0.12), { y: 0.18, z: 0.2, rx: 0.3 })]), {}, { c: [0.7, 0.65, 0.6] });
    rig.pair('head', 'head', 'stone', tube([[0.13, 0.15, 0.05], [0.25, 0.25, -0.15], [0.3, 0.3, -0.45], [0.24, 0.22, -0.7]], (u) => 0.08 * (1 - u * 0.85), 14, 6), {}, { c: [0.55, 0.5, 0.45] });
    rig.pair('head', 'head', 'stone', tube([[0.15, 0.05, 0.0], [0.26, 0.04, -0.15], [0.32, 0.0, -0.3]], (u) => 0.04 * (1 - u * 0.85), 10, 5), {}, { c: [0.55, 0.5, 0.45] });
    rig.pair('head', 'head', 'dark', G.sph(0.045, 8, 6), { x: 0.13, y: 0.12, z: 0.32, sz: 0.6 });
    rig.pair('head', 'head', 'glow', xf(G.sph(0.03, 8, 6), { sx: 1.4, sy: 0.7 }), { x: 0.14, y: 0.12, z: 0.345, rz: -0.25 }, { c: HDR(0xffa020, 8) });
    const tu = [];
    for (let i = 0; i < 8; i++) for (const sd of [-1, 1]) tu.push(xf(G.cone(0.018, i === 0 ? 0.12 : 0.07, 4), { x: sd * (0.12 - i * 0.008), y: -0.1, z: 0.12 + i * 0.05, rx: Math.PI }));
    rig.add('head', 'bone', mergeRaw(tu), {}, { c: [0.9, 0.82, 0.6] });
    rig.add('head', 'glow', G.box(0.16, 0.05, 0.4), { y: -0.09, z: 0.3 }, { c: HDR(MAGMA, 3) });
    const jw = G.box(0.3, 0.09, 0.5, 2, 1, 3);
    deform(jw, (v) => { const t = clamp((v.z + 0.25) / 0.5); v.x *= 1 - t * 0.35; });
    rig.add('jaw', 'magmastone', jw, { y: -0.04, z: 0.2 }, { c: ST });
    const tl = [];
    for (let i = 0; i < 7; i++) for (const sd of [-1, 1]) tl.push(xf(G.cone(0.016, 0.06, 4), { x: sd * (0.1 - i * 0.008), y: 0.02, z: 0.06 + i * 0.05 }));
    rig.add('jaw', 'bone', mergeRaw(tl), {}, { c: [0.9, 0.82, 0.6] });
    rig.add('jaw', 'glow', G.box(0.14, 0.02, 0.35), { y: 0.01, z: 0.2 }, { c: HDR(MAGMA, 3) });
    // legs
    for (const S of ['L', 'R']) {
      const sx = S === 'L' ? 1 : -1;
      rig.add('thigh' + S, 'magmastone', bumpy(xf(G.sph(0.32, 14, 10), { sy: 1.7, sz: 1.2 }), 0.02, 6, 3), { y: -0.3, z: 0.05 }, { c: ST });
      rig.add('shin' + S, 'magmastone', taper(0.2, 0.13, 0.8, 10, 2), {}, { c: ST });
      rig.add('foot' + S, 'magmastone', taper(0.13, 0.11, 0.45, 8, 1), {}, { c: ST });
      for (let i = 0; i < 3; i++) rig.add('foot' + S, 'bone', xf(G.cone(0.05, 0.28, 4), { rx: Math.PI / 2 + 0.3 }), { x: (i - 1) * 0.11, y: -0.47, z: 0.16, ry: (i - 1) * 0.3 }, { c: [0.3, 0.27, 0.24] });
      rig.add('foot' + S, 'bone', xf(G.cone(0.04, 0.18, 4), { rx: -Math.PI / 2 - 0.3 }), { y: -0.42, z: -0.12 }, { c: [0.3, 0.27, 0.24] });
      void sx;
    }
    // wings
    addWing(rig, 1, { span: 3.0, mat: 'stone', c: [0.75, 0.7, 0.66], boneMat: 'magmastone', boneC: ST, claw: true, fingers: 4, flutter: 0.15 });
    addWing(rig, -1, { span: 3.0, mat: 'stone', c: [0.75, 0.7, 0.66], boneMat: 'magmastone', boneC: ST, claw: true, fingers: 4, flutter: 0.15 });
    // tail with spikes and a bladed tip
    const tp = []; for (let i = 0; i <= TAIL; i++) tp.push([0, 0.12 - i * 0.025, -0.4 - i * 0.45]);
    const tchain = [['body', 0.3], ...Array.from({ length: TAIL }, (_, i) => ['tail' + i, 0.6 + i * 0.45])];
    rig.add('body', 'magmastone', bumpy(tube(tp, (u) => 0.4 * (1 - u * 0.85), 40, 10), 0.015, 6, 9), {}, { c: ST, skin: chainSkin(tchain, (v) => -v.z) });
    const tsp = [];
    for (let i = 1; i < TAIL; i++) tsp.push(xf(G.cone(0.05, 0.22 - i * 0.015, 4), { y: 0.12 - i * 0.025 + 0.4 * (1 - (i / TAIL) * 0.85) - 0.03, z: -0.4 - i * 0.45, rx: -0.6 }));
    rig.add('body', 'stone', mergeRaw(tsp), {}, { c: [0.6, 0.55, 0.5], skin: chainSkin(tchain, (v) => -v.z) });
    rig.add('tail7', 'stone', mergeRaw([xf(G.cone(0.14, 0.6, 4), { z: -0.35, rx: -Math.PI / 2, sx: 1.6, sy: 0.25 }), xf(G.cone(0.06, 0.3, 4), { x: 0.15, z: -0.1, rx: -Math.PI / 2, rz: 0.8, sy: 0.3 }), xf(G.cone(0.06, 0.3, 4), { x: -0.15, z: -0.1, rx: -Math.PI / 2, rz: -0.8, sy: 0.3 })]), {}, { c: [0.6, 0.55, 0.5] });
    rig.socket('muzzle', 'head', 0, -0.05, 0.62);
    return {};
  },
  pose(m, s, P, dt) {
    const T = m.time, st = m.state, anim = s.anim, p = s.progress, at = s.attackType;
    let rate = 9;
    const dead = anim === 'death';
    const fly = (at === 'fly' && anim !== 'death' && anim !== 'stagger') || (m._flyForce && !dead);
    m._flying = fly;
    st.flyW = (st.flyW ?? 0) + ((fly ? 1 : 0) - (st.flyW ?? 0)) * (1 - Math.exp(-2.5 * dt));
    const fw = st.flyW;
    const spd = dead ? 0 : s.speed;
    if (spd > 0.01 && fw < 0.5) st.phase += (TAU * spd * dt) / 3.2;
    const mw = smooth(0.05, 0.6, spd) * (1 - fw);
    st.moveW = (st.moveW ?? 0) + (mw - (st.moveW ?? 0)) * (1 - Math.exp(-6 * dt));
    const w = st.moveW, ph = st.phase, sn = Math.sin(ph), cs = Math.cos(ph);
    const br = Math.sin(T * 1.1);
    // stance: digitigrade legs
    for (const [S, sd] of [['L', 1], ['R', -1]]) {
      const sw = sd * sn;
      P.r('thigh' + S, -0.55 - sw * 0.45 * w, 0, sd * 0.08);
      P.r('shin' + S, 1.15 + Math.max(0, sd * cs) * 0.6 * w, 0, 0);
      P.r('foot' + S, -0.6 - Math.max(0, sd * cs) * 0.3 * w, 0, 0);
    }
    P.p('body', 0, -Math.abs(cs) * 0.08 * w + br * 0.02, 0);
    P.r('body', 0.03 * w, sn * 0.06 * w, cs * 0.05 * w);
    P.sc('chest', 1 + br * 0.025, 1 + br * 0.03, 1);
    // neck & head idle sway, tail sway
    for (let i = 0; i < NECK; i++) P.r('neck' + i, 0.05 + Math.sin(T * 0.7 - i * 0.5) * 0.04 + (w * 0.06), Math.sin(T * 0.4 - i * 0.4) * 0.08, 0);
    P.r('head', 0.25 + Math.sin(T * 0.9) * 0.05, Math.sin(T * 0.33) * 0.2, 0);
    P.r('jaw', 0.06 + Math.max(0, Math.sin(T * 0.8)) * 0.06);
    for (let i = 0; i < TAIL; i++) P.r('tail' + i, -0.02 + (i > 3 ? 0.04 : 0), Math.sin(T * 0.9 - i * 0.6) * 0.08 + sn * 0.12 * w * (i / TAIL), 0);
    // wings folded on the ground, spread & flapping in the air
    st.flap = (st.flap ?? 0) + dt * lerp(1.5, 5.5, fw);
    flapWings(P, st.flap, lerp(0.05, 0.75, fw), lerp(0.25, 0.1, fw), lerp(0.85, 0, fw));
    if (fw > 0.01) {
      P.p('base', 0, fw * (2.6 + Math.sin(st.flap) * 0.18), 0);
      for (const S of ['L', 'R']) { P.r('thigh' + S, 0.9 * fw); P.r('shin' + S, 0.5 * fw); P.r('foot' + S, 0.6 * fw); }
      for (let i = 0; i < NECK; i++) P.r('neck' + i, 0.15 * fw);
      for (let i = 0; i < TAIL; i++) P.r('tail' + i, 0.02 * fw);
      P.r('body', 0.15 * fw);
    }
    const crk = m.U.uCrack.value;
    let crackK = 1 + Math.sin(T * 2) * 0.1;
    if (anim === 'windup' || anim === 'attack' || anim === 'cast') {
      const wu = anim === 'windup';
      rate = wu ? 8 : 18;
      if (at === 'breath' || anim === 'cast') {
        if (wu) { for (let i = 0; i < NECK; i++) P.r('neck' + i, -0.22 * p); P.r('head', -0.3 * p); P.r('jaw', 0.25 * p); P.sc('chest', 1 + 0.12 * p, 1 + 0.1 * p, 1); m.setOrb(0.25 + 0.6 * p); crackK = 1 + p * 1.5; }
        else { for (let i = 0; i < NECK; i++) P.r('neck' + i, 0.12, Math.sin(T * 3) * 0.08); P.r('head', 0.15); P.r('jaw', 0.75); m.setOrb(anim === 'cast' ? 1 : 1 - smooth(0.85, 1, p)); crackK = 2.2; }
      } else if (at === 'slam') {
        if (wu) { P.r('body', -0.45 * p); P.p('body', 0, 0.25 * p, -0.2 * p); for (let i = 0; i < NECK; i++) P.r('neck' + i, -0.1 * p); flapWings(P, 0.5, 0, 0.7 * p, -0.8 * p); }
        else { const k = smooth(0, 0.25, p) * (1 - smooth(0.6, 1, p)); P.r('body', 0.3 * k); P.p('body', 0, -0.35 * k, 0.5 * k); for (let i = 0; i < NECK; i++) P.r('neck' + i, 0.12 * k); P.r('jaw', 0.6 * k); }
      } else if (at === 'sweep') {
        if (wu) { P.r('base', 0, 0.7 * p, 0); for (let i = 0; i < TAIL; i++) P.r('tail' + i, 0, 0.12 * p, 0); P.r('head', 0, -0.5 * p, 0); }
        else { const k = easeInOut(clamp(p / 0.55)); P.r('base', 0, 0.7 - k * 3.2 + smooth(0.55, 1, p) * 2.5, 0); for (let i = 0; i < TAIL; i++) P.r('tail' + i, 0, 0.18 * bump(0, 0.6, p), 0); }
      } else if (at === 'roar') {
        const k = wu ? p * 0.4 : bump(0, 1, p);
        for (let i = 0; i < NECK; i++) P.r('neck' + i, -0.18 * k); P.r('head', -0.4 * k); P.r('jaw', 0.9 * k);
        flapWings(P, st.flap, 0.1, 0.9 * k, -0.9 * k);
        P.r('head', Math.sin(T * 40) * 0.03 * k, Math.sin(T * 33) * 0.04 * k); crackK = 1 + k * 1.2;
      }
    } else if (anim === 'stagger') {
      const k = s.t < 0.08 ? s.t / 0.08 : Math.exp(-(s.t - 0.08) * 4);
      P.r('body', -0.2 * k, 0.15 * k, 0.1 * k); for (let i = 0; i < NECK; i++) P.r('neck' + i, -0.12 * k, 0.1 * k); rate = 22;
    } else if (dead) {
      const a = smooth(0, 0.5, p), b = smooth(0.3, 0.9, p);
      P.p('body', 0, -1.15 * b - 0.3 * a, 0); P.r('body', 0.1 * a, 0, 0.35 * b);
      for (const S of ['L', 'R']) { P.r('thigh' + S, -0.9 * a); P.r('shin' + S, 0.9 * a); }
      for (let i = 0; i < NECK; i++) P.r('neck' + i, 0.25 * b, 0.12 * b, 0);
      P.r('head', 0.2 * b, 0.3 * b, 0.6 * b); P.r('jaw', 0.5 * b);
      flapWings(P, 0, 0, -0.2 * b, 0.7 + 0.3 * b);
      crackK = 1 - smooth(0.4, 1, p) * 0.95;
      rate = 8;
    } else if (anim === 'spawn') {
      const e = easeOut(p);
      P.p('base', 0, 6 * (1 - e), 0);
      flapWings(P, T * 6, 0.8 * (1 - smooth(0.7, 1, p)), 0.1, 0);
      for (const S of ['L', 'R']) { P.r('thigh' + S, -0.3 * (1 - p)); }
      rate = 12;
    }
    crk.copy(_magma).multiplyScalar(3.5 * crackK);
    return rate;
  },
};

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
    const mask = new THREE.SphereGeometry(0.1, 16, 12, -Math.PI * 0.42, Math.PI * 0.84, Math.PI * 0.12, Math.PI * 0.72);
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
    rig.add('crown', 'glow', mergeRaw([0, 3, 6].map((i) => xf(G.oct(0.022), { x: Math.sin((i + 0.5) / 9 * TAU) * 0.165, z: Math.cos((i + 0.5) / 9 * TAU) * 0.17, y: 0.03 }))), {}, { c: HDR(HOLLOW, 4) });
    rig.add('crown', 'spirit', xf(G.tor(0.18, 0.02, 4, 24), { rx: Math.PI / 2 }), { y: 0.06 }, { c: HDR(HOLLOW, 0.4) });
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
