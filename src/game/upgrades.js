import { CLASSES } from './classes.js';
import { NEW_RELICS, setCounts, ASCEND_MAX, ascendK, NO_ASCEND } from './relicDefs.js';

// ---------------------------------------------------------------------------
// Arcane Tomes (per-player upgrades picked 1-of-3 after rooms) and Relics.
// Rarity scales numbers (x1 / 1.3 / 1.6 / 2.0). Tomes with an element tag
// lean toward the player's school; others are universal.
// ---------------------------------------------------------------------------

export const RARITY = [
  { id: 'common', name: 'Common', mult: 1, color: '#c8c0b0', weight: 60 },
  { id: 'rare', name: 'Rare', mult: 1.3, color: '#4aa8ff', weight: 25 },
  { id: 'epic', name: 'Epic', mult: 1.6, color: '#b050ff', weight: 12 },
  { id: 'legendary', name: 'Legendary', mult: 2.0, color: '#ffb030', weight: 3 },
];

const pct = (x) => `${Math.round(x * 100)}%`;
const num = (x) => Math.round(x);

export const TOMES = [
  // ---------------- offence
  { id: 'empower', name: 'Tome of Power', icon: 'power', max: 99, desc: (m) => `+${pct(0.12 * m)} damage.`, apply: (s, m) => { s.dmgMult += 0.12 * m; } },
  { id: 'focus', name: 'Keen Focus', icon: 'crit', max: 8, desc: (m) => `+${pct(0.06 * m)} critical chance.`, apply: (s, m) => { s.critChance += 0.06 * m; } },
  { id: 'devastation', name: 'Devastation', icon: 'crit', max: 6, desc: (m) => `+${pct(0.3 * m)} critical damage.`, apply: (s, m) => { s.critMult += 0.3 * m; } },
  { id: 'haste', name: 'Quickened Casting', icon: 'speed', max: 6, desc: (m) => `+${pct(0.1 * m)} attack speed.`, apply: (s, m) => { s.rateMult += 0.1 * m; } },
  { id: 'cdr', name: 'Chronicle of Haste', icon: 'clock', max: 5, desc: (m) => `Abilities recharge ${pct(0.1 * m)} faster.`, apply: (s, m) => { s.cdr += 0.1 * m; } },
  { id: 'multicast', name: 'Multicast', icon: 'multi', max: 3, minRarity: 1, desc: () => `Primary fires +1 projectile.`, apply: (s) => { s.extraProj += 1; } },
  { id: 'pierce', name: 'Piercing Words', icon: 'pierce', max: 3, desc: () => `Projectiles pierce +1 enemy.`, apply: (s) => { s.pierce += 1; } },
  { id: 'ricochet', name: 'Ricochet Glyph', icon: 'bounce', max: 3, desc: () => `Projectiles bounce off walls once more.`, apply: (s) => { s.bounce += 1; } },
  { id: 'seeking', name: 'Seeking Sigil', icon: 'homing', max: 1, desc: () => `Projectiles gently home in on enemies.`, apply: (s) => { s.homing = Math.max(s.homing, 2.5); } },
  { id: 'split', name: 'Fractal Bolts', icon: 'split', max: 1, minRarity: 2, desc: () => `Primary projectiles split in two on hit.`, apply: (s) => { s.splitOnHit = true; } },
  { id: 'aoe', name: 'Expanding Sigils', icon: 'aoe', max: 5, desc: (m) => `+${pct(0.15 * m)} area of effect.`, apply: (s, m) => { s.aoeMult += 0.15 * m; } },
  { id: 'velocity', name: 'Velocity Rune', icon: 'speed', max: 3, desc: (m) => `+${pct(0.2 * m)} projectile speed and +${pct(0.05 * m)} damage.`, apply: (s, m) => { s.projSpeed += 0.2 * m; s.dmgMult += 0.05 * m; } },
  { id: 'ult', name: 'Ascendant Will', icon: 'ult', max: 4, desc: (m) => `Ultimate charges ${pct(0.25 * m)} faster (stacking gives less and less; never under ~10 s).`, apply: (s, m) => { s.ultRate += 0.25 * m; } },
  { id: 'glass', name: 'Glass Cannon', icon: 'glass', max: 1, minRarity: 2, desc: () => `+50% damage, but -30% max health.`, apply: (s) => { s.dmgMult += 0.5; s.maxHp *= 0.7; } },
  { id: 'executioner', name: "Executioner's Rite", icon: 'skull', max: 3, desc: (m) => `+${pct(0.35 * m)} damage to enemies below 30% health.`, apply: (s, m) => { s.execute = (s.execute ?? 0) + 0.35 * m; } },
  { id: 'elites', name: 'Giantslayer', icon: 'skull', max: 3, desc: (m) => `+${pct(0.2 * m)} damage to elites and bosses.`, apply: (s, m) => { s.bossDmg = (s.bossDmg ?? 0) + 0.2 * m; } },
  // ---------------- elemental infusions (primary applies a status)
  { id: 'ember', name: 'Ember Rune', icon: 'flame', el: 'fire', max: 1, desc: (m) => `Primary hits ignite (Burn ${Math.round(4 * m)}/s).`, apply: (s, m) => { s.infuse = { ...(s.infuse ?? {}), burn: [3, 4 * m] }; } },
  { id: 'rime', name: 'Rime Rune', icon: 'snow', el: 'frost', max: 1, desc: () => `Primary hits Chill enemies.`, apply: (s) => { s.infuse = { ...(s.infuse ?? {}), chill: 1 }; } },
  { id: 'static', name: 'Static Rune', icon: 'lightning', el: 'lightning', max: 1, desc: () => `Primary hits Shock (+10% damage taken).`, apply: (s) => { s.infuse = { ...(s.infuse ?? {}), shock: 3 }; } },
  { id: 'venom', name: 'Venom Rune', icon: 'drop', el: 'poison', max: 1, desc: (m) => `Primary hits Poison (${(2 * m).toFixed(1)}/s per stack).`, apply: (s, m) => { s.infuse = { ...(s.infuse ?? {}), poison: [1, 2 * m] }; } },
  { id: 'hexrune', name: 'Hex Rune', icon: 'hex', el: 'shadow', max: 1, minRarity: 1, desc: () => `Primary hits Hex (+25% damage taken) for 2s.`, apply: (s) => { s.infuse = { ...(s.infuse ?? {}), hex: 2 }; } },
  { id: 'bloodrune', name: 'Blood Rune', icon: 'drop', el: 'blood', max: 1, desc: (m) => `Primary hits cause Bleed (${Math.round(3 * m)}/s).`, apply: (s, m) => { s.infuse = { ...(s.infuse ?? {}), bleed: [3, 3 * m] }; } },
  { id: 'chronorune', name: 'Chrono Rune', icon: 'clock', el: 'time', max: 1, desc: () => `Primary hits Slow for 1s.`, apply: (s) => { s.infuse = { ...(s.infuse ?? {}), slow: 1 }; } },
  { id: 'elemental', name: 'Elemental Attunement', icon: 'power', max: 4, desc: (m) => `+${pct(0.2 * m)} damage with your own element.`, apply: (s, m, p) => { const el = p.meta.element; s.elementMult[el] = (s.elementMult[el] ?? 1) + 0.2 * m; } },
  // ---------------- defence / utility
  { id: 'vitality', name: 'Tome of Vitality', icon: 'heart', max: 99, desc: (m) => `+${Math.round(20 * m)} max health.`, apply: (s, m) => { s.maxHp += 20 * m; } },
  { id: 'ward', name: 'Warding Script', icon: 'shield', max: 4, desc: (m) => `Take ${pct(0.07 * m)} less damage.`, apply: (s, m) => { s.armor += 0.07 * m; } },
  // (the sustain tomes: rarer than the rest, and all on-hit and on-kill healing shares a cap of 3% max health a second)
  { id: 'regen', name: 'Troll Blood', icon: 'heart', max: 3, rare: 0.5, desc: (m) => `Regenerate ${(0.6 * m).toFixed(1)} health per second (a third as much for 4s after being hit).`, apply: (s, m) => { s.regen += 0.6 * m; } },
  { id: 'vampire', name: 'Vampiric Codex', icon: 'drop', max: 2, rare: 0.5, desc: (m) => `${pct(0.02 * m)} of damage dealt heals you (all lifesteal: at most 3% max health a second).`, apply: (s, m) => { s.lifesteal += 0.02 * m; } },
  { id: 'feast', name: 'Soul Feast', icon: 'skull', max: 2, rare: 0.5, desc: (m) => `Kills heal ${Math.round(2 * m)} health (with lifesteal, at most 3% max health a second).`, apply: (s, m) => { s.killHeal += 2 * m; } },
  { id: 'swift', name: 'Wind Walker', icon: 'speed', max: 4, desc: (m) => `+${pct(0.08 * m)} move speed.`, apply: (s, m) => { s.moveSpeed *= 1 + 0.08 * m; } },
  { id: 'dash', name: 'Phase Step', icon: 'dash', max: 2, desc: () => `+1 dash charge and dashes recharge 20% faster.`, apply: (s) => { s.dashCharges += 1; s.dashCd *= 0.8; } },
  // (a skill tome, not a dice roll: it widens the window a dash beats a blow in, and pays perfect dodges longer)
  { id: 'evasion', name: 'Blur', icon: 'dash', max: 3, desc: (m) => `Dashes stay untouchable ${Math.round(70 * m)} ms longer, and a perfect dodge's +25% damage lasts ${(1.5 * m).toFixed(1)} s longer.`, apply: (s, m) => { s.dashIv += 0.07 * m; s.pdDur += 1.5 * m; } },
  { id: 'thorns', name: 'Briar Ward', icon: 'thorn', max: 3, desc: (m) => `Attackers take ${Math.round(15 * m)} damage.`, apply: (s, m) => { s.thorns += 15 * m; } },
  { id: 'greed', name: "Miser's Ledger", icon: 'gold', max: 3, desc: (m) => `+${pct(0.25 * m)} gold found.`, apply: (s, m) => { s.goldMult += 0.25 * m; } },
  { id: 'phoenix', name: 'Phoenix Feather', icon: 'phoenix', max: 1, minRarity: 3, desc: () => `When you would fall, rise again at 50% health (once).`, apply: (s) => { s.extraLives = (s.extraLives ?? 0) + 1; }, once: true },
  { id: 'echo', name: 'Arcane Echo', icon: 'multi', max: 1, minRarity: 2, desc: () => `Abilities have a 25% chance to instantly recharge.`, apply: (s) => { s.echo = 0.25; } },
];

