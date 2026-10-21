// One-shot sound definitions. Each entry: { fn(v, opts), cat, verb, cap?, pv? }
//   fn   builds the sound on a Voice (see core.js)
//   cat  mix category (used for level calibration, see calib.js)
//   verb default reverb send (0..1)
//   cap  max concurrent instances (default 6), pv pitch variation (default 0.065)
import { rnd, pick } from './core.js';

export const SFX = {};
const def = (name, cat, verb, fn, x = {}) => { SFX[name] = { fn, cat, verb, ...x }; };

// ------------------------------------------------------------ building blocks
const whoosh = (v, o = {}) => {
  const dur = o.dur ?? 0.35;
  v.noise({ buf: o.buf || 'pink', t: o.t, dur, a: o.a ?? dur * 0.4, peak: o.peak ?? 0.6, lin: true, pan: o.pan,
    filt: { type: 'bp', f: o.f ?? 450, f2: o.f2 ?? 1800, ft: o.ft ?? dur * 0.45, f3: o.f3 ?? 600, q: o.q ?? 1.6 } });
};
const crackle = (v, o = {}) => v.noise({ buf: 'crackle', t: o.t, dur: o.dur ?? 0.3, a: o.a ?? 0.01, peak: o.peak ?? 0.5, rate: o.rate ?? 1, filt: { type: 'hp', f: o.hp ?? 1500 } });
const burst = (v, o = {}) => v.noise({ buf: 'white', t: o.t, dur: o.dur ?? 0.06, a: 0.001, peak: o.peak ?? 0.8, filt: { type: o.type || 'hp', f: o.f ?? 2000, q: o.q }, drive: o.drive });
const rumble = (v, o = {}) => v.noise({ buf: 'brown', t: o.t, dur: o.dur ?? 1, a: o.a ?? 0.02, peak: o.peak ?? 0.8, filt: { type: 'lp', f: o.f ?? 300, f2: o.f2, q: o.q ?? 0 }, drive: o.drive });
const ping = (v, f, o = {}) => v.osc({ type: 'sine', f, t: o.t, dur: o.dur ?? 0.4, a: o.a ?? 0.002, peak: o.peak ?? 0.2, pan: o.pan });
const pings = (v, n, notes, o = {}) => {
  for (let i = 0; i < n; i++) ping(v, pick(notes) * (o.oct && Math.random() < 0.3 ? 2 : 1), { t: (o.t ?? 0) + i * (o.gap ?? 0.04) + rnd(0, o.jit ?? 0.01), dur: o.dur ?? 0.45, peak: o.peak ?? 0.15, pan: rnd(-0.5, 0.5) });
};
const METAL = [[1, 1, 1], [1.47, 0.7, 0.8], [2.09, 0.5, 0.6], [2.56, 0.35, 0.45], [3.37, 0.25, 0.32]];
const metal = (v, o) => v.bell({ f: o.f, t: o.t, dur: o.dur ?? 0.6, peak: o.peak ?? 0.12, partials: o.partials || METAL });
const COIN = [[1, 1, 1], [2.4, 0.6, 0.55], [3.9, 0.35, 0.35], [5.3, 0.2, 0.25]];
const coins = (v, n, span, peak = 0.1, t0 = 0) => {
  for (let i = 0; i < n; i++) v.bell({ f: rnd(2400, 3900), t: t0 + rnd(0, span), dur: rnd(0.15, 0.32), peak: peak * rnd(0.6, 1), partials: COIN });
};
const bubbles = (v, n, span, base, peak, t0 = 0) => {
  for (let i = 0; i < n; i++) {
    const f = base * rnd(0.7, 1.6);
    v.osc({ type: 'sine', f, f2: f * rnd(1.8, 2.8), ft: 0.035, dur: rnd(0.04, 0.08), a: 0.003, peak: peak * rnd(0.5, 1), t: t0 + rnd(0, span) });
  }
};
const pebbles = (v, n, span, t0 = 0, peak = 0.3) => {
  for (let i = 0; i < n; i++) v.noise({ buf: 'white', t: t0 + rnd(0, span), dur: rnd(0.02, 0.05), a: 0.001, peak: peak * rnd(0.4, 1), filt: { type: 'bp', f: rnd(1500, 4000), q: 4 } });
};
const squelch = (v, t = 0, peak = 0.7) => {
  v.noise({ buf: 'pink', t, dur: 0.22, a: 0.004, peak, filt: { type: 'bp', f: 2400, f2: 260, ft: 0.16, q: 5 } });
  v.noise({ buf: 'brown', t, dur: 0.12, a: 0.003, peak: peak * 0.8, filt: { type: 'lp', f: 700 } });
};
const ticks = (v, n, gap, t0 = 0, peak = 0.4, accel = 1) => {
  let t = t0, g = gap;
  for (let i = 0; i < n; i++) {
    v.noise({ buf: 'white', t, dur: 0.035, a: 0.001, peak, filt: { type: 'bp', f: i % 2 ? 2600 : 3600, q: 9 } });
    ping(v, i % 2 ? 1250 : 1650, { t, dur: 0.06, peak: peak * 0.35 });
    t += g; g *= accel;
  }
};
const grunt = (v, o = {}) => v.osc({ type: 'sawtooth', t: o.t, f: o.f ?? 150, f2: o.f2 ?? 95, dur: o.dur ?? 0.18, a: o.a ?? 0.01, peak: o.peak ?? 0.4,
  filt: [{ type: 'bp', f: o.f1 ?? 650, q: 3, fixed: true }, { type: 'lp', f: 1600, fixed: true }], drive: o.drive ?? 2, vib: o.vib });
const HOLY = [523.25, 659.25, 783.99, 1046.5];
const FROST = [2093, 2349, 2637, 3136, 3520, 4186];
const SPARK = [2637, 3136, 3951, 4699, 5274];

