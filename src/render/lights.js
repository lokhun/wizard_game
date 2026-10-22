import * as THREE from 'three';

// Fixed-size pool of point lights. Changing the number of lights in three.js
// forces shader recompiles, so we keep the count constant and move lights to
// wherever they matter most each frame.
//
// Torches: static sources; the N nearest to the camera get a light, with a
// distance-based fade so lights never pop in or out.
// FX: transient requests (projectiles, explosions) submitted every frame.

const FX_BUDGET = 60, FX_CLUSTER_R2 = 3 * 3;

export class LightPool {
  constructor(scene, { torchCount = 10, fxCount = 8 } = {}) {
    this.scene = scene;
    this.torchLights = [];
    this.fxLights = [];
    for (let i = 0; i < torchCount; i++) {
      const l = new THREE.PointLight(0xff9a40, 0, 14, 1.6);
      l.userData.slot = i;
      scene.add(l);
      this.torchLights.push(l);
    }
    for (let i = 0; i < fxCount; i++) {
      const l = new THREE.PointLight(0xffffff, 0, 10, 1.8);
      scene.add(l);
      this.fxLights.push(l);
    }
    this.torches = []; // {pos, color, intensity, range, seed, flicker, enabled}
    this._reqPool = []; this.nReq = 0; // this frame's requests: _reqPool[0..nReq)
    this.flashes = []; // timed lights {x,y,z,color,intensity,range,life,t}
    this._flashPool = [];
    this._near = []; // the nearest torches, in order (n + 1: the last sets the fade cutoff)
    this._top = []; // the strongest requests, in order
  }

  clearTorches() { this.torches.length = 0; }

  addTorch(pos, opts = {}) {
    const t = {
      pos: pos.clone(),
      color: new THREE.Color(opts.color ?? 0xff8a35),
      intensity: opts.intensity ?? 9,
      range: opts.range ?? 13,
      seed: Math.random() * 100,
      flicker: opts.flicker ?? 1,
      // arena centrepieces (throne, boss braziers) win a light slot from further away
      priority: typeof opts.priority === 'number' ? opts.priority : opts.priority ? 0.15 : 1,
      enabled: true,
      d2: 0,
    };
    this.torches.push(t);
    return t;
  }

  // request a light for this frame only (pooled: dozens of these a frame in a fight)
  request(pos, color, intensity, range = 8) {
    const r = (this._reqPool[this.nReq++] ??= { x: 0, y: 0, z: 0, color: null, intensity: 0, range: 0, score: 0, k: 1 });
    r.x = pos.x; r.y = pos.y; r.z = pos.z; r.color = color; r.intensity = intensity; r.range = range;
  }

  // a timed flash (explosions, impacts)
  flash(pos, color, intensity, range = 8, life = 0.25) {
    if (this.settings?.calm) intensity *= 0.45; // "Reduce flashing"
    const f = this._flashPool.pop() ?? { x: 0, y: 0, z: 0, color: new THREE.Color(), intensity: 0, range: 0, life: 0, t: 0 };
    f.x = pos.x; f.y = pos.y; f.z = pos.z; f.color.set(color); f.intensity = intensity; f.range = range; f.life = life; f.t = 0;
    this.flashes.push(f);
  }

