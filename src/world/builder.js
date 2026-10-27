import * as THREE from 'three';
import { tiledMesh, levelPVS } from '../render/tiles.js';
// ?nocull=1: the level as one plain mesh per material (A/B tests of the occlusion cull)
const NOCULL = typeof location !== 'undefined' && /[?&]nocull=1/.test(location.search);
import { GeoBuilder, tf, worldBox } from '../render/geo.js';
import { T, SOLID, FLOOR, BLOCK, K_MAIN, K_ALT, K_WATER, K_DAIS, ROOM } from './levelgen.js';
import { PROPS, PROP_FLAMES, CHANDELIER_FLAMES, cellBars, bookshelf, setPropDetail } from './props.js';
import { getBiomeMaterials, getSharedMaterials } from './materials.js';
import { RNG } from '../core/rng.js';
import { CandleField } from '../render/candles.js';
import { Pages } from '../render/pages.js';
import { Wisps } from '../render/wisps.js';
import { SpectralCourt, SoulAsh } from '../render/court.js';
import { dressLevel, streamMaterial, streamTexture } from './dressing.js';

// ---------------------------------------------------------------------------
// Turns a generated Level into renderable meshes: floors, walls, ceilings,
// trims, pillars, door frames, portcullises, props, torches and sky.
// Static geometry is merged into one mesh per material.
// ---------------------------------------------------------------------------

