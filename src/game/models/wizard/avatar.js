import * as THREE from 'three';
import { CLASS_META } from '../../classMeta.js';
import { getKit, GlowSet } from './kit.js';
import { buildHand, bakeHand, gripPose, POSES, clonePose } from './hand.js';
import { buildFocus } from './foci.js';
import { buildHat } from './hats.js';
import { V, lathe, sphere, torus, roundedBox, mergeGeos, xf, mulberry, uvs, tubeVar, cyl, withLOD } from './shapes.js';
import { add, grp } from './common.js';
import { wob } from './fx.js';

// ---------------------------------------------------------------------------
// Third-person avatar (seen by co-op teammates). Origin at the feet, facing
// +Z, ~1.85 m tall. Procedural skeleton of groups with damped pose blending,
// distance-driven walk cycle, cast / downed / dead poses, a CPU-deformed
// layered robe skirt and cape, glowing eyes in a shadowed face.
// ---------------------------------------------------------------------------

const TAU = Math.PI * 2;
const CAPE = { necromancer: 1, warlock: 1, spellblade: 1, lightbinder: 1, chronomancer: 1, cryomancer: 1, druid: 1 };

// joint helper: rotation damped toward a target each frame
class Joint {
  constructor(group) { this.g = group; this.t = new THREE.Vector3(); this.c = new THREE.Vector3(); }
  set(x = 0, y = 0, z = 0) { this.t.set(x, y, z); return this; }
  add(x = 0, y = 0, z = 0) { this.t.x += x; this.t.y += y; this.t.z += z; return this; }
  step(k) {
    this.c.lerp(this.t, k);
    this.g.rotation.set(this.c.x, this.c.y, this.c.z);
  }
}

function skirtGeo(rTop, rBot, yTop, yBot, gapFront, seed, seg = 34, rows = 12, ps = null, pl = null) {
  const phiStart = ps ?? gapFront / 2, phiLen = pl ?? TAU - gapFront;
  const prof = [];
  for (let i = 0; i <= rows; i++) {
    const t = i / rows;
    const r = rTop + (rBot - rTop) * Math.pow(t, 0.8) + Math.sin(t * Math.PI) * 0.015;
    prof.push([r, yTop + (yBot - yTop) * t]);
  }
  prof.reverse(); // bottom to top for lathe
  const g = uvs(lathe(prof, seg, phiStart, phiLen), 2.5, 2.5);
  const p = g.getAttribute('position');
  const rnd = mulberry(seed);
  const J = Array.from({ length: seg + 1 }, () => rnd());
  // per-vertex: height factor and ragged hem
  const hf = new Float32Array(p.count);
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i);
    const t = (yTop - y) / (yTop - yBot);
    hf[i] = t;
    const col = i % (seg + 1);
    let yy = y;
    if (t > 0.999) yy -= J[col] * 0.06 + (col % 2) * 0.02;
    // folds
    const x = p.getX(i), z = p.getZ(i);
    const a = Math.atan2(x, z);
    const fold = 1 + Math.sin(a * 9 + rnd() * 0.2) * 0.035 * t;
    p.setXYZ(i, x * fold, yy, z * fold * 0.92);
  }
  g.computeVertexNormals();
  g.userData.hf = hf;
  g.userData.base = Float32Array.from(p.array);
  return g;
}

