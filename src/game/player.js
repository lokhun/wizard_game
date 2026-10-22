import * as THREE from 'three';
import { CLASSES, SLOTS } from './classes.js';
import { CLASS_META } from './classMeta.js';
import { makeCtx } from './caster.js';
import { clamp, damp } from '../core/math.js';
import { SPR } from '../render/particles.js';
import { fxOf } from '../render/vfx.js';
import { rand } from '../core/rng.js';
import { K_WATER, WATER_Y } from '../world/levelgen.js';
import { applyRelicSets } from './relicDefs.js';

const WADE_C = [0.16, 0.22, 0.22]; // ripple rings on channel water

// ---------------------------------------------------------------------------
// The local player: first-person movement, camera, casting, health, buffs.
// ---------------------------------------------------------------------------

const EYE = 1.62;
const RADIUS = 0.38;
const GRAVITY = 24;

export function baseStats(classId) {
  const C = CLASSES[classId];
  return {
    maxHp: C.hp, moveSpeed: 6.0 * C.speed, dmgMult: 1, critChance: 0.05, critMult: 1.75, cdr: 0, rateMult: 0,
    aoeMult: 1, projSpeed: 1, extraProj: 0, pierce: 0, bounce: 0, homing: 0, lifesteal: 0, armor: 0,
    dashCharges: 2, dashCd: 3.0, ultRate: 1, elementMult: {}, vs: {}, infuse: null, regen: 0, killHeal: 0,
    goldMult: 1, extraLives: 0, thorns: 0, dodge: 0, cdRate: 1, statusPower: 1, jumpPower: 1,
    ...structuredClone(C.stats ?? {}),
  };
}

export class LocalPlayer {
  constructor(game, { id, name, classId }) {
    this.game = game;
    this.id = id;
    this.name = name;
    this.classId = classId;
    this.cls = CLASSES[classId];
    this.meta = CLASS_META[classId];
    this.upgrades = []; // {def, rarity, mult}
    this.relics = [];
    this.buffs = [];
    this.stats = baseStats(classId);
    this.maxHp = this.stats.maxHp;
    this.hp = this.maxHp;
    this.shield = 0; this.shieldT = 0;
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.yaw = 0; this.pitch = 0;
    this.grounded = false;
    this.wasGrounded = true;
    this.jumpsLeft = 1;
    this.dashCharges = this.stats.dashCharges;
    this.dashRecharge = 0;
    this.dashT = 0; this.dashVel = new THREE.Vector3();
    this.invuln = 0;
    this.glide = 0;
    this.cds = {}; this.chargesLeft = {};
    for (const s of SLOTS) {
      this.cds[s] = 0;
      const sp = this.cls.spells[s];
      this.chargesLeft[s] = sp.charges ?? 1;
    }
    this.ult = 0;
    this.rateTimer = 0;
    this.channel = null; // {slot, S, ctx, t}
    this.castAnim = null; // for viewmodel
    this.alive = true;
    this.downed = false;
    this.dead = false;
    this.downT = 0;
    this.reviveProgress = 0;
    this.selfRevives = 1;
    this.downsThisRoom = 0;
    this.parryT = 0;
    this.edge = 0; // spellblade charges
    this.staticDist = 0; this.staticReady = false;
    this.history = [];
    this.histT = 0;
    this.stepDist = 0;
    this.gold = 0;
    this.essence = 0;
    this.hurtPulse = 0;
    this.lookDelta = { x: 0, y: 0 };
    this.bob = 0;
    this.landDip = 0;
    this.downK = 0; this.downV = 0; // eased slump when downed (spring, so it lands with a thud)
    this.leanK = 0;
    this.kills = 0;
    this.damageDealt = 0;
    this.hasteT = 0;
    this.counters = {};
    this.inWater = false;
    this.lastDamageT = 0;
  }

  get eye() { return new THREE.Vector3(this.pos.x, this.pos.y + EYE - this.landDip * 0.15 - this.downK * 1.0, this.pos.z); }

  spawnAt(x, z, yaw = 0) {
    this.history.length = 0;
    this.pos.set(x, this.game.groundY(x, z), z);
    this.vel.set(0, 0, 0);
    this.yaw = yaw;
    this.pitch = 0;
  }

