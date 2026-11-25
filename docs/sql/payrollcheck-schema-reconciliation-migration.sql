-- ============================================================================
-- payrollcheck schema reconciliation migration
--
-- Apply order on a fresh database (the order matters):
--   1. docs/sql/payrollcheck-deny-by-default-schema.sql
--   2. docs/sql/payrollcheck-sessions-schema.sql
--   3. THIS migration (it adds memberships.auth_user_id, which
--      payrollcheck-rls-policies.sql already references)
--   4. docs/sql/payrollcheck-rls-policies.sql
--   5. THIS migration again (harmless; every step is idempotent).
-- Applying payrollcheck-rls-policies.sql before this migration fails at
-- that file's memberships policies with: ERROR: column "auth_user_id"
-- does not exist. That ordering dependency is part of what this PR fixes.
--
-- It brings the resulting schema to exactly the schema the application code
-- expects, as verified against the live payrollcheck-360-dev project
-- (ref izqzclahjijkhyxvhtif), which is ground truth because all live
-- acceptance (a)-(h) passed against it.
--
-- What was wrong (verified 2026-11-25, main @ a7e2d02):
--  * memberships had no auth_user_id column and no partial unique index on
--    (tenant_id, auth_user_id). The code links a Supabase Auth user to a
--    membership through memberships.auth_user_id (see
--    src/payrollcheck/payrollcheck-tenancy.mjs: linkAuthUser / revokeUserEverywhere
--    and tests/sql/payrollcheck-rls-regression.sql). The column only existed in
--    the development-only file docs/sql/payrollcheck-dev-auth-identity-link.sql,
--    which a fresh production deploy does not apply. This migration promotes
--    that identity link into the production migration path; the dev-only file
--    is left untouched and stays harmless (its ALTER is guarded by IF NOT EXISTS).
--  * The production build of payrollcheck-360-prod was reported to have a
--    memberships table shaped (id, tenant_id, subject, role, created_at,
--    updated_at) -- no subject_id, no active -- which fails the login mapping
--    query with Postgres error 42703. NOTE: that shape matches NO file at
--    main @ a7e2d02 (the deny-by-default file already defines subject_id and
--    active), so prod was evidently provisioned from an older snapshot, not
--    from these files. This migration therefore also adds subject_id and
--    active defensively (IF NOT EXISTS), backfilling subject_id from a legacy
--    `subject` column when one is present, so it repairs that prod shape too.
--  * docs/sql/payrollcheck-rls-policies.sql creates two anti-tamper triggers
--    (prevent_membership_role_change, prevent_client_grant_reassignment) and
--    their functions (payrollcheck.prevent_membership_role_change() and
--    payrollcheck.prevent_client_grant_reassignment()). The live dev schema has
--    NEITHER trigger nor function,
--    but tests/sql/payrollcheck-rls-regression.sql requires them (checks 16 and 19),
--    which guard memberships.role and client_grants.firm_tenant_id /
--    business_tenant_id. This migration KEEPS them: dev is the stale side on this one point, and the triggers stay in the production path.
--    See section 5 below.
--  * Everything else was verified matching: all 7 tables, all 47 columns,
--    all 16 CHECK constraints, all 5 foreign keys, the unique constraint on
--    memberships(tenant_id, subject_id), all 15 RLS policies
--    (role payrollcheck_app, RLS enabled + forced on all 7 tables) and the
--    payrollcheck.is_business_owner_of(text, uuid) function are identical
--    between the repo SQL files and dev. Two small exceptions are covered by
--    the migration itself: dev has 13 indexes while the repo files define
--    14 -- dev lacks the UNIQUE index on sessions.previous_session_id that
--    the sessions schema file defines (added in section 4 below) -- and dev
--    lacks the two anti-tamper triggers the regression test requires (kept;
--    see section 5). The defensive ADD COLUMN / CREATE INDEX guards in
--    sections 2-4 below are no-ops on a fresh repo-SQL database; they only
--    help a stale database catch up.
--
-- Idempotency: every step is guarded (IF NOT EXISTS / IF EXISTS / DO blocks
-- that check the catalog first), so running this file twice is harmless.
--
-- Scope: schema only. This migration is applied to prod in a separate step
-- after this PR merges; it is NOT applied here, and dev already has the
-- evolved schema, so do NOT run it against dev. No Netlify environment
-- variable is set or changed by this file.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. memberships: subject_id / active / role (the login mapping query needs
--    subject_id and active; dev: subject_id text NOT NULL CHECK 1..255 chars,
--    active boolean NOT NULL DEFAULT true, UNIQUE (tenant_id, subject_id)).
-- ---------------------------------------------------------------------------
ALTER TABLE payrollcheck.memberships
  ADD COLUMN IF NOT EXISTS subject_id text;

-- Repair the legacy prod shape: backfill subject_id from the legacy `subject`
-- column when it exists. No-op on a fresh repo-SQL database (no such column).
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'payrollcheck'
      AND table_name = 'memberships'
      AND column_name = 'subject'
  ) THEN
    EXECUTE $upd$UPDATE payrollcheck.memberships
               SET subject_id = subject
               WHERE subject_id IS NULL$upd$;
  END IF;
