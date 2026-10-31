import { T, SOLID, FLOOR, K_MAIN, K_ALT, K_WATER, ROOM, BLOCKSZ } from './levelgen.js';

// ---------------------------------------------------------------------------
// Room shaping and set pieces. A floor's rooms were boxes and its corridors tubes;
// this gives them architecture and a story:
//   bays      - arched alcoves carved out of a room's walls, each holding something
//               (a hearth, a tomb, an iron maiden, a basin fed by an outfall)
//   screens   - a dividing wall across a big hall, pierced by one wide arch or an
//               arcade, so a fight has two chambers and corners to break sight at
//   landings  - a side chamber off the middle of a long corridor (a guard post,
//               a campfire, a reading bench), so a walk between rooms has a beat
//   vignettes - a cluster of furniture in a room's corner telling what it was for
//               (a torturer's corner, a scholar's desk, a soldiers' camp, a tomb)
//   hearths   - a fireplace on a wall, a warm light low in the room
// All of it is built from the floor's seeded rng, so every co-op peer builds the same.
// Everything keeps the rooms' centres, doorways and fighting floor clear.
// ---------------------------------------------------------------------------

const FIGHT = (r) => r.type === ROOM.COMBAT || r.type === ROOM.ELITE || r.type === ROOM.TRIAL;

// a prop, and a collider for it when it stands in the way (r > 0)
function put(level, type, x, z, rot, r = 0, extra = {}) {
  level.props.push({ type, x, z, rot, ...extra });
  if (r > 0) level.colliders.push({ x, z, r });
}
const clearOf = (level, x, z, r) => !level.colliders.some((c) => c.r && Math.hypot(c.x - x, c.z - z) < c.r + r);
const corrNear = (level, cx, cy, d) => {
  for (let dy = -d; dy <= d; dy++) for (let dx = -d; dx <= d; dx++) if (level.inb(cx + dx, cy + dy) && level.corrId[level.idx(cx + dx, cy + dy)] >= 0) return true;
  return false;
};
// a cell no one has used: rock, in no room or corridor
const rock = (level, x, y) => level.inb(x, y) && level.cells[level.idx(x, y)] === SOLID && level.roomId[level.idx(x, y)] < 0 && level.corrId[level.idx(x, y)] < 0;

// ======================================================================
// BAYS
// ======================================================================
// what each realm keeps in its alcoves
const BAY_FEATURES = {
  sewers: ['basin', 'basin', 'grotto'],
  dungeon: ['maiden', 'ossuary', 'shrine'],
  courtyard: ['statue', 'stable', 'forge'],
  keep: ['hearth', 'hearth', 'study', 'statue'],
  throne: ['tomb', 'tomb', 'armory'],
};

