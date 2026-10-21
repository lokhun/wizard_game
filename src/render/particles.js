import * as THREE from 'three';

// ---------------------------------------------------------------------------
// GPU particle system. Particles are instanced camera-facing quads whose
// motion is evaluated entirely in the vertex shader from their spawn state
// (position, velocity, gravity, drag). The CPU only writes new particles into
// a ring buffer, so tens of thousands of sparks cost almost nothing.
// ---------------------------------------------------------------------------

export const SPR = {
  GLOW: 0, SPARK: 1, SMOKE: 2, FLAME: 3, STAR: 4, RING: 5, RUNE: 6, SHARD: 7,
  EMBER: 8, SNOW: 9, WISP: 10, BUBBLE: 11, BOLT: 12, FEATHER: 13, CHUNK: 14, DROP: 15,
};

function makeAtlas() {
  const N = 4, S = 128;
  const c = document.createElement('canvas');
  c.width = c.height = N * S;
  const g = c.getContext('2d');
  const cell = (i) => [(i % N) * S, Math.floor(i / N) * S];
  const radial = (x, y, r, stops) => {
    const gr = g.createRadialGradient(x, y, 0, x, y, r);
    for (const [o, col] of stops) gr.addColorStop(o, col);
    return gr;
  };
  // simple value noise for smoke
  const noise = (() => {
    const p = [];
    for (let i = 0; i < 256; i++) p.push(Math.random());
    const at = (x, y) => p[((x & 15) + (y & 15) * 16) & 255];
    return (x, y) => {
      const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
      const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
      const a = at(xi, yi), b = at(xi + 1, yi), cc = at(xi, yi + 1), d = at(xi + 1, yi + 1);
      return a + (b - a) * u + (cc - a) * v + (a - b - cc + d) * u * v;
    };
  })();

  let [x, y] = cell(SPR.GLOW);
  g.fillStyle = radial(x + 64, y + 64, 64, [[0, 'rgba(255,255,255,1)'], [0.25, 'rgba(255,255,255,0.55)'], [0.6, 'rgba(255,255,255,0.12)'], [1, 'rgba(255,255,255,0)']]);
  g.fillRect(x, y, S, S);

  [x, y] = cell(SPR.SPARK);
  g.fillStyle = radial(x + 64, y + 64, 64, [[0, 'rgba(255,255,255,1)'], [0.12, 'rgba(255,255,255,1)'], [0.3, 'rgba(255,255,255,0.3)'], [1, 'rgba(255,255,255,0)']]);
  g.fillRect(x, y, S, S);

  // smoke: noisy soft blob
  [x, y] = cell(SPR.SMOKE);
  {
    const img = g.createImageData(S, S);
    for (let j = 0; j < S; j++) for (let i = 0; i < S; i++) {
      const dx = (i - 64) / 64, dy = (j - 64) / 64;
      const d = Math.sqrt(dx * dx + dy * dy);
      let n = 0, a = 0.5, f = 4;
      for (let o = 0; o < 4; o++) { n += a * noise(i / S * f, j / S * f); a *= 0.5; f *= 2; }
      const alpha = Math.max(0, 1 - d * (1.1 + (n - 0.5) * 1.2));
      const k = (j * S + i) * 4;
      const v = 200 + n * 55;
      img.data[k] = v; img.data[k + 1] = v; img.data[k + 2] = v;
      img.data[k + 3] = Math.min(255, alpha * alpha * 255 * (0.6 + n * 0.8));
    }
    g.putImageData(img, x, y);
  }

  // flame tongue
  [x, y] = cell(SPR.FLAME);
  {
    const img = g.createImageData(S, S);
    for (let j = 0; j < S; j++) for (let i = 0; i < S; i++) {
      const dx = (i - 64) / 64, dy = (j - 80) / 64;
      const w = 0.55 * Math.max(0, 1 - Math.max(0, -dy) * 0.9);
      let n = noise(i / 16, j / 12) * 0.5 + noise(i / 8, j / 6) * 0.25;
      const d = Math.abs(dx) / Math.max(0.05, w) + Math.max(0, dy) * 1.6;
      const alpha = Math.max(0, 1 - d - (n - 0.4) * 0.6);
      const k = (j * S + i) * 4;
      img.data[k] = 255; img.data[k + 1] = 255; img.data[k + 2] = 255;
      img.data[k + 3] = Math.min(255, alpha * 255);
    }
    g.putImageData(img, x, y);
  }

  // 4-point star
  [x, y] = cell(SPR.STAR);
  g.save();
  g.translate(x + 64, y + 64);
  g.fillStyle = radial(0, 0, 20, [[0, 'rgba(255,255,255,1)'], [1, 'rgba(255,255,255,0)']]);
  g.fillRect(-64, -64, 128, 128);
  for (let r = 0; r < 2; r++) {
    g.rotate(Math.PI / 2 * r);
    const lg = g.createLinearGradient(-64, 0, 64, 0);
    lg.addColorStop(0, 'rgba(255,255,255,0)');
    lg.addColorStop(0.5, 'rgba(255,255,255,1)');
    lg.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = lg;
    g.beginPath(); g.moveTo(-64, 0); g.lineTo(0, -4); g.lineTo(64, 0); g.lineTo(0, 4); g.fill();
  }
  g.restore();

  // ring
  [x, y] = cell(SPR.RING);
  g.fillStyle = radial(x + 64, y + 64, 62, [[0, 'rgba(255,255,255,0)'], [0.7, 'rgba(255,255,255,0)'], [0.86, 'rgba(255,255,255,1)'], [1, 'rgba(255,255,255,0)']]);
  g.fillRect(x, y, S, S);

  // rune glyph
  [x, y] = cell(SPR.RUNE);
  g.save();
  g.translate(x + 64, y + 64);
  g.strokeStyle = 'white'; g.lineWidth = 7; g.lineCap = 'round';
  g.shadowColor = 'white'; g.shadowBlur = 10;
  g.beginPath();
  g.moveTo(-22, -40); g.lineTo(-22, 40);
  g.moveTo(-22, -10); g.lineTo(22, -38);
  g.moveTo(-22, 10); g.lineTo(26, 36);
  g.moveTo(10, -10); g.lineTo(30, 0);
  g.stroke();
  g.beginPath(); g.arc(0, 0, 52, 0, Math.PI * 2); g.lineWidth = 3; g.stroke();
  g.restore();

  // shard / diamond
  [x, y] = cell(SPR.SHARD);
  g.save(); g.translate(x + 64, y + 64);
  {
    const lg = g.createLinearGradient(-20, 0, 20, 0);
    lg.addColorStop(0, 'rgba(255,255,255,0.4)'); lg.addColorStop(0.5, 'rgba(255,255,255,1)'); lg.addColorStop(1, 'rgba(255,255,255,0.5)');
    g.fillStyle = lg;
    g.beginPath(); g.moveTo(0, -60); g.lineTo(18, 0); g.lineTo(0, 60); g.lineTo(-18, 0); g.fill();
  }
  g.restore();

  // ember
  [x, y] = cell(SPR.EMBER);
  g.fillStyle = radial(x + 64, y + 64, 40, [[0, 'rgba(255,255,255,1)'], [0.3, 'rgba(255,255,255,0.9)'], [0.5, 'rgba(255,255,255,0.2)'], [1, 'rgba(255,255,255,0)']]);
  g.fillRect(x, y, S, S);

  // snowflake
  [x, y] = cell(SPR.SNOW);
  g.save(); g.translate(x + 64, y + 64);
  g.strokeStyle = 'white'; g.lineWidth = 6; g.lineCap = 'round'; g.shadowColor = 'white'; g.shadowBlur = 8;
  for (let i = 0; i < 6; i++) {
    g.rotate(Math.PI / 3);
    g.beginPath(); g.moveTo(0, 0); g.lineTo(0, -54);
    g.moveTo(0, -30); g.lineTo(-14, -44); g.moveTo(0, -30); g.lineTo(14, -44);
    g.stroke();
  }
  g.restore();

  // wisp (soft comet)
  [x, y] = cell(SPR.WISP);
  {
    const img = g.createImageData(S, S);
    for (let j = 0; j < S; j++) for (let i = 0; i < S; i++) {
      const dx = (i - 64) / 64, dy = (j - 64) / 64;
      const d = Math.sqrt(dx * dx * 2.5 + dy * dy);
      const n = noise(i / 10, j / 10);
      const alpha = Math.max(0, 1 - d) * (0.6 + 0.6 * n);
      const k = (j * S + i) * 4;
      img.data[k] = 255; img.data[k + 1] = 255; img.data[k + 2] = 255;
      img.data[k + 3] = Math.min(255, alpha * alpha * 255);
    }
    g.putImageData(img, x, y);
  }

  // bubble
  [x, y] = cell(SPR.BUBBLE);
  g.fillStyle = radial(x + 64, y + 64, 58, [[0, 'rgba(255,255,255,0.1)'], [0.8, 'rgba(255,255,255,0.25)'], [0.92, 'rgba(255,255,255,0.9)'], [1, 'rgba(255,255,255,0)']]);
  g.fillRect(x, y, S, S);
  g.fillStyle = radial(x + 44, y + 44, 14, [[0, 'rgba(255,255,255,1)'], [1, 'rgba(255,255,255,0)']]);
  g.fillRect(x, y, S, S);

  // lightning spark
  [x, y] = cell(SPR.BOLT);
  g.save(); g.translate(x + 64, y + 64);
  g.strokeStyle = 'white'; g.lineWidth = 5; g.shadowColor = 'white'; g.shadowBlur = 12; g.lineJoin = 'bevel';
  for (let b = 0; b < 3; b++) {
    g.beginPath();
    let px = 0, py = 0; g.moveTo(0, 0);
    const ang = Math.random() * Math.PI * 2;
    for (let s = 0; s < 6; s++) {
      px += Math.cos(ang) * 10 + (Math.random() - 0.5) * 18;
      py += Math.sin(ang) * 10 + (Math.random() - 0.5) * 18;
      g.lineTo(px, py);
    }
    g.stroke();
  }
  g.restore();

  // feather / leaf
  [x, y] = cell(SPR.FEATHER);
  g.save(); g.translate(x + 64, y + 64); g.rotate(0.6);
  g.fillStyle = 'rgba(255,255,255,0.95)';
  g.beginPath(); g.ellipse(0, 0, 14, 50, 0, 0, Math.PI * 2); g.fill();
  g.strokeStyle = 'rgba(120,120,120,0.8)'; g.lineWidth = 2; g.beginPath(); g.moveTo(0, -50); g.lineTo(0, 50); g.stroke();
  g.restore();

  // chunk (rock debris)
  [x, y] = cell(SPR.CHUNK);
  g.save(); g.translate(x + 64, y + 64);
  g.fillStyle = 'rgba(255,255,255,1)';
  g.beginPath();
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2, r = 30 + Math.random() * 25;
    if (i === 0) g.moveTo(Math.cos(a) * r, Math.sin(a) * r); else g.lineTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  g.closePath(); g.fill();
  g.fillStyle = 'rgba(0,0,0,0.35)';
  g.beginPath(); g.moveTo(-10, 0); g.lineTo(30, 10); g.lineTo(20, 40); g.lineTo(-20, 30); g.fill();
  g.restore();

  // droplet
  [x, y] = cell(SPR.DROP);
  g.save(); g.translate(x + 64, y + 70);
  g.fillStyle = radial(0, 0, 40, [[0, 'rgba(255,255,255,1)'], [0.7, 'rgba(255,255,255,0.8)'], [1, 'rgba(255,255,255,0)']]);
  g.beginPath(); g.moveTo(0, -55); g.quadraticCurveTo(34, 10, 0, 34); g.quadraticCurveTo(-34, 10, 0, -55); g.fill();
  g.restore();

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.NoColorSpace;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  return tex;
}

