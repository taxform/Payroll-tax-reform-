-- Regression check for payrollcheck.sessions (M2 step 4b).
-- Run against a disposable Postgres with the sessions schema applied first:
--   psql -X -v ON_ERROR_STOP=1 -f docs/sql/payrollcheck-sessions-schema.sql
--   psql -X -v ON_ERROR_STOP=1 -f tests/sql/payrollcheck-sessions-store.sql
-- Uses the same statements the Postgres session store runs. Any failure
-- raises an exception. Rolls back at the end so no rows remain.
BEGIN;
-- Two sessions for one user; B claims A's id as its previous id.
INSERT INTO payrollcheck.sessions (session_id, previous_session_id, grace_until, user_id, auth_user_id, aal2, created_at, rotated_at, last_seen_at, expires_at, revoked)
VALUES
  ('sess-a-000000000000000000000000000001', NULL, NULL, 'owner1', '11111111-1111-4111-8111-111111111111', true, '2026-01-01 00:00:00+00', '2026-01-01 00:00:00+00', '2026-01-01 00:00:00+00', '2026-01-01 12:00:00+00', false),
  ('sess-b-000000000000000000000000000002', 'sess-a-000000000000000000000000000001', '2026-01-01 00:01:00+00', 'owner1', '11111111-1111-4111-8111-111111111111', true, '2026-01-01 00:00:00+00', '2026-01-01 00:00:00+00', '2026-01-01 00:00:00+00', '2026-01-01 12:00:00+00', false);
-- get by id returns exactly one row.
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM payrollcheck.sessions WHERE session_id = 'sess-a-000000000000000000000000000001';
  IF n <> 1 THEN RAISE EXCEPTION 'get by id returned % rows, expected 1', n; END IF;
END $$;
-- get by previous id returns B.
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM payrollcheck.sessions WHERE previous_session_id = 'sess-a-000000000000000000000000000001';
  IF n <> 1 THEN RAISE EXCEPTION 'get by previous id returned % rows, expected 1', n; END IF;
END $$;
-- upsert updates the row instead of duplicating it.
INSERT INTO payrollcheck.sessions (session_id, previous_session_id, grace_until, user_id, auth_user_id, aal2, created_at, rotated_at, last_seen_at, expires_at, revoked)
VALUES ('sess-a-000000000000000000000000000001', NULL, NULL, 'owner1', '11111111-1111-4111-8111-111111111111', true, '2026-01-01 00:00:00+00', '2026-01-01 00:00:00+00', '2026-01-01 00:05:00+00', '2026-01-01 12:00:00+00', false)
ON CONFLICT (session_id) DO UPDATE SET previous_session_id = EXCLUDED.previous_session_id, grace_until = EXCLUDED.grace_until, user_id = EXCLUDED.user_id, auth_user_id = EXCLUDED.auth_user_id, aal2 = EXCLUDED.aal2, created_at = EXCLUDED.created_at, rotated_at = EXCLUDED.rotated_at, last_seen_at = EXCLUDED.last_seen_at, expires_at = EXCLUDED.expires_at, revoked = EXCLUDED.revoked;
DO $$
DECLARE n int; DECLARE seen timestamptz;
BEGIN
  SELECT count(*) INTO n FROM payrollcheck.sessions;
  IF n <> 2 THEN RAISE EXCEPTION 'upsert left % rows, expected 2', n; END IF;
  SELECT last_seen_at INTO seen FROM payrollcheck.sessions WHERE session_id = 'sess-a-000000000000000000000000000001';
  IF seen <> '2026-01-01 00:05:00+00' THEN RAISE EXCEPTION 'upsert did not update last_seen_at, got %', seen; END IF;
END $$;
-- delete by user removes both rows.
DELETE FROM payrollcheck.sessions WHERE user_id = 'owner1';
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM payrollcheck.sessions;
  IF n <> 0 THEN RAISE EXCEPTION 'delete by user left % rows, expected 0', n; END IF;
END $$;
ROLLBACK;
