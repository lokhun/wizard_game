// Hand-built SVG glyphs for abilities, tomes and classes (24x24 viewBox).
const P = {
  bolt: 'M13 2 4 14h6l-1 8 9-12h-6z',
  lightning: 'M13 1 5 13h5l-2 10 10-14h-6l3-8z',
  flame: 'M12 2c1 4 6 6 6 12a6 6 0 0 1-12 0c0-3 2-5 3-6 0 2 1 3 2 3-1-3 0-6 1-9z',
  fireball: 'M15 3c-1 3 1 4 2 6a6 6 0 1 1-10 1c1 1 2 1 3 0-1-3 1-5 5-7zM3 21l4-4M5 21l3-3M2 18l3-3',
  meteor: 'M16 13a4 4 0 1 1-8 0 4 4 0 0 1 8 0zM3 3l6 6M6 2l5 5M2 6l5 5',
  dash: 'M4 6h8M2 12h12M4 18h8M15 5l6 7-6 7',
  shards: 'M6 3l2 9-2 3-2-3zM12 1l2 10-2 4-2-4zM18 3l2 9-2 3-2-3z',
  beam: 'M2 12h20M2 9h20M2 15h20M18 6l4 6-4 6',
  nova: 'M12 2v5M12 17v5M2 12h5M17 12h5M5 5l3.5 3.5M15.5 15.5 19 19M19 5l-3.5 3.5M8.5 15.5 5 19M12 9a3 3 0 1 1 0 6 3 3 0 0 1 0-6z',
  spike: 'M12 1l4 13-4 9-4-9z',
  storm: 'M6 10a5 5 0 0 1 9-3 4 4 0 0 1 3 7H6a3 3 0 0 1 0-4zM10 15l-2 4h3l-2 4M15 15l-1 3',
  orb: 'M12 4a8 8 0 1 1 0 16 8 8 0 0 1 0-16zM12 8a4 4 0 1 0 0 8',
  blink: 'M4 12a3 3 0 1 1 6 0 3 3 0 0 1-6 0zM14 12h8M17 8l4 4-4 4M7 5v2M7 17v2',
  missiles: 'M3 18 15 6M7 20 19 8M3 14 11 6M15 6h4v4M19 8v0',
  barrage: 'M2 20 14 8M6 22 18 10M10 22 22 10M14 8l4-1-1 4M18 10l4-1-1 4',
  vortex: 'M12 12m-2 0a2 2 0 1 0 4 0a4 4 0 1 0-8 0a6 6 0 1 0 12 0a8 8 0 1 0-16 0',
  skull: 'M12 3a8 8 0 0 0-8 8c0 3 2 4 3 5v3h10v-3c1-1 3-2 3-5a8 8 0 0 0-8-8zM9 10a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3zM15 10a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3zM10 19v2M14 19v2',
  drain: 'M3 12c3-4 6 4 9 0s6 4 9 0M3 7l3 2M21 17l-3-2',
  raise: 'M12 3v18M7 8l5-5 5 5M5 21h14M8 17h8',
  spear: 'M3 21 17 7M14 4l6 0 0 6zM5 16l3 3',
  army: 'M6 6a2 2 0 1 1 0 4 2 2 0 0 1 0-4zM12 4a2 2 0 1 1 0 4 2 2 0 0 1 0-4zM18 6a2 2 0 1 1 0 4 2 2 0 0 1 0-4zM4 20v-6h4v6M10 20v-8h4v8M16 20v-6h4v6',
  drop: 'M12 2c3 5 7 9 7 13a7 7 0 0 1-14 0c0-4 4-8 7-13z',
  slash: 'M3 20C8 8 16 4 21 3c-2 6-7 13-18 17z',
  pact: 'M12 21s-8-5-8-11a5 5 0 0 1 8-3 5 5 0 0 1 8 3c0 6-8 11-8 11zM12 7v9M9 11h6',
  heart: 'M12 21s-8-5-8-11a5 5 0 0 1 8-3 5 5 0 0 1 8 3c0 6-8 11-8 11z',
  clock: 'M12 3a9 9 0 1 1 0 18 9 9 0 0 1 0-18zM12 7v5l4 2',
  bomb: 'M10 8a7 7 0 1 0 0.1 0zM14 6l3-3M18 2l1 2M20 5l2-1',
  rewind: 'M11 6 3 12l8 6zM21 6l-8 6 8 6z',
  stasis: 'M12 2v20M2 12h20M5 5l14 14M19 5 5 19M12 8a4 4 0 1 1 0 8 4 4 0 0 1 0-8z',
  hourglass: 'M6 2h12M6 22h12M7 2c0 6 10 6 10 10S7 16 7 22M17 2c0 6-10 6-10 10s10 4 10 10',
  eye: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zM12 9a3 3 0 1 1 0 6 3 3 0 0 1 0-6z',
  hex: 'M12 2l8.7 5v10L12 22l-8.7-5V7zM12 7l4 7H8z',
  tentacle: 'M8 22c0-6 6-6 6-11s-4-6-6-4 1 5 4 3M16 22c0-3 3-4 3-7',
  sun: 'M12 7a5 5 0 1 1 0 10 5 5 0 0 1 0-10zM12 1v3M12 20v3M1 12h3M20 12h3M4 4l2 2M18 18l2 2M20 4l-2 2M6 18l-2 2',
  sanctuary: 'M12 2v8M8 6h8M4 22c0-5 4-9 8-9s8 4 8 9z',
  shield: 'M12 2l8 3v6c0 6-4 9-8 11-4-2-8-5-8-11V5z',
  judgment: 'M12 2v20M8 2h8M6 8h12M9 22h6M4 12l4 2-4 2M20 12l-4 2 4 2',
  rock: 'M5 9l5-5 8 2 3 7-4 7H8l-5-5z',
  spikes: 'M2 22l3-10 3 10M8 22l4-16 4 16M16 22l3-10 3 10',
  stoneskin: 'M12 2l8 3v6c0 6-4 9-8 11-4-2-8-5-8-11V5zM8 9l3 3-2 4M15 7l-2 5 3 3',
  quake: 'M2 18h20M4 18l3-6 3 4 3-8 3 6 2-3 2 7M6 22l2-2M12 22v-2M18 22l-2-2',
  thorn: 'M4 20C8 14 14 10 20 4M8 15l-3-1M11 12l-1-3M14 9l3 1M16 7l-1-3',
  cloud: 'M6 18a4 4 0 0 1-1-8 6 6 0 0 1 11-2 5 5 0 0 1 2 10zM8 21h1M12 21h1M16 21h1',
  roots: 'M12 2v8M12 10c-4 2-6 6-8 12M12 10c4 2 6 6 8 12M12 10v12M8 15l-3 1M16 15l3 1',
  wolf: 'M4 6l3 3h10l3-3v7l-3 5-5 3-5-3-3-5zM9 12h0M15 12h0M10 16l2 1 2-1',
  sword: 'M14 3l7-1-1 7L9 20l-3-3zM5 14l5 5M3 21l3-3',
  blades: 'M4 20 14 4M10 20 18 6M16 20 22 8M14 4l1 3M18 6l1 3',
  parry: 'M12 2l8 3v6c0 6-4 9-8 11-4-2-8-5-8-11V5zM6 18 18 6',
  crescent: 'M20 12a8 8 0 1 1-8-8 6 6 0 0 0 8 8z',
  gust: 'M3 8h12a3 3 0 1 0-3-3M3 13h16a3 3 0 1 1-3 3M3 18h8',
  tornado: 'M3 4h18M5 8h14M7 12h10M9 16h6M11 20h2',
  updraft: 'M12 22V4M6 10l6-6 6 6M4 16l3-3M20 16l-3-3',
  power: 'M12 2l3 7h7l-6 4 2 8-6-5-6 5 2-8-6-4h7z',
  crit: 'M12 2v6M12 16v6M2 12h6M16 12h6M12 9a3 3 0 1 1 0 6 3 3 0 0 1 0-6z',
  speed: 'M4 12h10M4 8h6M4 16h6M13 6l7 6-7 6z',
  multi: 'M4 6l7 6-7 6M11 6l7 6-7 6',
  pierce: 'M2 12h17M15 7l6 5-6 5M8 8v8',
  bounce: 'M2 4l6 16 6-12 6 12',
  homing: 'M4 20c4-10 12-10 16-16M16 4h4v4',
  split: 'M2 12h8M10 12l10-7M10 12l10 7',
  aoe: 'M12 12m-9 0a9 9 0 1 0 18 0a9 9 0 1 0-18 0M12 12m-4 0a4 4 0 1 0 8 0a4 4 0 1 0-8 0',
  ult: 'M12 2l2 6 6 1-5 4 2 7-5-4-5 4 2-7-5-4 6-1z',
  glass: 'M7 2h10l-2 9a3 3 0 0 1-6 0zM12 14v6M8 22h8',
  snow: 'M12 2v20M3 7l18 10M21 7 3 17M9 3l3 3 3-3M9 21l3-3 3 3',
  gold: 'M12 4a8 8 0 1 1 0 16 8 8 0 0 1 0-16zM12 7v10M9 9h4.5a1.5 1.5 0 0 1 0 3h-3a1.5 1.5 0 0 0 0 3H15',
  phoenix: 'M12 22c-2-4-6-5-8-10 3 2 5 2 6 1-3-3-3-7-1-11 1 4 3 5 3 5s2-1 3-5c2 4 2 8-1 11 1 1 3 1 6-1-2 5-6 6-8 10z',
  missiles2: 'M3 18 15 6',
  crown: 'M3 18h18M4 18l-1-11 5 4 4-7 4 7 5-4-1 11z',
  door: 'M5 22V6a7 7 0 0 1 14 0v16M12 13v2',
  chest: 'M3 10h18v10H3zM3 10c0-4 4-6 9-6s9 2 9 6M11 12h2v3h-2z',
  shop: 'M3 9l2-6h14l2 6M4 9v12h16V9M3 9h18M9 21v-6h6v6',
  shrine: 'M12 2l3 4h-6zM8 6h8v3H8zM9 9h6v10H9zM5 22h14',
  boss: 'M12 2c5 0 8 4 8 9 0 3-2 5-3 6v4H7v-4c-1-1-3-3-3-6 0-5 3-9 8-9zM8 11l3 1-1 2zM16 11l-3 1 1 2zM3 3l4 4M21 3l-4 4',
  elite: 'M12 2l3 6 6 1-4 4 1 7-6-3-6 3 1-7-4-4 6-1z',
  stairs: 'M3 21h4v-4h4v-4h4V9h4V5h2',
};

