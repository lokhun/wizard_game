import * as THREE from 'three';
import { worldBox, tf, colorize, GeoBuilder } from '../render/geo.js';

// ---------------------------------------------------------------------------
// Procedural prop library. Each builder returns a list of [materialKey, geo]
// parts in local space (y=0 is the floor). The level builder merges all props
// into a handful of large static batches, one per material.
// ---------------------------------------------------------------------------

// Detail level for the heavier props: low and medium settings get leaner books, chains,
// bars and flutes (the builder sets this before it builds a floor).
let leanProps = false;
export function setPropDetail(quality) { leanProps = quality === 'low' || quality === 'medium'; }

const cyl = (rt, rb, h, seg = 12, open = false) => new THREE.CylinderGeometry(rt, rb, h, seg, 1, open);
const box = (w, h, d, s = 0.5) => worldBox(w, h, d, s);
const sph = (r, ws = 12, hs = 8) => new THREE.SphereGeometry(r, ws, hs);
const tor = (r, t, rs = 8, ts = 16, arc = Math.PI * 2) => new THREE.TorusGeometry(r, t, rs, ts, arc);

function scaleUV(g, s) {
  const uv = g.getAttribute('uv');
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * s, uv.getY(i) * s);
  return g;
}
function cylUV(g, circ, h) {
  const uv = g.getAttribute('uv');
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * circ, uv.getY(i) * h);
  return g;
}
// random jitter of vertices for organic shapes
function jitter(g, amt, rng) {
  const p = g.getAttribute('position');
  const map = new Map();
  for (let i = 0; i < p.count; i++) {
    const k = `${p.getX(i).toFixed(3)},${p.getY(i).toFixed(3)},${p.getZ(i).toFixed(3)}`;
    if (!map.has(k)) map.set(k, [rng() * 2 - 1, rng() * 2 - 1, rng() * 2 - 1]);
    const j = map.get(k);
    p.setXYZ(i, p.getX(i) + j[0] * amt, p.getY(i) + j[1] * amt, p.getZ(i) + j[2] * amt);
  }
  g.computeVertexNormals();
  return g;
}

function barrel(r) {
  const parts = [];
  const pts = [];
  for (let i = 0; i <= 10; i++) {
    const t = i / 10;
    pts.push(new THREE.Vector2(0.36 + Math.sin(t * Math.PI) * 0.07, t * 1.0));
  }
  const seg = leanProps ? 10 : 16;
  const body = cylUV(new THREE.LatheGeometry(leanProps ? pts.filter((_, i) => i % 2 === 0) : pts, seg), 2.4, 1);
  parts.push(['wood', body]);
  parts.push(['wood', tf(cyl(0.37, 0.37, 0.02, seg), { y: 0.99 })]);
  for (const y of leanProps ? [0.12, 0.88] : [0.12, 0.38, 0.62, 0.88]) {
    const rr = 0.36 + Math.sin(y * Math.PI) * 0.07 + 0.008;
    parts.push(['iron', tf(cylUV(cyl(rr, rr, 0.05, seg, true), 2, 0.1), { y })]);
  }
  return parts;
}

// powder keg: a red-painted barrel with a lit fuse; explodes when broken
function keg(r) {
  const parts = barrel(r).map(([k, g], i) => (i === 0 ? ['cloth', colorize(g, 0x6a1410)] : [k, g]));
  // pale cloth wrap with a black band (the warning stripe)
  parts.push(['cloth', colorize(tf(cyl(0.435, 0.435, 0.14, 16, true), { y: 0.5 }), 0xb8a888)]);
  parts.push(['cloth', colorize(tf(cyl(0.437, 0.437, 0.04, 16, true), { y: 0.5 }), 0x141010)]);
  // fuse and its ember
  parts.push(['rope', tf(cyl(0.015, 0.015, 0.16, 5), { x: 0.12, y: 1.07, rz: 0.4 })]);
  parts.push(['glow', colorize(tf(sph(0.03, 6, 4), { x: 0.09, y: 1.15 }), 0xff7020)]);
  return parts;
}

function crate(rng) {
  const s = 0.7 + rng() * 0.3;
  const parts = [['wood', tf(box(s, s, s), { y: s / 2 })]];
  // corner straps
  for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    parts.push(['wood', tf(box(0.08, s + 0.02, 0.08), { x: x * s / 2, y: s / 2, z: z * s / 2 })]);
  }
  parts.push(['wood', tf(box(s * 1.35, 0.08, 0.04), { y: s / 2, z: s / 2 + 0.01, rz: 0.78 })]);
  parts.push(['wood', tf(box(s * 1.35, 0.08, 0.04), { y: s / 2, z: -s / 2 - 0.01, rz: -0.78 })]);
  return parts;
}

function rubble(rng) {
  const parts = [];
  const n = 4 + Math.floor(rng() * 6);
  for (let i = 0; i < n; i++) {
    const r = 0.1 + rng() * 0.25;
    const g = jitter(new THREE.DodecahedronGeometry(r, 0), r * 0.3, rng);
    parts.push(['rock', tf(scaleUV(g, 1), { x: (rng() - 0.5) * 1.4, y: r * 0.5, z: (rng() - 0.5) * 1.4, rx: rng() * 3, ry: rng() * 3 })]);
  }
  return parts;
}

function bones(rng) {
  const parts = [];
  for (let i = 0; i < 6; i++) {
    const len = 0.25 + rng() * 0.25;
    const g = cyl(0.025, 0.025, len, 5);
    parts.push(['bone', tf(g, { x: (rng() - 0.5) * 0.8, y: 0.03, z: (rng() - 0.5) * 0.8, rz: Math.PI / 2, ry: rng() * 6 })]);
    parts.push(['bone', tf(sph(0.04, 6, 4), { x: (rng() - 0.5) * 0.8, y: 0.03, z: (rng() - 0.5) * 0.8 })]);
  }
  if (rng() < 0.7) {
    parts.push(['bone', tf(skullGeo(), { x: (rng() - 0.5) * 0.4, y: 0.1, z: (rng() - 0.5) * 0.4, ry: rng() * 6, rz: (rng() - 0.5) * 0.6 })]);
  }
  return parts;
}

export function skullGeo() {
  const g = leanProps ? sph(0.11, 7, 5) : sph(0.11, 10, 8);
  const p = g.getAttribute('position');
  for (let i = 0; i < p.count; i++) {
    let x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    if (y < 0) { x *= 0.85; z *= 0.95; }
    if (z > 0.05 && y < 0.02) { y -= 0.03; }
    p.setXYZ(i, x, y * 1.05, z * 1.15);
  }
  g.computeVertexNormals();
  return g;
}

