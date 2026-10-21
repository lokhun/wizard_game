import * as THREE from 'three';
import { GeoBuilder, worldBox } from '../render/geo.js';
import { T, FLOOR, K_WATER, ROOM } from './levelgen.js';
import { RNG } from '../core/rng.js';
import { skullGeo, PROPS } from './props.js';

// ---------------------------------------------------------------------------
// Architectural dressing. Turns the plain wall/ceiling shell into realm
// architecture (piers, buttresses, engaged columns, vault ribs, timber beams,
// arched door portals, cornices, wainscot) and wall-hugging set dressing
// (pipes, culverts, manacles, cages, bookcases, windows, banners, niches).
// Everything is visual only: below head height it stays within ~0.36 m of the
// wall (the player is 0.38 m wide, so the fighting floor never narrows), above
// head height it may reach further out. It merges into the builder's existing
// per-material batches, so it adds triangles, not draw calls. Heavy detail is
// gated on the quality setting.
// ---------------------------------------------------------------------------

const _p = new THREE.Vector3(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0);
const _m = new THREE.Matrix4(), _e = new THREE.Euler();
// cylinder with world-scaled UVs (u around the circumference, v along the height, 2 m per repeat)
const cylG = (rt, rb, h, seg, open = false, t0 = 0, tl = Math.PI * 2) => {
  const g = new THREE.CylinderGeometry(rt, rb, h, seg, 1, open, t0, tl);
  const uv = g.getAttribute('uv'), cu = Math.max(rt, rb) * tl * 0.5, cv = h * 0.5;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * cu, uv.getY(i) * cv);
  return g;
};
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// quad that winds itself to face n (so callers never fight the winding)
function quadN(b, p0, p1, p2, p3, n, uvs = [[0, 0], [1, 0], [1, 1], [0, 1]], col = 1) {
  const ux = p1[0] - p0[0], uy = p1[1] - p0[1], uz = p1[2] - p0[2];
  const vx = p2[0] - p0[0], vy = p2[1] - p0[1], vz = p2[2] - p0[2];
  const d = (uy * vz - uz * vy) * n[0] + (uz * vx - ux * vz) * n[1] + (ux * vy - uy * vx) * n[2];
  const cs = Array.isArray(col) && Array.isArray(col[0]) ? col : [col, col, col, col];
  if (d >= 0) b.quad(p0, p1, p2, p3, n, uvs, cs);
  else b.quad(p0, p3, p2, p1, n, [uvs[0], uvs[3], uvs[2], uvs[1]], [cs[0], cs[3], cs[2], cs[1]]);
}

// Arch curve from the left spring (-hw,0) over the crown (0,rise) to (hw,0).
// Pointed (two-centred gothic) when asked and tall enough, else elliptical.
export function archCurve(hw, rise, pointed = false, n = 10) {
  const pts = [];
  if (pointed && rise > hw * 1.05) {
    const c = (rise * rise - hw * hw) / (2 * hw), R = hw + c, a1 = Math.atan2(rise, -c);
    for (let i = 0; i <= n; i++) { const a = Math.PI + (a1 - Math.PI) * (i / n); pts.push([c + R * Math.cos(a), R * Math.sin(a)]); }
    for (let i = n - 1; i >= 0; i--) pts.push([-pts[i][0], pts[i][1]]);
  } else {
    for (let i = 0; i <= 2 * n; i++) { const t = Math.PI * (1 - i / (2 * n)); pts.push([hw * Math.cos(t), rise * Math.sin(t)]); }
  }
  // outward normals (away from the arch's centre) and running length
  let L = 0;
  return pts.map((p, i) => {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
    const tx = b[0] - a[0], ty = b[1] - a[1], tl = Math.hypot(tx, ty) || 1;
    if (i > 0) L += Math.hypot(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1]);
    return { x: p[0], y: p[1], nx: -ty / tl, ny: tx / tl, l: L };
  });
}
// sub-curve between running lengths l0..l1 (linear resampling)
function subCurve(c, l0, l1, n) {
  const out = [];
  for (let i = 0; i <= n; i++) {
    const l = l0 + (l1 - l0) * (i / n);
    let k = 1;
    while (k < c.length - 1 && c[k].l < l) k++;
    const a = c[k - 1], b = c[k], t = Math.min(1, Math.max(0, (l - a.l) / Math.max(1e-6, b.l - a.l)));
    const nx = a.nx + (b.nx - a.nx) * t, ny = a.ny + (b.ny - a.ny) * t, nl = Math.hypot(nx, ny) || 1;
    out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, nx: nx / nl, ny: ny / nl, l });
  }
  return out;
}

// A band following a curve in the local XY plane: inner edge offset `in0`
// along the outward normal, outer edge `in1`, from z0 to z1. Faces: inner
// (soffit), outer (extrados, optional), front (+z), back (-z, optional), ends.
function bandGeo(curve, in0, in1, z0, z1, { outer = true, back = false, ends = false } = {}) {
  const b = new GeoBuilder();
  const P = (c, o, z) => [c.x + c.nx * o, c.y + c.ny * o, z];
  for (let i = 0; i < curve.length - 1; i++) {
    const c0 = curve[i], c1 = curve[i + 1];
    const u0 = c0.l * 0.5, u1 = c1.l * 0.5;
    const nIn0 = [-c0.nx, -c0.ny, 0];
    quadN(b, P(c0, in0, z0), P(c1, in0, z0), P(c1, in0, z1), P(c0, in0, z1), [-(c0.nx + c1.nx) / 2, -(c0.ny + c1.ny) / 2, 0], [[u0, 0], [u1, 0], [u1, (z1 - z0) * 0.5], [u0, (z1 - z0) * 0.5]]);
    if (outer) quadN(b, P(c0, in1, z0), P(c1, in1, z0), P(c1, in1, z1), P(c0, in1, z1), [(c0.nx + c1.nx) / 2, (c0.ny + c1.ny) / 2, 0], [[u0, 0], [u1, 0], [u1, (z1 - z0) * 0.5], [u0, (z1 - z0) * 0.5]]);
    quadN(b, P(c0, in0, z1), P(c1, in0, z1), P(c1, in1, z1), P(c0, in1, z1), [0, 0, 1], [[u0, 0], [u1, 0], [u1, (in1 - in0) * 0.5], [u0, (in1 - in0) * 0.5]]);
    if (back) quadN(b, P(c0, in0, z0), P(c1, in0, z0), P(c1, in1, z0), P(c0, in1, z0), [0, 0, -1], [[u0, 0], [u1, 0], [u1, (in1 - in0) * 0.5], [u0, (in1 - in0) * 0.5]]);
    void nIn0;
  }
  if (ends) for (const [c, s] of [[curve[0], -1], [curve[curve.length - 1], 1]]) {
    const tx = c.ny, ty = -c.nx; // tangent (direction of travel)
    quadN(b, P(c, in0, z0), P(c, in1, z0), P(c, in1, z1), P(c, in0, z1), [tx * s, ty * s, 0], [[0, 0], [0.3, 0], [0.3, 0.3], [0, 0.3]]);
  }
  return (b.build());
}

// Spandrel: fills the opening between an arch curve and the line y=top,
// as front/back faces plus the soffit through the thickness z0..z1.
function spandrelGeo(curve, top, z0, z1) {
  const b = new GeoBuilder();
  for (let i = 0; i < curve.length - 1; i++) {
    const a = curve[i], c = curve[i + 1];
    for (const [z, nz] of [[z1, 1], [z0, -1]]) {
      quadN(b, [a.x, a.y, z], [c.x, c.y, z], [c.x, top, z], [a.x, top, z], [0, 0, nz], [[a.x * 0.5, a.y * 0.5], [c.x * 0.5, c.y * 0.5], [c.x * 0.5, top * 0.5], [a.x * 0.5, top * 0.5]], [0.85, 0.85, 1, 1]);
    }
    quadN(b, [a.x, a.y, z0], [c.x, c.y, z0], [c.x, c.y, z1], [a.x, a.y, z1], [-(a.nx + c.nx) / 2, -(a.ny + c.ny) / 2, 0], [[a.l * 0.5, 0], [c.l * 0.5, 0], [c.l * 0.5, (z1 - z0) * 0.5], [a.l * 0.5, (z1 - z0) * 0.5]], 0.7);
  }
  return (b.build());
}

// Box whose top face is pulled back (a weathered buttress slope): front-top edge at depth d1.
function wedgeGeo(w, h, d0, d1) {
  const g = worldBox(w, h, d0);
  const p = g.getAttribute('position');
  for (let i = 0; i < p.count; i++) if (p.getY(i) > 0 && p.getZ(i) > 0) p.setZ(i, p.getZ(i) - (d0 - d1));
  g.translate(0, h / 2, d0 / 2);
  g.computeVertexNormals();
  return (g);
}

// ---------------------------------------------------------------------------
// Wall runs: maximal straight stretches of wall belonging to one room or corridor.
// ---------------------------------------------------------------------------
function buildRuns(level, wallEdges) {
  const map = new Map();
  for (const e of wallEdges) {
    const axis = e.n[0] !== 0 ? 'z' : 'x';
    const line = axis === 'z' ? e.ax : e.az;
    const s0 = axis === 'z' ? Math.min(e.az, e.bz) : Math.min(e.ax, e.bx);
    const owner = e.room >= 0 ? 'r' + e.room : 'c' + e.corr;
    const key = owner + '|' + e.n[0] + ',' + e.n[2] + '|' + line + '|' + e.h0 + '|' + e.h1;
    let list = map.get(key);
    if (!list) map.set(key, (list = []));
    list.push({ s0, e });
  }
  const runs = [];
  for (const list of map.values()) {
    list.sort((a, b) => a.s0 - b.s0);
    let cur = null;
    for (const { s0, e } of list) {
      if (cur && Math.abs(s0 - cur.a1) < 1e-3) { cur.a1 = s0 + T; cur.cells.push(e); continue; }
      const axis = e.n[0] !== 0 ? 'z' : 'x';
      cur = {
        axis, line: axis === 'z' ? e.ax : e.az, n: e.n, a0: s0, a1: s0 + T, h0: e.h0, h1: e.h1,
        room: e.room >= 0 ? level.rooms[e.room] : null, corr: e.corr, cells: [e],
      };
      runs.push(cur);
    }
  }
  for (const r of runs) { r.len = r.a1 - r.a0; r.yaw = Math.atan2(r.n[0], r.n[2]); }
  return runs;
}

