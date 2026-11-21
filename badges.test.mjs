import test from "node:test";
import assert from "node:assert/strict";
import {
  createBadgeFetcher,
  normalizeBadge,
  badgesFromProfile,
  badgesFromFlags,
  BADGE_CACHE_TTL_MS,
  BADGE_RETRY_INTERVAL_MS,
} from "./badges.mjs";

const nitro = {
  badge_id: 1,
  name: "Nitro",
  description: "Subscribe to Nitro to support creators you love.",
  info_label: "Subscriber since 12/01/2025",
  rarity: 1,
  simple_icon_url: "https://cdn.discordapp.com/badge-icons/nitro.png",
  complex_icon_static_url: "https://cdn.discordapp.com/assets/content/nitro-large.png",
  is_earnable: true,
  owned: true,
  obtained_at: "2025-01-12T00:00:00Z",
  current_tier: "bronze_1",
  tiers: [
    { key: "bronze_1", name: "Bronze", rarity: 1, simple_icon_url: "https://cdn.discordapp.com/assets/content/bronze.png" },
    { key: "gold_3", name: "Gold", rarity: 3, simple_icon_url: "https://cdn.discordapp.com/assets/content/gold.png" },
  ],
};

const boosting = {
  badge_id: 12,
  name: "Server Boosting",
  info_label: "Boosting since 12/01/2025",
  simple_icon_url: "https://cdn.discordapp.com/badge-icons/72bed924410c304dbe3d00a6e593ff59.png",
  owned: true,
  tiers: [],
};

test("maps a tiered badge to the held tier's name and icon", () => {
  assert.deepEqual(normalizeBadge(nitro), {
    id: 1,
    name: "Nitro",
    tier: "Bronze",
    label: "Subscriber since 12/01/2025",
    url: "https://cdn.discordapp.com/assets/content/bronze.png",
  });
});

