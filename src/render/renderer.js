import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';

// Final grading pass: grim color grade, vignette, film grain, chromatic
// aberration and a red damage vignette. Runs in linear HDR before tonemapping.
const GradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uVignette: { value: 0.62 },
    uGrain: { value: 0.045 },
    uDamage: { value: 0 },
    uHeal: { value: 0 },
    uAberration: { value: 0.0015 },
    uLift: { value: new THREE.Vector3(0.006, 0.008, 0.014) },
    uGain: { value: new THREE.Vector3(1.04, 0.99, 0.92) },
    uSaturation: { value: 0.86 },
    uDesat: { value: 0 },
    uTint: { value: new THREE.Vector3(1, 1, 1) },
    uFlash: { value: new THREE.Vector3(0, 0, 0) },
    uDash: { value: 0 },
    uDashCol: { value: new THREE.Vector3(1, 1, 1) },
    uRes: { value: new THREE.Vector2(1, 1) },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uTime, uVignette, uGrain, uDamage, uHeal, uAberration, uSaturation, uDesat, uDash;
    uniform vec3 uLift, uGain, uTint, uFlash, uDashCol;
    uniform vec2 uRes;
    varying vec2 vUv;
    float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    void main(){
      vec2 uv = vUv;
      vec2 dc = uv - 0.5;
      float r2 = dot(dc, dc);
      float ab = uAberration + uDamage * 0.006;
      vec3 col;
      col.r = texture2D(tDiffuse, uv - dc * ab * (1.0 + r2 * 4.0)).r;
      col.g = texture2D(tDiffuse, uv).g;
      col.b = texture2D(tDiffuse, uv + dc * ab * (1.0 + r2 * 4.0)).b;
      // dash: the edges of the view smear toward the centre and class-tinted
      // speed streaks race outward; the centre stays sharp so aim is kept
      float dashEdge = 0.0;
      if (uDash > 0.002) {
        dashEdge = smoothstep(0.12, 0.62, length(dc)) * uDash;
        vec3 acc = col;
        for (int i = 1; i <= 4; i++) acc += texture2D(tDiffuse, uv - dc * (float(i) * 0.035 * dashEdge)).rgb;
        col = mix(col, acc * 0.2, min(1.0, dashEdge * 1.4));
      }
      // lift / gain grade (warm highlights, cool shadows)
      col = col * uGain + uLift * (1.0 - clamp(col, 0.0, 1.0));
      float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
      col = mix(vec3(l), col, uSaturation * (1.0 - uDesat));
      col *= uTint;
      col += uFlash;
      // vignette
      float vig = smoothstep(0.85, 0.15, length(dc * vec2(uRes.x / uRes.y, 1.0)) * 0.95);
      col *= mix(1.0 - uVignette, 1.0, vig);
      // damage and heal edges
      float edge = smoothstep(0.25, 0.75, length(dc) * 1.4);
      col = mix(col, vec3(0.55, 0.0, 0.0) + col * 0.4, uDamage * edge * 0.85);
      // healing warms the screen edge green; a tint, not a wash over the view
      col = mix(col, col * vec3(0.9, 1.3, 0.95) + vec3(0.012, 0.055, 0.022), min(uHeal, 1.0) * edge * 0.85);
      if (dashEdge > 0.0) {
        float ang = atan(dc.y, dc.x);
        float lane = floor(ang * 64.0);
        float run = fract(length(dc) * 1.6 - uTime * 4.0 + hash(vec2(lane, 3.1)));
        float streak = step(0.9, hash(vec2(lane, 7.7))) * smoothstep(0.0, 0.5, run) * (1.0 - run) * smoothstep(0.3, 0.6, length(dc));
        col += uDashCol * streak * dashEdge * 0.28;
      }
      // film grain
      float g = hash(uv * uRes + fract(uTime * 13.37) * 100.0) - 0.5;
      col += g * uGrain * (0.35 + l);
      gl_FragColor = vec4(max(col, 0.0), 1.0);
    }
  `,
};

const BLOOM_THRESHOLD = 1.05;
const BLOOM_SCALE = 0.6;
// asymptotic cap for point lights lighting the first-person hands
const VIEW_LIGHT_MAX = 2.5;

export class Renderer {
  constructor(canvas, quality = 'high') {
    this.quality = quality;
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: false,
      powerPreference: 'high-performance',
      stencil: false,
    });
    this.maxRatio = Math.min(window.devicePixelRatio, quality === 'low' ? 0.85 : quality === 'medium' ? 1 : quality === 'high' ? 1.25 : 1.5);
    this.resScale = 1; // dynamic resolution (see setResScale)
    this.renderer.setPixelRatio(this.maxRatio);
    // synchronous shader error checks dominate warm-up; only pay for them in test runs
    this.renderer.debug.checkShaderErrors = new URLSearchParams(location.search).has('test');
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    // shadow maps are only used by the courtyard moon (outdoor realm)
    this.renderer.shadowMap.enabled = quality === 'high' || quality === 'ultra';
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.info.autoReset = true;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(78, window.innerWidth / window.innerHeight, 0.05, 220);
    this.baseFov = 78;

    // first person weapon layer rendered with its own camera so it never
    // clips into walls and can have its own field of view
    this.viewScene = new THREE.Scene();
    this.viewCamera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.01, 10);

    this._buildComposer();
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  _buildComposer() {
    const r = this.renderer;
    const size = r.getSize(new THREE.Vector2());
    const msaa = this.quality === 'high' || this.quality === 'ultra';
    const rt = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: msaa ? 4 : 0 });
    this.composer = new EffectComposer(r, rt);
    this.renderPass = new RenderPass(this.scene, this.camera);
    this.composer.addPass(this.renderPass);

    if (this.quality === 'ultra') {
      this.gtao = new GTAOPass(this.scene, this.camera, size.x, size.y);
      this.gtao.output = GTAOPass.OUTPUT.Default;
      this.gtao.blendIntensity = 0.85;
      this.gtao.updateGtaoMaterial({ radius: 0.6, distanceExponent: 1.5, thickness: 1.5, scale: 1.0 });
      this.composer.addPass(this.gtao);
    }

    // viewmodel layer: clear depth then render hands/staff on top
    this.viewPass = new ViewModelPass(this.viewScene, this.viewCamera);
    this.composer.addPass(this.viewPass);

    // Bloom only catches genuinely hot pixels (magic cores, flames): threshold
    // above 1.0 so lit stone, skin and pale enemies never glow, and a modest
    // strength so a burst of spells can't fog the whole frame white.
    this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), 0.45, 0.5, BLOOM_THRESHOLD);
    // A handful of non-finite or absurdly hot pixels (a degenerate sliver of
    // some effect edge-on to the lens) would otherwise be blurred across the
    // whole frame as a white-out. Bloom's input drops them / caps them at 16.
    const hp = this.bloom.materialHighPassFilter;
    hp.fragmentShader = hp.fragmentShader.replace('vec4 texel = texture2D( tDiffuse, vUv );', `vec4 texel = texture2D( tDiffuse, vUv );
			float hm = max( texel.r, max( texel.g, texel.b ) );
			if ( !( hm < 16.0 ) ) texel.rgb = hm < 1e30 ? texel.rgb * ( 16.0 / hm ) : vec3( 0.0 );`);
    this.composer.addPass(this.bloom);

    this.grade = new ShaderPass(GradeShader);
    this.composer.addPass(this.grade);
    this.composer.addPass(new OutputPass());
    if (this.quality === 'medium') {
      this.smaa = new SMAAPass(size.x, size.y);
      this.composer.addPass(this.smaa);
    }
  }

  setGrade(g) {
    const u = this.grade.uniforms;
    if (g.lift) u.uLift.value.set(...g.lift);
    if (g.gain) u.uGain.value.set(...g.gain);
    if (g.saturation !== undefined) u.uSaturation.value = g.saturation;
    if (g.vignette !== undefined) u.uVignette.value = g.vignette;
    if (g.exposure !== undefined) this.renderer.toneMappingExposure = g.exposure;
    // biome grades author bloom around 0.6-0.85 for the old, softer setup;
    // scale into the readable range (~0.36-0.5) rather than editing biomes
    if (g.bloom !== undefined) this.bloom.strength = g.bloom * BLOOM_SCALE;
    this.bloom.threshold = Math.max(BLOOM_THRESHOLD, g.bloomThreshold ?? 0);
  }

  // Dynamic resolution: render fewer pixels when the GPU can't keep up, so a
  // weaker GPU gets a slightly softer image instead of a stuttering one.
  setResScale(k) {
    k = Math.max(0.5, Math.min(1, k));
    if (Math.abs(k - this.resScale) < 0.01) return;
    this.resScale = k;
    this.renderer.setPixelRatio(this.maxRatio * k);
    this.resize();
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.viewCamera.aspect = w / h;
    this.viewCamera.updateProjectionMatrix();
    const pr = this.renderer.getPixelRatio();
    this.composer.setPixelRatio(pr);
    this.composer.setSize(w, h);
    this.grade.uniforms.uRes.value.set(w * pr, h * pr);
  }

  // Compile every material in both scenes exactly as a real frame would: into
  // the composer's HDR target (linear output, tone mapping left to the output
  // pass). Compiling against the canvas gives different program keys (sRGB +
  // ACES baked in), so every "prewarmed" shader was compiled again mid-fight.
  //
  // With upload, it then draws one frame of everything with culling off:
  // compile() doesn't upload geometry or textures, and three.js only does that
  // the first time an object is actually drawn - so a room's walls, props and
  // textures used to upload the moment you first looked into it.
  //
  // Compiling uses KHR_parallel_shader_compile where the browser has it: the
  // driver builds every program at once on its own threads while the page
  // stays responsive (behind the loading veil), and the promise resolves once
  // they're all ready. Without the extension it still works, just serially.
  async compileScenes({ upload = false, timeout = 20000 } = {}) {
    const r = this.renderer;
    const prev = r.getRenderTarget();
    r.setRenderTarget(this.composer.readBuffer);
    let ready = null;
    try {
      if (r.extensions.has('KHR_parallel_shader_compile')) ready = Promise.all([r.compileAsync(this.scene, this.camera), r.compileAsync(this.viewScene, this.viewCamera)]);
      else { r.compile(this.scene, this.camera); r.compile(this.viewScene, this.viewCamera); }
    } finally { r.setRenderTarget(prev); }
    // never hang a load on a driver that doesn't report back
    if (ready) await Promise.race([ready, new Promise((res) => setTimeout(res, timeout))]);
    if (!upload) return;
    r.setRenderTarget(this.composer.readBuffer);
    const culled = [];
    try {
      this.scene.traverse((o) => { if (o.frustumCulled && (o.isMesh || o.isPoints || o.isSprite || o.isLine)) { o.frustumCulled = false; culled.push(o); } });
      const auto = r.autoClear;
      r.autoClear = true;
      r.render(this.scene, this.camera);
      r.autoClear = auto;
    } finally {
      for (const o of culled) o.frustumCulled = true;
      r.setRenderTarget(prev);
    }
  }

  render(time) {
    this.grade.uniforms.uTime.value = time;
    const info = this.renderer.info;
    info.autoReset = false;
    info.reset();
    this.composer.render();
    this.lastStats = { calls: info.render.calls, tris: info.render.triangles, geos: info.memory.geometries, tex: info.memory.textures, programs: info.programs?.length };
  }
}

// Renders a second scene on top of the main one after clearing depth.
class ViewModelPass {
  constructor(scene, camera) {
    this.scene = scene;
    this.camera = camera;
    this.enabled = true;
    this.needsSwap = false;
    this.clear = false;
    this.renderToScreen = false;
  }
  setSize() {}
  render(renderer, writeBuffer, readBuffer) {
    const oldAuto = renderer.autoClear;
    renderer.autoClear = false;
    renderer.setRenderTarget(this.renderToScreen ? null : readBuffer);
    renderer.clearDepth();
    // The hands sit centimetres from the point lights mirrored into this
    // scene (spell flashes, torches), which used to blow the focus and
    // sleeves out to white. Soft-clamp their intensity for this pass only.
    const L = this._lights ?? (this._lights = []);
    const kids = this.scene.children, seen = this._kids ?? (this._kids = []);
    let same = seen.length === kids.length;
    for (let i = 0; same && i < kids.length; i++) same = seen[i] === kids[i];
    if (!same) {
      seen.length = 0;
      for (let i = 0; i < kids.length; i++) seen.push(kids[i]);
      L.length = 0;
      this.scene.traverse((o) => { if (o.isPointLight) L.push(o); });
    }
    const saved = this._saved ?? (this._saved = []);
    for (let i = 0; i < L.length; i++) {
      const I = L[i].intensity;
      saved[i] = I;
      L[i].intensity = I * VIEW_LIGHT_MAX / (VIEW_LIGHT_MAX + I);
    }
    renderer.render(this.scene, this.camera);
    for (let i = 0; i < L.length; i++) L[i].intensity = saved[i];
    renderer.autoClear = oldAuto;
  }
  dispose() {}
}
