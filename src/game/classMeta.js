// Visual identity of each wizard class. Gameplay kits live in classes.js;
// this file only holds what models, UI and VFX need to look right.
//
// element: the damage school used for VFX colors, sounds and reactions.
// focus: what the wizard holds in first person.

export const CLASS_META = {
  pyromancer: {
    name: 'Pyromancer', title: 'Keeper of the Cinder Flame', element: 'fire',
    color: 0xff6a1a, color2: 0xffd27a, robe: 0x5a1a10, trim: 0x1a0a08,
    focus: 'staff', focusDesc: 'charred blackwood staff caged around a burning ember crystal; right hand holds staff, left hand wreathed in flickering flame',
    hat: 'wide-brimmed pointed hat, singed',
  },
  cryomancer: {
    name: 'Cryomancer', title: 'Warden of the Rime', element: 'frost',
    color: 0x6fd6ff, color2: 0xe8fbff, robe: 0x2a4a68, trim: 0xd8e8f0,
    focus: 'staff', focusDesc: 'pale ash staff crowned with a jagged cluster of glowing ice crystals, frost-rimed; left hand with frost mist',
    hat: 'fur-trimmed hood',
  },
  stormcaller: {
    name: 'Stormcaller', title: 'Voice of the Tempest', element: 'lightning',
    color: 0x7fa8ff, color2: 0xe0e8ff, robe: 0x1a2240, trim: 0xb08040,
    focus: 'rod', focusDesc: 'copper lightning rod with coiled wire rings and a crackling sphere at the tip; left hand with arcing sparks between fingers',
    hat: 'hood with brass goggles',
  },
  arcanist: {
    name: 'Arcanist', title: 'Scholar of the Prismatic Weave', element: 'arcane',
    color: 0xc060ff, color2: 0xff9cf0, robe: 0x3a1a5a, trim: 0xd8b060,
    focus: 'wand+book', focusDesc: 'slender silver wand in right hand; an open floating spellbook with glowing pages hovering beside the left hand',
    hat: 'tall pointed hat with stars',
  },
  necromancer: {
    name: 'Necromancer', title: 'Lord of the Restless Dead', element: 'necrotic',
    color: 0x7dff6a, color2: 0xd0ffb0, robe: 0x101410, trim: 0x4a5a40,
    focus: 'bonestaff+lantern', focusDesc: 'staff of fused bones topped with a skull with green soul-fire eyes; left hand holds a small skull lantern with green flame',
    hat: 'deep cowl with skull mask',
  },
  bloodmage: {
    name: 'Blood Mage', title: 'Heir of the Crimson Covenant', element: 'blood',
    color: 0xff1838, color2: 0xff8090, robe: 0x3a0610, trim: 0x101010,
    focus: 'dagger', focusDesc: 'curved ritual dagger with a ruby pommel in the right hand; left hand bare with glowing red veins and dripping blood',
    hat: 'hooded mantle',
  },
  chronomancer: {
    name: 'Chronomancer', title: 'Weaver of Hours', element: 'time',
    color: 0x40e0c8, color2: 0xffd27a, robe: 0x0e3a3a, trim: 0xd8b060,
    focus: 'hourglass', focusDesc: 'brass staff with a rotating gyroscope of rings around a glowing hourglass; left hand with orbiting clock-gear runes',
    hat: 'circlet with floating clock hands',
  },
  warlock: {
    name: 'Warlock', title: 'Pactbound of the Hollow Star', element: 'shadow',
    color: 0xb03cff, color2: 0xff50c8, robe: 0x14081e, trim: 0x5a1a6a,
    focus: 'tome', focusDesc: 'black whispering tome with an eye on the cover in the left hand; right hand tattooed with glowing violet sigils, claw-like gestures',
    hat: 'horned hood',
  },
  lightbinder: {
    name: 'Lightbinder', title: 'Lantern of the Last Dawn', element: 'holy',
    color: 0xffd860, color2: 0xfff4c0, robe: 0xd8d0c0, trim: 0xc89a30,
    focus: 'lanternstaff', focusDesc: 'tall brass staff with an ornate hanging lantern containing radiant light; left hand open with golden halo glyph',
    hat: 'white hood with gold circlet',
  },
  geomancer: {
    name: 'Geomancer', title: 'Shaper of the Deep Stone', element: 'earth',
    color: 0xe0a050, color2: 0xffd090, robe: 0x4a3420, trim: 0x2a3a20,
    focus: 'gauntlet', focusDesc: 'massive stone gauntlet on the right fist with glowing amber runes and crystal shards; left hand holds a rough staff of petrified wood',
    hat: 'leather hood with stone pauldrons',
  },
  druid: {
    name: 'Thornweaver', title: 'Druid of the Rotting Grove', element: 'poison',
    color: 0x9adf3a, color2: 0xe8ff90, robe: 0x2a3a18, trim: 0x5a3a20,
    focus: 'livingstaff', focusDesc: 'gnarled living wood staff with thorny vines, leaves and a glowing green seed-pod; left hand entwined with vines',
    hat: 'antler crown with leaves',
  },
  spellblade: {
    name: 'Spellblade', title: 'Arcane Knight of the Severed Oath', element: 'blade',
    color: 0x5ab8ff, color2: 0xd8f0ff, robe: 0x1a2028, trim: 0x8090a0,
    focus: 'sword', focusDesc: 'longsword with glowing blue runes along the fuller in the right hand; left hand bracer with a hovering rune circle',
    hat: 'open-faced helm with hood',
  },
  tempest: {
    name: 'Tempest', title: 'Child of the Howling Peaks', element: 'wind',
    color: 0xa8fff0, color2: 0xffffff, robe: 0x2a5050, trim: 0xe0e0d0,
    focus: 'fan', focusDesc: 'pale driftwood staff with feathers and a swirling wind orb; left hand with visible spiralling air currents',
    hat: 'feathered hood',
  },
};

export const CLASS_IDS = Object.keys(CLASS_META);

// element colors used across VFX/UI
export const ELEMENT_COLORS = {
  fire: 0xff6a1a, frost: 0x6fd6ff, lightning: 0x8fb0ff, arcane: 0xc060ff, necrotic: 0x7dff6a,
  blood: 0xff1838, time: 0x40e0c8, shadow: 0xb03cff, holy: 0xffd860, earth: 0xe0a050,
  poison: 0x9adf3a, blade: 0x5ab8ff, wind: 0xa8fff0, physical: 0xdddddd,
};