// --------------------------------------------------------------- spells -----
const SPELL = {
  fire(v, k) {
    if (k === 'cast') {
      whoosh(v, { dur: 0.38, f: 500, f2: 2200, f3: 700, q: 1.3, peak: 0.6 });
      rumble(v, { dur: 0.32, a: 0.008, f: 1400, f2: 300, peak: 0.6, drive: 2 });
      crackle(v, { dur: 0.35, peak: 0.45, hp: 2000 });
      v.thump({ f: 115, f2: 55, dur: 0.16, peak: 0.4 });
    } else if (k === 'big') {
      v.noise({ buf: 'brown', dur: 1.1, a: 0.04, peak: 0.9, filt: { type: 'lp', f: 600, f2: 2400, ft: 0.25, f3: 300 }, drive: 3 });
      whoosh(v, { dur: 0.7, f: 300, f2: 1900, f3: 400, q: 1, peak: 0.6 });
      crackle(v, { dur: 1.0, a: 0.05, peak: 0.55, rate: 0.8, hp: 1200 });
      v.thump({ f: 90, f2: 35, dur: 0.55, peak: 0.8, t: 0.02 });
    } else {
      v.thump({ f: 130, f2: 40, dur: 0.35, peak: 0.85 });
      v.noise({ buf: 'brown', dur: 0.6, a: 0.003, peak: 0.9, filt: { type: 'lp', f: 3000, f2: 250, ft: 0.5 }, drive: 2 });
      crackle(v, { t: 0.03, dur: 0.7, peak: 0.55, rate: 1.2 });
      v.noise({ buf: 'pink', dur: 0.45, a: 0.01, peak: 0.35, filt: { type: 'bp', f: 1300, f2: 380, q: 0.8 } });
    }
  },
  frost(v, k) {
    if (k === 'cast') {
      pings(v, 3, FROST, { gap: 0.035, dur: 0.5, peak: 0.13 });
      v.noise({ buf: 'white', dur: 0.35, a: 0.03, peak: 0.45, filt: { type: 'bp', f: 7500, f2: 4200, q: 1.5 } });
      whoosh(v, { dur: 0.25, f: 1400, f2: 3600, f3: 2000, q: 2, peak: 0.35 });
    } else if (k === 'big') {
      pings(v, 6, FROST, { gap: 0.05, dur: 0.8, peak: 0.12, oct: true });
      v.osc({ f: 1046, mod: { ratio: 3.5, index: 2.5, index2: 0 }, dur: 1.3, a: 0.01, peak: 0.12 });
      v.thump({ f: 220, f2: 70, dur: 0.4, peak: 0.45 });
      v.noise({ buf: 'white', dur: 0.9, a: 0.15, peak: 0.45, lin: true, filt: { type: 'bp', f: 3000, f2: 9000, q: 1.2 }, trem: { rate: 11, depth: 0.5 } });
      crackle(v, { dur: 0.5, peak: 0.4, hp: 4000, rate: 1.6 });
    } else {
      crackle(v, { dur: 0.13, peak: 0.85, hp: 2500, rate: 2 });
      burst(v, { dur: 0.045, type: 'bp', f: 3600, q: 3, peak: 0.9 });
      pings(v, 2, FROST, { gap: 0.02, dur: 0.4, peak: 0.12 });
      v.thump({ f: 210, f2: 90, dur: 0.13, peak: 0.45 });
      v.noise({ buf: 'white', dur: 0.5, a: 0.01, peak: 0.25, filt: { type: 'hp', f: 6500 } });
    }
  },
  lightning(v, k) {
    const zap = (o) => v.osc({ type: 'sawtooth', t: o.t, f: o.f ?? 2400, f2: o.f2 ?? 180, ft: o.dur * 0.8, dur: o.dur, a: 0.001, peak: o.peak ?? 0.3, filt: { type: 'bp', f: 2000, q: 0.9 }, drive: 6 });
    const buzz = (o) => v.noise({ buf: 'white', t: o.t, dur: o.dur, a: 0.005, peak: o.peak ?? 0.35, filt: { type: 'bp', f: 3200, q: 0.8 }, trem: { rate: rnd(55, 80), depth: 1, type: 'square' } });
    if (k === 'cast') {
      zap({ dur: 0.2 });
      crackle(v, { dur: 0.3, peak: 0.75, hp: 1800, rate: 2.5 });
      buzz({ dur: 0.22 });
    } else if (k === 'big') {
      burst(v, { dur: 0.14, f: 900, peak: 1, drive: 3 });
      crackle(v, { dur: 0.7, peak: 0.8, hp: 1200, rate: 2 });
      rumble(v, { t: 0.04, dur: 1.7, a: 0.06, f: 220, peak: 1 });
      zap({ dur: 0.25, f: 3000 }); zap({ t: 0.09, dur: 0.3, f: 2000, f2: 120 });
      buzz({ dur: 0.5, peak: 0.3 });
    } else {
      burst(v, { dur: 0.06, type: 'bp', f: 2600, q: 0.8, peak: 1 });
      zap({ dur: 0.11, f: 3200, f2: 400, peak: 0.25 });
      crackle(v, { dur: 0.28, peak: 0.7, hp: 1500, rate: 2.2 });
      v.thump({ f: 150, f2: 60, dur: 0.16, peak: 0.55 });
    }
  },
  arcane(v, k) {
    if (k === 'cast') {
      v.osc({ f: 520, f2: 1300, ft: 0.25, dur: 0.45, a: 0.02, peak: 0.22, mod: { ratio: 1.5, index: 3, index2: 0.4 } });
      pings(v, 3, SPARK, { t: 0.05, gap: 0.05, dur: 0.3, peak: 0.07 });
      whoosh(v, { dur: 0.3, f: 900, f2: 2600, f3: 1200, q: 3, peak: 0.35 });
    } else if (k === 'big') {
      v.osc({ f: 260, f2: 900, ft: 0.6, dur: 1.2, a: 0.15, peak: 0.25, mod: { ratio: 2.01, index: 5, index2: 0.4 } });
      v.osc({ f: 65, dur: 1.0, a: 0.08, peak: 0.45 });
      pings(v, 6, SPARK, { t: 0.1, gap: 0.07, dur: 0.5, peak: 0.07 });
      v.noise({ buf: 'white', dur: 0.9, a: 0.2, peak: 0.25, lin: true, filt: { type: 'hp', f: 6000 }, trem: { rate: 12, depth: 0.7 } });
      v.noise({ buf: 'pink', dur: 0.5, rev: true, peak: 0.45, filt: { type: 'bp', f: 600, f2: 3000, q: 2 } });
    } else {
      v.osc({ f: 1400, f2: 300, ft: 0.2, dur: 0.4, peak: 0.22, mod: { ratio: 1.41, index: 4, index2: 0 } });
      v.noise({ buf: 'pink', dur: 0.16, peak: 0.5, filt: { type: 'bp', f: 1500, q: 2 } });
      v.thump({ f: 160, f2: 70, dur: 0.16, peak: 0.5 });
      pings(v, 2, SPARK, { t: 0.02, dur: 0.35, peak: 0.07 });
    }
  },
  holy(v, k) {
    if (k === 'cast') {
      HOLY.slice(0, 3).forEach((f, i) => v.bell({ f, t: i * 0.025, dur: 1.0, peak: 0.08 }));
      whoosh(v, { dur: 0.3, f: 1800, f2: 5000, f3: 3000, q: 1, peak: 0.3 });
      v.noise({ buf: 'white', dur: 0.6, a: 0.05, peak: 0.15, filt: { type: 'hp', f: 7000 }, trem: { rate: 9, depth: 0.6 } });
    } else if (k === 'big') {
      v.choir({ freqs: [261.6, 329.6, 392, 523.3], dur: 1.7, a: 0.2, peak: 0.12, vowel: 'a' });
      HOLY.forEach((f, i) => v.bell({ f, t: 0.05 + i * 0.04, dur: 1.6, peak: 0.07 }));
      v.osc({ f: 130.8, dur: 1.2, a: 0.1, peak: 0.3 });
      v.noise({ buf: 'white', dur: 1.2, a: 0.3, peak: 0.18, lin: true, filt: { type: 'hp', f: 6000 }, trem: { rate: 7, depth: 0.6 } });
      v.thump({ f: 140, f2: 60, dur: 0.4, peak: 0.45 });
    } else {
      [HOLY[0], HOLY[2], HOLY[3]].forEach((f) => v.bell({ f, dur: 0.75, peak: 0.08 }));
      v.thump({ f: 180, f2: 80, dur: 0.15, peak: 0.5 });
      v.noise({ buf: 'white', dur: 0.25, peak: 0.35, filt: { type: 'hp', f: 3000 } });
      ping(v, 3136, { t: 0.03, dur: 0.4, peak: 0.07 });
    }
  },
  shadow(v, k) {
    const growl = (o) => v.osc({ type: 'sawtooth', t: o.t, f: o.f ?? 70, f2: o.f2 ?? 48, dur: o.dur, a: o.a ?? 0.05, peak: o.peak ?? 0.4,
      filt: { type: 'lp', f: 520, q: 6 }, drive: 3, vib: { rate: 23, depth: 0.08 } });
    if (k === 'cast') {
      v.noise({ buf: 'pink', dur: 0.28, rev: true, peak: 0.7, filt: { type: 'lp', f: 400, f2: 2000, q: 3 } });
      growl({ dur: 0.45 });
      v.thump({ t: 0.25, f: 90, f2: 40, dur: 0.25, peak: 0.5 });
    } else if (k === 'big') {
      v.noise({ buf: 'brown', dur: 0.7, rev: true, peak: 0.9, filt: { type: 'lp', f: 200, f2: 1400, q: 4 } });
      growl({ dur: 1.3, f: 55, f2: 40, a: 0.2, peak: 0.45 }); growl({ dur: 1.2, f: 56.5, f2: 41, a: 0.25, peak: 0.3 });
      v.thump({ t: 0.65, f: 80, f2: 28, dur: 0.6, peak: 0.85 });
      v.noise({ buf: 'pink', t: 0.2, dur: 1.0, a: 0.3, peak: 0.25, lin: true, filt: { type: 'bp', f: 2300, q: 5 }, trem: { rate: 7, depth: 0.8 } });
    } else {
      v.thump({ f: 95, f2: 30, dur: 0.5, peak: 0.85 });
      v.noise({ buf: 'brown', dur: 0.5, peak: 0.8, filt: { type: 'lp', f: 1300, f2: 150 }, drive: 2 });
      growl({ dur: 0.35, a: 0.01, peak: 0.3 });
      v.noise({ buf: 'pink', dur: 0.3, rev: true, peak: 0.3, filt: { type: 'bp', f: 900, q: 2 } });
    }
  },
  poison(v, k) {
    if (k === 'cast') {
      bubbles(v, 7, 0.3, 380, 0.3);
      v.noise({ buf: 'brown', dur: 0.32, a: 0.02, peak: 0.6, filt: { type: 'lp', f: 900, q: 8 }, trem: { rate: 18, depth: 0.7 } });
      v.noise({ buf: 'white', dur: 0.25, a: 0.05, peak: 0.2, filt: { type: 'bp', f: 3200, q: 1.5 } });
    } else if (k === 'big') {
      bubbles(v, 16, 0.8, 300, 0.3);
      v.osc({ type: 'sawtooth', f: 90, f2: 70, dur: 0.9, a: 0.05, peak: 0.35, filt: { type: 'lp', f: 600, q: 10 }, vib: { rate: 12, depth: 0.2 } });
      v.noise({ buf: 'pink', dur: 0.5, peak: 0.6, filt: { type: 'bp', f: 1300, f2: 400, q: 2 } });
      v.noise({ buf: 'white', dur: 0.8, a: 0.2, peak: 0.18, lin: true, filt: { type: 'bp', f: 3500, q: 1.5 } });
    } else {
      v.noise({ buf: 'pink', dur: 0.25, peak: 0.9, filt: { type: 'bp', f: 1100, f2: 300, q: 2 }, drive: 2 });
      bubbles(v, 9, 0.45, 300, 0.3, 0.03);
      v.thump({ f: 140, f2: 60, dur: 0.12, peak: 0.5 });
    }
  },
  blood(v, k) {
    const heart = (t, peak) => { v.thump({ t, f: 70, f2: 42, dur: 0.18, peak }); v.thump({ t: t + 0.22, f: 78, f2: 46, dur: 0.16, peak: peak * 0.7 }); };
    if (k === 'cast') {
      squelch(v, 0, 0.6);
      v.thump({ f: 75, f2: 42, dur: 0.2, peak: 0.6 });
      whoosh(v, { dur: 0.25, f: 600, f2: 1600, f3: 500, peak: 0.3 });
    } else if (k === 'big') {
      heart(0, 0.8);
      squelch(v, 0.05, 0.6); squelch(v, 0.3, 0.5); squelch(v, 0.5, 0.4);
      v.osc({ type: 'sawtooth', f: 55, dur: 1.0, a: 0.2, peak: 0.3, filt: { type: 'lp', f: 300, q: 6 } });
      v.noise({ buf: 'pink', dur: 0.6, rev: true, peak: 0.4, filt: { type: 'bp', f: 500, f2: 1500, q: 2 } });
    } else {
      squelch(v, 0, 0.85);
      v.thump({ f: 110, f2: 50, dur: 0.2, peak: 0.7 });
      for (let i = 0; i < 3; i++) v.noise({ buf: 'white', t: rnd(0.02, 0.18), dur: 0.05, peak: 0.25, filt: { type: 'bp', f: rnd(2000, 4000), q: 2 } });
    }
  },
  earth(v, k) {
    const crunch = (t, dur, peak, rate) => {
      v.noise({ buf: 'crackle', t, dur, rate, peak, filt: { type: 'bp', f: 1400, q: 1.2 } });
      v.noise({ buf: 'brown', t, dur: dur * 0.8, peak: peak * 0.7, filt: { type: 'lp', f: 500 } });
    };
    if (k === 'cast') {
      rumble(v, { dur: 0.5, a: 0.05, f: 180, peak: 1 });
      crunch(0, 0.28, 0.6, 0.6);
      v.thump({ f: 80, f2: 45, dur: 0.3, peak: 0.6 });
    } else if (k === 'big') {
      v.thump({ f: 62, f2: 28, dur: 1.0, peak: 0.95 });
      rumble(v, { dur: 1.4, a: 0.03, f: 320, f2: 80, peak: 1, drive: 2 });
      crunch(0.02, 0.9, 0.7, 0.5);
      pebbles(v, 7, 0.9, 0.2, 0.35);
    } else {
      v.thump({ f: 75, f2: 32, dur: 0.6, peak: 0.95 });
      crunch(0, 0.4, 0.75, 0.7);
      v.noise({ buf: 'brown', dur: 0.4, peak: 0.6, filt: { type: 'lp', f: 2000, f2: 200 } });
      pebbles(v, 4, 0.4, 0.1, 0.3);
    }
  },
  time(v, k) {
    if (k === 'cast') {
      ticks(v, 3, 0.07, 0, 0.4);
      v.osc({ f: 300, f2: 1500, dur: 0.3, rev: true, peak: 0.2, mod: { ratio: 2, index: 2, index2: 0 } });
      v.noise({ buf: 'white', dur: 0.3, rev: true, peak: 0.25, filt: { type: 'hp', f: 4000 } });
    } else if (k === 'big') {
      ticks(v, 7, 0.06, 0, 0.35, 1.18);
      v.bell({ f: 220, dur: 2.0, peak: 0.16, t: 0.02, partials: [[1, 1, 1], [2.0, 0.6, 0.7], [3.01, 0.3, 0.45], [4.2, 0.2, 0.3]] });
      v.noise({ buf: 'pink', dur: 0.8, rev: true, peak: 0.5, filt: { type: 'bp', f: 400, f2: 3000, q: 2 } });
      v.osc({ f: 55, dur: 1.2, a: 0.1, peak: 0.4 });
    } else {
      ticks(v, 2, 0.08, 0, 0.45);
      v.noise({ buf: 'pink', dur: 0.15, rev: true, peak: 0.5, filt: { type: 'bp', f: 2000, q: 1.5 } });
      v.bell({ f: 880, t: 0.15, dur: 0.5, peak: 0.07 });
      v.thump({ t: 0.15, f: 140, f2: 60, dur: 0.15, peak: 0.4 });
    }
  },
  wind(v, k) {
    if (k === 'cast') {
      whoosh(v, { dur: 0.45, f: 350, f2: 1600, f3: 500, q: 2.5, peak: 0.8 });
      v.noise({ buf: 'white', dur: 0.4, a: 0.12, peak: 0.12, lin: true, filt: { type: 'bp', f: 2200, f2: 3000, q: 14 } });
    } else if (k === 'big') {
      whoosh(v, { dur: 0.6, f: 300, f2: 1400, f3: 400, q: 2, peak: 0.7, pan: -0.4 });
      whoosh(v, { t: 0.12, dur: 0.7, f: 400, f2: 1900, f3: 500, q: 2, peak: 0.6, pan: 0.4 });
      v.noise({ buf: 'brown', dur: 1.0, a: 0.3, peak: 0.8, lin: true, filt: { type: 'lp', f: 400 } });
      v.noise({ buf: 'white', dur: 0.9, a: 0.3, peak: 0.1, lin: true, filt: { type: 'bp', f: 1800, f2: 3200, q: 16 }, trem: { rate: 3, depth: 0.5 } });
    } else {
      whoosh(v, { dur: 0.3, f: 1600, f2: 500, f3: 300, a: 0.03, q: 1.5, peak: 0.7 });
      v.thump({ f: 120, f2: 70, dur: 0.14, peak: 0.4 });
    }
  },
  blade(v, k) {
    const shing = (t, peak) => v.noise({ buf: 'white', t, dur: 0.3, a: 0.02, peak, lin: true, filt: { type: 'hp', f: 3000, f2: 8000, ft: 0.15 } });
    if (k === 'cast') {
      shing(0, 0.4);
      whoosh(v, { dur: 0.2, f: 800, f2: 2200, f3: 900, q: 2, peak: 0.45 });
      metal(v, { f: 1900, dur: 0.6, peak: 0.1, t: 0.03 });
    } else if (k === 'big') {
      shing(0, 0.4); shing(0.12, 0.35);
      whoosh(v, { dur: 0.5, f: 300, f2: 1600, f3: 400, q: 1.5, peak: 0.6 });
      metal(v, { f: 1500, dur: 1.1, peak: 0.1, t: 0.03 }); metal(v, { f: 2250, dur: 0.9, peak: 0.07, t: 0.14 });
    } else {
      v.noise({ buf: 'white', dur: 0.08, peak: 0.7, filt: { type: 'bp', f: 3000, q: 1 } });
      metal(v, { f: 1300, dur: 0.35, peak: 0.12 });
      v.thump({ f: 130, f2: 60, dur: 0.1, peak: 0.55 });
      squelch(v, 0, 0.3);
    }
  },
};
export const ELEMENTS = Object.keys(SPELL);
for (const el of ELEMENTS) {
  def(`cast_${el}`, 'cast', 0.18, (v) => SPELL[el](v, 'cast'));
  def(`cast_${el}_big`, 'bigcast', 0.3, (v) => SPELL[el](v, 'big'));
  def(`impact_${el}`, 'impact', 0.25, (v) => SPELL[el](v, 'impact'));
}

