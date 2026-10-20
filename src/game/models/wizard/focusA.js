import * as THREE from 'three';
import {
  V, cyl, sphere, torus, lathe, tubeVar, crystal, mergeGeos, xf, noisify, mulberry, helixPts, roundedBox,
  skullParts, flat, uvs, gear,
} from './shapes.js';
import { add, obj, grp, shaftGeo, gripWrapGeo, wrapGeo, gem, crystalAt, headGroup } from './common.js';
import { Bolt, FlameCluster, Pendulum, haloSprite, wob, flick, hangFrom } from './fx.js';
import { pageTexture, pageGlowTexture, streakTexture, glowTexture, runeRingTexture, clockFaceTexture, veinTexture } from './surfaces.js';

// Class foci, part 1. Each builder returns:
//  right: Group in GRIP space (pole axis +Y, origin = centre of the fist)
//  rightGrip: { kind: 'pole'|'fist'|'claw', r }
//  hold: viewmodel orientation preset name
//  tip: Object3D muzzle
//  left: optional Group held by the left hand (grip space) ; leftGrip
//  float: optional Group that hovers near the left hand (attached to the rig)
//  leftFx(hand): optional builder of effects attached to the left hand
//  update(t, dt, st)

const C = (c) => new THREE.Color(c);

// ---------------------------------------------------------------------------
export function pyromancer(kit, meta, o) {
  const { glows, detail } = o;
  const R = new THREE.Group();
  const wood = kit.wood(0x6a5448, 0.5);
  const iron = kit.darkIron();
  const seg = detail >= 1 ? 1 : 0.5;
  // shaft: charred, knotted
  add(R, shaftGeo(-1.0, 0.39, { r: (t) => 0.021 - t * 0.004 + (t > 0.9 ? (t - 0.9) * 0.05 : 0), wobble: 0.006, knots: 5, seed: 11, seg: Math.round(56 * seg) }), wood);
  add(R, gripWrapGeo(0.0175, -0.075, 0.08, detail >= 1 ? 11 : 6, 0.0034), kit.leather(0x7a3a2a));
  add(R, mergeGeos([
    torus(0.0195, 0.003, 6, 18, Math.PI * 2, { y: 0.088, rx: Math.PI / 2 }),
    torus(0.0195, 0.003, 6, 18, Math.PI * 2, { y: -0.083, rx: Math.PI / 2 }),
    torus(0.0185, 0.0035, 6, 18, Math.PI * 2, { y: 0.34, rx: Math.PI / 2 }),
    torus(0.0175, 0.0035, 6, 18, Math.PI * 2, { y: 0.375, rx: Math.PI / 2 }),
    xf(new THREE.ConeGeometry(0.02, 0.06, 8), { y: -1.03, rx: Math.PI }),
  ]), iron);
  // iron studs between the bands
  const studs = [];
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    studs.push(sphere(0.0035, 6, 4, { x: Math.cos(a) * 0.018, y: 0.357, z: Math.sin(a) * 0.018 }));
  }
  add(R, mergeGeos(studs), iron);
  const H = headGroup(R, 0.36, o.hs ?? 1);
  // four charred prongs caging the crystal
  const prongs = [];
  for (let i = 0; i < 4; i++) {
    const a0 = (i / 4) * Math.PI * 2 + 0.4;
    const pts = [];
    const prof = [[0.008, 0.37], [0.026, 0.42], [0.045, 0.47], [0.05, 0.51], [0.04, 0.56], [0.02, 0.6], [0.006, 0.625]];
    prof.forEach(([r, y], k) => {
      const a = a0 + k * 0.12;
      pts.push(V(Math.cos(a) * r, y, Math.sin(a) * r));
    });
    prongs.push(tubeVar(pts, (t) => 0.0075 * (1 - t * 0.6), Math.round(20 * seg) + 4, 6, true));
  }
  const prongGeo = mergeGeos(prongs);
  noisify(prongGeo, 0.0015, 160, 3, 2);
  add(H, prongGeo, wood);
  // ember cracks glowing on the upper shaft and prongs
  const crackMat = glows.add(kit.glow(meta.color, 1.6), 0.8);
  const cracks = [];
  const rr = mulberry(9);
  for (let i = 0; i < 7; i++) {
    const a = rr() * Math.PI * 2, y = 0.16 + rr() * 0.2, l = 0.02 + rr() * 0.04;
    const pts = [];
    for (let k = 0; k < 4; k++) {
      const aa = a + (rr() - 0.5) * 0.3;
      const r = 0.0176 - (y + k * l / 3 - 0.16) * 0.004;
      pts.push(V(Math.cos(aa) * r, y + (k * l) / 3, Math.sin(aa) * r));
    }
    cracks.push(tubeVar(pts, 0.0011, 6, 3, true));
  }
  add(R, mergeGeos(cracks), crackMat);
  // ember crystal
  const cg = crystal(0.11, 0.024, 6, 5);
  cg.translate(0, -0.055, 0);
  const em = gem(H, kit, glows, cg, meta.color, 0xffb040, { coreK: 5, opacity: 0.55, shellK: 0.9, coreScale: 0.6 });
  em.group.position.y = 0.5;
  const small = [];
  crystalAt(small, 0.035, 0.009, V(0.012, 0.448, 0.006), V(0.6, 1, 0.2), 4);
  crystalAt(small, 0.03, 0.008, V(-0.01, 0.45, -0.008), V(-0.5, 1, -0.3), 6);
  const sm = gem(H, kit, glows, mergeGeos(small), meta.color, 0xffa030, { coreK: 3.5, opacity: 0.5 });
  const halo = haloSprite(kit, meta.color, 0.2, 0.55);
  halo.position.y = 0.5;
  H.add(halo);
  glows.add(halo.material, 1);
  // drifting embers
  const emberMat = glows.add(kit.glow(0xffc070, 4), 1);
  const emberGeo = new THREE.TetrahedronGeometry(0.0035);
  const embers = [];
  for (let i = 0; i < (detail >= 1 ? 6 : 3); i++) {
    const m = add(H, emberGeo, emberMat);
    embers.push({ m, ph: i / 6, a: rr() * 6, r: 0.01 + rr() * 0.02, sp: 0.6 + rr() * 0.5 });
  }
  const tip = obj(H, 0, 0.5, 0);

  return {
    right: R, rightGrip: { kind: 'pole', r: 0.0175 }, hold: 'staff', tip,
    light: { color: meta.color, pos: V(0, 0.5, 0) },
    hands: {
      R: { style: 'glove', glove: kit.glove(0x5a3a2c), cuff: kit.glove(0x3a2218) },
      L: { style: 'fingerless', glove: kit.glove(0x3a2a22), skin: kit.skin(0xd8b098), nail: kit.plain(0x4a3a30, 0.5) },
    },
    leftGrip: { kind: 'cradle' }, leftHold: 'cradle',
    leftFx(hand) {
      const g = new THREE.Group();
      const palm = new FlameCluster(kit, meta.color, meta.color2, { count: detail >= 1 ? 7 : 4, size: 0.046, spread: 0.015, seed: 3, intensity: 0.5 });
      // the fire sits a little off the palm and always burns upward on screen, so it reads in profile
      const palmAnchor = new THREE.Group();
      palmAnchor.position.set(0, -0.05, -0.06);
      palmAnchor.add(palm.group);
      g.add(palmAnchor);
      const _q = new THREE.Quaternion();
      palm.materials.forEach((m) => glows.add(m, 1));
      const tipsF = [];
      hand.tips.forEach((tp, i) => {
        if (detail < 1 && i % 2) return;
        const f = new FlameCluster(kit, meta.color, meta.color2, { count: 2, size: 0.018, spread: 0.004, seed: 20 + i, intensity: 0.8 });
        f.group.rotation.x = Math.PI / 2;
        tp.add(f.group);
        f.materials.forEach((m) => glows.add(m, 1));
        tipsF.push(f);
      });
      const h = haloSprite(kit, meta.color, 0.09, 0.18);
      h.position.set(0, -0.04, -0.06);
      g.add(h); glows.add(h.material, 1);
      hand.group.add(g);
      return {
        update(t, k) {
          palmAnchor.getWorldQuaternion(_q);
          palm.group.quaternion.copy(_q.invert());
          palm.update(t, k); tipsF.forEach((f, i) => f.update(t + i, k));
        },
      };
    },
    update(t, dt, st) {
      const f = 0.85 + 0.15 * flick(t, 1) + 0.6 * st.charge;
      em.core.color.setRGB(1, 0.69, 0.25).multiplyScalar(5 * f * st.glow);
      sm.coreMesh.rotation.y = t * 0.3;
      em.group.rotation.y = t * 0.4;
      halo.material.color.set(meta.color).multiplyScalar(0.55 * f * st.glow);
      for (const e of embers) {
        const p = (t * e.sp * 0.5 + e.ph) % 1;
        const a = e.a + t * 1.5;
        e.m.position.set(Math.cos(a) * e.r * (1 + p), 0.5 + p * 0.16, Math.sin(a) * e.r * (1 + p));
        e.m.scale.setScalar(Math.sin(p * Math.PI) * (1 + st.charge));
        e.m.rotation.set(t * 3, t * 2, 0);
      }
    },
  };
}

