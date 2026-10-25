import * as THREE from 'three';

// Debris: a smashed barrel's staves and a crate's planks, tumbling out, bouncing on the floor and settling
// before they shrink away. One instanced box in the wood material (the barrels' own program, so nothing
// new compiles), a fixed pool of pieces with a few lines of rigid-ish motion each: gravity, a spin, a
// bounce that bleeds speed off, a wall turning them back, and lying flat once they come to rest.
// Pieces at rest cost nothing until they fade.

const MAX = 64, LIFE = 7, FADE = 1.2;
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _p = new THREE.Vector3(), _s = new THREE.Vector3();
const HALF = Math.PI / 2;

export class Debris {
  constructor(scene, material, collision) {
    this.mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), material, MAX);
    this.mesh.frustumCulled = false; // (pieces fly anywhere; the pool is tiny)
    this.mesh.castShadow = false;
    this.mesh.name = 'debris';
    // (count stays at least 1, a zero-sized piece, so the program compiles with the level's at load)
    _m.makeScale(0, 0, 0);
    for (let i = 0; i < MAX; i++) this.mesh.setMatrixAt(i, _m);
    this.mesh.count = 1;
    scene.add(this.mesh);
    this.scene = scene;
    this.col = collision;
    // per piece: position, velocity, rotation (euler), spin, size, age; rest = settled
    this.P = new Float32Array(MAX * 3); this.V = new Float32Array(MAX * 3);
    this.R = new Float32Array(MAX * 3); this.W = new Float32Array(MAX * 3);
    this.S = new Float32Array(MAX * 3); this.age = new Float32Array(MAX).fill(LIFE + 1);
    this.rest = new Uint8Array(MAX);
    this.next = 0;
    this.live = 0;
  }

  // n pieces of size (sx, sy, sz) +-jitter from around (x, y, z), thrown out at speed and upward
  // (sz the thinnest: a piece comes to rest lying on that side)
  burst(x, y, z, n, sx, sy, sz, speed = 4, up = 3, spread = 0.3) {
    for (let k = 0; k < n; k++) {
      const i = this.next; this.next = (this.next + 1) % MAX;
      const a = Math.random() * Math.PI * 2, j = 0.8 + Math.random() * 0.4;
      const o = i * 3;
      this.P[o] = x + Math.cos(a) * spread; this.P[o + 1] = y + (Math.random() - 0.5) * 0.4; this.P[o + 2] = z + Math.sin(a) * spread;
      const sp = speed * (0.5 + Math.random() * 0.7);
      this.V[o] = Math.cos(a) * sp; this.V[o + 1] = up * (0.6 + Math.random() * 0.8); this.V[o + 2] = Math.sin(a) * sp;
      this.R[o] = Math.random() * 6.28; this.R[o + 1] = Math.random() * 6.28; this.R[o + 2] = Math.random() * 6.28;
      this.W[o] = (Math.random() - 0.5) * 18; this.W[o + 1] = (Math.random() - 0.5) * 10; this.W[o + 2] = (Math.random() - 0.5) * 18;
      this.S[o] = sx * j; this.S[o + 1] = sy * j; this.S[o + 2] = sz * j;
      this.age[i] = 0; this.rest[i] = 0;
    }
    this.live = Math.max(this.live, LIFE + FADE);
  }

  update(dt, floorAt) {
    if (this.live <= -0.5) return; // (a margin: the last pieces' final zeroing)
    this.live -= dt;
    dt = Math.min(dt, 0.05);
    let top = 0, dirty = false;
    for (let i = 0; i < MAX; i++) {
      const age = (this.age[i] += dt);
      if (age > LIFE + FADE) { if (age - dt <= LIFE + FADE) { _m.makeScale(0, 0, 0); this.mesh.setMatrixAt(i, _m); dirty = true; } continue; }
      top = i + 1;
      const o = i * 3, P = this.P, V = this.V, R = this.R, W = this.W;
      if (!this.rest[i]) {
        V[o + 1] -= 16 * dt;
        const nx = P[o] + V[o] * dt, nz = P[o + 2] + V[o + 2] * dt;
        // a wall turns it back (its cell is solid at this height)
        if (this.col?.cellBlocked(Math.floor(nx / 2), Math.floor(P[o + 2] / 2), P[o + 1])) V[o] *= -0.4; else P[o] = nx;
        if (this.col?.cellBlocked(Math.floor(P[o] / 2), Math.floor(nz / 2), P[o + 1])) V[o + 2] *= -0.4; else P[o + 2] = nz;
        P[o + 1] += V[o + 1] * dt;
        R[o] += W[o] * dt; R[o + 1] += W[o + 1] * dt; R[o + 2] += W[o + 2] * dt;
        const gy = floorAt(P[o], P[o + 2]) + this.S[o + 2] * 0.5;
        if (P[o + 1] < gy) {
          P[o + 1] = gy;
          if (V[o + 1] < -1.2) {
            // a bounce: most of the fall lost, skidding, the spin knocked about
            V[o + 1] *= -0.32; V[o] *= 0.55; V[o + 2] *= 0.55;
            W[o] *= -0.5; W[o + 1] *= 0.6; W[o + 2] *= -0.5;
          } else {
            V[o + 1] = 0; V[o] *= 0.8; V[o + 2] *= 0.8; W[o] *= 0.8; W[o + 1] *= 0.8; W[o + 2] *= 0.8;
            if (V[o] * V[o] + V[o + 2] * V[o + 2] < 0.05) this.rest[i] = 1;
          }
        }
        dirty = true;
      } else if (age < LIFE) {
        // settling: tip over onto a broad face (its thin z side up or down: x at a right angle, y at a
        // half turn; z, the spin about the vertical, is free)
        const k = 1 - Math.exp(-10 * dt);
        const tx = Math.round((R[o] - HALF) / Math.PI) * Math.PI + HALF, ty = Math.round(R[o + 1] / Math.PI) * Math.PI;
        R[o] += (tx - R[o]) * k; R[o + 1] += (ty - R[o + 1]) * k;
        if (Math.abs(R[o] - tx) + Math.abs(R[o + 1] - ty) < 2e-3) continue;
      }
      // (fading: shrinks away into the floor)
      const f = age > LIFE ? Math.max(0, 1 - (age - LIFE) / FADE) : 1;
      _e.set(R[o], R[o + 1], R[o + 2]);
      _q.setFromEuler(_e);
      _p.set(P[o], P[o + 1] - (1 - f) * this.S[o + 2], P[o + 2]);
      _s.set(this.S[o] * f, this.S[o + 1] * f, this.S[o + 2] * f);
      _m.compose(_p, _q, _s);
      this.mesh.setMatrixAt(i, _m);
      dirty = true;
    }
    this.mesh.count = Math.max(1, top);
    if (dirty) this.mesh.instanceMatrix.needsUpdate = true;
  }

  dispose() {
    this.scene.remove(this.mesh);
    this.mesh.geometry.dispose();
    this.mesh.dispose();
  }
}
