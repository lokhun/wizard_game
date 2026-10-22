// ---------------------------------------------------------------------------
// Enemy definitions. Numbers are base values for floor 1 / one player; the
// director scales hp and damage by floor and party size.
//
// ai: 'melee' | 'ranged' | 'caster' | 'flyer' | 'support' | 'boss'
// attacks: list of { id, kind, ... } where kind is one of
//   'melee'   - instant arc in front at strike time (range, arc)
//   'lunge'   - melee with a forward leap
//   'shoot'   - projectile(s) toward target (speed, count, spread, gravity, el, mesh)
//   'lob'     - arcing projectile that leaves a pool (pool radius/dur)
//   'circle'  - telegraphed circle at target (radius, delay)
//   'nova'    - telegraphed circle around self
//   'charge'  - telegraphed rect then dash (len, width)
//   'summon'  - spawns minions
//   'heal'    - heals nearby allies
//   'blink'   - teleports
// ---------------------------------------------------------------------------

export const ENEMY_DEFS = {
  // ----------------------------------------------------------- SEWERS
  rat: {
    name: 'Plague Rat', hp: 20, speed: 6.2, dmg: 5, cost: 1, ai: 'melee', poise: 5, gold: 1, sound: 'rat_squeak', deathSound: 'rat_death', hitSound: 'enemy_hit',
    attacks: [{ id: 'bite', kind: 'lunge', range: 1.6, arc: 1.4, windup: 0.32, recover: 0.6, anim: 'bite', leap: 5 }],
    flank: true, pack: [3, 6],
  },
  slime: {
    name: 'Sewer Ooze', hp: 70, speed: 2.6, dmg: 10, cost: 3, ai: 'melee', poise: 30, gold: 2, sound: 'slime_squish', deathSound: 'slime_death', hitSound: 'slime_squish',
    attacks: [{ id: 'engulf', kind: 'lunge', range: 1.9, arc: 1.6, windup: 0.6, recover: 0.8, anim: 'attack', leap: 6 }],
    splitInto: 'slimeling', splits: 2, resist: { poison: 0.5 },
  },
  slimeling: {
    name: 'Ooze Spawn', hp: 22, speed: 4, dmg: 5, cost: 1, ai: 'melee', poise: 5, gold: 0, sound: 'slime_squish', deathSound: 'slime_death', scale: 0.55, model: 'slime',
    attacks: [{ id: 'engulf', kind: 'lunge', range: 1.3, arc: 1.6, windup: 0.4, recover: 0.6, anim: 'attack', leap: 4 }],
  },
  ghoul: {
    name: 'Drowned Ghoul', hp: 90, speed: 4.6, dmg: 13, cost: 4, ai: 'melee', poise: 35, gold: 3, sound: 'ghoul_growl', deathSound: 'enemy_death', undead: true,
    attacks: [
      { id: 'claw', kind: 'melee', range: 2.1, arc: 1.5, windup: 0.45, recover: 0.55, anim: 'swing' },
      { id: 'pounce', kind: 'lunge', range: 6, minRange: 3, arc: 1.2, windup: 0.6, recover: 0.9, anim: 'charge', leap: 13, cd: 5, dmgMult: 1.4 },
    ],
  },
  bilespitter: {
    name: 'Bilespitter', hp: 70, speed: 3.0, dmg: 12, cost: 4, ai: 'ranged', range: [7, 14], poise: 25, gold: 3, sound: 'ghoul_growl', deathSound: 'slime_death',
    attacks: [{ id: 'spit', kind: 'lob', windup: 0.8, recover: 1.4, anim: 'spit', el: 'enemyGreen', speed: 13, pool: { radius: 2.4, dur: 4, dps: 7 }, cd: 2 }],
    deathPool: { radius: 3, dur: 4, dps: 6 },
  },
  ratShaman: {
    name: 'Rat Shaman', hp: 60, speed: 3.4, dmg: 9, cost: 5, ai: 'support', range: [8, 15], poise: 20, gold: 5, sound: 'rat_squeak', deathSound: 'rat_death',
    attacks: [
      { id: 'heal', kind: 'heal', windup: 1.0, recover: 1.0, anim: 'cast', amount: 30, radius: 9, cd: 5 },
      { id: 'bolt', kind: 'shoot', windup: 0.6, recover: 1.0, anim: 'cast', el: 'enemyGreen', speed: 18, count: 1, cd: 1.8 },
      { id: 'summon', kind: 'summon', windup: 1.2, recover: 1.0, anim: 'summon', type: 'rat', count: 3, cd: 10 },
    ],
  },
  ratOgre: {
    name: 'Plague Ogre', hp: 600, speed: 3.6, dmg: 26, cost: 18, ai: 'melee', poise: 200, gold: 20, elite: true, sound: 'beast_growl', deathSound: 'boss_roar', scale: 1,
    attacks: [
      { id: 'cleave', kind: 'melee', range: 3.4, arc: 2.0, windup: 0.8, recover: 0.9, anim: 'swing' },
      { id: 'slam', kind: 'nova', radius: 5, windup: 1.1, recover: 1.2, anim: 'slam', cd: 6, dmgMult: 1.3, st: { stun: 0.6 } },
      { id: 'charge', kind: 'charge', len: 14, width: 3, windup: 0.9, recover: 1.4, anim: 'charge', cd: 8, speed: 18 },
    ],
  },

  // ----------------------------------------------------------- DUNGEON
  skeleton: {
    name: 'Skeleton Warrior', hp: 60, speed: 4.2, dmg: 11, cost: 2, ai: 'melee', poise: 20, gold: 2, sound: 'skeleton_rattle', deathSound: 'skeleton_death', hitSound: 'enemy_hit_bone', undead: true,
    attacks: [{ id: 'slash', kind: 'melee', range: 2.2, arc: 1.4, windup: 0.5, recover: 0.6, anim: 'swing' }],
    reassemble: 0.35, resist: { poison: 0.65, blood: 0.7 },
  },
  skeletonArcher: {
    name: 'Skeleton Archer', hp: 45, speed: 3.6, dmg: 10, cost: 3, ai: 'ranged', range: [9, 18], poise: 15, gold: 2, sound: 'skeleton_rattle', deathSound: 'skeleton_death', hitSound: 'enemy_hit_bone', undead: true,
    attacks: [{ id: 'arrow', kind: 'shoot', windup: 0.9, recover: 0.9, anim: 'shoot', el: 'physical', speed: 34, count: 1, mesh: 'arrow', laser: true, cd: 1.4 }],
    resist: { poison: 0.65, blood: 0.7 },
  },
  wraith: {
    name: 'Wraith', hp: 80, speed: 4.4, dmg: 12, cost: 4, ai: 'flyer', poise: 25, gold: 4, sound: 'ghost_wail', deathSound: 'ghost_wail', undead: true, flying: true,
    attacks: [
      { id: 'touch', kind: 'melee', range: 2.2, arc: 1.6, windup: 0.5, recover: 0.6, anim: 'swing', st: { slow: 1.5 } },
      { id: 'shriek', kind: 'shoot', windup: 0.8, recover: 1.0, anim: 'cast', el: 'enemyPurple', speed: 14, count: 3, spread: 0.25, homing: 1.5, cd: 4 },
      { id: 'phase', kind: 'blink', windup: 0.4, recover: 0.4, anim: 'cast', cd: 7, dist: 7 },
    ],
    resist: { physical: 0.5, poison: 0.65, blood: 0.7 },
  },
  jailer: {
    name: 'Jailer', hp: 200, speed: 3.4, dmg: 18, cost: 7, ai: 'melee', poise: 120, gold: 6, sound: 'armor_clank', deathSound: 'enemy_death', hitSound: 'enemy_hit_armor',
    attacks: [
      { id: 'bash', kind: 'melee', range: 2.6, arc: 1.4, windup: 0.7, recover: 0.8, anim: 'swing', kb: 8 },
      { id: 'slam', kind: 'nova', radius: 4, windup: 1.0, recover: 1.0, anim: 'slam', cd: 6, st: { stun: 0.5 } },
    ],
    frontShield: 0.5, armor: 0.2,
  },
  executionerGuard: {
    name: 'Headsman', hp: 650, speed: 3.5, dmg: 30, cost: 18, ai: 'melee', poise: 250, gold: 20, elite: true, sound: 'beast_growl', deathSound: 'boss_roar', hitSound: 'enemy_hit',
    attacks: [
      { id: 'chop', kind: 'circle', radius: 2.6, ahead: 2.8, windup: 1.0, recover: 1.0, anim: 'slam', dmgMult: 1.3 },
      { id: 'sweep', kind: 'melee', range: 3.6, arc: 2.6, windup: 0.8, recover: 0.9, anim: 'sweep' },
      { id: 'charge', kind: 'charge', len: 12, width: 2.5, windup: 0.8, recover: 1.2, anim: 'charge', cd: 7, speed: 16 },
    ],
  },

  // ----------------------------------------------------------- COURTYARD
  fallenKnight: {
    name: 'Fallen Knight', hp: 160, speed: 4.0, dmg: 18, cost: 5, ai: 'melee', poise: 80, gold: 5, sound: 'armor_clank', deathSound: 'skeleton_death', hitSound: 'enemy_hit_armor', undead: true,
    attacks: [
      { id: 'slash', kind: 'melee', range: 2.6, arc: 1.5, windup: 0.55, recover: 0.6, anim: 'swing' },
      { id: 'thrust', kind: 'lunge', range: 5, minRange: 2.5, arc: 0.8, windup: 0.6, recover: 0.8, anim: 'thrust', leap: 10, cd: 4 },
    ],
    armor: 0.15,
  },
  hound: {
    name: 'Hellhound', hp: 70, speed: 7.5, dmg: 12, cost: 3, ai: 'melee', poise: 20, gold: 2, sound: 'beast_growl', deathSound: 'beast_growl', flank: true, pack: [2, 4],
    attacks: [{ id: 'bite', kind: 'lunge', range: 2.0, arc: 1.4, windup: 0.35, recover: 0.6, anim: 'bite', leap: 7, st: { burn: [2, 3] } }],
    resist: { fire: 0.6 },
  },
  gargoyle: {
    name: 'Gargoyle', hp: 110, speed: 5.0, dmg: 16, cost: 5, ai: 'flyer', poise: 60, gold: 5, sound: 'stone_grind', deathSound: 'stone_grind', hitSound: 'enemy_hit_armor', flying: true,
    attacks: [
      { id: 'dive', kind: 'charge', len: 12, width: 2, windup: 0.8, recover: 1.0, anim: 'charge', speed: 20, cd: 3 },
      { id: 'claw', kind: 'melee', range: 2.2, arc: 1.5, windup: 0.45, recover: 0.6, anim: 'swing' },
    ],
    armor: 0.2, resist: { earth: 0.5, poison: 0.5 },
  },
  battlePriest: {
    name: 'Battle Priest', hp: 110, speed: 3.2, dmg: 12, cost: 6, ai: 'support', range: [8, 14], poise: 40, gold: 6, sound: 'enemy_cast', deathSound: 'enemy_death', undead: true,
    attacks: [
      { id: 'ward', kind: 'heal', windup: 1.0, recover: 1.0, anim: 'cast', amount: 50, radius: 10, cd: 6, shield: true },
      { id: 'smite', kind: 'circle', radius: 2.4, windup: 1.1, recover: 1.0, anim: 'cast', el: 'holy', cd: 3 },
    ],
  },
  knightCaptain: {
    name: 'Knight-Captain', hp: 900, speed: 4.2, dmg: 30, cost: 20, ai: 'melee', poise: 300, gold: 25, elite: true, sound: 'armor_clank', deathSound: 'boss_roar', hitSound: 'enemy_hit_armor', undead: true,
    attacks: [
      { id: 'cleave', kind: 'melee', range: 3.6, arc: 2.2, windup: 0.75, recover: 0.8, anim: 'sweep' },
      { id: 'overhead', kind: 'circle', radius: 3, ahead: 3, windup: 1.0, recover: 1.0, anim: 'slam', dmgMult: 1.4 },
      { id: 'charge', kind: 'charge', len: 16, width: 3, windup: 0.9, recover: 1.2, anim: 'charge', cd: 7, speed: 20 },
      { id: 'rally', kind: 'summon', windup: 1.2, recover: 1, anim: 'roar', type: 'fallenKnight', count: 2, cd: 15 },
    ],
    armor: 0.25,
  },

  // ----------------------------------------------------------- KEEP
  animatedArmor: {
    name: 'Animated Armor', hp: 220, speed: 3.6, dmg: 20, cost: 6, ai: 'melee', poise: 150, gold: 6, sound: 'armor_clank', deathSound: 'armor_clank', hitSound: 'enemy_hit_armor',
    attacks: [
      { id: 'swing', kind: 'melee', range: 3.0, arc: 1.6, windup: 0.65, recover: 0.7, anim: 'swing' },
      { id: 'spin', kind: 'nova', radius: 3.6, windup: 0.9, recover: 0.9, anim: 'spin', cd: 6 },
    ],
    armor: 0.3, resist: { poison: 0.65, blood: 0.65, lightning: 1.4 },
  },
  grimoire: {
    name: 'Hungering Grimoire', hp: 40, speed: 5.5, dmg: 8, cost: 2, ai: 'flyer', poise: 5, gold: 2, sound: 'book_flap', deathSound: 'book_flap', flying: true, pack: [2, 4],
    attacks: [
      { id: 'bite', kind: 'lunge', range: 1.8, arc: 1.4, windup: 0.3, recover: 0.6, anim: 'bite', leap: 6 },
      { id: 'bolt', kind: 'shoot', windup: 0.6, recover: 1.0, anim: 'cast', el: 'arcane', speed: 18, count: 1, cd: 3 },
    ],
    resist: { fire: 1.5 },
  },
  courtSorcerer: {
    name: 'Court Sorcerer', hp: 120, speed: 3.4, dmg: 14, cost: 6, ai: 'caster', range: [9, 16], poise: 40, gold: 7, sound: 'enemy_cast', deathSound: 'enemy_death', flying: true,
    attacks: [
      { id: 'volley', kind: 'shoot', windup: 0.7, recover: 0.9, anim: 'cast', el: 'enemyPurple', speed: 20, count: 3, spread: 0.18, cd: 2 },
      { id: 'rune', kind: 'circle', radius: 3, windup: 1.2, recover: 0.8, anim: 'cast', el: 'arcane', cd: 4, count: 2 },
      { id: 'blink', kind: 'blink', windup: 0.3, recover: 0.4, anim: 'cast', cd: 6, dist: 9 },
    ],
  },
  imp: {
    name: 'Fire Imp', hp: 45, speed: 6.5, dmg: 9, cost: 2, ai: 'flyer', poise: 10, gold: 2, sound: 'imp_screech', deathSound: 'imp_screech', flying: true, pack: [2, 4],
    attacks: [
      { id: 'fireball', kind: 'shoot', windup: 0.6, recover: 1.0, anim: 'cast', el: 'enemyFire', speed: 16, count: 1, cd: 2.2, aoe: 1.6 },
      { id: 'claw', kind: 'lunge', range: 1.8, arc: 1.4, windup: 0.35, recover: 0.6, anim: 'bite', leap: 6, st: { burn: [2, 3] } },
    ],
    resist: { fire: 0.6 }, deathExplode: { radius: 2.5, el: 'enemyFire' },
  },
  archivistLich: {
    name: 'Archivist Lich', hp: 800, speed: 3.0, dmg: 22, cost: 22, ai: 'caster', range: [8, 16], poise: 250, gold: 30, elite: true, sound: 'enemy_cast', deathSound: 'boss_roar', undead: true, flying: true,
    attacks: [
      { id: 'barrage', kind: 'shoot', windup: 0.8, recover: 0.8, anim: 'cast', el: 'enemyGreen', speed: 16, count: 7, spread: 0.6, cd: 2.5 },
      { id: 'runes', kind: 'circle', radius: 3.2, windup: 1.2, recover: 1, anim: 'cast', el: 'necrotic', count: 4, cd: 5 },
      { id: 'raise', kind: 'summon', windup: 1.4, recover: 1, anim: 'summon', type: 'grimoire', count: 3, cd: 12 },
      { id: 'blink', kind: 'blink', windup: 0.4, recover: 0.4, anim: 'cast', cd: 8, dist: 10 },
    ],
  },

  // ----------------------------------------------------------- THRONE
  royalGuard: {
    name: 'Hollow Royal Guard', hp: 380, speed: 4.0, dmg: 26, cost: 10, ai: 'melee', poise: 200, gold: 12, sound: 'armor_clank', deathSound: 'skeleton_death', hitSound: 'enemy_hit_armor', undead: true,
    attacks: [
      { id: 'halberd', kind: 'melee', range: 3.8, arc: 1.2, windup: 0.7, recover: 0.7, anim: 'thrust' },
      { id: 'sweep', kind: 'nova', radius: 4.2, windup: 1.0, recover: 0.9, anim: 'sweep', cd: 5 },
      { id: 'charge', kind: 'charge', len: 12, width: 2.4, windup: 0.8, recover: 1.0, anim: 'charge', cd: 7, speed: 18 },
    ],
    armor: 0.3, frontShield: 0.4,
  },

  plagueDoctor: {
    name: 'Plague Surgeon', hp: 95, speed: 3.3, dmg: 11, cost: 6, ai: 'support', range: [7, 13], poise: 30, gold: 6, sound: 'enemy_cast', deathSound: 'enemy_death',
    attacks: [
      // flasks of rot that leave a lingering poison pool: keep moving
      { id: 'lob', kind: 'lob', windup: 0.75, recover: 1.1, anim: 'lob', el: 'enemyGreen', speed: 12, pool: { radius: 2.6, dur: 5, dps: 8 }, cd: 2.4 },
      // the censer's smoke mends nearby prisoners
      { id: 'cense', kind: 'heal', windup: 1.1, recover: 0.9, anim: 'cense', amount: 40, radius: 9, cd: 7 },
      { id: 'saw', kind: 'melee', range: 2.0, arc: 1.3, windup: 0.4, recover: 0.6, anim: 'saw', st: { bleed: [3, 4] } },
    ],
  },
  grimWarden: {
    name: 'Grim Warden', hp: 700, speed: 2.6, dmg: 34, cost: 12, ai: 'melee', poise: 400, gold: 16, sound: 'armor_clank', deathSound: 'skeleton_death', hitSound: 'enemy_hit_armor', undead: true,
    attacks: [
      // a slow, enormous overhead: the ground cracks in a long line ahead of it
      { id: 'overhead', kind: 'circle', radius: 3.0, ahead: 2.8, windup: 1.25, recover: 1.2, anim: 'overhead', el: 'physical', st: { stun: 0.6 }, dmgMult: 1.4 },
      { id: 'sweep', kind: 'melee', range: 3.6, arc: 2.4, windup: 0.85, recover: 0.9, anim: 'sweep', kb: 16, cd: 3 },
    ],
    armor: 0.25,
  },
  gildedSentinel: {
    name: 'Gilded Sentinel', hp: 420, speed: 3.0, dmg: 24, cost: 8, ai: 'melee', poise: 260, gold: 10, sound: 'armor_clank', deathSound: 'skeleton_death', hitSound: 'enemy_hit_armor', undead: true,
    attacks: [
      { id: 'bash', kind: 'lunge', range: 2.6, arc: 1.3, windup: 0.75, recover: 0.9, anim: 'bash', leap: 8, kb: 14, st: { stun: 0.4 } },
      { id: 'slam', kind: 'melee', range: 2.9, arc: 1.0, windup: 0.9, recover: 0.8, anim: 'slam', dmgMult: 1.3, cd: 4 },
    ],
    // a tower shield turns most frontal damage: flank it, stun it, or go over it with area spells
    armor: 0.15, frontShield: 0.8,
  },
  hollowBannerman: {
    name: 'Hollow Bannerman', hp: 160, speed: 3.4, dmg: 10, cost: 6, ai: 'support', range: [5, 11], poise: 60, gold: 9, sound: 'skeleton_rattle', deathSound: 'skeleton_death', hitSound: 'enemy_hit_bone', undead: true,
    attacks: [
      { id: 'jab', kind: 'melee', range: 2.4, arc: 1.2, windup: 0.45, recover: 0.6, anim: 'jab' },
      { id: 'rally', kind: 'heal', rally: true, radius: 9, amount: 36, shield: true, windup: 1.0, recover: 0.8, anim: 'rally', cd: 9 },
    ],
    // its war-banner empowers every foe within 9 m (+30% damage, +15% speed): kill it first
    aura: { radius: 9, dmg: 1.3, speed: 1.15 },
  },

  // ----------------------------------------------------------- ENCOUNTERS (any realm, see encounters.js)
  // a treasure chest that bites: lies dormant until opened or struck, then hops after you
  mimic: {
    name: 'Mimic', hp: 230, speed: 4.8, dmg: 15, cost: 8, ai: 'melee', poise: 90, gold: 14, sound: 'mimic_growl', deathSound: 'mimic_death', hitSound: 'enemy_hit',
    attacks: [
      { id: 'chomp', kind: 'lunge', range: 2.4, arc: 1.5, windup: 0.5, recover: 0.75, anim: 'chomp', leap: 8 },
      { id: 'pounce', kind: 'nova', radius: 3.4, windup: 0.95, recover: 1.0, anim: 'pounce', cd: 7, dmgMult: 1.3, st: { stun: 0.4 } },
      { id: 'tongue', kind: 'melee', range: 4.6, arc: 0.5, windup: 0.6, recover: 0.8, anim: 'tongue', cd: 3.5, kb: -6, st: { slow: 1.5 } },
    ],
    // never wakes to sight or proximity, only to being struck or opened
    lurk: true,
  },
  // haunted rooms: spirits that drift through walls and pillars
  specter: {
    name: 'Restless Specter', hp: 40, speed: 3.4, dmg: 9, cost: 2, ai: 'flyer', poise: 10, gold: 1, sound: 'ghost_wail', deathSound: 'ghost_wail', undead: true, flying: true, model: 'wraith', tint: 0x7fd8ff, scale: 0.85,
    attacks: [{ id: 'touch', kind: 'melee', range: 2.0, arc: 1.6, windup: 0.55, recover: 0.7, anim: 'swing', st: { slow: 1.2 } }],
    resist: { physical: 0.5, poison: 0.65, blood: 0.7 }, phase: true,
  },

  // ----------------------------------------------------------- ALLIES (summons)
  skeletonMinion: {
    name: 'Risen Servant', hp: 80, speed: 5.0, dmg: 14, cost: 0, ai: 'melee', poise: 30, model: 'skeleton', ally: true, tint: 0x40ff60,
    attacks: [{ id: 'slash', kind: 'melee', range: 2.2, arc: 1.4, windup: 0.35, recover: 0.4, anim: 'swing' }],
  },
  spiritWolf: {
    name: 'Spirit Wolf', hp: 90, speed: 8.0, dmg: 16, cost: 0, ai: 'melee', poise: 30, model: 'hound', ally: true, tint: 0x90ff60,
    attacks: [{ id: 'bite', kind: 'lunge', range: 2.0, arc: 1.4, windup: 0.25, recover: 0.4, anim: 'bite', leap: 7, st: { poison: [2, 3] } }],
  },
};

