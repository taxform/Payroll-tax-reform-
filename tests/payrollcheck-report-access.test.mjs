import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createReportAccessHandler,
  findAuthorizingGrant,
} from '../src/payrollcheck/payrollcheck-report-access.mjs';
import { createPayrollcheckTenancy } from '../src/payrollcheck/payrollcheck-tenancy.mjs';

// --- Fixture ids --------------------------------------------------------
const BUSINESS_A = 'aaaaaaaa-1111-4111-8111-111111111111';
const BUSINESS_B = 'bbbbbbbb-2222-4222-8222-222222222222';
const FIRM_X = 'cccccccc-3333-4333-8333-333333333333';
const FIRM_Y = 'dddddddd-4444-4444-8444-444444444444';
const AUTH_OWNER_A = '11111111-aaaa-4111-8111-111111111111';
const AUTH_STAFF_A = '22222222-aaaa-4222-8222-222222222222';
const AUTH_OWNER_B = '33333333-aaaa-4333-8333-333333333333';
const AUTH_REVIEWER_X = '44444444-aaaa-4444-8444-444444444444';
const AUTH_ADMIN_X = '55555555-aaaa-4555-8555-555555555555';
const AUTH_REVIEWER_Y = '66666666-aaaa-4666-8666-666666666666';
const AUTH_DUAL = '77777777-aaaa-4777-8777-777777777777';
const AUTH_ANON = '88888888-aaaa-4888-8888-888888888888';
const AUTH_UNCONFIRMED = '99999999-aaaa-4999-8999-999999999999';
const AUTH_NOMEMBER = '10101010-aaaa-4000-8000-101010101010';
const REPORT_A = 'a1a1a1a1-1111-4111-8111-111111111111';
const REPORT_B = 'b2b2b2b2-2222-4222-8222-222222222222';
const GRANT_XA_VIEW = 'c3c3c3c3-3333-4333-8333-333333333333';
const GRANT_XB_REVOKED = 'd4d4d4d4-4444-4444-8444-444444444444';
const GRANT_XB_ACTIVE_REVIEW = 'e5e5e5e5-5555-4555-8555-555555555555';
const GRANT_YA_BOTH = 'f6f6f6f6-6666-4666-8666-666666666666';
const GRANT_YB_PENDING = 'a7a7a7a7-7777-4777-8777-777777777777';
const GRANT_YB_REVIEW_ONLY = 'b8b8b8b8-8888-4888-8888-888888888888';

const NOW = 1794000000; // epoch seconds; fixed so session expiry is deterministic

const uuid = (x) =>
  typeof x === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(x);

