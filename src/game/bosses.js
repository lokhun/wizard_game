import * as THREE from 'three';
import { angleDamp, clamp } from '../core/math.js';
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
    this.spin = 0; this.spinT = 0; // a whirl turns the body (rad/s) while it lasts
    this.pressT = 0; // a final phase's arena pressure (phase.press) comes round on its own clock
    this.exposed = 0; // after a committed move (a leap's crash, a whirl, a charge) the boss takes +30% for a moment
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

  // Bosses can't be out-scaled past their fight: no one blow takes more than a
  // tenth of one, and a phase threshold holds (damage past it is lost and the boss
  // turns untouchable for a moment as it changes), so even a build that nukes the
  // rooms has to see every phase through
  modifyDamage(dmg, H) {
    if (this.invuln > 0) return 0;
    if (this.script.modifyDamage) dmg = this.script.modifyDamage(this, dmg, H);
    if (this.exposed > 0) dmg *= 1.3;
    const a = this.a, max = a.maxHp;
    dmg = Math.min(dmg, max * 0.1);
    const nx = this.script.phases[this.phase + 1];
    if (nx?.at !== undefined && nx.at < 1) {
      const T = nx.at * max;
      if (a.hp > T && a.hp - dmg <= T) { dmg = a.hp - T + 0.01; this.invuln = 1.5; }
    }
    return dmg;
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
  // (mv names the move, for the death recap)
  hazard(h) { this.g.broadcastHazard({ src: this.a.id, el: 'enemy', vis: 1, mv: this.move?.title ?? this.move?.name, ...h }); }
  circle(x, z, r, delay, dmgMult = 1, el = 'enemy', extra = {}) {
    this.hazard({ shape: 'circle', x, y: this.g.groundY(x, z), z, r, delay, dmg: this.dmg * dmgMult, el, fx: el, ...extra });
  }
  wave(r0, speed, maxR, dmgMult = 0.8, el = 'enemy', delay = 0) {
    const a = this.a;
    this.hazard({ shape: 'wave', x: a.pos.x, y: a.pos.y, z: a.pos.z, r: r0, speed, maxR, delay, dmg: this.dmg * dmgMult, el, fx: el });
  }
  proj(pos, dir, speed, el = 'enemy', dmgMult = 0.6, extra = {}) {
    this.g.broadcastEnemyProjectile({ x: pos.x, y: pos.y, z: pos.z, vx: dir.x * speed, vy: dir.y * speed, vz: dir.z * speed, el, dmg: this.dmg * dmgMult, src: this.a.id, mv: this._projMv ?? this.move?.title ?? this.move?.name, ...extra });
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
  arena() {
    const r = this.g.level.roomAt(this.a.pos.x, this.a.pos.z) ?? this.data.room;
    return r ? { x0: r.x * 2 + 2, z0: r.y * 2 + 2, x1: (r.x + r.w) * 2 - 2, z1: (r.y + r.h) * 2 - 2 } : { x0: this.a.pos.x - 14, z0: this.a.pos.z - 14, x1: this.a.pos.x + 14, z1: this.a.pos.z + 14 };
  }
  // A leap: the landing ring is marked at once; the boss crouches, springs an arc
  // h metres high over `air` s, and crashes down. Lands in the arena, never in a wall.
  // Returns the time to landing (the move's busy time adds the flight: see update).
  leap(x, z, o = {}) {
    const a = this.a, g = this.g, A = this.arena();
    const crouch = o.crouch ?? 0.6, air = o.air ?? 0.8, r = o.r ?? 4.5;
    x = clamp(x, A.x0 + 1.5, A.x1 - 1.5); z = clamp(z, A.z0 + 1.5, A.z1 - 1.5);
    if (g.collision.cellBlocked(Math.floor(x / 2), Math.floor(z / 2), a.pos.y + 0.5)) { x = a.pos.x; z = a.pos.z; }
    const yaw = Math.atan2(x - a.pos.x, z - a.pos.z), d = Math.hypot(x - a.pos.x, z - a.pos.z);
    a.yaw = yaw;
    this.anim('windup', o.type ?? 'leap', crouch);
    this.circle(x, z, r, crouch + air, o.dmg ?? 1.2, o.el ?? 'physical', { kb: o.kb ?? 12 });
    this.at(crouch, () => {
      a.yaw = yaw;
      this.anim(o.airAnim ?? 'attack', o.airType ?? o.type ?? 'leap', air);
      if (d > 0.5) this.dash(yaw, d / air, air);
      this.fx('leap', { dur: air, h: o.h ?? 4 });
      this.sound('boss_roar', 0.5);
    });
    this.at(crouch + air, () => {
      // (a pillar in the way stops the dash: land where it was aimed all the same)
      if (Math.hypot(x - a.pos.x, z - a.pos.z) > 0.8) { a.pos.x = x; a.pos.z = z; a.net.x = x; a.net.z = z; }
      this.anim('attack', o.landType ?? 'slam', 0.6);
      this.shake(0.55); this.sound('boss_slam');
      this.fx('land', { el: o.el ?? 'earth', r });
      this.expose(1.4);
      o.onLand?.();
    });
    return crouch + air;
  }
  // a boss's last stand: once, below 12% health, announced
  lastStand(title, sub, color) { this.banner(title, sub, color); this.sound('boss_roar'); this.shake(0.6); this.fx('laststand'); }
  // the punish window: dodge the big blow, then make it pay
  expose(t = 1.4) { this.exposed = t; this.fx('exposed', { t }); }
  // a phase's opening: the boss bounds to the middle of its arena and lands with a ring the party can jump
  leapToCentre(o) {
    const A = this.arena();
    this.busy = this.leap((A.x0 + A.x1) / 2, (A.z0 + A.z1) / 2, { crouch: 0.5, air: 0.9, h: 6, r: 5, dmg: 1, ...o, onLand: () => { this.wave(2, 10, 18, 0.6, o.el ?? 'physical', 0.05); o.onLand?.(); } }) + 0.8;
  }
  // A lane the boss will tear down (a whirl, a slide): marked at once, it goes off in
  // segments as the boss passes, so the danger travels with the body.
  lane(yaw, len, w, start, speed, dmgMult, el, extra = {}) {
    const a = this.a, n = Math.max(2, Math.ceil(len / 3)), seg = len / n;
    for (let i = 0; i < n; i++) {
      const x = a.pos.x + Math.sin(yaw) * seg * i, z = a.pos.z + Math.cos(yaw) * seg * i;
      const t = start + (seg * (i + 0.5)) / speed;
      this.hazard({ shape: 'rect', x, y: this.g.groundY(x, z), z, rot: yaw, len: seg + 0.6, w, delay: t, teleDur: t, dmg: this.dmg * dmgMult, el, kb: 10, ...extra });
    }
  }
  banner(text, sub, color) { this.g.net?.broadcast({ t: 'banner', a: text, b: sub, c: color }); this.g.ui?.banner(text, sub, color); }
  shake(k) { this.g.net?.broadcast({ t: 'shake', k }); this.g.vfx.addShake(k); }
  sound(name, vol = 1) { this.g.net?.broadcast({ t: 'snd', n: name, x: this.a.pos.x, y: this.a.pos.y, z: this.a.pos.z, v: vol }); this.g.audio?.play(name, { pos: this.a.pos, volume: vol }); }
  fx(kind, extra = {}) { this.g.net?.broadcast({ t: 'bfx', k: kind, id: this.a.id, ...extra }); this.g.bossFx(kind, this.a, extra); }

  _dread() {
    const n = 12 + 2 * this.phase, off = Math.random() * Math.PI * 2, step = Math.PI * 2 / n;
    this.fx('dread');
    const ring = (o) => { this._projMv = 'Dread Ring'; this.ring(n, 6.5 + this.phase * 0.6, 'enemyFire', 0.3, o, y()); this._projMv = null; };
    // at chest height above the ground, even from a boss on the wing
    const y = () => 1.0 - (this.a.pos.y - this.g.groundY(this.a.pos.x, this.a.pos.z));
    this.at(0.75, () => ring(off));
    this.at(1.25, () => ring(off + step / 2));
  }

  idleType() { const t = this.script.idleType; return typeof t === 'function' ? t(this) : (t ?? ''); }

  // ------------------------------------------------ main update
  update(dt, mm, am) {
    const a = this.a;
    const S = this.script;
    this.invuln = Math.max(0, this.invuln - dt);
    this.exposed = Math.max(0, this.exposed - dt);
    // phase transitions
    const phases = S.phases;
    this.fightT = (this.fightT ?? 0) + dt;
    // a phase can also begin after a set time (the Hollow King won't sit forever)
    while (this.phase < phases.length - 1 && (this.hpf <= phases[this.phase + 1].at || (phases[this.phase + 1].after && this.fightT >= phases[this.phase + 1].after))) {
      this.phase++;
      this.events.length = 0;
      this.moveVel = null;
      this.spinT = 0;
      this.busy = 0;
      // visual only: every peer's model plays its phase-change moment (see Game.bossFx)
      this.fx('phase', { n: this.phase });
      this.pressT = phases[this.phase].press?.every ?? 0;
      phases[this.phase].enter?.(this);
    }
    // timed events
    for (let i = this.events.length - 1; i >= 0; i--) {
      const e = this.events[i];
      e.t -= dt * Math.max(0.3, am);
      if (e.t <= 0) { this.events.splice(i, 1); e.fn(); }
    }
    for (const k in this.cds) this.cds[k] -= dt;
    // arena pressure: the last phase sets off telegraphed hazards around the arena whatever the boss is doing
    const press = phases[this.phase].press;
    if (press && !a.hiddenT) {
      this.pressT -= dt * Math.max(0.3, am);
      if (this.pressT <= 0) { this.pressT = press.every; const mv = this.move; this.move = { name: press.name }; press.run(this); this.move = mv; }
    }
    // Nightmare: between (and over) its moves the boss looses dread rings, two
    // staggered rings of slow bolts whose gaps you weave through; faster each phase
    if (this.g.difficulty?.dreadPulse && this.fightT > 4 && !a.hiddenT) {
      this.dreadT = (this.dreadT ?? 5) - dt * Math.max(0.3, am);
      if (this.dreadT <= 0) { this.dreadT = [8, 6.5, 5.2, 4.5][Math.min(this.phase, 3)] / (this.g.difficulty.dreadRate ?? 1); this._dread(); }
    }
    // anim progress
    this.animT += dt * Math.max(0.3, am);
    a.progress = Math.min(1, this.animT / Math.max(0.05, this.animDur));
    a.state = a.anim === 'windup' ? 'windup' : 'chase';
    const out = { x: 0, z: 0 };
    const tgt = this.target;
    if (this.spinT > 0) { this.spinT -= dt; a.yaw += this.spin * dt; }
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
    const nm = (this.g.difficulty?.nightmare || this.g.difficulty?.bossSig) && S.nightmare && this.phase >= (S.nightmare.minPhase ?? 1) ? S.nightmare : null;
    const pool = (nm ? [...phases[this.phase].moves, nm] : phases[this.phase].moves).filter((m) => (this.cds[m.name] ?? 0) <= 0 && (!m.range || (dist >= m.range[0] && dist <= m.range[1])) && (!m.when || m.when(this)));
    if (pool.length) {
      let tot = 0;
      for (const m of pool) tot += m.w ?? 1;
      let r = Math.random() * tot;
      let pick = pool[0];
      for (const m of pool) { r -= m.w ?? 1; if (r <= 0) { pick = m; break; } }
      this.move = pick;
      this.cds[pick.name] = (pick.cd ?? 3) * (this.g.difficulty?.bossCd ?? 1);
      this.face(tgt);
      if (pick === nm && !this.data.nmShown) { this.data.nmShown = true; this.banner(`NIGHTMARE · ${pick.title}`, pick.hint, '#ff5040'); }
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
  // Nightmare: lanes of bile cross the arena twice; stand in a gap, then move
  nightmare: { name: 'lattice', title: 'Bile Lattice', hint: 'Find the gaps, then find them again', w: 2, cd: 11, minPhase: 1, run(B) {
    B.anim('cast', 'spit', 1.4);
    B.sound('boss_roar', 0.7);
    const A = B.arena(), off = Math.random() * 6;
    for (let x = A.x0 + off; x < A.x1; x += 6) B.hazard({ shape: 'rect', x, y: B.a.pos.y, z: A.z0, rot: 0, len: A.z1 - A.z0, w: 2.4, delay: 1.5, teleDur: 1.3, dmg: B.dmg * 0.9, el: 'enemyGreen' });
    for (let z = A.z0 + ((off + 3) % 6); z < A.z1; z += 6) B.hazard({ shape: 'rect', x: A.x0, y: B.a.pos.y, z, rot: Math.PI / 2, len: A.x1 - A.x0, w: 2.4, delay: 2.9, teleDur: 1.2, dmg: B.dmg * 0.9, el: 'enemyGreen' });
    return 2.4;
  } },
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
        // a gout of bile in a cone before her, leaving a pool where it lands
        { name: 'belch', w: 2, cd: 5, range: [0, 11], track: 2, run(B, t) {
          B.anim('windup', 'spit', 0.9);
          const yaw = B.yawTo(t.pos);
          B.hazard({ shape: 'cone', x: B.a.pos.x, y: B.a.pos.y, z: B.a.pos.z, r: 10, rot: yaw, angle: 0.55, delay: 0.95, dmg: B.dmg * 0.9, el: 'enemyGreen', kb: 6 });
          B.at(0.9, () => {
            B.anim('attack', 'spit', 0.6);
            B.sound('boss_roar', 0.5);
            const x = B.a.pos.x + Math.sin(yaw) * 6, z = B.a.pos.z + Math.cos(yaw) * 6;
            B.circle(x, z, 2.6, 0.35, 0.3, 'enemyGreen', { pool: [3, 4, B.dmg * 0.3] });
          });
          return 1.7;
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
        // she heaves her bulk into the air and comes down on you
        { name: 'flop', w: 2, cd: 7, range: [5, 40], run(B, t) {
          B.leap(t.pos.x, t.pos.z, { type: 'slam', airAnim: 'windup', crouch: 0.75, air: 0.95, h: 5.5, r: 5, el: 'enemyGreen', dmg: 1.3, kb: 14,
            onLand: () => { B.wave(2.5, 9, 13, 0.55, 'enemyGreen', 0.05); B.circle(B.a.pos.x, B.a.pos.z, 4, 0.1, 0.01, 'enemyGreen', { pool: [4.5, 5, B.dmg * 0.25] }); } });
          return 1.4;
        } },
      ],
    },
    {
      at: 0.33,
      enter(B) { B.banner('ROTTING FURY', 'Toxic tides surge — JUMP the waves!', '#9adf3a'); B.sound('boss_roar'); B.leapToCentre({ type: 'slam', airAnim: 'windup', el: 'enemyGreen' }); },
      // bile geysers burst from the drains, leaving pools
      press: { name: 'Bile Geyser', every: 7, run(B) { for (let i = 0; i < 3; i++) { const p = B.roomRandom(3); B.circle(p.x, p.z, 2.3, 1.4 + i * 0.2, 0.6, 'enemyGreen', { pool: [2.4, 4, B.dmg * 0.25] }); } } },
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
        // rings of bile burst outward from her, each with a gap that wanders
        { name: 'ripple', w: 2, cd: 7, run(B) {
          B.anim('windup', 'slam', 0.8);
          B.at(0.8, () => { B.anim('attack', 'slam', 0.5); B.shake(0.4); B.sound('boss_slam'); });
          const ax = B.a.pos.x, az = B.a.pos.z;
          let gap = Math.random() * Math.PI * 2;
          for (let k = 1; k <= 3; k++) {
            const R = 4.4 * k, n = 4 + 4 * k;
            gap += rand(-0.9, 0.9);
            for (let i = 0; i < n; i++) {
              const ang = (i / n) * Math.PI * 2;
              if (Math.abs(Math.atan2(Math.sin(ang - gap), Math.cos(ang - gap))) < 0.5) continue;
              B.circle(ax + Math.sin(ang) * R, az + Math.cos(ang) * R, 2.0, 0.9 + k * 0.45, 0.7, 'enemyGreen');
            }
          }
          return 2.4;
        } },
        { name: 'submerge', w: 2, cd: 6, run(B) { return SCRIPTS.motherOfFilth.phases[1].moves[0].run(B); } },
        // last stand: the Deluge, three tides in a row
        { name: 'deluge', w: 50, cd: 999, when: (B) => B.hpf < 0.12, run(B) {
          B.lastStand('THE DELUGE', 'Three tides — JUMP them all!', '#9adf3a');
          B.anim('windup', 'slam', 1.0);
          for (let i = 0; i < 3; i++) B.at(1.0 + i * 0.9, () => { B.anim('attack', 'slam', 0.5); B.wave(2, 9 + i, 26, 0.7, 'enemyGreen'); B.shake(0.4); B.sound('boss_slam'); });
          B.at(3.6, () => B.expose(1.8));
          return 3.8;
        } },
      ],
    },
  ],
};

// ---------------- THE EXECUTIONER -----------------------------------------
SCRIPTS.executioner = {
  keepDist: 3,
  // Nightmare: three chops in a row, each one aimed where you are when it begins
  nightmare: { name: 'frenzy', title: "Headsman's Frenzy", hint: 'Three blows — keep moving', w: 2, cd: 8, minPhase: 1, range: [0, 12], track: 5, run(B, t) {
    const chop = (i) => {
      const p = B.target ?? t;
      if (!p) return;
      const yaw = B.yawTo(p.pos);
      B.a.yaw = yaw;
      B.anim('windup', 'slam', 0.75);
      B.circle(p.pos.x, p.pos.z, 3, 0.75, 1.1, i === 2 ? 'enemyFire' : 'physical');
      B.at(0.75, () => { B.anim('attack', 'slam', 0.35); B.shake(0.35); B.sound('boss_slam'); });
    };
    chop(0);
    B.at(0.95, () => chop(1));
    B.at(1.9, () => chop(2));
    return 3.1;
  } },
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
          B.at(1.75, () => B.expose(1.2));
          return 2.0;
        } },
        // a chop, and before you've breathed, the backswing
        { name: 'combo', w: 2, cd: 5, range: [0, 7], track: 3, run(B, t) {
          SCRIPTS.executioner.phases[0].moves[0].run(B, t);
          B.at(1.3, () => {
            const p = B.target ?? t;
            const rot = B.yawTo(p.pos);
            B.a.yaw = rot;
            B.anim('windup', 'sweep', 0.55);
            B.hazard({ shape: 'cone', x: B.a.pos.x, y: B.a.pos.y, z: B.a.pos.z, r: 6.5, rot, angle: 1.3, delay: 0.55, dmg: B.dmg, el: 'physical', kb: 12 });
            B.at(0.55, () => { B.anim('attack', 'sweep', 0.5); B.sound('swing'); });
          });
          return 2.6;
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
        // from across the yard he leaps, axe overhead, and splits the ground where you stood
        { name: 'leap', w: 2, cd: 7, range: [7, 40], run(B, t) {
          B.leap(t.pos.x, t.pos.z, { crouch: 0.7, air: 0.85, h: 5, r: 4.5, el: 'physical', dmg: 1.4, kb: 16,
            onLand: () => B.wave(1.5, 10, 11, 0.6, 'physical', 0.05) });
          return 1.3;
        } },
      ],
    },
    {
      at: 0.33,
      enter(B) { B.banner('BLOODLUST', 'His axe burns — JUMP the shockwaves!', '#ff3020'); B.sound('boss_roar'); B.fx('enrage'); B.leapToCentre({ el: 'enemyFire' }); },
      // the gallows' blades swing down across the yard: two lanes, each through a wizard or a random spot
      press: { name: 'Gallows Blades', every: 8, run(B) {
        const A = B.arena(), ps = B.players();
        for (let i = 0; i < 2; i++) {
          const q = ps[i % Math.max(1, ps.length)]?.pos ?? B.roomRandom(3), rot = Math.random() * Math.PI;
          const L = 34, x = q.x - Math.sin(rot) * L / 2, z = q.z - Math.cos(rot) * L / 2;
          B.hazard({ shape: 'rect', x: clamp(x, A.x0 - 8, A.x1 + 8), y: B.a.pos.y, z: clamp(z, A.z0 - 8, A.z1 + 8), rot, len: L, w: 2, delay: 1.5 + i * 0.5, teleDur: 1.3, dmg: B.dmg * 0.7, el: 'physical', kb: 10 });
        }
        B.sound('swing', 0.6);
      } },
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
        // a whirlwind of burning steel down a marked lane
        { name: 'whirlwind', w: 2, cd: 7, range: [0, 30], run(B, t) {
          const yaw = B.yawTo(t.pos), len = Math.min(18, Math.hypot(t.pos.x - B.a.pos.x, t.pos.z - B.a.pos.z) + 5), speed = 11;
          B.a.yaw = yaw;
          B.anim('windup', 'whirl', 0.8);
          B.sound('boss_roar', 0.7);
          B.lane(yaw, len, 4.2, 0.8, speed, 0.8, 'enemyFire');
          B.at(0.8, () => { B.anim('attack', 'whirl', len / speed + 0.2); B.spin = 15; B.spinT = len / speed; B.dash(yaw, speed, len / speed); B.sound('swing'); });
          B.at(0.8 + len / speed, () => { B.a.yaw = B.target ? B.yawTo(B.target.pos) : yaw; B.shake(0.3); B.expose(1.6); });
          return 1.5;
        } },
        { name: 'charge', w: 1, cd: 5, range: [6, 40], run(B, t) { return SCRIPTS.executioner.phases[0].moves[2].run(B, t); } },
        // last stand: the Final Verdict, four chops each aimed afresh, then the ground burns
        { name: 'verdict', w: 50, cd: 999, when: (B) => B.hpf < 0.12, run(B, t) {
          B.lastStand('THE FINAL VERDICT', 'Four blows — keep moving!', '#ff3020');
          const chop = () => {
            const p = B.target ?? t;
            if (!p) return;
            B.a.yaw = B.yawTo(p.pos);
            B.anim('windup', 'slam', 0.7);
            B.circle(p.pos.x, p.pos.z, 3, 0.7, 1.1, 'enemyFire');
            B.at(0.7, () => { B.anim('attack', 'slam', 0.3); B.shake(0.35); B.sound('boss_slam'); });
          };
          for (let i = 0; i < 4; i++) B.at(0.6 + i * 0.9, chop);
          B.at(4.4, () => { B.wave(1.5, 11, 24, 0.7, 'enemyFire'); B.expose(2); });
          return 5.0;
        } },
      ],
    },
  ],
};

