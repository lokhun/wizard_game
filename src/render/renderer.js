import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';

// Final grading: grim color grade, vignette, film grain, chromatic aberration
// and a red damage vignette, in linear HDR. SCENE(uv) is the HDR frame
// (SHARP(uv) + BLOOM(uv)); FINISH runs after the grade (tone mapping and sRGB
// in the fused pass).
const GRADE_MAIN = /* glsl */ `
    uniform float uTime, uVignette, uGrain, uDamage, uHeal, uAberration, uSaturation, uDesat, uDash, uDanger;
    uniform vec3 uLift, uGain, uTint, uFlash, uDashCol, uDangerCol;
    uniform vec2 uRes;
    varying vec2 vUv;
    float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    void main(){
      vec2 uv = vUv;
      vec2 dc = uv - 0.5;
      float r2 = dot(dc, dc);
      float ab = uAberration + uDamage * 0.006;
      vec3 col;
      // (the split is of the sharp frame only: bloom is a soft blur, fetched once)
      col.r = SHARP(uv - dc * ab * (1.0 + r2 * 4.0)).r;
      col.g = SHARP(uv).g;
      col.b = SHARP(uv + dc * ab * (1.0 + r2 * 4.0)).b;
      col += BLOOM(uv);
      // dash: the edges of the view smear toward the centre and class-tinted
      // speed streaks race outward; the centre stays sharp so aim is kept
      float dashEdge = 0.0;
      if (uDash > 0.002) {
        dashEdge = smoothstep(0.12, 0.62, length(dc)) * uDash;
        vec3 acc = col;
        for (int i = 1; i <= 4; i++) acc += SCENE(uv - dc * (float(i) * 0.035 * dashEdge));
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
      // damage and heal edges: a frame around the view, never a wash over it (taking a beating is
      // exactly when the next telegraph must stay readable: the middle of the screen keeps clear)
      float edge = smoothstep(0.44, 0.96, length(dc) * 1.4);
      col = mix(col, vec3(0.55, 0.0, 0.0) + col * 0.4, uDamage * edge * 0.8);
      // healing warms the screen edge green; a tint, not a wash over the view
      col = mix(col, col * vec3(0.9, 1.3, 0.95) + vec3(0.012, 0.055, 0.022), min(uHeal, 1.0) * edge * 0.85);
      // standing in a danger zone about to land: a thin rim of its colour at the edges of the view
      if (uDanger > 0.002) col += uDangerCol * smoothstep(0.56, 0.98, length(dc) * 1.4) * uDanger * 0.8;
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
      FINISH
    }
`;

// as a composer pass (Ultra, where GTAO sits in the chain)
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
    uDanger: { value: 0 },
    uDangerCol: { value: new THREE.Vector3(1, 0.2, 0.1) },
    uRes: { value: new THREE.Vector2(1, 1) },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    #define SHARP(uv) texture2D(tDiffuse, uv).rgb
    #define BLOOM(uv) vec3(0.0)
    #define SCENE(uv) texture2D(tDiffuse, uv).rgb
    #define FINISH
    ${GRADE_MAIN}
  `,
};

// The fused final pass: bloom added (as UnrealBloomPass blends it: plain rgb,
// its blend is premultiplied ONE/ONE),
// the grade, then exactly OutputPass's ACES tone mapping and sRGB encoding.
const FINAL_VERT = /* glsl */ `
  precision highp float;
  uniform mat4 modelViewMatrix;
  uniform mat4 projectionMatrix;
  attribute vec3 position;
  attribute vec2 uv;
  varying vec2 vUv;
  void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`;
const FINAL_FRAG = /* glsl */ `
  precision highp float;
  uniform sampler2D tDiffuse;
  uniform sampler2D tBloom;
  #include <tonemapping_pars_fragment>
  #include <colorspace_pars_fragment>
  vec3 bloomAt(vec2 uv){ return texture2D(tBloom, uv).rgb; }
  #define SHARP(uv) texture2D(tDiffuse, uv).rgb
  #define BLOOM(uv) bloomAt(uv)
  #define SCENE(uv) (texture2D(tDiffuse, uv).rgb + bloomAt(uv))
  #define FINISH gl_FragColor.rgb = ACESFilmicToneMapping(gl_FragColor.rgb); gl_FragColor = sRGBTransferOETF(gl_FragColor);
  ${GRADE_MAIN}
