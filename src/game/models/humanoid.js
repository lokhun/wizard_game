import { clamp, lerp, smooth, easeOut, easeInOut, bump, TAU, turnK } from './core.js';

// ---------------------------------------------------------------------------
// Humanoid skeleton + procedural animation.
// Conventions (model faces +Z, character's LEFT is +X):
//  - limbs hang along -Y in the bind pose; rx < 0 swings a limb forward/up
//  - shin/fore rx > 0 bends the knee backwards; fore rx < 0 bends the elbow
//  - spine/chest rx > 0 bends forward; ry > 0 turns the right shoulder forward
//  - arm rz: +rz moves the arm toward +X (left arm outward / right arm inward)
// ---------------------------------------------------------------------------

export function humanSkeleton(rig, o = {}) {
  const D = Object.assign({
    thigh: 0.44, shin: 0.42, ankle: 0.07, hipW: 0.1, spine: 0.16, chest: 0.3, neck: 0.09, neckZ: 0,
    shoulderW: 0.2, shoulderDrop: 0.05, upper: 0.29, fore: 0.27, jaw: null,
  }, o);
  D.hipH = D.thigh + D.shin + D.ankle + 0.04;
  D.legLen = D.thigh + D.shin;
  rig.bone('base', null, 0, 0, 0);
  rig.bone('hips', 'base', 0, D.hipH, 0);
  rig.bone('spine', 'hips', 0, 0.05, 0);
  rig.bone('chest', 'spine', 0, D.spine, 0);
  rig.bone('neck', 'chest', 0, D.chest, D.neckZ);
  rig.bone('head', 'neck', 0, D.neck, 0);
  if (D.jaw) rig.bone('jaw', 'head', 0, D.jaw[0], D.jaw[1]);
  for (const [s, side] of [['L', 1], ['R', -1]]) {
    rig.bone('arm' + s, 'chest', side * D.shoulderW, D.chest - D.shoulderDrop, 0);
    rig.bone('fore' + s, 'arm' + s, 0, -D.upper, 0);
    rig.bone('hand' + s, 'fore' + s, 0, -D.fore, 0);
    rig.bone('thigh' + s, 'hips', side * D.hipW, -0.04, 0);
    rig.bone('shin' + s, 'thigh' + s, 0, -D.thigh, 0);
    rig.bone('foot' + s, 'shin' + s, 0, -D.shin, 0);
  }
  return D;
}

// ------------------------------------------------------------ actions ----
// An action is fn(P, phase, p, m, s) where phase is 'windup'|'attack'|'cast'.
// It writes a pose and may return a damping rate. act2 builds one from a
// held anticipation pose and a strike pose.
export function act2(W, S, o = {}) {
  const hit = o.hit ?? 0.3;
  return (P, ph, p, m, s) => {
    if (ph === 'windup') {
      P.apply(W);
      const tr = smooth(0.5, 1, p) * (o.tremble ?? 0.025);
      if (tr) { P.r('armR', Math.sin(m.time * 37) * tr, 0, Math.sin(m.time * 29) * tr); P.r('armL', Math.sin(m.time * 31) * tr); P.r('chest', 0, Math.sin(m.time * 23) * tr * 0.6); }
      if (o.windupExtra) o.windupExtra(P, p, m, s);
      return o.windupRate ?? 9;
    }
    // attack / cast use the same strike follow-through
    const u = easeOut(p / hit);
    const rec = smooth(o.recover ?? 0.6, 1, p) * (o.recoverAmt ?? 0.55);
    P.blend(W, S, u, 1 - rec);
    if (o.strikeExtra) o.strikeExtra(P, p, m, s, u);
    return o.strikeRate ?? 26;
  };
}