export function buildLevel(level, factory, lightPool, { quality = 'high' } = {}) {
  const biome = level.biome;
  setPropDetail(quality);
  const mats = getBiomeMaterials(factory, biome);
  const group = new THREE.Group();
  group.name = 'level';
  const ownTex = []; // textures made for this floor alone (material.dispose() leaves textures be: freed in dispose())
  const builders = {};
  const B = (key) => (builders[key] ??= new GeoBuilder());
  const W = level.W, H = level.H;
  const rng = new RNG(level.seed * 31 + level.floorIndex);
  const r01 = () => rng.next();

  const isSolid = (x, y) => level.get(x, y) === SOLID;
  const walkLike = (x, y) => { const c = level.get(x, y); return c === FLOOR || c === BLOCK; };

  // ambient occlusion estimate at a world point near floor level
  const aoAt = (px, pz) => {
    let occ = 0;
    const cx = Math.floor(px / T), cz = Math.floor(pz / T);
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const x = cx + dx, y = cz + dy;
      if (!isSolid(x, y)) continue;
      const minX = x * T, maxX = minX + T, minZ = y * T, maxZ = minZ + T;
      const ddx = Math.max(minX - px, 0, px - maxX), ddz = Math.max(minZ - pz, 0, pz - maxZ);
      const d = Math.sqrt(ddx * ddx + ddz * ddz);
      occ += Math.max(0, 1 - d / 1.5) * 0.32;
    }
    return Math.max(0.32, 1 - occ);
  };

  // ---------------- floors
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (!walkLike(x, y)) continue;
    const i = level.idx(x, y);
    const h = level.hgt[i];
    const k = level.kind[i];
    const key = k === K_WATER ? 'channelBed' : (k === K_ALT || k === K_DAIS) ? 'floorAlt' : 'floor';
    const b = B(key);
    const uvS = key === 'floorAlt' && biome.floorAlt === 'carpet' ? 0.5 : 0.5;
    // 2x2 subdivision for smoother AO
    for (let sy = 0; sy < 2; sy++) for (let sx = 0; sx < 2; sx++) {
      const x0 = x * T + sx, z0 = y * T + sy, x1 = x0 + 1, z1 = z0 + 1;
      const c = [aoAt(x0, z1), aoAt(x1, z1), aoAt(x1, z0), aoAt(x0, z0)];
      b.quad([x0, h, z1], [x1, h, z1], [x1, h, z0], [x0, h, z0], [0, 1, 0],
        [[x0 * uvS, -z1 * uvS], [x1 * uvS, -z1 * uvS], [x1 * uvS, -z0 * uvS], [x0 * uvS, -z0 * uvS]], c);
    }
  }

  // ---------------- walls (cell edges between walkable and solid)
  const dirs = [
    { dx: 1, dy: 0, n: [-1, 0, 0] },
    { dx: -1, dy: 0, n: [1, 0, 0] },
    { dx: 0, dy: 1, n: [0, 0, -1] },
    { dx: 0, dy: -1, n: [0, 0, 1] },
  ];
  const damp = { sewers: [0.66, 0.8, 0.64], dungeon: [0.74, 0.72, 0.68], courtyard: [0.72, 0.8, 0.68] }[biome.id];
  const wallStrip = (b, ax, az, bx, bz, n, y0, y1, uOff, aoA = 1, aoB = 1) => {
    // vertical strip from (ax,az) to (bx,bz); subdivided in height for AO
    const len = Math.hypot(bx - ax, bz - az);
    const hs = [y0];
    for (const hh of [y0 + 0.5, y0 + 1.6]) if (hh < y1 - 0.2) hs.push(hh);
    if (y1 - 1.2 > hs[hs.length - 1] + 0.2 && !biome.outdoor) hs.push(y1 - 1.2);
    hs.push(y1);
    const shade = (yy) => {
      const fromFloor = yy - y0;
      let c = 0.42 + 0.58 * Math.min(1, fromFloor / 1.6);
      if (!biome.outdoor) c *= 0.72 + 0.28 * Math.min(1, (y1 - yy) / 1.2);
      else c *= 1 - 0.25 * Math.max(0, (yy - y0 - 4) / Math.max(1, y1 - y0 - 4));
      return c;
    };
    // rising damp: the foot of sewer and dungeon walls is stained darker (greener in the sewers)
    const C = (c, yy) => {
      if (!damp) return c;
      const k = 1 - Math.min(1, Math.max(0, (yy - y0 - 0.2) / 1.3));
      return [c * (1 + (damp[0] - 1) * k), c * (1 + (damp[1] - 1) * k), c * (1 + (damp[2] - 1) * k)];
    };
    for (let s = 0; s < hs.length - 1; s++) {
      const ya = hs[s], yb = hs[s + 1];
      const ca = shade(ya), cb = shade(yb);
      // wound b -> a so the front face points along n, into the walkable cell
      b.quad(
        [bx, ya, bz], [ax, ya, az], [ax, yb, az], [bx, yb, bz], n,
        [[(uOff + len) * 0.5, ya * 0.5], [uOff * 0.5, ya * 0.5], [uOff * 0.5, yb * 0.5], [(uOff + len) * 0.5, yb * 0.5]],
        [C(ca * aoB, ya), C(ca * aoA, ya), C(cb * aoA, yb), C(cb * aoB, yb)],
      );
    }
  };

  const trimB = B('trim');
  const wallEdges = [];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (!walkLike(x, y)) continue;
    const i = level.idx(x, y);
    const h0 = level.hgt[i];
    const h1 = biome.outdoor ? (level.roomId[i] >= 0 ? level.rooms[level.roomId[i]].ceil : biome.ceilCorr) : level.ceil[i];
    for (const d of dirs) {
      if (!isSolid(x + d.dx, y + d.dy)) continue;
      // edge endpoints, ordered so the quad faces into the cell
      let ax, az, bx, bz, u;
      const cx0 = x * T, cz0 = y * T;
      if (d.dx === 1) { ax = cx0 + T; az = cz0 + T; bx = cx0 + T; bz = cz0; u = -az; }
      else if (d.dx === -1) { ax = cx0; az = cz0; bx = cx0; bz = cz0 + T; u = az; }
      else if (d.dy === 1) { ax = cx0; az = cz0 + T; bx = cx0 + T; bz = cz0 + T; u = ax; }
      else { ax = cx0 + T; az = cz0; bx = cx0; bz = cz0; u = -ax; }
      // concave corner darkening at the ends
      const px = -d.dy, py = d.dx; // perpendicular
      const endA = isSolid(x - px * (d.dx === 1 || d.dy === -1 ? -1 : 1), y - py * (d.dx === 1 || d.dy === -1 ? -1 : 1));
      const endB = isSolid(x + px * (d.dx === 1 || d.dy === -1 ? -1 : 1), y + py * (d.dx === 1 || d.dy === -1 ? -1 : 1));
      const tintV = 0.86 + 0.14 * (((x * 73856093) ^ (y * 19349663) ^ (d.dx * 83492791 + d.dy * 4421)) >>> 0) % 1000 / 1000;
      wallStrip(B('wall'), ax, az, bx, bz, d.n, Math.min(h0, 0), h1, u, (endA ? 0.6 : 1) * tintV, (endB ? 0.6 : 1) * tintV);
      wallEdges.push({ ax, az, bx, bz, n: d.n, h0, h1, room: level.roomId[i], corr: level.corrId[i] });
      // (skirting and the cornice under the ceiling are laid per wall run by the dressing pass)
    }
    // height steps to lower neighbours
    for (const d of dirs) {
      const nx = x + d.dx, ny = y + d.dy;
      if (!walkLike(nx, ny)) continue;
      const hn = level.hgt[level.idx(nx, ny)];
      if (hn >= h0 - 0.01) continue;
      let ax, az, bx, bz, u;
      const cx0 = x * T, cz0 = y * T;
      // face points toward the lower neighbour => opposite of wall normal
      if (d.dx === 1) { ax = cx0 + T; az = cz0; bx = cx0 + T; bz = cz0 + T; u = az; }
      else if (d.dx === -1) { ax = cx0; az = cz0 + T; bx = cx0; bz = cz0; u = -az; }
      else if (d.dy === 1) { ax = cx0 + T; az = cz0 + T; bx = cx0; bz = cz0 + T; u = -ax; }
      else { ax = cx0; az = cz0; bx = cx0 + T; bz = cz0; u = ax; }
      const n = [-d.n[0], 0, -d.n[2]];
      // a tall face (a plateau's flank, a pit's wall) is built of the realm's masonry,
      // shaded darker at its foot; a step is a plain stone riser
      if (h0 - hn > 0.9) wallStrip(B('wall'), ax, az, bx, bz, n, hn, h0, u, 1, 1);
      // (wound b -> a to face the lower neighbour: the other way round was culled, and steps showed as black gaps)
      else trimB.quad([bx, hn, bz], [ax, hn, az], [ax, h0, az], [bx, h0, bz], n,
        [[(u + T) * 0.5, hn * 0.5], [u * 0.5, hn * 0.5], [u * 0.5, h0 * 0.5], [(u + T) * 0.5, h0 * 0.5]], [0.5, 0.5, 0.9, 0.9]);
      // edge lip
      const lipG = worldBox(d.dx !== 0 ? 0.25 : T, 0.12, d.dx !== 0 ? T : 0.25);
      trimB.addGeometry(lipG, new THREE.Matrix4().makeTranslation((ax + bx) / 2 - n[0] * 0.08, h0 - 0.02, (az + bz) / 2 - n[2] * 0.08), 0.9);
    }
    // lintel walls where ceilings change (corridor -> tall room)
    if (!biome.outdoor) {
      for (const d of dirs) {
        const nx = x + d.dx, ny = y + d.dy;
        if (!walkLike(nx, ny)) continue;
        const cn = level.ceil[level.idx(nx, ny)];
        if (cn >= h1 - 0.01) continue;
        let ax, az, bx, bz, u;
        const cx0 = x * T, cz0 = y * T;
        if (d.dx === 1) { ax = cx0 + T; az = cz0 + T; bx = cx0 + T; bz = cz0; u = -az; }
        else if (d.dx === -1) { ax = cx0; az = cz0; bx = cx0; bz = cz0 + T; u = az; }
        else if (d.dy === 1) { ax = cx0; az = cz0 + T; bx = cx0 + T; bz = cz0 + T; u = ax; }
        else { ax = cx0 + T; az = cz0; bx = cx0; bz = cz0; u = -ax; }
        B('wall').quad([bx, cn, bz], [ax, cn, az], [ax, h1, az], [bx, h1, bz], d.n,
          [[(u + T) * 0.5, cn * 0.5], [u * 0.5, cn * 0.5], [u * 0.5, h1 * 0.5], [(u + T) * 0.5, h1 * 0.5]], [0.7, 0.7, 0.75, 0.75]);
      }
    }
    // ceiling
    if (!biome.outdoor && mats.ceiling) {
      const c = level.ceil[i];
      const x0 = x * T, z0 = y * T, x1 = x0 + T, z1 = z0 + T;
      B('ceiling').quad([x0, c, z0], [x1, c, z0], [x1, c, z1], [x0, c, z1], [0, -1, 0],
        [[x0 * 0.5, z0 * 0.5], [x1 * 0.5, z0 * 0.5], [x1 * 0.5, z1 * 0.5], [x0 * 0.5, z1 * 0.5]], [0.6, 0.6, 0.6, 0.6]);
    }
  }

  // ---------------- outdoor wall caps with crenellations
  if (biome.outdoor) {
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      if (!isSolid(x, y)) continue;
      let maxH = -1;
      for (const d of dirs) {
        const nx = x + d.dx, ny = y + d.dy;
        if (!walkLike(nx, ny)) continue;
        const ii = level.idx(nx, ny);
        const hh = level.roomId[ii] >= 0 ? level.rooms[level.roomId[ii]].ceil : biome.ceilCorr;
        maxH = Math.max(maxH, hh);
      }
      if (maxH < 0) continue;
      const x0 = x * T, z0 = y * T;
      trimB.quad([x0, maxH, z0 + T], [x0 + T, maxH, z0 + T], [x0 + T, maxH, z0], [x0, maxH, z0], [0, 1, 0],
        [[x0 * 0.5, z0 * 0.5], [(x0 + T) * 0.5, z0 * 0.5], [(x0 + T) * 0.5, (z0 + T) * 0.5], [x0 * 0.5, (z0 + T) * 0.5]], [0.8, 0.8, 0.8, 0.8]);
      for (const d of dirs) {
        if (!walkLike(x + d.dx, y + d.dy)) continue;
        const mxp = x0 + T / 2 + d.dx * (T / 2 - 0.3), mzp = z0 + T / 2 + d.dy * (T / 2 - 0.3);
        const merlon = worldBox(d.dx ? 0.6 : 0.9, 1.1, d.dx ? 0.9 : 0.6);
        trimB.addGeometry(merlon, new THREE.Matrix4().makeTranslation(mxp, maxH + 0.55, mzp), 0.85);
      }
    }
  }

  // ---------------- door frames & portcullises
  const doors = [];
  for (const door of level.doors) {
    const room = level.rooms[door.room];
    const horizN = door.nx !== 0; // normal along x => opening spans z
    const bx = door.x - door.nx * T / 2, bz = door.z - door.ny * T / 2;
    const corrCeil = biome.outdoor ? 6 : biome.ceilCorr;
    const doorH = Math.min(corrCeil, 6);
    const openW = new Set(door.cells).size * T + 0.4; // door.cells may repeat a cell
    const halfW = openW / 2;
    // (arched portals around the opening come from the dressing pass)
    if (biome.outdoor) {
      // gatehouse bridge across the passage
      const bridge = worldBox(horizN ? 3 : openW + 1.6, 4, horizN ? openW + 1.6 : 3);
      trimB.addGeometry(bridge, new THREE.Matrix4().makeTranslation(bx + door.nx * 1.0, doorH + 2.4, bz + door.ny * 1.0), 0.85);
    }
    // portcullis (only for rooms that lock)
    const locks = room.type === ROOM.COMBAT || room.type === ROOM.ELITE || room.type === ROOM.BOSS;
    let mesh = null;
    if (locks) {
      const gb = new GeoBuilder();
      const n = Math.max(2, Math.round(openW / 0.32));
      for (let k = 0; k <= n; k++) {
        const off = -halfW + (k / n) * openW;
        const g = tf(new THREE.CylinderGeometry(0.035, 0.035, doorH, quality === 'high' || quality === 'ultra' ? 6 : 4), {});
        gb.addGeometry(g, new THREE.Matrix4().makeTranslation(horizN ? 0 : off, 0, horizN ? off : 0));
        const spike = new THREE.ConeGeometry(0.05, 0.25, quality === 'high' || quality === 'ultra' ? 6 : 4);
        spike.rotateX(Math.PI);
        gb.addGeometry(spike, new THREE.Matrix4().makeTranslation(horizN ? 0 : off, -doorH / 2 - 0.12, horizN ? off : 0));
      }
      for (let k = 0; k < 5; k++) {
        const yy = -doorH / 2 + 0.3 + k * (doorH - 0.6) / 4;
        const g = worldBox(horizN ? 0.06 : openW, 0.07, horizN ? openW : 0.06);
        gb.addGeometry(g, new THREE.Matrix4().makeTranslation(0, yy, 0));
      }
      mesh = new THREE.Mesh(gb.build(), mats.iron);
      mesh.position.set(bx + door.nx * 0.1, doorH / 2 + doorH, bz + door.ny * 0.1);
      mesh.userData.openY = doorH / 2 + doorH * 0.98;
      mesh.userData.closedY = doorH / 2 + level.hgt[door.cells[0]];
      group.add(mesh);
    }
    doors.push({ door, mesh, y: mesh ? mesh.position.y : 0, target: mesh ? mesh.position.y : 0, doorH });
  }

  // ---------------- architecture & wall dressing (piers, vaults, portals, realm set dressing)
  const decal = new GeoBuilder(); // wall/floor grime decals (one transparent atlas mesh)
  const dressed = dressLevel({ level, biome, mats, B, wallEdges, decal, quality });

  // ---------------- props
  const flames = [...dressed.flames]; // {x,y,z,size,kind}
  const tmpM = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const addParts = (parts, x, y, z, rot, scale = 1) => {
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rot);
    tmpM.compose(new THREE.Vector3(x, y, z), q, new THREE.Vector3(scale, scale, scale));
    for (const [key, geo] of parts) {
      const k = mats[key] ? key : 'wood';
      B(k).addGeometry(geo, tmpM);
    }
  };
  const interactables = [];
  const cellDoors = []; let leafGeo = null; // (the Oubliette's cell doors: openCellDoor)
  for (const p of level.props) {
    const fy = (p.y ?? 0) + (p.type === 'chandelier' ? 0 : level.floorAt(p.x, p.z));
    if (p.type === 'cellBars') {
      const fy = level.floorAt(p.x, p.z + 0.1);
      if (!p.cell) { addParts(cellBars(p.len), p.x, fy, p.z, p.rot); continue; }
      // a cell's door: two leaves hung at the ends of the opening (one merged mesh each, sharing a geometry)
      const half = p.len / 2;
      leafGeo ??= (() => { const gb = new GeoBuilder(); for (const [, geo] of cellBars(half)) gb.addGeometry(geo, new THREE.Matrix4()); return gb.build(); })();
      const base = new THREE.Group();
      base.position.set(p.x, fy, p.z); base.rotation.y = p.rot;
      const leaves = [];
      for (const sd of [-1, 1]) {
        const hinge = new THREE.Group();
        hinge.position.x = sd * half;
        const m = new THREE.Mesh(leafGeo, mats.iron);
        m.position.x = -sd * half / 2;
        hinge.add(m);
        base.add(hinge);
        leaves.push({ hinge, sd });
      }
      group.add(base);
      p.door = cellDoors.length;
      cellDoors.push({ prop: p, leaves, t: -1 });
      continue;
    }
    if (p.type === 'shelfRow') { addParts(bookshelf(p.len), p.x, level.floorAt(p.x, p.z), p.z, p.rot); continue; }
    // (only a chest the generator meant to be opened is loot: one placed as dressing is just a prop)
    if ((p.type === 'chest' && p.interact) || p.type === 'shrine' || p.type === 'merchant') {
      interactables.push(p);
      if (p.type !== 'chest') addParts(PROPS[p.type](r01), p.x, fy, p.z, p.rot ?? 0);
      continue;
    }
    // the bailey's stores and drill yard: some carts are wrecks, some racks are straw men, hay comes baled
    let type = p.type;
    if (biome.outdoor) {
      const hv = ((Math.floor(p.x * 7.3) * 73856093) ^ (Math.floor(p.z * 5.1) * 19349663)) >>> 0;
      if (type === 'cart' && hv % 3 !== 0) type = 'brokenWagon';
      else if (type === 'weaponRack' && hv % 2 === 0) type = 'trainingDummy';
      else if (type === 'hay') type = 'hayBales';
    }
    const fn = PROPS[type];
    if (!fn) continue;
    const rot = p.rot ?? 0;
    const parts = fn(r01);
    addParts(parts, p.x, p.type === 'chandelier' ? p.y : fy, p.z, rot);
    // (a stand of candles names its wicks)
    if (parts.flames) {
      const c = Math.cos(rot), sn = Math.sin(rot);
      for (const [ox, oy, oz] of parts.flames) flames.push({ x: p.x + ox * c + oz * sn, y: fy + oy, z: p.z - ox * sn + oz * c, size: 0.25, kind: 'candle', k: 0.8 });
    }
    if (PROP_FLAMES[p.type]) {
      for (const [ox, oy, oz, s] of PROP_FLAMES[p.type]) {
        const c = Math.cos(rot), sn = Math.sin(rot);
        flames.push({ x: p.x + ox * c + oz * sn, y: fy + oy, z: p.z - ox * sn + oz * c, size: s, kind: 'fire' });
      }
    }
    if (p.type === 'chandelier') {
      for (const [ox, oy, oz] of CHANDELIER_FLAMES) flames.push({ x: p.x + ox, y: p.y + oy, z: p.z + oz, size: 0.3, kind: 'candle' });
    }
    if (p.type === 'longTable') {
      for (let i = -2; i <= 2; i++) {
        const c = Math.cos(rot), sn = Math.sin(rot);
        const ox = i * 1.1 - 0.2, oz = -0.1;
        flames.push({ x: p.x + ox * c + oz * sn, y: fy + 1.18, z: p.z - ox * sn + oz * c, size: 0.25, kind: 'candle' });
      }
    }
  }

  // ---------------- wall grime: moss, water stains, cracks and smears (one merged mesh)
  if (!biome.outdoor && wallEdges.length) {
    const grime = decal;
    const gr = new RNG(level.seed * 11 + 5);
    // atlas columns (of 8): 0 water stain, 1 moss drip, 2 cracks, 3 blood smear
    const pool = { sewers: [0, 1, 1, 0, 2], dungeon: [0, 2, 2, 3, 0], keep: [0, 2, 0], throne: [2, 0] }[biome.id] ?? [0, 2];
    const density = biome.id === 'sewers' ? 0.32 : biome.id === 'dungeon' ? 0.26 : 0.14;
    for (const e of wallEdges) {
      if (gr.next() > density || e.h1 - e.h0 < 2.5) continue;
      const len = Math.hypot(e.bx - e.ax, e.bz - e.az);
      const dx = (e.bx - e.ax) / len, dz = (e.bz - e.az) / len;
      const kind = pool[gr.int(0, pool.length - 1)];
      const w = kind === 2 ? gr.range(0.8, 1.6) : gr.range(0.6, 1.3);
      const c = gr.range(0.25, 0.75);
      const off = 0.012 + gr.next() * 0.004;
      const mx = e.ax + dx * len * c + e.n[0] * off, mz = e.az + dz * len * c + e.n[2] * off;
      // stains and moss run down from the top; cracks and smears sit at body height
      let top, bot;
      if (kind === 0 || kind === 1) { top = e.h1 - gr.range(0, 0.6); bot = Math.max(e.h0 + 0.05, top - gr.range(1.6, Math.min(3.6, e.h1 - e.h0))); }
      else { const mid = e.h0 + gr.range(0.6, 2.2); top = mid + w * 0.6; bot = mid - w * 0.6; }
      const u0 = kind * 0.125, flip = gr.next() < 0.5;
      const ua = flip ? u0 + 0.125 : u0, ub = flip ? u0 : u0 + 0.125;
      const t = gr.range(0.75, 1.0);
      grime.quad([mx + dx * w * 0.5, bot, mz + dz * w * 0.5], [mx - dx * w * 0.5, bot, mz - dz * w * 0.5], [mx - dx * w * 0.5, top, mz - dz * w * 0.5], [mx + dx * w * 0.5, top, mz + dz * w * 0.5], e.n,
        [[ub, 1], [ua, 1], [ua, 0], [ub, 0]], [t, t, t, t]);
    }
  }
  if (decal.count) { const m = new THREE.Mesh(decal.build(), grimeMaterial()); m.renderOrder = 2; group.add(m); }

  // ---------------- ivy hanging from the bailey walls (one alpha-tested mesh)
  if (biome.outdoor && wallEdges.length) {
    const ivy = new GeoBuilder();
    const ir = new RNG(level.seed * 7 + 3);
    for (const e of wallEdges) {
      if (ir.next() > 0.38 || e.h1 - e.h0 < 3) continue;
      const len = Math.hypot(e.bx - e.ax, e.bz - e.az);
      const dx = (e.bx - e.ax) / len, dz = (e.bz - e.az) / len;
      const w = ir.range(1.4, 2.6), c = ir.range(0.2, 0.8);
      const mx = e.ax + dx * len * c + e.n[0] * 0.04, mz = e.az + dz * len * c + e.n[2] * 0.04;
      const top = e.h1 + 0.1, bot = Math.max(e.h0 + 0.3, top - ir.range(2.5, Math.min(6.5, e.h1 - e.h0)));
      const u0 = ir.int(0, 3) * 0.25;
      const tint = ir.range(0.7, 1.05);
      ivy.quad([mx + dx * w * 0.5, bot, mz + dz * w * 0.5], [mx - dx * w * 0.5, bot, mz - dz * w * 0.5], [mx - dx * w * 0.5, top, mz - dz * w * 0.5], [mx + dx * w * 0.5, top, mz + dz * w * 0.5], e.n,
        [[u0 + 0.25, (top - bot) / 6.5], [u0, (top - bot) / 6.5], [u0, 0], [u0 + 0.25, 0]], [tint, tint, tint, tint]);
    }
    if (ivy.count) group.add(new THREE.Mesh(ivy.build(), ivyMaterial()));
  }

  // ---------------- grime: soot above sconces, cobwebs in high corners
  {
    const soot = new GeoBuilder();
    for (const t of level.torches) {
      if (t.type !== 'sconce') continue;
      const nx = t.nx, nz = t.nz;
      const px = t.x - nx * 0.06, pz = t.z - nz * 0.06;
      const rx = -nz, rz = nx; // along the wall
      const w = 0.9, h0 = t.y - 0.1, h1 = t.y + 2.2;
      soot.quad([px - rx * w, h0, pz - rz * w], [px + rx * w, h0, pz + rz * w], [px + rx * w, h1, pz + rz * w], [px - rx * w, h1, pz - rz * w], [nx, 0, nz],
        [[0, 0], [1, 0], [1, 1], [0, 1]]);
    }
    if (soot.count) {
      const m = new THREE.Mesh(soot.build(), sootMaterial());
      m.renderOrder = 3;
      group.add(m);
    }
    if (!biome.outdoor) {
      const webs = new GeoBuilder();
      const rngW = new RNG(level.seed + 5);
      for (const room of level.rooms) {
        const corners = [[room.x, room.y, 1, 1], [room.x + room.w, room.y, -1, 1], [room.x, room.y + room.h, 1, -1], [room.x + room.w, room.y + room.h, -1, -1]];
        for (const [cx, cz, sx, sz] of corners) {
          if (!rngW.chance(0.6)) continue;
          const X = cx * T, Z = cz * T, Y = room.ceil - 0.05;
          const r = rngW.range(1.0, 2.2);
          // a triangle spanning the corner, sagging slightly
          webs.quad([X, Y, Z], [X + sx * r, Y, Z], [X + sx * r * 0.45, Y - r * 0.55, Z + sz * r * 0.45], [X, Y, Z + sz * r], [0, -1, 0],
            [[0, 1], [1, 1], [0.5, 0.2], [0, 0]]);
        }
      }
      if (webs.count) {
        const m = new THREE.Mesh(webs.build(), webMaterial());
        m.renderOrder = 3;
        group.add(m);
      }
    }
  }

  // ---------------- destructible barrels & crates (instanced so they can vanish)
  const breakMeshes = [];
  {
    const byType = { barrel: [], keg: [], crate: [] };
    for (const b of level.breakables) byType[b.type].push(b);
    for (const [type, list] of Object.entries(byType)) {
      if (!list.length) continue;
      const parts = PROPS[type](r01);
      const perMat = {};
      for (const [key, geo] of parts) (perMat[key] ??= []).push(geo);
      for (const [key, geos] of Object.entries(perMat)) {
        const gb = new GeoBuilder();
        for (const g of geos) gb.addGeometry(g, new THREE.Matrix4());
        const inst = new THREE.InstancedMesh(gb.build(), mats[key] ?? mats.wood, list.length);
        const m4 = new THREE.Matrix4();
        list.forEach((b, k) => {
          b.slot = k;
          m4.compose(new THREE.Vector3(b.x, level.floorAt(b.x, b.z), b.z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), b.rot), new THREE.Vector3(1, 1, 1));
          inst.setMatrixAt(k, m4);
        });
        inst.userData.type = type;
        group.add(inst);
        breakMeshes.push(inst);
      }
    }
  }

  // ---------------- torches
  lightPool.clearTorches();
  for (const t of level.torches) {
    if (t.type === 'sconce') {
      const rot = Math.atan2(t.nx, t.nz);
      addParts(PROPS.sconce(), t.x, t.y, t.z, rot);
      flames.push({ x: t.x + t.nx * 0.06, y: t.y + 0.05, z: t.z + t.nz * 0.06, size: 0.9, kind: 'fire', color: t.color });
      lightPool.addTorch(new THREE.Vector3(t.x + t.nx * 0.5, t.y + 0.2, t.z + t.nz * 0.5), { color: t.color ?? biome.torchColor, intensity: 30, range: 16 });
    } else if (t.type === 'brazier') {
      lightPool.addTorch(new THREE.Vector3(t.x, t.y + 0.4, t.z), { color: t.color ?? biome.torchColor, intensity: t.intensity ?? 40, range: t.range ?? 18, priority: t.priority, flicker: t.noFlame ? 0.08 : 1 });
      if (t.noFlame) continue;
      if (!flames.some((f) => Math.abs(f.x - t.x) < 0.1 && Math.abs(f.z - t.z) < 0.1)) flames.push({ x: t.x, y: t.y - 0.1, z: t.z, size: 1.6, kind: 'fire', color: t.color });
      else flames.forEach((f) => { if (Math.abs(f.x - t.x) < 0.1 && Math.abs(f.z - t.z) < 0.1) f.color = t.color; });
    } else if (t.type === 'fungus') {
      lightPool.addTorch(new THREE.Vector3(t.x, t.y, t.z), { color: t.color, intensity: t.intensity, range: t.range, flicker: 0.2 });
      flames.push({ x: t.x, y: t.y - 0.4, z: t.z, size: 0.5, kind: 'spores' });
    } else if (t.type === 'chandelier') {
      // chandeliers are a hall's key light: a mild priority over wall sconces, hung low enough to light the floor
      lightPool.addTorch(new THREE.Vector3(t.x, t.y - 0.6, t.z), { color: 0xffb060, intensity: t.intensity * 3, range: t.range + 4, flicker: 0.4, priority: 0.45 });
    }
  }

  // ---------------- candles: every candle flame on the floor is drawn on the GPU (render/candles.js), and
  // the Hall of Whispers' halls and libraries have candles floating under their vaults, drifting, a warm
  // glow over each room from the cloud of them
  const candles = new CandleField();
  for (const f of flames) {
    if (f.kind !== 'candle') continue;
    f.gpu = candles.addFlame(f.x, f.y - 0.05, f.z, { k: f.k ?? 1, color: f.color ?? null });
    f.gk = f.k ?? 1; f.s0 = f.size;
  }
  if (biome.id === 'keep') {
    const rng = new RNG((level.seed ?? 1) * 7 + 13);
    const dens = quality === 'low' ? 0.12 : quality === 'medium' ? 0.22 : 0.34;
    const chand = level.props.filter((p) => p.type === 'chandelier');
    for (const room of level.rooms) {
      if (room.type === ROOM.START || room.w < 7 || room.h < 7) continue;
      const n = Math.round(room.w * room.h * dens);
      let sx = 0, sy = 0, sz = 0, m = 0;
      for (let t = 0, tries = 0; t < n && tries < n * 4; tries++) {
        const cx = room.x + 1 + rng.next() * (room.w - 2), cz = room.y + 1 + rng.next() * (room.h - 2);
        const i = level.idx(Math.floor(cx), Math.floor(cz));
        if (level.roomId[i] !== room.id || level.cells[i] === SOLID) continue;
        const x = cx * T, z = cz * T, ceil = level.ceil[i];
        if (ceil < 6 || ceil > 30) continue;
        // clear of the chandeliers' rings
        if (chand.some((c) => (c.x - x) ** 2 + (c.z - z) ** 2 < 2.4 * 2.4)) continue;
        const y = Math.max(3.9, ceil - 1.6 - rng.next() * 2.6), h = 0.18 + rng.next() * 0.24;
        candles.addFloating(x, y, z, h, 0.026 + rng.next() * 0.01, rng.next());
        sx += x; sy += y; sz += z; m++; t++;
      }
      // the cloud's own light: soft and warm from over the middle of the room
      if (m >= 6) lightPool.addTorch(new THREE.Vector3(sx / m, sy / m - 0.4, sz / m), { color: 0xffb46a, intensity: 14 + m * 0.3, range: Math.max(room.w, room.h) * T * 0.8, flicker: 0.2, priority: 0.2 });
    }
  }
  group.add(candles.build());
  // ...and loose pages drifting down through them, let go under the vault and gone before the floor
  const pages = new Pages();
  if (biome.id === 'keep') {
    const rng = new RNG((level.seed ?? 1) * 11 + 5);
    const dens = quality === 'low' ? 0.025 : quality === 'medium' ? 0.045 : 0.07;
    const open = (x, y) => level.inb(x, y) && level.cells[level.idx(x, y)] === FLOOR;
    for (const room of level.rooms) {
      if (room.w < 7 || room.h < 7) continue;
      const n = Math.round(room.w * room.h * dens);
      for (let t = 0, tries = 0; t < n && tries < n * 5; tries++) {
        const cx = Math.floor(room.x + 1 + rng.next() * (room.w - 2)), cy = Math.floor(room.y + 1 + rng.next() * (room.h - 2));
        const i = level.idx(cx, cy);
        if (level.roomId[i] !== room.id || !open(cx, cy) || !open(cx + 1, cy) || !open(cx - 1, cy) || !open(cx, cy + 1) || !open(cx, cy - 1)) continue;
        if (level.ceil[i] < 6 || level.ceil[i] > 30) continue;
        const x = (cx + 0.3 + rng.next() * 0.4) * T, z = (cy + 0.3 + rng.next() * 0.4) * T;
        const fy = level.floorAt(x, z);
        pages.add(x, z, Math.min(level.ceil[i] - 1.2, 7.5), fy + 0.35, rng.next());
        t++;
      }
    }
  }
  const pageMesh = pages.build();
  if (pageMesh) group.add(pageMesh);
  // ...and the whispers themselves: ghost-lights wandering the halls and the library stacks
  const wisps = new Wisps();
  if (biome.id === 'keep') {
    const rng = new RNG((level.seed ?? 1) * 5 + 3);
    for (const room of level.rooms) {
      if (room.type === ROOM.START || room.w < 7 || room.h < 7) continue;
      const n = (room.layout === 'library' ? 3 : 2) - (quality === 'low' ? 1 : 0);
      for (let k = 0; k < n; k++) {
        wisps.add(room.cx + (rng.next() - 0.5) * room.w * 0.5, 2.5 + rng.next() * 0.6, room.cz + (rng.next() - 0.5) * room.h * 0.5,
          room.w * T * 0.32, room.h * T * 0.32, rng.next());
      }
    }
  }
  const wispMesh = wisps.build();
  if (wispMesh) group.add(wispMesh);

  // ---------------- the Hollow Throne's dead court (render/court.js): ghosts keeping their places in rows
  // along each hall's aisles, facing the carpet, and on their knees before the throne; and the ash of
  // souls sifting down through every room
  const court = new SpectralCourt(), ash = new SoulAsh();
  if (biome.id === 'throne') {
    const rng = new RNG((level.seed ?? 1) * 13 + 7);
    const clear = (x, z) => {
      const cx = Math.floor(x / T), cz = Math.floor(z / T);
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (!level.inb(cx + dx, cz + dy)) return false;
        const c = level.cells[level.idx(cx + dx, cz + dy)];
        if (c === SOLID && dx === 0 && dy === 0) return false;
      }
      const i = level.idx(cx, cz);
      if (level.cells[i] !== FLOOR || level.kind[i] === K_DAIS) return false;
      if (level.colliders.some((c) => Math.hypot(c.x - x, c.z - z) < (c.r ?? 0.5) + 0.75)) return false;
      if (level.props.some((q) => Math.hypot(q.x - x, q.z - z) < 0.9)) return false;
      // (standing on level ground: not astride a tier's step)
      const f = level.floorAt(x, z);
      return Math.abs(level.floorAt(x + 0.3, z) - f) < 0.05 && Math.abs(level.floorAt(x - 0.3, z) - f) < 0.05 && Math.abs(level.floorAt(x, z + 0.3) - f) < 0.05 && Math.abs(level.floorAt(x, z - 0.3) - f) < 0.05;
    };
    const person = (x, z, yaw, kneel) => {
      if (!clear(x, z)) return false;
      court.add(x, level.floorAt(x, z), z, yaw + (rng.next() - 0.5) * 0.25, { seed: rng.next(), kneel, crown: rng.next() < 0.15 ? 1 : 0, scale: 0.92 + rng.next() * 0.14 });
      return true;
    };
    const keep = quality === 'low' ? 0.5 : 1;
    for (const room of level.rooms) {
      if (room.type === ROOM.START || room.w < 7 || room.h < 7) continue;
      const cx = room.cx, z0 = room.y * T, z1 = (room.y + room.h) * T;
      if (room.layout === 'throne') {
        // kneeling in ranks before the dais, facing the throne
        for (let z = z0 + 13; z < z1 - 3; z += 2.6) for (const side of [-1, 1]) for (let k = 0; k < 3; k++) {
          if (rng.next() > 0.8 * keep) continue;
          person(cx + side * (3.4 + k * 1.7) + (rng.next() - 0.5) * 0.3, z + (rng.next() - 0.5) * 0.4, Math.PI, 1);
        }
      } else {
        // standing in a row down each side of the carpet, turned to it
        // (each place tries a few distances out from the carpet: pillars and a tier's steps take some)
        for (let z = z0 + 3; z < z1 - 3; z += 2.1) for (const side of [-1, 1]) {
          if (rng.next() > 0.8 * keep) continue;
          const jz = z + (rng.next() - 0.5) * 0.4, yaw = side < 0 ? Math.PI / 2 : -Math.PI / 2;
          for (const off of [3.4, 2.7, 4.3, 5.2]) if (person(cx + side * (off + rng.next() * 0.3), jz, yaw, 0)) break;
        }
      }
      // ash
      const n = Math.round(room.w * room.h * (quality === 'low' ? 0.06 : quality === 'medium' ? 0.1 : 0.15));
      for (let k = 0; k < n; k++) {
        const x = (room.x + 0.5 + rng.next() * (room.w - 1)) * T, z = (room.y + 0.5 + rng.next() * (room.h - 1)) * T;
        const i = level.idx(Math.floor(x / T), Math.floor(z / T));
        if (level.roomId[i] !== room.id) continue;
        ash.add(x, z, Math.min(level.ceil[i] - 0.4, 9), level.floorAt(x, z) + 0.05, 1.2, 1.2, rng.next());
      }
    }
  }
  const courtMesh = court.build(), ashMesh = ash.build();
  if (courtMesh) group.add(courtMesh);
  if (ashMesh) group.add(ashMesh);

  // ---------------- water surfaces
  // (each corner carries the way the water runs there, aFlow, from its room: along a channel, or wheeling
  // round a cistern's island; and aFoam, 1 where the corner touches anything that isn't water: the banks,
  // a bridge's piers. The water shader scrolls along the one and froths along the other.)
  {
    const pos = [], uv = [], nrm = [], flow = [], foam = [], idx = [];
    const wet = (x, y) => level.inb(x, y) && level.cells[level.idx(x, y)] === FLOOR && level.kind[level.idx(x, y)] === K_WATER;
    const SPEED = 0.55;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      if (!wet(x, y)) continue;
      const i = level.idx(x, y), room = level.rooms[level.roomId[i]];
      const x0 = x * T, z0 = y * T, x1 = x0 + T, z1 = z0 + T, h = -0.25;
      let fx = 0, fz = 0;
      if (room?.flow === 'ring') {
        const dx = (x0 + 1) - room.cx, dz = (z0 + 1) - room.cz, l = Math.hypot(dx, dz) || 1;
        fx = -dz / l * SPEED; fz = dx / l * SPEED;
      } else if (room?.flow) { fx = room.flow[0] * SPEED; fz = room.flow[1] * SPEED; }
      const v = pos.length / 3;
      for (const [cx, cy, wx, wz] of [[x, y + 1, x0, z1], [x + 1, y + 1, x1, z1], [x + 1, y, x1, z0], [x, y, x0, z0]]) {
        pos.push(wx, h, wz); nrm.push(0, 1, 0); uv.push(wx / 6, -wz / 6); flow.push(fx, fz);
        foam.push(wet(cx - 1, cy - 1) && wet(cx, cy - 1) && wet(cx - 1, cy) && wet(cx, cy) ? 0 : 1);
      }
      idx.push(v, v + 1, v + 2, v, v + 2, v + 3);
    }
    if (idx.length) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      g.setAttribute('aFlow', new THREE.Float32BufferAttribute(flow, 2));
      g.setAttribute('aFoam', new THREE.Float32BufferAttribute(foam, 1));
      g.setIndex(idx);
      const wm = new THREE.Mesh(g, mats.water);
      wm.renderOrder = 5;
      group.add(wm);
    }
  }

  // ---------------- finalise merged meshes
  const meshes = [];
  for (const [key, b] of Object.entries(builders)) {
    if (!b.count) continue;
    const mat = mats[key];
    if (!mat) continue;
    // (indoors: tiled, so the occlusion cull below can drop what walls hide)
    const mesh = NOCULL || biome.outdoor ? new THREE.Mesh(b.build(), mat) : tiledMesh(b.build(), mat);
    mesh.name = 'lvl_' + key;
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    if (mat.transparent) mesh.renderOrder = 4;
    group.add(mesh);
    meshes.push(mesh);
  }
  // indoors (walls to the ceiling) the tiles hidden behind walls are dropped (see levelPVS);
  // outdoors you see over the walls (towers, the keep), so the courtyard draws whole
  const tiled = meshes.filter((m) => m.userData.tiled);
  const t0 = performance.now();
  const pvs = tiled.length ? levelPVS(level, T, (i) => level.cells[i] !== SOLID) : null;
  if (pvs) pvs.ms = performance.now() - t0; // (50-120 ms, behind the loading veil)

  // ---------------- dressing extras: falling water (scrolling; high quality only)
  if (dressed.streams) {
    const m = new THREE.Mesh(dressed.streams.build(), streamMaterial(biome.id === 'sewers' ? 0x4a5e40 : 0x3a4048));
    m.renderOrder = 5;
    group.add(m);
  }

  // ---------------- instanced grass: thin moonlit blades in chunks (each chunk culls on its own),
  // swaying in rolling gusts that blow the same way across the whole bailey
  let grassMat = null;
  if (biome.outdoor) {
    const rg = new RNG(level.seed + 77);
    // a tuft is three crossed cards, each painted with dozens of thin blades (alpha-tested):
    // dense-looking turf for a handful of triangles. Darker at the root, as if shaded by itself.
    const card = new GeoBuilder();
    for (let k = 0; k < 3; k++) {
      const a = (k / 3) * Math.PI + 0.3, cx = Math.cos(a) * 0.45, cz = Math.sin(a) * 0.45;
      const nx = -Math.sin(a) * 0.35, nz = Math.cos(a) * 0.35, ny = 0.87;
      const v0 = card.vert(-cx, 0, -cz, nx, ny, nz, 0, 0, 0.45);
      card.vert(cx, 0, cz, nx, ny, nz, 1, 0, 0.45);
      card.vert(cx, 0.52, cz, nx, ny, nz, 1, 1, 1);
      card.vert(-cx, 0.52, -cz, nx, ny, nz, 0, 1, 1);
      card.quadIdx(v0, v0 + 1, v0 + 2, v0 + 3);
    }
    const geo = card.build();
    grassMat = new THREE.MeshStandardMaterial({ map: grassCardTexture(), alphaTest: 0.42, vertexColors: true, roughness: 0.85, side: THREE.DoubleSide });
    grassMat.userData.time = { value: 0 };
    // bodies moving through it part the grass: up to 8 (x, z, reach, 0), the wizards and the nearest foes
    grassMat.userData.push = { value: Array.from({ length: 8 }, () => new THREE.Vector4(0, 0, 0, 0)) };
    // a storm's wind drives the gusts harder and the blades flutter faster (and the wet turf is darker)
    const windK = { value: biome.storm ? 1.9 : 1 };
    if (biome.storm) grassMat.color.setScalar(0.82);
    grassMat.onBeforeCompile = (sh) => {
      sh.uniforms.uTime = grassMat.userData.time; sh.uniforms.uWindK = windK; sh.uniforms.uPush = grassMat.userData.push;
      sh.vertexShader = 'uniform float uTime; uniform float uWindK; uniform vec4 uPush[8];\n' + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
        vec4 wp = instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
        // gust fronts roll across the yard; each blade also flutters on its own
        float gust = 0.5 + 0.5 * sin(dot(wp.xz, vec2(0.11, 0.06)) - uTime * 1.15 * uWindK);
        gust = gust * gust * (0.6 + 0.4 * sin(uTime * 0.37 + wp.z * 0.05));
        float flutter = sin(uTime * 3.4 * uWindK + wp.x * 1.9 + wp.z * 1.3 + position.x * 23.0 + position.z * 17.0);
        float bend = uv.y * uv.y * mix(1.0, uWindK, 0.6);
        vec3 windW = vec3(0.07 + gust * 0.2 + flutter * 0.025, -gust * 0.05, 0.03 + gust * 0.07 + flutter * 0.015) * bend;
        // pressed aside (and down) by whatever is walking through it
        for (int i = 0; i < 8; i++) {
          vec4 q = uPush[i];
          if (q.z <= 0.0) continue;
          vec2 dv = wp.xz - q.xy; float d = length(dv);
          float k = 1.0 - smoothstep(q.z * 0.35, q.z, d);
          if (k > 0.0) { vec2 dir = dv / max(d, 1e-3); windW += vec3(dir.x * 0.32, -0.22, dir.y * 0.32) * k * uv.y * uv.y; }
        }
        // into the tuft's own frame, so every tuft leans the same way whatever its rotation
        mat3 grassIM = mat3(instanceMatrix);
        transformed += transpose(grassIM) * windW / max(1e-3, dot(grassIM[0], grassIM[0]));`);
      // both faces of a card take the same (upward-leaning) normal, so no tuft turns black from behind
      sh.fragmentShader = sh.fragmentShader.replace('#include <normal_fragment_begin>',
        THREE.ShaderChunk.normal_fragment_begin.replace('gl_FrontFacing ? 1.0 : - 1.0', '1.0'));
    };
    // per-quality density; tufts crowd thicker and taller along the foot of the walls
    const per = quality === 'low' ? 4 : quality === 'medium' ? 6 : 9;
    const chunks = new Map();
    const nearWall = (x, y) => isSolid(x + 1, y) || isSolid(x - 1, y) || isSolid(x, y + 1) || isSolid(x, y - 1);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = level.idx(x, y);
      if (level.cells[i] !== FLOOR || level.kind[i] !== K_MAIN) continue;
      const edge = nearWall(x, y);
      const n = Math.round(per * (edge ? 1.5 : 1));
      // high quality splits the turf into culled chunks; lower settings keep the single draw
      const key = quality === 'high' || quality === 'ultra' ? Math.floor(x / 40) + ',' + Math.floor(y / 40) : '0';
      let list = chunks.get(key);
      if (!list) chunks.set(key, (list = []));
      for (let k = 0; k < n; k++) {
        const px = (x + rg.next()) * T, pz = (y + rg.next()) * T;
        if (level.colliders.some((c) => c.r && (c.x - px) ** 2 + (c.z - pz) ** 2 < (c.r + 0.3) ** 2)) continue;
        list.push([px, pz, edge]);
      }
    }
    const m4 = new THREE.Matrix4(), qq = new THREE.Quaternion(), sc = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0), pv = new THREE.Vector3(), col = new THREE.Color();
    for (const spots of chunks.values()) {
      if (!spots.length) continue;
      const inst = new THREE.InstancedMesh(geo, grassMat, spots.length);
      spots.forEach(([px, pz, edge], i) => {
        qq.setFromAxisAngle(up, rg.range(0, Math.PI * 2));
        // patchy meadow: low-frequency clumps of lush, thin and withered grass
        const patch = 0.5 + 0.5 * Math.sin(px * 0.23 + Math.sin(pz * 0.17) * 2.1) * Math.sin(pz * 0.21 + 1.3);
        const k = rg.range(0.7, 1.25) * (0.75 + patch * 0.5) * (edge ? 1.2 : 1);
        sc.set(k, k * rg.range(0.6, 1.4) * (edge ? 1.25 : 1), k);
        m4.compose(pv.set(px, level.floorAt(px, pz), pz), qq, sc);
        inst.setMatrixAt(i, m4);
        const dryP = Math.max(0, 0.35 - patch * 0.5) + (rg.next() < 0.08 ? 0.5 : 0);
        col.setRGB(0.85 + rg.range(-0.12, 0.12) + dryP * 0.6, 0.95 + rg.range(-0.1, 0.12) + dryP * 0.25, 0.9 + rg.range(-0.1, 0.1) - dryP * 0.2);
        inst.setColorAt(i, col);
      });
      inst.computeBoundingSphere();
      inst.receiveShadow = true;
      group.add(inst);
    }
  }

  // ---------------- light shafts from the dressing's north windows: soft additive beams
  const shafts = []; // (each beam's volume, for the dust drifting in it: Game._ambient)
  if (dressed.shafts.length) {
    const shaftGeo = new GeoBuilder(), poolGeo = new GeoBuilder();
    // each beam falls from a moonlit window high on a north wall, slanting down into the room
    for (const sh of dressed.shafts) {
      const room = level.roomAt(sh.x, sh.z + 1);
      if (!room || room.type === 'start') continue;
      const { x, w, top } = sh, z0 = sh.z;
      const len = Math.min(room.h * T * 0.8, top * 1.4);
      const z1 = z0 + len * 0.6, bottom = 0.05;
      shafts.push({ x, w, top, z0, z1, col: null });
      // where it lands, the window lies on the floor: a pool of its light crossed by the shadows of its bars
      const pw = w + 0.7, zc = z1 - 0.35, fy = level.floorAt(x, zc) + 0.03;
      poolGeo.quad([x - pw / 2, fy, zc - 1.0], [x + pw / 2, fy, zc - 1.0], [x + pw / 2, fy, zc + 1.0], [x - pw / 2, fy, zc + 1.0], [0, 1, 0], [[0, 0], [1, 0], [1, 1], [0, 1]]);
      shaftGeo.quad([x - w / 2, top, z0], [x + w / 2, top, z0], [x + w / 2 + 0.3, bottom, z1], [x - w / 2 - 0.3, bottom, z1], [0, 0, 1], [[0, 1], [1, 1], [1, 0], [0, 0]]);
      shaftGeo.quad([x, top, z0 - w / 2 + 0.01], [x, top, z0 + w / 2], [x + 0.2, bottom, z1 + w / 2], [x + 0.2, bottom, z1 - w / 2], [1, 0, 0], [[0, 1], [1, 1], [1, 0], [0, 0]]);
    }
    if (shaftGeo.count) {
      const c = document.createElement('canvas');
      c.width = 64; c.height = 128;
      const gx = c.getContext('2d');
      const grd = gx.createLinearGradient(0, 0, 0, 128);
      grd.addColorStop(0, 'rgba(255,255,255,0.9)'); grd.addColorStop(0.6, 'rgba(255,255,255,0.35)'); grd.addColorStop(1, 'rgba(255,255,255,0)');
      gx.fillStyle = grd; gx.fillRect(0, 0, 64, 128);
      const side = gx.createLinearGradient(0, 0, 64, 0);
      side.addColorStop(0, 'rgba(0,0,0,1)'); side.addColorStop(0.3, 'rgba(0,0,0,0)'); side.addColorStop(0.7, 'rgba(0,0,0,0)'); side.addColorStop(1, 'rgba(0,0,0,1)');
      gx.globalCompositeOperation = 'destination-out'; gx.fillStyle = side; gx.fillRect(0, 0, 64, 128);
      const tex = new THREE.CanvasTexture(c);
      ownTex.push(tex);
      const col = biome.id === 'throne' ? new THREE.Color(0.22, 0.12, 0.32) : biome.id === 'dungeon' ? new THREE.Color(0.15, 0.19, 0.27) : new THREE.Color(0.14, 0.15, 0.2);
      const shaftMat = new THREE.MeshBasicMaterial({ map: tex, color: col, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: true });
      for (const sh of shafts) sh.col = col;
      const sm = new THREE.Mesh(shaftGeo.build(), shaftMat);
      sm.renderOrder = 6;
      group.add(sm);
      // the pools: a soft-edged patch with three bars' shadows down it and a crossbar's across
      const pc = document.createElement('canvas');
      pc.width = pc.height = 128;
      const px = pc.getContext('2d');
      const pr = px.createRadialGradient(64, 64, 8, 64, 64, 64);
      pr.addColorStop(0, 'rgba(255,255,255,1)'); pr.addColorStop(0.55, 'rgba(255,255,255,0.75)'); pr.addColorStop(1, 'rgba(255,255,255,0)');
      px.fillStyle = pr; px.fillRect(0, 0, 128, 128);
      px.globalCompositeOperation = 'destination-out';
      px.filter = 'blur(2px)';
      px.fillStyle = 'rgba(0,0,0,0.85)';
      for (const bx of [40, 64, 88]) px.fillRect(bx - 4, 0, 8, 128);
      px.fillRect(0, 56, 128, 7);
      const poolTex = new THREE.CanvasTexture(pc);
      ownTex.push(poolTex);
      const poolMat = new THREE.MeshBasicMaterial({ map: poolTex, color: col.clone().multiplyScalar(2.8), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: true, polygonOffset: true, polygonOffsetFactor: -2 });
      const pm = new THREE.Mesh(poolGeo.build(), poolMat);
      pm.renderOrder = 5;
      group.add(pm);

    }
  }

  // ---------------- the stained-glass window's light: its own colours stream down through the air in
  // slanted sheets and lie across the floor (and the dais) below it. Every point carries the window point
  // its light came through (aWin, in the window's own coordinates: the glass shader's cells), so the
  // colours run true along each ray; one additive draw.
  for (const pr of level.props) {
    if (pr.type !== 'stainedGlass') continue;
    const wy0 = pr.y ?? 7, z0 = pr.z + 0.2, pos = [], win = [], kk = [], idx = [];
    const vert = (x, y, z, k) => { pos.push(x, y, z); win.push(x - pr.x, y + (z - z0) - wy0); kk.push(k); return kk.length - 1; };
    const quad = (a, b, c, d) => idx.push(a, b, c, a, c, d);
    // (rays fall at 45 degrees: from window height h they reach the floor h further out)
    const bot = wy0 - 3.5, top = wy0 + 4.1;
    // sheets across the window at a few heights, down to the floor (a slab of light seen from the hall)
    for (const h of [bot + 1.2, bot + 3.2, bot + 5.2, top - 0.6]) {
      const zf = z0 + h - 0.1;
      quad(vert(pr.x - 1.6, h, z0, 0.15), vert(pr.x + 1.6, h, z0, 0.15), vert(pr.x + 1.6, 0.1, zf, 0.035), vert(pr.x - 1.6, 0.1, zf, 0.035));
    }
    // sheets along the rays at a few columns (the slab's depth, seen from the side)
    for (const x of [-1.1, 0, 1.1]) {
      const X = pr.x + x;
      quad(vert(X, bot, z0, 0.11), vert(X, top, z0, 0.11), vert(X, 0.1, z0 + top - 0.1, 0.025), vert(X, 0.1, z0 + bot - 0.1, 0.025));
    }
    // the pool: a grid draped over the floor and the dais
    const NX = 8, NZ = 24, x0 = pr.x - 2, x1 = pr.x + 2, za = z0 + bot - 0.6, zb = z0 + top + 0.4, base = kk.length;
    for (let j = 0; j <= NZ; j++) for (let i = 0; i <= NX; i++) {
      const x = x0 + (x1 - x0) * i / NX, z = za + (zb - za) * j / NZ;
      vert(x, level.floorAt(x, z) + 0.03, z, 0.55);
    }
    for (let j = 0; j < NZ; j++) for (let i = 0; i < NX; i++) { const a = base + j * (NX + 1) + i; quad(a, a + 1, a + NX + 2, a + NX + 1); }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('aWin', new THREE.Float32BufferAttribute(win, 2));
    geo.setAttribute('aK', new THREE.Float32BufferAttribute(kk, 1));
    geo.setIndex(idx);
    const mat = new THREE.ShaderMaterial({
      uniforms: { uTime: mats.stainedGlass.uniforms?.uTime ?? { value: 0 } },
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      vertexShader: `attribute vec2 aWin; attribute float aK; varying vec2 vWin; varying float vK;
        void main(){ vWin = aWin; vK = aK; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }`,
      fragmentShader: `uniform float uTime; varying vec2 vWin; varying float vK;
        vec2 h2(vec2 p){ p = vec2(dot(p, vec2(127.1,311.7)), dot(p, vec2(269.5,183.3))); return fract(sin(p)*43758.5453); }
        void main(){
          // inside the window's arch (shape: x within 1.6, y 0..7.6 from its sill, rounded over the top 3.1)
          float sy = vWin.y + 3.5, ax = abs(vWin.x);
          float halfW = sy < 4.5 ? 1.6 : 1.6 * sqrt(max(0., 1. - (sy - 4.5) * (sy - 4.5) / 9.61));
          float inside = smoothstep(-0.25, 0.25, halfW - ax) * smoothstep(-0.2, 0.2, sy) * smoothstep(-0.2, 0.2, 7.6 - sy);
          if (inside < 0.01) discard;
          // the glass shader's cells and palette
          vec2 p = vWin * vec2(2.2, 1.6);
          vec2 i = floor(p), f = fract(p);
          float d1 = 9., d2 = 9.; vec2 id = vec2(0);
          for (int y=-1;y<=1;y++) for(int x=-1;x<=1;x++){ vec2 g = vec2(x,y); vec2 o = h2(i+g); vec2 r = g + o - f; float d = dot(r,r); if (d < d1){ d2 = d1; d1 = d; id = i+g; } else if (d < d2) d2 = d; }
          float lead = smoothstep(0.02, 0.12, sqrt(d2) - sqrt(d1));
          float k = h2(id).x * 5.;
          vec3 c = k < 1. ? vec3(0.9,0.1,0.15) : k < 2. ? vec3(0.15,0.25,0.95) : k < 3. ? vec3(0.95,0.7,0.15) : k < 4. ? vec3(0.5,0.1,0.8) : vec3(0.1,0.6,0.35);
          float glow = 0.75 + 0.25 * sin(uTime * 0.7 + id.x * 1.3 + id.y);
          gl_FragColor = vec4(c * (0.35 + 0.65 * lead) * glow * inside * vK, 1.);
        }`,
    });
    const m = new THREE.Mesh(geo, mat);
    m.renderOrder = 6;
    group.add(m);
  }

  // ---------------- moonlight through ceiling grates: the start room's (where you arrive), and in the
  // Drowned Sewers the street drains over the bigger rooms. Each is an iron grate set in the vault with
  // the night sky pale above it, a beam of two crossed soft quads leaning down from it, the grate's
  // shadow-latticed pool of light where the beam lands, and a cold light.
  const grates = [...(level.startShaft ? [{ ...level.startShaft, start: true }] : []), ...(level.grates ?? [])];
  if (grates.length) {
    const c = document.createElement('canvas');
    c.width = 64; c.height = 128;
    const gx = c.getContext('2d');
    const grd = gx.createLinearGradient(0, 0, 0, 128);
    grd.addColorStop(0, 'rgba(255,255,255,0.85)'); grd.addColorStop(0.7, 'rgba(255,255,255,0.3)'); grd.addColorStop(1, 'rgba(255,255,255,0.08)');
    gx.fillStyle = grd; gx.fillRect(0, 0, 64, 128);
    const side = gx.createLinearGradient(0, 0, 64, 0);
    side.addColorStop(0, 'rgba(0,0,0,1)'); side.addColorStop(0.25, 'rgba(0,0,0,0)'); side.addColorStop(0.75, 'rgba(0,0,0,0)'); side.addColorStop(1, 'rgba(0,0,0,1)');
    gx.globalCompositeOperation = 'destination-out'; gx.fillStyle = side; gx.fillRect(0, 0, 64, 128);
    const beamTex = new THREE.CanvasTexture(c);
    ownTex.push(beamTex);
    // the pool: a soft square crossed by the grate's bars both ways
    const pc = document.createElement('canvas');
    pc.width = pc.height = 128;
    const px = pc.getContext('2d');
    const pr = px.createRadialGradient(64, 64, 10, 64, 64, 64);
    pr.addColorStop(0, 'rgba(255,255,255,1)'); pr.addColorStop(0.6, 'rgba(255,255,255,0.7)'); pr.addColorStop(1, 'rgba(255,255,255,0)');
    px.fillStyle = pr; px.fillRect(0, 0, 128, 128);
    px.globalCompositeOperation = 'destination-out';
    px.filter = 'blur(2px)';
    px.fillStyle = 'rgba(0,0,0,0.8)';
    for (let k = -2; k <= 2; k++) { px.fillRect(64 + k * 20 - 3, 0, 6, 128); px.fillRect(0, 64 + k * 20 - 3, 128, 6); }
    const poolTex = new THREE.CanvasTexture(pc);
    ownTex.push(poolTex);
    const bg = new GeoBuilder(), pg = new GeoBuilder();
    const holeMat = new THREE.MeshBasicMaterial({ color: 0x8aa0c0 });
    for (const gr of grates) {
      const { x, z } = gr;
      const ci = level.idx(Math.floor(x / T), Math.floor(z / T));
      const top = level.ceil[ci], gy = level.kind[ci] === K_WATER ? -0.25 : level.hgt[ci];
      const parts = [];
      const S = gr.start ? 1.5 : 1.1;
      for (const sgn of [-1, 1]) {
        parts.push(['iron', worldBox(S * 2 + 0.16, 0.12, 0.12).translate(0, -0.06, sgn * S)]);
        parts.push(['iron', worldBox(0.12, 0.12, S * 2).translate(sgn * S, -0.06, 0)]);
      }
      for (let i = -2; i <= 2; i++) parts.push(['iron', worldBox(0.05, 0.06, S * 2).translate(i * S * 0.4, -0.04, 0)]);
      for (let i = -2; i <= 2; i++) parts.push(['iron', worldBox(S * 2, 0.04, 0.05).translate(0, -0.03, i * S * 0.4)]);
      addParts(parts, x, top, z, 0);
      // a pale hole above the grate (the night over the street), so it reads as an opening rather than a decal
      const hole = new THREE.Mesh(new THREE.PlaneGeometry(S * 2, S * 2), holeMat);
      hole.rotation.x = Math.PI / 2; hole.position.set(x, top + 0.02, z);
      group.add(hole);
      const w = S * 1.9, w2 = S * 2.3, lean = 0.35;
      bg.quad([x - w / 2, top, z], [x + w / 2, top, z], [x + w2 / 2 + lean, gy + 0.02, z + lean], [x - w2 / 2 + lean, gy + 0.02, z + lean], [0, 0, 1], [[0, 1], [1, 1], [1, 0], [0, 0]]);
      bg.quad([x, top, z - w / 2], [x, top, z + w / 2], [x + lean, gy + 0.02, z + w2 / 2 + lean], [x + lean, gy + 0.02, z - w2 / 2 + lean], [1, 0, 0], [[0, 1], [1, 1], [1, 0], [0, 0]]);
      const P2 = S * 1.35, cx = x + lean, cz = z + lean, fy = gy + 0.035;
      pg.quad([cx - P2, fy, cz - P2], [cx + P2, fy, cz - P2], [cx + P2, fy, cz + P2], [cx - P2, fy, cz + P2], [0, 1, 0], [[0, 0], [1, 0], [1, 1], [0, 1]]);
      // a pool of cold light beneath it
      lightPool.addTorch(new THREE.Vector3(x + lean * 0.5, top - 0.8, z + lean * 0.5), { color: 0x9ab4e0, intensity: gr.start ? 22 : 18, range: 9, flicker: 0.05, priority: 0.5 });
      shafts.push({ x, w: S * 1.6, top, z0: z - 0.2, z1: z + 0.4, col: new THREE.Color(0.1, 0.12, 0.16), vertical: true });
    }
    const bm = new THREE.Mesh(bg.build(), new THREE.MeshBasicMaterial({ map: beamTex, color: new THREE.Color(0.1, 0.12, 0.16), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: true }));
    bm.renderOrder = 6;
    group.add(bm);
    const pm = new THREE.Mesh(pg.build(), new THREE.MeshBasicMaterial({ map: poolTex, color: new THREE.Color(0.22, 0.26, 0.32), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: true, polygonOffset: true, polygonOffsetFactor: -2 }));
    pm.renderOrder = 5;
    group.add(pm);
  }

  // ---------------- outdoor sky & distant keep
  let sky = null;
  if (biome.outdoor) {
    sky = makeNightSky(!!biome.storm);
    group.add(sky);
    group.add(makeDistantKeep(level, mats));
  }

  return {
    group,
    mats,
    doors,
    flames,
    candles,
    pages,
    wisps,
    court,
    shafts,
    interactables,
    sky,
    pvs,
    // before each render: show only the level tiles that can be seen from the camera's tile
    cull(camPos) { pvs?.apply(tiled, camPos.x, camPos.z); },
    update(dt, time) {
      mats.water.userData.update?.(time);
      mats.waterFlat.userData.update?.(time);
      mats.banner.userData.update?.(time);
      candles.update(time);
      pages.update(time);
      wisps.update(time);
      court.update(time);
      ash.update(time);
      if (mats.stainedGlass.uniforms) mats.stainedGlass.uniforms.uTime.value = time;
      for (const d of doors) {
        if (!d.mesh) continue;
        d.y += (d.target - d.y) * Math.min(1, dt * (d.target < d.y ? 9 : 2.5));
        d.mesh.position.y = d.y;
        if (d.dustAt > 0) {
          d.dustAt -= dt;
          if (d.dustAt <= 0 && this.onDoorSlam) this.onDoorSlam(d);
        }
      }
      if (sky) sky.material.uniforms.uTime.value = time;
      if (dressed.streams) streamTexture().offset.y = time * 1.3;
      if (grassMat) grassMat.userData.time.value = time;
      for (const d of cellDoors) {
        if (d.t < 0 || d.t > 2) continue;
        d.t += dt;
        // flung to 150 degrees, a bounce off the wall that dies away
        const t = d.t, a = 2.6 * (1 - Math.exp(-6 * t) * Math.cos(9 * t));
        for (const L of d.leaves) L.hinge.rotation.y = L.sd * d.prop.out * Math.min(2.75, a);
      }
    },
    // throw a cell's door open (its bars prop): both leaves swing out into the room and bang against
    // the wall, bouncing back a little (animated in update)
    openCellDoor(bars) {
      const d = cellDoors[bars.door];
      if (d && d.t < 0) d.t = 0;
    },
    // the bodies parting the grass this frame (see the grass shader): i < 8, reach 0 for none
    setGrassPush(i, x, z, r) {
      if (grassMat) grassMat.userData.push.value[i].set(x, z, r, 0);
    },
    hideBreakable(b) {
      const zero = new THREE.Matrix4().makeScale(0, 0, 0);
      for (const m of breakMeshes) {
        if (m.userData.type !== b.type) continue;
        m.setMatrixAt(b.slot, zero);
        m.instanceMatrix.needsUpdate = true;
      }
    },
    setDoor(doorId, closed) {
      const d = doors[doorId];
      if (!d || !d.mesh) return;
      d.target = closed ? d.mesh.userData.closedY : d.mesh.userData.openY;
      d.dustAt = closed ? 0.35 : -1;
    },
    dispose() {
      // shared prop materials live for the whole session; per-floor ones are freed here
      const shared = new Set(Object.values(getSharedMaterials(factory)));
      const seen = new Set();
      group.traverse((o) => {
        if (o.geometry) o.geometry.dispose();
        const ms = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
        for (const m of ms) if (!shared.has(m) && !seen.has(m)) { seen.add(m); m.dispose(); }
      });
      for (const t of ownTex) t.dispose();
    },
  };
}

let _soot = null, _web = null, _ivy = null, _grime = null;
// Grime decal atlas, eight 256x512 columns drawn from the top (v=0) down:
// 0 water stain, 1 moss drip, 2 cracks, 3 blood smear, 4 straw, 5 dark arched opening,
// 6 rust streak, 7 scattered parchment.
function grimeMaterial() {
  if (_grime) return _grime;
  const W = 2048, H = 512, cw = W / 8;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');
  let seed = 98765;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  // 0: water stain - soft dark vertical streaks fading downward
  for (let i = 0; i < 9; i++) {
    const x = 30 + rnd() * (cw - 60), w = 16 + rnd() * 34, len = H * (0.45 + rnd() * 0.55);
    const gr = g.createLinearGradient(0, 0, 0, len);
    gr.addColorStop(0, 'rgba(12,10,8,0.8)'); gr.addColorStop(0.65, 'rgba(12,10,8,0.4)'); gr.addColorStop(1, 'rgba(12,10,8,0)');
    g.fillStyle = gr;
    g.beginPath(); g.moveTo(x - w, 0); g.quadraticCurveTo(x - w * 0.3, len * 0.6, x + (rnd() - 0.5) * 6, len); g.quadraticCurveTo(x + w * 0.3, len * 0.6, x + w, 0); g.fill();
  }
  // 1: moss drip - a mossy cap with green-black runnels
  {
    const x0 = cw;
    for (let i = 0; i < 260; i++) {
      const x = x0 + rnd() * cw, y = rnd() * rnd() * H * 0.35, r = 3 + rnd() * 10;
      g.fillStyle = `rgba(${22 + rnd() * 18 | 0},${38 + rnd() * 30 | 0},${14 + rnd() * 10 | 0},${0.5 + rnd() * 0.4})`;
      g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
    }
    for (let i = 0; i < 14; i++) {
      const x = x0 + 12 + rnd() * (cw - 24), len = H * (0.3 + rnd() * 0.65), w = 3 + rnd() * 8;
      const gr = g.createLinearGradient(0, 0, 0, len);
      gr.addColorStop(0, 'rgba(20,34,12,0.75)'); gr.addColorStop(1, 'rgba(10,16,8,0)');
      g.fillStyle = gr; g.fillRect(x - w / 2, 0, w, len);
    }
  }
  // 2: cracks - branching dark lines with a lighter chipped edge
  {
    const x0 = cw * 2;
    const crack = (x, y, a, len, w, depth) => {
      g.lineWidth = w; g.strokeStyle = 'rgba(6,5,4,0.92)';
      g.beginPath(); g.moveTo(x, y);
      let px = x, py = y;
      const steps = 6 + rnd() * 6 | 0;
      for (let k = 0; k < steps; k++) {
        a += (rnd() - 0.5) * 0.9;
        px += Math.cos(a) * len / steps; py += Math.sin(a) * len / steps;
        px = Math.max(x0 + 4, Math.min(x0 + cw - 4, px)); py = Math.max(4, Math.min(H - 4, py));
        g.lineTo(px, py);
        if (depth < 2 && rnd() < 0.3) { g.stroke(); crack(px, py, a + (rnd() < 0.5 ? 1 : -1) * (0.5 + rnd()), len * 0.5, w * 0.6, depth + 1); g.lineWidth = w; g.strokeStyle = 'rgba(6,5,4,0.92)'; g.beginPath(); g.moveTo(px, py); }
      }
      g.stroke();
    };
    for (let i = 0; i < 3; i++) crack(x0 + cw * 0.5 + (rnd() - 0.5) * 40, H * 0.5 + (rnd() - 0.5) * 80, rnd() * Math.PI * 2, 260 + rnd() * 120, 9, 0);
  }
  // 3: blood smear - a dark handprint-ish smear dragged downward
  {
    const x0 = cw * 3;
    for (let i = 0; i < 5; i++) {
      const x = x0 + cw * 0.3 + rnd() * cw * 0.4, y = H * 0.25 + rnd() * 40, len = 120 + rnd() * 220, w = 10 + rnd() * 18;
      const gr = g.createLinearGradient(0, y, 0, y + len);
      gr.addColorStop(0, 'rgba(58,6,6,0.85)'); gr.addColorStop(0.6, 'rgba(40,4,4,0.5)'); gr.addColorStop(1, 'rgba(30,2,2,0)');
      g.fillStyle = gr; g.beginPath(); g.ellipse(x, y + len / 2, w, len / 2, (rnd() - 0.5) * 0.2, 0, Math.PI * 2); g.fill();
    }
    for (let i = 0; i < 40; i++) { g.fillStyle = `rgba(50,4,4,${0.4 + rnd() * 0.5})`; g.beginPath(); g.arc(x0 + cw * 0.2 + rnd() * cw * 0.6, H * 0.15 + rnd() * H * 0.3, 1 + rnd() * 5, 0, Math.PI * 2); g.fill(); }
  }
  // 4: straw - a loose drift of dry stalks, densest in the middle
  {
    const x0 = cw * 4;
    g.save(); g.beginPath(); g.rect(x0, 0, cw, H); g.clip();
    g.lineCap = 'round';
    for (let i = 0; i < 1500; i++) {
      const r = Math.sqrt(rnd()) * 0.5, a = rnd() * Math.PI * 2;
      const x = x0 + cw / 2 + Math.cos(a) * r * cw * 0.86, y = H / 2 + Math.sin(a) * r * H * 0.9;
      const len = 14 + rnd() * 34, ang = rnd() * Math.PI;
      const v = 0.55 + rnd() * 0.45;
      g.strokeStyle = `rgba(${150 * v | 0},${118 * v | 0},${56 * v | 0},${0.55 + rnd() * 0.45})`;
      g.lineWidth = 1 + rnd() * 1.8;
      g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(ang) * len, y + Math.sin(ang) * len); g.stroke();
    }
    g.restore();
  }
  // 5: a dark arched opening (culverts, niches) with a soft sooty rim
  {
    const x0 = cw * 5, m = 26;
    const path = () => { g.beginPath(); g.moveTo(x0 + m, H - 4); g.lineTo(x0 + m, H * 0.42); g.arc(x0 + cw / 2, H * 0.42, cw / 2 - m, Math.PI, 0); g.lineTo(x0 + cw - m, H - 4); g.closePath(); };
    g.save(); g.shadowColor = 'rgba(0,0,0,0.9)'; g.shadowBlur = 18;
    path(); g.fillStyle = 'rgba(3,2,2,0.97)'; g.fill(); g.restore();
    const gr = g.createLinearGradient(0, H * 0.2, 0, H);
    gr.addColorStop(0, 'rgba(0,0,0,0.6)'); gr.addColorStop(1, 'rgba(14,12,10,0)');
    path(); g.fillStyle = gr; g.fill();
  }
  // 6: rust streaks bleeding down from iron fittings
  {
    const x0 = cw * 6;
    for (let i = 0; i < 12; i++) {
      const x = x0 + cw * 0.3 + rnd() * cw * 0.4, w = 3 + rnd() * 12, len = H * (0.3 + rnd() * 0.7);
      const gr = g.createLinearGradient(0, 0, 0, len);
      gr.addColorStop(0, 'rgba(92,40,12,0.85)'); gr.addColorStop(0.5, 'rgba(70,30,10,0.45)'); gr.addColorStop(1, 'rgba(50,22,8,0)');
      g.fillStyle = gr; g.beginPath(); g.moveTo(x - w, 0); g.quadraticCurveTo(x - w * 0.2, len * 0.7, x, len); g.quadraticCurveTo(x + w * 0.2, len * 0.7, x + w, 0); g.fill();
    }
  }
  // 7: scattered parchment leaves with faded lines of script
  {
    const x0 = cw * 7;
    g.save(); g.beginPath(); g.rect(x0, 0, cw, H); g.clip();
    for (let i = 0; i < 9; i++) {
      const x = x0 + 40 + rnd() * (cw - 80), y = 50 + rnd() * (H - 100), a = rnd() * Math.PI;
      g.save(); g.translate(x, y); g.rotate(a);
      const v = 0.75 + rnd() * 0.25;
      g.fillStyle = `rgba(${196 * v | 0},${176 * v | 0},${134 * v | 0},0.96)`; g.fillRect(-30, -40, 60, 80);
      g.fillStyle = 'rgba(60,40,24,0.55)';
      for (let l = 0; l < 9; l++) g.fillRect(-24, -32 + l * 8, 30 + rnd() * 18, 2);
      g.restore();
    }
    g.restore();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  _grime = new THREE.MeshStandardMaterial({ map: t, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, roughness: 0.6, vertexColors: true });
  return _grime;
}
// Four columns of hanging vines (u 0..1 in quarters), drawn from the top (v=0) down.
function ivyMaterial() {
  if (_ivy) return _ivy;
  const W = 512, H = 1024;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');
  const rnd = (() => { let x = 1234567; return () => ((x = (x * 16807) % 2147483647) / 2147483647); })();
  for (let col = 0; col < 4; col++) {
    const x0 = col * 128;
    for (let v = 0; v < 6; v++) {
      let x = x0 + 14 + rnd() * 100, y = 0;
      const len = H * (0.35 + rnd() * 0.65);
      g.strokeStyle = 'rgb(40,46,22)'; g.lineWidth = 2.2;
      g.beginPath(); g.moveTo(x, y);
      while (y < len) {
        const nx = Math.max(x0 + 6, Math.min(x0 + 122, x + (rnd() - 0.5) * 16)), ny = y + 14 + rnd() * 10;
        g.lineTo(nx, ny);
        // leaves along the vine, denser near the top
        if (rnd() < 0.95 - y / len * 0.5) {
          for (let k = 0; k < 2; k++) {
            const lx = nx + (rnd() - 0.5) * 22, ly = ny + (rnd() - 0.5) * 12, r = 5 + rnd() * 7;
            const shade = 50 + rnd() * 60;
            g.fillStyle = `rgb(${shade * 0.55 | 0},${shade | 0},${shade * 0.35 | 0})`;
            g.beginPath(); g.ellipse(lx, ly, r, r * 0.62, rnd() * Math.PI, 0, Math.PI * 2); g.fill();
          }
        }
        x = nx; y = ny;
      }
      g.stroke();
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  _ivy = new THREE.MeshStandardMaterial({ map: t, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.85, vertexColors: true });
  return _ivy;
}
// Grass card: ~80 tapering blades on a transparent ground, grey-green under the moon,
// a few straw-pale dead stalks. Bottom of the canvas is the root (v = 0 with flipY).
let _grassCard = null;
function grassCardTexture() {
  if (_grassCard) return _grassCard;
  const W = 256, H = 160;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');
  let seed = 24680;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 90; i++) {
    const x0 = 6 + rnd() * (W - 12), h = H * (0.3 + rnd() * 0.68), w = 2 + rnd() * 3.2, bend = (rnd() - 0.5) * 50;
    const dry = rnd() < 0.12, pale = rnd() < 0.3;
    const tip = dry ? [176, 160, 112] : pale ? [150, 172, 146] : [104, 136, 96];
    const grd = g.createLinearGradient(0, H, 0, H - h);
    grd.addColorStop(0, 'rgb(22,32,24)');
    grd.addColorStop(0.55, `rgb(${tip[0] * 0.6 | 0},${tip[1] * 0.6 | 0},${tip[2] * 0.6 | 0})`);
    grd.addColorStop(1, `rgb(${tip[0]},${tip[1]},${tip[2]})`);
    g.fillStyle = grd;
    g.beginPath();
    g.moveTo(x0 - w, H);
    g.quadraticCurveTo(x0 - w * 0.6 + bend * 0.3, H - h * 0.55, x0 + bend, H - h);
    g.quadraticCurveTo(x0 + w * 0.6 + bend * 0.3, H - h * 0.55, x0 + w, H);
    g.fill();
  }
  _grassCard = new THREE.CanvasTexture(c);
  _grassCard.colorSpace = THREE.SRGBColorSpace;
  _grassCard.anisotropy = 4;
  return _grassCard;
}
function sootMaterial() {
  if (_soot) return _soot;
  const c = document.createElement('canvas');
  c.width = 64; c.height = 128;
  const g = c.getContext('2d');
  const gr = g.createRadialGradient(32, 40, 2, 32, 64, 64);
  gr.addColorStop(0, 'rgba(0,0,0,0.85)'); gr.addColorStop(0.5, 'rgba(0,0,0,0.4)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 128);
  const t = new THREE.CanvasTexture(c);
  t.flipY = false;
  _soot = new THREE.MeshBasicMaterial({ color: 0x000000, alphaMap: t, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, side: THREE.DoubleSide });
  return _soot;
}
function webMaterial() {
  if (_web) return _web;
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  g.strokeStyle = 'rgba(255,255,255,0.55)';
  g.lineWidth = 1.2;
  // radial threads from the corner (0,0) plus sagging spiral arcs
  for (let i = 0; i <= 8; i++) { const a = (i / 8) * Math.PI / 2; g.beginPath(); g.moveTo(0, 0); g.lineTo(Math.cos(a) * 256, Math.sin(a) * 256); g.stroke(); }
  for (let r = 20; r < 256; r += 18 + Math.random() * 8) {
    g.beginPath();
    for (let i = 0; i <= 8; i++) {
      const a = (i / 8) * Math.PI / 2;
      const rr = r * (0.92 + 0.08 * Math.sin(i * 1.7));
      const x = Math.cos(a) * rr, y = Math.sin(a) * rr;
      if (i === 0) g.moveTo(x, y); else g.quadraticCurveTo(Math.cos(a - 0.1) * rr * 0.93, Math.sin(a - 0.1) * rr * 0.93, x, y);
    }
    g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  _web = new THREE.MeshStandardMaterial({ color: 0xbbbbbb, alphaMap: t, transparent: true, depthWrite: false, side: THREE.DoubleSide, roughness: 1 });
  return _web;
}

// (storm: a low, racing overcast with the moon in its gaps, lit from within by lightning: uFlash, toward uBolt)
function makeNightSky(storm = false) {
  const geo = new THREE.SphereGeometry(400, 32, 16);
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: { uTime: { value: 0 }, uMoonDir: { value: new THREE.Vector3(0.35, 0.45, -0.82).normalize() }, uStorm: { value: storm ? 1 : 0 }, uFlash: { value: 0 }, uBolt: { value: new THREE.Vector3(0, 1, 0) } },
    vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.); gl_Position = p.xyww; }`,
    fragmentShader: `
      uniform float uTime; uniform vec3 uMoonDir; uniform float uStorm; uniform float uFlash; uniform vec3 uBolt; varying vec3 vDir;
      float hash(vec3 p){ p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
      float noise(vec3 x){ vec3 i = floor(x); vec3 f = fract(x); f = f*f*(3.-2.*f);
        return mix(mix(mix(hash(i+vec3(0,0,0)),hash(i+vec3(1,0,0)),f.x),mix(hash(i+vec3(0,1,0)),hash(i+vec3(1,1,0)),f.x),f.y),
                   mix(mix(hash(i+vec3(0,0,1)),hash(i+vec3(1,0,1)),f.x),mix(hash(i+vec3(0,1,1)),hash(i+vec3(1,1,1)),f.x),f.y),f.z); }
      float fbm(vec3 p){ float s=0., a=.5; for(int i=0;i<5;i++){ s+=a*noise(p); p*=2.03; a*=.5;} return s; }
      void main(){
        vec3 d = normalize(vDir);
        float h = d.y;
        vec3 col = mix(vec3(0.03,0.04,0.08), vec3(0.005,0.008,0.02), smoothstep(-0.05, 0.6, h));
        col += vec3(0.05,0.05,0.09) * exp(-abs(h) * 8.);
        // stars
        vec3 sp = d * 300.;
        float st = hash(floor(sp));
        float star = step(0.9965, st) * smoothstep(0.0, 0.2, h);
        float tw = 0.6 + 0.4 * sin(uTime * 3. + st * 100.);
        col += vec3(0.8,0.85,1.) * star * tw * 1.6 * (1.0 - uStorm * 0.75);
        // moon
        float md = dot(d, uMoonDir);
        float moon = smoothstep(0.9993, 0.9996, md);
        float crater = fbm(d * 120.) * 0.35;
        col += vec3(0.85,0.88,1.0) * moon * (2.8 - crater * 2.);
        col += vec3(0.25,0.3,0.5) * pow(max(md, 0.), 300.) * 1.4;
        col += vec3(0.08,0.1,0.18) * pow(max(md, 0.), 12.);
        // drifting clouds
        float race = 1.0 + uStorm * 4.0;
        vec2 cp = d.xz / max(0.08, d.y + 0.15) * 0.8 + vec2(uTime * 0.006, uTime * 0.002) * race;
        float f = fbm(vec3(cp, uTime * 0.01 * race));
        float c = smoothstep(0.45 - uStorm * 0.25, 0.85 - uStorm * 0.22, f);
        vec3 cloudCol = mix(vec3(0.02,0.025,0.04), vec3(0.18,0.2,0.3), pow(max(md,0.), 6.));
        // lightning lights the overcast from inside: brightest round the bolt, thin edges glowing more
        cloudCol += uFlash * vec3(0.42, 0.46, 0.62) * (0.25 + 2.2 * pow(max(dot(d, uBolt), 0.), 10.)) * (1.3 - c * 0.5);
        col = mix(col, cloudCol, c * smoothstep(0.0, 0.2, h) * (0.85 + uStorm * 0.12));
        gl_FragColor = vec4(col, 1.);
      }`,
  });
  const m = new THREE.Mesh(geo, mat);
  m.renderOrder = -10;
  m.frustumCulled = false;
  m.onBeforeRender = (r, s, cam) => { m.position.copy(cam.position); };
  return m;
}

