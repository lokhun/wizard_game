import * as THREE from 'three';
import {
  V, cyl, sphere, torus, lathe, tubeVar, crystal, mergeGeos, xf, noisify, mulberry, helixPts, roundedBox,
  flat, uvs, leaf, feather, jitter, branches,
} from './shapes.js';
import { add, obj, grp, shaftGeo, gripWrapGeo, wrapGeo, gem, crystalAt, headGroup } from './common.js';
import { Bolt, FlameCluster, Pendulum, haloSprite, wob, flick, hangFrom } from './fx.js';
import { runeRingTexture, sigilTexture, streakTexture } from './surfaces.js';

// Class foci, part 2 (see focusA.js for the returned shape).

const C = (c) => new THREE.Color(c);

// ---------------------------------------------------------------------------
export function warlock(kit, meta, o) {
  const { glows, detail } = o;
  // --- the whispering tome (held on the left palm, in hand space) ---------
  const L = new THREE.Group();
  const book = grp(L, { x: 0.004, y: -0.036, z: -0.06 });
  const cover = kit.leather(0x2a1e2c);
  const BW = 0.095, BL = 0.13, BT = 0.038;
  // two boards + spine (cover faces -Y, the side away from the palm)
  add(book, roundedBox(BW, 0.006, BL, 0.0025, 1), cover, { y: -BT / 2 + 0.003 });
  add(book, roundedBox(BW, 0.006, BL, 0.0025, 1), cover, { y: BT / 2 - 0.003 });
  add(book, xf(new THREE.CylinderGeometry(BT / 2, BT / 2, BL, 12, 1, false, Math.PI, Math.PI), { rz: Math.PI / 2, ry: Math.PI / 2, x: -BW / 2 + 0.002, sx: 1 }), cover);
  const pages = new THREE.BoxGeometry(BW - 0.01, BT - 0.012, BL - 0.01, 1, 4, 1);
  add(book, pages, kit.plain(0x8a7a5a, 0.95), { x: 0.003 });
  // dark iron corners, spine bands and a clasp
  const iron = kit.darkIron();
  const corners = [];
  for (const sx of [1]) for (const sz of [-1, 1]) for (const sy of [-1, 1]) {
    corners.push(xf(new THREE.BoxGeometry(0.022, 0.008, 0.022), { x: sx * (BW / 2 - 0.008), y: sy * (BT / 2 - 0.002), z: sz * (BL / 2 - 0.008) }));
    corners.push(xf(new THREE.ConeGeometry(0.004, 0.01, 4), { x: sx * (BW / 2 - 0.006), y: sy * (BT / 2 + 0.004), z: sz * (BL / 2 - 0.006), rx: sy < 0 ? Math.PI : 0 }));
  }
  for (const z of [-0.045, 0.045]) corners.push(xf(torus(BT / 2 + 0.001, 0.0025, 4, 14, Math.PI, { ry: Math.PI / 2 }), { x: -BW / 2 + 0.002, z, rz: Math.PI / 2 }));
  corners.push(xf(new THREE.BoxGeometry(0.02, BT + 0.006, 0.026), { x: BW / 2 + 0.002 }));
  add(book, mergeGeos(corners), iron);
  // the eye on the cover (cover = -Y face)
  const eyeG = grp(book, { y: -BT / 2 - 0.001 });
  const lidMat = kit.skin(0x6a5060);
  const lid = torus(0.017, 0.0055, 8, 24);
  lid.scale(1.45, 0.75, 1);
  add(eyeG, xf(lid, { rx: Math.PI / 2 }), lidMat);
  const eyeball = grp(eyeG, { y: 0.004 });
  add(eyeball, sphere(0.0145, 16, 12), kit.plain(0xd8c8a8, 0.3));
  const irisMat = glows.add(kit.glow(meta.color2, 3.2), 1);
  add(eyeball, xf(new THREE.CircleGeometry(0.0075, 20), { rx: Math.PI / 2, y: -0.0143 }), irisMat);
  add(eyeball, xf(new THREE.PlaneGeometry(0.0022, 0.011), { rx: Math.PI / 2, y: -0.0146 }), kit.void());
  // sigil ring around the eye
  const rm = glows.add(kit.glow(meta.color, 1.4, { additive: true, map: runeRingTexture(11), side: THREE.DoubleSide }), 1);
  add(book, new THREE.PlaneGeometry(0.1, 0.1), rm, { y: -BT / 2 - 0.0035, rx: Math.PI / 2, ro: 4 });
  // whispering wisps: faint violet flames licking up from the page edges
  const wisp = new FlameCluster(kit, meta.color, meta.color2, { count: 5, size: 0.03, spread: 0.05, seed: 13, intensity: 0.7 });
  wisp.group.rotation.x = Math.PI; wisp.group.position.y = -BT / 2;
  book.add(wisp.group); wisp.materials.forEach((m) => glows.add(m, 1));
  const bh = haloSprite(kit, meta.color, 0.18, 0.25);
  bh.position.y = -0.04; book.add(bh); glows.add(bh.material, 1);

  const sig = sigilTexture(3);
  const skinR = kit.skin(0x9a8a98, sig, meta.color, 2.4);
  let fxR = null;
  const lookT = V(), lookC = V();
  let nextLook = 0, blinkT = -1;

  return {
    right: null, rightGrip: { kind: 'claw' }, hold: 'claw',
    light: { color: meta.color },
    left: L, leftGrip: { kind: 'cradle' }, leftHold: 'book',
    hands: {
      R: { style: 'bare', skin: skinR, nail: kit.plain(0x150a18, 0.25), claws: true },
      L: { style: 'bare', skin: kit.skin(0x9a8a98), nail: kit.plain(0x150a18, 0.25), claws: true },
    },
    handTip(hand) { const t = new THREE.Object3D(); t.position.set(0, -0.04, -0.13); hand.group.add(t); return t; },
    rightFx(hand) {
      // sigil skin pulses: give this hand its own clone
      const base = hand.meshes[0].material;
      const m = base.clone(); m.userData = { glowStd: { base: 2.4 } };
      hand.meshes.forEach((me) => { if (me.material === base) me.material = m; });
      glows.add(m, 1);
      const fl = [];
      hand.tips.forEach((tp, i) => {
        if (i === 4) return;
        const f = new FlameCluster(kit, meta.color, meta.color2, { count: 1, size: 0.012, spread: 0, seed: 40 + i, intensity: 1.4 });
        f.group.rotation.x = Math.PI / 2;
        tp.add(f.group); f.materials.forEach((mm) => glows.add(mm, 1));
        fl.push(f);
      });
      const h = haloSprite(kit, meta.color, 0.1, 0.3);
      h.position.set(0, -0.04, -0.1); hand.group.add(h); glows.add(h.material, 1);
      fxR = { update(t, k) { fl.forEach((f, i) => f.update(t + i * 2, k)); } };
      return fxR;
    },
    update(t, dt, st) {
      // eye glances around, blinks now and then
      if (t > nextLook || t < nextLook - 5) {
        nextLook = t + 0.6 + Math.random() * 1.6;
        lookT.set((Math.random() - 0.5) * 1.1, 0, (Math.random() - 0.5) * 0.8);
        if (Math.random() < 0.3) blinkT = t;
      }
      lookC.lerp(lookT, 1 - Math.exp(-dt * 18));
      eyeball.rotation.set(lookC.z, 0, lookC.x);
      const b = blinkT >= 0 ? Math.max(0, 1 - Math.abs(t - blinkT - 0.08) / 0.08) : 0;
      eyeball.scale.set(1, 1, 1 - b * 0.9);
      irisMat.color.set(meta.color2).multiplyScalar(3.2 * st.glow * (0.85 + 0.15 * Math.sin(t * 3)));
      wisp.update(t, 1 + st.charge);
      book.rotation.z = Math.sin(t * 0.9) * 0.02;
    },
  };
}