// generic one-handed (right hand) actions
export const ACT = {
  swing: act2(
    { armR: [-2.75, 0.2, -0.45], foreR: [-0.9, 0, 0], handR: [-0.2, 0, 0], chest: [-0.12, -0.55, 0], spine: [-0.08, -0.2, 0], head: [0.05, 0.6, 0], armL: [-0.7, 0, 0.35], foreL: [-1.0, 0, 0], hips: [0, 0, 0, 0, -0.04, -0.05], thighR: [0.25, 0, 0], thighL: [-0.25, 0, 0], shinL: [0.25, 0, 0], shinR: [0.2, 0, 0] },
    { armR: [-0.55, -0.3, 0.55], foreR: [-0.15, 0, 0], handR: [0.6, 0, 0], chest: [0.32, 0.55, 0], spine: [0.18, 0.2, 0], head: [-0.15, -0.6, 0], armL: [0.2, 0, 0.5], foreL: [-0.5, 0, 0], hips: [0, 0, 0, 0, -0.1, 0.18], thighR: [-0.55, 0, 0], shinR: [0.5, 0, 0], thighL: [0.35, 0, 0], shinL: [0.3, 0, 0] },
  ),
  thrust: act2(
    { armR: [0.55, 0, -0.35], foreR: [-1.7, 0, 0], handR: [0.2, 0, 0], chest: [-0.05, -0.6, 0], spine: [0, -0.2, 0], head: [0, 0.7, 0], armL: [-1.0, 0, 0.3], foreL: [-0.6, 0, 0], hips: [0, 0, 0, 0, -0.08, -0.08], thighL: [-0.4, 0, 0], shinL: [0.6, 0, 0], thighR: [0.3, 0, 0], shinR: [0.3, 0, 0] },
    { armR: [-1.45, 0, 0.15], foreR: [-0.05, 0, 0], handR: [0.05, 0, 0], chest: [0.15, 0.45, 0], spine: [0.2, 0.15, 0], head: [-0.2, -0.5, 0], armL: [0.4, 0, 0.3], foreL: [-0.3, 0, 0], hips: [0, 0, 0, 0, -0.12, 0.28], thighR: [-0.75, 0, 0], shinR: [0.5, 0, 0], thighL: [0.45, 0, 0], shinL: [0.2, 0, 0] },
    { hit: 0.22 },
  ),
  // two-handed overhead slam
  slam: act2(
    { armR: [-2.65, 0, -0.15], armL: [-2.65, 0, 0.15], foreR: [-0.35, 0, 0.2], foreL: [-0.35, 0, -0.2], handR: [0.55, 0, 0], chest: [-0.25, 0, 0], spine: [-0.2, 0, 0], head: [0.3, 0, 0], hips: [0, 0, 0, 0, -0.02, -0.08], thighL: [-0.4, 0, 0], shinL: [0.3, 0, 0], thighR: [0.2, 0, 0] },
    { armR: [-0.65, 0, 0.35], armL: [-0.65, 0, -0.35], foreR: [-0.25, 0, 0], foreL: [-0.25, 0, 0], handR: [0.8, 0, 0], chest: [0.45, 0, 0], spine: [0.4, 0, 0], head: [-0.4, 0, 0], hips: [0, 0, 0, 0, -0.22, 0.2], thighL: [-0.9, 0, 0], shinL: [1.0, 0, 0], thighR: [0.1, 0, 0], shinR: [0.6, 0, 0] },
    { hit: 0.26, tremble: 0.03 },
  ),
  // two-handed horizontal sweep from right to left
  sweep: act2(
    { armR: [-1.3, -0.6, -0.9], armL: [-1.1, 0.4, 0.4], foreR: [-0.5, 0, 0], foreL: [-0.9, 0, 0], handR: [0.9, 0, -0.6], chest: [0, -1.0, 0], spine: [0.05, -0.4, 0], head: [0, 0.9, 0], hips: [0, -0.2, 0, 0, -0.1, -0.05], thighL: [-0.3, 0, 0.1], thighR: [0.2, 0, -0.1], shinL: [0.4, 0, 0], shinR: [0.4, 0, 0] },
    { armR: [-1.2, 0.4, 0.5], armL: [-0.9, 0.3, 0.9], foreR: [-0.3, 0, 0], foreL: [-0.4, 0, 0], handR: [0.9, 0, 0.6], chest: [0.1, 1.1, 0], spine: [0.1, 0.45, 0], head: [0, -0.9, 0], hips: [0, 0.3, 0, 0, -0.12, 0.12], thighL: [0.2, 0, 0], thighR: [-0.5, 0, 0], shinR: [0.4, 0, 0] },
    { hit: 0.28 },
  ),
  // arms pulled back, then both claws rake forward
  claw: act2(
    { armR: [-2.4, 0, -0.7], armL: [-2.4, 0, 0.7], foreR: [-1.0, 0, 0], foreL: [-1.0, 0, 0], chest: [-0.2, -0.3, 0], spine: [-0.1, 0, 0], head: [0.1, 0.3, 0], hips: [0, 0, 0, 0, -0.06, -0.05], jaw: [0.5, 0, 0] },
    { armR: [-0.6, 0, 0.6], armL: [-1.2, 0, -0.2], foreR: [-0.3, 0, 0], foreL: [-0.6, 0, 0], chest: [0.4, 0.4, 0], spine: [0.25, 0.1, 0], head: [-0.2, -0.3, 0], hips: [0, 0, 0, 0, -0.12, 0.22], thighR: [-0.6, 0, 0], shinR: [0.6, 0, 0], thighL: [0.3, 0, 0], jaw: [0.7, 0, 0] },
    { hit: 0.25 },
  ),
  bite: act2(
    { neck: [-0.5, 0, 0], head: [-0.3, 0, 0], jaw: [0.2, 0, 0], chest: [-0.15, 0, 0], armR: [-0.4, 0, -0.6], armL: [-0.4, 0, 0.6] },
    { neck: [0.6, 0, 0], head: [0.3, 0, 0], jaw: [0.9, 0, 0], chest: [0.4, 0, 0], spine: [0.2, 0, 0], hips: [0, 0, 0, 0, -0.1, 0.25] },
    { hit: 0.2 },
  ),
  spit: act2(
    { neck: [-0.4, 0, 0], head: [-0.5, 0, 0], jaw: [0.6, 0, 0], chest: [-0.3, 0, 0], spine: [-0.15, 0, 0], armR: [0.2, 0, -0.5], armL: [0.2, 0, 0.5], foreR: [-0.6, 0, 0], foreL: [-0.6, 0, 0] },
    { neck: [0.35, 0, 0], head: [0.25, 0, 0], jaw: [1.0, 0, 0], chest: [0.35, 0, 0], spine: [0.2, 0, 0], armR: [0.4, 0, -0.4], armL: [0.4, 0, 0.4], hips: [0, 0, 0, 0, -0.04, 0.08] },
    { hit: 0.2, tremble: 0.04 },
  ),
  roar: act2(
    { chest: [0.35, 0, 0], spine: [0.25, 0, 0], neck: [0.3, 0, 0], head: [0.2, 0, 0], armR: [-0.2, 0, 0.3], armL: [-0.2, 0, -0.3], foreR: [-1.2, 0, 0], foreL: [-1.2, 0, 0], hips: [0, 0, 0, 0, -0.12, 0], thighL: [-0.3, 0, 0.15], thighR: [-0.3, 0, -0.15], shinL: [0.5, 0, 0], shinR: [0.5, 0, 0] },
    { chest: [-0.35, 0, 0], spine: [-0.15, 0, 0], neck: [-0.35, 0, 0], head: [-0.35, 0, 0], jaw: [1.0, 0, 0], armR: [-0.5, 0, -1.25], armL: [-0.5, 0, 1.25], foreR: [-0.9, 0, 0], foreL: [-0.9, 0, 0], hips: [0, 0, 0, 0, -0.06, 0], thighL: [0, 0, 0.2], thighR: [0, 0, -0.2] },
    { hit: 0.15, recover: 0.75, tremble: 0.05, strikeExtra: (P, p, m) => { const k = bump(0.1, 0.8, p) * 0.04; P.r('chest', Math.sin(m.time * 45) * k, Math.sin(m.time * 38) * k); P.r('head', Math.sin(m.time * 51) * k * 2, Math.sin(m.time * 33) * k * 2); } },
  ),
  // both arms high (rally / summon)
  summon: act2(
    { armR: [-0.4, 0, -0.5], armL: [-0.4, 0, 0.5], foreR: [-1.4, 0, 0], foreL: [-1.4, 0, 0], chest: [0.25, 0, 0], head: [0.3, 0, 0], hips: [0, 0, 0, 0, -0.06, 0] },
    { armR: [-2.8, 0, -0.5], armL: [-2.8, 0, 0.5], foreR: [-0.2, 0, 0], foreL: [-0.2, 0, 0], chest: [-0.3, 0, 0], spine: [-0.1, 0, 0], head: [-0.45, 0, 0], jaw: [0.6, 0, 0] },
    { hit: 0.4, recover: 0.8 },
  ),
  // staff / hand pointed forward
  cast: act2(
    { armR: [-0.6, 0, -0.2], foreR: [-1.3, 0, 0], armL: [-0.9, 0, 0.5], foreL: [-1.2, 0, 0], chest: [-0.15, -0.2, 0], head: [0.1, 0.15, 0], spine: [-0.05, 0, 0] },
    { armR: [-1.45, 0, 0.1], foreR: [-0.2, 0, 0], handR: [-0.1, 0, 0], armL: [-1.3, 0, -0.2], foreL: [-0.4, 0, 0], chest: [0.15, 0.15, 0], spine: [0.1, 0, 0], head: [-0.1, -0.1, 0], hips: [0, 0, 0, 0, -0.03, 0.06] },
    { hit: 0.35, recover: 0.85, recoverAmt: 0.3 },
  ),
  beam: act2(
    { armR: [-1.0, 0, -0.3], foreR: [-1.2, 0, 0], armL: [-1.0, 0, 0.3], foreL: [-1.2, 0, 0], chest: [-0.25, 0, 0], head: [0.15, 0, 0] },
    { armR: [-1.5, 0, 0.2], foreR: [0, 0, 0], armL: [-1.5, 0, -0.2], foreL: [0, 0, 0], chest: [0.1, 0, 0], spine: [0.1, 0, 0], head: [-0.05, 0, 0], hips: [0, 0, 0, 0, -0.06, -0.05] },
    { hit: 0.2, recover: 0.92, recoverAmt: 0.3, strikeExtra: (P, p, m) => { const k = 0.015; P.r('armR', Math.sin(m.time * 40) * k); P.r('armL', Math.sin(m.time * 43) * k); } },
  ),
  charge: act2(
    { chest: [0.35, 0, 0], spine: [0.3, 0, 0], head: [-0.4, 0, 0], neck: [-0.2, 0, 0], armR: [0.4, 0, -0.3], armL: [0.4, 0, 0.3], foreR: [-1.2, 0, 0], foreL: [-1.2, 0, 0], hips: [0, 0, 0, 0, -0.15, -0.1], thighL: [-0.7, 0, 0], shinL: [0.9, 0, 0], thighR: [0.4, 0, 0], shinR: [0.6, 0, 0] },
    { chest: [0.45, 0, 0], spine: [0.35, 0, 0], head: [-0.45, 0, 0], armR: [-0.9, 0, 0.2], armL: [-0.9, 0, -0.2], foreR: [-0.6, 0, 0], foreL: [-0.6, 0, 0], hips: [0, 0, 0, 0, -0.1, 0.1] },
    { hit: 0.15, recover: 0.85, recoverAmt: 0.2 },
  ),
  spin: (P, ph, p, m) => {
    if (ph === 'windup') {
      P.apply({ chest: [0.1, -1.0, 0], spine: [0.1, -0.4, 0], armR: [-1.4, 0, -0.6], armL: [-1.4, 0, 0.6], foreR: [-0.3, 0, 0], foreL: [-0.3, 0, 0], hips: [0, -0.3, 0, 0, -0.12, 0], thighL: [-0.3, 0, 0.2], thighR: [-0.3, 0, -0.2], shinL: [0.5, 0, 0], shinR: [0.5, 0, 0] });
      return 9;
    }
    const sp = easeInOut(p) * TAU * 2;
    P.r('base', 0, sp);
    P.apply({ armR: [-1.45, 0, -0.9], armL: [-1.45, 0, 0.9], chest: [0.05, 0.3, 0], head: [-0.1, 0, 0], hips: [0, 0, 0, 0, -0.06, 0] });
    return 40;
  },
};
ACT.swipe = ACT.claw;
ACT.shoot = ACT.cast;

