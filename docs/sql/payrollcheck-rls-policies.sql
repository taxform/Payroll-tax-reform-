-- PayrollCheck 360: tenant-scoped RLS policies (M2 step 7).
--
-- This is the deployable policy set for the payrollcheck schema. It
-- replaces the test-only fixture policies in
-- tests/sql/payrollcheck-report-rls-fixture.sql (deleted by this step;
-- the step-7 regression in tests/sql/payrollcheck-rls-regression.sql
-- supersedes tests/sql/payrollcheck-report-rls-isolation.sql and covers
-- the same six isolation scenarios plus the write paths).
--
-- IDENTITY MODEL
-- One runtime role, payrollcheck_app (non-owner, non-BYPASSRLS, created
-- NOLOGIN here; ops enables LOGIN with a server-side password out of
-- band). Every runtime query runs as this role inside a transaction
-- whose identity the server sets first — see
-- src/payrollcheck/payrollcheck-rls-identity.mjs (setRlsIdentity):
--
--   payrollcheck.current_subject_id   — step-3 mapped internal id
--     (memberships.subject_id); set after the mapping query resolves it
--   payrollcheck.current_auth_user_id — verified Supabase Auth UUID
--     (the JWT sub, step-2 verified); the ONLY identity available on
--     the login/mapping path, before any subject exists
--   payrollcheck.current_session_id   — the presented server session id
--     (the __Host-payrollcheck-session cookie value, step 4a)
--
-- Policies read the settings with nullif(current_setting(..., true), '')
-- so an unset setting is NULL and every comparison fails: no identity
-- means no rows (deny by default). The settings are transaction-local
-- (SET LOCAL), so they vanish on COMMIT/ROLLBACK and cannot leak across
-- pooled requests. Never trust a client-supplied value for these
-- settings; only the server sets them, from verified sources.
--
-- WHAT THE POLICIES ENFORCE (see m2-step7-design.md for the full table)
--   tenants:        a caller sees only tenants they actively belong to.
--   memberships:    a caller reads their own rows, plus — for a
--                   business_owner — every member of a tenant they own
--                   (Postgres requires a row to be SELECT-visible for
--                   UPDATE to find it, so owner deactivate/reactivate
--                   only works if the owner can see the member rows;
--                   this also means owners can list their own tenant's
--                   members, but never another tenant's). A
--                   business_owner may insert/deactivate members of
--                   their own tenant. (Bootstrap of the FIRST owner is
--                   an ops action as table owner, not an app-role write.)
--   reports:        business_owner of the owning business tenant, or a
--                   firm reviewer/admin with an ACTIVE client_grants row
--                   carrying 'view_report' for that business. Pending,
--                   revoked, and review_finding-only grants authorize
--                   nothing. A business's own accounting staff do NOT get
--                   report access under these policies (spec-literal).
--   client_grants:  either side may read a grant; a firm member may
--                   request one (as themselves); only an active
--                   business_owner of the business tenant may approve,
--                   never the requester themselves; either side may revoke.
--                   Approve and revoke share ONE update policy: two
--                   separate permissive UPDATE policies are OR-combined
--                   by Postgres, so a caller satisfying either policy's
--                   USING and either policy's WITH CHECK could cross
--                   them (a firm requester self-approving via the
--                   revoke USING + approve WITH CHECK).
--   access_audit:   append-only; a caller writes/reads only their own
--                   actor rows.
--   sessions:       a session is readable/writable only by its own
--                   presented session id, or by its owning user
--                   (subject + verified auth UUID together). This is the
--                   sessions-table RLS denial step 4b deferred here.
--
-- KNOWN LIMITS (documented in m2-step7-design.md, not hidden)
--   - Grant requests do not check tenant_type in the policy (a business
--     could request as if it were a firm); the firm-path report policy
--     re-checks the reader's tenant type, so a mis-typed grant cannot
--     authorize a read.
--   - RLS cannot compare a new row to the old row, so an approver who
--     owns two businesses could move a grant between them; the step-6
--     module is the first layer (it updates status/actor/timestamps
--     only) and the step-9 handler must only expose that transition.
--   - Within-tenant role changes by a business_owner are permitted by
--     the memberships UPDATE policy; step-9 handlers restrict the
--     operation surface (step 6 only flips active).
--
-- Apply after docs/sql/payrollcheck-deny-by-default-schema.sql,
-- docs/sql/payrollcheck-dev-auth-identity-link.sql, and
-- docs/sql/payrollcheck-sessions-schema.sql:
--   psql -X -v ON_ERROR_STOP=1 -f docs/sql/payrollcheck-rls-policies.sql
-- Idempotent (DROP POLICY IF EXISTS before each CREATE POLICY).
BEGIN;

-- Runtime role. NOLOGIN on purpose: no password ever lives in this repo;
-- ops enables LOGIN with a server-side password out of band.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'payrollcheck_app') THEN
    CREATE ROLE payrollcheck_app NOLOGIN NOBYPASSRLS;
  END IF;