function pillarSquare() {
  const parts = [];
  parts.push(['trim', tf(box(1.3, 0.4, 1.3), { y: 0.2 })]);
  parts.push(['wall', tf(box(1.0, 12, 1.0), { y: 6.4 })]);
  parts.push(['trim', tf(box(1.25, 0.3, 1.25), { y: 0.55 })]);
  return parts;
}
function pillarRound() {
  const parts = [];
  parts.push(['trim', tf(box(1.25, 0.35, 1.25), { y: 0.175 })]);
  parts.push(['trim', tf(cylUV(cyl(0.58, 0.62, 0.3, 16), 2, 0.3), { y: 0.5 })]);
  parts.push(['trim', tf(cylUV(cyl(0.5, 0.52, 14, 16), 3.2, 14), { y: 7.6 })]);
  parts.push(['trim', tf(tor(0.52, 0.06, 6, 16), { y: 0.68, rx: Math.PI / 2 })]);
  parts.push(['trim', tf(tor(0.51, 0.05, 6, 16), { y: 3.2, rx: Math.PI / 2 })]);
  return parts;
}
function pillarGrand() {
  const parts = [];
  parts.push(['trim', tf(box(1.9, 0.6, 1.9), { y: 0.3 })]);
  parts.push(['gold', tf(leanProps ? tor(0.82, 0.07, 3, 12) : tor(0.82, 0.07, 6, 20), { y: 0.75, rx: Math.PI / 2 })]);
  // fluted column: ring of thin cylinders around a core
  parts.push(['trim', tf(cylUV(cyl(0.72, 0.78, 18, leanProps ? 12 : 20), 4, 18), { y: 9.6 })]);
  const nf = leanProps ? 8 : 12;
  for (let i = 0; i < nf; i++) {
    const a = (i / nf) * Math.PI * 2;
    parts.push(['trim', tf(cyl(0.09, 0.09, 17.5, leanProps ? 4 : 6), { x: Math.cos(a) * 0.75, z: Math.sin(a) * 0.75, y: 9.5 })]);
  }
  parts.push(['gold', tf(leanProps ? tor(0.82, 0.06, 3, 12) : tor(0.82, 0.06, 6, 20), { y: 4.2, rx: Math.PI / 2 })]);
  return parts;
}

function cellBars(len) {
  const parts = [];
  const n = Math.floor(len / 0.22);
  for (let i = 0; i <= n; i++) {
    const x = -len / 2 + (i / n) * len;
    parts.push(['iron', tf(cyl(0.025, 0.025, 3.4, leanProps ? 4 : 6), { x, y: 1.7 })]);
  }
  parts.push(['iron', tf(box(len, 0.08, 0.06), { y: 0.1 })]);
  parts.push(['iron', tf(box(len, 0.08, 0.06), { y: 1.1 })]);
  parts.push(['iron', tf(box(len, 0.08, 0.06), { y: 3.3 })]);
  return parts;
}

function chains(rng) {
  const parts = [];
  for (let c = 0; c < 2; c++) {
    const x = (c - 0.5) * 0.8;
    const links = 10 + Math.floor(rng() * 5);
    for (let i = 0; i < links; i++) {
      parts.push(['iron', tf(leanProps ? tor(0.045, 0.012, 3, 5) : tor(0.045, 0.012, 4, 8), { x, y: 3.2 - i * 0.075, ry: (i % 2) * Math.PI / 2 })]);
    }
    parts.push(['iron', tf(tor(0.09, 0.02, 4, 10), { x, y: 3.2 - links * 0.075 - 0.08, rx: Math.PI / 2 })]);
  }
  return parts;
}

function sack(rng) {
  const g = jitter(sph(0.32, 10, 8), 0.04, rng);
  g.scale(1, 0.75, 1);
  return [['cloth', colorize(tf(g, { y: 0.24 }), 0x9a8460)]];
}

