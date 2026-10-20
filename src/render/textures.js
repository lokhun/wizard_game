import * as THREE from 'three';

// ---------------------------------------------------------------------------
// GPU procedural texture generation.
// Each material is a GLSL "surf" function producing albedo, height, roughness
// and metalness for a tileable UV square. We render it three times into
// render targets: albedo (sRGB), normal (from height), and ORM
// (occlusion/roughness/metalness, matching three's packing).
// Everything is periodic so textures tile seamlessly in world space.
// ---------------------------------------------------------------------------

const COMMON = /* glsl */ `
precision highp float;
uniform float uSeed;
uniform float uTexel;
varying vec2 vUv;
#define PI 3.14159265

float hash12(vec2 p){
  vec3 p3 = fract(vec3(p.xyx) * .1031 + uSeed * 0.0371);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
vec2 hash22(vec2 p){
  vec3 p3 = fract(vec3(p.xyx) * vec3(.1031, .1030, .0973) + uSeed * 0.0213);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.xx + p3.yz) * p3.zy);
}
vec2 gradv(vec2 i){ float a = hash12(i) * 6.2831853; return vec2(cos(a), sin(a)); }
// periodic gradient noise in [0,1]
float gnoise(vec2 p, vec2 per){
  vec2 i = floor(p), f = fract(p);
  vec2 u = f*f*f*(f*(f*6.-15.)+10.);
  float a = dot(gradv(mod(i, per)), f);
  float b = dot(gradv(mod(i + vec2(1,0), per)), f - vec2(1,0));
  float c = dot(gradv(mod(i + vec2(0,1), per)), f - vec2(0,1));
  float d = dot(gradv(mod(i + vec2(1,1), per)), f - vec2(1,1));
  return 0.5 + 0.75 * mix(mix(a,b,u.x), mix(c,d,u.x), u.y);
}
float fbm(vec2 uv, float scale, int oct){
  float s = 0., a = 0.5, tot = 0.;
  vec2 per = vec2(scale);
  vec2 p = uv * scale;
  for (int i = 0; i < 8; i++){
    if (i >= oct) break;
    s += a * gnoise(p, per); tot += a;
    p *= 2.; per *= 2.; a *= 0.5;
  }
  return s / tot;
}
float ridged(vec2 uv, float scale, int oct){
  float s = 0., a = 0.5, tot = 0.;
  vec2 per = vec2(scale);
  vec2 p = uv * scale;
  for (int i = 0; i < 8; i++){
    if (i >= oct) break;
    float n = 1. - abs(gnoise(p, per) * 2. - 1.);
    s += a * n * n; tot += a;
    p *= 2.; per *= 2.; a *= 0.5;
  }
  return s / tot;
}
// periodic voronoi: x=F1, y=F2, z=cell hash, w=edge distance approx
vec4 voronoi(vec2 uv, float scale, float jitter){
  vec2 p = uv * scale;
  vec2 per = vec2(scale);
  vec2 i = floor(p), f = fract(p);
  float d1 = 8., d2 = 8.; vec2 id = vec2(0); vec2 mr = vec2(0);
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++){
    vec2 g = vec2(x, y);
    vec2 o = 0.5 + (hash22(mod(i + g, per)) - 0.5) * jitter;
    vec2 r = g + o - f;
    float d = dot(r, r);
    if (d < d1){ d2 = d1; d1 = d; id = mod(i + g, per); mr = r; }
    else if (d < d2) d2 = d;
  }
  // second pass for accurate edge distance
  float ed = 8.;
  for (int y = -2; y <= 2; y++) for (int x = -2; x <= 2; x++){
    vec2 g = vec2(x, y);
    vec2 o = 0.5 + (hash22(mod(i + g, per)) - 0.5) * jitter;
    vec2 r = g + o - f;
    if (dot(mr - r, mr - r) > 0.0001)
      ed = min(ed, dot(0.5 * (mr + r), normalize(r - mr)));
  }
  return vec4(sqrt(d1), sqrt(d2), hash12(id), ed / scale);
}
// running bond bricks. returns x = edge distance (uv units), y = id, zw = local uv
vec4 bricks(vec2 uv, vec2 count, float offset, float jit){
  vec2 p = uv * count;
  float row = floor(p.y);
  float rowJ = (hash12(vec2(row, 3.7)) - 0.5) * jit;
  p.x += mod(row, 2.) * offset + rowJ;
  vec2 cell = floor(p);
  vec2 f = fract(p);
  cell.x = mod(cell.x, count.x);
  float id = hash12(cell + vec2(row * 7.13, 1.7));
  float dx = min(f.x, 1. - f.x) / count.x;
  float dy = min(f.y, 1. - f.y) / count.y;
  return vec4(min(dx, dy), id, f);
}
vec3 srgb(vec3 c){ return pow(c, vec3(2.2)); }
`;