// ---------------- STONE WYVERN (Gravemaw) ---------------------------------
SCRIPTS.stoneWyvern = {
  // Nightmare: rows of boulders sweep across the arena, each row with one gap
  nightmare: { name: 'avalanche', title: 'Avalanche', hint: 'Each row leaves one gap', w: 2, cd: 10, minPhase: 1, run(B, t) {
    B.anim('cast', 'roar', 1.2);
    B.sound('boss_roar', 0.9);
    B.shake(0.4);
    const A = B.arena();
    const alongX = Math.random() < 0.5; // rows run across x, sweeping along z (or the other way)
    const [u0, u1, v0, v1] = alongX ? [A.x0, A.x1, A.z0, A.z1] : [A.z0, A.z1, A.x0, A.x1];
    const rows = 4, step = 3.3;
    let gap = u0 + Math.random() * (u1 - u0);
    for (let i = 0; i < rows; i++) {
      const v = v0 + ((v1 - v0) * (i + 0.5)) / rows;
      gap = Math.max(u0 + 2, Math.min(u1 - 2, gap + (Math.random() - 0.5) * 10)); // the gap wanders, but walkably
      for (let u = u0 + 1; u <= u1 - 1; u += step) {
        if (Math.abs(u - gap) < 2.4) continue;
        const [x, z] = alongX ? [u, v] : [v, u];
        B.circle(x, z, 1.85, 1.3 + i * 0.6, 0.9, 'earth', { boulder: 1 });
      }
    }
    return 2.0;
  } },
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
          B.at(1.7, () => B.expose(1.2));
          return 2.0;
        } },
        { name: 'rocks', w: 2, cd: 6, run(B) {
          B.anim('cast', 'roar', 1.0);
          B.sound('boss_roar', 0.8);
          for (let i = 0; i < 8; i++) { const p = B.roomRandom(2); B.circle(p.x, p.z, 2.6, 1.2 + i * 0.1, 0.9, 'earth', { boulder: 1 }); }
          for (const p of B.players()) B.circle(p.pos.x, p.pos.z, 2.6, 1.3, 0.9, 'earth', { boulder: 1 });
          return 1.8;
        } },
        // it wheels across the yard to a new side, dropping fire along its path
        { name: 'wheel', w: 2, cd: 6, when: (B) => B.data.fly, run(B, t) {
          const A = B.arena(), cx = (A.x0 + A.x1) / 2, cz = (A.z0 + A.z1) / 2;
          // the far side of the target from where it hangs now, 12 m off it
          let ang = Math.atan2(B.a.pos.x - t.pos.x, B.a.pos.z - t.pos.z) + Math.PI + rand(-0.8, 0.8);
          let x = clamp(t.pos.x + Math.sin(ang) * 12, A.x0 + 2, A.x1 - 2), z = clamp(t.pos.z + Math.cos(ang) * 12, A.z0 + 2, A.z1 - 2);
          if (B.g.collision.cellBlocked(Math.floor(x / 2), Math.floor(z / 2), B.a.pos.y + 0.5)) { x = cx; z = cz; }
          const yaw = Math.atan2(x - B.a.pos.x, z - B.a.pos.z), d = Math.hypot(x - B.a.pos.x, z - B.a.pos.z), T = 1.3;
          B.a.yaw = yaw;
          B.anim('windup', 'fly', 0.5);
          B.sound('boss_roar', 0.5);
          const n = 5;
          for (let i = 1; i <= n; i++) {
            const k = i / (n + 1), px = B.a.pos.x + (x - B.a.pos.x) * k, pz = B.a.pos.z + (z - B.a.pos.z) * k;
            B.circle(px, pz, 2.3, 0.5 + T * k + 0.35, 0.7, 'enemyFire', { meteor: 1 });
          }
          B.at(0.5, () => { B.anim('attack', 'fly', T); B.dash(yaw, d / T, T); });
          B.at(0.5 + T, () => { const p = B.target; if (p) B.face(p); });
          return 1.0;
        } },
        // a beat of its great wings: a gale that throws you back across the yard
        { name: 'gust', w: 2, cd: 6, range: [0, 14], track: 2, run(B, t) {
          B.anim('windup', 'roar', 0.9);
          const yaw = B.yawTo(t.pos);
          B.hazard({ shape: 'cone', x: B.a.pos.x, y: B.a.pos.y, z: B.a.pos.z, r: 13, rot: yaw, angle: 0.8, delay: 0.9, dmg: B.dmg * 0.45, el: 'physical', kb: 26 });
          B.at(0.9, () => {
            B.anim('attack', 'fly', 0.7); B.sound('boss_roar', 0.6); B.shake(0.3);
            for (let i = 0; i < 6; i++) { const yy = yaw + (i / 5 - 0.5) * 1.4; B.g.vfx.smoke(new THREE.Vector3(B.a.pos.x + Math.sin(yy) * 4, B.a.pos.y + 0.6, B.a.pos.z + Math.cos(yy) * 4), { count: 3, size: 2, color: [0.4, 0.36, 0.3], alpha: 0.45, speed: 9 }); }
          });
          return 1.7;
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
        // it drives its claws into the stone: a fault runs out toward each of you, bursting as it goes
        { name: 'fault', w: 2, cd: 5, run(B) {
          B.anim('windup', 'slam', 0.7);
          B.at(0.7, () => { B.anim('attack', 'slam', 0.5); B.shake(0.45); B.sound('boss_slam'); });
          for (const p of B.players()) {
            const yaw = B.yawTo(p.pos), n = 11;
            for (let i = 1; i <= n; i++) {
              const x = B.a.pos.x + Math.sin(yaw) * i * 1.9, z = B.a.pos.z + Math.cos(yaw) * i * 1.9;
              B.circle(x, z, 1.5, 0.85 + i * 0.07, 0.8, 'earth', { kb: 8 });
            }
          }
          return 1.6;
        } },
        { name: 'breath', w: 2, cd: 3.5, range: [0, 22], track: 1.2, run(B, t) { return SCRIPTS.stoneWyvern.phases[0].moves[0].run(B, t); } },
      ],
    },
    {
      at: 0.3,
      enter(B) { B.banner('MAGMA HEART', 'Molten fury erupts from its cracks', '#ff6020'); B.sound('boss_roar'); B.fx('enrage'); },
      // the ground splits: magma vents open near each wizard
      press: { name: 'Magma Vent', every: 7, run(B) { for (const p of B.players()) { const ang = Math.random() * Math.PI * 2; B.circle(p.pos.x + Math.sin(ang) * 3, p.pos.z + Math.cos(ang) * 3, 2.4, 1.4, 0.6, 'enemyFire', { pool: [2.4, 4, B.dmg * 0.25] }); } } },
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

        // last stand: its Last Breath sweeps a full circle: run with the fire
        { name: 'lastBreath', w: 50, cd: 999, when: (B) => B.hpf < 0.12, run(B, t) {
          B.lastStand('LAST BREATH', 'The fire turns all the way round — run with it!', '#ff6020');
          B.anim('windup', 'breath', 1.0);
          const base = B.yawTo(t.pos), dir = Math.random() < 0.5 ? 1 : -1, n = 12;
          for (let i = 0; i < n; i++) B.hazard({ shape: 'cone', x: B.a.pos.x, y: B.a.pos.y, z: B.a.pos.z, r: 16, rot: base + dir * i * (Math.PI * 2 / n), angle: 0.3, delay: 1.2 + i * 0.22, teleDur: 0.8 + i * 0.22, dmg: B.dmg * 0.8, el: 'enemyFire', st: { burn: [3, 6] } });
          B.at(1.0, () => { B.anim('attack', 'breath', n * 0.22 + 0.4); B.fx('breath', { yaw: base, sweep: dir * Math.PI * 2, dur: n * 0.22 + 0.2 }); });
          B.at(1.4 + n * 0.22, () => B.expose(1.8));
          return 1.6 + n * 0.22;
        } },
        // broken wings or not, it hurls itself across the arena and lands in a burst of magma
        { name: 'pounce', w: 2, cd: 6, range: [6, 40], run(B, t) {
          B.leap(t.pos.x, t.pos.z, { type: 'slam', airType: 'fly', crouch: 0.6, air: 0.9, h: 6, r: 5.5, el: 'enemyFire', dmg: 1.2, kb: 16,
            onLand: () => { for (let i = 0; i < 5; i++) { const ang = (i / 5) * Math.PI * 2 + Math.random(); B.circle(B.a.pos.x + Math.sin(ang) * 5, B.a.pos.z + Math.cos(ang) * 5, 2, 0.6, 0.6, 'enemyFire', { pool: [2.2, 4, B.dmg * 0.25] }); } } });
          return 1.3;
        } },      ],
    },
  ],
};

