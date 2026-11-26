-- PayrollCheck 360 - Slice 4 (Pay runs).
BEGIN;

CREATE TABLE IF NOT EXISTS payrollcheck.payroll_pay_runs (
  pay_run_id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES payrollcheck.tenants (tenant_id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'final')),
  pay_period_start date NOT NULL,
  pay_period_end date NOT NULL,
  pay_date date NOT NULL,
  frequency text NOT NULL CHECK (frequency IN ('weekly', 'biweekly', 'semimonthly', 'monthly')),
  gross_total numeric(14, 2) NOT NULL CHECK (gross_total >= 0),
  federal_withholding_total numeric(14, 2) NOT NULL CHECK (federal_withholding_total >= 0),
  fica_total numeric(14, 2) NOT NULL CHECK (fica_total >= 0),
  net_total numeric(14, 2) NOT NULL CHECK (net_total >= 0),
  finalized_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT payroll_pay_runs_pkey PRIMARY KEY (pay_run_id),
  CONSTRAINT payroll_pay_runs_tenant_run_unique UNIQUE (tenant_id, pay_run_id),
  CONSTRAINT payroll_pay_runs_period_valid CHECK (pay_period_end >= pay_period_start),
  CONSTRAINT payroll_pay_runs_finalized_consistent CHECK (
    (status = 'draft' AND finalized_at IS NULL) OR (status = 'final' AND finalized_at IS NOT NULL)
  )
);

