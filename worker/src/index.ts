import { Hono } from 'hono';
import type { Env } from './types';

// Route surface — DESIGN.md §12. Handlers are stubs; game logic lands in
// ./game/* modules (round.ts, workers.ts, heroes.ts, quests.ts, map.ts)
// as each MVP step (§14) gets built.

const app = new Hono<{ Bindings: Env }>();

app.get('/', (c) => c.text('Standing Orders API'));

app.post('/games', async (c) => {
  // create game: name, player names, round_timeout_hours -> per-player secret links
  return c.json({ error: 'not implemented' }, 501);
});

app.get('/games/:id/state', async (c) => {
  // token-authed: fog-of-war-filtered state, own kingdom, visible rivals, open bounties, events since last-seen, scoreboard
  return c.json({ error: 'not implemented' }, 501);
});

app.post('/games/:id/orders', async (c) => {
  // token-authed: upsert this round's bounty create/cancel, tax rate, alert level, building queue
  return c.json({ error: 'not implemented' }, 501);
});

app.post('/games/:id/confirm', async (c) => {
  // token-authed: mark ready; if last player, resolve round inline
  return c.json({ error: 'not implemented' }, 501);
});

app.get('/games/:id/events', async (c) => {
  // token-authed: event log page since_round
  return c.json({ error: 'not implemented' }, 501);
});

app.post('/games/:id/heroes/:heroId/move', async (c) => {
  return c.json({ error: 'not implemented' }, 501);
});

app.post('/games/:id/heroes/:heroId/marshal', async (c) => {
  return c.json({ error: 'not implemented' }, 501);
});

app.post('/games/:id/heroes/:heroId/quest/start', async (c) => {
  return c.json({ error: 'not implemented' }, 501);
});

app.post('/games/:id/heroes/:heroId/quest/step', async (c) => {
  return c.json({ error: 'not implemented' }, 501);
});

export default {
  fetch: app.fetch,
  // Cron backstop — DESIGN.md §13: force-resolve any active game past round_deadline_at.
  async scheduled(_event: ScheduledEvent, _env: Env, _ctx: ExecutionContext) {
    // TODO: SELECT games WHERE status = 'active' AND round_deadline_at < now, resolve each.
  },
};