// Carves the bays (before the realm's own decoration, so its wall clutter and prison cells keep clear of
// them). Records room.bays and the arches over their mouths (level.arches, built by the dressing pass).
export function carveBays(level, room, rng) {
  const b = level.biome;
  if (room.type === ROOM.BOSS || room.type === ROOM.SECRET || room.type === ROOM.START) return;
  const want = FIGHT(room) ? (room.w * room.h >= 150 ? rng.int(1, 2) : 1) : rng.chance(0.55) ? 1 : 0;
  if (!want) return;
  const { x, y, w, h } = room;
  const bx0 = room.mx * BLOCKSZ, by0 = room.my * BLOCKSZ;
  const inBlock = (cx, cy) => cx >= bx0 + 1 && cy >= by0 + 1 && cx < bx0 + BLOCKSZ - 1 && cy < by0 + BLOCKSZ - 1;
  room.bays = [];
  const used = [];
  for (const side of rng.shuffle([0, 1, 2, 3])) {
    if (room.bays.length >= want) break;
    const alongX = side < 2, len = alongX ? w : h;
    const bw = len >= 12 ? rng.int(2, 3) : 2, bd = b.outdoor ? 1 : rng.chance(0.55) ? 2 : 1;
    if (len < bw + 5) continue;
    // (u along the wall from the room's corner, v outward from the wall: -1 is the first rock row)
    const out = side === 0 || side === 2 ? -1 : 1;
    const C = (u, v) => {
      if (alongX) return [x + u, side === 0 ? y - 1 - v : y + h + v];
      return [side === 2 ? x - 1 - v : x + w + v, y + u];
    };
    const mouth = (u) => (alongX ? [x + u, side === 0 ? y : y + h - 1] : [side === 2 ? x : x + w - 1, y + u]);
    for (let t = 0; t < 6; t++) {
      const u0 = rng.int(2, len - 2 - bw);
      if (used.some((q) => q.side === side)) break;
      let ok = true;
      // rock all round it (and two cells of rock either side along the wall: no doorway beside it)
      for (let v = 0; v <= bd && ok; v++) for (let u = u0 - (v === 0 ? 2 : 1); u < u0 + bw + (v === 0 ? 2 : 1); u++) {
        const [cx, cy] = C(u, v);
        if (!rock(level, cx, cy) || !inBlock(cx, cy)) { ok = false; break; }
      }
      // level floor of the room's own in front of it, no water, no doorway near
      for (let u = u0 - 1; u < u0 + bw + 1 && ok; u++) {
        const [mx, my] = mouth(u), i = level.idx(mx, my);
        if (level.cells[i] !== FLOOR || level.roomId[i] !== room.id || level.hgt[i] !== 0 || level.kind[i] === K_WATER || corrNear(level, mx, my, 1)) ok = false;
      }
      if (!ok) continue;
      const feature = rng.pick(BAY_FEATURES[b.id] ?? ['statue']);
      const ceil = b.outdoor ? 99 : Math.min(room.ceil - 0.9, { keep: 5.4, throne: 6.2, courtyard: 99 }[b.id] ?? 4.3);
      const cells = [];
      for (let v = 0; v < bd; v++) for (let u = u0; u < u0 + bw; u++) {
        const [cx, cy] = C(u, v), i = level.idx(cx, cy);
        level.cells[i] = FLOOR; level.roomId[i] = room.id; level.ceil[i] = ceil;
        level.kind[i] = feature === 'basin' ? K_WATER : b.id === 'courtyard' ? K_ALT : K_MAIN;
        level.hgt[i] = feature === 'basin' ? -0.7 : 0;
        cells.push(i);
      }
      // world frame: the mouth's middle on the wall plane, n into the room, the back wall's middle
      const nx = alongX ? 0 : -out, nz = alongX ? -out : 0;
      const [m0x, m0y] = mouth(u0), [m1x, m1y] = mouth(u0 + bw - 1);
      const mcx = ((m0x + m1x) / 2 + 0.5) * T, mcz = ((m0y + m1y) / 2 + 0.5) * T;
      const px = mcx - nx * T / 2, pz = mcz - nz * T / 2; // (on the wall plane)
      const bay = {
        side, feature, cells, width: bw * T, depth: bd * T, ceil, nx, nz,
        x: px, z: pz, back: { x: px - nx * bd * T, z: pz - nz * bd * T },
        rot: Math.atan2(nx, nz), // (a prop at its back faces out of it)
      };
      room.bays.push(bay);
      used.push({ side });
      if (!b.outdoor) level.arches.push({ x: px, z: pz, nx, nz, width: bw * T, h: ceil, y0: 0, bay: true });
      break;
    }
  }
  if (!room.bays.length) room.bays = null;
}

