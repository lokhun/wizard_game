import * as THREE from 'three';

// The whispers of the Hall of Whispers: pale ghost-lights that wander its halls and libraries on slow,
// looping paths (a sum of sines round a home point, rising and dipping between 1.4 and 4 m), each one a
// bright mote with a fading tail of its own past positions behind it. A tail is the same path sampled a
// little further back in time per instance, so a wisp is 10 instances of one additive billboard and the
// whole floor is one draw with nothing on the CPU after load. The bloom does the glowing.

const TAIL = 10;

export class Wisps {
  constructor() {
    this.list = []; // [x, y, z, seed, rx, rz]
    this.uTime = { value: 0 };
    this.uEye = { value: new THREE.Vector3(0, -999, 0) };
  }

  // the eye they shy from (held by reference: the camera's own position, no per-frame copy)
  setEye(v) { this.uEye.value = v; }

  // a wisp wandering round (x, y, z), up to rx / rz from it
  add(x, y, z, rx, rz, seed) { this.list.push([x, y, z, seed, rx, rz]); }

  build() {
    const n = this.list.length;
    if (!n) return null;
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    const a = new Float32Array(n * TAIL * 4), b = new Float32Array(n * TAIL * 4);
    let k = 0;
    for (const w of this.list) {
      for (let j = 0; j < TAIL; j++, k++) {
        a.set([w[0], w[1], w[2], w[3]], k * 4);
        b.set([w[4], w[5], j / (TAIL - 1), 0], k * 4);
      }
    }
    g.setAttribute('aPos', new THREE.InstancedBufferAttribute(a, 4));
    g.setAttribute('aData', new THREE.InstancedBufferAttribute(b, 4));
    g.instanceCount = n * TAIL;
    const mat = new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uTime: { value: 0 }, uEye: { value: null } }]),
      fog: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      vertexShader: /* glsl */ `
        attribute vec4 aPos; attribute vec4 aData;
        uniform float uTime; uniform vec3 uEye;
        varying vec2 vQ; varying float vK, vB;
        #include <fog_pars_vertex>
        vec3 path(float s, float t) {
          return vec3(sin(t * 0.21 + s * 6.3) * 0.7 + sin(t * 0.53 + s * 17.0) * 0.3,
                      sin(t * 0.33 + s * 9.1) * 0.6 + sin(t * 0.9 + s * 3.0) * 0.15,
                      cos(t * 0.17 + s * 4.7) * 0.7 + sin(t * 0.47 + s * 11.0) * 0.3);
        }
        void main() {
          float s = aPos.w, j = aData.z;
          // (the tail: the head's own path, a little further back for each instance)
          float t = uTime - j * 0.4;
          vec3 o = path(s, t);
          vec3 p = aPos.xyz + vec3(o.x * aData.x, o.y * 1.1, o.z * aData.y);
          // shy: it slips aside and up out of the way of anyone who comes close
          vec3 d = p - uEye; float l = length(d.xz);
          float shy = smoothstep(3.2, 0.6, l);
          p.xz += (l > 1e-3 ? d.xz / l : vec2(0.0, 1.0)) * shy * 1.8;
          p.y += shy * 0.7;
          // it brightens and fades on a slow breath, now and then all but gone
          float breath = 0.55 + 0.45 * sin(uTime * 0.6 + s * 31.0);
          vB = breath * breath;
          vK = j;
          vQ = position.xy;
          float size = mix(0.26, 0.07, j) * (0.8 + 0.3 * breath);
          vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);
          mvPosition.xy += position.xy * size;
          gl_Position = projectionMatrix * mvPosition;
          #include <fog_vertex>
        }`,
      fragmentShader: /* glsl */ `
        varying vec2 vQ; varying float vK, vB;
        #include <fog_pars_fragment>
        void main() {
          float r2 = dot(vQ, vQ);
          if (r2 > 1.0) discard;
          float core = exp(-r2 * 14.0), halo = exp(-r2 * 3.0) * 0.5;
          vec3 c = mix(vec3(0.38, 0.62, 1.0), vec3(0.4, 0.32, 1.0), vK) * (core * 1.3 + halo) * (1.0 - vK * 0.7) * vB;
          #ifdef USE_FOG
            #ifdef FOG_EXP2
              float fogF = 1.0 - exp(-fogDensity * fogDensity * vFogDepth * vFogDepth);
            #else
              float fogF = smoothstep(fogNear, fogFar, vFogDepth);
            #endif
            c *= 1.0 - fogF;
          #endif
          gl_FragColor = vec4(c, 1.0);
        }`,
    });
    mat.uniforms.uTime = this.uTime;
    mat.uniforms.uEye = this.uEye;
    const m = new THREE.Mesh(g, mat);
    m.frustumCulled = false;
    m.renderOrder = 7;
    m.name = 'wisps';
    return m;
  }

  update(time) { this.uTime.value = time; }
}
