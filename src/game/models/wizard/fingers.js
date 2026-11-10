import { wob } from './fx.js';
import { clonePose } from './hand.js';

// ---------------------------------------------------------------------------
// The life in a hand. A hand (hand.js) is fully jointed - three curls and a
// splay per finger, five angles for the thumb - but a pose set on it whole is
// a mannequin's: every joint arrives together and then nothing moves.
//
// FingerRig stands between the pose a hand is asked for and the one it shows:
//  - each finger chases the pose on its own spring, the index first and the
//    little finger last, the tip joints a beat behind the knuckles, so a hand
//    opening or closing rolls through its fingers and overshoots a touch;
//  - the fingers have weight: a hand thrown forward leaves them trailing open,
//    one that stops lets them whip past and curl (free hands; `accel`);
//  - at rest they are never still: each finger drifts on its own slow noise,
//    a breath of a wave runs across them, the thumb shifts;
//  - a hand gripping a pole keeps its wrap (curling further would sink the
//    fingers into the wood) but squeezes on a cast, and now and then loosens
//    and settles its grip, little finger to index, as a tired hand does.
// One per hand; free of allocation after construction.
// ---------------------------------------------------------------------------

const W0 = 30;            // the index knuckle's spring (rad/s); the rest are slower (see below)
const ZETA = 0.5;         // a little overshoot
const ZETA_GRIP = 0.85;   // a grip settles, it doesn't bounce on the pole
const bump = (x) => (x <= 0 || x >= 1 ? 0 : Math.sin(x * Math.PI) ** 2);

export class FingerRig {
  // hand: from buildHand; rest: the pose it holds when asked for nothing;
  // grip: wrapped around a pole (see above); still: a clenched gauntlet that only squeezes;
  // seed: decorrelates two hands' idle motion
  constructor(hand, rest, { grip = false, still = false, seed = 0 } = {}) {
    this.hand = hand; this.rest = clonePose(rest); this.grip = grip; this.still = still; this.seed = seed;
    this.pose = clonePose(rest);          // what is shown
    this.lag = clonePose(rest);           // the asked pose, arriving finger by finger
    this.vf = new Float32Array(16); this.vt = new Float32Array(5);
    this.rippleT = -1; this.nextRipple = 3 + (seed % 5);
    this.clock = 0;
  }

