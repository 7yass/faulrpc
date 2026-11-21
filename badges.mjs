// ─── Discord profile badges ─────────────────────────────────────────────
// Discord's badge directory endpoint (GET /users/{id}/badges) hands back
// the account's badges with numeric badge_id, name, info_label, owned,
// hidden, current_tier and the full tiers list. faulrpc exposes the same
// data in the presence payload with the shape below.
//
//   { id, name, tier, label, url }
//
// No badge list is hardcoded here: whatever Discord returns is what we
// output, so new badges appear without a code change.

export const BADGE_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
export const BADGE_RETRY_INTERVAL_MS = 60 * 1000;

const textOrNull = (value) =>
  typeof value === "string" && value.length > 0 ? value : null;

// Discord's profile badges use string ids; the badge directory uses these
// numeric ids. This is the client's own mapping — only used by the profile
// fallback, never by the primary directory path.
const PROFILE_BADGE_NAMES = [
  "premium_tenure",
  "partner",
  "certified_moderator",
  "hypesquad",
  "hypesquad_house_1",
  "hypesquad_house_2",
  "hypesquad_house_3",
  "bug_hunter_level_1",
  "bug_hunter_level_2",
  "verified_developer",
  "early_supporter",
  "guild_booster",
  "legacy_username",
  "quest_completed",
  "april_fools_2026",
  "orb_profile",
  "gifting",
  "account_age",
  "streaming",
  "game_time",
  "game_variety",
  "staff",
];

const BADGE_NAMES = {
  1: "Nitro",
  2: "Partnered Server Owner",
  3: "Moderator Programs Alumni",
  4: "HypeSquad Events",
  5: "HypeSquad Bravery",
  6: "HypeSquad Brilliance",
  7: "HypeSquad Balance",
  8: "Bug Hunter",
  9: "Bug Hunter",
  10: "Early Verified Bot Developer",
  11: "Early Supporter",
  12: "Server Boosting",
  13: "Legacy Username",
  14: "Discord Quests",
  15: "Last Meadow Online",
  16: "Orbs",
  17: "Gifting",
  18: "Account Age",
  19: "Streaming",
  20: "Game Time",
  21: "Game Variety",
  22: "Discord Staff",
};

const NITRO_TIERS = {
  1: "Bronze",
  2: "Bronze",
  3: "Silver",
  6: "Gold",
  12: "Platinum",
  24: "Diamond",
  36: "Emerald",
  60: "Ruby",
  72: "Opal",
};

const badgeNumber = (profileId) => {
  if (typeof profileId !== "string" || profileId.length === 0) return null;
  if (["staff", "staff_hidden", "staff_personal"].includes(profileId)) return 22;
  if (profileId === "premium" || profileId.startsWith("premium_tenure_")) return 1;
  if (profileId === "orb_profile_badge") return 16;
  if (profileId.startsWith("guild_booster_lvl")) return 12;
  const index = PROFILE_BADGE_NAMES.indexOf(profileId);
  return index === -1 ? null : index + 1;
};

/**
 * Convert a badge from the bot-accessible GET /users/{id}/profile response
 * into the directory's wire shape. Profile badges carry the tier-specific
 * icon hash and Discord's detail line, so the fallback still produces the
 * same { id, name, tier, label, url } output.
 */
export function profileBadgeToDirectory(raw) {
  const id = badgeNumber(raw?.id);
  if (id === null) return null;

  const hash = textOrNull(raw.icon) ?? textOrNull(raw.art);
  const url = hash
    ? /^https?:\/\//.test(hash)
      ? hash
      : `https://cdn.discordapp.com/badge-icons/${hash}.png`
    : null;

  let tier = null;
  const months = /premium_tenure_(\d+)_month/.exec(raw.id ?? "");
  if (months) tier = NITRO_TIERS[Number(months[1])] ?? null;

  return {
    badge_id: id,
    name: BADGE_NAMES[id] ?? textOrNull(raw.name) ?? "",
    info_label: textOrNull(raw.description),
    simple_icon_url: url,
    tier_name: tier,
    owned: true,
  };
}

/** Pull the badge list out of a profile response. */
export function badgesFromProfile(profile) {
  const rows = Array.isArray(profile?.badges) ? profile.badges : [];
  return rows.map(profileBadgeToDirectory).filter(Boolean);
}

// Last-resort source when Discord refuses both badge routes: the public
// flag bitfield plus Discord's own badge-icons. Covers the legacy row in
// the profile (Early Supporter, HypeSquad, Bug Hunter, …), not the new
// directory-only badges (Nitro tenure, Account Age, Quests, …).
const FLAG_BADGES = [
  { bit: 1 << 0, id: 22, name: "Discord Staff", icon: "5e74e9b61934fc1f67c65515d1f7e60d" },
  { bit: 1 << 1, id: 2, name: "Partnered Server Owner", icon: "3f9748e53446a137a052f3454e2de41e" },
  { bit: 1 << 2, id: 4, name: "HypeSquad Events", icon: "bf01d1073931f921909045f3a39fd264" },
  { bit: 1 << 3, id: 8, name: "Bug Hunter", icon: "2717692c7dca7289b35297368a940dd0" },
  { bit: 1 << 6, id: 5, name: "HypeSquad Bravery", icon: "8a88d63823d8a71cd5e390baa45efa02" },
  { bit: 1 << 7, id: 6, name: "HypeSquad Brilliance", icon: "011940fd013da3f7fb926e4a1cd2e618" },
  { bit: 1 << 8, id: 7, name: "HypeSquad Balance", icon: "3aa41de486fa12454c3761e8e223442e" },
  { bit: 1 << 9, id: 11, name: "Early Supporter", icon: "7060786766c9c840eb3019e725d2b358" },
  { bit: 1 << 14, id: 9, name: "Bug Hunter", icon: "848f79194d4be5ff5f81505cbd0ce1e6" },
  { bit: 1 << 17, id: 10, name: "Early Verified Bot Developer", icon: "6df5892e0f35b051f8b61eace34f4967" },
  { bit: 1 << 18, id: 3, name: "Moderator Programs Alumni", icon: "fee1624003e2fee35cb398e125dc479b" },
  { bit: 1 << 22, id: 23, name: "Active Developer", icon: "6bdc42827a38498929a4920da12695d9" },
];

