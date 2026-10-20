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
  { id: 'ult', name: 'Ascendant Will', icon: 'ult', max: 4, desc: (m) => `Ultimate charges ${pct(0.25 * m)} faster.`, apply: (s, m) => { s.ultRate += 0.25 * m; } },
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
  { id: 'regen', name: 'Troll Blood', icon: 'heart', max: 4, desc: (m) => `Regenerate ${(1 * m).toFixed(1)} health per second.`, apply: (s, m) => { s.regen += 1 * m; } },
  { id: 'vampire', name: 'Vampiric Codex', icon: 'drop', max: 4, desc: (m) => `${pct(0.03 * m)} of damage dealt heals you.`, apply: (s, m) => { s.lifesteal += 0.03 * m; } },
  { id: 'feast', name: 'Soul Feast', icon: 'skull', max: 4, desc: (m) => `Kills heal ${Math.round(3 * m)} health.`, apply: (s, m) => { s.killHeal += 3 * m; } },
  { id: 'swift', name: 'Wind Walker', icon: 'speed', max: 4, desc: (m) => `+${pct(0.08 * m)} move speed.`, apply: (s, m) => { s.moveSpeed *= 1 + 0.08 * m; } },
  { id: 'dash', name: 'Phase Step', icon: 'dash', max: 2, desc: () => `+1 dash charge and dashes recharge 20% faster.`, apply: (s) => { s.dashCharges += 1; s.dashCd *= 0.8; } },
  { id: 'evasion', name: 'Blur', icon: 'dash', max: 3, desc: (m) => `${pct(0.06 * m)} chance to dodge attacks.`, apply: (s, m) => { s.dodge = 1 - (1 - (s.dodge ?? 0)) * (1 - 0.06 * m); } },
  { id: 'thorns', name: 'Briar Ward', icon: 'thorn', max: 3, desc: (m) => `Attackers take ${Math.round(15 * m)} damage.`, apply: (s, m) => { s.thorns += 15 * m; } },
  { id: 'greed', name: "Miser's Ledger", icon: 'gold', max: 3, desc: (m) => `+${pct(0.25 * m)} gold found.`, apply: (s, m) => { s.goldMult += 0.25 * m; } },
  { id: 'phoenix', name: 'Phoenix Feather', icon: 'phoenix', max: 1, minRarity: 3, desc: () => `When you would fall, rise again at 50% health (once).`, apply: (s) => { s.extraLives = (s.extraLives ?? 0) + 1; }, once: true },
  { id: 'echo', name: 'Arcane Echo', icon: 'multi', max: 1, minRarity: 2, desc: () => `Abilities have a 25% chance to instantly recharge.`, apply: (s) => { s.echo = 0.25; } },
];

