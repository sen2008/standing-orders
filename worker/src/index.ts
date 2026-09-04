import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { Env } from './types';
import { repo } from './repo';
import { createGame, getFullState } from './gameService';
import { applyOrders } from './ordersService';
import { moveHero, toggleMarshal, startQuest, stepQuest } from './heroService';
import { maybeResolveIfAllConfirmed, resolvePastDeadlineGames } from './round';

const app = new Hono<{ Bindings: Env }>();

app.use('*', cors());

app.get('/', (c) => c.text('Standing Orders API'));

function tokenFrom(c: { req: { query: (k: string) => string | undefined } }): string | undefined {
  return c.req.query('token');
}

app.post('/games', async (c) => {
  const body = await c.req.json().catch(() => null);
  if (!body) return c.json({ error: 'invalid JSON body' }, 400);
  try {
    const result = await createGame(c.env.DB, body);
    return c.json(result, 201);
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'failed to create game' }, 400);
  }
});

app.get('/games/:id/state', async (c) => {
  const token = tokenFrom(c);
  if (!token) return c.json({ error: 'token required' }, 401);
  const state = await getFullState(c.env.DB, c.req.param('id'), token);
  if (!state) return c.json({ error: 'not found' }, 404);
  return c.json(state);
});

app.post('/games/:id/orders', async (c) => {
  const token = tokenFrom(c);
  if (!token) return c.json({ error: 'token required' }, 401);
  const gameId = c.req.param('id');
  const player = await repo.getPlayerByToken(c.env.DB, gameId, token);
  if (!player) return c.json({ error: 'invalid token' }, 401);
  const kingdom = await repo.getKingdomByPlayer(c.env.DB, player.id);
  if (!kingdom) return c.json({ error: 'kingdom not found' }, 404);
  const game = await repo.getGame(c.env.DB, gameId);
  if (!game) return c.json({ error: 'game not found' }, 404);
  const body = await c.req.json().catch(() => ({}));
  const result = await applyOrders(c.env.DB, gameId, player.id, kingdom.id, game.round_number, body);
  return c.json(result);
});

app.post('/games/:id/confirm', async (c) => {
  const token = tokenFrom(c);
  if (!token) return c.json({ error: 'token required' }, 401);
  const gameId = c.req.param('id');
  const player = await repo.getPlayerByToken(c.env.DB, gameId, token);
  if (!player) return c.json({ error: 'invalid token' }, 401);
  await repo.setConfirmed(c.env.DB, player.id, true);
  const resolved = await maybeResolveIfAllConfirmed(c.env.DB, c.env, gameId);
  return c.json({ confirmed: true, roundResolved: resolved });
});

app.get('/games/:id/events', async (c) => {
  const token = tokenFrom(c);
  if (!token) return c.json({ error: 'token required' }, 401);
  const gameId = c.req.param('id');
  const player = await repo.getPlayerByToken(c.env.DB, gameId, token);
  if (!player) return c.json({ error: 'invalid token' }, 401);
  const sinceRound = Number(c.req.query('since_round') ?? '0');
  const events = await repo.listEventsSince(c.env.DB, gameId, player.id, sinceRound);
  return c.json({ events });
});

app.post('/games/:id/heroes/:heroId/move', async (c) => {
  const token = tokenFrom(c);
  if (!token) return c.json({ error: 'token required' }, 401);
  const body = await c.req.json().catch(() => ({}));
  const result = await moveHero(c.env.DB, c.req.param('id'), token, c.req.param('heroId'), Number(body.x), Number(body.y));
  if ('error' in result) return c.json(result, 400);
  return c.json(result);
});

app.post('/games/:id/heroes/:heroId/marshal', async (c) => {
  const token = tokenFrom(c);
  if (!token) return c.json({ error: 'token required' }, 401);
  const body = await c.req.json().catch(() => ({}));
  const result = await toggleMarshal(c.env.DB, c.req.param('id'), token, c.req.param('heroId'), !!body.active);
  if ('error' in result) return c.json(result, 400);
  return c.json(result);
});

app.post('/games/:id/heroes/:heroId/quest/start', async (c) => {
  const token = tokenFrom(c);
  if (!token) return c.json({ error: 'token required' }, 401);
  const result = await startQuest(c.env.DB, c.req.param('id'), token, c.req.param('heroId'));
  if ('error' in result) return c.json(result, 400);
  return c.json(result);
});

app.post('/games/:id/heroes/:heroId/quest/step', async (c) => {
  const token = tokenFrom(c);
  if (!token) return c.json({ error: 'token required' }, 401);
  const body = await c.req.json().catch(() => ({}));
  const action = body.action;
  if (action !== 'attack' && action !== 'use_item' && action !== 'flee') {
    return c.json({ error: 'action must be attack | use_item | flee' }, 400);
  }
  const result = await stepQuest(c.env.DB, c.env, c.req.param('id'), token, c.req.param('heroId'), action);
  if ('error' in result) return c.json(result, 400);
  return c.json(result);
});

export default {
  fetch: app.fetch,
  // Cron backstop — DESIGN.md §13: force-resolve any active game past round_deadline_at.
  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(resolvePastDeadlineGames(env.DB, env));
  },
};
