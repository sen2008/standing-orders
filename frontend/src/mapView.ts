import type { GameStateResponse } from './api';

const CELL = 22;

const TERRAIN_COLOR: Record<string, string> = {
  plains: '#a8b95f',
  forest: '#39592c',
  hills: '#8f7248',
  mountains: '#736d72',
  swamp: '#3f4f3a',
};

const FEATURE_ICON: Record<string, string> = {
  ruin: '🏚️',
  dungeon: '🏛️',
  monster_camp: '⛺',
  dragon_lair: '🐉',
};

const HERO_CLASS_ICON: Record<string, string> = {
  Warrior: '⚔️',
  Rogue: '🗡️',
  Wizard: '🔮',
  Cleric: '✟',
};

const KINGDOM_PALETTE = ['#4c8bf5', '#e0645c', '#4fb87a', '#d9a23a'];

export function kingdomColor(index: number): string {
  return KINGDOM_PALETTE[index % KINGDOM_PALETTE.length];
}

export function heroIcon(cls: string): string {
  return HERO_CLASS_ICON[cls] ?? '⚔️';
}

export function featureIcon(feature: string): string {
  return FEATURE_ICON[feature] ?? '❓';
}

export interface MapViewOptions {
  selectedTile: { x: number; y: number } | null;
  hoveredTile: { x: number; y: number } | null;
  moveMode: boolean;
  heroOrigin: { x: number; y: number } | null;
}

function desaturate(hex: string, amount: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const gray = (r + g + b) / 3;
  const mix = (c: number) => Math.round(c + (gray - c) * amount);
  return `rgb(${mix(r)}, ${mix(g)}, ${mix(b)})`;
}

