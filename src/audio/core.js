// Core DSP helpers for the procedural audio engine: pre-generated buffers,
// reverb impulse response, distortion curves and the `Voice` node builder that
// every one-shot / loop / music note / ambience detail is assembled with.

export const rnd = (a, b) => a + Math.random() * (b - a);
export const pick = (arr) => arr[(Math.random() * arr.length) | 0];
export const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
export const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);

const FT = {
  lp: 'lowpass', hp: 'highpass', bp: 'bandpass', notch: 'notch',
  peak: 'peaking', ls: 'lowshelf', hs: 'highshelf', ap: 'allpass',
};

// Formants (freq, amp, bandwidth) for choir-ish vowels.
export const VOWELS = {
  a: [[730, 1, 90], [1090, 0.55, 110], [2440, 0.22, 160]],
  o: [[570, 1, 80], [840, 0.5, 100], [2410, 0.15, 160]],
  u: [[300, 1, 70], [870, 0.35, 100], [2240, 0.1, 160]],
  e: [[530, 1, 80], [1840, 0.45, 120], [2480, 0.22, 160]],
};

// ---------------------------------------------------------------- buffers ---

function normRms(d, target) {
  let s = 0;
  for (let i = 0; i < d.length; i++) s += d[i] * d[i];
  const rms = Math.sqrt(s / d.length) || 1;
  const k = target / rms;
  for (let i = 0; i < d.length; i++) d[i] = clamp(d[i] * k, -1, 1);
}
function normPeak(d, target) {
  let p = 0;
  for (let i = 0; i < d.length; i++) p = Math.max(p, Math.abs(d[i]));
  const k = target / (p || 1);
  for (let i = 0; i < d.length; i++) d[i] *= k;
}
const poisson = (rate, sr) => Math.max(1, Math.floor((-Math.log(1 - Math.random()) * sr) / rate));

// The noise and texture buffers every sound draws on (~70 ms of synthesis), as
// a generator that yields between buffers, so it can run in slices while the
// page idles (GameAudio.prepare) instead of all at once on the first click.
export function* bufferSteps(ctx, B) {
  const sr = ctx.sampleRate;
  const mk = (sec) => ctx.createBuffer(1, Math.floor(sec * sr), sr);

  // White noise
  B.white = mk(2);
  { const d = B.white.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; normRms(d, 0.25); }
  yield;

  // Pink noise (Paul Kellet)
  B.pink = mk(3);
  {
    const d = B.pink.getChannelData(0);
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
    for (let i = 0; i < d.length; i++) {
      const w = Math.random() * 2 - 1;
      b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759;
      b2 = 0.969 * b2 + w * 0.153852; b3 = 0.8665 * b3 + w * 0.3104856;
      b4 = 0.55 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.016898;
      d[i] = b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362; b6 = w * 0.115926;
    }
    normRms(d, 0.25);
  }
  yield;

  // Brown noise
  B.brown = mk(3);
  {
    const d = B.brown.getChannelData(0); let last = 0;
    for (let i = 0; i < d.length; i++) { last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02; d[i] = last; }
    normRms(d, 0.25);
  }
  yield;

  // Crackle: sparse decaying noise pops (fire, crunch, electricity)
  B.crackle = mk(3);
  {
    const d = B.crackle.getChannelData(0); let t = 0;
    while (t < d.length) {
      t += poisson(45, sr);
      const amp = Math.pow(Math.random(), 2) * 0.9 + 0.1;
      const L = Math.floor(sr * rnd(0.0004, 0.004));
      for (let j = 0; j < L * 4 && t + j < d.length; j++) d[t + j] += (Math.random() * 2 - 1) * amp * Math.exp(-j / L);
    }
    normPeak(d, 0.95);
  }
  yield;

  // Chain / metal jingle: sparse inharmonic metallic pings
  B.chain = mk(2);
  {
    const d = B.chain.getChannelData(0); let t = 0, slice = 0;
    const ratios = [1, 1.53, 2.31, 3.17];
    while (t < d.length) {
      if (t >= slice) { slice += d.length / 8; yield; } // the heaviest buffer: in eighths
      t += poisson(Math.random() < 0.3 ? 80 : 22, sr);
      const f0 = rnd(1700, 3300), dec = rnd(0.008, 0.03), amp = rnd(0.25, 1);
      const L = Math.floor(dec * 5 * sr);
      for (let k = 0; k < ratios.length; k++) {
        const w = (2 * Math.PI * f0 * ratios[k] * rnd(0.98, 1.02)) / sr, a = amp / (k + 1), dk = dec * sr / (1 + k * 0.6);
        for (let j = 0; j < L && t + j < d.length; j++) d[t + j] += Math.sin(w * j) * a * Math.exp(-j / dk);
      }
    }
    normPeak(d, 0.95);
  }
  yield;

  // Bones / wood clicks
  B.bones = mk(2);
  {
    const d = B.bones.getChannelData(0); let t = 0;
    while (t < d.length) {
      t += poisson(18, sr);
      const f0 = rnd(650, 1700), dec = rnd(0.003, 0.009), amp = rnd(0.3, 1);
      const L = Math.floor(dec * 6 * sr), w = (2 * Math.PI * f0) / sr, w2 = w * 2.37;
      for (let j = 0; j < L && t + j < d.length; j++) {
        const e = Math.exp(-j / (dec * sr));
        d[t + j] += (Math.sin(w * j) + 0.5 * Math.sin(w2 * j) + (j < 40 ? (Math.random() - 0.5) * 1.5 : 0)) * amp * e;
      }
    }
    normPeak(d, 0.95);
  }
  yield;

  // Heartbeat: one "lub-dub" per second (loop + playbackRate = bpm/60)
  B.heart = mk(1);
  {
    const d = B.heart.getChannelData(0);
    const beat = (start, amp, fb) => {
      let ph = 0; const s0 = Math.floor(start * sr);
      for (let j = 0; j < sr * 0.25 && s0 + j < d.length; j++) {
        const tt = j / sr; const env = (1 - Math.exp(-tt / 0.004)) * Math.exp(-tt / 0.06);
        ph += (2 * Math.PI * (fb + 32 * Math.exp(-tt / 0.025))) / sr;
        d[s0 + j] += Math.sin(ph) * env * amp;
      }
    };
    beat(0.01, 1, 46); beat(0.29, 0.7, 54);
    normPeak(d, 0.9);
  }
  yield;
}

