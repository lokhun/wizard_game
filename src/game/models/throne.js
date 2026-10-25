import * as THREE from 'three';
import { G, xf, taper, lathe, tube, extrude, deform, robe, panel, mergeRaw, chainSkin, spikeRing, rng, vnoise, clamp, lerp, smooth, bump, easeOut, easeIn, TAU } from './core.js';
import { humanSkeleton, humanoidPose, act2 } from './humanoid.js';
import { addSkull, addBoneHand, addPlate, addTabard, greatHelm, rivets, twoSided, HDR } from './parts.js';

// ---------------------------------------------------------------------------
// Throne-room elites: the Gilded Sentinel (a shield wall on legs) and the
// Hollow Bannerman (a standard-bearer whose war-banner empowers nearby foes).
//
// Held props that must sit squarely in the world (the tower shield, the banner
// pole) are designed in world space for the rest pose and seated on a prop bone
// under the hand: restWorld() poses the skeleton at build time and seat() turns
// a world placement into a bone-local part transform. Arm poses for the actions
// were solved numerically so the fists land where the props need them.
// On death the props are let go: dropProp() drives the prop bone in model space
// so the shield / pole tips over its bottom edge and lands flat on the floor.
// ---------------------------------------------------------------------------

const _M = new THREE.Matrix4(), _Q = new THREE.Quaternion(), _E = new THREE.Euler(), _P = new THREE.Vector3(), _S = new THREE.Vector3();

// World matrix of every bone with additive pose dicts ({ bone: [rx,ry,rz, px,py,pz] }) applied.
function restWorld(rig, poses) {
  const saved = rig.boneList.map((b) => b.position.clone());
  for (const pose of poses) for (const k in pose) {
    const b = rig.bones[k];
    if (!b) continue;
    const v = pose[k];
    b.rotation.set(b.rotation.x + (v[0] ?? 0), b.rotation.y + (v[1] ?? 0), b.rotation.z + (v[2] ?? 0));
    if (v.length > 3) b.position.add(_P.set(v[3] ?? 0, v[4] ?? 0, v[5] ?? 0));
  }
  rig.root.updateMatrixWorld(true);
  const out = {};
  for (const b of rig.boneList) out[b.name] = b.matrixWorld.clone();
  rig.boneList.forEach((b, i) => { b.rotation.set(0, 0, 0); b.position.copy(saved[i]); });
  rig.root.updateMatrixWorld(true);
  return out;
}
// part transform that puts item space (placed at world matrix W in the rest pose) onto a bone
function seatM(B, W) { return B.clone().invert().multiply(W); }
function seat(B, W) {
  _M.copy(B).invert().multiply(W);
  _M.decompose(_P, _Q, _S);
  _E.setFromQuaternion(_Q, 'XYZ');
  return { x: _P.x, y: _P.y, z: _P.z, rx: _E.x, ry: _E.y, rz: _E.z };
}
const place = (x, y, z, rx = 0, ry = 0, rz = 0) => new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(1, 1, 1));
const local = (B, x, y, z) => new THREE.Vector3(x, y, z).applyMatrix4(B.clone().invert());

// ------------------------------------------------------------- prop drop ----
const _dA = new THREE.Matrix4(), _dB = new THREE.Matrix4(), _dC = new THREE.Matrix4(), _dV = new THREE.Vector3(), _dW = new THREE.Vector3(), _dQ = new THREE.Quaternion(), _dE = new THREE.Euler(), _dS = new THREE.Vector3(), _dP = new THREE.Vector3();
// model-space matrix of a bone from its current local transforms
function modelMatrix(m, b, out) {
  out.identity();
  for (let o = b; o && o !== m.root; o = o.parent) { _dC.compose(o.position, o.quaternion, o.scale); out.premultiply(_dC); }
  return out;
}
// Let go of a prop bone: on release its current pose is captured, then it tips about `pivot` (bone-local)
// until its `up` axis lies along the fall direction, the pivot settling to `floor`. u: 0 (held) .. 1 (down).
// cfg = { key, pivot, up, floor } plus the fall direction: fwd (bone-local, flattened), or axis (bone-local hinge,
// e.g. a banner's crossbar, so the prop lands flat) with dir as the side to fall toward. State is allocated once.
function dropProp(m, P, name, cfg, u) {
  let d = m.state[cfg.key];
  if (!d) d = m.state[cfg.key] = { held: true, M0: new THREE.Matrix4(), pv: new THREE.Vector3(), ax: new THREE.Vector3(1, 0, 0), ang: 0, y0: 0 };
  if (u <= 0) { d.held = true; return; }
  const b = m.bones[name];
  if (d.held) {
    d.held = false;
    modelMatrix(m, b, d.M0);
    d.pv.copy(cfg.pivot).applyMatrix4(d.M0);
    _dV.copy(cfg.up).transformDirection(d.M0);
    if (cfg.axis) {
      _dW.copy(cfg.axis).transformDirection(d.M0);
      _dW.set(_dW.z, 0, -_dW.x); // horizontal, perpendicular to the hinge
      if (_dW.dot(cfg.dir) < 0) _dW.negate();
    } else _dW.copy(cfg.fwd).transformDirection(d.M0);
    _dW.y = 0;
    if (_dW.lengthSq() < 1e-6) _dW.set(0, 0, 1);
    _dW.normalize();
    d.ax.crossVectors(_dV, _dW);
    if (d.ax.lengthSq() < 1e-8) d.ax.set(1, 0, 0);
    d.ax.normalize();
    d.ang = Math.acos(clamp(_dV.dot(_dW), -1, 1));
    d.y0 = d.pv.y;
  }
  // M = T(pivot settled) * R(axis, angle) * T(-pivot) * M0
  _dB.copy(d.M0);
  _dA.makeTranslation(-d.pv.x, -d.pv.y, -d.pv.z); _dB.premultiply(_dA);
  _dQ.setFromAxisAngle(d.ax, d.ang * u); _dA.makeRotationFromQuaternion(_dQ); _dB.premultiply(_dA);
  _dA.makeTranslation(d.pv.x, lerp(d.y0, cfg.floor ?? 0, clamp(u)), d.pv.z); _dB.premultiply(_dA);
  // into the parent's frame -> bone-local target, snapped (no damping lag)
  modelMatrix(m, b.parent, _dA).invert().multiply(_dB);
  _dA.decompose(_dP, _dQ, _dS);
  _dE.setFromQuaternion(_dQ, 'XYZ');
  const i = P.idx.get(name), o = i * 9, rest = P.rest[i];
  P.tgt[o] = _dE.x; P.tgt[o + 1] = _dE.y; P.tgt[o + 2] = _dE.z;
  P.tgt[o + 3] = _dP.x - rest.x; P.tgt[o + 4] = _dP.y - rest.y; P.tgt[o + 5] = _dP.z - rest.z;
  for (let k = 0; k < 9; k++) P.cur[o + k] = P.tgt[o + k];
}

// undo humanoidPose's walk arm swing / elbow flex on one side so a held prop stays put
function holdArm(P, m, s, side, k = 1) {
  const an = s.anim;
  if (an === 'death' || an === 'spawn' || an === 'windup' || an === 'attack' || an === 'cast') return;
  const st = m.state, w = st.moveW ?? 0;
  if (w < 1e-3) return;
  const A = m.spec.anim, sc = m.spec.dims.hipH / 0.97;
  const run = clamp((s.speed / sc - 2.2) / 2.5);
  const sn = Math.sin(st.phase);
  const armA = (A.armSwing ?? 0.45) * (1 + run * 0.5);
  if (side > 0) { P.r('armL', -sn * armA * w * k); P.r('foreL', (0.25 + Math.max(0, -sn) * 0.4 + run * 0.6) * w * k); }
  else { P.r('armR', sn * armA * w * k); P.r('foreR', (0.25 + Math.max(0, sn) * 0.4 + run * 0.6) * w * k); }
}

