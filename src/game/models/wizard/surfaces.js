import * as THREE from 'three';
import { bake, bakeMain } from '../../../render/bake.js';

// ---------------------------------------------------------------------------
// Extra procedural surfaces for the wizard models (bark grain running along a
// staff, brushed metal, skin, fur), rendered on the GPU with the same recipe
// as render/textures.js: albedo (sRGB), normal (from height) and ORM.
// Plus a few canvas-drawn glyph textures (runes, sigils, pages, veins).
// All results are cached per TextureFactory / globally.
// ---------------------------------------------------------------------------

const COMMON = /* glsl */ `
precision highp float;
uniform float uSeed;
uniform float uTexel;
varying vec2 vUv;
float hash12(vec2 p){
  vec3 p3 = fract(vec3(p.xyx) * .1031 + uSeed * 0.0371);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
vec2 gradv(vec2 i){ float a = hash12(i) * 6.2831853; return vec2(cos(a), sin(a)); }
float gnoise(vec2 p, vec2 per){
  vec2 i = floor(p), f = fract(p);
  vec2 u = f*f*f*(f*(f*6.-15.)+10.);
  float a = dot(gradv(mod(i, per)), f);
  float b = dot(gradv(mod(i + vec2(1,0), per)), f - vec2(1,0));
  float c = dot(gradv(mod(i + vec2(0,1), per)), f - vec2(0,1));
  float d = dot(gradv(mod(i + vec2(1,1), per)), f - vec2(1,1));
  return 0.5 + 0.75 * mix(mix(a,b,u.x), mix(c,d,u.x), u.y);
}
// anisotropic periodic fbm (separate x/y scales)
float fbm2(vec2 uv, vec2 scale, int oct){
  float s = 0., a = 0.5, tot = 0.;
  vec2 per = scale;
  vec2 p = uv * scale;
  for (int i = 0; i < 8; i++){
    if (i >= oct) break;
    s += a * gnoise(p, per); tot += a;
    p *= 2.; per *= 2.; a *= 0.5;
  }
  return s / tot;
}
float fbm(vec2 uv, float scale, int oct){ return fbm2(uv, vec2(scale), oct); }
vec3 srgb(vec3 c){ return pow(c, vec3(2.2)); }
`;

