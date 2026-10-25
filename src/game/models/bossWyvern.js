import * as THREE from 'three';
import { G, xf, tube, deform, bumpy, mergeRaw, chainSkin, rng, vnoise, fbm3, clamp, lerp, smooth, bump, easeOut, easeIn, easeInOut, TAU } from './core.js';
import { twoSided, HDR } from './parts.js';
import { addFx, fxOf, fxSet, fxPos, fxRot, paint, softRing, softDisc, boneWorld, boneModel, glowLevel, polyParam } from './bossKit.js';

// ==================================================== Gravemaw, the Stone Wyvern ==
// A gargoyle-wyvern of weathered, lichen-stained stone with magma glowing in its
// cracks. Its wings are its arms (humerus, forearm, wrist, three long fingers) and the
// membrane is skinned across them, so they really fold: on the ground it knuckle-walks
// on its folded wing-wrists; in the air it beats them with a fast downstroke and a
// folded upstroke. Bones (metres, no rig scale):
//   base -> body (pelvis) -> chest -> neck0-4 -> head -> jaw ; body -> tail0-9
//   body -> thigh/shin/ankle/toes L R ; chest -> wu (humerus) -> wf (forearm) -> wh (wrist) -> wd1-3 (fingers) L R
// Phase 2 ("its wings are broken"): it crashes out of the sky and fights grounded with
// torn, drooping wings. Phase 3 (Magma Heart): the cracks blaze and its chest glows.

const MAGMA = 0xff5a14;
const NECK = 5, TAIL = 10;
const NECK_OFF = [[0, 0.32, 0.5], [0, 0.32, 0.34], [0, 0.28, 0.3], [0, 0.22, 0.3], [0, 0.16, 0.3]];
const TAIL_OFF = (i) => [0, i === 0 ? 0.02 : -0.02, i === 0 ? -0.75 : -0.43];
// wing in chest space (left): shoulder S, elbow E, wrist W, finger tips T1 (leading) .. T3, membrane root on the flank Bd
const WS = new THREE.Vector3(0.5, 0.42, 0.2), WE_ = new THREE.Vector3(1.3, 0.12, -0.12), WW_ = new THREE.Vector3(1.9, 0.1, 0.18);
const WT = [new THREE.Vector3(2.5, 0.22, -0.55), new THREE.Vector3(1.75, 0.02, -1.95), new THREE.Vector3(0.6, -0.1, -2.35)];
const WBD = new THREE.Vector3(0.42, -0.05, -1.45);
const _magma = new THREE.Color(MAGMA);

function stoneC(v, seed = 1, base = 1) {
  const n = fbm3(v.x * 1.7, v.y * 1.7, v.z * 1.7, seed, 3), d = vnoise(v.x * 9, v.y * 9, v.z * 9, seed + 4);
  const moss = smooth(0.58, 0.75, fbm3(v.x * 1.1 + 4, v.y * 2.2, v.z * 1.1, seed + 9, 3)) * smooth(-0.2, 0.5, v.y - 1.2);
  const k = (0.8 + n * 0.4 + d * 0.12) * base;
  return [lerp(k, 0.55 * k, moss), lerp(k * 0.98, 0.72 * k, moss), lerp(k * 0.95, 0.42 * k, moss)];
}