// What stands in each bay (after the realm's decoration: its sconces and clutter are placed by then).
export function furnishBays(level, room, rng) {
  if (!room.bays) return;
  const b = level.biome;
  for (const bay of room.bays) {
    const { nx, nz, rot } = bay;
    const tx = -nz, tz = nx; // along the wall
    // a point d metres out from the back wall, s along it
    const at = (d, s = 0) => [bay.back.x + nx * d + tx * s, bay.back.z + nz * d + tz * s];
    const half = bay.width / 2;
    const glow = (d, color, intensity = 12, range = 7) => { const [lx, lz] = at(d); level.torches.push({ x: lx, y: 1.2, z: lz, type: 'brazier', noFlame: true, color, intensity, range, priority: 0.3 }); };
    const candlesAt = (d, s) => { const [cx, cz] = at(d, s); put(level, 'candles', cx, cz, rng.range(0, 6.28)); };
    switch (bay.feature) {
      case 'basin': {
        // a cistern basin fed by an outfall in its back wall (the dressing pass hangs the pipe and the sheet)
        const [gx, gz] = at(bay.depth * 0.5, rng.range(-half * 0.4, half * 0.4));
        put(level, 'rubble', gx, gz, rng.range(0, 6.28));
        break;
      }
      case 'grotto': {
        const [mx, mz] = at(0.55, -half * 0.45);
        put(level, 'glowshrooms', mx, mz, rot);
        const [m2x, m2z] = at(0.6, half * 0.5);
        put(level, 'mushrooms', m2x, m2z, rot + 0.6);
        const [bx, bz] = at(0.55);
        put(level, 'bonePile', bx, bz, rng.range(0, 6.28), 0.55);
        level.torches.push({ x: mx, y: 0.6, z: mz, type: 'fungus', color: 0x60ff90, intensity: 3, range: 6 });
        break;
      }
      case 'maiden': {
        const [ix, iz] = at(0.5, -(half - 0.55));
        put(level, 'ironMaiden', ix, iz, rot, 0.5);
        const [sx, sz] = at(0.45, half - 0.45);
        put(level, 'stocks', sx, sz, rot, 0.45);
        const [dx, dz] = at(bay.depth * 0.7);
        put(level, 'bloodstain', dx, dz, rng.range(0, 6.28));
        glow(bay.depth * 0.55, 0xff7a30, 10, 6);
        break;
      }
      case 'ossuary': {
        // (only the middle heap stops a body: the gaps between three were pockets to wedge in)
        const [px, pz] = at(0.6);
        put(level, 'bonePile', px, pz, rng.range(0, 6.28), 0.6);
        for (const s of [-1, 1]) { const [ux, uz] = at(0.5, s * (half - 0.6)); put(level, 'bonePile', ux, uz, rng.range(0, 6.28)); }
        candlesAt(1.5, 0.3);
        glow(1.4, 0xffb060, 8, 5);
        break;
      }
      case 'shrine': {
        const [px, pz] = at(0.6);
        put(level, 'statueSmall', px, pz, rot, 0.6);
        candlesAt(1.5, -0.5); candlesAt(1.4, 0.6);
        glow(1.6, 0xffb060, 9, 6);
        break;
      }
      case 'statue': {
        const [px, pz] = at(0.85);
        put(level, 'statue', px, pz, rot, 0.85);
        if (b.id !== 'courtyard') { candlesAt(1.9, -0.8); candlesAt(1.8, 0.8); glow(1.8, 0xffb060, 10, 6); }
        else { const [gx, gz] = at(1.6, half * 0.6); put(level, 'grave', gx, gz, rot); }
        break;
      }
      case 'stable': {
        const [hx, hz] = at(0.75, -(half - 0.75));
        put(level, 'hayBales', hx, hz, rot, 0.7);
        const [cx, cz] = at(0.35, half * 0.45);
        put(level, 'woodpile', cx, cz, rot);
        break;
      }
      case 'forge': {
        const [ax, az] = at(0.5, -(half - 0.5));
        put(level, 'anvil', ax, az, rot + 0.4, 0.5);
        const [fx, fz] = at(0.45, half - 0.45);
        put(level, 'brazierFloor', fx, fz, 0, 0.45);
        level.torches.push({ x: fx, y: 1.1, z: fz, type: 'brazier', intensity: 18, range: 10, priority: 0.4 });
        break;
      }
      case 'hearth': {
        const [fx, fz] = at(0.33);
        hearthAt(level, fx, fz, rot, nx, nz);
        const [cx, cz] = at(1.9, -half * 0.5);
        put(level, 'bench', cx, cz, rot + Math.PI / 2 + rng.range(-0.2, 0.2));
        break;
      }
      case 'study': {
        const [dx, dz] = at(0.6, -(half - 0.7));
        put(level, 'desk', dx, dz, rot, 0.6);
        const [gx, gz] = at(0.35, half - 0.4);
        put(level, 'globe', gx, gz, rng.range(0, 6.28), 0.35);
        const [bx, bz] = at(0.5, half * 0.75);
        put(level, 'bookPile', bx, bz, rot);
        glow(1.2, 0xffb060, 9, 6);
        break;
      }
      case 'tomb': {
        const along = bay.depth >= 4;
        // (flush with the back wall: a slot behind it was a pocket)
        const [sx, sz] = at(along ? 1.25 : 0.6);
        put(level, 'sarcophagus', sx, sz, along ? rot : rot + Math.PI / 2, 0, {});
        // (a long box: two circles cover it)
        const ax = along ? nx : tx, az = along ? nz : tz;
        level.colliders.push({ x: sx + ax * 0.6, z: sz + az * 0.6, r: 0.6 }, { x: sx - ax * 0.6, z: sz - az * 0.6, r: 0.6 });
        // (the urns stand in the back corners, out of the way: no collider, no pocket between them and the tomb)
        for (const s of [-1, 1]) { const [ux, uz] = at(0.4, s * (half - 0.4)); put(level, 'urn', ux, uz, rng.range(0, 6.28)); }
        candlesAt(along ? 3.1 : 2.2, 0);
        glow(1.5, 0xb4a0ff, 10, 7);
        break;
      }
      case 'armory': {
        for (const s of [-1, 1]) { const [ux, uz] = at(0.42, s * (half - 0.42)); put(level, 'armorStand', ux, uz, rot, 0.4); }
        const [bx, bz] = at(0.1);
        put(level, 'banner', bx, bz, rot);
        break;
      }
    }
  }
}

