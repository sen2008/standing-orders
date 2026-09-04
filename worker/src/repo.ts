// D1 access layer. Thin wrappers around prepared statements — the actual game
// logic lives in the pure modules (roundEngine.ts, workerAI.ts, heroEngine.ts,
// map.ts, fog.ts) and is unit-tested there without touching D1 at all.

import type {
  Env,
  GameRow,
  PlayerRow,
  KingdomRow,
  BuildingRow,
  WorkerRow,
  BountyRow,
  HeroRow,
  QuestRow,
  TileRow,
  VisibilityRow,
  EventRow,
  ThreatRow,
} from './types';

async function all<T>(db: D1Database, sql: string, ...params: unknown[]): Promise<T[]> {
  const res = await db.prepare(sql).bind(...params).all<T>();
  return res.results ?? [];
}

async function first<T>(db: D1Database, sql: string, ...params: unknown[]): Promise<T | null> {
  return (await db.prepare(sql).bind(...params).first<T>()) ?? null;
}

async function run(db: D1Database, sql: string, ...params: unknown[]): Promise<void> {
  await db.prepare(sql).bind(...params).run();
}

export const repo = {
  // --- games -------------------------------------------------------------
  async getGame(db: D1Database, id: string) {
    return first<GameRow>(db, `SELECT * FROM games WHERE id = ?`, id);
  },
  async insertGame(db: D1Database, g: GameRow) {
    await run(
      db,
      `INSERT INTO games (id, name, status, round_number, round_deadline_at, round_timeout_hours, map_seed, map_size, resolving, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
      g.id, g.name, g.status, g.round_number, g.round_deadline_at, g.round_timeout_hours, g.map_seed, g.map_size, g.resolving, g.created_at
    );
  },
  async listActiveGamesPastDeadline(db: D1Database, now: number) {
    return all<GameRow>(db, `SELECT * FROM games WHERE status = 'active' AND round_deadline_at IS NOT NULL AND round_deadline_at < ? AND resolving = 0`, now);
  },
  async setResolving(db: D1Database, gameId: string, resolving: boolean) {
    await run(db, `UPDATE games SET resolving = ? WHERE id = ?`, resolving ? 1 : 0, gameId);
  },
  async advanceRound(db: D1Database, gameId: string, roundNumber: number, deadlineAt: number) {
    await run(db, `UPDATE games SET round_number = ?, round_deadline_at = ?, status = 'active' WHERE id = ?`, roundNumber, deadlineAt, gameId);
  },

  // --- players -------------------------------------------------------------
  async insertPlayer(db: D1Database, p: PlayerRow) {
    await run(
      db,
      `INSERT INTO players (id, game_id, name, secret_token, discord_webhook_url, confirmed_this_round, turn_order)
       VALUES (?,?,?,?,?,?,?)`,
      p.id, p.game_id, p.name, p.secret_token, p.discord_webhook_url, p.confirmed_this_round, p.turn_order
    );
  },
  async listPlayers(db: D1Database, gameId: string) {
    return all<PlayerRow>(db, `SELECT * FROM players WHERE game_id = ? ORDER BY turn_order`, gameId);
  },
  async getPlayerByToken(db: D1Database, gameId: string, token: string) {
    return first<PlayerRow>(db, `SELECT * FROM players WHERE game_id = ? AND secret_token = ?`, gameId, token);
  },
  async setConfirmed(db: D1Database, playerId: string, confirmed: boolean) {
    await run(db, `UPDATE players SET confirmed_this_round = ? WHERE id = ?`, confirmed ? 1 : 0, playerId);
  },
  async resetAllConfirmed(db: D1Database, gameId: string) {
    await run(db, `UPDATE players SET confirmed_this_round = 0 WHERE game_id = ?`, gameId);
  },

  // --- kingdoms -------------------------------------------------------------
  async insertKingdom(db: D1Database, k: KingdomRow) {
    await run(
      db,
      `INSERT INTO kingdoms (id, player_id, treasury, tax_rate, alert_level, capital_x, capital_y) VALUES (?,?,?,?,?,?,?)`,
      k.id, k.player_id, k.treasury, k.tax_rate, k.alert_level, k.capital_x, k.capital_y
    );
  },
  async listKingdoms(db: D1Database, gameId: string) {
    return all<KingdomRow>(db, `SELECT kingdoms.* FROM kingdoms JOIN players ON players.id = kingdoms.player_id WHERE players.game_id = ?`, gameId);
  },
  async getKingdomByPlayer(db: D1Database, playerId: string) {
    return first<KingdomRow>(db, `SELECT * FROM kingdoms WHERE player_id = ?`, playerId);
  },
  async updateKingdom(db: D1Database, k: KingdomRow) {
    await run(db, `UPDATE kingdoms SET treasury=?, tax_rate=?, alert_level=?, capital_x=?, capital_y=? WHERE id=?`, k.treasury, k.tax_rate, k.alert_level, k.capital_x, k.capital_y, k.id);
  },

  // --- buildings -------------------------------------------------------------
  async insertBuilding(db: D1Database, b: BuildingRow) {
    await run(
      db,
      `INSERT INTO buildings (id, kingdom_id, type, level, tile_x, tile_y, build_progress_rounds_left, status) VALUES (?,?,?,?,?,?,?,?)`,
      b.id, b.kingdom_id, b.type, b.level, b.tile_x, b.tile_y, b.build_progress_rounds_left, b.status
    );
  },
  async listBuildingsForGame(db: D1Database, gameId: string) {
    return all<BuildingRow>(
      db,
      `SELECT buildings.* FROM buildings JOIN kingdoms ON kingdoms.id = buildings.kingdom_id JOIN players ON players.id = kingdoms.player_id WHERE players.game_id = ?`,
      gameId
    );
  },
  async updateBuilding(db: D1Database, b: BuildingRow) {
    await run(db, `UPDATE buildings SET level=?, build_progress_rounds_left=?, status=? WHERE id=?`, b.level, b.build_progress_rounds_left, b.status, b.id);
  },
  async cancelBuilding(db: D1Database, buildingId: string) {
    await run(db, `DELETE FROM buildings WHERE id = ? AND status != 'active'`, buildingId);
  },

  // --- workers -------------------------------------------------------------
  async insertWorker(db: D1Database, w: WorkerRow) {
    await run(
      db,
      `INSERT INTO workers (id, kingdom_id, building_id, type, level, xp, hp, max_hp, bravery, greed, diligence, state, current_bounty_id, tile_x, tile_y)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      w.id, w.kingdom_id, w.building_id, w.type, w.level, w.xp, w.hp, w.max_hp, w.bravery, w.greed, w.diligence, w.state, w.current_bounty_id, w.tile_x, w.tile_y
    );
  },
  async listWorkersForGame(db: D1Database, gameId: string) {
    return all<WorkerRow>(
      db,
      `SELECT workers.* FROM workers JOIN kingdoms ON kingdoms.id = workers.kingdom_id JOIN players ON players.id = kingdoms.player_id WHERE players.game_id = ?`,
      gameId
    );
  },
  async updateWorker(db: D1Database, w: WorkerRow) {
    await run(
      db,
      `UPDATE workers SET level=?, xp=?, hp=?, state=?, current_bounty_id=?, tile_x=?, tile_y=? WHERE id=?`,
      w.level, w.xp, w.hp, w.state, w.current_bounty_id, w.tile_x, w.tile_y, w.id
    );
  },

  // --- bounties -------------------------------------------------------------
  async insertBounty(db: D1Database, b: BountyRow) {
    await run(
      db,
      `INSERT INTO bounties (id, game_id, posted_by_kingdom_id, type, target_tile_x, target_tile_y, target_ref, reward, status, claimed_by_worker_id, posted_round, expires_round)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      b.id, b.game_id, b.posted_by_kingdom_id, b.type, b.target_tile_x, b.target_tile_y, b.target_ref, b.reward, b.status, b.claimed_by_worker_id, b.posted_round, b.expires_round
    );
  },
  async listBounties(db: D1Database, gameId: string) {
    return all<BountyRow>(db, `SELECT * FROM bounties WHERE game_id = ?`, gameId);
  },
  async updateBounty(db: D1Database, b: BountyRow) {
    await run(db, `UPDATE bounties SET status=?, claimed_by_worker_id=? WHERE id=?`, b.status, b.claimed_by_worker_id, b.id);
  },
  async cancelOpenBounty(db: D1Database, bountyId: string) {
    await run(db, `DELETE FROM bounties WHERE id = ? AND status = 'Open'`, bountyId);
  },

  // --- heroes -------------------------------------------------------------
  async insertHero(db: D1Database, h: HeroRow) {
    await run(
      db,
      `INSERT INTO heroes (id, kingdom_id, name, class, level, xp, hp, max_hp, attack, tile_x, tile_y, state, marshal_active, current_quest_id, recovery_rounds_left)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      h.id, h.kingdom_id, h.name, h.class, h.level, h.xp, h.hp, h.max_hp, h.attack, h.tile_x, h.tile_y, h.state, h.marshal_active, h.current_quest_id, h.recovery_rounds_left
    );
  },
  async listHeroesForGame(db: D1Database, gameId: string) {
    return all<HeroRow>(
      db,
      `SELECT heroes.* FROM heroes JOIN kingdoms ON kingdoms.id = heroes.kingdom_id JOIN players ON players.id = kingdoms.player_id WHERE players.game_id = ?`,
      gameId
    );
  },
  async getHeroByKingdom(db: D1Database, kingdomId: string) {
    return first<HeroRow>(db, `SELECT * FROM heroes WHERE kingdom_id = ?`, kingdomId);
  },
  async getHero(db: D1Database, id: string) {
    return first<HeroRow>(db, `SELECT * FROM heroes WHERE id = ?`, id);
  },
  async updateHero(db: D1Database, h: HeroRow) {
    await run(
      db,
      `UPDATE heroes SET level=?, xp=?, hp=?, max_hp=?, attack=?, tile_x=?, tile_y=?, state=?, marshal_active=?, current_quest_id=?, recovery_rounds_left=? WHERE id=?`,
      h.level, h.xp, h.hp, h.max_hp, h.attack, h.tile_x, h.tile_y, h.state, h.marshal_active, h.current_quest_id, h.recovery_rounds_left, h.id
    );
  },

  // --- quests -------------------------------------------------------------
  async insertQuest(db: D1Database, q: QuestRow) {
    await run(
      db,
      `INSERT INTO quests (id, hero_id, type, difficulty, current_node, status, seed) VALUES (?,?,?,?,?,?,?)`,
      q.id, q.hero_id, q.type, q.difficulty, q.current_node, q.status, q.seed
    );
  },
  async getQuest(db: D1Database, id: string) {
    return first<QuestRow>(db, `SELECT * FROM quests WHERE id = ?`, id);
  },
  async updateQuest(db: D1Database, q: QuestRow) {
    await run(db, `UPDATE quests SET current_node=?, status=? WHERE id=?`, q.current_node, q.status, q.id);
  },

  // --- tiles -------------------------------------------------------------
  async insertTiles(db: D1Database, tiles: TileRow[]) {
    const stmt = db.prepare(
      `INSERT INTO tiles (game_id, x, y, terrain, danger_level, resource_type, feature, feature_state, feature_cleared_round) VALUES (?,?,?,?,?,?,?,?,?)`
    );
    await db.batch(tiles.map((t) => stmt.bind(t.game_id, t.x, t.y, t.terrain, t.danger_level, t.resource_type, t.feature, t.feature_state, t.feature_cleared_round)));
  },
  async listTiles(db: D1Database, gameId: string) {
    return all<TileRow>(db, `SELECT * FROM tiles WHERE game_id = ?`, gameId);
  },
  async getTile(db: D1Database, gameId: string, x: number, y: number) {
    return first<TileRow>(db, `SELECT * FROM tiles WHERE game_id = ? AND x = ? AND y = ?`, gameId, x, y);
  },
  async updateTile(db: D1Database, t: TileRow) {
    await run(db, `UPDATE tiles SET feature_state=?, feature_cleared_round=? WHERE game_id=? AND x=? AND y=?`, t.feature_state, t.feature_cleared_round, t.game_id, t.x, t.y);
  },

  // --- visibility -------------------------------------------------------------
  async listVisibility(db: D1Database, gameId: string, playerId: string) {
    return all<VisibilityRow>(db, `SELECT * FROM visibility WHERE game_id = ? AND player_id = ?`, gameId, playerId);
  },
  async replaceVisibility(db: D1Database, gameId: string, playerId: string, rows: VisibilityRow[]) {
    await run(db, `DELETE FROM visibility WHERE game_id = ? AND player_id = ?`, gameId, playerId);
    if (rows.length === 0) return;
    const stmt = db.prepare(`INSERT INTO visibility (game_id, player_id, x, y, state) VALUES (?,?,?,?,?)`);
    await db.batch(rows.map((r) => stmt.bind(r.game_id, r.player_id, r.x, r.y, r.state)));
  },

  // --- events -------------------------------------------------------------
  async insertEvent(db: D1Database, e: EventRow) {
    await run(db, `INSERT INTO events (id, game_id, round_number, player_id, type, message, created_at) VALUES (?,?,?,?,?,?,?)`, e.id, e.game_id, e.round_number, e.player_id, e.type, e.message, e.created_at);
  },
  async listEventsSince(db: D1Database, gameId: string, playerId: string, sinceRound: number) {
    return all<EventRow>(
      db,
      `SELECT * FROM events WHERE game_id = ? AND round_number >= ? AND (player_id IS NULL OR player_id = ?) ORDER BY round_number, created_at`,
      gameId, sinceRound, playerId
    );
  },

  // --- threats -------------------------------------------------------------
  async listThreats(db: D1Database, gameId: string) {
    return all<ThreatRow>(db, `SELECT * FROM threats WHERE game_id = ?`, gameId);
  },
  async insertThreat(db: D1Database, t: ThreatRow) {
    await run(db, `INSERT INTO threats (id, game_id, type, power, tile_x, tile_y, state) VALUES (?,?,?,?,?,?,?)`, t.id, t.game_id, t.type, t.power, t.tile_x, t.tile_y, t.state);
  },
  async updateThreat(db: D1Database, t: ThreatRow) {
    await run(db, `UPDATE threats SET power=?, tile_x=?, tile_y=?, state=? WHERE id=?`, t.power, t.tile_x, t.tile_y, t.state, t.id);
  },
};

export type Repo = typeof repo;
export type { Env };
