// The realm and boss themes. Each is composed as data for song(): a key and
// mode, a form (sections in order, then looping from `loop`), and per section
// a chord progression (one chord per bar) and parts:
//   { d: inst, p }          a hit pattern: 'X' accent, 'x' normal, 'o' ghost, '.' rest
//                           (several bars long when longer than a bar)
//   { b: inst, p }          a line on the bar's chord: '1' '3' '5' its tones,
//                           '8' / '0' the root an octave up / down, 'A' 'B' the
//                           third / fifth an octave up, '2' '4' '6' '7' scale steps
//                           above the root; '.' holds, '-' rests
//   { m: inst, l: [...] }   a melody, one string per bar in scale degrees
//                           ('0'-'9', 'A'-'E' = 10-14, 'a'-'f' = -1..-6),
//                           one character per `res` steps; alts: other line
//                           sets, one picked each time the section starts
//   { c: inst, p }          the whole chord struck on each hit, held to the next
//   { f(m, s, bar, t, X) }  anything else
// Common options: o (semitones), v (level), min / max (music intensity: a
// boss's later phases raise it), prob (chance per note), bars (only these bars).
// Melodies keep chord tones on each bar's downbeat (scripts/music.js checks).
import { I } from './instruments.js';
import { rnd, pick, mtof } from './core.js';

export const SCALES = {
  aeolian: [0, 2, 3, 5, 7, 8, 10], phrygian: [0, 1, 3, 5, 7, 8, 10], dorian: [0, 2, 3, 5, 7, 9, 10],
  harmonic: [0, 2, 3, 5, 7, 8, 11], locrian: [0, 1, 3, 5, 6, 8, 10], ionian: [0, 2, 4, 5, 7, 9, 11], lydian: [0, 2, 4, 6, 7, 9, 11],
};
const deg = (sc, d) => { const n = sc.length, o = Math.floor(d / n); return sc[d - o * n] + 12 * o; };
export const melDeg = (ch) => (ch >= '0' && ch <= '9' ? +ch : ch >= 'A' && ch <= 'E' ? 10 + ch.charCodeAt(0) - 65 : ch >= 'a' && ch <= 'f' ? -1 - (ch.charCodeAt(0) - 97) : null);
// a bar's chord: a diatonic triad on a degree of the harmony scale, or semitones above the tonic
export function chordOf(spec, c) { return Array.isArray(c) ? c : [0, 2, 4].map((k) => deg(SCALES[spec.harm ?? spec.scale], c + k)); }

// instruments by how they're called
const ONE = new Set(['stac', 'pluck', 'harpsi', 'harp', 'celesta', 'drip']); // (m, t, note, peak)
const HELD = new Set(['strings', 'cello', 'flute', 'reed', 'fiddle']); //        (m, t, note, dur, peak)
const CHORD = new Set(['pad', 'organ', 'brass', 'horn']); //                       (m, t, notes, dur, peak)
function note(m, inst, t, n, dur, v, vowel) {
  if (ONE.has(inst)) I[inst](m, t, n, v);
  else if (HELD.has(inst)) I[inst](m, t, n, dur, v);
  else if (CHORD.has(inst)) I[inst](m, t, [n], dur, v, vowel);
  else if (inst === 'bell') I.bell(m, t, n, v, Math.max(1.5, dur));
  else if (inst === 'glass') I.glass(m, t, n, v, Math.max(1, dur));
}
function chord(m, inst, t, notes, dur, v, vowel) {
  if (CHORD.has(inst)) I[inst](m, t, notes, dur, v, vowel);
  else for (const n of notes) note(m, inst, t, n, dur, v / Math.sqrt(notes.length));
}
// how many steps a note at pattern position k lasts (to the next note or rest)
function span(p, k, res) {
  let n = 1;
  while (k + n < p.length && p[k + n] === '.') n++;
  return n * res;
}
const VEL = { X: 1, x: 0.7, o: 0.4 };

