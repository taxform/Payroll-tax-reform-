import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PAYROLLCHECK_APP_MODULES,
  buildDashboardSummary,
  createDashboardLoader,
  parseDashboardRequest,
  resolveDashboardTenant,
} from '../src/payrollcheck/payrollcheck-dashboard.mjs';
import { createDashboardAccessHandler } from '../src/payrollcheck/payrollcheck-dashboard-access.mjs';

// --- Fixture ids -------------------------------------------------------------
const BUSINESS_A = 'aaaaaaaa-1111-4111-8111-111111111111';
const BUSINESS_B = 'bbbbbbbb-2222-4222-8222-222222222222';
const AUTH_USER = '11111111-aaaa-4111-8111-111111111111';
const SESSION_ID = '99999999-aaaa-4999-8999-999999999999';
const SUBJECT = 'usr_aaaaaaaa-1111-4111-8111-111111111111';
const NOW = 1794400000; // epoch seconds; fixed so the tests are deterministic

const MEMBERSHIPS = [
  { tenantId: BUSINESS_A, tenantType: 'business', role: 'owner' },
  { tenantId: BUSINESS_B, tenantType: 'business', role: 'admin' },
];
const COUNTS = { [BUSINESS_A]: 2, [BUSINESS_B]: 1 };
const EMPLOYEE_COUNTS = {
  [BUSINESS_A]: { total: 3, active: 2 },
  [BUSINESS_B]: { total: 1, active: 1 },
};

// --- parseDashboardRequest ---------------------------------------------------
test('parseDashboardRequest: an absent body selects no tenant', () => {
  assert.deepEqual(parseDashboardRequest(undefined), { ok: true, tenantId: null });
  assert.deepEqual(parseDashboardRequest(null), { ok: true, tenantId: null });
  assert.deepEqual(parseDashboardRequest({}), { ok: true, tenantId: null });
});

test('parseDashboardRequest: a UUID tenant id is accepted, anything else is not', () => {
  assert.deepEqual(parseDashboardRequest({ tenantId: BUSINESS_A }), { ok: true, tenantId: BUSINESS_A });
  assert.deepEqual(parseDashboardRequest({ tenantId: 'not-a-uuid' }), { ok: false, error: 'invalid_request' });
  assert.deepEqual(parseDashboardRequest({ tenantId: 123 }), { ok: false, error: 'invalid_request' });
  assert.deepEqual(parseDashboardRequest([]), { ok: false, error: 'invalid_request' });
  assert.deepEqual(parseDashboardRequest('x'), { ok: false, error: 'invalid_request' });
});

// --- resolveDashboardTenant --------------------------------------------------
test('resolveDashboardTenant: no memberships is not_found', () => {
  assert.deepEqual(resolveDashboardTenant({ memberships: [], requestedTenantId: null }), {
    ok: false,
    status: 404,
    error: 'not_found',
  });
});

test('resolveDashboardTenant: no request selects the first membership', () => {
  const resolved = resolveDashboardTenant({ memberships: MEMBERSHIPS, requestedTenantId: null });
  assert.equal(resolved.ok, true);
  assert.equal(resolved.tenant.tenantId, BUSINESS_A);
});

test('resolveDashboardTenant: a requested membership is selected', () => {
  const resolved = resolveDashboardTenant({ memberships: MEMBERSHIPS, requestedTenantId: BUSINESS_B });
  assert.equal(resolved.ok, true);
  assert.equal(resolved.tenant.tenantId, BUSINESS_B);
  assert.equal(resolved.tenant.role, 'admin');
});

test('resolveDashboardTenant: a tenant the caller is not a member of is not_found', () => {
  // The cross-tenant case: the caller asks for a business they do not belong
  // to. The answer is generic — it must not reveal whether that tenant exists.
  const resolved = resolveDashboardTenant({
    memberships: [MEMBERSHIPS[0]],
    requestedTenantId: BUSINESS_B,
  });
  assert.deepEqual(resolved, { ok: false, status: 404, error: 'not_found' });
});

