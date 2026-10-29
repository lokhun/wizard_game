import * as THREE from 'three';
import { G, xf, lathe, shell, tube, extrude, deform, bumpy, mergeRaw, chainSkin, panel, spikeRing, rng, vnoise, fbm3, clamp, lerp, smooth, bump, easeOut, easeIn, easeInOut, TAU } from './core.js';
import { humanSkeleton, humanoidPose, act2 } from './humanoid.js';
import { addPlate, addTabard, hood, pauldron, twoSided, HDR, GOLDTRIM } from './parts.js';
import { wounds } from './bossKit.js';
import { addFx, fxOf, fxSet, fxPos, fxRot, paint, softRing, softDisc, softColumn, Rope, aimChain, boneWorld, boneModel, snapRot, setBone, springTo, glowLevel, wield, swingTrailGeo, aimTrail, panelBand, embroideryOf } from './bossKit.js';

// ================================================================= The Hollow King ==
// The last lord of the Ashen Keep: a towering suit of blackened, gold-chased plate with
// nothing inside but cold soul-light. A crown of spikes floats above the helm, burning
// with pale soul-fire; light leaks from the cracks in his breastplate and the gaps of his
// gorget. His greatsword is a weapon bone with both gauntlets IK'd to the grip, so he sits
// with it planted between his knees, draws it as he rises from the throne, and every sweep,
// thrust and plunge carries the blade on a real arc with a trail. The crimson cape hangs
// from three simulated ropes and drags on the floor. At the Eclipse a black sun with a
// burning corona rises behind his head. In death he sinks to one knee on his planted
// sword, the crown falls, his soul streams out, and the empty armour collapses.

const HOLLOW = 0x9ad8ff, VOID = 0x7a5aff;
const CAPE_C = [-0.36, 0, 0.36], CAPE_N = 5, CAPE_L = 0.4;
const BLADE0 = 0.31, BLADE1 = 1.92;

function swordParts() {
  const W = 0.15, L0 = BLADE0, L1 = BLADE1;
  const out = [[-W / 2, L0], [-W / 2 * 0.96, L0 + 0.4], [-W / 2 * 0.86, L1 - 0.4], [-W * 0.3, L1 - 0.15], [0, L1], [W * 0.3, L1 - 0.15], [W / 2 * 0.86, L1 - 0.4], [W / 2 * 0.96, L0 + 0.4], [W / 2, L0]];
  // in (z, y): width along z, thickness along x
  const blade = extrude(out, 0.03, 0.005, 1);
  xf(blade, { ry: -Math.PI / 2 });
  deform(blade, (v) => { const k = 1 - Math.abs(v.z) / (W / 2); v.x *= 0.25 + 0.75 * clamp(k * 2.2); }, true);
  const guard = mergeRaw([
    xf(G.box(0.07, 0.05, 0.5), { y: BLADE0 - 0.02 }),
    tube([[0, BLADE0 - 0.02, 0.24], [0, BLADE0 - 0.08, 0.31], [0, BLADE0 - 0.18, 0.3]], (u) => 0.03 * (1 - u * 0.6), 8, 6),
    tube([[0, BLADE0 - 0.02, -0.24], [0, BLADE0 - 0.08, -0.31], [0, BLADE0 - 0.18, -0.3]], (u) => 0.03 * (1 - u * 0.6), 8, 6),
    xf(G.cone(0.04, 0.16, 4), { y: BLADE0 + 0.08, sx: 0.5 }),
    xf(G.sph(0.05, 10, 8), { y: -0.12 }), xf(G.cone(0.03, 0.08, 6), { y: -0.2, rx: Math.PI }),
  ]);
  const grip = mergeRaw(Array.from({ length: 8 }, (_, i) => xf(G.tor(0.026, 0.008, 4, 10), { y: -0.06 + i * 0.044, rx: Math.PI / 2 + 0.2 })).concat([xf(G.cyl(0.024, 0.026, 0.36, 8), { y: 0.1 })]));
  const runes = [];
  const R = rng(4);
  for (let i = 0; i < 9; i++) { const y = BLADE0 + 0.12 + i * 0.15; runes.push(xf(G.box(0.006, 0.05 + R() * 0.05, 0.02), { y, z: (R() - 0.5) * 0.02 })); }
  runes.push(xf(G.box(0.004, (L1 - L0) * 0.8, 0.008), { y: (L0 + L1) / 2 - 0.05 }));
  return { blade, guard, grip, runes: mergeRaw(runes) };
}

