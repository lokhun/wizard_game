/*
 * Arcane Ascent — procedural audio (Web Audio API only, no asset files).
 *
 *   const audio = new GameAudio();
 *   audio.init();                    // on first user gesture (safe to call repeatedly; resumes a suspended context)
 *   audio.ready                      // true once the AudioContext is running
 *   audio.setListener(pos, forward)  // every frame; {x,y,z} objects (e.g. THREE.Vector3)
 *   audio.play(name, { pos, volume=1, pitch=1, reverb })   // one-shot; pos → 3D (HRTF, ref 3, max 40)
 *   const h = audio.loop(name, { pos, volume, pitch, reverb })
 *       h.setPos(p); h.setVolume(v); h.setPitch(p); h.stop(fadeTime = 0.2)
 *   audio.setAmbience('sewers'|'dungeon'|'courtyard'|'keep'|'throne'|'menu'|null)   // 2s crossfade
 *   audio.setMusic('menu'|'explore'|'combat'|'boss'|'victory'|'defeat'|null)          // crossfade
 *   audio.setVolumes({ master, sfx, music, ambience })   // 0..1 each, any subset
 *   audio.setIntensity(x)            // 0..1 danger hint: >0.4 adds heartbeat + lowpass on the mix
 *
 * Names: GameAudio.SOUNDS / GameAudio.LOOPS list every supported one-shot / loop.
 * Unknown names warn once and are ignored. play() never throws; calls before
 * init() are silently ignored (setAmbience/setMusic/setVolumes are remembered).
 * Built-in behaviour: ±~6.5% random pitch, max ~6 concurrent instances per name
 * (extras dropped), same-name stacking within 30ms attenuated, distance culling.
 *
 * Test hooks (not needed by the game): init({ context, manualPump, raw }) lets a
 * test pass an OfflineAudioContext, drive the scheduler via _pump(), and bypass
 * the master dynamics. Files: core.js (DSP + Voice), sfx.js, loops.js,
 * ambience.js, music.js, calib.js (measured per-sound level trims).
 */
import { bufferSteps, irSteps, makeIR, makeCurves, Voice, rnd, clamp } from './core.js';
import { SFX } from './sfx.js';
import { LOOPS } from './loops.js';
import { AMBIENCE } from './ambience.js';
import { MusicPlayer } from './music.js';
import { THEMES } from './themes.js';
import { CALIB } from './calib.js';

const LOOKAHEAD = 0.25;   // seconds scheduled ahead by the pump
const PUMP_MS = 40;
const MAX_VOICES = 96;    // global safety cap for one-shots
const MAX_DIST = 44;      // positional one-shots beyond this are culled

// Each realm's acoustics: the reverb every sound is sent into (makeIR's options, and how much of it
// comes back). The Sewers' brick tunnels ring long and bright; the Oubliette's stone cells are darker
// and closer; the Bailey is open air, a short tail and the slap of its curtain walls; the Keep's
// timber and plaster halls are warm; the Hollow Throne's marble nave goes on and on.
const ACOUSTICS = {
  sewers: { sec: 3.4, rt60: 3.0, o: { bright: 0.95, dark: 0.8, early: { n: 22, t1: 0.06, amp: 0.8 } }, wet: 0.78 },
  dungeon: { sec: 2.6, rt60: 2.1, o: { bright: 0.8, dark: 0.72, early: { n: 16, t1: 0.05, amp: 0.75 } }, wet: 0.7 },
  courtyard: { sec: 2.0, rt60: 1.2, o: { bright: 0.85, dark: 0.7, early: { n: 5, t1: 0.03, amp: 0.4 }, slap: [[0.17, 0.4], [0.29, 0.22]] }, wet: 0.6 },
  keep: { sec: 2.4, rt60: 1.8, o: { bright: 0.74, dark: 0.64, early: { n: 14, t1: 0.07, amp: 0.6 } }, wet: 0.66 },
  throne: { sec: 4.2, rt60: 3.8, o: { bright: 0.95, dark: 0.8, early: { n: 10, t1: 0.12, amp: 0.55 } }, wet: 0.58 },
};

