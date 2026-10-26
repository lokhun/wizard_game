// Procedural ambience beds for GameAudio.setAmbience(). Each bed:
//   bed(v)    builds the continuous layer on a sustain-mode Voice
//   gain      bed output level
//   details   random one-shots: { every:[min,max] seconds, fn(v), vol, verb, pan (stereo spread) }
import { rnd, pick } from './core.js';

const drip = (v) => {
  const f = rnd(900, 1900);
  v.osc({ type: 'sine', f, f2: f * rnd(1.8, 2.6), ft: 0.03, dur: 0.1, a: 0.001, peak: 0.25 });
  if (Math.random() < 0.4) v.osc({ type: 'sine', t: rnd(0.15, 0.35), f: f * 0.8, f2: f * 1.9, ft: 0.03, dur: 0.08, a: 0.001, peak: 0.12 });
};
const chainClank = (v) => {
  v.noise({ buf: 'chain', dur: rnd(0.4, 0.9), a: 0.02, peak: 0.5, rate: rnd(0.6, 0.9), filt: { type: 'bp', f: 1800, q: 0.8 } });
  v.bell({ f: rnd(500, 750), dur: 0.8, peak: 0.05, partials: [[1, 1, 1], [2.33, 0.6, 0.6], [3.9, 0.3, 0.4]] });
};
// somewhere off in the cells an iron door swings shut: a latch, the slam, the bars ringing on in the stone
const cellDoor = (v) => {
  v.noise({ buf: 'chain', dur: 0.25, a: 0.01, peak: 0.25, rate: 1.3, filt: { type: 'bp', f: 2400, q: 1.2 } });
  v.thump({ t: 0.32, f: 95, f2: 50, dur: 0.4, peak: 0.55 });
  v.bell({ t: 0.32, f: rnd(170, 230), dur: 2.4, peak: 0.12, partials: [[1, 1, 1], [2.7, 0.5, 0.7], [4.3, 0.3, 0.5], [6.1, 0.15, 0.3]] });
};
// rats in the walls
const squeak = (v) => {
  const n = 1 + ((Math.random() * 3) | 0), f = rnd(2600, 3600);
  for (let i = 0; i < n; i++) v.osc({ type: 'triangle', t: i * rnd(0.09, 0.16), f, f2: f * rnd(1.1, 1.35), ft: 0.05, dur: 0.07, a: 0.005, peak: 0.12, vib: { rate: 35, depth: 0.05 } });
};
const moan = (v) => {
  const f = rnd(100, 150);
  v.osc({ type: 'sawtooth', f, f2: f * rnd(1.1, 1.3), ft: 1.0, f3: f * 0.75, dur: rnd(2.2, 3.2), a: 0.8, peak: 0.2, lin: true,
    filt: [{ type: 'bp', f: 380, q: 5, fixed: true }, { type: 'lp', f: 1000, fixed: true }], vib: { rate: 5, depth: 0.02 } });
};
const thudFar = (v) => {
  v.thump({ f: 70, f2: 35, dur: 0.6, peak: 0.6 });
  v.noise({ buf: 'brown', dur: 0.8, a: 0.01, peak: 0.5, filt: { type: 'lp', f: 300 } });
};
const whispers = (v) => {
  const dur = rnd(1.2, 2.2);
  v.noise({ buf: 'pink', dur, a: 0.3, peak: 0.3, lin: true, filt: [{ type: 'bp', f: rnd(1400, 2600), q: 4, lfo: { rate: rnd(2, 4), depth: 500 } }, { type: 'hp', f: 900 }], trem: { rate: rnd(7, 11), depth: 0.9 } });
  v.noise({ buf: 'white', t: 0.2, dur: dur * 0.7, a: 0.2, peak: 0.12, lin: true, filt: { type: 'bp', f: rnd(3000, 4500), q: 3 }, trem: { rate: rnd(5, 9), depth: 0.9 } });
};
const creak = (v) => {
  const d = rnd(0.6, 1.3), res = rnd(500, 900);
  v.osc({ type: 'sawtooth', f: rnd(18, 30), f2: rnd(40, 70), ft: d * 0.5, f3: rnd(15, 25), dur: d, a: 0.1, peak: 0.5, lin: true,
    filt: [{ type: 'bp', f: res, q: 12 }, { type: 'peak', f: res * 2.2, q: 8, gain: 8 }] });
};
const clock = (v) => {
  for (let i = 0; i < 8; i++) {
    v.noise({ buf: 'white', t: i * 0.5, dur: 0.03, a: 0.001, peak: 0.3, filt: { type: 'bp', f: i % 2 ? 2400 : 3200, q: 10 } });
    v.osc({ t: i * 0.5, f: i % 2 ? 900 : 1150, dur: 0.05, peak: 0.08 });
  }
};
const bellFar = (v) => v.bell({ f: pick([146.8, 174.6, 220]), dur: 4, peak: 0.12, partials: [[1, 1, 1], [2.0, 0.5, 0.7], [2.76, 0.4, 0.5], [5.4, 0.15, 0.3]] });
const rumbleFar = (v) => v.noise({ buf: 'brown', dur: rnd(2.5, 4), a: 1.0, peak: 0.7, lin: true, filt: { type: 'lp', f: 110 } });
const gust = (v) => {
  const d = rnd(2.5, 4.5);
  v.noise({ buf: 'pink', dur: d, a: d * 0.45, peak: 0.45, lin: true, filt: { type: 'bp', f: 300, f2: rnd(800, 1300), ft: d * 0.5, f3: 350, q: 1.2 } });
  v.noise({ buf: 'white', dur: d, a: d * 0.5, peak: 0.04, lin: true, filt: { type: 'bp', f: rnd(1800, 2600), q: 15, lfo: { rate: 0.4, depth: 300 } } });
};
// a fat drop smacking a stone, or a run of them off the battlements
// a page turning somewhere in the stacks (a dry flick, then the leaf settling)
const pageTurn = (v) => {
  v.noise({ buf: 'white', dur: rnd(0.12, 0.2), a: 0.01, peak: 0.3, filt: [{ type: 'bp', f: rnd(2800, 4200), q: 1.4 }, { type: 'hp', f: 1500 }] });
  v.noise({ buf: 'pink', t: rnd(0.12, 0.2), dur: rnd(0.25, 0.4), a: 0.04, peak: 0.12, lin: true, filt: { type: 'bp', f: rnd(1800, 2600), q: 1.2 } });
};
const patter = (v) => {
  const n = 1 + ((Math.random() * 3) | 0);
  for (let i = 0; i < n; i++) v.noise({ buf: 'white', t: i * rnd(0.03, 0.09), dur: 0.035, a: 0.001, peak: rnd(0.15, 0.35), filt: { type: 'bp', f: rnd(2200, 5200), q: 2.2 } });
};
const crow = (v) => {
  const n = 2 + ((Math.random() * 2) | 0), f = rnd(480, 560);
  for (let i = 0; i < n; i++) v.osc({ type: 'sawtooth', t: i * 0.34, f, f2: f * 0.8, dur: 0.24, a: 0.02, peak: 0.2, filt: [{ type: 'bp', f: 1150, q: 2, fixed: true }, { type: 'lp', f: 2500, fixed: true }], drive: 3, vib: { rate: 40, depth: 0.04 } });
};
const choirSwell = (v) => {
  const ch = pick([[73.4, 110, 146.8, 174.6], [69.3, 103.8, 138.6, 164.8], [65.4, 98, 130.8, 155.6], [58.3, 87.3, 116.5, 146.8]]);
  v.choir({ freqs: ch, dur: rnd(8, 10), a: 3, rel: 4, peak: 0.12, vowel: pick(['o', 'u', 'a']) });
};