/** Build badge rows from a public-flags bitfield (bot-accessible). */
export function badgesFromFlags(flags) {
  if (typeof flags !== "number" || !Number.isFinite(flags)) return [];
  return FLAG_BADGES.filter((entry) => (flags & entry.bit) !== 0).map((entry) => ({
    badge_id: entry.id,
    name: entry.name,
    simple_icon_url: `https://cdn.discordapp.com/badge-icons/${entry.icon}.png`,
    owned: true,
  }));
}

const badgeIdOf = (value) => {
  if (typeof value === "number" && Number.isSafeInteger(value)) return value;
  if (typeof value === "string" && /^\d+$/.test(value)) return Number(value);
  return null;
};

/**
 * Turn one badge-directory entry into the presence API's badge shape.
 * `current_tier` is a tier *key* — Discord's client resolves it with
 * `tiers.find(t => t.key === badge.current_tier)`, so the tier's `name`
 * and icon have to come from that entry.
 */
export function normalizeBadge(raw) {
  // Already in the output shape (e.g. a plugin-pushed cached snapshot).
  if (
    raw &&
    Number.isSafeInteger(raw.id) &&
    typeof raw.name === "string" &&
    "url" in raw
  ) {
    return {
      id: raw.id,
      name: raw.name,
      tier: textOrNull(raw.tier),
      label: textOrNull(raw.label),
      url: textOrNull(raw.url),
    };
  }

  const id = badgeIdOf(raw?.badge_id);
  if (id === null) return null;

  const tiers = Array.isArray(raw.tiers) ? raw.tiers.filter(Boolean) : [];
  const key = raw.current_tier;
  const tier = key == null
    ? null
    : tiers.find((t) => t.key === key || t.name === key) ??
      tiers.find((t) => String(t.key).toLowerCase() === String(key).toLowerCase()) ??
      null;

  const url =
    textOrNull(tier?.simple_icon_raster_url) ??
    textOrNull(tier?.simple_icon_url) ??
    textOrNull(tier?.complex_icon_static_url) ??
    textOrNull(raw.simple_icon_raster_url) ??
    textOrNull(raw.simple_icon_url) ??
    textOrNull(raw.complex_icon_static_url) ??
    null;

  return {
    id,
    name: textOrNull(raw.name) ?? textOrNull(raw.description) ?? "",
    tier: textOrNull(tier?.name) ?? textOrNull(raw.tier_name),
    label: textOrNull(raw.info_label),
    url,
  };
}

/** Rows that actually make it into a presence response. */
export function servedBadges(rows) {
  if (!Array.isArray(rows)) return [];
  return rows
    .filter((row) => row && row.owned !== false && row.hidden !== true)
    .map(normalizeBadge)
    .filter(Boolean);
}

/**
 * Cache badge-directory lookups per user. Successful fetches live for
 * 24 hours (matching Discord's own catalog staleness); failures keep the
 * last known badges and back off for a minute. Concurrent lookups for
 * one user share a single request.
 */
export function createBadgeFetcher({
  fetchBadges,
  now = Date.now,
  ttlMs = BADGE_CACHE_TTL_MS,
  retryIntervalMs = BADGE_RETRY_INTERVAL_MS,
}) {
  const cached = new Map();
  const retryAfter = new Map();
  const inFlight = new Map();

  async function get(userId) {
    const time = now();
    const hit = cached.get(userId);
    if (hit && time - hit.at < ttlMs) return hit.badges;
    if (time < (retryAfter.get(userId) ?? 0)) return hit?.badges ?? [];

    const existing = inFlight.get(userId);
    if (existing) return existing;

    const pending = (async () => {
      try {
        const data = await fetchBadges(userId);
        const rows = Array.isArray(data)
          ? data
          : Array.isArray(data?.badges)
            ? data.badges
            : [];
        const badges = servedBadges(rows);
        cached.set(userId, { badges, at: now() });
        retryAfter.delete(userId);
        return badges;
      } catch {
        retryAfter.set(userId, now() + retryIntervalMs);
        return cached.get(userId)?.badges ?? [];
      } finally {
        inFlight.delete(userId);
      }
    })();

    inFlight.set(userId, pending);
    return pending;
  }

  function invalidate(userId) {
    cached.delete(userId);
    retryAfter.delete(userId);
  }

  return { get, invalidate };
}
