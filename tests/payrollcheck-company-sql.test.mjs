// Company profile (Slice 2): the migration and RLS policies in docs/sql/.
// These are static assertions over the SQL files; the migration itself is
// validated against a disposable Postgres before it ships (see the PR).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const migration = readFileSync(new URL('../docs/sql/payrollcheck-companies-schema.sql', import.meta.url), 'utf8');
const policies = readFileSync(new URL('../docs/sql/payrollcheck-rls-policies.sql', import.meta.url), 'utf8');

test('companies migration: one row per tenant, RLS deny-by-default, EIN and pay schedule constrained', () => {
  assert.ok(migration.includes('CREATE TABLE IF NOT EXISTS payrollcheck.payroll_companies'));
  assert.ok(migration.includes('CONSTRAINT payroll_companies_one_row_per_tenant UNIQUE (tenant_id)'));
  assert.ok(migration.includes('REFERENCES payrollcheck.tenants(tenant_id) ON DELETE CASCADE'));
  assert.ok(migration.includes('ALTER TABLE payrollcheck.payroll_companies ENABLE ROW LEVEL SECURITY'));
  assert.ok(migration.includes('ALTER TABLE payrollcheck.payroll_companies FORCE ROW LEVEL SECURITY'));
  assert.ok(migration.includes('REVOKE ALL ON payrollcheck.payroll_companies FROM PUBLIC'));
  assert.ok(migration.includes("ein ~ '^[0-9]{9}$'"));
  assert.ok(migration.includes("pay_schedule IN ('weekly', 'biweekly', 'semi_monthly', 'monthly')"));
  assert.ok(migration.includes("state ~ '^[A-Z]{2}$'"));
  assert.ok(migration.includes("postal_code ~ '^[0-9]{5}(-[0-9]{4})?$'"));
  assert.ok(migration.includes('BEGIN;'));
  assert.ok(migration.includes('COMMIT;'));
  assert.ok(migration.includes("'company_read', 'company_write'"));
  assert.ok(!migration.includes('IRS'));
});

test('companies policies: business-owner-only select/insert/update, no delete, no firm branch', () => {
  assert.ok(policies.includes('GRANT SELECT, INSERT, UPDATE ON payrollcheck.payroll_companies TO payrollcheck_app'));
  for (const name of ['app_payroll_companies_select', 'app_payroll_companies_insert', 'app_payroll_companies_update']) {
    assert.ok(policies.includes(name), name);
  }
  assert.ok(!policies.includes('app_payroll_companies_delete'));
  assert.ok(policies.includes("is_business_owner_of(nullif(current_setting('payrollcheck.current_subject_id', true), ''), tenant_id)"));
  assert.ok(!/IRS verif|verified by the IRS|\bTDS\b|\bIVES\b/i.test(migration));
  assert.ok(!/IRS verif|verified by the IRS|\bTDS\b|\bIVES\b/i.test(policies));
});
