import * as THREE from 'three';
import { G, xf, lathe, tube, deform, robe, panel, mergeRaw, chainSkin, rng, vnoise, fbm3, clamp, lerp, smooth, bump, easeOut, easeIn, easeInOut, TAU } from './core.js';
import { humanSkeleton, humanoidPose, act2 } from './humanoid.js';
import { addSkull, addBoneHand, addCrystalStaff, pauldron, hood, twoSided, HDR, GOLDTRIM } from './parts.js';
import { addFx, fxOf, fxSet, fxRot, paint, softRing, softDisc, Rope, aimChain, boneWorld, glowLevel } from './bossKit.js';

// ============================================================ Archmage Veyrin ==
// The Court Archmage, long since a lich: a towering archivist in layered violet and
// black robes worked with gold, floating on a hem that frays into ghostly wisps. A
// gilded mask hides a skull with burning eyes; skeletal hands grip a crystal staff.
// Three grimoires orbit him with their pages turning, a censer swings on a chain at
// his hip (rope-simulated), rune halos spin over his hood, two spell circles turn at
// his back and a great sigil burns on the floor beneath him, flaring with each cast.
// The Mirrored Court phase flares every circle; at the Arcane Cataclysm the mask
// splits and falls away. In death the robes empty and crumple to the floor.

const ARC = 0x9a7aff, ARC2 = 0x6ab0ff, EYE = 0xc8b0ff;
const NBOOK = 3, CEN_N = 4, CEN_L = 0.07;

function circleGeo(r, n, seed) {
  const parts = [xf(G.tor(r, 0.008, 3, 48), {}), xf(G.tor(r * 0.82, 0.005, 3, 48), {})];
  const pts = [];
  for (let k = 0; k < n; k++) { const a = (k / n) * TAU; pts.push([Math.cos(a) * r * 0.8, Math.sin(a) * r * 0.8]); }
  for (let k = 0; k < n; k++) { const a = pts[k], b = pts[(k + Math.floor(n / 2) - 1) % n]; const dx = b[0] - a[0], dy = b[1] - a[1]; const len = Math.hypot(dx, dy); parts.push(xf(G.box(len, 0.006, 0.003), { x: (a[0] + b[0]) / 2, y: (a[1] + b[1]) / 2, rz: Math.atan2(dy, dx) })); }
  for (let k = 0; k < n * 2; k++) { const a = (k / (n * 2)) * TAU + seed; parts.push(xf(G.box(0.03, 0.04, 0.003), { x: Math.cos(a) * r * 0.91, y: Math.sin(a) * r * 0.91, rz: a })); }
  return mergeRaw(parts);
}
// the floor sigil: concentric rings, a heptagram, rune ticks; RGBA for an fx mesh (XZ plane)
function sigilGeo(R) {
  const parts = [];
  const ring = (r, w, seg = 64) => { const g = new THREE.RingGeometry(r - w, r + w, seg, 1); g.rotateX(-Math.PI / 2); return g; };
  parts.push(ring(R, 0.03), ring(R * 0.93, 0.012), ring(R * 0.62, 0.02), ring(R * 0.25, 0.015));
  const n = 7, pts = [];
  for (let k = 0; k < n; k++) { const a = (k / n) * TAU; pts.push([Math.sin(a) * R * 0.9, Math.cos(a) * R * 0.9]); }
  for (let k = 0; k < n; k++) { const a = pts[k], b = pts[(k + 3) % n]; const dx = b[0] - a[0], dz = b[1] - a[1]; const len = Math.hypot(dx, dz); const g = new THREE.PlaneGeometry(len, 0.03); g.rotateX(-Math.PI / 2); g.rotateY(-Math.atan2(dz, dx)); g.translate((a[0] + b[0]) / 2, 0, (a[1] + b[1]) / 2); parts.push(g); }
  for (let k = 0; k < 28; k++) { const a = (k / 28) * TAU; const g = new THREE.PlaneGeometry(0.05, 0.12 + (k % 3) * 0.05); g.rotateX(-Math.PI / 2); g.rotateY(-a); g.translate(Math.sin(a) * R * 0.78, 0, Math.cos(a) * R * 0.78); parts.push(g); }
  const m = mergeRaw(parts);
  return paint(m, (v) => { const r = Math.hypot(v.x, v.z) / R; return [...HDR(ARC, 1.6 - r * 0.6), 0.85]; });
}

