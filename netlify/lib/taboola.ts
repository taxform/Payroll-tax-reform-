// Server-to-server conversion reporting for Taboola Ads.
// Docs: https://developers.taboola.com/pixel/docs/bulk-submit-s2s-conversions
//
// The bulk endpoint needs no credentials; the Taboola click ID (tblci) that Taboola
// appends to ad landing URLs is what ties a conversion back to an ad click.

export type TaboolaAction = {
  clickId: string;
  name: string;
  timestamp?: number; // ms since epoch
  revenue?: number;
  currency?: string;
  orderId?: string;
};

// Event names must match the "Event Name" of each conversion set up in Taboola Ads.
export const TABOOLA_EVENTS = {
  lead: () => env("TABOOLA_EVENT_LEAD") || "lead",
  calculator: () => env("TABOOLA_EVENT_CALCULATOR") || "calculator_use",
  purchase: () => env("TABOOLA_EVENT_PURCHASE") || "make_purchase",
};

const MAX_BATCH = 1000;

function env(key: string): string {
  return (process.env[key] || "").trim().replace(/^["']|["']$/g, "");
}

// Taboola Ads account ID (not a secret; it appears in Taboola pixel code). TABOOLA_ACCOUNT_ID overrides it.
const DEFAULT_ACCOUNT_ID = "2139275";

export function taboolaAccountId(): string {
  return env("TABOOLA_ACCOUNT_ID") || DEFAULT_ACCOUNT_ID;
}

// Taboola click IDs are opaque URL-safe tokens; reject anything that is clearly not one.
export function cleanClickId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const id = value.trim();
  return /^[A-Za-z0-9_\-.~%=]{8,512}$/.test(id) ? id : null;
}

// Sends conversions in batches. Returns the number of actions accepted by Taboola's endpoint.
// Note: the endpoint replies 204 even for malformed actions, so check Taboola Ads to confirm events arrive.
export async function sendTaboolaConversions(actions: TaboolaAction[]): Promise<number> {
  const accountId = taboolaAccountId();
  if (!accountId) {
    console.warn("Taboola: TABOOLA_ACCOUNT_ID is not set; skipping", actions.length, "conversion(s)");
    return 0;
  }
  if (!actions.length) return 0;

  const url = `https://trc.taboola.com/${encodeURIComponent(accountId)}/log/3/bulk-s2s-action`;
  let sent = 0;

  for (let i = 0; i < actions.length; i += MAX_BATCH) {
    const batch = actions.slice(i, i + MAX_BATCH).map((a) => ({
      "click-id": a.clickId,
      name: a.name,
      timestamp: a.timestamp ?? Date.now(),
      ...(a.revenue != null && Number.isFinite(a.revenue) ? { revenue: a.revenue } : {}),
      ...(a.currency ? { currency: a.currency } : {}),
      ...(a.orderId ? { orderid: a.orderId } : {}),
    }));

    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ actions: batch }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Taboola bulk-s2s-action failed: ${res.status} ${text.slice(0, 300)}`);
    }
    sent += batch.length;
  }
  return sent;
}
