-- PayrollCheck: companies reconciliation migration (Slice 2 follow-up).
--
-- Why this file exists
-- --------------------
-- docs/sql/payrollcheck-companies-schema.sql (PR #133) declares
--   tenant_id uuid NOT NULL REFERENCES payrollcheck.tenants(tenant_id)
--     ON DELETE CASCADE
-- on payroll_companies, so it needs a unique constraint on
-- payrollcheck.tenants(tenant_id). On a fresh database built from the repo
-- SQL files that holds: tenants.tenant_id is the primary key.
--
-- In production, however, tenants is the legacy shape: the primary key is
-- tenants_pkey on id (uuid, NOT NULL), and tenant_id is a nullable column
-- added by the earlier reconciliation migrations (PR #125 and PR #128),
-- backfilled from id where set, with NO unique constraint. Applying the
-- companies schema to production therefore failed with
--   ERROR: 42830: there is no unique constraint matching given keys for
--   referenced table "tenants"
-- and rolled back completely (2026-11-25). The companies-schema and
-- RLS-policies files are NOT changed by this migration; this file
-- reconciles the legacy shape so they apply verbatim afterwards.
--
-- What this file does (in order)
-- ------------------------------
-- 1. Backfills tenants.tenant_id from id where tenant_id IS NULL.
-- 2. Adds UNIQUE (tenant_id) on tenants (as tenants_tenant_id_key) if no
--    unique or primary-key constraint already covers tenants.tenant_id.
--
-- Idempotency / fresh-database behaviour
-- ---------------------------------------
-- Both steps are guarded and the file is safe to re-run. On a fresh
-- database, where tenant_id is already the primary key, there is no id
-- column to backfill from and the primary key already uniquely covers
-- tenant_id, so the file changes nothing (a no-op). The backfill uses
-- dynamic SQL, because a static reference to tenants.id would fail
-- (ERROR 42703) on a fresh database, where that column does not exist,
-- even inside a guard -- Postgres plans the whole statement first. The
-- unique-constraint step is a DO block that checks pg_constraint: plain
-- ADD CONSTRAINT IF NOT EXISTS is not valid PostgreSQL.
--
-- Apply order
-- -----------
-- Production (PR #125 and PR #128 already applied):
--   1. this file
--   2. docs/sql/payrollcheck-companies-schema.sql
--   3. docs/sql/payrollcheck-rls-policies.sql
-- Fresh database:
--   1. docs/sql/payrollcheck-deny-by-default-schema.sql
--   2. docs/sql/payrollcheck-sessions-schema.sql
--   3. docs/sql/payrollcheck-schema-reconciliation-migration.sql
--   4. docs/sql/payrollcheck-schema-reconciliation-followup-migration.sql
--   5. this file
--   6. docs/sql/payrollcheck-companies-schema.sql
--   7. docs/sql/payrollcheck-rls-policies.sql
--
-- This file touches only payrollcheck.tenants. It does not change any
-- other table, any policy, or the companies-schema / RLS-policies files.

BEGIN;

-- 1. Backfill tenants.tenant_id from id where it is NULL.
--    Guarded on both columns existing, and executed as dynamic SQL so the
--    statement is only planned when the legacy id column exists.
DO $backfill$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'payrollcheck' AND table_name = 'tenants'
      AND column_name = 'id'
  ) AND EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'payrollcheck' AND table_name = 'tenants'
      AND column_name = 'tenant_id'
  ) THEN
    EXECUTE $upd$
      UPDATE payrollcheck.tenants
      SET tenant_id = id
      WHERE tenant_id IS NULL
    $upd$;
  END IF;
END
$backfill$;

-- 2. Add a UNIQUE constraint on tenants.tenant_id if none exists.
--    A primary-key constraint on tenant_id (fresh database) already
--    satisfies this, so check pg_constraint for any unique ('u') or
--    primary-key ('p') constraint whose key is exactly tenants.tenant_id.
DO $unique$
DECLARE
  v_tenant_id_attnum smallint;
BEGIN
  SELECT a.attnum INTO v_tenant_id_attnum
  FROM pg_attribute a
  JOIN pg_class c ON c.oid = a.attrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'payrollcheck'
    AND c.relname = 'tenants'
    AND a.attname = 'tenant_id'
    AND a.attnum > 0
    AND NOT a.attisdropped;

  IF v_tenant_id_attnum IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conrelid = 'payrollcheck.tenants'::regclass
        AND contype IN ('u', 'p')
        AND conkey = ARRAY[v_tenant_id_attnum]
    ) THEN
      EXECUTE $alter$
        ALTER TABLE payrollcheck.tenants
        ADD CONSTRAINT tenants_tenant_id_key UNIQUE (tenant_id)
      $alter$;
    END IF;
  END IF;
END
$unique$;

COMMIT;
