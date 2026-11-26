// PayrollCheck 360 - Slice 5 (Tax Center).
//
// The migration is SQL in the repo only: these tests read it from
// docs/sql/payrollcheck-tax-center-schema.sql and assert the contract it must
// keep with src/payrollcheck/payrollcheck-tenancy.mjs. They do not connect
// to a database.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const migration = readFileSync(join(here, '..', 'docs', 'sql', 'payrollcheck-tax-center-schema.sql'), 'utf8');
const tenancy = readFileSync(join(here, '..', 'src', 'payrollcheck', 'payrollcheck-tenancy.mjs'), 'utf8');

test('tax center migration: access_audit check constraint allows tax_center_read alongside the nine existing actions', () => {
  assert.match(migration, /BEGIN;/);
  assert.match(migration, /ALTER TABLE payrollcheck\.access_audit DROP CONSTRAINT IF EXISTS access_audit_action_check;/);
  assert.match(migration, /ALTER TABLE payrollcheck\.access_audit ADD CONSTRAINT access_audit_action_check CHECK \(/);
  for (const action of ['view_report', 'review_finding', 'dashboard_read', 'company_read', 'company_write', 'employee_read', 'employee_write', 'pay_run_read', 'pay_run_write', 'tax_center_read']) {
    assert.match(migration, new RegExp(`'${action}'`));
  }
  assert.match(migration, /COMMIT;/);
});

test('tax center migration: constraint action list matches AUDIT_ACTIONS in payrollcheck-tenancy.mjs', () => {
  const auditActionsMatch = tenancy.match(/AUDIT_ACTIONS = \[([^\]]+)\]/);
  assert.ok(auditActionsMatch, 'AUDIT_ACTIONS list not found in payrollcheck-tenancy.mjs');
  const auditActions = [...auditActionsMatch[1].matchAll(/'([^']+)'/g)].map((match) => match[1]);
  assert.equal(auditActions.length, 10);
  assert.ok(auditActions.includes('tax_center_read'));

  const constraintMatch = migration.match(/ADD CONSTRAINT access_audit_action_check CHECK \(([\s\S]*?)\);\s*COMMIT;/);
  assert.ok(constraintMatch, 'access_audit_action_check definition not found in migration');
  const constraintActions = [...constraintMatch[1].matchAll(/'([^']+)'/g)].map((match) => match[1]);
  assert.deepEqual(constraintActions, auditActions);
});
