// Pure round resolution — DESIGN.md §9. Steps 2-11 (step 1 "lock" and step 12
// "fire Discord webhooks" are I/O, handled by round.ts). No D1 access here at
// all, so the whole round can be resolved and tested against plain fixtures.

import type { Rng } from './rng';
import { randInt } from './rng';
import { chebyshev, tileKey } from './geometry';
import { evaluateWorkerDecision, resolveTaskStep, resolveReturnStep } from './workerAI';
import { exploredSet } from './fog';
import {
  CAPITAL_BASE_INCOME,
  MARKET_BONUS_PER_LEVEL,
  moraleModifier,
  BUILDING_COSTS,
  FEATURE_REGEN_COOLDOWN_ROUNDS,
  THREAT_SPAWN_CHANCE_PER_ROUND,
  MAX_ACTIVE_THREATS,
  THREAT_POWER_MIN,
  THREAT_POWER_MAX,
  KINGDOM_TERRITORY_RADIUS,
  AGGRESSIVE_BOUNTY_TREASURY_FRACTION,
  BOUNTY_DEFAULT_EXPIRY_ROUNDS,
  WORKER_START_HP,
  BUILDING_WORKER_SPAWN_CHANCE,
  AURA_RADIUS,
  MAP_SIZE,
} from './constants';
import type {
  GameRow,
  KingdomRow,
  BuildingRow,
  WorkerRow,
  BountyRow,
  HeroRow,
  TileRow,
  ThreatRow,
  WorkerType,
} from './types';

export interface RoundState {
  game: GameRow;
  kingdoms: KingdomRow[];
  buildings: BuildingRow[];
  workers: WorkerRow[];
  bounties: BountyRow[];
  heroes: HeroRow[];
  tiles: TileRow[];
  threats: ThreatRow[];
  /** kingdomId -> set of "x,y" tiles that kingdom has explored (visible or stale), §7 */
  exploredByKingdom: Map<string, Set<string>>;
}

export interface RoundEvent {
  player_id: string | null;
  type: string;
  message: string;
}

export interface RoundResult {
  kingdoms: KingdomRow[];
  buildings: BuildingRow[];
  workers: WorkerRow[];
  bounties: BountyRow[];
  heroes: HeroRow[];
  tiles: TileRow[];
  threats: ThreatRow[];
  events: RoundEvent[];
  nextRoundNumber: number;
}

const BUILDING_TO_WORKER_TYPE: Partial<Record<BuildingRow['type'], WorkerType>> = {
  GuildHall: 'Warrior',
  RoguesDen: 'Rogue',
  WizardsTower: 'Wizard',
  Temple: 'Cleric',
};

function tileAt(tiles: TileRow[], x: number, y: number): TileRow | undefined {
  return tiles.find((t) => t.x === x && t.y === y);
}

function playerIdForKingdom(_k: KingdomRow): string {
  return _k.player_id;
}

