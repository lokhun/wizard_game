import * as THREE from 'three';
import { SPR } from './particles.js';
import { rand } from '../core/rng.js';

// ---------------------------------------------------------------------------
// VFX library: element-themed explosions, impacts, trails, ground rings,
// telegraphs, lightning, beams, shells and decals. Everything is pooled.
// ---------------------------------------------------------------------------

const C = (hex, k = 1) => {
  const c = new THREE.Color(hex);
  return [c.r * k, c.g * k, c.b * k];
};

// Per-element palettes: core (HDR), secondary, smoke color, sprite set
export const FX = {
  fire: { core: C(0xffb050, 4), mid: C(0xff5010, 3), end: C(0x601000, 1), smoke: [0.08, 0.06, 0.05], spr: SPR.FLAME, spark: SPR.EMBER, light: 0xff7a30 },
  frost: { core: C(0xd8f8ff, 3.5), mid: C(0x60c8ff, 2.5), end: C(0x2060a0, 1), smoke: [0.6, 0.75, 0.85], spr: SPR.SHARD, spark: SPR.SNOW, light: 0x80d0ff },
  lightning: { core: C(0xe8f0ff, 6), mid: C(0x7090ff, 4), end: C(0x4040ff, 1.5), smoke: [0.3, 0.3, 0.4], spr: SPR.BOLT, spark: SPR.SPARK, light: 0x90a8ff },
  arcane: { core: C(0xffc8ff, 4), mid: C(0xc050ff, 3), end: C(0x4010a0, 1), smoke: [0.2, 0.1, 0.3], spr: SPR.STAR, spark: SPR.RUNE, light: 0xc060ff },
  necrotic: { core: C(0xd0ffb0, 3.5), mid: C(0x50ff40, 2.5), end: C(0x104010, 1), smoke: [0.05, 0.1, 0.05], spr: SPR.WISP, spark: SPR.EMBER, light: 0x60ff60 },
  blood: { core: C(0xff6070, 3), mid: C(0xd00020, 2.2), end: C(0x300008, 1), smoke: [0.25, 0.02, 0.03], spr: SPR.DROP, spark: SPR.DROP, light: 0xff2040 },
  time: { core: C(0xd0fff0, 3.5), mid: C(0x40e0c8, 2.5), end: C(0xd0a040, 1), smoke: [0.2, 0.3, 0.3], spr: SPR.RING, spark: SPR.STAR, light: 0x40e0c8 },
  shadow: { core: C(0xff90ff, 3), mid: C(0xa030ff, 2.5), end: C(0x200040, 1), smoke: [0.03, 0.0, 0.05], spr: SPR.WISP, spark: SPR.SPARK, light: 0xa040ff },
  holy: { core: C(0xfff8d0, 5), mid: C(0xffd050, 3), end: C(0xa06010, 1), smoke: [0.9, 0.85, 0.7], spr: SPR.STAR, spark: SPR.GLOW, light: 0xffd870 },
  earth: { core: C(0xffd090, 2.5), mid: C(0xc08040, 1.5), end: C(0x402010, 1), smoke: [0.35, 0.28, 0.2], spr: SPR.CHUNK, spark: SPR.EMBER, light: 0xe0a050 },
  poison: { core: C(0xe8ffa0, 3), mid: C(0x90e030, 2.2), end: C(0x204010, 1), smoke: [0.25, 0.4, 0.08], spr: SPR.BUBBLE, spark: SPR.FEATHER, light: 0x90e030 },
  blade: { core: C(0xe0f4ff, 4), mid: C(0x50b0ff, 3), end: C(0x204080, 1), smoke: [0.4, 0.45, 0.5], spr: SPR.SHARD, spark: SPR.SPARK, light: 0x60b8ff },
  wind: { core: C(0xf0fffc, 2.5), mid: C(0xa8fff0, 1.6), end: C(0x407070, 0.6), smoke: [0.7, 0.8, 0.8], spr: SPR.WISP, spark: SPR.FEATHER, light: 0xa8fff0 },
  physical: { core: C(0xffffff, 2), mid: C(0xc0c0c0, 1.2), end: C(0x404040, 0.6), smoke: [0.3, 0.3, 0.3], spr: SPR.CHUNK, spark: SPR.SPARK, light: 0xffffff },
  enemy: { core: C(0xff9080, 4), mid: C(0xff2020, 3), end: C(0x400000, 1), smoke: [0.1, 0.0, 0.0], spr: SPR.GLOW, spark: SPR.EMBER, light: 0xff3020 },
  enemyGreen: { core: C(0xe0ff90, 3), mid: C(0x70d020, 2.5), end: C(0x204000, 1), smoke: [0.15, 0.25, 0.05], spr: SPR.BUBBLE, spark: SPR.DROP, light: 0x80e020 },
  enemyPurple: { core: C(0xffb0ff, 4), mid: C(0xb020ff, 3), end: C(0x300050, 1), smoke: [0.05, 0.0, 0.08], spr: SPR.WISP, spark: SPR.SPARK, light: 0xb040ff },
  enemyFire: { core: C(0xffc070, 4), mid: C(0xff4010, 3), end: C(0x401000, 1), smoke: [0.08, 0.06, 0.05], spr: SPR.FLAME, spark: SPR.EMBER, light: 0xff6020 },
};
export const fxOf = (el) => FX[el] ?? FX.physical;

// ---------------------------------------------------------------- shaders
const RING_FRAG = /* glsl */ `
uniform vec3 uColor; uniform float uProg; uniform float uWidth; uniform float uTime;
varying vec2 vUv;
void main(){
  vec2 p = vUv * 2.0 - 1.0;
  float d = length(p);
  float r = 1.0 - pow(1.0 - uProg, 3.0);
  float w = uWidth * (1.0 - uProg * 0.5);
  float ring = smoothstep(r - w, r, d) * (1.0 - smoothstep(r, r + w * 0.3, d));
  float a = atan(p.y, p.x);
  float n = 0.7 + 0.3 * sin(a * 12.0 + uTime * 6.0) * sin(a * 7.0 - uTime * 4.0);
  float fill = (1.0 - smoothstep(0.0, r, d)) * 0.15 * (1.0 - uProg);
  float alpha = (ring * n + fill) * (1.0 - uProg);
  if (alpha < 0.003) discard;
  gl_FragColor = vec4(uColor * alpha, 1.0);
}`;