// dark padded gambeson under the plate so gaps never show the void
function underBody(rig, D, c) {
  const W = D.shoulderW;
  const tors = lathe([[0.001, -0.1], [W * 0.6, -0.08], [W * 0.66, 0.05], [W * 0.68, 0.05 + D.spine], [W * 0.78, 0.05 + D.spine + D.chest * 0.7], [W * 0.4, 0.05 + D.spine + D.chest + 0.03], [0.001, 0.08 + D.spine + D.chest]], 12);
  deform(tors, (v) => { v.z *= 0.72; });
  rig.add('hips', 'cloth', tors, {}, { c, skin: chainSkin([['hips', 0.0], ['spine', 0.05 + D.spine * 0.45], ['chest', 0.05 + D.spine + D.chest * 0.25]], (v) => v.y) });
  rig.add('neck', 'cloth', taper(0.06, 0.06, D.neck + 0.05, 8, 1), { y: D.neck + 0.02 }, { c });
  for (const S of ['L', 'R']) {
    rig.add('arm' + S, 'cloth', taper(0.055, 0.045, D.upper, 8, 1), {}, { c });
    rig.add('fore' + S, 'cloth', taper(0.048, 0.04, D.fore, 8, 1), {}, { c });
    rig.add('thigh' + S, 'cloth', taper(0.085, 0.062, D.thigh, 8, 1), {}, { c });
    rig.add('shin' + S, 'cloth', taper(0.06, 0.046, D.shin, 8, 1), {}, { c });
  }
}
// mail skirt that splits between the legs instead of following one thigh
function splitSkirt(rig, D, r1, r2, len, c, seed = 2) {
  rig.add('hips', 'mail', robe(r1, r2, len, { seg: 18, rows: 4, folds: 7, foldAmp: 0.035, tatter: 0.06, seed }), { y: -0.03, sz: 0.85 }, {
    c,
    skin: (v) => { const t = clamp((-v.y - 0.04) / (len * 0.9)) * 0.85, l = clamp(0.5 + v.x * 6); return [['hips', 1 - t], ['thighL', t * l], ['thighR', t * (1 - l)]]; },
  });
}

// ============================================================ gildedSentinel ==
const SENT_EYE = 0xb080ff;
const GILT = [0.74, 0.65, 0.47]; // tarnished gilding (on the gold surface)
const GILT_HI = [1.08, 0.95, 0.68];
const BLACKEN = [0.34, 0.31, 0.36]; // blackened steel (on the steel surface)
const PURPLE = [0.24, 0.05, 0.32];

// rest: shield arm braced behind the shield, mace low at the right side (arm angles solved for the shield grip)
const SN_REST = {
  armL: [0.132, -0.732, 0.582], foreL: [-1.225, 0, 0], handL: [0, 0, 0],
  armR: [0.499, 0.347, -0.75], foreR: [-1.491, 0, 0], handR: [-1.297, 0.079, 0],
};
// braced upper body (left shoulder slightly forward, leaning into the shield)
const SN_UPPER = { spine: [0.08, -0.12, 0], chest: [0.05, -0.05, 0], neck: [-0.05, 0.05, 0], head: [-0.1, 0.1, 0] };
// wide braced legs (faded out while walking)
const SN_LEGS = { hips: [0, 0.12, 0, 0, -0.05, 0], thighL: [-0.38, -0.12, 0.13], thighR: [0.18, -0.12, -0.14], shinL: [0.42, 0, 0], shinR: [0.32, 0, 0], footL: [0.0, 0, -0.08], footR: [-0.4, 0, 0.08] };
// shield placement in the rest pose (world): centre, lean back; grip offset from the centre (shield space)
const SH_C = [0.1, 1.0, 0.52], SH_LEAN = -0.05;
const SN_DROP = { key: 'snShield', pivot: new THREE.Vector3(), up: new THREE.Vector3(), fwd: new THREE.Vector3(), floor: 0.0 };

// tower shield in shield space: face toward +Z, up +Y, centre at origin
const SH_W = 0.84, SH_H = 1.6;
const shCurve = (x) => -0.075 * (x / (SH_W / 2)) ** 2;
const shArch = (x) => 0.05 * (1 - (x / (SH_W / 2 + 0.03)) ** 2);
function bendShield(g, arch = false) {
  return deform(g, (v) => { if (arch && v.y > 0) v.y += shArch(v.x) * clamp(v.y / (SH_H / 2)); v.z += shCurve(v.x); });
}
function addSentinelShield(rig, bone, t, grip) {
  const hw = SH_W / 2, hh = SH_H / 2;
  // battered face (dished, hammer dents), blackened plum enamel
  const face = G.box(SH_W, SH_H, 0.045, 8, 12, 1);
  deform(face, (v) => {
    const d = (vnoise(v.x * 7 + 3, v.y * 7, 1, 21) - 0.5) * 0.012 - Math.exp(-((v.x - 0.18) ** 2 + (v.y + 0.3) ** 2) / 0.004) * 0.015 - Math.exp(-((v.x + 0.22) ** 2 + (v.y - 0.05) ** 2) / 0.003) * 0.012;
    if (v.z > 0) v.z += d;
  });
  bendShield(face, true);
  rig.add(bone, 'steel', face, t, { cfn: (v) => (v.z > -0.01 ? [0.34, 0.2, 0.42] : [0.3, 0.27, 0.3]) });
  // gilded rim, two bands, a spine and corner caps
  const side = (x) => deform(xf(G.box(0.07, SH_H + 0.02, 0.075, 1, 12, 1), { x }), (v) => { v.z += shCurve(x); });
  const rim = [side(hw), side(-hw), bendShield(xf(G.box(SH_W + 0.08, 0.075, 0.075, 12, 1, 1), { y: -hh })), bendShield(xf(G.box(SH_W + 0.08, 0.075, 0.075, 12, 1, 1), { y: hh }), true)];
  const bands = [-0.52, -0.12].map((y) => bendShield(xf(G.box(SH_W, 0.065, 0.062, 12, 1, 1), { y })));
  const spine = xf(G.box(0.075, 0.68, 0.06), { y: -0.46 });
  const caps = [];
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) caps.push(xf(G.box(0.15, 0.15, 0.088), { x: sx * (hw - 0.025), y: sy * (hh - 0.025), z: shCurve(hw) }));
  rig.add(bone, 'gold', mergeRaw([...rim, ...bands, spine, ...caps]), t, { c: GILT });
  const rv = [];
  for (const y of [-0.52, -0.12]) for (let i = 0; i < 6; i++) { const x = (i / 5 - 0.5) * (SH_W - 0.14); if (Math.abs(x) > 0.05) rv.push([x, y, shCurve(x) + 0.034]); }
  for (let i = 0; i < 5; i++) for (const sx of [-1, 1]) rv.push([sx * hw, -hh + 0.22 + i * 0.29, shCurve(hw) + 0.04]);
  rig.add(bone, 'steel', rivets(rv, 0.013), t, { c: BLACKEN });
  // royal crest: crowned escutcheon bearing a sword, violet gem in the crown
  const esc = [[-0.21, 0.2], [0.21, 0.2], [0.21, 0.02], [0.16, -0.14], [0.0, -0.28], [-0.16, -0.14], [-0.21, 0.02]];
  rig.add(bone, 'gold', xf(extrude(esc, 0.03, 0.01, 1), { y: 0.24, z: 0.03 }), t, { c: GILT_HI });
  rig.add(bone, 'steel', xf(extrude(esc.map(([x, y]) => [x * 0.78, y * 0.78 + 0.005]), 0.02, 0, 1), { y: 0.24, z: 0.052 }), t, { c: [0.22, 0.1, 0.3] });
  const crown = [xf(G.box(0.4, 0.07, 0.04), { y: 0.55 }), xf(G.box(0.42, 0.02, 0.045), { y: 0.515 })];
  for (let i = 0; i < 5; i++) { const x = (i - 2) * 0.09, h = i % 2 ? 0.09 : 0.14; crown.push(xf(G.cone(0.032, h, 4), { x, y: 0.585 + h / 2, ry: Math.PI / 4, sz: 0.55 }), xf(G.sph(0.02, 6, 4), { x, y: 0.59 + h })); }
  crown.push(xf(G.box(0.026, 0.42, 0.024), { y: 0.2, z: 0.03 }), xf(G.box(0.17, 0.026, 0.026), { y: 0.33, z: 0.03 }), xf(G.cone(0.02, 0.06, 4), { y: -0.04, z: 0.03, rx: Math.PI }), xf(G.sph(0.022, 6, 4), { y: 0.43, z: 0.03 }));
  rig.add(bone, 'gold', mergeRaw(crown), t, { c: GILT_HI });
  rig.add(bone, 'glow', xf(G.oct(0.026), { y: 0.55, z: 0.045, sz: 0.5 }), t, { c: HDR(SENT_EYE, 4) });
  // back: grip bar at the fist, arm straps, braces
  const back = [xf(G.box(0.22, 0.04, 0.04), { x: grip.x, y: grip.y, z: grip.z }), xf(G.box(0.03, 0.06, grip.z * -1), { x: grip.x + 0.11, y: grip.y, z: grip.z / 2 }), xf(G.box(0.03, 0.06, grip.z * -1), { x: grip.x - 0.11, y: grip.y, z: grip.z / 2 })];
  for (const y of [0.45, -0.45]) back.push(bendShield(xf(G.box(SH_W - 0.1, 0.06, 0.03, 8, 1, 1), { y, z: -0.035 })));
  rig.add(bone, 'steel', mergeRaw(back), t, { c: BLACKEN });
}

