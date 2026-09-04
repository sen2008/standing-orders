import { describe, it, expect } from 'vitest';
import { resolveRoundPure, type RoundState } from '../src/roundEngine';
import { mulberry32 } from '../src/rng';
import type { GameRow, KingdomRow, BuildingRow, WorkerRow, BountyRow, HeroRow, TileRow, ThreatRow } from '../src/types';

function baseGame(overrides: Partial<GameRow> = {}): GameRow {
  return {
    id: 'g1',
    name: 'Test Game',
    status: 'active',
    round_number: 0,
    round_deadline_at: null,
    round_timeout_hours: 48,
    map_seed: 'seed',
    map_size: 24,
    resolving: 0,
    created_at: 0,
    ...overrides,
  };
}

function baseKingdom(overrides: Partial<KingdomRow> = {}): KingdomRow {
  return { id: 'k1', player_id: 'p1', treasury: 300, tax_rate: 0, alert_level: 'Normal', capital_x: 2, capital_y: 2, ...overrides };
}

function emptyState(overrides: Partial<RoundState> = {}): RoundState {
  return {
    game: baseGame(),
    kingdoms: [baseKingdom()],
    buildings: [],
    workers: [],
    bounties: [],
    heroes: [],
    tiles: [],
    threats: [],
    exploredByKingdom: new Map([['k1', new Set<string>()]]),
    ...overrides,
  };
}

