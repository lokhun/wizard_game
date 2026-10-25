import { clamp, lerp, smooth, easeOut, bump, TAU, turnK } from './core.js';

// ---------------------------------------------------------------------------
// Quadruped skeleton + procedural gait (trot / bound) and actions.
// Bones: base > body > front/rear > legs, neck > head > jaw, rear > tail chain.
// Legs hang along -Y in the bind pose; rx < 0 swings a leg forward.
// ---------------------------------------------------------------------------

export function quadSkeleton(rig, o = {}) {
  const Q = Object.assign({
    bodyH: 0.3, len: 0.36, w: 0.08, wb: null, shoulderY: -0.02, hipY: -0.02, fz: 0, bz: 0,
    legF: [0.12, 0.12, 0.04], legB: [0.13, 0.13, 0.05],
    neck: [0.03, 0.1], head: [0.02, 0.1], jaw: [-0.02, 0.03],
    tail: 6, tailSeg: 0.1, tailY: 0.02, tailZ: 0.12,
    stF: [0, 0, 0], stB: [0, 0, 0],
  }, o);
  // place shoulder/hip joints so the paws touch the ground in the stance pose
  const legH = (L, a) => L[0] * Math.cos(a[0]) + L[1] * Math.cos(a[0] + a[1]) + L[2] * Math.cos(a[0] + a[1] + a[2]);
  if (o.shoulderY === undefined) Q.shoulderY = legH(Q.legF, Q.stF) - Q.bodyH;
  if (o.hipY === undefined) Q.hipY = legH(Q.legB, Q.stB) - Q.bodyH;
  rig.bone('base', null);
  rig.bone('body', 'base', 0, Q.bodyH, 0);
  rig.bone('front', 'body', 0, 0, Q.len / 2);
  rig.bone('rear', 'body', 0, 0, -Q.len / 2);
  rig.bone('neck', 'front', 0, Q.neck[0], Q.neck[1]);
  rig.bone('head', 'neck', 0, Q.head[0], Q.head[1]);
  rig.bone('jaw', 'head', 0, Q.jaw[0], Q.jaw[1]);
  for (const [S, side] of [['L', 1], ['R', -1]]) {
    rig.bone('legF' + S, 'front', side * Q.w, Q.shoulderY, Q.fz);
    rig.bone('legF2' + S, 'legF' + S, 0, -Q.legF[0], 0);
    rig.bone('pawF' + S, 'legF2' + S, 0, -Q.legF[1], 0);
    rig.bone('legB' + S, 'rear', side * (Q.wb ?? Q.w), Q.hipY, Q.bz);
    rig.bone('legB2' + S, 'legB' + S, 0, -Q.legB[0], 0);
    rig.bone('pawB' + S, 'legB2' + S, 0, -Q.legB[1], 0);
  }
  let prev = 'rear';
  for (let i = 0; i < Q.tail; i++) {
    rig.bone('tail' + i, prev, 0, i === 0 ? Q.tailY : 0, i === 0 ? -Q.tailZ : -Q.tailSeg, { rate: 0.75 });
    prev = 'tail' + i;
  }
  return Q;
}

