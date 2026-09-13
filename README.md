# faulrpc

Self-hosted Discord presence API — **Node.js (`discord.js`), not Python**. A Discord bot watches **one guild** and exposes live presence for **any member of that guild** as JSON over HTTP. No Lanyard, no third-party service — your token, your machine, your data.

## What it returns

```
GET /presence?userId=<discord user id>
GET /user/<discord user id>
GET /ping
```

```jsonc
{
  "userId": "1270782781605154922",
  "username": "yass",
  "displayName": "y4qs",
  "avatarUrl": "https://cdn.discordapp.com/avatars/…",
  "status": "online",            // online | idle | dnd | offline
  "statusColor": "#23a55a",
  "activity": {                  // primary non-custom activity, or null
    "type": "Playing",           // Playing | Streaming | Listening to | Watching | Competing in
    "name": "Visual Studio Code",
    "details": "Editing Workspace: !!!",
    "state": "src/components/App.tsx",
    "applicationId": "…",
    "assets": {
      "largeImage": "https://cdn.discordapp.com/app-assets/…",
      "largeText": "…",
      "smallImage": null,
      "smallText": null
    },
    "timestamps": { "start": 1757…, "end": null }
  },
  "customStatus": { "text": "…", "emoji": "…", "emojiUrl": "…" },  // or null
  "lastUpdate": 1757…
}
```

Members **not in the guild** get `{ "error": "not_in_guild" }` (HTTP 404) — the bot can only see people who share its server.

## Setup (5 minutes)

1. **Create the bot** — [discord.com/developers/applications](https://discord.com/developers/applications) → New Application → **Bot** → Reset Token → copy it.
2. **Enable 2 privileged intents** — in the Bot tab, under *Privileged Gateway Intents*, toggle ON:
   - ✅ **Presence Intent**
   - ✅ **Server Members Intent**
3. **Invite it to your own server** — Installation tab → copy the install link (or OAuth2 → URL Generator → scopes `bot`, no permissions needed) → open it → pick **your server** (the one you and the people you want to track are in).
4. **Get the server ID** — Discord Settings → Advanced → enable **Developer Mode** → right-click the server name → Copy Server ID.
5. **Run it**:
   ```sh
   npm install
   cp .env.example .env   # then fill in DISCORD_TOKEN + GUILD_ID
   npm start
   ```
6. **Check it** — open `http://localhost:4555/ping`, then `http://localhost:4555/presence?userId=<your id>`.

## Notes

- Needs **Node 18+**. Runs quietly — `npm start` stays in a terminal, or run it as a Windows service / PM2 / systemd unit.
- Presence appears/updates within seconds of someone starting an app or changing status (gateway events, seeded for the whole guild on boot).
- `.env` holds your token and is git-ignored — never commit it.