// Near-camera readability: particles closer than uNear.x fade toward uNear.z
// brightness/opacity (full strength from uNear.y metres), and no particle may
// grow wider on screen than uMaxAng * depth. Sprite indices >= 16 opt out of
// the near fade (ambient torches and braziers the player walks past).
const VERT = /* glsl */ `
uniform float uTime;
uniform float uFogDensity;
uniform vec3 uNear;
uniform float uMaxAng;
attribute vec3 iPos;
attribute vec3 iVel;
attribute vec4 iColor;
attribute vec3 iColor2;
attribute vec4 iTime;   // start, life, size0, size1
attribute vec4 iPhys;   // gravity, drag, spin, stretch
attribute vec2 iMisc;   // sprite, rotation
varying vec2 vUv;
varying vec4 vColor;
varying float vFog;
void main(){
  float age = uTime - iTime.x;
  float life = iTime.y;
  if (age < 0.0 || age > life) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); vColor = vec4(0.0); return; }
  float f = age / life;
  float drag = iPhys.y;
  float k = drag > 0.001 ? (1.0 - exp(-drag * age)) / drag : age;
  vec3 p = iPos + iVel * k;
  p.y -= 0.5 * iPhys.x * age * age;
  vec3 vel = iVel * exp(-drag * age);
  vel.y -= iPhys.x * age;
  vec4 mv = viewMatrix * vec4(p, 1.0);
  float depth = -mv.z;
  float size = min(mix(iTime.z, iTime.w, f), max(depth, 0.05) * uMaxAng);
  vec2 corner = position.xy;
  vec2 ax, ay;
  if (iPhys.w > 0.0) {
    vec2 d = (viewMatrix * vec4(vel, 0.0)).xy;
    float sp = length(d);
    d = sp > 1e-4 ? d / sp : vec2(1.0, 0.0);
    ax = d * min(size + sp * iPhys.w, max(depth, 0.05) * uMaxAng * 1.5);
    ay = vec2(-d.y, d.x) * size;
  } else {
    float rot = iMisc.y + iPhys.z * age;
    // flame tongues always lick upward (a random spin turns them into paper shards)
    if (abs(mod(iMisc.x, 16.0) - 3.0) < 0.5) rot = (fract(iMisc.y * 0.159) - 0.5) * 0.5 + sin(iPhys.z * age) * 0.15;
    float c = cos(rot), s = sin(rot);
    ax = vec2(c, s) * size;
    ay = vec2(-s, c) * size;
  }
  mv.xy += ax * corner.x + ay * corner.y;
  gl_Position = projectionMatrix * mv;
  float spr = mod(iMisc.x, 16.0);
  float nearK = iMisc.x > 15.5 ? 1.0 : mix(uNear.z, 1.0, smoothstep(uNear.x, uNear.y, depth));
  vec2 cell = vec2(mod(spr, 4.0), 3.0 - floor(spr / 4.0));
  vUv = (cell + corner + 0.5) / 4.0;
  float a = iColor.a * smoothstep(0.0, 0.08, f) * (1.0 - smoothstep(0.55, 1.0, f)) * nearK;
  vColor = vec4(mix(iColor.rgb, iColor2, f), a);
  vFog = 1.0 - exp(-uFogDensity * uFogDensity * depth * depth);
}
`;

