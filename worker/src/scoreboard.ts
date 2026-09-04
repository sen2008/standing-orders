// Scoreboard — DESIGN.md §15: score = treasury + building_value + hero.level * 50.

import { BUILDING_COSTS } from './constants';
import type { KingdomRow, BuildingRow, HeroRow } from './types';

export interface ScoreEntry {
  kingdomId: string;
  score: number;
}

export function buildingValue(buildings: BuildingRow[]): number {
  return buildings.reduce((sum, b) => {
    const cost = BUILDING_COSTS[b.type]?.cost ?? 0;
    // upgrade cost roughly doubles per level (§15) — value the building at what was spent to get it there.
    let value = 0;
    for (let lvl = 1; lvl <= b.level; lvl++) value += cost * 2 ** (lvl - 1);
    return sum + value;
  }, 0);
}

export function kingdomScore(kingdom: KingdomRow, buildings: BuildingRow[], hero: HeroRow | undefined): number {
  return kingdom.treasury + buildingValue(buildings) + (hero ? hero.level * 50 : 0);
}
