import * as THREE from 'three';
import { G, xf, lathe, tube, extrude, deform, bumpy, mergeRaw, chainSkin, panel, rng, vnoise, fbm3, clamp, lerp, smooth, bump, easeOut, easeIn, easeInOut, TAU } from './core.js';
import { humanoidPose, act2, ACT } from './humanoid.js';
import { twoSided, HDR, RUSTY, DARKSTEEL } from './parts.js';
import { buildHeadsman, HEADSMAN_ANIM } from './dungeon.js';
import { skullGeo } from '../../world/props.js';
import { addFx, fxOf, fxSet, fxPos, aimTrail, swingTrailGeo, paint, softRing, softDisc, Rope, aimChain, boneWorld, boneModel, snapRot, setBone, gripIK, springTo, glowLevel, haftBasis } from './bossKit.js';

// ================================================================ The Executioner ==
// The Headsman of the Oubliette: a hulking hooded brute with a crescent greataxe.
// The axe is its own bone on the chest, animated as a weapon (yaw / pitch / roll of
// the haft and the grip position, each on a spring), and both hands are IK'd onto
// the haft, so every swing travels a real arc and the hands never let go. When he
// walks he drags it behind him, sparking on the flagstones. Broken manacle chains, a
// hangman's noose and a string of skulls swing from him (rope-simulated). At Bloodlust
// the blade heats to a glow; when he falls the axe slips from his hands and clangs down.

const EYE = 0xff3a20;
const GR = 0, GL = -0.2; // right / left hand grip positions along the haft (axe bone y)
const HEAD_Y = 1.62; // blade centre along the haft
const CH_N = 4, CH_L = 0.09; // manacle chain links (pre-scale units)
const NOOSE_N = 4, NOOSE_L = 0.085;
const TROPHY_N = 3, TROPHY_L = 0.1;

// --- the greataxe, built along +Y (butt at -0.25), blade edge facing +Z at the top
function axeParts() {
  const haft = [];
  haft.push(xf(G.cyl(0.03, 0.034, 2.2, 10), { y: 0.85 }));
  const wrap = [];
  for (let i = 0; i < 9; i++) wrap.push(xf(G.tor(0.036, 0.009, 4, 10), { y: -0.2 + i * 0.05, rx: Math.PI / 2 + 0.15 }));
  const iron = [
    xf(G.cyl(0.04, 0.03, 0.08, 8), { y: -0.27 }), xf(G.cone(0.03, 0.14, 6), { y: -0.37, rx: Math.PI }), // butt spike
    xf(G.cyl(0.042, 0.042, 0.05, 10), { y: 0.25 }), xf(G.cyl(0.042, 0.042, 0.05, 10), { y: 0.75 }),
    xf(G.cyl(0.05, 0.05, 0.5, 10), { y: HEAD_Y }), // socket
    xf(G.cone(0.04, 0.32, 6), { y: 2.0 }), // top spike
    xf(G.cone(0.035, 0.26, 4), { y: HEAD_Y + 0.05, z: -0.14, rx: -Math.PI / 2 - 0.25, sx: 0.4 }), // back hook
  ];
  // crescent blade outline in (z, y)
  const pts = [[0.04, 1.4], [0.22, 1.3], [0.46, 1.16], [0.66, 1.05], [0.75, 1.07], [0.78, 1.2], [0.84, 1.42], [0.86, 1.62], [0.83, 1.84], [0.75, 2.02], [0.68, 2.1], [0.6, 2.08], [0.44, 1.94], [0.24, 1.86], [0.04, 1.86]];
  const R = rng(17);
  const notched = pts.map(([z, y], i) => (i > 4 && i < 10 && R() < 0.5 ? [z - 0.02 - R() * 0.03, y] : [z, y]));
  const blade = extrude(notched, 0.05, 0.008, 1);
  xf(blade, { ry: -Math.PI / 2 });
  deform(blade, (v) => { const k = 1 - smooth(0.4, 0.86, v.z) * 0.85; v.x *= k; }, true);
  return { haft: mergeRaw(haft), wrap: mergeRaw(wrap), iron: mergeRaw(iron), blade, outline: notched };
}