const FRAG_ADD = /* glsl */ `
uniform sampler2D uAtlas;
varying vec2 vUv;
varying vec4 vColor;
varying float vFog;
void main(){
  vec4 t = texture2D(uAtlas, vUv);
  float a = t.a * vColor.a * (1.0 - vFog);
  if (a < 0.002) discard;
  gl_FragColor = vec4(vColor.rgb * t.rgb * a, 1.0);
}
`;

const FRAG_ALPHA = /* glsl */ `
uniform sampler2D uAtlas;
uniform vec3 uFogColor;
varying vec2 vUv;
varying vec4 vColor;
varying float vFog;
void main(){
  vec4 t = texture2D(uAtlas, vUv);
  float a = t.a * vColor.a;
  if (a < 0.004) discard;
  vec3 c = mix(vColor.rgb * t.rgb, uFogColor, vFog);
  gl_FragColor = vec4(c, a);
}
`;

function makeMaterial(atlas, additive, near, maxAng) {
  const uniforms = {
    uTime: { value: 0 },
    uAtlas: { value: atlas },
    uFogDensity: { value: 0.04 },
    uFogColor: { value: new THREE.Color(0x05070a) },
    uNear: { value: new THREE.Vector3(...near) },
    uMaxAng: { value: maxAng },
  };
  const mat = new THREE.ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: additive ? FRAG_ADD : FRAG_ALPHA,
    uniforms,
    transparent: true,
    depthWrite: false,
    blending: additive ? THREE.CustomBlending : THREE.NormalBlending,
  });
  if (additive) {
    mat.blendSrc = THREE.OneFactor;
    mat.blendDst = THREE.OneFactor;
    mat.blendEquation = THREE.AddEquation;
  }
  return mat;
}