// ---------------------------------------------------------------------------
export function lightbinder(kit, meta, o) {
  const { glows, detail } = o;
  const R = new THREE.Group();
  const brass = kit.brass();
  const gold = kit.gold();
  add(R, cyl(0.0135, 0.015, 1.5, 12), brass).position.y = -1.0;
  add(R, gripWrapGeo(0.0145, -0.075, 0.075, 8, 0.0034), kit.cloth(0xe8e0d0));
  const deco = [
    lathe([[0.0145, 0.075], [0.02, 0.082], [0.02, 0.092], [0.0145, 0.1]], 12),
    lathe([[0.0145, -0.1], [0.02, -0.092], [0.02, -0.082], [0.0145, -0.075]], 12),
    xf(new THREE.ConeGeometry(0.017, 0.05, 8), { y: -1.025, rx: Math.PI }),
  ];
  for (let i = 0; i < 4; i++) deco.push(torus(0.0145, 0.002, 4, 12, Math.PI * 2, { y: -0.25 + i * 0.15, rx: Math.PI / 2 }));
  add(R, mergeGeos(deco), brass);
  add(R, mergeGeos([wrapGeo(0.0138, 0.2, 0.3, 3, 0.003, 4), wrapGeo(0.0138, -0.35, -0.25, 3, 0.003, 4)]), kit.cloth(0xe8e0d0));
  const H = headGroup(R, 0.4, o.hs ?? 1);
  // sun-disc collar + crook
  add(H, mergeGeos([
    lathe([[0.0135, 0.4], [0.022, 0.41], [0.026, 0.425], [0.018, 0.44], [0.013, 0.45]], 14),
    tubeVar([V(0, 0.44, 0), V(0, 0.52, 0), V(0, 0.6, -0.01), V(0, 0.64, -0.05), V(0, 0.625, -0.095), V(0, 0.59, -0.105)], (t) => 0.011 - t * 0.004, 30, 10, true),
  ]), brass);
  add(H, mergeGeos([torus(0.03, 0.003, 6, 28, Math.PI * 2, { y: 0.53, ry: Math.PI / 2 }), torus(0.022, 0.0018, 4, 24, Math.PI * 2, { y: 0.53, ry: Math.PI / 2 })]), gold);
  const sunMat = glows.add(kit.glow(meta.color, 2.4), 1);
  add(H, sphere(0.008, 10, 8), sunMat, { y: 0.53 });
  // hanging lantern
  const pivot = grp(H, { y: 0.59, z: -0.105 });
  const chain = [];
  for (let i = 0; i < 3; i++) chain.push(torus(0.006, 0.0015, 4, 10, Math.PI * 2, { y: -0.006 - i * 0.01, ry: i % 2 ? Math.PI / 2 : 0, sx: 0.8, sy: 1.3, sz: 1 }));
  add(pivot, mergeGeos(chain), brass);
  const lan = grp(pivot, { y: -0.035 });
  const frame = [
    lathe([[0, 0.03], [0.004, 0.03], [0.008, 0.024], [0.032, 0.006], [0.034, 0.0], [0.0, -0.002]], 12),
    torus(0.007, 0.002, 4, 10, Math.PI * 2, { y: 0.034 }),
    lathe([[0, -0.085], [0.03, -0.085], [0.033, -0.08], [0.03, -0.075], [0, -0.074]], 12),
    lathe([[0, -0.11], [0.003, -0.108], [0.012, -0.092], [0.016, -0.086], [0, -0.086]], 10),
  ];
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    frame.push(tubeVar([V(Math.cos(a) * 0.031, 0.0, Math.sin(a) * 0.031), V(Math.cos(a) * 0.034, -0.04, Math.sin(a) * 0.034), V(Math.cos(a) * 0.031, -0.077, Math.sin(a) * 0.031)], 0.0018, 6, 4, true));
  }
  frame.push(torus(0.033, 0.002, 4, 18, Math.PI * 2, { y: -0.04, rx: Math.PI / 2 }));
  add(lan, mergeGeos(frame), gold);
  const glass = glows.add(kit.shell(0xfff0c0, 0.28, 0.6), 0.6);
  add(lan, new THREE.CylinderGeometry(0.031, 0.031, 0.075, 6, 1, true), glass, { y: -0.038, ro: 3 });
  const core = glows.add(kit.glow(meta.color2, 4.5), 1);
  add(lan, sphere(0.011, 12, 8), core, { y: -0.045 });
  const lf = new FlameCluster(kit, meta.color, meta.color2, { count: 3, size: 0.022, spread: 0.004, seed: 17, intensity: 2 });
  lf.group.position.y = -0.055; lan.add(lf.group); lf.materials.forEach((m) => glows.add(m, 1));
  const lh = haloSprite(kit, meta.color, 0.2, 0.5);
  lh.position.y = -0.04; lan.add(lh); glows.add(lh.material, 1);
  const tip = obj(lan, 0, -0.045, 0);
  const pend = new Pendulum(18, 2.0);

  return {
    right: R, rightGrip: { kind: 'pole', r: 0.0145 }, hold: 'staff', tip,
    light: { color: meta.color },
    hands: {
      R: { style: 'wrapped', glove: kit.cloth(0xe8e0d0), skin: kit.skin(0xe8c4a8), nail: kit.plain(0xe0b8a8, 0.4), rings: [{ finger: 2, seg: 0, mat: gold }] },
      L: { style: 'wrapped', glove: kit.cloth(0xe8e0d0), skin: kit.skin(0xe8c4a8), nail: kit.plain(0xe0b8a8, 0.4), rings: [{ finger: 2, seg: 0, mat: gold }] },
    },
    leftGrip: { kind: 'open' },
    leftFx(hand) {
      const g = new THREE.Group();
      g.position.set(0, -0.06, -0.06);
      g.rotation.x = Math.PI;
      const rm = glows.add(kit.glow(meta.color, 0.55, { additive: true, map: runeRingTexture(21), side: THREE.DoubleSide }), 1);
      const ring = add(g, new THREE.PlaneGeometry(0.1, 0.1), rm, { rx: -Math.PI / 2, ro: 4, y: 0.02 });
      const ring2 = add(g, new THREE.PlaneGeometry(0.055, 0.055), rm, { rx: -Math.PI / 2, ro: 4, y: 0.045 });
      const hm = glows.add(kit.glow(meta.color2, 1.4, { additive: true }), 1);
      const halo = add(g, torus(0.058, 0.0014, 4, 48), hm, { rx: Math.PI / 2, y: 0.03, ro: 5 });
      const h = haloSprite(kit, meta.color, 0.08, 0.18);
      h.position.y = 0.03; g.add(h); glows.add(h.material, 1);
      hand.group.add(g);
      return { update(t) { ring.rotation.z = t * 0.3; ring2.rotation.z = -t * 0.6; halo.position.y = 0.03 + Math.sin(t * 2) * 0.004; } };
    },
    update(t, dt, st) {
      pend.step(dt, st.accelR ?? V(), 1.0);
      hangFrom(pivot, st.up, pend.ax + Math.sin(t * 1.1) * 0.05, pend.az + Math.sin(t * 0.8) * 0.04);
      lan.rotation.y = Math.sin(t * 0.5) * 0.4;
      lf.update(t, 1 + st.charge);
      core.color.set(meta.color2).multiplyScalar(4.5 * st.glow * (0.9 + 0.1 * flick(t, 6)));
    },
  };
}

