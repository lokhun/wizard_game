import * as THREE from 'three';
import { CLASS_META } from '../../classMeta.js';
import { getKit, GlowSet } from './kit.js';
import { buildHand, gripPose, POSES, lerpPose, clonePose } from './hand.js';
import { buildFocus } from './foci.js';
import { lathe, torus, mergeGeos, xf, mulberry, V, uvs } from './shapes.js';
import { wob } from './fx.js';

// ---------------------------------------------------------------------------
// First-person viewmodel: two hands with robe sleeves, the class focus and
// spring-driven procedural animation. Lives in camera space (camera at the
// origin looking down -Z).
// ---------------------------------------------------------------------------

// rest pose sits low and wide so the focus frames the crosshair instead of
// covering it (cast keys are offsets from here, so they still line up)
const BASE_R = V(0.295, -0.282, -0.56);
const BASE_L = V(-0.305, -0.258, -0.51);

// The viewmodel is drawn a hand's length from the lens, so authored glow
// (shared with the class-select avatars) would bloom into a white blob right
// next to the crosshair. Scale the first-person copy down: the focus still
// glows in its class colour but stays below the bloom threshold at rest.
const VIEW_GLOW = 0.4;      // unlit glow / halo colours
const VIEW_EMISSIVE = 0.6;  // emissive intensity of lit crystal shells and runes

// Hold presets. Pole holds give the pole direction (tilt forward about X,
// lean inward about Z); the roll of the fist around the pole is solved so the
// wrist points back toward the sleeve. Free hands use explicit Euler angles.
// Left-hand presets are authored in the mirrored space (as a right hand).
const FOREARM = V(0.3, -0.55, 1).normalize();
const HOLDS = {
  staff: { pole: true, tilt: -0.62, lean: 0.24, roll: 0.15, pos: [0, 0, 0] },
  wand: { pole: true, tilt: -1.2, lean: 0.3, roll: 0.0, pos: [-0.01, 0.03, -0.02] },
  dagger: { pole: true, tilt: -0.45, lean: 0.3, roll: 0.0, pos: [-0.03, 0.07, -0.02] },
  // leaned out and back so the blade rests beside the crosshair, not across it
  sword: { pole: true, tilt: -0.7, lean: 0.18, roll: 0.0, pos: [0.008, -0.01, 0] },
  claw: { rot: [1.15, 0.45, 0.15], order: 'YXZ', pos: [-0.04, 0.09, -0.05] },
  fist: { rot: [0.6, 0.8, 0.0], pos: [-0.04, 0.06, -0.04] },
};
const HOLDS_L = {
  open: { rot: [0.12, 0.55, -2.05], pos: [0, 0.02, 0] },
  spread: { rot: [0.35, 0.45, -2.1], pos: [0, 0.04, 0] },
  cradle: { rot: [0.45, 0.4, -2.75], pos: [0.01, 0.05, 0] },
  book: { rot: [0.6, 0.6, -2.4], pos: [0.0, 0.04, -0.05] },
  lantern: { pole: true, tilt: 0.1, lean: 1.45, roll: 0, pos: [-0.03, 0.12, -0.08] },
  staff: { pole: true, tilt: -0.62, lean: 0.24, roll: 0.15, pos: [0, 0, 0] },
};

function applyHold(pivot, hold) {
  if (!hold.pole) {
    if (hold.order) pivot.rotation.order = hold.order;
    pivot.rotation.set(...hold.rot);
    pivot.position.set(...hold.pos);
    return;
  }
  pivot.rotation.order = 'ZXY';
  let best = -2, bestRoll = 0;
  const z = V();
  for (let i = 0; i < 72; i++) {
    const r = -Math.PI + (i / 72) * Math.PI * 2;
    pivot.rotation.set(hold.tilt, r, hold.lean);
    pivot.updateMatrix();
    z.set(0, 0, 1).applyMatrix4(new THREE.Matrix4().extractRotation(pivot.matrix));
    const d = z.dot(FOREARM);
    if (d > best) { best = d; bestRoll = r; }
  }
  pivot.rotation.set(hold.tilt, bestRoll + (hold.roll ?? 0), hold.lean);
  pivot.position.set(...hold.pos);
}

