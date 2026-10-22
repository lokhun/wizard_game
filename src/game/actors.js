import * as THREE from 'three';
import { ENEMY_DEFS, BOSS_DEFS } from './enemyDefs.js';
import { applyStatus, consumeStatus, moveMult, actMult, statusMask, ST } from './combat.js';
import { SPR } from '../render/particles.js';
import { fxOf } from '../render/vfx.js';
import { rand } from '../core/rng.js';
import { angleDamp, clamp } from '../core/math.js';
import { Pathing } from './pathing.js';
import { getEnemyModel } from './models.js';
import { castMergedShadow } from '../render/shadows.js';
import { BossBrain } from './bosses.js';

const _frustum = new THREE.Frustum(), _m4 = new THREE.Matrix4(), _sph = new THREE.Sphere();

// ---------------------------------------------------------------------------
// Actors: enemies, bosses and allied summons. The host runs AI and owns HP;
// clients interpolate snapshots. Damage to players is always resolved by the
// victim's own machine through "hazards" (see game.js).
// ---------------------------------------------------------------------------

export const ANIMS = ['idle', 'move', 'windup', 'attack', 'cast', 'stagger', 'death', 'spawn'];
const _v = new THREE.Vector3();
const _dir = { x: 0, z: 0 };

let actorTypeIndex = null;
export function typeIndex() {
  if (!actorTypeIndex) actorTypeIndex = [...Object.keys(ENEMY_DEFS), ...Object.keys(BOSS_DEFS)];
  return actorTypeIndex;
}

export class Actor {
  constructor(id, type, opts) {
    this.id = id;
    this.type = type;
    this.boss = !!BOSS_DEFS[type];
    this.def = this.boss ? BOSS_DEFS[type] : ENEMY_DEFS[type];
    this.faction = opts.faction ?? (this.def.ally ? 'ally' : 'enemy');
    this.elite = !!opts.elite || !!this.def.elite;
    this.affix = opts.affix ?? null;
    this.pos = new THREE.Vector3(opts.x, opts.y ?? 0, opts.z);
    this.vel = new THREE.Vector3();
    this.kb = new THREE.Vector3();
    this.yaw = opts.yaw ?? 0;
    this.maxHp = opts.hp ?? this.def.hp;
    this.hp = this.maxHp;
    this.dmg = opts.dmg ?? this.def.dmg;
    this.st = {};
    this.mask = 0;
    this.stacks = { poison: 0, chill: 0 };
    this.anim = 'spawn';
    this.animT = 0;
    this.progress = 0;
    this.attackType = '';
    this.state = 'spawn';
    this.stateT = 0;
    this.cds = {};
    this.dead = false;
    this.deadT = 0;
    this.target = null;
    this.retargetT = 0;
    this.poiseDmg = 0;
    this.poiseT = 0;
    this.life = opts.life ?? 0; // summons expire
    this.owner = opts.owner ?? null;
    this.scale = (this.def.scale ?? 1) * (this.elite && !this.def.elite ? 1.25 : 1);
    this.net = { x: this.pos.x, y: this.pos.y, z: this.pos.z, yaw: this.yaw, t: 0 };
    this.lastHitBy = null;
    this.lastHitEl = 'physical';
    this.hitFlash = 0;
    this.shieldHp = 0;
    this.speedMult = 1;
    this.collapsed = false;
    // sentries placed before the party arrives: idle until they notice someone
    this.dormant = !!opts.dormant;
    this.homeRoom = opts.homeRoom ?? null;
  }
  get alive() { return !this.dead && !this.collapsed; }
}

// what an enemy's body is made of, for death debris
function bodyOf(type) {
  if (/skeleton|lich/i.test(type)) return 'bone';
  if (/armor|knight|guard|gargoyle|captain/i.test(type)) return 'metal';
  if (/slime|ooze/i.test(type)) return 'slime';
  if (/wraith|grimoire|imp|spirit/i.test(type)) return 'spirit';
  return 'flesh';
}
const CORPSE_LINGER = 7;
const CORPSE_CAP = 16;
const RANGED_KINDS = new Set(['shoot', 'lob', 'circle']);
const LOS_KINDS = new Set(['lunge', 'charge', 'circle', 'shoot', 'lob']); // _canUse reads los for these

export class ActorManager {
  constructor(game) {
    this.g = game;
    this.list = [];
    this.byId = new Map();
    this.nextId = 1;
    this._hostiles = [];
    this._allies = [];
    this.pathing = null;
  }

  setLevel(level, collision) {
    this.clear();
    this.pathing = new Pathing(level, collision);
  }

  clear() {
    for (const a of this.list) this._disposeModel(a);
    this.list.length = 0;
    this.byId.clear();
  }

  hostiles() { return this._hostiles; }
  allies() { return this._allies; }
  _rebuildLists() {
    this._hostiles = this.list.filter((a) => a.alive && a.faction === 'enemy' && a.state !== 'spawn');
    this._allies = this.list.filter((a) => a.alive && a.faction === 'ally');
  }
  enemiesAlive() { return this.list.filter((a) => a.faction === 'enemy' && (!a.dead || a.collapsed)).length; }

  // ------------------------------------------------------------- spawning
  spawn(type, x, z, opts = {}) {
    const g = this.g;
    const id = opts.id ?? this.nextId++;
    if (opts.id && opts.id >= this.nextId) this.nextId = opts.id + 1;
    const a = new Actor(id, type, { x, z, y: g.groundY(x, z), ...opts });
    const modelType = a.def.model ?? type;
    a.model = getEnemyModel(modelType, g);
    a.radius = (a.model.radius ?? 0.5) * a.scale;
    a.height = (a.model.height ?? 1.8) * a.scale;
    a.flying = a.def.flying ?? a.model.flying ?? false;
    a.model.root.scale.setScalar(a.scale);
    a.model.root.position.copy(a.pos);
    a.model.root.rotation.y = a.yaw;
    if (a.faction === 'ally') a.model.setTint?.(0x50e890, 0.45);
    else if (a.def.tint) a.model.setTint?.(a.def.tint, 0.5);
    if (a.elite && !a.def.elite) a.model.setTint?.(0xffaa30, 0.25);
    if (g.shadowsOn && !a.boss) a.unshadow = castMergedShadow(a.model.root, g.renderer);
    else if (g.shadowsOn) a.model.root.traverse((o) => { if (o.isMesh && !o.material?.transparent) o.castShadow = true; });
    g.scene.add(a.model.root);
    this.list.push(a);
    this.byId.set(id, a);
    // summoning circle VFX
    const spawnFx = opts.spawnFx ?? (a.faction === 'enemy' && !a.boss);
    if (spawnFx) {
      const gy = a.pos.y;
      g.vfx.decal(new THREE.Vector3(x, gy, z), 'glyph', 2.2 * a.scale + 0.8, 1.6, a.faction === 'ally' ? 0x206030 : 0x5a0c06);
      g.vfx.burst(new THREE.Vector3(x, gy + 0.2, z), { element: a.faction === 'ally' ? 'necrotic' : 'enemy', count: 24, speed: 2, upward: 2, life: 0.9, size: 0.08, drag: 1.5, color: a.faction === 'ally' ? undefined : [1.6, 0.15, 0.05] });
      g.vfx.smoke(new THREE.Vector3(x, gy + 0.3, z), { count: 5, size: 0.7, color: [0.05, 0.01, 0.01], alpha: 0.6, life: 1.4, rise: 1.5 });
      g.lights.flash(new THREE.Vector3(x, gy + 0.6, z), a.faction === 'ally' ? 0x60ff80 : 0xff3020, 6, 5, 0.8);
      g.audio?.play('summon', { pos: a.pos, volume: 0.5 });
    }
    a.state = a.dormant ? 'chase' : 'spawn';
    a.anim = a.dormant ? 'idle' : 'spawn';
    a.stateT = 0;
    if (g.isHost && !opts.silent) g.net?.broadcast({ t: 'spawn', id, ty: type, x, z, yaw: a.yaw, e: a.elite ? 1 : 0, hp: a.maxHp, f: a.faction === 'ally' ? 1 : 0, af: a.affix, life: a.life, nf: spawnFx ? 0 : 1, dm: a.dormant ? 1 : 0, hr: a.homeRoom ? a.homeRoom.id : -1 });
    if (a.boss) a.brain = new BossBrain(g, a);
    this._rebuildLists();
    return a;
  }

  _disposeModel(a) {
    a.unshadow?.(); a.unshadow = null;
    if (a.model) {
      this.g.scene.remove(a.model.root);
      a.model.dispose?.();
      a.model = null;
    }
  }

