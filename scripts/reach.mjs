// Verifies every room is reachable from the spawn for many seeds.
import { generateLevel, FLOOR, T } from '../src/world/levelgen.js';
let fails = 0;
for (let seed = 1; seed <= 60; seed++) for (let f = 0; f < 5; f++) {
  const L = generateLevel(seed * 977, f);
  const start = L.idx(Math.floor(L.spawn.x / T), Math.floor(L.spawn.z / T));
  const seen = new Uint8Array(L.W * L.H);
  const q = [start]; seen[start] = 1;
  while (q.length) {
    const i = q.pop(); const x = i % L.W, y = (i / L.W) | 0;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy; if (!L.inb(nx, ny)) continue;
      const ni = L.idx(nx, ny);
      if (seen[ni] || L.cells[ni] !== FLOOR) continue;
      if (Math.abs(L.hgt[ni] - L.hgt[i]) > 0.75) continue;
      seen[ni] = 1; q.push(ni);
    }
  }
  for (const r of L.rooms) {
    const c = L.idx(Math.floor(r.cx / T), Math.floor(r.cz / T));
    let ok = false;
    for (let y = r.y; y < r.y + r.h && !ok; y++) for (let x = r.x; x < r.x + r.w; x++) if (seen[L.idx(x, y)]) { ok = true; break; }
    if (!ok) { fails++; console.log('unreachable', seed * 977, f, r.id, r.type); }
    void c;
  }
}
console.log('reachability fails:', fails);
