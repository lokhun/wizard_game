import * as THREE from 'three';
import { mulberry } from './shapes.js';

// Cast sigils: a rune circle that blooms where a spell leaves the focus or
// hand, spins and fades. Each class gets its own circle (star order, glyphs,
// ring count) drawn once to a canvas; the meshes are tinted with the class colour.

const _tex = new Map();

function sigilTexture(classId) {
  if (_tex.has(classId)) return _tex.get(classId);
  let seed = 7;
  for (const ch of classId) seed = (seed * 31 + ch.charCodeAt(0)) >>> 0;
  const rnd = mulberry(seed);
  const S = 256, c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  g.translate(S / 2, S / 2);
  g.strokeStyle = '#fff'; g.fillStyle = '#fff';
  g.lineCap = 'round'; g.lineJoin = 'round';
  g.shadowColor = '#fff'; g.shadowBlur = 6;
  const ring = (r, w) => { g.lineWidth = w; g.beginPath(); g.arc(0, 0, r, 0, Math.PI * 2); g.stroke(); };
  ring(118, 3); ring(108, 1.5);
  // glyph band between the two outer rings
  const nG = 14 + Math.floor(rnd() * 6);
  for (let i = 0; i < nG; i++) {
    const a = (i / nG) * Math.PI * 2;
    g.save(); g.rotate(a); g.translate(0, -100); g.lineWidth = 1.8;
    g.beginPath();
    // 2-4 strokes on a 3x3 lattice: reads as an alphabet, never as real text
    const pts = [[-4, -5], [0, -5], [4, -5], [-4, 0], [0, 0], [4, 0], [-4, 5], [0, 5], [4, 5]];
    const nS = 2 + Math.floor(rnd() * 3);
    let p = pts[Math.floor(rnd() * 9)];
    g.moveTo(p[0], p[1]);
    for (let k = 0; k < nS; k++) { p = pts[Math.floor(rnd() * 9)]; g.lineTo(p[0], p[1]); }
    g.stroke(); g.restore();
  }
  ring(90, 2);
  // inner star polygon {n/m}
  const n = 5 + Math.floor(rnd() * 4), m = n >= 7 ? 3 : 2;
  g.lineWidth = 2.2; g.beginPath();
  for (let i = 0; i <= n; i++) {
    const a = ((i * m) / n) * Math.PI * 2 - Math.PI / 2;
    const x = Math.cos(a) * 88, y = Math.sin(a) * 88;
    i ? g.lineTo(x, y) : g.moveTo(x, y);
  }
  g.stroke();
  // nodes where the star meets the ring
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 - Math.PI / 2;
    g.beginPath(); g.arc(Math.cos(a) * 90, Math.sin(a) * 90, 4, 0, Math.PI * 2); g.fill();
  }
  if (rnd() < 0.6) ring(46, 1.5);
  ring(22, 2.5);
  // tick marks around the inner ring
  g.lineWidth = 1.2;
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * Math.PI * 2;
    g.beginPath(); g.moveTo(Math.cos(a) * 28, Math.sin(a) * 28); g.lineTo(Math.cos(a) * (i % 3 ? 33 : 38), Math.sin(a) * (i % 3 ? 33 : 38)); g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  _tex.set(classId, t);
  return t;
}

const _geo = new THREE.PlaneGeometry(1, 1);
_geo.userData.shared = true;

// A small pool of sigils parented under `parent` (the viewmodel root, whose
// +z points back at the camera, so an unrotated plane faces the eye).
// locate(anchor, out) writes an anchor's current position in parent space, so
// a circle rides along with the staff tip or hand that cast it.
export class SigilPool {
  constructor(parent, classId, color, locate, n = 3) {
    this.locate = locate;
    this.items = [];
    const tex = sigilTexture(classId);
    for (let i = 0; i < n; i++) {
      const mat = new THREE.MeshBasicMaterial({ map: tex, color, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
      const m = new THREE.Mesh(_geo, mat);
      m.visible = false; m.renderOrder = 5; m.frustumCulled = false;
      parent.add(m);
      this.items.push({ m, anchor: null, life: 0, dur: 1, size: 0.1, spin: 1, peak: 0.6 });
    }
    // the charge sigil: held at the focus while a spell winds up
    const cm = new THREE.MeshBasicMaterial({ map: tex, color, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
    this.charge = new THREE.Mesh(_geo, cm);
    this.charge.visible = false; this.charge.renderOrder = 5; this.charge.frustumCulled = false;
    parent.add(this.charge);
    this.chargeK = 0;
    this.next = 0;
  }

  burst(anchor, { size = 0.12, dur = 0.5, peak = 0.6, spin = 1 } = {}) {
    const it = this.items[this.next];
    this.next = (this.next + 1) % this.items.length;
    it.anchor = anchor;
    it.m.rotation.set(0, 0, Math.random() * Math.PI * 2);
    it.life = 0; it.dur = dur; it.size = size; it.spin = spin * (Math.random() < 0.5 ? -1 : 1); it.peak = peak;
    it.m.visible = true;
  }

  update(dt, chargeAnchor, charge) {
    for (const it of this.items) {
      if (!it.m.visible) continue;
      it.life += dt;
      const u = it.life / it.dur;
      if (u >= 1) { it.m.visible = false; continue; }
      this.locate(it.anchor, it.m.position);
      // snaps open fast, then drifts wider as it fades
      const open = 1 - Math.pow(1 - Math.min(u / 0.22, 1), 3);
      it.m.scale.setScalar(it.size * (0.35 + 0.65 * open + 0.25 * u));
      it.m.rotation.z += dt * it.spin * (3.2 - 2.4 * u);
      it.m.material.opacity = it.peak * (u < 0.1 ? u / 0.1 : u < 0.45 ? 1 : Math.pow(1 - (u - 0.45) / 0.55, 1.4));
    }
    this.chargeK += (charge - this.chargeK) * (1 - Math.exp(-dt * 10));
    const c = this.charge;
    if (this.chargeK > 0.02 && chargeAnchor) {
      c.visible = true;
      this.locate(chargeAnchor, c.position);
      c.scale.setScalar(0.05 + 0.06 * this.chargeK);
      c.rotation.z += dt * (0.8 + this.chargeK * 2.5);
      c.material.opacity = 0.42 * this.chargeK;
    } else c.visible = false;
  }

  // anything to draw this frame?
  busy(charge) { return charge > 0.02 || this.chargeK > 0.02 || this.items.some((it) => it.m.visible); }

  dispose() {
    for (const it of this.items) { it.m.material.dispose(); it.m.removeFromParent(); }
    this.charge.material.dispose(); this.charge.removeFromParent();
  }
}
