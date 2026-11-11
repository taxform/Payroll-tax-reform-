import express from "express";
import { Pool } from "pg";
import { getConnectionString } from "@netlify/database";

// Only order routes go to this server; the static site and existing
// /api functions keep handling everything else.
export const config = {
  path: "/api/orders/*",
};

const app = express();
const db = new Pool({ connectionString: getConnectionString() });

app.get("/api/orders/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ error: "Order ID must be a positive integer" });
  }

  try {
    const { rows } = await db.query(
      `SELECT id, customer_email, amount, currency, status, created_at
         FROM orders WHERE id = $1`,
      [id],
    );
    if (rows.length === 0) {
      return res.status(404).json({ error: "Order not found" });
    }
    res.json(rows[0]);
  } catch (err) {
    console.error("Failed to load order", id, err);
    res.status(500).json({ error: "Could not load order" });
  }
});

app.use((req, res) => res.status(404).json({ error: "Not found" }));

app.listen(process.env.PORT);