const TELE_FRAG = /* glsl */ `
uniform vec3 uColor; uniform float uProg; uniform float uTime; uniform int uMode; uniform float uAngle; uniform float uFade;
varying vec2 vUv;
void main(){
  vec2 p = vUv * 2.0 - 1.0;
  float inside, edge, fill;
  if (uMode == 0) { // circle
    float d = length(p);
    inside = step(d, 1.0);
    edge = smoothstep(0.88, 0.97, d) * inside;
    fill = step(d, uProg) * inside;
    float ringF = smoothstep(uProg - 0.04, uProg, d) * step(d, uProg) * inside;
    fill = fill * 0.35 + ringF * 0.9;
  } else if (uMode == 1) { // rect, fills along +y (vUv.y)
    inside = 1.0;
    float ex = smoothstep(0.85, 0.97, abs(p.x));
    float ey = smoothstep(0.92, 0.99, abs(p.y));
    edge = max(ex, ey);
    float y = vUv.y;
    fill = step(y, uProg) * 0.35 + smoothstep(uProg - 0.03, uProg, y) * step(y, uProg) * 0.9;
  } else { // cone sector pointing +y, half-angle uAngle
    float d = length(p);
    float a = abs(atan(p.x, p.y));
    inside = step(d, 1.0) * step(a, uAngle);
    edge = (smoothstep(0.9, 0.98, d) + smoothstep(uAngle - 0.06, uAngle, a)) * inside;
    fill = step(d, uProg) * inside * 0.35 + smoothstep(uProg - 0.04, uProg, d) * step(d, uProg) * inside * 0.9;
  }
  float pulse = 0.75 + 0.25 * sin(uTime * 14.0);
  float alpha = (edge * pulse + fill) * inside * uFade;
  if (alpha < 0.003) discard;
  gl_FragColor = vec4(uColor * alpha, 1.0);
}`;

const BEAM_VERT = /* glsl */ `
varying vec2 vUv; varying vec3 vN; varying vec3 vV;
void main(){
  vUv = uv;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vN = normalize(normalMatrix * normal);
  vV = normalize(-mv.xyz);
  gl_Position = projectionMatrix * mv;
}`;
const BEAM_FRAG = /* glsl */ `
uniform vec3 uColor; uniform vec3 uCore; uniform float uTime; uniform float uLen; uniform float uAlpha; uniform float uNoise;
varying vec2 vUv; varying vec3 vN; varying vec3 vV;
float h(float x){ return fract(sin(x) * 43758.5453); }
float n1(float x){ float i = floor(x), f = fract(x); return mix(h(i), h(i + 1.0), smoothstep(0.,1.,f)); }
void main(){
  float facing = abs(dot(vN, vV));
  float core = pow(facing, 6.0);
  float glow = pow(facing, 1.5);
  float along = vUv.y * uLen;
  float flow = n1(along * 2.0 - uTime * 18.0) * n1(along * 5.3 - uTime * 31.0 + vUv.x * 6.0);
  float flick = mix(1.0, 0.6 + 0.8 * flow, uNoise);
  float tip = smoothstep(0.0, 0.03, vUv.y) * smoothstep(1.0, 0.97, vUv.y);
  vec3 c = (uColor * glow * flick * 0.55 + uCore * core * 0.6) * uAlpha * tip;
  gl_FragColor = vec4(c, 1.0);
}`;

const SHELL_FRAG = /* glsl */ `
uniform vec3 uColor; uniform float uAlpha; uniform float uTime;
varying vec2 vUv; varying vec3 vN; varying vec3 vV;
void main(){
  float f = 1.0 - abs(dot(vN, vV));
  float rim = pow(f, 2.5);
  float hex = 0.6 + 0.4 * sin(vUv.x * 60.0 + uTime * 2.0) * sin(vUv.y * 40.0 - uTime * 1.5);
  vec3 c = uColor * (rim * 0.9 + 0.03) * hex * uAlpha;
  gl_FragColor = vec4(c, 1.0);
}`;

function decalTextures() {
  const mk = (draw) => {
    const c = document.createElement('canvas');
    c.width = c.height = 256;
    const g = c.getContext('2d');
    draw(g);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  };
  return {
    scorch: mk((g) => {
      for (let i = 0; i < 60; i++) {
        const a = Math.random() * Math.PI * 2, r = Math.random() * 70;
        const gr = g.createRadialGradient(128 + Math.cos(a) * r, 128 + Math.sin(a) * r, 0, 128 + Math.cos(a) * r, 128 + Math.sin(a) * r, 40);
        gr.addColorStop(0, 'rgba(10,6,4,0.35)'); gr.addColorStop(1, 'rgba(10,6,4,0)');
        g.fillStyle = gr; g.fillRect(0, 0, 256, 256);
      }
      g.strokeStyle = 'rgba(0,0,0,0.5)'; g.lineWidth = 3;
      for (let i = 0; i < 14; i++) {
        const a = Math.random() * Math.PI * 2;
        g.beginPath(); g.moveTo(128, 128);
        let x = 128, y = 128;
        for (let s = 0; s < 6; s++) { x += Math.cos(a + (Math.random() - 0.5)) * 16; y += Math.sin(a + (Math.random() - 0.5)) * 16; g.lineTo(x, y); }
        g.stroke();
      }
    }),
    frost: mk((g) => {
      const gr = g.createRadialGradient(128, 128, 0, 128, 128, 120);
      gr.addColorStop(0, 'rgba(220,245,255,0.7)'); gr.addColorStop(0.7, 'rgba(160,220,255,0.35)'); gr.addColorStop(1, 'rgba(160,220,255,0)');
      g.fillStyle = gr; g.fillRect(0, 0, 256, 256);
      g.strokeStyle = 'rgba(255,255,255,0.8)'; g.lineWidth = 2;
      for (let i = 0; i < 24; i++) {
        const a = Math.random() * Math.PI * 2, l = 40 + Math.random() * 80;
        g.beginPath(); g.moveTo(128, 128); g.lineTo(128 + Math.cos(a) * l, 128 + Math.sin(a) * l); g.stroke();
        const m = l * 0.6;
        g.beginPath(); g.moveTo(128 + Math.cos(a) * m, 128 + Math.sin(a) * m); g.lineTo(128 + Math.cos(a + 0.4) * (m + 15), 128 + Math.sin(a + 0.4) * (m + 15)); g.stroke();
      }
    }),
    blood: mk((g) => {
      g.fillStyle = 'rgba(90,5,8,0.9)';
      for (let i = 0; i < 30; i++) {
        const a = Math.random() * Math.PI * 2, r = Math.pow(Math.random(), 1.5) * 100;
        g.beginPath(); g.arc(128 + Math.cos(a) * r, 128 + Math.sin(a) * r, 4 + Math.random() * 26 * (1 - r / 110), 0, Math.PI * 2); g.fill();
      }
    }),
    slime: mk((g) => {
      g.fillStyle = 'rgba(80,140,20,0.85)';
      for (let i = 0; i < 26; i++) {
        const a = Math.random() * Math.PI * 2, r = Math.pow(Math.random(), 1.4) * 95;
        g.beginPath(); g.arc(128 + Math.cos(a) * r, 128 + Math.sin(a) * r, 6 + Math.random() * 28 * (1 - r / 100), 0, Math.PI * 2); g.fill();
      }
    }),
    crack: mk((g) => {
      g.strokeStyle = 'rgba(15,10,6,0.85)'; g.lineCap = 'round';
      for (let i = 0; i < 9; i++) {
        let x = 128, y = 128; let a = (i / 9) * Math.PI * 2 + Math.random() * 0.4;
        g.lineWidth = 6;
        g.beginPath(); g.moveTo(x, y);
        for (let s = 0; s < 8; s++) { a += (Math.random() - 0.5) * 0.7; x += Math.cos(a) * 14; y += Math.sin(a) * 14; g.lineTo(x, y); g.lineWidth = Math.max(1, 6 - s); }
        g.stroke();
      }
      const gr = g.createRadialGradient(128, 128, 0, 128, 128, 50);
      gr.addColorStop(0, 'rgba(20,14,8,0.7)'); gr.addColorStop(1, 'rgba(20,14,8,0)');
      g.fillStyle = gr; g.fillRect(0, 0, 256, 256);
    }),
    glyph: mk((g) => {
      g.translate(128, 128);
      g.strokeStyle = 'rgba(255,255,255,1)'; g.shadowColor = 'white'; g.shadowBlur = 8;
      g.lineWidth = 4; g.beginPath(); g.arc(0, 0, 118, 0, Math.PI * 2); g.stroke();
      g.lineWidth = 2; g.beginPath(); g.arc(0, 0, 100, 0, Math.PI * 2); g.stroke();
      g.beginPath(); g.arc(0, 0, 60, 0, Math.PI * 2); g.stroke();
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2, b = ((i + 2) / 6) * Math.PI * 2;
        g.beginPath(); g.moveTo(Math.cos(a) * 100, Math.sin(a) * 100); g.lineTo(Math.cos(b) * 100, Math.sin(b) * 100); g.stroke();
      }
      g.font = '18px serif'; g.fillStyle = 'white';
      const runes = 'ᚠᚢᚦᚨᚱᚲᚷᚹᚺᚾᛁᛃᛇᛈᛉᛊᛏᛒᛖᛗᛚᛜᛞᛟ';
      for (let i = 0; i < 24; i++) {
        const a = (i / 24) * Math.PI * 2;
        g.save(); g.rotate(a); g.fillText(runes[i % runes.length], -6, -104); g.restore();
      }
    }),
  };
}

