import { T, K_WATER } from '../world/levelgen.js';

// ---------------------------------------------------------------------------
// The world's own sounds. Every open fire on a floor crackles where it burns (a hearth or a campfire
// loudest, a brazier, a wall torch only up close), and the Sewers' water runs: along each channel,
// round the cistern, and splashing down from every outfall. The realm's ambience bed is the room's
// air; these are the things in it, placed, so walking past a hearth or along a channel is heard.
//
// A floor holds hundreds of them; only the nearest few play (each a sustained loop on the 3D panner),
// re-picked a few times a second, faded in and out at the edge of their reach so none ever pops.
// A fire put out (a boss's entrance snuffing the braziers) falls silent with its flame.
// ---------------------------------------------------------------------------

// (levels set against the realms' ambience beds, measured offline: a hearth two metres off sits well
// under the bed's level, a wall torch is heard only beside it)
const KINDS = {
  hearth: { loop: 'loop_hearth', vol: 2.0, reach: 15 },
  brazier: { loop: 'loop_brazier', vol: 1.5, reach: 12 },
  torch: { loop: 'loop_torch', vol: 0.9, reach: 7 },
  stream: { loop: 'loop_stream', vol: 1.6, reach: 15 },
  outfall: { loop: 'loop_outfall', vol: 1.8, reach: 12 },
};
const FIRE_SRC = { fireplace: 'hearth', campfire: 'hearth', brazier: 'brazier', brazierTall: 'brazier', brazierFloor: 'brazier', sconce: 'torch' };
const MAX_ON = 6; // loops playing at once
const PICK_EVERY = 0.25;

export class Soundscape {
  constructor(game) {
    this.game = game; // (its audio starts on the first gesture: read when needed)
    this.list = [];
    this.on = new Map(); // emitter -> { h, k }
    this._t = 0;
  }

  build(level, built) {
    this.dispose();
    const L = [];
    for (const f of built.flames) {
      const kind = f.kind === 'fire' && FIRE_SRC[f.src];
      if (kind) L.push({ kind, x: f.x, y: f.y, z: f.z, flame: f });
    }
    for (const o of built.outfalls ?? []) L.push({ kind: 'outfall', x: o.x, y: o.y - 0.6, z: o.z });
    // the channels: a source every 7 m along each, low over the water
    for (const r of level.rooms) {
      if (r.chan) {
        const c = r.chan, horiz = c.x1 - c.x0 > c.y1 - c.y0;
        const a0 = (horiz ? c.x0 : c.y0) * T, a1 = (horiz ? c.x1 : c.y1) * T, mid = ((horiz ? c.y0 + c.y1 : c.x0 + c.x1) / 2) * T;
        const n = Math.max(1, Math.round((a1 - a0) / 7));
        for (let k = 0; k < n; k++) {
          const a = a0 + (a1 - a0) * (k + 0.5) / n;
          L.push({ kind: 'stream', x: horiz ? a : mid, y: 0, z: horiz ? mid : a });
        }
      } else if (r.flow === 'ring') {
        for (let k = 0; k < 6; k++) {
          const ang = (k / 6) * Math.PI * 2, rad = (Math.min(r.w, r.h) / 2 - 4.5) * T;
          const x = r.cx + Math.cos(ang) * rad, z = r.cz + Math.sin(ang) * rad;
          const i = level.idx(Math.floor(x / T), Math.floor(z / T));
          if (level.kind[i] === K_WATER) L.push({ kind: 'stream', x, y: 0, z });
        }
      }
    }
    this.list = L;
  }

  get audio() { return this.game.audio; }

  update(dt, pos) {
    if (!this.audio?.ctx || !this.list.length) return;
    this._t -= dt;
    if (this._t > 0) return;
    this._t = PICK_EVERY;
    // the nearest few within reach (a fire burning: one put out is skipped, and fades if it was playing)
    const cand = [];
    for (const e of this.list) {
      if (e.flame?.out) continue;
      const K = KINDS[e.kind], d = Math.hypot(e.x - pos.x, e.z - pos.z, (e.y - pos.y) * 0.5);
      if (d < K.reach) cand.push([d / K.reach, e, d]);
    }
    cand.sort((a, b) => a[0] - b[0]);
    const want = new Set(cand.slice(0, MAX_ON).map((c) => c[1]));
    for (const [e, s] of this.on) if (!want.has(e)) { s.h.stop(0.8); this.on.delete(e); }
    for (const [, e, d] of cand.slice(0, MAX_ON)) {
      const K = KINDS[e.kind];
      // full inside 60% of its reach, to nothing at the edge
      const t = Math.min(1, Math.max(0, (K.reach - d) / (K.reach * 0.4)));
      const v = K.vol * t * t * (3 - 2 * t);
      let s = this.on.get(e);
      if (!s) {
        const h = this.audio.loop(K.loop, { pos: { x: e.x, y: e.y, z: e.z }, volume: 0 });
        if (!h.alive) continue;
        s = { h };
        this.on.set(e, s);
      }
      s.h.setVolume(v);
    }
  }

  dispose() {
    for (const s of this.on.values()) s.h.stop(0.5);
    this.on.clear();
    this.list = [];
  }
}