function makeDb() {
  const tenants = [
    { tenant_id: BUSINESS_A, tenant_type: 'business' },
    { tenant_id: BUSINESS_B, tenant_type: 'business' },
    { tenant_id: FIRM_X, tenant_type: 'accounting_firm' },
    { tenant_id: FIRM_Y, tenant_type: 'accounting_firm' },
  ];
  const memberships = [
    { membership_id: '10000000-0000-4000-8000-000000000001', tenant_id: BUSINESS_A, subject_id: 'usr_ownerA', auth_user_id: AUTH_OWNER_A, role: 'business_owner', active: true },
    { membership_id: '10000000-0000-4000-8000-000000000002', tenant_id: BUSINESS_A, subject_id: 'usr_staffA', auth_user_id: AUTH_STAFF_A, role: 'accounting_admin', active: true },
    { membership_id: '10000000-0000-4000-8000-000000000003', tenant_id: BUSINESS_B, subject_id: 'usr_ownerB', auth_user_id: AUTH_OWNER_B, role: 'business_owner', active: true },
    { membership_id: '10000000-0000-4000-8000-000000000004', tenant_id: FIRM_X, subject_id: 'usr_reviewerX', auth_user_id: AUTH_REVIEWER_X, role: 'accounting_reviewer', active: true },
    { membership_id: '10000000-0000-4000-8000-000000000005', tenant_id: FIRM_X, subject_id: 'usr_adminX', auth_user_id: AUTH_ADMIN_X, role: 'accounting_admin', active: true },
    { membership_id: '10000000-0000-4000-8000-000000000006', tenant_id: FIRM_Y, subject_id: 'usr_reviewerY', auth_user_id: AUTH_REVIEWER_Y, role: 'accounting_reviewer', active: true },
    { membership_id: '10000000-0000-4000-8000-000000000007', tenant_id: FIRM_X, subject_id: 'usr_dualD', auth_user_id: AUTH_DUAL, role: 'accounting_admin', active: true },
    { membership_id: '10000000-0000-4000-8000-000000000008', tenant_id: BUSINESS_A, subject_id: 'usr_dualD', auth_user_id: AUTH_DUAL, role: 'business_owner', active: true },
  ];
  const reports = [
    { report_id: REPORT_A, business_tenant_id: BUSINESS_A, client_id: 'client-a', status: 'pending_review', created_at: '2026-11-23T00:00:00Z' },
    { report_id: REPORT_B, business_tenant_id: BUSINESS_B, client_id: 'client-b', status: 'pending_review', created_at: '2026-11-23T00:00:00Z' },
  ];
  const grants = [
    { grant_id: GRANT_XA_VIEW, firm_tenant_id: FIRM_X, business_tenant_id: BUSINESS_A, scopes: ['view_report'], status: 'active', requested_by_subject: 'usr_reviewerX', approved_by_subject: 'usr_ownerA', requested_at: '2026-11-20T00:00:00Z', approved_at: '2026-11-21T00:00:00Z', revoked_at: null },
    { grant_id: GRANT_XB_REVOKED, firm_tenant_id: FIRM_X, business_tenant_id: BUSINESS_B, scopes: ['view_report'], status: 'revoked', requested_by_subject: 'usr_reviewerX', approved_by_subject: 'usr_ownerB', requested_at: '2026-11-20T00:00:00Z', approved_at: '2026-11-21T00:00:00Z', revoked_at: '2026-11-22T00:00:00Z' },
    { grant_id: GRANT_XB_ACTIVE_REVIEW, firm_tenant_id: FIRM_X, business_tenant_id: BUSINESS_B, scopes: ['review_finding'], status: 'active', requested_by_subject: 'usr_reviewerX', approved_by_subject: 'usr_ownerB', requested_at: '2026-11-20T00:00:00Z', approved_at: '2026-11-21T00:00:00Z', revoked_at: null },
    { grant_id: GRANT_YA_BOTH, firm_tenant_id: FIRM_Y, business_tenant_id: BUSINESS_A, scopes: ['view_report', 'review_finding'], status: 'active', requested_by_subject: 'usr_reviewerY', approved_by_subject: 'usr_ownerA', requested_at: '2026-11-20T00:00:00Z', approved_at: '2026-11-21T00:00:00Z', revoked_at: null },
    { grant_id: GRANT_YB_PENDING, firm_tenant_id: FIRM_Y, business_tenant_id: BUSINESS_B, scopes: ['view_report'], status: 'pending', requested_by_subject: 'usr_reviewerY', approved_by_subject: null, requested_at: '2026-11-22T00:00:00Z', approved_at: null, revoked_at: null },
    { grant_id: GRANT_YB_REVIEW_ONLY, firm_tenant_id: FIRM_Y, business_tenant_id: BUSINESS_B, scopes: ['review_finding'], status: 'active', requested_by_subject: 'usr_reviewerY', approved_by_subject: 'usr_ownerB', requested_at: '2026-11-20T00:00:00Z', approved_at: '2026-11-21T00:00:00Z', revoked_at: null },
  ];
  const sessions = {
    'sess-owner-a': { sessionId: 'sess-owner-a', previousSessionId: null, graceUntil: null, userId: 'usr_ownerA', authUserId: AUTH_OWNER_A, aal2: true, createdAt: NOW - 600, rotatedAt: NOW - 600, lastSeenAt: NOW, expiresAt: NOW + 3600, revoked: false },
    'sess-owner-a-prev': { sessionId: 'sess-owner-a-current', previousSessionId: 'sess-owner-a-prev', graceUntil: NOW + 30, userId: 'usr_ownerA', authUserId: AUTH_OWNER_A, aal2: true, createdAt: NOW - 600, rotatedAt: NOW - 60, lastSeenAt: NOW, expiresAt: NOW + 3600, revoked: false },
    'sess-grace-expired': { sessionId: 'sess-owner-a-current', previousSessionId: 'sess-grace-expired', graceUntil: NOW - 10, userId: 'usr_ownerA', authUserId: AUTH_OWNER_A, aal2: true, createdAt: NOW - 600, rotatedAt: NOW - 60, lastSeenAt: NOW, expiresAt: NOW + 3600, revoked: false },
    'sess-revoked': { sessionId: 'sess-revoked', previousSessionId: null, graceUntil: null, userId: 'usr_ownerA', authUserId: AUTH_OWNER_A, aal2: true, createdAt: NOW - 600, rotatedAt: NOW - 600, lastSeenAt: NOW, expiresAt: NOW + 3600, revoked: true },
    'sess-expired': { sessionId: 'sess-expired', previousSessionId: null, graceUntil: null, userId: 'usr_ownerA', authUserId: AUTH_OWNER_A, aal2: true, createdAt: NOW - 13000, rotatedAt: NOW - 13000, lastSeenAt: NOW - 12000, expiresAt: NOW - 10, revoked: false },
    'sess-idle': { sessionId: 'sess-idle', previousSessionId: null, graceUntil: null, userId: 'usr_ownerA', authUserId: AUTH_OWNER_A, aal2: true, createdAt: NOW - 4000, rotatedAt: NOW - 4000, lastSeenAt: NOW - 3600, expiresAt: NOW + 3600, revoked: false },
    'sess-mismatch': { sessionId: 'sess-mismatch', previousSessionId: null, graceUntil: null, userId: 'usr_ownerA', authUserId: AUTH_OWNER_B, aal2: true, createdAt: NOW - 600, rotatedAt: NOW - 600, lastSeenAt: NOW, expiresAt: NOW + 3600, revoked: false },
  };
  return {
    tenants,
    memberships,
    reports,
    grants,
    sessions,
    auditRows: [],
    authorizeCalls: [],
    queryCalls: [],
    visibleReports: new Set([REPORT_A, REPORT_B]),
    failAudit: false,
    failSessionLookup: false,
    failReportLoad: false,
  failMembershipLoad: false,
    rateLimited: false,
    rateLimitThrows: false,
    revokeGrantOnRecheck: null,
    revokeMembershipOnRecheck: false,
    recheckThrows: false,
  };
}