  // --------------------------------------------------------------- stats
  recomputeStats() {
    const s = baseStats(this.classId);
    for (const u of this.upgrades) u.def.apply(s, u.mult, this);
    for (const r of this.relics) r.def.apply?.(s, this);
    applyRelicSets(s, this);
    for (const b of this.buffs) {
      for (const k in b.mods) {
        if (k === 'cdRate') s.cdRate += b.mods[k];
        else s[k] = (s[k] ?? 0) + b.mods[k];
      }
    }
    if (this.hasteT > 0) { s.moveSpeed *= 1.2; s.cdRate += 0.2; }
    if (s.frenzy && this.hp / this.maxHp < 0.4) s.dmgMult += s.frenzy;
    if (s.airDmg && !this.grounded) s.dmgMult += s.airDmg;
    s.armor = Math.min(0.8, s.armor);
    s.cdr = Math.min(0.6, s.cdr);
    const oldMax = this.maxHp;
    this.maxHp = Math.round(s.maxHp);
    if (this.maxHp > oldMax) this.hp += this.maxHp - oldMax;
    this.hp = Math.min(this.hp, this.maxHp);
    if (this.dashCharges > s.dashCharges) this.dashCharges = s.dashCharges;
    this.stats = s;
  }

  addBuff(id, dur, mods) {
    const existing = this.buffs.find((b) => b.id === id);
    if (existing) { existing.t = dur; existing.mods = mods; }
    else this.buffs.push({ id, t: dur, dur, mods });
    this.recomputeStats();
  }

  // --------------------------------------------------------------- health
  takeDamage(amount, el = 'physical', fromPos = null, opts = {}) {
    if (!this.alive || this.downed || this.dead) return 0;
    const g = this.game;
    if (this.invuln > 0 || g.godMode) return 0;
    if (this.parryT > 0) { this._parrySuccess(fromPos); return 0; }
    if (this.stats.dodge && Math.random() < this.stats.dodge) {
      g.ui?.floatText(this.eye.clone().add(new THREE.Vector3(0, 0.3, 0)), 'DODGE', '#ccc');
      return 0;
    }
    let dmg = amount * (1 - this.stats.armor) * (g.difficulty?.playerDamage ?? 1);
    if (this.shield > 0) {
      const absorbed = Math.min(this.shield, dmg);
      this.shield -= absorbed;
      dmg -= absorbed;
      g.vfx.shell(this.eye, { element: 'holy', radius: 1.2, life: 0.25, alpha: 0.6 });
    }
    dmg = Math.round(dmg);
    if (dmg <= 0) return 0;
    this.hp -= dmg;
    this.lastDamageT = g.time;
    this.hurtPulse = Math.min(1, this.hurtPulse + 0.35 + dmg / this.maxHp);
    g.vfx.addShake(Math.min(0.5, 0.15 + dmg / this.maxHp));
    g.audio?.play('hurt', { volume: 0.8 });
    g.ui?.damageDirection(fromPos, this);
    g.events?.emit('hurt', dmg, el, opts, fromPos);
    if (this.stats.thorns && opts.attacker) g.hitActor(opts.attacker, { dmg: this.stats.thorns, el: 'physical', src: this.id }, opts.attacker.pos);
    g.relics?.onHurt(dmg);
    if (this.hp <= 0) this._goDown();
    this.recomputeStats();
    return dmg;
  }

  heal(n, silent = false) {
    if (this.downed || this.dead || n <= 0) return;
    const before = this.hp;
    this.hp = Math.min(this.maxHp, this.hp + n);
    const healed = this.hp - before;
    if (healed >= 1 && !silent) this.game.ui?.healFlash(healed);
    if (healed > 0 && this.stats.frenzy) this.recomputeStats();
  }

  addShield(amount, dur) {
    this.shield = Math.max(this.shield, amount);
    this.shieldT = dur;
  }

  payHp(n) {
    this.hp = Math.max(1, this.hp - n);
    this.recomputeStats();
  }