// body poses (the gauntlets come from the grip IK)
const B_REST = { chest: [0.08, 0, 0], spine: [0.04, 0, 0], head: [0.12, 0, 0], thighL: [-0.1, 0, 0.08], thighR: [0.02, 0, -0.08], shinL: [0.14, 0, 0], shinR: [0.1, 0, 0] };
const B_SWEEP_W = { chest: [0.0, -0.55, 0], spine: [0.05, -0.25, 0], head: [0, 0.6, 0], hips: [0, -0.2, 0, 0, -0.1, -0.05], thighL: [-0.3, 0, 0.1], thighR: [0.2, 0, -0.1], shinL: [0.4, 0, 0], shinR: [0.4, 0, 0] };
const B_SWEEP_S = { chest: [0.12, 0.6, 0], spine: [0.1, 0.3, 0], head: [0, -0.6, 0], hips: [0, 0.3, 0, 0, -0.12, 0.12], thighL: [0.2, 0, 0], thighR: [-0.5, 0, 0], shinR: [0.4, 0, 0] };
const B_THRUST_W = { chest: [-0.05, -0.5, 0], spine: [0, -0.2, 0], head: [0, 0.5, 0], hips: [0, 0, 0, 0, -0.1, -0.1], thighL: [-0.45, 0, 0], shinL: [0.6, 0, 0], thighR: [0.3, 0, 0], shinR: [0.35, 0, 0] };
const B_THRUST_S = { chest: [0.2, 0.35, 0], spine: [0.2, 0.12, 0], head: [-0.2, -0.35, 0], hips: [0, 0, 0, 0, -0.14, 0.3], thighR: [-0.8, 0, 0], shinR: [0.55, 0, 0], thighL: [0.5, 0, 0], shinL: [0.25, 0, 0], armL: [0.3, 0, 0.5], foreL: [-0.4, 0, 0] };
const B_PLUNGE_W = { chest: [-0.25, 0, 0], spine: [-0.12, 0, 0], head: [0.25, 0, 0], hips: [0, 0, 0, 0, 0.03, -0.05], thighL: [-0.15, 0, 0], thighR: [-0.05, 0, 0] };
const B_PLUNGE_S = { chest: [0.45, 0, 0], spine: [0.35, 0, 0], head: [-0.35, 0, 0], hips: [0, 0, 0, 0, -0.38, 0.12], thighL: [-1.1, 0, 0.1], shinL: [1.5, 0, 0], thighR: [0.25, 0, -0.1], shinR: [1.55, 0, 0], footR: [0.6, 0, 0] };
const B_ROAR_W = { chest: [0.3, 0, 0], spine: [0.2, 0, 0], neck: [0.25, 0, 0], head: [0.2, 0, 0], armL: [-0.2, 0, -0.3], foreL: [-1.3, 0, 0], hips: [0, 0, 0, 0, -0.1, 0] };
const B_ROAR_S = { chest: [-0.32, 0, 0], spine: [-0.14, 0, 0], neck: [-0.3, 0, 0], head: [-0.35, 0, 0], armL: [-0.6, 0, 1.25], foreL: [-0.6, 0, 0], handL: [0, 0, 0.4], thighL: [0, 0, 0.18], thighR: [0, 0, -0.18] };
const B_BEAM_S = { chest: [0.05, 0.25, 0], spine: [0.05, 0.1, 0], head: [0, -0.2, 0], armL: [-1.55, 0, -0.1], foreL: [-0.1, 0, 0], handL: [-1.0, 0, 0], hips: [0, 0, 0, 0, -0.05, 0.05] };
// the leap: crouched under the reversed sword, then airborne, knees drawn up, the point held down for the plunge
const B_LEAP_W = { chest: [0.45, 0, 0], spine: [0.28, 0, 0], head: [-0.3, 0, 0], hips: [0, 0, 0, 0, -0.45, -0.05], thighL: [-1.25, 0, 0.1], shinL: [1.7, 0, 0], footL: [-0.4, 0, 0], thighR: [-1.1, 0, -0.1], shinR: [1.6, 0, 0], footR: [-0.4, 0, 0] };
const B_LEAP_S = { chest: [-0.2, 0, 0], spine: [-0.1, 0, 0], head: [0.3, 0, 0], hips: [0, 0, 0, 0, 0.1, 0], thighL: [-1.1, 0, 0.12], shinL: [1.6, 0, 0], thighR: [-0.7, 0, -0.12], shinR: [1.3, 0, 0], footL: [0.3, 0, 0], footR: [0.3, 0, 0] };
const SEAT = (D) => ({ hips: [0, 0, 0, 0, -D.thigh, -D.thigh * 0.85], thighL: [-1.5, 0, 0.12], thighR: [-1.5, 0, -0.12], shinL: [1.45, 0, 0], shinR: [1.45, 0, 0], spine: [0.05, 0, 0], chest: [0.05, 0, 0], head: [0.15, 0, 0] });

const AX = {
  seat: { th: 0, ph: -1.42, ps: 0, gx: 0, gy: 0.02, gz: 0.42, wL: 1 },
  rest: { th: 0, ph: -0.82, ps: 0, gx: 0, gy: 0.22, gz: 0.5, wL: 1 },
  carry: { th: 0.35, ph: -0.4, ps: 1.4, gx: -0.36, gy: -0.32, gz: 0.12, wL: 0 },
  sweepW: { th: -1.2, ph: 1.0, ps: -Math.PI / 2, gx: -0.32, gy: 0.3, gz: 0.0, wL: 1 },
  sweepS: { th: 1.0, ph: 0.05, ps: -Math.PI / 2, gx: 0.3, gy: 0.0, gz: 0.32, wL: 1 },
  thrustW: { th: 0.55, ph: 0.08, ps: 0, gx: -0.3, gy: -0.04, gz: -0.28, wL: 0 },
  thrustS: { th: 0.0, ph: 0.02, ps: 0, gx: -0.05, gy: 0.1, gz: 0.72, wL: 0 },
  plungeW: { th: 0, ph: -1.5, ps: 0, gx: 0, gy: 0.95, gz: 0.3, wL: 1 },
  plungeS: { th: 0, ph: -1.5, ps: 0, gx: 0, gy: -0.12, gz: 0.48, wL: 1 },
  roar: { th: 0.1, ph: 1.45, ps: 0, gx: -0.3, gy: 1.0, gz: 0.12, wL: 0 },
  beam: { th: 0.1, ph: 0.35, ps: 0, gx: -0.3, gy: 0.15, gz: 0.52, wL: 0 },
};
const AXK = ['th', 'ph', 'ps', 'gx', 'gy', 'gz', 'wL'];
const setAx = (o, a) => { for (const k of AXK) o[k] = a[k]; return o; };
const mixAx = (o, a, b, u) => { for (const k of AXK) o[k] = lerp(a[k], b[k], u); return o; };
const GRIPS = [{ side: -1, y: 0.2, w: 1, flip: false }, { side: 1, y: 0.04, w: 1, flip: true }];
const POLES = [[1, -0.6, -0.5], [-1, -0.6, -0.5]];

