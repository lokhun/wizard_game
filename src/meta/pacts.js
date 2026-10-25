import { CLASS_IDS } from '../game/classMeta.js';
import { RNG, hashString } from '../core/rng.js';

// ---------------------------------------------------------------------------
// Pacts of Ascension: optional difficulty modifiers, each adding heat (like
// Hades' Pact of Punishment). They never touch enemy definitions: every pact
// sets one knob on game.difficulty, and the director / game read those knobs
// where they scale things (health, damage, wave size, healing, prices...).
// ---------------------------------------------------------------------------

export const PACTS = [
  { id: 'hides', name: 'Iron Hides', icon: 'shield', heat: 1, max: 3, desc: (r) => `Foes have +${25 * r}% health.` },
  { id: 'blades', name: 'Keen Blades', icon: 'sword', heat: 1, max: 3, desc: (r) => `Foes deal +${20 * r}% damage.` },
  { id: 'hunt', name: 'The Hunt', icon: 'speed', heat: 1, max: 2, desc: (r) => `Foes move ${12 * r}% faster.` },
  { id: 'legion', name: 'The Legion', icon: 'army', heat: 1, max: 2, desc: (r) => `Waves are ${20 * r}% larger.` },
  { id: 'champions', name: 'Champions', icon: 'elite', heat: 2, max: 1, desc: () => 'Champions appear twice as often, and every elite bears an affix.' },
  { id: 'respite', name: 'Scant Respite', icon: 'heart', heat: 1, max: 2, desc: (r) => (r >= 2 ? 'Clearing a chamber no longer heals you.' : 'Clearing a chamber heals 5% instead of 10%.') },
  { id: 'avarice', name: 'Avarice', icon: 'gold', heat: 1, max: 2, desc: (r) => `The merchant charges +${40 * r}%.` },
  { id: 'wrath', name: 'Wrath', icon: 'boss', heat: 2, max: 2, desc: (r) => `Bosses reach their fiercer phases ${15 * r}% sooner.` },
  { id: 'fate', name: 'Fixed Fate', icon: 'hourglass', heat: 1, max: 1, desc: () => 'No tome rerolls.' },
  { id: 'frailty', name: 'Frailty', icon: 'drop', heat: 1, max: 2, desc: (r) => `You take +${15 * r}% damage.` },
  { id: 'famine', name: 'Famine', icon: 'skull', heat: 1, max: 1, desc: () => 'Foes drop health orbs half as often.' },
  // the deeper pacts: each is unlocked by clearing that much heat with any wizard
  { id: 'omens', name: 'Ill Omens', icon: 'eye', heat: 1, max: 2, unlock: 3, desc: (r) => (r >= 2 ? 'Every fight after a realm\'s first falls under an omen (Darkness, Blood Moon, Haunted...).' : 'Omens fall on twice as many fights.') },
  { id: 'narrow', name: 'Narrow Path', icon: 'split', heat: 1, max: 1, unlock: 3, desc: () => 'Tomes offer two choices instead of three.' },
  { id: 'wounds', name: 'Old Wounds', icon: 'briar', heat: 1, max: 2, unlock: 3, desc: (r) => `Regeneration, lifesteal and healing on kills stop at ${r >= 2 ? 50 : 75}% health.` },
  { id: 'deadline', name: 'Tight Deadline', icon: 'hourglass', heat: 1, max: 3, unlock: 3, desc: (r) => `Reach each realm's guardian within ${[0, 9, 7, 5][r]} minutes, or wither: past it you lose 1% of your health every second until the guardian falls.` },
  { id: 'leaden', name: 'Leaden Steps', icon: 'stoneskin', heat: 1, max: 2, unlock: 3, desc: (r) => `Your dash recharges ${40 * r}% slower.` },
  { id: 'relentless', name: 'Relentless', icon: 'stairs', heat: 1, max: 2, unlock: 6, desc: (r) => (r >= 2 ? 'The next wave comes while three quarters of the last still stand.' : 'The next wave comes while half the last still stands.') },
  { id: 'volatile', name: 'Volatile Dead', icon: 'bomb', heat: 2, max: 1, unlock: 6, desc: () => 'Slain foes burst a moment later. Mind where they fall.' },
  { id: 'exalted', name: 'Exalted', icon: 'crown', heat: 2, max: 1, unlock: 10, desc: () => 'Every champion bears two affixes.' },
];
// Nightmare is the hard mode, not a card on the board: open from the very
// first run, toggled on the class select, and worth 10 heat. It changes how
// foes fight rather than only their numbers (see difficultyFor), and pays the
// skilled back with Dread Marks, finer tomes and a relic from every boss.
// Its second rank is Damnation, the top of the ladder: 20 heat, every Nightmare
// behaviour pushed further, no healing between chambers and no second wind.
export const NIGHTMARE = { id: 'nightmare', name: 'Nightmare', icon: 'skull', heat: 10, max: 2,
  rankName: (r) => (r >= 2 ? 'Damnation' : 'Nightmare'),
  desc: (r = 1) => (r >= 2
    ? 'The top of the ladder. Foes far tougher and more relentless, every champion twice-cursed, barely any healing between chambers, no second wind.'
    : 'Foes fight smarter and never let up; bosses unleash dread rings. Flawless chambers earn Dread Marks.') };