// ---------------- spell augments (class-only; change how one spell behaves)
// Each augment is Rare or better, max 1, and only rolls for its class. Its id
// lands in stats.aug (a Set) and stats.augSlot[slot] (sent with casts so
// teammates replay the same visuals); stats.augM[id] holds the rarity mult.
// The behaviour itself lives in that spell's code in classes.js.
export const AUGMENTS = [
  // pyromancer
  { id: 'pyro_fireball', cls: 'pyromancer', slot: 'ability1', name: 'Cinder Schism', desc: (m) => `Fireball bursts into 3 cinders that scatter, explode for ${num(24 * m)} and leave burning ground.` },
  { id: 'pyro_breath', cls: 'pyromancer', slot: 'secondary', name: "Wyrm's Last Gasp", desc: () => `Releasing Dragon's Breath exhales a fireball that swells the longer you breathed.` },
  { id: 'pyro_meteor', cls: 'pyromancer', slot: 'ultimate', name: "Heaven's Forge", desc: () => `Meteor Storm hunts Burning foes, and every impact leaves a pool of molten slag.` },
  // cryomancer
  { id: 'cryo_nova', cls: 'cryomancer', slot: 'ability1', name: 'Crown of Rime', desc: (m) => `Frost Nova raises ice spikes beneath foes and around you. After 1.5s they shatter for ${num(30 * m)}, Shattering the Frozen.` },
  { id: 'cryo_spike', cls: 'cryomancer', slot: 'ability2', name: 'Splintering Lance', desc: () => `When Glacial Spike breaks, it bursts into a ring of 8 piercing ice shards.` },
  { id: 'cryo_blizzard', cls: 'cryomancer', slot: 'ultimate', name: 'Hail of the Long Night', desc: (m) => `Great icicles plunge from the Blizzard onto Frozen and Chilled foes for ${num(50 * m)}.` },
  // stormcaller
  { id: 'storm_fork', cls: 'stormcaller', slot: 'primary', name: 'Forked Tongue', desc: () => `Chain Lightning splits at its first target into two separate chains, each dealing 80% damage.` },
  { id: 'storm_ball', cls: 'stormcaller', slot: 'secondary', name: 'Storm Anchor', desc: () => `Ball Lightning halts where you aim and lashes up to 3 foes with every pulse.` },
  { id: 'storm_blink', cls: 'stormcaller', slot: 'ability2', name: 'Path of the Conduit', desc: () => `Static Blink leaves a wall of lightning along its path for 3s that Shocks all who cross it.` },
  // arcanist
  { id: 'arc_blink', cls: 'arcanist', slot: 'ability1', name: 'Mirror Mantle', desc: () => `Blink leaves a mirror image behind that fires Arcane Missiles for 3s, then bursts.` },
  { id: 'arc_orb', cls: 'arcanist', slot: 'secondary', name: 'Wandering Moon', desc: () => `Arcane Orb returns to your hand, piercing everything again. Catching it refunds 2s of its cooldown.` },
  { id: 'arc_sing', cls: 'arcanist', slot: 'ultimate', name: 'Hungering Star', desc: () => `While Singularity pulls, it lashes every foe it holds with seeking missiles.` },
  // necromancer
  { id: 'necro_raise', cls: 'necromancer', slot: 'ability1', name: 'Corpse Pyre', desc: (m) => `Raised skeletons burst in necrotic flame for ${num(45 * m)} when they fall or expire.` },
  { id: 'necro_spear', cls: 'necromancer', slot: 'ability2', name: 'Ossuary Wake', desc: () => `Bone spikes erupt along Bone Spear's path, rooting foes. Their necrotic sting Blights the Bleeding.` },
  { id: 'necro_drain', cls: 'necromancer', slot: 'secondary', name: 'Twin Siphon', desc: () => `Life Drain forks to a second nearby foe, siphoning life from both.` },
  // blood mage
  { id: 'blood_scythe', cls: 'bloodmage', slot: 'secondary', name: 'Sated Reaper', desc: () => `Crimson Scythe costs no health above 80%, and looses a crescent of blood that carves through a line.` },
  { id: 'blood_pact', cls: 'bloodmage', slot: 'ability1', name: 'Tithe of Lances', desc: () => `The blood you sacrifice to Blood Pact erupts as homing lances, 1 per 5 health paid.` },
  { id: 'blood_nova', cls: 'bloodmage', slot: 'ultimate', name: 'Crimson Moonpool', desc: () => `Sanguine Nova leaves a pool of blood for 5s that makes foes Bleed and heals allies standing in it.` },
  // chronomancer
  { id: 'chrono_bomb', cls: 'chronomancer', slot: 'secondary', name: 'Recurrence', desc: () => `Time Bomb detonates again 1.2s later. The echo triggers Paradox on foes the first blast Slowed.` },
  { id: 'chrono_rewind', cls: 'chronomancer', slot: 'ability1', name: 'The Forsaken Moment', desc: (m) => `The self you leave behind when you Rewind detonates in shattered time for ${num(50 * m)}, Slowing and stunning.` },
  { id: 'chrono_stasis', cls: 'chronomancer', slot: 'ability2', name: 'Event Horizon', desc: (m) => `When Stasis Field ends it collapses inward, dragging foes to its heart for ${num(60 * m)} damage.` },
  // warlock
  { id: 'warlock_blast', cls: 'warlock', slot: 'primary', name: 'Witch-Splinters', desc: () => `Eldritch Blast bolts that strike a Hexed foe splinter into 2 seeking bolts.` },
  { id: 'warlock_hex', cls: 'warlock', slot: 'secondary', name: 'Spreading Malediction', desc: () => `Hex splits on impact into 3 curses that seek out other foes.` },
  { id: 'warlock_rift', cls: 'warlock', slot: 'ability1', name: 'Maw of the Deep', desc: (m) => `When Void Rift closes, tentacles burst from it to crush up to 4 foes inside for ${num(40 * m)}.` },
  // lightbinder
  { id: 'light_lance', cls: 'lightbinder', slot: 'primary', name: 'Dawnspear', desc: () => `Every 4th Holy Lance is a great spear of dawn that pierces everything and Judges foes.` },
  { id: 'light_sanct', cls: 'lightbinder', slot: 'ability1', name: 'Wandering Sanctum', desc: () => `Sanctuary no longer stays put: it is carried with you as a moving halo.` },
  { id: 'light_aegis', cls: 'lightbinder', slot: 'ability2', name: 'Wrath of the Aegis', desc: (m) => `Divine Aegis erupts in a stunning shockwave for ${num(30 * m)}, and again when the ward fades.` },
  // geomancer
  { id: 'geo_shot', cls: 'geomancer', slot: 'primary', name: 'Skipping Stones', desc: () => `Stone Shot skips along the ground twice, splashing on every bounce.` },
  { id: 'geo_spike', cls: 'geomancer', slot: 'secondary', name: 'Hunting Fault', desc: () => `Earthspike Line becomes a snaking fault that runs twice as far and veers toward foes.` },
  { id: 'geo_mountain', cls: 'geomancer', slot: 'ultimate', name: 'Rolling Doom', desc: () => `The boulder of Mountain's Fall rolls on after landing, crushing all in its path.` },
  // thornweaver
  { id: 'druid_spore', cls: 'druid', slot: 'secondary', name: 'Creeping Miasma', desc: () => `Spore Bloom's cloud drifts after foes, then bursts for damage per Poison stack.` },
  { id: 'druid_entangle', cls: 'druid', slot: 'ability1', name: 'Briar Thicket', desc: () => `Entangle leaves a briar thicket for 5s that keeps rooting and Poisoning foes inside.` },
  { id: 'druid_wolves', cls: 'druid', slot: 'ability2', name: 'Plaguehound Pack', desc: () => `Spirit Wolves trail venomous miasma wherever they run.` },
  // spellblade
  { id: 'blade_rush', cls: 'spellblade', slot: 'ability2', name: 'Phantom Rush', desc: () => `An afterimage follows your Blade Rush, repeating every cut 0.4s later. Its hits build Edge.` },
  { id: 'blade_blades', cls: 'spellblade', slot: 'secondary', name: 'Recalling Steel', desc: () => `Spectral Blades fly back to you, cutting again. Blades that hit on the return build Edge.` },
  { id: 'blade_parry', cls: 'spellblade', slot: 'ability1', name: 'Riposte', desc: () => `When the Parry ward drops you whirl in a counter-cut, far stronger if you parried anything.` },
  // tempest
  { id: 'wind_gale', cls: 'tempest', slot: 'secondary', name: 'Ill Wind', desc: () => `Gale carries plague and flame: Burn and Poison on any foe in the gust spread to all it strikes.` },
  { id: 'wind_tornado', cls: 'tempest', slot: 'ability1', name: 'Hunting Cyclone', desc: () => `Tornado hunts the nearest foe, and bursts outward when it dies down.` },
  { id: 'wind_updraft', cls: 'tempest', slot: 'ability2', name: 'Stormfall', desc: () => `Landing after Updraft crashes down in a shockwave that hurls and stuns. The higher the fall, the harder.` },
].map((a) => ({
  ...a, aug: true, max: 1, minRarity: 1,
  get spellName() { return CLASSES[a.cls].spells[a.slot].name; },
  get icon() { return CLASSES[a.cls].spells[a.slot].icon; },
  apply: (s, m) => {
    s.aug ??= new Set(); s.aug.add(a.id);
    s.augM ??= {}; s.augM[a.id] = m;
    s.augSlot ??= {}; (s.augSlot[a.slot] ??= []).push(a.id);
  },
}));
TOMES.push(...AUGMENTS);

