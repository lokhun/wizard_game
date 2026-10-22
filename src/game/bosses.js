import * as THREE from 'three';
import { angleDamp } from '../core/math.js';
import { rand } from '../core/rng.js';
import { SPR } from '../render/particles.js';

// ---------------------------------------------------------------------------
// Boss brains. Each boss has phases (by HP fraction); each phase has a pool
// of moves. A move schedules timed events (telegraphs, projectiles, waves,
// summons) and occupies the boss for its duration. All damage to players goes
// through hazards and enemy projectiles so it is resolved by each victim.
// ---------------------------------------------------------------------------

const UP = new THREE.Vector3(0, 1, 0);

export class BossBrain {
  constructor(g, a) {
    this.g = g;
    this.a = a;
    this.script = SCRIPTS[a.type];
    this.phase = 0;
    this.events = [];
    this.busy = 1.5; // intro pause
    this.cds = {};
    this.move = null;
    this.moveVel = null;
    this.moveT = 0;
    this.animDur = 1;
    this.animT = 0;
    this.started = false;
    this.data = {};
    this.invuln = 0;
    a.anim = 'idle';
    this.script.init?.(this);
  }

  get target() {
    const g = this.g, a = this.a;
    let best = null, bd = Infinity;
    for (const p of g.allPlayers()) {
      if (!p.alive || p.dead || p.downed) continue;
      const d = p.pos.distanceTo(a.pos);
      if (d < bd) { bd = d; best = p; }
    }
    return best;
  }
  players() { return this.g.allPlayers().filter((p) => p.alive && !p.dead && !p.downed); }
  // the Wrath pact (game.difficulty.bossEnrage) brings every later phase on sooner
  get hpf() { return this.a.hp / this.a.maxHp - (this.g.difficulty?.bossEnrage ?? 0); }
  get dmg() { return this.a.dmg; }

  modifyDamage(dmg, H) {
    if (this.invuln > 0) return 0;
    return this.script.modifyDamage ? this.script.modifyDamage(this, dmg, H) : dmg;
  }

  // ------------------------------------------------ helpers used by scripts
  at(t, fn) { this.events.push({ t, fn }); }
  anim(anim, attackType, dur) {
    const a = this.a;
    if ((attackType ?? '') !== this._lastAT) { this._lastAT = attackType ?? ''; this.g.net?.broadcast({ t: 'bat', id: a.id, a: this._lastAT }); }
    a.anim = anim; a.animT = 0; a.attackType = attackType ?? ''; a.progress = 0;
    this.animDur = dur; this.animT = 0;
  }
  face(p, rate = 99, dt = 1) {
    if (!p) return;
    const a = this.a;
    a.yaw = angleDamp(a.yaw, Math.atan2(p.pos.x - a.pos.x, p.pos.z - a.pos.z), rate, dt);
  }
  yawTo(p) { return Math.atan2(p.x - this.a.pos.x, p.z - this.a.pos.z); }
  hazard(h) { this.g.broadcastHazard({ src: this.a.id, el: 'enemy', vis: 1, ...h }); }
  circle(x, z, r, delay, dmgMult = 1, el = 'enemy', extra = {}) {
    this.hazard({ shape: 'circle', x, y: this.g.groundY(x, z), z, r, delay, dmg: this.dmg * dmgMult, el, fx: el, ...extra });
  }
  wave(r0, speed, maxR, dmgMult = 0.8, el = 'enemy', delay = 0) {
    const a = this.a;
    this.hazard({ shape: 'wave', x: a.pos.x, y: a.pos.y, z: a.pos.z, r: r0, speed, maxR, delay, dmg: this.dmg * dmgMult, el, fx: el });
  }
  proj(pos, dir, speed, el = 'enemy', dmgMult = 0.6, extra = {}) {
    this.g.broadcastEnemyProjectile({ x: pos.x, y: pos.y, z: pos.z, vx: dir.x * speed, vy: dir.y * speed, vz: dir.z * speed, el, dmg: this.dmg * dmgMult, ...extra });
  }
  muzzle() { return this.g.actors.muzzlePos(this.a); }
  ring(n, speed, el, dmgMult = 0.5, offset = 0, y = 1.2) {
    const a = this.a;
    const p = new THREE.Vector3(a.pos.x, a.pos.y + y, a.pos.z);
    for (let i = 0; i < n; i++) {
      const ang = offset + (i / n) * Math.PI * 2;
      this.proj(p, new THREE.Vector3(Math.sin(ang), 0, Math.cos(ang)), speed, el, dmgMult);
    }
    this.g.audio?.play('enemy_projectile', { pos: p });
  }
  aimed(p, n, spread, speed, el, dmgMult = 0.6, extra = {}) {
    const m = this.muzzle();
    const d0 = new THREE.Vector3(p.pos.x - m.x, p.pos.y + 1.1 - m.y, p.pos.z - m.z).normalize();
    for (let i = 0; i < n; i++) {
      const s = n > 1 ? (i / (n - 1) - 0.5) * spread * 2 : 0;
      this.proj(m, d0.clone().applyAxisAngle(UP, s), speed, el, dmgMult, extra);
    }
    this.g.audio?.play('enemy_projectile', { pos: m });
  }
  dash(yaw, speed, time) {
    this.moveVel = { x: Math.sin(yaw) * speed, z: Math.cos(yaw) * speed, t: time };
  }
  summon(type, n, radius = 4) {
    const g = this.g, a = this.a;
    for (let i = 0; i < n; i++) {
      for (let k = 0; k < 8; k++) {
        const ang = Math.random() * Math.PI * 2;
        const x = a.pos.x + Math.cos(ang) * radius, z = a.pos.z + Math.sin(ang) * radius;
        if (g.collision.cellBlocked(Math.floor(x / 2), Math.floor(z / 2), a.pos.y + 0.5)) continue;
        g.director.spawnEnemy(type, x, z, { noCredit: true });
        break;
      }
    }
  }
  roomRandom(margin = 2) {
    const room = this.g.level.roomAt(this.a.pos.x, this.a.pos.z) ?? this.data.room;
    if (!room) return { x: this.a.pos.x, z: this.a.pos.z };
    for (let i = 0; i < 20; i++) {
      const x = (room.x + margin + Math.random() * (room.w - margin * 2)) * 2;
      const z = (room.y + margin + Math.random() * (room.h - margin * 2)) * 2;
      if (!this.g.collision.cellBlocked(Math.floor(x / 2), Math.floor(z / 2), 1)) return { x, z };
    }
    return { x: room.cx, z: room.cz };
  }
  banner(text, sub, color) { this.g.net?.broadcast({ t: 'banner', a: text, b: sub, c: color }); this.g.ui?.banner(text, sub, color); }
  shake(k) { this.g.net?.broadcast({ t: 'shake', k }); this.g.vfx.addShake(k); }
  sound(name, vol = 1) { this.g.net?.broadcast({ t: 'snd', n: name, x: this.a.pos.x, y: this.a.pos.y, z: this.a.pos.z, v: vol }); this.g.audio?.play(name, { pos: this.a.pos, volume: vol }); }
  fx(kind, extra = {}) { this.g.net?.broadcast({ t: 'bfx', k: kind, id: this.a.id, ...extra }); this.g.bossFx(kind, this.a, extra); }