  update(dt, time, cam) {
    const cx = cam.x, cy = cam.y, cz = cam.z;
    // --- torches: the n nearest (weighted) by insertion into a short ordered
    // list, so a frame neither copies nor sorts the realm's few hundred torches
    const ts = this.torches;
    const n = this.torchLights.length;
    const near = this._near;
    near.length = 0;
    for (let i = 0; i < ts.length; i++) {
      const t = ts[i];
      const dx = t.pos.x - cx, dy = t.pos.y - cy, dz = t.pos.z - cz;
      const d2 = t.enabled ? (dx * dx + dy * dy + dz * dz) * t.priority : 1e12;
      t.d2 = d2;
      if (near.length > n && d2 >= near[n].d2) continue;
      let j = near.length < n + 1 ? near.length++ : n;
      while (j > 0 && near[j - 1].d2 > d2) { near[j] = near[j - 1]; j--; }
      near[j] = t;
    }
    const cutoff = near.length > n ? Math.sqrt(near[n].d2) : 1e6;
    for (let i = 0; i < n; i++) {
      const l = this.torchLights[i];
      const t = near[i];
      if (!t || t.d2 > 1e11) { l.intensity = 0; continue; }

      const d = Math.sqrt(t.d2);
      // fade the furthest assigned lights toward the cutoff so swaps are invisible
      const fade = cutoff >= 1e6 ? 1 : Math.min(1, Math.max(0, (cutoff - d) / (cutoff * 0.3)));
      const s = t.seed + time;
      const flick = 1 - t.flicker * (0.12 * (Math.sin(s * 9.1) * 0.5 + 0.5) * (Math.sin(s * 3.7 + 1.3) * 0.5 + 0.5) + 0.06 * Math.sin(s * 23.0));
      l.position.set(t.pos.x + Math.sin(s * 5.3) * 0.03 * t.flicker, t.pos.y + Math.sin(s * 7.1) * 0.03 * t.flicker, t.pos.z);
      l.color.copy(t.color);
      l.intensity = t.intensity * flick * fade;
      l.distance = t.range;
    }

    // --- fx: merge flashes into requests
    for (let i = this.flashes.length - 1; i >= 0; i--) {
      const f = this.flashes[i];
      f.t += dt;
      if (f.t >= f.life) { this.flashes[i] = this.flashes[this.flashes.length - 1]; this.flashes.pop(); this._flashPool.push(f); continue; }
      const k = 1 - f.t / f.life;
      this.request(f, f.color, f.intensity * k * k, f.range);
    }
    // the m strongest (as seen from the camera), in order
    const m = this.fxLights.length;
    const top = this._top;
    top.length = 0;
    for (let i = 0; i < this.nReq; i++) {
      const r = this._reqPool[i];
      const dx = r.x - cx, dy = r.y - cy, dz = r.z - cz;
      const sc = (r.score = r.intensity / (1 + (dx * dx + dy * dy + dz * dz) * 0.02));
      if (top.length >= m && sc <= top[m - 1].score) continue;
      let j = top.length < m ? top.length++ : m - 1;
      while (j > 0 && top[j - 1].score < sc) { top[j] = top[j - 1]; j--; }
      top[j] = r;
    }
    // Overlapping blasts (a fireball, the burn it leaves, the deaths it causes)
    // would add their light up and wash the room white. Lights within a few
    // metres share a budget: one blast keeps its full strength, a pile-up
    // gets no brighter than the strongest of them plus a little.
    for (let i = 0; i < top.length; i++) {
      const a = top[i];
      let sum = 0, mx = 0;
      for (let j = 0; j < top.length; j++) {
        const b = top[j];
        const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
        if (dx * dx + dy * dy + dz * dz < FX_CLUSTER_R2) { sum += b.intensity; if (b.intensity > mx) mx = b.intensity; }
      }
      a.k = sum > 0 ? Math.min(1, Math.max(FX_BUDGET, mx * 1.25) / sum) : 1;
      // a light at your own hand (muzzle flares, a ward you stand in) lights
      // whatever you're pressed against from a hand's breadth: it would blow
      // shiny armour and close walls out to white, so it eases off near the eye
      const dx = a.x - cx, dy = a.y - cy, dz = a.z - cz, dc = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (dc < 2.5) a.k *= 0.35 + 0.65 * Math.max(0, (dc - 0.4) / 2.1);
    }
    for (let i = 0; i < m; i++) {
      const l = this.fxLights[i];
      const r = top[i];
      if (!r) { l.intensity = 0; continue; }

      l.position.set(r.x, r.y, r.z);
      if (r.color.isColor) l.color.copy(r.color); else l.color.setHex(r.color);
      l.intensity = r.intensity * r.k;
      l.distance = r.range;
    }
    this.nReq = 0;
    for (let i = 0; i < m; i++) top[i] = null;
    top.length = 0;
  }
}
