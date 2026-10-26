import * as THREE from 'three';
import { GeoBuilder } from '../render/geo.js';
import { T, FLOOR, ROOM } from './levelgen.js';
import { RNG } from '../core/rng.js';

// The Oubliette's hanging things: gibbet cages with their prisoners' bones, and clusters of chains and
// meat hooks, hung from the vaults on long chains. Each is a pendulum about its point on the ceiling:
// it drifts in the draught, and a blast nearby (push) sets it swinging, the swing dying away over a few
// seconds. A cage is two meshes (its iron with its chain, and the bones), a cluster one; they share the
// level's iron and bone materials (programs already compiled with the level's), and only those near the
// eye are swung each frame.

const G = 9.8;

// a chain of links from y0 down to y1 (local), every other link turned a quarter, into gb
function chainInto(gb, x, z, y0, y1, m) {
  const link = chainInto.link ??= (() => { const t = new THREE.TorusGeometry(0.045, 0.012, 3, 6); t.scale(1, 1.6, 1); return t; })();
  const n = Math.max(1, Math.round((y0 - y1) / 0.11));
  for (let i = 0; i < n; i++) {
    m.makeRotationY(i % 2 ? Math.PI / 2 : 0).setPosition(x, y0 - (i + 0.5) * ((y0 - y1) / n), z);
    gb.addGeometry(link, m);
  }
}

// a gibbet cage hanging `len` below the pivot: iron (with its chain) and bone parts, as two geometries
function cageGeos(len, rng) {
  const iron = new GeoBuilder(), bone = new GeoBuilder(), m = new THREE.Matrix4();
  const H = 1.35, R = 0.44, top = -len, bot = top - H;
  chainInto(iron, 0, 0, 0, top + 0.32, m);
  // the hanging ring, the dome, three hoops, nine bars, a floor plate
  iron.addGeometry(new THREE.TorusGeometry(0.08, 0.018, 4, 10), m.makeRotationX(0).setPosition(0, top + 0.36, 0));
  iron.addGeometry(new THREE.ConeGeometry(R + 0.02, 0.36, 12, 1, true), m.identity().setPosition(0, top + 0.16, 0));
  const hoop = new THREE.TorusGeometry(R, 0.024, 4, 16).rotateX(Math.PI / 2);
  for (const y of [top - 0.02, top - H * 0.5, bot + 0.03]) iron.addGeometry(hoop, m.identity().setPosition(0, y, 0));
  const bar = new THREE.CylinderGeometry(0.017, 0.017, H, 4);
  for (let k = 0; k < 9; k++) { const a = (k / 9) * Math.PI * 2; iron.addGeometry(bar, m.identity().setPosition(Math.cos(a) * R, top - H / 2, Math.sin(a) * R)); }
  iron.addGeometry(new THREE.CylinderGeometry(R, R, 0.04, 14), m.identity().setPosition(0, bot, 0));
  // the prisoner: a slumped skull, a ribcage leaning on the bars, an arm bone through them
  const skull = new THREE.SphereGeometry(0.1, 8, 6).scale(1, 1.15, 1.2);
  bone.addGeometry(skull, m.makeRotationX(0.5 + rng.next() * 0.4).setPosition(0.12, bot + 0.42, 0.1));
  const rib = new THREE.TorusGeometry(0.13, 0.016, 3, 10, Math.PI * 1.2);
  for (let k = 0; k < 5; k++) bone.addGeometry(rib, m.makeRotationZ(1.2).setPosition(-0.05, bot + 0.12 + k * 0.07, -0.08));
  const spine = new THREE.CylinderGeometry(0.022, 0.022, 0.5, 4);
  bone.addGeometry(spine, m.makeRotationZ(0.35).setPosition(-0.15, bot + 0.3, -0.12));
  const limb = new THREE.CylinderGeometry(0.02, 0.016, 0.42, 4);
  bone.addGeometry(limb, m.makeRotationX(1.35).setPosition(0.2, bot + 0.08, 0.1));
  bone.addGeometry(limb, m.makeRotationZ(1.45).setPosition(R + 0.05, bot + 0.55, 0.05)); // (an arm out through the bars)
  bone.addGeometry(limb, m.makeRotationX(1.2).setPosition(-0.12, bot + 0.07, 0.18));
  return { iron: iron.build(), bone: bone.build(), bottom: len + H };
}