// --- buildDashboardSummary ---------------------------------------------------
test('buildDashboardSummary: counts, totals and the module catalogue', () => {
  const summary = buildDashboardSummary({
    memberships: MEMBERSHIPS,
    reportCountsByTenant: COUNTS,
    employeeCountsByTenant: EMPLOYEE_COUNTS,
    selectedTenantId: BUSINESS_B,
  });
  assert.equal(summary.selectedTenant.tenantId, BUSINESS_B);
  assert.equal(summary.selectedTenant.reportCount, 1);
  assert.deepEqual(summary.totals, { tenants: 2, reports: 3 });
  assert.deepEqual(summary.employees, { totalCount: 1, activeCount: 1 });
  assert.equal(summary.modules.length, 6);
  const compliance = summary.modules.find((m) => m.id === 'compliance-check');
  assert.equal(compliance.status, 'available');
  assert.match(compliance.note, /not proof from IRS records/);
  const company = summary.modules.find((m) => m.id === 'company');
  assert.equal(company.status, 'available');
  const employees = summary.modules.find((m) => m.id === 'employees');
  assert.equal(employees.status, 'available');
  assert.equal(employees.slice, 3);
  const payroll = summary.modules.filter((m) => m.id !== 'compliance-check' && m.id !== 'company' && m.id !== 'employees');
  const payRuns = payroll.find((m) => m.id === 'pay-runs');
  assert.equal(payRuns.status, 'available');
  assert.equal(payRuns.slice, 4);
  const taxCenter = payroll.find((m) => m.id === 'tax-center');
assert.equal(taxCenter.status, 'available');
assert.equal(taxCenter.slice, 5);
const laterPayroll = payroll.filter((m) => m.id !== 'pay-runs' && m.id !== 'tax-center');
  assert.ok(laterPayroll.every((m) => m.status === 'coming_soon'));
  assert.deepEqual(
    laterPayroll.map((m) => m.slice),
    [6],
  );
});

test('buildDashboardSummary: employee counts come from the selected tenant only, and default to zero', () => {
  const withCounts = buildDashboardSummary({
    memberships: MEMBERSHIPS,
    reportCountsByTenant: COUNTS,
    employeeCountsByTenant: EMPLOYEE_COUNTS,
    selectedTenantId: BUSINESS_A,
  });
  assert.deepEqual(withCounts.employees, { totalCount: 3, activeCount: 2 });
  const withoutCounts = buildDashboardSummary({
    memberships: MEMBERSHIPS,
    reportCountsByTenant: COUNTS,
    selectedTenantId: BUSINESS_A,
  });
  assert.deepEqual(withoutCounts.employees, { totalCount: 0, activeCount: 0 });
});

test('buildDashboardSummary: a tenant with no reports counts zero, never another tenant', () => {
  const summary = buildDashboardSummary({
    memberships: [MEMBERSHIPS[0]],
    reportCountsByTenant: {},
    selectedTenantId: BUSINESS_A,
  });
  assert.equal(summary.tenants[0].reportCount, 0);
  assert.deepEqual(summary.totals, { tenants: 1, reports: 0 });
});

const COMPANY_ROW_A = {
  company_id: '11111111-1111-1111-1111-111111111111',
  tenant_id: BUSINESS_A,
  legal_name: 'Acme Widgets LLC',
  ein: '123456789',
  address_line1: '1 Main St',
  address_line2: null,
  city: 'Springfield',
  state: 'IL',
  postal_code: '62701',
  pay_schedule: 'biweekly',
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
};
const COMPANY_ROW_B = {
  company_id: '22222222-2222-2222-2222-222222222222',
  tenant_id: BUSINESS_B,
  legal_name: 'Beta Bakery Inc',
  ein: '987654321',
  address_line1: '2 Oak Ave',
  address_line2: null,
  city: 'Madison',
  state: 'WI',
  postal_code: '53703',
  pay_schedule: 'monthly',
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
};