// ---------------------------------------------------------------------------
export function cryomancer(kit, meta, o) {
  const { glows, detail } = o;
  const R = new THREE.Group();
  const ash = kit.wood(0xe8e2d8, 1);
  const silver = kit.silver();
  add(R, shaftGeo(-1.0, 0.42, { r: (t) => 0.018 - t * 0.003, wobble: 0.003, knots: 2, seed: 21, seg: detail >= 1 ? 48 : 24 }), ash);
  add(R, gripWrapGeo(0.0168, -0.07, 0.075, detail >= 1 ? 10 : 6, 0.003), kit.leather(0x9aa8b8));
  add(R, mergeGeos([
    torus(0.018, 0.0028, 6, 18, Math.PI * 2, { y: 0.082, rx: Math.PI / 2 }),
    torus(0.018, 0.0028, 6, 18, Math.PI * 2, { y: -0.078, rx: Math.PI / 2 }),
    lathe([[0.016, 0.33], [0.02, 0.35], [0.022, 0.38], [0.017, 0.4], [0.015, 0.42]], 12),
    xf(new THREE.ConeGeometry(0.019, 0.05, 8), { y: -1.025, rx: Math.PI }),
  ]), silver);
  const H = headGroup(R, 0.4, o.hs ?? 1);
  // three tines gripping the crystal cluster
  const tines = [];
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    const pts = [[0.01, 0.4], [0.028, 0.44], [0.034, 0.48], [0.026, 0.52]].map(([r, y]) => V(Math.cos(a) * r, y, Math.sin(a) * r));
    tines.push(tubeVar(pts, (t) => 0.004 * (1 - t * 0.5), 10, 6, true));
  }
  add(H, mergeGeos(tines), silver);
  // jagged ice cluster
  const big = [], rr = mulberry(31);
  crystalAt(big, 0.17, 0.022, V(0, 0.41, 0), V(0.05, 1, 0.02), 2);
  const N = detail >= 1 ? 9 : 5;
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2 + rr() * 0.4;
    const tilt = 0.45 + rr() * 0.5;
    const dir = V(Math.cos(a) * tilt, 1, Math.sin(a) * tilt);
    crystalAt(big, 0.05 + rr() * 0.06, 0.008 + rr() * 0.007, V(Math.cos(a) * 0.012, 0.43 + rr() * 0.03, Math.sin(a) * 0.012), dir, 40 + i);
  }
  const ice = gem(H, kit, glows, mergeGeos(big), meta.color, 0x9fe4ff, { coreK: 2.4, opacity: 0.5, shellK: 0.3, coreScale: 1 });
  // core: thinner inner crystal (scaled around the axis only)
  ice.coreMesh.scale.set(0.45, 0.85, 0.45);
  ice.coreMesh.position.y = 0.06;
  // frost rime flecks near the head
  const rime = [];
  for (let i = 0; i < (detail >= 1 ? 26 : 10); i++) {
    const a = rr() * Math.PI * 2, y = 0.22 + rr() * 0.18;
    crystalAt(rime, 0.008 + rr() * 0.01, 0.002 + rr() * 0.002, V(Math.cos(a) * 0.015, y, Math.sin(a) * 0.015), V(Math.cos(a), 0.6 + rr(), Math.sin(a)), 80 + i, 4);
  }
  add(R, mergeGeos(rime), kit.plain(0xe8f6ff, 0.25, 0.1));
  // orbiting shards
  const shardGeo = crystal(0.03, 0.006, 4, 9);
  shardGeo.translate(0, -0.015, 0);
  const shardMat = glows.add(kit.shell(meta.color, 0.7, 1.4), 0.8);
  const shards = [];
  for (let i = 0; i < 3; i++) shards.push(add(H, shardGeo, shardMat, { ro: 2 }));
  const glint = haloSprite(kit, 0xffffff, 0.04, 2.5);
  H.add(glint); glows.add(glint.material, 0.5);
  const halo = haloSprite(kit, meta.color, 0.2, 0.22);
  halo.position.y = 0.5; H.add(halo); glows.add(halo.material, 1);
  const tip = obj(H, 0, 0.53, 0);
  const tipPts = [V(0, 0.58, 0), V(0.04, 0.5, 0.02), V(-0.035, 0.51, -0.02), V(0.01, 0.52, -0.04), V(-0.02, 0.5, 0.04)];

  return {
    right: R, rightGrip: { kind: 'pole', r: 0.0165 }, hold: 'staff', tip,
    light: { color: meta.color, pos: V(0, 0.5, 0) },
    hands: {
      R: { style: 'glove', glove: kit.glove(0xb8c4d0), cuff: kit.fur(0xf0f0f0) },
      L: { style: 'glove', glove: kit.glove(0xb8c4d0), cuff: kit.fur(0xf0f0f0) },
    },
    leftGrip: { kind: 'open' },
    leftFx(hand) {
      const g = new THREE.Group();
      g.position.set(0, -0.045, -0.06);
      const tex = streakTexture(4);
      const mats = [];
      const shells = [];
      for (let i = 0; i < 3; i++) {
        const m = kit.glow(i === 1 ? 0xffffff : meta.color, 0.55, { additive: true, map: tex, side: THREE.DoubleSide });
        glows.add(m, 0.6); mats.push(m);
        const s = add(g, new THREE.SphereGeometry(0.035 + i * 0.012, 16, 10, 0, Math.PI * 2, 0.6, 1.9), m, { ro: 4 });
        s.scale.set(1, 0.55, 1);
        shells.push(s);
      }
      const sm = glows.add(kit.shell(meta.color, 0.75, 1.5), 0.8);
      const orb = [];
      for (let i = 0; i < 4; i++) orb.push(add(g, shardGeo, sm, { ro: 2, s: 0.6 }));
      const h = haloSprite(kit, meta.color, 0.12, 0.35);
      g.add(h); glows.add(h.material, 1);
      g.rotation.x = Math.PI;
      hand.group.add(g);
      return {
        update(t, k) {
          shells.forEach((s, i) => { s.rotation.y = t * (0.6 + i * 0.35) * (i % 2 ? -1 : 1); s.rotation.z = Math.sin(t * 0.7 + i) * 0.2; });
          orb.forEach((s, i) => {
            const a = t * 1.4 + (i / 4) * Math.PI * 2;
            s.position.set(Math.cos(a) * 0.04, 0.02 + Math.sin(t * 2 + i) * 0.01, Math.sin(a) * 0.04);
            s.rotation.set(t * 2 + i, t, a);
          });
        },
      };
    },
    update(t, dt, st) {
      shards.forEach((s, i) => {
        const a = t * 0.9 + (i / 3) * Math.PI * 2;
        s.position.set(Math.cos(a) * 0.07, 0.5 + Math.sin(t * 1.3 + i * 2) * 0.02, Math.sin(a) * 0.07);
        s.rotation.set(Math.sin(t + i) * 0.5, -a, 0.3);
      });
      // glint hops between crystal tips
      const gi = Math.floor(t * 0.9) % tipPts.length;
      const gp = (t * 0.9) % 1;
      glint.position.copy(tipPts[gi]);
      glint.scale.setScalar(0.05 * Math.pow(Math.sin(gp * Math.PI), 3) + 0.001);
      glint.material.rotation = t;
      ice.core.color.set(0x9fe4ff).multiplyScalar(2.4 * (0.9 + 0.1 * wob(t * 2)) * st.glow * (1 + st.charge * 0.6));
    },
  };
}