export const courtArchmage = {
  id: 'courtArchmage', height: 4.6, radius: 1.0, boss: true, flying: true, eyeColor: EYE, magicColor: ARC, defaultAttack: 'cast', attackTypes: ['cast', 'summon', 'spin', 'beam'], orbSize: 0.13, flutter: 0.035,
  build(rig) {
    rig.scale = 1.85;
    const D = humanSkeleton(rig, { thigh: 0.45, shin: 0.44, spine: 0.17, chest: 0.33, neck: 0.09, shoulderW: 0.21, upper: 0.31, fore: 0.29, jaw: [0.035, 0.035] });
    for (let i = 0; i < 3; i++) rig.bone('halo' + i, 'head', 0, 0.36 + i * 0.07, -0.02, { rate: 0.6 });
    rig.bone('circleA', 'chest', 0, 0.15, -0.35, { rate: 0.5 });
    rig.bone('circleB', 'chest', 0, 0.2, -0.45, { rate: 0.4 });
    rig.bone('maskL', 'head', 0, 0.1, 0.028);
    rig.bone('maskR', 'head', 0, 0.1, 0.028);
    rig.bone('ground', null);
    for (let i = 0; i < NBOOK; i++) rig.bone('book' + i, 'hips', 0, 0.1, 0, { rate: 0.6 });
    rig.bone('cen0', 'hips', -0.17, -0.05, 0.08);
    for (let i = 1; i < CEN_N; i++) rig.bone('cen' + i, 'cen' + (i - 1), 0, -CEN_L, 0);
    const VIOL = [0.18, 0.06, 0.3], GOLDC = [0.9, 0.75, 0.45], BLK = [0.06, 0.035, 0.09];
    const embroid = (v, base) => { const a = Math.atan2(v.x, v.z), b = Math.sin(a * 14 + v.y * 22) * Math.sin(v.y * 38); return b > 0.86 ? GOLDTRIM : base; };
    // ---- three robe layers, the hems fraying into ghost wisps
    rig.add('hips', 'cloth', robe(0.19, 0.31, D.hipH + 0.12, { seg: 26, rows: 7, folds: 9, foldAmp: 0.06, tatter: 0.18, seed: 3 }), { y: 0.04 }, { anim: (v) => clamp(-v.y / 1.0), cfn: (v) => (v.y < -(D.hipH - 0.02) ? GOLDTRIM : embroid(v, [0.5, 0.46, 0.42])) });
    const mid = new THREE.CylinderGeometry(0.21, 0.42, D.hipH + 0.12, 26, 7, true, 0.5, TAU - 1.0);
    xf(mid, { y: -(D.hipH + 0.12) / 2 });
    deform(mid, (v) => { const a = Math.atan2(v.x, v.z); const k = 1 + Math.sin(a * 9) * 0.05 * (-v.y); v.x *= k; v.z *= k; });
    rig.add('hips', 'cloth', mid, { y: 0.1 }, { anim: (v) => clamp(-v.y / 1.0) * 1.2, cfn: (v) => { const a = Math.atan2(v.x, v.z); return (Math.abs(Math.abs(a) - 0.5) < 0.05 || v.y < -(D.hipH + 0.04)) ? GOLDTRIM : embroid(v, VIOL); } });
    const outer = new THREE.CylinderGeometry(0.24, 0.6, D.hipH + 0.3, 26, 7, true, 1.4, TAU - 2.8);
    xf(outer, { y: -(D.hipH + 0.3) / 2 });
    deform(outer, (v) => { const a = Math.atan2(v.x, v.z); const t = -v.y / (D.hipH + 0.3); v.y -= Math.max(0, vnoise(a * 3, 1, 2, 5) - 0.45) * 0.25 * t * t; const k = 1 + Math.sin(a * 7 + 1) * 0.05 * t; v.x *= k; v.z *= k; });
    rig.add('chest', 'cloth', twoSided(outer), { y: -D.spine + 0.15, z: -0.03 }, { c: BLK, anim: (v) => clamp(-v.y / 1.2) * 1.5, cfn: (v) => (v.y < -(D.hipH + 0.2) ? [0.5, 0.38, 0.22] : embroid(v, BLK)), skin: chainSkin([['hips', -1.2], ['chest', -0.1]], (v) => v.y) });
    // ghostly wisps trailing below the hem
    const wisp = robe(0.31, 0.5, 0.5, { seg: 22, rows: 4, folds: 11, foldAmp: 0.25, tatter: 0.8, seed: 17 });
    rig.add('hips', 'spirit', wisp, { y: -D.hipH + 0.02 }, { cfn: (v) => { const t = clamp(-v.y / 0.5); return HDR(ARC, 0.35 * (1 - t) ** 1.5); }, anim: (v) => 0.6 + clamp(-v.y / 0.5) * 2.0 });
    rig.add('chest', 'cloth', lathe([[0.17, -0.08], [0.21, 0.14], [0.23, 0.25], [0.14, 0.33], [0.07, 0.35]], 16), { sz: 0.82 }, { c: VIOL, cfn: (v) => embroid(v, VIOL) });
    // ornate front panel with glowing sigils, a belt of chained grimoire clasps
    rig.add('chest', 'gold', panel(0.16, 0.95, { ws: 2, hs: 6, tatter: 0, seed: 1, curve: 0.02 }), { y: 0.3, z: 0.19 }, { c: GOLDC, skin: chainSkin([['hips', -0.6], ['chest', 0.0]], (v) => v.y), anim: (v) => clamp(-v.y - 0.4) * 0.6 });
    rig.add('chest', 'glow', mergeRaw([0, 1, 2, 3].map((i) => xf(G.oct(0.022), { y: 0.2 - i * 0.2, z: 0.2, sz: 0.3 }))), {}, { c: HDR(ARC, 3), skin: chainSkin([['hips', -0.6], ['chest', 0.0]], (v) => v.y) });
    rig.add('hips', 'leather', xf(G.cyl(0.215, 0.215, 0.05, 20, true), { sz: 0.85 }), { y: 0.06 }, { c: [0.25, 0.14, 0.1] });
    rig.add('hips', 'gold', mergeRaw([xf(G.box(0.07, 0.06, 0.015), { y: 0.06, z: 0.185 }), ...[0.5, 1.2, -0.5, -1.2].map((a) => xf(G.tor(0.022, 0.006, 4, 8), { x: Math.sin(a) * 0.2, y: 0.03, z: Math.cos(a) * 0.17 }))]), {}, { c: GOLDC });
    // mantle w/ spiked shoulder pieces + tall collar
    rig.add('chest', 'cloth', robe(0.13, 0.34, 0.3, { seg: 20, rows: 2, folds: 7, foldAmp: 0.08, tatter: 0.1, seed: 6 }), { y: D.chest + 0.06, sz: 0.85 }, { c: VIOL, cfn: (v) => (v.y < -0.26 ? GOLDTRIM : embroid(v, VIOL)) });
    rig.pair('chest', 'chest', 'gold', mergeRaw([pauldron(0.1, 3), xf(G.cone(0.025, 0.2, 4), { y: 0.16, rz: -0.4 }), xf(G.cone(0.02, 0.15, 4), { y: 0.12, x: 0.06, rz: -0.9 }), xf(G.cone(0.018, 0.12, 4), { y: 0.09, x: 0.1, rz: -1.3 })]), { x: 0.2, y: D.chest - 0.02, rz: 0.4 }, { c: GOLDC });
    const collar = new THREE.CylinderGeometry(0.28, 0.12, 0.46, 20, 2, true, Math.PI * 0.55, Math.PI * 0.9);
    rig.add('chest', 'cloth', twoSided(xf(collar, { y: 0.23 })), { y: D.chest + 0.03, z: -0.03 }, { c: [0.12, 0.05, 0.22] });
    rig.add('chest', 'gold', xf(new THREE.TorusGeometry(0.28, 0.012, 4, 18, Math.PI * 0.9), { rx: Math.PI / 2, rz: -Math.PI * 0.95 }), { y: D.chest + 0.49, z: -0.03 }, { c: GOLDTRIM });
    rig.add('chest', 'gold', mergeRaw([0, 1, 2, 3, 4].map((i) => xf(G.cone(0.012, 0.09, 4), { x: Math.sin(Math.PI * (0.6 + i * 0.2)) * 0.28, y: D.chest + 0.5, z: Math.cos(Math.PI * (0.6 + i * 0.2)) * 0.28 - 0.03 }))), {}, { c: GOLDTRIM });
    // ---- head: deep hood, a skull beneath a split gilded mask
    const h = hood(0.14, 0.14, { open: 0.3, peak: 0.6 });
    rig.add('head', 'cloth', h.shell, { y: 0.1, z: -0.01 }, { c: [0.1, 0.04, 0.18] });
    rig.add('head', 'cloth', twoSided(h.drape), { y: 0.06, z: -0.03 }, { c: [0.1, 0.04, 0.18], anim: (v) => clamp(-v.y * 4) * 0.5 });
    rig.add('head', 'dark', G.sph(0.11, 10, 8), { y: 0.1, z: -0.01 });
    addSkull(rig, 'head', 'jaw', { eye: EYE, eyeK: 9, s: 1.15, y: 0.1, z: 0.0, c: [0.78, 0.72, 0.6] });
    const half = (p0) => deform(new THREE.SphereGeometry(0.105, 12, 12, p0, Math.PI * 0.42, Math.PI * 0.12, Math.PI * 0.72), (v) => { if (Math.abs(v.x) < 0.02 && v.y < 0.03) v.z += 0.012; if (v.y < -0.04) v.x *= 0.85; v.x += Math.sign(v.x) * 0.002; });
    const maskC = (v) => { const n = vnoise(v.x * 60, v.y * 60, v.z * 60, 4); return n > 0.7 ? [0.6, 0.45, 0.25] : [1.2, 1.02, 0.75]; };
    rig.add('maskL', 'gold', half(Math.PI * 0.5), { y: 0, z: 0.012 }, { cfn: maskC });
    rig.add('maskR', 'gold', half(Math.PI * 0.08), { y: 0, z: 0.012 }, { cfn: maskC });
    for (const [b, sx] of [['maskL', 1], ['maskR', -1]]) {
      rig.add(b, 'dark', xf(G.box(0.045, 0.014, 0.02), { rz: sx * 0.25 }), { x: sx * 0.036, y: 0.018, z: 0.098 });
      rig.add(b, 'glow', xf(G.box(0.035, 0.007, 0.01), { rz: sx * 0.25 }), { x: sx * 0.036, y: 0.018, z: 0.104 }, { c: HDR(EYE, 7) });
      rig.add(b, 'gold', xf(G.cone(0.012, 0.07, 4), { rz: -sx * 1.1 }), { x: sx * 0.085, y: 0.06, z: 0.06 }, { c: GOLDC });
    }
    rig.add('head', 'glow', G.oct(0.016), { y: 0.17, z: 0.118 }, { c: HDR(ARC, 5) });
    rig.add('head', 'glow', xf(G.box(0.004, 0.14, 0.004), { rz: 0.1 }), { y: 0.1, z: 0.117 }, { c: HDR(ARC, 2.5) }); // the crack down the mask
    // ---- floating rune rings (crown) and the spell circles behind
    for (let i = 0; i < 3; i++) {
      const r = 0.2 - i * 0.04;
      rig.add('halo' + i, 'gold', xf(G.tor(r, 0.008, 4, 28), { rx: Math.PI / 2 }), {}, { c: GOLDTRIM });
      const gl = [];
      for (let k = 0; k < 10 - i * 2; k++) { const a = (k / (10 - i * 2)) * TAU; gl.push(xf(G.box(0.025, 0.03, 0.004), { x: Math.cos(a) * r, z: Math.sin(a) * r, ry: -a + Math.PI / 2 })); }
      rig.add('halo' + i, 'spirit', mergeRaw(gl), {}, { c: HDR(ARC, 2.5) });
    }
    rig.add('circleA', 'spirit', circleGeo(0.62, 7, 0), {}, { c: HDR(ARC, 2.2) });
    rig.add('circleB', 'spirit', circleGeo(0.36, 5, 1), {}, { c: HDR(ARC2, 2.0) });
    // ---- sleeves and skeletal hands
    for (const S of ['L', 'R']) {
      const sx = S === 'L' ? 1 : -1;
      rig.add('arm' + S, 'cloth', robe(0.065, 0.085, D.upper + 0.02, { seg: 10, rows: 2, folds: 4, tatter: 0, seed: 2 }), { y: 0.02 }, { c: VIOL });
      rig.add('fore' + S, 'cloth', twoSided(robe(0.075, 0.19, D.fore * 0.95, { seg: 14, rows: 2, folds: 6, foldAmp: 0.12, tatter: 0.3, seed: 5 + sx })), {}, { c: VIOL, anim: (v) => clamp(-v.y * 3) * 0.7, cfn: (v) => (v.y < -D.fore * 0.85 ? GOLDTRIM : VIOL) });
      rig.add('fore' + S, 'bone', G.cyl(0.014, 0.018, D.fore * 0.5, 6), { y: -D.fore * 0.78 }, { c: [0.78, 0.72, 0.6] });
      addBoneHand(rig, 'hand' + S, sx, { c: [0.78, 0.72, 0.6], s: 1.3, grip: S === 'R', fingerLen: 1.25 });
      rig.add('hand' + S, 'gold', mergeRaw([xf(G.tor(0.011, 0.004, 3, 6), { x: 0.0, y: -0.075, z: 0.01, rx: Math.PI / 2 })]), {}, { c: GOLDTRIM });
    }
    const st = addCrystalStaff(rig, 'handR', { len: 2.5, color: ARC, k: 4, crystalR: 0.09 });
    rig.add('handR', 'glow', mergeRaw([0, 1, 2].map((i) => { const a = i * 2.1; return xf(G.oct(0.025), { x: Math.cos(a) * 0.15, y: Math.sin(a) * 0.15, z: st.tip, sz: 2 }); })), { y: -0.07 }, { c: HDR(ARC2, 3) });
    rig.add('handR', 'gold', xf(G.tor(0.15, 0.006, 3, 24), {}), { y: -0.07, z: st.tip }, { c: GOLDTRIM });
    rig.socket('muzzle', 'handR', 0, -0.07, st.tip);
    // ---- orbiting grimoires: open covers, pages, glowing script
    for (let i = 0; i < NBOOK; i++) {
      const w = 0.16, d = 0.21;
      const cov = mergeRaw([xf(G.box(w, 0.012, d), { x: w / 2, rz: 0.32 }), xf(G.box(w, 0.012, d), { x: -w / 2, rz: -0.32 }), xf(G.cyl(0.012, 0.012, d, 6), { rx: Math.PI / 2 })]);
      rig.add('book' + i, 'leather', cov, {}, { c: [[0.35, 0.08, 0.1], [0.12, 0.15, 0.3], [0.2, 0.25, 0.12]][i] });
      rig.add('book' + i, 'gold', mergeRaw([xf(G.box(0.02, 0.014, 0.02), { x: w - 0.01, y: 0.05, z: d / 2 - 0.01, rz: 0.32 }), xf(G.box(0.02, 0.014, 0.02), { x: -w + 0.01, y: 0.05, z: d / 2 - 0.01, rz: -0.32 })]), {}, { c: GOLDC });
      const pages = mergeRaw([xf(G.box(w * 0.94, 0.03, d * 0.92), { x: w * 0.47, y: 0.02, rz: 0.3 }), xf(G.box(w * 0.94, 0.03, d * 0.92), { x: -w * 0.47, y: 0.02, rz: -0.3 })]);
      rig.add('book' + i, 'bone', pages, {}, { c: [1.15, 1.05, 0.82], anim: 0.4 });
      const R = rng(9 + i), lines = [];
      for (let k = 0; k < 7; k++) for (const sd of [-1, 1]) lines.push(xf(G.box(0.05 + R() * 0.05, 0.002, 0.006), { x: sd * (0.05 + R() * 0.03), y: 0.04 + Math.abs(sd * (0.05)) * 0.3, z: -0.07 + k * 0.022, rz: sd * 0.3 }));
      rig.add('book' + i, 'glow', mergeRaw(lines), {}, { c: HDR(ARC, 2.2) });
    }
    // ---- a censer on a chain at the hip, violet fire inside
    for (let i = 0; i < CEN_N; i++) rig.add('cen' + i, 'gold', mergeRaw([xf(G.tor(0.012, 0.003, 3, 6), { y: -0.02, sy: 1.5 }), xf(G.tor(0.012, 0.003, 3, 6), { y: -0.05, sy: 1.5, ry: Math.PI / 2 })]), {}, { c: [0.6, 0.5, 0.35] });
    const cg = mergeRaw([lathe([[0.001, -0.06], [0.03, -0.058], [0.045, -0.04], [0.05, -0.01], [0.048, 0.0]], 10), lathe([[0.046, 0.005], [0.04, 0.03], [0.02, 0.048], [0.001, 0.055]], 10), xf(G.tor(0.05, 0.006, 3, 12), { rx: Math.PI / 2 })]);
    rig.add('cen' + (CEN_N - 1), 'gold', cg, { y: -0.13 }, { c: GOLDC });
    rig.add('cen' + (CEN_N - 1), 'glow', mergeRaw([0, 1, 2, 3, 4, 5].map((k) => xf(G.box(0.01, 0.014, 0.004), { x: Math.sin(k) * 0.044, z: Math.cos(k) * 0.044, y: -0.11, ry: k }))), {}, { c: HDR(ARC, 4) });
    rig.add('cen' + (CEN_N - 1), 'spirit', xf(G.sph(0.08, 8, 6), { sy: 1.4 }), { y: -0.08 }, { c: HDR(ARC, 0.5) });
    // ---- fx: floor sigil, staff-tip flare, a shock ring for the big moments, falling mask glints
    addFx(rig, 'ground', 'sigil', sigilGeo(1.0), { y: 0.03 });
    addFx(rig, 'handR', 'flare', paint(G.sph(0.14, 12, 8), () => [...HDR(ARC, 1.0), 0.3]), { y: -0.07, z: st.tip });
    addFx(rig, 'ground', 'shock', softRing(0.85, 1.0, 48, HDR(ARC, 1.4), 0.6), { y: 2.0 });
    return D;
  },
  pose(m, s, P, dt) {
    const st = m.state;
    if (st.born === undefined) st.born = m.time;
    // the game drives his blink as a short 'cast'; everything else is in anim.actions / extra
    const r = humanoidPose(m, s, P, dt);
    archSecondary(m, s, dt);
    return r;
  },
  onFx(m, kind, extra) {
    const st = m.state;
    if (kind === 'phase') { st.phaseT = m.time; st.phaseN = extra.n ?? 1; if (st.phaseN >= 2) st.maskT = m.time; }
    if (kind === 'enrage' && st.maskT === undefined) st.maskT = m.time;
  },
  anim: {
    gait: 'float', hover: 0.3, spawn: 'materialize', caster: true, idleOrb: 0.25, look: 0.5, breath: 1.0,
    rest: { armR: [-0.3, 0, -0.08], foreR: [-1.2, 0, 0], handR: [0.0, 0, 0], armL: [-0.5, 0, 0.25], foreL: [-1.0, 0.6, 0], handL: [-0.5, 0, 0.3] },
    stance: (P) => P.apply({ spine: [-0.03, 0, 0], head: [0.03, 0, 0] }),
    actions: {
      cast: act2(
        { armR: [-0.5, 0, -0.3], foreR: [-1.5, 0, 0], handR: [0.3, 0, 0], armL: [-1.6, 0, 0.6], foreL: [-0.5, 0, 0], handL: [-0.8, 0, 0], chest: [-0.2, -0.25, 0], head: [-0.1, 0.2, 0], spine: [-0.08, -0.1, 0] },
        { armR: [-1.45, 0, 0.15], foreR: [-0.3, 0, 0], handR: [-0.8, 0, 0], armL: [-0.5, 0, 0.5], foreL: [-0.8, 0, 0], chest: [0.18, 0.22, 0], spine: [0.1, 0.05, 0], head: [0, -0.15, 0], hips: [0, 0, 0, 0, 0, 0.12] },
        { hit: 0.3, recover: 0.85, recoverAmt: 0.3 },
      ),
      beam: act2(
        { armR: [-0.9, 0, -0.2], foreR: [-1.2, 0, 0], handR: [-0.3, 0, 0], armL: [-0.9, 0, 0.2], foreL: [-1.2, 0, 0], chest: [-0.25, 0, 0], head: [0.1, 0, 0], hips: [0, 0, 0, 0, 0.15, -0.1] },
        { armR: [-1.5, 0, 0.15], foreR: [-0.15, 0, 0], handR: [-1.2, 0, 0], armL: [-1.5, 0, -0.25], foreL: [-0.1, 0, 0], chest: [0.12, 0, 0], spine: [0.06, 0, 0], jaw: [0.4, 0, 0] },
        { hit: 0.2, recover: 0.92, recoverAmt: 0.2, tremble: 0.03, strikeExtra: (P, p, m) => { P.r('armR', Math.sin(m.time * 41) * 0.015); P.r('armL', Math.sin(m.time * 37) * 0.015); P.r('chest', Math.sin(m.time * 29) * 0.01); } },
      ),
      // both arms raised: the court answers
      summon: act2(
        { armR: [-0.4, 0, -0.5], armL: [-0.4, 0, 0.5], foreR: [-1.4, 0, 0], foreL: [-1.4, 0, 0], chest: [0.25, 0, 0], head: [0.3, 0, 0], hips: [0, 0, 0, 0, -0.08, 0] },
        { armR: [-2.7, 0, -0.45], armL: [-2.8, 0, 0.55], foreR: [-0.3, 0, 0], foreL: [-0.2, 0, 0], handL: [-0.4, 0, 0], chest: [-0.32, 0, 0], spine: [-0.1, 0, 0], head: [-0.45, 0, 0], jaw: [0.5, 0, 0], hips: [0, 0, 0, 0, 0.2, 0] },
        { hit: 0.4, recover: 0.82 },
      ),
      // arms flung wide, a slow turn that whips round on the release
      spin: (P, ph, p, m) => {
        if (ph === 'windup') {
          const k = smooth(0, 1, p);
          P.apply({ chest: [0.1, -0.9, 0], spine: [0.1, -0.35, 0], armR: [-1.3, 0, -0.9], armL: [-1.3, 0, 0.9], foreR: [-0.3, 0, 0], foreL: [-0.3, 0, 0], head: [0.2, 0.5, 0], hips: [0, -0.3, 0, 0, 0.15, 0] }, k);
          return 8;
        }
        const k = smooth(0, 0.15, p) * (1 - smooth(0.85, 1, p));
        P.r('base', 0, easeInOut(p) * TAU * 1.5, 0);
        P.apply({ armR: [-1.5, 0, -1.25], armL: [-1.5, 0, 1.25], foreR: [-0.1, 0, 0], foreL: [-0.1, 0, 0], chest: [-0.15, 0.25, 0], head: [-0.3, 0, 0], jaw: [0.4, 0, 0], hips: [0, 0, 0, 0, 0.22, 0] }, k);
        return 22;
      },
    },
    death: (P, p, m, s) => archDeath(P, p, m, s),
    extra: (P, m, s, dt, k) => archExtra(P, m, s, dt, k),
  },
};

