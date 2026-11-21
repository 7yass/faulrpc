import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createBadgePushStore } from "./badge-push.mjs";
import { normalizeBadge } from "./badges.mjs";

test("push store survives a restart and keeps the sync timestamp", async () => {
  const dir = await mkdtemp(join(tmpdir(), "faulrpc-badges-"));
  const file = join(dir, "nested", "badges.json");
  const badges = [{ id: 18, name: "Account Age", tier: "Gold", label: "9 years", url: "https://cdn.discordapp.com/x.png" }];
  try {
    const first = createBadgePushStore({ file, now: () => 1234 });
    await first.put("1270782781605154922", badges);
    assert.deepEqual(first.get("1270782781605154922"), { badges, at: 1234 });
    assert.deepEqual(first.list(), [{ userId: "1270782781605154922", at: 1234, count: 1, served: 1 }]);

    const restarted = createBadgePushStore({ file, now: () => 9999 });
    await restarted.load();
    assert.deepEqual(restarted.get("1270782781605154922"), { badges, at: 1234 });
    assert.equal(restarted.get("other"), null);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("push status reports raw count and served count separately", async () => {
  const dir = await mkdtemp(join(tmpdir(), "faulrpc-badges-"));
  try {
    const store = createBadgePushStore({ file: join(dir, "badges.json"), now: () => 5000 });
    await store.put("123", [
      { badge_id: 1, name: "Nitro", owned: true, simple_icon_url: "https://cdn.discordapp.com/a.png" },
      { badge_id: 2, name: "Hidden", hidden: true, owned: true },
      { badge_id: "legacy", name: "No numeric id", owned: true },
    ]);
    const [entry] = store.list();
    assert.equal(entry.count, 3);
    assert.equal(entry.served, 1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("already-normalized pushed badges pass through unchanged", () => {
  const badge = { id: 12, name: "Server Boosting", tier: null, label: "Boosting since 12/01/2025", url: "https://cdn.discordapp.com/badge-icons/x.png" };
  assert.deepEqual(normalizeBadge(badge), badge);
});
