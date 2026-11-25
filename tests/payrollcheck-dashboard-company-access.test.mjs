// Regression test: the dashboard and company access handlers must accept the
// real server session id exactly as payrollcheck-auth-composition.mjs passes
// it -- a 43-character base64url string from randomBytes(32) -- and must not
// deny the call with 401 "invalid_session".
//
// The composition (getDashboard, handleCompany and readReport) calls every
// access handler with `accessToken: session.sessionId`, and its session-backed
// getVerifiedUser ignores that argument and verifies the user from
// session.authUserId instead (a fresh Admin-API read). The report handler
// already treats the token as an opaque presented credential (a non-empty
// string of at most 16384 characters). The dashboard and company handlers
// instead required the token itself to match UUID_PATTERN, so no real
// token itself to match UUID_PATTERN, so no real session id could ever pass
// the gate: every authenticated dashboard/company call was denied 401
// "invalid_session" in prod (2026-11-25), even though the session load and
// touch had succeeded. These tests drive the real handlers with the real
// session-id format and the composition's session-backed getVerifiedUser
// shape. They fail on the unfixed handlers (401 invalid_session) and pass
// on the fixed ones. No UUID shape is required of the resolved user id:
// the handlers bind identity through the session instead
// (session.authUserId must equal the verified user id), and the existing
// handler tests use opaque stub ids (for example 'auth-user-1' in
// tests/payrollcheck-company.test.mjs), so a UUID check on the resolved id
// would contradict the handlers' own contract.
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { createDashboardAccessHandler } from '../src/payrollcheck/payrollcheck-dashboard-access.mjs';
import { createCompanyAccessHandler } from '../src/payrollcheck/payrollcheck-company-access.mjs';

const AUTH_USER_ID = '11111111-2222-3333-4444-555555555555';
const TENANT_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const SUBJECT_ID = 'subject-00000000-1111-2222-3333-444444444444';
const SESSION_ID_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// The exact session id the server issues: randomBytes(32) base64url.
// See src/payrollcheck/payrollcheck-server-session.mjs (SESSION_ID_BYTES = 32).
function newRealSessionId() {
  return randomBytes(32).toString('base64url');
}

function memberships() {
  return [{ tenantId: TENANT_ID, tenantType: 'business', role: 'business_owner' }];
}

function baseDeps(seen, overrides = {}) {
  return {
    // Session-backed, exactly like the composition: the token argument is
    // ignored and the user is verified from the session's authUserId.
    getVerifiedUser: async (token) => {
      seen.verifiedToken = token;
      return {
        id: AUTH_USER_ID,
        email_confirmed_at: '2026-01-01T00:00:00.000Z',
        is_anonymous: false,
      };
    },
    requireAal2: async () => true,
    getSession: async (presentedSessionId) => {
      seen.sessionLookupId = presentedSessionId;
      return { sessionId: presentedSessionId, authUserId: AUTH_USER_ID };
    },
    resolveSubjectId: async () => SUBJECT_ID,
    recordAudit: async () => undefined,
    checkRateLimit: async () => ({ allowed: true }),
    generateId: () => 'req_regression_0001',
    now: () => new Date('2026-11-25T16:00:00.000Z'),
    ...overrides,
  };
}

test('dashboard: a real 43-char base64url session id is accepted, not 401 invalid_session', async () => {
  const sessionId = newRealSessionId();
  assert.match(sessionId, SESSION_ID_PATTERN, 'fixture must be a real session id');
  assert.equal(UUID_PATTERN.test(sessionId), false, 'fixture must not accidentally be a UUID');
  const seen = {};
  const { handleDashboardAccess: handler } = createDashboardAccessHandler(baseDeps(seen, {
    loadDashboard: async () => ({
      memberships: memberships(),
      reportCountsByTenant: { [TENANT_ID]: 0 },
      companiesByTenant: { [TENANT_ID]: null },
    }),
  }));
  const result = await handler({
    accessToken: sessionId,
    sessionId,
    tenantId: TENANT_ID,
    requestId: 'req_regression_dashboard',
    clientIp: '127.0.0.1',
  });
  assert.equal(result.status, 200, JSON.stringify(result));
  assert.equal(result.ok, true);
  assert.equal(result.reason, 'allowed');
  assert.equal(result.dashboard.selectedTenant.tenantId, TENANT_ID);
  assert.equal(result.dashboard.tenants.length, 1);
  assert.equal(seen.verifiedToken, sessionId, 'the handler passes the presented session id to getVerifiedUser');
  assert.equal(seen.sessionLookupId, sessionId, 'the handler looks the session up by the presented session id');
});