describe('resolveRoundPure — ordering and basics', () => {
  it('increments the round number and emits a round_resolved event', () => {
    const result = resolveRoundPure(emptyState(), mulberry32(1));
    expect(result.nextRoundNumber).toBe(1);
    expect(result.events.some((e) => e.type === 'round_resolved')).toBe(true);
  });

  it('applies baseline capital income before anything else runs', () => {
    const result = resolveRoundPure(emptyState(), mulberry32(1));
    expect(result.kingdoms[0].treasury).toBeGreaterThan(300); // base income, no buildings/workers involved
  });

  it('a worker claiming a bounty this round does not also move or fight in the same round', () => {
    const bounty: BountyRow = {
      id: 'b1',
      game_id: 'g1',
      posted_by_kingdom_id: 'k1',
      type: 'Kill',
      target_tile_x: 10,
      target_tile_y: 2,
      target_ref: null,
      reward: 500,
      status: 'Open',
      claimed_by_worker_id: null,
      posted_round: 0,
      expires_round: 20,
    };
    const worker: WorkerRow = {
      id: 'w1',
      kingdom_id: 'k1',
      building_id: null,
      type: 'Warrior',
      level: 5,
      xp: 0,
      hp: 50,
      max_hp: 50,
      bravery: 90,
      greed: 90,
      diligence: 90,
      state: 'Idle',
      current_bounty_id: null,
      tile_x: 2,
      tile_y: 2,
    };
    const state = emptyState({
      workers: [worker],
      bounties: [bounty],
      exploredByKingdom: new Map([['k1', new Set(['10,2'])]]),
    });

    const result = resolveRoundPure(state, mulberry32(1));
    const w = result.workers[0];
    expect(w.state).toBe('Traveling');
    expect(w.current_bounty_id).toBe('b1');
    // Ordering guarantee: step 4 (process existing Traveling/OnTask) runs before step 5
    // (idle workers decide), so a worker that JUST claimed this round shouldn't have
    // its travel/combat resolved until next round — it should not have moved yet.
    expect(w.tile_x).toBe(2);
    expect(w.tile_y).toBe(2);
    expect(result.bounties[0].status).toBe('Claimed');
  });

  it('a Traveling worker with an already-claimed bounty steps toward the target over successive rounds', () => {
    const bounty: BountyRow = {
      id: 'b1',
      game_id: 'g1',
      posted_by_kingdom_id: 'k1',
      type: 'Kill',
      target_tile_x: 20,
      target_tile_y: 2,
      target_ref: null,
      reward: 500,
      status: 'Claimed',
      claimed_by_worker_id: 'w1',
      posted_round: 0,
      expires_round: 30,
    };
    let worker: WorkerRow = {
      id: 'w1',
      kingdom_id: 'k1',
      building_id: null,
      type: 'Warrior',
      level: 5,
      xp: 0,
      hp: 50,
      max_hp: 50,
      bravery: 50,
      greed: 50,
      diligence: 50,
      state: 'Traveling',
      current_bounty_id: 'b1',
      tile_x: 2,
      tile_y: 2,
    };
    let bounties = [bounty];
    let state = emptyState({ workers: [worker], bounties });

    const result1 = resolveRoundPure(state, mulberry32(1));
    worker = result1.workers[0];
    bounties = result1.bounties;
    expect(chebyshevDist(worker.tile_x, worker.tile_y, 2, 2)).toBeGreaterThan(0); // moved closer
    expect(worker.tile_x).toBeLessThanOrEqual(20);
  });

  it('a marshaled Hero aura increases the odds that a marginal bounty gets claimed', () => {
    const bounty: BountyRow = {
      id: 'b1',
      game_id: 'g1',
      posted_by_kingdom_id: 'k1',
      type: 'Kill',
      target_tile_x: 3,
      target_tile_y: 2,
      target_ref: null,
      reward: 40,
      status: 'Open',
      claimed_by_worker_id: null,
      posted_round: 0,
      expires_round: 20,
    };
    const worker: WorkerRow = {
      id: 'w1',
      kingdom_id: 'k1',
      building_id: null,
      type: 'Rogue',
      level: 1,
      xp: 0,
      hp: 50,
      max_hp: 50,
      bravery: 15,
      greed: 15,
      diligence: 20,
      state: 'Idle',
      current_bounty_id: null,
      tile_x: 2,
      tile_y: 2,
    };
    const hero: HeroRow = {
      id: 'h1',
      kingdom_id: 'k1',
      name: 'Hero',
      class: 'Warrior',
      level: 1,
      xp: 0,
      hp: 50,
      max_hp: 50,
      attack: 12,
      tile_x: 2,
      tile_y: 2,
      state: 'AtCapital',
      marshal_active: 0,
      current_quest_id: null,
      recovery_rounds_left: 0,
    };

    const explored = new Map([['k1', new Set(['3,2'])]]);
    let claimsWithoutAura = 0;
    let claimsWithAura = 0;
    for (let seed = 1; seed <= 100; seed++) {
      const stateNoAura = emptyState({ workers: [worker], bounties: [bounty], heroes: [{ ...hero, marshal_active: 0 }], exploredByKingdom: explored });
      const stateAura = emptyState({ workers: [worker], bounties: [bounty], heroes: [{ ...hero, marshal_active: 1 }], exploredByKingdom: explored });
      if (resolveRoundPure(stateNoAura, mulberry32(seed)).workers[0].state === 'Traveling') claimsWithoutAura++;
      if (resolveRoundPure(stateAura, mulberry32(seed)).workers[0].state === 'Traveling') claimsWithAura++;
    }
    expect(claimsWithAura).toBeGreaterThan(claimsWithoutAura);
  });

  it('building construction counts down and fires building_completed on arrival', () => {
    const building: BuildingRow = {
      id: 'bld1',
      kingdom_id: 'k1',
      type: 'Market',
      level: 1,
      tile_x: 2,
      tile_y: 2,
      build_progress_rounds_left: 1,
      status: 'building',
    };
    const result = resolveRoundPure(emptyState({ buildings: [building] }), mulberry32(1));
    expect(result.buildings[0].status).toBe('active');
    expect(result.events.some((e) => e.type === 'building_completed')).toBe(true);
  });

  it('an expired unclaimed bounty refunds its escrow to the posting kingdom', () => {
    const bounty: BountyRow = {
      id: 'b1',
      game_id: 'g1',
      posted_by_kingdom_id: 'k1',
      type: 'Explore',
      target_tile_x: 5,
      target_tile_y: 5,
      target_ref: null,
      reward: 75,
      status: 'Open',
      claimed_by_worker_id: null,
      posted_round: 0,
      expires_round: 1, // expires as soon as round 1 begins
    };
    const state = emptyState({ game: baseGame({ round_number: 0 }), bounties: [bounty] });
    const result = resolveRoundPure(state, mulberry32(1));
    expect(result.bounties[0].status).toBe('Expired');
    expect(result.kingdoms[0].treasury).toBe(300 + 10 + 75); // base income + refund
  });

  it('a Resting Hero recovers and returns to AtCapital when the countdown reaches zero', () => {
    const hero: HeroRow = {
      id: 'h1',
      kingdom_id: 'k1',
      name: 'Hero',
      class: 'Warrior',
      level: 1,
      xp: 0,
      hp: 10,
      max_hp: 50,
      attack: 12,
      tile_x: 2,
      tile_y: 2,
      state: 'Resting',
      marshal_active: 0,
      current_quest_id: null,
      recovery_rounds_left: 1,
    };
    const result = resolveRoundPure(emptyState({ heroes: [hero] }), mulberry32(1));
    expect(result.heroes[0].state).toBe('AtCapital');
    expect(result.events.some((e) => e.type === 'hero_recovered')).toBe(true);
  });

  it('an active threat inside a kingdom territory fires kingdom_attacked', () => {
    const threat: ThreatRow = { id: 't1', game_id: 'g1', type: 'raider', power: 30, tile_x: 3, tile_y: 2, state: 'active' };
    const result = resolveRoundPure(emptyState({ threats: [threat] }), mulberry32(1));
    expect(result.events.some((e) => e.type === 'kingdom_attacked')).toBe(true);
  });

  it('Aggressive alert level auto-posts a defend bounty against a nearby threat', () => {
    const threat: ThreatRow = { id: 't1', game_id: 'g1', type: 'raider', power: 30, tile_x: 3, tile_y: 2, state: 'active' };
    const state = emptyState({ kingdoms: [baseKingdom({ alert_level: 'Aggressive' })], threats: [threat] });
    const result = resolveRoundPure(state, mulberry32(1));
    expect(result.bounties.some((b) => b.type === 'Guard' && b.target_ref === 't1')).toBe(true);
  });

  it('Passive alert level never auto-posts a defend bounty', () => {
    const threat: ThreatRow = { id: 't1', game_id: 'g1', type: 'raider', power: 30, tile_x: 3, tile_y: 2, state: 'active' };
    const state = emptyState({ kingdoms: [baseKingdom({ alert_level: 'Passive' })], threats: [threat] });
    const result = resolveRoundPure(state, mulberry32(1));
    expect(result.bounties.length).toBe(0);
  });

  it('a cleared, non-dragon feature tile regenerates after its cooldown', () => {
    const tile: TileRow = {
      game_id: 'g1',
      x: 5,
      y: 5,
      terrain: 'plains',
      danger_level: 40,
      resource_type: null,
      feature: 'monster_camp',
      feature_state: 'cleared',
      feature_cleared_round: 0,
    };
    // Cooldown is 6 rounds (§15) — resolving from round 0 to round 1 is not enough yet.
    const tooSoon = resolveRoundPure(emptyState({ tiles: [tile] }), mulberry32(1));
    expect(tooSoon.tiles[0].feature_state).toBe('cleared');

    const readyTile: TileRow = { ...tile, feature_cleared_round: -6 };
    const ready = resolveRoundPure(emptyState({ tiles: [readyTile], game: baseGame({ round_number: 0 }) }), mulberry32(1));
    expect(ready.tiles[0].feature_state).toBe('active');
  });

  it('slaying the dragon permanently clears the lair and fires a global event', () => {
    const tile: TileRow = {
      game_id: 'g1',
      x: 5,
      y: 5,
      terrain: 'mountains',
      danger_level: 90,
      resource_type: null,
      feature: 'dragon_lair',
      feature_state: 'active',
      feature_cleared_round: null,
    };
    const result = resolveRoundPure(emptyState({ tiles: [tile] }), mulberry32(1), { dragonKingdomId: 'k1' });
    expect(result.tiles[0].feature_state).toBe('cleared');
    const event = result.events.find((e) => e.type === 'dragon_slain');
    expect(event).toBeTruthy();
    expect(event?.player_id).toBeNull(); // game-wide, not owner-only
  });
});

function chebyshevDist(ax: number, ay: number, bx: number, by: number): number {
  return Math.max(Math.abs(ax - bx), Math.abs(ay - by));
}