// a fireplace with its back to a wall at (x, z), facing (nx, nz): its light and a collider
function hearthAt(level, x, z, rot, nx, nz) {
  put(level, 'fireplace', x, z, rot);
  // (the firebox, and the jambs either side of it)
  level.colliders.push({ x: x + nx * 0.15, z: z + nz * 0.15, r: 0.75 });
  for (const s of [-1, 1]) level.colliders.push({ x: x + nx * 0.1 - nz * s * 0.86, z: z + nz * 0.1 + nx * s * 0.86, r: 0.45 });
  // (the light at the fire's own spot, so the builder lights the prop's flame rather than adding one)
  const c = Math.cos(rot), s = Math.sin(rot);
  const fx = x - 0.02 * s, fz = z - 0.02 * c;
  level.torches.push({ x: fx, y: 0.5, z: fz, type: 'brazier', color: 0xff8a3a, intensity: 24, range: 12, priority: 0.5, hearth: true });
}

// Hearths on a room's plain walls: the Keep's halls and the Throne's antechambers keep fires, and a few
// of the Oubliette's guard rooms. On a run of wall at least 6 m long, clear of doorways and sconces.
export function placeHearths(level, room, rng) {
  const b = level.biome;
  const chance = { keep: 0.5, throne: 0.3, dungeon: 0.22 }[b.id] ?? 0;
  if (!chance || room.type === ROOM.BOSS || room.type === ROOM.SECRET || room.layout === 'library' || !rng.chance(chance)) return;
  if (room.bays?.some((q) => q.feature === 'hearth')) return;
  const { x, y, w, h } = room;
  for (let t = 0; t < 14; t++) {
    const side = rng.int(0, 3), alongX = side < 2, len = alongX ? w : h;
    const u = rng.int(3, len - 4);
    if (u < 3 || u > len - 4) continue;
    const [cx, cy] = alongX ? [x + u, side === 0 ? y : y + h - 1] : [side === 2 ? x : x + w - 1, y + u];
    const [ox, oy] = alongX ? [0, side === 0 ? -1 : 1] : [side === 2 ? -1 : 1, 0];
    let ok = true;
    // a straight wall behind three cells, all the room's level floor, no doorway near
    for (let k = -1; k <= 1 && ok; k++) {
      const fx = cx + (alongX ? k : 0), fy = cy + (alongX ? 0 : k), i = level.idx(fx, fy);
      if (level.cells[i] !== FLOOR || level.roomId[i] !== room.id || level.hgt[i] !== 0 || level.kind[i] === K_WATER) ok = false;
      if (level.get(fx + ox, fy + oy) !== SOLID) ok = false;
    }
    if (!ok || corrNear(level, cx + ox, cy + oy, 2)) continue;
    const nx = -ox, nz = -oy;
    const wx = (cx + 0.5) * T + ox * (T / 2 - 0.33), wz = (cy + 0.5) * T + oy * (T / 2 - 0.33);
    if (!clearOf(level, wx + nx * 0.6, wz + nz * 0.6, 1.4)) continue;
    if (level.torches.some((q) => Math.hypot(q.x - wx, q.z - wz) < 2.2)) continue;
    if (level.props.some((q) => Math.hypot(q.x - wx, q.z - wz) < 1.3)) continue;
    hearthAt(level, wx, wz, Math.atan2(nx, nz), nx, nz);
    // and something to sit at it
    if (rng.chance(0.6)) {
      const tx = -nz, tz = nx, s = rng.sign();
      put(level, 'bench', wx + nx * 2.1 + tx * s * 0.6, wz + nz * 2.1 + tz * s * 0.6, Math.atan2(nx, nz) + rng.range(-0.15, 0.15));
    }
    room.hearth = true;
    return;
  }
}