// cast styles: keyframes of [px,py,pz, rx,ry,rz] offsets (x>0 = outward),
// plus finger pose keys for free hands.
const STYLES = {
  flick: { keys: [[0, [0, 0, 0, 0, 0, 0]], [0.05, [0.005, 0.012, 0.03, 0.45, 0, -0.05]], [0.11, [-0.02, 0.02, -0.08, -0.55, 0.05, 0.12]], [0.18, [-0.01, 0.01, -0.04, -0.25, 0, 0.06]], [0.32, [0, 0, 0, 0, 0, 0]]], fingers: [[0, 'claw'], [0.05, 'fist'], [0.1, 'spread'], [0.3, null]] },
  thrust: { keys: [[0, [0, 0, 0, 0, 0, 0]], [0.05, [0.01, -0.01, 0.04, 0.2, 0, 0]], [0.13, [-0.06, 0.05, -0.19, -0.35, 0.05, 0.14]], [0.2, [-0.05, 0.045, -0.17, -0.3, 0.05, 0.12]], [0.42, [0, 0, 0, 0, 0, 0]]], fingers: [[0, 'claw'], [0.05, 'claw'], [0.12, 'spread'], [0.4, null]] },
  slam: { keys: [[0, [0, 0, 0, 0, 0, 0]], [0.15, [0.01, 0.13, 0.03, 0.65, 0, -0.05]], [0.23, [-0.02, -0.07, -0.1, -0.8, 0, 0.12]], [0.3, [-0.015, -0.055, -0.08, -0.65, 0, 0.1]], [0.48, [0, 0, 0, 0, 0, 0]]], fingers: [[0, 'claw'], [0.15, 'fist'], [0.23, 'spread'], [0.45, null]] },
  raise: { keys: [[0, [0, 0, 0, 0, 0, 0]], [0.3, [-0.04, 0.13, -0.08, 0.12, 0, 0.1]], [1.1, [-0.04, 0.145, -0.09, 0.16, 0, 0.1]], [1.5, [0, 0, 0, 0, 0, 0]]], fingers: [[0, 'open'], [0.3, 'spread'], [1.2, 'spread'], [1.5, null]] },
  channel: { keys: [[0, [0, 0, 0, 0, 0, 0]], [0.15, [0.02, 0.05, -0.12, -0.1, 0.0, -0.06]]], hold: true, fingers: [[0, 'spread'], [0.2, 'spread']] },
  swing: { keys: [[0, [0, 0, 0, 0, 0, 0]], [0.08, [0.05, 0.11, 0.04, 0.45, -0.25, -0.5]], [0.14, [-0.12, 0.02, -0.12, -0.2, 0.15, 0.45]], [0.2, [-0.28, -0.04, -0.1, -0.3, 0.35, 1.1]], [0.26, [-0.26, -0.05, -0.08, -0.28, 0.3, 1.0]], [0.48, [0, 0, 0, 0, 0, 0]]], fingers: [[0, 'claw'], [0.07, 'fist'], [0.17, 'spread'], [0.4, null]] },
  throw: { keys: [[0, [0, 0, 0, 0, 0, 0]], [0.07, [0.02, 0.05, 0.07, 0.4, 0, -0.1]], [0.16, [-0.13, 0.06, -0.23, -0.45, 0, 0.2]], [0.22, [-0.11, 0.05, -0.2, -0.35, 0, 0.15]], [0.42, [0, 0, 0, 0, 0, 0]]], fingers: [[0, 'open'], [0.06, 'fist'], [0.15, 'spread'], [0.4, null]] },
  snap: { keys: [[0, [0, 0, 0, 0, 0, 0]], [0.08, [-0.03, 0.07, -0.05, -0.1, 0, 0.3]], [0.12, [-0.035, 0.065, -0.07, -0.25, 0, 0.32]], [0.36, [0, 0, 0, 0, 0, 0]]], fingers: [[0, 'open'], [0.06, 'snapPre'], [0.1, 'snapPost'], [0.3, null]] },
};
const ZERO6 = [0, 0, 0, 0, 0, 0];
const STIFF = { swing: 2400, flick: 1500, thrust: 1100, slam: 1300, throw: 1300, snap: 1200 };

