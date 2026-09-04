// Thin fetch wrapper around the Worker API — DESIGN.md §12. No game logic
// lives here; this file only shapes requests/responses.

// Production default — override via the "API server" field for local dev
// (that field writes to localStorage, so it's per-browser, not baked into the build).
const DEFAULT_BASE_URL = 'https://api.standingorders.lucaswalker.net';

export function apiBaseUrl(): string {
  return localStorage.getItem('so_api_base_url') || DEFAULT_BASE_URL;
}

export function setApiBaseUrl(url: string) {
  localStorage.setItem('so_api_base_url', url);
}

// Site-wide creation gate (DESIGN.md §12) — separate from per-player tokens, which are
// stored in storage.ts. This is just the shared passphrase gating POST /games.
export function sitePassword(): string {
  return localStorage.getItem('so_site_password') ?? '';
}

export function setSitePassword(pw: string) {
  localStorage.setItem('so_site_password', pw);
}

export function clearSitePassword() {
  localStorage.removeItem('so_site_password');
}

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${apiBaseUrl()}${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message = (body && (body.error || body.errors?.join(', '))) || `request failed (${res.status})`;
    throw new ApiError(message, res.status);
  }
  return body as T;
}

export interface CreateGameResponse {
  gameId: string;
  players: { name: string; token: string }[];
}

export function createGame(name: string, players: { name: string; discordWebhookUrl?: string }[], roundTimeoutHours?: number) {
  return req<CreateGameResponse>('/games', {
    method: 'POST',
    headers: { 'X-Site-Password': sitePassword() },
    body: JSON.stringify({ name, players, roundTimeoutHours }),
  });
}

export function getState(gameId: string, token: string) {
  return req<GameStateResponse>(`/games/${gameId}/state?token=${encodeURIComponent(token)}`);
}

export function submitOrders(gameId: string, token: string, orders: OrdersInput) {
  return req<{ errors: string[] }>(`/games/${gameId}/orders?token=${encodeURIComponent(token)}`, {
    method: 'POST',
    body: JSON.stringify(orders),
  });
}

export function confirmOrders(gameId: string, token: string) {
  return req<{ confirmed: boolean; roundResolved: boolean }>(`/games/${gameId}/confirm?token=${encodeURIComponent(token)}`, { method: 'POST' });
}

export function moveHero(gameId: string, token: string, heroId: string, x: number, y: number) {
  return req<{ hero: Hero; tile: Tile | null; canStartQuest: boolean }>(`/games/${gameId}/heroes/${heroId}/move?token=${encodeURIComponent(token)}`, {
    method: 'POST',
    body: JSON.stringify({ x, y }),
  });
}

export function setMarshal(gameId: string, token: string, heroId: string, active: boolean) {
  return req<{ hero: Hero }>(`/games/${gameId}/heroes/${heroId}/marshal?token=${encodeURIComponent(token)}`, {
    method: 'POST',
    body: JSON.stringify({ active }),
  });
}

export function startQuest(gameId: string, token: string, heroId: string) {
  return req<{ quest: Quest; script: { name: string; nodes: { id: string; kind: string; label: string; isBoss: boolean }[] } }>(
    `/games/${gameId}/heroes/${heroId}/quest/start?token=${encodeURIComponent(token)}`,
    { method: 'POST' }
  );
}

export function stepQuest(gameId: string, token: string, heroId: string, action: 'attack' | 'use_item' | 'flee') {
  return req<{ hero: Hero; quest: Quest; outcome: QuestOutcome }>(`/games/${gameId}/heroes/${heroId}/quest/step?token=${encodeURIComponent(token)}`, {
    method: 'POST',
    body: JSON.stringify({ action }),
  });
}

// --- Response shapes (mirrors worker/src/types.ts + service response shapes) ---

export interface OrdersInput {
  taxRate?: number;
  alertLevel?: 'Passive' | 'Normal' | 'Aggressive';
  postBounties?: { type: string; targetX: number; targetY: number; targetRef?: string | null; reward: number }[];
  cancelBountyIds?: string[];
  queueBuildings?: { type: string }[];
}

export interface Tile {
  x: number;
  y: number;
  state: 'unseen' | 'stale' | 'visible';
  terrain?: string;
  danger_level?: number;
  resource_type?: string | null;
  feature?: string | null;
  feature_state?: string | null;
}

export interface Building {
  id: string;
  type: string;
  level: number;
  build_progress_rounds_left: number;
  status: string;
  tile_x: number;
  tile_y: number;
}

export interface Worker {
  id: string;
  type: string;
  level: number;
  hp: number;
  max_hp: number;
  state: string;
  tile_x: number;
  tile_y: number;
}

export interface Hero {
  id: string;
  name: string;
  class: string;
  level: number;
  xp: number;
  hp: number;
  max_hp: number;
  attack: number;
  tile_x: number;
  tile_y: number;
  state: string;
  marshal_active: number;
  current_quest_id: string | null;
  recovery_rounds_left: number;
}

export interface Quest {
  id: string;
  type: string;
  difficulty: number;
  current_node: string;
  status: string;
}

export interface QuestOutcome {
  heroHpAfter: number;
  goldGained: number;
  xpGained: number;
  nextNodeIndex: number;
  status: 'active' | 'completed' | 'failed_defeated' | 'failed_fled';
  message: string;
}

export interface KingdomPublic {
  kingdomId: string;
  playerName: string;
  isMine: boolean;
  capital: { x: number; y: number };
  treasury?: number;
  taxRate?: number;
  alertLevel?: string;
  buildings: Building[];
  workers: Worker[];
  hero: Hero | null;
  score: number;
}

export interface EventRow {
  id: string;
  round_number: number;
  player_id: string | null;
  type: string;
  message: string;
}

export interface Bounty {
  id: string;
  posted_by_kingdom_id: string;
  type: string;
  target_tile_x: number;
  target_tile_y: number;
  reward: number;
  status: string;
}

export interface Threat {
  id: string;
  type: string;
  power: number;
  tile_x: number;
  tile_y: number;
  state: string;
}

export interface GameStateResponse {
  game: { id: string; name: string; status: string; roundNumber: number; roundDeadlineAt: number | null; mapSize: number };
  me: { playerId: string; playerName: string; kingdomId: string };
  players: { name: string; confirmed: boolean; isMe: boolean }[];
  map: Tile[];
  kingdoms: KingdomPublic[];
  bounties: Bounty[];
  threats: Threat[];
  events: EventRow[];
}