// Bosses (behaviour scripted in bosses.js)
export const BOSS_DEFS = {
  motherOfFilth: { name: 'Mother of Filth', title: 'Queen of the Drowned Sewers', hp: 5760, dmg: 18, poise: 9999, gold: 60, model: 'motherOfFilth', speed: 2.2, sound: 'slime_squish', deathSound: 'boss_roar', resist: { poison: 0.75 } },
  executioner: { name: 'The Executioner', title: 'Headsman of the Oubliette', hp: 9360, dmg: 30, poise: 9999, gold: 80, model: 'executioner', speed: 4.2, sound: 'beast_growl', deathSound: 'boss_roar', hitSound: 'enemy_hit' },
  stoneWyvern: { name: 'Gravemaw', title: 'Stone Wyvern of the Bailey', hp: 17500, dmg: 34, poise: 9999, gold: 100, model: 'stoneWyvern', speed: 5, sound: 'stone_grind', deathSound: 'boss_roar', hitSound: 'enemy_hit_armor', resist: { earth: 0.8, poison: 0.8 } },
  courtArchmage: { name: 'Archmage Veyrin', title: 'The Court Archmage', hp: 23000, dmg: 34, poise: 9999, gold: 120, model: 'courtArchmage', speed: 4, sound: 'enemy_cast', deathSound: 'boss_roar', flying: true },
  hollowKing: { name: 'The Hollow King', title: 'Last Lord of the Ashen Keep', hp: 36000, dmg: 40, poise: 9999, gold: 0, model: 'hollowKing', speed: 4.4, sound: 'boss_roar', deathSound: 'boss_roar', hitSound: 'enemy_hit_armor', undead: true },
};

