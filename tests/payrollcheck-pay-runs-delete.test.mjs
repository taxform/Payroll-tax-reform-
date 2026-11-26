import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createPayRunAccessHandler } from '../src/payrollcheck/payrollcheck-pay-runs-access.mjs';
import { createPayRunLoader } from '../src/payrollcheck/payrollcheck-pay-runs.mjs';

// Regression test for the live Slice 4 defect (5th smoke test, Nov 26): deleting a
// DRAFT pay run from payrollcheck/app did nothing and the row stayed listed, while
// preview, create, list and finalize all worked.
//
// Root cause: docs/sql/payrollcheck-pay-runs-schema.sql creates the draft-only
// DELETE RLS policy for payrollcheck_app but never grants DELETE on
// payrollcheck.payroll_pay_runs to that role, and the app connects as
// payrollcheck_app (netlify/lib/payrollcheck-auth.mjs). Postgres needs the table
// privilege as well as a permissive RLS policy, so the DELETE issued by the
// loader failed with "permission denied for table payroll_pay_runs" (42501) and
// the access handler answered 503 unavailable instead of 200.
//
// The stub query below enforces the privileges exactly as Postgres does, using
// the GRANT statements in the schema file as its source of truth, so the
// draft-delete test fails while the grant is missing and passes once it is added.
// The finalized-delete test guards the other side of the rule: finalized runs are
// read-only and must be rejected before any DELETE is issued.

const TENANT_ID = '11111111-1111-4111-8111-111111111111';
const DRAFT_ID = '44444444-4444-4444-8444-444444444444';
const FINAL_ID = '55555555-5555-4555-8555-555555555555';

const SCHEMA_SQL = readFileSync(
  new URL('../docs/sql/payrollcheck-pay-runs-schema.sql', import.meta.url),
  'utf8',
);

function grantedPayRunPrivileges() {
  const match = SCHEMA_SQL.match(
    /GRANT\s+([\w,\s]+?)\s+ON\s+payrollcheck\.payroll_pay_runs\s+TO\s+payrollcheck_app\s*;/i,
  );
  if (!match) return [];
  return match[1].split(',').map((privilege) => privilege.trim().toUpperCase()).filter(Boolean);
}

function payRunRow(payRunId, status) {
  return {
    pay_run_id: payRunId,
    tenant_id: TENANT_ID,
    status,
    pay_period_start: '2026-11-01',
    pay_period_end: '2026-11-15',
    pay_date: '2026-11-20',
    frequency: 'biweekly',
    gross_total: '2000',
    federal_withholding_total: '156.15',
    fica_total: '153',
    net_total: '1690.85',
    finalized_at: status === 'final' ? '2026-11-20T00:00:00.000Z' : null,
    created_at: '2026-11-20T00:00:00.000Z',
    updated_at: '2026-11-20T00:00:00.000Z',
  };
}

function createStore() {
  return { rows: [payRunRow(DRAFT_ID, 'draft'), payRunRow(FINAL_ID, 'final')] };
}

function createQuery(store, privileges) {
  return async (text, params = []) => {
    if (text.includes('FROM payrollcheck.memberships')) {
      return { rows: [{ tenant_id: TENANT_ID, role: 'business_owner' }] };
    }
    if (text.startsWith('DELETE FROM payrollcheck.payroll_pay_runs')) {
      if (!privileges.includes('DELETE')) {
        const error = new Error('permission denied for table payroll_pay_runs');
        error.code = '42501';
        throw error;
      }
      const index = store.rows.findIndex(
        (row) => row.tenant_id === params[0] && row.pay_run_id === params[1] && row.status === 'draft',
      );
      if (index === -1) return { rows: [] };
      return { rows: store.rows.splice(index, 1) };
    }
    if (text.includes('FROM payrollcheck.payroll_pay_runs WHERE tenant_id = $1 AND pay_run_id = $2')) {
      return {
        rows: store.rows.filter((row) => row.tenant_id === params[0] && row.pay_run_id === params[1]),
      };
    }
    if (text.includes('FROM payrollcheck.payroll_pay_runs WHERE tenant_id = $1')) {
      return { rows: store.rows.filter((row) => row.tenant_id === params[0]) };
    }
    if (text.includes('FROM payrollcheck.payroll_pay_run_lines')) {
      return { rows: [] };
    }
    throw new Error(`unexpected query: ${text}`);
  };
}

function createHandler(store) {
  const privileges = grantedPayRunPrivileges();
  const query = createQuery(store, privileges);
  const loader = createPayRunLoader({
    query,
    generateId: () => '66666666-6666-4666-8666-666666666666',
  });
  return createPayRunAccessHandler({
    getVerifiedUser: async () => ({ id: 'auth-1', email_confirmed_at: '2026-01-01' }),
    requireAal2: async () => true,
    resolveSubjectId: async () => 'subject-1',
    recordAudit: async () => undefined,
    checkRateLimit: async () => ({ allowed: true }),
    getSession: async () => ({ authUserId: 'auth-1' }),
    generateId: () => 'req-1',
    loadMemberships: (subject) => loader.loadMemberships(subject),
    previewPayRun: (args) => loader.previewPayRun(args),
    createPayRun: (args) => loader.createPayRun(args),
    listPayRuns: (tenantId) => loader.listPayRuns(tenantId),
    getPayRun: (tenantId, payRunId) => loader.getPayRun(tenantId, payRunId),
    loadPayRunLines: (tenantId, payRunId) => loader.loadPayRunLines(tenantId, payRunId),
    deletePayRun: (args) => loader.deletePayRun(args),
    finalizePayRun: (args) => loader.finalizePayRun(args),
  });
}

function accessRequest(action, payRunId) {
  return {
    accessToken: 'session',
    sessionId: 'session',
    tenantId: TENANT_ID,
    requestId: 'r1',
    clientIp: '127.0.0.1',
    action,
    payRunId,
  };
}

test('the pay-runs schema grants DELETE on payroll_pay_runs to payrollcheck_app', () => {
  assert.ok(
    grantedPayRunPrivileges().includes('DELETE'),
    'payrollcheck_app needs DELETE on payroll_pay_runs so a draft pay run can be deleted',
  );
});

test('deleting a draft pay run succeeds and the row is gone', async () => {
  const store = createStore();
  const handler = createHandler(store);
  const result = await handler.handlePayRunAccess(accessRequest('delete', DRAFT_ID));
  assert.equal(result.status, 200);
  assert.equal(result.ok, true);
  assert.equal(result.reason, 'allowed');
  assert.equal(result.payRun.payRunId, DRAFT_ID);
  assert.equal(result.payRun.status, 'draft');
  assert.deepEqual(
    store.rows.map((row) => row.pay_run_id),
    [FINAL_ID],
  );
  const listed = await handler.handlePayRunAccess(accessRequest('list'));
  assert.equal(listed.status, 200);
  assert.deepEqual(
    listed.payRuns.map((payRun) => payRun.payRunId),
    [FINAL_ID],
  );
});

test('deleting a finalized pay run is rejected and the row stays', async () => {
  const store = createStore();
  const handler = createHandler(store);
  const result = await handler.handlePayRunAccess(accessRequest('delete', FINAL_ID));
  assert.equal(result.status, 404);
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'not_found');
  assert.deepEqual(
    store.rows.map((row) => row.pay_run_id),
    [DRAFT_ID, FINAL_ID],
  );
});
