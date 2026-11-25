-- PayrollCheck company profiles (Slice 2).
-- One row per tenant in payrollcheck.payroll_companies: the business's own
-- company profile (legal name, EIN, address, pay schedule). The EIN is stored
-- as nine digits and is never displayed in full; only its last four digits
-- are ever returned to the app (see src/payrollcheck/payrollcheck-company.mjs).
-- Development schema for the Supabase dev project; follows
-- docs/sql/payrollcheck-deny-by-default-schema.sql. RLS is deny-by-default
-- (ENABLE + FORCE RLS, REVOKE from PUBLIC); the least-privilege server role
-- is granted access and scoped by the app_* policies in
-- docs/sql/payrollcheck-rls-policies.sql (business owner of the tenant only;
-- no firm grant sees a company profile). Apply with:
--   psql -f docs/sql/payrollcheck-companies-schema.sql
-- after docs/sql/payrollcheck-deny-by-default-schema.sql and the
-- payrollcheck-schema-reconciliation migrations. This file lives in the
-- payrollcheck schema (Supabase), NOT the Netlify Database / Drizzle schema
-- (public) -- the two databases are different systems. No TaxBandits.
BEGIN;

CREATE TABLE IF NOT EXISTS payrollcheck.payroll_companies (
  company_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES payrollcheck.tenants(tenant_id) ON DELETE CASCADE,
  legal_name text NOT NULL CHECK (char_length(btrim(legal_name)) BETWEEN 1 AND 255),
  ein text NOT NULL CHECK (ein ~ '^[0-9]{9}$'),
  address_line1 text NOT NULL CHECK (char_length(btrim(address_line1)) BETWEEN 1 AND 255),
  address_line2 text CHECK (address_line2 IS NULL OR char_length(btrim(address_line2)) BETWEEN 1 AND 255),
  city text NOT NULL CHECK (char_length(btrim(city)) BETWEEN 1 AND 100),
  state text NOT NULL CHECK (state ~ '^[A-Z]{2}$'),
  postal_code text NOT NULL CHECK (postal_code ~ '^[0-9]{5}(-[0-9]{4})?$'),
  pay_schedule text NOT NULL CHECK (pay_schedule IN ('weekly', 'biweekly', 'semi_monthly', 'monthly')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT payroll_companies_one_row_per_tenant UNIQUE (tenant_id)
);

ALTER TABLE payrollcheck.payroll_companies ENABLE ROW LEVEL SECURITY;
ALTER TABLE payrollcheck.payroll_companies FORCE ROW LEVEL SECURITY;
REVOKE ALL ON payrollcheck.payroll_companies FROM PUBLIC;

-- Slice 2 adds two access-audit actions. The check is dropped and re-added so
-- the migration is idempotent whether the table was created by
-- payrollcheck-deny-by-default-schema.sql (which constrains the action) or by
-- a reconciliation migration (which leaves it plain text).
ALTER TABLE payrollcheck.access_audit DROP CONSTRAINT IF EXISTS access_audit_action_check;
ALTER TABLE payrollcheck.access_audit ADD CONSTRAINT access_audit_action_check
  CHECK (action IN ('view_report', 'review_finding', 'dashboard_read', 'company_read', 'company_write'));

COMMIT;