// flanged mace in grip space (+Z), held at the palm
function addMace(rig, bone) {
  const t = { y: -0.07 };
  rig.add(bone, 'steel', xf(G.cyl(0.019, 0.022, 0.66, 8), { rx: Math.PI / 2, z: 0.2 }), t, { c: BLACKEN });
  rig.add(bone, 'cloth', xf(G.cyl(0.026, 0.026, 0.17, 8), { rx: Math.PI / 2, z: -0.01 }), t, { c: [0.16, 0.1, 0.07] });
  rig.add(bone, 'gold', mergeRaw([xf(G.sph(0.036, 8, 6), { z: -0.13 }), xf(G.cyl(0.03, 0.03, 0.03, 8), { rx: Math.PI / 2, z: 0.09 }), xf(G.cyl(0.034, 0.028, 0.05, 8), { rx: Math.PI / 2, z: 0.47 }), xf(G.tor(0.05, 0.01, 4, 10), { z: 0.5 })]), t, { c: GILT });
  const prof = [[0.035, -0.1], [0.085, -0.07], [0.105, 0.0], [0.1, 0.05], [0.07, 0.1], [0.035, 0.11]];
  const fl = [xf(G.cyl(0.045, 0.05, 0.22, 8), { rx: Math.PI / 2 }), xf(G.cone(0.035, 0.11, 6), { rx: Math.PI / 2, z: 0.16 })];
  for (let i = 0; i < 7; i++) fl.push(xf(xf(extrude(prof, 0.016, 0.004, 1), { rx: Math.PI / 2 }), { rz: (i / 7) * TAU }));
  rig.add(bone, 'steel', mergeRaw(fl), { ...t, z: 0.6 }, { c: [0.6, 0.56, 0.6] });
}

