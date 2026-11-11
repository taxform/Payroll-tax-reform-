import type { Config } from "@netlify/functions";

// GET /donate/go
// Sends visitors to Stripe to make a donation.
//
// Preferred: creates a Stripe Checkout Session for the donation Price
// (STRIPE_DONATION_PRICE_ID, defaulting to the site's donation price) using
// STRIPE_SECRET_KEY. Works with one-time, "customer chooses amount" and
// recurring prices.
//
// Fallback: redirects to a Stripe Payment Link in DONATION_URL. A bare
// Payment Link code (e.g. "live_abc123") is also accepted.

const DEFAULT_PRICE_ID = "price_1UaWcR2ErYo0uswkv6d8wThT";
const ALLOWED_HOSTS = new Set(["buy.stripe.com", "donate.stripe.com"]);
const STRIPE_API = "https://api.stripe.com/v1";

// Pulls a Stripe secret/restricted key out of the env value, tolerating
// surrounding quotes, whitespace or a pasted curl command.
function secretKey(): string | null {
  const raw = process.env.STRIPE_SECRET_KEY ?? "";
  const match = raw.match(/\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]+/);
  return match ? match[0] : null;
}

function paymentLinkUrl(): string | null {
  let raw = process.env.DONATION_URL?.trim();
  if (!raw) return null;
  // Product, price and other API object IDs are not Payment Links; Stripe
  // answers buy.stripe.com/prod_... with "access denied".
  if (/^(prod|price|plink|cs|pi|acct)_/.test(raw)) {
    console.error(`DONATION_URL looks like a Stripe object ID (${raw.split("_")[0]}_...), not a Payment Link URL; ignoring it`);
    return null;
  }
  if (/^[A-Za-z0-9_]+$/.test(raw)) raw = `https://buy.stripe.com/${raw}`;
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" || !ALLOWED_HOSTS.has(url.hostname)) return null;
    return url.toString();
  } catch {
    return null;
  }
}

async function stripe(path: string, key: string, body?: URLSearchParams) {
  const res = await fetch(`${STRIPE_API}${path}`, {
    method: body ? "POST" : "GET",
    headers: {
      Authorization: `Bearer ${key}`,
      ...(body ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
    },
    body,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`Stripe ${path} failed (${res.status}): ${data?.error?.message ?? "unknown error"}`);
  }
  return data;
}

async function checkoutUrl(origin: string): Promise<string | null> {
  const key = secretKey();
  if (!key) {
    const raw = process.env.STRIPE_SECRET_KEY?.trim() ?? "";
    if (/^mk_/.test(raw)) {
      console.error("STRIPE_SECRET_KEY is a Stripe key ID (mk_...), not the secret key. Use the full sk_live_/rk_live_ value.");
    } else if (raw.includes("...")) {
      console.error("STRIPE_SECRET_KEY is Stripe's masked preview (contains '...'), not the full key.");
    } else if (raw) {
      console.error("STRIPE_SECRET_KEY does not contain a valid Stripe secret key");
    }
    return null;
  }
  const priceId = process.env.STRIPE_DONATION_PRICE_ID?.trim() || DEFAULT_PRICE_ID;

  const price = await stripe(`/prices/${encodeURIComponent(priceId)}`, key);
  if (!price.active) throw new Error(`Stripe price ${priceId} is not active`);

  const recurring = price.type === "recurring";
  const params = new URLSearchParams({
    mode: recurring ? "subscription" : "payment",
    "line_items[0][price]": priceId,
    "line_items[0][quantity]": "1",
    success_url: `${origin}/donate.html?thanks=1`,
    cancel_url: `${origin}/donate.html`,
    submit_type: "donate",
  });
  if (recurring) params.delete("submit_type");
  // Fixed-amount prices: let donors give multiples of the amount.
  if (!price.custom_unit_amount) {
    params.set("line_items[0][adjustable_quantity][enabled]", "true");
    params.set("line_items[0][adjustable_quantity][minimum]", "1");
    params.set("line_items[0][adjustable_quantity][maximum]", "100");
  }

  const session = await stripe("/checkout/sessions", key, params);
  return typeof session.url === "string" ? session.url : null;
}

function redirect(location: string) {
  return new Response(null, {
    status: 303,
    headers: { Location: location, "Cache-Control": "no-store" },
  });
}

export default async (req: Request) => {
  const origin = new URL(req.url).origin;

  try {
    const url = await checkoutUrl(origin);
    if (url) return redirect(url);
  } catch (err) {
    console.error("Could not create Stripe Checkout session:", err instanceof Error ? err.message : err);
  }

  const link = paymentLinkUrl();
  if (link) return redirect(link);

  console.error("No working donation method: set STRIPE_SECRET_KEY or a valid DONATION_URL");
  return redirect(`${origin}/donate.html?unavailable=1`);
};

export const config: Config = {
  path: "/donate/go",
};
