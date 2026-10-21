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

// Per-element palettes: core (HDR), secondary, smoke color, sprite set.
// Kept to ~1.5-2.2x HDR: enough to stay the brightest thing on screen and to
// bloom a little, but ACES no longer shifts fire to pink/white or necrotic
// to neon. Hues are deliberately deep (grim, low-key palette).
export const FX = {
  fire: { core: C(0xffb85a, 1.9), mid: C(0xff6418, 1.45), end: C(0x4a0a00, 1), smoke: [0.06, 0.045, 0.035], spr: SPR.FLAME, spark: SPR.EMBER, light: 0xff6a20 },
  frost: { core: C(0xc8eeff, 1.8), mid: C(0x4aa8e8, 1.4), end: C(0x183a70, 0.9), smoke: [0.5, 0.62, 0.72], spr: SPR.SHARD, spark: SPR.SNOW, light: 0x80c8ff },
  lightning: { core: C(0xdce6ff, 2.3), mid: C(0x6a80ff, 1.7), end: C(0x3030b0, 1), smoke: [0.25, 0.25, 0.32], spr: SPR.BOLT, spark: SPR.SPARK, light: 0x90a8ff },
  arcane: { core: C(0xe8a8ff, 1.8), mid: C(0xa040f0, 1.5), end: C(0x2c0c70, 1), smoke: [0.15, 0.08, 0.22], spr: SPR.STAR, spark: SPR.RUNE, light: 0xb050ff },
  necrotic: { core: C(0xb0e890, 1.6), mid: C(0x4aa83c, 1.25), end: C(0x0a280a, 1), smoke: [0.04, 0.08, 0.04], spr: SPR.WISP, spark: SPR.EMBER, light: 0x50c050 },
  blood: { core: C(0xff4a58, 1.6), mid: C(0xb00018, 1.4), end: C(0x260005, 1), smoke: [0.2, 0.02, 0.025], spr: SPR.DROP, spark: SPR.DROP, light: 0xe02030 },
  time: { core: C(0xc0f8e8, 1.7), mid: C(0x34c4ac, 1.4), end: C(0xa07c28, 1), smoke: [0.16, 0.24, 0.24], spr: SPR.RING, spark: SPR.STAR, light: 0x40d0b8 },
  shadow: { core: C(0xd878ff, 1.5), mid: C(0x8424dc, 1.35), end: C(0x160028, 1), smoke: [0.025, 0.0, 0.04], spr: SPR.WISP, spark: SPR.SPARK, light: 0x9030f0 },
  holy: { core: C(0xfff0c0, 2.1), mid: C(0xf0c040, 1.5), end: C(0x8a4c10, 1), smoke: [0.7, 0.66, 0.55], spr: SPR.STAR, spark: SPR.GLOW, light: 0xffd060 },
  earth: { core: C(0xffc080, 1.5), mid: C(0xb07038, 1.15), end: C(0x3a1c0c, 1), smoke: [0.3, 0.24, 0.17], spr: SPR.CHUNK, spark: SPR.EMBER, light: 0xd09048 },
  poison: { core: C(0xc8e878, 1.5), mid: C(0x6aa824, 1.25), end: C(0x163206, 1), smoke: [0.16, 0.24, 0.06], spr: SPR.BUBBLE, spark: SPR.FEATHER, light: 0x80c828 },
  blade: { core: C(0xd0ecff, 2.0), mid: C(0x4898f0, 1.6), end: C(0x183870, 1), smoke: [0.35, 0.4, 0.45], spr: SPR.SHARD, spark: SPR.SPARK, light: 0x60b0ff },
  wind: { core: C(0xe8fff8, 1.7), mid: C(0x9ae6da, 1.3), end: C(0x3a6464, 0.7), smoke: [0.55, 0.62, 0.62], spr: SPR.WISP, spark: SPR.FEATHER, light: 0xa0f0e8 },
  physical: { core: C(0xffffff, 1.5), mid: C(0xc0c0c0, 1.0), end: C(0x404040, 0.6), smoke: [0.3, 0.3, 0.3], spr: SPR.CHUNK, spark: SPR.SPARK, light: 0xffffff },
  // enemy attacks stay a notch hotter than player magic so they always read
  enemy: { core: C(0xff8070, 2.2), mid: C(0xff2418, 1.8), end: C(0x400000, 1), smoke: [0.1, 0.0, 0.0], spr: SPR.GLOW, spark: SPR.EMBER, light: 0xff3020 },
  enemyGreen: { core: C(0xd0f070, 1.9), mid: C(0x5cb818, 1.6), end: C(0x183000, 1), smoke: [0.1, 0.14, 0.04], spr: SPR.BUBBLE, spark: SPR.DROP, light: 0x70c020 },
  enemyPurple: { core: C(0xf0a0ff, 2.1), mid: C(0xa020f0, 1.75), end: C(0x300050, 1), smoke: [0.05, 0.0, 0.08], spr: SPR.WISP, spark: SPR.SPARK, light: 0xb040ff },
  enemyFire: { core: C(0xffa050, 2.2), mid: C(0xff4010, 1.75), end: C(0x401000, 1), smoke: [0.07, 0.05, 0.04], spr: SPR.FLAME, spark: SPR.EMBER, light: 0xff6020 },
};
export const fxOf = (el) => FX[el] ?? FX.physical;

// Patch a built-in Mesh/Sprite material so it dims (and, for sprites, shrinks)
// when it is close to the camera: magic leaving the focus or passing the lens
// stays readable instead of washing the screen out. Parameters live in a
// shared uniform so every patched material of a type uses one program.
// near = [d0, d1, minK, minScale]: full strength from d1 metres, minK/minScale at d0.
const NEAR_DEFAULT = new THREE.Vector4(0.8, 6.0, 0.3, 0.45);
export function nearFade(mat, near = NEAR_DEFAULT) {
  const u = { value: near };
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uNearFade = u;
    sh.vertexShader = 'uniform vec4 uNearFade;\nvarying float vNearK;\n' + sh.vertexShader
      .replace('vec2 alignedPosition', 'scale *= mix(uNearFade.w, 1.0, smoothstep(uNearFade.x, uNearFade.y, -mvPosition.z));\n\tvec2 alignedPosition')
      .replace('#include <logdepthbuf_vertex>', 'vNearK = mix(uNearFade.z, 1.0, smoothstep(uNearFade.x, uNearFade.y, -mvPosition.z));\n\t#include <logdepthbuf_vertex>');
    sh.fragmentShader = 'varying float vNearK;\n' + sh.fragmentShader
      .replace('#include <opaque_fragment>', '#include <opaque_fragment>\n\tgl_FragColor.rgb *= vNearK;');
  };
  mat.customProgramCacheKey = () => 'nearFade';
  return mat;
}

// clamp an [r,g,b] HDR colour so its brightest channel is at most `max`
export function clampHDR(c, max = 1.5, out = [0, 0, 0]) {
  const m = Math.max(c[0], c[1], c[2]);
  const k = m > max ? max / m : 1;
  out[0] = c[0] * k; out[1] = c[1] * k; out[2] = c[2] * k;
  return out;
}

const _sc = [0, 0, 0], _sc2 = [0, 0, 0], _rc = [0, 0, 0];
const _flameC = new THREE.Color();
const scaleC = (c, k, out) => { out[0] = c[0] * k; out[1] = c[1] * k; out[2] = c[2] * k; return out; };

// cheap value noise shared by the volume shaders below
const NOISE_GLSL = /* glsl */ `
float vh(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vn(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(vh(i), vh(i + vec2(1.0, 0.0)), u.x), mix(vh(i + vec2(0.0, 1.0)), vh(i + vec2(1.0, 1.0)), u.x), u.y); }
float fbm(vec2 p){ float a = 0.5, s = 0.0; for (int i = 0; i < 4; i++) { s += a * vn(p); p = p * 2.03 + 17.1; a *= 0.5; } return s; }
`;

// Spell orbs (fireball, ball lightning, arcane orb...): a churning ball of
// element-coloured energy - hot heart, turbulent mid tones, a darker limb and a
// thin bright rim - instead of a flat unlit disc. One program for every
// element: the colours are uniforms, the clock a shared uniform object.
const ORB_VERT = /* glsl */ `
varying vec3 vN; varying vec3 vV; varying vec3 vP; varying float vDepth;
void main(){
  vP = normalize(position);
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vN = normalize(normalMatrix * normal);
  vV = normalize(-mv.xyz);
  vDepth = -mv.z;
  gl_Position = projectionMatrix * mv;
}`;
const ORB_FRAG = /* glsl */ `
uniform vec3 uCore; uniform vec3 uMid; uniform vec3 uEdge; uniform float uTime; uniform float uSpeed; uniform float uRim;
varying vec3 vN; varying vec3 vV; varying vec3 vP; varying float vDepth;
${NOISE_GLSL}
void main(){
  float f = abs(dot(vN, vV));
  float t = uTime * uSpeed;
  // two sheared noise layers swirling round the ball read as churning plasma
  float ca = cos(t * 1.3), sa = sin(t * 1.3);
  vec3 q = vec3(ca * vP.x - sa * vP.z, vP.y, sa * vP.x + ca * vP.z);
  float n = fbm(vec2(q.x * 2.2 + q.z * 1.1, q.y * 2.6 - t * 1.7) + 3.0);
  float n2 = fbm(vec2(q.z * 3.4 - q.x * 0.8 + n * 1.5, q.y * 3.8 + t * 0.9));
  float heat = f * 0.75 + (n * 0.6 + n2 * 0.45) - 0.35;
  vec3 c = mix(uEdge, uMid, smoothstep(0.05, 0.5, heat));
  c = mix(c, uCore, smoothstep(0.7, 1.15, heat));
  // thin hot rim so the silhouette stays crisp against dark stone
  c += uMid * pow(1.0 - f, 4.0) * uRim;
  // a soft limb (fire) or a crisp one (energy)
  c *= mix(smoothstep(0.0, 0.5, f), 1.0, min(uRim, 1.0));
  // close to the lens it dims instead of filling the screen
  c *= mix(0.3, 1.0, smoothstep(0.6, 3.5, vDepth));
  gl_FragColor = vec4(c, 1.0);
}`;

