import type { Config } from "@netlify/functions";
import { getStore } from "@netlify/blobs";

// GET /api/backlinks?domain=example.com
// Returns the Semrush backlink overview (backlinks, referring domains, Authority Score) for a root domain.
// Results are cached for 24 hours per domain, and fresh lookups are capped per day so a public page
// can't use up the Semrush API units.

const SEMRUSH_URL = "https://api.semrush.com/apis/v4/backlinks/v1/overview";
const CACHE_MS = 24 * 60 * 60 * 1000;
const DAILY_LIMIT = Number(process.env.SEMRUSH_DAILY_LOOKUPS || 100);
const DEFAULT_DOMAIN = "payrolltaxreform.com";

type Overview = {
  domain: string;
  backlinks: number | null;
  referringDomains: number | null;
  authorityScore: number | null;
  checkedAt: string;
};

function normalizeDomain(input: string): string | null {
  let value = input.trim().toLowerCase();
  if (!value) return null;
  if (!/^[a-z][a-z0-9+.-]*:\/\//.test(value)) value = `https://${value}`;
  let host: string;
  try {
    host = new URL(value).hostname;
  } catch {
    return null;
  }
  host = host.replace(/^www\./, "").replace(/\.$/, "");
  if (host.length > 253 || !/^(?!-)[a-z0-9-]{1,63}(?<!-)(\.(?!-)[a-z0-9-]{1,63}(?<!-))+$/.test(host)) return null;
  return host;
}

function apiKey(): string {
  // Tolerate stray whitespace or quotes around a pasted key.
  return (process.env.SEMRUSH_API_KEY || "").trim().replace(/^["']|["']$/g, "");
}

function toNumber(value: string | undefined): number | null {
  if (value === undefined) return null;
  const n = Number(value.replace(/["\s,]/g, ""));
  return Number.isFinite(n) ? n : null;
}

// The CSV is a header row followed by one value row; the delimiter may be ";" or ",".
function parseCsv(text: string): Record<string, string> {
  const lines = text.trim().split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) throw new Error("Unexpected Semrush response");
  const delimiter = lines[0].includes(";") ? ";" : ",";
  const headers = lines[0].split(delimiter).map((h) => h.trim().replace(/^"|"$/g, "").toLowerCase());
  const values = lines[1].split(delimiter).map((v) => v.trim().replace(/^"|"$/g, ""));
  return Object.fromEntries(headers.map((h, i) => [h, values[i]]));
}

class UpstreamError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

async function fetchOverview(domain: string): Promise<Overview> {
  const url = new URL(SEMRUSH_URL);
  url.searchParams.set("url", domain);
  url.searchParams.set("scope", "ROOT_DOMAIN");
  url.searchParams.set("fields", "backlinks_count,domains_count,score");
  url.searchParams.set("format", "csv");

  const res = await fetch(url, {
    headers: { Authorization: `Apikey ${apiKey()}` },
    signal: AbortSignal.timeout(15000),
  });
  const text = await res.text();
  if (!res.ok) {
    console.error(`Semrush returned ${res.status}: ${text.slice(0, 300)}`);
    if (res.status === 401 || res.status === 403) throw new UpstreamError("The Semrush API key was rejected.", 502);
    if (res.status === 429) throw new UpstreamError("Semrush rate limit reached. Try again shortly.", 503);
    throw new UpstreamError("Semrush is unavailable right now.", 502);
  }

  const row = parseCsv(text);
  return {
    domain,
    backlinks: toNumber(row.backlinks_count),
    referringDomains: toNumber(row.domains_count),
    authorityScore: toNumber(row.score),
    checkedAt: new Date().toISOString(),
  };
}

const json = (body: unknown, status = 200, cache = "no-store") =>
  Response.json(body, { status, headers: { "Cache-Control": cache } });

export default async (req: Request) => {
  const param = new URL(req.url).searchParams.get("domain") ?? DEFAULT_DOMAIN;
  const domain = normalizeDomain(param);
  if (!domain) return json({ error: "Enter a valid domain, like example.com." }, 400);
  if (!apiKey()) return json({ error: "The backlink checker is not configured yet." }, 503);

  const store = getStore("semrush-backlinks");
  const cacheKey = `overview/${domain}`;
  const cached = (await store.get(cacheKey, { type: "json" })) as Overview | null;
  if (cached && Date.now() - new Date(cached.checkedAt).getTime() < CACHE_MS) {
    return json({ ...cached, cached: true }, 200, "public, max-age=3600");
  }

  // Soft daily cap on fresh (unit-consuming) lookups.
  const usageKey = `usage/${new Date().toISOString().slice(0, 10)}`;
  const used = Number((await store.get(usageKey)) || 0);
  if (used >= DAILY_LIMIT) {
    if (cached) return json({ ...cached, cached: true, stale: true }, 200, "public, max-age=600");
    return json({ error: "Today's lookup limit has been reached. Please try again tomorrow." }, 429);
  }
  await store.set(usageKey, String(used + 1));

  try {
    const overview = await fetchOverview(domain);
    await store.setJSON(cacheKey, overview);
    return json({ ...overview, cached: false }, 200, "public, max-age=3600");
  } catch (err) {
    if (cached) return json({ ...cached, cached: true, stale: true }, 200, "public, max-age=600");
    const status = err instanceof UpstreamError ? err.status : 502;
    const message = err instanceof UpstreamError ? err.message : "Could not reach Semrush.";
    if (!(err instanceof UpstreamError)) console.error("Semrush lookup failed:", err);
    return json({ error: message }, status);
  }
};

export const config: Config = {
  path: "/api/backlinks",
  method: "GET",
};