// a cluster of chains and hooks, the longest `len`
function chainsGeo(len, rng) {
  const iron = new GeoBuilder(), m = new THREE.Matrix4();
  const hook = new THREE.TorusGeometry(0.08, 0.016, 4, 8, Math.PI * 1.4);
  const n = 2 + rng.int(0, 2);
  for (let k = 0; k < n; k++) {
    const x = (rng.next() - 0.5) * 0.5, z = (rng.next() - 0.5) * 0.5, y1 = -len * (0.6 + rng.next() * 0.4);
    chainInto(iron, x, z, 0, y1, m);
    iron.addGeometry(hook, m.makeRotationY(rng.next() * 6).setPosition(x, y1 - 0.06, z));
  }
  return { iron: iron.build(), bottom: len };
}

// an iron lantern `len` below the pivot (its flame and light are the game's: see lanterns)
function lanternGeo(len) {
  const iron = new GeoBuilder(), m = new THREE.Matrix4();
  const top = -len, H = 0.5, W = 0.17;
  chainInto(iron, 0, 0, 0, top + 0.12, m);
  iron.addGeometry(new THREE.TorusGeometry(0.05, 0.012, 3, 8), m.identity().setPosition(0, top + 0.14, 0));
  iron.addGeometry(new THREE.ConeGeometry(W * 1.5, 0.2, 4), m.makeRotationY(Math.PI / 4).setPosition(0, top - 0.04, 0));
  for (const [x, z] of [[-W, -W], [W, -W], [W, W], [-W, W]]) iron.addGeometry(new THREE.BoxGeometry(0.03, H, 0.03), m.identity().setPosition(x, top - 0.14 - H / 2, z));
  iron.addGeometry(new THREE.BoxGeometry(W * 2 + 0.06, 0.05, W * 2 + 0.06), m.identity().setPosition(0, top - 0.14 - H, 0));
  iron.addGeometry(new THREE.BoxGeometry(W * 2 + 0.04, 0.03, W * 2 + 0.04), m.identity().setPosition(0, top - 0.15, 0));
  return { iron: iron.build(), bottom: len + 0.14 + H, flameY: top - 0.14 - H + 0.16 };
}

export class Hangers {
  constructor(scene, level, mats, { quality = 'high' } = {}) {
    this.scene = scene;
    this.list = [];
    this.lanterns = []; // ({x, y, z}: where each lantern's flame burns, for the game to light)
    this.group = new THREE.Group();
    this.group.name = 'hangers';
    scene.add(this.group);
    const rng = new RNG(level.seed + 313);
    const lo = quality === 'low';
    const open = (x, z, r) => {
      for (let dz = -r; dz <= r; dz += T) for (let dx = -r; dx <= r; dx += T) {
        const cx = Math.floor((x + dx) / T), cy = Math.floor((z + dz) / T);
        if (!level.inb(cx, cy) || level.cells[level.idx(cx, cy)] !== FLOOR) return false;
      }
      return !level.colliders.some((c) => Math.hypot(c.x - x, c.z - z) < 1.6) && !level.pits.some((p) => Math.hypot(p.x - x, p.z - z) < 2.4);
    };
    for (const room of level.rooms) {
      if (room.type === ROOM.START) continue;
      const area = room.w * room.h;
      // a lantern over the middle of the bigger rooms: their centres are otherwise lit only from the walls
      if (area >= 100) for (let t = 0; t < 12; t++) {
        const x = (room.cx / T + (rng.next() - 0.5) * room.w * 0.3) * T, z = (room.cz / T + (rng.next() - 0.5) * room.h * 0.3) * T;
        if (!open(x, z, 1)) continue;
        const i = level.idx(Math.floor(x / T), Math.floor(z / T)), floor = level.hgt[i], ceil = level.ceil[i];
        const len = ceil - floor - 3.3 - 0.64;
        if (len < 0.4) break;
        const g = lanternGeo(len), h = this._add(x, ceil, z, g, mats, rng);
        h.stiff = 0.12; // (its flame is the game's and stands still: the lantern barely sways)
        this.lanterns.push({ x, y: ceil + g.flameY, z });
        break;
      }
      const nCages = lo ? (area > 120 ? 1 : 0) : area > 200 ? 2 : area > 90 ? 1 : 0;
      const nChains = lo ? 1 : 2 + (area > 160 ? 2 : 0);
      for (let placed = 0, tries = 0; placed < nCages + nChains && tries < 40; tries++) {
        const x = (room.x + 2 + rng.next() * (room.w - 4)) * T, z = (room.y + 2 + rng.next() * (room.h - 4)) * T;
        if (!open(x, z, 2) || this.list.some((h) => Math.hypot(h.x - x, h.z - z) < 3.5)) continue;
        const i = level.idx(Math.floor(x / T), Math.floor(z / T)), floor = level.hgt[i], ceil = level.ceil[i];
        const cage = placed < nCages;
        // a cage's floor hangs 2.5-3 m over the floor, so a wizard walks under it; chains end higher
        const room4 = ceil - floor;
        const len = cage ? room4 - 2.6 - rng.next() * 0.5 - 1.35 : Math.min(room4 - 2.4, 1.2 + rng.next() * 1.6);
        if (len < 0.6) { tries += 5; continue; }
        this._add(x, ceil, z, cage ? cageGeos(len, rng) : chainsGeo(len, rng), mats, rng);
        placed++;
      }
    }
    // a winch chain let down into every oubliette, its hook somewhere in the dark below the grate
    for (const p of level.pits) {
      const i = p.i, ceil = level.ceil[i];
      const gb = new GeoBuilder(), m = new THREE.Matrix4(), y1 = -(ceil - p.y) - 1.4;
      chainInto(gb, 0.13, 0.13, 0, y1, m);
      gb.addGeometry(new THREE.TorusGeometry(0.1, 0.02, 4, 8, Math.PI * 1.4), m.identity().setPosition(0.13, y1 - 0.08, 0.13));
      const h = this._add(p.x, ceil, p.z, { iron: gb.build(), bottom: -y1 }, mats, rng);
      h.stiff = 0.15; // (threaded through the grate: it barely moves)
    }
  }