  _dread() {
    const n = 12 + 2 * this.phase, off = Math.random() * Math.PI * 2, step = Math.PI * 2 / n;
    this.fx('dread');
    // at chest height above the ground, even from a boss on the wing
    const y = () => 1.0 - (this.a.pos.y - this.g.groundY(this.a.pos.x, this.a.pos.z));
    this.at(0.75, () => this.ring(n, 6.5 + this.phase * 0.6, 'enemyFire', 0.3, off, y()));
    this.at(1.25, () => this.ring(n, 6.5 + this.phase * 0.6, 'enemyFire', 0.3, off + step / 2, y()));
  }

  idleType() { const t = this.script.idleType; return typeof t === 'function' ? t(this) : (t ?? ''); }

  // ------------------------------------------------ main update
  update(dt, mm, am) {
    const a = this.a;
    const S = this.script;
    this.invuln = Math.max(0, this.invuln - dt);
    // phase transitions
    const phases = S.phases;
    this.fightT = (this.fightT ?? 0) + dt;
    // a phase can also begin after a set time (the Hollow King won't sit forever)
    while (this.phase < phases.length - 1 && (this.hpf <= phases[this.phase + 1].at || (phases[this.phase + 1].after && this.fightT >= phases[this.phase + 1].after))) {
      this.phase++;
      this.events.length = 0;
      this.moveVel = null;
      this.busy = 0;
      // visual only: every peer's model plays its phase-change moment (see Game.bossFx)
      this.fx('phase', { n: this.phase });
      phases[this.phase].enter?.(this);
    }
    // timed events
    for (let i = this.events.length - 1; i >= 0; i--) {
      const e = this.events[i];
      e.t -= dt * Math.max(0.3, am);
      if (e.t <= 0) { this.events.splice(i, 1); e.fn(); }
    }
    for (const k in this.cds) this.cds[k] -= dt;
    // Nightmare: between (and over) its moves the boss looses dread rings, two
    // staggered rings of slow bolts whose gaps you weave through; faster each phase
    if (this.g.difficulty?.dreadPulse && this.fightT > 4 && !a.hiddenT) {
      this.dreadT = (this.dreadT ?? 5) - dt * Math.max(0.3, am);
      if (this.dreadT <= 0) { this.dreadT = [8, 6.5, 5.2, 4.5][Math.min(this.phase, 3)]; this._dread(); }
    }
    // anim progress
    this.animT += dt * Math.max(0.3, am);
    a.progress = Math.min(1, this.animT / Math.max(0.05, this.animDur));
    a.state = a.anim === 'windup' ? 'windup' : 'chase';
    const out = { x: 0, z: 0 };
    const tgt = this.target;
    if (this.moveVel) {
      out.x = this.moveVel.x * dt; out.z = this.moveVel.z * dt;
      this.moveVel.t -= dt;
      if (this.moveVel.t <= 0) this.moveVel = null;
      if (Math.random() < 0.6) this.g.vfx.smoke(new THREE.Vector3(a.pos.x, a.pos.y + 0.4, a.pos.z), { count: 1, size: 1, color: [0.25, 0.2, 0.18], alpha: 0.4 });
      return out;
    }
    if (this.busy > 0) {
      this.busy -= dt * Math.max(0.3, am);
      if (this.move?.track && tgt) this.face(tgt, this.move.track, dt);
      if (this.busy <= 0 && a.anim !== 'idle' && a.anim !== 'move') this.anim('idle', this.idleType(), 1);
      return out;
    }
    if (!tgt) { this.anim('idle', this.idleType(), 1); return out; }
    // choose a move
    const dist = Math.hypot(tgt.pos.x - a.pos.x, tgt.pos.z - a.pos.z);
    const pool = phases[this.phase].moves.filter((m) => (this.cds[m.name] ?? 0) <= 0 && (!m.range || (dist >= m.range[0] && dist <= m.range[1])) && (!m.when || m.when(this)));
    if (pool.length) {
      let tot = 0;
      for (const m of pool) tot += m.w ?? 1;
      let r = Math.random() * tot;
      let pick = pool[0];
      for (const m of pool) { r -= m.w ?? 1; if (r <= 0) { pick = m; break; } }
      this.move = pick;
      this.cds[pick.name] = (pick.cd ?? 3) * (this.g.difficulty?.bossCd ?? 1);
      this.face(tgt);
      const dur = pick.run(this, tgt, dist);
      this.busy = (dur ?? 1) / (phases[this.phase].speed ?? 1);
      return out;
    }
    if (this.data.seated) { if (a.anim !== 'idle') this.anim('idle', this.idleType(), 1); this.face(tgt, 2, dt); return out; }
    // walk toward the target
    const speed = (a.def.speed ?? 3) * mm * (phases[this.phase].speed ?? 1);
    const want = (typeof S.keepDist === 'function' ? S.keepDist(this) : S.keepDist) ?? 3.5;
    if (dist > want) {
      this.face(tgt, 5, dt);
      out.x = Math.sin(a.yaw) * speed * dt; out.z = Math.cos(a.yaw) * speed * dt;
      if (a.anim !== 'move') { a.anim = 'move'; a.animT = 0; }
    } else if (S.keepDist && dist < want * 0.6) {
      this.face(tgt, 5, dt);
      out.x = -Math.sin(a.yaw) * speed * dt; out.z = -Math.cos(a.yaw) * speed * dt;
      if (a.anim !== 'move') { a.anim = 'move'; a.animT = 0; }
    } else if (a.anim !== 'idle') this.anim('idle', this.idleType(), 1);
    return out;
  }
}