export const gildedSentinel = {
  id: 'gildedSentinel', height: 2.4, radius: 0.62, eyeColor: SENT_EYE, defaultAttack: 'bash', attackTypes: ['bash', 'slam'], flutter: 0.03,
  build(rig) {
    const D = humanSkeleton(rig, { thigh: 0.55, shin: 0.53, ankle: 0.08, hipW: 0.13, spine: 0.2, chest: 0.42, neck: 0.09, shoulderW: 0.27, shoulderDrop: 0.06, upper: 0.37, fore: 0.34 });
    rig.bone('shield', 'handL', 0, -0.07, 0);
    const RW = restWorld(rig, [SN_UPPER, SN_LEGS, SN_REST]);
    underBody(rig, D, [0.07, 0.055, 0.06]);
    // tarnished gilded plate with blackened trim; own split mail skirt and sleeves
    addPlate(rig, D, { mat: 'gold', c: GILT, bulk: 1.25, pauldron: 0.17, trim: true, trimMat: 'steel', trimC: BLACKEN, mail: false });
    splitSkirt(rig, D, D.shoulderW * 0.95, D.shoulderW * 1.12, D.thigh * 0.8, [0.6, 0.56, 0.56]);
    for (const S of ['L', 'R']) rig.add('arm' + S, 'mail', G.cyl(0.064, 0.058, D.upper, 9, true), { y: -D.upper / 2 }, { c: [0.6, 0.56, 0.56] });
    // raised haute-pieces on the pauldrons
    for (const S of ['L', 'R']) {
      const sx = S === 'L' ? 1 : -1;
      rig.add('arm' + S, 'gold', mergeRaw([xf(G.box(0.025, 0.13, 0.26), { x: -sx * 0.05, y: 0.15, rz: sx * 0.2 }), xf(G.box(0.03, 0.03, 0.27), { x: -sx * 0.055, y: 0.215, rz: sx * 0.2 })]), {}, { c: GILT_HI });
      rig.add('arm' + S, 'steel', rivets([[sx * 0.1, 0.09, 0.14], [sx * 0.15, 0.04, 0.12], [sx * 0.18, -0.02, 0.09], [sx * 0.1, 0.09, -0.14], [sx * 0.15, 0.04, -0.12]], 0.012), {}, { c: BLACKEN });
    }
    // torn purple tabard and a ragged half-cape
    addTabard(rig, D, { tatter: 0.5, seed: 8, len: 1.08, w: 0.92, depth: 1.75, cfn: (v) => (Math.abs(v.x) > 0.205 ? [0.7, 0.55, 0.28] : PURPLE) });
    const cape = panel(0.72, 1.5, { ws: 7, hs: 10, tatter: 0.4, seed: 17, curve: 0.16, taperBot: 1.25 });
    rig.add('chest', 'cloth', cape, { y: D.chest - 0.02, z: -0.28, ry: Math.PI, rx: 0.1 }, {
      cfn: (v) => (v.y > -0.06 ? [0.6, 0.46, 0.24] : [0.17, 0.035, 0.22]), anim: (v) => clamp(-v.y / 1.3) * 1.5,
      skin: chainSkin([['hips', -1.0], ['spine', -0.5], ['chest', -0.05]], (v) => v.y),
    });
    // dented great helm: violet visor slit, breaths, crown circlet and ridge
    const helm = greatHelm({ r: 0.155, h: 0.36 });
    const dents = [[0.11, 0.24, 0.09, 0.016], [-0.12, 0.12, 0.08, 0.012], [0.04, 0.3, -0.12, 0.014], [-0.1, 0.26, -0.06, 0.01]];
    deform(helm, (v) => {
      for (const [x, y, z, d] of dents) { const k = Math.exp(-((v.x - x) ** 2 + (v.y - y) ** 2 + (v.z - z) ** 2) / 0.0025) * d; const r = Math.hypot(v.x, v.z) || 1; v.x -= (v.x / r) * k; v.z -= (v.z / r) * k; }
    });
    rig.add('head', 'gold', helm, { y: -0.03 }, { c: GILT });
    rig.add('head', 'dark', G.box(0.15, 0.03, 0.05), { y: 0.155, z: 0.17 });
    rig.add('head', 'glow', G.box(0.13, 0.011, 0.012), { y: 0.155, z: 0.191 }, { c: HDR(SENT_EYE, 7) });
    rig.add('head', 'dark', mergeRaw([0, 1, 2, 3, 4, 5, 6, 7].map((i) => xf(G.box(0.009, 0.022, 0.03), { x: -0.03 - (i % 4) * 0.022, y: 0.075 - Math.floor(i / 4) * 0.036, z: 0.168 - (i % 4) * 0.012, ry: -(i % 4) * 0.15 }))));
    rig.add('head', 'gold', mergeRaw([
      xf(G.tor(0.163, 0.014, 4, 22), { rx: Math.PI / 2, y: 0.235, sy: 1.08 }),
      xf(spikeRing(0.161, 8, 0.075, 0.02, 0.235, 0.12), { sz: 1.08 }),
      xf(G.box(0.018, 0.2, 0.035), { y: 0.25, z: 0.165, rx: -0.25 }),
      xf(G.box(0.022, 0.03, 0.31), { y: 0.338, z: -0.01 }),
    ]), {}, { c: GILT_HI });
    rig.add('head', 'glow', mergeRaw([1, 3, 5, 7].map((i) => xf(G.oct(0.012), { x: Math.sin(i / 8 * TAU) * 0.166, z: Math.cos(i / 8 * TAU) * 0.176, y: 0.235 }))), {}, { c: HDR(SENT_EYE, 3) });
    rig.add('neck', 'glow', xf(G.tor(0.075, 0.008, 3, 14), { rx: Math.PI / 2 }), { y: 0.075 }, { c: HDR(SENT_EYE, 1.6) });
    // tower shield squarely in front of the body
    const SW = place(SH_C[0], SH_C[1], SH_C[2], SH_LEAN);
    const Ls = seatM(RW.shield, SW);
    const grip = local(SW, ...new THREE.Vector3().setFromMatrixPosition(RW.shield).toArray());
    addSentinelShield(rig, 'shield', seat(RW.shield, SW), grip);
    SN_DROP.pivot.set(0, -SH_H / 2, 0.045).applyMatrix4(Ls);
    SN_DROP.up.set(0, 1, 0).transformDirection(Ls);
    SN_DROP.fwd.set(0, 0, 1).transformDirection(Ls);
    addMace(rig, 'handR');
    rig.socket('muzzle', 'handR', 0, -0.07, 0.62);
    return D;
  },
  pose(m, s, P, dt) {
    if (s.anim === 'cast') s.attackType = 'cast';
    const r = humanoidPose(m, s, P, dt);
    holdArm(P, m, s, 1, 0.85);
    holdArm(P, m, s, -1, 0.8);
    const an = s.anim, T = m.time, w = m.state.moveW ?? 0;
    // heavy stomp: the shield shudders on each footfall
    if (an === 'move' || w > 0.02) {
      const hit = Math.abs(Math.cos(m.state.phase)) ** 6 * w;
      P.r('shield', hit * 0.03, 0, Math.sin(m.state.phase) * 0.02 * w);
      P.r('chest', hit * 0.03);
    }
    if (an === 'idle') P.r('shield', Math.sin(T * 0.9 + m.seed * 5) * 0.012, 0, Math.sin(T * 0.6) * 0.01);
    // death: the shield slips off the arm and slams flat on the floor
    if (an === 'death') { const u = easeIn(smooth(0.36, 0.58, s.progress)); dropProp(m, P, 'shield', SN_DROP, u - bump(0.58, 0.68, s.progress) * 0.025); }
    else dropProp(m, P, 'shield', SN_DROP, 0);
    return r;
  },
  anim: {
    gait: 'plod', armSwing: 0.12, stride: 0.42, strideK: 0.12, knee: 0.6, breath: 1.0, look: 0.35, armOut: 0, rate: 10,
    // a corpse lays its weapon flat instead of standing it 1 m+ out of the body or the floor (scripts/grip.js)
    deathGrip: [{ handR: [-1.6, 0, -1.2] }, { handR: [-1.6, 0, -1.2] }],
    rest: SN_REST,
    stance: (P, m, s) => {
      if (s.anim === 'death') return;
      P.apply(SN_UPPER);
      P.apply(SN_LEGS, 1 - (m.state.moveW ?? 0));
      P.p('chest', 0, Math.sin(m.time * 1.0 + m.seed * 6) * 0.006, 0);
    },
    // shield arm knocked wide, body exposed
    stagger: {
      armL: [0.3, 0.3, 0.9], foreL: [0.7, 0, 0], shield: [0.1, 0.6, 0.2],
      chest: [-0.22, 0.42, 0.05], spine: [-0.18, 0.18, 0], head: [-0.3, 0.25, 0.1], neck: [-0.12, 0, 0],
      armR: [0.35, 0, -0.5], foreR: [-0.4, 0, 0], hips: [0, 0.1, 0, 0, -0.05, -0.12], thighL: [-0.3, 0, 0.05], shinL: [0.4, 0, 0], thighR: [0.15, 0, -0.05],
    },
    actions: {
      // draw the shield back, then a lunging shield-slam
      bash: act2(
        { armL: [0.06, -1.297, 0.708], foreL: [-0.94, 0, 0], shield: [-0.088, 0.247, 0.001], armR: [0.25, 0, -0.35], foreR: [-0.7, 0, 0], handR: [0.7, 0, 0], chest: [-0.06, 0.38, 0], spine: [0.0, 0.18, 0], head: [-0.05, -0.35, 0], hips: [0, 0.15, 0, 0, -0.1, -0.12], thighL: [-0.1, 0, 0.05], shinL: [0.4, 0, 0], thighR: [0.3, 0, -0.05], shinR: [0.4, 0, 0] },
        { armL: [-0.156, 0.183, 0.998], foreL: [-1.831, 0, 0], shield: [0.345, 0.259, -0.354], armR: [0.45, 0, -0.4], foreR: [-0.6, 0, 0], handR: [0.6, 0, 0], chest: [0.22, -0.35, 0], spine: [0.2, -0.2, 0], head: [-0.25, 0.3, 0], hips: [0, -0.15, 0, 0, -0.14, 0.42], thighL: [-0.6, 0, 0], shinL: [0.55, 0, 0], thighR: [0.4, 0, 0], shinR: [0.25, 0, 0], footR: [0.3, 0, 0] },
        { hit: 0.22, recover: 0.62, recoverAmt: 0.6, tremble: 0.02 },
      ),
      // overhead mace smash over the shield rim
      slam: act2(
        { armL: [0.384, -0.337, 0.682], foreL: [-1.175, 0, 0], shield: [-0.048, 0.312, 0.002], armR: [-2.9, 0.1, -0.3], foreR: [-1.35, 0, 0], handR: [-0.2, 0, 0], chest: [-0.2, -0.3, 0], spine: [-0.1, -0.12, 0], head: [-0.05, 0.2, 0], hips: [0, 0, 0, 0, -0.04, -0.06], thighL: [-0.1, 0, 0], shinL: [0.1, 0, 0], thighR: [0.1, 0, 0] },
        { armL: [-0.223, -0.338, 1.155], foreL: [-2.021, 0, 0], shield: [0.391, 0.498, -0.058], armR: [-0.85, 0, -0.5], foreR: [-0.12, 0, 0], handR: [0.75, 0, 0], chest: [0.42, 0.15, 0], spine: [0.3, 0.06, 0], head: [-0.4, -0.2, 0], neck: [-0.1, 0, 0], hips: [0, 0.1, 0, 0, -0.2, 0.18], thighL: [-0.5, 0, 0], shinL: [0.6, 0, 0], thighR: [0.1, 0, 0], shinR: [0.35, 0, 0] },
        { hit: 0.26, recover: 0.65, tremble: 0.03 },
      ),
      // brace: plant the shield and crouch behind it
      cast: act2(
        { ...SN_REST, chest: [0.1, -0.1, 0], hips: [0, 0, 0, 0, -0.08, 0] },
        { ...SN_REST, armL: [0.051, -0.305, 0.527], foreL: [-1.788, 0, 0], shield: [0.23, -0.247, -0.071], chest: [0.25, -0.15, 0], spine: [0.15, 0, 0], head: [-0.3, 0, 0], hips: [0, 0, 0, 0, -0.22, -0.04], thighL: [-0.5, 0, 0], shinL: [0.7, 0, 0], thighR: [-0.2, 0, 0], shinR: [0.8, 0, 0], footR: [-0.3, 0, 0] },
        { hit: 0.3, recover: 0.85, recoverAmt: 0.4 },
      ),
    },
    death: (P, p, m) => sentinelDeath(P, p, m),
    spawn: (P, p, m) => sentinelSpawn(P, p, m),
  },
};

