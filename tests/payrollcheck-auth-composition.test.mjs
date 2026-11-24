import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { createPayrollcheckAuth } from '../src/payrollcheck/payrollcheck-auth-composition.mjs';
import { createPendingTokenSealer } from '../src/payrollcheck/payrollcheck-pending-token.mjs';
import { createReportSessionLookup } from '../src/payrollcheck/payrollcheck-report-session-lookup.mjs';

// ---------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------
const NOW = 1794000000;
const OWNER_UUID = '11111111-aaaa-4111-8111-111111111111';
const FIRM_UUID = '22222222-bbbb-4222-8222-222222222222';
const OWNER_SUBJECT = 'usr_ownerA123456789012';
const FIRM_SUBJECT = 'usr_firmB123456789012';
const BUSINESS_A = '33333333-cccc-4333-8333-333333333333';
const REPORT_A = 'aaaaaaaa-aaaa-4111-8111-aaaaaaaaaaaa';
const REPORT_B = 'bbbbbbbb-bbbb-4111-8111-bbbbbbbbbbbb';
const SESSION_OWNER = 'sess_owner_current';
const SESSION_PREV = 'sess_owner_previous';

function parseCookie(header) {
  if (typeof header !== 'string') return null;
  const match = /__Host-payrollcheck-session=([^;]+)/.exec(header);
  return match ? match[1] : null;
}

// ---------------------------------------------------------------------
// Fake collaborators — each mirrors the real step 2–8 contract.
// The session layer fake mirrors the REAL step-4a load(): current id,
// then previous id inside the grace window (graceUntil check), and a
// rotated flag with the new cookie + csrf token for the current id.
// ---------------------------------------------------------------------
function makeSessionStore() {
  const rows = new Map();
  return {
    rows,
    get: async (id) => rows.get(id) ?? null,
    getByPreviousSessionId: async (id) => {
      for (const row of rows.values()) {
        if (row.previousSessionId === id) return row;
      }
      return null;
    },
    set: async (record) => {
      rows.set(record.sessionId, { ...record });
    },
    delete: async (id) => {
      rows.delete(id);
    },
    deleteByUserId: async (userId) => {
      for (const [id, row] of rows) {
        if (row.userId === userId) rows.delete(id);
      }
    },
  };
}

function makeSessionLayer(store, { rotateOnLoad = false, revokeAllReturnsFalse = false } = {}) {
  return {
    issue: async ({ userId, authUserId, aal2 }) => {
      const sessionId = `sess_${userId}`;
      const record = {
        sessionId,
        previousSessionId: null,
        graceUntil: null,
        userId,
        authUserId,
        aal2,
        createdAt: NOW,
        rotatedAt: NOW,
        lastSeenAt: NOW,
        expiresAt: NOW + 43200,
        revoked: false,
      };
      await store.set(record);
      return {
        sessionId,
        cookie: `__Host-payrollcheck-session=${sessionId}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=43200`,
        csrfToken: `csrf-for-${sessionId}`,
        expiresAt: record.expiresAt,
      };
    },
    load: async (cookieHeader) => {
      const presentedId = parseCookie(cookieHeader);
      if (!presentedId) return { ok: false, reason: 'no_session' };
      let record = await store.get(presentedId);
      let viaGrace = false;
      if (!record || record.sessionId !== presentedId) {
        const previous = await store.getByPreviousSessionId(presentedId);
        if (
          previous &&
          previous.previousSessionId === presentedId &&
          previous.graceUntil !== null &&
          NOW < previous.graceUntil
        ) {
          record = previous;
          viaGrace = true;
        } else {
          record = null;
        }
      }
      if (!record) return { ok: false, reason: 'unknown_session' };
      if (record.revoked) return { ok: false, reason: 'revoked' };
      if (NOW >= record.expiresAt) return { ok: false, reason: 'expired' };
      const session = {
        sessionId: record.sessionId,
        userId: record.userId,
        authUserId: record.authUserId,
        aal2: record.aal2,
        createdAt: record.createdAt,
        expiresAt: record.expiresAt,
      };
      const rotated = viaGrace || rotateOnLoad;
      return {
        ok: true,
        session,
        csrfToken: `csrf-for-${record.sessionId}`,
        rotated,
        ...(rotated
          ? { cookie: `__Host-payrollcheck-session=${record.sessionId}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=43200` }
          : {}),
      };
    },
    revoke: async (sessionId) => {
      await store.delete(sessionId);
      return true;
    },
    revokeAllForUser: async (userId) => {
      if (revokeAllReturnsFalse) return false;
      await store.deleteByUserId(userId);
      return true;
    },
    verifyCsrf: (sessionId, token) => token === `csrf-for-${sessionId}`,
    clearCookie: () =>
      '__Host-payrollcheck-session=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0',
    parseSessionId: (header) => parseCookie(header),
  };
}