// ---------------- COURT ARCHMAGE (Veyrin) ---------------------------------
SCRIPTS.courtArchmage = {
  keepDist: 10,
  // Nightmare: a ring of runes closes on each wizard with one gap, then the centre detonates
  nightmare: { name: 'prison', title: 'Rune Prison', hint: 'Leave through the gap', w: 2, cd: 9, minPhase: 1, run(B) {
    B.anim('cast', 'cast', 1.2);
    B.sound('enemy_cast', 1);
    for (const p of B.players()) {
      const cx = p.pos.x, cz = p.pos.z, gapA = Math.random() * Math.PI * 2;
      for (let i = 0; i < 10; i++) {
        const ang = (i / 10) * Math.PI * 2;
        if (Math.abs(Math.atan2(Math.sin(ang - gapA), Math.cos(ang - gapA))) < 0.4) continue;
        B.circle(cx + Math.cos(ang) * 4.6, cz + Math.sin(ang) * 4.6, 1.5, 1.0, 0.8, 'arcane');
      }
      B.circle(cx, cz, 3.4, 2.0, 1.3, 'enemyPurple');
    }
    return 1.8;
  } },
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
        // slow seeking orbs that burst where they catch you: keep moving, or bait them into a wall
        { name: 'orbs', w: 2, cd: 6, run(B) {
          B.anim('cast', 'summon', 1.0);
          B.at(0.8, () => { for (const p of B.players()) B.aimed(p, 3, 0.9, 6.5, 'enemyPurple', 0.6, { homing: 1.4, aoe: 2.4 }); });
          return 1.4;
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
        // she dances: three blinks around you, a volley from each new place
        { name: 'mirrorDance', w: 2, cd: 7, run(B, t) {
          const step = (i) => {
            const p = B.target ?? t;
            if (!p) return;
            const ang = Math.random() * Math.PI * 2, A = B.arena();
            const x = clamp(p.pos.x + Math.sin(ang) * 9, A.x0 + 1, A.x1 - 1), z = clamp(p.pos.z + Math.cos(ang) * 9, A.z0 + 1, A.z1 - 1);
            if (B.g.collision.cellBlocked(Math.floor(x / 2), Math.floor(z / 2), B.a.pos.y + 0.5)) return;
            B.g.actors.blinkFx(B.a.pos); B.g.net?.broadcast({ t: 'blinkfx', x: B.a.pos.x, y: B.a.pos.y, z: B.a.pos.z });
            B.a.pos.x = x; B.a.pos.z = z; B.a.net.x = x; B.a.net.z = z;
            B.g.actors.blinkFx(B.a.pos); B.g.net?.broadcast({ t: 'blinkfx', x, y: B.a.pos.y, z });
            B.face(p);
            B.anim('cast', 'cast', 0.7);
            B.at(0.45, () => { const q = B.target; if (q) B.aimed(q, 3, 0.22, 19, ['enemyFire', 'arcane', 'frost'][i], 0.45); });
          };
          step(0); B.at(0.85, () => step(1)); B.at(1.7, () => step(2));
          return 2.6;
        } },
      ],
    },
    {
      at: 0.33,
      enter(B) { B.banner('ARCANE CATACLYSM', 'Reality unravels', '#ff60ff'); B.sound('boss_roar'); B.fx('enrage'); },
      // the hall's wards misfire: two beams cross the arena through its middle
      press: { name: 'Ward Surge', every: 8, run(B) {
        const A = B.arena(), cx = (A.x0 + A.x1) / 2, cz = (A.z0 + A.z1) / 2, base = Math.random() * Math.PI;
        for (let i = 0; i < 2; i++) {
          const rot = base + i * Math.PI / 2, L = 40;
          B.hazard({ shape: 'rect', x: cx - Math.sin(rot) * L / 2, y: B.a.pos.y, z: cz - Math.cos(rot) * L / 2, rot, len: L, w: 2.2, delay: 1.5, teleDur: 1.3, dmg: B.dmg * 0.7, el: 'arcane', beam: 1 });
        }
      } },
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
        // last stand: she unravels, ring upon ring of bolts with gaps to weave through
        { name: 'unravel', w: 50, cd: 999, when: (B) => B.hpf < 0.12, run(B) {
          B.lastStand('UNRAVELLING', 'Ring upon ring — find the gaps!', '#ff60ff');
          B.anim('cast', 'spin', 3.4);
          for (let k = 0; k < 6; k++) {
            B.at(0.8 + k * 0.45, () => {
              const n = 16, gap = Math.floor(Math.random() * n), p = new THREE.Vector3(B.a.pos.x, B.a.pos.y + 1.2, B.a.pos.z);
              B._projMv = 'Unravelling';
              for (let i = 0; i < n; i++) { if (i === gap || i === (gap + 1) % n) continue; const ang = (i / n) * Math.PI * 2 + k * 0.2; B.proj(p, new THREE.Vector3(Math.sin(ang), 0, Math.cos(ang)), 8 + k * 0.6, k % 2 ? 'arcane' : 'enemyPurple', 0.4); }
              B._projMv = null;
              B.sound('enemy_projectile');
            });
          }
          B.at(3.6, () => B.expose(1.8));
          return 4.0;
        } },
        // starfall: a cross of beams, then the cross turned an eighth: stand where the second won't fall
        { name: 'starfall', w: 2, cd: 6, run(B) {
          B.anim('cast', 'beam', 2.0);
          B.sound('enemy_cast', 1);
          const base = Math.random() * Math.PI;
          for (let k = 0; k < 2; k++) for (let i = 0; i < 4; i++) {
            const rot = base + i * (Math.PI / 2) + k * (Math.PI / 4);
            B.hazard({ shape: 'rect', x: B.a.pos.x, y: B.a.pos.y, z: B.a.pos.z, rot, len: 28, w: 2.6, delay: 1.1 + k * 0.85, teleDur: 0.9, dmg: B.dmg, el: k ? 'arcane' : 'enemyPurple', beam: 1 });
          }
          return 2.4;
        } },
        { name: 'blink', w: 1, cd: 4, run(B) { return SCRIPTS.courtArchmage.phases[0].moves[3].run(B); } },
      ],
    },
  ],
};