// Each surf writes linear albedo `col`, height `h` (0..1), `rough`, `metal`, `ao`
const SURFS = {
  // Big rough dungeon stones (Dark and Darker style grey walls)
  dungeonWall: /* glsl */ `
  void surf(vec2 uv, out vec3 col, out float h, out float rough, out float metal, out float ao){
    vec2 wuv = uv + (vec2(fbm(uv, 6., 3), fbm(uv + 0.37, 6., 3)) - 0.5) * 0.012;
    vec4 b = bricks(wuv, vec2(3., 6.), 0.5, 0.35);
    float n = fbm(uv, 12., 5);
    float edge = b.x + (n - 0.5) * 0.02;
    float stone = smoothstep(0.004, 0.028, edge);
    float bulge = smoothstep(0.0, 0.09, b.x);
    float chips = smoothstep(0.55, 0.75, fbm(uv + b.y, 24., 4));
    float detail = fbm(uv, 32., 5);
    h = stone * (0.55 + 0.25 * bulge + 0.2 * b.y) - chips * 0.12 * stone + detail * 0.12;
    float mortarN = fbm(uv, 40., 3);
    h = max(h, 0.12 + mortarN * 0.08);
    vec3 base = mix(vec3(0.40, 0.38, 0.35), vec3(0.52, 0.49, 0.45), b.y);
    base = mix(base, vec3(0.36, 0.33, 0.30), smoothstep(0.4, 0.8, fbm(uv + 3.1, 5., 4)));
    base *= 0.8 + 0.35 * detail;
    vec3 mortar = vec3(0.22, 0.20, 0.18) * (0.7 + 0.5 * mortarN);
    col = mix(mortar, base, stone);
    float grime = smoothstep(0.45, 0.85, fbm(uv + 7.3, 4., 5));
    col = mix(col, col * vec3(0.55, 0.52, 0.45), grime * 0.7);
    float moss = smoothstep(0.62, 0.8, fbm(uv + 1.9, 6., 5)) * (1. - stone * 0.6);
    col = mix(col, vec3(0.13, 0.17, 0.08), moss * 0.6);
    col = srgb(col);
    rough = mix(0.97, 0.82, stone) - detail * 0.05;
    metal = 0.;
    ao = mix(0.55, 1.0, stone) * (0.85 + 0.15 * bulge);
  }`,

  // Wet, slimy sewer bricks
  sewerWall: /* glsl */ `
  void surf(vec2 uv, out vec3 col, out float h, out float rough, out float metal, out float ao){
    vec4 b = bricks(uv, vec2(5., 12.), 0.5, 0.15);
    float n = fbm(uv, 16., 5);
    float edge = b.x + (n - 0.5) * 0.008;
    float brick = smoothstep(0.002, 0.012, edge);
    float detail = fbm(uv, 48., 4);
    h = brick * (0.65 + 0.2 * b.y + 0.15 * detail) + (1. - brick) * 0.15;
    vec3 base = mix(vec3(0.36, 0.22, 0.16), vec3(0.45, 0.30, 0.22), b.y);
    base = mix(base, vec3(0.30, 0.28, 0.24), step(0.8, hash12(vec2(b.y * 91., 2.))));
    base *= 0.75 + 0.4 * detail;
    vec3 mortar = vec3(0.16, 0.17, 0.13);
    col = mix(mortar, base, brick);
    float slime = smoothstep(0.5, 0.75, fbm(uv + 4.4, 5., 5));
    col = mix(col, vec3(0.10, 0.16, 0.06), slime * 0.75);
    float streak = smoothstep(0.55, 0.9, fbm(vec2(uv.x * 6., uv.y * 0.6), 6., 4));
    col *= 1. - streak * 0.35;
    col = srgb(col);
    rough = mix(0.55, 0.3, slime) + (1. - brick) * 0.2;
    metal = 0.;
    ao = mix(0.5, 1., brick);
  }`,

  // Clean cut ashlar blocks for the castle
  castleWall: /* glsl */ `
  void surf(vec2 uv, out vec3 col, out float h, out float rough, out float metal, out float ao){
    vec4 b = bricks(uv, vec2(2., 4.), 0.5, 0.0);
    float n = fbm(uv, 10., 5);
    float stone = smoothstep(0.002, 0.012, b.x + (n - 0.5) * 0.004);
    float bevel = smoothstep(0.0, 0.03, b.x);
    float detail = fbm(uv, 40., 5);
    float pits = smoothstep(0.7, 0.85, fbm(uv + b.y * 3., 30., 3));
    h = stone * (0.6 + 0.2 * bevel + 0.1 * detail - pits * 0.1) + 0.1;
    vec3 base = mix(vec3(0.55, 0.51, 0.45), vec3(0.63, 0.59, 0.52), b.y);
    base *= 0.82 + 0.3 * detail;
    base = mix(base, base * vec3(0.7, 0.68, 0.62), smoothstep(0.5, 0.9, fbm(uv + 2., 4., 5)));
    col = mix(vec3(0.25, 0.23, 0.2), base, stone);
    col = srgb(col);
    rough = 0.88 - detail * 0.08;
    metal = 0.;
    ao = mix(0.6, 1., stone) * (0.85 + 0.15 * bevel);
  }`,

  // Irregular flagstone floor
  flagstone: /* glsl */ `
  void surf(vec2 uv, out vec3 col, out float h, out float rough, out float metal, out float ao){
    vec2 wuv = uv + (vec2(fbm(uv, 4., 3), fbm(uv + 0.5, 4., 3)) - 0.5) * 0.02;
    vec4 b = bricks(wuv, vec2(3., 4.), 0.37, 0.4);
    float n = fbm(uv, 14., 5);
    float stone = smoothstep(0.003, 0.016, b.x + (n - 0.5) * 0.01);
    vec4 v = voronoi(uv, 9., 1.);
    float crack = 1. - smoothstep(0.0, 0.004, v.w);
    crack *= step(0.72, hash12(vec2(v.z * 13., 5.)));
    float detail = fbm(uv, 36., 5);
    h = stone * (0.6 + 0.15 * b.y + 0.12 * detail - crack * 0.3) + 0.08;
    vec3 base = mix(vec3(0.36, 0.34, 0.31), vec3(0.46, 0.43, 0.39), b.y);
    base *= 0.78 + 0.4 * detail;
    base = mix(base, vec3(0.28, 0.24, 0.19), smoothstep(0.5, 0.85, fbm(uv + 9., 3., 5)) * 0.8);
    col = mix(vec3(0.12, 0.11, 0.09), base, stone);
    col *= 1. - crack * 0.5;
    col = srgb(col);
    rough = mix(0.98, 0.78, stone) - detail * 0.1;
    metal = 0.;
    ao = mix(0.45, 1., stone);
  }`,

  // Rounded cobblestones (courtyard paths / sewer walkways)
  cobble: /* glsl */ `
  void surf(vec2 uv, out vec3 col, out float h, out float rough, out float metal, out float ao){
    vec4 v = voronoi(uv, 14., 0.85);
    float n = fbm(uv, 20., 4);
    float stone = smoothstep(0.0, 0.025, v.w + (n - 0.5) * 0.006);
    float dome = sqrt(clamp(v.w * 22., 0., 1.));
    float detail = fbm(uv, 50., 4);
    h = stone * (0.45 + 0.4 * dome + 0.08 * detail) + 0.05;
    vec3 base = mix(vec3(0.33, 0.32, 0.30), vec3(0.50, 0.47, 0.43), v.z);
    base = mix(base, vec3(0.40, 0.33, 0.27), step(0.75, hash12(vec2(v.z * 31., 1.))) * 0.6);
    base *= 0.8 + 0.35 * detail;
    vec3 dirt = vec3(0.14, 0.12, 0.09) * (0.7 + 0.6 * n);
    col = mix(dirt, base, stone);
    col = srgb(col);
    rough = mix(1.0, 0.72, stone * dome);
    metal = 0.;
    ao = mix(0.35, 1., stone) * (0.7 + 0.3 * dome);
  }`,

  // Wooden planks (doors, beams, floors)
  wood: /* glsl */ `
  void surf(vec2 uv, out vec3 col, out float h, out float rough, out float metal, out float ao){
    vec2 p = vec2(uv.y, uv.x);
    float plankW = 1. / 6.;
    float pi = floor(p.y / plankW);
    float py = fract(p.y / plankW);
    float id = hash12(vec2(pi, 2.));
    float seg = floor(p.x * 2. + id * 2.);
    float sid = hash12(vec2(pi, seg + 9.));
    float gap = smoothstep(0.0, 0.04, py) * smoothstep(1.0, 0.96, py);
    float segGap = smoothstep(0.0, 0.006, abs(fract(p.x * 2. + id * 2.) - 0.5) - 0.494) ;
    float grainN = fbm(vec2(p.x * 0.5 + sid, py * 0.25 + pi * 0.17), 8., 5);
    float grain = sin((py * 40. + grainN * 18. + sid * 10.)) * 0.5 + 0.5;
    float fine = fbm(vec2(p.x * 2., p.y * 24.), 16., 3);
    vec2 kp = vec2(fract(p.x * 2. + id * 2.) , py) - vec2(0.3 + sid * 0.4, 0.5);
    float knot = smoothstep(0.08, 0.0, length(kp * vec2(1.6, 1.)));
    h = gap * (0.6 + grain * 0.1 + fine * 0.15 - knot * 0.1) * mix(1., 0.3, 1. - segGap);
    vec3 base = mix(vec3(0.30, 0.19, 0.11), vec3(0.42, 0.28, 0.16), sid);
    base *= 0.75 + 0.3 * grain + 0.2 * fine;
    base = mix(base, vec3(0.18, 0.11, 0.06), knot);
    col = mix(vec3(0.05, 0.035, 0.02), base, gap * segGap);
    col = srgb(col);
    rough = 0.82 - grain * 0.1;
    metal = 0.;
    ao = mix(0.4, 1., gap);
  }`,

  // Dark wrought iron with rust
  iron: /* glsl */ `
  void surf(vec2 uv, out vec3 col, out float h, out float rough, out float metal, out float ao){
    float n = fbm(uv, 8., 6);
    float rust = smoothstep(0.5, 0.75, fbm(uv + 3., 5., 6));
    float scratches = smoothstep(0.85, 1., ridged(vec2(uv.x * 4., uv.y * 0.5), 12., 3));
    h = 0.5 + n * 0.2 + rust * 0.15;
    vec3 iron = vec3(0.22, 0.22, 0.23) * (0.8 + 0.4 * n) + scratches * 0.15;
    vec3 rustC = mix(vec3(0.30, 0.13, 0.05), vec3(0.45, 0.22, 0.08), fbm(uv, 30., 3));
    col = srgb(mix(iron, rustC, rust));
    rough = mix(0.45, 0.95, rust) - scratches * 0.15;
    metal = mix(0.9, 0.2, rust);
    ao = 1.;
  }`,

  // Polished marble tiles for the throne room
  marble: /* glsl */ `
  void surf(vec2 uv, out vec3 col, out float h, out float rough, out float metal, out float ao){
    vec2 g = uv * 2.;
    vec2 cell = floor(g);
    vec2 f = fract(g);
    float d = min(min(f.x, 1. - f.x), min(f.y, 1. - f.y));
    float grout = smoothstep(0.004, 0.012, d);
    float checker = mod(cell.x + cell.y, 2.);
    vec2 wp = uv * 3. + vec2(fbm(uv, 3., 6), fbm(uv + 5.2, 3., 6)) * 2.;
    float vein = 1. - smoothstep(0.0, 0.06, abs(sin(wp.x * 3.14159 + fbm(uv, 6., 5) * 6.)));
    float vein2 = 1. - smoothstep(0.0, 0.03, abs(sin(wp.y * 6.2 + fbm(uv + 2., 8., 5) * 8.)));
    vec3 white = vec3(0.78, 0.76, 0.72);
    vec3 black = vec3(0.07, 0.07, 0.08);
    vec3 base = mix(white, black, checker);
    base = mix(base, checker > 0.5 ? vec3(0.35, 0.30, 0.22) : vec3(0.42, 0.40, 0.38), max(vein, vein2 * 0.6));
    float wear = fbm(uv, 16., 4);
    col = srgb(mix(vec3(0.15, 0.14, 0.12), base * (0.9 + 0.15 * wear), grout));
    h = grout * 0.7 + 0.1;
    rough = mix(0.9, 0.12 + wear * 0.18, grout);
    metal = 0.;
    ao = mix(0.6, 1., grout);
  }`,

  // Royal red carpet with gold trim
  carpet: /* glsl */ `
  void surf(vec2 uv, out vec3 col, out float h, out float rough, out float metal, out float ao){
    float weave = sin(uv.x * 800.) * sin(uv.y * 800.) * 0.5 + 0.5;
    float n = fbm(uv, 10., 5);
    float bx = min(uv.x, 1. - uv.x);
    float border = step(bx, 0.12) * step(0.04, bx);
    float trim = step(bx, 0.03);
    vec2 pp = fract(uv * vec2(4., 8.)) - 0.5;
    float pattern = smoothstep(0.32, 0.30, abs(pp.x) + abs(pp.y)) - smoothstep(0.22, 0.2, abs(pp.x) + abs(pp.y));
    vec3 red = vec3(0.32, 0.03, 0.04) * (0.75 + 0.4 * n);
    vec3 gold = vec3(0.6, 0.42, 0.12);
    vec3 c = red;
    c = mix(c, gold * 0.8, border * 0.0 + trim);
    c = mix(c, vec3(0.18, 0.02, 0.03), border);
    c = mix(c, gold, pattern * (1. - border - trim) * 0.6);
    float wornN = smoothstep(0.55, 0.8, fbm(uv + 4., 5., 5));
    c = mix(c, c * 0.55, wornN);
    col = srgb(c * (0.85 + 0.15 * weave));
    h = 0.5 + weave * 0.08 + n * 0.1;
    rough = 0.95;
    metal = 0.;
    ao = 0.9 + 0.1 * weave;
  }`,

  // Grassy courtyard ground
  grass: /* glsl */ `
  void surf(vec2 uv, out vec3 col, out float h, out float rough, out float metal, out float ao){
    float n = fbm(uv, 6., 6);
    float blades = ridged(vec2(uv.x * 1., uv.y * 1.), 60., 3);
    float dirtM = smoothstep(0.45, 0.7, fbm(uv + 2.3, 4., 5));
    vec3 g1 = vec3(0.13, 0.17, 0.06), g2 = vec3(0.22, 0.24, 0.09);
    vec3 grassC = mix(g1, g2, blades) * (0.75 + 0.5 * n);
    vec3 dirt = vec3(0.17, 0.13, 0.09) * (0.7 + 0.5 * fbm(uv, 30., 4));
    vec3 c = mix(grassC, dirt, dirtM * 0.85);
    float pebbles = smoothstep(0.08, 0.0, voronoi(uv, 40., 1.).x) * dirtM;
    c = mix(c, vec3(0.35, 0.33, 0.3), pebbles);
    col = srgb(c);
    h = 0.4 + blades * 0.3 * (1. - dirtM) + pebbles * 0.3 + n * 0.1;
    rough = 0.95;
    metal = 0.;
    ao = 0.8 + 0.2 * blades;
  }`,

  // Muddy dirt / sewer sludge floor
  dirt: /* glsl */ `
  void surf(vec2 uv, out vec3 col, out float h, out float rough, out float metal, out float ao){
    float n = fbm(uv, 6., 6);
    float d = fbm(uv, 30., 4);
    float puddle = smoothstep(0.55, 0.62, fbm(uv + 1.7, 4., 5));
    vec4 v = voronoi(uv, 30., 1.);
    float stones = smoothstep(0.12, 0.0, v.x) * step(0.6, v.z);
    vec3 c = mix(vec3(0.15, 0.12, 0.08), vec3(0.24, 0.19, 0.13), n) * (0.8 + 0.4 * d);
    c = mix(c, vec3(0.32, 0.30, 0.27) * (0.8 + 0.4 * v.z), stones);
    c = mix(c, c * 0.5, puddle);
    col = srgb(c);
    h = 0.4 + n * 0.25 + stones * 0.25 - puddle * 0.2;
    rough = mix(0.95, 0.15, puddle);
    metal = 0.;
    ao = 0.9;
  }`,

  // Slate roof shingles
  roof: /* glsl */ `
  void surf(vec2 uv, out vec3 col, out float h, out float rough, out float metal, out float ao){
    vec4 b = bricks(uv, vec2(6., 10.), 0.5, 0.2);
    float f = b.w;
    float scallop = smoothstep(0.0, 0.08, b.x);
    float n = fbm(uv, 20., 4);
    h = (0.3 + 0.7 * f) * scallop;
    vec3 base = mix(vec3(0.13, 0.14, 0.16), vec3(0.22, 0.23, 0.26), b.y) * (0.8 + 0.4 * n);
    base = mix(base, vec3(0.18, 0.22, 0.12), smoothstep(0.6, 0.8, fbm(uv + 1., 5., 4)) * 0.6);
    col = srgb(mix(vec3(0.03), base, scallop) * (0.6 + 0.4 * f));
    rough = 0.75;
    metal = 0.;
    ao = mix(0.3, 1., f);
  }`,

  // Rough natural rock
  rock: /* glsl */ `
  void surf(vec2 uv, out vec3 col, out float h, out float rough, out float metal, out float ao){
    float r = ridged(uv, 5., 6);
    float n = fbm(uv, 10., 5);
    vec4 v = voronoi(uv, 6., 1.);
    float strata = sin(uv.y * 40. + n * 6.) * 0.5 + 0.5;
    h = r * 0.6 + n * 0.25 + strata * 0.1 + v.w * 1.2;
    vec3 c = mix(vec3(0.24, 0.23, 0.22), vec3(0.42, 0.40, 0.37), r) * (0.8 + 0.3 * strata);
    c = mix(c, vec3(0.16, 0.18, 0.10), smoothstep(0.6, 0.8, fbm(uv + 8., 4., 5)) * 0.5);
    col = srgb(c);
    rough = 0.9;
    metal = 0.;
    ao = 0.6 + 0.4 * r;
  }`,

  // Worn plaster with exposed brick (castle interior)
  plaster: /* glsl */ `
  void surf(vec2 uv, out vec3 col, out float h, out float rough, out float metal, out float ao){
    float n = fbm(uv, 5., 6);
    float worn = smoothstep(0.58, 0.64, fbm(uv + 3.3, 3., 6));
    vec4 b = bricks(uv, vec2(5., 12.), 0.5, 0.1);
    float brick = smoothstep(0.002, 0.008, b.x);
    vec3 brickC = mix(vec3(0.35, 0.18, 0.12), vec3(0.45, 0.25, 0.17), b.y) * mix(0.4, 1., brick);
    vec3 plasterC = vec3(0.55, 0.50, 0.42) * (0.85 + 0.2 * fbm(uv, 40., 4));
    plasterC = mix(plasterC, vec3(0.33, 0.29, 0.22), smoothstep(0.4, 0.9, n) * 0.6);
    col = srgb(mix(plasterC, brickC, worn));
    h = mix(0.75 + n * 0.05, 0.3 + 0.2 * brick, worn);
    rough = 0.92;
    metal = 0.;
    ao = mix(1., mix(0.5, 0.9, brick), worn);
  }`,

  // Gold / brass for ornaments
  gold: /* glsl */ `
  void surf(vec2 uv, out vec3 col, out float h, out float rough, out float metal, out float ao){
    float n = fbm(uv, 10., 5);
    float tarnish = smoothstep(0.45, 0.8, fbm(uv + 1., 6., 5));
    col = srgb(mix(vec3(0.85, 0.62, 0.25), vec3(0.35, 0.28, 0.15), tarnish) * (0.85 + 0.2 * n));
    h = 0.5 + n * 0.1;
    rough = mix(0.25, 0.6, tarnish);
    metal = 1.;
    ao = 1.;
  }`,

  // Woven cloth for robes / banners
  cloth: /* glsl */ `
  void surf(vec2 uv, out vec3 col, out float h, out float rough, out float metal, out float ao){
    float wx = sin(uv.x * 400.) * 0.5 + 0.5;
    float wy = sin(uv.y * 400.) * 0.5 + 0.5;
    float weave = mix(wx, wy, step(0.5, fract(uv.x * 200. + floor(uv.y * 200.) * 0.5)));
    float n = fbm(uv, 8., 5);
    float stain = smoothstep(0.55, 0.8, fbm(uv + 2., 4., 5));
    col = srgb(vec3(0.8) * (0.8 + 0.2 * weave) * (0.85 + 0.2 * n) * (1. - stain * 0.35));
    h = 0.5 + weave * 0.2;
    rough = 0.95;
    metal = 0.;
    ao = 0.85 + 0.15 * weave;
  }`,

  // Bone / skull surface
  bone: /* glsl */ `
  void surf(vec2 uv, out vec3 col, out float h, out float rough, out float metal, out float ao){
    float n = fbm(uv, 8., 6);
    float pores = smoothstep(0.7, 0.9, fbm(uv, 60., 3));
    float dirt = smoothstep(0.5, 0.85, fbm(uv + 4., 5., 5));
    vec3 c = mix(vec3(0.75, 0.70, 0.58), vec3(0.55, 0.48, 0.36), dirt) * (0.85 + 0.2 * n) * (1. - pores * 0.25);
    col = srgb(c);
    h = 0.5 + n * 0.3 - pores * 0.1;
    rough = 0.7;
    metal = 0.;
    ao = 1. - pores * 0.3;
  }`,

  // Leather (straps, books)
  leather: /* glsl */ `
  void surf(vec2 uv, out vec3 col, out float h, out float rough, out float metal, out float ao){
    vec4 v = voronoi(uv, 40., 1.);
    float n = fbm(uv, 6., 5);
    float crease = smoothstep(0.0, 0.004, v.w);
    col = srgb(vec3(0.30, 0.17, 0.09) * (0.75 + 0.4 * n) * (0.85 + 0.15 * crease));
    h = 0.5 + crease * 0.15 + n * 0.1;
    rough = 0.65 + 0.2 * (1. - crease);
    metal = 0.;
    ao = 0.9 + 0.1 * crease;
  }`,
};