END $$;

-- Enforce NOT NULL only once every row has a subject_id, so existing rows are
-- never rejected. On a fresh repo-SQL database this is already NOT NULL.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM payrollcheck.memberships WHERE subject_id IS NULL) THEN
    ALTER TABLE payrollcheck.memberships ALTER COLUMN subject_id SET NOT NULL;
  END IF;
END $$;

-- Dev CHECK: memberships_subject_id_check (char_length 1..255), added only if
-- absent and no existing row would violate it.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'memberships_subject_id_check')
     AND NOT EXISTS (
       SELECT 1 FROM payrollcheck.memberships
       WHERE subject_id IS NOT NULL
         AND (char_length(subject_id) < 1 OR char_length(subject_id) > 255)
     ) THEN
    ALTER TABLE payrollcheck.memberships
      ADD CONSTRAINT memberships_subject_id_check
      CHECK (char_length(subject_id) >= 1 AND char_length(subject_id) <= 255);
  END IF;
END $$;

-- Dev UNIQUE: memberships(tenant_id, subject_id).
CREATE UNIQUE INDEX IF NOT EXISTS memberships_tenant_id_subject_id_key
  ON payrollcheck.memberships (tenant_id, subject_id);

ALTER TABLE payrollcheck.memberships
  ADD COLUMN IF NOT EXISTS active boolean NOT NULL DEFAULT true;

-- Dev CHECK: memberships_role_check, added only if absent and no existing
-- row would violate it.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'memberships_role_check')
     AND NOT EXISTS (
       SELECT 1 FROM payrollcheck.memberships
       WHERE role NOT IN ('business_owner', 'accounting_admin', 'accounting_reviewer')
     ) THEN
    ALTER TABLE payrollcheck.memberships
      ADD CONSTRAINT memberships_role_check
      CHECK (role IN ('business_owner', 'accounting_admin', 'accounting_reviewer'));
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 2. memberships: auth_user_id identity link (promoted from the dev-only
--    docs/sql/payrollcheck-dev-auth-identity-link.sql). Dev: auth_user_id
--    uuid NULL, FK to auth.users(id) ON DELETE RESTRICT, partial unique
--    index on (tenant_id, auth_user_id) WHERE auth_user_id IS NOT NULL.
-- ---------------------------------------------------------------------------
ALTER TABLE payrollcheck.memberships
  ADD COLUMN IF NOT EXISTS auth_user_id uuid;

-- Add the FK only when the Supabase Auth schema is present (it is in every
-- Supabase project; a disposable plain-Postgres test database has no auth
-- schema, and there the bare column is what the regression test expects).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'memberships_auth_user_id_fkey')
     AND EXISTS (
       SELECT 1 FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'auth' AND c.relname = 'users' AND c.relkind = 'r'
     ) THEN
    ALTER TABLE payrollcheck.memberships
      ADD CONSTRAINT memberships_auth_user_id_fkey
      FOREIGN KEY (auth_user_id) REFERENCES auth.users(id) ON DELETE RESTRICT;
  END IF;
END $$;

COMMENT ON COLUMN payrollcheck.memberships.auth_user_id IS
  'Trusted server-provisioned Supabase Auth user UUID; not writable by browser clients.';

CREATE UNIQUE INDEX IF NOT EXISTS memberships_tenant_auth_user_unique
  ON payrollcheck.memberships (tenant_id, auth_user_id)
  WHERE auth_user_id IS NOT NULL;

-- Dev FK: memberships.tenant_id -> tenants(tenant_id), added only if absent
-- and no orphan row would violate it.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'memberships_tenant_id_fkey')
     AND NOT EXISTS (
       SELECT 1 FROM payrollcheck.memberships m
       LEFT JOIN payrollcheck.tenants t ON t.tenant_id = m.tenant_id
       WHERE t.tenant_id IS NULL
     ) THEN
    ALTER TABLE payrollcheck.memberships
      ADD CONSTRAINT memberships_tenant_id_fkey
      FOREIGN KEY (tenant_id) REFERENCES payrollcheck.tenants(tenant_id);
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 3. Defensive column guards for the other six tables (dev-verified columns).
--    On a fresh repo-SQL database every column below already exists, so this
--    section is a no-op there; it only helps a stale database catch up.
--    Columns are added nullable (no NOT NULL without a default) so existing
--    rows are never rejected; the NOT NULL / DEFAULT / CHECK definitions live
--    in the deny-by-default and sessions schema files.
-- ---------------------------------------------------------------------------
ALTER TABLE payrollcheck.tenants
  ADD COLUMN IF NOT EXISTS tenant_id uuid,
  ADD COLUMN IF NOT EXISTS tenant_type text,
  ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();

ALTER TABLE payrollcheck.reports
  ADD COLUMN IF NOT EXISTS report_id uuid,
  ADD COLUMN IF NOT EXISTS business_tenant_id uuid,
  ADD COLUMN IF NOT EXISTS client_id text,
  ADD COLUMN IF NOT EXISTS status text,
  ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();