// ---------------------------------------------------------------------------
// Scripts
// ---------------------------------------------------------------------------
const SCRIPTS = {};

// ---------------- MOTHER OF FILTH ---------------------------------------
SCRIPTS.motherOfFilth = {
  keepDist: 6,
  phases: [
    {
      at: 1,
      moves: [
        { name: 'spit', w: 3, cd: 2.5, range: [4, 40], run(B, t) {
          B.anim('windup', 'spit', 0.8);
          B.at(0.8, () => {
            B.anim('attack', 'spit', 0.5);
            for (const p of B.players()) {
              for (let i = 0; i < 3; i++) {
                const tx = p.pos.x + rand(-3, 3), tz = p.pos.z + rand(-3, 3);
                B.circle(tx, tz, 2.2, 1.2 + i * 0.15, 0.7, 'enemyGreen', { pool: [2.4, 4, B.dmg * 0.3] });
                B.fx('lob', { x: tx, z: tz, t: 1.2 + i * 0.15 });
              }
            }
            B.sound('enemy_projectile');
          });
          return 1.6;
        } },
        { name: 'slam', w: 3, cd: 3, range: [0, 9], run(B, t) {
          B.anim('windup', 'slam', 1.0);
          const yaw = B.yawTo(t.pos);
          const x = B.a.pos.x + Math.sin(yaw) * 4, z = B.a.pos.z + Math.cos(yaw) * 4;
          B.circle(x, z, 4, 1.0, 1.2, 'enemyGreen');
          B.at(1.0, () => { B.anim('attack', 'slam', 0.6); B.shake(0.35); B.sound('boss_slam'); });
          return 1.8;
        } },
        { name: 'brood', w: 1, cd: 14, run(B) {
          B.anim('cast', 'summon', 1.2);
          B.sound('boss_roar', 0.7);
          B.at(1.0, () => B.summon(Math.random() < 0.5 ? 'slime' : 'rat', 3 + B.players().length, 5));
          return 1.8;
        } },
      ],
    },
    {
      at: 0.66,
      enter(B) { B.banner('THE FILTH RISES', 'The Mother submerges...', '#9adf3a'); B.sound('boss_roar'); },
      speed: 1.15,
      moves: [
        { name: 'submerge', w: 3, cd: 6, run(B) {
          B.anim('cast', 'submerge', 1.4);
          B.invuln = 2.2;
          B.fx('submerge');
          const tgts = B.players();
          const t = tgts[Math.floor(Math.random() * tgts.length)];
          if (!t) return 1;
          // surface beside the target (toward the arena centre), never exactly on top of it
          const room = B.data.room;
          let ox = room ? room.cx - t.pos.x : 1, oz = room ? room.cz - t.pos.z : 0;
          const ol = Math.hypot(ox, oz) || 1;
          const tx = t.pos.x + (ox / ol) * 2.5, tz = t.pos.z + (oz / ol) * 2.5;
          B.circle(tx, tz, 5, 2.0, 1.4, 'enemyGreen');
          B.at(1.9, () => { B.a.pos.x = tx; B.a.pos.z = tz; B.a.net.x = tx; B.a.net.z = tz; B.anim('attack', 'slam', 0.6); B.shake(0.5); B.sound('boss_slam'); B.fx('emerge'); B.wave(2, 9, 12, 0.6, 'enemyGreen', 0.05); });
          return 3.0;
        } },
        { name: 'spit', w: 2, cd: 2.2, range: [4, 40], run(B) {
          B.anim('windup', 'spit', 0.6);
          B.at(0.6, () => { for (const p of B.players()) B.aimed(p, 5, 0.35, 15, 'enemyGreen', 0.45); });
          return 1.2;
        } },
        { name: 'brood', w: 1, cd: 12, run(B) { B.anim('cast', 'summon', 1.0); B.at(0.8, () => B.summon('slime', 2, 5)); return 1.4; } },
      ],
    },
    {
      at: 0.33,
      enter(B) { B.banner('ROTTING FURY', 'Toxic tides surge — JUMP the waves!', '#9adf3a'); B.sound('boss_roar'); },
      speed: 1.3,
      moves: [
        { name: 'tide', w: 3, cd: 4, run(B) {
          B.anim('windup', 'slam', 0.8);
          B.at(0.8, () => { B.anim('attack', 'slam', 0.5); B.wave(2, 8, 22, 0.7, 'enemyGreen'); B.at(0.7, () => B.wave(2, 8, 22, 0.7, 'enemyGreen')); B.shake(0.4); B.sound('boss_slam'); });
          return 2.0;
        } },
        { name: 'rain', w: 2, cd: 5, run(B) {
          B.anim('cast', 'spit', 1.0);
          for (let i = 0; i < 10; i++) { const p = B.roomRandom(2); B.circle(p.x, p.z, 2.4, 1.0 + i * 0.12, 0.7, 'enemyGreen', { pool: [2.2, 3, B.dmg * 0.3] }); }
          return 1.8;
        } },
        { name: 'submerge', w: 2, cd: 6, run(B) { return SCRIPTS.motherOfFilth.phases[1].moves[0].run(B); } },
      ],
    },
  ],
};