function makeSetup(overrides = {}) {
  const logEvents = [];
  const statements = [];
  const auditRows = [];
  const failedLogins = [];
  const successfulLogins = [];
  const rateChecks = [];
  const setRlsCalls = [];
  const mappingCalls = [];
  const handlerDeps = [];
  const authorizeCalls = [];
  const recoveryCalls = [];
  const adminUserCalls = [];

  const store = makeSessionStore();

  // The fake transaction scope: BEGIN/COMMIT/ROLLBACK statements are
  // recorded; set_config SELECTs return an empty row set.
  const query = async (sql, values) => {
    statements.push({ sql, values });
    return { rows: [] };
  };
  const withTransaction = async (fn) => {
    statements.push({ sql: 'BEGIN' });
    try {
      const result = await fn({ query });
      statements.push({ sql: 'COMMIT' });
      return result;
    } catch (err) {
      statements.push({ sql: 'ROLLBACK' });
      throw err;
    }
  };

  // setRlsIdentity fake: mirrors the real module's SQL shape and records
  // its call order — the composition must call it auth-only first, then
  // full, and only after the subject mapping resolves.
  const setRlsIdentity = async ({ query: txQuery, subjectId, authUserId, sessionId }) => {
    setRlsCalls.push({ subjectId, authUserId, sessionId });
    await txQuery(
      `SELECT set_config('payrollcheck.current_auth_user_id', $1, true), set_config('payrollcheck.current_subject_id', $2, true), set_config('payrollcheck.current_session_id', $3, true)`,
      [authUserId ?? null, subjectId ?? null, sessionId ?? null],
    );
    return { ok: true };
  };

  const mapping = {
    resolveInternalUserId: async (authUserId) => {
      mappingCalls.push(authUserId);
      if (authUserId === OWNER_UUID) return OWNER_SUBJECT;
      if (authUserId === FIRM_UUID) return FIRM_SUBJECT;
      return null;
    },
  };

  const authorizeTenantSession = async (args) => {
    authorizeCalls.push(args);
    await args.query(
      `SELECT set_config('payrollcheck.current_subject_id', $1, true), set_config('payrollcheck.current_auth_user_id', $2, true), set_config('payrollcheck.current_session_id', $3, true)`,
      [args.subjectId, args.authUserId, args.sessionId],
    );
    return { ok: true, principal: { subjectId: args.subjectId, authUserId: args.authUserId, sessionId: args.sessionId, role: 'business_owner' } };
  };

  // Step-8 handler fake: consumes the injected collaborators in the
  // same order the real handler does (session → verified user → aal2 →
  // subject → authorize → decision → audit), so the test proves the
  // composition wired adapters the handler actually uses.
  const reportHandlerFactory = (deps) => {
    handlerDeps.push(deps);
    return {
      handleReportAccess: async ({ accessToken, sessionId, reportId, action, requestId }) => {
        const deny = async (status, reason) => {
          await deps.recordAudit({
            actorSubjectId: null,
            action,
            targetBusinessTenantId: null,
            reportId,
            outcome: 'denied',
            reason,
          });
          return { ok: false, status, reason };
        };
        if (!accessToken || accessToken !== sessionId) {
          return deny(401, 'no_session');
        }
        const record = await deps.getSession(sessionId);
        if (!record) return deny(401, 'unknown_session');
        const user = await deps.getVerifiedUser();
        if (!user || !user.email_confirmed_at || user.is_anonymous === true) {
          return deny(403, 'email_unconfirmed');
        }
        const aal2 = await deps.requireAal2();
        if (aal2 !== true) return deny(403, 'aal2_required');
        const subjectId = await deps.resolveSubjectId(record.authUserId);
        if (!subjectId) return deny(404, 'not_found');
        // The real authorizeSupabaseTenantSession re-verifies the user
        // from the token inside every authorize call — one more
        // getVerifiedUser per candidate tenant. The composition
        // memoizes that read per request; the test below proves it.
        await deps.getVerifiedUser();
        await deps.authorizeTenantSession({
          query: deps.query,
          subjectId,
          authUserId: record.authUserId,
          sessionId,
        });
        if (reportId === REPORT_A && (action === 'view_report' || action === 'review_finding')) {
          await deps.recordAudit({
            actorSubjectId: subjectId,
            action,
            targetBusinessTenantId: BUSINESS_A,
            reportId,
            outcome: 'allowed',
          });
          return {
            ok: true,
            status: 200,
            report: { report_id: REPORT_A, business_tenant_id: BUSINESS_A },
            path: 'business',
            requestId,
          };
        }
        return deny(404, 'not_found');
      },
    };
  };

  const tenancy = {
    recordAccessAudit: async (row) => {
      auditRows.push(row);
    },
    deactivateMembership: async ({ tenantId, subjectId }) => {
      if (overrides.deactivateThrows) throw new Error('deactivate failed');
      if (overrides.deactivateReturns !== undefined) return overrides.deactivateReturns;
      return { ok: true, deactivated: true, membership: { tenant_id: tenantId, subject_id: subjectId } };
    },
  };

  const authLimits = {
    checkLoginAllowed: async ({ identifier, ip }) => {
      if (overrides.lockout) {
        return { allowed: false, reason: 'locked_out', retryAfterMs: 600000 };
      }
      if (overrides.rateLimited) {
        return { allowed: false, reason: 'rate_limited', retryAfterMs: 30000 };
      }
      if (overrides.limitsUnavailable) {
        return { allowed: false, reason: 'unavailable' };
      }
      return { allowed: true };
    },
    recordFailedLogin: async ({ identifier, ip }) => {
      failedLogins.push({ identifier, ip });
    },
    recordSuccessfulLogin: async ({ identifier }) => {
      successfulLogins.push({ identifier });
    },
    checkRateLimit: async ({ key }) => {
      rateChecks.push({ key });
      if (overrides.rateLimitBlocked) return { allowed: false, resetMs: 20000 };
      return { allowed: true };
    },
  };

  const signInWithPassword = async ({ email, password }) => {
    if (overrides.signInFails) throw new Error('invalid_grant: 400');
    if (email === 'owner@example.com' && password === 'correct horse') {
      return {
        access_token: 'tok-aal1-owner',
        refresh_token: 'ref-owner',
        user: { id: OWNER_UUID, email, email_confirmed_at: '2026-01-01T00:00:00Z' },
      };
    }
    if (email === 'firm@example.com' && password === 'correct horse') {
      return {
        access_token: 'tok-aal1-firm',
        refresh_token: 'ref-firm',
        user: { id: FIRM_UUID, email, email_confirmed_at: '2026-01-01T00:00:00Z' },
      };
    }
    throw new Error('invalid_grant: 400');
  };

  const fetchAdminUser = async (authUserId) => {
    adminUserCalls.push(authUserId);
    if (authUserId === OWNER_UUID) {
      return {
        id: OWNER_UUID,
        email: 'owner@example.com',
        email_confirmed_at: overrides.unconfirmedAdmin ? null : '2026-01-01T00:00:00Z',
        is_anonymous: false,
      };
    }
    if (authUserId === FIRM_UUID) {
      return {
        id: FIRM_UUID,
        email: 'firm@example.com',
        email_confirmed_at: '2026-01-01T00:00:00Z',
        is_anonymous: false,
      };
    }
    return null;
  };

  const verifyEmailConfirmed = async (authUserId) => {
    if (overrides.unconfirmed && authUserId === OWNER_UUID) return false;
    return authUserId === OWNER_UUID || authUserId === FIRM_UUID;
  };

  const requireAal2 = async (accessToken) => accessToken === 'tok-aal2-owner';

  const listMfaFactors = async ({ accessToken }) => {
    if (accessToken === 'tok-aal1-owner') {
      return [{ id: 'factor-1', factor_type: 'totp', status: 'verified', friendly_name: 'Phone' }];
    }
    return [];
  };

  const enrollTotpFactor = async ({ accessToken, friendlyName, issuer }) => {
    if (accessToken === 'tok-aal1-owner') {
      return {
        id: 'factor-new',
        type: 'totp',
        totp: { secret: 'S3CR3T', uri: 'otpauth://totp/x', qr_code: 'data:image/png;base64,QR' },
      };
    }
    throw new Error('status 401');
  };

  const challengeMfaFactor = async ({ accessToken, factorId }) => {
    if (accessToken === 'tok-aal1-owner') return { id: 'challenge-1' };
    throw new Error('status 401');
  };

  const verifyMfaChallenge = async ({ accessToken, factorId, challengeId, code }) => {
    if (code === '123456') {
      return {
        access_token: 'tok-aal2-owner',
        refresh_token: 'ref-aal2',
        user: { id: OWNER_UUID, email: 'owner@example.com' },
      };
    }
    throw new Error('status 400');
  };

  const requestPasswordRecovery = async ({ email, redirectTo }) => {
    recoveryCalls.push({ email, redirectTo });
    if (overrides.recoveryFails) throw new Error('status 500');
    return { ok: true };
  };

  const pendingSealer = createPendingTokenSealer({
    key: overrides.pendingKey ?? randomBytes(32),
    now: () => NOW,
  });

  const deps = {
    withTransaction,
    setRlsIdentity,
    signInWithPassword,
    fetchAdminUser,
    verifyEmailConfirmed,
    requireAal2,
    mappingFactory: () => mapping,
    tenancyFactory: () => tenancy,
    sessionStoreFactory: () => store,
    sessionLayerFactory: ({ store: s }) =>
      makeSessionLayer(s, {
        rotateOnLoad: overrides.rotateOnLoad === true,
        revokeAllReturnsFalse: overrides.revokeAllReturnsFalse === true,
      }),
    reportHandlerFactory,
    reportSessionLookupFactory: ({ store: s }) => createReportSessionLookup({ store: s }),
    authorizeTenantSession,
    authLimits,
    listMfaFactors,
    enrollTotpFactor,
    challengeMfaFactor,
    verifyMfaChallenge,
    requestPasswordRecovery,
    pendingSeal: (payload) => pendingSealer.seal(payload),
    pendingOpen: (blob) => pendingSealer.open(blob),
    appUrl: 'https://payrolltaxreform.com',
    generateId: () => 'req-test-0001',
    now: () => NOW,
    log: (event) => {
      logEvents.push(event);
    },
  };
  if (overrides.deps) overrides.deps(deps);
  const composition = createPayrollcheckAuth(deps);
  return {
    composition,
    store,
    logEvents,
    statements,
    auditRows,
    failedLogins,
    successfulLogins,
    rateChecks,
    setRlsCalls,
    mappingCalls,
    handlerDeps,
    authorizeCalls,
    recoveryCalls,
    pendingSealer,
    adminUserCalls,
  };
}