END $$;

-- Re-assert RLS (enabled + forced by the schema files) so this file is
-- self-sufficient if applied on its own.
ALTER TABLE payrollcheck.tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE payrollcheck.tenants FORCE ROW LEVEL SECURITY;
ALTER TABLE payrollcheck.memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE payrollcheck.memberships FORCE ROW LEVEL SECURITY;
ALTER TABLE payrollcheck.reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE payrollcheck.reports FORCE ROW LEVEL SECURITY;
ALTER TABLE payrollcheck.client_grants ENABLE ROW LEVEL SECURITY;
ALTER TABLE payrollcheck.client_grants FORCE ROW LEVEL SECURITY;
ALTER TABLE payrollcheck.access_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE payrollcheck.access_audit FORCE ROW LEVEL SECURITY;
ALTER TABLE payrollcheck.sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE payrollcheck.sessions FORCE ROW LEVEL SECURITY;

-- Least privilege: only the operations the policies cover. Anything
-- without a policy is denied by RLS even though the grant exists.
GRANT USAGE ON SCHEMA payrollcheck TO payrollcheck_app;
GRANT SELECT ON payrollcheck.tenants TO payrollcheck_app;
GRANT SELECT, INSERT, UPDATE ON payrollcheck.memberships TO payrollcheck_app;
GRANT SELECT ON payrollcheck.reports TO payrollcheck_app;
GRANT SELECT, INSERT, UPDATE ON payrollcheck.client_grants TO payrollcheck_app;
GRANT SELECT, INSERT ON payrollcheck.access_audit TO payrollcheck_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON payrollcheck.sessions TO payrollcheck_app;
REVOKE ALL ON ALL TABLES IN SCHEMA payrollcheck FROM PUBLIC;

-- ---------------------------------------------------------------- tenants
-- A caller sees only tenants they actively belong to. No app-role writes:
-- tenant creation is an ops/bootstrap action as table owner.
DROP POLICY IF EXISTS app_tenants_select ON payrollcheck.tenants;
CREATE POLICY app_tenants_select ON payrollcheck.tenants
  FOR SELECT TO payrollcheck_app USING (
    tenant_id IN (
      SELECT tenant_id FROM payrollcheck.memberships
      WHERE subject_id = nullif(current_setting('payrollcheck.current_subject_id', true), '')
        AND active = true
    )
  );