// ======================================================================
// SCREENS: a dividing wall across a big hall
// ======================================================================
// Raised before the realm's decoration (its pillars, tables and prison cells keep clear of it).
// The wall stands across the long axis near the middle, on a cell the vault ribs don't fall on, clear
// of the doorways in the walls it meets; its arches always take in the room's centre, so everything
// that lands a body at the centre (a respawn, the spawn fallback, the gold) lands on floor.
export function raiseScreen(level, room, rng) {
  const b = level.biome;
  if (!FIGHT(room) || room.cut || (b.id !== 'dungeon' && b.id !== 'keep')) return;
  const horiz = room.w >= room.h;
  const len = horiz ? room.w : room.h, L = horiz ? room.h : room.w;
  if (len < 12 || L < 9 || !rng.chance(0.42)) return;
  const { x, y } = room;
  // (along: the long axis; across: the wall's own run, j = 0..L-1)
  const cell = (k, j) => (horiz ? [x + k, y + j] : [x + j, y + k]);
  const cands = [];
  // (on a column of the halls' colonnades, k = 2 mod 3: the screen takes the place of its pillars, where
  // beside them a pillar a metre off its face left a slot a body wedged in)
  for (let k = 4; k <= len - 5; k++) if (k % 3 === 2) cands.push(k);
  cands.sort((a, b2) => Math.abs(a - len / 2) - Math.abs(b2 - len / 2));
  let K = -1;
  for (const k of cands) {
    // no doorway in the two walls it meets, within a cell either side
    let ok = true;
    for (let d = -1; d <= 1 && ok; d++) for (const j of [-1, L]) { const [cx, cy] = cell(k + d, j); if (level.inb(cx, cy) && level.corrId[level.idx(cx, cy)] >= 0) ok = false; }
    if (ok) { K = k; break; }
  }
  if (K < 0) return;
  // the gaps: the middle (two cells, three on an odd run), and in an arcade more two-cell arches
  // either way, a cell of pier between each, none against the walls
  const gaps = new Set();
  const odd = L % 2 === 1, m = Math.floor(L / 2);
  const c0 = odd ? m - 1 : m - 1, c1 = odd ? m + 1 : m;
  for (let j = c0; j <= c1; j++) gaps.add(j);
  const arcade = L >= 12 && rng.chance(0.55);
  if (arcade) {
    for (let g = c0 - 3; g >= 2; g -= 3) { gaps.add(g); gaps.add(g + 1); }
    for (let g = c1 + 2; g + 1 <= L - 3; g += 3) { gaps.add(g); gaps.add(g + 1); }
  }
  const archH = b.id === 'keep' ? Math.min(room.ceil - 1.4, 5.6) : Math.min(room.ceil - 1.1, 4.4);
  const runs = [];
  let cur = null;
  for (let j = 0; j < L; j++) {
    const [cx, cy] = cell(K, j), i = level.idx(cx, cy);
    if (gaps.has(j)) {
      level.ceil[i] = archH;
      if (cur?.gap) cur.j1 = j; else runs.push((cur = { gap: true, j0: j, j1: j }));
      continue;
    }
    level.cells[i] = SOLID; level.roomId[i] = -1; level.ceil[i] = 0; level.kind[i] = K_MAIN; level.hgt[i] = 0;
    level.screenCells.add(i);
    if (cur && !cur.gap) cur.j1 = j; else runs.push((cur = { gap: false, j0: j, j1: j }));
  }
  // arches over the gaps on both faces, and a sconce on each face of the longer stretches of wall
  const a0 = ((horiz ? x : y) + K) * T, a1 = a0 + T; // the wall's two faces, along the long axis
  for (const r of runs) {
    const mid = ((horiz ? y : x) + (r.j0 + r.j1 + 1) / 2) * T;
    for (const [plane, n] of [[a0, -1], [a1, 1]]) {
      const [px, pz] = horiz ? [plane, mid] : [mid, plane];
      const [nx, nz] = horiz ? [n, 0] : [0, n];
      if (r.gap) level.arches.push({ x: px, z: pz, nx, nz, width: (r.j1 - r.j0 + 1) * T, h: archH, y0: 0 });
      else if (r.j1 - r.j0 >= 1 && rng.chance(0.8)) level.torches.push({ x: px + nx * 0.15, y: 2.7, z: pz + nz * 0.15, nx, nz, type: 'sconce' });
    }
  }
  room.screen = { horiz, k: K, arcade };
}

// ======================================================================
// CORRIDOR LANDINGS
// ======================================================================
const LANDINGS = {
  sewers: ['sump', 'nest'],
  dungeon: ['guard', 'ossuary', 'guard'],
  courtyard: ['camp', 'camp', 'shrine'],
  keep: ['reading', 'shrine'],
  throne: ['urns', 'shrine'],
};