// ---------------------------------------------------------------- generic ---
def('explosion', 'boom', 0.35, (v) => {
  v.thump({ f: 105, f2: 32, dur: 0.6, peak: 0.95 });
  rumble(v, { dur: 1.3, a: 0.002, f: 3200, f2: 180, peak: 1, drive: 3 });
  burst(v, { dur: 0.09, f: 1200, peak: 0.9, drive: 2 });
  crackle(v, { t: 0.05, dur: 0.9, peak: 0.45, rate: 0.9, hp: 1000 });
});
def('explosion_big', 'boom', 0.45, (v) => {
  v.thump({ f: 90, f2: 26, dur: 1.1, peak: 1 });
  rumble(v, { dur: 2.4, a: 0.002, f: 2600, f2: 90, peak: 1, drive: 4 });
  burst(v, { dur: 0.14, f: 700, peak: 1, drive: 3 });
  rumble(v, { t: 0.1, dur: 2.6, a: 0.3, f: 120, peak: 0.9 });
  crackle(v, { t: 0.08, dur: 1.6, peak: 0.45, rate: 0.7, hp: 900 });
  pebbles(v, 8, 1.5, 0.3, 0.25);
}, { cap: 4 });
def('shockwave', 'impact', 0.3, (v) => {
  v.thump({ f: 180, f2: 38, dur: 0.5, peak: 0.85 });
  v.noise({ buf: 'pink', dur: 0.6, a: 0.005, peak: 0.8, filt: { type: 'bp', f: 3000, f2: 200, ft: 0.45, q: 1.5 } });
  v.noise({ buf: 'white', dur: 0.8, a: 0.05, peak: 0.12, lin: true, filt: { type: 'hp', f: 5000 } });
});
def('dash', 'move', 0.12, (v) => {
  whoosh(v, { dur: 0.28, f: 700, f2: 2600, f3: 600, a: 0.06, q: 1.4, peak: 0.8 });
  v.noise({ buf: 'brown', dur: 0.2, a: 0.03, peak: 0.4, filt: { type: 'lp', f: 500 } });
});
def('blink', 'move', 0.3, (v) => {
  v.osc({ f: 400, f2: 2400, ft: 0.12, f3: 800, dur: 0.3, a: 0.005, peak: 0.25, mod: { ratio: 2.5, index: 3, index2: 0 } });
  v.osc({ t: 0.12, f: 900, f2: 180, dur: 0.12, peak: 0.35 });
  v.noise({ buf: 'white', dur: 0.15, rev: true, peak: 0.35, filt: { type: 'hp', f: 3000 } });
  pings(v, 3, SPARK, { t: 0.12, gap: 0.03, dur: 0.3, peak: 0.06 });
});
def('jump', 'move', 0.05, (v) => {
  whoosh(v, { dur: 0.18, f: 400, f2: 1200, f3: 700, a: 0.03, q: 1, peak: 0.35 });
  v.noise({ buf: 'pink', dur: 0.06, peak: 0.25, filt: { type: 'bp', f: 900, q: 1 } });
});
def('land', 'move', 0.08, (v) => {
  v.thump({ f: 95, f2: 50, dur: 0.14, peak: 0.8 });
  v.noise({ buf: 'brown', dur: 0.12, peak: 0.6, filt: { type: 'lp', f: 600 } });
  v.noise({ buf: 'crackle', dur: 0.1, rate: 0.7, peak: 0.3, filt: { type: 'bp', f: 2000, q: 1 } });
});