function makeQuery(db) {
  return async (sql, values = []) => {
    db.queryCalls.push({ sql, values });
    // Audit insert.
    if (sql.includes('INSERT INTO payrollcheck.access_audit')) {
      if (db.failAudit) throw new Error('audit sink down');
      const row = {
        event_id: values[0],
        request_id: values[1],
        actor_subject_id: values[2],
        report_id: values[3],
        action: values[4],
        allowed: values[5],
        reason: values[6],
        occurred_at: '2026-11-23T00:00:00Z',
      };
      db.auditRows.push(row);
      return { rows: [row] };
    }
    // Report load (RLS simulated by the test-controlled visible set).
    if (sql.includes('FROM payrollcheck.reports WHERE report_id')) {
      if (db.failReportLoad) throw new Error('db down');
      const report = db.reports.find((r) => r.report_id === values[0]);
      if (!report || !db.visibleReports.has(values[0])) return { rows: [] };
      return { rows: [{ ...report }] };
    }
    // Step-3 mapping: distinct active subjects for an Auth user.
    if (sql.includes('SELECT DISTINCT subject_id FROM payrollcheck.memberships')) {
      const subjects = [
        ...new Set(
          db.memberships
            .filter((m) => m.auth_user_id === values[0] && m.active === true)
            .map((m) => m.subject_id),
        ),
      ];
      return { rows: subjects.map((subject_id) => ({ subject_id })) };
    }
    // Caller memberships + tenant types.
    if (sql.includes('FROM payrollcheck.memberships m JOIN payrollcheck.tenants')) {
    if (db.failMembershipLoad) throw new Error('db down');
      const rows = db.memberships
        .filter((m) => m.subject_id === values[0] && m.active === true)
        .map((m) => ({
          tenant_id: m.tenant_id,
          role: m.role,
          tenant_type: db.tenants.find((t) => t.tenant_id === m.tenant_id).tenant_type,
        }));
      return { rows };
    }
    // Active grants for a business.
    if (sql.includes('FROM payrollcheck.client_grants WHERE business_tenant_id')) {
      return {
        rows: db.grants
          .filter((g) => g.business_tenant_id === values[0] && g.status === 'active')
          .map((g) => ({ ...g })),
      };
    }
    // loadVerifiedTenantMembership shape (fake authorizeTenantSession).
    if (sql.includes('WHERE auth_user_id=$1::uuid AND tenant_id=$2::uuid')) {
      const rows = db.memberships
        .filter((m) => m.auth_user_id === values[0] && m.tenant_id === values[1])
        .slice(0, 2)
        .map((m) => ({
          membership_id: m.membership_id,
          tenant_id: m.tenant_id,
          auth_user_id: m.auth_user_id,
          role: m.role,
          active: m.active,
        }));
      return { rows };
    }
    // Business-path recheck.
    if (sql.includes("role = 'business_owner' AND active = true")) {
      if (db.recheckThrows) throw new Error('db down');
      if (db.revokeMembershipOnRecheck) return { rows: [] };
      const found = db.memberships.some(
        (m) =>
          m.tenant_id === values[0] &&
          m.subject_id === values[1] &&
          m.role === 'business_owner' &&
          m.active === true,
      );
      return { rows: found ? [{ one: 1 }] : [] };
    }
    // Grant recheck by id.
    if (sql.includes('FROM payrollcheck.client_grants WHERE grant_id')) {
      if (db.recheckThrows) throw new Error('db down');
      const grant = db.grants.find((g) => g.grant_id === values[0]);
      if (!grant) return { rows: [] };
      if (db.revokeGrantOnRecheck === values[0]) {
        return { rows: [{ ...grant, status: 'revoked' }] };
      }
      return { rows: [{ ...grant }] };
    }
    // Firm-membership recheck.
    if (sql.includes("role IN ('accounting_admin', 'accounting_reviewer')")) {
      if (db.recheckThrows) throw new Error('db down');
      if (db.revokeMembershipOnRecheck) return { rows: [] };
      const found = db.memberships.some(
        (m) =>
          m.tenant_id === values[0] &&
          m.subject_id === values[1] &&
          (m.role === 'accounting_admin' || m.role === 'accounting_reviewer') &&
          m.active === true,
      );
      return { rows: found ? [{ one: 1 }] : [] };
    }
    throw new Error(`unexpected query: ${sql}`);
  };
}

const USERS = {
  'tok-owner-a': { id: AUTH_OWNER_A, email_confirmed_at: '2026-01-01T00:00:00Z' },
  'tok-staff-a': { id: AUTH_STAFF_A, email_confirmed_at: '2026-01-01T00:00:00Z' },
  'tok-owner-b': { id: AUTH_OWNER_B, email_confirmed_at: '2026-01-01T00:00:00Z' },
  'tok-reviewer-x': { id: AUTH_REVIEWER_X, email_confirmed_at: '2026-01-01T00:00:00Z' },
  'tok-admin-x': { id: AUTH_ADMIN_X, email_confirmed_at: '2026-01-01T00:00:00Z' },
  'tok-reviewer-y': { id: AUTH_REVIEWER_Y, email_confirmed_at: '2026-01-01T00:00:00Z' },
  'tok-dual': { id: AUTH_DUAL, email_confirmed_at: '2026-01-01T00:00:00Z' },
  'tok-owner-a-aal1': { id: AUTH_OWNER_A, email_confirmed_at: '2026-01-01T00:00:00Z' },
  'tok-anon': { id: AUTH_ANON, email_confirmed_at: '2026-01-01T00:00:00Z', is_anonymous: true },
  'tok-unconfirmed': { id: AUTH_UNCONFIRMED, email_confirmed_at: null },
  'tok-nomember': { id: AUTH_NOMEMBER, email_confirmed_at: '2026-01-01T00:00:00Z' },
};

