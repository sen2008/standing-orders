export interface SavedSession {
  gameId: string;
  gameName: string;
  token: string;
  playerName: string;
}

export interface CreatedGame {
  gameId: string;
  gameName: string;
  createdAt: number;
  players: { name: string; token: string }[];
}

const KEY = 'so_sessions';
const ACTIVE_KEY = 'so_active_game_id';
const CREATED_KEY = 'so_created_games';

export function listSessions(): SavedSession[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '[]');
  } catch {
    return [];
  }
}

export function saveSession(s: SavedSession) {
  const sessions = listSessions().filter((x) => x.gameId !== s.gameId);
  sessions.push(s);
  localStorage.setItem(KEY, JSON.stringify(sessions));
  localStorage.setItem(ACTIVE_KEY, s.gameId);
}

export function getSession(gameId: string): SavedSession | undefined {
  return listSessions().find((s) => s.gameId === gameId);
}

export function getActiveSession(): SavedSession | undefined {
  const id = localStorage.getItem(ACTIVE_KEY);
  if (!id) return undefined;
  return getSession(id);
}

export function setActiveGameId(gameId: string) {
  localStorage.setItem(ACTIVE_KEY, gameId);
}

export function clearActiveSession() {
  localStorage.removeItem(ACTIVE_KEY);
}

// Every player's invite link, kept on the creating browser so the person who
// ran "Create a new game" can always get back to them to (re)send to
// friends — the one-time reveal screen isn't the only place these live.
export function saveCreatedGame(g: CreatedGame) {
  const games = listCreatedGames().filter((x) => x.gameId !== g.gameId);
  games.unshift(g);
  localStorage.setItem(CREATED_KEY, JSON.stringify(games));
}

export function listCreatedGames(): CreatedGame[] {
  try {
    return JSON.parse(localStorage.getItem(CREATED_KEY) ?? '[]');
  } catch {
    return [];
  }
}
