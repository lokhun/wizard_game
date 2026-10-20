import * as THREE from 'three';
import { SPR } from '../render/particles.js';
import { fxOf } from '../render/vfx.js';
import { rand } from '../core/rng.js';
import { CLASS_META } from './classMeta.js';
import { ST } from './combat.js';
import { segPointDist2 } from '../core/math.js';

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
const tmp2 = new THREE.Vector3();

// Rate-based emission: how many particles to spawn this frame for `rate` per
// second, carrying the fraction over in S[key]. Keeps channel/zone effects the
// same density at 30, 60 or 144 fps.
function emitN(S, key, rate, dt) {
  const a = (S[key] ?? 0) + rate * dt;
  const n = Math.floor(a);
  S[key] = a - n;
  return n;
}

// ---------------------------------------------------------------- augments
// Spell augments (class tomes, see upgrades.js AUGMENTS) are checked with
// aug(ctx, id). Remote replays get the caster's augment ids with each cast, so
// the same branches run there for visuals; damage still goes through
// ctx.hit/ctx.area, which only act on the caster's machine.
const aug = (ctx, id) => !!ctx.stats.aug?.has(id);
const augM = (ctx, id) => ctx.stats.augM?.[id] ?? 1;
const _ex = new Set();
// SpellRuntime.clear() (leaving a floor) runs onExpire without killing the
// projectile first: augment follow-ups must not spawn anything then.
const cleared = (p) => !p.dead;

// A projectile for looks only: it flies and renders, but never touches actors.
function fxProj(ctx, o) {
  const p = ctx.proj(o);
  p.faction = 'fx';
  return p;
}

// Wrap a channel definition with extra hooks (run after the base ones).
function hookChannel(base, hooks) {
  return {
    max: base.max,
    start(ctx, S) { base.start(ctx, S); hooks.start?.(ctx, S); },
    update(ctx, S, dt) { base.update(ctx, S, dt); hooks.update?.(ctx, S, dt); },
    end(ctx, S) { base.end(ctx, S); hooks.end?.(ctx, S); },
  };
}

// Follow the servants a cast just raised near `pos`. Summons are replicated
// actors, so this works on every machine. tick(actor, zone) runs every
// `interval` while one lives; gone(lastPos) once when it falls or expires.
function trackSummons(ctx, type, pos, life, { tick, gone, interval = 0.25 }) {
  const list = [];
  const R2 = 9;
  ctx.zone({ pos, radius: 0, life: life + 1.5, interval,
    onTick: (z) => {
      if (z.age < 1.5) {
        for (const a of ctx.g.actors.allies()) {
          if (a.type !== type || a._augTracked || a.dead) continue;
          const dx = a.pos.x - pos.x, dz = a.pos.z - pos.z;
          if (dx * dx + dz * dz > R2) continue;
          a._augTracked = true;
          list.push({ a, p: a.pos.clone() });
        }
      }
      for (let i = list.length - 1; i >= 0; i--) {
        const t = list[i];
        if (t.a.dead) { list.splice(i, 1); gone?.(t.p); continue; }
        t.p.copy(t.a.pos);
        tick?.(t.a, z);
      }
    } });
}