  // Hit flinch: an angular impulse on a damped spring, applied as a lean of the whole
  // model in the push direction (cheap, works for every rig, and stacks with poses).
  jolt(a, dirX, dirZ, k = 1) {
    if (!a.model || a.dead) return;
    const amp = (a.boss ? 1.5 : 8.5) * k / (1 + (a.def.poise ?? 20) / 80);
    const fx = Math.sin(a.yaw), fz = Math.cos(a.yaw);
    const rx = Math.cos(a.yaw), rz = -Math.sin(a.yaw);
    a.jv = a.jv ?? [0, 0, 0, 0]; // pitch, roll, pitchVel, rollVel
    a.jv[2] += (dirX * fx + dirZ * fz) * amp;
    a.jv[3] -= (dirX * rx + dirZ * rz) * amp;
  }

  // A sentry notices the party: it shouts, and nearby sleepers follow a beat later.
  wake(a, alert = true) {
    if (!a.dormant) return;
    a.dormant = false;
    a.wakeAt = 0;
    a.retargetT = 0;
    const g = this.g;
    if (g.isHost) g.net?.broadcast({ t: 'wake', id: a.id });
    g.audio?.play(a.def.sound ?? 'beast_growl', { pos: a.pos, volume: 0.7 });
    g.ui?.floatText(new THREE.Vector3(a.pos.x, a.pos.y + a.height + 0.3, a.pos.z), '!', '#ff6040', true);
    if (!alert) return;
    for (const b of this._hostiles) {
      if (!b.dormant || b.wakeAt) continue;
      if ((b.pos.x - a.pos.x) ** 2 + (b.pos.z - a.pos.z) ** 2 < 13 * 13) b.wakeAt = g.time + 0.3 + Math.random() * 0.5;
    }
  }

  // Melee wind-ups have no ground telegraph, so they get a tell: a glint at the head,
  // the creature's own voice, and an edge-of-screen marker when it's behind you.
  _windupTell(a) {
    if (a.faction !== 'enemy' || a.boss || a.def.range) return;
    const g = this.g;
    const y = a.pos.y + a.height * 0.86;
    g.vfx.P.glow({ x: a.pos.x, y, z: a.pos.z, r: 2.6, g: 1.9, b: 1.2, life: 0.22, size: 0.32, size2: 0.04, sprite: SPR.STAR, spin: 4 });
    const p = g.player;
    if (!p || p.dead) return;
    const dx = a.pos.x - p.pos.x, dz = a.pos.z - p.pos.z, d = Math.hypot(dx, dz);
    if (d > 12) return;
    if ((a._tellT ?? 0) < g.time) { a._tellT = g.time + 1.2; g.audio?.play(a.def.sound ?? 'swing', { pos: a.pos, volume: 0.55 }); }
    const fx = -Math.sin(p.yaw), fz = -Math.cos(p.yaw);
    if (d < 7 && (fx * dx + fz * dz) / Math.max(d, 0.01) < 0.35) g.ui?.damageDirection(a.pos);
  }

  remove(a) {
    this._disposeModel(a);
    const i = this.list.indexOf(a);
    if (i >= 0) this.list.splice(i, 1);
    this.byId.delete(a.id);
    this._rebuildLists();
  }

  // ------------------------------------------------------------- damage (host)
  // H: { dmg, el, st, kb, kbDir, pull, src, crit, consume, reaction, power }
  damage(a, H) {
    const g = this.g;
    if (!a.alive) return 0;
    if (a.state === 'spawn' && a.stateT < 0.3 && !a.boss) return 0;
    let dmg = H.dmg ?? 0;
    const def = a.def;
    if (a.dormant) {
      // the opener: hitting an unaware sentry lands hard
      dmg *= 1.5;
      this.g.ui?.floatText(new THREE.Vector3(a.pos.x, a.pos.y + a.height + 0.6, a.pos.z), 'UNAWARE ×1.5', '#ffd070');
      this.wake(a);
    }
    if (def.armor) dmg *= 1 - def.armor;
    if (def.frontShield && H.kbDir) {
      // blocked from the front
      const fx = Math.sin(a.yaw), fz = Math.cos(a.yaw);
      if (fx * -H.kbDir[0] + fz * -H.kbDir[1] > 0.5 && !(a.st.stun?.t > 0)) dmg *= 1 - def.frontShield;
    }
    if (a.shieldHp > 0) { const ab = Math.min(a.shieldHp, dmg); a.shieldHp -= ab; dmg -= ab; }
    if (a.affix === 'shielded' && a.hp > a.maxHp * 0.5) dmg *= 0.6;
    if (a.brain?.modifyDamage) dmg = a.brain.modifyDamage(dmg, H);
    a.hp -= dmg;
    a.lastHitBy = H.src ?? a.lastHitBy;
    a.lastHitEl = H.el ?? a.lastHitEl;
    if (H.consume?.length) consumeStatus(a, H.consume);
    if (H.st) applyStatus(a, H.st, H.power ?? 1);
    // knockback & pull
    const mass = a.boss ? 0 : 1 / (1 + (def.poise ?? 20) / 60);
    if (H.kb && H.kbDir && mass > 0) {
      a.kb.x += H.kbDir[0] * H.kb * mass * 1.6;
      a.kb.z += H.kbDir[1] * H.kb * mass * 1.6;
    }
    if (H.pull && mass > 0) {
      const dx = H.pull[0] - a.pos.x, dz = H.pull[1] - a.pos.z;
      const d = Math.hypot(dx, dz);
      if (d > 0.8) { a.kb.x += dx / d * H.pull[2] * mass * 0.5; a.kb.z += dz / d * H.pull[2] * mass * 0.5; }
    }
    // poise / stagger (damage over time wears health, not footing)
    if (H.tag !== 'dot') {
      a.poiseDmg += dmg;
      a.poiseT = 2;
      if (a.poiseDmg > (def.poise ?? 20) && !a.boss && a.state !== 'spawn') {
        a.poiseDmg = 0;
        this._setState(a, 'stagger', 'stagger');
      }
      a.hitFlash = Math.max(a.hitFlash, 0.45);
    }
    if (a.hp <= 0) this.kill(a, H.src, H.el);
    return dmg;
  }

  heal(a, amount, shield = false) {
    if (!a.alive) return;
    if (shield) a.shieldHp = Math.max(a.shieldHp, amount);
    else a.hp = Math.min(a.maxHp, a.hp + amount);
    this.g.vfx.burst(_v.set(a.pos.x, a.pos.y + a.height * 0.6, a.pos.z), { element: shield ? 'holy' : 'poison', count: 12, speed: 1.5, upward: 1, life: 0.8, size: 0.12, sprite: SPR.STAR });
  }

  kill(a, killer, el) {
    const g = this.g;
    if (a.dead) return;
    // skeletons may pull themselves back together
    if (a.def.reassemble && !a.reassembled && el !== 'holy' && el !== 'earth' && el !== 'fire' && Math.random() < a.def.reassemble) {
      a.reassembled = true;
      a.collapsed = true;
      a.hp = a.maxHp * 0.5;
      this._setState(a, 'collapsed', 'death');
      g.net?.broadcast({ t: 'collapse', id: a.id });
      this._rebuildLists();
      return;
    }
    a.dead = true;
    a.deadT = 0;
    a.anim = 'death';
    a.animT = 0;
    a.deathMask = a.mask; // kill effects (burning foes exploding, relics) read what it died with
    a.st = {};
    a.mask = 0;
    this._rebuildLists();
    if (g.isHost) {
      g.net?.broadcast({ t: 'die', id: a.id, k: killer ?? 0, el });
      g.onActorKilled(a, killer, el);
      // on-death behaviours
      if (a.def.splitInto) {
        for (let i = 0; i < (a.def.splits ?? 2); i++) {
          const ang = Math.random() * Math.PI * 2;
          const c = this.spawn(a.def.splitInto, a.pos.x + Math.cos(ang) * 0.8, a.pos.z + Math.sin(ang) * 0.8, { hp: ENEMY_DEFS[a.def.splitInto].hp * g.director.hpScale(), dmg: ENEMY_DEFS[a.def.splitInto].dmg * g.director.dmgScale(), spawnFx: false });
          c.state = 'chase';
          c.anim = 'idle';
          c.kb.set(Math.cos(ang) * 5, 0, Math.sin(ang) * 5);
        }
      }
      if (a.def.deathPool) g.spawnPool(a.pos, a.def.deathPool.radius, a.def.deathPool.dur, a.def.deathPool.dps * g.director.dmgScale(), 'enemyGreen');
      if (a.def.deathExplode || a.affix === 'volatile') {
        const de = a.def.deathExplode ?? { radius: 3, el: 'enemyFire' };
        g.broadcastHazard({ shape: 'circle', x: a.pos.x, y: a.pos.y, z: a.pos.z, r: de.radius, delay: 0.6, dmg: a.dmg * 1.2, el: de.el, vis: 1 });
      }
    }
    this.deathFx(a, el);
  }

