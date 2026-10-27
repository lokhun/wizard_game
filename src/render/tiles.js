import * as THREE from 'three';

// A floor's static geometry is merged into one mesh per material: a handful of draws, but nothing
// in it is ever culled (each mesh spans the whole floor) and its triangles go in build order (the
// far side of the level can be shaded before the wall in front of it). Indoors, from inside a room
// most of the level is behind walls.
//
// tiledMesh() keeps the one mesh and its one draw, but sorts its triangles into square tiles of
// `size` metres (by centroid) and draws through a dynamic index buffer: when the camera crosses
// into another tile (every few seconds, not every frame), levelPVS rewrites it to hold only the
// tiles that can be seen from there, nearest first, so the depth test turns away hidden fragments
// before they are lit. No new shader, no extension, nothing done per frame. (A BatchedMesh would
// add per-frame frustum culling but needs WEBGL_multi_draw and uploads a data texture per
// material every frame; measured, it was the slower path.)
// Returns a plain Mesh either way (untiled when too small to be worth it).

export function tiledMesh(geo, material, size = 16) {
  const index = geo.index, pos = geo.getAttribute('position');
  const triCount = (index ? index.count : pos.count) / 3;
  const vi = (t, k) => (index ? index.getX(t * 3 + k) : t * 3 + k);
  if (triCount < 600) return new THREE.Mesh(geo, material);
  const tiles = new Map();
  for (let t = 0; t < triCount; t++) {
    const a = vi(t, 0), b = vi(t, 1), c = vi(t, 2);
    const cx = (pos.getX(a) + pos.getX(b) + pos.getX(c)) / 3, cz = (pos.getZ(a) + pos.getZ(b) + pos.getZ(c)) / 3;
    const key = (Math.floor(cx / size) + 1024) * 2048 + (Math.floor(cz / size) + 1024);
    let list = tiles.get(key);
    if (!list) tiles.set(key, (list = []));
    list.push(t);
  }
  if (tiles.size < 2) return new THREE.Mesh(geo, material);
  // the source index, grouped by tile; per tile its range there, its centre and the tiles its
  // triangles reach into (a large floor or ceiling quad can span several)
  const nv = pos.count, Arr = nv > 65535 ? Uint32Array : Uint16Array;
  const src = new Arr(triCount * 3);
  const info = [];
  let o = 0;
  for (const [key, list] of tiles) {
    const start = o;
    let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
    for (const t of list) for (let k = 0; k < 3; k++) {
      const v = vi(t, k);
      src[o++] = v;
      const x = pos.getX(v), z = pos.getZ(v);
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (z < z0) z0 = z; if (z > z1) z1 = z;
    }
    const tx = Math.floor(key / 2048) - 1024, tz = (key % 2048) - 1024;
    info.push({ start, count: o - start, cx: (tx + 0.5) * size, cz: (tz + 0.5) * size, box: [Math.floor(x0 / size), Math.floor(z0 / size), Math.floor(x1 / size), Math.floor(z1 / size)] });
  }
  const g = new THREE.BufferGeometry();
  for (const name of Object.keys(geo.attributes)) g.setAttribute(name, geo.getAttribute(name));
  const idx = new THREE.BufferAttribute(src.slice(), 1);
  idx.setUsage(THREE.DynamicDrawUsage);
  g.setIndex(idx);
  g.boundingSphere = geo.boundingSphere ?? (geo.computeBoundingSphere(), geo.boundingSphere);
  geo.index = null;
  const mesh = new THREE.Mesh(g, material);
  mesh.userData.tiled = { src, info, size };
  return mesh;
}

// ---- occlusion: which tiles can be seen from which ----------------------------------------
// Indoors, walls run from floor to ceiling, so the level grid says what hides what: from a room
// you see that room and whatever the doorways and corridors open onto, not the rooms beside it.
// For every floor cell, a 2D shadowcast over the grid (walls opaque) finds the cells it can see;
// a tile's set is the union over all its floor cells (so it holds wherever the camera stands in
// it), widened by a cell for safety, and then by the neighbouring tiles' sets (the camera crosses
// into a tile a frame before the cull hears of it). Precomputed at load: a few tens of ms.
// isOpen(i): whether grid cell i can be seen through (a floor cell)
const byD = (a, b) => a.d - b.d;