// ---------------- THE EXECUTIONER -----------------------------------------
SCRIPTS.executioner = {
  keepDist: 3,
  phases: [
    {
      at: 1,
      moves: [
        { name: 'chop', w: 3, cd: 2.2, range: [0, 7], track: 3, run(B, t) {
          B.anim('windup', 'slam', 1.0);
          const yaw = B.yawTo(t.pos);
          const x = B.a.pos.x + Math.sin(yaw) * 3.6, z = B.a.pos.z + Math.cos(yaw) * 3.6;
          B.circle(x, z, 2.8, 1.0, 1.4, 'physical');
          B.at(1.0, () => { B.anim('attack', 'slam', 0.6); B.shake(0.4); B.sound('boss_slam'); });
          return 1.8;
        } },
        { name: 'sweep', w: 2, cd: 4, range: [0, 6], run(B, t) {
          B.anim('windup', 'sweep', 0.9);
          B.hazard({ shape: 'cone', x: B.a.pos.x, y: B.a.pos.y, z: B.a.pos.z, r: 6.5, rot: B.yawTo(t.pos), angle: 1.3, delay: 0.9, dmg: B.dmg, el: 'physical', kb: 12 });
          B.at(0.9, () => { B.anim('attack', 'sweep', 0.5); B.sound('swing'); });
          return 1.6;
        } },
        { name: 'charge', w: 2, cd: 6, range: [6, 40], run(B, t) {
          B.anim('windup', 'charge', 0.9);
          const yaw = B.yawTo(t.pos);
          B.a.yaw = yaw;
          B.hazard({ shape: 'rect', x: B.a.pos.x, y: B.a.pos.y, z: B.a.pos.z, rot: yaw, len: 18, w: 3.4, delay: 1.1, teleDur: 0.9, dmg: B.dmg * 1.2, el: 'physical', kb: 16 });
          B.at(0.9, () => { B.anim('attack', 'charge', 0.9); B.dash(yaw, 20, 0.85); B.sound('boss_roar', 0.6); });
          return 2.0;
        } },
      ],
    },
    {
      at: 0.66,
      enter(B) { B.banner('THE GALLOWS CALL', 'The Executioner summons his condemned', '#ff6040'); B.sound('boss_roar'); B.summon('skeleton', 3, 5); },
      speed: 1.1,
      moves: [
        { name: 'chop', w: 3, cd: 2, range: [0, 7], track: 3, run(B, t) { return SCRIPTS.executioner.phases[0].moves[0].run(B, t); } },
        { name: 'sweep', w: 2, cd: 3.5, range: [0, 6], run(B, t) { return SCRIPTS.executioner.phases[0].moves[1].run(B, t); } },
        { name: 'guillotines', w: 2, cd: 6, run(B) {
          B.anim('cast', 'roar', 1.2);
          B.sound('boss_roar', 0.8);
          for (const p of B.players()) for (let i = 0; i < 4; i++) B.circle(p.pos.x + rand(-3, 3), p.pos.z + rand(-3, 3), 1.8, 1.0 + i * 0.35, 1.0, 'physical', { blade: 1 });
          return 1.6;
        } },
        { name: 'charge', w: 1, cd: 6, range: [6, 40], run(B, t) { return SCRIPTS.executioner.phases[0].moves[2].run(B, t); } },
        { name: 'guards', w: 1, cd: 18, run(B) { B.anim('cast', 'roar', 1.2); B.at(0.8, () => B.summon('skeleton', 2 + B.players().length, 5)); return 1.5; } },
      ],
    },
    {
      at: 0.33,
      enter(B) { B.banner('BLOODLUST', 'His axe burns — JUMP the shockwaves!', '#ff3020'); B.sound('boss_roar'); B.fx('enrage'); },
      speed: 1.3,
      moves: [
        { name: 'quake', w: 3, cd: 3.5, run(B) {
          B.anim('windup', 'slam', 0.9);
          B.at(0.9, () => { B.anim('attack', 'slam', 0.5); B.shake(0.5); B.sound('boss_slam'); B.wave(1.5, 10, 24, 0.7, 'enemyFire'); });
          B.at(1.5, () => { B.anim('attack', 'slam', 0.5); B.wave(1.5, 12, 24, 0.7, 'enemyFire'); B.sound('boss_slam'); });
          return 2.2;
        } },
        { name: 'chop', w: 2, cd: 1.8, range: [0, 7], track: 4, run(B, t) { return SCRIPTS.executioner.phases[0].moves[0].run(B, t); } },
        { name: 'brand', w: 2, cd: 4, run(B) {
          B.anim('windup', 'sweep', 0.7);
          B.at(0.7, () => { B.anim('attack', 'sweep', 0.4); for (const p of B.players()) B.aimed(p, 5, 0.5, 18, 'enemyFire', 0.5, { aoe: 1.8 }); });
          return 1.4;
        } },
        { name: 'charge', w: 1, cd: 5, range: [6, 40], run(B, t) { return SCRIPTS.executioner.phases[0].moves[2].run(B, t); } },
      ],
    },
  ],
};