export const AMBIENCE = {
  sewers: {
    gain: 1.4,
    bed(v) {
      v.noise({ buf: 'pink', a: 1, peak: 0.45, filt: { type: 'bp', f: 700, q: 0.6, lfo: { rate: 0.13, depth: 200 } } });
      v.noise({ buf: 'white', a: 1, peak: 0.08, filt: { type: 'bp', f: 2400, q: 1.2, lfo: { rate: 0.31, depth: 600 } }, trem: { rate: 7, depth: 0.4 } });
      v.noise({ buf: 'brown', a: 1, peak: 0.5, filt: { type: 'lp', f: 90 }, trem: { rate: 0.07, depth: 0.5 } });
    },
    details: [
      { every: [0.5, 2.0], fn: drip, vol: 0.5, verb: 0.5, pan: 0.9 },
      { every: [2, 5], fn: drip, vol: 0.25, verb: 0.8, pan: 0.9 },
      { every: [9, 18], fn: rumbleFar, vol: 0.8, verb: 0.3, pan: 0.3 },
      { every: [14, 28], fn: (v) => { const f = rnd(2600, 3300); v.osc({ type: 'triangle', f, f2: f * 1.2, dur: 0.1, peak: 0.2, vib: { rate: 45, depth: 0.05 } }); }, vol: 0.12, verb: 0.7, pan: 0.9 },
    ],
  },
  dungeon: {
    gain: 1.4,
    bed(v) {
      v.osc({ f: 55, a: 2, peak: 0.12 }); v.osc({ f: 55.35, a: 2, peak: 0.1 }); v.osc({ f: 82.6, a: 2, peak: 0.04, trem: { rate: 0.09, depth: 0.8 } });
      v.noise({ buf: 'brown', a: 2, peak: 0.4, filt: { type: 'lp', f: 150 } });
      v.noise({ buf: 'pink', a: 2, peak: 0.12, filt: { type: 'bp', f: 420, q: 2, lfo: { rate: 0.05, depth: 150 } }, trem: { rate: 0.11, depth: 0.7 } });
    },
    details: [
      { every: [4, 10], fn: chainClank, vol: 0.35, verb: 0.7, pan: 0.9 },
      { every: [10, 22], fn: moan, vol: 0.35, verb: 0.9, pan: 0.9 },
      { every: [3, 8], fn: drip, vol: 0.25, verb: 0.8, pan: 0.9 },
      { every: [15, 30], fn: thudFar, vol: 0.4, verb: 0.8, pan: 0.6 },
      { every: [18, 40], fn: cellDoor, vol: 0.4, verb: 0.95, pan: 0.9 },
      { every: [7, 16], fn: squeak, vol: 0.18, verb: 0.4, pan: 1 },
    ],
  },
  // the bailey under its storm: steady rain (a hiss over a softer roar), the wind gusting through it, drops
  // smacking the stones close by and water running off the eaves (no crickets in this weather)
  courtyard: {
    gain: 1.8,
    bed(v) {
      v.noise({ buf: 'pink', a: 3, peak: 0.32, filt: { type: 'bp', f: 950, q: 0.6, lfo: { rate: 0.05, depth: 200 } }, trem: { rate: 0.09, depth: 0.3 } });
      v.noise({ buf: 'white', a: 3, peak: 0.08, filt: { type: 'bp', f: 3400, q: 0.6, lfo: { rate: 0.07, depth: 900 } }, trem: { rate: 0.13, depth: 0.25 } });
      v.noise({ buf: 'pink', a: 3, peak: 0.22, filt: { type: 'bp', f: 420, q: 0.9, lfo: { rate: 0.06, depth: 220 } }, trem: { rate: 0.08, depth: 0.7 } });
      v.noise({ buf: 'brown', a: 2, peak: 0.25, filt: { type: 'lp', f: 120 } });
    },
    details: [
      { every: [0.08, 0.35], fn: patter, vol: 0.3, verb: 0.15, pan: 1 },
      { every: [4, 9], fn: gust, vol: 0.9, verb: 0.15, pan: 0.6 },
      { every: [1.5, 4], fn: drip, vol: 0.25, verb: 0.35, pan: 1 },
      { every: [20, 40], fn: crow, vol: 0.18, verb: 0.7, pan: 1 },
    ],
  },
  keep: {
    gain: 1.8,
    bed(v) {
      v.noise({ buf: 'pink', a: 2, peak: 0.9, filt: { type: 'bp', f: 120, q: 8 } });
      v.noise({ buf: 'pink', a: 2, peak: 0.5, filt: { type: 'bp', f: 241, q: 10 }, trem: { rate: 0.07, depth: 0.6 } });
      v.osc({ f: 60, a: 2, peak: 0.06 });
      v.noise({ buf: 'white', a: 2, peak: 0.03, filt: { type: 'bp', f: 1500, q: 0.7 }, trem: { rate: 0.12, depth: 0.8 } });
    },
    details: [
      { every: [5, 12], fn: creak, vol: 0.25, verb: 0.6, pan: 0.9 },
      { every: [16, 30], fn: clock, vol: 0.2, verb: 0.6, pan: 0.7 },
      { every: [9, 18], fn: whispers, vol: 0.25, verb: 0.8, pan: 1 },
      { every: [14, 26], fn: thudFar, vol: 0.3, verb: 0.9, pan: 0.6 },
      { every: [6, 14], fn: pageTurn, vol: 0.16, verb: 0.6, pan: 1 },
    ],
  },
  throne: {
    gain: 1.3,
    bed(v) {
      v.osc({ f: 36.7, a: 3, peak: 0.15 });
      v.osc({ type: 'sawtooth', f: 73.4, a: 3, peak: 0.08, filt: { type: 'lp', f: 160, lfo: { rate: 0.06, depth: 60 } } });
      v.noise({ buf: 'heart', a: 1, peak: 0.6, rate: 0.72, offset: 0, filt: { type: 'lp', f: 160, fixed: true } });
      v.noise({ buf: 'brown', a: 2, peak: 0.25, filt: { type: 'lp', f: 200 } });
    },
    details: [
      { every: [6, 9], fn: choirSwell, vol: 0.5, verb: 0.7, pan: 0.4 },
      { every: [20, 40], fn: bellFar, vol: 0.35, verb: 0.9, pan: 0.5 },
      { every: [10, 20], fn: whispers, vol: 0.2, verb: 0.8, pan: 1 },
    ],
  },
  menu: {
    gain: 1.4,
    bed(v) {
      v.osc({ type: 'sawtooth', f: 36.7, a: 3, peak: 0.15, detune: -6, filt: { type: 'lp', f: 300, q: 4, lfo: { rate: 0.05, depth: 120 } } });
      v.osc({ type: 'sawtooth', f: 55, a: 3, peak: 0.1, detune: 7, filt: { type: 'lp', f: 260, q: 3, lfo: { rate: 0.037, depth: 100 } } });
      v.osc({ f: 36.7, a: 3, peak: 0.15 });
      v.noise({ buf: 'pink', a: 3, peak: 0.08, filt: { type: 'bp', f: 800, q: 1, lfo: { rate: 0.03, depth: 400 } } });
    },
    details: [
      { every: [10, 20], fn: bellFar, vol: 0.25, verb: 0.9, pan: 0.6 },
      { every: [9, 15], fn: (v) => v.choir({ freqs: pick([[146.8, 220], [116.5, 174.6], [130.8, 196]]), dur: 7, a: 3, rel: 3, peak: 0.08, vowel: 'u' }), vol: 0.5, verb: 0.8, pan: 0.5 },
    ],
  },
};
