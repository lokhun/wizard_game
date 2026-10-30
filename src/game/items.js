import * as THREE from 'three';
import { SPR } from '../render/particles.js';
import { rand } from '../core/rng.js';
import { burningGround } from './caster.js';

// ---------------------------------------------------------------------------
// Consumable items: one slot, one press (the `item` key, X). Found on elites and
// bosses, in chests, and sold by the merchant; each wizard gets their own copy
// of an item that drops, as with gold. Walking over one fills an empty slot;
// with the slot full, the interact key swaps it for the one you carry (the old
// one is left where the new one lay).
//
// use(g, p, k) runs on the wizard's own machine and deals the effect through
// the usual paths (hitActor, healPlayersInRadius...), so the host settles it;
// show(g, at) is the look of it, played by everyone (the user broadcasts 'itemfx').
// k scales the damage with the realm and the Abyss (the wizard's own stats apply
// on top, through hitActor).
// ---------------------------------------------------------------------------

const v3 = (x, y, z) => new THREE.Vector3(x, y, z);

export const ITEMS = {
  flask: {
    glyph: '⚗', light: 0xff7a30,
    name: 'Fire Flask', icon: 'bomb', color: '#ff7a30',
    desc: 'Hurl a flask of liquid fire: a great blast that sets the ground alight.',
    use(g, p, k, at) { flask(g, p, at, true, k); },
    show(g, at) { flask(g, null, at, false, 1); },
  },
  frost: {
    glyph: '❄', light: 0x9ad8ff,
    name: 'Frost Phial', icon: 'snow', color: '#9ad8ff',
    desc: 'Shatter it at your feet: every foe within 8 m is frozen solid for 3 s (strike them to shatter).',
    use(g, p, k) { g.spells.damageArea(p.pos, 8, { dmg: 8 * k, el: 'frost', st: { freeze: 3 }, src: p.id }); },
    show(g, at) {
      g.vfx.explosion(v3(at.x, at.y + 0.6, at.z), 'frost', 8, { groundY: at.y });
      g.vfx.ring({ x: at.x, y: at.y + 0.1, z: at.z }, 8, [1.2, 2.2, 3], 0.7, 0.25);
      g.audio?.play('freeze', { pos: at });
    },
  },
  ward: {
    glyph: '✚', light: 0xffe08a,
    name: 'Warding Sigil', icon: 'shield', color: '#ffe08a',
    desc: 'You and allies within 10 m gain a shield of 35% of your health for 8 s; foes nearby are thrown back.',
    use(g, p, k) {
      g.shieldPlayersInRadius(p.pos, 10, p.maxHp * 0.35, 8);
      g.spells.damageArea(p.pos, 5, { dmg: 6 * k, el: 'holy', kb: 20, src: p.id });
    },
    show(g, at) {
      g.vfx.explosion(v3(at.x, at.y + 1, at.z), 'holy', 5, { groundY: at.y });
      g.vfx.ring({ x: at.x, y: at.y + 0.1, z: at.z }, 10, [2.4, 2, 0.9], 0.6, 0.2);
      g.audio?.play('shield', { pos: at });
    },
  },
  quick: {
    glyph: '☿', light: 0x40e0c8,
    name: 'Quicksilver', icon: 'speed', color: '#40e0c8',
    desc: 'Drink: hasted for 8 s, and every spell on cooldown comes back 4 s sooner.',
    use(g, p) {
      p.hasteT = Math.max(p.hasteT ?? 0, 8);
      p.recomputeStats(); // (the haste lives in the stats)
      for (const s in p.cds) p.cds[s] = Math.max(0, p.cds[s] - 4);
    },
    show(g, at) {
      g.vfx.burst(v3(at.x, at.y + 1, at.z), { count: 26, speed: 4, upward: 1, life: 0.7, size: 0.08, sprite: SPR.SPARK, color: [0.4, 2.4, 2], drag: 2 });
      g.audio?.play('buff', { pos: at });
    },
  },
  storm: {
    glyph: 'ϟ', light: 0xa0b8ff,
    name: 'Storm in a Bottle', icon: 'storm', color: '#a0b8ff',
    desc: 'Uncork it: eight lightning strikes fall on the foes around you over 2 s.',
    use(g, p, k) {
      for (let i = 0; i < 8; i++) {
        g.spells.after(0.15 + i * 0.26, () => {
          if (p.dead) return;
          const foes = g.spells.inRadius(p.pos, 16).filter((a) => a.alive && a.faction === 'enemy');
          const t = foes.length ? foes[Math.floor(Math.random() * foes.length)].pos : { x: p.pos.x + rand(-6, 6), y: p.pos.y, z: p.pos.z + rand(-6, 6) };
          const y = g.groundY(t.x, t.z);
          g.spells.damageArea({ x: t.x, y: y + 1, z: t.z }, 2.2, { dmg: 30 * k, el: 'lightning', st: { shock: 2 }, src: p.id });
          strike(g, { x: t.x, y, z: t.z });
          g.net?.broadcast({ t: 'itemfx', i: 'strike', x: t.x, y, z: t.z });
        });
      }
    },
    show(g, at) { g.audio?.play('cast_lightning_big', { pos: at }); },
  },
  draught: {
    glyph: '♥', light: 0xff5a6a,
    name: 'Healing Draught', icon: 'heart', color: '#ff5a6a',
    desc: 'Drink: restore 45% of your health.',
    use(g, p) { p.heal(p.maxHp * 0.45); g.healPulse = 1; },
    show(g, at) {
      g.vfx.burst(v3(at.x, at.y + 1, at.z), { element: 'holy', count: 18, speed: 1.6, upward: 1.4, life: 1, size: 0.12, sprite: SPR.STAR, color: [2.4, 0.6, 0.7] });
      g.audio?.play('heal', { pos: at });
    },
  },
  bell: {
    glyph: '♫', light: 0xffd060,
    name: 'Rallying Bell', icon: 'bell', color: '#ffd060',
    desc: 'Ring it: fallen allies within 16 m rise, and everyone in reach heals 25%. Alone, it heals 35% and shields you.',
    use(g, p) {
      const party = g.remotes.size > 0;
      g.reviveInRadius(p.pos, 16);
      g.healPlayersInRadius(p.pos, 16, p.maxHp * (party ? 0.25 : 0.35), p.id);
      if (!party) p.addShield(p.maxHp * 0.2, 6);
    },
    show(g, at) {
      g.vfx.ring({ x: at.x, y: at.y + 0.1, z: at.z }, 16, [2.6, 2, 0.6], 1.0, 0.18);
      g.vfx.burst(v3(at.x, at.y + 1.6, at.z), { element: 'holy', count: 24, speed: 2.5, upward: 1, life: 1.2, size: 0.14, sprite: SPR.STAR });
      g.audio?.play('revive', { pos: at });
      g.audio?.play('room_clear', { pos: at, volume: 0.6 });
    },
  },
};
export const ITEM_IDS = Object.keys(ITEMS);
export const randomItem = () => ITEM_IDS[Math.floor(Math.random() * ITEM_IDS.length)];