const STAGGER = { spine: [-0.25, 0.12, 0.06], chest: [-0.22, 0.18, 0], neck: [-0.15, 0, 0], head: [-0.35, -0.25, 0.12], armL: [0.35, 0, 0.55], armR: [0.3, 0, -0.45], foreL: [-0.6, 0, 0], foreR: [-0.6, 0, 0], hips: [0, 0, 0, 0, -0.04, -0.1], thighL: [-0.25, 0, 0], shinL: [0.35, 0, 0], jaw: [0.5, 0, 0] };

// ---------------------------------------------------------------- fidgets ----
// A still body doesn't stay still: every 5-14 s one rolls its neck, rolls a shoulder, glances behind
// it, hefts its weapon arm or shifts its feet. One gesture at a time, eased in and out, on top of the
// idle pose and gone as soon as it walks (idleW). One squaring up to a foe (look) only hefts and shifts:
// it doesn't take its eyes off them. A type lists its own (anim.fidgets: keys of FIDGET) or opts out
// (fidgets: false).
const FIDGET = {
  neck: [1.6, (P, k, u, sd) => { const a = u * TAU * sd; P.r('neck', Math.sin(a) * 0.22 * k, 0, Math.cos(a) * 0.2 * k); P.r('head', Math.sin(a) * 0.14 * k, 0, Math.cos(a) * 0.16 * k); }],
  shoulder: [1.2, (P, k, u, sd) => { const a = u * TAU; P.r(sd > 0 ? 'armR' : 'armL', -Math.sin(a) * 0.2 * k, 0, sd * (0.1 - Math.cos(a) * 0.1) * k); P.r('chest', 0, sd * Math.sin(a) * 0.06 * k, sd * 0.05 * k); }],
  glance: [2.2, (P, k, u, sd) => { const h = k * k; P.r('spine', 0, sd * 0.14 * h, 0); P.r('chest', 0, sd * 0.24 * h, 0); P.r('neck', 0, sd * 0.4 * h, 0); P.r('head', -0.06 * h, sd * 0.5 * h, 0); }],
  heft: [1.1, (P, k, u) => { const up = Math.sin(Math.min(1, u * 1.6) * Math.PI), bob = u > 0.55 ? Math.sin((u - 0.55) / 0.45 * Math.PI) * 0.5 : 0; P.r('armR', (-0.42 * up + 0.12 * bob) * k, 0, -0.08 * up * k); P.r('foreR', -0.45 * up * k); P.r('chest', -0.04 * up * k); P.r('head', 0.05 * bob * k); }],
  shift: [0.9, (P, k, u, sd) => { const lift = Math.sin(u * Math.PI); const t = sd > 0 ? 'R' : 'L'; P.r('thigh' + t, -0.32 * lift * k, 0, 0); P.r('shin' + t, 0.6 * lift * k); P.r('foot' + t, -0.2 * lift * k); P.r('hips', 0, 0, -sd * 0.05 * lift * k); }],
};
const FIDGET_ALL = ['neck', 'shoulder', 'glance', 'heft', 'shift'], FIDGET_SQUARED = ['heft', 'shift'];
function fidget(m, st, P, idleW, dt, A, engaged) {
  if (st.fidI < 0) {
    st.fidT -= dt;
    if (st.fidT > 0 || idleW < 0.9) return;
    const list = engaged ? (A.fidgets ?? FIDGET_ALL).filter((k) => FIDGET_SQUARED.includes(k)) : (A.fidgets ?? FIDGET_ALL);
    st.fidT = 5 + Math.random() * 9;
    if (!list.length) return;
    st.fidI = FIDGET_ALL.indexOf(list[Math.floor(Math.random() * list.length)]);
    st.fidU = 0; st.fidS = Math.random() < 0.5 ? -1 : 1;
    if (st.fidI < 0 || (st.fidI === 4 && A.gait === 'float')) { st.fidI = -1; return; } // (no feet to shift)
  }
  const f = FIDGET[FIDGET_ALL[st.fidI]];
  st.fidU += dt / f[0];
  if (st.fidU >= 1 || idleW < 0.3) { st.fidI = -1; return; }
  const u = st.fidU, k = smooth(0, 0.22, u) * (1 - smooth(0.75, 1, u)) * idleW;
  f[1](P, k, u, st.fidS);
}

