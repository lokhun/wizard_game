# Wizard Roguelike Research Brief

Project: browser-based (three.js) first-person co-op (1-4 players) wizard roguelite.
Route: Sewer -> Dungeon/Prison -> Castle Courtyard -> Keep Halls/Library -> Throne Room.
Target look: Dark and Darker (grim, torch-lit high fantasy), stylized but detailed, strong VFX.

> Confidence key: **[src]** = backed by a cited source. **[craft]** = standard industry practice or a
> starting value to tune in playtests, not a sourced fact. Sources are listed at the end (S1..S30).

---

## 0. Design Pillars (derived from everything below)

1. **Light is the main art direction and a gameplay tool.** Darkness is the default; every light is placed with a reason.
2. **Choice every room.** Show the reward on the door, offer 1 of 3, and make builds come from slots plus synergies.
3. **Every cast is a small event.** 5-8 small feedback cues fire within 100 ms of each cast and each hit.
4. **Co-op multiplies, it doesn't divide.** Add enemy count before enemy HP, keep revives short and active, and use team combos.
5. **Readable danger.** Every attack has a shape, color, and sound telegraph that matches how much it punishes.

---

## 1. The Dark and Darker Visual Style and How to Do It in WebGL

### 1.1 What defines the look
- **Engine/tech:** Unreal Engine 5. Its dynamic GI makes indoor spaces much darker than outdoors, and emissive surfaces add light without extra lights [S1]. That GI isn't available in WebGL, so fake it with baked lightmaps and AO.
- **Light as a mechanic:** Torches, lanterns, campfires, and the Wizard "Light" spell are light sources. Anyone near one becomes "Illuminated" and can't hide. Hand-held lights burn fuel [S2]. Players douse torches to hide in dark corners [S2].
- **The darkness pushes the line on purpose:** Steam threads complain that "the game is too dark" and that torch light doesn't cover rooms [S2]. Lesson: go dark, but keep a floor so silhouettes stay readable (see 1.3).
- **Palette:** warm sodium-orange torch pools (~1800-2200K, `#ff8a3d`-`#ffb066`) against cool desaturated blue-green shadows (`#0b1016`-`#1a2228`). There's very little saturated color except **magic** (blue, purple, green emissives) and **blood** [craft].
- **Materials:** grounded, slightly stylized PBR. Stone, timber, iron, cloth, and bone, with heavy grime, edge wear, and high roughness. Proportions are slightly chunky and props are dense (barrels, chains, cobwebs, candles) [craft].
- **Atmosphere:** dust motes in light shafts, low-lying haze, and deep black corners. A freelance "dark fantasy look-dev" brief lists the same stack: minimal motivated lights, locked manual exposure, genuinely dark shadow floor, volumetric plus ground fog, film grain, and a LUT [S3].
- **UI:** diegetic medieval. Dark leather or parchment panels, thin muted-gold borders, a serif display face (Cinzel or IM Fell style), a minimal HUD, item tooltips with rarity color (grey, green, blue, purple, orange, gold), and inventory as a grid of hand-painted icons [craft].

### 1.2 Renderer recipe (three.js)
- **Color pipeline:** `renderer.outputColorSpace = SRGB`. Tone mapping is `AgXToneMapping` or `ACESFilmicToneMapping` with `toneMappingExposure` locked at ~0.8-1.0. Don't auto-expose, because the darkness has to stay dark [S3][craft].
- **Post stack:** use **pmndrs/postprocessing**, which merges effects into one shader pass and is much cheaper than chaining built-in passes [S4]. Suggested order: RenderPass -> SSAO/N8AO -> Bloom -> (God rays: courtyard/library only) -> LUT -> Vignette -> Noise/grain -> SMAA. Three's own composer ends with `OutputPass` for tone map and color space [S5].
  - **Bloom:** luminance threshold ~0.85-1.0, intensity 0.5-1.2, mipmap blur. Only emissives above 1.0 (spells, embers, runes) should bloom, never torch-lit walls [craft].
  - **Vignette:** offset 0.3, darkness 0.5-0.7. **Grain:** opacity 0.03-0.06. **Chromatic aberration:** 0, except as damage feedback [craft].
  - **LUT:** one 3D LUT per biome (`LUT3DEffect`), authored in Photoshop or Resolve from a neutral `.cube`. Crush blacks slightly, push shadows teal and highlights orange, and pull saturation down ~15% [craft].
