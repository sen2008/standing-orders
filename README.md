# Standing Orders

An async, mostly-indirect-control kingdom game for 2-4 friends — see [`DESIGN.md`](./DESIGN.md) for the full design (mechanics, data model, API, balance constants).

- **Frontend** (`frontend/`): static site, Vite + TypeScript, deployed to GitHub Pages.
- **Backend** (`worker/`): Cloudflare Worker (Hono) + D1, deployed via Wrangler.

## Status

Backend implements the full MVP scope from DESIGN.md §14 (map gen, rounds, workers/bounties, heroes/quests, fog of war, events/Discord, policy, threats, scoreboard), with a unit-tested pure engine plus a working frontend against it. D1 is provisioned and the Worker has been deployed once already, live at `api.standingorders.lucaswalker.net`. Remaining before it's fully turnkey: `SITE_PASSWORD` needs to be set (see below) and GitHub Pages needs to be pointed at the `deploy-pages.yml` workflow output.

## One-time setup

1. ~~**Cloudflare D1**~~ — done. `worker/wrangler.toml` already has the real `database_id`. Re-run `npm run db:migrate:remote` from `worker/` only if the schema changes.
2. **Site password**: `cd worker && npx wrangler secret put SITE_PASSWORD` — gates `POST /games` (game *creation* only; per-player access is still just the secret link, DESIGN.md §12) so randos can't spam the public Worker URL. For local dev, copy `worker/.dev.vars.example` to `worker/.dev.vars` and set your own value there instead (never commit `.dev.vars`).
3. **GitHub Pages**: repo Settings → Pages → Source → "GitHub Actions" (the `deploy-pages.yml` workflow handles the rest on every push to `master` that touches `frontend/`).
4. **Cloudflare Worker deploy from CI** (optional — deploys have so far been run manually): repo Settings → Secrets and variables → Actions, add `CLOUDFLARE_API_TOKEN` (a token with Workers/D1 edit permissions) and `CLOUDFLARE_ACCOUNT_ID`.
5. **Discord notifications** (optional): each player supplies their own webhook URL at game-creation time (stored per-player, not a repo secret) — see DESIGN.md §10.
6. **Frontend API URL**: the frontend defaults to `http://localhost:8787`; point it at the real Worker from the "API server" box on the setup screen (stored in the browser's localStorage, not hardcoded) — set it to `https://api.standingorders.lucaswalker.net` once deployed.

## Local dev

```
cd worker && npm install && npm run dev      # API on localhost, wrangler dev
cd frontend && npm install && npm run dev    # frontend on localhost, vite dev
```