export const RELICS = [
  { id: 'emberheart', name: 'Ember Heart', icon: 'flame', desc: 'Burning enemies take +30% damage from you.', apply: (s) => { s.vs.burn = (s.vs.burn ?? 0) + 0.3; } },
  { id: 'frosttear', name: 'Frozen Tear', icon: 'snow', desc: 'Chilled and Frozen enemies take +30% damage from you.', apply: (s) => { s.vs.chill = (s.vs.chill ?? 0) + 0.3; s.vs.frozen = (s.vs.frozen ?? 0) + 0.3; } },
  { id: 'stormcrown', name: 'Storm Crown', icon: 'lightning', desc: '15% of your hits call down a lightning strike.', apply: (s) => { s.smite = 0.15; } },
  { id: 'luckycoin', name: 'Lucky Coin', icon: 'gold', desc: '+8% critical chance and +20% gold.', apply: (s) => { s.critChance += 0.08; s.goldMult += 0.2; } },
  { id: 'vampfang', name: 'Vampire Fang', icon: 'drop', desc: 'Critical hits heal 3 health.', apply: (s) => { s.critHeal = 3; } },
  { id: 'hourglass', name: 'Cracked Hourglass', icon: 'clock', desc: 'Abilities recharge 15% faster.', apply: (s) => { s.cdr += 0.15; } },
  { id: 'skullcup', name: 'Skull Chalice', icon: 'skull', desc: '+40 max health. Kills heal 2.', apply: (s) => { s.maxHp += 40; s.killHeal += 2; } },
  { id: 'mirror', name: 'Shard of the Mirror', icon: 'multi', desc: 'Primary fires +1 projectile.', apply: (s) => { s.extraProj += 1; } },
  { id: 'boots', name: 'Boots of the Wind', icon: 'speed', desc: '+15% move speed and +1 dash.', apply: (s) => { s.moveSpeed *= 1.15; s.dashCharges += 1; } },
  { id: 'aegis', name: 'Broken Aegis', icon: 'shield', desc: 'Take 12% less damage.', apply: (s) => { s.armor += 0.12; } },
  { id: 'grimoire', name: 'Forbidden Grimoire', icon: 'power', desc: '+25% damage, +25% area.', apply: (s) => { s.dmgMult += 0.25; s.aoeMult += 0.25; } },
  { id: 'phoenixash', name: 'Phoenix Ash', icon: 'phoenix', desc: 'Rise again once at 50% health when you would fall.', once: true, apply: () => {}, onGain: (p) => { p.relicLives = (p.relicLives ?? 0) + 1; } },
  { id: 'warhorn', name: 'Ancestral Warhorn', icon: 'ult', desc: 'Ultimate charges 50% faster.', apply: (s) => { s.ultRate += 0.5; } },
  { id: 'eye', name: 'Eye of the Deep', icon: 'eye', desc: 'Your hits deal +15% damage to Hexed, Shocked or Marked enemies.', apply: (s) => { s.vs.hex = (s.vs.hex ?? 0) + 0.15; s.vs.shock = (s.vs.shock ?? 0) + 0.15; s.vs.mark = (s.vs.mark ?? 0) + 0.15; } },
];

// Roll n distinct tome choices for a player
export function rollTomes(player, n = 3, minRarity = 0, rng = Math.random) {
  const counts = {};
  for (const u of player.upgrades) counts[u.def.id] = (counts[u.def.id] ?? 0) + 1;
  const pool = TOMES.filter((t) => (counts[t.id] ?? 0) < t.max);
  const out = [];
  const used = new Set();
  // weight elemental tomes toward the player's element
  const el = player.meta.element;
  for (let i = 0; i < n && pool.length; i++) {
    let rar = rollRarity(rng, minRarity);
    const cands = pool.filter((t) => !used.has(t.id) && (t.minRarity ?? 0) <= rar && (!t.el || t.el === el || rng() < 0.25) && !(t.el && player.stats.infuse && t.el !== el && rng() < 0.5));
    if (!cands.length) continue;
    let tot = 0;
    const w = (t) => (t.el === el ? 2.5 : 1) * (t.id === 'empower' || t.id === 'vitality' ? 1.3 : 1);
    for (const t of cands) tot += w(t);
    let r = rng() * tot;
    let pick = cands[0];
    for (const t of cands) { r -= w(t); if (r <= 0) { pick = t; break; } }
    used.add(pick.id);
    rar = Math.max(rar, pick.minRarity ?? 0);
    out.push({ def: pick, rarity: rar, mult: RARITY[rar].mult });
  }
  return out;
}

export function rollRarity(rng = Math.random, min = 0) {
  let tot = 0;
  for (let i = min; i < RARITY.length; i++) tot += RARITY[i].weight;
  let r = rng() * tot;
  for (let i = min; i < RARITY.length; i++) { r -= RARITY[i].weight; if (r <= 0) return i; }
  return min;
}

export function rollRelics(player, n = 3, rng = Math.random) {
  const owned = new Set(player.relics.map((r) => r.def.id));
  const pool = RELICS.filter((r) => !owned.has(r.id));
  const out = [];
  while (out.length < n && pool.length) {
    const i = Math.floor(rng() * pool.length);
    out.push({ def: pool.splice(i, 1)[0] });
  }
  return out;
}