// body poses (arms come from the haft IK)
const B_REST = { chest: [0.14, 0, 0], spine: [0.08, 0, 0], head: [0.1, 0, 0], thighL: [-0.12, 0, 0.1], thighR: [0.05, 0, -0.1], shinL: [0.18, 0, 0], shinR: [0.12, 0, 0] };
const B_SLAM_W = { chest: [-0.32, 0.1, 0], spine: [-0.2, 0, 0], neck: [0.1, 0, 0], head: [0.35, 0, 0], hips: [0, 0, 0, 0, -0.05, -0.12], thighL: [-0.5, 0, 0.05], shinL: [0.4, 0, 0], thighR: [0.28, 0, -0.05], shinR: [0.2, 0, 0] };
const B_SLAM_S = { chest: [0.55, 0, 0], spine: [0.48, 0, 0], head: [-0.5, 0, 0], hips: [0, 0, 0, 0, -0.3, 0.24], thighL: [-1.05, 0, 0.05], shinL: [1.15, 0, 0], footL: [-0.15, 0, 0], thighR: [0.2, 0, -0.05], shinR: [0.8, 0, 0], footR: [-0.35, 0, 0] };
const B_SWEEP_W = { chest: [0.02, -0.55, 0], spine: [0.06, -0.25, 0], head: [0, 0.7, 0], hips: [0, -0.32, 0, 0, -0.14, -0.05], thighL: [-0.38, 0, 0.12], thighR: [0.28, 0, -0.12], shinL: [0.5, 0, 0], shinR: [0.45, 0, 0] };
const B_SWEEP_S = { chest: [0.14, 0.6, 0], spine: [0.1, 0.3, 0], head: [0, -0.65, 0], hips: [0, 0.38, 0, 0, -0.16, 0.16], thighL: [0.28, 0, 0], thighR: [-0.65, 0, 0], shinR: [0.5, 0, 0] };
const B_CHARGE_W = { chest: [0.42, -0.35, 0], spine: [0.32, -0.1, 0], head: [-0.5, 0.3, 0], hips: [0, 0, 0, 0, -0.22, -0.1], thighL: [-0.85, 0, 0], shinL: [1.05, 0, 0], thighR: [0.38, 0, 0], shinR: [0.75, 0, 0] };
const B_CHARGE_S = { chest: [0.5, -0.25, 0], spine: [0.36, 0, 0], head: [-0.55, 0.25, 0], hips: [0, 0, 0, 0, -0.1, 0.12] };
const B_ROAR_W = { chest: [0.35, 0, 0], spine: [0.25, 0, 0], neck: [0.3, 0, 0], head: [0.2, 0, 0], armL: [-0.2, 0, -0.3], foreL: [-1.3, 0, 0], hips: [0, 0, 0, 0, -0.14, 0], thighL: [-0.3, 0, 0.15], thighR: [-0.3, 0, -0.15], shinL: [0.5, 0, 0], shinR: [0.5, 0, 0] };
const B_ROAR_S = { chest: [-0.38, 0, 0], spine: [-0.16, 0, 0], neck: [-0.35, 0, 0], head: [-0.4, 0, 0], jaw: [0.9, 0, 0], armL: [-0.6, 0, 1.3], foreL: [-0.7, 0, 0], handL: [0, 0, 0.4], hips: [0, 0, 0, 0, -0.06, 0], thighL: [0, 0, 0.22], thighR: [0, 0, -0.22] };

// weapon poses: haft yaw th (0 = forward), pitch ph (+ up, past PI/2 = back over the head),
// roll ps (0: edge toward the haft's 'up', PI: away), grip R position in chest space, left hand weight
const AX = {
  rest: { th: 0.1, ph: -1.0, ps: 0, gx: 0.0, gy: 0.02, gz: 0.46, wL: 1 },
  drag: { th: -2.78, ph: -0.5, ps: 1.4, gx: -0.43, gy: -0.38, gz: 0.04, wL: 0 },
  slamW: { th: 0.05, ph: 2.4, ps: Math.PI, gx: 0.02, gy: 0.82, gz: -0.04, wL: 1 },
  slamS: { th: 0.0, ph: 0.72, ps: Math.PI, gx: 0.0, gy: -0.3, gz: 0.56, wL: 1 },
  sweepW: { th: -1.35, ph: 0.75, ps: -Math.PI / 2, gx: -0.4, gy: 0.12, gz: -0.02, wL: 1 },
  sweepS: { th: 0.95, ph: 0.08, ps: -Math.PI / 2, gx: 0.34, gy: 0.04, gz: 0.3, wL: 1 },
  chargeW: { th: 0.05, ph: 2.8, ps: Math.PI, gx: -0.28, gy: 0.52, gz: 0.04, wL: 1 },
  roar: { th: 0.25, ph: 1.1, ps: 0.2, gx: -0.36, gy: 0.98, gz: 0.12, wL: 0 },
};
const AXK = ['th', 'ph', 'ps', 'gx', 'gy', 'gz', 'wL'];
function mixAx(out, a, b, u) { for (const k of AXK) out[k] = lerp(a[k], b[k], u); return out; }
function setAx(out, a) { for (const k of AXK) out[k] = a[k]; return out; }

