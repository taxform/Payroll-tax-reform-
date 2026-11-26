import test from 'node:test';
import assert from 'node:assert/strict';
import { createDashboardAccessHandler } from '../src/payrollcheck/payrollcheck-dashboard-access.mjs';

const USER_ID = '223e4567-e89b-12d3-a456-426614174003';
const TENANT_ID = '123e4567-e89b-12d3-a456-426614174002';
const COMPANY_ID = '323e4567-e89b-12d3-a456-426614174004';

const COMPANY_ROW = {
  tenant_id: TENANT_ID,
  company_id: COMPANY_ID,
  legal_name: 'Acme Widgets LLC',
  ein: '123456789',
  pay_schedule: 'biweekly',
  country: 'US',
  state: 'CA',
  address_line_1: '1 Main St',
  city: 'Springfield',
  postal_code: '90210',
  timezone: 'America/Los_Angeles',
};

function makeLoaded(companiesByTenant) {
  return {
    memberships: [{ tenant_id: TENANT_ID, tenant_name: 'Acme Corp', role: 'admin' }],
    reportCountsByTenant: { [TENANT_ID]: 0 },
    companiesByTenant,
  };
}

function makeHandler(loadDashboard) {
  return createDashboardAccessHandler({
    getVerifiedUser: async () => ({ id: USER_ID, email: 'owner@acme.test' }),
    requireAal2: async () => undefined,
    getSession: async () => ({ subject_id: USER_ID }),
    resolveSubjectId: async () => USER_ID,
    recordAudit: async () => undefined,
    checkRateLimit: async () => ({ allowed: true, limit: 10, remaining: 9, resetAt: 1794000000 }),
    generateId: () => 'req-dashboard-issetup',
    now: () => 1794000000,
    loadDashboard,
  });
}

test('dashboard reports a company as set up when a company row exists for the tenant', async () => {
  const handler = makeHandler(async () => makeLoaded({ [TENANT_ID]: COMPANY_ROW }));
  const result = await handler({ accessToken: 'access-token', tenantId: TENANT_ID });
  assert.equal(result.status, 200);
  assert.equal(result.body.dashboard.company.isSetUp, true);
  assert.equal(result.body.dashboard.company.legalName, 'Acme Widgets LLC');
  assert.equal(result.body.dashboard.company.einMasked, '***-**-6789');
  assert.equal(result.body.dashboard.company.paySchedule, 'biweekly');
});

test('dashboard reports a company as not set up when no company row exists for the tenant', async () => {
  const handler = makeHandler(async () => makeLoaded({ [TENANT_ID]: null }));
  const result = await handler({ accessToken: 'access-token', tenantId: TENANT_ID });
  assert.equal(result.status, 200);
  assert.equal(result.body.dashboard.company.isSetUp, false);
  assert.equal(result.body.dashboard.company.legalName, null);
  assert.equal(result.body.dashboard.company.einMasked, null);
  assert.equal(result.body.dashboard.company.paySchedule, null);
});
