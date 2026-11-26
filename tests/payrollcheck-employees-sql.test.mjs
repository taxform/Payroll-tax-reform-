// PayrollCheck 360 - Slice 3 (Employees).
//
// The migration is SQL in the repo only: these tests read it (and the RLS
// policy file) and assert the contract the database will enforce - a
// payroll_employees table scoped to its tenant, business-owner-only RLS
// policies with no DELETE, and SSNs stored sealed with only the last four
// in the clear. No database access.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const migration = readFileSync(join(here, '..', 'docs', 'sql', 'payrollcheck-employees-schema.sql'), 'utf8');
const policies = readFileSync(join(here, '..', 'docs', 'sql', 'payrollcheck-rls-policies.sql'), 'utf8');

test('employees migration: one row per employee, RLS deny-by-default, SSN sealed with only the last four in the clear', () => {
  assert.ok(migration.includes('CREATE TABLE IF NOT EXISTS payrollcheck.payroll_employees ('));
  assert.ok(migration.includes('REFERENCES payrollcheck.tenants (tenant_id) ON DELETE CASCADE'));
  assert.ok(migration.includes('CONSTRAINT payroll_employees_pkey PRIMARY KEY (employee_id)'));
  assert.ok(migration.includes('ALTER TABLE payrollcheck.payroll_employees ENABLE ROW LEVEL SECURITY;'));
  assert.ok(migration.includes('ALTER TABLE payrollcheck.payroll_employees FORCE ROW LEVEL SECURITY;'));
  assert.ok(migration.includes('REVOKE ALL ON TABLE payrollcheck.payroll_employees FROM PUBLIC;'));
  assert.ok(migration.includes('ssn_encrypted text NOT NULL'));
  assert.ok(migration.includes("ssn_last_four char(4) NOT NULL CHECK (ssn_last_four ~ '^[0-9]{4}$')"));
  assert.ok(!migration.includes('ssn text'));
  assert.ok(migration.includes("filing_status text NOT NULL CHECK (filing_status IN ('single', 'mfj', 'hoh', 'mfs'))"));
  assert.ok(migration.includes('allowances integer NOT NULL DEFAULT 0 CHECK (allowances >= 0 AND allowances <= 99)'));
  assert.ok(migration.includes('extra_withholding numeric(12, 2) NOT NULL DEFAULT 0 CHECK (extra_withholding >= 0)'));
  assert.ok(migration.includes('pay_rate numeric(12, 2) NOT NULL CHECK (pay_rate > 0)'));
  assert.ok(migration.includes("pay_type text NOT NULL CHECK (pay_type IN ('hourly', 'salary'))"));
  assert.ok(migration.includes("status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive'))"));
  assert.ok(migration.includes('CREATE INDEX IF NOT EXISTS payroll_employees_tenant_status_idx'));
  assert.ok(migration.includes('payroll_employees_tenant_immutable'));
  assert.ok(migration.includes('tenant_id is immutable'));
  assert.ok(migration.includes('BEGIN;'));
  assert.ok(migration.includes('COMMIT;'));
  assert.ok(migration.includes("'employee_read'"));
  assert.ok(migration.includes("'employee_write'"));
  assert.ok(migration.includes("'company_read'"));
  assert.ok(migration.includes("'company_write'"));
});

test('employees policies: business-owner-only select/insert/update, no delete, no firm branch', () => {
  assert.ok(policies.includes('GRANT SELECT, INSERT, UPDATE ON payrollcheck.payroll_employees TO payrollcheck_app;'));
  for (const policy of ['app_payroll_employees_select', 'app_payroll_employees_insert', 'app_payroll_employees_update']) {
    assert.ok(policies.includes(policy), policy);
  }
  assert.ok(!policies.includes('app_payroll_employees_delete'));
  assert.ok(policies.includes("is_business_owner_of(nullif(current_setting('payrollcheck.current_subject_id', true), ''), tenant_id)"));
});
