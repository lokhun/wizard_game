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
- **Feats** (50) listen to the run tracker, which digests the game's event bus (`game.events`: hit, kill, hurt, roomLock, roomClear, bossDown, floor, tome, relic, end...). Combat code only emits; nothing in it knows about feats. God-mode runs record nothing.
- **Pacts of Ascension** unlock after the first win. Each pact sets one knob on `game.difficulty` (enemy health/damage/speed/count, champion rate and affixes, room-clear healing, shop prices, boss phase thresholds, rerolls, health orbs, omens per floor, tome choices, dash recharge, how early the next wave comes, slain foes bursting, champions with two affixes); enemy definitions are never touched. The host's pacts travel in the `start` message. Highest heat cleared is kept per wizard. Max heat is 35.
  - **Seals:** the later pacts are locked until you have won at some heat (any wizard): Ill Omens, Narrow Path, Leaden Steps, Old Wounds (regeneration, lifesteal and kill-heals stop at 75% / 50% health) and Tight Deadline at 3, Relentless and Volatile Dead at 6, Exalted at 10. The board shows each seal and the next one to break.
  - **Heat pays:** every point of heat makes finer tomes 6% likelier (the weights above Common scale, `rollRarity(rng, min, luck)`) and gold drops 5% richer, so a hot run is harder but builds faster. The board spells out the current rewards.
  - Volatile Dead is a host hazard (`broadcastHazard`) dropped where a foe dies: it hits players and allies alike, so summoners have to mind it too. Exalted (and the Abyss from depth 2) give champions a second affix (`affix2`, checked through `hasAffix`), which travels with the spawn and `champ` messages.
- **Nightmare** is the hard mode: open from the first run (a toggle on the class select, kept with the pacts as the hidden `nightmare` pact, so it travels to the party the same way) and worth 10 heat. It changes how foes fight, not only their numbers, and never shortens a telegraph:
  - foes have +30% health and +25% damage; they come round to their attacks 20% sooner (`aiCd`) and recover 30% faster (`aiRecover`); one more archer may draw on you at once (`fireTokens`) and one more melee foe may press you (`meleeSlots`);
  - a melee or lunge blow chains into a second 30% of the time (elites 51%), wind-up and tell included (`combo`; it rolls on every strike and is kept on `a._combo`, since the recover state drops `a.attack`); archers loose a follow-up shot 0.3 s later aimed afresh (`doubleTap`); casters drop one more circle (`extraCircle`);
  - bosses cycle their moves 20% faster (`bossCd`) and, from 4 s in, loose **dread rings** every 8 / 6.5 / 5.2 / 4.5 s by phase: a red halo tell, then two staggered rings of slow bolts at chest height whose gaps you weave through (`BossBrain._dread`, `bossFx('dread')`);
  - each boss has a **signature move** found only in Nightmare (`SCRIPTS.<boss>.nightmare`, joining the move pool from its `minPhase`, announced by a banner the first time): the Mother's **Bile Lattice** (two crossing sets of lanes), the Executioner's **Headsman's Frenzy** (three chops, each aimed afresh), Gravemaw's **Avalanche** (rows of boulders sweeping the arena, each with one wandering gap), Veyrin's **Rune Prison** (a ring of runes around each wizard with one gap, then the centre detonates) and the Hollow King's **Crown of Swords** (three turning stars of blade-lines, from the throne on). `scripts/nightmare-bosses.js` runs each one;
  - half the room-clear healing and 30% fewer health orbs.
  - It pays back skill: a chamber cleared without taking damage grants a **Dread Mark** (+5% damage, up to 12; a flawless boss grants two), judged per wizard on each machine from the `roomLock` / `hurt` / room-clear events and shown beside the gold. No tome comes Common (`minRarity`), every boss leaves a relic beside its tome (`bossRelic`), and the 10 heat brings its finer tomes and richer gold. Nightmare victories are kept per wizard and overall, the summary wears a Nightmare badge with the marks earned, and six feats form their own group.
  - Measured with `scripts/pressure.js` (a bot that never dodges): about 1.6-2x the damage per room of a normal run at the third realm and about 3x at the fifth; most of the extra is dodgeable.
- **Damnation** is Nightmare's second rank (the toggle cycles off, Nightmare, Damnation; `nightmare: 2`, 20 heat): the top of the ladder. On top of Nightmare: foes x1.6 health and x1.45 damage (Nightmare x1.3 / x1.25), 10% faster, 15% more of them; attacks come round sooner still (`aiCd` 0.72, `aiRecover` 0.55), two more archers and two more melee foes may press you, melee chains 40% of the time; champions twice as common, every elite with two affixes; bosses enter later phases 15% sooner, cycle moves faster (`bossCd` 0.68) and loose dread rings 1.35x as often; a quarter of the usual chamber-clear healing, half the health orbs, and no solo second wind (`selfRevive` 0). Measured with `scripts/pressure.js` at the third realm: ~1.9x Nightmare's damage per minute (Nightmare ~1.7x normal). Damnation victories are kept per wizard and overall; two feats.
- **Boss Rush** is a mode toggled on the class select beside Nightmare (open from the first run). Like Nightmare it is kept with the pacts, as the zero-heat `rush` entry, so it reaches the party in the `start` message, the lobby's sworn line and late joins with nothing else to send. `Game._rushFloor` runs at the end of every `loadFloor` on every peer: each chamber but the boss's is marked won (so no sentries are placed and no fight starts), the side rewards (chests, shrines, the merchant, altars, the gambler) are taken away, and the party stands whole in the antechamber (the last main chamber before the boss) before a row of lecterns: four tomes before the Mother, then three tomes and a relic before each boss after. Lecterns are nudged off pillars onto open floor. The boss's own reward and portal are unchanged, and the Abyss works the same, so a won Boss Rush can go on as an endless one. A Boss Rush keeps its own best time (`records.rushBest`) apart from the Ascent's fastest victory, and has three feats (`scripts/rush.js` walks all five).
- **The Abyss** opens past the Hollow King once you have won a run (the host's profile decides for a party). His fall then opens two portals: claim victory, or descend. Descending banks the win at once (feats, records, the class win), then the realms start again from the first on a fresh layout (`seed + depth * 7919`). From depth 1 foes start at the Throne's strength and climb on a flattened realm curve (`Director.floorHp/floorDmg`: health ×4 at the first realm to about ×9 at the fifth, +50% per further depth; damage ×2.55 rising to about ×3.9, +20% per depth); waves are 15% larger per depth, champions commoner and found from the first realm, and bosses scale with the same factor. Dying in the Abyss still counts as a victory (and a death); the summary reads how deep you got, and the profile keeps the deepest depth per wizard and overall. Each descent also binds an **Abyssal curse**: one more rank of a random pact that still has room (weighted by its heat), applied by rebuilding `game.difficulty` with it, announced in a toast once the realm banner has passed; its heat counts toward the heat's tome luck and gold like any other. Messages: `bossdead.ab` (portals or straight victory), `abyss {d, c}` (host to all; `c` is the curse's pact id), `descend` and `claimVictory` (client asks the host).
- **The Daily Rite** derives seed, wizard and pacts (heat 3-5) from the UTC date, so everyone gets the same rite with nothing to fetch. It records a best result and a streak of consecutive days.

