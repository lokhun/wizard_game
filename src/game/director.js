import * as THREE from 'three';
import { ROOM, T, FLOOR, K_WATER } from '../world/levelgen.js';
import { ENEMY_DEFS, BOSS_DEFS, FLOOR_HP, FLOOR_DMG } from './enemyDefs.js';
import { RNG } from '../core/rng.js';

// ---------------------------------------------------------------------------
// The encounter director (host). Tracks room progress, locks doors, spawns
// waves scaled to floor and party size, and hands out rewards on clear.
// ---------------------------------------------------------------------------

const AFFIXES = ['hasted', 'vampiric', 'volatile', 'shielded'];

// Combat role of an enemy type, derived from its definition. Waves are built
// from roles so every fight has a readable shape (a line to break, a caster to
// dive, a pack to kite) instead of a random pile of monsters.
export function roleOf(type) {
  const d = ENEMY_DEFS[type];
  if (!d) return 'line';
  if (d.ai === 'support' || d.ai === 'caster') return 'caster';
  if (d.ai === 'ranged') return 'ranged';
  if (d.cost >= 10) return 'heavy';
  if (d.flank || d.speed >= 5.5) return 'skirmisher';
  if (d.cost <= 2) return 'fodder';
  return 'line';
}

// Squad templates: [role, min, max] slots, filled from the realm's roster.
// 'fill' soaks up the rest of the wave budget with that role.
const SQUADS = {
  horde:      { slots: [['fodder', 3, 6], ['skirmisher', 1, 2]], fill: 'fodder', intro: true },
  shieldwall: { slots: [['line', 2, 3], ['ranged', 2, 3]], fill: 'line', intro: true },
  coven:      { slots: [['caster', 1, 2], ['line', 2, 3]], fill: 'fodder' },
  hunters:    { slots: [['skirmisher', 2, 3], ['line', 1, 1]], fill: 'skirmisher', intro: true },
  vanguard:   { slots: [['heavy', 1, 1], ['ranged', 1, 2]], fill: 'fodder' },
  crossfire:  { slots: [['ranged', 2, 3], ['skirmisher', 1, 2]], fill: 'line' },
};
// Does this actor take part in the fight in `room`? (shared by the encounter and the HUD)
export function fightsHere(a, room) {
  if (a.faction !== 'enemy' || (a.dead && !a.collapsed) || a.dormant) return false;
  return !a.homeRoom || !room || a.homeRoom === room;
}

const TRIAL_TIME = 45;

// roles that hang back: they spawn far from the party and away from the action
const BACKLINE = new Set(['ranged', 'caster']);

export class Director {
  constructor(game) {
    this.g = game;
    this.active = null; // { room, waves, waveIdx, spawned:Set, t }
    this.rng = new RNG(1);
  }

  setLevel(level) {
    this.level = level;
    this.active = null;
    this.rng = new RNG(level.seed * 13 + level.floorIndex);
    // sentry rooms (room.sentries / room.camp) are chosen by the level generator
  }

  // place a room's first squad, idle, when the party draws near
  _placeSentries(room) {
    room.sentriesPlaced = true;
    room.plannedWaves = this._planWaves(room);
    room.sentryIds = [];
    const camp = room.camp;
    let k = 0;
    for (const s of room.plannedWaves[0] ?? []) {
      // gathered round the camp brazier, facing the fire (archers and casters a step further out)
      let p = null;
      if (camp) {
        for (let t = 0; t < 12 && !p; t++) {
          const ang = (k * 2.399) + t * 0.6, r = (BACKLINE.has(s.role) ? 4.2 : 2.4) + this.rng.next() * 1.4;
          const x = camp.x + Math.cos(ang) * r, z = camp.z + Math.sin(ang) * r;
          if (this.level.roomAt(x, z) === room && !this.g.collision.pushOut(x, z, 0.6) && !this.g.collision.cellBlocked(Math.floor(x / T), Math.floor(z / T), 0.5)) p = { x, z };
        }
      }
      p ??= this._spawnPoint(room, s.role);
      const yaw = camp ? Math.atan2(camp.x - p.x, camp.z - p.z) : undefined;
      const a = this.spawnEnemy(s.type, p.x, p.z, { elite: s.elite, affix: s.affix, dormant: true, homeRoom: room, spawnFx: false, yaw });
      room.sentryIds.push(a.id);
      k++;
    }
  }