test('buildDashboardSummary: a set-up company shows its name and masked EIN, never the full EIN', () => {
  const summary = buildDashboardSummary({
    memberships: [{ tenantId: BUSINESS_A, role: 'business_owner', tenantType: 'business' }],
    reportCountsByTenant: {},
    companiesByTenant: { [BUSINESS_A]: COMPANY_ROW_A },
    selectedTenantId: BUSINESS_A,
  });
  assert.deepEqual(summary.company, { isSetUp: true, legalName: 'Acme Widgets LLC', einMasked: '***-**-6789', paySchedule: 'biweekly' });
  assert.ok(!JSON.stringify(summary).includes('123456789'));
});

test('buildDashboardSummary: a company that is not set up is false, and another tenant company never leaks in', () => {
  const summary = buildDashboardSummary({
    memberships: [
      { tenantId: BUSINESS_A, role: 'business_owner', tenantType: 'business' },
      { tenantId: BUSINESS_B, role: 'business_owner', tenantType: 'business' },
    ],
    reportCountsByTenant: {},
    companiesByTenant: { [BUSINESS_B]: COMPANY_ROW_B },
    selectedTenantId: BUSINESS_A,
  });
  assert.deepEqual(summary.company, { isSetUp: false });
  assert.ok(!JSON.stringify(summary).includes('Beta Bakery Inc'));
  assert.ok(!JSON.stringify(summary).includes('987654321'));
});

