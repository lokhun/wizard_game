import { bake, bakeMain, bakeLayer } from '../../render/bake.js';

// ---------------------------------------------------------------------------
// Extra procedural surfaces for creatures (flesh, fur, clean steel, chainmail,
// heavy wool, scales). Same scheme as render/textures.js: a GLSL surf()
// rendered into albedo / normal / ORM targets, cached per renderer.
// ---------------------------------------------------------------------------

const COMMON = /* glsl */ `
precision highp float;
uniform float uSeed;
uniform float uTexel;
varying vec2 vUv;
float hash12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031 + uSeed * 0.0371); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
vec2 hash22(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * vec3(.1031, .1030, .0973) + uSeed * 0.0213); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.xx + p3.yz) * p3.zy); }
float vn(vec2 p, vec2 per){
  vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3. - 2. * f);
  float a = hash12(mod(i, per)), b = hash12(mod(i + vec2(1, 0), per)), c = hash12(mod(i + vec2(0, 1), per)), d = hash12(mod(i + vec2(1, 1), per));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
float fbm(vec2 uv, vec2 sc, int oct){
  float s = 0., a = 0.5, t = 0.; vec2 p = uv * sc, per = sc;
  for (int i = 0; i < 7; i++){ if (i >= oct) break; s += a * vn(p, per); t += a; p *= 2.; per *= 2.; a *= 0.5; }
  return s / t;
}
vec3 vor(vec2 uv, float sc){
  vec2 p = uv * sc, i = floor(p), f = fract(p); float d1 = 9., d2 = 9.; float id = 0.;
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++){
    vec2 g = vec2(x, y); vec2 o = hash22(mod(i + g, vec2(sc))); vec2 r = g + o - f; float d = dot(r, r);
    if (d < d1){ d2 = d1; d1 = d; id = hash12(mod(i + g, vec2(sc))); } else if (d < d2) d2 = d;
  }
  return vec3(sqrt(d1), sqrt(d2), id);
}
vec3 srgb(vec3 c){ return pow(c, vec3(2.2)); }
float gEm = 0.;
`;

