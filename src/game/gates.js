// Each boss's gate (see Boss.openGate in bosses.js): its colour on the boss and the HUD, what a blow it
// turns away says, and what the boss bar says it still asks. Shared by the host's brain and every peer's look.
export const GATE_LOOK = {
  brood: { name: 'Brood Shield', color: '#9adf3a', hit: 'SHIELDED', left: (n) => `${n} brood remain`, tint: 0x6aff30, col: [0.6, 2.2, 0.3], light: 0x80ff40, el: 'poison' },
  stone: { name: 'Stoneskin', color: '#e0b060', hit: 'STONESKIN — STRIKE ITS BACK', left: (n) => `strike its back · ${n}% of the stone left`, tint: 0x9a8a78, col: [1.6, 1.2, 0.5], light: 0xffc060, el: 'earth' },
  ward: { name: 'Warding Glyphs', color: '#d080ff', hit: 'WARDED', left: (n) => `${n} glyph${n === 1 ? '' : 's'} to light`, tint: 0xc070ff, col: [1.6, 0.5, 2.4], light: 0xc060ff, el: 'arcane' },
  judgment: { name: 'Hollow Judgment', color: '#b080ff', hit: 'JUDGED — SLIP HIS BLOWS', left: (n) => `${n} perfect dodge${n === 1 ? '' : 's'} to break it`, tint: 0x8040ff, col: [1.2, 0.4, 2.6], light: 0x9050ff, el: 'enemyPurple' },
};