// chance that any one of the three choices is an augment (when one can roll):
// 1 - (1 - 0.21)^3 ~ 0.5, so about every other pick offers one
const AUG_CHANCE = 0.21;

export const RELICS = [
  { id: 'emberheart', set: 'pyre', name: 'Ember Heart', icon: 'flame', desc: 'Burning enemies take +30% damage from you.', apply: (s) => { s.vs.burn = (s.vs.burn ?? 0) + 0.3; } },
  { id: 'frosttear', set: 'tide', name: 'Frozen Tear', icon: 'snow', desc: 'Chilled and Frozen enemies take +30% damage from you.', apply: (s) => { s.vs.chill = (s.vs.chill ?? 0) + 0.3; s.vs.frozen = (s.vs.frozen ?? 0) + 0.3; } },
  { id: 'stormcrown', set: 'storm', name: 'Storm Crown', icon: 'lightning', desc: '15% of your hits call down a lightning strike.', apply: (s) => { s.smite = (s.smite ?? 0) + 0.15; } },
  { id: 'luckycoin', set: 'fang', name: 'Lucky Coin', icon: 'gold', desc: '+8% critical chance and +20% gold.', apply: (s) => { s.critChance += 0.08; s.goldMult += 0.2; } },
  { id: 'vampfang', set: 'fang', name: 'Vampire Fang', icon: 'drop', desc: 'Critical hits heal 3 health.', apply: (s) => { s.critHeal = 3; } },
  { id: 'hourglass', set: 'arcanum', name: 'Cracked Hourglass', icon: 'clock', desc: 'Abilities recharge 15% faster.', apply: (s) => { s.cdr += 0.15; } },
  { id: 'skullcup', set: 'grave', name: 'Skull Chalice', icon: 'skull', desc: '+40 max health. Kills heal 2.', apply: (s) => { s.maxHp += 40; s.killHeal += 2; } },
  { id: 'mirror', set: 'arcanum', name: 'Shard of the Mirror', icon: 'multi', desc: 'Primary fires +1 projectile.', apply: (s) => { s.extraProj += 1; } },
  { id: 'boots', name: 'Boots of the Wind', icon: 'speed', desc: '+15% move speed and +1 dash.', apply: (s) => { s.moveSpeed *= 1.15; s.dashCharges += 1; } },
  { id: 'aegis', name: 'Broken Aegis', icon: 'shield', desc: 'Take 12% less damage.', apply: (s) => { s.armor += 0.12; } },
  { id: 'grimoire', set: 'arcanum', name: 'Forbidden Grimoire', icon: 'power', desc: '+25% damage, +25% area.', apply: (s) => { s.dmgMult += 0.25; s.aoeMult += 0.25; } },
  { id: 'phoenixash', set: 'pyre', name: 'Phoenix Ash', icon: 'phoenix', desc: 'Rise again once at 50% health when you would fall.', once: true, apply: () => {}, onGain: (p) => { p.relicLives = (p.relicLives ?? 0) + 1; } },
  { id: 'warhorn', name: 'Ancestral Warhorn', icon: 'ult', desc: 'Ultimate charges 50% faster.', apply: (s) => { s.ultRate += 0.5; } },
  { id: 'eye', set: 'storm', name: 'Eye of the Deep', icon: 'eye', desc: 'Your hits deal +15% damage to Hexed, Shocked or Marked enemies.', apply: (s) => { s.vs.hex = (s.vs.hex ?? 0) + 0.15; s.vs.shock = (s.vs.shock ?? 0) + 0.15; s.vs.mark = (s.vs.mark ?? 0) + 0.15; } },
  ...NEW_RELICS,
];