export class VFX {
  constructor(scene, camera, particles, lights) {
    this.scene = scene;
    this.camera = camera;
    this.P = particles;
    this.lights = lights;
    this.time = 0;
    this.shake = 0;       // trauma 0..1
    this.fovKick = 0;
    this.hitstop = 0;
    this.active = [];     // timed mesh effects

    const plane = new THREE.PlaneGeometry(2, 2);
    plane.rotateX(-Math.PI / 2);
    this.planeGeo = plane;

    // ground rings
    this.ringPool = this._pool(24, () => new THREE.Mesh(plane, new THREE.ShaderMaterial({
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.); }',
      fragmentShader: RING_FRAG,
      uniforms: { uColor: { value: new THREE.Color() }, uProg: { value: 0 }, uWidth: { value: 0.15 }, uTime: { value: 0 } },
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    })));
    // telegraphs
    this.telePool = this._pool(24, () => new THREE.Mesh(plane, new THREE.ShaderMaterial({
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.); }',
      fragmentShader: TELE_FRAG,
      uniforms: { uColor: { value: new THREE.Color() }, uProg: { value: 0 }, uTime: { value: 0 }, uMode: { value: 0 }, uAngle: { value: 0.6 }, uFade: { value: 1 } },
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    })));
    // beams (unit cylinder along +Y from 0..1)
    const beamGeo = new THREE.CylinderGeometry(1, 1, 1, 12, 1, true);
    beamGeo.translate(0, 0.5, 0);
    this.beamGeo = beamGeo;
    this.beamPool = this._pool(10, () => new THREE.Mesh(beamGeo, new THREE.ShaderMaterial({
      vertexShader: BEAM_VERT, fragmentShader: BEAM_FRAG,
      uniforms: { uColor: { value: new THREE.Color() }, uCore: { value: new THREE.Color() }, uTime: { value: 0 }, uLen: { value: 1 }, uAlpha: { value: 1 }, uNoise: { value: 1 } },
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    })));
    // spherical shells
    const shellGeo = new THREE.SphereGeometry(1, 24, 16);
    this.shellPool = this._pool(16, () => new THREE.Mesh(shellGeo, new THREE.ShaderMaterial({
      vertexShader: BEAM_VERT, fragmentShader: SHELL_FRAG,
      uniforms: { uColor: { value: new THREE.Color() }, uAlpha: { value: 1 }, uTime: { value: 0 } },
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    })));
    // decals
    this.decalTex = decalTextures();
    this.decalPool = this._pool(80, () => {
      const m = new THREE.Mesh(plane, new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3 }));
      return m;
    });
    // lightning bolts
    this.boltPool = this._pool(28, () => {
      const g = new THREE.BufferGeometry();
      const max = 64;
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(max * 2 * 3), 3));
      g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(max * 2 * 2), 2));
      const idx = [];
      for (let i = 0; i < max - 1; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
      g.setIndex(idx);
      const m = new THREE.Mesh(g, new THREE.ShaderMaterial({
        vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.); }',
        fragmentShader: 'uniform vec3 uColor; uniform float uAlpha; varying vec2 vUv; void main(){ float d = abs(vUv.y - 0.5) * 2.0; float c = pow(1.0 - d, 2.0); gl_FragColor = vec4(uColor * c * uAlpha + vec3(1.0) * pow(1.0 - d, 8.0) * uAlpha * 2.0, 1.0); }',
        uniforms: { uColor: { value: new THREE.Color() }, uAlpha: { value: 1 } },
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      }));
      m.frustumCulled = false;
      return m;
    });
  }

  _pool(n, make) {
    const items = [];
    for (let i = 0; i < n; i++) {
      const m = make();
      m.visible = false;
      m.renderOrder = 15;
      this.scene.add(m);
      items.push(m);
    }
    let next = 0;
    return {
      items,
      get: () => {
        // prefer an idle item, otherwise steal the oldest
        for (let k = 0; k < n; k++) {
          const m = items[(next + k) % n];
          if (!m.visible) { next = (next + k + 1) % n; return m; }
        }
        const m = items[next];
        next = (next + 1) % n;
        this.active = this.active.filter((a) => a.mesh !== m);
        return m;
      },
    };
  }

  _track(mesh, life, update, onEnd) {
    mesh.visible = true;
    this.active.push({ mesh, life, t: 0, update, onEnd });
  }

  update(dt, time) {
    this.time = time;
    for (let i = this.active.length - 1; i >= 0; i--) {
      const a = this.active[i];
      a.t += dt;
      const k = Math.min(1, a.t / a.life);
      a.update?.(k, a.t, dt);
      if (a.t >= a.life) {
        a.mesh.visible = false;
        a.onEnd?.();
        this.active.splice(i, 1);
      }
    }
    this.shake = Math.max(0, this.shake - dt * 1.6);
    this.fovKick *= Math.exp(-dt * 8);
    this.hitstop = Math.max(0, this.hitstop - dt);
  }

  addShake(a) { this.shake = Math.min(1, this.shake + a); }
  addFovKick(a) { this.fovKick += a; }

  // ------------------------------------------------------------ primitives
  burst(pos, o = {}) {
    const n = o.count ?? 20;
    const fx = fxOf(o.element);
    const col = o.color ?? fx.mid, col2 = o.color2 ?? fx.end;
    const sp = o.speed ?? 6;
    for (let i = 0; i < n; i++) {
      let dx = Math.random() * 2 - 1, dy = Math.random() * 2 - 1, dz = Math.random() * 2 - 1;
      if (o.dir) {
        dx = o.dir.x + dx * (o.spread ?? 0.5); dy = o.dir.y + dy * (o.spread ?? 0.5); dz = o.dir.z + dz * (o.spread ?? 0.5);
      }
      if (o.upward) dy = Math.abs(dy) + o.upward;
      const l = Math.hypot(dx, dy, dz) || 1;
      const s = sp * (0.3 + Math.random() * 0.7);
      const p = {
        x: pos.x + (o.jitter ? rand(-o.jitter, o.jitter) : 0),
        y: pos.y + (o.jitter ? rand(-o.jitter, o.jitter) * 0.5 : 0),
        z: pos.z + (o.jitter ? rand(-o.jitter, o.jitter) : 0),
        vx: dx / l * s, vy: dy / l * s, vz: dz / l * s,
        r: col[0], g: col[1], b: col[2], r2: col2[0], g2: col2[1], b2: col2[2],
        life: (o.life ?? 0.6) * (0.6 + Math.random() * 0.6),
        size: (o.size ?? 0.15) * (0.6 + Math.random() * 0.8),
        size2: o.size2 ?? 0.01,
        gravity: o.gravity ?? 0, drag: o.drag ?? 2, stretch: o.stretch ?? 0,
        sprite: o.sprite ?? fx.spark, spin: o.spin ?? 0, a: o.alpha ?? 1,
      };
      if (o.solid) this.P.solid(p); else this.P.glow(p);
    }
  }

  smoke(pos, o = {}) {
    const n = o.count ?? 8;
    const c = o.color ?? [0.08, 0.07, 0.06];
    for (let i = 0; i < n; i++) {
      this.P.solid({
        x: pos.x + rand(-1, 1) * (o.spread ?? 0.4), y: pos.y + rand(-0.2, 0.3), z: pos.z + rand(-1, 1) * (o.spread ?? 0.4),
        vx: rand(-1, 1) * (o.speed ?? 1), vy: rand(0.3, 1.2) * (o.rise ?? 1), vz: rand(-1, 1) * (o.speed ?? 1),
        r: c[0], g: c[1], b: c[2], a: o.alpha ?? 0.55,
        life: (o.life ?? 1.6) * rand(0.7, 1.3), size: (o.size ?? 0.8) * rand(0.7, 1.2), size2: (o.size ?? 0.8) * 2.2,
        drag: 1.5, sprite: SPR.SMOKE, spin: rand(-0.6, 0.6), gravity: -0.3,
      });
    }
  }

  flash(pos, color, intensity = 30, range = 10, life = 0.2) {
    this.lights.flash(pos, color, intensity, range, life);
  }

  ring(pos, radius, color, life = 0.5, width = 0.2) {
    const m = this.ringPool.get();
    m.position.set(pos.x, (pos.y ?? 0) + 0.06, pos.z);
    m.scale.setScalar(radius);
    m.material.uniforms.uColor.value.setRGB(...(Array.isArray(color) ? color : C(color, 2.5)));
    m.material.uniforms.uWidth.value = width;
    this._track(m, life, (k) => { m.material.uniforms.uProg.value = k; m.material.uniforms.uTime.value = this.time; });
  }

  // returns a handle so callers can cancel; fills over `dur`, then fades.
  telegraph(pos, opts) {
    const m = this.telePool.get();
    const u = m.material.uniforms;
    const mode = opts.shape === 'rect' ? 1 : opts.shape === 'cone' ? 2 : 0;
    u.uMode.value = mode;
    u.uAngle.value = opts.angle ?? 0.6;
    u.uColor.value.setRGB(...(opts.color ?? [2.5, 0.25, 0.1]));
    m.position.set(pos.x, (pos.y ?? 0) + 0.05, pos.z);
    m.rotation.set(0, opts.rot ?? 0, 0);
    if (mode === 1) {
      // rect: width x length, extends forward from pos along rot
      m.scale.set(opts.width / 2, 1, opts.length / 2);
      m.position.x += Math.sin(opts.rot ?? 0) * opts.length / 2;
      m.position.z += Math.cos(opts.rot ?? 0) * opts.length / 2;
      m.rotation.y = (opts.rot ?? 0) + Math.PI;
    } else {
      m.scale.setScalar(opts.radius);
      if (mode === 2) m.rotation.y = (opts.rot ?? 0) + Math.PI;
    }
    const dur = opts.dur ?? 1;
    const total = dur + 0.15;
    this._track(m, total, (k, t) => {
      u.uProg.value = Math.min(1, t / dur);
      u.uTime.value = this.time;
      u.uFade.value = t > dur ? 1 - (t - dur) / 0.15 : Math.min(1, t * 8);
    });
    return m;
  }

  lightning(a, b, o = {}) {
    const m = this.boltPool.get();
    const segs = Math.min(63, Math.max(4, Math.floor(a.distanceTo(b) / 0.35)));
    const pts = [];
    const dir = new THREE.Vector3().subVectors(b, a);
    const len = dir.length();
    const jag = o.jag ?? Math.min(1.2, len * 0.08);
    const perp1 = new THREE.Vector3().crossVectors(dir, new THREE.Vector3(0, 1, 0));
    if (perp1.lengthSq() < 1e-6) perp1.set(1, 0, 0);
    perp1.normalize();
    const perp2 = new THREE.Vector3().crossVectors(dir, perp1).normalize();
    for (let i = 0; i <= segs; i++) {
      const t = i / segs;
      const env = Math.sin(t * Math.PI);
      const p = new THREE.Vector3().copy(a).addScaledVector(dir, t);
      if (i > 0 && i < segs) {
        p.addScaledVector(perp1, (Math.random() - 0.5) * jag * env);
        p.addScaledVector(perp2, (Math.random() - 0.5) * jag * env);
      }
      pts.push(p);
    }
    const pos = m.geometry.getAttribute('position');
    const uv = m.geometry.getAttribute('uv');
    const camPos = this.camera.position;
    const w = o.width ?? 0.08;
    const side = new THREE.Vector3(), seg = new THREE.Vector3(), toCam = new THREE.Vector3();
    for (let i = 0; i < 64; i++) {
      const p = pts[Math.min(i, pts.length - 1)];
      const q = pts[Math.min(i + 1, pts.length - 1)];
      const pp = pts[Math.max(0, Math.min(i, pts.length - 1) - 1)];
      seg.subVectors(q, pp).normalize();
      toCam.subVectors(camPos, p).normalize();
      side.crossVectors(seg, toCam).normalize().multiplyScalar(w * (i >= pts.length - 1 ? 0.3 : 1));
      pos.setXYZ(i * 2, p.x + side.x, p.y + side.y, p.z + side.z);
      pos.setXYZ(i * 2 + 1, p.x - side.x, p.y - side.y, p.z - side.z);
      uv.setXY(i * 2, i / 63, 0); uv.setXY(i * 2 + 1, i / 63, 1);
    }
    pos.needsUpdate = true; uv.needsUpdate = true;
    m.geometry.setDrawRange(0, (pts.length - 1) * 6);
    const fx = fxOf(o.element ?? 'lightning');
    m.material.uniforms.uColor.value.setRGB(...(o.color ?? fx.mid));
    const life = o.life ?? 0.15;
    this._track(m, life, (k) => { m.material.uniforms.uAlpha.value = (1 - k) * (0.7 + Math.random() * 0.6); });
    // branches
    if ((o.branches ?? 1) > 0 && len > 3) {
      for (let i = 0; i < (o.branches ?? 1); i++) {
        const from = pts[Math.floor(rand(0.2, 0.7) * pts.length)];
        const to = from.clone().add(new THREE.Vector3(rand(-1, 1), rand(-1, 0.6), rand(-1, 1)).multiplyScalar(len * 0.25));
        this.lightning(from, to, { ...o, branches: 0, width: w * 0.5, jag: jag * 0.6 });
      }
    }
    return pts;
  }

  // persistent beam; call update(a,b) every frame; release() when done
  beam(o = {}) {
    const m = this.beamPool.get();
    const fx = fxOf(o.element);
    const u = m.material.uniforms;
    u.uColor.value.setRGB(...(o.color ?? fx.mid));
    u.uCore.value.setRGB(...(o.core ?? fx.core));
    u.uNoise.value = o.noise ?? 1;
    m.visible = true;
    const width = o.width ?? 0.15;
    const up = new THREE.Vector3(0, 1, 0);
    const d = new THREE.Vector3();
    const handle = {
      mesh: m,
      alpha: 1,
      update: (a, b, w = width) => {
        d.subVectors(b, a);
        const len = d.length();
        m.position.copy(a);
        m.quaternion.setFromUnitVectors(up, d.normalize());
        m.scale.set(w, len, w);
        u.uLen.value = len;
        u.uTime.value = this.time;
        u.uAlpha.value = handle.alpha;
      },
      release: (fade = 0.15) => {
        this._track(m, fade, (k) => { u.uAlpha.value = handle.alpha * (1 - k); m.scale.x *= 0.9; m.scale.z *= 0.9; });
      },
    };
    return handle;
  }

  shell(pos, o = {}) {
    const m = this.shellPool.get();
    const fx = fxOf(o.element);
    const u = m.material.uniforms;
    u.uColor.value.setRGB(...(o.color ?? fx.mid));
    m.position.copy(pos);
    const r0 = o.from ?? 0.2, r1 = o.radius ?? 3;
    const life = o.life ?? 0.4;
    if (o.follow) {
      // persistent shell following a target (shields)
      m.visible = true;
      m.scale.setScalar(r1);
      return {
        mesh: m,
        update: (p, alpha = 1) => { m.position.copy(p); u.uAlpha.value = alpha; u.uTime.value = this.time; },
        release: () => this._track(m, 0.25, (k) => { u.uAlpha.value = 1 - k; m.scale.setScalar(r1 * (1 + k * 0.3)); }),
      };
    }
    this._track(m, life, (k) => {
      const e = 1 - Math.pow(1 - k, 3);
      m.scale.setScalar(r0 + (r1 - r0) * e);
      u.uAlpha.value = (1 - k) * (o.alpha ?? 1);
      u.uTime.value = this.time;
    });
    return null;
  }

  decal(pos, type, size = 2, life = 8, color) {
    const m = this.decalPool.get();
    const mat = m.material;
    mat.map = this.decalTex[type] ?? this.decalTex.scorch;
    mat.alphaMap = null;
    const additive = type === 'glyph' || type === 'frost';
    mat.blending = additive ? THREE.AdditiveBlending : THREE.NormalBlending;
    mat.color.set(color ?? 0xffffff);
    if (additive && color === undefined) mat.color.set(0x88ccff);
    mat.needsUpdate = true;
    m.position.set(pos.x, (pos.y ?? 0) + 0.03 + Math.random() * 0.01, pos.z);
    m.rotation.set(0, Math.random() * Math.PI * 2, 0);
    m.scale.setScalar(size / 2);
    mat.opacity = 1;
    this._track(m, life, (k) => { mat.opacity = k > 0.75 ? 1 - (k - 0.75) / 0.25 : Math.min(1, k * 20); });
    return m;
  }

  // ------------------------------------------------------------ composite effects
  muzzle(pos, dir, element, scale = 1) {
    const fx = fxOf(element);
    this.burst(pos, { element, count: Math.round(10 * scale), speed: 4 * scale, dir, spread: 0.6, life: 0.25, size: 0.08 * scale, sprite: fx.spark, drag: 4 });
    this.P.glow({ x: pos.x, y: pos.y, z: pos.z, r: fx.core[0], g: fx.core[1], b: fx.core[2], life: 0.12, size: 0.5 * scale, size2: 0.2, sprite: SPR.GLOW });
    this.flash(pos, fx.light, 8 * scale, 6, 0.1);
  }

  impact(pos, element, scale = 1) {
    const fx = fxOf(element);
    this.P.glow({ x: pos.x, y: pos.y, z: pos.z, r: fx.mid[0] * 0.6, g: fx.mid[1] * 0.6, b: fx.mid[2] * 0.6, life: 0.14, size: 0.8 * scale, size2: 0.3, sprite: SPR.GLOW });
    this.burst(pos, { element, count: Math.round(14 * scale), speed: 5 * scale, life: 0.4, size: 0.1 * scale, sprite: fx.spark, gravity: element === 'fire' || element === 'earth' ? 6 : 1, stretch: 0.04 });
    this.flash(pos, fx.light, 12 * scale, 6 * scale, 0.15);
    switch (element) {
      case 'fire': case 'enemyFire':
        this.burst(pos, { element, count: 6 * scale, speed: 2, life: 0.5, size: 0.35 * scale, sprite: SPR.FLAME, upward: 0.5, size2: 0.05, drag: 3 });
        this.smoke(pos, { count: 2, size: 0.4 * scale, life: 1 });
        break;
      case 'frost':
        this.burst(pos, { element, count: 8 * scale, speed: 5, life: 0.5, size: 0.12 * scale, sprite: SPR.SHARD, gravity: 9, spin: 8, color: [1.6, 2.2, 2.6] });
        break;
      case 'earth':
        this.burst(pos, { count: 8 * scale, speed: 5, life: 0.7, size: 0.15 * scale, sprite: SPR.CHUNK, gravity: 14, solid: true, color: [0.3, 0.25, 0.2], color2: [0.2, 0.18, 0.15], spin: 5 });
        this.smoke(pos, { count: 3, size: 0.5, color: fx.smoke, alpha: 0.35 });
        break;
      case 'blood':
        this.burst(pos, { count: 10 * scale, speed: 4, life: 0.6, size: 0.08, sprite: SPR.DROP, gravity: 12, solid: true, color: [0.35, 0.0, 0.02], color2: [0.2, 0, 0.01], stretch: 0.05 });
        break;
      case 'shadow': case 'enemyPurple':
        this.smoke(pos, { count: 3, size: 0.5, color: [0.04, 0.0, 0.06], alpha: 0.7, life: 0.8 });
        break;
      case 'poison': case 'enemyGreen':
        this.burst(pos, { element, count: 6, speed: 1.5, life: 0.8, size: 0.15, sprite: SPR.BUBBLE, upward: 0.4, gravity: -1 });
        break;
      default: break;
    }
  }

  explosion(pos, element, radius = 3, o = {}) {
    const fx = fxOf(element);
    const s = radius / 3;
    this.P.glow({ x: pos.x, y: pos.y, z: pos.z, r: fx.mid[0] * 0.5, g: fx.mid[1] * 0.5, b: fx.mid[2] * 0.5, life: 0.22, size: radius * 1.1, size2: radius * 0.4, sprite: SPR.GLOW });
    this.flash(pos, fx.light, 60 * s, radius * 4, 0.35);
    this.ring({ x: pos.x, y: (o.groundY ?? pos.y - 0.5), z: pos.z }, radius * 1.15, [fx.mid[0] * 0.45, fx.mid[1] * 0.45, fx.mid[2] * 0.45], 0.45, 0.18);
    // the expanding shock shell looks wrong from inside, so skip it when the camera is within range
    if (this.camera.position.distanceTo(pos) > radius * 1.3) this.shell(pos, { element, radius: radius * 1.1, from: radius * 0.2, life: 0.3, alpha: 0.35 });
    this.burst(pos, { element, count: Math.round(40 * s), speed: 10 * s, life: 0.6, size: 0.12, sprite: fx.spark, gravity: 6, stretch: 0.05, drag: 2.5 });
    const ground = { x: pos.x, y: o.groundY ?? pos.y - 0.5, z: pos.z };
    switch (element) {
      case 'fire': case 'enemyFire':
        this.burst(pos, { element, count: Math.round(28 * s), speed: 5 * s, life: 0.7, size: 0.7 * s, size2: 0.1, sprite: SPR.FLAME, drag: 3, upward: 0.2, color: fx.mid, color2: fx.end });
        this.burst(pos, { element, count: Math.round(30 * s), speed: 9 * s, life: 1.4, size: 0.06, sprite: SPR.EMBER, gravity: 5, drag: 1.2, upward: 0.4, color: [4, 1.5, 0.3] });
        this.smoke(pos, { count: Math.round(10 * s), size: 1.0 * s, life: 2.2, spread: radius * 0.4, speed: 2 });
        this.decal(ground, 'scorch', radius * 1.6, 12);
        break;
      case 'frost':
        this.burst(pos, { element, count: Math.round(24 * s), speed: 9 * s, life: 0.8, size: 0.22, sprite: SPR.SHARD, gravity: 10, spin: 6, color: [1.8, 2.4, 3] });
        this.burst(pos, { element, count: Math.round(20 * s), speed: 3, life: 1.6, size: 0.12, sprite: SPR.SNOW, gravity: 0.5, spin: 2, drag: 1.5 });
        this.smoke(pos, { count: Math.round(8 * s), size: 1.0 * s, color: [0.55, 0.7, 0.8], alpha: 0.3, life: 1.6 });
        this.decal(ground, 'frost', radius * 1.8, 10);
        break;
      case 'lightning':
        for (let i = 0; i < 6; i++) {
          const b = pos.clone().add(new THREE.Vector3(rand(-1, 1), rand(-0.3, 1), rand(-1, 1)).multiplyScalar(radius * 1.2));
          this.lightning(pos, b, { element, life: 0.2, branches: 1 });
        }
        this.decal(ground, 'scorch', radius * 1.2, 8);
        break;
      case 'arcane':
        this.burst(pos, { element, count: Math.round(16 * s), speed: 6 * s, life: 0.9, size: 0.25, sprite: SPR.STAR, drag: 2, spin: 3 });
        this.burst(pos, { element, count: 8, speed: 3, life: 1.0, size: 0.35, sprite: SPR.RUNE, drag: 2.5, spin: 1.5 });
        this.decal(ground, 'glyph', radius * 1.8, 2.5, 0xc060ff);
        break;
      case 'holy':
        for (let i = 0; i < 14; i++) {
          const a = (i / 14) * Math.PI * 2;
          this.P.glow({ x: pos.x, y: pos.y, z: pos.z, vx: Math.cos(a) * 12, vy: rand(-1, 3), vz: Math.sin(a) * 12, r: fx.core[0], g: fx.core[1], b: fx.core[2], life: 0.45, size: 0.15, stretch: 0.1, drag: 4, sprite: SPR.GLOW });
        }
        this.burst(pos, { element, count: 20, speed: 2, life: 1.4, size: 0.12, sprite: SPR.STAR, gravity: -1, upward: 0.5, drag: 1 });
        this.decal(ground, 'glyph', radius * 1.6, 2, 0xffd060);
        break;
      case 'shadow': case 'enemyPurple':
        this.smoke(pos, { count: Math.round(14 * s), size: 1.1 * s, color: [0.03, 0.0, 0.05], alpha: 0.8, life: 1.8, spread: radius * 0.4, speed: 3 });
        this.burst(pos, { element, count: 20, speed: 7, life: 0.8, size: 0.3, sprite: SPR.WISP, drag: 3, spin: 2 });
        break;
      case 'poison': case 'enemyGreen':
        this.smoke(pos, { count: Math.round(12 * s), size: 1.2 * s, color: [0.18, 0.35, 0.05], alpha: 0.45, life: 2.5, spread: radius * 0.5, speed: 2 });
        this.burst(pos, { element, count: 18, speed: 5, life: 1.0, size: 0.2, sprite: SPR.BUBBLE, gravity: 3, upward: 0.6 });
        this.decal(ground, 'slime', radius * 1.6, 10);
        break;
      case 'necrotic':
        this.burst(pos, { element, count: 24, speed: 6, life: 1.0, size: 0.35, sprite: SPR.WISP, drag: 2.5, upward: 0.3, spin: 2 });
        this.smoke(pos, { count: 8, size: 0.9, color: [0.04, 0.12, 0.04], alpha: 0.6 });
        break;
      case 'blood':
        this.burst(pos, { count: Math.round(40 * s), speed: 8 * s, life: 0.9, size: 0.1, sprite: SPR.DROP, gravity: 14, solid: true, color: [0.4, 0, 0.03], color2: [0.25, 0, 0.02], stretch: 0.05 });
        this.smoke(pos, { count: 6, size: 0.8, color: [0.3, 0.0, 0.02], alpha: 0.4 });
        this.decal(ground, 'blood', radius * 1.6, 14);
        break;
      case 'earth':
        this.burst(pos, { count: Math.round(30 * s), speed: 10 * s, life: 1.2, size: 0.25, sprite: SPR.CHUNK, gravity: 18, solid: true, color: [0.32, 0.27, 0.22], color2: [0.25, 0.2, 0.15], spin: 6, upward: 0.6 });
        this.smoke(pos, { count: Math.round(12 * s), size: 1.2 * s, color: [0.3, 0.25, 0.18], alpha: 0.5, life: 2.4, spread: radius * 0.5, speed: 3 });
        this.decal(ground, 'crack', radius * 1.8, 12);
        break;
      case 'time':
        this.ring({ x: pos.x, y: ground.y, z: pos.z }, radius * 0.7, fx.mid, 0.7, 0.1);
        this.burst(pos, { element, count: 16, speed: 4, life: 1.0, size: 0.4, sprite: SPR.RING, drag: 3 });
        this.decal(ground, 'glyph', radius * 1.6, 2, 0x40e0c8);
        break;
      case 'wind':
        for (let i = 0; i < 24; i++) {
          const a = (i / 24) * Math.PI * 2;
          this.P.glow({ x: pos.x + Math.cos(a) * 0.5, y: pos.y + rand(-0.5, 0.5), z: pos.z + Math.sin(a) * 0.5, vx: Math.cos(a + 1.2) * 10, vy: rand(0, 2), vz: Math.sin(a + 1.2) * 10, r: 1.4, g: 1.8, b: 1.8, life: 0.5, size: 0.3, sprite: SPR.WISP, stretch: 0.06, drag: 3 });
        }
        this.smoke(pos, { count: 6, size: 0.8, color: [0.5, 0.55, 0.55], alpha: 0.25 });
        break;
      case 'blade':
        this.burst(pos, { element, count: 18, speed: 12, life: 0.35, size: 0.06, sprite: SPR.SPARK, stretch: 0.08, drag: 3 });
        break;
      default:
        this.smoke(pos, { count: 6 });
    }
    this.addShake(Math.min(0.5, 0.12 * s) * (o.shakeScale ?? 1));
  }

  // generic projectile trail emission (call per frame)
  trail(pos, vel, element, intensity = 1, dt = 1 / 60) {
    const fx = fxOf(element);
    const n = Math.max(1, Math.round(intensity * 60 * dt * 2));
    for (let i = 0; i < n; i++) {
      const t = Math.random();
      const px = pos.x - vel.x * dt * t, py = pos.y - vel.y * dt * t, pz = pos.z - vel.z * dt * t;
      switch (element) {
        case 'fire': case 'enemyFire':
          this.P.glow({ x: px + rand(-0.05, 0.05), y: py + rand(-0.05, 0.05), z: pz + rand(-0.05, 0.05), vx: rand(-0.5, 0.5), vy: rand(0.2, 1.2), vz: rand(-0.5, 0.5), r: fx.mid[0] * 0.8, g: fx.mid[1] * 0.8, b: fx.mid[2] * 0.8, r2: fx.end[0], g2: fx.end[1], b2: fx.end[2], life: rand(0.2, 0.45), size: 0.24 * intensity, size2: 0.04, sprite: SPR.FLAME, drag: 2 });
          if (Math.random() < 0.3) this.P.glow({ x: px, y: py, z: pz, vx: rand(-1.5, 1.5), vy: rand(0, 2), vz: rand(-1.5, 1.5), r: 4, g: 1.6, b: 0.3, life: rand(0.4, 0.9), size: 0.04, sprite: SPR.EMBER, gravity: 2 });
          if (Math.random() < 0.12) this.P.solid({ x: px, y: py, z: pz, vy: 0.6, r: 0.06, g: 0.05, b: 0.04, a: 0.4, life: 1.2, size: 0.25, size2: 0.7, sprite: SPR.SMOKE, drag: 1 });
          break;
        case 'frost':
          this.P.glow({ x: px, y: py, z: pz, vx: rand(-0.4, 0.4), vy: rand(-0.4, 0.4), vz: rand(-0.4, 0.4), r: fx.mid[0], g: fx.mid[1], b: fx.mid[2], life: rand(0.2, 0.4), size: 0.18 * intensity, size2: 0.02, sprite: SPR.GLOW, drag: 2 });
          if (Math.random() < 0.4) this.P.glow({ x: px, y: py, z: pz, vx: rand(-1, 1), vy: rand(-1, 0.5), vz: rand(-1, 1), r: 2, g: 2.5, b: 3, life: rand(0.5, 1), size: 0.06, sprite: SPR.SNOW, spin: 3, gravity: 1 });
          break;
        case 'lightning':
          this.P.glow({ x: px + rand(-0.1, 0.1), y: py + rand(-0.1, 0.1), z: pz + rand(-0.1, 0.1), r: fx.core[0], g: fx.core[1], b: fx.core[2], life: rand(0.05, 0.15), size: 0.25 * intensity, sprite: SPR.BOLT, rot: rand(0, 6.28) });
          break;
        case 'shadow': case 'enemyPurple':
          this.P.glow({ x: px, y: py, z: pz, vx: rand(-0.5, 0.5), vy: rand(-0.5, 0.5), vz: rand(-0.5, 0.5), r: fx.mid[0], g: fx.mid[1], b: fx.mid[2], r2: fx.end[0], g2: fx.end[1], b2: fx.end[2], life: rand(0.3, 0.6), size: 0.25 * intensity, size2: 0.02, sprite: SPR.WISP, drag: 2, spin: 2 });
          if (Math.random() < 0.3) this.P.solid({ x: px, y: py, z: pz, r: 0.02, g: 0, b: 0.04, a: 0.6, life: 0.8, size: 0.2, size2: 0.5, sprite: SPR.SMOKE, drag: 1 });
          break;
        case 'poison': case 'enemyGreen':
          this.P.glow({ x: px, y: py, z: pz, vx: rand(-0.3, 0.3), vy: rand(-0.3, 0.3), vz: rand(-0.3, 0.3), r: fx.mid[0], g: fx.mid[1], b: fx.mid[2], life: rand(0.3, 0.5), size: 0.2 * intensity, size2: 0.03, sprite: SPR.GLOW, drag: 2 });
          if (Math.random() < 0.3) this.P.glow({ x: px, y: py, z: pz, vy: -1, r: 1.5, g: 2.5, b: 0.6, life: 0.6, size: 0.06, sprite: SPR.DROP, gravity: 6 });
          break;
        case 'earth':
          if (Math.random() < 0.5) this.P.solid({ x: px, y: py, z: pz, vx: rand(-1, 1), vy: rand(0, 1), vz: rand(-1, 1), r: 0.3, g: 0.25, b: 0.18, a: 0.45, life: 0.8, size: 0.2, size2: 0.5, sprite: SPR.SMOKE, drag: 1.5 });
          if (Math.random() < 0.3) this.P.solid({ x: px, y: py, z: pz, vx: rand(-1, 1), vy: rand(0, 2), vz: rand(-1, 1), r: 0.3, g: 0.25, b: 0.2, life: 0.6, size: 0.06, sprite: SPR.CHUNK, gravity: 12, spin: 5 });
          break;
        case 'blood':
          this.P.glow({ x: px, y: py, z: pz, vx: rand(-0.3, 0.3), vy: rand(-0.3, 0.3), vz: rand(-0.3, 0.3), r: fx.mid[0], g: fx.mid[1], b: fx.mid[2], life: rand(0.25, 0.4), size: 0.2 * intensity, size2: 0.02, sprite: SPR.GLOW, drag: 2 });
          if (Math.random() < 0.35) this.P.solid({ x: px, y: py, z: pz, vy: -0.5, r: 0.35, g: 0, b: 0.03, life: 0.6, size: 0.05, sprite: SPR.DROP, gravity: 10 });
          break;
        default:
          this.P.glow({ x: px, y: py, z: pz, vx: rand(-0.3, 0.3), vy: rand(-0.3, 0.3), vz: rand(-0.3, 0.3), r: fx.mid[0], g: fx.mid[1], b: fx.mid[2], r2: fx.end[0], g2: fx.end[1], b2: fx.end[2], life: rand(0.2, 0.45), size: 0.2 * intensity, size2: 0.02, sprite: fx.spr === SPR.CHUNK ? SPR.GLOW : fx.spr, drag: 2, spin: 2 });
      }
    }
  }

  // ambient emitters for torches/braziers/candles
  flame(f, dt) {
    const s = f.size;
    const col = f.color;
    let r = 4, g = 1.6, b = 0.4, r2 = 1.5, g2 = 0.2, b2 = 0.05;
    if (col) { const c = new THREE.Color(col); r = c.r * 4; g = c.g * 4; b = c.b * 4; r2 = c.r * 1.2; g2 = c.g * 0.5; b2 = c.b * 0.6; }
    if (f.kind === 'spores') {
      if (Math.random() < dt * 4) this.P.glow({ x: f.x + rand(-0.3, 0.3), y: f.y + rand(0, 0.4), z: f.z + rand(-0.3, 0.3), vx: rand(-0.1, 0.1), vy: rand(0.05, 0.25), vz: rand(-0.1, 0.1), r: 0.6, g: 2.4, b: 1.0, life: rand(2, 4), size: 0.04, sprite: SPR.GLOW, drag: 0.5 });
      return;
    }
    const rate = f.kind === 'candle' ? 10 : 34 * s;
    let n = rate * dt;
    while (n > 0) {
      if (n < 1 && Math.random() > n) break;
      n -= 1;
      this.P.glow({
        x: f.x + rand(-0.06, 0.06) * s, y: f.y + rand(0, 0.05), z: f.z + rand(-0.06, 0.06) * s,
        vx: rand(-0.15, 0.15), vy: (f.kind === 'candle' ? 0.25 : 0.8 * Math.sqrt(s)) + rand(0, 0.3), vz: rand(-0.15, 0.15),
        r, g, b, r2, g2, b2,
        life: f.kind === 'candle' ? rand(0.15, 0.25) : rand(0.35, 0.6), size: (f.kind === 'candle' ? 0.07 : 0.32 * s), size2: 0.03 * s, sprite: SPR.FLAME, rot: rand(-0.2, 0.2), drag: 1.5,
      });
    }
    if (f.kind !== 'candle') {
      if (Math.random() < dt * 3 * s) this.P.glow({ x: f.x, y: f.y + 0.2, z: f.z, vx: rand(-0.4, 0.4), vy: rand(0.8, 2), vz: rand(-0.4, 0.4), r: 4, g: 1.4, b: 0.3, life: rand(0.8, 1.6), size: 0.03, sprite: SPR.EMBER, drag: 0.8, gravity: -0.2 });
      if (Math.random() < dt * 1.5 * s) this.P.solid({ x: f.x, y: f.y + 0.4 * s, z: f.z, vx: rand(-0.1, 0.1), vy: rand(0.4, 0.8), vz: rand(-0.1, 0.1), r: 0.05, g: 0.045, b: 0.04, a: 0.25, life: 2.5, size: 0.2 * s, size2: 0.8 * s, sprite: SPR.SMOKE, drag: 0.6 });
      // soft glow halo
      if (Math.random() < dt * 8) this.P.glow({ x: f.x, y: f.y + 0.1 * s, z: f.z, r: r * 0.15, g: g * 0.15, b: b * 0.15, life: 0.3, size: 0.9 * s, size2: 0.9 * s, sprite: SPR.GLOW });
    }
  }
}