ALTER TABLE payrollcheck.client_grants
  ADD COLUMN IF NOT EXISTS grant_id uuid,
  ADD COLUMN IF NOT EXISTS firm_tenant_id uuid,
  ADD COLUMN IF NOT EXISTS business_tenant_id uuid,
  ADD COLUMN IF NOT EXISTS scopes text[],
  ADD COLUMN IF NOT EXISTS status text,
  ADD COLUMN IF NOT EXISTS requested_by_subject text,
  ADD COLUMN IF NOT EXISTS approved_by_subject text,
  ADD COLUMN IF NOT EXISTS revoked_by_subject text,
  ADD COLUMN IF NOT EXISTS requested_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS approved_at timestamptz,
  ADD COLUMN IF NOT EXISTS revoked_at timestamptz;

ALTER TABLE payrollcheck.access_audit
  ADD COLUMN IF NOT EXISTS event_id uuid,
  ADD COLUMN IF NOT EXISTS request_id text,
  ADD COLUMN IF NOT EXISTS actor_subject_id text,
  ADD COLUMN IF NOT EXISTS report_id uuid,
  ADD COLUMN IF NOT EXISTS action text,
  ADD COLUMN IF NOT EXISTS allowed boolean,
  ADD COLUMN IF NOT EXISTS reason text,
  ADD COLUMN IF NOT EXISTS occurred_at timestamptz NOT NULL DEFAULT now();

ALTER TABLE payrollcheck.sessions
  ADD COLUMN IF NOT EXISTS session_id text,
  ADD COLUMN IF NOT EXISTS previous_session_id text,
  ADD COLUMN IF NOT EXISTS grace_until timestamptz,
  ADD COLUMN IF NOT EXISTS user_id text,
  ADD COLUMN IF NOT EXISTS auth_user_id uuid,
  ADD COLUMN IF NOT EXISTS aal2 boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS rotated_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS last_seen_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS revoked boolean NOT NULL DEFAULT false;

ALTER TABLE payrollcheck.auth_limits
  ADD COLUMN IF NOT EXISTS key text,
  ADD COLUMN IF NOT EXISTS value jsonb,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

-- ---------------------------------------------------------------------------
-- 4. Indexes (dev-verified). CREATE INDEX IF NOT EXISTS makes each a no-op
--    where the repo SQL files already created it.
-- ---------------------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS client_grants_one_active_per_pair
  ON payrollcheck.client_grants (firm_tenant_id, business_tenant_id)
  WHERE status = 'active';

CREATE UNIQUE INDEX IF NOT EXISTS sessions_previous_session_id_key
  ON payrollcheck.sessions (previous_session_id);

CREATE INDEX IF NOT EXISTS sessions_by_user
  ON payrollcheck.sessions (user_id);

CREATE INDEX IF NOT EXISTS sessions_expiry
  ON payrollcheck.sessions (expires_at);

CREATE INDEX IF NOT EXISTS sessions_by_previous
  ON payrollcheck.sessions (previous_session_id)
  WHERE previous_session_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- ---------------------------------------------------------------------------
-- 5. The two anti-tamper triggers from docs/sql/payrollcheck-rls-policies.sql
--    (prevent_membership_role_change on memberships and
--    prevent_client_grant_reassignment on client_grants, with their
--    functions) are DELIBERATELY KEPT, not dropped. The live dev schema
--    happens to lack them, but tests/sql/payrollcheck-rls-regression.sql
--    requires them: check 19 (membership role is immutable on UPDATE) is
--    stopped only by prevent_membership_role_change, and check 16 (grant
--    scopes are immutable on UPDATE) is stopped only by
--    prevent_client_grant_reassignment. Dropping them made the regression
--    test fail at line 492 with a duplicate-key error on
--    client_grants_one_active_per_pair (verified 2026-11-25 on disposable
--    Postgres 16). Dev's missing triggers are therefore a dev-side gap to
--    be fixed on dev separately -- this migration does not replicate it,
--    and it does not touch dev at all. The triggers are created by step 4
--    of the apply order above; this migration leaves them alone.
-- ---------------------------------------------------------------------------

-- 6. What this migration deliberately does NOT change (all verified
--    identical between the repo SQL files and dev, so no step is needed):
--      * all 15 RLS policies for role payrollcheck_app (RLS enabled and
--        forced on all 7 tables), the role itself, and the grants in the
--        RLS file;
--      * the payrollcheck.is_business_owner_of(text, uuid) function;
--      * the two anti-tamper triggers and their functions (see section 5);
--      * the CHECK constraints on tenants, reports, client_grants,
--        access_audit, sessions and auth_limits;
--      * the primary keys and the foreign keys on reports and client_grants;
--      * the legacy memberships columns (id, subject, created_at,
--        updated_at) on a prod-shaped database: they are left in place,
--        unused by the code, so no data is dropped by this migration.
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  RAISE NOTICE 'payrollcheck schema reconciliation migration applied (idempotent).';
END $$;