export const executioner = {
  id: 'executioner', height: 4.6, radius: 1.2, boss: true, eyeColor: EYE, magicColor: 0xff5020, defaultAttack: 'slam', attackTypes: ['slam', 'sweep', 'charge', 'roar'], orbSize: 0.16,
  build(rig) {
    rig.scale = 1.8;
    const D = buildHeadsman(rig, { boss: true, noAxe: true });
    rig.bone('axe', 'chest', AX.rest.gx, AX.rest.gy, AX.rest.gz);
    // ---- the greataxe
    const ax = axeParts();
    rig.add('axe', 'wood', ax.haft, {}, { cfn: (v) => { const k = 0.5 + vnoise(v.x * 30, v.y * 4, v.z * 30, 5) * 0.4; return [0.55 * k, 0.4 * k, 0.3 * k]; } });
    rig.add('axe', 'leather', ax.wrap, {}, { c: [0.25, 0.14, 0.1] });
    rig.add('axe', 'iron', ax.iron, {}, { c: DARKSTEEL });
    rig.add('axe', 'steel', ax.blade, {}, {
      cfn: (v) => {
        const edge = smooth(0.62, 0.84, v.z), n = vnoise(v.y * 9, v.z * 9, v.x * 40, 3), bl = fbm3(v.y * 4, v.z * 4, 1, 8, 3);
        const blood = smooth(0.52, 0.66, bl) * (1 - edge * 0.6), rust = smooth(0.6, 0.75, n) * (1 - edge);
        const k = lerp(0.55, 1.15, edge) * (0.85 + n * 0.25);
        return [lerp(lerp(k, 0.62 * k, rust), 0.32, blood), lerp(lerp(k, 0.42 * k, rust), 0.03, blood), lerp(lerp(k * 1.02, 0.3 * k, rust), 0.03, blood)];
      },
    });
    rig.add('axe', 'cloth', tube([[0.0, HEAD_Y - 0.3, -0.04], [0.04, HEAD_Y - 0.45, -0.06], [0.01, HEAD_Y - 0.65, -0.05]], 0.014, 6, 3), {}, { c: [0.32, 0.02, 0.02], anim: (v) => clamp((HEAD_Y - 0.3 - v.y) * 3) });
    rig.socket('muzzle', 'axe', 0, HEAD_Y, 0.5);

    // ---- more brute: butcher's apron, hangman's noose, wrist manacles, a string of skulls
    const apron = panel(0.5, 0.95, { ws: 6, hs: 9, tatter: 0.18, seed: 21, curve: 0.1, taperBot: 1.1 });
    rig.add('hips', 'leather', apron, { y: 0.06, z: 0.255, rx: -0.05 }, {
      cfn: (v) => { const n = fbm3(v.x * 5, v.y * 4, 2, 31, 3), d = 0.8 + 0.3 * vnoise(v.x * 30, v.y * 30, 1, 5); const bl = smooth(0.5, 0.68, n + smooth(-0.3, -0.85, v.y) * 0.25); return [lerp(0.62, 0.3, bl) * d, lerp(0.5, 0.02, bl) * d, lerp(0.38, 0.02, bl) * d]; },
      anim: (v) => clamp(-v.y / 0.95) * 0.8,
      skin: (v) => { const t = clamp((-v.y - 0.08) / 0.7) * 0.75, l = clamp(0.5 + v.x * 3); return [['hips', 1 - t], ['thighL', t * l], ['thighR', t * (1 - l)]]; },
    });
    rig.add('hips', 'iron', mergeRaw([xf(G.tor(0.03, 0.008, 4, 8), { x: 0.2, y: 0.06, z: 0.24 }), xf(G.tor(0.03, 0.008, 4, 8), { x: -0.2, y: 0.06, z: 0.24 })]), {}, { c: RUSTY });
    // noose: knot at the throat, frayed tail on a rope
    rig.bone('noose0', 'neck', 0.0, 0.02, 0.12);
    for (let i = 1; i < NOOSE_N; i++) rig.bone('noose' + i, 'noose' + (i - 1), 0, -NOOSE_L, 0);
    const hemp = (v) => { const k = 0.8 + 0.3 * Math.sin(v.y * 160 + v.x * 40); return [0.5 * k, 0.4 * k, 0.26 * k]; };
    rig.add('neck', 'cloth', xf(G.tor(0.115, 0.018, 6, 20), { rx: Math.PI / 2 + 0.2, sz: 0.9 }), { y: 0.04, z: 0.01 }, { cfn: hemp });
    rig.add('noose0', 'cloth', mergeRaw([0, 1, 2, 3].map((i) => xf(G.tor(0.028, 0.014, 5, 10), { y: -i * 0.03, rx: Math.PI / 2 }))), {}, { cfn: hemp });
    const tail = tube([[0, -0.08, 0], [0, -0.08 - NOOSE_L * (NOOSE_N - 1) * 0.5, 0], [0, -0.08 - NOOSE_L * (NOOSE_N - 1), 0]], (u) => 0.015 + (u > 0.9 ? 0.008 : 0), 12, 5);
    rig.add('noose0', 'cloth', tail, {}, { cfn: hemp, skin: chainSkin(Array.from({ length: NOOSE_N }, (_, i) => [`noose${i}`, -i * NOOSE_L]).reverse(), (v) => v.y) });
    // manacles with broken chains on both wrists
    for (const S of ['L', 'R']) {
      rig.add('fore' + S, 'iron', mergeRaw([xf(G.cyl(0.075, 0.075, 0.06, 12, true), { y: -D.fore + 0.06 }), xf(G.tor(0.075, 0.012, 4, 14), { rx: Math.PI / 2, y: -D.fore + 0.03 }), xf(G.tor(0.075, 0.012, 4, 14), { rx: Math.PI / 2, y: -D.fore + 0.09 }), xf(G.tor(0.022, 0.007, 4, 8), { y: -D.fore + 0.06, z: -0.085 })]), {}, { c: RUSTY });
      rig.bone(`cuff${S}0`, 'fore' + S, 0, -D.fore + 0.06, -0.09);
      for (let i = 1; i < CH_N; i++) rig.bone(`cuff${S}${i}`, `cuff${S}${i - 1}`, 0, -CH_L, 0);
      for (let i = 0; i < CH_N; i++) rig.add(`cuff${S}${i}`, 'iron', mergeRaw([xf(G.tor(0.026, 0.008, 4, 8), { y: -0.03, sy: 1.5 }), xf(G.tor(0.026, 0.008, 4, 8), { y: -0.075, sy: 1.5, ry: Math.PI / 2 })]), {}, { c: DARKSTEEL });
    }
    // a string of skulls hung from the belt on a chain
    rig.bone('troph0', 'hips', 0.2, -0.04, -0.2);
    for (let i = 1; i < TROPHY_N; i++) rig.bone('troph' + i, 'troph' + (i - 1), 0, -TROPHY_L, 0);
    for (let i = 0; i < TROPHY_N; i++) rig.add('troph' + i, 'iron', mergeRaw([xf(G.tor(0.022, 0.007, 4, 8), { y: -0.03, sy: 1.5 }), xf(G.tor(0.022, 0.007, 4, 8), { y: -0.07, sy: 1.5, ry: Math.PI / 2 })]), {}, { c: DARKSTEEL });
    rig.add(`troph${TROPHY_N - 1}`, 'bone', mergeRaw([xf(skullGeo(), { y: -0.14, s: 0.75, ry: 0.4 }), xf(skullGeo(), { y: -0.2, x: 0.05, s: 0.6, ry: -0.9, rz: 0.5 })]), {}, { c: [0.85, 0.78, 0.62] });
    // a gaol lantern on a short chain at his left hip, a coal burning red inside: it marks him in the dark
    rig.bone('lant0', 'hips', 0.27, -0.02, 0.08);
    for (let i = 1; i < TROPHY_N; i++) rig.bone('lant' + i, 'lant' + (i - 1), 0, -TROPHY_L * 0.8, 0);
    for (let i = 0; i < TROPHY_N; i++) rig.add('lant' + i, 'iron', mergeRaw([xf(G.tor(0.02, 0.006, 4, 8), { y: -0.025, sy: 1.5 }), xf(G.tor(0.02, 0.006, 4, 8), { y: -0.06, sy: 1.5, ry: Math.PI / 2 })]), {}, { c: DARKSTEEL });
    const lantern = mergeRaw([
      xf(G.cyl(0.05, 0.06, 0.02, 8), { y: -0.1 }), xf(G.cone(0.065, 0.06, 8), { y: -0.07 }), xf(G.tor(0.015, 0.005, 3, 8), { y: -0.035 }),
      xf(G.cyl(0.065, 0.065, 0.02, 8), { y: -0.24 }), ...[0, 1, 2, 3].map((k) => xf(G.box(0.008, 0.13, 0.008), { x: Math.sin(k * 1.57 + 0.78) * 0.058, z: Math.cos(k * 1.57 + 0.78) * 0.058, y: -0.17 })),
    ]);
    rig.add(`lant${TROPHY_N - 1}`, 'iron', lantern, {}, { c: RUSTY });
    rig.add(`lant${TROPHY_N - 1}`, 'glow', bumpy(G.ico(0.035, 1), 0.008, 20, 3), { y: -0.2 }, { c: HDR(0xff4a18, 5) });
    rig.add(`lant${TROPHY_N - 1}`, 'glow', xf(G.cyl(0.05, 0.055, 0.1, 8, true), { y: -0.17 }), {}, { c: HDR(0xff3010, 0.7) });
    // heavier hood: a ragged black mantle over the shoulders and a stitched mouth slit
    const st = [];
    for (let i = 0; i < 5; i++) st.push(xf(G.box(0.006, 0.03, 0.006), { x: -0.024 + i * 0.012, y: 0.06, z: 0.147 }));
    rig.add('head', 'bone', mergeRaw(st), {}, { c: [0.6, 0.5, 0.35] });
    // bigger burning eyes
    rig.pair('head', 'head', 'glow', xf(G.sph(0.016, 8, 6), { sx: 1.6, sy: 0.7 }), { x: 0.047, y: 0.14, z: 0.143 }, { c: HDR(EYE, 10) });

    // ---- fx: swing trail (on the chest), impact ring + dust (on the base), heated edge and drag sparks (on the axe)
    addFx(rig, 'chest', 'trail', swingTrailGeo(1.15, 2.05, 2.4, HDR(0xffd0b0, 0.55)));
    addFx(rig, 'base', 'ring', softRing(0.75, 1.0, 40, HDR(0xffc090, 0.9), 0.6), { y: 0.03 });
    addFx(rig, 'base', 'dust', softDisc(1, 28, [0.13, 0.11, 0.09], 1.2), { y: 0.05 });
    const hot = paint(xf(extrude(ax.outline.filter((_, i) => i > 2 && i < 12).concat([[0.62, 1.7], [0.7, 1.45]]), 0.062, 0, 1), { ry: -Math.PI / 2 }), (v) => { const e = smooth(0.6, 0.84, v.z); return [5 * (0.4 + e), 1.4 * (0.3 + e * 0.8), 0.22, 0.35 + e * 0.65]; });
    addFx(rig, 'axe', 'hot', hot);
    const sp = [];
    const RS = rng(5);
    for (let i = 0; i < 9; i++) sp.push(xf(G.box(0.012, 0.22 + RS() * 0.2, 0.004), { x: (RS() - 0.5) * 0.2, y: 0.12 + RS() * 0.1, z: (RS() - 0.5) * 0.1, rx: (RS() - 0.5) * 1.8, rz: (RS() - 0.5) * 1.8 }));
    addFx(rig, 'axe', 'sparks', paint(mergeRaw(sp), () => [4, 2.2, 0.8, 1]), { y: HEAD_Y, z: 0.72 });
    return D;
  },
  pose(m, s, P, dt) {
    const st = m.state, T = m.time;
    if (st.born === undefined) st.born = T;
    const rate = humanoidPose(m, s, P, dt);
    const an = s.anim, at = s.attackType, p = s.progress;
    // hit flinch
    if (m._flash > (st.lastFlash ?? 0) + 0.2) st.hitT = T;
    st.lastFlash = m._flash;
    const hit = st.hitT !== undefined && T - st.hitT < 0.6 ? Math.exp(-(T - st.hitT) * 7) : 0;
    if (hit) { P.r('chest', -0.12 * hit, 0.1 * hit); P.r('head', -0.2 * hit); }
    // intro: head bowed, then he straightens, eyes kindling, and bellows
    const age = T - st.born;
    let eyeK = 1;
    if (an === 'idle' && age < 2.6) { const r = introPose(P, T, age / 2.4); eyeK = r; }
    if (an === 'spawn') eyeK = introPose(P, T, p);
    // phase change: Gallows Call (axe raised, a bellow) / Bloodlust (the blade ignites)
    const ph = st.phaseT !== undefined && an !== 'death' ? (T - st.phaseT) / 2.2 : 9;
    if (ph < 1) { const k = smooth(0, 0.15, ph) * (1 - smooth(0.75, 1, ph)); P.apply(B_ROAR_S, k); P.r('head', Math.sin(T * 47) * 0.04 * k, Math.sin(T * 39) * 0.05 * k); }
    st.heat = (st.heat ?? 0) + ((st.hot ? 1 : 0) - (st.heat ?? 0)) * (1 - Math.exp(-1.5 * dt));
    eyeK *= 1 + st.heat * 0.8;
    // ---- weapon target
    const tgt = st.axT ?? (st.axT = { th: 0, ph: 0, ps: 0, gx: 0, gy: 0, gz: 0, wL: 1 });
    let om = 7, ze = 1, wR = 1;
    const w = st.moveW ?? 0;
    const dead = an === 'death';
    if (an === 'windup' || an === 'attack' || an === 'cast') {
      const wu = an === 'windup';
      if (at === 'sweep') { setAx(tgt, wu ? AX.sweepW : AX.sweepS); om = wu ? 7 : 20; ze = wu ? 1 : 0.62; if (!wu && p > 0.7) { mixAx(tgt, AX.sweepS, AX.rest, smooth(0.7, 1, p) * 0.6); om = 6; } }
      else if (at === 'charge') {
        if (wu) { setAx(tgt, AX.chargeW); om = 8; }
        else { setAx(tgt, AX.chargeW); if (p > 0.7) { setAx(tgt, AX.slamS); om = 22; ze = 0.6; } }
      } else if (at === 'roar' || an === 'cast') { setAx(tgt, AX.roar); om = 8; ze = 0.8; }
      else { // slam / chop / quake
        if (wu) { setAx(tgt, AX.slamW); om = 6.5 + p * 2; }
        else { setAx(tgt, AX.slamS); om = 24; ze = 0.55; if (p > 0.72) { mixAx(tgt, AX.slamS, AX.rest, smooth(0.72, 1, p) * 0.7); om = 5; ze = 1; } }
      }
    } else {
      mixAx(tgt, AX.rest, AX.drag, smooth(0.15, 0.7, w));
      om = 5;
    }
    if (ph < 1) { mixAx(tgt, tgt, AX.roar, smooth(0, 0.15, ph) * (1 - smooth(0.75, 1, ph))); om = 9; }
    if (an === 'idle' && age < 2.6) mixAx(tgt, AX.rest, AX.roar, bump(0.35, 0.95, age / 2.4));
    const ax = st.ax ?? (st.ax = { ...AX.rest });
    if (!dead) springTo(ax, tgt, AXK, dt, om, ze);
    P.damp(dt, rate);
    weapon(m, s, dt, ax, wR, dead);
    secondary(m, s, dt);
    effects(m, s, dt, ax, eyeK);
    return 0;
  },
  onFx(m, kind, extra) {
    const st = m.state;
    if (kind === 'phase') st.phaseT = m.time;
    if (kind === 'enrage' || (kind === 'phase' && extra.n >= 2)) st.hot = true;
  },
  anim: {
    ...HEADSMAN_ANIM, breath: 1.0, look: 0.45, armSwing: 0.1,
    rest: { armL: [-0.4, 0, -0.1], foreL: [-1.0, 0, 0], armR: [-0.4, 0, 0.1], foreR: [-1.0, 0, 0] },
    stance: (P, m, s) => { HEADSMAN_ANIM.stance(P, m, s); if (s.anim === 'idle' || s.anim === 'move') P.apply(B_REST, 1 - (m.state.moveW ?? 0)); },
    actions: {
      slam: act2(B_SLAM_W, B_SLAM_S, { hit: 0.24, recover: 0.72, recoverAmt: 0.6, tremble: 0.02, windupExtra: (P, p, m) => { const k = smooth(0.6, 1, p); P.r('chest', Math.sin(m.time * 31) * 0.015 * k); } }),
      sweep: act2(B_SWEEP_W, B_SWEEP_S, { hit: 0.3, recover: 0.7, recoverAmt: 0.6 }),
      charge: act2(B_CHARGE_W, B_CHARGE_S, { hit: 0.15, recover: 0.85, recoverAmt: 0.25 }),
      roar: act2(B_ROAR_W, B_ROAR_S, { hit: 0.18, recover: 0.78, tremble: 0.05, strikeExtra: (P, p, m) => { const k = bump(0.1, 0.8, p) * 0.05; P.r('chest', Math.sin(m.time * 45) * k, Math.sin(m.time * 38) * k); P.r('head', Math.sin(m.time * 51) * k * 2, Math.sin(m.time * 33) * k * 2); } }),
    },
    death: (P, p, m, s) => deathPose(P, p, m, s),
    spawn: (P, p, m) => { introPose(P, m.time, p); return 12; },
  },
};