function capeGeo(w0, w1, h, seed) {
  const cols = 10, rows = 14;
  const pos = [], uv = [], idx = [];
  const rnd = mulberry(seed);
  for (let j = 0; j <= rows; j++) {
    const t = j / rows;
    const w = w0 + (w1 - w0) * t;
    for (let i = 0; i <= cols; i++) {
      const u = i / cols - 0.5;
      const a = u * 2.2;
      let y = -t * h;
      if (j === rows) y -= rnd() * 0.07;
      pos.push(Math.sin(a) * w * 0.5, y, -Math.cos(a) * 0.12 * (1 + t * 0.6) - t * 0.03);
      uv.push(i / cols * 2, t * 3);
    }
  }
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
    const a = j * (cols + 1) + i, b = a + cols + 1;
    idx.push(a, b, a + 1, b, b + 1, a + 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  g.userData.base = Float32Array.from(pos);
  g.userData.cols = cols; g.userData.rows = rows;
  return g;
}

export function createAvatar(classId, ctx) {
  const meta = CLASS_META[classId] ?? CLASS_META.pyromancer;
  const kit = getKit(ctx.factory);
  const glows = new GlowSet();
  const F = withLOD(0.5, () => buildFocus(classId, kit, meta, { glows, detail: 0.5, view: false, hs: 1.12 }));
  if (F.right) F.right.name = 'focusR';
  if (F.left) F.left.name = 'focusL';
  if (F.float) F.float.name = 'float';

  const root = new THREE.Group();
  root.name = `avatar:${classId}`;
  const body = grp(root);
  const robe = kit.cloth(meta.robe);
  const robeDS = kit.clothDS(meta.robe);
  const trim = kit.cloth(meta.trim);
  const trimDS = kit.clothDS(meta.trim);
  const leather = kit.leather(0x4a3424);
  const darkCloth = kit.cloth(new THREE.Color(meta.robe).multiplyScalar(0.5).getHex());
  const gold = kit.gold();

  // ---------------- skeleton ----------------
  const hips = grp(body, { y: 0.95 });
  const spine = grp(hips, { y: 0.04 });
  const chest = grp(spine, { y: 0.24 });
  const neck = grp(chest, { y: 0.24 });
  const head = grp(neck, { y: 0.11 });
  const legs = [1, -1].map((s) => {
    const thigh = grp(hips, { x: s * 0.095, y: -0.03 });
    const knee = grp(thigh, { y: -0.44 });
    const ankle = grp(knee, { y: -0.42 });
    return { s, thigh, knee, ankle, jT: new Joint(thigh), jK: new Joint(knee), jA: new Joint(ankle) };
  });
  const arms = [1, -1].map((s) => {
    const shoulder = grp(chest, { x: s * 0.19, y: 0.17, z: -0.01 });
    const elbow = grp(shoulder, { y: -0.28 });
    const wrist = grp(elbow, { y: -0.25 });
    return { s, shoulder, elbow, wrist, jS: new Joint(shoulder), jE: new Joint(elbow), jW: new Joint(wrist) };
  });
  const [armL, armR] = arms;
  const [legL, legR] = legs;
  const jHips = new Joint(hips), jSpine = new Joint(spine), jChest = new Joint(chest), jNeck = new Joint(neck), jHead = new Joint(head);

  // ---------------- torso ----------------
  const torsoProf = [[0.15, -0.06], [0.158, 0.05], [0.165, 0.16], [0.18, 0.3], [0.19, 0.4], [0.185, 0.46], [0.15, 0.52], [0.08, 0.56], [0.06, 0.58]];
  const torso = uvs(lathe(torsoProf, 26), 2, 1.5);
  torso.scale(1, 1, 0.7);
  add(spine, torso, robe);
  // front trim band and lapels
  const band = lathe(torsoProf.map(([r, y]) => [r * 1.02, y]), 4, -0.1, 0.2);
  band.scale(1, 1, 0.7);
  add(spine, band, trim);
  // belt, buckle, pouches, vial
  add(hips, xf(lathe([[0.168, 0.02], [0.172, 0.03], [0.172, 0.075], [0.168, 0.085]], 24), { sz: 0.74 }), leather);
  add(hips, xf(roundedBox(0.05, 0.045, 0.014, 0.004, 1), { y: 0.052, z: 0.13 }), gold);
  const pouch = (x, z, ry, w = 0.07) => xf(roundedBox(w, 0.075, 0.04, 0.012, 2), { x, y: 0.01, z, ry });
  add(hips, mergeGeos([pouch(0.15, 0.06, 1.2), pouch(-0.13, 0.08, -1.0, 0.06), pouch(0.08, -0.1, 2.6, 0.08)]), leather);
  add(hips, mergeGeos([xf(roundedBox(0.075, 0.016, 0.044, 0.006, 1), { x: 0.15, y: 0.05, z: 0.06, ry: 1.2 }), xf(roundedBox(0.065, 0.016, 0.044, 0.006, 1), { x: -0.13, y: 0.05, z: 0.08, ry: -1.0 })]), kit.leather(0x2a1c12));
  const vialMat = glows.add(kit.glow(meta.color, 1.4), 1);
  add(hips, xf(cyl(0.011, 0.013, 0.05, 8), { x: -0.165, y: -0.03, z: -0.02 }), vialMat);
  add(hips, xf(cyl(0.006, 0.006, 0.014, 6), { x: -0.165, y: 0.02, z: -0.02 }), kit.wood(0x6a4a30));

  // ---------------- layered robe skirt ----------------
  const skirtO = skirtGeo(0.168, 0.32, 0.08, -0.72, 0.55, 3, 28, 9);
  const skirtI = skirtGeo(0.16, 0.29, 0.04, -0.68, 0.0, 5, 24, 8);
  const skirtOM = add(hips, skirtO, robeDS);
  const innerCol = new THREE.Color(meta.robe).multiplyScalar(0.6).lerp(new THREE.Color(meta.trim), 0.18).getHex();
  const skirtIM = add(hips, skirtI, kit.clothDS(innerCol));
  skirtOM.name = 'skirt'; skirtIM.name = 'skirt';
  // trim strips along the edges of the front split
  const strips = [skirtGeo(0.172, 0.325, 0.08, -0.72, 0, 3, 2, 9, 0.24, 0.07), skirtGeo(0.172, 0.325, 0.08, -0.72, 0, 3, 2, 9, TAU - 0.31, 0.07)];
  strips.forEach((g) => { add(hips, g, trimDS).name = 'skirt'; });
  void skirtOM; void skirtIM;
  // trim strip along the hem of the outer skirt
  // (handled by the darker inner layer showing through the front split)

  // ---------------- legs ----------------
  for (const L of legs) {
    add(L.thigh, xf(lathe([[0.075, 0.02], [0.07, -0.2], [0.058, -0.44]], 10), {}), darkCloth);
    add(L.knee, lathe([[0.056, 0.02], [0.05, -0.2], [0.042, -0.38]], 10), darkCloth);
    // boot
    const boot = mergeGeos([
      lathe([[0.05, 0.12], [0.056, 0.2], [0.05, 0.22]], 10).translate(0, -0.42, 0),
      lathe([[0.046, -0.06], [0.05, 0.0], [0.052, 0.12]], 10),
      xf(roundedBox(0.085, 0.06, 0.2, 0.025, 2), { y: -0.04, z: 0.055 }),
    ]);
    add(L.ankle, boot, kit.leather(0x2e2018));
    add(L.ankle, xf(roundedBox(0.09, 0.016, 0.21, 0.006, 1), { y: -0.07, z: 0.055 }), kit.leather(0x1a120c));
  }

  // ---------------- arms ----------------
  const sleeveMat = robeDS;
  for (const A of arms) {
    add(A.shoulder, sphere(0.058, 12, 8, { sy: 0.9 }), robe);
    add(A.shoulder, lathe([[0.058, 0.02], [0.056, -0.12], [0.05, -0.28]], 12), robe);
    // bell sleeve flaring toward the wrist with a trimmed cuff
    const bell = lathe([[0.048, 0.02], [0.054, -0.08], [0.066, -0.18], [0.08, -0.255], [0.076, -0.262]], 14);
    add(A.elbow, bell, sleeveMat);
    add(A.elbow, xf(torus(0.078, 0.008, 5, 16), { rx: Math.PI / 2, y: -0.258 }), trim);
    add(A.elbow, lathe([[0.04, -0.08], [0.032, -0.25]], 10), kit.plain(0x0a0808, 1));
  }
  // shoulder pieces from the hat (geomancer pauldrons)

  // ---------------- hands ----------------
  const handOpts = (h) => ({ ...h, detail: 0.5 });
  const rawR = withLOD(0.6, () => buildHand(handOpts(F.hands.R)));
  const rg = F.rightGrip ?? { kind: 'pole', r: 0.016 };
  let gripR = null;
  if (rg.kind === 'pole') {
    const gp = gripPose(rg.r);
    rawR.setPose(gp.pose);
    gripR = { pos: gp.gripPos, q: new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, Math.PI / 2)) };
  } else rawR.setPose(clonePose(POSES[rg.kind] ?? POSES.relaxed));
  const handR = bakeHand(rawR);
  handR.group.name = 'handR';
  const lgp = F.leftGrip ?? { kind: 'open' };
  const rawL = withLOD(0.6, () => buildHand(handOpts(F.hands.L)));
  let gripL = null;
  if (lgp.kind === 'pole') {
    const gp = gripPose(lgp.r);
    rawL.setPose(gp.pose);
    gripL = { pos: gp.gripPos, q: new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, Math.PI / 2)) };
  } else rawL.setPose(clonePose(POSES[lgp.kind === 'spread' ? 'open' : lgp.kind] ?? POSES.relaxed));
  const handL = bakeHand(rawL);
  handL.group.name = 'handL';
  // hand frames: the hand model's fingers run along -Z; in the arm, fingers
  // should continue down the arm (-Y), palm facing the body
  const handFrameR = grp(armR.wrist, { y: -0.03 });
  handFrameR.rotation.set(-Math.PI / 2, 0, 0);
  const handHolderR = grp(handFrameR, { rz: Math.PI / 2, s: 1.18 });
  handHolderR.add(handR.group);
  const handFrameL = grp(armL.wrist, { y: -0.03 });
  handFrameL.rotation.set(-Math.PI / 2, 0, 0);
  const mirrorL = grp(handFrameL); mirrorL.scale.x = -1;
  const handHolderL = grp(mirrorL, { rz: Math.PI / 2, s: 1.18 });
  handHolderL.add(handL.group);

  // focus in the right hand
  let gripFrameR = null;
  if (F.right) {
    if (gripR) {
      gripFrameR = new THREE.Group();
      gripFrameR.position.copy(gripR.pos);
      gripFrameR.quaternion.copy(gripR.q);
      handR.group.add(gripFrameR);
      gripFrameR.add(F.right);
    } else handR.group.add(F.right);
  }
  let gripFrameL = null;
  if (F.left) {
    if (gripL) {
      gripFrameL = new THREE.Group();
      gripFrameL.position.copy(gripL.pos);
      gripFrameL.quaternion.copy(gripL.q);
      handL.group.add(gripFrameL);
      gripFrameL.add(F.left);
    } else handL.group.add(F.left);
  }
  let floatG = null;
  if (F.float) { floatG = new THREE.Group(); floatG.add(F.float); floatG.scale.setScalar(1.1); root.add(floatG); }
  const fxL = F.leftFx ? withLOD(0.5, () => F.leftFx(handL)) : null;
  const fxR = F.rightFx ? withLOD(0.5, () => F.rightFx(handR)) : null;
  const muzzle = F.tip ?? (F.handTip ? F.handTip(handR) : handR.palmCenter);

  // ---------------- head ----------------
  const hat = withLOD(0.6, () => buildHat(classId, kit, meta, glows));
  const faceTone = new THREE.Color(F.hands?.L?.skin?.color ?? 0x8a6a5a).multiplyScalar(0.5).getHex();
  const faceMat = kit.plain(new THREE.Color(faceTone).multiplyScalar(0.55).getHex(), 0.8);
  add(neck, cyl(0.045, 0.05, 0.12, 10), faceMat, { y: -0.02 });
  if (hat.face !== 'mask') {
    const skull = sphere(0.094, 18, 14, { sy: 1.08, sz: 1.02 });
    add(head, skull, faceMat);
    add(head, xf(new THREE.ConeGeometry(0.014, 0.04, 6), { rx: Math.PI / 2 + 0.3, y: -0.01, z: 0.098 }), faceMat);
    add(head, xf(roundedBox(0.08, 0.04, 0.05, 0.015, 1), { y: -0.07, z: 0.05 }), faceMat);
    // brow shadow
    add(head, xf(roundedBox(0.1, 0.018, 0.03, 0.008, 1), { y: 0.03, z: 0.083, rx: 0.2 }), faceMat);
  }
  if (hat.beard) {
    const bd = lathe([[0.0, -0.25], [0.02, -0.22], [0.05, -0.14], [0.07, -0.07], [0.075, -0.03], [0.06, 0.0]], 14, -Math.PI * 0.6, Math.PI * 1.2);
    bd.scale(1, 1, 0.7);
    add(head, bd, kit.fur(hat.beard), { y: -0.02, z: 0.035, rx: 0.15 });
    add(head, xf(torus(0.03, 0.009, 6, 12, Math.PI), { y: -0.035, z: 0.09, rz: Math.PI }), kit.fur(hat.beard));
  }
  hat.group.name = 'hat';
  head.add(hat.group);
  // glowing eyes
  const eyeMat = glows.add(kit.glow(meta.color, 2.8), 1);
  const eyePos = hat.eyePos ?? [V(0.031, 0.01, 0.091), V(-0.031, 0.01, 0.091)];
  const eyes = eyePos.map((p) => add(head, sphere(0.0105, 8, 6, { sy: 0.6 }), eyeMat, { x: p.x, y: p.y, z: p.z }));
  if (hat.shoulders) {
    const [gL, gR, mat] = hat.shoulders;
    add(armL.shoulder, gL, mat, { y: 0.075, x: 0.025, s: 1.25 });
    add(armR.shoulder, gR, mat, { y: 0.075, x: -0.025, s: 1.25 });
  }

  // ---------------- cape ----------------
  let cape = null;
  if (CAPE[classId]) {
    const cg = capeGeo(0.36, 0.62, 1.25, 7);
    cape = add(chest, cg, classId === 'lightbinder' ? kit.clothDS(0xe8e2d4) : trimDS, { y: 0.17, z: -0.02 });
    cape.name = 'cape';
  }

  // ---------------- per-instance materials for flash / tint ----------------
  const cloneMap = new Map();
  root.traverse((o) => {
    if (!o.isMesh) return;
    const m = o.material;
    if (!m.userData.shared || !m.isMeshStandardMaterial) return;
    if (!cloneMap.has(m)) {
      const c = m.clone();
      c.userData = { base: c.color.clone(), baseEmissive: c.emissive ? c.emissive.clone() : null, baseEI: c.emissiveIntensity ?? 1 };
      cloneMap.set(m, c);
    }
    o.material = cloneMap.get(m);
  });
  const clones = [...cloneMap.values()];
  let flashK = 0, tint = null, tintK = 0;
  const tintColor = new THREE.Color();
  function applyMats() {
    for (const c of clones) {
      c.color.copy(c.userData.base);
      if (tint && tintK > 0) c.color.lerp(tintColor, tintK);
      if (c.userData.baseEmissive) c.emissive.copy(c.userData.baseEmissive); else c.emissive.setRGB(0, 0, 0);
      c.emissiveIntensity = c.userData.baseEI;
      if (flashK > 0.001) {
        c.emissive.lerp(new THREE.Color(1, 0.95, 0.9), Math.min(1, flashK));
        c.emissiveIntensity = Math.max(c.emissiveIntensity, 1.5 * flashK);
      }
    }
  }

  // ---------------- animation state ----------------
  let phase = 0, moveK = 0, lastT = 0;
  const st = { charge: 0, power: 0, glow: 1, castK: 0, accelR: V(), accelL: V(), view: false, up: root };
  const bodyPos = V(), bodyRot = V();
  const qa = new THREE.Quaternion(), qb = new THREE.Quaternion(), mtx = new THREE.Matrix4();
  const axis = V(), fwd = V(), side = V();
  const prevHand = V(), velHand = V(), tmp = V();
  const capeBase = cape ? cape.geometry.userData.base : null;
  const skirts = [skirtO, skirtI, ...strips];
  let deadK = 0, downK = 0;

  // align the focus grip frame (pole +Y) to a direction in root space
  const _wq = new THREE.Quaternion(), _gq = new THREE.Quaternion(), _pq = new THREE.Quaternion();
  function aimFocus(arm, gripFrame, dirRoot, upHint) {
    if (!gripFrame) return;
    axis.copy(dirRoot).normalize().transformDirection(root.matrixWorld);
    fwd.copy(upHint).transformDirection(root.matrixWorld);
    side.crossVectors(axis, fwd);
    if (side.lengthSq() < 1e-6) side.set(1, 0, 0);
    side.normalize();
    fwd.crossVectors(side, axis).normalize();
    mtx.makeBasis(side, axis, fwd);
    qa.setFromRotationMatrix(mtx); // desired grip world orientation
    arm.wrist.updateWorldMatrix(true, true);
    arm.wrist.getWorldQuaternion(_wq);
    gripFrame.getWorldQuaternion(_gq);
    // grip relative to wrist, then wrist = desired * inverse(rel)
    qb.copy(_wq).invert().multiply(_gq).invert();
    qa.multiply(qb);
    arm.elbow.getWorldQuaternion(_pq);
    arm.wrist.quaternion.copy(_pq.invert().multiply(qa));
  }

  function update(dt, s = {}) {
    dt = Math.min(Math.max(dt ?? 0.016, 0), 0.05);
    const t = s.t ?? lastT + dt;
    lastT = t;
    const anim = s.anim ?? 'idle';
    const speed = Math.max(0, s.speed ?? 0);
    const pitch = THREE.MathUtils.clamp(s.pitch ?? 0, -1.2, 1.2);
    const strafe = THREE.MathUtils.clamp(s.strafe ?? 0, -1, 1);
    const cp = THREE.MathUtils.clamp(s.castProgress ?? 0, 0, 1);
    const moving = anim === 'move' || (anim === 'cast' && speed > 0.2);
    moveK += ((moving ? Math.min(1, speed / 3) : 0) - moveK) * (1 - Math.exp(-dt * 8));
    phase += (speed * dt * TAU) / 1.7;
    deadK += ((anim === 'dead' ? 1 : 0) - deadK) * (1 - Math.exp(-dt * 5));
    downK += ((anim === 'downed' ? 1 : 0) - downK) * (1 - Math.exp(-dt * 5));
    const k = moveK;
    const breathe = Math.sin(t * 1.7) * 0.012;

    // ---- base targets ----
    jHips.set(0, Math.sin(phase) * 0.1 * k, 0);
    jSpine.set(0.05 + k * 0.12 + breathe * 0.5, -Math.sin(phase) * 0.08 * k, -strafe * 0.12 * k);
    jChest.set(breathe, 0, 0);
    jNeck.set(-pitch * 0.35 - k * 0.08, 0, 0);
    jHead.set(-pitch * 0.45, wob(t * 0.3, 2) * 0.12 * (1 - k), 0);
    for (const L of legs) {
      const p = phase + (L.s > 0 ? 0 : Math.PI);
      const sw = Math.sin(p);
      L.jT.set(-sw * 0.55 * k, 0, L.s * 0.03);
      L.jK.set(0.12 * k + Math.pow(Math.max(0, Math.cos(p)), 1.5) * 0.95 * k + 0.02, 0, 0);
      L.jA.set(-(-sw * 0.55 * k) * 0.3 - 0.1 * k * Math.max(0, -Math.cos(p)), 0, 0);
    }
    // arms: left swings opposite the left leg, right (focus) swings less
    const swing = Math.sin(phase);
    armL.jS.set(swing * 0.45 * k + 0.08, 0, 0.12 + breathe);
    armL.jE.set(-0.25 - k * 0.25, 0, 0);
    armL.jW.set(0, 0, 0);
    armR.jS.set(-0.3 - swing * 0.12 * k, 0, -0.16);
    armR.jE.set(-0.85, 0, 0);
    armR.jW.set(0, 0, 0);
    let focusDir = V(0, 1, 0.08), focusUp = V(0, 0, 1);
    if (F.hold === 'dagger' || F.hold === 'sword' || F.hold === 'wand') { focusDir.set(0, 0.55, 1); focusUp.set(0, 1, 0); }
    if (k > 0.1) focusDir.lerp(V(0, 1, 0.35), k * 0.5);

    // left-hand holds
    if (F.leftHold === 'book') { armL.jS.set(-0.55, 0.3, 0.25); armL.jE.set(-1.35, 0.3, 0); armL.jW.set(0, 0, -0.3); }
    else if (F.leftHold === 'lantern') { armL.jS.set(-0.5 + swing * 0.15 * k, 0, 0.2); armL.jE.set(-0.9, 0, 0); armL.jW.set(0, 0, 1.3); }
    else if (F.leftHold === 'staff') { armL.jS.set(-0.3 + swing * 0.12 * k, 0, 0.16); armL.jE.set(-0.85, 0, 0); }
    else if (F.float) { armL.jS.set(-0.45, 0, 0.25); armL.jE.set(-0.9, 0, 0); armL.jW.set(0, 0, 1.2); }
    else { armL.jS.add(-0.15, 0, 0.1); armL.jE.add(-0.3, 0, 0); armL.jW.set(0, 0, 0.9); }

    // ---- cast ----
    if (anim === 'cast') {
      const wind = THREE.MathUtils.smoothstep(cp, 0, 0.3), thrust = THREE.MathUtils.smoothstep(cp, 0.3, 0.5), rel = THREE.MathUtils.smoothstep(cp, 0.75, 1);
      const a = (wind * 0.6 + thrust * 0.4) * (1 - rel * 0.7);
      armR.jS.set(-0.3 - a * 1.25 - pitch * a, 0.15 * a, -0.16 + a * 0.05);
      armR.jE.set(-0.85 + thrust * 0.6 * (1 - rel), 0, 0);
      jSpine.add(-0.06 * thrust + 0.05 * wind, -0.25 * wind + 0.35 * thrust, 0);
      focusDir.lerp(V(0, 0.35 - pitch * 0.5, 1), Math.min(1, a * 1.4));
      focusUp.set(0, 1, 0);
      if (!F.leftHold && !F.float) { armL.jS.set(-0.6 * a, 0, 0.3); armL.jE.set(-0.6, 0, 0); armL.jW.set(0, 0, 1.4); }
    }

    // ---- downed: kneel on the right knee, left hand on the ground ----
    const bodyY = -0.4 * downK + 0.14 * deadK;
    if (downK > 0.01) {
      const d = downK;
      legR.jT.t.lerp(V(-0.05, 0, 0.04), d); legR.jK.t.lerp(V(1.6, 0, 0), d); legR.jA.t.lerp(V(0.6, 0, 0), d);
      legL.jT.t.lerp(V(-1.45, 0, 0.1), d); legL.jK.t.lerp(V(1.4, 0, 0), d); legL.jA.t.lerp(V(0.05, 0, 0), d);
      jSpine.t.lerp(V(0.55, 0.1, 0.05), d); jNeck.t.lerp(V(0.3, 0, 0), d); jHead.t.lerp(V(0.2, 0.2, 0), d);
      armL.jS.t.lerp(V(-0.2, 0, 0.35), d); armL.jE.t.lerp(V(-0.15, 0, 0), d); armL.jW.t.lerp(V(-1.2, 0, 1.4), d);
      armR.jS.t.lerp(V(-0.75, 0, -0.3), d); armR.jE.t.lerp(V(-0.6, 0, 0), d);
      focusDir.lerp(V(0, 1, 0.25), d);
      // tremble
      jSpine.add(wob(t * 30, 3) * 0.01 * d, 0, 0);
    }
    // ---- dead: lying on the back, arms out ----
    if (deadK > 0.01) {
      const d = deadK;
      legL.jT.t.lerp(V(-0.08, 0, 0.12), d); legL.jK.t.lerp(V(0.15, 0, 0), d);
      legR.jT.t.lerp(V(0.02, 0, -0.1), d); legR.jK.t.lerp(V(0.3, 0, 0), d);
      jSpine.t.lerp(V(0, 0, 0), d); jNeck.t.lerp(V(-0.1, 0, 0), d); jHead.t.lerp(V(0, 0.7, 0), d);
      armL.jS.t.lerp(V(-0.2, 0, 1.25), d); armL.jE.t.lerp(V(-0.4, 0, 0), d); armL.jW.t.lerp(V(0, 0, 1.4), d);
      armR.jS.t.lerp(V(-0.1, 0, -1.1), d); armR.jE.t.lerp(V(-0.3, 0, 0), d);
      focusDir.lerp(V(-1, 0, 0.3), d); focusUp.lerp(V(0, 1, 0), d);
    }
    bodyPos.set(0, bodyY, deadK * 0.85);
    bodyRot.set(-deadK * Math.PI / 2, 0, 0);
    body.position.copy(bodyPos);
    body.rotation.set(bodyRot.x, 0, 0);
    // hips height: walk bob, kneel
    hips.position.y = 0.95 - (Math.abs(Math.cos(phase)) - 0.6) * 0.03 * k;

    const kk = 1 - Math.exp(-dt * 14);
    for (const j of [jHips, jSpine, jChest, jNeck, jHead]) j.step(kk);
    for (const L of legs) { L.jT.step(kk); L.jK.step(kk); L.jA.step(kk); }
    for (const A of arms) { A.jS.step(kk); A.jE.step(kk); A.jW.step(kk); }
    root.updateMatrixWorld(true);
    if (gripFrameR) aimFocus(armR, gripFrameR, focusDir, focusUp);
    if (gripFrameL && F.leftHold === 'staff') aimFocus(armL, gripFrameL, V(0, 1, 0.08), V(0, 0, 1));
    root.updateMatrixWorld(true);

    // ---- cloth: skirt follows the legs, trails when moving; cape sways ----
    const kneeZL = Math.sin(-legL.jT.c.x) * 0.44, kneeZR = Math.sin(-legR.jT.c.x) * 0.44;
    for (const g of skirts) {
      const p = g.getAttribute('position');
      const base = g.userData.base, hf = g.userData.hf;
      for (let i = 0; i < p.count; i++) {
        const bx = base[i * 3], by = base[i * 3 + 1], bz = base[i * 3 + 2];
        const h = hf[i];
        const wl = THREE.MathUtils.clamp(0.5 + bx / 0.25, 0, 1);
        const lz = (wl * kneeZL + (1 - wl) * kneeZR);
        const hh = Math.pow(h, 1.3);
        let dz = hh * lz * 0.85 - hh * h * (moveK * 0.06);
        let dx = -hh * h * strafe * 0.06 * moveK;
        const fl = Math.sin(t * 3.1 + bx * 20 + by * 7) * 0.006 * hh * (0.4 + moveK);
        dz += fl; dx += Math.cos(t * 2.7 + bz * 18) * 0.005 * hh * (0.4 + moveK);
        // kneeling: the hem spreads over the ground
        let dy = 0;
        if (downK > 0.01) { dy += downK * hh * 0.28; dx += downK * bx * hh * 0.6; dz += downK * (bz * hh * 0.6 + hh * 0.15); }
        p.setXYZ(i, bx + dx, by + dy, bz + dz);
      }
      p.needsUpdate = true;
      g.computeVertexNormals();
    }
    if (cape) {
      const g = cape.geometry, p = g.getAttribute('position');
      const { cols, rows } = g.userData;
      const lift = moveK * 0.35 + downK * 0.1;
      for (let j = 0; j <= rows; j++) {
        const tt = j / rows;
        for (let i = 0; i <= cols; i++) {
          const n = j * (cols + 1) + i;
          const bx = capeBase[n * 3], by = capeBase[n * 3 + 1], bz = capeBase[n * 3 + 2];
          const w = Math.sin(t * 2.3 + tt * 4 + i * 0.5) * 0.02 * tt * (0.4 + moveK * 1.5);
          const back = -tt * tt * lift * 0.5 + jSpine.c.x * tt * 0.4;
          p.setXYZ(n, bx + Math.sin(t * 1.7 + j * 0.4) * 0.01 * tt - strafe * tt * 0.08 * moveK, by + tt * tt * lift * 0.2, bz + back + w);
        }
      }
      p.needsUpdate = true;
      g.computeVertexNormals();
    }

    // ---- floating book (arcanist) ----
    if (floatG) {
      armL.wrist.getWorldPosition(tmp);
      root.worldToLocal(tmp);
      tmp.add(V(0.12, 0.12 + Math.sin(t * 1.6) * 0.02, 0.14));
      floatG.position.lerp(tmp, 1 - Math.exp(-dt * 6));
      floatG.rotation.set(0.5, 0.4, 0);
      floatG.visible = deadK < 0.5;
    }

    // ---- glow / fx ----
    handR.group.getWorldPosition(tmp);
    velHand.subVectors(tmp, prevHand).divideScalar(Math.max(dt, 1e-3));
    st.accelR.copy(velHand).multiplyScalar(-0.3);
    st.accelL.copy(st.accelR);
    prevHand.copy(tmp);
    const castGlow = anim === 'cast' ? 1 + THREE.MathUtils.smoothstep(cp, 0.2, 0.45) * (1 - THREE.MathUtils.smoothstep(cp, 0.6, 1)) * 1.5 : 1;
    st.glow = castGlow * (1 - deadK * 0.8);
    st.charge = anim === 'cast' ? Math.min(1, cp * 2) * 0.5 : 0;
    glows.set(st.glow);
    eyeMat.color.set(meta.color).multiplyScalar(2.8 * (1 - deadK * 0.9) * (0.9 + 0.1 * Math.sin(t * 2)));
    F.update?.(t, dt, st);
    fxL?.update(t, 1, dt);
    fxR?.update(t, 1, dt);
    hat.update?.(t);

    // hit flash decays
    if (flashK > 0) { flashK = Math.max(0, flashK - dt * 6); applyMats(); }
  }

  update(0.016, { t: 0 });

  return {
    root, muzzle, height: 1.85,
    update,
    flash(amount = 1) { flashK = Math.max(flashK, amount); applyMats(); },
    setTint(hex, k = 0.5) {
      if (hex === null || hex === undefined) { tint = null; tintK = 0; } else { tint = hex; tintColor.set(hex); tintK = THREE.MathUtils.clamp(k, 0, 1); }
      applyMats();
    },
    dispose() {
      glows.dispose();
      for (const c of clones) c.dispose();
      root.traverse((o) => { if ((o.isMesh || o.isSprite) && o.geometry && !o.geometry.userData?.shared) o.geometry.dispose?.(); });
      root.removeFromParent();
    },
    _parts: { arms, legs, hips, spine, head, F },
  };
}