export function orbMaterial(fx, time, rim = 0.8) {
  const core = clampHDR(fx.core, 1.4), mid = clampHDR([fx.mid[0] * 0.9, fx.mid[1] * 0.9, fx.mid[2] * 0.9], 1.2);
  return new THREE.ShaderMaterial({
    vertexShader: ORB_VERT, fragmentShader: ORB_FRAG,
    uniforms: { uCore: { value: new THREE.Color(...core) }, uMid: { value: new THREE.Color(...mid) }, uEdge: { value: new THREE.Color(fx.end[0] * 0.8, fx.end[1] * 0.8, fx.end[2] * 0.8) }, uTime: time, uSpeed: { value: 1 }, uRim: { value: rim } },
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
  });
}

// ---------------------------------------------------------------- shaders
const RING_VERT = /* glsl */ `
varying vec2 vUv; varying float vDepth;
void main(){ vUv = uv; vec4 mv = modelViewMatrix * vec4(position, 1.0); vDepth = -mv.z; gl_Position = projectionMatrix * mv; }`;
const RING_FRAG = /* glsl */ `
uniform vec3 uColor; uniform float uProg; uniform float uWidth; uniform float uTime;
varying vec2 vUv; varying float vDepth;
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
  // a wave sweeping under your own feet must not flash the whole screen
  alpha *= mix(0.25, 1.0, smoothstep(0.8, 5.0, vDepth));
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
    edge = smoothstep(0.93, 0.985, d) * inside;
    fill = step(d, uProg) * inside;
    float ringF = smoothstep(uProg - 0.04, uProg, d) * step(d, uProg) * inside;
    // faint interior that strengthens toward the edge; the edge and sweep carry the read
    fill = fill * (0.05 + 0.13 * d * d) + ringF * 0.8;
  } else if (uMode == 1) { // rect, fills along +y (vUv.y)
    inside = 1.0;
    float ex = smoothstep(0.85, 0.97, abs(p.x));
    float ey = smoothstep(0.92, 0.99, abs(p.y));
    edge = max(ex, ey);
    float y = vUv.y;
    fill = step(y, uProg) * (0.06 + 0.1 * abs(p.x)) + smoothstep(uProg - 0.03, uProg, y) * step(y, uProg) * 0.8;
  } else { // cone sector pointing +y, half-angle uAngle
    float d = length(p);
    float a = abs(atan(p.x, p.y));
    inside = step(d, 1.0) * step(a, uAngle);
    edge = (smoothstep(0.94, 0.985, d) + smoothstep(uAngle - 0.04, uAngle, a)) * inside;
    fill = step(d, uProg) * inside * (0.05 + 0.13 * d * d) + smoothstep(uProg - 0.04, uProg, d) * step(d, uProg) * inside * 0.8;
  }
  float pulse = 0.55 + 0.2 * sin(uTime * 14.0);
  float alpha = (edge * pulse + fill) * inside * uFade;
  if (alpha < 0.003) discard;
  gl_FragColor = vec4(uColor * alpha, 1.0);
}`;

const BEAM_VERT = /* glsl */ `
varying vec2 vUv; varying vec3 vN; varying vec3 vV; varying float vDepth; varying vec3 vAx;
void main(){
  vUv = uv;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vN = normalize(normalMatrix * normal);
  vAx = (modelViewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz; // the beam's axis (local +Y) in view space
  vV = normalize(-mv.xyz);
  vDepth = -mv.z;
  gl_Position = projectionMatrix * mv;
}`;
const BEAM_FRAG = /* glsl */ `
uniform vec3 uColor; uniform vec3 uCore; uniform float uTime; uniform float uLen; uniform float uAlpha; uniform float uNoise;
varying vec2 vUv; varying vec3 vN; varying vec3 vV; varying float vDepth; varying vec3 vAx;
float h(float x){ return fract(sin(x) * 43758.5453); }
float n1(float x){ float i = floor(x), f = fract(x); return mix(h(i), h(i + 1.0), smoothstep(0.,1.,f)); }
void main(){
  // facing measured across the beam, not along it: your own beam runs nearly
  // straight away from the eye, where a plain N.V goes to zero and it vanished
  vec3 ax = normalize(vAx);
  vec3 vp = vV - ax * dot(vV, ax);
  float facing = dot(vp, vp) > 1e-6 ? abs(dot(vN, normalize(vp))) : 1.0;
  float core = pow(facing, 6.0);
  float glow = pow(facing, 1.5);
  float along = vUv.y * uLen;
  float flow = n1(along * 2.0 - uTime * 18.0) * n1(along * 5.3 - uTime * 31.0 + vUv.x * 6.0);
  float flick = mix(1.0, 0.6 + 0.8 * flow, uNoise);
  float tip = smoothstep(0.0, 0.03, vUv.y) * smoothstep(1.0, 0.97, vUv.y);
  // the first metres of a channelled beam sit right under the crosshair: keep them dim
  float nearK = mix(0.22, 1.0, smoothstep(0.6, 5.0, vDepth));
  vec3 c = (uColor * glow * flick * 0.5 + uCore * core * 0.45) * uAlpha * tip * nearK;
  gl_FragColor = vec4(c, 1.0);
}`;

const SHELL_FRAG = /* glsl */ `
uniform vec3 uColor; uniform float uAlpha; uniform float uTime;
varying vec2 vUv; varying vec3 vN; varying vec3 vV; varying float vDepth;
void main(){
  float f = 1.0 - abs(dot(vN, vV));
  float rim = pow(f, 2.5);
  float hex = 0.6 + 0.4 * sin(vUv.x * 60.0 + uTime * 2.0) * sin(vUv.y * 40.0 - uTime * 1.5);
  vec3 c = uColor * (rim * 0.75 + 0.02) * hex * uAlpha * smoothstep(0.5, 3.0, vDepth);
  gl_FragColor = vec4(c, 1.0);
}`;

// Sword / scythe slash: a swept arc ribbon in the XZ plane (local polar angle
// 0..1 across the arc, radius 0..1 across the band). The bright leading edge
// sweeps across the arc over the effect's life leaving a streaked fading trail.
const SLASH_VERT = /* glsl */ `
varying vec2 vP; varying float vDepth;
void main(){
  vP = position.xz;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vDepth = -mv.z;
  gl_Position = projectionMatrix * mv;
}`;
const SLASH_FRAG = /* glsl */ `
uniform vec3 uColor; uniform vec3 uCore; uniform float uProg; uniform float uSide; uniform float uAlpha; uniform float uSeed;
uniform float uR0; uniform float uArc;
varying vec2 vP; varying float vDepth;
${NOISE_GLSL}
void main(){
  float r = length(vP);
  float ang = atan(vP.x, vP.y);
  float a = clamp(ang / uArc + 0.5, 0.0, 1.0);
  if (uSide < 0.0) a = 1.0 - a;
  float rb = clamp((r - uR0) / (1.0 - uR0), 0.0, 1.0);
  float head = uProg * 1.25;
  float behind = head - a;
  if (behind < 0.0) discard;
  float trail = exp(-behind * 3.2);
  float edge = pow(rb, 3.0);
  float streak = fbm(vec2(a * 3.0 + uSeed, rb * 9.0 - a * 2.0));
  float band = smoothstep(0.0, 0.25, rb) * smoothstep(1.0, 0.86, rb);
  float tipFade = smoothstep(0.0, 0.08, a) * smoothstep(1.0, 0.85, a);
  float k = trail * band * tipFade * (0.35 + 0.9 * streak) * uAlpha;
  vec3 c = uColor * k * (0.55 + 0.6 * rb) + uCore * edge * trail * smoothstep(0.08, 0.0, behind + 0.02 * streak) * band * tipFade * uAlpha * 1.4;
  c *= smoothstep(0.4, 2.0, vDepth);
  gl_FragColor = vec4(c, 1.0);
}`;

// Twisting funnel (tornado / hurricane wall): an open unit cylinder whose
// radius follows uR0 -> uR1 with height, snaking with time. Alpha blended
// dusty wind with brighter wisps, so it reads on dark and lit floors alike.
const FUNNEL_VERT = /* glsl */ `
uniform float uTime; uniform float uR0; uniform float uR1; uniform float uH; uniform float uSnake; uniform float uSpin;
varying vec2 vUv; varying float vFacing; varying float vDepth;
void main(){
  vUv = uv;
  float y = position.y + 0.5;
  float r = mix(uR0, uR1, pow(y, 1.6));
  float a = atan(position.z, position.x);
  vec3 p = vec3(cos(a) * r, y * uH, sin(a) * r);
  p.x += sin(y * 3.1 + uTime * 2.3) * uSnake * y;
  p.z += cos(y * 2.7 + uTime * 1.9) * uSnake * y;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  vec3 n = normalize(normalMatrix * vec3(cos(a), 0.0, sin(a)));
  vFacing = abs(dot(n, normalize(-mv.xyz)));
  vDepth = -mv.z;
  gl_Position = projectionMatrix * mv;
}`;
const FUNNEL_FRAG = /* glsl */ `
uniform vec3 uColor; uniform vec3 uHi; uniform float uTime; uniform float uAlpha; uniform float uSpin; uniform float uTwist;
varying vec2 vUv; varying float vFacing; varying float vDepth;
${NOISE_GLSL}
void main(){
  float u = vUv.x, v = vUv.y;
  vec2 q = vec2(u * 7.0 + v * uTwist - uTime * uSpin, v * 3.0 - uTime * 0.6);
  float n = fbm(q);
  float wisp = smoothstep(0.42, 0.78, fbm(vec2(u * 13.0 + v * uTwist * 1.6 - uTime * uSpin * 1.4, v * 5.0 - uTime)));
  float ends = smoothstep(0.0, 0.12, v) * smoothstep(1.0, 0.7, v);
  float sil = 0.3 + 0.7 * pow(1.0 - vFacing, 1.5);
  float a = (n * 0.55 + wisp * 0.6) * ends * sil * uAlpha;
  a *= smoothstep(0.6, 3.0, vDepth);
  if (a < 0.004) discard;
  vec3 c = mix(uColor, uHi, wisp);
  gl_FragColor = vec4(c, clamp(a, 0.0, 0.9));
}`;