function introPose(P, T, u) {
  u = clamp(u);
  const bow = 1 - smooth(0.15, 0.5, u), roar = bump(0.45, 1, u);
  P.r('neck', 0.4 * bow); P.r('head', 0.5 * bow); P.r('chest', 0.2 * bow);
  P.apply(B_ROAR_S, roar);
  P.r('head', Math.sin(T * 47) * 0.04 * roar);
  return 0.15 + 0.85 * smooth(0.2, 0.55, u) + roar * 0.6;
}

// on his knees, the axe slipping away; a heave as if to rise; then face down
const D_KNEEL = { hips: [0.15, 0, 0, 0, -0.5, -0.05], thighL: [-0.35, 0, 0.12], shinL: [1.7, 0, 0], footL: [0.9, 0, 0], thighR: [0.05, 0, -0.12], shinR: [1.55, 0, 0], footR: [1.0, 0, 0], spine: [0.3, 0, 0], chest: [0.2, 0, 0], neck: [0.2, 0, 0], head: [0.3, 0, 0], armL: [0.15, 0, 0.2], foreL: [-0.4, 0, 0], armR: [0.2, 0, -0.25], foreR: [-0.3, 0, 0] };
const D_HIT = { chest: [-0.4, 0.2, 0], spine: [-0.25, 0, 0], head: [-0.5, -0.3, 0], armL: [0.3, 0, 0.7], armR: [0.4, 0, -0.8], foreL: [-0.5, 0, 0], foreR: [-0.4, 0, 0], hips: [0, 0, 0, 0, -0.06, -0.15] };
const D_FALLEN = { hips: [1.45, 0.25, 0.1, 0, -0.98, 0.42], thighL: [-0.1, 0, 0.18], shinL: [0.35, 0, 0], thighR: [-0.4, 0, -0.1], shinR: [1.0, 0, 0], footL: [0.5, 0, 0], footR: [0.5, 0, 0], spine: [0.05, 0, 0], chest: [0.02, 0, -0.08], neck: [-0.2, 0, 0], head: [-0.25, 1.1, 0.1], armL: [-0.6, 0, 1.3], foreL: [-0.4, 0, 0], armR: [0.4, 0, -1.1], foreR: [-0.6, 0, 0] };
function deathPose(P, p, m, s) {
  const t = Math.max(s.t, p * 1.1);
  const h = bump(0, 0.5, t), k = smooth(0.3, 0.9, t) * (1 - smooth(1.9, 2.5, t)), heave = bump(1.2, 2.0, t), f = easeIn(smooth(1.95, 2.55, t));
  P.apply(D_HIT, h * (1 - smooth(0.3, 0.6, t)));
  P.apply(D_KNEEL, k);
  P.r('spine', -0.3 * heave); P.r('chest', -0.2 * heave); P.r('head', -0.45 * heave); P.p('hips', 0, 0.1 * heave, 0);
  P.r('armR', -0.6 * heave, 0, 0.3 * heave); P.r('foreR', -0.4 * heave);
  P.apply(D_FALLEN, f);
  const thud = bump(2.55, 2.75, t);
  P.p('hips', 0, 0.04 * thud, 0); P.r('head', -0.15 * thud);
  return 11;
}

