// Game creation and the fog-of-war-filtered state view — DESIGN.md §12 GET/POST /games.

import { repo } from './repo';
import { generateMap } from './map';
import { newId, nowSeconds } from './ids';
import { visStateOf } from './fog';
import { refreshVisibility } from './visibilityService';
import { kingdomScore } from './scoreboard';
import {
  MAP_SIZE,
  STARTING_TREASURY,
  HERO_START_HP,
  HERO_START_ATTACK,
  ROUND_TIMEOUT_HOURS_DEFAULT,
} from './constants';
import type { GameRow, PlayerRow, KingdomRow, BuildingRow, HeroRow } from './types';

export interface CreateGameInput {
  name: string;
  players: { name: string; discordWebhookUrl?: string }[];
  roundTimeoutHours?: number;
}

export interface CreateGameResultPlayer {
  name: string;
  token: string;
}

export async function createGame(db: D1Database, input: CreateGameInput): Promise<{ gameId: string; players: CreateGameResultPlayer[] }> {
  if (!input.name || input.name.trim().length === 0) throw new Error('name is required');
  if (!Array.isArray(input.players) || input.players.length < 2 || input.players.length > 4) {
    throw new Error('players must be an array of 2-4 entries');
  }

  const gameId = newId('game');
  const seed = crypto.randomUUID();
  const size = MAP_SIZE;
  const generated = generateMap(gameId, seed, size, input.players.length);
  const timeoutHours = input.roundTimeoutHours ?? ROUND_TIMEOUT_HOURS_DEFAULT;
  const now = nowSeconds();

  const game: GameRow = {
    id: gameId,
    name: input.name,
    status: 'active',
    round_number: 0,
    round_deadline_at: now + timeoutHours * 3600,
    round_timeout_hours: timeoutHours,
    map_seed: seed,
    map_size: size,
    resolving: 0,
    created_at: now,
  };
  await repo.insertGame(db, game);
  await repo.insertTiles(db, generated.tiles);

  const resultPlayers: CreateGameResultPlayer[] = [];

  for (let i = 0; i < input.players.length; i++) {
    const p = input.players[i];
    const token = crypto.randomUUID();
    const player: PlayerRow = {
      id: newId('player'),
      game_id: gameId,
      name: p.name,
      secret_token: token,
      discord_webhook_url: p.discordWebhookUrl ?? null,
      confirmed_this_round: 0,
      turn_order: i,
    };
    await repo.insertPlayer(db, player);

    const capital = generated.capitals[i];
    const kingdom: KingdomRow = {
      id: newId('kingdom'),
      player_id: player.id,
      treasury: STARTING_TREASURY,
      tax_rate: 0,
      alert_level: 'Normal',
      capital_x: capital.x,
      capital_y: capital.y,
    };
    await repo.insertKingdom(db, kingdom);

    const capitalBuilding: BuildingRow = {
      id: newId('building'),
      kingdom_id: kingdom.id,
      type: 'Capital',
      level: 1,
      tile_x: capital.x,
      tile_y: capital.y,
      build_progress_rounds_left: 0,
      status: 'active',
    };
    await repo.insertBuilding(db, capitalBuilding);

    const hero: HeroRow = {
      id: newId('hero'),
      kingdom_id: kingdom.id,
      name: `${p.name}'s Hero`,
      class: 'Warrior',
      level: 1,
      xp: 0,
      hp: HERO_START_HP,
      max_hp: HERO_START_HP,
      attack: HERO_START_ATTACK,
      tile_x: capital.x,
      tile_y: capital.y,
      state: 'AtCapital',
      marshal_active: 0,
      current_quest_id: null,
      recovery_rounds_left: 0,
    };
    await repo.insertHero(db, hero);

    await refreshVisibility(db, gameId, size, player.id, kingdom, hero, []);

    resultPlayers.push({ name: p.name, token });
  }

  return { gameId, players: resultPlayers };
}

export async function getFullState(db: D1Database, gameId: string, token: string) {
  const game = await repo.getGame(db, gameId);
  if (!game) return null;
  const player = await repo.getPlayerByToken(db, gameId, token);
  if (!player) return null;

  const [kingdoms, buildings, workers, bounties, heroes, tiles, threats, players, visibility] = await Promise.all([
    repo.listKingdoms(db, gameId),
    repo.listBuildingsForGame(db, gameId),
    repo.listWorkersForGame(db, gameId),
    repo.listBounties(db, gameId),
    repo.listHeroesForGame(db, gameId),
    repo.listTiles(db, gameId),
    repo.listThreats(db, gameId),
    repo.listPlayers(db, gameId),
    repo.listVisibility(db, gameId, player.id),
  ]);

  const myKingdom = kingdoms.find((k) => k.player_id === player.id)!;
  const visByKey = new Map(visibility.map((v) => [`${v.x},${v.y}`, v.state]));

  const mapTiles = tiles.map((t) => {
    const state = visByKey.get(`${t.x},${t.y}`) ?? 'unseen';
    if (state === 'unseen') return { x: t.x, y: t.y, state };
    return { x: t.x, y: t.y, state, terrain: t.terrain, danger_level: t.danger_level, resource_type: t.resource_type, feature: t.feature, feature_state: t.feature_state };
  });

  const visibleThreats = threats.filter((t) => visStateOf(visibility, t.tile_x, t.tile_y) === 'visible');

  const kingdomsPublic = kingdoms.map((k) => {
    const owner = players.find((p) => p.id === k.player_id)!;
    const isMine = k.id === myKingdom.id;
    const kBuildings = buildings.filter((b) => b.kingdom_id === k.id);
    const kWorkers = workers.filter((w) => w.kingdom_id === k.id);
    const hero = heroes.find((h) => h.kingdom_id === k.id) ?? null;
    return {
      kingdomId: k.id,
      playerName: owner.name,
      isMine,
      capital: { x: k.capital_x, y: k.capital_y },
      treasury: isMine ? k.treasury : undefined,
      taxRate: isMine ? k.tax_rate : undefined,
      alertLevel: isMine ? k.alert_level : undefined,
      buildings: isMine ? kBuildings : kBuildings.filter((b) => visStateOf(visibility, b.tile_x, b.tile_y) === 'visible'),
      workers: isMine ? kWorkers : kWorkers.filter((w) => visStateOf(visibility, w.tile_x, w.tile_y) === 'visible'),
      hero: isMine ? hero : hero && visStateOf(visibility, hero.tile_x, hero.tile_y) === 'visible' ? hero : null,
      score: kingdomScore(k, kBuildings, hero ?? undefined),
    };
  });

  const explored = new Set(visibility.filter((v) => v.state !== 'unseen').map((v) => `${v.x},${v.y}`));
  const visibleBounties = bounties.filter((b) => explored.has(`${b.target_tile_x},${b.target_tile_y}`) && b.status !== 'Expired');

  const sinceRound = Math.max(0, game.round_number - 5);
  const events = await repo.listEventsSince(db, gameId, player.id, sinceRound);

  return {
    game: { id: game.id, name: game.name, status: game.status, roundNumber: game.round_number, roundDeadlineAt: game.round_deadline_at, mapSize: game.map_size },
    me: { playerId: player.id, playerName: player.name, kingdomId: myKingdom.id },
    players: players.map((p) => ({ name: p.name, confirmed: !!p.confirmed_this_round, isMe: p.id === player.id })),
    map: mapTiles,
    kingdoms: kingdomsPublic,
    bounties: visibleBounties,
    threats: visibleThreats,
    events,
  };
}