// ---------------------------------------------------------------------
// Constructor
// ---------------------------------------------------------------------
test('factory rejects missing deps', () => {
  assert.throws(() => createPayrollcheckAuth({}), /with_transaction_required/);
  assert.throws(
    () => createPayrollcheckAuth({ withTransaction: async () => {} }),
    /set_rls_identity_required/,
  );
  assert.throws(
    () =>
      createPayrollcheckAuth({
        withTransaction: async () => {},
        setRlsIdentity: async () => {},
        signInWithPassword: async () => {},
        fetchAdminUser: async () => {},
        verifyEmailConfirmed: async () => true,
        requireAal2: async () => true,
        mappingFactory: () => ({}),
        tenancyFactory: () => ({}),
        sessionStoreFactory: () => ({}),
        sessionLayerFactory: () => ({}),
        reportHandlerFactory: () => ({}),
        reportSessionLookupFactory: () => ({}),
        authorizeTenantSession: async () => {},
        authLimits: {
          checkLoginAllowed: async () => ({ allowed: true }),
          recordFailedLogin: async () => {},
          recordSuccessfulLogin: async () => {},
          checkRateLimit: async () => ({ allowed: true }),
        },
        listMfaFactors: async () => [],
        enrollTotpFactor: async () => ({}),
        challengeMfaFactor: async () => ({}),
        verifyMfaChallenge: async () => ({}),
        requestPasswordRecovery: async () => ({}),
        pendingSeal: () => '',
        pendingOpen: () => null,
        appUrl: 'http://not-https.example.com',
      }),
    /app_url_must_be_https/,
  );
});