// --------------------------------------------------------- weapon + hands ----
const _Mb = new THREE.Matrix4(), _Mc = new THREE.Matrix4(), _Ma = new THREE.Matrix4(), _Q = new THREE.Quaternion(), _E = new THREE.Euler(), _P = new THREE.Vector3(), _S = new THREE.Vector3();
const _gR = new THREE.Vector3(), _gL = new THREE.Vector3(), _axis = new THREE.Vector3(), _poleR = new THREE.Vector3(), _poleL = new THREE.Vector3();
function weapon(m, s, dt, ax, wR, dead) {
  const st = m.state;
  if (dead) { dropAxe(m, s, dt); return; }
  st.drop = null;
  haftBasis(ax.th, ax.ph, ax.ps, _Mb);
  _Q.setFromRotationMatrix(_Mb);
  _E.setFromQuaternion(_Q, 'XYZ');
  snapRot(m, 'axe', _E);
  setBone(m, 'axe', ax.gx, ax.gy, ax.gz, 1);
  // hands onto the haft
  boneWorld(m, m.bones.axe, _Ma);
  _gR.set(0, GR, 0).applyMatrix4(_Ma);
  _gL.set(0, GL, 0).applyMatrix4(_Ma);
  _axis.setFromMatrixColumn(_Ma, 1).normalize();
  boneWorld(m, m.bones.chest, _Mc);
  _Mc.decompose(_P, _Q, _S);
  _poleR.set(-1, -0.6, -0.5).applyQuaternion(_Q);
  _poleL.set(1, -0.6, -0.5).applyQuaternion(_Q);
  gripIK(m, -1, _gR, _axis, _poleR, wR, false);
  gripIK(m, 1, _gL, _axis, _poleL, clamp(ax.wL), true);
}
// the axe slips from his grip and falls, toppling flat onto the floor beside him
const _m0 = new THREE.Matrix4(), _m1 = new THREE.Matrix4(), _q0 = new THREE.Quaternion(), _q1 = new THREE.Quaternion(), _p0 = new THREE.Vector3(), _p1 = new THREE.Vector3();
function dropAxe(m, s, dt) {
  const st = m.state, t = Math.max(s.t, s.progress * 1.1);
  const scaler = m.bones.base.parent; // model space = inside the scaler
  if (!st.drop) {
    // model-space (scaler space) transform at the moment of death
    boneModel(m, m.bones.axe, _m0);
    _m0.premultiply(_m1.compose(scaler.position, scaler.quaternion, scaler.scale).invert());
    _m0.decompose(_p0, _q0, _S);
    // resting place: flat on the floor ahead-right, edge out
    haftBasis(-0.9, 0.0, -Math.PI / 2, _m1);
    _q1.setFromRotationMatrix(_m1);
    _p1.set(-0.9, 0.04, 0.9);
    st.drop = { p0: _p0.clone(), q0: _q0.clone(), p1: _p1.clone(), q1: _q1.clone(), t0: Math.min(t, 0.5) };
  }
  const D = st.drop;
  const u = clamp((t - 0.45) / 0.55);
  const fall = easeIn(u), bounce = bump(1, 1.25, u * 1.25 + 0.0001) * 0.06 + (u >= 1 ? bump(0, 0.25, t - 1.0) * 0.08 : 0);
  _P.lerpVectors(D.p0, D.p1, smooth(0, 1, u));
  _P.y = lerp(D.p0.y, D.p1.y, fall) + bounce;
  _Q.slerpQuaternions(D.q0, D.q1, easeIn(clamp(u * 1.1)));
  // back into chest-local space
  _m0.compose(_P, _Q, _S.set(1, 1, 1));
  _m0.premultiply(_m1.compose(scaler.position, scaler.quaternion, scaler.scale));
  boneModel(m, m.bones.chest, _m1);
  _m0.premultiply(_m1.invert());
  _m0.decompose(_P, _Q, _S);
  _E.setFromQuaternion(_Q, 'XYZ');
  snapRot(m, 'axe', _E);
  setBone(m, 'axe', _P.x, _P.y, _P.z, 1);
  st.dropT = u;
}

