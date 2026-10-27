import * as THREE from 'three';

// The Hollow Throne's dead court, and the ash of their souls.
//
// SpectralCourt: the ghosts of the Hollow King's courtiers still keep their places, in rows along the
// aisles of his halls, facing the carpet, and on their knees before his throne. Each is a hooded robed
// figure (one lathed silhouette, a crown on some: one geometry, instanced) drawn as a ghost: a cold rim
// that brightens toward the silhouette's edge, a faint body, light running up it in slow bands, the hem
// trailing off into mist. They are only there at a distance: walk toward one and it thins away (gone by
// 4 m), and the whole court fades from a hall when a fight breaks out (`setFight`). A slight sway and a
// rare flicker; nothing on the CPU from frame to frame, one draw for the floor.
//
// SoulAsh: violet flecks sifting down through every room, slowly turning, a glow each, re-falling from
// the vault when they reach the floor. One draw, all in the vertex shader.

const FOG_K = /* glsl */ `
  #ifdef USE_FOG
    #ifdef FOG_EXP2
      float fogF = 1.0 - exp(-fogDensity * fogDensity * vFogDepth * vFogDepth);
    #else
      float fogF = smoothstep(fogNear, fogFar, vFogDepth);
    #endif
  #else
    float fogF = 0.0;
  #endif`;

// a hooded, robed figure 1.75 m tall standing at the origin facing +z (aPart: 0 body, 1 crown)
function courtierGeometry() {
  const prof = [
    [0.0, 0.0], [0.44, 0.0], [0.4, 0.2], [0.33, 0.55], [0.26, 0.9], [0.25, 1.1], [0.28, 1.3], [0.24, 1.42],
    [0.15, 1.5], [0.13, 1.56], [0.16, 1.66], [0.15, 1.78], [0.09, 1.86], [0.0, 1.9],
  ].map(([r, y]) => new THREE.Vector2(r, y));
  const body = new THREE.LatheGeometry(prof, 14);
  // the hood's opening pulled forward a touch, the robe's back hem trailing
  const p = body.getAttribute('position');
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i), z = p.getZ(i);
    if (y > 1.5) p.setZ(i, z + (y - 1.5) * 0.18);
    if (y < 0.3 && z < 0) p.setZ(i, z * (1 + (0.3 - y) * 0.8));
  }
  body.computeVertexNormals();
  const crown = new THREE.CylinderGeometry(0.13, 0.11, 0.1, 10, 1, true).translate(0, 1.93, 0.04);
  const parts = [body, crown];
  const pos = [], nrm = [], part = [], idx = [];
  let base = 0;
  parts.forEach((g, k) => {
    const gp = g.getAttribute('position'), gn = g.getAttribute('normal');
    for (let i = 0; i < gp.count; i++) { pos.push(gp.getX(i), gp.getY(i), gp.getZ(i)); nrm.push(gn.getX(i), gn.getY(i), gn.getZ(i)); part.push(k); }
    const gi = g.index;
    for (let i = 0; i < gi.count; i++) idx.push(gi.getX(i) + base);
    base += gp.count;
    g.dispose();
  });
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('aPart', new THREE.Float32BufferAttribute(part, 1));
  g.setIndex(idx);
  return g;
}

export class SpectralCourt {
  constructor() {
    this.list = []; // [x, y, z, yaw, seed, kneel, crown, scale]
    this.uTime = { value: 0 };
    this.uEye = { value: new THREE.Vector3(0, -999, 0) };
    this.uFight = { value: 0 };
  }

  add(x, y, z, yaw, { seed = Math.random(), kneel = 0, crown = 0, scale = 1 } = {}) { this.list.push([x, y, z, yaw, seed, kneel, crown, scale]); }
  setEye(v) { this.uEye.value = v; }
  // 0: the court keeps its places; 1: it has fled (a fight is on)
  setFight(k) { this.uFight.value = k; }

