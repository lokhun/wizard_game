import * as THREE from 'three';
import { G, xf, taper, lathe, tube, deform, bumpy, shaggy, robe, mergeRaw, chainSkin, spikeRing, rng, vnoise, fbm3, clamp, lerp, smooth, bump, easeOut, easeIn, easeInOut, TAU } from './core.js';
import { twoSided, HDR, RUSTY } from './parts.js';
import { skullGeo } from '../../world/props.js';
import { wounds, strikeLayer } from './bossKit.js';
import { addFx, fxOf, fxSet, fxPos, softRing, softDisc, softColumn, Rope, aimChain, boneWorld, setBone, glowLevel, polyParam } from './bossKit.js';

// ============================================================ Mother of Filth ==
// A bloated brood-queen of the sewers: a heaving translucent bile sac with a rotting
// flesh core, a beating heart and half-digested corpses inside, a clutch of glowing
// eggs and corpse-ribs on her back, rusted chains dragging into her sludge pool,
// eight writhing tentacles and, on a thick neck, a huge many-eyed rat skull wearing
// a corroded crown, drooling strands of filth.
//
// Bones: base (sinks for submerge / spawn), pool (root level: stays on the floor),
// mass -> heart, eggs, emb0-3, neck0 -> neck1 -> head -> jaw / crown, tentacles
// t{0-7}_{0-7} on base, two chains on the back ribs (rope-simulated), drool strands
// on the jaw (rope-simulated), falling drops and pool bubbles on pool.

const FILTH = 0x9bff3a;
const TENT = [[0.85, 2.0, 1.45, 3.6, 0.32, 1], [-0.85, 2.0, 1.45, 3.6, 0.32, 1], [2.3, 2.1, 1.3, 3.1, 0.28, 1], [-2.3, 2.1, 1.3, 3.1, 0.28, 1], [0.32, 0.45, 2.0, 2.5, 0.2, 0], [-0.32, 0.45, 2.0, 2.5, 0.2, 0], [1.55, 0.45, 2.15, 2.7, 0.21, 0], [-1.55, 0.45, 2.15, 2.7, 0.21, 0]];
const TSEG = 8;
const CHAIN_N = 6, CHAIN_L = 0.27, STR_N = 4, STR_L = 0.16;
const CHAINS = [[0.55, 3.0, -1.1], [-0.75, 2.75, -1.25]]; // anchor points on the back ribs (mass space)
const STRANDS = [[0.1, -0.13, 0.62], [-0.13, -0.12, 0.5]]; // drool strand roots on the jaw
const NBUB = 6, NDROP = 3, HS = 1.55;
const NECK = [[0, 2.55, 1.15], [0, 0.45, 0.32], [0, 0.38, 0.32]]; // neck0 (mass space), neck1, head offsets

function tentCurve(t, u, out = new THREE.Vector3()) {
  const [a, y, r, L, , big] = TENT[t];
  const fx = Math.sin(a), fz = Math.cos(a), sx = Math.cos(a), sz = -Math.sin(a);
  const sd = t % 2 ? -1 : 1;
  out.set(fx * r, y, fz * r);
  if (big) {
    const f = L * 0.55 * u, up = L * 0.62 * Math.sin(u * Math.PI * 0.78), s = sd * L * 0.12 * Math.sin(u * Math.PI * 1.6);
    return out.set(out.x + fx * f + sx * s, out.y + up, out.z + fz * f + sz * s);
  }
  const f = L * 0.9 * u, up = -y * 0.85 * Math.sin(Math.min(1, u * 1.6) * Math.PI / 2) + L * 0.06 * Math.sin(u * Math.PI * 2.2), s = sd * L * 0.18 * Math.sin(u * Math.PI * 1.3);
  return out.set(out.x + fx * f + sx * s, out.y + up, out.z + fz * f + sz * s);
}
const tentRad = (t, u) => TENT[t][4] * (1 - 0.9 * Math.pow(u, 0.85)) + 0.014;

// bruised, mottled flesh colour
function fleshC(v, seed, base = [0.34, 0.2, 0.2], vein = [0.12, 0.05, 0.08]) {
  const n = fbm3(v.x * 2.5, v.y * 2.5, v.z * 2.5, seed, 3), d = vnoise(v.x * 14, v.y * 14, v.z * 14, seed + 3);
  const vn = Math.abs(vnoise(v.x * 4 + 7, v.y * 4, v.z * 4, seed + 9) - 0.5) < 0.03 ? 1 : 0;
  const k = 0.75 + n * 0.5 + d * 0.15;
  return [lerp(base[0] * k, vein[0], vn * 0.8), lerp(base[1] * k, vein[1], vn * 0.8), lerp(base[2] * k, vein[2], vn * 0.8)];
}