- **Ambient:** `HemisphereLight` with sky `#1c2633`, ground `#0a0806`, and intensity ~0.05-0.15. This is the readability floor: silhouettes must stay visible at 0 torches [craft].
- **Torches:** `PointLight(color 0xff8a3d, intensity ~4-12 (physical units), distance 6-10 m, decay 2)`.
  - **Flicker:** `I = base * (0.85 + 0.15 * fbm(t*8 + seed))`. Also jitter the position ±2-3 cm and shift the color slightly toward red at low intensity. Each torch gets a unique seed [craft].
  - **Light budget:** three.js forward rendering recompiles shaders when the number of lights changes. Keep a **fixed pool of ~8-16 point lights** and move them to the nearest torches each frame, or use a clustered/tiled forward lib. Fake far torches with emissive flame sprites plus baked lightmap glow [craft].
  - **Shadows:** a shadow-casting point light renders 6 cube faces, so allow **2-4 shadowed lights max**, at 512-1024 map size [S6][craft]. Bake static shadows into lightmaps (Blender bake), and give the player's held light / Wizard Light the dynamic shadow.
- **Fog:** use `FogExp2` with near-black blue-grey color (`#0a0e12`) and density 0.035-0.07 indoors, 0.015 in the courtyard.
  - Height/ground fog through a custom `onBeforeCompile` chunk (density falls off with world Y).
  - Volumetric feel at low cost: **soft-particle fog cards**, lit by nearby lights, drifting slowly. The three.js forum recommends this over stock fog for artistic control [S7]. Raymarched god rays only at window shafts (`three-good-godrays`, needs a shadowed light) [S6].
- **Materials:** stone roughness 0.75-0.95. Sewer wet surfaces roughness 0.15-0.35 with a puddle mask (screen-space or cubemap reflections). Use `MeshStandardMaterial` plus normal, AO, and roughness maps (trim sheets plus tiling textures plus decals for grime and blood). Use emissive runes for magic.
- **Perf for the browser:** use `InstancedMesh` for props, KTX2/Basis textures, a texture atlas or trim sheet, and merged static geometry per room. Stream one room ahead and one behind. Keep a ~1.5-2.5 ms GPU budget for post at 1080p, and render post at 0.75 scale on low preset [craft].
- **Per-biome grading**
  - **Sewer:** sickly green-teal shadows, wet speculars, green bioluminescent fungus as light sources, and thick low fog.
  - **Prison:** cold blue-grey with sparse torches and iron bars that cast striped shadows. Red emissive braziers sit in the torture areas.
  - **Courtyard:** moonlit blue key light (directional, shadowed) with orange braziers. There's open sky, rain or ash particles, and lighter fog.
  - **Keep/Library:** warm candle clusters, dust motes in window god rays, and floating arcane book glows.
  - **Throne room:** the most saturated room, with a crimson/gold palette. The boss is the primary light source, so the room's light changes per phase.

---

## 2. What Makes Room-Based Roguelite Runs Fun

### 2.1 Reference data
- **Hades run structure** [S8]:
  - Biome bosses sit at chamber 14 (Tartarus), 24 (Asphodel), and 36 (Elysium), so each biome is ~10-14 rooms. The final biome's length is variable.
  - Doors preview the reward. Gold laurel icons mean run power (boons, gold, max HP) and blue laurel icons mean meta currency.
  - A full clear takes ~30-45 min [craft, common knowledge].
- **Hades boons** [S9][S10][S11]:
  - Boons are slot-based (attack, special, cast, dash, call) plus passives, and each offer is a choice of 3.
  - Rarity runs Common (white), Rare (blue), Epic (purple), Heroic (red). Rarity changes the numbers, not the behavior.
  - **Duo** boons need prerequisite boons from both gods (≈12% roll when eligible). **Legendary** boons ≈10% and also need prerequisites.
  - "Pom" upgrades show diminishing returns, e.g. 20 -> 36 -> 48. That lets rarity and level work as separate progression axes.
- **Risk of Rain 2 scaling** [S12][S13]:
  - Difficulty coefficient = `(playerFactor + minutes * timeFactor) * 1.15^stagesCompleted`.
    - `playerFactor = 1 + 0.3*(players-1)`
    - `timeFactor = 0.0506 * difficulty(1/2/3) * players^0.2`
    - Enemy level = `1 + (coeff - playerFactor)/0.33`.
  - Item stacking: **linear** for damage and procs, **hyperbolic** `1 - 1/(1 + k*n)` for chance and mitigation so they never reach 100%, and **capped or logarithmic** for cooldown reduction [S12].
- **Enter the Gungeon** [S14]:
  - Every floor guarantees 1 gun chest and 1 item chest.
  - The room-clear reward chance starts low and **rises with each room cleared without a reward** (a pity timer).
  - Chest quality odds go up on deeper floors. Optional mini-reward rooms (10%/floor) and secret rooms reward exploring.
- **Wizard of Legend** [S15][S16]:
  - Four arcana slots: Basic (short CD, fallback), Dash (always usable; its special effect has a CD), Standard (strong, longer CD), Signature (empowered when a meter is full).
  - Six elements. Relics reward *alternating* elements, e.g. Spice Rack: casting a different element cuts the previous arcana's CD by 25%.