export function song(spec) {
  const sc = SCALES[spec.scale];
  const secs = spec.sec;
  return {
    bpm: spec.bpm, gain: spec.gain ?? 2, spec,
    setup(m) {
      m.song = { f: 0, k: 0, pick: new Map(), passes: 0 };
      if (spec.drone) I.drone(m, spec.drone.map((x) => spec.root + x), spec.dronePeak ?? 0.04, spec.droneCut ?? 240);
      spec.setup?.(m);
    },
    step(m, _i, t) {
      const st = m.song;
      let sec = secs[spec.form[st.f]];
      let steps = sec.steps ?? 16;
      if (st.k >= sec.bars * steps) {
        st.f++; st.k = 0; st.pick.clear();
        if (st.f >= spec.form.length) { st.f = spec.loop ?? 0; st.passes++; }
        sec = secs[spec.form[st.f]]; steps = sec.steps ?? 16;
      }
      const k = st.k++, bar = (k / steps) | 0, s = k % steps, spb = m.spb;
      const cv = sec.prog[bar % sec.prog.length];
      const ch = chordOf(spec, cv), root = spec.root;
      const X = { chord: ch, root, spec, steps, intensity: m.intensity ?? 0 };
      for (let pi = 0; pi < sec.parts.length; pi++) {
        const P = sec.parts[pi];
        if (P.min !== undefined && X.intensity < P.min) continue;
        if (P.max !== undefined && X.intensity > P.max) continue;
        if (P.bars && !P.bars.includes(bar)) continue;
        if (P.f) { P.f(m, s, bar, t, X); continue; }
        const v = P.v ?? 0.05, o = P.o ?? 0;
        if (P.d) {
          const p = P.p, idx = (bar * steps + s) % p.length, c = p[idx];
          if (c === '.' || c === undefined || (P.prob !== undefined && Math.random() > P.prob)) continue;
          const pk = v * VEL[c] * (P.hum ? rnd(0.85, 1.05) : 1);
          if (P.d === 'tom') I.tom(m, t, P.n ? P.n[idx % P.n.length] : 120, pk);
          else if (P.d === 'timp') I.timp(m, t, root + ch[0] + o, pk);
          else I[P.d](m, t, pk, ...(P.a ?? []));
        } else if (P.b) {
          const p = P.p, res = P.res ?? 1;
          if (s % res) continue;
          const pos = ((bar * steps + s) / res) % p.length, c = p[pos];
          if (c === '.' || c === '-' || (P.prob !== undefined && Math.random() > P.prob)) continue;
          const dg = typeof cv === 'number' ? cv : null;
          const step = (n) => (dg !== null ? deg(SCALES[spec.harm ?? spec.scale], dg + n) : ch[0] + [0, 2, 3, 5, 7, 9, 10][n]);
          const semi = { 1: ch[0], 3: ch[1], 5: ch[2], 8: ch[0] + 12, 0: ch[0] - 12, A: ch[1] + 12, B: ch[2] + 12, 2: step(1), 4: step(3), 6: step(5), 7: step(6) }[c];
          if (semi === undefined) continue;
          note(m, P.b, t, root + semi + o, span(p, pos, res) * spb * (P.legato ?? 1), v * (P.hum ? rnd(0.85, 1.05) : 1), P.vowel);
        } else if (P.m) {
          const res = P.res ?? 2;
          if (s % res) continue;
          let lines = P.l;
          if (P.alts) { if (!st.pick.has(pi)) st.pick.set(pi, pick([P.l, ...P.alts])); lines = st.pick.get(pi); }
          const line = lines[bar % lines.length], pos = s / res, c = line[pos];
          if (c === undefined || c === '.' || c === '-') continue;
          const d = melDeg(c);
          if (d === null || (P.prob !== undefined && Math.random() > P.prob)) continue;
          // a held note may tie over the barline
          let n = 1; while (pos + n < line.length && line[pos + n] === '.') n++;
          if (pos + n >= line.length) { const nx = lines[(bar + 1) % lines.length]; let j = 0; while (j < nx.length && nx[j] === '.') { n++; j++; } }
          note(m, P.m, t, root + deg(sc, d) + o, n * res * spb * (P.legato ?? 0.95), v, P.vowel);
        } else if (P.c) {
          const p = P.p ?? 'X', idx = (bar * steps + s) % p.length, c = p[idx];
          if (!VEL[c]) continue;
          const len = (P.len ?? span(p, idx, 1)) * spb;
          chord(m, P.c, t, ch.map((x) => root + x + o), len, v * VEL[c], P.vowel);
        }
      }
    },
  };
}

// --------------------------------------------------------------- helpers ---
// a part that strikes at the first step of every n-th bar
const every = (n, fn, extra = {}) => ({ ...extra, f: (m, s, bar, t, X) => { if (s === 0 && bar % n === 0) fn(m, t, X); } });
const chance = (p, fn, extra = {}) => ({ ...extra, f: (m, s, bar, t, X) => { if (Math.random() < p) fn(m, t, X, s); } });
const bars = (n, ch = '.') => ch + '.'.repeat(n * 16 - 1);
const R = (str, n) => str.repeat(n);

