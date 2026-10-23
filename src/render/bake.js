import * as THREE from 'three';

// ---------------------------------------------------------------------------
// Shared full-screen-quad bakes for the procedural surfaces (realm walls and
// floors, creature skins, wizard cloth). A surface's GLSL surf() function is
// baked into three targets: albedo (sRGB), normal (from the height at three
// taps) and ORM. One program per surface draws all three (uMode picks the
// map), and its ShaderMaterial is kept for the session, so the program is
// compiled once and reused by every seed and size - a disposed material takes
// its program with it.
//
// Compile cost is what matters: drawing a 1024² bake takes a few ms of GPU.
// On Windows ANGLE hands shaders to the D3D compiler (FXC), which inlines
// every call: the old separate normal-map shader, with surf() written out
// three times, took 1.5-3 s to compile for one wall, and a surface's three
// programs ~2-4.5 s. bakeMain() calls surf() once, inside a loop FXC can't
// unroll (its bound is a uniform): 3-4x less compile work. It stays a single
// output - with three (MRT), ANGLE compiled each shader a second time,
// synchronously, on its first draw. warmBakes() compiles a list of them in
// parallel (KHR_parallel_shader_compile) without blocking the main thread; a
// bake whose program is ready only draws.
// ---------------------------------------------------------------------------

// main() for a bake shader: ns = normal strength, alpha = what ORM's alpha
// takes from the centre tap (read inside the loop, after its surf() call)
export function bakeMain(ns, alpha = '1.') {
  return /* glsl */ `
uniform int uMode; // 0 albedo, 1 normal, 2 ORM
void main(){
  float e = uTexel;
  vec3 col; float h, rough, metal, ao, hx, hy, oa;
  for (int k = 0; k < (uMode == 1 ? 3 : 1); k++){
    vec3 c; float hh, r, m, a;
    surf(fract(vUv + (k == 1 ? vec2(e, 0.) : k == 2 ? vec2(0., e) : vec2(0.))), c, hh, r, m, a);
    if (k == 0) { col = c; h = hh; rough = r; metal = m; ao = a; oa = ${alpha}; }
    else if (k == 1) hx = hh;
    else hy = hh;
  }
  if (uMode == 0) gl_FragColor = vec4(col, 1.);
  else if (uMode == 1) gl_FragColor = vec4(normalize(vec3((h - hx) * ${ns}, (h - hy) * ${ns}, e * 4.0)) * 0.5 + 0.5, 1.);
  else gl_FragColor = vec4(ao, rough, metal, oa);
}`;
}

const states = new WeakMap();

function state(renderer) {
  let s = states.get(renderer);
  if (!s) {
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2));
    quad.frustumCulled = false;
    const scene = new THREE.Scene();
    scene.add(quad);
    s = { scene, quad, camera: new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1), mats: new Map(), target: null };
    states.set(renderer, s);
  }
  return s;
}

function bakeMaterial(renderer, vert, frag) {
  const s = state(renderer);
  const key = vert + '\n//--\n' + frag;
  let m = s.mats.get(key);
  if (!m) {
    m = new THREE.ShaderMaterial({
      vertexShader: vert,
      fragmentShader: frag,
      uniforms: { uSeed: { value: 1 }, uTexel: { value: 1 / 512 }, uMode: { value: 0 } },
      depthTest: false,
      depthWrite: false,
    });
    s.mats.set(key, m);
  }
  return m;
}

const targetOpts = (mode) => ({
  minFilter: THREE.LinearMipmapLinearFilter,
  magFilter: THREE.LinearFilter,
  wrapS: THREE.RepeatWrapping,
  wrapT: THREE.RepeatWrapping,
  generateMipmaps: true,
  depthBuffer: false,
  colorSpace: mode === 0 ? THREE.SRGBColorSpace : THREE.NoColorSpace,
});

// draws the surface's three maps, binding each mode's target with bind(mode)
function draw(renderer, vert, frag, size, seed, bind) {
  const s = state(renderer);
  const mat = bakeMaterial(renderer, vert, frag);
  mat.uniforms.uSeed.value = seed;
  mat.uniforms.uTexel.value = 1 / size;
  s.quad.material = mat;
  const prev = renderer.getRenderTarget();
  for (let mode = 0; mode < 3; mode++) {
    mat.uniforms.uMode.value = mode;
    bind(mode);
    renderer.render(s.scene, s.camera);
  }
  renderer.setRenderTarget(prev);
}

// Bakes a surface into three new mipmapped, tiling render targets:
// [albedo (sRGB), normal, ORM]. A target's texture is freed with the target.
export function bake(renderer, vert, frag, { size, seed, anisotropy }) {
  const targets = [0, 1, 2].map((mode) => {
    const rt = new THREE.WebGLRenderTarget(size, size, targetOpts(mode));
    rt.texture.anisotropy = anisotropy ?? renderer.capabilities.getMaxAnisotropy();
    return rt;
  });
  draw(renderer, vert, frag, size, seed, (mode) => renderer.setRenderTarget(targets[mode]));
  return targets;
}

// Three array targets [albedo (sRGB), normal, ORM] of `layers` size² layers,
// for many surfaces sampled by one material (bakeLayer fills a layer).
export function arrayTargets(renderer, size, layers) {
  return [0, 1, 2].map((mode) => {
    const o = targetOpts(mode);
    const rt = new THREE.WebGLArrayRenderTarget(size, size, layers, o);
    // (set on the texture too: the array target makes its own)
    const t = rt.texture;
    t.minFilter = o.minFilter; t.magFilter = o.magFilter; t.wrapS = o.wrapS; t.wrapT = o.wrapT;
    t.generateMipmaps = true; t.colorSpace = o.colorSpace;
    t.anisotropy = renderer.capabilities.getMaxAnisotropy();
    return rt;
  });
}
export function bakeLayer(renderer, vert, frag, { size, seed }, targets, layer) {
  draw(renderer, vert, frag, size, seed, (mode) => renderer.setRenderTarget(targets[mode], layer));
}

// Compiles the bake shaders for [{ vert, frag }] in parallel, by default at
// most half the CPU's cores' worth at a time so the rest of the machine
// (music, other apps) keeps running smoothly while the game loads. three's program depends
// on whether a render target is bound (output colour space, tone mapping), so
// they compile against one, as the bakes render.
export async function warmBakes(renderer, list, { lanes = Math.max(2, Math.floor((navigator.hardwareConcurrency || 4) / 2)) } = {}) {
  const s = state(renderer);
  s.target ??= new THREE.WebGLRenderTarget(1, 1, { depthBuffer: false });
  const queue = [...list];
  const one = async ({ vert, frag }) => {
    const scene = new THREE.Scene();
    const q = new THREE.Mesh(s.quad.geometry, bakeMaterial(renderer, vert, frag));
    q.frustumCulled = false;
    scene.add(q);
    const prev = renderer.getRenderTarget();
    renderer.setRenderTarget(s.target);
    let ready;
    try {
      ready = renderer.compileAsync(scene, s.camera);
    } finally { renderer.setRenderTarget(prev); }
    // never hang a load on a driver that doesn't report back
    await Promise.race([ready, new Promise((res) => setTimeout(res, 20000))]);
  };
  const worker = async () => { while (queue.length) await one(queue.shift()); };
  await Promise.all(Array.from({ length: lanes }, worker));
}