export const hollowKing = {
  lookAt: 0, recoil: 0, // (its own rig: the head turns on other axes; see EnemyInstance._layers)
  look: { bones: [['neck', 0.35], ['head', 0.65]], yaw: 1.0, pitch: 0.5 }, // (his eyes on his foe: EnemyInstance._lookWorld)
  id: 'hollowKing', height: 5.3, radius: 1.3, boss: true, eyeColor: HOLLOW, magicColor: HOLLOW, defaultAttack: 'slam', attackTypes: ['seated', 'slam', 'sweep', 'thrust', 'summon', 'roar', 'beam', 'leap'], flutter: 0.03, orbSize: 0.14,
  build(rig) {
    rig.scale = 2.15;
    const D = humanSkeleton(rig, { thigh: 0.52, shin: 0.5, ankle: 0.08, hipW: 0.12, spine: 0.2, chest: 0.4, neck: 0.1, shoulderW: 0.26, upper: 0.37, fore: 0.35 });
    rig.bone('crown', 'head', 0, 0.3, 0.0, { rate: 0.5 });
    rig.bone('blade', 'chest', AX.rest.gx, AX.rest.gy, AX.rest.gz);
    rig.bone('ground', null);
    CAPE_C.forEach((x, c) => { let prev = 'chest'; for (let i = 0; i < CAPE_N; i++) { rig.bone(`cape${c}_${i}`, prev, i ? 0 : x, i ? -CAPE_L : D.chest - 0.01, i ? 0 : -0.2); prev = `cape${c}_${i}`; } });
    // dark padded body under the plate
    const W = D.shoulderW;
    const tors = lathe([[0.001, -0.1], [W * 0.6, -0.08], [W * 0.66, 0.05], [W * 0.68, 0.05 + D.spine], [W * 0.78, 0.05 + D.spine + D.chest * 0.7], [W * 0.4, 0.05 + D.spine + D.chest + 0.03], [0.001, 0.08 + D.spine + D.chest]], 12);
    deform(tors, (v) => { v.z *= 0.7; });
    rig.add('hips', 'cloth', tors, {}, { c: [0.05, 0.04, 0.05], skin: chainSkin([['hips', 0.0], ['spine', 0.05 + D.spine * 0.45], ['chest', 0.05 + D.spine + D.chest * 0.25]], (v) => v.y) });
    for (const S of ['L', 'R']) { rig.add('arm' + S, 'cloth', G.cyl(0.05, 0.04, D.upper, 8), { y: -D.upper / 2 }, { c: [0.05, 0.04, 0.05] }); rig.add('thigh' + S, 'cloth', G.cyl(0.08, 0.06, D.thigh, 8), { y: -D.thigh / 2 }, { c: [0.05, 0.04, 0.05] }); }
    const BK = [0.3, 0.29, 0.34];
    addPlate(rig, D, { mat: 'steel', c: BK, bulk: 1.2, pauldron: 0.18, trim: true, fine: true, mailC: [0.35, 0.35, 0.4] });
    // great layered pauldrons with gold edges and a crest of spikes
    for (const S of ['L', 'R']) {
      const sx = S === 'L' ? 1 : -1;
      rig.add('arm' + S, 'steel', pauldron(0.25, 4, 32), { x: sx * 0.03, y: 0.02, rz: sx * 0.5, sy: 0.8 }, { c: BK });
      rig.add('arm' + S, 'gold', mergeRaw([0, 1, 2, 3].map((i) => xf(G.tor(0.25 * (1.04 + i * 0.07), 0.008, 3, 20), { rx: Math.PI / 2, y: -0.025 - i * 0.04 }))), { x: sx * 0.03, y: 0.02, rz: sx * 0.5, sy: 0.8 }, { c: GOLDTRIM });
      rig.add('arm' + S, 'gold', mergeRaw([0, 1, 2, 3, 4].map((i) => xf(G.cone(0.028, 0.26 - Math.abs(i - 2) * 0.05, 4), { x: sx * (0.0 + i * 0.045), y: 0.2 - Math.abs(i - 2) * 0.02, z: (i - 2) * 0.05, rz: -sx * (0.15 + i * 0.18) }))), {}, { c: GOLDTRIM });
    }
    // royal heraldry on the breastplate, and soul-light leaking through its cracks.
    // Both sit on the plate's real front (the bulky cuirass from addPlate: bulk 1.2)
    // so nothing is buried inside it.
    const CW = W * 1.08 * 1.2, CD = 0.72 * 1.15 * 1.2;
    const PROF = [[-D.spine * 0.75, 0.75], [-D.spine * 0.2, 0.85], [(D.chest + D.spine * 0.75) * 0.45 - D.spine * 0.3, 0.95], [D.chest * 0.8, 0.95], [D.chest + 0.02, 0.55]];
    const plateR = (y) => { for (let i = 1; i < PROF.length; i++) if (y <= PROF[i][0] || i === PROF.length - 1) { const [y0, r0] = PROF[i - 1], [y1, r1] = PROF[i]; return CW * lerp(r0, r1, clamp((y - y0) / (y1 - y0))); } };
    const plateZ = (x, y) => { const r = plateR(y); return Math.sqrt(Math.max(0, r * r - x * x)) * CD + Math.max(0, 1 - Math.abs(x) / CW) * 0.035; };
    const onPlate = (g, x, y, t = {}) => { const e = 0.004, ry = Math.atan(-(plateZ(x + e, y) - plateZ(x - e, y)) / (2 * e)); return xf(xf(g, t), { x, y, z: plateZ(x, y) + 0.004, ry }); };
    const HY = D.chest * 0.55;
    rig.add('chest', 'gold', mergeRaw([
      ...[-0.06, -0.02, 0.02, 0.06].map((x) => onPlate(G.box(0.042, 0.03, 0.012), x, HY)),
      ...[-1, 0, 1].map((i) => onPlate(G.cone(0.022, i === 0 ? 0.11 : 0.08, 4), i * 0.06, HY + 0.06)),
      onPlate(G.tor(0.05, 0.008, 4, 14), 0, D.chest * 0.33),
    ]), {}, { c: GOLDTRIM });
    // gold filigree: mirrored scrolls curling out from a stem down the breastplate's middle
    const fil = [];
    const onP = (x, y) => [x, y, plateZ(x, y) + 0.005];
    for (const sx of [1, -1]) for (const [cy, sc] of [[HY - 0.11, 1], [HY - 0.27, 0.8], [HY - 0.42, 0.65]]) {
      const pts = [];
      for (let k = 0; k <= 26; k++) { const th = k / 26 * 3.4 * Math.PI; const r = 0.06 * sc * Math.exp(-0.16 * th); pts.push(onP(sx * (0.012 + 0.06 * sc - Math.cos(th) * r), cy + Math.sin(th) * r * 0.9)); }
      fil.push(tube(pts, (u) => 0.0045 * (1 - u * 0.5), 40, 4));
      for (let k = 1; k < 4; k++) { const th = k * 0.9 + 0.4; const r = 0.06 * sc * Math.exp(-0.16 * th); const x0 = sx * (0.012 + 0.06 * sc - Math.cos(th) * r), y0 = cy + Math.sin(th) * r * 0.9; fil.push(tube([onP(x0, y0), onP(x0 + sx * 0.012, y0 + 0.016), onP(x0 + sx * 0.026, y0 + 0.014)], (u) => 0.003 * (1 - u * 0.6), 8, 3)); }
    }
    fil.push(tube(Array.from({ length: 12 }, (_, k) => onP(0, HY - 0.06 - k * 0.04)), 0.005, 24, 4));
    rig.add('chest', 'gold', mergeRaw(fil), {}, { c: GOLDTRIM });
    const cracks = [];
    const RC = rng(12);
    for (let i = 0; i < 5; i++) { let x = (RC() - 0.5) * 0.2, y = D.chest * (0.15 + RC() * 0.6); for (let k = 0; k < 4; k++) { const nx = x + (RC() - 0.5) * 0.06, ny = y - 0.03 - RC() * 0.04; const d = Math.hypot(nx - x, ny - y); cracks.push(onPlate(G.box(0.006, d, 0.004), (x + nx) / 2, (y + ny) / 2, { rz: Math.atan2(-(nx - x), ny - y) })); x = nx; y = ny; } }
    rig.add('chest', 'glow', mergeRaw(cracks), {}, { c: HDR(HOLLOW, 4.5) });
    // cold light in the joints of the empty armour
    for (const S of ['L', 'R']) { rig.add('fore' + S, 'glow', xf(G.tor(0.045, 0.006, 3, 12), { rx: Math.PI / 2 }), { y: 0.0 }, { c: HDR(HOLLOW, 2.2) }); rig.add('shin' + S, 'glow', xf(G.tor(0.06, 0.006, 3, 12), { rx: Math.PI / 2 }), { y: 0.02 }, { c: HDR(HOLLOW, 2.2) }); }
    addTabard(rig, D, { detail: true, c: [0.2, 0.03, 0.1], tatter: 0.35, seed: 9, top: -D.spine * 0.62, depth: plateZ(0, -D.spine * 0.62) / (W * 0.62) + 0.06, len: 0.95, w: 0.75, emblem: mergeRaw([xf(G.box(0.16, 0.035, 0.01), {}), ...[-1, 0, 1].map((i) => xf(G.cone(0.025, i === 0 ? 0.1 : 0.07, 4), { x: i * 0.055, y: 0.05 }))]) });
    // ---- the cape: hung from three ropes, it drags on the floor behind him
    // (heavy velvet in deep pipe folds, a border of gold-worked crowns and lozenges down both
    // edges and above the ragged hem)
    const capeG = panel(0.95, CAPE_L * CAPE_N, { ws: 46, hs: 50, tatter: 0.35, seed: 13, curve: 0.18, taperBot: 1.5, folds: 8, foldAmp: 0.055 });
    const capeXf = { y: D.chest - 0.01, z: -0.2, ry: Math.PI, rx: 0.06 };
    const royal = embroideryOf('diamond', GOLDTRIM, [0.3, 0.02, 0.08], 0.09);
    const capeBands = [];
    for (const su of [-1, 1]) capeBands.push(panelBand(capeG, Array.from({ length: 41 }, (_, i) => [su * 0.93, 0.01 + (i / 40) * 0.8]), 0.07, royal));
    capeBands.push(panelBand(capeG, Array.from({ length: 49 }, (_, i) => [-0.93 + (i / 48) * 1.86, 0.8]), 0.07, royal));
    xf(capeG, capeXf);
    const capeSkin = (v) => {
      const d = clamp((D.chest - 0.01 - v.y) / CAPE_L, 0, CAPE_N - 1.001);
      const i0 = Math.floor(d), f = d - i0;
      const cx = clamp((v.x - CAPE_C[0]) / (CAPE_C[2] - CAPE_C[0]) * 2, 0, 1.999), c0 = Math.floor(cx), g = cx - c0;
      return [[`cape${c0}_${i0}`, (1 - f) * (1 - g)], [`cape${c0}_${i0 + 1}`, f * (1 - g)], [`cape${c0 + 1}_${i0}`, (1 - f) * g], [`cape${c0 + 1}_${i0 + 1}`, f * g]];
    };
    rig.add('chest', 'cloth', capeG, {}, { cfn: (v) => { const n = vnoise(v.x * 8, v.y * 3, 1, 4); const k = 0.7 + n * 0.4; const hem = smooth(0.9, 1.6, D.chest - v.y); return [0.24 * k * (1 - hem * 0.5), 0.02 * k, 0.07 * k]; }, anim: (v) => clamp((D.chest - v.y) / 2) * 0.6, skin: capeSkin });
    for (const cb of capeBands) rig.add('chest', 'cloth', xf(cb.geo, capeXf), {}, { vcol: cb.vcol, anim: (v) => clamp((D.chest - v.y) / 2) * 0.6, skin: capeSkin });
    rig.add('chest', 'fur', bumpy(xf(G.tor(0.27, 0.085, 8, 24), { rx: Math.PI / 2, sz: 0.8 }), 0.014, 14, 7), { y: D.chest + 0.03 }, { cfn: (v) => (vnoise(v.x * 30, v.y * 30, v.z * 30, 3) > 0.82 ? [0.04, 0.04, 0.04] : [0.9, 0.88, 0.82]) });
    rig.add('chest', 'gold', mergeRaw([xf(G.tor(0.035, 0.01, 4, 12), { x: 0.18, y: D.chest + 0.02, z: 0.16 }), xf(G.tor(0.035, 0.01, 4, 12), { x: -0.18, y: D.chest + 0.02, z: 0.16 }), xf(G.cyl(0.006, 0.006, 0.36, 4), { y: D.chest + 0.0, z: 0.19, rz: Math.PI / 2 })]), {}, { c: GOLDTRIM });
    // ---- the hollow helm: a void with two cold eyes, soul-light seeping from the gorget
    const h = hood(0.15, 0.15, { open: 0.3, peak: 0.3 });
    rig.add('head', 'cloth', h.shell, { y: 0.1, z: -0.01 }, { c: [0.06, 0.05, 0.07] });
    rig.add('head', 'steel', shell([[0.14, -0.0], [0.152, 0.1], [0.142, 0.2], [0.07, 0.26], [0.001, 0.27]], 0.01, 18), { y: 0.0, sz: 1.08 }, { c: BK });
    rig.add('head', 'gold', mergeRaw([xf(G.tor(0.148, 0.01, 4, 20), { rx: Math.PI / 2, y: 0.02 }), xf(G.box(0.012, 0.2, 0.03), { y: 0.17, z: 0.14, rx: -0.2 })]), { sz: 1.08 }, { c: GOLDTRIM });
    rig.add('head', 'dark', xf(G.sph(0.12, 12, 10), { sz: 0.85 }), { y: 0.11, z: 0.02 });
    rig.add('head', 'spirit', xf(G.sph(0.1, 10, 8), { sz: 0.5 }), { y: 0.11, z: 0.07 }, { c: HDR(HOLLOW, 0.35) });
    rig.pair('head', 'head', 'glow', xf(G.sph(0.02, 8, 6), { sx: 1.6, sy: 0.6 }), { x: 0.045, y: 0.125, z: 0.115, rz: -0.2 }, { c: HDR(HOLLOW, 12) });
    const wisps = [];
    const RW = rng(5);
    for (let i = 0; i < 6; i++) { const a = (i / 6) * TAU; wisps.push(tube([[Math.sin(a) * 0.08, 0.0, Math.cos(a) * 0.07], [Math.sin(a + 0.5) * 0.1 + (RW() - 0.5) * 0.04, 0.1, Math.cos(a + 0.5) * 0.09], [Math.sin(a + 1) * 0.06, 0.22 + RW() * 0.08, Math.cos(a + 1) * 0.06]], (u) => 0.012 * (1 - u * 0.8), 8, 4)); }
    rig.add('neck', 'spirit', mergeRaw(wisps), { y: -0.02 }, { c: HDR(HOLLOW, 0.6), anim: 1.5 });
    const crownG = mergeRaw([xf(G.cyl(0.17, 0.16, 0.06, 20, true), {}), spikeRing(0.17, 11, 0.28, 0.03, 0.03, 0.18), spikeRing(0.16, 11, 0.14, 0.025, 0.03, 0.1)]);
    rig.add('crown', 'gold', crownG, { sz: 1.05 }, { c: [0.75, 0.58, 0.32] });
    rig.add('crown', 'glow', mergeRaw([0, 1, 3, 4, 6, 7, 9].map((i) => xf(G.oct(0.028), { x: Math.sin((i + 0.5) / 11 * TAU) * 0.172, z: Math.cos((i + 0.5) / 11 * TAU) * 0.178, y: 0.03 }))), {}, { c: HDR(HOLLOW, 6) });
    rig.add('crown', 'spirit', xf(G.tor(0.19, 0.02, 4, 24), { rx: Math.PI / 2 }), { y: 0.06 }, { c: HDR(HOLLOW, 0.9) });
    // ---- the greatsword
    const sw = swordParts();
    rig.add('blade', 'steel', sw.blade, {}, { cfn: (v) => { const e = Math.abs(v.z) / 0.075, n = vnoise(v.y * 20, v.z * 40, 1, 3); const k = lerp(0.9, 1.4, smooth(0.6, 1, e)) * (0.85 + n * 0.25); return [k, k, k * 1.08]; } });
    rig.add('blade', 'gold', sw.guard, {}, { c: GOLDTRIM });
    rig.add('blade', 'leather', sw.grip, {}, { c: [0.18, 0.06, 0.08] });
    rig.add('blade', 'glow', sw.runes, { x: 0.012 }, { c: HDR(HOLLOW, 3) });
    rig.add('blade', 'glow', sw.runes, { x: -0.012 }, { c: HDR(HOLLOW, 3) });
    rig.add('blade', 'glow', xf(G.oct(0.035), { sy: 1.4 }), { y: BLADE0 - 0.02, z: 0 }, { c: HDR(VOID, 5) });
    rig.socket('muzzle', 'blade', 0, BLADE0 + 0.14, 0); // spells gather at the hilt
    // ---- fx: soul-fire over the crown, the eclipse (corona + black sun), sword trail, impact ring, the soul leaving
    addFx(rig, 'crown', 'soul', softColumn(0.1, 0.15, 0.3, 16, HDR(HOLLOW, 0.32)), { y: 0.05 });
    const corona = softRing(0.62, 1.0, 64, HDR(0xc090ff, 2.2), 0.25);
    corona.rotateX(Math.PI / 2);
    addFx(rig, 'chest', 'corona', corona, { y: D.chest + 0.45, z: -0.42 });
    const umbra = softDisc(0.66, 48, [0.01, 0.0, 0.02], 0.15);
    umbra.rotateX(Math.PI / 2);
    addFx(rig, 'chest', 'umbra', umbra, { y: D.chest + 0.45, z: -0.43, mat: 'dark' }); // opaque black sun
    addFx(rig, 'chest', 'trail', swingTrailGeo(BLADE0 + 0.3, BLADE1, 2.3, HDR(0xb8d8ff, 0.7)));
    addFx(rig, 'ground', 'ring', softRing(0.78, 1.0, 48, HDR(VOID, 1.6), 0.6), { y: 0.04 });
    addFx(rig, 'ground', 'ascend', softColumn(0.25, 0.55, 3.2, 20, HDR(HOLLOW, 0.45)), { y: 0.5 });
    return D;
  },
  onFx(m, kind, extra) {
    const st = m.state;
    if (kind === 'phase') { st.phaseT = m.time; st.phaseN = extra.n ?? 1; if (st.phaseN === 1) st.riseT = m.time; if (st.phaseN >= 2) st.eclipse = true; }
    else if (kind === 'rise' && st.riseT === undefined) st.riseT = m.time;
    else if (kind === 'eclipse') st.eclipse = true;
    else if (kind === 'judgment') st.judgT = m.time;
  },
  pose(m, s, P, dt) {
    const st = m.state, T = m.time, D = m.spec.dims;
    if (st.born === undefined) st.born = T;
    const an = s.anim, at = s.attackType, p = s.progress, dead = an === 'death';
    const seated = at === 'seated' && (an === 'idle' || an === 'cast' || an === 'windup');
    const rate = humanoidPose(m, s, P, dt);
    // hit flinch
    if (m._flash > (st.lastFlash ?? 0) + 0.2) st.hitT = T;
    st.lastFlash = m._flash;
    const hit = st.hitT !== undefined && T - st.hitT < 0.6 ? Math.exp(-(T - st.hitT) * 7) : 0;
    if (hit && !seated) { P.r('chest', -0.08 * hit, 0.08 * hit); P.r('head', -0.12 * hit); }
    // rising from the throne (phase 1): stand, draw the planted blade, raise it and bellow
    const rt = st.riseT !== undefined ? (T - st.riseT) / 1.6 : 9;
    const rising = rt < 1 && !dead;
    if (rising) {
      const stand = smooth(0.0, 0.45, rt);
      P.apply(st.seatPose ?? (st.seatPose = SEAT(D)), 1 - stand);
      P.apply(B_ROAR_S, smooth(0.45, 0.65, rt) * (1 - smooth(0.85, 1, rt)));
      P.r('head', Math.sin(T * 43) * 0.04 * bump(0.5, 1, rt));
    }
    // seated: a slow regal tilt of the hollow head; casts raise the left hand
    if (seated && (an === 'cast' || an === 'windup')) {
      const k = an === 'windup' ? smooth(0, 1, p) : smooth(0, 0.2, p) * (1 - smooth(0.8, 1, p));
      P.apply({ armL: [-1.4, 0, 0.1], foreL: [-0.3, 0, 0], handL: [-1.0, 0, 0], head: [-0.25, 0, 0] }, k);
    }
    // ---- weapon target
    const tgt = st.axT ?? (st.axT = setAx({}, AX.seat));
    let om = 6, ze = 1;
    const w = st.moveW ?? 0;
    if (seated) setAx(tgt, AX.seat);
    else if (an === 'windup' || an === 'attack' || an === 'cast') {
      const wu = an === 'windup';
      if (at === 'sweep') { setAx(tgt, wu ? AX.sweepW : AX.sweepS); om = wu ? 7 : 20; ze = wu ? 1 : 0.62; if (!wu && p > 0.7) { mixAx(tgt, AX.sweepS, AX.rest, smooth(0.7, 1, p) * 0.5); om = 6; } }
      else if (at === 'thrust') { setAx(tgt, wu ? AX.thrustW : AX.thrustS); om = wu ? 8 : 26; ze = wu ? 1 : 0.6; }
      else if (at === 'slam') { setAx(tgt, wu ? AX.plungeW : AX.plungeS); om = wu ? 6 : 24; ze = wu ? 1 : 0.7; }
      else if (at === 'leap') { setAx(tgt, AX.plungeW); om = 8; ze = 0.85; }
      else if (at === 'roar') { setAx(tgt, AX.roar); om = 7; ze = 0.8; }
      else if (at === 'beam') { setAx(tgt, AX.beam); om = 8; }
      else { setAx(tgt, AX.rest); tgt.wL = 0; } // summon: sword planted, the left hand calls the dead
    } else mixAx(tgt, AX.rest, AX.carry, smooth(0.15, 0.7, w));
    if (rising) { mixAx(tgt, AX.seat, AX.roar, smooth(0.35, 0.65, rt)); om = 7; }
    const ax = st.ax ?? (st.ax = setAx({}, AX.seat));
    if (!dead) springTo(ax, tgt, AXK, dt, om, ze);
    wounds(m, s, P, dt, { hunch: [['spine', 0.16], ['chest', 0.07], ['neck', 0.1], ['head', 0.06]], breath: [['chest', 0.05], ['spine', 0.02]], shoulders: ['armL', 'armR'], spasm: ['chest', 'head'] }); // (near his end: bossKit.wounds)
    P.damp(dt, rate);
    if (dead) kingDeathSword(m, s, ax);
    else {
      GRIPS[0].w = 1; GRIPS[1].w = clamp(ax.wL);
      wield(m, 'blade', ax, GRIPS, POLES);
    }
    capeSim(m, s, dt, seated || rising);
    kingFx(m, s, dt, ax, seated, rising ? rt : 9);
    return 0;
  },
  anim: {
    death: (P, p, m, s) => kingDeath(P, p, m, s), spawn: 'rise', gait: 'plod', armSwing: 0.12, stride: 0.5, knee: 0.7, breath: 0.8, look: 0.4,
    rest: { armR: [-0.45, 0, 0.25], foreR: [-0.85, 0, 0], handR: [0.55, 0, 0], armL: [-0.5, 0, -0.32], foreL: [-1.0, 0, 0] },
    stance: (P, m, s) => { P.apply({ spine: [0.04, 0, 0], thighL: [-0.1, 0, 0.08], thighR: [0.02, 0, -0.08], shinL: [0.14, 0, 0], shinR: [0.1, 0, 0] }); if (s.anim === 'idle' || s.anim === 'move') P.apply(B_REST, 1 - (m.state.moveW ?? 0)); },
    // (the throne's seat stands higher than a man's knee: sit up on it, feet forward on its step)
    seated: (P, m) => { P.apply({ head: [0.25, 0, 0], neck: [0.1, 0, 0], hips: [0, 0, 0, 0, 0.12, 0.02], thighL: [-0.08, 0, 0], thighR: [-0.08, 0, 0], shinL: [-0.3, 0, 0], shinR: [-0.3, 0, 0] }); P.r('head', 0, Math.sin(m.time * 0.2) * 0.15, 0); },
    actions: {
      sweep: act2(B_SWEEP_W, B_SWEEP_S, { hit: 0.3, recover: 0.7, recoverAmt: 0.6 }),
      thrust: act2(B_THRUST_W, B_THRUST_S, { hit: 0.22, recover: 0.7, recoverAmt: 0.6 }),
      leap: act2(B_LEAP_W, B_LEAP_S, { hit: 0.35, recover: 2, recoverAmt: 0, windupRate: 11 }),
      slam: act2(B_PLUNGE_W, B_PLUNGE_S, { hit: 0.25, recover: 0.75, recoverAmt: 0.55, tremble: 0.02 }),
      roar: act2(B_ROAR_W, B_ROAR_S, { hit: 0.15, recover: 0.8, tremble: 0.05, strikeExtra: (P, p, m) => { const k = bump(0.1, 0.8, p) * 0.04; P.r('chest', Math.sin(m.time * 45) * k, Math.sin(m.time * 38) * k); } }),
      beam: act2({ chest: [-0.2, -0.3, 0], head: [0.1, 0.3, 0], armL: [-0.9, 0, 0.3], foreL: [-1.0, 0, 0] }, B_BEAM_S, { hit: 0.2, recover: 0.9, recoverAmt: 0.2, strikeExtra: (P, p, m) => { P.r('armL', Math.sin(m.time * 41) * 0.015); } }),
      summon: act2(
        { armL: [-0.5, 0, 0.5], foreL: [-1.2, 0, 0], chest: [0.2, 0, 0], head: [0.25, 0, 0] },
        { armL: [-2.6, 0, 0.4], foreL: [-0.2, 0, 0], handL: [-0.6, 0, 0], chest: [-0.25, 0, 0], head: [-0.4, 0, 0], hips: [0, 0, 0, 0, -0.08, 0] },
        { hit: 0.35, recover: 0.85 },
      ),
    },
    extra: (P, m, s) => {
      const st = m.state, T = m.time;
      P.r('crown', Math.sin(T * 0.6) * 0.05, T * 0.25, Math.sin(T * 0.5) * 0.05);
      P.p('crown', 0, 0.02 + Math.sin(T * 1.2) * 0.012 + (st.eclipse ? 0.04 : 0), 0);
      if (s.anim === 'death') {
        // the crown slips off and rolls away on the floor
        const t = Math.max(s.t, s.progress * 1.1), f = smooth(1.0, 1.7, t), roll = smooth(1.6, 3.0, t);
        P.p('crown', 0.25 * f + 0.25 * roll, -1.05 * easeIn(f), 0.35 * f + 0.2 * roll); P.r('crown', 1.3 * f, 0.6 * f + 2 * roll, 0.4 * f + 0.25 * roll);
      }
      if (s.anim === 'cast' && (s.attackType === 'beam' || s.attackType === 'summon')) m.setOrb(0.3 + 0.7 * smooth(0, 0.3, s.progress) - smooth(0.85, 1, s.progress));
    },
  },
};