export const motherOfFilth = {
  lookAt: 0, recoil: 0, // (its own rig: the head turns on other axes; see EnemyInstance._layers)
  look: { bones: [['neck0', 0.3], ['neck1', 0.3], ['head', 0.4]], yaw: 0.9, pitch: 0.45, offAt: ['submerge'] }, // (her eyes on her foe: EnemyInstance._lookWorld)
  id: 'motherOfFilth', height: 4.6, radius: 2.4, boss: true, eyeColor: FILTH, magicColor: FILTH, defaultAttack: 'slam', attackTypes: ['slam', 'spit', 'summon', 'submerge', 'tide', 'pound', 'ripple', 'belch'], wobble: true, orbSize: 0.3, length: 5, flutter: 0.04,
  build(rig) {
    rig.bone('base', null);
    rig.bone('pool', null);
    rig.bone('mass', 'base', 0, 0, 0, { rate: 0.8 });
    rig.bone('heart', 'mass', 0, 1.55, 0.35);
    rig.bone('eggs', 'mass', 0, 2.85, -0.75, { rate: 0.7 });
    for (let i = 0; i < 4; i++) rig.bone('emb' + i, 'mass', 0, 1.5, 0);
    rig.bone('neck0', 'mass', ...NECK[0], { rate: 0.85 });
    rig.bone('neck1', 'neck0', ...NECK[1], { rate: 0.8 });
    rig.bone('head', 'neck1', ...NECK[2], { rate: 0.75 });
    rig.bone('jaw', 'head', 0, -0.1 * HS, 0.12 * HS);
    rig.bone('throat', 'head', 0, -0.28 * HS, 0.12 * HS);
    rig.bone('crown', 'head', 0, 0.36 * HS, 0.0, { rate: 0.55 });
    TENT.forEach((_, t) => {
      let prev = 'base';
      const last = new THREE.Vector3(), p = new THREE.Vector3();
      for (let k = 0; k < TSEG; k++) {
        tentCurve(t, k / TSEG, p);
        rig.bone(`t${t}_${k}`, prev, p.x - last.x, p.y - last.y, p.z - last.z, { rate: 0.75 - k * 0.035 });
        prev = `t${t}_${k}`; last.copy(p);
      }
    });
    CHAINS.forEach(([x, y, z], c) => { let prev = 'mass'; for (let i = 0; i < CHAIN_N; i++) { rig.bone(`ch${c}_${i}`, prev, i ? 0 : x, i ? -CHAIN_L : y, i ? 0 : z); prev = `ch${c}_${i}`; } });
    STRANDS.forEach(([x, y, z], c) => { let prev = 'jaw'; for (let i = 0; i < STR_N; i++) { rig.bone(`st${c}_${i}`, prev, i ? 0 : x * HS, i ? -STR_L : y * HS, i ? 0 : z * HS); prev = `st${c}_${i}`; } });
    for (let i = 0; i < NBUB; i++) rig.bone('bub' + i, 'pool', 0, 0, 0);
    for (let i = 0; i < NDROP; i++) rig.bone('drop' + i, null, 0, 0, 0);

    // ---- the sac: heaving translucent membrane, olive with dark veins and bile-yellow blooms
    const g = G.sph(2.0, 48, 32);
    deform(g, (v) => {
      v.y = (v.y + 2.0) * 0.86;
      const n = vnoise(v.x * 1.2 + 4, v.y * 1.2, v.z * 1.2, 5) - 0.5;
      let k = 1 + n * 0.3 + (vnoise(v.x * 3, v.y * 3, v.z * 3, 8) - 0.5) * 0.06;
      if (v.y < 0.9) k *= 1 + (0.9 - v.y) * 0.24;
      v.x *= k * 1.05; v.z *= k;
      if (v.z > 0.5 && v.y > 2.2) v.z += (v.y - 2.2) * 0.3;
    });
    rig.add('mass', 'slime', g, {}, {
      anim: (v) => smooth(0.1, 1.2, v.y),
      cfn: (v) => {
        const k = 0.45 + v.y * 0.13;
        const n = fbm3(v.x * 1.6, v.y * 1.6, v.z * 1.6, 2, 3);
        const vein = Math.abs(vnoise(v.x * 2.2, v.y * 2.2, v.z * 2.2, 21) - 0.5) < 0.035 ? 1 : 0;
        if (vein) return [0.05, 0.06, 0.02];
        if (n > 0.62) return [0.42 * k, 0.4 * k, 0.08 * k];
        return [0.13 * k, 0.32 * k, 0.07 * k];
      },
    });
    // inner flesh core seen through the sac: lumpy, dark, veined
    const core = G.sph(1.45, 36, 24);
    deform(core, (v) => { v.y = (v.y + 1.45) * 0.78 + 0.25; v.x *= 1.05; const n = fbm3(v.x * 1.4, v.y * 1.4, v.z * 1.4, 31, 3) - 0.5; v.multiplyScalar(1 + n * 0.35); });
    rig.add('mass', 'skin', core, {}, { cfn: (v) => fleshC(v, 41, [0.15, 0.07, 0.09], [0.04, 0.015, 0.035]) });
    // the heart: glowing, beating (glow core in a fleshy cage)
    rig.add('heart', 'glow', bumpy(G.sph(0.24, 14, 10), 0.03, 7, 3), { sy: 1.15 }, { c: HDR(0xb8ff40, 1.5) });
    rig.add('heart', 'spirit', G.sph(0.5, 14, 10), {}, { c: HDR(FILTH, 0.07) });
    rig.add('heart', 'skin', mergeRaw([0, 1, 2, 3, 4].map((i) => { const a = (i / 5) * TAU; return tube([[Math.cos(a) * 0.1, 0.3, Math.sin(a) * 0.1], [Math.cos(a) * 0.32, 0.05, Math.sin(a) * 0.32], [Math.cos(a + 0.4) * 0.26, -0.25, Math.sin(a + 0.4) * 0.26], [Math.cos(a + 0.6) * 0.05, -0.4, Math.sin(a + 0.6) * 0.05]], (u) => 0.035 * (1 - u * 0.5), 10, 4); })), {}, { c: [0.5, 0.15, 0.13] });

    // half-digested debris drifting inside
    rig.add('emb0', 'bone', mergeRaw([skullGeo(), xf(skullGeo(), { x: 0.4, y: -0.3, ry: 1.5 })]), { s: 2.6 }, { c: [1.1, 1.05, 0.85] });
    const ribs = [];
    for (let i = 0; i < 6; i++) ribs.push(xf(G.tor(0.32 - Math.abs(i - 2.5) * 0.03, 0.03, 5, 14, Math.PI * 1.2), { y: i * 0.12, rx: 1.4, rz: 0.3 }));
    rig.add('emb1', 'bone', mergeRaw(ribs), {}, { c: [1.0, 0.95, 0.8] });
    rig.add('emb2', 'bone', mergeRaw([xf(G.cyl(0.045, 0.045, 0.9, 6), { rz: 1.0 }), xf(G.cyl(0.04, 0.04, 0.8, 6), { rz: -0.4, x: 0.3, y: 0.3 }), xf(G.sph(0.08, 6, 5), { x: 0.39, y: 0.25 })]), {}, { c: [1.0, 0.95, 0.8] });
    rig.add('emb3', 'iron', mergeRaw([xf(G.box(0.1, 1.1, 0.02), { rz: 0.8 }), xf(G.box(0.3, 0.05, 0.05), { rz: 0.8, x: -0.35, y: -0.35 })]), {}, { c: RUSTY });
    rig.add('emb3', 'iron', xf(G.sph(0.25, 12, 8, 0, TAU, 0, Math.PI / 2), { x: 0.5, y: 0.2, rx: 0.8 }), {}, { c: RUSTY });

    // surface point on the sac at angle a, height y (mass space), pushed out by off
    const sacR = (y) => 2.0 * Math.sqrt(Math.max(0.03, 1 - ((y / 0.86 - 2.0) / 2.0) ** 2)) * 1.05;
    const surf = (a, y, off = 0) => { const r = sacR(y) + off; return new THREE.Vector3(Math.sin(a) * r * 1.03, y, Math.cos(a) * r); };
    // pustules and fungal crust
    const R = rng(33);
    const pg = [], pc = [], fung = [];
    for (let i = 0; i < 22; i++) {
      const a = R() * TAU, y = 0.3 + R() * 2.5;
      const p = surf(a, y, 0.02);
      const s = 0.05 + R() * 0.1;
      pc.push(xf(G.sph(s, 6, 5), { x: p.x, y: p.y, z: p.z }));
      pg.push(xf(G.sph(s * 0.55, 6, 5), { x: p.x * 1.035, y: p.y, z: p.z * 1.035 }));
    }
    for (let i = 0; i < 16; i++) {
      // shelf fungus around the lower body
      const a = R() * TAU, y = 0.25 + R() * 0.9;
      const p = surf(a, y, -0.03);
      const sh = lathe([[0.001, 0.02], [0.16 + R() * 0.12, 0.0], [0.12, -0.035], [0.001, -0.02]], 8);
      fung.push(xf(sh, { x: p.x, y: p.y, z: p.z, ry: a, rx: 0.4, sz: 0.7 }));
    }
    rig.add('mass', 'skin', mergeRaw(pc), {}, { c: [0.5, 0.58, 0.22] });
    rig.add('mass', 'glow', mergeRaw(pg), {}, { c: HDR(FILTH, 2.6) });
    rig.add('mass', 'skin', mergeRaw(fung), {}, { cfn: (v) => { const k = 0.7 + vnoise(v.x * 9, v.y * 9, v.z * 9, 4) * 0.6; return [0.55 * k, 0.48 * k, 0.3 * k]; } });
    // corpse-ribs bursting from the back: a crest of curved bone
    const rb = [];
    for (let i = 0; i < 7; i++) {
      const sd = i % 2 ? -1 : 1, a = Math.PI + sd * (0.25 + (i >> 1) * 0.28), y = 2.45 - (i >> 1) * 0.28;
      const p0 = surf(a, y, -0.25), out = surf(a, y + 0.5, 0.7);
      const tip = surf(a + sd * 0.15, y + 1.0 - (i >> 1) * 0.12, 0.55);
      rb.push(tube([p0, out.clone().lerp(p0, 0.4).add(new THREE.Vector3(0, 0.3, 0)), out, tip], (u) => 0.085 * (1 - u * 0.75), 14, 6));
    }
    rig.add('mass', 'bone', mergeRaw(rb), {}, { cfn: (v) => { const k = 0.6 + vnoise(v.x * 8, v.y * 8, v.z * 8, 2) * 0.5; return [0.95 * k, 0.88 * k, 0.68 * k]; } });
    // embedded hooks and rusted shackles the chains hang from
    rig.add('mass', 'iron', mergeRaw(CHAINS.map(([x, y, z]) => xf(G.tor(0.09, 0.025, 5, 12), { x, y: y + 0.05, z, rx: 0.4 }))), {}, { c: RUSTY });

    // ---- egg clutch on the back: translucent sacs with curled glowing larvae inside
    const eg = [], ev = [], emb = [];
    const RE = rng(7);
    for (let i = 0; i < 11; i++) {
      const a = (i / 11) * TAU * 1.3, r = 0.15 + RE() * 0.45, s = 0.17 + RE() * 0.15;
      const p = { x: Math.cos(a) * r * 1.2, y: Math.sin(i * 2.3) * 0.18 + RE() * 0.2, z: Math.sin(a) * r * 0.8 };
      eg.push(xf(G.sph(s, 10, 7), { ...p, sy: 1.18, rz: (RE() - 0.5) * 0.6 }));
      emb.push(xf(G.tor(s * 0.4, s * 0.16, 5, 8, Math.PI * 1.5), { ...p, rx: RE() * 3, ry: RE() * 3 }));
      ev.push(xf(G.sph(s * 1.08, 8, 6, 0, TAU, Math.PI * 0.55, Math.PI * 0.45), p));
    }
    rig.add('eggs', 'slime', mergeRaw(eg), {}, { c: [0.3, 0.42, 0.14], anim: 0.6 });
    rig.add('eggs', 'glow', mergeRaw(emb), {}, { c: HDR(0xa8ff40, 0.9) });
    rig.add('eggs', 'skin', mergeRaw(ev), {}, { c: [0.32, 0.22, 0.16] });

    // ---- tentacles: one tapered tube per tentacle, skinned smoothly along its 8-bone chain;
    // bruised mottled back, pale ribbed underside with two rows of suckers, hooked barbs on the big ones
    const UP = new THREE.Vector3(0, 1, 0);
    TENT.forEach((def, t) => {
      const [a, , , , R0, big] = def;
      const inward = new THREE.Vector3(-Math.sin(a), 0, -Math.cos(a));
      const N = 64, samp = [];
      for (let i = 0; i <= N; i++) {
        const u = i / N, p = tentCurve(t, u);
        const tg = tentCurve(t, Math.min(1, u + 0.01)).sub(tentCurve(t, Math.max(0, u - 0.01))).normalize();
        const dn = new THREE.Vector3(0, -1, 0).addScaledVector(inward, big ? 0.6 : 0.2);
        const n = dn.addScaledVector(tg, -tg.dot(dn)).normalize();
        samp.push({ u, p, tg, n, rad: tentRad(t, u) });
      }
      const nearest = (v) => { let b = samp[0], bd = 1e9; for (const sm of samp) { const d = v.distanceToSquared(sm.p); if (d < bd) { bd = d; b = sm; } } return b; };
      const chain = [['base', -0.6], ...Array.from({ length: TSEG }, (_, k) => [`t${t}_${k}`, k])];
      const skin = chainSkin(chain, (v) => nearest(v).u * TSEG);
      const geo = tube(samp.filter((_, i) => i % 4 === 0).map((sm) => sm.p), (u) => tentRad(t, u), 36, 8);
      deform(geo, (v) => { const sm = nearest(v); const d = v.clone().sub(sm.p); const k = 1 + Math.sin(sm.u * 70) * 0.045 + (vnoise(v.x * 5, v.y * 5, v.z * 5, t) - 0.5) * 0.14; v.copy(sm.p).addScaledVector(d, k); });
      rig.add('base', 'skin', geo, {}, {
        skin,
        cfn: (v) => {
          const sm = nearest(v); const under = v.clone().sub(sm.p).normalize().dot(sm.n);
          const n = fbm3(v.x * 3, v.y * 3, v.z * 3, t + 3, 3);
          const spot = vnoise(v.x * 9, v.y * 9, v.z * 9, t + 11) > 0.68 ? 0.55 : 1;
          const band = 0.85 + 0.15 * Math.sin(sm.u * 70);
          const top = [(0.2 + n * 0.12) * spot, (0.16 + n * 0.08) * spot, (0.17 + n * 0.06) * spot], bot = [0.78, 0.55, 0.45];
          const k = smooth(-0.1, 0.6, under);
          const tip = smooth(0.75, 1, sm.u);
          return [lerp(top[0], bot[0], k) * band * (1 - tip * 0.4) + tip * 0.08, lerp(top[1], bot[1], k) * band * (1 - tip * 0.4) + tip * 0.12, lerp(top[2], bot[2], k) * band * (1 - tip * 0.4)];
        },
      });
      const su = [], sc = [];
      for (let i = 0; i < 10; i++) {
        const u = 0.1 + i * 0.085;
        const sm = samp[Math.round(u * N)];
        const b = new THREE.Vector3().crossVectors(sm.tg, sm.n).normalize();
        for (const row of [-1, 1]) {
          if ((i + (row > 0 ? 1 : 0)) % 2) continue;
          const dir = sm.n.clone().multiplyScalar(Math.cos(0.5)).addScaledVector(b, row * Math.sin(0.5)).normalize();
          const pos = sm.p.clone().addScaledVector(dir, sm.rad * 0.9);
          const e = new THREE.Euler().setFromQuaternion(new THREE.Quaternion().setFromUnitVectors(UP, dir));
          const r = sm.rad * 0.38;
          su.push(xf(xf(G.tor(r * 0.72, r * 0.3, 3, 6), { rx: Math.PI / 2, sy: 0.7 }), { x: pos.x, y: pos.y, z: pos.z, rx: e.x, ry: e.y, rz: e.z }));
          sc.push(xf(xf(G.sph(r * 0.6, 5, 2, 0, TAU, 0, Math.PI / 2), { sy: -0.45 }), { x: pos.x, y: pos.y, z: pos.z, rx: e.x, ry: e.y, rz: e.z }));
        }
      }
      rig.add('base', 'skin', mergeRaw(su), {}, { c: [0.95, 0.62, 0.55], skin });
      rig.add('base', 'dark', mergeRaw(sc), {}, { c: [4, 1.2, 1.4], skin });
      if (big) {
        // a barbed, faintly glowing hook at the tip
        const sm = samp[N - 2];
        const hook = tube([sm.p.clone().addScaledVector(sm.tg, -0.1), sm.p.clone().addScaledVector(sm.tg, 0.12).addScaledVector(sm.n, 0.03), sm.p.clone().addScaledVector(sm.tg, 0.24).addScaledVector(sm.n, 0.16)], (u) => 0.05 * (1 - u * 0.9), 8, 5);
        rig.add('base', 'bone', hook, {}, { c: [0.35, 0.3, 0.22], skin });
        rig.add('base', 'glow', xf(G.sph(0.035, 6, 5), { x: sm.p.x, y: sm.p.y, z: sm.p.z }), {}, { c: HDR(FILTH, 2.5), skin });
      }
    });

    // ---- rusted chains dragged behind (rope-driven)
    CHAINS.forEach((_, c) => {
      for (let i = 0; i < CHAIN_N; i++) {
        const links = [];
        for (let k = 0; k < 3; k++) links.push(xf(G.tor(0.055, 0.016, 3, 6), { y: -k * 0.09 - 0.04, sy: 1.4, ry: (k % 2) * Math.PI / 2 }));
        rig.add(`ch${c}_${i}`, 'iron', mergeRaw(links), {}, { c: RUSTY });
      }
    });

    // ---- neck: thick, ringed, wet
    const np = [new THREE.Vector3(0, 0, 0)], acc = new THREE.Vector3();
    np[0].set(0, -0.45, -0.35);
    for (let i = 1; i < NECK.length; i++) { acc.add(new THREE.Vector3(...NECK[i])); np.push(acc.clone()); }
    np.push(acc.clone().add(new THREE.Vector3(0, 0.02, 0.15)));
    const along = polyParam(np);
    const neckG = tube(np, (u) => lerp(0.7, 0.42, u) * (1 + Math.sin(u * 40) * 0.04), 24, 14);
    rig.add('neck0', 'skin', bumpy(neckG, 0.03, 4, 7), {}, { cfn: (v) => fleshC(v, 12, [0.4, 0.26, 0.22]), skin: chainSkin([['mass', 0.3], ['neck0', 0.9], ['neck1', 1.8], ['head', 2.7]], along) });

    // ---- the head: a huge many-eyed rat skull (built at 1:1, scaled up by HS below)
    const headP0 = rig.parts.length;
    const BONEC = (v) => { const n = vnoise(v.x * 9, v.y * 9, v.z * 9, 3), d = fbm3(v.x * 3, v.y * 3, v.z * 3, 8, 2); const k = 0.85 + n * 0.3 + d * 0.35; const dirt = smooth(0.58, 0.78, d); return [lerp(1.25, 0.5, dirt) * k, lerp(1.18, 0.48, dirt) * k, lerp(0.98, 0.26, dirt) * k]; };
    const cran = G.sph(0.34, 26, 18);
    deform(cran, (v) => {
      v.x *= 0.92; v.y *= 0.82;
      if (v.z > 0) { const t = clamp(v.z / 0.34); v.z += t * t * 0.62; const k = 1 - t * 0.62; v.x *= k; v.y = v.y * (1 - t * 0.45) - t * t * 0.05; }
      if (v.z < -0.1) v.y += (-0.1 - v.z) * 0.25;
      // sockets
      for (const [ex, ey, ez, r, dep] of [[0.19, 0.08, 0.22, 0.09, 0.07], [0.12, 0.17, 0.36, 0.05, 0.035], [0.22, -0.02, 0.08, 0.05, 0.03]]) {
        const d2 = (Math.abs(v.x) - ex) ** 2 + (v.y - ey) ** 2 + (v.z - ez) ** 2;
        if (d2 < r * r * 2.5) { const k = Math.exp(-d2 / (r * r * 0.8)); v.x -= Math.sign(v.x) * k * dep * 0.6; v.z -= k * dep * 0.5; }
      }
      // brow ridge + sagittal crest
      v.y += Math.exp(-((v.x) ** 2) / 0.002) * smooth(-0.1, 0.25, v.z) * smooth(0.0, 0.2, v.y) * 0.05;
    });
    rig.add('head', 'bone', bumpy(cran, 0.012, 9, 5), {}, { cfn: BONEC });
    // cheek arches
    rig.pair('head', 'head', 'bone', tube([[0.26, -0.02, -0.05], [0.29, -0.06, 0.15], [0.2, -0.1, 0.38]], (u) => 0.045 * (1 - u * 0.4), 10, 6), {}, { cfn: BONEC });
    // eyes: one big pair and two small pairs, deep sockets with glowing irises
    const eyes = [[0.18, 0.08, 0.2, 0.075], [0.115, 0.165, 0.34, 0.042], [0.22, -0.01, 0.06, 0.04]];
    for (const [x, y, z, r] of eyes) {
      rig.pair('head', 'head', 'dark', G.sph(r, 10, 8), { x, y, z });
      rig.pair('head', 'head', 'glow', xf(G.sph(r * 0.62, 10, 8), { sy: 0.8 }), { x: x * 1.04, y, z: z + r * 0.4 }, { c: HDR(0xc8ff50, 12) });
    }
    // nostrils, incisors, molar rows
    rig.pair('head', 'head', 'dark', xf(G.sph(0.025, 6, 5), { sz: 0.6 }), { x: 0.035, y: -0.04, z: 0.93 });
    const inc = (sd, y0, z0, dy, dz, r) => tube([[sd * 0.04, y0, z0], [sd * 0.045, y0 + dy * 0.5, z0 + dz * 0.6], [sd * 0.03, y0 + dy, z0 + dz * 0.4]], (u) => r * (1 - u * 0.75), 10, 6);
    rig.add('head', 'bone', mergeRaw([inc(1, -0.12, 0.88, -0.34, 0.14, 0.035), inc(-1, -0.12, 0.88, -0.34, 0.14, 0.035)]), {}, { c: [1.35, 1.0, 0.42] });
    const mol = [];
    for (let i = 0; i < 5; i++) for (const sd of [-1, 1]) mol.push(xf(G.cone(0.025, 0.07, 4), { x: sd * (0.11 - i * 0.012), y: -0.16, z: 0.32 + i * 0.075, rx: Math.PI }));
    rig.add('head', 'bone', mergeRaw(mol), {}, { c: [0.8, 0.7, 0.45] });
    // a matted, rotting mane over the back of the skull and down the nape
    const mane = G.sph(0.36, 20, 12, 0, TAU, 0, Math.PI * 0.62);
    deform(mane, (v) => { v.z = v.z * 1.25 - 0.12; v.x *= 0.95; if (v.z > 0.05) v.multiplyScalar(1 - smooth(0.05, 0.3, v.z) * 0.25); });
    rig.add('head', 'skin', shaggy(mane, 0.09, 12, 5, [0, -0.3, -1], 0.9), { y: 0.02, rx: -0.35 }, { cfn: (v) => { const n = vnoise(v.x * 10, v.y * 10, v.z * 10, 3); const k = 0.5 + n * 0.5; return [0.26 * k, 0.21 * k, 0.17 * k]; }, anim: (v) => clamp(-v.z * 2) * 0.4 }); // matted hide on the flesh material (no extra shader)
    const ear = twoSided(deform(new THREE.CircleGeometry(0.22, 10, 0, Math.PI), (v) => { v.z = (v.x * v.x) * 0.8 + vnoise(v.x * 12, v.y * 12, 0, 3) * 0.04; if (vnoise(v.x * 14, v.y * 14, 2, 9) > 0.7) v.multiplyScalar(0.8); }));
    rig.pair('head', 'head', 'skin', ear, { x: 0.27, y: 0.16, z: -0.12, rx: -0.4, ry: 1.0, rz: -0.6 }, { cfn: (v) => fleshC(v, 9, [0.45, 0.25, 0.25]), anim: 0.4 });
    // jaw: twin mandibles, lower incisors, rotten tongue
    const mand = [];
    for (const sd of [-1, 1]) mand.push(tube([[sd * 0.2, 0.02, -0.02], [sd * 0.18, -0.08, 0.2], [sd * 0.09, -0.12, 0.5], [sd * 0.03, -0.11, 0.72]], (u) => 0.05 * (1 - u * 0.4), 14, 6));
    mand.push(xf(G.box(0.08, 0.05, 0.1), { y: -0.11, z: 0.7 }));
    rig.add('jaw', 'bone', mergeRaw(mand), {}, { cfn: BONEC });
    rig.add('jaw', 'bone', mergeRaw([inc(1, -0.09, 0.72, 0.22, 0.12, 0.028), inc(-1, -0.09, 0.72, 0.22, 0.12, 0.028)]), {}, { c: [1.3, 0.95, 0.4] });
    rig.add('jaw', 'skin', tube([[0, -0.07, 0.05], [0, -0.06, 0.3], [0.02, -0.05, 0.55], [0.0, -0.1, 0.66]], (u) => 0.07 * (1 - u * 0.5), 12, 6), {}, { c: [0.55, 0.12, 0.14] });
    rig.add('jaw', 'glow', mergeRaw([xf(G.box(0.12, 0.01, 0.45), { y: -0.04, z: 0.35 })]), {}, { c: HDR(FILTH, 1.6) });
    // throat sac: swells before a spit
    rig.add('throat', 'skin', bumpy(xf(G.sph(0.26, 14, 10), { sz: 1.3, sy: 0.8 }), 0.02, 6, 9), { z: 0.05 }, { cfn: (v) => fleshC(v, 17, [0.45, 0.4, 0.22]) });
    rig.add('throat', 'glow', mergeRaw([0, 1, 2, 3].map((i) => xf(G.sph(0.05, 6, 5), { x: Math.sin(i * 1.7) * 0.18, y: -0.12, z: -0.1 + i * 0.1 }))), {}, { c: HDR(FILTH, 1.8) });
    // drool strands (rope-driven chains of slime)
    STRANDS.forEach((_, c) => {
      const L = STR_N * STR_L;
      const sg = tube([[0, 0, 0], [0.01, -L * 0.5, 0], [0, -L, 0]], (u) => 0.025 * (1 - u * 0.55) + (u > 0.9 ? 0.02 : 0), 16, 5);
      rig.add(`st${c}_0`, 'slime', sg, {}, { c: [0.55, 1.1, 0.3], skin: chainSkin(Array.from({ length: STR_N }, (_, i) => [`st${c}_${i}`, -i * STR_L]).reverse(), (v) => v.y) });
    });
    // corroded crown, tilted, with three glowing bile-gems
    rig.add('crown', 'gold', mergeRaw([xf(G.cyl(0.36, 0.33, 0.14, 18, true), {}), spikeRing(0.36, 9, 0.34, 0.06, 0.07, 0.15), xf(G.tor(0.36, 0.02, 4, 20), { rx: Math.PI / 2, y: 0.07 }), xf(G.tor(0.33, 0.018, 4, 20), { rx: Math.PI / 2, y: -0.07 })]), { rz: 0.22, rx: -0.12 }, {
      cfn: (v) => { const n = vnoise(v.x * 14, v.y * 14, v.z * 14, 6); return n > 0.6 ? [0.25, 0.55, 0.3] : [0.85, 0.62, 0.32]; }, // verdigris
    });
    rig.add('crown', 'glow', mergeRaw([0, 3, 6].map((i) => xf(G.oct(0.05), { x: Math.sin(i / 9 * TAU) * 0.37, z: Math.cos(i / 9 * TAU) * 0.37, sy: 1.4 }))), { rz: 0.22, rx: -0.12 }, { c: HDR(0x60ff50, 4) });
    for (let i = headP0; i < rig.parts.length; i++) {
      const pt = rig.parts[i];
      if (!['head', 'jaw', 'throat', 'crown'].includes(pt.bone)) continue;
      const t0 = pt.t;
      pt.t = { ...t0, x: (t0.x ?? 0) * HS, y: (t0.y ?? 0) * HS, z: (t0.z ?? 0) * HS, s: (t0.s ?? 1) * HS };
    }
    rig.socket('muzzle', 'jaw', 0, 0.02 * HS, 0.62 * HS);

    // ---- the sludge pool (stays on the floor while she sinks)
    const pool = G.cyl(3.4, 3.6, 0.06, 48, false, 1);
    deform(pool, (v) => { const n = vnoise(v.x * 1.3, 0, v.z * 1.3, 8); const k = 0.72 + n * 0.45; v.x *= k; v.z *= k; });
    rig.add('pool', 'glow', pool, { y: 0.02 }, { cfn: (v) => { const r = Math.hypot(v.x, v.z); const k = smooth(3.4, 1.0, r); const n = vnoise(v.x * 3, 0, v.z * 3, 4); return [0.008 + k * 0.012 + n * 0.006, 0.012 + k * 0.03 + n * 0.012, 0.004 + n * 0.003]; } });
    const froth = [];
    const RF = rng(91);
    for (let i = 0; i < 44; i++) { const a = RF() * TAU, r = 1.9 + RF() * 0.9; froth.push(xf(G.sph(0.05 + RF() * 0.09, 5, 3), { x: Math.sin(a) * r * 1.05, y: 0.04, z: Math.cos(a) * r, sy: 0.45 })); }
    rig.add('pool', 'skin', mergeRaw(froth), {}, { cfn: (v) => { const k = 0.6 + vnoise(v.x * 6, 0, v.z * 6, 2) * 0.5; return [0.4 * k, 0.5 * k, 0.15 * k]; } });
    for (let i = 0; i < NBUB; i++) rig.add('bub' + i, 'slime', G.sph(0.16, 10, 7, 0, TAU, 0, Math.PI * 0.6), {}, { c: [0.7, 1.0, 0.35] });
    for (let i = 0; i < NDROP; i++) rig.add('drop' + i, 'slime', xf(G.sph(0.05, 6, 5), { sy: 1.8 }), {}, { c: [0.6, 1.2, 0.3] });

    // ---- fx: toxic glow on the pool, an impact / burst ring, a geyser column for submerge / emerge
    addFx(rig, 'pool', 'aura', softDisc(4.4, 32, HDR(FILTH, 0.32), 1.5), { y: 0.07 });
    addFx(rig, 'pool', 'ring', softRing(0.8, 1.0, 48, HDR(FILTH, 1.6), 0.7), { y: 0.1 });
    addFx(rig, 'pool', 'geyser', softColumn(2.2, 2.9, 5, 24, HDR(FILTH, 0.16)), { y: 0 });
    return {};
  },

  onFx(m, kind, extra) {
    const st = m.state;
    if (kind === 'phase') { st.phaseT = m.time; st.phaseN = extra.n ?? 1; if (st.phaseN >= 2) boostGlow(m, 1.6); }
    else if (kind === 'submerge') st.subT = m.time;
    else if (kind === 'emerge') st.emergeT = m.time;
  },

  pose(m, s, P, dt) {
    const T = m.time, anim = s.anim, p = s.progress, at = s.attackType, st = m.state;
    if (st.born === undefined) {
      st.born = T;
      // her sac is murkier and denser than a common slime's (per-instance material tweak)
      for (const e of m.mats) if (e.key === 'slime') { e.opacity = 0.66; if (e.em) e.em.setRGB(0.012, 0.03, 0.006); }
      m._dirty = true;
    }
    const dead = anim === 'death';
    const spd = dead ? 0 : s.speed;
    st.moveW = (st.moveW ?? 0) + (smooth(0.05, 0.6, spd) - (st.moveW ?? 0)) * (1 - Math.exp(-5 * dt));
    const w = st.moveW;
    if (spd > 0) st.phase += dt * spd * 1.6;
    // hit reaction: the sac jiggles where it was struck
    if (m._flash > (st.lastFlash ?? 0) + 0.2) st.hitT = T;
    st.lastFlash = m._flash;
    const hit = st.hitT !== undefined ? Math.exp(-(T - st.hitT) * 6) * (T - st.hitT < 1 ? 1 : 0) : 0;
    const enr = (st.phaseN ?? 0) >= 2 ? 1 : 0;
    let rate = 7;
    // heartbeat: lub-dub, quicker when enraged
    const hb = (T * (0.95 + enr * 0.5)) % 1;
    const beat = bump(0, 0.12, hb) + bump(0.2, 0.34, hb) * 0.7;
    const br = Math.sin(T * 1.3);
    let sy = 1 + br * 0.035 + Math.sin(st.phase * 2) * 0.05 * w - hit * 0.05, sxz = 1 - br * 0.02 + hit * 0.03;
    let wob = 0.09 + w * 0.05 + hit * 0.25;
    let orb = 0, glowK = 1;
    // idle life
    P.r('mass', 0.04 * w + Math.sin(st.phase * 2) * 0.03 * w, Math.sin(T * 0.3) * 0.05, Math.sin(T * 0.5) * 0.02);
    P.p('mass', 0, 0, Math.sin(st.phase * 2 - 0.6) * 0.12 * w);
    P.r('neck0', 0.05 + Math.sin(T * 0.7) * 0.05 + w * 0.1, Math.sin(T * 0.4) * 0.1, Math.sin(T * 0.55) * 0.04);
    P.r('neck1', Math.sin(T * 0.7 - 0.6) * 0.06, Math.sin(T * 0.45 - 0.5) * 0.12, 0);
    P.r('head', Math.sin(T * 0.9 - 1.2) * 0.06 - w * 0.08, Math.sin(T * 0.37) * 0.18, Math.sin(T * 0.6) * 0.09);
    // jaw chatter: a nervous twitch every so often
    const chat = smooth(0.7, 0.85, Math.sin(T * 0.6 + 1)) * (0.5 + 0.5 * Math.sin(T * 31));
    P.r('jaw', 0.1 + Math.max(0, Math.sin(T * 1.1)) * 0.12 + chat * 0.12);
    P.r('crown', Math.sin(T * 0.9) * 0.05, 0, Math.sin(T * 0.7) * 0.06);
    P.s('heart', 1 + beat * 0.16);
    P.s('eggs', 1 + Math.sin(T * 1.7) * 0.03);
    P.r('eggs', Math.sin(T * 0.8) * 0.04, 0, Math.sin(T * 0.6) * 0.04);
    P.s('throat', 1 + Math.sin(T * 1.3 + 1) * 0.04);
    for (let i = 0; i < 4; i++) { P.p('emb' + i, Math.sin(T * 0.2 + i * 2) * 0.6, (i - 1.5) * 0.4 + Math.sin(T * 0.3 + i) * 0.2, Math.cos(T * 0.25 + i * 1.7) * 0.5); P.r('emb' + i, T * 0.1 + i, T * 0.07 * (i % 2 ? 1 : -1), i); }
    for (let t = 0; t < TENT.length; t++) {
      const big = TENT[t][5];
      tent(P, T, t, dead ? 0 : (big ? 0.05 : -0.05) + w * 0.05, dead ? 0.15 : 1 + w * 0.6 + hit * 1.5, dead ? 0 : (big ? 0.8 + Math.sin(T * 0.7 + t * 2) * 0.5 : -0.35 + Math.sin(T * 0.9 + t * 2) * 0.35), 0, 1 + w * 0.5 + enr * 0.3);
    }
    let poolS = 1, aura = 0.22 + beat * 0.05 + enr * 0.15, ring = 0, ringR = 1, ringX = 0, ringZ = 0, gey = 0, geyS = 1;

    // emerge: the slam right after a submerge bursts up out of the sludge
    if (anim === 'cast' && at === 'submerge') st.wasUnder = true;
    else if (anim !== 'attack' && anim !== 'cast') st.wasUnder = false;
    const emerging = anim === 'attack' && at === 'slam' && st.wasUnder;

    if (anim === 'windup' || anim === 'attack' || anim === 'cast') {
      rate = anim === 'attack' ? 16 : 9;
      if (at === 'slam' && !emerging) {
        if (anim === 'windup') {
          // rear back: the two great tentacles rise and coil overhead, the skull screams up at them
          const k = smooth(0, 0.7, p), tr = smooth(0.6, 1, p);
          tent(P, T, 0, -0.9 * k, 0.25, -0.8 * k, 0.75 * k); tent(P, T, 1, -0.9 * k, 0.25, -0.8 * k, 0.75 * k);
          tent(P, T, 2, -0.8 * k, 0.6, -0.6 * k, 0.3 * k); tent(P, T, 3, -0.8 * k, 0.6, -0.6 * k, 0.3 * k);
          for (let t = 4; t < 8; t++) tent(P, T, t, 0.2 * k, 0.6, 0.2 * k, 0.15 * k);
          P.r('mass', -0.1 * k); P.p('mass', 0, 0.15 * k, -0.35 * k);
          P.r('neck0', -0.35 * k); P.r('neck1', -0.25 * k); P.r('head', -0.4 * k, 0, Math.sin(T * 40) * 0.03 * tr); P.r('jaw', 0.75 * k);
          sy *= 1 + 0.1 * k; sxz *= 1 - 0.04 * k; wob = 0.14 + tr * 0.06; glowK = 1 + k;
          P.r('t0_2', Math.sin(T * 37) * 0.03 * tr); P.r('t1_2', Math.sin(T * 41) * 0.03 * tr);
        } else {
          // the whip: tentacles come down hard in front, the whole sac lurches and squashes
          const k = smooth(0.0, 0.22, p) * (1 - smooth(0.65, 1, p));
          const lift = 1 - smooth(0, 0.2, p);
          tent(P, T, 0, 2.8 * k - 0.9 * lift, 0.2, -0.5 * k - 0.8 * lift, 0.75 * lift - 0.15 * k); tent(P, T, 1, 2.8 * k - 0.9 * lift, 0.2, -0.5 * k - 0.8 * lift, 0.75 * lift - 0.15 * k);
          P.p('mass', 0, -0.1 * bump(0.1, 0.5, p), 0.45 * bump(0, 0.6, p)); P.r('mass', 0.12 * k);
          P.r('neck0', 0.3 * k); P.r('neck1', 0.15 * k); P.r('head', 0.25 * k); P.r('jaw', 0.9 * k);
          sy *= 1 - 0.14 * bump(0.12, 0.5, p); sxz *= 1 + 0.06 * bump(0.12, 0.5, p); wob = 0.24;
          const r = smooth(0.15, 0.6, p);
          ring = (1 - r) * smooth(0.12, 0.18, p); ringR = 0.8 + r * 4.2; ringZ = 3.6;
          glowK = 1 + 0.8 * (1 - p);
        }
      } else if (at === 'tide' || at === 'pound') {
        const tide = at === 'tide';
        if (anim === 'windup') {
          // tide: the four great tentacles lifted high and wide; pound: reared over her as for the slam
          const k = smooth(0, 0.7, p), tr = smooth(0.6, 1, p);
          for (let t = 0; t < 4; t++) tent(P, T, t, -1.0 * k, 0.3, -0.6 * k, (tide ? 1.0 : 0.75) * k);
          for (let t = 4; t < 8; t++) tent(P, T, t, 0.2 * k, 0.6, 0.2 * k, 0.15 * k);
          P.r('mass', -0.12 * k); P.p('mass', 0, 0.18 * k, -0.2 * k);
          P.r('neck0', -0.35 * k); P.r('head', -0.45 * k, 0, Math.sin(T * 40) * 0.03 * tr); P.r('jaw', 0.8 * k);
          sy *= 1 + 0.12 * k; sxz *= 1 - 0.05 * k; wob = 0.14 + tr * 0.06; glowK = 1 + k;
        } else {
          // tide: down flat on the pool to either side, up, and down again for the second wave;
          // pound: down, and hauled straight back up for the next (the deluge is three of them)
          const sl = tide ? smooth(0, 0.06, p) * (1 - smooth(0.2, 0.42, p)) + smooth(0.5, 0.57, p) * (1 - smooth(0.78, 1, p)) : smooth(0, 0.1, p) * (1 - smooth(0.42, 0.85, p));
          const up = tide ? (1 - sl) * (1 - smooth(0.75, 1, p)) : smooth(0.42, 0.85, p);
          for (let t = 0; t < 4; t++) tent(P, T, t, 2.5 * sl - 1.0 * up, 0.3, -0.4 * sl - 0.6 * up, (tide ? 1.0 : 0.75) * up + (tide ? 0.7 : -0.1) * sl);
          for (let t = 4; t < 8; t++) tent(P, T, t, 0.6 * sl, 1.4, 0.3, 0.3 * sl, 2);
          const sq = tide ? bump(0.05, 0.3, p) + bump(0.55, 0.8, p) : bump(0.08, 0.4, p);
          P.p('mass', 0, -0.12 * sq + 0.15 * up, 0.25 * sq); P.r('mass', 0.14 * sq - 0.1 * up);
          P.r('neck0', 0.3 * sl - 0.3 * up); P.r('head', 0.25 * sl - 0.4 * up); P.r('jaw', 0.9);
          sy *= 1 - 0.14 * sq; sxz *= 1 + 0.07 * sq; wob = 0.26;
          const rr = tide ? (p < 0.5 ? smooth(0.06, 0.45, p) : smooth(0.57, 0.95, p)) : smooth(0.1, 0.6, p);
          const lit = tide ? (p < 0.5 ? smooth(0.05, 0.08, p) : smooth(0.56, 0.59, p)) : smooth(0.09, 0.13, p);
          ring = (1 - rr) * lit; ringR = 1.5 + rr * 6; ringZ = 0;
          glowK = 1 + 0.8 * sl;
        }
      } else if (at === 'ripple') {
        if (anim === 'windup') {
          // every tentacle lifts at once, opening round her like a flower
          const k = smooth(0, 0.8, p), tr = smooth(0.6, 1, p);
          for (let t = 0; t < TENT.length; t++) tent(P, T, t, -0.9 * k, 0.4, -0.5 * k, 0, 1.5);
          P.p('mass', 0, 0.2 * k, 0); P.r('neck0', -0.3 * k); P.r('head', -0.5 * k, 0, Math.sin(T * 38) * 0.03 * tr); P.r('jaw', 0.7 * k);
          sy *= 1 + 0.14 * k; sxz *= 1 - 0.06 * k; wob = 0.14 + tr * 0.08; glowK = 1 + k;
        } else {
          // all down at once, then the sac heaves three times, a ring of bile bursting from each heave
          const k = smooth(0, 0.05, p) * (1 - smooth(0.92, 1, p));
          let hv = 0, rr = 1, lit = 0;
          for (const h of [0.05, 0.34, 0.62, 0.9]) { const b = bump(h - 0.02, h + 0.18, p); hv = Math.max(hv, b); if (p >= h) { rr = smooth(h, h + 0.28, p); lit = smooth(h, h + 0.03, p); } }
          for (let t = 0; t < TENT.length; t++) tent(P, T, t, (1.6 + 0.5 * hv) * k, 1.2, 0.3, 0, 2);
          P.p('mass', 0, -0.2 * hv * k, 0); P.r('neck0', 0.2 * hv - 0.2 * (1 - hv) * k); P.r('head', -0.3 * k + 0.2 * hv, 0, Math.sin(T * 30) * 0.04 * k); P.r('jaw', 0.9 * k);
          sy *= 1 - 0.16 * hv; sxz *= 1 + 0.09 * hv; wob = 0.2 + 0.15 * hv;
          ring = (1 - rr) * lit; ringR = 1.5 + rr * 7; ringZ = 0; glowK = 1 + 1.2 * hv;
        }
      } else if (at === 'belch') {
        if (anim === 'windup') {
          // she gulps: the sac swells and the throat pumps, the skull drawn back with its cheeks full
          const k = smooth(0, 1, p), g = Math.max(0, Math.sin(T * 9)) * k;
          P.r('neck0', -0.35 * k); P.r('neck1', -0.25 * k); P.r('head', -0.4 * k + 0.08 * g); P.r('jaw', 0.15 * k + 0.1 * g);
          P.s('throat', 1 + 0.7 * k + 0.12 * g);
          for (let t = 4; t < 8; t++) tent(P, T, t, 0.35 * k, 0.5, 0.6 * k, 0);
          sy *= 1 + 0.1 * k + 0.03 * g; sxz *= 1 + 0.1 * k; orb = 0.3 + 0.7 * p; glowK = 1 + 0.8 * k; wob = 0.14 + 0.08 * g;
        } else {
          // and out it comes: the skull thrust forward, jaws gaping, the whole sac emptying and shuddering
          const k = smooth(0, 0.1, p) * (1 - smooth(0.8, 1, p));
          P.r('neck0', 0.45 * k); P.r('neck1', 0.25 * k); P.r('head', 0.2 * k, Math.sin(T * 11) * 0.12 * k, Math.sin(T * 23) * 0.05 * k); P.r('jaw', 1.15 * k);
          P.p('neck0', 0, 0, 0.3 * k); P.p('mass', 0, 0, 0.2 * k);
          P.s('throat', 1 + 0.6 * (1 - smooth(0, 0.6, p)) - 0.25 * k);
          for (let t = 0; t < 4; t++) tent(P, T, t, 0.4 * k, 1.8, 0.2, 0.2 * k, 2.5);
          sy *= 1 + 0.1 * (1 - smooth(0, 0.7, p)) - 0.12 * smooth(0.2, 0.8, p) * k + Math.sin(T * 26) * 0.02 * k;
          orb = 1 - smooth(0.1, 0.6, p); wob = 0.3;
        }
      } else if (emerging) {
        // up through the geyser, tentacles flung wide, then down
        const u = easeOut(smooth(0, 0.35, p));
        P.p('base', 0, -4.8 * (1 - u) + 0.35 * bump(0.25, 0.6, p), 0);
        for (let t = 0; t < TENT.length; t++) tent(P, T, t, -0.9 * (1 - smooth(0.3, 0.8, p)), 2.0, 0.4, 0.4 * (1 - p), 2.5);
        P.r('neck0', -0.4 * (1 - smooth(0.4, 0.9, p))); P.r('head', -0.5 * (1 - smooth(0.4, 0.9, p))); P.r('jaw', 0.9 * (1 - smooth(0.5, 1, p)));
        sy *= 1 + 0.18 * bump(0.2, 0.55, p) - 0.12 * bump(0.55, 0.85, p); wob = 0.3;
        gey = 1 - smooth(0.2, 0.9, p); geyS = 1 + p * 0.5;
        ring = 1 - smooth(0.25, 0.9, p); ringR = 1.5 + smooth(0.25, 0.9, p) * 8;
        rate = 20;
      } else if (at === 'spit') {
        if (anim === 'windup') {
          // throat swells, the skull pulls back and up, bile wells in the mouth
          const k = smooth(0, 1, p);
          P.r('neck0', -0.3 * k); P.r('neck1', -0.2 * k); P.r('head', -0.45 * k); P.r('jaw', 0.85 * k);
          P.s('throat', 1 + 0.55 * k + Math.sin(T * 18) * 0.04 * k);
          sy *= 1 + 0.08 * k; orb = 0.3 + 0.7 * p; glowK = 1 + k * 0.7;
        } else if (anim === 'attack') {
          // the spew: head snaps forward, throat squeezes empty
          const k = bump(0, 0.6, p);
          P.r('neck0', 0.35 * k); P.r('neck1', 0.2 * k); P.r('head', 0.3 * k); P.r('jaw', 1.05);
          P.p('neck0', 0, 0, 0.25 * k);
          P.s('throat', 1 - 0.3 * smooth(0, 0.25, p) + 0.3 * smooth(0.5, 1, p));
          orb = 1 - smooth(0.05, 0.3, p); sy *= 1 - 0.07 * bump(0, 0.4, p);
        } else {
          // rain: bile hurled straight up, the throat pumping
          const k = smooth(0, 0.25, p) * (1 - smooth(0.85, 1, p));
          P.r('neck0', -0.45 * k); P.r('neck1', -0.3 * k); P.r('head', -0.65 * k); P.r('jaw', 0.95 * k);
          P.s('throat', 1 + 0.35 * k * (0.5 + 0.5 * Math.sin(T * 14)));
          P.p('head', 0, 0.1 * Math.sin(T * 14) * k, 0);
          for (let t = 0; t < 4; t++) tent(P, T, t, -0.4 * k, 1.4, 0.3, 0.2 * k, 2);
          orb = 0.8 * k; wob = 0.16 + 0.1 * Math.max(0, Math.sin(T * 14)) * k;
        }
      } else if (at === 'summon') {
        // birthing convulsions: the egg clutch swells and bursts, tentacles flung wide
        const k = smooth(0, 0.4, p), burst = smooth(0.62, 0.72, p);
        for (let t = 0; t < TENT.length; t++) tent(P, T, t, -0.6 * k, 1.6, 0.6, 0.35 * k, 2.2);
        P.r('neck0', -0.3 * k); P.r('head', -0.55 * k, 0, Math.sin(T * 33) * 0.04 * k); P.r('jaw', 1.0 * k);
        P.s('eggs', 1 + 0.35 * k * (1 - burst) + Math.sin(T * 12) * 0.05 * k - 0.45 * burst * (1 - smooth(0.8, 1, p)));
        sy *= 1 + Math.sin(T * 9) * 0.05 * k; wob = 0.2 + 0.1 * k; orb = anim === 'attack' ? 0 : 0.6 * k;
        ring = bump(0.62, 1, p); ringR = 1 + smooth(0.62, 1, p) * 4; glowK = 1 + 1.5 * bump(0.55, 0.85, p);
      } else if (at === 'submerge') {
        // shudder, then she sinks into the sludge, tentacles thrashing as they go under
        const k = anim === 'windup' ? 0.15 * p : easeIn(smooth(0.15, 1, p));
        P.p('base', 0, -5.2 * k, 0); sy *= 1 - 0.3 * k + 0.08 * bump(0, 0.2, p);
        for (let t = 0; t < TENT.length; t++) tent(P, T, t, -0.6, 2.0, 0.3, 0.3, 3);
        P.r('neck0', -0.3 * (1 - k)); P.r('head', -0.4, 0, Math.sin(T * 25) * 0.06); P.r('jaw', 0.8);
        wob = 0.25; gey = bump(0.1, 0.8, p) * 0.8; geyS = 0.8 + p * 0.4; aura = 0.5;
        ring = bump(0.1, 0.6, p); ringR = 2 + p * 3;
        poolS = 1 + 0.2 * p;
      }
    } else if (dead) {
      rate = deathPose(m, s, P, T, st);
      const t = Math.max(s.t, p * 1.1);
      sy = lerp(1, 0.2, easeInOut(smooth(0.5, 2.0, t))); sxz = lerp(1, 1.4, easeOut(smooth(0.5, 2.2, t))) + Math.sin(t * 18) * 0.03 * (1 - smooth(0.4, 1.2, t));
      wob = 0.2 * (1 - smooth(0.6, 2.5, t)) + 0.04;
      poolS = 1 + 0.45 * easeOut(smooth(0.6, 2.8, t));
      aura = 0.5 * (1 - smooth(0.5, 3.5, t)); glowK = 1 + 1.5 * bump(0, 0.6, t) - 0.9 * smooth(1, 3, t);
      ring = bump(0.4, 1.6, t) * 0.5; ringR = 1.5 + smooth(0.4, 1.6, t) * 2.5;
      P.s('heart', Math.max(0.01, 1 - smooth(0.8, 2.4, t)));
      m.setOpacity(1 - 0.25 * smooth(1, 3, t));
    } else if (anim === 'spawn') {
      const r = spawnPose(P, T, p, st);
      rate = r.rate; sy *= r.sy; poolS = r.poolS; gey = r.gey; aura *= r.aura;
    }
    // intro: the first moments of the fight she heaves up out of her pool and shrieks
    const age = T - st.born;
    if (anim === 'idle' && age < 2.6) {
      const r = spawnPose(P, T, clamp(age / 2.4), st);
      rate = Math.max(rate, r.rate); sy *= r.sy; poolS = r.poolS; gey = Math.max(gey, r.gey); aura *= r.aura;
    }
    // phase change: a shrieking convulsion, everything flares
    if (st.phaseT !== undefined && T - st.phaseT < 2.4 && !dead) {
      const u = (T - st.phaseT) / 2.4, k = smooth(0, 0.12, u) * (1 - smooth(0.7, 1, u));
      P.r('neck0', -0.45 * k); P.r('neck1', -0.3 * k); P.r('head', -0.55 * k, 0, Math.sin(T * 35) * 0.06 * k); P.r('jaw', 1.1 * k);
      for (let t = 0; t < TENT.length; t++) tent(P, T, t, -1.0 * k, 2.2, 0.3, 0.4 * k, 3);
      sy *= 1 + 0.15 * k + Math.sin(T * 20) * 0.03 * k; wob = Math.max(wob, 0.3 * k);
      ring = Math.max(ring, (1 - smooth(0.05, 0.6, u)) * smooth(0.02, 0.08, u)); if (u < 0.6) { ringR = 1.5 + smooth(0.05, 0.6, u) * 9; ringZ = 0; }
      glowK = Math.max(glowK, 1 + 2 * k); aura = Math.max(aura, 0.7 * k);
      rate = Math.max(rate, 12);
    }
    P.sc('mass', sxz, sy, sxz);
    P.s('pool', poolS);
    // pool bubbles: swell, wobble, pop
    for (let i = 0; i < NBUB; i++) {
      const ph = (T * (0.35 + i * 0.07) + i * 0.37) % 1;
      const a = i * 2.4 + Math.floor(T * (0.35 + i * 0.07) + i * 0.37) * 1.7, r = 2.1 + (i % 3) * 0.35;
      P.p('bub' + i, Math.sin(a) * r, 0.02, Math.cos(a) * r);
      P.s('bub' + i, Math.max(0.01, smooth(0, 0.85, ph) * (1 - smooth(0.9, 0.96, ph)) * (0.6 + (i % 3) * 0.3) * (dead ? 1 - smooth(1, 3, s.t) : 1)));
    }
    m.U.uWobble.value += (wob - m.U.uWobble.value) * Math.min(1, dt * 5);
    m.setOrb(orb);
    st.glowK = glowK;
    st.fxv = st.fxv ?? { aura: 0, ring: 0, ringR: 1, ringX: 0, ringZ: 0, gey: 0, geyS: 1 };
    const fv = st.fxv; fv.aura = aura; fv.ring = ring; fv.ringR = ringR; fv.ringX = ringX; fv.ringZ = ringZ; fv.gey = gey; fv.geyS = geyS;
    if (!dead) strikeLayer(m, s, P, dt, BLOW_O);
    wounds(m, s, P, dt, { hunch: [['mass', 0.06], ['neck0', 0.12], ['neck1', 0.06], ['head', 0.1]], breath: [['mass', 0.04], ['neck0', 0.03]], spasm: ['mass', 'head'] }); // (near her end: bossKit.wounds)
    P.damp(dt, rate);
    secondary(m, s, dt);
    return 0;
  },
};