// ---------------------------------------------------------------- pose ----
export function humanoidPose(m, s, P, dt) {
  const A = m.spec.anim;
  const D = m.spec.dims;
  const st = m.state;
  const T = m.time;
  const anim = s.anim;
  const sc = D.hipH / 0.97; // body scale relative to a human
  let rate = A.rate ?? 12;
  const dead = anim === 'death', spawning = anim === 'spawn';
  const seated = s.attackType === 'seated' && (anim === 'idle' || anim === 'cast' || anim === 'windup');
  const action = anim === 'windup' || anim === 'attack' || anim === 'cast';

  // ---- locomotion phase driven by distance travelled
  // (turning on the spot shuffles the feet round: see turnK)
  const spd = dead || seated ? 0 : Math.max(s.speed, turnK(m, dt) * 0.55 * sc);
  const legLen = D.legLen;
  const ampL = Math.min(A.stride ?? 0.55, 0.18 + spd * (A.strideK ?? 0.16) / sc);
  const step = Math.max(0.12, 2 * legLen * Math.sin(ampL));
  if (spd > 0.01) st.phase += (Math.PI * spd * dt) / step;
  const moveTgt = smooth(0.05, 0.6, spd);
  st.moveW = (st.moveW ?? 0) + (moveTgt - (st.moveW ?? 0)) * (1 - Math.exp(-8 * dt));
  const w = st.moveW;
  const ph = st.phase, sn = Math.sin(ph), cs = Math.cos(ph);
  // a footfall (the legs pass each other as a foot takes the weight): the actor raises dust under heavy
  // walkers (m.footfall: the side, read and cleared by Actors)
  if (spd > 0.6 && w > 0.5) { const sg = sn >= 0 ? 1 : -1; if (st.stepSg && sg !== st.stepSg) m.footfall = sg; st.stepSg = sg; }
  const run = clamp((spd / sc - 2.2) / 2.5);

  // cloth secondary motion from movement
  m.U.uDrag.value.set(0, 0.03 * w, -0.09 * w * (1 + run));
  m.U.uFlutter.value = (m.spec.flutter ?? 0.03) * (1 + w * 1.5);

  // ---- base stance (hunch etc.)
  if (A.stance) {
    if (dead) {
      // a hunched body's stance would ride on through the fall and pitch it into the floor (a ghoul
      // lay with its chest under the flagstones): the stance fades out as the body goes down
      const k = 1 - smooth(0.25, 0.8, s.progress), pre = (P._pre ??= new Float32Array(P.tgt.length));
      pre.set(P.tgt);
      A.stance(P, m, s);
      if (k < 1) for (let i = 0; i < pre.length; i++) P.tgt[i] = pre[i] + (P.tgt[i] - pre[i]) * k;
    } else A.stance(P, m, s);
  }

  const floating = A.gait === 'float';
  if (floating) {
    const settle = dead && A.death !== 'dissipate' ? 1 - smooth(0, 0.5, s.progress) : 1;
    const h = (A.hover ?? 0.25) * sc * settle;
    P.p('base', 0, h + Math.sin(T * 1.7) * 0.06 * sc * settle, 0);
    P.r('hips', 0.18 * w, 0, Math.sin(T * 0.9) * 0.03);
    P.r('spine', 0.06 * w);
    P.r('thighL', -0.15 + 0.35 * w, 0, 0.05); P.r('thighR', -0.1 + 0.35 * w, 0, -0.05);
    P.r('shinL', 0.4 + 0.2 * w); P.r('shinR', 0.5 + 0.2 * w);
  } else if (!seated && !dead && !spawning) {
    const plod = A.gait === 'plod' ? 1 : 0;
    const knee = (A.knee ?? 0.9) * (1 + run * 0.4);
    P.r('thighL', -sn * ampL * w); P.r('thighR', sn * ampL * w);
    P.r('shinL', (Math.max(0, cs) * knee + 0.08) * w); P.r('shinR', (Math.max(0, -cs) * knee + 0.08) * w);
    P.r('footL', (-Math.max(0, cs) * 0.4 + sn * 0.2) * w); P.r('footR', (-Math.max(0, -cs) * 0.4 - sn * 0.2) * w);
    const drop = legLen * (1 - Math.cos(ampL * sn)) + Math.abs(sn) * 0.015 * sc;
    P.p('hips', sn * (0.015 + plod * 0.03) * w * sc * 0, -drop * w * (1 + plod * 0.6) - run * 0.05 * sc * w, 0);
    P.r('hips', 0, sn * 0.12 * w, cs * (0.03 + plod * 0.07) * w);
    P.r('spine', (0.06 + run * 0.18 + plod * 0.05) * w, -sn * 0.08 * w, -cs * plod * 0.05 * w);
    P.r('chest', 0, -sn * 0.1 * w, 0);
    P.r('head', -(0.04 + run * 0.12) * w, sn * 0.06 * w, -cs * plod * 0.04 * w);
    // banking: a body on the move leans into its turn (harder the faster it runs) and keeps its head level
    const bank = st.turnS * w * (0.35 + run * 0.65) * (A.bank ?? 1);
    P.r('hips', 0, 0, -bank * 0.1); P.r('spine', 0, 0, -bank * 0.1); P.r('chest', 0, 0, -bank * 0.05); P.r('head', 0, 0, bank * 0.16);
    const armA = (A.armSwing ?? 0.45) * (1 + run * 0.5);
    if (!action) {
      P.r('armL', sn * armA * w); P.r('armR', -sn * armA * w);
      P.r('foreL', (-0.25 - Math.max(0, -sn) * 0.4 - run * 0.6) * w); P.r('foreR', (-0.25 - Math.max(0, sn) * 0.4 - run * 0.6) * w);
    }
  }

  // ---- idle life: breathing, weight shift, looking around
  const br = Math.sin(T * (A.breath ?? 1.7) + m.seed * 6);
  const idleW = 1 - w;
  P.r('chest', br * 0.03, 0, 0); P.r('spine', br * 0.012);
  P.r('armL', -br * 0.02, 0, br * 0.015); P.r('armR', -br * 0.02, 0, -br * 0.015);
  P.p('chest', 0, br * 0.006 * sc, 0);
  if (!dead) {
    const look = (A.look ?? 1) * idleW * (action ? 0.2 : 1);
    P.r('head', Math.sin(T * 0.53 + 1) * 0.06 * look, (Math.sin(T * 0.31 + m.seed * 9) * 0.35 + Math.sin(T * 0.83) * 0.08) * look, 0);
    P.r('neck', 0, Math.sin(T * 0.31 + m.seed * 9) * 0.1 * look, 0);
    if (!floating && !seated) {
      const sh = Math.sin(T * 0.45 + m.seed * 3) * idleW;
      P.p('hips', sh * 0.025 * sc, 0, 0);
      P.r('hips', 0, 0, -sh * 0.03);
      P.r('thighL', 0, 0, sh * 0.03); P.r('thighR', 0, 0, sh * 0.03);
      P.r('spine', 0, 0, sh * 0.025);
    }
  }
  // ---- fidgets: now and then a body standing still does something with itself
  if (!dead && !spawning && !seated && !action && anim !== 'stagger' && A.fidgets !== false) fidget(m, st, P, idleW, dt, A, s.look);
  else st.fidI = -1;
  if (A.rest && !dead) P.apply(A.rest, action ? 0 : 1);
  if (!dead && !spawning) {
    P.r('armL', 0, 0, (A.armOut ?? 0.1)); P.r('armR', 0, 0, -(A.armOut ?? 0.1));
    if (!action && !A.rest) { P.r('foreL', -0.15); P.r('foreR', -0.15); }
  }

  // ---- actions
  if (seated) {
    P.apply({ hips: [0, 0, 0, 0, -D.thigh, -D.thigh * 0.85], thighL: [-1.5, 0, 0.12], thighR: [-1.5, 0, -0.12], shinL: [1.45, 0, 0], shinR: [1.45, 0, 0], spine: [0.05, 0, 0], chest: [0.05, 0, 0], head: [0.15, 0, 0] });
    if (A.seated) A.seated(P, m, s);
    if (anim === 'windup' || anim === 'cast') { P.r('head', -0.3); P.r('chest', -0.1); m.setOrb(0.4 + 0.4 * s.progress); }
  } else if (action) {
    const key = s.attackType;
    const fn = A.actions?.[key] ?? ACT[key] ?? (anim === 'cast' ? (A.actions?.cast ?? ACT.cast) : (A.actions?.[A.defaultAttack] ?? ACT[m.spec.defaultAttack] ?? ACT.swing));
    const r = fn(P, anim, s.progress, m, s);
    if (typeof r === 'number') rate = r;
    // muzzle glow for casters
    if (A.caster || anim === 'cast') {
      if (anim === 'windup') m.setOrb(0.3 + 0.55 * smooth(0, 1, s.progress));
      else if (anim === 'cast') m.setOrb(0.65 + 0.35 * smooth(0, 0.5, s.progress) - 0.6 * smooth(0.88, 1, s.progress));
      else if (A.caster) m.setOrb(0.9 * (1 - smooth(0, 0.25, s.progress)));
    }
  } else if (anim === 'stagger') {
    const k = s.t < 0.07 ? s.t / 0.07 : Math.exp(-(s.t - 0.07) * 4.5);
    P.apply(A.stagger ?? STAGGER, k);
    P.p('hips', 0, 0, -0.06 * k * sc);
    rate = 30;
  } else if (dead) {
    rate = deathPose(m, s, P, D, A, sc);
    // a long weapon still in hand goes down flat with the body instead of standing out of it (or out of the
    // floor under it): a forearm/hand turn per type, one for each side the body can twist to as it falls
    // (scripts/grip.js finds them)
    if (A.deathGrip) P.apply(A.deathGrip[m.seed > 0.5 ? 1 : 0], smooth(0.3, 0.85, s.progress));
  } else if (spawning) {
    rate = spawnPose(m, s, P, D, A, sc);
  } else if (A.caster && A.idleOrb) {
    m.setOrb(A.idleOrb);
  }

  if (A.extra) A.extra(P, m, s, dt, { w, ph, sn, cs, br, action, seated });
  return rate;
}