export function makeBuffers(ctx) {
  const B = {};
  for (const _ of bufferSteps(ctx, B)); // eslint-disable-line no-unused-vars
  return B;
}

// Dungeon-ish stereo reverb IR: predelay, early reflections, damped diffuse tail.
export function makeIR(ctx, sec = 2.8, rt60 = 2.5, o = {}) {
  const steps = irSteps(ctx, sec, rt60, o);
  let r;
  while (!(r = steps.next()).done);
  return r.value;
}
// the same, yielding every ~0.35 s of samples (a few ms each); returns the buffer
// o (a space's character, all optional): bright (how much of the top end the tail starts with, 0.9),
// dark (how much of it is lost by 1.6 s, 0.82), early ({ n, t1, amp }: the first reflections, n of them
// within t1 s), slap ([[t, amp], ...]: discrete echoes off far walls, e.g. an open yard's curtain walls)
export function* irSteps(ctx, sec = 2.8, rt60 = 2.5, o = {}) {
  const sr = ctx.sampleRate, len = Math.floor(sec * sr);
  const buf = ctx.createBuffer(2, len, sr);
  const pre = Math.floor(0.014 * sr), slice = Math.floor(0.35 * sr);
  const a0 = o.bright ?? 0.9, a1 = o.dark ?? 0.82, E = o.early ?? { n: 14, t1: 0.085, amp: 0.7 };
  const k = Math.pow(10, -3 / (rt60 * sr)); // (the decay, per sample)
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch); let lp = 0, env = 1;
    for (let i = pre; i < len; i++) {
      const t = (i - pre) / sr;
      env *= k;
      const a = a0 - a1 * Math.min(1, t / 1.6); // brighter early, darker late
      lp += a * (Math.random() * 2 - 1 - lp);
      d[i] = lp * env * Math.min(1, t / 0.02) * (1 / Math.sqrt(a + 0.05)) * 0.6;
      if ((i - pre) % slice === slice - 1) yield;
    }
    for (let q = 0; q < E.n; q++) {
      const idx = pre + Math.floor(rnd(0.004, E.t1) * sr);
      d[idx] += rnd(-E.amp, E.amp) * (1 - q / (E.n + 2));
    }
    // a far wall's echo: a short smeared burst, darker than the sound that made it
    for (const [t, amp] of o.slap ?? []) {
      const i0 = pre + Math.floor((t + (ch ? 0.006 : 0)) * sr), n = Math.floor(0.03 * sr);
      let l2 = 0;
      for (let i = 0; i < n && i0 + i < len; i++) { l2 += 0.35 * (Math.random() * 2 - 1 - l2); d[i0 + i] += l2 * amp * (1 - i / n) * 2.2; }
    }
    const fade = Math.floor(0.1 * sr);
    for (let i = 0; i < fade; i++) d[len - 1 - i] *= i / fade;
  }
  return buf;
}