// ---------------------------------------------------------------------------
export function stormcaller(kit, meta, o) {
  const { glows, detail } = o;
  const R = new THREE.Group();
  const copper = kit.copper();
  const brass = kit.brass();
  add(R, cyl(0.012, 0.014, 1.38, 12), copper).position.y = -0.98;
  add(R, gripWrapGeo(0.0135, -0.07, 0.075, detail >= 1 ? 11 : 6, 0.0034), kit.leather(0x4a3020));
  add(R, mergeGeos([
    lathe([[0.014, 0.075], [0.018, 0.08], [0.018, 0.095], [0.014, 0.1]], 12),
    lathe([[0.014, -0.1], [0.018, -0.095], [0.018, -0.08], [0.014, -0.075]], 12),
    lathe([[0.012, 0.38], [0.02, 0.39], [0.022, 0.41], [0.012, 0.43], [0.009, 0.46]], 12),
    xf(new THREE.ConeGeometry(0.016, 0.05, 8), { y: -1.005, rx: Math.PI }),
  ]), brass);
  // wire coil around the rod
  const coil = tubeVar(helixPts(0.0155, 0.15, 0.36, 14, 220), 0.0019, 220, 4, true);
  add(R, coil, copper);
  // coiled rings (tesla-coil like)
  const ringGeos = [];
  const ringYs = [[0.24, 0.026], [0.3, 0.036], [0.355, 0.028]];
  for (const [y, rad] of ringYs) {
    ringGeos.push(torus(rad, 0.0032, 6, 24, Math.PI * 2, { y, rx: Math.PI / 2 }));
    // wire wound around the ring
    const pts = [];
    const n = detail >= 1 ? 160 : 80;
    for (let i = 0; i <= n; i++) {
      const a = (i / n) * Math.PI * 2, b = a * 22;
      const rr = rad + Math.cos(b) * 0.0045;
      pts.push(V(Math.cos(a) * rr, y + Math.sin(b) * 0.0045, Math.sin(a) * rr));
    }
    ringGeos.push(tubeVar(pts, 0.0011, n, 3, false, true));
    // spokes
    for (let k = 0; k < 3; k++) {
      const a = (k / 3) * Math.PI * 2;
      ringGeos.push(tubeVar([V(Math.cos(a) * 0.013, y - 0.004, Math.sin(a) * 0.013), V(Math.cos(a) * rad, y, Math.sin(a) * rad)], 0.0014, 2, 4, true));
    }
  }
  add(R, mergeGeos(ringGeos), copper);
  const H = headGroup(R, 0.44, o.hs ?? 1);
  // claws holding the sphere
  const claws = [];
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + 0.5;
    const pts = [[0.009, 0.45], [0.022, 0.47], [0.03, 0.5], [0.027, 0.53], [0.017, 0.548]].map(([r, y]) => V(Math.cos(a) * r, y, Math.sin(a) * r));
    claws.push(tubeVar(pts, (t) => 0.003 * (1 - t * 0.5), 12, 5, true));
  }
  add(H, mergeGeos(claws), brass);
  // crackling sphere
  const core = glows.add(kit.glow(meta.color2, 5), 1);
  add(H, sphere(0.012, 12, 8), core).position.y = 0.505;
  const shell = glows.add(kit.shell(meta.color, 0.35, 0.8), 0.6);
  add(H, sphere(0.028, 20, 14), shell, { ro: 3 }).position.y = 0.505;
  const boltMat = glows.add(kit.glow(meta.color2, 4.5, { additive: true }), 1);
  const bolts = [];
  for (let i = 0; i < (detail >= 1 ? 5 : 3); i++) {
    const b = new Bolt(boltMat, 6, 0.0012);
    b.mesh.renderOrder = 5;
    H.add(b.mesh); bolts.push(b);
  }
  const arcs = [];
  for (let i = 0; i < 2; i++) {
    const b = new Bolt(boltMat, 8, 0.0011);
    H.add(b.mesh); arcs.push(b);
  }
  const halo = haloSprite(kit, meta.color, 0.22, 0.6);
  halo.position.y = 0.505; H.add(halo); glows.add(halo.material, 1);
  const tip = obj(H, 0, 0.505, 0);
  const center = V(0, 0.505, 0);
  let acc = 0;
  const tmpA = V(), tmpB = V();

  return {
    right: R, rightGrip: { kind: 'pole', r: 0.0135 }, hold: 'staff', tip,
    light: { color: meta.color, pos: V(0, 0.5, 0) },
    hands: {
      R: { style: 'glove', glove: kit.glove(0x6a4a34), cuff: kit.glove(0x4a3020), rings: [{ finger: 0, seg: 0, mat: brass }, { finger: 2, seg: 0, mat: brass }] },
      L: { style: 'fingerless', glove: kit.glove(0x6a4a34), skin: kit.skin(0xd0a890), nail: kit.plain(0x8a6a5a, 0.5), rings: [{ finger: 1, seg: 0, mat: brass }] },
    },
    leftGrip: { kind: 'spread' },
    leftFx(hand) {
      const lb = [];
      for (let i = 0; i < (detail >= 1 ? 4 : 2); i++) {
        const b = new Bolt(boltMat, 7, 0.0009);
        hand.group.add(b.mesh); lb.push(b);
      }
      const h = haloSprite(kit, meta.color, 0.12, 0.4);
      h.position.set(0, -0.02, -0.11); hand.group.add(h); glows.add(h.material, 1);
      const inv = new THREE.Matrix4();
      const pa = V(), pb = V();
      let acc2 = 0;
      return {
        update(t, k, dt) {
          acc2 += dt;
          if (acc2 < 0.045) return;
          acc2 = 0;
          hand.group.updateWorldMatrix(true, true);
          inv.copy(hand.group.matrixWorld).invert();
          const tips = hand.tips; // 0..3 fingers, 4 thumb
          const pairs = [[4, 0], [0, 1], [1, 2], [2, 3]];
          lb.forEach((b, i) => {
            const pr = pairs[(i + Math.floor(t * 7)) % pairs.length];
            tips[pr[0]].getWorldPosition(pa).applyMatrix4(inv);
            tips[pr[1]].getWorldPosition(pb).applyMatrix4(inv);
            b.set(pa, pb, 0.35, Math.random);
            b.mesh.visible = Math.random() < 0.85;
          });
        },
      };
    },
    update(t, dt, st) {
      acc += dt;
      if (acc > 0.05) {
        acc = 0;
        bolts.forEach((b) => {
          tmpA.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize().multiplyScalar(0.027).add(center);
          b.set(center, tmpA, 0.3);
        });
        arcs.forEach((b, i) => {
          const show = Math.random() < 0.35 + st.charge * 0.6;
          b.mesh.visible = show;
          if (!show) return;
          const [y, rad] = ringYs[Math.floor(Math.random() * 3)];
          const a = Math.random() * Math.PI * 2;
          tmpB.set(Math.cos(a) * rad, y, Math.sin(a) * rad);
          tmpA.set(Math.random() - 0.5, -1, Math.random() - 0.5).normalize().multiplyScalar(0.028).add(center);
          b.set(tmpA, tmpB, 0.25);
          void i;
        });
      }
      const f = 0.8 + 0.4 * Math.abs(flick(t * 2, 2)) + st.charge;
      core.color.set(meta.color2).multiplyScalar(5 * f * st.glow);
      halo.material.color.set(meta.color).multiplyScalar(0.6 * f * st.glow);
    },
  };
}

