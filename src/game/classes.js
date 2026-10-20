import * as THREE from 'three';
import { SPR } from '../render/particles.js';
import { fxOf } from '../render/vfx.js';
import { rand } from '../core/rng.js';
import { CLASS_META } from './classMeta.js';

// ---------------------------------------------------------------------------
// Class kits. Each spell is code: cast(ctx) uses the caster context (see
// caster.js) which works identically for local casts (deal damage) and remote
// replays (visuals only).
//
// Spell fields:
//   name, desc, icon, cd (s), charges, mode: 'auto' (hold to repeat every
//   `rate` s) | 'tap' | 'channel' | 'aim', style (viewmodel anim), hand,
//   cast(ctx) | channel {max, tick, start(ctx,S), update(ctx,S,dt), end(ctx,S)}
// ---------------------------------------------------------------------------

const v3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const tmp = new THREE.Vector3();

// small helper: hold-to-channel beam that damages the first enemy it touches
function beamChannel({ el, range, width, dmg, interval = 0.1, st, heal = 0, allyHeal = 0, pierce = false, sound, max = 4, onTickHit }) {
  return {
    max,
    start(ctx, S) {
      S.beam = ctx.vfx.beam({ element: el, width });
      S.acc = 0;
      S.snd = ctx.loop(sound ?? 'loop_channel');
      S.end = v3();
    },
    update(ctx, S, dt) {
      const o = ctx.origin, d = ctx.dir;
      const { hits, wall } = ctx.rt.rayActors(o, d, range, width * 0.8);
      let len = wall;
      if (!pierce && hits.length) len = hits[0].t;
      S.end.copy(o).addScaledVector(d, len);
      S.beam.alpha = 0.85 + Math.sin(ctx.time * 40) * 0.15;
      S.beam.update(o, S.end, width * (0.9 + Math.random() * 0.2));
      // impact sparks at the end
      ctx.vfx.burst(S.end, { element: el, count: 2, speed: 4, life: 0.3, size: 0.08, stretch: 0.04, drag: 3 });
      if (Math.random() < 0.3) ctx.vfx.P.glow({ x: S.end.x, y: S.end.y, z: S.end.z, r: fxOf(el).core[0], g: fxOf(el).core[1], b: fxOf(el).core[2], life: 0.08, size: width * 6, sprite: SPR.GLOW });
      ctx.lightAt(S.end, fxOf(el).light, 8, 6);
      ctx.lightAt(tmp.copy(o).addScaledVector(d, Math.min(len, 3)), fxOf(el).light, 5, 5);
      S.snd?.setPos(o);
      S.acc += dt;
      while (S.acc >= interval) {
        S.acc -= interval;
        const targets = pierce ? hits.filter((h) => h.t <= len) : hits.slice(0, 1);
        for (const h of targets) {
          ctx.hit(h.actor, { dmg, el, st, tag: 'beam' }, h.point);
          if (heal) ctx.healSelf(dmg * heal);
          onTickHit?.(ctx, h.actor);
        }
        if (allyHeal) ctx.healAlliesOnRay(o, d, len, allyHeal);
      }
    },
    end(ctx, S) {
      S.beam?.release(0.15);
      S.snd?.stop(0.15);
    },
  };
}

function coneChannel({ el, range, angle, dmg, interval = 0.12, st, sound, max = 3 }) {
  return {
    max,
    start(ctx, S) { S.acc = 0; S.snd = ctx.loop(sound); },
    update(ctx, S, dt) {
      const o = ctx.origin, d = ctx.dir;
      const fx = fxOf(el);
      // stream of flames
      for (let i = 0; i < 6; i++) {
        const sx = d.x + rand(-1, 1) * angle * 0.5, sy = d.y + rand(-1, 1) * angle * 0.35, sz = d.z + rand(-1, 1) * angle * 0.5;
        const sp = range * rand(1.3, 1.8);
        ctx.vfx.P.glow({ x: o.x, y: o.y, z: o.z, vx: sx * sp, vy: sy * sp, vz: sz * sp, r: fx.core[0], g: fx.core[1], b: fx.core[2], r2: fx.end[0], g2: fx.end[1], b2: fx.end[2], life: rand(0.35, 0.55), size: 0.15, size2: 1.4, sprite: SPR.FLAME, drag: 2.2, spin: rand(-3, 3) });
      }
      if (Math.random() < 0.5) ctx.vfx.P.solid({ x: o.x + d.x * range * 0.7, y: o.y + 0.3, z: o.z + d.z * range * 0.7, vx: d.x * 2, vy: 1.2, vz: d.z * 2, r: 0.06, g: 0.05, b: 0.04, a: 0.35, life: 1.6, size: 0.6, size2: 2, sprite: SPR.SMOKE, drag: 1 });
      ctx.lightAt(tmp.copy(o).addScaledVector(d, range * 0.5), fx.light, 22, 10);
      S.snd?.setPos(o);
      S.acc += dt;
      while (S.acc >= interval) {
        S.acc -= interval;
        for (const a of ctx.rt.inCone(o, d, range, angle)) ctx.hit(a, { dmg, el, st, tag: 'cone' }, v3(a.pos.x, a.pos.y + a.height * 0.5, a.pos.z));
      }
    },
    end(ctx, S) { S.snd?.stop(0.2); },
  };
}

