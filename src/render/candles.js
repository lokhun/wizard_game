import * as THREE from 'three';

// Candle flames on the GPU. Every candle in a level (a chandelier's ring, a table's row, a candelabra,
// a stand of church candles, and the Hall of Whispers' floating candles) is one instance of a single
// billboard: the vertex shader sets it on its wick, sways it and flickers it from the clock and its own
// seed, and the fragment shader draws the teardrop (a white-hot core, an orange body, a blue foot and a
// warm halo for the bloom to catch). Floating candles also get their wax from one instanced cylinder,
// lit by their own flame, that bobs with the same motion. Two draws for every candle on the floor and
// no CPU at all from frame to frame: they had been particle emitters, ten sprites a second each.
// A candle can still be dimmed, recoloured or put out (a room's darkness or blood moon: `sync`).

// the drift a floating candle shares between its wax and its flame (bob 0: it stands still)
const BOB = /* glsl */ `
  vec3 bobOf(float seed, float bob, float t) {
    return bob * vec3(sin(t * 0.37 + seed * 11.0) * 0.05,
                      sin(t * 0.55 + seed * 6.283) * 0.09 + sin(t * 1.3 + seed * 17.0) * 0.025,
                      cos(t * 0.41 + seed * 7.0) * 0.05);
  }`;

const FOG_FADE = /* glsl */ `
  #ifdef USE_FOG
    #ifdef FOG_EXP2
      float fogF = 1.0 - exp(-fogDensity * fogDensity * vFogDepth * vFogDepth);
    #else
      float fogF = smoothstep(fogNear, fogFar, vFogDepth);
    #endif
  #else
    float fogF = 0.0;
  #endif`;

const FLAME_H = 0.075; // a candle flame's height, metres

export class CandleField {
  constructor() {
    this.flames = []; // [x, y, z, seed, size, bob, r, g, b]
    this.wax = []; // [x, y, z, seed, radius, height, bob]
    this.uTime = { value: 0 };
    this.group = new THREE.Group();
    this.group.name = 'candles';
    this.fAttr = null;
  }

  // a flame at (x, y, z), the foot of the flame; k scales it, bob > 0 lets it drift (with its wax)
  addFlame(x, y, z, { k = 1, bob = 0, seed = Math.random(), color = null } = {}) {
    const c = color != null ? _c.set(color) : null;
    // (a tint: the shader's palette multiplied by the colour, normalised to its brightest channel)
    const m = c ? Math.max(c.r, c.g, c.b, 1e-3) : 1;
    this.flames.push([x, y, z, seed, k, bob, c ? c.r / m : 1, c ? c.g / m : 1, c ? c.b / m : 1]);
    return this.flames.length - 1;
  }

  // a floating candle: wax standing at (x, y, z) h tall, with its flame on the wick
  addFloating(x, y, z, h, r, seed) {
    this.wax.push([x, y, z, seed, r, h, 1]);
    return this.addFlame(x, y + h + 0.005, z, { bob: 1, seed });
  }