// ------------------------------------------------------------ secondary ----
const DOWN = new THREE.Vector3(0, -1, 0);
const AX_CH = Array.from({ length: CH_N }, () => DOWN), AX_NO = Array.from({ length: NOOSE_N - 1 }, () => DOWN), AX_TR = Array.from({ length: TROPHY_N }, () => DOWN);
const N_CUFF = { L: Array.from({ length: CH_N }, (_, i) => `cuffL${i}`), R: Array.from({ length: CH_N }, (_, i) => `cuffR${i}`) };
const N_NOOSE = Array.from({ length: NOOSE_N - 1 }, (_, i) => `noose${i + 1}`);
const N_TROPH = Array.from({ length: TROPHY_N }, (_, i) => `troph${i}`);
const N_LANT = Array.from({ length: TROPHY_N }, (_, i) => `lant${i}`);
const _a = new THREE.Vector3(), _Mw = new THREE.Matrix4();
function secondary(m, s, dt) {
  const st = m.state;
  if (!st.ropes) {
    const sc = 1.8;
    st.ropes = { L: new Rope(CH_N, CH_L * sc), R: new Rope(CH_N, CH_L * sc), noose: new Rope(NOOSE_N - 1, NOOSE_L * sc), troph: new Rope(TROPHY_N, TROPHY_L * sc), lant: new Rope(TROPHY_N, TROPHY_L * 0.8 * sc) };
  }
  const R = st.ropes, rs = m.root.scale.x;
  m.root.updateMatrix();
  const floor = m.root.position.y + 0.05;
  for (const S of ['L', 'R']) {
    boneWorld(m, m.bones[`cuff${S}0`].parent, _Mw);
    _a.copy(m.bones[`cuff${S}0`].position).applyMatrix4(_Mw);
    R[S].seg.fill(CH_L * 1.8 * rs);
    R[S].step(_a, dt, { damp: 1.0, floor, iters: 2 });
    aimChain(m, N_CUFF[S], R[S], AX_CH);
  }
  boneWorld(m, m.bones.noose0, _Mw);
  _a.set(0, -0.08, 0).applyMatrix4(_Mw);
  R.noose.step(_a, dt, { damp: 2, floor, iters: 2 });
  aimChain(m, N_NOOSE, R.noose, AX_NO);
  boneWorld(m, m.bones.troph0.parent, _Mw);
  _a.copy(m.bones.troph0.position).applyMatrix4(_Mw);
  R.troph.step(_a, dt, { damp: 1.2, floor, iters: 2 });
  aimChain(m, N_TROPH, R.troph, AX_TR);
  boneWorld(m, m.bones.lant0.parent, _Mw);
  _a.copy(m.bones.lant0.position).applyMatrix4(_Mw);
  R.lant.step(_a, dt, { damp: 1.4, floor, iters: 2 });
  aimChain(m, N_LANT, R.lant, AX_TR);
}

