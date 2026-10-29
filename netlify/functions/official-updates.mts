import type { Config } from "@netlify/functions";
import { fetchReleases, getLatestUpdates, refreshIrsUpdates } from "../lib/irs.js";

const STALE_MS = 26 * 60 * 60 * 1000;

async function fromDatabase() {
  let data = await getLatestUpdates();

  // Fallback for a fresh deploy or a missed scheduled run: refresh once the data is stale.
  const last = data.lastCheck?.checkedAt;
  if (!last || Date.now() - new Date(last).getTime() > STALE_MS) {
    await refreshIrsUpdates();
    data = await getLatestUpdates();
  }
  return { checkedAt: data.lastCheck?.checkedAt ?? null, items: data.items };
}

export default async () => {
  let body;
  try {
    body = await fromDatabase();
    if (!body.items.length) throw new Error("No stored releases yet");
  } catch (err) {
    // If the database is unavailable or empty, read the releases live from IRS.gov.
    console.error("Serving live IRS releases:", err instanceof Error ? err.message : err);
    try {
      body = { checkedAt: new Date().toISOString(), items: await fetchReleases() };
    } catch (liveErr) {
      console.error("Live IRS fetch failed:", liveErr instanceof Error ? liveErr.message : liveErr);
      return Response.json({ checkedAt: null, items: [] }, { status: 503, headers: { "Cache-Control": "no-store" } });
    }
  }

  return Response.json(body, {
    headers: { "Cache-Control": "public, max-age=0, must-revalidate", "Netlify-CDN-Cache-Control": "public, durable, max-age=900, stale-while-revalidate=3600" },
  });
};

export const config: Config = {
  path: "/api/official-updates",
  method: "GET",
};