export const stoneWyvern = {
  lookAt: 0, recoil: 0, // (its own rig: the head turns on other axes; see EnemyInstance._layers)
  id: 'stoneWyvern', height: 3.6, radius: 1.6, length: 6.5, boss: true, eyeColor: 0xffa020, magicColor: 0xff6a18, defaultAttack: 'breath', attackTypes: ['breath', 'slam', 'sweep', 'fly', 'roar'], crackColor: MAGMA, crackIntensity: 4.5, orbSize: 0.22, flutter: 0.05, soles: ['toesL', 'toesR'],
  build(rig) {
    rig.bone('base', null);
    rig.bone('ground', null); // fx on the floor, never lifted or spun
    rig.bone('body', 'base', 0, 1.75, -0.5);
    rig.bone('chest', 'body', 0, 0.22, 1.3);
    let prev = 'chest';
    for (let i = 0; i < NECK; i++) { rig.bone('neck' + i, prev, ...NECK_OFF[i], { rate: 0.85 - i * 0.04 }); prev = 'neck' + i; }
    rig.bone('head', prev, 0, 0.12, 0.28, { rate: 0.75 });
    rig.bone('jaw', 'head', 0, -0.1, 0.12);
    prev = 'body';
    for (let i = 0; i < TAIL; i++) { rig.bone('tail' + i, prev, ...TAIL_OFF(i), { rate: 0.75 - i * 0.035 }); prev = 'tail' + i; }
    for (const [S, sd] of [['L', 1], ['R', -1]]) {
      rig.bone('thigh' + S, 'body', sd * 0.55, -0.1, 0.12);
      rig.bone('shin' + S, 'thigh' + S, 0, -0.72, 0.36);
      rig.bone('ankle' + S, 'shin' + S, 0, -0.62, -0.42);
      rig.bone('toes' + S, 'ankle' + S, 0, -0.34, 0.12);
      rig.bone('wu' + S, 'chest', sd * WS.x, WS.y, WS.z, { rate: 0.9 });
      rig.bone('wf' + S, 'wu' + S, sd * WE_.x, WE_.y, WE_.z, { rate: 0.85 });
      rig.bone('wh' + S, 'wf' + S, sd * WW_.x, WW_.y, WW_.z, { rate: 0.8 });
      for (let k = 1; k <= 3; k++) rig.bone(`wd${k}${S}`, 'wh' + S, 0, 0, 0, { rate: 0.7 });
    }

    // ---- torso: one stone mass skinned pelvis -> chest, with a heavy keel and shoulder humps
    const tors = G.sph(0.8, 34, 24);
    deform(tors, (v) => {
      v.z *= 1.75;
      const f = clamp((v.z + 1.4) / 2.8); // 0 rear .. 1 front
      v.x *= lerp(0.78, 1.02, f); v.y *= lerp(0.85, 1.05, f);
      if (v.y < 0) v.y *= 0.92 + f * 0.25; // keel
      if (v.y > 0.3 && f > 0.55) v.y += (f - 0.55) * 0.35; // shoulder hump
      const n = fbm3(v.x * 2, v.y * 2, v.z * 2, 3, 3) - 0.5; v.multiplyScalar(1 + n * 0.08);
    });
    const torsoSkin = chainSkin([['body', -0.4], ['chest', 0.9]], (v) => v.z);
    rig.add('body', 'magmastone', tors, { y: 0.15, z: 0.55 }, { cfn: (v) => stoneC({ x: v.x, y: v.y + 1.9, z: v.z }, 2), skin: torsoSkin });
    // belly plates
    const bel = [];
    for (let i = 0; i < 11; i++) bel.push(xf(G.box(0.62 - Math.abs(i - 5) * 0.035, 0.07, 0.2, 2, 1, 1), { y: -0.66 + Math.abs(i - 5) * 0.03, z: -0.75 + i * 0.2, rx: 0.08 }));
    rig.add('body', 'stone', bumpy(mergeRaw(bel), 0.01, 9, 4), { y: 0.15, z: 0.55 }, { c: [0.62, 0.56, 0.5], skin: torsoSkin });
    // dorsal shards along the back
    const bsp = [];
    for (let i = 0; i < 8; i++) { const h = 0.5 - Math.abs(i - 3) * 0.06; bsp.push(xf(G.cone(0.11, h, 5), { y: 0.78 - Math.abs(i - 3.5) * 0.04 + h * 0.3, z: 1.35 - i * 0.32, rx: -0.55, sx: 0.5 })); }
    rig.add('body', 'stone', bumpy(mergeRaw(bsp), 0.012, 7, 5), { y: 0.15, z: 0.55 }, { c: [0.5, 0.47, 0.44], skin: torsoSkin });

    // ---- neck
    const np = [new THREE.Vector3(0, -0.05, -0.2)], acc = new THREE.Vector3();
    for (let i = 0; i < NECK; i++) { acc.add(new THREE.Vector3(...NECK_OFF[i])); np.push(acc.clone()); }
    np.push(acc.clone().add(new THREE.Vector3(0, 0.12, 0.28)));
    const nchain = [['chest', 0.0], ...Array.from({ length: NECK }, (_, i) => ['neck' + i, i + 1]), ['head', NECK + 1]];
    const along = polyParam(np);
    const neckG = tube(np, (u) => lerp(0.5, 0.24, u) * (1 + Math.sin(u * 60) * 0.03), 40, 12);
    deform(neckG, (v) => { const k = 1 + (v.y > 0 ? 0.0 : 0.08); v.x *= k; });
    rig.add('chest', 'magmastone', bumpy(neckG, 0.02, 6, 4), {}, { cfn: (v) => stoneC({ x: v.x, y: v.y + 2.2, z: v.z }, 5), skin: chainSkin(nchain, along) });
    // throat plates and neck shards
    const thp = [], nsp = [];
    for (let i = 1; i < np.length - 1; i++) {
      const a = np[i], b = np[i + 1], d = b.clone().sub(a).normalize();
      const r = lerp(0.5, 0.24, i / (np.length - 1));
      thp.push(xf(G.box(r * 1.1, 0.06, 0.24), { x: a.x, y: a.y - r * 0.88, z: a.z + 0.02, rx: -Math.atan2(d.y, d.z) }));
      nsp.push(xf(G.cone(0.07, 0.34 - i * 0.03, 5), { x: a.x, y: a.y + r * 0.9, z: a.z - 0.05, rx: -0.7, sx: 0.5 }));
    }
    rig.add('chest', 'stone', mergeRaw(thp), {}, { c: [0.6, 0.55, 0.5], skin: chainSkin(nchain, along) });
    rig.add('chest', 'stone', mergeRaw(nsp), {}, { c: [0.48, 0.45, 0.42], skin: chainSkin(nchain, along) });

    // ---- head: heavy angular skull, brow shelves, four swept horns, lava in the maw
    const hd = G.box(0.46, 0.36, 0.78, 4, 3, 6);
    deform(hd, (v) => {
      const t = clamp((v.z + 0.39) / 0.78); // back -> snout
      v.x *= 1 - t * 0.42; v.y *= 1 - t * 0.38;
      if (v.y > 0) v.y += Math.sin(t * Math.PI) * 0.05 - t * 0.04;
      if (v.y > 0.1 && Math.abs(v.x) > 0.12 && t > 0.35 && t < 0.6) v.y += 0.04; // brow shelves
      v.z += (fbm3(v.x * 6, v.y * 6, v.z * 6, 2, 2) - 0.5) * 0.03;
    });
    rig.add('head', 'magmastone', bumpy(hd, 0.014, 9, 7), { y: 0.06, z: 0.32 }, { cfn: (v) => stoneC({ x: v.x, y: v.y + 3, z: v.z }, 8) });
    rig.pair('head', 'head', 'stone', xf(G.box(0.12, 0.05, 0.34), { rz: 0.35 }), { x: 0.17, y: 0.25, z: 0.38, ry: 0.15 }, { c: [0.55, 0.5, 0.46] });
    const horn = (pts, r) => tube(pts, (u) => r * (1 - u * 0.88), 16, 7);
    rig.pair('head', 'head', 'stone', horn([[0.14, 0.2, 0.08], [0.3, 0.34, -0.15], [0.38, 0.38, -0.5], [0.33, 0.3, -0.85], [0.26, 0.38, -1.05]], 0.1), {}, { c: [0.46, 0.42, 0.38] });
    rig.pair('head', 'head', 'stone', horn([[0.18, 0.06, 0.02], [0.33, 0.04, -0.18], [0.42, -0.04, -0.4], [0.4, -0.16, -0.55]], 0.06), {}, { c: [0.46, 0.42, 0.38] });
    rig.pair('head', 'head', 'stone', mergeRaw([0, 1, 2].map((i) => xf(G.cone(0.035, 0.16 - i * 0.03, 4), { x: 0.2 - i * 0.02, y: 0.02 - i * 0.04, z: -0.05 - i * 0.12, rz: -1.3, rx: -0.3 }))), {}, { c: [0.46, 0.42, 0.38] });
    // eyes deep under the brow, nostrils
    rig.pair('head', 'head', 'dark', xf(G.sph(0.06, 8, 6), { sz: 0.6 }), { x: 0.16, y: 0.17, z: 0.44 });
    rig.pair('head', 'head', 'glow', xf(G.sph(0.04, 8, 6), { sx: 1.5, sy: 0.6 }), { x: 0.165, y: 0.17, z: 0.47, rz: -0.25 }, { c: HDR(0xffa020, 14) });
    rig.pair('head', 'head', 'dark', xf(G.sph(0.03, 6, 5), { sz: 0.5 }), { x: 0.06, y: 0.06, z: 0.73 });
    // upper teeth, molten maw
    const tu = [];
    for (let i = 0; i < 10; i++) for (const sd of [-1, 1]) tu.push(xf(G.cone(0.024, i === 1 ? 0.16 : 0.08 + (i % 3) * 0.02, 4), { x: sd * (0.15 - i * 0.009), y: -0.12, z: 0.18 + i * 0.058, rx: Math.PI }));
    rig.add('head', 'bone', mergeRaw(tu), {}, { c: [0.85, 0.78, 0.6] });
    rig.add('head', 'glow', G.box(0.2, 0.05, 0.55), { y: -0.11, z: 0.42 }, { c: HDR(MAGMA, 2.4) });
    const jw = G.box(0.36, 0.11, 0.72, 3, 1, 5);
    deform(jw, (v) => { const t = clamp((v.z + 0.36) / 0.72); v.x *= 1 - t * 0.4; v.y += (fbm3(v.x * 8, v.y * 8, v.z * 8, 5, 2) - 0.5) * 0.02; });
    rig.add('jaw', 'magmastone', jw, { y: -0.05, z: 0.3 }, { cfn: (v) => stoneC({ x: v.x, y: v.y + 3, z: v.z }, 9) });
    const tl = [];
    for (let i = 0; i < 9; i++) for (const sd of [-1, 1]) tl.push(xf(G.cone(0.02, 0.07 + (i % 2) * 0.03, 4), { x: sd * (0.13 - i * 0.009), y: 0.02, z: 0.06 + i * 0.065 }));
    rig.add('jaw', 'bone', mergeRaw(tl), {}, { c: [0.85, 0.78, 0.6] });
    rig.add('jaw', 'glow', G.box(0.18, 0.03, 0.5), { y: 0.0, z: 0.3 }, { c: HDR(MAGMA, 2.4) });
    rig.pair('jaw', 'jaw', 'stone', mergeRaw([0, 1].map((i) => xf(G.cone(0.03, 0.14, 4), { x: 0.17, y: -0.07, z: 0.05 + i * 0.15, rz: 1.9 }))), {}, { c: [0.46, 0.42, 0.38] });
    rig.socket('muzzle', 'head', 0, -0.08, 0.86);

    // ---- tail with shards and a heavy stone blade-club
    const tp = []; for (let i = 0; i <= TAIL; i++) { let z = -0.3, y = 0.14; for (let k = 0; k < i; k++) { const o = TAIL_OFF(k); y += o[1]; z += o[2]; } tp.push([0, y, z]); }
    const tchain = [['body', -0.2], ...Array.from({ length: TAIL }, (_, i) => ['tail' + i, 0.75 + i * 0.43 - 0.2])];
    const tskin = chainSkin(tchain, (v) => -v.z - 0.3);
    rig.add('body', 'magmastone', bumpy(tube(tp, (u) => 0.5 * (1 - u * 0.82), 60, 12), 0.014, 6, 9), {}, { cfn: (v) => stoneC({ x: v.x, y: v.y + 1.8, z: v.z }, 11), skin: tskin });
    const tsp = [];
    for (let i = 1; i < TAIL; i++) { const r = 0.5 * (1 - (i / TAIL) * 0.82); tsp.push(xf(G.cone(0.07, 0.3 - i * 0.018, 5), { y: tp[i][1] + r * 0.9, z: tp[i][2], rx: -0.65, sx: 0.5 })); }
    rig.add('body', 'stone', mergeRaw(tsp), {}, { c: [0.48, 0.45, 0.42], skin: tskin });
    const club = mergeRaw([
      bumpy(xf(G.oct(0.32), { sz: 2.2, sx: 0.8, sy: 0.6 }), 0.02, 6, 3),
      xf(G.cone(0.1, 0.6, 5), { x: 0.3, z: -0.2, rz: -Math.PI / 2 - 0.3, sx: 0.45 }), xf(G.cone(0.1, 0.6, 5), { x: -0.3, z: -0.2, rz: Math.PI / 2 + 0.3, sx: 0.45 }),
      xf(G.cone(0.09, 0.5, 5), { y: 0.25, z: -0.1, rx: -0.4, sx: 0.4 }), xf(G.cone(0.08, 0.5, 5), { z: -0.75, rx: -Math.PI / 2 }),
    ]);
    rig.add('tail' + (TAIL - 1), 'stone', club, { z: -0.2 }, { c: [0.5, 0.46, 0.42] });
    rig.add('tail' + (TAIL - 1), 'glow', mergeRaw([xf(G.box(0.03, 0.03, 0.8), { y: 0.13, z: -0.2 }), xf(G.box(0.4, 0.02, 0.02), { y: 0.1, z: -0.1 })]), {}, { c: HDR(MAGMA, 1.8) });

    // ---- hind legs: digitigrade, plated, with talons
    for (const S of ['L', 'R']) {
      const sd = S === 'L' ? 1 : -1;
      rig.add('thigh' + S, 'magmastone', bumpy(xf(G.sph(0.4, 16, 12), { sy: 1.5, sz: 1.15 }), 0.03, 5, 3), { y: -0.32, z: 0.14 }, { cfn: (v) => stoneC({ x: v.x, y: v.y + 1.4, z: v.z }, 13) });
      rig.add('shin' + S, 'magmastone', tube([[0, 0.05, 0], [0, -0.3, -0.2], [0, -0.62, -0.42]], (u) => lerp(0.24, 0.15, u), 10, 9), {}, { cfn: (v) => stoneC({ x: v.x, y: v.y + 0.9, z: v.z }, 14) });
      rig.add('ankle' + S, 'magmastone', tube([[0, 0.03, 0], [0, -0.34, 0.12]], (u) => lerp(0.15, 0.12, u), 8, 8), {}, { cfn: (v) => stoneC({ x: v.x, y: v.y + 0.4, z: v.z }, 15) });
      rig.add('shin' + S, 'stone', xf(G.cone(0.08, 0.32, 5), { y: 0.1, z: -0.05, rx: -2.4, sx: 0.5 }), {}, { c: [0.48, 0.45, 0.42] });
      const tal = [];
      for (let i = 0; i < 3; i++) { const a = (i - 1) * 0.42; tal.push(tube([[Math.sin(a) * 0.05, 0, 0.02], [Math.sin(a) * 0.2, -0.04, Math.cos(a) * 0.28], [Math.sin(a) * 0.27, -0.1, Math.cos(a) * 0.4]], (u) => 0.06 * (1 - u * 0.4), 8, 6)); }
      rig.add('toes' + S, 'magmastone', mergeRaw(tal), {}, { cfn: (v) => stoneC({ x: v.x, y: v.y + 0.2, z: v.z }, 16) });
      const cl = [];
      for (let i = 0; i < 3; i++) { const a = (i - 1) * 0.42; cl.push(xf(G.cone(0.05, 0.22, 5), { x: Math.sin(a) * 0.3, y: -0.12, z: Math.cos(a) * 0.46, rx: Math.PI / 2 + 0.55, ry: a })); }
      cl.push(xf(G.cone(0.05, 0.2, 5), { y: -0.1, z: -0.14, rx: -Math.PI / 2 - 0.5 }));
      rig.add('toes' + S, 'bone', mergeRaw(cl), {}, { c: [0.32, 0.28, 0.25] });
      void sd;
    }

    // ---- wings: arm struts, three fingers, a torn stone-hide membrane skinned across them
    for (const [S, sd] of [['L', 1], ['R', -1]]) buildWing(rig, S, sd);

    // ---- fx: breath cone at the maw, maw glow, wing-gust ring on the ground, impact ring, magma heart, tail trail
    const cone = new THREE.CylinderGeometry(1.15, 0.12, 4.2, 20, 6, true);
    cone.rotateX(Math.PI / 2); cone.translate(0, 0, 2.1);
    addFx(rig, 'head', 'flame', paint(cone, (v) => { const t = v.z / 4.2; const a = smooth(0, 0.12, t) * (1 - smooth(0.45, 1, t)); return [1.3 * (1.2 - t), 0.42 * (1 - t * 0.6), 0.08 * (1 - t), a * 0.55]; }), { y: -0.08, z: 0.86 });
    addFx(rig, 'head', 'maw', paint(xf(G.sph(0.26, 12, 8), { sz: 1.4 }), (v) => [2, 0.6, 0.1, 0.45]), { y: -0.08, z: 0.6 });
    addFx(rig, 'ground', 'gust', softRing(0.6, 1.0, 40, [0.16, 0.15, 0.14], 0.5), { y: 0.05 });
    addFx(rig, 'ground', 'ring', softRing(0.8, 1.0, 48, HDR(0xffa060, 1.4), 0.65), { y: 0.06 });
    addFx(rig, 'chest', 'core', paint(xf(G.sph(0.9, 16, 12), { sz: 1.3 }), (v) => [3, 0.9, 0.15, 0.35]), { y: -0.05, z: -0.3 });
    addFx(rig, 'ground', 'trail', tailTrail());
    return {};
  },

  onFx(m, kind, extra) {
    const st = m.state;
    if (kind === 'phase') {
      st.phaseT = m.time; st.phaseN = extra.n ?? 1;
      if (st.phaseN === 1) { st.broken = true; st.crashT = m.time; }
      if (st.phaseN >= 2) st.heart = true;
    } else if (kind === 'fly' && !extra.on && st.everFlew) { st.broken = true; if (st.crashT === undefined) st.crashT = m.time; }
    else if (kind === 'enrage') st.heart = true;
  },

  pose(m, s, P, dt) {
    const T = m.time, st = m.state, anim = s.anim, p = s.progress, at = s.attackType;
    if (st.born === undefined) st.born = T;
    const dead = anim === 'death';
    const fly = (at === 'fly' && !dead && anim !== 'stagger') || (m._flyForce && !dead);
    if (fly) st.everFlew = true;
    m._flying = fly;
    st.flyW = (st.flyW ?? 0) + ((fly ? 1 : 0) - (st.flyW ?? 0)) * (1 - Math.exp(-2.2 * dt));
    const fw = st.flyW, gw = 1 - fw;
    const spd = dead ? 0 : s.speed;
    st.moveW = (st.moveW ?? 0) + (smooth(0.05, 0.8, spd) * gw - (st.moveW ?? 0)) * (1 - Math.exp(-6 * dt));
    const w = st.moveW;
    if (spd > 0.01 && fw < 0.5) st.phase += (TAU * spd * dt) / 3.4;
    const ph = st.phase, sn = Math.sin(ph), cs = Math.cos(ph);
    const br = Math.sin(T * 1.1);
    const brk = st.broken ? 1 : 0;
    let rate = 9;
    // hit flinch
    if (m._flash > (st.lastFlash ?? 0) + 0.2) st.hitT = T;
    st.lastFlash = m._flash;
    const hit = st.hitT !== undefined && T - st.hitT < 0.7 ? Math.exp(-(T - st.hitT) * 6) : 0;

    // ---------------------------------------------------------- ground stance
    // hind legs (digitigrade), alternating in the walk
    for (const [S, sd] of [['L', 1], ['R', -1]]) {
      const sw = sd * sn, lift = Math.max(0, sd * cs);
      P.r('thigh' + S, -0.25 - sw * 0.4 * w, 0, sd * 0.06);
      P.r('shin' + S, 0.1 + lift * 0.5 * w, 0, 0);
      P.r('ankle' + S, 0.05 - lift * 0.35 * w, 0, 0);
      P.r('toes' + S, 0.1 + lift * 0.25 * w, 0, 0);
    }
    // body: low and forward, rolling with the gait
    P.p('body', 0, -0.12 - Math.abs(cs) * 0.07 * w + br * 0.02, 0);
    P.r('body', 0.12 + 0.03 * w, sn * 0.06 * w, cs * 0.05 * w);
    P.r('chest', 0.12 + br * 0.015, -sn * 0.08 * w, 0);
    P.sc('chest', 1 + br * 0.02, 1 + br * 0.025, 1);
    // folded wings as forelimbs: wrists planted ahead, swinging in the walk (diagonal to the hind legs)
    const fold = gw;
    for (const [S, sd] of [['L', 1], ['R', -1]]) {
      const sw = -sd * sn * w, up = Math.max(0, -sd * cs) * w;
      wingFold(P, S, sd, fold * (1 - brk * 0.15), sw, up, brk);
    }
    // neck S-curve, head level, looking about; tail sweeping
    for (let i = 0; i < NECK; i++) P.r('neck' + i, (i < 2 ? -0.18 : 0.1) + Math.sin(T * 0.7 - i * 0.5) * 0.03 + w * 0.04, Math.sin(T * 0.37 - i * 0.4) * 0.07, 0);
    P.r('head', 0.3 + Math.sin(T * 0.9) * 0.04, Math.sin(T * 0.31) * 0.22, Math.sin(T * 0.5) * 0.05);
    P.r('jaw', 0.05 + Math.max(0, Math.sin(T * 0.8)) * 0.05);
    for (let i = 0; i < TAIL; i++) P.r('tail' + i, -0.05 + (i > 3 ? 0.04 : 0), Math.sin(T * 0.9 - i * 0.55) * 0.07 + sn * 0.1 * w * (i / TAIL), 0);

    // ---------------------------------------------------------- flight
    // powerful hovering beats: fast downstroke, the forearm folds on the way up
    const flapRate = lerp(0, 1.25, fw) * (at === 'fly' && anim === 'attack' ? 1.6 : 1);
    st.flap = (st.flap ?? 0) + dt * TAU * flapRate;
    if (fw > 0.01) {
      const f = st.flap, dn = flapWave(f);
      const glide = at === 'fly' && anim === 'attack' ? smooth(0.15, 0.5, p) * (1 - smooth(0.85, 1, p)) : 0; // dive: wings swept back
      for (const [S, sd] of [['L', 1], ['R', -1]]) wingFlap(P, S, sd, fw, f, glide);
      P.p('base', 0, fw * (2.5 - dn * 0.22), 0);
      P.r('body', fw * (-0.12 - dn * 0.04 + glide * 0.2), 0, 0);
      P.r('chest', fw * (-0.08 + dn * 0.05));
      for (const S of ['L', 'R']) { P.r('thigh' + S, 0.85 * fw + Math.sin(f - 1) * 0.06 * fw); P.r('shin' + S, 0.35 * fw); P.r('ankle' + S, 0.55 * fw + Math.sin(f - 1.5) * 0.08 * fw); P.r('toes' + S, 0.6 * fw); }
      for (let i = 0; i < NECK; i++) P.r('neck' + i, fw * (i < 2 ? 0.05 : 0.02) + Math.sin(f - i * 0.6) * 0.03 * fw);
      for (let i = 0; i < TAIL; i++) P.r('tail' + i, fw * 0.03 + Math.sin(f - i * 0.5) * 0.05 * fw, Math.sin(T * 0.8 - i * 0.4) * 0.05 * fw, 0);
      st.dn = dn;
    } else st.dn = 0;

    // ---------------------------------------------------------- actions
    let crackK = 1 + Math.sin(T * 2) * 0.1;
    let orb = 0, flame = 0, maw = 0, ring = 0, ringR = 1, ringX = 0, ringZ = 0, trail = 0;
    if (anim === 'windup' || anim === 'attack' || anim === 'cast') {
      const wu = anim === 'windup';
      rate = wu ? 8 : 16;
      if (at === 'breath') {
        if (wu) {
          // rear up, neck coiled back, chest swelling, fire welling in the throat
          const k = smooth(0, 1, p);
          for (let i = 0; i < NECK; i++) P.r('neck' + i, (i < 2 ? -0.28 : 0.12) * k);
          P.r('head', -0.45 * k); P.r('jaw', 0.3 * k); P.r('body', -0.18 * k * gw); P.p('body', 0, 0.15 * k * gw, -0.2 * k);
          P.sc('chest', 1 + 0.14 * k, 1 + 0.1 * k, 1 + 0.05 * k);
          for (const [S, sd] of [['L', 1], ['R', -1]]) { P.r('wu' + S, 0, -sd * 0.3 * k * gw, sd * 0.35 * k * gw); }
          orb = 0.2 + 0.8 * p; maw = 0.3 + 0.7 * p; crackK = 1 + p * 1.6;
          P.r('head', Math.sin(T * 35) * 0.02 * smooth(0.6, 1, p));
        } else {
          // the gout: head thrust forward and low, jaws wide, the neck shuddering
          const k = smooth(0, 0.15, p) * (1 - smooth(0.88, 1, p));
          for (let i = 0; i < NECK; i++) P.r('neck' + i, (i < 2 ? 0.05 : 0.08) * k, Math.sin(T * 3 + i * 0.3) * 0.05 * k);
          P.r('head', 0.05 * k, 0, Math.sin(T * 22) * 0.03 * k); P.r('jaw', 0.85 * k);
          P.p('body', 0, 0, 0.15 * k); P.sc('chest', 1 - 0.06 * k, 1 - 0.05 * k, 1);
          orb = 1 - smooth(0.85, 1, p); flame = k * (0.85 + 0.15 * Math.sin(T * 40)); maw = k; crackK = 2.4;
        }
      } else if (at === 'slam') {
        // stomp: rears up on the hind legs, wings flung wide for balance, then crashes down
        if (wu) {
          const k = smooth(0, 1, p);
          P.r('body', -0.55 * k); P.p('body', 0, 0.55 * k, -0.35 * k);
          for (let i = 0; i < NECK; i++) P.r('neck' + i, -0.06 * k);
          P.r('head', 0.15 * k); P.r('jaw', 0.4 * k);
          for (const S of ['L', 'R']) { P.r('thigh' + S, 0.35 * k); P.r('shin' + S, -0.15 * k); }
          for (const [S, sd] of [['L', 1], ['R', -1]]) wingSpread(P, S, sd, k * (1 - brk * 0.4), 0.6 * k);
          crackK = 1 + k;
          P.r('body', Math.sin(T * 30) * 0.015 * smooth(0.6, 1, p));
        } else {
          const k = smooth(0, 0.2, p) * (1 - smooth(0.6, 1, p)), u = 1 - smooth(0, 0.2, p);
          P.r('body', 0.28 * k - 0.55 * u); P.p('body', 0, -0.35 * k + 0.55 * u, 0.4 * k);
          for (let i = 0; i < NECK; i++) P.r('neck' + i, 0.1 * k);
          P.r('head', 0.15 * k); P.r('jaw', 0.7 * k);
          for (const [S, sd] of [['L', 1], ['R', -1]]) wingSpread(P, S, sd, u * (1 - brk * 0.4), 0.6 * u - 0.4 * k);
          const r = smooth(0.18, 0.7, p);
          ring = (1 - r) * smooth(0.15, 0.2, p); ringR = 1 + r * 6; ringZ = 1.8;
          crackK = 1 + 2 * (1 - p);
        }
      } else if (at === 'sweep') {
        // tail whip: coil, then the whole body spins round with the club extended
        if (wu) {
          const k = smooth(0, 1, p);
          P.r('base', 0, 0.75 * k, 0);
          for (let i = 0; i < TAIL; i++) P.r('tail' + i, -0.04 * k, 0.16 * k, 0);
          P.r('head', 0, -0.6 * k, 0); for (let i = 0; i < NECK; i++) P.r('neck' + i, 0, -0.1 * k, 0);
          P.p('body', 0, -0.12 * k, 0);
        } else {
          const k = easeInOut(clamp(p / 0.6));
          P.r('base', 0, 0.75 - k * 3.6 + smooth(0.6, 1, p) * 2.85, 0);
          for (let i = 0; i < TAIL; i++) P.r('tail' + i, 0.03, -0.16 * bump(0, 0.6, p) + 0.06 * bump(0.5, 1, p), 0);
          P.r('head', 0, 0.4 * bump(0, 0.6, p), 0);
          P.p('body', 0, -0.2 * bump(0, 0.6, p), 0);
          trail = bump(0.05, 0.6, p);
        }
      } else if (at === 'fly') {
        if (wu) {
          // rise and rear back, wings high: the dive is coming
          const k = smooth(0, 1, p);
          P.p('base', 0, 0.8 * k * fw, -0.6 * k);
          P.r('body', -0.35 * k); for (let i = 0; i < NECK; i++) P.r('neck' + i, -0.08 * k);
          P.r('head', 0.35 * k); P.r('jaw', 0.5 * k);
          for (const S of ['L', 'R']) { P.r('thigh' + S, -0.6 * k); P.r('shin' + S, 0.5 * k); P.r('toes' + S, -0.5 * k); }
        } else {
          // the dive: streamlined, talons forward at the end
          const k = smooth(0, 0.2, p) * (1 - smooth(0.85, 1, p));
          P.r('body', 0.3 * k); P.p('base', 0, -1.2 * k, 0);
          for (let i = 0; i < NECK; i++) P.r('neck' + i, 0.06 * k);
          P.r('head', -0.15 * k); P.r('jaw', 0.6 * k);
          for (const S of ['L', 'R']) { P.r('thigh' + S, -1.0 * smooth(0.6, 0.9, p) * k); P.r('toes' + S, -0.8 * smooth(0.6, 0.9, p)); }
          trail = 0;
        }
      } else { // roar (rocks / meteors)
        const k = wu ? smooth(0, 1, p) * 0.5 : bump(0, 1, p);
        for (let i = 0; i < NECK; i++) P.r('neck' + i, -0.15 * k);
        P.r('head', -0.55 * k, Math.sin(T * 40) * 0.04 * k, Math.sin(T * 33) * 0.03 * k); P.r('jaw', 0.95 * k);
        P.r('body', -0.25 * k * gw); P.p('body', 0, 0.25 * k * gw, 0);
        for (const [S, sd] of [['L', 1], ['R', -1]]) wingSpread(P, S, sd, k * gw * (1 - brk * 0.4), 0.3 + Math.sin(T * 9) * 0.25 * k);
        crackK = 1 + k * 1.4; maw = k * 0.6;
      }
    } else if (anim === 'stagger') {
      const k = s.t < 0.08 ? s.t / 0.08 : Math.exp(-(s.t - 0.08) * 4);
      P.r('body', -0.2 * k, 0.15 * k, 0.1 * k); for (let i = 0; i < NECK; i++) P.r('neck' + i, -0.12 * k, 0.1 * k); rate = 22;
    } else if (dead) {
      rate = deathPose(P, T, s, st);
      const t = Math.max(s.t, p * 1.1);
      crackK = 1 + 2 * bump(0, 0.5, t) - 0.97 * smooth(0.8, 3.5, t);
      maw = bump(0, 0.6, t) * 0.5;
      ring = bump(0.9, 1.6, t) * 0.7; ringR = 2 + smooth(0.9, 1.6, t) * 5; ringZ = 0.5;
    } else if (anim === 'spawn') {
      spawnPose(P, T, p, fw);
      rate = 12;
    }
    if (hit && !dead) { P.r('body', -0.06 * hit, 0.05 * hit); P.r('head', -0.15 * hit, 0.1 * hit); P.r('neck2', -0.1 * hit); }
    // intro: it drops out of the night sky on heavy beats and screams
    const age = T - st.born;
    if (anim === 'idle' && age < 3) {
      const u = age / 2.8;
      P.p('base', 0, 5 * (1 - easeOut(smooth(0, 0.7, u))) * fw, -2 * (1 - easeOut(smooth(0, 0.7, u))));
      const k = bump(0.55, 1, u);
      for (let i = 0; i < NECK; i++) P.r('neck' + i, -0.14 * k);
      P.r('head', -0.55 * k, Math.sin(T * 40) * 0.04 * k); P.r('jaw', 1.0 * k);
      maw = Math.max(maw, k * 0.7); crackK = Math.max(crackK, 1 + k * 1.5);
    }
    // phase moments: the crash (wings broken) and the magma heart igniting
    const pt = st.phaseT !== undefined && !dead ? T - st.phaseT : 9;
    if (st.crashT !== undefined && !dead) {
      const c = (T - st.crashT) / 2.2;
      if (c < 1) {
        // tumbles out of the air, slams down, then rears and screams with its torn wings flared
        const fall = 1 - easeIn(smooth(0, 0.3, c));
        P.p('base', 0, 2.2 * fall, 0);
        P.r('body', 0.4 * bump(0.1, 0.45, c), 0, 0.35 * bump(0, 0.4, c) * Math.sin(T * 8));
        for (const [S, sd] of [['L', 1], ['R', -1]]) wingSpread(P, S, sd, bump(0.0, 0.35, c) + bump(0.5, 1, c) * 0.8, Math.sin(T * 14 + sd) * 0.5 * bump(0, 0.35, c));
        const sc = bump(0.45, 1, c);
        for (let i = 0; i < NECK; i++) P.r('neck' + i, -0.15 * sc);
        P.r('head', -0.6 * sc, Math.sin(T * 40) * 0.05 * sc); P.r('jaw', 1.0 * sc);
        const imp = c - 0.3;
        if (imp > 0 && imp < 0.35) { ring = Math.max(ring, 1 - imp / 0.35); ringR = 1.5 + imp / 0.35 * 7; ringZ = 0; }
        rate = Math.max(rate, 12);
      }
    }
    if (st.heart && pt < 2.5 && st.phaseN >= 2) {
      const k = bump(0, 2.5, pt);
      for (let i = 0; i < NECK; i++) P.r('neck' + i, -0.16 * k);
      P.r('head', -0.6 * k, Math.sin(T * 40) * 0.05 * k); P.r('jaw', 1.0 * k); P.sc('chest', 1 + 0.15 * k, 1 + 0.12 * k, 1);
      crackK = Math.max(crackK, 1 + 3 * k); maw = Math.max(maw, k);
    }
    st.heatW = (st.heatW ?? 0) + ((st.heart ? 1 : 0) - (st.heatW ?? 0)) * (1 - Math.exp(-0.8 * dt));
    crackK *= 1 + st.heatW * (0.6 + 0.25 * Math.sin(T * 3.3));
    m.U.uCrack.value.copy(_magma).multiplyScalar(4.5 * Math.max(0.05, crackK));
    m.setOrb(orb);
    glowLevel(m, (dead ? 1 - 0.85 * smooth(0.8, 3.5, Math.max(s.t, p * 1.1)) : 1) * (1 + st.heatW * 0.4));
    // fx
    const F = fxOf(m);
    fxSet(F, 'flame', flame * 0.9, 1 + Math.sin(T * 31) * 0.06, 1 + Math.sin(T * 27) * 0.06, 0.9 + flame * 0.15 + Math.sin(T * 23) * 0.05);
    fxSet(F, 'maw', maw * (0.7 + 0.3 * Math.sin(T * 17)), 0.6 + maw * 0.5);
    // wing gusts: a dust ring on the ground under each downstroke while it hovers
    const gu = ((st.flap ?? 0) / TAU + 0.85) % 1;
    fxSet(F, 'gust', fw * (1 - gu) * 0.45 * (fly ? 1 : 0), 1.2 + gu * 4.5);
    fxPos(F, 'ring', ringX, 0.06, ringZ);
    fxSet(F, 'ring', ring, ringR, 1, ringR);
    fxSet(F, 'core', st.heatW * (0.25 + 0.15 * Math.sin(T * 3.3)) + (anim === 'windup' && at === 'breath' ? p * 0.3 : 0), 1 + Math.sin(T * 3.3) * 0.05);
    fxRot(F, 'trail', 0, m.bones.base.rotation.y, 0);
    fxSet(F, 'trail', trail * 0.8);
    return rate;
  },
};