test("a tiered badge uses the held tier's icon, not the badge icon or first tier", () => {
  const accountAge = {
    badge_id: 18,
    name: "Account Age",
    info_label: "9 years, 3 months",
    simple_icon_url: "https://cdn.discordapp.com/badge-icons/account-age-base.png",
    owned: true,
    current_tier: "tier_9",
    tiers: [
      { key: "tier_1", name: "Seed", simple_icon_url: "https://cdn.discordapp.com/assets/content/seed.png" },
      {
        key: "tier_9",
        name: "Stromatolite",
        simple_icon_url: "https://cdn.discordapp.com/assets/content/stromatolite.png",
        complex_icon_static_url: "https://cdn.discordapp.com/assets/content/stromatolite-large.png",
      },
    ],
  };

  const out = normalizeBadge(accountAge);
  assert.equal(out.tier, "Stromatolite");
  assert.equal(out.url, "https://cdn.discordapp.com/assets/content/stromatolite.png");
  assert.match(out.url, /^https:\/\/cdn\.discordapp\.com\//);

  // When Discord omits a tier's simple icon, use that same tier's static
  // complex icon — never another tier's or the base badge's icon.
  const withoutSimple = {
    ...accountAge,
    tiers: [{ key: "tier_9", name: "Stromatolite", complex_icon_static_url: "https://cdn.discordapp.com/assets/content/stromatolite-large.png" }],
  };
  assert.equal(normalizeBadge(withoutSimple).url, "https://cdn.discordapp.com/assets/content/stromatolite-large.png");
});

test("prefers a raster icon over Discord's SVG simple icon", () => {
  const out = normalizeBadge({
    badge_id: 18,
    name: "Account Age",
    owned: true,
    simple_icon_url: "https://cdn.discordapp.com/assets/badges/account-age.svg",
    simple_icon_raster_url: "https://cdn.discordapp.com/assets/badges/account-age.png",
  });
  assert.equal(out.url, "https://cdn.discordapp.com/assets/badges/account-age.png");
});

test("maps an untiered badge with a null tier and its own icon", () => {
  assert.deepEqual(normalizeBadge(boosting), {
    id: 12,
    name: "Server Boosting",
    tier: null,
    label: "Boosting since 12/01/2025",
    url: "https://cdn.discordapp.com/badge-icons/72bed924410c304dbe3d00a6e593ff59.png",
  });
});

test("passes through badges Discord adds in the future", () => {
  const future = {
    badge_id: 44,
    name: "Some New Badge",
    info_label: "5 years, 2 months",
    simple_icon_url: "https://cdn.discordapp.com/badge-icons/new.png",
    owned: true,
  };
  assert.deepEqual(normalizeBadge(future), {
    id: 44,
    name: "Some New Badge",
    tier: null,
    label: "5 years, 2 months",
    url: "https://cdn.discordapp.com/badge-icons/new.png",
  });
});

test("profile fallback maps legacy ids, detail lines and tier icons", () => {
  const profile = {
    badges: [
      { id: "premium_tenure_6_month_v2", description: "Subscriber since 12/01/2025", icon: "abc123" },
      { id: "early_supporter", description: "Early Supporter", icon: "7060786766c9c840eb3019e725d2b358" },
      { id: "guild_booster_lvl3", description: "Boosting since 12/01/2025", icon: "72bed924410c304dbe3d00a6e593ff59" },
      { id: "totally_new_badge", description: "Brand new", icon: "new" },
    ],
  };

  const rows = badgesFromProfile(profile);
  assert.deepEqual(rows.map((row) => row.badge_id), [1, 11, 12]);
  const [premium, early, boost] = rows.map(normalizeBadge);
  assert.deepEqual(premium, {
    id: 1,
    name: "Nitro",
    tier: "Gold",
    label: "Subscriber since 12/01/2025",
    url: "https://cdn.discordapp.com/badge-icons/abc123.png",
  });
  assert.equal(early.name, "Early Supporter");
  assert.equal(early.tier, null);
  assert.equal(boost.name, "Server Boosting");
  assert.equal(boost.url, "https://cdn.discordapp.com/badge-icons/72bed924410c304dbe3d00a6e593ff59.png");
});

test("public-flag fallback builds the legacy badge row from known bits", () => {
  const rows = badgesFromFlags((1 << 0) | (1 << 9) | (1 << 6));
  const badges = rows.map(normalizeBadge);
  assert.deepEqual(badges.map((badge) => badge.id), [22, 5, 11]);
  assert.deepEqual(badges.map((badge) => badge.name), ["Discord Staff", "HypeSquad Bravery", "Early Supporter"]);
  assert.equal(badges[2].url, "https://cdn.discordapp.com/badge-icons/7060786766c9c840eb3019e725d2b358.png");
  assert.deepEqual(badgesFromFlags(0), []);
  assert.deepEqual(badgesFromFlags(null), []);
});

test("skips entries without a numeric badge id", () => {
  assert.equal(normalizeBadge({ badge_id: "legacy_name", name: "X", owned: true }), null);
  assert.equal(normalizeBadge(null), null);
});

test("cache keeps Discord's order, drops unowned and hidden badges, and coalesces calls", async () => {
  let now = 1_000_000;
  let calls = 0;
  let release;
  const fetcher = createBadgeFetcher({
    fetchBadges: async () => {
      calls += 1;
      if (calls === 1) await new Promise((resolve) => { release = resolve; });
      return {
        badges: [
          nitro,
          { ...boosting, badge_id: 13, name: "Hidden One", hidden: true },
          { ...boosting, badge_id: 14, owned: false },
          boosting,
        ],
      };
    },
    now: () => now,
  });

  const a = fetcher.get("123");
  const b = fetcher.get("123");
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls, 1);
  release();
  const [first, second] = await Promise.all([a, b]);
  assert.deepEqual(first, second);
  assert.deepEqual(first.map((x) => x.id), [1, 12]);
  assert.deepEqual(first, [normalizeBadge(nitro), normalizeBadge(boosting)]);

  now += BADGE_CACHE_TTL_MS - 1;
  assert.equal(await fetcher.get("123"), first);
  assert.equal(calls, 1);
  now += 1;
  await fetcher.get("123");
  assert.equal(calls, 2);
});

test("failed refresh keeps cached badges and backs off before retrying", async () => {
  let now = 10_000_000;
  let calls = 0;
  const fetcher = createBadgeFetcher({
    fetchBadges: async () => {
      calls += 1;
      if (calls === 1) return [nitro];
      throw new Error("badge directory unavailable");
    },
    now: () => now,
  });

  assert.equal((await fetcher.get("123"))[0].id, 1);
  now += BADGE_CACHE_TTL_MS;
  assert.equal((await fetcher.get("123"))[0].id, 1);
  assert.equal((await fetcher.get("123"))[0].id, 1);
  assert.equal(calls, 2);
  now += BADGE_RETRY_INTERVAL_MS;
  await fetcher.get("123");
  assert.equal(calls, 3);
});