function table(rng) {
  const parts = [['wood', tf(box(1.8, 0.08, 0.9), { y: 0.82 })]];
  for (const [x, z] of [[-0.8, -0.35], [0.8, -0.35], [-0.8, 0.35], [0.8, 0.35]]) parts.push(['wood', tf(box(0.08, 0.8, 0.08), { x, y: 0.4, z })]);
  parts.push(['wood', tf(box(1.6, 0.05, 0.05), { y: 0.25 })]);
  if (rng() < 0.7) parts.push(['iron', tf(cyl(0.06, 0.05, 0.12, 8), { x: 0.3, y: 0.92, z: 0.1 })]);
  if (rng() < 0.6) parts.push(['bone', tf(skullGeo(), { x: -0.4, y: 0.94, z: -0.1, ry: 1 })]);
  return parts;
}
function longTable() {
  const parts = [['wood', tf(box(6, 0.1, 1.4), { y: 0.85 })]];
  for (let i = -2; i <= 2; i++) parts.push(['wood', tf(box(0.12, 0.82, 1.2), { x: i * 1.4, y: 0.41 })]);
  // chairs along both sides
  for (let i = -2; i <= 2; i++) for (const s of [-1, 1]) {
    parts.push(['wood', tf(box(0.5, 0.06, 0.5), { x: i * 1.2, y: 0.5, z: s * 1.1 })]);
    parts.push(['wood', tf(box(0.5, 0.8, 0.06), { x: i * 1.2, y: 0.9, z: s * 1.35 })]);
    for (const [cx, cz] of [[-0.2, -0.2], [0.2, -0.2], [-0.2, 0.2], [0.2, 0.2]]) parts.push(['wood', tf(box(0.05, 0.5, 0.05), { x: i * 1.2 + cx, y: 0.25, z: s * 1.1 + cz })]);
  }
  // tablecloth runner, goblets, candles
  parts.push(['cloth', colorize(tf(box(5.6, 0.02, 0.5), { y: 0.91 }), 0x5a1015)]);
  for (let i = -2; i <= 2; i++) {
    parts.push(['gold', tf(cyl(0.04, 0.02, 0.14, 8), { x: i * 1.1 + 0.3, y: 0.98, z: 0.4 })]);
    parts.push(['candle', tf(cyl(0.03, 0.03, 0.22, 6), { x: i * 1.1 - 0.2, y: 1.02, z: -0.1 })]);
  }
  return parts;
}
function stool() {
  const parts = [['wood', tf(cyl(0.22, 0.22, 0.06, 10), { y: 0.48 })]];
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    parts.push(['wood', tf(cyl(0.03, 0.03, 0.5, 5), { x: Math.cos(a) * 0.15, y: 0.24, z: Math.sin(a) * 0.15, rx: Math.sin(a) * 0.15, rz: -Math.cos(a) * 0.15 })]);
  }
  return parts;
}
function bucket() {
  return [['wood', tf(cylUV(cyl(0.2, 0.16, 0.36, 10), 1.2, 0.4), { y: 0.18 })], ['iron', tf(tor(0.2, 0.012, 4, 12, Math.PI), { y: 0.36 })]];
}
function hay(rng) {
  const g = jitter(sph(0.6, 10, 6), 0.08, rng);
  g.scale(1.2, 0.45, 1);
  return [['cloth', colorize(tf(g, { y: 0.15 }), 0xb09048)]];
}
function rack() {
  // torture rack
  const parts = [['wood', tf(box(0.9, 0.12, 2.2), { y: 0.8 })]];
  for (const [x, z] of [[-0.4, -1], [0.4, -1], [-0.4, 1], [0.4, 1]]) parts.push(['wood', tf(box(0.12, 0.85, 0.12), { x, y: 0.42, z })]);
  parts.push(['wood', tf(cyl(0.08, 0.08, 1.1, 8), { y: 0.95, z: 1.05, rz: Math.PI / 2 })]);
  parts.push(['iron', tf(tor(0.1, 0.02, 4, 10), { y: 1.0, z: -0.9, rx: Math.PI / 2 })]);
  return parts;
}
function cage() {
  const parts = [];
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    parts.push(['iron', tf(cyl(0.02, 0.02, 1.6, 4), { x: Math.cos(a) * 0.5, y: 0.8, z: Math.sin(a) * 0.5 })]);
  }
  parts.push(['iron', tf(tor(0.5, 0.03, 4, 16), { y: 0.05, rx: Math.PI / 2 })]);
  parts.push(['iron', tf(tor(0.5, 0.03, 4, 16), { y: 1.6, rx: Math.PI / 2 })]);
  parts.push(['iron', tf(new THREE.ConeGeometry(0.52, 0.4, 10, 1, true), { y: 1.8 })]);
  parts.push(['bone', tf(skullGeo(), { y: 0.12, x: 0.1 })]);
  return parts;
}
function skeletonSit() {
  const parts = [];
  parts.push(['bone', tf(skullGeo(), { y: 0.95, z: 0.05, rx: 0.4 })]);
  parts.push(['bone', tf(cyl(0.03, 0.03, 0.55, 6), { y: 0.6, rx: -0.2 })]);
  for (let i = 0; i < 4; i++) parts.push(['bone', tf(tor(0.12 - i * 0.008, 0.012, 4, 10, Math.PI * 1.4), { y: 0.75 - i * 0.07, z: 0.03, rx: Math.PI / 2, rz: -0.6 })]);
  for (const s of [-1, 1]) {
    parts.push(['bone', tf(cyl(0.025, 0.025, 0.42, 6), { x: s * 0.12, y: 0.12, z: 0.2, rx: Math.PI / 2 })]);
    parts.push(['bone', tf(cyl(0.022, 0.022, 0.4, 6), { x: s * 0.12, y: 0.25, z: 0.45, rx: 0.3 })]);
    parts.push(['bone', tf(cyl(0.02, 0.02, 0.5, 6), { x: s * 0.2, y: 0.45, z: 0.1, rz: s * 0.3 })]);
  }
  return parts;
}
function bloodstain() { return [['decalBlood', tf(new THREE.CircleGeometry(0.9, 16), { y: 0.015, rx: -Math.PI / 2 })]]; }
function puddle() { return [['puddle', tf(new THREE.CircleGeometry(1.0, 16), { y: 0.012, rx: -Math.PI / 2, sx: 1.4 })]]; }
function grate() {
  const parts = [['iron', tf(box(1.2, 0.04, 1.2), { y: 0.0 })]];
  for (let i = -2; i <= 2; i++) parts.push(['iron', tf(box(0.06, 0.06, 1.1), { x: i * 0.22, y: 0.03 })]);
  parts.push(['decalDark', tf(new THREE.PlaneGeometry(1.1, 1.1), { y: 0.025, rx: -Math.PI / 2 })]);
  return parts;
}
// the oubliette's mouth: a heavy iron grate over a 2 m shaft in the floor (a frame, bars both ways, a
// hasp and a padlock on one side, a ring to haul it by on the other)
function pitGrate() {
  const parts = [];
  for (const [x, z, sx, sz] of [[0, -0.97, 2.08, 0.14], [0, 0.97, 2.08, 0.14], [-0.97, 0, 0.14, 2.08], [0.97, 0, 0.14, 2.08]]) parts.push(['iron', tf(box(sx, 0.1, sz), { x, y: 0.05, z })]);
  for (let i = -3; i <= 3; i++) parts.push(['iron', tf(box(0.055, 0.07, 1.9), { x: i * 0.26, y: 0.06 })]);
  for (const z of [-0.5, 0, 0.5]) parts.push(['iron', tf(box(1.9, 0.05, 0.05), { z, y: 0.09 })]);
  parts.push(['iron', tf(box(0.16, 0.14, 0.06), { x: 1.06, y: 0.07, z: 0.3 })]);
  parts.push(['iron', tf(new THREE.TorusGeometry(0.06, 0.014, 4, 8), { x: 1.1, y: 0.13, z: 0.3 })]);
  parts.push(['iron', tf(new THREE.TorusGeometry(0.11, 0.02, 4, 10), { x: -1.08, y: 0.03, z: 0, rx: -Math.PI / 2 })]);
  return parts;
}
function mushrooms(rng, glow = false) {
  const parts = [];
  const n = 3 + Math.floor(rng() * 5);
  for (let i = 0; i < n; i++) {
    const h = 0.08 + rng() * 0.25, r = 0.05 + rng() * 0.12;
    const x = (rng() - 0.5) * 0.7, z = (rng() - 0.5) * 0.4;
    parts.push(['bone', tf(cyl(r * 0.25, r * 0.3, h, 6), { x, y: h / 2, z })]);
    const cap = new THREE.SphereGeometry(r, 8, 5, 0, Math.PI * 2, 0, Math.PI / 2);
    parts.push([glow ? 'glow' : 'leather', colorize(tf(cap, { x, y: h, z, sy: 0.6 }), glow ? 0x40ff80 : 0x6a4a30)]);
  }
  return parts;
}
function pipe() {
  const parts = [];
  parts.push(['iron', tf(cylUV(cyl(0.3, 0.3, 1.6, leanProps ? 8 : 12), 2, 1.6), { y: 2.2, z: -0.1, rx: Math.PI / 2 })]);
  parts.push(['iron', tf(tor(0.33, 0.05, leanProps ? 4 : 6, leanProps ? 8 : 12), { y: 2.2, z: 0.6 })]);
  parts.push(['slime', tf(new THREE.PlaneGeometry(0.4, 2.0), { y: 1.0, z: 0.72 })]);
  return parts;
}

function sconce() {
  // iron wall bracket holding a wooden torch, origin at the flame
  const parts = [];
  parts.push(['iron', tf(box(0.16, 0.3, 0.04), { y: -0.55, z: -0.13 })]);
  parts.push(['iron', tf(cyl(0.015, 0.015, 0.22, 5), { y: -0.5, z: -0.04, rx: Math.PI / 2 - 0.5 })]);
  parts.push(['iron', tf(tor(0.06, 0.012, 4, 10), { y: -0.38, z: 0.02, rx: Math.PI / 2 })]);
  parts.push(['wood', tf(cyl(0.035, 0.025, 0.55, 6), { y: -0.3, z: 0.02, rx: 0.2 })]);
  parts.push(['charcoal', tf(cyl(0.05, 0.04, 0.12, 6), { y: -0.04, z: 0.04, rx: 0.2 })]);
  return parts;
}
function brazier(tall = false) {
  const parts = [];
  const h = tall ? 1.9 : 1.15;
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    parts.push(['iron', tf(cyl(0.03, 0.04, h, 5), { x: Math.cos(a) * 0.22, y: h / 2, z: Math.sin(a) * 0.22, rx: Math.sin(a) * 0.18, rz: -Math.cos(a) * 0.18 })]);
  }
  const bowl = new THREE.SphereGeometry(0.42, 14, 6, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2);
  bowl.scale(1, 0.6, 1);
  parts.push(['iron', tf(bowl, { y: h + 0.25, rx: 0 })]);
  parts.push(['iron', tf(tor(0.42, 0.03, 4, 16), { y: h + 0.25, rx: Math.PI / 2 })]);
  parts.push(['charcoal', tf(cyl(0.36, 0.3, 0.1, 10), { y: h + 0.16 })]);
  return parts;
}
function brazierFloor() {
  const parts = brazier(false);
  return parts;
}