// ---------------------------------------------------------------------------
export function geomancer(kit, meta, o) {
  const { glows, detail } = o;
  const rock = kit.rock(0x9a9088);
  const rock2 = kit.rock(0x7a7068);
  const runeMat = glows.add(kit.glow(meta.color, 2.6), 1);
  const rr = mulberry(55);
  // ---- stone gauntlet, in hand space (fist: fingers -Z, back +Y) ---------
  const G = new THREE.Group();
  const chunk = (w, h, d, seed, amp = 0.003) => {
    const g = roundedBox(w, h, d, Math.min(w, h, d) * 0.25, 2);
    return noisify(g, amp, 60, seed, 2);
  };
  const stones = [
    xf(chunk(0.1, 0.034, 0.088, 1, 0.004), { y: 0.024, z: -0.052, rx: 0.06 }),
    xf(chunk(0.096, 0.03, 0.05, 2), { y: 0.02, z: 0.0, rx: -0.1 }),
  ];
  // knuckle stones over the curled fingers
  for (let i = 0; i < 4; i++) {
    const x = -0.03 + i * 0.0195;
    stones.push(xf(chunk(0.024, 0.03, 0.034, 10 + i, 0.0025), { x, y: 0.006, z: -0.104 + Math.abs(i - 1.5) * 0.004, rx: 0.25 }));
    stones.push(xf(chunk(0.022, 0.026, 0.024, 20 + i, 0.002), { x, y: -0.03, z: -0.112 + Math.abs(i - 1.5) * 0.003, rx: -0.4 }));
  }
  // thumb guard
  stones.push(xf(chunk(0.03, 0.026, 0.05, 30), { x: -0.05, y: -0.012, z: -0.06, ry: 0.5, rz: 0.4 }));
  // bracer: stacked stone rings
  for (let i = 0; i < 3; i++) {
    const g = new THREE.CylinderGeometry(0.044 + i * 0.004, 0.046 + i * 0.004, 0.034, 8, 1);
    noisify(g, 0.003, 50, 40 + i, 2);
    stones.push(xf(g, { rx: Math.PI / 2, z: 0.03 + i * 0.038, ry: i * 0.3, sy: 1 }).scale(1, 0.8, 1));
  }
  add(G, flat(mergeGeos(stones)), rock);
  // glowing seams and runes
  const runes = [];
  const seam = (pts, r = 0.0013) => runes.push(tubeVar(pts, r, 8, 3, true));
  seam([V(-0.03, 0.043, -0.08), V(0, 0.046, -0.06), V(0.03, 0.043, -0.04)]);
  seam([V(0, 0.046, -0.085), V(0, 0.047, -0.02)]);
  seam([V(-0.02, 0.045, -0.03), V(0.02, 0.045, -0.075)]);
  for (let i = 0; i < 3; i++) {
    const z = 0.03 + i * 0.038;
    const a0 = rr() * 6;
    const pts = [];
    for (let k = 0; k <= 8; k++) { const a = a0 + (k / 8) * 1.6; pts.push(V(Math.cos(a) * (0.05 + i * 0.004), Math.sin(a) * (0.04 + i * 0.003), z + 0.017)); }
    seam(pts, 0.0015);
  }
  add(G, mergeGeos(runes), runeMat);
  // amber crystal shards on the back of the hand and the bracer
  const shards = [];
  crystalAt(shards, 0.05, 0.011, V(0.012, 0.035, -0.03), V(0.15, 1, 0.5), 3);
  crystalAt(shards, 0.035, 0.008, V(-0.018, 0.034, -0.02), V(-0.4, 1, 0.6), 4);
  crystalAt(shards, 0.04, 0.009, V(0.03, 0.03, 0.06), V(0.8, 1, 0.3), 5);
  crystalAt(shards, 0.03, 0.007, V(-0.03, 0.032, 0.09), V(-0.7, 1, 0.4), 6);
  const am = gem(G, kit, glows, mergeGeos(shards), meta.color, 0xffb050, { coreK: 2.2, opacity: 0.6, coreScale: 1, shellK: 0.25 });
  am.coreMesh.scale.set(0.55, 0.85, 0.55);
  const gh = haloSprite(kit, meta.color, 0.1, 0.12);
  gh.position.set(0, 0.05, -0.04); G.add(gh); glows.add(gh.material, 1);
  const tip = obj(G, 0, -0.01, -0.13);

  // ---- petrified staff in the left hand -------------------------------------
  const L = new THREE.Group();
  const pw = kit.wood(0x8a8278, 0.85);
  add(L, shaftGeo(-1.0, 0.42, { r: (t) => 0.02 - t * 0.003, wobble: 0.008, knots: 6, seed: 61, seg: 40 }), pw);
  add(L, gripWrapGeo(0.0185, -0.07, 0.075, 8, 0.0034), kit.leather(0x5a4030));
  const HL = headGroup(L, 0.36, o.hs ?? 1);
  const top = chunk(0.06, 0.07, 0.055, 70, 0.006);
  add(HL, flat(top), rock2, { y: 0.45, rx: 0.2, ry: 0.4 });
  const roots = [];
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + 0.3;
    roots.push(tubeVar([V(0, 0.36, 0), V(Math.cos(a) * 0.02, 0.4, Math.sin(a) * 0.02), V(Math.cos(a) * 0.032, 0.44, Math.sin(a) * 0.032), V(Math.cos(a) * 0.02, 0.48, Math.sin(a) * 0.02)], (t) => 0.007 * (1 - t * 0.5), 10, 5, true));
  }
  add(HL, mergeGeos(roots), pw);
  const ls = [];
  crystalAt(ls, 0.06, 0.012, V(0, 0.47, 0.01), V(0.1, 1, 0.1), 7);
  crystalAt(ls, 0.035, 0.008, V(0.015, 0.465, -0.01), V(0.7, 1, -0.2), 8);
  const lgm = gem(HL, kit, glows, mergeGeos(ls), meta.color, 0xffc070, { coreK: 3, opacity: 0.55, coreScale: 1 });
  lgm.coreMesh.scale.set(0.6, 1, 0.6);
  // moss tufts
  const moss = [];
  for (let i = 0; i < 8; i++) moss.push(sphere(0.006 + rr() * 0.005, 6, 4, { x: (rr() - 0.5) * 0.04, y: 0.38 + rr() * 0.06, z: (rr() - 0.5) * 0.04, sy: 0.5 }));
  add(HL, mergeGeos(moss), kit.plain(0x3a4a20, 1));

  return {
    right: G, rightGrip: { kind: 'fist' }, hold: 'fist', tip, rightAttach: 'hand',
    light: { color: meta.color },
    left: L, leftGrip: { kind: 'pole', r: 0.0185 }, leftHold: 'staff',
    hands: {
      R: { style: 'glove', glove: kit.glove(0x4a3a2a), cuff: false },
      L: { style: 'wrapped', glove: kit.leather(0x6a5040), skin: kit.skin(0xc89878), nail: kit.plain(0x6a5040, 0.6) },
    },
    update(t, dt, st) {
      const f = (0.75 + 0.25 * Math.sin(t * 1.7)) * st.glow;
      runeMat.color.set(meta.color).multiplyScalar(2.6 * f);
    },
  };
}