// A side chamber three cells long and two deep off the middle of a long straight corridor, well clear
// of the rooms at either end (its doors and their gates), with something in it and a light.
export function corridorLanding(level, corr, rng) {
  const b = level.biome, W = level.W;
  const set = new Set(corr.cells);
  if (set.size / b.corridorWidth < 9 || !rng.chance(b.outdoor ? 0.4 : 0.55)) return;
  const roomNear = (cx, cy, d) => {
    for (let dy = -d; dy <= d; dy++) for (let dx = -d; dx <= d; dx++) if (level.inb(cx + dx, cy + dy) && level.roomId[level.idx(cx + dx, cy + dy)] >= 0) return true;
    return false;
  };
  const cand = rng.shuffle([...set]).slice(0, 48);
  for (const ci of cand) {
    const x = ci % W, y = Math.floor(ci / W);
    if (roomNear(x, y, 4)) continue;
    for (const along of rng.shuffle(['x', 'z'])) {
      const A = (d, e) => (along === 'x' ? [x + d, y + e] : [x + e, y + d]); // d along the corridor, e across it
      const inC = (d, e) => { const [cx, cy] = A(d, e); return level.inb(cx, cy) && set.has(level.idx(cx, cy)); };
      let straight = true;
      for (let d = -2; d <= 2; d++) if (!inC(d, 0)) straight = false;
      if (!straight) continue;
      for (const s of rng.shuffle([-1, 1])) {
        let e = 0;
        while (inC(0, e + s)) e += s;
        // the corridor's edge is straight where the chamber opens, and there is rock beyond it
        let ok = true;
        for (let d = -1; d <= 1 && ok; d++) if (!inC(d, e) || inC(d, e + s)) ok = false;
        for (let d = -2; d <= 2 && ok; d++) for (let k = 1; k <= 3; k++) { const [cx, cy] = A(d, e + s * k); if (!rock(level, cx, cy) || roomNear(cx, cy, 1)) { ok = false; break; } }
        if (!ok) continue;
        const cells = [];
        const ceil = b.outdoor ? 99 : b.ceilCorr + 0.7;
        for (let d = -1; d <= 1; d++) for (let k = 1; k <= 2; k++) {
          const [cx, cy] = A(d, e + s * k), i = level.idx(cx, cy);
          level.cells[i] = FLOOR; level.corrId[i] = corr.id; level.ceil[i] = ceil;
          level.kind[i] = b.id === 'sewers' ? K_ALT : K_MAIN;
          cells.push(i);
        }
        for (const i of cells) corr.cells.push(i);
        // frame: the back wall's middle, n out of it toward the corridor
        const [bcx, bcy] = A(0, e + s * 2);
        const [ox, oy] = along === 'x' ? [0, s] : [s, 0];
        const nx = -ox, nz = -oy;
        const bx = (bcx + 0.5) * T + ox * T / 2, bz = (bcy + 0.5) * T + oy * T / 2;
        furnishLanding(level, { x: bx, z: bz, nx, nz, rot: Math.atan2(nx, nz) }, rng);
        corr.landing = { x: bx, z: bz, nx, nz };
        return;
      }
    }
  }
}