class ParticleLayer {
  // share: another layer whose material (and so program and uniforms) this one draws with
  constructor(capacity, atlas, additive, near, maxAng, share = null) {
    this.capacity = capacity;
    const geo = new THREE.InstancedBufferGeometry();
    const quad = new THREE.PlaneGeometry(1, 1);
    geo.index = quad.index;
    geo.setAttribute('position', quad.getAttribute('position'));
    const mk = (n) => {
      const a = new THREE.InstancedBufferAttribute(new Float32Array(capacity * n), n);
      a.setUsage(THREE.DynamicDrawUsage);
      return a;
    };
    this.a = {
      iPos: mk(3), iVel: mk(3), iColor: mk(4), iColor2: mk(3), iTime: mk(4), iPhys: mk(4), iMisc: mk(2),
    };
    // all particles start dead
    for (let i = 0; i < capacity; i++) this.a.iTime.array[i * 4] = -1e6;
    for (const [k, v] of Object.entries(this.a)) geo.setAttribute(k, v);
    this.attrs = Object.values(this.a);
    const mat = share ? share.mesh.material : makeMaterial(atlas, additive, near, maxAng);
    this.uniforms = mat.uniforms;
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = additive ? 20 : 10;
    // Only the live part of the ring is drawn: every instance costs a vertex
    // shader run for all four corners even when dead, and a fight rarely has
    // more than a few thousand of the 36k alive. Live particles lie in ring
    // order between tail (oldest that may still live) and head. Unwrapped,
    // that is [tail, head) and the first `head` instances are drawn; once the
    // dead run before tail outgrows the live span, head restarts at 0 and the
    // draw covers [0, end) until the old run [tail, end) has died out.
    this.dieAt = new Float64Array(capacity);
    this.head = 0;
    this.tail = 0;
    this.end = 0;
    this.wrapped = false;
    geo.instanceCount = 0;
    this.geo = geo;
    // dirty slots as runs [start, end): an early restart at 0 makes two runs
    // a frame, and one min..max range would re-upload everything between them
    this.runs = [];
    this.runEnd = -1;
  }

