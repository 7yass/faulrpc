# faulrpc badge bridge (Vencord plugin)

Reads Discord's badge directory from inside your logged-in Discord client and pushes it to faulrpc. This is the same data Haunt reads, and it does not require pasting a user token anywhere — Vencord's `RestAPI` uses the live session.

## Install

1. Copy this folder into Vencord's user plugins directory:
   - Vencord Desktop: `%appdata%\Vencord\userplugins\faulrpc-badges\`
   - `vencord/userplugins/faulrpc-badges/` for a source install.
2. Fully restart Discord (required for `native.ts` to load).
3. In Vencord settings → Plugins → **faulrpc badge bridge**, enable it and set:
   - **faulrpc base URL** — e.g. `https://your-faulrpc-host` or `http://localhost:4555`
   - **BADGE_PUSH_KEY** — the same value as `BADGE_PUSH_KEY` in the bot's `.env`
   - **Discord user id** — default is `1270782781605154922`
   - **sync interval** — default 60 minutes

The plugin syncs once on start and then on the interval. Logs appear in Discord's console under `FaulrpcBadges`.

## Behavior

It fetches `GET /users/{id}/badges` through `RestAPI` (authenticated as your client, so no `20001`) and POSTs the raw catalog to faulrpc's `POST /badges`. faulrpc normalizes it with the same `normalizeBadge()` used for every other source, caches it, and writes it to `data/badges.json`. When Discord closes, the last pushed catalog keeps being served — no gap in `/presence` badges. A new push invalidates the bot's 24h badge cache immediately.

Data is identical to the directory path: numeric `id`, `name`, `tier` (held tier's name), `label` (`info_label`) and the tier's CDN icon as `url`. New badges and new tiers appear without a plugin change because the raw catalog is forwarded verbatim.