const SURFS = {
  // Wood grain running along V (the length of a cylinder). Neutral mid brown
  // so it can be tinted to charred blackwood, pale ash or driftwood.
  bark: /* glsl */ `
  void surf(vec2 uv, out vec3 col, out float h, out float rough, out float metal, out float ao){
    vec2 w = uv + vec2(fbm2(uv, vec2(3., 2.), 4) - 0.5, 0.) * 0.25;
    float streak = fbm2(w, vec2(24., 2.), 5);
    float fine = fbm2(w, vec2(90., 4.), 3);
    float rings = sin(w.x * 6.2831 * 18. + streak * 9.) * 0.5 + 0.5;
    float crack = smoothstep(0.72, 0.9, fbm2(w + 3.1, vec2(14., 1.), 4));
    float knotN = fbm(uv + 7.7, 3., 4);
    float knot = smoothstep(0.66, 0.78, knotN);
    h = 0.45 + streak * 0.3 + rings * 0.12 + fine * 0.1 - crack * 0.35 + knot * 0.1;
    vec3 c = mix(vec3(0.62, 0.58, 0.54), vec3(0.86, 0.82, 0.76), streak);
    c *= 0.8 + 0.22 * rings + 0.12 * fine;
    c = mix(c, c * 0.4, crack);
    c = mix(c, c * 0.6, knot * 0.7);
    col = srgb(c);
    rough = 0.78 - streak * 0.12 + crack * 0.15;
    metal = 0.;
    ao = 1. - crack * 0.5;
  }`,

  // Brushed, slightly hammered and tarnished neutral metal (tint for brass,
  // copper, silver, steel).
  metal: /* glsl */ `
  void surf(vec2 uv, out vec3 col, out float h, out float rough, out float metal, out float ao){
    float brush = fbm2(uv, vec2(2., 120.), 3);
    float ham = fbm(uv, 10., 4);
    float tarnish = smoothstep(0.5, 0.82, fbm(uv + 1.3, 5., 5));
    float scratch = smoothstep(0.88, 1.0, fbm2(uv + 4., vec2(60., 3.), 3));
    float pit = smoothstep(0.75, 0.9, fbm(uv + 9., 40., 3));
    h = 0.5 + ham * 0.25 + brush * 0.05 - pit * 0.2;
    vec3 c = vec3(0.86) * (0.88 + 0.12 * brush) * (0.92 + 0.12 * ham);
    c = mix(c, c * vec3(0.32, 0.30, 0.26), tarnish * 0.75);
    c *= 1. - pit * 0.5;
    c += scratch * 0.12;
    col = srgb(c);
    rough = mix(0.28, 0.62, tarnish) + brush * 0.08 - scratch * 0.1 + pit * 0.2;
    metal = mix(1., 0.75, tarnish);
    ao = 1. - pit * 0.4;
  }`,

  // Skin: subtle pores, mottling and creases. Neutral warm tone.
  skin: /* glsl */ `
  void surf(vec2 uv, out vec3 col, out float h, out float rough, out float metal, out float ao){
    float n = fbm(uv, 6., 5);
    float pores = smoothstep(0.7, 0.85, fbm(uv, 90., 3)) * 0.5;
    float crease = smoothstep(0.75, 0.9, fbm2(uv + 2., vec2(4., 30.), 4));
    float blot = fbm(uv + 5., 3., 4);
    float flush = smoothstep(0.45, 0.8, fbm(uv + 9., 4., 4));
    h = 0.5 + n * 0.15 - pores * 0.14 - crease * 0.26;
    // living skin: warm base with ruddy patches, darker creases, no plastic white
    vec3 c = mix(vec3(0.86, 0.78, 0.74), vec3(0.84, 0.66, 0.62), blot);
    c = mix(c, vec3(0.82, 0.56, 0.52), flush * 0.45);
    c *= 0.9 + 0.14 * n;
    c *= 1. - crease * 0.24 - pores * 0.08;
    col = srgb(c);
    rough = 0.55 + pores * 0.2 + crease * 0.1;
    metal = 0.;
    ao = 1. - crease * 0.3;
  }`,

  // Fur: dense strands along V with clumping.
  fur: /* glsl */ `
  void surf(vec2 uv, out vec3 col, out float h, out float rough, out float metal, out float ao){
    vec2 w = uv + vec2(fbm(uv, 4., 3) - 0.5, 0.) * 0.15;
    float strands = fbm2(w, vec2(160., 6.), 3);
    float clump = fbm2(w, vec2(18., 3.), 4);
    float tips = fract(uv.y * 8. + clump * 2.);
    h = strands * 0.6 + clump * 0.4;
    vec3 c = vec3(0.86, 0.84, 0.80) * (0.55 + 0.45 * strands) * (0.75 + 0.35 * clump);
    c *= 0.8 + 0.2 * tips;
    col = srgb(c);
    rough = 0.95;
    metal = 0.;
    ao = 0.6 + 0.4 * h;
  }`,

  // Heavy wool robe fabric: soft twill, fibre noise, wear and grime.
  robe: /* glsl */ `
  void surf(vec2 uv, out vec3 col, out float h, out float rough, out float metal, out float ao){
    float tw = sin((uv.x + uv.y) * 6.2831 * 60.) * 0.5 + 0.5;
    float fib = fbm2(uv, vec2(140., 30.), 3);
    float n = fbm(uv, 6., 5);
    float wear = smoothstep(0.55, 0.85, fbm(uv + 3.3, 4., 5));
    float grime = smoothstep(0.45, 0.9, fbm(uv + 8.1, 3., 5));
    float xw = fbm2(uv + 5.5, vec2(30., 140.), 3);
    h = 0.5 + tw * 0.015 + fib * 0.08 + xw * 0.06 + n * 0.1;
    vec3 c = vec3(0.78) * (0.9 + 0.1 * xw) * (0.88 + 0.14 * fib) * (0.85 + 0.25 * n);
    c = mix(c, c * 1.18, wear * 0.5);
    c *= 1. - grime * 0.3;
    col = srgb(c);
    rough = 0.92;
    metal = 0.;
    ao = 0.85 + 0.15 * tw;
  }`,

  // Stitched glove leather, smoother and darker than the world leather.
  glove: /* glsl */ `
  void surf(vec2 uv, out vec3 col, out float h, out float rough, out float metal, out float ao){
    float n = fbm(uv, 8., 5);
    float grain = fbm(uv, 70., 3);
    float wear = smoothstep(0.55, 0.85, fbm(uv + 2.2, 6., 5));
    float wr = smoothstep(0.7, 0.9, fbm2(uv + 6., vec2(3., 40.), 4));
    h = 0.5 + n * 0.12 + grain * 0.08 - wr * 0.2;
    vec3 c = vec3(0.72, 0.7, 0.68) * (0.85 + 0.25 * n) * (0.9 + 0.1 * grain);
    c = mix(c, c * 1.6, wear * 0.5);
    c *= 1. - wr * 0.3;
    col = srgb(c);
    rough = 0.58 + 0.15 * grain - wear * 0.1;
    metal = 0.;
    ao = 1. - wr * 0.3;
  }`,
};