const SURFS = {
  // pale, mottled skin with pores, wrinkles and faint veins (neutral, tint with vertex colour)
  flesh: /* glsl */ `
  void surf(vec2 uv, out vec3 col, out float h, out float rough, out float metal, out float ao){
    float m = fbm(uv, vec2(6.), 5);
    float m2 = fbm(uv + 3.1, vec2(14.), 4);
    float pores = smoothstep(0.62, 0.8, fbm(uv, vec2(90.), 2));
    float wr = abs(sin((uv.y + fbm(uv, vec2(5.), 3) * 0.3) * 70.)) ; wr = smoothstep(0.0, 0.25, wr);
    vec3 v = vor(uv, 7.); float vein = 1. - smoothstep(0.0, 0.02, v.y - v.x); vein *= smoothstep(0.45, 0.7, fbm(uv + 7., vec2(4.), 3));
    vec3 c = vec3(0.62, 0.59, 0.56) * (0.82 + 0.3 * m);
    c = mix(c, vec3(0.62, 0.52, 0.52), smoothstep(0.55, 0.8, m2) * 0.5);
    c = mix(c, vec3(0.45, 0.42, 0.55), vein * 0.45);
    c *= 1. - pores * 0.12;
    col = srgb(c);
    h = 0.5 + m * 0.35 - pores * 0.05 - (1. - wr) * 0.015 + vein * 0.04;
    rough = 0.62 + m2 * 0.2 - vein * 0.1;
    metal = 0.; ao = 1. - pores * 0.2;
  }`,
  // matted fur strands running along v
  fur: /* glsl */ `
  void surf(vec2 uv, out vec3 col, out float h, out float rough, out float metal, out float ao){
    vec2 w = uv + vec2(fbm(uv, vec2(4.), 3) - 0.5, 0.) * 0.15;
    float strands = fbm(vec2(w.x * 1., w.y * 0.12), vec2(160., 10.), 3);
    float clump = fbm(uv, vec2(10.), 4);
    float s = smoothstep(0.3, 0.8, strands * 0.5 + clump * 0.6);
    vec3 c = mix(vec3(0.5, 0.47, 0.44), vec3(0.8, 0.77, 0.73), s);
    c *= 0.8 + 0.3 * fbm(uv + 2., vec2(5.), 3);
    col = srgb(c);
    h = s * 0.7 + clump * 0.3;
    rough = 0.9; metal = 0.; ao = 0.6 + 0.4 * s;
  }`,
  // clean forged steel: hammer dents, fine scratches, slight grime
  steel: /* glsl */ `
  void surf(vec2 uv, out vec3 col, out float h, out float rough, out float metal, out float ao){
    vec3 v = vor(uv, 7.);
    float dent = smoothstep(0.0, 0.9, v.x) * 0.12;
    float scr = smoothstep(0.88, 1.0, fbm(vec2(uv.x * 0.3, uv.y * 8.), vec2(30., 60.), 3));
    float grime = smoothstep(0.5, 0.85, fbm(uv + 4., vec2(5.), 5));
    float n = fbm(uv, vec2(20.), 4);
    vec3 c = vec3(0.62, 0.62, 0.64) * (0.85 + 0.2 * n) + scr * 0.15;
    c = mix(c, vec3(0.2, 0.18, 0.16), grime * 0.6);
    col = srgb(c);
    h = dent * 0.3 + n * 0.1 - scr * 0.05;
    rough = mix(0.38, 0.75, grime) + n * 0.1 - scr * 0.1;
    metal = mix(1.0, 0.6, grime); ao = 1.;
  }`,
  // charred hide with a sparse network of glowing cracks (mask in ORM alpha)
  charred: /* glsl */ `
  void surf(vec2 uv, out vec3 col, out float h, out float rough, out float metal, out float ao){
    vec3 v = vor(uv + (vec2(fbm(uv, vec2(6.), 3), fbm(uv + 3., vec2(6.), 3)) - 0.5) * 0.06, 9.);
    float edge = v.y - v.x;
    float on = step(0.5, hash12(vec2(v.z * 91., 7.)));
    float crack = (1. - smoothstep(0.0, 0.045, edge)) * on;
    crack *= smoothstep(0.3, 0.6, fbm(uv + 9., vec2(5.), 3));
    float n = fbm(uv, vec2(12.), 5);
    float plate = smoothstep(0.02, 0.2, edge);
    vec3 c = mix(vec3(0.16, 0.13, 0.12), vec3(0.32, 0.27, 0.25), n) * (0.75 + 0.35 * plate);
    c = mix(c, vec3(0.5, 0.18, 0.06), crack * 0.6);
    col = srgb(c);
    h = plate * 0.6 + n * 0.3 - crack * 0.3;
    rough = 0.85 - crack * 0.3; metal = 0.; ao = mix(0.6, 1., plate);
    gEm = crack;
  }`,
  // grey stone with occasional deep glowing fissures (wyvern)
  magmastone: /* glsl */ `
  void surf(vec2 uv, out vec3 col, out float h, out float rough, out float metal, out float ao){
    vec3 v = vor(uv + (vec2(fbm(uv, vec2(4.), 3), fbm(uv + 3., vec2(4.), 3)) - 0.5) * 0.08, 6.);
    float edge = v.y - v.x;
    float on = step(0.6, hash12(vec2(v.z * 37., 3.)));
    float crack = (1. - smoothstep(0.0, 0.022, edge)) * on * smoothstep(0.45, 0.65, fbm(uv + 2., vec2(4.), 3));
    float n = fbm(uv, vec2(10.), 5), d = fbm(uv, vec2(40.), 3);
    float pits = smoothstep(0.7, 0.85, fbm(uv + 5., vec2(25.), 3));
    vec3 c = vec3(0.42, 0.4, 0.38) * (0.7 + 0.35 * n) * (0.9 + 0.2 * d) * (1. - pits * 0.3);
    c = mix(c, vec3(0.2, 0.22, 0.14), smoothstep(0.62, 0.8, fbm(uv + 7., vec2(5.), 4)) * 0.5);
    c = mix(c, vec3(0.35, 0.12, 0.04), crack);
    col = srgb(c);
    h = 0.5 + n * 0.3 + d * 0.1 - pits * 0.15 - crack * 0.4;
    rough = 0.9 - crack * 0.3; metal = 0.; ao = 1. - pits * 0.3 - crack * 0.3;
    gEm = crack;
  }`,
  // weathered grey stone (gargoyle): soft mottling, pits, lichen
  weathered: /* glsl */ `
  void surf(vec2 uv, out vec3 col, out float h, out float rough, out float metal, out float ao){
    float n = fbm(uv, vec2(8.), 5), d = fbm(uv, vec2(48.), 3);
    float pits = smoothstep(0.68, 0.85, fbm(uv + 5., vec2(30.), 3));
    float lichen = smoothstep(0.6, 0.78, fbm(uv + 1.3, vec2(6.), 5));
    vec3 c = vec3(0.5, 0.49, 0.47) * (0.75 + 0.3 * n) * (0.92 + 0.15 * d) * (1. - pits * 0.35);
    c = mix(c, vec3(0.3, 0.33, 0.2), lichen * 0.45);
    col = srgb(c);
    h = 0.5 + n * 0.25 + d * 0.12 - pits * 0.2;
    rough = 0.92; metal = 0.; ao = 1. - pits * 0.35;
  }`,
  // riveted chainmail rings
  mail: /* glsl */ `
  void surf(vec2 uv, out vec3 col, out float h, out float rough, out float metal, out float ao){
    vec2 p = uv * vec2(64., 48.);
    float row = floor(p.y);
    p.x += mod(row, 2.) * 0.5;
    vec2 f = fract(p) - 0.5;
    float r = length(f * vec2(1., 1.25));
    float ring = smoothstep(0.18, 0.26, r) * (1. - smoothstep(0.36, 0.46, r));
    float grime = smoothstep(0.45, 0.85, fbm(uv, vec2(6.), 4));
    float rust = smoothstep(0.6, 0.85, fbm(uv + 2., vec2(9.), 4));
    vec3 c = mix(vec3(0.05), vec3(0.6, 0.6, 0.62) * (0.8 + 0.3 * hash12(floor(p))), ring);
    c = mix(c, vec3(0.38, 0.2, 0.08) * ring, rust * 0.7);
    c *= 1. - grime * 0.4;
    col = srgb(c);
    h = ring * 0.8;
    rough = mix(0.9, 0.4, ring) + rust * 0.3;
    metal = ring * (1. - rust * 0.7); ao = mix(0.4, 1., ring);
  }`,
  // heavy wool / burlap with folds and grime (no fine weave aliasing)
  wool: /* glsl */ `
  void surf(vec2 uv, out vec3 col, out float h, out float rough, out float metal, out float ao){
    float fib = fbm(vec2(uv.x * 2., uv.y), vec2(120., 60.), 2);
    float n = fbm(uv, vec2(8.), 5);
    float stain = smoothstep(0.55, 0.85, fbm(uv + 1.7, vec2(4.), 5));
    float wear = smoothstep(0.7, 0.9, fbm(uv + 5.1, vec2(12.), 4));
    vec3 c = vec3(0.78) * (0.75 + 0.25 * n) * (0.92 + 0.12 * fib);
    c *= 1. - stain * 0.45;
    c = mix(c, c * 1.25, wear * 0.4);
    col = srgb(c);
    h = 0.5 + n * 0.3 + fib * 0.1;
    rough = 0.97; metal = 0.; ao = 0.85 + 0.15 * n;
  }`,
  // overlapping scales (wyvern / demon hide)
  scales: /* glsl */ `
  void surf(vec2 uv, out vec3 col, out float h, out float rough, out float metal, out float ao){
    vec2 p = uv * vec2(24., 32.);
    float row = floor(p.y); p.x += mod(row, 2.) * 0.5;
    vec2 f = fract(p); vec2 c0 = f - vec2(0.5, 0.0);
    float d = length(c0 * vec2(1., 0.9));
    float sc = smoothstep(0.62, 0.5, d);
    float n = fbm(uv, vec2(8.), 4);
    vec3 c = vec3(0.7) * (0.6 + 0.5 * f.y) * (0.85 + 0.3 * n);
    col = srgb(mix(vec3(0.12), c, sc));
    h = sc * f.y * 0.8 + n * 0.1;
    rough = 0.55 + 0.3 * (1. - sc); metal = 0.; ao = mix(0.5, 1., sc * f.y);
  }`,
};
const NORMAL_K = { flesh: 0.45, fur: 0.8, steel: 0.25, mail: 1.2, wool: 0.5, scales: 1.2, charred: 1.0, magmastone: 1.2, weathered: 0.9 };

