import * as THREE from 'three';
import { GeoBuilder, tf, worldBox } from '../render/geo.js';
import { T, SOLID, FLOOR, BLOCK, K_MAIN, K_ALT, K_WATER, K_DAIS, ROOM } from './levelgen.js';
import { PROPS, PROP_FLAMES, CHANDELIER_FLAMES, cellBars, bookshelf } from './props.js';
import { getBiomeMaterials, getSharedMaterials } from './materials.js';
import { RNG } from '../core/rng.js';

// ---------------------------------------------------------------------------
// Turns a generated Level into renderable meshes: floors, walls, ceilings,
// trims, pillars, door frames, portcullises, props, torches and sky.
// Static geometry is merged into one mesh per material.
// ---------------------------------------------------------------------------

export function buildLevel(level, factory, lightPool) {
  const biome = level.biome;
  const mats = getBiomeMaterials(factory, biome);
  const group = new THREE.Group();
  group.name = 'level';
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
    for (let s = 0; s < hs.length - 1; s++) {
      const ya = hs[s], yb = hs[s + 1];
      const ca = shade(ya), cb = shade(yb);
      // wound b -> a so the front face points along n, into the walkable cell
      b.quad(
        [bx, ya, bz], [ax, ya, az], [ax, yb, az], [bx, yb, bz], n,
        [[(uOff + len) * 0.5, ya * 0.5], [uOff * 0.5, ya * 0.5], [uOff * 0.5, yb * 0.5], [(uOff + len) * 0.5, yb * 0.5]],
        [ca * aoB, ca * aoA, cb * aoA, cb * aoB],
      );
    }
  };

  const trimB = B('trim');
  const pilasters = [];
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
      wallEdges.push({ ax, az, bx, bz, n: d.n, h0, h1 });
      // baseboard trim
      if (!biome.outdoor || true) {
        const mx = (ax + bx) / 2 + d.n[0] * 0.08, mz = (az + bz) / 2 + d.n[2] * 0.08;
        const along = d.dx !== 0 ? 0 : 1;
        const g = worldBox(along ? T : 0.18, 0.35, along ? 0.18 : T);
        trimB.addGeometry(g, new THREE.Matrix4().makeTranslation(mx, h0 + 0.175, mz), 0.75);
        if (!biome.outdoor) {
          const g2 = worldBox(along ? T : 0.3, 0.3, along ? 0.3 : T);
          trimB.addGeometry(g2, new THREE.Matrix4().makeTranslation((ax + bx) / 2 + d.n[0] * 0.14, h1 - 0.15, (az + bz) / 2 + d.n[2] * 0.14), 0.8);
        }
      }
      // pilaster every few cells along long walls (deterministic by position)
      const along = d.dx !== 0 ? y : x;
      if (along % 3 === 0 && level.roomId[i] >= 0) pilasters.push({ x: ax, z: az, n: d.n, h0, h1 });
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
      trimB.quad([ax, hn, az], [bx, hn, bz], [bx, h0, bz], [ax, h0, az], n,
        [[u * 0.5, hn * 0.5], [(u + T) * 0.5, hn * 0.5], [(u + T) * 0.5, h0 * 0.5], [u * 0.5, h0 * 0.5]], [0.5, 0.5, 0.9, 0.9]);
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

  // pilasters (half columns against walls)
  for (const p of pilasters) {
    const g = worldBox(0.7, p.h1 - p.h0, 0.7);
    trimB.addGeometry(g, new THREE.Matrix4().makeTranslation(p.x + p.n[0] * 0.2, p.h0 + (p.h1 - p.h0) / 2, p.z + p.n[2] * 0.2), 0.85);
    const cap = worldBox(0.95, 0.35, 0.95);
    trimB.addGeometry(cap, new THREE.Matrix4().makeTranslation(p.x + p.n[0] * 0.25, p.h0 + 0.18, p.z + p.n[2] * 0.25), 0.7);
  }

  // ---------------- ceiling beams / arches across rooms
  if (!biome.outdoor) {
    for (const room of level.rooms) {
      const horiz = room.w > room.h;
      const span = horiz ? room.h : room.w;
      const len = horiz ? room.w : room.h;
      for (let k = 2; k < len - 1; k += 3) {
        if (biome.ceilingMat === 'wood') {
          const g = worldBox(horiz ? 0.4 : span * T, 0.5, horiz ? span * T : 0.4);
          const cx = horiz ? (room.x + k) * T : room.cx, cz = horiz ? room.cz : (room.y + k) * T;
          B('wood').addGeometry(g, new THREE.Matrix4().makeTranslation(cx, room.ceil - 0.25, cz), 0.8);
        } else {
          // stone rib arch
          const r = span * T / 2;
          const arc = new THREE.TorusGeometry(r, 0.3, 6, 18, Math.PI);
          const cx = horiz ? (room.x + k) * T : room.cx, cz = horiz ? room.cz : (room.y + k) * T;
          const m = new THREE.Matrix4().compose(
            new THREE.Vector3(cx, room.ceil - Math.min(r, 3.5) * 1.0, cz),
            new THREE.Quaternion().setFromEuler(new THREE.Euler(0, horiz ? Math.PI / 2 : 0, 0)),
            new THREE.Vector3(1, Math.min(r, 3.5) / r, 1),
          );
          trimB.addGeometry(arc, m, 0.8);
        }
      }
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
    const halfW = door.width / 2;
    // frame jambs
    for (const s of [-1, 1]) {
      const jx = bx + (horizN ? 0 : s * (halfW + 0.3)), jz = bz + (horizN ? s * (halfW + 0.3) : 0);
      const g = worldBox(horizN ? 0.9 : 0.7, doorH + 0.4, horizN ? 0.7 : 0.9);
      trimB.addGeometry(g, new THREE.Matrix4().makeTranslation(jx - door.nx * 0.25, doorH / 2, jz - door.ny * 0.25), 0.8);
    }
    const lintel = worldBox(horizN ? 0.9 : door.width + 1.6, 0.7, horizN ? door.width + 1.6 : 0.9);
    trimB.addGeometry(lintel, new THREE.Matrix4().makeTranslation(bx - door.nx * 0.25, doorH + 0.1, bz - door.ny * 0.25), 0.8);
    if (biome.outdoor) {
      // gatehouse bridge across the passage
      const bridge = worldBox(horizN ? 3 : door.width + 1, 4, horizN ? door.width + 1 : 3);
      trimB.addGeometry(bridge, new THREE.Matrix4().makeTranslation(bx + door.nx * 1.0, doorH + 2.4, bz + door.ny * 1.0), 0.85);
    }
    // portcullis (only for rooms that lock)
    const locks = room.type === ROOM.COMBAT || room.type === ROOM.ELITE || room.type === ROOM.BOSS;
    let mesh = null;
    if (locks) {
      const gb = new GeoBuilder();
      const n = Math.max(2, Math.round(door.width / 0.32));
      for (let k = 0; k <= n; k++) {
        const off = -halfW + (k / n) * door.width;
        const g = tf(new THREE.CylinderGeometry(0.035, 0.035, doorH, 6), {});
        gb.addGeometry(g, new THREE.Matrix4().makeTranslation(horizN ? 0 : off, 0, horizN ? off : 0));
        const spike = new THREE.ConeGeometry(0.05, 0.25, 6);
        spike.rotateX(Math.PI);
        gb.addGeometry(spike, new THREE.Matrix4().makeTranslation(horizN ? 0 : off, -doorH / 2 - 0.12, horizN ? off : 0));
      }
      for (let k = 0; k < 5; k++) {
        const yy = -doorH / 2 + 0.3 + k * (doorH - 0.6) / 4;
        const g = worldBox(horizN ? 0.06 : door.width, 0.07, horizN ? door.width : 0.06);
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

  // ---------------- props
  const flames = []; // {x,y,z,size,kind}
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
  for (const p of level.props) {
    const fy = (p.y ?? 0) + (p.type === 'chandelier' ? 0 : level.floorAt(p.x, p.z));
    if (p.type === 'cellBars') { addParts(cellBars(p.len), p.x, level.floorAt(p.x, p.z + 0.1), p.z, p.rot); continue; }
    if (p.type === 'shelfRow') { addParts(bookshelf(p.len), p.x, level.floorAt(p.x, p.z), p.z, p.rot); continue; }
    if (p.type === 'chest' || p.type === 'shrine' || p.type === 'merchant') {
      interactables.push(p);
      if (p.type !== 'chest') addParts(PROPS[p.type](r01), p.x, fy, p.z, p.rot ?? 0);
      continue;
    }
    const fn = PROPS[p.type];
    if (!fn) continue;
    const rot = p.rot ?? 0;
    addParts(fn(r01), p.x, p.type === 'chandelier' ? p.y : fy, p.z, rot);
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
      lightPool.addTorch(new THREE.Vector3(t.x, t.y + 0.4, t.z), { color: t.color ?? biome.torchColor, intensity: t.intensity ?? 40, range: t.range ?? 18, priority: t.priority });
      if (!flames.some((f) => Math.abs(f.x - t.x) < 0.1 && Math.abs(f.z - t.z) < 0.1)) flames.push({ x: t.x, y: t.y - 0.1, z: t.z, size: 1.6, kind: 'fire', color: t.color });
      else flames.forEach((f) => { if (Math.abs(f.x - t.x) < 0.1 && Math.abs(f.z - t.z) < 0.1) f.color = t.color; });
    } else if (t.type === 'fungus') {
      lightPool.addTorch(new THREE.Vector3(t.x, t.y, t.z), { color: t.color, intensity: t.intensity, range: t.range, flicker: 0.2 });
      flames.push({ x: t.x, y: t.y - 0.4, z: t.z, size: 0.5, kind: 'spores' });
    } else if (t.type === 'chandelier') {
      lightPool.addTorch(new THREE.Vector3(t.x, t.y, t.z), { color: 0xffb060, intensity: t.intensity * 3, range: t.range, flicker: 0.4 });
    }
  }

  // ---------------- water surfaces
  {
    const wb = new GeoBuilder();
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = level.idx(x, y);
      if (level.cells[i] !== FLOOR || level.kind[i] !== K_WATER) continue;
      const x0 = x * T, z0 = y * T, x1 = x0 + T, z1 = z0 + T, h = -0.25;
      wb.quad([x0, h, z1], [x1, h, z1], [x1, h, z0], [x0, h, z0], [0, 1, 0],
        [[x0 / 6, -z1 / 6], [x1 / 6, -z1 / 6], [x1 / 6, -z0 / 6], [x0 / 6, -z0 / 6]]);
    }
    if (wb.count) {
      const wm = new THREE.Mesh(wb.build(), mats.water);
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
    const mesh = new THREE.Mesh(b.build(), mat);
    mesh.name = 'lvl_' + key;
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    if (mat.transparent) mesh.renderOrder = 4;
    group.add(mesh);
    meshes.push(mesh);
  }

  // ---------------- instanced grass tufts swaying in the wind (courtyard)
  let grassMat = null;
  if (biome.outdoor) {
    const blade = new GeoBuilder();
    const rg = new RNG(level.seed + 77);
    // curved two-segment blades; normals lean sideways so moonlight doesn't light them like floor
    for (let b = 0; b < 9; b++) {
      const a = rg.range(0, Math.PI * 2), r = rg.range(0, 0.14);
      const bx = Math.cos(a) * r, bz = Math.sin(a) * r;
      const h = rg.range(0.26, 0.58), w = rg.range(0.022, 0.04);
      const lean = rg.range(0.06, 0.2), dir = rg.range(0, Math.PI * 2);
      const dx = Math.cos(dir), dz = Math.sin(dir);
      const nx = dx * 0.75, ny = 0.66, nz = dz * 0.75;
      const dry = rg.next() < 0.3;
      const c0 = [0.035, 0.045, 0.02], c1 = dry ? [0.2, 0.17, 0.08] : [0.11, 0.14, 0.05], c2 = dry ? [0.3, 0.26, 0.12] : [0.17, 0.21, 0.08];
      const mx = bx + dx * lean * 0.3, mz = bz + dz * lean * 0.3, mw = w * 0.7;
      const v0 = blade.vert(bx - dz * w, 0, bz + dx * w, nx, ny, nz, 0, 0, c0);
      blade.vert(bx + dz * w, 0, bz - dx * w, nx, ny, nz, 1, 0, c0);
      blade.vert(mx - dz * mw, h * 0.55, mz + dx * mw, nx, ny, nz, 0, 0.55, c1);
      blade.vert(mx + dz * mw, h * 0.55, mz - dx * mw, nx, ny, nz, 1, 0.55, c1);
      blade.vert(bx + dx * lean, h, bz + dz * lean, nx, ny, nz, 0.5, 1, c2);
      blade.tri(v0, v0 + 1, v0 + 3); blade.tri(v0, v0 + 3, v0 + 2);
      blade.tri(v0 + 2, v0 + 3, v0 + 4);
    }
    const geo = blade.build();
    grassMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, side: THREE.DoubleSide });
    grassMat.userData.time = { value: 0 };
    grassMat.onBeforeCompile = (sh) => {
      sh.uniforms.uTime = grassMat.userData.time;
      sh.vertexShader = 'uniform float uTime;\n' + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
        vec4 wp = instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
        float sway = sin(uTime * 1.7 + wp.x * 0.35 + wp.z * 0.21) * 0.6 + sin(uTime * 3.1 + wp.x * 0.9) * 0.25;
        transformed.x += sway * uv.y * 0.12;
        transformed.z += sway * uv.y * 0.05;`);
    };
    const spots = [];
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = level.idx(x, y);
      if (level.cells[i] !== FLOOR || level.kind[i] !== K_MAIN) continue;
      const n = 10;
      for (let k = 0; k < n; k++) {
        const px = (x + rg.next()) * T, pz = (y + rg.next()) * T;
        if (level.colliders.some((c) => c.r && (c.x - px) ** 2 + (c.z - pz) ** 2 < (c.r + 0.3) ** 2)) continue;
        spots.push([px, pz]);
      }
    }
    const inst = new THREE.InstancedMesh(geo, grassMat, spots.length);
    const m4 = new THREE.Matrix4(), qq = new THREE.Quaternion(), sc = new THREE.Vector3();
    spots.forEach(([px, pz], i) => {
      qq.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rg.range(0, Math.PI * 2));
      const k = rg.range(0.7, 1.5);
      sc.set(k, k * rg.range(0.8, 1.3), k);
      m4.compose(new THREE.Vector3(px, level.floorAt(px, pz), pz), qq, sc);
      inst.setMatrixAt(i, m4);
      inst.setColorAt(i, sc.set(rg.range(0.75, 1.15), rg.range(0.8, 1.1), rg.range(0.7, 1.0)));
    });
    inst.receiveShadow = true;
    group.add(inst);
  }

  // ---------------- light shafts (keep halls, throne room): soft additive beams
  if (biome.id === 'keep' || biome.id === 'throne') {
    const shaftGeo = new GeoBuilder();
    const rs = new RNG(level.seed + 31);
    for (const room of level.rooms) {
      if (room.type === 'start' || (biome.id === 'keep' && room.layout !== 'hall' && room.layout !== 'library')) continue;
      const n = room.type === 'boss' ? 4 : 2;
      for (let k = 0; k < n; k++) {
        // beam enters high on the north wall and slants down into the room
        const x = (room.x + 2 + rs.next() * (room.w - 4)) * T;
        const z0 = room.y * T + 0.2, top = room.ceil - 0.6;
        const len = Math.min(room.h * T * 0.8, top * 1.4);
        const w = rs.range(1.2, 2.2);
        const z1 = z0 + len * 0.6, bottom = 0.05;
        shaftGeo.quad([x - w / 2, top, z0], [x + w / 2, top, z0], [x + w / 2 + 0.3, bottom, z1], [x - w / 2 - 0.3, bottom, z1], [0, 0, 1], [[0, 1], [1, 1], [1, 0], [0, 0]]);
        shaftGeo.quad([x, top, z0 - w / 2 + 0.01], [x, top, z0 + w / 2], [x + 0.2, bottom, z1 + w / 2], [x + 0.2, bottom, z1 - w / 2], [1, 0, 0], [[0, 1], [1, 1], [1, 0], [0, 0]]);
      }
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
      const col = biome.id === 'throne' ? new THREE.Color(0.22, 0.12, 0.32) : new THREE.Color(0.2, 0.16, 0.11);
      const shaftMat = new THREE.MeshBasicMaterial({ map: tex, color: col, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: true });
      const sm = new THREE.Mesh(shaftGeo.build(), shaftMat);
      sm.renderOrder = 6;
      group.add(sm);
    }
  }

  // ---------------- outdoor sky & distant keep
  let sky = null;
  if (biome.outdoor) {
    sky = makeNightSky();
    group.add(sky);
    group.add(makeDistantKeep(level, mats));
  }

  return {
    group,
    mats,
    doors,
    flames,
    interactables,
    sky,
    update(dt, time) {
      mats.water.userData.update?.(time);
      mats.waterFlat.userData.update?.(time);
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
      if (grassMat) grassMat.userData.time.value = time;
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
    },
  };
}

let _soot = null, _web = null, _ivy = null;
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

function makeNightSky() {
  const geo = new THREE.SphereGeometry(400, 32, 16);
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: { uTime: { value: 0 }, uMoonDir: { value: new THREE.Vector3(0.35, 0.45, -0.82).normalize() } },
    vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.); gl_Position = p.xyww; }`,
    fragmentShader: `
      uniform float uTime; uniform vec3 uMoonDir; varying vec3 vDir;
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
        col += vec3(0.8,0.85,1.) * star * tw * 1.6;
        // moon
        float md = dot(d, uMoonDir);
        float moon = smoothstep(0.9993, 0.9996, md);
        float crater = fbm(d * 120.) * 0.35;
        col += vec3(0.85,0.88,1.0) * moon * (2.8 - crater * 2.);
        col += vec3(0.25,0.3,0.5) * pow(max(md, 0.), 300.) * 1.4;
        col += vec3(0.08,0.1,0.18) * pow(max(md, 0.), 12.);
        // drifting clouds
        vec2 cp = d.xz / max(0.08, d.y + 0.15) * 0.8 + vec2(uTime * 0.006, uTime * 0.002);
        float c = smoothstep(0.45, 0.85, fbm(vec3(cp, uTime * 0.01)));
        vec3 cloudCol = mix(vec3(0.02,0.025,0.04), vec3(0.18,0.2,0.3), pow(max(md,0.), 6.));
        col = mix(col, cloudCol, c * smoothstep(0.0, 0.2, h) * 0.85);
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
