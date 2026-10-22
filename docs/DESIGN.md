# Arcane Ascent — Design Notes

How the research in `RESEARCH.md` turned into the game.

## Pillars
1. **Every cast feels powerful.** Each cast stacks several feedback cues:
   - On cast: a viewmodel recoil spring, a muzzle flash, a field-of-view kick and a light flash.
   - On hit: element-coloured particles, a hit marker, a damage number and an enemy flash.
   - On crits and heavy blows: hit-stop.
2. **Darkness is the default.** Torches are pools of warm light, and magic is the brightest thing on screen. The research asked for a cool, readable silhouette with no torches lit, so the wizard's focus carries a small class-coloured light.
3. **Co-op is first-class.** Elemental reactions reward teams that mix schools. Players can revive each other, a downed player gets back up when the chamber is cleared, and every player gets their own rewards.
4. **Readable danger.** Every heavy enemy attack is telegraphed on the ground:
   - Red marks a normal attack; purple and green mark arcane or poisonous ones.
   - Wind-ups are 0.6–1.2 s for heavies and at least 0.3 s for light attacks.
   - Boss shockwaves can be jumped.

## Run structure

| Realm | Theme | Boss |
| --- | --- | --- |
| 1. Drowned Sewers | water channels, slimes, rats | Mother of Filth |
| 2. Oubliette | prison cells, skeletons, jailers | The Executioner |
| 3. Moonlit Bailey | open sky, moon shadows, knights, gargoyles | Gravemaw, the Stone Wyvern |
| 4. Hall of Whispers | library and great halls, animated armour, grimoires | Archmage Veyrin |
| 5. Hollow Throne | marble, purple fire, royal guard | The Hollow King |

- **Floor layout:** each floor has about 6 main-path rooms plus 2 side branches.
  - Main path: start → 3–4 combat rooms → elite room → shop → boss.
  - Side branches: treasure (relic choice) and shrine (blessing).
- **Rewards:** a sigil above each doorway shows what lies beyond.
- **Spell augments:**
  - 39 class-specific tomes, three per class, at Rare rarity or better. Each changes a spell's behaviour rather than its numbers.
  - About half of all tome offers include one.
  - Several feed reactions, for example Crown of Rime → Shatter, Ossuary Wake → Blight and Recurrence → Paradox, so builds lean into a class's combo.
