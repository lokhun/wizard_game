// ---------------------------------------------------------------------------
// Relic data: sets, the build-defining relics and their stat parts. Pure data
// (no three.js), so upgrades.js and player.js can import it without a cycle;
// what relics *do* in a fight (procs and their visuals) lives in relics.js.
// ---------------------------------------------------------------------------

// Holding 2 or 3 relics of one set wakes its bonus. Stat parts are applied in
// applyRelicSets (recomputeStats); proc parts are read by relics.js.
export const SETS = {
  pyre: { name: 'Pyre', color: '#ff7a30', icon: 'flame', b2: 'Burns you inflict deal +50% damage.', b3: 'Foes that die Burning erupt in a fire nova.' },
  storm: { name: 'Storm', color: '#9fb4ff', icon: 'lightning', b2: '+10% chance on hit to call down lightning.', b3: 'Your lightning strikes arc on to 2 more foes.' },
  grave: { name: 'Grave', color: '#7dff6a', icon: 'skull', b2: 'Kills heal 3 and may raise a skeleton (8%).', b3: 'Every kill looses a seeking soul wisp.' },
  tide: { name: 'Tide', color: '#7fd8ff', icon: 'snow', b2: 'Your primary Chills.', b3: 'Chilled or Frozen foes you slay shatter in a frost nova.' },
  fang: { name: 'Fang', color: '#ff3048', icon: 'drop', b2: '+10% critical chance.', b3: 'Critical hits make foes Bleed and heal you 1.' },
  arcanum: { name: 'Arcanum', color: '#c080ff', icon: 'power', b2: 'Abilities recharge 12% faster.', b3: 'Every 4th ability cast refunds itself.' },
};

export const CURSED_COLOR = '#e0306a';

