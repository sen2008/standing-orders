import { describe, it, expect } from 'vitest';
import { generateMap, capitalPositions } from '../src/map';

describe('capitalPositions', () => {
  it('places 2 players on opposite corners, roughly equidistant from center', () => {
    const size = 24;
    const positions = capitalPositions(2, size);
    expect(positions).toHaveLength(2);
    const center = (size - 1) / 2;
    const dist = (p: { x: number; y: number }) => Math.hypot(p.x - center, p.y - center);
    expect(Math.abs(dist(positions[0]) - dist(positions[1]))).toBeLessThan(1.5);
  });

  it('places 4 players at 4 distinct, roughly equidistant positions', () => {
    const positions = capitalPositions(4, 24);
    const keys = new Set(positions.map((p) => `${p.x},${p.y}`));
    expect(keys.size).toBe(4);
  });

  it('never places a capital outside the map bounds', () => {
    for (const n of [2, 3, 4]) {
      for (const p of capitalPositions(n, 24)) {
        expect(p.x).toBeGreaterThanOrEqual(0);
        expect(p.x).toBeLessThan(24);
        expect(p.y).toBeGreaterThanOrEqual(0);
        expect(p.y).toBeLessThan(24);
      }
    }
  });
});

describe('generateMap', () => {
  it('is reproducible from the same seed', () => {
    const a = generateMap('g1', 'same-seed', 24, 3);
    const b = generateMap('g1', 'same-seed', 24, 3);
    expect(a.tiles).toEqual(b.tiles);
    expect(a.capitals).toEqual(b.capitals);
  });

  it('produces exactly one dragon lair', () => {
    const map = generateMap('g1', 'seedA', 24, 3);
    const lairs = map.tiles.filter((t) => t.feature === 'dragon_lair');
    expect(lairs).toHaveLength(1);
  });

  it('places every feature at least the minimum distance from every capital', () => {
    const map = generateMap('g1', 'seedB', 24, 4);
    const featureTiles = map.tiles.filter((t) => t.feature);
    for (const t of featureTiles) {
      for (const c of map.capitals) {
        const dist = Math.max(Math.abs(t.x - c.x), Math.abs(t.y - c.y));
        expect(dist).toBeGreaterThanOrEqual(4);
      }
    }
  });

  it('produces one tile per grid cell', () => {
    const map = generateMap('g1', 'seedC', 10, 2);
    expect(map.tiles).toHaveLength(100);
  });

  it('capital tiles are always safe plains with zero danger', () => {
    const map = generateMap('g1', 'seedD', 24, 2);
    for (const c of map.capitals) {
      const tile = map.tiles.find((t) => t.x === c.x && t.y === c.y)!;
      expect(tile.danger_level).toBe(0);
      expect(tile.feature).toBeNull();
    }
  });
});