// death: sinks to one knee on his planted sword, head bowed; the crown falls; the soul streams
// out; then the empty armour slumps over and lies still
const KD_HIT = { chest: [-0.35, 0.15, 0], spine: [-0.2, 0, 0], head: [-0.4, -0.2, 0], hips: [0, 0, 0, 0, -0.05, -0.12] };
const KD_KNEEL = { hips: [0.1, 0, 0, 0, -0.42, 0.08], thighL: [-1.25, 0, 0.1], shinL: [1.3, 0, 0], footL: [0.1, 0, 0], thighR: [0.05, 0, -0.12], shinR: [1.62, 0, 0], footR: [0.9, 0, 0], spine: [0.25, 0, 0], chest: [0.15, 0, 0], neck: [0.3, 0, 0], head: [0.4, 0, 0] };
const KD_SLUMP = { hips: [1.2, 0.3, 0.25, 0, -0.85, 0.3], thighL: [-0.5, 0, 0.2], shinL: [0.6, 0, 0], thighR: [-0.4, 0, -0.1], shinR: [1.2, 0, 0], spine: [0.1, 0, -0.1], chest: [0.05, 0, -0.1], neck: [-0.1, 0, 0], head: [-0.2, 1.0, 0.2], armL: [-0.4, 0, 1.2], foreL: [-0.3, 0, 0], armR: [0.3, 0, -1.0], foreR: [-0.5, 0, 0] };
function kingDeath(P, p, m, s) {
  const t = Math.max(s.t, p * 1.1);
  const hit = bump(0, 0.5, t) * (1 - smooth(0.3, 0.6, t)), kneel = smooth(0.25, 0.9, t) * (1 - smooth(2.3, 2.9, t)), slump = easeIn(smooth(2.3, 3.0, t));
  P.apply(KD_HIT, hit);
  P.apply(KD_KNEEL, kneel);
  P.r('chest', Math.sin(t * 3.3) * 0.03 * kneel, 0, Math.sin(t * 2.1) * 0.02 * kneel);
  P.apply(KD_SLUMP, slump);
  const thud = bump(3.0, 3.25, t);
  P.p('hips', 0, 0.03 * thud, 0);
  return 11;
}
// the sword stays where it was planted as he kneels; the hands stay on the pommel until he slumps
const _m0 = new THREE.Matrix4(), _m1 = new THREE.Matrix4(), _P = new THREE.Vector3(), _Q = new THREE.Quaternion(), _S = new THREE.Vector3(), _E = new THREE.Euler();
function kingDeathSword(m, s, ax) {
  const st = m.state, t = Math.max(s.t, s.progress * 1.1);
  const scaler = m.bones.base.parent;
  if (!st.planted) {
    // plant it point-down a little ahead of him, in scaler (model) space
    const tgt = { th: 0.1, ph: -1.5, ps: 0, gx: 0, gy: -0.3, gz: 0.62 };
    st.plantFrom = { ...ax };
    st.planted = new THREE.Matrix4();
    st.plantT = tgt;
  }
  const u = smooth(0.2, 0.8, t);
  const a = st.ax;
  for (const k of ['th', 'ph', 'ps', 'gx', 'gy', 'gz']) a[k] = lerp(st.plantFrom[k], st.plantT[k], u);
  // chest-space pose while kneeling; once he slumps, hold its model-space transform
  if (t < 2.3) {
    GRIPS[0].w = 1 - smooth(2.0, 2.3, t); GRIPS[1].w = 1 - smooth(2.0, 2.3, t);
    wield(m, 'blade', a, GRIPS, POLES);
    boneModel(m, m.bones.blade, st.planted);
    st.planted.premultiply(_m1.compose(scaler.position, scaler.quaternion, scaler.scale).invert());
  } else {
    _m0.copy(st.planted).premultiply(_m1.compose(scaler.position, scaler.quaternion, scaler.scale));
    boneModel(m, m.bones.chest, _m1);
    _m0.premultiply(_m1.invert());
    _m0.decompose(_P, _Q, _S);
    _E.setFromQuaternion(_Q, 'XYZ');
    snapRot(m, 'blade', _E);
    setBone(m, 'blade', _P.x, _P.y, _P.z, 1);
  }
}