// ---------------------------------------------------------------------
// login
// ---------------------------------------------------------------------
test('login: locked-out account returns 429 (same as rate-limited) and records no failure', async () => {
  const { composition, failedLogins, logEvents } = makeSetup({ lockout: true });
  const res = await composition.login({ email: 'owner@example.com', password: 'x', ip: '1.2.3.4' });
  assert.equal(res.status, 429);
  assert.equal(res.body.error, 'try_again_later');
  assert.equal(res.headers['Retry-After'], '600');
  assert.equal(failedLogins.length, 0);
  assert.equal(logEvents[0].reason, 'locked_out');
});

test('login: rate-limited returns 429 with Retry-After', async () => {
  const { composition } = makeSetup({ rateLimited: true });
  const res = await composition.login({ email: 'owner@example.com', password: 'x', ip: '1.2.3.4' });
  assert.equal(res.status, 429);
  assert.equal(res.body.error, 'try_again_later');
  assert.equal(res.headers['Retry-After'], '30');
});

test('login: lockout read unavailable fails closed with 503', async () => {
  const { composition } = makeSetup({ limitsUnavailable: true });
  const res = await composition.login({ email: 'owner@example.com', password: 'x', ip: '1.2.3.4' });
  assert.equal(res.status, 503);
  assert.equal(res.body.error, 'unavailable');
});

test('login: bad password returns 401, records one failure, never issues a session', async () => {
  const { composition, failedLogins, store } = makeSetup();
  const res = await composition.login({ email: 'owner@example.com', password: 'wrong', ip: '1.2.3.4' });
  assert.equal(res.status, 401);
  assert.equal(res.body.error, 'invalid_credentials');
  assert.equal(failedLogins.length, 1);
  assert.deepEqual(failedLogins[0], { identifier: 'owner@example.com', ip: '1.2.3.4' });
  assert.equal(store.rows.size, 0);
  assert.equal('Set-Cookie' in (res.headers ?? {}), false);
});

test('login: unconfirmed email returns the same 401 as a bad password', async () => {
  const { composition, store } = makeSetup({ unconfirmed: true });
  const res = await composition.login({ email: 'owner@example.com', password: 'correct horse', ip: '1.2.3.4' });
  assert.equal(res.status, 401);
  assert.equal(res.body.error, 'invalid_credentials');
  assert.equal(store.rows.size, 0);
});

test('login: correct password + verified factor returns a pending blob, never a session', async () => {
  const { composition, store, successfulLogins, pendingSealer } = makeSetup();
  const res = await composition.login({ email: 'owner@example.com', password: 'correct horse', ip: '1.2.3.4' });
  assert.equal(res.status, 200);
  assert.equal(res.body.mfaRequired, true);
  assert.deepEqual(res.body.factors, [{ id: 'factor-1', friendlyName: 'Phone', factorType: 'totp' }]);
  assert.equal(typeof res.body.pendingBlob, 'string');
  assert.equal(res.body.pendingBlob.includes('tok-aal1-owner'), false, 'blob is ciphertext, not the token');
  const payload = pendingSealer.open(res.body.pendingBlob);
  assert.equal(payload.purpose, 'login');
  assert.equal(payload.authUserId, OWNER_UUID);
  assert.equal(payload.factorId, undefined, 'a login blob seals no factor id — the caller supplies it');
  assert.equal('Set-Cookie' in (res.headers ?? {}), false);
  assert.equal(store.rows.size, 0, 'no session issued before MFA');
  assert.equal(successfulLogins.length, 0, 'no successful login recorded before MFA completes');
});

test('login: correct password + no factor issues an aal2:false session and flags MFA setup', async () => {
  const { composition, store, successfulLogins } = makeSetup();
  const res = await composition.login({ email: 'firm@example.com', password: 'correct horse', ip: '1.2.3.4' });
  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.mfaSetupRequired, true);
  assert.equal(typeof res.body.csrfToken, 'string');
  assert.equal(res.headers['Set-Cookie'].startsWith('__Host-payrollcheck-session='), true);
  assert.equal(store.rows.size, 1);
  const record = [...store.rows.values()][0];
  assert.equal(record.aal2, false, 'a no-MFA session is flagged aal2:false');
  assert.equal(record.authUserId, FIRM_UUID);
  assert.deepEqual(successfulLogins, [{ identifier: 'firm@example.com' }]);
});

// ---------------------------------------------------------------------
// mfaEnroll / mfaVerify
// ---------------------------------------------------------------------
test('mfaEnroll: seals an enroll pending blob and returns the TOTP secret once', async () => {
  const { composition, pendingSealer } = makeSetup();
  const res = await composition.mfaEnroll({
    email: 'owner@example.com',
    password: 'correct horse',
    ip: '1.2.3.4',
  });
  assert.equal(res.status, 200);
  assert.equal(res.body.factorId, 'factor-new');
  assert.equal(res.body.secret, 'S3CR3T');
  assert.equal(res.body.uri, 'otpauth://totp/x');
  assert.equal(typeof res.body.pendingBlob, 'string');
  assert.equal(res.body.pendingBlob.includes('S3CR3T'), false, 'pending blob must not echo the secret');
  const payload = pendingSealer.open(res.body.pendingBlob);
  assert.equal(payload.purpose, 'enroll');
  assert.equal(payload.factorId, 'factor-new');
  assert.equal(payload.authUserId, OWNER_UUID);
});

test('mfaVerify: wrong code returns 401 invalid_code and issues nothing', async () => {
  const { composition, store, successfulLogins } = makeSetup();
  const enrolled = await composition.mfaEnroll({
    email: 'owner@example.com',
    password: 'correct horse',
    ip: '1.2.3.4',
  });
  const res = await composition.mfaVerify({
    pendingBlob: enrolled.body.pendingBlob,
    factorId: 'factor-new',
    code: '000000',
    ip: '1.2.3.4',
  });
  assert.equal(res.status, 401);
  assert.equal(res.body.error, 'invalid_code');
  assert.equal(store.rows.size, 0);
  assert.equal(successfulLogins.length, 0);
});

