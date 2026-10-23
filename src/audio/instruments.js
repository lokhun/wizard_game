// Instruments for the music (music.js, themes.js): each schedules one note or
// hit on a MusicPlayer's voice at time t.
import { rnd, mtof } from './core.js';

// ------------------------------------------------------------ instruments ---
export const I = {
  pad(m, t, notes, dur, peak, vowel = 'a') {
    const v = m.voice(t, 0.55); v.choir({ freqs: notes.map(mtof), dur, a: Math.min(1.5, dur * 0.3), rel: dur * 0.4, peak, vowel }); v.finish();
  },
  strings(m, t, note, dur, peak, a = 0.08) {
    const v = m.voice(t, 0.35), f = mtof(note);
    for (const d of [-7, 7]) v.osc({ type: 'sawtooth', f, detune: d, dur, a, hold: dur * 0.5, peak, filt: { type: 'lp', f: Math.min(2400, f * 6) }, vib: { rate: 5.3, depth: 0.003 } });
    v.finish();
  },
  stac(m, t, note, peak) {
    const v = m.voice(t, 0.25), f = mtof(note);
    v.osc({ type: 'sawtooth', f, dur: 0.22, a: 0.006, peak, filt: { type: 'lp', f: f * 8, f2: f * 2, ft: 0.15, q: 3 } });
    v.osc({ type: 'sawtooth', f: f * 1.003, dur: 0.2, a: 0.006, peak: peak * 0.6, filt: { type: 'lp', f: f * 5 } });
    v.finish();
  },
  brass(m, t, notes, dur, peak, bright = 2400) {
    const v = m.voice(t, 0.4);
    for (const n of notes) {
      const f = mtof(n);
      for (const d of [-8, 8]) v.osc({ type: 'sawtooth', f, detune: d, dur, a: 0.02, hold: dur * 0.3, peak, filt: { type: 'lp', f: 300, f2: bright, ft: 0.07, f3: 700, q: 2 }, drive: 2 });
    }
    v.finish();
  },
  taiko(m, t, peak = 0.6, f = 68) {
    const v = m.voice(t, 0.3);
    v.osc({ f: f * 1.8, f2: f, ft: 0.035, f3: f * 0.8, dur: 0.7, a: 0.001, peak });
    v.noise({ buf: 'brown', dur: 0.14, a: 0.001, peak: peak * 0.8, filt: { type: 'lp', f: 700 } });
    v.noise({ buf: 'pink', dur: 0.04, a: 0.001, peak: peak * 0.35, filt: { type: 'bp', f: 1800, q: 1 } });
    v.finish();
  },
  frame(m, t, peak = 0.25) {
    const v = m.voice(t, 0.25);
    v.osc({ f: 230, f2: 150, dur: 0.15, a: 0.001, peak });
    v.noise({ buf: 'pink', dur: 0.09, a: 0.001, peak: peak * 0.8, filt: { type: 'bp', f: rnd(1000, 1400), q: 1.5 } });
    v.finish();
  },
  rim(m, t, peak = 0.2) {
    const v = m.voice(t, 0.3); v.noise({ buf: 'white', dur: 0.05, a: 0.001, peak, filt: { type: 'bp', f: 2400, q: 3 } }); v.finish();
  },
  shaker(m, t, peak = 0.06) {
    const v = m.voice(t, 0.1); v.noise({ buf: 'white', dur: 0.05, a: 0.012, peak, filt: { type: 'hp', f: 6500 } }); v.finish();
  },
  tom(m, t, f, peak = 0.4) {
    const v = m.voice(t, 0.3);
    v.osc({ f: f * 1.5, f2: f, ft: 0.05, dur: 0.4, a: 0.001, peak });
    v.noise({ buf: 'brown', dur: 0.08, peak: peak * 0.5, filt: { type: 'lp', f: 900 } });
    v.finish();
  },
  swell(m, t, dur, peak = 0.12) {
    const v = m.voice(t, 0.4); v.noise({ buf: 'white', dur, rev: true, peak, filt: { type: 'hp', f: 4500 } }); v.finish();
  },
  gong(m, t, f, peak = 0.12, dur = 5) {
    const v = m.voice(t, 0.6);
    v.bell({ f, dur, peak, partials: [[1, 1, 1], [1.52, 0.7, 0.8], [2.35, 0.55, 0.65], [2.81, 0.4, 0.55], [3.65, 0.3, 0.4]] });
    v.finish();
  },
  pluck(m, t, note, peak = 0.12) {
    const v = m.voice(t, 0.6), f = mtof(note);
    v.osc({ type: 'triangle', f, dur: 1.4, a: 0.002, peak });
    v.osc({ type: 'sawtooth', f, dur: 0.25, a: 0.002, peak: peak * 0.3, filt: { type: 'lp', f: f * 6, f2: f * 1.5, ft: 0.2 } });
    v.finish();
  },
  bell(m, t, note, peak = 0.06, dur = 3) {
    const v = m.voice(t, 0.7); v.bell({ f: mtof(note), dur, peak }); v.finish();
  },
  sub(m, t, f, dur, peak = 0.3) {
    const v = m.voice(t, 0); v.osc({ f: f * 1.5, f2: f, ft: 0.1, dur, a: 0.005, peak }); v.finish();
  },
  drone(m, notes, peak, cut = 260) {
    const v = m.voice(m.ctx.currentTime + 0.05, 0.3, true);
    notes.forEach((n, i) => v.osc({ type: 'sawtooth', f: mtof(n), detune: i % 2 ? 6 : -6, a: 2.5, peak, filt: { type: 'lp', f: cut, q: 3, lfo: { rate: 0.04 + i * 0.013, depth: cut * 0.4 } } }));
    v.osc({ f: mtof(notes[0]), a: 2.5, peak: peak * 1.2 });
    m.held.push(v);
  },
  // ---- added for the realm and boss themes
  flute(m, t, note, dur, peak, pan = 0) {
    const v = m.voice(t, 0.5), f = mtof(note);
    v.osc({ f, dur, a: Math.min(0.09, dur * 0.3), hold: dur * 0.45, peak, vib: { rate: 5.1, depth: 0.004 }, pan });
    v.osc({ type: 'triangle', f: f * 2, dur, a: 0.08, hold: dur * 0.4, peak: peak * 0.12, pan });
    v.noise({ buf: 'pink', dur: Math.min(0.25, dur), a: 0.02, peak: peak * 0.18, filt: { type: 'bp', f: f * 2, q: 2 }, pan });
    v.finish();
  },
  reed(m, t, note, dur, peak, pan = 0) {
    const v = m.voice(t, 0.45), f = mtof(note);
    v.osc({ type: 'sawtooth', f, dur, a: 0.04, hold: dur * 0.5, peak, vib: { rate: 5.6, depth: 0.005 }, filt: [{ type: 'bp', f: Math.min(3000, f * 3), q: 1.6 }, { type: 'lp', f: 2600 }], pan });
    v.finish();
  },
  fiddle(m, t, note, dur, peak, pan = 0) {
    const v = m.voice(t, 0.45), f = mtof(note);
    v.osc({ type: 'sawtooth', f, dur, a: 0.05, hold: dur * 0.5, peak, vib: { rate: 6, depth: 0.006 }, filt: [{ type: 'bp', f: f * 2.5, q: 0.9 }, { type: 'lp', f: 3200 }], drive: 1.5, pan });
    v.finish();
  },
  cello(m, t, note, dur, peak, pan = 0) {
    const v = m.voice(t, 0.45), f = mtof(note);
    for (const d of [-5, 5]) v.osc({ type: 'sawtooth', f, detune: d, dur, a: Math.min(0.18, dur * 0.25), hold: dur * 0.5, peak, vib: { rate: 4.8, depth: 0.004 }, filt: { type: 'lp', f: Math.min(1800, f * 4.5), q: 0.8 }, pan });
    v.finish();
  },
  organ(m, t, notes, dur, peak, bright = 1) {
    const v = m.voice(t, 0.55);
    for (const n of notes) {
      const f = mtof(n);
      v.osc({ f, dur, a: 0.03, hold: dur * 0.75, peak });
      v.osc({ f: f * 2, dur, a: 0.03, hold: dur * 0.75, peak: peak * 0.5 * bright });
      v.osc({ f: f * 3, dur, a: 0.03, hold: dur * 0.7, peak: peak * 0.22 * bright });
      v.osc({ f: f * 0.5, dur, a: 0.05, hold: dur * 0.75, peak: peak * 0.4 });
    }
    v.finish();
  },
  harpsi(m, t, note, peak, pan = 0) {
    const v = m.voice(t, 0.35), f = mtof(note);
    v.osc({ type: 'sawtooth', f, dur: 0.7, a: 0.001, peak, filt: { type: 'lp', f: f * 12, f2: f * 3, ft: 0.3, q: 1.5 }, pan });
    v.osc({ type: 'square', f: f * 2, dur: 0.3, a: 0.001, peak: peak * 0.25, filt: { type: 'hp', f: 900 }, pan });
    v.finish();
  },
  harp(m, t, note, peak, pan = 0) {
    const v = m.voice(t, 0.6), f = mtof(note);
    v.osc({ type: 'triangle', f, dur: 2.2, a: 0.002, peak, pan });
    v.osc({ f: f * 2, dur: 0.8, a: 0.002, peak: peak * 0.3, pan });
    v.finish();
  },
  celesta(m, t, note, peak, pan = 0) {
    const v = m.voice(t, 0.7), f = mtof(note);
    v.bell({ f, dur: 1.8, peak, pan, partials: [[1, 1, 1], [3, 0.18, 0.5], [4.02, 0.12, 0.35]] });
    v.finish();
  },
  anvil(m, t, peak = 0.08, f = 720) {
    const v = m.voice(t, 0.4);
    v.bell({ f: f * rnd(0.98, 1.02), dur: 1.3, peak, partials: [[1, 1, 1], [2.43, 0.6, 0.6], [3.89, 0.45, 0.45], [5.61, 0.3, 0.3]] });
    v.noise({ buf: 'white', dur: 0.03, a: 0.001, peak: peak * 1.5, filt: { type: 'bp', f: 3500, q: 1 } });
    v.finish();
  },
  chains(m, t, peak = 0.05) {
    const v = m.voice(t, 0.35);
    for (let k = 0; k < 5; k++) v.noise({ t: k * rnd(0.03, 0.07), buf: 'white', dur: 0.05, a: 0.001, peak: peak * rnd(0.5, 1), filt: { type: 'bp', f: rnd(3000, 6000), q: 4 }, pan: rnd(-0.4, 0.4) });
    v.finish();
  },
  drip(m, t, note, peak = 0.05) {
    const v = m.voice(t, 0.8), f = mtof(note);
    v.osc({ f: f * 1.7, f2: f, ft: 0.04, dur: 0.35, a: 0.001, peak, pan: rnd(-0.7, 0.7) });
    v.finish();
  },
  snare(m, t, peak = 0.12) {
    const v = m.voice(t, 0.25);
    v.noise({ buf: 'white', dur: 0.16, a: 0.001, peak, filt: { type: 'bp', f: 2600, q: 0.6 } });
    v.osc({ f: 210, f2: 170, ft: 0.05, dur: 0.1, a: 0.001, peak: peak * 0.8 });
    v.finish();
  },
  kick(m, t, peak = 0.5) {
    const v = m.voice(t, 0.05);
    v.osc({ f: 110, f2: 42, ft: 0.08, dur: 0.35, a: 0.001, peak });
    v.finish();
  },
  timp(m, t, note, peak = 0.35) {
    const v = m.voice(t, 0.4), f = mtof(note);
    v.osc({ f: f * 1.04, f2: f, ft: 0.06, dur: 1.4, a: 0.002, peak });
    v.osc({ f: f * 1.5, dur: 0.6, a: 0.002, peak: peak * 0.25 });
    v.noise({ buf: 'brown', dur: 0.12, a: 0.001, peak: peak * 0.5, filt: { type: 'lp', f: 500 } });
    v.finish();
  },
  cymbal(m, t, peak = 0.05, dur = 2.2) {
    const v = m.voice(t, 0.5);
    v.noise({ buf: 'white', dur, a: 0.002, peak, filt: [{ type: 'hp', f: 4200 }, { type: 'peaking', f: 7500, q: 1, gain: 6 }] });
    v.finish();
  },
  heart(m, t, peak = 0.3) {
    const v = m.voice(t, 0);
    v.osc({ f: 70, f2: 40, ft: 0.06, dur: 0.22, a: 0.002, peak });
    v.osc({ t: 0.2, f: 60, f2: 36, ft: 0.06, dur: 0.22, a: 0.002, peak: peak * 0.7 });
    v.finish();
  },
  horn(m, t, notes, dur, peak) {
    const v = m.voice(t, 0.5);
    for (const n of notes) {
      const f = mtof(n);
      v.osc({ type: 'sawtooth', f, dur, a: 0.09, hold: dur * 0.5, peak, filt: { type: 'lp', f: Math.min(1500, f * 4), q: 0.7 } });
      v.osc({ type: 'triangle', f, dur, a: 0.07, hold: dur * 0.5, peak: peak * 0.8 });
    }
    v.finish();
  },
  glass(m, t, note, peak = 0.04, dur = 4) {
    const v = m.voice(t, 0.8), f = mtof(note);
    v.osc({ f, dur, a: dur * 0.4, peak, trem: { rate: rnd(3, 5), depth: 0.4 } });
    v.osc({ f: f * 2.01, dur, a: dur * 0.5, peak: peak * 0.3 });
    v.finish();
  },
};