  build() {
    const n = this.list.length;
    if (!n) return null;
    const g = courtierGeometry();
    const a = new Float32Array(n * 4), b = new Float32Array(n * 4);
    this.list.forEach((c, i) => { a.set([c[0], c[1], c[2], c[3]], i * 4); b.set([c[4], c[5], c[6], c[7]], i * 4); });
    g.setAttribute('aPos', new THREE.InstancedBufferAttribute(a, 4));
    g.setAttribute('aData', new THREE.InstancedBufferAttribute(b, 4));
    g.instanceCount = n;
    const mat = new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uTime: { value: 0 }, uEye: { value: null }, uFight: { value: 0 } }]),
      fog: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      vertexShader: /* glsl */ `
        attribute vec4 aPos; attribute vec4 aData; attribute float aPart;
        uniform float uTime, uFight; uniform vec3 uEye;
        varying vec3 vN, vV; varying float vY, vA, vS;
        #include <fog_pars_vertex>
        void main() {
          float seed = aData.x, kneel = aData.y, crown = aData.z, sc = aData.w;
          vec3 q = position;
          if (aPart > 0.5 && crown < 0.5) q *= 0.0;
          vY = q.y / 1.9;
          vec3 nn = normal;
          // kneeling: the robe folds down under the body, and the head bows over it
          if (kneel > 0.0) {
            float fold = smoothstep(1.0, 0.0, q.y);
            q.y = q.y < 0.9 ? q.y * (1.0 - 0.55 * kneel) : q.y - 0.5 * kneel;
            q.z += fold * 0.25 * kneel;
            float bow = smoothstep(0.85, 1.6, position.y) * 0.45 * kneel;
            float cy = 0.95 - 0.5 * kneel;
            vec2 r = vec2(q.y - cy, q.z);
            q.y = cy + r.x * cos(bow) - r.y * sin(bow);
            q.z = r.x * sin(bow) + r.y * cos(bow);
          }
          // the standing turn their heads to watch whoever walks the aisle (within a neck's reach, nearer than 14 m)
          if (kneel < 0.5) {
            vec2 e = uEye.xz - aPos.xz;
            float rel = atan(e.x, e.y) - aPos.w;
            rel -= 6.2831853 * floor((rel + 3.1415927) / 6.2831853);
            float r = clamp(rel, -1.05, 1.05) * smoothstep(14.0, 7.0, length(e)) * smoothstep(1.4, 1.56, position.y);
            float cr = cos(r), sr = sin(r);
            q.xz = vec2(q.x * cr + q.z * sr, -q.x * sr + q.z * cr);
            nn.xz = vec2(nn.x * cr + nn.z * sr, -nn.x * sr + nn.z * cr);
          }
          // a slow sway from the hem up, its own
          float t = uTime + seed * 40.0;
          q.x += sin(t * 0.7) * 0.04 * vY * vY;
          q.z += sin(t * 0.53 + 1.3) * 0.03 * vY * vY;
          q *= sc;
          float c = cos(aPos.w), s = sin(aPos.w);
          vec3 p = aPos.xyz + vec3(q.x * c + q.z * s, q.y, -q.x * s + q.z * c);
          vN = normalMatrix * vec3(nn.x * c + nn.z * s, nn.y, -nn.x * s + nn.z * c);
          vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);
          vV = -mvPosition.xyz;
          // there only at a distance: thinning from 9 m, gone by 4; fled while a fight is on; a rare flicker
          float d = distance(aPos.xz, uEye.xz);
          float fl = 1.0 - 0.7 * smoothstep(0.96, 1.0, sin(uTime * 0.9 + seed * 77.0)) * (0.5 + 0.5 * sin(uTime * 37.0));
          vA = smoothstep(4.0, 9.0, d) * (1.0 - uFight) * fl;
          vS = seed;
          gl_Position = projectionMatrix * mvPosition;
          if (vA <= 0.002) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
          #include <fog_vertex>
        }`,
      fragmentShader: /* glsl */ `
        uniform float uTime;
        varying vec3 vN, vV; varying float vY, vA, vS;
        #include <fog_pars_fragment>
        void main() {
          vec3 n = normalize(vN), v = normalize(vV);
          float rim = pow(max(1.0 - abs(dot(n, v)), 0.0), 3.0);
          // light running up the body in slow bands, the hem trailing into mist
          float band = 0.6 + 0.4 * sin(vY * 22.0 - uTime * 1.6 + vS * 9.0);
          float hem = smoothstep(0.0, 0.22, vY);
          float k = (rim * 1.4 + 0.035) * band * hem * vA;
          vec3 c = mix(vec3(0.32, 0.42, 1.0), vec3(0.62, 0.48, 1.0), vY) * k * 0.6;
          ${FOG_K}
          gl_FragColor = vec4(c * (1.0 - fogF), 1.0);
        }`,
    });
    mat.uniforms.uTime = this.uTime; mat.uniforms.uEye = this.uEye; mat.uniforms.uFight = this.uFight;
    const m = new THREE.Mesh(g, mat);
    m.frustumCulled = false;
    m.renderOrder = 7;
    m.name = 'court';
    return m;
  }

  update(time) { this.uTime.value = time; }
}