export function dressLevel({ level, biome, mats, B, wallEdges, decal, quality = 'high' }) {
  // medium shares the lean geometry with low (both must stay within the old triangle budget)
  const hi = quality === 'high' || quality === 'ultra', lo = !hi, vlo = quality === 'low';
  const id = biome.id;
  const runs = buildRuns(level, wallEdges);
  const rng = new RNG(level.seed * 131 + level.floorIndex * 17 + 9);
  const out = { shafts: [], streams: null, flames: [] };
  const cache = new Map();
  const G = (key, make) => { let g = cache.get(key); if (!g) cache.set(key, (g = make())); return g; };
  const box = (w, h, d) => G(`box${w.toFixed(3)},${h.toFixed(3)},${d.toFixed(3)}`, () => worldBox(w, h, d));

  // world placement in a run's wall frame: x along the wall, y up, z out of the wall
  const runPos = (run, s, d) => (run.axis === 'x' ? _p.set(s, 0, run.line + run.n[2] * d) : _p.set(run.line + run.n[0] * d, 0, s));
  const put = (key, geo, run, s, d, y, col = 1, ry = 0, sx = 1, sy = 1, sz = 1) => {
    runPos(run, s, d); _p.y = y;
    _q.setFromAxisAngle(_up, run.yaw + ry);
    _m.compose(_p, _q, _s.set(sx, sy, sz));
    B(key).addGeometry(geo, _m, col);
  };
  // free placement with an explicit yaw
  const putW = (key, geo, x, y, z, yaw, col = 1, sx = 1, sy = 1, sz = 1) => {
    _q.setFromAxisAngle(_up, yaw);
    _m.compose(_p.set(x, y, z), _q, _s.set(sx, sy, sz));
    B(key).addGeometry(geo, _m, col);
  };
  const putM = (key, geo, m, col = 1) => B(key).addGeometry(geo, m, col);

  // pilaster stations: cell boundaries in step with the room's vault ribs / beams
  const stops = (run, margin = 1.3) => {
    const origin = run.room ? (run.axis === 'x' ? run.room.x : run.room.y) : 0;
    const want = run.room ? 2 : 0;
    const out = [];
    for (let k = Math.ceil(run.a0 / T); k * T <= run.a1 + 1e-3; k++) {
      if ((((k - origin) % 3) + 3) % 3 !== want) continue;
      const s = k * T;
      if (s - run.a0 < margin || run.a1 - s < margin) continue;
      out.push(s);
    }
    return out;
  };
  // wall-mounted props the level already placed (banners, paintings, the throne's rose window):
  // bays that hold one are left to it
  const wallProps = level.props.filter((p) => p.type === 'banner' || p.type === 'painting' || p.type === 'chains' || p.type === 'stainedGlass');
  const bays = (run, st, pad = 0.55) => {
    const xs = [run.a0 - pad + 0.2, ...st, run.a1 + pad - 0.2];
    const out = [];
    for (let i = 0; i < xs.length - 1; i++) {
      const s0 = xs[i] + pad, s1 = xs[i + 1] - pad;
      if (s1 - s0 <= 0.9) continue;
      const mid = (s0 + s1) / 2;
      runPos(run, mid, 0.5);
      const half = (s1 - s0) / 2;
      if (wallProps.some((p) => Math.hypot(p.x - _p.x, p.z - _p.z) < (p.type === 'stainedGlass' ? 3.4 : 0.9) + half)) continue;
      out.push({ s0, s1, mid, w: s1 - s0, i, n: xs.length - 1 });
    }
    return out;
  };
  const tall = (run) => run.h1 - run.h0 >= 4;
  const isRoom = (run) => !!run.room;

  // ---------------- per-room ceiling scheme
  const roomScheme = new Map(); // room.id -> { spring, rise, kind }
  const stoneVault = biome.ceilingMat && biome.ceilingMat !== 'wood';
  const woodCeil = biome.ceilingMat === 'wood';
  for (const room of level.rooms) {
    const horiz = room.w > room.h;
    const span = (horiz ? room.h : room.w) * T;
    if (biome.outdoor) { roomScheme.set(room.id, { spring: room.ceil - 1.6, kind: 'open' }); continue; }
    if (stoneVault) {
      const rise = Math.min(span / 2, id === 'throne' ? 4.5 : 3.5);
      roomScheme.set(room.id, { spring: room.ceil - rise, rise, kind: 'vault', horiz, span });
    } else roomScheme.set(room.id, { spring: room.ceil - 0.62, kind: 'beam', horiz, span });
  }

  // ======================================================================
  // ROOM CEILINGS: ribbed stone vaults or timber beams, in step with the piers
  // ======================================================================
  for (const room of level.rooms) {
    const sc = roomScheme.get(room.id);
    if (sc.kind === 'open') continue;
    const horiz = sc.horiz;
    const len = horiz ? room.w : room.h;
    const span = sc.span;
    const ribs = [];
    for (let k = 2; k < len - 1; k += 3) ribs.push(((horiz ? room.x : room.y) + k) * T);
    // across-span frame: local x runs across the room's short axis
    const yawX = horiz ? -Math.PI / 2 : 0;
    const at = (a, c) => (horiz ? [a, c] : [c, a]); // (along, across) -> (x, z)
    const midC = horiz ? room.cz : room.cx;
    if (sc.kind === 'vault') {
      const curve = archCurve(span / 2, sc.rise, false, lo ? 6 : 10);
      const ribW = id === 'throne' ? 0.55 : 0.5, ribD = id === 'throne' ? 0.5 : 0.42;
      const ribKey = id === 'sewers' ? 'wall' : 'trim';
      const ribGeo = G(`rib${span},${sc.rise}`, () => bandGeo(curve, -ribD, 0, -ribW / 2, ribW / 2, { outer: false, back: true }));
      const filGeo = id === 'throne' && !lo ? G(`fil${span},${sc.rise}`, () => bandGeo(curve, -ribD - 0.06, -ribD + 0.02, -0.12, 0.12, { outer: false, back: true })) : null;
      for (const a of ribs) {
        const [x, z] = at(a, midC);
        putW(ribKey, ribGeo, x, sc.spring, z, yawX, 0.85);
        if (filGeo) putW('gold', filGeo, x, sc.spring, z, yawX);
      }
      // ridge rib down the long axis, with carved bosses where the ribs cross it
      const L = len * T, a0 = (horiz ? room.x : room.y) * T;
      const [rx, rz] = at(a0 + L / 2, midC);
      putW(ribKey, box(L, 0.32, 0.38), rx, room.ceil - 0.16, rz, yawX + Math.PI / 2, 0.8);
      const boss = G('boss', () => new THREE.CylinderGeometry(0.34, 0.26, 0.3, 8));
      for (const a of ribs) { const [x, z] = at(a, midC); putW(id === 'throne' ? 'gold' : 'trim', boss, x, room.ceil - 0.3, z, 0); }
    } else {
      // timber: heavy tie beams on stone corbels, joists between, knee braces on the piers
      const beamH = 0.6, beamW = 0.46;
      const beam = box(beamW, beamH, span);
      const corbel = [box(0.62, 0.32, 0.62), box(0.48, 0.28, 0.42)];
      for (const a of ribs) {
        const [x, z] = at(a, midC);
        putW('wood', beam, x, room.ceil - beamH / 2, z, horiz ? 0 : Math.PI / 2);
        for (const sgn of [-1, 1]) {
          const [cx, cz] = at(a, midC + sgn * (span / 2 - 0.31));
          putW('trim', corbel[0], cx, room.ceil - beamH - 0.16, cz, 0, 0.8);
          const [cx2, cz2] = at(a, midC + sgn * (span / 2 - 0.21));
          putW('trim', corbel[1], cx2, room.ceil - beamH - 0.46, cz2, 0, 0.7);
          if (!lo) {
            // knee brace from the pier up to the beam
            const brace = box(0.16, 1.7, 0.16);
            const [bx, bz] = at(a, midC + sgn * (span / 2 - 0.62));
            _q.setFromEuler(_e.set(horiz ? -sgn * 0.72 : 0, 0, horiz ? 0 : sgn * 0.72));
            _m.compose(_p.set(bx, room.ceil - beamH - 0.62, bz), _q, _s.set(1, 1, 1));
            putM('wood', brace, _m);
          }
        }
      }
      // cross-beams (keep: a coffered grid) or rough joists (oubliette)
      if (id === 'keep') {
        const cross = [];
        const slen = horiz ? room.h : room.w;
        for (let k = 2; k < slen - 1; k += 3) cross.push(((horiz ? room.y : room.x) + k) * T);
        const L = len * T, a0 = (horiz ? room.x : room.y) * T;
        const xb = box(0.34, 0.42, L);
        for (const c of cross) {
          const [x, z] = at(a0 + L / 2, c);
          putW('wood', xb, x, room.ceil - 0.21, z, horiz ? Math.PI / 2 : 0);
          if (!lo) for (const a of ribs) { const [bx, bz] = at(a, c); putW('gold', G('kboss', () => new THREE.CylinderGeometry(0.2, 0.14, 0.16, 8)), bx, room.ceil - beamH - 0.06, bz, 0); }
        }
      } else if (!lo) {
        const L = len * T, a0 = (horiz ? room.x : room.y) * T;
        const joist = box(0.2, 0.24, L);
        for (let c = -span / 2 + 0.9; c < span / 2 - 0.5; c += hi ? 1.1 : 1.6) {
          const [x, z] = at(a0 + L / 2, midC + c);
          putW('wood', joist, x, room.ceil - 0.12, z, horiz ? Math.PI / 2 : 0, 0.8);
        }
      }
    }
  }

  // ======================================================================
  // WALL RUNS: piers / buttresses / columns, plinths, cornices, wainscot
  // ======================================================================
  // skirting along every run, and a cornice under the ceiling indoors: one long box per run
  // rather than one per 2 m wall cell
  for (const run of runs) {
    const mid = (run.a0 + run.a1) / 2;
    put('trim', box(run.len, 0.35, 0.18), run, mid, 0.08, run.h0 + 0.175, 0.75);
    if (!biome.outdoor) put('trim', box(run.len, 0.3, 0.3), run, mid, 0.14, run.h1 - 0.15, 0.8);
  }
  const runStops = new Map();
  for (const run of runs) {
    if (!tall(run)) continue;
    const sc = run.room ? roomScheme.get(run.room.id) : null;
    const top = biome.outdoor ? run.h1 : sc ? sc.spring : run.h1 - 0.7;
    const st = stops(run);
    runStops.set(run, st);
    const H = top - run.h0;
    for (const s of st) {
      if (id === 'sewers') {
        // brick pier on a rough stone plinth, stone impost where the rib springs
        put('trim', box(1.12, 0.6, 0.42), run, s, 0.21, run.h0 + 0.3, 0.8);
        put('wall', box(0.9, H - 0.6, 0.3), run, s, 0.15, run.h0 + 0.6 + (H - 0.6) / 2, 0.92);
        put('trim', box(1.08, 0.3, 0.42), run, s, 0.21, top - 0.15, 0.85);
        if (!lo) put('trim', box(0.96, 0.16, 0.36), run, s, 0.18, top - 0.38, 0.75);
      } else if (id === 'dungeon') {
        // rough buttress: a battered foot, a weathered slope, a narrower shaft up to the corbel
        put('trim', G('dbutA', () => wedgeGeo(1.15, 1.5, 0.36, 0.24)), run, s, 0, run.h0, 0.82);
        put('trim', box(0.86, H - 1.5, 0.24), run, s, 0.12, run.h0 + 1.5 + (H - 1.5) / 2, 0.9);
        put('trim', box(1.0, 0.3, 0.34), run, s, 0.17, top - 0.15, 0.75);
      } else if (id === 'courtyard') {
        // curtain-wall buttress: battered foot, two set-offs, dying into the wall below the parapet
        const h1 = Math.min(3.2, H * 0.35), h2 = Math.min(3.0, H * 0.3);
        put('trim', G('cbutA' + h1.toFixed(2), () => wedgeGeo(1.5, h1, 0.36, 0.3)), run, s, 0, run.h0, 0.85);
        put('trim', G('cbutB' + h2.toFixed(2), () => wedgeGeo(1.3, h2, 0.3, 0.18)), run, s, 0, run.h0 + h1, 0.9);
        put('trim', G('cbutC', () => wedgeGeo(1.1, 1.6, 0.18, 0.02)), run, s, 0, run.h0 + h1 + h2, 0.9);
      } else if (id === 'keep') {
        // stone pilaster with a moulded base and capital
        put('trim', box(0.9, 0.5, 0.3), run, s, 0.15, run.h0 + 0.25, 0.8);
        put('trim', box(0.7, H - 0.9, 0.2), run, s, 0.1, run.h0 + 0.5 + (H - 0.9) / 2, 0.95);
        put('trim', box(0.9, 0.22, 0.3), run, s, 0.15, top - 0.29, 0.85);
        put('trim', box(1.0, 0.18, 0.36), run, s, 0.18, top - 0.09, 0.8);
      } else if (id === 'throne') {
        // engaged column: square plinth, half-round shaft, gilded rings and capital
        const sh = G('tcol' + H.toFixed(2), () => { const g = cylG(0.42, 0.42, H - 1.5, lo ? 8 : 14, true, -Math.PI / 2, Math.PI); g.scale(1, 1, 0.82); return g; });
        put('trim', box(1.2, 0.8, 0.38), run, s, 0.19, run.h0 + 0.4, 0.75);
        put('trim', sh, run, s, 0, run.h0 + 0.8 + (H - 1.5) / 2, 0.95);
        const ring = G('tring', () => { const g = new THREE.TorusGeometry(0.43, 0.05, 4, 14, Math.PI); g.rotateX(Math.PI / 2); g.scale(1, 1, 0.82); return g; });
        if (!lo) put('gold', ring, run, s, 0, run.h0 + 0.86);
        else put('gold', box(0.9, 0.08, 0.36), run, s, 0.18, run.h0 + 0.84);
        if (!lo) put('gold', ring, run, s, 0, run.h0 + 3.2);
        put('gold', box(1.1, 0.35, 0.4), run, s, 0.2, top - 0.52);
        put('trim', box(1.24, 0.35, 0.44), run, s, 0.22, top - 0.17, 0.85);
      }
    }
    // --- continuous courses along the run
    const L = run.len, mid = (run.a0 + run.a1) / 2;
    if (id === 'sewers') {
      // a rough stone footing, stained by the water line
      put('trim', box(L, 0.55, 0.14), run, mid, 0.07, run.h0 + 0.27, 0.55);
      if (!lo && isRoom(run)) put('trim', box(L, 0.18, 0.2), run, mid, 0.1, top - 0.08, 0.8);
    } else if (id === 'dungeon') {
      put('trim', box(L, 0.7, 0.13), run, mid, 0.065, run.h0 + 0.35, 0.62);
    } else if (id === 'courtyard') {
      // batter (sloped plinth) at the foot of the curtain wall
      put('trim', G('batter' + L, () => wedgeGeo(L, 1.1, 0.3, 0.05)), run, mid, 0, run.h0, 0.75);
    } else if (id === 'keep') {
      // wainscot: dark panelling with a chair rail, stiles and a cap
      const wh = 1.55;
      put('wood', box(L, wh - 0.35, 0.05), run, mid, 0.025, run.h0 + 0.35 + (wh - 0.35) / 2, 0.95);
      put('wood', box(L, 0.1, 0.11), run, mid, 0.055, run.h0 + wh, 0.8);
      if (!lo) {
        put('wood', box(L, 0.06, 0.08), run, mid, 0.04, run.h0 + 0.42, 0.7);
        for (let s = run.a0 + 0.45; s < run.a1 - 0.2; s += 0.9) put('wood', box(0.08, wh - 0.5, 0.08), run, s, 0.04, run.h0 + 0.42 + (wh - 0.5) / 2, 0.7);
      }
      // cornice at the beam line: a stepped stone moulding
      if (isRoom(run)) {
        put('trim', box(L, 0.26, 0.2), run, mid, 0.1, top - 0.13, 0.85);
        if (!lo) put('trim', box(L, 0.14, 0.32), run, mid, 0.16, top + 0.07, 0.8);
      }
    } else if (id === 'throne') {
      // dark marble dado with a gilded rail; gilded cornice at the vault spring
      put('trim', box(L, 1.35, 0.08), run, mid, 0.04, run.h0 + 0.35 + 0.67, [0.32, 0.3, 0.34]);
      put('gold', box(L, 0.08, 0.12), run, mid, 0.06, run.h0 + 1.72);
      if (isRoom(run)) {
        put('trim', box(L, 0.3, 0.28), run, mid, 0.14, top - 0.15, 0.85);
        put('gold', box(L, 0.07, 0.31), run, mid, 0.155, top - 0.34);
        if (!lo) put('trim', box(L, 0.16, 0.38), run, mid, 0.19, top + 0.08, 0.8);
      }
    }
  }

  // ======================================================================
  // CORRIDORS: transverse arches on the piers every few cells
  // ======================================================================
  if (!biome.outdoor) {
    for (const run of runs) {
      if (run.room || !tall(run) || !(run.n[0] > 0 || run.n[2] > 0)) continue;
      for (const s of runStops.get(run) ?? []) {
        // measure the corridor's width at this station (both cells either side of the boundary)
        const k = Math.round(s / T);
        const dx = run.n[0], dz = run.n[2];
        let m = 0, ok = false;
        const c0 = run.axis === 'x' ? Math.floor((run.line + dz * 0.5) / T) : Math.floor((run.line + dx * 0.5) / T);
        for (; m < 5; m++) {
          const a = run.axis === 'x' ? [k - 1, c0 + dz * m] : [c0 + dx * m, k - 1];
          const b = run.axis === 'x' ? [k, c0 + dz * m] : [c0 + dx * m, k];
          const wa = level.get(a[0], a[1]) === FLOOR, wb = level.get(b[0], b[1]) === FLOOR;
          if (!wa && !wb) { ok = m > 0; break; }
          if (wa !== wb) break;
          if (level.roomId[level.idx(a[0], a[1])] >= 0 || level.roomId[level.idx(b[0], b[1])] >= 0) break;
        }
        if (!ok || m > 3) continue;
        const w = m * T, top = run.h1;
        const rise = Math.min(0.9, w * 0.22);
        const curve = archCurve(w / 2, rise, false, lo ? 5 : 8);
        const g = G(`carch${w},${rise}`, () => bandGeo(curve, -0.42, 0, -0.3, 0.3, { outer: false, back: true }));
        const cx = run.axis === 'x' ? s : run.line + dx * w / 2, cz = run.axis === 'x' ? run.line + dz * w / 2 : s;
        putW(id === 'sewers' ? 'wall' : 'trim', g, cx, top - rise, cz, run.axis === 'x' ? -Math.PI / 2 : 0, 0.8);
      }
    }
  }

  // ======================================================================
  // DOOR PORTALS: arched openings with voussoirs and a keystone
  // ======================================================================
  {
    const doorH = Math.min(biome.outdoor ? 6 : biome.ceilCorr, 6);
    const pointed = id === 'keep' || id === 'throne';
    for (const door of level.doors) {
      // door.cells can list a cell twice (overlapping corridor brush strokes): measure the real opening
      const width = new Set(door.cells).size * T;
      const hw = width / 2;
      const y0 = level.hgt[door.cells[0]];
      const bx = door.x - door.nx * T / 2, bz = door.z - door.ny * T / 2;
      const yaw = Math.atan2(-door.nx, -door.ny); // local +z points into the room
      const P = (lx, ly, lz) => { const c = Math.cos(yaw), s = Math.sin(yaw); return [bx + lx * c + lz * s, y0 + ly, bz - lx * s + lz * c]; };
      const place = (key, geo, lx, ly, lz, col = 1) => { const [x, y, z] = P(lx, ly, lz); putW(key, geo, x, y, z, yaw, col); };
      // jambs: plinth, pier, impost
      const rise = width > 6.5 ? 0 : pointed ? Math.min(doorH - 2.3, hw * 1.25) : Math.min(hw, doorH - 2.5);
      const spring = doorH - rise;
      for (const sg of [-1, 1]) {
        const jx = sg * (hw + 0.36);
        place('trim', box(0.98, 0.5, 0.74), jx, 0.25, 0.12, 0.75);
        place('trim', box(0.8, spring - 0.5, 0.62), jx, 0.5 + (spring - 0.5) / 2, 0.1, 0.85);
        place('trim', box(1.0, 0.3, 0.74), jx, spring - 0.12, 0.12, 0.8);
      }
      if (rise <= 0) { place('trim', box(width + 1.6, 0.7, 0.9), 0, doorH + 0.1, 0.2, 0.8); continue; }
      const curve = archCurve(hw, rise, pointed, lo ? 6 : 9);
      // spandrel (wall stone filling the corners above the arch)
      const sp = G(`spand${hw},${rise},${pointed}`, () => spandrelGeo(curve, rise + 0.01, -0.5, 0.03));
      place(id === 'sewers' || id === 'keep' ? 'wall' : 'trim', sp, 0, spring, 0, 0.9);
      // voussoirs: a ring of wedge stones; the keystone stands proud
      const nV = lo ? 7 : hw > 2.5 ? 13 : 11;
      const Ltot = curve[curve.length - 1].l;
      for (let v = 0; v < nV; v++) {
        const isKey = v === (nV - 1) / 2;
        const gap = lo ? 0 : 0.025;
        const sub = subCurve(curve, (v / nV) * Ltot + gap, ((v + 1) / nV) * Ltot - gap, lo ? 1 : 2);
        // (kept within 0.2 m of the wall so the doorway sigil, floating just in front, is never cut)
        const geo = bandGeo(sub, -0.02, isKey ? 0.72 : 0.56, -0.05, isKey ? 0.17 : 0.15, { outer: true, ends: !lo });
        const tint = isKey ? 0.95 : 0.78 + ((v * 37) % 7) * 0.025;
        place(isKey && id === 'throne' ? 'gold' : 'trim', geo, 0, spring, 0.02, tint);
      }
      // hood moulding over the ring
      if (!lo) {
        const hood = G(`hood${hw},${rise},${pointed}`, () => bandGeo(curve, 0.56, 0.7, 0, 0.13, { outer: true, ends: true }));
        place('trim', hood, 0, spring, 0.02, 0.7);
      }
    }
  }

  // ======================================================================
  // REALM SET DRESSING in the wall bays
  // ======================================================================
  const streams = new GeoBuilder(); // falling water sheets / drips (one scrolling mesh)
  // moonlit leaded glass: panes go into the existing unlit 'glow' batch (merchant potions, fungus)
  // over a dark iron backing that reads as the leading, so windows cost no extra material or draw
  const glowOK = hi || level.rooms.some((r) => r.type === ROOM.SHOP) || id === 'sewers';
  const flames = [];
  const floorY = (x, z) => level.floorAt(x, z);
  const walkRun = (run, s, d) => { runPos(run, s, d); return walkAt(_p.x, _p.z); };
  const walkAt = (x, z) => { const cx = Math.floor(x / T), cz = Math.floor(z / T); const i = level.idx(cx, cz); return level.inb(cx, cz) && level.cells[i] === FLOOR && level.kind[i] !== K_WATER; };
  // wall-space point -> world [x, y, z]
  const W3 = (run, s, d, y) => { runPos(run, s, d); return [_p.x, y, _p.z]; };
  // decal quad on the wall face (atlas column col), canvas top at the quad's top
  const wallDecal = (run, s, w, y0, y1, col, d = 0.02, tint = 1, flip = false) => {
    const u0 = col / 8 + 0.002, u1 = (col + 1) / 8 - 0.002;
    const ua = flip ? u1 : u0, ub = flip ? u0 : u1;
    quadN(decal, W3(run, s - w / 2, d, y0), W3(run, s + w / 2, d, y0), W3(run, s + w / 2, d, y1), W3(run, s - w / 2, d, y1), run.n,
      [[ua, 0], [ub, 0], [ub, 1], [ua, 1]], tint);
  };
  // decal lying on the floor in front of the wall, from depth d0 to d1
  const floorDecal = (run, s, w, d0, d1, col, tint = 1, lift = 0.02) => {
    const u0 = col / 8 + 0.002, u1 = (col + 1) / 8 - 0.002;
    runPos(run, s, (d0 + d1) / 2);
    const y = floorY(_p.x, _p.z) + lift;
    quadN(decal, W3(run, s - w / 2, d0, y), W3(run, s + w / 2, d0, y), W3(run, s + w / 2, d1, y), W3(run, s - w / 2, d1, y), [0, 1, 0],
      [[u0, 0], [u1, 0], [u1, 1], [u0, 1]], tint);
  };
  // a vertical scrolling sheet of water (u 0..0.5 dense flow, 0.5..1 sparse drops)
  const sheet = (x0, z0, x1, z1, yTop, yBot, drops = false, tint = 1) => {
    const u0 = drops ? 0.5 : 0, u1 = drops ? 1 : 0.5, v = (yTop - yBot) * 0.35;
    const nx = z1 - z0, nz = x0 - x1, nl = Math.hypot(nx, nz) || 1;
    quadN(streams, [x0, yBot, z0], [x1, yBot, z1], [x1, yTop, z1], [x0, yTop, z0], [nx / nl, 0, nz / nl], [[u0, 0], [u1, 0], [u1, v], [u0, v]], tint);
  };
  const link = G('link', () => { const t = new THREE.TorusGeometry(0.046, 0.012, 3, 5); t.scale(1, 1.35, 1); return t; });
  const chain = (run, s, d, yTop, yBot, rod = false) => {
    if (rod || lo) { const h = yTop - yBot; put('iron', G('crod' + h.toFixed(2), () => new THREE.CylinderGeometry(0.014, 0.014, h, 4)), run, s, d, yBot + h / 2); return; }
    let k = 0;
    for (let y = yTop - 0.05; y > yBot; y -= 0.09, k++) put('iron', link, run, s, d, y, 1, k % 2 ? Math.PI / 2 : 0);
  };
  const chainW = (x, z, yTop, yBot) => {
    if (lo) { const h = yTop - yBot; putW('iron', G('crod' + h.toFixed(2), () => new THREE.CylinderGeometry(0.014, 0.014, h, 4)), x, yBot + h / 2, z, 0); return; }
    let k = 0;
    for (let y = yTop - 0.05; y > yBot; y -= 0.09, k++) putW('iron', link, x, y, z, k % 2 ? Math.PI / 2 : 0);
  };
  const leaded = (run, s, hw, y0, spring, rise, curve, col = 1) => {
    // dark backing: a fan from the rectangle up into the point
    const g = new GeoBuilder();
    const V = (x, y) => [x, y, 0.03];
    const top = spring + rise;
    quadN(g, V(-hw, y0), V(hw, y0), V(hw, spring), V(-hw, spring), [0, 0, 1], [[0, 0], [1, 0], [1, 1], [0, 1]], 0.12);
    if (curve) for (let i = 0; i < curve.length - 1; i++) {
      const a = curve[i], b = curve[i + 1];
      quadN(g, V(a.x, spring + a.y), V(b.x, spring + b.y), V(b.x * 0.001, top), V(a.x * 0.001, top), [0, 0, 1], [[0, 0], [1, 0], [1, 1], [0, 1]], 0.12);
    }
    runPos(run, s, 0); _q.setFromAxisAngle(_up, run.yaw); _m.compose(_p.setY(0), _q, _s.set(1, 1, 1));
    B('iron').addGeometry(g.build(), _m);
    if (!glowOK) return;
    // panes: a grid clipped to the window's outline, brighter toward the head, the odd ruby quarry
    const archY = (x) => {
      if (!curve) return spring;
      const ax = Math.abs(x);
      for (let i = Math.floor(curve.length / 2); i < curve.length - 1; i++) {
        const a = curve[i], b = curve[i + 1];
        if (ax >= a.x && ax <= b.x) return spring + a.y + (b.y - a.y) * ((ax - a.x) / Math.max(1e-6, b.x - a.x));
      }
      return spring;
    };
    const pg = new GeoBuilder();
    const cols = Math.max(2, Math.round((hw * 2) / (lo ? 0.42 : 0.24))), pw = (hw * 2) / cols, ph = pw * 1.35, gap = 0.035;
    const tint = id === 'throne' ? [0.95, 0.8, 1.15] : [0.85, 0.95, 1.1];
    for (let y = y0; y < top - 0.05; y += ph) for (let c = 0; c < cols; c++) {
      const xa = -hw + c * pw + gap / 2, xb = xa + pw - gap, ya = y + gap / 2, yb = Math.min(y + ph - gap / 2, top);
      if (yb > archY(xa) || yb > archY(xb)) continue;
      const t = (ya - y0) / Math.max(0.1, top - y0), v = (0.75 + rng.next() * 0.4) * col;
      const ruby = id !== 'dungeon' && rng.chance(0.05);
      const k = ruby ? [0.2, 0.03, 0.05] : [(0.05 + 0.11 * t) * tint[0], (0.065 + 0.13 * t) * tint[1], (0.11 + 0.17 * t) * tint[2]];
      const cc = [k[0] * v, k[1] * v, k[2] * v];
      quadN(pg, [xa, ya, 0.045], [xb, ya, 0.045], [xb, yb, 0.045], [xa, yb, 0.045], [0, 0, 1], undefined, cc);
    }
    if (pg.count) B('glow').addGeometry(pg.build(), _m);
  };
  const lancet = (run, s, w, y0, y1, frameKey, col = 1) => {
    // a tall pointed window: stone jambs, sill, a pointed hood, a mullion, moonlit glass
    const hw = w / 2, rise = Math.min(hw * 1.5, (y1 - y0) * 0.4), spring = y1 - rise;
    const curve = archCurve(hw, rise, true, lo ? 4 : 7);
    leaded(run, s, hw, y0, spring, rise, curve, col);
    // stonework
    for (const sg of [-1, 1]) put(frameKey, box(0.22, spring - y0, 0.26), run, s + sg * (hw + 0.11) * (run.axis === 'x' ? 1 : 1), 0.13, y0 + (spring - y0) / 2, 0.85);
    put(frameKey, box(w + 0.6, 0.18, 0.36), run, s, 0.18, y0 - 0.09, 0.8);
    put(frameKey, G(`lhood${w},${rise}`, () => bandGeo(curve, 0, 0.2, 0, 0.24, { outer: true, ends: true })), run, s, 0, spring, 0.85);
    if (w > 1.1) put(frameKey, box(0.1, y1 - y0 - 0.1, 0.12), run, s, 0.07, y0 + (y1 - y0 - 0.1) / 2, 0.8);
    if (!lo) put(frameKey, box(w, 0.08, 0.1), run, s, 0.06, y0 + (spring - y0) * 0.55, 0.8);
  };
  // hanging cloth (banner / tapestry) with a woven pattern in vertex colours
  const cloth = (run, s, w, yTop, h, base, accent, { swallow = false, border = true, d = 0.05 } = {}) => {
    const g = new GeoBuilder();
    const nx = lo ? 3 : 6, ny = lo ? 4 : 10;
    const bc = new THREE.Color(base), ac = new THREE.Color(accent);
    for (let j = 0; j <= ny; j++) for (let i = 0; i <= nx; i++) {
      const u = i / nx, v = j / ny;
      let y = -v * h;
      const x = (u - 0.5) * w;
      if (swallow && j === ny) y += (1 - Math.abs(u - 0.5) * 2) * h * 0.14;
      const z = Math.sin(u * 7 + v * 3) * 0.03 + v * 0.04;
      // border bands, a central lozenge, darker toward the hem
      const edge = Math.min(u, 1 - u) * w, top = v * h;
      const lz = Math.abs(u - 0.5) * 2 + Math.abs(v - 0.42) * 2.2;
      let c = bc.clone();
      if (border && (edge < 0.14 || top < 0.18)) c = ac.clone().multiplyScalar(0.8);
      else if (lz < 0.55 && lz > 0.3) c = ac.clone();
      c.multiplyScalar(1 - v * 0.35);
      g.vert(x, yTop + y, z, 0, 0, 1, u * w * 0.5, v * h * 0.5, [c.r, c.g, c.b]);
    }
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      const a = j * (nx + 1) + i;
      g.tri(a, a + nx + 1, a + 1); g.tri(a + 1, a + nx + 1, a + nx + 2);
    }
    put('banner', g.build(), run, s, d, 0);
    put('iron', G('brod' + w.toFixed(2), () => { const c = new THREE.CylinderGeometry(0.025, 0.025, w + 0.3, 5); c.rotateZ(Math.PI / 2); return c; }), run, s, d + 0.02, yTop + 0.03);
    for (const sg of [-1, 1]) put('gold', G('bfin', () => new THREE.SphereGeometry(0.05, 6, 4)), run, s + sg * (w / 2 + 0.17), d + 0.02, yTop + 0.03);
  };

  // ---------------------------------------------------------------- sewers
  if (id === 'sewers') {
    for (const run of runs) {
      if (!tall(run)) continue;
      const st = runStops.get(run) ?? [];
      const mid = (run.a0 + run.a1) / 2;
      // a cast-iron main along some walls, on brackets, flanged at the joints
      if (run.len >= 6 && rng.chance((isRoom(run) ? 0.4 : 0.55) * (lo ? 0.55 : 1))) {
        const r = rng.range(0.13, 0.2), d = 0.4 + r, y = Math.min(run.h1 - 0.8, run.h0 + rng.range(2.7, 3.3));
        put('iron', G(`pipe${run.len},${r.toFixed(3)}`, () => { const c = cylG(r, r, run.len, lo ? 6 : 10, true); c.rotateZ(Math.PI / 2); return c; }), run, mid, d, y, 0.9);
        const fl = G('fl' + r.toFixed(3), () => { const t = new THREE.TorusGeometry(r + 0.02, 0.035, 4, lo ? 6 : 10); t.rotateY(Math.PI / 2); return t; });
        for (let s = run.a0 + 1.2; s < run.a1 - 0.6; s += 2.4) {
          if (!lo) put('iron', fl, run, s, d, y);
          put('iron', box(0.07, 0.07, d), run, s + 0.3, d / 2, y - r - 0.04);
          put('iron', box(0.07, r * 2 + 0.12, 0.05), run, s + 0.3, 0.03, y - 0.02);
          if (rng.chance(0.5)) wallDecal(run, s + 0.3, 0.5, Math.max(run.h0 + 0.3, y - 2.4), y - 0.1, 6, 0.018, 0.85);
        }
      }
      for (const bay of bays(run, st)) {
        const r = rng.next();
        const s = bay.mid;
        if (isRoom(run) && r < 0.22 && bay.w >= 1.9) {
          // culvert: a barred, arched drain mouth at the foot of the wall
          wallDecal(run, s, 1.5, run.h0, run.h0 + 1.75, 5, 0.025, 1);
          const curve = archCurve(0.62, 0.42, false, lo ? 4 : 6);
          put('trim', G('culv', () => bandGeo(curve, 0, 0.24, 0, 0.16, { outer: true, ends: true })), run, s, 0, run.h0 + 0.98, 0.8);
          for (const sg of [-1, 1]) put('trim', box(0.24, 0.98, 0.16), run, s + sg * 0.74, 0.08, run.h0 + 0.49, 0.75);
          for (let k = -2; k <= 2; k++) put('iron', G('cbar', () => new THREE.CylinderGeometry(0.022, 0.022, 1.3, 4)), run, s + k * 0.22, 0.09, run.h0 + 0.65);
          put('iron', box(1.3, 0.05, 0.05), run, s, 0.09, run.h0 + 0.75);
          if (walkRun(run, s, 0.8)) floorDecal(run, s, 1.6, 0.1, 1.7, 1, 0.8);
        } else if (r < 0.42) {
          // outfall: a pipe mouth spilling a sheet of foul water down the wall
          const y = run.h0 + rng.range(1.3, 2.2);
          put('iron', G('ofp', () => { const c = cylG(0.2, 0.2, 0.46, lo ? 6 : 10, true); c.rotateX(Math.PI / 2); return c; }), run, s, 0.23, y, 0.9);
          put('iron', G('ofr', () => new THREE.TorusGeometry(0.21, 0.04, 4, lo ? 6 : 10)), run, s, 0.46, y);
          put('trim', box(0.7, 0.7, 0.08), run, s, 0.04, y, 0.7);
          const [ax, , az] = W3(run, s - 0.14, 0.5, 0), [bx, , bz] = W3(run, s + 0.14, 0.5, 0);
          sheet(ax, az, bx, bz, y - 0.12, run.h0 + 0.02, false, 1);
          const [cx, , cz] = W3(run, s, 0.36, 0), [dx2, , dz2] = W3(run, s, 0.64, 0);
          sheet(cx, cz, dx2, dz2, y - 0.12, run.h0 + 0.02, false, 0.8);
          wallDecal(run, s, 0.9, run.h0 + 0.05, y - 0.05, 1, 0.018, 1);
          floorDecal(run, s, 1.3, 0.05, 1.5, 1, 0.9);
        } else if (r < 0.66) {
          // downpipe from the vault to the floor, strapped to the wall, with a shoe at the foot
          const x = s + rng.range(-0.4, 0.4), top = run.h1 - 0.1, bot = run.h0 + 0.42;
          put('iron', G('dp' + (top - bot).toFixed(2), () => cylG(0.1, 0.1, top - bot, lo ? 5 : 8, true)), run, x, 0.24, (top + bot) / 2, 0.9);
          put('iron', G('dpe', () => { const c = new THREE.CylinderGeometry(0.1, 0.1, 0.4, lo ? 5 : 8, 1, true); c.rotateX(Math.PI / 2); return c; }), run, x, 0.38, bot - 0.04, 0.9);
          for (let y = bot + 0.8; y < top - 0.3; y += 1.4) put('iron', box(0.3, 0.06, 0.3), run, x, 0.15, y);
          wallDecal(run, x, 0.55, run.h0 + 0.1, bot + 1.8, 6, 0.018, 0.9);
        } else if (r < 0.78 && !lo) {
          // a seep: moss and a trickle of drips from a crack high on the wall
          wallDecal(run, s, 1.1, run.h0 + 0.1, run.h1 - 0.4, 1, 0.017, 0.9);
          const [ax, , az] = W3(run, s - 0.05, 0.06, 0), [bx, , bz] = W3(run, s + 0.05, 0.06, 0);
          sheet(ax, az, bx, bz, run.h1 - 0.6, run.h0 + 0.02, true, 1);
        }
      }
    }
    // drips falling from the vault into the channels
    if (!lo) {
      for (const room of level.rooms) {
        if (room.layout !== 'channelH' && room.layout !== 'channelV' && room.layout !== 'cistern') continue;
        for (let k = 0; k < (hi ? 6 : 3); k++) {
          const x = (room.x + rng.range(1, room.w - 1)) * T, z = (room.y + rng.range(1, room.h - 1)) * T;
          const cx = Math.floor(x / T), cz = Math.floor(z / T);
          if (level.kind[level.idx(cx, cz)] !== K_WATER) continue;
          sheet(x - 0.04, z, x + 0.04, z, room.ceil - 0.05, -0.25, true, 1.2);
          sheet(x, z - 0.04, x, z + 0.04, room.ceil - 0.05, -0.25, true, 1.2);
        }
      }
    }
  }

  // ---------------------------------------------------------------- oubliette
  if (id === 'dungeon') {
    const cuff = G('cuff', () => { const t = new THREE.TorusGeometry(0.065, 0.018, lo ? 3 : 4, lo ? 6 : 8); t.rotateX(Math.PI / 2); return t; });
    const plate = box(0.14, 0.2, 0.04);
    for (const run of runs) {
      if (!tall(run)) continue;
      const st = runStops.get(run) ?? [];
      const northRun = run.n[2] === 1 && run.axis === 'x';
      for (const bay of bays(run, st)) {
        const s = bay.mid;
        if (northRun && isRoom(run) && bay.w >= 1.4 && run.h1 - run.h0 >= 5 && rng.chance(0.45)) {
          // a barred light-well high in the wall: the only glimpse of the night outside
          const y1 = run.h1 - 0.85, y0 = y1 - 1.05, hw = 0.42;
          leaded(run, s, hw, y0, y1, 0, null, 0.55);
          for (const sg of [-1, 1]) put('trim', box(0.24, y1 - y0 + 0.3, 0.3), run, s + sg * (hw + 0.12), 0.15, (y0 + y1) / 2, 0.75);
          put('trim', box(hw * 2 + 0.7, 0.24, 0.36), run, s, 0.18, y0 - 0.12, 0.7);
          put('trim', box(hw * 2 + 0.7, 0.26, 0.32), run, s, 0.16, y1 + 0.13, 0.8);
          for (let k = -1; k <= 1; k++) put('iron', G('wbar', () => new THREE.CylinderGeometry(0.025, 0.025, 1.1, 5)), run, s + k * 0.24, 0.12, (y0 + y1) / 2);
          put('iron', box(hw * 2, 0.05, 0.05), run, s, 0.12, y0 + 0.5);
          if (hi) out.shafts.push({ x: s, z: run.line + 0.2, top: y1 - 0.15, w: 0.95 });
          wallDecal(run, s, 1.2, run.h0 + 0.6, y0 - 0.1, 0, 0.017, 0.8);
        }
        // one or two features per bay: manacles, niches, rings, a gibbet cage overhead
        let caged = false;
        for (const s of hi && bay.w >= 3.6 ? [bay.s0 + bay.w * 0.27, bay.s1 - bay.w * 0.27] : [bay.mid]) {
          const r = rng.next();
          if (r < 0.3) {
            // a pair of manacles hanging from wall plates, rust bleeding below them
            for (const sg of [-1, 1]) {
              const x = s + sg * 0.34, yTop = run.h0 + 2.15 + rng.range(-0.05, 0.05), yBot = yTop - rng.range(0.35, 0.6);
              put('iron', plate, run, x, 0.02, yTop + 0.06);
              chain(run, x, 0.07, yTop, yBot);
              put('iron', cuff, run, x, 0.1, yBot - 0.05, 1, rng.range(0, 3));
            }
            wallDecal(run, s, 1.1, run.h0 + 0.6, run.h0 + 2.25, 6, 0.017, 0.8);
            // now and then the last prisoner is still in them, slumped against the wall
            if (hi && isRoom(run) && rng.chance(0.4)) for (const [k, g] of G('skel', () => PROPS.skeletonSit(() => 0.5))) put(k, g, run, s, 0.1, run.h0, 0.9);
            else if (isRoom(run) && rng.chance(0.4)) put('bone', G('skull', skullGeo), run, s + 0.1, 0.25, run.h0 + 0.09, 1, rng.range(-1, 1));
          } else if (r < 0.44 && bay.w >= 1.3) {
            // an ossuary niche: a dark arched recess with skulls and a guttering candle on its sill
            const y0 = run.h0 + 1.15;
            wallDecal(run, s, 0.95, y0, y0 + 1.05, 5, 0.02, 1);
            put('trim', box(1.05, 0.1, 0.3), run, s, 0.15, y0, 0.8);
            put('trim', G('nichearch', () => bandGeo(archCurve(0.4, 0.28, false, 5), 0, 0.12, 0, 0.12, { outer: true, ends: true })), run, s, 0, y0 + 0.66, 0.75);
            for (let k = 0; k < (hi ? 3 : 2); k++) put('bone', G('skull', skullGeo), run, s - 0.28 + k * 0.27, 0.13, y0 + 0.13, 0.9, rng.range(-0.4, 0.4));
            put('bone', G('cstub', () => new THREE.CylinderGeometry(0.03, 0.035, 0.12, 5)), run, s + 0.38, 0.16, y0 + 0.11, [1.3, 1.25, 1.1]);
            const [fx, fy, fz] = W3(run, s + 0.38, 0.16, y0 + 0.2);
            flames.push({ x: fx, y: fy, z: fz, size: 0.25, kind: 'candle' });
          } else if (r < 0.58) {
            // an iron ring with a length of chain looped down from it
            const y = run.h0 + rng.range(1.5, 1.9);
            put('iron', box(0.08, 0.1, 0.05), run, s, 0.025, y + 0.05);
            put('iron', G('ring', () => new THREE.TorusGeometry(0.11, 0.02, lo ? 3 : 4, lo ? 8 : 12)), run, s, 0.05, y - 0.07);
            if (rng.chance(0.5)) chain(run, s + 0.08, 0.06, y - 0.15, run.h0 + 0.05);
            wallDecal(run, s, 0.5, run.h0 + 0.2, y, 6, 0.017, 0.7);
          } else if (r < 0.74 && !caged && isRoom(run) && run.h1 - run.h0 >= 5.3) {
            caged = true;
            // a gibbet cage hung from the joists, a prisoner's bones slumped in it
            const d = 1.65, yB = run.h0 + 3.15, ch = 1.3;
            for (let k = 0; k < (lo ? 6 : 9); k++) {
              const a = (k / (lo ? 6 : 9)) * Math.PI * 2;
              put('iron', G('cgbar', () => new THREE.CylinderGeometry(0.018, 0.018, ch, 4)), run, s + Math.cos(a) * 0.42, d + Math.sin(a) * 0.42, yB + ch / 2);
            }
            const hoop = G('choop', () => { const t = new THREE.TorusGeometry(0.42, 0.025, lo ? 3 : 4, lo ? 8 : 14); t.rotateX(Math.PI / 2); return t; });
            put('iron', hoop, run, s, d, yB + 0.02); if (!lo) put('iron', hoop, run, s, d, yB + ch * 0.55); put('iron', hoop, run, s, d, yB + ch);
            put('iron', G('cdome', () => new THREE.ConeGeometry(0.44, 0.38, lo ? 8 : 12, 1, true)), run, s, d, yB + ch + 0.19);
            put('iron', box(0.9, 0.04, 0.9), run, s, d, yB);
            chain(run, s, d, run.h1 - 0.02, yB + ch + 0.34, !hi);
            put('bone', G('skull', skullGeo), run, s + 0.1, d - 0.05, yB + 0.14, 1, 0.6);
            put('bone', G('cbone', () => { const c = new THREE.CylinderGeometry(0.022, 0.022, 0.5, 5); c.rotateZ(1.3); return c; }), run, s - 0.08, d + 0.1, yB + 0.06);
          }
        }
        // straw drifts and drains at the foot of the walls
        if (isRoom(run)) {
          const r2 = rng.next();
          if (r2 < 0.35) floorDecal(run, s + rng.range(-0.4, 0.4), rng.range(1.6, 2.6), 0.08, rng.range(1.1, 1.8), 4, rng.range(0.6, 0.85));
          else if (r2 < 0.45 && !lo) {
            const [gx, , gz] = W3(run, s, 0.62, 0);
            if (walkAt(gx, gz)) {
              put('iron', box(0.7, 0.03, 0.5), run, s, 0.62, floorY(gx, gz) + 0.015, 0.8);
              for (let k = -2; k <= 2; k++) put('iron', box(0.05, 0.035, 0.46), run, s + k * 0.13, 0.62, floorY(gx, gz) + 0.03);
              floorDecal(run, s, 1.2, 0.2, 1.1, 0, 0.9, 0.012);
            }
          }
        }
      }
    }
    // chains hanging from the tie beams
    if (!lo) for (const room of level.rooms) {
      const sc = roomScheme.get(room.id);
      if (sc.kind !== 'beam' || room.type === ROOM.START) continue;
      const horiz = sc.horiz, len = horiz ? room.w : room.h;
      for (let k = 2; k < len - 1; k += 3) {
        if (!rng.chance(0.5)) continue;
        const a = ((horiz ? room.x : room.y) + k) * T, c = (horiz ? room.cz : room.cx) + rng.range(-sc.span * 0.3, sc.span * 0.3);
        const x = horiz ? a : c, z = horiz ? c : a;
        const yB = room.ceil - 0.6 - rng.range(1.0, 2.2);
        if (hi) chainW(x, z, room.ceil - 0.6, yB);
        else putW('iron', G('crod' + (room.ceil - 0.6 - yB).toFixed(2), () => new THREE.CylinderGeometry(0.014, 0.014, room.ceil - 0.6 - yB, 4)), x, (room.ceil - 0.6 + yB) / 2, z, 0);
        putW('iron', G('hook', () => new THREE.TorusGeometry(0.08, 0.016, 4, 8, Math.PI * 1.4)), x, yB - 0.05, z, rng.range(0, 3));
      }
    }
  }

  // ---------------------------------------------------------------- hall of whispers
  if (id === 'keep') {
    const spines = [0x4a1612, 0x1a2640, 0x24341a, 0x3e2a14, 0x341430, 0x5a4a30, 0x2a1a10, 0x16201c];
    // unit book: x -0.5..0.5 along the shelf, y 0..1 up, z 0..1 out; the top and side are shaded darker
    const bookGeo = G('book', () => {
      const g = new GeoBuilder();
      quadN(g, [-0.5, 0, 1], [0.5, 0, 1], [0.5, 1, 1], [-0.5, 1, 1], [0, 0, 1], [[0, 0], [0.1, 0], [0.1, 0.4], [0, 0.4]], 1);
      quadN(g, [-0.5, 1, 0], [0.5, 1, 0], [0.5, 1, 1], [-0.5, 1, 1], [0, 1, 0], [[0, 0], [0.1, 0], [0.1, 0.3], [0, 0.3]], 0.7);
      quadN(g, [-0.5, 0, 0], [-0.5, 0, 1], [-0.5, 1, 1], [-0.5, 1, 0], [-1, 0, 0], [[0, 0], [0.3, 0], [0.3, 0.4], [0, 0.4]], 0.6);
      return g.build();
    });
    const bookcase = (run, s0, s1, h) => {
      const w = s1 - s0, s = (s0 + s1) / 2, D = 0.36;
      put('wood', box(w, h, 0.03), run, s, 0.015, run.h0 + h / 2, 0.45);
      for (const e of [s0 + 0.03, s1 - 0.03]) put('wood', box(0.06, h, D), run, e, D / 2, run.h0 + h / 2, 0.8);
      put('wood', box(w + 0.12, 0.1, D + 0.04), run, s, (D + 0.04) / 2, run.h0 + h + 0.05, 0.85);
      if (!lo) put('wood', box(w + 0.22, 0.12, D + 0.1), run, s, (D + 0.1) / 2, run.h0 + h + 0.16, 0.7);
      put('wood', box(w, 0.16, D), run, s, D / 2, run.h0 + 0.08, 0.6);
      const nSh = Math.floor((h - 0.2) / 0.56);
      for (let k = 0; k <= nSh; k++) {
        const y = run.h0 + 0.16 + k * 0.56;
        put('wood', box(w - 0.1, 0.04, D - 0.02), run, s, D / 2, y, 0.75);
        if (k === nSh) break;
        // books: spine + top + one side per book, leaning or stacked now and then
        let x = s0 + 0.08;
        while (x < s1 - 0.1) {
          if (lo) {
            const bw = Math.min(s1 - 0.08 - x, 0.3 + rng.next() * 0.4), bh = 0.36 + rng.next() * 0.1;
            const c = new THREE.Color(spines[rng.int(0, spines.length - 1)]);
            put('leather', G('ublk', () => worldBox(1, 1, 1, 0.2)), run, x + bw / 2, 0.16, y + 0.02 + bh / 2, [c.r * 2, c.g * 2, c.b * 2], 0, bw, bh, 0.26);
            x += bw + 0.01; continue;
          }
          if (rng.chance(0.06)) { x += 0.12 + rng.next() * 0.2; continue; }
          const bw = 0.035 + rng.next() * 0.055, bh = 0.28 + rng.next() * 0.2, bd = 0.22 + rng.next() * 0.08;
          if (x + bw > s1 - 0.1) break;
          const c = new THREE.Color(spines[rng.int(0, spines.length - 1)]).multiplyScalar(1.6 + rng.next() * 0.8);
          // one shared unit book (spine, top, one side) stretched into place
          put('leather', bookGeo, run, x + bw / 2, 0.04, y + 0.02, [c.r, c.g, c.b], 0, bw, bh, bd);
          x += bw + 0.004;
        }
      }
    };
    const tapestryCols = [[0x7a1a20, 0xc89a40], [0x22386e, 0xb89a50], [0x2e4a24, 0xc89a40], [0x5a1e58, 0xd0a850]];
    for (const run of runs) {
      if (!tall(run)) continue;
      const st = runStops.get(run) ?? [];
      const sc = run.room ? roomScheme.get(run.room.id) : null;
      const top = sc ? sc.spring : run.h1 - 0.7;
      const library = run.room && run.room.layout === 'library';
      const northRun = run.n[2] === 1 && run.axis === 'x';
      for (const bay of bays(run, st, 0.5)) {
        const s = bay.mid;
        if (run.room && (library || (bay.i % 2 === 1 && rng.chance(0.5)))) {
          bookcase(run, bay.s0 + 0.05, bay.s1 - 0.05, Math.min(library ? 3.7 : 2.4, top - run.h0 - 1.6));
          if (library && !lo && rng.chance(0.5)) floorDecal(run, s + rng.range(-0.5, 0.5), 1.2, 0.5, 1.6, 7, 0.9, 0.015);
          continue;
        }
        if (!run.room) {
          if (rng.chance(0.3)) { // a portrait in the corridor
            const pw = Math.min(1.2, bay.w * 0.6), ph = pw * 1.3;
            put('gold', box(pw + 0.14, ph + 0.14, 0.06), run, s, 0.03, run.h0 + 2.9);
            put('cloth', box(pw, ph, 0.02), run, s, 0.065, run.h0 + 2.9, [0.16, 0.12, 0.1]);
          }
          continue;
        }
        const r = rng.next();
        if (r < 0.55 && bay.w >= 1.5 && top - run.h0 > 6) {
          // tall moonlit window in the upper wall
          const ww = Math.min(1.7, bay.w * 0.55), y0 = run.h0 + 3.6, y1 = Math.min(top - 0.5, y0 + 4.6);
          lancet(run, s, ww, y0, y1, 'trim', 1);
          if (northRun) out.shafts.push({ x: s, z: run.line + 0.2, top: y1 - 0.6, w: ww * 1.1 });
          if (rng.chance(0.5)) cloth(run, s, Math.min(1.6, bay.w * 0.5), y0 - 0.5, 1.6, tapestryCols[rng.int(0, 3)][0], 0x8a6a2a, { swallow: true, border: false });
        } else if (r < 0.8) {
          const [base, acc] = tapestryCols[rng.int(0, 3)];
          cloth(run, s, Math.min(2.4, bay.w * 0.72), run.h0 + 5.2, 3.3, base, acc);
        } else {
          const pw = Math.min(1.5, bay.w * 0.6), ph = pw * 1.25;
          put('gold', box(pw + 0.18, ph + 0.18, 0.07), run, s, 0.035, run.h0 + 3.1);
          put('cloth', box(pw, ph, 0.02), run, s, 0.075, run.h0 + 3.1, [0.14, 0.11, 0.09]);
        }
      }
    }
    // rugs on the boards, scattered pages
    for (const room of level.rooms) {
      if (room.layout === 'library' || room.type === ROOM.BOSS) continue;
      const horiz = room.w > room.h;
      const rw = Math.min(5, (horiz ? room.h : room.w) * T * 0.35), rl = Math.min(8, (horiz ? room.w : room.h) * T * 0.4);
      const offs = room.layout === 'hall' ? [-1, 1] : [0];
      for (const o of offs) {
        const cx = room.cx + (horiz ? 0 : o * (rw * 0.5 + 2.4)), cz = room.cz + (horiz ? o * (rw * 0.5 + 2.4) : 0);
        if (!walkAt(cx, cz)) continue;
        const y = floorY(cx, cz) + 0.018;
        if (level.colliders.some((c) => c.r > 0.9 && Math.hypot(c.x - cx, c.z - cz) < c.r + 1)) continue;
        const g = new GeoBuilder();
        const hx = horiz ? rl / 2 : rw / 2, hz = horiz ? rw / 2 : rl / 2;
        // carpet texture: u across the rug (gold border at u 0/1), v along it
        const U = (x, z) => (horiz ? [(z + hz) / (2 * hz), (x + hx) * 0.5] : [(x + hx) / (2 * hx), (z + hz) * 0.5]);
        quadN(g, [cx - hx, y, cz - hz], [cx + hx, y, cz - hz], [cx + hx, y, cz + hz], [cx - hx, y, cz + hz], [0, 1, 0], [U(-hx, -hz), U(hx, -hz), U(hx, hz), U(-hx, hz)], 0.85);
        B('floorAlt').addGeometry(g.build(), _m.identity());
      }
    }
  }

  // ---------------------------------------------------------------- hollow throne
  if (id === 'throne') {
    // gilded edging along the royal runner (the carpet strip down each hall)
    if (!lo) for (const room of level.rooms) {
      const x0 = (Math.floor(room.x + room.w / 2) - 1) * T, x1 = x0 + 3 * T;
      for (const x of [x0 + 0.05, x1 - 0.05]) for (let cz = room.y; cz < room.y + room.h; cz++) {
        const z = (cz + 0.5) * T;
        if (!walkAt(x, z)) continue;
        putW('gold', box(0.1, 0.035, T), x, level.floorAt(x, z) + 0.017, z, 0);
      }
    }
    const robe = G('robe', () => {
      const pts = [];
      const np = lo ? 4 : 8;
      for (let i = 0; i <= np; i++) { const t = i / np; pts.push(new THREE.Vector2(0.34 - t * 0.17 + Math.sin(t * 3) * 0.03, t * 1.7)); }
      const g = new THREE.LatheGeometry(pts, lo ? 6 : 11);
      g.scale(1, 1, 0.75);
      return g;
    });
    for (const run of runs) {
      if (!tall(run)) continue;
      const st = runStops.get(run) ?? [];
      const sc = run.room ? roomScheme.get(run.room.id) : null;
      const spring = sc ? sc.spring : run.h1 - 0.7;
      const northRun = run.n[2] === 1 && run.axis === 'x';
      for (const bay of bays(run, st, 0.6)) {
        const s = bay.mid;
        if (!run.room) {
          if (rng.chance(0.45)) cloth(run, s, Math.min(1.3, bay.w * 0.6), run.h1 - 1.0, 3.2, 0x4a1460, 0xc8a040, { swallow: true });
          continue;
        }
        // clerestory lancet between the ribs, rising into the vault
        if (bay.w >= 1.8 && sc && sc.rise > 2.5) {
          const ww = Math.min(2.2, bay.w * 0.5), y0 = Math.max(spring - 2.2, run.h0 + 5.6), y1 = spring + Math.min(3.6, sc.rise - 0.5);
          lancet(run, s, ww, y0, y1, 'trim', 1);
          if (northRun) out.shafts.push({ x: s, z: run.line + 0.2, top: y1 - 0.8, w: ww * 1.2 });
        }
        const r = rng.next();
        if (r < (lo ? 0.3 : 0.5) && bay.w >= 1.6) {
          // statue niche: dark back, colonnettes, a pointed hood, a corbel and a robed king of old
          const y0 = run.h0 + 1.6, nh = 2.8, hw = 0.72;
          put('trim', box(hw * 2, nh, 0.05), run, s, 0.025, y0 + nh / 2, [0.22, 0.2, 0.24]);
          for (const sg of [-1, 1]) {
            put('trim', G('ncol', () => new THREE.CylinderGeometry(0.07, 0.07, nh - 0.3, lo ? 4 : 6)), run, s + sg * (hw - 0.04), 0.16, y0 + (nh - 0.3) / 2);
            put('gold', G('ncap', () => new THREE.CylinderGeometry(0.11, 0.08, 0.14, 6)), run, s + sg * (hw - 0.04), 0.16, y0 + nh - 0.25);
          }
          put('trim', G('nhood', () => bandGeo(archCurve(hw, 0.9, true, 6), 0, 0.18, 0, 0.26, { outer: true, ends: true })), run, s, 0, y0 + nh - 0.2, 0.85);
          put('trim', box(1.1, 0.22, 0.4), run, s, 0.2, y0 - 0.11, 0.8);
          put('trim', box(0.8, 0.2, 0.3), run, s, 0.15, y0 - 0.33, 0.7);
          put('gold', box(1.12, 0.05, 0.41), run, s, 0.205, y0 + 0.01);
          // the statue: robe, shoulders, head, crown and a sword held point-down
          put('stone', robe, run, s, 0.36, y0, 0.9);
          put('stone', box(0.62, 0.2, 0.3), run, s, 0.36, y0 + 1.72, 0.9);
          put('stone', G('shead', () => (lo ? new THREE.SphereGeometry(0.16, 6, 4) : new THREE.SphereGeometry(0.16, 8, 6))), run, s, 0.38, y0 + 1.98, 0.9);
          if (!lo) put('gold', G('crown', () => new THREE.CylinderGeometry(0.15, 0.14, 0.1, 8, 1, true)), run, s, 0.38, y0 + 2.12);
          put('stone', box(0.06, 1.2, 0.03), run, s, 0.62, y0 + 0.85, 0.85);
          put('stone', box(0.32, 0.05, 0.05), run, s, 0.62, y0 + 1.42, 0.85);
          // a votive candle at its feet
          put('candle', G('vcan', () => new THREE.CylinderGeometry(0.04, 0.045, 0.2, 6)), run, s + 0.35, 0.3, y0 + 0.1);
          const [fx, fy, fz] = W3(run, s + 0.35, 0.3, y0 + 0.24);
          flames.push({ x: fx, y: fy, z: fz, size: 0.25, kind: 'candle' });
        } else if (r < 0.85) {
          // a royal banner: deep violet, gilded border, swallowtail
          cloth(run, s, Math.min(1.5, bay.w * 0.55), spring - 2.6, Math.min(4.2, spring - 4), rng.chance(0.5) ? 0x4a1460 : 0x6a1020, 0xc8a040, { swallow: true });
        }
      }
    }
  }

  // ---------------------------------------------------------------- bailey
  if (id === 'courtyard') {
    for (const run of runs) {
      if (!tall(run)) continue;
      const st = runStops.get(run) ?? [];
      const L = run.len, mid = (run.a0 + run.a1) / 2, h1 = run.h1;
      // machicolated parapet: corbels carry a projecting gallery crowned with merlons
      put('trim', box(L, 0.14, 0.62), run, mid, 0.31, h1 - 1.4, 0.7);
      put('trim', box(L, 1.35, 0.24), run, mid, 0.5, h1 - 0.62, 0.85);
      for (let s = run.a0 + 0.5; s < run.a1 - 0.2; s += lo ? 1.6 : 1.0) {
        put('trim', box(0.3, 0.3, 0.55), run, s, 0.275, h1 - 1.62, 0.8);
        if (!lo) put('trim', box(0.3, 0.26, 0.36), run, s, 0.18, h1 - 1.9, 0.75);
      }
      for (let s = run.a0 + 0.55; s < run.a1 - 0.3; s += 1.5) put('trim', box(0.75, 0.85, 0.26), run, s, 0.5, h1 + 0.48, 0.88);
      for (const bay of bays(run, st, 0.7)) {
        const s = bay.mid, r = rng.next();
        if (r < 0.45) {
          // arrow loop: a dark slit in a dressed-stone surround
          const y0 = run.h0 + rng.range(3.4, 4.2), sh = 1.5;
          put('trim', box(0.3, sh, 0.04), run, s, 0.02, y0 + sh / 2, [0.03, 0.03, 0.035]);
          for (const sg of [-1, 1]) put('trim', box(0.22, sh + 0.2, 0.12), run, s + sg * 0.25, 0.06, y0 + sh / 2, 0.8);
          put('trim', box(0.75, 0.16, 0.16), run, s, 0.08, y0 - 0.08, 0.75);
          put('trim', box(0.75, 0.2, 0.14), run, s, 0.07, y0 + sh + 0.08, 0.8);
        } else if (r < 0.7 && bay.w > 1.6) {
          // a war banner hung from the gallery
          cloth(run, s, Math.min(1.6, bay.w * 0.5), h1 - 1.5, Math.min(4.5, h1 - 4), rng.chance(0.5) ? 0x6a1018 : 0x1a2a5a, 0xb89848, { swallow: true, d: 0.66 });
        }
        // stores stacked against the wall: firewood or hay bales
        const r2 = rng.next();
        if (r2 < 0.18) {
          // a woodpile: logs laid along the wall, two deep, stacked in a pyramid
          const log = G('log', () => { const c = cylG(0.11, 0.11, 1.5, 6); c.rotateZ(Math.PI / 2); return c; });
          for (const [d, row] of [[0.12, 0], [0.34, 0], [0.23, 1], [0.12, 2], [0.34, 2], [0.23, 3]]) {
            if (lo && row > 1) continue;
            put('bark', log, run, s + rng.range(-0.1, 0.1), d, run.h0 + 0.11 + row * 0.19, 1, rng.range(-0.04, 0.04));
          }
        } else if (r2 < 0.3) {
          const bale = box(0.95, 0.42, 0.36);
          put('cloth', bale, run, s - 0.3, 0.18, run.h0 + 0.21, [0.62, 0.5, 0.26]);
          put('cloth', bale, run, s + 0.68, 0.18, run.h0 + 0.21, [0.55, 0.45, 0.24]);
          put('cloth', bale, run, s + 0.2, 0.18, run.h0 + 0.63, [0.6, 0.48, 0.25], 0.06);
        }
      }
    }
  }

  // the scrolling water is its own (additive) mesh: high quality only
  out.streams = hi && streams.count ? streams : null;
  out.flames = flames;

  out.runs = runs;
  out.runStops = runStops;
  out.roomScheme = roomScheme;
  return out;
}