- **Magicka** [S17]:
  - 8 base elements, up to 5 queued per spell. **Opposites cancel** (fire/cold, lightning/water).
  - Combos make new elements (water+fire = steam). Element hierarchy decides the spell shape. Friendly fire is the comedic, emergent risk.
- **Noita** [S18]: wands are spell queues read left to right. Modifiers change the *next* projectile, so absurd combos emerge. It shows that a small grammar yields huge combinatorics.
- **Spellbreak** [S19]: element sits in each hand (a gauntlet per hand). Two hands make a two-element combo matrix.
- **Mage Arena** (2025) [S20]: players speak spells aloud through proximity voice, and mis-cast incantations go comically wrong. It hit ~91% positive on Steam, which shows how fun *embodied, fallible* casting is. A good optional mode for voice-chat co-op.
- **Ravenswatch** [S21]: 4-player co-op with a talent pick on level-up. Player complaint: in co-op, *trash* enemies got too much extra HP and stagger resistance, which slowed zones, while boss scaling felt fine.
- **L4D AI Director** [S22]: tracks player stress (damage taken, incapacitations, separation) and cycles **build-up -> peak -> relax**, adjusting spawns and items.

### 2.2 Actionable rules for this game
- **Run length:** about 40-55 min for a full win.
  - Biomes 1-4 take ~8-10 min each. The final boss takes ~6-8 min. First deaths should come around 10-20 min.
  - Plan ~10 rooms per biome: 6-7 combat, 1-2 non-combat (shop, shrine, fountain, event), 1 elite or miniboss, and 1 boss.
- **Room variety per biome**
  - Combat archetypes: Arena (waves), Gauntlet (moving), Ambush, Hold-the-point/ritual (survive 45-60 s), Trap room, Darkness room (light is limited).
  - Never put more than 2 identical archetypes in a row.
- **Encounter size:** 2-3 waves of 4-8 enemies (solo). A room should take **45-90 s**. Elite rooms take 90-150 s and bosses take 3-5 min.
- **Reward cadence**
  - Every combat room gives *something*.
  - Show the reward type on the door (Boon / Gold / Max HP / Spell upgrade / Relic / Key). Always give 2 doors where the layout allows.
  - Boon choice = pick 1 of 3, plus 1 reroll token per biome.
  - Guarantee ≥1 boon-equivalent every 2 rooms (pity timer), a shop before each boss, and a free heal (25-40%) before each boss.
- **Rarity:** Common 60% / Rare 25% / Epic 12% / Legendary 3%, with a pity bump of +5% per offer without an Epic or better. Rarity scales numbers (×1.0 / 1.3 / 1.6 / 2.0). Behavior changes come from **separate "Legendary/Duo" boons** that need prerequisites.
- **Synergy design**
  - Use 5-7 "schools" (Fire, Frost, Storm, Arcane, Shadow/Necro, Nature/Blood, Holy).
  - Each school has **status keywords** (Burn, Chill->Freeze, Shock, Hex, Bleed). Duo boons fire when two keywords meet, e.g. Burn+Chill = "Thermal Shock" crit burst, Shock+Wet = chain range ×2.
  - In co-op, cross-player duos (one player applies, another detonates) are the heart of team synergy.
- **Stacking math:** damage is additive within a category and multiplicative across categories. Proc and dodge chances use the hyperbolic curve. CDR is capped at 50-60%. Show the math in the tooltip.
- **Difficulty curve:**
  - HP/damage of enemies ×1.25-1.35 per biome, and the enemy *roster* is replaced per biome rather than inflated.
  - Add an optional heat/curse system (Hades "Pact" style) for mastery.
  - Pacing should cycle tension -> release, with every 3rd room or so being calmer (L4D model) [S22].
- **Elites:** about 10-20% of spawns from biome 2 on, with 2-3× HP, a visible aura or crown, and 1-2 affixes (Shielded, Volatile, Hasted, Vampiric, Arcane-warded, Splitting). Elites drop guaranteed gold plus a chance at a relic.
- **Boss phases**
  - 2-3 phases split at 66% / 33% HP. Each phase **adds** one new move and remixes old ones, rather than replacing everything.
  - Phase transitions get a 2-3 s invulnerable cinematic beat and a lighting change.
  - Keep each telegraph's *meaning* fixed across phases (same color = same threat) [S23].
- **Telegraph rules** [S23][S24]
  - Wind-up time: 0.6-1.2 s for heavy attacks, ≥0.35 s for light attacks.
  - Visual weight should match damage. Use ground decals (red = damage area, purple = unblockable or must dodge) plus an audio cue plus an emissive glow on the attacker.
  - In first person, **off-screen attackers need a 3D audio cue and a directional HUD indicator.**
  - Hide competing VFX during big wind-ups.
