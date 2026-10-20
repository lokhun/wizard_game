// Sustained sounds for GameAudio.loop(). Each fn builds on a sustain-mode Voice:
// components fade in over `a` and keep running until the handle is stopped.
// Components flagged `once` are one-shot start transients.

export const LOOPS = {};
const def = (name, verb, fn, x = {}) => { LOOPS[name] = { fn, verb, ...x }; };

def('loop_beam_fire', 0.2, (v) => {
  v.noise({ buf: 'brown', a: 0.12, peak: 0.9, filt: { type: 'lp', f: 900, q: 3, lfo: { rate: 3.3, depth: 300 } }, drive: 2 });
  v.noise({ buf: 'pink', a: 0.12, peak: 0.4, filt: { type: 'bp', f: 1400, q: 0.8, lfo: { rate: 0.7, depth: 500 } } });
  v.noise({ buf: 'crackle', a: 0.1, peak: 0.5, filt: { type: 'hp', f: 1800 } });
  v.osc({ type: 'sawtooth', f: 55, a: 0.2, peak: 0.12, filt: { type: 'lp', f: 220 } });
  v.noise({ once: true, buf: 'pink', dur: 0.4, a: 0.05, peak: 0.5, filt: { type: 'bp', f: 400, f2: 2000, q: 1.2 } });
});
def('loop_beam_frost', 0.3, (v) => {
  v.noise({ buf: 'white', a: 0.15, peak: 0.3, filt: { type: 'hp', f: 5000 }, trem: { rate: 9, depth: 0.5 } });
  [1568, 2093, 2637].forEach((f, i) => v.osc({ f, a: 0.2, peak: 0.05, vib: { rate: 0.3 + i * 0.17, depth: 0.004 }, trem: { rate: 3 + i * 1.3, depth: 0.7 } }));
  v.noise({ buf: 'brown', a: 0.2, peak: 0.45, filt: { type: 'lp', f: 300 } });
  v.noise({ buf: 'crackle', a: 0.1, peak: 0.3, rate: 1.6, filt: { type: 'hp', f: 4000 } });
});
def('loop_beam_lightning', 0.2, (v) => {
  v.osc({ type: 'sawtooth', f: 58, a: 0.05, peak: 0.25, filt: { type: 'bp', f: 1200, q: 1 }, drive: 8 });
  v.osc({ type: 'square', f: 116.5, a: 0.05, peak: 0.08, filt: { type: 'lp', f: 2000 } });
  v.noise({ buf: 'crackle', a: 0.03, peak: 0.6, rate: 2.5, filt: { type: 'hp', f: 2000 } });
  v.noise({ buf: 'white', a: 0.05, peak: 0.25, filt: { type: 'bp', f: 3500, q: 0.8 }, trem: { rate: 31, depth: 1, type: 'square' } });
  v.noise({ once: true, buf: 'white', dur: 0.1, a: 0.001, peak: 0.8, filt: { type: 'hp', f: 1500 } });
});
def('loop_beam_holy', 0.45, (v) => {
  v.choir({ freqs: [261.63, 329.63, 392, 523.25], a: 0.4, peak: 0.1, vowel: 'a' });
  v.noise({ buf: 'white', a: 0.3, peak: 0.15, filt: { type: 'hp', f: 6000 }, trem: { rate: 6, depth: 0.6 } });
  v.osc({ f: 1046.5, a: 0.3, peak: 0.04, trem: { rate: 4, depth: 0.5 } });
  v.osc({ f: 1568, a: 0.3, peak: 0.03, trem: { rate: 5.3, depth: 0.5 } });
});
def('loop_beam_shadow', 0.35, (v) => {
  v.osc({ type: 'sawtooth', f: 41.2, a: 0.2, peak: 0.25, filt: { type: 'lp', f: 280, q: 6, lfo: { rate: 0.4, depth: 120 } }, drive: 3 });
  v.osc({ type: 'sawtooth', f: 41.9, a: 0.2, peak: 0.2, filt: { type: 'lp', f: 300, q: 4 } });
  v.noise({ buf: 'pink', a: 0.3, peak: 0.4, filt: { type: 'lp', f: 700 }, trem: { rate: 0.8, depth: 0.8 } });
  v.noise({ buf: 'pink', a: 0.3, peak: 0.15, filt: { type: 'bp', f: 2200, q: 5, lfo: { rate: 0.27, depth: 700 } }, trem: { rate: 7, depth: 0.7 } });
});
def('loop_beam_blood', 0.25, (v) => {
  v.noise({ buf: 'brown', a: 0.15, peak: 0.6, filt: { type: 'lp', f: 500, q: 6 }, trem: { rate: 2.2, depth: 0.8 } });
  v.noise({ buf: 'pink', a: 0.15, peak: 0.3, filt: { type: 'bp', f: 900, q: 4, lfo: { rate: 1.1, depth: 500 } } });
  v.osc({ f: 48, a: 0.2, peak: 0.35, trem: { rate: 1.1, depth: 0.9 } });
});
def('loop_channel', 0.35, (v) => {
  v.osc({ f: 220, a: 0.25, peak: 0.12 });
  v.osc({ f: 330, a: 0.25, peak: 0.07, trem: { rate: 4.5, depth: 0.5 } });
  v.osc({ f: 880, a: 0.3, peak: 0.04, mod: { ratio: 2, index: 1 }, trem: { rate: 3.2, depth: 0.7 } });
  v.noise({ buf: 'pink', a: 0.3, peak: 0.12, filt: { type: 'bp', f: 1800, q: 6, lfo: { rate: 0.5, depth: 600 } } });
});
def('loop_burning', 0.15, (v) => {
  v.noise({ buf: 'crackle', a: 0.1, peak: 0.6, rate: 0.9, filt: { type: 'hp', f: 1200 } });
  v.noise({ buf: 'brown', a: 0.2, peak: 0.45, filt: { type: 'lp', f: 400, lfo: { rate: 0.5, depth: 150 } } });
  v.noise({ buf: 'pink', a: 0.2, peak: 0.12, filt: { type: 'bp', f: 2000, q: 0.7 }, trem: { rate: 1.7, depth: 0.6 } });
});
def('loop_heartbeat', 0.05, (v) => {
  v.noise({ buf: 'heart', a: 0.02, peak: 1, offset: 0, filt: { type: 'lp', f: 320, fixed: true } });
}, { pv: 0 });
def('loop_tornado', 0.25, (v) => {
  v.noise({ buf: 'pink', a: 0.3, peak: 0.6, filt: { type: 'bp', f: 600, q: 3, lfo: { rate: 0.8, depth: 350 } } });
  v.noise({ buf: 'pink', a: 0.3, peak: 0.35, filt: { type: 'bp', f: 1600, q: 4, lfo: { rate: 1.3, depth: 700 } }, trem: { rate: 3, depth: 0.5 } });
  v.noise({ buf: 'brown', a: 0.3, peak: 0.6, filt: { type: 'lp', f: 220 } });
  v.noise({ buf: 'white', a: 0.3, peak: 0.06, filt: { type: 'bp', f: 3000, q: 18, lfo: { rate: 0.6, depth: 800 } } });
});
def('loop_portal', 0.4, (v) => {
  v.osc({ f: 110, a: 0.5, peak: 0.12 });
  v.osc({ f: 110.7, a: 0.5, peak: 0.1 });
  v.osc({ f: 165, a: 0.5, peak: 0.06, trem: { rate: 0.3, depth: 0.6 } });
  v.osc({ f: 440, a: 0.5, peak: 0.04, mod: { ratio: 1.5, index: 0.8 }, trem: { rate: 0.23, depth: 0.8 } });
  v.noise({ buf: 'pink', a: 0.5, peak: 0.15, filt: { type: 'bp', f: 900, q: 8, lfo: { rate: 0.2, depth: 400 } } });
  v.osc({ f: 55, a: 0.5, peak: 0.15 });
});
