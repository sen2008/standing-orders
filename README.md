# Standing Orders

An async, mostly-indirect-control kingdom game for 2-4 friends — see [`DESIGN.md`](./DESIGN.md) for the full design (mechanics, data model, API, balance constants).

- **Frontend** (`frontend/`): static site, Vite + TypeScript, deployed to GitHub Pages.
- **Backend** (`worker/`): Cloudflare Worker (Hono) + D1, deployed via Wrangler.

## Status

Scaffolded, not yet playable. Build order tracked in DESIGN.md §14 (MVP Scope).

## One-time setup (not automatable from here — needs your accounts)

1. **Cloudflare D1**: `cd worker && npx wrangler d1 create standing-orders`, then paste the returned `database_id` into `worker/wrangler.toml`.
2. **Run the schema**: `npm run db:migrate:local` (local dev) and `npm run db:migrate:remote` (production) from `worker/`.
3. **GitHub Pages**: repo Settings → Pages → Source → "GitHub Actions" (the `deploy-pages.yml` workflow handles the rest on every push to `master` that touches `frontend/`).
4. **Cloudflare Worker deploy from CI**: repo Settings → Secrets and variables → Actions, add `CLOUDFLARE_API_TOKEN` (a token with Workers/D1 edit permissions) and `CLOUDFLARE_ACCOUNT_ID`.
5. **Discord notifications** (optional): each player supplies their own webhook URL at game-creation time (stored per-player, not a repo secret) — see DESIGN.md §10.

## Local dev

```
cd worker && npm install && npm run dev      # API on localhost, wrangler dev
cd frontend && npm install && npm run dev    # frontend on localhost, vite dev
```
