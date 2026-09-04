// D1 row shapes — mirrors schema.sql / DESIGN.md §11

export interface GameRow {
  id: string;
  name: string;
  status: 'setup' | 'active' | 'ended';
  round_number: number;
  round_deadline_at: number | null;
  round_timeout_hours: number;
  map_seed: string;
  map_size: number;
  resolving: number;
  created_at: number;
}

export interface PlayerRow {
  id: string;
  game_id: string;
  name: string;
  secret_token: string;
  discord_webhook_url: string | null;
  confirmed_this_round: number;
  turn_order: number;
}

export interface KingdomRow {
  id: string;
  player_id: string;
  treasury: number;
  tax_rate: number;
  alert_level: 'Passive' | 'Normal' | 'Aggressive';
  capital_x: number;
  capital_y: number;
}

export type BuildingType = 'Capital' | 'GuildHall' | 'RoguesDen' | 'WizardsTower' | 'Temple' | 'Market' | 'Walls';

export interface BuildingRow {
  id: string;
  kingdom_id: string;
  type: BuildingType;
  level: number;
  tile_x: number;
  tile_y: number;
  build_progress_rounds_left: number;
  status: 'queued' | 'building' | 'active';
}

export type WorkerType = 'Warrior' | 'Rogue' | 'Wizard' | 'Cleric';
export type WorkerState = 'Idle' | 'Traveling' | 'OnTask' | 'Resting' | 'Dead';

export interface WorkerRow {
  id: string;
  kingdom_id: string;
  building_id: string | null;
  type: WorkerType;
  level: number;
  xp: number;
  hp: number;
  max_hp: number;
  bravery: number;
  greed: number;
  diligence: number;
  state: WorkerState;
  current_bounty_id: string | null;
  tile_x: number;
  tile_y: number;
}

export type BountyType = 'Explore' | 'Kill' | 'Gather' | 'Guard';
export type BountyStatus = 'Open' | 'Claimed' | 'InProgress' | 'Completed' | 'Expired' | 'Failed';

export interface BountyRow {
  id: string;
  game_id: string;
  posted_by_kingdom_id: string;
  type: BountyType;
  target_tile_x: number;
  target_tile_y: number;
  target_ref: string | null;
  reward: number;
  status: BountyStatus;
  claimed_by_worker_id: string | null;
  posted_round: number;
  expires_round: number | null;
}

export type HeroState = 'AtCapital' | 'Exploring' | 'InDungeon' | 'Resting' | 'Dead';

export interface HeroRow {
  id: string;
  kingdom_id: string;
  name: string;
  class: WorkerType;
  level: number;
  xp: number;
  hp: number;
  max_hp: number;
  attack: number;
  tile_x: number;
  tile_y: number;
  state: HeroState;
  marshal_active: number;
  current_quest_id: string | null;
  recovery_rounds_left: number;
}

export interface QuestRow {
  id: string;
  hero_id: string;
  type: 'dungeon' | 'dragon' | 'sidequest';
  difficulty: number;
  current_node: string;
  status: 'active' | 'completed' | 'failed';
  seed: string;
}

export interface TileRow {
  game_id: string;
  x: number;
  y: number;
  terrain: string;
  danger_level: number;
  resource_type: string | null;
  feature: 'ruin' | 'dungeon' | 'monster_camp' | 'dragon_lair' | null;
  feature_state: 'active' | 'cleared' | null;
  feature_cleared_round: number | null;
}

export interface VisibilityRow {
  game_id: string;
  player_id: string;
  x: number;
  y: number;
  state: 'unseen' | 'stale' | 'visible';
}

export interface EventRow {
  id: string;
  game_id: string;
  round_number: number;
  player_id: string | null;
  type: string;
  message: string;
  created_at: number;
}

export interface ThreatRow {
  id: string;
  game_id: string;
  type: string;
  power: number;
  tile_x: number;
  tile_y: number;
  state: string;
}

export interface Env {
  DB: D1Database;
  DISCORD_DEFAULT_WEBHOOK?: string;
}