export function iconSVG(name, color = '#e8d8b0', size = 40, opts = {}) {
  const d = P[name] ?? P.power;
  const filled = opts.fill ?? ['bolt', 'lightning', 'flame', 'fireball', 'drop', 'heart', 'pact', 'shield', 'spike', 'skull', 'rock', 'power', 'ult', 'crescent', 'phoenix', 'elite', 'boss', 'crown', 'orb', 'slash'].includes(name);
  const glow = opts.glow !== false;
  return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" style="${glow ? `filter:drop-shadow(0 0 3px ${color})` : ''}">
    <path d="${d}" fill="${filled ? color : 'none'}" fill-opacity="${filled ? 0.85 : 0}" stroke="${color}" stroke-width="${filled ? 0.8 : 1.7}" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>`;
}

// Class emblem: a sigil composed of a ring + the element glyph
const CLASS_GLYPH = {
  pyromancer: 'flame', cryomancer: 'snow', stormcaller: 'lightning', arcanist: 'power', necromancer: 'skull',
  bloodmage: 'drop', chronomancer: 'hourglass', warlock: 'eye', lightbinder: 'sun', geomancer: 'rock',
  druid: 'thorn', spellblade: 'sword', tempest: 'tornado',
};
export function classEmblem(classId, color, size = 64) {
  const glyph = P[CLASS_GLYPH[classId]] ?? P.power;
  const filled = ['flame', 'lightning', 'skull', 'drop', 'rock'].includes(CLASS_GLYPH[classId]);
  return `<svg viewBox="0 0 48 48" width="${size}" height="${size}" style="filter:drop-shadow(0 0 4px ${color})">
    <circle cx="24" cy="24" r="21" fill="rgba(0,0,0,0.35)" stroke="${color}" stroke-opacity="0.75" stroke-width="1.2"/>
    <circle cx="24" cy="24" r="17.5" fill="none" stroke="${color}" stroke-opacity="0.35" stroke-width="0.8" stroke-dasharray="2 3"/>
    <g transform="translate(12 12)"><path d="${glyph}" fill="${filled ? color : 'none'}" fill-opacity="0.85" stroke="${color}" stroke-width="${filled ? 0.8 : 1.6}" stroke-linecap="round" stroke-linejoin="round"/></g>
  </svg>`;
}

export const ICONS = P;
