import { CLASS_IDS } from '../game/classMeta.js';

// ---------------------------------------------------------------------------
// The persistent profile: lifetime totals, per-class records, the bestiary,
// feats, pact choices and the daily rite. One versioned JSON blob in
// localStorage. Storage can be missing, full or throw (private windows,
// blocked cookies), so the profile always lives in memory first and a failed
// write only costs persistence, never the run. Loading sanitises every field,
// so a hand-edited or half-written blob can't break the menus.
// ---------------------------------------------------------------------------

const KEY = 'arcane-ascent-profile';
const LEGACY_KEY = 'arcane-ascent-stats'; // the pre-profile totals (runs/wins/bestFloor/kills/classWins)
export const PROFILE_VERSION = 1;

const num = (x, d = 0) => (Number.isFinite(+x) && +x >= 0 ? +x : d);
const obj = (x) => (x && typeof x === 'object' && !Array.isArray(x) ? x : {});
const numMap = (x) => { const o = {}; for (const [k, v] of Object.entries(obj(x))) if (Number.isFinite(+v)) o[k] = +v; return o; };

export function blankClass() { return { runs: 0, wins: 0, bestFloor: 0, fastest: 0, bestHeat: -1, kills: 0, bestAbyss: 0 }; }

export function blankProfile() {
  return {
    v: PROFILE_VERSION,
    created: Date.now(),
    runs: 0, wins: 0, deaths: 0, coopWins: 0,
    kills: 0, damage: 0, time: 0, gold: 0, tomes: 0, rooms: 0, flawless: 0,
    bestFloor: 0, // realms reached, 1..5
    records: { biggestHit: 0, mostDamage: 0, mostKills: 0, fastestWin: 0, highestHeat: -1, deepestAbyss: 0 },
    classes: {}, // id -> blankClass()
    bestiary: {}, // enemy type -> kills by you
    bosses: {}, // boss type -> times defeated (any party member's kill counts)
    killedBy: {}, // enemy type -> runs it ended
    feats: {}, // feat id -> unix ms when earned
    pacts: {}, // pact id -> chosen rank (the board remembers your last setup)
    daily: { last: '', streak: 0, bestStreak: 0, runs: 0, best: null }, // best: { date, floor, won, time, kills, score }
  };
}

// Bring any stored blob (any version, or garbage) up to the current shape.
export function migrate(raw, legacy) {
  const p = blankProfile();
  const r = obj(raw);
  const v = num(r.v, 0);
  if (v >= 1) {
    for (const k of ['created', 'runs', 'wins', 'deaths', 'coopWins', 'kills', 'damage', 'time', 'gold', 'tomes', 'rooms', 'flawless', 'bestFloor']) p[k] = num(r[k], p[k]);
    const rec = obj(r.records);
    for (const k of Object.keys(p.records)) if (Number.isFinite(+rec[k])) p.records[k] = +rec[k];
    for (const [id, c] of Object.entries(obj(r.classes))) {
      if (!CLASS_IDS.includes(id)) continue;
      const b = blankClass(), cc = obj(c);
      for (const k of Object.keys(b)) if (Number.isFinite(+cc[k])) b[k] = +cc[k];
      p.classes[id] = b;
    }
    p.bestiary = numMap(r.bestiary);
    p.bosses = numMap(r.bosses);
    p.killedBy = numMap(r.killedBy);
    p.feats = numMap(r.feats);
    p.pacts = numMap(r.pacts);
    const d = obj(r.daily);
    p.daily = { last: typeof d.last === 'string' ? d.last.slice(0, 10) : '', streak: num(d.streak), bestStreak: num(d.bestStreak), runs: num(d.runs), best: d.best && typeof d.best === 'object' ? { date: String(d.best.date ?? '').slice(0, 10), floor: num(d.best.floor), won: !!d.best.won, time: num(d.best.time), kills: num(d.best.kills), score: num(d.best.score) } : null };
  }
  // v0: fold the old totals in once (they stay where they were, unread)
  if (v < 1 && legacy) {
    const l = obj(legacy);
    p.runs = num(l.runs); p.wins = num(l.wins); p.bestFloor = num(l.bestFloor); p.kills = num(l.kills);
    p.deaths = Math.max(0, p.runs - p.wins);
    for (const [id, w] of Object.entries(obj(l.classWins))) if (CLASS_IDS.includes(id)) p.classes[id] = { ...blankClass(), wins: num(w), runs: num(w) };
  }
  p.v = PROFILE_VERSION;
  return p;
}

let cache = null;
export let storageOk = true;

export function loadProfile(force = false) {
  if (cache && !force) return cache;
  let raw = null, legacy = null;
  try {
    raw = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (!raw) legacy = JSON.parse(localStorage.getItem(LEGACY_KEY) || 'null');
  } catch { storageOk = false; }
  try { cache = migrate(raw, legacy); } catch (e) { console.warn('profile reset', e); cache = blankProfile(); }
  return cache;
}

export function saveProfile() {
  if (!cache) return false;
  try { localStorage.setItem(KEY, JSON.stringify(cache)); storageOk = true; return true; } catch { storageOk = false; return false; }
}

export function classRec(p, id) { return (p.classes[id] ??= blankClass()); }

// tests: start from a clean (or given) profile without touching other keys
export function resetProfile(data) { cache = migrate(data ?? { v: PROFILE_VERSION }); saveProfile(); return cache; }