// downstroke-weighted flap wave: -1 (top) .. 1 (bottom), quick down, slow up
function flapWave(f) { const s = Math.sin(f); return s + 0.22 * Math.sin(2 * f - 0.6); }

// wing pose helpers. sd: +1 left, -1 right (rotations mirror in y and z)
// folded (k = 1): humerus back and down, forearm forward to the planted wrist, fingers folded back along it
function wingFold(P, S, sd, k, swing = 0, lift = 0, broken = 0) {
  P.r('wu' + S, 0.15 * k, sd * (1.1 + swing * 0.45) * k, sd * (-0.55 - lift * 0.2 - broken * 0.25) * k);
  P.r('wf' + S, -0.1 * k, sd * (-2.55 + swing * 0.3) * k, sd * (-0.5 + lift * 0.5) * k);
  P.r('wh' + S, 0, sd * 2.75 * k, sd * (0.4 + broken * 0.3) * k);
  P.r('wd1' + S, 0, sd * 0.05 * k, 0); P.r('wd2' + S, 0, sd * 0.4 * k, -sd * 0.1 * k); P.r('wd3' + S, 0, sd * 0.7 * k, -sd * 0.15 * k);
}
// spread wide (display / balance): k weight, up raises them
function wingSpread(P, S, sd, k, up = 0) {
  P.r('wu' + S, 0, sd * (-1.1) * k, sd * (0.55 + up * 0.5) * k);
  P.r('wf' + S, 0, sd * 2.5 * k, sd * 0.45 * k);
  P.r('wh' + S, 0, -sd * 2.65 * k, -sd * 0.4 * k);
  P.r('wd2' + S, 0, -sd * 0.35 * k, 0); P.r('wd3' + S, 0, -sd * 0.65 * k, 0);
}
function wingFlap(P, S, sd, fw, f, glide) {
  const dn = flapWave(f), upK = Math.max(0, -Math.sin(f - 0.4)); // forearm folds on the upstroke
  const a = 0.75 * (1 - glide * 0.8);
  P.r('wu' + S, sd * 0.0, sd * (0.05 + upK * 0.25 + glide * 0.7) * fw, sd * (0.25 - dn * a) * fw);
  P.r('wf' + S, 0, sd * (upK * 0.55 + glide * 0.5) * fw, sd * (0.1 + Math.sin(f - 0.9) * 0.3 * (1 - glide)) * fw);
  P.r('wh' + S, 0, -sd * (upK * 0.4 - glide * 0.6) * fw, sd * Math.sin(f - 1.3) * 0.2 * (1 - glide) * fw);
  P.r('wd2' + S, 0, -sd * 0.08 * dn * fw, 0); P.r('wd3' + S, 0, -sd * 0.12 * dn * fw, 0);
}

