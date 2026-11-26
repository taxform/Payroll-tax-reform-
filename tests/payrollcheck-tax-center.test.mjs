import test from 'node:test';
import assert from 'node:assert/strict';
import {
  TAX_CENTER_ACTIONS,
  parseTaxCenterRequest,
  buildTaxCenterSummary,
  createTaxCenterLoader,
} from '../src/payrollcheck/payrollcheck-tax-center.mjs';
import { createTaxCenterAccessHandler } from '../src/payrollcheck/payrollcheck-tax-center-access.mjs';

const A = '11111111-1111-4111-8111-111111111111';
const EMP = '33333333-3333-4333-8333-333333333333';
const RUN1 = '44444444-4444-4444-8444-444444444444';
const RUN2 = '55555555-5555-4555-8555-555555555555';
const RUN3 = '66666666-6666-4666-8666-666666666666';
const RUN4 = '77777777-7777-4777-8777-777777777777';

function runRow(payRunId, payDate, status, gross, federal, fica, net) {
  return {
    pay_run_id: payRunId,
    tenant_id: A,
    status,
    pay_period_start: payDate,
    pay_period_end: payDate,
    pay_date: payDate,
    frequency: 'biweekly',
    gross_total: gross,
    federal_withholding_total: federal,
    fica_total: fica,
    net_total: net,
    finalized_at: null,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
  };
}

function lineRow(payRunId, gross, federal, socialSecurity, medicare, net) {
  return {
    line_id: `${payRunId}-line`,
    pay_run_id: payRunId,
    tenant_id: A,
    employee_id: EMP,
    hours: 80,
    filing_status: 'single',
    gross,
    federal_withholding: federal,
    social_security: socialSecurity,
    medicare,
    additional_medicare: '0',
    net_pay: net,
    created_at: '2026-01-01T00:00:00.000Z',
  };
}

const RUNS = [
  runRow(RUN1, '2026-07-15', 'final', '3500', '256.15', '267.75', '2976.10'),
  runRow(RUN2, '2026-08-14', 'final', '2000', '156.15', '153', '1690.85'),
  runRow(RUN3, '2026-10-02', 'final', '1000', '50', '76.50', '873.50'),
  runRow(RUN4, '2026-07-31', 'draft', '5000', '400', '382.50', '4217.50'),
];

const LINES = {
  [RUN1]: [
    lineRow(RUN1, '2000', '156.15', '124', '29', '1690.85'),
    lineRow(RUN1, '1500', '100', '93', '21.75', '1285.25'),
  ],
  [RUN2]: [lineRow(RUN2, '2000', '156.15', '124', '29', '1690.85')],
  [RUN3]: [lineRow(RUN3, '1000', '50', '62', '14.50', '873.50')],
  [RUN4]: [lineRow(RUN4, '5000', '400', '310', '72.50', '4217.50')],
};

test('tax-center actions and request parsing', () => {
  assert.deepEqual([...TAX_CENTER_ACTIONS], ['summary']);
  assert.equal(parseTaxCenterRequest({ action: 'summary', tenantId: A }).ok, true);
  assert.equal(parseTaxCenterRequest({ action: 'summary' }).ok, true);
  assert.equal(parseTaxCenterRequest({ action: 'summary', tenantId: A }).tenantId, A);
  assert.equal(parseTaxCenterRequest({ action: 'summary' }).tenantId, null);
  assert.equal(parseTaxCenterRequest({ action: 'file', tenantId: A }).ok, false);
  assert.equal(parseTaxCenterRequest({ action: 'summary', tenantId: 'bad' }).ok, false);
  assert.equal(parseTaxCenterRequest(null).ok, false);
});

test('tax center aggregates finalized pay runs into 941 quarters and the 940 year', () => {
  const summary = buildTaxCenterSummary({ runs: RUNS, linesByPayRunId: LINES });
  assert.equal(summary.form941.length, 2);
  const q3 = summary.form941.find((entry) => entry.period === '2026-Q3');
  assert.equal(q3.form, '941');
  assert.equal(q3.year, 2026);
  assert.equal(q3.quarter, 3);
  assert.equal(q3.payRunCount, 2);
  assert.equal(q3.wages, 5500);
  assert.equal(q3.federalWithholding, 412.30);
  assert.equal(q3.socialSecurity, 341);
  assert.equal(q3.medicare, 79.75);
  assert.equal(q3.additionalMedicare, 0);
  assert.equal(q3.fica, 420.75);
  assert.equal(q3.totalTax, 833.05);
  assert.equal(q3.reconciled, true);
  assert.deepEqual(q3.depositDates, ['2026-07-15', '2026-08-14']);
  assert.deepEqual(q3.deposits.map((deposit) => deposit.payRunId), [RUN1, RUN2]);
  assert.equal(q3.deposits[0].totalTax, 523.90);
  assert.equal(q3.deposits[1].totalTax, 309.15);
  const q4 = summary.form941.find((entry) => entry.period === '2026-Q4');
  assert.equal(q4.wages, 1000);
  assert.equal(q4.federalWithholding, 50);
  assert.equal(q4.fica, 76.50);
  assert.equal(q4.totalTax, 126.50);
  assert.equal(q4.payRunCount, 1);
  assert.deepEqual(q4.depositDates, ['2026-10-02']);
  assert.equal(summary.form940.length, 1);
  const annual = summary.form940[0];
  assert.equal(annual.form, '940');
  assert.equal(annual.year, 2026);
  assert.equal(annual.period, '2026');
  assert.equal(annual.payRunCount, 3);
  assert.equal(annual.wages, 6500);
  assert.equal(annual.federalWithholding, 462.30);
  assert.equal(annual.socialSecurity, 403);
  assert.equal(annual.medicare, 94.25);
  assert.equal(annual.fica, 497.25);
  assert.equal(annual.totalTax, 959.55);
  assert.equal(annual.reconciled, true);
  assert.deepEqual(annual.depositDates, ['2026-07-15', '2026-08-14', '2026-10-02']);
});