// Breath / gust cone: open cone from the apex (y=0) to the mouth (y=1),
// additive scrolling noise that cools from a hot throat to dark embers.
const CONE_VERT = /* glsl */ `
uniform float uTime;
varying vec2 vUv; varying float vFacing; varying float vDepth;
void main(){
  vUv = uv;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vec3 n = normalize(normalMatrix * normal);
  vFacing = abs(dot(n, normalize(-mv.xyz)));
  vDepth = -mv.z;
  gl_Position = projectionMatrix * mv;
}`;
const CONE_FRAG = /* glsl */ `
uniform vec3 uHot; uniform vec3 uMid; uniform vec3 uCool; uniform float uTime; uniform float uAlpha; uniform float uSpeed;
varying vec2 vUv; varying float vFacing; varying float vDepth;
${NOISE_GLSL}
void main(){
  float along = 1.0 - vUv.y; // three's cone uv.y runs base -> apex
  float u = vUv.x;
  float n = fbm(vec2(u * 9.0 + along * 2.0, along * 4.0 - uTime * uSpeed));
  float n2 = fbm(vec2(u * 17.0 - along * 3.0, along * 7.0 - uTime * uSpeed * 1.7));
  float tongues = smoothstep(0.22, 0.72, n * 0.6 + n2 * 0.5 - along * 0.2);
  float body = pow(vFacing, 0.7);
  // strongest through the first half; the mouth dissolves instead of drawing a rim
  float ends = smoothstep(0.0, 0.1, along) * (1.0 - smoothstep(0.35, 0.95, along));
  float k = tongues * body * ends * uAlpha;
  vec3 c = mix(uHot, uMid, smoothstep(0.05, 0.45, along));
  c = mix(c, uCool, smoothstep(0.45, 0.95, along));
  c *= k * smoothstep(0.3, 1.5, vDepth);
  gl_FragColor = vec4(c, 1.0);
}`;

// Irregular liquid pool: overlapping blobs, then value noise eats the edges
// and varies the depth of the colour (darker where the pool is deeper).
function puddle(g, rgb, alpha, blobs, spread, seed) {
  let sd = seed * 9301 + 49297;
  const rnd = () => ((sd = (sd * 9301 + 49297) % 233280) / 233280);
  g.fillStyle = '#fff';
  for (let i = 0; i < blobs; i++) {
    const a = rnd() * Math.PI * 2, r = Math.pow(rnd(), 1.5) * spread;
    g.beginPath(); g.arc(128 + Math.cos(a) * r, 128 + Math.sin(a) * r, 5 + rnd() * 26 * (1 - r / (spread + 10)), 0, Math.PI * 2); g.fill();
  }
  // a few drips flung outward
  for (let i = 0; i < 14; i++) {
    const a = rnd() * Math.PI * 2, r = spread * (0.8 + rnd() * 0.35);
    g.beginPath(); g.arc(128 + Math.cos(a) * r, 128 + Math.sin(a) * r, 1.5 + rnd() * 4, 0, Math.PI * 2); g.fill();
  }
  const img = g.getImageData(0, 0, 256, 256);
  const d = img.data;
  const P = new Float32Array(32 * 32);
  for (let i = 0; i < P.length; i++) P[i] = rnd();
  const vn = (x, y) => {
    const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
    const at = (i, j) => P[(i & 31) + (j & 31) * 32];
    const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    const a = at(xi, yi), b = at(xi + 1, yi), c = at(xi, yi + 1), e = at(xi + 1, yi + 1);
    return a + (b - a) * u + (c - a) * v + (a - b - c + e) * u * v;
  };
  for (let j = 0; j < 256; j++) for (let i = 0; i < 256; i++) {
    const k = (j * 256 + i) * 4;
    const n = vn(i / 16, j / 16) * 0.6 + vn(i / 6, j / 6) * 0.4;
    // erode the coverage mask with noise for a ragged edge
    const m = d[k + 3] / 255;
    const cov = Math.max(0, Math.min(1, (m * 1.25 - 0.25) + (n - 0.5) * 0.9));
    const edge = Math.min(1, cov * 3);
    const shade = 0.55 + 0.6 * n;
    d[k] = Math.min(255, rgb[0] * shade); d[k + 1] = Math.min(255, rgb[1] * shade); d[k + 2] = Math.min(255, rgb[2] * shade);
    d[k + 3] = edge * alpha * 255;
  }
  g.putImageData(img, 0, 0);
}