  _goDown() {
    const g = this.game;
    if ((this.stats.extraLives ?? 0) > (this.livesUsed ?? 0) || this.relicLives > 0) {
      if (this.relicLives > 0) this.relicLives--; else this.livesUsed = (this.livesUsed ?? 0) + 1;
      this.hp = Math.round(this.maxHp * 0.5);
      this.invuln = 2;
      g.vfx.explosion(this.eye, 'fire', 5);
      g.ui?.banner('PHOENIX REBIRTH', 'You rise from the ashes', '#ff9040');
      g.audio?.play('revive');
      g.localAreaHit?.(this.pos, 6, 80, 'fire');
      return;
    }
    if (g.isSolo && this.selfRevives > 0) {
      this.selfRevives--;
      this.hp = Math.round(this.maxHp * 0.4);
      this.invuln = 2.5;
      g.vfx.explosion(this.eye, 'holy', 6);
      g.ui?.banner('SECOND WIND', 'Death refuses you... once.', '#ffd860');
      g.audio?.play('revive');
      g.localAreaHit?.(this.pos, 7, 50, 'holy', { stun: 2 });
      return;
    }
    this.hp = 0;
    this.downed = true;
    // in a party each fall bleeds out sooner than the last one in the same
    // chamber (20 s, 10 s, 6.7 s...): a revive buys time, not immunity
    this.downT = g.isSolo ? 25 : Math.max(6, 20 / (1 + this.downsThisRoom));
    this.downsThisRoom++;
    this.reviveProgress = 0;
    this.endChannel();
    g.audio?.play('downed');
    g.onLocalDowned?.();
  }

  revive(frac = 0.4) {
    if (!this.downed && !this.dead) return;
    this.downed = false;
    this.dead = false;
    this.hp = Math.round(this.maxHp * frac);
    this.invuln = 2;
    this.game.vfx.explosion(this.eye, 'holy', 3);
    this.game.audio?.play('revive');
    this.game.ui?.banner('REVIVED', '', '#ffd860');
  }

  _parrySuccess(fromPos) {
    const g = this.game;
    g.audio?.play('impact_blade');
    g.audio?.play('crit');
    // the clash sits out between you and the blow, not on the lens
    g.vfx.impact(this.eye.clone().add(this.forward().multiplyScalar(1.6)), 'blade', 1.1);
    this.addCharge(2, 5);
    this.parries = (this.parries ?? 0) + 1; // read by the Riposte augment
    this.parryT = Math.max(this.parryT, 0.15);
    void fromPos;
  }

  // reflect enemy projectiles while parrying
  tryParry(p) {
    if (this.parryT <= 0) return false;
    const g = this.game;
    this._parrySuccess(p.pos);
    // send it back as a player projectile
    const d = this.forward();
    g.spells.spawn({ local: true, faction: 'player', owner: this.id, el: 'blade', pos: p.pos.clone(), vel: d.multiplyScalar(40), radius: 0.3, life: 2, core: 0.7, light: 6,
      hit: { dmg: (p.hit?.dmg ?? 10) * 2.5, el: 'blade', kb: 6 } });
    return true;
  }

