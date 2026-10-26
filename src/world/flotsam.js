import * as THREE from 'three';
import { T, FLOOR, K_WATER, WATER_Y } from './levelgen.js';

// Flotsam in the Drowned Sewers: planks, sticks and crate shards riding the channels' current (a room's
// flow: along its channel, or wheeling round the cistern's island), bobbing and turning as they go. A
// piece that runs into a bank or slips under a bridge sinks away and is reborn somewhere on the water near
// the eye. One instanced mesh in the wood material (the barrels' program: nothing new compiles), a few
// dozen pieces, nothing allocated per frame.

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _p = new THREE.Vector3(), _s = new THREE.Vector3();

export class Flotsam {
  constructor(scene, level, mats, { quality = 'high' } = {}) {
    this.level = level;
    this.scene = scene;
    // the flowing water: every channel cell with its room
    this.wet = [];
    for (let y = 0; y < level.H; y++) for (let x = 0; x < level.W; x++) {
      const i = level.idx(x, y);
      if (level.cells[i] !== FLOOR || level.kind[i] !== K_WATER) continue;
      const room = level.rooms[level.roomId[i]];
      if (room?.flow) this.wet.push(i);
    }
    const n = this.wet.length ? (quality === 'low' ? 10 : quality === 'medium' ? 18 : 28) : 0;
    this.n = n;
    this.mesh = null;
    if (!n) return;
    this.mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), mats.wood, n);
    this.mesh.frustumCulled = false;
    this.mesh.name = 'flotsam';
    _m.makeScale(0, 0, 0);
    for (let j = 0; j < n; j++) this.mesh.setMatrixAt(j, _m);
    scene.add(this.mesh);
    // per piece: x, z, its size (x, y, z), heading, spin, phase; life (fades in from 0, sinks when < 0)
    this.P = new Float32Array(n * 2); this.S = new Float32Array(n * 3);
    this.H = new Float32Array(n); this.W = new Float32Array(n); this.ph = new Float32Array(n);
    this.k = new Float32Array(n); this.dir = new Int8Array(n);
    for (let j = 0; j < n; j++) { this.k[j] = 0; this.dir[j] = -1; } // (all asleep: placed on the first update)
  }

  _flow(x, z, out) {
    const L = this.level, i = L.idx(Math.floor(x / T), Math.floor(z / T));
    if (L.cells[i] !== FLOOR || L.kind[i] !== K_WATER) return false;
    const room = L.rooms[L.roomId[i]];
    if (!room?.flow) return false;
    if (room.flow === 'ring') { const dx = x - room.cx, dz = z - room.cz, l = Math.hypot(dx, dz) || 1; out.x = -dz / l; out.z = dx / l; }
    else { out.x = room.flow[0]; out.z = room.flow[1]; }
    return true;
  }

  // a new piece somewhere on the moving water near the eye
  _spawn(j, cam) {
    const L = this.level;
    for (let t = 0; t < 24; t++) {
      const i = this.wet[(Math.random() * this.wet.length) | 0];
      const x = (i % L.W + 0.15 + Math.random() * 0.7) * T, z = (Math.floor(i / L.W) + 0.15 + Math.random() * 0.7) * T;
      if ((x - cam.x) ** 2 + (z - cam.z) ** 2 > 18 * 18 && t < 23) continue;
      this.P[j * 2] = x; this.P[j * 2 + 1] = z;
      // a plank, a stick or a shard (its sizes: length, thickness, breadth)
      const r = Math.random(), o = j * 3, S = this.S;
      if (r < 0.45) { S[o] = 0.55 + Math.random() * 0.45; S[o + 1] = 0.06; S[o + 2] = 0.12 + Math.random() * 0.07; }
      else if (r < 0.8) { S[o] = 0.4 + Math.random() * 0.5; S[o + 1] = 0.05; S[o + 2] = 0.05; }
      else { S[o] = 0.2 + Math.random() * 0.14; S[o + 1] = 0.05; S[o + 2] = 0.16 + Math.random() * 0.1; }
      this.H[j] = Math.random() * Math.PI * 2; this.W[j] = (Math.random() - 0.5) * 0.6; this.ph[j] = Math.random() * 6.28;
      this.k[j] = 0.001; this.dir[j] = 1;
      return;
    }
  }

  update(dt, time, cam) {
    if (!this.mesh) return;
    dt = Math.min(dt, 0.05);
    const f = _p;
    for (let j = 0; j < this.n; j++) {
      if (this.dir[j] < 0 && this.k[j] <= 0) { this._spawn(j, cam); continue; }
      let x = this.P[j * 2], z = this.P[j * 2 + 1];
      // too far from the eye to matter: let it go and be reborn nearer
      if ((x - cam.x) ** 2 + (z - cam.z) ** 2 > 26 * 26) this.dir[j] = -1;
      if (this._flow(x, z, f)) {
        const sp = 0.5 + 0.15 * Math.sin(time * 0.7 + this.ph[j]);
        const nx = x + f.x * sp * dt + Math.sin(time * 0.9 + this.ph[j]) * 0.06 * dt, nz = z + f.z * sp * dt + Math.cos(time * 0.8 + this.ph[j]) * 0.06 * dt;
        // the bank or a bridge ahead (a hand past its end): it sinks there
        if (!this._flow(nx + f.x * 0.35, nz + f.z * 0.35, _s)) this.dir[j] = -1;
        else { x = nx; z = nz; this.P[j * 2] = x; this.P[j * 2 + 1] = z; }
        // it swings round to lie along the current, slowly, with a lazy spin of its own
        const want = Math.atan2(f.x, f.z) + Math.PI / 2;
        let d = want - this.H[j]; d -= Math.round(d / Math.PI) * Math.PI;
        this.H[j] += d * dt * 0.4 + this.W[j] * dt;
      } else this.dir[j] = -1;
      this.k[j] = Math.max(0, Math.min(1, this.k[j] + this.dir[j] * dt * 1.6));
      const k = this.k[j], ph = this.ph[j];
      _e.set(Math.sin(time * 1.3 + ph) * 0.08, this.H[j], Math.cos(time * 1.1 + ph) * 0.1);
      _q.setFromEuler(_e);
      _s.set(this.S[j * 3], this.S[j * 3 + 1], this.S[j * 3 + 2]);
      // (bobbing on the surface; sinking under it as it fades)
      _m.compose(f.set(x, WATER_Y + _s.y * 0.3 + Math.sin(time * 2.1 + ph) * 0.012 - (1 - k) * 0.14, z), _q, _s);
      this.mesh.setMatrixAt(j, _m);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  dispose() {
    if (!this.mesh) return;
    this.scene.remove(this.mesh);
    this.mesh.geometry.dispose();
    this.mesh.dispose();
  }
}