// her blows' weight (bossKit.strikeLayer): the sac lurches and drops as the tentacles land
const BLOWS = {
  slam: { hit: 0.15, rel: [0.8, 0, 0], imp: [1.6, 0, 1.4], sink: 0.15, rec: 0.7 },
  tide: { hit: 0.06, hits: [0.56], imp: [1.0, 0, 1.4], sink: 0.15, rec: 0.8 },
  pound: { hit: 0.1, imp: [1.5, 0, 1.5], sink: 0.15, rec: 2 },
  ripple: { hit: 0.05, hits: [0.34, 0.62, 0.9], imp: [0.6, 0, 1.3], sink: 0.15, rec: 2 },
  belch: { hit: 2, rel: [1.4, 0, 0.4], sink: 0.1, rec: 0.8 },
  spit: { hit: 2, rel: [1.0, 0, 0.2], sink: 0.08 },
  summon: { hit: 0.65, imp: [-1.0, 0, -0.6], rec: 0.85 },
};
const BLOW_O = { types: BLOWS, chain: [['mass', 0.35, 0.3], ['neck0', 0.4, 0.3]], head: 'head', root: 'mass', sink: 0.12 };

// tentacle t: droop > 0 bends down/outward, < 0 lifts; curl coils the tip; spread fans the root sideways
function tent(P, T, t, droop, wave = 1, curl = 0, spread = 0, speed = 1) {
  const a = TENT[t][0], big = TENT[t][5];
  const ax = Math.cos(a), az = -Math.sin(a);
  for (let k = 0; k < TSEG; k++) {
    const g = k / (TSEG - 1);
    const ph = T * 1.9 * speed - k * 0.75 + t * 1.7;
    const amp = (0.35 + g * 0.9) * wave;
    const d = droop * (k === 0 ? 0.5 : 0.17) + curl * g * g * 0.5 + Math.sin(ph) * 0.11 * amp;
    const sway = Math.sin(ph * 0.83 + 1.3 + t) * (big ? 0.12 : 0.16) * amp;
    P.r(`t${t}_${k}`, ax * d, sway + spread * (k === 0 ? (t % 2 ? -1 : 1) : 0), az * d);
  }
}