const VERT = /* glsl */ `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0., 1.); }`;
// ORM alpha carries surf()'s emissive cracks (gEm)
function frag(name) {
  return COMMON + SURFS[name] + bakeMain((NORMAL_K[name] ?? 1).toFixed(2), 'gEm');
}

const cache = new WeakMap();
export const CREATURE_SURFACES = Object.keys(SURFS);

export function creatureSurface(renderer, name, size = 512, seed = 1) {
  let m = cache.get(renderer);
  if (!m) { m = new Map(); cache.set(renderer, m); }
  const key = `${name}:${size}:${seed}`;
  if (m.has(key)) return m.get(key);
  const [map, normalMap, ormMap] = bake(renderer, VERT, frag(name), { size, seed }).map((rt) => rt.texture);
  const set = { map, normalMap, ormMap };
  m.set(key, set);
  return set;
}

// Bakes a creature surface into a layer of three array targets (bake.js arrayTargets)
export function creatureLayer(renderer, name, size, seed, targets, layer) {
  bakeLayer(renderer, VERT, frag(name), { size, seed }, targets, layer);
}

// The bake shaders of every creature surface, for warmBakes.
export function creatureBakes(names = CREATURE_SURFACES) {
  return names.map((n) => ({ vert: VERT, frag: frag(n) }));
}