function sampleKeys(keys, t, out) {
  if (t <= keys[0][0]) { for (let i = 0; i < 6; i++) out[i] = keys[0][1][i]; return out; }
  for (let k = 0; k < keys.length - 1; k++) {
    const [t0, a] = keys[k], [t1, b] = keys[k + 1];
    if (t <= t1) {
      const u = (t - t0) / (t1 - t0);
      const e = u * u * (3 - 2 * u);
      for (let i = 0; i < 6; i++) out[i] = a[i] + (b[i] - a[i]) * e;
      return out;
    }
  }
  const last = keys[keys.length - 1][1];
  for (let i = 0; i < 6; i++) out[i] = last[i];
  return out;
}
function sampleFingers(keys, t) {
  let cur = keys[0][1];
  for (const [kt, name] of keys) if (t >= kt) cur = name;
  return cur;
}

// N-dimensional damped spring
class Spring {
  constructor(n, k = 900, zeta = 0.42) {
    this.x = new Float32Array(n); this.v = new Float32Array(n); this.target = new Float32Array(n);
    this.k = k; this.c = 2 * zeta * Math.sqrt(k);
  }
  step(dt) {
    const steps = Math.max(1, Math.ceil(dt / 0.005));
    const h = dt / steps;
    for (let s = 0; s < steps; s++) {
      for (let i = 0; i < this.x.length; i++) {
        const a = this.k * (this.target[i] - this.x[i]) - this.c * this.v[i];
        this.v[i] += a * h;
        this.x[i] += this.v[i] * h;
      }
    }
  }
}

function sleeveGeo(meta, seed) {
  // bell sleeve along +Y (y=0 at the cuff), elliptical, ragged cuff
  const prof = [[0.05, 0.0], [0.052, 0.012], [0.056, 0.06], [0.061, 0.16], [0.067, 0.32], [0.072, 0.55]];
  const g = uvs(lathe(prof.map(([r, y]) => [r, y]), 22), 1, 1.6);
  const p = g.getAttribute('position');
  const rnd = mulberry(seed);
  const jag = Array.from({ length: 23 }, () => rnd());
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const a = Math.atan2(z, x);
    const k = Math.round(((a + Math.PI) / (Math.PI * 2)) * 22) % 22;
    let ny = y;
    if (y < 0.001) ny = y - jag[k] * 0.012;
    // folds
    const fold = 1 + Math.sin(a * 5 + y * 20) * 0.04 * Math.min(1, y * 10);
    p.setXYZ(i, x * fold, ny, z * fold * 0.85);
  }
  g.computeVertexNormals();
  return g;
}