const NS = { bark: 1.6, metal: 0.5, skin: 0.42, fur: 1.2, glove: 0.6, robe: 0.45 };

const VERT = /* glsl */ `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0., 1.); }`;

function fragFor(name) {
  return COMMON + SURFS[name] + bakeMain((NS[name] ?? 1).toFixed(2));
}

const factoryCache = new WeakMap();

// { map, normalMap, ormMap } for one of the wizard surfaces, or falls back to
// the shared TextureFactory surfaces (wood, iron, gold, cloth, bone, leather...).
export function getSurface(factory, name, size = 512, seed = 1) {
  if (!SURFS[name]) return factory.get(name, 1024, seed);
  let cache = factoryCache.get(factory);
  if (!cache) { cache = new Map(); factoryCache.set(factory, cache); }
  const key = `${name}:${size}:${seed}`;
  if (cache.has(key)) return cache.get(key);
  const [map, normalMap, ormMap] = bake(factory.renderer, VERT, fragFor(name), { size, seed, anisotropy: factory.maxAniso ?? 4 }).map((rt) => rt.texture);
  const set = { map, normalMap, ormMap };
  cache.set(key, set);
  return set;
}

// The bake shaders of every wizard surface, for warmBakes.
export function wizardBakes() {
  return Object.keys(SURFS).map((n) => ({ vert: VERT, frag: fragFor(n) }));
}

// ---------------------------------------------------------------------------
// Canvas glyph textures
// ---------------------------------------------------------------------------
const glyphCache = new Map();

function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return ((s >>> 0) % 100000) / 100000; };
}

function canvasTex(key, size, draw, opts = {}) {
  if (glyphCache.has(key)) return glyphCache.get(key);
  const c = document.createElement('canvas');
  c.width = size; c.height = opts.h ?? size;
  const g = c.getContext('2d');
  draw(g, c.width, c.height);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = opts.srgb === false ? THREE.NoColorSpace : THREE.SRGBColorSpace;
  t.anisotropy = 4;
  if (opts.repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; }
  glyphCache.set(key, t);
  return t;
}

// draw one random rune glyph centered at (x,y) with size s
function drawRune(g, r, x, y, s) {
  const pts = [];
  const n = 2 + Math.floor(r() * 3);
  g.beginPath();
  // spine
  const top = [x + (r() - 0.5) * s * 0.3, y - s / 2], bot = [x + (r() - 0.5) * s * 0.3, y + s / 2];
  g.moveTo(...top); g.lineTo(...bot);
  for (let i = 0; i < n; i++) {
    const t = r();
    const px = top[0] + (bot[0] - top[0]) * t, py = top[1] + (bot[1] - top[1]) * t;
    const dir = r() < 0.5 ? -1 : 1;
    const ex = px + dir * s * (0.25 + r() * 0.3), ey = py + (r() - 0.5) * s * 0.6;
    g.moveTo(px, py); g.lineTo(ex, ey);
    pts.push([ex, ey]);
  }
  if (r() < 0.4) { g.moveTo(x + s * 0.18, y); g.arc(x, y, s * 0.18, 0, Math.PI * 2); }
  g.stroke();
}