// ---------------- STONE WYVERN (Gravemaw) ---------------------------------
SCRIPTS.stoneWyvern = {
  // airborne it hangs back so it stays in the player's view instead of hovering overhead
  keepDist: (B) => (B.data.fly ? 12 : 6),
  init(B) { B.data.fly = true; B.fx('fly', { on: 1 }); },
  modifyDamage(B, dmg) { return B.data.fly ? dmg * 0.85 : dmg; },
  phases: [
    {
      at: 1,
      moves: [
        { name: 'breath', w: 3, cd: 3.5, range: [0, 22], track: 1.2, run(B, t) {
          B.anim('windup', 'breath', 0.8);
          B.sound('boss_roar', 0.6);
          const yaw0 = B.yawTo(t.pos);
          B.hazard({ shape: 'cone', x: B.a.pos.x, y: B.a.pos.y, z: B.a.pos.z, r: 13, rot: yaw0, angle: 0.5, delay: 1.1, teleDur: 0.8, dmg: B.dmg * 0.9, el: 'enemyFire', st: { burn: [3, 6] } });
          B.at(0.8, () => { B.anim('attack', 'breath', 1.2); B.fx('breath', { yaw: yaw0, dur: 1.0 }); });
          return 2.2;
        } },
        { name: 'dive', w: 2, cd: 5, range: [5, 40], run(B, t) {
          B.anim('windup', 'fly', 0.9);
          const yaw = B.yawTo(t.pos);
          B.a.yaw = yaw;
          B.hazard({ shape: 'rect', x: B.a.pos.x, y: B.a.pos.y, z: B.a.pos.z, rot: yaw, len: 20, w: 4, delay: 1.1, teleDur: 0.9, dmg: B.dmg * 1.1, el: 'physical', kb: 16 });
          B.at(0.9, () => { B.anim('attack', 'fly', 0.9); B.dash(yaw, 24, 0.8); B.sound('boss_roar', 0.6); });
          return 2.0;
        } },
        { name: 'rocks', w: 2, cd: 6, run(B) {
          B.anim('cast', 'roar', 1.0);
          B.sound('boss_roar', 0.8);
          for (let i = 0; i < 8; i++) { const p = B.roomRandom(2); B.circle(p.x, p.z, 2.6, 1.2 + i * 0.1, 0.9, 'earth', { boulder: 1 }); }
          for (const p of B.players()) B.circle(p.pos.x, p.pos.z, 2.6, 1.3, 0.9, 'earth', { boulder: 1 });
          return 1.8;
        } },
      ],
    },
    {
      at: 0.6,
      enter(B) { B.data.fly = false; B.fx('fly', { on: 0 }); B.banner('GRAVEMAW LANDS', 'Its wings are broken — it fights with fury', '#e0a050'); B.sound('boss_roar'); B.shake(0.6); },
      speed: 1.1,
      moves: [
        { name: 'tail', w: 3, cd: 3, range: [0, 8], run(B, t) {
          B.anim('windup', 'sweep', 0.8);
          B.hazard({ shape: 'circle', x: B.a.pos.x, y: B.a.pos.y, z: B.a.pos.z, r: 7.5, delay: 0.8, dmg: B.dmg, el: 'physical', kb: 18 });
          B.at(0.8, () => { B.anim('attack', 'sweep', 0.6); B.sound('swing'); B.shake(0.3); });
          return 1.6;
        } },
        { name: 'stomp', w: 2, cd: 4, run(B) {
          B.anim('windup', 'slam', 0.8);
          B.at(0.8, () => { B.anim('attack', 'slam', 0.5); B.wave(2, 9, 22, 0.7, 'earth'); B.shake(0.5); B.sound('boss_slam'); });
          return 1.6;
        } },
        { name: 'breath', w: 2, cd: 3.5, range: [0, 22], track: 1.2, run(B, t) { return SCRIPTS.stoneWyvern.phases[0].moves[0].run(B, t); } },
      ],
    },
    {
      at: 0.3,
      enter(B) { B.banner('MAGMA HEART', 'Molten fury erupts from its cracks', '#ff6020'); B.sound('boss_roar'); B.fx('enrage'); },
      speed: 1.3,
      moves: [
        { name: 'sweepBreath', w: 3, cd: 4, run(B, t) {
          B.anim('windup', 'breath', 0.6);
          const base = B.yawTo(t.pos);
          for (let i = 0; i < 5; i++) B.hazard({ shape: 'cone', x: B.a.pos.x, y: B.a.pos.y, z: B.a.pos.z, r: 14, rot: base - 0.9 + i * 0.45, angle: 0.3, delay: 0.9 + i * 0.25, teleDur: 0.6 + i * 0.25, dmg: B.dmg * 0.8, el: 'enemyFire', st: { burn: [3, 6] } });
          B.at(0.6, () => { B.anim('attack', 'breath', 1.6); B.fx('breath', { yaw: base - 0.9, sweep: 1.8, dur: 1.4 }); });
          return 2.6;
        } },
        { name: 'meteors', w: 2, cd: 5, run(B) {
          B.anim('cast', 'roar', 1.0);
          for (let i = 0; i < 12; i++) { const p = B.roomRandom(2); B.circle(p.x, p.z, 2.4, 1.0 + i * 0.12, 0.9, 'enemyFire', { meteor: 1 }); }
          return 1.8;
        } },
        { name: 'stomp', w: 2, cd: 3.5, run(B) { return SCRIPTS.stoneWyvern.phases[1].moves[1].run(B); } },
        { name: 'tail', w: 2, cd: 3, range: [0, 8], run(B, t) { return SCRIPTS.stoneWyvern.phases[1].moves[0].run(B, t); } },
      ],
    },
  ],
};

