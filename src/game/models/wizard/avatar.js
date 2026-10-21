import * as THREE from 'three';
import { CLASS_META } from '../../classMeta.js';
import { getKit, GlowSet } from './kit.js';
import { buildHand, bakeHand, gripPose, POSES, clonePose } from './hand.js';
import { buildFocus } from './foci.js';
import { buildHat } from './hats.js';
import { V, withLOD } from './shapes.js';
import { grp } from './common.js';
import { wob } from './fx.js';
import { Cloth } from './cloth.js';
import { probeDynamic, bakeAvatar, cloneShared } from './batch.js';
import { BODY_Y, SHOULDER_X, HIP_X, SKIRT_TOP, smoothstep as sstep, ringPt, TAU } from './garments.js';
import { getCostume, dress } from './costumes.js';

// ---------------------------------------------------------------------------
// Third-person avatar (seen by co-op teammates, on the class-select screen and
// as the merchant). Origin at the feet, facing +Z, ~1.85 m tall with the hat.
//
//  - skeleton of plain groups with damped Euler joints
//  - a layered costume per class (costumes.js / garments.js) skinned to the
//    skeleton, plus verlet cloth chains (cloth.js) for skirts, capes and
//    dangling trinkets that react to the avatar's real motion
//  - everything static is baked into a handful of SkinnedMeshes (batch.js)
// ---------------------------------------------------------------------------

const SKIRT_N = 12, SKIRT_SEG = 4;

class Joint {
  constructor(group) { this.g = group; this.t = new THREE.Vector3(); this.c = new THREE.Vector3(); }
  set(x = 0, y = 0, z = 0) { this.t.set(x, y, z); return this; }
  add(x = 0, y = 0, z = 0) { this.t.x += x; this.t.y += y; this.t.z += z; return this; }
  mix(x, y, z, w) { const t = this.t; t.x += (x - t.x) * w; t.y += (y - t.y) * w; t.z += (z - t.z) * w; return this; }
  step(k) { this.c.lerp(this.t, k); this.g.rotation.set(this.c.x, this.c.y, this.c.z); }
  snap() { this.c.copy(this.t); this.g.rotation.set(this.c.x, this.c.y, this.c.z); }
}

