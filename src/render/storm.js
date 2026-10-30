import * as THREE from 'three';

// A storm over an open-air realm (the Moonlit Bailey): rain, and lightning now and then.
// The rain is one mesh of thin streaks in a box that travels with the camera. The CPU never touches
// it after it is built: the vertex shader drops each streak from its seed and the time, wraps it round
// the camera on x and z, and stretches it along the fall. Walls and floors hide it through the depth
// test (it writes no depth). Lightning is a double flash every 12-25 s that the game turns into light
// (flash: 0..1) and draws as a bolt in the sky (onStrike, each flash), with thunder a moment after (onThunder).

const VERT = /* glsl */ `
attribute vec4 aSeed;
uniform vec3 uCam; uniform float uTime; uniform vec3 uBox; uniform float uSpeed; uniform vec2 uWind; uniform float uLen; uniform float uWidth;
varying float vA; varying float vX;
void main(){
  float sp = uSpeed * (0.85 + aSeed.w * 0.3);
  vec3 drift = vec3(uWind.x, 0.0, uWind.y) * uTime;
  vec3 p;
  p.y = uCam.y + uBox.y * 0.45 - mod(aSeed.y * uBox.y + uTime * sp, uBox.y);
  p.x = uCam.x - uBox.x * 0.5 + mod(aSeed.x * uBox.x + drift.x - uCam.x, uBox.x);
  p.z = uCam.z - uBox.z * 0.5 + mod(aSeed.z * uBox.z + drift.z - uCam.z, uBox.z);
  vec3 v = normalize(vec3(uWind.x, -sp, uWind.y));
  vec3 toCam = normalize(cameraPosition - p);
  vec3 side = normalize(cross(v, toCam));
  vec3 w = p + side * position.x * uWidth - v * position.y * uLen * (0.7 + aSeed.w * 0.6);
  // thin at the head, fading up the tail; gone near the box's edges (no pop as streaks wrap) and close up
  float d = length(p.xz - uCam.xz);
  vA = (1.0 - position.y) * (1.0 - smoothstep(uBox.x * 0.32, uBox.x * 0.5, d)) * smoothstep(1.4, 4.5, length(p - cameraPosition));
  // some streaks catch the light and most barely do, and the far ones sink into the night: rain with depth,
  // not a screen of equal lines
  vA *= (0.35 + 0.85 * fract(aSeed.x * 37.31 + aSeed.z * 11.7)) * mix(1.0, 0.4, smoothstep(5.0, 15.0, length(p - cameraPosition)));
  vX = position.x * 2.0;
  gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.0);
}`;
const FRAG = /* glsl */ `
uniform vec3 uColor; uniform float uFlash;
varying float vA; varying float vX;
void main(){
  // (soft across its width: a streak, not a hard-edged line)
  float a = vA * (0.5 + uFlash * 0.9) * (1.0 - vX * vX);
  if (a < 0.004) discard;
  gl_FragColor = vec4(uColor * a, a);
}`;

export class Storm {
  constructor(scene, { count = 2400 } = {}) {
    // one quad per streak: x across (-0.5..0.5), y along (0 head .. 1 tail)
    const pos = new Float32Array(count * 4 * 3), seed = new Float32Array(count * 4 * 4), idx = new Uint32Array(count * 6);
    const corners = [[-0.5, 0], [0.5, 0], [0.5, 1], [-0.5, 1]];
    for (let i = 0; i < count; i++) {
      const s = [Math.random(), Math.random(), Math.random(), Math.random()];
      for (let c = 0; c < 4; c++) {
        const v = i * 4 + c;
        pos[v * 3] = corners[c][0]; pos[v * 3 + 1] = corners[c][1]; pos[v * 3 + 2] = 0;
        seed.set(s, v * 4);
      }
      idx.set([i * 4, i * 4 + 1, i * 4 + 2, i * 4, i * 4 + 2, i * 4 + 3], i * 6);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 4));
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    this.U = {
      uCam: { value: new THREE.Vector3() }, uTime: { value: 0 }, uBox: { value: new THREE.Vector3(34, 16, 34) },
      uSpeed: { value: 17 }, uWind: { value: new THREE.Vector2(1.6, 0.7) }, uLen: { value: 1.15 }, uWidth: { value: 0.032 },
      uColor: { value: new THREE.Color(0.62, 0.7, 0.88) }, uFlash: { value: 0 },
    };
    this.mesh = new THREE.Mesh(geo, new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: FRAG, uniforms: this.U,
      transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
    }));
    this.mesh.frustumCulled = false; // (the box follows the camera; its bounds would be stale)
    this.mesh.name = 'rain';
    this.mesh.renderOrder = 5;
    scene.add(this.mesh);
    this.scene = scene;
    this.flash = 0;
    this._next = 6 + Math.random() * 8; // (the first strike comes soon, so the storm announces itself)
    this._seq = []; // pending flash times (s from now)
    this._t = 0;
    this.onThunder = null;
    this.onStrike = null; // (each flash of a strike: first = the strike's first)
    this._fired = 0;
    this.calm = false; // (reduce flashing: a dim pulse, not a white frame)
  }

  update(dt, time, cam) {
    const U = this.U;
    U.uTime.value = time;
    U.uCam.value.copy(cam);
    this._t += dt;
    // lightning: a strike is two or three flashes a breath apart, then thunder
    this._next -= dt;
    if (this._next <= 0) {
      this._next = 12 + Math.random() * 13;
      this._seq = [0, 0.13 + Math.random() * 0.08];
      if (Math.random() < 0.4) this._seq.push(0.42 + Math.random() * 0.15);
      this._strikeT = this._t; this._fired = 0;
      const delay = 0.6 + Math.random() * 1.8;
      setTimeout(() => this.onThunder?.(delay), delay * 1000);
    }
    let f = 0;
    if (this._seq.length) {
      const since = this._t - this._strikeT;
      while (this._fired < this._seq.length && since >= this._seq[this._fired]) this.onStrike?.(this._fired++ === 0);
      for (const s of this._seq) { const u = since - s; if (u >= 0 && u < 0.35) f = Math.max(f, u < 0.03 ? u / 0.03 : Math.exp(-(u - 0.03) * 14)); }
      if (since > 1.2) this._seq.length = 0;
    }
    this.flash = f * (this.calm ? 0.25 : 1);
    U.uFlash.value = this.flash;
  }

  dispose() {
    this.scene.remove(this.mesh);
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
  }
}