// ---- cape: three ropes from the shoulders, kept loosely in shape, colliding with legs and floor
const DOWN = new THREE.Vector3(0, -1, 0), AX_CAPE = Array.from({ length: CAPE_N }, () => DOWN);
const N_CAPE = CAPE_C.map((_, c) => Array.from({ length: CAPE_N }, (_, i) => `cape${c}_${i}`));
const _a = new THREE.Vector3(), _Mc = new THREE.Matrix4(), _Mh = new THREE.Matrix4(), _dn = new THREE.Vector3(), _bk = new THREE.Vector3(), _anc = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
const _sph = [[new THREE.Vector3(), 0], [new THREE.Vector3(), 0], [new THREE.Vector3(), 0], [new THREE.Vector3(), 0]];
function capeSim(m, s, dt, seated) {
  const st = m.state, sc = m.root.scale.x * 2.15;
  if (!st.cape) {
    st.cape = CAPE_C.map(() => new Rope(CAPE_N, CAPE_L * sc));
    st.capeGoal = CAPE_C.map((_, c) => (i, out) => out.copy(_anc[c]).addScaledVector(_dn, CAPE_L * sc * i).addScaledVector(_bk, CAPE_L * sc * i * (0.18 + i * 0.02)));
  }
  m.root.updateMatrix();
  boneWorld(m, m.bones.chest, _Mc);
  _dn.set(0, -1, 0).transformDirection(_Mc); // chest down
  _bk.set(0, 0, -1).transformDirection(_Mc); // behind
  _dn.lerp(DOWN, 0.5).normalize();
  // colliders: hips and both thighs, the back
  boneWorld(m, m.bones.hips, _Mh); _sph[0][0].set(0, 0, -0.02).applyMatrix4(_Mh); _sph[0][1] = 0.34 * sc;
  boneWorld(m, m.bones.thighL, _Mh); _sph[1][0].set(0, -0.3, -0.02).applyMatrix4(_Mh); _sph[1][1] = 0.2 * sc;
  boneWorld(m, m.bones.thighR, _Mh); _sph[2][0].set(0, -0.3, -0.02).applyMatrix4(_Mh); _sph[2][1] = 0.2 * sc;
  _sph[3][0].set(0, 0.15, -0.05).applyMatrix4(_Mc); _sph[3][1] = 0.3 * sc;
  const floor = m.root.position.y + 0.03;
  const stiff = seated ? 0.35 : s.anim === 'death' ? 0.02 : 0.06;
  for (let c = 0; c < CAPE_C.length; c++) {
    const b0 = m.bones[`cape${c}_0`];
    _anc[c].copy(b0.position).applyMatrix4(_Mc);
    st.cape[c].seg.fill(CAPE_L * sc);
    st.cape[c].step(_anc[c], dt, { g: 9.8, damp: 2.2, floor, iters: 3, spheres: _sph, goal: st.capeGoal[c], stiff });
    aimChain(m, N_CAPE[c], st.cape[c], AX_CAPE);
  }
}