// tangent-space normal map from a texture's alpha (pool meniscus catches light)
function alphaNormalMap(srcCanvas, strength = 3) {
  const S = srcCanvas.width;
  const src = srcCanvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, S, S).data;
  const h = new Float32Array(S * S);
  // blurred height so edges bulge smoothly
  for (let j = 0; j < S; j++) for (let i = 0; i < S; i++) {
    let s = 0, n = 0;
    for (let dj = -2; dj <= 2; dj++) for (let di = -2; di <= 2; di++) {
      const x = Math.min(S - 1, Math.max(0, i + di)), y = Math.min(S - 1, Math.max(0, j + dj));
      s += src[(y * S + x) * 4 + 3]; n++;
    }
    h[j * S + i] = s / n / 255;
  }
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  const img = g.createImageData(S, S);
  for (let j = 0; j < S; j++) for (let i = 0; i < S; i++) {
    const dx = (h[j * S + Math.min(S - 1, i + 1)] - h[j * S + Math.max(0, i - 1)]) * strength;
    const dy = (h[Math.min(S - 1, j + 1) * S + i] - h[Math.max(0, j - 1) * S + i]) * strength;
    const l = Math.hypot(dx, dy, 1);
    const k = (j * S + i) * 4;
    img.data[k] = (-dx / l * 0.5 + 0.5) * 255; img.data[k + 1] = (dy / l * 0.5 + 0.5) * 255; img.data[k + 2] = (1 / l * 0.5 + 0.5) * 255; img.data[k + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.NoColorSpace;
  return t;
}

// how each decal type is drawn: lit pools respond to torches and spell light,
// additive ones (glyphs, rime) glow faintly
const DECAL_LOOK = {
  scorch: { rough: 0.95 },
  crack: { rough: 0.95 },
  blood: { rough: 0.22, normal: true, metal: 0.0 },
  slime: { rough: 0.18, normal: true, metal: 0.0, emissive: 0x111e06 },
  glyph: { additive: true },
  frost: { additive: true },
};

function decalTextures() {
  const mk = (draw) => {
    const c = document.createElement('canvas');
    c.width = c.height = 256;
    const g = c.getContext('2d', { willReadFrequently: true });
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
    // wet pools: dark, desaturated, with noisy ragged edges; lit (see decal())
    blood: mk((g) => puddle(g, [46, 4, 6], 0.92, 34, 100, 3)),
    slime: mk((g) => puddle(g, [46, 56, 16], 0.9, 30, 96, 7)),
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
      vertexShader: RING_VERT,
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
    this.beamPool = this._pool(16, () => new THREE.Mesh(beamGeo, new THREE.ShaderMaterial({
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
    // decals: every pooled quad owns a lit (standard) material for pools,
    // scorch and cracks, and an unlit additive one for glyphs and rime
    this.decalTex = decalTextures();
    this.decalNormals = { blood: alphaNormalMap(this.decalTex.blood.image), slime: alphaNormalMap(this.decalTex.slime.image) };
    // flat normal for dry decals, so every lit decal shares one shader program
    this.flatNormal = new THREE.DataTexture(new Uint8Array([128, 128, 255, 255]), 1, 1);
    this.flatNormal.needsUpdate = true;
    this.decalPool = this._pool(80, () => {
      const lit = new THREE.MeshStandardMaterial({ transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, roughness: 0.9, metalness: 0, map: this.decalTex.scorch, normalMap: this.flatNormal });
      // mapped from the start: a map assigned later would not change the
      // compiled program, and the decal drew as a solid coloured quad
      const glow = new THREE.MeshBasicMaterial({ map: this.decalTex.glyph, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, blending: THREE.AdditiveBlending, fog: true });
      const m = new THREE.Mesh(plane, lit);
      m.userData.lit = lit; m.userData.glow = glow;
      m.receiveShadow = true;
      return m;
    });
    // sword slashes
    // arc centred on local +Z (forward once yawed to the swing direction)
    const slashGeo = new THREE.RingGeometry(0.55, 1.0, 40, 3, -Math.PI / 2 - Math.PI * 0.4, Math.PI * 0.8);
    slashGeo.rotateX(-Math.PI / 2);
    this.slashPool = this._pool(8, () => new THREE.Mesh(slashGeo, new THREE.ShaderMaterial({
      vertexShader: SLASH_VERT, fragmentShader: SLASH_FRAG,
      uniforms: { uColor: { value: new THREE.Color() }, uCore: { value: new THREE.Color() }, uProg: { value: 0 }, uSide: { value: 1 }, uAlpha: { value: 1 }, uSeed: { value: 0 }, uR0: { value: 0.55 }, uArc: { value: Math.PI * 0.8 } },
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    })));
    // tornado / hurricane funnels
    const funnelGeo = new THREE.CylinderGeometry(1, 1, 1, 36, 14, true);
    this.funnelPool = this._pool(4, () => {
      const m = new THREE.Mesh(funnelGeo, new THREE.ShaderMaterial({
        vertexShader: FUNNEL_VERT, fragmentShader: FUNNEL_FRAG,
        uniforms: { uTime: { value: 0 }, uR0: { value: 0.3 }, uR1: { value: 2 }, uH: { value: 5 }, uSnake: { value: 0.3 }, uSpin: { value: 2.5 }, uTwist: { value: 3 }, uColor: { value: new THREE.Color() }, uHi: { value: new THREE.Color() }, uAlpha: { value: 1 } },
        transparent: true, depthWrite: false, side: THREE.DoubleSide,
      }));
      m.frustumCulled = false;
      return m;
    });
    // breath / gust cones (apex at origin, mouth at +Y = 1)
    const coneGeo = new THREE.ConeGeometry(1, 1, 28, 8, true);
    coneGeo.rotateX(Math.PI);
    coneGeo.translate(0, 0.5, 0);
    this.conePool = this._pool(4, () => {
      const m = new THREE.Mesh(coneGeo, new THREE.ShaderMaterial({
        vertexShader: CONE_VERT, fragmentShader: CONE_FRAG,
        uniforms: { uTime: { value: 0 }, uHot: { value: new THREE.Color() }, uMid: { value: new THREE.Color() }, uCool: { value: new THREE.Color() }, uAlpha: { value: 1 }, uSpeed: { value: 3 } },
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      }));
      m.frustumCulled = false;
      return m;
    });
    this._up = new THREE.Vector3(0, 1, 0);
    this._tv = new THREE.Vector3();
    // draw one invisible item of each new pool for a couple of frames so their
    // shaders compile up front instead of hitching on the first cast
    this._warm = [this.slashPool.items[0], this.funnelPool.items[0], this.conePool.items[0], this.decalPool.items[1]];
    this._warm[3].material = this._warm[3].userData.glow;
    for (const m of this._warm) { m.userData.fc = m.frustumCulled; m.visible = true; m.frustumCulled = false; if (m.material.uniforms?.uAlpha) m.material.uniforms.uAlpha.value = 0; else m.material.opacity = 0; }
    this._warmFrames = 3;
    // ultimate ground sigils; a placeholder map from the start keeps the shader
    // the same once a class texture is swapped in
    const ph = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
    ph.needsUpdate = true;
    this.sigilPool = this._pool(4, () => {
      const m = new THREE.Mesh(this.planeGeo, new THREE.MeshBasicMaterial({ map: ph, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
      m.renderOrder = 2;
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
        fragmentShader: 'uniform vec3 uColor; uniform float uAlpha; varying vec2 vUv; void main(){ float d = abs(vUv.y - 0.5) * 2.0; float c = pow(1.0 - d, 2.0); gl_FragColor = vec4(uColor * c * uAlpha + vec3(0.9, 0.93, 1.0) * pow(1.0 - d, 8.0) * uAlpha * 1.5, 1.0); }',
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

  update(dt, time, realDt = dt) {
    this.time = time;
    if (this._warm && --this._warmFrames <= 0) {
      for (const m of this._warm) { if (!this.active.some((a) => a.mesh === m)) m.visible = false; m.frustumCulled = m.userData.fc; }
      this._warm[3].material = this._warm[3].userData.lit;
      this._warm = null;
    }
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
    this.hitstop = Math.max(0, this.hitstop - realDt);
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
    // element core colours are HDR; a ring that wide must stay below bloom
    m.material.uniforms.uColor.value.setRGB(...clampHDR(Array.isArray(color) ? color : C(color, 2.5), 1.1, _rc));
    m.material.uniforms.uWidth.value = width;
    this._track(m, life, (k) => { m.material.uniforms.uProg.value = k; m.material.uniforms.uTime.value = this.time; });
  }

  // A big rune circle flaring open on the ground (ultimates). map: the caster's
  // sigil texture, white on black; color: class colour.
  groundSigil(pos, map, color, radius = 2.6, life = 1.8) {
    const m = this.sigilPool.get();
    const mat = m.material;
    mat.map = map; // always mapped (placeholder at creation), so swapping never recompiles
    const col = new THREE.Color(color).multiplyScalar(1.6);
    m.position.set(pos.x, (pos.y ?? 0) + 0.05, pos.z);
    const spin = Math.random() < 0.5 ? -1 : 1, rot0 = Math.random() * Math.PI * 2;
    this._track(m, life, (k) => {
      // snaps open, then drifts wider and fades
      const open = 1 - Math.pow(1 - Math.min(k / 0.14, 1), 3);
      m.scale.setScalar(radius * 0.5 * (0.3 + 0.7 * open + 0.12 * k));
      m.rotation.y = rot0 + spin * (k * 2.2 + open * 0.6);
      const a = k < 0.06 ? k / 0.06 : k < 0.55 ? 1 : 1 - (k - 0.55) / 0.45;
      mat.color.copy(col).multiplyScalar(a * (1 + 0.6 * Math.max(0, 1 - k / 0.12)));
    });
    this.ring(pos, radius * 1.05, color, 0.6, 0.12);
    this.flash(new THREE.Vector3(pos.x, (pos.y ?? 0) + 0.6, pos.z), color, 22, radius * 3.5, 0.5);
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

  // 0 when the camera is inside (or right at) a sphere of radius r around pos,
  // 1 once it is comfortably outside: a shell seen from within or skimming
  // the lens shows up as a huge curved band across the screen
  shellCamK(pos, r) {
    const d = this.camera.position.distanceTo(pos);
    const t = (d - r * 1.05 - 0.4) / (r * 0.5 + 1.0);
    return t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t);
  }

  shell(pos, o = {}) {
    const r0 = o.from ?? 0.2, r1 = o.radius ?? 3;
    // transient shells are skipped outright when the viewer starts inside them
    if (!o.follow && this.shellCamK(pos, r1) <= 0) return null;
    const m = this.shellPool.get();
    const fx = fxOf(o.element);
    const u = m.material.uniforms;
    u.uColor.value.setRGB(...clampHDR(o.color ?? fx.mid, 1.4));
    m.position.copy(pos);
    const life = o.life ?? 0.4;
    if (o.follow) {
      // persistent shell following a target (shields, fields)
      m.visible = true;
      m.scale.setScalar(r1);
      return {
        mesh: m,
        update: (p, alpha = 1) => { m.position.copy(p); u.uAlpha.value = alpha * this.shellCamK(p, r1); u.uTime.value = this.time; },
        release: () => {
          const a0 = u.uAlpha.value;
          this._track(m, 0.25, (k) => { m.scale.setScalar(r1 * (1 + k * 0.3)); u.uAlpha.value = a0 * (1 - k) * this.shellCamK(m.position, r1 * (1 + k * 0.3)); });
        },
      };
    }
    this._track(m, life, (k) => {
      const e = 1 - Math.pow(1 - k, 3);
      const r = r0 + (r1 - r0) * e;
      m.scale.setScalar(r);
      u.uAlpha.value = (1 - k) * (o.alpha ?? 1) * this.shellCamK(m.position, r);
      u.uTime.value = this.time;
    });
    return null;
  }

  // Sword arc sweeping across `range` metres in front of `o` along flat dir d.
  // side = +1 sweeps right-to-left, -1 the other way. Pooled.
  slash(o, d, element, range, side = 1, opts = {}) {
    const m = this.slashPool.get();
    const fx = fxOf(element);
    const u = m.material.uniforms;
    u.uColor.value.setRGB(...clampHDR(fx.mid, 1.5));
    u.uCore.value.setRGB(...clampHDR(fx.core, 1.8));
    u.uSide.value = side;
    u.uSeed.value = Math.random() * 50;
    u.uAlpha.value = opts.alpha ?? 1;
    m.position.copy(o);
    m.scale.setScalar(range);
    const yaw = Math.atan2(d.x, d.z);
    // a diagonal cut reads far better from eye height than a flat one
    const tilt = opts.tilt ?? 0.28;
    m.rotation.set(side * tilt, yaw, side * 0.18, 'YXZ');
    const life = opts.life ?? 0.24;
    this._track(m, life, (k) => {
      u.uProg.value = Math.min(1, k * 1.6);
      u.uAlpha.value = (opts.alpha ?? 1) * (k < 0.55 ? 1 : 1 - (k - 0.55) / 0.45);
      m.scale.setScalar(range * (0.94 + k * 0.1));
    });
    // a few hot sparks thrown off the blade's path (not confetti)
    const n = opts.sparks ?? 8;
    for (let i = 0; i < n; i++) {
      const a = yaw + (i / Math.max(1, n - 1) - 0.5) * 2.2 * side;
      const r = range * rand(0.75, 1);
      this.P.glow({ x: o.x + Math.sin(a) * r, y: o.y + rand(-0.25, 0.25) - side * Math.sin(a - yaw) * tilt * r * 0.5, z: o.z + Math.cos(a) * r,
        vx: Math.cos(a) * 3 * side, vy: rand(-0.5, 1), vz: -Math.sin(a) * 3 * side,
        r: fx.core[0] * 0.7, g: fx.core[1] * 0.7, b: fx.core[2] * 0.7, r2: fx.end[0], g2: fx.end[1], b2: fx.end[2],
        life: rand(0.18, 0.32), size: 0.035, size2: 0.01, stretch: 0.02, sprite: SPR.SPARK, drag: 4 });
    }
    return m;
  }

  // Persistent twisting funnel. update(pos, alpha) each frame, release() when done.
  // o: { r0, r1, height, color:[r,g,b], hi:[r,g,b], alpha, snake, spin, twist }
  funnel(o = {}) {
    const m = this.funnelPool.get();
    const u = m.material.uniforms;
    u.uR0.value = o.r0 ?? 0.3; u.uR1.value = o.r1 ?? 2; u.uH.value = o.height ?? 5;
    u.uSnake.value = o.snake ?? 0.3; u.uSpin.value = o.spin ?? 2.5; u.uTwist.value = o.twist ?? 3;
    u.uColor.value.setRGB(...(o.color ?? [0.32, 0.34, 0.33]));
    u.uHi.value.setRGB(...(o.hi ?? [0.85, 0.95, 0.92]));
    const a0 = o.alpha ?? 0.8;
    u.uAlpha.value = 0;
    m.visible = true;
    m.rotation.set(0, 0, 0);
    const t0 = this.time;
    const handle = {
      mesh: m,
      update: (p, alpha = 1) => {
        m.position.copy(p);
        u.uTime.value = this.time;
        // grow in over the first 0.3 s
        u.uAlpha.value = a0 * alpha * Math.min(1, (this.time - t0) / 0.3);
      },
      release: (fade = 0.4) => {
        const a1 = u.uAlpha.value;
        this._track(m, fade, (k) => { u.uAlpha.value = a1 * (1 - k); u.uTime.value = this.time; u.uR1.value *= 1.01; });
      },
    };
    return handle;
  }

  // Persistent cone (breath weapons, gusts): update(origin, dir, length, radius)
  // each frame, release() when done. Colours are [r,g,b] (kept <= ~1.5).
  cone(o = {}) {
    const m = this.conePool.get();
    const u = m.material.uniforms;
    const fx = fxOf(o.element ?? 'fire');
    u.uHot.value.setRGB(...clampHDR(o.hot ?? fx.core, 1.5));
    u.uMid.value.setRGB(...clampHDR(o.mid ?? fx.mid, 1.3));
    u.uCool.value.setRGB(...(o.cool ?? fx.end));
    u.uSpeed.value = o.speed ?? 3;
    const a0 = o.alpha ?? 1;
    u.uAlpha.value = 0;
    if (o.life) {
      // one-shot gust: placed once, punches in and fades over `life`
      m.position.copy(o.origin);
      m.quaternion.setFromUnitVectors(this._up, this._tv.copy(o.dir).normalize());
      m.scale.set(o.radius, o.len, o.radius);
      this._track(m, o.life, (k) => {
        u.uTime.value = this.time;
        u.uAlpha.value = a0 * Math.min(1, k * 8) * (1 - k);
        m.scale.y = o.len * (0.6 + 0.4 * Math.min(1, k * 3));
      });
      return null;
    }
    m.visible = true;
    const t0 = this.time;
    const handle = {
      mesh: m,
      update: (origin, dir, len, radius, alpha = 1) => {
        m.position.copy(origin);
        m.quaternion.setFromUnitVectors(this._up, this._tv.copy(dir).normalize());
        m.scale.set(radius, len, radius);
        u.uTime.value = this.time;
        u.uAlpha.value = a0 * alpha * Math.min(1, (this.time - t0) / 0.12);
      },
      release: (fade = 0.2) => {
        const a1 = u.uAlpha.value;
        this._track(m, fade, (k) => { u.uAlpha.value = a1 * (1 - k); u.uTime.value = this.time; m.scale.x *= 1.02; m.scale.z *= 1.02; });
      },
    };
    return handle;
  }

  decal(pos, type, size = 2, life = 8, color) {
    const m = this.decalPool.get();
    const look = DECAL_LOOK[type] ?? DECAL_LOOK.scorch;
    const mat = look.additive ? m.userData.glow : m.userData.lit;
    m.material = mat;
    mat.map = this.decalTex[type] ?? this.decalTex.scorch;
    mat.color.set(color ?? 0xffffff);
    if (look.additive) {
      // additive frost rime stacks with every impact, so keep it faint
      if (color === undefined) mat.color.set(0x23394d);
    } else {
      mat.normalMap = (look.normal && this.decalNormals[type]) || this.flatNormal;
      mat.roughness = look.rough ?? 0.9;
      mat.metalness = look.metal ?? 0;
      mat.emissive.set(look.emissive ?? 0x000000);
      // coloured lit decals (e.g. purple pools) are tinted, but kept dark
      if (color !== undefined) mat.color.multiplyScalar(0.5);
    }
    m.position.set(pos.x, (pos.y ?? 0) + 0.03 + Math.random() * 0.01, pos.z);
    m.rotation.set(0, Math.random() * Math.PI * 2, 0);
    m.scale.setScalar(size / 2);
    mat.opacity = 1;
    this._track(m, life, (k) => { mat.opacity = k > 0.75 ? 1 - (k - 0.75) / 0.25 : Math.min(1, k * 20); });
    return m;
  }

  // A shockwave rolling out along the floor: a ring of dust (or mist) puffs
  // shoved outward that slow and spread as they reach `radius`, so a nova reads
  // on the ground from any angle. o: { color:[r,g,b], alpha, count, glow:[r,g,b] }
  dustWave(pos, radius, o = {}) {
    const n = o.count ?? Math.round(14 + radius * 2.5);
    const c = o.color ?? [0.22, 0.2, 0.18];
    const g = o.glow;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + rand(-0.12, 0.12), sp = radius * rand(2.4, 3.0);
      const ca = Math.cos(a), sa = Math.sin(a);
      this.P.solid({ x: pos.x + ca * 0.5, y: pos.y + 0.2, z: pos.z + sa * 0.5, vx: ca * sp, vy: rand(0.1, 0.5), vz: sa * sp, r: c[0], g: c[1], b: c[2], a: o.alpha ?? 0.35, life: rand(1.0, 1.5), size: 0.6, size2: 1.6 + radius * 0.2, sprite: SPR.SMOKE, drag: 3, spin: rand(-1, 1) });
      if (g && i % 2 === 0) this.P.glow({ x: pos.x + ca * 0.3, y: pos.y + 0.15, z: pos.z + sa * 0.3, vx: ca * sp * 1.05, vy: rand(0.2, 1), vz: sa * sp * 1.05, r: g[0], g: g[1], b: g[2], life: rand(0.35, 0.55), size: 0.07, stretch: 0.03, drag: 3, sprite: SPR.SPARK });
    }
  }

  // ------------------------------------------------------------ composite effects
  muzzle(pos, dir, element, scale = 1) {
    const fx = fxOf(element);
    // the muzzle sits a metre from the lens: small, short and mostly carried
    // by the dynamic light; sparks are pushed forward out of the focus
    this.burst(pos, { element, count: Math.round(6 * scale), speed: 5 * scale, dir, spread: 0.45, life: 0.2, size: 0.045 * scale, sprite: SPR.SPARK, drag: 4, stretch: 0.012 });
    this.P.glow({ x: pos.x + dir.x * 0.25, y: pos.y + dir.y * 0.25, z: pos.z + dir.z * 0.25, r: fx.mid[0] * 0.55, g: fx.mid[1] * 0.55, b: fx.mid[2] * 0.55, life: 0.09, size: 0.3 * scale, size2: 0.12, sprite: SPR.GLOW });
    this.flash(pos, fx.light, 6 * scale, 6, 0.1);
  }

  impact(pos, element, scale = 1) {
    const fx = fxOf(element);
    const hot = element === 'fire' || element === 'enemyFire';
    const x = pos.x, y = pos.y, z = pos.z;
    this.P.glow({ x, y, z, r: fx.mid[0] * 0.45, g: fx.mid[1] * 0.45, b: fx.mid[2] * 0.45, life: 0.12, size: 0.7 * scale, size2: 0.25, sprite: SPR.GLOW });
    // the hit itself: a crisp star that pops open and is gone in a blink, and a
    // thin shock ring around it - both still read at range, where sparks are
    // sub-pixel, and neither lingers long enough to hide the target
    const matter = hot || element === 'earth' || element === 'blood' || element === 'poison' || element === 'enemyGreen' || element === 'physical';
    this.P.glow({ x, y, z, r: fx.core[0] * 0.55, g: fx.core[1] * 0.55, b: fx.core[2] * 0.55, life: 0.11, size: 0.5 * scale, size2: 1.15 * scale, sprite: matter ? SPR.GLOW : SPR.STAR });
    if (!matter) this.P.glow({ x, y, z, r: fx.mid[0] * 0.5, g: fx.mid[1] * 0.5, b: fx.mid[2] * 0.5, r2: fx.end[0] * 0.5, g2: fx.end[1] * 0.5, b2: fx.end[2] * 0.5, life: 0.2, size: 0.2 * scale, size2: 1.5 * scale, sprite: SPR.RING });
    else if (hot) this.P.glow({ x, y, z, vy: 1.2, r: fx.mid[0] * 0.45, g: fx.mid[1] * 0.45, b: fx.mid[2] * 0.45, r2: fx.end[0], g2: fx.end[1], b2: fx.end[2], life: 0.35, size: 0.35 * scale, size2: 0.9 * scale, sprite: SPR.SMOKE, spin: 2 });
    // few small sparks, cooling over their life (orange -> deep red for fire)
    this.burst(pos, { element, count: Math.round(7 * scale), speed: 5 * scale, life: 0.35, size: 0.04 * scale, sprite: SPR.SPARK, gravity: hot || element === 'earth' ? 7 : 1, stretch: 0.015,
      color: scaleC(fx.mid, 1.1, _sc), color2: fx.end });
    this.flash(pos, fx.light, 10 * scale, 6 * scale, 0.15);
    switch (element) {
      case 'fire': case 'enemyFire':
        this.burst(pos, { element, count: Math.round(4 * scale), speed: 1.8, life: 0.45, size: 0.3 * scale, sprite: SPR.FLAME, upward: 0.5, size2: 0.05, drag: 3, color: scaleC(fx.mid, 0.8, _sc), color2: fx.end });
        this.smoke(pos, { count: 2, size: 0.4 * scale, life: 1, color: fx.smoke });
        break;
      case 'frost':
        this.burst(pos, { element, count: Math.round(6 * scale), speed: 5, life: 0.5, size: 0.1 * scale, sprite: SPR.SHARD, gravity: 9, spin: 8, color: [0.9, 1.25, 1.5] });
        break;
      case 'earth':
        this.burst(pos, { count: Math.round(8 * scale), speed: 5, life: 0.7, size: 0.15 * scale, sprite: SPR.CHUNK, gravity: 14, solid: true, color: [0.3, 0.25, 0.2], color2: [0.2, 0.18, 0.15], spin: 5 });
        this.smoke(pos, { count: 3, size: 0.5, color: fx.smoke, alpha: 0.35 });
        break;
      case 'blood':
        this.burst(pos, { count: Math.round(10 * scale), speed: 4, life: 0.6, size: 0.07, sprite: SPR.DROP, gravity: 12, solid: true, color: [0.28, 0.0, 0.015], color2: [0.15, 0, 0.01], stretch: 0.04 });
        break;
      case 'shadow': case 'enemyPurple':
        this.smoke(pos, { count: 2, size: 0.5, color: [0.03, 0.0, 0.05], alpha: 0.6, life: 0.8 });
        break;
      case 'poison': case 'enemyGreen':
        this.burst(pos, { element, count: 4, speed: 1.5, life: 0.8, size: 0.13, sprite: SPR.BUBBLE, upward: 0.4, gravity: -1, color: scaleC(fx.mid, 0.6, _sc) });
        this.burst(pos, { count: 5, speed: 3, life: 0.6, size: 0.06, sprite: SPR.DROP, gravity: 10, solid: true, color: [0.12, 0.17, 0.04], color2: [0.07, 0.1, 0.02], stretch: 0.03 });
        break;
      case 'arcane':
        this.burst(pos, { element, count: Math.round(3 * scale), speed: 2.2, life: 0.55, size: 0.2 * scale, size2: 0.05, sprite: SPR.RUNE, drag: 3, spin: 3, color: scaleC(fx.mid, 0.75, _sc) });
        this.burst(pos, { element, count: Math.round(5 * scale), speed: 4, life: 0.45, size: 0.09, sprite: SPR.STAR, drag: 3, spin: 4, color: scaleC(fx.core, 0.6, _sc) });
        break;
      case 'holy':
        // a burst of short radiant rays, then motes drifting up
        for (let i = 0; i < 6; i++) {
          const a = rand(0, Math.PI * 2), e = rand(-0.5, 0.8), s = 9 * scale;
          this.P.glow({ x, y, z, vx: Math.cos(a) * s, vy: e * s, vz: Math.sin(a) * s, r: fx.core[0] * 0.5, g: fx.core[1] * 0.5, b: fx.core[2] * 0.5, r2: fx.mid[0] * 0.3, g2: fx.mid[1] * 0.3, b2: fx.mid[2] * 0.3, life: 0.2, size: 0.06, stretch: 0.045, drag: 6, sprite: SPR.GLOW });
        }
        this.burst(pos, { element, count: Math.round(4 * scale), speed: 1.2, life: 0.9, size: 0.07, sprite: SPR.STAR, gravity: -1.5, upward: 0.6, drag: 1.5, color: scaleC(fx.core, 0.55, _sc) });
        break;
      case 'necrotic':
        this.burst(pos, { element, count: Math.round(4 * scale), speed: 1.6, life: 0.7, size: 0.26 * scale, size2: 0.05, sprite: SPR.WISP, upward: 0.8, gravity: -1.5, drag: 2, spin: 2, color: scaleC(fx.mid, 0.6, _sc), color2: fx.end });
        this.smoke(pos, { count: 1, size: 0.45 * scale, color: [0.02, 0.05, 0.02], alpha: 0.55, life: 0.9 });
        break;
      case 'lightning':
        // crackling forks thrown off the struck point
        for (let i = 0; i < 3; i++) this.P.glow({ x: x + rand(-0.15, 0.15), y: y + rand(-0.15, 0.15), z: z + rand(-0.15, 0.15), r: fx.core[0] * 0.65, g: fx.core[1] * 0.65, b: fx.core[2] * 0.65, life: rand(0.06, 0.13), size: rand(0.45, 0.75) * scale, sprite: SPR.BOLT, rot: rand(0, 6.28) });
        break;
      case 'time':
        this.P.glow({ x, y, z, r: fx.core[0] * 0.4, g: fx.core[1] * 0.4, b: fx.core[2] * 0.4, life: 0.35, size: 1.4 * scale, size2: 0.3, sprite: SPR.RING });
        this.burst(pos, { element, count: Math.round(4 * scale), speed: 2, life: 0.6, size: 0.08, sprite: SPR.STAR, drag: 3, color: scaleC(fx.core, 0.5, _sc), color2: fx.end });
        break;
      case 'wind':
        // a little cyclone of pale streaks spun off the hit
        for (let i = 0; i < Math.round(6 * scale); i++) {
          const a = (i / 6) * Math.PI * 2 + rand(-0.3, 0.3), s = rand(4, 7);
          this.P.glow({ x: x + Math.cos(a) * 0.2, y: y + rand(-0.3, 0.3), z: z + Math.sin(a) * 0.2, vx: -Math.sin(a) * s + Math.cos(a) * 2, vy: rand(0, 1.5), vz: Math.cos(a) * s + Math.sin(a) * 2, r: 0.55, g: 0.72, b: 0.7, life: 0.3, size: 0.16, size2: 0.03, sprite: SPR.WISP, stretch: 0.05, drag: 3 });
        }
        break;
      case 'blade':
        // a sharp glint: a few long, very fast streaks in a star
        for (let i = 0; i < 4; i++) {
          const a = rand(0, Math.PI * 2), e = rand(-0.6, 0.6), s = 14;
          this.P.glow({ x, y, z, vx: Math.cos(a) * s, vy: e * s, vz: Math.sin(a) * s, r: fx.core[0] * 0.6, g: fx.core[1] * 0.6, b: fx.core[2] * 0.6, r2: fx.mid[0] * 0.3, g2: fx.mid[1] * 0.3, b2: fx.mid[2] * 0.3, life: 0.14, size: 0.04, stretch: 0.05, drag: 8, sprite: SPR.SPARK });
        }
        break;
      default: break;
    }
  }

  explosion(pos, element, radius = 3, o = {}) {
    const fx = fxOf(element);
    const s = radius / 3;
    // Dim the glow by how much of the screen the blast covers: a blast that
    // fills the view (close, or huge) must not wash out the enemies inside it.
    const camD = Math.max(0.3, this.camera.position.distanceTo(pos));
    const tanHalf = Math.tan(THREE.MathUtils.degToRad((this.camera.fov ?? 78) * 0.5));
    const cover = radius / (camD * tanHalf);
    const dim = cover > 0.45 ? Math.max(0.3, Math.pow(0.45 / cover, 0.7)) : 1;
    const gk = 0.55 * dim;
    this.P.glow({ x: pos.x, y: pos.y, z: pos.z, r: fx.mid[0] * gk, g: fx.mid[1] * gk, b: fx.mid[2] * gk, life: 0.2, size: radius * 0.85, size2: radius * 0.35, sprite: SPR.GLOW });
    // the moment of release: a white-hot heart for a blink, and a shock ring
    // standing up in the air (the ground ring alone only reads from above)
    const ck = 0.5 * dim, rk = 0.42 * dim;
    this.P.glow({ x: pos.x, y: pos.y, z: pos.z, r: fx.core[0] * ck, g: fx.core[1] * ck, b: fx.core[2] * ck, life: 0.09, size: radius * 0.55, size2: radius * 0.9, sprite: SPR.GLOW });
    const matter = element === 'fire' || element === 'enemyFire' || element === 'earth' || element === 'blood' || element === 'poison' || element === 'enemyGreen' || element === 'physical';
    if (!matter) this.P.glow({ x: pos.x, y: pos.y, z: pos.z, r: fx.core[0] * rk, g: fx.core[1] * rk, b: fx.core[2] * rk, r2: fx.mid[0] * rk * 0.5, g2: fx.mid[1] * rk * 0.5, b2: fx.mid[2] * rk * 0.5, life: 0.3, size: radius * 0.4, size2: radius * 2.4, sprite: SPR.RING });
    this.flash(pos, fx.light, Math.min(50 * s, 60) * dim, Math.min(radius * 4, 16), 0.35);
    this.ring({ x: pos.x, y: (o.groundY ?? pos.y - 0.5), z: pos.z }, radius * 1.1, scaleC(fx.mid, 0.4 * Math.max(0.5, dim), _sc2), 0.45, 0.16);
    // shock shell only for the "energy" elements (fire/earth/blood/poison are matter)
    const shelled = element === 'arcane' || element === 'lightning' || element === 'frost' || element === 'time' || element === 'holy' || element === 'shadow' || element === 'enemyPurple' || element === 'blade';
    if (shelled) this.shell(pos, { element, radius: radius * 1.05, from: radius * 0.2, life: 0.3, alpha: 0.28 * dim });
    this.burst(pos, { element, count: Math.round(18 * s), speed: 10 * s, life: 0.55, size: 0.05, sprite: SPR.SPARK, gravity: 6, stretch: 0.02, drag: 2.5, color: scaleC(fx.mid, dim, _sc), color2: fx.end });
    const ground = { x: pos.x, y: o.groundY ?? pos.y - 0.5, z: pos.z };
    switch (element) {
      case 'fire': case 'enemyFire': {
        // a churning ball of flame inside dark smoke, not a white sun
        this.burst(pos, { element, count: Math.round(28 * s), speed: 4.5 * s, life: 0.7, size: 0.55 * s, size2: 0.12, sprite: SPR.FLAME, drag: 3, upward: 0.25, color: scaleC(fx.mid, 1.05 * dim, _sc), color2: fx.end, spin: 1.5 });
        // the body of the blast: big billowing tongues that swell outward, then a
        // column of flame rolling up out of it into the smoke
        // (glowing smoke-textured puffs: billowing and ragged, never neat cones)
        this.burst(pos, { element, count: Math.round(12 * s), speed: 2.6 * s, life: 0.55, size: 0.8 * s, size2: 1.7 * s, sprite: SPR.SMOKE, drag: 4, jitter: 0.25 * radius, color: scaleC(fx.mid, 0.6 * dim, _sc), color2: fx.end, spin: 1.5 });
        for (let i = 0; i < Math.round(7 * s); i++) {
          this.P.glow({ x: pos.x + rand(-0.3, 0.3) * radius, y: pos.y + rand(0, 0.4), z: pos.z + rand(-0.3, 0.3) * radius, vx: rand(-0.6, 0.6), vy: rand(3, 6) * Math.sqrt(s), vz: rand(-0.6, 0.6),
            r: fx.mid[0] * 0.7 * dim, g: fx.mid[1] * 0.7 * dim, b: fx.mid[2] * 0.7 * dim, r2: fx.end[0], g2: fx.end[1], b2: fx.end[2], life: rand(0.6, 0.9), size: 0.7 * s, size2: 0.25 * s, sprite: SPR.FLAME, drag: 1.6, delay: rand(0, 0.12), spin: 2 });
        }
        this.burst(pos, { element, count: Math.round(12 * s), speed: 2.5 * s, life: 0.45, size: 0.45 * s, size2: 0.1, sprite: SPR.FLAME, drag: 3, upward: 0.4, color: scaleC(fx.core, 0.7 * dim, _sc2), color2: fx.mid });
        this.burst(pos, { element, count: Math.round(14 * s), speed: 8 * s, life: 1.2, size: 0.03, size2: 0.01, sprite: SPR.EMBER, gravity: 5, drag: 1.2, upward: 0.4, stretch: 0.01, color: [1.5, 0.45, 0.06], color2: [0.45, 0.04, 0.0] });
        this.smoke(pos, { count: Math.round(8 * s), size: 1.0 * s, life: 2.2, spread: radius * 0.35, speed: 2, color: [0.045, 0.035, 0.03], alpha: 0.6 });
        this.decal(ground, 'scorch', radius * 1.5, 12);
        break;
      }
      case 'frost':
        this.burst(pos, { element, count: Math.round(18 * s), speed: 9 * s, life: 0.8, size: 0.18, sprite: SPR.SHARD, gravity: 10, spin: 6, color: scaleC([1.0, 1.35, 1.6], dim, _sc) });
        this.burst(pos, { element, count: Math.round(14 * s), speed: 3, life: 1.6, size: 0.08, sprite: SPR.SNOW, gravity: 0.5, spin: 2, drag: 1.5 });
        this.smoke(pos, { count: Math.round(6 * s), size: 1.0 * s, color: [0.45, 0.56, 0.65], alpha: 0.28, life: 1.6 });
        this.decal(ground, 'frost', radius * 1.8, 10);
        break;
      case 'lightning':
        for (let i = 0; i < 5; i++) {
          const b = pos.clone().add(new THREE.Vector3(rand(-1, 1), rand(-0.3, 1), rand(-1, 1)).multiplyScalar(radius * 1.1));
          this.lightning(pos, b, { element, life: 0.18, branches: 1 });
        }
        this.decal(ground, 'scorch', radius * 1.2, 8);
        break;
      case 'arcane':
        this.burst(pos, { element, count: Math.round(12 * s), speed: 6 * s, life: 0.9, size: 0.2, sprite: SPR.STAR, drag: 2, spin: 3, color: scaleC(fx.mid, dim, _sc) });
        this.burst(pos, { element, count: 6, speed: 3, life: 1.0, size: 0.3, sprite: SPR.RUNE, drag: 2.5, spin: 1.5, color: scaleC(fx.mid, 0.8 * dim, _sc) });
        this.decal(ground, 'glyph', radius * 1.8, 2.5, 0x9040d0);
        break;
      case 'holy':
        for (let i = 0; i < 12; i++) {
          const a = (i / 12) * Math.PI * 2;
          this.P.glow({ x: pos.x, y: pos.y, z: pos.z, vx: Math.cos(a) * 12, vy: rand(-1, 3), vz: Math.sin(a) * 12, r: fx.core[0] * 0.6 * dim, g: fx.core[1] * 0.6 * dim, b: fx.core[2] * 0.6 * dim, life: 0.4, size: 0.1, stretch: 0.05, drag: 4, sprite: SPR.GLOW });
        }
        this.burst(pos, { element, count: 14, speed: 2, life: 1.4, size: 0.1, sprite: SPR.STAR, gravity: -1, upward: 0.5, drag: 1 });
        this.decal(ground, 'glyph', radius * 1.6, 2, 0xd0a040);
        break;
      case 'shadow': case 'enemyPurple':
        this.smoke(pos, { count: Math.round(10 * s), size: 1.1 * s, color: [0.03, 0.0, 0.05], alpha: 0.75, life: 1.8, spread: radius * 0.4, speed: 3 });
        this.burst(pos, { element, count: 14, speed: 7, life: 0.8, size: 0.28, sprite: SPR.WISP, drag: 3, spin: 2, color: scaleC(fx.mid, 0.8 * dim, _sc) });
        // void fire: violet tongues licking up out of the dark, so the blast
        // still reads against black stone
        this.burst(pos, { element, count: Math.round(12 * s), speed: 2.5 * s, life: 0.6, size: 0.5 * s, size2: 0.1, sprite: SPR.FLAME, drag: 3, upward: 0.8, jitter: 0.3 * radius, color: scaleC(fx.mid, 0.7 * dim, _sc), color2: fx.end, spin: 2 });
        this.burst(pos, { element, count: Math.round(8 * s), speed: 3 * s, life: 0.5, size: 0.6 * s, size2: 1.2 * s, sprite: SPR.SMOKE, drag: 4, color: scaleC(fx.mid, 0.45 * dim, _sc), color2: fx.end, spin: 1.5 });
        break;
      case 'poison': case 'enemyGreen':
        // dark, low bile mist (half the old puffs) instead of bright green discs
        this.smoke(pos, { count: Math.round(6 * s), size: 1.0 * s, color: [0.07, 0.1, 0.025], alpha: 0.42, life: 2.2, spread: radius * 0.5, speed: 1.6, rise: 0.6 });
        this.burst(pos, { element, count: 10, speed: 4, life: 0.9, size: 0.14, sprite: SPR.BUBBLE, gravity: 3, upward: 0.6, color: scaleC(fx.mid, 0.55 * dim, _sc) });
        this.burst(pos, { count: Math.round(16 * s), speed: 6 * s, life: 0.8, size: 0.08, sprite: SPR.DROP, gravity: 12, solid: true, upward: 0.5, color: [0.1, 0.15, 0.03], color2: [0.06, 0.09, 0.02], stretch: 0.04 });
        this.decal(ground, 'slime', radius * 1.6, 10);
        break;
      case 'necrotic':
        this.burst(pos, { element, count: 18, speed: 6, life: 1.0, size: 0.3, sprite: SPR.WISP, drag: 2.5, upward: 0.3, spin: 2, color: scaleC(fx.mid, dim, _sc) });
        this.smoke(pos, { count: 6, size: 0.9, color: [0.03, 0.07, 0.03], alpha: 0.6 });
        break;
      case 'blood':
        this.burst(pos, { count: Math.round(32 * s), speed: 8 * s, life: 0.9, size: 0.09, sprite: SPR.DROP, gravity: 14, solid: true, color: [0.3, 0, 0.02], color2: [0.18, 0, 0.015], stretch: 0.04 });
        this.smoke(pos, { count: 4, size: 0.8, color: [0.16, 0.0, 0.015], alpha: 0.4 });
        this.decal(ground, 'blood', radius * 1.6, 14);
        break;
      case 'earth':
        this.burst(pos, { count: Math.round(30 * s), speed: 10 * s, life: 1.2, size: 0.25, sprite: SPR.CHUNK, gravity: 18, solid: true, color: [0.32, 0.27, 0.22], color2: [0.25, 0.2, 0.15], spin: 6, upward: 0.6 });
        this.smoke(pos, { count: Math.round(10 * s), size: 1.2 * s, color: [0.26, 0.21, 0.16], alpha: 0.5, life: 2.4, spread: radius * 0.5, speed: 3 });
        this.decal(ground, 'crack', radius * 1.8, 12);
        break;
      case 'time':
        this.ring({ x: pos.x, y: ground.y, z: pos.z }, radius * 0.7, scaleC(fx.mid, 0.8, _sc), 0.7, 0.1);
        this.burst(pos, { element, count: 12, speed: 4, life: 1.0, size: 0.35, sprite: SPR.RING, drag: 3, color: scaleC(fx.mid, 0.8 * dim, _sc) });
        this.decal(ground, 'glyph', radius * 1.6, 2, 0x30a890);
        break;
      case 'wind':
        for (let i = 0; i < 24; i++) {
          const a = (i / 24) * Math.PI * 2;
          this.P.glow({ x: pos.x + Math.cos(a) * 0.5, y: pos.y + rand(-0.5, 0.5), z: pos.z + Math.sin(a) * 0.5, vx: Math.cos(a + 1.2) * 10, vy: rand(0, 2), vz: Math.sin(a + 1.2) * 10, r: 0.7, g: 0.9, b: 0.9, life: 0.5, size: 0.3, sprite: SPR.WISP, stretch: 0.05, drag: 3 });
        }
        this.smoke(pos, { count: 8, size: 0.9, color: [0.42, 0.45, 0.44], alpha: 0.3, speed: 4 });
        break;
      case 'blade':
        this.burst(pos, { element, count: 12, speed: 12, life: 0.3, size: 0.04, sprite: SPR.SPARK, stretch: 0.03, drag: 3 });
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
          // ragged fire puffs trailing off (most), hot tongues (some)
          if (Math.random() < 0.6) this.P.glow({ x: px + rand(-0.06, 0.06), y: py + rand(-0.06, 0.06), z: pz + rand(-0.06, 0.06), vx: rand(-0.5, 0.5), vy: rand(0.3, 1.2), vz: rand(-0.5, 0.5), r: fx.mid[0] * 0.55, g: fx.mid[1] * 0.55, b: fx.mid[2] * 0.55, r2: fx.end[0], g2: fx.end[1], b2: fx.end[2], life: rand(0.22, 0.45), size: 0.2 * intensity, size2: 0.32 * intensity, sprite: SPR.SMOKE, drag: 2, spin: rand(-3, 3) });
          else this.P.glow({ x: px + rand(-0.05, 0.05), y: py + rand(-0.05, 0.05), z: pz + rand(-0.05, 0.05), vx: rand(-0.5, 0.5), vy: rand(0.2, 1.2), vz: rand(-0.5, 0.5), r: fx.mid[0] * 0.7, g: fx.mid[1] * 0.7, b: fx.mid[2] * 0.7, r2: fx.end[0], g2: fx.end[1], b2: fx.end[2], life: rand(0.15, 0.32), size: 0.18 * intensity, size2: 0.04, sprite: SPR.FLAME, drag: 2 });
          if (Math.random() < 0.18) this.P.glow({ x: px, y: py, z: pz, vx: rand(-1.5, 1.5), vy: rand(0, 2), vz: rand(-1.5, 1.5), r: 1.5, g: 0.45, b: 0.06, r2: 0.4, g2: 0.03, b2: 0, life: rand(0.4, 0.9), size: 0.025, sprite: SPR.EMBER, gravity: 2 });
          if (Math.random() < 0.14) this.P.solid({ x: px, y: py, z: pz, vy: 0.6, r: 0.05, g: 0.04, b: 0.035, a: 0.45, life: 1.2, size: 0.25 * Math.max(1, intensity * 0.6), size2: 0.8 * Math.max(1, intensity * 0.6), sprite: SPR.SMOKE, drag: 1 });
          break;
        case 'frost':
          this.P.glow({ x: px, y: py, z: pz, vx: rand(-0.4, 0.4), vy: rand(-0.4, 0.4), vz: rand(-0.4, 0.4), r: fx.mid[0], g: fx.mid[1], b: fx.mid[2], life: rand(0.2, 0.4), size: 0.18 * intensity, size2: 0.02, sprite: SPR.GLOW, drag: 2 });
          if (Math.random() < 0.3) this.P.glow({ x: px, y: py, z: pz, vx: rand(-1, 1), vy: rand(-1, 0.5), vz: rand(-1, 1), r: 0.9, g: 1.15, b: 1.4, life: rand(0.5, 1), size: 0.05, sprite: SPR.SNOW, spin: 3, gravity: 1 });
          break;
        case 'lightning':
          this.P.glow({ x: px + rand(-0.1, 0.1), y: py + rand(-0.1, 0.1), z: pz + rand(-0.1, 0.1), r: fx.core[0] * 0.7, g: fx.core[1] * 0.7, b: fx.core[2] * 0.7, life: rand(0.05, 0.15), size: 0.22 * intensity, sprite: SPR.BOLT, rot: rand(0, 6.28) });
          break;
        case 'shadow': case 'enemyPurple':
          this.P.glow({ x: px, y: py, z: pz, vx: rand(-0.5, 0.5), vy: rand(-0.5, 0.5), vz: rand(-0.5, 0.5), r: fx.mid[0], g: fx.mid[1], b: fx.mid[2], r2: fx.end[0], g2: fx.end[1], b2: fx.end[2], life: rand(0.3, 0.6), size: 0.25 * intensity, size2: 0.02, sprite: SPR.WISP, drag: 2, spin: 2 });
          if (Math.random() < 0.3) this.P.solid({ x: px, y: py, z: pz, r: 0.02, g: 0, b: 0.04, a: 0.6, life: 0.8, size: 0.2, size2: 0.5, sprite: SPR.SMOKE, drag: 1 });
          break;
        case 'poison': case 'enemyGreen':
          this.P.glow({ x: px, y: py, z: pz, vx: rand(-0.3, 0.3), vy: rand(-0.3, 0.3), vz: rand(-0.3, 0.3), r: fx.mid[0], g: fx.mid[1], b: fx.mid[2], life: rand(0.3, 0.5), size: 0.2 * intensity, size2: 0.03, sprite: SPR.GLOW, drag: 2 });
          if (Math.random() < 0.3) this.P.solid({ x: px, y: py, z: pz, vy: -1, r: 0.12, g: 0.18, b: 0.04, life: 0.6, size: 0.05, sprite: SPR.DROP, gravity: 6 });
          break;
        case 'earth':
          if (Math.random() < 0.5) this.P.solid({ x: px, y: py, z: pz, vx: rand(-1, 1), vy: rand(0, 1), vz: rand(-1, 1), r: 0.3, g: 0.25, b: 0.18, a: 0.45, life: 0.8, size: 0.2, size2: 0.5, sprite: SPR.SMOKE, drag: 1.5 });
          if (Math.random() < 0.3) this.P.solid({ x: px, y: py, z: pz, vx: rand(-1, 1), vy: rand(0, 2), vz: rand(-1, 1), r: 0.3, g: 0.25, b: 0.2, life: 0.6, size: 0.06, sprite: SPR.CHUNK, gravity: 12, spin: 5 });
          break;
        case 'blood':
          this.P.glow({ x: px, y: py, z: pz, vx: rand(-0.3, 0.3), vy: rand(-0.3, 0.3), vz: rand(-0.3, 0.3), r: fx.mid[0], g: fx.mid[1], b: fx.mid[2], life: rand(0.25, 0.4), size: 0.2 * intensity, size2: 0.02, sprite: SPR.GLOW, drag: 2 });
          if (Math.random() < 0.35) this.P.solid({ x: px, y: py, z: pz, vy: -0.5, r: 0.35, g: 0, b: 0.03, life: 0.6, size: 0.05, sprite: SPR.DROP, gravity: 10 });
          break;
        case 'wind':
          // pale streaks plus a little grey dust: wind has to read on dark and lit floors
          this.P.glow({ x: px + rand(-0.15, 0.15), y: py + rand(-0.1, 0.1), z: pz + rand(-0.15, 0.15), vx: vel.x * 0.15, vy: vel.y * 0.15, vz: vel.z * 0.15, r: 0.5, g: 0.68, b: 0.66, life: rand(0.15, 0.3), size: 0.12 * intensity, size2: 0.02, sprite: SPR.WISP, stretch: 0.03, drag: 3 });
          if (Math.random() < 0.35) this.P.solid({ x: px, y: py, z: pz, vx: rand(-0.6, 0.6), vy: rand(-0.2, 0.4), vz: rand(-0.6, 0.6), r: 0.5, g: 0.53, b: 0.52, a: 0.22, life: 0.6, size: 0.2 * intensity, size2: 0.6 * intensity, sprite: SPR.SMOKE, drag: 2, spin: 2 });
          break;
        default:
          this.P.glow({ x: px, y: py, z: pz, vx: rand(-0.3, 0.3), vy: rand(-0.3, 0.3), vz: rand(-0.3, 0.3), r: fx.mid[0] * 0.8, g: fx.mid[1] * 0.8, b: fx.mid[2] * 0.8, r2: fx.end[0], g2: fx.end[1], b2: fx.end[2], life: rand(0.2, 0.45), size: 0.18 * intensity, size2: 0.02, sprite: fx.spr === SPR.CHUNK ? SPR.GLOW : fx.spr, drag: 2, spin: 2 });
      }
    }
  }

  // ambient emitters for torches/braziers/candles
  flame(f, dt) {
    const s = f.size;
    const col = f.color;
    let r = 3.2, g = 1.2, b = 0.28, r2 = 1.2, g2 = 0.14, b2 = 0.03;
    if (col) { const c = _flameC.set(col); r = c.r * 3.2; g = c.g * 3.2; b = c.b * 3.2; r2 = c.r * 1.2; g2 = c.g * 0.5; b2 = c.b * 0.6; }
    if (f.kind === 'spores') {
      if (Math.random() < dt * 4) this.P.glowAmbient({ x: f.x + rand(-0.3, 0.3), y: f.y + rand(0, 0.4), z: f.z + rand(-0.3, 0.3), vx: rand(-0.1, 0.1), vy: rand(0.05, 0.25), vz: rand(-0.1, 0.1), r: 0.6, g: 2.4, b: 1.0, life: rand(2, 4), size: 0.04, sprite: SPR.GLOW, drag: 0.5 });
      return;
    }
    const rate = f.kind === 'candle' ? 10 : 34 * s;
    let n = rate * dt;
    while (n > 0) {
      if (n < 1 && Math.random() > n) break;
      n -= 1;
      this.P.glowAmbient({
        x: f.x + rand(-0.06, 0.06) * s, y: f.y + rand(0, 0.05), z: f.z + rand(-0.06, 0.06) * s,
        vx: rand(-0.15, 0.15), vy: (f.kind === 'candle' ? 0.25 : 0.8 * Math.sqrt(s)) + rand(0, 0.3), vz: rand(-0.15, 0.15),
        r, g, b, r2, g2, b2,
        life: f.kind === 'candle' ? rand(0.15, 0.25) : rand(0.35, 0.6), size: (f.kind === 'candle' ? 0.07 : 0.32 * s), size2: 0.03 * s, sprite: SPR.FLAME, rot: rand(-0.2, 0.2), drag: 1.5,
      });
    }
    if (f.kind !== 'candle') {
      if (Math.random() < dt * 3 * s) this.P.glowAmbient({ x: f.x, y: f.y + 0.2, z: f.z, vx: rand(-0.4, 0.4), vy: rand(0.8, 2), vz: rand(-0.4, 0.4), r: 4, g: 1.4, b: 0.3, life: rand(0.8, 1.6), size: 0.03, sprite: SPR.EMBER, drag: 0.8, gravity: -0.2 });
      if (Math.random() < dt * 1.5 * s) this.P.solid({ x: f.x, y: f.y + 0.4 * s, z: f.z, vx: rand(-0.1, 0.1), vy: rand(0.4, 0.8), vz: rand(-0.1, 0.1), r: 0.05, g: 0.045, b: 0.04, a: 0.25, life: 2.5, size: 0.2 * s, size2: 0.8 * s, sprite: SPR.SMOKE, drag: 0.6 });
      // soft glow halo
      if (Math.random() < dt * 8) this.P.glowAmbient({ x: f.x, y: f.y + 0.1 * s, z: f.z, r: r * 0.15, g: g * 0.15, b: b * 0.15, life: 0.3, size: 0.9 * s, size2: 0.9 * s, sprite: SPR.GLOW });
    }
  }
}