export function levelPVS(level, cellSize, isOpen, size = 16, radius = 60) {
  const W = level.W, H = level.H, open = (x, y) => x >= 0 && y >= 0 && x < W && y < H && isOpen(y * W + x);
  const per = Math.round(size / cellSize);
  const TX = Math.ceil(W / per), TZ = Math.ceil(H / per), NT = TX * TZ, words = Math.ceil(NT / 32);
  const seen = new Uint8Array(W * H);
  const mark = (x, y) => { if (x >= 0 && y >= 0 && x < W && y < H) seen[y * W + x] = 1; };
  // recursive shadowcasting (one octant at a time)
  const OCT = [[1, 0, 0, 1], [0, 1, 1, 0], [0, -1, 1, 0], [-1, 0, 0, 1], [-1, 0, 0, -1], [0, -1, -1, 0], [0, 1, -1, 0], [1, 0, 0, -1]];
  const cast = (cx, cy, row, start, end, xx, xy, yx, yy) => {
    if (start < end) return;
    let newStart = 0;
    for (let j = row; j <= radius; j++) {
      let dx = -j - 1, blocked = false;
      const dy = -j;
      while (dx <= 0) {
        dx++;
        const X = cx + dx * xx + dy * xy, Y = cy + dx * yx + dy * yy;
        const lS = (dx - 0.5) / (dy + 0.5), rS = (dx + 0.5) / (dy - 0.5);
        if (start < rS) continue;
        if (end > lS) break;
        mark(X, Y);
        if (blocked) {
          if (!open(X, Y)) { newStart = rS; continue; }
          blocked = false; start = newStart;
        } else if (!open(X, Y) && j < radius) {
          blocked = true;
          cast(cx, cy, j + 1, start, lS, xx, xy, yx, yy);
          newStart = rS;
        }
      }
      if (blocked) break;
    }
  };
  const vis = Array.from({ length: NT }, () => new Uint32Array(words));
  for (let ty = 0; ty < TZ; ty++) for (let tx = 0; tx < TX; tx++) {
    seen.fill(0);
    let any = false;
    for (let y = ty * per; y < Math.min(H, (ty + 1) * per); y++) for (let x = tx * per; x < Math.min(W, (tx + 1) * per); x++) {
      if (!open(x, y)) continue;
      any = true;
      mark(x, y);
      for (const o of OCT) cast(x, y, 1, 1, 0, o[0], o[1], o[2], o[3]);
    }
    if (!any) continue;
    const m = vis[ty * TX + tx];
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      if (!seen[y * W + x]) continue;
      // (widened by a cell)
      for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
        const X = Math.min(W - 1, Math.max(0, x + ox)), Y = Math.min(H - 1, Math.max(0, y + oy));
        const t = Math.floor(Y / per) * TX + Math.floor(X / per);
        m[t >> 5] |= 1 << (t & 31);
      }
    }
  }
  // widen by the neighbouring tiles' sets
  const masks = Array.from({ length: NT }, () => new Uint32Array(words));
  for (let ty = 0; ty < TZ; ty++) for (let tx = 0; tx < TX; tx++) {
    const m = masks[ty * TX + tx];
    for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
      const X = tx + ox, Y = ty + oy;
      if (X < 0 || Y < 0 || X >= TX || Y >= TZ) continue;
      const v = vis[Y * TX + X];
      for (let w = 0; w < words; w++) m[w] |= v[w];
    }
  }
  let cur = -2;
  return {
    TX, TZ, size, masks,
    // draw only the tiles of these tiled meshes that can be seen from (x, z), nearest first; off
    // the grid (or inside a wall), all of them. Returns whether anything changed.
    apply(meshes, x, z) {
      const tx = Math.floor(x / size), tz = Math.floor(z / size);
      const t = tx >= 0 && tz >= 0 && tx < TX && tz < TZ ? tz * TX + tx : -1;
      if (t === cur) return false;
      cur = t;
      let m = t >= 0 ? masks[t] : null;
      if (m) { let any = 0; for (let w = 0; w < words; w++) any |= m[w]; if (!any) m = null; }
      const cxw = (tx + 0.5) * size, czw = (tz + 0.5) * size;
      for (const mesh of meshes) {
        const T = mesh.userData.tiled;
        if (!T) continue;
        const vis = (T.vis ??= []); // (reused: nothing allocated per re-cull)
        vis.length = 0;
        for (const f of T.info) {
          let on = !m;
          const B = f.box;
          if (!on) for (let y = B[1]; y <= B[3] && !on; y++) for (let xx = B[0]; xx <= B[2]; xx++) {
            if (xx < 0 || y < 0 || xx >= TX || y >= TZ) { on = true; break; }
            const k = y * TX + xx;
            if (m[k >> 5] & (1 << (k & 31))) { on = true; break; }
          }
          if (on) { f.d = (f.cx - cxw) ** 2 + (f.cz - czw) ** 2; vis.push(f); }
        }
        vis.sort(byD);
        const ia = mesh.geometry.index, arr = ia.array;
        let n = 0;
        for (const f of vis) { arr.set(T.src.subarray(f.start, f.start + f.count), n); n += f.count; }
        ia.clearUpdateRanges();
        ia.addUpdateRange(0, n);
        ia.needsUpdate = true;
        mesh.geometry.setDrawRange(0, n);
      }
      return true;
    },
  };
}
