// Persistent store for badge catalogs pushed by the Vencord plugin.
// Keeps working when Discord is closed: the last successful sync is
// served until the plugin pushes again.
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export function createBadgePushStore({ file, now = Date.now, onError = console.error }) {
  const entries = new Map();
  let writes = Promise.resolve();

  async function load() {
    try {
      const raw = JSON.parse(await readFile(file, "utf8"));
      if (!raw || typeof raw !== "object") return;
      for (const [userId, value] of Object.entries(raw)) {
        if (value && Array.isArray(value.badges)) {
          entries.set(userId, { badges: value.badges, at: Number(value.at) || 0 });
        }
      }
    } catch {
      // no store yet — normal on first run
    }
  }

  function get(userId) {
    return entries.get(String(userId)) ?? null;
  }

  function put(userId, badges) {
    const id = String(userId);
    const entry = { badges, at: now() };
    entries.set(id, entry);
    const snapshot = Object.fromEntries(entries);
    writes = writes
      .then(async () => {
        await mkdir(dirname(file), { recursive: true });
        const tmp = `${file}.tmp`;
        await writeFile(tmp, JSON.stringify(snapshot));
        await rename(tmp, file);
      })
      .catch((err) => onError(`[faulrpc] badge store write failed: ${err?.message ?? err}`));
    return writes.then(() => entry);
  }

  function list() {
    return [...entries].map(([userId, value]) => ({
      userId,
      at: value.at,
      count: value.badges.length,
    }));
  }

  return { load, get, put, list };
}
