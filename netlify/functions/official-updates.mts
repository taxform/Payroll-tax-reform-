import type { Config } from "@netlify/functions";
import { getLatestUpdates, refreshIrsUpdates } from "../lib/irs.js";

const STALE_MS = 26 * 60 * 60 * 1000;

export default async () => {
  let data = await getLatestUpdates();

  // Fallback for a fresh deploy or a missed scheduled run: refresh once the data is stale.
  const last = data.lastCheck?.checkedAt;
  if (!last || Date.now() - new Date(last).getTime() > STALE_MS) {
    await refreshIrsUpdates();
    data = await getLatestUpdates();
  }

  const lastSuccess = data.lastCheck?.status === "ok" ? data.lastCheck.checkedAt : null;
  return Response.json(
    { checkedAt: data.lastCheck?.checkedAt ?? null, lastStatus: data.lastCheck?.status ?? null, lastSuccess, items: data.items },
    { headers: { "Cache-Control": "public, max-age=0, must-revalidate", "Netlify-CDN-Cache-Control": "public, durable, max-age=900, stale-while-revalidate=3600" } },
  );
};

export const config: Config = {
  path: "/api/official-updates",
  method: "GET",
};
