import * as THREE from 'three';
import { makeSurfaceMaterial } from '../render/textures.js';

// Water surface: dark, glossy, with two scrolling normal layers so torch
// highlights shimmer across it.
// A tiny fake environment for wet surfaces: a dark vault with a few warm,
// torch-like hotspots, so moving normals shimmer instead of reading as flat.
let _wetEnv = null;
function wetEnv() {
  if (_wetEnv) return _wetEnv;
  const c = document.createElement('canvas');
  c.width = 256; c.height = 128;
  const g = c.getContext('2d');
  const bg = g.createLinearGradient(0, 0, 0, 128);
  bg.addColorStop(0, '#0c0d0e'); bg.addColorStop(0.5, '#1a1714'); bg.addColorStop(1, '#050505');
  g.fillStyle = bg; g.fillRect(0, 0, 256, 128);
  for (let i = 0; i < 9; i++) {
    const x = (i / 9) * 256 + 10, y = 50 + Math.sin(i * 2.3) * 10, r = 6 + (i % 3) * 3;
    const hg = g.createRadialGradient(x, y, 0, x, y, r * 3);
    hg.addColorStop(0, 'rgba(255,190,110,0.95)'); hg.addColorStop(0.3, 'rgba(200,110,40,0.45)'); hg.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = hg; g.fillRect(x - r * 3, y - r * 3, r * 6, r * 6);
  }
  const t = new THREE.CanvasTexture(c);
  t.mapping = THREE.EquirectangularReflectionMapping;
  t.colorSpace = THREE.SRGBColorSpace;
  _wetEnv = t;
  return t;
}

export function makeWaterMaterial(factory, tint = 0x0d1a12) {
  const t = factory.get('rock', 512, 7);
  const n2 = t.normalMap.clone();
  const mat = new THREE.MeshStandardMaterial({
    color: tint,
    roughness: 0.08,
    metalness: 0.2,
    // a faint sickly glow so channels read as water even away from torches
    emissive: 0x0b2416,
    emissiveIntensity: 0.6,
    normalMap: t.normalMap,
    normalScale: new THREE.Vector2(0.45, 0.45),
    envMap: wetEnv(),
    envMapIntensity: 0.9,
    transparent: true,
    opacity: 0.88,
    depthWrite: false,
  });
  mat.userData.update = (time) => {
    t.normalMap.offset.set(time * 0.012, time * 0.02);
  };
  void n2;
  return mat;
}

// Leaded stained glass window, emissive.
function makeStainedGlass() {
  return new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 } },
    vertexShader: `varying vec2 vUv; varying vec3 vP; void main(){ vUv = uv; vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.); }`,
    fragmentShader: `
      uniform float uTime; varying vec2 vUv; varying vec3 vP;
      vec2 h2(vec2 p){ p = vec2(dot(p, vec2(127.1,311.7)), dot(p, vec2(269.5,183.3))); return fract(sin(p)*43758.5453); }
      void main(){
        vec2 p = vP.xy * vec2(2.2, 1.6);
        vec2 i = floor(p), f = fract(p);
        float d1 = 9., d2 = 9.; vec2 id = vec2(0);
        for (int y=-1;y<=1;y++) for(int x=-1;x<=1;x++){
          vec2 g = vec2(x,y); vec2 o = h2(i+g); vec2 r = g + o - f; float d = dot(r,r);
          if (d < d1){ d2 = d1; d1 = d; id = i+g; } else if (d < d2) d2 = d;
        }
        float lead = smoothstep(0.02, 0.09, sqrt(d2) - sqrt(d1));
        vec3 pal[5];
        pal[0] = vec3(0.9,0.1,0.15); pal[1] = vec3(0.15,0.25,0.95); pal[2] = vec3(0.95,0.7,0.15); pal[3] = vec3(0.5,0.1,0.8); pal[4] = vec3(0.1,0.6,0.35);
        float k = h2(id).x * 5.;
        vec3 c = k < 1. ? pal[0] : k < 2. ? pal[1] : k < 3. ? pal[2] : k < 4. ? pal[3] : pal[4];
        float glow = 0.75 + 0.25 * sin(uTime * 0.7 + id.x * 1.3 + id.y);
        // radial rose highlight near the top
        float rose = smoothstep(1.3, 0., length(vP.xy - vec2(0., 2.3)));
        gl_FragColor = vec4(c * lead * (1.2 + rose * 2.5) * glow, 1.);
      }`,
  });
}

function radialAlphaTexture(inner = 0.0, outer = 1.0) {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  gr.addColorStop(0, 'rgba(255,255,255,1)');
  gr.addColorStop(inner, 'rgba(255,255,255,0.9)');
  gr.addColorStop(outer, 'rgba(255,255,255,0)');
  g.fillStyle = gr;
  g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  return t;
}

function splatTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = 'rgba(255,255,255,1)';
  for (let i = 0; i < 40; i++) {
    const a = Math.random() * Math.PI * 2, r = Math.random() * 80;
    g.globalAlpha = 0.25 + Math.random() * 0.5;
    g.beginPath();
    g.arc(128 + Math.cos(a) * r, 128 + Math.sin(a) * r, 8 + Math.random() * 40 * (1 - r / 100), 0, Math.PI * 2);
    g.fill();
  }
  return new THREE.CanvasTexture(c);
}

let shared = null;

// Biome-independent materials are cached across floors.
export function getSharedMaterials(factory) {
  if (shared) return shared;
  const S = (n, o) => makeSurfaceMaterial(factory, n, o);
  const m = {};
  m.wood = S('wood', { size: 1024 });
  m.iron = S('iron', { size: 512 });
  m.steel = S('iron', { size: 512, color: 0xb8bcc4, normalScale: 0.4 });
  m.steel.roughnessMap = null; m.steel.roughness = 0.32; m.steel.metalnessMap = null; m.steel.metalness = 1;
  m.gold = S('gold', { size: 512 });
  m.cloth = S('cloth', { size: 512, vertexColors: true });
  m.banner = S('cloth', { size: 512, vertexColors: true, side: THREE.DoubleSide });
  m.canvas = S('cloth', { size: 512, vertexColors: true });
  m.bone = S('bone', { size: 512 });
  m.leather = S('leather', { size: 512, vertexColors: true });
  m.rock = S('rock', { size: 512 });
  m.stone = S('castleWall', { size: 512, color: 0xa8a49c });
  m.roof = S('roof', { size: 512 });
  m.bark = S('wood', { size: 1024, color: 0x5a4a40, normalScale: 2 });
  m.leaves = S('grass', { size: 512, vertexColors: true });
  m.rope = S('cloth', { size: 512, color: 0x8a6a40 });
  m.dirtMat = S('dirt', { size: 512 });
  m.candle = new THREE.MeshStandardMaterial({ color: 0xe8dcc0, roughness: 0.6, emissive: 0x402a10, emissiveIntensity: 0.6 });
  m.charcoal = new THREE.MeshStandardMaterial({ color: 0x110a08, roughness: 1, emissive: 0xff4010, emissiveIntensity: 0.9 });
  m.glow = new THREE.MeshBasicMaterial({ vertexColors: true, color: new THREE.Color(2.5, 2.5, 2.5) });
  m.glass = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.1, emissive: 0xffffff, emissiveIntensity: 0.5, transparent: true, opacity: 0.85 });
  m.darkGlass = new THREE.MeshStandardMaterial({ color: 0x2a3036, roughness: 0.06, metalness: 0.2, transparent: true, opacity: 0.5, depthWrite: false });
  m.slime = new THREE.MeshStandardMaterial({ color: 0x2a4a10, roughness: 0.15, emissive: 0x0a2004, transparent: true, opacity: 0.75, side: THREE.DoubleSide });
  m.decalBlood = new THREE.MeshStandardMaterial({ color: 0x2a0204, roughness: 0.3, transparent: true, alphaMap: splatTexture(), depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
  m.puddle = new THREE.MeshStandardMaterial({ color: 0x050605, roughness: 0.04, metalness: 0.4, transparent: true, alphaMap: radialAlphaTexture(0.5, 1), depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
  m.decalDark = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, alphaMap: radialAlphaTexture(0.35, 1), depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
  m.waterFlat = makeWaterMaterial(factory, 0x0a1418);
  m.stainedGlass = makeStainedGlass();
  shared = m;
  return m;
}

export function getBiomeMaterials(factory, biome) {
  const S = (n, o) => makeSurfaceMaterial(factory, n, o);
  const m = { ...getSharedMaterials(factory) };
  m.wall = S(biome.wall, { vertexColors: true });
  m.floor = S(biome.floor, { vertexColors: true });
  m.floorAlt = S(biome.floorAlt, { vertexColors: true });
  m.ceiling = biome.ceilingMat ? S(biome.ceilingMat, { vertexColors: true, color: 0x8a8070 }) : null;
  m.trim = S(biome.trimMat === 'gold' ? 'castleWall' : biome.trimMat, { vertexColors: true, color: biome.trimTint ?? (biome.trimMat === 'gold' ? 0xd8d0c0 : 0xffffff) });
  m.water = makeWaterMaterial(factory, biome.id === 'sewers' ? 0x14200c : 0x0a1418);
  m.channelBed = S('dirt', { vertexColors: true, color: 0x606850 });
  return m;
}