function chandelier() {
  // origin at ceiling
  const parts = [];
  for (let i = 0; i < 3; i++) parts.push(['iron', tf(cyl(0.01, 0.01, 2.0, 4), { y: -1.0, x: Math.cos(i * 2.1) * 0.4, z: Math.sin(i * 2.1) * 0.4, rz: Math.cos(i * 2.1) * 0.2, rx: -Math.sin(i * 2.1) * 0.2 })]);
  parts.push(['iron', tf(tor(1.0, 0.04, 6, 24), { y: -2.4, rx: Math.PI / 2 })]);
  parts.push(['iron', tf(tor(0.5, 0.03, 6, 18), { y: -2.2, rx: Math.PI / 2 })]);
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    parts.push(['candle', tf(cyl(0.03, 0.03, 0.18, 6), { x: Math.cos(a), y: -2.28, z: Math.sin(a) })]);
  }
  return parts;
}
export const CHANDELIER_FLAMES = Array.from({ length: 10 }, (_, i) => [Math.cos((i / 10) * Math.PI * 2), -2.15, Math.sin((i / 10) * Math.PI * 2)]);

function candles(rng) {
  const parts = [];
  parts.flames = []; // (each one's wick: lit by the level's candle flames)
  for (let i = 0; i < 5; i++) {
    const h = 0.1 + rng() * 0.3, x = (rng() - 0.5) * 0.5, z = (rng() - 0.5) * 0.4;
    parts.push(['candle', tf(cyl(0.035, 0.04, h, 7), { x, y: h / 2, z })]);
    parts.flames.push([x, h + 0.005, z]);
  }
  return parts;
}
function candelabra() {
  const parts = [];
  parts.push(['gold', tf(cyl(0.2, 0.25, 0.08, 10), { y: 0.04 })]);
  parts.push(['gold', tf(cyl(0.03, 0.04, 1.6, 8), { y: 0.8 })]);
  parts.push(['gold', tf(tor(0.25, 0.02, 4, 12, Math.PI), { y: 1.6 })]);
  for (const x of [-0.25, 0, 0.25]) parts.push(['candle', tf(cyl(0.03, 0.03, 0.2, 6), { x, y: x === 0 ? 1.72 : 1.7 })]);
  return parts;
}

function bookshelf(len) {
  // a double-sided shelf row, centred
  const parts = [];
  const h = 3.2, d = 1.6;
  parts.push(['wood', tf(box(len, 0.08, d), { y: h })]);
  parts.push(['wood', tf(box(len, h, 0.06), { y: h / 2 })]);
  for (let x = -len / 2; x <= len / 2 + 0.01; x += 1.0) parts.push(['wood', tf(box(0.08, h, d), { x, y: h / 2 })]);
  const rngL = mulberry(Math.floor(len * 1000));
  const colors = [0x5a1a14, 0x1d2c44, 0x2a3a1e, 0x4a3218, 0x3c1838, 0x6a5a3a].map((c) => new THREE.Color(c));
  // every book is one shared unit box stretched by its matrix, all merged into a single part
  const books = new GeoBuilder(), rows = new GeoBuilder();
  const book = (w, bh, x, y, z, rz) => {
    _bq.setFromAxisAngle(_bz, rz);
    _bm.compose(_bp.set(x, y, z), _bq, _bs.set(w, bh, 0.5));
    const c = colors[Math.floor(rngL() * colors.length)];
    books.addGeometry(unitBook(), _bm, [c.r, c.g, c.b]);
  };
  // (lower detail: a run of books is one block whose texture draws its spines; leather stretched over a
  // whole run read as a wall of cobbles)
  const run = (w, bh, x, y, z) => {
    _bm.compose(_bp.set(x, y, z), _bq.identity(), _bs.set(w, bh, 0.5));
    const k = 0.82 + rngL() * 0.18;
    rows.addGeometry(unitRow(), _bm, [k, k * (0.94 + rngL() * 0.06), k * (0.9 + rngL() * 0.1)]);
  };
  for (let shelf = 0; shelf < 5; shelf++) {
    const y = 0.1 + shelf * 0.62;
    parts.push(['wood', tf(box(len, 0.05, d), { y })]);
    for (const side of [-1, 1]) {
      let x = -len / 2 + 0.06;
      while (x < len / 2 - 0.1) {
        if (leanProps) {
          // runs of books drawn as a few wider blocks
          const w = Math.min(len / 2 - 0.08 - x, 0.35 + rngL() * 0.45), bh = 0.36 + rngL() * 0.12;
          run(w, bh, x + w / 2, y + bh / 2 + 0.03, side * 0.45);
          x += w + 0.01;
          continue;
        }
        const w = 0.05 + rngL() * 0.06, bh = 0.32 + rngL() * 0.2;
        if (rngL() < 0.08) { x += 0.2; continue; }
        const lean = rngL() < 0.1 ? 0.25 : 0;
        book(w, bh, x + w / 2, y + bh / 2 + 0.03, side * 0.45, lean);
        x += w + 0.005;
      }
    }
  }
  if (leanProps) parts.push(['bookRow', rows.build()]); else parts.push(['leather', books.build()]);
  return parts;
}
const _bm = new THREE.Matrix4(), _bq = new THREE.Quaternion(), _bp = new THREE.Vector3(), _bs = new THREE.Vector3(), _bz = new THREE.Vector3(0, 0, 1);
let _unitBook = null;
const unitBook = () => (_unitBook ??= worldBox(1, 1, 1, 0.12));
let _unitRow = null;
const unitRow = () => (_unitRow ??= new THREE.BoxGeometry(1, 1, 1)); // (each face one tile: five spines a block)
function mulberry(a) { return function () { let t = (a += 0x6d2b79f5); t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

function bookPile(rng) {
  const parts = [];
  const colors = [0x5a1a14, 0x1d2c44, 0x2a3a1e, 0x4a3218, 0x3c1838];
  let y = 0;
  for (let i = 0; i < 3 + Math.floor(rng() * 4); i++) {
    const h = 0.06 + rng() * 0.05;
    parts.push(['leather', colorize(tf(box(0.35, h, 0.26, 2), { y: y + h / 2, ry: rng() * 0.8 }), colors[i % colors.length])]);
    y += h;
  }
  return parts;
}
function scrolls(rng) {
  const parts = [];
  for (let i = 0; i < 4; i++) parts.push(['cloth', colorize(tf(cyl(0.04, 0.04, 0.4, 6), { x: (rng() - 0.5) * 0.5, y: 0.04, z: (rng() - 0.5) * 0.5, rz: Math.PI / 2, ry: rng() * 3 }), 0xd8c8a0)]);
  return parts;
}

function armorStand() {
  const parts = [];
  parts.push(['wood', tf(box(0.6, 0.08, 0.6), { y: 0.04 })]);
  parts.push(['wood', tf(cyl(0.03, 0.03, 1.5, 6), { y: 0.8 })]);
  // breastplate
  const chest = new THREE.SphereGeometry(0.28, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.7);
  chest.scale(1, 1.4, 0.75);
  parts.push(['steel', tf(chest, { y: 1.15, rx: Math.PI })]);
  parts.push(['steel', tf(sph(0.14, 10, 8), { y: 1.75, sy: 1.15 })]);
  parts.push(['steel', tf(box(0.2, 0.03, 0.05), { y: 1.75, z: 0.13 })]);
  for (const s of [-1, 1]) parts.push(['steel', tf(sph(0.13, 8, 6), { x: s * 0.3, y: 1.45, sy: 0.7 })]);
  parts.push(['steel', tf(cyl(0.02, 0.02, 1.8, 6), { x: 0.4, y: 0.9 })]);
  parts.push(['steel', tf(new THREE.ConeGeometry(0.06, 0.4, 4), { x: 0.4, y: 1.95 })]);
  return parts;
}
function weaponRack() {
  const parts = [['wood', tf(box(1.4, 0.08, 0.3), { y: 0.3 })], ['wood', tf(box(1.4, 0.08, 0.1), { y: 1.4 })]];
  for (const x of [-0.65, 0.65]) parts.push(['wood', tf(box(0.08, 1.5, 0.08), { x, y: 0.75 })]);
  for (let i = 0; i < 4; i++) {
    const x = -0.45 + i * 0.3;
    parts.push(['steel', tf(cyl(0.015, 0.015, 1.6, 4), { x, y: 0.95, rz: 0.06 })]);
    parts.push(['steel', tf(new THREE.ConeGeometry(0.04, 0.2, 4), { x: x - 0.05, y: 1.82, rz: 0.06 })]);
  }
  return parts;
}

function banner(rng) {
  const parts = [];
  parts.push(['iron', tf(cyl(0.02, 0.02, 1.4, 5), { y: 4.5, rz: Math.PI / 2 })]);
  const cloth = new THREE.PlaneGeometry(1.1, 3.0, 4, 10);
  const p = cloth.getAttribute('position');
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i);
    let x = p.getX(i);
    // swallowtail cut at the bottom
    if (y < -1.3) { const k = 1 - Math.abs(x) / 0.55; p.setY(i, y + k * 0.4); }
    p.setZ(i, Math.sin(y * 2 + x) * 0.05);
  }
  cloth.computeVertexNormals();
  const cols = [0x6a1018, 0x14204a, 0x1e3a1a, 0x3a1048];
  const c = cols[Math.floor(rng() * cols.length)];
  parts.push(['banner', colorize(tf(cloth, { y: 3.0, z: 0.06 }), c)]);
  // golden sigil
  parts.push(['gold', tf(new THREE.CircleGeometry(0.25, 12), { y: 3.4, z: 0.12 })]);
  return parts;
}
function painting(rng) {
  const parts = [];
  parts.push(['gold', tf(box(1.4, 1.8, 0.08), { y: 2.6, z: 0.04 })]);
  const cols = [0x2a2018, 0x18202a, 0x2a1818];
  parts.push(['canvas', colorize(tf(new THREE.PlaneGeometry(1.2, 1.6), { y: 2.6, z: 0.09 }), cols[Math.floor(rng() * 3)])]);
  return parts;
}

