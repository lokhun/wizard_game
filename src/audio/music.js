// Generative dark-fantasy music for GameAudio.setMusic(). A MusicPlayer runs a
// lookahead step sequencer (16th-note steps) driven by GameAudio's pump
// (setInterval + AudioContext time). D minor / D phrygian throughout.
import { rnd, pick, mtof } from './core.js';

// ------------------------------------------------------------ instruments ---
const I = {
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
};

// Chords (midi)
const Dm = [50, 53, 57], Bb = [46, 50, 53], Gm = [43, 46, 50], A = [45, 49, 52], C = [48, 52, 55], Eb = [51, 55, 58];
const PHRYG = [62, 63, 65, 67, 69, 70, 72, 74];

// ------------------------------------------------------------------ states ---
export const MUSIC = {
  menu: {
    bpm: 56, gain: 2.2,
    setup(m) { I.drone(m, [26, 33], 0.05, 220); },
    step(m, i, t) {
      const spb = m.spb;
      if (i % 32 === 0) I.pad(m, t, [Dm, Bb, Gm, A][(i / 32) % 4], spb * 34, 0.06, 'o');
      if (i % 8 === 4 && Math.random() < 0.22) I.bell(m, t, pick([62, 65, 69, 70, 74]), 0.04, 4);
    },
  },
  explore: {
    bpm: 70, gain: 2.2,
    setup(m) { I.drone(m, [38, 45], 0.04, 240); m.mel = 3; },
    step(m, i, t) {
      const spb = m.spb, bar2 = (i / 32) | 0, ch = [Dm, Bb, Gm, A][bar2 % 4];
      if (i % 32 === 0) { I.pad(m, t, ch, spb * 34, 0.05, 'a'); I.strings(m, t, ch[0] - 12, spb * 30, 0.035, 0.6); }
      if (i % 4 === 0 && i % 32 !== 0 && Math.random() < 0.33) {
        m.mel = Math.max(0, Math.min(PHRYG.length - 1, m.mel + pick([-2, -1, -1, 1, 1, 2])));
        I.pluck(m, t, PHRYG[m.mel] - (Math.random() < 0.3 ? 12 : 0), 0.08);
      }
      if (i % 32 === 0 && bar2 % 2 === 0) I.taiko(m, t, 0.22, 60);
      if (i % 64 === 48 && Math.random() < 0.5) I.bell(m, t, pick([74, 77, 81]), 0.03, 4);
    },
  },
  combat: {
    bpm: 112, gain: 1.8,
    setup(m) { I.drone(m, [26, 38], 0.04, 200); },
    step(m, i, t) {
      const s = i % 16, bar = (i / 16) | 0, ch = [Dm, Dm, Bb, A][bar % 4];
      const BIG = [1, 0, 0, 0, 0, 0, 1, 0, 1, 0, 0, 1, 0, 0, 0, 0], SM = [0, 0, 1, 0, 1, 0, 0, 0, 0, 0, 1, 0, 1, 0, 1, 0];
      if (BIG[s]) I.taiko(m, t, s === 0 ? 0.6 : 0.45, s === 0 ? 62 : 72);
      if (SM[s]) I.frame(m, t, 0.18);
      if (s === 4 || s === 12) I.rim(m, t, 0.12);
      if (bar % 4 === 3 && s >= 12) I.tom(m, t, [130, 110, 95, 80][s - 12], 0.35);
      if (s % 2 === 0) I.stac(m, t, ch[0] - 12 + [0, 0, 12, 0, 1, 0, 12, 7][s / 2], 0.05);
      if (s === 0) I.pad(m, t, ch, m.spb * 17, 0.035, 'a');
      if (s === 0 && bar % 4 === 0) I.brass(m, t, [ch[0] - 12, ch[0]], m.spb * 20, 0.025, 1400);
    },
  },
  boss: {
    bpm: 124, gain: 1.8,
    setup(m) { I.drone(m, [26, 33, 38], 0.045, 240); },
    step(m, i, t) {
      const s = i % 16, bar = (i / 16) | 0, ch = [Dm, Eb, Dm, C][bar % 4];
      const BIG = [1, 0, 0, 1, 0, 0, 1, 0, 1, 0, 1, 0, 1, 0, 0, 0];
      if (BIG[s]) I.taiko(m, t, s === 0 ? 0.7 : 0.5, s === 0 ? 58 : 70);
      if (bar % 2 === 1 && [7, 13, 14, 15].includes(s)) I.tom(m, t, [0, 0, 0, 0, 0, 0, 0, 140, 0, 0, 0, 0, 0, 120, 100, 85][s], 0.35);
      if (s % 2 === 1) I.shaker(m, t, 0.05);
      if (s === 4 || s === 12) I.rim(m, t, 0.15);
      if ([0, 3, 6, 10].includes(s)) I.brass(m, t, ch.map((n) => n - 12), s === 0 ? 0.3 : 0.16, 0.022, 2800);
      I.stac(m, t, 38 + [0, 0, 1, 0, 0, 12, 0, 1, 0, 0, 3, 0, 1, 0, 12, 7][s] + (ch === Eb ? 1 : 0), 0.04);
      if (s === 0 && bar % 2 === 0) I.pad(m, t, ch, m.spb * 34, 0.05, 'a');
      if (s === 0 && bar % 4 === 0) { I.gong(m, t, 55, 0.1, 4); I.sub(m, t, 36.7, 1.2, 0.35); }
      if (s === 8 && bar % 4 === 3) I.swell(m, t, m.spb * 8, 0.1);
    },
  },
  victory: {
    bpm: 100, gain: 2, len: 48,
    step(m, i, t) {
      if (i === 0) { I.brass(m, t, [58, 62, 65], 0.5, 0.03); I.taiko(m, t, 0.5); }
      if (i === 4) { I.brass(m, t, [60, 64, 67], 0.5, 0.03); I.taiko(m, t, 0.5); }
      if (i === 8) {
        I.brass(m, t, [50, 62, 66, 69], 2.6, 0.03); I.taiko(m, t, 0.7, 55);
        I.pad(m, t, [50, 54, 57, 62], 3.5, 0.06, 'a'); I.gong(m, t, 110, 0.06, 4);
      }
      if (i >= 8 && i <= 14 && i % 2 === 0) I.bell(m, t, [74, 78, 81, 86][(i - 8) / 2], 0.05, 2.5);
    },
  },
  defeat: {
    bpm: 54, gain: 2, len: 48,
    step(m, i, t) {
      const mot = { 0: 57, 4: 55, 8: 53, 12: 52 };
      if (mot[i] !== undefined) I.strings(m, t, mot[i], m.spb * 5, 0.04, 0.1);
      if (i === 16) { I.strings(m, t, 50, 4, 0.04, 0.1); I.strings(m, t, 38, 4.5, 0.035, 0.3); I.pad(m, t, [38, 50, 53, 57], 5, 0.06, 'o'); I.gong(m, t, 55, 0.1, 6); I.taiko(m, t, 0.4, 50); }
    },
  },
};

