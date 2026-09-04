// Balance constants — DESIGN.md §15. Starting points, tune via playtesting.

export const ROUND_TIMEOUT_HOURS_DEFAULT = 48;
export const MAP_SIZE = 24;
export const START_VISIBILITY_RADIUS = 3;
export const FEATURE_REGEN_COOLDOWN_ROUNDS = 6;

export const BASE_POWER: Record<string, number> = {
  Warrior: 20,
  Rogue: 14,
  Wizard: 18,
  Cleric: 8,
};
export const XP_PER_LEVEL = 100;
export const BASE_THRESHOLD = 15;
export const DISTANCE_WEIGHT = 2;
// Not pinned by DESIGN.md — implementation fill-in: tiles/round a worker or Hero
// covers while Traveling. Tuned alongside BASE_THRESHOLD/DISTANCE_WEIGHT.
export const MOVE_SPEED_TILES_PER_ROUND = 3;
export const INJURY_DAMAGE_MIN = 15;
export const INJURY_DAMAGE_MAX = 40;
export const WORKER_HP_REGEN_PER_ROUND = 5;
export const WORKER_HP_REGEN_WITH_TEMPLE = 12;
export const REST_CHANCE_AT_MIN_DILIGENCE = 0.5;
export const WORKER_START_HP = 50;
export const BUILDING_WORKER_SPAWN_CHANCE = 0.35;

export const HERO_START_HP = 50;
export const HERO_START_ATTACK = 12;
export const HERO_HP_PER_LEVEL = 5;
export const HERO_ATTACK_PER_LEVEL = 2;
export const heroRecoveryRounds = (questDifficulty: number) => 2 + questDifficulty;
// Quest node combat — not pinned by DESIGN.md, implementation fill-ins.
export const HERO_ITEM_HEAL = 15;
export const HERO_ITEM_COUNTER_DAMAGE_FRACTION = 0.5;
export const HERO_NODE_DAMAGE_MIN = 10;
export const HERO_NODE_DAMAGE_MAX = 25;
export const HERO_NODE_XP = 30;

export const AURA_RADIUS = 3;
export const AURA_BRAVERY_BONUS = 25;
export const AURA_THRESHOLD_MULTIPLIER = 0.5;
export const AURA_COMBAT_MULTIPLIER = 1.15;

export const STARTING_TREASURY = 300;
export const CAPITAL_BASE_INCOME = 10;
export const MARKET_BONUS_PER_LEVEL = 0.25;
export const moraleModifier = (taxRate: number) => 1 - taxRate / 200;

export const BUILDING_COSTS: Record<string, { cost: number; buildRounds: number; workerCap: number }> = {
  GuildHall: { cost: 100, buildRounds: 2, workerCap: 3 },
  RoguesDen: { cost: 90, buildRounds: 2, workerCap: 3 },
  WizardsTower: { cost: 150, buildRounds: 3, workerCap: 2 },
  Temple: { cost: 80, buildRounds: 2, workerCap: 0 },
  Market: { cost: 70, buildRounds: 1, workerCap: 0 },
  Walls: { cost: 120, buildRounds: 2, workerCap: 0 },
};

// Threats & territory — not pinned by DESIGN.md §15, reasonable implementation fill-ins.
export const THREAT_SPAWN_CHANCE_PER_ROUND = 0.15;
export const MAX_ACTIVE_THREATS = 3;
export const THREAT_POWER_MIN = 20;
export const THREAT_POWER_MAX = 60;
export const KINGDOM_TERRITORY_RADIUS = 4; // a threat this close to a capital counts as "attacking"
export const BOUNTY_DEFAULT_EXPIRY_ROUNDS = 5;
export const AGGRESSIVE_BOUNTY_TREASURY_FRACTION = 0.2;

export const QUEST_SCRIPTS = {
  goblin_warren: { type: 'dungeon', difficulty: 1, nodeCount: 3 },
  bandit_hideout: { type: 'dungeon', difficulty: 2, nodeCount: 4 },
  dragons_lair: { type: 'dragon', difficulty: 3, nodeCount: 6 },
} as const;