function spawnPose(P, T, p, st) {
  // the pool spreads, boils, she heaves up out of it; the skull rises last and shrieks
  const pool = easeOut(smooth(0, 0.3, p));
  const u = easeOut(smooth(0.15, 0.7, p));
  P.p('base', 0, -5.2 * (1 - u), 0);
  const unf = 1 - smooth(0.4, 0.9, p);
  for (let t = 0; t < TENT.length; t++) tent(P, T, t, -0.6 * unf, 1.8, 0.5 * unf, 0, 2.5);
  const scream = bump(0.55, 1, p);
  P.r('neck0', 0.5 * (1 - smooth(0.4, 0.75, p)) - 0.4 * scream); P.r('neck1', -0.25 * scream); P.r('head', 0.4 * (1 - smooth(0.45, 0.8, p)) - 0.5 * scream, 0, Math.sin(T * 33) * 0.05 * scream); P.r('jaw', 1.0 * scream);
  return { rate: 12, sy: 1 + 0.1 * bump(0.5, 0.9, p), poolS: Math.max(0.05, pool), gey: bump(0.1, 0.7, p) * 0.7, aura: 0.3 + pool * 0.7 + scream };
}

function deathPose(m, s, P, T, st) {
  // a last shriek with everything thrown up, then she bursts and deflates: the skull
  // crashes down into the sludge, the crown tumbles off, the tentacles slap down and twitch out
  const t = Math.max(s.t, s.progress * 1.1);
  const shriek = bump(0, 0.7, t), fall = easeIn(smooth(0.45, 1.2, t)), settle = smooth(1.2, 1.6, t);
  const tw = (1 - smooth(1.2, 3.5, t));
  P.r('neck0', -0.5 * shriek + 0.85 * fall, 0.2 * fall, 0.3 * fall); P.r('neck1', -0.3 * shriek + 0.4 * fall); P.r('head', -0.6 * shriek + 0.5 * fall, 0.35 * fall, 0.55 * fall + Math.sin(T * 30) * 0.08 * shriek);
  P.p('neck0', 0, -1.7 * fall + 0.12 * bump(1.15, 1.45, t), 0.5 * fall);
  P.r('jaw', 1.1 * shriek + 0.55 * fall);
  // the crown tumbles off and rolls away
  const cr = smooth(0.7, 1.7, t);
  P.p('crown', 0.55 * cr, -0.25 * cr - 0.4 * smooth(1.2, 1.7, t), 0.45 * cr); P.r('crown', 0.6 * cr, 0.8 * cr, 1.6 * cr + smooth(1.4, 2.2, t) * 0.4);
  for (let k = 0; k < TENT.length; k++) {
    const big = TENT[k][5];
    const slap = smooth(0.5 + (k % 4) * 0.08, 1.1 + (k % 4) * 0.08, t);
    tent(P, T, k, -1.1 * shriek + (big ? 1.6 : 0.4) * slap, 2.2 * shriek + 0.6 * tw * slap, -0.4 * slap, 0.3 * shriek, 2.5 + tw);
    P.p(`t${k}_0`, 0, -TENT[k][1] * 0.75 * slap, 0);
  }
  P.p('mass', 0, 0, 0.1 * settle);
  P.s('eggs', Math.max(0.01, 1 - 0.5 * smooth(0.4, 1.4, t)));
  return 9;
}