- **Relics** are the run-defining pickups (treasure rooms, elite chambers, the merchant, the Gaoler's shrine):
  - Most are procs with their own look, triggered on hit, crit, kill, multi-kill, dash, cast, ability use, taking damage, standing still, low health, fight start, gold pickup or chamber clear.
  - Cursed relics (crimson double frame) pair a strong upside with a real downside.
  - Sets: Pyre, Storm, Grave, Tide, Fang and Arcanum each wake a bonus at 2 and 3 pieces (banner when it wakes; set pips on the HUD shelf). Relics of a set you hold roll twice as often.
  - Procs run where the owner's damage is computed (their own machine) and go through the normal hit path; each one is broadcast as a named visual (`rfx`) that teammates replay without damage. Orbiting motes, the familiar and the frost sentinel are rebuilt on every machine from the owner's relic list.
  - Proc damage grows ×(1 + 0.3 per realm) on top of the usual damage stats.
- **Trial rooms:** an optional gilded side door (sigil ⧗) on some floors.
  - Inside: a denser fight with more champions and a 45 s clock (+3 s per realm).
  - Clear it in time for an Epic-or-better tome and triple gold; if the clock runs out, you still fight your way out for an ordinary reward.
- **Encounters** (`game/encounters.js`) keep floors from repeating. The level generator picks them from the floor seed, so every peer agrees; the host runs them.
  - *Room modifiers* on up to 1 fight on the first floor and 2 later, never the first fight. Each has its own door sigil, shows from the doorway and is announced on entry:
    - **Darkness** (◐): the torches gutter, then go out when the doors lock; your own light grows. Rare tome.
    - **Blood Moon** (◉): red torches and grade; foes hit 35% harder but drop 2.5× gold.
    - **Haunted** (☽): specters seep out of the walls through the fight and drift through stone. Rare tome.
    - **Arcane Surge** (✦): every cooldown runs 60% faster for you and 50% faster for them.
    - **Powder Store** (✹): 7–10 kegs on the floor, fuses fizzing.
  - *Champions* hold about half the elite chambers (sigil ♛): a named elite (Gorvath the Unbroken…) with an affix and a trait (Warcaller, Thunderous, Juggernaut, Venomous), +50% health and a health bar. Guaranteed Epic tome, a relic chest and double gold.
  - *Mimics*: about a third of treasure chests. Tells: no glitter, the lid lifts a crack every few seconds, two fang tips hang below the seam, the odd drop of drool. Opening it, standing over it or hitting it (×1.5 unaware) wakes it; the vault locks. Killing it frees its hoard (a relic chest), a Rare tome and a health orb.
  - *Bargains*: most floors have a third side room, a **Blood Altar** (♰: pay 35% health for an Epic tome, take a curse — the next 2 fights each gain an elite — for a relic now, or bleed for gold) or a **Gambler** (⚄: wager gold for a tome of random rarity, price rising each roll, or double-or-nothing).
  - *Secret rooms* on ~60% of floors: a vault in an empty block, joined to a room by a passage sealed with a cracked wall. Tells: glowing cracks, a whistling draught, dust drifting out and the warm light of the brazier behind. Any spell or blast that hits it brings it down onto a relic chest.
- **After a combat room is cleared:**
  - A tome pedestal appears. Each player takes 1 of 3 Arcane Tomes; rarity scales the numbers ×1 / 1.3 / 1.6 / 2.0, and players get 1 reroll per floor.
  - Shared gold drops.
  - Every living player recovers 15% health (a breath of respite), and health orbs pull in from 5 m.
- **After a boss falls:** the party gets a heal, a tome pedestal with better odds, and a portal to the next realm.
- **Shrines** offer Mending (full heal), Fortitude (+30 max health) and a bargain in their realm's character: the Drowned Idol's Pact of Blood (30% health for an epic tome), the Gaoler's Chains of Fate (15 max health for a relic), the Fallen Guard's Oath (+1 dash charge), the Archivist's Insight or Transmutation (2 rerolls, or trade your newest tome for an epic), and the Hollow Crown's Price (40% health for a legendary tome).
- **The last kill** of a fight plays in half a second of eased slow motion with a warm wash of light.
- **Pacing:** a bot with perfect aim (that never dodges) clears rooms in 10–25 s and bosses in about 40–80 s. Human players should land at roughly 30–60 s per room and 2–4 min per boss.

## Meta progression
- **The run summary** is the end of every run: animated count-ups, "new record" stamps against the profile, the build, a per-room chronicle (type, time, damage taken) and what killed you. Each machine gathers its own player's numbers and sends them to the party when the run ends (`rsum`), so co-op shows a column per wizard.
- **The profile** is one versioned localStorage blob (`src/meta/profile.js`), sanitised on load and kept in memory first, so blocked or full storage only costs persistence. The old run totals are folded in once.
- **Feats** (30) listen to the run tracker, which digests the game's event bus (`game.events`: hit, kill, hurt, roomLock, roomClear, bossDown, floor, tome, relic, end...). Combat code only emits; nothing in it knows about feats. God-mode runs record nothing.
- **Pacts of Ascension** unlock after the first win. Each pact sets one knob on `game.difficulty` (enemy health/damage/speed/count, champion rate and affixes, room-clear healing, shop prices, boss phase thresholds, rerolls, health orbs); enemy definitions are never touched. The host's pacts travel in the `start` message. Highest heat cleared is kept per wizard.
- **The Daily Rite** derives seed, wizard and pacts (heat 3-5) from the UTC date, so everyone gets the same rite with nothing to fetch. It records a best result and a streak of consecutive days.

## Scaling
- **Enemy health per floor:** ×1 / 1.65 / 2.5 / 3.5 / 4.8. This applies to regular and elite enemies only.
- **Boss health** is tuned per boss in `BOSS_DEFS` (5,760 / 9,360 / 17,500 / 23,000 / 36,000; tomes stack up late, so the last three are beefier) and does not get the floor multiplier.
- **Enemy damage per floor:** ×1 / 1.25 / 1.55 / 1.85 / 2.2.
- **Party size:**
  - Enemy count grows by +50% per extra player.
  - Trash health grows by only +32% per extra player, because the research flagged health sponges as a common complaint.
  - Boss health grows by +45% per extra player.

## Combat design: how a fight actually plays

The target pace is quicker than Dark and Darker, nowhere near a boomer shooter, with decisions that matter more than reflexes.

- **Movement:**
  - 6 m/s base speed with a touch of acceleration weight (about 0.12 s to full speed).
  - Two dash charges with 3 s recharge, each dash 6.5 m with i-frames.
  - Skirmishers (rats, hounds, imps) are faster than you, so you deal with them rather than outrun them. Line troops are slower, so you can reposition.
- **Room spacing:**
  - Fight rooms are about 20–30 m across (about 600 m² of floor). Boss arenas are 36 m.
  - Crossing a room takes about 4 s at a run, so there is space to reposition without kiting forever.
- **Waves are squads, not piles:**
  - Every enemy has a role: fodder, skirmisher, line, heavy, ranged or caster.
  - Each wave is built from a template per realm:
    - *shieldwall*: a melee line with archers behind it.
    - *coven*: casters with guards.
    - *hunters*: a fast pack with an anchor.
    - *horde*, *vanguard* and *crossfire*.
  - The opening wave uses a simple squad. A squad's minimum slots always spawn. Waves are capped at 9 bodies, +50% per extra player.
- **Readable arrivals:**
  - Enemies spawn across the room from where the party entered, at least 8–11 m away. The backline spawns at the far edges.
  - Spawns are staggered with a summoning glyph.
- **Sentry rooms:**
  - About half the fight rooms have their first squad already gathered around a lit camp brazier, visible from the doorway.
  - Scout, then choose your opening. Hitting an unaware sentry deals ×1.5.
  - Sentries wake when they see you within 11 m, when you get close, when you hit them, or 8 s after the doors lock. A woken sentry alerts others within 13 m.
- **Fairness rules:**
  - At most 3 melee attackers press one player; the rest circle.
  - At most 2–3 shooters wind up on one player at once.
  - Overlapping pools don't stack.
- **Telegraphs and interrupts:**
  - Heavy attacks paint the ground: circle, cone, rectangle or wave.
  - Melee wind-ups flash a glint at the head and play the creature's voice. When the attacker is behind you, a screen-edge marker shows.
  - **Killing an enemy mid-windup cancels its attack** ("INTERRUPTED"), so it pays to focus the big wind-up.
- **Positional enemies:**
  - Shield-bearers (Jailer, Royal Guard, Gilded Sentinel) turn frontal hits ("BLOCKED — flank it").
  - The Hollow Bannerman empowers foes within 9 m (+30% damage, +15% speed) until it dies.
  - The Plague Surgeon (Oubliette) hangs back lobbing rot flasks that leave poison pools and mends nearby prisoners with its censer: kill it first.
  - The Grim Warden (Hall of Whispers) is a slow, heavily armoured maul-wielder whose huge overhead cracks the floor ahead of it; step aside and punish the recovery.
- **The environment:**
  - Sewer and throne rooms have mid-room pillars or statues to break line of sight.
  - Shots fly over low clutter.
  - Water slows and makes you Wet, which conducts lightning.
  - **Powder kegs**: 1–2 out on the floor of every fight room, plus about 1 in 5 wall barrels. They explode when broken, chain into each other and hurt anyone close.
- **Sustain:**
  - Clearing a room restores 15% health. Health orbs drop from about 10% of kills and pull in from 5 m.
  - Bosses are a test of the build and of dodging, not of attrition.
- **Feedback:**
  - Hit flinch on a damped spring, a flash, merged damage numbers and a hitmarker.
  - Bodies ride the killing blow and linger.
  - Debris matches the material: bone, metal, slime, spirit or flesh.

## Combat model
- **Statuses:** Burn, Chill (5 stacks become Freeze), Shock, Poison (stacking), Hex, Bleed, Slow, Stun, Wet (from standing in water), Root and Mark.
- **Reactions** are resolved on the attacker's machine, using the target's replicated status flags. The host then applies the numbers.
- **Enemy attacks become "hazards"** that are broadcast to every peer. Each player's own machine decides whether they were hit, so dodging is always judged on what that player actually saw.

## Networking
- **Topology:** WebRTC through PeerJS. The host is authoritative for AI, room state, drops and actor HP.
- **Clients** own their own movement and health. Hit detection for a player's spells runs on that player's machine.
- **Replication:**
  - Player state is sent at 20 Hz.
  - Actor snapshots are sent at 15 Hz and interpolated on clients.
  - Spells are replicated as cast events and replayed for visuals with the same code path, starting from the caster avatar's staff tip.
  - Player state and snapshots travel on a second, unordered data channel with sequence numbers (stale ones dropped), so one lost packet never stalls the stream; events stay on the reliable channel.

## Visual tech
- **Textures:**
  - All surfaces are generated on the GPU at load time: albedo, normal and ORM maps from tileable noise, Voronoi and brick functions.
  - Walls get baked vertex ambient occlusion.
- **Lighting:**
  - A fixed-size pool of point lights is reassigned to the nearest torches and spell effects each frame. Fading prevents popping.
  - The courtyard adds moonlight with shadow maps.
- **Post-processing:** ACES tone mapping, bloom, colour grade per realm, vignette, film grain, chromatic aberration, and damage and heal vignettes.
- **Characters:** every enemy, boss and wizard is built from primitives at load time:
  - Skinned or rigid parts, with procedural poses for idle, move, wind-up, attack, hurt and death.
  - Wizards get a first-person viewmodel (class focus plus articulated hands) and a third-person avatar.
  - First person: every cast blooms a class-specific rune circle at the staff tip or casting hand; charging holds a smaller one. Blades leave a streaked trail, and chained Spellblade cuts alternate forehand and backhand to match the world slash. Standing still a while plays small idle fidgets (a palm-up finger flex, a staff turn, a regrip).
  - Third person (what co-op partners see): layered per-class costumes with faces, world-space cloth chains for skirts, capes, scarves and trinkets, and full idle, strafing walk, cast, downed and dead animation. Each avatar bakes into one skinned mesh per material (15–23 draw calls); so does the first-person viewmodel (about 20, from 60–100), merging only identical materials.
- **Particles:** a GPU particle system where motion is evaluated in the vertex shader (three rings, 36k particles). It drives flames, sparks, smoke, runes, snow and blood.

## Performance rules
- **No shader compiles after load.** A compile is a visible freeze (worst on Windows/ANGLE). Each floor load prewarms everything that can appear: the realm's enemies, bosses and summons, projectile visuals, effect pools, drops, reward pedestal, portal and ground eruptions. It compiles against the scene's HDR target (compiling against the canvas gives different program keys), in parallel on the driver (`KHR_parallel_shader_compile`) behind a loading veil. `scripts/hitch.js` traces frames and reports any program compiled after load.
  - The warm set is kept alive until the next floor: three.js destroys a program when its last material is disposed, so cleaning up the last enemy of a type would otherwise make the next wave recompile.
  - Outside a floor load, compile before showing: the post chain is compiled when the renderer is made (boot waits for it), SMAA once it loads, and the class-select wizard with `renderer.compileObject` before it replaces the last one (which keeps the shared programs alive meanwhile).
  - Skinned meshes keep bone indices as floats: an integer vertex input makes ANGLE/D3D11 build a second vertex shader at the first draw, synchronously on the GPU process's main thread (~50 ms each, 20-40 per floor load).
  - `scripts/hitch-edge.mjs` (Edge on the real GPU) with `hitch-tour.js`, `hitch-ult.js` (`&black=1` counts fully black frames) and `hitch-select.js` reports frame times, program links and first-use waits, and ANGLE compiles in the GPU process, per scenario.
  - Never create materials at cast time, never change a material's defines or maps at runtime, and never add a `THREE.Light`: borrow one from the fixed light pool (`lights.request`, `vfx.flash`). Changing the light count recompiles every lit material in the scene.
- **No uploads in play.** The prewarm draws one frame with culling off so every texture and buffer reaches the GPU at load.
- **Dynamic resolution** steps the render scale down in 10% steps while the frame rate stays under ~48 fps and back up after sustained headroom; a step that doesn't raise the frame rate (CPU-bound: a crowded fight) is undone and the scale left alone for 30 s. A first visit starts integrated GPUs on Medium quality.
- **One full-screen pass after bloom.** Low/Medium/High render the scene and viewmodel into one HDR target (4x MSAA on High, and only there), build the bloom mips from it, then a single final pass adds the bloom, grades, tone maps and writes sRGB to the canvas (SMAA after it on Medium). New screen effects go into `GRADE_MAIN` in `renderer.js`, not into extra passes: every full-res pass is a read and a write of the whole frame, which is what integrated GPUs run out of. Ultra keeps the EffectComposer chain because GTAO sits mid-chain.
- **Particles draw only their live window** of each ring (36k slots in all), and upload only the slots written (as runs, not a min..max span). A long-lived particle holds a window open behind it, so glows living over 0.6 s go to their own ring: keep lifetimes honest.
- **Floor-scoped textures.** A realm's own 1024² wall and floor sets (~17 MB of GPU memory each) are requested with `scope: 'floor'` (`getBiomeMaterials`) and freed once the next floor is built without them; every other request pins its set for the session. Don't hand a biome material to anything that outlives its floor.
- **The moon's shadow pass (courtyard, High/Ultra) draws only what can shadow the view.** A body casts while a sphere grown by its shadow's length (the moon stands ~45° up) meets the camera frustum (`ActorManager._castShadow`); three.js only culls casters against the shadow camera's 72 m box, so every enemy in it was drawn twice. Each enemy casts through one depth-only **shadow twin** (its opaque parts merged, `Rig.finish`), shown only inside the shadow pass (`Renderer.shadowOnly`): one draw instead of one per material. The twin keeps its parts' normals, uvs and a map, so it keys the depth program the floor's warm-up already built.
- **One multisampled resolve a frame.** three.js resolves the HDR target at the end of every `render()`; the scene's resolve is skipped (`skipResolve`) because the hands' render resolves the same target again.
- **Never flag a material every frame.** `material.needsUpdate` (or any version bump) makes three.js rebuild the program parameters and cache key at the next draw: ~30 µs and a pile of garbage. three.js did exactly that twice per draw for transparent double-sided materials (robes, ghosts, slime); `Renderer.twoPass` draws their two halves with the double-sided program and per-half face culling instead.
- **Draw calls are the CPU budget.** Each costs ~10 µs of `renderer.render` (uniform uploads), each shader program switch more (camera and the whole light pool are re-sent): opaque draws are sorted by program before material (`setOpaqueSort` in `renderer.js`). Transparent double-sided materials draw twice in three.js unless additive without depth writes (forced single pass globally in `renderer.js`): give alpha-blended ones `FrontSide` when the back faces aren't needed.
- **Lit pixels pay only for lights in range.** The point-light loop skips lights whose attenuation is zero (`lights_fragment_begin` patched in `renderer.js`), so idle pool slots and far torches cost a branch. Large transparent lit quads (decals) use `alphaTest` so their empty texels are dropped before lighting.
- **Measure with the tools:** `scripts/stress.js` (a 4-player fight against ~50 enemies inside `__sim`: per-system ms per frame, p95/p99 frame spikes, LOS calls, HUD glyph renders, particles drawn vs alive; `&fine=1` also times per-actor calls) and `scripts/profile.mjs` (CDP CPU profile of just the timed window, `--alloc` samples what the window left alive on the heap, `CALLERS=fn` to see where a hot function is called from). SwiftShader timings are noisy: compare medians of repeated runs, and counts. On a real GPU, `scripts/fps.mjs` A/B-tests builds side by side in one browser (Edge on Windows, uncapped frame rate): explore / fight / heavy scenarios, measured windows alternating between builds so a busy machine slows both alike; avg fps, 1% low, CPU ms of update and render, draw calls, and with `--gpu passes` (`--frozen` for a still frame) GPU ms per pass from timer queries, or `--gpu draws` per draw.
- **Keep hot objects monomorphic.** Every field an actor ever gets is declared in the `Actor` constructor, and enemy defs and attacks share one layout (`sameShape` in `enemyDefs.js`): with fields added as they came up, actors had dozens of hidden classes, and V8 reads numbers off megamorphic objects slowly and boxes every one (a quarter of a fight's garbage). Add new actor fields to the constructor.
- **No garbage in per-frame loops.** The light pool selects its torches and requests without copying or sorting arrays and pools its requests and flashes; `game.allPlayers()` is one shared array (read it, never change it); the hostile and ally lists are rebuilt only when their members change. `scripts/stress.js` reports heap growth per simulated second.
- **Still bodies cost nothing.** An enemy that neither posed nor moved this frame (corpses, sentries, the frames an out-of-view or distant one skips) keeps its matrices and bone texture (`ActorManager._settle`): the scene's matrix pass skips it and its skeleton isn't uploaded; any change marks the skeleton dirty, so its next draw updates it. A teammate out of view poses every 4th frame.
- **HUD writes are cheap or skipped.** DOM values are written only when they change (`setText`, `setStyle`); damage-direction markers are pooled, one per direction, and moved on the compositor (`will-change`).
- **Spread spikes over frames.** Waves and sentry squads spawn one enemy at a time (each is ~0.5-1 ms of model building); a teammate joining mid-floor is compiled on the driver's threads before their wizard is drawn; the HUD warms every font it draws with at boot (the first measureText in a new size stalled 5-12 ms).
- Hot-path habits: compute line of sight only when the answer is used, update a skinned avatar's matrices once per frame (each full pass over its ~150 nodes is a third of its cost), and keep rarely used code (PeerJS, SMAA) behind dynamic imports.
- **Hosting:** the build writes brotli and gzip copies of every asset (about 0.5 MB to download; PeerJS and SMAA are separate chunks fetched only when used); `.htaccess` / `_headers` set year-long caching on the hashed assets.