  spawn(time, o) {
    if (!this.wrapped && (this.head >= this.capacity || this.tail > this.head - this.tail + 256)) { this.end = this.head; this.head = 0; this.wrapped = true; }
    if (this.wrapped && this.head === this.tail) {
      // the new run caught up with the old one: all of [0, end) may be live,
      // so carry on after it; a full ring overwrites the oldest particle
      if (this.end < this.capacity) { this.tail = 0; this.head = this.end; this.wrapped = false; }
      else if (++this.tail >= this.end) { this.tail = 0; this.wrapped = false; }
    }
    const i = this.head++;
    this.dieAt[i] = time + (o.delay || 0) + (o.life ?? 1);
    const A = this.a;
    let j = i * 3;
    A.iPos.array[j] = o.x; A.iPos.array[j + 1] = o.y; A.iPos.array[j + 2] = o.z;
    A.iVel.array[j] = o.vx || 0; A.iVel.array[j + 1] = o.vy || 0; A.iVel.array[j + 2] = o.vz || 0;
    const r = o.r ?? 1, g = o.g ?? 1, b = o.b ?? 1;
    A.iColor2.array[j] = o.r2 ?? r; A.iColor2.array[j + 1] = o.g2 ?? g; A.iColor2.array[j + 2] = o.b2 ?? b;
    j = i * 4;
    A.iColor.array[j] = r; A.iColor.array[j + 1] = g; A.iColor.array[j + 2] = b; A.iColor.array[j + 3] = o.a ?? 1;
    A.iTime.array[j] = time + (o.delay || 0); A.iTime.array[j + 1] = o.life ?? 1;
    A.iTime.array[j + 2] = o.size ?? 0.2; A.iTime.array[j + 3] = o.size2 ?? (o.size ?? 0.2);
    A.iPhys.array[j] = o.gravity || 0; A.iPhys.array[j + 1] = o.drag || 0;
    A.iPhys.array[j + 2] = o.spin || 0; A.iPhys.array[j + 3] = o.stretch || 0;
    j = i * 2;
    A.iMisc.array[j] = o.sprite ?? 0; A.iMisc.array[j + 1] = o.rot ?? Math.random() * 6.28;
    if (i === this.runEnd) this.runs[this.runs.length - 1] = ++this.runEnd;
    else { this.runs.push(i, i + 1); this.runEnd = i + 1; }
  }

