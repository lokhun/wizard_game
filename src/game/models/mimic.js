import * as THREE from 'three';
import { G, xf, tube, deform, mergeRaw, chainSkin, rng, clamp, lerp, smooth, bump, easeOut, TAU } from './core.js';
import { glowLevel } from './bossKit.js';
import { HDR, boneShade } from './parts.js';

// ---------------------------------------------------------------- mimic ----
// A treasure chest that is a mouth. Built to the exact proportions of the
// realm's big treasure chest (props.js chest + chestLid at scale 1.3) so that,
// shut, it passes for one. The lid is the upper jaw; a ring of yellowed teeth,
// a cluster of eyes on the lid's underside and a long tongue live inside, and
// four sinewy legs fold up into the box.
//
// m.disguised (set by the encounter code while it lies in wait) holds it shut
// and still, but for the tells: every few seconds the lid lifts a finger's
// width as it breathes, and two tooth tips always hang just below the seam.
const EYE = 0xd6ff4a;
const FLESH = [0.3, 0.09, 0.085], GUM = [0.5, 0.13, 0.13], TONGUE = [0.75, 0.2, 0.24], TOOTH = [0.86, 0.8, 0.6];
const W = 1.0, H = 0.55, D = 0.62, R = 0.31; // chest body / lid radius (props.js chest)
// the real lid: a half barrel lying along x, flat side down (props.js chestLid)
const halfBarrel = (r, len) => new THREE.CylinderGeometry(r, r, len, 12, 1, false, 0, Math.PI).rotateZ(Math.PI / 2);
const LEGS = [['legFL', 1, 1], ['legFR', -1, 1], ['legBL', 1, -1], ['legBR', -1, -1]];