  // element-flavoured death effects (all peers)
  deathFx(a, el) {
    const g = this.g;
    const c = new THREE.Vector3(a.pos.x, a.pos.y + a.height * 0.5, a.pos.z);
    const tagPos = new THREE.Vector3(a.pos.x, a.pos.y + a.height + 0.4, a.pos.z);
    const cut = g.cancelHazardsFrom?.(a.id, tagPos) ?? 0;
    // melee swings have no hazard to cancel, but cutting one short still deserves the callout
    if (!cut && a.state === 'windup' && !a.boss) g.ui?.floatText(tagPos, 'INTERRUPTED', '#e8c070');
    g.audio?.play(a.def.deathSound ?? 'enemy_death', { pos: c });
    g.audio?.play('kill', { volume: 0.4 });
    const s = Math.max(0.6, a.height / 1.8);
    switch (el) {
      case 'fire':
        g.vfx.burst(c, { element: 'fire', count: 30 * s, speed: 3, upward: 1, life: 1, size: 0.3 * s, sprite: SPR.FLAME, drag: 2 });
        g.vfx.burst(c, { element: 'fire', count: 40 * s, speed: 4, upward: 1.5, life: 2, size: 0.05, sprite: SPR.EMBER, gravity: -0.5, drag: 1, color: [3, 1.2, 0.3] });
        g.vfx.smoke(c, { count: 6 * s, size: 0.7 * s, life: 2 });
        break;
      case 'frost':
        g.vfx.burst(c, { element: 'frost', count: 40 * s, speed: 6, life: 1.2, size: 0.2, sprite: SPR.SHARD, gravity: 12, spin: 6, color: [1.6, 2.2, 2.8] });
        g.audio?.play('shatter', { pos: c });
        break;
      case 'lightning':
        g.vfx.burst(c, { element: 'lightning', count: 40, speed: 8, life: 0.5, size: 0.08, stretch: 0.05, gravity: 4 });
        g.vfx.smoke(c, { count: 4, size: 0.6 });
        break;
      case 'arcane':
        g.vfx.burst(c, { element: 'arcane', count: 30 * s, speed: 2, upward: 1.5, life: 1.4, size: 0.25, sprite: SPR.RUNE, drag: 1, gravity: -1 });
        break;
      case 'holy':
        g.vfx.burst(c, { element: 'holy', count: 30 * s, speed: 2, upward: 2.5, life: 1.4, size: 0.2, sprite: SPR.STAR, gravity: -2, drag: 1 });
        g.lights.flash(c, 0xffd870, 20, 8, 0.4);
        break;
      case 'shadow': case 'necrotic':
        g.vfx.smoke(c, { count: 10 * s, size: 0.8 * s, color: el === 'shadow' ? [0.04, 0, 0.06] : [0.03, 0.08, 0.03], alpha: 0.8, life: 1.6 });
        g.vfx.burst(c, { element: el, count: 20, speed: 3, upward: 1, life: 1, size: 0.3, sprite: SPR.WISP });
        break;
      case 'poison':
        g.vfx.burst(c, { element: 'poison', count: 30, speed: 3, upward: 1, life: 1.2, size: 0.18, sprite: SPR.BUBBLE, gravity: 2 });
        g.vfx.decal(new THREE.Vector3(a.pos.x, a.pos.y, a.pos.z), 'slime', 2 * s, 8);
        break;
      case 'blood': case 'blade':
        g.vfx.burst(c, { count: 40 * s, speed: 6, life: 0.9, size: 0.08, sprite: SPR.DROP, gravity: 14, solid: true, color: [0.4, 0, 0.03], color2: [0.2, 0, 0.01], stretch: 0.05 });
        g.vfx.decal(new THREE.Vector3(a.pos.x, a.pos.y, a.pos.z), 'blood', 2.2 * s, 14);
        break;
      default:
        g.vfx.burst(c, { count: 16, speed: 5, life: 0.9, size: 0.12, sprite: SPR.CHUNK, gravity: 14, solid: true, color: [0.4, 0.38, 0.35] });
        g.vfx.smoke(c, { count: 4, size: 0.6, color: [0.25, 0.22, 0.2], alpha: 0.4 });
    }
    // what the body is made of adds its own debris on top of the element effect
    const body = bodyOf(a.type);
    if (body === 'bone') {
      g.vfx.burst(c, { count: 14 * s, speed: 4.5, life: 1.4, size: 0.1, sprite: SPR.CHUNK, gravity: 15, solid: true, spin: 9, upward: 0.6, color: [0.62, 0.57, 0.47], color2: [0.45, 0.4, 0.33] });
      g.vfx.smoke(c, { count: 3, size: 0.5 * s, color: [0.35, 0.32, 0.28], alpha: 0.35, life: 1.4 });
    } else if (body === 'metal') {
      g.vfx.burst(c, { count: 10 * s, speed: 5, life: 1.3, size: 0.12, sprite: SPR.CHUNK, gravity: 16, solid: true, spin: 10, upward: 0.5, color: [0.34, 0.35, 0.38], color2: [0.22, 0.22, 0.24] });
      g.vfx.burst(c, { count: 18, speed: 7, life: 0.4, size: 0.04, sprite: SPR.SPARK, stretch: 0.05, gravity: 10, color: [3, 2.2, 1.2] });
    } else if (body === 'slime') {
      g.vfx.burst(c, { count: 24 * s, speed: 4, life: 0.9, size: 0.14, sprite: SPR.DROP, gravity: 14, solid: true, upward: 0.8, color: [0.16, 0.3, 0.06], color2: [0.1, 0.2, 0.04] });
      g.vfx.decal(new THREE.Vector3(a.pos.x, a.pos.y, a.pos.z), 'slime', 2.4 * s, 12);
    } else if (body === 'spirit') {
      g.vfx.smoke(c, { count: 8 * s, size: 0.7 * s, color: [0.18, 0.2, 0.26], alpha: 0.45, life: 2.2, speed: 1.2 });
      g.vfx.burst(c, { count: 12, speed: 1.5, upward: 2, life: 1.6, size: 0.2, sprite: SPR.WISP, gravity: -1.5, drag: 1, color: [0.6, 0.75, 1.0] });
    } else if (el !== 'blood' && el !== 'blade') {
      g.vfx.burst(c, { count: 12 * s, speed: 4, life: 0.8, size: 0.06, sprite: SPR.DROP, gravity: 14, solid: true, stretch: 0.04, color: [0.32, 0.01, 0.02], color2: [0.18, 0, 0.01] });
      if (s > 0.7) g.vfx.decal(new THREE.Vector3(a.pos.x, a.pos.y, a.pos.z), 'blood', 1.4 * s, 12);
    }
    if (a.boss) {
      g.vfx.explosion(c, fxOf(el) ? el : 'arcane', 8);
      g.vfx.addShake(0.8);
    }
  }

  _setState(a, state, anim, attack = null) {
    a.state = state;
    a.stateT = 0;
    if (anim) { a.anim = anim; a.animT = 0; }
    if (attack !== undefined) a.attack = attack;
  }