-- ------------------------------------------------------------ memberships
-- Read: own rows — by mapped subject, or by verified Auth UUID on
-- the login/mapping path before any subject exists — plus, for an
-- active business_owner, every member row of a tenant they own.
-- The owner branch is required, not just convenient: Postgres only
-- lets UPDATE find rows that are SELECT-visible, so without it an
-- owner could provision a member (INSERT needs no SELECT) but never
-- deactivate/reactivate them (UPDATE finds zero rows — CI Check 12
-- proved it). No active filter on own rows: an inactive member still
-- sees their own (inactive) row; every authorization path re-checks
-- active, so visibility grants nothing. Owners see only their own
-- tenant's members — never another tenant's.
DROP POLICY IF EXISTS app_memberships_select ON payrollcheck.memberships;
CREATE POLICY app_memberships_select ON payrollcheck.memberships
  FOR SELECT TO payrollcheck_app USING (
    subject_id = nullif(current_setting('payrollcheck.current_subject_id', true), '')
    OR auth_user_id = nullif(current_setting('payrollcheck.current_auth_user_id', true), '')::uuid
    OR tenant_id IN (
      SELECT tenant_id FROM payrollcheck.memberships
      WHERE subject_id = nullif(current_setting('payrollcheck.current_subject_id', true), '')
        AND active = true
        AND role = 'business_owner'
    )
  );

-- Insert: only a business_owner adding a member to a tenant they own.
-- (The first owner of a tenant cannot be created this way — bootstrap
-- is an ops action; after bootstrap, owners provision their own staff.)
DROP POLICY IF EXISTS app_memberships_insert ON payrollcheck.memberships;
CREATE POLICY app_memberships_insert ON payrollcheck.memberships
  FOR INSERT TO payrollcheck_app WITH CHECK (
    tenant_id IN (
      SELECT tenant_id FROM payrollcheck.memberships
      WHERE subject_id = nullif(current_setting('payrollcheck.current_subject_id', true), '')
        AND active = true
        AND role = 'business_owner'
    )
  );

-- Update (deactivate/reactivate): only a business_owner of that tenant.
-- The policy permits any column change by the owner; step-6 modules and
-- step-9 handlers restrict the operation surface (active flag only).
DROP POLICY IF EXISTS app_memberships_update ON payrollcheck.memberships;
CREATE POLICY app_memberships_update ON payrollcheck.memberships
  FOR UPDATE TO payrollcheck_app USING (
    tenant_id IN (
      SELECT tenant_id FROM payrollcheck.memberships
      WHERE subject_id = nullif(current_setting('payrollcheck.current_subject_id', true), '')
        AND active = true
        AND role = 'business_owner'
    )
  ) WITH CHECK (
    tenant_id IN (
      SELECT tenant_id FROM payrollcheck.memberships
      WHERE subject_id = nullif(current_setting('payrollcheck.current_subject_id', true), '')
        AND active = true
        AND role = 'business_owner'
    )
  );

-- ---------------------------------------------------------------- reports
-- Read-only for the app role (report ingestion is a future step).
-- Business path: active business_owner of the owning business tenant.
-- Firm path: active accounting_admin/reviewer of an accounting_firm
-- tenant with an ACTIVE grant carrying 'view_report' for this business.
-- Pending, revoked, and review_finding-only grants authorize nothing.
-- Revocation is re-checked on every query: a revoked grant stops
-- authorizing reads immediately.
DROP POLICY IF EXISTS app_reports_select ON payrollcheck.reports;
CREATE POLICY app_reports_select ON payrollcheck.reports
  FOR SELECT TO payrollcheck_app USING (
    EXISTS (
      SELECT 1 FROM payrollcheck.memberships m
      JOIN payrollcheck.tenants t ON t.tenant_id = m.tenant_id
      WHERE m.active = true AND (
        (m.subject_id = nullif(current_setting('payrollcheck.current_subject_id', true), '')
          AND m.role = 'business_owner'
          AND t.tenant_type = 'business'
          AND m.tenant_id = payrollcheck.reports.business_tenant_id)
        OR
        (m.subject_id = nullif(current_setting('payrollcheck.current_subject_id', true), '')
          AND m.role IN ('accounting_admin', 'accounting_reviewer')
          AND t.tenant_type = 'accounting_firm'
          AND EXISTS (
            SELECT 1 FROM payrollcheck.client_grants g
            WHERE g.firm_tenant_id = m.tenant_id
              AND g.business_tenant_id = payrollcheck.reports.business_tenant_id
              AND g.status = 'active'
              AND 'view_report' = ANY(g.scopes)
          ))
      )
    )
  );