// Footsteps: quiet, high variety (random filter tuning per call).
def('footstep_stone', 'step', 0.08, (v) => {
  v.noise({ buf: 'white', dur: 0.035, a: 0.001, peak: 0.6, filt: { type: 'bp', f: rnd(1400, 2400), q: 2 } });
  v.noise({ buf: 'brown', dur: 0.08, a: 0.002, peak: 0.6, filt: { type: 'lp', f: rnd(250, 400) } });
  v.noise({ buf: 'crackle', t: 0.01, dur: 0.05, rate: 0.6, peak: 0.25, filt: { type: 'bp', f: 3000, q: 1 } });
}, { pv: 0.08 });
def('footstep_water', 'step', 0.1, (v) => {
  v.noise({ buf: 'pink', dur: 0.18, a: 0.005, peak: 0.6, filt: { type: 'bp', f: rnd(1300, 1900), f2: 500, q: 1.5 } });
  bubbles(v, 3, 0.12, 500, 0.18, 0.02);
  v.noise({ buf: 'white', dur: 0.1, a: 0.01, peak: 0.12, filt: { type: 'hp', f: 4000 } });
}, { pv: 0.08 });
def('footstep_grass', 'step', 0.04, (v) => {
  v.noise({ buf: 'white', dur: 0.12, a: 0.02, peak: 0.3, filt: { type: 'bp', f: rnd(2500, 4000), q: 0.8 } });
  v.noise({ buf: 'brown', dur: 0.07, peak: 0.4, filt: { type: 'lp', f: 300 } });
  v.noise({ buf: 'crackle', dur: 0.1, rate: 1.4, peak: 0.12, filt: { type: 'hp', f: 3500 } });
}, { pv: 0.08 });
def('footstep_wood', 'step', 0.12, (v) => {
  v.noise({ buf: 'white', dur: 0.08, a: 0.001, peak: 0.6, filt: { type: 'bp', f: rnd(350, 520), q: 6 } });
  v.thump({ f: 140, f2: 90, dur: 0.07, peak: 0.35 });
  v.noise({ buf: 'white', dur: 0.025, a: 0.001, peak: 0.2, filt: { type: 'bp', f: 2200, q: 2 } });
}, { pv: 0.08 });

