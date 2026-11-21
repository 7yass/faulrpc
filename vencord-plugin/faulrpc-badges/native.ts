// Runs in Vencord's Node process — no CORS/CSP issues posting to faulrpc.
// Kept deliberately narrow: one endpoint, one validated payload.

export async function pushBadges(
  _event: unknown,
  baseUrl: string,
  key: string,
  userId: string,
  badges: unknown[]
) {
  if (typeof baseUrl !== "string" || !/^https?:\/\//.test(baseUrl)) {
    throw new Error("invalid faulrpc URL");
  }
  if (typeof key !== "string" || key.length === 0) throw new Error("missing push key");
  if (!/^\d{17,19}$/.test(userId)) throw new Error("invalid user id");
  if (!Array.isArray(badges) || badges.length > 200) throw new Error("invalid badge list");

  const res = await fetch(`${baseUrl.replace(/\/+$/, "")}/badges`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-badge-key": key,
    },
    body: JSON.stringify({ userId, badges }),
  });
  if (!res.ok) throw new Error(`faulrpc responded ${res.status}`);
  return res.text();
}