// ---------------------------------------------------------------------------
export function druid(kit, meta, o) {
  const { glows, detail } = o;
  const R = new THREE.Group();
  const wood = kit.wood(0x6a5038, 0.9);
  const vineMat = kit.wood(0x4a6a2a, 0.8);
  const leafMat = kit.plainDS(0x4a7a24, 0.7);
  const leafMat2 = kit.plainDS(0x6a8a2a, 0.7);
  const rr = mulberry(77);
  add(R, shaftGeo(-1.0, 0.38, { r: (t) => 0.019 - t * 0.003, wobble: 0.01, knots: 7, seed: 71, seg: 48 }), wood);
  add(R, gripWrapGeo(0.0175, -0.07, 0.075, 8, 0.0032), kit.leather(0x6a5030));
  // thorny vines spiralling up the shaft
  const vines = [], thorns = [];
  for (let k = 0; k < 2; k++) {
    const pts = helixPts(0.021, 0.1 + k * 0.03, 0.42, 2.2, 40, k * Math.PI);
    vines.push(tubeVar(pts, (t) => 0.0035 * (1 - t * 0.4), 60, 5, true));
    for (let i = 2; i < pts.length - 2; i += 3) {
      const p = pts[i];
      const dir = V(p.x, 0.3, p.z).normalize();
      thorns.push(xf(new THREE.ConeGeometry(0.0022, 0.009, 4), {}).applyQuaternion(new THREE.Quaternion().setFromUnitVectors(V(0, 1, 0), dir)).translate(p.x * 1.15, p.y, p.z * 1.15));
    }
  }
  add(R, mergeGeos(vines), vineMat);
  add(R, mergeGeos(thorns), kit.wood(0x9a8a60, 1));
  const H = headGroup(R, 0.36, o.hs ?? 1);
  // branches curling up around the seed pod
  const br = [];
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + 0.2;
    const pts = [[0.012, 0.36], [0.03, 0.4], [0.045, 0.45], [0.044, 0.5], [0.028, 0.545], [0.008, 0.56]].map(([r, y], k) => {
      const aa = a + k * 0.25;
      return V(Math.cos(aa) * r, y, Math.sin(aa) * r);
    });
    br.push(tubeVar(pts, (t) => 0.0075 * (1 - t * 0.7), 16, 6, true));
  }
  const brg = mergeGeos(br);
  noisify(brg, 0.001, 150, 5, 2);
  add(H, brg, wood);
  // seed pod: glowing core inside a ribbed translucent husk
  const pod = grp(H, { y: 0.47 });
  const husk = lathe([[0, -0.04], [0.016, -0.034], [0.026, -0.015], [0.028, 0.005], [0.022, 0.028], [0.01, 0.042], [0, 0.048]], detail >= 1 ? 16 : 10);
  const hp = husk.getAttribute('position');
  for (let i = 0; i < hp.count; i++) {
    const x = hp.getX(i), z = hp.getZ(i), a = Math.atan2(z, x);
    const k = 1 + Math.pow(Math.abs(Math.cos(a * 3)), 4) * 0.12;
    hp.setX(i, x * k); hp.setZ(i, z * k);
  }
  husk.computeVertexNormals();
  const pg = gem(pod, kit, glows, husk, meta.color, meta.color2, { coreK: 3.6, opacity: 0.55, coreScale: 0.6, shellK: 0.5 });
  void pg;
  const ph = haloSprite(kit, meta.color, 0.16, 0.35);
  pod.add(ph); glows.add(ph.material, 1);
  // leaves
  const leaves = [];
  const leafGeo = leaf(0.05, 0.016, 0.35);
  const leafGeo2 = leaf(0.035, 0.012, 0.25);
  for (let i = 0; i < (detail >= 1 ? 9 : 5); i++) {
    const y = 0.2 + rr() * 0.2;
    const a = rr() * Math.PI * 2;
    const g = grp(i < 6 ? R : H, { x: Math.cos(a) * 0.02, y: i < 6 ? y : 0.38 + rr() * 0.06, z: Math.sin(a) * 0.02 });
    g.rotation.set(0, -a + Math.PI / 2, 0);
    const m = add(g, i % 2 ? leafGeo : leafGeo2, i % 3 ? leafMat : leafMat2);
    m.rotation.set(0, 0, -0.9 - rr() * 0.4);
    leaves.push({ m, ph: rr() * 6 });
  }
  // curling tendril at the top
  const tend = [];
  let par = grp(H, { y: 0.545, x: 0.01 });
  for (let i = 0; i < 6; i++) {
    const s = add(par, xf(new THREE.CylinderGeometry(0.0018 * (1 - i * 0.12), 0.0022 * (1 - i * 0.12), 0.012, 5), { y: 0.006 }), vineMat);
    void s;
    const n = grp(par, { y: 0.012 });
    tend.push(n);
    par = n;
  }
  const tip = obj(H, 0, 0.47, 0);

  return {
    right: R, rightGrip: { kind: 'pole', r: 0.0175 }, hold: 'staff', tip,
    light: { color: meta.color },
    hands: {
      R: { style: 'bare', skin: kit.skin(0xc09070), nail: kit.plain(0x3a2a1a, 0.7) },
      L: { style: 'bare', skin: kit.skin(0xc09070), nail: kit.plain(0x3a2a1a, 0.7) },
    },
    leftGrip: { kind: 'open' },
    leftFx(hand) {
      const g = new THREE.Group();
      const vg = [];
      // vines wrapping the wrist and running over the back of the hand
      vg.push(tubeVar(helixPts(0.031, 0, 1, 2.2, 40).map((p) => V(p.x, p.z * 0.75, 0.06 - p.y * 0.1)), 0.0032, 50, 5, true));
      vg.push(tubeVar([V(0.03, 0.01, 0.0), V(0.02, 0.022, -0.03), V(0.0, 0.024, -0.06), V(-0.02, 0.02, -0.085)], 0.0026, 16, 5, true));
      vg.push(tubeVar([V(-0.03, 0.0, 0.01), V(-0.035, -0.012, -0.02), V(-0.03, -0.022, -0.04)], 0.0022, 12, 5, true));
      add(g, mergeGeos(vg), vineMat);
      const th = [];
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 4.4;
        th.push(xf(new THREE.ConeGeometry(0.0018, 0.007, 4), { x: Math.cos(a) * 0.034, y: Math.sin(a) * 0.026, z: 0.06 - (i / 8) * 0.1, rz: a - Math.PI / 2 }));
      }
      add(g, mergeGeos(th), kit.wood(0x9a8a60, 1));
      const lv = [];
      for (let i = 0; i < 3; i++) {
        const lg2 = grp(g, { x: 0.02 - i * 0.02, y: 0.026, z: 0.02 - i * 0.03 });
        add(lg2, leafGeo2, leafMat, { rx: -0.8, rz: i - 1 });
        lv.push(lg2);
      }
      // tendril on the back of the hand, curling
      const tj = [];
      let p2 = grp(g, { x: -0.02, y: 0.022, z: -0.085 });
      for (let i = 0; i < 6; i++) {
        add(p2, xf(new THREE.CylinderGeometry(0.0014, 0.0018, 0.01, 5), { y: 0.005 }), vineMat);
        const n = grp(p2, { y: 0.01 }); tj.push(n); p2 = n;
      }
      const glowSeeds = glows.add(kit.glow(meta.color, 2.4), 1);
      const seeds = [];
      for (let i = 0; i < 3; i++) seeds.push(add(g, sphere(0.003, 6, 4), glowSeeds, { x: 0.02 - i * 0.02, y: 0.03, z: -0.01 - i * 0.025 }));
      hand.group.add(g);
      return {
        update(t) {
          tj.forEach((j, i) => { j.rotation.x = -0.35 - 0.25 * Math.sin(t * 1.4 - i * 0.6); j.rotation.z = 0.1 * Math.sin(t + i); });
          lv.forEach((l, i) => { l.rotation.x = Math.sin(t * 2 + i) * 0.08; });
          seeds.forEach((s2, i) => s2.scale.setScalar(0.8 + 0.3 * Math.sin(t * 3 + i * 2)));
        },
      };
    },
    update(t, dt, st) {
      leaves.forEach((l) => { l.m.rotation.x = Math.sin(t * 2.3 + l.ph) * 0.12; });
      tend.forEach((j, i) => { j.rotation.z = -0.35 - 0.2 * Math.sin(t * 1.2 - i * 0.5); j.rotation.x = 0.1 * Math.sin(t * 0.9 + i); });
      pod.scale.setScalar(1 + 0.04 * Math.sin(t * 2.5) + st.charge * 0.1);
      pod.rotation.y = t * 0.3;
    },
  };
}