def('hurt', 'player', 0.12, (v) => {
  v.thump({ f: 115, f2: 55, dur: 0.2, peak: 0.85 });
  v.noise({ buf: 'pink', dur: 0.12, peak: 0.6, filt: { type: 'bp', f: 450, q: 1.2 } });
  grunt(v, { f: rnd(135, 165), f2: 90, dur: 0.2, peak: 0.35 });
}, { cap: 3 });
def('player_death', 'player', 0.45, (v) => {
  grunt(v, { f: 170, f2: 70, dur: 1.2, a: 0.02, peak: 0.35, vib: { rate: 6, depth: 0.03 } });
  v.thump({ f: 80, f2: 28, dur: 0.9, peak: 0.9 });
  v.noise({ buf: 'pink', dur: 1.0, rev: true, peak: 0.4, filt: { type: 'lp', f: 300, f2: 3000, q: 2 } });
  v.bell({ t: 0.8, f: 110, dur: 3.0, peak: 0.16, partials: [[1, 1, 1], [2.2, 0.6, 0.6], [3.6, 0.4, 0.4], [5.1, 0.2, 0.25]] });
}, { cap: 2 });
def('downed', 'player', 0.35, (v) => {
  v.thump({ f: 100, f2: 35, dur: 0.6, peak: 0.85 });
  v.osc({ type: 'triangle', f: 330, f2: 110, dur: 1.2, a: 0.02, peak: 0.25, filt: { type: 'lp', f: 1200 } });
  v.thump({ t: 0.5, f: 65, f2: 42, dur: 0.18, peak: 0.6 }); v.thump({ t: 0.72, f: 72, f2: 45, dur: 0.16, peak: 0.45 });
  v.noise({ buf: 'brown', dur: 0.3, peak: 0.6, filt: { type: 'lp', f: 600 } });
}, { cap: 2 });
def('revive', 'player', 0.4, (v) => {
  [523.25, 659.25, 783.99, 1046.5, 1318.5].forEach((f, i) => v.bell({ f, t: i * 0.08, dur: 1.0, peak: 0.07 }));
  v.noise({ buf: 'pink', dur: 0.8, rev: true, peak: 0.4, filt: { type: 'bp', f: 500, f2: 4000, q: 1.5 } });
  v.choir({ freqs: [261.6, 392, 523.3], t: 0.2, dur: 1.4, a: 0.3, peak: 0.08, vowel: 'a' });
}, { cap: 2 });
def('heal', 'player', 0.35, (v) => {
  [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => v.osc({ type: 'sine', f, t: i * 0.06, dur: 0.9, a: 0.02, peak: 0.12 }));
  v.osc({ f: 261.6, dur: 0.9, a: 0.1, peak: 0.15, mod: { ratio: 2, index: 0.8, index2: 0 } });
  v.noise({ buf: 'white', dur: 0.7, a: 0.1, peak: 0.12, lin: true, filt: { type: 'hp', f: 6500 }, trem: { rate: 10, depth: 0.6 } });
}, { cap: 3 });
def('shield', 'player', 0.3, (v) => {
  v.osc({ f: 180, f2: 240, dur: 0.8, a: 0.04, peak: 0.25, mod: { ratio: 1, index: 3, index2: 0.5 } });
  v.noise({ buf: 'pink', dur: 0.5, a: 0.05, peak: 0.45, filt: { type: 'bp', f: 600, f2: 2200, q: 6 } });
  metal(v, { f: 1100, dur: 0.9, peak: 0.07, t: 0.04 });
  v.thump({ f: 140, f2: 80, dur: 0.15, peak: 0.4 });
}, { cap: 3 });
def('buff', 'player', 0.3, (v) => {
  v.osc({ f: 400, f2: 800, ft: 0.25, dur: 0.6, a: 0.02, peak: 0.16, mod: { ratio: 2, index: 1.2, index2: 0.2 } });
  v.osc({ f: 600, f2: 1200, ft: 0.25, dur: 0.6, a: 0.04, peak: 0.1 });
  whoosh(v, { dur: 0.4, f: 500, f2: 3000, f3: 2000, q: 2, peak: 0.3 });
}, { cap: 3 });
def('crit', 'fb', 0.12, (v) => {
  ping(v, 2600, { dur: 0.25, peak: 0.25 }); ping(v, 3900, { dur: 0.18, peak: 0.15 });
  burst(v, { dur: 0.02, type: 'bp', f: 5000, q: 1, peak: 0.6 });
  v.thump({ f: 200, f2: 90, dur: 0.08, peak: 0.4 });
}, { pv: 0.04 });
def('hitmarker', 'fb_soft', 0, (v) => {
  burst(v, { dur: 0.015, f: 4000, peak: 0.6 });
  ping(v, 1900, { dur: 0.04, peak: 0.3 });
}, { cap: 4, pv: 0.05 });
def('kill', 'fb', 0.15, (v) => {
  v.thump({ f: 170, f2: 70, dur: 0.14, peak: 0.85 });
  burst(v, { dur: 0.02, type: 'bp', f: 2500, q: 2, peak: 0.4 });
  v.bell({ f: 660, t: 0.01, dur: 0.4, peak: 0.07 });
}, { pv: 0.04 });
def('ultimate_ready', 'fb', 0.35, (v) => {
  [587.3, 880, 1174.7, 1760].forEach((f, i) => v.bell({ f, t: i * 0.07, dur: 0.9, peak: 0.08 }));
  v.noise({ buf: 'white', dur: 0.5, rev: true, peak: 0.2, filt: { type: 'hp', f: 5000 } });
}, { pv: 0.01, cap: 2 });
def('cooldown_ready', 'fb_soft', 0.1, (v) => {
  ping(v, 1500, { dur: 0.08, peak: 0.25 }); ping(v, 2250, { t: 0.03, dur: 0.1, peak: 0.15 });
}, { pv: 0.02 });
def('freeze', 'impact', 0.25, (v) => {
  for (let i = 0; i < 4; i++) burst(v, { t: rnd(0, 0.18), dur: 0.03, type: 'bp', f: rnd(2500, 5000), q: 3, peak: 0.6 });
  crackle(v, { dur: 0.3, peak: 0.6, hp: 3000, rate: 1.8 });
  v.noise({ buf: 'brown', dur: 0.2, peak: 0.5, filt: { type: 'lp', f: 800 } });
  pings(v, 3, FROST, { t: 0.05, gap: 0.06, dur: 0.6, peak: 0.08 });
});
def('shatter', 'impact', 0.3, (v) => {
  burst(v, { dur: 0.12, f: 3000, peak: 0.85 });
  for (let i = 0; i < 12; i++) ping(v, rnd(2200, 7000), { t: rnd(0, 0.35) * rnd(0.3, 1), dur: rnd(0.08, 0.3), peak: rnd(0.04, 0.1), pan: rnd(-0.6, 0.6) });
  crackle(v, { dur: 0.25, peak: 0.6, hp: 4000, rate: 2.5 });
  v.thump({ f: 160, f2: 80, dur: 0.1, peak: 0.4 });
});
def('burn_tick', 'tick', 0.05, (v) => {
  crackle(v, { dur: 0.09, peak: 0.6, hp: 1800, rate: rnd(0.8, 1.4) });
  v.noise({ buf: 'brown', dur: 0.08, peak: 0.25, filt: { type: 'lp', f: 900 } });
}, { cap: 3 });
def('reaction', 'impact', 0.45, (v) => {
  v.thump({ f: 120, f2: 30, dur: 0.7, peak: 0.9 });
  v.osc({ f: 293.7, f2: 587.3, ft: 0.1, dur: 1.2, a: 0.005, peak: 0.13, mod: { ratio: 1.5, index: 4, index2: 0.3 } });
  v.osc({ f: 440, f2: 880, ft: 0.1, dur: 1.0, a: 0.005, peak: 0.1, mod: { ratio: 2.01, index: 3, index2: 0.2 } });
  burst(v, { dur: 0.08, f: 1500, peak: 0.7 });
  pings(v, 6, SPARK, { t: 0.04, gap: 0.05, dur: 0.5, peak: 0.07 });
  v.noise({ buf: 'pink', dur: 0.9, a: 0.005, peak: 0.6, filt: { type: 'bp', f: 2500, f2: 300, q: 1.2 } });
}, { cap: 3 });

// ------------------------------------------------------------ pickups/UI ----
def('pickup_gold', 'pickup', 0.12, (v) => { coins(v, 5, 0.14, 0.1); v.noise({ buf: 'chain', dur: 0.15, rate: 1.3, peak: 0.25, filt: { type: 'hp', f: 2000 } }); }, { cap: 4 });
def('pickup_health', 'pickup', 0.2, (v) => {
  v.osc({ f: 523.25, dur: 0.6, a: 0.01, peak: 0.2 }); v.osc({ f: 659.25, t: 0.06, dur: 0.6, a: 0.01, peak: 0.16 });
  v.osc({ f: 261.6, dur: 0.6, a: 0.05, peak: 0.15, filt: { type: 'lp', f: 800 } });
  v.bell({ f: 1046.5, t: 0.1, dur: 0.6, peak: 0.05 });
}, { cap: 4 });
def('pickup_essence', 'pickup', 0.3, (v) => {
  [1318.5, 1568, 1975.5, 2349.3, 2637].forEach((f, i) => ping(v, f, { t: i * 0.035, dur: 0.35, peak: 0.08, pan: rnd(-0.4, 0.4) }));
  v.osc({ f: 880, f2: 1760, dur: 0.5, a: 0.02, peak: 0.08, mod: { ratio: 3, index: 1.5, index2: 0 } });
  v.noise({ buf: 'white', dur: 0.4, a: 0.05, peak: 0.12, filt: { type: 'hp', f: 7000 }, trem: { rate: 14, depth: 0.7 } });
}, { cap: 4 });
def('tome_open', 'sting', 0.35, (v) => {
  v.thump({ f: 110, f2: 60, dur: 0.15, peak: 0.6 });
  v.noise({ buf: 'pink', dur: 0.2, peak: 0.5, filt: { type: 'bp', f: 1800, q: 0.8 } });
  v.choir({ freqs: [146.8, 220, 293.7, 349.2], t: 0.05, dur: 1.6, a: 0.6, peak: 0.12, vowel: 'o' });
  v.noise({ buf: 'pink', t: 0.05, dur: 1.0, rev: true, peak: 0.25, filt: { type: 'bp', f: 800, f2: 4000, q: 2 } });
  pings(v, 4, SPARK, { t: 0.8, gap: 0.08, dur: 0.6, peak: 0.05 });
}, { cap: 2 });
def('tome_pick', 'sting', 0.45, (v) => {
  [293.7, 440, 587.3, 698.5, 880].forEach((f, i) => v.bell({ f, t: i * 0.03, dur: 2.0, peak: 0.07 }));
  v.osc({ f: 146.8, dur: 1.5, a: 0.02, peak: 0.2 });
  v.noise({ buf: 'white', dur: 1.0, a: 0.05, peak: 0.1, lin: true, filt: { type: 'hp', f: 6000 }, trem: { rate: 8, depth: 0.6 } });
}, { cap: 2, pv: 0.01 });
def('ui_click', 'ui', 0, (v) => { ping(v, 1150, { dur: 0.03, peak: 0.3 }); burst(v, { dur: 0.012, type: 'bp', f: 3000, q: 1, peak: 0.3 }); }, { pv: 0.03 });
def('ui_hover', 'ui_soft', 0, (v) => { ping(v, 2200, { dur: 0.025, peak: 0.2 }); }, { pv: 0.03 });
def('ui_back', 'ui', 0, (v) => { ping(v, 900, { dur: 0.04, peak: 0.25 }); ping(v, 620, { t: 0.045, dur: 0.06, peak: 0.25 }); }, { pv: 0.02 });
def('ui_error', 'ui', 0, (v) => {
  for (let i = 0; i < 2; i++) v.osc({ type: 'square', f: 110, t: i * 0.11, dur: 0.09, a: 0.004, hold: 0.05, peak: 0.2, filt: { type: 'lp', f: 700 } });
}, { pv: 0.01 });
def('buy', 'pickup', 0.2, (v) => { coins(v, 7, 0.2, 0.09); v.bell({ f: 1318.5, t: 0.12, dur: 0.6, peak: 0.07 }); v.bell({ f: 1975.5, t: 0.18, dur: 0.6, peak: 0.05 }); }, { pv: 0.02 });
const creak = (v, o = {}) => v.osc({ type: 'sawtooth', t: o.t, f: o.f ?? 28, f2: o.f2 ?? 55, ft: (o.dur ?? 0.7) * 0.5, f3: o.f3 ?? 22, dur: o.dur ?? 0.7, a: 0.08, peak: o.peak ?? 0.5, lin: true,
  filt: [{ type: 'bp', f: o.res ?? 750, q: 10 }, { type: 'peak', f: (o.res ?? 750) * 2.1, q: 8, gain: 8 }] });