const NOOP_HANDLE = Object.freeze({ setPos() {}, setVolume() {}, setPitch() {}, stop() {}, alive: false });

export class GameAudio {
  static SOUNDS = Object.keys(SFX);
  static LOOPS = Object.keys(LOOPS);
  static AMBIENCES = Object.keys(AMBIENCE);
  static MUSIC_STATES = ['menu', 'explore', 'combat', 'boss', 'victory', 'defeat'];

  constructor() {
    this.ctx = null;
    this._vol = { master: 0.85, sfx: 1, music: 0.5, ambience: 0.6 };
    this._active = new Map();     // name -> live instance count
    this._lastT = new Map();      // name -> last start time
    this._warned = new Set();
    this._voices = 0;
    this._lis = { x: 0, y: 0, z: 0 };
    this._ambId = null; this._amb = null;
    this._musicState = null; this._music = null;
    this._dispose = [];           // [{ t, fn }]
    this._intensity = 0; this._heart = null;
    this._timer = null;
    this._prep = null;
    // build the buffers while the page idles, not on the first click
    if (typeof window !== 'undefined' && window.requestIdleCallback) setTimeout(() => this.prepare(), 0);
  }

  // Synthesis ahead of the first gesture. init() used to build every noise
  // buffer and the reverb impulse in the click that started audio: a 100-300 ms
  // freeze on the first menu click. A context may be created before a gesture
  // (it stays suspended until init resumes it), so the buffers are made a slice
  // per idle callback; a click that beats them finishes the rest on the spot.
  prepare() {
    if (this.ctx || this._prep) return;
    let c;
    try { c = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: 'interactive' }); } catch { return; }
    const P = (this._prep = { ctx: c, buf: {}, steps: null, ir: null });
    // the noise buffers, then the reverb impulse, a few ms per slice
    P.steps = (function* () { yield* bufferSteps(c, P.buf); P.ir = yield* irSteps(c); })();
    const step = () => { if (P.steps?.next().done) P.steps = null; return !!P.steps; };
    const tick = (deadline) => {
      if (this._prep !== P) return;
      // a busy page (the menu renders every frame) leaves little idle time:
      // a timed-out callback still takes one slice
      let more = deadline.didTimeout ? step() : true;
      while (more && deadline.timeRemaining() > 4) more = step();
      if (more) requestIdleCallback(tick, { timeout: 250 });
    };
    requestIdleCallback(tick, { timeout: 250 });
  }

  get ready() { return !!this.ctx && this.ctx.state === 'running'; }

  init(opts = {}) {
    if (this.ctx) {
      if (this.ctx.state === 'suspended' && this.ctx.resume) this.ctx.resume().catch(() => {});
      return;
    }
    const P = this._prep;
    this._prep = null;
    try {
      const AC = typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext);
      this.ctx = opts.context || P?.ctx || new AC({ latencyHint: 'interactive' });
    } catch (e) { console.warn('[audio] Web Audio unavailable', e); this.ctx = null; return; }
    const c = this.ctx;
    // what prepare() got through (a test's own context starts from scratch)
    const own = P?.ctx === c;
    if (P && !own) P.ctx.close?.().catch(() => {});
    const buf = own ? P.buf : {};
    const steps = own ? P.steps : bufferSteps(c, buf);
    if (steps) for (const _ of steps); // eslint-disable-line no-unused-vars
    this._eng = { ctx: c, buf, curve: makeCurves() };

    // Master chain: buses -> intensity lowpass -> master gain -> compressor -> limiter -> out
    this._pre = c.createGain();
    this._lp = c.createBiquadFilter(); this._lp.type = 'lowpass'; this._lp.frequency.value = 20000; this._lp.Q.value = 0;
    this._master = c.createGain();
    this._pre.connect(this._lp); this._lp.connect(this._master);
    if (opts.raw) {
      this._master.connect(c.destination);
    } else {
      const comp = c.createDynamicsCompressor();
      comp.threshold.value = -16; comp.knee.value = 10; comp.ratio.value = 3; comp.attack.value = 0.004; comp.release.value = 0.22;
      const lim = c.createDynamicsCompressor();
      lim.threshold.value = -3; lim.knee.value = 0; lim.ratio.value = 20; lim.attack.value = 0.001; lim.release.value = 0.1;
      const trim = c.createGain(); trim.gain.value = 0.82;
      this._master.connect(comp); comp.connect(lim); lim.connect(trim); trim.connect(c.destination);
      this._comp = comp; this._lim = lim;
    }

    // Buses
    this._sfx = c.createGain(); this._musicBus = c.createGain(); this._ambBus = c.createGain();
    for (const b of [this._sfx, this._musicBus, this._ambBus]) b.connect(this._pre);

    // Shared reverb: per-bus send inputs -> highpass -> convolver -> return
    this._verbIn = c.createGain();
    const hp = c.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 160;
    this._conv = c.createConvolver(); this._conv.buffer = (own && P.ir) || makeIR(c);
    this._verbOut = c.createGain(); this._verbOut.gain.value = 0.7;
    this._verbIn.connect(hp); hp.connect(this._conv); this._conv.connect(this._verbOut); this._verbOut.connect(this._pre);
    this._verbHp = hp; this._room = null;
    this._sfxSend = c.createGain(); this._musicSend = c.createGain(); this._ambSend = c.createGain();
    for (const s of [this._sfxSend, this._musicSend, this._ambSend]) s.connect(this._verbIn);

    this._applyVolumes(true);
    this._setListenerParams();

    if (!opts.manualPump) this._timer = setInterval(() => this._pump(), PUMP_MS);
    if (c.state === 'suspended' && c.resume && !opts.context) c.resume().catch(() => {});

    // Apply states requested before init.
    const amb = this._ambId, mus = this._musicState;
    this._ambId = null; this._musicState = null;
    if (amb) this.setAmbience(amb);
    if (mus) this.setMusic(mus);
    if (this._intensity > 0) this.setIntensity(this._intensity);
  }

  // ------------------------------------------------------------- listener ---
  setListener(pos, forward) {
    if (pos) { this._lis.x = pos.x; this._lis.y = pos.y; this._lis.z = pos.z; }
    if (forward) this._fwd = { x: forward.x, y: forward.y, z: forward.z };
    if (this.ctx) this._setListenerParams();
  }
  _setListenerParams() {
    const L = this.ctx.listener, p = this._lis, f = this._fwd || { x: 0, y: 0, z: -1 };
    const fl = Math.hypot(f.x, f.y, f.z) || 1;
    try {
      if (L.positionX) {
        L.positionX.value = p.x; L.positionY.value = p.y; L.positionZ.value = p.z;
        L.forwardX.value = f.x / fl; L.forwardY.value = f.y / fl; L.forwardZ.value = f.z / fl;
        L.upX.value = 0; L.upY.value = 1; L.upZ.value = 0;
      } else {
        L.setPosition(p.x, p.y, p.z); L.setOrientation(f.x / fl, f.y / fl, f.z / fl, 0, 1, 0);
      }
    } catch { /* degenerate orientation */ }
  }
  _dist(pos) { return Math.hypot(pos.x - this._lis.x, pos.y - this._lis.y, pos.z - this._lis.z); }

  // Build a voice's output chain: out(gain) -> [distance lowpass -> panner | stereo pan] -> dest, out -> reverb send.
  _makeVoice({ t0, dest, send, sendAmt = 0, vol = 1, pos = null, pan, p = 1, sustain = false, alwaysLP = false }) {
    const c = this.ctx, out = c.createGain();
    out.gain.value = vol;
    const v = new Voice(this._eng, out, t0, p, sustain, !!pos);
    v.nodes.push(out);
    let last = out;
    if (pos) {
      const d = this._dist(pos);
      if (alwaysLP || d > 7) {
        const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 0;
        lp.frequency.value = this._distCut(d);
        last.connect(lp); last = lp; v.nodes.push(lp); v.distLP = lp;
      }
      const pn = c.createPanner();
      pn.panningModel = this._voices < 24 ? 'HRTF' : 'equalpower';
      pn.distanceModel = 'inverse'; pn.refDistance = 3; pn.maxDistance = 40; pn.rolloffFactor = 1.1;
      setPannerPos(pn, pos);
      last.connect(pn); last = pn; v.nodes.push(pn); v.panner = pn;
    } else if (pan !== undefined && c.createStereoPanner) {
      const sp = c.createStereoPanner(); sp.pan.value = clamp(pan, -1, 1);
      last.connect(sp); last = sp; v.nodes.push(sp);
    }
    last.connect(dest);
    if (send && sendAmt > 0) {
      const sg = c.createGain(); sg.gain.value = sendAmt;
      out.connect(sg); sg.connect(send); v.nodes.push(sg); v.send = sg;
    }
    return v;
  }
  _distCut(d) { return d <= 6 ? 20000 : 20000 * Math.pow(0.12, clamp((d - 6) / 34, 0, 1)); }

  // ------------------------------------------------------------- one-shots ---
  play(name, opts = {}) {
    const def = SFX[name];
    if (!def) { this._warn(name); return false; }
    if (!this.ctx) return false;
    try {
      const count = this._active.get(name) || 0;
      if (count >= (def.cap ?? 6) || this._voices >= MAX_VOICES) return false;
      const now = this.ctx.currentTime;
      let vol = (opts.volume ?? 1) * (this._noCalib ? 1 : (CALIB[name] ?? 1));
      const lt = this._lastT.get(name);
      if (lt !== undefined && now - lt < 0.03) vol *= 0.55;
      this._lastT.set(name, now);
      let verb = opts.reverb ?? def.verb ?? 0.2;
      const pos = opts.pos || null;
      if (pos) {
        const d = this._dist(pos);
        if (d > MAX_DIST) return false;
        if (opts.reverb === undefined) verb = Math.min(1, verb * (1 + Math.min(1, d / 25)));
      }
      if (vol <= 0.0005) return false;
      const pv = def.pv ?? 0.065;
      const p = (opts.pitch ?? 1) * (1 + rnd(-pv, pv));
      const v = this._makeVoice({ t0: now + 0.005, dest: this._sfx, send: this._sfxSend, sendAmt: verb, vol, pos, p });
      def.fn(v, opts);
      this._active.set(name, count + 1); this._voices++;
      v.finish(() => { this._active.set(name, Math.max(0, (this._active.get(name) || 1) - 1)); this._voices = Math.max(0, this._voices - 1); });
      return true;
    } catch (e) {
      if (!this._warned.has('!' + name)) { this._warned.add('!' + name); console.warn('[audio] play failed', name, e); }
      return false;
    }
  }
  _warn(name) {
    if (this._warned.has(name)) return;
    this._warned.add(name); console.warn(`[audio] unknown sound "${name}" (ignored)`);
  }

  // ----------------------------------------------------------------- loops ---
  loop(name, opts = {}) {
    const def = LOOPS[name];
    if (!def) { this._warn(name); return NOOP_HANDLE; }
    if (!this.ctx) return NOOP_HANDLE;
    try {
      const now = this.ctx.currentTime;
      const vol = (opts.volume ?? 1) * (this._noCalib ? 1 : (CALIB[name] ?? 1));
      const base = this._noCalib ? 1 : (CALIB[name] ?? 1);
      const pos = opts.pos || null;
      const v = this._makeVoice({ t0: now + 0.005, dest: opts._dest || this._sfx, send: this._sfxSend, sendAmt: opts.reverb ?? def.verb ?? 0.2, vol: 0, pos, p: opts.pitch ?? 1, sustain: true, alwaysLP: true });
      v.out.gain.setValueAtTime(0, now);
      v.out.gain.linearRampToValueAtTime(vol, now + 0.12);
      def.fn(v, opts);
      const self = this;
      let alive = true;
      return {
        get alive() { return alive; },
        setPos(p) {
          if (!alive || !p || !v.panner) return;
          setPannerPos(v.panner, p);
          if (v.distLP) v.distLP.frequency.setTargetAtTime(self._distCut(self._dist(p)), self.ctx.currentTime, 0.05);
        },
        setVolume(x) { if (alive) v.out.gain.setTargetAtTime(Math.max(0, x) * base, self.ctx.currentTime, 0.05); },
        setPitch(x) { if (alive) v.setPitch(x / (opts.pitch ?? 1)); },
        stop(fade = 0.2) { if (!alive) return; alive = false; v.release(fade); },
      };
    } catch (e) {
      console.warn('[audio] loop failed', name, e);
      return NOOP_HANDLE;
    }
  }

  // ------------------------------------------------------------- ambience ---
  setAmbience(id) {
    if (id !== null && id !== undefined && !AMBIENCE[id]) { this._warn('ambience:' + id); return; }
    id = id || null;
    if (id === this._ambId) return;
    this._ambId = id;
    if (!this.ctx) return;
    this._setRoom(id);
    const fade = 2, now = this.ctx.currentTime;
    if (this._amb) {
      const old = this._amb; old.alive = false;
      old.gain.gain.cancelScheduledValues(now); old.gain.gain.setValueAtTime(old.gain.gain.value, now);
      old.gain.gain.linearRampToValueAtTime(0, now + fade);
      old.bed.release(fade);
      this._dispose.push({ t: now + fade + 6, fn: () => { try { old.gain.disconnect(); } catch { /* */ } } });
      this._amb = null;
    }
    if (!id) return;
    const A = AMBIENCE[id], g = this.ctx.createGain();
    g.gain.setValueAtTime(0, now); g.gain.linearRampToValueAtTime(A.gain ?? 1, now + fade);
    g.connect(this._ambBus);
    const bed = this._makeVoice({ t0: now + 0.01, dest: g, send: this._ambSend, sendAmt: 0.25, vol: 1, sustain: true });
    try { A.bed(bed); } catch (e) { console.warn('[audio] ambience bed', e); }
    const details = (A.details || []).map((d) => ({ ...d, next: now + rnd(0.5, d.every[1]) }));
    this._amb = { id, gain: g, bed, details, alive: true };
  }
  // the realm's acoustics (ACOUSTICS): a new convolver for its space, wired in where the last one was
  // (a realm changes behind the loading screen, so the old tail is not missed)
  _setRoom(id) {
    const A = ACOUSTICS[id] ?? null;
    if (A === this._room || !this._verbHp) return;
    this._room = A;
    try {
      const c = this.ctx, conv = c.createConvolver();
      conv.buffer = A ? makeIR(c, A.sec, A.rt60, A.o) : makeIR(c);
      this._verbHp.disconnect(); this._conv.disconnect();
      this._verbHp.connect(conv); conv.connect(this._verbOut);
      this._conv = conv;
      this._verbOut.gain.setTargetAtTime(A ? A.wet : 0.7, c.currentTime, 0.1);
    } catch (e) { console.warn('[audio] acoustics', e); }
  }
  _tickAmbience(now) {
    const amb = this._amb;
    if (!amb || !amb.alive) return;
    for (const d of amb.details) {
      if (d.next > now + LOOKAHEAD) continue;
      const t = Math.max(d.next, now + 0.01);
      d.next = t + rnd(d.every[0], d.every[1]);
      if (this._voices >= MAX_VOICES) continue;
      try {
        const v = this._makeVoice({ t0: t, dest: amb.gain, send: this._ambSend, sendAmt: d.verb ?? 0.5, vol: (d.vol ?? 0.5) * rnd(0.6, 1), pan: rnd(-1, 1) * (d.pan ?? 0.8), p: rnd(0.94, 1.06) });
        d.fn(v);
        this._voices++;
        v.finish(() => { this._voices = Math.max(0, this._voices - 1); });
      } catch (e) { console.warn('[audio] ambience detail', e); }
    }
  }

  // ---------------------------------------------------------------- music ---
  // Nightmare's dread colours the music from the next piece on
  setDread(on) {
    on = !!on;
    if (on === !!this.dread) return;
    this.dread = on;
    const s = this._musicState;
    if (s && this._music) { this._musicState = null; this.setMusic(s); }
  }
  setMusic(state) {
    // a realm's or boss's own theme ('combat:sewers', 'boss:executioner'), or a shared piece
    if (state !== null && state !== undefined && !GameAudio.MUSIC_STATES.includes(state) && !THEMES[state]) { this._warn('music:' + state); return; }
    state = state || null;
    if (state === this._musicState) return;
    this._musicState = state;
    if (state && !state.startsWith('boss')) this._musicIntensity = 0;
    if (!this.ctx) return;
    const base = state ? state.split(':')[0] : null;
    const fadeOut = base === 'boss' || base === 'combat' || base === 'victory' || base === 'defeat' ? 1.2 : 2;
    const fadeIn = base === 'combat' || base === 'boss' ? 1.0 : base === 'victory' || base === 'defeat' ? 0.05 : 2;
    if (this._music) {
      const old = this._music, end = old.stop(fadeOut);
      this._dispose.push({ t: end + 8, fn: () => old.dispose() });
      this._music = null;
    }
    if (!state) return;
    const m = new MusicPlayer(this, state, this._musicBus);
    try { m.start(fadeIn); m.tick(LOOKAHEAD); } catch (e) { console.warn('[audio] music start', e); }
    this._music = m;
  }

  // how hard the music drives (a boss's phases: 0, 1, 2): later sections add layers
  setMusicIntensity(n) {
    this._musicIntensity = n;
    if (this._music) this._music.intensity = n;
  }

  // -------------------------------------------------------------- mixing ---
  setVolumes(v = {}) {
    for (const k of ['master', 'sfx', 'music', 'ambience']) {
      if (typeof v[k] === 'number' && isFinite(v[k])) this._vol[k] = clamp(v[k], 0, 1);
    }
    if (this.ctx) this._applyVolumes(false);
  }
  _applyVolumes(instant) {
    const now = this.ctx.currentTime, V = this._vol;
    const set = (param, x) => { if (instant) param.value = x; else param.setTargetAtTime(x, now, 0.05); };
    set(this._master.gain, V.master * V.master);   // perceptual-ish curve
    const s = V.sfx * V.sfx, m = V.music * V.music * 0.9, a = V.ambience * V.ambience;
    set(this._sfx.gain, s); set(this._sfxSend.gain, s);
    set(this._musicBus.gain, m); set(this._musicSend.gain, m);
    set(this._ambBus.gain, a); set(this._ambSend.gain, a);
  }

  setIntensity(x) {
    x = clamp(+x || 0, 0, 1);
    this._intensity = x;
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    const k = clamp((x - 0.45) / 0.55, 0, 1);
    this._lp.frequency.setTargetAtTime(20000 * Math.pow(2000 / 20000, Math.pow(k, 1.3)), now, 0.25);
    if (x > 0.4) {
      if (!this._heart) this._heart = this.loop('loop_heartbeat', { volume: 0 });
      this._heart.setVolume(0.35 + 0.65 * k);
      this._heart.setPitch(1.0 + 0.6 * k);
    } else if (x < 0.35 && this._heart) {
      this._heart.stop(0.8); this._heart = null;
    }
  }

  // Scheduler pump: music steps, ambience details, delayed disposals.
  _pump() {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    try { if (this._music) this._music.tick(LOOKAHEAD); } catch (e) { console.warn('[audio] music', e); }
    this._tickAmbience(now);
    if (this._dispose.length) {
      this._dispose = this._dispose.filter((d) => { if (d.t <= now) { d.fn(); return false; } return true; });
    }
  }

  dispose() {
    if (this._timer) clearInterval(this._timer);
    this._timer = null;
    if (this.ctx && this.ctx.close) this.ctx.close().catch(() => {});
    this.ctx = null;
  }
}

function setPannerPos(pn, p) {
  if (pn.positionX) { pn.positionX.value = p.x; pn.positionY.value = p.y; pn.positionZ.value = p.z; }
  else pn.setPosition(p.x, p.y, p.z);
}

export default GameAudio;