  get floor() { return this.level.floorIndex; }
  partySize() { return Math.max(1, this.g.allPlayers().length); }
  hpScale() { return FLOOR_HP[this.floor] * (1 + 0.32 * (this.partySize() - 1)) * (this.g.difficulty?.enemyHp ?? 1); }
  dmgScale() { return FLOOR_DMG[this.floor] * (this.g.difficulty?.enemyDamage ?? 1); }
  countScale() { return 1 + 0.5 * (this.partySize() - 1); }

  spawnEnemy(type, x, z, opts = {}) {
    const def = ENEMY_DEFS[type] ?? BOSS_DEFS[type];
    // boss HP in BOSS_DEFS is already tuned per realm, so bosses skip the floor multiplier
    const hp = BOSS_DEFS[type]
      ? def.hp * (1 + 0.45 * (this.partySize() - 1)) * (this.g.difficulty?.enemyHp ?? 1)
      : def.hp * this.hpScale() * (opts.elite ? 3 : 1);
    const dmg = def.dmg * this.dmgScale() * (opts.elite ? 1.3 : 1);
    const a = this.g.actors.spawn(type, x, z, { hp, dmg, elite: opts.elite, affix: opts.affix, yaw: opts.yaw ?? Math.random() * 6.28, dormant: opts.dormant, homeRoom: opts.homeRoom, spawnFx: opts.spawnFx });
    if (this.active && !opts.noCredit) this.active.spawned.add(a.id);
    this.g.encounters?.onSpawned(a);
    return a;
  }

  // ---------------------------------------------------------------- update (host)
  update(dt) {
    const g = this.g;
    const L = this.level;
    if (!L) return;
    // sentry squads appear (idle) as the party approaches their room (never mid-fight)
    if (!this.active) for (const room of L.rooms) {
      if (!room.sentries || room.sentriesPlaced || room.cleared) continue;
      const R = Math.max(room.w, room.h) * T * 0.5 + 14;
      if (g.allPlayers().some((p) => p.alive && Math.hypot(p.pos.x - room.cx, p.pos.z - room.cz) < R)) this._placeSentries(room);
    }
    // detect room entry
    if (!this.active) {
      for (const p of g.allPlayers()) {
        if (!p.alive || p.dead || p.downed) continue;
        const room = this._interiorRoom(p.pos);
        if (!room) continue;
        if (!room.visited) { room.visited = true; g.net?.broadcast({ t: 'visit', r: room.id }); g.onRoomVisited?.(room); }
        if (!room.cleared && (room.type === ROOM.COMBAT || room.type === ROOM.ELITE || room.type === ROOM.BOSS || room.type === ROOM.TRIAL)) {
          this.startEncounter(room);
          break;
        }
      }
    } else {
      this._encounter(dt);
    }
  }

  _interiorRoom(pos) {
    const L = this.level;
    const cx = Math.floor(pos.x / T), cy = Math.floor(pos.z / T);
    if (!L.inb(cx, cy)) return null;
    const rid = L.roomId[cy * L.W + cx];
    if (rid < 0) return null;
    const room = L.rooms[rid];
    // must be at least 1.5 cells inside so doors can close behind the player
    if (cx < room.x + 1 || cy < room.y + 1 || cx > room.x + room.w - 2 || cy > room.y + room.h - 2) return null;
    return room;
  }

  startEncounter(room) {
    const g = this.g;
    const waves = room.sentriesPlaced ? room.plannedWaves : this._planWaves(room);
    // remember where the party came in, so enemies can appear across the room from them
    const ps = g.allPlayers().filter((p) => p.alive && !p.dead);
    const entry = ps.length ? { x: ps.reduce((s, p) => s + p.pos.x, 0) / ps.length, z: ps.reduce((s, p) => s + p.pos.z, 0) / ps.length } : null;
    this.active = { room, waves, waveIdx: -1, spawned: new Set(), t: 0, waveT: 0, clearT: 0, entry };
    // a trial is against the clock: clear it in time for an epic reward
    if (room.type === ROOM.TRIAL) { room.trialLimit = TRIAL_TIME + this.floor * 3; room.trialEnd = g.time + room.trialLimit; room.trialWon = null; }
    g.encounters?.onEncounterStart(room, waves);
    g.setRoomLocked(room.id, true);
    g.net?.broadcast({ t: 'lock', r: room.id, on: 1, sen: room.sentriesPlaced ? 1 : 0, tl: room.trialLimit ?? 0 });
    // pull stragglers into the room
    for (const p of g.allPlayers()) {
      if (g.level.roomAt(p.pos.x, p.pos.z) === room) continue;
      g.requestTeleport(p.id, room.cx + (Math.random() - 0.5) * 3, room.cz + (Math.random() - 0.5) * 3);
    }
    if (room.type === ROOM.BOSS) this._startBoss(room);
    else if (room.sentriesPlaced) {
      // the sentries are the first wave
      this.active.waveIdx = 0;
      for (const id of room.sentryIds) if (g.actors.byId.get(id)?.alive) this.active.spawned.add(id);
    } else this._nextWave();
  }

