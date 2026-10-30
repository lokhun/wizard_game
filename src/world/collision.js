import { T, FLOOR } from './levelgen.js';

// Grid-based collision for the level plus circle/segment colliders for
// pillars, props and cell bars. All queries are in world metres.
export const STEP = 0.75;

export class Collision {
  constructor(level) {
    this.level = level;
    this.dyn = new Uint8Array(level.W * level.H); // door blockers (1: shut, blocks sight too)
    for (const pit of level.pits ?? []) this.dyn[pit.i] = 2; // (a grated shaft: no feet, but sight and shots pass)
    // spatial hash of static circle/segment colliders
    this.hash = new Map();
    for (const c of level.colliders) this._insert(c);
    this.dynamic = []; // extra circle colliders (ice walls etc): {x,z,r,ttl}
  }
  _key(cx, cy) { return cx * 4096 + cy; }
  _insert(c) {
    let x0, x1, z0, z1;
    if (c.seg) { [x0, z0, x1, z1] = c.seg; if (x0 > x1) [x0, x1] = [x1, x0]; if (z0 > z1) [z0, z1] = [z1, z0]; x0 -= 0.3; x1 += 0.3; z0 -= 0.3; z1 += 0.3; }
    else { x0 = c.x - c.r; x1 = c.x + c.r; z0 = c.z - c.r; z1 = c.z + c.r; }
    for (let cy = Math.floor(z0 / T); cy <= Math.floor(z1 / T); cy++) for (let cx = Math.floor(x0 / T); cx <= Math.floor(x1 / T); cx++) {
      const k = this._key(cx, cy);
      if (!this.hash.has(k)) this.hash.set(k, []);
      this.hash.get(k).push(c);
    }
  }
  removeCollider(c) {
    for (const list of this.hash.values()) {
      const i = list.indexOf(c);
      if (i >= 0) list.splice(i, 1);
    }
  }
  setDoorBlocked(door, blocked) {
    for (const i of door.cells) this.dyn[i] = blocked ? 1 : 0;
  }

  cellBlocked(cx, cy, feetY) {
    const L = this.level;
    if (!L.inb(cx, cy)) return true;
    const i = cy * L.W + cx;
    if (L.cells[i] !== FLOOR || this.dyn[i]) return true;
    return L.hgt[i] - feetY > STEP;
  }
  // blocks projectiles / line of sight (ignores height steps)
  cellOpaque(cx, cy) {
    const L = this.level;
    if (!L.inb(cx, cy)) return true;
    const i = cy * L.W + cx;
    return L.cells[i] !== FLOOR || this.dyn[i] === 1;
  }