const VERT = /* glsl */ `
varying vec2 vUv;
void main(){ vUv = uv; gl_Position = vec4(position.xy, 0., 1.); }
`;

function fragFor(name, mode, normalStrength) {
  return COMMON + SURFS[name] + /* glsl */ `
  void main(){
    vec3 col; float h, rough, metal, ao;
    surf(vUv, col, h, rough, metal, ao);
    #if MODE == 0
      gl_FragColor = vec4(col, 1.);
    #elif MODE == 1
      float e = uTexel;
      vec3 c1; float hx, hy, r1, m1, a1;
      surf(fract(vUv + vec2(e, 0.)), c1, hx, r1, m1, a1);
      surf(fract(vUv + vec2(0., e)), c1, hy, r1, m1, a1);
      vec3 n = normalize(vec3((h - hx) * ${normalStrength.toFixed(2)}, (h - hy) * ${normalStrength.toFixed(2)}, e * 4.0));
      gl_FragColor = vec4(n * 0.5 + 0.5, 1.);
    #else
      gl_FragColor = vec4(ao, rough, metal, 1.);
    #endif
  }`.replace('#if MODE', `#define MODE ${mode}\n#if MODE`);
}

const NORMAL_STRENGTH = {
  dungeonWall: 1.6, sewerWall: 1.4, castleWall: 1.3, flagstone: 1.4, cobble: 1.6, wood: 1.0,
  iron: 0.6, marble: 0.6, carpet: 0.5, grass: 0.8, dirt: 0.9, roof: 1.4, rock: 1.8, plaster: 1.0,
  gold: 0.5, cloth: 0.5, bone: 0.6, leather: 0.6,
};

