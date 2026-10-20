import * as THREE from 'three';
import { tubeVar, crystal, V, mulberry, helixPts, mergeGeos, xf } from './shapes.js';

// Shared building helpers for the class foci.

export function add(parent, geo, mat, o) {
  const m = new THREE.Mesh(geo, mat);
  if (o) {
    if (o.x !== undefined || o.y !== undefined || o.z !== undefined) m.position.set(o.x ?? 0, o.y ?? 0, o.z ?? 0);
    if (o.rx || o.ry || o.rz) m.rotation.set(o.rx ?? 0, o.ry ?? 0, o.rz ?? 0);
    if (o.s !== undefined) m.scale.setScalar(o.s);
    if (o.sx !== undefined) m.scale.set(o.sx, o.sy ?? o.sx, o.sz ?? o.sx);
    if (o.ro !== undefined) m.renderOrder = o.ro;
  }
  parent.add(m);
  return m;
}

export function obj(parent, x = 0, y = 0, z = 0) {
  const o = new THREE.Object3D();
  o.position.set(x, y, z);
  parent.add(o);
  return o;
}

export function grp(parent, o = {}) {
  const g = new THREE.Group();
  g.position.set(o.x ?? 0, o.y ?? 0, o.z ?? 0);
  g.rotation.set(o.rx ?? 0, o.ry ?? 0, o.rz ?? 0);
  if (o.s) g.scale.setScalar(o.s);
  if (parent) parent.add(g);
  return g;
}

// A gnarled / straight staff shaft along +Y from y0 to y1.
// opts: r (radius fn of t or number), wobble (lateral amplitude), seed, seg
export function shaftGeo(y0, y1, opts = {}) {
  const rnd = mulberry(opts.seed ?? 3);
  const n = opts.points ?? 9;
  const wob = opts.wobble ?? 0.004;
  const pts = [];
  const ph1 = rnd() * 6, ph2 = rnd() * 6;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const y = y0 + (y1 - y0) * t;
    // keep the grip region (y ~ 0) straight
    const g = Math.min(1, Math.abs(y) / 0.12);
    pts.push(V(Math.sin(t * 7 + ph1) * wob * g + (rnd() - 0.5) * wob * 0.6 * g, y, Math.cos(t * 5 + ph2) * wob * g + (rnd() - 0.5) * wob * 0.6 * g));
  }
  const rf = typeof opts.r === 'function' ? opts.r : () => opts.r ?? 0.016;
  const knots = opts.knots ?? 0;
  const kpos = Array.from({ length: knots }, () => [0.15 + rnd() * 0.8, 0.002 + rnd() * 0.004]);
  const radius = (t) => {
    let r = rf(t);
    for (const [kp, ka] of kpos) r += ka * Math.exp(-Math.pow((t - kp) * 40, 2));
    return r;
  };
  return tubeVar(pts, radius, opts.seg ?? 48, opts.rseg ?? 10, true);
}

// helical leather / cloth wrap around a cylinder of radius r between y0,y1
export function wrapGeo(r, y0, y1, turns, band = 0.003, rseg = 5, phase = 0) {
  const pts = helixPts(r + band * 0.4, y0, y1, turns, Math.max(24, Math.round(turns * 14)), phase);
  return tubeVar(pts, band, Math.max(24, Math.round(turns * 14)), rseg, true);
}

// leather grip wrap: a snug sleeve with a raised spiral strap and edge bands
export function gripWrapGeo(r, y0, y1, n = 8, band = 0.0032) {
  const h = y1 - y0;
  const sleeve = new THREE.CylinderGeometry(r + 0.0008, r + 0.0008, h, 14, 1, true);
  sleeve.translate(0, (y0 + y1) / 2, 0);
  const turns = Math.max(3, h / (band * 2.6));
  const spiral = tubeVar(helixPts(r + 0.0006, y0 + band, y1 - band, turns, Math.round(turns * 12)), band * 0.75, Math.round(turns * 12), 4, true);
  spiral.scale(1, 1, 1);
  const e0 = new THREE.TorusGeometry(r + 0.001, band * 0.9, 5, 16); xf(e0, { y: y0 + band * 0.5, rx: Math.PI / 2 });
  const e1 = new THREE.TorusGeometry(r + 0.001, band * 0.9, 5, 16); xf(e1, { y: y1 - band * 0.5, rx: Math.PI / 2 });
  void n;
  return mergeGeos([sleeve, spiral, e0, e1]);
}

// glowing gem: inner core + translucent shell, both from the same crystal geo
export function gem(parent, kit, glows, geo, color, coreColor, opts = {}) {
  const g = new THREE.Group();
  const core = kit.glow(coreColor ?? color, opts.coreK ?? 4);
  const shell = kit.shell(color, opts.opacity ?? 0.5, opts.shellK ?? 0.6);
  glows.add(core, 1); glows.add(shell, 0.6);
  const cm = add(g, geo, core, { s: opts.coreScale ?? 0.55 });
  const sm = add(g, geo, shell, { ro: 2 });
  if (opts.coreOffset) cm.position.copy(opts.coreOffset);
  parent.add(g);
  return { group: g, core, shell, coreMesh: cm, shellMesh: sm };
}

export function crystalAt(geoList, len, rad, pos, dir, seed, sides = 6) {
  const g = crystal(len, rad, sides, seed);
  const q = new THREE.Quaternion().setFromUnitVectors(V(0, 1, 0), dir.clone().normalize());
  g.applyQuaternion(q);
  g.translate(pos.x, pos.y, pos.z);
  geoList.push(g);
  return g;
}

// Group whose contents (authored in the parent's coordinates) are scaled
// uniformly about y0: lets the viewmodel use chunkier focus heads.
export function headGroup(parent, y0, s = 1) {
  const outer = new THREE.Group();
  outer.position.y = y0;
  outer.scale.setScalar(s);
  const inner = new THREE.Group();
  inner.position.y = -y0;
  outer.add(inner);
  parent.add(outer);
  return inner;
}
