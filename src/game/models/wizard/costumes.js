import * as THREE from 'three';
import { V, mulberry, sphere, torus, roundedBox, xf, noisify, tubeVar, leaf, feather, lathe, fbm3, flat, crystal, gear, helixPts } from './shapes.js';
import { hoodGeo } from './hats.js';
import { faceGeo, eyeGeo, earGeo, hairGeo, hairCapGeo, beardGeo, browGeo, neckGeo, mergeColored } from './head.js';
import {
  TAU, BODY_Y, SHOULDER_X, HIP_X, BELT_Y, SKIRT_TOP, C, cmix, cmul, smoothstep as sstep,
  bodyR, ringPt, paint, cat, weldNormals, garment, clothPaint, limb, bootGeo, ribbon, bandGeo, embroidery,
  beltGeo, beltPt, onBelt, buckleGeo, pouchGeo, vialGeo, bookGeo, scrollCaseGeo, chainGeo, cordGeo, charmGeo,
} from './garments.js';

// ---------------------------------------------------------------------------
// Per-class costumes for the third-person avatars. Each class is a small data
// record (layers, colours, accessories) interpreted by dress(), which builds
// the parts with garments.js and skins them to the avatar skeleton / cloth.
//
// Layering, inside out: trousers + boots, inner robe or tunic, outer coat
// (open front, lining, trims, tattered hem), sleeves, belt with its kit,
// shoulders (mantle / fur / hood / pauldrons), cape, class extras, face.
// ---------------------------------------------------------------------------

const OFF_INNER = 0.014, OFF_COAT = 0.03;

// cross-section of a layer: follows the body above the hips, A-line below
export function layerR(off, flare, flareBack = flare) {
  return (y, out) => {
    if (y >= SKIRT_TOP) { bodyR(y, out); out.rx += off; out.zf += off; out.zb += off; return out; }
    bodyR(Math.max(y, 0.88), out);
    const d = Math.max(0, 0.935 - y);
    out.rx += off + d * flare; out.zf += off + d * flare * 0.72; out.zb += off + d * flareBack * 0.95;
    return out;
  };
}

// ---- class records ------------------------------------------------------------
// colours are sRGB hex; C() converts to linear. hem = root-space height.
const DEFS = {
  pyromancer: (m) => ({
    flare: 0.2, wind: 1,
    inner: { col: 0x3a2e26, hem: 0.1, folds: 0.016 },
    coat: { col: 0x7a2416, lining: 0x2a120c, trim: 0x2a1810, trimEdge: 0.016, trimHem: 0.0, hem: 0.28, gap: [0.62, 0.36, 0.1, 0.5], tatter: 0.07, scorch: 0.2, grime: 0.45, folds: 0.03, collar: 'fold', emb: { pattern: 'flame', col: 0xb0441a, base: 0x2a1810, w: 0.03 } },
    sleeves: { kind: 'fitted', cuff: 0x24140e, cuffKind: 'turn' },
    legs: { col: 0x2a2420 }, boots: { col: 0x3a2a1e, height: 0.3, strap: 0x8a8070 },
    belt: { col: 0x3a2618, buckle: 0x5a5a60, h: 0.05 },
    items: [{ k: 'pouch', a: 1.15, w: 0.08 }, { k: 'pouch', a: -1.9, w: 0.07 }, { k: 'vials', a: -0.62, n: 3, col: m.color }, { k: 'scroll', a: 2.5 }, { k: 'charm', a: 1.75, kind: 'stone', glow: m.color }],
    shoulders: [{ k: 'mantle', col: 0x3a1a12, hem: 1.3, tatter: 0.05, scorch: 0.14, gap: 0.0, seed: 2 }],
    face: { skin: 0xc89880, shade: 0.8, stubble: 0.4, beard: { col: 0x8a8580, len: 0.13 }, hair: { col: 0x6a6560, len: 0.09 }, eyes: 0.8, age: 0.6, nose: 1.1, hook: 0.5, brow: 0.6, iris: 0x8a5a2a },
  }),
  cryomancer: (m) => ({
    flare: 0.17, wind: 0.9,
    inner: { col: 0x2a4a6c, hem: 0.08, folds: 0.016, trim: 0xd8e4ec, trimHem: 0.04 },
    coat: { col: 0xa8b8c6, lining: 0x2a4a6c, trim: 0xe8eef2, trimEdge: 0.03, hem: 0.16, gap: [0.6, 0.3, 0.08, 0.42], tatter: 0.03, grime: 0.25, grimeCol: 0x4a5560, folds: 0.028, furHem: true, collar: null },
    sleeves: { kind: 'fitted', cuffKind: 'fur' },
    legs: { col: 0x2a3440 }, boots: { col: 0x5a4a3e, height: 0.32, fur: 0xe8e8e8 },
    belt: { col: 0x5a4a3c, buckle: 0xc8d0dc, h: 0.055 },
    items: [{ k: 'pouch', a: 1.2, w: 0.075 }, { k: 'vials', a: -0.7, n: 2, col: m.color }, { k: 'charm', a: -1.5, kind: 'crystal', glow: m.color }, { k: 'pouch', a: 2.6, w: 0.09 }],
    shoulders: [{ k: 'fur', col: 0xeceae6 }],
    face: { skin: 0xd8b8a8, shade: 0.55, eyes: 1.4 },
  }),
  stormcaller: (m) => ({
    flare: 0.2, wind: 1.1,
    inner: { col: 0x3a3c44, hem: 0.62, folds: 0.012 },
    coat: { col: 0x22305a, lining: 0x6a5434, trim: 0x22305a, hem: 0.12, gap: [0.5, 0.26, 0.16, 0.62], vent: { y: 0.82, a: 0.22 }, tatter: 0.03, fade: 0.55, grime: 0.4, folds: 0.03, collar: 'high', buttons: 0xc89048, emb: { pattern: 'zigzag', col: 0xc89048, base: 0x1a2440, w: 0.03, P: 0.045 } },
    sleeves: { kind: 'fitted', cuff: 0x1a2440, cuffKind: 'turn' },
    legs: { col: 0x34302c }, boots: { col: 0x4a3420, height: 0.36, strap: 0xc89048 },
    belt: { col: 0x3a2818, buckle: 0xc89048, h: 0.05 },
    items: [{ k: 'pouch', a: 1.1, w: 0.075 }, { k: 'vials', a: -0.75, n: 2, col: m.color2 }, { k: 'charm', a: 1.75, kind: 'coil' }, { k: 'pouch', a: -1.9, w: 0.065 }],
    shoulders: [{ k: 'capelet', col: 0x22305a, fade: 0.5 }],
    face: { skin: 0xc8a088, shade: 0.55, eyes: 1.4 },
  }),
  arcanist: (m) => ({
    flare: 0.22, wind: 0.9,
    inner: { col: 0x4a2470, hem: 0.05, folds: 0.016, trim: 0xd8b060, trimHem: 0.03 },
    coat: { col: 0x2c1648, lining: 0x7a4aa0, trim: 0xd0a850, trimEdge: 0.04, trimHem: 0.05, hem: 0.06, gap: [0.6, 0.36, 0.2, 0.62], tatter: 0.0, grime: 0.25, folds: 0.03, collar: 'fold', raise: 0.003, emb: { pattern: 'vine', col: 0x4a1c6a, base: 0xd0a850, w: 0.042, hem: true } },
    sleeves: { kind: 'bell', bell: 0.115, cuff: 0xd0a850, under: 0x4a2470 },
    legs: { col: 0x2a2030 }, boots: { col: 0x3a2a20, height: 0.16, pointy: true },
    belt: { col: 0x3a2030, buckle: 0xd0a850, h: 0.045 },
    items: [{ k: 'tome', a: 0.9 }, { k: 'scroll', a: -2.4 }, { k: 'pouch', a: -1.2, w: 0.065 }, { k: 'quill', a: -0.75 }],
    shoulders: [],
    extras: [{ k: 'stole', col: 0x6a1c34, edge: 0xd0a850 }],
    face: { skin: 0xd8b8a0, shade: 0.85, beard: { col: 0xdcd8d0, len: 0.27, fork: true }, hair: { col: 0xd0ccc4, len: 0.17 }, eyes: 0.9, age: 1, gaunt: 0.5, nose: 1.15, hook: 0.7, brow: 0.4, iris: 0x5a4a8a },
  }),
  necromancer: (m) => ({
    flare: 0.2, wind: 1.1,
    inner: { col: 0x1a1e1a, hem: 0.1, folds: 0.02, tatter: 0.12 },
    coat: { col: 0x121612, lining: 0x1e2a1c, trim: 0x3a4632, trimEdge: 0.0, hem: 0.08, gap: [0.6, 0.3, 0.12, 0.55], tatter: 0.22, grime: 0.55, grimeCol: 0x2a2e1c, folds: 0.034, moss: 0.35, mossCol: 0x2a3a1c, collar: null },
    sleeves: { kind: 'bell', bell: 0.09, tatter: true, under: 0x1a1e1a },
    legs: { col: 0x1a1c18 }, boots: { col: 0x2a2a24, height: 0.28, wrap: 0x4a4a3a },
    belt: { col: 0x5a5040, rope: true, h: 0.03 },
    items: [{ k: 'charm', a: 0.9, kind: 'skull' }, { k: 'charm', a: -0.85, kind: 'bones' }, { k: 'charm', a: 1.8, kind: 'bones' }, { k: 'pouch', a: -1.8, w: 0.07 }],
    shoulders: [{ k: 'mantle', col: 0x1a201a, hem: 1.24, tatter: 0.13, gap: 0.0, seed: 6, strips: true }],
    cape: { col: 0x101410, hem: 0.12, tatter: 0.25, moss: 0.3 },
    face: { kind: 'mask', eyes: 3 },
  }),
  bloodmage: (m) => ({
    flare: 0.2, wind: 1,
    inner: { col: 0x1e0c0e, hem: 0.12, folds: 0.016 },
    coat: { col: 0x6e0c1c, lining: 0x1a0a0a, trim: 0x1a0e0e, trimEdge: 0.02, hem: 0.24, gap: [0.58, 0.3, 0.1, 0.5], tatter: 0.08, grime: 0.4, grimeCol: 0x2a0a08, folds: 0.03, collar: 'fold', emb: { pattern: 'diamond', col: 0x7a0e1c, base: 0x1a0e0e, w: 0.03 } },
    sleeves: { kind: 'fitted', cuff: 0x1a0e0e, cuffKind: 'turn', straps: true },
    legs: { col: 0x1e1414 }, boots: { col: 0x1e1614, height: 0.38, strap: 0xa8a8b0 },
    belt: { col: 0x1a1210, buckle: 0xa8a8b0, h: 0.05, studs: true },
    items: [{ k: 'pouch', a: 1.15, w: 0.07 }, { k: 'pouch', a: -1.95, w: 0.07 }, { k: 'charm', a: -1.3, kind: 'bones' }],
    shoulders: [{ k: 'mantle', col: 0x4a0a14, hem: 1.33, tatter: 0.04, gap: 0.0, seed: 7 }],
    extras: [{ k: 'harness', col: 0x1a1210, metal: 0xa8a8b0, vials: m.color }],
    face: { skin: 0xd8b0a0, shade: 0.5, eyes: 1.6 },
  }),
  chronomancer: (m) => ({
    flare: 0.2, wind: 0.9,
    inner: { col: 0x1a4a46, hem: 0.05, folds: 0.016, trim: 0xd0a850, trimHem: 0.03 },
    coat: { col: 0x14524c, lining: 0x0a2a28, trim: 0xd0a850, trimEdge: 0.03, trimHem: 0.035, hem: 0.08, gap: [0.6, 0.34, 0.14, 0.55], tatter: 0.0, grime: 0.3, folds: 0.028, collar: 'fold', raise: 0.002, emb: { pattern: 'runes', col: 0x0e3a36, base: 0xd0a850, w: 0.034, hem: true } },
    sleeves: { kind: 'flare', cuff: 0xd0a850, cuffKind: 'turn' },
    legs: { col: 0x2a2420 }, boots: { col: 0x4a3424, height: 0.2 },
    belt: { col: 0x4a3020, buckle: 0xd0a850, h: 0.045 },
    items: [{ k: 'charm', a: 0.85, kind: 'hourglass', glow: m.color2 }, { k: 'charm', a: -0.9, kind: 'gear' }, { k: 'charm', a: 1.8, kind: 'hourglass', glow: m.color2 }, { k: 'pouch', a: -1.7, w: 0.07 }, { k: 'watch', a: -0.35 }],
    shoulders: [{ k: 'hood', col: 0x14524c, rim: 0xd0a850 }],
    extras: [{ k: 'sash', col: 0x9a7a3a, a: 1.25 }],
    face: { skin: 0xc8a088, shade: 0.9, stubble: 0.3, beard: { col: 0x3a302a, len: 0.06 }, hair: { col: 0x2a2420, len: 0.05, full: true, short: true, n: 90 }, eyes: 0.8, age: 0.35, chin: 0.3, iris: 0x2a6a5a },
  }),
  warlock: (m) => ({
    flare: 0.22, wind: 1.1,
    inner: { col: 0x1e1028, hem: 0.06, folds: 0.018 },
    coat: { col: 0x2a1238, lining: 0x5a1a6a, trim: 0x3a1a4a, trimEdge: 0.025, hem: 0.07, gap: [0.6, 0.32, 0.12, 0.55], tatter: 0.15, grime: 0.45, grimeCol: 0x140a14, folds: 0.032, collar: null, emb: { pattern: 'runes', col: 0x7a2a9a, base: 0x2a1238, w: 0.03 } },
    sleeves: { kind: 'bell', bell: 0.085, tatter: true, under: 0x1e1028 },
    legs: { col: 0x1a1420 }, boots: { col: 0x1e1820, height: 0.3, strap: 0x6a6070 },
    belt: { col: 0x1e1418, buckle: 0x6a6070, h: 0.04 },
    items: [{ k: 'charm', a: 1.0, kind: 'crystal', glow: m.color }, { k: 'pouch', a: -1.6, w: 0.07 }, { k: 'chains', a: -0.6 }],
    shoulders: [{ k: 'mantle', col: 0x1e0e28, hem: 1.26, tatter: 0.12, gap: 0.0, seed: 9, strips: true, asym: 0.08 }],
    cape: { col: 0x1a0c22, hem: 0.1, tatter: 0.2 },
    extras: [{ k: 'sigils', col: m.color }],
    face: { kind: 'void', eyes: 2.6 },
  }),
  lightbinder: (m) => ({
    flare: 0.2, wind: 0.8,
    inner: { col: 0xe4dccc, hem: 0.05, folds: 0.016, trim: 0xc8a040, trimHem: 0.035 },
    coat: { col: 0xd8d0c0, lining: 0xc8a040, trim: 0xc8a040, trimEdge: 0.045, trimHem: 0.06, hem: 0.1, gap: [0.55, 0.3, 0.14, 0.5], tatter: 0.0, grime: 0.35, grimeCol: 0x8a7a60, folds: 0.028, collar: 'fold', raise: 0.003, emb: { pattern: 'diamond', col: 0xf0e8d0, base: 0xc8a040, w: 0.045, hem: true } },
    sleeves: { kind: 'bell', bell: 0.1, cuff: 0xc8a040, under: 0xe4dccc },
    legs: { col: 0x8a7a64 }, boots: { col: 0x8a6a4a, height: 0.2 },
    belt: { col: 0xd8c8a0, buckle: 0xd8a840, h: 0.04, rope: true },
    items: [{ k: 'tome', a: 1.0, cover: 0xd8d0c0, metal: 0xd8a840 }, { k: 'pouch', a: -1.4, w: 0.065 }],
    shoulders: [{ k: 'pauldron', kind: 'gold' }],
    cape: { col: 0xe4dccc, hem: 0.08, tatter: 0.0, trim: 0xc8a040 },
    extras: [{ k: 'stole', col: 0xc8a040, edge: 0xe8d8a0, narrow: true }, { k: 'medallion', col: m.color }],
    face: { skin: 0xe0c0a8, shade: 0.6, eyes: 1.3 },
  }),
  geomancer: (m) => ({
    flare: 0.16, wind: 0.8,
    inner: { col: 0x5a4a34, hem: 0.62, folds: 0.012 },
    coat: { col: 0x5a3e24, lining: 0x3a2a1a, trim: 0x3a2a18, trimEdge: 0.02, trimHem: 0.03, hem: 0.46, gap: [0.5, 0.25, 0.08, 0.35], tatter: 0.05, grime: 0.5, grimeCol: 0x3a3226, folds: 0.022, collar: 'fold', stiff: true, emb: { pattern: 'diamond', col: 0x9a7a3a, base: 0x3a2a18, w: 0.032, hem: true } },
    sleeves: { kind: 'fitted', cuff: 0x3a2a18, cuffKind: 'bracer' },
    legs: { col: 0x3a3226 }, boots: { col: 0x3e2c1c, height: 0.32, strap: 0x6a6a64 },
    belt: { col: 0x3a2618, buckle: 0x8a8076, h: 0.07, studs: true },
    items: [{ k: 'pouch', a: 1.05, w: 0.1, h: 0.1 }, { k: 'pouch', a: -1.3, w: 0.08 }, { k: 'charm', a: -0.6, kind: 'stone', glow: m.color }, { k: 'pouch', a: 2.6, w: 0.09 }],
    shoulders: [{ k: 'pauldron', kind: 'stone' }, { k: 'mantle', col: 0x4a3a28, hem: 1.36, tatter: 0.03, gap: 0.0, seed: 11 }],
    face: { skin: 0xb88a68, shade: 0.55, eyes: 1.4 },
  }),
  druid: (m) => ({
    flare: 0.2, wind: 1.1,
    inner: { col: 0x34421e, hem: 0.08, folds: 0.018, tatter: 0.08 },
    coat: { col: 0x4a3c24, lining: 0x2a3418, trim: 0x2e3a1a, trimEdge: 0.0, hem: 0.12, gap: [0.6, 0.32, 0.12, 0.55], tatter: 0.17, grime: 0.5, grimeCol: 0x2a2a14, folds: 0.032, moss: 0.6, mossCol: 0x3a4a1e, collar: null },
    sleeves: { kind: 'fitted', cuffKind: 'wrap', cuff: 0x6a5a40 },
    legs: { col: 0x2e2a1c }, boots: { col: 0x4a3a26, height: 0.24, wrap: 0x6a5a40 },
    belt: { col: 0x6a5a3a, rope: true, h: 0.032 },
    items: [{ k: 'charm', a: 0.85, kind: 'herbs' }, { k: 'gourd', a: -0.9 }, { k: 'charm', a: 1.8, kind: 'feathers', feather: 0x8a7a60 }, { k: 'charm', a: -1.85, kind: 'bones' }, { k: 'pouch', a: 2.5, w: 0.08 }],
    shoulders: [{ k: 'mantle', col: 0x3a3a1e, hem: 1.32, tatter: 0.1, gap: 0.0, seed: 13, fur: true }, { k: 'leaves' }],
    extras: [{ k: 'vines' }],
    face: { skin: 0xb08868, shade: 0.85, stubble: 0.2, beard: { col: 0x5a4430, len: 0.11 }, hair: { col: 0x4a3624, len: 0.15, full: true, wild: 1, n: 80 }, eyes: 0.9, age: 0.5, nose: 1.05, iris: 0x4a6a2a },
  }),
  spellblade: (m) => ({
    flare: 0.16, wind: 0.9,
    inner: { col: 0x343a44, hem: 0.5, folds: 0.01, quilt: true, split: true },
    coat: null,
    sleeves: { kind: 'quilt', col: 0x343a44 },
    legs: { col: 0x24282e }, boots: { col: 0x2e2620, height: 0.38, strap: 0x9aa2ae },
    belt: { col: 0x2a1e16, buckle: 0x9aa2ae, h: 0.05 },
    items: [{ k: 'scabbard', a: 1.35 }, { k: 'pouch', a: -1.3, w: 0.07 }, { k: 'pouch', a: -2.2, w: 0.06 }],
    shoulders: [{ k: 'pauldron', kind: 'plate' }],
    cape: { col: 0x1e2a48, hem: 0.42, tatter: 0.06, half: true },
    extras: [{ k: 'breastplate' }, { k: 'faulds' }, { k: 'vambrace' }, { k: 'kneecops' }],
    face: { skin: 0xc89880, shade: 0.7, stubble: 0.4, eyes: 1.2, chin: 0.6, brow: 0.5, iris: 0x4a6a8a },
  }),
  tempest: (m) => ({
    flare: 0.22, wind: 1.8,
    inner: { col: 0x58687a, hem: 0.1, folds: 0.016 },
    coat: { col: 0x46586c, lining: 0x2a3a48, trim: 0xd0ccc0, trimEdge: 0.02, hem: 0.1, gap: [0.6, 0.34, 0.14, 0.6], vent: { y: 0.8, a: 0.3, sides: true }, tatter: 0.1, grime: 0.3, grimeCol: 0x3a4248, folds: 0.03, collar: null, emb: { pattern: 'vine', col: 0x46586c, base: 0xd0ccc0, w: 0.03 } },
    sleeves: { kind: 'fitted', cuffKind: 'wrap', cuff: 0xd0ccc0 },
    legs: { col: 0x3a4048 }, boots: { col: 0x5a5048, height: 0.26, wrap: 0xc8c4b8 },
    belt: { col: 0xc8c4b8, h: 0.06, sash: true },
    items: [{ k: 'charm', a: 0.95, kind: 'feathers', feather: 0xe0dcd4 }, { k: 'pouch', a: -1.3, w: 0.07 }, { k: 'charm', a: -0.75, kind: 'feathers', feather: 0x6a6a72 }],
    shoulders: [{ k: 'scarf', col: 0xc8c4b8 }, { k: 'feathers' }],
    extras: [{ k: 'wraps', col: 0xc8c4b8 }, { k: 'sash', col: 0xc8c4b8, a: -1.2, long: true }],
    face: { skin: 0xd0a890, shade: 0.55, eyes: 1.4 },
  }),
};