test('mfaVerify: a login blob without a factor id returns 400', async () => {
  const { composition, store } = makeSetup();
  const loggedIn = await composition.login({ email: 'owner@example.com', password: 'correct horse', ip: '1.2.3.4' });
  const res = await composition.mfaVerify({
    pendingBlob: loggedIn.body.pendingBlob,
    code: '123456',
    ip: '1.2.3.4',
  });
  assert.equal(res.status, 400);
  assert.equal(res.body.error, 'invalid_request');
  assert.equal(store.rows.size, 0);
});

test('mfaVerify: correct code issues the session cookie + CSRF token and records success once', async () => {
  const { composition, store, successfulLogins } = makeSetup();
  const loggedIn = await composition.login({ email: 'owner@example.com', password: 'correct horse', ip: '1.2.3.4' });
  const res = await composition.mfaVerify({
    pendingBlob: loggedIn.body.pendingBlob,
    factorId: 'factor-1',
    code: '123456',
    ip: '1.2.3.4',
  });
  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.mfaEnrolled, false);
  assert.equal(typeof res.body.csrfToken, 'string');
  assert.equal(res.headers['Set-Cookie'].startsWith('__Host-payrollcheck-session='), true);
  assert.equal(store.rows.size, 1);
  const record = [...store.rows.values()][0];
  assert.equal(record.aal2, true, 'the issued session is flagged aal2');
  assert.equal(record.authUserId, OWNER_UUID);
  assert.equal(record.userId, OWNER_SUBJECT);
  assert.deepEqual(successfulLogins, [{ identifier: 'owner@example.com' }]);
});

test('mfaVerify: an enroll blob verifies and reports mfaEnrolled:true', async () => {
  const { composition, store } = makeSetup();
  const enrolled = await composition.mfaEnroll({
    email: 'owner@example.com',
    password: 'correct horse',
    ip: '1.2.3.4',
  });
  const res = await composition.mfaVerify({
    pendingBlob: enrolled.body.pendingBlob,
    code: '123456',
    ip: '1.2.3.4',
  });
  assert.equal(res.status, 200);
  assert.equal(res.body.mfaEnrolled, true);
  assert.equal(store.rows.size, 1);
});

test('mfaVerify: a tampered pending blob returns 401 and issues nothing', async () => {
  const { composition, store } = makeSetup();
  const res = await composition.mfaVerify({
    pendingBlob: 'AAAA.tampered',
    factorId: 'factor-1',
    code: '123456',
    ip: '1.2.3.4',
  });
  assert.equal(res.status, 401);
  assert.equal(res.body.error, 'invalid_code');
  assert.equal(store.rows.size, 0);
});

test('mfaVerify: a factor id that does not match the sealed one returns 400', async () => {
  const { composition, store } = makeSetup();
  const enrolled = await composition.mfaEnroll({
    email: 'owner@example.com',
    password: 'correct horse',
    ip: '1.2.3.4',
  });
  const res = await composition.mfaVerify({
    pendingBlob: enrolled.body.pendingBlob,
    factorId: 'factor-someone-else',
    code: '123456',
    ip: '1.2.3.4',
  });
  assert.equal(res.status, 400);
  assert.equal(store.rows.size, 0);
});

// ---------------------------------------------------------------------
// readReport — the step-8 binding
// ---------------------------------------------------------------------
async function loggedInOwner(overrides = {}) {
  const setup = makeSetup(overrides);
  const loggedIn = await setup.composition.login({ email: 'owner@example.com', password: 'correct horse', ip: '1.2.3.4' });
  const verified = await setup.composition.mfaVerify({
    pendingBlob: loggedIn.body.pendingBlob,
    factorId: 'factor-1',
    code: '123456',
    ip: '1.2.3.4',
  });
  assert.equal(verified.status, 200);
  const cookie = verified.headers['Set-Cookie'].split(';')[0];
  const sessionId = parseCookie(cookie);
  return { ...setup, cookie, sessionId, csrfToken: verified.body.csrfToken };
}

test('readReport: owner reads their own report — 200, audit committed, identity in order', async () => {
  const { composition, cookie, sessionId, csrfToken, auditRows, statements, setRlsCalls, mappingCalls, handlerDeps, authorizeCalls } =
    await loggedInOwner();
  const res = await composition.readReport({
    cookieHeader: cookie,
    csrfToken,
    reportId: REPORT_A,
    action: 'view_report',
  });
  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.report.report_id, REPORT_A);
  assert.equal(res.body.report.business_tenant_id, BUSINESS_A);
  assert.equal(res.body.path, 'business');
  assert.equal('csrfToken' in res.body, false, 'no rotation happened, so no new token is returned');
  // The handler got the binding, not the caller: accessToken is the session id.
  assert.equal(handlerDeps.length, 1);
  assert.equal(typeof handlerDeps[0].query, 'function');
  assert.equal(typeof handlerDeps[0].getSession, 'function');
  assert.equal(typeof handlerDeps[0].getVerifiedUser, 'function');
  assert.equal(typeof handlerDeps[0].requireAal2, 'function');
  assert.equal(typeof handlerDeps[0].resolveSubjectId, 'function');
  assert.equal(typeof handlerDeps[0].authorizeTenantSession, 'function');
  assert.equal(typeof handlerDeps[0].recordAudit, 'function');
  assert.equal(typeof handlerDeps[0].checkRateLimit, 'function');
  // Identity was set auth-only first, then full — and only after mapping.
  // (The login + MFA steps also set identity; assert on the read's pair.)
  assert.deepEqual(
    setRlsCalls.slice(-2).map((c) => ({ subject: c.subjectId, auth: c.authUserId, session: c.sessionId })),
    [
      { subject: undefined, auth: OWNER_UUID, session: undefined },
      { subject: OWNER_SUBJECT, auth: OWNER_UUID, session: sessionId },
    ],
  );
  assert.deepEqual(
    mappingCalls,
    [OWNER_UUID, OWNER_UUID, OWNER_UUID, OWNER_UUID],
    'login maps, MFA maps, the read maps, then the handler resolves again',
  );
  assert.equal(authorizeCalls.length, 1);
  assert.equal(authorizeCalls[0].subjectId, OWNER_SUBJECT);
  // The transaction committed (the audit row persists).
  assert.equal(statements.some((s) => s.sql === 'COMMIT'), true);
  assert.equal(statements.some((s) => s.sql === 'ROLLBACK'), false);
  assert.equal(auditRows.length, 1);
  assert.equal(auditRows[0].outcome, 'allowed');
  assert.equal(auditRows[0].actorSubjectId, OWNER_SUBJECT);
});

