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
- **After a combat room is cleared:**
  - A tome pedestal appears. Each player takes 1 of 3 Arcane Tomes; rarity scales the numbers ×1 / 1.3 / 1.6 / 2.0, and players get 1 reroll per floor.
  - Shared gold drops.
  - Every living player recovers 15% health (a breath of respite), and health orbs pull in from 5 m.
- **After a boss falls:** the party gets a heal, a tome pedestal with better odds, and a portal to the next realm.
- **Pacing:** a bot with perfect aim (that never dodges) clears rooms in 10–25 s and bosses in about 40–80 s. Human players should land at roughly 30–60 s per room and 2–4 min per boss.

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
- **The environment:**
  - Sewer and throne rooms have mid-room pillars or statues to break line of sight.
  - Shots fly over low clutter.
  - Water slows and makes you Wet, which conducts lightning.
  - **Powder kegs** (about 1 in 5 barrels) explode when broken, chain into each other and hurt anyone close.
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
  - Spells are replicated as cast events and replayed for visuals with the same code path.

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
- **Particles:** a GPU particle system where motion is evaluated in the vertex shader (2 layers, 32k particles). It drives flames, sparks, smoke, runes, snow and blood.