// signature pieces added to each class's extras
const SIGNATURE = {
  pyromancer: [{ k: 'embers' }], cryomancer: [{ k: 'frost' }], stormcaller: [{ k: 'coils' }], arcanist: [{ k: 'stars' }],
  necromancer: [{ k: 'ribcage' }], bloodmage: [{ k: 'bloodgem' }], chronomancer: [{ k: 'gearbrooch' }], warlock: [{ k: 'eye' }],
  lightbinder: [{ k: 'halo' }], geomancer: [{ k: 'shards' }], druid: [{ k: 'mushrooms' }], spellblade: [{ k: 'mail' }], tempest: [{ k: 'windrunes' }],
};

// ---- costume summary for the rig (cloth ring etc.) -------------------------------
export function getCostume(classId, meta) {
  const d = (DEFS[classId] ?? DEFS.pyromancer)(meta);
  d.extras = [...(d.extras ?? []), ...(SIGNATURE[classId] ?? [])];
  const outer = d.coat && d.coat.hem < d.inner.hem + 0.05 ? d.coat : d.inner;
  const off = outer === d.coat ? OFF_COAT : OFF_INNER;
  const longest = Math.min(d.inner.hem, d.coat ? d.coat.hem : 9);
  d.skirt = {
    hem: Math.max(0.06, longest - 0.02),
    R: layerR(off, d.flare),
    stiff: d.coat?.stiff ? 2.2 : 1.1, damp: 2.0, legR: 0.105, wind: 1,
  };
  return d;
}

// coat opening half-angle by height: [collar, chest, waist, hem]
function gapFn(g, hem) {
  return (y) => {
    if (y >= 1.45) return g[0];
    if (y >= 1.25) return g[1] + (g[0] - g[1]) * sstep(1.25, 1.45, y);
    if (y >= BELT_Y) return g[2] + (g[1] - g[2]) * sstep(BELT_Y, 1.25, y);
    return g[2] + (g[3] - g[2]) * Math.pow(Math.min(1, (BELT_Y - y) / Math.max(0.1, BELT_Y - hem)), 1.3);
  };
}

