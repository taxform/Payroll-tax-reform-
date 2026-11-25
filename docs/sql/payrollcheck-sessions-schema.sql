-- PayrollCheck sessions table (M2 step 4b). Development schema for the
-- Supabase dev project; follows docs/sql/payrollcheck-deny-by-default-schema.sql.
-- Server-side session records for the cookie session layer
-- (src/payrollcheck/payrollcheck-server-session.mjs). No RLS policies here:
-- deny-by-default (ENABLE + FORCE RLS, REVOKE from PUBLIC) — the
-- least-privilege server role is granted access separately.
-- This file lives in the payrollcheck schema (Supabase), NOT the Netlify
-- Database / Drizzle schema (public) — the two databases are different
-- systems. Apply with: psql -f docs/sql/payrollcheck-sessions-schema.sql
BEGIN;
CREATE TABLE IF NOT EXISTS payrollcheck.sessions (
  session_id text PRIMARY KEY CHECK (session_id ~ '^[A-Za-z0-9_-]{1,64}$'),
  previous_session_id text CHECK (previous_session_id IS NULL OR previous_session_id ~ '^[A-Za-z0-9_-]{1,64}$'),
  grace_until timestamptz,
  user_id text NOT NULL CHECK (user_id ~ '^[A-Za-z0-9_-]{1,64}$'),
  auth_user_id uuid NOT NULL,
  aal2 boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  rotated_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL CHECK (expires_at > created_at),
  revoked boolean NOT NULL DEFAULT false,
  CHECK (previous_session_id IS NULL OR previous_session_id <> session_id)
);
CREATE INDEX IF NOT EXISTS sessions_by_user ON payrollcheck.sessions(user_id);
CREATE INDEX IF NOT EXISTS sessions_by_previous ON payrollcheck.sessions(previous_session_id) WHERE previous_session_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS sessions_expiry ON payrollcheck.sessions(expires_at);
ALTER TABLE payrollcheck.sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE payrollcheck.sessions FORCE ROW LEVEL SECURITY;
REVOKE ALL ON payrollcheck.sessions FROM PUBLIC;

-- Server-side login lockout and fixed-window rate-limit records.
-- Pre-auth writes use the same least-privilege runtime role, before an
-- internal subject or session identity exists.
CREATE TABLE IF NOT EXISTS payrollcheck.auth_limits (
  key text PRIMARY KEY,
  value jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE payrollcheck.auth_limits ENABLE ROW LEVEL SECURITY;
ALTER TABLE payrollcheck.auth_limits FORCE ROW LEVEL SECURITY;
REVOKE ALL ON payrollcheck.auth_limits FROM PUBLIC;
COMMIT;
