// Slice 6 — TaxBandits sandbox filing (docs/payrollcheck-360-integration-plan.md).
// The filing migration must carry the same audit-action list as
// src/payrollcheck/payrollcheck-tenancy.mjs, or the filing actions are rejected
// by the prod access_audit check constraint (the Slice 5 tax-center 503).
// Follows tests/payrollcheck-tax-center-sql.test.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { AUDIT_ACTIONS } from '../src/payrollcheck/payrollcheck-tenancy.mjs';

const migration = readFileSync(new URL('../docs/sql/payrollcheck-filing-schema.sql', import.meta.url), 'utf8');

const FILING_AUDIT_ACTIONS = [
  'view_report',
  'review_finding',
  'dashboard_read',
  'company_read',
  'company_write',
  'employee_read',
  'employee_write',
  'pay_run_read',
  'pay_run_write',
  'tax_center_read',
  'filing_read',
  'filing_write',
];

test('filing migration allows every audit action, including the filing actions', () => {
  for (const action of FILING_AUDIT_ACTIONS) {
    assert.ok(migration.includes(`'${action}'`), `the filing migration must allow ${action}`);
  }
});

test('filing migration action list matches AUDIT_ACTIONS exactly', () => {
  assert.equal(AUDIT_ACTIONS.length, 12);
  assert.ok(AUDIT_ACTIONS.includes('filing_read'));
  assert.ok(AUDIT_ACTIONS.includes('filing_write'));
  const match = migration.match(/check \(action in \(([^)]*)\)\)/);
  assert.ok(match, 'the filing migration must define the access_audit action check');
  const constraintActions = match[1].split(',').map((action) => action.trim().replaceAll("'", ''));
  assert.deepEqual(constraintActions, AUDIT_ACTIONS);
});

test('filing migration creates the tenant-scoped filings queue', () => {
  assert.match(migration, /create table if not exists payrollcheck\.tax_filings/);
  assert.ok(migration.includes("form in ('941', '940', 'W-2')"));
  assert.ok(migration.includes("status in ('queued', 'submitted', 'accepted', 'rejected', 'failed')"));
  assert.match(migration, /alter table payrollcheck\.tax_filings enable row level security/);
  assert.ok(migration.includes('app_payrollcheck_rw_tax_filings'));
  assert.ok(migration.includes('payrollcheck.current_tenant_id()'));
});

test('filing migration adds the missing company contact fields', () => {
  for (const column of ['contact_email', 'contact_phone', 'business_type', 'signing_authority']) {
    assert.ok(migration.includes(column), `the filing migration must add ${column}`);
  }
});

test('filing migration never stores a credential or a signing PIN', () => {
  assert.doesNotMatch(migration, /client_secret|user_token|signing.?pin|8879/i);
});