function setup(overrides = {}) {
  const db = makeDb();
  const query = makeQuery(db);
  const tenancy = createPayrollcheckTenancy({ query });

  async function getVerifiedUser(accessToken) {
    if (accessToken === 'tok-bad') throw new Error('invalid token');
    const user = USERS[accessToken];
    if (!user) throw new Error('invalid token');
    return { ...user };
  }
  async function requireAal2(accessToken) {
    if (accessToken === 'tok-owner-a-aal1') return false;
    return true;
  }
  // Fake authorizeTenantSession mirroring the real module's contract:
  // re-verifies the user, requires aal2, loads the membership by Auth
  // UUID + tenant from the (fake) database.
  async function authorizeTenantSession({ accessToken, tenantId, query: q }) {
    db.authorizeCalls.push(tenantId);
    try {
      const user = await getVerifiedUser(accessToken);
      if (!user || !uuid(user.id) || !user.email_confirmed_at || user.is_anonymous === true) {
        return { ok: false, reason: 'unverified_user' };
      }
      if ((await requireAal2(accessToken, user.id)) !== true) {
        return { ok: false, reason: 'mfa_required' };
      }
      const result = await q(
        'SELECT membership_id,tenant_id,auth_user_id,role,active FROM payrollcheck.memberships WHERE auth_user_id=$1::uuid AND tenant_id=$2::uuid LIMIT 2',
        [user.id, tenantId],
      );
      if (!result || !Array.isArray(result.rows) || result.rows.length !== 1) {
        return { ok: false, reason: 'membership_denied' };
      }
      const m = result.rows[0];
      if (
        !m ||
        m.auth_user_id !== user.id ||
        m.tenant_id !== tenantId ||
        !uuid(m.membership_id) ||
        m.active !== true ||
        !['business_owner', 'accounting_admin', 'accounting_reviewer'].includes(m.role)
      ) {
        return { ok: false, reason: 'membership_denied' };
      }
      return {
        ok: true,
        principal: {
          authUserId: user.id,
          tenantId,
          role: m.role,
          membershipId: m.membership_id,
        },
      };
    } catch {
      return { ok: false, reason: 'authentication_failed' };
    }
  }
  async function resolveSubjectId(authUserId) {
    const result = await query(
      'SELECT DISTINCT subject_id FROM payrollcheck.memberships WHERE auth_user_id = $1::uuid AND active = true',
      [authUserId],
    );
    const rows = result && Array.isArray(result.rows) ? result.rows : [];
    if (rows.length !== 1) return null;
    return rows[0].subject_id;
  }
  const handler = createReportAccessHandler({
    query,
    getVerifiedUser,
    requireAal2,
    resolveSubjectId,
    authorizeTenantSession,
    recordAudit: (args) => tenancy.recordAccessAudit(args),
    checkRateLimit: async () => {
      if (db.rateLimitThrows) throw new Error('store down');
      if (db.rateLimited) return { allowed: false, remaining: 0, resetMs: 30000 };
      return { allowed: true, remaining: 59, resetMs: 60000 };
    },
    getSession: async (sessionId) => {
      if (db.failSessionLookup) throw new Error('store down');
      const record = db.sessions[sessionId];
      return record ? { ...record } : null;
    },
    generateId: () => 'req-generated-0001',
    now: () => NOW,
    ...overrides,
  });
  return { db, query, handler, tenancy };
}

const BASE = {
  reportId: REPORT_A,
  action: 'view_report',
  requestId: 'req-test-001',
  clientIp: '203.0.113.7',
};

// --- Factory validation -------------------------------------------------

test('factory requires its collaborators', () => {
  assert.throws(() => createReportAccessHandler({}), /query_required/);
  const { query } = setup();
  assert.throws(
    () => createReportAccessHandler({ query, getVerifiedUser: async () => ({}) }),
    /require_aal2_required/,
  );
  assert.throws(
    () =>
      createReportAccessHandler({
        query,
        getVerifiedUser: async () => ({}),
        requireAal2: async () => true,
        resolveSubjectId: async () => null,
      }),
    /authorize_tenant_session_required/,
  );
  assert.throws(
    () =>
      createReportAccessHandler({
        query,
        getVerifiedUser: async () => ({}),
        requireAal2: async () => true,
        resolveSubjectId: async () => null,
        authorizeTenantSession: async () => ({ ok: false, reason: 'membership_denied' }),
      }),
    /record_audit_required/,
  );
});

// --- Input validation ---------------------------------------------------

test('rejects an unknown action with 400 before any query', async () => {
  const { db, handler } = setup();
  const result = await handler.handleReportAccess({ ...BASE, action: 'delete_report', accessToken: 'tok-owner-a' });
  assert.equal(result.ok, false);
  assert.equal(result.status, 400);
  assert.equal(result.reason, 'invalid_request');
  assert.equal(result.requestId, 'req-test-001');
  assert.equal(db.queryCalls.length, 0);
  assert.equal(db.auditRows.length, 0);
});

test('rejects a non-UUID report id with 400', async () => {
  const { db, handler } = setup();
  const result = await handler.handleReportAccess({ ...BASE, reportId: 'not-a-uuid', accessToken: 'tok-owner-a' });
  assert.equal(result.status, 400);
  assert.equal(result.reason, 'invalid_request');
  assert.equal(db.queryCalls.length, 0);
});

