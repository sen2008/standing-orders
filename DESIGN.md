# Standing Orders

*Working title. An async, mostly-indirect-control kingdom game for 2-4 friends, in the spirit of Majesty: you never command a worker directly — you place bounties, set policy, and build. The one exception is your Hero, who you drive around yourself. Your kingdom keeps acting on your last orders even when you're offline. A round only advances once everyone's confirmed (or a timeout forces it), so nobody loses ground and nobody gets to react faster than anyone else.*

---

## 1. Core Pillars

1. **Indirect control for the army.** No unit selection, no move commands for workers. Influence = buildings you place, bounties you post, policy you set.
2. **Direct control for the Hero.** Each kingdom has one Hero (see §6) you drive yourself — walk the overworld, delve dungeons, fight a dragon. It's the one place you're actually piloting something.
3. **Standing orders persist.** Nothing resets when you don't log in. Your bounties and policy keep running exactly as last configured.
4. **Round-gated, not clock-gated.** The world doesn't tick on a schedule. A round resolves when every player has confirmed orders (or explicitly "confirm, no changes"), or after a grace-period timeout, whichever comes first. Hero actions are the exception — see §6.
5. **Shared world, emergent competition.** One map, one set of roaming threats/dungeons. Kingdoms aren't directly at war in v1 — they compete for the same bounties and glory.

---

## 2. Round Structure

A **round** = one full simulation step for the indirect-control layer (workers, buildings, economy). Sequence:

