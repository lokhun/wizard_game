// Generative dark-fantasy music for GameAudio.setMusic(). A MusicPlayer runs a
// lookahead step sequencer (16th-note steps) driven by GameAudio's pump
// (setInterval + AudioContext time). D minor / D phrygian throughout.
import { pick } from './core.js';

import { I } from './instruments.js';
import { THEMES } from './themes.js';

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
    this.a = audio; this.ctx = audio.ctx; this.state = state; this.def = THEMES[state] ?? MUSIC[state.split(':')[0]];
    this.intensity = audio._musicIntensity ?? 0;
    this.out = this.ctx.createGain(); this.out.gain.value = 0;
    // dread (Nightmare): the same music, darker and a breath slower, over a low tritone
    this.dread = !!audio.dread && state !== 'menu' && state !== 'victory';
    this.song = null;
    if (this.dread) {
      this.dark = this.ctx.createBiquadFilter(); this.dark.type = 'lowpass'; this.dark.frequency.value = 1900; this.dark.Q.value = 0.5;
      this.out.connect(this.dark); this.dark.connect(dest);
    } else this.out.connect(dest);
    this.spb = 60 / this.def.bpm / 4 * (this.dread ? 1.06 : 1); // seconds per 16th step
    this.i = 0; this.next = this.ctx.currentTime + 0.08; this.alive = true; this.held = [];
  }
  voice(t, verb, sustain = false) {
    return this.a._makeVoice({ t0: t, dest: this.out, send: this.a._musicSend, sendAmt: verb, vol: 1, p: 1, sustain });
  }
  start(fade) {
    const g = this.out.gain, now = this.ctx.currentTime;
    g.setValueAtTime(0, now); g.linearRampToValueAtTime(this.def.gain, now + fade);
    if (this.def.setup) this.def.setup(this);
    if (this.dread) I.drone(this, [32, 20], 0.022, 180); // G# under the D: the devil's interval
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
  dispose() { try { this.out.disconnect(); this.dark?.disconnect(); } catch { /* */ } }
}