// ---------------------------------------------------------------------------
export function spellblade(kit, meta, o) {
  const { glows, detail } = o;
  const R = new THREE.Group();
  const steel = kit.metal(0xb8c0cc, 1.0);
  const dark = kit.metal(0x5a606a, 1.1);
  // grip + pommel
  add(R, cyl(0.0125, 0.013, 0.17, 10), kit.leather(0x2a2018)).position.y = -0.09;
  add(R, gripWrapGeo(0.013, -0.085, 0.07, 8, 0.0028), kit.leather(0x1a1410));
  add(R, mergeGeos([
    lathe([[0, -0.13], [0.012, -0.128], [0.02, -0.118], [0.021, -0.108], [0.016, -0.098], [0.011, -0.093]], 14),
    // crossguard with down-swept quillons
    tubeVar([V(-0.11, 0.095, 0), V(-0.08, 0.088, 0), V(-0.04, 0.083, 0), V(0, 0.082, 0), V(0.04, 0.083, 0), V(0.08, 0.088, 0), V(0.11, 0.095, 0)], (t) => 0.0055 + Math.sin(t * Math.PI) * 0.004, 24, 8, true),
    xf(roundedBox(0.04, 0.02, 0.026, 0.006, 2), { y: 0.085 }),
    sphere(0.008, 8, 6, { x: -0.112, y: 0.096 }), sphere(0.008, 8, 6, { x: 0.112, y: 0.096 }),
  ]), dark);
  const pg = gem(R, kit, glows, flat(new THREE.OctahedronGeometry(0.009, 0)), meta.color, meta.color2, { coreK: 4, opacity: 0.6 });
  pg.group.position.set(0, -0.113, 0.0);
  pg.group.scale.set(1, 1, 1.6);
  // blade: diamond cross-section, tapering to a point (along +Y from 0.095)
  const BL = 0.82;
  const prof = [];
  const n = detail >= 1 ? 24 : 12;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const w = t < 0.85 ? 0.026 - t * 0.008 : (0.026 - 0.85 * 0.008) * (1 - (t - 0.85) / 0.15);
    prof.push([t, Math.max(w, 0.0005)]);
  }
  const pos = [], idx = [], uv = [];
  for (let i = 0; i <= n; i++) {
    const [t, w] = prof[i];
    const y = 0.095 + t * BL;
    const th = 0.0045 * (1 - t * 0.5);
    // 4 verts: right edge, front, left edge, back
    pos.push(w, y, 0, 0, y, th, -w, y, 0, 0, y, -th);
    uv.push(0, t * 4, 0.5, t * 4, 1, t * 4, 0.5, t * 4);
  }
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < 4; j++) {
      const a = i * 4 + j, b = i * 4 + ((j + 1) % 4), c = (i + 1) * 4 + j, d = (i + 1) * 4 + ((j + 1) % 4);
      idx.push(a, c, b, b, c, d);
    }
  }
  let blade = new THREE.BufferGeometry();
  blade.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  blade.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  blade.setIndex(idx);
  blade = flat(blade);
  add(R, blade, steel);
  // fuller with glowing runes (both faces)
  const runeTex = runeStripTexture();
  const fm = glows.add(kit.glow(meta.color, 3.6, { additive: true, map: runeTex, side: THREE.DoubleSide }), 1);
  const fg = new THREE.PlaneGeometry(0.009, BL * 0.62);
  for (const s of [1, -1]) {
    const m = add(R, fg, fm, { y: 0.095 + BL * 0.36, z: s * 0.0034, ro: 4 });
    if (s < 0) m.rotation.y = Math.PI;
  }
  const fuller = glows.add(kit.glow(meta.color, 0.5), 0.6);
  add(R, xf(new THREE.BoxGeometry(0.004, BL * 0.66, 0.0062), { y: 0.095 + BL * 0.36 }), fuller);
  const tip = obj(R, 0, 0.095 + BL, 0);
  const halo = haloSprite(kit, meta.color, 0.06, 0.35);
  halo.position.y = -0.113; R.add(halo); glows.add(halo.material, 1);

  return {
    right: R, rightGrip: { kind: 'pole', r: 0.013 }, hold: 'sword', tip, lightAnchor: obj(R, -0.04, 0.12, 0.04),
    light: { color: meta.color },
    hands: {
      R: { style: 'gauntlet', glove: kit.glove(0x3a3028), armor: kit.metal(0x8a929e, 0.8) },
      L: { style: 'glove', glove: kit.glove(0x3a3028), cuff: false },
    },
    leftGrip: { kind: 'open' },
    leftFx(hand) {
      const g = new THREE.Group();
      // steel bracer with leather straps
      const br = lathe([[0.03, 0], [0.033, 0.01], [0.037, 0.06], [0.04, 0.09], [0.038, 0.095]], 14, Math.PI * 0.1, Math.PI * 1.8);
      xf(br, { rx: Math.PI / 2, z: 0.005 });
      br.scale(1, 0.85, 1);
      add(g, br, kit.metal(0x8a929e, 0.8));
      const straps = mergeGeos([torus(0.034, 0.003, 4, 20, Math.PI * 2, { z: 0.03, sx: 1, sy: 0.85 }), torus(0.038, 0.003, 4, 20, Math.PI * 2, { z: 0.07, sx: 1, sy: 0.85 })]);
      add(g, straps, kit.leather(0x3a2a1e));
      const rv = [];
      for (let i = 0; i < 4; i++) rv.push(sphere(0.0025, 6, 4, { x: Math.cos(1.2 + i * 0.25) * 0.036, y: Math.sin(1.2 + i * 0.25) * 0.03, z: 0.02 + (i % 2) * 0.05 }));
      add(g, mergeGeos(rv), kit.metal(0xd0d4dc, 0.7));
      // hovering rune circle above the back of the hand
      const rc = grp(g, { y: 0.055, z: -0.02 });
      const rm = glows.add(kit.glow(meta.color, 1.8, { additive: true, map: runeRingTexture(31), side: THREE.DoubleSide }), 1);
      const ring = add(rc, new THREE.PlaneGeometry(0.11, 0.11), rm, { rx: -Math.PI / 2, ro: 4 });
      const ring2 = add(rc, new THREE.PlaneGeometry(0.06, 0.06), rm, { rx: -Math.PI / 2, ro: 4, y: 0.008 });
      const h = haloSprite(kit, meta.color, 0.1, 0.25);
      rc.add(h); glows.add(h.material, 1);
      hand.group.add(g);
      return { update(t) { ring.rotation.z = t * 0.5; ring2.rotation.z = -t * 0.9; rc.position.y = 0.055 + Math.sin(t * 1.8) * 0.004; } };
    },
    update(t, dt, st) {
      const k = (0.7 + 0.3 * Math.sin(t * 2.4)) * st.glow;
      fm.color.set(meta.color).multiplyScalar(3.6 * k);
    },
  };
}