// set: tag (or none); cursed: strong upside, real downside (drawn in its own
// frame). apply(stats, player) runs in recomputeStats like every upgrade.
export const NEW_RELICS = [
  // ---------------- Pyre
  { id: 'ashglyph', set: 'pyre', name: 'Ashen Glyph', icon: 'glyph', desc: 'Critical hits sear a burning glyph beneath the foe. A moment later it erupts for 30 fire damage and Burns.' },
  { id: 'emberstride', set: 'pyre', name: 'Emberstride Greaves', icon: 'dash', desc: 'Dashing leaves a trail of fire for 3s that Burns foes who cross it.' },
  { id: 'kindling', set: 'pyre', name: 'Kindling Heart', icon: 'fireball', desc: 'When a fight begins you blaze for 8s: +25% damage, and all your hits Burn.' },
  { id: 'meteorbrand', set: 'pyre', name: 'Brand of the Falling Star', icon: 'meteor', desc: 'Casting an ability calls a meteor down on your aim point for 70 fire damage (once every 8s).' },
  // ---------------- Storm
  { id: 'thunderclap', set: 'storm', name: 'Thunderclap Sandals', icon: 'storm', desc: 'Where your dash ends, a thunderclap deals 28 damage to foes within 4m, Shocking and stunning them.' },
  { id: 'stormwheel', set: 'storm', name: 'Stormwheel', icon: 'wheel', desc: 'Three crackling motes orbit you, zapping any foe they touch for 12 damage.' },
  { id: 'conductor', set: 'storm', name: "Conductor's Rod", icon: 'bolt', desc: 'Overkill damage arcs on to the nearest foe as lightning.' },
  // ---------------- Grave
  { id: 'soullantern', set: 'grave', name: 'Lantern of Lost Souls', icon: 'lantern', desc: 'Kills release a soul wisp that hunts the nearest foe for 30 necrotic damage.' },
  { id: 'plaguecenser', set: 'grave', name: 'Plague Censer', icon: 'censer', desc: 'Foes that die Burning, Poisoned, Chilled, Shocked, Bleeding or Hexed pass those afflictions to up to 6 foes within 5m.' },
  { id: 'gravebell', set: 'grave', name: 'Grave Bell', icon: 'bell', desc: 'Slaying 3 foes within 2.5s tolls the bell: a necrotic shockwave deals up to 40 damage within 7m (most at its heart) and Slows.' },
  // ---------------- Tide
  { id: 'rimewake', set: 'tide', name: 'Rimewake Boots', icon: 'mine', desc: 'Dashing scatters 3 frost mines. Each bursts when a foe comes near, for 30 damage and a heavy Chill.' },
  { id: 'stillwater', set: 'tide', name: 'Stillwater Idol', icon: 'idol', desc: 'Hold still for a moment and a frost sentinel rises at your side, loosing ice bolts at your foes until you move.' },
  { id: 'undertow', set: 'tide', name: 'Undertow Pearl', icon: 'pearl', desc: 'When a fight begins, a tidal ward absorbs damage equal to 25% of your max health for 10s.' },
  { id: 'lastbreath', set: 'tide', name: 'Sands of the Last Breath', icon: 'hourglass', desc: 'Once per chamber, falling below 30% health stills time: foes within 18m are Slowed for 4s and you are hasted.' },
  // ---------------- Fang
  { id: 'firstblood', set: 'fang', name: 'First Fang', icon: 'fang', desc: 'Your first hit on each foe deals +60% damage and Judges it (+15% damage taken).' },
  { id: 'thornheart', set: 'fang', name: 'Briar Heart', icon: 'briar', desc: 'When you are struck, 12 thorns burst from you, each dealing 18 damage and causing Bleed.' },
  { id: 'goldfever', set: 'fang', name: 'Midas Tooth', icon: 'tooth', desc: 'Each gold pickup whets your hunger: +4% damage for 6s, stacking up to +40%.' },
  { id: 'moonhowl', set: 'fang', name: 'Moonhowl Pendant', icon: 'crescent', desc: 'Below 40% health: +35% attack speed, and 5% of damage dealt heals you.',
    apply: (s, p) => { if (p.hp > 0 && p.hp / p.maxHp < 0.4) { s.rateMult += 0.35; s.lifesteal += 0.05; } } },
  // ---------------- Arcanum
  { id: 'metronome', set: 'arcanum', name: 'Metronome Sigil', icon: 'metronome', desc: 'Every 5th primary cast also looses a volley of 5 seeking arcane bolts (14 damage each).' },
  { id: 'familiar', set: 'arcanum', name: 'Spectral Familiar', icon: 'owl', desc: 'A familiar spirit hovers at your shoulder, loosing a bolt of your element at your foes every 1.2s.' },
  { id: 'afterimage', set: 'arcanum', name: 'Mirror of Echoes', icon: 'blink', desc: 'Dashing leaves an afterimage behind that explodes after 1s for 45 arcane damage.' },
  { id: 'laurel', set: 'arcanum', name: "Victor's Laurel", icon: 'laurel', desc: 'Every chamber you clear permanently grants +2% damage.',
    apply: (s, p) => { s.dmgMult += 0.02 * (p.laurels ?? 0); } },
  // ---------------- Items (no set)
  { id: 'satchel', name: 'Bottomless Satchel', icon: 'chest', desc: 'Each item you use has a 35% chance not to be used up.' },
  // ---------------- Cursed
  { id: 'crownthorns', set: 'fang', cursed: true, name: 'Crown of Thorns', icon: 'crown', desc: '+45% damage, but you take 30% more damage.',
    apply: (s) => { s.dmgMult += 0.45; s.armor -= 0.3; } },
  { id: 'hungertome', set: 'grave', cursed: true, name: 'The Hungering Codex', icon: 'codex', desc: '+35% attack speed and kills heal 5, but while a chamber is sealed you wither 1.2% of your max health each second.',
    apply: (s) => { s.rateMult += 0.35; s.killHeal += 5; } },
  { id: 'phylactery', set: 'arcanum', cursed: true, name: 'Shattered Phylactery', icon: 'glass', desc: '+2 dash charges and critical hits deal +60% damage, but −35% max health.',
    apply: (s) => { s.dashCharges += 2; s.critMult += 0.6; s.maxHp *= 0.65; } },
  { id: 'voidpact', set: 'storm', cursed: true, name: 'Pact of the Void', icon: 'hex', desc: 'Abilities recharge 45% faster, but every ability cast costs 5% of your max health.',
    apply: (s) => { s.cdRate += 0.45; } },
  { id: 'gamblersdie', cursed: true, name: "The Gambler's Die", icon: 'dice', desc: 'Every fight rolls the die. 2–5: one boon for the fight (+50% damage, +40% attack speed, +35% speed and cooldown rate, or +100% crit damage). 6: all four. 1: −30% damage.' },
  // ---------------- Abyssal: found only past the Hollow King, each a great gift bought dearly
  { id: 'drownedcrown', abyssal: true, cursed: true, name: 'Crown of the Drowned King', icon: 'crown', desc: '+60% damage and +60% area, but you take 25% more damage.',
    apply: (s) => { s.dmgMult += 0.6; s.aoeMult += 0.6; s.armor -= 0.25; } },
  { id: 'abyssaleye', abyssal: true, cursed: true, name: 'Eye of the Abyss', icon: 'eye', desc: '+20% critical chance and critical hits deal +80% damage, but −25% max health.',
    apply: (s) => { s.critChance += 0.2; s.critMult += 0.8; s.maxHp *= 0.75; } },
  { id: 'starvingblade', abyssal: true, cursed: true, name: 'The Starving Blade', icon: 'power', desc: '+4% damage for every tome you hold, but kills and lifesteal no longer heal you.',
    apply: (s, p) => { s.dmgMult += 0.04 * (p.upgrades?.length ?? 0); }, after: (s) => { s.killHeal = 0; s.lifesteal = 0; } },
  { id: 'voidclock', abyssal: true, cursed: true, name: 'The Voidclock', icon: 'clock', desc: 'Abilities recharge 50% faster and your ultimate charges 50% faster, but −20% damage.',
    apply: (s) => { s.cdRate += 0.5; s.ultRate += 0.5; s.dmgMult -= 0.2; } },
  { id: 'hollowheart', abyssal: true, cursed: true, name: 'The Hollow Heart', icon: 'shield', desc: '+80% max health and take 20% less damage, but −25% attack speed.',
    apply: (s) => { s.maxHp *= 1.8; s.armor += 0.2; s.rateMult -= 0.25; } },
  { id: 'legionsigil', abyssal: true, cursed: true, name: 'Sigil of the Legion', icon: 'multi', desc: 'Primary fires +2 projectiles, but −25% damage.',
    apply: (s) => { s.extraProj += 2; s.dmgMult -= 0.25; } },
].map((r) => ({ apply: () => {}, ...r }));