  _planWaves(room) {
    const b = this.level.biome;
    const rng = this.rng;
    const f = this.floor;
    if (room.type === ROOM.BOSS) return [];
    const depth = room.depth ?? 1;
    const trial = room.type === ROOM.TRIAL;
    const nWaves = room.type === ROOM.ELITE || trial ? 2 : rng.int(2, 3);
    // the realm's roster grouped by role (duplicates in the roster act as weights)
    const byRole = {};
    for (const t of b.enemies) if (ENEMY_DEFS[t]) (byRole[roleOf(t)] ??= []).push(t);
    const usable = Object.keys(SQUADS).filter((k) => SQUADS[k].slots.every(([r]) => byRole[r]?.length));
    const waves = [];
    let last = null;
    for (let w = 0; w < nWaves; w++) {
      let budget = (8 + f * 3 + depth * 1.2 + w * 2.5) * this.countScale() * (trial ? 1.45 : 1);
      const list = [];
      if (room.type === ROOM.ELITE && w === nWaves - 1) {
        list.push({ type: rng.pick(b.elites), elite: false, champion: true, role: 'heavy' });
        budget *= 0.4;
      }
      // the opening wave uses a simple, readable squad; later waves get nastier ones
      let pool = usable.filter((k) => k !== last && (w > 0 || SQUADS[k].intro));
      if (!pool.length) pool = usable.filter((k) => k !== last);
      const squadName = pool.length ? rng.pick(pool) : null;
      last = squadName;
      // keep a wave fightable: past ~9 bodies a room turns into mush rather than tactics
      const cap = Math.round(9 * this.countScale());
      const add = (type, force = false) => {
        const def = ENEMY_DEFS[type];
        const pack = def.pack ? rng.int(def.pack[0], def.pack[1]) : 1;
        for (let i = 0; i < pack && ((budget > 0 && list.length < cap) || (force && i === 0)); i++) {
          // occasional champion (elite affix) from floor 2 on
          const elite = (f >= 1 || trial) && rng.chance((trial ? 0.18 : 0.04) + f * 0.02) && def.cost >= 2;
          list.push({ type, elite, affix: elite ? rng.pick(AFFIXES) : null, role: roleOf(type) });
          budget -= def.cost * (elite ? 3 : 1);
        }
      };
      if (squadName) {
        const sq = SQUADS[squadName];
        for (const [role, lo, hi] of sq.slots) {
          const n = rng.int(lo, hi) + (role === 'ranged' && f >= 3 ? 1 : 0);
          // the minimum always spawns (a healer with no one to guard makes no fight)
          for (let i = 0; i < n && (i < lo || budget > 0); i++) add(rng.pick(byRole[role]), i < lo);
        }
        let guard = 0;
        const fillRole = byRole[sq.fill]?.length ? sq.fill : 'line';
        while (budget > 0 && guard++ < 40) add(rng.pick(byRole[fillRole] ?? b.enemies));
      } else {
        let guard = 0;
        while (budget > 0 && guard++ < 50) add(rng.pick(b.enemies));
      }
      list.squad = squadName;
      waves.push(list);
    }
    return waves;
  }

  // Pick a spawn cell for an enemy of the given role. Enemies appear where the
  // party can see them coming: the backline far away, the rest across the room
  // from where the party entered, never right on top of anyone.
  _spawnPoint(room, role = 'line') {
    const L = this.level;
    const g = this.g;
    const A = this.active;
    const back = BACKLINE.has(role);
    const minDist = back ? 11 : role === 'skirmisher' ? 8 : 9;
    const players = g.allPlayers().filter((p) => p.alive && !p.dead);
    const entry = A?.entry;
    let best = null, bestScore = -1e9;
    for (let i = 0; i < 24; i++) {
      const cx = room.x + 1 + Math.floor(this.rng.next() * (room.w - 2));
      const cy = room.y + 1 + Math.floor(this.rng.next() * (room.h - 2));
      const idx = cy * L.W + cx;
      // (an L-shaped room's cut corner can hold corridor floor: that is outside the doors)
      if (L.cells[idx] !== FLOOR || L.kind[idx] === K_WATER || L.roomId[idx] !== room.id) continue;
      const x = (cx + 0.5) * T, z = (cy + 0.5) * T;
      if (g.collision.pushOut(x, z, 0.6)) continue;
      let near = 1e9;
      for (const p of players) near = Math.min(near, Math.hypot(p.pos.x - x, p.pos.z - z));
      let score = Math.min(near, back ? 20 : 14) + this.rng.next() * 3;
      if (near < minDist) score -= 30;
      // prefer the far side of the room from the door the party came through
      if (entry && role !== 'skirmisher') score += Math.min(10, Math.hypot(entry.x - x, entry.z - z)) * 0.4;
      // the backline likes the room's edges, skirmishers like the flanks
      const edge = Math.min(cx - room.x, room.x + room.w - 1 - cx, cy - room.y, room.y + room.h - 1 - cy);
      if (back || role === 'skirmisher') score -= edge * 0.6;
      if (score > bestScore) { bestScore = score; best = { x, z }; }
    }
    return best ?? { x: room.cx, z: room.cz };
  }

