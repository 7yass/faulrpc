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
//   POST /badges                   badges[], lastUpdate }
//                                  (Vencord plugin push; x-badge-key auth)
//
// Members NOT in the guild get { "error": "not_in_guild" }.
//
// Setup: see README.md (bot token, 2 privileged intents, invite to your
// server, fill .env, `npm install && npm start`).
// ────────────────────────────────────────────────────────────────────────

import "dotenv/config";
import { Client, GatewayIntentBits } from "discord.js";
import { createServer } from "node:http";
import { createProfileRefresher, profileFieldsOf } from "./profile-data.mjs";
import { createBadgeFetcher, badgesFromProfile, badgesFromFlags } from "./badges.mjs";
import { createBadgePushStore } from "./badge-push.mjs";

const TOKEN = process.env.DISCORD_TOKEN;
// Discord returns 20001 "Bots cannot use this endpoint" for BOTH badge
// routes. A user token is the only way to read the real badge directory,
// the same way haunt.gg does it. Optional: without it we fall back to
// public flags.
const USER_TOKEN = process.env.DISCORD_USER_TOKEN;
// A Vencord plugin can read the directory with its own live client session
// and POST it here. That is the primary source when configured.
const BADGE_PUSH_KEY = process.env.BADGE_PUSH_KEY;
const PUSH_STORE_FILE = process.env.BADGE_STORE_FILE || "data/badges.json";
const PUSH_MAX_AGE_MS = Number(process.env.BADGE_PUSH_MAX_AGE_MS || 30 * 24 * 60 * 60 * 1000);
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

// Refresh account-level fields from Discord on first lookup; after a
// successful fetch, cache them for 5 minutes and retry failures after 1 minute.
const profileRefresher = createProfileRefresher({
  fetchUser: (userId) => client.users.fetch(userId, { force: true }),
  getSnapshot: (userId) => members.get(userId),
  setSnapshot: (userId, snapshot) => members.set(userId, snapshot),
});

const discordApi = async (path, version, userToken = false) => {
  const res = await fetch(`https://discord.com/api/v${version}${path}`, {
    headers: { authorization: userToken ? USER_TOKEN : `Bot ${TOKEN}` },
  });
  const body = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status} ${body.slice(0, 200)}`);
  return body ? JSON.parse(body) : null;
};

/**
 * Badge directory first (v9 then v10) using a user token — Discord blocks
 * bots on both it and the profile route with 20001. Falls back to public
 * flags when no user token is configured or every route fails. Each
 * failure is logged so an empty array always has a visible cause.
 */
const pushStore = createBadgePushStore({ file: PUSH_STORE_FILE });
await pushStore.load();

async function loadBadges(userId) {
  const pushed = pushStore.get(userId);
  if (pushed) {
    if (Date.now() - pushed.at < PUSH_MAX_AGE_MS) return pushed.badges;
    console.warn(`[faulrpc] pushed badges for ${userId} are stale — trying live sources`);
  }
  const flagFallback = () => pushed?.badges ?? badgesFromFlags(members.get(userId)?.publicFlags);
  if (!USER_TOKEN) return flagFallback();

  const failures = [];
  for (const version of [9, 10]) {
    try {
      const data = await discordApi(`/users/${userId}/badges`, version, true);
      const rows = Array.isArray(data) ? data : data?.badges;
      if (Array.isArray(rows) && rows.some((row) => row && row.owned !== false && row.hidden !== true)) {
        return data;
      }
      failures.push(`v${version}: no owned badges`);
    } catch (err) {
      failures.push(`v${version}: ${err.message}`);
    }
  }

  try {
    const profile = await discordApi(
      `/users/${userId}/profile?with_mutual_guilds=false&with_mutual_friends=false`,
      10,
      true
    );
    const rows = badgesFromProfile(profile);
    if (rows.length) {
      console.warn(`[faulrpc] badge directory for ${userId}: ${failures.join(" | ")} — used profile badges`);
      return rows;
    }
    failures.push("profile: no badges");
  } catch (err) {
    failures.push(`profile: ${err.message}`);
  }

  console.warn(`[faulrpc] badge sources failed for ${userId}: ${failures.join(" | ")} — using public flags`);
  return flagFallback();
}

// Discord's badge directory (or the profile fallback) is the source for
// badges — numeric ids, names, info labels, tiers and CDN icons. Cached by
// the fetcher for 24 hours; presence lookups stay live.
const badgeFetcher = createBadgeFetcher({ fetchBadges: loadBadges });

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
    ...profileFieldsOf(user),
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
  profileRefresher.invalidate(member.id);
  badgeFetcher.invalidate(member.id);
});

// ─── HTTP API ────────────────────────────────────────────────────────────────

const json = (res, status, body) => {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "access-control-allow-origin": "*",
    "access-control-allow-headers": "authorization, content-type, x-badge-key",
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "content-length": Buffer.byteLength(text),
  });
  res.end(text);
};

/** Snapshot for a user, fetching from the guild on a cache miss. */
async function snapshotFor(userId) {
  let snap = members.get(userId);
  if (!snap) {
    if (!guild) return null;
    try {
      const member = await guild.members.fetch(userId);
      snap = snapshotFromMember(member);
      members.set(userId, snap);
    } catch {
      return null; // not in guild
    }
  }
  const fresh = (await profileRefresher.refresh(userId)) ?? snap;
  const badges = await badgeFetcher.get(userId);
  return { ...fresh, badges };
}

const readJson = (req) =>
  new Promise((resolve, reject) => {
    let text = "";
    req.on("data", (chunk) => {
      text += chunk;
      if (text.length > 1_000_000) reject(new Error("body too large"));
    });
    req.on("end", () => {
      try { resolve(JSON.parse(text)); } catch { reject(new Error("invalid json")); }
    });
    req.on("error", reject);
  });

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (req.method === "OPTIONS") {
      res.writeHead(204, {
        "access-control-allow-origin": "*",
        "access-control-allow-headers": "authorization, content-type, x-badge-key",
        "access-control-allow-methods": "GET, POST, OPTIONS",
      });
      res.end();
      return;
    }
    if (req.method === "POST" && url.pathname === "/badges") {
      if (!BADGE_PUSH_KEY || req.headers["x-badge-key"] !== BADGE_PUSH_KEY) {
        json(res, 401, { error: "unauthorized" });
        return;
      }
      const body = await readJson(req);
      const userId = String(body?.userId ?? "");
      const badges = body?.badges;
      if (!/^\d{17,19}$/.test(userId) || !Array.isArray(badges) || badges.length > 200) {
        json(res, 400, { error: "invalid_payload" });
        return;
      }
      pushStore.put(userId, badges);
      badgeFetcher.invalidate(userId);
      console.log(`[faulrpc] received ${badges.length} badge entry/entries for ${userId}`);
      json(res, 200, { ok: true, count: badges.length });
      return;
    }
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
