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
    uRes: { value: new THREE.Vector2(1, 1) },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uTime, uVignette, uGrain, uDamage, uHeal, uAberration, uSaturation, uDesat;
    uniform vec3 uLift, uGain, uTint, uFlash;
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
      col += vec3(0.1, 0.4, 0.15) * uHeal * edge;
      // film grain
      float g = hash(uv * uRes + fract(uTime * 13.37) * 100.0) - 0.5;
      col += g * uGrain * (0.35 + l);
      gl_FragColor = vec4(max(col, 0.0), 1.0);
    }
  `,
};

export class Renderer {
  constructor(canvas, quality = 'high') {
    this.quality = quality;
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: false,
      powerPreference: 'high-performance',
      stencil: false,
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, quality === 'low' ? 0.85 : quality === 'medium' ? 1 : quality === 'high' ? 1.25 : 1.5));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    // shadow maps are only used by the courtyard moon (outdoor realm)
    this.renderer.shadowMap.enabled = quality === 'high' || quality === 'ultra';
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
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

    this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), 0.65, 0.55, 0.82);
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
    if (g.bloom !== undefined) this.bloom.strength = g.bloom;
    if (g.bloomThreshold !== undefined) this.bloom.threshold = g.bloomThreshold;
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
    renderer.render(this.scene, this.camera);
    renderer.autoClear = oldAuto;
  }
  dispose() {}
}