  _nextWave() {
    const A = this.active;
    A.waveIdx++;
    A.waveT = 0;
    const wave = A.waves[A.waveIdx];
    if (!wave) return;
    const room = A.room;
    // stagger spawns for drama
    wave.forEach((s, i) => {
      this.g.spells.after(i * 0.12 + Math.random() * 0.2, () => {
        if (this.active !== A) return;
        const p = this._spawnPoint(room, s.role);
        const a = this.spawnEnemy(s.type, p.x, p.z, { elite: s.elite, affix: s.affix });
        // some elite chambers are held by a named champion
        if (s.champion && room.champ) this.g.encounters?.makeChampion(a, room);
      });
    });
    if (A.waveIdx > 0) this.g.net?.broadcast({ t: 'wave', n: A.waveIdx + 1, of: A.waves.length });
    this.g.onWave?.(A.waveIdx + 1, A.waves.length);
  }

  _startBoss(room) {
    const g = this.g;
    const bossType = this.level.biome.boss;
    const def = BOSS_DEFS[bossType];
    let x = room.cx, z = room.cz - 2;
    if (bossType === 'hollowKing') { z = (room.y + 2) * T + 0.5; }
    const A = this.active;
    A.boss = true;
    g.spells.after(1.2, () => {
      const a = this.spawnEnemy(bossType, x, z, { yaw: 0 });
      a.yaw = Math.atan2(room.cx - x, room.cz + 6 - z);
      a.brain.data.room = room;
      A.bossId = a.id;
      g.net?.broadcast({ t: 'boss', id: a.id });
      g.onBossSpawn?.(a);
    });
    void def;
  }

  _encounter(dt) {
    const A = this.active;
    const g = this.g;
    A.t += dt;
    const R = A.room;
    if (R.type === ROOM.TRIAL && R.trialWon === null && g.time > R.trialEnd) {
      R.trialWon = false;
      g.net?.broadcast({ t: 'trial', r: R.id, won: 0 });
      g.onTrialResult?.(R, false);
    }
    A.waveT += dt;
    let alive = 0;
    for (const id of A.spawned) {
      const a = g.actors.byId.get(id);
      if (a && (!a.dead || a.collapsed)) alive++;
    }
    // also count other hostiles that belong to this fight (summons etc.), but never the
    // sleeping or leashed sentries of other rooms: they would hold these doors shut forever
    for (const a of g.actors.list) if (fightsHere(a, A.room) && !A.spawned.has(a.id)) alive++;
    const wave = A.waves[A.waveIdx];
    if (!A.boss && wave && A.waveIdx < A.waves.length - 1) {
      // next wave when the current one is mostly dead, or after a long time
      const frac = A.room.type === ROOM.TRIAL ? 0.5 : 0.25;
      if ((alive <= Math.max(1, Math.floor(wave.length * frac)) && A.waveT > 2.5) || A.waveT > 40) this._nextWave();
      return;
    }
    if (A.boss && !A.bossId) return;
    if (alive === 0 && A.t > 2) {
      A.clearT += dt;
      if (A.clearT > 0.6) this.clearRoom();
    }
  }

  clearRoom() {
    const g = this.g;
    const A = this.active;
    if (!A) return;
    const room = A.room;
    room.cleared = true;
    if (room.type === ROOM.TRIAL && room.trialWon === null) { room.trialWon = true; this.g.net?.broadcast({ t: 'trial', r: room.id, won: 1 }); }
    this.active = null;
    g.setRoomLocked(room.id, false);
    g.net?.broadcast({ t: 'lock', r: room.id, on: 0, clear: 1 });
    g.onRoomCleared(room);
  }
}
