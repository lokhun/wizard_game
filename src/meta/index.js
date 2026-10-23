import './meta.css';
import { RunTracker } from './tracker.js';
import { showSummary, featToaster } from './summary.js';
import { TOMES, RELICS } from '../game/upgrades.js';
import { PACT_BY_ID, pactLabel } from './pacts.js';

export { loadProfile, saveProfile, resetProfile } from './profile.js';
export { FEATS } from './feats.js';
export { difficultyFor, dailyRite, heatOf, cleanPacts, PACT_BY_ID, pactLabel } from './pacts.js';
export { showCodex, showPactBoard, pactStrip, pactsUnlocked, nightmareOn, toggleNightmare, toggleRush, showDailyRite, riteLine } from './codex.js';

// Wire the meta layer onto a game: the run tracker listens to game.events,
// feats pop a toast in-run, and the run's end opens the summary.
// hooks: { onMenu(), onAgain() | null, canAgain(), menuLabel() (the first button's text) }
export function attachMeta(game, ui, hooks = {}) {
  const toast = featToaster(ui);
  let screen = null;
  const tracker = new RunTracker(game, {
    onFeat: (f) => { if (!game.ended) toast(f); },
    onEnd: (S, t) => {
      toast.clear();
      const party = [...game.remotes.values()].map((r) => ({ id: r.id, name: r.name, classId: r.classId }));
      screen = showSummary(ui, S, { party, remotes: t.remote, onMenu: hooks.onMenu, onAgain: hooks.canAgain?.() ? hooks.onAgain : null, menuLabel: hooks.menuLabel?.() ?? undefined });
    },
    onRemote: () => screen?.el.isConnected && screen.addRemote(),
  });
  game.meta = tracker;
  // say what the run was sworn to once the realm banner has passed
  game.events.on('runStart', () => {
    const r = tracker.run;
    if (!r || (!r.heat && !r.daily)) return;
    const pk = Object.entries(r.pacts).map(([id, n]) => pactLabel(id, n)).join(' · ');
    setTimeout(() => { if (tracker.run === r && !game.ended) ui.toast(`${r.daily ? 'Daily Rite · ' : ''}Heat ${r.heat} — ${pk}`, '#ff9a50'); }, 4500);
  });
  return tracker;
}

// ---------------------------------------------------------------- test hooks
// ?screen=summary&demo=win|loss|coop|abyss shows the summary with a made-up run
// (screenshots and layout checks without playing to the end).
export function demoSummary(ui, kind = 'win') {
  const won = kind !== 'loss';
  const pick = (n, off = 0) => TOMES.filter((t) => !t.aug).slice(off, off + n);
  const S = {
    v: 1, pid: 'solo', name: 'Morvain', classId: kind === 'coop' ? 'stormcaller' : 'pyromancer', won, time: won ? 2412 : 1338, floor: won ? 4 : 2, biome: '',
    kills: won ? 318 : 171, partyKills: 512, damage: won ? 148220 : 41870, biggest: won ? 2184 : 912, biggestOn: won ? 'The Hollow King' : 'Fallen Knight',
    taken: won ? 1840 : 1322, downs: won ? 0 : 1, reactions: won ? 64 : 22, gold: 1210, heat: won ? 7 : 3, pacts: won ? { hides: 2, wrath: 1, fate: 1, famine: 1 } : { blades: 1, legion: 2 }, daily: kind === 'loss' ? '2026-10-21' : null,
    killer: won ? null : 'a Gargoyle (hasted champion)', coop: kind === 'coop', practice: false, feats: won ? ['dawn', 'duel', 'cataclysm'] : ['untouched'],
    tomes: [...pick(6).map((t, i) => [t.id, [0, 1, 2, 3, 1, 0][i], i === 0 ? 3 : 1]), ...TOMES.filter((t) => t.aug && t.cls === 'pyromancer').slice(0, 2).map((t) => [t.id, 2, 1])],
    relics: RELICS.slice(0, won ? 3 : 1).map((r) => r.id),
    rooms: [], records: won ? { fastest: true, biggest: true, heat: true } : { floor: true, daily: true },
  };
  if (!won) S.recap = [{ name: 'a Gargoyle (hasted champion)', move: 'Dive', dmg: 64, n: 2 }, { name: 'a Skeleton Archer', move: 'Volley', dmg: 31, n: 3 }, { name: 'lingering flames', move: '', dmg: 12, n: 4 }];
  if (kind === 'abyss') Object.assign(S, { abyss: 2, fell: true, killer: 'a Fallen Knight (frenzied, volatile champion)', heat: 14, time: 3920, records: { abyss: true, heat: true } });
  const types = ['combat', 'combat', 'trial', 'combat', 'elite', 'boss'];
  for (let f = 0; f <= S.floor; f++) {
    for (const [i, t] of types.entries()) {
      if (t === 'trial' && f % 2) continue;
      const last = !won && f === S.floor && i === 3;
      S.rooms.push([f, t, t === 'boss' ? 140 + f * 30 : 30 + ((f * 7 + i * 13) % 40), (f + i) % 3 === 0 ? 0 : 40 + ((f * 31 + i * 17) % 160) * (t === 'boss' ? 3 : 1), last ? 0 : 1 | (t === 'trial' ? 2 : 0), 8 + i]);
      if (last) break;
    }
  }
  const party = kind === 'coop' ? [{ id: 'p1', name: 'Ysolde', classId: 'cryomancer' }, { id: 'p2', name: 'Thadric', classId: 'necromancer' }] : [];
  const remotes = new Map();
  if (kind === 'coop') remotes.set('p1', { ...S, pid: 'p1', name: 'Ysolde', classId: 'cryomancer', kills: 140, damage: 99120, biggest: 3410, reactions: 88, taken: 2210, downs: 2, feats: ['alchemist'], tomes: pick(5, 6).map((t) => [t.id, 1, 1]), relics: [RELICS[4].id] });
  const scr = showSummary(ui, S, { party, remotes, onMenu: () => {}, onAgain: kind === 'coop' ? null : () => {} });
  if (kind === 'coop') setTimeout(() => { remotes.set('p2', { ...S, pid: 'p2', name: 'Thadric', classId: 'necromancer', kills: 210, damage: 120400, biggest: 1210, reactions: 12, taken: 980, downs: 0, feats: [], tomes: pick(7, 3).map((t) => [t.id, 0, 1]), relics: [] }); scr.addRemote(); }, 1200);
  return S;
}
