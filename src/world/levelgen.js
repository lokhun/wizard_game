import { RNG } from '../core/rng.js';
import { BIOMES } from './biomes.js';

// ---------------------------------------------------------------------------
// Level generation. A floor is a grid of 2m cells. Rooms are placed on a
// coarse "macro grid" along a random path heading north (upwards through the
// castle), with optional side branches. Corridors carve Z-shaped passages
// between neighbouring rooms. All randomness comes from the floor seed so
// every co-op peer builds an identical floor.
// ---------------------------------------------------------------------------

export const T = 2; // cell size in metres
export const SOLID = 0, FLOOR = 1, BLOCK = 2;
// floor "kinds" pick materials and footstep sounds
export const K_MAIN = 0, K_ALT = 1, K_WATER = 2, K_DAIS = 3;

const BLOCKSZ = 20; // macro block size in cells

export const ROOM = {
  START: 'start', COMBAT: 'combat', ELITE: 'elite', TREASURE: 'treasure',
  SHRINE: 'shrine', SHOP: 'shop', BOSS: 'boss', EXIT: 'exit', TRIAL: 'trial',
};

export class Level {
  constructor(W, H, biome) {
    this.W = W; this.H = H; this.biome = biome;
    this.cells = new Uint8Array(W * H);
    this.hgt = new Float32Array(W * H);
    this.ceil = new Float32Array(W * H);
    this.kind = new Uint8Array(W * H);
    this.roomId = new Int16Array(W * H).fill(-1);
    this.corrId = new Int16Array(W * H).fill(-1);
    this.rooms = [];
    this.corridors = [];
    this.doors = [];
    this.props = [];
    this.torches = [];
    this.colliders = []; // circles {x,z,r}
    this.breakables = []; // barrels/crates {i,type,x,z,r,alive}
  }
  idx(x, y) { return y * this.W + x; }
  inb(x, y) { return x >= 0 && y >= 0 && x < this.W && y < this.H; }
  get(x, y) { return this.inb(x, y) ? this.cells[y * this.W + x] : SOLID; }
  walkable(x, y) { return this.get(x, y) === FLOOR; }
  // world <-> cell
  cellOf(wx) { return Math.floor(wx / T); }
  center(x, y) { return [x * T + T / 2, y * T + T / 2]; }
  floorAt(wx, wz) {
    const x = Math.floor(wx / T), y = Math.floor(wz / T);
    if (!this.inb(x, y)) return 0;
    return this.hgt[y * this.W + x];
  }
  ceilAt(wx, wz) {
    const x = Math.floor(wx / T), y = Math.floor(wz / T);
    if (!this.inb(x, y)) return 0;
    return this.ceil[y * this.W + x];
  }
  roomAt(wx, wz) {
    const x = Math.floor(wx / T), y = Math.floor(wz / T);
    if (!this.inb(x, y)) return null;
    const r = this.roomId[y * this.W + x];
    return r >= 0 ? this.rooms[r] : null;
  }
}