// ---- dressing --------------------------------------------------------------------
export function dress(D) {
  const { kit, meta, cos, bones, skins, glows } = D;
  const { hips, chest, head, neck, armL, armR, legL, legR } = bones;
  const M = {
    cloth: kit.cloth(0xffffff), clothDS: kit.clothDS(0xffffff),
    leather: kit.leather(0xffffff), metal: kit.metal(0xffffff, 0.9),
    skin: kit.skin(0xffffff), fur: kit.fur(0xffffff), bone: kit.bone(0xffffff), rock: kit.rock(0xffffff),
    wood: kit.wood(0xffffff), plainDS: kit.plainDS(0xffffff, 0.75), plain: kit.plain(0xffffff, 0.5), void: kit.void(),
    armor: kit.plain(0xffffff, 0.55, 0.8),
  };
  // one glow material for eyes, vials, sigils (pulses with the class glow)
  const glowMat = glows.add(kit.glow(meta.color, 1.6), 0.6);
  glowMat.vertexColors = true;
  const glow2 = glows.add(kit.glow(meta.color2 ?? meta.color, 1.6), 0.6);
  const add = D.add;
  const rnd = mulberry(classId(D) * 7 + 3);
  const skirtSurf = cos.skirt.R;
  const RR = { rx: 0, zf: 0, zb: 0 };
  const inner = cos.inner, coat = cos.coat;

  // ---- trousers & boots ------------------------------------------------------
  D.sec = 'legs';
  const legCol = C(cos.legs.col);
  for (const [side, L] of [[1, legL], [-1, legR]]) {
    const jx = side * HIP_X;
    const g = limb(jx, BODY_Y.hipJ, 0, [[0.092, 0.07], [0.094, 0.0], [0.084, -0.2], [0.066, -0.43], [0.063, -0.47], [0.058, -0.66], [0.05, -0.8], [0.048, -0.86]], { seg: 10, folds: 0.025, paint: (x, y) => cmul(legCol, 0.75 + 0.3 * sstep(-0.86, 0, y)) });
    add(M.cloth, g, skins.leg(side));
    const b = bootGeo(side, { ...cos.boots, col: C(cos.boots.col), strap: cos.boots.strap ? C(cos.boots.strap) : null, fur: cos.boots.fur ? C(cos.boots.fur) : null, wrap: cos.boots.wrap ? C(cos.boots.wrap) : null });
    add(M.leather, b.foot, L.ankle);
    add(cos.boots.fur || cos.boots.wrap ? M.cloth : M.leather, b.shaft, L.knee);
  }

  // ---- inner robe / tunic -------------------------------------------------------
  D.sec = 'inner';
  const innerCol = C(inner.col);
  const innerR = layerR(OFF_INNER, cos.flare * (inner.hem > 0.4 ? 0.8 : 1));
  const innerPaint = clothPaint({ col: innerCol, trim: inner.trim ? C(inner.trim) : null, trimHem: inner.trimHem, grime: 0.35, ao: 0.2, seed: 5 });
  {
    const torso = garment({ y0: 1.53, y1: SKIRT_TOP, rows: 8, seg: 18, R: innerR, fold: { n: 6, amp: (t, y) => 0.002 * sstep(SKIRT_TOP, SKIRT_TOP + 0.04, y) }, pinch: [{ y: BELT_Y, w: 0.02, k: 0.004 }], paint: (c) => innerPaint({ ...c, t: 0, hem: 9 }), quilt: inner.quilt ? { depth: 0.004 } : null, seed: 5 });
    const panels = inner.split ? [[() => 0.06, () => Math.PI - 0.06], [() => Math.PI + 0.06, () => TAU - 0.06]] : undefined;
    const splitF = (y) => (inner.split ? 0.02 + 0.3 * sstep(0.85, inner.hem, y) : 0);
    const skirt = garment({
      y0: SKIRT_TOP, y1: inner.hem, rows: inner.hem > 0.4 ? 7 : 13, seg: inner.quilt ? 30 : 44, R: innerR, seed: 6, pipe: !inner.quilt,
      panels: inner.split ? [[(y) => splitF(y), (y) => Math.PI - splitF(y)], [(y) => Math.PI + splitF(y), (y) => TAU - splitF(y)]] : panels,
      fold: { n: 9, amp: (t) => (0.003 + (inner.folds ?? 0.016) * 1.15 * Math.pow(t, 0.8)) * Math.min(1, t / 0.06) },
      pinch: [{ y: SKIRT_TOP + 0.02, w: 0.04, k: 0, ripple: 0.003 }],
      tatter: inner.tatter ?? 0.02, quilt: inner.quilt ? { depth: 0.004 } : null,
      paint: (c) => innerPaint({ ...c, t: (SKIRT_TOP - c.y) / (SKIRT_TOP - inner.hem) }),
    });
    const both = cat([torso, skirt]);
    weldNormals(both);
    add(inner.split || inner.tatter ? M.clothDS : M.cloth, both, skins.skirt);
  }

  // ---- outer coat -----------------------------------------------------------------
  D.sec = 'coat';
  let coatR = null;
  let coatSurf = null; // (y, a, lift) on the finished coat: folds included
  if (coat) {
    coatR = layerR(OFF_COAT, cos.flare);
    const coatCol = C(coat.col), lining = C(coat.lining), trim = C(coat.trim);
    const gap = gapFn(coat.gap, coat.hem);
    const vent = coat.vent;
    const vh = (y) => (vent && y < vent.y ? vent.a * sstep(vent.y, vent.y - 0.12, y) : 0);
    const sideV = vent?.sides;
    const panels = vent
      ? sideV
        ? [[gap, (y) => Math.PI / 2 - vh(y)], [(y) => Math.PI / 2 + vh(y), (y) => 1.5 * Math.PI - vh(y)], [(y) => 1.5 * Math.PI + vh(y), (y) => TAU - gap(y)]]
        : [[gap, (y) => Math.PI - vh(y)], [(y) => Math.PI + vh(y), (y) => TAU - gap(y)]]
      : [[gap, (y) => TAU - gap(y)]];
    const edgeAt = (a0, a1) => [Math.abs(a0 - gap(1.0)) < 0.6 && a0 < 1.2, a1 > TAU - 1.2];
    const tp = (c) => ({ ...c, t: Math.max(0, (SKIRT_TOP - c.y) / (SKIRT_TOP - coat.hem)) });
    const paintO = clothPaint({ col: coatCol, trim, trimEdge: coat.trimEdge, trimHem: coat.trimHem, grime: coat.grime, grimeCol: coat.grimeCol ? C(coat.grimeCol) : undefined, scorch: coat.scorch, fade: coat.fade, moss: coat.moss, mossCol: coat.mossCol ? C(coat.mossCol) : null, ao: 0.34, seed: 7 });
    const paintL = clothPaint({ col: lining, grime: (coat.grime ?? 0.3) * 0.6, ao: 0.15, seed: 8, scorch: coat.scorch ? coat.scorch * 0.6 : 0 });
    const common = { R: coatR, seed: 9, edgeAt, trim: { edge: coat.trimEdge, hem: coat.trimHem, raise: coat.raise ?? 0 } };
    const torso = garment({ ...common, trim: { edge: coat.trimEdge, raise: coat.raise ?? 0 }, y0: 1.515, y1: SKIRT_TOP, rows: 10, seg: 24, panels: [[gap, (y) => TAU - gap(y)]], fold: { n: 5, amp: (t, y) => (0.002 + 0.007 * sstep(1.3, 1.1, y)) * sstep(SKIRT_TOP, SKIRT_TOP + 0.04, y) }, pinch: [{ y: BELT_Y, w: 0.022, k: 0.007, ripple: 0.003 }], paint: (c) => paintO({ ...c, t: 0, hem: 9 }) });
    const skirt = garment({ ...common, y0: SKIRT_TOP, y1: coat.hem, rows: coat.hem > 0.4 ? 9 : 15, seg: 60, panels, pipe: true, fold: { n: 9, amp: (t) => (0.004 + (coat.folds ?? 0.03) * 1.2 * Math.pow(t, 0.75)) * Math.min(1, t / 0.06) }, tatter: coat.tatter, paint: (c) => paintO(tp(c)) });
    const surfT = torso.userData.surf, surfS = skirt.userData.surf;
    coatSurf = (y, a, lift) => (y >= SKIRT_TOP ? surfT(a, y, lift, V()) : surfS(a, y, lift, V()));
    const out = cat([torso, skirt]);
    weldNormals(out);
    add(M.cloth, out, skins.skirt);
    // embroidered bands down the front edges (and round the hem): raised, patterned, over the trim
    if (coat.emb) {
      const e = coat.emb, w = e.w ?? 0.034;
      const pf = embroidery(e.pattern, C(e.base ?? coat.trim), C(e.col), e.P ?? 0.05);
      const at = (a, y, lift, o) => (y >= SKIRT_TOP ? surfT(a, y, lift, o) : surfS(a, y, lift, o));
      const bands = [];
      const yTop = 1.46, yBot = coat.hem + 0.012 + (coat.tatter ?? 0);
      for (const sd of [1, -1]) {
        const pts = [], nrm = [];
        const n = Math.max(24, Math.round((yTop - yBot) / (e.P ?? 0.05) * 3.5));
        for (let i = 0; i <= n; i++) {
          const y = yTop + (yBot - yTop) * (i / n);
          coatR(y, RR);
          const da = (w * 0.5 + 0.002) / ((RR.rx + RR.zf) * 0.5);
          const a = sd > 0 ? gap(y) + da : TAU - gap(y) - da;
          const p = at(a, y, 0.0035, V());
          pts.push(p); nrm.push(V(p.x, 0, p.z).normalize());
        }
        bands.push(bandGeo(pts, nrm, w, 0.0018, pf));
      }
      if (e.hem && !(coat.tatter > 0.04)) {
        const y = coat.hem + w * 0.5 + 0.006;
        for (const [aS, aE] of panels) {
          const a0 = aS(y) + 0.004, a1 = aE(y) - 0.004;
          const pts = [], nrm = [];
          coatR(y, RR);
          const n = Math.max(12, Math.round((a1 - a0) * (RR.rx + RR.zf) * 0.5 / (e.P ?? 0.05) * 3.5));
          for (let i = 0; i <= n; i++) { const p = at(a0 + (a1 - a0) * (i / n), y, 0.0035, V()); pts.push(p); nrm.push(V(p.x, 0, p.z).normalize()); }
          bands.push(bandGeo(pts, nrm, w * 0.9, 0.0018, pf));
        }
      }
      add(M.cloth, cat(bands), skins.skirt);
    }
    // lining (inward-facing, slightly inside)
    const linR = layerR(OFF_COAT - 0.005, cos.flare);
    const lt = garment({ R: linR, seed: 9, y0: 1.515, y1: SKIRT_TOP, rows: 5, seg: 12, panels: [[gap, (y) => TAU - gap(y)]], fold: { n: 5, amp: () => 0 }, pinch: [{ y: BELT_Y, w: 0.022, k: 0.007 }], flip: true, paint: (c) => paintL({ ...c, t: 0, hem: 9 }) });
    const ls = garment({ R: linR, seed: 9, y0: SKIRT_TOP, y1: coat.hem, rows: coat.hem > 0.4 ? 6 : 9, seg: 30, panels, pipe: true, fold: { n: 9, amp: (t) => (0.004 + (coat.folds ?? 0.03) * 1.2 * Math.pow(t, 0.75)) * Math.min(1, t / 0.06) }, tatter: coat.tatter, flip: true, paint: (c) => paintL(tp(c)) });
    add(M.cloth, cat([lt, ls]), skins.skirt);
    // collar
    if (coat.collar === 'high') {
      const cg = garment({ y0: 1.62, y1: 1.5, rows: 3, seg: 20, R: (y, o) => { o.rx = 0.085 + (1.62 - y) * 0.25; o.zf = 0.08 + (1.62 - y) * 0.2; o.zb = 0.085 + (1.62 - y) * 0.2; return o; }, panels: [[() => 0.7, () => TAU - 0.7]], fold: { n: 4, amp: () => 0.002 }, paint: () => cmul(coatCol, 0.9) });
      add(M.clothDS, cg, (v) => [[neck, 0.5], [chest, 0.5]]);
    } else if (coat.collar === 'fold') {
      const cg = garment({ y0: 1.555, y1: 1.47, rows: 3, seg: 22, R: (y, o) => { const k = (1.555 - y) / 0.085; o.rx = 0.075 + k * 0.1; o.zf = 0.068 + k * 0.06; o.zb = 0.075 + k * 0.06; return o; }, panels: [[() => 0.55, () => TAU - 0.55]], fold: { n: 4, amp: () => 0.002 }, paint: () => cmul(coat.trimEdge ? trim : coatCol, 0.95) });
      add(M.clothDS, cg, skins.torso);
    }
    if (coat.buttons) {
      const bt = [];
      for (let i = 0; i < 5; i++) {
        const y = 1.4 - i * 0.075;
        coatR(y, RR);
        const a = gap(y) + 0.06;
        const [x, z] = ringPt(RR.rx + 0.006, RR.zf + 0.006, RR.zb + 0.006, a);
        bt.push(sphere(0.008, 6, 4, { x, y, z, sz: 0.6 }));
      }
      add(M.metal, paint(cat(bt), C(coat.buttons)), skins.torso);
    }
    if (coat.furHem) {
      // thick fur band riding the hem (follows the skirt cloth)
      const pts = [];
      const fur = [];
      for (const [aS, aE] of panels) {
        pts.length = 0;
        const y = coat.hem + 0.03;
        coatR(y, RR);
        const a0 = aS(y), a1 = aE(y);
        for (let i = 0; i <= 26; i++) { const a = a0 + (a1 - a0) * (i / 26); const [x, z] = ringPt(RR.rx + 0.012, RR.zf + 0.012, RR.zb + 0.012, a); pts.push(V(x, y, z)); }
        const tg = tubeVar(pts.slice(), (t) => 0.026, 26, 5, true);
        tg.scale(1, 1, 1);
        fur.push(noisify(tg, 0.008, 40, 3, 2));
        { const u = tg.getAttribute('uv'); for (let i = 0; i < u.count; i++) u.setXY(i, u.getX(i), u.getY(i) * 0.12); }
      }
      add(M.fur, paint(cat(fur), C(0xe8e8e6)), skins.skirt);
      // fur trim up the front edges
      for (const s of [1, -1]) {
        const pp = [];
        for (let i = 0; i <= 16; i++) {
          const y = 1.48 + (coat.hem + 0.05 - 1.48) * (i / 16);
          coatR(y, RR);
          const a = s > 0 ? gap(y) + 0.03 : TAU - gap(y) - 0.03;
          const [x, z] = ringPt(RR.rx + 0.01, RR.zf + 0.01, RR.zb + 0.01, a);
          pp.push(V(x, y, z));
        }
        add(M.fur, paint(noisify(tubeVar(pp, 0.02, 20, 5, true), 0.006, 40, 4 + s, 2), C(0xe8e8e6)), skins.skirt);
      }
    }
  }
  const outerR = coatR ?? innerR;
  const outerOff = coat ? OFF_COAT : OFF_INNER;

  // ---- sleeves --------------------------------------------------------------------
  D.sec = 'sleeves';
  const sl = cos.sleeves;
  const sleeveCol = C(sl.col ?? coat?.col ?? inner.col);
  for (const A of [armL, armR]) {
    const s = A.s;
    const jx = s * SHOULDER_X, jy = BODY_Y.shoulder, jz = -0.01;
    // (the profile is sampled finely toward the elbow, where the sleeve bunches up in creases)
    const upProf = [[0.012, 0.03], [0.044, 0.024], [0.06, 0.006], [0.063, -0.03], [0.061, -0.1], [0.06, -0.14]];
    for (let k = 1; k <= 12; k++) { const y = -0.14 - k * 0.0125; upProf.push([0.058 - 0.003 * (k / 12), y]); }
    const up = limb(jx + A.s * 0.008, jy - 0.012, jz, upProf, { seg: 14, folds: 0.03, creases: [{ y: -0.255, w: 0.04, k: 0.07 }], paint: (x, y, z) => cmul(sleeveCol, (0.78 + 0.25 * sstep(-0.3, 0.05, y)) * (1 - 0.25 * Math.exp(-Math.pow((y + 0.255) / 0.04, 2)) * (0.5 - 0.5 * Math.sin((y + 0.255) * 160 + Math.atan2(x, z) * 0.5)))) });
    add(M.cloth, up, A.shoulder);
    const ey = jy - 0.28;
    add(M.cloth, paint(sphere(0.056, 8, 6, { x: jx, y: ey, z: jz }), cmul(sleeveCol, 0.8)), A.elbow);
    const cuffC = sl.cuff ? C(sl.cuff) : cmul(sleeveCol, 0.7);
    if (sl.kind === 'bell') {
      const bw = sl.bell ?? 0.1;
      const prof = [[0.056, 0.03], [0.058, -0.05], [bw * 0.7, -0.14], [bw * 0.95, -0.22], [bw, -0.255], [bw * 0.97, -0.262]];
      const lo = limb(jx, ey, jz, prof, { seg: 14, folds: 0.05, paint: (x, y) => (y < -0.235 && sl.cuff ? cuffC : cmul(sleeveCol, 0.75 + 0.3 * sstep(-0.26, 0, y))) });
      if (sl.tatter) {
        const p = lo.getAttribute('position');
        for (let i = 0; i < p.count; i++) if (p.getY(i) < ey - 0.25) p.setY(i, p.getY(i) + (Math.sin(i * 1.7) * 0.5 + 0.5) * 0.04 - 0.02);
        lo.computeVertexNormals();
      }
      add(M.clothDS, lo, A.elbow);
      // under-sleeve hugging the forearm
      add(M.cloth, limb(jx, ey, jz, [[0.05, 0.0], [0.046, -0.12], [0.04, -0.24]], { seg: 10, col: cmul(C(sl.under ?? inner.col), 0.8) }), A.elbow);
    } else {
      const flare = sl.kind === 'flare' ? 0.07 : 0.052;
      const prof = [[0.056, 0.03]];
      for (let k = 1; k <= 8; k++) prof.push([0.056 - 0.001 * k / 8, 0.03 - k * 0.011]);
      prof.push([0.05, -0.15], [flare * 0.95, -0.22], [flare, -0.245]);
      add(M.cloth, limb(jx, ey, jz, prof, { seg: 14, folds: 0.035, creases: [{ y: 0.0, w: 0.035, k: 0.06 }], paint: (x, y) => cmul(sleeveCol, (0.75 + 0.3 * sstep(-0.25, 0, y)) * (1 - 0.2 * Math.exp(-Math.pow(y / 0.035, 2)))) }), A.elbow);
      if (sl.cuffKind === 'turn') add(M.cloth, limb(jx, ey, jz, [[0.054, -0.16], [0.062, -0.17], [0.064, -0.24], [0.058, -0.25]], { seg: 12, col: cuffC }), A.elbow);
      else if (sl.cuffKind === 'fur') {
        const fc = noisify(torus(0.054, 0.02, 6, 14), 0.006, 40, s + 7, 2);
        const u = fc.getAttribute('uv'); for (let i = 0; i < u.count; i++) u.setXY(i, u.getX(i) * 2, u.getY(i) * 0.3);
        add(M.fur, paint(xf(fc, { rx: Math.PI / 2, x: jx, y: ey - 0.215, z: jz }), C(0xeceae6)), A.elbow);
      }
      else if (sl.cuffKind === 'bracer') add(M.leather, limb(jx, ey, jz, [[0.056, -0.09], [0.06, -0.1], [0.058, -0.24], [0.054, -0.25]], { seg: 12, col: C(0x4a3424), folds: 0.01 }), A.elbow);
      else if (sl.cuffKind === 'wrap') {
        const prof = [];
        for (let i = 0; i <= 10; i++) prof.push([0.05 + (i % 2) * 0.007, -0.1 - i * 0.014]);
        add(M.cloth, limb(jx, ey, jz, prof, { seg: 10, folds: 0.04, paint: (x, y) => cmul(cuffC, 0.85 + 0.2 * Math.sin(y * 220)) }), A.elbow);
      }
    }
    // an embroidered band round the cuff, in the coat's pattern
    const cEmb = coat?.emb;
    if (cEmb && sl.kind !== 'quilt') {
      const bell = sl.kind === 'bell';
      const cy = ey + (bell ? -0.235 : sl.cuffKind === 'turn' ? -0.205 : -0.225);
      const r = bell ? (sl.bell ?? 0.1) * 0.99 + 0.004 : sl.cuffKind === 'turn' ? 0.068 : (sl.kind === 'flare' ? 0.07 : 0.052) * 0.98 + 0.004;
      const pts = [], nrm = [];
      for (let i = 0; i <= 40; i++) { const a = (i / 40) * TAU; pts.push(V(jx + Math.sin(a) * r, cy, jz + Math.cos(a) * r)); nrm.push(V(Math.sin(a), 0, Math.cos(a))); }
      add(M.cloth, bandGeo(pts, nrm, bell ? 0.03 : 0.026, 0.0015, embroidery(cEmb.pattern, C(cEmb.base ?? coat.trim), C(cEmb.col), 0.04)), A.elbow);
    }
    if (sl.straps) {
      const w = [];
      for (const dy of [-0.12, -0.2]) w.push(xf(torus(0.062, 0.006, 4, 12), { rx: Math.PI / 2, x: jx, y: jy + dy, z: jz }));
      add(M.leather, paint(cat(w), C(0x1a1210)), A.shoulder);
    }
  }

  // ---- belt -------------------------------------------------------------------------
  D.sec = 'belt';
  const bl = cos.belt;
  outerR(BELT_Y, RR);
  const bpinch = coat ? 0.005 : 0.0;
  const brx = RR.rx - bpinch + 0.009, brz = RR.zf - bpinch + 0.009, brzB = RR.zb - bpinch + 0.009;
  const bz = (brz + brzB) / 2;
  const beltCol = C(bl.col);
  if (bl.rope) {
    const pts = [];
    for (let i = 0; i <= 40; i++) { const a = (i / 40) * TAU; pts.push(V(Math.sin(a) * brx, BELT_Y + Math.sin(a * 3) * 0.004, Math.cos(a) * bz)); }
    const r1 = tubeVar(pts, 0.011, 32, 4, false, true), r2 = tubeVar(pts.map((p) => p.clone().add(V(0, -0.016, 0))), 0.009, 32, 4, false, true);
    add(M.cloth, paint(cat([r1, r2]), beltCol), skins.torso);
    // knot and hanging ends
    const ka = 0.35;
    const kp = beltPt(brx, bz, BELT_Y, ka);
    add(M.cloth, paint(cat([sphere(0.02, 8, 6, { x: kp.x, y: kp.y - 0.005, z: kp.z + 0.008 }), tubeVar([kp.clone().add(V(0, -0.01, 0.012)), kp.clone().add(V(0.01, -0.12, 0.03)), kp.clone().add(V(0.015, -0.24, 0.035))], 0.008, 10, 5, true), tubeVar([kp.clone().add(V(-0.01, -0.01, 0.012)), kp.clone().add(V(-0.02, -0.1, 0.03)), kp.clone().add(V(-0.03, -0.19, 0.03))], 0.008, 10, 5, true)]), beltCol), skins.skirt);
  } else if (bl.sash) {
    add(M.cloth, beltGeo(brx + 0.004, bz + 0.004, BELT_Y, bl.h, beltCol), skins.torso);
  } else {
    add(M.leather, beltGeo(brx, bz, BELT_Y, bl.h, beltCol, { studs: bl.studs }), skins.torso);
    const bk = buckleGeo(C(bl.buckle ?? 0x6a6a70), bl.h * 1.05, bl.h * 1.1);
    add(M.metal, onBelt(bk, brx, bz, BELT_Y, 0.08, 0, 0.004), hips);
    // tongue end hanging past the buckle
    add(M.leather, onBelt(paint(xf(roundedBox(0.035, 0.1, 0.008, 0.003, 1), { y: -0.04, z: 0.008 }), cmul(beltCol, 0.9)), brx, bz, BELT_Y, -0.18, -0.01, 0.002), skins.skirt);
    if (bl.studs) {
      const st = [];
      for (let i = 0; i < 14; i++) { const a = 0.5 + i * 0.38; if (a > TAU - 0.4) break; st.push(onBelt(sphere(0.006, 5, 4), brx, bz, BELT_Y, a, 0, 0.002)); }
      add(M.metal, paint(cat(st), C(bl.buckle ?? 0x8a8a90)), hips);
    }
  }

  // ---- dangling things on cloth chains -------------------------------------------------
  const danglers = [];
  function dangler(a, len, o = {}) {
    const p0 = beltPt(brx, bz, BELT_Y - (o.drop ?? 0.02), a);
    const n = V(Math.sin(a) / brx, 0, Math.cos(a) / bz).normalize();
    p0.addScaledVector(n, o.out ?? 0.012);
    const p1 = p0.clone().add(V(0, -len, 0)).addScaledVector(n, 0.02);
    const ch = D.cloth.addChain(hips, [p0, p1], { name: 'dangle', stiff: o.stiff ?? 1.2, damp: o.damp ?? 2.0, r: o.r ?? 0.035, wind: 0.25, cone: true });
    danglers.push(ch);
    return { bone: ch.bones[0], p0, p1, n };
  }

  // ---- belt kit -------------------------------------------------------------------------
  D.sec = 'items';
  const metalC = (h) => C(h ?? bl.buckle ?? 0x8a8a90);
  for (const it of cos.items ?? []) {
    const a = it.a;
    switch (it.k) {
      case 'pouch': {
        const w = it.w ?? 0.075, h = it.h ?? 0.08;
        const g = pouchGeo(w, h, 0.045, C(it.col ?? 0x5e4430), C(0x46321f), metalC());
        add(M.leather, onBelt(g, brx, bz, BELT_Y, a, -h * 0.45, -0.004, -0.06), hips);
        break;
      }
      case 'vials': {
        const n = it.n ?? 3;
        const glass = [], cork = [], holder = [];
        for (let i = 0; i < n; i++) {
          const da = (i - (n - 1) / 2) * 0.15;
          const v = vialGeo([1, 1, 1], C(0x6a4a30));
          glass.push(onBelt(xf(v.glass, { y: -0.035, z: 0.016 }), brx, bz, BELT_Y, a + da, -0.02, 0.003));
          cork.push(onBelt(xf(v.cork, { y: -0.035, z: 0.016 }), brx, bz, BELT_Y, a + da, -0.02, 0.003));
        }
        holder.push(onBelt(paint(roundedBox(0.05 * n, 0.022, 0.012, 0.004, 1), C(0x2e2016)), brx, bz, BELT_Y, a, -0.045, 0.006));
        const vm = it.col === meta.color ? glowMat : glows.add(kit.glow(it.col, 1.6), 0.6);
        add(vm, cat(glass), hips);
        add(M.wood, paint(cat(cork), C(0x8a6a48)), hips);
        add(M.leather, cat(holder), hips);
        break;
      }
      case 'scroll': {
        const sc = scrollCaseGeo(C(0x5a3a24), C(0x8a7a60));
        for (const g of [sc.body, sc.caps]) xf(g, { rz: 0.9, rx: 0.2 });
        add(M.leather, onBelt(sc.body, brx, bz, BELT_Y, a, -0.04, 0.03), hips);
        add(M.metal, onBelt(sc.caps, brx, bz, BELT_Y, a, -0.04, 0.03), hips);
        break;
      }
      case 'tome': {
        const d = dangler(a, 0.2, { r: 0.07, stiff: 3 });
        const bk = bookGeo(C(it.cover ?? 0x4a2418), C(0xd8ccb0), C(it.metal ?? 0xb08850), 0.85);
        const q = Math.atan2(d.n.x, d.n.z);
        for (const g of [bk.leather, bk.pages, bk.metal]) xf(g, { ry: q + Math.PI / 2, x: d.p1.x, y: d.p1.y - 0.04, z: d.p1.z });
        add(M.leather, bk.leather, d.bone); add(M.plain, bk.pages, d.bone); add(M.metal, bk.metal, d.bone);
        add(M.metal, chainGeo(d.p0, d.p1.clone().add(V(0, 0.03, 0)), C(it.metal ?? 0xb08850), 0.007), d.bone);
        break;
      }
      case 'charm': {
        const d = dangler(a, 0.09 + rnd() * 0.04, { r: 0.03 });
        const cg = charmGeo(it.kind === 'coil' ? 'gear' : it.kind, { bone: C(0xd8d0bc), metal: C(it.kind === 'coil' ? 0xc87848 : 0xc8a050), feather: C(it.feather ?? 0xd8d4cc), leaf: C(0x5a7a2a) }, a * 10 | 0);
        const at = d.p1;
        for (const [k, g] of Object.entries(cg)) {
          xf(g, { x: at.x, y: at.y + 0.02, z: at.z, ry: a });
          const mat = k === 'glow' ? (it.glow === meta.color ? glowMat : it.glow === meta.color2 ? glow2 : glows.add(kit.glow(it.glow ?? meta.color, 1.6), 0.6)) : M[k];
          add(mat, k === 'glow' ? g : g, d.bone);
        }
        add(M.leather, cordGeo(d.p0, at.clone().add(V(0, 0.02, 0)), C(0x3a2a1a), 0.0025), d.bone);
        break;
      }
      case 'gourd': {
        const d = dangler(a, 0.12, { r: 0.05 });
        const gg = lathe([[0.0, -0.06], [0.035, -0.05], [0.04, -0.025], [0.022, 0.0], [0.025, 0.02], [0.014, 0.04], [0.01, 0.055]], 10);
        xf(gg, { x: d.p1.x, y: d.p1.y, z: d.p1.z });
        add(M.wood, paint(gg, C(0x8a6a3a)), d.bone);
        add(M.leather, cordGeo(d.p0, d.p1.clone().add(V(0, 0.05, 0)), C(0x3a2a1a), 0.003), d.bone);
        break;
      }
      case 'scabbard': {
        const sg = paint(roundedBox(0.05, 0.8, 0.02, 0.009, 1), (x, y) => cmul(C(0x2a1e16), 0.85 + 0.2 * Math.abs(Math.sin(y * 12))));
        const tipG = paint(cat([xf(roundedBox(0.058, 0.07, 0.026, 0.008, 1), { y: -0.39 }), xf(roundedBox(0.06, 0.05, 0.026, 0.006, 1), { y: 0.37 })]), C(0x8a929e));
        // hangs off the left hip, angled back so it clears the stride
        for (const g of [sg, tipG]) { xf(g, { y: -0.33 }); xf(g, { rx: -0.12, rz: 0.5 }); onBelt(g, brx, bz, BELT_Y - 0.02, a, 0, 0.03); }
        add(M.leather, sg, hips); add(M.metal, tipG, hips);
        break;
      }
      case 'quill': {
        const f = feather(0.17, 0.016, 5);
        onBelt(f, brx, bz, BELT_Y, a, -0.02, 0.02, 0.3);
        add(M.plainDS, paint(f, C(0xe8e0d0)), hips);
        break;
      }
      case 'watch': {
        const p0 = beltPt(brx, bz, BELT_Y + 0.0, a);
        const p1 = beltPt(brx, bz, BELT_Y - 0.08, a + 0.5);
        const n = V(Math.sin(a + 0.5) / brx, 0, Math.cos(a + 0.5) / bz).normalize();
        p0.addScaledVector(n, 0.01); p1.addScaledVector(n, 0.03);
        add(M.metal, chainGeo(p0, p1, C(0xd0a850), 0.005), skins.skirt);
        add(M.metal, paint(xf(new THREE.CylinderGeometry(0.022, 0.022, 0.01, 12), { rx: Math.PI / 2, ry: a + 0.5, x: p1.x, y: p1.y - 0.02, z: p1.z, order: 'YXZ' }), C(0xd0a850)), skins.skirt);
        break;
      }
      case 'chains': {
        const p0 = beltPt(brx, bz, BELT_Y, a), p1 = beltPt(brx, bz, BELT_Y - 0.15, a + 0.4), p2 = beltPt(brx, bz, BELT_Y, a + 0.9);
        for (const p of [p0, p1, p2]) p.multiplyScalar(1).add(V(0, 0, 0));
        const n1 = V(Math.sin(a + 0.4), 0, Math.cos(a + 0.4)).multiplyScalar(0.035);
        p1.add(n1);
        add(M.metal, cat([chainGeo(p0, p1, C(0x4a4a50), 0.007), chainGeo(p1, p2, C(0x4a4a50), 0.007)]), skins.skirt);
        break;
      }
      default:
    }
  }

  // ---- shoulders ---------------------------------------------------------------------
  D.sec = 'shoulders';
  const MANTLE = [[1.545, 0.075, 0.07, 0.074], [1.52, 0.135, 0.092, 0.1], [1.49, 0.21, 0.125, 0.13], [1.45, 0.262, 0.155, 0.152], [1.41, 0.288, 0.178, 0.17], [1.33, 0.302, 0.19, 0.185], [1.2, 0.31, 0.2, 0.192], [1.05, 0.31, 0.205, 0.195]];
  const mantleR = (off) => (y, o) => {
    let i = 0;
    while (i < MANTLE.length - 2 && MANTLE[i + 1][0] > y) i++;
    const a = MANTLE[i], b = MANTLE[i + 1];
    const t = Math.min(1, Math.max(0, (a[0] - y) / (a[0] - b[0])));
    const u = t * t * (3 - 2 * t) * 0.5 + t * 0.5;
    o.rx = a[1] + (b[1] - a[1]) * u + off; o.zf = a[2] + (b[2] - a[2]) * u + off; o.zb = a[3] + (b[3] - a[3]) * u + off;
    // never inside the coat
    outerR(y, RR);
    o.rx = Math.max(o.rx, RR.rx + 0.012); o.zf = Math.max(o.zf, RR.zf + 0.012); o.zb = Math.max(o.zb, RR.zb + 0.012);
    return o;
  };
  for (const sh of cos.shoulders ?? []) {
    switch (sh.k) {
      case 'mantle': {
        const col = C(sh.col);
        const p = clothPaint({ col, grime: 0.3, ao: 0.25, seed: sh.seed ?? 2, scorch: sh.scorch });
        const hem = sh.hem ?? 1.3;
        const g = garment({
          y0: 1.55, y1: hem, rows: 8, seg: 56, R: mantleR(0.0), seed: sh.seed ?? 2, pipe: true,
          fold: { n: 13, amp: (t) => 0.002 + 0.014 * Math.pow(t, 0.8) },
          tatter: sh.tatter ?? 0.04, rowCurve: (t) => t,
          paint: (c) => p({ ...c, t: (1.55 - c.y) / (1.55 - hem) }),
        });
        // a scooped neckline at the front, so the chin (and a beard) sits over the mantle, not in it
        {
          const depth = D.hat.face === 'open' ? 0.05 : 0.022, band = 0.09, pp = g.getAttribute('position');
          for (let i = 0; i < pp.count; i++) {
            const x = pp.getX(i), y = pp.getY(i), z = pp.getZ(i);
            if (y < 1.55 - band) continue;
            const w = Math.exp(-Math.pow(Math.atan2(x, z) / 0.75, 2)) * (1 - (1.55 - y) / band);
            pp.setY(i, y - depth * w);
          }
          g.computeVertexNormals();
        }
        if (sh.asym) {
          const pp = g.getAttribute('position');
          for (let i = 0; i < pp.count; i++) if (pp.getY(i) < 1.42 && pp.getX(i) < 0) pp.setY(i, pp.getY(i) - sh.asym * sstep(1.42, hem, pp.getY(i)) * sstep(0, -0.2, pp.getX(i)));
          g.computeVertexNormals();
        }
        add(sh.fur ? M.fur : M.clothDS, g, skins.mantle);
        break;
      }
      case 'capelet': {
        const col = C(sh.col);
        for (const [hem, off, seed] of [[1.36, 0.0, 3], [1.22, 0.014, 4]]) {
          const p = clothPaint({ col: cmul(col, hem < 1.3 ? 1 : 1.05), fade: sh.fade, grime: 0.25, ao: 0.25, seed });
          const top = hem < 1.3 ? 1.5 : 1.55;
          const g = garment({ y0: top, y1: hem, rows: 6, seg: 36, R: mantleR(off), seed, fold: { n: 8, amp: (t) => 0.002 + 0.012 * t }, tatter: 0.015, paint: (c) => p({ ...c, t: (top - c.y) / (top - hem) }) });
          add(M.clothDS, g, skins.mantle);
        }
        break;
      }
      case 'fur': {
        const g = torus(1, 0.5, 9, 26);
        const pp = g.getAttribute('position');
        for (let i = 0; i < pp.count; i++) {
          const x = pp.getX(i), y = pp.getY(i), z = pp.getZ(i);
          const a = Math.atan2(x, y);
          const ex = 0.17 + 0.03 * Math.abs(Math.sin(a)), ez = 0.12;
          pp.setXYZ(i, x * ex * 1.08, z * 0.16 + 1.5 - Math.abs(Math.sin(a)) * 0.01, y * ez * 1.12 - 0.008);
        }
        g.computeVertexNormals();
        noisify(g, 0.014, 22, 5, 3);
        const uv = g.getAttribute('uv');
        for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 3, uv.getY(i) * 0.4);
        add(M.fur, paint(g, (x, y) => cmul(C(sh.col), 0.75 + 0.3 * sstep(1.44, 1.53, y))), skins.mantle);
        break;
      }
      case 'hood': {
        const h = hoodGeo({ r: 0.13, peak: 0.05, drape: 0.6, gap: 1.5, ws: 18, hs: 10 });
        const tr = (g) => xf(g, { rx: -2.15, y: 1.465, z: -0.12, sx: 1.12, sy: 1, sz: 0.85 });
        tr(h.shell); tr(h.rim);
        noisify(h.shell, 0.006, 25, 3, 2);
        add(M.clothDS, paint(h.shell, (x, y) => cmul(C(sh.col), 0.6 + 0.4 * sstep(1.38, 1.5, y))), chest);
        add(M.cloth, paint(h.rim, C(sh.rim ?? sh.col)), chest);
        break;
      }
      case 'pauldron': {
        for (const A of [armL, armR]) {
          const s = A.s, jx = s * SHOULDER_X, jy = BODY_Y.shoulder, jz = -0.01;
          if (sh.kind === 'stone') {
            // a weathered boulder pauldron with a smaller stone stacked on it
            const g1 = noisify(sphere(0.095, 10, 7, { sy: 0.55, sz: 1.05 }), 0.014, 18, 20 + s, 2);
            const g2 = noisify(sphere(0.055, 8, 6, { sy: 0.6 }), 0.01, 22, 30 + s, 2);
            g2.translate(s * 0.025, 0.04, -0.01);
            const g = flat(cat([g1, g2]));
            xf(g, { rz: -s * 0.35 });
            xf(g, { x: jx + s * 0.03, y: jy + 0.02, z: jz });
            add(M.rock, paint(g, (x, y) => cmul(C(0x857d74), 0.75 + 0.35 * sstep(jy - 0.03, jy + 0.08, y))), A.shoulder);
            // amber rune studs on the stone
            add(glowMat, sphere(0.012, 6, 4, { x: jx + s * 0.05, y: jy + 0.07, z: jz + 0.06 }), A.shoulder);
          } else if (sh.kind === 'plate') {
            const lames = [];
            for (let i = 0; i < 3; i++) {
              const r = 0.1 - i * 0.004;
              const cap = new THREE.SphereGeometry(r, 14, 6, 0, TAU, 0.0, 0.95 - i * 0.05);
              xf(cap, { rz: -s * (0.55 + i * 0.32), sx: 1, sz: 1.15 });
              cap.translate(jx + s * (0.012 + i * 0.028), jy - 0.03 - i * 0.04, jz);
              lames.push(cap);
            }
            const g = cat(lames);
            add(M.armor, paint(g, (x, y) => cmul(C(0x7a828e), 0.8 + 0.3 * Math.abs(Math.sin(y * 70)))), A.shoulder);
            add(M.metal, paint(cat([0, 1, 2].map((i) => sphere(0.007, 5, 4, { x: jx + s * (0.05 + i * 0.028), y: jy + 0.03 - i * 0.045, z: jz + 0.085 }))), C(0xb8a070)), A.shoulder);
          } else if (sh.kind === 'gold') {
            const cap = new THREE.SphereGeometry(0.082, 14, 6, 0, TAU, 0, 1.0);
            xf(cap, { rz: -s * 0.45, sz: 1.1 });
            cap.translate(jx + s * 0.012, jy - 0.012, jz);
            const top = jy - 0.012 + 0.082;
            add(M.cloth, paint(cap, (x, y) => (y < top - 0.036 ? C(0xc8a040) : C(0xe4dccc))), A.shoulder);
          }
        }
        break;
      }
      case 'leaves': {
        const lv = [];
        const r2 = mulberry(31);
        for (let i = 0; i < 22; i++) {
          const a = r2() * TAU;
          const y = 1.33 + r2() * 0.2;
          const [x, z] = ringPt(...(() => { mantleR(0.01)(y, RR); return [RR.rx, RR.zf, RR.zb]; })(), a);
          const lg = leaf(0.07 + r2() * 0.04, 0.022, 0.25);
          xf(lg, { rx: 0.3 + r2() * 0.6, rz: Math.PI + (r2() - 0.5) * 1.2, ry: a, order: 'YXZ' });
          lg.translate(x, y, z);
          paint(lg, cmix(C(0x4a6a20), C(0x8a7a2a), r2() * 0.6));
          lv.push(lg);
        }
        add(M.plainDS, cat(lv), skins.mantle);
        break;
      }
      case 'scarf': {
        // a long scarf wound at the neck with two tails streaming behind
        const col = C(sh.col);
        const wound = torus(1, 0.32, 6, 22);
        const pp = wound.getAttribute('position');
        for (let i = 0; i < pp.count; i++) pp.setXYZ(i, pp.getX(i) * 0.1, pp.getZ(i) * 0.05 + 1.52 + pp.getY(i) * 0.012, pp.getY(i) * 0.09);
        wound.computeVertexNormals();
        noisify(wound, 0.006, 30, 2, 2);
        add(M.cloth, paint(wound, col), (v) => [[chest, 0.5], [neck, 0.5]]);
        tails(-0.35, 0.55, col, 0.065);
        tails(0.3, 0.45, cmul(col, 0.9), 0.06);
        break;
      }
      case 'feathers': {
        const fa = [];
        const r2 = mulberry(41);
        for (const s of [1, -1]) for (let i = 0; i < 6; i++) {
          const f = feather(0.12 + r2() * 0.05, 0.02, 50 + i);
          xf(f, { rz: Math.PI - s * (0.3 + i * 0.12), rx: -0.3 - r2() * 0.3, ry: s * (0.2 + r2() * 0.3) });
          f.translate(s * (0.15 + i * 0.012), 1.5 - i * 0.012, -0.03 - i * 0.012);
          paint(f, i % 2 ? C(0xe0dcd4) : C(0x5a5a62));
          fa.push(f);
        }
        add(M.plainDS, cat(fa), skins.mantle);
        break;
      }
      default:
    }
  }

  // ---- long cloth tails on their own chains (scarf ends, sash ends) -----------------------
  function tails(a, len, col, w, anchorY = 1.47, parent = chest) {
    // anchor on the upper back / side, hanging behind the body
    outerR(anchorY, RR);
    const segs = 3;
    const p0 = V(...(() => { const [x, z] = ringPt(RR.rx + 0.03, RR.zf + 0.03, RR.zb + 0.03, Math.PI + a); return [x, anchorY, z]; })());
    const pts = [p0];
    for (let k = 1; k <= segs; k++) pts.push(p0.clone().add(V(Math.sin(a) * 0.02 * k, -len * (k / segs), -0.03 * k)));
    const ch = D.cloth.addChain(parent, pts, { name: 'tail', stiff: 0.6, damp: 1.5, r: 0.03, wind: 1.6, cone: true });
    const path = [], nrm = [];
    const n = 12;
    for (let i = 0; i <= n; i++) {
      const s = (i / n) * segs;
      const k = Math.min(segs - 1, Math.floor(s)), f = s - k;
      path.push(pts[k].clone().lerp(pts[k + 1], f));
      nrm.push(V(Math.sin(Math.PI + a), 0, Math.cos(Math.PI + a)));
    }
    const g = ribbon(path, nrm, (t) => w * (1 - t * 0.3), 0.0, (t) => cmul(col, 0.8 + 0.25 * (1 - t)));
    // tattered end
    const pp = g.getAttribute('position');
    for (let i = pp.count - 2; i < pp.count; i++) pp.setY(i, pp.getY(i) + (i % 2 ? 0.04 : 0));
    add(M.clothDS, g, (v) => {
      // nearest segment by height along the chain
      const s = Math.min(segs - 1e-3, Math.max(0, ((p0.y - v.y) / len) * segs));
      const k = Math.floor(s), f = s - k;
      if (f > 0.5 && k < segs - 1) return [[ch.bones[k], 1.5 - f], [ch.bones[k + 1], f - 0.5]];
      if (f < 0.5 && k > 0) return [[ch.bones[k], 0.5 + f], [ch.bones[k - 1], 0.5 - f]];
      return [[ch.bones[k], 1]];
    });
    return ch;
  }

  // ---- back cape -----------------------------------------------------------------------------
  D.sec = 'cape';
  if (cos.cape) {
    const cp = cos.cape;
    const cols = 5, segs = 3, gw = 12, gh = 12;
    const y0 = 1.44, hem = cp.hem;
    const spread = cp.half ? [0.15, 1.35] : [-1.15, 1.15]; // angle range around the back (a = PI + s)
    const capeAt = (u, y) => {
      const s = spread[0] + (spread[1] - spread[0]) * u;
      const t = (y0 - y) / (y0 - hem);
      mantleR(0.02)(Math.max(y, 1.2), RR);
      const rx = RR.rx + t * 0.06, rzb = RR.zb + 0.02 + t * 0.1;
      const a = Math.PI + s * (1 - t * 0.25);
      const [x, z] = ringPt(rx, rzb, rzb, a);
      return V(x, y, z - t * 0.04);
    };
    const chains = [];
    for (let j = 0; j < cols; j++) {
      const u = j / (cols - 1);
      const pts = [];
      for (let k = 0; k <= segs; k++) pts.push(capeAt(u, y0 + (hem - y0) * (k / segs)));
      chains.push(D.cloth.addChain(chest, pts, { name: 'cape', stiff: 0.9, damp: 1.7, r: 0.025, wind: 1.3, cone: true, phase: j * 1.3 }));
    }
    D.cloth.addRing(chains, false, 0.7, 1.25);
    const pos = [], uv = [], col = [];
    const ccol = C(cp.col), trim = cp.trim ? C(cp.trim) : null;
    const r2 = mulberry(77);
    const J = Array.from({ length: gw + 1 }, () => r2());
    const capeUV = [];
    for (let r = 0; r <= gh; r++) {
      const t = r / gh;
      for (let c = 0; c <= gw; c++) {
        const u = c / gw;
        let y = y0 + (hem - y0) * t;
        if (r === gh && cp.tatter) y += cp.tatter * (0.3 * J[c] + 0.7 * J[c] * (c % 2));
        const p = capeAt(u, Math.max(y, hem - 0.1));
        // folds
        const f = Math.sin(u * 18 + 1.3) * 0.6 + Math.sin(u * 37) * 0.3;
        p.z -= f * 0.012 * t;
        pos.push(p.x, y, p.z);
        uv.push(u * 2, t * 3);
        capeUV.push([u, t]);
        let cc = trim && (c === 0 || c === gw || r >= gh - 1) ? trim : ccol;
        if (cp.moss) cc = cmix(cc, C(0x2a3a1c), Math.max(0, fbm3(u * 4, t * 4, 1, 3, 2)) * cp.moss);
        col.push(...cmul(cc, (1 + f * 0.2) * (1 - 0.3 * sstep(0.7, 1, t))));
      }
    }
    const idx = [];
    for (let r = 0; r < gh; r++) for (let c = 0; c < gw; c++) { const a = r * (gw + 1) + c, b = a + gw + 1; idx.push(a, a + 1, b, b, a + 1, b + 1); }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    let vi = 0;
    const skinCape = (v) => {
      // map by the authored (u, t) of this vertex, in order
      const [u, t] = capeUV[vi++ % capeUV.length];
      const fj = u * (cols - 1), j0 = Math.min(cols - 2, Math.floor(fj)), fu = fj - j0;
      const s = Math.min(segs - 1e-3, t * segs), k = Math.floor(s), fk = s - k;
      const out = [];
      const segW = fk > 0.5 && k < segs - 1 ? [[k, 1.5 - fk], [k + 1, fk - 0.5]] : fk < 0.5 && k > 0 ? [[k, 0.5 + fk], [k - 1, 0.5 - fk]] : [[k, 1]];
      if (t < 0.02) return [[chest, 1]];
      for (const [kk, w] of segW) { out.push([chains[j0].bones[kk], w * (1 - fu)]); out.push([chains[j0 + 1].bones[kk], w * fu]); }
      return out.sort((p, q) => q[1] - p[1]).slice(0, 4);
    };
    add(M.clothDS, g, skinCape);
    // clasps where the cape meets the shoulders
    if (!cp.half) {
      const cl = [];
      for (const s of [1, -1]) { const a = s > 0 ? 0.62 : TAU - 0.62; outerR(1.43, RR); const [x, z] = ringPt(RR.rx + 0.012, RR.zf + 0.012, RR.zb, a); cl.push(xf(new THREE.CylinderGeometry(0.02, 0.02, 0.008, 10), { rx: Math.PI / 2, ry: a, x, y: 1.43, z, order: 'YXZ' })); }
      add(M.metal, paint(cat(cl), metalC()), skins.torso);
    }
  }

  // ---- class extras -----------------------------------------------------------------------------
  D.sec = 'extras';
  const onSurf = (y, a, off) => { outerR(y, RR); const [x, z] = ringPt(RR.rx + off, RR.zf + off, RR.zb + off, a); return V(x, y, z); };
  const surfN = (y, a) => { outerR(y, RR); return V(Math.sin(a) / RR.rx, 0, Math.cos(a) / (Math.cos(a) > 0 ? RR.zf : RR.zb)).normalize(); };
  // on the outermost layer at the chest: over a mantle where one hangs that low
  const mantleHem = Math.min(9, ...(cos.shoulders ?? []).filter((q) => q.k === 'mantle').map((q) => q.hem ?? 1.3));
  const onTop = (y, a, off) => {
    if (y <= mantleHem + 0.01) return onSurf(y, a, off);
    mantleR(0)(y, RR);
    const [x, z] = ringPt(RR.rx + off + 0.004, RR.zf + off + 0.004, RR.zb + off + 0.004, a);
    return V(x, y, z);
  };
  for (const ex of cos.extras ?? []) {
    switch (ex.k) {
      case 'stole': {
        // two bands from behind the neck, over the shoulders and down the front
        for (const s of [1, -1]) {
          const path = [], nrm = [];
          const key = [[1.5, Math.PI - 0.6], [1.5, 1.45], [1.47, 0.9], [1.4, 0.5], [1.3, 0.38], [1.15, 0.32], [BELT_Y, 0.3], [0.9, 0.3], [0.7, 0.31], [0.5, 0.33]];
          for (let i = 0; i < key.length - 1; i++) for (let j = 0; j < 3; j++) {
            const f = j / 3;
            const y = key[i][0] + (key[i + 1][0] - key[i][0]) * f, a = key[i][1] + (key[i + 1][1] - key[i][1]) * f;
            const aa = s > 0 ? a : TAU - a;
            const p = y > 1.45 ? (() => { mantleR(0.004)(y, RR); const [x, z] = ringPt(RR.rx * 0.7, RR.zf, RR.zb, aa); return V(x, y + 0.012, z); })() : onSurf(y, aa, y < BELT_Y ? 0.022 : 0.008);
            path.push(p);
            nrm.push(y > 1.45 ? V(0, 1, 0).lerp(surfN(y, aa), 0.4) : surfN(y, aa));
          }
          const w = ex.narrow ? 0.06 : 0.08;
          add(M.cloth, ribbon(path, nrm, w, 0.004, (t) => cmul(C(ex.col), 0.9 + 0.1 * Math.sin(t * 40)), { edge: [C(ex.edge), 0.14] }), skins.skirt);
        }
        break;
      }
      case 'harness': {
        // X straps across the chest with buckles, plus a vial bandolier
        const straps = [], buck = [], vials = [];
        for (const s of [1, -1]) {
          const path = [], nrm = [];
          for (let i = 0; i <= 16; i++) {
            const t = i / 16;
            const y = 1.47 - t * (1.47 - 1.06);
            const a = s * (1.1 - t * 1.6);
            const aa = (a + TAU) % TAU;
            path.push(onSurf(y, aa, 0.006));
            nrm.push(surfN(y, aa));
            if (s > 0 && i > 3 && i < 13 && i % 3 === 1) vials.push(xf(cat([new THREE.CylinderGeometry(0.01, 0.01, 0.04, 6), sphere(0.011, 6, 4, { y: -0.018 })]), { x: path[i].x, y: path[i].y, z: path[i].z + 0.012 }));
          }
          straps.push(ribbon(path, nrm, 0.032, 0.005, () => C(ex.col)));
          // back half
          const bp = [], bn = [];
          for (let i = 0; i <= 10; i++) { const t = i / 10; const y = 1.47 - t * 0.41; const aa = Math.PI + s * (1.0 - t * 1.6); bp.push(onSurf(y, (aa + TAU) % TAU, 0.006)); bn.push(surfN(y, (aa + TAU) % TAU)); }
          straps.push(ribbon(bp, bn, 0.032, 0.005, () => C(ex.col)));
        }
        const cpt = onSurf(1.27, 0, 0.012);
        buck.push(xf(new THREE.CylinderGeometry(0.022, 0.022, 0.008, 12), { rx: Math.PI / 2, x: cpt.x, y: cpt.y, z: cpt.z }));
        add(M.leather, cat(straps), skins.torso);
        add(M.metal, paint(cat(buck), C(ex.metal)), skins.torso);
        add(ex.vials === meta.color ? glowMat : glows.add(kit.glow(ex.vials, 1.8), 0.6), cat(vials), skins.torso);
        // thigh straps over the trousers
        for (const [s, L] of [[1, legL], [-1, legR]]) add(M.leather, paint(xf(torus(0.088, 0.007, 4, 14), { rx: Math.PI / 2, x: s * HIP_X, y: 0.72 }), C(ex.col)), L.thigh);
        break;
      }
      case 'sash': {
        // a wide sash knotted at the hip, ends hanging along the coat
        const a = ex.a;
        const p = onSurf(BELT_Y - 0.01, (a + TAU) % TAU, 0.022);
        add(M.cloth, paint(noisify(sphere(0.03, 8, 6, { x: p.x, y: p.y, z: p.z, sx: 1.2 }), 0.004, 40, 2, 2), C(ex.col)), skins.torso);
        for (const da of [-0.05, 0.08]) {
          const path = [], nrm = [];
          const L = ex.long ? 0.75 : 0.5;
          for (let i = 0; i <= 10; i++) {
            const y = BELT_Y - 0.02 - (i / 10) * L;
            const aa = (a + da + i * 0.01 + TAU) % TAU;
            path.push(onSurf(y, aa, 0.03));
            nrm.push(surfN(y, aa));
          }
          add(M.clothDS, ribbon(path, nrm, (t) => 0.07 - t * 0.015, 0.0, (t) => cmul(C(ex.col), 0.95 - 0.15 * t)), skins.skirt);
        }
        // wraps around the waist under the belt
        add(M.cloth, beltGeo(brx + 0.006, bz + 0.006, BELT_Y + 0.045, 0.04, cmul(C(ex.col), 0.9)), skins.torso);
        break;
      }
      case 'wraps': {
        // cloth bands spiralling around the torso
        // cloth bands crossing the chest from shoulder to hip, front and back
        const bands = [];
        for (const s of [1, -1]) for (const back of [0, 1]) {
          const path = [], nrm = [];
          for (let i = 0; i <= 14; i++) {
            const t = i / 14;
            const y = 1.47 - t * 0.43;
            const a = ((back ? Math.PI : 0) + s * (back ? -1 : 1) * (1.05 - t * 1.9) + TAU) % TAU;
            path.push(onSurf(y, a, 0.007 + back * 0.002));
            nrm.push(surfN(y, a));
          }
          bands.push(ribbon(path, nrm, 0.034, 0.003, (t) => cmul(C(ex.col), 0.8 + 0.2 * Math.sin(t * 40))));
        }
        add(M.cloth, cat(bands), skins.torso);
        break;
      }
      case 'sigils': {
        // glowing glyphs on the coat skirt and chest
        const strokes = [];
        const r3 = mulberry(55);
        const glyph = (cy, ca, size) => {
          const ring = [], rn = [];
          for (let i = 0; i <= 18; i++) {
            const q = (i / 18) * TAU;
            const y = cy + Math.sin(q) * size, a = ca + (Math.cos(q) * size) / 0.25;
            ring.push(onSurf(y, a, 0.012)); rn.push(surfN(y, a));
          }
          strokes.push(ribbon(ring, rn, 0.005, 0.001, () => [1, 1, 1]));
          for (let k = 0; k < 3; k++) {
            const q0 = r3() * TAU, q1 = q0 + 2 + r3();
            const l = [], ln = [];
            for (let i = 0; i <= 4; i++) {
              const f = i / 4;
              const y = cy + (Math.sin(q0) * (1 - f) + Math.sin(q1) * f) * size * 0.8, a = ca + ((Math.cos(q0) * (1 - f) + Math.cos(q1) * f) * size * 0.8) / 0.25;
              l.push(onSurf(y, a, 0.012)); ln.push(surfN(y, a));
            }
            strokes.push(ribbon(l, ln, 0.004, 0.001, () => [1, 1, 1]));
          }
        };
        for (let i = 0; i < 7; i++) glyph(0.32 + (i % 2) * 0.12, 0.75 + i * 0.68, 0.045);
        glyph(1.32, 0.42, 0.035); glyph(1.32, TAU - 0.42, 0.035);
        add(glowMat, cat(strokes), skins.skirt);
        break;
      }
      case 'medallion': {
        const p = onSurf(1.3, 0, 0.02);
        const disc = cat([xf(new THREE.CylinderGeometry(0.04, 0.04, 0.008, 18), { rx: Math.PI / 2 }), ...Array.from({ length: 12 }, (_, i) => xf(new THREE.ConeGeometry(0.008, 0.03, 4), { rz: (i / 12) * TAU, x: -Math.sin((i / 12) * TAU) * 0.05, y: Math.cos((i / 12) * TAU) * 0.05 }))]);
        xf(disc, { x: p.x, y: p.y, z: p.z, rx: -0.2 });
        add(M.metal, paint(disc, C(0xe0b040)), chest);
        add(glowMat, xf(sphere(0.018, 10, 8, { sz: 0.5 }), { x: p.x, y: p.y, z: p.z + 0.008 }), chest);
        const a = onSurf(1.5, 0.5, 0.005), b = onSurf(1.5, TAU - 0.5, 0.005);
        add(M.metal, cat([cordGeo(a, p.clone().add(V(0.01, 0.04, 0)), C(0xe0b040), 0.0035), cordGeo(b, p.clone().add(V(-0.01, 0.04, 0)), C(0xe0b040), 0.0035)]), skins.torso);
        break;
      }
      case 'breastplate': {
        const steel = C(0x737a84);
        const R2 = layerR(0.03, 0);
        const g = garment({ y0: 1.44, y1: 1.1, rows: 12, seg: 30, R: (y, o) => { R2(y, o); const ch = Math.sin(Math.PI * sstep(1.1, 1.44, y)); o.zf += 0.022 * ch; o.rx -= 0.012 * (1 - ch); return o; }, fold: { n: 1, amp: () => 0 }, paint: (c) => cmul(steel, 0.8 + 0.25 * Math.max(0, Math.cos(c.a)) - (c.y > 1.425 || c.y < 1.115 ? 0.3 : 0)), e: 0.92 });
        // centre ridge
        const pp = g.getAttribute('position');
        for (let i = 0; i < pp.count; i++) { const x = pp.getX(i), z = pp.getZ(i); if (z > 0) pp.setZ(i, z + 0.01 * Math.exp(-Math.pow(x / 0.025, 2))); }
        g.computeVertexNormals(); weldNormals(g);
        add(M.armor, g, skins.torso);
        // rolled neck and arm edges
        const nr = xf(torus(1, 0.011, 5, 24), { rx: Math.PI / 2 });
        nr.scale(0.125, 1, 0.112); nr.translate(0, 1.44, 0);
        add(M.armor, paint(nr, cmul(steel, 1.2)), skins.torso);
        break;
      }
      case 'faulds': {
        const steel = C(0x6a717b);
        for (let i = 0; i < 3; i++) {
          const y0 = 1.09 - i * 0.05;
          const R3 = layerR(0.04 + i * 0.006, 0.4);
          const g = garment({ y0, y1: y0 - 0.065, rows: 2, seg: 30, R: R3, panels: [[() => 0.0, () => TAU]], fold: { n: 1, amp: () => 0 }, paint: (c) => cmul(steel, c.y > y0 - 0.008 ? 1.1 : 0.85), e: 0.8 });
          add(M.armor, g, skins.skirt);
        }
        // tassets over the thighs
        for (const [s, L] of [[1, legL], [-1, legR]]) {
          const R4 = layerR(0.05, 0.3);
          const ac = s > 0 ? 0.55 : TAU - 0.55;
          const g = garment({ y0: 0.95, y1: 0.7, rows: 4, seg: 6, R: R4, panels: [[() => ac - 0.38, () => ac + 0.38]], fold: { n: 1, amp: () => 0 }, paint: (c) => cmul(steel, 0.8 + 0.2 * ((c.y * 20) % 1)), e: 0.8 });
          add(M.armor, g, (v) => [[L.thigh, 0.6], [hips, 0.4]]);
        }
        break;
      }
      case 'vambrace': {
        for (const A of [armL]) {
          const jx = A.s * SHOULDER_X, ey = BODY_Y.shoulder - 0.28;
          add(M.armor, limb(jx, ey, -0.01, [[0.058, -0.06], [0.062, -0.07], [0.06, -0.2], [0.056, -0.22]], { seg: 12, col: C(0x6e757f) }), A.elbow);
        }
        break;
      }
      case 'kneecops': {
        for (const [s, L] of [[1, legL], [-1, legR]]) {
          const cap = new THREE.SphereGeometry(0.062, 12, 6, -Math.PI * 0.75, Math.PI * 1.5, 0.3, 1.5);
          xf(cap, { rx: -0.2, x: s * HIP_X, y: BODY_Y.knee, z: 0.012, sz: 1.1 });
          add(M.armor, paint(cap, C(0x6e757f)), L.knee);
          add(M.armor, paint(limb(s * HIP_X, BODY_Y.knee, 0, [[0.06, -0.05], [0.064, -0.07], [0.058, -0.3], [0.055, -0.32]], { seg: 10 }), C(0x5e646d)), L.knee);
        }
        break;
      }
      // ---- class signatures ----
      case 'embers': {
        // smouldering flecks caught in the singed hem (they pulse with the class glow)
        const fl = [];
        const r6 = mulberry(71);
        for (let i = 0; i < 70; i++) {
          const a = r6() * TAU;
          const hem = coat ? coat.hem : inner.hem;
          const y = hem + 0.01 + Math.pow(r6(), 2.2) * 0.32;
          if (coat && Math.min(a, TAU - a) < coat.gap[3] * 0.8 && y < 0.6) continue;
          const p = coatSurf ? coatSurf(y, a, 0.0025) : onSurf(y, a, 0.004);
          const d = new THREE.CircleGeometry(0.0025 + r6() * 0.005, 5);
          d.lookAt(V(p.x, 0, p.z));
          d.translate(p.x, p.y, p.z);
          const k = 0.5 + r6() * 0.9;
          fl.push(paint(d, [k, k * (0.6 + 0.3 * r6()), k * 0.5]));
        }
        add(glowMat, cat(fl), skins.skirt);
        break;
      }
      case 'frost': {
        // clusters of ice on the shoulders and at the throat: pale crystal, a few glowing from within
        const ice = [], lit = [];
        const r6 = mulberry(73);
        const cluster = (c, up, n, sc) => {
          for (let i = 0; i < n; i++) {
            const g = crystal((0.04 + r6() * 0.05) * sc, (0.007 + r6() * 0.006) * sc, 6, 80 + i);
            const d = up.clone().add(V((r6() - 0.5) * 0.9, (r6() - 0.3) * 0.5, (r6() - 0.5) * 0.9)).normalize();
            g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(V(0, 1, 0), d));
            g.translate(c.x + (r6() - 0.5) * 0.04 * sc, c.y + (r6() - 0.5) * 0.015, c.z + (r6() - 0.5) * 0.04 * sc);
            (i % 3 === 0 ? lit : ice).push(i % 3 === 0 ? paint(g, [0.7, 0.7, 0.7]) : paint(g, cmix(C(0xc8e4f4), C(0x6a9ab8), r6() * 0.6)));
          }
        };
        for (const s2 of [1, -1]) cluster(V(s2 * 0.17, 1.5, -0.02), V(s2 * 0.6, 1, -0.1).normalize(), 7, 1);
        cluster(V(0, 1.45, 0.13), V(0, 0.4, 1).normalize(), 4, 0.7);
        add(M.plain, cat(ice), skins.mantle);
        add(glowMat, cat(lit), skins.mantle);
        break;
      }
      case 'coils': {
        // copper wire wound round each forearm, a brass ring either end
        for (const A of [armL, armR]) {
          const jx = A.s * SHOULDER_X, ey = BODY_Y.shoulder - 0.28;
          const w = tubeVar(helixPts(0.059, ey - 0.06, ey - 0.19, 9, 120).map((p) => p.add(V(jx, 0, -0.01))), 0.0028, 120, 4, false);
          const rings = cat([xf(torus(0.06, 0.004, 4, 18), { rx: Math.PI / 2, x: jx, y: ey - 0.055, z: -0.01 }), xf(torus(0.06, 0.004, 4, 18), { rx: Math.PI / 2, x: jx, y: ey - 0.195, z: -0.01 })]);
          add(M.metal, cat([paint(w, C(0xc87040)), paint(rings, C(0xd8a050))]), A.elbow);
          add(glowMat, paint(xf(torus(0.061, 0.0016, 3, 18), { rx: Math.PI / 2, x: jx, y: ey - 0.125, z: -0.01 }), [0.8, 0.8, 0.8]), A.elbow);
        }
        break;
      }
      case 'stars': {
        // a constellation stitched in glowing thread over the coat skirt
        const st = [];
        const r6 = mulberry(75);
        const star = (r) => { const sh = new THREE.Shape(); for (let i = 0; i <= 8; i++) { const a = (i / 8) * TAU; const rr = i % 2 ? r * 0.3 : r; const px = Math.sin(a) * rr, py = Math.cos(a) * rr; if (i) sh.lineTo(px, py); else sh.moveTo(px, py); } return new THREE.ShapeGeometry(sh); };
        for (let i = 0; i < 34; i++) {
          const a = 0.9 + r6() * (TAU - 1.8);
          const y = 0.15 + r6() * 0.75;
          const p = coatSurf ? coatSurf(y, a, 0.003) : onSurf(y, a, 0.004);
          const g = star(0.006 + r6() * 0.008);
          g.lookAt(V(p.x, 0, p.z)); g.translate(p.x, p.y, p.z);
          const k = 0.5 + r6() * 0.7;
          st.push(paint(g, [k, k, k]));
        }
        add(glow2, cat(st), skins.skirt);
        break;
      }
      case 'ribcage': {
        // a cage of ribs strapped over the chest, a sternum down the middle
        const bones = [];
        for (let i = 0; i < 5; i++) {
          const y0 = 1.39 - i * 0.048;
          for (const s2 of [1, -1]) {
            const pts = [];
            for (let k = 0; k <= 8; k++) { const t = k / 8; const a = 0.08 + t * 1.15; pts.push(onTop(y0 - t * (0.05 + i * 0.006) - t * t * 0.02, s2 > 0 ? a : TAU - a, 0.012 + 0.006 * Math.sin(t * Math.PI))); }
            bones.push(tubeVar(pts, (t) => 0.0075 * (1 - 0.45 * t) + 0.002, 16, 5, true));
          }
        }
        const sp = [];
        for (let k = 0; k <= 8; k++) sp.push(onTop(1.42 - k * 0.03, 0, 0.016));
        bones.push(tubeVar(sp, 0.01, 16, 6, true));
        for (let k = 0; k < 6; k++) bones.push(sphere(0.012, 6, 4, { ...(() => { const p = onTop(1.41 - k * 0.045, 0, 0.02); return { x: p.x, y: p.y, z: p.z }; })(), sz: 0.6 }));
        add(M.bone, paint(cat(bones), C(0xd8d0bc)), skins.torso);
        break;
      }
      case 'gearbrooch': {
        // a clockwork brooch at the breast: two meshing gears round a glowing arbor
        const p = onSurf(1.33, 0.32, 0.014), n = surfN(1.33, 0.32);
        const q = new THREE.Quaternion().setFromUnitVectors(V(0, 0, 1), n);
        const g1 = gear(14, 0.03, 0.037, 0.007, 0.01), g2 = gear(9, 0.017, 0.023, 0.006, 0.005);
        g2.translate(0.036, -0.026, 0.004);
        const rim = torus(0.022, 0.003, 4, 20);
        for (const g of [g1, g2, rim]) { g.applyQuaternion(q); g.translate(p.x, p.y, p.z); }
        add(M.metal, cat([paint(g1, C(0xd0a850)), paint(g2, C(0xb88a40)), paint(rim, C(0xe0c070))]), skins.torso);
        add(glowMat, paint(sphere(0.008, 8, 6, { x: p.x + n.x * 0.006, y: p.y, z: p.z + n.z * 0.006 }), [1, 1, 1]), skins.torso);
        break;
      }
      case 'eye': {
        // an amulet: a lidded eye in black iron, its iris lit
        const p = onTop(1.3, 0, 0.022);
        const frame = torus(0.026, 0.005, 5, 24);
        frame.scale(1.35, 0.7, 1);
        frame.translate(p.x, p.y, p.z);
        const spikes = [];
        for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI + Math.PI / 12; spikes.push(xf(new THREE.ConeGeometry(0.004, 0.022, 4), { rz: a - Math.PI / 2, x: p.x + Math.cos(a) * 0.04, y: p.y + Math.sin(a) * 0.024, z: p.z })); }
        add(M.metal, paint(cat([frame, ...spikes]), C(0x2a2630)), skins.torso);
        add(glowMat, paint(sphere(0.012, 10, 8, { x: p.x, y: p.y, z: p.z, sz: 0.5 }), [1.2, 1.2, 1.2]), skins.torso);
        add(M.metal, cat([cordGeo(onTop(1.5, 0.55, 0.004), p.clone().add(V(0.03, 0.01, 0)), C(0x2a2630), 0.003), cordGeo(onTop(1.5, TAU - 0.55, 0.004), p.clone().add(V(-0.03, 0.01, 0)), C(0x2a2630), 0.003)]), skins.torso);
        break;
      }
      case 'halo': {
        // a ring of light standing behind the head
        const hy = BODY_Y.head + 0.02;
        const ring = torus(0.15, 0.0035, 4, 48);
        const rays = [];
        for (let i = 0; i < 24; i++) { const a = (i / 24) * TAU; const l = i % 2 ? 0.022 : 0.04; rays.push(xf(new THREE.PlaneGeometry(0.003, l), { rz: a, x: -Math.sin(a) * (0.165 + l / 2), y: Math.cos(a) * (0.165 + l / 2) })); }
        const g = cat([paint(ring, [1, 1, 1]), paint(cat(rays), [0.6, 0.6, 0.6])]);
        xf(g, { rx: -0.15, y: hy, z: -0.14 });
        add(glowMat, g, head);
        break;
      }
      case 'shards': {
        // crystals breaking out of the stone pauldrons
        for (const A of [armL, armR]) {
          const s2 = A.s, jx = s2 * SHOULDER_X, jy = BODY_Y.shoulder;
          const sh = [];
          for (let i = 0; i < 4; i++) {
            const g = crystal(0.05 + i * 0.012, 0.011 - i * 0.001, 6, 90 + i + (s2 > 0 ? 0 : 10));
            const d = V(s2 * (0.25 + i * 0.12), 1, -0.15 + i * 0.12).normalize();
            g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(V(0, 1, 0), d));
            g.translate(jx + s2 * (0.03 + i * 0.012), jy + 0.055, -0.04 + i * 0.022);
            sh.push(g);
          }
          add(glowMat, paint(cat(sh), [0.8, 0.8, 0.8]), A.shoulder);
        }
        break;
      }
      case 'mushrooms': {
        // little caps sprouting from the mossy mantle
        const caps = [], stems = [];
        const r6 = mulberry(79);
        for (const s2 of [1, -1]) for (let i = 0; i < 5; i++) {
          const a = s2 * (0.9 + r6() * 0.9), y = 1.36 + r6() * 0.12;
          mantleR(0.0)(y, RR);
          const [x, z] = ringPt(RR.rx, RR.zf, RR.zb, (a + TAU) % TAU);
          const h = 0.014 + r6() * 0.016, r = 0.008 + r6() * 0.01;
          stems.push(xf(new THREE.CylinderGeometry(r * 0.3, r * 0.4, h, 5), { x, y: y + h / 2, z }));
          const cap = new THREE.SphereGeometry(r, 8, 4, 0, TAU, 0, Math.PI / 2);
          cap.scale(1, 0.6, 1);
          caps.push(xf(cap, { x, y: y + h, z }));
        }
        add(M.plain, cat([paint(cat(stems), C(0xd8ccb0)), paint(cat(caps), C(0x9a4a2a))]), skins.mantle);
        break;
      }
      case 'mail': {
        // a skirt of mail under the faulds: rings in rows, catching the light every other one
        const R5 = layerR(0.034, 0.32);
        // (rows of rings, alternately catching the light: a finer weave would only alias)
        const g = garment({ y0: 1.0, y1: 0.6, rows: 26, seg: 110, R: R5, fold: { n: 7, amp: (t) => 0.004 * t }, tatter: 0, seed: 21,
          paint: (c) => { const r = Math.round(c.t * 26); return cmul(C(0x8a929c), (r % 2 ? 0.82 : 1.12) * (0.75 + 0.25 * (1 - c.t))); } });
        add(M.armor, g, skins.skirt);
        break;
      }
      case 'bloodgem': {
        // a garnet set where the harness straps cross, and a briar wound round the left forearm
        const p = onSurf(1.27, 0, 0.02);
        add(glowMat, paint(xf(crystal(0.03, 0.012, 6, 5), { rx: Math.PI / 2, x: p.x, y: p.y, z: p.z - 0.012 }), [1, 1, 1]), skins.torso);
        const A = armL, jx = A.s * SHOULDER_X, ey = BODY_Y.shoulder - 0.28;
        const pts = helixPts(0.062, ey - 0.02, ey - 0.2, 3.5, 60).map((q) => q.add(V(jx, 0, -0.01)));
        const thorns = [];
        for (let i = 2; i < pts.length - 2; i += 4) {
          const q = pts[i], d = V(q.x - jx, 0, q.z + 0.01).normalize();
          const c = new THREE.ConeGeometry(0.003, 0.014, 4);
          c.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(V(0, 1, 0), d.add(V(0, 0.3, 0)).normalize()));
          c.translate(q.x, q.y, q.z);
          thorns.push(c);
        }
        add(M.wood, cat([paint(tubeVar(pts, 0.004, 60, 4, true), C(0x2a1a14)), paint(cat(thorns), C(0x4a2a1e))]), A.elbow);
        break;
      }
      case 'windrunes': {
        // spiralling wind-runes stitched in light across the chest wraps
        const st = [];
        for (const s2 of [1, -1]) {
          const path = [], nrm = [];
          for (let i = 0; i <= 30; i++) {
            const t = i / 30, ang = t * TAU * 1.6, r = 0.045 * (1 - t * 0.8);
            const y = 1.3 + Math.sin(ang) * r, a = s2 * 0.45 + (Math.cos(ang) * r) / 0.2;
            path.push(onSurf(y, (a + TAU) % TAU, 0.013)); nrm.push(surfN(y, (a + TAU) % TAU));
          }
          st.push(ribbon(path, nrm, 0.004, 0.001, () => [1, 1, 1]));
        }
        add(glowMat, cat(st), skins.torso);
        break;
      }
      case 'vines': {
        const wood = [], lv = [];
        const r4 = mulberry(61);
        const vine = (pts, r) => {
          wood.push(paint(tubeVar(pts, (t) => r * (1 - t * 0.5), Math.max(10, pts.length * 2), 4, true), C(0x5a4a2a)));
          for (let i = 1; i < pts.length; i += 2) {
            const lg = leaf(0.05 + r4() * 0.03, 0.016, 0.3);
            xf(lg, { rz: r4() * TAU, rx: 0.5, ry: r4() * TAU });
            lg.translate(pts[i].x, pts[i].y, pts[i].z);
            lv.push(paint(lg, cmix(C(0x4a6a20), C(0x7a8a2a), r4())));
          }
        };
        // around the torso, from the left hip up to the right shoulder
        const tp = [];
        for (let i = 0; i <= 14; i++) { const t = i / 14; const y = 0.95 + t * 0.5; const a = (1.0 + t * 1.6 * TAU) % TAU; tp.push(onSurf(y, a, 0.012)); }
        vine(tp, 0.009);
        add(M.wood, cat(wood.splice(0)), skins.torso);
        add(M.plainDS, cat(lv.splice(0)), skins.torso);
        // around each upper arm
        for (const A of [armL, armR]) {
          const jx = A.s * SHOULDER_X, jy = BODY_Y.shoulder;
          const ap = [];
          for (let i = 0; i <= 10; i++) { const t = i / 10; const q = t * 2.4 * TAU; ap.push(V(jx + Math.sin(q) * 0.068, jy - 0.02 - t * 0.26, -0.01 + Math.cos(q) * 0.068)); }
          vine(ap, 0.007);
          add(M.wood, cat(wood.splice(0)), A.shoulder);
          add(M.plainDS, cat(lv.splice(0)), A.shoulder);
        }
        break;
      }
      default:
    }
  }

  // ---- neck, face, eyes, ears, hair, beard ----------------------------------------------------
  D.sec = 'face';
  const face = cos.face ?? {};
  const hatFace = D.hat.face;
  const kind = face.kind ?? (hatFace === 'open' ? 'open' : hatFace === 'helm' ? 'helm' : 'hood');
  const hooded = kind === 'hood';
  const bare = kind === 'open' || kind === 'helm'; // a lit, human face: real eyes, ears, brows
  const skinCol = C(face.skin ?? 0xc89880);
  const HY = BODY_Y.head;
  const atHead = (g) => { g.translate(0, HY, 0); return g; };
  const neckShade = hooded ? 0.35 : 0.65;
  add(M.skin, xf(neckGeo({ adam: face.beard == null, paint: (y) => cmul(skinCol, neckShade * (0.7 + 0.3 * sstep(0, 0.12, y))) }), { y: BODY_Y.neck - 0.04 }), (v) => (v.y > BODY_Y.neck + 0.06 ? [[head, 0.6], [neck, 0.4]] : [[neck, 1]]));
  const hairCol = face.hair ? C(face.hair.col) : face.beard ? C(face.beard.col) : null;
  if (kind !== 'mask' && hatFace !== 'mask') {
    const fo = {
      col: kind === 'void' ? C(0x0a080c) : skinCol,
      shade: kind === 'void' ? 1 : hooded ? (face.shade ?? 0.6) * 0.6 : face.shade ?? 0.9,
      desat: hooded ? 0.5 : 0.3, hood: hooded,
      detail: bare ? 1 : kind === 'void' ? 0.5 : 0.7,
      stubble: face.stubble, stubbleCol: face.beard ? cmul(C(face.beard.col), 0.7) : undefined,
      browCol: bare ? cmul(hairCol ?? C(0x3a2a22), 0.8) : null,
      age: face.age, nose: face.nose, hook: face.hook, chin: face.chin, gaunt: face.gaunt, brow: face.brow,
      lipCol: face.lips ? C(face.lips) : undefined,
    };
    add(M.skin, atHead(faceGeo(fo)), head);
    if (bare) {
      add(M.skin, atHead(mergeColored([earGeo(1, { col: cmul(skinCol, fo.shade * 0.95) }), earGeo(-1, { col: cmul(skinCol, fo.shade * 0.95) })])), head);
      const ey = eyeGeo({ iris: C(face.iris ?? 0x5a4a3a), lidCol: cmul(skinCol, fo.shade * 0.9) });
      add(M.plain, atHead(mergeColored(ey.balls)), head);
      add(M.skin, atHead(mergeColored(ey.lids)), head);
      if (hairCol) add(M.plainDS, atHead(browGeo({ col: cmul(hairCol, 0.85), stern: face.brow ?? 0 })), head);
    }
  }
  if (face.beard && hatFace === 'open') {
    const chestFront = (yh) => { const y = yh + HY; outerR(y, RR); let z = RR.zf; if ((cos.shoulders ?? []).some((q) => q.k === 'mantle' || q.k === 'fur') && y < 1.55) { mantleR(0)(y, RR); z = Math.max(z, RR.zf); } return z; };
    add(M.plainDS, atHead(beardGeo({ col: C(face.beard.col), len: face.beard.len, fork: face.beard.fork, seed: 4, front: chestFront })), (v) => (v.y < HY - 0.15 ? [[head, 0.7], [neck, 0.3]] : [[head, 1]]));
  }
  // eyes: glints of the class colour (bright pinpricks inside a hood, a faint glow in a bare face's irises)
  const eyeK = Math.min(1, (face.eyes ?? 1) * 0.55);
  const eyeMat = glowMat;
  if (bare && kind !== 'mask' && hatFace !== 'mask') {
    add(eyeMat, paint(atHead(mergeColored(eyeGeo({}).irises)), [eyeK * 0.4, eyeK * 0.4, eyeK * 0.4]), head);
  } else {
    const eyePos = D.hat.eyePos ?? [V(0.031, 0.006, 0.083), V(-0.031, 0.006, 0.083)];
    const eg = [];
    for (const p of eyePos) eg.push(sphere(0.009, 8, 6, { x: p.x, y: p.y + HY, z: p.z, sy: 0.6 }));
    add(eyeMat, paint(cat(eg), [eyeK, eyeK, eyeK]), head);
  }
  // hair: strands over a darker cap (under a hat, only the back and sides)
  if (face.hair) {
    const hc = C(face.hair.col);
    const full = !!face.hair.full;
    const hairSkin = (v) => (v.y < BODY_Y.neck + 0.02 ? [[head, 0.5], [neck, 0.5]] : [[head, 1]]);
    add(M.plainDS, atHead(hairCapGeo({ col: hc, theta: full ? 1.95 : 2.05, fringe: false })), head);
    add(M.plainDS, atHead(hairGeo({ col: hc, len: face.hair.len, back: !full, top: full, short: face.hair.short, wild: face.hair.wild, n: face.hair.n, seed: 9 })), hairSkin);
  }

  return { eyeMat, update: null };
}

function classId(D) { let h = 0; for (const ch of D.classId) h = (h * 31 + ch.charCodeAt(0)) | 0; return Math.abs(h) % 997; }
