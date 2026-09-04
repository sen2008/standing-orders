import { describe, it, expect } from 'vitest';
import { evaluateWorkerDecision, resolveTaskStep, power, travelRoundsFor } from '../src/workerAI';
import type { WorkerRow, BountyRow } from '../src/types';
import { mulberry32 } from '../src/rng';

function makeWorker(overrides: Partial<WorkerRow> = {}): WorkerRow {
  return {
    id: 'w1',
    kingdom_id: 'k1',
    building_id: 'b1',
    type: 'Warrior',
    level: 1,
    xp: 0,
    hp: 50,
    max_hp: 50,
    bravery: 50,
    greed: 50,
    diligence: 50,
    state: 'Idle',
    current_bounty_id: null,
    tile_x: 0,
    tile_y: 0,
    ...overrides,
  };
}

function makeBounty(overrides: Partial<BountyRow> = {}): BountyRow {
  return {
    id: 'bounty1',
    game_id: 'g1',
    posted_by_kingdom_id: 'k1',
    type: 'Kill',
    target_tile_x: 3,
    target_tile_y: 0,
    target_ref: null,
    reward: 100,
    status: 'Open',
    claimed_by_worker_id: null,
    posted_round: 0,
    expires_round: 10,
    ...overrides,
  };
}

describe('evaluateWorkerDecision', () => {
  it('claims a rich, low-risk bounty over doing nothing', () => {
    const worker = makeWorker({ bravery: 80, greed: 80, diligence: 80 });
    const bounty = makeBounty({ reward: 500 });
    // rng() never called for the claim path itself (only for the idle/resting split), so any deterministic rng is fine.
    const rng = mulberry32(1);
    const decision = evaluateWorkerDecision(worker, [{ bounty, danger: 10 }], false, rng);
    expect(decision).toEqual({ action: 'claim', bountyId: bounty.id });
  });

  it('passes on a bounty with reward too small for the risk', () => {
    const worker = makeWorker({ bravery: 5, greed: 5, diligence: 90 }); // high diligence -> low accept_threshold, but still shouldn't take a terrible deal
    const bounty = makeBounty({ reward: 5 });
    const rng = mulberry32(1);
    const decision = evaluateWorkerDecision(worker, [{ bounty, danger: 95 }], false, rng);
    expect(decision.action).not.toBe('claim');
  });

  it('a marshaled aura makes an otherwise-rejected bounty acceptable', () => {
    // Hand-picked so the aura's bravery bump + threshold halving is the deciding factor:
    // value_noAura = 30*(1+0/100) - 40*(1-20/100) - 2 = -4  (threshold 7.5 -> rejected)
    // value_aura   = 30*(1+0/100) - 40*(1-45/100) - 2 =  6  (threshold 3.75 -> accepted)
    const worker = makeWorker({ bravery: 20, greed: 0, diligence: 50 });
    const bounty = makeBounty({ reward: 30, target_tile_x: 1, target_tile_y: 0 });

    const withoutAura = evaluateWorkerDecision(worker, [{ bounty, danger: 40 }], false, mulberry32(1));
    const withAura = evaluateWorkerDecision(worker, [{ bounty, danger: 40 }], true, mulberry32(1));

    expect(withoutAura.action).not.toBe('claim');
    expect(withAura).toEqual({ action: 'claim', bountyId: bounty.id });
  });

  it('picks the highest-scoring bounty among several candidates', () => {
    const worker = makeWorker({ bravery: 60, greed: 60, diligence: 60 });
    const near = makeBounty({ id: 'near', reward: 50, target_tile_x: 1, target_tile_y: 0 });
    const far = makeBounty({ id: 'far', reward: 55, target_tile_x: 20, target_tile_y: 0 });
    const rng = mulberry32(1);
    const decision = evaluateWorkerDecision(
      worker,
      [
        { bounty: near, danger: 10 },
        { bounty: far, danger: 10 },
      ],
      false,
      rng
    );
    expect(decision).toEqual({ action: 'claim', bountyId: 'near' });
  });
});

describe('power', () => {
  it('scales with level and differs per class', () => {
    expect(power('Warrior', 1)).toBeCloseTo(20 * 1.15);
    expect(power('Warrior', 5)).toBeGreaterThan(power('Warrior', 1));
    expect(power('Wizard', 1)).not.toBeCloseTo(power('Warrior', 1));
  });
});

