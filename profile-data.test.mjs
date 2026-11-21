import test from "node:test";
import assert from "node:assert/strict";
import {
  createProfileRefresher,
  PROFILE_REFRESH_INTERVAL_MS,
  profileFieldsOf,
} from "./profile-data.mjs";

function makeUser({ flags = 0, decoration = null } = {}) {
  return {
    username: "example",
    displayName: "Example User",
    flags: flags === null ? null : { bitfield: flags },
    avatarURL: () => "https://cdn.example/avatar.png",
    avatarDecorationData: decoration,
    avatarDecorationURL: () => "https://cdn.example/decoration.png",
  };
}

test("forwards numeric public flags and decoration asset data", () => {
  assert.deepEqual(profileFieldsOf(makeUser({
    flags: 0,
    decoration: { skuId: "sku-1", asset: "asset-1" },
  })), {
    username: "example",
    displayName: "Example User",
    avatarUrl: "https://cdn.example/avatar.png",
    publicFlags: 0,
    avatarDecoration: {
      skuId: "sku-1",
      asset: "asset-1",
      url: "https://cdn.example/decoration.png",
    },
  });
});

test("distinguishes missing public flags from an actual zero", () => {
  assert.equal(profileFieldsOf(makeUser({ flags: null })).publicFlags, null);
  assert.equal(profileFieldsOf(makeUser({ flags: 0 })).publicFlags, 0);
  assert.equal(profileFieldsOf(makeUser()).avatarDecoration, null);
});

test("refreshes once, preserves live fields, and coalesces concurrent calls", async () => {
  let now = 10_000_000;
  let calls = 0;
  let releaseFetch;
  const snapshots = new Map([[
    "123",
    { userId: "123", status: "online", activity: { name: "Game" }, publicFlags: null },
  ]]);
  const refresher = createProfileRefresher({
    fetchUser: async () => {
      calls += 1;
      if (calls === 1) {
        await new Promise((resolve) => { releaseFetch = resolve; });
      }
      return makeUser({ flags: 8 });
    },
    getSnapshot: (id) => snapshots.get(id),
    setSnapshot: (id, value) => snapshots.set(id, value),
    now: () => now,
  });

  const first = refresher.refresh("123");
  const second = refresher.refresh("123");
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls, 1);
  releaseFetch();
  const [a, b] = await Promise.all([first, second]);
  assert.equal(a.publicFlags, 8);
  assert.equal(b.publicFlags, 8);
  assert.equal(a.status, "online");
  assert.deepEqual(a.activity, { name: "Game" });

  await refresher.refresh("123");
  assert.equal(calls, 1);
  now += PROFILE_REFRESH_INTERVAL_MS;
  await refresher.refresh("123");
  assert.equal(calls, 2);
});

test("keeps cached data and backs off briefly after fetch failures", async () => {
  let calls = 0;
  const snapshot = { userId: "123", status: "idle", publicFlags: 16 };
  const refresher = createProfileRefresher({
    fetchUser: async () => { calls += 1; throw new Error("temporary API failure"); },
    getSnapshot: () => snapshot,
    setSnapshot: () => assert.fail("failed fetch must not write a snapshot"),
    now: () => 10_000_000,
  });

  assert.equal(await refresher.refresh("123"), snapshot);
  assert.equal(await refresher.refresh("123"), snapshot);
  assert.equal(calls, 1);
});