// realm and Abyss scaling of an item's damage
export function itemK(g) { return 1 + 0.45 * ((g.floorIndex ?? 0) + 5 * (g.abyss ?? 0)); }

// the thrown flask: lobbed from the wizard's eye along the aim; the user's copy deals the damage
function flask(g, p, at, local, k) {
  const pos = v3(at.x, at.y, at.z), dir = v3(at.dx, at.dy ?? 0.25, at.dz).normalize();
  g.spells.spawn({
    local, faction: 'player', owner: p?.id ?? 0, el: 'fire', pos, vel: dir.multiplyScalar(12).add(v3(0, 3.2, 0)), gravity: 16, // (a flat throw lands ~9 m off; aim up to throw further)
    radius: 0.25, life: 3,
    core: 0.8, mesh: 'orb', light: 7, trail: 1.2,
    hit: local ? { dmg: 20 * k, el: 'fire' } : null,
    aoe: { radius: 4.5, dmg: local ? 75 * k : 0, el: 'fire', st: { burn: [4, 8 * k] }, kb: 10 },
    // the flask leaves the ground burning (everyone sees it; the thrower's copy does the damage)
    onExpire: (c, cp) => {
      const gp = v3(cp.x, g.groundY(cp.x, cp.z), cp.z);
      g.spells.zone({ pos: gp, radius: 3.2, life: 4, interval: 0.4, el: 'fire', local,
        visual: (zz, dt) => burningGround(g, zz, dt),
        onTick: local ? () => g.spells.damageArea(gp, 3.2, { dmg: 6 * k, el: 'fire', st: { burn: [2, 5 * k] }, src: p.id }) : null });
    },
  });
  g.audio?.play('cast_fire', { pos });
}

// a bolt from the sky onto (x, y, z)
export function strike(g, t) {
  g.vfx.lightning(v3(t.x + rand(-1, 1), t.y + 14, t.z + rand(-1, 1)), v3(t.x, t.y, t.z), { color: [1.6, 1.8, 3] });
  g.vfx.explosion(v3(t.x, t.y + 0.3, t.z), 'lightning', 2.2, { groundY: t.y, shakeScale: 0.2 });
  g.lights.flash?.(v3(t.x, t.y + 1, t.z), 0xa0c0ff, 30, 10, 0.25);
  g.audio?.play('cast_lightning', { pos: t });
}