// ------------------------------------------------------------------- fx ----
function effects(m, s, dt, ax, eyeK) {
  const st = m.state, F = fxOf(m);
  // swing trail follows the haft; it shows only when the axe is really moving
  // swing trail in the plane of the swing; it shows only when the axe is really moving
  const speed = aimTrail(F, 'trail', ax);
  st.trailA = (st.trailA ?? 0) + (smooth(3.5, 9, speed) - (st.trailA ?? 0)) * (1 - Math.exp(-(speed > 3.5 ? 30 : 8) * dt));
  fxSet(F, 'trail', st.trailA * 0.9);
  // slam impact: ring + dust where the blade meets the floor
  const an = s.anim, at = s.attackType, p = s.progress;
  const chop = an === 'attack' && (at === 'slam' || at === 'charge');
  const impactP = at === 'charge' ? 0.82 : 0.22;
  if (chop && p >= impactP && (st.lastP ?? 1) < impactP) {
    boneModel(m, m.bones.axe, _Mw);
    _a.set(0, HEAD_Y, 0.5).applyMatrix4(_Mw);
    const sc = m.bones.base.parent.scale.x || 1;
    st.imp = { t: m.time, x: _a.x / sc, z: _a.z / sc };
  }
  st.lastP = an === 'attack' ? p : 1;
  const it = st.imp ? m.time - st.imp.t : 9;
  if (st.imp) { fxPos(F, 'ring', st.imp.x, 0.03, st.imp.z); fxPos(F, 'dust', st.imp.x, 0.05, st.imp.z); }
  const ru = clamp(it / 0.5), du = clamp(it / 1.4);
  fxSet(F, 'ring', (1 - ru) * (it < 0.5 ? 1 : 0), 0.3 + easeOut(ru) * 1.9);
  fxSet(F, 'dust', (1 - du) * 0.55 * (it < 1.4 ? 1 : 0), 0.4 + easeOut(du) * 1.4);
  // the heated blade
  const heat = st.heat ?? 0;
  fxSet(F, 'hot', heat * (0.75 + 0.25 * Math.sin(m.time * 7) * Math.sin(m.time * 3.1)));
  // drag sparks when walking with the head on the stones
  const drag = smooth(0.5, 0.9, st.moveW ?? 0) * (an === 'move' || an === 'idle' ? 1 : 0);
  const fl = Math.max(0, Math.sin(m.time * 37) * Math.sin(m.time * 23 + 1));
  fxSet(F, 'sparks', drag * fl * 0.6, 0.35 + fl * 0.5);
  glowLevel(m, eyeK);
}