// Diminishing returns on stacking one tome: each copy you already hold makes the
// next a little weaker (the 4th is worth 85%, the 11th 63%). Barely felt while a
// build comes together; it keeps a long Abyss run's power from climbing as fast
// as the depths do, so every build meets its end down there.
export const tomeDR = (held) => 1 / (1 + 0.06 * held);

// Roll n distinct tome choices for a player
export function rollTomes(player, n = 3, minRarity = 0, rng = Math.random) {
  const counts = {};
  for (const u of player.upgrades) counts[u.def.id] = (counts[u.def.id] ?? 0) + 1;
  const pool = TOMES.filter((t) => (counts[t.id] ?? 0) < t.max && !t.cls);
  const augPool = AUGMENTS.filter((t) => t.cls === player.classId && !counts[t.id]);
  const out = [];
  const used = new Set();
  // weight elemental tomes toward the player's element
  const el = player.meta.element;
  for (let i = 0; i < n && pool.length; i++) {
    let rar = rollRarity(rng, minRarity, player.game?.difficulty?.tomeLuck ?? 1); // (heat makes the finer tomes likelier)
    // class augments: their own roll, so they show up at a steady rate whatever the rarity
    const augs = augPool.filter((t) => !used.has(t.id));
    if (augs.length && rng() < AUG_CHANCE) {
      const pick = augs[Math.floor(rng() * augs.length)];
      used.add(pick.id);
      rar = Math.max(rar, pick.minRarity);
      out.push({ def: pick, rarity: rar, mult: RARITY[rar].mult });
      continue;
    }
    const cands = pool.filter((t) => !used.has(t.id) && (t.minRarity ?? 0) <= rar && (!t.el || t.el === el || rng() < 0.25) && !(t.el && player.stats.infuse && t.el !== el && rng() < 0.5));
    if (!cands.length) continue;
    let tot = 0;
    const w = (t) => (t.el === el ? 2.5 : 1) * (t.id === 'empower' || t.id === 'vitality' ? 1.3 : 1) * (t.rare ?? 1);
    for (const t of cands) tot += w(t);
    let r = rng() * tot;
    let pick = cands[0];
    for (const t of cands) { r -= w(t); if (r <= 0) { pick = t; break; } }
    used.add(pick.id);
    rar = Math.max(rar, pick.minRarity ?? 0);
    const dr = tomeDR(counts[pick.id] ?? 0);
    out.push({ def: pick, rarity: rar, mult: RARITY[rar].mult * dr, dr });
  }
  return out;
}