-- ----------------------------------------------------------- client_grants
-- Read: either side of the grant (a member of the firm or the business).
DROP POLICY IF EXISTS app_client_grants_select ON payrollcheck.client_grants;
CREATE POLICY app_client_grants_select ON payrollcheck.client_grants
  FOR SELECT TO payrollcheck_app USING (
    firm_tenant_id IN (
      SELECT tenant_id FROM payrollcheck.memberships
      WHERE subject_id = nullif(current_setting('payrollcheck.current_subject_id', true), '')
        AND active = true
    )
    OR business_tenant_id IN (
      SELECT tenant_id FROM payrollcheck.memberships
      WHERE subject_id = nullif(current_setting('payrollcheck.current_subject_id', true), '')
        AND active = true
    )
  );

-- Request: an active member of the firm tenant, requesting as themselves,
-- for a different tenant, pending only. Tenant types are NOT checked
-- here (see header); the firm-path report policy re-checks the reader's
-- tenant type, so a mis-typed grant cannot authorize a read.
DROP POLICY IF EXISTS app_client_grants_insert ON payrollcheck.client_grants;
CREATE POLICY app_client_grants_insert ON payrollcheck.client_grants
  FOR INSERT TO payrollcheck_app WITH CHECK (
    status = 'pending'
    AND requested_by_subject = nullif(current_setting('payrollcheck.current_subject_id', true), '')
    AND firm_tenant_id IN (
      SELECT tenant_id FROM payrollcheck.memberships
      WHERE subject_id = nullif(current_setting('payrollcheck.current_subject_id', true), '')
        AND active = true
    )
    AND firm_tenant_id <> business_tenant_id
  );

-- Update (approve / revoke): ONE policy, not two. Two separate
-- permissive UPDATE policies are OR-combined by Postgres: a row is
-- updatable if it passes either policy's USING and its new version
-- passes either policy's WITH CHECK. A firm requester could then
-- self-approve by passing the revoke USING (firm member, pending)
-- and the approve WITH CHECK (status active, approver = self).
-- A single policy ties each transition to the caller in one WITH
-- CHECK, so no cross-combination is possible. Note the self-approve
-- denial now surfaces as an insufficient_privilege error (the row is
-- visible via USING but no valid transition exists), not as zero
-- affected rows — see regression Check 8.
DROP POLICY IF EXISTS app_client_grants_update ON payrollcheck.client_grants;
CREATE POLICY app_client_grants_update ON payrollcheck.client_grants
  FOR UPDATE TO payrollcheck_app USING (
    status IN ('pending', 'active')
    AND (
      firm_tenant_id IN (
        SELECT tenant_id FROM payrollcheck.memberships
        WHERE subject_id = nullif(current_setting('payrollcheck.current_subject_id', true), '')
          AND active = true
      )
      OR business_tenant_id IN (
        SELECT tenant_id FROM payrollcheck.memberships
        WHERE subject_id = nullif(current_setting('payrollcheck.current_subject_id', true), '')
          AND active = true
      )
    )
  ) WITH CHECK (
    (
      -- Approve: only an active business_owner of the business tenant,
      -- never the requester themselves (self-approval is denied even
      -- for a user who holds memberships on both sides). The approver
      -- is bound to the row.
      status = 'active'
      AND approved_by_subject = nullif(current_setting('payrollcheck.current_subject_id', true), '')
      AND requested_by_subject <> nullif(current_setting('payrollcheck.current_subject_id', true), '')
      AND business_tenant_id IN (
        SELECT tenant_id FROM payrollcheck.memberships
        WHERE subject_id = nullif(current_setting('payrollcheck.current_subject_id', true), '')
          AND active = true
          AND role = 'business_owner'
      )
    )
    OR
    (
      -- Revoke: either side may revoke (a pending request may be
      -- withdrawn, an active grant ended by the firm or the business).
      -- The revoker is bound to the row.
      status = 'revoked'
      AND revoked_by_subject = nullif(current_setting('payrollcheck.current_subject_id', true), '')
    )
  );