test('readReport: the Admin-API user read happens once per request despite two getVerifiedUser calls', async () => {
  const { composition, cookie, csrfToken, adminUserCalls } = await loggedInOwner();
  const before = adminUserCalls.length;
  const res = await composition.readReport({
    cookieHeader: cookie,
    csrfToken,
    reportId: REPORT_A,
    action: 'view_report',
  });
  assert.equal(res.status, 200);
  assert.equal(adminUserCalls.length, before + 1, 'the handler called getVerifiedUser twice; the Admin API was hit once');
  assert.deepEqual(adminUserCalls.slice(-1), [OWNER_UUID]);
});

test('readReport: unknown report returns 404 and still audits + commits', async () => {
  const { composition, cookie, csrfToken, auditRows, statements } = await loggedInOwner();
  const res = await composition.readReport({
    cookieHeader: cookie,
    csrfToken,
    reportId: REPORT_B,
    action: 'view_report',
  });
  assert.equal(res.status, 404);
  assert.equal(res.body.error, 'not_found');
  assert.equal(auditRows.length, 1);
  assert.equal(auditRows[0].outcome, 'denied');
  assert.equal(auditRows[0].reason, 'not_found');
  assert.equal(statements.some((s) => s.sql === 'COMMIT'), true, 'a denial commits so the audit row persists');
  assert.equal(statements.some((s) => s.sql === 'ROLLBACK'), false);
});

test('readReport: no cookie returns 401 and audits nothing', async () => {
  const { composition, auditRows, statements } = makeSetup();
  const res = await composition.readReport({ cookieHeader: '', csrfToken: 'x', reportId: REPORT_A, action: 'view_report' });
  assert.equal(res.status, 401);
  assert.equal(res.body.error, 'invalid_session');
  assert.equal(auditRows.length, 0);
  // A transaction opens (the store needs a query to load) and commits
  // empty — but no identity statement and no audit write ever runs.
  assert.deepEqual(statements.map((s) => s.sql), ['BEGIN', 'COMMIT']);
});

test('readReport: wrong CSRF token returns 403 and audits nothing', async () => {
  const { composition, cookie, auditRows } = await loggedInOwner();
  const res = await composition.readReport({
    cookieHeader: cookie,
    csrfToken: 'csrf-for-someone-else',
    reportId: REPORT_A,
    action: 'view_report',
  });
  assert.equal(res.status, 403);
  assert.equal(res.body.error, 'forbidden');
  assert.equal(auditRows.length, 0);
});

test('readReport: an aal1-only session is denied even with a valid CSRF token', async () => {
  const setup = makeSetup();
  const { composition } = setup;
  // Seed an aal1 session directly — password succeeded, MFA never did.
  await setup.store.set({
    sessionId: 'sess_aal1_only',
    previousSessionId: null,
    graceUntil: null,
    userId: OWNER_SUBJECT,
    authUserId: OWNER_UUID,
    aal2: false,
    createdAt: NOW,
    rotatedAt: NOW,
    lastSeenAt: NOW,
    expiresAt: NOW + 43200,
    revoked: false,
  });
  const res = await composition.readReport({
    cookieHeader: '__Host-payrollcheck-session=sess_aal1_only',
    csrfToken: 'csrf-for-sess_aal1_only',
    reportId: REPORT_A,
    action: 'view_report',
  });
  assert.equal(res.status, 403);
  assert.equal(res.body.error, 'aal2_required');
  assert.equal(setup.auditRows.length, 1);
  assert.equal(setup.auditRows[0].outcome, 'denied');
  assert.equal(setup.auditRows[0].reason, 'aal2_required');
});

test('readReport: a previous (rotated) session id still reads inside its grace window', async () => {
  const setup = makeSetup();
  const { composition } = setup;
  // The current session was rotated from SESSION_PREV; the browser
  // still presents the old cookie + the old CSRF token inside the
  // grace window. load() resolves it to the current session.
  await setup.store.set({
    sessionId: SESSION_OWNER,
    previousSessionId: SESSION_PREV,
    graceUntil: NOW + 60,
    userId: OWNER_SUBJECT,
    authUserId: OWNER_UUID,
    aal2: true,
    createdAt: NOW,
    rotatedAt: NOW,
    lastSeenAt: NOW,
    expiresAt: NOW + 43200,
    revoked: false,
  });
  const res = await composition.readReport({
    cookieHeader: `__Host-payrollcheck-session=${SESSION_PREV}`,
    csrfToken: `csrf-for-${SESSION_PREV}`,
    reportId: REPORT_A,
    action: 'view_report',
  });
  assert.equal(res.status, 200);
  assert.equal(res.body.report.report_id, REPORT_A);
  // Rotation was triggered by the grace presentation: the response
  // carries the new cookie AND the new CSRF token for it.
  assert.equal(res.headers['Set-Cookie'].includes(SESSION_OWNER), true);
  assert.equal(res.body.csrfToken, `csrf-for-${SESSION_OWNER}`);
  // The handler's getSession is the grace composition: the presented
  // previous id resolves through it too.
  const viaHandlerLookup = await setup.handlerDeps[0].getSession(SESSION_PREV);
  assert.equal(viaHandlerLookup.sessionId, SESSION_OWNER);
});