export function generateLevel(seed, floorIndex) {
  const biome = BIOMES[floorIndex];
  const rng = new RNG(seed * 7919 + floorIndex * 104729);
  const isFinal = biome.id === 'throne';

  // --- macro path
  const MW = 7, MH = 9;
  const pathLen = biome.rooms + 1; // start .. boss
  let path = null;
  for (let attempt = 0; attempt < 200 && !path; attempt++) {
    const p = [[3, MH - 1]];
    const used = new Set(['3,' + (MH - 1)]);
    let ok = true;
    while (p.length < pathLen) {
      const [cx, cy] = p[p.length - 1];
      const opts = [];
      if (cy > 0) opts.push([cx, cy - 1], [cx, cy - 1]); // bias north
      if (cx > 0) opts.push([cx - 1, cy]);
      if (cx < MW - 1) opts.push([cx + 1, cy]);
      const free = opts.filter(([x, y]) => !used.has(x + ',' + y));
      if (!free.length) { ok = false; break; }
      const n = rng.pick(free);
      used.add(n[0] + ',' + n[1]);
      p.push(n);
    }
    // the boss block must be reachable straight north-ish; ensure last move is north
    if (ok && p.length >= 2) {
      const a = p[p.length - 2], b = p[p.length - 1];
      if (b[1] !== a[1] - 1 && !isFinal) ok = rng.chance(0.3);
    }
    if (ok) path = p;
  }

  // shift the macro grid so it starts at 0
  const level = new Level(MW * BLOCKSZ, MH * BLOCKSZ, biome);
  level.floorIndex = floorIndex;
  level.seed = seed;

  // --- room types along the main path
  const types = [ROOM.START];
  const middle = pathLen - 2;
  const plan = [];
  for (let i = 0; i < middle; i++) plan.push(ROOM.COMBAT);
  if (!isFinal) {
    // one elite in the second half, one shop right before the boss
    if (middle >= 4) plan[Math.floor(middle * 0.6)] = ROOM.ELITE;
    plan[middle - 1] = ROOM.SHOP;
  } else {
    plan[middle - 1] = ROOM.SHRINE;
  }
  types.push(...plan, ROOM.BOSS);

  const blocks = new Map();
  const mkRoom = (mx, my, type, depth, parent) => {
    const big = type === ROOM.BOSS;
    const small = type === ROOM.TREASURE || type === ROOM.SHRINE || type === ROOM.SHOP || type === ROOM.START;
    let w, h;
    if (big) { w = BLOCKSZ - 2; h = BLOCKSZ - 2; }
    else if (small) { w = rng.int(7, 10); h = rng.int(7, 10); }
    else { w = rng.int(10, 15); h = rng.int(10, 15); }
    if (biome.outdoor && !small) { w = Math.min(BLOCKSZ - 2, w + 2); h = Math.min(BLOCKSZ - 2, h + 2); }
    const ox = mx * BLOCKSZ + 1 + rng.int(0, BLOCKSZ - 2 - w);
    const oy = my * BLOCKSZ + 1 + rng.int(0, BLOCKSZ - 2 - h);
    const room = {
      id: level.rooms.length,
      x: ox, y: oy, w, h, mx, my, type, depth, parent,
      ceil: big ? biome.ceilRoom[1] + 2 : rng.range(biome.ceilRoom[0], biome.ceilRoom[1]),
      doors: [],
      neighbors: [],
      layout: null,
      cleared: type !== ROOM.COMBAT && type !== ROOM.ELITE && type !== ROOM.BOSS && type !== ROOM.TRIAL,
      visited: false,
    };
    room.cx = (ox + w / 2) * T;
    room.cz = (oy + h / 2) * T;
    level.rooms.push(room);
    blocks.set(mx + ',' + my, room);
    for (let y = oy; y < oy + h; y++) for (let x = ox; x < ox + w; x++) {
      const i = level.idx(x, y);
      level.cells[i] = FLOOR;
      level.roomId[i] = room.id;
      level.ceil[i] = biome.outdoor ? 99 : room.ceil;
    }
    // L-shaped rooms: cut away one corner of larger combat rooms
    if ((type === ROOM.COMBAT || type === ROOM.ELITE || type === ROOM.TRIAL) && w >= 11 && h >= 11 && rng.chance(0.45)) {
      const cw = Math.floor(w / 3), ch = Math.floor(h / 3);
      const cxr = rng.chance(0.5) ? ox : ox + w - cw;
      const cyr = rng.chance(0.5) ? oy : oy + h - ch;
      for (let y = cyr; y < cyr + ch; y++) for (let x = cxr; x < cxr + cw; x++) {
        const i = level.idx(x, y);
        level.cells[i] = SOLID; level.roomId[i] = -1; level.ceil[i] = 0;
      }
      room.cut = { x: cxr, y: cyr, w: cw, h: ch };
    }
    return room;
  };

  const mainRooms = path.map(([mx, my], i) => mkRoom(mx, my, types[i], i, i > 0 ? i - 1 : -1));
  mainRooms.forEach((r, i) => { r.main = true; r.order = i; });

  // --- branches
  // optional side rooms: two of treasure / shrine / trial, then an elite
  const sideTypes = [...rng.shuffle([ROOM.TREASURE, ROOM.SHRINE, ROOM.TRIAL]).slice(0, 2), ROOM.TREASURE, ROOM.ELITE];
  let branches = biome.branches;
  const candidates = rng.shuffle(mainRooms.slice(1, -2));
  for (const host of candidates) {
    if (branches <= 0) break;
    const dirs = rng.shuffle([[1, 0], [-1, 0], [0, 1]]);
    for (const [dx, dy] of dirs) {
      const nx = host.mx + dx, ny = host.my + dy;
      if (nx < 0 || ny < 0 || nx >= MW || ny >= MH || blocks.has(nx + ',' + ny)) continue;
      const side = mkRoom(nx, ny, sideTypes[(biome.branches - branches) % sideTypes.length], host.depth + 0.5, host.id);
      side.main = false;
      branches--;
      break;
    }
  }

  // --- corridors
  const cw = biome.corridorWidth;
  const carve = (x, y, corr) => {
    if (!level.inb(x, y)) return;
    const i = level.idx(x, y);
    if (level.roomId[i] >= 0) return;
    level.cells[i] = FLOOR;
    level.corrId[i] = corr.id;
    level.ceil[i] = biome.outdoor ? 99 : biome.ceilCorr;
    corr.cells.push(i);
  };
  const connect = (a, b) => {
    const corr = { id: level.corridors.length, a: a.id, b: b.id, cells: [] };
    level.corridors.push(corr);
    a.neighbors.push(b.id); b.neighbors.push(a.id);
    const acx = Math.floor(a.x + a.w / 2), acy = Math.floor(a.y + a.h / 2);
    const bcx = Math.floor(b.x + b.w / 2), bcy = Math.floor(b.y + b.h / 2);
    const half = Math.floor(cw / 2);
    const brush = (x, y) => {
      for (let oy = -half; oy < cw - half; oy++) for (let ox = -half; ox < cw - half; ox++) carve(x + ox, y + oy, corr);
    };
    if (a.mx !== b.mx) {
      // horizontal neighbour: go along x to the boundary, shift in y, continue
      const dir = Math.sign(bcx - acx);
      const midX = (Math.max(a.mx, b.mx)) * BLOCKSZ;
      // pick a lane y that lies inside both rooms if possible
      const lo = Math.max(a.y + 1, b.y + 1), hi = Math.min(a.y + a.h - 2, b.y + b.h - 2);
      if (lo <= hi) {
        const ly = rng.int(lo, hi);
        for (let x = acx; x !== bcx + dir; x += dir) brush(x, ly);
      } else {
        for (let x = acx; x !== midX + dir; x += dir) brush(x, acy);
        for (let y = acy; y !== bcy + Math.sign(bcy - acy); y += Math.sign(bcy - acy) || 1) { brush(midX, y); if (y === bcy) break; }
        for (let x = midX; x !== bcx + dir; x += dir) brush(x, bcy);
      }
    } else {
      const dir = Math.sign(bcy - acy);
      const midY = (Math.max(a.my, b.my)) * BLOCKSZ;
      const lo = Math.max(a.x + 1, b.x + 1), hi = Math.min(a.x + a.w - 2, b.x + b.w - 2);
      if (lo <= hi) {
        const lx = rng.int(lo, hi);
        for (let y = acy; y !== bcy + dir; y += dir) brush(lx, y);
      } else {
        for (let y = acy; y !== midY + dir; y += dir) brush(acx, y);
        for (let x = acx; x !== bcx + Math.sign(bcx - acx); x += Math.sign(bcx - acx) || 1) { brush(x, midY); if (x === bcx) break; }
        for (let y = midY; y !== bcy + dir; y += dir) brush(bcx, y);
      }
    }
    // door cells: corridor cells adjacent to each room
    for (const room of [a, b]) {
      const cells = [];
      for (const ci of corr.cells) {
        const x = ci % level.W, y = Math.floor(ci / level.W);
        const n4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];
        for (const [dx, dy] of n4) {
          if (level.inb(x + dx, y + dy) && level.roomId[level.idx(x + dx, y + dy)] === room.id) {
            cells.push({ x, y, dx, dy });
            break;
          }
        }
      }
      if (!cells.length) continue;
      // door orientation from first cell
      const { dx, dy } = cells[0];
      const door = {
        id: level.doors.length,
        room: room.id,
        other: room === a ? b.id : a.id,
        corridor: corr.id,
        cells: cells.map((c) => level.idx(c.x, c.y)),
        nx: -dx, ny: -dy, // normal pointing out of the room into the corridor
        open: true,
      };
      let sx = 0, sy = 0;
      for (const c of cells) { sx += c.x; sy += c.y; }
      door.x = (sx / cells.length + 0.5) * T;
      door.z = (sy / cells.length + 0.5) * T;
      door.width = cells.length * T;
      level.doors.push(door);
      room.doors.push(door.id);
    }
  };
  for (let i = 1; i < mainRooms.length; i++) connect(mainRooms[i - 1], mainRooms[i]);
  for (const r of level.rooms) if (!r.main) connect(level.rooms[r.parent], r);

  // --- room interiors
  for (const room of level.rooms) decorateRoom(level, room, rng.fork('room' + room.id));
  for (const corr of level.corridors) decorateCorridor(level, corr, rng.fork('corr' + corr.id));

  // --- spawn and exit
  const start = mainRooms[0];
  level.spawn = { x: start.cx, z: start.cz + 2 };
  level.bossRoom = mainRooms[mainRooms.length - 1];
  level.startRoom = start;
  return level;
}

