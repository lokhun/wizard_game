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
- **Boss health** is tuned per boss in `BOSS_DEFS` (5,760 / 9,360 / 13,680 / 17,640 / 27,000) and does not get the floor multiplier.
- **Enemy damage per floor:** ×1 / 1.25 / 1.55 / 1.85 / 2.2.
- **Party size:**
  - Enemy count grows by +50% per extra player.
  - Trash health grows by only +32% per extra player, because the research flagged health sponges as a common complaint.
  - Boss health grows by +45% per extra player.

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