// A spike of ice rising from the ground (visual), shattering after `life`.
function iceSpike(ctx, at, life, onShatter) {
  return fxProj(ctx, { el: 'frost', pos: v3(at.x, at.y + 0.45, at.z), vel: v3(rand(-0.06, 0.06), 0.3, rand(-0.06, 0.06)), radius: 0.05, life, core: 0, mesh: 'bigShard', meshScale: rand(1.0, 1.4), light: 0, trail: 0,
    onExpire: (p, pos) => { if (!cleared(p)) onShatter?.(pos); } });
}

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
      const ns = emitN(S, 'eS', 70, dt);
      if (ns) ctx.vfx.burst(S.end, { element: el, count: ns, speed: 4, life: 0.3, size: 0.05, stretch: 0.02, drag: 3 });
      if (emitN(S, 'eG', 14, dt)) { const c = fxOf(el).mid; ctx.vfx.P.glow({ x: S.end.x, y: S.end.y, z: S.end.z, r: c[0] * 0.6, g: c[1] * 0.6, b: c[2] * 0.6, life: 0.1, size: width * 5, sprite: SPR.GLOW }); }
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
    start(ctx, S) {
      S.acc = 0; S.snd = ctx.loop(sound);
      // roaring volume behind the particles: scrolling-noise flame cone
      S.cone = ctx.vfx.cone({ element: el, speed: 4.5, alpha: 1.5 });
    },
    update(ctx, S, dt) {
      const o = ctx.origin, d = ctx.dir;
      const fx = fxOf(el);
      // the cone starts just past the focus so its throat isn't on the lens
      tmp2.copy(o).addScaledVector(d, 0.35);
      S.cone.update(tmp2, d, range * 0.95, Math.tan(angle) * range * 0.8, 0.9 + 0.1 * Math.sin(ctx.time * 31));
      // flame tongues seeded all along the cone (not piled up where drag stops
      // them), widening and cooling from a hot orange throat to sooty red
      const n = emitN(S, 'eF', 160, dt);
      for (let i = 0; i < n; i++) {
        const t = 0.1 + Math.pow(Math.random(), 0.9) * 0.88;
        const w = Math.tan(angle) * t;
        const sx = d.x + rand(-1, 1) * w * 0.8, sy = d.y + rand(-1, 1) * w * 0.5, sz = d.z + rand(-1, 1) * w * 0.8;
        const L = t * range;
        const c0 = t < 0.3 ? fx.core : fx.mid, k0 = t < 0.3 ? 0.42 : 0.7;
        // the stream must read from the hand outward, so it skips the near-lens fade
        ctx.vfx.P.glowAmbient({ x: o.x + sx * L, y: o.y + sy * L, z: o.z + sz * L, vx: sx * range * 0.9, vy: sy * range * 0.9 + 0.6, vz: sz * range * 0.9,
          r: c0[0] * k0, g: c0[1] * k0, b: c0[2] * k0, r2: fx.end[0], g2: fx.end[1], b2: fx.end[2],
          life: rand(0.18, 0.32), size: 0.2 + t * 1.3, size2: 0.35 + t * 1.6, sprite: SPR.FLAME, drag: 1.5, spin: rand(-2, 2) });
      }
      const ne = emitN(S, 'eE', 30, dt);
      for (let i = 0; i < ne; i++) {
        const sp = range * rand(1.2, 2.2);
        ctx.vfx.P.glow({ x: o.x + d.x * 0.6, y: o.y + d.y * 0.6, z: o.z + d.z * 0.6, vx: (d.x + rand(-1, 1) * angle * 0.6) * sp, vy: (d.y + rand(-0.5, 1) * angle * 0.5) * sp, vz: (d.z + rand(-1, 1) * angle * 0.6) * sp, r: 1.5, g: 0.42, b: 0.05, r2: 0.4, g2: 0.03, b2: 0, life: rand(0.4, 0.8), size: 0.025, sprite: SPR.EMBER, drag: 1.6, gravity: -1, stretch: 0.01 });
      }
      const nm = emitN(S, 'eM', 14, dt);
      for (let i = 0; i < nm; i++) {
        const f = rand(0.55, 0.95) * range;
        ctx.vfx.P.solid({ x: o.x + d.x * f + rand(-0.6, 0.6), y: o.y + d.y * f + 0.3, z: o.z + d.z * f + rand(-0.6, 0.6), vx: d.x * 2, vy: 1.2, vz: d.z * 2, r: 0.045, g: 0.035, b: 0.03, a: 0.4, life: 1.6, size: 0.6, size2: 2, sprite: SPR.SMOKE, drag: 1, spin: rand(-0.5, 0.5) });
      }
      ctx.lightAt(tmp.copy(o).addScaledVector(d, range * 0.5), fx.light, 22, 10);
      S.snd?.setPos(o);
      S.acc += dt;
      while (S.acc >= interval) {
        S.acc -= interval;
        for (const a of ctx.rt.inCone(o, d, range, angle)) ctx.hit(a, { dmg, el, st, tag: 'cone' }, v3(a.pos.x, a.pos.y + a.height * 0.5, a.pos.z));
      }
    },
    end(ctx, S) { S.cone?.release(0.25); S.snd?.stop(0.2); },
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
        channel: hookChannel(coneChannel({ el: 'fire', range: 7, angle: 0.42, dmg: 5, st: { burn: [3, 5] }, sound: 'loop_beam_fire', max: 3 }), {
          update(ctx, S, dt) { S.held = (S.held ?? 0) + dt; },
          // augment: the breath ends in a fireball that grows with how long you breathed
          end(ctx, S) {
            if (!aug(ctx, 'pyro_breath')) return;
            const k = Math.min(1, (S.held ?? 0) / 3), m = augM(ctx, 'pyro_breath');
            ctx.sound('cast_fire_big', 0.6 + 0.5 * k);
            ctx.proj({ el: 'fire', vel: ctx.dir.clone().multiplyScalar(30), radius: 0.3 + 0.25 * k, life: 2.5, core: 0.9 + k, mesh: 'orb', meshScale: 0.7 + 0.9 * k, light: 8 + 10 * k, trail: 1.2 + k,
              hit: { dmg: (15 + 30 * k) * m, el: 'fire', st: { burn: [4, 6] } }, aoe: { radius: ctx.aoe(2.2 + 2.6 * k), dmg: (25 + 70 * k) * m, el: 'fire', st: { burn: [4, 6] }, kb: 4 + 6 * k } });
            ctx.muzzle('fire', 1 + k);
            ctx.kick(0.06 + 0.12 * k, 1 + 2 * k);
          },
        }),
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
              // augment: three cinders scatter from the blast and burst where they land
              if (aug(ctx, 'pyro_fireball') && !cleared(p)) {
                const m = augM(ctx, 'pyro_fireball');
                const d = ctx.flatDir();
                const base = Math.atan2(d.z, d.x);
                for (let i = 0; i < 3; i++) {
                  const a = base + Math.PI + (i - 1) * 1.6 + rand(-0.2, 0.2);
                  ctx.proj({ el: 'fire', pos: v3(pos.x - d.x * 0.6, Math.max(pos.y, gy + 0.6), pos.z - d.z * 0.6), vel: v3(Math.cos(a) * 6.5, 7, Math.sin(a) * 6.5), gravity: 16, radius: 0.22, life: 2, core: 0.7, mesh: 'orb', meshScale: 0.6, light: 6, trail: 1.2,
                    hit: { dmg: 10 * m, el: 'fire', st: { burn: [3, 5] } }, aoe: { radius: ctx.aoe(2.4), dmg: 24 * m, el: 'fire', st: { burn: [3, 5] }, kb: 5 },
                    onExpire: (c, cp) => ctx.zone({ pos: v3(cp.x, ctx.groundAt(cp.x, cp.z), cp.z), radius: ctx.aoe(1.6), life: 2.2, interval: 0.35, el: 'fire', dmg: 4, st: { burn: [2, 4] }, flames: true }) });
                }
              }
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
              let tx = c.x + Math.cos(a) * r, tz = c.z + Math.sin(a) * r;
              const forge = aug(ctx, 'pyro_meteor');
              // augment: meteors seek out Burning foes in the storm
              if (forge) {
                let pick = null, n = 0;
                for (const e of ctx.rt.inRadius(c, R)) if (e.mask & ST.burn && Math.random() < 1 / ++n) pick = e;
                if (pick) { tx = pick.pos.x + rand(-0.6, 0.6); tz = pick.pos.z + rand(-0.6, 0.6); }
              }
              const ty = ctx.groundAt(tx, tz);
              const start = v3(tx - 6, ty + 22, tz - 3);
              const vel = v3(tx, ty, tz).sub(start).normalize().multiplyScalar(32);
              ctx.vfx.telegraph(v3(tx, ty, tz), { radius: 3, dur: 0.7, color: [1.8, 0.5, 0.06] });
              ctx.proj({ el: 'fire', pos: start, vel, radius: 0.8, life: 3, core: 2.4, mesh: 'meteor', light: 25, trail: 3, noWallUntilGround: true,
                data: {},
                // burning rock: a thick smoke plume and flame tongues streaming off it
                onTick: (p, dt) => {
                  const ns = emitN(p.data, 'eS', 40, dt);
                  for (let i = 0; i < ns; i++) ctx.vfx.P.solid({ x: p.pos.x + rand(-0.4, 0.4), y: p.pos.y + rand(-0.4, 0.4), z: p.pos.z + rand(-0.4, 0.4), vx: -p.vel.x * 0.05, vy: 0.8, vz: -p.vel.z * 0.05, r: 0.05, g: 0.04, b: 0.035, a: 0.55, life: rand(1.2, 2), size: 0.7, size2: 2.4, sprite: SPR.SMOKE, drag: 1, spin: rand(-0.6, 0.6) });
                  const nf = emitN(p.data, 'eF', 70, dt);
                  const fx = fxOf('fire');
                  for (let i = 0; i < nf; i++) ctx.vfx.P.glow({ x: p.pos.x + rand(-0.5, 0.5), y: p.pos.y + rand(-0.5, 0.5), z: p.pos.z + rand(-0.5, 0.5), vx: -p.vel.x * 0.15 + rand(-1, 1), vy: -p.vel.y * 0.15 + rand(0, 1), vz: -p.vel.z * 0.15 + rand(-1, 1), r: fx.mid[0] * 0.8, g: fx.mid[1] * 0.8, b: fx.mid[2] * 0.8, r2: fx.end[0], g2: fx.end[1], b2: fx.end[2], life: rand(0.25, 0.45), size: 0.9, size2: 0.2, sprite: SPR.FLAME, drag: 2, spin: rand(-2, 2) });
                },
                hit: { dmg: 30, el: 'fire' }, aoe: { radius: 3.2, dmg: 60, el: 'fire', st: { burn: [4, 8] }, kb: 10 },
                // augment: each impact leaves a pool of molten slag
                onExpire: forge ? (p, pos) => {
                  if (cleared(p)) return;
                  const gp = v3(pos.x, ctx.groundAt(pos.x, pos.z), pos.z);
                  ctx.vfx.decal(gp, 'scorch', 4.5, 6);
                  ctx.zone({ pos: gp, radius: ctx.aoe(2.2), life: 3, interval: 0.35, el: 'fire', dmg: 7 * augM(ctx, 'pyro_meteor'), st: { burn: [3, 6] }, flames: true });
                } : undefined });
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
            ctx.vfx.P.glow({ x: p.x, y: p.y + 0.3, z: p.z, vx: Math.cos(a) * R * 2, vy: rand(0, 2), vz: Math.sin(a) * R * 2, r: 0.95, g: 1.25, b: 1.5, life: 0.6, size: 0.22, sprite: SPR.SHARD, drag: 3, spin: 4 });
          }
          ctx.area(v3(p.x, p.y + 1, p.z), R, { dmg: 25, el: 'frost', st: { freeze: 2.5 }, kb: 3 });
          ctx.kick(0.2, 3);
          // augment: ice spikes rise under every foe caught and in a ring, then shatter
          if (aug(ctx, 'cryo_nova')) {
            const m = augM(ctx, 'cryo_nova');
            const spots = [];
            for (const a of ctx.rt.inRadius(p, R)) { if (spots.length >= 10) break; spots.push(v3(a.pos.x, ctx.groundAt(a.pos.x, a.pos.z), a.pos.z)); }
            for (let i = 0; i < 10; i++) {
              const a = (i / 10) * Math.PI * 2, x = p.x + Math.cos(a) * R * 0.7, z = p.z + Math.sin(a) * R * 0.7;
              if (!ctx.g.collision.pointSolid(x, p.y + 0.5, z)) spots.push(v3(x, ctx.groundAt(x, z), z));
            }
            spots.forEach((sp, i) => {
              ctx.vfx.burst(v3(sp.x, sp.y + 0.3, sp.z), { element: 'frost', count: 6, speed: 3, upward: 1, life: 0.5, size: 0.1, sprite: SPR.SHARD, gravity: 8, spin: 6 });
              iceSpike(ctx, sp, 1.5 + i * 0.015, (pos) => {
                ctx.vfx.burst(pos, { element: 'frost', count: 14, speed: 7, life: 0.7, size: 0.16, sprite: SPR.SHARD, gravity: 12, spin: 8, color: [0.9, 1.25, 1.5] });
                ctx.vfx.impact(pos, 'frost', 1.2);
                if (i % 3 === 0) ctx.sound('shatter', 0.6, pos);
                ctx.area(v3(pos.x, sp.y + 1, pos.z), 1.9, { dmg: 30 * m, el: 'frost', tag: 'shard', st: { chill: 1 } });
              });
            });
          }
        },
      },
      ability2: {
        name: 'Glacial Spike', icon: 'spike', desc: 'A huge piercing icicle. Shatters Frozen enemies.', cd: 6, style: 'thrust', hand: 'right',
        cast(ctx) {
          ctx.sound('cast_frost_big');
          ctx.proj({ el: 'frost', vel: ctx.dir.clone().multiplyScalar(40), radius: 0.35, life: 2, core: 0.8, mesh: 'bigShard', light: 10, trail: 1.6, pierce: 4,
            hit: { dmg: 55, el: 'frost', st: { chill: 2 }, tag: 'shard', kb: 6 },
            // augment: breaks into a ring of piercing shards
            onExpire: aug(ctx, 'cryo_spike') ? (p, pos) => {
              if (cleared(p)) return;
              const m = augM(ctx, 'cryo_spike');
              const d = p.vel.lengthSq() > 0.01 ? p.vel.clone().setY(0).normalize() : ctx.flatDir();
              const back = pos.clone().addScaledVector(d, -0.5);
              ctx.vfx.burst(back, { element: 'frost', count: 20, speed: 6, life: 0.6, size: 0.14, sprite: SPR.SHARD, gravity: 6, spin: 8 });
              ctx.sound('shatter', 0.8, back);
              for (let i = 0; i < 8; i++) {
                const a = (i / 8) * Math.PI * 2;
                ctx.proj({ el: 'frost', pos: back.clone(), vel: v3(Math.cos(a) * 34, 0, Math.sin(a) * 34), radius: 0.12, life: 0.55, core: 0.3, mesh: 'shard', light: 0, trail: 0.6, pierce: 1,
                  hit: { dmg: 16 * m, el: 'frost', st: { chill: 1 }, tag: 'shard' } });
              }
            } : undefined });
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
              const n = emitN(z, 'eS', 480, dt);
              for (let i = 0; i < n; i++) {
                const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * z.radius;
                ctx.vfx.P.glow({ x: z.pos.x + Math.cos(a) * r - 3, y: z.pos.y + 9, z: z.pos.z + Math.sin(a) * r, vx: 6, vy: -14, vz: rand(-1, 1), r: 0.9, g: 1.15, b: 1.5, life: 0.65, size: 0.1, sprite: i % 3 ? SPR.SNOW : SPR.SHARD, stretch: 0.02, spin: 3 });
              }
              if (Math.random() < dt * 6) ctx.vfx.smoke(v3(z.pos.x + rand(-1, 1) * z.radius * 0.7, z.pos.y + 0.5, z.pos.z + rand(-1, 1) * z.radius * 0.7), { count: 1, size: 2, color: [0.6, 0.7, 0.8], alpha: 0.25, life: 2.5, speed: 3 });
              ctx.lightAt(v3(z.pos.x, z.pos.y + 3, z.pos.z), 0x80c8ff, 14, z.radius * 1.6);
            } });
          // augment: great icicles plunge onto the most frozen foe in the storm
          if (aug(ctx, 'cryo_blizzard')) {
            const m = augM(ctx, 'cryo_blizzard');
            ctx.zone({ pos: c, radius: R, life: 6, interval: 0.6,
              onTick: (z) => {
                let best = null, bs = 0;
                for (const a of ctx.rt.inRadius(z.pos, z.radius)) {
                  const sc = (a.mask & ST.frozen ? 10 : 0) + (a.stacks?.chill ?? 0) + Math.random() * 0.5;
                  if (sc > bs) { bs = sc; best = a; }
                }
                if (!best) return;
                const tx = best.pos.x, tz = best.pos.z, ty = ctx.groundAt(tx, tz);
                ctx.vfx.telegraph(v3(tx, ty, tz), { radius: 1.6, dur: 0.4, color: [0.6, 1.4, 2.4] });
                ctx.proj({ el: 'frost', pos: v3(tx, ty + 13, tz), vel: v3(0, -32, 0), radius: 0.45, life: 1.5, core: 0.6, mesh: 'bigShard', meshScale: 2.2, light: 6, trail: 1.4, noWallUntilGround: true,
                  hit: { dmg: 50 * m, el: 'frost', tag: 'shard', st: { chill: 2 }, kb: 2 }, aoe: { radius: 2, dmg: 20 * m, el: 'frost', tag: 'shard', st: { chill: 1 }, kb: 3 } });
              } });
          }
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
            if (aug(ctx, 'storm_fork')) {
              // augment: the bolt forks at its first target into two separate chains
              const H = { dmg: 13 * empowered * 0.8, el: 'lightning', st: { shock: 3 } };
              const seen = ctx.chain(hits[0].actor, end, H, chainN, 7, 0.7);
              ctx.vfx.burst(end, { element: 'lightning', count: 10, speed: 7, life: 0.25, size: 0.05, stretch: 0.04 });
              ctx.chain(hits[0].actor, end, H, chainN, 7, 0.7, seen, true);
            } else ctx.chain(hits[0].actor, end, { dmg: 13 * empowered, el: 'lightning', st: { shock: 3 } }, chainN, 7, 0.7);
          }
        },
      },
      secondary: {
        name: 'Ball Lightning', icon: 'orb', desc: 'A slow orb that zaps everything nearby, then detonates.', cd: 5, style: 'thrust', hand: 'left',
        cast(ctx) {
          ctx.sound('cast_lightning_big');
          // augment: the orb halts where you aim and lashes up to 3 foes per pulse
          const anchor = aug(ctx, 'storm_ball');
          const o0 = ctx.origin.clone();
          const stopAt = Math.min(30, Math.max(3, o0.distanceTo(ctx.aimPoint) - 0.6));
          ctx.proj({ el: 'lightning', vel: ctx.dir.clone().multiplyScalar(anchor ? 14 : 9), radius: 0.4, life: 4, core: 1.4, mesh: 'orb', light: 14, trail: 1.4, pierce: 99,
            aoe: { radius: ctx.aoe(3.5), dmg: 30, el: 'lightning', st: { shock: 3 } },
            data: { acc: 0 },
            onTick: (p, dt) => {
              p.data.acc += dt;
              if (emitN(p.data, 'eL', 14, dt)) ctx.vfx.lightning(p.pos, tmp.copy(p.pos).add(tmp2.set(rand(-1.4, 1.4), rand(-1, 1), rand(-1.4, 1.4))), { life: 0.06, branches: 0, width: 0.035 });
              if (anchor && !p.data.anchored && p.pos.distanceTo(o0) >= stopAt) {
                p.data.anchored = true;
                p.vel.set(0, 0, 0);
                p.homing = 0;
                ctx.vfx.ring(v3(p.pos.x, ctx.groundAt(p.pos.x, p.pos.z), p.pos.z), ctx.aoe(5.5), fxOf('lightning').core, 0.5, 0.15);
                ctx.sound('impact_lightning', 0.6, p.pos);
              }
              if (anchor && p.data.anchored) {
                if (emitN(p.data, 'eA', 8, dt)) ctx.vfx.lightning(p.pos, v3(p.pos.x + rand(-1, 1), ctx.groundAt(p.pos.x, p.pos.z), p.pos.z + rand(-1, 1)), { life: 0.08, branches: 1, width: 0.05 });
                if (p.data.acc >= 0.25) {
                  p.data.acc = 0;
                  _ex.clear();
                  for (let k = 0; k < 3; k++) {
                    const t = ctx.rt.nearest(p.pos, ctx.aoe(6.5), _ex);
                    if (!t) break;
                    _ex.add(t.id);
                    const tp = v3(t.pos.x, t.pos.y + t.height * 0.5, t.pos.z);
                    ctx.vfx.lightning(p.pos, tp, { life: 0.12, branches: 1 });
                    ctx.hit(t, { dmg: 8 * augM(ctx, 'storm_ball'), el: 'lightning', st: { shock: 2 } }, tp);
                    if (k === 0) ctx.sound('impact_lightning', 0.4, tp);
                  }
                }
                return;
              }
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
            // augment: the blink path stays charged as a wall of lightning
            if (aug(ctx, 'storm_blink') && a.distanceTo(b) > 1) {
              const m = augM(ctx, 'storm_blink');
              const lo = a.clone(), hi = b.clone(), mid = a.clone().lerp(b, 0.5);
              ctx.zone({ pos: mid, radius: 0, life: 3, interval: 0.12,
                onTick: (z) => {
                  z.n = (z.n ?? 0) + 1;
                  const k = Math.random();
                  ctx.vfx.lightning(v3(lo.x + (hi.x - lo.x) * k * 0.5, lo.y - 0.6, lo.z + (hi.z - lo.z) * k * 0.5), v3(lo.x + (hi.x - lo.x) * (0.5 + k * 0.5), hi.y + rand(-0.2, 0.9), lo.z + (hi.z - lo.z) * (0.5 + k * 0.5)), { life: 0.14, branches: 1, width: 0.07 });
                  if (z.n % 2) ctx.vfx.lightning(lo, hi, { life: 0.1, branches: 0, width: 0.05 });
                  if (z.n % 3) return;
                  for (const t of ctx.rt.inRadius(z.pos, lo.distanceTo(hi) * 0.5 + 1)) {
                    if (segPointDist2(lo.x, 0, lo.z, hi.x, 0, hi.z, t.pos.x, 0, t.pos.z) > (1.1 + t.radius) ** 2) continue;
                    ctx.hit(t, { dmg: 9 * m, el: 'lightning', st: { shock: 3 } }, v3(t.pos.x, t.pos.y + t.height * 0.5, t.pos.z));
                  }
                },
                visual: (z) => ctx.lightAt(z.pos, 0x8090ff, 6, lo.distanceTo(hi) * 0.6 + 3) });
            }
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
          // augment: the orb swings back to your hand, piercing everything again
          const moon = aug(ctx, 'arc_orb');
          ctx.proj({ el: 'arcane', vel: ctx.dir.clone().multiplyScalar(15), radius: 0.6, life: moon ? 3.2 : 1.6, core: 1.6, mesh: 'orb', meshScale: 1.3, light: 14, trail: 2, pierce: 99, bounce: moon ? 1 : 0,
            hit: { dmg: 14, el: 'arcane', kb: 3 }, aoe: { radius: ctx.aoe(4), dmg: 32, el: 'arcane' },
            data: {},
            onTick: (p, dt) => {
              if (emitN(p.data, 'eR', 25, dt)) ctx.vfx.P.glow({ x: p.pos.x, y: p.pos.y, z: p.pos.z, vx: rand(-1, 1), vy: rand(-1, 1), vz: rand(-1, 1), r: 0.9, g: 0.4, b: 1.4, life: 0.6, size: 0.26, sprite: SPR.RUNE, drag: 2, spin: 2 });
              if (!moon) return;
              p.data.b0 ??= p.bounce;
              // turn back at the end of its flight, or as soon as it rebounds off a wall
              if (!p.data.ret && (p.age > 0.8 || p.bounce < p.data.b0)) { p.data.ret = true; p.hitIds.clear(); p.homing = 0; ctx.vfx.burst(p.pos, { element: 'arcane', count: 16, speed: 4, life: 0.5, size: 0.2, sprite: SPR.STAR, spin: 3 }); }
              if (p.data.ret) {
                const cp = ctx.casterPos();
                tmp.set(cp.x - p.pos.x, cp.y + 1.2 - p.pos.y, cp.z - p.pos.z);
                const d = tmp.length();
                if (d < 1.3) {
                  // caught: no blast in your face, and the orb comes back sooner
                  p.aoe = null;
                  p.life = p.age;
                  ctx.vfx.burst(p.pos, { element: 'arcane', count: 24, speed: 3, life: 0.5, size: 0.18, sprite: SPR.RUNE, spin: 3 });
                  ctx.sound('cooldown_ready', 0.5);
                  if (ctx.local && ctx.caster.cds) ctx.caster.cds.secondary = Math.max(0, ctx.caster.cds.secondary - 2);
                  return;
                }
                p.vel.lerp(tmp.multiplyScalar(Math.min(22, 8 + p.age * 6) / d), Math.min(1, dt * 7));
              }
            } });
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
          // augment: a mirror image stays behind, casting missiles, then bursts
          if (aug(ctx, 'arc_blink')) {
            const m = augM(ctx, 'arc_blink');
            const g = v3(a.x, a.y - 1, a.z);
            ctx.zone({ pos: g, radius: 0, life: 3, interval: 0.45,
              onTick: (z) => {
                const t = ctx.rt.nearest(z.pos, 16);
                if (!t) return;
                const from = v3(z.pos.x, z.pos.y + 1.4, z.pos.z);
                for (let i = 0; i < 2; i++) {
                  const d = v3(t.pos.x - from.x, t.pos.y + t.height * 0.55 - from.y, t.pos.z - from.z).normalize().add(v3(rand(-0.3, 0.3), rand(0, 0.35), rand(-0.3, 0.3))).normalize();
                  ctx.proj({ el: 'arcane', pos: from.clone(), vel: d.multiplyScalar(26), radius: 0.15, life: 1.6, core: 0.45, light: 3, trail: 0.8, homing: 7, hit: { dmg: 8 * m, el: 'arcane' } });
                }
                ctx.sound('cast_arcane', 0.35, from);
              },
              visual: (z, dt) => {
                // a shimmering silhouette of runes and starlight
                const n = emitN(z, 'eM', 130, dt);
                for (let i = 0; i < n; i++) {
                  const h = Math.random() * 1.8, w = h > 1.45 ? 0.17 : 0.32 - Math.abs(h - 0.9) * 0.05, a2 = Math.random() * Math.PI * 2;
                  ctx.vfx.P.glow({ x: z.pos.x + Math.cos(a2) * w, y: z.pos.y + h, z: z.pos.z + Math.sin(a2) * w, vy: 0.25, r: 1.0, g: 0.45, b: 1.9, life: 0.4, size: i % 4 ? 0.12 : 0.26, sprite: i % 4 ? SPR.SPARK : SPR.RUNE, spin: 2 });
                }
                // a soft inner glow so the image reads at range
                if (emitN(z, 'eC', 20, dt)) {
                  ctx.vfx.P.glow({ x: z.pos.x, y: z.pos.y + 1.1, z: z.pos.z, r: 0.35, g: 0.14, b: 0.7, life: 0.12, size: 1.3, sprite: SPR.GLOW });
                  ctx.vfx.P.glow({ x: z.pos.x, y: z.pos.y + 0.06, z: z.pos.z, r: 0.5, g: 0.2, b: 1.0, life: 0.12, size: 1.4, sprite: SPR.RING, rot: z.age * 3 });
                }
                ctx.lightAt(tmp.set(z.pos.x, z.pos.y + 1.2, z.pos.z), 0xb050ff, 8, 6);
              },
              onEnd: (z) => {
                if (z.age < z.life) return; // cleared with the floor
                const c = v3(z.pos.x, z.pos.y + 1, z.pos.z);
                ctx.vfx.explosion(c, 'arcane', 2.5);
                ctx.sound('explosion', 0.6, c);
                ctx.area(c, ctx.aoe(3), { dmg: 30 * m, el: 'arcane', kb: 6 });
              } });
          }
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
              ctx.zone({ pos: c, radius: R, life: 3.5, interval: 0.25, el: 'arcane', dmg: 9, pull: 7,
                visual: (z, dt) => {
                  const n = emitN(z, 'eS', 260, dt);
                  for (let i = 0; i < n; i++) {
                    const a = Math.random() * Math.PI * 2, r = z.radius * rand(0.5, 1);
                    const px = z.pos.x + Math.cos(a) * r, pz = z.pos.z + Math.sin(a) * r, py = z.pos.y + rand(-1, 2);
                    ctx.vfx.P.glow({ x: px, y: py, z: pz, vx: (z.pos.x - px) * 2 + Math.cos(a + 1.5) * 4, vy: (z.pos.y - py) * 2, vz: (z.pos.z - pz) * 2 + Math.sin(a + 1.5) * 4, r: 0.9, g: 0.35, b: 1.5, life: 0.5, size: 0.07, stretch: 0.03, sprite: SPR.SPARK });
                  }
                  // dark heart with a violet event-horizon ring
                  if (emitN(z, 'eC', 24, dt)) {
                    ctx.vfx.P.solid({ x: z.pos.x, y: z.pos.y, z: z.pos.z, r: 0, g: 0, b: 0, a: 0.85, life: 0.15, size: 1.8, sprite: SPR.GLOW });
                    ctx.vfx.P.glow({ x: z.pos.x, y: z.pos.y, z: z.pos.z, r: 0.35, g: 0.1, b: 0.7, life: 0.15, size: 3 + Math.sin(z.age * 20) * 0.3, sprite: SPR.RING, rot: z.age * 4 });
                  }
                  ctx.lightAt(z.pos, 0xb050ff, 25, 14);
                },
                onEnd: (z) => {
                  hum?.stop?.(0.3);
                  ctx.vfx.explosion(z.pos, 'arcane', 6);
                  ctx.sound('explosion_big', 1, z.pos);
                  ctx.area(z.pos, ctx.aoe(6.5), { dmg: 120, el: 'arcane', kb: 16, falloff: true });
                } });
              // augment: the star lashes everything it holds with seeking missiles
              if (aug(ctx, 'arc_sing')) {
                const m = augM(ctx, 'arc_sing');
                ctx.zone({ pos: c, radius: R, life: 3.4, interval: 0.22,
                  onTick: (z) => {
                    const held = ctx.rt.inRadius(z.pos, z.radius);
                    for (let i = 0; i < 2 && held.length; i++) {
                      const d = v3(rand(-1, 1), rand(0.3, 1), rand(-1, 1)).normalize();
                      ctx.proj({ el: 'arcane', pos: z.pos.clone(), vel: d.multiplyScalar(18), radius: 0.15, life: 1.4, core: 0.45, light: 2, trail: 0.7, homing: 9, homingRange: z.radius * 1.5,
                        hit: { dmg: 11 * m, el: 'arcane' } });
                    }
                    if (held.length) ctx.sound('cast_arcane', 0.3, z.pos);
                  } });
              }
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
          onTickHit: (ctx, a) => {
            if (Math.random() < 0.5) ctx.vfx.P.glow({ x: a.pos.x, y: a.pos.y + a.height * 0.6, z: a.pos.z, vx: (ctx.origin.x - a.pos.x) * 2, vy: 1, vz: (ctx.origin.z - a.pos.z) * 2, r: 0.45, g: 1.3, b: 0.45, life: 0.5, size: 0.15, sprite: SPR.WISP });
            // augment: the siphon forks to a second foe
            if (aug(ctx, 'necro_drain')) {
              _ex.clear(); _ex.add(a.id);
              const n = ctx.rt.nearest(a.pos, 10, _ex);
              if (!n) return;
              const ap = v3(a.pos.x, a.pos.y + a.height * 0.6, a.pos.z), np = v3(n.pos.x, n.pos.y + n.height * 0.6, n.pos.z);
              ctx.vfx.lightning(ap, np, { element: 'necrotic', life: 0.12, branches: 0, width: 0.05, jag: 0.4 });
              const d = 4.5 * 0.8 * augM(ctx, 'necro_drain');
              ctx.hit(n, { dmg: d, el: 'necrotic', tag: 'beam' }, np);
              ctx.healSelf(d * 0.35);
              if (Math.random() < 0.5) ctx.vfx.P.glow({ x: np.x, y: np.y, z: np.z, vx: (ap.x - np.x) * 2, vy: 1, vz: (ap.z - np.z) * 2, r: 0.45, g: 1.3, b: 0.45, life: 0.5, size: 0.15, sprite: SPR.WISP });
            }
          } }),
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
          // augment: the servants burst in necrotic flame when they fall or expire
          if (aug(ctx, 'necro_raise')) {
            const m = augM(ctx, 'necro_raise');
            trackSummons(ctx, 'skeletonMinion', v3(c.x, ctx.groundAt(c.x, c.z), c.z), 20, {
              tick: (a) => { if (Math.random() < 0.4) ctx.vfx.P.glow({ x: a.pos.x + rand(-0.3, 0.3), y: a.pos.y + rand(0.2, 1.6), z: a.pos.z + rand(-0.3, 0.3), vy: 1.2, r: 0.4, g: 1.5, b: 0.4, r2: 0.05, g2: 0.3, b2: 0.05, life: 0.6, size: 0.25, size2: 0.05, sprite: SPR.FLAME }); },
              gone: (pos) => {
                const c2 = v3(pos.x, pos.y + 1, pos.z);
                ctx.vfx.explosion(c2, 'necrotic', 3.2);
                ctx.vfx.decal(v3(pos.x, ctx.groundAt(pos.x, pos.z), pos.z), 'scorch', 3, 5);
                ctx.sound('explosion', 0.7, c2);
                ctx.area(c2, ctx.aoe(3.5), { dmg: 45 * m, el: 'necrotic', st: { poison: [2, 3] }, kb: 8 });
              } });
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
          // augment: a wake of bone spikes erupts along the spear's path
          if (aug(ctx, 'necro_spear')) {
            const m = augM(ctx, 'necro_spear');
            const p0 = ctx.casterPos().clone(), d = ctx.flatDir();
            const len = ctx.rt.rayActors(v3(p0.x, p0.y + 1, p0.z), d, 26).wall;
            for (let i = 1; i * 1.5 <= len; i++) {
              ctx.after(0.15 + i * 0.035, () => {
                const x = p0.x + d.x * i * 1.5, z = p0.z + d.z * i * 1.5;
                if (ctx.g.collision.pointSolid(x, p0.y + 0.5, z)) return;
                const sp = v3(x, ctx.groundAt(x, z), z);
                ctx.spike(sp, 0.55);
                ctx.vfx.burst(v3(sp.x, sp.y + 0.4, sp.z), { element: 'necrotic', count: 5, speed: 2.5, upward: 1, life: 0.6, size: 0.18, sprite: SPR.WISP });
                ctx.area(v3(sp.x, sp.y + 0.8, sp.z), 1.5, { dmg: 16 * m, el: 'necrotic', st: { root: 1.2 } });
                if (i % 3 === 1) ctx.sound('impact_earth', 0.5, sp);
              });
            }
          }
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
          const reaper = aug(ctx, 'blood_scythe');
          // augment: free while you are sated (above 80% health)
          if (!(reaper && ctx.hp() > ctx.maxHp() * 0.8)) ctx.payHp(4);
          ctx.sound('cast_blade'); ctx.sound('cast_blood');
          const o = ctx.casterPos().clone().add(v3(0, 1.2, 0));
          const d = ctx.flatDir();
          ctx.vfx.slash(o, d, 'blood', 4.2, 1, { life: 0.3, tilt: 0.22 });
          ctx.vfx.slash(o.clone().add(v3(0, -0.15, 0)), d, 'blood', 3.4, 1, { life: 0.34, tilt: 0.16, alpha: 0.5, sparks: 0 });
          for (const a of ctx.rt.inCone(o, d, ctx.aoe(4.4), 1.0)) ctx.hit(a, { dmg: 32, el: 'blood', st: { bleed: [4, 5] }, kb: 6 }, v3(a.pos.x, a.pos.y + a.height * 0.5, a.pos.z));
          // augment: a crescent of blood flies on through the line (Hemorrhage on the freshly cut)
          if (reaper) {
            const m = augM(ctx, 'blood_scythe');
            ctx.after(0.08, () => ctx.proj({ el: 'blood', pos: o.clone().addScaledVector(d, 1.2), vel: ctx.dir.clone().setY(ctx.dir.y * 0.3).normalize().multiplyScalar(30), radius: 0.75, life: 0.7, core: 0.8, light: 6, trail: 2.4, pierce: 99,
              hit: { dmg: 22 * m, el: 'blood', st: { bleed: [3, 4] }, kb: 3 }, data: {},
              onTick: (p, dt) => {
                const n = emitN(p.data, 'eC', 90, dt);
                for (let i = 0; i < n; i++) {
                  const k = rand(-1, 1);
                  ctx.vfx.P.glow({ x: p.pos.x - d.z * k * 1.3, y: p.pos.y + Math.abs(k) * 0.35 - 0.1, z: p.pos.z + d.x * k * 1.3, vx: -p.vel.x * 0.05, vy: -0.5, vz: -p.vel.z * 0.05, r: 1.3, g: 0.06, b: 0.1, r2: 0.3, g2: 0, b2: 0.02, life: 0.22, size: 0.14, size2: 0.04, sprite: SPR.SPARK, stretch: 0.03 });
                }
              } }));
          }
        },
      },
      ability1: {
        name: 'Blood Pact', icon: 'pact', desc: 'Sacrifice 20% of current HP to gain +40% damage and attack speed for 6s.', cd: 14, style: 'snap', hand: 'left',
        cast(ctx) {
          const paid = ctx.hp() * 0.2;
          ctx.payHp(paid);
          // augment: the sacrificed blood erupts as homing lances, 1 per 5 health
          if (aug(ctx, 'blood_pact')) {
            const m = augM(ctx, 'blood_pact');
            const n = Math.max(3, Math.min(14, Math.round(paid / 5)));
            const c = ctx.casterPos().clone().add(v3(0, 1.3, 0));
            const fd = ctx.flatDir(), base = Math.atan2(fd.z, fd.x);
            for (let i = 0; i < n; i++) {
              ctx.after(i * 0.03, () => {
                const a = base + (i / n - 0.5) * Math.PI * 1.6;
                ctx.proj({ el: 'blood', pos: c.clone(), vel: v3(Math.cos(a) * 16, rand(2, 5), Math.sin(a) * 16), radius: 0.15, life: 1.8, core: 0.45, light: 2, trail: 1, homing: 6, homingRange: 22,
                  hit: { dmg: 16 * m, el: 'blood', st: { bleed: [3, 3] } } });
              });
            }
          }
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
            for (let i = 0; i < 6; i++) ctx.vfx.P.glow({ x: ap.x, y: ap.y, z: ap.z, vx: (p.x - ap.x) * 1.6 + rand(-1, 1), vy: 2 + rand(0, 2), vz: (p.z - ap.z) * 1.6 + rand(-1, 1), r: 1.4, g: 0.06, b: 0.1, life: 0.6, size: 0.13, sprite: SPR.DROP, gravity: 4 });
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
          // augment: a pool of blood that bleeds foes and mends allies standing in it
          if (aug(ctx, 'blood_nova')) {
            const m = augM(ctx, 'blood_nova');
            const gp = v3(p.x, ctx.groundAt(p.x, p.z), p.z);
            const PR = ctx.aoe(5.5);
            ctx.vfx.decal(gp, 'blood', PR * 2, 5.5, 0xff2030);
            ctx.zone({ pos: gp, radius: PR, life: 5, interval: 0.5, el: 'blood', dmg: 5 * m, st: { bleed: [2, 5] }, healAllies: 4,
              visual: (z, dt) => {
                const n = emitN(z, 'eB', 40, dt);
                for (let i = 0; i < n; i++) {
                  const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * z.radius;
                  ctx.vfx.P.glow({ x: z.pos.x + Math.cos(a) * r, y: z.pos.y + 0.05, z: z.pos.z + Math.sin(a) * r, vy: rand(0.6, 1.6), r: 1.2, g: 0.04, b: 0.08, r2: 0.25, g2: 0, b2: 0.02, life: 0.9, size: 0.12, size2: 0.03, sprite: SPR.BUBBLE });
                }
                ctx.lightAt(tmp.set(z.pos.x, z.pos.y + 1, z.pos.z), 0xff1030, 6, z.radius * 1.6);
              } });
          }
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
            onTick: (p, dt) => {
              if (p.data.stuckTo && !p.data.stuckTo.dead) p.pos.set(p.data.stuckTo.pos.x, p.data.stuckTo.pos.y + p.data.stuckTo.height * 0.6, p.data.stuckTo.pos.z);
              const k = p.age / p.life;
              // ticking faster as it nears detonation
              if (emitN(p.data, 'eR', 10 + 30 * k, dt)) ctx.vfx.P.glow({ x: p.pos.x, y: p.pos.y, z: p.pos.z, r: 0.25, g: 1.4, b: 1.15, life: 0.15, size: 0.4 + k * 1.2, sprite: SPR.RING, rot: p.age * 8 });
            },
            aoe: { radius: ctx.aoe(3.6), dmg: 42, el: 'time', st: { slow: 2.5 }, tag: 'big' },
            // augment: the moment recurs, and the bomb detonates a second time
            onExpire: aug(ctx, 'chrono_bomb') ? (p, pos) => {
              if (cleared(p)) return;
              const m = augM(ctx, 'chrono_bomb');
              const stuck = p.data.stuckTo;
              const at = pos.clone();
              const R = ctx.aoe(3.6);
              ctx.vfx.telegraph(v3(at.x, ctx.groundAt(at.x, at.z), at.z), { radius: R, dur: 1.2, color: [0.25, 1.6, 1.3] });
              ctx.zone({ pos: at, radius: 0, life: 1.2, interval: 1,
                onTick: () => {},
                visual: (z, dt) => {
                  if (stuck && !stuck.dead) z.pos.set(stuck.pos.x, stuck.pos.y + stuck.height * 0.6, stuck.pos.z);
                  const k = z.age / z.life;
                  if (emitN(z, 'eR', 8 + 30 * k, dt)) ctx.vfx.P.glow({ x: z.pos.x, y: z.pos.y, z: z.pos.z, r: 0.25, g: 1.4, b: 1.15, life: 0.18, size: 1.6 - k * 1.2, sprite: SPR.RING, rot: -z.age * 8 });
                },
                onEnd: (z) => {
                  if (z.age < z.life) return;
                  ctx.vfx.explosion(z.pos, 'time', R);
                  ctx.sound('explosion', 0.8, z.pos);
                  ctx.area(z.pos, R, { dmg: 42 * m, el: 'time', st: { slow: 2.5 }, tag: 'big' });
                } });
            } : undefined });
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
          // augment: the self you abandoned lingers, then detonates in shattered time
          if (aug(ctx, 'chrono_rewind')) {
            const m = augM(ctx, 'chrono_rewind');
            const R = ctx.aoe(4.5);
            ctx.vfx.telegraph(v3(a.x, a.y - 1, a.z), { radius: R, dur: 0.7, color: [0.25, 1.6, 1.3] });
            ctx.zone({ pos: a, radius: 0, life: 0.7, interval: 1, onTick: () => {},
              visual: (z, dt) => {
                const n = emitN(z, 'eG', 80, dt);
                for (let i = 0; i < n; i++) {
                  const h = Math.random() * 1.8, a2 = Math.random() * Math.PI * 2;
                  ctx.vfx.P.glow({ x: z.pos.x + Math.cos(a2) * 0.3, y: z.pos.y - 1 + h, z: z.pos.z + Math.sin(a2) * 0.3, vx: Math.cos(a2) * 0.4, vz: Math.sin(a2) * 0.4, r: 0.25, g: 1.3, b: 1.05, life: 0.3, size: 0.12, sprite: i % 5 ? SPR.SPARK : SPR.RING });
                }
              },
              onEnd: (z) => {
                if (z.age < z.life) return;
                ctx.vfx.explosion(z.pos, 'time', R * 0.8);
                ctx.vfx.ring(v3(z.pos.x, z.pos.y - 1, z.pos.z), R, fxOf('time').core, 0.5, 0.25);
                ctx.sound('explosion', 0.8, z.pos);
                ctx.area(z.pos, R, { dmg: 50 * m, el: 'time', st: { slow: 2.5, stun: 0.8 }, tag: 'big', kb: 6 });
              } });
          }
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
            visual: (z, dt) => { sh?.update(z.pos, 0.35); if (emitN(z, 'eS', 16, dt)) ctx.vfx.P.glow({ x: z.pos.x + rand(-1, 1) * R * 0.7, y: z.pos.y + rand(0, 3), z: z.pos.z + rand(-1, 1) * R * 0.7, r: 0.25, g: 1.25, b: 1.0, life: 1.2, size: 0.18, sprite: SPR.STAR }); },
            onEnd: (z) => {
              sh?.release();
              // augment: the field collapses into its heart, dragging foes in
              if (!aug(ctx, 'chrono_stasis') || z.age < z.life) return;
              const m = augM(ctx, 'chrono_stasis');
              const cc = v3(z.pos.x, z.pos.y + 1, z.pos.z);
              for (let i = 0; i < 60; i++) {
                const a = (i / 60) * Math.PI * 2, r = R * rand(0.8, 1.1);
                ctx.vfx.P.glow({ x: cc.x + Math.cos(a) * r, y: cc.y + rand(-0.8, 1.5), z: cc.z + Math.sin(a) * r, vx: -Math.cos(a) * r * 3.2, vy: 0, vz: -Math.sin(a) * r * 3.2, r: 0.3, g: 1.5, b: 1.2, life: 0.3, size: 0.14, stretch: 0.03, sprite: SPR.SPARK });
              }
              ctx.after(0.25, () => {
                ctx.vfx.explosion(cc, 'time', 3.5);
                ctx.sound('explosion_big', 0.8, cc);
                ctx.kick(0.15, 2);
                // the pull scales with distance so every foe ends up near the heart
                if (ctx.local) {
                  for (const a of ctx.rt.inRadius(cc, R)) {
                    const d = Math.hypot(a.pos.x - cc.x, a.pos.z - cc.z);
                    ctx.hit(a, { dmg: 60 * m, el: 'time', st: { slow: 2, stun: 0.6 }, tag: 'big', pull: [cc.x, cc.z, d * 10] }, v3(a.pos.x, a.pos.y + a.height * 0.5, a.pos.z));
                  }
                }
              });
            } });
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
          // augment: bolts that strike a Hexed foe splinter into two seeking bolts
          const splinter = aug(ctx, 'warlock_blast') ? (p, a, pos) => {
            if (!a || !(a.mask & ST.hex) || p.data.splinter) return;
            const m = augM(ctx, 'warlock_blast');
            ctx.vfx.burst(pos, { element: 'shadow', count: 8, speed: 4, life: 0.35, size: 0.12, sprite: SPR.WISP });
            for (const sgn of [-1, 1]) {
              const d = p.vel.clone().setY(0).normalize();
              const c = Math.cos(sgn * 1.1), sn = Math.sin(sgn * 1.1);
              const child = ctx.proj({ el: 'shadow', pos: pos.clone(), vel: v3(d.x * c - d.z * sn, 0.15, d.x * sn + d.z * c).multiplyScalar(26), radius: 0.13, life: 1, core: 0.4, light: 2, trail: 0.8, homing: 8, homingRange: 12,
                data: { splinter: true, split: true }, hit: { dmg: 6 * m, el: 'shadow', kb: 1 } });
              child.hitIds.add(a.id);
            }
          } : undefined;
          ctx.fan(4, 6, (dir) => ctx.proj({ el: 'shadow', vel: dir.multiplyScalar(42), radius: 0.15, life: 0.9, core: 0.5, light: 3, trail: 0.9,
            hit: { dmg: 8, el: 'shadow', kb: 2 }, onHit: splinter }));
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
            onHit: (p, a, pos) => {
              ctx.vfx.decal(v3(pos.x, ctx.groundAt(pos.x, pos.z), pos.z), 'glyph', 2, 1.5, 0xa040ff);
              // augment: the curse splits and seeks out three more victims
              if (!aug(ctx, 'warlock_hex') || p.data.child || !a) return;
              const m = augM(ctx, 'warlock_hex');
              _ex.clear(); _ex.add(a.id);
              ctx.vfx.burst(pos, { element: 'shadow', count: 16, speed: 4, life: 0.5, size: 0.3, sprite: SPR.RUNE, spin: 2 });
              for (let i = 0; i < 3; i++) {
                const t = ctx.rt.nearest(pos, 14, _ex);
                if (t) _ex.add(t.id);
                const ang = (i / 3) * Math.PI * 2 + rand(-0.3, 0.3);
                const d = t ? v3(t.pos.x - pos.x, t.pos.y + t.height * 0.55 - pos.y, t.pos.z - pos.z).normalize() : v3(Math.cos(ang), 0.2, Math.sin(ang)).normalize();
                const child = ctx.proj({ el: 'shadow', pos: pos.clone(), vel: d.add(v3(0, 0.5, 0)).normalize().multiplyScalar(22), radius: 0.3, life: 1.4, core: 0.7, light: 4, trail: 1.1, homing: 6, homingRange: 16,
                  data: { child: true }, hit: { dmg: 8 * m, el: 'shadow', st: { hex: 4, bleed: [4, 4] } },
                  onHit: (cp, ca, cpos) => ctx.vfx.decal(v3(cpos.x, ctx.groundAt(cpos.x, cpos.z), cpos.z), 'glyph', 1.6, 1.2, 0xa040ff) });
                child.hitIds.add(a.id);
              }
              ctx.sound('cast_shadow', 0.5, pos);
            } });
        },
      },
      ability1: {
        name: 'Void Rift', icon: 'vortex', desc: 'Tear open a rift that drags enemies inward for 3s.', cd: 10, style: 'thrust', hand: 'both',
        cast(ctx) {
          ctx.sound('cast_shadow_big');
          const c = ctx.aimPoint.clone(); c.y = ctx.groundAt(c.x, c.z) + 1.2;
          const R = ctx.aoe(7);
          ctx.zone({ pos: c, radius: R, life: 3, interval: 0.25, el: 'shadow', dmg: 7, pull: 9, st: { hex: 2 },
            visual: (z, dt) => {
              const n = emitN(z, 'eW', 170, dt);
              for (let i = 0; i < n; i++) {
                const a = Math.random() * Math.PI * 2, r = z.radius * rand(0.4, 1);
                const px = z.pos.x + Math.cos(a) * r, pz = z.pos.z + Math.sin(a) * r;
                ctx.vfx.P.glow({ x: px, y: z.pos.y + rand(-1, 1), z: pz, vx: (z.pos.x - px) * 2.2, vy: 0, vz: (z.pos.z - pz) * 2.2, r: 0.7, g: 0.12, b: 1.2, life: 0.45, size: 0.18, sprite: SPR.WISP, stretch: 0.02 });
              }
              // a black maw ringed in violet: dark enough that enemies stay visible against it
              if (emitN(z, 'eC', 24, dt)) {
                ctx.vfx.P.solid({ x: z.pos.x, y: z.pos.y, z: z.pos.z, r: 0, g: 0, b: 0, a: 0.85, life: 0.15, size: 1.6, sprite: SPR.GLOW });
                ctx.vfx.P.glow({ x: z.pos.x, y: z.pos.y, z: z.pos.z, r: 0.5, g: 0.08, b: 0.85, life: 0.15, size: 2.2 + Math.sin(z.age * 30) * 0.2, sprite: SPR.RING, rot: -z.age * 5 });
              }
              ctx.lightAt(z.pos, 0xa040ff, 14, 10);
            },
            // augment: the closing rift lashes out with tentacles
            onEnd: aug(ctx, 'warlock_rift') ? (z) => {
              if (z.age < z.life) return;
              const m = augM(ctx, 'warlock_rift');
              const gy = ctx.groundAt(z.pos.x, z.pos.z);
              const inside = ctx.rt.inRadius(z.pos, z.radius);
              ctx.vfx.explosion(z.pos, 'shadow', 2.5);
              for (let i = 0; i < 4; i++) {
                const t = inside[i];
                if (!t && i > 1) break;
                const a = (i / 4) * Math.PI * 2;
                const tp = t ? v3(t.pos.x, gy, t.pos.z) : v3(z.pos.x + Math.cos(a) * 2, gy, z.pos.z + Math.sin(a) * 2);
                ctx.after(i * 0.12, () => {
                  ctx.tentacle(tp);
                  ctx.after(0.3, () => ctx.area(v3(tp.x, tp.y + 1, tp.z), 2.4, { dmg: 40 * m, el: 'shadow', st: { root: 1.2, hex: 3 }, kb: 3 }));
                });
              }
            } : undefined });
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
        name: 'Holy Lance', icon: 'sun', desc: 'Swift lances of radiant light that pierce one foe.', mode: 'auto', rate: 0.34, style: 'flick', hand: 'right',
        cast(ctx) {
          // augment: every 4th lance is a great spear of dawn
          if (aug(ctx, 'light_lance') && ctx.counter('dawn') % 4 === 3) {
            const m = augM(ctx, 'light_lance');
            ctx.sound('cast_holy_big', 0.7);
            ctx.fan(1, 1.5, (dir) => ctx.proj({ el: 'holy', vel: dir.multiplyScalar(70), radius: 0.35, life: 1.2, core: 0.85, light: 12, trail: 2.6, pierce: 99,
              hit: { dmg: 34 * m, el: 'holy', st: { mark: 4 }, kb: 4 }, data: {},
              onTick: (p, dt) => {
                const n = emitN(p.data, 'eD', 60, dt);
                for (let i = 0; i < n; i++) ctx.vfx.P.glow({ x: p.pos.x + rand(-0.25, 0.25), y: p.pos.y + rand(-0.25, 0.25), z: p.pos.z + rand(-0.25, 0.25), vx: rand(-1, 1), vy: rand(0, 1.5), vz: rand(-1, 1), r: 1.5, g: 1.2, b: 0.5, life: 0.5, size: 0.1, sprite: SPR.STAR });
              } }));
            ctx.muzzle('holy', 1.8);
            ctx.kick(0.08, 2);
            return;
          }
          ctx.sound('cast_holy', 0.6);
          ctx.fan(1, 1.5, (dir) => ctx.proj({ el: 'holy', vel: dir.multiplyScalar(55), radius: 0.16, life: 1.3, core: 0.6, light: 6, trail: 1, pierce: 1,
            hit: { dmg: 16, el: 'holy' } }));
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
          // augment: the sanctuary is carried with you as a moving halo
          const halo = aug(ctx, 'light_sanct');
          if (!halo) ctx.vfx.decal(c, 'glyph', R * 2.1, 6, 0xffd060);
          ctx.zone({ pos: c, radius: R, life: 6, interval: 0.5, el: 'holy', dmg: 8, healAllies: 4, follow: halo,
            visual: (z, dt) => {
              if (halo && emitN(z, 'eH', 2.5, dt)) ctx.vfx.ring(z.pos, z.radius, fxOf('holy').core, 0.7, 0.06);
              const n = emitN(z, 'eS', 36, dt);
              for (let i = 0; i < n; i++) { const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * z.radius; ctx.vfx.P.glow({ x: z.pos.x + Math.cos(a) * r, y: z.pos.y + 0.1, z: z.pos.z + Math.sin(a) * r, vy: rand(1, 2.5), r: 1.4, g: 1.1, b: 0.45, life: 1.4, size: 0.09, sprite: SPR.STAR }); }
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
          // augment: the ward erupts in radiance now, and again when it fades
          if (aug(ctx, 'light_aegis')) {
            const m = augM(ctx, 'light_aegis');
            const wrath = () => {
              const q = ctx.casterPos();
              const c = v3(q.x, q.y + 1, q.z);
              const R = ctx.aoe(6);
              ctx.vfx.explosion(c, 'holy', 3);
              ctx.vfx.ring(q, R, fxOf('holy').core, 0.45, 0.3);
              ctx.sound('impact_holy', 0.9, c);
              ctx.area(c, R, { dmg: 30 * m, el: 'holy', st: { mark: 4, stun: 0.8 }, kb: 12 });
              ctx.kick(0.15, 2);
            };
            wrath();
            ctx.after(6, wrath);
          }
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
          // augment: stones skip along the ground, splashing on every bounce
          const skip = aug(ctx, 'geo_shot');
          const sm = augM(ctx, 'geo_shot');
          ctx.fan(1, 2, (dir) => ctx.proj({ el: 'earth', vel: skip ? dir.multiplyScalar(30).add(v3(0, 1, 0)) : dir.multiplyScalar(36).add(v3(0, 1.5, 0)), gravity: skip ? 16 : 6, radius: 0.25, life: skip ? 2.6 : 2, core: 0.25, mesh: 'rock', light: 2, trail: 0.8,
            bounce: skip ? 2 : 0, data: {},
            hit: { dmg: 20, el: 'earth', kb: 6 }, aoe: { radius: 1.6, dmg: 7, el: 'earth', vfx: false, sound: false },
            onTick: skip ? (p) => {
              // a floor bounce flips the fall into a rise
              if ((p.data.vy ?? 0) < -1 && p.vel.y > 0) {
                // one floor contact can use up two bounces (wall probe + floor), so count skips here
                p.data.skips = (p.data.skips ?? 2) - 1;
                p.bounce = Math.max(p.bounce, p.data.skips);
                p.vel.y = Math.max(p.vel.y, 4);
                p.hitIds.clear();
                const gp = v3(p.pos.x, ctx.groundAt(p.pos.x, p.pos.z) + 0.2, p.pos.z);
                ctx.vfx.impact(gp, 'earth', 1.3);
                ctx.vfx.decal(gp, 'crack', 1.6, 3);
                ctx.sound('impact_earth', 0.45, gp);
                ctx.area(v3(gp.x, gp.y + 0.6, gp.z), 1.9, { dmg: 12 * sm, el: 'earth', kb: 5 });
              }
              p.data.vy = p.vel.y;
            } : undefined,
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
          // augment: a snaking fault, twice as long, that veers toward foes
          if (aug(ctx, 'geo_spike')) {
            const cur = v3(p.x, p.y, p.z), hd = d.clone();
            const step = (i) => {
              const t = ctx.rt.nearest(cur, 9);
              if (t) {
                const want = Math.atan2(t.pos.z - cur.z, t.pos.x - cur.x), have = Math.atan2(hd.z, hd.x);
                let da = want - have;
                while (da > Math.PI) da -= Math.PI * 2;
                while (da < -Math.PI) da += Math.PI * 2;
                const na = have + Math.max(-0.45, Math.min(0.45, da));
                hd.set(Math.cos(na), 0, Math.sin(na));
              }
              const x = cur.x + hd.x * 1.7, z = cur.z + hd.z * 1.7;
              if (ctx.g.collision.pointSolid(x, p.y + 0.5, z)) return;
              cur.set(x, ctx.groundAt(x, z), z);
              ctx.spike(cur.clone(), 1.0 + i * 0.03);
              ctx.area(v3(cur.x, cur.y + 0.8, cur.z), 1.6, { dmg: 24, el: 'earth', st: { stun: 0.6 }, kb: 3 });
              if (i % 2) ctx.sound('impact_earth', 0.6, cur);
              if (i < 16) ctx.after(0.05, () => step(i + 1));
            };
            ctx.after(0.05, () => step(1));
            return;
          }
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
              // augment: the boulder rolls on, crushing everything in its path
              if (aug(ctx, 'geo_mountain') && !cleared(p)) {
                const m = augM(ctx, 'geo_mountain');
                const d = ctx.flatDir();
                const snd = ctx.loop('loop_tornado');
                ctx.proj({ el: 'earth', pos: v3(pos.x + d.x * 1.5, ctx.groundAt(pos.x, pos.z) + 1.7, pos.z + d.z * 1.5), vel: d.clone().multiplyScalar(11), radius: 1.7, life: 3.2, core: 0, mesh: 'boulder', meshScale: 0.8, light: 0, trail: 1.5, pierce: 999,
                  hit: { dmg: 70 * m, el: 'earth', st: { stun: 1 }, kb: 16 }, aoe: { radius: ctx.aoe(4.5), dmg: 70 * m, el: 'earth', st: { stun: 1 }, kb: 12 }, data: {},
                  onTick: (r, dt) => {
                    r.pos.y = ctx.groundAt(r.pos.x, r.pos.z) + 1.7;
                    snd?.setPos?.(r.pos);
                    r.spin = 0;
                    if (r.mesh) { r.mesh.rotation.set(0, Math.atan2(d.x, d.z), 0); r.mesh.rotateX(r.age * 6); }
                    if (emitN(r.data, 'eD', 30, dt)) ctx.vfx.burst(v3(r.pos.x, r.pos.y - 1.5, r.pos.z), { count: 2, speed: 4, life: 0.8, size: 0.14, sprite: SPR.CHUNK, solid: true, color: [0.3, 0.26, 0.2], gravity: 14, upward: 1 });
                    if (emitN(r.data, 'eS', 6, dt)) ctx.vfx.smoke(v3(r.pos.x, r.pos.y - 1.4, r.pos.z), { count: 1, size: 1, color: [0.3, 0.26, 0.2], alpha: 0.35 });
                  },
                  onExpire: () => { snd?.stop?.(0.3); ctx.kick(0.3, 3); } });
              }
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
              // augment: the cloud creeps after foes, then bursts by Poison stacks
              const creep = aug(ctx, 'druid_spore') && !cleared(p);
              ctx.zone({ pos: c, radius: ctx.aoe(4.2), life: 5, interval: 0.5, el: 'poison', dmg: 3, st: { poison: [1 + (ctx.stats.poisonBonus ?? 0), 2.5] },
                visual: (z, dt) => {
                  if (creep) {
                    z.seekT = (z.seekT ?? 0) - dt;
                    if (z.seekT <= 0) { z.seekT = 0.4; z.tgt = ctx.rt.nearest(z.pos, 14); }
                    if (z.tgt && !z.tgt.dead) {
                      const dx = z.tgt.pos.x - z.pos.x, dz = z.tgt.pos.z - z.pos.z, dl = Math.hypot(dx, dz);
                      if (dl > 0.5) {
                        const nx = z.pos.x + dx / dl * 2.6 * dt, nz = z.pos.z + dz / dl * 2.6 * dt;
                        if (!ctx.g.collision.pointSolid(nx, z.pos.y + 0.6, nz)) { z.pos.x = nx; z.pos.z = nz; z.pos.y = ctx.groundAt(nx, nz); }
                      }
                    }
                  }
                  if (Math.random() < dt * 10) ctx.vfx.smoke(v3(z.pos.x + rand(-1, 1) * z.radius * 0.6, z.pos.y + 0.6, z.pos.z + rand(-1, 1) * z.radius * 0.6), { count: 1, size: 1.4, color: [0.2, 0.38, 0.06], alpha: 0.35, life: 2, speed: 0.6, rise: 0.4 });
                  ctx.lightAt(v3(z.pos.x, z.pos.y + 1, z.pos.z), 0x90e030, 4, 6);
                },
                onEnd: creep ? (z) => {
                  if (z.age < z.life) return;
                  const m = augM(ctx, 'druid_spore');
                  const cc = v3(z.pos.x, z.pos.y + 0.8, z.pos.z);
                  ctx.vfx.explosion(cc, 'poison', z.radius * 0.8);
                  ctx.sound('explosion', 0.7, cc);
                  for (const a of ctx.rt.inRadius(z.pos, z.radius)) ctx.hit(a, { dmg: (8 + 6 * (a.stacks?.poison ?? 0)) * m, el: 'poison', kb: 4 }, v3(a.pos.x, a.pos.y + a.height * 0.5, a.pos.z));
                } : undefined });
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
          // augment: the roots stay as a briar thicket
          if (aug(ctx, 'druid_entangle')) {
            const m = augM(ctx, 'druid_entangle');
            ctx.zone({ pos: c, radius: R, life: 5, interval: 0.5, el: 'poison', dmg: 3 * m, st: { root: 0.7, poison: [1 + (ctx.stats.poisonBonus ?? 0), 2.2] },
              visual: (z, dt) => {
                if (emitN(z, 'eT', 2.4, dt)) { const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * z.radius; ctx.thorn(v3(z.pos.x + Math.cos(a) * r, z.pos.y, z.pos.z + Math.sin(a) * r)); }
                const n = emitN(z, 'eL', 14, dt);
                for (let i = 0; i < n; i++) { const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * z.radius; ctx.vfx.P.glow({ x: z.pos.x + Math.cos(a) * r, y: z.pos.y + 0.1, z: z.pos.z + Math.sin(a) * r, vy: rand(0.3, 0.9), r: 0.5, g: 1.3, b: 0.2, life: 1, size: 0.1, sprite: SPR.FEATHER, spin: 2 }); }
              } });
          }
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
          // augment: the wolves trail venomous miasma wherever they run
          if (aug(ctx, 'druid_wolves')) {
            const m = augM(ctx, 'druid_wolves');
            const bonus = ctx.stats.poisonBonus ?? 0;
            trackSummons(ctx, 'spiritWolf', v3(p.x + d.x * 2, p.y, p.z + d.z * 2), 15, { interval: 0.45,
              tick: (a) => {
                if (a._lastMiasma && Math.hypot(a.pos.x - a._lastMiasma.x, a.pos.z - a._lastMiasma.z) < 1.4) return;
                const gp = v3(a.pos.x, ctx.groundAt(a.pos.x, a.pos.z), a.pos.z);
                a._lastMiasma = gp;
                ctx.zone({ pos: gp, radius: 1.5, life: 2.5, interval: 0.5, el: 'poison', dmg: 2 * m, st: { poison: [1 + bonus, 2] },
                  visual: (z, dt) => { if (emitN(z, 'eS', 3, dt)) ctx.vfx.smoke(v3(z.pos.x + rand(-0.5, 0.5), z.pos.y + 0.4, z.pos.z + rand(-0.5, 0.5)), { count: 1, size: 0.9, color: [0.2, 0.38, 0.06], alpha: 0.3, life: 1.6, speed: 0.4, rise: 0.3 }); } });
              } });
          }
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
          // alternate forehand (+1, right to left) and backhand; the hands follow the cut
          const side = ctx.counter('slash') % 2 ? -1 : 1;
          ctx.animStyle(side > 0 ? 'swing' : 'swing2');
          // bright leading edge + a fainter inner echo so the cut has weight
          ctx.vfx.slash(o, d, 'blade', 3.6, side, { life: 0.24 });
          ctx.vfx.slash(o, d, 'blade', 2.8, side, { life: 0.28, alpha: 0.4, sparks: 0, tilt: 0.2 });
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
          // augment: the blades fly back to you, cutting again (return hits build Edge)
          const recall = aug(ctx, 'blade_blades');
          ctx.fan(n, Math.min(30, 6 + n * 2.5), (dir) => ctx.proj({ el: 'blade', vel: dir.multiplyScalar(40), radius: 0.2, life: recall ? 2.4 : 1.2, core: 0.4, mesh: 'blade', light: 4, trail: 0.7, pierce: recall ? 4 : 2, bounce: recall ? 1 : 0,
            hit: { dmg: 15, el: 'blade', kb: 3 }, data: {},
            onHit: recall ? (p, a) => { if (p.data.ret && a) ctx.addCharge(1, 5); } : undefined,
            onTick: recall ? (p, dt) => {
              p.data.b0 ??= p.bounce;
              // turn back at the end of the throw, or as soon as a blade glances off a wall
              if (!p.data.ret && (p.age > 0.32 || p.bounce < p.data.b0)) { p.data.ret = true; p.hitIds.clear(); p.homing = 0; p.pierce = Math.max(p.pierce, 4); }
              if (!p.data.ret) return;
              const cp = ctx.casterPos();
              tmp.set(cp.x - p.pos.x, cp.y + 1.2 - p.pos.y, cp.z - p.pos.z);
              const d = tmp.length();
              if (d < 1.1) { p.life = p.age; return; }
              p.vel.lerp(tmp.multiplyScalar(44 / d), Math.min(1, dt * 9));
            } : undefined }));
        },
      },
      ability1: {
        name: 'Parry', icon: 'parry', desc: 'Raise a ward for 0.7s: negate damage and reflect projectiles. Gain 2 Edge on success.', cd: 5, style: 'raise', hand: 'right',
        cast(ctx) {
          ctx.sound('shield');
          ctx.parry(0.7);
          // augment: when the ward drops, whirl in a counter-cut (much stronger after a parry)
          if (aug(ctx, 'blade_parry')) {
            const m = augM(ctx, 'blade_parry');
            const before = ctx.local ? (ctx.caster.parries ?? 0) : 0;
            ctx.after(0.7, () => {
              const won = ctx.local && (ctx.caster.parries ?? 0) > before;
              const q = ctx.casterPos();
              const o = v3(q.x, q.y + 1.2, q.z);
              const fd = ctx.flatDir();
              ctx.sound('cast_blade_big', won ? 1 : 0.7);
              for (let i = 0; i < 3; i++) {
                const a = Math.atan2(fd.x, fd.z) + (i / 3) * Math.PI * 2;
                ctx.vfx.slash(o, v3(Math.sin(a), 0, Math.cos(a)), 'blade', won ? 4.6 : 3.6, 1, { life: 0.28, tilt: 0.12, sparks: won ? 6 : 3 });
              }
              ctx.vfx.ring(q, won ? 4.6 : 3.6, fxOf('blade').core, 0.35, 0.25);
              if (won) { ctx.vfx.explosion(o, 'blade', 2.5); ctx.hitstop(0.06); ctx.kick(0.2, 3); }
              ctx.area(o, ctx.aoe(won ? 4.8 : 3.8), { dmg: (won ? 70 : 26) * m, el: 'blade', kb: won ? 10 : 6, st: won ? { bleed: [3, 5] } : undefined });
              if (won) ctx.addCharge(1, 5);
            });
          }
          const p = ctx.casterPos();
          ctx.vfx.shell(v3(p.x, p.y + 1.1, p.z), { element: 'blade', radius: 1.4, life: 0.7, alpha: 0.7 });
          // the caster sits inside that shell, so show the ward as a sweep in front of them
          ctx.vfx.slash(v3(p.x, p.y + 1.25, p.z), ctx.flatDir(), 'blade', 1.6, 1, { life: 0.35, tilt: 1.2, alpha: 0.7, sparks: 4 });
          ctx.vfx.ring(p, 1.8, fxOf('blade').mid, 0.5, 0.15);
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
              ctx.vfx.burst(c, { element: 'blade', count: 4, speed: 3, life: 0.3, size: 0.05, stretch: 0.03 });
              if (i % 3 === 1) ctx.vfx.slash(c, d, 'blade', 2.2, i % 2 ? 1 : -1, { life: 0.22, tilt: 0.4, sparks: 3 });
              for (const t of ctx.rt.inRadius(c, 1.8)) {
                if (hits.has(t.id)) continue;
                hits.add(t.id);
                ctx.hit(t, { dmg: 34, el: 'blade', kb: 6, st: { bleed: [3, 4] } }, v3(t.pos.x, t.pos.y + t.height * 0.5, t.pos.z));
                ctx.addCharge(1, 5);
              }
            });
          }
          // augment: a phantom afterimage runs the same path and repeats every cut
          if (aug(ctx, 'blade_rush')) {
            const m = augM(ctx, 'blade_rush');
            const ghostHits = new Set();
            for (let i = 0; i <= 8; i++) {
              ctx.after(0.4 + i * 0.03, () => {
                const c = v3(a.x + d.x * i * 1.35, a.y + 1, a.z + d.z * i * 1.35);
                // the afterimage: a pale column of light where you were
                for (let k = 0; k < 6; k++) ctx.vfx.P.glow({ x: c.x + rand(-0.25, 0.25), y: c.y - 0.9 + Math.random() * 1.8, z: c.z + rand(-0.25, 0.25), vx: d.x * 2, vz: d.z * 2, r: 0.4, g: 0.85, b: 1.5, life: 0.35, size: 0.16, size2: 0.02, sprite: SPR.SPARK, stretch: 0.03 });
                if (i % 2 === 0) ctx.vfx.slash(c, d, 'blade', 2.4, i % 4 ? 1 : -1, { life: 0.22, tilt: 0.5, alpha: 0.7, sparks: 2 });
                for (const t of ctx.rt.inRadius(c, 1.9)) {
                  if (ghostHits.has(t.id)) continue;
                  ghostHits.add(t.id);
                  ctx.hit(t, { dmg: 26 * m, el: 'blade', kb: 5, st: { bleed: [3, 4] } }, v3(t.pos.x, t.pos.y + t.height * 0.5, t.pos.z));
                  ctx.addCharge(1, 5);
                }
                if (i === 0) ctx.sound('cast_blade', 0.6, c);
              });
            }
          }
        },
      },
      ultimate: {
        name: 'Thousand Edges', icon: 'blades', desc: 'A storm of spectral swords orbits you, shredding enemies (6s).', cost: 100, style: 'raise', hand: 'both',
        cast(ctx) {
          ctx.sound('cast_blade_big', 1.3);
          ctx.zone({ follow: true, pos: ctx.casterPos().clone(), radius: ctx.aoe(5.5), life: 6, interval: 0.2, el: 'blade', dmg: 11, st: { bleed: [2, 3] },
            visual: (z, dt) => {
              const p = ctx.casterPos();
              z.pos.copy(p);
              const n = emitN(z, 'eB', 330, dt);
              for (let i = 0; i < n; i++) {
                const a = z.age * 6 + Math.random() * Math.PI * 2;
                const r = z.radius * (0.55 + 0.35 * Math.sin(z.age * 3 + a * 5));
                ctx.vfx.P.glow({ x: p.x + Math.cos(a) * r, y: p.y + 0.8 + Math.sin(a * 2) * 0.5, z: p.z + Math.sin(a) * r, vx: -Math.sin(a) * 18, vz: Math.cos(a) * 18, r: 0.55, g: 1.15, b: 1.9, life: 0.12, size: 0.1, stretch: 0.03, sprite: SPR.SHARD });
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
          ctx.fan(1, 2, (dir) => ctx.proj({ el: 'wind', vel: dir.multiplyScalar(38), radius: 0.4, life: 1.2, core: 0.3, mesh: 'crescent', meshScale: 1.25, light: 3, trail: 1.6, pierce: 2,
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
          // a visible blast of air: a short-lived swirling cone, pale streaks and
          // a wall of grey dust shoved forward (dust reads on bright floors too)
          ctx.vfx.cone({ element: 'wind', hot: [0.55, 0.7, 0.68], mid: [0.4, 0.52, 0.5], cool: [0.1, 0.14, 0.14], speed: 7, alpha: 1.2,
            life: 0.45, origin: o.clone().addScaledVector(d, 0.8), dir: d, len: ctx.aoe(9) * 0.9, radius: Math.tan(0.6) * ctx.aoe(9) * 0.75 });
          for (let i = 0; i < 46; i++) {
            const sx = d.x + rand(-0.4, 0.4), sy = d.y + rand(-0.2, 0.3), sz = d.z + rand(-0.4, 0.4);
            const f0 = rand(0.8, 2.5);
            ctx.vfx.P.glow({ x: o.x + d.x * f0, y: o.y + d.y * f0, z: o.z + d.z * f0, vx: sx * 24, vy: sy * 24, vz: sz * 24, r: 0.65, g: 0.85, b: 0.85, life: 0.45, size: 0.22, sprite: SPR.WISP, stretch: 0.035, drag: 3 });
          }
          for (let i = 0; i < 16; i++) {
            const sx = d.x + rand(-0.45, 0.45), sz = d.z + rand(-0.45, 0.45), f0 = rand(1.5, 3.5);
            ctx.vfx.P.solid({ x: o.x + d.x * f0, y: o.y - rand(0.3, 1.0), z: o.z + d.z * f0, vx: sx * 14, vy: rand(-0.5, 1.5), vz: sz * 14, r: 0.42, g: 0.44, b: 0.42, a: 0.3, life: 0.9, size: 0.5, size2: 1.8, sprite: SPR.SMOKE, drag: 2.5, spin: rand(-2, 2) });
          }
          const struck = ctx.rt.inCone(o, d, ctx.aoe(9), 0.6);
          let st = { stun: 0.4 };
          // augment: the gust carries Burn and Poison from any afflicted foe to all it strikes
          if (aug(ctx, 'wind_gale')) {
            const m = augM(ctx, 'wind_gale');
            let burn = false, poison = 0;
            for (const a of struck) { if (a.mask & ST.burn) burn = true; if (a.mask & ST.poison) poison = Math.max(poison, a.stacks?.poison ?? 1); }
            if (burn || poison) {
              st = { stun: 0.4 };
              if (burn) st.burn = [4, 6 * m];
              if (poison) st.poison = [Math.min(6, Math.max(2, Math.ceil(poison / 2))), 2.5 * m];
              for (let i = 0; i < 40; i++) {
                const fire = burn && (!poison || i % 2);
                const sx = d.x + rand(-0.45, 0.45), sy = d.y + rand(-0.15, 0.3), sz = d.z + rand(-0.45, 0.45), f0 = rand(0.8, 3);
                ctx.vfx.P.glow({ x: o.x + d.x * f0, y: o.y + d.y * f0 - 0.3, z: o.z + d.z * f0, vx: sx * 20, vy: sy * 20, vz: sz * 20, r: fire ? 1.6 : 0.6, g: fire ? 0.5 : 1.5, b: fire ? 0.08 : 0.15, r2: fire ? 0.4 : 0.1, g2: fire ? 0.05 : 0.3, b2: 0, life: 0.55, size: fire ? 0.3 : 0.22, size2: 0.05, sprite: fire ? SPR.FLAME : SPR.BUBBLE, drag: 2.5 });
              }
            }
          }
          for (const a of struck) ctx.hit(a, { dmg: 16, el: 'wind', kb: 20, st }, v3(a.pos.x, a.pos.y + 1, a.pos.z));
          ctx.kick(0.1, 2);
        },
      },
      ability1: {
        name: 'Tornado', icon: 'tornado', desc: 'Send forth a tornado that drags and shreds enemies.', cd: 10, style: 'thrust', hand: 'both',
        cast(ctx) {
          ctx.sound('cast_wind_big');
          const snd = ctx.loop('loop_tornado');
          // twisting dust funnel (mesh) with wisps and flung debris around it
          const fun = ctx.vfx.funnel({ r0: 0.35, r1: 2.1, height: 5.5, snake: 0.35, spin: 2.8, twist: 3.5, color: [0.2, 0.21, 0.2], hi: [0.62, 0.7, 0.68], alpha: 0.85 });
          const base = v3();
          // augment: the cyclone hunts the nearest foe and bursts outward when it dies down
          const hunt = aug(ctx, 'wind_tornado');
          ctx.proj({ el: 'wind', pos: ctx.casterPos().clone().add(v3(0, 0.3, 0)).addScaledVector(ctx.flatDir(), 1.5), vel: ctx.flatDir().multiplyScalar(6.5), radius: 1.6, life: 5, core: 0, light: 3, trail: 0, pierce: 999, noWall: false,
            data: { acc: 0 },
            onTick: (p, dt) => {
              p.pos.y = ctx.groundAt(p.pos.x, p.pos.z) + 0.3;
              snd?.setPos(p.pos);
              if (hunt) {
                p.data.seekT = (p.data.seekT ?? 0) - dt;
                if (p.data.seekT <= 0) { p.data.seekT = 0.3; p.data.tgt = ctx.rt.nearest(p.pos, 16); }
                const t = p.data.tgt;
                if (t && !t.dead) {
                  const dx = t.pos.x - p.pos.x, dz = t.pos.z - p.pos.z, dl = Math.hypot(dx, dz) || 1;
                  const k = Math.min(1, dt * 2.5);
                  p.vel.x += (dx / dl * 7.5 - p.vel.x) * k;
                  p.vel.z += (dz / dl * 7.5 - p.vel.z) * k;
                  p.vel.y = 0;
                }
              }
              fun.update(base.set(p.pos.x, p.pos.y - 0.3, p.pos.z), Math.min(1, (p.life - p.age) / 0.4));
              const nw = emitN(p.data, 'eW', 150, dt);
              for (let i = 0; i < nw; i++) {
                const h = Math.random() * 5, a = Math.random() * Math.PI * 2, r = 0.35 + Math.pow(h / 5, 1.6) * 1.8;
                ctx.vfx.P.glow({ x: p.pos.x + Math.cos(a) * r, y: p.pos.y + h, z: p.pos.z + Math.sin(a) * r, vx: -Math.sin(a) * 9 * r, vy: 2, vz: Math.cos(a) * 9 * r, r: 0.5, g: 0.62, b: 0.6, life: 0.3, size: 0.18, sprite: SPR.WISP, stretch: 0.06, drag: 1 });
              }
              // debris: grit and stones whipped around and flung out
              const nd = emitN(p.data, 'eD', 45, dt);
              for (let i = 0; i < nd; i++) {
                const h = Math.random() * 3.5, a = Math.random() * Math.PI * 2, r = 0.4 + h * 0.3;
                ctx.vfx.P.solid({ x: p.pos.x + Math.cos(a) * r, y: p.pos.y + h, z: p.pos.z + Math.sin(a) * r, vx: -Math.sin(a) * 9 + Math.cos(a) * 2, vy: rand(2, 5), vz: Math.cos(a) * 9 + Math.sin(a) * 2, r: 0.2, g: 0.17, b: 0.13, life: rand(0.6, 1.1), size: rand(0.04, 0.12), sprite: SPR.CHUNK, gravity: 9, spin: rand(-8, 8), drag: 0.8 });
              }
              const ns = emitN(p.data, 'eS', 10, dt);
              for (let i = 0; i < ns; i++) ctx.vfx.P.solid({ x: p.pos.x + rand(-0.8, 0.8), y: p.pos.y - 0.1, z: p.pos.z + rand(-0.8, 0.8), vx: rand(-3, 3), vy: rand(0.5, 1.5), vz: rand(-3, 3), r: 0.3, g: 0.27, b: 0.22, a: 0.4, life: 1.2, size: 0.8, size2: 2.2, sprite: SPR.SMOKE, drag: 1.2, spin: rand(-1, 1) });
              p.data.acc += dt;
              if (p.data.acc > 0.2) {
                p.data.acc = 0;
                for (const a of ctx.rt.inRadius(p.pos, ctx.aoe(3.2))) {
                  ctx.hit(a, { dmg: 7, el: 'wind', pull: [p.pos.x, p.pos.z, 10] }, v3(a.pos.x, a.pos.y + 1, a.pos.z));
                }
              }
            },
            onExpire: (p, pos) => {
              snd?.stop(0.5); fun.release(0.5);
              if (!hunt || cleared(p)) return;
              const m = augM(ctx, 'wind_tornado');
              const c = v3(pos.x, pos.y + 0.8, pos.z);
              ctx.vfx.explosion(c, 'wind', 4, { groundY: pos.y - 0.3 });
              ctx.vfx.ring(v3(pos.x, pos.y - 0.3, pos.z), ctx.aoe(5), fxOf('wind').core, 0.45, 0.3);
              ctx.sound('cast_wind_big', 0.8, c);
              ctx.area(c, ctx.aoe(5), { dmg: 32 * m, el: 'wind', st: { stun: 0.6 }, kb: 18 });
            } });
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
          // augment: crash back down in a shockwave, harder the further you fell
          if (aug(ctx, 'wind_updraft')) {
            const m = augM(ctx, 'wind_updraft');
            ctx.zone({ pos: p.clone(), radius: 0, life: 6, interval: 0.04,
              onTick: (z) => {
                if (z.done) return;
                const q = ctx.casterPos();
                z.top = Math.max(z.top ?? q.y, q.y);
                const gy = ctx.groundAt(q.x, q.z);
                if (z.age < 0.35 || q.y > gy + 0.12) return;
                z.done = true; z.life = z.age;
                const fall = Math.max(0, z.top - gy);
                const R = ctx.aoe(4.5 + Math.min(3, fall * 0.4));
                const c = v3(q.x, gy + 0.3, q.z);
                ctx.vfx.explosion(c, 'wind', 3 + Math.min(2, fall * 0.3), { groundY: gy });
                ctx.vfx.ring(v3(q.x, gy, q.z), R, fxOf('wind').core, 0.45, 0.35);
                ctx.vfx.decal(v3(q.x, gy, q.z), 'crack', R * 1.2, 4);
                ctx.sound('shockwave', 0.9, c);
                ctx.kick(0.3, 4);
                ctx.area(v3(q.x, gy + 1, q.z), R, { dmg: (28 + Math.min(40, fall * 6)) * m, el: 'wind', st: { stun: 1 }, kb: 16 });
              } });
          }
        },
      },
      ultimate: {
        name: 'Hurricane', icon: 'storm', desc: 'Become the eye of a hurricane that drags in and shreds all nearby (6s).', cost: 100, style: 'raise', hand: 'both',
        cast(ctx) {
          ctx.sound('cast_wind_big', 1.3);
          const snd = ctx.loop('loop_tornado');
          const RR = ctx.aoe(10);
          // the eye wall: a slow, wide funnel around the caster (it fades where
          // it nears the camera), plus a ring of debris and wind streaks
          const wall = ctx.vfx.funnel({ r0: Math.min(3.5, RR * 0.4), r1: RR * 0.75, height: 7, snake: 0.4, spin: 1.2, twist: 2, color: [0.16, 0.18, 0.18], hi: [0.55, 0.64, 0.62], alpha: 0.55 });
          const base = v3();
          ctx.zone({ follow: true, pos: ctx.casterPos().clone(), radius: RR, life: 6, interval: 0.2, el: 'wind', dmg: 9, pull: 6,
            visual: (z, dt) => {
              const p = ctx.casterPos();
              z.pos.copy(p);
              snd?.setPos(p);
              wall.update(base.set(p.x, ctx.groundAt(p.x, p.z) - 0.2, p.z), Math.min(1, (z.life - z.age) / 0.6));
              const nw = emitN(z, 'eW', 300, dt);
              for (let i = 0; i < nw; i++) {
                const a = Math.random() * Math.PI * 2, r = z.radius * rand(0.35, 1);
                ctx.vfx.P.glow({ x: p.x + Math.cos(a) * r, y: p.y + rand(0, 4.5), z: p.z + Math.sin(a) * r, vx: -Math.sin(a) * 16, vy: 1, vz: Math.cos(a) * 16, r: 0.5, g: 0.65, b: 0.64, life: 0.35, size: 0.16, sprite: SPR.WISP, stretch: 0.07 });
              }
              const nd = emitN(z, 'eD', 70, dt);
              for (let i = 0; i < nd; i++) {
                const a = Math.random() * Math.PI * 2, r = z.radius * rand(0.45, 0.95);
                ctx.vfx.P.solid({ x: p.x + Math.cos(a) * r, y: p.y + rand(0, 3), z: p.z + Math.sin(a) * r, vx: -Math.sin(a) * 14, vy: rand(1, 4), vz: Math.cos(a) * 14, r: 0.2, g: 0.17, b: 0.13, life: rand(0.5, 1), size: rand(0.05, 0.14), sprite: SPR.CHUNK, gravity: 6, spin: rand(-8, 8), drag: 0.6 });
              }
              const ns = emitN(z, 'eS', 14, dt);
              for (let i = 0; i < ns; i++) {
                const a = Math.random() * Math.PI * 2, r = z.radius * rand(0.6, 1);
                ctx.vfx.P.solid({ x: p.x + Math.cos(a) * r, y: p.y + rand(0, 1), z: p.z + Math.sin(a) * r, vx: -Math.sin(a) * 8, vy: 1, vz: Math.cos(a) * 8, r: 0.3, g: 0.29, b: 0.26, a: 0.35, life: 1.4, size: 1, size2: 3, sprite: SPR.SMOKE, drag: 0.8, spin: rand(-1, 1) });
              }
            },
            onEnd: () => { snd?.stop(0.6); wall.release(0.6); } });
        },
      },
    },
  },
};

export const CLASS_LIST = Object.keys(CLASSES).map((id) => ({ id, ...CLASS_META[id], ...CLASSES[id] }));
export const SLOTS = ['primary', 'secondary', 'ability1', 'ability2', 'ultimate'];
