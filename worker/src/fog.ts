// Fog of war — DESIGN.md §3, and the visibility boundary bounties use for
// "awareness" instead of a separate radius stat (§7).

import { tilesWithinRadius, tileKey } from './geometry';
import type { VisibilityRow } from './types';

export type VisState = 'unseen' | 'stale' | 'visible';

/** Recompute one player's fog of war given every tile currently visible to any
 * of their units (Hero + workers), keeping previously-seen tiles as 'stale'. */
export function recomputeVisibility(
  gameId: string,
  playerId: string,
  previous: VisibilityRow[],
  visionSources: { x: number; y: number; radius: number }[],
  mapSize: number
): VisibilityRow[] {
  const nowVisible = new Set<string>();
  for (const src of visionSources) {
    for (const t of tilesWithinRadius(src.x, src.y, src.radius, mapSize)) {
      nowVisible.add(tileKey(t.x, t.y));
    }
  }

  const result: VisibilityRow[] = [];

  for (const key of nowVisible) {
    const [x, y] = key.split(',').map(Number);
    result.push({ game_id: gameId, player_id: playerId, x, y, state: 'visible' });
  }
  for (const v of previous) {
    const key = tileKey(v.x, v.y);
    if (nowVisible.has(key)) continue; // already added as 'visible' above
    result.push({ ...v, state: 'stale' });
  }
  // tiles never seen simply have no row — absence == 'unseen'.
  return result;
}

export function visStateOf(rows: VisibilityRow[], x: number, y: number): VisState {
  const row = rows.find((r) => r.x === x && r.y === y);
  return row ? row.state : 'unseen';
}

export function exploredSet(rows: VisibilityRow[]): Set<string> {
  const s = new Set<string>();
  for (const r of rows) {
    if (r.state === 'visible' || r.state === 'stale') s.add(tileKey(r.x, r.y));
  }
  return s;
}