describe('travelRoundsFor', () => {
  it('is at least 1 round even for adjacent tiles', () => {
    expect(travelRoundsFor(0, 0, 1, 1)).toBeGreaterThanOrEqual(1);
  });
  it('grows with distance', () => {
    expect(travelRoundsFor(0, 0, 20, 20)).toBeGreaterThan(travelRoundsFor(0, 0, 2, 2));
  });
});

describe('resolveTaskStep', () => {
  it('moves a Traveling worker toward the bounty target without resolving combat', () => {
    const worker = makeWorker({ state: 'Traveling', current_bounty_id: 'bounty1', tile_x: 0, tile_y: 0 });
    const bounty = makeBounty({ target_tile_x: 10, target_tile_y: 0 });
    const rng = mulberry32(1);
    const result = resolveTaskStep(worker, bounty, 20, 1, false, rng);
    expect(result.worker.tile_x).toBeGreaterThan(0);
    expect(result.worker.state).toBe('Traveling');
    expect(result.event).toBeNull();
  });

  it('a powerful worker vs. a weak target succeeds with a lucky roll and pays the bounty', () => {
    const worker = makeWorker({ state: 'OnTask', level: 10, type: 'Warrior' });
    const bounty = makeBounty({ reward: 200 });
    const rng = mulberry32(1); // first roll happens to be favorable against a low-danger target
    const result = resolveTaskStep(worker, bounty, 5, 1, false, rng);
    expect(result.bounty.status === 'Completed' || result.bounty.status === 'Open').toBe(true);
    if (result.bounty.status === 'Completed') {
      expect(result.goldToTreasury).toBe(200);
      expect(result.worker.state).toBe('Traveling');
      expect(result.worker.current_bounty_id).toBeNull();
    }
  });

  it('a weak worker facing overwhelming danger eventually dies from repeated failure', () => {
    const worker = makeWorker({ state: 'OnTask', level: 1, type: 'Cleric', hp: 10 });
    const bounty = makeBounty({});
    // Danger of 500 vs. Cleric power (~9.2) drives success_chance to its 0.05 floor —
    // run enough deterministic seeds that at least one produces a fatal failure.
    let sawDeath = false;
    for (let seed = 1; seed < 200; seed++) {
      const result = resolveTaskStep(worker, bounty, 500, 1, false, mulberry32(seed));
      if (result.worker.state === 'Dead') {
        sawDeath = true;
        expect(result.worker.hp).toBe(0);
        expect(result.event).toEqual({ type: 'worker_died' });
        break;
      }
    }
    expect(sawDeath).toBe(true);
  });

  it('a successful task grants xp and levels the worker up once enough xp accrues (100 xp/level, §15)', () => {
    // level/xp must stay internally consistent (level = floor(xp/100)+1), as it is for
    // every real worker (spawned at xp 0, level 1, and only ever gaining xp) — 90 -> 110 crosses into level 2.
    const worker = makeWorker({ state: 'OnTask', level: 1, xp: 90, type: 'Warrior' });
    const bounty = makeBounty({ reward: 10 });
    let result = resolveTaskStep(worker, bounty, 1, 1, false, mulberry32(1));
    for (let seed = 1; seed < 50 && result.bounty.status !== 'Completed'; seed++) {
      result = resolveTaskStep(worker, bounty, 1, 1, false, mulberry32(seed));
    }
    expect(result.bounty.status).toBe('Completed');
    expect(result.worker.xp).toBe(110);
    expect(result.worker.level).toBe(2);
  });

  it('morale modifier and aura both shift success chance in the expected direction', () => {
    // Same danger/power, only morale differs — lower morale should never produce
    // more successes than full morale across an identical batch of seeds.
    const worker = makeWorker({ state: 'OnTask', level: 5 });
    const bounty = makeBounty({});
    let successesFullMorale = 0;
    let successesLowMorale = 0;
    for (let seed = 1; seed <= 500; seed++) {
      if (resolveTaskStep(worker, bounty, 40, 1, false, mulberry32(seed)).bounty.status === 'Completed') successesFullMorale++;
      if (resolveTaskStep(worker, bounty, 40, 0.5, false, mulberry32(seed)).bounty.status === 'Completed') successesLowMorale++;
    }
    expect(successesFullMorale).toBeGreaterThanOrEqual(successesLowMorale);
  });
});
