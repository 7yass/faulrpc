#!/usr/bin/env node
// One-off diagnostic: see exactly what Discord returns for a user's badges.
//   node check-badges.mjs <discordUserId>
import "dotenv/config";

const botToken = process.env.DISCORD_TOKEN;
const userToken = process.env.DISCORD_USER_TOKEN;
const userId = process.argv[2];
if ((!botToken && !userToken) || !userId) {
  console.error("usage: node check-badges.mjs <discordUserId>   (needs a token in .env)");
  process.exit(1);
}
const auth = userToken ? userToken : `Bot ${botToken}`;
console.log(`auth: ${userToken ? "user token" : "bot token"}`);

for (const [label, url] of [
  ["badges v9", `https://discord.com/api/v9/users/${userId}/badges`],
  ["badges v10", `https://discord.com/api/v10/users/${userId}/badges`],
  ["profile v10", `https://discord.com/api/v10/users/${userId}/profile?with_mutual_guilds=false&with_mutual_friends=false`],
]) {
  try {
    const res = await fetch(url, { headers: { authorization: auth } });
    const text = await res.text();
    let body;
    try { body = JSON.parse(text); } catch { body = text; }
    console.log(`\n=== ${label} — HTTP ${res.status} ===`);
    if (Array.isArray(body?.badges) || Array.isArray(body)) {
      const rows = Array.isArray(body) ? body : body.badges;
      console.log(`badge rows: ${rows.length}`);
      for (const row of rows.slice(0, 30)) {
        console.log(JSON.stringify({
          badge_id: row.badge_id,
          id: row.id,
          name: row.name,
          description: row.description,
          info_label: row.info_label,
          owned: row.owned,
          hidden: row.hidden,
          current_tier: row.current_tier,
          simple_icon_url: row.simple_icon_url,
          simple_icon_raster_url: row.simple_icon_raster_url,
          icon: row.icon,
        }));
      }
    } else {
      console.log(JSON.stringify(body, null, 2).slice(0, 4000));
    }
  } catch (err) {
    console.log(`\n=== ${label} — request failed: ${err.message} ===`);
  }
}
