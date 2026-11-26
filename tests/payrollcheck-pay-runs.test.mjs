import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PAY_RUN_ACTIONS,
  parsePayRunRequest,
  calculatePayRunLines,
  toPayRunResponse,
  createPayRunLoader,
} from '../src/payrollcheck/payrollcheck-pay-runs.mjs';
import { createPayRunAccessHandler } from '../src/payrollcheck/payrollcheck-pay-runs-access.mjs';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const EMP = '33333333-3333-4333-8333-333333333333';
const RUN = '44444444-4444-4444-8444-444444444444';

test('pay-run actions and request parsing', () => {
  assert.deepEqual([...PAY_RUN_ACTIONS], ['preview', 'create', 'list', 'get', 'delete', 'finalize']);
  assert.equal(parsePayRunRequest({ action: 'preview', tenantId: A }).ok, true);
  assert.equal(parsePayRunRequest({ action: 'get', tenantId: A, payRunId: RUN }).ok, true);
  assert.equal(parsePayRunRequest({ action: 'get', tenantId: A, payRunId: 'bad' }).ok, false);
});

test('pay-run totals reconcile to computed lines and never expose SSNs', () => {
  const result = calculatePayRunLines({
    employees: [{
      employee_id: EMP,
      pay_type: 'salary',
      pay_rate: '52000',
      pay_frequency: 'biweekly',
      filing_status: 'single',
    }],
  });
  assert.equal(result.lines.length, 1);
  assert.equal(result.totals.gross, 2000);
  assert.equal(Math.round((result.totals.federalWithholding + result.totals.socialSecurity +
    result.totals.medicare + result.totals.additionalMedicare) * 100) / 100,
    Math.round((result.totals.gross - result.totals.net) * 100) / 100);
  const response = toPayRunResponse({
    pay_run_id: RUN,
    tenant_id: A,
    status: 'draft',
    pay_period_start: '2026-11-01',
    pay_period_end: '2026-11-15',
    pay_date: '2026-11-20',
    frequency: 'biweekly',
    gross_total: '2000',
    federal_withholding_total: '156.15',
    fica_total: '153.00',
    net_total: '1690.85',
  }, [{
    line_id: '33333333-3333-4333-8333-333333333333',
    pay_run_id: RUN,
    employee_id: EMP,
    hours: null,
    filing_status: 'single',
    gross: '2000',
    federal_withholding: '156.15',
    social_security: '124',
    medicare: '29',
    additional_medicare: '0',
    net_pay: '1690.85',
  }]);
  assert.equal(JSON.stringify(response).includes(EMP), true);
  assert.equal(JSON.stringify(response).includes('ssn'), false);
});

test('pay-run access is tenant-scoped and finalization is irreversible', async () => {
  const audits = [];
  let run = {
    pay_run_id: RUN, tenant_id: A, status: 'draft',
    pay_period_start: '2026-11-01', pay_period_end: '2026-11-15',
    pay_date: '2026-11-20', frequency: 'biweekly',
  };
  const handler = createPayRunAccessHandler({
    getVerifiedUser: async () => ({ id: 'auth-1', email_confirmed_at: '2026-01-01' }),
    requireAal2: async () => true,
    resolveSubjectId: async () => 'subject-1',
    recordAudit: async (x) => audits.push(x),
    checkRateLimit: async () => ({ allowed: true }),
    getSession: async () => ({ authUserId: 'auth-1' }),
    generateId: () => 'req-1',
    loadMemberships: async () => [{ tenantId: A, role: 'business_owner' }],
    previewPayRun: async () => ({ run: run, lines: [], totals: {} }),
    createPayRun: async () => run,
    listPayRuns: async () => [run],
    getPayRun: async (_tenant, id) => id === RUN ? run : null,
    deletePayRun: async (_tenant, id) => id === RUN ? run : null,
    loadPayRunLines: async () => [],
    finalizePayRun: async (_tenant, id) => {
      if (run.status === 'final') return null;
      run = { ...run, status: 'final', finalized_at: '2026-11-20T00:00:00Z' };
      return run;
    },
  });
  const base = { accessToken: 'session', sessionId: 'session', tenantId: A, requestId: 'r1' };
  const finalized = await handler.handlePayRunAccess({ ...base, action: 'finalize', payRunId: RUN });
  assert.equal(finalized.payRun.status, 'final');
  const again = await handler.handlePayRunAccess({ ...base, action: 'finalize', payRunId: RUN });
  assert.equal(again.status, 404);
  const crossTenant = await handler.handlePayRunAccess({ ...base, tenantId: B, action: 'list' });
  assert.equal(crossTenant.status, 404);
  assert.ok(audits.every((row) => row.action === 'pay_run_read' || row.action === 'pay_run_write'));
});

test('pay-run loader requires injected query and performs tenant-scoped SQL', async () => {
  const calls = [];
  const query = async (text, values) => {
    calls.push({ text, values });
    if (text.includes('FROM payrollcheck.memberships')) return { rows: [{ tenant_id: A, role: 'business_owner' }] };
    if (text.includes('FROM payrollcheck.payroll_pay_runs')) return { rows: [{ pay_run_id: RUN, tenant_id: A, status: 'draft' }] };
    return { rows: [] };
  };
  const loader = createPayRunLoader({ query });
  assert.deepEqual(await loader.loadMemberships('subject-1'), [{ tenantId: A, role: 'business_owner' }]);
  assert.equal(await loader.getPayRun({ tenantId: A, payRunId: RUN }).then(Boolean), true);
});
