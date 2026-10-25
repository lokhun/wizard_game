import * as THREE from 'three';

// Contact shadows: a soft dark disc on the floor under every body. Indoors the
// only shadows were the moon's (courtyard), so a foe lit by torches and spells
// stood on the flagstones without touching them. One instanced quad, one draw,
// the falloff computed in the shader (no texture); a flier's disc fades with its
// height, a corpse's as it sinks, everything's with distance.

const MAX = 128;
const VERT = /* glsl */ `
varying vec2 vUv; varying float vK;
void main(){
  vUv = uv * 2.0 - 1.0;
  vK = instanceColor.r;
  gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
}`;
const FRAG = /* glsl */ `
varying vec2 vUv; varying float vK;
void main(){
  float a = 1.0 - smoothstep(0.1, 1.0, length(vUv));
  a *= a * vK;
  if (a < 0.004) discard;
  gl_FragColor = vec4(0.0, 0.0, 0.0, a);
}`;

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0);

export class ContactShadows {
  constructor(scene) {
    const geo = new THREE.PlaneGeometry(2, 2);
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    });
    this.mesh = new THREE.InstancedMesh(geo, mat, MAX);
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX * 3), 3);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false; // (the instances span the level; the bounds would be stale)
    this.mesh.count = 0;
    this.mesh.name = 'contactShadows';
    scene.add(this.mesh);
    this.n = 0;
    this.strength = 0.6;
  }

  _add(x, y, z, rx, rz, yaw, k) {
    if (this.n >= MAX || k < 0.01) return;
    _p.set(x, y + 0.02, z);
    _q.setFromAxisAngle(_up, yaw);
    _s.set(rx, 1, rz);
    _m.compose(_p, _q, _s);
    _m.toArray(this.mesh.instanceMatrix.array, this.n * 16);
    this.mesh.instanceColor.array[this.n * 3] = k;
    this.n++;
  }

  // gone by 34 m (fog has the room by then; a black disc would show through it)
  _fade(cam, x, z) { const d2 = (x - cam.x) ** 2 + (z - cam.z) ** 2; return d2 < 576 ? 1 : d2 > 1156 ? 0 : 1 - (Math.sqrt(d2) - 24) / 10; }

  update(g) {
    this.n = 0;
    // under the courtyard moon the bodies cast real shadows: the disc only darkens where they touch
    const base = this.strength * (g.moon?.castShadow ? 0.55 : 1);
    const cam = g.renderer.camera.position;
    for (const a of g.actors.list) {
      const m = a.model;
      if (!m || !m.root.visible) continue;
      let k = base * this._fade(cam, a.pos.x, a.pos.z);
      if (k <= 0) continue;
      const gy = g.groundY(a.pos.x, a.pos.z);
      // airborne or hovering: the disc thins and widens as the body rises off it
      const h = Math.max(0, m.root.position.y - gy) + (m.flying ? 0.6 : 0);
      k *= Math.max(0, 1 - h / 3.5);
      let r = a.radius * 1.45 * (1 + Math.min(h, 3) * 0.12);
      if (a.dead) {
        // a fallen body spreads the shadow out; it goes as the body sinks away
        r *= 1 + 0.25 * Math.min(1, a.deadT / 0.8);
        k *= Math.max(0, 1 - (a.sinkT ?? 0) / 0.6);
      }
      const len = a.def?.length ?? m.spec?.length;
      const rz = len ? Math.max(r, len * 0.42) : r;
      this._add(a.pos.x, gy, a.pos.z, r, rz, a.yaw, k);
    }
    for (const pl of g.remotes.values()) {
      if (!pl.avatar?.root.visible) continue;
      const k = base * this._fade(cam, pl.pos.x, pl.pos.z);
      this._add(pl.pos.x, g.groundY(pl.pos.x, pl.pos.z), pl.pos.z, pl.downed || pl.dead ? 0.75 : 0.5, pl.downed || pl.dead ? 0.75 : 0.5, 0, k);
    }
    this.mesh.count = this.n;
    if (this.n) { this.mesh.instanceMatrix.needsUpdate = true; this.mesh.instanceColor.needsUpdate = true; }
  }
}