test('rejects a missing access token with 401', async () => {
  const { handler } = setup();
  const result = await handler.handleReportAccess({ ...BASE });
  assert.equal(result.status, 401);
  assert.equal(result.reason, 'unauthorized');
});

test('rejects an over-long request id with 400', async () => {
  const { handler } = setup();
  const result = await handler.handleReportAccess({
    ...BASE,
    requestId: 'r'.repeat(129),
    accessToken: 'tok-owner-a',
  });
  assert.equal(result.status, 400);
  assert.equal(result.reason, 'invalid_request');
});

test('generates a request id when omitted, and uses it in the audit row', async () => {
  const { db, handler } = setup();
  const result = await handler.handleReportAccess({
    reportId: REPORT_A,
    action: 'view_report',
    accessToken: 'tok-owner-a',
    clientIp: '203.0.113.7',
  });
  assert.equal(result.ok, true);
  assert.equal(result.requestId, 'req-generated-0001');
  assert.equal(db.auditRows.length, 1);
  assert.equal(db.auditRows[0].request_id, 'req-generated-0001');
});

// --- Identity denials ---------------------------------------------------

test('forged/expired token (getVerifiedUser throws) is 401, no audit', async () => {
  const { db, handler } = setup();
  const result = await handler.handleReportAccess({ ...BASE, accessToken: 'tok-bad' });
  assert.equal(result.status, 401);
  assert.equal(result.reason, 'unauthorized');
  assert.equal(db.auditRows.length, 0);
});

test('anonymous user is 401', async () => {
  const { handler } = setup();
  const result = await handler.handleReportAccess({ ...BASE, accessToken: 'tok-anon' });
  assert.equal(result.status, 401);
  assert.equal(result.reason, 'unauthorized');
});

test('unconfirmed email is 401', async () => {
  const { handler } = setup();
  const result = await handler.handleReportAccess({ ...BASE, accessToken: 'tok-unconfirmed' });
  assert.equal(result.status, 401);
  assert.equal(result.reason, 'unauthorized');
});

test('verified user with no active membership is generic 404, no audit', async () => {
  const { db, handler } = setup();
  const result = await handler.handleReportAccess({ ...BASE, accessToken: 'tok-nomember' });
  assert.equal(result.status, 404);
  assert.equal(result.reason, 'not_found');
  assert.equal(db.auditRows.length, 0);
});

test('inconsistent mapping (two subjects for one Auth user) is generic 404', async () => {
  const { db, handler } = setup();
  db.memberships.push({
    membership_id: '10000000-0000-4000-8000-000000000099',
    tenant_id: BUSINESS_B,
    subject_id: 'usr_ownerA-other',
    auth_user_id: AUTH_OWNER_A,
    role: 'business_owner',
    active: true,
  });
  const result = await handler.handleReportAccess({ ...BASE, accessToken: 'tok-owner-a' });
  assert.equal(result.status, 404);
  assert.equal(result.reason, 'not_found');
  assert.equal(db.auditRows.length, 0);
});

test('aal1 (MFA missing) is 403 mfa_required, audited', async () => {
  const { db, handler } = setup();
  const result = await handler.handleReportAccess({ ...BASE, accessToken: 'tok-owner-a-aal1' });
  assert.equal(result.status, 403);
  assert.equal(result.reason, 'mfa_required');
  assert.equal(db.auditRows.length, 1);
  assert.equal(db.auditRows[0].allowed, false);
  assert.equal(db.auditRows[0].reason, 'mfa_required');
  assert.equal(db.auditRows[0].actor_subject_id, 'usr_ownerA');
});

// --- Rate limit ---------------------------------------------------------

test('rate-limited request is 429 with retryAfterMs, no audit, no DB load', async () => {
  const { db, handler } = setup();
  db.rateLimited = true;
  const result = await handler.handleReportAccess({ ...BASE, accessToken: 'tok-owner-a' });
  assert.equal(result.status, 429);
  assert.equal(result.reason, 'rate_limited');
  assert.equal(result.retryAfterMs, 30000);
  assert.equal(db.auditRows.length, 0);
  assert.equal(db.queryCalls.length, 0);
});

test('rate limiter throwing degrades to allow (step-4c precedent)', async () => {
  const { db, handler } = setup();
  db.rateLimitThrows = true;
  const result = await handler.handleReportAccess({ ...BASE, accessToken: 'tok-owner-a' });
  assert.equal(result.ok, true);
  assert.equal(result.status, 200);
});

// --- Session re-check ---------------------------------------------------

test('revoked session is 401 session_revoked, audited', async () => {
  const { db, handler } = setup();
  const result = await handler.handleReportAccess({ ...BASE, accessToken: 'tok-owner-a', sessionId: 'sess-revoked' });
  assert.equal(result.status, 401);
  assert.equal(result.reason, 'session_revoked');
  assert.equal(db.auditRows.length, 1);
  assert.equal(db.auditRows[0].reason, 'session_revoked');
});

test('expired session is 401 session_expired', async () => {
  const { handler } = setup();
  const result = await handler.handleReportAccess({ ...BASE, accessToken: 'tok-owner-a', sessionId: 'sess-expired' });
  assert.equal(result.status, 401);
  assert.equal(result.reason, 'session_expired');
});