export function makeCurves() {
  const curves = {};
  for (const k of [1.5, 3, 6, 12]) {
    const n = 2048, c = new Float32Array(n), nm = Math.tanh(k);
    for (let i = 0; i < n; i++) { const x = (i / (n - 1)) * 2 - 1; c[i] = Math.tanh(k * x) / nm; }
    curves[k] = c;
  }
  return (drive) => curves[drive <= 2 ? 1.5 : drive <= 4 ? 3 : drive <= 8 ? 6 : 12];
}

// ------------------------------------------------------------------ Voice ---
// A Voice is a group of synthesized components that share an output node
// (`out`, built by GameAudio with panning/reverb send). Component options:
//  common: t (offset s), dur, a (attack), hold, peak, lin (linear release),
//          rev (reverse-ish swell), once (in sustain voices: one-shot layer),
//          filt ({type,f,f2,ft,f3,q,gain,fixed,lfo:{rate,depth}} or array),
//          drive (waveshaper), trem ({rate,depth,type}), pan, dest
//  noise:  buf ('white'|'pink'|'brown'|'crackle'|'chain'|'bones'|'heart'), rate, rate2, offset
//  osc:    type, f, f2, ft, f3, glide ('exp'|'lin'), detune, vib ({rate,depth}), mod ({ratio,index,index2})
export class Voice {
  constructor(eng, out, t0, p = 1, sustain = false, positional = false) {
    this.e = eng; this.c = eng.ctx; this.out = out; this.t0 = t0; this.p = p;
    this.sustain = sustain; this.positional = positional;
    this.nodes = []; this.srcs = []; this.held = []; this.pitched = [];
    this.end = 0; this.last = null; this.panner = null; this.distLP = null; this.send = null;
  }
  _n(n) { this.nodes.push(n); return n; }
  _src(s, t, dur, offset, once) {
    if (offset !== undefined) s.start(t, offset); else s.start(t);
    this.srcs.push(s);
    if (this.sustain && !once) this.held.push(s);
    if (!this.sustain || once) {
      const e = t + dur + 0.03; s.stop(e);
      if (e >= this.end) { this.end = e; this.last = s; }
    }
  }
  _env(param, t, o, dur, peak) {
    peak = Math.max(1e-4, peak);
    if (this.sustain && !o.once) {
      param.setValueAtTime(0, t); param.linearRampToValueAtTime(peak, t + Math.max(0.01, o.a ?? 0.08)); return;
    }
    if (o.rev) {
      param.setValueAtTime(peak * 0.001, t);
      param.exponentialRampToValueAtTime(peak, t + dur * 0.93);
      param.linearRampToValueAtTime(0, t + dur); return;
    }
    const a = Math.max(0.001, o.a ?? 0.003), hold = o.hold || 0;
    const end = Math.max(t + a + hold + 0.005, t + dur);
    param.setValueAtTime(0, t);
    param.linearRampToValueAtTime(peak, t + a);
    if (hold > 0) param.setValueAtTime(peak, t + a + hold);
    if (o.lin) param.linearRampToValueAtTime(0, end);
    else { param.exponentialRampToValueAtTime(peak * 0.001, end); param.setValueAtTime(0, end + 0.002); }
  }
  lfo(param, rate, depth, t = this.t0, dur = 1, type = 'sine', once = false) {
    const o = this._n(this.c.createOscillator()); o.type = type; o.frequency.value = rate;
    const g = this._n(this.c.createGain()); g.gain.value = depth;
    o.connect(g); g.connect(param);
    this._src(o, t, dur, undefined, once);
    return o;
  }
  _filters(spec, t, dur, n, once) {
    if (!spec) return n;
    const nyq = this.c.sampleRate * 0.45;
    for (const s of Array.isArray(spec) ? spec : [spec]) {
      const f = this._n(this.c.createBiquadFilter());
      f.type = FT[s.type] || s.type || 'lowpass';
      const k = s.fixed ? 1 : this.p, cf = (x) => clamp(x * k, 20, nyq);
      f.frequency.setValueAtTime(cf(s.f), t);
      if (s.f2 !== undefined) {
        const te = t + Math.min(s.ft ?? dur, dur);
        if (s.lin) f.frequency.linearRampToValueAtTime(cf(s.f2), te);
        else f.frequency.exponentialRampToValueAtTime(cf(s.f2), te);
        if (s.f3 !== undefined) f.frequency.exponentialRampToValueAtTime(cf(s.f3), Math.max(te + 0.01, t + dur));
      }
      if (s.q !== undefined) f.Q.value = s.q;
      if (s.gain !== undefined) f.gain.value = s.gain;
      if (s.lfo) this.lfo(f.frequency, s.lfo.rate, s.lfo.depth * k, t, dur, s.lfo.type, once);
      if (!s.fixed) this.pitched.push(f);
      n.connect(f); n = f;
    }
    return n;
  }
  _shape(n, drive) {
    const ws = this._n(this.c.createWaveShaper());
    ws.curve = this.e.curve(drive); ws.oversample = drive >= 6 ? '2x' : 'none';
    n.connect(ws); return ws;
  }
  _out(n, o, t, dur, peak) {
    const g = this._n(this.c.createGain()); g.gain.value = 0;
    this._env(g.gain, t, o, dur, peak);
    n.connect(g); let last = g;
    if (o.trem) {
      const d = o.trem.depth ?? 0.5, tg = this._n(this.c.createGain());
      tg.gain.value = 1 - d / 2;
      this.lfo(tg.gain, o.trem.rate, d / 2, t, dur, o.trem.type || 'sine', o.once);
      last.connect(tg); last = tg;
    }
    if (o.pan !== undefined && !this.positional && this.c.createStereoPanner) {
      const sp = this._n(this.c.createStereoPanner()); sp.pan.value = clamp(o.pan, -1, 1);
      last.connect(sp); last = sp;
    }
    last.connect(o.dest || this.out);
    return g;
  }