const QACT = {
  bite: (P, ph, p, m) => {
    if (ph === 'windup') {
      P.apply({ body: [-0.12, 0, 0, 0, 0.02, -0.08], front: [-0.15, 0, 0], neck: [-0.35, 0, 0], head: [-0.2, 0, 0], jaw: [0.55, 0, 0], legBL: [-0.25, 0, 0], legBR: [-0.25, 0, 0], legB2L: [0.4, 0, 0], legB2R: [0.4, 0, 0] });
      P.r('head', Math.sin(m.time * 40) * 0.03 * p);
      return 10;
    }
    const lunge = bump(0, 0.75, p);
    const snap = smooth(0.2, 0.32, p);
    P.p('base', 0, 0, lunge * (m.spec.lunge ?? 0.4));
    P.r('body', 0.08 * lunge); P.r('front', 0.12 * lunge);
    P.r('neck', 0.3 * lunge); P.r('head', 0.25 * lunge);
    P.r('jaw', 0.9 * (1 - snap) + 0.1);
    P.r('legFL', -0.7 * lunge); P.r('legFR', -0.6 * lunge); P.r('legBL', 0.4 * lunge); P.r('legBR', 0.45 * lunge);
    return 28;
  },
  charge: (P, ph, p, m) => {
    if (ph === 'windup') {
      P.apply({ body: [0.12, 0, 0, 0, -0.06, -0.05], neck: [0.3, 0, 0], head: [0.2, 0, 0], jaw: [0.3, 0, 0], legFL: [-0.3, 0, 0], legF2L: [0.6, 0, 0], legBL: [-0.4, 0, 0], legBR: [-0.4, 0, 0], legB2L: [0.6, 0, 0], legB2R: [0.6, 0, 0] });
      P.r('legFR', Math.sin(m.time * 14) * 0.25);
      return 10;
    }
    const k = bump(0, 1, p);
    P.p('base', 0, 0, k * 0.5);
    P.apply({ body: [0.1, 0, 0], neck: [0.25, 0, 0], head: [0.25, 0, 0], jaw: [0.7, 0, 0], legFL: [-0.9, 0, 0], legFR: [-0.8, 0, 0], legBL: [0.6, 0, 0], legBR: [0.6, 0, 0] }, k);
    return 22;
  },
  breath: (P, ph, p, m) => {
    if (ph === 'windup') {
      P.apply({ body: [-0.1, 0, 0, 0, 0.02, -0.06], neck: [-0.4, 0, 0], head: [-0.3, 0, 0], jaw: [0.3, 0, 0], legFL: [-0.2, 0, 0], legFR: [-0.2, 0, 0] });
      m.setOrb(0.3 + p * 0.6);
      return 8;
    }
    P.apply({ body: [0.05, 0, 0, 0, 0, 0.05], neck: [0.25, 0, 0], head: [0.15, Math.sin(m.time * 6) * 0.25, 0], jaw: [0.85, 0, 0] });
    m.setOrb(1 - smooth(0.8, 1, p));
    return 18;
  },
  roar: (P, ph, p, m) => {
    if (ph === 'windup') { P.apply({ body: [0.05, 0, 0, 0, -0.04, -0.05], neck: [0.3, 0, 0], head: [0.2, 0, 0] }); return 8; }
    const k = bump(0, 1, p);
    P.apply({ body: [-0.2, 0, 0, 0, 0.03, 0], neck: [-0.5, 0, 0], head: [-0.3, 0, 0], jaw: [1.0, 0, 0] }, k);
    P.r('head', Math.sin(m.time * 40) * 0.04 * k, Math.sin(m.time * 33) * 0.06 * k);
    return 16;
  },
};
QACT.spit = QACT.breath;