// sag to the knees with the shield planted, then pitch forward onto the fallen shield
const SN_KNEEL = {
  hips: [0.1, 0, 0, 0, -0.5, -0.1], thighL: [-0.22, 0, 0.1], shinL: [1.7, 0, 0], footL: [1.1, 0, 0], thighR: [-0.12, 0, -0.1], shinR: [1.65, 0, 0], footR: [1.1, 0, 0],
  spine: [0.32, 0, 0], chest: [0.15, 0, 0], neck: [0.2, 0, 0], head: [0.35, 0, 0],
  armL: [-0.475, -0.616, 0.791], foreL: [-1.8, 0, 0], shield: [0.543, 0.198, -0.248], armR: [0.05, 0, -0.18], foreR: [-0.3, 0, 0], handR: [0.4, 0, 0],
};
const SN_FALLEN = {
  hips: [1.42, 0.2, 0, 0, -0.86, 0.35], thighL: [-0.15, 0, 0.15], shinL: [0.35, 0, 0], thighR: [-0.3, 0, -0.12], shinR: [0.8, 0, 0], footL: [0.5, 0, 0], footR: [0.5, 0, 0],
  spine: [0.05, 0, 0], chest: [0, 0, 0], neck: [-0.15, 0, 0], head: [-0.25, 1.0, 0.1],
  armL: [-2.5, 0, 0.5], foreL: [-0.2, 0, 0], armR: [0.25, 0, -0.95], foreR: [-0.4, 0, 0], handR: [0.5, 0, 0],
};
function sentinelDeath(P, p, m) {
  const a = smooth(0, 0.34, p), b = easeIn(smooth(0.5, 0.86, p));
  P.apply(SN_UPPER, 1 - a);
  P.apply(SN_REST, 1 - a);
  P.apply(SN_KNEEL, a * (1 - b));
  P.apply(SN_FALLEN, b);
  // the hips swing over the planted knees in an arc rather than cutting through the floor
  const arc = bump(0.5, 0.86, p);
  P.p('hips', 0, arc * 0.14 + bump(0, 0.34, p) * 0.13, arc * 0.1);
  P.r('thighL', -arc * 0.25); P.r('thighR', -arc * 0.25);
  // heavy landing jolt
  const thud = bump(0.86, 0.97, p);
  P.p('hips', 0, thud * 0.035, 0);
  P.r('head', -thud * 0.15, 0, 0);
  return 11;
}
function sentinelSpawn(P, p, m) {
  // rises out of the floor shield-first, then stands into the brace
  const u = easeOut(smooth(0, 0.7, p));
  P.p('base', 0, -(1 - u) * 2.3, 0);
  const k = 1 - smooth(0.55, 1, p);
  P.apply(SN_KNEEL, k);
  P.r('base', Math.sin(m.time * 6) * 0.03 * k, 0, Math.sin(m.time * 5) * 0.04 * k);
  return 14;
}

// =========================================================== hollowBannerman ==
const BAN_GLOW = 0xb070ff;
const BONE = [0.8, 0.76, 0.64];
const ROYAL = [0.3, 0.06, 0.55];
const GOLDC = [1.0, 0.8, 0.4];

// hunched bearer: right fist holds the pole upright at chest height, left hand above it (angles solved)
const BN_UPPER = { spine: [0.2, 0, 0], chest: [0.12, 0, 0], neck: [-0.12, 0, 0], head: [-0.15, 0, 0] };
const BN_REST = {
  armR: [0.203, 0.281, -0.56], foreR: [-1.638, 0, 0], handR: [-0.567, -0.378, 0],
  armL: [-1.104, -1.065, -0.493], foreL: [-1.761, 0, 0], handL: [0.567, 0.255, 0],
};
const BN_LEGS = { thighL: [-0.12, 0, 0.06], thighR: [0.05, 0, -0.06], shinL: [0.2, 0, 0], shinR: [0.15, 0, 0], hips: [0, 0, 0, 0, -0.02, 0] };
const POLE_LEAN = 0.05;
const POLE_LO = -0.88, POLE_HI = 2.1; // pole span along its axis from the right fist (spear butt below POLE_LO)
const BAR_Y = 1.9; // crossbar height on the pole
const BAN_W = 0.9, BAN_H = 1.4;
const BN_DROP = { key: 'bnPole', pivot: new THREE.Vector3(), up: new THREE.Vector3(), axis: new THREE.Vector3(), dir: new THREE.Vector3(0, 0, 1), floor: 0.075 };

