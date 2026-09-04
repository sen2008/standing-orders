// Hero move/marshal/quest handlers — DESIGN.md §6. Not round-gated: these
// resolve immediately, any time, independent of the round-confirm cycle.

import { repo } from './repo';
import { newId, nowSeconds } from './ids';
import { stepToward } from './geometry';
import { rngFromSeed } from './rng';
import { questStep, type QuestAction } from './heroEngine';
import { questScriptForKey } from './questScripts';
import { questTypeForFeature } from './map';
import { refreshVisibility } from './visibilityService';
import { postDiscord } from './discord';
import {
  MOVE_SPEED_TILES_PER_ROUND,
  XP_PER_LEVEL,
  HERO_HP_PER_LEVEL,
  HERO_ATTACK_PER_LEVEL,
  heroRecoveryRounds,
} from './constants';
import type { Env } from './types';

async function loadHeroContext(db: D1Database, gameId: string, token: string, heroId: string) {
  const game = await repo.getGame(db, gameId);
  if (!game) return { error: 'game not found' as const };
  const player = await repo.getPlayerByToken(db, gameId, token);
  if (!player) return { error: 'invalid token' as const };
  const kingdom = await repo.getKingdomByPlayer(db, player.id);
  if (!kingdom) return { error: 'kingdom not found' as const };
  const hero = await repo.getHero(db, heroId);
  if (!hero || hero.kingdom_id !== kingdom.id) return { error: 'hero not found for this player' as const };
  return { game, player, kingdom, hero };
}

export async function moveHero(db: D1Database, gameId: string, token: string, heroId: string, targetX: number, targetY: number) {
  const ctx = await loadHeroContext(db, gameId, token, heroId);
  if ('error' in ctx) return ctx;
  const { game, player, kingdom, hero } = ctx;

  if (hero.state !== 'AtCapital' && hero.state !== 'Exploring') {
    return { error: `hero cannot move while ${hero.state}` as const };
  }

  const size = game.map_size;
  const clampedX = Math.min(size - 1, Math.max(0, targetX));
  const clampedY = Math.min(size - 1, Math.max(0, targetY));
  const next = stepToward(hero.tile_x, hero.tile_y, clampedX, clampedY, MOVE_SPEED_TILES_PER_ROUND);

  hero.tile_x = next.x;
  hero.tile_y = next.y;
  hero.state = next.x === kingdom.capital_x && next.y === kingdom.capital_y ? 'AtCapital' : 'Exploring';
  await repo.updateHero(db, hero);

  const workers = (await repo.listWorkersForGame(db, gameId)).filter((w) => w.kingdom_id === kingdom.id);
  await refreshVisibility(db, gameId, size, player.id, kingdom, hero, workers);

  const tile = await repo.getTile(db, gameId, hero.tile_x, hero.tile_y);
  const canStartQuest = !!(tile?.feature && tile.feature_state === 'active');

  return { hero, tile, canStartQuest };
}

export async function toggleMarshal(db: D1Database, gameId: string, token: string, heroId: string, active: boolean) {
  const ctx = await loadHeroContext(db, gameId, token, heroId);
  if ('error' in ctx) return ctx;
  const { hero } = ctx;
  if (hero.state !== 'AtCapital' && hero.state !== 'Exploring') {
    return { error: `cannot toggle marshal while ${hero.state}` as const };
  }
  hero.marshal_active = active ? 1 : 0;
  await repo.updateHero(db, hero);
  return { hero };
}

export async function startQuest(db: D1Database, gameId: string, token: string, heroId: string) {
  const ctx = await loadHeroContext(db, gameId, token, heroId);
  if ('error' in ctx) return ctx;
  const { hero } = ctx;

  if (hero.state !== 'AtCapital' && hero.state !== 'Exploring') {
    return { error: `hero cannot start a quest while ${hero.state}` as const };
  }
  const tile = await repo.getTile(db, gameId, hero.tile_x, hero.tile_y);
  if (!tile?.feature || tile.feature_state !== 'active') {
    return { error: 'no active quest feature at hero location' as const };
  }
  const key = questTypeForFeature(tile.feature);
  const script = key ? questScriptForKey(key) : undefined;
  if (!script) return { error: 'no quest script for this feature' as const };

  const quest = {
    id: newId('quest'),
    hero_id: hero.id,
    type: script.type,
    difficulty: script.difficulty,
    current_node: '0',
    status: 'active' as const,
    seed: crypto.randomUUID(),
  };
  await repo.insertQuest(db, quest);

  hero.state = 'InDungeon';
  hero.marshal_active = 0;
  hero.current_quest_id = quest.id;
  await repo.updateHero(db, hero);

  return { quest, script: { name: script.name, nodes: script.nodes.map((n) => ({ id: n.id, kind: n.kind, label: n.label, isBoss: n.isBoss })) } };
}