def('chest_open', 'sting', 0.25, (v) => {
  burst(v, { dur: 0.03, type: 'bp', f: 2000, q: 3, peak: 0.6 });
  creak(v, { dur: 0.6, peak: 0.6 });
  v.thump({ t: 0.55, f: 110, f2: 60, dur: 0.15, peak: 0.6 });
  coins(v, 10, 0.35, 0.08, 0.55);
  pings(v, 4, SPARK, { t: 0.6, gap: 0.06, dur: 0.5, peak: 0.05 });
}, { cap: 2 });
def('shrine', 'sting', 0.5, (v) => {
  v.choir({ freqs: [196, 293.7, 392, 493.9], dur: 2.4, a: 0.9, peak: 0.13, vowel: 'a' });
  v.bell({ f: 784, t: 0.8, dur: 2.0, peak: 0.08 }); v.bell({ f: 1174.7, t: 0.9, dur: 2.0, peak: 0.05 });
  v.noise({ buf: 'white', dur: 1.8, a: 0.8, peak: 0.1, lin: true, filt: { type: 'hp', f: 6000 }, trem: { rate: 6, depth: 0.5 } });
}, { cap: 2, pv: 0.01 });
def('door_close', 'impact', 0.4, (v) => {
  v.noise({ buf: 'chain', dur: 0.4, a: 0.02, peak: 0.6, rate: 0.9, filt: { type: 'hp', f: 900 } });
  const t = 0.3;
  v.thump({ t, f: 70, f2: 28, dur: 0.8, peak: 1 });
  rumble(v, { t, dur: 0.9, a: 0.002, f: 1800, f2: 150, peak: 0.9, drive: 2 });
  metal(v, { t, f: 180, dur: 1.4, peak: 0.12, partials: [[1, 1, 1], [2.33, 0.7, 0.7], [3.83, 0.5, 0.5], [5.2, 0.3, 0.35]] });
  v.noise({ buf: 'chain', t: t + 0.05, dur: 0.6, a: 0.005, peak: 0.45, rate: 0.8, filt: { type: 'hp', f: 1200 } });
}, { cap: 2, pv: 0.04 });
def('door_open', 'sting', 0.35, (v) => {
  v.noise({ buf: 'chain', dur: 1.5, a: 0.4, hold: 0.7, peak: 0.55, rate: 0.6, rate2: 1.2, filt: { type: 'hp', f: 700, f2: 2000 } });
  v.noise({ buf: 'brown', dur: 1.5, a: 0.3, hold: 0.8, peak: 0.6, filt: { type: 'bp', f: 200, f2: 450, q: 2 }, trem: { rate: 9, depth: 0.5 } });
  v.thump({ t: 1.35, f: 90, f2: 45, dur: 0.3, peak: 0.6 });
}, { cap: 2, pv: 0.04 });
def('room_clear', 'sting', 0.45, (v) => {
  const ch = [293.7, 370, 440, 587.3];
  ch.forEach((f, i) => v.osc({ type: 'sawtooth', f, t: i * 0.05, dur: 1.4, a: 0.02, hold: 0.3, peak: 0.07, filt: { type: 'lp', f: 600, f2: 2600, ft: 0.15, f3: 900 }, detune: rnd(-6, 6) }));
  ch.forEach((f, i) => v.bell({ f: f * 2, t: 0.25 + i * 0.07, dur: 1.2, peak: 0.05 }));
  v.thump({ f: 100, f2: 50, dur: 0.4, peak: 0.6 });
}, { cap: 1, pv: 0.0 });
const gong = (v, o) => {
  v.bell({ f: o.f, t: o.t, dur: o.dur ?? 4, peak: o.peak ?? 0.2, a: 0.004, partials: [[1, 1, 1], [1.52, 0.7, 0.8], [2.35, 0.55, 0.65], [2.81, 0.4, 0.55], [3.65, 0.3, 0.4], [4.43, 0.2, 0.3]] });
  v.osc({ t: o.t, f: o.f * 0.5, dur: (o.dur ?? 4) * 0.6, a: 0.01, peak: (o.peak ?? 0.2) * 0.8, mod: { ratio: 1.41, index: 2, index2: 0 } });
};
def('floor_enter', 'sting', 0.55, (v) => {
  gong(v, { f: 73.4, dur: 4.5, peak: 0.16 });
  v.thump({ f: 80, f2: 35, dur: 0.6, peak: 0.6 });
  whoosh(v, { dur: 1.2, f: 200, f2: 1500, f3: 300, q: 1.2, peak: 0.5 });
}, { cap: 1, pv: 0.0 });
def('boss_intro', 'boom', 0.6, (v) => {
  gong(v, { f: 55, dur: 6, peak: 0.2 });
  [36.7, 55, 73.4, 77.8, 110].forEach((f) => v.osc({ type: 'sawtooth', f, dur: 3, a: 0.02, hold: 0.6, peak: 0.12, detune: rnd(-12, 12), filt: { type: 'lp', f: 300, f2: 1800, ft: 0.1, f3: 300 }, drive: 2 }));
  v.thump({ f: 70, f2: 24, dur: 1.4, peak: 1 });
  rumble(v, { dur: 3.5, a: 0.01, f: 200, peak: 0.9 });
  v.choir({ freqs: [73.4, 110, 146.8, 155.6], dur: 4, a: 0.2, peak: 0.12, vowel: 'o' });
}, { cap: 1, pv: 0.0 });
def('victory_sting', 'sting', 0.5, (v) => {
  const seq = [[293.7, 0], [370, 0.14], [440, 0.28], [587.3, 0.42]];
  seq.forEach(([f, t]) => v.osc({ type: 'sawtooth', f, t, dur: t === 0.42 ? 1.8 : 0.3, a: 0.02, hold: 0.05, peak: 0.08, filt: { type: 'lp', f: 900, f2: 3000, ft: 0.1, f3: 1200 } }));
  [587.3, 740, 880, 1174.7].forEach((f, i) => v.bell({ f, t: 0.42 + i * 0.05, dur: 2, peak: 0.05 }));
  v.choir({ freqs: [146.8, 220, 293.7, 370], t: 0.4, dur: 2.2, a: 0.1, peak: 0.1, vowel: 'a' });
  v.thump({ t: 0.42, f: 90, f2: 40, dur: 0.6, peak: 0.7 });
}, { cap: 1, pv: 0.0 });
def('defeat_sting', 'sting', 0.55, (v) => {
  [[220, 0], [196, 0.35], [174.6, 0.7], [146.8, 1.05]].forEach(([f, t], i) =>
    v.osc({ type: 'sawtooth', f, t, dur: i === 3 ? 2.4 : 0.5, a: 0.06, hold: 0.1, peak: 0.08, filt: { type: 'lp', f: 700 }, vib: { rate: 5, depth: 0.004 } }));
  v.choir({ freqs: [73.4, 110, 146.8, 174.6], t: 1.0, dur: 2.6, a: 0.3, peak: 0.1, vowel: 'o' });
  gong(v, { t: 1.05, f: 55, dur: 4, peak: 0.13 });
}, { cap: 1, pv: 0.0 });
def('level_up', 'sting', 0.4, (v) => {
  [440, 554.4, 659.3, 880, 1108.7].forEach((f, i) => v.bell({ f, t: i * 0.07, dur: 1.2, peak: 0.07 }));
  v.osc({ f: 220, f2: 440, ft: 0.35, dur: 1.0, a: 0.05, peak: 0.12, mod: { ratio: 2, index: 1.5, index2: 0.2 } });
  v.noise({ buf: 'pink', dur: 0.4, rev: true, peak: 0.3, filt: { type: 'bp', f: 800, f2: 5000, q: 2 } });
}, { cap: 1, pv: 0.0 });