`;

// Point lights past their range add exactly nothing (the attenuation window
// reaches zero at light.distance, and idle pool lights sit at intensity 0),
// yet three.js runs the full BRDF for every light of the pool at every lit
// pixel. Branch around it: same image, and most pixels only pay for the two
// or three lights that actually reach them.
THREE.ShaderChunk.lights_fragment_begin = THREE.ShaderChunk.lights_fragment_begin.replace(
  /(getPointLightInfo\( pointLight, geometryPosition, directLight \);[\s\S]*?)(RE_Direct\( directLight,[^;]*;)/,
  '$1if ( directLight.visible ) $2');

// three.js draws a transparent double-sided material twice (back faces, then
// front faces), flagging the material for a program re-check before each
// half. With additive blending and no depth writes the two halves commute, so
// one pass gives the same pixels for half the draw calls; flames, beams,
// slashes and glows are all of this kind. (An explicit forceSinglePass still wins.)
//
// The other transparent double-sided materials (robes, ghosts, slime) still
// draw in two halves, back faces first, but three.js does it by flipping
// material.side and flagging the material before each half: two full program
// lookups (parameters and cache key) per draw, every frame - the biggest single
// cost of rendering a crowd of robed casters. Renderer.twoPass draws the same
// two halves with the double-sided program and the face culling set per half:
// the same pixels, since that program turns back-face normals around just as
// the back-side one does.
const additiveOnePass = (m) => m.blending === THREE.AdditiveBlending && !m.depthWrite;
const twoPass = (m) => m.transparent && m.side === THREE.DoubleSide && !m._forceSinglePass && !additiveOnePass(m);
Object.defineProperty(THREE.Material.prototype, 'forceSinglePass', {
  configurable: true,
  get() { return this._forceSinglePass || additiveOnePass(this) || (this.transparent && this.side === THREE.DoubleSide); },
  set(v) { this._forceSinglePass = v; },
});

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
    // Depth-only twins (an enemy's opaque parts merged, see Rig.finish) are
    // hidden from every pass but the shadow map's
    this.shadowOnly = new Set();
    const sm = this.renderer.shadowMap, smRender = sm.render.bind(sm);
    sm.render = (...a) => {
      for (const o of this.shadowOnly) o.visible = true;
      try { smRender(...a); } finally { for (const o of this.shadowOnly) o.visible = false; }
    };
    this.renderer.info.autoReset = true;
    // Opaque draws grouped by shader program, then material, then front to
    // back (three.js groups by material only). Every program switch re-sends
    // the camera and the whole light pool, and a crowd of enemies, each with
    // its own materials, used to switch program on nearly every draw.
    const props = this.renderer.properties;
    const prog = (m) => props.get(m).currentProgram?.id ?? 0;
    this._twoPassDraws();
    this._oneResolve();
    this.renderer.setOpaqueSort((a, b) => a.groupOrder - b.groupOrder || a.renderOrder - b.renderOrder || prog(a.material) - prog(b.material)
      || a.material.id - b.material.id || a.materialVariant - b.materialVariant || a.z - b.z || a.id - b.id);

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
    // the post chain's programs never change: compile them now, on the
    // driver's threads, instead of on the first frame (boot waits for it)
    this.postReady = this._warmPost();
  }

  // Low / Medium / High: one fused chain instead of the composer's ping-pong.
  // The scene and viewmodel render into the HDR target (4x MSAA on High),
  // bloom builds its blur mips from it, and one final pass adds the bloom,
  // grades, tone maps and writes sRGB to the canvas (to SMAA's input on
  // Medium). The composer spent four more full-screen passes on the same
  // result - bloom blended back into the frame, grade and output each through
  // their own target, on High every one of them 4x multisampled and resolved.
  // Ultra keeps the composer, since GTAO sits mid-chain.
  _buildComposer() {
    const r = this.renderer;
    const size = r.getSize(new THREE.Vector2());
    const msaa = this.quality === 'high' || this.quality === 'ultra';
    const fused = this.quality !== 'ultra';
    this.fused = fused;
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
    // viewmodel layer: clear depth then render hands/staff on top
    this.viewPass = new ViewModelPass(this.viewScene, this.viewCamera);
    if (fused) {
      this.sceneRT = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: msaa ? 4 : 0 });
      this.finalMat = new THREE.RawShaderMaterial({
        name: 'FinalShader',
        uniforms: { ...THREE.UniformsUtils.clone(GradeShader.uniforms), tBloom: { value: null }, toneMappingExposure: { value: 1 } },
        defines: { ACES_FILMIC_TONE_MAPPING: '', SRGB_TRANSFER: '' },
        vertexShader: FINAL_VERT, fragmentShader: FINAL_FRAG,
        depthTest: false, depthWrite: false,
      });
      this.finalQuad = new FullScreenQuad(this.finalMat);
      this.grade = { uniforms: this.finalMat.uniforms };
      // SMAA (Medium only) is 46 KB of embedded lookup textures: fetched on
      // demand, the frame goes straight to the canvas until it arrives
      if (this.quality === 'medium') {
        // (and switched on once its three programs are compiled in parallel)
        import('three/addons/postprocessing/SMAAPass.js').then(async ({ SMAAPass }) => {
          const ldr = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, depthBuffer: false });
          const smaa = new SMAAPass();
          smaa.renderToScreen = true;
          await this._compileQuads([[ldr, [smaa._materialEdges, smaa._materialWeights]], [null, [smaa._materialBlend]]]);
          this.ldrRT = ldr;
          this.smaa = smaa;
          this.resize();
        }).catch((e) => console.warn('SMAA unavailable', e));
      }
      return;
    }
    const rt = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: msaa ? 4 : 0 });
    this.composer = new EffectComposer(r, rt);
    this.renderPass = new RenderPass(this.scene, this.camera);
    this.composer.addPass(this.renderPass);
    this.gtao = new GTAOPass(this.scene, this.camera, size.x, size.y);
    this.gtao.output = GTAOPass.OUTPUT.Default;
    this.gtao.blendIntensity = 0.85;
    this.gtao.updateGtaoMaterial({ radius: 0.6, distanceExponent: 1.5, thickness: 1.5, scale: 1.0 });
    this.composer.addPass(this.gtao);
    this.composer.addPass(this.viewPass);
    this.composer.addPass(this.bloom);
    this.grade = new ShaderPass(GradeShader);
    this.composer.addPass(this.grade);
    this.composer.addPass(new OutputPass());
  }

  // (see twoPass above) back faces, then front faces, of one draw
  _twoPassDraws() {
    const r = this.renderer, state = r.state, gl = r.getContext();
    let half = 0;
    const setMaterial = state.setMaterial.bind(state);
    state.setMaterial = (material, frontFaceCW) => {
      setMaterial(material, frontFaceCW);
      if (half) { state.enable(gl.CULL_FACE); state.setCullFace(half === 1 ? THREE.CullFaceFront : THREE.CullFaceBack); }
    };
    const rbd = r.renderBufferDirect.bind(r);
    r.renderBufferDirect = (camera, scene, geometry, material, object, group) => {
      if (!twoPass(material)) return rbd(camera, scene, geometry, material, object, group);
      try {
        half = 1; rbd(camera, scene, geometry, material, object, group);
        half = 2; rbd(camera, scene, geometry, material, object, group);
      } finally { half = 0; state.setCullFace(THREE.CullFaceBack); }
    };
  }

  // On High the HDR target is multisampled, and three.js resolves it at the end
  // of every render call: the scene's resolve (a full-screen read of all four
  // samples and a write, in half float) was thrown away when the hands' render
  // resolved the same target again. Worse, a resolve also tells the driver it
  // may discard the multisampled colour, which the hands then drew over. While
  // skipResolve is set the scene's resolve (blit and discard) is left out.
  _oneResolve() {
    const gl = this.renderer.getContext();
    const blit = gl.blitFramebuffer.bind(gl), invalidate = gl.invalidateFramebuffer.bind(gl);
    this.skipResolve = false;
    gl.blitFramebuffer = (...a) => { if (!this.skipResolve) blit(...a); };
    gl.invalidateFramebuffer = (...a) => { if (!this.skipResolve) invalidate(...a); };
  }

  // "Reduce flashing" (settings): bloom at a bit over half strength
  setCalm(b) { this.calm = !!b; if (this._grade) this.setGrade(this._grade); }

  // the HDR target the scene renders into (what shaders must be compiled against)
  get hdrTarget() { return this.fused ? this.sceneRT : this.composer.readBuffer; }

  setGrade(g) {
    this._grade = g;
    const u = this.grade.uniforms;
    if (g.lift) u.uLift.value.set(...g.lift);
    if (g.gain) u.uGain.value.set(...g.gain);
    if (g.saturation !== undefined) u.uSaturation.value = g.saturation;
    if (g.vignette !== undefined) u.uVignette.value = g.vignette;
    if (g.exposure !== undefined) this.renderer.toneMappingExposure = g.exposure;
    // biome grades author bloom around 0.6-0.85 for the old, softer setup;
    // scale into the readable range (~0.36-0.5) rather than editing biomes
    if (g.bloom !== undefined) this.bloom.strength = g.bloom * BLOOM_SCALE * (this.calm ? 0.55 : 1);
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
    if (this.fused) {
      // the sizes the composer gave its targets and passes
      const W = w * pr, H = h * pr;
      this.sceneRT.setSize(W, H);
      this.bloom.setSize(W, H);
      this.ldrRT?.setSize(W, H);
      this.smaa?.setSize(W, H);
    } else {
      this.composer.setPixelRatio(pr);
      this.composer.setSize(w, h);
    }
    this.grade.uniforms.uRes.value.set(w * pr, h * pr);
  }

  // Compile every material in both scenes exactly as a real frame would: into
  // the HDR target (linear output, tone mapping left to the final pass). Compiling against the canvas gives different program keys (sRGB +
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
  async compileScenes({ upload = false, all = upload, timeout = 20000 } = {}) {
    const r = this.renderer;
    const prev = r.getRenderTarget();
    r.setRenderTarget(this.hdrTarget);
    let ready = null;
    try {
      if (r.extensions.has('KHR_parallel_shader_compile')) ready = Promise.all([r.compileAsync(this.scene, this.camera), r.compileAsync(this.viewScene, this.viewCamera)]);
      else { r.compile(this.scene, this.camera); r.compile(this.viewScene, this.viewCamera); }
    } finally { r.setRenderTarget(prev); }
    // never hang a load on a driver that doesn't report back
    if (ready) await Promise.race([ready, new Promise((res) => setTimeout(res, timeout))]);
    if (!upload) return;
    r.setRenderTarget(this.hdrTarget);
    const culled = [], flipped = [];
    // With all, hidden things (pooled effects, the hands' cast glows, enemy
    // parts and set pieces that only show later) and the first-person hands
    // are drawn too. A compiled program still costs on its first draw: three
    // looks up its uniforms (a wait on the driver), ANGLE builds the D3D
    // shader for the actual vertex layout (skinned meshes: ~50 ms each, on the
    // GPU process's main thread) and the shadow pass picks its depth variant.
    // Lights keep their state - one switched on would change every program.
    // The target is cleared by the next frame, so none of this is ever seen.
    const show = (o, on) => {
      if (o.isLight) { if (!on && o.visible) { o.visible = false; flipped.push(o); } return; }
      if (o.userData.shadowProxy) return; // (only ever drawn by the shadow pass)
      if (all && !o.visible) { o.visible = true; flipped.push(o); on = false; }
      if (o.frustumCulled && (o.isMesh || o.isPoints || o.isSprite || o.isLine)) { o.frustumCulled = false; culled.push(o); }
      for (const c of o.children) show(c, on);
    };
    try {
      show(this.scene, true);
      if (all) show(this.viewScene, true);
      const auto = r.autoClear;
      r.autoClear = true;
      r.render(this.scene, this.camera);
      r.autoClear = auto;
      // the hands over it, as a frame draws them
      if (all) this.viewPass.render(r, null, this.hdrTarget);
    } finally {
      for (const o of culled) o.frustumCulled = true;
      for (const o of flipped) o.visible = !o.visible;
      r.setRenderTarget(prev);
    }
  }

  // Bloom's bright pass, blurs and composite and the final grade pass, which
  // otherwise all linked synchronously in the first menu frame (0.1-0.5 s on
  // ANGLE/D3D11).
  _warmPost() {
    if (!this.fused) return Promise.resolve();
    const b = this.bloom;
    return this._compileQuads([[b.renderTargetBright, [b.materialHighPassFilter, ...b.separableBlurMaterials, b.compositeMaterial]], [null, [this.finalMat]]]);
  }

  // Compile full-screen pass materials on the driver's threads, each group
  // against the kind of target it draws into ([target, materials]: a canvas
  // pass gets tone mapping and sRGB in its program, a render target doesn't).
  async _compileQuads(groups) {
    const r = this.renderer, geo = new THREE.BufferGeometry();
    // FullScreenQuad's own triangle: position and uv only (normals would be another program)
    geo.setAttribute('position', new THREE.Float32BufferAttribute([-1, 3, 0, -1, -1, 0, 3, -1, 0], 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute([0, 2, 0, 0, 2, 0], 2));
    const prev = r.getRenderTarget();
    const jobs = [];
    try {
      for (const [target, mats] of groups) {
        const s = new THREE.Scene();
        for (const m of mats) if (m) s.add(new THREE.Mesh(geo, m));
        r.setRenderTarget(target);
        if (r.extensions.has('KHR_parallel_shader_compile')) jobs.push(r.compileAsync(s, this.camera));
        else r.compile(s, this.camera);
      }
    } catch (e) { console.warn('pass warm-up failed', e); } finally { r.setRenderTarget(prev); }
    await Promise.race([Promise.all(jobs), new Promise((res) => setTimeout(res, 20000))]);
    geo.dispose();
  }

  // Compile one object's materials (not yet in the scene) against the scene's
  // lights and the HDR target, on the driver's threads where it can: the
  // promise resolves once its programs are ready to draw without stalling.
  // With all, its hidden parts too (cast glows and the like).
  async compileObject(obj, scene = this.scene, { timeout = 20000, all = false } = {}) {
    const r = this.renderer;
    const prev = r.getRenderTarget();
    r.setRenderTarget(this.hdrTarget);
    let ready = null;
    const flipped = [];
    if (all) obj.traverse((o) => { if (!o.visible && !o.isLight && !o.userData.shadowProxy) { o.visible = true; flipped.push(o); } });
    try {
      if (r.extensions.has('KHR_parallel_shader_compile')) ready = r.compileAsync(obj, this.camera, scene);
      else r.compile(obj, this.camera, scene);
    } finally {
      for (const o of flipped) o.visible = false;
      r.setRenderTarget(prev);
    }
    if (ready) await Promise.race([ready, new Promise((res) => setTimeout(res, timeout))]);
  }

  render(time) {
    this.grade.uniforms.uTime.value = time;
    // The scene's matrix pass (three runs it for every object, seen or not) was mostly spent on hidden
    // pool members: ~280 of a floor's ~300 top-level objects are idle decals, rings, beams and sprites
    // waiting to be used. A hidden leaf skips it; the frame it is shown, this same pass brings it up to date.
    // (Leaves only: a hidden group's bones can still be read, e.g. a head for a weak point.)
    const ch = this.scene.children;
    for (let i = 0; i < ch.length; i++) { const c = ch[i]; if (c.children.length === 0) c.matrixWorldAutoUpdate = c.visible; }
    const info = this.renderer.info;
    info.autoReset = false;
    info.reset();
    if (this.fused) this._renderFused();
    else this.composer.render();
    this.lastStats = { calls: info.render.calls, tris: info.render.triangles, geos: info.memory.geometries, tex: info.memory.textures, programs: info.programs?.length };
  }

  _renderFused() {
    const r = this.renderer, rt = this.sceneRT;
    // (the scene's colour background clears the target; the hands' render resolves it)
    r.setRenderTarget(rt);
    this.skipResolve = rt.samples > 0;
    try { r.render(this.scene, this.camera); } finally { this.skipResolve = false; }
    this.viewPass.render(r, null, rt);
    this.bloomMips(rt);
    const u = this.finalMat.uniforms;
    u.tDiffuse.value = rt.texture;
    u.tBloom.value = this.bloom.renderTargetsHorizontal[0].texture;
    u.toneMappingExposure.value = r.toneMappingExposure;
    r.setRenderTarget(this.smaa ? this.ldrRT : null);
    this.finalQuad.render(r);
    if (this.smaa) this.smaa.render(r, null, this.ldrRT);
  }

  bloomMips(input) { bloomMips(this.bloom, this.renderer, input); }
}

// UnrealBloomPass.render up to its composite (bright pass, blurred mips,
// mixed into renderTargetsHorizontal[0]), without blending the result back
// over the input: the final pass adds it while grading.
function bloomMips(b, r, input) {
  r.getClearColor(b._oldClearColor);
  b._oldClearAlpha = r.getClearAlpha();
  const oldAutoClear = r.autoClear;
  r.autoClear = false;
  r.setClearColor(b.clearColor, 0);
  const q = b._fsQuad;
  b.highPassUniforms.tDiffuse.value = input.texture;
  b.highPassUniforms.luminosityThreshold.value = b.threshold;
  q.material = b.materialHighPassFilter;
  r.setRenderTarget(b.renderTargetBright);
  r.clear();
  q.render(r);
  let src = b.renderTargetBright;
  for (let i = 0; i < b.nMips; i++) {
    const m = b.separableBlurMaterials[i];
    q.material = m;
    m.uniforms.colorTexture.value = src.texture;
    m.uniforms.direction.value = UnrealBloomPass.BlurDirectionX;
    r.setRenderTarget(b.renderTargetsHorizontal[i]);
    r.clear();
    q.render(r);
    m.uniforms.colorTexture.value = b.renderTargetsHorizontal[i].texture;
    m.uniforms.direction.value = UnrealBloomPass.BlurDirectionY;
    r.setRenderTarget(b.renderTargetsVertical[i]);
    r.clear();
    q.render(r);
    src = b.renderTargetsVertical[i];
  }
  q.material = b.compositeMaterial;
  b.compositeMaterial.uniforms.bloomStrength.value = b.strength;
  b.compositeMaterial.uniforms.bloomRadius.value = b.radius;
  b.compositeMaterial.uniforms.bloomTintColors.value = b.bloomTintColors;
  r.setRenderTarget(b.renderTargetsHorizontal[0]);
  r.clear();
  q.render(r);
  r.setClearColor(b._oldClearColor, b._oldClearAlpha);
  r.autoClear = oldAutoClear;
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
