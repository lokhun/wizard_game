# Arcane Ascent

A first-person, co-op wizard roguelike for the browser. Fight your way up from the **Drowned Sewers**, through the **Oubliette** prison, the moonlit **Bailey** courtyard and the **Hall of Whispers**, to the final duel with **the Hollow King** on his throne.

- **13 wizard classes**: Pyromancer, Cryomancer, Stormcaller, Arcanist, Necromancer, Blood Mage, Chronomancer, Warlock, Lightbinder, Geomancer, Thornweaver, Spellblade and Tempest. Each has 5 spells and a passive.
- **Elemental reactions**: Melt, Shatter, Overload, Electrocute, Superconduct, Combust, Blight, Purge, Hemorrhage, Paradox and Sandstorm. In co-op you can set up reactions for each other.
- **Roguelite runs**:
  - Procedurally generated floors with ambush rooms, elite chambers, treasure rooms, shrines and a merchant.
  - Arcane Tomes (pick 1 of 3, with four rarities) and relics.
  - A boss at the end of every realm: Mother of Filth, The Executioner, Gravemaw the Stone Wyvern, Archmage Veyrin and the Hollow King. Each boss has 3 phases.
- **Co-op for 1–4 players**: peer-to-peer over WebRTC with a 5-letter party code, so no game server is needed.
  - Fallen allies can be revived. Allies who bleed out come back when the chamber is cleared.
  - Every player chooses their own rewards.
- **Grim, torch-lit visuals**, all generated in code. There are no asset files:
  - GPU-generated stone, wood and metal textures.
  - Dynamic torch lighting, volumetric-feeling fog, bloom and colour grading.
  - Thousands of GPU particles and element-specific spell effects.
- **Procedural audio**: all sounds and music are synthesised with Web Audio.
  - About 100 layered sound effects, ambience for each realm, and generative music that shifts between exploring, combat and boss fights.
- **Tactical fights:**
  - Enemy waves are built as squads: a shield wall with archers behind it, casters with bodyguards, or flanking packs.
  - Kill an enemy mid-windup to interrupt its attack.
  - Shield-bearers must be flanked.
  - War-banner bearers empower everything around them.
  - Powder kegs chain-explode.
  - Pillars and statues break line of sight.
- **And more:**
  - Sigils above doorways reveal the room beyond: ambush, elite, treasure, shrine, merchant or boss.
  - Barrels and crates can be destroyed.
  - Champion enemies carry affixes: hasted, vampiric, volatile or shielded.
  - Boss intro cinematics, and fallen co-op players spectate their teammates.
  - Winning unlocks **Ascension** difficulty levels.

## Controls

| Key | Action |
| --- | --- |
| WASD | Move |
| Mouse | Aim |
| Left click (hold) | Primary spell |
| Right click | Secondary spell (some are held channels) |
| Q / E | Abilities |
| R | Ultimate (charges as you deal damage) |
| Shift | Dash (brief invulnerability) |
| Space | Jump (jump over boss shockwaves) |
| F | Interact / hold to revive an ally |
| G | Ping a location for your party |
| Tab / M | Map |
| Esc | Pause and settings |

## Running locally

```bash
npm install
npm run dev        # http://localhost:5173
```

## Building for your website (lokhunproject)

```bash
npm run build
```

This produces a fully static `dist/` folder: `index.html` plus hashed JS, CSS and font files.

1. Upload the **contents** of `dist/` to any folder on your site, for example `https://lokhunproject.com/arcane-ascent/`.
   - The build uses relative paths (`base: './'`), so it works from any sub-path.
2. That's it. There is nothing to run server-side.

To embed it in an existing page, use an iframe. Pointer lock needs the `allow` attribute:

```html
<iframe src="/arcane-ascent/index.html" style="width:100%;height:100vh;border:0"
        allow="fullscreen; pointer-lock; autoplay; clipboard-write"></iframe>
```

### How co-op works

1. One player clicks **Host Co-op Party** and gets a code such as `K7QXM`.
   - The class-select screen has a **Copy invite link** button that copies `…?join=K7QXM`.
2. Friends open the link, or click **Join a Party** and type the code.
3. Everyone picks a class. The host presses **Begin Ascent**.
4. Players can also join a run that is already in progress.

Connections are direct, browser-to-browser, over WebRTC:

- The host's browser runs the enemies, so the host should be the player with the best computer and connection.
- To find each other, browsers use the free public PeerJS signalling server (`0.peerjs.com`) and Google's public STUN servers. No game data passes through them.

### Optional: your own signalling or TURN servers

Some strict corporate or university networks block peer-to-peer connections. If that's a problem for your players, you can add a TURN relay, and you can also run your own signalling server.

Add a script **before** the game's script tag in `dist/index.html`:

```html
<script>
  window.ARCANE_NET = {
    // your own PeerJS server (npx peerjs --port 9000 --path /arcane), optional:
    host: 'peer.lokhunproject.com', port: 443, path: '/arcane', secure: true,
    // TURN relays for players behind strict NATs (e.g. from metered.ca or your own coturn), optional:
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'turn:YOUR_TURN_HOST:3478', username: 'USER', credential: 'PASS' },
    ],
  };
</script>
```

You can also set the signalling server with URL parameters: `?peerHost=…&peerPort=…&peerPath=…&peerSecure=0|1`.

## Project layout

```
src/
  main.js              boot, menus, lobby/session flow, main loop
  core/                seeded RNG, math, input
  render/              renderer + post FX, GPU procedural textures, GPU particles,
                       light pool, VFX library (explosions, beams, lightning, telegraphs)
  world/               biomes, level generator, level mesh builder, props, collision
  game/
    game.js            world orchestration, damage, hazards, rewards, floors
    classes.js         13 class kits (spells as code)
    caster.js          spell context (same code drives local casts and co-op replays)
    spells.js          projectiles, zones, timers, spatial queries
    combat.js          statuses, elemental reactions, crits
    actors.js          enemies/summons: host AI, client interpolation, death FX
    bosses.js          5 multi-phase boss scripts
    director.js        room encounters, waves, scaling
    upgrades.js        Arcane Tomes and relics
    enemyModels.js / wizardModels.js   procedural characters, viewmodels and avatars
  audio/               procedural Web Audio sound effects and generative music
  net/                 PeerJS transport + in-run message handling
  ui/                  DOM HUD, menus, icons, styles
docs/RESEARCH.md       design research that shaped the game
tools/                 model viewers (npm run dev, then open /tools/models.html or /tools/wizards.html)
```

## Debug and testing helpers

The automated tests use these URL parameters:

- `?autostart=pyromancer`: skip the menus.
- `&floor=2`: start on a later realm.
- `&quality=low|medium|high|ultra`: set graphics quality.
- `&test=1`: expose `window.__game`, `window.__input` and `window.__sim(seconds)`, which advances the game without rendering.

`scripts/coop-test.mjs` runs a two-browser co-op session against a local PeerJS server (`npx peerjs --port 9000 --path /wizard --host 127.0.0.1`).