// luck scales every weight above Common
export function rollRarity(rng = Math.random, min = 0, luck = 1) {
  const w = (i) => RARITY[i].weight * (i > 0 ? luck : 1);
  let tot = 0;
  for (let i = min; i < RARITY.length; i++) tot += w(i);
  let r = rng() * tot;
  for (let i = min; i < RARITY.length; i++) { r -= w(i); if (r <= 0) return i; }
  return min;
}

// Relics you can still take. Relics of a set you already hold weigh double
// (so sets come together); cursed ones turn up a little less often.
export function rollRelics(player, n = 3, rng = Math.random) {
  const owned = new Set(player.relics.map((r) => r.def.id));
  const sets = setCounts(player.relics);
  const abyss = (player.game?.abyss ?? 0) > 0;
  const pool = RELICS.filter((r) => !owned.has(r.id) && (!r.abyssal || abyss));
  const w = (r) => (r.cursed ? 0.6 : 1) * (sets[r.set] ? 2 : 1);
  const out = [];
  while (out.length < n && pool.length) {
    let tot = 0;
    for (const r of pool) tot += w(r);
    let x = rng() * tot, i = 0;
    for (; i < pool.length - 1; i++) { x -= w(pool[i]); if (x <= 0) break; }
    out.push({ def: pool.splice(i, 1)[0] });
  }
  // ascension: one offer now and then, and every empty slot once the pool runs dry
  const can = player.relics.filter((r) => !r.def.once && !NO_ASCEND.has(r.def.id) && (r.stars ?? 0) < ASCEND_MAX);
  const want = out.length < n ? n - out.length : rng() < 0.18 ? 1 : 0;
  for (let k = 0; k < want && can.length; k++) {
    const r = can.splice(Math.floor(rng() * can.length), 1)[0], st = (r.stars ?? 0) + 1;
    const d = r.def;
    const shown = { ...d, name: `${d.name} ${'★'.repeat(st)}`, desc: `Ascend this relic: its gift ×${ascendK(st)}${d.cursed ? ' (its curse unchanged)' : ''}. ${d.desc}` };
    const pick = { def: shown, ascend: d.id };
    if (out.length >= n) out[out.length - 1] = pick; else out.push(pick);
  }
  return out;
}
