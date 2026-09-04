// Worker decision algorithm & task resolution — DESIGN.md §7. Pure functions:
// no D1 access here, so this is unit-testable without any database.

import { chebyshev, stepToward } from './geometry';
import {
  BASE_POWER,
  BASE_THRESHOLD,
  DISTANCE_WEIGHT,
  AURA_BRAVERY_BONUS,
  AURA_THRESHOLD_MULTIPLIER,
  AURA_COMBAT_MULTIPLIER,
  MOVE_SPEED_TILES_PER_ROUND,
  INJURY_DAMAGE_MIN,
  INJURY_DAMAGE_MAX,
  REST_CHANCE_AT_MIN_DILIGENCE,
} from './constants';
import type { WorkerRow, BountyRow, WorkerType } from './types';
import type { Rng } from './rng';

export function power(type: WorkerType, level: number): number {
  return BASE_POWER[type] * (1 + 0.15 * level);
}

export function travelRoundsFor(fromX: number, fromY: number, toX: number, toY: number): number {
  return Math.max(1, Math.ceil(chebyshev(fromX, fromY, toX, toY) / MOVE_SPEED_TILES_PER_ROUND));
}

export interface BountyCandidate {
  bounty: BountyRow;
  danger: number;
}

export type WorkerDecision =
  | { action: 'claim'; bountyId: string }
  | { action: 'idle' }
  | { action: 'resting' };

/** §7 worker decision algorithm, run once per idle worker per round. */
export function evaluateWorkerDecision(worker: WorkerRow, candidates: BountyCandidate[], auraActive: boolean, rng: Rng): WorkerDecision {
  const effectiveBravery = worker.bravery + (auraActive ? AURA_BRAVERY_BONUS : 0);

  let best: { bounty: BountyRow; score: number } | null = null;
  for (const { bounty, danger } of candidates) {
    const distancePenalty = travelRoundsFor(worker.tile_x, worker.tile_y, bounty.target_tile_x, bounty.target_tile_y) * DISTANCE_WEIGHT;
    const riskDiscount = danger * (1 - effectiveBravery / 100);
    const value = bounty.reward * (1 + worker.greed / 100) - riskDiscount - distancePenalty;
    if (!best || value > best.score) best = { bounty, score: value };
  }

  let acceptThreshold = BASE_THRESHOLD * (1 - worker.diligence / 100);
  if (auraActive) acceptThreshold *= AURA_THRESHOLD_MULTIPLIER;

  if (best && best.score > acceptThreshold) {
    return { action: 'claim', bountyId: best.bounty.id };
  }

  const restChance = REST_CHANCE_AT_MIN_DILIGENCE * (1 - worker.diligence / 100);
  return rng() < restChance ? { action: 'resting' } : { action: 'idle' };
}

export interface TaskStepResult {
  worker: Pick<WorkerRow, 'state' | 'hp' | 'tile_x' | 'tile_y' | 'xp' | 'current_bounty_id'>;
  bounty: Pick<BountyRow, 'status'>;
  goldToTreasury: number;
  event: { type: 'bounty_completed' | 'worker_died' } | null;
}

/** Advance one OnTask/Traveling worker by one round — §7 task resolution. */
export function resolveTaskStep(
  worker: WorkerRow,
  bounty: BountyRow,
  danger: number,
  moraleModifier: number,
  auraActive: boolean,
  rng: Rng
): TaskStepResult {
  // Traveling toward the bounty target (or home, if returning — see resolveReturnStep).
  if (worker.state === 'Traveling') {
    const next = stepToward(worker.tile_x, worker.tile_y, bounty.target_tile_x, bounty.target_tile_y, MOVE_SPEED_TILES_PER_ROUND);
    const arrived = next.x === bounty.target_tile_x && next.y === bounty.target_tile_y;
    return {
      worker: {
        state: arrived ? 'OnTask' : 'Traveling',
        hp: worker.hp,
        tile_x: next.x,
        tile_y: next.y,
        xp: worker.xp,
        current_bounty_id: worker.current_bounty_id,
      },
      bounty: { status: bounty.status },
      goldToTreasury: 0,
      event: null,
    };
  }

  // OnTask: resolve the single combat/skill roll.
  let successChance = clamp(power(worker.type, worker.level) / Math.max(1, danger), 0.05, 0.95);
  successChance *= moraleModifier;
  if (auraActive) successChance *= AURA_COMBAT_MULTIPLIER;
  successChance = clamp(successChance, 0.05, 0.98);

  if (rng() < successChance) {
    return {
      worker: {
        state: 'Traveling', // heading home
        hp: worker.hp,
        tile_x: worker.tile_x,
        tile_y: worker.tile_y,
        xp: worker.xp + 20,
        current_bounty_id: null,
      },
      bounty: { status: 'Completed' },
      goldToTreasury: bounty.reward,
      event: { type: 'bounty_completed' },
    };
  }

  const damage = INJURY_DAMAGE_MIN + Math.floor(rng() * (INJURY_DAMAGE_MAX - INJURY_DAMAGE_MIN + 1));
  const hp = worker.hp - damage;
  if (hp <= 0) {
    return {
      worker: { state: 'Dead', hp: 0, tile_x: worker.tile_x, tile_y: worker.tile_y, xp: worker.xp, current_bounty_id: null },
      bounty: { status: 'Open' },
      goldToTreasury: 0,
      event: { type: 'worker_died' },
    };
  }
  return {
    worker: { state: 'Traveling', hp, tile_x: worker.tile_x, tile_y: worker.tile_y, xp: worker.xp, current_bounty_id: null },
    bounty: { status: 'Open' },
    goldToTreasury: 0,
    event: null,
  };
}

/** A worker in Traveling state with no current_bounty_id is heading home after a
 * completed/failed task — step it toward its kingdom's capital, arriving as Idle. */
export function resolveReturnStep(worker: WorkerRow, capitalX: number, capitalY: number): { tile_x: number; tile_y: number; state: WorkerRow['state'] } {
  const next = stepToward(worker.tile_x, worker.tile_y, capitalX, capitalY, MOVE_SPEED_TILES_PER_ROUND);
  const arrived = next.x === capitalX && next.y === capitalY;
  return { tile_x: next.x, tile_y: next.y, state: arrived ? 'Idle' : 'Traveling' };
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}
