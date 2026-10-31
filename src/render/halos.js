import * as THREE from 'three';

// ---------------------------------------------------------------------------
// Torch halos: the damp, smoky air round every open flame catching its light.
// Each wall torch, brazier and lantern gets a soft glow standing round its fire
// (a wide scatter and a tighter core), flickering with it, in its colour, as
// strong as the realm's air is thick. Without it a torch down the hall was a
// hard dot; with it the halls have depth and the air has weight.
//
// One draw: an instanced quad per halo, faced to the eye in the vertex shader
// and pulled toward the eye by its own radius, so it stands in front of the wall
// its torch hangs on instead of cutting a hard line into it (there is no scene
// depth to soften against). Fades out close in (walking past a torch never
// veils the lens) and into the fog far off. Halos of flames that go out hide.
// ---------------------------------------------------------------------------

const VERT = /* glsl */ `
uniform float uTime;
uniform float uK;
uniform float uFogDensity;
attribute vec3 iPos;
attribute vec3 iCol;
attribute vec3 iMisc; // radius, seed, on
varying vec2 vP;
varying vec3 vCol;
void main(){
  vec4 mv = viewMatrix * vec4(iPos, 1.0);
  float depth = -mv.z;
  float r = iMisc.x;
  if (iMisc.z < 0.5 || depth < 0.3) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); vCol = vec3(0.0); return; }
  // toward the eye by about its radius (never past the eye), at the same apparent size
  vec3 toEye = normalize(-mv.xyz);
  float pull = min(r * 0.95, depth - 0.25);
  mv.xyz += toEye * pull;
  float s = r * (-mv.z) / depth;
  mv.xy += position.xy * s * 2.0;
  gl_Position = projectionMatrix * mv;
  vP = position.xy * 2.0;
  float seed = iMisc.y;
  float fl = 0.84 + 0.1 * sin(uTime * 7.3 + seed * 13.0) + 0.06 * sin(uTime * 13.7 + seed * 5.0);
  float nearK = smoothstep(0.9, 3.2, depth);
  float fogK = exp(-uFogDensity * uFogDensity * depth * depth * 0.6);
  vCol = iCol * uK * fl * nearK * fogK;
}`;

const FRAG = /* glsl */ `
varying vec2 vP;
varying vec3 vCol;
void main(){
  float r2 = dot(vP, vP);
  if (r2 >= 1.0) discard;
  // a wide soft scatter and a tighter glow at the heart, run to nothing at the rim
  float g = (exp(-r2 * 4.0) * 0.8 + exp(-r2 * 16.0) * 0.45) * (1.0 - r2);
  gl_FragColor = vec4(vCol * g, 1.0);
}`;

const _c = new THREE.Color();

export class TorchHalos {
  constructor(scene) {
    this.scene = scene;
    this.mesh = null;
    this.flames = null;
    this.on = null;
    this.uniforms = { uTime: { value: 0 }, uK: { value: 1 }, uFogDensity: { value: 0.03 } };
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: FRAG, uniforms: this.uniforms,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
  }

  // flames: the level's open fires ({x, y, z, size, kind, color, out}); candles (gpu) and spores have
  // their own glow. biome: its torch colour and fog set the halos' colour and strength.
  build(flames, biome, fogDensity) {
    this.dispose();
    const list = flames.filter((f) => f.kind === 'fire' && f.gpu === undefined);
    this.flames = list;
    if (!list.length) return;
    const n = list.length;
    const pos = new Float32Array(n * 3), col = new Float32Array(n * 3), misc = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const f = list[i];
      pos[i * 3] = f.x; pos[i * 3 + 1] = f.y + 0.12 * (f.size ?? 1); pos[i * 3 + 2] = f.z;
      _c.set(f.color ?? biome.torchColor ?? 0xff8a35);
      // (a little toward warm white at the heart of the colour: scattered firelight, not a tinted card)
      _c.lerp(new THREE.Color(1, 0.82, 0.6), 0.25).multiplyScalar(0.17);
      col[i * 3] = _c.r; col[i * 3 + 1] = _c.g; col[i * 3 + 2] = _c.b;
      misc[i * 3] = 0.6 + (f.size ?? 1) * 1.0; misc[i * 3 + 1] = Math.random() * 10; misc[i * 3 + 2] = f.out ? 0 : 1;
    }
    const geo = new THREE.InstancedBufferGeometry();
    const quad = new THREE.PlaneGeometry(1, 1);
    geo.index = quad.index;
    geo.setAttribute('position', quad.getAttribute('position'));
    geo.setAttribute('iPos', new THREE.InstancedBufferAttribute(pos, 3));
    geo.setAttribute('iCol', new THREE.InstancedBufferAttribute(col, 3));
    this.miscAttr = new THREE.InstancedBufferAttribute(misc, 3);
    geo.setAttribute('iMisc', this.miscAttr);
    geo.instanceCount = n;
    this.on = list.map((f) => !f.out);
    // thicker air scatters more: the strength follows the realm's fog (outdoors, the rain carries it)
    this.uniforms.uK.value = Math.min(1.35, Math.max(0.6, fogDensity / 0.03)) * (biome.haloK ?? 1);
    this.uniforms.uFogDensity.value = fogDensity;
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.name = 'torchHalos';
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 12;
    this.scene.add(this.mesh);
  }

  update(time) {
    if (!this.mesh) return;
    this.uniforms.uTime.value = time;
    // a flame put out takes its halo with it (and a relit one brings it back)
    const L = this.flames, a = this.miscAttr.array;
    let dirty = false;
    for (let i = 0; i < L.length; i++) {
      const on = !L[i].out;
      if (on !== this.on[i]) { this.on[i] = on; a[i * 3 + 2] = on ? 1 : 0; dirty = true; }
    }
    if (dirty) this.miscAttr.needsUpdate = true;
  }

  dispose() {
    if (!this.mesh) return;
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
    this.mesh = null;
    this.flames = null;
  }
}
