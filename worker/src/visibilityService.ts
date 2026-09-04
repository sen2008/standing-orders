import { recomputeVisibility } from './fog';
import { repo } from './repo';
import { START_VISIBILITY_RADIUS } from './constants';
import type { KingdomRow, HeroRow, WorkerRow } from './types';

export async function refreshVisibility(
  db: D1Database,
  gameId: string,
  mapSize: number,
  playerId: string,
  kingdom: KingdomRow,
  hero: HeroRow | null,
  kingdomWorkers: WorkerRow[]
) {
  const sources = [{ x: kingdom.capital_x, y: kingdom.capital_y, radius: START_VISIBILITY_RADIUS }];
  if (hero && hero.state !== 'Dead') sources.push({ x: hero.tile_x, y: hero.tile_y, radius: START_VISIBILITY_RADIUS });
  for (const w of kingdomWorkers) {
    if (w.state === 'Dead') continue;
    sources.push({ x: w.tile_x, y: w.tile_y, radius: 1 });
  }
  const previous = await repo.listVisibility(db, gameId, playerId);
  const updated = recomputeVisibility(gameId, playerId, previous, sources, mapSize);
  await repo.replaceVisibility(db, gameId, playerId, updated);
  return updated;
}