## Hitboxes and walls
- **What spells hit** is a capsule fitted to each model type, apart from the body radius that walls, doors and crowding use (`hitShapeOf` in actors.js, measured once per model from its bounds): radius `hitR` around a segment of half-length `hitL` along the facing, from `hitY0` to `hitH`. Long bodies (hounds, rats, the wyvern) get length, bosses get their real size and their heads (the Executioner and the Hollow King stood taller than their old cylinders, so head shots missed), upright bodies are kept close so held weapons don't count. Projectiles, aim rays, blasts, `inRadius` and `inCone` all use it (`hitPoint` gives the nearest point of the segment).
- **Walls stop blows.** An enemy swing, cone, blast circle, charge lane or shockwave reaches a wizard (or an allied summon) only with a clear line from where it comes (`Game._hazardReaches`; a lane also needs a clear run from its start). One raycast per blow that would otherwise land.
- **Walls stop spells too.** An area (a blast, a zone, a nova, a rift) reaches only what it can see from just above its centre (`SpellRuntime._seeFrom` / `_sees`, used by `inRadius` and `damageArea`; a centre in the stone looks from the nearest open point within a metre). A chain's next link and a seeker's quarry must be in sight (`nearest`). Random drops round an aim point (Meteor Storm's meteors, Call of the Deep's stray tentacles) land only where the aim point can see. Before, `scripts/walls.js` (each class casting every slot at a foe pinned behind 6 m of wall) found Transfusion, Void Rift and eleven of thirteen ultimates hitting through it; now every class is clean.

## Gold and the merchant
- Gold should be a choice, not a shopping list. Every purchase marks the rest of that merchant's wares up by 25%, compounding (`SHOP_MARKUP`, `priceShop`), and prices climb faster by realm. **Refine a Tome** is always on offer while you hold a tome below Legendary: three of your tomes, each shown a rarity finer, raise the one you choose; it can be bought again at x1.6 each time, so spare gold still has a use. A refine you walk away from is refunded and doesn't count toward the markup.
- Kill gold is (gold x elite x4) x (1 + 0.2 x realm) x 0.85. Measured with the playthrough bot (main path only, buying nothing): ~980 gold by the fourth merchant, whose stock would cost ~3,000 to buy out (it was ~1,060 against a 945 shop).
- **Co-op pays each wizard what solo does.** Every wizard collects every coin, but a party meets more foes: over the planned waves of all five realms, kill gold ran 1.41x solo for two wizards and 2.30x for four (under `countScale`, held down by the wave cap and squad shapes). Each kill's gold, and its chance of an item, is multiplied by `Director.partyShare()` = 1 / (1 + 0.43 a wizard past the first), rounded at random so cheap foes still pay on average: planned kill gold per wizard is now 1,724 solo, 1,701 for two and 1,731 for four. Carnage streaks pay gold once per tier per streak; past 12 kills the callouts go on for ultimate only (in a four-wizard room, streak gold had run 3.5x solo). Before: a four-wizard party earned ~1.9x a solo wizard's gold each, with a lone bot that couldn't clear every wave (so more in real play).
  - Checked over a real link (two browsers over PeerJS, the co-op bot, realms 1-2): each wizard gathered 1,136 in coins (kills and chambers, the same copies on both machines) plus 227 and 432 in streaks, 1,363 and 1,568 in all, against 1,409 and 1,499 for a solo wizard on two seeds, while the party fought ~1.5x the foes.

## Class balance (base kits)
Each class with no tomes, in the second realm, fights 1 durable ghoul and then a pack of 6 for 25 s, a bot using the whole kit (ultimate once; melee closes in, casters keep 5 m); damage is read off the foes' health, so summons count. Damage per second, single / pack: Blood Mage 127 / 242 (its Blood Pact was free here: the test refills health), Necromancer 121 / 371, Cryomancer 113 / 136, Spellblade 105 / 356 (in melee reach), Pyromancer 94-102 / 234-251, Stormcaller 90 / 342, Warlock 82 / 220, Druid 82 / 249, Geomancer 76 / 195, Arcanist 75 / 159, Lightbinder 74 / 183, Chronomancer 72 / 188, Tempest 60 / 176 (72 airborne, its passive: the bot never jumps). The runs vary ~10%. The Tempest was last everywhere at 49 / 162: Wind Blade went 13 to 16, Gale 16 to 22 (its crowd control untouched).

