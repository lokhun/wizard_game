import * as THREE from 'three';
import { CLASS_META } from '../../classMeta.js';
import { getKit, GlowSet } from './kit.js';
import { buildHand, gripPose, POSES, clonePose } from './hand.js';
import { FingerRig } from './fingers.js';
import { buildFocus } from './foci.js';
import { buildHat } from './hats.js';
import { V, withLOD } from './shapes.js';
import { grp } from './common.js';
import { wob } from './fx.js';
import { Cloth } from './cloth.js';
import { setRotXYZ } from '../../../render/rot.js';
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
// the leg's two bones (hip to knee, knee to ankle), for the gait's solve
const LEG_A = BODY_Y.hipJ - BODY_Y.knee, LEG_B = BODY_Y.knee - BODY_Y.ankle;
// the ground one full stride (two steps) covers at a speed, and the most a single planted foot may cover
const strideOf = (v) => 1.1 + 0.28 * Math.min(v, 7), STEP_MAX = 0.84;

// Follow-through, as the enemies' rigs have it (models/core.js PoseBuf): each joint's eased angles drive a
// light spring, kicked by every change in its angular speed and a share of its parent's, so a cast's thrust
// whips out to the wrist and a stop rocks the head and hands past and back. Shown on the joint only.
const FT_W = 16, FT_Z = 0.38, FT_MAX = 0.35, FT_DRIVE = 18;
const FC = [0, 0, 0, 0];
let fcDt = -1;
function followCoef(dt) {
  if (dt === fcDt) return;
  fcDt = dt;
  const wd = FT_W * Math.sqrt(1 - FT_Z * FT_Z), e = Math.exp(-FT_Z * FT_W * dt), c = Math.cos(wd * dt), s = Math.sin(wd * dt);
  FC[0] = e * (c + (FT_Z * FT_W / wd) * s); FC[1] = e * (s / wd); FC[2] = -e * (FT_W * FT_W / wd) * s; FC[3] = e * (c - (FT_Z * FT_W / wd) * s);
}
class Joint {
  constructor(group, gain = 0, par = null) {
    this.g = group; this.t = new THREE.Vector3(); this.c = new THREE.Vector3();
    this.fg = gain; this.par = par;
    this.fj = new Float32Array(3); this.fv = new Float32Array(3); this.fw = new Float32Array(3); this.fd = new Float32Array(3);
  }
  set(x = 0, y = 0, z = 0) { this.t.set(x, y, z); return this; }
  add(x = 0, y = 0, z = 0) { this.t.x += x; this.t.y += y; this.t.z += z; return this; }
  mix(x, y, z, w) { const t = this.t; t.x += (x - t.x) * w; t.y += (y - t.y) * w; t.z += (z - t.z) * w; return this; }
  step(k, dt = 0) {
    const c = this.c, px = c.x, py = c.y, pz = c.z;
    c.lerp(this.t, k);
    const { fj, fv, fw, fd } = this;
    if (dt > 1e-5) {
      followCoef(dt);
      const pd = this.par?.fd;
      for (let i = 0; i < 3; i++) {
        const dc = (i === 0 ? c.x - px : i === 1 ? c.y - py : c.z - pz);
        if (dc > 0.9 || dc < -0.9) { fw[i] = fd[i] = 0; continue; } // (a snap, not a swing)
        const w = dc / dt;
        let d = w - fw[i];
        fw[i] = w;
        if (pd) d += pd[i] * 0.65;
        fd[i] = d = d > FT_DRIVE ? FT_DRIVE : d < -FT_DRIVE ? -FT_DRIVE : d;
        if (this.fg <= 0) continue;
        const x = fj[i], v = fv[i] - this.fg * d, nx = FC[0] * x + FC[1] * v;
        fv[i] = FC[2] * x + FC[3] * v;
        fj[i] = nx > 1.2 ? 1.2 : nx < -1.2 ? -1.2 : nx; // (linear state; the limit is eased on what is shown)
      }
    }
    const s = (v) => v / (1 + Math.abs(v) / FT_MAX);
    setRotXYZ(this.g, c.x + s(fj[0]), c.y + s(fj[1]), c.z + s(fj[2]));
  }
  snap() { this.c.copy(this.t); this.fj.fill(0); this.fv.fill(0); this.fw.fill(0); this.fd.fill(0); setRotXYZ(this.g, this.c.x, this.c.y, this.c.z); }
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
    const jT = new Joint(thigh, 0.02), jK = new Joint(knee, 0.03, jT), jA = new Joint(ankle, 0.04, jK);
    return { s, thigh, knee, ankle, jT, jK, jA };
  });
  const arms = [1, -1].map((s) => {
    const shoulder = grp(chest, { x: s * SHOULDER_X, y: BODY_Y.shoulder - BODY_Y.chest, z: -0.01 }); shoulder.name = 'shoulder';
    shoulder.rotation.order = 'YXZ'; // yaw last: pans a raised arm toward the aim
    const elbow = grp(shoulder, { y: -0.28 }); elbow.name = 'elbow';
    const wrist = grp(elbow, { y: -0.25 }); wrist.name = 'wrist';
    const jS = new Joint(shoulder, 0.16), jE = new Joint(elbow, 0.26, jS), jW = new Joint(wrist, 0.38, jE);
    return { s, shoulder, elbow, wrist, jS, jE, jW };
  });
  const [armL, armR] = arms;
  const [legL, legR] = legs;
  const jHips = new Joint(hips), jSpine = new Joint(spine, 0.06, jHips), jChest = new Joint(chest, 0.1, jSpine), jNeck = new Joint(neck, 0.18, jChest), jHead = new Joint(head, 0.28, jNeck);
  for (const a of arms) a.jS.par = jChest; // (the shoulders ride the chest's motion)
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
  // The hands stay jointed (they used to be baked into one still mesh each): every finger segment rides
  // along as a bone of the batched body, and a FingerRig (fingers.js) moves them - the grip tightens on a
  // cast, a free hand claws, opens and trails its fingers, and neither is ever quite still.
  const handR = rawR;
  const restR = clonePose(rg.kind === 'pole' ? gripPose(rg.r).pose : (POSES[rg.kind] ?? POSES.relaxed));
  handR.group.name = 'handR';
  const lgp = F.leftGrip ?? { kind: 'open' };
  const rawL = withLOD(0.45, () => buildHand(handOpts(F.hands.L)));
  let gripL = null;
  if (lgp.kind === 'pole') {
    const gp = gripPose(lgp.r);
    rawL.setPose(gp.pose);
    gripL = { pos: gp.gripPos, q: new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, Math.PI / 2)) };
  } else rawL.setPose(clonePose(POSES[lgp.kind === 'spread' ? 'open' : lgp.kind] ?? POSES.relaxed));
  const handL = rawL;
  const restL = clonePose(lgp.kind === 'pole' ? gripPose(lgp.r).pose : (POSES[lgp.kind === 'spread' ? 'open' : lgp.kind] ?? POSES.relaxed));
  const fingR = new FingerRig(handR, restR, { grip: rg.kind === 'pole', still: rg.kind === 'fist', seed: 2 });
  const fingL = new FingerRig(handL, restL, { grip: lgp.kind === 'pole', seed: 9 });
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
  if (ctx.noHat) hat.group.clear(); // (the model viewer: a look at the head beneath)
  head.add(hat.group);
  // A pointed hat's point is cloth: it gets a bone two fifths of the way up and its upper part is skinned
  // to it, more toward the tip. The bone swings on a spring against the head's turns and the body's
  // starts and stops (see the update), so the point nods, lags a turn and bobs on the run.
  let hatTip = null, hatBaseY = null;
  if (hat.cone && !ctx.noHat) {
    hatTip = new THREE.Group(); hatTip.name = 'hatTip';
    hatTip.position.set(0, hat.cone.H * 0.4, 0);
    hat.cone.mesh.parent.add(hatTip);
    const cm = hat.cone.mesh, H = hat.cone.H, wp = V();
    cm.userData.reskin = {
      bones: [hatTip],
      fn: (v) => {
        if (hatBaseY === null) { root.updateMatrixWorld(true); hatBaseY = cm.getWorldPosition(wp).y; }
        const w = sstep(0.32, 0.95, (v.y - hatBaseY) / H) * 0.9;
        return w < 0.001 ? [[cm, 1]] : [[cm, 1 - w], [hatTip, w]];
      },
    };
  }

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
  // off the ground (0..1, and which way: 1 rising .. -1 falling), the crouch of a landing, a dash's lunge,
  // a blow's flinch (and the side it rocks to), and the body's eased acceleration (it leans into it)
  let airK = 0, airV = 0, landK = 0, dashK = 0, hurtK = 0, hurtSide = 1, accX = 0, accZ = 0, plx = 0, plz = 0;
  // which cast is playing (a spell's own style and hand: see the cast block), and whether the free hand is in it
  let castStyle = null, castLeft = false, castRight = true;
  // dying: time since the fall began (it is played, not eased: the knees go, the body tips and lands)
  let deadT = 0;
  // the hat's point (two angles and their speeds), how winded the body is (0..1), and the turn it is making (signed)
  let tipX = 0, tipZ = 0, tipVX = 0, tipVZ = 0, exert = 0, turnS = 0, gestKind = 0, breathPh = 0;
  // at rest: a glance (where the head is turned to, until when), a blink, and now and then a look at the free hand
  let glanceY = 0, glanceX = 0, glanceAt = 2, blinkAt = 1.5, blinkT = 1, gestT = -1, gestAt = 7;
  const gait = new Float32Array(6); // (each foot's place this frame: along its path, lift, heel-to-toe roll)
  const leftFree = lgp.kind !== 'pole' && !F.left;
  // turning on the spot (mouse-look) steps the feet round: yaw rate eased into 0..1, its sign, and a step phase
  let turnK = 0, turnDir = 1, turnPh = 0, prevYaw = null;
  const _te = new THREE.Euler();
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
  const freeArm = !lhold && leftFree; // (an arm with nothing to carry: it can gesture)

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
    phase = 0; moveK = 0; lastT = 0; deadK = 0; downK = 0; castK = 0; idleT = 0; haveprev = false; turnK = 0; prevYaw = null;
    airK = airV = landK = dashK = hurtK = accX = accZ = plx = plz = 0; castStyle = null; castLeft = false; castRight = true;
    tipX = tipZ = tipVX = tipVZ = exert = turnS = 0; gestKind = 0; breathPh = 0;
    deadT = 0; glanceY = glanceX = 0; glanceAt = 2; blinkAt = 1.5; blinkT = 1; gestT = -1; gestAt = 7;
    fingR.reset(); fingL.reset();
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
    const yaw = _te.setFromQuaternion(rq, 'YXZ').y;
    if (prevYaw !== null && dt > 1e-4) {
      const d = Math.atan2(Math.sin(yaw - prevYaw), Math.cos(yaw - prevYaw)), yr = d / dt;
      // (a snap of a whole radian is a respawn or a spawn facing, not a turn)
      if (Math.abs(d) < 1) { turnK += (Math.min(1, Math.abs(yr) / 3) - turnK) * (1 - Math.exp(-dt * 8)); if (Math.abs(yr) > 0.3) turnDir = Math.sign(yr); turnS += (THREE.MathUtils.clamp(yr / 3.5, -1, 1) - turnS) * (1 - Math.exp(-dt * 6)); }
    }
    prevYaw = yaw;
    wprev.copy(wpos); haveprev = true;
    lvel.copy(wvel).applyQuaternion(qa.copy(rq).invert()).divideScalar(wscale || 1);
    const vy = lvel.y;
    lvel.y = 0;
    // the body's acceleration (it leans into a start and back against a stop), eased
    if (dt > 1e-4) {
      const e = 1 - Math.exp(-dt * 7), C = THREE.MathUtils.clamp;
      accX += (C((lvel.x - plx) / dt, -40, 40) - accX) * e; accZ += (C((lvel.z - plz) / dt, -40, 40) - accZ) * e;
    }
    plx = lvel.x; plz = lvel.z;
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
    phase += (speed * dt * TAU) / strideOf(speed);
    deadK += ((anim === 'dead' ? 1 : 0) - deadK) * (1 - Math.exp(-dt * 4.5));
    downK += ((anim === 'downed' ? 1 : 0) - downK) * (1 - Math.exp(-dt * 5));
    castK += ((anim === 'cast' ? 1 : 0) - castK) * (1 - Math.exp(-dt * (anim === 'cast' ? 40 : 9))); // (on at once, off at leisure)
    if (anim === 'cast') {
      castStyle = s.castStyle ?? null;
      const ch = s.castHand ?? (castStyle === 'throw' || castStyle === 'snap' ? 'left' : 'right');
      castLeft = ch !== 'right'; castRight = ch !== 'left';
    }
    // Off the ground: a jump or a drop, read from the body's own rise and fall (a ramp or a stair is far
    // slower). Touching down after one, the knees take it.
    const alive = (1 - downK) * (1 - deadK);
    const wasAir = airK;
    airK += ((s.air ?? sstep(2.6, 5.2, Math.abs(vy))) * alive - airK) * (1 - Math.exp(-dt * (Math.abs(vy) > 2.6 ? 16 : 9)));
    airV += (THREE.MathUtils.clamp(vy / 4.5, -1, 1) - airV) * (1 - Math.exp(-dt * 10));
    if (wasAir > 0.45 && airK < wasAir && Math.abs(vy) < 1.5 && landK < 0.3) landK = Math.min(1, wasAir * 1.2);
    landK *= Math.exp(-dt * 6.5);
    // A dash: far faster than any run.
    dashK += ((s.dash ?? sstep(11, 16, Math.hypot(lvel.x, lvel.z))) * alive - dashK) * (1 - Math.exp(-dt * 16));
    hurtK *= Math.exp(-dt * 6);
    const k = moveK;
    const still = (1 - k) * (1 - downK) * (1 - deadK);
    idleT += dt * still;

    // ---- idle: breathing, weight shift, looking around
    // Breath: slow and shallow at rest; after a run, a dash or a string of casts it comes fast and deep and
    // lifts the shoulders, and takes some seconds to settle.
    exert = THREE.MathUtils.clamp(exert + dt * ((moving ? 0.1 + 0.16 * sstep(3, 6.5, speed) : 0) + dashK * 0.6 + castK * 0.12 - (moving ? 0 : 0.11)), 0, 1);
    breathPh += dt * (1.55 + 2.3 * exert);
    const brK = 1 + 2.6 * exert, br = Math.sin(breathPh) * brK, brUp = Math.max(0, Math.sin(breathPh - 0.4)) * exert;
    const ws = Math.sin(idleT * 0.42 + 0.6) * 0.8 + Math.sin(idleT * 0.17) * 0.2; // >0: weight on the right leg
    const look = wob(t * 0.23, 2), look2 = wob(t * 0.17, 5);
    jHips.set(0, 0, -0.03 * ws * still);
    jSpine.set(0.035 + br * 0.006 + 0.05 * exert * (1 - k), 0, 0.035 * ws * still);
    jChest.set(-0.015 - br * 0.018, 0, 0.012 * ws * still);
    // the head does not drift, it looks: every few seconds a glance somewhere, held, then somewhere else
    // (a quick turn, eyes first - the joints' own easing and follow-through make the move)
    if (idleT > glanceAt) {
      const r = Math.sin(idleT * 12.9898 + phase) * 43758.5453, u = r - Math.floor(r), r2 = Math.sin(idleT * 78.233) * 12543.21, u2 = r2 - Math.floor(r2);
      glanceY = u < 0.3 ? 0 : (u2 - 0.5) * 0.9; glanceX = u < 0.3 ? 0 : (u - 0.65) * 0.3;
      glanceAt = idleT + 1.4 + u2 * 3.2;
    }
    const gl = still * (1 - castK);
    jNeck.set(-pitch * 0.35 + 0.05 + glanceX * 0.4 * gl, (look * 0.06 + glanceY * 0.4) * gl, 0);
    jHead.set(-pitch * 0.45 + (0.03 * look2 + glanceX * 0.6) * gl, (look * 0.08 + glanceY * 0.6) * gl, (-0.02 * ws - glanceY * 0.08) * gl);
    jChest.add(0, glanceY * 0.12 * gl, 0);
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

    // (hard breathing lifts the shoulders and the head rides it)
    armL.jS.add(0, 0, 0.05 * brUp); armR.jS.add(0, 0, -0.05 * brUp); jNeck.add(-0.03 * brUp, 0, 0);
    // ---- at rest, now and then, one of three small things: the free hand comes up, is turned over and
    // looked at; the hat or hood is settled with it; the shoulders are rolled and the neck stretched
    if (gestT >= 0) {
      gestT += dt;
      const dur = gestKind === 2 ? 3.0 : 2.6;
      if (gestT > dur || still < 0.9 || castK > 0.05 || hurtK > 0.05) { gestT = -1; gestKind++; gestAt = idleT + 8 + (Math.sin(idleT * 3.7) + 1) * 4.5; }
      else if (gestKind % 3 === 0 && freeArm) {
        const g = sstep(0, 0.5, gestT) * (1 - sstep(2.0, 2.6, gestT)), turn = sstep(0.7, 1.2, gestT) * (1 - sstep(1.6, 2.0, gestT));
        armL.jS.mix(-0.75, 0.25, 0.2, g); armL.jE.mix(-1.75, 0.35, 0, g); armL.jW.mix(0.15, 0, 1.5 - 1.9 * turn, g);
        jNeck.mix(0.28, 0.22, 0, g); jHead.mix(0.3, 0.3, 0.06, g); jChest.add(0.04 * g, 0.08 * g, 0);
      } else if (gestKind % 3 === 1 && freeArm) {
        // hand to the brim: up, a small tug down and to one side, and away
        const g = sstep(0, 0.55, gestT) * (1 - sstep(1.9, 2.6, gestT)), tug = sstep(0.8, 1.05, gestT) * (1 - sstep(1.25, 1.6, gestT));
        armL.jS.mix(-2.0 + 0.12 * tug, 0.5, 0.55, g); armL.jE.mix(-2.05 + 0.2 * tug, 0.3, 0, g); armL.jW.mix(-0.4, 0, 0.6, g);
        jNeck.add(0.1 * tug * g, 0, 0); jHead.add(0.12 * tug * g, -0.12 * g, 0.08 * tug * g);
        tipVX += tug * g * dt * 9;
      } else {
        // the shoulders go up, back and down, one a little after the other; the head tips side to side
        const g = sstep(0, 0.4, gestT) * (1 - sstep(2.4, 3.0, gestT)), a = gestT * 2.6;
        armL.jS.add(0.12 * Math.sin(a) * g, 0, 0.14 * Math.max(0, Math.cos(a)) * g); armR.jS.add(0.1 * Math.sin(a - 0.6) * g, 0, -0.14 * Math.max(0, Math.cos(a - 0.6)) * g);
        jChest.add(-0.07 * Math.sin(a) * g, 0, 0); jSpine.add(-0.04 * g, 0, 0);
        jNeck.add(-0.1 * g, 0, 0.16 * Math.sin(a * 0.5) * g); jHead.add(-0.06 * g, 0, 0.2 * Math.sin(a * 0.5) * g);
      }
    } else if (s.gesture !== undefined && idleT > 1) { gestKind = s.gesture; gestT = 0; } // (asked for: the model viewer)
    else if (still > 0.97 && idleT > gestAt && castK < 0.01) gestT = 0;

    // ---- walk / run: legs follow the movement direction, arms counter-swing
    if (k > 0.001) {
      // The feet are planted. Each foot's path is laid out on the ground - set down ahead, carried back
      // under the body at exactly the pace the body travels, peeled off the toe, swung through with the
      // knee leading - and the hip and knee are solved to put it there (two bones, closed form). The old
      // cycle swung the thighs on a sine: the planted foot slid at most of walking speed.
      // A walk keeps a foot down 62% of the stride (both, between steps); a run 42% (neither, in flight).
      const run = sstep(3, 6.5, speed);
      // (a planted foot covers at most STEP_MAX of ground: past a stroll the stride lengthens by flight, not reach)
      const stride = strideOf(speed), duty = Math.min(0.62, STEP_MAX / stride), ik = sstep(0, 0.3, k), S = duty * stride * Math.min(1, k / Math.max(0.05, Math.min(1, speed / 2.6))); // (shortened only while getting under way)
      const reach = (LEG_A + LEG_B) * 0.992;
      // the pelvis rides low enough for the planted leg to reach both ends of its step, rising over the
      // foot in a walk and sinking onto it in a run
      const c0 = ((phase - 1.5 * Math.PI) / TAU % 1 + 1) % 1; // (the left leg's place in its cycle: 0 = heel strike)
      const over = Math.cos(2 * TAU * (c0 - duty * 0.5));
      const drop = (LEG_A + LEG_B) - Math.sqrt(Math.max(0.05, reach * reach - S * S * 0.25)) + 0.008 - over * (0.014 * (1 - run) - 0.024 * run);
      hips.position.y -= drop * ik;
      const fwdK = dirZ >= 0 ? 1 : -1, roll = Math.abs(dirZ);
      let list = 0;
      for (let li = 0; li < 2; li++) {
        const c = li === 0 ? c0 : (c0 + 0.5) % 1;
        let f, lift, pitch;
        if (c < duty) {
          // planted: straight back under the body; the toes come down from the heel strike, the heel peels at the end
          const u = c / duty, off = sstep(0.7, 1, u);
          f = S * (0.5 - u); lift = 0.04 * off * off * roll;
          pitch = -0.3 * (1 - sstep(0, 0.2, u)) + 0.6 * off;
        } else {
          // swung through: quick off the toe, the foot carried a touch past its mark and set back onto it
          const w = (c - duty) / (1 - duty), e = w * w * (3 - 2 * w), arc = Math.sin(Math.PI * Math.pow(w, 0.85));
          f = S * (-0.5 + e) + S * 0.05 * Math.sin(Math.PI * w) * (1 - w);
          lift = 0.04 * (1 - sstep(0, 0.35, w)) * roll + (0.055 + 0.2 * run) * arc;
          pitch = 0.6 * (1 - sstep(0, 0.5, w)) - 0.3 * sstep(0.62, 1, w);
          list += (li === 0 ? -1 : 1) * arc;
        }
        gait[li * 3] = f; gait[li * 3 + 1] = lift; gait[li * 3 + 2] = pitch;
      }
      // the pelvis: turned to carry the leading leg, dropped on the side of the leg in the air, shifted over
      // the one on the ground; the chest turns against it and the head stays on the way ahead
      jHips.add(0, swing * (0.11 + 0.05 * run) * k * dirZ, list * 0.05 * k);
      const hx = over * 0.5 * Math.sin(TAU * (c0 - duty * 0.5)) * 0.03 * k * (1 - run);
      hips.position.x += hx;
      // The solve, per leg. Where its foot must be is taken into the pelvis's own (turned, tilted) frame,
      // from the hip joint: so the pelvis may sway and the foot still does not move on the ground. Then
      // the knee's bend from how far that is; the thigh swung out sideways (z) by what a side step needs,
      // and fore and aft (x) to land the foot; the ankle keeps the sole level.
      // (the pelvis as it will stand once this frame's easing is applied, not where it is headed)
      const ek = 1 - Math.exp(-dt * 13), hy = jHips.c.y + (jHips.t.y - jHips.c.y) * ek, hz = jHips.c.z + (jHips.t.z - jHips.c.z) * ek;
      const cy = Math.cos(hy), sy = Math.sin(hy), cz = Math.cos(hz), sz = Math.sin(hz);
      for (let li = 0; li < 2; li++) {
        const L = legs[li], f = gait[li * 3], lift = gait[li * 3 + 1], pitch = gait[li * 3 + 2];
        const ox = L.s * HIP_X, oy = BODY_Y.hipJ - BODY_Y.hips;
        // foot from the hips' origin (root axes), undone by the pelvis's turn (y) then its tilt (z)
        const wx = ox + f * dirX - hx, wy = oy - (LEG_A + LEG_B - drop - lift), wz = f * dirZ;
        const ax = wx * cy - wz * sy, az = wx * sy + wz * cy;
        const fx = ax * cz + wy * sz - ox, h = -(-ax * sz + wy * cz - oy), fz = az;
        const D = Math.min(reach, Math.hypot(fx, fz, h));
        const kn = Math.PI - Math.acos(THREE.MathUtils.clamp((LEG_A * LEG_A + LEG_B * LEG_B - D * D) / (2 * LEG_A * LEG_B), -1, 1));
        const cd = LEG_A + LEG_B * Math.cos(kn), sd = -LEG_B * Math.sin(kn);
        const psi = Math.asin(THREE.MathUtils.clamp(fx / cd, -0.9, 0.9));
        const th = Math.atan2(fz, h) - Math.atan2(sd, cd * Math.cos(psi));
        L.jT.mix(-th, 0, psi, ik);
        L.jK.mix(kn, 0, 0, ik);
        L.jA.mix(th - kn + pitch * roll * fwdK, 0, -psi - hz, ik); // (the sole level, but for the roll from heel to toe)
      }
      jSpine.add(0.08 * k * Math.min(1, speed / 3) * dirZ, -swing * (0.09 + 0.05 * run) * k * dirZ, -dirX * 0.06 * k - list * 0.03 * k);
      jChest.add(0, -swing * (0.05 + 0.04 * run) * k * dirZ, -list * 0.015 * k);
      jNeck.add(0, swing * 0.05 * run * k * dirZ, 0);
      // free arm swings opposite its leg; the staff arm swings a little
      // (a loose chain: the forearm trails the upper arm and folds as the arm comes forward, the wrist
      // trails the forearm; the shoulders ride up and down with the stride)
      if (!lhold) {
        armL.jS.add(swing * 0.5 * k * dirZ, 0, 0.04 * k - 0.03 * Math.abs(swing) * k);
        armL.jE.add(-0.25 * k - Math.max(0, -Math.sin(phase - 0.55)) * 0.42 * k, 0, 0);
        armL.jW.add(Math.sin(phase - 1.1) * 0.22 * k * dirZ, 0, 0);
      } else armL.jS.add(swing * 0.12 * k, 0, 0);
      armR.jS.add(-swing * 0.16 * k * dirZ - 0.08 * k, 0, 0);
      if (hold === 'staff') {
        // Walked with, as a staff is: swung forward and set down with the left foot, leaned on as the body
        // passes it, picked up behind. On a run it is simply carried, slanted ahead.
        const stp = Math.cos(TAU * c0) * (1 - run) * dirZ, up = Math.max(0, -Math.sin(TAU * c0)) * (1 - run);
        focusDir.lerp(tmp.set(0.05, 1, 0.22 + 0.2 * run + 0.3 * stp), k * (0.55 + 0.25 * (1 - run)));
        armR.jS.add(-0.2 * stp * k, 0, 0); armR.jE.add(-0.16 * up * k, 0, 0);
      }
      // into a turn: the head goes first, the body banks to the inside
      jSpine.add(0, 0, -turnS * 0.09 * k); jChest.add(0, turnS * 0.06 * k, -turnS * 0.04 * k);
      jNeck.add(0, turnS * 0.14 * k, 0); jHead.add(0, turnS * 0.16 * k, turnS * 0.05 * k);
    }
    // ---- turning on the spot: short side steps toward the turn, one foot then the other
    const tk = turnK * still;
    if (tk > 0.01) {
      turnPh += dt * TAU * (1.2 + turnK * 1.3);
      for (let li = 0; li < 2; li++) {
        const L = legs[li], p = turnPh + (L.s > 0 ? 0 : Math.PI), lift = Math.max(0, Math.sin(p));
        L.jT.add(-0.12 * lift * tk, 0, 0.1 * Math.sin(p) * turnDir * L.s * tk);
        L.jK.add(0.5 * lift * tk, 0, 0);
        L.jA.add(-0.15 * lift * tk, 0, 0);
      }
      hips.position.y -= 0.01 * tk;
    }

    // ---- the body has weight: it leans into a start and back against a stop, and a runner drives the elbows
    {
      const C = THREE.MathUtils.clamp, lk = alive * (1 - dashK);
      jSpine.add(C(accZ * 0.009, -0.16, 0.2) * lk, 0, C(-accX * 0.009, -0.16, 0.16) * lk);
      jNeck.add(C(-accZ * 0.004, -0.08, 0.08) * lk, 0, 0);
      const run = k * sstep(3.2, 6.5, speed);
      if (run > 0.001) {
        if (!lhold) armL.jE.add(-0.55 * run, 0, 0);
        armR.jS.add(-swing * 0.14 * run * dirZ, 0, 0);
        jSpine.add(0.07 * run * dirZ, 0, 0); jHead.add(-0.06 * run * dirZ, 0, 0);
      }
    }
    // ---- in the air: knees tucked and arms out on the way up, legs reaching and arms high on the way down
    if (airK > 0.005) {
      const a = airK, up = Math.max(0, airV), dn = Math.max(0, -airV);
      for (let li = 0; li < 2; li++) {
        const L = legs[li], lead = L.s > 0 ? 1 : 0.55;
        L.jT.mix(-(0.75 * up + 0.2 * dn) * lead + 0.12 * dn * (1 - lead), 0, L.s * 0.07, a);
        L.jK.mix(1.15 * up * lead + 0.3 * up + 0.38 * dn, 0, 0, a);
        L.jA.mix(0.35 * up + 0.5 * dn, 0, 0, a);
      }
      jSpine.add((0.14 * up - 0.1 * dn) * a, 0, 0); jHead.add((-0.1 * up + 0.12 * dn) * a, 0, 0);
      if (!lhold) { armL.jS.mix(-0.25 * up - 0.5 * dn, 0, 0.55 + 0.55 * dn, a); armL.jE.mix(-0.5 + 0.25 * dn, 0, 0, a); }
      else armL.jS.add(-0.15 * a, 0, 0.12 * a);
      armR.jS.add(-(0.12 * up + 0.3 * dn) * a, 0, -(0.18 + 0.22 * dn) * a);
    }
    // ---- landing: the knees give and the back rounds, then up again
    if (landK > 0.005) {
      const l = landK * alive;
      for (let li = 0; li < 2; li++) { const L = legs[li]; L.jT.add(-0.42 * l, 0, 0); L.jK.add(0.85 * l, 0, 0); L.jA.add(-0.4 * l, 0, 0); }
      hips.position.y -= 0.11 * l;
      jSpine.add(0.26 * l, 0, 0); jHead.add(-0.16 * l, 0, 0);
      if (!lhold) armL.jS.add(0, 0, 0.3 * l);
      armR.jS.add(0, 0, -0.12 * l);
    }
    // ---- dash: thrown along the line of travel, the back leg trailing and the free arm swept behind
    if (dashK > 0.005) {
      const d = dashK;
      jSpine.add(0.5 * d * dirZ, 0, -0.42 * d * dirX); jChest.add(0.12 * d * dirZ, 0, -0.1 * d * dirX);
      jNeck.add(-0.3 * d * dirZ, 0, 0); jHead.add(-0.2 * d * dirZ, 0, 0);
      legL.jT.mix(-0.95 * dirZ, 0, 0.5 * dirX, d); legL.jK.mix(0.75, 0, 0, d); legL.jA.mix(-0.1, 0, 0, d);
      legR.jT.mix(0.6 * dirZ, 0, 0.5 * dirX, d); legR.jK.mix(0.95, 0, 0, d); legR.jA.mix(0.55, 0, 0, d);
      hips.position.y -= 0.1 * d;
      if (!lhold) { armL.jS.mix(0.95, 0, 0.3, d); armL.jE.mix(-0.25, 0, 0, d); }
      armR.jS.add(0.45 * d, 0, -0.1 * d); armR.jE.add(0.3 * d, 0, 0);
      if (hold === 'staff') focusDir.lerp(tmp.set(0.05, 0.75, -0.6), d * 0.7);
    }
    // ---- struck: the body folds round the blow and rocks to one side, the shoulders come up
    if (hurtK > 0.005) {
      const h = hurtK * alive;
      jSpine.add(0.2 * h, 0, 0.14 * h * hurtSide); jChest.add(0.14 * h, -0.12 * h * hurtSide, 0);
      jNeck.add(0.12 * h, 0, 0); jHead.add(0.2 * h, 0.2 * h * hurtSide, -0.12 * h * hurtSide);
      armL.jS.add(-0.2 * h, 0, 0.26 * h); armL.jE.add(-0.5 * h, 0, 0);
      armR.jS.add(-0.1 * h, 0, -0.16 * h);
      for (let li = 0; li < 2; li++) { legs[li].jK.add(0.3 * h, 0, 0); legs[li].jT.add(-0.14 * h, 0, 0); legs[li].jA.add(-0.14 * h, 0, 0); }
      hips.position.y -= 0.035 * h;
    }

    // ---- cast: big readable poses, by what the class holds
    if (castK > 0.001) {
      // The spell left the moment it was cast: the body is on its strike at once (the arm only passes
      // through the drawn-back pose on its way there), holds it, and takes its time coming back.
      // (It used to draw back for a seventh of a second first - a wind-up for a spell already in the air.)
      const wind = sstep(0, 0.07, cp), thrust = sstep(0.03, 0.2, cp), rel = sstep(0.55, 1, cp);
      const a = Math.min(1, wind * 0.55 + thrust * 0.45) * (1 - rel * 0.85);
      // (a spell thrown from the free hand: the focus arm only braces)
      const w = castK * (castRight ? 1 : 0.3);
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
      // off hand pushes forward unless it is busy; a spell thrown from it is the off hand's own cast -
      // drawn back by the ear, then flung out along the aim with the shoulders turning behind it
      const wl = castK, hold1 = 1 - rel * 0.85;
      if (castLeft && (!lhold || lhold === 'cradle')) {
        armL.jS.mix(0.5 - wind * 1.0 - thrust * (1.05 + up * 0.8), -0.35 + 0.5 * thrust, 0.55 - 0.35 * thrust, wl * hold1);
        armL.jE.mix(-1.9 + thrust * 1.75, 0, 0, wl * hold1);
        armL.jW.mix(0.5 * wind - 1.1 * thrust, 0, 1.4, wl * a);
        if (!castRight) { jSpine.add((-0.06 * wind + 0.18 * thrust) * a * wl, (0.32 * wind - 0.42 * thrust) * a * wl, 0); jChest.add(0, (0.14 * wind - 0.12 * thrust) * a * wl, 0); }
      } else if (!lhold || lhold === 'cradle') {
        armL.jS.mix(-0.25 - wind * 0.4 - thrust * (0.7 + up * 0.5), -0.3 * thrust, 0.3 - 0.1 * thrust, wl * a);
        armL.jE.mix(-1.1 + thrust * 0.75, 0, 0, wl * a);
        armL.jW.mix(-0.9 * thrust, 0, 1.4, wl * a);
      } else if (lhold === 'book') { armL.jS.add(-0.35 * a * wl, 0, 0); armL.jE.add(-0.2 * a * wl, 0, 0); }
      else if (lhold === 'float') { armL.jS.add(-0.5 * a * wl, 0, 0); }
      // ---- a spell's own shape over the hold's (the styles the first-person hands play)
      let lungeK = 1;
      if (castStyle === 'raise') {
        // an invocation: both arms rise wide overhead and are held there, chest open, head back
        const r = sstep(0, 0.12, cp) * (1 - sstep(0.82, 1, cp)) * castK, q = wob(t * 22, 4) * 0.02 * r;
        armR.jS.mix(-2.45 + q, 0.1, -0.5, r); armR.jE.mix(-0.35, 0, 0, r);
        focusDir.lerp(tmp.set(0.12, 1, -0.05), r); focusUp.lerp(tmp.set(0, 0, 1), r);
        if (!lhold || lhold === 'cradle') { armL.jS.mix(-2.4 - q, -0.1, 0.55, r); armL.jE.mix(-0.4, 0, 0, r); armL.jW.mix(-0.3, 0, 1.4, r); }
        else armL.jS.add(-0.5 * r, 0, 0.15 * r);
        jSpine.mix(-0.16, 0, 0, r); jChest.mix(-0.14, 0, 0, r); jNeck.add(-0.16 * r, 0, 0); jHead.add(-0.22 * r, 0, 0);
        for (let li = 0; li < 2; li++) { legs[li].jT.add(0, 0, legs[li].s * 0.07 * r); legs[li].jK.add(0.08 * r, 0, 0); }
        lungeK = 1 - r;
      } else if (castStyle === 'slam') {
        // hauled high overhead, then driven into the ground: the whole body follows it down
        const hi = sstep(0, 0.06, cp) * (1 - sstep(0.06, 0.18, cp)), lo = sstep(0.05, 0.2, cp) * (1 - sstep(0.72, 1, cp)), wk = castK; // (overhead only in passing: it is already coming down)
        armR.jS.mix(-2.6, 0.05, -0.3, hi * wk); armR.jE.mix(-0.7, 0, 0, hi * wk);
        armR.jS.mix(-0.75, 0.1, -0.1, lo * wk); armR.jE.mix(-0.5, 0, 0, lo * wk);
        focusDir.lerp(tmp.set(0.05, 1, -0.25), hi * wk); focusDir.lerp(tmp.set(0, -0.05, 1), lo * wk * 0.9);
        if (!lhold || lhold === 'cradle') { armL.jS.mix(-2.4, 0, 0.4, hi * wk); armL.jS.mix(-0.7, 0, 0.3, lo * wk); armL.jE.mix(-0.6, 0, 0, Math.max(hi, lo) * wk); }
        jSpine.add((-0.2 * hi + 0.55 * lo) * wk, 0, 0); jChest.add((-0.1 * hi + 0.2 * lo) * wk, 0, 0); jHead.add((-0.15 * hi - 0.25 * lo) * wk, 0, 0);
        for (let li = 0; li < 2; li++) { legs[li].jT.add(-0.5 * lo * wk, 0, legs[li].s * 0.06 * lo * wk); legs[li].jK.add(0.95 * lo * wk, 0, 0); legs[li].jA.add(-0.42 * lo * wk, 0, 0); }
        hips.position.y -= 0.14 * lo * wk;
        lungeK = 1 - Math.max(hi, lo) * wk;
      } else if (castStyle === 'channel') {
        // held: braced low behind the focus, leaning into the stream, the arms shaking with it
        const c = castK, q = wob(t * 24, 6) * 0.022 * c, q2 = wob(t * 19, 8) * 0.02 * c;
        armR.jS.add(q, q2, 0); armR.jE.add(q2, 0, 0); armL.jS.add(-q, 0, q2);
        jSpine.add(0.1 * c + q * 0.4, 0, 0); jHead.add(-0.08 * c, 0, 0);
        for (let li = 0; li < 2; li++) legs[li].jK.add(0.12 * c, 0, 0);
        hips.position.y -= 0.03 * c;
      } else if (castStyle === 'swing2' && (hold === 'dagger' || hold === 'sword')) {
        // the backhand: from low across the body, rising back out
        const wk = castK * hold1;
        armR.jS.mix(-0.7 - thrust * 1.2, 1.15 - thrust * 1.5, 0.25 - thrust * 0.75, wk); armR.jE.mix(-1.0 + thrust * 0.75, 0, 0, wk);
        focusDir.lerp(tmp.set(-0.9 + thrust * 1.7, 0.2 + thrust * 0.6, 0.5 + thrust * 0.3), castK * a);
        jSpine.add(0, (0.55 * wind - 1.3 * thrust) * a * castK, 0);
      }
      // lunge onto the left foot
      const lg = thrust * a * castK * lungeK * (1 - airK) * (1 - k); // (a lunge is for a caster standing: running, the feet keep their stride)
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
      // hurt and winded: hard breaths that lift the shoulders and rock the back, the head hanging and swaying
      const hb = Math.sin(t * 3.4), hb2 = Math.max(0, Math.sin(t * 3.4 - 0.5));
      jSpine.add(-0.05 * hb * d, 0, wob(t * 0.5, 9) * 0.03 * d); jChest.add(-0.07 * hb2 * d, 0, 0);
      jNeck.add(0.06 * hb * d, wob(t * 0.4, 11) * 0.1 * d, 0); jHead.add(0.05 * hb2 * d, wob(t * 0.33, 12) * 0.12 * d, wob(t * 0.45, 13) * 0.05 * d);
      armL.jS.add(0, 0, 0.04 * hb2 * d); armR.jS.add(0.03 * hb * d, 0, -0.04 * hb2 * d);
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
    // The fall is played through, not eased into: the knees go first and the body sinks, then it tips
    // back gathering speed as a falling thing does, lands, and rocks once before it lies still. (Risen
    // again, it is eased back up.)
    if (anim === 'dead') deadT += dt; else deadT = 0;
    let fall = deadK, sink = 0, rock = 0;
    if (anim === 'dead') {
      const u = Math.min(1, deadT / 0.85);
      fall = Math.pow(sstep(0.12, 1, u), 1.9);
      sink = Math.sin(Math.PI * sstep(0, 0.75, u)) * (1 - fall);
      const tau = deadT - 0.85;
      if (tau > 0) rock = Math.exp(-tau * 7) * Math.sin(tau * 17);
      // (the buckle: over the fall's first half the knees fold and the back rounds, before the limbs fling out)
      for (let li = 0; li < 2; li++) { legs[li].jK.add(1.1 * sink, 0, 0); legs[li].jT.add(-0.5 * sink, 0, 0); }
      jSpine.add(0.35 * sink, 0, 0); jHead.add(0.3 * sink - 0.25 * Math.max(0, rock), 0, 0);
      armL.jS.add(-0.3 * rock, 0, 0.2 * sink); armR.jS.add(-0.3 * rock, 0, -0.2 * sink);
    }
    const bodyY = -0.45 * downK * (1 - fall) + 0.13 * fall - 0.2 * sink + 0.035 * Math.max(0, rock);
    body.position.set(0, bodyY, fall * 0.88);
    body.rotation.set(-fall * Math.PI / 2 + 0.07 * rock, 0, 0);
    hips.position.z += downK * 0.06;

    const kk = 1 - Math.exp(-dt * 13);
    // (legs on the move are held closer to their solved targets: an eased foot is a sliding foot)
    const kLeg = 1 - Math.exp(-dt * (13 + 60 * k));
    // (and a cast's arms and back are driven to their strike, not eased toward it)
    const kCast = 1 - Math.exp(-dt * (13 + 24 * castK));
    for (let i = 0; i < allJoints.length; i++) allJoints[i].step(i >= 5 && i < 11 ? kLeg : i >= 11 || i === 1 || i === 2 ? kCast : kk, dt);
    // ---- the hat's point: sprung against the head's own turning (its joints' angular speed), the body's
    // starts, stops and stride, and a blow; it leans back on a run
    if (hatTip) {
      const C = THREE.MathUtils.clamp, h = Math.min(dt, 1 / 30);
      const ax = C(-(jHead.fw[0] + jNeck.fw[0]) * 0.06 + accZ * 0.012 + (k > 0.01 ? Math.cos(2 * phase) * 0.05 * k : 0) - k * 0.1 * Math.min(1, speed / 6) + hurtK * 0.3 - airV * airK * 0.25, -0.6, 0.6);
      const az = C(-(jHead.fw[2] + jNeck.fw[2]) * 0.06 + (jHead.fw[1] + jNeck.fw[1]) * 0.03 - accX * 0.012 + turnS * 0.12 * k, -0.6, 0.6);
      tipVX += (140 * (ax - tipX) - 9 * tipVX) * h; tipVZ += (140 * (az - tipZ) - 9 * tipVZ) * h;
      tipX = C(tipX + tipVX * h, -0.7, 0.7); tipZ = C(tipZ + tipVZ * h, -0.7, 0.7);
      setRotXYZ(hatTip, tipX, 0, tipZ);
    }
    // ---- fingers: the grip tightens through a cast; a free hand claws on the wind-up and flings open on
    // the release, hangs half closed on the run, spreads in the air and on the ground it is propped on
    {
      const casting = castK > 0.3, wind = casting && cp < 0.05, out = casting && cp >= 0.05 && cp < 0.7;
      const lifeK = (1 - deadK) * (1 - k * 0.5), tremble = downK * 0.7 + (castStyle === 'channel' ? castK * 0.5 : 0);
      const freeR = rg.kind !== 'pole' && rg.kind !== 'fist';
      fingR.update(dt, t, { pose: freeR ? (wind ? POSES.fist : out ? POSES.spread : null) : null, squeeze: Math.min(1, castK + dashK + hurtK), life: lifeK, tremble });
      if (leftFree) {
        const both = castLeft || (!lhold && castRight);
        const pose = deadK > 0.5 ? POSES.open : downK > 0.5 ? POSES.spread : both && wind ? POSES.claw : both && out ? POSES.spread : castStyle === 'raise' && casting ? POSES.spread : airK > 0.4 ? POSES.spread : hurtK > 0.3 || dashK > 0.4 ? POSES.fist : null;
        fingL.update(dt, t, { pose, squeeze: pose ? 0 : k * 0.55, life: lifeK, tremble, rate: casting ? 1.1 : 0.7 });
      } else fingL.update(dt, t, { squeeze: Math.min(1, castK * 0.6 + hurtK), life: lgp.kind === 'pole' ? lifeK : lifeK * 0.3, tremble });
    }
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
    // the eyes blink (their light shuts for a moment), sometimes twice, and close on a blow
    blinkT += dt;
    if (t > blinkAt) { const r = Math.sin(t * 91.7) * 1375.3, u = r - Math.floor(r); blinkT = 0; blinkAt = t + (u < 0.2 ? 0.28 : 2.2 + u * 4.5); }
    const lid = Math.max(1 - sstep(0, 0.05, blinkT) * (1 - sstep(0.07, 0.16, blinkT)), 0) * (1 - Math.min(1, hurtK * 1.5));
    if (eyeMat) eyeMat.color.copy(eyeMat.userData.glow.base).multiplyScalar(eyeMat.userData.glow.intensity * (1 - deadK * 0.9) * (0.9 + 0.1 * Math.sin(t * 2)) * (0.12 + 0.88 * lid));
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
    for (const [castStyle, castHand] of [['raise', 'both'], ['slam', 'right'], ['throw', 'left'], ['channel', 'right'], ['swing2', 'right']]) for (let i = 0; i < 10; i++) { tt += 1 / 30; update(1 / 30, { anim: 'cast', t: tt, speed: 0, castProgress: i / 10, castStyle, castHand }); sample(); }
    for (let i = 0; i < 10; i++) { tt += 1 / 30; update(1 / 30, { anim: 'move', t: tt, speed: 4, air: i < 5 ? 1 : 0, dash: i > 6 ? 1 : 0 }); sample(); }
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
    legs, // (for tools and tests)
    flash(amount = 1) { flashK = Math.max(flashK, amount); applyMats(); },
    // a blow lands (k: 0..1 its size; side: -1 / 1 the way the body rocks, random if not given)
    hit(k = 0.6, side = 0) { hurtK = Math.max(hurtK, Math.min(1, k)); hurtSide = side || (Math.random() < 0.5 ? -1 : 1); fingR.kick(4 * k); fingL.kick(8 * k); },
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