function chest() {
  const parts = [];
  parts.push(['wood', tf(box(1.0, 0.55, 0.62), { y: 0.275 })]);
  for (const x of [-0.42, 0.42]) parts.push(['iron', tf(box(0.06, 0.57, 0.64), { x, y: 0.28 })]);
  parts.push(['gold', tf(box(0.14, 0.18, 0.04), { y: 0.48, z: 0.32 })]);
  return parts;
}
export function chestLid() {
  const parts = [];
  const lid = new THREE.CylinderGeometry(0.31, 0.31, 1.0, 12, 1, false, 0, Math.PI);
  lid.rotateZ(Math.PI / 2);
  parts.push(['wood', tf(lid, { y: 0, z: 0.31 })]);
  for (const x of [-0.42, 0.42]) {
    const band = new THREE.CylinderGeometry(0.32, 0.32, 0.06, 12, 1, false, 0, Math.PI);
    band.rotateZ(Math.PI / 2);
    parts.push(['iron', tf(band, { x, z: 0.31 })]);
  }
  return parts;
}

function statue(rng, small = false) {
  const parts = [];
  const s = small ? 0.6 : 1;
  parts.push(['trim', tf(box(1.6 * s, 1.0 * s, 1.6 * s), { y: 0.5 * s })]);
  parts.push(['trim', tf(box(1.8 * s, 0.15 * s, 1.8 * s), { y: 1.05 * s })]);
  // robed figure holding a sword
  const robePts = [];
  for (let i = 0; i <= 8; i++) { const t = i / 8; robePts.push(new THREE.Vector2(0.55 - t * 0.3 + Math.sin(t * 3) * 0.05, t * 2.2)); }
  parts.push(['stone', tf(new THREE.LatheGeometry(robePts, leanProps ? 8 : 12), { y: 1.1 * s, sx: s, sy: s, sz: s })]);
  parts.push(['stone', tf(leanProps ? sph(0.25, 7, 5) : sph(0.25, 10, 8), { y: (1.1 + 2.45) * s, sx: s, sy: s, sz: s })]);
  parts.push(['stone', tf(box(0.9, 0.3, 0.4), { y: (1.1 + 1.9) * s, sx: s, sy: s, sz: s })]);
  parts.push(['stone', tf(box(0.1, 1.6, 0.04), { y: (1.1 + 0.9) * s, z: 0.35 * s, sx: s, sy: s, sz: s })]);
  parts.push(['stone', tf(box(0.4, 0.06, 0.06), { y: (1.1 + 1.6) * s, z: 0.35 * s, sx: s, sy: s, sz: s })]);
  return parts;
}