test('company: a real 43-char base64url session id is accepted for a read, not 401 invalid_session', async () => {
  const sessionId = newRealSessionId();
  assert.match(sessionId, SESSION_ID_PATTERN, 'fixture must be a real session id');
  assert.equal(UUID_PATTERN.test(sessionId), false, 'fixture must not accidentally be a UUID');
  const seen = {};
  const { handleCompanyAccess: handler } = createCompanyAccessHandler(baseDeps(seen, {
    loadCompanyProfile: async () => ({
      memberships: memberships(),
      companiesByTenant: {
        [TENANT_ID]: {
          tenant_id: TENANT_ID,
          company_id: 'cccccccc-dddd-eeee-ffff-000000000000',
          legal_name: 'Acme Widgets LLC',
          ein: '123456789',
          address_line1: '1 Main St',
          address_line2: '',
          city: 'Albany',
          state: 'NY',
          postal_code: '12201',
          pay_schedule: 'biweekly',
          created_at: '2026-01-01T00:00:00.000Z',
          updated_at: '2026-01-01T00:00:00.000Z',
        },
      },
    }),
    saveCompany: async () => { throw new Error('saveCompany must not be called for a read'); },
  }));
  const result = await handler({
    accessToken: sessionId,
    sessionId,
    tenantId: TENANT_ID,
    action: 'read',
    requestId: 'req_regression_company',
    clientIp: '127.0.0.1',
  });
  assert.equal(result.status, 200, JSON.stringify(result));
  assert.equal(result.ok, true);
  assert.equal(result.reason, 'allowed');
  assert.equal(result.company.legalName, 'Acme Widgets LLC');
  assert.equal(result.isSetUp, true);
  assert.equal(seen.verifiedToken, sessionId, 'the handler passes the presented session id to getVerifiedUser');
  assert.equal(seen.sessionLookupId, sessionId, 'the handler looks the session up by the presented session id');
});

test('dashboard: a UUID-shaped token is still accepted (backwards compatibility)', async () => {
  const sessionId = newRealSessionId();
  const { handleDashboardAccess: handler } = createDashboardAccessHandler(baseDeps({}, {
    loadDashboard: async () => ({
      memberships: memberships(),
      reportCountsByTenant: { [TENANT_ID]: 0 },
      companiesByTenant: { [TENANT_ID]: null },
    }),
  }));
  const result = await handler({
    accessToken: AUTH_USER_ID,
    sessionId,
    tenantId: TENANT_ID,
    requestId: 'req_regression_uuid',
    clientIp: '127.0.0.1',
  });
  assert.equal(result.status, 200, JSON.stringify(result));
  assert.equal(result.ok, true);
});

test('company: a UUID-shaped token is still accepted for a read (backwards compatibility)', async () => {
  const sessionId = newRealSessionId();
  const { handleCompanyAccess: handler } = createCompanyAccessHandler(baseDeps({}, {
    loadCompanyProfile: async () => ({
      memberships: memberships(),
      companiesByTenant: { [TENANT_ID]: null },
    }),
    saveCompany: async () => { throw new Error('saveCompany must not be called for a read'); },
  }));
  const result = await handler({
    accessToken: AUTH_USER_ID,
    sessionId,
    tenantId: TENANT_ID,
    action: 'read',
    requestId: 'req_regression_uuid_company',
    clientIp: '127.0.0.1',
  });
  assert.equal(result.status, 200, JSON.stringify(result));
  assert.equal(result.ok, true);
  assert.equal(result.isSetUp, false);
});

test('dashboard: an empty access token is still denied 401 invalid_session', async () => {
  const sessionId = newRealSessionId();
  const { handleDashboardAccess: handler } = createDashboardAccessHandler(baseDeps({}, {
    loadDashboard: async () => {
      throw new Error('loadDashboard must not be reached with an empty token');
    },
  }));
  const result = await handler({
    accessToken: '',
    sessionId,
    tenantId: TENANT_ID,
    requestId: 'req_regression_empty',
    clientIp: '127.0.0.1',
  });
  assert.equal(result.status, 401);
  assert.equal(result.reason, 'invalid_session');
});