- **Meta progression:** unlock spells, classes, and starting options. Keep permanent stat bonuses small (≤ +20% total) so skill still matters.

---

## 3. First-Person Casting Game Feel ("Juice")

**Principle:** stack **5-8 tiny responses within ~100 ms** and scale them by event size (small, medium, large presets) [S25]. Juice basics are easing/tweening, squash-and-stretch, particles, and sound [S26]. Vlambeer's "Art of Screenshake" talk covers the same ground [S27].

### 3.1 Casting (the player's own action)
- **Viewmodel:** hands, staff, and focus in a separate scene or layer with its own FOV (~55-65°) so they don't distort.
  - Idle sway and breathing, plus look-lag on a spring (k≈120, damping≈14).
  - Pre-cast "gather" anim of 80-150 ms for heavy spells. Light spells fire on frame 0-2, since input lag kills feel.
  - Recoil kick on cast: viewmodel moves back 3-6 cm, rotates up 2-5°, and springs back over 150-250 ms.
- **Casting hand/staff VFX:** charge particles get pulled into the palm, the emissive brightens, and the hand light (a point light from the pool) pulses. A brief muzzle flash sits at the hand.
- **Camera:**
  - FOV kick is +2-4° on heavy casts and -3° zoom while charging, with ~120 ms ease-out.
  - Camera recoil is 0.5-1.5° pitch on heavy spells.
  - Shake uses the **trauma model**: `offset = maxShake * trauma²`, decay ~1.5/s. Apply it to rotation (≤1-2° for the biggest events) and keep position near zero in first person to avoid nausea. Add an accessibility slider [S25].
- **Audio layering:** each spell has 3 layers: transient/click (0-30 ms), body/whoosh (the projectile loop with doppler), and tail/reverb (room-sized).
  - Randomize pitch ±5-8% and volume ±2 dB per cast.
  - Add a low sub layer for heavy spells. Spatialize with PannerNode HRTF.
- **Projectiles:** a bright core sits inside a soft glow, with a trail ribbon and ember sparks. Keep projectiles slightly oversized, and make hitboxes 10-20% more generous than the visual.

### 3.2 Hitting
- **Hit-stop:** freeze **the enemy plus its VFX** for 40-80 ms on heavy hits and crits, not the player camera. In co-op, apply it locally only [S25].
- **Feedback stack per hit**
  - A crosshair hit marker: white for normal, yellow for crit, red X for kill.
  - Hit sound: a "tick" on the attacker plus a fleshy or armor impact at the enemy.
  - Enemy flash: emissive white, 60-100 ms.
  - Impact particles that match the material (stone dust, bone chips, ichor).
  - Decals, and floating damage numbers.
- **Damage numbers:** pop scale 1.4->1.0 over 100 ms, drift upward, and fade in 0.6-0.8 s. Merge rapid DoT ticks into one rolling number. Color by element. Crits get bigger plus an "!". Allow toggles: off / own only / all.
- **Enemy hit reactions:** Vermintide's feel comes from hit interactions, camera, and sound, with **tiered stagger** (light flinch, stagger, knockdown) set by a "hit mass" vs a resistance value [S28].
  - Use additive flinch anims, procedural spine/head offsets, and knockback impulses (0.5-3 m).
  - Big enemies only flinch on poise break.
- **Elemental status visuals:** Burn (ember particles plus orange rim light), Chill (blue tint plus slowed anim playback rate ×0.6), Freeze (ice shell mesh), Shock (arcing line VFX to neighbors), Hex (purple sigil above head).
- **Deaths:** these are the most rewarding moment, so keep variety high.
  - Ragdoll or pre-baked physics death plus an element-specific death: burned turns to ash dissolve, frozen shatters into shards, shocked gets blown back and smoking, arcane disintegrates into motes.
  - Use a dissolve shader (noise threshold plus emissive edge) over 0.5-1 s.
  - Overkill ≥50% earns a gib or explosion. Each death gets a kill sound "thunk" and a tiny resource drop (mana or health orb) to keep the loop going.
- **Resource loop:** in Doom Eternal, each action refills a specific resource (chainsaw gives ammo, glory kill gives health, flame belch gives armor), which drives "push-forward combat" [S29]. Equivalents here:
  - Melee/staff bash gives mana.
  - Kills on frozen or stunned enemies drop health.
  - Crits charge the ultimate.
  - Weak points (glowing crystals or cores) reward accuracy.

