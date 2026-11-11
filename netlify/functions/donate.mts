import type { Config } from "@netlify/functions";

// GET /donate/go
// Sends visitors to the site's Stripe Payment Link. The link lives in the
// DONATION_URL environment variable so it can be changed in the Netlify UI
// without editing any pages.

const ALLOWED_HOSTS = new Set(["buy.stripe.com", "donate.stripe.com"]);

function donationUrl(): string | null {
  const raw = process.env.DONATION_URL?.trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" || !ALLOWED_HOSTS.has(url.hostname)) return null;
    return url.toString();
  } catch {
    return null;
  }
}

export default async () => {
  const target = donationUrl();
  if (!target) {
    console.error("DONATION_URL is missing or is not a Stripe Payment Link");
    return Response.redirect(new URL("/donate.html?unavailable=1", "https://payrolltaxreform.com"), 302);
  }
  return new Response(null, {
    status: 302,
    headers: { Location: target, "Cache-Control": "no-store" },
  });
};

export const config: Config = {
  path: "/donate/go",
};