export class SoulAsh {
  constructor() {
    this.list = []; // [x, z, top, bottom, seed, rx, rz]
    this.uTime = { value: 0 };
  }

  // a fleck falling round (x, z) within rx / rz, from top down to bottom
  add(x, z, top, bottom, rx, rz, seed) { this.list.push([x, z, top, bottom, seed, rx, rz]); }

  build() {
    const n = this.list.length;
    if (!n) return null;
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    const a = new Float32Array(n * 4), b = new Float32Array(n * 4);
    this.list.forEach((f, i) => { a.set([f[0], f[2], f[1], f[4]], i * 4); b.set([f[2] - f[3], f[5], f[6], 0], i * 4); });
    g.setAttribute('aPos', new THREE.InstancedBufferAttribute(a, 4));
    g.setAttribute('aData', new THREE.InstancedBufferAttribute(b, 4));
    g.instanceCount = n;
    const mat = new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uTime: { value: 0 } }]),
      fog: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      vertexShader: /* glsl */ `
        attribute vec4 aPos; attribute vec4 aData;
        uniform float uTime;
        varying vec2 vQ; varying float vB;
        #include <fog_pars_vertex>
        void main() {
          float s = aPos.w, H = aData.x;
          float ph = fract(uTime * (0.16 + 0.1 * fract(s * 7.7)) / H + s);
          float t = uTime * 0.4 + s * 50.0;
          vec3 p = vec3(aPos.x + sin(t + s * 3.0) * aData.y * 0.3 + sin(t * 0.37) * 0.4,
                        aPos.y - ph * H,
                        aPos.z + cos(t * 0.8 + s * 5.0) * aData.z * 0.3 + cos(t * 0.29) * 0.4);
          // it glints as it turns
          vB = (0.35 + 0.65 * pow(0.5 + 0.5 * sin(uTime * 2.3 + s * 60.0), 3.0)) * smoothstep(0.0, 0.08, ph) * (1.0 - smoothstep(0.85, 1.0, ph));
          vQ = position.xy;
          vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);
          mvPosition.xy += position.xy * 0.06;
          gl_Position = projectionMatrix * mvPosition;
          #include <fog_vertex>
        }`,
      fragmentShader: /* glsl */ `
        varying vec2 vQ; varying float vB;
        #include <fog_pars_fragment>
        void main() {
          float r2 = dot(vQ, vQ);
          if (r2 > 1.0) discard;
          vec3 c = vec3(0.8, 0.45, 1.0) * (exp(-r2 * 6.0) * 2.6) * vB;
          ${FOG_K}
          gl_FragColor = vec4(c * (1.0 - fogF), 1.0);
        }`,
    });
    mat.uniforms.uTime = this.uTime;
    const m = new THREE.Mesh(g, mat);
    m.frustumCulled = false;
    m.renderOrder = 7;
    m.name = 'soulAsh';
    return m;
  }

  update(time) { this.uTime.value = time; }
}