// banner cloth in banner space: hangs from y=0 to -BAN_H, inner (pole) edge at x=0, fly end toward -x.
// Closely spaced vertex columns / rows keep the gold border crisp in vertex colour.
function bannerCloth() {
  const xs = [0, 0.05, 0.058, 0.15, 0.25, 0.35, 0.45, 0.55, 0.65, 0.75, 0.842, 0.85, 0.9].map((x) => -x);
  const ys = [0, 0.05, 0.058, 0.15, 0.26, 0.37, 0.48, 0.59, 0.7, 0.81, 0.92, 1.02, 1.1, 1.16, 1.168, 1.24, 1.32, 1.4];
  // swallowtail: notch cut into the fly end
  const len = (x) => { const u = -x / BAN_W; return BAN_H - 0.32 * Math.max(0, 1 - Math.abs(u - 0.6) / 0.4) * smooth(0.15, 0.6, u); };
  const R = rng(31);
  const jag = xs.map(() => (R() - 0.5) * 0.07);
  const pos = [], idx = [];
  for (let j = 0; j < ys.length; j++) for (let i = 0; i < xs.length; i++) {
    const t = ys[j] / BAN_H;
    const L = len(xs[i]) + (j === ys.length - 1 ? jag[i] : 0);
    pos.push(xs[i], -t * L, Math.sin(t * 5 + xs[i] * 4) * 0.015 * t);
  }
  const NX = xs.length;
  for (let j = 0; j < ys.length - 1; j++) for (let i = 0; i < NX - 1; i++) {
    if ((j === 13 && i === 8) || (j === 9 && i === 10) || (j === 15 && i === 4) || (j === 16 && i === 6)) continue; // torn holes
    const a = j * NX + i, b = a + NX;
    idx.push(a, a + 1, b, b, a + 1, b + 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx); g.computeVertexNormals();
  return g;
}
const bannerAnim = (v) => clamp(-v.y / BAN_H) ** 0.85 * (0.35 + 0.65 * clamp(-v.x / BAN_W)) * 2.6;
function bannerColor(v) {
  const x = -v.x, y = -v.y;
  return x > 0.054 && x < 0.846 && y > 0.054 && y < 1.164 ? ROYAL : GOLDC;
}

// morion helm (comb + narrow brim sweeping up into front/back points) in head space
function morion() {
  const dome = lathe([[0.122, 0.11], [0.126, 0.16], [0.112, 0.215], [0.08, 0.25], [0.035, 0.265], [0.001, 0.268]], 16);
  deform(dome, (v) => { v.z *= 1.12; });
  const comb = xf(extrude([[0.13, 0.2], [0.11, 0.28], [0.06, 0.35], [-0.02, 0.38], [-0.1, 0.355], [-0.14, 0.28], [-0.15, 0.2]], 0.014, 0.004, 1), { ry: -Math.PI / 2 });
  const AS = 32, pos = [], idx = [];
  const brimR = (a) => 0.146 + 0.055 * Math.abs(Math.cos(a)) ** 4;
  const brimY = (a, k) => 0.112 + k * (0.13 * Math.abs(Math.cos(a)) ** 3.5 - 0.014);
  for (let i = 0; i <= AS; i++) {
    const a = (i / AS) * TAU;
    pos.push(Math.sin(a) * 0.121, brimY(a, 0), Math.cos(a) * 0.121 * 1.12);
    pos.push(Math.sin(a) * brimR(a), brimY(a, 1) + 0.01, Math.cos(a) * brimR(a) * 1.12);
  }
  for (let i = 0; i < AS; i++) { const a = i * 2, b = a + 2; idx.push(a, a + 1, b, b, a + 1, b + 1); }
  let brim = new THREE.BufferGeometry();
  brim.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  brim.setIndex(idx); brim.computeVertexNormals();
  brim = twoSided(brim);
  const edge = [];
  for (let i = 0; i <= 32; i++) { const a = (i / 32) * TAU; edge.push([Math.sin(a) * brimR(a), brimY(a, 1) + 0.01, Math.cos(a) * brimR(a) * 1.12]); }
  return { shell: mergeRaw([dome, comb]), brim, rim: tube(edge, 0.0065, 64, 4, true) };
}

export const hollowBannerman = {
  id: 'hollowBannerman', height: 2.0, radius: 0.42, eyeColor: BAN_GLOW, magicColor: BAN_GLOW, defaultAttack: 'jab', attackTypes: ['rally', 'jab'], flutter: 0.035, orbSize: 0.09,
  build(rig) {
    const D = humanSkeleton(rig, { thigh: 0.45, shin: 0.44, ankle: 0.07, hipW: 0.1, spine: 0.16, chest: 0.31, neck: 0.09, shoulderW: 0.19, upper: 0.3, fore: 0.28, jaw: [0.045, 0.03] });
    rig.bone('pole', 'handR', 0, -0.07, 0);
    let RW = restWorld(rig, [BN_UPPER, BN_LEGS, BN_REST]);
    // pole frame: through the right fist, upright with a slight forward lean; crossbar bone for the cloth
    const fist = new THREE.Vector3().setFromMatrixPosition(RW.pole);
    const PW = place(fist.x, fist.y, fist.z, POLE_LEAN, 0, 0.02);
    const bar = new THREE.Vector3(0, BAR_Y, 0).applyMatrix4(PW);
    const lb = local(RW.pole, bar.x, bar.y, bar.z);
    rig.bone('flag', 'pole', lb.x, lb.y, lb.z, { rate: 0.45 });
    RW = restWorld(rig, [BN_UPPER, BN_LEGS, BN_REST]);
    const tPole = seat(RW.pole, PW);
    const tFlag = seat(RW.flag, place(bar.x, bar.y, bar.z, POLE_LEAN, 0, 0.02));
    const Lp = seatM(RW.pole, PW);
    BN_DROP.pivot.set(0, POLE_LO - 0.2, 0).applyMatrix4(Lp);
    BN_DROP.up.set(0, 1, 0).transformDirection(Lp);
    BN_DROP.axis.set(1, 0, 0).transformDirection(Lp);

    // --- body: bone hands / neck, chain hauberk, ragged royal surcoat
    rig.add('neck', 'bone', G.cyl(0.018, 0.022, D.neck + 0.03, 6), { y: D.neck / 2 }, { c: BONE });
    for (const S of ['L', 'R']) addBoneHand(rig, 'hand' + S, S === 'L' ? 1 : -1, { mat: 'bone', c: BONE, s: 1.1, grip: true });
    const W = D.shoulderW;
    const mailTorso = lathe([[W * 0.82, -0.05], [W * 0.78, 0.05 + D.spine * 0.5], [W * 0.82, 0.05 + D.spine + D.chest * 0.5], [W * 0.92, 0.05 + D.spine + D.chest * 0.85], [W * 0.5, 0.06 + D.spine + D.chest], [0.05, 0.1 + D.spine + D.chest]], 14);
    deform(mailTorso, (v) => { v.z *= 0.7; if (v.z < 0) v.z -= clamp((v.y - D.spine) / D.chest) ** 2 * 0.04; });
    rig.add('hips', 'mail', mailTorso, {}, { c: [0.72, 0.7, 0.72], skin: chainSkin([['hips', 0.0], ['spine', 0.05 + D.spine * 0.45], ['chest', 0.05 + D.spine + D.chest * 0.25]], (v) => v.y) });
    splitSkirt(rig, D, W * 0.82, W * 1.08, D.thigh * 0.9, [0.7, 0.68, 0.7], 4);
    // ragged surcoat front/back: royal purple with gold border, a gold crown on the chest
    const scLen = D.spine + D.thigh * 1.05 + 0.25, scW = W * 1.9;
    for (const [z, ry, sd] of [[1, 0, 3], [-1, Math.PI, 6]]) {
      const pg = panel(scW, scLen, { ws: 7, hs: 9, tatter: 0.5, seed: sd, curve: 0.09, taperBot: 1.12 });
      rig.add('chest', 'cloth', pg, { y: D.chest * 0.92, z: z * 0.155, ry, rx: -z * 0.17 }, {
        cfn: (v) => (Math.abs(v.x) > scW * 0.41 || (v.y < -scLen * 0.84 && v.y > -scLen * 0.89) ? [0.75, 0.56, 0.26] : ROYAL),
        anim: (v) => clamp((-v.y - D.chest * 0.6) / scLen) * 1.3,
        skin: chainSkin([['hips', -D.spine - 0.4], ['spine', -D.spine * 0.5], ['chest', 0.0]], (v) => v.y),
      });
    }
    const crownMotif = mergeRaw([xf(G.box(0.12, 0.028, 0.012), {}), ...[-1, 0, 1].map((i) => xf(G.cone(0.018, i === 0 ? 0.07 : 0.05, 4), { x: i * 0.045, y: 0.04, ry: Math.PI / 4, sz: 0.5 }))]);
    rig.add('chest', 'gold', crownMotif, { y: D.chest * 0.3, z: 0.168, rx: 0.07 }, { c: GOLDC });
    // tattered shoulder mantle + rope belt with a gold buckle
    rig.add('chest', 'cloth', robe(0.09, 0.21, 0.22, { seg: 16, rows: 2, folds: 7, foldAmp: 0.12, tatter: 0.3, seed: 9 }), { y: D.chest + 0.08, sz: 0.85 }, { cfn: (v) => (v.y > -0.03 ? [0.6, 0.45, 0.22] : [0.2, 0.05, 0.27]), anim: (v) => clamp(-v.y * 3) * 0.6 });
    rig.add('hips', 'cloth', xf(G.tor(W * 0.9, 0.018, 4, 18), { rx: Math.PI / 2, sz: 0.85 }), { y: 0.06 }, { c: [0.25, 0.17, 0.1] });
    rig.add('hips', 'gold', xf(G.box(0.05, 0.045, 0.02), {}), { y: 0.06, z: W * 0.9 * 0.85 + 0.01 }, { c: GOLDC });
    // limbs: mail sleeves, bony forearms in rags, bony legs with wrapped shins, bone feet
    const shaft = (len, r) => mergeRaw([xf(G.cyl(r * 0.8, r * 0.7, len, 6), { y: -len / 2 }), xf(G.sph(r * 1.5, 6, 5), { y: -r * 0.6, sx: 1.3 }), xf(G.sph(r * 1.35, 6, 5), { y: -len + r * 0.6, sx: 1.3 })]);
    for (const S of ['L', 'R']) {
      const sx = S === 'L' ? 1 : -1;
      rig.add('arm' + S, 'mail', robe(0.05, 0.06, D.upper * 0.8, { seg: 9, rows: 2, folds: 4, foldAmp: 0.05, tatter: 0.1, seed: 2 + sx }), { y: 0.02 }, { c: [0.7, 0.68, 0.7] });
      rig.add('fore' + S, 'bone', shaft(D.fore, 0.019), { x: sx * 0.012 }, { c: BONE });
      rig.add('fore' + S, 'bone', G.cyl(0.011, 0.012, D.fore * 0.88, 5), { x: -sx * 0.016, y: -D.fore / 2 }, { c: BONE });
      rig.add('fore' + S, 'cloth', robe(0.045, 0.05, D.fore * 0.45, { seg: 8, rows: 2, folds: 4, foldAmp: 0.15, tatter: 0.5, seed: 5 + sx }), {}, { c: [0.2, 0.05, 0.26], anim: (v) => clamp(-v.y * 4) * 0.5 });
      rig.add('thigh' + S, 'bone', shaft(D.thigh, 0.03), {}, { c: BONE });
      rig.add('shin' + S, 'bone', shaft(D.shin, 0.026), {}, { c: BONE });
      rig.add('shin' + S, 'bone', G.cyl(0.011, 0.011, D.shin * 0.85, 5), { x: sx * 0.03, y: -D.shin / 2 }, { c: BONE });
      rig.add('shin' + S, 'bone', G.sph(0.03, 6, 5), { y: -0.01, z: 0.022, sy: 0.75 }, { c: BONE });
      rig.add('shin' + S, 'cloth', mergeRaw([0, 1, 2, 3].map((i) => xf(G.cyl(0.04 - i * 0.002, 0.038 - i * 0.002, 0.05, 7, true), { y: -D.shin * 0.42 - i * 0.07, rx: i % 2 ? 0.12 : -0.1 }))), {}, { c: [0.3, 0.24, 0.18] });
      rig.add('foot' + S, 'bone', mergeRaw([xf(G.box(0.065, 0.032, 0.07), { y: -0.04, z: 0.01 }), ...[-0.022, 0, 0.022].map((x) => xf(G.cyl(0.008, 0.006, 0.09, 4), { x, y: -0.055, z: 0.085, rx: Math.PI / 2 }))]), {}, { c: BONE });
    }
    // --- head: skull under a crowned morion
    addSkull(rig, 'head', 'jaw', { eye: BAN_GLOW, eyeK: 7, c: BONE });
    const mo = morion();
    const HC = [0.5, 0.48, 0.52];
    rig.add('head', 'steel', mo.shell, { z: -0.005 }, { c: HC });
    rig.add('head', 'steel', mo.brim, { z: -0.005 }, { c: HC });
    rig.add('head', 'gold', mergeRaw([mo.rim, xf(G.cyl(0.13, 0.128, 0.04, 18, true), { y: 0.15, sz: 1.12 }), xf(spikeRing(0.13, 7, 0.065, 0.017, 0.165, 0.1), { sz: 1.12 })]), { z: -0.005 }, { c: GOLDC });
    // --- war-banner: pole, spear butt, crossbar, crowned-skull finial
    rig.add('pole', 'wood', xf(G.cyl(0.021, 0.025, POLE_HI - POLE_LO - 0.1, 8), { y: (POLE_HI - 0.1 + POLE_LO) / 2 }), tPole, { c: [0.42, 0.3, 0.22] });
    rig.add('pole', 'steel', mergeRaw([
      xf(G.cyl(0.028, 0.024, 0.12, 8), { y: POLE_LO + 0.06 }),
      xf(G.oct(0.045), { y: POLE_LO - 0.1, sy: 2.6, sz: 0.4 }),
      xf(G.cyl(0.031, 0.031, 0.03, 8), { y: POLE_LO + 0.02 }),
    ]), tPole, { c: [0.85, 0.82, 0.85] });
    rig.add('pole', 'gold', mergeRaw([
      ...[0.35, -0.55, 1.2].map((y) => xf(G.cyl(0.03, 0.03, 0.035, 8), { y })),
      xf(G.cyl(0.024, 0.024, 1.02, 6), { y: BAR_Y, x: -0.42, rz: Math.PI / 2 }),
      xf(G.sph(0.035, 8, 6), { y: BAR_Y, x: -0.95 }), xf(G.cone(0.025, 0.08, 6), { y: BAR_Y, x: -1.02, rz: Math.PI / 2 }),
      xf(G.sph(0.03, 8, 6), { y: BAR_Y, x: 0.1 }),
      xf(G.cyl(0.035, 0.05, 0.08, 8), { y: POLE_HI - 0.06 }),
      ...[-0.1, -0.35, -0.6, -0.85].map((x) => xf(G.tor(0.024, 0.006, 3, 8), { y: BAR_Y - 0.02, x, ry: Math.PI / 2 })),
      // tassels hanging from the crossbar ends
      ...[-0.95, 0.1].map((x) => xf(G.cone(0.025, 0.12, 6), { x, y: BAR_Y - 0.1, rx: Math.PI })),
    ]), tPole, { c: GOLDC });
    // finial: crowned skull with violet eyes and a violet gem above it
    const fin = POLE_HI + 0.08;
    rig.add('pole', 'bone', mergeRaw([xf(G.sph(0.075, 12, 9), { y: fin + 0.02, sz: 1.12, sx: 0.88 }), xf(G.box(0.06, 0.04, 0.05), { y: fin - 0.045, z: 0.035 }), xf(G.box(0.05, 0.02, 0.04), { y: fin - 0.07, z: 0.03 })]), tPole, { c: [0.85, 0.8, 0.68] });
    rig.add('pole', 'dark', mergeRaw([xf(G.sph(0.02, 6, 5), { x: 0.026, y: fin + 0.012, z: 0.06, sz: 0.6 }), xf(G.sph(0.02, 6, 5), { x: -0.026, y: fin + 0.012, z: 0.06, sz: 0.6 }), xf(G.cone(0.01, 0.022, 3), { y: fin - 0.018, z: 0.08, rx: Math.PI })]), tPole, {});
    rig.add('pole', 'glow', mergeRaw([xf(G.sph(0.012, 6, 5), { x: 0.026, y: fin + 0.012, z: 0.07 }), xf(G.sph(0.012, 6, 5), { x: -0.026, y: fin + 0.012, z: 0.07 }), xf(G.oct(0.024), { y: fin + 0.15, sy: 1.6 })]), tPole, { c: HDR(BAN_GLOW, 6) });
    rig.add('pole', 'gold', mergeRaw([xf(G.cyl(0.075, 0.07, 0.035, 14, true), { y: fin + 0.06 }), spikeRing(0.074, 6, 0.06, 0.015, fin + 0.075, 0.12)]), tPole, { c: GOLDC });
    // banner cloth on its own lagging bone, with a gold crown over a bone-white skull device
    rig.add('flag', 'cloth', bannerCloth(), tFlag, { cfn: bannerColor, anim: bannerAnim });
    const dx = -0.45, dy = -0.5;
    const crownD = extrude([[-0.2, 0], [0.2, 0], [0.23, 0.16], [0.13, 0.07], [0.07, 0.2], [0.0, 0.09], [-0.07, 0.2], [-0.13, 0.07], [-0.23, 0.16]], 0.018, 0, 1);
    rig.add('flag', 'gold', xf(crownD, { x: dx, y: dy + 0.03 }), tFlag, { c: GOLDC, anim: bannerAnim });
    rig.add('flag', 'bone', mergeRaw([xf(G.cyl(0.12, 0.12, 0.018, 16), { rx: Math.PI / 2, x: dx, y: dy - 0.15 }), xf(G.box(0.13, 0.09, 0.018), { x: dx, y: dy - 0.27 })]), tFlag, { c: [0.95, 0.9, 0.78], anim: bannerAnim });
    rig.add('flag', 'dark', mergeRaw([xf(G.cyl(0.032, 0.032, 0.024, 8), { rx: Math.PI / 2, x: dx - 0.048, y: dy - 0.16 }), xf(G.cyl(0.032, 0.032, 0.024, 8), { rx: Math.PI / 2, x: dx + 0.048, y: dy - 0.16 }), xf(G.box(0.022, 0.04, 0.024), { x: dx, y: dy - 0.225 }), ...[-1, 0, 1].map((i) => xf(G.box(0.012, 0.05, 0.024), { x: dx + i * 0.035, y: dy - 0.29 }))]), tFlag, { anim: bannerAnim });
    // muzzle at the finial: the rally glow pulses here
    const mz = new THREE.Vector3(0, fin + 0.02, 0.02).applyMatrix4(Lp);
    rig.socket('muzzle', 'pole', mz.x, mz.y, mz.z);
    return D;
  },
  pose(m, s, P, dt) {
    const st = m.state;
    if (s.anim === 'cast') {
      s.attackType = 'rally';
      // a second cast pass (progress restarted after the plant) only holds and recovers
      if (st.rallyPlanted && s.progress + 0.2 < st.rallyP) st.rallyHold = true;
      if (s.progress > 0.5) st.rallyPlanted = true;
      st.rallyP = s.progress;
    } else { st.rallyPlanted = false; st.rallyHold = false; st.rallyP = 0; }
    const r = humanoidPose(m, s, P, dt);
    holdArm(P, m, s, -1, 1);
    holdArm(P, m, s, 1, 1);
    const an = s.anim, T = m.time, w = m.state.moveW ?? 0;
    const action = an === 'windup' || an === 'attack' || an === 'cast';
    if (an !== 'death') {
      // the banner sways on its crossbar and the pole rocks in the bearer's grip
      const sway = Math.sin(T * 0.8 + m.seed * 4), sway2 = Math.sin(T * 1.33 + 1.1);
      P.r('flag', sway * 0.05 + w * 0.1, 0, sway2 * 0.04);
      if (!action) P.r('pole', sway2 * 0.02, 0, sway * 0.025);
      // hunched march: lean in, head low, pole kept upright
      if (!action && an !== 'spawn') { P.r('spine', 0.12 * w); P.r('chest', 0.06 * w); P.r('head', -0.1 * w); P.r('pole', -0.18 * w); }
      dropProp(m, P, 'pole', BN_DROP, 0);
    } else {
      // the grip goes slack and the banner topples forward, landing flat
      const u = easeIn(smooth(0.1, 0.6, s.progress));
      dropProp(m, P, 'pole', BN_DROP, u - bump(0.6, 0.72, s.progress) * 0.035);
    }
    // finial glow pulses; flares while rallying
    let orb = 0.55 + 0.15 * Math.sin(T * 3.1);
    if (s.attackType === 'rally' && action) orb = an === 'windup' ? 0.7 + 0.4 * s.progress : st.rallyHold ? 1.3 - 0.6 * smooth(0.3, 1, s.progress) : 0.8 + 0.6 * smooth(0.45, 0.55, s.progress) - 0.3 * smooth(0.85, 1, s.progress) + 0.12 * Math.sin(T * 22);
    if (an === 'death') orb *= 1 - smooth(0.3, 0.75, s.progress);
    if (an === 'spawn') orb *= smooth(0.3, 1, s.progress);
    m.setOrb(orb);
    m.U.uFlutterSpeed.value = s.attackType === 'rally' && action ? 2.2 : 1.2 + w * 0.6;
    if (an === 'death') m.U.uFlutter.value *= 1 - 0.85 * smooth(0.4, 0.62, s.progress);
    return r;
  },
  anim: {
    gait: 'walk', armSwing: 0.3, stride: 0.5, knee: 0.8, breath: 1.4, look: 0.6, armOut: 0,
    rest: BN_REST,
    stance: (P, m, s) => {
      if (s.anim === 'death') return;
      P.apply(BN_UPPER);
      P.apply(BN_LEGS, 1 - (m.state.moveW ?? 0));
    },
    actions: {
      // raise the banner high, then plant it with a burst from the finial
      rally: (P, ph, p, m) => rallyAction(P, ph, p, m),
      // quick thrust with the spear butt: the pole tips back over the shoulder, the butt drives forward
      jab: act2(
        { armR: [-0.032, 0.275, -0.053], foreR: [-1.778, 0, 0], handR: [-0.567, -0.378, 0], pole: [-0.584, -0.079, 0.805], armL: [-0.184, -0.479, 0.214], foreL: [-1.496, 0, 0], chest: [-0.05, -0.35, 0], spine: [0.1, -0.15, 0], head: [-0.1, 0.3, 0], hips: [0, -0.1, 0, 0, -0.05, -0.08], thighR: [0.25, 0, 0], shinR: [0.35, 0, 0] },
        { armR: [-0.943, -0.35, -0.729], foreR: [-1.855, 0, 0], handR: [-0.567, -0.378, 0], pole: [-0.358, 0.142, 0.297], armL: [-2.037, -0.527, -1.035], foreL: [-0.31, 0, 0], chest: [0.15, 0.3, 0], spine: [0.25, 0.1, 0], head: [-0.3, -0.25, 0], hips: [0, 0.1, 0, 0, -0.1, 0.25], thighR: [-0.6, 0, 0], shinR: [0.5, 0, 0], thighL: [0.35, 0, 0], shinL: [0.2, 0, 0] },
        { hit: 0.2, recover: 0.55, recoverAmt: 0.7 },
      ),
    },
    stagger: { spine: [-0.25, 0.12, 0.06], chest: [-0.22, 0.18, 0], head: [-0.35, -0.25, 0.12], armL: [0.45, 0, 0.6], foreL: [0.4, 0, 0], armR: [0.2, 0, -0.1], pole: [-0.15, 0, 0.12], hips: [0, 0, 0, 0, -0.04, -0.1], thighL: [-0.25, 0, 0], shinL: [0.35, 0, 0], jaw: [0.5, 0, 0], flag: [0.3, 0, 0.2] },
    death: (P, p, m) => bannermanDeath(P, p, m),
    spawn: (P, p, m) => bannermanSpawn(P, p, m),
  },
};

// rally: raise the banner overhead (0..0.4), slam the butt down (0.42..0.52), hold it planted, recover.
// The game plays it as two 'cast' states (windup, then recovery); the second pass just holds and recovers.
const RALLY_UP = { armR: [-1.967, -0.03, -0.145], foreR: [-1.848, 0, 0], handR: [1.983, 0.068, 0], pole: [0.031, -0.086, 0.696], armL: [-1.411, -0.9, -0.603], foreL: [-1.645, 0, 0], chest: [-0.15, 0, 0], head: [-0.3, 0, 0], neck: [-0.05, 0, 0], hips: [0, 0, 0, 0, -0.04, 0] };
const RALLY_PLANT = { armR: [0.008, 0.258, -0.56], foreR: [-1.621, 0, 0], handR: [-0.567, -0.378, 0], pole: [0.386, -0.281, 0.042], armL: [-2.5, 0, 0.55], foreL: [-0.35, 0, 0], handL: [-0.4, 0, 0], chest: [-0.22, 0, 0], spine: [0.05, 0, 0], head: [-0.45, 0, 0], jaw: [0.75, 0, 0], hips: [0, 0, 0, 0, -0.08, 0], thighL: [-0.3, 0, 0.08], shinL: [0.35, 0, 0] };
function rallyAction(P, ph, p, m) {
  const T = m.time;
  if (ph === 'windup') {
    P.apply(RALLY_UP);
    const tr = smooth(0.5, 1, p) * 0.03;
    P.r('armR', Math.sin(T * 37) * tr); P.r('pole', Math.sin(T * 29) * tr, 0, Math.sin(T * 23) * tr);
    return 9;
  }
  if (m.state.rallyHold) {
    const rec = smooth(0.2, 1, p);
    P.apply(RALLY_PLANT, 1 - rec); P.apply(BN_REST, rec);
    return 10;
  }
  const a = easeOut(smooth(0, 0.4, p)), b = easeIn(smooth(0.42, 0.52, p)), rec = smooth(0.86, 1, p) * 0.5;
  P.apply(BN_REST, 1 - a + a * b * rec);
  P.apply(RALLY_UP, a * (1 - b));
  P.apply(RALLY_PLANT, a * b * (1 - rec));
  // raised banner trembles with effort; the plant jars the whole body
  const tr = bump(0.15, 0.45, p) * 0.03, jar = bump(0.5, 0.62, p);
  P.r('armR', Math.sin(T * 37) * tr); P.r('pole', Math.sin(T * 29) * tr - jar * 0.06, 0, Math.sin(T * 23) * tr);
  P.p('hips', 0, -jar * 0.05, 0); P.r('chest', jar * 0.12); P.r('flag', jar * 0.4, 0, jar * 0.2);
  return p < 0.42 ? 12 : 30;
}

// crumple to the knees, then slump forward and aside
const BN_KNEEL = { hips: [0.15, 0, 0, 0, -0.44, -0.05], thighL: [-0.25, 0, 0.1], shinL: [1.65, 0, 0], thighR: [-0.15, 0, -0.1], shinR: [1.6, 0, 0], footL: [1.1, 0, 0], footR: [1.1, 0, 0], spine: [0.35, 0, 0], chest: [0.2, 0, 0], neck: [0.25, 0, 0], head: [0.4, 0, 0.15], jaw: [0.5, 0, 0], armR: [-0.4, 0, -0.3], foreR: [-0.9, 0, 0], armL: [0.1, 0, 0.1], foreL: [-0.3, 0, 0] };
const BN_SLUMP = { hips: [1.35, 0.3, 0.25, 0, -0.78, 0.3], thighL: [-0.35, 0, 0.2], shinL: [0.9, 0, 0], thighR: [-0.1, 0, -0.1], shinR: [0.5, 0, 0], footL: [0.6, 0, 0], footR: [0.6, 0, 0], spine: [0.05, 0, -0.1], chest: [0.0, 0, -0.05], neck: [-0.15, 0, 0], head: [-0.25, 0.9, 0.15], jaw: [0.8, 0, 0], armL: [0.3, 0, 0.9], foreL: [-0.5, 0, 0], armR: [-2.85, 0, -0.35], foreR: [-0.1, 0, 0], handR: [0.2, 0, 0] };
function bannermanDeath(P, p, m) {
  const a = smooth(0, 0.35, p), b = smooth(0.32, 0.82, p);
  P.apply(BN_UPPER, 1 - a);
  P.apply(BN_REST, 1 - a);
  P.apply(BN_KNEEL, a * (1 - b));
  P.apply(BN_SLUMP, b);
  const arc = bump(0.32, 0.82, p);
  P.p('hips', 0, arc * 0.12 + bump(0, 0.35, p) * 0.1, arc * 0.08);
  P.r('thighL', -arc * 0.25); P.r('thighR', -arc * 0.25);
  return 12;
}
function bannermanSpawn(P, p, m) {
  const u = easeOut(smooth(0, 0.75, p));
  P.p('base', 0, -(1 - u) * 2.0, 0);
  const k = 1 - smooth(0.5, 1, p);
  P.apply(BN_KNEEL, k * 0.7);
  P.r('base', Math.sin(m.time * 6) * 0.04 * k, 0, Math.sin(m.time * 5) * 0.05 * k);
  return 14;
}

export const THRONE_TYPES = [gildedSentinel, hollowBannerman];