// A silhouette of the castle keep looming beyond the bailey walls, with lit windows.
function makeDistantKeep(level, mats) {
  const g = new THREE.Group();
  const keepMat = new THREE.MeshStandardMaterial({ color: 0x1a1c24, roughness: 1, fog: false, emissive: 0x05060a });
  const winMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(3.2, 1.6, 0.6), fog: false });
  const roofMat = new THREE.MeshStandardMaterial({ color: 0x101218, roughness: 0.9, fog: false });
  const cx = level.W * T / 2, cz = -70;
  const rng = new RNG(level.seed + 99);
  const tower = (x, z, r, h, roofH) => {
    const t = new THREE.Mesh(new THREE.CylinderGeometry(r, r * 1.08, h, 16), keepMat);
    t.position.set(x, h / 2 - 5, z);
    g.add(t);
    const roof = new THREE.Mesh(new THREE.ConeGeometry(r * 1.25, roofH, 16), roofMat);
    roof.position.set(x, h - 5 + roofH / 2, z);
    g.add(roof);
    for (let i = 0; i < 6; i++) {
      if (rng.chance(0.45)) continue;
      const a = rng.range(-0.8, 0.8) + Math.PI / 2;
      const wy = rng.range(h * 0.3, h * 0.9) - 5;
      const w = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 1.6), winMat);
      w.position.set(x + Math.cos(a) * (r + 0.05), wy, z + Math.sin(a) * (r + 0.05));
      w.lookAt(x + Math.cos(a) * (r + 5), wy, z + Math.sin(a) * (r + 5));
      g.add(w);
    }
  };
  // main keep block
  const keep = new THREE.Mesh(new THREE.BoxGeometry(50, 55, 30), keepMat);
  keep.position.set(cx, 22, cz);
  g.add(keep);
  for (let i = 0; i < 14; i++) {
    if (rng.chance(0.4)) continue;
    const w = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 2.6), winMat);
    w.position.set(cx - 22 + i * 3.4, rng.range(10, 44), cz + 15.05);
    g.add(w);
  }
  tower(cx - 26, cz + 14, 6, 70, 22);
  tower(cx + 26, cz + 14, 6, 64, 20);
  tower(cx, cz - 6, 9, 95, 30);
  tower(cx - 14, cz - 12, 5, 80, 18);
  tower(cx + 16, cz - 10, 5, 74, 18);
  // flanking curtain wall towers
  for (const s of [-1, 1]) tower(cx + s * 90, cz + 40, 7, 40, 14);
  return g;
}
