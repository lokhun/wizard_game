# Arcane Ascent

A first-person, co-op wizard roguelike for the browser. Fight your way up from the **Drowned Sewers**, through the **Oubliette** prison, the moonlit **Bailey** courtyard and the **Hall of Whispers**, to the final duel with **the Hollow King** on his throne.

- **13 wizard classes**: Pyromancer, Cryomancer, Stormcaller, Arcanist, Necromancer, Blood Mage, Chronomancer, Warlock, Lightbinder, Geomancer, Thornweaver, Spellblade and Tempest. Each has 5 spells and a passive.
- **Elemental reactions**: Melt, Shatter, Overload, Electrocute, Superconduct, Combust, Blight, Purge, Hemorrhage, Paradox and Sandstorm. In co-op you can set up reactions for each other.
- **Roguelite runs**:
  - Procedurally generated floors with ambush rooms, elite chambers, treasure rooms, shrines and a merchant.
  - Arcane Tomes (pick 1 of 3, with four rarities).
  - 43 **relics** from treasure rooms, elite chambers, shops and shrines. Most are procs you can see: kills loose seeking soul wisps, dashes leave fire trails, frost mines or an exploding afterimage, crits sear burning glyphs, motes of lightning orbit you, a familiar fights at your shoulder. Five are **Cursed**: big upside, real downside.
  - Relic **sets** (Pyre, Storm, Grave, Tide, Fang, Arcanum) wake a bonus at 2 and 3 pieces.
  - 39 **spell augments**, three per class, that change how a spell works. For example, Fireball bursts into cinders, Chain Lightning forks, and the Arcane Orb boomerangs back to you.
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
  - Optional **Trial** rooms: beat a tougher wave against the clock for an Epic tome.
  - Some rooms have their first squad camped around a fire, so you can scout and strike first.
  - **Room modifiers**: some fights happen in Darkness, under a Blood Moon, Haunted by specters that pass through walls, in an Arcane Surge or in a Powder Store.
  - **Named champions** with two affixes and a health bar guard some elite chambers, and an epic hoard.
  - **Mimics** lurk among the treasure chests (look closely), a **Blood Altar** and a **Gambler** offer bargains, and **secret rooms** hide behind cracked walls.
- **A living world:**
  - Rats scurry along the walls, bats burst from the vaults, and crows take wing in the bailey.
  - Mist drifts over the cobbles, ivy trails from the battlements, and moss, water stains and cracks mark the walls.
- **And more:**
  - Sigils above doorways reveal the room beyond: ambush, elite, treasure, shrine, merchant or boss.
  - Barrels and crates can be destroyed.
  - Champion enemies carry affixes: hasted, vampiric, volatile or shielded.
  - Boss intro cinematics, and fallen co-op players spectate their teammates.
- **Reasons to come back:**
  - A **run summary** on every victory and defeat: time, realm, kills, damage, your biggest hit, the build you bound, what killed you and a chronicle of every fight. In co-op, every wizard gets a column.
  - A persistent **Codex**: 30 feats with in-run toasts, per-wizard records (wins, best realm, fastest victory, highest heat), a bestiary and lifetime totals.
  - **Pacts of Ascension**, unlocked by your first victory: 11 difficulty modifiers (tougher, faster or more numerous foes, enraged bosses, scant healing, no rerolls...) that add heat, recorded per wizard.
  - The **Daily Rite**: one seed, one wizard and one set of pacts for everyone each day, with a best result and a streak.

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
npm run dev        # http://localhost:5173 - for editing; slow to load, not representative
npm run build && npm run preview   # http://localhost:4173 - the real, optimised game
```

Judge performance with the **preview** build: the dev server serves hundreds of unbundled, unminified modules.

## Building for your website (lokhunproject)

```bash
npm run build
```

This produces a fully static `dist/` folder: `index.html` plus hashed JS, CSS and font files.

1. Upload the **contents** of `dist/` to any folder on your site, for example `https://lokhunproject.com/arcane-ascent/`.
   - The build uses relative paths (`base: './'`), so it works from any sub-path.
   - Include the hidden `.htaccess` file (some FTP clients hide dotfiles).
2. That's it. There is nothing to run server-side.

### Hosting efficiently

Your server only sends the files once per player (about 0.5 MB compressed); after that, everything runs in the players' browsers on their own GPUs, and co-op traffic goes directly between players. So a basic host serves many players easily, as long as files are compressed and cached:

- **Compression:** the build writes a brotli (`.br`) and gzip (`.gz`) copy next to every JS/CSS/HTML file (1.8 MB of code becomes about 0.46 MB). Serve those instead of the raw files:
  - Apache (most shared hosting): the included `.htaccess` does it.
  - Netlify / Cloudflare Pages / Vercel: they compress automatically; `_headers` sets caching.
  - nginx:
    ```nginx
    location /arcane-ascent/ {
      gzip_static on;          # serves the .gz files
      brotli_static on;        # needs ngx_brotli; otherwise gzip is used
      location ~ /assets/ { add_header Cache-Control "public, max-age=31536000, immutable"; }
    }
    location = /arcane-ascent/index.html { add_header Cache-Control "no-cache"; }
    ```
- **Caching:** files in `assets/` have content hashes in their names, so they are cached for a year and never re-downloaded. `index.html` always revalidates, so a new upload reaches players immediately.
- A CDN in front (e.g. Cloudflare's free plan) makes first loads fast worldwide.

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
- Traffic is small, about 8 KB/s per player. Enemy and player positions go over an unordered channel, so a lost packet never holds up the newer updates behind it; events (casts, hits, pickups) go over a reliable one.
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
    upgrades.js        Arcane Tomes and relic rolls
    relicDefs.js       relic data, sets and their stat bonuses
    relics.js          relic procs and their (replicated) visuals
    enemyModels.js / wizardModels.js   procedural characters, viewmodels and avatars
  audio/               procedural Web Audio sound effects and generative music
  net/                 PeerJS transport + in-run message handling
  ui/                  DOM HUD, menus, icons, styles
  meta/                run tracking (game.events), profile, feats, pacts, daily rite, run summary, codex
docs/RESEARCH.md       design research that shaped the game
tools/                 model viewers (npm run dev, then open /tools/models.html or /tools/wizards.html)
```

## Debug and testing helpers

The automated tests use these URL parameters:

- `?autostart=pyromancer`: skip the menus.
- `&floor=2`: start on a later realm.
- `&quality=low|medium|high|ultra`: set graphics quality.
- `&test=1`: expose `window.__game`, `window.__input` and `window.__sim(seconds)`, which advances the game without rendering.
- `?screen=summary&demo=win|loss|coop`, `?screen=codex&tab=0-3`, `?screen=pacts|daily|select`: open a meta screen directly; add `&profile=demo` to fill the profile with sample progress (test browsers only: it overwrites the stored profile). With `test=1`, `window.__screen(name, arg)` switches between them.
- `&relics=stormwheel,soullantern`: with `test=1`, start the run holding these relics (ids from `src/game/relicDefs.js` and `upgrades.js`).

`scripts/coop-test.mjs` runs a two-browser co-op session against a local PeerJS server (`npx peerjs --port 9000 --path /wizard --host 127.0.0.1`).
