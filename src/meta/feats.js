import { CLASS_IDS } from '../game/classMeta.js';
import { ENEMY_DEFS } from '../game/enemyDefs.js';
import { BIOMES } from '../world/biomes.js';

// ---------------------------------------------------------------------------
// Feats: achievements. Each feat names the run-tracker events it listens to
// (see tracker.js: the tracker digests raw game events into these) and a test.
// r is the live run record, p the profile, x the event payload. Lifetime feats
// can show progress in the codex.
// ---------------------------------------------------------------------------

const FIGHT_TYPES = Object.keys(ENEMY_DEFS).filter((k) => !ENEMY_DEFS[k].ally);
export const bestiaryTypes = () => FIGHT_TYPES;
const BOSSES = BIOMES.map((b) => b.boss);
const classWins = (p) => CLASS_IDS.filter((id) => (p.classes[id]?.wins ?? 0) > 0).length;

export const FEAT_GROUPS = ['The Ascent', 'Mastery', 'Builds', 'Pacts & Rites', 'Legacy', 'Nightmare'];

export const FEATS = [
  // ---------------- the ascent
  { id: 'filth', group: 0, name: 'Filth Purged', icon: 'boss', desc: 'Defeat the Mother of Filth.', on: { bossDown: (r, p, x) => x.type === 'motherOfFilth' } },
  { id: 'moonrise', group: 0, name: 'Moonrise', icon: 'crescent', desc: 'Reach the Moonlit Bailey.', on: { floor: (r, p, x) => x >= 2 } },
  { id: 'dawn', group: 0, name: 'Dawn Returns', icon: 'sun', desc: 'Defeat the Hollow King.', on: { end: (r) => r.won } },
  { id: 'swift', group: 0, name: 'Swift Ascent', icon: 'clock', desc: 'Win a run in under 30 minutes.', on: { end: (r) => r.won && !r.rush && r.winTime < 30 * 60 } },
  { id: 'gauntlet', group: 0, name: 'The Gauntlet', icon: 'boss', desc: 'Finish a Boss Rush.', on: { end: (r) => r.won && r.rush } },
  { id: 'gauntletFast', group: 0, name: 'Breakneck', icon: 'hourglass', desc: 'Finish a Boss Rush in under 12 minutes.', on: { end: (r) => r.won && r.rush && r.winTime < 12 * 60 } },
  { id: 'fellowship', group: 0, name: 'Fellowship', icon: 'army', desc: 'Win a run in co-op.', on: { end: (r) => r.won && r.coop } },
  { id: 'lifeline', group: 0, name: 'Lifeline', icon: 'heart', desc: 'Revive a fallen ally.', on: { revive: () => true } },
  // ---------------- mastery (single feats of skill)
  { id: 'untouched', group: 1, name: 'Untouched', icon: 'shield', desc: 'Clear a chamber without taking damage.', on: { roomClear: (r, p, x) => x.type !== 'boss' && x.dmg === 0 } },
  { id: 'unbroken', group: 1, name: 'Unbroken', icon: 'stoneskin', desc: 'Clear five chambers in a row without taking damage.', on: { roomClear: (r) => r.flawlessChain >= 5 } },
  { id: 'duel', group: 1, name: 'Flawless Duel', icon: 'parry', desc: 'Defeat a boss without taking damage.', on: { bossDown: (r, p, x) => x.room && x.room.dmg === 0 } },
  { id: 'ground', group: 1, name: 'Stand Your Ground', icon: 'rock', desc: 'Defeat a boss without dashing.', on: { bossDown: (r, p, x) => x.room && x.room.dashes === 0 } },
  { id: 'thread', group: 1, name: 'By a Thread', icon: 'drop', desc: 'Defeat a boss with less than 10% health left.', on: { bossDown: (r, p, x) => x.hpFrac > 0 && x.hpFrac < 0.1 } },
  { id: 'cataclysm', group: 1, name: 'Cataclysm', icon: 'nova', desc: 'Slay 5 foes with a single spell.', on: { multikill: (r, p, n) => n >= 5 } },
  { id: 'matador', group: 1, name: 'Matador', icon: 'dash', desc: 'Perfect-dodge 25 blows in one run (dash through them at the last moment).', on: { perfectDodge: (r, p, n) => n >= 25 } },
  { id: 'thunder', group: 1, name: 'Thunderclap', icon: 'bolt', desc: 'Land a single hit of 1,000 damage or more.', on: { bigHit: (r, p, d) => d >= 1000 } },
  { id: 'alchemist', group: 1, name: 'Alchemist', icon: 'hex', desc: 'Trigger 150 elemental reactions in one run.', on: { reaction: (r) => r.reactions >= 150 } },
  { id: 'reaper', group: 1, name: 'Reaper', icon: 'skull', desc: 'Slay 250 foes yourself in a single run.', on: { kill: (r) => r.kills >= 250 } },
  { id: 'clock', group: 1, name: 'Against the Clock', icon: 'hourglass', desc: 'Conquer a Trial chamber in time.', on: { roomClear: (r, p, x) => x.type === 'trial' && x.trial } },
  // ---------------- builds
  { id: 'humble', group: 2, name: 'Humble Means', icon: 'eye', desc: 'Reach the Moonlit Bailey having bound only Common tomes (at least 3).', on: { floor: (r, p, x) => x >= 2 && r.tomesTaken >= 3 && r.bestRarity === 0 } },
  { id: 'legend', group: 2, name: 'Legend Bound', icon: 'phoenix', desc: 'Bind a Legendary tome.', on: { tome: (r, p, c) => c.rarity >= 3 } },
  { id: 'wright', group: 2, name: 'Spell-Wright', icon: 'split', desc: 'Bind three spell augments in one run.', on: { tome: (r) => r.augments >= 3 } },
  { id: 'relics', group: 2, name: 'Relic Hoarder', icon: 'chest', desc: 'Carry three relics at once.', on: { relic: (r, p, n) => n >= 3 } },
  { id: 'hoard', group: 2, name: "Dragon's Hoard", icon: 'gold', desc: 'Hold 600 gold at once.', on: { gold: (r, p, g) => g >= 600 } },
  // ---------------- pacts & the daily rite
  { id: 'pactbound', group: 3, name: 'Pactbound', icon: 'pact', desc: 'Win with 5 or more heat.', on: { end: (r) => r.won && r.heat >= 5 } },
  { id: 'inferno', group: 3, name: 'Into the Inferno', icon: 'flame', desc: 'Win with 12 or more heat.', on: { end: (r) => r.won && r.heat >= 12 } },
  { id: 'crucible', group: 3, name: 'The Crucible', icon: 'phoenix', desc: 'Win with 20 or more heat.', on: { end: (r) => r.won && r.heat >= 20 } },
  { id: 'unmade', group: 3, name: 'Unmade', icon: 'ult', desc: 'Win with 30 or more heat.', on: { end: (r) => r.won && r.heat >= 30 } },
  { id: 'abyss', group: 3, name: 'Into the Abyss', icon: 'tentacle', desc: 'Descend into the Abyss after slaying the Hollow King.', on: { abyss: (r, p, d) => d >= 1 } },
  { id: 'deep', group: 3, name: 'Deep Dweller', icon: 'skull', desc: 'Reach the third depth of the Abyss.', on: { abyss: (r, p, d) => d >= 3 } },
  { id: 'abyssal', group: 3, name: 'Abyssal Sovereign', icon: 'crown', desc: 'Slay the Hollow King of the Abyss and descend again, with 10 or more heat.', on: { abyss: (r, p, d) => d >= 2 && r.heat >= 10 } },
  { id: 'rite', group: 3, name: 'Rite Keeper', icon: 'shrine', desc: 'Reach the Moonlit Bailey in a Daily Rite.', on: { floor: (r, p, x) => !!r.daily && x >= 2 } },
  { id: 'devotee', group: 3, name: 'Devotee', icon: 'stairs', desc: 'Keep a three-day Daily Rite streak.', on: { profile: (r, p) => p.daily.streak >= 3 }, progress: (p) => [Math.min(3, p.daily.streak), 3] },
  // ---------------- legacy (lifetime)
  { id: 'polymath', group: 4, name: 'Polymath', icon: 'power', desc: 'Win with five different wizards.', on: { profile: (r, p) => classWins(p) >= 5 }, progress: (p) => [Math.min(5, classWins(p)), 5] },
  { id: 'schools', group: 4, name: 'Master of Every School', icon: 'ult', desc: `Win with all ${CLASS_IDS.length} wizards.`, on: { profile: (r, p) => classWins(p) >= CLASS_IDS.length }, progress: (p) => [classWins(p), CLASS_IDS.length] },
  { id: 'thousand', group: 4, name: 'A Thousand Fallen', icon: 'army', desc: 'Slay 1,000 foes across all runs.', on: { profile: (r, p) => p.kills >= 1000 }, progress: (p) => [Math.min(1000, p.kills), 1000] },
  { id: 'bestiary', group: 4, name: 'Bestiarist', icon: 'eye', desc: 'Slay every kind of foe at least once.', on: { profile: (r, p) => FIGHT_TYPES.every((t) => p.bestiary[t] > 0) }, progress: (p) => [FIGHT_TYPES.filter((t) => p.bestiary[t] > 0).length, FIGHT_TYPES.length] },
  { id: 'kingslayer', group: 4, name: "Kingslayer's Road", icon: 'crown', desc: 'Defeat all five realm bosses.', on: { profile: (r, p) => BOSSES.every((b) => p.bosses[b] > 0) }, progress: (p) => [BOSSES.filter((b) => p.bosses[b] > 0).length, BOSSES.length] },
  // ---------------- nightmare
  { id: 'nmWin', group: 5, name: 'Waking Hour', icon: 'sun', desc: 'Win a run on Nightmare.', on: { end: (r) => r.won && r.nightmare } },
  { id: 'nmBoss', group: 5, name: 'Night Terror', icon: 'skull', desc: 'On Nightmare, defeat a boss without taking damage.', on: { bossDown: (r, p, x) => r.nightmare && x.room && x.room.dmg === 0 } },
  { id: 'nmDread', group: 5, name: 'Dread Lord', icon: 'crown', desc: 'Bear all twelve Dread Marks at once.', on: { dread: (r, p, n) => n >= 12 } },
  { id: 'nmAwake', group: 5, name: 'Wide Awake', icon: 'eye', desc: 'Win on Nightmare without ever being downed.', on: { end: (r) => r.won && r.nightmare && r.downs === 0 } },
  { id: 'nmLucid', group: 5, name: 'Lucid Dreamer', icon: 'flame', desc: 'Win on Nightmare at 25 heat or more.', on: { end: (r) => r.won && r.nightmare && r.heat >= 25 } },
  { id: 'nmRush', group: 5, name: 'Night of Five Kings', icon: 'crown', desc: 'Finish a Boss Rush on Nightmare.', on: { end: (r) => r.won && r.rush && r.nightmare } },
  { id: 'damned', group: 5, name: 'Beyond Damnation', icon: 'skull', desc: 'Win a run on Damnation.', on: { end: (r) => r.won && r.damnation } },
  { id: 'damnedClean', group: 5, name: 'Unbowed', icon: 'shield', desc: 'Win on Damnation without ever being downed.', on: { end: (r) => r.won && r.damnation && r.downs === 0 } },
  { id: 'nmAbyss', group: 5, name: 'The Dream Beneath', icon: 'tentacle', desc: 'Descend into the Abyss on Nightmare.', on: { abyss: (r) => r.nightmare } },
];
export const FEAT_BY_ID = Object.fromEntries(FEATS.map((f) => [f.id, f]));

// feats listening to an event, built once
const byEvent = new Map();
for (const f of FEATS) for (const ev of Object.keys(f.on)) { if (!byEvent.has(ev)) byEvent.set(ev, []); byEvent.get(ev).push(f); }

// Test every unearned feat that listens to `ev`; returns the newly earned ones.
export function checkFeats(ev, r, p, x) {
  const list = byEvent.get(ev);
  if (!list) return [];
  const out = [];
  for (const f of list) {
    if (p.feats[f.id] || r?.feats?.includes(f.id)) continue;
    let ok = false;
    try { ok = !!f.on[ev](r, p, x); } catch { ok = false; }
    if (ok) out.push(f);
  }
  return out;
}
