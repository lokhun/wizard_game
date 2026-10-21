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
  { id: 'respite', name: 'Scant Respite', icon: 'heart', heat: 1, max: 2, desc: (r) => (r >= 2 ? 'Clearing a chamber no longer heals you.' : 'Clearing a chamber heals 7% instead of 15%.') },
  { id: 'avarice', name: 'Avarice', icon: 'gold', heat: 1, max: 2, desc: (r) => `The merchant charges +${40 * r}%.` },
  { id: 'wrath', name: 'Wrath', icon: 'boss', heat: 2, max: 2, desc: (r) => `Bosses reach their fiercer phases ${15 * r}% sooner.` },
  { id: 'fate', name: 'Fixed Fate', icon: 'hourglass', heat: 1, max: 1, desc: () => 'No tome rerolls.' },
  { id: 'frailty', name: 'Frailty', icon: 'drop', heat: 1, max: 2, desc: (r) => `You take +${15 * r}% damage.` },
  { id: 'famine', name: 'Famine', icon: 'skull', heat: 1, max: 1, desc: () => 'Foes drop health orbs half as often.' },
];
export const PACT_BY_ID = Object.fromEntries(PACTS.map((p) => [p.id, p]));
export const MAX_HEAT = PACTS.reduce((s, p) => s + p.heat * p.max, 0);

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
export function difficultyFor(sel, extra = {}) {
  const s = cleanPacts(sel);
  const r = (id) => s[id] ?? 0;
  return {
    enemyHp: 1 + 0.25 * r('hides'),
    enemyDamage: 1 + 0.2 * r('blades'),
    playerDamage: 1 + 0.15 * r('frailty'),
    enemySpeed: 1 + 0.12 * r('hunt'),
    enemyCount: 1 + 0.2 * r('legion'),
    champions: r('champions') ? 2 : 1,
    eliteAffix: !!r('champions'),
    clearHeal: [1, 7 / 15, 0][r('respite')],
    shopCost: 1 + 0.4 * r('avarice'),
    bossEnrage: 0.15 * r('wrath'),
    rerolls: r('fate') ? 0 : 1,
    orbChance: r('famine') ? 0.5 : 1,
    heat: heatOf(s),
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
const RITE_POOL = ['hides', 'blades', 'hunt', 'legion', 'champions', 'respite', 'avarice', 'wrath', 'fate', 'frailty', 'famine'];
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