CREATE TABLE IF NOT EXISTS payrollcheck.payroll_pay_run_lines (
  line_id uuid NOT NULL DEFAULT gen_random_uuid(),
  pay_run_id uuid NOT NULL,
  tenant_id uuid NOT NULL REFERENCES payrollcheck.tenants (tenant_id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES payrollcheck.payroll_employees (employee_id) ON DELETE RESTRICT,
  hours numeric(8, 2),
  filing_status text NOT NULL CHECK (filing_status IN ('single', 'mfj', 'hoh', 'mfs', 'married')),
  gross numeric(14, 2) NOT NULL CHECK (gross >= 0),
  federal_withholding numeric(14, 2) NOT NULL CHECK (federal_withholding >= 0),
  social_security numeric(14, 2) NOT NULL CHECK (social_security >= 0),
  medicare numeric(14, 2) NOT NULL CHECK (medicare >= 0),
  additional_medicare numeric(14, 2) NOT NULL CHECK (additional_medicare >= 0),
  net_pay numeric(14, 2) NOT NULL CHECK (net_pay >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT payroll_pay_run_lines_pkey PRIMARY KEY (line_id),
  CONSTRAINT payroll_pay_run_lines_run_fk FOREIGN KEY (pay_run_id, tenant_id)
    REFERENCES payrollcheck.payroll_pay_runs (pay_run_id, tenant_id) ON DELETE CASCADE,
  CONSTRAINT payroll_pay_run_lines_employee_fk FOREIGN KEY (employee_id)
    REFERENCES payrollcheck.payroll_employees (employee_id) ON DELETE RESTRICT,
  CONSTRAINT payroll_pay_run_lines_unique UNIQUE (pay_run_id, employee_id)
);

CREATE INDEX IF NOT EXISTS payroll_pay_runs_tenant_status_idx
  ON payrollcheck.payroll_pay_runs (tenant_id, status, pay_period_start DESC);
CREATE INDEX IF NOT EXISTS payroll_pay_run_lines_run_idx
  ON payrollcheck.payroll_pay_run_lines (pay_run_id, employee_id);

ALTER TABLE payrollcheck.payroll_pay_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE payrollcheck.payroll_pay_runs FORCE ROW LEVEL SECURITY;
ALTER TABLE payrollcheck.payroll_pay_run_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE payrollcheck.payroll_pay_run_lines FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE payrollcheck.payroll_pay_runs FROM PUBLIC;
REVOKE ALL ON TABLE payrollcheck.payroll_pay_run_lines FROM PUBLIC;

GRANT SELECT, INSERT, UPDATE, DELETE ON payrollcheck.payroll_pay_runs TO payrollcheck_app;
GRANT SELECT, INSERT, UPDATE ON payrollcheck.payroll_pay_run_lines TO payrollcheck_app;

DROP POLICY IF EXISTS app_payroll_pay_runs_select ON payrollcheck.payroll_pay_runs;
CREATE POLICY app_payroll_pay_runs_select ON payrollcheck.payroll_pay_runs
  FOR SELECT TO payrollcheck_app
  USING (payrollcheck.is_business_owner_of(nullif(current_setting('payrollcheck.current_subject_id', true), ''), tenant_id));
DROP POLICY IF EXISTS app_payroll_pay_runs_insert ON payrollcheck.payroll_pay_runs;
CREATE POLICY app_payroll_pay_runs_insert ON payrollcheck.payroll_pay_runs
  FOR INSERT TO payrollcheck_app
  WITH CHECK (payrollcheck.is_business_owner_of(nullif(current_setting('payrollcheck.current_subject_id', true), ''), tenant_id));
DROP POLICY IF EXISTS app_payroll_pay_runs_update ON payrollcheck.payroll_pay_runs;
CREATE POLICY app_payroll_pay_runs_update ON payrollcheck.payroll_pay_runs
  FOR UPDATE TO payrollcheck_app
  USING (payrollcheck.is_business_owner_of(nullif(current_setting('payrollcheck.current_subject_id', true), ''), tenant_id))
  WITH CHECK (payrollcheck.is_business_owner_of(nullif(current_setting('payrollcheck.current_subject_id', true), ''), tenant_id));
DROP POLICY IF EXISTS app_payroll_pay_runs_delete ON payrollcheck.payroll_pay_runs;
CREATE POLICY app_payroll_pay_runs_delete ON payrollcheck.payroll_pay_runs
  FOR DELETE TO payrollcheck_app
  USING (status = 'draft' AND payrollcheck.is_business_owner_of(nullif(current_setting('payrollcheck.current_subject_id', true), ''), tenant_id));

DROP POLICY IF EXISTS app_payroll_pay_run_lines_select ON payrollcheck.payroll_pay_run_lines;
CREATE POLICY app_payroll_pay_run_lines_select ON payrollcheck.payroll_pay_run_lines
  FOR SELECT TO payrollcheck_app
  USING (payrollcheck.is_business_owner_of(nullif(current_setting('payrollcheck.current_subject_id', true), ''), tenant_id));
DROP POLICY IF EXISTS app_payroll_pay_run_lines_insert ON payrollcheck.payroll_pay_run_lines;
CREATE POLICY app_payroll_pay_run_lines_insert ON payrollcheck.payroll_pay_run_lines
  FOR INSERT TO payrollcheck_app
  WITH CHECK (payrollcheck.is_business_owner_of(nullif(current_setting('payrollcheck.current_subject_id', true), ''), tenant_id));

CREATE OR REPLACE FUNCTION payrollcheck.prevent_payroll_pay_run_tenant_change()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id THEN
    RAISE EXCEPTION 'payroll_pay_runs.tenant_id is immutable';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS payroll_pay_runs_tenant_immutable ON payrollcheck.payroll_pay_runs;
CREATE TRIGGER payroll_pay_runs_tenant_immutable
  BEFORE UPDATE ON payrollcheck.payroll_pay_runs
  FOR EACH ROW EXECUTE FUNCTION payrollcheck.prevent_payroll_pay_run_tenant_change();

CREATE OR REPLACE FUNCTION payrollcheck.prevent_payroll_pay_run_line_tenant_change()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id THEN
    RAISE EXCEPTION 'payroll_pay_run_lines.tenant_id is immutable';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS payroll_pay_run_lines_tenant_immutable ON payrollcheck.payroll_pay_run_lines;
CREATE TRIGGER payroll_pay_run_lines_tenant_immutable
  BEFORE UPDATE ON payrollcheck.payroll_pay_run_lines
  FOR EACH ROW EXECUTE FUNCTION payrollcheck.prevent_payroll_pay_run_line_tenant_change();

ALTER TABLE payrollcheck.access_audit DROP CONSTRAINT IF EXISTS access_audit_action_check;
ALTER TABLE payrollcheck.access_audit ADD CONSTRAINT access_audit_action_check CHECK (
  action IN (
    'view_report', 'review_finding', 'dashboard_read', 'company_read', 'company_write',
    'employee_read', 'employee_write', 'pay_run_read', 'pay_run_write'
  )
);
COMMIT;
