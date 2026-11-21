# faulrpc badge bridge (Vencord user plugin)

Reads Discord's badge directory from inside your logged-in Discord client and pushes it to faulrpc. This is the same data Haunt reads, and it does not require pasting a user token anywhere — Vencord's `RestAPI` uses the live session.

## Install

Userplugins only load from a **Vencord source install** — the standalone installer build cannot load them. If you have the installer build, switch to a source install first (`git clone`, `pnpm build`, `pnpm inject`).

1. Copy this folder into the Vencord source tree as:
   ```
   <vencord>/src/userplugins/faulrpcBadges/
   ```
   (rename from `faulrpc-badges` to camelCase — some Vencord versions reject hyphenated plugin folders).
2. Rebuild Vencord from its root: `pnpm build`.
3. Fully restart Discord.
4. In Vencord settings → Plugins → **faulrpc badge bridge**, enable it and set:
   - **faulrpc base URL** — default `https://faul.wisp.uno`
   - **BADGE_PUSH_KEY** — same value as `BADGE_PUSH_KEY` in the bot's `.env`
   - **Discord user id** — default `1270782781605154922`
   - **sync interval** — default 60 minutes

If `native.ts` was not compiled (web build, or no source rebuild), the plugin automatically falls back to a normal `fetch` POST — the bot allows the required CORS headers.

## Verify

- Discord console: `FaulrpcBadges starting ...` then `synced N badge entry/entries`. A missing key or empty catalog is logged as a warning.
- `https://faul.wisp.uno/ping` → `badgePushes` contains an entry for your user id with `count > 0` and a recent `at`.
- `GET /presence?userId=<id>` → populated `badges[]`.

The plugin syncs once on start and then on the interval. It pushes the raw catalog verbatim, so new badges and tiers appear without a plugin change. faulrpc persists the last push to `data/badges.json` (30-day validity by default) and invalidates its 24h badge cache on every push, so badges keep rendering while Discord is closed.
