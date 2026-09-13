#!/usr/bin/env node
// ─── faulrpc — self-hosted Discord presence API ────────────────────────
// A Discord bot (discord.js, Node 18+) that watches ONE guild and exposes
// live presence for ANY of its members as JSON over HTTP. No Lanyard, no
// third-party service — your token, your machine, your data.
//
//   GET /presence?userId=<id>   → { userId, username, displayName,
//   GET /user/<id>                 avatarUrl, status, statusColor,
//   GET /ping                      activity { type, name, details, state,
//                                  assets, timestamps }, customStatus,
//                                  lastUpdate }
//
// Members NOT in the guild get { "error": "not_in_guild" }.
//
// Setup: see README.md (bot token, 2 privileged intents, invite to your
// server, fill .env, `npm install && npm start`).
// ────────────────────────────────────────────────────────────────────────

import "dotenv/config";
import { Client, GatewayIntentBits } from "discord.js";
import { createServer } from "node:http";

const TOKEN = process.env.DISCORD_TOKEN;
const GUILD_ID = process.env.GUILD_ID;
const PORT = Number(process.env.PORT || process.env.SERVER_PORT || 4555);

if (!TOKEN || !GUILD_ID) {
  console.error(
    "missing DISCORD_TOKEN / GUILD_ID in .env — copy .env.example to .env and fill it in"
  );
  process.exit(1);
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildPresences,
    GatewayIntentBits.GuildMembers,
  ],
});

// userId → presence snapshot, seeded for the whole guild on boot
const members = new Map();

const STATUS_COLORS = {
  online: "#23a55a",
  idle: "#f0b232",
  dnd: "#f23f43",
  offline: "#80848e",
};

// activity.type → display verb (index 4 is the custom status — handled
// separately as the status text, never as an activity)
const ACTIVITY_NAMES = [
  "Playing",
  "Streaming",
  "Listening to",
  "Watching",
  null,
  "Competing in",
];

const avatarUrlOf = (user) =>
  user.avatarURL({ size: 128 }) ??
  user.displayAvatarURL({ forceStatic: true, size: 128 });

const emojiUrlOf = (emoji) =>
  emoji?.id
    ? `https://cdn.discordapp.com/emojis/${emoji.id}.${emoji.animated ? "gif" : "png"}?size=48`
    : null;

/** Primary non-custom activity with rich fields (assets, timestamps). */
function activityOf(presence) {
  const a = presence?.activities.find((x) => x.type !== 4);
  if (!a) return null;
  // start: real timestamp when the client sends one (Spotify, some
  // games); otherwise when we first saw the activity, so the card's
  // elapsed timer still works for plain rich-presence apps like VS Code.
  const start = a.timestamps?.start ?? a.createdTimestamp ?? null;
  const end = a.timestamps?.end ?? null;
  return {
    type: ACTIVITY_NAMES[a.type] ?? "Playing",
    name: a.name ?? "",
    details: a.details ?? null,
    state: a.state ?? null,
    applicationId: a.applicationId ?? null,
    assets: {
      largeImage: a.assets?.largeImageURL({ size: 128 }) ?? null,
      largeText: a.assets?.largeText ?? null,
      smallImage: a.assets?.smallImageURL({ size: 128 }) ?? null,
      smallText: a.assets?.smallText ?? null,
    },
    timestamps: start || end ? { start, end } : null,
  };
}

/** Custom status (type 4): text + emoji, shown as the status line. */
function customStatusOf(presence) {
  const c = presence?.activities.find((x) => x.type === 4);
  if (!c?.state) return null;
  return {
    text: c.state,
    emoji: c.emoji?.name ?? null,
    emojiUrl: emojiUrlOf(c.emoji),
  };
}

/** Snapshot for a user — offline (but known) when there's no presence. */
function snapshotOf(user, presence) {
  const status = presence?.status ?? "offline";
  return {
    userId: user.id,
    username: user.username,
    displayName: user.displayName || user.globalName || user.username,
    avatarUrl: avatarUrlOf(user),
    status,
    statusColor: STATUS_COLORS[status] ?? STATUS_COLORS.offline,
    activity: activityOf(presence),
    customStatus: customStatusOf(presence),
    lastUpdate: Date.now(),
  };
}

/** Snapshot keyed by user id — refreshed from a GuildMember when possible. */
function snapshotFromMember(member) {
  return snapshotOf(member.user, member.presence ?? null);
}

let guild = null;

async function seedGuild() {
  guild = await client.guilds.fetch(GUILD_ID);
  // Full member list so presences are available instantly, not just on change.
  await guild.members.fetch();
  for (const member of guild.members.cache.values()) {
    members.set(member.id, snapshotFromMember(member));
  }
  console.log(`[faulrpc] seeded ${members.size} member(s) from guild ${guild.name}`);
}

/** Refresh one user's snapshot from a presence update. */
async function refreshFromPresence(presence) {
  if (!presence) return;
  const userId = presence.userId;
  try {
    let user = presence.member?.user ?? client.users.cache.get(userId) ?? null;
    if (!user) user = await client.users.fetch(userId);
    members.set(userId, snapshotOf(user, presence));
  } catch {
    /* user left / unfetchable — keep last known snapshot */
  }
}

client.once("clientReady", async () => {
  console.log(`[faulrpc] logged in as ${client.user.tag}`);
  try {
    await seedGuild();
  } catch (err) {
    console.error("[faulrpc] failed to seed guild:", err?.message ?? err);
  }
});

client.on("presenceUpdate", (_oldPresence, newPresence) => {
  void refreshFromPresence(newPresence);
});

client.on("guildMemberAdd", (member) => {
  if (member.guild.id === GUILD_ID) members.set(member.id, snapshotFromMember(member));
});

client.on("guildMemberUpdate", (_oldMember, newMember) => {
  if (newMember.guild.id === GUILD_ID) members.set(newMember.id, snapshotFromMember(newMember));
});

client.on("guildMemberRemove", (member) => {
  members.delete(member.id);
});

// ─── HTTP API ────────────────────────────────────────────────────────────────

const json = (res, status, body) => {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "access-control-allow-origin": "*",
    "content-length": Buffer.byteLength(text),
  });
  res.end(text);
};

/** Snapshot for a user, fetching from the guild on a cache miss. */
async function snapshotFor(userId) {
  const cached = members.get(userId);
  if (cached) return cached;
  if (!guild) return null;
  try {
    const member = await guild.members.fetch(userId);
    const snap = snapshotFromMember(member);
    members.set(userId, snap);
    return snap;
  } catch {
    return null; // not in guild
  }
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (url.pathname === "/ping") {
      json(res, 200, { ok: true, bot: client.user?.tag ?? null, tracked: members.size });
      return;
    }
    let userId = null;
    if (url.pathname === "/presence") userId = url.searchParams.get("userId");
    else if (url.pathname.startsWith("/user/")) userId = url.pathname.slice("/user/".length);
    if (userId) {
      const snap = await snapshotFor(userId);
      if (!snap) {
        json(res, 404, { error: "not_in_guild" });
        return;
      }
      json(res, 200, snap);
      return;
    }
    json(res, 404, { error: "not_found", hint: "GET /presence?userId=<id>" });
  } catch (err) {
    json(res, 500, { error: "internal", message: err?.message ?? String(err) });
  }
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`[faulrpc] http on 0.0.0.0:${PORT} — /presence?userId=<id>`);
});

client.login(TOKEN);