export function resolveRoundPure(state: RoundState, rng: Rng, questSlain?: { dragonKingdomId: string } | null): RoundResult {
  const events: RoundEvent[] = [];
  const kingdoms = state.kingdoms.map((k) => ({ ...k }));
  const buildings = state.buildings.map((b) => ({ ...b }));
  let workers = state.workers.map((w) => ({ ...w }));
  let bounties = state.bounties.map((b) => ({ ...b }));
  const heroes = state.heroes.map((h) => ({ ...h }));
  const tiles = state.tiles.map((t) => ({ ...t }));
  let threats = state.threats.map((t) => ({ ...t }));

  const kingdomById = new Map(kingdoms.map((k) => [k.id, k]));
  const buildingsByKingdom = new Map<string, BuildingRow[]>();
  for (const b of buildings) {
    const list = buildingsByKingdom.get(b.kingdom_id) ?? [];
    list.push(b);
    buildingsByKingdom.set(b.kingdom_id, list);
  }

  // --- Step 2: snapshot hero aura state ---------------------------------
  const auraByKingdom = new Map<string, { x: number; y: number } | null>();
  for (const h of heroes) {
    auraByKingdom.set(h.kingdom_id, h.marshal_active ? { x: h.tile_x, y: h.tile_y } : null);
  }
  const auraActiveAt = (kingdomId: string, x: number, y: number): boolean => {
    const aura = auraByKingdom.get(kingdomId);
    if (!aura) return false;
    return chebyshev(aura.x, aura.y, x, y) <= AURA_RADIUS;
  };

  // --- Step 3: tax income + morale ---------------------------------------
  const moraleByKingdom = new Map<string, number>();
  for (const k of kingdoms) {
    const marketLevels = (buildingsByKingdom.get(k.id) ?? [])
      .filter((b) => b.type === 'Market' && b.status === 'active')
      .reduce((sum, b) => sum + b.level, 0);
    const income = Math.round(CAPITAL_BASE_INCOME * (1 + marketLevels * MARKET_BONUS_PER_LEVEL) * (1 + k.tax_rate / 100));
    k.treasury += income;
    moraleByKingdom.set(k.id, moraleModifier(k.tax_rate));
  }

  // --- Step 4: process OnTask/Traveling workers before idle workers -----
  const bountyById = new Map(bounties.map((b) => [b.id, b]));
  workers = workers.map((w) => {
    if (w.state !== 'OnTask' && w.state !== 'Traveling') return w;

    if (!w.current_bounty_id) {
      // Traveling home after finishing/abandoning a task.
      const kingdom = kingdomById.get(w.kingdom_id)!;
      const step = resolveReturnStep(w, kingdom.capital_x, kingdom.capital_y);
      return { ...w, tile_x: step.tile_x, tile_y: step.tile_y, state: step.state };
    }

    const bounty = bountyById.get(w.current_bounty_id);
    if (!bounty || bounty.status !== 'Claimed') {
      // Bounty vanished from under it (expired etc.) — send it home.
      return { ...w, state: 'Traveling', current_bounty_id: null };
    }

    const tile = tileAt(tiles, bounty.target_tile_x, bounty.target_tile_y);
    const danger = tile?.danger_level ?? 50;
    const morale = moraleByKingdom.get(w.kingdom_id) ?? 1;
    const aura = auraActiveAt(w.kingdom_id, w.tile_x, w.tile_y);
    const result = resolveTaskStep(w, bounty, danger, morale, aura, rng);

    bounty.status = result.bounty.status;
    if (result.goldToTreasury > 0) {
      const kingdom = kingdomById.get(w.kingdom_id)!;
      kingdom.treasury += result.goldToTreasury;
    }
    if (result.event?.type === 'bounty_completed') {
      events.push({ player_id: playerIdForKingdom(kingdomById.get(w.kingdom_id)!), type: 'bounty_completed', message: `A ${w.type.toLowerCase()} completed a bounty (+${result.goldToTreasury} gold).` });
    }
    if (result.event?.type === 'worker_died') {
      events.push({ player_id: playerIdForKingdom(kingdomById.get(w.kingdom_id)!), type: 'worker_died', message: `A ${w.type.toLowerCase()} was slain.` });
    }

    return {
      ...w,
      state: result.worker.state,
      hp: result.worker.hp,
      tile_x: result.worker.tile_x,
      tile_y: result.worker.tile_y,
      xp: result.worker.xp,
      current_bounty_id: result.worker.current_bounty_id,
    };
  });
  bounties = Array.from(bountyById.values());

  // --- Step 5: idle workers regen + decide ------------------------------
  const openBounties = () => bounties.filter((b) => b.status === 'Open');
  workers = workers.map((w) => {
    if (w.state !== 'Idle' && w.state !== 'Resting') return w;

    let hp = w.hp;
    if (hp < w.max_hp) {
      const kingdom = kingdomById.get(w.kingdom_id)!;
      const hasTemple = (buildingsByKingdom.get(kingdom.id) ?? []).some((b) => b.type === 'Temple' && b.status === 'active');
      hp = Math.min(w.max_hp, hp + (hasTemple ? 12 : 5));
    }
    const worker = { ...w, hp };

    const explored = state.exploredByKingdom.get(worker.kingdom_id) ?? new Set<string>();
    const candidates = openBounties()
      .filter((b) => explored.has(tileKey(b.target_tile_x, b.target_tile_y)))
      .map((b) => ({ bounty: b, danger: tileAt(tiles, b.target_tile_x, b.target_tile_y)?.danger_level ?? 50 }));

    const aura = auraActiveAt(worker.kingdom_id, worker.tile_x, worker.tile_y);
    const decision = evaluateWorkerDecision(worker, candidates, aura, rng);

    if (decision.action === 'claim') {
      const bounty = bountyById.get(decision.bountyId)!;
      bounty.status = 'Claimed';
      events.push({ player_id: playerIdForKingdom(kingdomById.get(worker.kingdom_id)!), type: 'worker_claimed_bounty', message: `A ${worker.type.toLowerCase()} set out on a bounty.` });
      return { ...worker, state: 'Traveling', current_bounty_id: bounty.id };
    }
    return { ...worker, state: decision.action === 'resting' ? 'Resting' : 'Idle' };
  });
  bounties = Array.from(bountyById.values());

  // --- Step 6: advance world state ---------------------------------------
  threats = threats.map((t) => ({
    ...t,
    tile_x: Math.min(state.game.map_size - 1, Math.max(0, t.tile_x + randInt(rng, -1, 1))),
    tile_y: Math.min(state.game.map_size - 1, Math.max(0, t.tile_y + randInt(rng, -1, 1))),
  }));

  for (const b of bounties) {
    if (b.status === 'Open' && b.expires_round !== null && state.game.round_number + 1 >= b.expires_round) {
      b.status = 'Expired';
      const kingdom = kingdomById.get(b.posted_by_kingdom_id);
      if (kingdom) kingdom.treasury += b.reward; // refund unclaimed escrow
    }
  }

  if (threats.filter((t) => t.state === 'active').length < MAX_ACTIVE_THREATS && rng() < THREAT_SPAWN_CHANCE_PER_ROUND) {
    const size = state.game.map_size || MAP_SIZE;
    threats.push({
      id: `threat_${Math.floor(rng() * 1e9)}`,
      game_id: state.game.id,
      type: 'raider',
      power: THREAT_POWER_MIN + Math.floor(rng() * (THREAT_POWER_MAX - THREAT_POWER_MIN + 1)),
      tile_x: randInt(rng, 0, size - 1),
      tile_y: randInt(rng, 0, size - 1),
      state: 'active',
    });
  }

  for (const t of tiles) {
    if (t.feature && t.feature !== 'dragon_lair' && t.feature_state === 'cleared' && t.feature_cleared_round !== null) {
      if (state.game.round_number + 1 - t.feature_cleared_round >= FEATURE_REGEN_COOLDOWN_ROUNDS) {
        t.feature_state = 'active';
        t.feature_cleared_round = null;
      }
    }
  }
  if (questSlain) {
    const dragonTile = tiles.find((t) => t.feature === 'dragon_lair');
    if (dragonTile) {
      dragonTile.feature_state = 'cleared';
      dragonTile.feature_cleared_round = state.game.round_number + 1;
    }
    events.push({ player_id: null, type: 'dragon_slain', message: 'The dragon has been slain!' });
  }

  // --- Step 7: building construction --------------------------------------
  for (const b of buildings) {
    if (b.status !== 'building') continue;
    b.build_progress_rounds_left = Math.max(0, b.build_progress_rounds_left - 1);
    if (b.build_progress_rounds_left === 0) {
      b.status = 'active';
      events.push({ player_id: playerIdForKingdom(kingdomById.get(b.kingdom_id)!), type: 'building_completed', message: `${b.type} construction complete.` });
    }
  }

  // Active spawner buildings under their worker cap occasionally produce a new worker.
  for (const b of buildings) {
    if (b.status !== 'active') continue;
    const workerType = BUILDING_TO_WORKER_TYPE[b.type];
    if (!workerType) continue;
    const cap = BUILDING_COSTS[b.type]?.workerCap ?? 0;
    if (cap <= 0) continue;
    const currentCount = workers.filter((w) => w.building_id === b.id && w.state !== 'Dead').length;
    if (currentCount >= cap) continue;
    if (rng() >= BUILDING_WORKER_SPAWN_CHANCE) continue;
    const kingdom = kingdomById.get(b.kingdom_id)!;
    workers.push({
      id: `worker_${Math.floor(rng() * 1e9)}`,
      kingdom_id: b.kingdom_id,
      building_id: b.id,
      type: workerType,
      level: 1,
      xp: 0,
      hp: WORKER_START_HP,
      max_hp: WORKER_START_HP,
      bravery: randInt(rng, 0, 100),
      greed: randInt(rng, 0, 100),
      diligence: randInt(rng, 0, 100),
      state: 'Idle',
      current_bounty_id: null,
      tile_x: kingdom.capital_x,
      tile_y: kingdom.capital_y,
    });
  }

  // --- Step 8: hero recovery countdown ------------------------------------
  for (const h of heroes) {
    if (h.state !== 'Resting') continue;
    h.recovery_rounds_left = Math.max(0, h.recovery_rounds_left - 1);
    if (h.recovery_rounds_left === 0) {
      h.state = 'AtCapital';
      events.push({ player_id: playerIdForKingdom(kingdomById.get(h.kingdom_id)!), type: 'hero_recovered', message: `${h.name} has recovered and is ready to adventure again.` });
    }
  }

  // --- Step 9: Aggressive-alert auto-bounties / kingdom_attacked ---------
  for (const k of kingdoms) {
    const nearbyThreat = threats.find((t) => t.state === 'active' && chebyshev(t.tile_x, t.tile_y, k.capital_x, k.capital_y) <= KINGDOM_TERRITORY_RADIUS);
    if (!nearbyThreat) continue;
    events.push({ player_id: playerIdForKingdom(k), type: 'kingdom_attacked', message: `A threat has entered your territory.` });
    if (k.alert_level === 'Aggressive') {
      const alreadyPosted = bounties.some((b) => b.posted_by_kingdom_id === k.id && b.target_ref === nearbyThreat.id && b.status !== 'Expired' && b.status !== 'Failed');
      if (!alreadyPosted) {
        const reward = Math.max(10, Math.round(k.treasury * AGGRESSIVE_BOUNTY_TREASURY_FRACTION));
        k.treasury -= reward;
        bounties.push({
          id: `bounty_${Math.floor(rng() * 1e9)}`,
          game_id: state.game.id,
          posted_by_kingdom_id: k.id,
          type: 'Guard',
          target_tile_x: nearbyThreat.tile_x,
          target_tile_y: nearbyThreat.tile_y,
          target_ref: nearbyThreat.id,
          reward,
          status: 'Open',
          claimed_by_worker_id: null,
          posted_round: state.game.round_number + 1,
          expires_round: state.game.round_number + 1 + BOUNTY_DEFAULT_EXPIRY_ROUNDS,
        });
      }
    }
  }

  // --- Step 10/11: round_resolved summary + round number -----------------
  const nextRoundNumber = state.game.round_number + 1;
  events.push({ player_id: null, type: 'round_resolved', message: `Round ${nextRoundNumber} has begun.` });

  return { kingdoms, buildings, workers, bounties, heroes, tiles, threats, events, nextRoundNumber };
}

export { exploredSet };