export const mimic = {
  id: 'mimic', height: 1.1, radius: 0.62, eyeColor: EYE, magicColor: EYE, defaultAttack: 'chomp', attackTypes: ['chomp', 'tongue', 'pounce'], orbSize: 0.05,
  build(rig) {
    rig.scale = 1.3;
    rig.bone('base', null);
    rig.bone('body', 'base');
    rig.bone('lid', 'body', 0, H, -D / 2);
    rig.bone('tg0', 'body', 0, H - 0.04, 0.02);
    rig.bone('tg1', 'tg0', 0, 0, 0.22);
    rig.bone('tg2', 'tg1', 0, 0, 0.22);
    rig.bone('tg3', 'tg2', 0, 0, 0.22);
    for (const [b, sx, sz] of LEGS) rig.bone(b, 'body', sx * 0.36, 0.12, sz * 0.2);
    const R1 = rng(17);
    // ---- the box, as the real chest has it: planks, two iron bands, a gold lock plate
    rig.add('body', 'wood', G.box(W, H, D, 2, 2, 2), { y: H / 2 });
    rig.add('body', 'iron', mergeRaw([-0.42, 0.42].map((x) => xf(G.box(0.06, H + 0.02, D + 0.02), { x, y: H / 2 + 0.01 }))));
    rig.add('body', 'gold', G.box(0.14, 0.18, 0.04), { y: 0.48, z: 0.32 });
    rig.add('body', 'dark', G.box(0.03, 0.05, 0.01), { y: 0.46, z: 0.342 }); // keyhole
    // the mouth: a dark gullet set into the top, wet gums along the rim
    rig.add('body', 'dark', G.box(W - 0.1, 0.02, D - 0.1), { y: H + 0.004 });
    rig.add('body', 'skin', mergeRaw([xf(G.box(W - 0.06, 0.04, 0.05), { z: D / 2 - 0.06 }), xf(G.box(W - 0.06, 0.04, 0.05), { z: -D / 2 + 0.06 }), xf(G.box(0.05, 0.04, D - 0.1), { x: W / 2 - 0.06 }), xf(G.box(0.05, 0.04, D - 0.1), { x: -W / 2 + 0.06 })]), { y: H + 0.01 }, { c: GUM });
    // lower teeth: a crooked row along the front and sides, hidden under the shut lid
    const lo = [];
    for (let i = 0; i < 11; i++) lo.push(xf(G.cone(0.022, 0.06 + R1() * 0.035, 5), { x: (i / 10 - 0.5) * (W - 0.16), y: H + 0.04, z: D / 2 - 0.07, rz: (R1() - 0.5) * 0.4, rx: 0.2 }));
    for (const s of [-1, 1]) for (let i = 0; i < 3; i++) lo.push(xf(G.cone(0.018, 0.05 + R1() * 0.02, 5), { x: s * (W / 2 - 0.07), y: H + 0.035, z: -0.12 + i * 0.12, rz: -s * 0.2 }));
    rig.add('body', 'bone', mergeRaw(lo), {}, { cfn: boneShade(TOOTH, 5, 1.3) });
    // ---- the lid: upper jaw. Hinge at the back; the lid runs forward along +z
    rig.add('lid', 'wood', halfBarrel(R, W), { z: R });
    rig.add('lid', 'iron', mergeRaw([xf(halfBarrel(R + 0.01, 0.06), { x: -0.42 }), xf(halfBarrel(R + 0.01, 0.06), { x: 0.42 })]), { z: R });
    // palate, gums and the upper fangs that close over the lower row
    rig.add('lid', 'dark', G.box(W - 0.08, 0.01, D - 0.06), { y: 0.006, z: R });
    rig.add('lid', 'skin', mergeRaw([xf(G.box(W - 0.06, 0.035, 0.05), { z: D - 0.05 }), xf(G.box(0.05, 0.035, D - 0.12), { x: W / 2 - 0.05, z: R }), xf(G.box(0.05, 0.035, D - 0.12), { x: -W / 2 + 0.05, z: R })]), { y: -0.012 }, { c: GUM });
    const up = [];
    for (let i = 0; i < 12; i++) {
      // two of the front fangs are longer: their tips hang just below the shut seam (a tell)
      const long = i === 3 || i === 8;
      up.push(xf(G.cone(0.024, long ? 0.1 : 0.055 + R1() * 0.03, 5), { x: (i / 11 - 0.5) * (W - 0.12), y: long ? -0.04 : -0.025, z: D - (long ? 0.005 : 0.05), rx: Math.PI + (R1() - 0.5) * 0.3 }));
    }
    for (const s of [-1, 1]) for (let i = 0; i < 3; i++) up.push(xf(G.cone(0.02, 0.05, 5), { x: s * (W / 2 - 0.06), y: -0.02, z: 0.15 + i * 0.13, rx: Math.PI }));
    rig.add('lid', 'bone', mergeRaw(up), {}, { cfn: boneShade(TOOTH, 9, 1.3) });
    // a cluster of eyes on the palate, staring out when the lid is up
    const eyes = [[0, 0.3, 0.05], [-0.2, 0.22, 0.04], [0.19, 0.24, 0.035], [-0.07, 0.42, 0.028], [0.1, 0.43, 0.03]];
    rig.add('lid', 'skin', mergeRaw(eyes.map(([x, z, r]) => xf(G.sph(r * 1.35, 10, 8), { x, z, sy: 0.6 }))), { y: -0.004 }, { c: FLESH });
    rig.add('lid', 'glow', mergeRaw(eyes.map(([x, z, r]) => xf(G.sph(r, 10, 8), { x, z, y: -0.012, sy: 0.7 }))), {}, { c: HDR(EYE, 3.2) });
    rig.add('lid', 'dark', mergeRaw(eyes.map(([x, z, r]) => xf(G.box(r * 0.35, 0.01, r * 1.3), { x, z, y: -0.03 }))));
    // ---- the tongue: one long tube bent by four bones, forked at the tip
    const tg = tube([[0, 0, 0], [0, 0.01, 0.2], [0, 0, 0.42], [0, -0.01, 0.62], [0, 0, 0.74]], (u) => 0.045 * (1 - u * 0.55), 18, 7);
    deform(tg, (v) => { v.x *= 1.5; }, true);
    rig.add('tg0', 'skin', tg, {}, { c: TONGUE, skin: chainSkin([['tg0', 0], ['tg1', 0.22], ['tg2', 0.44], ['tg3', 0.66]], (v) => v.z) });
    rig.add('tg3', 'skin', mergeRaw([-1, 1].map((s) => xf(G.cone(0.018, 0.1, 5), { x: s * 0.025, z: 0.12, rx: Math.PI / 2, rz: s * 0.4 }))), {}, { c: TONGUE });
    // ---- legs: knuckled, sinewy, ending in bone claws; folded flat inside the box while it waits
    for (const [b] of LEGS) {
      rig.add(b, 'skin', tube([[0, 0, 0], [0.05, -0.12, 0.02], [0.035, -0.26, 0.05], [0.0, -0.36, 0.06]], (u) => 0.07 * (1 - u * 0.55), 8, 7), {}, { c: FLESH });
      rig.add(b, 'skin', G.sph(0.075, 9, 7), { x: 0.04, y: -0.13, z: 0.02 }, { c: [0.24, 0.07, 0.07] });
      rig.add(b, 'bone', mergeRaw([-0.4, 0, 0.4].map((a) => xf(G.cone(0.016, 0.09, 4), { y: -0.37, z: 0.08, rx: Math.PI / 2 + 0.5, ry: a }))), {}, { c: TOOTH });
    }
    rig.socket('muzzle', 'body', 0, H + 0.1, D / 2);
    return {};
  },
  pose(m, s, P, dt) {
    const T = m.time, st = m.state, anim = s.anim, p = s.progress, at = s.attackType;
    let rate = 14;
    // waking: a beat of violent opening the moment it stops pretending
    if (st.wasHidden && !m.disguised) st.springT = T;
    st.wasHidden = !!m.disguised;
    const spring = st.springT != null ? clamp(1 - (T - st.springT) / 0.7) : 0;
    let lift = 0.3, open = 0.35 + Math.sin(T * 2.2 + m.seed * 5) * 0.08, legs = 1, tongue = 0.6, glow = 1;
    let bodyP = 0, bodyR = 0, bodyZ = 0, shake = 0;
    if (m.disguised && anim !== 'death') {
      // shut and still. Every few seconds it breathes: the lid lifts a crack and the eyes show
      const ph = (T * 0.21 + m.seed * 3) % 1;
      const br = bump(0.0, 0.14, ph);
      lift = 0; legs = 0; tongue = 0; open = br * 0.07; glow = 0.25 + br * 0.75;
      P.p('body', 0, br * 0.004, 0);
      P.s('body', 1 + br * 0.006);
      for (const [b, sx] of LEGS) P.r(b, 0, 0, -sx * 1.55);
      P.r('lid', -open);
      P.s('tg0', 0.001);
      glowLevel(m, glow);
      // the first pose lands at once: a new instance must never show its rest pose (legs out) for a frame
      if (!st.posed) { st.posed = true; return 1e5; }
      return 20;
    }
    // locomotion: lunging hops. Speed drives a hop cycle; the lid flaps with each one
    const spd = anim === 'death' ? 0 : s.speed ?? 0;
    const mw = smooth(0.05, 0.6, spd);
    st.moveW = (st.moveW ?? 0) + (mw - (st.moveW ?? 0)) * (1 - Math.exp(-8 * dt));
    const w = st.moveW;
    if (spd > 0.05) st.phase += TAU * dt * Math.min(2.2, 0.9 + spd * 0.22);
    const hop = Math.max(0, Math.sin(st.phase)), land = Math.max(0, -Math.sin(st.phase));
    lift += w * (hop * 0.34 - land * 0.12);
    bodyP += w * (Math.cos(st.phase) * 0.22);
    open += w * (hop * 0.45 - 0.2);
    legs = 1 - w * hop * 0.6;
    tongue -= w * 0.3;
    if (anim === 'windup') {
      const k = smooth(0, 0.6, p);
      shake = 0.02 * k;
      if (at === 'tongue') { open = lerp(open, 0.95, k); tongue = 0.2; P.r('tg0', -0.6 * k); P.r('tg1', -0.7 * k); P.r('tg2', -0.6 * k); bodyP = -0.15 * k; }
      else if (at === 'pounce') { lift = lerp(lift, 0.02, k); legs = 1 + 0.6 * k; open = lerp(open, 0.6, k); bodyP = 0.12 * k; }
      else { open = lerp(open, 1.35, k); bodyP = -0.3 * k; bodyZ = -0.12 * k; lift = lerp(lift, 0.18, k); tongue = 0.9; }
      glow = 1 + 0.8 * k;
      rate = 12;
    } else if (anim === 'attack' || anim === 'cast') {
      if (at === 'tongue') {
        // the tongue lashes out across the room and snaps back
        const out = bump(0, 0.75, p);
        open = 0.95; tongue = 1;
        P.sc('tg0', 1, 1, 1 + out * 4.5);
        P.r('tg0', 0.08 * out); P.r('tg1', 0.05 * out);
        bodyP = 0.15 * out; bodyZ = 0.1 * out;
      } else if (at === 'pounce') {
        // straight up, jaws wide, then down like a dropped crate
        const up = bump(0, 0.8, p);
        lift += up * 1.3; open = 0.3 + up * 1.1; legs = 0.4;
        bodyP = Math.sin(p * Math.PI * 2) * 0.25;
        if (p > 0.75) shake = 0.03 * (1 - p);
      } else {
        const lunge = bump(0, 0.75, p), snap = smooth(0.15, 0.3, p);
        bodyZ = 0.8 * lunge; lift += 0.18 * lunge; bodyP = 0.35 * lunge - 0.2 * snap * (1 - p);
        open = lerp(1.35, 0.02, snap) + smooth(0.6, 1, p) * 0.35;
        tongue = 0.2;
      }
      rate = 26;
    } else if (anim === 'stagger') {
      const k = s.t < 0.06 ? s.t / 0.06 : Math.exp(-(s.t - 0.06) * 6);
      bodyP = -0.45 * k; bodyR = 0.25 * k * (m.seed > 0.5 ? 1 : -1); open += 0.6 * k; lift -= 0.05 * k; rate = 30;
    } else if (anim === 'death') {
      // its legs give, it rolls onto its side and the lid falls open, tongue lolling
      const k = easeOut(smooth(0, 0.7, p));
      // (on its side the chest stands as tall as it is wide: lifted so its corner does not dig into the floor)
      lift = lerp(lift, 0.3, k); legs = 1 + 0.8 * k; open = lerp(open, 1.6, k) + bump(0.55, 0.8, p) * 0.2;
      bodyR = (m.seed > 0.5 ? 1 : -1) * 1.25 * k; bodyP = -0.15 * k;
      tongue = 1; P.r('tg1', 0.5 * k); P.r('tg2', 0.6 * k); P.r('tg3', 0.4 * k);
      glow = 1 - 0.9 * smooth(0.1, 0.6, p);
      rate = 9;
    }
    if (spring > 0) {
      // the reveal: the lid bangs open and the whole thing jolts up onto its legs
      open += 1.2 * spring; lift += 0.25 * bump(0, 1, 1 - spring); shake = Math.max(shake, 0.03 * spring);
      rate = 22;
    }
    if (shake) { P.r('body', Math.sin(T * 57) * shake, 0, Math.sin(T * 43) * shake); }
    P.p('body', 0, lift, bodyZ);
    P.r('body', bodyP, 0, bodyR);
    P.r('lid', -Math.max(0, open));
    // breathing heave and a lolling, wriggling tongue
    P.s('body', 1 + Math.sin(T * 3.1) * 0.012);
    const tw = Math.sin(T * 4 + m.seed * 4);
    // at rest it's coiled half inside, the tip draped over the lower teeth
    P.r('tg0', -0.12 * tongue, tw * 0.15, 0); P.r('tg1', 0.25 * tongue, tw * 0.2, 0); P.r('tg2', 0.55 * tongue, -tw * 0.25, 0); P.r('tg3', 0.45 * tongue, tw * 0.3, 0);
    if (!(anim === 'attack' && at === 'tongue')) P.sc('tg0', 1, 1, 0.55 + 0.25 * tongue);
    // legs: folded in when tucked (in the air), planted out at the corners when standing
    for (const [b, sx, sz] of LEGS) {
      const step = Math.sin(st.phase + (sx * sz > 0 ? 0 : Math.PI)) * w;
      // folded: swung flat inward under the lid; planted: splayed out and forward/back
      P.r(b, (-0.25 * sz - step * 0.35) * clamp(legs), 0, sx * (lerp(-1.55, 0.28, clamp(legs)) + Math.max(0, legs - 1) * 0.45));
    }
    glowLevel(m, glow);
    return rate;
  },
};

export const ENCOUNTER_TYPES = [mimic];