export function createViewModel(classId, ctx) {
  const meta = CLASS_META[classId] ?? CLASS_META.pyromancer;
  const kit = getKit(ctx.factory);
  const glows = new GlowSet();
  const F = buildFocus(classId, kit, meta, { glows, detail: 1, view: true, hs: 1.3 });

  const root = new THREE.Group();
  root.name = `viewmodel:${classId}`;
  const sway = new THREE.Group();
  root.add(sway);

  const robe = kit.clothDS(meta.robe);
  const trim = kit.cloth(meta.trim);
  const gold = kit.gold();

  function makeSleeve(parent, at, dir, seed, hand) {
    const s = new THREE.Group();
    s.position.copy(at).addScaledVector(dir.clone().normalize(), 0.035);
    s.quaternion.setFromUnitVectors(V(0, 1, 0), dir.clone().normalize());
    parent.add(s);
    const sg = sleeveGeo(meta, seed);
    s.name = 'sleeve';
    s.add(new THREE.Mesh(sg, robe));
    const cuff = mergeGeos([
      xf(lathe([[0.0535, 0.006], [0.0565, 0.012], [0.057, 0.03], [0.054, 0.036]], 22), { sz: 0.85 }),
    ]);
    s.add(new THREE.Mesh(cuff, trim));
    const band = torus(0.0575, 0.0022, 4, 28, Math.PI * 2, { y: 0.021, rx: Math.PI / 2, sx: 1, sy: 0.85 });
    s.add(new THREE.Mesh(band, gold));
    // inner dark lining so the open end never shows a hollow
    const lin = lathe([[0.046, 0.004], [0.05, 0.2]], 14);
    lin.scale(1, 1, 0.85);
    s.add(new THREE.Mesh(lin, kit.plain(0x050404, 1)));
    // forearm from the wrist into the sleeve (follows the sleeve, the wrist bends)
    const fa = lathe([[0.024, -0.045], [0.0255, -0.02], [0.028, 0.03], [0.033, 0.12], [0.036, 0.25]], 14);
    fa.scale(1, 1, 0.78);
    s.add(new THREE.Mesh(fa, hand.palmMat));
    if (hand.cuffMat) {
      const c = lathe([[0.0262, -0.03], [0.029, -0.024], [0.032, -0.005], [0.037, 0.02], [0.04, 0.03], [0.036, 0.033]], 18);
      c.scale(1, 1, 0.8);
      s.add(new THREE.Mesh(c, hand.cuffMat));
    }
    return s;
  }

  // forearm direction: mostly follow the hand's wrist axis, pulled toward the
  // natural down-back direction so the sleeve always exits the screen bottom
  function sleeveDir(hand) {
    const hz = V(0, 0, 1).transformDirection(hand.group.matrixWorld);
    // left rig is mirrored: matrixWorld includes the flip, convert back
    if (hand === handLRef) hz.x *= -1;
    const d = hz.multiplyScalar(0.45).add(FOREARM.clone().multiplyScalar(0.55)).normalize();
    if (d.y > 0.05) d.y = 0.05;
    if (d.z < 0.4) d.z = 0.4;
    return d.normalize();
  }
  let handLRef = null;

  // ---------------- right rig ----------------
  const rigR = new THREE.Group(); rigR.position.copy(BASE_R); sway.add(rigR);
  const animR = new THREE.Group(); rigR.add(animR);
  const wristR = new THREE.Group(); animR.add(wristR);
  const pivotR = new THREE.Group(); wristR.add(pivotR);
  const handR = buildHand({ ...F.hands.R, detail: 1 });
  const holdR = HOLDS[F.hold] ?? HOLDS.staff;
  applyHold(pivotR, holdR);
  const gripR = F.rightGrip ?? { kind: 'pole', r: 0.017 };
  let restPoseR;
  const holderR = new THREE.Group();
  pivotR.add(holderR);
  if (gripR.kind === 'pole') {
    const gp = gripPose(gripR.r);
    restPoseR = gp.pose;
    // holder = inverse of the grip frame expressed in hand space
    const m = new THREE.Matrix4().compose(gp.gripPos, new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, Math.PI / 2)), V(1, 1, 1)).invert();
    m.decompose(holderR.position, holderR.quaternion, holderR.scale);
    if (F.right) pivotR.add(F.right);
  } else {
    restPoseR = clonePose(POSES[gripR.kind] ?? POSES.relaxed);
    holderR.position.set(0, 0.02, 0.06);
    if (F.right) holderR.add(F.right);
  }
  holderR.add(handR.group);
  handR.setPose(restPoseR);
  // wrist position in animR space so rotations pivot there
  root.updateWorldMatrix(true, true);
  const wristLocalR = V(0, 0, 0).applyMatrix4(handR.group.matrixWorld);
  animR.worldToLocal(wristLocalR);
  wristR.position.copy(wristLocalR);
  pivotR.position.sub(wristLocalR);
  const sleeveR = makeSleeve(rigR, wristLocalR, sleeveDir(handR), 3, handR);
  const sleeveRBase = { pos: sleeveR.position.clone(), q: sleeveR.quaternion.clone(), wrist: wristLocalR.clone(), elbow: wristLocalR.clone().addScaledVector(V(0, 1, 0).applyQuaternion(sleeveR.quaternion), 0.55) };

  // ---------------- left rig (mirrored) ----------------
  const rigL = new THREE.Group(); rigL.position.copy(BASE_L); rigL.scale.x = -1; sway.add(rigL);
  const animL = new THREE.Group(); rigL.add(animL);
  const wristL = new THREE.Group(); animL.add(wristL);
  const pivotL = new THREE.Group(); wristL.add(pivotL);
  const handL = buildHand({ ...F.hands.L, detail: 1 });
  handLRef = handL;
  const lg = F.leftGrip ?? { kind: 'open' };
  const leftHoldName = F.leftHold ?? (lg.kind === 'pole' ? 'staff' : lg.kind === 'cradle' ? 'cradle' : lg.kind === 'spread' ? 'spread' : 'open');
  const holdL = HOLDS_L[leftHoldName] ?? HOLDS_L.open;
  applyHold(pivotL, holdL);
  const holderL = new THREE.Group(); pivotL.add(holderL);
  let restPoseL;
  if (lg.kind === 'pole') {
    const gp = gripPose(lg.r);
    restPoseL = gp.pose;
    const m = new THREE.Matrix4().compose(gp.gripPos, new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, Math.PI / 2)), V(1, 1, 1)).invert();
    m.decompose(holderL.position, holderL.quaternion, holderL.scale);
    if (F.left) pivotL.add(F.left);
  } else {
    restPoseL = clonePose(POSES[lg.kind] ?? POSES.open);
    holderL.position.set(0, 0.015, 0.06);
    if (F.left) handL.group.add(F.left);
  }
  holderL.add(handL.group);
  handL.setPose(restPoseL);
  root.updateWorldMatrix(true, true);
  const wristLocalL = V(0, 0, 0).applyMatrix4(handL.group.matrixWorld);
  animL.worldToLocal(wristLocalL);
  wristL.position.copy(wristLocalL);
  pivotL.position.sub(wristLocalL);
  const sleeveL = makeSleeve(rigL, wristLocalL, sleeveDir(handL), 7, handL);
  const sleeveLBase = { pos: sleeveL.position.clone(), q: sleeveL.quaternion.clone(), wrist: wristLocalL.clone(), elbow: wristLocalL.clone().addScaledVector(V(0, 1, 0).applyQuaternion(sleeveL.quaternion), 0.55) };

  // floating item (arcanist book) follows the left rig with lag
  let floatG = null;
  const floatPos = V(), floatTarget = V();
  if (F.float) {
    floatG = new THREE.Group();
    floatG.add(F.float);
    sway.add(floatG);
  }

  const fxL = F.leftFx ? F.leftFx(handL) : null;
  const fxR = F.rightFx ? F.rightFx(handR) : null;

  // dim this instance's glow (see VIEW_GLOW). Animated glows are rescaled at
  // the source; the rest (static halos and accents) once, here.
  for (const it of glows.items) it.k *= it.kind === 'basic' ? VIEW_GLOW : VIEW_EMISSIVE;
  {
    const animated = new Set(glows.items.map((it) => it.mat));
    root.traverse((o) => {
      const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
      for (const m of mats) {
        if (animated.has(m) || m.userData.shared || m.userData.vmDim) continue;
        if (m.userData.glow) { m.color.multiplyScalar(VIEW_GLOW); m.userData.vmDim = true; }
        else if (m.userData.glowStd || (m.emissiveIntensity > 0.5 && m.emissive && m.emissive.getHex() !== 0)) { m.emissiveIntensity *= VIEW_EMISSIVE; m.userData.vmDim = true; }
      }
    });
  }

  // muzzles
  const muzzle = F.tip ?? F.handTip?.(handR) ?? handR.palmCenter;
  const offhand = new THREE.Object3D();
  offhand.position.set(0, -0.045, -0.06);
  handL.group.add(offhand);

  // light near the focus
  // class light: hovers in front of the focus head, toward the camera, so it
  // lights the focus and both hands without blowing out the shaft
  const light = new THREE.PointLight(F.light?.color ?? meta.color, 0.8, 2, 2);
  root.add(light);
  const lightAnchor = F.lightAnchor ?? muzzle;
  const lightOffset = V(-0.14, -0.18, 0.26);
  const lightBase = 0.8;

  // ---------------- state ----------------
  const sR = new Spring(6, 700, 0.42), sL = new Spring(6, 700, 0.42);
  const sSway = new Spring(5, 120, 0.5); // x,y offsets + yaw,pitch,roll
  const sLand = new Spring(1, 160, 0.35);
  let bobPhase = 0, bobAmp = 0;
  let wasGrounded = true;
  let lastCastT = -1, lastCastKey = '';
  let prevHurt = 0;
  let power = 0;
  let downedK = 0, dashK = 0, chargeK = 0;
  let flare = 0;
  const poseR = clonePose(restPoseR), poseL = clonePose(restPoseL);
  const tmp6 = [0, 0, 0, 0, 0, 0];
  const prevPosR = V(), prevPosL = V(), velR = V(), velL = V(), accR = V(), accL = V(), prevVelR = V();
  const tmpV = V();
  const tmpV2 = V(), UPV = V(0, 1, 0);
  let first = true;
  const st = { charge: 0, power: 0, glow: 1, castK: 0, accelR: accR, accelL: accL, view: true, up: root };

  function freePose(hand, pose, rest, name, k, dt) {
    const target = name ? POSES[name] : rest;
    lerpPose(pose, target, 1 - Math.exp(-dt * k), pose);
    hand.setPose(pose);
  }

  function update(dt, s = {}) {
    dt = Math.min(Math.max(dt, 0), 0.05);
    const t = s.t ?? 0;
    const speed = THREE.MathUtils.clamp(s.speed ?? 0, 0, 1);
    const cast = s.cast ?? null;
    const charge = THREE.MathUtils.clamp(s.charge ?? 0, 0, 1);
    chargeK += (charge - chargeK) * (1 - Math.exp(-dt * 12));
    downedK += ((s.downed ? 1 : 0) - downedK) * (1 - Math.exp(-dt * 4));
    dashK += ((s.dash ? 1 : 0) - dashK) * (1 - Math.exp(-dt * 14));

    // --- walk bob (figure 8 with footstep dips) ---
    const grounded = s.grounded ?? true;
    bobAmp += ((grounded ? speed : 0) - bobAmp) * (1 - Math.exp(-dt * 6));
    bobPhase += dt * (4.6 + speed * 1.4) * (grounded ? 1 : 0.2);
    const bx = Math.sin(bobPhase) * 0.011 * bobAmp;
    const by = -Math.abs(Math.cos(bobPhase)) * 0.012 * bobAmp + 0.006 * bobAmp;
    const broll = Math.sin(bobPhase) * 0.025 * bobAmp;
    // idle breathing
    const bx2 = wob(t * 0.35, 1) * 0.002, by2 = Math.sin(t * 1.6) * 0.0035;

    // --- landing ---
    if (grounded && !wasGrounded) sLand.v[0] -= 0.9;
    wasGrounded = grounded;
    sLand.target[0] = 0; sLand.step(dt);

    // --- look sway (hands lag behind rotation) ---
    const lx = THREE.MathUtils.clamp(s.look?.x ?? 0, -200, 200), ly = THREE.MathUtils.clamp(s.look?.y ?? 0, -200, 200);
    sSway.target[0] = THREE.MathUtils.clamp(-lx * 0.00028, -0.035, 0.035);
    sSway.target[1] = THREE.MathUtils.clamp(ly * 0.00028, -0.03, 0.03);
    sSway.target[2] = THREE.MathUtils.clamp(-lx * 0.0012, -0.12, 0.12);
    sSway.target[3] = THREE.MathUtils.clamp(-ly * 0.0009, -0.1, 0.1);
    sSway.target[4] = THREE.MathUtils.clamp(lx * 0.0012, -0.1, 0.1);
    sSway.step(dt);
    sway.position.set(bx + bx2 + sSway.x[0], by + by2 + sSway.x[1] + sLand.x[0] * 0.06, 0);
    sway.rotation.set(sSway.x[3], sSway.x[2], broll + sSway.x[4]);

    // --- hurt flinch ---
    const hurt = s.hurt ?? 0;
    if (hurt > prevHurt + 0.05) {
      const k = hurt - prevHurt;
      for (const sp of [sR, sL]) {
        sp.v[0] += (Math.random() - 0.5) * 1.2 * k; sp.v[1] -= 0.8 * k; sp.v[2] += 1.6 * k;
        sp.v[3] += 6 * k; sp.v[5] += (Math.random() - 0.5) * 6 * k;
      }
    }
    prevHurt = hurt;

    // --- cast ---
    let castR = null, castL = null, castT = 0;
    if (cast) {
      castT = cast.t ?? 0;
      const key = `${cast.slot}:${cast.style}:${cast.hand}`;
      const isNew = castT < lastCastT - 1e-4 || key !== lastCastKey || lastCastT < 0;
      if (isNew) flare = 1;
      lastCastT = castT; lastCastKey = key;
      const style = STYLES[cast.style] ? cast.style : 'flick';
      const hand = cast.hand ?? (style === 'throw' || style === 'snap' ? 'left' : 'right');
      if (hand === 'right' || hand === 'both') castR = style;
      if (hand === 'left' || hand === 'both') castL = style;
    } else {
      lastCastT = -1; lastCastKey = '';
    }
    flare *= Math.exp(-dt * 6);

    const applyRig = (sp, castStyle, isRight) => {
      const tg = sp.target;
      for (let i = 0; i < 6; i++) tg[i] = 0;
      if (castStyle) {
        const S = STYLES[castStyle];
        let tt = castT;
        if (S.hold) tt = Math.min(castT, S.keys[S.keys.length - 1][0]);
        sampleKeys(S.keys, tt, tmp6);
        for (let i = 0; i < 6; i++) tg[i] += tmp6[i];
        if (castStyle === 'channel') {
          tg[0] += wob(t * 23, 1) * 0.004; tg[1] += wob(t * 29, 2) * 0.004; tg[3] += wob(t * 19, 3) * 0.025; tg[5] += wob(t * 17, 4) * 0.025;
        }
      }
      // charge: pull in and tremble
      tg[1] += chargeK * 0.02; tg[2] += chargeK * 0.025; tg[3] += chargeK * 0.08;
      tg[0] += wob(t * 31, isRight ? 5 : 6) * 0.0025 * chargeK; tg[1] += wob(t * 27, isRight ? 7 : 8) * 0.0025 * chargeK;
      // dash: pulled back and down
      tg[1] -= dashK * 0.07; tg[2] += dashK * 0.06; tg[3] -= dashK * 0.35; tg[0] += dashK * 0.02;
      // downed: drop low, tremble
      tg[1] -= downedK * 0.17; tg[2] += downedK * 0.04; tg[3] -= downedK * 0.4; tg[5] -= downedK * 0.2;
      tg[0] += downedK * wob(t * 37, isRight ? 9 : 10) * 0.004; tg[1] += downedK * wob(t * 41, isRight ? 11 : 12) * 0.004;
      // jump: hands float up while airborne
      if (!grounded) { tg[1] += 0.015; tg[3] += 0.06; }
      sp.k = castStyle ? (STIFF[castStyle] ?? 700) : 700;
      sp.c = 2 * 0.42 * Math.sqrt(sp.k);
      sp.step(dt);
    };
    applyRig(sR, castR, true);
    applyRig(sL, castL, false);
    animR.position.set(sR.x[0], sR.x[1], sR.x[2]);
    animR.rotation.set(sR.x[3], sR.x[4], sR.x[5]);
    animL.position.set(sL.x[0], sL.x[1], sL.x[2]);
    animL.rotation.set(sL.x[3], sL.x[4], sL.x[5]);

    // sleeves follow the wrist (position fully, rotation partially) so big
    // swings never fling the whole forearm tube across the screen
    // the sleeve aims from the animated wrist back to a fixed, off-screen elbow
    for (const [sl, base, anim] of [[sleeveR, sleeveRBase, animR], [sleeveL, sleeveLBase, animL]]) {
      anim.updateMatrix();
      tmpV.copy(base.wrist).applyMatrix4(anim.matrix);
      tmpV2.subVectors(base.elbow, tmpV).normalize();
      sl.quaternion.setFromUnitVectors(UPV, tmpV2);
      sl.position.copy(tmpV).addScaledVector(tmpV2, 0.035);
    }

    // wrist accent for flicks
    wristR.rotation.x = castR === 'flick' ? sR.x[3] * 0.5 : 0;

    // fingers
    if (gripR.kind === 'fist') {
      // armoured fist (gauntlet): keep it clenched, squeeze on cast
      handR.setPose(restPoseR);
    } else if (gripR.kind !== 'pole') {
      const name = castR ? sampleFingers(STYLES[castR].fingers, castT) : null;
      freePose(handR, poseR, restPoseR, name, 22, dt);
    } else {
      // tighten grip a little while charging / casting
      const squeeze = chargeK * 0.12 + (castR ? 0.08 : 0);
      for (let i = 0; i < 4; i++) for (let j = 0; j < 3; j++) poseR.f[i][j] = restPoseR.f[i][j] + squeeze * (j === 0 ? 0.3 : 0.15);
      handR.setPose(poseR);
    }
    if (lg.kind !== 'pole' && !F.left) {
      let name = castL ? sampleFingers(STYLES[castL].fingers, castT) : null;
      if (!name && downedK > 0.5) name = 'relaxed';
      if (!name && chargeK > 0.3) name = 'claw';
      freePose(handL, poseL, restPoseL, name, 26, dt);
      // gentle idle finger motion
      if (!name) {
        for (let i = 0; i < 4; i++) {
          const w = wob(t * 0.8 + i * 0.7, i) * 0.06;
          poseL.f[i][1] += w * dt * 2;
        }
      }
    }

    // floating book
    if (floatG) {
      animL.updateWorldMatrix(true, false);
      floatTarget.set(0.06, 0.1, -0.06).applyMatrix4(animL.matrixWorld);
      sway.worldToLocal(floatTarget);
      if (first) floatPos.copy(floatTarget);
      floatPos.lerp(floatTarget, 1 - Math.exp(-dt * 8));
      floatG.position.copy(floatPos);
      floatG.rotation.set(0.25, 0.35, 0.05);
    }

    // accelerations (for pendulums) in root space
    root.updateWorldMatrix(true, true);
    tmpV.setFromMatrixPosition(animR.matrixWorld);
    velR.subVectors(tmpV, prevPosR).divideScalar(Math.max(dt, 1e-3));
    prevPosR.copy(tmpV);
    tmpV.setFromMatrixPosition(animL.matrixWorld);
    const vl = tmpV.clone().sub(prevPosL).divideScalar(Math.max(dt, 1e-3));
    prevPosL.copy(tmpV);
    if (first) { velR.set(0, 0, 0); vl.set(0, 0, 0); }
    accR.subVectors(velR, prevVelR).divideScalar(Math.max(dt, 1e-3)).multiplyScalar(0.05);
    prevVelR.copy(velR);
    accL.copy(vl).sub(velL).divideScalar(Math.max(dt, 1e-3)).multiplyScalar(0.05);
    accL.x *= -1; // left rig is mirrored
    velL.copy(vl);
    first = false;

    // glow
    // charge / cast flare brighten the focus, but gently: it sits by the crosshair
    const glow = 1 + chargeK * 0.9 + power * 0.5 + flare * 0.6;
    // foci that write their colours directly scale them by st.glow
    st.charge = chargeK; st.power = power; st.glow = glow * VIEW_GLOW; st.castK = castR || castL ? 1 : 0;
    glows.set(glow);
    F.update?.(t, dt, st);
    fxL?.update(t, 1 + chargeK, dt);
    fxR?.update(t, 1 + chargeK, dt);
    lightAnchor.getWorldPosition(light.position);
    root.worldToLocal(light.position).add(lightOffset);
    light.intensity = lightBase * (0.85 + 0.15 * wob(t * 6, 3)) * (1 + chargeK * 1.2 + power * 0.6 + flare * 1.4);
  }

  update(0.016, { t: 0 });

  return {
    root, muzzle, offhand, light,
    update,
    setPower(k) { power = THREE.MathUtils.clamp(k ?? 0, 0, 1); },
    dispose() {
      glows.dispose();
      root.traverse((o) => {
        if (o.isMesh || o.isSprite) {
          if (o.geometry && !o.geometry.userData?.shared) o.geometry.dispose?.();
        }
      });
      root.removeFromParent();
    },
    // debugging handles
    _parts: { handR, handL, focus: F, animR, animL, pivotR, pivotL },
  };
}