export function createAvatar(classId, ctx) {
  const meta = CLASS_META[classId] ?? CLASS_META.pyromancer;
  if (!CLASS_META[classId]) classId = 'pyromancer';
  const kit = getKit(ctx.factory);
  const glows = new GlowSet();
  const cos = getCostume(classId, meta);
  const F = withLOD(0.38, () => buildFocus(classId, kit, meta, { glows, detail: 0.5, view: false, hs: 1.12 }));
  if (F.right) F.right.name = 'focusR';
  if (F.left) F.left.name = 'focusL';
  if (F.float) F.float.name = 'float';

  const root = new THREE.Group();
  root.name = `avatar:${classId}`;
  const body = grp(root);
  body.name = 'body';

  // ---------------- skeleton ----------------
  const hips = grp(body, { y: BODY_Y.hips }); hips.name = 'hips';
  const spine = grp(hips, { y: BODY_Y.spine - BODY_Y.hips }); spine.name = 'spine';
  const chest = grp(spine, { y: BODY_Y.chest - BODY_Y.spine }); chest.name = 'chest';
  const neck = grp(chest, { y: BODY_Y.neck - BODY_Y.chest }); neck.name = 'neck';
  const head = grp(neck, { y: BODY_Y.head - BODY_Y.neck }); head.name = 'head';
  const legs = [1, -1].map((s) => {
    const thigh = grp(hips, { x: s * HIP_X, y: BODY_Y.hipJ - BODY_Y.hips }); thigh.name = 'thigh';
    const knee = grp(thigh, { y: BODY_Y.knee - BODY_Y.hipJ }); knee.name = 'knee';
    const ankle = grp(knee, { y: BODY_Y.ankle - BODY_Y.knee }); ankle.name = 'ankle';
    return { s, thigh, knee, ankle, jT: new Joint(thigh), jK: new Joint(knee), jA: new Joint(ankle) };
  });
  const arms = [1, -1].map((s) => {
    const shoulder = grp(chest, { x: s * SHOULDER_X, y: BODY_Y.shoulder - BODY_Y.chest, z: -0.01 }); shoulder.name = 'shoulder';
    shoulder.rotation.order = 'YXZ'; // yaw last: pans a raised arm toward the aim
    const elbow = grp(shoulder, { y: -0.28 }); elbow.name = 'elbow';
    const wrist = grp(elbow, { y: -0.25 }); wrist.name = 'wrist';
    return { s, shoulder, elbow, wrist, jS: new Joint(shoulder), jE: new Joint(elbow), jW: new Joint(wrist) };
  });
  const [armL, armR] = arms;
  const [legL, legR] = legs;
  const jHips = new Joint(hips), jSpine = new Joint(spine), jChest = new Joint(chest), jNeck = new Joint(neck), jHead = new Joint(head);
  const allJoints = [jHips, jSpine, jChest, jNeck, jHead, ...legs.flatMap((l) => [l.jT, l.jK, l.jA]), ...arms.flatMap((a) => [a.jS, a.jE, a.jW])];
  root.updateMatrixWorld(true);

  // ---------------- cloth ----------------
  const cloth = new Cloth(root);
  // skirt ring: chains from the hips down the outermost long layer
  const sk = cos.skirt;
  const hemY = sk.hem;
  const levels = [];
  for (let k = 0; k <= SKIRT_SEG; k++) levels.push(SKIRT_TOP + (hemY - SKIRT_TOP) * (k / SKIRT_SEG));
  const skirtChains = [];
  const RR = { rx: 0, zf: 0, zb: 0 };
  for (let c = 0; c < SKIRT_N; c++) {
    const a = (c / SKIRT_N) * TAU;
    const pts = levels.map((y) => { sk.R(y, RR); const [x, z] = ringPt(RR.rx, RR.zf, RR.zb, a); return V(x, y, z); });
    const ch = cloth.addChain(hips, pts, { name: 'skirt', stiff: sk.stiff ?? 1.2, damp: sk.damp ?? 2.0, r: 0.012, cone: false, wind: sk.wind ?? 1, phase: c * 0.9, gravPose: true, keepOut: 0.86 });
    skirtChains.push(ch);
  }
  cloth.addRing(skirtChains, true, 0.8, 1.35);
  // legs and body for the cloth to collide with
  for (const L of legs) {
    cloth.addCapsule(L.thigh, V(0, 0.02, 0), L.knee, V(0, 0, 0.01), sk.legR ?? 0.1);
    cloth.addCapsule(L.knee, V(0, 0, 0.01), L.ankle, V(0, 0.02, 0.02), (sk.legR ?? 0.1) - 0.015);
  }
  // hull for capes and dangling things: the skirt surface itself
  sk.R(SKIRT_TOP, RR);
  const top = { ...RR };
  sk.R(hemY, RR);
  cloth.addCone(hips, SKIRT_TOP - BODY_Y.hips + 0.45, top.rx * 0.95, top.zb * 0.95, hemY - BODY_Y.hips, RR.rx * 0.9, RR.zb * 0.9);

  // ---------------- skin functions (bind pose, root space) ----------------
  const W = (a, b) => [a, b];
  const shoulderOf = (x) => (x > 0 ? armL.shoulder : armR.shoulder);
  const vblend = (y, list) => {
    // list: [[y, bone], ...] ascending
    if (y <= list[0][0]) return [W(list[0][1], 1)];
    for (let i = 0; i < list.length - 1; i++) {
      const [y0, b0] = list[i], [y1, b1] = list[i + 1];
      if (y <= y1) { const u = sstep(y0, y1, y); return u < 0.001 ? [W(b0, 1)] : u > 0.999 ? [W(b1, 1)] : [W(b0, 1 - u), W(b1, u)]; }
    }
    return [W(list[list.length - 1][1], 1)];
  };
  const TORSO_V = [[1.0, hips], [1.08, spine], [1.19, spine], [1.3, chest], [1.5, chest], [1.555, neck]];
  const skinTorso = (v, shK = 0.6) => {
    const ws = vblend(v.y, TORSO_V);
    const sw = sstep(0.11, 0.2, Math.abs(v.x)) * sstep(1.32, 1.43, v.y) * shK;
    if (sw > 0.001) { for (const w of ws) w[1] *= 1 - sw; ws.push(W(shoulderOf(v.x), sw)); }
    return ws;
  };
  const skinSkirt = (v) => {
    if (v.y >= SKIRT_TOP) return skinTorso(v);
    let a = Math.atan2(v.x, v.z); if (a < 0) a += TAU;
    const f = (a / TAU) * SKIRT_N;
    const c0 = Math.floor(f) % SKIRT_N, c1 = (c0 + 1) % SKIRT_N, u = f - Math.floor(f);
    let s = ((SKIRT_TOP - v.y) / (SKIRT_TOP - hemY)) * SKIRT_SEG;
    s = Math.min(SKIRT_SEG - 1e-4, Math.max(0, s));
    const k = Math.floor(s), fr = s - k;
    const seg = [];
    if (fr < 0.5 && k > 0) seg.push([k, 0.5 + fr], [k - 1, 0.5 - fr]);
    else if (fr >= 0.5 && k < SKIRT_SEG - 1) seg.push([k, 1.5 - fr], [k + 1, fr - 0.5]);
    else seg.push([k, 1]);
    const out = [];
    for (const [kk, w] of seg) {
      out.push(W(skirtChains[c0].bones[kk], w * (1 - u)));
      out.push(W(skirtChains[c1].bones[kk], w * u));
    }
    return out;
  };
  const skinLeg = (side) => { const L = side > 0 ? legL : legR; return (v) => {
    const ws = vblend(v.y, [[BODY_Y.ankle + 0.02, L.ankle], [BODY_Y.ankle + 0.06, L.knee], [BODY_Y.knee - 0.05, L.knee], [BODY_Y.knee + 0.05, L.thigh]]);
    const hk = sstep(0.86, 0.97, v.y) * 0.55;
    if (hk > 0.001) { for (const w of ws) w[1] *= 1 - hk; ws.push(W(hips, hk)); }
    return ws;
  }; };
  const skinMantle = (v) => skinTorso(v, 0.75);
  const skins = { torso: (v) => skinTorso(v), skirt: skinSkirt, leg: skinLeg, mantle: skinMantle };

  // ---------------- hands ----------------
  const handOpts = (h) => ({ ...h, detail: 0.3 });
  const rawR = withLOD(0.45, () => buildHand(handOpts(F.hands.R)));
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
  const rawL = withLOD(0.45, () => buildHand(handOpts(F.hands.L)));
  let gripL = null;
  if (lgp.kind === 'pole') {
    const gp = gripPose(lgp.r);
    rawL.setPose(gp.pose);
    gripL = { pos: gp.gripPos, q: new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, Math.PI / 2)) };
  } else rawL.setPose(clonePose(POSES[lgp.kind === 'spread' ? 'open' : lgp.kind] ?? POSES.relaxed));
  const handL = bakeHand(rawL);
  handL.group.name = 'handL';
  // hand frames: the hand model's fingers run along -Z; in the arm they
  // continue down the arm (-Y) with the palm facing the body
  const handFrameR = grp(armR.wrist, { y: -0.025 });
  handFrameR.rotation.set(-Math.PI / 2, 0, 0);
  const handHolderR = grp(handFrameR, { rz: Math.PI / 2, s: 1.12 });
  handHolderR.add(handR.group);
  const handFrameL = grp(armL.wrist, { y: -0.025 });
  handFrameL.rotation.set(-Math.PI / 2, 0, 0);
  const mirrorL = grp(handFrameL); mirrorL.scale.x = -1;
  const handHolderL = grp(mirrorL, { rz: Math.PI / 2, s: 1.12 });
  handHolderL.add(handL.group);

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
  if (F.float) { floatG = new THREE.Group(); floatG.name = 'floatG'; floatG.add(F.float); floatG.scale.setScalar(1.1); root.add(floatG); }
  const fxL = F.leftFx ? withLOD(0.5, () => F.leftFx(handL)) : null;
  const fxR = F.rightFx ? withLOD(0.5, () => F.rightFx(handR)) : null;
  const muzzle = F.tip ?? (F.handTip ? F.handTip(handR) : handR.palmCenter);

  // ---------------- hat ----------------
  const hat = withLOD(0.5, () => buildHat(classId, kit, meta, glows, { mantle: false }));
  hat.group.name = 'hat';
  head.add(hat.group);

  // ---------------- costume ----------------
  const parts = [];
  const bones = { root, body, hips, spine, chest, neck, head, armL, armR, legL, legR, arms, legs };
  const D = { kit, meta, glows, classId, cos, hat, F, bones, skins, cloth, parts, skirtChains, levels,
    add(mat, geo, skin, ro = 0) {
      if (!geo) return;
      if (typeof skin === 'function') parts.push({ geo, mat, skin, ro, label: D.sec });
      else parts.push({ geo, mat, bone: skin ?? root, ro, label: D.sec });
    },
  };
  const dressed = dress(D);
  const eyeMat = dressed.eyeMat;
  // hood drapes stay on the shoulders when the head turns
  for (const m of hat.drape ?? []) {
    m.userData.reskin = {
      bones: [chest],
      fn: (v) => { const w = sstep(BODY_Y.neck + 0.08, BODY_Y.neck - 0.07, v.y); return w < 0.001 ? [[m, 1]] : [[m, 1 - w], [chest, w]]; },
    };
  }

  // ---------------- animation state ----------------
  let phase = 0, moveK = 0, lastT = 0, deadK = 0, downK = 0, castK = 0, idleT = 0;
  const st = { charge: 0, power: 0, glow: 1, castK: 0, accelR: V(), accelL: V(), view: false, up: root };
  const hipsBase = hips.position.clone();
  const qa = new THREE.Quaternion(), qb = new THREE.Quaternion(), mtx = new THREE.Matrix4();
  const axis = V(), fwd = V(), side = V(), tmp = V(), tmp2 = V();
  const prevHand = V(), velHand = V();
  const focusDir = V(), focusUp = V(), leftDir = V(0, 1, 0.08), leftUp = V(0, 0, 1);
  const wpos = V(), wprev = V(), wvel = V(), lvel = V(), flow = V(), rq = new THREE.Quaternion(), rs = V();
  let haveprev = false;
  const prevRq = new THREE.Quaternion();
  const _wq = new THREE.Quaternion(), _gq = new THREE.Quaternion(), _pq = new THREE.Quaternion();
  const FLASH = new THREE.Color(1, 0.95, 0.9);
  const hold = F.hold ?? 'staff';
  const lhold = F.leftHold ?? (F.float ? 'float' : null);

  // align the focus grip frame (pole +Y) to a direction in root space
  function aimFocus(arm, gripFrame, dirRoot, upHint) {
    if (!gripFrame) return;
    axis.copy(dirRoot).normalize().transformDirection(root.matrixWorld);
    fwd.copy(upHint).transformDirection(root.matrixWorld);
    side.crossVectors(axis, fwd);
    if (side.lengthSq() < 1e-6) side.set(1, 0, 0);
    side.normalize();
    fwd.crossVectors(side, axis).normalize();
    mtx.makeBasis(side, axis, fwd);
    qa.setFromRotationMatrix(mtx);
    arm.wrist.updateWorldMatrix(true, true);
    arm.wrist.getWorldQuaternion(_wq);
    gripFrame.getWorldQuaternion(_gq);
    qb.copy(_wq).invert().multiply(_gq).invert();
    qa.multiply(qb);
    arm.elbow.getWorldQuaternion(_pq);
    arm.wrist.quaternion.copy(_pq.invert().multiply(qa));
  }

  function resetState() {
    phase = 0; moveK = 0; lastT = 0; deadK = 0; downK = 0; castK = 0; idleT = 0; haveprev = false;
    for (const j of allJoints) { j.t.set(0, 0, 0); j.c.set(0, 0, 0); }
    hips.position.copy(hipsBase);
    cloth.first = true;
  }

  // ---------------- per-frame update ----------------
  function update(dt, s = {}) {
    dt = Math.min(Math.max(dt ?? 0.016, 0), 0.05);
    const t = s.t ?? lastT + dt;
    lastT = t;
    const anim = s.anim ?? 'idle';
    const speed = Math.max(0, s.speed ?? 0);
    const pitch = THREE.MathUtils.clamp(s.pitch ?? 0, -1.2, 1.2);
    const cp = THREE.MathUtils.clamp(s.castProgress ?? 0, 0, 1);

    // ---- locomotion from the root's real motion (falls back to the stated speed)
    root.updateWorldMatrix(true, false);
    const me = root.matrixWorld.elements;
    wpos.set(me[12], me[13], me[14]);
    root.matrixWorld.decompose(tmp, rq, rs);
    const wscale = rs.x;
    if (haveprev && dt > 1e-4) {
      tmp.subVectors(wpos, wprev).divideScalar(dt);
      if (tmp.lengthSq() > 400) tmp.set(0, 0, 0);
      wvel.lerp(tmp, 1 - Math.exp(-dt * 10));
    } else wvel.set(0, 0, 0);
    // a huge turn in one frame (teleport / respawn / spawn facing): snap the cloth
    if (haveprev && rq.angleTo(prevRq) > 1.0) cloth.first = true;
    prevRq.copy(rq);
    wprev.copy(wpos); haveprev = true;
    lvel.copy(wvel).applyQuaternion(qa.copy(rq).invert()).divideScalar(wscale || 1);
    lvel.y = 0;
    const moving = anim === 'move' || (anim === 'cast' && speed > 0.4);
    const lsp = Math.hypot(lvel.x, lvel.z);
    // walk direction in avatar space: measured, or straight ahead + strafe
    let dirX = 0, dirZ = 1;
    if (lsp > Math.max(0.3, speed * 0.35)) { dirX = lvel.x / lsp; dirZ = lvel.z / lsp; } else { const sf = THREE.MathUtils.clamp(s.strafe ?? 0, -1, 1); dirX = sf * 0.7; dirZ = Math.sqrt(1 - dirX * dirX); }
    // virtual air flow when the stated speed exceeds the measured one (viewer, lag)
    const expZ = moving ? speed : 0;
    flow.set((dirX * expZ - lvel.x) * (moving ? 1 : 0), 0, dirZ * expZ - lvel.z * (moving ? 1 : 0));
    if (!moving) flow.set(0, 0, 0);
    flow.applyQuaternion(rq).multiplyScalar(-2.2);
    moveK += ((moving ? Math.min(1, speed / 2.6) : 0) - moveK) * (1 - Math.exp(-dt * 7));
    phase += (speed * dt * TAU) / (1.45 + 0.22 * Math.min(speed, 7));
    deadK += ((anim === 'dead' ? 1 : 0) - deadK) * (1 - Math.exp(-dt * 4.5));
    downK += ((anim === 'downed' ? 1 : 0) - downK) * (1 - Math.exp(-dt * 5));
    castK += ((anim === 'cast' ? 1 : 0) - castK) * (1 - Math.exp(-dt * 12));
    const k = moveK;
    const still = (1 - k) * (1 - downK) * (1 - deadK);
    idleT += dt * still;

    // ---- idle: breathing, weight shift, looking around
    const br = Math.sin(t * 1.55);
    const ws = Math.sin(idleT * 0.42 + 0.6) * 0.8 + Math.sin(idleT * 0.17) * 0.2; // >0: weight on the right leg
    const look = wob(t * 0.23, 2), look2 = wob(t * 0.17, 5);
    jHips.set(0, 0, -0.03 * ws * still);
    jSpine.set(0.035 + br * 0.006, 0, 0.035 * ws * still);
    jChest.set(-0.015 - br * 0.018, 0, 0.012 * ws * still);
    jNeck.set(-pitch * 0.35 + 0.05, look * 0.1 * still, 0);
    jHead.set(-pitch * 0.45 + 0.04 * look2 * still, look * 0.2 * still, -0.02 * ws * still);
    hips.position.set(hipsBase.x - 0.018 * ws * still, hipsBase.y, hipsBase.z);
    const wR = Math.max(0, ws), wL = Math.max(0, -ws);
    legL.jT.set(-0.07 * wR * still, 0, 0.03 + 0.03 * ws * still);
    legL.jK.set(0.04 + 0.16 * wR * still, 0, 0);
    legL.jA.set(0.03 - 0.06 * wR * still, 0, -0.03 * ws * still);
    legR.jT.set(-0.07 * wL * still, 0, -0.03 + 0.03 * ws * still);
    legR.jK.set(0.04 + 0.16 * wL * still, 0, 0);
    legR.jA.set(0.03 - 0.06 * wL * still, 0, -0.03 * ws * still);

    // ---- arms at rest: staff held upright, off hand by its hold
    const swing = Math.sin(phase);
    const brA = br * 0.012;
    armR.jS.set(-0.14, 0.12, -0.13 - brA);
    armR.jE.set(-1.0, 0.05, 0);
    armR.jW.set(0, 0, 0);
    focusDir.set(0.05, 1, 0.07); focusUp.set(0, 0, 1);
    if (hold === 'dagger' || hold === 'sword') { armR.jS.set(-0.1, 0.05, -0.12 - brA); armR.jE.set(-0.5, 0.3, 0); focusDir.set(0.2, -0.55, 1); focusUp.set(0, 1, 0); }
    else if (hold === 'wand') { armR.jS.set(-0.1, 0.1, -0.1 - brA); armR.jE.set(-0.75, 0.2, 0); focusDir.set(0.1, 0.45, 1); focusUp.set(0, 1, 0); }
    else if (hold === 'claw') { armR.jS.set(-0.05, 0.1, -0.16 - brA); armR.jE.set(-0.5, 0.2, 0); armR.jW.set(0.2, 0, 0.3); }
    else if (hold === 'fist') { armR.jS.set(0.0, 0.05, -0.2 - brA); armR.jE.set(-0.3, 0.1, 0); armR.jW.set(0, 0, 0.2); }
    armL.jS.set(0.06, 0, 0.11 + brA);
    armL.jE.set(-0.32, 0, 0);
    armL.jW.set(0, 0, 0.5);
    if (lhold === 'book') { armL.jS.set(-0.5, 0.35, 0.22); armL.jE.set(-1.35, 0.25, 0); armL.jW.set(0, 0, -0.3); }
    else if (lhold === 'lantern') { armL.jS.set(-0.3, 0, 0.25 + brA); armL.jE.set(-0.75, 0, 0); armL.jW.set(0, 0, 1.3); }
    else if (lhold === 'staff') { armL.jS.set(-0.14, -0.12, 0.13 + brA); armL.jE.set(-1.0, -0.05, 0); }
    else if (lhold === 'cradle') { armL.jS.set(-0.2, 0.15, 0.2 + brA); armL.jE.set(-1.25, 0.6, 0); armL.jW.set(0.2, 0, 1.2); }
    else if (lhold === 'float') { armL.jS.set(-0.4, 0, 0.24); armL.jE.set(-0.95, 0, 0); armL.jW.set(0, 0, 1.2); }

    // ---- walk / run: legs follow the movement direction, arms counter-swing
    if (k > 0.001) {
      const A = (0.42 + 0.12 * Math.min(1, speed / 4)) * k;
      for (let li = 0; li < 2; li++) {
        const L = legs[li];
        const p = phase + (L.s > 0 ? 0 : Math.PI);
        const sw = Math.sin(p), cs = Math.cos(p);
        L.jT.add(-sw * A * dirZ, 0, sw * A * dirX * 0.75);
        L.jK.add((Math.pow(Math.max(0, cs * Math.sign(dirZ || 1)), 1.4) * 1.0 + 0.1) * k, 0, 0);
        L.jA.add((sw * A * 0.3 - 0.15 * Math.max(0, -cs)) * k, 0, 0);
      }
      jHips.add(0, swing * 0.11 * k * dirZ, 0);
      jSpine.add(0.08 * k * Math.min(1, speed / 3) * dirZ, -swing * 0.09 * k * dirZ, -dirX * 0.06 * k);
      jChest.add(0, -swing * 0.05 * k * dirZ, 0);
      hips.position.y += (Math.abs(Math.cos(phase)) - 0.55) * 0.035 * k;
      // free arm swings opposite its leg; the staff arm swings a little
      if (!lhold) armL.jS.add(swing * 0.5 * k * dirZ, 0, 0.04 * k), armL.jE.add(-0.25 * k - Math.max(0, -swing) * 0.35 * k, 0, 0);
      else armL.jS.add(swing * 0.12 * k, 0, 0);
      armR.jS.add(-swing * 0.16 * k * dirZ - 0.08 * k, 0, 0);
      if (hold === 'staff') focusDir.lerp(tmp.set(0.05, 1, 0.35), k * 0.5);
    }

    // ---- cast: big readable poses, by what the class holds
    if (castK > 0.001) {
      const wind = sstep(0, 0.28, cp), thrust = sstep(0.26, 0.46, cp), rel = sstep(0.72, 1, cp);
      const a = Math.min(1, wind * 0.55 + thrust * 0.45) * (1 - rel * 0.85);
      const w = castK;
      const tr = cp > 0.45 && cp < 0.75 ? wob(t * 25, 1) * 0.015 : 0;
      const up = pitch;
      if (hold === 'staff' || hold === 'wand') {
        // raise the focus back, then thrust it toward the target
        const sx = -0.3 - wind * 1.5 + thrust * (0.35 - up * 0.7), ez = -1.0 + wind * 0.4 + thrust * 0.4;
        armR.jS.mix(sx + tr, 0.2 + thrust * 0.15, -0.2 + thrust * 0.12, w * (1 - rel * 0.85));
        armR.jE.mix(ez, 0.1, 0, w * (1 - rel * 0.85));
        focusDir.lerp(tmp.set(0.0, 1.0 - thrust * (0.8 + up * 0.4), 0.15 + thrust * 1.1), w * a * 1.2 > 1 ? 1 : w * a * 1.2);
        focusUp.lerp(tmp.set(0, thrust, 1 - thrust), w * a);
        jSpine.add((-0.08 * wind + 0.22 * thrust) * a * w, (-0.3 * wind + 0.4 * thrust) * w * a, 0);
        jChest.add(-0.05 * wind * w, (-0.15 * wind + 0.12 * thrust) * w * a, 0);
      } else if (hold === 'dagger' || hold === 'sword') {
        // overhead slash across the body
        armR.jS.mix(-2.5 + thrust * 1.7, -0.3 + thrust * 0.9, -0.55 + thrust * 0.85, w * (1 - rel * 0.85));
        armR.jE.mix(-1.2 + thrust * 1.0, 0, 0, w * (1 - rel * 0.85));
        focusDir.lerp(tmp.set(-0.2 + thrust * 0.5, 1 - thrust * 1.4, 0.2 + thrust * 0.8), w * a);
        focusUp.lerp(tmp.set(0, 0, 1), w * a);
        jSpine.add(0.2 * thrust * a * w, (-0.45 * wind + 0.9 * thrust) * a * w, 0);
      } else if (hold === 'claw' || hold === 'fist') {
        // pull back, then drive the hand forward
        armR.jS.mix(0.35 - wind * 0.2 - thrust * (1.85 + up * 0.8) + tr, 0.15 + thrust * 0.2, -0.3 + thrust * 0.15, w * (1 - rel * 0.85));
        armR.jE.mix(-1.7 + thrust * 1.6, 0.2, 0, w * (1 - rel * 0.85));
        armR.jW.mix(0.3 * thrust, 0, 0.4, w * a);
        jSpine.add(0.18 * thrust * a * w, (-0.4 * wind + 0.45 * thrust) * a * w, 0);
      }
      // the striking arm counter-rotates the torso twist so it lands on the aim line
      if (hold !== 'dagger' && hold !== 'sword') armR.jS.add(0, -(jSpine.t.y + jChest.t.y) * 0.9, 0);
      // off hand pushes forward unless it is busy
      if (!lhold || lhold === 'cradle') {
        armL.jS.mix(-0.25 - wind * 0.4 - thrust * (0.7 + up * 0.5), -0.3 * thrust, 0.3 - 0.1 * thrust, w * a);
        armL.jE.mix(-1.1 + thrust * 0.75, 0, 0, w * a);
        armL.jW.mix(-0.9 * thrust, 0, 1.4, w * a);
      } else if (lhold === 'book') { armL.jS.add(-0.35 * a * w, 0, 0); armL.jE.add(-0.2 * a * w, 0, 0); }
      else if (lhold === 'float') { armL.jS.add(-0.5 * a * w, 0, 0); }
      // lunge onto the left foot
      const lg = thrust * a * w;
      legL.jT.add(-0.42 * lg, 0, 0); legL.jK.add(0.5 * lg, 0, 0); legL.jA.add(-0.08 * lg, 0, 0);
      legR.jT.add(0.28 * lg, 0, -0.04 * lg); legR.jK.add(0.22 * lg, 0, 0); legR.jA.add(0.2 * lg, 0, 0);
      hips.position.y -= 0.05 * lg;
      hips.position.z += 0.03 * lg;
      jHead.add(-0.1 * lg, -(jSpine.t.y + jChest.t.y) * 0.8, 0);
    }

    // ---- downed: kneel on the right knee, propped on the left hand / staff
    if (downK > 0.01) {
      const d = downK;
      const tr = wob(t * 30, 3) * 0.012 * d;
      legR.jT.mix(-0.08, 0, 0.05, d); legR.jK.mix(1.62, 0, 0, d); legR.jA.mix(0.65, 0, 0, d);
      legL.jT.mix(-1.42, 0, 0.12, d); legL.jK.mix(1.38, 0, 0, d); legL.jA.mix(0.05, 0, 0, d);
      jSpine.mix(0.5 + tr, 0.12, 0.05, d); jChest.mix(0.12, 0, 0, d); jNeck.mix(0.32, 0, 0, d); jHead.mix(0.22, 0.25, 0, d);
      armL.jS.mix(-0.25, 0, 0.32, d); armL.jE.mix(-0.12, 0, 0, d); armL.jW.mix(-1.2, 0, 1.4, d);
      armR.jS.mix(-0.85, 0, -0.32, d); armR.jE.mix(-0.55, 0, 0, d);
      focusDir.lerp(tmp.set(0, 1, 0.3), d);
    }
    // ---- dead: on the back, arms flung out
    if (deadK > 0.01) {
      const d = deadK;
      legL.jT.mix(-0.1, 0, 0.14, d); legL.jK.mix(0.18, 0, 0, d); legL.jA.mix(0.5, 0, 0.1, d);
      legR.jT.mix(0.02, 0, -0.12, d); legR.jK.mix(0.32, 0, 0, d); legR.jA.mix(0.5, 0, -0.1, d);
      jSpine.mix(0, 0, 0, d); jChest.mix(0, 0, 0, d); jNeck.mix(-0.12, 0, 0, d); jHead.mix(0, 0.75, 0, d); jHips.mix(0, 0, 0, d);
      armL.jS.mix(-0.25, 0, 1.25, d); armL.jE.mix(-0.45, 0, 0, d); armL.jW.mix(0, 0, 1.4, d);
      armR.jS.mix(-0.12, 0, -1.1, d); armR.jE.mix(-0.3, 0, 0, d);
      focusDir.lerp(tmp.set(-1, 0, 0.3), d); focusUp.lerp(tmp.set(0, 1, 0), d);
    }
    const bodyY = -0.45 * downK + 0.13 * deadK;
    body.position.set(0, bodyY, deadK * 0.88);
    body.rotation.set(-deadK * Math.PI / 2, 0, 0);
    hips.position.z += downK * 0.06;

    const kk = 1 - Math.exp(-dt * 13);
    for (let i = 0; i < allJoints.length; i++) allJoints[i].step(kk);
    // no full-tree update before aiming: aimFocus refreshes the arm chain it
    // reads itself, and the pass below brings every node up to date (each
    // full pass over ~150 nodes was a third of an avatar's frame)
    if (gripFrameR) aimFocus(armR, gripFrameR, focusDir, focusUp);
    if (gripFrameL && lhold === 'staff') aimFocus(armL, gripFrameL, leftDir, leftUp);
    root.updateMatrixWorld(true);

    // ---- cloth
    cloth.flow.copy(flow);
    cloth.gravK = Math.max(downK, deadK);
    cloth.wind.set(Math.sin(t * 0.21) * 0.6 + 0.5, 0, Math.cos(t * 0.17) * 0.5).multiplyScalar(cos.wind ?? 1).applyQuaternion(rq);
    cloth.step(dt, wscale, wpos.y, t);
    // a chain's bones are nested: updating the first refreshes the whole chain
    for (let i = 0; i < cloth.chains.length; i++) { const bs = cloth.chains[i].bones; if (bs.length) bs[0].updateMatrixWorld(true); }

    // ---- floating book (arcanist)
    if (floatG) {
      armL.wrist.getWorldPosition(tmp);
      root.worldToLocal(tmp);
      tmp.add(tmp2.set(0.12, 0.12 + Math.sin(t * 1.6) * 0.02, 0.14));
      floatG.position.lerp(tmp, 1 - Math.exp(-dt * 6));
      floatG.rotation.set(0.5, 0.4, 0);
      floatG.visible = deadK < 0.5;
    }

    // ---- glow / fx
    handR.group.getWorldPosition(tmp);
    velHand.subVectors(tmp, prevHand).divideScalar(Math.max(dt, 1e-3));
    if (velHand.lengthSq() > 400) velHand.set(0, 0, 0);
    st.accelR.copy(velHand).multiplyScalar(-0.3);
    st.accelL.copy(st.accelR);
    prevHand.copy(tmp);
    const castGlow = anim === 'cast' ? 1 + sstep(0.2, 0.45, cp) * (1 - sstep(0.6, 1, cp)) * 1.5 : 1;
    st.glow = castGlow * (1 - deadK * 0.8);
    st.charge = anim === 'cast' ? Math.min(1, cp * 2) * 0.5 : 0;
    glows.set(st.glow);
    if (eyeMat) eyeMat.color.copy(eyeMat.userData.glow.base).multiplyScalar(eyeMat.userData.glow.intensity * (1 - deadK * 0.9) * (0.9 + 0.1 * Math.sin(t * 2)));
    F.update?.(t, dt, st);
    fxL?.update(t, 1, dt);
    fxR?.update(t, 1, dt);
    hat.update?.(t);
    dressed.update?.(t, dt);

    if (flashK > 0) { flashK = Math.max(0, flashK - dt * 6); applyMats(); }
    baked?.syncVisibility();
  }

  // ---------------- probe dynamic meshes, then bake ----------------
  let flashK = 0, tint = null, tintK = 0, baked = null;
  const { exclude, known, visDyn, matSig } = probeDynamic(root, (sample) => {
    const seq = [['idle', 16, 0], ['move', 16, 3], ['cast', 24, 0], ['downed', 12, 0], ['dead', 12, 0], ['idle', 6, 0]];
    let tt = 0;
    for (const [anim, n, sp] of seq) for (let i = 0; i < n; i++) { tt += 1 / 30; update(1 / 30, { anim, t: tt, speed: sp, castProgress: i / n }); sample(); }
  });
  resetState();
  for (const c of cloth.chains) c.bones.forEach((b, i) => b.quaternion.copy(c.bindQ[i]));
  root.updateMatrixWorld(true);
  baked = bakeAvatar(root, parts, { exclude, known, visDyn, matSig });

  // per-instance materials for flash / tint on whatever stayed un-batched
  const cloneMap = new Map();
  root.traverse((o) => {
    if (!o.isMesh || o.isSkinnedMesh) return;
    const m = o.material;
    if (!m || Array.isArray(m) || !m.userData.shared || !m.isMeshStandardMaterial) return;
    if (!cloneMap.has(m)) cloneMap.set(m, cloneShared(m));
    o.material = cloneMap.get(m);
  });
  const mats = [...baked.materials, ...cloneMap.values()];
  const tintColor = new THREE.Color();
  function applyMats() {
    for (const c of mats) {
      c.color.copy(c.userData.base);
      if (tint && tintK > 0 && !c.vertexColors) c.color.lerp(tintColor, tintK);
      if (c.userData.baseEmissive) c.emissive.copy(c.userData.baseEmissive); else c.emissive.setRGB(0, 0, 0);
      c.emissiveIntensity = c.userData.baseEI;
      if (flashK > 0.001) {
        c.emissive.lerp(FLASH, Math.min(1, flashK));
        c.emissiveIntensity = Math.max(c.emissiveIntensity, 1.5 * flashK);
      }
    }
  }

  update(0.016, { t: 0 });
  for (const j of allJoints) j.snap();

  return {
    root, muzzle, height: 1.85,
    update,
    flash(amount = 1) { flashK = Math.max(flashK, amount); applyMats(); },
    setTint(hex, k = 0.5) {
      if (hex === null || hex === undefined) { tint = null; tintK = 0; } else { tint = hex; tintColor.set(hex); tintK = THREE.MathUtils.clamp(k, 0, 1); }
      baked.setTint(tint === null ? null : hex, tintK);
      applyMats();
    },
    dispose() {
      glows.dispose();
      baked.dispose();
      for (const c of cloneMap.values()) c.dispose();
      root.traverse((o) => { if ((o.isMesh || o.isSprite) && !o.isSkinnedMesh && o.geometry && !o.geometry.userData?.shared) o.geometry.dispose?.(); });
      root.removeFromParent();
    },
    stats: { tris: baked.tris, bones: baked.bones, meshes: baked.meshes.length, labels: baked.labels },
    _parts: { arms, legs, hips, spine, head, F, cloth },
  };
}