  noise(o) {
    const t = this.t0 + (o.t || 0), dur = o.dur ?? 0.3, k = o.fixed ? 1 : this.p;
    const s = this._n(this.c.createBufferSource());
    s.buffer = this.e.buf[o.buf || 'white']; s.loop = true;
    s.playbackRate.setValueAtTime((o.rate ?? 1) * k, t);
    if (o.rate2 !== undefined) s.playbackRate.exponentialRampToValueAtTime(o.rate2 * k, t + (o.rt ?? dur));
    if (!o.fixed) this.pitched.push(s);
    let n = this._filters(o.filt, t, dur, s, o.once);
    if (o.drive) n = this._shape(n, o.drive);
    this._out(n, o, t, dur, o.peak ?? 0.5);
    this._src(s, t, dur, o.offset ?? Math.random() * (s.buffer.duration - 0.05), o.once);
    return s;
  }

  osc(o) {
    const t = this.t0 + (o.t || 0), dur = o.dur ?? 0.3, k = o.fixed ? 1 : this.p;
    const lin = o.glide === 'lin';
    const ramp = (p, v, te) => (lin ? p.linearRampToValueAtTime(v, te) : p.exponentialRampToValueAtTime(Math.max(1, v), te));
    const glide = (p, mul) => {
      p.setValueAtTime(o.f * k * mul, t);
      if (o.f2 !== undefined) {
        const te = t + Math.min(o.ft ?? dur, dur);
        ramp(p, o.f2 * k * mul, te);
        if (o.f3 !== undefined) ramp(p, o.f3 * k * mul, Math.max(te + 0.01, t + dur));
      }
    };
    const s = this._n(this.c.createOscillator()); s.type = o.type || 'sine';
    glide(s.frequency, 1);
    if (o.detune) s.detune.value = o.detune;
    if (o.vib) this.lfo(s.frequency, o.vib.rate, o.vib.depth * o.f * k, t, dur, 'sine', o.once);
    if (o.mod) {
      const m = o.mod, mo = this._n(this.c.createOscillator());
      mo.type = m.type || 'sine'; glide(mo.frequency, m.ratio);
      const mf = o.f * k * m.ratio, mg = this._n(this.c.createGain());
      mg.gain.setValueAtTime(m.index * mf, t);
      if (m.index2 !== undefined) mg.gain.linearRampToValueAtTime(m.index2 * mf, t + Math.min(m.it ?? dur, dur));
      mo.connect(mg); mg.connect(s.frequency);
      this._src(mo, t, dur, undefined, o.once);
      if (!o.fixed) this.pitched.push(mo);
    }
    if (!o.fixed) this.pitched.push(s);
    let n = this._filters(o.filt, t, dur, s, o.once);
    if (o.drive) n = this._shape(n, o.drive);
    this._out(n, o, t, dur, o.peak ?? 0.3);
    this._src(s, t, dur, undefined, o.once);
    return s;
  }