// ---------------- COURT ARCHMAGE (Veyrin) ---------------------------------
SCRIPTS.courtArchmage = {
  keepDist: 10,
  phases: [
    {
      at: 1,
      moves: [
        { name: 'volley', w: 3, cd: 2, range: [0, 40], run(B, t) {
          B.anim('cast', 'cast', 0.7);
          const els = ['enemyFire', 'arcane', 'frost', 'enemyPurple'];
          const el = els[(B.data.el = ((B.data.el ?? 0) + 1) % 4)];
          B.at(0.6, () => { for (const p of B.players()) B.aimed(p, 5, 0.3, 20, el, 0.5); });
          return 1.2;
        } },
        { name: 'runes', w: 2, cd: 4, run(B) {
          B.anim('cast', 'cast', 1.0);
          for (const p of B.players()) for (let i = 0; i < 3; i++) B.circle(p.pos.x + rand(-4, 4), p.pos.z + rand(-4, 4), 3, 1.2 + i * 0.2, 0.9, 'arcane');
          return 1.6;
        } },
        { name: 'nova', w: 2, cd: 5, run(B) {
          B.anim('cast', 'spin', 1.0);
          B.at(0.8, () => { B.ring(18, 12, 'arcane', 0.5, 0); B.at(0.4, () => B.ring(18, 12, 'arcane', 0.5, Math.PI / 18)); });
          return 1.8;
        } },
        { name: 'blink', w: 1, cd: 5, run(B) {
          B.anim('cast', 'cast', 0.4);
          B.at(0.35, () => { const p = B.roomRandom(3); B.g.actors.blinkFx(B.a.pos); B.g.net?.broadcast({ t: 'blinkfx', x: B.a.pos.x, y: B.a.pos.y, z: B.a.pos.z }); B.a.pos.x = p.x; B.a.pos.z = p.z; B.a.net.x = p.x; B.a.net.z = p.z; B.g.actors.blinkFx(B.a.pos); });
          return 0.8;
        } },
      ],
    },
    {
      at: 0.66,
      enter(B) { B.banner('THE MIRRORED COURT', 'Veyrin splits into illusions', '#c060ff'); B.sound('boss_roar'); B.summon('courtSorcerer', 2 + B.players().length, 6); },
      speed: 1.1,
      moves: [
        { name: 'spiral', w: 3, cd: 4, run(B) {
          B.anim('cast', 'spin', 2.4);
          for (let i = 0; i < 16; i++) B.at(0.3 + i * 0.12, () => { B.ring(4, 11, 'enemyPurple', 0.4, i * 0.25); });
          return 2.6;
        } },
        { name: 'volley', w: 2, cd: 2, run(B, t) { return SCRIPTS.courtArchmage.phases[0].moves[0].run(B, t); } },
        { name: 'blink', w: 1, cd: 4, run(B) { return SCRIPTS.courtArchmage.phases[0].moves[3].run(B); } },
        { name: 'court', w: 1, cd: 16, run(B) { B.anim('cast', 'summon', 1.2); B.at(1.0, () => B.summon(Math.random() < 0.5 ? 'grimoire' : 'courtSorcerer', 3, 5)); return 1.5; } },
      ],
    },
    {
      at: 0.33,
      enter(B) { B.banner('ARCANE CATACLYSM', 'Reality unravels', '#ff60ff'); B.sound('boss_roar'); B.fx('enrage'); },
      speed: 1.25,
      moves: [
        { name: 'beams', w: 3, cd: 4, run(B, t) {
          B.anim('cast', 'beam', 1.6);
          const base = B.yawTo(t.pos);
          for (let i = 0; i < 4; i++) {
            const rot = base + (i - 1.5) * 0.7;
            B.hazard({ shape: 'rect', x: B.a.pos.x, y: B.a.pos.y, z: B.a.pos.z, rot, len: 26, w: 2.2, delay: 1.2 + i * 0.15, teleDur: 1.0 + i * 0.15, dmg: B.dmg * 1.0, el: 'arcane', beam: 1 });
          }
          return 2.2;
        } },
        { name: 'spiral', w: 2, cd: 4, run(B) { return SCRIPTS.courtArchmage.phases[1].moves[0].run(B); } },
        { name: 'runes', w: 2, cd: 4, run(B) { return SCRIPTS.courtArchmage.phases[0].moves[1].run(B); } },
        { name: 'blink', w: 1, cd: 4, run(B) { return SCRIPTS.courtArchmage.phases[0].moves[3].run(B); } },
      ],
    },
  ],
};

