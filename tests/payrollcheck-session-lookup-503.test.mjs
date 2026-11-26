import test from 'node:test';
import assert from 'node:assert/strict';
import { createPayrollcheckAuth } from '../src/payrollcheck/payrollcheck-auth-composition.mjs';

const TENANT_ID = '123e4567-e89b-12d3-a456-426614174002';
const COOKIE_HEADER = '__Host-payrollcheck-session=sess-lookup-failure';

// The session layer returns this reason when the session store fails
// (see load() in payrollcheck-server-session.mjs). The regression is that
// getDashboard and handleCompany compared it against the spaced string
// 'session lookup failed', so the 503 branch was dead and the failure
// surfaced as a 401 instead.
const failingSessionLayer = {
  parseSessionId: () => 'sess-lookup-failure',
  load: async () => ({ ok: false, reason: 'session_lookup_failed' }),
  verifyCsrf: () => false,
};

function makeAuth() {
  const logEvents = [];
  const auth = createPayrollcheckAuth({
    withTransaction: async (fn) => fn({ query: async () => ({ rows: [] }) }),
    setRlsIdentity: async () => undefined,
    signInWithPassword: async () => { throw new Error('not used in this test'); },
    fetchAdminUser: async () => { throw new Error('not used in this test'); },
    verifyEmailConfirmed: async () => { throw new Error('not used in this test'); },
    requireAal2: async () => true,
    mappingFactory: () => { throw new Error('not used in this test'); },
    tenancyFactory: () => { throw new Error('not used in this test'); },
    sessionStoreFactory: () => ({}),
    sessionLayerFactory: () => failingSessionLayer,
    reportHandlerFactory: () => { throw new Error('not used in this test'); },
    reportSessionLookupFactory: () => { throw new Error('not used in this test'); },
    authorizeTenantSession: async () => { throw new Error('not used in this test'); },
    authLimits: {
      checkLoginAllowed: async () => ({ allowed: true }),
      recordFailedLogin: async () => undefined,
      recordSuccessfulLogin: async () => undefined,
      checkRateLimit: async () => ({ allowed: true }),
    },
    listMfaFactors: async () => { throw new Error('not used in this test'); },
    enrollTotpFactor: async () => { throw new Error('not used in this test'); },
    challengeMfaFactor: async () => { throw new Error('not used in this test'); },
    verifyMfaChallenge: async () => { throw new Error('not used in this test'); },
    requestPasswordRecovery: async () => { throw new Error('not used in this test'); },
    pendingSeal: () => 'pending-blob',
    pendingOpen: () => null,
    appUrl: 'https://payrollcheck.example.com',
    generateId: () => 'req-session-lookup-503',
    now: () => 1794000000,
    log: (event) => logEvents.push(event),
  });
  return { ...auth, logEvents };
}

test('getDashboard surfaces a session-store failure as 503, not 401', async () => {
  const { getDashboard, logEvents } = makeAuth();
  const result = await getDashboard({ cookieHeader: COOKIE_HEADER, tenantId: TENANT_ID, csrfToken: 'csrf-token' });
  assert.equal(result.status, 503);
  assert.equal(result.body.error, 'unavailable');
  const logged = logEvents.find((event) => event.route === 'dashboard');
  assert.equal(logged.status, 503);
  assert.equal(logged.reason, 'session_lookup_failed');
});

test('handleCompany surfaces a session-store failure as 503, not 401', async () => {
  const { handleCompany, logEvents } = makeAuth();
  const result = await handleCompany({ cookieHeader: COOKIE_HEADER, csrfToken: 'csrf-token', tenantId: TENANT_ID, action: 'read' });
  assert.equal(result.status, 503);
  assert.equal(result.body.error, 'unavailable');
  const logged = logEvents.find((event) => event.route === 'company');
  assert.equal(logged.status, 503);
  assert.equal(logged.reason, 'session_lookup_failed');
});
