export const PROFILE_REFRESH_INTERVAL_MS = 5 * 60 * 1000;
export const PROFILE_RETRY_INTERVAL_MS = 60 * 1000;

/** Convert discord.js User fields into the API's account-level profile fields. */
export function profileFieldsOf(user) {
  const flagValue = user?.flags?.bitfield ?? user?.public_flags;
  const decoration = user?.avatarDecorationData ?? user?.avatar_decoration_data ?? null;
  const avatarDecoration = decoration
    ? {
        skuId: decoration.skuId ?? decoration.sku_id ?? null,
        asset: decoration.asset ?? null,
        url:
          (typeof user.avatarDecorationURL === "function"
            ? user.avatarDecorationURL({ size: 128 })
            : null) ?? null,
      }
    : null;

  return {
    username: user?.username ?? null,
    displayName: user?.displayName || user?.globalName || user?.global_name || user?.username || null,
    avatarUrl:
      (typeof user?.avatarURL === "function" ? user.avatarURL({ size: 128 }) : null) ??
      (typeof user?.displayAvatarURL === "function"
        ? user.displayAvatarURL({ forceStatic: true, size: 128 })
        : null),
    // null means Discord did not provide this field; 0 means no public flags.
    publicFlags: typeof flagValue === "number" ? flagValue : null,
    avatarDecoration,
  };
}

/**
 * Force-refresh account fields while keeping live presence data from the
 * existing snapshot. Concurrent callers for one user share the same request.
 */
export function createProfileRefresher({
  fetchUser,
  getSnapshot,
  setSnapshot,
  now = Date.now,
  refreshIntervalMs = PROFILE_REFRESH_INTERVAL_MS,
  retryIntervalMs = PROFILE_RETRY_INTERVAL_MS,
}) {
  const fetchedAt = new Map();
  const retryAfter = new Map();
  const inFlight = new Map();

  async function refresh(userId) {
    const current = getSnapshot(userId);
    if (!current) return null;

    const time = now();
    if (
      time < (retryAfter.get(userId) ?? 0) ||
      time - (fetchedAt.get(userId) ?? 0) < refreshIntervalMs
    ) {
      return current;
    }

    const existing = inFlight.get(userId);
    if (existing) return existing;

    const pending = (async () => {
      try {
        const user = await fetchUser(userId);
        const latest = getSnapshot(userId);
        if (!latest) return null;

        const updated = { ...latest, ...profileFieldsOf(user) };
        setSnapshot(userId, updated);
        fetchedAt.set(userId, now());
        retryAfter.delete(userId);
        return updated;
      } catch {
        retryAfter.set(userId, now() + retryIntervalMs);
        return getSnapshot(userId) ?? null;
      } finally {
        inFlight.delete(userId);
      }
    })();

    inFlight.set(userId, pending);
    return pending;
  }

  function invalidate(userId) {
    fetchedAt.delete(userId);
    retryAfter.delete(userId);
  }

  return { refresh, invalidate };
}