function archExtra(P, m, s, dt, k) {
  const T = m.time, st = m.state, act = k.action, an = s.anim, at = s.attackType, p = s.progress, D = m.spec.dims;
  const dead = an === 'death';
  const casting = act ? 1 : 0;
  const spinning = at === 'spin' && an === 'cast';
  const fast = act ? (spinning ? 5 + 6 * bump(0, 1, p) : at === 'beam' ? 3.5 : 2.2) : 1;
  st.rot = (st.rot ?? 0) + dt * fast;
  const r = st.rot;
  // phase moments
  const pt = st.phaseT !== undefined ? T - st.phaseT : 9;
  const mirror = st.phaseN === 1 && pt < 2.5 ? bump(0, 2.5, pt) : 0;
  const maskT = st.maskT !== undefined ? T - st.maskT : -1;
  const cat = maskT >= 0 ? 1 : 0;
  // halos: chaotic once reality unravels
  const chaos = cat * (0.5 + 0.5 * Math.sin(T * 1.7));
  P.r('halo0', 0.2 + Math.sin(T * 0.7) * 0.1 + chaos * Math.sin(T * 2.3) * 0.6, r * 0.9, 0.1 + chaos * 0.4);
  P.r('halo1', -0.25 + chaos * Math.sin(T * 1.9) * 0.7, -r * 1.3, Math.sin(T * 0.5) * 0.2);
  P.r('halo2', 0.1 + chaos * 0.5, r * 1.8, -0.2 + chaos * Math.sin(T * 2.9) * 0.6);
  P.p('halo0', 0, Math.sin(T * 1.3) * 0.015 + cat * 0.04, 0); P.p('halo1', 0, Math.sin(T * 1.1 + 1) * 0.015 + cat * 0.08, 0); P.p('halo2', 0, cat * 0.12, 0);
  P.r('circleA', chaos * Math.sin(T * 0.9) * 0.4, chaos * Math.sin(T * 1.3) * 0.3, r * 0.5); P.r('circleB', 0, 0, -r * 0.8);
  const big = (act ? 1.25 : 1) + mirror * 0.8 + (spinning ? 0.4 * bump(0, 1, p) : 0) + cat * 0.15;
  P.s('circleA', big); P.s('circleB', big * (1 + mirror * 0.3));
  // the mask splits and falls away at the Cataclysm
  if (cat) {
    const u = clamp(maskT / 1.4);
    const f = easeIn(u);
    P.p('maskL', 0.06 * u + 0.02, -0.25 * f, 0.08 * u); P.r('maskL', 0.8 * f, 0.6 * u, -1.2 * f);
    P.p('maskR', -0.06 * u - 0.02, -0.3 * f, 0.06 * u); P.r('maskR', 1.1 * f, -0.5 * u, 1.4 * f);
    P.s('maskL', Math.max(0.01, 1 - smooth(0.7, 1, u))); P.s('maskR', Math.max(0.01, 1 - smooth(0.75, 1, u)));
    if (maskT < 2.4) { const q = bump(0, 2.4, maskT); P.r('head', -0.5 * q, Math.sin(T * 40) * 0.05 * q); P.r('jaw', 0.8 * q); P.apply({ armR: [-1.0, 0, -0.9], armL: [-1.2, 0, 0.9], chest: [-0.3, 0, 0] }, q); }
  }
  if (mirror) P.apply({ armR: [-1.4, 0, -1.0], armL: [-1.4, 0, 1.0], chest: [-0.2, 0, 0], head: [-0.2, 0, 0] }, mirror);
  // grimoires orbit the waist, faster in a cast; rise for a summoning; fall in death
  const sumK = at === 'summon' && act ? smooth(0, 0.4, p) * (1 - smooth(0.85, 1, p)) : 0;
  st.bookRot = (st.bookRot ?? 0) + dt * (0.6 + casting * 1.4 + (spinning ? 3 : 0) + cat * 0.4);
  for (let i = 0; i < NBOOK; i++) {
    const a = st.bookRot + i * (TAU / NBOOK), R = 0.48 + sumK * 0.15 + mirror * 0.2;
    const y = 0.12 + Math.sin(T * 1.3 + i * 2) * 0.05 + sumK * (0.75 + i * 0.08);
    if (dead) {
      const dt2 = Math.max(s.t, s.progress * 1.1), f = easeIn(smooth(0.6 + i * 0.12, 1.3 + i * 0.12, dt2));
      P.p('book' + i, Math.sin(a) * R * (1 + f * 0.4), lerp(y, -D.hipH * 0.96, f), Math.cos(a) * R * (1 + f * 0.4));
      P.r('book' + i, lerp(0.35, 0, f), a + Math.PI / 2, lerp(0.15, 3.1 * (i % 2), f));
    } else {
      P.p('book' + i, Math.sin(a) * R, y, Math.cos(a) * R);
      P.r('book' + i, 0.35 + Math.sin(T * 2 + i) * 0.1 - sumK * 0.3, a + Math.PI / 2, 0.15 + Math.sin(T * 1.6 + i) * 0.12);
    }
  }
  if (s.anim === 'death') { const d = Math.max(s.t, s.progress * 1.1); const sc = Math.max(0.01, 1 - smooth(0.6, 1.4, d)); P.s('circleA', sc); P.s('circleB', sc); for (let i = 0; i < 3; i++) P.s('halo' + i, Math.max(0.01, 1 - smooth(0.4 + i * 0.1, 1.2, d))); }
  // fx levels for archSecondary
  st.fxSigil = 0.14 + casting * 0.5 + mirror * 0.6 + cat * 0.15 + (spinning ? 0.3 : 0);
  st.fxFlare = act ? (an === 'cast' ? smooth(0, 0.3, p) * (1 - smooth(0.8, 1, p)) : 0.4) : 0.1;
  st.fxShock = Math.max(mirror > 0 ? 1 - clamp(pt / 0.9) : 0, cat && maskT < 0.9 ? 1 - maskT / 0.9 : 0);
  st.fxShockR = mirror > 0 ? 1 + clamp(pt / 0.9) * 8 : 1 + clamp(maskT / 0.9) * 8;
  st.eyeK = (1 + cat * 0.8 + mirror) * (dead ? 1 - smooth(0.5, 1.6, Math.max(s.t, s.progress * 1.1)) * 0.9 : 1);
}