// ======================================================================
export const CLASSES = {
  // ------------------------------------------------------------------ PYROMANCER
  pyromancer: {
    hp: 100, speed: 1.0, role: 'Burst Damage', difficulty: 1,
    blurb: 'Hurls fire that sets enemies ablaze. Burning foes take bonus damage and erupt when they die.',
    passive: { name: 'Kindling', desc: 'Deal +20% damage to Burning enemies. Burning enemies explode on death.' },
    stats: { vs: { burn: 0.2 }, burnExplode: true },
    spells: {
      primary: {
        name: 'Fire Bolt', icon: 'bolt', desc: 'Rapid bolts of flame that ignite enemies.', mode: 'auto', rate: 0.3, style: 'flick', hand: 'right',
        cast(ctx) {
          ctx.sound('cast_fire', 0.7);
          ctx.fan(1, 2.5, (dir) => ctx.proj({ el: 'fire', vel: dir.multiplyScalar(48), radius: 0.18, life: 1.6, core: 0.55, light: 7,
            hit: { dmg: 15, el: 'fire', st: { burn: [3, 4] } }, aoe: { radius: 1.4, dmg: 5, el: 'fire', vfx: false, sound: false },
            onExpire: (p, pos) => ctx.vfx.impact(pos, 'fire', 0.9) }));
          ctx.muzzle('fire');
        },
      },
      secondary: {
        name: "Dragon's Breath", icon: 'flame', desc: 'Channel a roaring cone of fire. Max 3s.', mode: 'channel', cd: 5, style: 'channel', hand: 'left',
        channel: coneChannel({ el: 'fire', range: 7, angle: 0.42, dmg: 5, st: { burn: [3, 5] }, sound: 'loop_beam_fire', max: 3 }),
      },
      ability1: {
        name: 'Fireball', icon: 'fireball', desc: 'A massive fireball that explodes and leaves the ground burning.', cd: 7, style: 'thrust', hand: 'both',
        cast(ctx) {
          ctx.sound('cast_fire_big');
          ctx.proj({ el: 'fire', vel: ctx.dir.clone().multiplyScalar(24), radius: 0.5, life: 3, core: 1.6, mesh: 'orb', meshScale: 1.4, light: 18, trail: 2.2,
            hit: { dmg: 40, el: 'fire', st: { burn: [4, 6] } }, aoe: { radius: ctx.aoe(4.5), dmg: 55, el: 'fire', st: { burn: [4, 6] }, kb: 9 },
            onExpire: (p, pos) => {
              const gy = ctx.groundAt(pos.x, pos.z);
              ctx.zone({ pos: v3(pos.x, gy, pos.z), radius: ctx.aoe(3.2), life: 3.5, interval: 0.35, el: 'fire', dmg: 6, st: { burn: [2, 5] }, flames: true });
            } });
          ctx.muzzle('fire', 1.8);
          ctx.kick(0.15, 2);
        },
      },
      ability2: {
        name: 'Blazing Step', icon: 'dash', desc: 'Dash forward, leaving a trail of fire.', cd: 6, style: 'snap', hand: 'left',
        cast(ctx) {
          ctx.sound('dash');
          ctx.sound('cast_fire');
          const start = ctx.casterPos();
          ctx.dash(9, 0.22, { invuln: 0.3 });
          const dir = ctx.flatDir();
          for (let i = 0; i < 6; i++) {
            const p = v3(start.x + dir.x * i * 1.6, ctx.groundAt(start.x + dir.x * i * 1.6, start.z + dir.z * i * 1.6), start.z + dir.z * i * 1.6);
            ctx.after(i * 0.035, () => ctx.zone({ pos: p, radius: 1.3, life: 3, interval: 0.3, el: 'fire', dmg: 5, st: { burn: [2, 4] }, flames: true }));
          }
        },
      },
      ultimate: {
        name: 'Meteor Storm', icon: 'meteor', desc: 'Call down a storm of meteors at the target area.', cost: 100, style: 'raise', hand: 'both',
        cast(ctx) {
          ctx.sound('cast_fire_big', 1.2);
          const c = ctx.aimPoint.clone();
          const R = ctx.aoe(7);
          ctx.vfx.decal(v3(c.x, ctx.groundAt(c.x, c.z), c.z), 'glyph', R * 2.2, 3.5, 0xff6020);
          for (let i = 0; i < 10; i++) {
            ctx.after(0.25 + i * 0.28, () => {
              const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * R;
              const tx = c.x + Math.cos(a) * r, tz = c.z + Math.sin(a) * r;
              const ty = ctx.groundAt(tx, tz);
              const start = v3(tx - 6, ty + 22, tz - 3);
              const vel = v3(tx, ty, tz).sub(start).normalize().multiplyScalar(32);
              ctx.vfx.telegraph(v3(tx, ty, tz), { radius: 3, dur: 0.7, color: [2.5, 0.8, 0.1] });
              ctx.proj({ el: 'fire', pos: start, vel, radius: 0.8, life: 3, core: 2.4, mesh: 'meteor', light: 25, trail: 3, noWallUntilGround: true,
                hit: { dmg: 30, el: 'fire' }, aoe: { radius: 3.2, dmg: 60, el: 'fire', st: { burn: [4, 8] }, kb: 10 } });
            });
          }
          ctx.kick(0.25, 4);
        },
      },
    },
  },

  // ------------------------------------------------------------------ CRYOMANCER
  cryomancer: {
    hp: 110, speed: 1.0, role: 'Control', difficulty: 2,
    blurb: 'Chills and freezes enemies, then shatters them. Frozen enemies take massive damage from shards.',
    passive: { name: 'Permafrost', desc: 'Deal +25% damage to Chilled enemies. Shards shatter Frozen enemies for 2.5x damage.' },
    stats: { vs: { chill: 0.25, frozen: 0.25 } },
    spells: {
      primary: {
        name: 'Ice Shards', icon: 'shards', desc: 'A volley of piercing shards that Chill.', mode: 'auto', rate: 0.42, style: 'flick', hand: 'right',
        cast(ctx) {
          ctx.sound('cast_frost', 0.7);
          ctx.fan(3, 5, (dir) => ctx.proj({ el: 'frost', vel: dir.multiplyScalar(52), radius: 0.12, life: 1.2, core: 0.35, mesh: 'shard', light: 3, trail: 0.6, pierce: 1,
            hit: { dmg: 8, el: 'frost', st: { chill: 1 }, tag: 'shard' } }));
          ctx.muzzle('frost');
        },
      },
      secondary: {
        name: 'Frost Ray', icon: 'beam', desc: 'Channel a freezing ray. Builds Chill rapidly until the target Freezes.', mode: 'channel', cd: 4, style: 'channel', hand: 'right',
        channel: beamChannel({ el: 'frost', range: 20, width: 0.12, dmg: 4, interval: 0.1, st: { chill: 0.35 }, sound: 'loop_beam_frost', max: 4 }),
      },
      ability1: {
        name: 'Frost Nova', icon: 'nova', desc: 'Freeze all nearby enemies solid.', cd: 9, style: 'slam', hand: 'both',
        cast(ctx) {
          ctx.sound('cast_frost_big');
          ctx.sound('freeze');
          const p = ctx.casterPos();
          const R = ctx.aoe(6.5);
          ctx.vfx.ring(v3(p.x, p.y, p.z), R, fxOf('frost').core, 0.6, 0.3);
          ctx.vfx.shell(v3(p.x, p.y + 1, p.z), { element: 'frost', radius: R, life: 0.45 });
          ctx.vfx.decal(p, 'frost', R * 2, 6);
          for (let i = 0; i < 40; i++) {
            const a = (i / 40) * Math.PI * 2;
            ctx.vfx.P.glow({ x: p.x, y: p.y + 0.3, z: p.z, vx: Math.cos(a) * R * 2, vy: rand(0, 2), vz: Math.sin(a) * R * 2, r: 2, g: 2.6, b: 3, life: 0.6, size: 0.25, sprite: SPR.SHARD, drag: 3, spin: 4 });
          }
          ctx.area(v3(p.x, p.y + 1, p.z), R, { dmg: 25, el: 'frost', st: { freeze: 2.5 }, kb: 3 });
          ctx.kick(0.2, 3);
        },
      },
      ability2: {
        name: 'Glacial Spike', icon: 'spike', desc: 'A huge piercing icicle. Shatters Frozen enemies.', cd: 6, style: 'thrust', hand: 'right',
        cast(ctx) {
          ctx.sound('cast_frost_big');
          ctx.proj({ el: 'frost', vel: ctx.dir.clone().multiplyScalar(40), radius: 0.35, life: 2, core: 0.8, mesh: 'bigShard', light: 10, trail: 1.6, pierce: 4,
            hit: { dmg: 55, el: 'frost', st: { chill: 2 }, tag: 'shard', kb: 6 } });
          ctx.muzzle('frost', 1.5);
          ctx.kick(0.12, 2);
        },
      },
      ultimate: {
        name: 'Blizzard', icon: 'storm', desc: 'A raging blizzard at the target area that freezes everything within.', cost: 100, style: 'raise', hand: 'both',
        cast(ctx) {
          ctx.sound('cast_frost_big', 1.2);
          const c = ctx.aimPoint.clone();
          c.y = ctx.groundAt(c.x, c.z);
          const R = ctx.aoe(8.5);
          ctx.vfx.decal(c, 'frost', R * 2.2, 8);
          ctx.zone({ pos: c, radius: R, life: 6, interval: 0.25, el: 'frost', dmg: 7, st: { chill: 1 },
            visual: (z, dt) => {
              for (let i = 0; i < 14; i++) {
                const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * z.radius;
                ctx.vfx.P.glow({ x: z.pos.x + Math.cos(a) * r - 3, y: z.pos.y + 9, z: z.pos.z + Math.sin(a) * r, vx: 6, vy: -14, vz: rand(-1, 1), r: 1.8, g: 2.3, b: 3, life: 0.65, size: 0.12, sprite: i % 3 ? SPR.SNOW : SPR.SHARD, stretch: 0.03, spin: 3 });
              }
              if (Math.random() < dt * 6) ctx.vfx.smoke(v3(z.pos.x + rand(-1, 1) * z.radius * 0.7, z.pos.y + 0.5, z.pos.z + rand(-1, 1) * z.radius * 0.7), { count: 1, size: 2, color: [0.6, 0.7, 0.8], alpha: 0.25, life: 2.5, speed: 3 });
              ctx.lightAt(v3(z.pos.x, z.pos.y + 3, z.pos.z), 0x80c8ff, 14, z.radius * 1.6);
            } });
          ctx.kick(0.2, 3);
        },
      },
    },
  },

  // ------------------------------------------------------------------ STORMCALLER
  stormcaller: {
    hp: 95, speed: 1.06, role: 'Chain AoE', difficulty: 2,
    blurb: 'Lightning arcs between enemies. Wet foes conduct even more devastating chains.',
    passive: { name: 'Conductor', desc: 'Lightning chains to +1 extra target. Moving builds static: every 6m travelled empowers your next bolt (+50%).' },
    stats: { chainBonus: 1 },
    spells: {
      primary: {
        name: 'Chain Lightning', icon: 'lightning', desc: 'Instant bolt that arcs to nearby enemies.', mode: 'auto', rate: 0.4, style: 'flick', hand: 'right',
        cast(ctx) {
          ctx.sound('cast_lightning', 0.7);
          const o = ctx.origin.clone();
          const { hits, wall } = ctx.rt.rayActors(o, ctx.dir, 32, 0.35);
          const end = hits.length ? hits[0].point : o.clone().addScaledVector(ctx.dir, wall);
          ctx.vfx.lightning(o, end, { element: 'lightning', life: 0.12, branches: 1 });
          ctx.vfx.impact(end, 'lightning', 0.7);
          ctx.muzzle('lightning');
          const empowered = ctx.consumeStatic?.() ? 1.5 : 1;
          if (hits.length) {
            const chainN = 2 + (ctx.stats.chainBonus ?? 0);
            ctx.chain(hits[0].actor, end, { dmg: 13 * empowered, el: 'lightning', st: { shock: 3 } }, chainN, 7, 0.7);
          }
        },
      },
      secondary: {
        name: 'Ball Lightning', icon: 'orb', desc: 'A slow orb that zaps everything nearby, then detonates.', cd: 5, style: 'thrust', hand: 'left',
        cast(ctx) {
          ctx.sound('cast_lightning_big');
          ctx.proj({ el: 'lightning', vel: ctx.dir.clone().multiplyScalar(9), radius: 0.4, life: 4, core: 1.4, mesh: 'orb', light: 14, trail: 1.4, pierce: 99,
            aoe: { radius: ctx.aoe(3.5), dmg: 30, el: 'lightning', st: { shock: 3 } },
            data: { acc: 0 },
            onTick: (p, dt) => {
              p.data.acc += dt;
              if (Math.random() < 0.4) ctx.vfx.lightning(p.pos, p.pos.clone().add(v3(rand(-1.4, 1.4), rand(-1, 1), rand(-1.4, 1.4))), { life: 0.06, branches: 0, width: 0.04 });
              if (p.data.acc >= 0.25) {
                p.data.acc = 0;
                const t = ctx.rt.nearest(p.pos, ctx.aoe(5.5));
                if (t) {
                  const tp = v3(t.pos.x, t.pos.y + t.height * 0.5, t.pos.z);
                  ctx.vfx.lightning(p.pos, tp, { life: 0.1, branches: 0 });
                  ctx.hit(t, { dmg: 8, el: 'lightning', st: { shock: 2 } }, tp);
                  ctx.sound('impact_lightning', 0.4, tp);
                }
              }
            } });
        },
      },
      ability1: {
        name: 'Thunderclap', icon: 'nova', desc: 'Blast enemies away with a deafening clap, stunning them.', cd: 8, style: 'slam', hand: 'both',
        cast(ctx) {
          ctx.sound('cast_lightning_big'); ctx.sound('shockwave');
          const p = ctx.casterPos();
          const R = ctx.aoe(5.5);
          ctx.vfx.ring(p, R, fxOf('lightning').core, 0.4, 0.35);
          ctx.vfx.shell(v3(p.x, p.y + 1, p.z), { element: 'lightning', radius: R, life: 0.3 });
          for (let i = 0; i < 8; i++) {
            const a = (i / 8) * Math.PI * 2;
            ctx.vfx.lightning(v3(p.x, p.y + 1, p.z), v3(p.x + Math.cos(a) * R, p.y + rand(0, 2), p.z + Math.sin(a) * R), { life: 0.15, branches: 1 });
          }
          ctx.area(v3(p.x, p.y + 1, p.z), R, { dmg: 32, el: 'lightning', st: { stun: 1.0, shock: 3 }, kb: 14 });
          ctx.kick(0.3, 4);
        },
      },
      ability2: {
        name: 'Static Blink', icon: 'blink', desc: 'Teleport forward in a flash, shocking enemies at both ends.', cd: 5, style: 'snap', hand: 'left',
        cast(ctx) {
          ctx.sound('blink'); ctx.sound('cast_lightning');
          const a = ctx.casterPos().clone().add(v3(0, 1, 0));
          ctx.vfx.explosion(a, 'lightning', 2.5);
          ctx.area(a, ctx.aoe(3), { dmg: 22, el: 'lightning', st: { shock: 3 } });
          const b = ctx.blink(11);
          if (b) {
            b.y += 1;
            ctx.vfx.lightning(a, b, { life: 0.25, branches: 2, width: 0.14 });
            ctx.after(0.05, () => { ctx.vfx.explosion(b, 'lightning', 2.5); ctx.area(b, ctx.aoe(3), { dmg: 22, el: 'lightning', st: { shock: 3 } }); });
          }
        },
      },
      ultimate: {
        name: 'Tempest', icon: 'storm', desc: 'Summon a storm cloud that strikes enemies with lightning for 8s.', cost: 100, style: 'raise', hand: 'both',
        cast(ctx) {
          ctx.sound('cast_lightning_big', 1.2);
          const c = ctx.aimPoint.clone();
          c.y = ctx.groundAt(c.x, c.z);
          const R = ctx.aoe(11);
          ctx.zone({ pos: c, radius: R, life: 8, interval: 0.28,
            onTick: (z) => {
              const targets = ctx.rt.inRadius(z.pos, z.radius);
              const t = targets.length ? targets[Math.floor(Math.random() * targets.length)] : null;
              const tp = t ? v3(t.pos.x, t.pos.y + 0.2, t.pos.z) : v3(z.pos.x + rand(-1, 1) * z.radius, z.pos.y, z.pos.z + rand(-1, 1) * z.radius);
              ctx.vfx.lightning(v3(tp.x + rand(-2, 2), z.pos.y + 14, tp.z + rand(-2, 2)), tp, { life: 0.2, branches: 2, width: 0.16 });
              ctx.vfx.impact(tp, 'lightning', 1.2);
              ctx.vfx.decal(tp, 'scorch', 1.6, 5);
              ctx.sound('impact_lightning', 0.8, tp);
              if (t) ctx.area(tp, 2.2, { dmg: 38, el: 'lightning', st: { shock: 3 } });
            },
            visual: (z, dt) => {
              if (Math.random() < dt * 10) ctx.vfx.P.solid({ x: z.pos.x + rand(-1, 1) * z.radius, y: z.pos.y + 13, z: z.pos.z + rand(-1, 1) * z.radius, vx: rand(-0.5, 0.5), vz: rand(-0.5, 0.5), r: 0.05, g: 0.06, b: 0.1, a: 0.6, life: 3, size: 4, size2: 6, sprite: SPR.SMOKE, spin: 0.2 });
              ctx.lightAt(v3(z.pos.x, z.pos.y + 10, z.pos.z), 0x8090ff, 6 + (Math.random() < 0.1 ? 40 : 0), 30);
            } });
          ctx.kick(0.2, 3);
        },
      },
    },
  },

  // ------------------------------------------------------------------ ARCANIST
  arcanist: {
    hp: 95, speed: 1.0, role: 'Mobile Damage', difficulty: 1,
    blurb: 'Homing missiles, blinks and a devastating singularity. Every 4th volley echoes.',
    passive: { name: 'Arcane Echo', desc: 'Every 4th Arcane Missiles volley fires twice. Blink has 2 charges.' },
    stats: {},
    spells: {
      primary: {
        name: 'Arcane Missiles', icon: 'missiles', desc: 'Fire a burst of homing missiles.', mode: 'auto', rate: 0.5, style: 'flick', hand: 'right',
        cast(ctx) {
          ctx.sound('cast_arcane', 0.7);
          const count = 3 + (ctx.counter('missiles') % 4 === 3 ? 3 : 0);
          for (let i = 0; i < count; i++) {
            ctx.after(i * 0.06, () => {
              const d = ctx.dir.clone().add(v3(rand(-0.12, 0.12), rand(-0.05, 0.12), rand(-0.12, 0.12))).normalize();
              ctx.proj({ el: 'arcane', pos: ctx.origin.clone(), vel: d.multiplyScalar(30), radius: 0.15, life: 1.8, core: 0.45, light: 4, trail: 0.8, homing: 6,
                hit: { dmg: 8, el: 'arcane' } });
            });
          }
          ctx.muzzle('arcane');
        },
      },
      secondary: {
        name: 'Arcane Orb', icon: 'orb', desc: 'A slow orb that pierces everything and detonates at the end.', cd: 4, style: 'thrust', hand: 'left',
        cast(ctx) {
          ctx.sound('cast_arcane_big');
          ctx.proj({ el: 'arcane', vel: ctx.dir.clone().multiplyScalar(15), radius: 0.6, life: 1.6, core: 1.6, mesh: 'orb', meshScale: 1.3, light: 14, trail: 2, pierce: 99,
            hit: { dmg: 14, el: 'arcane', kb: 3 }, aoe: { radius: ctx.aoe(4), dmg: 32, el: 'arcane' },
            onTick: (p) => { if (Math.random() < 0.5) ctx.vfx.P.glow({ x: p.pos.x, y: p.pos.y, z: p.pos.z, vx: rand(-1, 1), vy: rand(-1, 1), vz: rand(-1, 1), r: 2, g: 1, b: 3, life: 0.6, size: 0.3, sprite: SPR.RUNE, drag: 2, spin: 2 }); } });
        },
      },
      ability1: {
        name: 'Blink', icon: 'blink', desc: 'Teleport a short distance. 2 charges.', cd: 4, charges: 2, style: 'snap', hand: 'left',
        cast(ctx) {
          ctx.sound('blink');
          const a = ctx.casterPos().clone().add(v3(0, 1, 0));
          ctx.vfx.burst(a, { element: 'arcane', count: 30, speed: 4, life: 0.6, size: 0.2, sprite: SPR.STAR, spin: 3 });
          ctx.vfx.shell(a, { element: 'arcane', radius: 1.2, life: 0.25 });
          const b = ctx.blink(9.5);
          if (b) { b.y += 1; ctx.vfx.burst(b, { element: 'arcane', count: 30, speed: 4, life: 0.6, size: 0.2, sprite: SPR.STAR, spin: 3 }); }
        },
      },
      ability2: {
        name: 'Prismatic Barrage', icon: 'barrage', desc: 'Unleash a torrent of seeking missiles.', cd: 10, style: 'thrust', hand: 'both',
        cast(ctx) {
          ctx.sound('cast_arcane_big');
          for (let i = 0; i < 16; i++) {
            ctx.after(i * 0.045, () => {
              const d = ctx.dir.clone().add(v3(rand(-0.6, 0.6), rand(0, 0.5), rand(-0.6, 0.6))).normalize();
              ctx.proj({ el: 'arcane', pos: ctx.origin.clone(), vel: d.multiplyScalar(24), radius: 0.18, life: 2.4, core: 0.6, light: 5, trail: 1, homing: 5, homingRange: 25,
                hit: { dmg: 12, el: 'arcane' } });
              if (i % 3 === 0) ctx.sound('cast_arcane', 0.4);
            });
          }
        },
      },
      ultimate: {
        name: 'Singularity', icon: 'vortex', desc: 'Hurl a collapsing star that drags enemies in, then detonates.', cost: 100, style: 'thrust', hand: 'both',
        cast(ctx) {
          ctx.sound('cast_arcane_big', 1.3);
          ctx.proj({ el: 'arcane', vel: ctx.dir.clone().multiplyScalar(22), radius: 0.5, life: 1.2, core: 2, mesh: 'orb', light: 20, trail: 2,
            onExpire: (p, pos) => {
              const c = pos.clone();
              c.y = Math.max(c.y, ctx.groundAt(c.x, c.z) + 1.5);
              const R = ctx.aoe(9);
              const hum = ctx.loop('loop_portal');
              hum?.setPos?.(c);
              ctx.after(3.5, () => hum?.stop?.(0.3));
              ctx.zone({ pos: c, radius: R, life: 3.5, interval: 0.25, el: 'arcane', dmg: 9, pull: 7,
                visual: (z, dt) => {
                  for (let i = 0; i < 8; i++) {
                    const a = Math.random() * Math.PI * 2, r = z.radius * rand(0.5, 1);
                    const px = z.pos.x + Math.cos(a) * r, pz = z.pos.z + Math.sin(a) * r, py = z.pos.y + rand(-1, 2);
                    ctx.vfx.P.glow({ x: px, y: py, z: pz, vx: (z.pos.x - px) * 2 + Math.cos(a + 1.5) * 4, vy: (z.pos.y - py) * 2, vz: (z.pos.z - pz) * 2 + Math.sin(a + 1.5) * 4, r: 2, g: 0.8, b: 3.2, life: 0.5, size: 0.12, stretch: 0.06, sprite: SPR.SPARK });
                  }
                  ctx.vfx.P.glow({ x: z.pos.x, y: z.pos.y, z: z.pos.z, r: 0.3, g: 0.1, b: 0.6, life: 0.1, size: 3 + Math.sin(z.age * 20) * 0.3, sprite: SPR.RING, rot: z.age * 4 });
                  ctx.lightAt(z.pos, 0xb050ff, 25, 14);
                },
                onEnd: (z) => {
                  ctx.vfx.explosion(z.pos, 'arcane', 6);
                  ctx.sound('explosion_big', 1, z.pos);
                  ctx.area(z.pos, ctx.aoe(6.5), { dmg: 120, el: 'arcane', kb: 16, falloff: true });
                } });
            } });
          ctx.kick(0.2, 3);
        },
      },
    },
  },

  // ------------------------------------------------------------------ NECROMANCER
  necromancer: {
    hp: 100, speed: 0.98, role: 'Summoner', difficulty: 2,
    blurb: 'Commands the restless dead. Raises skeletal servants and drains the life of the living.',
    passive: { name: 'Harvest', desc: 'Kills heal you for 2 HP and have a 25% chance to rise as a skeleton servant for 10s.' },
    stats: { killHeal: 2, raiseChance: 0.25 },
    spells: {
      primary: {
        name: 'Soul Bolt', icon: 'skull', desc: 'Seeking bolts of necrotic energy.', mode: 'auto', rate: 0.36, style: 'flick', hand: 'right',
        cast(ctx) {
          ctx.sound('cast_shadow', 0.6);
          ctx.fan(1, 2, (dir) => ctx.proj({ el: 'necrotic', vel: dir.multiplyScalar(34), radius: 0.18, life: 1.7, core: 0.6, light: 5, trail: 1.1, homing: 2.5,
            hit: { dmg: 14, el: 'necrotic' } }));
          ctx.muzzle('necrotic');
        },
      },
      secondary: {
        name: 'Life Drain', icon: 'drain', desc: 'Channel a beam that siphons health from the enemy.', mode: 'channel', cd: 5, style: 'channel', hand: 'left',
        channel: beamChannel({ el: 'necrotic', range: 15, width: 0.1, dmg: 4.5, interval: 0.1, heal: 0.35, sound: 'loop_beam_shadow', max: 4,
          onTickHit: (ctx, a) => { if (Math.random() < 0.5) ctx.vfx.P.glow({ x: a.pos.x, y: a.pos.y + a.height * 0.6, z: a.pos.z, vx: (ctx.origin.x - a.pos.x) * 2, vy: 1, vz: (ctx.origin.z - a.pos.z) * 2, r: 1, g: 3, b: 1, life: 0.5, size: 0.15, sprite: SPR.WISP }); } }),
      },
      ability1: {
        name: 'Raise Dead', icon: 'raise', desc: 'Raise 2 skeleton warriors to fight for you (20s).', cd: 12, style: 'raise', hand: 'both',
        cast(ctx) {
          ctx.sound('summon');
          const c = ctx.aimPoint.clone();
          for (let i = 0; i < 2; i++) {
            const p = v3(c.x + (i - 0.5) * 2, ctx.groundAt(c.x, c.z), c.z);
            ctx.vfx.decal(p, 'glyph', 2.4, 1.5, 0x60ff60);
            ctx.vfx.burst(p, { element: 'necrotic', count: 30, speed: 3, upward: 1, life: 1, size: 0.3, sprite: SPR.WISP });
            ctx.summon('skeletonMinion', p, 20);
          }
        },
      },
      ability2: {
        name: 'Bone Spear', icon: 'spear', desc: 'A spear of bone that impales everything in a line, causing Bleed.', cd: 6, style: 'thrust', hand: 'right',
        cast(ctx) {
          ctx.sound('cast_shadow_big');
          ctx.proj({ el: 'necrotic', vel: ctx.dir.clone().multiplyScalar(48), radius: 0.35, life: 1.4, core: 0.5, mesh: 'spear', light: 6, trail: 1.2, pierce: 99,
            hit: { dmg: 45, el: 'physical', st: { bleed: [4, 6] }, kb: 5 } });
          ctx.kick(0.1, 2);
        },
      },
      ultimate: {
        name: 'Army of the Dead', icon: 'army', desc: 'Raise six skeletons and unleash a wave of spectral death.', cost: 100, style: 'raise', hand: 'both',
        cast(ctx) {
          ctx.sound('cast_shadow_big', 1.2); ctx.sound('summon');
          const p = ctx.casterPos();
          const d = ctx.flatDir();
          for (let i = 0; i < 6; i++) {
            const a = (i / 6) * Math.PI * 2;
            const sp = v3(p.x + Math.cos(a) * 3, p.y, p.z + Math.sin(a) * 3);
            ctx.vfx.decal(sp, 'glyph', 2.2, 2, 0x60ff60);
            ctx.after(i * 0.1, () => ctx.summon('skeletonMinion', sp, 18));
          }
          for (let k = 0; k < 10; k++) {
            ctx.after(k * 0.07, () => {
              const c = v3(p.x + d.x * (2 + k * 1.6), p.y + 1, p.z + d.z * (2 + k * 1.6));
              ctx.vfx.burst(c, { element: 'necrotic', count: 18, speed: 3, upward: 1.5, life: 0.8, size: 0.5, sprite: SPR.WISP });
              ctx.vfx.smoke(c, { count: 2, color: [0.05, 0.15, 0.05], alpha: 0.5 });
              ctx.area(c, ctx.aoe(2.6), { dmg: 26, el: 'necrotic', kb: 4 });
            });
          }
        },
      },
    },
  },

  // ------------------------------------------------------------------ BLOOD MAGE
  bloodmage: {
    hp: 130, speed: 1.02, role: 'Risk & Reward', difficulty: 3,
    blurb: 'Spends their own life as fuel. Grows deadlier the closer they come to death, but heals by bleeding enemies.',
    passive: { name: 'Frenzy', desc: 'Below 40% HP deal +35% damage. All damage heals for 6% (lifesteal).' },
    stats: { lifesteal: 0.06, frenzy: 0.35 },
    spells: {
      primary: {
        name: 'Blood Lance', icon: 'drop', desc: 'Fast lances of blood that cause Bleeding.', mode: 'auto', rate: 0.28, style: 'flick', hand: 'left',
        cast(ctx) {
          ctx.sound('cast_blood', 0.6);
          ctx.fan(1, 1.5, (dir) => ctx.proj({ el: 'blood', vel: dir.multiplyScalar(50), radius: 0.15, life: 1.4, core: 0.45, light: 4, trail: 1,
            hit: { dmg: 14, el: 'blood', st: { bleed: [3, 3] } } }));
          ctx.muzzle('blood');
        },
      },
      secondary: {
        name: 'Crimson Scythe', icon: 'slash', desc: 'A wide sweeping slash. Costs 4 HP.', cd: 1.6, style: 'swing', hand: 'right',
        cast(ctx) {
          ctx.payHp(4);
          ctx.sound('cast_blade'); ctx.sound('cast_blood');
          const o = ctx.casterPos().clone().add(v3(0, 1.2, 0));
          const d = ctx.flatDir();
          ctx.slashFx(o, d, 'blood', 4.2);
          for (const a of ctx.rt.inCone(o, d, ctx.aoe(4.4), 1.0)) ctx.hit(a, { dmg: 32, el: 'blood', st: { bleed: [4, 5] }, kb: 6 }, v3(a.pos.x, a.pos.y + a.height * 0.5, a.pos.z));
        },
      },
      ability1: {
        name: 'Blood Pact', icon: 'pact', desc: 'Sacrifice 20% of current HP to gain +40% damage and attack speed for 6s.', cd: 14, style: 'snap', hand: 'left',
        cast(ctx) {
          ctx.payHp(ctx.hp() * 0.2);
          ctx.sound('cast_blood_big'); ctx.sound('buff');
          ctx.buff('bloodpact', 6, { dmgMult: 0.4, rateMult: 0.25 });
          const p = ctx.casterPos();
          ctx.vfx.burst(v3(p.x, p.y + 1, p.z), { element: 'blood', count: 50, speed: 5, life: 0.8, size: 0.12, sprite: SPR.DROP, gravity: 10 });
          ctx.vfx.ring(p, 3, fxOf('blood').core, 0.6);
        },
      },
      ability2: {
        name: 'Transfusion', icon: 'heart', desc: 'Rip life from all nearby enemies, healing you and allies.', cd: 10, style: 'raise', hand: 'both',
        cast(ctx) {
          ctx.sound('cast_blood_big');
          const p = ctx.casterPos();
          const R = ctx.aoe(8);
          const hits = ctx.rt.inRadius(p, R);
          ctx.vfx.ring(p, R, fxOf('blood').mid, 0.5);
          for (const a of hits) {
            const ap = v3(a.pos.x, a.pos.y + a.height * 0.5, a.pos.z);
            ctx.hit(a, { dmg: 22, el: 'blood', st: { bleed: [3, 4] } }, ap);
            for (let i = 0; i < 6; i++) ctx.vfx.P.glow({ x: ap.x, y: ap.y, z: ap.z, vx: (p.x - ap.x) * 1.6 + rand(-1, 1), vy: 2 + rand(0, 2), vz: (p.z - ap.z) * 1.6 + rand(-1, 1), r: 3, g: 0.2, b: 0.3, life: 0.6, size: 0.15, sprite: SPR.DROP, gravity: 4 });
          }
          ctx.healSelf(12 + hits.length * 6);
          ctx.healAllies(p, 14, 12 + hits.length * 4);
        },
      },
      ultimate: {
        name: 'Sanguine Nova', icon: 'nova', desc: 'Explode in a torrent of blood. Deals more damage the lower your HP.', cost: 100, style: 'slam', hand: 'both',
        cast(ctx) {
          ctx.sound('cast_blood_big', 1.3); ctx.sound('explosion_big');
          const p = ctx.casterPos();
          const missing = 1 - ctx.hp() / ctx.maxHp();
          const R = ctx.aoe(9);
          const pc = v3(p.x, p.y + 1, p.z);
          ctx.vfx.explosion(pc, 'blood', 7);
          ctx.vfx.shell(pc, { element: 'blood', radius: R, life: 0.5 });
          ctx.area(pc, R, { dmg: 70 + 160 * missing, el: 'blood', st: { bleed: [5, 8] }, kb: 12 });
          ctx.healSelf(25);
          ctx.kick(0.35, 5);
        },
      },
    },
  },

  // ------------------------------------------------------------------ CHRONOMANCER
  chronomancer: {
    hp: 100, speed: 1.0, role: 'Utility', difficulty: 3,
    blurb: 'Bends time itself: slows foes, plants time bombs, rewinds mistakes and stops the clock entirely.',
    passive: { name: 'Borrowed Time', desc: 'Kills grant Haste: +20% move speed and cooldown rate for 3s.' },
    stats: { hasteOnKill: true },
    spells: {
      primary: {
        name: 'Temporal Bolt', icon: 'clock', desc: 'Bolts that Slow enemies.', mode: 'auto', rate: 0.36, style: 'flick', hand: 'right',
        cast(ctx) {
          ctx.sound('cast_time', 0.6);
          ctx.fan(1, 2, (dir) => ctx.proj({ el: 'time', vel: dir.multiplyScalar(40), radius: 0.17, life: 1.6, core: 0.5, light: 5, trail: 1,
            hit: { dmg: 13, el: 'time', st: { slow: 1.6 } } }));
          ctx.muzzle('time');
        },
      },
      secondary: {
        name: 'Time Bomb', icon: 'bomb', desc: 'Lob a sticky bomb that detonates after 1.5s. 3 charges.', cd: 3.5, charges: 3, style: 'throw', hand: 'left',
        cast(ctx) {
          ctx.sound('cast_time');
          ctx.proj({ el: 'time', vel: ctx.dir.clone().multiplyScalar(22).add(v3(0, 4, 0)), gravity: 18, radius: 0.25, life: 1.8, core: 0.8, mesh: 'orb', light: 8, trail: 0.6, sticky: true,
            onHit: (p, a) => { if (a) { p.data.stuckTo = a; p.stuck = true; p.vel.set(0, 0, 0); } },
            onTick: (p) => {
              if (p.data.stuckTo && !p.data.stuckTo.dead) p.pos.set(p.data.stuckTo.pos.x, p.data.stuckTo.pos.y + p.data.stuckTo.height * 0.6, p.data.stuckTo.pos.z);
              const k = p.age / p.life;
              if (Math.random() < 0.3 + k) ctx.vfx.P.glow({ x: p.pos.x, y: p.pos.y, z: p.pos.z, r: 0.5, g: 3, b: 2.5, life: 0.15, size: 0.4 + k * 1.2, sprite: SPR.RING, rot: p.age * 8 });
            },
            aoe: { radius: ctx.aoe(3.6), dmg: 42, el: 'time', st: { slow: 2.5 }, tag: 'big' } });
        },
      },
      ability1: {
        name: 'Rewind', icon: 'rewind', desc: 'Return to where you were 3 seconds ago, restoring lost health.', cd: 14, style: 'raise', hand: 'left',
        cast(ctx) {
          ctx.sound('cast_time_big');
          const a = ctx.casterPos().clone().add(v3(0, 1, 0));
          ctx.vfx.burst(a, { element: 'time', count: 30, speed: 3, life: 0.8, size: 0.3, sprite: SPR.RING });
          const b = ctx.rewind(3);
          if (b) ctx.vfx.shell(v3(b.x, b.y + 1, b.z), { element: 'time', radius: 2, life: 0.4 });
        },
      },
      ability2: {
        name: 'Stasis Field', icon: 'stasis', desc: 'Create a field that nearly freezes time for enemies inside (4s).', cd: 12, style: 'thrust', hand: 'both',
        cast(ctx) {
          ctx.sound('cast_time_big');
          const c = ctx.aimPoint.clone(); c.y = ctx.groundAt(c.x, c.z);
          const R = ctx.aoe(6);
          ctx.vfx.decal(c, 'glyph', R * 2, 4, 0x40e0c8);
          const sh = ctx.vfx.shell(v3(c.x, c.y, c.z), { element: 'time', radius: R, follow: true });
          ctx.zone({ pos: c, radius: R, life: 4, interval: 0.25, el: 'time', dmg: 3, st: { slow: 0.6, stun: 0.3 },
            visual: (z) => { sh?.update(z.pos, 0.35); if (Math.random() < 0.4) ctx.vfx.P.glow({ x: z.pos.x + rand(-1, 1) * R * 0.7, y: z.pos.y + rand(0, 3), z: z.pos.z + rand(-1, 1) * R * 0.7, r: 0.5, g: 2.5, b: 2, life: 1.2, size: 0.2, sprite: SPR.STAR }); },
            onEnd: () => sh?.release() });
        },
      },
      ultimate: {
        name: 'Time Stop', icon: 'hourglass', desc: 'Freeze time around you for 4s. Your cooldowns recover twice as fast.', cost: 100, style: 'raise', hand: 'both',
        cast(ctx) {
          ctx.sound('cast_time_big', 1.4);
          const p = ctx.casterPos();
          const R = 28;
          ctx.vfx.shell(v3(p.x, p.y + 1, p.z), { element: 'time', radius: R, life: 0.8, alpha: 0.6 });
          ctx.vfx.ring(p, R, fxOf('time').core, 0.8, 0.05);
          ctx.area(v3(p.x, p.y + 1, p.z), R, { dmg: 10, el: 'time', st: { stun: 4, slow: 6 }, tag: 'big' });
          ctx.buff('timestop', 4, { cdRate: 1 });
          ctx.screenTint([0.6, 1.1, 1.05], 4);
        },
      },
    },
  },

  // ------------------------------------------------------------------ WARLOCK
  warlock: {
    hp: 100, speed: 1.0, role: 'Debuffer', difficulty: 2,
    blurb: 'Pactbound to something vast and hungry. Hexes foes, tears open void rifts and calls forth tentacles.',
    passive: { name: 'Soul Pact', desc: 'Killing a Hexed enemy heals 5 HP and refunds 1s on all cooldowns.' },
    stats: { hexKill: true },
    spells: {
      primary: {
        name: 'Eldritch Blast', icon: 'eye', desc: 'A spread of four void bolts.', mode: 'auto', rate: 0.55, style: 'flick', hand: 'right',
        cast(ctx) {
          ctx.sound('cast_shadow', 0.8);
          ctx.fan(4, 6, (dir) => ctx.proj({ el: 'shadow', vel: dir.multiplyScalar(42), radius: 0.15, life: 0.9, core: 0.5, light: 3, trail: 0.9,
            hit: { dmg: 8, el: 'shadow', kb: 2 } }));
          ctx.muzzle('shadow', 1.2);
          ctx.kick(0.05, 1);
        },
      },
      secondary: {
        name: 'Hex', icon: 'hex', desc: 'Curse a target: +25% damage taken and shadow damage over time (6s).', cd: 5, style: 'snap', hand: 'left',
        cast(ctx) {
          ctx.sound('cast_shadow_big');
          ctx.proj({ el: 'shadow', vel: ctx.dir.clone().multiplyScalar(36), radius: 0.4, life: 1.5, core: 0.9, light: 6, trail: 1.4, homing: 4,
            hit: { dmg: 12, el: 'shadow', st: { hex: 6, bleed: [6, 5] } },
            onHit: (p, a, pos) => { ctx.vfx.decal(v3(pos.x, ctx.groundAt(pos.x, pos.z), pos.z), 'glyph', 2, 1.5, 0xa040ff); } });
        },
      },
      ability1: {
        name: 'Void Rift', icon: 'vortex', desc: 'Tear open a rift that drags enemies inward for 3s.', cd: 10, style: 'thrust', hand: 'both',
        cast(ctx) {
          ctx.sound('cast_shadow_big');
          const c = ctx.aimPoint.clone(); c.y = ctx.groundAt(c.x, c.z) + 1.2;
          const R = ctx.aoe(7);
          ctx.zone({ pos: c, radius: R, life: 3, interval: 0.25, el: 'shadow', dmg: 7, pull: 9, st: { hex: 2 },
            visual: (z) => {
              for (let i = 0; i < 5; i++) {
                const a = Math.random() * Math.PI * 2, r = z.radius * rand(0.4, 1);
                const px = z.pos.x + Math.cos(a) * r, pz = z.pos.z + Math.sin(a) * r;
                ctx.vfx.P.glow({ x: px, y: z.pos.y + rand(-1, 1), z: pz, vx: (z.pos.x - px) * 2.2, vy: 0, vz: (z.pos.z - pz) * 2.2, r: 1.6, g: 0.3, b: 2.6, life: 0.45, size: 0.2, sprite: SPR.WISP, stretch: 0.03 });
              }
              ctx.vfx.P.solid({ x: z.pos.x, y: z.pos.y, z: z.pos.z, r: 0, g: 0, b: 0, a: 0.9, life: 0.12, size: 1.6, sprite: SPR.GLOW });
              ctx.vfx.P.glow({ x: z.pos.x, y: z.pos.y, z: z.pos.z, r: 1.2, g: 0.2, b: 2, life: 0.12, size: 2.2 + Math.sin(z.age * 30) * 0.2, sprite: SPR.RING, rot: -z.age * 5 });
              ctx.lightAt(z.pos, 0xa040ff, 14, 10);
            } });
        },
      },
      ability2: {
        name: 'Shadow Step', icon: 'dash', desc: 'Melt into shadow and dash, briefly invulnerable. Leaves a detonating shadow behind.', cd: 6, style: 'snap', hand: 'left',
        cast(ctx) {
          ctx.sound('dash'); ctx.sound('cast_shadow');
          const a = ctx.casterPos().clone().add(v3(0, 1, 0));
          ctx.vfx.smoke(a, { count: 10, color: [0.03, 0, 0.05], alpha: 0.8, size: 0.8 });
          ctx.dash(9, 0.2, { invuln: 0.6 });
          ctx.after(0.6, () => { ctx.vfx.explosion(a, 'shadow', 3); ctx.area(a, ctx.aoe(3.2), { dmg: 28, el: 'shadow', st: { hex: 3 } }); ctx.sound('explosion', 0.8, a); });
        },
      },
      ultimate: {
        name: 'Call of the Deep', icon: 'tentacle', desc: 'Eldritch tentacles erupt from the ground, crushing and rooting enemies.', cost: 100, style: 'raise', hand: 'both',
        cast(ctx) {
          ctx.sound('cast_shadow_big', 1.3); ctx.sound('boss_roar', 0.4);
          const c = ctx.aimPoint.clone(); c.y = ctx.groundAt(c.x, c.z);
          const R = ctx.aoe(8);
          ctx.vfx.decal(c, 'glyph', R * 2.2, 5, 0x9030ff);
          for (let i = 0; i < 14; i++) {
            ctx.after(0.2 + i * 0.25, () => {
              const targets = ctx.rt.inRadius(c, R);
              const t = targets.length && Math.random() < 0.8 ? targets[Math.floor(Math.random() * targets.length)] : null;
              const p = t ? v3(t.pos.x, c.y, t.pos.z) : v3(c.x + rand(-1, 1) * R, c.y, c.z + rand(-1, 1) * R);
              ctx.tentacle(p);
              ctx.after(0.3, () => ctx.area(v3(p.x, p.y + 1, p.z), 2.6, { dmg: 45, el: 'shadow', st: { root: 1.5, hex: 3 }, kb: 3 }));
            });
          }
        },
      },
    },
  },

  // ------------------------------------------------------------------ LIGHTBINDER
  lightbinder: {
    hp: 120, speed: 1.0, role: 'Healer', difficulty: 1,
    blurb: 'Carries the last light of dawn. Heals allies, shields the party and smites the undead.',
    passive: { name: 'Beacon', desc: 'You and allies within 12m regenerate 1.5 HP/s. Holy damage deals +50% to undead.' },
    stats: { aura: 1.5 },
    spells: {
      primary: {
        name: 'Holy Lance', icon: 'sun', desc: 'Swift lances of radiant light.', mode: 'auto', rate: 0.34, style: 'flick', hand: 'right',
        cast(ctx) {
          ctx.sound('cast_holy', 0.6);
          ctx.fan(1, 1.5, (dir) => ctx.proj({ el: 'holy', vel: dir.multiplyScalar(55), radius: 0.16, life: 1.3, core: 0.6, light: 6, trail: 1,
            hit: { dmg: 13, el: 'holy' } }));
          ctx.muzzle('holy');
        },
      },
      secondary: {
        name: 'Radiant Beam', icon: 'beam', desc: 'Channel a beam that burns enemies and heals allies it touches.', mode: 'channel', cd: 4, style: 'channel', hand: 'right',
        channel: beamChannel({ el: 'holy', range: 22, width: 0.14, dmg: 4.5, interval: 0.1, allyHeal: 2.5, pierce: true, sound: 'loop_beam_holy', max: 4 }),
      },
      ability1: {
        name: 'Sanctuary', icon: 'sanctuary', desc: 'Consecrate the ground: heals allies and burns enemies within (6s).', cd: 14, style: 'slam', hand: 'both',
        cast(ctx) {
          ctx.sound('cast_holy_big'); ctx.sound('shrine', 0.6);
          const c = ctx.casterPos().clone();
          const R = ctx.aoe(5.5);
          ctx.vfx.decal(c, 'glyph', R * 2.1, 6, 0xffd060);
          ctx.zone({ pos: c, radius: R, life: 6, interval: 0.5, el: 'holy', dmg: 5, healAllies: 4,
            visual: (z) => {
              if (Math.random() < 0.7) { const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * z.radius; ctx.vfx.P.glow({ x: z.pos.x + Math.cos(a) * r, y: z.pos.y + 0.1, z: z.pos.z + Math.sin(a) * r, vy: rand(1, 2.5), r: 3, g: 2.4, b: 1, life: 1.4, size: 0.1, sprite: SPR.STAR }); }
              ctx.lightAt(v3(z.pos.x, z.pos.y + 2, z.pos.z), 0xffd870, 10, z.radius * 2);
            } });
        },
      },
      ability2: {
        name: 'Divine Aegis', icon: 'shield', desc: 'Shield yourself and nearby allies for 45 damage (6s).', cd: 12, style: 'raise', hand: 'left',
        cast(ctx) {
          ctx.sound('shield'); ctx.sound('cast_holy');
          const p = ctx.casterPos();
          ctx.vfx.ring(p, 12, fxOf('holy').mid, 0.6, 0.1);
          ctx.shieldAllies(p, 12, 45, 6);
        },
      },
      ultimate: {
        name: 'Judgment', icon: 'judgment', desc: 'Pillars of light smite every nearby enemy and instantly revive fallen allies.', cost: 100, style: 'raise', hand: 'both',
        cast(ctx) {
          ctx.sound('cast_holy_big', 1.3);
          const p = ctx.casterPos();
          const targets = ctx.rt.inRadius(p, 20);
          targets.forEach((t, i) => {
            ctx.after(0.1 + i * 0.06, () => {
              const tp = v3(t.pos.x, t.pos.y, t.pos.z);
              const b = ctx.vfx.beam({ element: 'holy', width: 0.6, noise: 0.3 });
              b.update(tp, v3(tp.x, tp.y + 30, tp.z), 0.9);
              b.release(0.5);
              ctx.vfx.explosion(v3(tp.x, tp.y + 1, tp.z), 'holy', 2.5);
              ctx.area(v3(tp.x, tp.y + 1, tp.z), 2, { dmg: 75, el: 'holy', st: { mark: 6, stun: 0.5 } });
              ctx.sound('impact_holy', 0.8, tp);
            });
          });
          ctx.reviveAllies(p, 25);
          ctx.healAllies(p, 25, 30);
          ctx.screenTint([1.25, 1.2, 1.0], 0.6);
        },
      },
    },
  },

  // ------------------------------------------------------------------ GEOMANCER
  geomancer: {
    hp: 145, speed: 0.95, role: 'Tank / Zone', difficulty: 1,
    blurb: 'Hurls boulders, raises spikes from the earth and turns to stone. Slow, heavy and nearly unbreakable.',
    passive: { name: 'Bulwark', desc: 'Take 15% less damage. Your hits knock enemies back harder.' },
    stats: { armor: 0.15, kbMult: 1.5 },
    spells: {
      primary: {
        name: 'Stone Shot', icon: 'rock', desc: 'Heavy stones that splash and knock back.', mode: 'auto', rate: 0.48, style: 'thrust', hand: 'right',
        cast(ctx) {
          ctx.sound('cast_earth', 0.7);
          ctx.fan(1, 2, (dir) => ctx.proj({ el: 'earth', vel: dir.multiplyScalar(36).add(v3(0, 1.5, 0)), gravity: 6, radius: 0.25, life: 2, core: 0.25, mesh: 'rock', light: 2, trail: 0.8,
            hit: { dmg: 20, el: 'earth', kb: 6 }, aoe: { radius: 1.6, dmg: 7, el: 'earth', vfx: false, sound: false },
            onExpire: (p, pos) => { ctx.vfx.impact(pos, 'earth', 1.1); } }));
          ctx.kick(0.06, 1.5);
        },
      },
      secondary: {
        name: 'Earthspike Line', icon: 'spikes', desc: 'Stone spikes erupt in a line, knocking enemies into the air.', cd: 4, style: 'slam', hand: 'right',
        cast(ctx) {
          ctx.sound('cast_earth_big');
          const p = ctx.casterPos();
          const d = ctx.flatDir();
          for (let i = 1; i <= 8; i++) {
            ctx.after(i * 0.05, () => {
              const x = p.x + d.x * i * 1.7, z = p.z + d.z * i * 1.7;
              if (ctx.g.collision.pointSolid(x, p.y + 0.5, z)) return;
              const sp = v3(x, ctx.groundAt(x, z), z);
              ctx.spike(sp, 1.0 + i * 0.05);
              ctx.area(v3(sp.x, sp.y + 0.8, sp.z), 1.6, { dmg: 24, el: 'earth', st: { stun: 0.6 }, kb: 3 });
              if (i % 2) ctx.sound('impact_earth', 0.6, sp);
            });
          }
        },
      },
      ability1: {
        name: 'Stoneskin', icon: 'stoneskin', desc: 'Encase yourself in stone: 50% damage reduction for 5s.', cd: 12, style: 'raise', hand: 'both',
        cast(ctx) {
          ctx.sound('cast_earth_big'); ctx.sound('shield');
          ctx.buff('stoneskin', 5, { armor: 0.5 });
          const p = ctx.casterPos();
          ctx.vfx.burst(v3(p.x, p.y + 1, p.z), { count: 20, speed: 3, life: 0.8, size: 0.2, sprite: SPR.CHUNK, solid: true, color: [0.35, 0.3, 0.25], gravity: 8 });
          ctx.screenTint([1.1, 1.0, 0.85], 5);
        },
      },
      ability2: {
        name: 'Tremor', icon: 'quake', desc: 'Slam the ground, stunning nearby enemies.', cd: 8, style: 'slam', hand: 'right',
        cast(ctx) {
          ctx.sound('cast_earth_big'); ctx.sound('boss_slam', 0.6);
          const p = ctx.casterPos();
          const R = ctx.aoe(6);
          ctx.vfx.explosion(v3(p.x, p.y + 0.3, p.z), 'earth', 4, { groundY: p.y });
          ctx.vfx.ring(p, R, fxOf('earth').core, 0.5, 0.3);
          for (let i = 0; i < 10; i++) { const a = (i / 10) * Math.PI * 2; ctx.spike(v3(p.x + Math.cos(a) * 3, p.y, p.z + Math.sin(a) * 3), 0.8); }
          ctx.area(v3(p.x, p.y + 1, p.z), R, { dmg: 38, el: 'earth', st: { stun: 1.2 }, kb: 8 });
          ctx.kick(0.4, 4);
        },
      },
      ultimate: {
        name: "Mountain's Fall", icon: 'meteor', desc: 'Drop a colossal boulder from the sky.', cost: 100, style: 'raise', hand: 'both',
        cast(ctx) {
          ctx.sound('cast_earth_big', 1.3);
          const c = ctx.aimPoint.clone(); c.y = ctx.groundAt(c.x, c.z);
          ctx.vfx.telegraph(c, { radius: 7, dur: 1.2, color: [2.2, 1.2, 0.3] });
          const start = v3(c.x, c.y + 26, c.z); // clamped below ceilings by ctx.proj
          ctx.after(0.2, () => ctx.proj({ el: 'earth', pos: start, vel: v3(0, -26, 0), radius: 2, life: 3, core: 0, mesh: 'boulder', light: 0, trail: 3, noWallUntilGround: true,
            aoe: { radius: ctx.aoe(7.5), dmg: 220, el: 'earth', st: { stun: 1.5 }, kb: 18 },
            onExpire: (p, pos) => {
              for (let i = 0; i < 14; i++) { const a = (i / 14) * Math.PI * 2; ctx.spike(v3(pos.x + Math.cos(a) * 5, c.y, pos.z + Math.sin(a) * 5), 1.6); }
              ctx.kick(0.6, 6);
            } }));
        },
      },
    },
  },

  // ------------------------------------------------------------------ THORNWEAVER
  druid: {
    hp: 115, speed: 1.0, role: 'Damage over Time', difficulty: 2,
    blurb: 'The rot of the deep grove. Stacks virulent poisons, roots enemies in thorns and calls spirit wolves.',
    passive: { name: 'Virulence', desc: 'Poison applies +1 extra stack. Poisoned enemies deal 10% less damage.' },
    stats: { poisonBonus: 1 },
    spells: {
      primary: {
        name: 'Venom Thorns', icon: 'thorn', desc: 'Twin thorns that stack Poison.', mode: 'auto', rate: 0.32, style: 'flick', hand: 'right',
        cast(ctx) {
          ctx.sound('cast_poison', 0.6);
          ctx.fan(2, 3, (dir) => ctx.proj({ el: 'poison', vel: dir.multiplyScalar(44), radius: 0.12, life: 1.4, core: 0.35, mesh: 'shard', meshScale: 0.7, light: 2, trail: 0.7,
            hit: { dmg: 6.5, el: 'poison', st: { poison: [1 + (ctx.stats.poisonBonus ?? 0), 2.2] } } }));
          ctx.muzzle('poison');
        },
      },
      secondary: {
        name: 'Spore Bloom', icon: 'cloud', desc: 'Lob a seed pod that bursts into a toxic cloud (5s).', cd: 5, style: 'throw', hand: 'left',
        cast(ctx) {
          ctx.sound('cast_poison_big');
          ctx.proj({ el: 'poison', vel: ctx.dir.clone().multiplyScalar(20).add(v3(0, 5, 0)), gravity: 16, radius: 0.2, life: 3, core: 0.4, mesh: 'flask', light: 4, trail: 0.6,
            onExpire: (p, pos) => {
              const c = v3(pos.x, ctx.groundAt(pos.x, pos.z), pos.z);
              ctx.vfx.explosion(v3(c.x, c.y + 0.5, c.z), 'poison', 2.5);
              ctx.zone({ pos: c, radius: ctx.aoe(4.2), life: 5, interval: 0.5, el: 'poison', dmg: 3, st: { poison: [1 + (ctx.stats.poisonBonus ?? 0), 2.5] },
                visual: (z, dt) => { if (Math.random() < dt * 10) ctx.vfx.smoke(v3(z.pos.x + rand(-1, 1) * z.radius * 0.6, z.pos.y + 0.6, z.pos.z + rand(-1, 1) * z.radius * 0.6), { count: 1, size: 1.4, color: [0.2, 0.38, 0.06], alpha: 0.35, life: 2, speed: 0.6, rise: 0.4 }); ctx.lightAt(v3(z.pos.x, z.pos.y + 1, z.pos.z), 0x90e030, 4, 6); } });
            } });
        },
      },
      ability1: {
        name: 'Entangle', icon: 'roots', desc: 'Thorny roots burst from the ground, rooting enemies (2.5s).', cd: 10, style: 'slam', hand: 'both',
        cast(ctx) {
          ctx.sound('cast_poison_big'); ctx.sound('cast_earth');
          const c = ctx.aimPoint.clone(); c.y = ctx.groundAt(c.x, c.z);
          const R = ctx.aoe(5.5);
          ctx.vfx.decal(c, 'crack', R * 2, 6);
          for (let i = 0; i < 16; i++) { const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * R; ctx.thorn(v3(c.x + Math.cos(a) * r, c.y, c.z + Math.sin(a) * r)); }
          ctx.area(v3(c.x, c.y + 1, c.z), R, { dmg: 16, el: 'poison', st: { root: 2.5, poison: [2, 2.5] } });
        },
      },
      ability2: {
        name: 'Spirit Wolves', icon: 'wolf', desc: 'Call two spirit wolves to hunt your enemies (15s), and heal yourself.', cd: 15, style: 'raise', hand: 'left',
        cast(ctx) {
          ctx.sound('beast_growl'); ctx.sound('heal');
          const p = ctx.casterPos();
          const d = ctx.flatDir();
          for (const s of [-1, 1]) {
            const sp = v3(p.x + d.x * 2 - d.z * s * 1.5, p.y, p.z + d.z * 2 + d.x * s * 1.5);
            ctx.vfx.burst(v3(sp.x, sp.y + 0.6, sp.z), { element: 'poison', count: 25, speed: 3, life: 0.8, size: 0.25, sprite: SPR.FEATHER, spin: 3 });
            ctx.summon('spiritWolf', sp, 15);
          }
          ctx.healSelf(20);
        },
      },
      ultimate: {
        name: "Nature's Wrath", icon: 'storm', desc: 'Three waves of thorns erupt around you, poisoning and rooting all.', cost: 100, style: 'slam', hand: 'both',
        cast(ctx) {
          ctx.sound('cast_poison_big', 1.3);
          const p = ctx.casterPos().clone();
          for (let w = 0; w < 3; w++) {
            ctx.after(w * 0.6, () => {
              const R = ctx.aoe(5 + w * 3.5);
              ctx.vfx.ring(p, R, fxOf('poison').core, 0.5, 0.2);
              for (let i = 0; i < 18; i++) { const a = (i / 18) * Math.PI * 2 + w; ctx.thorn(v3(p.x + Math.cos(a) * R, p.y, p.z + Math.sin(a) * R)); }
              ctx.area(v3(p.x, p.y + 1, p.z), R, { dmg: 38, el: 'poison', st: { poison: [3, 3], root: 1.2 }, kb: 5 });
              ctx.sound('cast_earth_big', 0.7);
              ctx.kick(0.2, 2);
            });
          }
        },
      },
    },
  },

  // ------------------------------------------------------------------ SPELLBLADE
  spellblade: {
    hp: 145, speed: 1.04, role: 'Melee Caster', difficulty: 2,
    blurb: 'An arcane knight who weaves sword and spell. Melee strikes build Edge charges that empower thrown blades.',
    passive: { name: 'Edge', desc: 'Melee hits build Edge (max 5). Spectral Blades throws +1 blade per Edge. Parry reflects projectiles.' },
    stats: { armor: 0.1 },
    spells: {
      primary: {
        name: 'Arcblade', icon: 'sword', desc: 'Wide arcane sword slashes. Builds Edge.', mode: 'auto', rate: 0.42, style: 'swing', hand: 'right',
        cast(ctx) {
          ctx.sound('cast_blade', 0.8);
          const o = ctx.casterPos().clone().add(v3(0, 1.3, 0));
          const d = ctx.flatDir();
          ctx.slashFx(o, d, 'blade', 3.6, ctx.counter('slash') % 2 ? 1 : -1);
          let hitAny = false;
          for (const a of ctx.rt.inCone(o, d, 3.8, 1.0)) {
            ctx.hit(a, { dmg: 24, el: 'blade', kb: 5 }, v3(a.pos.x, a.pos.y + a.height * 0.5, a.pos.z));
            hitAny = true;
          }
          if (hitAny) { ctx.addCharge(1, 5); ctx.hitstop(0.05); }
        },
      },
      secondary: {
        name: 'Spectral Blades', icon: 'blades', desc: 'Hurl 3 spectral swords (+1 per Edge, consumed).', cd: 2.2, style: 'throw', hand: 'left',
        cast(ctx) {
          ctx.sound('cast_blade');
          const n = 3 + ctx.useCharges();
          ctx.fan(n, Math.min(30, 6 + n * 2.5), (dir) => ctx.proj({ el: 'blade', vel: dir.multiplyScalar(40), radius: 0.2, life: 1.2, core: 0.4, mesh: 'blade', light: 4, trail: 0.7, pierce: 2,
            hit: { dmg: 15, el: 'blade', kb: 3 } }));
        },
      },
      ability1: {
        name: 'Parry', icon: 'parry', desc: 'Raise a ward for 0.7s: negate damage and reflect projectiles. Gain 2 Edge on success.', cd: 5, style: 'raise', hand: 'right',
        cast(ctx) {
          ctx.sound('shield');
          ctx.parry(0.7);
          const p = ctx.casterPos();
          ctx.vfx.shell(v3(p.x, p.y + 1.1, p.z), { element: 'blade', radius: 1.4, life: 0.7, alpha: 0.7 });
        },
      },
      ability2: {
        name: 'Blade Rush', icon: 'dash', desc: 'Dash through enemies, slicing everything in your path.', cd: 6, style: 'swing', hand: 'right',
        cast(ctx) {
          ctx.sound('dash'); ctx.sound('cast_blade_big');
          const a = ctx.casterPos().clone();
          const d = ctx.flatDir();
          ctx.dash(11, 0.2, { invuln: 0.25 });
          const hits = new Set();
          for (let i = 0; i <= 8; i++) {
            ctx.after(i * 0.025, () => {
              const c = v3(a.x + d.x * i * 1.35, a.y + 1, a.z + d.z * i * 1.35);
              ctx.vfx.burst(c, { element: 'blade', count: 6, speed: 3, life: 0.3, size: 0.08, stretch: 0.05 });
              for (const t of ctx.rt.inRadius(c, 1.8)) {
                if (hits.has(t.id)) continue;
                hits.add(t.id);
                ctx.hit(t, { dmg: 34, el: 'blade', kb: 6, st: { bleed: [3, 4] } }, v3(t.pos.x, t.pos.y + t.height * 0.5, t.pos.z));
                ctx.addCharge(1, 5);
              }
            });
          }
        },
      },
      ultimate: {
        name: 'Thousand Edges', icon: 'blades', desc: 'A storm of spectral swords orbits you, shredding enemies (6s).', cost: 100, style: 'raise', hand: 'both',
        cast(ctx) {
          ctx.sound('cast_blade_big', 1.3);
          ctx.zone({ follow: true, pos: ctx.casterPos().clone(), radius: ctx.aoe(5.5), life: 6, interval: 0.2, el: 'blade', dmg: 11, st: { bleed: [2, 3] },
            visual: (z) => {
              const p = ctx.casterPos();
              z.pos.copy(p);
              for (let i = 0; i < 10; i++) {
                const a = z.age * 6 + (i / 10) * Math.PI * 2;
                const r = z.radius * (0.55 + 0.35 * Math.sin(z.age * 3 + i));
                ctx.vfx.P.glow({ x: p.x + Math.cos(a) * r, y: p.y + 0.8 + Math.sin(a * 2 + i) * 0.5, z: p.z + Math.sin(a) * r, vx: -Math.sin(a) * 18, vz: Math.cos(a) * 18, r: 1.2, g: 2.6, b: 4.4, life: 0.1, size: 0.12, stretch: 0.05, sprite: SPR.SHARD });
              }
              ctx.lightAt(v3(p.x, p.y + 1, p.z), 0x60b8ff, 10, 8);
            } });
        },
      },
    },
  },

  // ------------------------------------------------------------------ TEMPEST
  tempest: {
    hp: 100, speed: 1.12, role: 'Crowd Control', difficulty: 2,
    blurb: 'Rides the howling winds. Slices with wind blades, hurls enemies about and soars through the air.',
    passive: { name: 'Windborne', desc: 'You can double jump. Deal +20% damage while airborne.' },
    stats: { doubleJump: true, airDmg: 0.2 },
    spells: {
      primary: {
        name: 'Wind Blade', icon: 'crescent', desc: 'Piercing crescents of cutting wind.', mode: 'auto', rate: 0.4, style: 'flick', hand: 'right',
        cast(ctx) {
          ctx.sound('cast_wind', 0.7);
          ctx.fan(1, 2, (dir) => ctx.proj({ el: 'wind', vel: dir.multiplyScalar(38), radius: 0.4, life: 1.2, core: 0.3, mesh: 'crescent', light: 2, trail: 0.7, pierce: 2,
            hit: { dmg: 13, el: 'wind', kb: 3 } }));
          ctx.muzzle('wind');
        },
      },
      secondary: {
        name: 'Gale', icon: 'gust', desc: 'A violent gust that hurls enemies away.', cd: 4, style: 'thrust', hand: 'both',
        cast(ctx) {
          ctx.sound('cast_wind_big');
          const o = ctx.casterPos().clone().add(v3(0, 1.2, 0));
          const d = ctx.dir;
          for (let i = 0; i < 40; i++) {
            const sx = d.x + rand(-0.4, 0.4), sy = d.y + rand(-0.2, 0.3), sz = d.z + rand(-0.4, 0.4);
            ctx.vfx.P.glow({ x: o.x, y: o.y, z: o.z, vx: sx * 22, vy: sy * 22, vz: sz * 22, r: 1.2, g: 1.6, b: 1.6, life: 0.4, size: 0.3, sprite: SPR.WISP, stretch: 0.05, drag: 3 });
          }
          for (const a of ctx.rt.inCone(o, d, ctx.aoe(9), 0.6)) ctx.hit(a, { dmg: 16, el: 'wind', kb: 20, st: { stun: 0.4 } }, v3(a.pos.x, a.pos.y + 1, a.pos.z));
          ctx.kick(0.1, 2);
        },
      },
      ability1: {
        name: 'Tornado', icon: 'tornado', desc: 'Send forth a tornado that drags and shreds enemies.', cd: 10, style: 'thrust', hand: 'both',
        cast(ctx) {
          ctx.sound('cast_wind_big');
          const snd = ctx.loop('loop_tornado');
          ctx.proj({ el: 'wind', pos: ctx.casterPos().clone().add(v3(0, 0.3, 0)).addScaledVector(ctx.flatDir(), 1.5), vel: ctx.flatDir().multiplyScalar(6.5), radius: 1.6, life: 5, core: 0, light: 0, trail: 0, pierce: 999, noWall: false,
            data: { acc: 0 },
            onTick: (p, dt) => {
              p.pos.y = ctx.groundAt(p.pos.x, p.pos.z) + 0.3;
              snd?.setPos(p.pos);
              for (let i = 0; i < 6; i++) {
                const h = Math.random() * 5, a = Math.random() * Math.PI * 2, r = 0.3 + h * 0.35;
                ctx.vfx.P.glow({ x: p.pos.x + Math.cos(a) * r, y: p.pos.y + h, z: p.pos.z + Math.sin(a) * r, vx: -Math.sin(a) * 10 * r, vy: 2, vz: Math.cos(a) * 10 * r, r: 0.9, g: 1.2, b: 1.2, life: 0.25, size: 0.4, sprite: SPR.WISP, stretch: 0.04 });
              }
              if (Math.random() < dt * 8) ctx.vfx.P.solid({ x: p.pos.x, y: p.pos.y + rand(0, 3), z: p.pos.z, vx: rand(-3, 3), vy: 3, vz: rand(-3, 3), r: 0.4, g: 0.38, b: 0.32, a: 0.4, life: 0.8, size: 0.8, size2: 1.6, sprite: SPR.SMOKE });
              p.data.acc += dt;
              if (p.data.acc > 0.2) {
                p.data.acc = 0;
                for (const a of ctx.rt.inRadius(p.pos, ctx.aoe(3.2))) {
                  ctx.hit(a, { dmg: 7, el: 'wind', pull: [p.pos.x, p.pos.z, 10] }, v3(a.pos.x, a.pos.y + 1, a.pos.z));
                }
              }
            },
            onExpire: () => snd?.stop(0.5) });
        },
      },
      ability2: {
        name: 'Updraft', icon: 'updraft', desc: 'Launch yourself skyward and glide down. Knocks back enemies around you.', cd: 6, style: 'raise', hand: 'both',
        cast(ctx) {
          ctx.sound('cast_wind_big'); ctx.sound('jump');
          const p = ctx.casterPos();
          ctx.launch(13, 2.2);
          ctx.vfx.ring(p, 4, fxOf('wind').core, 0.4, 0.3);
          ctx.vfx.explosion(v3(p.x, p.y + 0.3, p.z), 'wind', 3, { groundY: p.y });
          ctx.area(v3(p.x, p.y + 1, p.z), ctx.aoe(4), { dmg: 15, el: 'wind', kb: 14 });
        },
      },
      ultimate: {
        name: 'Hurricane', icon: 'storm', desc: 'Become the eye of a hurricane that drags in and shreds all nearby (6s).', cost: 100, style: 'raise', hand: 'both',
        cast(ctx) {
          ctx.sound('cast_wind_big', 1.3);
          const snd = ctx.loop('loop_tornado');
          ctx.zone({ follow: true, pos: ctx.casterPos().clone(), radius: ctx.aoe(10), life: 6, interval: 0.2, el: 'wind', dmg: 9, pull: 6,
            visual: (z) => {
              const p = ctx.casterPos();
              z.pos.copy(p);
              snd?.setPos(p);
              for (let i = 0; i < 12; i++) {
                const a = Math.random() * Math.PI * 2, r = z.radius * rand(0.3, 1);
                ctx.vfx.P.glow({ x: p.x + Math.cos(a) * r, y: p.y + rand(0, 4), z: p.z + Math.sin(a) * r, vx: -Math.sin(a) * 16, vy: 1, vz: Math.cos(a) * 16, r: 0.9, g: 1.3, b: 1.3, life: 0.35, size: 0.35, sprite: SPR.WISP, stretch: 0.05 });
              }
            },
            onEnd: () => snd?.stop(0.6) });
        },
      },
    },
  },
};

export const CLASS_LIST = Object.keys(CLASSES).map((id) => ({ id, ...CLASS_META[id], ...CLASSES[id] }));
export const SLOTS = ['primary', 'secondary', 'ability1', 'ability2', 'ultimate'];