test('readReport: a previous session id past its grace window is denied', async () => {
  const setup = makeSetup();
  const { composition } = setup;
  await setup.store.set({
    sessionId: SESSION_OWNER,
    previousSessionId: SESSION_PREV,
    graceUntil: NOW - 1,
    userId: OWNER_SUBJECT,
    authUserId: OWNER_UUID,
    aal2: true,
    createdAt: NOW,
    rotatedAt: NOW,
    lastSeenAt: NOW,
    expiresAt: NOW + 43200,
    revoked: false,
  });
  const res = await composition.readReport({
    cookieHeader: `__Host-payrollcheck-session=${SESSION_PREV}`,
    csrfToken: `csrf-for-${SESSION_PREV}`,
    reportId: REPORT_A,
    action: 'view_report',
  });
  assert.equal(res.status, 401);
  assert.equal(res.body.error, 'invalid_session');
});

test('readReport: no isolation statement is ever sent — READ COMMITTED', async () => {
  const { composition, cookie, csrfToken, statements } = await loggedInOwner();
  await composition.readReport({
    cookieHeader: cookie,
    csrfToken,
    reportId: REPORT_A,
    action: 'view_report',
  });
  for (const s of statements) {
    assert.equal(/isolation/i.test(s.sql), false, `isolation statement found: ${s.sql}`);
    assert.equal(/SET TRANSACTION/i.test(s.sql), false, `SET TRANSACTION found: ${s.sql}`);
  }
});

test('readReport: a rotated session returns the new cookie AND the new CSRF token', async () => {
  const { composition, cookie, csrfToken, sessionId } = await loggedInOwner({ rotateOnLoad: true });
  const res = await composition.readReport({
    cookieHeader: cookie,
    csrfToken,
    reportId: REPORT_A,
    action: 'view_report',
  });
  assert.equal(res.status, 200);
  assert.equal(typeof res.headers['Set-Cookie'], 'string');
  assert.equal(res.headers['Set-Cookie'].includes(sessionId), true);
  assert.equal(res.body.csrfToken, `csrf-for-${sessionId}`);
});

test('readReport: an unconfirmed email is denied and audited', async () => {
  const setup = makeSetup({ unconfirmedAdmin: true });
  const { composition } = setup;
  await setup.store.set({
    sessionId: 'sess_unconfirmed',
    previousSessionId: null,
    graceUntil: null,
    userId: OWNER_SUBJECT,
    authUserId: OWNER_UUID,
    aal2: true,
    createdAt: NOW,
    rotatedAt: NOW,
    lastSeenAt: NOW,
    expiresAt: NOW + 43200,
    revoked: false,
  });
  const res = await composition.readReport({
    cookieHeader: '__Host-payrollcheck-session=sess_unconfirmed',
    csrfToken: 'csrf-for-sess_unconfirmed',
    reportId: REPORT_A,
    action: 'view_report',
  });
  assert.equal(res.status, 403);
  assert.equal(res.body.error, 'email_unconfirmed');
  assert.equal(setup.auditRows.length, 1);
  assert.equal(setup.auditRows[0].reason, 'email_unconfirmed');
});

test('readReport: an unsupported action returns 400 before any transaction', async () => {
  const { composition, cookie, csrfToken, statements } = await loggedInOwner();
  const before = statements.length;
  const res = await composition.readReport({
    cookieHeader: cookie,
    csrfToken,
    reportId: REPORT_A,
    action: 'export_report',
  });
  assert.equal(res.status, 400);
  assert.equal(res.body.error, 'invalid_request');
  assert.equal(statements.length, before, 'the rejected read opened no transaction');
});

// ---------------------------------------------------------------------
// logout
// ---------------------------------------------------------------------
test('logout: a presented session is revoked and the cookie is cleared', async () => {
  const { composition, cookie, csrfToken, store } = await loggedInOwner();
  assert.equal(store.rows.size, 1);
  const res = await composition.logout({ cookieHeader: cookie, csrfToken });
  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.headers['Set-Cookie'].includes('Max-Age=0'), true);
  assert.equal(store.rows.size, 0);
  // The revoked session no longer reads.
  const after = await composition.readReport({
    cookieHeader: cookie,
    csrfToken,
    reportId: REPORT_A,
    action: 'view_report',
  });
  assert.equal(after.status, 401);
});

test('logout: no cookie is an idempotent 200 with a clear-cookie header', async () => {
  const { composition } = makeSetup();
  const res = await composition.logout({ cookieHeader: '', csrfToken: 'x' });
  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.headers['Set-Cookie'].includes('Max-Age=0'), true);
});

test('logout: a wrong CSRF token refuses to revoke the session', async () => {
  const { composition, cookie, store } = await loggedInOwner();
  const res = await composition.logout({ cookieHeader: cookie, csrfToken: 'csrf-for-someone-else' });
  assert.equal(res.status, 403);
  assert.equal(res.body.error, 'forbidden');
  assert.equal(store.rows.size, 1, 'the session survives a refused logout');
  assert.equal('Set-Cookie' in (res.headers ?? {}), false);
});