function deathPose(P, T, s, st) {
  // a last scream, the legs give, it crashes onto its side with the wings collapsing over it;
  // the magma drains from its cracks until it is only a fallen statue
  const t = Math.max(s.t, s.progress * 1.1);
  const scream = bump(0, 0.75, t), give = easeIn(smooth(0.45, 1.3, t)), wf = smooth(0.4, 1.6, t);
  for (let i = 0; i < NECK; i++) P.r('neck' + i, -0.15 * scream + 0.28 * give, 0.12 * give, 0.05 * give);
  P.r('head', -0.6 * scream + 0.35 * give, 0.4 * give, 0.7 * give); P.r('jaw', 1.0 * scream + 0.45 * give);
  P.p('base', 0, 0, 0);
  P.p('body', 0, -1.2 * give + 0.08 * bump(1.3, 1.6, t), 0); P.r('body', 0.1 * give, 0, 0.55 * give);
  for (const S of ['L', 'R']) { P.r('thigh' + S, -0.9 * give); P.r('shin' + S, 0.8 * give); P.r('ankle' + S, -0.4 * give); }
  for (const [S, sd] of [['L', 1], ['R', -1]]) {
    wingSpread(P, S, sd, scream * 0.8, 0.4 * scream);
    P.r('wu' + S, 0, 0, sd * -0.6 * wf); P.r('wf' + S, 0, sd * 0.8 * wf, sd * -0.3 * wf);
  }
  // as it rolls, the wing it lands on folds up along its flank and the other drapes over it (the lower one ran
  // 2 m into the floor; searched against the settled pose)
  P.r('wuL', -1.0 * wf, 0, 1.2 * wf);
  P.r('wuR', 1.0 * wf, 0, -1.2 * wf); P.r('wfR', 0, 1.2 * wf, 0);
  for (let i = 0; i < TAIL; i++) P.r('tail' + i, 0.02 * give, Math.sin(i * 0.6) * 0.1 * give, 0);
  return 8;
}
function spawnPose(P, T, p, fw) {
  const e = easeOut(p);
  P.p('base', 0, 5 * (1 - e), -2 * (1 - e));
  for (const [S, sd] of [['L', 1], ['R', -1]]) wingFlap(P, S, sd, 1 - smooth(0.7, 1, p), T * 8, 0);
}
function tailTrail() {
  // a horizontal arc at tail height, trailing the club through the spin
  const pos = [], c = [], idx = [], A = 30, Rr = 3, span = 2.6, r0 = 3.2, r1 = 5.6;
  for (let i = 0; i <= A; i++) {
    const u = i / A, a = Math.PI + u * span;
    for (let k = 0; k <= Rr; k++) {
      const v = k / Rr, r = lerp(r0, r1, v);
      pos.push(Math.sin(a) * r, 1.3, Math.cos(a) * r);
      c.push(0.9, 0.55, 0.35, (1 - u) ** 2 * Math.sin(Math.PI * (0.1 + v * 0.9)) * 0.55);
    }
  }
  for (let i = 0; i < A; i++) for (let k = 0; k < Rr; k++) { const a = i * (Rr + 1) + k, b = a + Rr + 1; idx.push(a, b, a + 1, b, b + 1, a + 1); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(c, 4));
  g.setIndex(idx);
  return g;
}