// ---------------------------------------------------------------------------
export function arcanist(kit, meta, o) {
  const { glows, detail } = o;
  const R = new THREE.Group();
  const silver = kit.silver();
  const gold = kit.gold();
  // handle: dark wood with silver end caps
  add(R, lathe([[0, -0.075], [0.008, -0.074], [0.0105, -0.06], [0.0095, -0.02], [0.0105, 0.03], [0.0085, 0.055], [0.006, 0.07]], 12), kit.wood(0x5a3a3a, 0.6));
  add(R, mergeGeos([
    lathe([[0, -0.098], [0.006, -0.096], [0.011, -0.088], [0.012, -0.08], [0.0105, -0.074], [0.008, -0.07]], 12),
    sphere(0.006, 10, 8, { y: -0.1 }),
    lathe([[0.0085, 0.052], [0.0105, 0.058], [0.0095, 0.068], [0.006, 0.075]], 12),
  ]), silver);
  // shaft
  add(R, lathe([[0.0055, 0.07], [0.0048, 0.15], [0.0038, 0.26], [0.003, 0.33], [0.0035, 0.336]], 10), silver);
  // gold filigree spiral
  add(R, tubeVar(helixPts(0.0052, 0.08, 0.3, 5, 120, 0, (t) => 0.0058 - t * 0.0022), 0.0009, 120, 3, true), gold);
  add(R, mergeGeos([
    torus(0.0062, 0.0012, 4, 12, Math.PI * 2, { y: 0.15, rx: Math.PI / 2 }),
    torus(0.0048, 0.0011, 4, 12, Math.PI * 2, { y: 0.24, rx: Math.PI / 2 }),
    // prong setting for the gem
    ...[0, 1, 2, 3].map((i) => {
      const a = (i / 4) * Math.PI * 2;
      return tubeVar([V(Math.cos(a) * 0.003, 0.33, Math.sin(a) * 0.003), V(Math.cos(a) * 0.007, 0.34, Math.sin(a) * 0.007), V(Math.cos(a) * 0.004, 0.352, Math.sin(a) * 0.004)], 0.0009, 4, 3, true);
    }),
  ]), gold);
  const H = headGroup(R, 0.33, o.hs ?? 1);
  const gg = crystal(0.03, 0.0065, 6, 3);
  const g1 = gem(H, kit, glows, gg, meta.color, meta.color2, { coreK: 5, opacity: 0.55, coreScale: 0.6 });
  g1.group.position.y = 0.333;
  const halo = haloSprite(kit, meta.color, 0.08, 0.7);
  halo.position.y = 0.35; H.add(halo); glows.add(halo.material, 1);
  const tip = obj(H, 0, 0.365, 0);

  // ---- floating spellbook ------------------------------------------------
  const F = new THREE.Group();
  const book = grp(F);
  const coverMat = kit.leather(0xb070c0);
  const W = 0.105, BH = 0.15;
  const open = 0.25; // half-angle from flat
  const pageMat = kit.plain(0xcbb68c, 0.9);
  const sides = [];
  for (const s of [-1, 1]) {
    const side = grp(book);
    side.rotation.z = s * open;
    // cover board
    add(side, roundedBox(W, 0.006, BH, 0.0025, 1), coverMat, { x: s * W / 2, y: -0.012 });
    // page block, bowed toward the spine
    const pb = new THREE.BoxGeometry(W - 0.008, 0.012, BH - 0.01, 8, 1, 1);
    const pp = pb.getAttribute('position');
    for (let i = 0; i < pp.count; i++) {
      const x = pp.getX(i) + (W - 0.008) / 2; // 0..W
      if (pp.getY(i) > 0) pp.setY(i, pp.getY(i) + Math.sin((x / (W - 0.008)) * Math.PI) * 0.004 - (1 - x / (W - 0.008)) * 0.004);
    }
    pb.computeVertexNormals();
    add(side, pb, pageMat, { x: s * (W / 2 - 0.002) });
    // gold corners
    add(side, mergeGeos([
      xf(new THREE.BoxGeometry(0.018, 0.008, 0.018), { x: s * (W - 0.006), y: -0.012, z: BH / 2 - 0.006 }),
      xf(new THREE.BoxGeometry(0.018, 0.008, 0.018), { x: s * (W - 0.006), y: -0.012, z: -BH / 2 + 0.006 }),
    ]), gold);
    // glowing page surface
    const pm = new THREE.MeshStandardMaterial({ map: pageTexture(s > 0 ? 2 : 3), emissive: C(meta.color), emissiveMap: pageGlowTexture(s > 0 ? 2 : 3), emissiveIntensity: 2.2, roughness: 0.85 });
    pm.userData.glowStd = { base: 2.2 };
    glows.add(pm, 1);
    const pg = new THREE.PlaneGeometry(W - 0.01, BH - 0.014, 6, 1);
    const ppp = pg.getAttribute('position');
    for (let i = 0; i < ppp.count; i++) {
      const x = ppp.getX(i) + (W - 0.01) / 2;
      ppp.setZ(i, Math.sin((x / (W - 0.01)) * Math.PI) * 0.004 - (1 - x / (W - 0.01)) * 0.004);
    }
    pg.computeVertexNormals();
    pg.rotateX(-Math.PI / 2);
    if (s < 0) pg.scale(-1, 1, 1);
    add(side, pg, pm, { x: s * (W / 2 - 0.002), y: 0.0065 });
    sides.push(side);
  }
  add(book, xf(new THREE.CylinderGeometry(0.012, 0.012, BH, 10, 1, false, Math.PI / 2, Math.PI), { rx: Math.PI / 2, y: -0.012 }), coverMat);
  // fluttering loose pages
  const flutter = [];
  const fpm = new THREE.MeshStandardMaterial({ map: pageTexture(4), emissive: C(meta.color), emissiveMap: pageGlowTexture(4), emissiveIntensity: 1.6, roughness: 0.85, side: THREE.DoubleSide });
  fpm.userData.glowStd = { base: 1.6 }; glows.add(fpm, 1);
  const fg = new THREE.PlaneGeometry(W - 0.012, BH - 0.016, 4, 1);
  fg.translate((W - 0.012) / 2, 0, 0);
  fg.rotateX(-Math.PI / 2);
  for (let i = 0; i < (detail >= 1 ? 3 : 1); i++) {
    const pv = grp(book, { y: 0.006 });
    add(pv, fg, fpm);
    flutter.push({ pv, ph: i * 0.37 });
  }
  // rune ring below the book + motes
  const ringTex = runeRingTexture(7);
  const rm = glows.add(kit.glow(meta.color, 1.5, { additive: true, map: ringTex, side: THREE.DoubleSide }), 1);
  const ring = add(F, new THREE.PlaneGeometry(0.2, 0.2), rm, { y: -0.045, rx: -Math.PI / 2, ro: 4 });
  const bh = haloSprite(kit, meta.color, 0.25, 0.35);
  F.add(bh); glows.add(bh.material, 1);
  const moteMat = glows.add(kit.glow(meta.color2, 3), 1);
  const motes = [];
  for (let i = 0; i < (detail >= 1 ? 5 : 2); i++) motes.push(add(F, new THREE.OctahedronGeometry(0.003), moteMat));

  return {
    right: R, rightGrip: { kind: 'pole', r: 0.0095 }, hold: 'wand', tip,
    light: { color: meta.color, pos: V(0, 0.33, 0) },
    float: F,
    hands: {
      R: { style: 'bare', skin: kit.skin(0xe0b8a0), nail: kit.plain(0xd8b0a8, 0.4), rings: [{ finger: 2, seg: 0, mat: gold, gem: kit.plain(0x8030c0, 0.2) }, { finger: 0, seg: 0, mat: silver }] },
      L: { style: 'bare', skin: kit.skin(0xe0b8a0), nail: kit.plain(0xd8b0a8, 0.4), rings: [{ finger: 1, seg: 0, mat: gold }] },
    },
    leftGrip: { kind: 'open' },
    update(t, dt, st) {
      book.position.y = Math.sin(t * 1.6) * 0.008;
      book.rotation.set(-0.5 + Math.sin(t * 1.1) * 0.05, Math.sin(t * 0.7) * 0.08, Math.sin(t * 0.9) * 0.04);
      flutter.forEach((f) => {
        const p = ((t * (0.35 + st.charge * 0.8) + f.ph) % 1);
        // flip from right (open) to left, with a curl-ish wobble
        const a = p < 0.7 ? THREE.MathUtils.smootherstep(p / 0.7, 0, 1) : 1;
        f.pv.rotation.z = open + a * (Math.PI - 2 * open) + Math.sin(t * 9 + f.ph * 10) * 0.05;
        f.pv.visible = p < 0.72;
      });
      ring.rotation.z = t * 0.4;
      motes.forEach((m, i) => {
        const a = t * 0.8 + i * 1.3;
        const q = (t * 0.3 + i * 0.21) % 1;
        m.position.set(Math.cos(a) * 0.08, -0.03 + q * 0.12, Math.sin(a) * 0.06);
        m.scale.setScalar(Math.sin(q * Math.PI));
      });
      g1.group.rotation.y = t * 0.8;
    },
  };
}