// Falling water: the left half of the texture is a streaky sheet, the right half sparse drops.
// The map scrolls downward in the level's update, so every stream animates with one offset.
let _streamTex = null;
export function streamMaterial(tint = 0x2a3828) {
  if (!_streamTex) {
    const c = document.createElement('canvas');
    c.width = 128; c.height = 256;
    const g = c.getContext('2d');
    let seed = 4321;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const streak = (x, y, w, len, a) => {
      for (const oy of [0, -256, 256]) {
        const gr = g.createLinearGradient(0, y + oy, 0, y + oy + len);
        gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(0.5, `rgba(255,255,255,${a})`); gr.addColorStop(1, 'rgba(255,255,255,0)');
        g.fillStyle = gr; g.fillRect(x, y + oy, w, len);
      }
    };
    for (let i = 0; i < 110; i++) streak(4 + rnd() * 56, rnd() * 256, 1 + rnd() * 3, 30 + rnd() * 140, 0.25 + rnd() * 0.6);
    for (let i = 0; i < 10; i++) { const y = rnd() * 256; streak(64 + 28 + rnd() * 8, y, 2.5, 6 + rnd() * 6, 0.95); }
    _streamTex = new THREE.CanvasTexture(c);
    _streamTex.wrapT = THREE.RepeatWrapping;
  }
  // same shader variant as the light shafts (map, fog, additive): no extra program to compile
  return new THREE.MeshBasicMaterial({ map: _streamTex, color: tint, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: true });
}
export const streamTexture = () => _streamTex;