// ----------------------------------------------------------------- themes ---
export const THEMES = {
  // ======================================================== the main menu
  menu: song({
    bpm: 64, gain: 2.03, root: 50, scale: 'aeolian', harm: 'harmonic', drone: [-24, -17], dronePeak: 0.045, droneCut: 220,
    form: ['I', 'A', 'B', 'A'], loop: 1,
    sec: {
      I: { bars: 4, prog: [0, 5, 3, 4], parts: [
        { c: 'pad', p: bars(1, 'X'), v: 0.05, vowel: 'o' },
        { b: 'harp', p: '1.5.8.5.3.5.8.5.', o: -12, v: 0.035 },
      ] },
      A: { bars: 8, prog: [0, 5, 3, 4, 0, 5, 3, 4], parts: [
        { c: 'pad', p: bars(1, 'X'), v: 0.045, vowel: 'o' },
        { b: 'harp', p: '1.5.8.5.3.5.8.5.', o: -12, v: 0.03 },
        { m: 'flute', o: 12, v: 0.04, l: ['4...7.9.', '9.7.5...', '3.4.5.7.', '8...4...', '4...7.9.', '9.A.9.7.', 'A...C.A.', 'B...8...'] },
        every(2, (m, t) => I.taiko(m, t, 0.18, 58)),
      ] },
      B: { bars: 8, prog: [5, [3, 7, 10], 3, 0, 5, [3, 7, 10], 4, 4], parts: [
        { c: 'pad', p: bars(2, 'X'), v: 0.04, vowel: 'a' },
        { b: 'celesta', p: '1...5...8...5...', o: 12, v: 0.025 },
        { m: 'cello', o: 0, v: 0.05, l: ['5...7.5.', '2...4.6.', '3...5.4.', '0.......', '5...7.9.', '9...6.4.', '4...1.4.', '4.......'] },
        chance(0.03, (m, t, X) => I.bell(m, t, 74 + pick([0, 3, 7]), 0.025, 4)),
      ] },
    },
  }),

  // ======================================================== places of rest
  // the Wandering Merchant: a lute waltz in D dorian
  shop: song({
    bpm: 96, gain: 4.6, root: 50, scale: 'dorian', drone: [-24], dronePeak: 0.02, droneCut: 260,
    form: ['A', 'B'],
    sec: {
      A: { bars: 8, steps: 12, prog: [0, 3, 0, 4, 2, 6, 3, 0], parts: [
        { b: 'pluck', p: '1...35..35..', o: -12, v: 0.05 },
        { d: 'frame', p: 'X...x...x...', v: 0.1 },
        { m: 'flute', o: 12, v: 0.032, l: ['4.3.2.', '3.4.5.', '4.2.0.', '4.....', '2.4.6.', '6.4.2.', '3.5.4.', '0.....'] },
      ] },
      B: { bars: 8, steps: 12, prog: [0, 3, 0, 4, 2, 6, 3, 0], parts: [
        { b: 'harp', p: '1...5...8...', o: 0, v: 0.04 },
        { d: 'shaker', p: '..x...x...x.', v: 0.03 },
        { m: 'reed', o: 12, v: 0.03, l: ['7.....', '5.4.3.', '7.4...', '4.....', '9.8.6.', '8.....', 'A.8.6.', '7.....'] },
        { b: 'pluck', p: '1.....5.....', o: -12, v: 0.045 },
      ] },
    },
  }),
  // a shrine or an altar: a hush of choir, harp and bells
  shrine: song({
    bpm: 54, gain: 2.3, root: 48, scale: 'ionian', drone: [-12, -5], dronePeak: 0.025, droneCut: 400,
    form: ['A'],
    sec: {
      A: { bars: 8, prog: [0, 3, 5, 4, 0, 3, 4, 0], parts: [
        { c: 'pad', p: bars(2, 'X'), v: 0.05, vowel: 'o', o: 12 },
        { b: 'harp', p: '1.5.8.A.B.A.8.5.', o: 12, v: 0.03 },
        { m: 'flute', o: 24, v: 0.028, l: ['4...2...', '5...3...', '5...2...', '4...6...', '7...4...', '3...5...', '4...1...', '0.......'] },
        chance(0.02, (m, t, X) => I.bell(m, t, X.root + 36 + pick([0, 4, 7]), 0.025, 5)),
      ] },
    },
  }),
  // a treasure vault or a secret room: celesta and glass, glittering
  vault: song({
    bpm: 72, gain: 3.3, root: 47, scale: 'lydian', drone: [-12], dronePeak: 0.025, droneCut: 300,
    form: ['A'],
    sec: {
      A: { bars: 4, prog: [0, 1, 0, 4], parts: [
        { b: 'celesta', p: '1358A8531358A853', o: 24, v: 0.016 },
        { c: 'pad', p: bars(4, 'X'), v: 0.035, vowel: 'e', o: 12 },
        { b: 'glass', p: '8...............', o: 12, v: 0.016 },
        { d: 'heart', p: bars(2, 'X'), v: 0.12 },
      ] },
    },
  }),

  // ======================================================= the Drowned Sewers (E phrygian)
  'explore:sewers': song({
    bpm: 66, gain: 1.79, root: 52, scale: 'phrygian', drone: [-24, -17], dronePeak: 0.04, droneCut: 170,
    form: ['A', 'B'],
    sec: {
      A: { bars: 8, prog: [0, 0, 1, 0, 0, 0, 5, 1], parts: [
        { c: 'pad', p: bars(2, 'X'), v: 0.045, vowel: 'u' },
        { b: 'pluck', p: '1.2.1...........', o: -12, v: 0.07 },
        { d: 'taiko', p: bars(2, 'X'), v: 0.18, a: [52] },
        chance(0.07, (m, t, X) => I.drip(m, t, X.root + 24 + pick([0, 3, 7, 12, 15]), rnd(0.015, 0.035))),
      ] },
      B: { bars: 8, prog: [0, 1, 6, 0, 5, 1, 0, 0], parts: [
        { c: 'pad', p: bars(2, 'X'), v: 0.04, vowel: 'u' },
        { b: 'pluck', p: '1.......5.......', o: -12, v: 0.06 },
        { m: 'reed', o: 12, v: 0.035, l: ['0...1.0.', '1...5...', '6...3.1.', '0.......', '5...2.0.', '3...1.0.', '0...4.0.', '0.......'], alts: [['4...2...', '3...1...', '1...3.1.', '0...2.4.', '5...4.2.', '1...3.5.', '2...0...', '4.......']] },
        chance(0.06, (m, t, X) => I.drip(m, t, X.root + 24 + pick([0, 3, 7, 12]), rnd(0.015, 0.03))),
        { d: 'taiko', p: bars(2, 'X'), v: 0.15, a: [52] },
      ] },
    },
  }),
  'combat:sewers': song({
    bpm: 104, gain: 2.11, root: 52, scale: 'phrygian', drone: [-24], dronePeak: 0.04, droneCut: 200,
    form: ['A', 'A', 'B', 'A', 'C'],
    sec: {
      A: { bars: 4, prog: [0, 0, 1, 0], parts: [
        { d: 'taiko', p: 'X.....x...X.x...', v: 0.5, a: [60] },
        { d: 'frame', p: '....x.......x.x.', v: 0.17 },
        { d: 'shaker', p: '..x...x...x...x.', v: 0.045 },
        { b: 'stac', p: '1.12.1..1.12.5.2', o: -12, v: 0.05 },
        { c: 'pad', p: bars(4, 'X'), v: 0.035, vowel: 'u' },
      ] },
      B: { bars: 4, prog: [0, 1, 6, 1], parts: [
        { d: 'taiko', p: 'X.....x...X.x...', v: 0.5, a: [60] },
        { d: 'frame', p: '....x.......x.x.', v: 0.17 },
        { d: 'tom', p: R('.'.repeat(16), 3) + '........x.x.xxxx', n: [150, 130, 115, 100, 90, 80], v: 0.3 },
        { b: 'stac', p: '1.1.1.1.1.1.5.5.', o: -12, v: 0.045 },
        { m: 'reed', o: 12, v: 0.04, l: ['0.1.3.1.', '1.0.1.2.', '3.2.1.0.', '1...0...'] },
      ] },
      C: { bars: 4, prog: [5, 1, 0, 0], parts: [
        { d: 'taiko', p: 'X.......X.......', v: 0.45, a: [56] },
        { c: 'brass', p: 'X.....X.........', o: -12, v: 0.02 },
        { b: 'stac', p: '1.2.1.2.1.2.1.2.', o: -12, v: 0.04 },
        { d: 'cymbal', p: bars(4, 'X'), v: 0.03 },
      ] },
    },
  }),
  // the Mother of Filth: a lurching 6/8, chromatic and bilious
  'boss:motherOfFilth': song({
    bpm: 140, gain: 2.62, root: 52, scale: 'phrygian', drone: [-24, -23], dronePeak: 0.035, droneCut: 160,
    form: ['A', 'A', 'B'],
    sec: {
      A: { bars: 8, steps: 12, prog: [0, 0, 1, 0, 0, 0, [-1, 2, 5], 1], parts: [
        { d: 'taiko', p: 'X.....x.....', v: 0.6, a: [55] },
        { d: 'frame', p: '...x.x...x.x', v: 0.2 },
        { d: 'taiko', p: '..x.....x..x', v: 0.3, a: [80], min: 2 },
        { b: 'stac', p: '1..1..2..1..', o: -12, v: 0.06 },
        { b: 'stac', p: '1.1.1.1.1.1.', o: 0, v: 0.035, min: 1 },
        { c: 'organ', p: 'X' + '.'.repeat(23), o: -12, v: 0.016 },
        { c: 'pad', p: 'X' + '.'.repeat(47), v: 0.05, vowel: 'a' },
        { m: 'fiddle', o: 12, v: 0.035, l: ['0..1..', '4..2.1', '1..0..', '0.....', '4..5.4', '2..1.0', '3..3..', '1..0..'] },
        { c: 'brass', p: 'X.....X.....', o: -12, v: 0.02, min: 1 },
        { d: 'cymbal', p: 'X' + '.'.repeat(95), v: 0.035, min: 1 },
      ] },
      B: { bars: 4, steps: 12, prog: [1, 1, 0, 0], parts: [
        { d: 'heart', p: 'X...........', v: 0.3 },
        { c: 'pad', p: 'X' + '.'.repeat(23), v: 0.05, vowel: 'u' },
        { b: 'glass', p: '8...........', o: 12, v: 0.02 },
        chance(0.08, (m, t, X) => I.drip(m, t, X.root + 24 + pick([0, 1, 7, 12, 13]), 0.03)),
        { d: 'taiko', p: 'X.....x.....', v: 0.4, a: [55], min: 1 },
      ] },
    },
  }),

  // ======================================================= the Oubliette (C minor)
  'explore:dungeon': song({
    bpm: 70, gain: 2.23, root: 48, scale: 'aeolian', harm: 'harmonic', drone: [-24, -17], dronePeak: 0.04, droneCut: 220,
    form: ['A', 'B'],
    sec: {
      A: { bars: 8, prog: [0, 3, 4, 0, 5, 3, 4, 4], parts: [
        { c: 'pad', p: bars(2, 'X'), v: 0.04, vowel: 'o' },
        { d: 'anvil', p: bars(2, 'X'), v: 0.045, prob: 0.6, a: [640] },
        { d: 'rim', p: 'x.......x.......', v: 0.035 },
        chance(0.012, (m, t) => I.chains(m, t, 0.035)),
        { m: 'cello', o: 0, v: 0.05, l: ['4...2.0.', '3...5.3.', '4...1.4.', '2...0...', '5...7.5.', '3...7.5.', '4...1.4.', '1.......'], alts: [['7...4.2.', '5...3...', '1...4...', '0...2.4.', '9...7.5.', '7...5.3.', '4...1...', '4.......']] },
      ] },
      B: { bars: 8, prog: [5, [3, 7, 10], 3, 4, 5, [3, 7, 10], 4, 0], parts: [
        { c: 'pad', p: bars(2, 'X'), v: 0.035, vowel: 'o' },
        { b: 'strings', p: '1...............', o: -12, v: 0.03 },
        { b: 'pluck', p: '1.3.5.3.1.3.5.3.', o: 0, v: 0.03 },
        { m: 'reed', o: 12, v: 0.032, l: ['7...5.4.', '6...4.2.', '5...3.2.', '4...1...', '7...9.7.', '9...6.4.', '8...4.6.', '7.......'] },
        chance(0.012, (m, t) => I.chains(m, t, 0.03)),
        { d: 'anvil', p: bars(4, 'X'), v: 0.04, a: [600] },
      ] },
    },
  }),
  'combat:dungeon': song({
    bpm: 116, gain: 1.81, root: 48, scale: 'harmonic', drone: [-24], dronePeak: 0.04, droneCut: 200,
    form: ['A', 'A', 'B', 'A'],
    sec: {
      A: { bars: 4, prog: [0, 0, 5, 4], parts: [
        { d: 'taiko', p: 'X..x..X...X.x...', v: 0.5, a: [62] },
        { d: 'anvil', p: '....X.......X...', v: 0.06, a: [700] },
        { d: 'shaker', p: '.x.x.x.x.x.x.x.x', v: 0.03 },
        { b: 'stac', p: '1.1.3.1.5.1.3.1.', o: -12, v: 0.05 },
        { c: 'pad', p: bars(4, 'X'), v: 0.03, vowel: 'a' },
      ] },
      B: { bars: 4, prog: [3, 3, 4, 4], parts: [
        { d: 'taiko', p: 'X..x..X...X.x...', v: 0.5, a: [62] },
        { d: 'anvil', p: '....X.......X...', v: 0.06, a: [700] },
        { c: 'brass', p: 'X.....X.........', o: -12, v: 0.02 },
        { b: 'stac', p: '1.1.1.1.5.5.3.3.', o: -12, v: 0.045 },
        { m: 'fiddle', o: 12, v: 0.035, l: ['3.4.5.3.', '7.5.4.3.', '4.6.8.6.', '4.......'] },
        { d: 'tom', p: R('.'.repeat(16), 3) + '........xx.xxxxx', n: [160, 140, 120, 105, 95, 85, 75, 70], v: 0.3 },
      ] },
    },
  }),
  // the Executioner: a march to the block, with the Dies irae in the horns
  'boss:executioner': song({
    bpm: 128, gain: 2.26, root: 48, scale: 'aeolian', harm: 'harmonic', drone: [-24, -12], dronePeak: 0.04, droneCut: 200,
    form: ['A', 'A', 'B'],
    sec: {
      A: { bars: 8, prog: [0, [-2, 2, 5], 5, 0, 4, 3, 0, 4], parts: [
        { d: 'taiko', p: 'X...X...X...X...', v: 0.5, a: [58] },
        { d: 'snare', p: '....x.......x.xx', v: 0.09 },
        { d: 'anvil', p: bars(2, 'X'), v: 0.08, a: [520] },
        { d: 'rim', p: 'x.x.x.x.x.x.x.x.', v: 0.035 },
        { b: 'stac', p: '1.1.1.1.1.1.5.1.', o: -12, v: 0.05 },
        { c: 'pad', p: bars(2, 'X'), v: 0.04, vowel: 'o' },
        { m: 'horn', o: 0, v: 0.03, res: 4, l: ['2120', '1a0.', '2321', '0a0.', '4545', '7.65', '2120', '1a0.'] },
        { m: 'pad', o: 12, v: 0.035, res: 4, vowel: 'a', min: 1, l: ['2120', '1a0.', '2321', '0a0.', '4545', '7.65', '2120', '1a0.'] },
        { b: 'stac', p: '1111111111111111', o: 0, v: 0.025, min: 1 },
        { d: 'taiko', p: '..x...x...x...xx', v: 0.3, a: [80], min: 2 },
      ] },
      B: { bars: 4, prog: [0, 0, 0, 0], parts: [
        { d: 'heart', p: 'X.......X.......', v: 0.25 },
        { d: 'rim', p: 'x...x...x...x...', v: 0.04 },
        { c: 'pad', p: bars(4, 'X'), v: 0.05, vowel: 'u' },
        { d: 'snare', p: 'xxxxxxxxxxxxxxxx', v: 0.05, bars: [3] },
        { d: 'taiko', p: 'X...X...X...X...', v: 0.4, a: [58], min: 1 },
      ] },
    },
  }),

  // ======================================================= the Moonlit Bailey (A dorian)
  'explore:courtyard': song({
    bpm: 78, gain: 3.33, root: 45, scale: 'dorian', drone: [-12, -5], dronePeak: 0.028, droneCut: 300,
    form: ['A', 'M', 'B', 'M'],
    sec: {
      A: { bars: 8, prog: [0, 3, 0, 6, 2, 6, 3, 0], parts: [
        { b: 'harp', p: '1.5.8.5.3.8.5.8.', o: 12, v: 0.04 },
        { c: 'pad', p: bars(2, 'X'), v: 0.03, vowel: 'a', o: 12 },
        { d: 'shaker', p: '.......x.......x', v: 0.02, prob: 0.3 },
      ] },
      M: { bars: 8, prog: [0, 3, 0, 6, 2, 6, 3, 0], parts: [
        { b: 'harp', p: '1.5.8.5.3.8.5.8.', o: 12, v: 0.035 },
        { c: 'pad', p: bars(2, 'X'), v: 0.028, vowel: 'a', o: 12 },
        { m: 'flute', o: 24, v: 0.035, l: ['4...2.0.', '3...5.3.', '4.5.4.2.', '6...8.6.', '2...4.7.', '6...8.A.', 'A...7.5.', '7.......'], alts: [['7...4.2.', '5...3...', '4...2.4.', '8...6...', '6...4.2.', 'A...8...', '7...5.3.', '4.......']] },
        { d: 'taiko', p: bars(2, 'X'), v: 0.15, a: [60] },
      ] },
      B: { bars: 8, prog: [4, 2, 6, 3, 4, 2, 3, 3], parts: [
        { b: 'harp', p: '1...5...8...5...', o: 12, v: 0.035 },
        { c: 'pad', p: bars(2, 'X'), v: 0.03, vowel: 'o', o: 12 },
        { m: 'cello', o: 12, v: 0.045, l: ['4...6.4.', '2...4...', '1...3.6.', '3...0.3.', '4...6.8.', '9...6.4.', '7...A.8.', '3.......'] },
        { d: 'shaker', p: '.......x.......x', v: 0.02, prob: 0.3 },
      ] },
    },
  }),
  'combat:courtyard': song({
    bpm: 122, gain: 2.65, root: 45, scale: 'harmonic', drone: [-12], dronePeak: 0.035, droneCut: 220,
    form: ['A', 'B', 'A', 'B'],
    sec: {
      A: { bars: 4, prog: [0, 5, 3, 4], parts: [
        { d: 'snare', p: 'x..x..x.x.xxx.x.', v: 0.08 },
        { d: 'kick', p: 'X.......X.....x.', v: 0.45 },
        { d: 'taiko', p: 'X...............', v: 0.35, a: [66] },
        { b: 'stac', p: '1.1.1.1.5.5.8.5.', o: 0, v: 0.045 },
        { c: 'horn', p: bars(1, 'X'), o: 12, v: 0.02 },
        { d: 'cymbal', p: bars(4, 'X'), v: 0.03 },
      ] },
      B: { bars: 4, prog: [3, 0, 4, 4], parts: [
        { d: 'snare', p: 'x..x..x.x.xxx.x.', v: 0.08 },
        { d: 'kick', p: 'X.......X.....x.', v: 0.45 },
        { b: 'stac', p: '1.1.1.1.5.5.8.5.', o: 0, v: 0.04 },
        { m: 'brass', o: 12, v: 0.028, l: ['3.3.5.7.', '7.4.2.0.', '4...6.8.', '4.......'] },
        { d: 'tom', p: R('.'.repeat(16), 3) + '........x.x.xxxx', n: [150, 130, 115, 100, 90, 80], v: 0.3 },
      ] },
    },
  }),
  // the Stone Wyvern: wingbeats in the drums, a horn call over the battlements
  'boss:stoneWyvern': song({
    bpm: 144, gain: 1.65, root: 45, scale: 'harmonic', drone: [-12, -5], dronePeak: 0.04, droneCut: 260,
    form: ['A', 'A', 'B'],
    sec: {
      A: { bars: 8, prog: [0, 5, 3, 4, 0, 5, [3, 7, 10], 4], parts: [
        { d: 'taiko', p: 'X..X..X.X.X.X...', v: 0.55, a: [56] },
        { d: 'tom', p: R('.'.repeat(16), 3) + '............xxxx', n: [140, 120, 100, 85], v: 0.32 },
        { d: 'frame', p: '....x.......x...', v: 0.2 },
        { d: 'cymbal', p: bars(8, 'X'), v: 0.04 },
        { b: 'stac', p: '1.11.11.1.11.15.', o: -12, v: 0.04 },
        { c: 'brass', p: 'X.....X...X.....', o: -12, v: 0.02 },
        { c: 'pad', p: bars(2, 'X'), v: 0.045, vowel: 'o', o: 12 },
        { m: 'horn', o: 12, v: 0.028, res: 4, l: ['4.7.', '5.7.', '3.5.', '4.6.', '7.9.', '9.7.', '9.4.', '4...'] },
        { m: 'pad', o: 24, v: 0.03, res: 4, vowel: 'a', min: 1, l: ['4.7.', '5.7.', '3.5.', '4.6.', '7.9.', '9.7.', '9.4.', '4...'] },
        { b: 'stac', p: '1111111111111111', o: 0, v: 0.022, min: 2 },
      ] },
      B: { bars: 4, prog: [5, [3, 7, 10], 3, 4], parts: [
        { c: 'pad', p: bars(2, 'X'), v: 0.05, vowel: 'o' },
        { d: 'taiko', p: 'X.......X.......', v: 0.45, a: [52] },
        { b: 'glass', p: '8...............', o: 12, v: 0.02 },
        { f: (m, s, bar, t) => { if (bar === 3 && s === 0) I.swell(m, t, m.spb * 16, 0.1); } },
        { d: 'taiko', p: '..x...x...x...x.', v: 0.3, a: [70], min: 1 },
      ] },
    },
  }),

  // ======================================================= the Hall of Whispers (B harmonic minor)
  'explore:keep': song({
    bpm: 74, gain: 2.77, root: 47, scale: 'harmonic', harm: 'harmonic', drone: [-12, -5], dronePeak: 0.03, droneCut: 250,
    form: ['A', 'M', 'B', 'M'],
    sec: {
      A: { bars: 8, prog: [0, 5, 3, 4, 0, 5, [3, 7, 10], 4], parts: [
        { b: 'celesta', p: '1.3.5.8.5.3.5.3.', o: 24, v: 0.025 },
        { c: 'pad', p: bars(2, 'X'), v: 0.035, vowel: 'e', o: 12 },
        { b: 'pluck', p: '1.......5.......', o: -12, v: 0.055 },
      ] },
      M: { bars: 8, prog: [0, 5, 3, 4, 0, 5, [3, 7, 10], 4], parts: [
        { b: 'celesta', p: '1...5...8...5...', o: 24, v: 0.022 },
        { c: 'pad', p: bars(2, 'X'), v: 0.03, vowel: 'e', o: 12 },
        { b: 'pluck', p: '1.......5.......', o: -12, v: 0.05 },
        { m: 'flute', o: 12, v: 0.035, l: ['2...0.2.', '2...5.2.', '3...5.7.', '4...6.4.', '7...4.2.', '5...7.9.', '2...4.2.', '6...4.1.'] },
      ] },
      B: { bars: 8, prog: [3, 0, 5, 4, 3, 0, 4, 4], parts: [
        { b: 'harpsi', p: '1.3.5.3.1.3.5.3.', o: 12, v: 0.022 },
        { c: 'pad', p: bars(2, 'X'), v: 0.035, vowel: 'e', o: 12 },
        chance(0.02, (m, t, X) => I.bell(m, t, X.root + 24 + pick([0, 7, 12]), 0.025, 4)),
        { b: 'cello', p: '1...............', o: -12, v: 0.035 },
      ] },
    },
  }),
  'combat:keep': song({
    bpm: 128, gain: 2.21, root: 47, scale: 'harmonic', drone: [-12], dronePeak: 0.035, droneCut: 220,
    form: ['A', 'A', 'B', 'A'],
    sec: {
      A: { bars: 4, prog: [0, 0, 3, 4], parts: [
        { b: 'harpsi', p: '1358535813583531', o: 12, v: 0.025 },
        { b: 'stac', p: '1...1...1...1.5.', o: -12, v: 0.05 },
        { d: 'taiko', p: 'X.....X...X.....', v: 0.45, a: [64] },
        { d: 'frame', p: '....x.......x...', v: 0.17 },
        { d: 'shaker', p: 'xxxxxxxxxxxxxxxx', v: 0.022, prob: 0.6 },
        { c: 'pad', p: bars(4, 'X'), v: 0.03, vowel: 'a' },
      ] },
      B: { bars: 4, prog: [5, 3, 4, 4], parts: [
        { b: 'harpsi', p: '1358535813583531', o: 12, v: 0.02 },
        { b: 'stac', p: '1.1.1.1.1.1.5.5.', o: -12, v: 0.045 },
        { d: 'taiko', p: 'X.....X...X.....', v: 0.45, a: [64] },
        { m: 'fiddle', o: 12, v: 0.035, l: ['5.4.5.7.', '3.4.5.3.', '4.6.8.6.', '4.......'] },
        { d: 'tom', p: R('.'.repeat(16), 3) + '........xx.xxxxx', n: [160, 140, 120, 105, 95, 85, 75, 70], v: 0.28 },
      ] },
    },
  }),
  // the Court Archmage: an organ toccata in D minor, choir and arcane glass
  'boss:courtArchmage': song({
    bpm: 136, gain: 2.71, root: 50, scale: 'harmonic', harm: 'harmonic', drone: [-24, -12], dronePeak: 0.035,
    form: ['A', 'A', 'B'],
    sec: {
      A: { bars: 8, prog: [0, 0, 3, 4, 0, 0, 5, 4], parts: [
        { b: 'harpsi', p: '8531853185318535', o: 12, v: 0.022 },
        { c: 'organ', p: bars(1, 'X'), o: -12, v: 0.016 },
        { d: 'taiko', p: 'X.......X.x.....', v: 0.5, a: [58] },
        { d: 'kick', p: '.....x.....x....', v: 0.3 },
        { c: 'pad', p: bars(2, 'X'), v: 0.04, vowel: 'a', o: 12 },
        { m: 'brass', o: 12, v: 0.025, l: ['7.6.7...', '4.3.2.1.', '3...5.7.', '6...4...', '7.6.7...', '9.8.7.6.', '5...7.9.', '4.......'] },
        { d: 'snare', p: '....x.......x.x.', v: 0.07, min: 1 },
        { b: 'stac', p: '1.1.1.1.1.1.1.1.', o: -12, v: 0.035, min: 1 },
        chance(0.025, (m, t, X) => I.glass(m, t, X.root + 24 + pick(X.chord), 0.02, 3), { min: 0 }),
      ] },
      B: { bars: 4, prog: [5, 3, 4, 4], parts: [
        { b: 'celesta', p: '1358135813581358', o: 24, v: 0.018 },
        { c: 'pad', p: bars(2, 'X'), v: 0.05, vowel: 'o' },
        { d: 'heart', p: 'X.......X.......', v: 0.25 },
        { b: 'glass', p: '5...............', o: 12, v: 0.02 },
        { d: 'taiko', p: 'X.....X...X.....', v: 0.4, a: [58], min: 1 },
      ] },
    },
  }),

  // ======================================================= the Hollow Throne (F minor)
  'explore:throne': song({
    bpm: 58, gain: 2.33, root: 41, scale: 'harmonic', harm: 'harmonic', drone: [-12, -5], dronePeak: 0.035, droneCut: 200,
    form: ['A', 'M', 'A', 'M'],
    sec: {
      A: { bars: 8, prog: [0, 3, 5, 4, 0, 5, 3, 4], parts: [
        { c: 'organ', p: bars(1, 'X'), o: 0, v: 0.016 },
        every(2, (m, t, X) => I.gong(m, t, mtof(X.root + 12), 0.055, 5)),
        { c: 'pad', p: bars(2, 'X'), v: 0.035, vowel: 'o', o: 12 },
        { b: 'harp', p: '1...5...8.......', o: 12, v: 0.03 },
      ] },
      M: { bars: 8, prog: [0, 3, 5, 4, 0, 5, 3, 4], parts: [
        { c: 'organ', p: bars(1, 'X'), o: 0, v: 0.014 },
        every(2, (m, t, X) => I.gong(m, t, mtof(X.root + 12), 0.05, 5)),
        { c: 'pad', p: bars(2, 'X'), v: 0.03, vowel: 'o', o: 12 },
        { m: 'cello', o: 12, v: 0.045, l: ['4...2.0.', '3...5.3.', '5...7.9.', '4...6.8.', '7...4.2.', '5...9.7.', 'A...C.A.', '6.......'] },
      ] },
    },
  }),
  'combat:throne': song({
    bpm: 118, gain: 1.97, root: 41, scale: 'harmonic', drone: [-12], dronePeak: 0.035, droneCut: 200,
    form: ['A', 'B', 'A', 'B'],
    sec: {
      A: { bars: 4, prog: [0, 0, 5, 4], parts: [
        { d: 'timp', p: 'X...x...X...x.x.', v: 0.35, o: 0 },
        { c: 'brass', p: 'X.....X.X.......', o: 12, v: 0.02 },
        { b: 'stac', p: '1.1.1.1.3.3.5.5.', o: 12, v: 0.04 },
        { d: 'snare', p: '....x.......x...', v: 0.07 },
        { d: 'cymbal', p: bars(4, 'X'), v: 0.03 },
        { c: 'pad', p: bars(2, 'X'), v: 0.035, vowel: 'a', o: 12 },
      ] },
      B: { bars: 4, prog: [3, 5, 4, 4], parts: [
        { d: 'timp', p: 'X...x...X...x.x.', v: 0.35, o: 0 },
        { b: 'stac', p: '1.1.1.1.3.3.5.5.', o: 12, v: 0.035 },
        { d: 'snare', p: '....x.......x.xx', v: 0.07 },
        { m: 'horn', o: 12, v: 0.028, l: ['3...5.7.', '9.7.5.4.', '4...6.8.', '4.......'] },
        { c: 'pad', p: bars(2, 'X'), v: 0.035, vowel: 'a', o: 12 },
      ] },
    },
  }),
  // the Hollow King: the whole court plays his anthem; a Neapolitan crown at its height
  'boss:hollowKing': song({
    bpm: 120, gain: 1.69, root: 41, scale: 'harmonic', harm: 'harmonic', drone: [-12, -5, 0], dronePeak: 0.035,
    form: ['A', 'A', 'B'],
    sec: {
      A: { bars: 8, prog: [0, 5, 3, 4, 0, 5, [1, 5, 8], 4], parts: [
        { d: 'timp', p: 'X..x..X.X..x..X.', v: 0.38, o: 0 },
        { d: 'taiko', p: 'X.......X.......', v: 0.5, a: [52] },
        { d: 'snare', p: '....x.......x.x.', v: 0.08, min: 1 },
        { d: 'cymbal', p: bars(8, 'X'), v: 0.04 },
        { c: 'organ', p: bars(1, 'X'), o: -12, v: 0.016 },
        { c: 'brass', p: 'X.....X.....X...', o: 0, v: 0.02, min: 1 },
        { c: 'pad', p: bars(1, 'X'), v: 0.04, vowel: 'a', o: 12 },
        { m: 'horn', o: 12, v: 0.03, res: 4, l: ['0.4.', '5.9.', '3.5.', '4.6.', '7.4.', '9.7.', 'C...', '6...'] },
        { m: 'pad', o: 24, v: 0.03, res: 4, vowel: 'o', min: 1, l: ['0.4.', '5.9.', '3.5.', '4.6.', '7.4.', '9.7.', 'C...', '6...'] },
        { b: 'stac', p: '1111111111111111', o: 0, v: 0.022, min: 2 },
        { d: 'taiko', p: '..x...x...x...xx', v: 0.3, a: [76], min: 2 },
      ] },
      B: { bars: 4, prog: [0, 0, 5, 4], parts: [
        { d: 'heart', p: 'X.......X.......', v: 0.25 },
        { c: 'pad', p: bars(2, 'X'), v: 0.05, vowel: 'u' },
        every(2, (m, t, X) => I.gong(m, t, mtof(X.root + 12), 0.07, 6)),
        { b: 'glass', p: '8...............', o: 12, v: 0.02 },
        { d: 'timp', p: 'X...X...X...X...', v: 0.3, o: 0, min: 1 },
      ] },
    },
  }),

  // ======================================================= the Abyss (C# locrian)
  'explore:abyss': song({
    bpm: 52, gain: 2.10, root: 49, scale: 'locrian', drone: [-24, -18], dronePeak: 0.035, droneCut: 200,
    form: ['A'],
    sec: {
      A: { bars: 8, prog: [[0, 3, 6], [1, 5, 8], [0, 3, 6], [-1, 3, 6]], parts: [
        { c: 'pad', p: bars(4, 'X'), v: 0.04, vowel: 'u' },
        { d: 'heart', p: bars(2, 'X'), v: 0.2 },
        { f: (m, s, bar, t) => { if (bar % 4 === 3 && s === 8) I.swell(m, t, m.spb * 8, 0.08); } },
        chance(0.05, (m, t, X) => I.celesta(m, t, X.root + 24 + pick([0, 1, 3, 6, 8, 12, 13]), 0.02, rnd(-0.6, 0.6))),
        chance(0.012, (m, t, X) => I.glass(m, t, X.root + 12 + pick([0, 6, 13]), 0.018, 5)),
        chance(0.006, (m, t) => I.chains(m, t, 0.025)),
      ] },
    },
  }),
  'combat:abyss': song({
    bpm: 132, gain: 2.36, root: 49, scale: 'locrian', drone: [-24, -18], dronePeak: 0.035, droneCut: 200,
    form: ['A', 'A', 'B'],
    sec: {
      A: { bars: 4, prog: [[0, 3, 6], [0, 3, 6], [1, 5, 8], [0, 3, 6]], parts: [
        { d: 'kick', p: 'X..x..X...X..x..', v: 0.45 },
        { d: 'rim', p: '....x.......x...', v: 0.1 },
        { d: 'anvil', p: '..x.......x.....', v: 0.04, a: [880] },
        { b: 'stac', p: '1.2.1.4.1.2.5.2.', o: -12, v: 0.045 },
        { c: 'pad', p: bars(4, 'X'), v: 0.035, vowel: 'u' },
      ] },
      B: { bars: 4, prog: [[1, 5, 8], [0, 3, 6], [-1, 3, 6], [0, 3, 6]], parts: [
        { d: 'kick', p: 'X.......X.......', v: 0.45 },
        { d: 'taiko', p: 'X.....x...X.....', v: 0.4, a: [54] },
        { b: 'stac', p: '1.1.1.1.1.1.1.1.', o: -12, v: 0.04 },
        { b: 'glass', p: '8...............', o: 12, v: 0.02 },
        { d: 'cymbal', p: bars(4, 'X'), v: 0.03 },
      ] },
    },
  }),
};

// the state a moment of play asks for: explore / combat in a realm, a boss by id
export function themeFor(state, realm, boss) {
  if (state === 'boss' && boss && THEMES['boss:' + boss]) return 'boss:' + boss;
  if ((state === 'explore' || state === 'combat') && realm && THEMES[state + ':' + realm]) return state + ':' + realm;
  return state;
}