## Ultimate charge
- The ultimate charges from a slow trickle (0.4/s) and from damage dealt (0.055 per point, divided by `Director.earnScale(target)`: the realm's health scale, so late realms' bigger numbers don't charge it faster, and in a party each wizard's share of the fight's extra bodies and health, ~1.15x for four; bosses aside, which a party already splits). Lifesteal counts damage the same way. Damage's charge is banked (`_ultPend`) and paid out no faster than one full ultimate per `ULT_FLOOR` (20 s). `ultRate` bonuses scale both, with diminishing returns (`ultRateEff`: +100% is x1.63, +200% x2.0). Measured with the playthrough bot: ~20 s between ultimates in every realm (it was 21 s in the first and 0.8 s in the last), ~12 s with three Rare Ascendant Wills.

## Sustain
- Lifesteal and on-kill healing share one budget: at most 3% of max health a second (`SUSTAIN_CAP`, banked up to one second's worth; the Blood Mage's passive doubles it, `sustainMult`), and lifesteal counts damage relative to the realm's toughness (divided by `Director.floorHp()`). Regen runs at 35% within 4 s of being hit, so it mends between fights rather than tanking them.
- The sustain tomes are offered half as often (`rare: 0.5` in the tome weights) and stack less: Vampiric Codex 2% a rank (2 ranks), Soul Feast 2 a kill (2 ranks), Troll Blood 0.6/s (3 ranks). Measured: a stacked Legendary sustain build healed a 100-health wizard from 1 to full in under a second of fighting at the Hollow Throne; now ~4.6/s.
- **Troll Blood mends a fight, not the wait after it.** Regeneration works while a chamber is sealed, for 6 s after it opens, and for 6 s after any hit; it stops between chambers. A wizard could stand by the door until a stacked Troll Blood had them full before every room, which made it a full heal per chamber rather than a fighting heal (the weakness players reported was never in combat).
- **Tight Deadline** (pact, 1 heat a rank, 3 ranks, sealed until 3 heat): each realm has to be crossed to its guardian within 9 / 7 / 5 minutes, like Hades' pact of the same name. A clock under the objective counts down (orange and pulsing in its last minute). Past it the wizard withers, losing 1% of max health a second (armour, shields and dashes don't stop it, and it doesn't shake the camera or flinch), until the guardian's door shuts, which stops the clock. Each peer keeps its own clock; the floors start together. Not in Boss Rush.

## Perfect dodge
- A blow (anything with a source position: hazards, projectiles, swings; not pools or damage over time) that lands while a dash's invulnerability is up is a perfect dodge (`Player._perfectDodge`): +25% damage for 3 s (a buff), +6 ultimate, a gold float and a crit sound, and in solo a 0.4 s slow motion (never in co-op, where the world's clock is shared). At most once a second. The tracker counts them for the Matador feat (25 in a run).

