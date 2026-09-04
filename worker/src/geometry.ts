// Grid distance / vision helpers. Chebyshev (king-move) distance is used
// throughout — for movement, aura radius, and vision radius — so "N tiles" in
// DESIGN.md means the same thing everywhere.

export function chebyshev(ax: number, ay: number, bx: number, by: number): number {
  return Math.max(Math.abs(ax - bx), Math.abs(ay - by));
}

export function tilesWithinRadius(cx: number, cy: number, radius: number, size: number): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = [];
  const minX = Math.max(0, cx - radius);
  const maxX = Math.min(size - 1, cx + radius);
  const minY = Math.max(0, cy - radius);
  const maxY = Math.min(size - 1, cy + radius);
  for (let x = minX; x <= maxX; x++) {
    for (let y = minY; y <= maxY; y++) {
      if (chebyshev(cx, cy, x, y) <= radius) out.push({ x, y });
    }
  }
  return out;
}

export function tileKey(x: number, y: number): string {
  return `${x},${y}`;
}

export function stepToward(fromX: number, fromY: number, toX: number, toY: number, maxSteps: number): { x: number; y: number } {
  let x = fromX;
  let y = fromY;
  for (let i = 0; i < maxSteps; i++) {
    if (x === toX && y === toY) break;
    x += Math.sign(toX - x);
    y += Math.sign(toY - y);
  }
  return { x, y };
}