export function drawMap(canvas: HTMLCanvasElement, state: GameStateResponse, opts: MapViewOptions) {
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
        ctx.fillStyle = '#0a090d';
        ctx.fillRect(px, py, CELL, CELL);
        // Faint fog hatching so "unexplored" reads as a texture, not just void.
        ctx.strokeStyle = 'rgba(255,255,255,0.02)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(px, py + CELL);
        ctx.lineTo(px + CELL, py);
        ctx.stroke();
        continue;
      }

      const base = TERRAIN_COLOR[t.terrain ?? 'plains'] ?? '#777';
      if (t.state === 'stale') {
        ctx.fillStyle = desaturate(base, 0.65);
        ctx.globalAlpha = 0.7;
      } else {
        ctx.fillStyle = base;
        ctx.globalAlpha = 1;
      }
      ctx.fillRect(px, py, CELL, CELL);
      ctx.globalAlpha = 1;

      // Danger wash — a visible tile reads as more ominous the higher its danger.
      if (t.state === 'visible' && (t.danger_level ?? 0) > 15) {
        const a = Math.min(0.4, ((t.danger_level ?? 0) / 100) * 0.5);
        ctx.fillStyle = `rgba(150, 30, 30, ${a})`;
        ctx.fillRect(px, py, CELL, CELL);
      }

      ctx.strokeStyle = 'rgba(0,0,0,0.25)';
      ctx.lineWidth = 1;
      ctx.strokeRect(px + 0.5, py + 0.5, CELL - 1, CELL - 1);

      if (t.feature) {
        const active = t.feature_state === 'active';
        ctx.globalAlpha = active ? 1 : 0.35;
        ctx.font = `${CELL - 4}px serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(featureIcon(t.feature), px + CELL / 2, py + CELL / 2 + 1);
        ctx.globalAlpha = 1;
      }
    }
  }

  // Bounty targets: a gold decree ring — "someone has offered a reward here."
  for (const b of state.bounties) {
    if (b.status !== 'Open' && b.status !== 'Claimed') continue;
    const px = b.target_tile_x * CELL;
    const py = b.target_tile_y * CELL;
    ctx.strokeStyle = b.status === 'Open' ? '#e8c25f' : 'rgba(232, 194, 95, 0.4)';
    ctx.lineWidth = 2;
    ctx.setLineDash(b.status === 'Open' ? [] : [3, 2]);
    ctx.strokeRect(px + 2, py + 2, CELL - 4, CELL - 4);
    ctx.setLineDash([]);
  }

  // Threats.
  for (const t of state.threats) {
    if (t.state !== 'active') continue;
    const px = t.tile_x * CELL;
    const py = t.tile_y * CELL;
    ctx.font = `${CELL - 6}px serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('💀', px + CELL / 2, py + CELL / 2 + 1);
  }

  // Kingdoms: capital, workers, hero. Mine = bright + glow. Rivals = muted, outline-first.
  state.kingdoms.forEach((k, i) => {
    const color = kingdomColor(i);

    // Capital: a small keep glyph on a colored disc.
    const cpx = k.capital.x * CELL + CELL / 2;
    const cpy = k.capital.y * CELL + CELL / 2;
    ctx.beginPath();
    ctx.arc(cpx, cpy, CELL * 0.42, 0, Math.PI * 2);
    ctx.fillStyle = k.isMine ? color : `${color}55`;
    ctx.fill();
    ctx.strokeStyle = k.isMine ? '#fff' : color;
    ctx.lineWidth = k.isMine ? 1.5 : 1;
    ctx.stroke();
    ctx.font = `${CELL - 6}px serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('🏰', cpx, cpy + 1);

    for (const w of k.workers) {
      if (w.state === 'Dead') continue;
      const wpx = w.tile_x * CELL + CELL / 2;
      const wpy = w.tile_y * CELL + CELL / 2;
      ctx.beginPath();
      ctx.arc(wpx, wpy, k.isMine ? 3.5 : 2.5, 0, Math.PI * 2);
      if (k.isMine) {
        ctx.fillStyle = color;
        ctx.fill();
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 1;
        ctx.stroke();
      } else {
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
    }

    if (k.hero && k.hero.state !== 'Dead' && k.hero.state !== 'InDungeon') {
      const hx = k.hero.tile_x * CELL + CELL / 2;
      const hy = k.hero.tile_y * CELL + CELL / 2;
      if (k.hero.marshal_active) {
        ctx.strokeStyle = `${color}88`;
        ctx.lineWidth = 1.5;
        ctx.setLineDash([2, 3]);
        ctx.beginPath();
        ctx.arc(hx, hy, CELL * 2.6, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
      }
      if (k.isMine) {
        ctx.shadowColor = color;
        ctx.shadowBlur = 8;
      }
      ctx.font = `${CELL - 2}px serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.globalAlpha = k.isMine ? 1 : 0.75;
      ctx.fillText(heroIcon(k.hero.class), hx, hy + 1);
      ctx.globalAlpha = 1;
      ctx.shadowBlur = 0;
    }
  });

  // Move-mode path preview: a dashed line from the Hero to the hovered tile.
  if (opts.moveMode && opts.heroOrigin && opts.hoveredTile) {
    ctx.strokeStyle = '#e8c25f';
    ctx.lineWidth = 2;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(opts.heroOrigin.x * CELL + CELL / 2, opts.heroOrigin.y * CELL + CELL / 2);
    ctx.lineTo(opts.hoveredTile.x * CELL + CELL / 2, opts.hoveredTile.y * CELL + CELL / 2);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  if (opts.hoveredTile) {
    ctx.strokeStyle = opts.moveMode ? '#e8c25f' : 'rgba(255,255,255,0.5)';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(opts.hoveredTile.x * CELL + 1, opts.hoveredTile.y * CELL + 1, CELL - 2, CELL - 2);
  }

  if (opts.selectedTile) {
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2;
    ctx.strokeRect(opts.selectedTile.x * CELL + 1, opts.selectedTile.y * CELL + 1, CELL - 2, CELL - 2);
  }
}

export function canvasToTile(canvas: HTMLCanvasElement, evt: MouseEvent): { x: number; y: number } {
  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;
  const x = Math.floor(((evt.clientX - rect.left) * scaleX) / CELL);
  const y = Math.floor(((evt.clientY - rect.top) * scaleY) / CELL);
  return { x, y };
}