export class MusicPlayer {
  constructor(audio, state, dest) {
    this.a = audio; this.ctx = audio.ctx; this.state = state; this.def = MUSIC[state];
    this.out = this.ctx.createGain(); this.out.gain.value = 0; this.out.connect(dest);
    this.spb = 60 / this.def.bpm / 4; // seconds per 16th step
    this.i = 0; this.next = this.ctx.currentTime + 0.08; this.alive = true; this.held = [];
  }
  voice(t, verb, sustain = false) {
    return this.a._makeVoice({ t0: t, dest: this.out, send: this.a._musicSend, sendAmt: verb, vol: 1, p: 1, sustain });
  }
  start(fade) {
    const g = this.out.gain, now = this.ctx.currentTime;
    g.setValueAtTime(0, now); g.linearRampToValueAtTime(this.def.gain, now + fade);
    if (this.def.setup) this.def.setup(this);
  }
  tick(ahead) {
    if (!this.alive) return;
    const now = this.ctx.currentTime;
    if (this.next < now - 0.05) this.next = now + 0.02; // resync after throttling/suspend
    while (this.next < now + ahead) {
      if (this.def.len && this.i >= this.def.len) return;
      try { this.def.step(this, this.i, this.next); } catch (e) { console.warn('[audio] music step', e); }
      this.next += this.spb; this.i++;
    }
  }
  stop(fade) {
    this.alive = false;
    const g = this.out.gain, now = this.ctx.currentTime;
    g.cancelScheduledValues(now); g.setValueAtTime(g.value, now); g.linearRampToValueAtTime(0, now + fade);
    for (const v of this.held) v.release(fade);
    return now + fade + 0.1; // time after which out can be disconnected
  }
  dispose() { try { this.out.disconnect(); } catch { /* */ } }
}