function deathPose(m, s, P, D, A, sc) {
  const p = s.progress;
  const style = A.death ?? 'fall';
  if (typeof style === 'function') return style(P, p, m, s) ?? 12;
  const a = smooth(0, 0.4, p), b = smooth(0.3, 0.85, p);
  const sd = m.seed > 0.5 ? 1 : -1;
  if (style === 'collapse') {
    // bones lose cohesion and pile up
    P.apply({ thighL: [-1.4, 0, 0.5], thighR: [-1.2, 0, -0.6], shinL: [2.4, 0, 0], shinR: [2.5, 0, 0], footL: [0.6, 0, 0], footR: [0.6, 0, 0] }, a);
    P.p('hips', 0, -D.hipH * 0.45 * a - D.hipH * 0.42 * b, -0.08 * b * sc);
    P.r('hips', 0.2 * b, 0.3 * b * sd, 0.15 * b * sd);
    P.r('spine', 0.5 * a + 0.5 * b, 0, 0.2 * b);
    P.r('chest', 0.25 * b, 0.2 * b * sd, 0);
    P.p('chest', 0, -0.12 * b * sc, 0.05 * b * sc);
    P.r('neck', 0.5 * b);
    P.p('head', 0.12 * b * sd * sc, -0.3 * b * sc, 0.15 * b * sc);
    P.r('head', 1.0 * b, 0.6 * b * sd, 1.1 * b);
    P.r('armL', -0.4 * a + 0.5 * b, 0.2, 1.0 * b); P.r('armR', -0.4 * a + 0.6 * b, -0.2, -1.2 * b);
    P.p('armL', 0.06 * b * sc, -0.18 * b * sc, 0.05 * b * sc); P.p('armR', -0.06 * b * sc, -0.22 * b * sc, -0.04 * b * sc);
    P.r('foreL', -1.2 * b); P.r('foreR', -0.4 * b, 0.4 * b);
    P.p('foreL', 0, 0, 0.05 * b * sc);
    P.r('jaw', 0.7 * b);
    return 16;
  }
  if (style === 'apart') {
    // armor pieces lose their binding and clatter apart
    // (the pieces come to rest on the floor, not in it: a plate's thickness kept above the flagstones)
    const fall = { hips: [0.2, 0, 0.3 * sd, 0, -(D.hipH - 0.3 * sc), 0], thighL: [-1.0, 0, 0.6], thighR: [-0.3, 0, -0.5], shinL: [1.6, 0, 0], shinR: [0.5, 0, 0] };
    P.apply(fall, b);
    P.apply({ hips: [0, 0, 0, 0, -0.15 * sc, 0], spine: [0.3, 0, 0], head: [0.3, 0, 0] }, a * (1 - b));
    const sep = smooth(0.15, 0.6, p);
    P.p('head', 0.3 * sd * sc * b, (0.15 * sep - 0.42 * b) * sc, 0.35 * b * sc); P.r('head', 1.4 * b, 0.8 * b, 1.6 * b * sd);
    P.p('chest', 0, 0.06 * sep * sc - 0.08 * b * sc, -0.1 * b * sc); P.r('chest', -0.6 * b, 0.3 * b * sd, 0.5 * b);
    P.p('armL', 0.15 * sep * sc, -0.25 * b * sc, 0.1 * b * sc); P.r('armL', -0.8 * b, 0, 1.4 * b);
    P.p('armR', -0.15 * sep * sc, -0.21 * b * sc, -0.15 * b * sc); P.r('armR', 0.4 * b, 0, -1.5 * b);
    P.p('foreL', 0, -0.06 * sep * sc, 0); P.p('foreR', 0, -0.06 * sep * sc, 0);
    P.r('foreL', -0.4 * b); P.r('foreR', -1.2 * b, 0.5 * b);
    P.p('shinL', 0, -0.05 * sep * sc, 0.06 * b * sc); P.p('shinR', 0, -0.05 * sep * sc, 0);
    return 14;
  }
  if (style === 'dissipate') {
    m.setOpacity(1 - smooth(0.25, 1, p));
    P.s('base', lerp(1, 0.35, easeOut(p)));
    P.p('base', 0, -0.4 * p * sc, 0);
    P.apply({ armL: [-2.2, 0, 0.6], armR: [-2.2, 0, -0.6], head: [-0.6, 0, 0], chest: [-0.4, 0, 0], jaw: [0.8, 0, 0] }, a);
    P.r('base', 0, p * 2.5, 0);
    return 10;
  }
  // 'fall' / 'kneel': buckle to knees then topple face down (or back)
  const back = style === 'fallBack';
  const K = { hips: [0, 0, 0, 0, -(D.thigh * 0.95), -0.05 * sc], thighL: [-0.25, 0, 0.1], thighR: [-0.1, 0, -0.1], shinL: [1.6, 0, 0], shinR: [1.5, 0, 0], footL: [0.5, 0, 0], footR: [0.5, 0, 0], spine: [0.35, 0, 0], chest: [0.2, 0, 0], head: [0.5, 0, 0.2], armL: [0.1, 0, 0.15], armR: [0.1, 0, -0.15], foreL: [-0.3, 0, 0], foreR: [-0.3, 0, 0] };
  const F = back
    ? { hips: [-1.5, 0, 0, 0, -(D.hipH - 0.16 * sc), -0.35 * sc], thighL: [-0.5, 0, 0.15], thighR: [-0.3, 0, -0.1], shinL: [0.7, 0, 0], shinR: [0.3, 0, 0], spine: [-0.05, 0, 0], head: [-0.2, 0.9 * sd, 0], armL: [0.3, 0, 1.3], armR: [-0.3, 0, -1.1], foreL: [-0.6, 0, 0], foreR: [-0.2, 0, 0] }
    : { hips: [1.48, 0.2 * sd, 0, 0, -(D.hipH - (0.22 + (A.deathLift ?? 0)) * sc), 0.2 * sc], thighL: [-0.15, 0, 0.15], thighR: [-0.3, 0, -0.1], shinL: [0.4, 0, 0], shinR: [0.9, 0, 0], spine: [0.05, 0, 0], chest: [0, 0, 0], neck: [-0.2, 0, 0], head: [-0.3, 1.1 * sd, 0], armL: [-0.4, 0, 1.2], armR: [0.3, 0, -0.9], foreL: [-0.5, 0, 0], foreR: [-0.3, 0, 0] };
  P.apply(K, a * (1 - b));
  P.apply(F, b);
  if (A.deathExtra) A.deathExtra(P, p, m, s);
  return 13;
}