// ---------------------------------------------------------------------
// deactivateMembershipAndRevokeSessions
// ---------------------------------------------------------------------
test('deactivateMembershipAndRevokeSessions: deactivates AND revokes every server session', async () => {
  const { composition, store } = await loggedInOwner();
  // A second session for the same user (another device).
  await store.set({
    sessionId: 'sess_second_device',
    previousSessionId: null,
    graceUntil: null,
    userId: OWNER_SUBJECT,
    authUserId: OWNER_UUID,
    aal2: true,
    createdAt: NOW,
    rotatedAt: NOW,
    lastSeenAt: NOW,
    expiresAt: NOW + 43200,
    revoked: false,
  });
  assert.equal(store.rows.size, 2);
  const res = await composition.deactivateMembershipAndRevokeSessions({
    tenantId: BUSINESS_A,
    subjectId: OWNER_SUBJECT,
  });
  assert.deepEqual(res, { ok: true, deactivated: true, sessionsRevoked: true });
  assert.equal(store.rows.size, 0, 'every server session for the user is gone');
  // The deactivated member can no longer read.
  const after = await composition.readReport({
    cookieHeader: '__Host-payrollcheck-session=sess_usr_ownerA123456789012',
    csrfToken: 'csrf-for-sess_usr_ownerA123456789012',
    reportId: REPORT_A,
    action: 'view_report',
  });
  assert.equal(after.status, 401);
});

test('deactivateMembershipAndRevokeSessions: an already-inactive membership still revokes sessions', async () => {
  const { composition, store } = await loggedInOwner({
    deactivateReturns: { ok: true, deactivated: false },
  });
  const res = await composition.deactivateMembershipAndRevokeSessions({
    tenantId: BUSINESS_A,
    subjectId: OWNER_SUBJECT,
  });
  assert.deepEqual(res, { ok: true, deactivated: false, sessionsRevoked: true });
  assert.equal(store.rows.size, 0);
});

test('deactivateMembershipAndRevokeSessions: a throwing deactivation revokes nothing', async () => {
  const { composition, store } = await loggedInOwner({ deactivateThrows: true });
  await assert.rejects(
    () =>
      composition.deactivateMembershipAndRevokeSessions({
        tenantId: BUSINESS_A,
        subjectId: OWNER_SUBJECT,
      }),
    /deactivate failed/,
  );
  assert.equal(store.rows.size, 1, 'sessions survive when the deactivation throws');
});

test('deactivateMembershipAndRevokeSessions: a malformed deactivation result revokes nothing and reports accurately', async () => {
  const { composition, store } = await loggedInOwner({
    deactivateReturns: { ok: false },
  });
  const res = await composition.deactivateMembershipAndRevokeSessions({
    tenantId: BUSINESS_A,
    subjectId: OWNER_SUBJECT,
  });
  assert.deepEqual(res, { ok: false, reason: 'deactivate_failed', deactivated: false, sessionsRevoked: false });
  assert.equal(store.rows.size, 1, 'no revocation happened for a failed deactivation');
});

test('deactivateMembershipAndRevokeSessions: a failed revoke is reported loudly', async () => {
  const { composition, store } = await loggedInOwner({ revokeAllReturnsFalse: true });
  const res = await composition.deactivateMembershipAndRevokeSessions({
    tenantId: BUSINESS_A,
    subjectId: OWNER_SUBJECT,
  });
  assert.deepEqual(res, { ok: false, reason: 'sessions_not_revoked', deactivated: true, sessionsRevoked: false });
  assert.equal(store.rows.size, 1, 'the session is still live — the report says so');
});

test('deactivateMembershipAndRevokeSessions: bad input throws', async () => {
  const { composition } = makeSetup();
  await assert.rejects(
    () => composition.deactivateMembershipAndRevokeSessions({ tenantId: 'not-a-uuid', subjectId: OWNER_SUBJECT }),
    /tenant_id_and_subject_id_required/,
  );
});

// ---------------------------------------------------------------------
// requestRecovery
// ---------------------------------------------------------------------
test('requestRecovery: rate-limited returns 429 without calling Supabase', async () => {
  const { composition, rateChecks, recoveryCalls } = makeSetup({ rateLimitBlocked: true });
  const res = await composition.requestRecovery({ email: 'owner@example.com', ip: '1.2.3.4' });
  assert.equal(res.status, 429);
  assert.equal(res.body.error, 'try_again_later');
  assert.equal(res.headers['Retry-After'], '20');
  assert.deepEqual(rateChecks, [{ key: 'recover:ip:1.2.3.4' }]);
  assert.equal(recoveryCalls.length, 0);
});

test('requestRecovery: an unknown email still returns 200 (no enumeration)', async () => {
  const { composition, recoveryCalls } = makeSetup();
  const res = await composition.requestRecovery({ email: 'nobody@example.com', ip: '1.2.3.4' });
  assert.equal(res.status, 200);
  assert.equal(res.body.message, 'If an account exists for that email, a reset link is on its way.');
  assert.equal(recoveryCalls[0].redirectTo, 'https://payrolltaxreform.com/payrollcheck/login.html');
});

test('requestRecovery: a failed send returns 503, never a false success', async () => {
  const { composition } = makeSetup({ recoveryFails: true });
  const res = await composition.requestRecovery({ email: 'owner@example.com', ip: '1.2.3.4' });
  assert.equal(res.status, 503);
  assert.equal(res.body.error, 'unavailable');
});

test('requestRecovery: an invalid email returns 400', async () => {
  const { composition } = makeSetup();
  const res = await composition.requestRecovery({ email: 'not-an-email', ip: '1.2.3.4' });
  assert.equal(res.status, 400);
  assert.equal(res.body.error, 'invalid_request');
});
