export interface SavedSession {
  gameId: string;
  gameName: string;
  token: string;
  playerName: string;
}

const KEY = 'so_sessions';
const ACTIVE_KEY = 'so_active_game_id';

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