// death: arms flung out in a last convulsion, a burst of light, then the robes empty and
// crumple to the floor with the mask and the grimoires
const AD_THROE = { armL: [-2.2, 0, 0.7], armR: [-2.2, 0, -0.7], head: [-0.6, 0, 0], chest: [-0.4, 0, 0], jaw: [0.9, 0, 0], foreL: [-0.2, 0, 0], foreR: [-0.2, 0, 0] };
const AD_HEAP = { spine: [0.9, 0, 0.1], chest: [0.6, 0.2, 0], neck: [0.5, 0, 0], head: [0.8, 0.4, 0.5], armL: [0.4, 0, 0.5], armR: [0.6, 0, -0.6], foreL: [-0.6, 0, 0], foreR: [-0.3, 0, 0], thighL: [-1.2, 0, 0.3], thighR: [-1.1, 0, -0.3], shinL: [1.8, 0, 0], shinR: [1.9, 0, 0], jaw: [0.6, 0, 0] };
function archDeath(P, p, m, s) {
  const t = Math.max(s.t, p * 1.1), D = m.spec.dims, sc = D.hipH / 0.97;
  const throe = bump(0, 0.9, t), fall = easeIn(smooth(0.7, 1.5, t)), settle = bump(1.5, 1.8, t);
  P.apply(AD_THROE, throe);
  P.r('base', 0, Math.sin(t * 9) * 0.1 * throe, 0);
  P.p('base', 0, 0.35 * throe * sc, 0);
  P.apply(AD_HEAP, fall);
  P.p('hips', 0, -D.hipH * 0.9 * fall + 0.04 * settle, -0.05 * fall);
  m.setOpacity(1 - 0.35 * smooth(1.2, 3.5, t));
  return 10;
}