  // Sine pitch-drop "thump" (kick/body).
  thump(o = {}) {
    const dur = o.dur ?? 0.25;
    return this.osc({ type: 'sine', t: o.t, f: o.f ?? 110, f2: o.f2 ?? 45, ft: dur * 0.45, dur, a: o.a ?? 0.002, peak: o.peak ?? 0.7, dest: o.dest, pan: o.pan, once: o.once, fixed: o.fixed });
  }

  // Additive bell / metal: partials = [[ratio, amp, decayMul], ...]
  bell(o) {
    const parts = o.partials || [[1, 1, 1], [2.76, 0.5, 0.55], [5.4, 0.25, 0.32], [8.93, 0.12, 0.2]];
    for (const [r, amp, dm] of parts) {
      this.osc({ type: 'sine', t: o.t, f: o.f * r, dur: (o.dur ?? 1) * dm, a: o.a ?? 0.002, peak: (o.peak ?? 0.2) * amp, dest: o.dest, pan: o.pan, once: o.once, fixed: o.fixed });
    }
  }

  // Choir-ish pad: detuned saws through a formant filter bank.
  choir(o) {
    const t = this.t0 + (o.t || 0), dur = o.dur ?? 2, c = this.c;
    const env = this._n(c.createGain()); env.gain.value = 0;
    const a = o.a ?? dur * 0.3, rel = o.rel ?? dur * 0.45;
    this._env(env.gain, t, { a, hold: Math.max(0, dur - a - rel), once: o.once }, dur, o.peak ?? 0.2);
    const dest = o.dest || this.out;
    for (const [ff, amp, bw] of VOWELS[o.vowel || 'a']) {
      const bp = this._n(c.createBiquadFilter()); bp.type = 'bandpass'; bp.frequency.value = ff; bp.Q.value = ff / bw;
      const g = this._n(c.createGain()); g.gain.value = amp * 3;
      env.connect(bp); bp.connect(g); g.connect(dest);
    }
    const lp = this._n(c.createBiquadFilter()); lp.type = 'lowpass'; lp.frequency.value = 700;
    const lg = this._n(c.createGain()); lg.gain.value = 0.25;
    env.connect(lp); lp.connect(lg); lg.connect(dest);
    const vib = this._n(c.createOscillator()); vib.frequency.value = rnd(4.6, 5.6);
    const vg = this._n(c.createGain()); vg.gain.value = 9; vib.connect(vg);
    this._src(vib, t, dur, undefined, o.once);
    const k = o.fixed ? 1 : this.p;
    for (const fr of o.freqs) {
      for (const d of o.detunes || [-11, 10]) {
        const s = this._n(c.createOscillator()); s.type = 'sawtooth';
        s.frequency.value = fr * k; s.detune.value = d + rnd(-4, 4);
        vg.connect(s.detune); s.connect(env);
        this._src(s, t, dur, undefined, o.once);
        if (!o.fixed) this.pitched.push(s);
      }
    }
  }

  // Disconnect everything once the last scheduled source ends.
  finish(cb) {
    if (this.sustain) return;
    const done = () => {
      for (const n of this.nodes) { try { n.disconnect(); } catch { /* already */ } }
      this.nodes.length = 0; this.srcs.length = 0; this.pitched.length = 0;
      if (cb) cb();
    };
    if (this.last) this.last.onended = done; else done();
  }

  // For sustained voices (loops / beds): fade out and tear down.
  release(fade = 0.2, cb) {
    const now = this.c.currentTime, g = this.out.gain;
    g.cancelScheduledValues(now); g.setValueAtTime(g.value, now);
    g.linearRampToValueAtTime(0, now + Math.max(0.01, fade));
    const end = now + Math.max(0.01, fade) + 0.05;
    let last = null;
    for (const s of this.held) { try { s.stop(end); last = s; } catch { /* stopped */ } }
    this.held.length = 0;
    this.sustain = false;
    const done = () => { for (const n of this.nodes) { try { n.disconnect(); } catch { /* */ } } this.nodes.length = 0; this.srcs.length = 0; if (cb) cb(); };
    if (last) last.onended = done; else done();
  }

  setPitch(p) {
    const cents = 1200 * Math.log2(Math.max(0.05, p)), now = this.c.currentTime;
    for (const n of this.pitched) n.detune.setTargetAtTime(cents, now, 0.04);
  }
}
