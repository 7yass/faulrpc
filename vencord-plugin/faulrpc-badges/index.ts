/*
 * faulrpc badge bridge — Vencord user plugin
 *
 * Discord refuses the badge directory to bots (20001) and rotates user
 * tokens on login. Running inside the logged-in client avoids both: the
 * plugin uses Vencord's RestAPI (which carries the live session) to read
 * the directory and pushes the raw catalog to faulrpc. faulrpc keeps the
 * last successful push, so presence still has badges while Discord is
 * closed.
 */
import { definePluginSettings } from "@api/Settings";
import { Logger } from "@utils/Logger";
import definePlugin, { OptionType, PluginNative } from "@utils/types";
import { RestAPI } from "@webpack/common";

const Native = VencordNative.pluginHelpers.FaulrpcBadges as PluginNative<
  typeof import("./native")
>;
const log = new Logger("FaulrpcBadges", "#a970ff");

const settings = definePluginSettings({
  botUrl: {
    type: OptionType.STRING,
    description: "faulrpc base URL (no trailing slash needed)",
    default: "http://localhost:4555",
  },
  pushKey: {
    type: OptionType.STRING,
    description: "BADGE_PUSH_KEY from faulrpc's .env",
    default: "",
  },
  userId: {
    type: OptionType.STRING,
    description: "Discord user id whose badges get synced",
    default: "1270782781605154922",
  },
  intervalMinutes: {
    type: OptionType.NUMBER,
    description: "How often to re-sync (minutes)",
    default: 60,
  },
});

let timer: ReturnType<typeof setInterval> | null = null;
let syncing = false;

async function sync() {
  const { botUrl, pushKey, userId, intervalMinutes } = settings.store;
  if (!pushKey || !userId) return;
  if (syncing) return;
  syncing = true;
  try {
    const res = await RestAPI.get({ url: `/users/${userId}/badges` });
    const raw = res?.body;
    const rows: unknown[] = Array.isArray(raw) ? raw : raw?.badges;
    if (!Array.isArray(rows)) throw new Error("unexpected badge response");
    await Native.pushBadges(botUrl, pushKey, userId, rows);
    log.info(`synced ${rows.length} badge entry/entries (next in ${intervalMinutes}m)`);
  } catch (err) {
    log.error("sync failed", err);
  } finally {
    syncing = false;
  }
}

export default definePlugin({
  name: "FaulrpcBadges",
  description: "Sync Discord's badge directory to faulrpc so bot-only presence reads it.",
  authors: [{ name: "yass", id: 1270782781605154922n }],
  settings,

  async start() {
    await sync();
    timer = setInterval(sync, Math.max(1, settings.store.intervalMinutes) * 60_000);
  },

  stop() {
    if (timer) clearInterval(timer);
    timer = null;
  },
});
