// D1 wrapper around the pure round-resolution engine — DESIGN.md §9/§13.
// Loads a game's full state, hands it to resolveRoundPure, writes the result
// back, refreshes fog of war, and fires Discord notifications.

import { repo } from './repo';
import { resolveRoundPure, type RoundState } from './roundEngine';
import { exploredSet } from './fog';
import { rngFromSeed } from './rng';
import { refreshVisibility } from './visibilityService';
import { postDiscord } from './discord';
import { newId, nowSeconds } from './ids';
import type { Env, TileRow } from './types';

async function loadRoundState(db: D1Database, gameId: string): Promise<RoundState> {
  const game = await repo.getGame(db, gameId);
  if (!game) throw new Error('game not found');
  const [kingdoms, buildings, workers, bounties, heroes, tiles, threats] = await Promise.all([
    repo.listKingdoms(db, gameId),
    repo.listBuildingsForGame(db, gameId),
    repo.listWorkersForGame(db, gameId),
    repo.listBounties(db, gameId),
    repo.listHeroesForGame(db, gameId),
    repo.listTiles(db, gameId),
    repo.listThreats(db, gameId),
  ]);

  const exploredByKingdom = new Map<string, Set<string>>();
  for (const k of kingdoms) {
    const vis = await repo.listVisibility(db, gameId, k.player_id);
    exploredByKingdom.set(k.id, exploredSet(vis));
  }

  return { game, kingdoms, buildings, workers, bounties, heroes, tiles, threats, exploredByKingdom };
}

export async function resolveRound(db: D1Database, env: Env, gameId: string): Promise<void> {
  const game = await repo.getGame(db, gameId);
  if (!game || game.status !== 'active' || game.resolving) return;

  await repo.setResolving(db, gameId, true);
  try {
    const before = await loadRoundState(db, gameId);
    const rng = rngFromSeed(`${before.game.map_seed}:round:${before.game.round_number}`);
    const result = resolveRoundPure(before, rng, null);

    const beforeKingdomIds = new Set(before.kingdoms.map((k) => k.id));
    for (const k of result.kingdoms) {
      if (beforeKingdomIds.has(k.id)) await repo.updateKingdom(db, k);
    }

    const beforeBuildingIds = new Set(before.buildings.map((b) => b.id));
    for (const b of result.buildings) {
      if (beforeBuildingIds.has(b.id)) await repo.updateBuilding(db, b);
    }

    const beforeWorkerIds = new Set(before.workers.map((w) => w.id));
    for (const w of result.workers) {
      if (beforeWorkerIds.has(w.id)) await repo.updateWorker(db, w);
      else await repo.insertWorker(db, w);
    }

    const beforeBountyIds = new Set(before.bounties.map((b) => b.id));
    for (const b of result.bounties) {
      if (beforeBountyIds.has(b.id)) await repo.updateBounty(db, b);
      else await repo.insertBounty(db, b);
    }

    for (const h of result.heroes) await repo.updateHero(db, h);

    const beforeTileByKey = new Map(before.tiles.map((t) => [`${t.x},${t.y}`, t]));
    for (const t of result.tiles) {
      const prev = beforeTileByKey.get(`${t.x},${t.y}`);
      if (prev && (prev.feature_state !== t.feature_state || prev.feature_cleared_round !== t.feature_cleared_round)) {
        await repo.updateTile(db, t as TileRow);
      }
    }

    const beforeThreatIds = new Set(before.threats.map((t) => t.id));
    for (const t of result.threats) {
      if (beforeThreatIds.has(t.id)) await repo.updateThreat(db, t);
      else await repo.insertThreat(db, t);
    }

    const eventRoundNumber = before.game.round_number;
    for (const e of result.events) {
      await repo.insertEvent(db, { id: newId('event'), game_id: gameId, round_number: eventRoundNumber, player_id: e.player_id, type: e.type, message: e.message, created_at: nowSeconds() });
    }

    await repo.resetAllConfirmed(db, gameId);
    const deadlineAt = nowSeconds() + before.game.round_timeout_hours * 3600;
    await repo.advanceRound(db, gameId, result.nextRoundNumber, deadlineAt);

    // Refresh fog of war for every player now that units have moved.
    const players = await repo.listPlayers(db, gameId);
    for (const player of players) {
      const kingdom = result.kingdoms.find((k) => k.player_id === player.id);
      if (!kingdom) continue;
      const hero = result.heroes.find((h) => h.kingdom_id === kingdom.id) ?? null;
      const kingdomWorkers = result.workers.filter((w) => w.kingdom_id === kingdom.id);
      await refreshVisibility(db, gameId, before.game.map_size, player.id, kingdom, hero, kingdomWorkers);
    }

    // Discord: per-player relevant events, plus the round summary to everyone.
    const summary = `**Round ${result.nextRoundNumber}** has begun in *${before.game.name}*.`;
    for (const player of players) {
      const personal = result.events.filter((e) => e.player_id === player.id || e.player_id === null);
      if (personal.length === 0) continue;
      const lines = personal.filter((e) => e.type !== 'round_resolved').map((e) => `- ${e.message}`);
      const content = lines.length > 0 ? `${summary}\n${lines.join('\n')}` : summary;
      await postDiscord(player.discord_webhook_url, content);
    }
    if (env.DISCORD_DEFAULT_WEBHOOK) {
      const dragon = result.events.find((e) => e.type === 'dragon_slain');
      if (dragon) await postDiscord(env.DISCORD_DEFAULT_WEBHOOK, `🐉 ${dragon.message}`);
    }
  } finally {
    await repo.setResolving(db, gameId, false);
  }
}

/** Called from confirm handler: resolve now if everyone's confirmed. */
export async function maybeResolveIfAllConfirmed(db: D1Database, env: Env, gameId: string): Promise<boolean> {
  const players = await repo.listPlayers(db, gameId);
  if (players.length === 0) return false;
  if (!players.every((p) => p.confirmed_this_round)) return false;
  await resolveRound(db, env, gameId);
  return true;
}

/** Called from the cron backstop: force-resolve any active game whose deadline has passed. */
export async function resolvePastDeadlineGames(db: D1Database, env: Env): Promise<number> {
  const games = await repo.listActiveGamesPastDeadline(db, nowSeconds());
  for (const g of games) await resolveRound(db, env, g.id);
  return games.length;
}