// ---------------------------------------------------------------------------
// Interior decoration: features that change collision (pillars, water,
// shelves, dais) plus purely visual props. Each biome has its own palette.
// ---------------------------------------------------------------------------

function wallTorches(level, room, rng, spacing, colorOverride) {
  // place sconces on interior walls facing into the room
  const { x, y, w, h } = room;
  const place = (cx, cy, nx, ny) => {
    if (level.get(cx, cy) !== FLOOR) return;
    const [wx, wz] = level.center(cx, cy);
    const tx = wx - nx * (T / 2 - 0.15), tz = wz - ny * (T / 2 - 0.15);
    level.torches.push({ x: tx, y: level.hgt[level.idx(cx, cy)] + 2.7, z: tz, nx, nz: ny, type: 'sconce', color: colorOverride });
  };
  const isWall = (cx, cy) => level.get(cx, cy) === SOLID;
  for (let i = 1 + rng.int(0, 1); i < w - 1; i += spacing) {
    if (isWall(x + i, y - 1)) place(x + i, y, 0, 1);
    if (isWall(x + i, y + h)) place(x + i, y + h - 1, 0, -1);
  }
  for (let i = 1 + rng.int(0, 1); i < h - 1; i += spacing) {
    if (isWall(x - 1, y + i)) place(x, y + i, 1, 0);
    if (isWall(x + w, y + i)) place(x + w - 1, y + i, -1, 0);
  }
}

function addPillar(level, wx, wz, r, kind = 'pillar', extra = {}) {
  level.colliders.push({ x: wx, z: wz, r });
  level.props.push({ type: kind, x: wx, z: wz, r, ...extra });
}

function setRect(level, x0, y0, w, h, fn) {
  for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) if (level.inb(x, y)) fn(level.idx(x, y), x, y);
}

