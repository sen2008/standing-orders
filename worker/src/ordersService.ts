// Standing orders — DESIGN.md §12 POST /orders, §4 buildings, §7 bounties, §8 policy.
// Orders can be edited freely, any number of times, until the player confirms (§2).

import { repo } from './repo';
import { newId } from './ids';
import { exploredSet } from './fog';
import { BUILDING_COSTS, BOUNTY_DEFAULT_EXPIRY_ROUNDS } from './constants';
import type { BuildingType, BountyType } from './types';

export interface OrdersInput {
  taxRate?: number;
  alertLevel?: 'Passive' | 'Normal' | 'Aggressive';
  postBounties?: { type: BountyType; targetX: number; targetY: number; targetRef?: string | null; reward: number }[];
  cancelBountyIds?: string[];
  queueBuildings?: { type: BuildingType }[];
}

export async function applyOrders(db: D1Database, gameId: string, playerId: string, kingdomId: string, roundNumber: number, input: OrdersInput): Promise<{ errors: string[] }> {
  const errors: string[] = [];
  const kingdom = await repo.getKingdomByPlayer(db, playerId);
  if (!kingdom || kingdom.id !== kingdomId) {
    return { errors: ['kingdom not found for this player'] };
  }

  if (input.taxRate !== undefined) {
    kingdom.tax_rate = Math.min(100, Math.max(0, Math.round(input.taxRate)));
  }
  if (input.alertLevel !== undefined) {
    if (!['Passive', 'Normal', 'Aggressive'].includes(input.alertLevel)) {
      errors.push(`invalid alertLevel: ${input.alertLevel}`);
    } else {
      kingdom.alert_level = input.alertLevel;
    }
  }

  if (input.cancelBountyIds) {
    for (const id of input.cancelBountyIds) {
      const bounties = await repo.listBounties(db, gameId);
      const bounty = bounties.find((b) => b.id === id);
      if (!bounty || bounty.posted_by_kingdom_id !== kingdomId || bounty.status !== 'Open') {
        errors.push(`cannot cancel bounty ${id}`);
        continue;
      }
      kingdom.treasury += bounty.reward;
      await repo.cancelOpenBounty(db, id);
    }
  }

  if (input.postBounties) {
    const visibility = await repo.listVisibility(db, gameId, playerId);
    const explored = exploredSet(visibility);
    for (const b of input.postBounties) {
      if (b.reward <= 0) {
        errors.push('bounty reward must be positive');
        continue;
      }
      if (!explored.has(`${b.targetX},${b.targetY}`)) {
        errors.push(`cannot post a bounty on an unexplored tile (${b.targetX},${b.targetY})`);
        continue;
      }
      if (kingdom.treasury < b.reward) {
        errors.push('not enough treasury for that bounty reward');
        continue;
      }
      kingdom.treasury -= b.reward;
      await repo.insertBounty(db, {
        id: newId('bounty'),
        game_id: gameId,
        posted_by_kingdom_id: kingdomId,
        type: b.type,
        target_tile_x: b.targetX,
        target_tile_y: b.targetY,
        target_ref: b.targetRef ?? null,
        reward: b.reward,
        status: 'Open',
        claimed_by_worker_id: null,
        posted_round: roundNumber,
        expires_round: roundNumber + BOUNTY_DEFAULT_EXPIRY_ROUNDS,
      });
    }
  }

  if (input.queueBuildings) {
    for (const qb of input.queueBuildings) {
      const spec = BUILDING_COSTS[qb.type];
      if (!spec) {
        errors.push(`unknown building type: ${qb.type}`);
        continue;
      }
      if (kingdom.treasury < spec.cost) {
        errors.push(`not enough treasury to queue a ${qb.type}`);
        continue;
      }
      kingdom.treasury -= spec.cost;
      await repo.insertBuilding(db, {
        id: newId('building'),
        kingdom_id: kingdomId,
        type: qb.type,
        level: 1,
        tile_x: kingdom.capital_x,
        tile_y: kingdom.capital_y,
        build_progress_rounds_left: spec.buildRounds,
        status: 'building',
      });
    }
  }

  await repo.updateKingdom(db, kingdom);
  return { errors };
}