## Skill over luck
A fight should be won by reading, aiming and timing, and a better player should see it in the numbers.
- **No dice on defence.** The Blur tome used to give a flat chance to ignore a blow (a coin flip that decided fights). It now lengthens the dash's invulnerability (+0.07 s a rank, `dashIv`) and the perfect-dodge buff (+1.5 s, `pdDur`): it rewards dodging well instead of replacing it.
- **Dash-jump.** Jumping during a dash, or within 0.12 s of its end, carries 55% of the dash's speed into the leap (`DASH_CARRY`; a mid-dash jump lets the dash run its course first, `dashJump`). Air control then bleeds it off and the landing slides a little. Holding forward: a dash covers 12.6 m in 1.4 s, a dash-jump 17-18.6 m, a dash and a late jump 13.4 m. It costs nothing but the timing: crossing a gap, escaping a pincer, closing on a fleeing Hoarder.
- **Weak points.** A direct hit from an aimed shot (a projectile or the first target of Chain Lightning) on the head of an upright body, or the front of a long one (wolves, spiders, the Gravemaw), deals +35% (`isWeak`, `WEAK_MULT` in `spells.js`). The head is found from the model's head bone at the moment of the hit, from its base to about a quarter of its height above it (at least 0.3 m: a raised axe or a banner above it is not the head), so it follows a stoop or a lunge (a body with no head bone, a slime or a grimoire, uses the top quarter of its capsule). The top quarter of the capsule used to stand in for it: an Animated Armor's chest counted as its head, a hunched ghoul's head barely did. **The crosshair turns gold over a weak point** (`Game._aimOnWeak`: an allocation-free probe, `SpellRuntime.firstActor`, 20 times a second), so aim is something you can see and practise. It shows as a gold damage number and a gold ringed hitmarker with its own tick. Area damage and damage over time never roll it, so it rewards aim, not a build.
- **Interrupts.** Staggering or slaying a foe while it winds up a blow cancels the blow (its pending hazard and its arc vanish) and pays: +5% ultimate and an "INTERRUPT" float (`game.creditInterrupt`, sent to the client who landed it as `intr`). Bosses are exempt (their wind-ups are their moves; they get Exposed windows instead).
- **Footing scales with the foe.** A foe staggers once it takes more than its poise within 2 s, and poise is scaled by the foe's own health scaling (realm, Abyss, party, pacts; an elite's triple health counts half), so a stagger costs the same share of its health everywhere. It used to stay at the first realm's numbers: in the fifth realm a ghoul staggered in 2 hits of a tenth of its health instead of 4, an elite on every such hit, and in the Abyss nearly everything was stunlocked (and every interrupt free).
- **Fair homing.** An enemy shot homes only on the wizard it was loosed at (`homeOn`; a shot at a teammate never swerves onto you), only while they are within a 60° cone ahead of it (so a boss's fanned orbs still curve in), never in its last 5 m and only for its first 1.6 s. A sidestep at the right moment always beats it; before, a late dodge was caught by the turn.
- **Mastery on the run summary.** Perfect dodges, interrupts, the share of aimed hits that struck a weak point (from 20 aimed hits) and flawless chambers, each beside your personal best (`records.mostDodges`, `mostInterrupts`, `bestWeakPct`, `mostFlawless`), with the record ribbon when you beat it. Feats: Spellbreaker (20 interrupts in a run) and Deadeye (150 weak-point hits).
- **Damage by source.** The summary shows where your damage came from: a bar per spell, plus burns and poisons, reactions, items and the rest (relics). The spell runtime knows which slot's code is running (`SpellRuntime.slot`, set by the caster around a cast or a channel); every projectile, zone and timer made meanwhile keeps it and restores it around its own callbacks, so a burning field's tick seconds later is still the Fireball's (`Player.dmgBy`, one field write per callback). In co-op each wizard's column names their top source.

## Scaling
- **The arc:** the first realm is hard and a wizard feels weak; the build comes online through the middle realms and rooms start to fall fast; bosses stay a real fight throughout (the last most of all); in the Abyss the foes slowly out-grow any build, so no run goes forever. `scripts/curve.js` measures it: a bot plays the whole run and three Abyss depths in `__sim` time and reports seconds per room, damage taken and damage dealt per realm.
- **Enemy health per floor:** ×1 / 1.35 / 1.7 / 2.1 / 2.5, for regular and elite enemies only. It grows slower than a build does, so trash rooms fall faster as the run goes on.
- **Boss health** is tuned per boss in `BOSS_DEFS` (5,760 / 9,360 / 24,500 / 27,600 / 48,600) and does not get the floor multiplier: bosses keep pace with the expected build (measured with the bot: about 30-60 s for the first two, 55-85 s for the rest, longer for real aim).
- **Bosses can't be out-scaled past their fight:** no single blow takes more than a tenth of a boss, and a phase threshold holds (damage past it is lost, and the boss is untouchable for 1.5 s as it changes).
- **Each boss has its own gate.** A held threshold only pauses a big build; a gate makes it play the fight. At one or two thresholds each boss raises a ward that turns its own way (`Boss.openGate`; the script's `gateDamage` decides what gets through, `gateUpdate` breaks it), and breaking it leaves the boss Exposed for 3.5 s. It never outlasts its timer, so a gate stalls a fight, not ends it. The Executioner keeps his old held thresholds.
  - **Mother of Filth, Brood Shield (66%):** she calls 3 slimes plus one per wizard and takes nothing until they are dead (18 s).
  - **Gravemaw, Stoneskin (60%, as it lands):** only blows from behind land (by the blow's push, or where the caster stands), burning and poison ticks never do, and it turns at 0.9 rad/s so you can get round it. A twentieth of its health from behind cracks the stone (12 s). A gold mark on the floor behind it shows where to stand.
  - **Archmage Veyrin, Warding Glyphs (33%):** three glyphs light up around the hall, each tethered to her by an arc. A wizard standing in one for 1.2 s burns it gold (stepping off drains it at half speed). All three break the ward (22 s).
  - **The Hollow King, Hollow Judgment (70% and again after the Eclipse):** nothing crosses his ward, and it cracks only when a wizard perfect-dodges one of his blows. Three cracks shatter it (20 s). A client's perfect dodge goes to the host as `pdodge`.
  - The boss takes the gate's colour, the bar dims and rings in it, and a line under the bar names the gate, says what it still needs and runs its timer down. A turned blow says why over the boss. The bar's phase notches now sit at the boss's real thresholds (they were always at 33%/66%).
- **The Abyss counts the realms on** (realm 5·depth + floor) and each one makes foes ×1.45 tougher and ×1.14 deadlier than the last (`ABYSS_HP`, `ABYSS_DMG`), bosses included. A build's power grows about ×1.35 a realm there, so the first descent still feels mighty, the second is a hard fight, and by the third a realm-five boss takes four minutes and five full health bars.
- **Diminishing returns on stacking one tome:** each copy already held makes the next weaker (`tomeDR`: the 4th is worth 85%, the 11th 63%). Barely felt while a build comes together; it keeps a lucky build from keeping pace with the depths forever. The tome card shows the reduced strength.
- **Each Abyss depth adds a law for good** (`ABYSS_LAWS` in `pacts.js`): bosses wield their nightmare techniques; champions bear two affixes and enemy shots fly a fifth faster; bosses loose dread rings, foes strike in combos and clears heal half as much; foes attack far more often; past that each depth quickens them again. Each depth also wears its own colours (violet, drowned teal, crimson, ashen gold), on top of its random Abyssal curse.
- **Invaders:** from depth 1 a realm's waves also draw on a later realm's roster (the next realm at depth 1, half as often; two on at depth 2, fully), so each loop meets new mixes of foes (`Director.invaders`). Their models are preloaded and prewarmed with the realm's own.
- **Enemy damage per floor:** ×1.1 / 1.4 / 1.75 / 2.1 / 2.55.
- **Heat grows through the run:** what heat and Nightmare add to foes' health and damage is not flat. Each realm carries a share of the sworn extra, ×0.6 / 0.85 / 1.1 / 1.4 / 1.7 (and the Abyss ×1.7; `HEAT_RAMP` in `director.js`). A flat multiplier hit hardest in the Sewers, before a build exists, and was outgrown by the third realm, so a high-heat run was decided in its first realm. Measured at Nightmare + 15 heat of pacts (6 bot runs each): realm-1 rooms take 3.3 → 2.6 health/min, realm-5 rooms 8.9 → 15.5 and take half as long again to clear, and the last boss fight 95 → 147 s. Unpacted runs are untouched.
  - **Health climbs harder than damage** (`HEAT_RAMP_HP`): the sworn extra health is carried ×0.6 / 1.0 / 1.5 / 2.3 / 3.1 (the Abyss ×3.1); damage keeps the ramp above. Players at Nightmare + 25 heat reported that past the Sewers nothing lived long enough to matter, bosses included. A bot drafting for damage (`scripts/curve.js &pick=greedy`) at that heat grew its damage 1 / 1.8 / 3.0 / 5.9 / 8.4× over the realms while foe health grew 4.5×, so each realm died faster than the last. Damage stays on the gentler ramp because a foe that lives longer already hits you more (realm-5 rooms already cost that bot 12-25 health a minute). Measured after (6 greedy runs, the curve bot's pinned dummy of each realm's own stock, before its guardian): one ordinary foe lasts 0.3-0.7 s under the build's single-target fire in realm 1, 0.9-2.1 s in realm 3, 2.3-4.5 s in realm 5; the Hollow King takes the bot 107-163 s.
- **Party size:** each player should face about what a solo player does. (With +50% bodies, +32% health and no extra damage per player, a 4-player party used to take ~40% less damage each than a solo player, on top of revives.)
  - Enemy count grows by +75% per extra player (the wave cap with it).
  - Trash health grows by only +28% per extra player, because the research flagged health sponges as a common complaint.
  - Enemy damage grows by +12% per extra player.
  - Boss health grows by +65% per extra player.
  - Champions: +2% chance per extra player.
  - A downed wizard bleeds out in 20 s, then 10 s, 6.7 s... for each further fall in the same chamber (25 s solo).
- **Pressure:** specials come round ~15% faster than authored. From the third realm a fourth melee foe may press one target and a third shooter may wind up on it (a fourth in the last realm). Ranged foes lead a moving target by most of their bolt's flight time. Pack hunters (flankers, the fast ones) go for a wizard with no ally within 9 m.
- **Measure a retune** with `scripts/pressure.js`: the director's real waves at a chosen party size, health refilled every frame, damage taken per minute and seconds per room. Compare builds on the same seed, at party sizes 1 and 4.

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
  - Clearing a room restores 10% health. Health orbs drop from about 10% of kills and pull in from 5 m.
  - Bosses are a test of the build and of dodging, not of attrition.
- **Feedback:**
  - Hit flinch on a damped spring, a flash, merged damage numbers and a hitmarker.
  - Bodies ride the killing blow and linger.
  - Debris matches the material: bone, metal, slime, spirit or flesh.

## Combat model
- **Statuses:** Burn, Chill (5 stacks become Freeze), Shock, Poison (stacking), Hex, Bleed, Slow, Stun, Wet (from standing in water), Root and Mark.
- **Reactions** are resolved on the attacker's machine, using the target's replicated status flags. The host then applies the numbers.
- **Enemy attacks become "hazards"** that are broadcast to every peer. Each player's own machine decides whether they were hit, so dodging is always judged on what that player actually saw.

## No softlocks
A locked room must always open. The director's watchdog (`Director._encounter`) counts progress as any foe falling or losing health: after 20 s with none, every foe the fight still counts is pulled to the party wherever it is (wedged in a wall, fallen out of the level, wandered into another room); after 65 s with none, what remains is banished and the doors open. A boss whose spawn failed is called again once. In co-op the host re-sends which room is shut and which are cleared every 2 s (`locks`), so a peer that missed a door opening never stays locked in. A wizard drawn into a fight appears just inside the door nearest them, not in the middle of the room.

## Networking
- **One build per party.** Every build has an id (`BUILD`, `src/core/version.js`, written as `version.json`); `hello` carries it and the host turns away a joiner on another build (`version`): an older joiner updates itself, a newer one is told the host should reload. An open game checks `version.json` every minute and reloads onto a new deploy in the menu.
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
  - Feet stay on the floor: each type measures its heels and toes once on the bind pose (or whichever bones a spec names as its soles, such as the Stone Wyvern's talons), and every frame the leg's local matrices are multiplied by hand (no world update, under a microsecond) to lift the body by however far a sole would sink. A heavy stance or a toe pitched down mid-stride had buried the bigger bodies' feet by up to 21 cm; now every footed enemy stays within ±4 cm, idle and walking. Lifting is fast and settling back is slow, so a body never pops down when an action ends. Death and spawn poses handle the floor themselves.
  - Turning on the spot steps: a body's own yaw rate drives its walk cycle as a slow shuffle (`turnK` in `models/core.js`, for humanoids and four-legged foes), so a foe tracking you turns on its feet instead of skating them round. A teammate's avatar does the same as they mouse-look: short side steps toward the turn.
  - Audits: `scripts/feet.js` (standing and walking) and `scripts/sink.js` (settled death poses) sample skinned vertices against the floor for every enemy type.
  - Corpses lay their weapons down: a body still gripped its halberd, staff or axe as in life, so it stood up to 1.5 m out of the corpse or ran 1.4 m into the floor. A type's `deathGrip` turns the arm through the fall (one pose per side the body can twist to) so everything the hand or forearm carries lies flat on the floor; `scripts/grip.js` searches it. Nine types use it, and none has any of its body left more than 25 cm under the floor.
  - Contact shadows (`render/contact.js`): indoors nothing cast a shadow (only the courtyard moon does), so torch-lit bodies stood on the floor without touching it. Every body and teammate gets a soft dark disc under it, sized to its radius (stretched for long bodies), from one instanced quad: one draw, with the falloff computed in the shader. A flier's disc thins as it rises, a corpse's goes as it sinks, all of them fade out by 34 m, and under the moon they are halved.
  - Wizards get a first-person viewmodel (class focus plus articulated hands) and a third-person avatar.
  - First person: every cast blooms a class-specific rune circle at the staff tip or casting hand; charging holds a smaller one. Blades leave a streaked trail, and chained Spellblade cuts alternate forehand and backhand to match the world slash. Standing still a while plays small idle fidgets (a palm-up finger flex, a staff turn, a regrip).
  - Third person (what co-op partners see): layered per-class costumes with faces, world-space cloth chains for skirts, capes, scarves and trinkets, and full idle, strafing walk, cast, downed and dead animation. Each avatar bakes into one skinned mesh per material (15–23 draw calls); so does the first-person viewmodel (about 20, from 60–100), merging only identical materials.
- **Particles:** a GPU particle system where motion is evaluated in the vertex shader (three rings, 36k particles). It drives flames, sparks, smoke, runes, snow and blood.

## Music
Every realm has its own pair of themes, one for exploring and one for its fights, and every boss has its own theme (`src/audio/themes.js`; the Abyss has its own pair too). They are generated live by the step sequencer in `music.js`, written as data for `song()`: a key and mode, sections of chords one per bar, and parts (drum patterns, chord-tone lines, melodies in scale degrees, struck chords).
- **Each realm sounds like itself.** The Drowned Sewers: E phrygian, drips and a murky choir. The Oubliette: C minor, an anvil and chains, a cello. The Moonlit Bailey: A dorian, harp and flute; its fights are a military march. The Hall of Whispers: B harmonic minor, music box and harpsichord. The Hollow Throne: F minor, organ and tolling bells. The Abyss: C# locrian, glass and heartbeats.
- **Bosses:** the Mother of Filth lurches in 6/8; the Executioner marches to the Dies irae; the Stone Wyvern's horn call rides a wall of drums; the Court Archmage plays an organ toccata; the Hollow King's anthem rises to a Neapolitan chord.
- **Places of rest have their own pieces:** the merchant's lute waltz, a shrine's choir and bells, a treasure vault's celesta and glass. They take over once you've stood in the room a second (`Game._roomMusic`).
- **Melodies vary:** a section may carry alternative lines, one picked each time it starts, so a long floor doesn't loop one tune.
- **Boss phases drive the music.** Each phase raises its intensity (`audio.setMusicIntensity`), and parts marked `min: 1` / `min: 2` join in. In the Abyss a boss's theme starts a step harder.
- `tools/music.html` plays every theme at any intensity. `node scripts/music.mjs` checks each melody's downbeats against its chords and flags augmented or diminished triads; `--render` renders every theme offline and prints its loudness. Explore themes sit near -19 dB RMS, fights near -14, bosses near -11.5.

## Carnage streaks
Kills landed within 1.6 s of each other chain into a streak (`Game._streakKill`). At 3, 5, 8 and 12 (and every 4th past that) a call pops under the crosshair (Triple Kill, Carnage, Massacre, Annihilation) and pays a sliver of ultimate charge, and a little gold (more in later realms) up to the 12th: the repeats past it pay ultimate only, so a packed room can't print gold. It rewards pulling a pack together and finishing it fast.

## Reading danger
Anything that can hurt you must be seen in time, without looking garish.
- **Banners keep out of the fight.** A banner raised while a foe is within 25 m (an encounter's twist, a curse) is drawn small and see-through in the strip at the top of the screen for 2.2 s at most (under the boss bar in a boss fight), so it never covers foes or their wind-ups; out of combat (a realm's title) it keeps its full size.
- **Danger zones** (circle, lane, cone) share one look (`TELE_FRAG` in `vfx.js`): a crisp edge of constant width (a hot core line, the zone's colour glowing just inside, a dark halo just outside, so it reads on a bright floor as on a dark one), the floor under it a little darker, and a fill sweeping out from the origin that reaches the edge as the blow lands and flashes in its last quarter. The fill is hatched with slow-drifting diagonal bands at one pitch in metres for every zone, so a zone seen from inside it reads as a mark on the floor, not a flat slab standing there (an imp's cone over the wizard looked like a solid salmon block).
- **Warnings lie on the floor they cover, at any height.** A danger zone, a shockwave's band and wall, a warning ring (a boss's dread halo) and a floor mark (a bile pool, a scorch) used to be one flat quad at a single height (a lane or cone at height 0 by default), so on raised ground (a dais, a tier, the far side of a step) they lay under the floor and could not be seen. Each is now a finely divided quad whose vertices take the floor height beneath them (`vfx.drape`, `vfx.drapeWall`; the water's surface over water): a zone runs up onto a dais with a short ramp at the step, a shockwave rides over it. A wind-up cone that follows its attacker, and a growing wave, are re-draped as they move.
- **Blasts mark the real floor.** An explosion's ground ring and scorch (or frost, slime, glyph) go on the floor under it (`vfx.floorAt`), and only when the blast reaches down that far. They used to sit half a metre under the blast, so a frost burst at head height left a blue sheet hanging in the air.
- **Shockwaves** are a glowing wall standing exactly on the hit radius, with a crest line near jump height and the band it sweeps on the ground (`vfx.waveWall`). The old ring eased ahead of the real wave and faded as it travelled; the wall stays bright all the way out and dims only as it passes over the camera.
- **Melee wind-ups** are made only at the strike, so the wind-up itself draws the arc the blow will sweep (same look, dimmer red), turning with the attacker and filling as it lands. Only blows that could reach you get one, and not fodder (rats, imps): a pack of rats would paint the floor. It vanishes at once when the swing is interrupted.
- **A charge runs its whole lane.** A lunge, charge or leap keeps its foe in the attack state until its movement is done (`leapT`): charges used to stop after 0.35 s, a third of the way down the lane they had marked, while the lane still hit at its far end.
- **Heavy leapers.** The Grim Warden, too slow to chase, leaps on a wizard who keeps 6.5-15 m away (`kind: 'leap'`): the landing ring is marked where they stood at the wind-up, and it rides the same airborne arc as the bosses (`airT/airDur/airH`, sent to clients as `eair`).
- **Lobbed shots** (bile, plague flasks) fall from above, often from out of view: the spot they'll come down on is marked as they leave the hand, filling as they fall (`spawnEnemyProjectile`). Every warning takes its colour from `game.teleColor(el)`, so the high-contrast setting covers them all.
- **Standing in a zone** about to land tints the edges of the view in its colour, pulsing faster as it nears (`uDanger` in the grade pass).
- **Hostile shots** carry a dark-cored, barbed ring in their colour, so an enemy bolt never looks like a wizard's own magic. A teammate's shots are drawn smaller and dimmer than your own. An enemy shot about to hit you from outside the view marks the screen edge it comes from.

## Items
One consumable slot, used with the item key (X), shown as a round bay at the left of the spell bar (`items.js`). Seven items, each a decision about when, not whether:
- **Fire Flask:** a lobbed flask (a flat throw lands ~9 m off; aim up to throw further) that bursts for heavy fire damage and leaves the ground burning 4 s.
- **Frost Phial:** every foe within 8 m frozen 3 s (strike them with earth, blades or physical blows to shatter for 2.5x).
- **Warding Sigil:** you and allies within 10 m shielded for 35% of your health, foes nearby thrown back.
- **Quicksilver:** hasted 8 s and every spell on cooldown 4 s sooner.
- **Storm in a Bottle:** eight lightning strikes on the foes around you over 2 s.
- **Healing Draught:** 45% health.
- **Rallying Bell:** fallen allies within 16 m rise and everyone in reach heals 25% (alone: 35% and a shield).

The **Bottomless Satchel** relic gives each use a 35% chance not to spend the item (52% at ★, 70% at ★★). Damage grows with the realm and the Abyss (`itemK`) and then with the wizard's own stats (it lands through `hitActor`). Sources: elites drop one 35% of the time (heavier foes 6%, others 1.2%), every boss leaves one, a chest holds one 45% of the time, and the merchant always has one. Like gold, a dropped item is every wizard's own (the host sends one `drop`, each peer keeps its copy); a chest's is the opener's only. Walking over an item fills an empty slot; with the slot full the interact key swaps, leaving the old one where the new one lay. Using one runs the effect on the user's machine and broadcasts `itemfx` so the party sees it.

## The Hoarder
Once a realm at most, a fifth of fights see a **Hoarder** bolt through 3-6 s in (`Director._spawnHoarder`): a fat gilded rat (the rat model at 1.55x, tinted gold, glittering and lit) that appears in the corner of the room furthest from the party and runs (`ai: 'flee'`, `Actors._flee`): away from the nearest wizard at 7.2 m/s, steering round walls, zigzagging so it is no straight shot, slower while no one is within 14 m. It leaks a coin every 1.1 s, never holds a room shut (`fightsHere`), shows as a gold dot on the minimap, and after 15 s slips away in a puff of gold (`Actors.escape`, sent as `escape`). Caught, it bursts: two fountains of gold and an item for every wizard, under a HOARD BROKEN banner (`hoard` messages call it out on every peer). A Frost Phial or any stun is the classic way to pin it.

## HUD
One visual language for everything on screen: smoky slabs, bronze rings and rules, diamonds as ornaments, a rarity or class colour as the accent (`--rc` / `--pc`). All of it is CSS and inline SVG; the per-frame HUD code writes only what changed (`setStyle` / `setText`, classes toggled on state changes), and the only running animations are transform-only (the boss bar's sheen) or on modal cards.
- **The wizard's plate:** a class medallion in a bronze ring (it pulses red below 30% health), a glassy health bar ticked every 10% with the shield as a gold band inside it, dash charges as diamonds lit in the class colour.
- **Spells:** a carved plate behind riveted bevelled frames; the cooldown sweep has a bright leading edge and a slot flashes once as its spell comes back (`.slot.ready`).
- **Boss bar:** end caps, a ruled name, phase diamonds at the thresholds, a slow sheen; it burns gold while the boss is EXPOSED.
- **Minimap:** round, rotating with the view, in a ticked bronze ring; the big map stays square.
- **Teammates:** framed rows with a class medallion; a teammate out of view gets an arrow at the screen edge in their colour (`UI._edgeMark`), larger, pulsing red and reading DOWNED when they need a revive.
- **Cards** (tomes, relics, blessings, the merchant's wares): a bronze double frame in the rarity colour, a crown gem, engraved corners, the sigil in a ringed medallion; epic and legendary gems pulse and a legendary's frame breathes gold.

## Boss fights
- **In co-op a boss is the bigger fight.** It has +125% health for every wizard past the first (`BOSS_PARTY_HP`); with each wizard dealing about a solo wizard's damage, the fight runs 1.13x the solo one for two, 1.17x for three, 1.19x for four (at +65% a party of four had it down in 74% of the solo time). Its phases, last stands and Exposed windows come at health thresholds, so they stretch with it; most of its moves already hunt every wizard (a volley or a circle each) and its adds grow with the party. When a wizard joins or leaves mid-fight the host rescales a living boss to the new party (`Director.rescaleBosses`), keeping its share of health, so the last wizard standing never faces a four-wizard boss.
Each boss has three phases of four to six moves (`SCRIPTS` in `bosses.js`), and every phase adds something that moves the fight around the arena rather than only adding projectiles:
- **The Mother of Filth:** *Belch* (a cone of bile that leaves a pool), *Flop* (she heaves into the air and lands on you, a ring of bile rolling out), *Ripple* (three rings of bile burst outward, each with a wandering gap).
- **The Executioner:** *Combo* (a chop, then the backswing a beat later), *Leap* (from across the yard, axe overhead), *Whirlwind* (he spins down a marked lane of burning steel).
- **Gravemaw:** *Wheel* (in flight it banks across the arena to a new side, dropping marked fire along its path), *Gust* (a wingbeat that throws you back), *Fault* (a line of bursts racing out toward each wizard), *Pounce* (wings broken, it still hurls itself across the arena and lands in magma).
- **Veyrin:** *Orbs* (slow seeking orbs that burst where they catch you), *Mirror Dance* (three blinks around you, a volley from each), *Starfall* (a cross of beams, then the same cross turned an eighth).
- **The Hollow King:** *Grasp* (from the throne, the floor closes under you three times), *Leap* and *Riposte* (a sweep, then the thrust as you step back), *Shadow Step* (he steps out of shadow behind you, blade already moving).

Two tools make that movement readable. `BossBrain.leap(x, z)` marks the landing ring at once, plays a crouch, springs the body along an arc (`bossFx('leap')` sets `airT/airDur/airH` on the actor, and every peer lifts the model over its ground position), and crashes down with `bossFx('land')`. `BossBrain.lane()` marks a lane the boss will tear down and sets it off in segments as the body passes, so a whirl or a slide carries its danger with it. The Executioner and the Hollow King have their own leap poses (crouch, airborne tuck), and the Executioner a whirl (axe at arm's length while `spin` turns the body).

**Last stands.** Below 12% health each boss throws its last, once, under a banner (a move with `when: hpf < 0.12`, weight 50 so it comes next, cooldown 999): the Mother's **Deluge** (three tides to jump), the Executioner's **Final Verdict** (four chops each aimed afresh, then a burning quake), Gravemaw's **Last Breath** (fire sweeping a full circle: run with it), Veyrin's **Unravelling** (six rings of bolts, each with a gap), and the Hollow King's **Judgment** (break line of sight). Each ends EXPOSED, so surviving it buys the finishing blow.

**Arena pressure.** A boss's last phase also sets off telegraphed hazards around the arena on its own clock, whatever the boss is doing (`phase.press`, every 7-9 s, at least 1.3 s of warning, named for the death recap): the Mother's bile geysers, the Executioner's gallows blades sweeping two lanes (one through each of the first two wizards), Gravemaw's magma vents beside each wizard, Veyrin's ward surge (two beams crossing the arena's middle) and the King's void rifts. The clock restarts at the phase change, so its opening leap isn't stacked with one.

**Exposed.** A committed move leaves an opening: a leap's crash, the end of a whirlwind, the Executioner's charge or Gravemaw's dive marks the boss EXPOSED for 1.2–1.6 s (+30% damage taken, applied before the per-hit cap; `BossBrain.expose`, a gold flare and call via `bossFx('exposed')`). The rhythm the fights reward is dodge, then punish.

The telegraph pool holds 64 zones. At 24, an arena-wide pattern (Avalanche, Rune Prison or Guillotines in a full party) ran it dry, and the pool stole the oldest warning still on the floor, so a zone landed with no mark.

## Relics past the last one
- **Ascension.** An owned relic can be raised to ★ and ★★: chests (and the merchant) offer it now and then, and fill every empty slot with it once few relics are left to find. Each star multiplies the relic's gift by 1.5 / 2, never its curse: only the stat changes that help are raised (Crown of Thorns' damage, not the damage it makes you take), and its procs hit harder (`RelicRuntime.pd(x, id)`). Relics whose gift is a rule (Phoenix Ash, Sands of the Last Breath, the Gambler's Die...) can't ascend.
- **Abyssal relics** turn up only past the Hollow King: six great gifts bought dearly (+60% damage and area for taking 25% more; +4% damage per tome held but no healing from kills or lifesteal; +2 projectiles for −25% damage...).
- Relic procs grow with the realm and keep growing in the Abyss (they used to fall back to the first realm's strength when the realms started again).

## Battlefields
About half the fight rooms of every realm rise or fall (`elevate` in `levelgen.js`), chosen per realm:
- **Tiers:** the room climbs in two 0.6 m steps along its long axis.
- **Pit:** a sunken bowl, two steps down.
- **Plateau:** a 1.2 m table in the middle, sheer but for a ramp on two opposite sides.

**Trap vents:** about a third of the fight rooms hold 2-4 floor grates that erupt by turns while the doors are shut (half of them every 4.5 s, after a 4 s grace): fire in most realms, bile gas in the sewers, arcane in the keep. Each burst is an ordinary telegraphed danger zone and burns foes standing in it as readily as wizards, so luring a pack across a vent is a tactic (`Director._vents`).

**The high ground pays:** a wizard standing 0.6 m or more above a foe (on a plateau, a higher tier, the rim of a pit) hits it 15% harder; a jump doesn't count, and bosses are exempt. The first time it happens a toast says so.

Fights must keep flowing. The outer two rows of a room stay at floor level (doors, clutter, torches), every rise a wizard or foe must climb is a step under `STEP` (0.75 m), and only a plateau's flanks are sheer, which can always be dropped from and walked round. A check over 60 generated floors finds every cell of every elevated room reachable on foot from its doors.
- **Enemies climb the way you do.** The flow field grows out from the target, so its step-up test is the walker's climb (`hgt[i] - hgt[ni]`, at most `STEP`): a foe may drop off any ledge but goes round by the ramps to get up one. Sight carries over a plateau's edge where feet don't, so a foe walks straight at you only when the line is also walkable (`Pathing.walkLine`); otherwise it follows the field. (Before this, foes below a plateau pressed into its cliff face.)

## Performance rules
- **Nothing outlives its floor.** A floor change frees what the floor made: its level (geometry, per-floor materials and the canvas textures the builder drew for it, tracked in `ownTex`: `material.dispose()` leaves textures alone), its chests and pedestals (each built from fresh geometry). A soak (four passes through the five realms, a fight in each) holds GPU geometries, textures, programs and heap flat from the second pass on; before, chests leaked ~100 geometries a pass and light shafts a texture or two a floor, so a long Abyss run kept piling up GPU memory.
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
- **One draw per enemy body.** Every opaque enemy surface (bone, iron, cloth, scales, magma...) is a layer of three texture arrays (the surface atlas, `buildAtlas` in `models/core.js`), so `Rig.finish` merges all of a model's opaque parts into one mesh whose vertices carry their layer (`aLayer`), instead of one mesh per material: a 33-enemy fight went from ~440 enemy draws to ~165 (the lineup of every type renders pixel-identical). Double-sided cloth is a reversed copy of its faces inside that mesh, with its tangent frame flipped as three's DoubleSide would. Glow, slime, ghost, spirit and boss fx parts keep their own meshes. A new enemy surface is a `MAT_DEFS` entry (at most 16 layers).
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