// ---------------------------------------------------------------- enemies ---
def('summon', 'enemy', 0.4, (v) => {
  v.noise({ buf: 'pink', dur: 0.9, a: 0.3, peak: 0.6, lin: true, filt: { type: 'bp', f: 300, f2: 1600, q: 4, lfo: { rate: 7, depth: 250 } } });
  v.osc({ f: 80, f2: 220, dur: 0.9, a: 0.2, peak: 0.2, mod: { ratio: 1.5, index: 3, index2: 6 }, filt: { type: 'lp', f: 900 } });
  v.thump({ t: 0.75, f: 110, f2: 40, dur: 0.35, peak: 0.6 });
});
def('telegraph', 'enemy', 0.25, (v) => {
  v.osc({ type: 'sawtooth', f: 200, f2: 800, dur: 0.8, a: 0.6, hold: 0.1, peak: 0.18, lin: true, filt: { type: 'bp', f: 1000, q: 2 }, trem: { rate: 14, depth: 0.6 } });
  v.osc({ type: 'square', f: 100, f2: 400, dur: 0.8, a: 0.6, hold: 0.1, peak: 0.08, lin: true, filt: { type: 'lp', f: 900 } });
  ping(v, 1800, { t: 0.72, dur: 0.15, peak: 0.12 });
}, { cap: 4 });
def('rat_squeak', 'enemy', 0.12, (v) => {
  const f = rnd(2600, 3400);
  v.osc({ type: 'triangle', f, f2: f * 1.25, ft: 0.05, f3: f * 0.9, dur: 0.1, a: 0.005, peak: 0.25, vib: { rate: 45, depth: 0.05 } });
  v.osc({ type: 'triangle', t: 0.12, f: f * 1.1, f2: f * 0.85, dur: 0.08, a: 0.005, peak: 0.2, vib: { rate: 45, depth: 0.05 } });
}, { cap: 3, pv: 0.1 });
def('rat_death', 'enemy', 0.15, (v) => {
  v.osc({ type: 'triangle', f: 3200, f2: 1400, dur: 0.25, a: 0.005, peak: 0.25, vib: { rate: 40, depth: 0.06 } });
  v.thump({ t: 0.05, f: 180, f2: 90, dur: 0.1, peak: 0.4 });
  squelch(v, 0.03, 0.25);
}, { cap: 4, pv: 0.1 });
def('skeleton_rattle', 'enemy', 0.15, (v) => {
  v.noise({ buf: 'bones', dur: 0.35, a: 0.02, peak: 0.8, rate: rnd(0.9, 1.3), filt: { type: 'bp', f: 1600, q: 0.8 } });
}, { cap: 4 });
def('skeleton_death', 'enemy', 0.25, (v) => {
  v.noise({ buf: 'bones', dur: 0.9, a: 0.005, peak: 0.9, rate: 1.4, rate2: 0.7, filt: { type: 'bp', f: 1500, q: 0.7 } });
  v.thump({ f: 160, f2: 80, dur: 0.12, peak: 0.5 }); v.thump({ t: 0.25, f: 140, f2: 70, dur: 0.1, peak: 0.3 });
  pebbles(v, 5, 0.7, 0.1, 0.3);
});
def('slime_squish', 'enemy', 0.12, (v) => {
  v.noise({ buf: 'brown', dur: 0.25, a: 0.01, peak: 0.8, filt: [{ type: 'bp', f: 350, f2: 900, f3: 300, q: 4 }, { type: 'lp', f: 1500 }] });
  bubbles(v, 3, 0.15, 250, 0.2);
}, { cap: 4 });
def('slime_death', 'enemy', 0.2, (v) => {
  v.noise({ buf: 'pink', dur: 0.4, peak: 0.85, filt: { type: 'bp', f: 1400, f2: 250, q: 3 } });
  bubbles(v, 8, 0.5, 220, 0.25);
  v.osc({ type: 'sine', f: 300, f2: 90, dur: 0.4, peak: 0.3, vib: { rate: 18, depth: 0.15 } });
});
const vocal = (v, o) => {
  v.osc({ type: 'sawtooth', t: o.t, f: o.f, f2: o.f2, ft: o.ft, f3: o.f3, dur: o.dur, a: o.a ?? 0.05, peak: o.peak ?? 0.35,
    filt: [{ type: 'bp', f: o.form ?? 600, q: o.q ?? 3, fixed: true }, { type: 'lp', f: o.lp ?? 1800, fixed: true }], drive: o.drive ?? 4, vib: { rate: o.vr ?? 27, depth: o.vd ?? 0.1 } });
  if (o.rasp) v.noise({ buf: 'pink', t: o.t, dur: o.dur, a: o.a ?? 0.05, peak: o.rasp, filt: { type: 'bp', f: (o.form ?? 600) * 1.5, q: 2, fixed: true }, trem: { rate: o.vr ?? 27, depth: 0.8 } });
};
def('ghoul_growl', 'enemy', 0.2, (v) => vocal(v, { f: rnd(80, 95), f2: 70, dur: 0.7, form: 550, peak: 0.4, rasp: 0.3 }), { cap: 3 });
def('ghost_wail', 'enemy', 0.65, (v) => {
  v.osc({ type: 'sine', f: 480, f2: 720, ft: 0.5, f3: 380, dur: 1.4, a: 0.25, peak: 0.25, vib: { rate: 6, depth: 0.025 } });
  v.osc({ type: 'triangle', f: 483, f2: 724, ft: 0.5, f3: 382, dur: 1.4, a: 0.3, peak: 0.1, filt: { type: 'lp', f: 1500 } });
  v.noise({ buf: 'pink', dur: 1.4, a: 0.4, peak: 0.25, lin: true, filt: { type: 'bp', f: 900, f2: 1400, f3: 700, q: 6 } });
}, { cap: 3 });
def('armor_clank', 'enemy', 0.15, (v) => {
  metal(v, { f: rnd(700, 1000), dur: 0.3, peak: 0.12 });
  v.noise({ buf: 'chain', dur: 0.15, peak: 0.4, filt: { type: 'hp', f: 1500 } });
  v.thump({ f: 120, f2: 70, dur: 0.08, peak: 0.35 });
}, { cap: 4 });
def('beast_growl', 'enemy', 0.25, (v) => {
  vocal(v, { f: rnd(52, 62), f2: 48, ft: 0.4, f3: 58, dur: 1.1, form: 380, lp: 1200, peak: 0.45, rasp: 0.35, vr: 18, vd: 0.12, drive: 6 });
  rumble(v, { dur: 1.0, a: 0.1, f: 150, peak: 0.6 });
}, { cap: 3 });
def('imp_screech', 'enemy', 0.25, (v) => vocal(v, { f: 900, f2: 1400, ft: 0.12, f3: 1000, dur: 0.38, a: 0.01, form: 2200, q: 2, lp: 5000, peak: 0.3, vr: 35, vd: 0.05, rasp: 0.15 }), { cap: 3 });
def('book_flap', 'enemy', 0.15, (v) => {
  for (let i = 0; i < 4; i++) v.noise({ buf: 'pink', t: i * 0.085 + rnd(0, 0.01), dur: 0.06, a: 0.012, peak: 0.6, filt: { type: 'bp', f: rnd(1200, 1800), q: 1.2 } });
}, { cap: 3 });
def('stone_grind', 'enemy', 0.2, (v) => {
  v.noise({ buf: 'crackle', dur: 0.8, a: 0.1, hold: 0.4, peak: 0.6, rate: 0.35, filt: { type: 'bp', f: 600, q: 1.2 } });
  v.noise({ buf: 'brown', dur: 0.8, a: 0.1, hold: 0.4, peak: 0.7, filt: { type: 'bp', f: 260, q: 2 }, trem: { rate: 13, depth: 0.5 } });
}, { cap: 3 });
def('boss_roar', 'boom', 0.45, (v) => {
  vocal(v, { f: 62, f2: 48, ft: 0.8, f3: 40, dur: 1.9, a: 0.12, form: 450, lp: 1600, peak: 0.45, rasp: 0.45, vr: 21, vd: 0.12, drive: 8 });
  vocal(v, { f: 93, f2: 72, ft: 0.8, f3: 60, dur: 1.8, a: 0.15, form: 800, lp: 2200, peak: 0.3, vr: 17, vd: 0.1, drive: 6 });
  rumble(v, { dur: 1.9, a: 0.15, f: 140, peak: 0.9 });
  v.osc({ f: 40, dur: 1.5, a: 0.1, peak: 0.4 });
}, { cap: 2 });
def('boss_slam', 'boom', 0.45, (v) => {
  v.thump({ f: 85, f2: 26, dur: 0.9, peak: 1 });
  rumble(v, { dur: 1.4, a: 0.002, f: 1500, f2: 100, peak: 1, drive: 3 });
  burst(v, { dur: 0.06, type: 'bp', f: 1500, q: 0.8, peak: 0.7 });
  v.noise({ buf: 'crackle', dur: 0.8, peak: 0.5, rate: 0.5, filt: { type: 'bp', f: 1400, q: 1 } });
  pebbles(v, 8, 1.0, 0.15, 0.3);
}, { cap: 3 });
def('enemy_cast', 'enemy', 0.25, (v) => {
  v.osc({ f: 900, f2: 250, dur: 0.35, a: 0.01, peak: 0.2, mod: { ratio: 0.5, index: 4, index2: 1 } });
  whoosh(v, { dur: 0.3, f: 300, f2: 1500, f3: 400, q: 2, peak: 0.45 });
  v.osc({ type: 'sawtooth', f: 110, f2: 80, dur: 0.3, a: 0.02, peak: 0.12, filt: { type: 'lp', f: 600, q: 6 } });
});
def('enemy_projectile', 'enemy', 0.18, (v) => {
  whoosh(v, { dur: 0.22, f: 600, f2: 2000, f3: 700, a: 0.03, q: 1.5, peak: 0.6 });
  v.osc({ f: 700, f2: 350, dur: 0.18, peak: 0.12, mod: { ratio: 1.5, index: 2 } });
});
def('swing', 'enemy', 0.1, (v) => whoosh(v, { dur: 0.26, f: 380, f2: 1500, ft: 0.13, f3: 280, a: 0.09, q: 1.8, peak: 0.8 }));
def('enemy_hit', 'hit', 0.12, (v) => {
  v.thump({ f: 125, f2: 58, dur: 0.12, peak: 0.85 });
  v.noise({ buf: 'brown', dur: 0.09, peak: 0.7, filt: { type: 'lp', f: 650 } });
  v.noise({ buf: 'pink', dur: 0.08, peak: 0.3, filt: { type: 'bp', f: 1600, f2: 500, q: 2 } });
});
def('enemy_hit_armor', 'hit', 0.18, (v) => {
  metal(v, { f: rnd(800, 1150), dur: 0.45, peak: 0.13 });
  burst(v, { dur: 0.025, type: 'bp', f: 3500, q: 1.5, peak: 0.6 });
  v.thump({ f: 140, f2: 80, dur: 0.08, peak: 0.45 });
});
def('enemy_hit_bone', 'hit', 0.12, (v) => {
  burst(v, { dur: 0.03, type: 'bp', f: 2100, q: 4, peak: 0.9 });
  v.noise({ buf: 'bones', dur: 0.1, rate: 1.5, peak: 0.6, filt: { type: 'bp', f: 1500, q: 1 } });
  v.thump({ f: 150, f2: 80, dur: 0.07, peak: 0.45 });
});
def('enemy_death', 'enemy', 0.25, (v) => {
  v.thump({ f: 110, f2: 40, dur: 0.3, peak: 0.75 });
  vocal(v, { f: 130, f2: 70, dur: 0.45, a: 0.01, form: 500, peak: 0.25, vr: 20, vd: 0.06, drive: 3 });
  v.noise({ buf: 'pink', dur: 0.35, peak: 0.4, filt: { type: 'lp', f: 1200, f2: 200 } });
});

