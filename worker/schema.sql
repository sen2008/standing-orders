-- Standing Orders — D1 schema (see DESIGN.md §11 for the design-level version)

CREATE TABLE games (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'setup',      -- 'setup' | 'active' | 'ended'
  round_number INTEGER NOT NULL DEFAULT 0,
  round_deadline_at INTEGER,
  round_timeout_hours INTEGER NOT NULL DEFAULT 48,
  map_seed TEXT NOT NULL,
  map_size INTEGER NOT NULL DEFAULT 24,
  resolving INTEGER NOT NULL DEFAULT 0,       -- guard flag: round resolution in progress
  created_at INTEGER NOT NULL
);

CREATE TABLE players (
  id TEXT PRIMARY KEY,
  game_id TEXT NOT NULL REFERENCES games(id),
  name TEXT NOT NULL,
  secret_token TEXT NOT NULL UNIQUE,
  discord_webhook_url TEXT,
  confirmed_this_round INTEGER NOT NULL DEFAULT 0,
  turn_order INTEGER NOT NULL                 -- used only for symmetric start placement, §3
);

CREATE TABLE kingdoms (
  id TEXT PRIMARY KEY,
  player_id TEXT NOT NULL UNIQUE REFERENCES players(id),
  treasury INTEGER NOT NULL DEFAULT 300,
  tax_rate INTEGER NOT NULL DEFAULT 0,
  alert_level TEXT NOT NULL DEFAULT 'Normal',  -- 'Passive' | 'Normal' | 'Aggressive'
  capital_x INTEGER NOT NULL,
  capital_y INTEGER NOT NULL
);

CREATE TABLE buildings (
  id TEXT PRIMARY KEY,
  kingdom_id TEXT NOT NULL REFERENCES kingdoms(id),
  type TEXT NOT NULL,                          -- 'Capital' | 'GuildHall' | 'RoguesDen' | 'WizardsTower' | 'Temple' | 'Market' | 'Walls'
  level INTEGER NOT NULL DEFAULT 1,
  tile_x INTEGER NOT NULL,
  tile_y INTEGER NOT NULL,
  build_progress_rounds_left INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'building'      -- 'queued' | 'building' | 'active'
);

CREATE TABLE workers (
  id TEXT PRIMARY KEY,
  kingdom_id TEXT NOT NULL REFERENCES kingdoms(id),
  building_id TEXT REFERENCES buildings(id),
  type TEXT NOT NULL,                          -- 'Warrior' | 'Rogue' | 'Wizard' | 'Cleric'
  level INTEGER NOT NULL DEFAULT 1,
  xp INTEGER NOT NULL DEFAULT 0,
  hp INTEGER NOT NULL,
  max_hp INTEGER NOT NULL,
  bravery INTEGER NOT NULL,
  greed INTEGER NOT NULL,
  diligence INTEGER NOT NULL,
  state TEXT NOT NULL DEFAULT 'Idle',          -- 'Idle' | 'Traveling' | 'OnTask' | 'Resting' | 'Dead'
  current_bounty_id TEXT,
  tile_x INTEGER NOT NULL,
  tile_y INTEGER NOT NULL
);

CREATE TABLE bounties (
  id TEXT PRIMARY KEY,
  game_id TEXT NOT NULL REFERENCES games(id),
  posted_by_kingdom_id TEXT NOT NULL REFERENCES kingdoms(id),
  type TEXT NOT NULL,                          -- 'Explore' | 'Kill' | 'Gather' | 'Guard'
  target_tile_x INTEGER NOT NULL,
  target_tile_y INTEGER NOT NULL,
  target_ref TEXT,
  reward INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'Open',         -- 'Open' | 'Claimed' | 'InProgress' | 'Completed' | 'Expired' | 'Failed'
  claimed_by_worker_id TEXT,
  posted_round INTEGER NOT NULL,
  expires_round INTEGER
);

CREATE TABLE heroes (
  id TEXT PRIMARY KEY,
  kingdom_id TEXT NOT NULL UNIQUE REFERENCES kingdoms(id),
  name TEXT NOT NULL,
  class TEXT NOT NULL,
  level INTEGER NOT NULL DEFAULT 1,
  xp INTEGER NOT NULL DEFAULT 0,
  hp INTEGER NOT NULL,
  max_hp INTEGER NOT NULL,
  attack INTEGER NOT NULL,
  tile_x INTEGER NOT NULL,
  tile_y INTEGER NOT NULL,
  state TEXT NOT NULL DEFAULT 'AtCapital',     -- 'AtCapital' | 'Exploring' | 'InDungeon' | 'Resting' | 'Dead'
  marshal_active INTEGER NOT NULL DEFAULT 0,
  current_quest_id TEXT,
  recovery_rounds_left INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE quests (
  id TEXT PRIMARY KEY,
  hero_id TEXT NOT NULL REFERENCES heroes(id),
  type TEXT NOT NULL,                          -- 'dungeon' | 'dragon' | 'sidequest'
  difficulty INTEGER NOT NULL,                 -- 1 (easy) .. 3 (hard)
  current_node TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',       -- 'active' | 'completed' | 'failed'
  seed TEXT NOT NULL
);

CREATE TABLE tiles (
  game_id TEXT NOT NULL REFERENCES games(id),
  x INTEGER NOT NULL,
  y INTEGER NOT NULL,
  terrain TEXT NOT NULL,
  danger_level INTEGER NOT NULL DEFAULT 0,
  resource_type TEXT,
  feature TEXT,                                -- null | 'ruin' | 'dungeon' | 'monster_camp' | 'dragon_lair'
  feature_state TEXT,                          -- null | 'active' | 'cleared'
  feature_cleared_round INTEGER,               -- round number a feature was cleared, for regen cooldown (§3)
  PRIMARY KEY (game_id, x, y)
);

CREATE TABLE visibility (
  game_id TEXT NOT NULL,
  player_id TEXT NOT NULL,
  x INTEGER NOT NULL,
  y INTEGER NOT NULL,
  state TEXT NOT NULL,                         -- 'unseen' | 'stale' | 'visible'
  PRIMARY KEY (game_id, player_id, x, y)
);

CREATE TABLE events (
  id TEXT PRIMARY KEY,
  game_id TEXT NOT NULL REFERENCES games(id),
  round_number INTEGER NOT NULL,
  player_id TEXT,                              -- null = global/all
  type TEXT NOT NULL,
  message TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE threats (
  id TEXT PRIMARY KEY,
  game_id TEXT NOT NULL REFERENCES games(id),
  type TEXT NOT NULL,
  power INTEGER NOT NULL,
  tile_x INTEGER NOT NULL,
  tile_y INTEGER NOT NULL,
  state TEXT NOT NULL
);

CREATE INDEX idx_players_token ON players(secret_token);
CREATE INDEX idx_kingdoms_player ON kingdoms(player_id);
CREATE INDEX idx_buildings_kingdom ON buildings(kingdom_id);
CREATE INDEX idx_workers_kingdom ON workers(kingdom_id);
CREATE INDEX idx_bounties_game_status ON bounties(game_id, status);
CREATE INDEX idx_heroes_kingdom ON heroes(kingdom_id);
CREATE INDEX idx_events_game_round ON events(game_id, round_number);
CREATE INDEX idx_threats_game ON threats(game_id);