// ---------------- THE HOLLOW KING ----------------------------------------
SCRIPTS.hollowKing = {
  keepDist: 3.5,
  init(B) {
    B.data.seated = true;
    B.anim('idle', 'seated', 1);
  },
  idleType: (B) => (B.data.seated ? 'seated' : ''),
  modifyDamage(B, dmg) { return B.data.seated ? dmg * 0.6 : dmg; },
  phases: [
    {
      at: 1,
      moves: [
        { name: 'crownBeams', w: 3, cd: 3, run(B, t) {
          B.anim('cast', 'seated', 1.2);
          for (const p of B.players()) {
            const rot = B.yawTo(p.pos);
            B.hazard({ shape: 'rect', x: B.a.pos.x, y: B.a.pos.y, z: B.a.pos.z, rot, len: 30, w: 2.0, delay: 1.0, teleDur: 0.9, dmg: B.dmg * 0.8, el: 'enemyPurple', beam: 1 });
          }
          return 1.6;
        } },
        { name: 'rain', w: 2, cd: 4, run(B) {
          B.anim('cast', 'seated', 1.0);
          for (let i = 0; i < 8; i++) { const p = B.roomRandom(3); B.circle(p.x, p.z, 2.6, 1.2 + i * 0.1, 0.8, 'enemyPurple'); }
          for (const p of B.players()) B.circle(p.pos.x, p.pos.z, 2.6, 1.4, 0.8, 'enemyPurple');
          return 1.6;
        } },
        { name: 'guard', w: 1, cd: 12, run(B) {
          B.anim('cast', 'seated', 1.0);
          B.sound('boss_roar', 0.6);
          B.at(0.8, () => B.summon(Math.random() < 0.6 ? 'royalGuard' : 'wraith', 1 + Math.ceil(B.players().length / 2), 7));
          return 1.4;
        } },
        { name: 'volley', w: 2, cd: 2.4, run(B, t) {
          B.anim('cast', 'seated', 0.8);
          B.at(0.6, () => { for (const p of B.players()) B.aimed(p, 3, 0.25, 18, 'enemyPurple', 0.5, { homing: 1 }); });
          return 1.2;
        } },
      ],
    },
    {
      at: 0.7,
      after: 22,
      enter(B) {
        B.data.seated = false;
        B.banner('THE KING RISES', 'The Hollow King draws his blade', '#b070ff');
        B.sound('boss_roar'); B.shake(0.7);
        B.anim('cast', 'roar', 1.5);
        B.busy = 1.6;
        B.fx('rise');
        B.wave(2, 10, 30, 0.6, 'enemyPurple', 0.6);
      },
      speed: 1.05,
      moves: [
        { name: 'sweep', w: 3, cd: 2.5, range: [0, 7], run(B, t) {
          B.anim('windup', 'sweep', 0.9);
          B.hazard({ shape: 'cone', x: B.a.pos.x, y: B.a.pos.y, z: B.a.pos.z, r: 7.5, rot: B.yawTo(t.pos), angle: 1.4, delay: 0.9, dmg: B.dmg, el: 'physical', kb: 14 });
          B.at(0.9, () => { B.anim('attack', 'sweep', 0.5); B.sound('swing'); B.shake(0.2); });
          return 1.6;
        } },
        { name: 'thrust', w: 2, cd: 3, range: [0, 14], run(B, t) {
          B.anim('windup', 'thrust', 0.8);
          const rot = B.yawTo(t.pos);
          B.hazard({ shape: 'rect', x: B.a.pos.x, y: B.a.pos.y, z: B.a.pos.z, rot, len: 14, w: 2.2, delay: 0.8, dmg: B.dmg * 1.2, el: 'physical', kb: 12 });
          B.at(0.8, () => { B.anim('attack', 'thrust', 0.5); B.dash(rot, 14, 0.3); B.sound('swing'); });
          return 1.5;
        } },
        { name: 'plunge', w: 2, cd: 5, run(B) {
          B.anim('windup', 'slam', 1.1);
          B.circle(B.a.pos.x, B.a.pos.z, 6, 1.1, 1.3, 'enemyPurple', { pool: [6, 5, B.dmg * 0.2] });
          B.at(1.1, () => { B.anim('attack', 'slam', 0.5); B.shake(0.6); B.sound('boss_slam'); B.wave(2, 10, 24, 0.6, 'enemyPurple', 0.1); });
          return 2.0;
        } },
        { name: 'wraiths', w: 1, cd: 14, run(B) { B.anim('cast', 'summon', 1.2); B.at(1.0, () => B.summon('wraith', 2 + B.players().length, 6)); return 1.5; } },
      ],
    },
    {
      at: 0.33,
      enter(B) {
        B.banner('ECLIPSE', 'The last light dies — hide behind the pillars!', '#ff40ff');
        B.sound('boss_roar'); B.shake(0.8);
        B.fx('eclipse');
      },
      speed: 1.25,
      moves: [
        { name: 'voidSpiral', w: 2, cd: 5, run(B) {
          B.anim('cast', 'beam', 2.6);
          for (let i = 0; i < 18; i++) B.at(0.3 + i * 0.13, () => B.ring(5, 10, 'enemyPurple', 0.45, i * 0.22));
          return 2.8;
        } },
        { name: 'sweep', w: 2, cd: 2.2, range: [0, 7], run(B, t) { return SCRIPTS.hollowKing.phases[1].moves[0].run(B, t); } },
        { name: 'thrust', w: 2, cd: 2.8, range: [0, 14], run(B, t) { return SCRIPTS.hollowKing.phases[1].moves[1].run(B, t); } },
        { name: 'judgment', w: 1, cd: 16, when: (B) => B.hpf < 0.25, run(B) {
          B.anim('cast', 'roar', 4);
          B.banner('THE KING\'S JUDGMENT', 'Break line of sight!', '#ff40ff');
          B.hazard({ shape: 'los', x: B.a.pos.x, y: B.a.pos.y + 3, z: B.a.pos.z, r: 60, delay: 4, dmg: B.dmg * 2.5, el: 'enemyPurple', vis: 1 });
          B.fx('judgment');
          return 4.6;
        } },
        { name: 'rain', w: 2, cd: 4, run(B) { return SCRIPTS.hollowKing.phases[0].moves[1].run(B); } },
      ],
    },
  ],
};

export { SCRIPTS, SPR };