test('idle-timed-out session is 401 session_idle_timeout', async () => {
  const { handler } = setup();
  const result = await handler.handleReportAccess({ ...BASE, accessToken: 'tok-owner-a', sessionId: 'sess-idle' });
  assert.equal(result.status, 401);
  assert.equal(result.reason, 'session_idle_timeout');
});

test('unknown session is 401 unknown_session', async () => {
  const { handler } = setup();
  const result = await handler.handleReportAccess({ ...BASE, accessToken: 'tok-owner-a', sessionId: 'sess-nope' });
  assert.equal(result.status, 401);
  assert.equal(result.reason, 'unknown_session');
});

test('session lookup throwing is 401 session_lookup_failed', async () => {
  const { db, handler } = setup();
  db.failSessionLookup = true;
  const result = await handler.handleReportAccess({ ...BASE, accessToken: 'tok-owner-a', sessionId: 'sess-owner-a' });
  assert.equal(result.status, 401);
  assert.equal(result.reason, 'session_lookup_failed');
});

test('session/user mismatch is 401 session_mismatch', async () => {
  const { handler } = setup();
  const result = await handler.handleReportAccess({ ...BASE, accessToken: 'tok-owner-a', sessionId: 'sess-mismatch' });
  assert.equal(result.status, 401);
  assert.equal(result.reason, 'session_mismatch');
});

test('presented session with no getSession injected is 503 (fail closed)', async () => {
  const { db, handler } = setup({ getSession: undefined });
  const result = await handler.handleReportAccess({ ...BASE, accessToken: 'tok-owner-a', sessionId: 'sess-owner-a' });
  assert.equal(result.status, 503);
  assert.equal(result.reason, 'unavailable');
  // S3: a presented session that cannot be checked is audited.
  assert.equal(db.auditRows.length, 1);
  assert.equal(db.auditRows[0].reason, 'session_unavailable');
  assert.equal(db.auditRows[0].allowed, false);
});

test('previous session id inside the rotation grace still allows', async () => {
  const { handler } = setup();
  const result = await handler.handleReportAccess({ ...BASE, accessToken: 'tok-owner-a', sessionId: 'sess-owner-a-prev' });
  assert.equal(result.ok, true);
  assert.equal(result.status, 200);
});

test('previous session id past its grace is 401 unknown_session', async () => {
  const { handler } = setup();
  const result = await handler.handleReportAccess({ ...BASE, accessToken: 'tok-owner-a', sessionId: 'sess-grace-expired' });
  assert.equal(result.status, 401);
  assert.equal(result.reason, 'unknown_session');
});

test('live session allows (session re-check passes)', async () => {
  const { handler } = setup();
  const result = await handler.handleReportAccess({ ...BASE, accessToken: 'tok-owner-a', sessionId: 'sess-owner-a' });
  assert.equal(result.ok, true);
  assert.equal(result.status, 200);
  assert.equal(result.path, 'business');
});

test('no session id (token-only mode) skips the session check', async () => {
  const { handler } = setup();
  const result = await handler.handleReportAccess({ ...BASE, accessToken: 'tok-owner-a' });
  assert.equal(result.ok, true);
  assert.equal(result.status, 200);
});

// --- Report access: allow paths -----------------------------------------

test('business owner reads their own report: 200, path business, one allow audit row', async () => {
  const { db, handler } = setup();
  const result = await handler.handleReportAccess({ ...BASE, accessToken: 'tok-owner-a' });
  assert.equal(result.ok, true);
  assert.equal(result.status, 200);
  assert.equal(result.path, 'business');
  assert.equal(result.report.report_id, REPORT_A);
  assert.equal(result.report.business_tenant_id, BUSINESS_A);
  assert.equal(result.requestId, 'req-test-001');
  assert.equal(db.auditRows.length, 1);
  assert.deepEqual(
    { ...db.auditRows[0], event_id: undefined, occurred_at: undefined },
    {
      event_id: undefined,
      request_id: 'req-test-001',
      actor_subject_id: 'usr_ownerA',
      report_id: REPORT_A,
      action: 'view_report',
      allowed: true,
      reason: 'allowed',
      occurred_at: undefined,
    },
  );
});

test('firm reviewer with an active view_report grant reads the report', async () => {
  const { db, handler } = setup();
  const result = await handler.handleReportAccess({ ...BASE, accessToken: 'tok-reviewer-x' });
  assert.equal(result.ok, true);
  assert.equal(result.status, 200);
  assert.equal(result.path, 'firm');
  assert.equal(db.auditRows.length, 1);
  assert.equal(db.auditRows[0].allowed, true);
});

test('firm reviewer with a both-scopes grant may review findings', async () => {
  const { handler } = setup();
  const result = await handler.handleReportAccess({
    ...BASE,
    action: 'review_finding',
    accessToken: 'tok-reviewer-y',
  });
  assert.equal(result.ok, true);
  assert.equal(result.path, 'firm');
});

test('dual member (firm admin + business owner) reads via the business path', async () => {
  const { handler } = setup();
  const result = await handler.handleReportAccess({ ...BASE, accessToken: 'tok-dual' });
  assert.equal(result.ok, true);
  assert.equal(result.path, 'business');
});

// --- Report access: denials ---------------------------------------------

test('RLS hiding the report is generic 404 and authorize is never called', async () => {
  const { db, handler } = setup();
  db.visibleReports.delete(REPORT_A);
  const result = await handler.handleReportAccess({ ...BASE, accessToken: 'tok-owner-a' });
  assert.equal(result.status, 404);
  assert.equal(result.reason, 'not_found');
  assert.equal(db.authorizeCalls.length, 0);
  assert.equal(db.auditRows.length, 1);
  assert.equal(db.auditRows[0].reason, 'report_not_found_or_denied');
  assert.equal(db.auditRows[0].allowed, false);
});

