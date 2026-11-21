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
    textOrNull(tier?.simple_icon_url) ??
    textOrNull(tier?.complex_icon_static_url) ??
    textOrNull(raw.simple_icon_url) ??
    textOrNull(raw.complex_icon_static_url) ??
    null;

  return {
    id,
    name: textOrNull(raw.name) ?? textOrNull(raw.description) ?? "",
    tier: textOrNull(tier?.name),
    label: textOrNull(raw.info_label),
    url,
  };
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
        const badges = rows
          .filter((row) => row && row.owned !== false && row.hidden !== true)
          .map(normalizeBadge)
          .filter(Boolean);
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