  build(fog = true) {
    const nF = this.flames.length, nW = this.wax.length;
    if (nF) {
      const g = new THREE.InstancedBufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3));
      g.setIndex([0, 1, 2, 0, 2, 3]);
      const a = new Float32Array(nF * 4), b = new Float32Array(nF * 4), c = new Float32Array(nF * 3);
      this.flames.forEach((f, i) => { a.set([f[0], f[1], f[2], f[3]], i * 4); b.set([f[4], f[5], 0, 0], i * 4); c.set([f[6], f[7], f[8]], i * 3); });
      g.setAttribute('aPos', new THREE.InstancedBufferAttribute(a, 4));
      this.fAttr = new THREE.InstancedBufferAttribute(b, 4);
      this.cAttr = new THREE.InstancedBufferAttribute(c, 3);
      g.setAttribute('aData', this.fAttr);
      g.setAttribute('aCol', this.cAttr);
      g.instanceCount = nF;
      const mat = new THREE.ShaderMaterial({
        uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uTime: { value: 0 } }]),
        fog, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
        vertexShader: /* glsl */ `
          attribute vec4 aPos; attribute vec4 aData; attribute vec3 aCol;
          uniform float uTime;
          varying vec2 vQ; varying vec3 vCol; varying float vFl, vSway;
          #include <fog_pars_vertex>
          ${BOB}
          void main() {
            float seed = aPos.w, k = aData.x;
            vec3 p = aPos.xyz + bobOf(seed, aData.y, uTime);
            // flicker: a quick shiver over a slower breath, and now and then a gutter
            float t = uTime;
            float fl = 0.86 + 0.09 * sin(t * 11.0 + seed * 40.0) * sin(t * 6.7 + seed * 13.0) + 0.05 * sin(t * 2.3 + seed * 5.0);
            fl *= 1.0 - 0.35 * smoothstep(0.93, 1.0, sin(t * 0.7 + seed * 23.0));
            vFl = fl; vCol = aCol; vQ = position.xy;
            vSway = sin(t * 3.1 + seed * 9.0) * 0.18 + sin(t * 7.9 + seed * 3.0) * 0.06 + aData.y * sin(t * 0.55 + seed * 6.283 + 1.4) * 0.25;
            // a billboard round the flame's middle, wide enough for its halo
            float H = ${FLAME_H.toFixed(3)} * k;
            vec4 mvPosition = modelViewMatrix * vec4(p + vec3(0.0, H * 0.45, 0.0), 1.0);
            mvPosition.xy += position.xy * H * 2.2 * vec2(1.0, 1.0);
            // (nudged a hair toward the eye so it never sinks into its own wax)
            mvPosition.xyz += normalize(-mvPosition.xyz) * 0.02;
            gl_Position = projectionMatrix * mvPosition;
            if (k <= 0.0) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
            #include <fog_vertex>
          }`,
        fragmentShader: /* glsl */ `
          varying vec2 vQ; varying vec3 vCol; varying float vFl, vSway;
          #include <fog_pars_fragment>
          void main() {
            // flame space: the quad spans +-2.2 flame heights round the flame's middle
            vec2 f = vQ * 2.2;
            f.y += 0.45;            // (0 at the foot, 1 at the tip)
            float u = clamp(f.y, 0.0, 1.0);
            float x = f.x - vSway * u * u;
            // a teardrop: round at the foot, drawn out to a point, taller as it flares
            float y = (f.y - 0.22) / (0.78 + 0.3 * (vFl - 0.86));
            float d = length(vec2(x * (1.0 + max(y, 0.0) * 2.6) / 0.17, y < 0.0 ? y / 0.22 : y / 0.78));
            float body = smoothstep(1.0, 0.55, d);
            float core = smoothstep(0.62, 0.15, length(vec2(x / 0.1, (f.y - 0.25) / 0.32)));
            float foot = smoothstep(0.3, -0.05, f.y) * body;
            vec3 c = vec3(1.0, 0.42, 0.09) * body * 3.2;
            c = mix(c, vec3(1.0, 0.86, 0.55) * 6.0, core);
            c = mix(c, vec3(0.25, 0.35, 1.0) * 1.6, foot * 0.6);
            // the halo: a warm glow round the flame for the bloom
            float r2 = dot(vec2(f.x, f.y - 0.35), vec2(f.x, f.y - 0.35));
            c += vec3(1.0, 0.5, 0.18) * exp(-r2 * 1.6) * 0.22;
            c *= vCol * vFl;
            ${FOG_FADE}
            gl_FragColor = vec4(c * (1.0 - fogF), 1.0);
          }`,
      });
      mat.uniforms.uTime = this.uTime;
      const m = new THREE.Mesh(g, mat);
      m.frustumCulled = false;
      m.renderOrder = 7;
      m.name = 'candleFlames';
      this.group.add(m);
      this.flameMesh = m;
    }
    if (nW) {
      const base = new THREE.CylinderGeometry(1, 1, 1, 8, 1, false).translate(0, 0.5, 0);
      const g = new THREE.InstancedBufferGeometry();
      g.index = base.index;
      g.setAttribute('position', base.getAttribute('position'));
      g.setAttribute('normal', base.getAttribute('normal'));
      const a = new Float32Array(nW * 4), b = new Float32Array(nW * 4);
      this.wax.forEach((w, i) => { a.set([w[0], w[1], w[2], w[3]], i * 4); b.set([w[4], w[5], w[6], 0], i * 4); });
      g.setAttribute('aPos', new THREE.InstancedBufferAttribute(a, 4));
      g.setAttribute('aData', new THREE.InstancedBufferAttribute(b, 4));
      g.instanceCount = nW;
      const mat = new THREE.ShaderMaterial({
        uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uTime: { value: 0 } }]),
        fog,
        vertexShader: /* glsl */ `
          attribute vec4 aPos; attribute vec4 aData;
          uniform float uTime;
          varying float vH, vLit, vFl, vDrip;
          #include <fog_pars_vertex>
          ${BOB}
          void main() {
            float seed = aPos.w;
            vec3 p = aPos.xyz + bobOf(seed, aData.z, uTime) + vec3(position.x * aData.x, position.y * aData.y, position.z * aData.x);
            vH = position.y;
            // lit by its own flame from above, and a little from the room
            vLit = 0.55 + 0.45 * max(normal.y, 0.0);
            // runs of wax down its sides
            vDrip = sin(atan(position.z, position.x) * 3.0 + seed * 20.0);
            float t = uTime;
            vFl = 0.86 + 0.09 * sin(t * 11.0 + seed * 40.0) * sin(t * 6.7 + seed * 13.0);
            vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);
            gl_Position = projectionMatrix * mvPosition;
            #include <fog_vertex>
          }`,
        fragmentShader: /* glsl */ `
          varying float vH, vLit, vFl, vDrip;
          #include <fog_pars_fragment>
          void main() {
            // ivory wax glowing through near the flame, dim and cool toward the foot, with drips
            float glow = pow(vH, 7.0);
            float drip = smoothstep(0.55, 0.95, vDrip) * smoothstep(0.35, 0.9, vH + 0.25 * vDrip);
            vec3 c = vec3(0.8, 0.7, 0.52) * (0.025 + 0.17 * vH * vH + 0.05 * drip) * vLit + vec3(1.0, 0.6, 0.28) * glow * 0.9 * vFl;
            ${FOG_FADE}
            #ifdef USE_FOG
              c = mix(c, fogColor, fogF);
            #endif
            gl_FragColor = vec4(c, 1.0);
          }`,
      });
      mat.uniforms.uTime = this.uTime;
      const m = new THREE.Mesh(g, mat);
      m.frustumCulled = false;
      m.name = 'floatingCandles';
      this.group.add(m);
      base.dispose();
    }
    return this.group;
  }

  update(time) { this.uTime.value = time; }

  // a flame's size (0: out) and colour (null: its own), from a room's darkness or blood moon
  sync(i, k, color = null) {
    if (!this.fAttr) return;
    this.fAttr.array[i * 4] = k;
    const c = color != null ? _c.set(color) : null, m = c ? Math.max(c.r, c.g, c.b, 1e-3) : 1;
    this.cAttr.array[i * 3] = c ? c.r / m : 1; this.cAttr.array[i * 3 + 1] = c ? c.g / m : 1; this.cAttr.array[i * 3 + 2] = c ? c.b / m : 1;
    this.fAttr.needsUpdate = true; this.cAttr.needsUpdate = true;
  }
}
const _c = new THREE.Color();
