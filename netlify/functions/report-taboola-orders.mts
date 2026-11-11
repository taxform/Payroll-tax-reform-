import type { Config } from "@netlify/functions";
import { Pool } from "pg";
import { getConnectionString } from "@netlify/database";
import { sendTaboolaConversions, taboolaAccountId, TABOOLA_EVENTS } from "../lib/taboola.js";

// Every 15 minutes, reports completed orders that came from a Taboola ad click as purchase
// conversions (with the order amount as revenue), then marks them so each is sent only once.
// Which order statuses count as completed is configurable via TABOOLA_ORDER_STATUSES.

type OrderRow = { id: number; amount: string; currency: string; taboola_click_id: string; created_at: Date };

const statuses = () =>
  (process.env.TABOOLA_ORDER_STATUSES || "paid,completed")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

export default async () => {
  if (!taboolaAccountId()) {
    console.warn("Taboola: TABOOLA_ACCOUNT_ID is not set; skipping order reporting");
    return;
  }

  const db = new Pool({ connectionString: getConnectionString() });
  try {
    const { rows }: { rows: OrderRow[] } = await db.query(
      `SELECT id, amount, currency, taboola_click_id, created_at
         FROM orders
        WHERE taboola_click_id IS NOT NULL
          AND taboola_reported_at IS NULL
          AND status = ANY($1)
        ORDER BY id
        LIMIT 1000`,
      [statuses()],
    );
    if (!rows.length) return;

    await sendTaboolaConversions(
      rows.map((o) => ({
        clickId: o.taboola_click_id,
        name: TABOOLA_EVENTS.purchase(),
        timestamp: new Date(o.created_at).getTime(),
        revenue: Number(o.amount),
        currency: o.currency,
        orderId: String(o.id),
      })),
    );

    await db.query(`UPDATE orders SET taboola_reported_at = now() WHERE id = ANY($1)`, [rows.map((o) => o.id)]);
    console.log(`Taboola: reported ${rows.length} order conversion(s)`);
  } finally {
    await db.end();
  }
};

export const config: Config = {
  schedule: "*/15 * * * *",
};