  // ------------------------------------------------------------- update
  update(dt) {
    const g = this.g;
    let listDirty = false;
    // animation LOD: what the camera can't see poses every 4th frame, distant
    // actors every 2nd (the skipped time is carried, so nothing drifts)
    const cam = g.renderer.camera;
    cam.updateMatrixWorld();
    _frustum.setFromProjectionMatrix(_m4.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse));
    this._frame = (this._frame ?? 0) + 1;
    // past the cap, the oldest bodies sink early
    const ages = [];
    for (const a of this.list) if (a.dead && !a.sinkT && !a.boss) ages.push(a.deadT);
    this._sinkOlder = ages.length > CORPSE_CAP ? ages.sort((x, y) => y - x)[ages.length - CORPSE_CAP] : Infinity;
    for (let i = this.list.length - 1; i >= 0; i--) {
      const a = this.list[i];
      if (a.dead) {
        if (a._laserBeam) { a._laserBeam.release(0.05); a._laserBeam = null; }
        a.deadT += dt;
        a.animT += dt;
        a.progress = Math.min(1, a.deadT / 1.1);
        // the killing blow carries the body for a moment
        const kbl = Math.hypot(a.kb.x, a.kb.z);
        if (kbl > 0.1 && !a.boss) {
          const r = g.collision.move(a.pos.x, a.pos.z, a.pos.y, a.kb.x * dt, a.kb.z * dt, Math.min(a.radius, 0.6));
          a.pos.x = r.x; a.pos.z = r.z;
          const decay = Math.exp(-dt * 5);
          a.kb.x *= decay; a.kb.z *= decay;
          if (a.model) { a.model.root.position.x = a.pos.x; a.model.root.position.z = a.pos.z; }
        }
        // bodies linger so the room remembers the fight; the oldest sink first when there are many
        const sinkAt = a.boss ? 9 : a.deadT > this._sinkOlder ? 1.8 : CORPSE_LINGER;
        if (a.model) {
          // bosses get a longer death performance (visual only: the model keeps animating past progress 1)
          if (a.deadT < (a.boss ? 4.5 : 1.8)) a.model.update(dt, { anim: 'death', t: a.animT, speed: 0, progress: a.progress, attackType: '' });
          if (a.deadT > sinkAt) {
            a.sinkT = (a.sinkT ?? 0) + dt;
            a.model.root.position.y = a.pos.y - a.sinkT * 0.7;
            // the body crumbles as it goes: dark ash lifting off, a few dying embers
            const cam = g.renderer.camera.position;
            if (a.sinkT < 1.1 && (cam.x - a.pos.x) ** 2 + (cam.z - a.pos.z) ** 2 < 700) {
              const n = Math.min(3, Math.floor(dt * 34 * Math.min(2, a.radius * 2) + Math.random()));
              const r = a.radius * 0.9, top = Math.max(0.15, a.height * 0.35 - a.sinkT * 0.7);
              for (let k = 0; k < n; k++) {
                const x = a.pos.x + rand(-r, r), z = a.pos.z + rand(-r, r), y = a.pos.y + rand(0.05, top);
                g.vfx.P.solid({ x, y, z, vx: rand(-0.2, 0.2), vy: rand(0.3, 0.8), vz: rand(-0.2, 0.2), r: 0.13, g: 0.12, b: 0.105, a: 0.55, life: rand(0.8, 1.4), size: 0.16, size2: 0.7, sprite: SPR.SMOKE, drag: 1.5 });
                if (Math.random() < 0.45) g.vfx.P.glow({ x, y, z, vx: rand(-0.4, 0.4), vy: rand(0.5, 1.4), vz: rand(-0.4, 0.4), r: 1.2, g: 0.45, b: 0.12, r2: 0.2, g2: 0.03, b2: 0, life: rand(0.5, 1.1), size: 0.025, sprite: SPR.EMBER, drag: 1 });
              }
            }
          }
        }
        if ((a.sinkT ?? 0) > 1.4 || (!a.model && a.deadT > 2.6)) { this.remove(a); listDirty = false; }
        continue;
      }
      if (g.isHost) this._hostUpdate(a, dt);
      else this._clientUpdate(a, dt);
      this._statusFx(a, dt);
      // model
      if (a.model) {
        const m = a.model;
        m.root.position.copy(a.pos);
        m.root.rotation.y = a.yaw;
        if (a.jv) {
          // damped spring back to upright
          const j = a.jv, h = Math.min(dt, 1 / 30);
          j[2] += (-170 * j[0] - 16 * j[2]) * h; j[3] += (-170 * j[1] - 16 * j[3]) * h;
          j[0] += j[2] * h; j[1] += j[3] * h;
          j[0] = Math.max(-0.35, Math.min(0.35, j[0])); j[1] = Math.max(-0.3, Math.min(0.3, j[1]));
          m.root.rotation.order = 'YXZ';
          m.root.rotation.x = j[0]; m.root.rotation.z = j[1];
          if (Math.abs(j[0]) + Math.abs(j[1]) + Math.abs(j[2]) + Math.abs(j[3]) < 1e-3) { a.jv = null; m.root.rotation.x = 0; m.root.rotation.z = 0; }
        }
        if (a._laserBeam && (g.time > a._laserEnd || a.anim !== 'windup')) { a._laserBeam.release(0.05); a._laserBeam = null; }
        if (a.anim === 'windup' && a._prevAnim !== 'windup') this._windupTell(a);
        a._prevAnim = a.anim;
        const frozen = (a.mask & ST.frozen) !== 0;
        const animDt = frozen ? 0 : dt * (a.mask & ST.slow ? 0.5 : 1);
        a.animT += animDt;
        a._poseDt = (a._poseDt ?? 0) + animDt;
        let every = 1;
        if (!a.boss) {
          _sph.center.set(a.pos.x, a.pos.y + a.height * 0.5, a.pos.z);
          _sph.radius = Math.max(a.height, a.radius * 2) * 0.75 + 0.5;
          if (!_frustum.intersectsSphere(_sph)) every = 4;
          else if ((a.pos.x - cam.position.x) ** 2 + (a.pos.z - cam.position.z) ** 2 > 900) every = 2;
        }
        if (every === 1 || (this._frame + a.id) % every === 0 || a.anim !== a._posedAnim) {
          m.update(a._poseDt, { anim: a.anim, t: a.animT, speed: a.moveSpeed ?? 0, progress: a.progress, attackType: a.attackType });
          a._poseDt = 0; a._posedAnim = a.anim;
        }
        if ((a.moveSpeed ?? 0) > 0.5 && a.pos.y < 0) g.wadeFx(a, a.moveSpeed, dt, a.radius ?? 0.5);
        if (a.hitFlash > 0) { m.flash?.(a.hitFlash); a.hitFlash = 0; }
        // status tint
        const tint = frozen ? 0xa8e8ff : (a.mask & ST.burn) ? 0xff7a30 : (a.mask & ST.poison) ? 0x90e030 : (a.mask & ST.chill) ? 0x80c8ff : (a.mask & ST.hex) ? 0xa040ff : null;
        if (tint !== a._tint) {
          a._tint = tint;
          if (tint) m.setTint?.(tint, frozen ? 0.65 : 0.35);
          else if (a.faction === 'ally') m.setTint?.(0x50e890, 0.45); // summoned allies wear a spectral green
          else if (a.def.tint) m.setTint?.(a.def.tint, 0.5);
          else if (a.elite && !a.def.elite) m.setTint?.(0xffaa30, 0.25);
          else m.setTint?.(null, 0);
        }
      }
    }
    if (listDirty) this._rebuildLists();
    // keep lists fresh (spawn state changes)
    this._rebuildLists();
  }

  _statusFx(a, dt) {
    const g = this.g;
    const m = a.mask;
    const x = a.pos.x, y = a.pos.y, z = a.pos.z, h = a.height, r = a.radius;
    const P = g.vfx.P;
    // champion affix auras
    if (a.affix && Math.random() < dt * 14) {
      const ang = Math.random() * Math.PI * 2;
      const col = { hasted: [0.6, 1.6, 2.6], vampiric: [2.4, 0.15, 0.25], volatile: [3, 1.2, 0.2], shielded: [2.6, 2.2, 0.8] }[a.affix] ?? [2, 2, 2];
      P.glow({ x: x + Math.cos(ang) * r * 1.2, y: y + 0.1, z: z + Math.sin(ang) * r * 1.2, vx: -Math.sin(ang) * 1.2, vy: rand(0.8, 1.8), vz: Math.cos(ang) * 1.2, r: col[0], g: col[1], b: col[2], life: 0.9, size: 0.09, sprite: SPR.SPARK, drag: 1 });
    }
    if (a.elite && !a.def.elite) g.lights.request(_v.set(x, y + h * 0.5, z), 0xffa040, 2.5, 4);
    if (a.faction === 'ally' && Math.random() < dt * 8) P.glow({ x: x + rand(-r, r), y: y + h * rand(0.2, 0.9), z: z + rand(-r, r), vy: 0.6, r: 0.4, g: 1.6, b: 0.8, life: 0.9, size: 0.08, sprite: SPR.WISP });
    if ((m & ST.empower) && Math.random() < dt * 10) {
      const ang = Math.random() * Math.PI * 2;
      P.glow({ x: x + Math.cos(ang) * r, y: y + 0.05, z: z + Math.sin(ang) * r, vy: rand(1.2, 2.2), r: 2.2, g: 1.4, b: 0.35, life: 0.8, size: 0.07, sprite: SPR.SPARK, drag: 0.5 });
    }
    if (a.def.aura && Math.random() < dt * 14) {
      // the banner's reach, traced on the ground in gold (it must read against purple halls)
      const ang = Math.random() * Math.PI * 2, R = a.def.aura.radius;
      P.glow({ x: x + Math.cos(ang) * R, y: y + 0.08, z: z + Math.sin(ang) * R, vy: 0.4, r: 1.8, g: 1.2, b: 0.3, life: 1.4, size: 0.14, sprite: SPR.GLOW });
    }
    if (!m) return;
    if (m & ST.burn && Math.random() < dt * 30) P.glow({ x: x + rand(-r, r), y: y + rand(0.2, h), z: z + rand(-r, r), vy: rand(1, 2.2), r: 4, g: 1.5, b: 0.3, r2: 1, g2: 0.15, b2: 0.02, life: rand(0.3, 0.6), size: 0.3, size2: 0.05, sprite: SPR.FLAME, drag: 1 });
    if (m & ST.burn) g.lights.request(_v.set(x, y + h * 0.6, z), 0xff6020, 3, 4);
    if (m & ST.poison && Math.random() < dt * 8) P.glow({ x: x + rand(-r, r), y: y + rand(0.2, h), z: z + rand(-r, r), vy: rand(0.3, 0.8), r: 1.2, g: 2.4, b: 0.4, life: 0.8, size: 0.12, sprite: SPR.BUBBLE, gravity: -0.5 });
    if (m & ST.shock && Math.random() < dt * 6) g.vfx.lightning(_v.set(x + rand(-r, r), y + rand(0, h), z + rand(-r, r)).clone(), new THREE.Vector3(x + rand(-r, r) * 2, y + rand(0, h), z + rand(-r, r) * 2), { life: 0.06, branches: 0, width: 0.03 });
    if (m & ST.bleed && Math.random() < dt * 8) P.solid({ x: x + rand(-r, r) * 0.6, y: y + rand(0.4, h * 0.8), z: z + rand(-r, r) * 0.6, vy: -0.5, r: 0.35, g: 0, b: 0.02, life: 0.7, size: 0.05, sprite: SPR.DROP, gravity: 9 });
    if (m & ST.chill && Math.random() < dt * 5) P.glow({ x: x + rand(-r, r), y: y + rand(0.2, h), z: z + rand(-r, r), vy: -0.3, r: 1.5, g: 2, b: 2.6, life: 1, size: 0.06, sprite: SPR.SNOW, spin: 2 });
    if (m & ST.hex && Math.random() < dt * 4) P.glow({ x, y: y + h + 0.4, z, vy: 0.4, r: 1.6, g: 0.4, b: 2.4, life: 0.8, size: 0.35, sprite: SPR.RUNE, spin: 1 });
    if (m & ST.stun && Math.random() < dt * 10) {
      const t = g.time * 5 + Math.random();
      P.glow({ x: x + Math.cos(t) * 0.4, y: y + h + 0.25, z: z + Math.sin(t) * 0.4, r: 3, g: 2.6, b: 1, life: 0.25, size: 0.15, sprite: SPR.STAR });
    }
    if (m & ST.slow && Math.random() < dt * 3) P.glow({ x, y: y + 0.1, z, r: 0.3, g: 1.6, b: 1.4, life: 0.6, size: a.radius * 3, size2: a.radius * 3.5, sprite: SPR.RING });
    if (m & ST.root && Math.random() < dt * 4) P.glow({ x: x + rand(-r, r), y: y + 0.1, z: z + rand(-r, r), vy: 0.6, r: 0.6, g: 1.4, b: 0.2, life: 0.5, size: 0.1, sprite: SPR.FEATHER });
    if (m & ST.mark && Math.random() < dt * 4) P.glow({ x, y: y + h + 0.6, z, r: 3, g: 2.5, b: 1, life: 0.3, size: 0.5, sprite: SPR.STAR });
    if (m & ST.wet && Math.random() < dt * 4) P.solid({ x: x + rand(-r, r), y: y + rand(0.2, h), z: z + rand(-r, r), r: 0.3, g: 0.4, b: 0.5, life: 0.5, size: 0.04, sprite: SPR.DROP, gravity: 9 });
  }

  // ------------------------------------------------------------- client interpolation
  _clientUpdate(a, dt) {
    const n = a.net;
    const k = 1 - Math.exp(-dt * 12);
    const dx = n.x - a.pos.x, dz = n.z - a.pos.z;
    if (dx * dx + dz * dz > 64) { a.pos.x = n.x; a.pos.z = n.z; }
    a.pos.x += dx * k;
    a.pos.z += dz * k;
    a.pos.y += (n.y - a.pos.y) * k;
    a.yaw = angleDamp(a.yaw, n.yaw, 12, dt);
    a.moveSpeed = Math.hypot(dx, dz) * 12 * 0.9;
    if (a.anim === 'windup' || a.anim === 'attack' || a.anim === 'cast') a.progress = Math.min(1, a.progress + dt / Math.max(0.2, a.netDur ?? 0.6));
    else if (a.anim === 'spawn') a.progress = Math.min(1, a.progress + dt / 0.9);
    // archer laser
    if (a.anim === 'windup' && a.attackDef?.laser) this._laser(a);
  }

  applySnapshot(arr) {
    // arr: flat [id, x, y, z, yaw*100, hp%*1000, animIdx, progress*100, mask, atkIdx, poison, chill]
    const N = 12;
    for (let i = 0; i < arr.length; i += N) {
      const a = this.byId.get(arr[i]);
      if (!a || a.dead) continue;
      a.net.x = arr[i + 1] / 100; a.net.y = arr[i + 2] / 100; a.net.z = arr[i + 3] / 100;
      a.net.yaw = arr[i + 4] / 100;
      a.hp = (arr[i + 5] / 1000) * a.maxHp;
      const anim = ANIMS[arr[i + 6]] ?? 'idle';
      const prog = arr[i + 7] / 100;
      const newState = anim === 'spawn' ? 'spawn' : 'chase';
      if (newState !== a.state) { a.state = newState; this._listsDirty = true; }
      if (anim !== a.anim) { a.anim = anim; a.animT = 0; a.progress = prog; }
      else if (Math.abs(prog - a.progress) > 0.25) a.progress = prog;
      a.mask = arr[i + 8];
      const atk = arr[i + 9];
      a.attackDef = atk >= 0 ? a.def.attacks?.[atk] : null;
      a.attackType = a.boss ? (a.brainAttackType ?? '') : (a.attackDef?.anim ?? '');
      if (a.attackDef) a.netDur = a.anim === 'windup' ? a.attackDef.windup : 0.4;
      a.stacks.poison = arr[i + 10];
      a.stacks.chill = arr[i + 11];
      const col = anim === 'death' && !a.dead;
      if (col !== a.collapsed) { a.collapsed = col; this._listsDirty = true; }
    }
    if (this._listsDirty) { this._listsDirty = false; this._rebuildLists(); }
  }

  snapshot() {
    const out = [];
    for (const a of this.list) {
      if (a.dead) continue;
      out.push(a.id, Math.round(a.pos.x * 100), Math.round(a.pos.y * 100), Math.round(a.pos.z * 100), Math.round(a.yaw * 100),
        Math.round(clamp(a.hp / a.maxHp, 0, 1) * 1000), Math.max(0, ANIMS.indexOf(a.anim)), Math.round(a.progress * 100), a.mask,
        a.attack ? (a.def.attacks?.indexOf(a.attack) ?? -1) : -1, a.st.poison?.t > 0 ? a.st.poison.n : 0, a.st.chill?.t > 0 ? a.st.chill.n : 0);
    }
    return out;
  }

  // ------------------------------------------------------------- host AI
  _hostUpdate(a, dt) {
    const g = this.g;
    // statuses
    const S = a.st;
    let dotAcc = (a.dotAcc ?? 0) + dt;
    for (const k in S) if (S[k].t > 0) S[k].t -= dt;
    if (dotAcc >= 0.5) {
      dotAcc -= 0.5;
      let dot = 0;
      if (S.burn?.t > 0) dot += S.burn.dps * 0.5;
      if (S.bleed?.t > 0) dot += S.bleed.dps * 0.5;
      if (S.poison?.t > 0) dot += S.poison.dps * S.poison.n * 0.5;
      if (dot > 0) {
        this.damage(a, { dmg: dot, el: S.burn?.t > 0 ? 'fire' : S.poison?.t > 0 ? 'poison' : 'blood', src: a.lastHitBy, tag: 'dot' });
        g.onDotTick?.(a, dot);
        if (a.dead) return;
      }
    }
    a.dotAcc = dotAcc;
    // wet when standing in water
    if (!a.flying && a.pos.y < -0.2) S.wet = { t: 1.5 };
    // war-banner aura: empowers other foes nearby while the bearer lives
    if (a.def.aura && a.faction === 'enemy') {
      const R2 = a.def.aura.radius * a.def.aura.radius;
      for (const b of this._hostiles) if (b !== a && (b.pos.x - a.pos.x) ** 2 + (b.pos.z - a.pos.z) ** 2 < R2) b.st.empower = { t: 0.5 };
    }
    a.mask = statusMask(S);
    a.stacks.poison = S.poison?.t > 0 ? S.poison.n : 0;
    a.stacks.chill = S.chill?.t > 0 ? S.chill.n : 0;
    if (a.poiseT > 0) { a.poiseT -= dt; if (a.poiseT <= 0) a.poiseDmg = 0; }

    // summon lifetime
    if (a.life > 0) {
      a.life -= dt;
      if (a.life <= 0) { this.kill(a, 0, 'necrotic'); return; }
    }

    const mm = moveMult(a);
    const am = actMult(a);
    a.stateT += dt * Math.max(am, 0.0001) * (am === 0 ? 0 : 1);
    // knockback integration
    const kbl = Math.hypot(a.kb.x, a.kb.z);
    let mx = 0, mz = 0;
    if (kbl > 0.05) {
      mx += a.kb.x * dt; mz += a.kb.z * dt;
      const decay = Math.exp(-dt * 6);
      a.kb.x *= decay; a.kb.z *= decay;
    }

    if (a.brain) {
      const r = a.brain.update(dt, mm, am);
      if (r) { mx += r.x; mz += r.z; }
    } else {
      const m = this._ai(a, dt, mm, am);
      mx += m.x; mz += m.z;
    }

    // separation from other actors
    for (const b of this.list) {
      if (b === a || b.dead) continue;
      const dx = a.pos.x - b.pos.x, dz = a.pos.z - b.pos.z;
      const rr = a.radius + b.radius;
      const d2 = dx * dx + dz * dz;
      if (d2 < rr * rr && d2 > 1e-6) {
        const d = Math.sqrt(d2);
        const push = (rr - d) * (b.boss ? 1 : 0.5) * Math.min(1, dt * 10);
        mx += dx / d * push; mz += dz / d * push;
      }
    }
    // keep out of players
    for (const p of g.allPlayers()) {
      if (!p.alive || p.dead) continue;
      const dx = a.pos.x - p.pos.x, dz = a.pos.z - p.pos.z;
      // shields and big weapons stick out past the body radius: keep those further from the camera
      const rr = a.radius + (a.def.frontShield || a.boss || (a.def.cost ?? 0) >= 8 || a.def.splitInto || a.def.model === 'slime' ? 0.85 : 0.4);
      const d2 = dx * dx + dz * dz;
      if (d2 < rr * rr) {
        const d = Math.sqrt(d2);
        const nx = d > 1e-3 ? dx / d : -Math.sin(a.yaw), nz = d > 1e-3 ? dz / d : -Math.cos(a.yaw);
        mx += nx * (rr - d) * 0.5; mz += nz * (rr - d) * 0.5;
      }
    }
    if (mx || mz) {
      // spirits (def.phase) drift straight through walls and pillars
      let r = a.def.phase ? { x: a.pos.x + mx, z: a.pos.z + mz } : g.collision.move(a.pos.x, a.pos.z, a.pos.y, mx, mz, Math.min(a.radius, 0.9));
      // sentries are leashed to their room, so doors never lock them out of their own fight
      if (a.homeRoom && g.level.roomAt(r.x, r.z) !== a.homeRoom) r = { x: a.pos.x, z: a.pos.z };
      a.moveSpeed = Math.hypot(r.x - a.pos.x, r.z - a.pos.z) / dt;
      a.pos.x = r.x; a.pos.z = r.z;
    } else a.moveSpeed = 0;
    const gy = g.groundY(a.pos.x, a.pos.z);
    a.pos.y += (gy - a.pos.y) * Math.min(1, dt * 12);
    a.progress = this._progress(a);
  }

  _progress(a) {
    const at = a.attack;
    switch (a.state) {
      case 'windup': return Math.min(1, a.stateT / (at?.windup ?? 0.5));
      case 'attack': return Math.min(1, a.stateT / 0.35);
      case 'recover': return 1;
      case 'spawn': return Math.min(1, a.stateT / 0.9);
      case 'stagger': return Math.min(1, a.stateT / 0.4);
      case 'collapsed': return 1;
      default: return 0;
    }
  }

  _pickTarget(a) {
    const g = this.g;
    let best = null, bd = Infinity;
    const consider = (t, pos, isPlayer) => {
      const dx = pos.x - a.pos.x, dz = pos.z - a.pos.z;
      let d = Math.hypot(dx, dz);
      if (isPlayer && t.id === a.lastHitBy) d *= 0.7; // aggro on attacker
      if (d < bd) { bd = d; best = t; }
    };
    if (a.faction === 'enemy') {
      for (const p of g.allPlayers()) if (p.alive && !p.dead && !p.downed) consider(p, p.pos, true);
      for (const al of this._allies) consider(al, al.pos, false);
      if (!best) for (const p of g.allPlayers()) if (p.downed) consider(p, p.pos, true);
    } else {
      for (const e of this._hostiles) consider(e, e.pos, false);
      if (!best) {
        // follow owner
        const owner = g.playerById(a.owner);
        if (owner) return { follow: owner };
      }
    }
    return best;
  }

  _ai(a, dt, mm, am) {
    const g = this.g;
    const def = a.def;
    const out = { x: 0, z: 0 };
    for (const k in a.cds) a.cds[k] -= dt * am;

    if (a.dormant) {
      a.anim = 'idle';
      // lurkers (mimics) lie perfectly still and wake only when struck or opened
      if (def.lurk) return out;
      // sentries glance about; they notice a player who comes close or into plain view
      a.yaw += Math.sin(g.time * 0.4 + a.id) * dt * 0.15;
      a.dormantT = (a.dormantT ?? 0) - dt;
      if (a.wakeAt && g.time >= a.wakeAt) this.wake(a);
      else if (a.dormantT <= 0) {
        a.dormantT = 0.25;
        const A = g.director.active;
        if (A && a.homeRoom && A.room === a.homeRoom && A.t > 8) this.wake(a);
        for (const p of g.allPlayers()) {
          if (!p.alive || p.dead) continue;
          const d = Math.hypot(p.pos.x - a.pos.x, p.pos.z - a.pos.z);
          if (d < 4 || (d < 11 && g.collision.los(a.pos.x, a.pos.y + a.height * 0.8, a.pos.z, p.pos.x, p.pos.y + 1.4, p.pos.z))) { this.wake(a); break; }
        }
      }
      return out;
    }

    if (a.state === 'spawn') {
      if (a.stateT > 0.9) this._setState(a, 'chase', 'idle');
      return out;
    }
    if (a.state === 'collapsed') {
      if (a.stateT > 3.0) {
        this._setState(a, 'spawn', 'spawn');
        a.collapsed = false;
        g.net?.broadcast({ t: 'rise', id: a.id });
        g.audio?.play('skeleton_rattle', { pos: a.pos });
        this._rebuildLists();
      }
      return out;
    }
    if (a.state === 'stagger') {
      if (a.stateT > 0.4) this._setState(a, 'chase', 'idle');
      return out;
    }

    a.retargetT -= dt;
    if (a.retargetT <= 0 || !a.target || a.target.dead || a.target.downed || (a.target.alive === false)) {
      a.target = this._pickTarget(a);
      a.retargetT = 0.8 + Math.random() * 0.6;
    }
    let tgt = a.target;
    if (!tgt) { a.anim = 'idle'; return out; }
    let follow = false;
    if (tgt.follow) { tgt = tgt.follow; follow = true; }
    const tp = tgt.pos;
    const dx = tp.x - a.pos.x, dz = tp.z - a.pos.z;
    const dist = Math.hypot(dx, dz);
    const tRad = tgt.radius ?? 0.4;
    const faceYaw = Math.atan2(dx, dz);
    const speed = def.speed * mm * (a.affix === 'hasted' ? 1.4 : 1) * a.speedMult * (a.mask & ST.empower ? 1.15 : 1);

    if (a.state === 'windup') {
      a.yaw = angleDamp(a.yaw, faceYaw, a.attack.kind === 'charge' ? 2 : 8, dt);
      if (a.attack.laser) this._laser(a);
      if (a.stateT >= a.attack.windup) this._strike(a, tgt, dist);
      return out;
    }
    if (a.state === 'attack') {
      // lunges / charges move during the attack phase
      if (a.leapT > 0) {
        a.leapT -= dt;
        out.x = a.leapV.x * dt; out.z = a.leapV.z * dt;
        if (a.attack.kind === 'charge') {
          // trail
          if (Math.random() < 0.5) g.vfx.smoke(_v.set(a.pos.x, a.pos.y + 0.3, a.pos.z), { count: 1, size: 0.6, color: [0.3, 0.25, 0.2], alpha: 0.4 });
        }
      }
      if (a.stateT > 0.35) this._setState(a, 'recover', 'idle');
      return out;
    }
    if (a.state === 'recover') {
      if (a.stateT > (a.attack?.recover ?? 0.6)) this._setState(a, 'chase', 'idle', null);
      return out;
    }

    // ---- chase / reposition
    a.yaw = angleDamp(a.yaw, faceYaw, 8, dt);
    if (!follow && am > 0) {
      // line of sight only when an attack that needs it is off cooldown (it was
      // marched every frame for every chasing enemy, mostly to be ignored)
      let los = null;
      for (const at of def.attacks ?? []) {
        if ((a.cds[at.id] ?? 0) > 0) continue;
        if (los === null && LOS_KINDS.has(at.kind)) los = g.collision.los(a.pos.x, a.pos.y + a.height * 0.7, a.pos.z, tp.x, tp.y + 1.2, tp.z);
        if (!this._canUse(a, at, dist, tRad, los)) continue;
        // ranged "fire tokens": only a couple of shooters wind up on one target at once,
        // so volleys stay readable and dodgeable
        if (a.faction === 'enemy' && RANGED_KINDS.has(at.kind) && this._rangedWindups(tgt, a) >= 2 + (g.floorIndex >= 3 ? 1 : 0)) continue;
        a.cds[at.id] = (at.cd ?? 0) * rand(0.85, 1.2);
        this._beginAttack(a, at, tgt);
        return out;
      }
    }
    // movement goal
    let wantDist = follow ? 3 : (tRad + a.radius + 0.6);
    const pref = def.range;
    if (pref && !follow) wantDist = pref[0] + (pref[1] - pref[0]) * 0.4;
    // melee "attack slots": only a few melee foes press one target at once; the rest circle and wait
    let waiting = false;
    if (!pref && !follow && a.faction === 'enemy' && !a.elite && !def.flank && dist < 7) {
      let engaged = 0;
      for (const b of this._hostiles) {
        if (b === a || b.target !== tgt || b.def.range) continue;
        if (b.state === 'windup' || b.state === 'attack' || b.pos.distanceTo(tp) < tRad + b.radius + 1.2) engaged++;
      }
      if (engaged >= 3) { waiting = true; wantDist = 4.5 + (a.id % 3); }
    }
    let moveDir = null;
    if (dist > wantDist) {
      // line of sight to the target, re-checked a few times a second per actor
      if (!(a._mvLosT > g.time) || a._mvLosTgt !== tgt) {
        a._mvLosT = g.time + 0.1 + Math.random() * 0.1; a._mvLosTgt = tgt;
        a._losMove = dist < 25 && g.collision.los(a.pos.x, a.pos.y + 0.8, a.pos.z, tp.x, tp.y + 0.8, tp.z);
      }
      const los = a._losMove && dist < 25;
      if (los) moveDir = { x: dx / dist, z: dz / dist };
      else {
        const f = this.pathing.field(tp.x, tp.z, g.time);
        if (f && this.pathing.dir(f, a.pos.x, a.pos.z, _dir)) moveDir = { x: _dir.x, z: _dir.z };
        else moveDir = { x: dx / dist, z: dz / dist };
      }
      // flankers circle around
      if (def.flank && dist < 8) {
        const side = (a.id % 2 ? 1 : -1);
        moveDir.x += -dz / dist * 0.6 * side; moveDir.z += dx / dist * 0.6 * side;
        const l = Math.hypot(moveDir.x, moveDir.z); moveDir.x /= l; moveDir.z /= l;
      }
    } else if (waiting) {
      const side = (a.id % 2 ? 1 : -1);
      moveDir = { x: -dz / dist * side * 0.6 - dx / dist * 0.2, z: dx / dist * side * 0.6 - dz / dist * 0.2 };
    } else if (pref && dist < pref[0]) {
      // kite away
      moveDir = { x: -dx / dist, z: -dz / dist };
      const side = Math.sin(g.time * 0.7 + a.id) > 0 ? 1 : -1;
      moveDir.x += -dz / dist * 0.5 * side; moveDir.z += dx / dist * 0.5 * side;
    } else if (pref) {
      // strafe while in range
      const side = Math.sin(g.time * 0.5 + a.id * 1.7) > 0 ? 1 : -1;
      moveDir = { x: -dz / dist * 0.5 * side, z: dx / dist * 0.5 * side };
    }
    if (moveDir) {
      out.x = moveDir.x * speed * dt; out.z = moveDir.z * speed * dt;
      a.anim = 'move';
      if (pref || follow) a.yaw = angleDamp(a.yaw, faceYaw, 8, dt);
      else a.yaw = angleDamp(a.yaw, Math.atan2(moveDir.x, moveDir.z), 10, dt);
    } else a.anim = 'idle';
    // ambient sounds
    if (Math.random() < dt * 0.15 && def.sound) g.audio?.play(def.sound, { pos: a.pos, volume: 0.45 });
    return out;
  }

  _rangedWindups(tgt, self) {
    let n = 0;
    for (const b of this._hostiles) if (b !== self && b.state === 'windup' && b.target === tgt && b.attack && RANGED_KINDS.has(b.attack.kind)) n++;
    return n;
  }

  _canUse(a, at, dist, tRad, los) {
    const reach = dist - tRad - a.radius;
    switch (at.kind) {
      case 'melee': return reach <= at.range - 0.3;
      case 'lunge': return reach <= at.range && reach >= (at.minRange ?? 0) && los;
      case 'charge': return dist < at.len * 0.9 && dist > 3 && los;
      case 'nova': return reach < at.radius * 0.7;
      case 'circle': return los && dist < 22 && (at.ahead ? reach < at.ahead + at.radius * 0.5 : true);
      case 'shoot': case 'lob': return los && dist < 26 && dist > 2.5;
      case 'heal':
        if (at.rally) return this._hostiles.filter((b) => b !== a && b.pos.distanceTo(a.pos) < at.radius).length >= 2;
        return this._hostiles.some((b) => b !== a && b.hp < b.maxHp * 0.75 && b.pos.distanceTo(a.pos) < at.radius);
      case 'summon': return this._hostiles.length < 14;
      case 'blink': return (dist < 4 || dist > 18) && Math.random() < 0.5;
      default: return false;
    }
  }

  _beginAttack(a, at, tgt) {
    const g = this.g;
    this._setState(a, 'windup', at.anim === 'cast' || at.kind === 'heal' || at.kind === 'summon' ? 'cast' : 'windup', at);
    a.attackType = at.anim ?? 'swing';
    a.atkTarget = { x: tgt.pos.x, y: tgt.pos.y, z: tgt.pos.z };
    const dmg = a.dmg * (at.dmgMult ?? 1) * (a.mask & ST.empower ? 1.3 : 1);
    const yaw = Math.atan2(tgt.pos.x - a.pos.x, tgt.pos.z - a.pos.z);
    a.yaw = yaw;
    // telegraphs are broadcast now so they resolve at the strike moment
    if (at.kind === 'nova') {
      g.broadcastHazard({ shape: 'circle', x: a.pos.x, y: a.pos.y, z: a.pos.z, r: at.radius, delay: at.windup, dmg, el: at.el ?? 'enemy', st: at.st, kb: 10, vis: 1, src: a.id });
    } else if (at.kind === 'circle') {
      const n = at.count ?? 1;
      for (let i = 0; i < n; i++) {
        let cx = tgt.pos.x, cz = tgt.pos.z;
        if (at.ahead) { cx = a.pos.x + Math.sin(yaw) * at.ahead; cz = a.pos.z + Math.cos(yaw) * at.ahead; }
        if (i > 0) { cx += rand(-4, 4); cz += rand(-4, 4); }
        g.broadcastHazard({ shape: 'circle', x: cx, y: g.groundY(cx, cz), z: cz, r: at.radius, delay: at.windup, dmg, el: at.el ?? 'enemy', st: at.st, kb: 6, vis: 1, src: a.id, fx: at.el ?? 'enemy' });
      }
    } else if (at.kind === 'charge') {
      g.broadcastHazard({ shape: 'rect', x: a.pos.x, y: a.pos.y, z: a.pos.z, rot: yaw, len: at.len, w: at.width, delay: at.windup + 0.25, dmg, el: 'physical', kb: 14, vis: 1, src: a.id, teleDur: at.windup });
    }
    if (at.kind === 'heal' || at.kind === 'summon') g.audio?.play('enemy_cast', { pos: a.pos });
    else if (at.windup >= 0.7) g.audio?.play('telegraph', { pos: a.pos, volume: 0.6 });
  }

  _strike(a, tgt, dist) {
    const g = this.g;
    const at = a.attack;
    const dmg = a.dmg * (at.dmgMult ?? 1) * (a.affix === 'vampiric' ? 1 : 1);
    this._setState(a, 'attack', at.kind === 'heal' || at.kind === 'summon' || at.kind === 'shoot' && at.anim === 'cast' ? 'cast' : 'attack', at);
    const fx = Math.sin(a.yaw), fz = Math.cos(a.yaw);
    if (a.faction === 'ally') {
      // summons strike enemies directly (host-side)
      if (at.kind === 'lunge') { const leap = at.leap ?? 6; a.leapT = 0.2; a.leapV = { x: fx * leap * 2, z: fz * leap * 2 }; }
      const reach = (at.range ?? 2) + a.radius + 0.4;
      g.spells.after(0.1, () => {
        for (const e of this._hostiles) {
          const dx = e.pos.x - a.pos.x, dz = e.pos.z - a.pos.z;
          const d = Math.hypot(dx, dz);
          if (d > reach + e.radius) continue;
          if (d > 0.5 && (dx * fx + dz * fz) / d < Math.cos(at.arc ?? 1.4)) continue;
          this.damage(e, { dmg, el: at.el ?? 'physical', st: at.st, kb: 4, kbDir: [dx / (d || 1), dz / (d || 1)], src: a.owner });
          g.vfx.impact(new THREE.Vector3(e.pos.x, e.pos.y + e.height * 0.5, e.pos.z), 'physical', 0.6);
        }
      });
      g.audio?.play('swing', { pos: a.pos, volume: 0.5 });
      return;
    }
    switch (at.kind) {
      case 'melee':
        g.broadcastHazard({ shape: 'arc', x: a.pos.x, y: a.pos.y, z: a.pos.z, r: at.range + a.radius, rot: a.yaw, angle: at.arc * 0.5, delay: 0.08, dmg, el: at.el ?? 'physical', st: at.st, kb: at.kb ?? 5, vis: 0, src: a.id });
        g.audio?.play('swing', { pos: a.pos, volume: 0.7 });
        break;
      case 'lunge': {
        const leap = at.leap ?? 6;
        a.leapT = 0.22; a.leapV = { x: fx * leap / 0.22 * 0.6, z: fz * leap / 0.22 * 0.6 };
        const land = Math.min(dist, leap * 0.6 * 0.22 * (1 / 0.22) * 0.22 + 0.5);
        g.broadcastHazard({ shape: 'arc', x: a.pos.x + fx * land, y: a.pos.y, z: a.pos.z + fz * land, r: at.range * 0.6 + a.radius, rot: a.yaw, angle: at.arc * 0.5, delay: 0.18, dmg, el: at.el ?? 'physical', st: at.st, kb: 4, vis: 0, src: a.id });
        g.audio?.play('swing', { pos: a.pos, volume: 0.6 });
        break;
      }
      case 'charge':
        a.leapT = at.len / at.speed; a.leapV = { x: fx * at.speed, z: fz * at.speed };
        g.audio?.play('boss_roar', { pos: a.pos, volume: 0.4 });
        break;
      case 'nova':
        g.vfx.addShake(0.15);
        g.audio?.play('boss_slam', { pos: a.pos, volume: 0.7 });
        break;
      case 'circle':
        break;
      case 'shoot': {
        const muzzle = this.muzzlePos(a);
        const tY = tgt.pos.y + 1.1;
        const n = at.count ?? 1;
        for (let i = 0; i < n; i++) {
          const spread = n > 1 ? (i / (n - 1) - 0.5) * (at.spread ?? 0.2) * 2 : 0;
          // lead the target a little
          const lead = (tgt.vel ? 0.25 : 0);
          const tx = tgt.pos.x + (tgt.vel?.x ?? 0) * lead, tz = tgt.pos.z + (tgt.vel?.z ?? 0) * lead;
          const d = new THREE.Vector3(tx - muzzle.x, tY - muzzle.y, tz - muzzle.z).normalize();
          d.applyAxisAngle(new THREE.Vector3(0, 1, 0), spread);
          g.broadcastEnemyProjectile({ x: muzzle.x, y: muzzle.y, z: muzzle.z, vx: d.x * at.speed, vy: d.y * at.speed, vz: d.z * at.speed, el: at.el ?? 'enemy', dmg, mesh: at.mesh, homing: at.homing ?? 0, aoe: at.aoe ?? 0, st: at.st });
        }
        g.audio?.play('enemy_projectile', { pos: muzzle, volume: 0.6 });
        break;
      }
      case 'lob': {
        const muzzle = this.muzzlePos(a);
        const tx = tgt.pos.x, tz = tgt.pos.z;
        const flat = Math.hypot(tx - muzzle.x, tz - muzzle.z);
        const T = Math.max(0.5, flat / at.speed);
        const gr = 14;
        const vy = ((tgt.pos.y - muzzle.y) + 0.5 * gr * T * T) / T;
        g.broadcastEnemyProjectile({ x: muzzle.x, y: muzzle.y, z: muzzle.z, vx: (tx - muzzle.x) / T, vy, vz: (tz - muzzle.z) / T, el: at.el ?? 'enemyGreen', dmg, gravity: gr, pool: at.pool ? [at.pool.radius, at.pool.dur, at.pool.dps * g.director.dmgScale()] : null });
        g.audio?.play('enemy_projectile', { pos: muzzle, volume: 0.6 });
        break;
      }
      case 'heal':
        for (const b of this._hostiles) if (b.pos.distanceTo(a.pos) < at.radius) { this.heal(b, at.amount * g.director.hpScale() * 0.5, at.shield); g.net?.broadcast({ t: 'healfx', id: b.id, s: at.shield ? 1 : 0 }); }
        break;
      case 'summon':
        for (let i = 0; i < at.count; i++) {
          const ang = Math.random() * Math.PI * 2;
          const x = a.pos.x + Math.cos(ang) * 2.5, z = a.pos.z + Math.sin(ang) * 2.5;
          if (g.collision.cellBlocked(Math.floor(x / 2), Math.floor(z / 2), a.pos.y)) continue;
          g.director.spawnEnemy(at.type, x, z);
        }
        break;
      case 'blink': {
        for (let t = 0; t < 10; t++) {
          const ang = Math.random() * Math.PI * 2;
          const x = a.pos.x + Math.cos(ang) * at.dist, z = a.pos.z + Math.sin(ang) * at.dist;
          if (g.collision.cellBlocked(Math.floor(x / 2), Math.floor(z / 2), a.pos.y + 0.5)) continue;
          const room = g.level.roomAt(x, z);
          if (!room || room !== g.level.roomAt(a.pos.x, a.pos.z)) continue;
          g.net?.broadcast({ t: 'blinkfx', x: a.pos.x, y: a.pos.y, z: a.pos.z });
          this.blinkFx(a.pos);
          a.pos.x = x; a.pos.z = z;
          a.net.x = x; a.net.z = z;
          this.blinkFx(a.pos);
          break;
        }
        break;
      }
      default: break;
    }
  }

  blinkFx(p) {
    const g = this.g;
    g.vfx.burst(new THREE.Vector3(p.x, p.y + 1, p.z), { element: 'enemyPurple', count: 24, speed: 4, life: 0.6, size: 0.2, sprite: SPR.WISP });
    g.vfx.smoke(new THREE.Vector3(p.x, p.y + 1, p.z), { count: 4, color: [0.05, 0, 0.08], alpha: 0.6 });
    g.audio?.play('blink', { pos: p, volume: 0.6 });
  }

  muzzlePos(a) {
    const m = a.model?.muzzle;
    if (m) { m.updateWorldMatrix(true, false); return m.getWorldPosition(new THREE.Vector3()); }
    return new THREE.Vector3(a.pos.x + Math.sin(a.yaw) * a.radius, a.pos.y + a.height * 0.75, a.pos.z + Math.cos(a.yaw) * a.radius);
  }

  _laser(a) {
    const g = this.g;
    const t = a.atkTarget ?? (a.target?.pos);
    if (!t) return;
    const m = this.muzzlePos(a);
    const end = new THREE.Vector3(t.x, (t.y ?? 0) + 1.1, t.z);
    // aimed at us: stop short of the camera so the sight line never floods the view
    const cam = g.renderer.camera.position;
    if (end.distanceTo(cam) < 1.5) {
      const d = m.distanceTo(end);
      if (d > 2.5) end.lerp(m, 2 / d);
    }
    if (!a._laserBeam) {
      a._laserBeam = g.vfx.beam({ color: [1.2, 0.06, 0.03], core: [1.3, 0.25, 0.12], width: 0.012, noise: 0 });
      a._laserEnd = g.time + ((a.attackDef ?? a.attack)?.windup ?? 0.8);
    }
    a._laserBeam.alpha = 0.5 + 0.5 * Math.sin(g.time * 30);
    a._laserBeam.update(m, end, 0.012);
  }
}
