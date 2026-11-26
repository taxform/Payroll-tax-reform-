-- PayrollCheck 360 - Slice 3 (Employees).
-- Creates the payrollcheck.payroll_employees table. The app reads and writes
-- employees only through the payrollcheck_app role; the RLS policies live in
-- docs/sql/payrollcheck-rls-policies.sql (business-owner-only, no DELETE).
-- A business can create, list and update its own employees and deactivate
-- them (status 'inactive'); there is no DELETE. No pay math happens in this
-- slice: filing status, allowances / extra withholding, pay rate and pay
-- type are stored for later slices to use.
--
-- Employee SSNs are sealed by the app layer with AES-256-GCM before they
-- reach the database (see src/payrollcheck/payrollcheck-ssn.mjs) and are
-- stored here as an opaque sealed blob (ssn_encrypted). Only the last four
-- digits are stored in the clear (ssn_last_four), for display, and the API
-- never returns a full SSN.

BEGIN;

CREATE TABLE IF NOT EXISTS payrollcheck.payroll_employees (
  employee_id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES payrollcheck.tenants (tenant_id) ON DELETE CASCADE,
  first_name text NOT NULL CHECK (char_length(first_name) >= 1 AND char_length(first_name) <= 100),
  last_name text NOT NULL CHECK (char_length(last_name) >= 1 AND char_length(last_name) <= 100),
  ssn_encrypted text NOT NULL CHECK (char_length(ssn_encrypted) >= 1),
  ssn_last_four char(4) NOT NULL CHECK (ssn_last_four ~ '^[0-9]{4}$'),
  filing_status text NOT NULL CHECK (filing_status IN ('single', 'mfj', 'hoh', 'mfs')),
  allowances integer NOT NULL DEFAULT 0 CHECK (allowances >= 0 AND allowances <= 99),
  extra_withholding numeric(12, 2) NOT NULL DEFAULT 0 CHECK (extra_withholding >= 0),
  pay_rate numeric(12, 2) NOT NULL CHECK (pay_rate > 0),
  pay_type text NOT NULL CHECK (pay_type IN ('hourly', 'salary')),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT payroll_employees_pkey PRIMARY KEY (employee_id)
);

CREATE INDEX IF NOT EXISTS payroll_employees_tenant_status_idx
  ON payrollcheck.payroll_employees (tenant_id, status);

COMMENT ON TABLE payrollcheck.payroll_employees IS
  'PayrollCheck 360 employees (Slice 3). One row per employee; tenant_id scopes the row to its business. SSNs are stored sealed (AES-256-GCM, app layer) and are never returned in full.';

ALTER TABLE payrollcheck.payroll_employees ENABLE ROW LEVEL SECURITY;
ALTER TABLE payrollcheck.payroll_employees FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE payrollcheck.payroll_employees FROM PUBLIC;

CREATE OR REPLACE FUNCTION payrollcheck.set_payroll_employees_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS payroll_employees_updated_at ON payrollcheck.payroll_employees;
CREATE TRIGGER payroll_employees_updated_at
  BEFORE UPDATE ON payrollcheck.payroll_employees
  FOR EACH ROW EXECUTE FUNCTION payrollcheck.set_payroll_employees_updated_at();

-- A row never changes tenant: the tenant is fixed at hire and the RLS
-- policies only ever see the row under its own tenant.
CREATE OR REPLACE FUNCTION payrollcheck.prevent_payroll_employee_tenant_change()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id THEN
    RAISE EXCEPTION 'payroll_employees.tenant_id is immutable';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS payroll_employees_tenant_immutable ON payrollcheck.payroll_employees;
CREATE TRIGGER payroll_employees_tenant_immutable
  BEFORE UPDATE ON payrollcheck.payroll_employees
  FOR EACH ROW EXECUTE FUNCTION payrollcheck.prevent_payroll_employee_tenant_change();

-- Audit actions: Slice 3 adds employee_read / employee_write alongside the
-- Slice 2 company actions. Re-declaring the whole list keeps the check in
-- step with src/payrollcheck/payrollcheck-tenancy.mjs (AUDIT_ACTIONS).
ALTER TABLE payrollcheck.access_audit DROP CONSTRAINT IF EXISTS access_audit_action_check;
ALTER TABLE payrollcheck.access_audit
  ADD CONSTRAINT access_audit_action_check CHECK (
    action IN (
      'view_report',
      'review_finding',
      'dashboard_read',
      'company_read',
      'company_write',
      'employee_read',
      'employee_write'
    )
  );

COMMIT;