// --------------------------------------------------------------- wing build ----
function buildWing(rig, S, sd) {
  const M = (v) => new THREE.Vector3(v.x * sd, v.y, v.z);
  const s0 = M(WS), e0 = s0.clone().add(M(WE_)), w0 = e0.clone().add(M(WW_));
  const tips = WT.map((t) => w0.clone().add(M(t)));
  const bd = M(WBD);
  const B = { wu: 'wu' + S, wf: 'wf' + S, wh: 'wh' + S, d: [1, 2, 3].map((k) => `wd${k}${S}`), body: 'chest' };
  const R = rng(sd > 0 ? 41 : 43);
  // membrane: inner panel lofted from the arm (S-E-W) to the trailing edge (flank -> finger 3),
  // then two fans between the fingers; scalloped trailing edges, torn holes near the edge
  const pos = [], wts = [], idx = [];
  const push = (p, ws) => { pos.push(p.x, p.y, p.z); wts.push(ws); return pos.length / 3 - 1; };
  const lerpV = (a, b, t) => a.clone().lerp(b, t);
  const armAt = (u) => (u < 0.4 ? lerpV(s0, e0, u / 0.4) : lerpV(e0, w0, (u - 0.4) / 0.6));
  const armW = (u) => (u < 0.4 ? [[B.wu, 1]] : u < 0.55 ? [[B.wu, 1 - (u - 0.4) / 0.15], [B.wf, (u - 0.4) / 0.15]] : u < 0.92 ? [[B.wf, 1]] : [[B.wf, 1 - (u - 0.92) / 0.08], [B.wh, (u - 0.92) / 0.08]]);
  const NU = 14, NV = 6;
  const inner = [];
  for (let i = 0; i <= NU; i++) {
    const u = i / NU, a = armAt(u);
    const te = lerpV(bd, tips[2], u);
    te.lerp(lerpV(s0, w0, u), 0.12 * Math.sin(u * Math.PI)); // scallop
    const teW = u < 0.5 ? [[B.body, 1 - u * 2], [B.wf, u * 2]] : [[B.wf, 1 - (u - 0.5) * 2], [B.d[2], (u - 0.5) * 2]];
    const row = [];
    for (let j = 0; j <= NV; j++) {
      const v = j / NV, p = lerpV(a, te, v);
      p.y -= Math.sin(v * Math.PI) * 0.12 * Math.sin(u * Math.PI);
      row.push(push(p, mixW(armW(u), teW, v)));
    }
    inner.push(row);
  }
  for (let i = 0; i < NU; i++) for (let j = 0; j < NV; j++) { const a = inner[i][j], b = inner[i + 1][j], c = inner[i][j + 1], d = inner[i + 1][j + 1]; idx.push(a, c, b, b, c, d); }
  const fan = (ta, tb, ba, bb) => {
    const NA = 7, NR = 6, rows = [];
    for (let i = 0; i <= NA; i++) {
      const a = i / NA, edge = lerpV(ta, tb, a);
      edge.lerp(w0, 0.16 * Math.sin(a * Math.PI)); // scallop
      const row = [];
      for (let k = 0; k <= NR; k++) {
        const r = k / NR, p = lerpV(w0, edge, r);
        p.y -= Math.sin(r * Math.PI) * Math.sin(a * Math.PI) * 0.08;
        row.push(push(p, mixW([[B.wh, 1]], [[ba, 1 - a], [bb, a]], Math.min(1, r * 1.3))));
      }
      rows.push(row);
    }
    for (let i = 0; i < NA; i++) for (let k = 0; k < NR; k++) { const a = rows[i][k], b = rows[i + 1][k], c = rows[i][k + 1], d = rows[i + 1][k + 1]; idx.push(a, b, c, b, d, c); }
  };
  fan(tips[2], tips[1], B.d[2], B.d[1]);
  fan(tips[1], tips[0], B.d[1], B.d[0]);
  // tears: drop a few triangles near the trailing edges
  const P3 = (i) => new THREE.Vector3(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]);
  const keep = [];
  for (let t = 0; t < idx.length; t += 3) {
    const c = P3(idx[t]).add(P3(idx[t + 1])).add(P3(idx[t + 2])).multiplyScalar(1 / 3);
    const n = vnoise(c.x * 2.3 + sd * 7, c.y * 2.3, c.z * 2.3, 5);
    const dEdge = Math.min(c.distanceTo(tips[1]), c.distanceTo(tips[2]), c.distanceTo(bd) * 1.6);
    if (n > 0.74 && dEdge > 0.4 && R() < 0.85) continue;
    keep.push(idx[t], idx[t + 1], idx[t + 2]);
  }
  if (sd < 0) for (let t = 0; t < keep.length; t += 3) { const q = keep[t + 1]; keep[t + 1] = keep[t + 2]; keep[t + 2] = q; }
  let mem = new THREE.BufferGeometry();
  mem.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  mem.setIndex(keep); mem.computeVertexNormals();
  mem = twoSided(mem);
  // twoSided drops the index: look each vertex's weights up by its (exact) position
  const lookup = new Map();
  const key = (x, y, z) => `${Math.round(Math.fround(x) * 2e3)},${Math.round(Math.fround(y) * 2e3)},${Math.round(Math.fround(z) * 2e3)}`;
  for (let i = 0; i < pos.length / 3; i++) lookup.set(key(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]), i);
  let miss = 0;
  const memSkin = (v) => { const i = lookup.get(key(v.x, v.y, v.z)); if (i === undefined) miss++; return wts[i ?? 0]; };
  rig.add('chest', 'stone', mem, {}, {
    skin: memSkin,
    cfn: (v) => { const n = fbm3(v.x * 2, v.y * 2, v.z * 2, 3, 3), vein = Math.abs(vnoise(v.x * 3, v.y * 3, v.z * 3, 7) - 0.5) < 0.03 ? 0.6 : 1; const k = (0.3 + n * 0.2) * vein; return [k, k * 0.95, k * 0.9]; },
    anim: (v) => clamp(v.distanceTo(w0) / 3) * 0.6 * clamp(Math.abs(v.x) - 0.6),
  });
  // arm struts and fingers
  const strut = [tube([s0, lerpV(s0, e0, 0.5).add(new THREE.Vector3(0, 0.05, 0)), e0], (u) => lerp(0.2, 0.13, u), 10, 8)];
  rig.add('chest', 'magmastone', bumpy(strut[0], 0.015, 6, 3), {}, { cfn: (v) => stoneC(v, 21), skin: chainSkin([[B.wu, 0.1], [B.wf, 0.95]], (v) => v.distanceTo(s0) / s0.distanceTo(e0)) });
  rig.add('chest', 'magmastone', bumpy(tube([e0, lerpV(e0, w0, 0.5).add(new THREE.Vector3(0, 0.04, 0)), w0], (u) => lerp(0.13, 0.1, u), 10, 8), 0.012, 7, 4), {}, { cfn: (v) => stoneC(v, 22), skin: chainSkin([[B.wf, 0.05], [B.wh, 0.97]], (v) => v.distanceTo(e0) / e0.distanceTo(w0)) });
  tips.forEach((t, k) => {
    const g = tube([w0, lerpV(w0, t, 0.5).add(new THREE.Vector3(0, 0.05, 0)), t], (u) => lerp(0.075, 0.025, u), 12, 6);
    rig.add('chest', 'magmastone', g, {}, { cfn: (v) => stoneC(v, 23 + k), skin: chainSkin([[B.wh, 0.02], [B.d[k], 0.12]], (v) => v.distanceTo(w0) / w0.distanceTo(t)) });
    rig.add('chest', 'bone', xf(G.cone(0.03, 0.14, 4), { x: t.x, y: t.y, z: t.z }), {}, { c: [0.3, 0.27, 0.24], skin: () => [[B.d[k], 1]] });
  });
  // elbow spur, wrist thumb-claw (the forefoot when it knuckle-walks)
  rig.add('chest', 'stone', xf(G.cone(0.08, 0.4, 5), { x: e0.x, y: e0.y + 0.05, z: e0.z - 0.15, rx: -2.2, sx: 0.5 }), {}, { c: [0.48, 0.45, 0.42], skin: () => [[B.wf, 1]] });
  rig.add('chest', 'magmastone', xf(G.sph(0.14, 10, 8), { x: w0.x, y: w0.y, z: w0.z }), {}, { cfn: (v) => stoneC(v, 30), skin: () => [[B.wh, 1]] });
  rig.add('chest', 'bone', tube([w0.clone().add(new THREE.Vector3(0, 0, 0.05)), w0.clone().add(new THREE.Vector3(sd * 0.05, 0.05, 0.25)), w0.clone().add(new THREE.Vector3(sd * 0.02, -0.08, 0.38))], (u) => 0.05 * (1 - u * 0.85), 8, 5), {}, { c: [0.3, 0.27, 0.24], skin: () => [[B.wh, 1]] });
  void B.body;
}
function mixW(a, b, t) {
  const m = new Map();
  for (const [n, w] of a) m.set(n, (m.get(n) ?? 0) + w * (1 - t));
  for (const [n, w] of b) m.set(n, (m.get(n) ?? 0) + w * t);
  return [...m.entries()].filter(([, w]) => w > 1e-4).sort((x, y) => y[1] - x[1]).slice(0, 4);
}