export async function stepQuest(db: D1Database, env: Env, gameId: string, token: string, heroId: string, action: QuestAction) {
  const ctx = await loadHeroContext(db, gameId, token, heroId);
  if ('error' in ctx) return ctx;
  const { player, kingdom, hero } = ctx;

  if (hero.state !== 'InDungeon' || !hero.current_quest_id) {
    return { error: 'hero is not in an active quest' as const };
  }
  const quest = await repo.getQuest(db, hero.current_quest_id);
  if (!quest) return { error: 'quest not found' as const };
  // quest.type is 'dragon' only for the Dragon's Lair; the two 'dungeon'-type
  // scripts (Goblin Warren / Bandit Hideout) are disambiguated by difficulty.
  const resolvedScript =
    quest.type === 'dragon'
      ? questScriptForKey('dragons_lair')!
      : quest.difficulty === 1
        ? questScriptForKey('goblin_warren')!
        : questScriptForKey('bandit_hideout')!;

  const nodeIndex = parseInt(quest.current_node, 10);
  const rng = rngFromSeed(`${quest.seed}:${nodeIndex}:${crypto.randomUUID()}`);
  const outcome = questStep({ hp: hero.hp, max_hp: hero.max_hp, attack: hero.attack }, resolvedScript, nodeIndex, action, rng);

  hero.hp = outcome.heroHpAfter;
  if (outcome.goldGained > 0) {
    kingdom.treasury += outcome.goldGained;
    await repo.updateKingdom(db, kingdom);
  }
  if (outcome.xpGained > 0) {
    hero.xp += outcome.xpGained;
    const newLevel = Math.floor(hero.xp / XP_PER_LEVEL) + 1;
    if (newLevel > hero.level) {
      const levels = newLevel - hero.level;
      hero.max_hp += HERO_HP_PER_LEVEL * levels;
      hero.attack += HERO_ATTACK_PER_LEVEL * levels;
      hero.hp = Math.min(hero.max_hp, hero.hp + HERO_HP_PER_LEVEL * levels);
      hero.level = newLevel;
    }
  }

  let events: { type: string; message: string; player_id: string | null }[] = [];

  if (outcome.status === 'active') {
    quest.current_node = String(outcome.nextNodeIndex);
    await repo.updateQuest(db, quest);
  } else if (outcome.status === 'failed_fled') {
    quest.status = 'failed';
    await repo.updateQuest(db, quest);
    hero.state = 'AtCapital';
    hero.tile_x = kingdom.capital_x;
    hero.tile_y = kingdom.capital_y;
    hero.current_quest_id = null;
  } else if (outcome.status === 'failed_defeated') {
    quest.status = 'failed';
    await repo.updateQuest(db, quest);
    hero.state = 'Resting';
    hero.recovery_rounds_left = heroRecoveryRounds(quest.difficulty);
    hero.tile_x = kingdom.capital_x;
    hero.tile_y = kingdom.capital_y;
    hero.current_quest_id = null;
    events.push({ type: 'hero_defeated', message: `${hero.name} was defeated and is recovering.`, player_id: player.id });
  } else if (outcome.status === 'completed') {
    quest.status = 'completed';
    await repo.updateQuest(db, quest);
    hero.state = 'AtCapital';
    hero.tile_x = kingdom.capital_x;
    hero.tile_y = kingdom.capital_y;
    hero.current_quest_id = null;
    events.push({ type: 'hero_returned', message: `${hero.name} returned victorious from ${resolvedScript.name}.`, player_id: player.id });
    if (quest.type === 'dragon') {
      const tile = (await repo.listTiles(db, gameId)).find((t) => t.feature === 'dragon_lair');
      if (tile) {
        tile.feature_state = 'cleared';
        tile.feature_cleared_round = (await repo.getGame(db, gameId))!.round_number;
        await repo.updateTile(db, tile);
      }
      events.push({ type: 'dragon_slain', message: `${hero.name} has slain the dragon!`, player_id: null });
    }
  }

  await repo.updateHero(db, hero);

  const now = nowSeconds();
  const game = await repo.getGame(db, gameId);
  for (const e of events) {
    await repo.insertEvent(db, { id: newId('event'), game_id: gameId, round_number: game?.round_number ?? 0, player_id: e.player_id, type: e.type, message: e.message, created_at: now });
  }

  if (events.some((e) => e.type === 'dragon_slain')) {
    const players = await repo.listPlayers(db, gameId);
    for (const p of players) await postDiscord(p.discord_webhook_url, `🐉 ${hero.name} has slain the dragon!`);
    if (env.DISCORD_DEFAULT_WEBHOOK) await postDiscord(env.DISCORD_DEFAULT_WEBHOOK, `🐉 ${hero.name} has slain the dragon!`);
  } else if (events.length > 0) {
    await postDiscord(player.discord_webhook_url, events.map((e) => e.message).join('\n'));
  }

  return { hero, quest, outcome };
}