test('firm reviewer with only a pending grant for the pair is 404 grant_denied', async () => {
  const { db, handler } = setup();
  // Remove firm Y's active review-only grant for business B, leaving
  // only its pending view_report grant (which the active-only list
  // query never returns).
  db.grants = db.grants.filter((g) => g.grant_id !== GRANT_YB_REVIEW_ONLY);
  const result = await handler.handleReportAccess({
    ...BASE,
    reportId: REPORT_B,
    accessToken: 'tok-reviewer-y',
  });
  assert.equal(result.status, 404);
  assert.equal(db.auditRows[0].reason, 'grant_denied');
});

test('firm reviewer whose active grant lacks the scope is 404 scope_denied (pending grant authorizes nothing)', async () => {
  const { db, handler } = setup();
  // Report B: firm Y has an active review_finding-only grant and a
  // pending view_report grant. Neither authorizes view_report — and
  // the reason is scope_denied, because a grant for the pair exists.
  const result = await handler.handleReportAccess({
    ...BASE,
    reportId: REPORT_B,
    accessToken: 'tok-reviewer-y',
  });
  assert.equal(result.status, 404);
  assert.equal(result.reason, 'not_found');
  assert.equal(db.auditRows.length, 1);
  assert.equal(db.auditRows[0].reason, 'scope_denied');
});

test('firm reviewer with only a revoked grant is 404 grant_denied', async () => {
  const { db, handler } = setup();
  // Report B: firm X has a revoked view grant + an active review-only grant.
  // view_report: the active grant lacks the scope -> scope_denied.
  const result = await handler.handleReportAccess({
    ...BASE,
    reportId: REPORT_B,
    accessToken: 'tok-reviewer-x',
  });
  assert.equal(result.status, 404);
  assert.equal(db.auditRows[0].reason, 'scope_denied');
});

test('firm reviewer with a review-only grant requesting view_report is 404 scope_denied', async () => {
  const { db, handler } = setup();
  const result = await handler.handleReportAccess({
    ...BASE,
    reportId: REPORT_B,
    accessToken: 'tok-reviewer-y',
  });
  // Reviewer Y on report B: active grant is review_finding-only; the
  // pending grant authorizes nothing.
  assert.equal(result.status, 404);
  assert.equal(db.auditRows[0].reason, 'scope_denied');
});

test('review_finding with a view-only grant is 404 scope_denied', async () => {
  const { db, handler } = setup();
  const result = await handler.handleReportAccess({
    ...BASE,
    action: 'review_finding',
    accessToken: 'tok-reviewer-x',
  });
  assert.equal(result.status, 404);
  assert.equal(db.auditRows[0].reason, 'scope_denied');
});

test('wrong firm: reviewer Y cannot use firm X’s grant', async () => {
  const { db, handler } = setup();
  // Remove Y's own grant for business A so only X's grant remains.
  db.grants = db.grants.filter((g) => g.grant_id !== GRANT_YA_BOTH);
  const result = await handler.handleReportAccess({ ...BASE, accessToken: 'tok-reviewer-y' });
  assert.equal(result.status, 404);
  assert.equal(db.auditRows[0].reason, 'grant_denied');
});

test('wrong business: a grant for business B does not authorize business A’s report', async () => {
  const { db, handler } = setup();
  // Reviewer X has no grant for business A in this variant.
  db.grants = db.grants.filter((g) => g.grant_id !== GRANT_XA_VIEW);
  const result = await handler.handleReportAccess({ ...BASE, accessToken: 'tok-reviewer-x' });
  assert.equal(result.status, 404);
  assert.equal(db.auditRows[0].reason, 'grant_denied');
});

test('business’s own accounting_admin staff cannot read the report (spec-literal)', async () => {
  const { db, handler } = setup();
  const result = await handler.handleReportAccess({ ...BASE, accessToken: 'tok-staff-a' });
  assert.equal(result.status, 404);
  assert.equal(result.reason, 'not_found');
  assert.equal(db.auditRows[0].reason, 'grant_denied');
});

test('RLS-visible row but module denies: staff of the owning business', async () => {
  const { db, handler } = setup();
  // RLS would show the row (visible set includes it); the module still
  // denies because no path authorizes business staff.
  assert.equal(db.visibleReports.has(REPORT_A), true);
  const result = await handler.handleReportAccess({ ...BASE, accessToken: 'tok-staff-a' });
  assert.equal(result.ok, false);
  assert.equal(result.status, 404);
  assert.equal(result.report, undefined);
});

test('other business’s owner cannot read the report', async () => {
  const { db, handler } = setup();
  const result = await handler.handleReportAccess({ ...BASE, accessToken: 'tok-owner-b' });
  assert.equal(result.status, 404);
  assert.equal(db.auditRows[0].reason, 'grant_denied');
});

// --- Consent recheck ----------------------------------------------------

test('grant revoked between load and recheck is 404 consent_revoked', async () => {
  const { db, handler } = setup();
  db.revokeGrantOnRecheck = GRANT_XA_VIEW;
  const result = await handler.handleReportAccess({ ...BASE, accessToken: 'tok-reviewer-x' });
  assert.equal(result.status, 404);
  assert.equal(result.reason, 'not_found');
  assert.equal(db.auditRows.length, 1);
  assert.equal(db.auditRows[0].reason, 'consent_revoked');
  assert.equal(db.auditRows[0].allowed, false);
});