// ---------------------------------------------------------------------------
export function necromancer(kit, meta, o) {
  const { glows, detail } = o;
  const R = new THREE.Group();
  const bone = kit.bone(0xd8d0c0);
  const bone2 = kit.bone(0xb0a890);
  const iron = kit.darkIron();
  // fused long bones down the staff
  const longBone = (y0, y1, r) => {
    const h = y1 - y0;
    const g = lathe([[0, 0], [r * 1.6, 0.004], [r * 1.9, h * 0.04], [r * 1.3, h * 0.1], [r, h * 0.3], [r * 0.95, h * 0.6], [r * 1.25, h * 0.9], [r * 1.9, h * 0.96], [r * 1.5, h - 0.003], [0, h]], 12);
    g.translate(0, y0, 0);
    uvs(g, 1, h * 3);
    return noisify(g, 0.0012, 90, Math.round(y0 * 100), 2);
  };
  add(R, mergeGeos([longBone(-1.02, -0.52, 0.015), longBone(-0.54, -0.1, 0.0155), longBone(-0.12, 0.22, 0.0158)]), bone);
  // dark cloth strips binding the joints
  add(R, mergeGeos([
    wrapGeo(0.024, -0.56, -0.5, 3, 0.0035, 4),
    wrapGeo(0.024, -0.14, -0.08, 3, 0.0035, 4),
    wrapGeo(0.024, 0.19, 0.24, 3, 0.0035, 4),
  ]), kit.cloth(0x2a2a22));
  add(R, gripWrapGeo(0.0168, -0.07, 0.075, detail >= 1 ? 10 : 6, 0.0032), kit.leather(0x3a3a30));
  // vertebrae column up to the skull
  const vert = [];
  const NV = 6;
  for (let i = 0; i < NV; i++) {
    const y = 0.235 + i * 0.026;
    const s = 1 - i * 0.04;
    vert.push(xf(lathe([[0, 0], [0.017, 0.002], [0.019, 0.008], [0.016, 0.016], [0.018, 0.02], [0, 0.021]], 10), { y, s }));
    // spinous process & transverse processes
    vert.push(xf(new THREE.ConeGeometry(0.0055, 0.03, 5), { x: 0, y: y + 0.01, z: -0.024 * s, rx: -Math.PI / 2 - 0.4, s }));
    vert.push(xf(new THREE.ConeGeometry(0.004, 0.022, 5), { x: 0.02 * s, y: y + 0.012, rz: -Math.PI / 2 - 0.2, s }));
    vert.push(xf(new THREE.ConeGeometry(0.004, 0.022, 5), { x: -0.02 * s, y: y + 0.012, rz: Math.PI / 2 + 0.2, s }));
  }
  add(R, mergeGeos(vert), bone2);
  const H = headGroup(R, 0.37, o.hs ?? 1);
  // rib claws cradling the skull
  const ribs = [];
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    const pts = [[0.012, 0.37], [0.038, 0.39], [0.05, 0.42], [0.046, 0.455], [0.034, 0.47]].map(([r, y]) => V(Math.cos(a) * r, y, Math.sin(a) * r));
    ribs.push(tubeVar(pts, (t) => 0.0042 * (1 - t * 0.55), 12, 5, true));
  }
  add(H, mergeGeos(ribs), bone2);
  // the skull
  const sk = skullParts(0.42, detail);
  const skull = grp(H, { y: 0.435 });
  add(skull, sk.bone, bone);
  add(skull, sk.sockets, kit.void());
  const eyeMat = glows.add(kit.glow(meta.color, 6), 1);
  const eyes = [sk.eyeL, sk.eyeR].map((p) => add(skull, sphere(0.0055, 8, 6), eyeMat, { x: p.x, y: p.y, z: p.z - 0.004 }));
  // soul-fire wisps rising from the eyes
  const wisps = [];
  for (const p of [sk.eyeL, sk.eyeR]) {
    const f = new FlameCluster(kit, meta.color, meta.color2, { count: 2, size: 0.016, spread: 0.002, seed: 5 + wisps.length, intensity: 2.2 });
    f.group.position.copy(p);
    skull.add(f.group);
    f.materials.forEach((m) => glows.add(m, 1));
    wisps.push(f);
  }
  const halo = haloSprite(kit, meta.color, 0.14, 0.18);
  halo.position.y = 0.44; H.add(halo); glows.add(halo.material, 1);
  // iron collar + hanging chain bits
  add(R, mergeGeos([torus(0.02, 0.004, 6, 16, Math.PI * 2, { y: 0.225, rx: Math.PI / 2 }), xf(new THREE.ConeGeometry(0.016, 0.045, 6), { y: -1.04, rx: Math.PI })]), iron);
  const tip = obj(H, 0, 0.44, 0.04);

  // ---- skull lantern held in the left hand ---------------------------------
  const L = new THREE.Group();
  if (o.view) L.scale.setScalar(1.3);
  add(L, torus(0.026, 0.0035, 6, 18, Math.PI * 2, { ry: 0 }), iron).rotation.y = Math.PI / 2;
  const pivot = grp(L, { y: -0.03 });
  const chain = [];
  for (let i = 0; i < 3; i++) chain.push(torus(0.007, 0.0016, 4, 10, Math.PI * 2, { y: -i * 0.011, ry: i % 2 ? Math.PI / 2 : 0, sx: 0.8, sy: 1.3, sz: 1 }));
  add(pivot, mergeGeos(chain), iron);
  const lan = grp(pivot, { y: -0.04 });
  const cage = [
    lathe([[0, 0.012], [0.006, 0.012], [0.03, -0.004], [0.032, -0.01], [0, -0.012]], 8),
    lathe([[0, -0.098], [0.032, -0.098], [0.034, -0.09], [0.028, -0.084], [0, -0.084]], 8),
    xf(new THREE.ConeGeometry(0.007, 0.022, 6), { y: -0.108, rx: Math.PI }),
  ];
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    cage.push(tubeVar([V(Math.cos(a) * 0.029, -0.01, Math.sin(a) * 0.029), V(Math.cos(a) * 0.034, -0.05, Math.sin(a) * 0.034), V(Math.cos(a) * 0.029, -0.088, Math.sin(a) * 0.029)], 0.0018, 6, 4, true));
  }
  add(lan, mergeGeos(cage), iron);
  const ls = skullParts(0.2, 0.5);
  const lsk = grp(lan, { y: -0.055 });
  add(lsk, ls.bone, bone);
  add(lsk, ls.sockets, eyeMat);
  const lf = new FlameCluster(kit, meta.color, meta.color2, { count: 4, size: 0.03, spread: 0.008, seed: 12, intensity: 2.4 });
  lf.group.position.y = -0.045;
  lan.add(lf.group); lf.materials.forEach((m) => glows.add(m, 1));
  const lg = shellGlass(kit, meta.color);
  add(lan, new THREE.CylinderGeometry(0.03, 0.03, 0.07, 6, 1, true), lg, { y: -0.048, ro: 3 });
  glows.add(lg, 0.4);
  const lh = haloSprite(kit, meta.color, 0.16, 0.6);
  lh.position.y = -0.05; lan.add(lh); glows.add(lh.material, 1);
  const pend = new Pendulum(22, 2.6);

  return {
    right: R, rightGrip: { kind: 'pole', r: 0.0165 }, hold: 'staff', tip,
    light: { color: meta.color, pos: V(0, 0.43, 0) },
    left: L, leftGrip: { kind: 'pole', r: 0.0045 }, leftHold: 'lantern',
    leftLight: { obj: lan, pos: V(0, -0.05, 0) },
    hands: {
      R: { style: 'bare', skin: kit.skin(0xa8b0a0), nail: kit.plain(0x1a1a18, 0.4) },
      L: { style: 'bare', skin: kit.skin(0xa8b0a0), nail: kit.plain(0x1a1a18, 0.4) },
    },
    update(t, dt, st) {
      const f = 0.85 + 0.15 * flick(t, 4) + st.charge * 0.8;
      eyeMat.color.set(meta.color).multiplyScalar(6 * f * st.glow);
      wisps.forEach((w, i) => w.update(t + i * 3, 1 + st.charge));
      lf.update(t, 1);
      eyes.forEach((e) => e.scale.setScalar(0.9 + 0.2 * f));
      skull.rotation.y = Math.sin(t * 0.5) * 0.12 + (st.view ? -0.5 : 0);
      skull.rotation.x = Math.sin(t * 0.37) * 0.05;
      pend.step(dt, st.accelL ?? V(), 0.9);
      hangFrom(pivot, st.up, pend.ax + Math.sin(t * 1.3) * 0.04, pend.az + Math.sin(t * 1.1) * 0.03);
      lan.rotation.y = Math.sin(t * 0.6) * 0.3;
    },
  };
}

