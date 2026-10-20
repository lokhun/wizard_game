import { generateLevel, FLOOR, BLOCK, K_WATER } from '../src/world/levelgen.js';
const seed = +(process.argv[2] ?? 1234), floor = +(process.argv[3] ?? 0);
const L = generateLevel(seed, floor);
let minX = L.W, maxX = 0, minY = L.H, maxY = 0;
for (let y = 0; y < L.H; y++) for (let x = 0; x < L.W; x++) if (L.cells[L.idx(x, y)]) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
const doorCells = new Set(L.doors.flatMap((d) => d.cells));
for (let y = minY - 1; y <= maxY + 1; y++) {
  let s = '';
  for (let x = minX - 1; x <= maxX + 1; x++) {
    const i = L.idx(x, y), c = L.cells[i];
    if (doorCells.has(i)) s += 'D';
    else if (c === FLOOR) s += L.kind[i] === K_WATER ? '~' : L.roomId[i] >= 0 ? (L.hgt[i] > 0 ? '^' : '.') : ',';
    else if (c === BLOCK) s += '#';
    else s += ' ';
  }
  console.log(s);
}
console.log(L.rooms.map((r) => `${r.id}:${r.type}${r.main ? '' : '(side)'}`).join(' '));
