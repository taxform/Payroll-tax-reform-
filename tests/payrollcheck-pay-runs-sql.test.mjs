import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const sql = readFileSync(join(process.cwd(), 'docs/sql/payrollcheck-pay-runs-schema.sql'), 'utf8');

test('pay-runs migration defines both tables with RLS and immutable tenants', () => {
  assert.match(sql, /CREATE TABLE IF NOT EXISTS payrollcheck\.payroll_pay_runs/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS payrollcheck\.payroll_pay_run_lines/);
  assert.match(sql, /ALTER TABLE payrollcheck\.payroll_pay_runs ENABLE ROW LEVEL SECURITY/);
  assert.match(sql, /ALTER TABLE payrollcheck\.payroll_pay_run_lines ENABLE ROW LEVEL SECURITY/);
  assert.match(sql, /tenant_id is immutable/);
  assert.match(sql, /pay_run_read/);
  assert.match(sql, /pay_run_write/);
  assert.match(sql, /app_payroll_pay_runs_select/);
  assert.match(sql, /app_payroll_pay_run_lines_select/);
});