// ---------------- THE HOLLOW KING ----------------------------------------
SCRIPTS.hollowKing = {
  keepDist: 3.5,
  // Nightmare: stars of blade-lines fall from the throne, each turned from the last
  nightmare: { name: 'swords', title: 'Crown of Swords', hint: 'Step between the blades as they turn', w: 2, cd: 9, minPhase: 0, run(B) {
    B.anim('cast', B.data.seated ? 'seated' : 'roar', 1.4);
    B.sound('boss_roar', 0.7);
    const base = Math.random() * Math.PI * 2;
    for (let k = 0; k < 3; k++) {
      for (let i = 0; i < 6; i++) {
        const rot = base + (i / 6) * Math.PI * 2 + k * (Math.PI / 12);
        B.hazard({ shape: 'rect', x: B.a.pos.x, y: B.a.pos.y, z: B.a.pos.z, rot, len: 26, w: 1.6, delay: 1.1 + k * 0.6, teleDur: 0.9, dmg: B.dmg * 0.8, el: 'enemyPurple', beam: 1 });
      }
    }
    return 2.4;
  } },
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
        // the king's hand: the floor closes under you three times, each a beat behind
        { name: 'grasp', w: 2, cd: 6, run(B) {
          B.anim('cast', 'seated', 1.6);
          B.sound('enemy_cast', 0.9);
          for (let k = 0; k < 3; k++) B.at(k * 0.5, () => { for (const p of B.players()) B.circle(p.pos.x, p.pos.z, 2.4, 0.95, 0.8, 'enemyPurple'); });
          return 2.0;
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
        // he leaps, sword reversed, and drives it into the floor where you were
        { name: 'leap', w: 2, cd: 6, range: [7, 40], run(B, t) {
          B.leap(t.pos.x, t.pos.z, { crouch: 0.6, air: 0.8, h: 5.5, r: 4.8, el: 'enemyPurple', dmg: 1.3, kb: 14,
            onLand: () => B.circle(B.a.pos.x, B.a.pos.z, 4.8, 0.05, 0.01, 'enemyPurple', { pool: [4.5, 4, B.dmg * 0.2] }) });
          return 1.2;
        } },
        // a sweep and, as you step back, the thrust
        { name: 'riposte', w: 2, cd: 5, range: [0, 7], run(B, t) {
          SCRIPTS.hollowKing.phases[1].moves[0].run(B, t);
          B.at(1.2, () => { const p = B.target ?? t; if (p) SCRIPTS.hollowKing.phases[1].moves[1].run(B, p); });
          return 2.7;
        } },
      ],
    },
    {
      at: 0.33,
      enter(B) {
        B.banner('ECLIPSE', 'The last light dies — hide behind the pillars!', '#ff40ff');
        B.sound('boss_roar'); B.shake(0.8);
        B.fx('eclipse');
        B.leapToCentre({ el: 'enemyPurple' });
      },
      // rifts of void open in the dark
      press: { name: 'Void Rift', every: 9, run(B) { for (let i = 0; i < 3; i++) { const p = B.roomRandom(3); B.circle(p.x, p.z, 2.6, 1.4 + i * 0.25, 0.65, 'enemyPurple'); } } },
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
        // he steps into shadow and out of it behind you, blade already moving
        { name: 'shadowStep', w: 2, cd: 6, run(B, t) {
          B.anim('cast', 'roar', 0.5);
          B.at(0.45, () => {
            const p = B.target ?? t;
            if (!p) return;
            const back = p.yaw ?? 0; // behind the wizard: they face -sin(yaw), -cos(yaw)
            let x = p.pos.x + Math.sin(back) * 3.2, z = p.pos.z + Math.cos(back) * 3.2;
            const A = B.arena();
            x = clamp(x, A.x0 + 1, A.x1 - 1); z = clamp(z, A.z0 + 1, A.z1 - 1);
            if (B.g.collision.cellBlocked(Math.floor(x / 2), Math.floor(z / 2), B.a.pos.y + 0.5)) return;
            B.g.actors.blinkFx(B.a.pos); B.g.net?.broadcast({ t: 'blinkfx', x: B.a.pos.x, y: B.a.pos.y, z: B.a.pos.z });
            B.a.pos.x = x; B.a.pos.z = z; B.a.net.x = x; B.a.net.z = z;
            B.g.actors.blinkFx(B.a.pos); B.g.net?.broadcast({ t: 'blinkfx', x, y: B.a.pos.y, z });
            B.face(p);
            B.anim('windup', 'sweep', 0.75);
            B.hazard({ shape: 'cone', x, y: B.a.pos.y, z, r: 7, rot: B.yawTo(p.pos), angle: 1.4, delay: 0.75, dmg: B.dmg * 1.1, el: 'enemyPurple', kb: 14 });
            B.at(0.75, () => { B.anim('attack', 'sweep', 0.5); B.sound('swing'); B.shake(0.25); });
          });
          return 2.0;
        } },
      ],
    },
  ],
};

export { SCRIPTS, SPR };
