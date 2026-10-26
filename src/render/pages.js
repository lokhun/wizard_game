import * as THREE from 'three';

// Loose pages drifting down through the Hall of Whispers: parchment leaves let go somewhere under the
// vault that fall like dead leaves, swinging from side to side and tipping into each swing, turning as
// they go, and fade away before they touch the floor, to be let go again above. All of it is the vertex
// shader's (from the clock and each page's seed): one instanced draw, nothing on the CPU after load.
// A page is a bent sheet (4 x 2 quads) with faint lines of writing on both faces, lit warmer the higher
// it is (the floating candles) and greyed by the haze.

export class Pages {
  constructor() {
    this.list = []; // [x, z, top, bottom, seed]
    this.uTime = { value: 0 };
  }

  add(x, z, top, bottom, seed) { this.list.push([x, z, top, bottom, seed]); }

  build() {
    const n = this.list.length;
    if (!n) return null;
    const base = new THREE.PlaneGeometry(0.2, 0.27, 4, 2);
    const g = new THREE.InstancedBufferGeometry();
    g.index = base.index;
    g.setAttribute('position', base.getAttribute('position'));
    g.setAttribute('uv', base.getAttribute('uv'));
    const a = new Float32Array(n * 4), b = new Float32Array(n * 2);
    this.list.forEach((p, i) => { a.set([p[0], p[2], p[1], p[4]], i * 4); b.set([p[2] - p[3], 0], i * 2); });
    g.setAttribute('aPos', new THREE.InstancedBufferAttribute(a, 4));
    g.setAttribute('aFall', new THREE.InstancedBufferAttribute(b, 2));
    g.instanceCount = n;
    const mat = new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uTime: { value: 0 } }]),
      fog: true, side: THREE.DoubleSide,
      vertexShader: /* glsl */ `
        attribute vec4 aPos; attribute vec2 aFall;
        uniform float uTime;
        varying vec2 vUv; varying float vLit, vFade;
        #include <fog_pars_vertex>
        mat3 rotX(float a) { float c = cos(a), s = sin(a); return mat3(1., 0., 0., 0., c, s, 0., -s, c); }
        mat3 rotY(float a) { float c = cos(a), s = sin(a); return mat3(c, 0., -s, 0., 1., 0., s, 0., c); }
        mat3 rotZ(float a) { float c = cos(a), s = sin(a); return mat3(c, s, 0., -s, c, 0., 0., 0., 1.); }
        void main() {
          float seed = aPos.w, H = aFall.x;
          // one fall takes H / 0.32 s; each page starts its own somewhere along it
          float speed = 0.26 + 0.12 * fract(seed * 7.13);
          float ph = fract(uTime * speed / H + seed);
          float t = uTime * (1.1 + 0.4 * fract(seed * 3.7)) + seed * 40.0;
          // the swing: side to side, the sheet tipping into it, and a slow turn about the vertical
          float sw = sin(t);
          vec3 c = vec3(aPos.x, aPos.y - ph * H, aPos.z);
          float yaw = seed * 6.283 + uTime * 0.25 * (fract(seed * 5.1) - 0.5);
          vec3 side = vec3(cos(yaw), 0.0, -sin(yaw));
          c += side * sw * 0.45 + vec3(sin(t * 0.31 + seed), 0.0, cos(t * 0.27 + seed * 2.0)) * 0.35;
          c.y += abs(cos(t)) * 0.08; // (it rises a little at the end of each swing)
          // the sheet: bent along its length, lying near flat, tipped into the swing
          // gone at the top and bottom of the fall: it grows out of nothing and dwindles away
          vFade = smoothstep(0.0, 0.06, ph) * (1.0 - smoothstep(0.86, 1.0, ph));
          vec3 q = position * vFade;
          q.z += (q.x * q.x) * 2.2 * (0.5 + 0.5 * sin(t * 0.5 + seed * 9.0));
          q = rotX(-1.45 + 0.25 * sin(t * 1.7)) * q;
          q = rotZ(-sw * 0.7) * q;
          q = rotY(yaw) * q;
          vec3 p = c + q;
          vUv = uv;
          // warmer and brighter up among the candles
          vLit = 0.55 + 0.6 * smoothstep(2.0, 5.5, p.y);
          vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);
          gl_Position = projectionMatrix * mvPosition;
          if (vFade <= 0.001) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
          #include <fog_vertex>
        }`,
      fragmentShader: /* glsl */ `
        varying vec2 vUv; varying float vLit, vFade;
        #include <fog_pars_fragment>
        void main() {
          // faint lines of writing inside a margin, foxed toward the edges
          float line = step(0.55, fract(vUv.y * 14.0)) * step(0.12, vUv.x) * step(vUv.x, 0.88) * step(0.1, vUv.y) * step(vUv.y, 0.9);
          float word = step(0.25, fract(sin(floor(vUv.x * 9.0) * 12.9 + floor(vUv.y * 14.0) * 78.2) * 437.5));
          float edge = min(min(vUv.x, 1.0 - vUv.x), min(vUv.y, 1.0 - vUv.y));
          vec3 c = vec3(0.7, 0.56, 0.36) * (0.75 + 0.25 * smoothstep(0.0, 0.15, edge));
          c *= 1.0 - 0.45 * line * word;
          c *= vLit * 0.42;
          #ifdef USE_FOG
            #ifdef FOG_EXP2
              float fogF = 1.0 - exp(-fogDensity * fogDensity * vFogDepth * vFogDepth);
            #else
              float fogF = smoothstep(fogNear, fogFar, vFogDepth);
            #endif
            c = mix(c, fogColor, fogF);
          #endif
          gl_FragColor = vec4(c, 1.0);
        }`,
    });
    mat.uniforms.uTime = this.uTime;
    const m = new THREE.Mesh(g, mat);
    m.frustumCulled = false;
    m.name = 'pages';
    base.dispose();
    return m;
  }

  update(time) { this.uTime.value = time; }
}