// Ascension: an owned relic can be raised to ★ and ★★ (chests offer it now and
// then, and always once few relics are left to find). It multiplies the relic's
// gift, never its curse: stat bonuses (only the ones that help) and proc damage.
export const ASCEND_MAX = 2;
export const ascendK = (stars) => 1 + 0.5 * (stars ?? 0);
// relics whose gift is a rule rather than a number: nothing to raise
export const NO_ASCEND = new Set(['phoenixash', 'lastbreath', 'gamblersdie', 'goldfever', 'undertow', 'firstblood']);

export const relicColor = (def) => (def.cursed ? CURSED_COLOR : SETS[def.set]?.color ?? '#ffb030');
// one-line description with its set and curse called out (shop, tooltips)
export const relicDesc = (def) => `${def.cursed ? 'Cursed. ' : ''}${def.set ? `[${SETS[def.set].name}] ` : ''}${def.desc}`;

export function setCounts(relics) {
  const n = {};
  for (const r of relics) { const k = r.def.set; if (k) n[k] = (n[k] ?? 0) + 1; }
  return n;
}

// stat halves of the set bonuses (proc halves: relics.js reads stats.sets)
export function applyRelicSets(s, p) {
  const n = setCounts(p.relics);
  s.sets = n;
  if (n.pyre >= 2) s.burnAmp = 1.5;
  if (n.storm >= 2) s.smite = (s.smite ?? 0) + 0.1;
  if (n.grave >= 2) { s.killHeal += 3; s.raiseChance = (s.raiseChance ?? 0) + 0.08; }
  if (n.tide >= 2) s.infuse = { ...(s.infuse ?? {}), chill: Math.max(1, s.infuse?.chill ?? 0) };
  if (n.fang >= 2) s.critChance += 0.1;
  if (n.arcanum >= 2) s.cdr += 0.12;
}