1. Round opens. All players see current state (fog-of-war filtered) and can edit orders freely, any number of times, in any order, whenever they're online.
2. A player **confirms** when satisfied with their orders for this round (even "no changes" requires an explicit confirm, so the system knows they've seen the state).
3. Once **all players have confirmed**, OR the **round deadline** passes (default 48h, configurable per game at creation), the server resolves the round (see §9).
4. Event log + Discord notifications go out. Round counter increments. All confirm flags reset. Round N+1 opens.

If a player hasn't confirmed by the deadline, the round resolves using their **current standing orders as-is** — identical to them confirming "no changes." Nobody is penalized for being offline; they just don't get to react to anything that happened *this* round until the next one opens.

The frontend should surface, per game, whose confirm is outstanding ("waiting on: Dana") so the group can nudge each other — and so a Discord ping can target the actual holdup.

**Hero play is not part of this gate.** A player can move their Hero, explore, and run quests at any time, independent of round state — it doesn't block confirmation and isn't blocked by it. See §6.

---

## 3. World & Map

- **Size:** fixed 24x24 grid for all games, 2-4 players. Simplicity over per-player-count scaling for v1 — revisit only if 4-player games feel cramped in practice.
- Each tile has: terrain type, danger level (0-100), optional resource type, optional feature (`ruin` / `dungeon` / `monster_camp` / `dragon_lair`), a `feature_state` (`active` / `cleared`, null if no feature), and fog-of-war state per player (unseen / stale / visible).
- **Starting positions:** symmetric — opposite corners for 2 players, evenly spaced around the perimeter for 3-4. Exact placement is an implementation detail as long as capitals stay roughly equidistant from the map center. Starting visibility radius around each capital: 3 tiles.
- **Generation:** per-tile terrain/danger seeded from `map_seed` (reproducible, simple weighted-random — no need for real noise-based generation in v1). A handful of `monster_camp`/`ruin` features scattered at a minimum distance from every capital, plus **exactly one `dragon_lair`**, placed near the map center so no kingdom has a home-field advantage on the marquee quest.
- **Feature regeneration:** a `cleared` `monster_camp`/`dungeon` tile resets to `active` after a cooldown (§15), so the bounty/quest supply doesn't dry up. The `dragon_lair` is the one exception — once slain it stays `cleared` permanently, a one-time centerpiece per game.
- World features are **shared** — not owned by any kingdom. Any kingdom's workers can pursue a bounty targeting them, and any kingdom's Hero can walk up and enter them directly.

---

## 4. Kingdoms & Buildings

Each player has one **Kingdom**: a treasury, a tax rate, and a set of buildings on the map.

| Building | Spawns | Notes |
|---|---|---|
| Capital (starting) | — | Can't be destroyed; treasury, order UI, and Hero's home base |
| Guild Hall | Warriors | Melee-leaning, good vs. monsters |
| Rogues' Den | Rogues | Good at explore/stealth bounties, weaker in a fight |
| Wizard's Tower | Wizards | Slow to produce, strong vs. high-danger targets |
| Temple | Clerics | Doesn't take bounties; boosts passive HP recovery for injured workers at home (§5) |
| Market | — | No workers; increases gold income from tax |
| Walls (upgrade to Capital) | — | Reduces chance of the kingdom itself being raided by a wandering threat |

Each building: `level` (1-3), `build_progress` (rounds remaining), `worker_cap` (how many workers it can support at once). Building/upgrading costs gold and takes 1+ rounds to complete — queued as part of a player's orders for the round. Starting costs/timers: §15.

---

## 5. Workers

Workers are the autonomous agents. Never player-controlled directly.

**Fields:** `type` (Warrior/Rogue/Wizard/Cleric), `level`, `xp`, `hp`, `state` (Idle / Traveling / OnTask / Resting / Dead), `current_bounty_id`, `tile_x/y`, and three **personality traits**, rolled once at spawn (0-100 each):

- `bravery` — willingness to accept risk relative to reward
- `greed` — how much raw reward size matters vs. risk-adjusted value
- `diligence` — baseline chance of taking *any* bounty vs. staying idle/resting

Personalities are visible to the owning player (so bounty-pricing is an informed guess, not a guess in the dark) but not directly editable. A worker's effective values can be temporarily boosted if it's standing in its kingdom's Hero's aura — see §6.

Workers below max HP passively recover a small amount each round while `Idle` at their home building — faster if the kingdom has a Temple (§4). Worker death (HP <= 0) is **permanent** in v1 — see §16 for why.

---

## 6. Heroes & Direct Control

Each kingdom has **one Hero** to start (a second, later, is a stretch goal — see §14). The Hero is the exception to every rule in §5: no personality traits, no AI decision loop. When you're online, you drive it directly.

**Fields:** `name`, `class` (Warrior/Rogue/Wizard/Cleric, or a hero-only class list), `level`, `xp`, `hp`/`max_hp`, `attack`, `tile_x/y`, `state` (AtCapital / Exploring / InDungeon / Resting / Dead), `marshal_active` (bool), `current_quest_id`, `recovery_rounds_left`.

**Not round-gated.** As noted in §2, Hero actions happen live, any time, independent of round confirmation — a player should be able to open the game on a random Tuesday and go run their Hero through a dungeon without needing anyone else online or ready. The kingdom's AI economy keeps running on standing orders in parallel, oblivious to what the Hero is up to.

### Exploration
On the shared overworld, the Hero moves tile-by-tile (click-to-move or arrow-step), revealing fog of war, and can walk into resource nodes, ruins, monster camps, or a dungeon/dragon-lair entrance. This is ordinary synchronous request/response — `move` → server validates, updates position, returns any tile-triggered event — no live connection needed.

### Quests (dungeons, the dragon, side quests)
Walking onto an `active` dungeon/dragon-lair tile starts a **quest instance**: a private, step-based encounter sequence only that player sees.

v1 ships **three hand-authored quest scripts**, each just a fixed sequence of nodes (fight / trap-or-skill-check / loot / boss):

| Quest | Difficulty | Nodes |
|---|---|---|
| Goblin Warren | Easy (1) | 3 |
| Bandit Hideout | Medium (2) | 4 |
| The Dragon's Lair | Hard (3) | 5-6 |

The dragon uses the **exact same node-resolution engine** as the others — bigger numbers and a unique game-wide `dragon_slain` event, not special-cased logic. Procedural dungeon generation, to replace hand-authored scripts, is a stretch goal (§14).

Each step is one request: `POST /quest/step` with the player's chosen action (attack / use item / flee) → server resolves the node, returns the outcome plus the next node (or quest end).

**On defeat:** the Hero doesn't die. It's knocked to `Resting` at the capital for `recovery_rounds_left` rounds (formula in §15) — losing your *one* Hero permanently to a bad roll is a much harsher stakes swing than losing one of several interchangeable workers, so recovery, not permadeath, is the v1 rule (§16).

**On success:** gold to the kingdom treasury, Hero XP/level-up, maybe a unique item. Slaying the dragon is the marquee version of this — same mechanism, bigger stakes, and the only game-wide announcement event.

### Marshal / Aura
This is how the directly-controlled Hero reconnects to the indirect-controlled army, instead of being a totally separate minigame:

- The player can toggle `marshal_active` on their Hero any time it's `AtCapital` or `Exploring` (not while `InDungeon` or `Resting`).
- While active, the Hero projects an aura of radius `AURA_RADIUS` around its current tile. Any of that kingdom's workers inside the radius get, for that round's decision pass (§7), a temporary boost:
  - `effective_bravery = worker.bravery + AURA_BRAVERY_BONUS`
  - `accept_threshold *= AURA_THRESHOLD_MULTIPLIER` (much likelier to take a bounty they'd normally pass on)
  - `success_chance *= AURA_COMBAT_MULTIPLIER` (troops fight better with their Hero visibly leading)
- Practical effect: day to day, workers trickle out solo, each chasing whatever bounty looks good to them individually. When something big shows up — a dragon, a raiding party — the player can run their Hero to the front line, call Marshal, and turn that trickle into something closer to a coordinated push, without ever directly commanding a single worker.
- The Hero's position and `marshal_active` state are snapshotted at the start of round resolution (§9, step 2) so the aura check during the worker decision pass (§7) uses one consistent value for the whole round, even though the Hero can keep moving live in between rounds.

---

## 7. Bounties (the core interaction)

A bounty is how a player influences workers. Posted by a kingdom, claimable by **any** kingdom's idle worker in range (this is the emergent-competition hook — post too small a reward and a rival's braver worker may beat yours to it).

**Fields:** `type` (Explore / Kill / Gather / Guard), `target` (tile ref or monster/dungeon ref), `reward` (gold, escrowed from poster's treasury on creation), `status` (Open / Claimed / InProgress / Completed / Expired / Failed), `posted_round`, `expires_round`.

**Bounty visibility resolves the range question directly**: a worker's kingdom can see (and its idle workers can therefore consider) any bounty whose target tile is within that kingdom's explored fog-of-war — visible or stale (§3). No separate "awareness radius" stat is needed; fog of war already *is* the awareness boundary. A bounty posted deep in unexplored territory is invisible to everyone, including rivals, until someone's fog of war reaches it — and a rival that has scouted your backyard can absolutely snipe a bounty you posted there. That's the intended emergent competition (§1, pillar 5).

### Worker decision algorithm (runs during round resolution, per idle worker)

```
for each idle worker w:
    aura = hero_aura_at(w.kingdom, w.tile)   # see §6 — null if no Hero marshaled nearby
    effective_bravery = w.bravery + (aura ? AURA_BRAVERY_BONUS : 0)

    candidates = open bounties whose target tile is within w.kingdom's explored fog-of-war (§3)
    for each bounty b in candidates:
        distance_penalty = travel_time(w.tile, b.target) * DISTANCE_WEIGHT
        risk = danger_level(b.target)
        risk_discount = risk * (1 - effective_bravery / 100)
        value = b.reward * (1 + w.greed / 100) - risk_discount - distance_penalty
        score[b] = value

    best = candidate with highest score[b]
    accept_threshold = BASE_THRESHOLD * (1 - w.diligence / 100)
    if aura: accept_threshold *= AURA_THRESHOLD_MULTIPLIER

    if best exists and score[best] > accept_threshold:
        w.state = Traveling, w.current_bounty_id = best.id, best.status = Claimed
    else:
        w.state = Idle or Resting (diligence-weighted coin flip)
```

Constants (`BASE_THRESHOLD`, `DISTANCE_WEIGHT`, `AURA_*`): starting values in §15, tune via playtesting.

### Task resolution (worker already OnTask/Traveling)

```
if w.state == Traveling and this round's movement reaches target:
    w.state = OnTask
if w.state == OnTask:
    success_chance = clamp(w.power(type, level) / danger_level(target), 0.05, 0.95)
    success_chance *= morale_modifier(w.kingdom)   # see Policy, §8
    if hero_aura_at(w.kingdom, w.tile): success_chance *= AURA_COMBAT_MULTIPLIER
    roll -> success or failure
    on success:
        pay reward to w.kingdom treasury, grant XP, bounty.status = Completed
        w.state = Traveling (return home)
    on failure:
        injury_roll -> w.hp -= damage; if w.hp <= 0: w.state = Dead
        else: w.state = Traveling (retreat home), bounty stays Open (re-rollable next round)
```

`w.power(type, level)` formula: §15. Keep combat resolution to this single roll per round in v1 — no multi-round dungeon crawls for *workers* yet (stretch goal, §14; the Hero already gets a multi-step version via quests, §6).

---

## 8. Policy

Each kingdom sets, as part of its standing orders:

- **Tax rate** (0-100%): higher = more gold to treasury per round, but lowers `morale_modifier` (affects success chance and idle-worker acceptance threshold — overtaxed workers are choosier and less effective). Formula: §15.
- **Alert level** (Passive / Normal / Aggressive): Aggressive auto-generates a standing "defend capital" bounty at a reward proportional to treasury when a threat tile enters the kingdom's territory, without the player needing to notice and post it manually. Passive never does this — cheaper, riskier.

**Baseline income:** a kingdom's Capital always yields a small flat gold income each round regardless of buildings, so a game never grinds to a halt before a Market is built. Market buildings add a percentage bonus on top of that base, further modified by tax rate (§15 has starting numbers). All resources — Gather-bounty payouts included — convert straight to gold; v1 runs a **single-currency economy**. A separate resource/goods economy (ore, wood, etc. as distinct tradeable currencies) is a stretch goal, not a v1 concern.

---

## 9. Round Resolution (server-side algorithm)

Runs once when the round is gated closed (all confirmed, or deadline hit):

1. Lock the game — reject further order edits until resolution completes.
2. Snapshot each kingdom's Hero aura state (`marshal_active` + `tile_x/y`) for use throughout this pass — see §6.
3. Apply each kingdom's tax rate → treasury income; compute `morale_modifier` per kingdom.
4. Process every worker in `OnTask` or `Traveling` state (§7 task resolution) before evaluating new idle workers, so a worker that just finished isn't immediately re-evaluated in the same round.
5. Process every `Idle` worker: regen HP first if below max (§5), then run the decision algorithm (§7) — may newly claim a bounty.
6. Advance world state: move roaming threats, expire old bounties past `expires_round`, possibly spawn a new threat/dungeon (simple random chance per round), and regenerate any `cleared` monster-camp/dungeon feature tile after its cooldown (the dragon lair stays `cleared` forever once slain — §3).
7. Advance building construction; complete anything that finishes this round, unlock its worker cap.
8. Decrement `recovery_rounds_left` for any `Resting` Hero; when it hits 0, set the Hero back to `AtCapital` and fire `hero_recovered`.
9. Auto-generate Aggressive-alert defend bounties (§8) for any kingdom under threat.
10. Write event log entries for anything notification-worthy (§10).
11. Reset all `ready`/confirm flags, increment `round_number`, set new `round_deadline`, unlock the game for editing.
12. Fire Discord webhook(s): a per-game summary, plus @mentions for players with critical personal events.

This whole routine should be a single function callable from **any** request handler (not just a dedicated endpoint) so it can run lazily — e.g., triggered by the last player's confirm call, or opportunistically checked when a deadline has passed and someone hits the state endpoint. A cheap Cron Trigger (hourly) is worth adding purely as a backstop, so a round with a blown deadline resolves even if nobody happens to poll that game — see §13. Hero actions (§6) don't go through this routine at all — they resolve inline, per request, whenever they happen (recovery countdown, step 8, is the one Hero-related thing that *does* ride the round clock, since it's meant to feel like real downtime).

---

## 10. Events & Notifications

Event log entries, each optionally tied to a `player_id` (null = global/all):

| Event | Trigger | Notify |
|---|---|---|
| `worker_claimed_bounty` | §7 accept | Owner only (low priority, batched) |
| `worker_died` | HP <= 0 | Owner, immediate |
| `bounty_completed` | success roll | Owner, immediate |
| `kingdom_attacked` | threat tile enters territory | Owner, immediate |
| `building_completed` | construction finishes | Owner, batched |
| `hero_returned` | quest ends in success or retreat | Owner, immediate |
| `hero_defeated` | Hero HP <= 0 in a quest | Owner, immediate |
| `hero_recovered` | recovery_rounds_left hits 0 | Owner, batched |
| `dragon_slain` | dragon-lair quest completed | **All players**, immediate (bragging rights) |
| `round_resolved` | end of §9 | All players, summary |
| `waiting_on_you` | round open, player hasn't confirmed, N hours before deadline | That player only |

Discord delivery: one webhook URL per player (collected at game creation) is simplest and lets each friend get pinged in their own DM/channel without a shared channel's noise; a single shared-channel webhook is the fallback if that's easier to set up (and arguably better for `dragon_slain`-style bragging-rights events specifically).

---

## 11. Data Model (D1 / SQLite)

```sql
games (
  id TEXT PRIMARY KEY,
  name TEXT,
  status TEXT,            -- 'setup' | 'active' | 'ended'
  round_number INTEGER,
  round_deadline_at INTEGER,  -- unix ts
  round_timeout_hours INTEGER,
  map_seed TEXT,
  created_at INTEGER
)

players (
  id TEXT PRIMARY KEY,
  game_id TEXT,
  name TEXT,
  secret_token TEXT UNIQUE,   -- auth: possession of link = access
  discord_webhook_url TEXT,
  confirmed_this_round INTEGER  -- boolean
)

kingdoms (
  id TEXT PRIMARY KEY,
  player_id TEXT,
  treasury INTEGER,
  tax_rate INTEGER,
  alert_level TEXT
)

buildings (
  id TEXT PRIMARY KEY,
  kingdom_id TEXT,
  type TEXT,
  level INTEGER,
  tile_x INTEGER, tile_y INTEGER,
  build_progress_rounds_left INTEGER,
  status TEXT   -- 'queued' | 'building' | 'active'
)

workers (
  id TEXT PRIMARY KEY,
  kingdom_id TEXT,
  building_id TEXT,
  type TEXT,
  level INTEGER, xp INTEGER, hp INTEGER,
  bravery INTEGER, greed INTEGER, diligence INTEGER,
  state TEXT,
  current_bounty_id TEXT,
  tile_x INTEGER, tile_y INTEGER
)

bounties (
  id TEXT PRIMARY KEY,
  posted_by_kingdom_id TEXT,
  type TEXT,
  target_tile_x INTEGER, target_tile_y INTEGER,
  target_ref TEXT,        -- monster/dungeon id if applicable
  reward INTEGER,
  status TEXT,
  claimed_by_worker_id TEXT,
  posted_round INTEGER,
  expires_round INTEGER
)

heroes (
  id TEXT PRIMARY KEY,
  kingdom_id TEXT,
  name TEXT, class TEXT,
  level INTEGER, xp INTEGER, hp INTEGER, max_hp INTEGER, attack INTEGER,
  tile_x INTEGER, tile_y INTEGER,
  state TEXT,                 -- 'AtCapital' | 'Exploring' | 'InDungeon' | 'Resting' | 'Dead'
  marshal_active INTEGER,     -- boolean
  current_quest_id TEXT,
  recovery_rounds_left INTEGER
)

quests (
  id TEXT PRIMARY KEY,
  hero_id TEXT,
  type TEXT,                  -- 'dungeon' | 'dragon' | 'sidequest'
  difficulty INTEGER,         -- 1 = easy .. 3 = hard, drives recovery time on defeat
  current_node TEXT,
  status TEXT,                -- 'active' | 'completed' | 'failed'
  seed TEXT
)

tiles (
  game_id TEXT, x INTEGER, y INTEGER,
  terrain TEXT, danger_level INTEGER, resource_type TEXT,
  feature TEXT,              -- null | 'ruin' | 'dungeon' | 'monster_camp' | 'dragon_lair'
  feature_state TEXT,        -- null | 'active' | 'cleared'
  PRIMARY KEY (game_id, x, y)
)

visibility (
  game_id TEXT, player_id TEXT, x INTEGER, y INTEGER,
  state TEXT,                -- 'unseen' | 'stale' | 'visible'
  PRIMARY KEY (game_id, player_id, x, y)
)

events (
  id TEXT PRIMARY KEY,
  game_id TEXT, round_number INTEGER,
  player_id TEXT,            -- null = global
  type TEXT, message TEXT,
  created_at INTEGER
)

threats (
  id TEXT PRIMARY KEY,
  game_id TEXT, type TEXT, power INTEGER,
  tile_x INTEGER, tile_y INTEGER, state TEXT
)
```

---

## 12. API Surface (Cloudflare Worker)

- `POST /games` — create game (name, player names, round_timeout_hours) → returns per-player secret links
- `GET /games/:id/state?token=` — full fog-of-war-filtered state for the calling player: map (visible/stale/unseen tiles), own kingdom detail, other kingdoms' public-facing info (name, capital location, visible workers only), open bounties in range, event log since last-seen round, scoreboard (§16)
- `POST /games/:id/orders?token=` — upsert this round's orders: bounty create/cancel, tax rate, alert level, building queue additions
- `POST /games/:id/confirm?token=` — mark ready; triggers round resolution check (resolves immediately if this was the last player)
- `GET /games/:id/events?token=&since_round=` — event log page, for the notification feed / "what happened" view
- `POST /games/:id/heroes/:heroId/move?token=` — step the Hero on the overworld
- `POST /games/:id/heroes/:heroId/marshal?token=` — toggle aura on/off
- `POST /games/:id/heroes/:heroId/quest/start?token=` — enter the dungeon/dragon-lair tile the Hero is standing on
- `POST /games/:id/heroes/:heroId/quest/step?token=` — take one action (attack/use item/flee) in the active quest instance

All auth is possession-of-token (the secret link) — no accounts, no passwords. Fine for a friend group; don't build more than this for v1.

**Site-wide creation gate (additive, not a redesign):** `POST /games` also checks a shared passphrase (an `X-Site-Password` header against a `SITE_PASSWORD` Worker secret) before anything else, purely to stop random internet traffic from spamming game creation on a public Worker URL. It sits in front of the per-player model above, doesn't replace it, and every other route is unaffected — once a game exists, access to it is still solely the secret link.

---

## 13. Architecture & Stack

- **Frontend:** static site on GitHub Pages. Map renderer (canvas or SVG), kingdom panel (buildings, treasury, tax/alert controls), bounty placement UI (click tile → post bounty), Hero panel (move/marshal/quest controls, quest-step UI), orders review + confirm button, event feed, scoreboard.
- **Backend:** single Cloudflare Worker exposing the routes in §12, containing all game logic (order validation, round resolution algorithm, Hero move/quest resolution) — the frontend has no game logic, it only renders state and posts actions.
- **Storage:** Cloudflare D1 (schema in §11). Free tier is comfortable for this scale (a handful of games, a few players, low request volume).
- **Cron Trigger:** one scheduled Worker run (hourly is plenty) that scans `games` for `round_deadline_at < now` and `status = 'active'`, and force-resolves them. This is the *only* scheduled job — everything else, Hero actions included, is request-driven. Purely a backstop so a round doesn't hang forever if nobody happens to poll a stalled game.
- **Notifications:** Discord webhooks, called directly from the Worker at the end of round resolution (§10) and for the `waiting_on_you` nudge (checked opportunistically, e.g. from the Cron Trigger pass, or a second lighter-weight scheduled check).
- **No Durable Objects, no WebSockets needed** — even for the Hero. "Direct control" here means ordinary click → HTTP request → server resolves → response, not a live real-time connection. Round resolution is naturally serialized (it only runs from within the confirm handler or the cron backstop, both of which can use a simple D1 row-level guard to avoid double-resolving if two triggers race); Hero moves/quest-steps are independent per-player writes with no cross-player race to guard against.

---

## 14. MVP Scope

Build in this order:

1. Game creation, player links, empty map render, capital placement.
2. Orders + confirm flow, round resolution loop with **no** worker AI yet (just advance round_number, prove the gating works).
3. Buildings: queue, build progress, completion.
4. Workers: spawn from buildings, personality rolls, idle state, passive HP regen.
5. Bounties: post/cancel, worker decision algorithm, single-roll task resolution.
6. Hero: overworld movement, marshal aura (hooked into step 5's decision algorithm), the three v1 quest scripts including the dragon fight, recovery-on-defeat.
7. Fog of war + map exploration (shared by workers and Hero; also gates bounty visibility, §7).
8. Event log + Discord webhook notifications.
9. Policy: tax rate, alert level, baseline income.
10. Shared threats: simple spawn/roam/despawn, Aggressive-alert auto-bounty, feature regeneration.
11. Scoreboard (§16) — simple, but gives the group something to compare without needing a full win condition.

That's a complete, playable v1. Everything below is explicitly deferred.

### Stretch goals (not v1)
- Second Hero per kingdom
- Procedural dungeon generation (replacing hand-authored quest scripts)
- Escort mechanic — Hero recruits idle workers into a temporary party for a quest
- Direct kingdom-vs-kingdom sabotage or raiding bounties
- Multi-round dungeon crawls for *workers* (persistent task state across rounds, not single-roll)
- Spells/directives (temporary global incentive multipliers, e.g. "Call to Arms")
- Trade between kingdoms
- Separate multi-resource economy (ore/wood/etc. instead of single-currency gold)
- Formal win/end-game state (v1 is an ongoing sandbox with a scoreboard, not a game with an ending)

---

## 15. Balance Constants (starting values — tune via playtesting)

These are starting points, not gospel. The first real playtest with your friend group will tell you which of these are wrong; nothing here should block implementation.

**Round & map**
- `round_timeout_hours`: 48 (configurable 24-168 at game creation)
- Map size: 24x24
- Starting visibility radius around capital: 3 tiles
- Feature regeneration cooldown (cleared monster_camp/dungeon → active again): 6 rounds

**Worker combat & leveling**
- `power(type, level) = BASE_POWER[type] * (1 + 0.15 * level)`
- `BASE_POWER`: Warrior 20, Rogue 14, Wizard 18, Cleric 8 (Clerics don't take bounties — kept for completeness)
- Leveling: 100 XP per level (`level = floor(xp / 100) + 1`)
- `BASE_THRESHOLD`: 15
- `DISTANCE_WEIGHT`: 2 (gold value lost per tile of travel)

**Hero**
- Starting stats: level 1, hp 50, attack 12
- Leveling: same 100-XP/level curve as workers; +5 max_hp and +2 attack per level
- Recovery on defeat: `recovery_rounds_left = 2 + quest.difficulty` (so 3 / 4 / 5 rounds for Goblin Warren / Bandit Hideout / the Dragon's Lair)

**Marshal aura**
- `AURA_RADIUS`: 3 tiles
- `AURA_BRAVERY_BONUS`: +25
- `AURA_THRESHOLD_MULTIPLIER`: 0.5
- `AURA_COMBAT_MULTIPLIER`: 1.15

**Economy**
- Starting treasury: 300 gold
- Capital base income: 10 gold/round
- Market bonus: +25% of base income per Market level
- `morale_modifier = 1 - (tax_rate / 200)` (0% tax = full effectiveness, 100% tax halves it)

**Buildings** (level-1 cost/time/cap; upgrade cost roughly doubles per level)

| Building | Gold Cost | Build Rounds | Worker Cap |
|---|---|---|---|
| Guild Hall | 100 | 2 | 3 |
| Rogues' Den | 90 | 2 | 3 |
| Wizard's Tower | 150 | 3 | 2 |
| Temple | 80 | 2 | — (no workers) |
| Market | 70 | 1 | — |
| Walls | 120 | 2 | — |

**Scoreboard**
- `score = treasury + building_value + hero.level * 50` where `building_value` = sum of each building's gold cost so far (queued/built), purely informational, no gameplay effect in v1.

---

## 16. Design Decisions Log

Resolved calls and the reasoning behind them, for anyone picking this doc up cold:

- **Win condition** — none. v1 is an ongoing sandbox with a simple scoreboard (§15) for bragging rights, not a game with a formal ending. Adding a win condition later is a config toggle, not a redesign.
- **Map size** — fixed 24x24 for every player count (§3). Simpler than scaling per player count; only worth revisiting if 4-player games feel cramped in practice.
- **Round timeout** — 48h default, configurable 24-168h per game (§15).
- **Worker death** — permanent (§5). Workers are cheap and replaceable (build another building, wait a few rounds), so permadeath keeps stakes real without needing a recovery system for them.
- **Bounty range** — resolved via fog-of-war, not a separate radius stat (§7). Any kingdom can chase any bounty it can see — that's the point of the shared-world competition pillar (§1.5), and it reuses a system that already has to exist rather than inventing a new one.
- **Hero defeat** — Resting-and-recovers, not permadeath (§6, §15). Losing your *one* Hero forever is a much bigger stakes swing than losing one of several workers, so it gets the more forgiving rule.
- **Quest content** — three hand-authored scripts for v1: Goblin Warren, Bandit Hideout, the Dragon's Lair (§6). The dragon reuses the same node-resolution engine with bigger numbers, not special-cased logic — keeps the implementation surface small while still making the dragon feel like the big one.
