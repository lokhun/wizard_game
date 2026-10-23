import * as THREE from 'three';
import { ROOM, T, FLOOR, K_WATER } from '../world/levelgen.js';
import { ENEMY_DEFS, BOSS_DEFS, FLOOR_HP, FLOOR_DMG, ABYSS_HP, ABYSS_DMG } from './enemyDefs.js';
import { RNG } from '../core/rng.js';
import { BIOMES } from '../world/biomes.js';

// ---------------------------------------------------------------------------
// The encounter director (host). Tracks room progress, locks doors, spawns
// waves scaled to floor and party size, and hands out rewards on clear.
// ---------------------------------------------------------------------------

export const AFFIXES = ['hasted', 'vampiric', 'volatile', 'shielded', 'frenzied', 'bombardier'];

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
  if (a.faction !== 'enemy' || (a.dead && !a.collapsed) || a.dormant || a.def.hoarder) return false; // (a Hoarder never holds a room shut)
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
      // one body every 20 ms, not the squad in one frame (each is ~0.5-1 ms
      // of model building: a squad was a visible hitch while exploring)
      const level = this.level;
      this.g.spells.after(k * 0.02, () => {
        if (this.level !== level || room.cleared) return;
        const a = this.spawnEnemy(s.type, p.x, p.z, { elite: s.elite, affix: s.affix, affix2: s.affix2, dormant: true, homeRoom: room, spawnFx: false, yaw, noCredit: true });
        room.sentryIds.push(a.id);
        if (this.active?.room === room) this.active.spawned.add(a.id); // (the fight began meanwhile)
      });
      k++;
    }
  }

  get floor() { return this.level.floorIndex; }
  partySize() { return Math.max(1, this.g.allPlayers().length); }
  // Party scaling: every wizard past the first brings ~3/4 of a solo fight's
  // bodies, a little more health on each, and harder hits, so each player
  // still faces about what a solo player does (with 2.5x the bodies and no
  // extra damage, a 4-player party used to take ~40% less each than solo,
  // on top of revives) - and the fight gets bigger, not just longer.
  hpScale() { return this.floorHp() * (1 + 0.28 * (this.partySize() - 1)) * (this.g.difficulty?.enemyHp ?? 1); }
  dmgScale() { return this.floorDmg() * (1 + 0.12 * (this.partySize() - 1)) * (this.g.difficulty?.enemyDamage ?? 1); }
  countScale() { return (1 + 0.75 * (this.partySize() - 1)) * (this.g.difficulty?.enemyCount ?? 1) * (1 + 0.15 * this.depth); }
  // The Abyss: each descent past the Hollow King. The realms start again from the
  // first, but they count on (realm 5·depth + floor): every one past the fifth makes
  // foes ABYSS_HP / ABYSS_DMG times tougher and deadlier than the last (bosses alike:
  // their health is their own realm's tune times floorHp / FLOOR_HP). Champions are
  // commoner and, from depth 2, every one bears two affixes; each depth adds an
  // Abyssal law (pacts.js abyssLaws).
  get depth() { return this.g.abyss ?? 0; }
  // The Abyss's invaders: from depth 1 a realm's waves also draw on a later realm's
  // roster (the next at depth 1, two on at depth 2...), half as often at first, so
  // each loop meets new mixes of foes, not just tougher ones
  invaders(level = this.level) {
    const d = this.depth;
    if (!d || !level) return [];
    return BIOMES[(level.floorIndex + d) % BIOMES.length].enemies.filter((t) => ENEMY_DEFS[t]);
  }
  roster(level = this.level) {
    const inv = this.invaders(level);
    if (!inv.length) return level.biome.enemies;
    return [...level.biome.enemies, ...(this.depth >= 2 ? inv : inv.filter((_, i) => i % 2 === 0))];
  }
  floorHp(f = this.floor) {
    const d = this.depth;
    return d ? FLOOR_HP[4] * ABYSS_HP ** (5 * d + f - 4) : FLOOR_HP[f];
  }
  floorDmg(f = this.floor) {
    const d = this.depth;
    return d ? FLOOR_DMG[4] * ABYSS_DMG ** (5 * d + f - 4) : FLOOR_DMG[f];
  }

  spawnEnemy(type, x, z, opts = {}) {
    const def = ENEMY_DEFS[type] ?? BOSS_DEFS[type];
    // boss HP in BOSS_DEFS is already tuned per realm, so bosses skip the floor multiplier
    const hp = BOSS_DEFS[type]
      ? def.hp * (1 + 0.65 * (this.partySize() - 1)) * (this.g.difficulty?.enemyHp ?? 1) * (this.floorHp() / FLOOR_HP[this.floor])
      : def.hp * this.hpScale() * (opts.elite ? 3 : 1);
    const dmg = def.dmg * this.dmgScale() * (opts.elite ? 1.3 : 1);
    const a = this.g.actors.spawn(type, x, z, { hp, dmg, elite: opts.elite, affix: opts.affix, affix2: opts.affix2, yaw: opts.yaw ?? Math.random() * 6.28, dormant: opts.dormant, homeRoom: opts.homeRoom, spawnFx: opts.spawnFx });
    if (!BOSS_DEFS[type]) a.speedMult *= this.g.difficulty?.enemySpeed ?? 1; // the Hunt pact
    if (this.active && !opts.noCredit) this.active.spawned.add(a.id);
    this.g.encounters?.onSpawned(a);
    return a;
  }

  // ---------------------------------------------------------------- update (host)
  update(dt) {
    const g = this.g;
    const L = this.level;
    if (!L) return;
    // every 2 s the party hears which room is shut and which are cleared: a peer that
    // missed a door opening is never left locked in an empty room
    if (g.net && (this._lockSyncT = (this._lockSyncT ?? 0) + dt) > 2) {
      this._lockSyncT = 0;
      const cl = [];
      for (const r of L.rooms) if (r.cleared) cl.push(r.id);
      g.net.broadcast({ t: 'locks', f: g.floorIndex, ab: g.abyss ?? 0, on: this.active ? this.active.room.id : -1, cl });
    }
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
      const e = this._entryPoint(room, p.pos);
      g.requestTeleport(p.id, e.x, e.z);
    }
    // now and then a Hoarder bolts through the fight (at most one a realm)
    if (room.type === ROOM.COMBAT && this._hoardFloor !== this.floor && Math.random() < 0.2) { // (Math.random: the seeded rng plans the waves)
      this._hoardFloor = this.floor;
      g.spells.after(3 + Math.random() * 3, () => { if (this.active?.room === room) this._spawnHoarder(room); });
    }
    if (room.type === ROOM.BOSS) this._startBoss(room);
    else if (room.sentriesPlaced) {
      // the sentries are the first wave
      this.active.waveIdx = 0;
      for (const id of room.sentryIds) if (g.actors.byId.get(id)?.alive) this.active.spawned.add(id);
    } else this._nextWave();
  }

  _spawnHoarder(room) {
    const g = this.g, ps = g.allPlayers().filter((p) => p.alive && !p.dead);
    // the open cell of the room furthest from the party
    let best = null, bd = -1;
    for (let i = 0; i < 24; i++) {
      const x = (room.x + 1.5 + Math.random() * (room.w - 3)) * 2, z = (room.y + 1.5 + Math.random() * (room.h - 3)) * 2;
      if (g.collision.cellBlocked(Math.floor(x / 2), Math.floor(z / 2), g.groundY(x, z) + 0.5)) continue;
      const d = Math.min(...ps.map((p) => Math.hypot(p.pos.x - x, p.pos.z - z)), 99);
      if (d > bd) { bd = d; best = { x, z }; }
    }
    if (!best) return;
    const a = this.spawnEnemy('hoarder', best.x, best.z, { noCredit: true });
    a.homeRoom = null;
    g.hoarderNews('spawn', a);
    g.net?.broadcast({ t: 'hoard', k: 'spawn', id: a.id });
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
    const roster = this.roster();
    const byRole = {};
    for (const t of roster) if (ENEMY_DEFS[t]) (byRole[roleOf(t)] ??= []).push(t);
    const usable = Object.keys(SQUADS).filter((k) => SQUADS[k].slots.every(([r]) => byRole[r]?.length));
    const waves = [];
    let last = null;
    for (let w = 0; w < nWaves; w++) {
      let budget = (8 + f * 3 + depth * 1.2 + w * 2.5) * this.countScale() * (trial ? 1.45 : 1);
      const list = [];
      if (room.type === ROOM.ELITE && w === nWaves - 1) {
        // the Champions pact: the chamber's champion bears an affix too
        const af = this.g.difficulty?.eliteAffix ? rng.pick(AFFIXES) : null;
        list.push({ type: rng.pick(b.elites), elite: false, champion: true, role: 'heavy', affix: af, affix2: this._twin(af) });
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
          const elite = (f >= 1 || trial || this.depth > 0) && rng.chance(((trial ? 0.18 : 0.05) + f * 0.025 + (this.partySize() - 1) * 0.02 + this.depth * 0.08) * (this.g.difficulty?.champions ?? 1)) && def.cost >= 2;
          const af = elite ? rng.pick(AFFIXES) : null;
          list.push({ type, elite, affix: af, affix2: this._twin(af), role: roleOf(type) });
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
        while (budget > 0 && guard++ < 40) add(rng.pick(byRole[fillRole] ?? roster));
      } else {
        let guard = 0;
        while (budget > 0 && guard++ < 50) add(rng.pick(roster));
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

  // the Exalted pact: a second affix, never the first one again
  _twin(af) {
    if (!af || !(this.g.difficulty?.twinAffix || this.depth >= 2)) return null;
    const rest = AFFIXES.filter((k) => k !== af);
    return rest[Math.floor(this.rng.next() * rest.length)];
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
        const a = this.spawnEnemy(s.type, p.x, p.z, { elite: s.elite, affix: s.affix, affix2: s.affix2 });
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
    if (R.vents) this._vents(A, dt);
    // a wizard who ends up outside the fight (a rewind, a blink, a shove through a
    // closing door...) is drawn back in after a moment: the doors only open on a clear
    for (const p of g.allPlayers()) {
      if (!p.alive || p.dead) continue;
      const out = g.level.roomAt(p.pos.x, p.pos.z) !== R;
      const k = 'out_' + p.id;
      A[k] = out ? (A[k] ?? 0) + dt : 0;
      if (A[k] > 1.5) { A[k] = 0; const e = this._entryPoint(R, p.pos); g.requestTeleport(p.id, e.x, e.z); }
    }
    let alive = 0, hp = 0;
    for (const id of A.spawned) {
      const a = g.actors.byId.get(id);
      if (a && (!a.dead || a.collapsed)) { alive++; hp += a.hp; }
    }
    // also count other hostiles that belong to this fight (summons etc.), but never the
    // sleeping or leashed sentries of other rooms: they would hold these doors shut forever
    for (const a of g.actors.list) if (fightsHere(a, A.room) && !A.spawned.has(a.id)) { alive++; hp += a.hp; }
    const wave = A.waves[A.waveIdx];
    if (!A.boss && wave && A.waveIdx < A.waves.length - 1) {
      // next wave when the current one is mostly dead, or after a long time
      // (the Relentless pact brings it while half, or three quarters, still stand)
      const frac = Math.max(A.room.type === ROOM.TRIAL ? 0.5 : 0.25, [0.25, 0.5, 0.75][g.difficulty?.waveEarly ?? 0] ?? 0.25);
      if ((alive <= Math.max(1, Math.floor(wave.length * frac)) && A.waveT > 2.5) || A.waveT > 40) this._nextWave();
      return;
    }
    if (A.boss && !A.bossId) {
      // (a boss that never appeared - its spawn failed - is called again once)
      if (A.t > 10 && !A.bossRetry) { A.bossRetry = true; this._startBoss(R); }
      return;
    }
    // The softlock watchdog: progress is any foe falling or losing health. A fight with
    // none for 20 s pulls every foe it still counts to the party, wherever it is (wedged
    // in a wall, fallen out of the level, wandered off, invisible); with none for 45 s
    // more, what remains is banished and the doors open. Nothing may hold them shut.
    if (alive !== A.lastAlive || hp < (A.lastHp ?? Infinity) - 0.5) A.progT = A.t;
    A.lastAlive = alive; A.lastHp = hp;
    const stall = A.t - (A.progT ?? 0);
    if (alive > 0 && stall > 20 && A.t - (A.pullT ?? -99) > 20) { A.pullT = A.t; this._pullStragglers(A); }
    if (alive > 0 && !A.boss && stall > 65) { A.progT = A.t; this._banish(A); }
    if (alive === 0 && A.t > 2) {
      A.clearT += dt;
      if (A.clearT > 0.6) this.clearRoom();
    }
  }

  // a fight room's trap vents erupt by turns (half at a time, every 4.5 s, after a
  // moment's grace): a telegraphed burst that hurts wizards and foes alike
  _vents(A, dt) {
    if (A.t < 4) return;
    A.ventT = (A.ventT ?? 0) - dt;
    if (A.ventT > 0) return;
    A.ventT = 4.5;
    const g = this.g, V = A.room.vents, b = this.level.biome.id;
    const el = b === 'sewers' ? 'enemyGreen' : b === 'keep' ? 'enemyPurple' : 'enemyFire';
    A.ventK = (A.ventK ?? 0) + 1;
    for (let i = 0; i < V.length; i++) {
      if (V.length > 1 && (i + A.ventK) % 2) continue;
      const v = V[i];
      g.broadcastHazard({ shape: 'circle', x: v.x, y: g.groundY(v.x, v.z), z: v.z, r: 1.8, delay: 1.3, el, fx: el, vis: 1,
        dmg: 12 * this.dmgScale(), trap: Math.round(30 * this.hpScale()), cause: 'a trap vent' });
    }
  }

  // every foe the fight counts, its own and the strays that join it
  _counted(A) {
    const g = this.g, out = [];
    for (const id of A.spawned) { const a = g.actors.byId.get(id); if (a && (!a.dead || a.collapsed)) out.push(a); }
    for (const a of g.actors.list) if (fightsHere(a, A.room) && !A.spawned.has(a.id)) out.push(a);
    return out;
  }

  // what's left of a fight that can't be finished: gone in a puff of smoke, loot and all
  _banish(A) {
    const g = this.g;
    for (const a of this._counted(A)) {
      if (a.boss) continue;
      g.actors.blinkFx(a.pos);
      g.net?.broadcast({ t: 'blinkfx', x: a.pos.x, y: a.pos.y, z: a.pos.z });
      a.reassembled = true; a.collapsed = false;
      a.hp = 0;
      g.actors.kill(a, 0, 'holy');
    }
  }

  // where a wizard drawn into a fight appears: just inside the door nearest them
  _entryPoint(room, from) {
    const L = this.level, col = this.g.collision;
    const doors = room.doors.map((d) => L.doors[d]).sort((a, b) => Math.hypot(a.x - from.x, a.z - from.z) - Math.hypot(b.x - from.x, b.z - from.z));
    for (const d of doors) {
      for (const k of [1.6, 2.2, 2.8, 3.4]) {
        for (const side of [0, 0.6, -0.6]) {
          const x = d.x - d.nx * k * T + d.ny * side * T, z = d.z - d.ny * k * T - d.nx * side * T;
          if (L.roomAt(x, z) === room && !col.pushOut(x, z, 0.5) && !col.cellBlocked(Math.floor(x / T), Math.floor(z / T), this.g.groundY(x, z) + 0.5)) return { x, z };
        }
      }
    }
    return { x: room.cx + (Math.random() - 0.5) * 3, z: room.cz + (Math.random() - 0.5) * 3 };
  }

  _pullStragglers(A) {
    const g = this.g, room = A.room;
    const ps = g.allPlayers().filter((p) => p.alive && !p.dead && g.level.roomAt(p.pos.x, p.pos.z) === room);
    const c = ps[0]?.pos ?? { x: room.cx, z: room.cz };
    for (const a of this._counted(A)) {
      // (a boss keeps its arena: it's only brought back when it has left the room)
      if (a.dead || a.dormant || (a.boss && g.level.roomAt(a.pos.x, a.pos.z) === room)) continue;
      for (let k = 0; k < 16; k++) {
        const ang = Math.random() * Math.PI * 2, r = 5 + Math.random() * 3;
        const x = c.x + Math.cos(ang) * r, z = c.z + Math.sin(ang) * r;
        if (g.level.roomAt(x, z) !== room || g.collision.pushOut(x, z, 0.6) || g.collision.cellBlocked(Math.floor(x / 2), Math.floor(z / 2), a.pos.y + 0.5)) continue;
        g.net?.broadcast({ t: 'blinkfx', x: a.pos.x, y: a.pos.y, z: a.pos.z });
        g.actors.blinkFx(a.pos);
        a.pos.x = x; a.pos.z = z; a.pos.y = g.groundY(x, z);
        a.net.x = x; a.net.z = z;
        g.net?.broadcast({ t: 'blinkfx', x, y: a.pos.y, z });
        g.actors.blinkFx(a.pos);
        break;
      }
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