  // Move a circle of radius r with feet at y from (x,z) by (dx,dz). Returns {x,z,hit}
  move(x, z, y, dx, dz, r) {
    let hit = false;
    // substep to avoid tunnelling
    const steps = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dz)) / (r * 0.8)));
    const sx = dx / steps, sz = dz / steps;
    for (let s = 0; s < steps; s++) {
      // a body overlapping a wall cell beside it (a prop's push, a big body squeezed through a
      // gap) is first eased out of it along its own row or column: the axis checks below assume
      // it isn't, and read a wall beside it as one ahead (they snapped a slime 1.7 m into a wall)
      const ccx = Math.floor(x / T), ccz = Math.floor(z / T);
      if (!this.cellBlocked(ccx, ccz, y)) {
        if (this.cellBlocked(Math.floor((x + r) / T), ccz, y)) x = Math.min(x, (ccx + 1) * T - r - 0.001);
        if (this.cellBlocked(Math.floor((x - r) / T), ccz, y)) x = Math.max(x, ccx * T + r + 0.001);
        if (this.cellBlocked(ccx, Math.floor((z + r) / T), y)) z = Math.min(z, (ccz + 1) * T - r - 0.001);
        if (this.cellBlocked(ccx, Math.floor((z - r) / T), y)) z = Math.max(z, ccz * T + r + 0.001);
      }
      const bx = x, bz = z;
      // X axis (a wall ahead stops the body at it, never sends it back past where it stood)
      let nx = x + sx;
      if (sx !== 0) {
        const edge = nx + Math.sign(sx) * r;
        const cx = Math.floor(edge / T);
        const z0 = Math.floor((z - r + 0.01) / T), z1 = Math.floor((z + r - 0.01) / T);
        for (let cy = z0; cy <= z1; cy++) {
          if (this.cellBlocked(cx, cy, y)) {
            nx = sx > 0 ? Math.max(x, cx * T - r - 0.001) : Math.min(x, (cx + 1) * T + r + 0.001);
            hit = true;
            break;
          }
        }
      }
      x = nx;
      let nz = z + sz;
      if (sz !== 0) {
        const edge = nz + Math.sign(sz) * r;
        const cy = Math.floor(edge / T);
        const x0 = Math.floor((x - r + 0.01) / T), x1 = Math.floor((x + r - 0.01) / T);
        for (let cx = x0; cx <= x1; cx++) {
          if (this.cellBlocked(cx, cy, y)) {
            nz = sz > 0 ? Math.max(z, cy * T - r - 0.001) : Math.min(z, (cy + 1) * T + r + 0.001);
            hit = true;
            break;
          }
        }
      }
      z = nz;
      // circle & segment colliders
      const p = this.pushOut(x, z, r);
      if (p) {
        hit = true;
        // a prop's push must never shove the body into a wall cell (in a doorway a pillar or rail
        // could push it back across the cell edge). Keep whichever axis of the push is clear of the
        // wall, so the body slides along it; only when neither is, undo this substep. (Undoing it
        // outright froze a wizard wedged between a wall and a prop: every step it tried was undone.)
        const m = Math.min(0.2, r * 0.5);
        if (!this._wallNear(p.x, p.z, m, y)) { x = p.x; z = p.z; }
        else if (!this._wallNear(p.x, z, m, y)) x = p.x;
        else if (!this._wallNear(x, p.z, m, y)) z = p.z;
        else { x = bx; z = bz; break; }
        // a gap between two props narrower than the body: it doesn't squeeze in (but one already
        // wedged there, as it spawned or was knocked, may still work its way out)
        if (this._pushOnce(x, z, r - 0.08) && !this._pushOnce(bx, bz, r - 0.08)) { x = bx; z = bz; break; }
      }
    }
    return { x, z, hit };
  }

  // is any blocked cell within m of (x, z) (a small box around the centre)?
  _wallNear(x, z, m, y) {
    return this.cellBlocked(Math.floor((x - m) / T), Math.floor((z - m) / T), y) || this.cellBlocked(Math.floor((x + m) / T), Math.floor((z - m) / T), y)
      || this.cellBlocked(Math.floor((x - m) / T), Math.floor((z + m) / T), y) || this.cellBlocked(Math.floor((x + m) / T), Math.floor((z + m) / T), y);
  }

  // push a body of radius r out of the props it overlaps; a few passes, so being pushed out of one
  // into the next settles (one pass left a wizard 25 cm inside a statue beside a small prop)
  pushOut(x, z, r) {
    let moved = false;
    for (let it = 0; it < 3; it++) {
      const p = this._pushOnce(x, z, r);
      if (!p) break;
      x = p.x; z = p.z; moved = true;
    }
    return moved ? { x, z } : null;
  }

  _pushOnce(x, z, r) {
    const cx = Math.floor(x / T), cy = Math.floor(z / T);
    let moved = false;
    for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
      const list = this.hash.get(this._key(cx + ox, cy + oy));
      if (!list) continue;
      for (const c of list) {
        if (c.seg) {
          const [ax, az, bx, bz] = c.seg;
          const abx = bx - ax, abz = bz - az;
          let t = ((x - ax) * abx + (z - az) * abz) / (abx * abx + abz * abz);
          t = Math.max(0, Math.min(1, t));
          const px = ax + abx * t, pz = az + abz * t;
          const ddx = x - px, ddz = z - pz;
          const d = Math.hypot(ddx, ddz);
          const rr = r + 0.06;
          if (d < rr && d > 1e-5) { x = px + (ddx / d) * rr; z = pz + (ddz / d) * rr; moved = true; }
        } else {
          const ddx = x - c.x, ddz = z - c.z;
          const rr = r + c.r;
          const d2 = ddx * ddx + ddz * ddz;
          if (d2 < rr * rr) {
            const d = Math.sqrt(d2) || 1e-4;
            x = c.x + (ddx / d) * rr; z = c.z + (ddz / d) * rr;
            moved = true;
          }
        }
      }
    }
    for (const c of this.dynamic) {
      const ddx = x - c.x, ddz = z - c.z;
      const rr = r + c.r;
      const d2 = ddx * ddx + ddz * ddz;
      if (d2 < rr * rr) {
        const d = Math.sqrt(d2) || 1e-4;
        x = c.x + (ddx / d) * rr; z = c.z + (ddz / d) * rr;
        moved = true;
      }
    }
    return moved ? { x, z } : null;
  }

  // is a world point inside solid geometry (for projectiles)
  pointSolid(x, y, z) {
    const L = this.level;
    const cx = Math.floor(x / T), cy = Math.floor(z / T);
    if (this.cellOpaque(cx, cy)) return true;
    const i = cy * L.W + cx;
    if (y < L.hgt[i] - 0.05) return true;
    if (y > L.ceil[i]) return true;
    // pillars block projectiles too (but not segment bars)
    const list = this.hash.get(this._key(cx, cy));
    if (list) {
      for (const c of list) {
        if (c.seg || c.r < 0.3) continue;
        const ddx = x - c.x, ddz = z - c.z;
        if (ddx * ddx + ddz * ddz < c.r * c.r && y < (c.h ?? 8)) return true;
      }
    }
    for (const c of this.dynamic) {
      const ddx = x - c.x, ddz = z - c.z;
      if (ddx * ddx + ddz * ddz < c.r * c.r && y < L.hgt[i] + (c.h ?? 3)) return true;
    }
    return false;
  }

  // march along a ray; returns distance to first solid point (or maxDist)
  raycast(ox, oy, oz, dx, dy, dz, maxDist, step = 0.15) {
    let t = 0;
    while (t < maxDist) {
      t = Math.min(maxDist, t + step);
      if (this.pointSolid(ox + dx * t, oy + dy * t, oz + dz * t)) {
        // refine
        let a = t - step, b = t;
        for (let k = 0; k < 5; k++) {
          const m = (a + b) / 2;
          if (this.pointSolid(ox + dx * m, oy + dy * m, oz + dz * m)) b = m; else a = m;
        }
        return a;
      }
    }
    return maxDist;
  }

  los(ax, ay, az, bx, by, bz) {
    const dx = bx - ax, dy = by - ay, dz = bz - az;
    const d = Math.hypot(dx, dy, dz);
    if (d < 0.01) return true;
    return this.raycast(ax, ay, az, dx / d, dy / d, dz / d, d, 0.4) >= d - 0.01;
  }

  groundAt(x, z) { return this.level.floorAt(x, z); }
}
