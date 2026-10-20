import { T, FLOOR } from '../world/levelgen.js';

// Flow fields: BFS distance maps from a target cell over walkable cells.
// Enemies descend the gradient to reach their target around obstacles.
export class Pathing {
  constructor(level, collision) {
    this.level = level;
    this.col = collision;
    this.fields = new Map(); // key -> {dist, cell, t}
    this.queue = new Int32Array(level.W * level.H);
  }

  walk(i) {
    const L = this.level;
    return L.cells[i] === FLOOR && this.col.dyn[i] === 0;
  }

  field(tx, tz, time) {
    const L = this.level;
    const cx = Math.floor(tx / T), cy = Math.floor(tz / T);
    if (!L.inb(cx, cy)) return null;
    const key = cy * L.W + cx;
    let f = this.fields.get(key);
    if (f && time - f.t < 1.5) return f;
    const dist = f?.dist ?? new Uint16Array(L.W * L.H);
    dist.fill(65535);
    const q = this.queue;
    let head = 0, tail = 0;
    dist[key] = 0;
    q[tail++] = key;
    const W = L.W;
    const maxD = 120;
    while (head < tail) {
      const i = q[head++];
      const d = dist[i];
      if (d >= maxD) continue;
      const x = i % W, y = (i - x) / W;
      // 4-neighbours cost 2, diagonals 3 (~sqrt2)
      for (let k = 0; k < 8; k++) {
        const dx = DX[k], dy = DY[k];
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= L.H) continue;
        const ni = ny * W + nx;
        if (!this.walk(ni)) continue;
        if (dx && dy && (!this.walk(y * W + nx) || !this.walk(ny * W + x))) continue;
        // forbid big step-ups
        if (L.hgt[ni] - L.hgt[i] > 0.8) continue;
        const nd = d + (dx && dy ? 3 : 2);
        if (nd < dist[ni]) { dist[ni] = nd; q[tail++] = ni; }
      }
    }
    f = { dist, cell: key, t: time };
    this.fields.set(key, f);
    if (this.fields.size > 24) {
      // drop the oldest
      let oldK = null, oldT = Infinity;
      for (const [k, v] of this.fields) if (v.t < oldT) { oldT = v.t; oldK = k; }
      this.fields.delete(oldK);
    }
    return f;
  }

  // direction (dx,dz) to move from world pos toward the field's target
  dir(f, x, z, out) {
    const L = this.level;
    const cx = Math.floor(x / T), cy = Math.floor(z / T);
    if (!L.inb(cx, cy)) { out.x = 0; out.z = 0; return false; }
    const i = cy * L.W + cx;
    let best = f.dist[i], bi = -1;
    for (let k = 0; k < 8; k++) {
      const nx = cx + DX[k], ny = cy + DY[k];
      if (!L.inb(nx, ny)) continue;
      const ni = ny * L.W + nx;
      if (DX[k] && DY[k] && (!this.walk(cy * L.W + nx) || !this.walk(ny * L.W + cx))) continue;
      if (f.dist[ni] < best) { best = f.dist[ni]; bi = ni; }
    }
    if (bi < 0) { out.x = 0; out.z = 0; return f.dist[i] === 0; }
    const tx = (bi % L.W + 0.5) * T, tz = (Math.floor(bi / L.W) + 0.5) * T;
    const dx = tx - x, dz = tz - z;
    const d = Math.hypot(dx, dz) || 1;
    out.x = dx / d; out.z = dz / d;
    return true;
  }

  distAt(f, x, z) {
    const L = this.level;
    const cx = Math.floor(x / T), cy = Math.floor(z / T);
    if (!L.inb(cx, cy)) return 65535;
    return f.dist[cy * L.W + cx];
  }
}

const DX = [1, -1, 0, 0, 1, 1, -1, -1];
const DY = [0, 0, 1, -1, 1, -1, 1, -1];