### 3.3 Spell numbers (starting values) [craft]
- **Primary (LMB):** 0.25-0.6 s between casts. Fodder dies in 2-4 hits, which makes **TTK ≈ 0.5-1.5 s**.
- **Secondary/charged (RMB):** 0.6-1.5 s charge.
- **Abilities (Q/E):** 6-15 s cooldown. **Mobility (Shift):** 3-6 s, or 2 charges.
- **Ultimate (R):** 60-120 s, or charge-based (filled by damage dealt).
- **Mana as soft gating:** regen ~10-20%/s after 1 s without casting. Mana is how players think, but cooldowns stop spam.
- **TTK targets (solo, biome 1, ~20 DPS-seconds baseline):** fodder 0.5-1.5 s, standard 2-4 s, heavy 6-10 s, elite 10-20 s, miniboss 45-75 s, boss 3-5 min.
- **Player survival:** 6-10 hits from fodder, 3-4 from heavies. Big telegraphed slams deal 25-40% max HP.

---

## 4. Co-op Design

- **Scaling** [S13][S21][craft]
  - Scale **enemy count and spawn rate first** (+50-60% per extra player). Raise HP only modestly: trash ×(1 + 0.25·(n-1)).
  - Ravenswatch players complained when trash HP and stagger scaled too hard [S21].
  - Bosses and elites: HP ×(1 + 0.6-0.75·(n-1)), plus extra targetable mechanics (adds, split aggro) instead of pure sponge.
  - RoR2 scales its difficulty coefficient by `1 + 0.3*(n-1)` and time scaling by `n^0.2` [S13].
- **Downed / revive**
  - A downed player crawls slowly and can still cast a weak "spark" or ping. Bleed-out takes 20-30 s.
  - Revive is a channel of 3-4 s, faster with a talent. Taking damage pauses it but doesn't reset it.
  - Gunfire Reborn's short bleed-out and long dead time were the most criticized parts of its co-op [S30].
  - If bleed-out ends, the player becomes a **ghost/wisp** that can float, ping, and give a small buff. They're revived at the end of the room (rooms are short, so the wait stays under ~90 s) or at a shrine for gold.
  - Each down in a room lengthens bleed-out timers ("downs stack").
  - Solo gets **1-2 "Death Defiance" style self-revives** per run.
- **Rewards**
  - **Instanced, per-player boon choices.** Every player gets their own 1-of-3 offer from a shared door choice, so nobody "steals" loot. Gold and keys are shared, while relics drop one per player.
  - Vote on doors: majority vote with a 10 s timer, ties broken randomly. Show each player's vote as an icon on the door.
  - RoR2-style split loot (one chest, one taker) caused complaints in forums [S31].
- **Role synergy without a holy trinity:** each class has a primary role (damage, control, support, tank/front) plus a *setup or detonate* hook (see Section 5). Cross-player duo boons need statuses applied by different players.
- **Ping system** (Apex model) [S32]: one context-sensitive key.
  - Ping an enemy to mark it (outlined for 5 s, and shows its weakness element).
  - Ping an item to call "dibs" or say "I need this".
  - Ping a location to say "go here", ping a door to vote, and ping a downed ally to say "reviving".
  - Double-tap means danger. Add a radial wheel for extras.
  - Respawn tested it with voice chat banned. Do the same in playtests.
- **Netcode notes for browser** [craft]:
  - Host-authoritative over WebRTC data channels, or a small authoritative Node server (Colyseus).
  - Clients predict their own movement and casts and render projectiles immediately. The host resolves hits and lag-compensates by rewinding ~100-150 ms.
  - Don't let friendly fire kill (allow knockback only), unless a Magicka-style chaos modifier is on.
- **Shared moments:** team ultimates (all 4 ultimates within 3 s = bonus "Convergence" blast), group revive shrines, and a shared resource for co-op relics.

---

## 5. Wizard Classes (12 archetypes)