function furnishLanding(level, L, rng) {
  const b = level.biome;
  const { nx, nz, rot } = L, tx = -nz, tz = nx;
  const at = (d, s = 0) => [L.x + nx * d + tx * s, L.z + nz * d + tz * s];
  const kind = rng.pick(LANDINGS[b.id] ?? ['shrine']);
  const sconce = () => { if (b.outdoor) return; const [sx, sz] = at(0.15, 0); level.torches.push({ x: sx, y: 2.6, z: sz, nx, nz, type: 'sconce' }); };
  switch (kind) {
    case 'sump': {
      const [gx, gz] = at(1.9);
      put(level, 'grate', gx, gz, rng.int(0, 3) * Math.PI / 2);
      put(level, 'puddle', gx + tx * 0.6, gz + tz * 0.6, rng.range(0, 6.28));
      const [mx, mz] = at(0.5, -1.8);
      put(level, 'glowshrooms', mx, mz, rot);
      level.torches.push({ x: mx, y: 0.6, z: mz, type: 'fungus', color: 0x60ff90, intensity: 3, range: 6 });
      const [px, pz] = at(0.5, 1.9);
      put(level, 'pipe', px, pz, rot);
      break;
    }
    case 'nest': {
      const [bx, bz] = at(0.55, -0.8);
      put(level, 'bonePile', bx, bz, rng.range(0, 6.28), 0.55);
      const [sx, sz] = at(0.6, 1.6);
      put(level, 'sack', sx, sz, rot);
      const [rx, rz] = at(1.6, 1.4);
      put(level, 'rubble', rx, rz, rng.range(0, 6.28));
      sconce();
      break;
    }
    case 'guard': {
      const [tbx, tbz] = at(0.75, -0.6);
      put(level, 'table', tbx, tbz, rot + Math.PI / 2 * (rng.chance(0.5) ? 1 : 0), 0.75);
      const [s1x, s1z] = at(1.9, -0.4);
      put(level, 'stool', s1x, s1z, rng.range(0, 6.28));
      const [rx, rz] = at(0.4, 1.9);
      put(level, 'weaponRack', rx, rz, rot);
      const [bx, bz] = at(1.2, 2.2);
      put(level, 'bucket', bx, bz, 0);
      sconce();
      break;
    }
    case 'ossuary': {
      for (const s of [-1.6, 0, 1.6]) { const [ux, uz] = at(s ? 0.7 : 0.5, s); put(level, 'bonePile', ux, uz, rng.range(0, 6.28), s ? 0 : 0.5); }
      const [cx, cz] = at(2.0, 0.3);
      put(level, 'candles', cx, cz, 0);
      level.torches.push({ x: cx, y: 1.0, z: cz, type: 'brazier', noFlame: true, color: 0xffb060, intensity: 8, range: 5, priority: 0.2 });
      break;
    }
    case 'camp': {
      const [fx, fz] = at(2.1, 0.4);
      put(level, 'campfire', fx, fz, rng.range(0, 6.28), 0.55);
      level.torches.push({ x: fx, y: 0.3, z: fz, type: 'brazier', intensity: 18, range: 11, priority: 0.4 });
      const [wx, wz] = at(0.35, -1.8);
      put(level, 'woodpile', wx, wz, rot);
      const [bx, bz] = at(1.2, 1.9);
      put(level, 'bench', bx, bz, rot + Math.PI / 2);
      break;
    }
    case 'reading': {
      const [bx, bz] = at(0.5);
      put(level, 'bench', bx, bz, rot);
      for (const s of [-1.9, 1.9]) { const [cx, cz] = at(0.3, s); put(level, 'candelabra', cx, cz, rot, 0.3); }
      const [px, pz] = at(1.3, 0.6);
      put(level, 'bookPile', px, pz, rng.range(0, 6.28));
      break;
    }
    case 'urns': {
      for (const s of [-1.8, 1.8]) { const [ux, uz] = at(0.32, s); put(level, 'urn', ux, uz, rng.range(0, 6.28), 0.32); }
      const [sx, sz] = at(0.6);
      put(level, 'statueSmall', sx, sz, rot, 0.6);
      sconce();
      break;
    }
    default: { // a wayside shrine: a small statue, candles at its feet
      const [sx, sz] = at(0.6);
      put(level, 'statueSmall', sx, sz, rot, 0.6);
      const [cx, cz] = at(1.9, 0.5);
      put(level, 'candles', cx, cz, 0);
      level.torches.push({ x: cx, y: 1.0, z: cz, type: 'brazier', noFlame: true, color: 0xffb060, intensity: 8, range: 6, priority: 0.2 });
    }
  }
}

// ======================================================================
// VIGNETTES: a corner of a room furnished for what it was
// ======================================================================
// Each piece: [type, u, v, facing ('a' back to wall A, 'b' back to wall B, or a yaw), collider r].
// u runs along wall A from the corner, v along wall B (out from wall A).
const VIGNETTES = {
  sewers: {
    nest: [['bonePile', 0.6, 0.6, 0, 0.6], ['sack', 2.7, 0.6, 'a', 0], ['bones', 1.0, 3.0, 0, 0], ['rubble', 3.0, 2.4, 0, 0], ['candles', 1.7, 0.5, 0, 0]],
  },
  dungeon: {
    torture: [['ironMaiden', 0.5, 0.5, 'a', 0.5], ['stocks', 3.3, 0.45, 'a', 0.45], ['brazierFloor', 2.3, 2.7, 0, 0.45, 'fire'], ['bloodstain', 2.4, 1.7, 0, 0], ['chains', 0.6, 2.6, 'b', 0]],
    guardroom: [['table', 2.2, 2.4, 0.3, 0.8], ['stool', 1.3, 3.2, 0, 0], ['stool', 3.2, 1.5, 0, 0], ['weaponRack', 4.1, 0.45, 'a', 0], ['bucket', 0.6, 0.6, 0, 0]],
  },
  courtyard: {
    camp: [['tent', 2.0, 1.15, 'a', 1.15], ['campfire', 2.3, 4.4, 0, 0.55, 'fire'], ['woodpile', 0.35, 4.5, 'b', 0], ['bench', 3.8, 4.9, 1.2, 0]],
    smithy: [['anvil', 2.5, 2.4, 0.5, 0.5], ['brazierFloor', 0.45, 3.9, 0, 0.45, 'fire'], ['weaponRack', 3.9, 0.45, 'a', 0], ['woodpile', 0.35, 1.2, 'b', 0]],
  },
  keep: {
    study: [['desk', 1.9, 0.6, 'a', 0.6], ['globe', 3.5, 1.3, 0, 0.35], ['bookPile', 0.6, 1.9, 0, 0], ['candelabra', 0.6, 0.6, 0, 0], ['scrolls', 3.4, 2.6, 0, 0]],
  },
  throne: {
    tomb: [['sarcophagus', 2.4, 2.4, 'a', 'long'], ['urn', 0.7, 0.7, 0, 0], ['urn', 4.1, 0.7, 0, 0], ['candles', 2.4, 4.3, 0, 0]],
  },
};

