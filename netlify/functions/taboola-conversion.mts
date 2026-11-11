import type { Config, Context } from "@netlify/functions";
import { cleanClickId, sendTaboolaConversions, TABOOLA_EVENTS } from "../lib/taboola.js";

// POST /api/taboola/conversion  { "event": "calculator", "clickId"?: string }
// Browser-triggered conversions. Only events with no server-side trigger are accepted here;
// form leads and orders are reported from the server so they can't be spoofed from the page.
const BROWSER_EVENTS: Record<string, () => string> = {
  calculator: TABOOLA_EVENTS.calculator,
};

export default async (req: Request, context: Context) => {
  if (req.method !== "POST") return Response.json({ error: "Method not allowed" }, { status: 405 });

  let body: { event?: unknown; clickId?: unknown } = {};
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const eventName = typeof body.event === "string" ? BROWSER_EVENTS[body.event] : undefined;
  if (!eventName) return Response.json({ error: "Unknown event" }, { status: 400 });

  const clickId = cleanClickId(context.cookies.get("tblci")) || cleanClickId(body.clickId);
  if (!clickId) return new Response(null, { status: 204 }); // Not a Taboola visitor; nothing to report.

  try {
    await sendTaboolaConversions([{ clickId, name: eventName() }]);
    return new Response(null, { status: 204 });
  } catch (err) {
    console.error("Taboola conversion failed", err);
    return Response.json({ error: "Could not report conversion" }, { status: 502 });
  }
};

export const config: Config = {
  path: "/api/taboola/conversion",
};