// a pact as it reads: "Iron Hides II", "Damnation"
export const pactLabel = (id, r) => { const pc = PACT_BY_ID[id]; return !pc ? id : pc.rankName ? pc.rankName(r) : pc.name + (pc.max > 1 ? ' ' + 'I'.repeat(r) : ''); };
// Boss Rush is a mode, kept with the pacts the same way (and so sent to the party
// the same way): worth no heat. Each realm skips straight to its boss's antechamber.
export const BOSS_RUSH = { id: 'rush', name: 'Boss Rush', icon: 'boss', heat: 0, max: 1, desc: () => 'The five bosses back to back, with tomes and relics between them.' };
export const PACT_BY_ID = Object.fromEntries([...PACTS, NIGHTMARE, BOSS_RUSH].map((p) => [p.id, p]));
export const MAX_HEAT = PACTS.reduce((s, p) => s + p.heat * p.max, 0) + NIGHTMARE.heat * NIGHTMARE.max;

// Pacts open as you clear heat: `unlock` is the heat you must have cleared
// (with any wizard) before it can be sworn. `best` is the profile's record.
export const pactOpen = (pc, best) => !pc.unlock || best >= pc.unlock;
export const nextUnlock = (best) => PACTS.filter((pc) => !pactOpen(pc, best)).reduce((m, pc) => Math.min(m, pc.unlock), Infinity);

// What heat pays: the finer tomes come likelier (Rare, Epic and Legendary
// weights grow 6% per heat) and gold drops grow 5% per heat.
export function heatBoons(heat) { return { luck: 1 + 0.06 * heat, gold: 1 + 0.05 * heat }; }

// keep only known pacts at legal ranks (the selection arrives from storage and the network)
export function cleanPacts(sel) {
  const out = {};
  for (const [id, r] of Object.entries(sel ?? {})) {
    const p = PACT_BY_ID[id];
    const n = Math.floor(+r);
    if (p && n > 0) out[id] = Math.min(p.max, n);
  }
  return out;
}

export function heatOf(sel) {
  let h = 0;
  for (const [id, r] of Object.entries(cleanPacts(sel))) h += PACT_BY_ID[id].heat * r;
  return h;
}

// The knobs the game reads. Neutral values reproduce the unmodified game.
const prefix = (b) => ({ tomeLuck: b.luck, goldMult: b.gold });
export function difficultyFor(sel, extra = {}) {
  const s = cleanPacts(sel);
  const r = (id) => s[id] ?? 0;
  const nm = !!r('nightmare'), dm = r('nightmare') >= 2; // (dm: Damnation)
  return {
    enemyHp: (1 + 0.25 * r('hides')) * (dm ? 1.6 : nm ? 1.3 : 1),
    enemyDamage: (1 + 0.2 * r('blades')) * (dm ? 1.45 : nm ? 1.25 : 1),
    playerDamage: 1 + 0.15 * r('frailty'),
    enemySpeed: (1 + 0.12 * r('hunt')) * (dm ? 1.1 : 1),
    enemyCount: (1 + 0.2 * r('legion')) * (dm ? 1.15 : 1),
    champions: (r('champions') ? 2 : 1) * (dm ? 2 : 1),
    eliteAffix: !!r('champions') || dm,
    clearHeal: dm ? 0.25 : [1, 0.5, 0][r('respite')] * (nm ? 0.5 : 1),
    shopCost: 1 + 0.4 * r('avarice'),
    bossEnrage: 0.15 * r('wrath') + (dm ? 0.15 : 0),
    rerolls: r('fate') ? 0 : 1,
    orbChance: (r('famine') ? 0.5 : 1) * (dm ? 0.5 : nm ? 0.7 : 1),
    omens: r('omens'),
    tomeChoices: r('narrow') ? 2 : 3,
    dashCd: 1 + 0.4 * r('leaden'),
    healCap: [1, 0.75, 0.5][r('wounds')], // (passive heals stop here: Old Wounds)
    deadline: [0, 540, 420, 300][r('deadline')], // (seconds to reach each realm's guardian: Tight Deadline)
    waveEarly: r('relentless'), // the share of a wave left standing when the next comes: 0.25 / 0.5 / 0.75
    volatileDead: !!r('volatile'),
    twinAffix: !!r('exalted') || dm,
    // Nightmare: the same telegraphs (still fair to read), but foes come round
    // to their attacks sooner, more of them press you at once, melee chains a
    // second blow, archers loose a follow-up shot, casters drop an extra circle
    nightmare: nm,
    damnation: dm,
    aiCd: dm ? 0.72 : nm ? 0.8 : 1,
    aiRecover: dm ? 0.55 : nm ? 0.7 : 1,
    fireTokens: dm ? 2 : nm ? 1 : 0,
    meleeSlots: dm ? 2 : nm ? 1 : 0,
    combo: dm ? 0.4 : nm ? 0.3 : 0,
    doubleTap: nm,
    extraCircle: nm ? 1 : 0,
    bossCd: dm ? 0.68 : nm ? 0.8 : 1,
    dreadPulse: nm,
    dreadRate: dm ? 1.35 : 1, // dread rings come this much more often
    selfRevive: dm ? 0 : 1, // (solo's one second wind)
    minRarity: nm ? 1 : 0,
    bossRelic: nm,
    rush: !!r('rush'),
    projSpeed: 1, // enemy shots' speed (the Abyss's laws raise it)
    bossSig: false, // bosses wield their Nightmare signature move (Nightmare, or the Abyss)
    heat: heatOf(s),
    ...prefix(heatBoons(heatOf(s))),
    pacts: s,
    ...extra,
  };
}

