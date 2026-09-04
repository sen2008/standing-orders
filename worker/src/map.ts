// Map generation — DESIGN.md §3. Seeded, reproducible, no real noise function
// needed for v1 (weighted-random terrain per tile plus a handful of hand-placed features).

import { rngFromSeed, pick, randInt, type Rng } from './rng';
import { chebyshev } from './geometry';
import type { TileRow } from './types';

const TERRAINS = ['plains', 'forest', 'hills', 'mountains', 'swamp'] as const;
const RESOURCES = [null, null, 'timber', 'ore', 'game'] as const; // weighted toward "no special resource"

const MIN_FEATURE_DISTANCE_FROM_CAPITAL = 4;
const MONSTER_CAMP_COUNT_PER_PLAYER = 1.5; // scaled by player count, rounded
const RUIN_COUNT_PER_PLAYER = 1;

export interface GeneratedMap {
  size: number;
  tiles: TileRow[];
  capitals: { x: number; y: number }[];
}

/** Symmetric starting positions: opposite corners for 2, evenly spaced around the perimeter for 3-4 (§3). */
export function capitalPositions(playerCount: number, size: number): { x: number; y: number }[] {
  const margin = 3;
  const cx = (size - 1) / 2;
  const cy = (size - 1) / 2;
  const radius = size / 2 - margin;
  const positions: { x: number; y: number }[] = [];
  for (let i = 0; i < playerCount; i++) {
    // start at 45deg so 2 players land on opposite corners, not edge midpoints
    const angle = (Math.PI / 4) + (i * (2 * Math.PI)) / playerCount;
    const x = Math.round(cx + radius * Math.cos(angle));
    const y = Math.round(cy + radius * Math.sin(angle));
    positions.push({
      x: Math.min(size - 1, Math.max(0, x)),
      y: Math.min(size - 1, Math.max(0, y)),
    });
  }
  return positions;
}

export function generateMap(gameId: string, seed: string, size: number, playerCount: number): GeneratedMap {
  const rng: Rng = rngFromSeed(seed);
  const capitals = capitalPositions(playerCount, size);
  const center = { x: Math.round((size - 1) / 2), y: Math.round((size - 1) / 2) };

  const tiles: TileRow[] = [];
  for (let x = 0; x < size; x++) {
    for (let y = 0; y < size; y++) {
      const distFromCenter = chebyshev(x, y, center.x, center.y);
      const danger = Math.min(100, Math.max(0, Math.round(distFromCenter * 4 + randInt(rng, -5, 5))));
      tiles.push({
        game_id: gameId,
        x,
        y,
        terrain: pick(rng, TERRAINS),
        danger_level: danger,
        resource_type: pick(rng, RESOURCES),
        feature: null,
        feature_state: null,
        feature_cleared_round: null,
      });
    }
  }

  const byKey = new Map<string, TileRow>();
  for (const t of tiles) byKey.set(`${t.x},${t.y}`, t);

  const farEnoughFromCapitals = (x: number, y: number) =>
    capitals.every((c) => chebyshev(x, y, c.x, c.y) >= MIN_FEATURE_DISTANCE_FROM_CAPITAL);

  const placeFeature = (feature: TileRow['feature'], predicate: (x: number, y: number) => boolean) => {
    for (let attempt = 0; attempt < 500; attempt++) {
      const x = randInt(rng, 0, size - 1);
      const y = randInt(rng, 0, size - 1);
      const tile = byKey.get(`${x},${y}`)!;
      if (tile.feature) continue;
      if (!farEnoughFromCapitals(x, y)) continue;
      if (!predicate(x, y)) continue;
      tile.feature = feature;
      tile.feature_state = 'active';
      tile.danger_level = Math.max(tile.danger_level, feature === 'dragon_lair' ? 90 : feature === 'dungeon' ? 60 : 40);
      return tile;
    }
    return null;
  };

  // Exactly one dragon lair, near the map center — no home-field advantage (§3).
  placeFeature('dragon_lair', (x, y) => chebyshev(x, y, center.x, center.y) <= 3);

  const monsterCampCount = Math.max(2, Math.round(MONSTER_CAMP_COUNT_PER_PLAYER * playerCount));
  for (let i = 0; i < monsterCampCount; i++) placeFeature('monster_camp', () => true);

  const ruinCount = Math.max(2, Math.round(RUIN_COUNT_PER_PLAYER * playerCount));
  for (let i = 0; i < ruinCount; i++) placeFeature('ruin', () => true);

  // Reserve capital tiles as safe, feature-free, low-danger plains.
  for (const c of capitals) {
    const t = byKey.get(`${c.x},${c.y}`)!;
    t.feature = null;
    t.feature_state = null;
    t.terrain = 'plains';
    t.danger_level = 0;
  }

  return { size, tiles, capitals };
}

/** One "dungeon"-flavored feature per quest script gets attached at world-gen time so
 * a Hero walking onto a monster_camp/ruin tile has a concrete quest to start (§6). */
export function questTypeForFeature(feature: TileRow['feature']): 'goblin_warren' | 'bandit_hideout' | 'dragons_lair' | null {
  if (feature === 'dragon_lair') return 'dragons_lair';
  if (feature === 'monster_camp') return 'goblin_warren';
  if (feature === 'ruin') return 'bandit_hideout';
  return null;
}