// White ring of runes on transparent: use as map on an additive material.
export function runeRingTexture(seed = 1, opts = {}) {
  const inner = opts.inner ?? true;
  return canvasTex(`ring:${seed}:${inner}`, 512, (g, w) => {
    const r = rng(seed * 977 + 13);
    const c = w / 2;
    g.strokeStyle = '#fff'; g.fillStyle = '#fff';
    g.lineCap = 'round';
    g.shadowColor = '#fff'; g.shadowBlur = 8;
    g.lineWidth = 7; g.beginPath(); g.arc(c, c, w * 0.47, 0, Math.PI * 2); g.stroke();
    g.lineWidth = 3; g.beginPath(); g.arc(c, c, w * 0.43, 0, Math.PI * 2); g.stroke();
    g.lineWidth = 3; g.beginPath(); g.arc(c, c, w * 0.30, 0, Math.PI * 2); g.stroke();
    const n = 14;
    g.lineWidth = 4;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      g.save();
      g.translate(c + Math.cos(a) * w * 0.365, c + Math.sin(a) * w * 0.365);
      g.rotate(a + Math.PI / 2);
      drawRune(g, r, 0, 0, w * 0.075);
      g.restore();
    }
    if (inner) {
      // inner star / polygon
      const k = 5 + Math.floor(r() * 3);
      g.lineWidth = 3;
      g.beginPath();
      for (let i = 0; i <= k; i++) {
        const a = (i * 2 / k) * Math.PI * 2 - Math.PI / 2;
        const x = c + Math.cos(a) * w * 0.28, y = c + Math.sin(a) * w * 0.28;
        if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
      }
      g.stroke();
      g.beginPath(); g.arc(c, c, w * 0.07, 0, Math.PI * 2); g.stroke();
    }
  });
}