const DOWN = new THREE.Vector3(0, -1, 0), AX_CEN = Array.from({ length: CEN_N - 1 }, () => DOWN);
const N_CEN = Array.from({ length: CEN_N - 1 }, (_, i) => 'cen' + (i + 1));
const _a = new THREE.Vector3(), _M = new THREE.Matrix4();
function archSecondary(m, s, dt) {
  const st = m.state;
  if (!st.rope) st.rope = new Rope(CEN_N - 1, CEN_L * 1.85);
  m.root.updateMatrix();
  // the censer chain hangs from the belt; pose writes the bones after damping in update(), so
  // aim from last frame's transforms (one frame of lag is invisible on a dangling chain)
  boneWorld(m, m.bones.cen0, _M);
  _a.set(0, 0, 0).applyMatrix4(_M);
  st.rope.seg.fill(CEN_L * 1.85 * m.root.scale.x);
  st.rope.step(_a, dt, { damp: 1.6, iters: 2, floor: m.root.position.y + 0.05 });
  aimChain(m, N_CEN, st.rope, AX_CEN);
  // fx
  const F = fxOf(m), T = m.time;
  st.sigRot = (st.sigRot ?? 0) + dt * (0.25 + (st.fxSigil ?? 0) * 0.6);
  fxRot(F, 'sigil', 0, st.sigRot, 0);
  const dead = s.anim === 'death', dt2 = Math.max(s.t, s.progress * 1.1);
  const age = T - (st.born ?? T);
  let sig = (st.fxSigil ?? 0.2) * (0.85 + 0.15 * Math.sin(T * 3.1));
  if (s.anim === 'idle' && age < 2.6) sig = Math.max(sig, bump(0, 2.6, age) * 1.2);
  if (dead) sig = 0.9 * bump(0.5, 2.5, dt2);
  fxSet(F, 'sigil', sig * 0.5, 1.35 + (dead ? smooth(0.5, 2.5, dt2) * 0.8 : 0));
  fxSet(F, 'flare', (st.fxFlare ?? 0) * (0.7 + 0.3 * Math.sin(T * 23)), 1 + (st.fxFlare ?? 0) * 0.6);
  const sh = dead ? (dt2 > 0.75 && dt2 < 1.5 ? 1 - (dt2 - 0.75) / 0.75 : 0) : st.fxShock ?? 0;
  const shR = dead ? 1 + clamp((dt2 - 0.75) / 0.75) * 9 : st.fxShockR ?? 1;
  fxSet(F, 'shock', sh, shR, 1, shR);
  glowLevel(m, st.eyeK ?? 1);
  // intro: he materialises out of the sigil
  if (s.anim === 'idle' && age < 2.6) m.setOpacity(smooth(0.2, 1.4, age));
}