  flush(time) {
    this.uniforms.uTime.value = time;
    const D = this.dieAt;
    while ((this.wrapped || this.tail < this.head) && D[this.tail] < time) {
      if (++this.tail >= this.end && this.wrapped) { this.tail = 0; this.wrapped = false; }
    }
    if (!this.wrapped && this.tail === this.head) this.tail = this.head = 0;
    this.geo.instanceCount = this.wrapped ? this.end : this.head;
    const R = this.runs;
    if (!R.length) return;
    // append (don't replace) the ranges: several updates can run before the
    // next render (hitches, fixed-step catch-up, tests) and three only clears
    // them once it has uploaded them; a long stretch without a render
    // (headless tests) collapses them into one whole-buffer upload
    for (const attr of this.attrs) {
      const n = attr.itemSize;
      if (attr.updateRanges.length > 48) { attr.clearUpdateRanges(); attr.addUpdateRange(0, attr.array.length); }
      else if (attr.updateRanges.length !== 1 || attr.updateRanges[0].count !== attr.array.length) for (let k = 0; k < R.length; k += 2) attr.addUpdateRange(R[k] * n, (R[k + 1] - R[k]) * n);
      attr.needsUpdate = true;
    }
    R.length = 0;
    this.runEnd = -1;
  }
}

const LONG = 0.6; // seconds: glows outliving this go to the long-lived ring

export class Particles {
  constructor(scene) {
    this.atlas = makeAtlas();
    // glows dim to 8% right in front of the lens (muzzles, trails leaving the
    // focus, fire you stand in - dozens of them stack up there and bloom into a
    // white sheet); smoke and debris vanish entirely within ~0.7 m so puffs
    // never turn into flat discs over the screen
    this.add = new ParticleLayer(20000, this.atlas, true, [0.6, 3.5, 0.08], 0.5);
    // long-lived glows (embers, ambient motes, lingering auras) get their own
    // ring with the same material: mixed into the main one, each held the
    // drawn window open for seconds behind it
    this.addLong = new ParticleLayer(8192, this.atlas, true, null, 0, this.add);
    this.alpha = new ParticleLayer(8000, this.atlas, false, [0.7, 2.4, 0.0], 0.7);
    scene.add(this.add.mesh);
    scene.add(this.addLong.mesh);
    scene.add(this.alpha.mesh);
    this.time = 0;
  }
  setFog(density, color) {
    for (const l of [this.add, this.alpha]) {
      l.uniforms.uFogDensity.value = density;
      l.uniforms.uFogColor.value.set(color);
    }
  }
  // additive (glowing) particle
  glow(o) { ((o.life ?? 1) + (o.delay || 0) > LONG ? this.addLong : this.add).spawn(this.time, o); }
  // additive particle that ignores the near-camera fade (ambient fire)
  glowAmbient(o) { o.sprite = (o.sprite ?? 0) + 16; this.glow(o); }
  // alpha-blended (smoke, debris, blood)
  solid(o) { this.alpha.spawn(this.time, o); }
  update(time) {
    this.time = time;
    this.add.flush(time);
    this.addLong.flush(time);
    this.alpha.flush(time);
  }
}
