-- PayrollCheck: reconcile prod policy and membership drift (2026-11-25).
--
-- Two prod-only drifts, both found while fixing the dashboard/company
-- 401 "invalid_session" bug (the handlers required the presented server
-- session id to be a UUID):
--
-- 1. Prod has 22 app policies; the canonical set in
--    docs/sql/payrollcheck-rls-policies.sql (Slice 2) creates 18. The four
--    extra policies -- app_tenants_all, app_reports_all,
--    app_client_grants_delete, app_memberships_read -- are created by NO
--    file in this repo (verified by a repo-wide search at main@a599ff8), so
--    they pre-date the repo SQL. RLS permissive policies combine with OR, so
--    an extra permissive policy can only widen access beyond the canonical
--    design, never narrow it: the design grants tenants and reports SELECT
--    only, client_grants SELECT/INSERT/UPDATE only (no DELETE), and
--    memberships SELECT/INSERT/UPDATE only. No app code uses the extra
--    capabilities (there is no DELETE on client_grants anywhere in src/,
--    and tenant/report writes go through the same pool the canonical file
--    already governs). This migration drops the four policies so prod
--    matches the canonical 18. If a future flow genuinely needs one of
--    these capabilities, add a scoped policy to
--    docs/sql/payrollcheck-rls-policies.sql deliberately instead of
--    re-creating a broad one by hand.
--
-- 2. Prod-shaped memberships has its primary key on `id` and (unlike the
--    repo schema in docs/sql/payrollcheck-deny-by-default-schema.sql, where
--    the primary key is `membership_id`) no `membership_id` column. The
--    #125 reconciliation migrations added auth_user_id, subject_id and
--    active to that legacy shape but never added membership_id, while app
--    code reads and writes it: src/payrollcheck/supabase-tenant-membership.mjs
--    SELECTs membership_id (the report handler's business-tenant
--    authorization seam; a missing column fails the lookup with 42703 and
--    the report is denied) and src/payrollcheck/payrollcheck-tenancy.mjs
--    INSERTs/UPDATEs memberships ... RETURNING membership_id (provisioning
--    and deactivation). This migration adds membership_id to the legacy
--    shape only, backfilled from the legacy primary key `id`, and makes it
--    unique and NOT NULL. The legacy primary key on `id` is left untouched.
--
-- Idempotent and a no-op on a fresh database built from the repo SQL files
-- (membership_id is already the primary key there, and the four policies
-- do not exist). Do NOT run against dev: dev already has the repo shape.
-- Apply to prod in a separate manual step after this PR merges, as with
-- the #125 and #134 reconciliations; verify with the queries at the end
-- of this file before and after applying.
--
-- NOTE: this file must NOT be applied by any deploy or migration runner.
-- It is a manual reconciliation for a database that was provisioned before
-- the repo SQL files existed.

-- 1. Drop the four non-canonical policies (no-op where they do not exist).
DROP POLICY IF EXISTS app_tenants_all ON payrollcheck.tenants;
DROP POLICY IF EXISTS app_reports_all ON payrollcheck.reports;
DROP POLICY IF EXISTS app_client_grants_delete ON payrollcheck.client_grants;
DROP POLICY IF EXISTS app_memberships_read ON payrollcheck.memberships;

-- 2. Ensure membership_id exists on the legacy prod shape.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'payrollcheck' AND table_name = 'memberships' AND column_name = 'id'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'payrollcheck' AND table_name = 'memberships' AND column_name = 'membership_id'
  ) THEN
    ALTER TABLE payrollcheck.memberships ADD COLUMN membership_id uuid;
    UPDATE payrollcheck.memberships SET membership_id = id::uuid WHERE membership_id IS NULL;
    ALTER TABLE payrollcheck.memberships ALTER COLUMN membership_id SET NOT NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS payrollcheck_memberships_membership_id_key
      ON payrollcheck.memberships (membership_id);
  END IF;
END $$;

-- Verify (run before and after applying; all four must hold afterwards):
-- SELECT count(*) FROM pg_policies WHERE schemaname = 'payrollcheck' AND policyname LIKE 'app\_%'; -- 18
-- SELECT policyname FROM pg_policies WHERE schemaname = 'payrollcheck' AND policyname IN ('app_tenants_all', 'app_reports_all', 'app_client_grants_delete', 'app_memberships_read'); -- 0 rows
-- SELECT column_name, data_type, is_nullable FROM information_schema.columns WHERE table_schema = 'payrollcheck' AND table_name = 'memberships' AND column_name IN ('id', 'membership_id'); -- membership_id uuid, NO
-- SELECT count(*) FROM payrollcheck.memberships WHERE membership_id IS NULL; -- 0