-- ------------------------------------------------------------ access_audit
-- Append-only. A caller writes and reads only their own actor rows; the
-- actor is bound to the verified subject, so a caller cannot file audit
-- rows as someone else.
DROP POLICY IF EXISTS app_access_audit_select ON payrollcheck.access_audit;
CREATE POLICY app_access_audit_select ON payrollcheck.access_audit
  FOR SELECT TO payrollcheck_app USING (
    actor_subject_id = nullif(current_setting('payrollcheck.current_subject_id', true), '')
  );

DROP POLICY IF EXISTS app_access_audit_insert ON payrollcheck.access_audit;
CREATE POLICY app_access_audit_insert ON payrollcheck.access_audit
  FOR INSERT TO payrollcheck_app WITH CHECK (
    actor_subject_id = nullif(current_setting('payrollcheck.current_subject_id', true), '')
  );

-- ---------------------------------------------------------------- sessions
-- A session row is visible only to its own presented session id (the
-- cookie-load path: the session id IS the credential), to the row whose
-- previous id it is (rotation grace), or to its owning user (mapped
-- subject AND verified Auth UUID together). No identity at all means no
-- rows — this is the sessions-table RLS denial step 4b deferred here.
DROP POLICY IF EXISTS app_sessions_select ON payrollcheck.sessions;
CREATE POLICY app_sessions_select ON payrollcheck.sessions
  FOR SELECT TO payrollcheck_app USING (
    session_id = nullif(current_setting('payrollcheck.current_session_id', true), '')
    OR previous_session_id = nullif(current_setting('payrollcheck.current_session_id', true), '')
    OR (
      user_id = nullif(current_setting('payrollcheck.current_subject_id', true), '')
      AND auth_user_id = nullif(current_setting('payrollcheck.current_auth_user_id', true), '')::uuid
    )
  );

-- Insert: only for the verified identity (subject + Auth UUID together).
DROP POLICY IF EXISTS app_sessions_insert ON payrollcheck.sessions;
CREATE POLICY app_sessions_insert ON payrollcheck.sessions
  FOR INSERT TO payrollcheck_app WITH CHECK (
    user_id = nullif(current_setting('payrollcheck.current_subject_id', true), '')
    AND auth_user_id = nullif(current_setting('payrollcheck.current_auth_user_id', true), '')::uuid
  );

-- Update (refresh/rotate): by presented session id or by owning user,
-- and the row may never be reassigned to another user.
DROP POLICY IF EXISTS app_sessions_update ON payrollcheck.sessions;
CREATE POLICY app_sessions_update ON payrollcheck.sessions
  FOR UPDATE TO payrollcheck_app USING (
    session_id = nullif(current_setting('payrollcheck.current_session_id', true), '')
    OR (
      user_id = nullif(current_setting('payrollcheck.current_subject_id', true), '')
      AND auth_user_id = nullif(current_setting('payrollcheck.current_auth_user_id', true), '')::uuid
    )
  ) WITH CHECK (
    user_id = nullif(current_setting('payrollcheck.current_subject_id', true), '')
    AND auth_user_id = nullif(current_setting('payrollcheck.current_auth_user_id', true), '')::uuid
  );

-- Delete (logout / revoke-all): by presented session id or by owning user.
DROP POLICY IF EXISTS app_sessions_delete ON payrollcheck.sessions;
CREATE POLICY app_sessions_delete ON payrollcheck.sessions
  FOR DELETE TO payrollcheck_app USING (
    session_id = nullif(current_setting('payrollcheck.current_session_id', true), '')
    OR (
      user_id = nullif(current_setting('payrollcheck.current_subject_id', true), '')
      AND auth_user_id = nullif(current_setting('payrollcheck.current_auth_user_id', true), '')::uuid
    )
  );

COMMIT;
