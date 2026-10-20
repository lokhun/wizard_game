import * as THREE from 'three';

// streaks along the swing, brightest at the cutting edge (v = 1)
let _streak = null;
function streakTexture() {
  if (_streak) return _streak;
  const W = 64, H = 128, c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');
  const img = g.createImageData(W, H);
  let seed = 9;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const lines = Array.from({ length: H }, () => 0.35 + rnd() * 0.65);
  for (let y = 0; y < H; y++) {
    const v = y / (H - 1);
    const edge = Math.pow(v, 2.2) + (v > 0.93 ? 0.6 : 0);
    // a few strong streaks, the rest soft
    const l = lines[y] * (0.8 + 0.2 * Math.sin(y * 0.37));
    for (let x = 0; x < W; x++) {
      const u = x / (W - 1);
      const k = Math.min(1, edge * l * (1 - u) * (1 - u) * 1.4);
      const o = (y * W + x) * 4;
      img.data[o] = img.data[o + 1] = img.data[o + 2] = k * 255; img.data[o + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  _streak = new THREE.CanvasTexture(c);
  _streak.wrapS = _streak.wrapT = THREE.ClampToEdgeWrapping;
  return _streak;
}

// Blade trail: a ribbon swept between two points on a blade over the last
// few frames, bright at the blade and fading behind it. Points are in the
// parent's space (the viewmodel root), recorded once per update.
export class BladeTrail {
  constructor(parent, color, n = 14) {
    this.n = n;
    this.a = Array.from({ length: n }, () => new THREE.Vector3());
    this.b = Array.from({ length: n }, () => new THREE.Vector3());
    this.age = new Float32Array(n);
    this.count = 0;
    this.maxAge = 0.09;
    this.k = 0.55; // peak brightness: additive and close to the eye, so keep it low
    const pos = new Float32Array(n * 2 * 3), col = new Float32Array(n * 2 * 3), uv = new Float32Array(n * 2 * 2), idx = [];
    for (let i = 0; i < n - 1; i++) {
      const p = i * 2;
      idx.push(p, p + 1, p + 2, p + 1, p + 3, p + 2);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    g.setIndex(idx);
    this.geo = g;
    this.color = new THREE.Color(color);
    this.mesh = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ map: streakTexture(), vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false }));
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 4;
    this.mesh.visible = false;
    parent.add(this.mesh);
  }

  // active: the blade is mid-swing. a, b: current edge points. Samples age in
  // real time, so a blade that stops leaves no sheet hanging behind it.
  update(dt, active, a, b) {
    for (let i = 0; i < this.count; i++) this.age[i] += dt;
    while (this.count && this.age[this.count - 1] > this.maxAge) this.count--;
    if (active) {
      // shift history back and record the newest sample at the front
      const lastA = this.a[this.n - 1], lastB = this.b[this.n - 1];
      for (let i = this.n - 1; i > 0; i--) { this.a[i] = this.a[i - 1]; this.b[i] = this.b[i - 1]; this.age[i] = this.age[i - 1]; }
      this.a[0] = lastA.copy(a); this.b[0] = lastB.copy(b); this.age[0] = 0;
      this.count = Math.min(this.count + 1, this.n);
    }
    if (this.count < 2) { this.mesh.visible = false; return; }
    this.mesh.visible = true;
    const pos = this.geo.attributes.position.array, col = this.geo.attributes.color.array, uv = this.geo.attributes.uv.array;
    const c = this.color;
    for (let i = 0; i < this.n; i++) {
      const k = Math.min(i, this.count - 1); // unused slots collapse onto the oldest sample
      const A = this.a[k], B = this.b[k], o = i * 6, q = i * 4;
      pos[o] = A.x; pos[o + 1] = A.y; pos[o + 2] = A.z; pos[o + 3] = B.x; pos[o + 4] = B.y; pos[o + 5] = B.z;
      // fades with age; the texture carries the falloff along and across the smear
      const u = Math.min(1, this.age[k] / this.maxAge);
      const w = i < this.count ? (1 - u * 0.5) * this.k : 0;
      for (let j = 0; j < 6; j += 3) { col[o + j] = c.r * w; col[o + j + 1] = c.g * w; col[o + j + 2] = c.b * w; }
      uv[q] = u; uv[q + 1] = 0; uv[q + 2] = u; uv[q + 3] = 1;
    }
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.color.needsUpdate = true;
    this.geo.attributes.uv.needsUpdate = true;
  }

  dispose() { this.geo.dispose(); this.mesh.material.dispose(); this.mesh.removeFromParent(); }
}