// (a run's tomes and relics compound: the later realms keep pace with them)
export const FLOOR_HP = [1, 1.55, 2.25, 3.05, 4.0];
export const FLOOR_DMG = [1.1, 1.4, 1.75, 2.1, 2.55];

// Every def, and every attack, laid out with the same fields in the same order
// (missing ones undefined). The AI reads a.def.speed, at.kind, at.range... for
// every enemy every frame; across a dozen literal shapes those reads went
// megamorphic, which is slow and boxes every number it reads.
function sameShape(table) {
  const keys = [...new Set(Object.values(table).flatMap((o) => Object.keys(o)))];
  for (const id of Object.keys(table)) {
    const o = table[id], n = {};
    for (const k of keys) n[k] = o[k];
    table[id] = n;
  }
}
{
  const all = Object.values(ENEMY_DEFS).flatMap((d) => d.attacks ?? []);
  const keys = [...new Set(all.flatMap((o) => Object.keys(o)))];
  for (const d of Object.values(ENEMY_DEFS)) if (d.attacks) d.attacks = d.attacks.map((o) => { const n = {}; for (const k of keys) n[k] = o[k]; return n; });
  const defs = { ...ENEMY_DEFS, ...BOSS_DEFS };
  sameShape(defs);
  for (const id of Object.keys(ENEMY_DEFS)) ENEMY_DEFS[id] = defs[id];
  for (const id of Object.keys(BOSS_DEFS)) BOSS_DEFS[id] = defs[id];
}