// boost the glow material for the rest of the fight (rotting fury)
function boostGlow(m, k) { m.state.glowBoost = k; }

// --------------------------------------------- after-damping secondary motion ----
const _v = new THREE.Vector3(), _a = new THREE.Vector3(), _M = new THREE.Matrix4(), _M2 = new THREE.Matrix4();
const AX_DOWN = new THREE.Vector3(0, -1, 0);
const AXES_CH = Array.from({ length: CHAIN_N }, () => AX_DOWN), AXES_ST = Array.from({ length: STR_N }, () => AX_DOWN);
const NAMES_CH = CHAINS.map((_, c) => Array.from({ length: CHAIN_N }, (_, i) => `ch${c}_${i}`));
const NAMES_ST = STRANDS.map((_, c) => Array.from({ length: STR_N }, (_, i) => `st${c}_${i}`));
const _sph = [[new THREE.Vector3(), 2.2]];
function secondary(m, s, dt) {
  const st = m.state;
  if (!st.ropes) st.ropes = { ch: CHAINS.map(() => new Rope(CHAIN_N, CHAIN_L)), st: STRANDS.map(() => new Rope(STR_N, STR_L)) };
  m.root.updateMatrix();
  const floorY = m.root.position.y + 0.06;
  const sc = m.root.scale.x;
  // body collider so the chains drape over the sac
  boneWorld(m, m.bones.mass, _M);
  _sph[0][0].set(0, 1.5, -0.1).applyMatrix4(_M);
  _sph[0][1] = 2.0 * sc * (m.bones.mass.scale.x);
  for (let c = 0; c < CHAINS.length; c++) {
    const r = st.ropes.ch[c];
    _a.set(...CHAINS[c]).applyMatrix4(_M);
    r.step(_a, dt, { g: 9.8, damp: 1.2, floor: floorY, spheres: _sph, iters: 3 });
    aimChain(m, NAMES_CH[c], r, AXES_CH);
  }
  boneWorld(m, m.bones.jaw, _M2);
  for (let c = 0; c < STRANDS.length; c++) {
    const r = st.ropes.st[c];
    _a.set(STRANDS[c][0] * HS, STRANDS[c][1] * HS, STRANDS[c][2] * HS).applyMatrix4(_M2);
    r.step(_a, dt, { g: 9.8, damp: 3, floor: floorY, iters: 2 });
    aimChain(m, NAMES_ST[c], r, AXES_ST);
  }
  // falling drops: from the drool tips, down to the pool (bones in root space)
  st.drops = st.drops ?? Array.from({ length: NDROP }, (_, i) => ({ y: -1, v: 0, x: 0, z: 0, t: i * 0.4 }));
  _M.copy(m.root.matrix).invert();
  for (let i = 0; i < NDROP; i++) {
    const d = st.drops[i];
    d.t -= dt;
    if (d.t <= 0 && d.y < 0 && s.anim !== 'death') {
      const r = st.ropes.st[i % STRANDS.length];
      _v.copy(r.p[r.n]).applyMatrix4(_M);
      d.x = _v.x; d.y = _v.y; d.z = _v.z; d.v = 0; d.t = 0.5 + ((i * 0.37 + m.time * 0.13) % 1) * 1.2;
    }
    if (d.y >= 0) { d.v += 9.8 * dt / sc; d.y -= d.v * dt; }
    const on = d.y >= 0;
    setBone(m, 'drop' + i, d.x, on ? d.y : -5, d.z, on ? 1 + Math.min(1, d.v * 0.08) * 0.3 : 0.001);
  }
  // fx
  const F = fxOf(m), v = st.fxv;
  const pul = 0.85 + 0.15 * Math.sin(m.time * 2.3);
  fxSet(F, 'aura', v.aura * pul, 1);
  fxPos(F, 'ring', v.ringX, 0.1, v.ringZ);
  fxSet(F, 'ring', v.ring, v.ringR, 1, v.ringR);
  fxSet(F, 'geyser', v.gey * (0.8 + 0.2 * Math.sin(m.time * 20)), v.geyS, 1 + v.gey * 0.3, v.geyS);
  // glow intensity (eyes, pustules, gems, heart)
  glowLevel(m, (st.glowK ?? 1) * (st.glowBoost ?? 1));
}