export function vignette(level, room, rng) {
  const b = level.biome;
  const sets = VIGNETTES[b.id];
  if (!sets || !FIGHT(room) || room.w < 10 || room.h < 10 || !rng.chance(0.6)) return;
  const { x, y, w, h } = room;
  const pick = rng.pick(Object.keys(sets)), list = sets[pick];
  const corners = rng.shuffle([[0, 0], [1, 0], [0, 1], [1, 1]]);
  for (const [qx, qy] of corners) {
    // origin at the room's corner; u along the north/south wall (A), v along the west/east wall (B)
    const ox = (qx ? x + w : x) * T, oz = (qy ? y + h : y) * T;
    const ux = qx ? -1 : 1, vz = qy ? -1 : 1;
    const W2 = (u, v) => [ox + u * ux, oz + v * vz];
    let ok = true;
    // the corner's cells: the room's own level floor, nothing in them, no doorway on either wall near
    for (let u = 0.5; u < 5.2 && ok; u += 1) for (let v = 0.5; v < 5.2; v += 1) {
      const [wx, wz] = W2(u, v), cx = Math.floor(wx / T), cy = Math.floor(wz / T), i = level.idx(cx, cy);
      if (level.cells[i] !== FLOOR || level.roomId[i] !== room.id || level.hgt[i] !== 0 || level.kind[i] === K_WATER) { ok = false; break; }
      if (corrNear(level, cx, cy, 1)) { ok = false; break; }
    }
    if (!ok) continue;
    const inCorner = (p) => { const du = (p.x - ox) * ux, dv = (p.z - oz) * vz; return du > 0 && dv > 0 && du < 5.4 && dv < 5.4; };
    // (the bailey's corner lamp gives way to a camp: its fire is the corner's light now)
    const lamp = b.outdoor ? level.props.find((p) => p.type === 'brazier' && inCorner(p)) : null;
    const lampCol = lamp && level.colliders.find((c) => c.x === lamp.x && c.z === lamp.z);
    for (const [, u, v, , r] of list) {
      const [wx, wz] = W2(u, v), rr = (typeof r === 'number' ? r : 1.1) + 0.5;
      if (level.colliders.some((c) => c !== lampCol && c.r && Math.hypot(c.x - wx, c.z - wz) < c.r + rr)) { ok = false; break; }
    }
    if (!ok) continue;
    if (level.props.some((p) => p !== lamp && inCorner(p))) continue;
    if (lamp) {
      level.props.splice(level.props.indexOf(lamp), 1);
      if (lampCol) level.colliders.splice(level.colliders.indexOf(lampCol), 1);
      const t = level.torches.findIndex((q) => q.type === 'brazier' && q.x === lamp.x && q.z === lamp.z);
      if (t >= 0) level.torches.splice(t, 1);
    }
    for (const [type, u, v, face, r, fire] of list) {
      const [wx, wz] = W2(u, v);
      // facing: away from wall A is +v, away from wall B is +u
      const yaw = face === 'a' ? Math.atan2(0, vz) : face === 'b' ? Math.atan2(ux, 0) : face + rng.range(-0.3, 0.3);
      if (r === 'long') {
        put(level, type, wx, wz, yaw);
        level.colliders.push({ x: wx, z: wz + vz * 0.6, r: 0.6 }, { x: wx, z: wz - vz * 0.6, r: 0.6 });
      } else put(level, type, wx, wz, yaw, r);
      if (fire) level.torches.push({ x: wx, y: type === 'campfire' ? 0.3 : 1.1, z: wz, type: 'brazier', intensity: 20, range: 11, priority: 0.4 });
    }
    room.vignette = pick;
    return;
  }
}
