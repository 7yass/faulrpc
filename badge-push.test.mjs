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
    assert.deepEqual(first.list(), [{ userId: "1270782781605154922", at: 1234, count: 1 }]);

    const restarted = createBadgePushStore({ file, now: () => 9999 });
    await restarted.load();
    assert.deepEqual(restarted.get("1270782781605154922"), { badges, at: 1234 });
    assert.equal(restarted.get("other"), null);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("already-normalized pushed badges pass through unchanged", () => {
  const badge = { id: 12, name: "Server Boosting", tier: null, label: "Boosting since 12/01/2025", url: "https://cdn.discordapp.com/badge-icons/x.png" };
  assert.deepEqual(normalizeBadge(badge), badge);
});