  // --------------------------------------------------------------- movement helpers
  forward() {
    const cp = Math.cos(this.pitch);
    return new THREE.Vector3(-Math.sin(this.yaw) * cp, Math.sin(this.pitch), -Math.cos(this.yaw) * cp);
  }
  flatForward() { return new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw)); }

  dash(dir, dist, dur, opts = {}) {
    this.dashT = dur;
    this.dashVel.copy(dir).setY(0).normalize().multiplyScalar(dist / dur);
    this.invuln = Math.max(this.invuln, opts.invuln ?? 0.2);
    this.game.vfx.addFovKick(6);
    if (this.game.player === this) this.game.dashFx = 1;
  }

  blink(dir, dist) {
    const g = this.game;
    const d = new THREE.Vector3(dir.x, 0, dir.z).normalize();
    // walk the path in small steps so we stop at walls
    let x = this.pos.x, z = this.pos.z;
    const steps = Math.ceil(dist / 0.25);
    for (let i = 0; i < steps; i++) {
      const r = g.collision.move(x, z, this.pos.y, d.x * dist / steps, d.z * dist / steps, RADIUS);
      x = r.x; z = r.z;
      if (r.hit) break;
    }
    this.pos.x = x; this.pos.z = z;
    this.pos.y = Math.max(this.pos.y, g.groundY(x, z));
    this.invuln = Math.max(this.invuln, 0.25);
    g.vfx.addFovKick(10);
    if (g.player === this) g.dashFx = 1.3;
    return this.pos.clone();
  }

  launch(vy, glide) {
    this.vel.y = vy;
    this.grounded = false;
    this.glide = glide;
  }

  rewind(sec) {
    const target = this.game.time - sec;
    let best = this.history[0];
    for (const h of this.history) if (Math.abs(h.t - target) < Math.abs(best.t - target)) best = h;
    if (!best) return null;
    this.pos.set(best.x, best.y, best.z);
    this.vel.set(0, 0, 0);
    if (best.hp > this.hp) this.hp = Math.min(this.maxHp, best.hp);
    this.invuln = 0.5;
    this.game.vfx.addFovKick(-10);
    this.game.screenTint([0.7, 1.1, 1.05], 0.5);
    return this.pos.clone();
  }

  startParry(dur) { this.parryT = dur; }
  addCharge(n, max) { this.edge = Math.min(max, this.edge + n); }
  useCharges() { const n = this.edge; this.edge = 0; return n; }
  consumeStatic() { if (this.staticReady) { this.staticReady = false; this.staticDist = 0; return true; } return false; }

  // --------------------------------------------------------------- casting
  muzzleWorld(hand = 'right') {
    const g = this.game;
    const vm = g.viewmodel;
    const obj = vm ? (hand === 'left' ? vm.offhand : vm.muzzle) : null;
    const local = new THREE.Vector3(hand === 'left' ? -0.25 : 0.25, -0.2, -0.6);
    if (obj) {
      obj.updateWorldMatrix(true, false);
      obj.getWorldPosition(local); // in view-camera space (view camera sits at origin)
    }
    // keep spell origin close to the camera line so projectiles converge
    local.x *= 0.8; local.y = Math.max(local.y, -0.3);
    return g.renderer.camera.localToWorld(local);
  }

  aimInfo() {
    const g = this.game;
    const eye = g.renderer.camera.position.clone();
    const dir = this.forward();
    const { hits, wall } = g.spells.rayActors(eye, dir, 60, 0.15);
    const t = hits.length ? hits[0].t : wall;
    return { eye, dir, point: eye.clone().addScaledVector(dir, Math.max(1, t)), actor: hits[0]?.actor ?? null };
  }

  canCast() { return this.alive && !this.downed && !this.dead && !this.game.paused && !this.game.ui?.modalOpen && !this.game.cinematic; }

  tryCast(slot) {
    const sp = this.cls.spells[slot];
    if (!this.canCast()) return false;
    if (slot === 'ultimate') {
      if (this.ult < 100) return false;
    } else if (this.chargesLeft[slot] <= 0) {
      return false;
    }
    if (this.channel) return false;
    const aim = this.aimInfo();
    const hand = sp.hand === 'left' ? 'left' : 'right';
    const origin = this.muzzleWorld(hand);
    const dir = aim.point.clone().sub(origin).normalize();
    const ctx = makeCtx(this.game, this, { local: true, slot, origin, dir, aimPoint: aim.point, stats: this.stats });
    // consume resources
    if (slot === 'ultimate') this.ult = 0;
    else {
      this.chargesLeft[slot]--;
      if (this.cds[slot] <= 0) this.cds[slot] = this._cdOf(slot);
      if (this.stats.echo && slot !== 'primary' && Math.random() < this.stats.echo) {
        this.chargesLeft[slot]++;
        this.game.ui?.floatText(this.eye.add(this.forward().multiplyScalar(2)), 'ECHO', '#c080ff');
      }
    }
    this.castAnim = { slot, hand: sp.hand ?? 'right', t: 0, style: sp.style ?? 'flick' };
    this.game.castFlourish?.(this, slot);
    if (sp.mode === 'channel') {
      const S = {};
      this.channel = { slot, S, ctx, t: 0, max: sp.channel.max ?? 3 };
      sp.channel.start(ctx, S);
      this.game.net?.sendCast({ pid: this.id, slot, o: origin, d: dir, ap: aim.point, chan: 1, au: this.stats.augSlot?.[slot] });
    } else {
      const edgeBefore = this.edge;
      sp.cast(ctx);
      this.game.net?.sendCast({ pid: this.id, slot, o: origin, d: dir, ap: aim.point, ch: edgeBefore, au: this.stats.augSlot?.[slot] });
    }
    this.game.onLocalCast?.(slot);
    return true;
  }

  _cdOf(slot) {
    const sp = this.cls.spells[slot];
    return (sp.cd ?? 0) * (1 - this.stats.cdr);
  }

  endChannel() {
    if (!this.channel) return;
    const sp = this.cls.spells[this.channel.slot];
    sp.channel.end(this.channel.ctx, this.channel.S);
    // cooldown scales with how long the channel was held
    const used = Math.min(1, this.channel.t / this.channel.max);
    this.cds[this.channel.slot] = Math.max(0.5, this._cdOf(this.channel.slot) * (0.35 + 0.65 * used));
    this.game.net?.sendCast({ pid: this.id, slot: this.channel.slot, chan: 0 });
    this.channel = null;
    this.castAnim = null;
  }

  // --------------------------------------------------------------- update
  update(dt, input) {
    const g = this.game;
    const st = this.stats;
    // look
    if (input.locked && !g.ui?.modalOpen) {
      const sens = input.sensitivity * (g.settings?.sensitivity ?? 1);
      this.yaw -= input.mouse.dx * sens;
      this.pitch -= input.mouse.dy * sens * (input.invertY ? -1 : 1);
      this.pitch = clamp(this.pitch, -1.52, 1.52);
      this.lookDelta.x = input.mouse.dx; this.lookDelta.y = input.mouse.dy;
    } else { this.lookDelta.x = 0; this.lookDelta.y = 0; }

    // timers
    this.invuln = Math.max(0, this.invuln - dt);
    this.parryT = Math.max(0, this.parryT - dt);
    this.hurtPulse = Math.max(0, this.hurtPulse - dt * 1.5);
    this.landDip = Math.max(0, this.landDip - dt * 4);
    // collapse to the floor (slightly underdamped: it bottoms out, then settles); rise smoothly
    {
      const target = this.downed ? 1 : 0;
      const k = this.downed ? 90 : 40, c = this.downed ? 11 : 13;
      this.downV += (k * (target - this.downK) - c * this.downV) * dt;
      this.downK = clamp(this.downK + this.downV * dt, -0.1, 1.08);
    }
    if (this.shieldT > 0) { this.shieldT -= dt; if (this.shieldT <= 0) this.shield = 0; }
    if (this.hasteT > 0) { this.hasteT -= dt; if (this.hasteT <= 0) this.recomputeStats(); }
    let buffsChanged = false;
    for (let i = this.buffs.length - 1; i >= 0; i--) {
      this.buffs[i].t -= dt;
      if (this.buffs[i].t <= 0) { this.buffs.splice(i, 1); buffsChanged = true; }
    }
    if (buffsChanged) this.recomputeStats();
    // cooldowns
    const cdRate = st.cdRate;
    for (const s of SLOTS) {
      if (s === 'ultimate') continue;
      const sp = this.cls.spells[s];
      const maxCh = sp.charges ?? 1;
      if (this.chargesLeft[s] < maxCh) {
        this.cds[s] -= dt * cdRate;
        if (this.cds[s] <= 0) {
          this.chargesLeft[s]++;
          if (sp.cd && s !== 'primary') g.audio?.play('cooldown_ready', { volume: 0.25 });
          this.cds[s] = this.chargesLeft[s] < maxCh ? this._cdOf(s) : 0;
        }
      }
    }
    // passive ult charge trickle
    if (this.ult < 100) this.ult = Math.min(100, this.ult + dt * 0.4 * st.ultRate);
    // regen
    const regen = st.regen + (g.auraRegenFor?.(this) ?? 0);
    if (regen > 0 && this.alive && !this.downed && this.hp < this.maxHp) this.heal(regen * dt, true);

    // history for rewind
    this.histT += dt;
    if (this.histT > 0.1) {
      this.histT = 0;
      this.history.push({ t: g.time, x: this.pos.x, y: this.pos.y, z: this.pos.z, hp: this.hp });
      while (this.history.length > 50) this.history.shift();
    }

    if (this.downed) { this._updateDowned(dt, input); return; }
    if (this.dead) return;
    if (this.stunT > 0) {
      this.stunT -= dt;
      this.vel.x *= 0.8; this.vel.z *= 0.8;
      this._move(dt, { is: () => false, was: () => false, mouse: input.mouse, locked: false });
      if (this.channel) this.endChannel();
      return;
    }

    this._move(dt, input);
    this._casting(dt, input);
  }

  _updateDowned(dt, input) {
    const g = this.game;
    this.downT -= dt;
    // crawl
    const f = this.flatForward();
    const r = new THREE.Vector3(-f.z, 0, f.x);
    const wish = new THREE.Vector3();
    if (input.is('forward')) wish.add(f);
    if (input.is('back')) wish.sub(f);
    if (input.is('right')) wish.add(r);
    if (input.is('left')) wish.sub(r);
    if (wish.lengthSq() > 0) wish.normalize().multiplyScalar(1.1 * dt);
    const res = g.collision.move(this.pos.x, this.pos.z, this.pos.y, wish.x, wish.z, RADIUS);
    this.pos.x = res.x; this.pos.z = res.z;
    this.pos.y = g.groundY(this.pos.x, this.pos.z);
    if (this.downT <= 0) {
      this.downed = false;
      this.dead = true;
      g.onLocalDied?.();
    }
  }

  _move(dt, input) {
    const g = this.game;
    const st = this.stats;
    const f = this.flatForward();
    const r = new THREE.Vector3(-f.z, 0, f.x);
    const wish = new THREE.Vector3();
    const allowMove = !g.ui?.modalOpen;
    if (allowMove) {
      if (input.is('forward')) wish.add(f);
      if (input.is('back')) wish.sub(f);
      if (input.is('right')) wish.add(r);
      if (input.is('left')) wish.sub(r);
    }
    if (wish.lengthSq() > 0) wish.normalize();
    const ci = g.level.idx(Math.floor(this.pos.x / 2), Math.floor(this.pos.z / 2));
    this.inWater = g.level.kind[ci] === K_WATER && this.pos.y < 0;
    let speed = st.moveSpeed * (this.inWater ? 0.72 : 1) * (this.channel ? 0.6 : 1);
    if (this.castAnim?.style === 'swing') speed *= 0.85;
    const accel = this.grounded ? 48 : 16; // a little weight: ~0.12 s to full speed
    const target = wish.multiplyScalar(speed);
    // accelerate horizontal velocity toward target
    const dvx = target.x - this.vel.x, dvz = target.z - this.vel.z;
    const dl = Math.hypot(dvx, dvz);
    const maxDv = accel * dt;
    if (dl > maxDv) { this.vel.x += dvx / dl * maxDv; this.vel.z += dvz / dl * maxDv; }
    else { this.vel.x = target.x; this.vel.z = target.z; }

    // dash input
    this.dashRecharge -= dt;
    if (this.dashCharges < st.dashCharges && this.dashRecharge <= 0) {
      this.dashCharges++;
      this.dashRecharge = st.dashCd * (this.game.difficulty?.dashCd ?? 1);
    }
    if (allowMove && input.was('dash') && this.dashCharges > 0 && this.dashT <= 0) {
      const dir = wish.lengthSq() > 0.01 ? target.clone().normalize() : f.clone();
      this.dash(dir, 6.5, 0.18, { invuln: 0.22 });
      this.dashCharges--;
      if (this.dashRecharge <= 0) this.dashRecharge = st.dashCd * (this.game.difficulty?.dashCd ?? 1); // (Leaden Steps)
      g.audio?.play('dash', { volume: 0.7 });
      const fx = fxOf(this.meta.element);
      const p = this.pos;
      for (let i = 0; i < 18; i++) g.vfx.P.glow({ x: p.x + rand(-0.4, 0.4), y: p.y + rand(0.2, 1.6), z: p.z + rand(-0.4, 0.4), vx: -dir.x * 6, vy: 0, vz: -dir.z * 6, r: fx.mid[0], g: fx.mid[1], b: fx.mid[2], life: 0.3, size: 0.1, stretch: 0.05, sprite: SPR.SPARK, drag: 4 });
      g.onLocalDash?.();
    }
    let vx = this.vel.x, vz = this.vel.z;
    if (this.dashT > 0) {
      this.dashT -= dt;
      vx = this.dashVel.x; vz = this.dashVel.z;
      this.vel.y = Math.max(this.vel.y, 0);
    }

    // jump
    if (this.grounded) this.jumpsLeft = st.doubleJump ? 2 : 1;
    // a jump pressed just before landing still happens on touchdown
    this.jumpBuf = allowMove && input.was('jump') ? 0.15 : Math.max(0, (this.jumpBuf ?? 0) - dt);
    if (this.jumpBuf > 0 && this.jumpsLeft > 0) {
      this.jumpBuf = 0;
      this.vel.y = 7.6 * st.jumpPower;
      this.grounded = false;
      this.jumpsLeft--;
      g.audio?.play('jump', { volume: 0.4 });
      if (!this.wasGrounded && st.doubleJump) g.vfx.ring(this.pos, 1.5, fxOf('wind').core, 0.3, 0.3);
    }
    // gravity / glide
    if (!this.grounded) {
      this.vel.y -= GRAVITY * dt;
      if (this.glide > 0) { this.glide -= dt; if (this.vel.y < -2.5) this.vel.y = -2.5; }
    }
    // horizontal collision
    const res = g.collision.move(this.pos.x, this.pos.z, this.pos.y, vx * dt, vz * dt, RADIUS);
    let moved = Math.hypot(res.x - this.pos.x, res.z - this.pos.z);
    this.pos.x = res.x; this.pos.z = res.z;
    // big bodies (bosses, brutes) are solid: walking into one put the camera
    // inside its mesh. Dashes still cut through.
    if (this.dashT <= 0) {
      for (const a of g.actors.hostiles()) {
        if (!(a.boss || a.radius >= 0.9)) continue;
        const dx = this.pos.x - a.pos.x, dz = this.pos.z - a.pos.z, rr = a.radius + 0.55, d2 = dx * dx + dz * dz;
        if (d2 >= rr * rr || this.pos.y > a.pos.y + a.height || this.pos.y + 1.7 < a.pos.y) continue;
        const d = Math.sqrt(d2), nx = d > 1e-3 ? dx / d : Math.sin(this.yaw), nz = d > 1e-3 ? dz / d : Math.cos(this.yaw);
        const r2 = g.collision.move(this.pos.x, this.pos.z, this.pos.y, nx * (rr - d), nz * (rr - d), RADIUS);
        moved = Math.max(0, moved - Math.hypot(r2.x - this.pos.x, r2.z - this.pos.z));
        this.pos.x = r2.x; this.pos.z = r2.z;
      }
    }
    // vertical
    this.pos.y += this.vel.y * dt;
    const ground = g.groundY(this.pos.x, this.pos.z);
    const ceil = g.level.ceilAt(this.pos.x, this.pos.z);
    if (this.pos.y + 1.85 > ceil && this.vel.y > 0) { this.vel.y = 0; this.pos.y = ceil - 1.85; }
    this.wasGrounded = this.grounded;
    if (this.pos.y <= ground + 0.001) {
      if (!this.grounded && this.vel.y < -6) {
        this.landDip = Math.min(1, -this.vel.y / 14);
        g.audio?.play('land', { volume: 0.5 });
      }
      this.pos.y = ground;
      this.vel.y = 0;
      this.grounded = true;
      this.glide = 0;
    } else if (this.pos.y > ground + 0.05 && this.grounded) {
      // walked off a ledge (or stepping down into water)
      if (this.pos.y - ground < 0.8) { this.pos.y = Math.max(ground, this.pos.y - 9 * dt); if (this.pos.y <= ground + 0.01) this.pos.y = ground; }
      else this.grounded = false;
    }
    // footsteps
    if (this.grounded && moved > 0.001) {
      this.stepDist += moved;
      this.bob += moved * 2.2;
      if (this.stepDist > 2.3) {
        this.stepDist = 0;
        const surf = this.inWater ? 'footstep_water' : g.footstepSurface(this.pos);
        g.audio?.play(surf, { volume: 0.35 });
        if (this.inWater) {
          g.vfx.burst(new THREE.Vector3(this.pos.x, -0.25, this.pos.z), { count: 6, speed: 2, upward: 1, gravity: 9, life: 0.4, size: 0.05, sprite: SPR.DROP, color: [0.5, 0.6, 0.6], solid: true });
          g.vfx.ring({ x: this.pos.x, y: WATER_Y - 0.05, z: this.pos.z }, 0.75, WADE_C, 1.1, 0.07);
        }
      }
      if (this.stats.chainBonus !== undefined) {
        this.staticDist += moved;
        if (this.staticDist > 6 && !this.staticReady) { this.staticReady = true; g.audio?.play('cooldown_ready', { volume: 0.3 }); }
      }
    }
    this.speedNorm = Math.min(1, Math.hypot(vx, vz) / Math.max(1, st.moveSpeed));
  }

  _casting(dt, input) {
    const g = this.game;
    if (this.castAnim) {
      this.castAnim.t += dt;
      if (!this.channel && this.castAnim.t > 0.6) this.castAnim = null;
    }
    // channels
    if (this.channel) {
      const ch = this.channel;
      ch.t += dt;
      const held = ch.slot === 'secondary' ? input.mouse.right : ch.slot === 'primary' ? input.mouse.left : input.is(ch.slot);
      if (!held || ch.t >= ch.max || !this.canCast()) { this.endChannel(); }
      else {
        const sp = this.cls.spells[ch.slot];
        const aim = this.aimInfo();
        const hand = sp.hand === 'left' ? 'left' : 'right';
        ch.ctx.origin.copy(this.muzzleWorld(hand));
        ch.ctx.dir.copy(aim.point).sub(ch.ctx.origin).normalize();
        ch.ctx.aimPoint.copy(aim.point);
        ch.ctx.stats = this.stats;
        sp.channel.update(ch.ctx, ch.S, dt);
        if (this.castAnim) this.castAnim.t = Math.min(this.castAnim.t, 0.2);
      }
      return;
    }
    if (!this.canCast() || !input.locked) return;
    // primary (auto fire while held)
    const prim = this.cls.spells.primary;
    this.rateTimer -= dt;
    if (input.mouse.left && this.rateTimer <= 0) {
      if (prim.mode === 'channel') this.tryCast('primary');
      else {
        this.tryCast('primary');
        this.rateTimer = prim.rate / (1 + this.stats.rateMult);
        this.chargesLeft.primary = 1;
      }
    }
    if (input.mouse.rightPressed || (input.mouse.right && this.cls.spells.secondary.mode === 'channel' && this.chargesLeft.secondary > 0 && !this._secHeldLatch)) {
      if (this.tryCast('secondary')) this._secHeldLatch = true;
    }
    if (!input.mouse.right) this._secHeldLatch = false;
    if (input.was('ability1')) this._tryOrBuzz('ability1');
    if (input.was('ability2')) this._tryOrBuzz('ability2');
    if (input.was('ultimate')) this._tryOrBuzz('ultimate');
  }

  _tryOrBuzz(slot) {
    if (!this.tryCast(slot)) {
      this.game.ui?.slotDenied(slot);
      this.game.audio?.play('ui_error', { volume: 0.4 });
    }
  }

  // called by game when this player's hits connect
  onDealtDamage(amount, killed) {
    this.damageDealt += amount;
    this.ult = Math.min(100, this.ult + amount * 0.055 * this.stats.ultRate);
    if (this.stats.lifesteal) this.heal(amount * this.stats.lifesteal, true);
    if (killed) {
      this.kills++;
      if (this.stats.killHeal) this.heal(this.stats.killHeal, true);
      if (this.stats.hasteOnKill) { this.hasteT = 3; this.recomputeStats(); }
    }
  }

  // camera placement each frame
  updateCamera(cam, dt, vfx, time) {
    const eye = this.eye;
    // head bob
    const bobAmt = this.grounded ? (this.speedNorm ?? 0) : 0;
    this.bobAmp = damp(this.bobAmp ?? 0, bobAmt, 10, dt);
    const by = Math.abs(Math.sin(this.bob * Math.PI * 0.5)) * 0.06 * this.bobAmp;
    const bx = Math.sin(this.bob * Math.PI * 0.5) * 0.03 * this.bobAmp;
    // trauma-based shake (rotation only)
    const tr = vfx.shake * vfx.shake * ((this.game.settings?.shake ?? 1));
    const sx = (Math.sin(time * 37.1) + Math.sin(time * 61.7) * 0.5) * tr * 0.025;
    const sy = (Math.sin(time * 41.3 + 1) + Math.sin(time * 53.9) * 0.5) * tr * 0.025;
    const sr = Math.sin(time * 29.3 + 2) * tr * 0.03;
    const r = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    cam.position.set(eye.x + r.x * bx, eye.y + by - 0.03, eye.z + r.z * bx);
    const downRoll = this.downK * 0.35;
    // lean a touch into strafes
    const side = this.vel.x * r.x + this.vel.z * r.z;
    this.leanK = damp(this.leanK, this.grounded ? clamp(side / 7, -1, 1) : 0, 8, dt);
    cam.rotation.set(this.pitch + sy, this.yaw + sx, sr + downRoll - this.leanK * 0.018, 'YXZ');
    const targetFov = this.game.renderer.baseFov + vfx.fovKick + (this.dashT > 0 ? 6 : 0) + (this.speedNorm ?? 0) * 2;
    cam.fov = damp(cam.fov, targetFov, 12, dt);
    cam.updateProjectionMatrix();
  }
}