  _add(x, y, z, geos, mats, rng) {
    const root = new THREE.Group();
    root.position.set(x, y, z);
    root.rotation.y = rng.next() * Math.PI * 2;
    const pivot = new THREE.Group();
    root.add(pivot);
    pivot.add(new THREE.Mesh(geos.iron, mats.iron));
    if (geos.bone) pivot.add(new THREE.Mesh(geos.bone, mats.bone));
    this.group.add(root);
    // (the swing's length: to the cage's middle, or two thirds down the chains)
    const L = Math.max(0.8, geos.bone ? geos.bottom - 0.7 : geos.bottom * 0.66);
    const h = { x, y, z, root, pivot, w2: G / L, ax: 0, az: 0, vx: 0, vz: 0, ph: rng.next() * 6.28, stiff: 1, bottom: geos.bottom };
    this.list.push(h);
    return h;
  }

  // a blast at p (radius r, size k 0..1+): everything hanging within reach is shoved away from it.
  // Returns the hanger shoved hardest (to rattle), or null.
  push(p, r, k = 1) {
    let best = null, bestF = 0.6;
    for (const h of this.list) {
      const dx = h.x - p.x, dz = h.z - p.z, d = Math.hypot(dx, dz);
      // (measured to the swinging body, not the ceiling: a blast below a cage still reaches it)
      const dy = (h.y - h.bottom * 0.8) - p.y;
      if (d * d + dy * dy > r * r) continue;
      const f = k * h.stiff * (1 - Math.sqrt(d * d + dy * dy) / r) * 2.2 / (d + 0.5);
      // (a tilt about +z swings the bottom toward +x; about +x, toward -z)
      h.vz += dx * f; h.vx -= dz * f;
      const kick = f * Math.hypot(dx, dz);
      if (kick > bestF) { bestF = kick; best = h; }
    }
    return best;
  }

  update(dt, time, cam) {
    dt = Math.min(dt, 0.05);
    for (const h of this.list) {
      if ((h.x - cam.x) ** 2 + (h.z - cam.z) ** 2 > 1300) continue;
      // a damped pendulum, nudged by the draught
      const breeze = 0.012 * h.stiff * h.w2;
      h.vx += (-h.w2 * h.ax - 0.55 * h.vx + breeze * Math.sin(time * 0.53 + h.ph)) * dt;
      h.vz += (-h.w2 * h.az - 0.55 * h.vz + breeze * Math.sin(time * 0.41 + h.ph * 1.7)) * dt;
      h.ax += h.vx * dt; h.az += h.vz * dt;
      if (h.ax > 0.6) { h.ax = 0.6; h.vx = 0; } else if (h.ax < -0.6) { h.ax = -0.6; h.vx = 0; }
      if (h.az > 0.6) { h.az = 0.6; h.vz = 0; } else if (h.az < -0.6) { h.az = -0.6; h.vz = 0; }
      // (the swing is in world axes: undo the hanger's own turn about y)
      const c = Math.cos(h.root.rotation.y), s = Math.sin(h.root.rotation.y);
      h.pivot.rotation.set(h.ax * c - h.az * s, 0, h.ax * s + h.az * c);
    }
  }

  dispose() {
    this.scene.remove(this.group);
    this.group.traverse((o) => { if (o.isMesh) o.geometry.dispose(); });
  }
}