function decorateRoom(level, room, rng) {
  const b = level.biome;
  const { x, y, w, h } = room;
  const cx = x + w / 2, cy = y + h / 2;
  const isBoss = room.type === ROOM.BOSS;
  room.layout = 'plain';
  const P = (type, wx, wz, extra = {}) => {
    const prop = { type, x: wx, z: wz, rot: extra.rot ?? rng.range(0, Math.PI * 2), ...extra };
    if (type === 'barrel' || type === 'crate') {
      // some barrels are powder kegs: break one near a pack and it goes up in flames
      if (type === 'barrel' && !isBoss && (extra.keg || rng.chance(0.22))) type = 'keg';
      // destructible clutter: gets a collider and a stable index for co-op sync
      prop.breakable = level.breakables.length;
      const c = { x: wx, z: wz, r: type === 'crate' ? 0.45 : 0.42, h: 1.05, breakable: prop.breakable };
      level.colliders.push(c);
      level.breakables.push({ i: prop.breakable, type, x: wx, z: wz, r: c.r, collider: c, alive: true, rot: prop.rot });
      // sometimes a stack of two crates / cluster of barrels
      if (rng.chance(0.3)) {
        const ox = wx + Math.cos(prop.rot) * 0.9, oz = wz - Math.sin(prop.rot) * 0.9;
        const i2 = level.breakables.length;
        const c2 = { x: ox, z: oz, r: c.r, h: c.h, breakable: i2 };
        level.colliders.push(c2);
        level.breakables.push({ i: i2, type: type === 'keg' ? 'barrel' : type, x: ox, z: oz, r: c.r, collider: c2, alive: true, rot: prop.rot + 0.7 });
      }
      return;
    }
    level.props.push(prop);
  };
  const randFloorSpot = (margin = 1) => {
    for (let t = 0; t < 40; t++) {
      const fx = rng.int(x + margin, x + w - 1 - margin), fy = rng.int(y + margin, y + h - 1 - margin);
      const i = level.idx(fx, fy);
      if (level.cells[i] === FLOOR && level.kind[i] !== K_WATER) return [(fx + rng.range(0.2, 0.8)) * T, (fy + rng.range(0.2, 0.8)) * T];
    }
    return null;
  };
  const edgeSpot = () => {
    // a spot hugging a wall (for clutter)
    const side = rng.int(0, 3);
    let fx, fy, rot;
    if (side === 0) { fx = rng.int(x, x + w - 1); fy = y; rot = 0; }
    else if (side === 1) { fx = rng.int(x, x + w - 1); fy = y + h - 1; rot = Math.PI; }
    else if (side === 2) { fx = x; fy = rng.int(y, y + h - 1); rot = Math.PI / 2; }
    else { fx = x + w - 1; fy = rng.int(y, y + h - 1); rot = -Math.PI / 2; }
    const i = level.idx(fx, fy);
    // avoid doorways
    const nearDoor = [[0, -1], [0, 1], [-1, 0], [1, 0]].some(([dx, dy]) => level.corrId[level.idx(fx + dx, fy + dy)] >= 0 ||
      level.corrId[level.idx(fx + dx * 2, fy + dy * 2)] >= 0);
    if (nearDoor || level.cells[i] !== FLOOR) return null;
    let wx = (fx + 0.5) * T, wz = (fy + 0.5) * T;
    if (side === 0) wz -= 0.45; if (side === 1) wz += 0.45; if (side === 2) wx -= 0.45; if (side === 3) wx += 0.45;
    return [wx, wz, rot];
  };

  // ---------------- SEWERS: water channels and walkways
  if (b.id === 'sewers') {
    if (!isBoss && rng.chance(0.75) && w >= 9 && h >= 9) {
      // a channel running the long axis
      const horiz = w > h;
      const cwid = rng.int(2, 3);
      if (horiz) {
        const yy = Math.floor(cy - cwid / 2);
        setRect(level, x, yy, w, cwid, (i) => { level.kind[i] = K_WATER; level.hgt[i] = -0.7; });
        // bridges
        const bx = rng.int(x + 2, x + w - 4);
        setRect(level, bx, yy, 2, cwid, (i) => { level.kind[i] = K_ALT; level.hgt[i] = 0; });
        room.layout = 'channelH';
      } else {
        const xx = Math.floor(cx - cwid / 2);
        setRect(level, xx, y, cwid, h, (i) => { level.kind[i] = K_WATER; level.hgt[i] = -0.7; });
        const by = rng.int(y + 2, y + h - 4);
        setRect(level, xx, by, cwid, 2, (i) => { level.kind[i] = K_ALT; level.hgt[i] = 0; });
        room.layout = 'channelV';
      }
    } else if (isBoss) {
      // boss cistern: big central pool ring
      setRect(level, x + 3, y + 3, w - 6, h - 6, (i) => { level.kind[i] = K_WATER; level.hgt[i] = -0.6; });
      setRect(level, x + 6, y + 6, w - 12, h - 12, (i) => { level.kind[i] = K_ALT; level.hgt[i] = 0; });
      room.layout = 'cistern';
    }
    // pillars
    if (w >= 10 && h >= 10 && rng.chance(0.6)) {
      for (const [px, py] of [[x + 2, y + 2], [x + w - 3, y + 2], [x + 2, y + h - 3], [x + w - 3, y + h - 3]]) {
        const i = level.idx(px, py);
        if (level.kind[i] !== K_WATER) addPillar(level, (px + 0.5) * T, (py + 0.5) * T, 0.6, 'pillarSquare');
      }
    }
    for (let i = 0; i < rng.int(4, 9); i++) {
      const s = edgeSpot(); if (!s) continue;
      P(rng.pick(['barrel', 'crate', 'rubble', 'barrel', 'sack', 'bones', 'pipe']), s[0], s[1], { rot: s[2] + rng.range(-0.3, 0.3) });
    }
    for (let i = 0; i < rng.int(2, 5); i++) {
      const s = randFloorSpot(1); if (s) P(rng.pick(['grate', 'puddle', 'mushrooms', 'rubble']), s[0], s[1]);
    }
    wallTorches(level, room, rng, isBoss ? 3 : 4);
    // glowing fungus lights
    for (let i = 0; i < rng.int(1, 3); i++) {
      const s = edgeSpot(); if (!s) continue;
      P('glowshrooms', s[0], s[1], { rot: s[2] });
      level.torches.push({ x: s[0], y: 0.6, z: s[1], type: 'fungus', color: 0x60ff90, intensity: 3, range: 6 });
    }
  }

  // ---------------- DUNGEON: prison cells, pillars, torture gear
  if (b.id === 'dungeon') {
    if (!isBoss && rng.chance(0.7)) {
      // prison cell alcoves carved into one or two long walls
      const sides = rng.chance(0.5) ? [0] : [0, 1];
      for (const s of sides) {
        const horiz = w >= h;
        const len = horiz ? w : h;
        for (let i = 1; i + 2 < len - 1; i += 3) {
          const ax = horiz ? x + i : (s === 0 ? x - 2 : x + w);
          const ay = horiz ? (s === 0 ? y - 2 : y + h) : y + i;
          const aw = horiz ? 2 : 2, ah = 2;
          // only carve into solid rock not used by anything else
          let free = true;
          setRect(level, ax - 1, ay - 1, aw + 2, ah + 2, (ii) => {
            if (level.cells[ii] !== SOLID && level.roomId[ii] !== room.id) free = false;
          });
          if (!free) continue;
          setRect(level, ax, ay, aw, ah, (ii) => {
            if (level.cells[ii] !== SOLID) return;
            level.cells[ii] = FLOOR; level.roomId[ii] = room.id; level.ceil[ii] = 3.4; level.kind[ii] = K_ALT;
          });
          // bars across the opening
          const bxw = horiz ? (ax + 1) * T : (s === 0 ? (x) * T : (x + w) * T);
          const bzw = horiz ? (s === 0 ? y * T : (y + h) * T) : (ay + 1) * T;
          level.props.push({ type: 'cellBars', x: bxw, z: bzw, rot: horiz ? 0 : Math.PI / 2, len: 4 });
          level.colliders.push({ x: bxw, z: bzw, r: 0, seg: horiz ? [bxw - 2, bzw, bxw + 2, bzw] : [bxw, bzw - 2, bxw, bzw + 2] });
          const [ccx, ccz] = [(ax + 1) * T, (ay + 1) * T];
          P(rng.pick(['bones', 'hay', 'bucket', 'chains', 'skeletonSit']), ccx + rng.range(-0.6, 0.6), ccz + rng.range(-0.6, 0.6));
        }
      }
      room.layout = 'cells';
    }
    if (w >= 10 && h >= 10) {
      const nx = rng.chance(0.5) ? 2 : 3, ny = 2;
      for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) {
        const px = x + Math.round((i + 1) * w / (nx + 1)) - 0.5, py = y + Math.round((j + 1) * h / (ny + 1)) - 0.5;
        if (rng.chance(0.85)) addPillar(level, (px + 0.5) * T, (py + 0.5) * T, 0.55, 'pillarRound');
      }
    }
    for (let i = 0; i < rng.int(5, 10); i++) {
      const s = edgeSpot(); if (!s) continue;
      P(rng.pick(['barrel', 'crate', 'chains', 'rack', 'bones', 'table', 'stool', 'bucket', 'hay', 'cage']), s[0], s[1], { rot: s[2] + rng.range(-0.2, 0.2) });
    }
    for (let i = 0; i < rng.int(1, 3); i++) {
      const s = randFloorSpot(2); if (s) P(rng.pick(['bloodstain', 'rubble', 'brazierFloor']), s[0], s[1]);
    }
    if (isBoss) {
      for (const [px, py] of [[x + 3, y + 3], [x + w - 4, y + 3], [x + 3, y + h - 4], [x + w - 4, y + h - 4]]) {
        addPillar(level, (px + 0.5) * T, (py + 0.5) * T, 0.7, 'pillarRound');
      }
      P('gallows', (x + w / 2) * T, (y + 2) * T, { rot: 0 });
    }
    wallTorches(level, room, rng, 4);
  }

  // ---------------- COURTYARD: open sky, trees, statues, hedges
  if (b.id === 'courtyard') {
    // cobbled path cross through the yard
    const px0 = Math.floor(cx) - 1, py0 = Math.floor(cy) - 1;
    setRect(level, x, py0, w, 3, (i) => { level.kind[i] = K_ALT; });
    setRect(level, px0, y, 3, h, (i) => { level.kind[i] = K_ALT; });
    if (!isBoss) {
      // fights get a centrepiece to circle around; other rooms keep the middle for their feature
      if (room.type === ROOM.COMBAT || room.type === ROOM.ELITE || room.type === ROOM.TRIAL) {
        const centerPiece = rng.pick(['well', 'statue', 'fountain', 'deadTree']);
        addPillar(level, cx * T, cy * T, centerPiece === 'fountain' ? 2.2 : centerPiece === 'deadTree' ? 0.7 : 1.1, centerPiece);
        room.layout = centerPiece;
      }
      for (let i = 0; i < rng.int(3, 6); i++) {
        const s = randFloorSpot(2); if (!s) continue;
        const ii = level.idx(Math.floor(s[0] / T), Math.floor(s[1] / T));
        if (level.kind[ii] === K_ALT) continue;
        if (Math.hypot(s[0] - cx * T, s[1] - cy * T) < 5) continue;
        const t = rng.pick(['tree', 'tree', 'deadTree', 'grave', 'hayCart', 'statue']);
        addPillar(level, s[0], s[1], t === 'hayCart' ? 1.2 : t === 'grave' ? 0.4 : t === 'statue' ? 0.9 : 0.6, t);
      }
    } else {
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        addPillar(level, cx * T + Math.cos(a) * 11, cy * T + Math.sin(a) * 11, 0.9, 'ruinPillar');
      }
    }
    for (let i = 0; i < rng.int(4, 8); i++) {
      const s = edgeSpot(); if (!s) continue;
      P(rng.pick(['barrel', 'crate', 'hay', 'cart', 'weaponRack', 'rubble', 'banner']), s[0], s[1], { rot: s[2] });
    }
    // lamp posts / braziers at the corners
    for (const [px, py] of [[x + 1, y + 1], [x + w - 2, y + 1], [x + 1, y + h - 2], [x + w - 2, y + h - 2]]) {
      const [wx, wz] = level.center(px, py);
      addPillar(level, wx, wz, 0.4, 'brazier');
      level.torches.push({ x: wx, y: 1.6, z: wz, type: 'brazier' });
    }
    wallTorches(level, room, rng, 6);
  }

  // ---------------- KEEP: halls, library shelves, chandeliers
  if (b.id === 'keep') {
    const library = !isBoss && rng.chance(0.5);
    if (library && w >= 10 && h >= 10) {
      room.layout = 'library';
      // rows of bookshelves (blocking) with aisles
      const horiz = w > h;
      const rows = horiz ? Math.floor((h - 4) / 3) : Math.floor((w - 4) / 3);
      for (let r = 0; r < rows; r++) {
        if (horiz) {
          const ry = y + 2 + r * 3;
          const len = Math.floor(w * 0.35);
          for (const sx of [x + 2, x + w - 2 - len]) {
            setRect(level, sx, ry, len, 1, (i) => { level.cells[i] = BLOCK; });
            level.props.push({ type: 'shelfRow', x: (sx + len / 2) * T, z: (ry + 0.5) * T, len: len * T, rot: 0 });
          }
        } else {
          const rx = x + 2 + r * 3;
          const len = Math.floor(h * 0.35);
          for (const sy of [y + 2, y + h - 2 - len]) {
            setRect(level, rx, sy, 1, len, (i) => { level.cells[i] = BLOCK; });
            level.props.push({ type: 'shelfRow', x: (rx + 0.5) * T, z: (sy + len / 2) * T, len: len * T, rot: Math.PI / 2 });
          }
        }
      }
      for (let i = 0; i < rng.int(3, 6); i++) {
        const s = randFloorSpot(1); if (s) P(rng.pick(['bookPile', 'candles', 'bookPile', 'scrolls']), s[0], s[1]);
      }
    } else {
      room.layout = 'hall';
      // carpet runner down the long axis + colonnade
      const horiz = w > h;
      if (horiz) {
        setRect(level, x, Math.floor(cy) - 1, w, 2, (i) => { level.kind[i] = K_ALT; });
        for (let i = 2; i < w - 2; i += 3) {
          addPillar(level, (x + i + 0.5) * T, (y + 2) * T, 0.55, 'pillarRound');
          addPillar(level, (x + i + 0.5) * T, (y + h - 2) * T, 0.55, 'pillarRound');
        }
      } else {
        setRect(level, Math.floor(cx) - 1, y, 2, h, (i) => { level.kind[i] = K_ALT; });
        for (let i = 2; i < h - 2; i += 3) {
          addPillar(level, (x + 2) * T, (y + i + 0.5) * T, 0.55, 'pillarRound');
          addPillar(level, (x + w - 2) * T, (y + i + 0.5) * T, 0.55, 'pillarRound');
        }
      }
      if (!isBoss && rng.chance(0.6)) {
        const s = [cx * T + (horiz ? 0 : 3), cy * T + (horiz ? 3 : 0)];
        addPillar(level, s[0], s[1], 1.0, 'longTable', { rot: horiz ? 0 : Math.PI / 2 });
      }
    }
    for (let i = 0; i < rng.int(4, 8); i++) {
      const s = edgeSpot(); if (!s) continue;
      P(rng.pick(['armorStand', 'banner', 'chest', 'candelabra', 'bookPile', 'banner', 'painting']), s[0], s[1], { rot: s[2] });
    }
    // chandeliers
    const nCh = Math.max(1, Math.floor((w * h) / 70));
    for (let i = 0; i < nCh; i++) {
      const s = randFloorSpot(3); if (!s) continue;
      const ci = level.idx(Math.floor(s[0] / T), Math.floor(s[1] / T));
      level.props.push({ type: 'chandelier', x: s[0], z: s[1], y: level.ceil[ci] });
      level.torches.push({ x: s[0], y: level.ceil[ci] - 2.4, z: s[1], type: 'chandelier', intensity: 14, range: 16 });
    }
    wallTorches(level, room, rng, 5);
  }

  // ---------------- THRONE
  if (b.id === 'throne') {
    const horiz = false;
    setRect(level, Math.floor(cx) - 1, y, 3, h, (i) => { level.kind[i] = K_ALT; });
    const step = isBoss ? 3 : 4;
    for (let i = 2; i < h - 2; i += step) {
      addPillar(level, (x + 2) * T, (y + i + 0.5) * T, 0.8, 'pillarGrand');
      addPillar(level, (x + w - 2) * T, (y + i + 0.5) * T, 0.8, 'pillarGrand');
    }
    // colonnade gallery: two inner rows of pillars split the hall into three aisles
    if (!isBoss && w >= 12 && h >= 10 && rng.chance(0.5)) {
      room.layout = 'colonnade';
      for (let i = 3; i < h - 3; i += 3) {
        addPillar(level, (x + Math.round(w * 0.3) + 0.5) * T, (y + i + 0.5) * T, 0.7, 'pillarGrand');
        addPillar(level, (x + Math.round(w * 0.7) - 0.5) * T, (y + i + 0.5) * T, 0.7, 'pillarGrand');
      }
    }
    if (isBoss) {
      // raised dais with the throne at the north end
      setRect(level, Math.floor(cx) - 4, y + 1, 8, 4, (i) => { level.kind[i] = K_DAIS; level.hgt[i] = 0.6; });
      setRect(level, Math.floor(cx) - 3, y + 1, 6, 2, (i) => { level.hgt[i] = 1.2; });
      P('throne', cx * T, (y + 2) * T, { rot: 0, y: 1.2 });
      room.layout = 'throne';
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
        const wx = cx * T + Math.cos(a) * 9, wz = cy * T + 4 + Math.sin(a) * 9;
        addPillar(level, wx, wz, 0.5, 'brazierTall');
        level.torches.push({ x: wx, y: 2.4, z: wz, type: 'brazier', color: 0x9a5cff, intensity: 14, range: 14 });
      }
      P('stainedGlass', cx * T, (y) * T + 0.1, { rot: 0, y: 7 });
      // a cold shaft of light falls on the throne itself
      level.torches.push({ x: cx * T, y: 4.8, z: (y + 3.5) * T, type: 'brazier', color: 0xb4c8ff, intensity: 80, range: 12, priority: 0.1, noFlame: true });
      // warm fire either side of the throne so the King stands out against the purple hall
      for (const sx of [-5.5, 5.5]) {
        const wx = cx * T + sx, wz = (y + 2.5) * T;
        addPillar(level, wx, wz, 0.45, 'brazierTall');
        level.torches.push({ x: wx, y: 2.4, z: wz, type: 'brazier', color: 0xffa050, intensity: 34, range: 16, priority: true });
      }
    }
    for (let i = 0; i < rng.int(3, 6); i++) {
      const s = edgeSpot(); if (!s) continue;
      P(rng.pick(['armorStand', 'banner', 'candelabra', 'statueSmall', 'banner']), s[0], s[1], { rot: s[2] });
    }
    wallTorches(level, room, rng, 4);
  }

  // ---------------- boss arenas get braziers so the fight is well lit
  // boss arenas are big: ring the edges with braziers and add wall torches so the
  // fight's footing and walls are always readable
  if (isBoss && !b.outdoor && b.id !== 'throne') {
    const mx = x + Math.floor(w / 2), my = y + Math.floor(h / 2);
    const spots = [[x + 2, y + 2], [x + w - 3, y + 2], [x + 2, y + h - 3], [x + w - 3, y + h - 3], [mx, y + 1], [x + 1, my], [x + w - 2, my], [mx, y + h - 2]];
    spots.forEach(([px, py], k) => {
      const i = level.idx(px, py);
      if (level.cells[i] !== FLOOR || level.kind[i] === K_WATER) return;
      if (level.corrId[level.idx(px, py + 1)] >= 0 || level.corrId[level.idx(px, py - 1)] >= 0 || level.corrId[level.idx(px + 1, py)] >= 0 || level.corrId[level.idx(px - 1, py)] >= 0) return;
      const [wx, wz] = level.center(px, py);
      addPillar(level, wx, wz, 0.45, 'brazierTall');
      // sewer braziers burn mostly warm, with a couple of sickly green ones
      const color = b.id === 'sewers' && k % 3 === 1 ? 0x9adf60 : undefined;
      level.torches.push({ x: wx, y: level.hgt[i] + 2.4, z: wz, type: 'brazier', intensity: 34, range: 20, color, priority: k < 4 });
    });
  }

  // ---------------- raised daises for verticality (indoor combat rooms)
  if ((b.id === 'dungeon' || b.id === 'keep') && (room.type === ROOM.COMBAT || room.type === ROOM.ELITE || room.type === ROOM.TRIAL) && w >= 10 && h >= 10 && rng.chance(0.4) && room.layout !== 'library') {
    const side = rng.int(0, 3);
    const depth = 3;
    const hh = b.id === 'sewers' ? 0.55 : 0.7;
    const apply = (i) => { if (level.cells[i] === FLOOR && level.kind[i] !== K_WATER) { level.hgt[i] = hh; level.kind[i] = K_DAIS; } };
    if (side === 0) setRect(level, x + 2, y, w - 4, depth, apply);
    else if (side === 1) setRect(level, x + 2, y + h - depth, w - 4, depth, apply);
    else if (side === 2) setRect(level, x, y + 2, depth, h - 4, apply);
    else setRect(level, x + w - depth, y + 2, depth, h - 4, apply);
    room.dais = side;
  }

  // ---------------- mid-room cover for realms whose rooms are otherwise open floor,
  // so ranged foes can be broken line of sight with and melee can be kited around
  if ((room.type === ROOM.COMBAT || room.type === ROOM.ELITE || room.type === ROOM.TRIAL) && w >= 10 && h >= 10 && (b.id === 'sewers' || b.id === 'throne')) {
    const kind = b.id === 'sewers' ? 'pillarSquare' : 'statue';
    const rad = b.id === 'sewers' ? 0.6 : 0.85;
    const spots = rng.shuffle([[-1, -1], [1, -1], [-1, 1], [1, 1], [0, -1.3], [0, 1.3]]);
    let placed = 0;
    const want = rng.int(2, 3);
    for (const [sx, sy] of spots) {
      if (placed >= want) break;
      const fx = Math.floor(cx + sx * w * 0.2), fy = Math.floor(cy + sy * h * 0.2);
      if (fx < x + 2 || fy < y + 2 || fx > x + w - 3 || fy > y + h - 3) continue;
      const i = level.idx(fx, fy);
      if (level.cells[i] !== FLOOR || level.kind[i] === K_WATER || level.kind[i] === K_ALT) continue;
      const wx = (fx + 0.5) * T, wz = (fy + 0.5) * T;
      if (level.colliders.some((c) => c.r && Math.hypot(c.x - wx, c.z - wz) < c.r + rad + 1.6)) continue;
      addPillar(level, wx, wz, rad, kind, { rot: rng.range(0, Math.PI * 2), cover: true });
      if (b.id === 'sewers') P('rubble', wx + rng.range(-1, 1), wz + rng.range(-1, 1));
      placed++;
    }
  }

  // ---------------- sentry camps: about half the fight rooms have their first squad
  // gathered around a lit brazier, visible from the doorway, so the party can scout
  if (room.type === ROOM.COMBAT && w >= 9 && h >= 9 && rng.chance(0.5)) {
    for (let t = 0; t < 20; t++) {
      const sp = randFloorSpot(3);
      if (!sp) continue;
      const i = level.idx(Math.floor(sp[0] / T), Math.floor(sp[1] / T));
      if (level.kind[i] === K_ALT || level.kind[i] === K_WATER) continue;
      if (level.colliders.some((c) => Math.hypot((c.x ?? 1e9) - sp[0], (c.z ?? 1e9) - sp[1]) < (c.r || 0.5) + 2.6)) continue;
      addPillar(level, sp[0], sp[1], 0.5, 'brazierFloor');
      level.torches.push({ x: sp[0], y: level.hgt[i] + 1.1, z: sp[1], type: 'brazier', intensity: 26, range: 13, priority: 0.6 });
      room.sentries = true;
      room.camp = { x: sp[0], z: sp[1] };
      break;
    }
  }

  // ---------------- powder kegs out on the fighting floor (not just against the walls),
  // so every fight offers a chance to lure a pack and set one off
  if ((room.type === ROOM.COMBAT || room.type === ROOM.ELITE || room.type === ROOM.TRIAL) && w >= 9 && h >= 9) {
    const want = rng.int(1, 2);
    let placed = 0;
    for (let t = 0; t < 20 && placed < want; t++) {
      const sp = randFloorSpot(2);
      if (!sp) continue;
      const i = level.idx(Math.floor(sp[0] / T), Math.floor(sp[1] / T));
      if (level.kind[i] === K_ALT || level.kind[i] === K_WATER) continue;
      if (Math.hypot(sp[0] - cx * T, sp[1] - cy * T) < 3) continue;
      if (level.colliders.some((c) => Math.hypot((c.x ?? 1e9) - sp[0], (c.z ?? 1e9) - sp[1]) < (c.r || 0.5) + 1.6)) continue;
      P('barrel', sp[0], sp[1], { keg: true });
      placed++;
    }
  }

  // ---------------- room-type set pieces
  const mid = [cx * T, cy * T];
  if (room.type === ROOM.TREASURE) P('chest', mid[0], mid[1], { rot: 0, big: true, interact: 'chest' });
  if (room.type === ROOM.SHRINE) { addPillar(level, mid[0], mid[1], 0.9, 'shrine', { interact: 'shrine' }); }
  if (room.type === ROOM.SHOP) P('merchant', mid[0], mid[1] - 2, { rot: 0, interact: 'shop' });
  if (room.type === ROOM.START) {
    // a shaft of pale light falls through a grate above where the party arrives
    if (!b.outdoor) level.startShaft = { x: mid[0], z: mid[1] - 3, ceil: room.ceil }; // a few metres ahead of where you stand
    if (level.floorIndex === 0) P('ladder', mid[0], (y + h - 0.5) * T - 0.3, { rot: Math.PI });
    else P('stairsDown', mid[0], (y + h - 0.5) * T - 0.4, { rot: Math.PI });
  }
  if (room.type === ROOM.BOSS) {
    // exit stairs at the far (north) side appear once the boss dies
    room.exit = { x: mid[0], z: (y + 1.5) * T };
  }
}

function decorateCorridor(level, corr, rng) {
  const b = level.biome;
  let k = 0;
  for (const ci of corr.cells) {
    const x = ci % level.W, y = Math.floor(ci / level.W);
    if (b.id === 'sewers') level.kind[ci] = K_ALT;
    // sconces on corridor walls every few cells
    if ((k++ % 7) === 3) {
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        if (level.get(x + dx, y + dy) === SOLID) {
          const [wx, wz] = level.center(x, y);
          if (b.outdoor) break;
          level.torches.push({ x: wx + dx * (T / 2 - 0.15), y: 2.6, z: wz + dy * (T / 2 - 0.15), nx: -dx, nz: -dy, type: 'sconce' });
          break;
        }
      }
    }
    if (rng.chance(0.06)) {
      const [wx, wz] = level.center(x, y);
      level.props.push({ type: rng.pick(['rubble', 'bones', 'puddle']), x: wx + rng.range(-0.5, 0.5), z: wz + rng.range(-0.5, 0.5), rot: rng.range(0, 6.28) });
    }
  }
}
