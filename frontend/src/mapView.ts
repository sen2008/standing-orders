import type { GameStateResponse } from './api';

const CELL = 18;

const TERRAIN_COLOR: Record<string, string> = {
  plains: '#c9d97a',
  forest: '#3f6b2f',
  hills: '#a98953',
  mountains: '#8a8a8a',
  swamp: '#4a5d3a',
};

const FEATURE_COLOR: Record<string, string> = {
  ruin: '#8e44ad',
  dungeon: '#8e44ad',
  monster_camp: '#e67e22',
  dragon_lair: '#c0392b',
};

const KINGDOM_PALETTE = ['#2e6fdb', '#d94b4b', '#2fa86b', '#c99a2e'];

export function kingdomColor(index: number): string {
  return KINGDOM_PALETTE[index % KINGDOM_PALETTE.length];
}

export function drawMap(canvas: HTMLCanvasElement, state: GameStateResponse, selectedTile: { x: number; y: number } | null) {
  const size = state.game.mapSize;
  canvas.width = size * CELL;
  canvas.height = size * CELL;
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  const tileByKey = new Map(state.map.map((t) => [`${t.x},${t.y}`, t]));

  for (let x = 0; x < size; x++) {
    for (let y = 0; y < size; y++) {
      const t = tileByKey.get(`${x},${y}`);
      const px = x * CELL;
      const py = y * CELL;
      if (!t || t.state === 'unseen') {
        ctx.fillStyle = '#111';
        ctx.fillRect(px, py, CELL, CELL);
        continue;
      }
      const base = TERRAIN_COLOR[t.terrain ?? 'plains'] ?? '#999';
      ctx.fillStyle = base;
      ctx.globalAlpha = t.state === 'stale' ? 0.45 : 1;
      ctx.fillRect(px, py, CELL, CELL);
      ctx.globalAlpha = 1;

      if (t.feature && t.feature_state === 'active') {
        ctx.fillStyle = FEATURE_COLOR[t.feature] ?? '#fff';
        ctx.beginPath();
        ctx.arc(px + CELL / 2, py + CELL / 2, CELL * 0.28, 0, Math.PI * 2);
        ctx.fill();
      } else if (t.feature) {
        ctx.strokeStyle = '#666';
        ctx.beginPath();
        ctx.arc(px + CELL / 2, py + CELL / 2, CELL * 0.28, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
  }

  // Bounty targets: yellow ring.
  for (const b of state.bounties) {
    if (b.status !== 'Open' && b.status !== 'Claimed') continue;
    const px = b.target_tile_x * CELL;
    const py = b.target_tile_y * CELL;
    ctx.strokeStyle = '#f1c40f';
    ctx.lineWidth = 2;
    ctx.strokeRect(px + 1, py + 1, CELL - 2, CELL - 2);
  }

  // Threats: red X.
  for (const t of state.threats) {
    const px = t.tile_x * CELL;
    const py = t.tile_y * CELL;
    ctx.strokeStyle = '#e74c3c';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(px + 3, py + 3);
    ctx.lineTo(px + CELL - 3, py + CELL - 3);
    ctx.moveTo(px + CELL - 3, py + 3);
    ctx.lineTo(px + 3, py + CELL - 3);
    ctx.stroke();
  }

  // Kingdoms: capital flag, workers as dots, hero as a star.
  state.kingdoms.forEach((k, i) => {
    const color = kingdomColor(i);
    const cpx = k.capital.x * CELL;
    const cpy = k.capital.y * CELL;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(cpx + 2, cpy + CELL - 2);
    ctx.lineTo(cpx + 2, cpy + 2);
    ctx.lineTo(cpx + CELL - 2, cpy + CELL / 2);
    ctx.closePath();
    ctx.fill();

    for (const w of k.workers) {
      if (w.state === 'Dead') continue;
      const wpx = w.tile_x * CELL + CELL / 2;
      const wpy = w.tile_y * CELL + CELL / 2;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(wpx, wpy, 3, 0, Math.PI * 2);
      ctx.fill();
    }

    if (k.hero && k.hero.state !== 'Dead' && k.hero.state !== 'InDungeon') {
      drawStar(ctx, k.hero.tile_x * CELL + CELL / 2, k.hero.tile_y * CELL + CELL / 2, 6, color);
      if (k.hero.marshal_active) {
        ctx.strokeStyle = color;
        ctx.globalAlpha = 0.5;
        ctx.beginPath();
        ctx.arc(k.hero.tile_x * CELL + CELL / 2, k.hero.tile_y * CELL + CELL / 2, CELL * 3, 0, Math.PI * 2);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
    }
  });

  if (selectedTile) {
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2;
    ctx.strokeRect(selectedTile.x * CELL + 1, selectedTile.y * CELL + 1, CELL - 2, CELL - 2);
  }
}

function drawStar(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, color: string) {
  ctx.fillStyle = color;
  ctx.beginPath();
  for (let i = 0; i < 5; i++) {
    const angle = (Math.PI * 2 * i) / 5 - Math.PI / 2;
    const x = cx + r * Math.cos(angle);
    const y = cy + r * Math.sin(angle);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fill();
}

export function canvasToTile(canvas: HTMLCanvasElement, evt: MouseEvent): { x: number; y: number } {
  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;
  const x = Math.floor(((evt.clientX - rect.left) * scaleX) / CELL);
  const y = Math.floor(((evt.clientY - rect.top) * scaleY) / CELL);
  return { x, y };
}