test('PAYROLLCHECK_APP_MODULES: ids are unique and the catalogue is frozen', () => {
  const ids = PAYROLLCHECK_APP_MODULES.map((m) => m.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(Object.isFrozen(PAYROLLCHECK_APP_MODULES));
  assert.ok(PAYROLLCHECK_APP_MODULES.every((m) => Object.isFrozen(m)));
  assert.ok(!JSON.stringify(PAYROLLCHECK_APP_MODULES).match(/\bIRS verif|\bverified by the IRS\b|\bTDS\b|\bIVES\b/i));
});

// --- createDashboardLoader ---------------------------------------------------
function makeQuery(rowsByKind) {
  const calls = [];
  const query = async (sql, params) => {
    calls.push({ sql, params });
    if (sql.includes('FROM payrollcheck.memberships')) return { rows: rowsByKind.memberships };
    if (sql.includes('FROM payrollcheck.tenants')) return { rows: rowsByKind.tenants.shift() };
    if (sql.includes('FROM payrollcheck.reports')) return { rows: rowsByKind.counts.shift() };
    if (sql.includes('FROM payrollcheck.payroll_companies')) return { rows: rowsByKind.companies.shift() };
    if (sql.includes('FROM payrollcheck.payroll_employees')) return { rows: rowsByKind.employees.shift() };
    throw new Error(`unexpected query: ${sql}`);
  };
  return { query, calls };
}

test('createDashboardLoader: loads memberships, tenant types and counts in order, parameterized', async () => {
  const { query, calls } = makeQuery({
    memberships: [
      { tenant_id: BUSINESS_A, role: 'owner' },
      { tenant_id: BUSINESS_B, role: 'admin' },
    ],
    tenants: [[{ tenant_type: 'business' }], [{ tenant_type: 'business' }]],
    counts: [[{ count: '2' }], [{ count: '1' }]],
    companies: [[COMPANY_ROW_A], [COMPANY_ROW_B]],
    employees: [[{ total: '3', active: '2' }], [{ total: '1', active: '1' }]],
  });
  const loader = createDashboardLoader({ query });
  const loaded = await loader.loadDashboard({ subjectId: SUBJECT });
  assert.deepEqual(loaded, {
    memberships: [
      { tenantId: BUSINESS_A, role: 'owner', tenantType: 'business' },
      { tenantId: BUSINESS_B, role: 'admin', tenantType: 'business' },
    ],
    reportCountsByTenant: { [BUSINESS_A]: 2, [BUSINESS_B]: 1 },
    companiesByTenant: { [BUSINESS_A]: COMPANY_ROW_A, [BUSINESS_B]: COMPANY_ROW_B },
    employeeCountsByTenant: { [BUSINESS_A]: { total: 3, active: 2 }, [BUSINESS_B]: { total: 1, active: 1 } },
  });
  // Memberships first, then one tenant-type + one count per tenant, in order.
  assert.deepEqual(
    calls.map((c) => c.sql.match(/FROM payrollcheck\.(\w+)/)[1]),
    ['memberships', 'tenants', 'reports', 'tenants', 'reports', 'payroll_companies', 'payroll_companies', 'payroll_employees', 'payroll_employees'],
  );
  // Every value travels as a parameter; no id is interpolated into the SQL.
  for (const { sql, params } of calls) {
    assert.ok(!sql.includes(BUSINESS_A) && !sql.includes(BUSINESS_B) && !sql.includes(SUBJECT));
    assert.ok(params.length >= 1);
  }
  assert.deepEqual(calls[0].params, [SUBJECT]);
});

test('createDashboardLoader: a failing employees count degrades to zero instead of failing the load', async () => {
  const { query } = makeQuery({
    memberships: [
      { tenant_id: BUSINESS_A, role: 'owner' },
      { tenant_id: BUSINESS_B, role: 'admin' },
    ],
    tenants: [[{ tenant_type: 'business' }], [{ tenant_type: 'business' }]],
    counts: [[{ count: '2' }], [{ count: '1' }]],
    companies: [[COMPANY_ROW_A], [COMPANY_ROW_B]],
    // No employees rows: the payroll_employees query fails (the Slice 3
    // migration has not been applied), so the counts degrade to zero.
  });
  const loader = createDashboardLoader({ query });
  const loaded = await loader.loadDashboard({ subjectId: SUBJECT });
  assert.deepEqual(loaded.employeeCountsByTenant, {
    [BUSINESS_A]: { total: 0, active: 0 },
    [BUSINESS_B]: { total: 0, active: 0 },
  });
  assert.equal(loaded.companiesByTenant[BUSINESS_A], COMPANY_ROW_A);
});

test('createDashboardLoader: a missing tenant row fails the load (503 upstream)', async () => {
  const { query } = makeQuery({
    memberships: [{ tenant_id: BUSINESS_A, role: 'owner' }],
    tenants: [[]],
    counts: [[{ count: '0' }]],
  });
  const loader = createDashboardLoader({ query });
  await assert.rejects(loader.loadDashboard({ subjectId: SUBJECT }), /tenant lookup failed/);
});

test('createDashboardLoader: a query function is required', () => {
  assert.throws(() => createDashboardLoader({}), /query is required/);
});

// --- createDashboardAccessHandler -------------------------------------------
function makeHandler(overrides = {}) {
  const audits = [];
  const handler = createDashboardAccessHandler({
    getVerifiedUser: async () => ({ id: AUTH_USER, email_confirmed_at: '2026-01-01T00:00:00Z' }),
    requireAal2: async () => true,
    resolveSubjectId: async () => SUBJECT,
    recordAudit: async (args) => {
      audits.push(args);
    },
    checkRateLimit: async () => ({ allowed: true }),
    getSession: async () => ({ authUserId: AUTH_USER, revoked: false }),
    generateId: () => 'req-1',
    now: () => NOW,
    loadDashboard: async () => ({ memberships: MEMBERSHIPS, reportCountsByTenant: COUNTS }),
    ...overrides,
  });
  return { handler, audits };
}

function call(handler, tenantId = null) {
  return handler.handleDashboardAccess({
    accessToken: SESSION_ID,
    sessionId: SESSION_ID,
    tenantId,
    requestId: 'req-1',
    clientIp: '203.0.113.10',
  });
}

test('dashboard access: a member with MFA sees only their own tenants', async () => {
  const { handler, audits } = makeHandler();
  const decision = await call(handler);
  assert.equal(decision.status, 200);
  assert.equal(decision.ok, true);
  assert.equal(decision.dashboard.selectedTenant.tenantId, BUSINESS_A);
  assert.deepEqual(decision.dashboard.totals, { tenants: 2, reports: 3 });
  assert.deepEqual(
    decision.dashboard.tenants.map((t) => t.tenantId),
    [BUSINESS_A, BUSINESS_B],
  );
  // Exactly one audit row, for the allowed decision.
  assert.equal(audits.length, 1);
  assert.deepEqual(audits[0], {
    requestId: 'req-1',
    actorSubjectId: SUBJECT,
    reportId: null,
    action: 'dashboard_read',
    allowed: true,
    reason: 'allowed',
  });
});

test('dashboard access: selecting one of your own tenants works', async () => {
  const { handler } = makeHandler();
  const decision = await call(handler, BUSINESS_B);
  assert.equal(decision.status, 200);
  assert.equal(decision.dashboard.selectedTenant.tenantId, BUSINESS_B);
  assert.equal(decision.dashboard.selectedTenant.reportCount, 1);
});

test('dashboard access: a tenant you are not a member of is not_found, and audited', async () => {
  const { handler, audits } = makeHandler({
    loadDashboard: async () => ({
      memberships: [MEMBERSHIPS[0]],
      reportCountsByTenant: { [BUSINESS_A]: 2 },
    }),
  });
  const decision = await call(handler, BUSINESS_B);
  assert.equal(decision.status, 404);
  assert.equal(decision.ok, false);
  assert.equal(decision.reason, 'not_found');
  assert.equal(decision.dashboard, undefined);
  assert.equal(audits.length, 1);
  assert.equal(audits[0].allowed, false);
  assert.equal(audits[0].reason, 'not_found');
});

test('dashboard access: no memberships at all is not_found', async () => {
  const { handler } = makeHandler({
    loadDashboard: async () => ({ memberships: [], reportCountsByTenant: {} }),
  });
  const decision = await call(handler);
  assert.equal(decision.status, 404);
  assert.equal(decision.reason, 'not_found');
});

test('dashboard access: without MFA the caller is told mfa_required and no audit row is written', async () => {
  const { handler, audits } = makeHandler({ requireAal2: async () => false });
  const decision = await call(handler);
  assert.equal(decision.status, 403);
  assert.equal(decision.reason, 'mfa_required');
  assert.equal(audits.length, 0);
});

test('dashboard access: an anonymous or unconfirmed user is invalid_session', async () => {
  const anonymous = makeHandler({
    getVerifiedUser: async () => ({ id: AUTH_USER, email_confirmed_at: '2026-01-01T00:00:00Z', is_anonymous: true }),
  });
  assert.equal((await call(anonymous.handler)).reason, 'invalid_session');
  const unconfirmed = makeHandler({
    getVerifiedUser: async () => ({ id: AUTH_USER, email_confirmed_at: null }),
  });
  assert.equal((await call(unconfirmed.handler)).status, 401);
});

test('dashboard access: a revoked session, or one owned by someone else, is invalid_session', async () => {
  const revoked = makeHandler({
    getSession: async () => ({ authUserId: AUTH_USER, revoked: true }),
  });
  assert.equal((await call(revoked.handler)).reason, 'invalid_session');
  const otherOwner = makeHandler({
    getSession: async () => ({ authUserId: '22222222-bbbb-4222-8222-222222222222', revoked: false }),
  });
  assert.equal((await call(otherOwner.handler)).status, 401);
});

test('dashboard access: a rate-limited caller gets 429', async () => {
  const { handler } = makeHandler({ checkRateLimit: async () => ({ allowed: false }) });
  const decision = await call(handler);
  assert.equal(decision.status, 429);
  assert.equal(decision.reason, 'rate_limited');
});

test('dashboard access: a failing rate-limit store degrades to allow', async () => {
  const { handler } = makeHandler({
    checkRateLimit: async () => {
      throw new Error('limit store down');
    },
  });
  assert.equal((await call(handler)).status, 200);
});

test('dashboard access: a malformed tenant id is invalid_request', async () => {
  const { handler } = makeHandler();
  const decision = await call(handler, 'not-a-uuid');
  assert.equal(decision.status, 400);
  assert.equal(decision.reason, 'invalid_request');
});

test('dashboard access: a failing dashboard load is unavailable', async () => {
  const { handler } = makeHandler({
    loadDashboard: async () => {
      throw new Error('db down');
    },
  });
  const decision = await call(handler);
  assert.equal(decision.status, 503);
  assert.equal(decision.reason, 'unavailable');
});

test('dashboard access: the handler requires its collaborators', () => {
  assert.throws(() => createDashboardAccessHandler({}), /is required/);
});