// --------------------------------------------------------- encounters -----
// mimic: a wet, wooden growl - a creaking lid over a throat
def('mimic_growl', 'enemy', 0.25, (v) => {
  creak(v, { dur: 0.5, f: 22, f2: 40, f3: 18, res: 520, peak: 0.35 });
  vocal(v, { f: rnd(70, 85), f2: 55, ft: 0.35, f3: 66, dur: 0.8, form: 420, lp: 1300, peak: 0.35, rasp: 0.3, vr: 22, vd: 0.14, drive: 5 });
  bubbles(v, 3, 0.4, 260, 0.12, 0.1);
}, { cap: 2 });
// the reveal: lid banging open, a roar and a spray of coins
def('mimic_spring', 'sting', 0.35, (v) => {
  burst(v, { dur: 0.04, type: 'bp', f: 1600, q: 2, peak: 0.8 });
  v.thump({ f: 95, f2: 45, dur: 0.22, peak: 0.9 });
  creak(v, { dur: 0.3, f: 40, f2: 70, f3: 30, res: 600, peak: 0.45 });
  vocal(v, { t: 0.05, f: 78, f2: 58, ft: 0.6, f3: 48, dur: 1.2, a: 0.04, form: 480, lp: 1600, peak: 0.42, rasp: 0.4, vr: 19, vd: 0.12, drive: 7 });
  coins(v, 14, 0.5, 0.09, 0.05);
}, { cap: 1 });
def('mimic_death', 'enemy', 0.3, (v) => {
  creak(v, { dur: 0.9, f: 30, f2: 18, f3: 12, res: 480, peak: 0.45 });
  v.thump({ t: 0.35, f: 90, f2: 40, dur: 0.25, peak: 0.8 });
  coins(v, 18, 0.7, 0.1, 0.4);
  vocal(v, { f: 90, f2: 40, dur: 0.6, a: 0.02, form: 400, peak: 0.25, vr: 14, vd: 0.1, drive: 3 });
}, { cap: 2 });
// a secret wall gives way: stone cracking, then a rumbling slide of rubble
def('wall_crumble', 'boom', 0.45, (v) => {
  burst(v, { dur: 0.05, type: 'bp', f: 1800, q: 1.2, peak: 0.9 });
  v.noise({ buf: 'crackle', dur: 0.9, a: 0.01, peak: 0.7, rate: 0.5, filt: { type: 'bp', f: 900, q: 0.8 } });
  rumble(v, { dur: 1.6, a: 0.04, f: 220, peak: 0.95 });
  v.thump({ t: 0.2, f: 70, f2: 35, dur: 0.4, peak: 0.8 });
  for (let i = 0; i < 6; i++) v.noise({ buf: 'pink', t: 0.3 + i * 0.14 + rnd(0, 0.05), dur: 0.08, a: 0.005, peak: 0.35, filt: { type: 'bp', f: rnd(500, 1300), q: 2 } });
}, { cap: 1 });
// altars and bargains
def('altar_pact', 'sting', 0.6, (v) => {
  v.choir({ freqs: [110, 130.8, 164.8, 207.7], dur: 2.2, a: 0.5, peak: 0.12, vowel: 'o' });
  rumble(v, { dur: 1.8, a: 0.3, f: 160, peak: 0.5 });
  v.osc({ type: 'sine', f: 55, dur: 1.8, a: 0.3, peak: 0.3 });
}, { cap: 1 });
def('dice_roll', 'sting', 0.2, (v) => {
  for (let i = 0; i < 7; i++) v.noise({ buf: 'pink', t: i * (0.05 + i * 0.012), dur: 0.03, a: 0.002, peak: 0.5 * (1 - i * 0.1), filt: { type: 'bp', f: rnd(1800, 3200), q: 3 } });
  coins(v, 5, 0.3, 0.06, 0.45);
}, { cap: 2 });