test('membership deactivated between load and recheck (business path) is 404 consent_revoked', async () => {
  const { db, handler } = setup();
  db.revokeMembershipOnRecheck = true;
  const result = await handler.handleReportAccess({ ...BASE, accessToken: 'tok-owner-a' });
  assert.equal(result.status, 404);
  assert.equal(db.auditRows[0].reason, 'consent_revoked');
});

test('recheck DB error is 503, no data released', async () => {
  const { db, handler } = setup();
  db.recheckThrows = true;
  const result = await handler.handleReportAccess({ ...BASE, accessToken: 'tok-owner-a' });
  assert.equal(result.status, 503);
  assert.equal(result.reason, 'unavailable');
  assert.equal(result.report, undefined);
  // S3: the consent-recheck failure is audited like every other decision.
  assert.equal(db.auditRows.length, 1);
  assert.equal(db.auditRows[0].reason, 'consent_recheck_failed');
  assert.equal(db.auditRows[0].allowed, false);
});

// --- Audit failure: fail closed -----------------------------------------

test('audit write failing on an allow is 503, no data released', async () => {
  const { db, handler } = setup();
  db.failAudit = true;
  const result = await handler.handleReportAccess({ ...BASE, accessToken: 'tok-owner-a' });
  assert.equal(result.status, 503);
  assert.equal(result.reason, 'unavailable');
  assert.equal(result.report, undefined);
  assert.equal(db.auditRows.length, 0);
});

test('audit write failing on a deny masks the denial with 503', async () => {
  const { db, handler } = setup();
  db.failAudit = true;
  const result = await handler.handleReportAccess({ ...BASE, accessToken: 'tok-owner-a-aal1' });
  assert.equal(result.status, 503);
  assert.equal(result.reason, 'unavailable');
});

// --- DB outage ----------------------------------------------------------

test('report load throwing is 503 unavailable', async () => {
  const { db, handler } = setup();
  db.failReportLoad = true;
  const result = await handler.handleReportAccess({ ...BASE, accessToken: 'tok-owner-a' });

test('membership load throwing is 503 unavailable and audited', async () => {
  const { db, handler } = setup();
  db.failMembershipLoad = true;
  const result = await handler.handleReportAccess({ ...BASE, accessToken: 'tok-owner-a' });
  assert.equal(result.status, 503);
  assert.equal(result.reason, 'unavailable');
  assert.equal(result.report, undefined);
  // S3: the membership/grant-load failure is audited like every other decision.
  assert.equal(db.auditRows.length, 1);
  assert.equal(db.auditRows[0].reason, 'membership_load_failed');
  assert.equal(db.auditRows[0].allowed, false);
});
  assert.equal(result.status, 503);
  assert.equal(result.reason, 'unavailable');
  // S3: the report-load failure is audited like every other decision.
  assert.equal(db.auditRows.length, 1);
  assert.equal(db.auditRows[0].reason, 'report_load_failed');
  assert.equal(db.auditRows[0].allowed, false);
});

// --- No leakage ---------------------------------------------------------

test('no access token appears in any returned object', async () => {
  const { handler } = setup();
  const allow = await handler.handleReportAccess({ ...BASE, accessToken: 'tok-owner-a' });
  assert.equal(JSON.stringify(allow).includes('tok-owner-a'), false);
  const denied = await handler.handleReportAccess({ ...BASE, accessToken: 'tok-reviewer-x', reportId: REPORT_B });
  assert.equal(JSON.stringify(denied).includes('tok-reviewer-x'), false);
});

// --- findAuthorizingGrant (pure) ----------------------------------------

test('findAuthorizingGrant matches active grants with the scope only', () => {
  const grants = [
    { grant_id: 'g1', firm_tenant_id: FIRM_X, business_tenant_id: BUSINESS_A, scopes: ['view_report'], status: 'active' },
    { grant_id: 'g2', firm_tenant_id: FIRM_X, business_tenant_id: BUSINESS_A, scopes: ['review_finding'], status: 'active' },
    { grant_id: 'g3', firm_tenant_id: FIRM_X, business_tenant_id: BUSINESS_A, scopes: ['view_report'], status: 'revoked' },
    { grant_id: 'g4', firm_tenant_id: FIRM_Y, business_tenant_id: BUSINESS_A, scopes: ['view_report'], status: 'active' },
  ];
  assert.equal(
    findAuthorizingGrant({ grants, firmTenantId: FIRM_X, businessTenantId: BUSINESS_A, action: 'view_report' }).grant_id,
    'g1',
  );
  assert.equal(
    findAuthorizingGrant({ grants, firmTenantId: FIRM_X, businessTenantId: BUSINESS_A, action: 'review_finding' }).grant_id,
    'g2',
  );
  assert.equal(
    findAuthorizingGrant({ grants, firmTenantId: FIRM_Y, businessTenantId: BUSINESS_B, action: 'view_report' }),
    null,
  );
  assert.equal(findAuthorizingGrant({ grants: null, firmTenantId: FIRM_X, businessTenantId: BUSINESS_A, action: 'view_report' }), null);
  assert.equal(
    findAuthorizingGrant({ grants, firmTenantId: FIRM_X, businessTenantId: BUSINESS_A, action: 'delete_report' }),
    null,
  );
});