  reset() {
    const r = this.rest;
    for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) this.pose.f[i][j] = this.lag.f[i][j] = r.f[i][j];
    for (let j = 0; j < 5; j++) this.pose.t[j] = this.lag.t[j] = r.t[j];
    this.vf.fill(0); this.vt.fill(0); this.rippleT = -1; this.nextRipple = 3 + (this.seed % 5); this.clock = 0;
    this.hand.setPose(this.pose);
  }

  // a jolt through the fingers (a spell leaving, a blow taken): k > 0 clenches, k < 0 flings them open
  kick(k) {
    for (let i = 0; i < 4; i++) { this.vf[i * 4] += k * (1 - i * 0.12); this.vf[i * 4 + 1] += k * 0.7; }
    this.vt[3] += k * 0.5;
  }

  // o.pose: the pose asked for (null: rest); o.rate: how briskly it is taken up (1: a cast, lower: a fidget);
  // o.squeeze: 0..1 grip pressure; o.life: 0..1 idle motion; o.accel: the hand's acceleration along the
  // back of the hand (m/s², + = toward the knuckles' side), which the fingers' weight resists;
  // o.tremble: 0..1 a fine shake (charging, bleeding out)
  update(dt, t, o = {}) {
    if (dt <= 0) return;
    // (the springs are stepped at 80 Hz or better: a slow frame never rings them)
    const n = Math.ceil(dt / 0.0125), h = dt / n;
    for (let k = 0; k < n; k++) this._step(h, t - dt + h * (k + 1), o);
    this.hand.setPose(this.pose);
  }
  _step(dt, t, o) {
    const P = this.pose, L = this.lag, R = this.rest, T = o.pose ?? R;
    const rate = o.rate ?? 1, life = this.still ? 0 : (o.life ?? 1), sq = o.squeeze ?? 0, tr = o.tremble ?? 0;
    const sd = this.seed;
    this.clock += dt;

    // the grip's idle ripple
    let rip = -1;
    if (this.grip && !this.still) {
      if (this.rippleT >= 0) { this.rippleT += dt; if (this.rippleT > 0.95) { this.rippleT = -1; this.nextRipple = this.clock + 5 + ((this.clock * 7.3 + sd) % 5); } }
      else if (this.clock > this.nextRipple && sq < 0.02 && life > 0.5) this.rippleT = 0;
      rip = this.rippleT;
    }

    const acc = this.grip ? 0 : Math.max(-40, Math.min(40, o.accel ?? 0));
    const zeta = this.grip ? ZETA_GRIP : ZETA;
    for (let i = 0; i < 4; i++) {
      // the asked pose reaches the index at once, the little finger a few hundredths later
      const a = 1 - Math.exp(-dt * rate * 46 / (1 + i * 0.55));
      const lf = L.f[i], tf = T.f[i], pf = P.f[i], rf = R.f[i];
      for (let j = 0; j < 4; j++) lf[j] += (tf[j] - lf[j]) * a;
      // idle: its own drift, and a slow wave across the hand
      const drift = life * (wob(t * (0.55 + i * 0.09), sd + i * 3.1) * 0.085 + Math.sin(t * 0.9 - i * 0.7 + sd) * 0.05);
      const lift = rip >= 0 ? bump((rip - (3 - i) * 0.09) / 0.5) : 0;
      const shake = tr * wob(t * (27 + i * 3), sd + i) * 0.035;
      for (let j = 0; j < 4; j++) {
        let goal = lf[j];
        if (j < 3) {
          if (this.grip) {
            // never past the wrap by more than a squeeze; free to ease off it
            goal += sq * (j === 0 ? 0.05 : 0.025) - lift * (j === 0 ? 0.2 : j === 1 ? 0.12 : 0.05) - Math.max(0, drift) * 0.25 + shake * 0.3;
          } else {
            goal += drift * (j === 0 ? 1 : j === 1 ? 1.25 : 0.8) + sq * (j === 0 ? 0.3 : 0.15) + shake;
          }
        } else if (!this.grip) goal += life * wob(t * 0.4, sd + 20 + i) * 0.025 * (i - 1.5);
        const w = W0 * rate * (1 - i * 0.1) * (j === 0 || j === 3 ? 1 : j === 1 ? 0.88 : 0.76);
        const k = i * 4 + j;
        let v = this.vf[k];
        // (semi-implicit, stable at any frame time the game clamps to)
        v += (w * w * (goal - pf[j]) - 2 * zeta * w * v) * dt;
        // weight: the fingertips resist the hand's acceleration, the far joints most
        if (j < 3 && acc) v += acc * (j === 0 ? 0.5 : 0.8) * (1 + i * 0.12) * dt;
        v = v > 40 ? 40 : v < -40 ? -40 : v;
        let x = pf[j] + v * dt;
        // a finger bends one way: it stops at its limits (and on the pole it holds)
        if (j < 3) {
          const lo = j === 0 ? -0.35 : -0.05, hi = this.grip ? rf[j] + 0.07 : j === 0 ? 1.6 : 1.9;
          if (x < lo) { x = lo; if (v < 0) v = 0; } else if (x > hi) { x = hi; if (v > 0) v = 0; }
        }
        pf[j] = x; this.vf[k] = v;
      }
    }
    // the thumb: one spring, a slow roll of its own
    const at = 1 - Math.exp(-dt * rate * 40), wt = W0 * rate * 0.8;
    const tl = rip >= 0 ? bump((rip - 0.3) / 0.55) : 0;
    for (let j = 0; j < 5; j++) {
      L.t[j] += (T.t[j] - L.t[j]) * at;
      let goal = L.t[j];
      if (!this.grip) goal += life * wob(t * (0.45 + j * 0.07), sd + 40 + j * 2.3) * (j < 3 ? 0.045 : 0.07) + (j > 2 ? sq * 0.15 + tr * wob(t * 31, sd + j) * 0.03 : 0);
      else if (j > 2) goal += sq * 0.03 - tl * 0.14;
      let v = this.vt[j];
      v += (wt * wt * (goal - P.t[j]) - 2 * zeta * wt * v) * dt;
      if (j > 2 && acc) v += acc * 0.4 * dt;
      P.t[j] += v * dt; this.vt[j] = v;
    }
  }
}