function well() {
  const parts = [];
  const ring = cylUV(cyl(1.0, 1.05, 0.9, 16, true), 6, 0.9);
  parts.push(['trim', tf(ring, { y: 0.45 })]);
  const inner = cyl(0.82, 0.82, 0.9, 16, true);
  inner.scale(-1, 1, 1);
  parts.push(['trim', tf(inner, { y: 0.45 })]);
  parts.push(['trim', tf(new THREE.RingGeometry(0.82, 1.06, 16), { y: 0.9, rx: -Math.PI / 2 })]);
  parts.push(['decalDark', tf(new THREE.CircleGeometry(0.82, 16), { y: 0.3, rx: -Math.PI / 2 })]);
  for (const x of [-0.95, 0.95]) parts.push(['wood', tf(box(0.14, 2.2, 0.14), { x, y: 1.1 })]);
  parts.push(['wood', tf(cyl(0.06, 0.06, 2.1, 6), { y: 1.9, rz: Math.PI / 2 })]);
  const roof = new THREE.ConeGeometry(1.5, 0.9, 4, 1);
  parts.push(['roof', tf(roof, { y: 2.6, ry: Math.PI / 4, sz: 0.7 })]);
  parts.push(['wood', tf(bucket()[0][1], { y: 1.2 })]);
  return parts;
}
function fountain() {
  const parts = [];
  const basin = cylUV(cyl(2.2, 2.3, 0.7, 24, true), 12, 0.7);
  parts.push(['trim', tf(basin, { y: 0.35 })]);
  const inner = cyl(2.0, 2.0, 0.7, 24, true); inner.scale(-1, 1, 1);
  parts.push(['trim', tf(inner, { y: 0.35 })]);
  parts.push(['trim', tf(new THREE.RingGeometry(2.0, 2.3, 24), { y: 0.7, rx: -Math.PI / 2 })]);
  parts.push(['waterFlat', tf(new THREE.CircleGeometry(2.0, 24), { y: 0.5, rx: -Math.PI / 2 })]);
  parts.push(['trim', tf(cyl(0.3, 0.45, 1.8, 10), { y: 1.2 })]);
  parts.push(['trim', tf(cyl(0.9, 0.3, 0.3, 14), { y: 2.1 })]);
  parts.push(['stone', tf(sph(0.3, 10, 8), { y: 2.5 })]);
  return parts;
}
function tree(rng, dead = false) {
  const parts = [];
  // gnarled trunk built from tube segments
  const trunkPts = [];
  let x = 0, z = 0;
  for (let i = 0; i <= 6; i++) {
    trunkPts.push(new THREE.Vector3(x, i * 0.9, z));
    x += (rng() - 0.5) * 0.3; z += (rng() - 0.5) * 0.3;
  }
  const curve = new THREE.CatmullRomCurve3(trunkPts);
  const trunk = new THREE.TubeGeometry(curve, 12, 0.3, 8, false);
  // taper
  const p = trunk.getAttribute('position');
  for (let i = 0; i < p.count; i++) {
    const t = p.getY(i) / 5.4;
    const pt = curve.getPoint(Math.min(1, Math.max(0, t)));
    const k = 1.25 - t * 0.85;
    p.setX(i, pt.x + (p.getX(i) - pt.x) * k);
    p.setZ(i, pt.z + (p.getZ(i) - pt.z) * k);
  }
  trunk.computeVertexNormals();
  scaleUV(trunk, 2);
  parts.push(['bark', trunk]);
  // roots
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + rng();
    parts.push(['bark', tf(new THREE.ConeGeometry(0.18, 1.2, 6), { x: Math.cos(a) * 0.4, y: 0.15, z: Math.sin(a) * 0.4, rz: Math.cos(a) * 1.2, rx: -Math.sin(a) * 1.2 })]);
  }
  // branches
  const nb = dead ? 7 : 5;
  for (let i = 0; i < nb; i++) {
    const y0 = 2.2 + rng() * 3;
    const a = rng() * Math.PI * 2;
    const len = 1.2 + rng() * 1.6;
    const pts = [new THREE.Vector3(0, y0, 0)];
    let bx = 0, by = y0, bz = 0;
    for (let s = 1; s <= 3; s++) {
      bx += Math.cos(a) * len / 3 + (rng() - 0.5) * 0.3;
      bz += Math.sin(a) * len / 3 + (rng() - 0.5) * 0.3;
      by += 0.25 + rng() * 0.3;
      pts.push(new THREE.Vector3(bx, by, bz));
    }
    const br = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 5, 0.08, 5, false);
    parts.push(['bark', br]);
    if (!dead) {
      for (let k = 0; k < 3; k++) {
        const g = jitter(new THREE.IcosahedronGeometry(0.7 + rng() * 0.5, 1), 0.15, rng);
        parts.push(['leaves', colorize(tf(g, { x: bx + (rng() - 0.5), y: by + (rng() - 0.3) * 0.6, z: bz + (rng() - 0.5) }), 0x2a3a1a)]);
      }
    }
  }
  if (!dead) {
    for (let k = 0; k < 4; k++) {
      const g = jitter(new THREE.IcosahedronGeometry(1.2 + rng() * 0.5, 1), 0.2, rng);
      parts.push(['leaves', colorize(tf(g, { x: (rng() - 0.5) * 1.5, y: 5.6 + rng() * 1.2, z: (rng() - 0.5) * 1.5 }), 0x24331a)]);
    }
  }
  return parts;
}
function grave(rng) {
  const parts = [];
  const g = jitter(box(0.7, 1.0, 0.18), 0.02, rng);
  parts.push(['stone', tf(g, { y: 0.45, rz: (rng() - 0.5) * 0.25, rx: (rng() - 0.5) * 0.2 })]);
  parts.push(['stone', tf(cyl(0.35, 0.35, 0.18, 10, false), { y: 0.95, rx: Math.PI / 2, sy: 1 })]);
  parts.push(['dirtMat', tf(box(0.8, 0.12, 1.8), { y: 0.06, z: 1.0 })]);
  return parts;
}
function hayCart(rng) {
  const parts = [];
  parts.push(['wood', tf(box(1.4, 0.1, 2.4), { y: 0.7 })]);
  for (const s of [-1, 1]) parts.push(['wood', tf(box(0.06, 0.5, 2.4), { x: s * 0.7, y: 0.95 })]);
  for (const s of [-1, 1]) {
    const wheel = tor(0.45, 0.06, 5, 12);
    parts.push(['wood', tf(wheel, { x: s * 0.8, y: 0.5, z: -0.6, ry: Math.PI / 2 })]);
    for (let k = 0; k < 4; k++) parts.push(['wood', tf(box(0.05, 0.85, 0.05), { x: s * 0.8, y: 0.5, z: -0.6, rx: (k / 4) * Math.PI })]);
  }
  parts.push(['wood', tf(box(0.1, 0.1, 1.8), { y: 0.6, z: 1.9, rx: 0.3 })]);
  const g = jitter(sph(0.8, 10, 6), 0.1, rng);
  g.scale(0.9, 0.6, 1.4);
  parts.push(['cloth', colorize(tf(g, { y: 1.1 }), 0xa08040)]);
  return parts;
}
function cart() { return hayCart(Math.random).filter((p) => p[0] !== 'cloth'); }
// a wagon that lost a wheel: the bed lists onto its axle, the wheel lies in the grass
function brokenWagon(rng) {
  const parts = [];
  const tilt = 0.2 + rng() * 0.1;
  const bed = [['wood', box(1.4, 0.1, 2.4), 0, 0.62, 0], ['wood', box(0.06, 0.45, 2.4), 0.7, 0.85, 0], ['wood', box(0.06, 0.45, 2.4), -0.7, 0.85, 0], ['wood', box(1.4, 0.45, 0.06), 0, 0.85, -1.2]];
  for (const [k, g, x, y, z] of bed) parts.push([k, tf(g, { x, y: y - 0.12, z, rz: tilt })]);
  // the surviving wheel, spokes and hub
  parts.push(['wood', tf(tor(0.45, 0.06, 5, 12), { x: 0.8, y: 0.5, z: -0.6, ry: Math.PI / 2 })]);
  for (let k = 0; k < 4; k++) parts.push(['wood', tf(box(0.05, 0.85, 0.05), { x: 0.8, y: 0.5, z: -0.6, rx: (k / 4) * Math.PI })]);
  parts.push(['iron', tf(cyl(0.08, 0.08, 0.16, 8), { x: 0.8, y: 0.5, z: -0.6, rz: Math.PI / 2 })]);
  // the lost one, flat in the grass, and a snapped spoke
  parts.push(['wood', tf(tor(0.45, 0.06, 5, 12), { x: -1.25, y: 0.06, z: 0.5, rx: Math.PI / 2 })]);
  for (let k = 0; k < 3; k++) parts.push(['wood', tf(box(0.05, 0.85, 0.05), { x: -1.25, y: 0.07, z: 0.5, rx: Math.PI / 2, rz: (k / 3) * Math.PI })]);
  parts.push(['wood', tf(box(0.05, 0.4, 0.05), { x: -0.6, y: 0.03, z: 1.1, rz: Math.PI / 2, ry: 0.7 })]);
  // the shafts dropped to the ground, loose boards and spilled sacks
  for (const s of [-0.35, 0.35]) parts.push(['wood', tf(box(0.08, 0.08, 1.7), { x: s, y: 0.25, z: 1.85, rx: 0.28 })]);
  parts.push(['wood', tf(box(0.24, 0.04, 1.3), { x: -1.0, y: 0.03, z: -0.9, ry: 0.5 })]);
  const sackG = jitter(sph(0.28, 8, 6), 0.04, rng); sackG.scale(1, 0.7, 1.2);
  parts.push(['cloth', colorize(tf(sackG, { x: 0.15, y: 0.7, z: 0.5 }), 0x8a7452)]);
  return parts;
}
// training dummy: a straw man bound to a post on cross feet, arms out, a sack for a head
function trainingDummy(rng) {
  const parts = [];
  for (const r of [0, Math.PI / 2]) parts.push(['wood', tf(box(0.9, 0.1, 0.12), { y: 0.05, ry: r + 0.3 })]);
  parts.push(['wood', tf(cyl(0.06, 0.07, 2.0, 7), { y: 1.0 })]);
  parts.push(['wood', tf(box(1.2, 0.09, 0.09), { y: 1.5, rz: (rng() - 0.5) * 0.15 })]);
  const body = jitter(cyl(0.24, 0.2, 0.75, 9), 0.03, rng);
  parts.push(['cloth', colorize(tf(body, { y: 1.28 }), 0xa88a4a)]);
  for (const x of [-0.5, 0.5]) parts.push(['cloth', colorize(tf(jitter(cyl(0.09, 0.08, 0.36, 6), 0.02, rng), { x, y: 1.5, rz: Math.PI / 2 }), 0x9a7c40)]);
  const head = jitter(sph(0.17, 8, 6), 0.025, rng);
  parts.push(['cloth', colorize(tf(head, { y: 1.85, sy: 1.1 }), 0x8a7a5a)]);
  for (const y of [1.05, 1.3, 1.52, 1.72]) parts.push(['cloth', colorize(tf(tor(y === 1.72 ? 0.1 : 0.22, 0.018, 3, 10), { y, rx: Math.PI / 2 }), 0x5a4428)]);
  // a battered practice shield strapped to its chest
  if (rng() < 0.6) {
    parts.push(['wood', tf(cyl(0.28, 0.28, 0.04, 10), { y: 1.3, z: 0.24, rx: Math.PI / 2 })]);
    parts.push(['iron', tf(tor(0.28, 0.02, 3, 12), { y: 1.3, z: 0.26 })]);
  }
  return parts;
}
// bales stacked against a wall, bound with twine
function hayBales(rng) {
  const parts = [];
  const bale = (x, y, z, ry) => {
    const g = jitter(box(1.0, 0.48, 0.52), 0.025, rng);
    parts.push(['cloth', colorize(tf(g, { x, y: y + 0.24, z, ry }), rng() < 0.5 ? 0xa88c48 : 0x98803e)]);
    for (const o of [-0.28, 0.28]) parts.push(['cloth', colorize(tf(box(0.03, 0.5, 0.54), { x: x + o * Math.cos(ry), y: y + 0.24, z: z - o * Math.sin(ry), ry }), 0x5a4428)]);
  };
  bale(-0.52, 0, 0, (rng() - 0.5) * 0.1);
  bale(0.52, 0, 0.02, (rng() - 0.5) * 0.1);
  bale(0.05, 0.48, 0, (rng() - 0.5) * 0.3);
  if (rng() < 0.5) bale(1.1, 0, 0.75, 1.3);
  const loose = jitter(sph(0.5, 8, 5), 0.08, rng); loose.scale(1.3, 0.25, 1);
  parts.push(['cloth', colorize(tf(loose, { x: -0.2, y: 0.03, z: 0.5 }), 0xa89048)]);
  return parts;
}
function ruinPillar(rng) {
  const parts = [];
  const h = 2 + rng() * 5;
  parts.push(['trim', tf(box(1.5, 0.4, 1.5), { y: 0.2 })]);
  parts.push(['trim', jitter(tf(cylUV(cyl(0.6, 0.65, h, 12), 3, h), { y: h / 2 + 0.4 }), 0.03, rng)]);
  parts.push(['rock', tf(jitter(new THREE.DodecahedronGeometry(0.5, 0), 0.1, rng), { x: 1.2, y: 0.3, z: 0.5 })]);
  return parts;
}
function gallows() {
  const parts = [];
  parts.push(['wood', tf(box(3.6, 0.2, 3.0), { y: 1.2 })]);
  for (const [x, z] of [[-1.7, -1.4], [1.7, -1.4], [-1.7, 1.4], [1.7, 1.4]]) parts.push(['wood', tf(box(0.2, 1.2, 0.2), { x, y: 0.6, z })]);
  parts.push(['wood', tf(box(0.25, 4.0, 0.25), { x: -1.2, y: 3.2 })]);
  parts.push(['wood', tf(box(2.4, 0.25, 0.25), { x: 0, y: 5.1 })]);
  parts.push(['wood', tf(box(0.15, 1.0, 0.15), { x: -0.8, y: 4.6, rz: -0.8 })]);
  parts.push(['rope', tf(cyl(0.025, 0.025, 1.5, 5), { x: 0.6, y: 4.3 })]);
  parts.push(['rope', tf(tor(0.13, 0.03, 5, 10), { x: 0.6, y: 3.45 })]);
  return parts;
}
function throne() {
  const parts = [];
  parts.push(['trim', tf(box(3.2, 0.5, 2.6), { y: 0.25 })]);
  parts.push(['gold', tf(box(2.0, 0.9, 1.4), { y: 0.95 })]);
  parts.push(['cloth', colorize(tf(box(1.7, 0.2, 1.3), { y: 1.48 }), 0x4a0a14)]);
  parts.push(['gold', tf(box(2.2, 4.5, 0.4), { y: 2.75, z: -0.65 })]);
  parts.push(['cloth', colorize(tf(box(1.6, 3.6, 0.06), { y: 2.9, z: -0.42 }), 0x4a0a14)]);
  for (const s of [-1, 1]) {
    parts.push(['gold', tf(box(0.25, 0.8, 1.4), { x: s * 1.0, y: 1.8 })]);
    parts.push(['gold', tf(new THREE.ConeGeometry(0.2, 1.4, 4), { x: s * 1.0, y: 5.6, z: -0.65 })]);
    parts.push(['gold', tf(sph(0.22, 8, 6), { x: s * 1.0, y: 4.95, z: -0.65 })]);
  }
  parts.push(['gold', tf(new THREE.ConeGeometry(0.3, 2.0, 4), { y: 5.9, z: -0.65 })]);
  parts.push(['bone', tf(skullGeo(), { y: 4.7, z: -0.4, sx: 2, sy: 2, sz: 2 })]);
  return parts;
}
function stainedGlass() {
  // tall gothic window on the north wall (emissive)
  const parts = [];
  const shape = new THREE.Shape();
  shape.moveTo(-1.6, 0); shape.lineTo(1.6, 0); shape.lineTo(1.6, 4.5);
  shape.quadraticCurveTo(1.6, 6.5, 0, 7.6); shape.quadraticCurveTo(-1.6, 6.5, -1.6, 4.5); shape.lineTo(-1.6, 0);
  const g = new THREE.ShapeGeometry(shape, 8);
  parts.push(['stainedGlass', tf(g, { y: -3.5, z: 0.12 })]);
  for (let i = -1; i <= 1; i++) parts.push(['iron', tf(box(0.08, 7.2, 0.06), { x: i * 0.8, y: 0.2, z: 0.15 })]);
  for (let k = 0; k < 5; k++) parts.push(['iron', tf(box(3.2, 0.08, 0.06), { y: -3.2 + k * 1.5, z: 0.15 })]);
  parts.push(['trim', tf(box(4.0, 0.4, 0.6), { y: -3.6, z: 0.2 })]);
  return parts;
}
function shrine() {
  const parts = [];
  parts.push(['trim', tf(cyl(1.3, 1.5, 0.3, 8), { y: 0.15 })]);
  parts.push(['trim', tf(cyl(1.0, 1.1, 0.3, 8), { y: 0.45 })]);
  parts.push(['trim', tf(cyl(0.35, 0.5, 1.2, 8), { y: 1.2 })]);
  const bowl = new THREE.SphereGeometry(0.6, 12, 6, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2);
  parts.push(['gold', tf(bowl, { y: 2.05 })]);
  parts.push(['gold', tf(tor(0.6, 0.04, 4, 16), { y: 2.05, rx: Math.PI / 2 })]);
  return parts;
}
function merchantStall() {
  const parts = [];
  parts.push(['wood', tf(box(3.0, 1.0, 1.0), { y: 0.5, z: 0.8 })]);
  parts.push(['cloth', colorize(tf(box(3.1, 0.04, 1.1), { y: 1.02, z: 0.8 }), 0x3a1a4a)]);
  for (const x of [-1.5, 1.5]) parts.push(['wood', tf(box(0.12, 3.0, 0.12), { x, y: 1.5, z: -0.6 })]);
  const awning = new THREE.PlaneGeometry(3.4, 2.2, 6, 2);
  parts.push(['banner', colorize(tf(awning, { y: 2.9, z: 0.4, rx: -1.1 }), 0x6a1a20)]);
  // potion bottles: dark glass with a glowing draught, a neck and a cork
  for (let i = 0; i < 5; i++) {
    const x = -1.0 + i * 0.5, z = 0.8, col = [0xc81818, 0x1840c8, 0x18b840, 0xd09018, 0x9020c8][i];
    const tall = i % 2 === 0;
    parts.push(['darkGlass', tf(sph(0.085, 10, 8), { x, y: 1.13, z, sy: tall ? 1.25 : 1 })]);
    parts.push(['glow', colorize(tf(sph(0.07, 8, 6), { x, y: 1.11, z, sy: tall ? 1.1 : 0.85 }), new THREE.Color(col).multiplyScalar(0.45))]);
    parts.push(['darkGlass', tf(cyl(0.025, 0.03, 0.09, 8), { x, y: 1.25 + (tall ? 0.03 : 0), z })]);
    parts.push(['wood', tf(cyl(0.03, 0.026, 0.04, 6), { x, y: 1.31 + (tall ? 0.03 : 0), z })]);
  }
  parts.push(['leather', colorize(tf(box(0.4, 0.06, 0.3, 2), { x: 1.0, y: 1.06, z: 0.7 }), 0x4a2a14)]);
  return parts;
}
function ladder() {
  const parts = [];
  for (const x of [-0.3, 0.3]) parts.push(['wood', tf(box(0.08, 6.5, 0.08), { x, y: 3.2 })]);
  for (let i = 0; i < 16; i++) parts.push(['wood', tf(cyl(0.025, 0.025, 0.6, 5), { y: 0.3 + i * 0.4, rz: Math.PI / 2 })]);
  parts.push(['decalDark', tf(new THREE.CircleGeometry(0.9, 12), { y: 0.02, rx: -Math.PI / 2, z: -0.3 })]);
  return parts;
}
function stairsDown() {
  const parts = [];
  for (let i = 0; i < 6; i++) parts.push(['trim', tf(box(2.4, 0.15, 0.4), { y: -0.1 - i * 0.18, z: -i * 0.35 })]);
  parts.push(['decalDark', tf(new THREE.PlaneGeometry(2.6, 2.4), { y: -1.0, z: -1.2, rx: -Math.PI / 2 })]);
  return parts;
}
function glowshrooms(rng) { return mushrooms(rng, true); }