export function quadPose(m, s, P, dt) {
  const Q = m.spec.dims, A = m.spec.anim, st = m.state, T = m.time;
  const anim = s.anim;
  const dead = anim === 'death', spawning = anim === 'spawn';
  let rate = A.rate ?? 14;
  const spd = dead ? 0 : Math.max(s.speed, turnK(m, dt) * 0.5); // (turning on the spot shuffles the paws round)
  const stride = A.stride ?? 0.6;
  if (spd > 0.01) st.phase += (TAU * spd * dt) / stride;
  const moveTgt = smooth(0.05, 0.5, spd);
  st.moveW = (st.moveW ?? 0) + (moveTgt - (st.moveW ?? 0)) * (1 - Math.exp(-8 * dt));
  const w = st.moveW, ph = st.phase;
  const bound = A.gait === 'bound';
  const offs = bound ? { FL: 0, FR: 0.35, BL: Math.PI, BR: Math.PI + 0.35 } : { FL: 0, BR: 0.1, FR: Math.PI, BL: Math.PI + 0.1 };
  const amp = A.legAmp ?? 0.5, lift = A.lift ?? 0.9;

  for (const S of ['L', 'R']) {
    P.r('legF' + S, Q.stF[0]); P.r('legF2' + S, Q.stF[1]); P.r('pawF' + S, Q.stF[2]);
    P.r('legB' + S, Q.stB[0]); P.r('legB2' + S, Q.stB[1]); P.r('pawB' + S, Q.stB[2]);
    if (dead) continue;
    for (const F of ['F', 'B']) {
      const pl = ph + offs[F + S];
      const sn = Math.sin(pl), cs = Math.cos(pl);
      P.r('leg' + F + S, -sn * amp * w);
      const up = Math.max(0, cs);
      if (F === 'F') { P.r('legF2' + S, up * lift * w); P.r('pawF' + S, (-up * 0.6 + sn * 0.2) * w); }
      else { P.r('legB2' + S, up * lift * 0.8 * w); P.r('pawB' + S, (-up * 0.5 - sn * 0.2) * w); }
    }
  }
  // body motion
  if (bound) {
    const sf = Math.sin(ph);
    P.r('front', sf * 0.14 * w); P.r('rear', -sf * 0.14 * w);
    P.p('body', 0, (Math.cos(ph * 2) * 0.012 - 0.01) * w * (Q.bodyH / 0.3), 0);
    P.r('body', Math.cos(ph) * 0.06 * w);
  } else {
    P.p('body', 0, -Math.abs(Math.cos(ph)) * 0.025 * w * (Q.bodyH / 0.5), 0);
    P.r('body', 0, Math.sin(ph) * 0.04 * w, Math.sin(ph) * 0.03 * w);
  }
  P.r('body', (A.lean ?? 0.05) * w);
  // breathing + idle head motion
  const br = Math.sin(T * (A.breath ?? 2.2) + m.seed * 5);
  P.r('front', br * 0.02); P.p('body', 0, br * 0.004, 0);
  const idle = 1 - w;
  if (!dead) {
    if (A.sniff) {
      const sn = Math.sin(T * 17) * 0.025 * (0.5 + 0.5 * Math.sin(T * 1.3)) * idle;
      P.r('head', sn, 0, 0);
      P.r('jaw', Math.max(0, Math.sin(T * 13)) * 0.06 * idle);
    }
    P.r('neck', Math.sin(T * 0.6 + 2) * 0.12 * idle - (A.neckDown ?? 0) * w, Math.sin(T * 0.37 + m.seed * 7) * 0.45 * idle, 0);
    P.r('head', 0, Math.sin(T * 0.37 + m.seed * 7) * 0.2 * idle, Math.sin(T * 0.5) * 0.08 * idle);
  }
  // tail
  for (let i = 0; i < Q.tail; i++) {
    const k = (i + 1) / Q.tail;
    const sway = (A.tailSway ?? 0.18) * (1 + w * 0.8);
    P.r('tail' + i, (A.tailDroop ?? 0.12) * (dead ? 0.3 : 1) + Math.sin(T * 2.1 - i * 0.6) * 0.05 * k, Math.sin(T * (1.4 + w * 4) - i * 0.7) * sway * (0.4 + k), 0);
  }

  const action = anim === 'windup' || anim === 'attack' || anim === 'cast';
  if (action) {
    const key = s.attackType;
    const fn = A.actions?.[key] ?? QACT[key] ?? A.actions?.[m.spec.defaultAttack] ?? QACT[m.spec.defaultAttack] ?? QACT.bite;
    const r = fn(P, anim === 'cast' ? 'attack' : anim, s.progress, m, s);
    if (typeof r === 'number') rate = r;
  } else if (anim === 'stagger') {
    const k = s.t < 0.07 ? s.t / 0.07 : Math.exp(-(s.t - 0.07) * 5);
    P.apply({ body: [-0.25, 0.2, 0.1, 0, 0.02, -0.12], neck: [-0.4, 0.3, 0], head: [-0.2, 0, 0.2], jaw: [0.5, 0, 0], legFL: [-0.4, 0, 0], legFR: [-0.3, 0, 0] }, k);
    rate = 30;
  } else if (dead) {
    const p = s.progress;
    const a = smooth(0, 0.45, p), b = smooth(0.15, 0.7, p);
    const sd = m.seed > 0.5 ? 1 : -1;
    P.r('base', 0, 0, sd * 1.45 * a);
    P.p('base', -sd * Q.bodyH * 0.15 * a, Q.w * 0.6 * a - Q.bodyH * 0.25 * a, 0);
    const tw = Math.sin(m.time * 25) * 0.15 * bump(0.4, 0.8, p);
    for (const S of ['L', 'R']) {
      P.r('legF' + S, -0.5 * b + tw, 0, 0); P.r('legF2' + S, 1.2 * b); P.r('legB' + S, 0.4 * b - tw); P.r('legB2' + S, -0.9 * b);
    }
    P.r('neck', 0.35 * b, 0, -sd * 0.3 * b); P.r('head', 0.2 * b); P.r('jaw', 0.6 * b);
    P.r('front', 0.1 * b); P.r('rear', -0.2 * b);
    rate = 12;
  } else if (spawning) {
    const p = s.progress;
    P.p('base', 0, -(1 - easeOut(p)) * m.spec.height * 1.3, (1 - easeOut(p)) * 0.2);
    P.r('body', -0.5 * (1 - smooth(0.4, 1, p)));
    P.r('legFL', -1.2 * (1 - p) + Math.sin(m.time * 14) * 0.4 * (1 - p)); P.r('legFR', -1.2 * (1 - p) + Math.sin(m.time * 14 + 2) * 0.4 * (1 - p));
    rate = 20;
  }
  if (A.extra) A.extra(P, m, s, dt, { w, ph, br, action, dead });
  return rate;
}