function shellGlass(kit, color) {
  return kit.shell(color, 0.22, 0.25);
}

// ---------------------------------------------------------------------------
export function bloodmage(kit, meta, o) {
  const { glows, detail } = o;
  const R = new THREE.Group();
  const steel = kit.metal(0xc0c4cc, 0.9);
  const gold = kit.gold();
  // grip
  add(R, cyl(0.0115, 0.0125, 0.13, 10), kit.leather(0x2a1414)).position.y = -0.068;
  add(R, gripWrapGeo(0.0118, -0.06, 0.055, detail >= 1 ? 9 : 5, 0.0028), kit.leather(0x1a0c0c));
  // guard: gold crescent with downturned horns
  const guard = [];
  guard.push(tubeVar([V(-0.05, 0.085, 0), V(-0.035, 0.072, 0), V(-0.015, 0.068, 0), V(0, 0.07, 0), V(0.015, 0.068, 0), V(0.035, 0.072, 0), V(0.05, 0.085, 0)], (t) => 0.0045 * (1 - Math.abs(t - 0.5) * 1.2) + 0.0015, 20, 6, true));
  guard.push(lathe([[0.012, 0.06], [0.017, 0.064], [0.016, 0.072], [0.01, 0.076]], 10));
  add(R, mergeGeos(guard), gold);
  // curved ritual blade (extruded, bevelled)
  const s = new THREE.Shape();
  const bl = 0.25;
  s.moveTo(-0.016, 0);
  s.bezierCurveTo(-0.02, bl * 0.35, -0.006, bl * 0.72, 0.034, bl);
  s.bezierCurveTo(0.012, bl * 0.7, 0.02, bl * 0.35, 0.016, 0);
  s.lineTo(-0.016, 0);
  const bg = new THREE.ExtrudeGeometry(s, { depth: 0.002, bevelEnabled: true, bevelThickness: 0.0022, bevelSize: 0.004, bevelSegments: 1, curveSegments: detail >= 1 ? 18 : 8 });
  bg.translate(0, 0.075, -0.001);
  uvs(bg, 5, 5);
  add(R, bg, steel);
  // blood channel: glowing groove that follows the curve
  const chan = [];
  for (let i = 0; i <= 10; i++) {
    const t = i / 10;
    const b = new THREE.Vector2();
    // approximate centre line of the blade
    const x = -0.002 + Math.pow(t, 2.2) * 0.026 - t * 0.004;
    b.set(x, 0.085 + t * bl * 0.8);
    chan.push(V(b.x, b.y, 0));
  }
  const chanMat = glows.add(kit.glow(meta.color, 1.5), 1);
  const cg = tubeVar(chan, (t) => 0.0016 * (1 - t * 0.6), 20, 4, true);
  add(R, cg, chanMat, { z: 0.0032, sz: 0.4 });
  add(R, cg, chanMat, { z: -0.0032, sz: 0.4 });
  // ruby pommel in gold prongs
  const rg = flat(new THREE.OctahedronGeometry(0.016, 1));
  rg.scale(1, 1.3, 1);
  const ruby = gem(R, kit, glows, rg, meta.color, 0xff3050, { coreK: 4.5, opacity: 0.6, coreScale: 0.6 });
  ruby.group.position.y = -0.155;
  const pr = [lathe([[0.008, -0.13], [0.014, -0.135], [0.013, -0.14], [0.006, -0.142]], 10)];
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2;
    pr.push(tubeVar([V(Math.cos(a) * 0.008, -0.135, Math.sin(a) * 0.008), V(Math.cos(a) * 0.016, -0.15, Math.sin(a) * 0.016), V(Math.cos(a) * 0.009, -0.168, Math.sin(a) * 0.009)], 0.0016, 6, 4, true));
  }
  add(R, mergeGeos(pr), gold);
  const halo = haloSprite(kit, meta.color, 0.08, 0.6);
  halo.position.y = -0.155; R.add(halo); glows.add(halo.material, 1);
  const tip = obj(R, 0.03, 0.075 + bl, 0);
  const pommelTip = obj(R, 0, -0.155, 0);
  void pommelTip;

  return {
    right: R, rightGrip: { kind: 'pole', r: 0.012 }, hold: 'dagger', tip, lightAnchor: obj(R, -0.05, 0.0, 0.05),
    light: { color: meta.color, pos: V(0, 0.1, 0) },
    hands: {
      R: { style: 'glove', glove: kit.glove(0x2a2222), cuff: kit.glove(0x1a1212) },
      L: { style: 'bare', skin: kit.skin(0xd8b0a0, veinTexture(5), meta.color, 1.3), nail: kit.plain(0x4a1010, 0.3) },
    },
    leftGrip: { kind: 'open' },
    leftFx(hand) {
      // re-register the shared skin (emissive veins) so it pulses with power
      const veinMat = hand.meshes[0].material;
      const vm = veinMat.clone();
      vm.userData = { glowStd: { base: 1.3 } };
      hand.meshes.forEach((m) => { if (m.material === veinMat) m.material = vm; });
      glows.add(vm, 1);
      const dropMat = new THREE.MeshStandardMaterial({ color: 0x5a0008, roughness: 0.15, metalness: 0.1, emissive: C(meta.color), emissiveIntensity: 0.6 });
      dropMat.userData.glowStd = { base: 0.6 }; glows.add(dropMat, 0.5);
      const dg = sphere(0.0035, 8, 6);
      const src = [hand.tips[0], hand.tips[1], hand.tips[2], hand.palmCenter];
      const drops = src.map((s, i) => ({ m: add(hand.group, dg, dropMat), s, ph: i * 0.29, off: V() }));
      const inv = new THREE.Matrix4(), w = V(), down = V();
      const h = haloSprite(kit, meta.color, 0.12, 0.35);
      h.position.set(0, -0.03, -0.06); hand.group.add(h); glows.add(h.material, 1);
      return {
        update(t, k) {
          hand.group.updateWorldMatrix(true, true);
          inv.copy(hand.group.matrixWorld).invert();
          // world down expressed in hand space
          down.set(0, -1, 0).transformDirection(inv);
          drops.forEach((d) => {
            const p = (t * 0.55 + d.ph) % 1;
            d.s.getWorldPosition(w).applyMatrix4(inv);
            const fall = p < 0.55 ? 0 : (p - 0.55) / 0.45;
            const grow = Math.min(1, p / 0.5);
            d.m.position.copy(w).addScaledVector(down, 0.004 + fall * fall * 0.25);
            d.m.scale.set(grow, grow * (1 + fall * 1.8), grow);
            d.m.visible = fall < 0.95;
          });
        },
      };
    },
    update(t, dt, st) {
      const f = 0.8 + 0.2 * Math.sin(t * 2.2) + st.charge;
      ruby.core.color.set(0xff3050).multiplyScalar(4.5 * f * st.glow);
      chanMat.color.set(meta.color).multiplyScalar(1.5 * (0.8 + 0.4 * Math.sin(t * 2.2 - 0.6)) * st.glow * (1 + st.charge));
      ruby.group.rotation.y = t * 0.5;
    },
  };
}