function kingFx(m, s, dt, ax, seated, rt) {
  const st = m.state, F = fxOf(m), T = m.time, an = s.anim, p = s.progress, at = s.attackType, dead = an === 'death';
  const dtD = dead ? Math.max(s.t, p * 1.1) : 0;
  const age = T - st.born;
  // waking on the throne: eyes and crown kindle
  const wake = an === 'idle' && age < 3 ? smooth(0.2, 2.2, age) : 1;
  // soul-fire over the crown: brighter once he stands, guttering out in death
  const soul = (seated ? 0.35 : 0.65) * wake * (dead ? 1 - smooth(1.0, 2.2, dtD) : 1) + (rt < 1 ? bump(0.4, 1, rt) * 0.6 : 0);
  fxSet(F, 'soul', soul * (0.8 + 0.2 * Math.sin(T * 13) * Math.sin(T * 7.7)), 1 + Math.sin(T * 9) * 0.05, 1 + soul * 0.6 + Math.sin(T * 11) * 0.08, 1);
  // the eclipse
  st.ecl = (st.ecl ?? 0) + ((st.eclipse && !dead ? 1 : 0) - (st.ecl ?? 0)) * (1 - Math.exp(-(dead ? 2.5 : 0.7) * dt));
  const jt = st.judgT !== undefined ? T - st.judgT : 9;
  const judg = jt < 4.4 && !dead ? smooth(0, 3.6, jt) * (1 - smooth(4.0, 4.4, jt)) : 0;
  const e = st.ecl, cs = 1 + judg * 0.8 + Math.sin(T * 0.7) * 0.03;
  fxSet(F, 'corona', e * (0.75 + 0.25 * Math.sin(T * 2.1)) + judg * 0.4, cs * (1 + Math.sin(T * 5) * 0.02), cs, 1);
  fxSet(F, 'umbra', e > 0.02 ? 1 : 0, cs * 0.98 * e, cs * 0.98 * e, 1); // opaque: grows rather than fades
  fxRot(F, 'corona', 0, 0, T * 0.15);
  // sword trail
  const tr = F.trail;
  const speed = tr && !dead ? aimTrail(F, 'trail', ax) : 0;
  st.trailA = (st.trailA ?? 0) + (smooth(3.5, 9, speed) - (st.trailA ?? 0)) * (1 - Math.exp(-(speed > 3.5 ? 30 : 8) * dt));
  fxSet(F, 'trail', st.trailA * 0.85);
  // plunge impact ring
  if (an === 'attack' && at === 'slam' && p >= 0.24 && (st.lastP ?? 1) < 0.24) st.impT = T;
  st.lastP = an === 'attack' ? p : 1;
  const it = st.impT !== undefined ? T - st.impT : 9;
  fxPos(F, 'ring', 0, 0.04, 0.7);
  fxSet(F, 'ring', it < 0.6 ? 1 - it / 0.6 : 0, 0.4 + easeOut(clamp(it / 0.6)) * 3.2);
  // death: the soul streams up out of the armour
  const asc = dead ? bump(1.1, 3.4, dtD) : 0;
  fxPos(F, 'ascend', 0, 0.5 + smooth(1.1, 3.4, dtD) * 1.5, 0);
  fxSet(F, 'ascend', asc * 0.8, 1 - smooth(1.5, 3.4, dtD) * 0.6, 1 + smooth(1.1, 3.4, dtD), 1 - smooth(1.5, 3.4, dtD) * 0.6);
  glowLevel(m, wake * (1 + e * 0.5 + judg * 1.2) * (dead ? 1 - smooth(1.0, 2.6, dtD) * 0.9 : 1));
}