let _runeStrip = null;
function runeStripTexture() {
  if (_runeStrip) return _runeStrip;
  const c = document.createElement('canvas');
  c.width = 32; c.height = 512;
  const g = c.getContext('2d');
  g.strokeStyle = '#fff'; g.lineWidth = 2.5; g.lineCap = 'round'; g.shadowColor = '#fff'; g.shadowBlur = 4;
  const r = mulberry(5);
  for (let y = 16; y < 500; y += 30) {
    g.beginPath();
    g.moveTo(16, y - 10); g.lineTo(16, y + 10);
    for (let k = 0; k < 2; k++) {
      const yy = y - 8 + r() * 16, d = r() < 0.5 ? -1 : 1;
      g.moveTo(16, yy); g.lineTo(16 + d * (5 + r() * 6), yy + (r() - 0.5) * 12);
    }
    g.stroke();
  }
  _runeStrip = new THREE.CanvasTexture(c);
  _runeStrip.colorSpace = THREE.SRGBColorSpace;
  return _runeStrip;
}

// ---------------------------------------------------------------------------
export function tempest(kit, meta, o) {
  const { glows, detail } = o;
  const R = new THREE.Group();
  const drift = kit.wood(0xd8d0c0, 1.0);
  add(R, shaftGeo(-1.0, 0.4, { r: (t) => 0.017 - t * 0.002, wobble: 0.009, knots: 4, seed: 81, seg: 48 }), drift);
  add(R, gripWrapGeo(0.0165, -0.07, 0.075, 8, 0.003), kit.leather(0x5a6a6a));
  const rr = mulberry(91);
  // feathers on cords
  const cordMat = kit.leather(0x4a3a2a);
  const fMat = kit.plainDS(0xe8e4dc, 0.85);
  const fMat2 = kit.plainDS(0x6a6a70, 0.85);
  const beadMat = kit.plain(0x40a8a0, 0.3, 0.1);
  const feathers = [];
  add(R, torus(0.018, 0.0028, 5, 14, Math.PI * 2, { y: 0.33, rx: Math.PI / 2 }), cordMat);
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + 0.6;
    const g = grp(R, { x: Math.cos(a) * 0.019, y: 0.33, z: Math.sin(a) * 0.019 });
    add(g, cyl(0.0012, 0.0012, 0.05, 4), cordMat, { y: -0.05 });
    add(g, sphere(0.0045, 8, 6), beadMat, { y: -0.03 });
    const fg = grp(g, { y: -0.05 });
    const fm = add(fg, feather(0.075 + i * 0.01, 0.012, 3 + i), i === 1 ? fMat2 : fMat);
    fm.rotation.set(Math.PI, 0, 0);
    feathers.push({ g, fg, ph: rr() * 6, a });
  }
  const H = headGroup(R, 0.38, o.hs ?? 1);
  // forked crook cradling the orb
  const fork = [];
  for (const s of [-1, 1]) {
    const pts = [[0.004, 0.38], [0.02, 0.42], [0.042, 0.47], [0.046, 0.52], [0.03, 0.56], [0.012, 0.575]].map(([x, y], k) => V(s * x, y, Math.sin(k * 0.7 + s) * 0.006));
    fork.push(tubeVar(pts, (t) => 0.0075 * (1 - t * 0.6), 18, 6, true));
  }
  const fgeo = mergeGeos(fork);
  noisify(fgeo, 0.001, 120, 9, 2);
  add(H, fgeo, drift);
  // wind orb: bright core + nested swirling translucent shells
  const orb = grp(H, { y: 0.505 });
  const core = glows.add(kit.glow(meta.color2, 4), 1);
  add(orb, sphere(0.009, 12, 8), core);
  const tex = streakTexture(4);
  const shells = [];
  for (let i = 0; i < 3; i++) {
    const m = glows.add(kit.glow(i === 1 ? meta.color2 : meta.color, 0.7 - i * 0.12, { additive: true, map: tex, side: THREE.DoubleSide }), 0.6);
    const sh = add(orb, new THREE.SphereGeometry(0.02 + i * 0.008, 20, 12), m, { ro: 4 + i });
    sh.rotation.set(rr() * 3, rr() * 3, rr() * 3);
    shells.push(sh);
  }
  const glass = glows.add(kit.shell(meta.color, 0.18, 0.4), 0.5);
  add(orb, sphere(0.036, 20, 14), glass, { ro: 3 });
  const oh = haloSprite(kit, meta.color, 0.16, 0.35);
  orb.add(oh); glows.add(oh.material, 1);
  const tip = obj(H, 0, 0.505, 0);

  return {
    right: R, rightGrip: { kind: 'pole', r: 0.0165 }, hold: 'staff', tip,
    light: { color: meta.color },
    hands: {
      R: { style: 'wrapped', glove: kit.cloth(0xd8d4c8), skin: kit.skin(0xd8b49c), nail: kit.plain(0xc8a090, 0.5) },
      L: { style: 'wrapped', glove: kit.cloth(0xd8d4c8), skin: kit.skin(0xd8b49c), nail: kit.plain(0xc8a090, 0.5) },
    },
    leftGrip: { kind: 'open' },
    leftFx(hand) {
      const g = new THREE.Group();
      g.position.set(0, -0.01, -0.03);
      const ribbons = [];
      for (let i = 0; i < 3; i++) {
        const m = glows.add(kit.glow(i ? meta.color : meta.color2, 0.55, { additive: true, map: tex, side: THREE.DoubleSide }), 0.6);
        // ribbon strip along a helix around the hand axis (Z)
        const pos = [], uv = [], idx = [];
        const N = 60, turns = 1.6, r0 = 0.05 + i * 0.012;
        for (let k = 0; k <= N; k++) {
          const t = k / N;
          const a = t * turns * Math.PI * 2 + i * 2;
          const rad = r0 * (1 - t * 0.35);
          const z = 0.07 - t * 0.17;
          const w = 0.008 * Math.sin(t * Math.PI);
          pos.push(Math.cos(a) * rad, Math.sin(a) * rad * 0.8, z - w, Math.cos(a) * rad, Math.sin(a) * rad * 0.8, z + w);
          uv.push(t * 2, 0, t * 2, 1);
        }
        for (let k = 0; k < N; k++) idx.push(k * 2, k * 2 + 1, k * 2 + 2, k * 2 + 1, k * 2 + 3, k * 2 + 2);
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
        geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
        geo.setIndex(idx); geo.computeVertexNormals();
        ribbons.push(add(g, geo, m, { ro: 4 }));
      }
      hand.group.add(g);
      return { update(t) { ribbons.forEach((rb, i) => { rb.rotation.z = t * (2.2 + i * 0.6); }); } };
    },
    update(t, dt, st) {
      const sp = 1 + st.charge * 2.5 + st.power;
      shells[0].rotation.y += dt * 2.6 * sp; shells[0].rotation.x += dt * 0.7;
      shells[1].rotation.z -= dt * 3.4 * sp; shells[1].rotation.y += dt * 0.5;
      shells[2].rotation.x += dt * 1.9 * sp; shells[2].rotation.z += dt * 1.1;
      feathers.forEach((f) => {
        f.g.rotation.x = Math.sin(t * 2.1 + f.ph) * 0.15;
        f.g.rotation.z = Math.sin(t * 1.7 + f.ph * 2) * 0.12;
        f.fg.rotation.y = Math.sin(t * 2.7 + f.ph) * 0.5;
      });
      core.color.set(meta.color2).multiplyScalar(4 * st.glow * (0.9 + 0.1 * Math.sin(t * 5)));
    },
  };
}