Each class gets a **unique resource or mechanic**, a **viewmodel identity** (what's in the hands), and a **co-op hook**.

| # | Class | Hands / Focus | Signature mechanic | Role | Co-op hook |
|---|---|---|---|---|---|
| 1 | **Pyromancer** | Bare hands wreathed in fire | **Heat** gauge: casts build Heat, which boosts damage. Overheat (100) = 4 s inferno, then a 3 s burnout | Burst DPS | Burn stacks detonate on others' crits |
| 2 | **Cryomancer** | Ice crystal staff | **Chill stacks** (5 = Freeze). Shatter frozen targets for ×2.5 damage | Control | Freezes set up allies' shatters |
| 3 | **Stormcaller** | Twin copper rods | **Charge orbs** fill from movement and dashes. Chain lightning bounces 3-6 targets, and Wet enemies double the bounces | Mobile AoE | Wet + Shock combo with Tide/Frost |
| 4 | **Arcanist** | Floating spellbook + wand | **Spell queue** in Noita/Magicka style: weave 3 runes (Force, Split, Seek, Echo) into custom shots | Flexible DPS | "Echo" rune copies an ally's last spell at 50% |
| 5 | **Necromancer** | Skull lantern + bone wand | **Corpses as resource**: raise up to 4 thralls or consume corpses for a bone shield or a corpse explosion | Summoner | Uses corpses made by allies' kills |
| 6 | **Blood Mage** | Ritual dagger + bare hand | **Casts cost HP, not mana.** Lifesteal on hit. Under 35% HP = Frenzy (+40% damage) | Risk/reward DPS | Can transfuse HP to allies |
| 7 | **Chronomancer** | Hourglass orb | **Rewind** (return to position and HP from 3 s ago). Haste/slow fields that speed allies' cooldowns | Support/utility | Time-slow bubble for the whole team |
| 8 | **Shadow Warlock** | Tattooed hand + whispering tome | **Hexes / curses**: marks amplify all damage taken by +15-30%. Blink-steps through shadows (stronger in darkness) | Debuffer/assassin | Hexes boost team damage |
| 9 | **Lightbinder (Cleric-Mage)** | Brass lantern staff | **Light radius as power**: carries the strongest light. Allies in its radius regen. Undead in light take extra damage, and it can *banish darkness* | Healer/support | Light reveals stealthed enemies, and buffs allies |
| 10 | **Geomancer / Runesmith** | Stone gauntlet + chisel | **Places runes and walls**: earth walls (cover, blockers), rune turrets, and spikes. Slow, heavy, high poise | Tank/zone | Walls block projectiles for the team |
| 11 | **Druid / Thornweaver** | Living wood staff | **Shapeshift** between Caster form (vines, poison) and Bear form (melee, tanky) on a 1 s swap CD | Hybrid tank | Roots hold enemies for allies |
| 12 | **Spellblade / Battlemage** | Rune sword + off-hand focus | **Melee builds charge** that's spent on empowered spells. Parry window 150-200 ms reflects projectiles | Melee caster | Parry-reflect protects the backline |

Bonus or later classes: Tidecaller (water, Wet, pull), Illusionist (decoys, clones), Alchemist (thrown flasks, combos), Beastmaster (familiar companion).

**Making classes feel unique** [craft]:
- A different viewmodel per class, plus a distinct cast animation and sound palette.
- Different **resources** (Heat, Corpses, HP, Charge, Light radius) so each class plays a different mini-game.
- A unique **movement ability** (blink, ice slide, lightning dash, shadow step, root-teleport).
- Each class has a 3-spell kit + mobility + ultimate. The boon pool is shared by element school, so a Pyromancer taking Frost boons creates hybrids.
- Every class can solo the run, but each has one clear weakness (e.g. Necro is weak with no corpses, Blood Mage is fragile).

---

## 6. Enemy and Boss Design by Biome

**Roster rule:** each biome has ~5-7 regular enemy types. Every combat role must be covered:
- **Fodder** (swarm), **Melee bruiser**, **Ranged**, **Caster/support**, **Disabler**, **Heavy** (poise, weak point).
- Plus **1 elite variant** and **1 miniboss**. Mix 3-4 roles per wave.
- Doom Eternal arenas often field 7+ types with distinct behaviors [S33]. Aim for 3-5 types per room.

### 6.1 Sewer (biome 1: teach basics)
- **Enemies**
  - **Sewer Rats** (swarm, 1-hit, come in packs of 6-10).
  - **Drowned Ghoul** (melee bruiser, lunges out of water).
  - **Bilespitter** (ranged, arcing acid lobs that leave poison puddles).
  - **Fungal Shambler** (dies into a spore cloud, which teaches you to keep distance).
  - **Rat Shaman** (heals and buffs rats; a priority target).
  - **Sludge Slime** (splits ×2 on death, and fire stops the split).
- **Elite:** Plague Rat Ogre (charging bruiser, poison trail).
- **Miniboss:** **The Rat King** (a tangled mass of rats; spawns swarms and burrows).
- **Boss: Mother of Filth (giant slime/leech queen)**
  - **P1:** water-surge sweeps across the room (telegraphed by a rising water line).
  - **P2:** submerges, and attacks rise from grates (bubbling decals 1 s ahead).
  - **P3:** swallows a player. Allies free them by hitting the glowing gut weak point (a co-op mechanic).
  - **Teaches:** dodge and positioning.

### 6.2 Dungeon / Prison (biome 2: crowd control, elites start)
- **Enemies**
  - **Skeleton Prisoner** (fodder, reassembles unless finished with blunt or holy damage).
  - **Jailer** (shield bearer; frontal block, so you flank or break the shield).
  - **Skeleton Crossbowman** (ranged, hitscan with a 0.8 s red laser telegraph).
  - **Torturer** (heavy with a chain hook that pulls a player into melee).
  - **Wraith** (phases through walls; only damageable when it materializes, and light reveals it).
  - **Imprisoned Mage** (enemy caster that copies your element, so it resists the last element used).
- **Elite:** Iron Maiden Golem.
- **Miniboss:** **The Warden** (keys on belt; summons guards, rings the alarm bell).
- **Boss: The Executioner**
  - A giant headsman with a greataxe and a gibbet cage.
  - **P1:** heavy telegraphed overheads (1.0 s windup) and guillotine trap blades from the ceiling.
  - **P2:** chains players to posts. An ally must break the chain or the target takes the beheading strike.
  - **P3:** frenzy that adds a fire-brand AoE.

### 6.3 Castle Courtyard (biome 3: open space, verticality, ranged pressure)
- **Enemies**
  - **Fallen Men-at-Arms** (undead soldiers in formations, with shield walls).
  - **Archers on ramparts** (volley arcs, ground decals 1.2 s ahead).
  - **Gargoyles** (flying divers; stone form is invulnerable, so hit them in flight).
  - **Hounds** (fast flankers in packs).
  - **Battle Priest** (shields allies with a holy barrier; dispel it with Arcane).
  - **Siege Ogre** (heavy that throws barrels).
- **Elite:** Knight-Captain on Horseback (charges with a wide telegraph lane).
- **Miniboss:** **Trebuchet crew event** (survive bombardment while you destroy 3 siege engines).
- **Boss: The Gargoyle Sentinel / Stone Wyvern**
  - **P1:** flies around towers and dives.
  - **P2:** perches and breathes stone-curse beams (petrify slows; allies chip you free).
  - **P3:** lands, its wings are broken, and it fights in melee in a shrinking arena under a moonlit storm.

### 6.4 Keep Halls / Library (biome 4: magical, puzzle-ish, enemy casters)
- **Enemies**
  - **Animated Armor** (high poise; Shock stuns it).
  - **Flying Grimoires** (swarm; bite and cast mini-bolts).
  - **Living Portraits / Mirror Wraiths** (reflect projectiles while their eyes glow).
  - **Court Sorcerer** (teleports and casts counter-element shields).
  - **Ink Horror** (blob that blinds the screen with ink splatter).
  - **Candle Wisps** (snuff out lights, which creates darkness zones).
- **Elite:** Archivist Lich (spell-steals your boon effect for 10 s).
- **Miniboss:** **The Librarian** (a puzzle duel: hit the correct elemental book to break the shield).
- **Boss: The Court Archmage**
  - A mirror-match wizard who uses scaled-up versions of the players' own class kits.
  - **P1:** element rotation (each element telegraphed by its staff color).
  - **P2:** splits into 3 illusions, and only the one casting a shadow is real (a lighting-based tell).
  - **P3:** the library collapses into floating platforms.

### 6.5 Throne Room (final boss)
- **Gauntlet before the boss:** Royal Guard elites (paired, synergized), a Corrupted Herald, and a final rest/shop.
- **Final Boss: The Hollow King (lich-king on the throne) with multiple phases**
  - **P1 (100-66%), "Court":** stays seated and commands spectral guards. He uses ranged crown beams and his throne shield must be broken by elemental pylons (team splits up).
  - **P2 (66-33%), "Crown":** rises and fights in melee with a greatsword.
    - Wide red sweeps with a 1.0 s windup, plus purple unblockable plunges that leave dark pools.
    - The light dims to the boss's glow and the torches go out.
  - **P3 (33-0%), "Eclipse":** the arena turns into void and the floor tiles fall away.
    - He drains light from the players' lanterns. Players must light braziers (Lightbinder or fire spells excel) to keep him damageable.
    - At 10% HP, a desperation ultimate with a 4 s cast forces a team Convergence or full dodge.
- **Boss design rules:**
  - Each phase adds one mechanic. At least one mechanic per boss needs co-op (or has a solo fallback).
  - Lighting change on each phase. Arena hazards are telegraphed by color and audio.
  - Give enrage timers only to optional heat levels.

---

## 7. Sources
- S1 Unreal Lumen docs: https://dev.epicgames.com/documentation/en-us/unreal-engine/lumen-global-illumination-and-reflections-in-unreal-engine
- S2 Dark and Darker Steam hub and discussions (light and Illuminated mechanics, "too dark" thread): https://steamcommunity.com/app/2016590 , https://steamcommunity.com/app/2016590/discussions/0/678483003218871766/ ; PC Gamer: https://www.pcgamer.com/dark-and-darker/
- S3 Dark fantasy look-dev brief (UE5): https://www.upwork.com/freelance-jobs/apply/Unreal-Engine-Technical-Artist-Dark-Fantasy-Look-Development_~022082662389584348376/
- S4 pmndrs postprocessing (merged effect passes): https://github.com/pmndrs/postprocessing
- S5 three.js post-processing manual: https://threejs.org/manual/en/post-processing
- S6 three-good-godrays: https://cdn.jsdelivr.net/npm/three-good-godrays@0.12.0/README.md ; GodraysNode: https://threejs.org/docs/pages/GodraysNode.html
- S7 three.js forum, multicolor/particle fog: https://discourse.threejs.org/t/multicolor-fog-or-fog-affected-by-light-color/26912
- S8 Hades Chambers: https://hades.fandom.com/wiki/Chambers_and_Encounters ; https://www.gamepressure.com/hades/elysium/z4d9c4
- S9 Hades II boons and rarity: https://hades.fandom.com/wiki/Boons/Hades_II ; https://rogueranker.com/hades-2-boons/
- S10 Hades duo boons: https://rogueranker.com/hades-2-duo-boons/
- S11 Pom levels guide: https://steamcommunity.com/sharedfiles/filedetails/?id=2658113414
- S12 RoR2 item stacking: https://riskofrain2.wiki.gg/wiki/Item_Stacking
- S13 RoR2 difficulty and level: https://riskofrain2.fandom.com/wiki/Difficulty ; https://riskofrain2.wiki.gg/wiki/Level
- S14 Gungeon chests and mini-reward rooms: https://enterthegungeon.wiki.gg/wiki/Chest ; https://enterthegungeon.wiki.gg/wiki/Mini-Reward_Rooms
- S15 Wizard of Legend arcana: https://wizardoflegend.gamepedia.com/Arcana?oldid=4745 ; https://en.wikipedia.org/wiki/Wizard_of_Legend
- S16 Spice Rack relic: https://wizardoflegend.fandom.com/wiki/Spice_Rack
- S17 Magicka: https://en.wikipedia.org/wiki/Magicka ; https://www.gameskinny.com/tips/complete-magicka-2-master-spell-combination-guide/
- S18 Noita wand mechanics: https://noita.wiki.gg/wiki/Guide:_Wand_Mechanics ; https://www.gamespot.com/reviews/noita-review/1900-6417589/
- S19 Spellbreak gauntlets: https://spellbreak.gamepedia.com/File:Legendary_Wind_Gauntlet.png
- S20 Mage Arena: https://en.wikipedia.org/wiki/Mage_Arena ; https://www.notebookcheck.net/Shout-spells-into-your-mic-to-defeat-opponents-in-this-new-2-99-PvP-Steam-game-with-92-positive-rating-from-2-600-reviews-in-only-5-days.1071875.0.html
- S21 Ravenswatch co-op scaling thread: https://steamcommunity.com/app/2071280/discussions/0/575995078023065507/
- S22 L4D AI Director: https://en.wikipedia.org/wiki/Left_4_Dead ; https://shacknews.com/article/82787/how-evolve-assures-action-peaks-and-valleys
- S23 Telegraph shape language: https://gamineai.com/blog/enemy-telegraph-shape-language-top-down-boss-fights-fast-visual-consistency-audit-2026
- S24 Boss telegraph principles: https://choostgames.com/blog/what-makes-a-good-boss-fight/ ; https://bugnet.io/blog/how-to-design-a-boss-that-teaches-its-own-pattern
- S25 Game feel (hit-stop 50-100 ms, trauma shake, 5-8 cues/100 ms): https://www.wayline.io/learn/game-feel/1 ; https://skills.sh/gamedev-skills/awesome-gamedev-agent-skills/game-feel
- S26 "Juice it or lose it" summary: https://rpgplayground.com/?p=3339
- S27 "Art of Screenshake" recreation: https://dkliao.itch.io/the-art-of-screenshake-recreation/devlog
- S28 Vermintide 2 stagger and hit mass patch notes: https://www.belloflostsouls.net/?p=338360
- S29 Doom Eternal resource loop: https://gamedeveloper.com/design/the-aggressive-resource-management-of-i-doom-eternal-i- ; https://gdconf.com/news/see-doom-devs-break-push-forward-combat-design-gdc-2018
- S30 Gunfire Reborn co-op review: https://www.co-optimus.com/review/2458/gunfire-reborn-co-op-review.html
- S31 RoR2 co-op loot thread: https://steamcommunity.com/app/632360/discussions/0/2141966124582714590
- S32 Apex ping UX: https://uxdesign.cc/apex-legends-ping-system-gaming-ux-done-right-4661cd94954c ; https://www.pcgamer.com/au/apex-legends-ping-system-is-a-tiny-miracle-for-fps-teamwork-and-communication/
- S33 Design of Doom Eternal: https://blog.adamatomic.com/post/613311014289768448/design-of-doom-eternal