// ---------------------------------------------------------------------------
export function chronomancer(kit, meta, o) {
  const { glows, detail } = o;
  const R = new THREE.Group();
  const brass = kit.brass();
  const gold = kit.gold();
  add(R, cyl(0.0125, 0.0145, 1.42, 12), brass).position.y = -1.0;
  add(R, gripWrapGeo(0.014, -0.075, 0.075, detail >= 1 ? 10 : 6, 0.0035), kit.cloth(0x1a5a58));
  const deco = [
    lathe([[0.0145, 0.075], [0.019, 0.082], [0.019, 0.092], [0.014, 0.1]], 12),
    lathe([[0.014, -0.1], [0.019, -0.092], [0.019, -0.082], [0.0145, -0.075]], 12),
    lathe([[0.013, 0.3], [0.02, 0.31], [0.018, 0.33], [0.024, 0.36], [0.016, 0.38], [0.012, 0.39]], 14),
    xf(new THREE.ConeGeometry(0.016, 0.05, 8), { y: -1.025, rx: Math.PI }),
  ];
  for (let i = 0; i < 5; i++) deco.push(torus(0.0135, 0.0018, 4, 12, Math.PI * 2, { y: -0.3 + i * 0.12, rx: Math.PI / 2 }));
  add(R, mergeGeos(deco), brass);
  const H = headGroup(R, 0.375, o.hs ?? 1);
  // fork arms up to the gyroscope pivots (along X)
  const fork = [];
  for (const s of [-1, 1]) {
    fork.push(tubeVar([V(s * 0.006, 0.375, 0), V(s * 0.04, 0.4, 0), V(s * 0.085, 0.46, 0), V(s * 0.09, 0.52, 0), V(s * 0.082, 0.545, 0)], (t) => 0.0042 * (1 - t * 0.4), 18, 6, true));
    fork.push(sphere(0.0065, 8, 6, { x: s * 0.0835, y: 0.52 }));
  }
  add(H, mergeGeos(fork), brass);
  // gyroscope rings
  const C0 = V(0, 0.52, 0);
  const ringGeo = (rad, ticks) => {
    const parts = [torus(rad, 0.0032, 6, 40)];
    parts.push(torus(rad - 0.006, 0.0014, 4, 40));
    for (let i = 0; i < ticks; i++) {
      const a = (i / ticks) * Math.PI * 2;
      parts.push(xf(new THREE.BoxGeometry(0.003, 0.009, 0.006), { x: Math.cos(a) * (rad - 0.003), y: Math.sin(a) * (rad - 0.003), rz: a + Math.PI / 2 }));
    }
    return mergeGeos(parts);
  };
  const outer = grp(H, { y: C0.y });
  add(outer, ringGeo(0.078, 24), brass);
  const mid = grp(outer);
  add(mid, ringGeo(0.066, 12), gold);
  const inner = grp(mid);
  add(inner, ringGeo(0.055, 8), brass);
  // gems on the rings
  const gm = glows.add(kit.glow(meta.color, 3.5), 1);
  const gsph = new THREE.OctahedronGeometry(0.0045);
  for (const [g, rad] of [[outer, 0.078], [mid, 0.066], [inner, 0.055]]) {
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + 0.4;
      add(g, gsph, gm, { x: Math.cos(a) * rad, y: Math.sin(a) * rad, z: 0 });
    }
  }
  // hourglass
  const hg = grp(H, { y: C0.y });
  const hb = [
    lathe([[0, 0.044], [0.024, 0.044], [0.026, 0.048], [0.022, 0.052], [0.008, 0.054], [0.004, 0.06], [0, 0.06]], 14),
    lathe([[0, -0.06], [0.004, -0.06], [0.008, -0.054], [0.022, -0.052], [0.026, -0.048], [0.024, -0.044], [0, -0.044]], 14),
  ];
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    hb.push(lathe([[0.003, -0.044], [0.0022, -0.02], [0.0032, 0], [0.0022, 0.02], [0.003, 0.044]], 6).translate(Math.cos(a) * 0.021, 0, Math.sin(a) * 0.021));
  }
  add(hg, mergeGeos(hb), gold);
  const glass = kit.shell(0xd0fff8, 0.25, 0.15);
  glows.add(glass, 0.3);
  const bulbProf = [[0.002, 0], [0.006, 0.006], [0.015, 0.018], [0.017, 0.03], [0.012, 0.041], [0.004, 0.044]];
  const bulb = lathe(bulbProf, 16);
  add(hg, bulb, glass, { ro: 3 });
  add(hg, bulb.clone().scale(1, -1, 1), glass, { ro: 3 }).geometry.computeVertexNormals();
  const sandMat = glows.add(kit.glow(meta.color2, 2.6), 1);
  const sandTop = add(hg, lathe([[0.002, 0.004], [0.012, 0.016], [0.013, 0.026], [0, 0.028]], 12), sandMat);
  const sandBot = add(hg, lathe([[0, -0.041], [0.013, -0.04], [0.006, -0.028], [0, -0.024]], 12), sandMat);
  const stream = add(hg, cyl(0.0008, 0.0008, 0.04, 4), glows.add(kit.glow(meta.color2, 4), 1));
  stream.position.y = -0.038;
  const coreGlow = glows.add(kit.glow(meta.color, 3), 1);
  add(hg, sphere(0.004, 8, 6), coreGlow);
  const halo = haloSprite(kit, meta.color, 0.26, 0.35);
  halo.position.y = C0.y; H.add(halo); glows.add(halo.material, 1);
  const tip = obj(H, 0, C0.y, 0);
  const ringTex = clockFaceTexture();

  return {
    right: R, rightGrip: { kind: 'pole', r: 0.014 }, hold: 'staff', tip,
    light: { color: meta.color, pos: C0 },
    hands: {
      R: { style: 'fingerless', glove: kit.glove(0x5a4030), skin: kit.skin(0xd8b098), nail: kit.plain(0xc8a090, 0.4), rings: [{ finger: 0, seg: 0, mat: gold }] },
      L: { style: 'fingerless', glove: kit.glove(0x5a4030), skin: kit.skin(0xd8b098), nail: kit.plain(0xc8a090, 0.4), rings: [{ finger: 3, seg: 0, mat: gold }] },
    },
    leftGrip: { kind: 'open' },
    leftFx(hand) {
      const g = new THREE.Group();
      g.position.set(0, -0.05, -0.06);
      g.rotation.x = Math.PI;
      const fm = glows.add(kit.glow(meta.color, 1.3, { additive: true, map: ringTex, side: THREE.DoubleSide }), 1);
      const face = add(g, new THREE.PlaneGeometry(0.13, 0.13), fm, { rx: -Math.PI / 2, ro: 4, y: 0.02 });
      const handM = glows.add(kit.glow(meta.color2, 2.2, { additive: true }), 1);
      const hh = grp(g, { y: 0.022 });
      const hr = add(hh, xf(new THREE.BoxGeometry(0.0025, 0.0008, 0.04), { z: -0.016 }), handM);
      const mr = add(hh, xf(new THREE.BoxGeometry(0.002, 0.0008, 0.055), { z: -0.024 }), handM);
      const gears = [];
      const gmat = glows.add(kit.glow(meta.color, 2.4, { additive: true }), 1);
      const geos = [gear(10, 0.011, 0.014, 0.002, 0.005), gear(7, 0.007, 0.0095, 0.002, 0.003), gear(12, 0.013, 0.016, 0.002, 0.007)];
      for (let i = 0; i < (detail >= 1 ? 4 : 2); i++) gears.push(add(g, geos[i % 3], gmat, { ro: 5 }));
      hand.group.add(g);
      return {
        update(t) {
          face.rotation.z = -t * 0.15;
          hr.rotation.y = -t * 0.3; mr.rotation.y = -Math.floor(t * 2) * 0.1;
          gears.forEach((gr, i) => {
            const a = t * 0.9 + (i / gears.length) * Math.PI * 2;
            gr.position.set(Math.cos(a) * 0.06, 0.03 + Math.sin(t * 1.5 + i) * 0.012, Math.sin(a) * 0.06);
            gr.rotation.set(Math.PI / 2 + Math.sin(t + i) * 0.4, 0, t * (i % 2 ? 2 : -2));
          });
        },
      };
    },
    update(t, dt, st) {
      const sp = 1 + st.charge * 3 + st.power;
      outer.rotation.x = t * 0.35 * sp;
      mid.rotation.y = t * 0.6 * sp;
      inner.rotation.x = -t * 0.9 * sp;
      inner.rotation.z = t * 0.4;
      // sand trickles: top shrinks, bottom grows, then the glass flips
      const cyc = (t * 0.12) % 1;
      sandTop.scale.set(1, Math.max(0.05, 1 - cyc), 1);
      sandBot.scale.set(1, 0.1 + cyc * 0.9, 1);
      hg.rotation.z = cyc > 0.94 ? ((cyc - 0.94) / 0.06) * Math.PI : 0;
      coreGlow.color.set(meta.color).multiplyScalar(3 * (0.85 + 0.15 * Math.sin(t * 3)) * st.glow * (1 + st.charge));
    },
  };
}