// ---------------------------------------------------------------- the daily rite
// Everyone gets the same rite on the same UTC day: seed, class and pacts are
// all derived from the date, so there is nothing to fetch.
export function utcDay(d = new Date()) { return d.toISOString().slice(0, 10); }
export function dayNumber(key) { return Math.floor(Date.parse(key + 'T00:00:00Z') / 864e5); }
export function prevDay(key) { return utcDay(new Date(Date.parse(key + 'T00:00:00Z') - 864e5)); }

// a fixed pool of fair pact mixes: each rite draws one at modest heat
const RITE_POOL = ['hides', 'blades', 'hunt', 'legion', 'champions', 'respite', 'avarice', 'wrath', 'fate', 'frailty', 'famine', 'omens', 'narrow', 'leaden', 'relentless', 'volatile'];
export function dailyRite(key = utcDay()) {
  const n = dayNumber(key);
  const rng = new RNG(hashString('rite:' + key));
  // stride 5 is coprime with the 13 classes: every class comes round once a fortnight
  const classId = CLASS_IDS[((n * 5) % CLASS_IDS.length + CLASS_IDS.length) % CLASS_IDS.length];
  const pool = [...RITE_POOL];
  const pacts = {};
  const target = 3 + (n % 3); // heat 3..5, rising through a three-day cycle
  let guard = 0;
  while (heatOf(pacts) < target && pool.length && guard++ < 20) {
    const id = pool.splice(Math.floor(rng.next() * pool.length), 1)[0];
    if (heatOf({ ...pacts, [id]: 1 }) <= target) pacts[id] = 1;
  }
  const seed = (hashString('seed:' + key) % 999999937) + 1;
  return { key, seed, classId, pacts, heat: heatOf(pacts) };
}

// a single comparable number for "best today"
export function riteScore(r) { return (r.won ? 100000 - Math.min(99999, Math.round(r.time)) + 500000 : 0) + r.floor * 10000 + Math.min(9999, r.kills); }

// The Abyss's laws: each depth adds one, for good, so every descent plays
// differently (on top of its random curse and the realms' steeper scaling).
export const ABYSS_LAWS = [
  { name: 'The Deep Stirs', desc: 'Bosses wield their nightmare techniques, and champions come half again as often.', color: '#b070ff', apply: (d) => { d.bossSig = true; d.champions *= 1.5; } },
  { name: 'Twin Souls', desc: 'Every champion bears two affixes, and enemy shots fly a fifth faster.', color: '#40d0c0', apply: (d) => { d.twinAffix = true; d.projSpeed *= 1.2; } },
  { name: 'The Dread Tide', desc: 'Bosses loose rings of dread, foes strike in combos, and a cleared chamber heals half as much.', color: '#ff5060', apply: (d) => { d.dreadPulse = true; d.combo = Math.max(d.combo, 0.3); d.clearHeal *= 0.5; } },
  { name: 'Endless Night', desc: 'Foes attack far more often and press you harder.', color: '#e8d8a0', apply: (d) => { d.aiCd *= 0.85; d.aiRecover *= 0.8; d.fireTokens += 1; d.meleeSlots += 1; d.bossCd *= 0.85; } },
];
// the difficulty at a depth: every law up to it, and past the last each depth quickens foes again
export function abyssLaws(diff, depth) {
  const d = { ...diff, projSpeed: diff.projSpeed ?? 1 };
  for (let i = 0; i < Math.min(depth, ABYSS_LAWS.length); i++) ABYSS_LAWS[i].apply(d);
  for (let i = ABYSS_LAWS.length; i < depth; i++) { d.aiCd *= 0.93; d.bossCd *= 0.93; d.projSpeed *= 1.05; }
  return d;
}
export const lawAt = (depth) => (depth <= ABYSS_LAWS.length ? ABYSS_LAWS[depth - 1] : { name: 'Deeper Still', desc: 'Foes quicken again: they attack and loose their shots faster.', color: '#ff8090' });