export class TextureFactory {
  constructor(renderer) {
    this.renderer = renderer;
    this.scene = new THREE.Scene();
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2));
    this.quad.frustumCulled = false;
    this.scene.add(this.quad);
    this.cache = new Map();
    this.maxAniso = renderer.capabilities.getMaxAnisotropy();
  }

  _render(frag, size, srgb, seed) {
    const rt = new THREE.WebGLRenderTarget(size, size, {
      minFilter: THREE.LinearMipmapLinearFilter,
      magFilter: THREE.LinearFilter,
      wrapS: THREE.RepeatWrapping,
      wrapT: THREE.RepeatWrapping,
      generateMipmaps: true,
      depthBuffer: false,
      colorSpace: srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace,
    });
    rt.texture.anisotropy = this.maxAniso;
    const mat = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: frag,
      uniforms: { uSeed: { value: seed }, uTexel: { value: 1 / size } },
      depthTest: false,
      depthWrite: false,
    });
    this.quad.material = mat;
    const prevRT = this.renderer.getRenderTarget();
    this.renderer.setRenderTarget(rt);
    this.renderer.render(this.scene, this.camera);
    this.renderer.setRenderTarget(prevRT);
    mat.dispose();
    return rt.texture;
  }

  // Returns { map, normalMap, ormMap } for a named surface
  get(name, size = 1024, seed = 1) {
    const key = `${name}:${size}:${seed}`;
    if (this.cache.has(key)) return this.cache.get(key);
    if (!SURFS[name]) throw new Error('unknown surface ' + name);
    const ns = NORMAL_STRENGTH[name] ?? 1;
    const set = {
      map: this._render(fragFor(name, 0, ns), size, true, seed),
      normalMap: this._render(fragFor(name, 1, ns), size, false, seed),
      ormMap: this._render(fragFor(name, 2, ns), size, false, seed),
    };
    this.cache.set(key, set);
    return set;
  }

  static get surfaces() { return Object.keys(SURFS); }
}

// Build a MeshStandardMaterial from a procedural surface.
export function makeSurfaceMaterial(factory, name, opts = {}) {
  const t = factory.get(name, opts.size ?? 1024, opts.seed ?? 1);
  const mat = new THREE.MeshStandardMaterial({
    map: t.map,
    normalMap: t.normalMap,
    roughnessMap: t.ormMap,
    metalnessMap: t.ormMap,
    aoMap: t.ormMap,
    aoMapIntensity: opts.aoIntensity ?? 1,
    roughness: opts.roughness ?? 1,
    metalness: opts.metalness ?? 1,
    color: opts.color ?? 0xffffff,
    normalScale: new THREE.Vector2(opts.normalScale ?? 1, opts.normalScale ?? 1),
    vertexColors: !!opts.vertexColors,
    side: opts.side ?? THREE.FrontSide,
    envMapIntensity: opts.envMapIntensity ?? 1,
  });
  if (opts.emissive) {
    mat.emissive = new THREE.Color(opts.emissive);
    mat.emissiveIntensity = opts.emissiveIntensity ?? 1;
  }
  return mat;
}