export const PROPS = {
  barrel, keg, crate, rubble, bones, pillarSquare, pillarRound, pillarGrand, chains, sack, table, longTable, stool,
  bucket, hay, rack, cage, skeletonSit, bloodstain, puddle, grate, pitGrate, mushrooms, glowshrooms, pipe, sconce, brazier: () => brazier(false),
  brazierTall: () => brazier(true), brazierFloor, chandelier, candles, candelabra, bookPile, scrolls, armorStand, weaponRack, banner,
  painting, chest, statue, statueSmall: (r) => statue(r, true), well, fountain, tree, deadTree: (r) => tree(r, true), grave, hayCart, cart,
  ruinPillar, gallows, throne, stainedGlass, shrine, merchant: merchantStall, ladder, stairsDown, brokenWagon, trainingDummy, hayBales,
};
export { cellBars, bookshelf };

// world-space flame emitter offsets for props that carry fire
export const PROP_FLAMES = {
  brazier: [[0, 1.45, 0, 1.6]],
  brazierTall: [[0, 2.2, 0, 1.6]],
  brazierFloor: [[0, 1.45, 0, 1.6]],
  candelabra: [[-0.25, 1.82, 0, 0.3], [0, 1.84, 0, 0.3], [0.25, 1.82, 0, 0.3]],
};
