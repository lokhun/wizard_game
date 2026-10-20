import * as THREE from 'three';
import { ROOM, T, FLOOR, K_WATER } from '../world/levelgen.js';
import { ENEMY_DEFS, BOSS_DEFS, FLOOR_HP, FLOOR_DMG } from './enemyDefs.js';
import { RNG } from '../core/rng.js';

// ---------------------------------------------------------------------------
// The encounter director (host). Tracks room progress, locks doors, spawns
// waves scaled to floor and party size, and hands out rewards on clear.
// ---------------------------------------------------------------------------

const AFFIXES = ['hasted', 'vampiric', 'volatile', 'shielded'];

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
  }

  get floor() { return this.level.floorIndex; }
  partySize() { return Math.max(1, this.g.allPlayers().length); }
  hpScale() { return FLOOR_HP[this.floor] * (1 + 0.32 * (this.partySize() - 1)) * (this.g.difficulty?.enemyHp ?? 1); }
  dmgScale() { return FLOOR_DMG[this.floor] * (this.g.difficulty?.enemyDamage ?? 1); }
  countScale() { return 1 + 0.5 * (this.partySize() - 1); }

  spawnEnemy(type, x, z, opts = {}) {
    const def = ENEMY_DEFS[type] ?? BOSS_DEFS[type];
    const hp = def.hp * this.hpScale() * (opts.elite ? 3 : 1) * (BOSS_DEFS[type] ? (1 + 0.45 * (this.partySize() - 1)) / (1 + 0.32 * (this.partySize() - 1)) : 1);
    const dmg = def.dmg * this.dmgScale() * (opts.elite ? 1.3 : 1);
    const a = this.g.actors.spawn(type, x, z, { hp, dmg, elite: opts.elite, affix: opts.affix, yaw: opts.yaw ?? Math.random() * 6.28 });
    if (this.active && !opts.noCredit) this.active.spawned.add(a.id);
    return a;
  }

  // ---------------------------------------------------------------- update (host)
  update(dt) {
    const g = this.g;
    const L = this.level;
    if (!L) return;
    // detect room entry
    if (!this.active) {
      for (const p of g.allPlayers()) {
        if (!p.alive || p.dead || p.downed) continue;
        const room = this._interiorRoom(p.pos);
        if (!room) continue;
        if (!room.visited) { room.visited = true; g.net?.broadcast({ t: 'visit', r: room.id }); g.onRoomVisited?.(room); }
        if (!room.cleared && (room.type === ROOM.COMBAT || room.type === ROOM.ELITE || room.type === ROOM.BOSS)) {
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
    const waves = this._planWaves(room);
    this.active = { room, waves, waveIdx: -1, spawned: new Set(), t: 0, waveT: 0, clearT: 0 };
    g.setRoomLocked(room.id, true);
    g.net?.broadcast({ t: 'lock', r: room.id, on: 1 });
    // pull stragglers into the room
    for (const p of g.allPlayers()) {
      if (g.level.roomAt(p.pos.x, p.pos.z) === room) continue;
      g.requestTeleport(p.id, room.cx + (Math.random() - 0.5) * 3, room.cz + (Math.random() - 0.5) * 3);
    }
    if (room.type === ROOM.BOSS) this._startBoss(room);
    else this._nextWave();
  }

  _planWaves(room) {
    const b = this.level.biome;
    const rng = this.rng;
    const f = this.floor;
    if (room.type === ROOM.BOSS) return [];
    const depth = room.depth ?? 1;
    const nWaves = room.type === ROOM.ELITE ? 2 : rng.int(2, 3);
    const waves = [];
    for (let w = 0; w < nWaves; w++) {
      let budget = (6 + f * 1.5 + depth * 1.2 + w * 2) * this.countScale();
      const list = [];
      if (room.type === ROOM.ELITE && w === nWaves - 1) {
        list.push({ type: rng.pick(b.elites), elite: false, champion: true });
        budget *= 0.4;
      }
      let guard = 0;
      while (budget > 0 && guard++ < 50) {
        const type = rng.pick(b.enemies);
        const def = ENEMY_DEFS[type];
        if (!def) continue;
        const pack = def.pack ? rng.int(def.pack[0], def.pack[1]) : 1;
        for (let i = 0; i < pack && budget > 0; i++) {
          // occasional champion (elite affix) from floor 2 on
          const elite = f >= 1 && rng.chance(0.04 + f * 0.02) && def.cost >= 2;
          list.push({ type, elite, affix: elite ? rng.pick(AFFIXES) : null });
          budget -= def.cost * (elite ? 3 : 1);
        }
      }
      waves.push(list);
    }
    return waves;
  }

  _spawnPoint(room, minDist = 6) {
    const L = this.level;
    const g = this.g;
    for (let i = 0; i < 40; i++) {
      const cx = room.x + 1 + Math.floor(this.rng.next() * (room.w - 2));
      const cy = room.y + 1 + Math.floor(this.rng.next() * (room.h - 2));
      const idx = cy * L.W + cx;
      if (L.cells[idx] !== FLOOR || L.kind[idx] === K_WATER) continue;
      const x = (cx + 0.5) * T, z = (cy + 0.5) * T;
      let ok = true;
      for (const p of g.allPlayers()) if (Math.hypot(p.pos.x - x, p.pos.z - z) < minDist) { ok = false; break; }
      if (!ok) continue;
      if (g.collision.pushOut(x, z, 0.6)) continue;
      return { x, z };
    }
    return { x: room.cx, z: room.cz };
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
        const p = this._spawnPoint(room);
        this.spawnEnemy(s.type, p.x, p.z, { elite: s.elite, affix: s.affix });
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
    A.waveT += dt;
    let alive = 0;
    for (const id of A.spawned) {
      const a = g.actors.byId.get(id);
      if (a && (!a.dead || a.collapsed)) alive++;
    }
    // also count any hostile actor inside the room (summons etc.)
    for (const a of g.actors.list) if (a.faction === 'enemy' && (!a.dead || a.collapsed) && !A.spawned.has(a.id)) alive++;
    const wave = A.waves[A.waveIdx];
    if (!A.boss && wave && A.waveIdx < A.waves.length - 1) {
      // next wave when the current one is mostly dead, or after a long time
      if ((alive <= Math.max(1, Math.floor(wave.length * 0.25)) && A.waveT > 2.5) || A.waveT > 40) this._nextWave();
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
    this.active = null;
    g.setRoomLocked(room.id, false);
    g.net?.broadcast({ t: 'lock', r: room.id, on: 0, clear: 1 });
    g.onRoomCleared(room);
  }
}