function spawnPose(m, s, P, D, A, sc) {
  const p = s.progress;
  const style = A.spawn ?? 'rise';
  if (typeof style === 'function') return style(P, p, m, s) ?? 14;
  if (style === 'materialize') {
    // a ghost fades in; anything with a body burns into being behind an ember front (core.js setDissolve)
    if (A.death === 'dissipate') m.setOpacity(smooth(0, 0.7, p)); else m.setDissolve(1 - smooth(0, 0.85, p));
    P.s('base', lerp(0.2, 1, easeOut(p)));
    P.r('base', 0, (1 - easeOut(p)) * 3, 0);
    P.apply({ armL: [-1.6, 0, 0.5], armR: [-1.6, 0, -0.5], head: [-0.3, 0, 0] }, 1 - smooth(0.5, 1, p));
    return 20;
  }
  // rise out of the ground, clawing upward
  const u = easeOut(p);
  P.p('base', 0, -(1 - u) * m.spec.height * 1.05, 0);
  const k = 1 - smooth(0.6, 1, p);
  P.apply({ armL: [-2.6, 0, 0.3], armR: [-2.4, 0, -0.3], foreL: [-0.4, 0, 0], foreR: [-0.6, 0, 0], spine: [0.3, 0, 0], head: [-0.4, 0, 0], jaw: [0.4, 0, 0] }, k);
  P.r('armL', Math.sin(m.time * 9) * 0.25 * k); P.r('armR', Math.sin(m.time * 9 + 2) * 0.25 * k);
  P.r('base', Math.sin(m.time * 6) * 0.05 * k, 0, Math.sin(m.time * 5) * 0.06 * k);
  return 22;
}