// Clock face with numerals ticks for the chronomancer
export function clockFaceTexture() {
  return canvasTex('clock', 512, (g, w) => {
    const c = w / 2;
    g.strokeStyle = '#fff'; g.fillStyle = '#fff'; g.lineCap = 'round';
    g.shadowColor = '#fff'; g.shadowBlur = 6;
    g.lineWidth = 6; g.beginPath(); g.arc(c, c, w * 0.46, 0, Math.PI * 2); g.stroke();
    g.lineWidth = 2; g.beginPath(); g.arc(c, c, w * 0.40, 0, Math.PI * 2); g.stroke();
    for (let i = 0; i < 60; i++) {
      const a = (i / 60) * Math.PI * 2;
      const l = i % 5 === 0 ? 0.08 : 0.03;
      g.lineWidth = i % 5 === 0 ? 5 : 2;
      g.beginPath();
      g.moveTo(c + Math.cos(a) * w * 0.40, c + Math.sin(a) * w * 0.40);
      g.lineTo(c + Math.cos(a) * w * (0.40 - l), c + Math.sin(a) * w * (0.40 - l));
      g.stroke();
    }
    const numer = ['XII', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI'];
    g.font = `bold ${w * 0.06}px serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2 - Math.PI / 2;
      g.fillText(numer[i], c + Math.cos(a) * w * 0.27, c + Math.sin(a) * w * 0.27);
    }
  });
}

// Tattoo sigils for warlock hand (emissive map, tiling).
export function sigilTexture(seed = 3) {
  return canvasTex(`sigil:${seed}`, 512, (g, w) => {
    const r = rng(seed * 131 + 7);
    g.fillStyle = '#000'; g.fillRect(0, 0, w, w);
    g.strokeStyle = '#fff'; g.lineCap = 'round'; g.lineJoin = 'round';
    g.shadowColor = '#fff'; g.shadowBlur = 4;
    // flowing lines along v (finger length)
    for (let k = 0; k < 6; k++) {
      g.lineWidth = 3 + r() * 3;
      g.beginPath();
      const x0 = r() * w;
      g.moveTo(x0, 0);
      for (let y = 0; y <= w; y += 16) g.lineTo(x0 + Math.sin(y * 0.03 + k) * 18 + (r() - 0.5) * 6, y);
      g.stroke();
    }
    g.lineWidth = 4;
    for (let i = 0; i < 18; i++) drawRune(g, r, r() * w, r() * w, 30 + r() * 30);
    for (let i = 0; i < 6; i++) {
      g.beginPath(); g.arc(r() * w, r() * w, 10 + r() * 20, 0, Math.PI * 2); g.stroke();
    }
  }, { repeat: true, srgb: true });
}

// Branching veins (bloodmage), white on black emissive map, tiling.
export function veinTexture(seed = 5) {
  return canvasTex(`vein:${seed}`, 512, (g, w) => {
    const r = rng(seed * 71 + 3);
    g.fillStyle = '#000'; g.fillRect(0, 0, w, w);
    g.strokeStyle = '#fff'; g.lineCap = 'round';
    g.shadowColor = '#fff'; g.shadowBlur = 6;
    const branch = (x, y, a, len, wd, depth) => {
      if (depth > 5 || wd < 0.6) return;
      let cx = x, cy = y;
      const steps = 6;
      g.lineWidth = wd;
      g.beginPath(); g.moveTo(cx, cy);
      for (let i = 0; i < steps; i++) {
        a += (r() - 0.5) * 0.7;
        cx += Math.cos(a) * len / steps; cy += Math.sin(a) * len / steps;
        g.lineTo(cx, cy);
      }
      g.stroke();
      const n = 1 + (r() < 0.6 ? 1 : 0);
      for (let i = 0; i < n; i++) branch(cx, cy, a + (r() - 0.5) * 1.6, len * 0.7, wd * 0.65, depth + 1);
    };
    for (let i = 0; i < 7; i++) {
      const x = r() * w;
      branch(x, 0, Math.PI / 2 + (r() - 0.5) * 0.4, w * 0.45, 6, 0);
      branch(x, w, -Math.PI / 2 + (r() - 0.5) * 0.4, w * 0.3, 4, 1);
    }
  }, { repeat: true, srgb: true });
}

// Open book page: parchment albedo with ink text and illuminated diagram.
export function pageTexture(seed = 2) {
  return canvasTex(`page:${seed}`, 256, (g, w, h) => {
    const r = rng(seed * 53 + 11);
    const grd = g.createRadialGradient(w / 2, h / 2, 10, w / 2, h / 2, w * 0.8);
    grd.addColorStop(0, '#e8d8b0'); grd.addColorStop(1, '#a88a58');
    g.fillStyle = grd; g.fillRect(0, 0, w, h);
    g.strokeStyle = 'rgba(60,30,10,0.85)'; g.lineWidth = 1.5;
    const top = 20;
    for (let y = top; y < h - 16; y += 11) {
      if (y > h * 0.35 && y < h * 0.65) continue;
      let x = 16;
      while (x < w - 18) {
        const l = 6 + r() * 20;
        g.beginPath(); g.moveTo(x, y); g.lineTo(Math.min(x + l, w - 16), y + (r() - 0.5)); g.stroke();
        x += l + 5;
      }
    }
    // diagram circle in the middle
    g.strokeStyle = 'rgba(90,20,40,0.9)'; g.lineWidth = 2;
    g.beginPath(); g.arc(w / 2, h / 2, h * 0.13, 0, Math.PI * 2); g.stroke();
    g.beginPath();
    for (let i = 0; i <= 5; i++) {
      const a = (i * 2 / 5) * Math.PI * 2 - Math.PI / 2;
      const x = w / 2 + Math.cos(a) * h * 0.13, y = h / 2 + Math.sin(a) * h * 0.13;
      if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
    }
    g.stroke();
    // stains
    for (let i = 0; i < 4; i++) {
      g.fillStyle = `rgba(80,50,20,${0.05 + r() * 0.08})`;
      g.beginPath(); g.arc(r() * w, r() * h, 8 + r() * 26, 0, Math.PI * 2); g.fill();
    }
  }, { h: 340 });
}

// Matching glow mask for the page (diagram + a few glowing runes)
export function pageGlowTexture(seed = 2) {
  return canvasTex(`pageglow:${seed}`, 256, (g, w, h) => {
    const r = rng(seed * 53 + 99);
    g.fillStyle = '#000'; g.fillRect(0, 0, w, h);
    g.strokeStyle = '#fff'; g.lineWidth = 3; g.shadowColor = '#fff'; g.shadowBlur = 10;
    g.beginPath(); g.arc(w / 2, h / 2, h * 0.13, 0, Math.PI * 2); g.stroke();
    g.beginPath();
    for (let i = 0; i <= 5; i++) {
      const a = (i * 2 / 5) * Math.PI * 2 - Math.PI / 2;
      const x = w / 2 + Math.cos(a) * h * 0.13, y = h / 2 + Math.sin(a) * h * 0.13;
      if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
    }
    g.stroke();
    g.lineWidth = 2.5;
    for (let i = 0; i < 6; i++) drawRune(g, r, 24 + r() * (w - 48), 24 + r() * (h - 48), 16);
  }, { h: 340 });
}

// Soft radial glow (for halo cards).
export function glowTexture() {
  return canvasTex('glow', 128, (g, w) => {
    const grd = g.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2);
    grd.addColorStop(0, 'rgba(255,255,255,1)');
    grd.addColorStop(0.25, 'rgba(255,255,255,0.55)');
    grd.addColorStop(0.6, 'rgba(255,255,255,0.12)');
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd; g.fillRect(0, 0, w, w);
  });
}

// Wispy streak texture for wind shells / mist (white on transparent, tiling in U)
export function streakTexture(seed = 4) {
  return canvasTex(`streak:${seed}`, 256, (g, w, h) => {
    const r = rng(seed * 19 + 5);
    g.clearRect(0, 0, w, h);
    for (let i = 0; i < 26; i++) {
      const y = r() * h, x = r() * w, l = w * (0.2 + r() * 0.5), th = 2 + r() * 7;
      const grd = g.createLinearGradient(x, 0, x + l, 0);
      grd.addColorStop(0, 'rgba(255,255,255,0)');
      grd.addColorStop(0.5, `rgba(255,255,255,${0.35 + r() * 0.6})`);
      grd.addColorStop(1, 'rgba(255,255,255,0)');
      g.strokeStyle = grd; g.lineWidth = th; g.lineCap = 'round';
      g.beginPath(); g.moveTo(x, y);
      g.bezierCurveTo(x + l * 0.3, y + (r() - 0.5) * 20, x + l * 0.6, y + (r() - 0.5) * 20, x + l, y + (r() - 0.5) * 10);
      g.stroke();
      // wrap horizontally
      g.save(); g.translate(-w, 0);
      g.beginPath(); g.moveTo(x, y);
      g.bezierCurveTo(x + l * 0.3, y, x + l * 0.6, y, x + l, y);
      g.stroke(); g.restore();
    }
  }, { repeat: true, h: 128 });
}

// Flame tongue gradient (vertical): bright base fading to transparent tip
export function flameTexture() {
  return canvasTex('flame', 64, (g, w, h) => {
    const grd = g.createLinearGradient(0, h, 0, 0);
    grd.addColorStop(0, 'rgba(255,255,255,0.0)');
    grd.addColorStop(0.12, 'rgba(255,255,255,1)');
    grd.addColorStop(0.5, 'rgba(255,255,255,0.6)');
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd; g.fillRect(0, 0, w, h);
  }, { h: 128 });
}