test('tax center excludes draft pay runs and reports a header mismatch as unreconciled', () => {
  const mismatched = RUNS.map((run) => (run.pay_run_id === RUN2 ? { ...run, gross_total: '1999' } : run));
  const summary = buildTaxCenterSummary({ runs: mismatched, linesByPayRunId: LINES });
  const q3 = summary.form941.find((entry) => entry.period === '2026-Q3');
  assert.equal(q3.wages, 5500);
  assert.equal(q3.reconciled, false);
  const annual = summary.form940[0];
  assert.equal(annual.reconciled, false);
  const q4 = summary.form941.find((entry) => entry.period === '2026-Q4');
  assert.equal(q4.reconciled, true);
  const empty = buildTaxCenterSummary({ runs: [], linesByPayRunId: {} });
  assert.deepEqual(empty, { form941: [], form940: [] });
});

test('tax center loader reads finalized pay runs scoped to one tenant', async () => {
  const calls = [];
  const query = async (sql, params) => {
    calls.push({ sql, params });
    if (sql.includes('payrollcheck.memberships')) return { rows: [{ tenant_id: A, role: 'business_owner' }] };
    if (sql.includes("status = 'final'")) return { rows: RUNS.filter((run) => run.status === 'final') };
    if (sql.includes('payroll_pay_run_lines')) return { rows: LINES[params[1]] ?? [] };
    return { rows: [] };
  };
  const loader = createTaxCenterLoader({ query });
  assert.deepEqual(await loader.loadMemberships('subject-1'), [{ tenantId: A, role: 'business_owner' }]);
  const summary = await loader.loadTaxCenter(A);
  assert.equal(summary.tenantId, A);
  assert.equal(summary.form941.length, 2);
  assert.equal(summary.form941[0].period, '2026-Q3');
  assert.equal(summary.form941[0].wages, 5500);
  assert.equal(summary.form940[0].wages, 6500);
  const finalizedCall = calls.find((call) => call.sql.includes("status = 'final'"));
  assert.ok(finalizedCall);
  assert.ok(finalizedCall.sql.includes('tenant_id = $1'));
  assert.deepEqual(finalizedCall.params, [A]);
  assert.ok(calls.every((call) => !call.sql.includes("status = 'draft'")));
  assert.throws(() => createTaxCenterLoader({}), /query function is required/);
});

test('tax center access allows the business owner and refuses other roles', async () => {
  const taxCenter = buildTaxCenterSummary({ runs: RUNS, linesByPayRunId: LINES });
  const base = {
    getVerifiedUser: async () => ({ id: 'auth-1', email_confirmed_at: '2026-01-01T00:00:00Z' }),
    requireAal2: async () => true,
    resolveSubjectId: async () => 'subject-1',
    recordAudit: async () => {},
    checkRateLimit: async () => ({ allowed: true }),
    getSession: async () => ({ authUserId: 'auth-1' }),
    generateId: () => 'req-1',
    loadTaxCenter: async (tenantId) => ({ tenantId, ...taxCenter }),
  };
  const owner = createTaxCenterAccessHandler({
    ...base,
    loadMemberships: async () => [{ tenantId: A, role: 'business_owner' }],
  });
  const allowed = await owner.handleTaxCenterAccess({
    accessToken: 'token', sessionId: 'session-1', tenantId: A, action: 'summary', requestId: 'req-1', clientIp: '127.0.0.1',
  });
  assert.equal(allowed.status, 200);
  assert.equal(allowed.ok, true);
  assert.equal(allowed.taxCenter.form941.length, 2);
  assert.equal(allowed.taxCenter.form940[0].wages, 6500);
  const otherRole = createTaxCenterAccessHandler({
    ...base,
    loadMemberships: async () => [{ tenantId: A, role: 'member' }],
  });
  const refused = await otherRole.handleTaxCenterAccess({
    accessToken: 'token', sessionId: 'session-1', tenantId: A, action: 'summary', requestId: 'req-1', clientIp: '127.0.0.1',
  });
  assert.equal(refused.status, 404);
  assert.equal(refused.ok, false);
  assert.equal(refused.reason, 'not_found');
  const limited = createTaxCenterAccessHandler({
    ...base,
    checkRateLimit: async () => ({ allowed: false }),
    loadMemberships: async () => [{ tenantId: A, role: 'business_owner' }],
  });
  const rateLimited = await limited.handleTaxCenterAccess({
    accessToken: 'token', sessionId: 'session-1', tenantId: A, action: 'summary', requestId: 'req-1', clientIp: '127.0.0.1',
  });
  assert.equal(rateLimited.status, 429);
  assert.equal(rateLimited.reason, 'rate_limited');
});
