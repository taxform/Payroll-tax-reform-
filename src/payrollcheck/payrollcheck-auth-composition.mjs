// Login/session/report orchestration for PayrollCheck 360 (M2 step 9).
//
// The composition that binds steps 2–8 into the staging login flow. It
// is transport-agnostic: every endpoint is a pure async function taking
// plain params and returning { status, body, headers? } — the Netlify
// Function adapters (.mts) translate HTTP <-> these calls. All
// collaborators are injected (same pattern as steps 2–8); the factory
// throws TypeError when a required one is missing. Nothing is logged
// except through the injected `log` (default no-op), and log events
// carry only { requestId, route, status, reason } — never an email, a
// token, a pending blob, or report content.
//
// ENDPOINTS (staging only, fabricated data):
//   login({ email, password, ip }) — password check (GoTrue), Admin-API
//     email confirmation, step-3 subject mapping, MFA factor list. No
//     factors → issue the server session (aal2:false) + Set-Cookie +
//     { mfaSetupRequired: true }. Factors exist → NO session; return
//     { mfaRequired: true, factors, pendingBlob } (the aal1 token sealed
//     in the blob — ciphertext the browser carries transiently).
//   mfaVerify({ pendingBlob, factorId, code, ip }) — open the blob,
//     challenge + verify the TOTP code, re-verify the new aal2 token
//     (JWKS + Admin API + mapping), issue the session (aal2:true).
//   mfaVerify intentionally accepts BOTH 'login' and 'enroll' pending blobs
//   (the purpose is recorded as mfaEnrolled, it is not a gate): both blob types
//   are issued only after password authentication of the same user and both
//   still require the TOTP code. The enroll flow depends on this, so do not
//   turn it into a purpose check.
// mfaEnroll({ email, password, ip, sessionId }) — re-authenticate, enroll
//   a TOTP factor, return { factorId, qrCode, secret, uri, pendingBlob }.
//   The secret is shown ONCE, by the caller; it is never stored here. At most
//   MAX_TOTP_FACTORS_PER_USER (3) factors per user: the first factor enrolls
//   with password only; an additional factor requires an existing session for
//   the same user (sessionId, validated through the session lookup).
//   logout({ cookieHeader, csrfToken }) — revoke the session, clear the
//     cookie. Idempotent when no session is presented.
//   requestRecovery({ email, ip }) — step-4c recovery email; the client
//     message never reveals whether the account exists.
//   readReport({ cookieHeader, csrfToken, reportId, action, ip }) — the
//     endpoint contract's checkAuthenticatedReportAccess, over the cookie
//     binding (see §3 below). The CSRF token is verified against the
//     presented session id (grace-aware — see the readReport comment);
//     a rotation also returns the new token in the body so the browser
//     can update it.
//   deactivateMembershipAndRevokeSessions({ tenantId, subjectId, actorSubjectId }) —
//     admin composition (no HTTP endpoint in step 9; ops script only):
//     deactivate the membership AND revoke all server sessions. A
//     revoke failure is reported loudly, never hidden.
//
// GENERIC CLIENT ERRORS (never leak internals): 'invalid_request' (400),
// 'invalid_credentials' (401 — same message for bad password, unconfirmed
// email, and unmapped user), 'invalid_code' (401), 'forbidden' (403, CSRF),
// 'not_found' (404, from the report handler), 'mfa_required' (403),
// 'rate_limited' (429, retryAfterMs when known), 'unavailable' (503).
// The lockout and the IP rate limit both present as the same generic
// "try again later" — the real reason goes only to the edge log.
//
// §1 LOCKOUT ACCOUNTING (step-5 rule): recordSuccessfulLogin clears the
// failure count ONLY after the FULL login completes — password success
// alone does not clear it. A password-only success that never finishes
// MFA leaves the counter untouched; it is cleared at session issue
// (no-MFA login, or MFA verify).
//
// §2 PER-REQUEST DATABASE COLLABORATORS: the session store, the session
// layer, the tenancy module, the subject mapping, and the report handler
// all take a `query` bound to ONE transaction, so they are built per
// request inside withTransaction from the injected factories — never
// pre-built on a different connection. The request scope (step-9 module)
// owns BEGIN/COMMIT/ROLLBACK/release; this module owns the identity
// sequence inside it (setRlsIdentity, step-7 §8).
//
// §3 THE COOKIE BINDING (documented deviation — read this before
// changing it): the step-8 handler was written for a Bearer flow and
// takes an `accessToken` string. The browser holds only the server
// session cookie, so at report time there is no Supabase access token.
// This composition therefore calls handleReportAccess with
// `accessToken` = the presented server session id, and injects
// session-backed adapters:
//   - getVerifiedUser: a FRESH Admin-API read (fetchAdminUser) of the
//     session's authUserId — the email_confirmed_at / is_anonymous the
//     handler checks come from Auth live, nothing is fabricated.
//   - requireAal2: the session record's aal2 flag, set at issuance
//     only after the JWKS-verified aal2 check passed.
//   - getSession: the report-session-lookup composition (current id,
//     then previous id for the rotation grace).
//   - resolveSubjectId / authorizeTenantSession / recordAudit /
//     checkRateLimit: the real step-3 / step-5-seam / step-6 / step-4c
//     collaborators, bound to the same transaction.
// The handler's own session re-check then re-validates the same record
// the 4a load() just validated — defense in depth, and load() also
// performs rotation (new cookie) which the handler does not do. The
// handler itself is UNCHANGED. The alternative — a dedicated
// session-verified entry point in the handler — is a follow-up the
// security review can rule on; it is NOT done here.
import { randomUUID } from 'node:crypto';
import { createDashboardAccessHandler } from './payrollcheck-dashboard-access.mjs';
import { createCompanyAccessHandler } from './payrollcheck-company-access.mjs';
import { createEmployeeAccessHandler } from './payrollcheck-employees-access.mjs';
import { createPayRunAccessHandler } from './payrollcheck-pay-runs-access.mjs';
import { createPayRunLoader, PAY_RUN_ACTIONS } from './payrollcheck-pay-runs.mjs';
import { createCompanyLoader } from './payrollcheck-company.mjs';
import { EMPLOYEE_ACTIONS, createEmployeeLoader } from './payrollcheck-employees.mjs';
import { createDashboardLoader } from './payrollcheck-dashboard.mjs';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SUBJECT_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CODE_PATTERN = /^[0-9]{6}$/;
const ACTIONS = ['view_report', 'review_finding'];
const MAX_PASSWORD_LENGTH = 256;
const MAX_BLOB_LENGTH = 4096;
const MAX_FACTOR_ID_LENGTH = 128;
const MAX_IP_LENGTH = 256;
const MAX_REQUEST_ID_LENGTH = 128;

function requireFn(value, name) {
  if (typeof value !== 'function') throw new TypeError(`${name}_required`);
  return value;
}

function validAppUrl(value) {
  if (typeof value !== 'string') return false;
  let url;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  return url.protocol === 'https:' && !url.search && !url.hash;
}

// Maximum TOTP factors per user (S9). The first factor enrolls with password
// only; enrolling an additional factor requires an existing session for the
// same user, and no user may hold more than this many factors.
export const MAX_TOTP_FACTORS_PER_USER = 3;

export function createPayrollcheckAuth({
  withTransaction,
  setRlsIdentity,
  signInWithPassword,
  fetchAdminUser,
  verifyEmailConfirmed,
  requireAal2,
  mappingFactory,
  tenancyFactory,
  sessionStoreFactory,
  sessionLayerFactory,
  reportHandlerFactory,
  dashboardHandlerFactory = createDashboardAccessHandler,
  companyHandlerFactory = createCompanyAccessHandler,
  employeesHandlerFactory = createEmployeeAccessHandler,
  payRunsHandlerFactory = createPayRunAccessHandler,
  reportSessionLookupFactory,
  authorizeTenantSession,
  authLimits,
  listMfaFactors,
  enrollTotpFactor,
  challengeMfaFactor,
  verifyMfaChallenge,
  requestPasswordRecovery,
  pendingSeal,
  pendingOpen,
  sealEmployeeSsn = null,
  appUrl,
  generateId = () => randomUUID(),
  now = () => Math.floor(Date.now() / 1000),
  log = () => {},
} = {}) {
  requireFn(withTransaction, 'with_transaction');
  requireFn(setRlsIdentity, 'set_rls_identity');
  requireFn(signInWithPassword, 'sign_in_with_password');
  requireFn(fetchAdminUser, 'fetch_admin_user');
  requireFn(verifyEmailConfirmed, 'verify_email_confirmed');
  requireFn(requireAal2, 'require_aal2');
  requireFn(mappingFactory, 'mapping_factory');
  requireFn(tenancyFactory, 'tenancy_factory');
  requireFn(sessionStoreFactory, 'session_store_factory');
  requireFn(sessionLayerFactory, 'session_layer_factory');
  requireFn(reportHandlerFactory, 'report_handler_factory');
  requireFn(dashboardHandlerFactory, 'dashboard_handler_factory');
  requireFn(companyHandlerFactory, 'company_handler_factory');
  requireFn(employeesHandlerFactory, 'employees_handler_factory');
  requireFn(payRunsHandlerFactory, 'pay_runs_handler_factory');
  requireFn(reportSessionLookupFactory, 'report_session_lookup_factory');
  requireFn(authorizeTenantSession, 'authorize_tenant_session');
  requireFn(pendingSeal, 'pending_seal');
  requireFn(pendingOpen, 'pending_open');
  if (!authLimits || typeof authLimits.checkLoginAllowed !== 'function' ||
    typeof authLimits.recordFailedLogin !== 'function' ||
    typeof authLimits.recordSuccessfulLogin !== 'function' ||
    typeof authLimits.checkRateLimit !== 'function') {
    throw new TypeError('auth_limits_required');
  }
  requireFn(listMfaFactors, 'list_mfa_factors');
  requireFn(enrollTotpFactor, 'enroll_totp_factor');
  requireFn(challengeMfaFactor, 'challenge_mfa_factor');
  requireFn(verifyMfaChallenge, 'verify_mfa_challenge');
  requireFn(requestPasswordRecovery, 'request_password_recovery');
  if (!validAppUrl(appUrl)) throw new TypeError('app_url_must_be_https');
  if (typeof generateId !== 'function') throw new TypeError('generate_id_required');
  if (typeof now !== 'function') throw new TypeError('now_required');
  if (typeof log !== 'function') throw new TypeError('log_required');

  function requestIdFor(requestId) {
    if (requestId === undefined) return generateId();
    if (
      typeof requestId !== 'string' ||
      requestId.length === 0 ||
      requestId.length > MAX_REQUEST_ID_LENGTH
    ) {
      return generateId();
    }
    return requestId;
  }

  function edgeLog(requestId, route, status, reason) {
    try {
      log({ requestId, route, status, reason });
    } catch {
      // Logging must never break the request.
    }
  }

  function invalidCredentials(requestId, route) {
    edgeLog(requestId, route, 401, 'invalid_credentials');
    return { status: 401, body: { error: 'invalid_credentials' } };
  }

  function validEmail(email) {
    return typeof email === 'string' && EMAIL_PATTERN.test(email);
  }

  function validPassword(password) {
    return (
      typeof password === 'string' &&
      password.length > 0 &&
      password.length <= MAX_PASSWORD_LENGTH
    );
  }

  function validIp(ip) {
    return typeof ip === 'string' && ip.length > 0 && ip.length <= MAX_IP_LENGTH;
  }

  // Shared pre-login gate: lockout + rate limit, then password check.
  // Returns { ok: true, signIn } or a terminal response object.
  async function passwordGate({ email, password, ip, requestId, route }) {
    if (!validEmail(email) || !validPassword(password)) {
      return { status: 400, body: { error: 'invalid_request' } };
    }
    let allowed;
    try {
      allowed = await authLimits.checkLoginAllowed({ identifier: email, ip });
    } catch {
      edgeLog(requestId, route, 503, 'login_allowed_check_failed');
      return { status: 503, body: { error: 'unavailable' } };
    }
    if (!allowed || allowed.allowed !== true) {
      const reason = allowed && allowed.reason ? allowed.reason : 'unavailable';
      if (reason === 'unavailable') {
        // Lockout read failed closed (step 4c): the lockout cannot be
        // checked, so the attempt is denied — loudly, not silently.
        edgeLog(requestId, route, 503, 'login_allowed_unavailable');
        return { status: 503, body: { error: 'unavailable' } };
      }
      // Locked out AND rate limited present identically to the caller:
      // one generic message, no distinction. The real reason is logged.
      edgeLog(requestId, route, 429, reason);
      return {
        status: 429,
        body: { error: 'try_again_later' },
        ...(typeof allowed.retryAfterMs === 'number'
          ? { headers: { 'Retry-After': String(Math.ceil(allowed.retryAfterMs / 1000)) } }
          : {}),
      };
    }
    let signIn;
    try {
      signIn = await signInWithPassword({ email, password });
    } catch {
      // Bad password (or any sign-in failure): count it, answer generically.
      try {
        await authLimits.recordFailedLogin({ identifier: email, ip });
      } catch {
        // recordFailedLogin never throws by contract; defensive anyway.
      }
      return invalidCredentials(requestId, route);
    }
    if (!signIn || !signIn.user || !UUID_PATTERN.test(signIn.user.id)) {
      return invalidCredentials(requestId, route);
    }
    return { ok: true, signIn };
  }

  // Shared post-password checks: Admin-API email confirmation + subject
  // mapping (inside one transaction, auth-only identity first). Returns
  // { ok: true, subjectId } or a terminal response object.
  async function confirmAndMap({ authUserId, requestId, route }) {
    let confirmed;
    try {
      confirmed = await verifyEmailConfirmed(authUserId);
    } catch {
      confirmed = false;
    }
    if (confirmed !== true) return invalidCredentials(requestId, route);
    let subjectId = null;
    try {
      subjectId = await withTransaction(async ({ query }) => {
        await setRlsIdentity({ query, authUserId });
        const mapping = mappingFactory({ query });
        return mapping.resolveInternalUserId(authUserId);
      });
    } catch {
      edgeLog(requestId, route, 503, 'mapping_failed');
      return { status: 503, body: { error: 'unavailable' } };
    }
    if (typeof subjectId !== 'string' || !subjectId) {
      return invalidCredentials(requestId, route);
    }
    return { ok: true, subjectId };
  }

  // Issue the server session inside a transaction (identity set first,
  // so the sessions INSERT policy sees subject + auth together).
  async function issueSessionTx({ subjectId, authUserId, aal2 }) {
    return withTransaction(async ({ query }) => {
      await setRlsIdentity({ query, subjectId, authUserId });
      const store = sessionStoreFactory({ query });
      const layer = sessionLayerFactory({ store });
      const session = await layer.issue({ userId: subjectId, authUserId, aal2 });
      if (!session) throw new Error('session_issue_failed');
      return session;
    });
  }

  async function login({ email, password, ip, requestId: rawRequestId } = {}) {
    const requestId = requestIdFor(rawRequestId);
    const route = 'login';
    const gated = await passwordGate({ email, password, ip, requestId, route });
    if (!gated.ok) return gated;
    const { signIn } = gated;
    const authUserId = signIn.user.id;
    const mapped = await confirmAndMap({ authUserId, requestId, route });
    if (!mapped.ok) return mapped;
    let factors;
    try {
      factors = await listMfaFactors({ accessToken: signIn.access_token });
    } catch {
      edgeLog(requestId, route, 503, 'mfa_factors_failed');
      return { status: 503, body: { error: 'unavailable' } };
    }
    if (!Array.isArray(factors)) {
      edgeLog(requestId, route, 503, 'mfa_factors_invalid');
      return { status: 503, body: { error: 'unavailable' } };
    }
    if (factors.length > 0) {
      // MFA enrolled: no session yet. The aal1 token is sealed into the
      // pending blob (ciphertext); the browser carries it to verify.
      const pendingBlob = pendingSeal({
        purpose: 'login',
        authUserId,
        accessToken: signIn.access_token,
      });
      edgeLog(requestId, route, 200, 'mfa_required');
      return {
        status: 200,
        body: {
          mfaRequired: true,
          factors: factors.map((f) => ({
            id: typeof f.id === 'string' ? f.id : null,
            friendlyName: typeof f.friendly_name === 'string' ? f.friendly_name : null,
            factorType: typeof f.factor_type === 'string' ? f.factor_type : null,
          })),
          pendingBlob,
        },
      };
    }
    let session;
    try {
      session = await issueSessionTx({ subjectId: mapped.subjectId, authUserId, aal2: false });
    } catch {
      edgeLog(requestId, route, 503, 'session_issue_failed');
      return { status: 503, body: { error: 'unavailable' } };
    }
    // Full login complete (no MFA enrolled): clear the failure count now.
    try {
      await authLimits.recordSuccessfulLogin({ identifier: email });
    } catch {
      // Non-fatal: the session already exists; the counter clears on the
      // next successful login. Logged, not surfaced.
      edgeLog(requestId, route, 200, 'clear_failures_failed');
    }
    edgeLog(requestId, route, 200, 'allowed');
    return {
      status: 200,
      headers: { 'Set-Cookie': session.cookie },
      body: {
        ok: true,
        csrfToken: session.csrfToken,
        expiresAt: session.expiresAt,
        mfaSetupRequired: true,
      },
    };
  }

  async function mfaVerify({ pendingBlob, factorId, code, ip, requestId: rawRequestId } = {}) {
    const requestId = requestIdFor(rawRequestId);
    const route = 'mfa_verify';
    if (
      typeof pendingBlob !== 'string' ||
      !pendingBlob ||
      pendingBlob.length > MAX_BLOB_LENGTH ||
      typeof code !== 'string' ||
      !CODE_PATTERN.test(code)
    ) {
      return { status: 400, body: { error: 'invalid_request' } };
    }
    // NOTE: the pending blob's purpose is intentionally NOT checked here.
  // mfaVerify accepts both 'login' and 'enroll' blobs (see the module header):
  // both are issued only after password authentication of the same user and
  // both still require the TOTP code. The purpose only sets mfaEnrolled below.
  const pending = pendingOpen(pendingBlob);
    if (!pending) {
      edgeLog(requestId, route, 401, 'invalid_pending_token');
      return { status: 401, body: { error: 'invalid_code' } };
    }
    const effectiveFactorId =
      factorId !== undefined ? factorId : pending.factorId;
    if (
      typeof effectiveFactorId !== 'string' ||
      !effectiveFactorId ||
      effectiveFactorId.length > MAX_FACTOR_ID_LENGTH ||
      (pending.factorId !== undefined && effectiveFactorId !== pending.factorId)
    ) {
      return { status: 400, body: { error: 'invalid_request' } };
    }
    if (validIp(ip)) {
      let rate;
      try {
        rate = await authLimits.checkRateLimit({ key: `mfa:ip:${ip}` });
      } catch {
        rate = null;
      }
      if (rate && rate.allowed === false) {
        edgeLog(requestId, route, 429, 'rate_limited');
        return {
          status: 429,
          body: { error: 'try_again_later' },
          ...(typeof rate.resetMs === 'number'
            ? { headers: { 'Retry-After': String(Math.ceil(rate.resetMs / 1000)) } }
            : {}),
        };
      }
    }
    let challenge;
    try {
      challenge = await challengeMfaFactor({
        accessToken: pending.accessToken,
        factorId: effectiveFactorId,
      });
    } catch {
      edgeLog(requestId, route, 401, 'mfa_challenge_failed');
      return { status: 401, body: { error: 'invalid_code' } };
    }
    if (!challenge || typeof challenge.id !== 'string' || !challenge.id) {
      return { status: 401, body: { error: 'invalid_code' } };
    }
    let verified;
    try {
      verified = await verifyMfaChallenge({
        accessToken: pending.accessToken,
        factorId: effectiveFactorId,
        challengeId: challenge.id,
        code,
      });
    } catch {
      edgeLog(requestId, route, 401, 'mfa_verify_failed');
      return { status: 401, body: { error: 'invalid_code' } };
    }
    const newToken =
      verified && typeof verified.access_token === 'string'
        ? verified.access_token
        : null;
    const newUser = verified && verified.user ? verified.user : null;
    if (!newToken || !newUser || newUser.id !== pending.authUserId) {
      edgeLog(requestId, route, 401, 'mfa_verify_user_mismatch');
      return { status: 401, body: { error: 'invalid_code' } };
    }
    // Defense in depth: the verify response should already be aal2 —
    // check it independently (JWKS) before issuing the session.
    let aal2 = false;
    try {
      aal2 = await requireAal2(newToken, newUser.id);
    } catch {
      aal2 = false;
    }
    if (aal2 !== true) {
      edgeLog(requestId, route, 401, 'mfa_verify_not_aal2');
      return { status: 401, body: { error: 'invalid_code' } };
    }
    const mapped = await confirmAndMap({ authUserId: newUser.id, requestId, route });
    if (!mapped.ok) return mapped;
    let session;
    try {
      session = await issueSessionTx({
        subjectId: mapped.subjectId,
        authUserId: newUser.id,
        aal2: true,
      });
    } catch {
      edgeLog(requestId, route, 503, 'session_issue_failed');
      return { status: 503, body: { error: 'unavailable' } };
    }
    // Full login (password + MFA) complete: clear the failure count.
    // The identifier is the account email, read from the fresh
    // Admin-API user object — the blob never carries it.
    try {
      const adminUser = await fetchAdminUser(newUser.id);
      if (adminUser && typeof adminUser.email === 'string' && adminUser.email) {
        await authLimits.recordSuccessfulLogin({ identifier: adminUser.email });
      }
    } catch {
      edgeLog(requestId, route, 200, 'clear_failures_failed');
    }
    edgeLog(requestId, route, 200, 'allowed');
    return {
      status: 200,
      headers: { 'Set-Cookie': session.cookie },
      body: {
        ok: true,
        csrfToken: session.csrfToken,
        expiresAt: session.expiresAt,
        mfaEnrolled: pending.purpose === 'enroll',
      },
    };
  }

  async function mfaEnroll({ email, password, ip, sessionId, requestId: rawRequestId } = {}) {
    const requestId = requestIdFor(rawRequestId);
    const route = 'mfa_enroll';
    const gated = await passwordGate({ email, password, ip, requestId, route });
    if (!gated.ok) return gated;
    const { signIn } = gated;
    const authUserId = signIn.user.id;
  const mapped = await confirmAndMap({ authUserId, requestId, route });
    if (!mapped.ok) return mapped;
    // S9: cap factors per user, and require an existing session to enroll an
    // additional factor. The first factor is the password-only enrollment the
    // login page runs when the user has no authenticator yet; a password alone
    // must not be able to stack unlimited further factors onto the account.
    let existingFactors;
    try {
    existingFactors = (await listMfaFactors({ accessToken: signIn.access_token })) ?? [];
    } catch {
    edgeLog(requestId, route, 503, 'unavailable');
    return { status: 503, body: { error: 'unavailable' } };
    }
    if (!Array.isArray(existingFactors)) existingFactors = [];
    if (existingFactors.length >= MAX_TOTP_FACTORS_PER_USER) {
    edgeLog(requestId, route, 403, 'factor_limit_reached');
    return { status: 403, body: { error: 'factor_limit_reached' } };
    }
    if (existingFactors.length > 0) {
    // An existing session proves a factor was already verified for this
    // user: sessions are only issued after MFA verification when factors
    // exist. A password alone is not enough for a further factor.
    let loaded = null;
    try {
      loaded = await withTransaction(async ({ query }) => {
        const store = sessionStoreFactory({ query });
        const sessionLookup = reportSessionLookupFactory({ store });
        return typeof sessionId === 'string' && sessionId
          ? await sessionLookup.getSession(sessionId)
          : null;
      });
    } catch {
      edgeLog(requestId, route, 503, 'unavailable');
      return { status: 503, body: { error: 'unavailable' } };
    }
    // The session lookup returns the stored session record directly: its
    // userId is the internal subject id and its authUserId is the auth user id.
    // Either one matching proves the session belongs to the user enrolling.
    const sessionMatches =
      loaded &&
      (loaded.userId === mapped.subjectId || loaded.authUserId === authUserId);
    if (!sessionMatches) {
      edgeLog(requestId, route, 403, 'additional_factor_requires_session');
      return { status: 403, body: { error: 'additional_factor_requires_session' } };
    }
    }
    let factor;
    try {
      factor = await enrollTotpFactor({
        accessToken: signIn.access_token,
        friendlyName: 'PayrollCheck authenticator',
        issuer: 'PayrollCheck',
      });
    } catch {
      edgeLog(requestId, route, 503, 'mfa_enroll_failed');
      return { status: 503, body: { error: 'unavailable' } };
    }
    if (
      !factor ||
      typeof factor.id !== 'string' ||
      !factor.id ||
      !factor.totp ||
      typeof factor.totp !== 'object'
    ) {
      edgeLog(requestId, route, 503, 'mfa_enroll_invalid');
      return { status: 503, body: { error: 'unavailable' } };
    }
    // The TOTP secret is returned ONCE, in this response only. The
    // caller shows it and never stores it; the server never logs it.
    const pendingBlob = pendingSeal({
      purpose: 'enroll',
      authUserId,
      accessToken: signIn.access_token,
      factorId: factor.id,
    });
    edgeLog(requestId, route, 200, 'enrolled');
    return {
      status: 200,
      body: {
        factorId: factor.id,
        qrCode: typeof factor.totp.qr_code === 'string' ? factor.totp.qr_code : null,
        secret: typeof factor.totp.secret === 'string' ? factor.totp.secret : null,
        uri: typeof factor.totp.uri === 'string' ? factor.totp.uri : null,
        pendingBlob,
      },
    };
  }

  async function logout({ cookieHeader, csrfToken, requestId: rawRequestId } = {}) {
    const requestId = requestIdFor(rawRequestId);
    const route = 'logout';
    let outcome;
    try {
      outcome = await withTransaction(async ({ query }) => {
        const store = sessionStoreFactory({ query });
        const layer = sessionLayerFactory({ store });
        const sessionId =
          typeof cookieHeader === 'string' && cookieHeader
            ? layer.parseSessionId(cookieHeader)
            : null;
        // No session presented: idempotent logout — clear the cookie, say ok.
        if (!sessionId) {
          return { status: 200, clear: layer.clearCookie(), reason: 'no_session' };
        }
        // A presented session must present its CSRF token too.
        if (layer.verifyCsrf(sessionId, csrfToken) !== true) {
          return { status: 403, reason: 'csrf_failed' };
        }
        // The sessions-table RLS policy hides the row unless the
        // presented session id is set as the RLS identity, so set
        // it before revoke(): otherwise the DELETE matches zero
        // rows and the session stays live until its 12h expiry.
        await setRlsIdentity({ query, sessionId });
        const revoked = await layer.revoke(sessionId);
        if (revoked !== true) {
          // The session row could not be deleted: do NOT clear the
          // cookie and do NOT claim logout succeeded — the session is
          // still live until expiry. Loud, not silent.
          return { status: 503, reason: 'revoke_failed' };
        }
        return { status: 200, clear: layer.clearCookie(), reason: 'allowed' };
      });
    } catch {
      edgeLog(requestId, route, 503, 'logout_failed');
      return { status: 503, body: { error: 'unavailable' } };
    }
    edgeLog(requestId, route, outcome.status, outcome.reason);
    if (outcome.status !== 200) {
      return { status: outcome.status, body: { error: outcome.status === 403 ? 'forbidden' : 'unavailable' } };
    }
    return { status: 200, headers: { 'Set-Cookie': outcome.clear }, body: { ok: true } };
  }

  async function requestRecovery({ email, ip, requestId: rawRequestId } = {}) {
    const requestId = requestIdFor(rawRequestId);
    const route = 'recover';
    if (!validEmail(email)) {
      return { status: 400, body: { error: 'invalid_request' } };
    }
    if (validIp(ip)) {
      let rate;
      try {
        rate = await authLimits.checkRateLimit({ key: `recover:ip:${ip}` });
      } catch {
        rate = null;
      }
      if (rate && rate.allowed === false) {
        edgeLog(requestId, route, 429, 'rate_limited');
        return {
          status: 429,
          body: { error: 'try_again_later' },
          ...(typeof rate.resetMs === 'number'
            ? { headers: { 'Retry-After': String(Math.ceil(rate.resetMs / 1000)) } }
            : {}),
        };
      }
    }
    try {
      await requestPasswordRecovery({
        email,
        redirectTo: `${appUrl}/payrollcheck/login.html`,
      });
    } catch {
      // The email did not go out: say so (503), rather than lie that
      // it did. This reveals an outage, never account existence.
      edgeLog(requestId, route, 503, 'recovery_failed');
      return { status: 503, body: { error: 'unavailable' } };
    }
    // Same message whether or not the account exists (no enumeration).
    edgeLog(requestId, route, 200, 'allowed');
    return {
      status: 200,
      body: { message: 'If an account exists for that email, a reset link is on its way.' },
    };
  }

  async function readReport({ cookieHeader, csrfToken, reportId, action, ip, requestId: rawRequestId } = {}) {
    const requestId = requestIdFor(rawRequestId);
    const route = 'report';
    if (
      typeof action !== 'string' ||
      !ACTIONS.includes(action) ||
      typeof reportId !== 'string' ||
      !UUID_PATTERN.test(reportId)
    ) {
      return { status: 400, body: { error: 'invalid_request' } };
    }
    let outcome;
    try {
      outcome = await withTransaction(async ({ query }) => {
        const store = sessionStoreFactory({ query });
        const layer = sessionLayerFactory({ store });
        // The sessions-table RLS policy hides a row unless
        // payrollcheck.current_session_id matches it, so set the
        // presented session id BEFORE load(): with no identity set
        // the SELECT returns zero rows and every signed-in read
        // fails as unknown_session. No id presented: skip the call
        // (setRlsIdentity throws when given nothing) and let load()
        // return no_session as before.
        const presentedSessionId = layer.parseSessionId(cookieHeader);
        if (presentedSessionId) {
          await setRlsIdentity({ query, sessionId: presentedSessionId });
        }
        const loaded = await layer.load(cookieHeader);
        if (!loaded || loaded.ok !== true) {
          const reason =
            loaded && typeof loaded.reason === 'string' ? loaded.reason : 'no_session';
          if (reason === 'session_lookup_failed') {
            return { status: 503, body: { error: 'unavailable' }, reason };
          }
          return { status: 401, body: { error: 'invalid_session' }, reason };
        }
        const session = loaded.session;
        // CSRF (step-9 fix — readReport previously never verified the
        // token, while logout did): the browser must present the token
        // minted for the session id it holds. Verify against the
        // PRESENTED id first — inside the rotation grace window the
        // browser still holds the previous id and its token, while
        // load() already resolved to the current session. Accepting
        // the current id's token too covers a browser that updated
        // its cookie but not its stored token. Both ids are
        // authenticated by load() above, so neither branch trusts
        // anything the caller invented. A failure is 403, no audit
        // row: the request never reached an authorization decision.
        const presentedId = layer.parseSessionId(cookieHeader);
        const csrfOk =
          (typeof presentedId === 'string' &&
            layer.verifyCsrf(presentedId, csrfToken) === true) ||
          layer.verifyCsrf(session.sessionId, csrfToken) === true;
        if (csrfOk !== true) {
          return { status: 403, body: { error: 'forbidden' }, reason: 'csrf_failed' };
        }
        // Identity, in the step-7 order: auth-only first (the mapping
        // path), then subject + auth + session for the report read.
        await setRlsIdentity({ query, authUserId: session.authUserId });
        const mapping = mappingFactory({ query });
        const subjectId = await mapping.resolveInternalUserId(session.authUserId);
        if (typeof subjectId !== 'string' || !subjectId) {
          return { status: 404, body: { error: 'not_found' }, reason: 'unmapped_user' };
        }
        await setRlsIdentity({
          query,
          subjectId,
          authUserId: session.authUserId,
          sessionId: session.sessionId,
        });
        const tenancy = tenancyFactory({ query });
        const lookup = reportSessionLookupFactory({ store });
        // Memoize the fresh Admin-API read for this ONE request: the
        // handler calls getVerifiedUser at its step 2 AND inside every
        // authorizeTenantSession call (once per candidate tenant), and
        // each call would otherwise be a separate Admin API round-trip
        // for the same user in the same milliseconds. The value cannot
        // change meaningfully inside one request, and the session was
        // just validated by load(). A failed read is NOT cached — the
        // next call retries it.
        let verifiedUserCache;
        let verifiedUserLoaded = false;
        const getVerifiedUser = async () => {
          if (!verifiedUserLoaded) {
            verifiedUserCache = await fetchAdminUser(session.authUserId);
            verifiedUserLoaded = true;
          }
          return verifiedUserCache;
        };
        const handler = reportHandlerFactory({
          query,
          // Cookie binding (§3): the session id stands in for the
          // access-token parameter; verification is session-backed.
          getVerifiedUser,
          requireAal2: async () => session.aal2 === true,
          resolveSubjectId: (authUserId) => mapping.resolveInternalUserId(authUserId),
          authorizeTenantSession,
          recordAudit: (args) => tenancy.recordAccessAudit(args),
          checkRateLimit: (args) => authLimits.checkRateLimit(args),
          getSession: (id) => lookup.getSession(id),
          generateId: () => requestId,
          now: () => now(),
        });
        const decision = await handler.handleReportAccess({
          accessToken: session.sessionId,
          sessionId: session.sessionId,
          reportId,
          action,
          requestId,
          clientIp: validIp(ip) ? ip : undefined,
        });
        return {
          status: decision.status,
          body: decision.ok
            ? { ok: true, report: decision.report, path: decision.path }
            : { error: decision.reason },
          reason: decision.ok ? 'allowed' : decision.reason,
          rotatedCookie: loaded.rotated ? loaded.cookie : null,
          // After a rotation the browser holds a new cookie — and
          // needs the new CSRF token minted for it, or its next
          // request fails the check above. Surfaced only when rotated.
          rotatedCsrfToken: loaded.rotated ? loaded.csrfToken : null,
        };
      });
    } catch {
      edgeLog(requestId, route, 503, 'report_failed');
      return { status: 503, body: { error: 'unavailable' } };
    }
    edgeLog(requestId, route, outcome.status, outcome.reason);
    const headers = {};
    if (outcome.rotatedCookie) headers['Set-Cookie'] = outcome.rotatedCookie;
    const body = { ...outcome.body };
    if (outcome.rotatedCsrfToken) body.csrfToken = outcome.rotatedCsrfToken;
    return { status: outcome.status, headers, body };
  }

  // Dashboard (Slice 1): the signed-in business's app shell. Same preamble as
  // readReport — session load, CSRF, RLS identity in the step-7 order — then the
  // dashboard access handler decides what the caller may see. The tenant id
  // comes from the verified session's memberships, never from the caller: a
  // tenantId in the request only selects among those memberships.
  async function getDashboard({ cookieHeader, csrfToken, tenantId, ip, requestId: rawRequestId } = {}) {
    const requestId = requestIdFor(rawRequestId);
    const route = 'dashboard';
    if (
      tenantId !== undefined &&
      tenantId !== null &&
      (typeof tenantId !== 'string' || !UUID_PATTERN.test(tenantId))
    ) {
      return { status: 400, body: { error: 'invalid_request' } };
    }
    let outcome;
    try {
      outcome = await withTransaction(async ({ query }) => {
        const store = sessionStoreFactory({ query });
        const layer = sessionLayerFactory({ store });
        // Same RLS note as readReport: set the presented session id BEFORE
        // load(), or the sessions-table RLS policy hides the row.
        const presentedSessionId = layer.parseSessionId(cookieHeader);
        if (presentedSessionId) {
          await setRlsIdentity({ query, sessionId: presentedSessionId });
        }
        const loaded = await layer.load(cookieHeader);
        if (!loaded || loaded.ok !== true) {
          const reason = loaded && typeof loaded.reason === 'string' ? loaded.reason : 'no_session';
          if (reason === 'session_lookup_failed') {
            return { status: 503, body: { error: 'unavailable' }, reason };
          }
          return { status: 401, body: { error: 'invalid_session' }, reason };
        }
        const session = loaded.session;
        // CSRF: verify against the PRESENTED id first (rotation grace window),
        // then the current session id. Both ids are authenticated by load().
        const presentedId = layer.parseSessionId(cookieHeader);
        const csrfOk =
          (typeof presentedId === 'string' && layer.verifyCsrf(presentedId, csrfToken) === true) ||
          layer.verifyCsrf(session.sessionId, csrfToken) === true;
        if (csrfOk !== true) {
          return { status: 403, body: { error: 'forbidden' }, reason: 'csrf_failed' };
        }
        // Identity, in the step-7 order: auth-only first (the mapping path),
        // then subject + auth + session for the dashboard read.
        await setRlsIdentity({ query, authUserId: session.authUserId });
        const mapping = mappingFactory({ query });
        const subjectId = await mapping.resolveInternalUserId(session.authUserId);
        if (typeof subjectId !== 'string' || !subjectId) {
          return { status: 401, body: { error: 'invalid_session' }, reason: 'subject_not_found' };
        }
        await setRlsIdentity({ query, subjectId, authUserId: session.authUserId, sessionId: session.sessionId });
        const tenancy = tenancyFactory({ query });
        const lookup = reportSessionLookupFactory({ store });
        let verifiedUser;
        const getVerifiedUser = async () => {
          if (verifiedUser === undefined) verifiedUser = await fetchAdminUser(session.authUserId);
          return verifiedUser;
        };
        const handler = dashboardHandlerFactory({
          getVerifiedUser,
          requireAal2: async () => session.aal2 === true,
          resolveSubjectId: (authUserId) => mapping.resolveInternalUserId(authUserId),
          recordAudit: (args) => tenancy.recordAccessAudit(args),
          checkRateLimit: (args) => authLimits.checkRateLimit(args),
          getSession: (id) => lookup.getSession(id),
          generateId: () => requestId,
          now: () => now(),
          loadDashboard: ({ subjectId: dashboardSubjectId }) =>
            createDashboardLoader({ query }).loadDashboard({ subjectId: dashboardSubjectId }),
        });
        const decision = await handler.handleDashboardAccess({
          accessToken: session.sessionId,
          sessionId: session.sessionId,
          tenantId: tenantId ?? null,
          requestId,
          clientIp: validIp(ip) ? ip : undefined,
        });
        return {
          status: decision.status,
          body: decision.ok
            ? { ok: true, dashboard: decision.dashboard }
            : { error: decision.reason },
          reason: decision.ok ? 'allowed' : decision.reason,
          rotatedCookie: loaded.rotated ? loaded.cookie : null,
          rotatedCsrfToken: loaded.rotated ? loaded.csrfToken : null,
        };
      });
    } catch (error) {
      edgeLog(requestId, route, 'error', error instanceof Error ? error.message : 'unknown');
      outcome = { status: 503, body: { error: 'unavailable' }, reason: 'unavailable' };
    }
    edgeLog(requestId, route, outcome.status, outcome.reason);
    const headers = {};
    if (outcome.rotatedCookie) headers['Set-Cookie'] = outcome.rotatedCookie;
    const body = outcome.body;
    if (outcome.rotatedCsrfToken) body.csrfToken = outcome.rotatedCsrfToken;
    return { status: outcome.status, headers, body };
  }

// Company profile (Slice 2): read or save the signed-in business's company
// profile. Same preamble as getDashboard — session load, CSRF, RLS identity
// in the step-7 order — then the company access handler decides what the
// caller may see or change. The tenant id comes from the verified session's
// memberships, never from the caller: a tenantId in the request only selects
// among those memberships. The action is 'read' or 'write'.
  async function handleCompany({ cookieHeader, csrfToken, tenantId, action, company, ip, requestId: rawRequestId } = {}) {
    const requestId = requestIdFor(rawRequestId);
  const route = 'company';
  if (
    (tenantId !== undefined &&
      tenantId !== null &&
      (typeof tenantId !== 'string' || !UUID_PATTERN.test(tenantId))) ||
    (action !== 'read' && action !== 'write')
  ) {
    return { status: 400, body: { error: 'invalid_request' } };
  }
    let outcome;
    try {
      outcome = await withTransaction(async ({ query }) => {
        const store = sessionStoreFactory({ query });
        const layer = sessionLayerFactory({ store });
        // Same RLS note as readReport: set the presented session id BEFORE
        // load(), or the sessions-table RLS policy hides the row.
        const presentedSessionId = layer.parseSessionId(cookieHeader);
        if (presentedSessionId) {
          await setRlsIdentity({ query, sessionId: presentedSessionId });
        }
        const loaded = await layer.load(cookieHeader);
        if (!loaded || loaded.ok !== true) {
          const reason = loaded && typeof loaded.reason === 'string' ? loaded.reason : 'no_session';
          if (reason === 'session_lookup_failed') {
            return { status: 503, body: { error: 'unavailable' }, reason };
          }
          return { status: 401, body: { error: 'invalid_session' }, reason };
        }
        const session = loaded.session;
        // CSRF: verify against the PRESENTED id first (rotation grace window),
        // then the current session id. Both ids are authenticated by load().
        const presentedId = layer.parseSessionId(cookieHeader);
        const csrfOk =
          (typeof presentedId === 'string' && layer.verifyCsrf(presentedId, csrfToken) === true) ||
          layer.verifyCsrf(session.sessionId, csrfToken) === true;
        if (csrfOk !== true) {
          return { status: 403, body: { error: 'forbidden' }, reason: 'csrf_failed' };
        }
        // Identity, in the step-7 order: auth-only first (the mapping path),
        // then subject + auth + session for the company read or write.
        await setRlsIdentity({ query, authUserId: session.authUserId });
        const mapping = mappingFactory({ query });
        const subjectId = await mapping.resolveInternalUserId(session.authUserId);
        if (typeof subjectId !== 'string' || !subjectId) {
          return { status: 401, body: { error: 'invalid_session' }, reason: 'subject_not_found' };
        }
        await setRlsIdentity({ query, subjectId, authUserId: session.authUserId, sessionId: session.sessionId });
        const tenancy = tenancyFactory({ query });
        const lookup = reportSessionLookupFactory({ store });
        let verifiedUser;
        const getVerifiedUser = async () => {
          if (verifiedUser === undefined) verifiedUser = await fetchAdminUser(session.authUserId);
          return verifiedUser;
        };
        const handler = companyHandlerFactory({
          getVerifiedUser,
          requireAal2: async () => session.aal2 === true,
          resolveSubjectId: (authUserId) => mapping.resolveInternalUserId(authUserId),
          recordAudit: (args) => tenancy.recordAccessAudit(args),
          checkRateLimit: (args) => authLimits.checkRateLimit(args),
          getSession: (id) => lookup.getSession(id),
          generateId: () => requestId,
          now: () => now(),
    loadCompanyProfile: ({ subjectId: companySubjectId }) =>
      createCompanyLoader({ query }).loadCompanyProfile({ subjectId: companySubjectId }),
    saveCompany: (companyTenantId, companyProfile) =>
      createCompanyLoader({ query }).saveCompany(companyTenantId, companyProfile),
        });
        const decision = await handler.handleCompanyAccess({
          accessToken: session.sessionId,
          sessionId: session.sessionId,
          tenantId: tenantId ?? null,
      action,
      company,
          requestId,
          clientIp: validIp(ip) ? ip : undefined,
        });
        return {
          status: decision.status,
          body: decision.ok
            ? { ok: true, company: decision.company, isSetUp: decision.isSetUp }
            : { error: decision.reason },
          reason: decision.ok ? 'allowed' : decision.reason,
          rotatedCookie: loaded.rotated ? loaded.cookie : null,
          rotatedCsrfToken: loaded.rotated ? loaded.csrfToken : null,
        };
      });
    } catch (error) {
      edgeLog(requestId, route, 'error', error instanceof Error ? error.message : 'unknown');
      outcome = { status: 503, body: { error: 'unavailable' }, reason: 'unavailable' };
    }
    edgeLog(requestId, route, outcome.status, outcome.reason);
    const headers = {};
    if (outcome.rotatedCookie) headers['Set-Cookie'] = outcome.rotatedCookie;
    const body = outcome.body;
    if (outcome.rotatedCsrfToken) body.csrfToken = outcome.rotatedCsrfToken;
    return { status: outcome.status, headers, body };
  }

  async function handleEmployees({ cookieHeader, csrfToken, tenantId, action, employee, employeeId, ip, requestId: rawRequestId } = {}) {
    const requestId = requestIdFor(rawRequestId);
  const route = 'employees';
  if (
    (tenantId !== undefined &&
      tenantId !== null &&
      (typeof tenantId !== 'string' || !UUID_PATTERN.test(tenantId))) ||
    !EMPLOYEE_ACTIONS.includes(action)
  ) {
    return { status: 400, body: { error: 'invalid_request' } };
  }
    let outcome;
    try {
      outcome = await withTransaction(async ({ query }) => {
        const store = sessionStoreFactory({ query });
        const layer = sessionLayerFactory({ store });
        // Same RLS note as readReport: set the presented session id BEFORE
        // load(), or the sessions-table RLS policy hides the row.
        const presentedSessionId = layer.parseSessionId(cookieHeader);
        if (presentedSessionId) {
          await setRlsIdentity({ query, sessionId: presentedSessionId });
        }
        const loaded = await layer.load(cookieHeader);
        if (!loaded || loaded.ok !== true) {
          const reason = loaded && typeof loaded.reason === 'string' ? loaded.reason : 'no_session';
          if (reason === 'session_lookup_failed') {
            return { status: 503, body: { error: 'unavailable' }, reason };
          }
          return { status: 401, body: { error: 'invalid_session' }, reason };
        }
        const session = loaded.session;
        // CSRF: verify against the PRESENTED id first (rotation grace window),
        // then the current session id. Both ids are authenticated by load().
        const presentedId = layer.parseSessionId(cookieHeader);
        const csrfOk =
          (typeof presentedId === 'string' && layer.verifyCsrf(presentedId, csrfToken) === true) ||
          layer.verifyCsrf(session.sessionId, csrfToken) === true;
        if (csrfOk !== true) {
          return { status: 403, body: { error: 'forbidden' }, reason: 'csrf_failed' };
        }
        // Identity, in the step-7 order: auth-only first (the mapping path),
        // then subject + auth + session for the employee list, create, update or deactivate.
        await setRlsIdentity({ query, authUserId: session.authUserId });
        const mapping = mappingFactory({ query });
        const subjectId = await mapping.resolveInternalUserId(session.authUserId);
        if (typeof subjectId !== 'string' || !subjectId) {
          return { status: 401, body: { error: 'invalid_session' }, reason: 'subject_not_found' };
        }
        await setRlsIdentity({ query, subjectId, authUserId: session.authUserId, sessionId: session.sessionId });
        const tenancy = tenancyFactory({ query });
        const lookup = reportSessionLookupFactory({ store });
        let verifiedUser;
        const getVerifiedUser = async () => {
          if (verifiedUser === undefined) verifiedUser = await fetchAdminUser(session.authUserId);
          return verifiedUser;
        };
        const handler = employeesHandlerFactory({
          getVerifiedUser,
          requireAal2: async () => session.aal2 === true,
          resolveSubjectId: (authUserId) => mapping.resolveInternalUserId(authUserId),
          recordAudit: (args) => tenancy.recordAccessAudit(args),
          checkRateLimit: (args) => authLimits.checkRateLimit(args),
          getSession: (id) => lookup.getSession(id),
          generateId: () => requestId,
          now: () => now(),
    loadMemberships: (subjectId) =>
        createEmployeeLoader({ query, sealSsn: sealEmployeeSsn }).loadMemberships(subjectId),
      listEmployees: (args) =>
        createEmployeeLoader({ query, sealSsn: sealEmployeeSsn }).listEmployees(args),
      createEmployee: (args) =>
        createEmployeeLoader({ query, sealSsn: sealEmployeeSsn }).createEmployee(args),
      updateEmployee: (args) =>
        createEmployeeLoader({ query, sealSsn: sealEmployeeSsn }).updateEmployee(args),
      deactivateEmployee: (args) =>
        createEmployeeLoader({ query, sealSsn: sealEmployeeSsn }).deactivateEmployee(args),
        });
        const decision = await handler.handleEmployeeAccess({
          accessToken: session.sessionId,
          sessionId: session.sessionId,
          tenantId: tenantId ?? null,
      action,
      employee,
      employeeId: employeeId ?? null,
          requestId,
          clientIp: validIp(ip) ? ip : undefined,
        });
        const body = decision.ok ? { ok: true } : { error: decision.reason };

        if (decision.ok && decision.employees !== undefined) body.employees = decision.employees;

        if (decision.ok && decision.employee !== undefined) body.employee = decision.employee;

        return {

          status: decision.status,

          body,
          reason: decision.ok ? 'allowed' : decision.reason,
          rotatedCookie: loaded.rotated ? loaded.cookie : null,
          rotatedCsrfToken: loaded.rotated ? loaded.csrfToken : null,
        };
      });
    } catch (error) {
      edgeLog(requestId, route, 'error', error instanceof Error ? error.message : 'unknown');
      outcome = { status: 503, body: { error: 'unavailable' }, reason: 'unavailable' };
    }
    edgeLog(requestId, route, outcome.status, outcome.reason);
    const headers = {};
    if (outcome.rotatedCookie) headers['Set-Cookie'] = outcome.rotatedCookie;
    const body = outcome.body;
    if (outcome.rotatedCsrfToken) body.csrfToken = outcome.rotatedCsrfToken;
    return { status: outcome.status, headers, body };
  }

  async function handlePayRuns({ cookieHeader, csrfToken, tenantId, action, payRunId, payRun, ip, requestId: rawRequestId } = {}) {
    const requestId = requestIdFor(rawRequestId);
    const route = 'pay-runs';
    if (
      (tenantId !== undefined && tenantId !== null && (typeof tenantId !== 'string' || !UUID_PATTERN.test(tenantId))) ||
      !PAY_RUN_ACTIONS.includes(action) ||
      (payRunId !== undefined && payRunId !== null && (typeof payRunId !== 'string' || !UUID_PATTERN.test(payRunId)))
    ) {
      return { status: 400, body: { error: 'invalid_request' } };
    }
    let outcome;
    try {
      outcome = await withTransaction(async ({ query }) => {
        const store = sessionStoreFactory({ query });
        const layer = sessionLayerFactory({ store });
        const presentedSessionId = layer.parseSessionId(cookieHeader);
        if (presentedSessionId) await setRlsIdentity({ query, sessionId: presentedSessionId });
        const loaded = await layer.load(cookieHeader);
        if (!loaded || loaded.ok !== true) {
          const reason = loaded && typeof loaded.reason === 'string' ? loaded.reason : 'no_session';
          if (reason === 'session_lookup_failed') return { status: 503, body: { error: 'unavailable' }, reason };
          return { status: 401, body: { error: 'invalid_session' }, reason };
        }
        const session = loaded.session;
        const presentedId = layer.parseSessionId(cookieHeader);
        const csrfOk =
          (typeof presentedId === 'string' && layer.verifyCsrf(presentedId, csrfToken) === true) ||
          layer.verifyCsrf(session.sessionId, csrfToken) === true;
        if (!csrfOk) return { status: 403, body: { error: 'forbidden' }, reason: 'csrf_failed' };
        await setRlsIdentity({ query, authUserId: session.authUserId });
        const mapping = mappingFactory({ query });
        const subjectId = await mapping.resolveInternalUserId(session.authUserId);
        if (typeof subjectId !== 'string' || !subjectId) return { status: 401, body: { error: 'invalid_session' }, reason: 'subject_not_found' };
        await setRlsIdentity({ query, subjectId, authUserId: session.authUserId, sessionId: session.sessionId });
        const tenancy = tenancyFactory({ query });
        const lookup = reportSessionLookupFactory({ store });
        let verifiedUser;
        const getVerifiedUser = async () => {
          if (verifiedUser === undefined) verifiedUser = await fetchAdminUser(session.authUserId);
          return verifiedUser;
        };
        const loader = createPayRunLoader({ query, generateId });
        const handler = payRunsHandlerFactory({
          getVerifiedUser,
          requireAal2: async () => session.aal2 === true,
          resolveSubjectId: (authUserId) => mapping.resolveInternalUserId(authUserId),
          recordAudit: (args) => tenancy.recordAccessAudit(args),
          checkRateLimit: (args) => authLimits.checkRateLimit(args),
          getSession: (id) => lookup.getSession(id),
          generateId: () => requestId,
          loadMemberships: (subject) => loader.loadMemberships(subject),
          previewPayRun: (args) => loader.previewPayRun(args),
          createPayRun: (args) => loader.createPayRun(args),
          listPayRuns: (selectedTenantId) => loader.listPayRuns(selectedTenantId),
          getPayRun: (selectedTenantId, id) => loader.getPayRun(selectedTenantId, id),
          loadPayRunLines: (selectedTenantId, id) => loader.loadPayRunLines(selectedTenantId, id),
          deletePayRun: (args) => loader.deletePayRun(args),
          finalizePayRun: (args) => loader.finalizePayRun(args),
        });
        const decision = await handler.handlePayRunAccess({
          accessToken: session.sessionId,
          sessionId: session.sessionId,
          tenantId: tenantId ?? null,
          action,
          payRunId: payRunId ?? null,
          payRun,
          requestId,
          clientIp: validIp(ip) ? ip : undefined,
        });
        const body = decision.ok ? { ok: true } : { error: decision.reason };
        if (decision.ok && decision.payRun !== undefined) body.payRun = decision.payRun;
        if (decision.ok && decision.payRuns !== undefined) body.payRuns = decision.payRuns;
        if (decision.ok && decision.preview !== undefined) body.preview = decision.preview;
        return {
          status: decision.status,
          body,
          reason: decision.ok ? 'allowed' : decision.reason,
          rotatedCookie: loaded.rotated ? loaded.cookie : null,
          rotatedCsrfToken: loaded.rotated ? loaded.csrfToken : null,
        };
      });
    } catch (error) {
      edgeLog(requestId, route, 'error', error instanceof Error ? error.message : 'unknown');
      outcome = { status: 503, body: { error: 'unavailable' }, reason: 'unavailable' };
    }
    edgeLog(requestId, route, outcome.status, outcome.reason);
    const headers = {};
    if (outcome.rotatedCookie) headers['Set-Cookie'] = outcome.rotatedCookie;
    const body = outcome.body;
    if (outcome.rotatedCsrfToken) body.csrfToken = outcome.rotatedCsrfToken;
    return { status: outcome.status, headers, body };
  }

  async function deactivateMembershipAndRevokeSessions({ tenantId, subjectId, actorSubjectId } = {}) {
    if (
      typeof tenantId !== 'string' ||
      !UUID_PATTERN.test(tenantId) ||
      typeof subjectId !== 'string' ||
      !SUBJECT_PATTERN.test(subjectId) ||
      typeof actorSubjectId !== 'string' ||
      !SUBJECT_PATTERN.test(actorSubjectId)
    ) {
      throw new TypeError('tenant_id_subject_id_and_actor_subject_id_required');
    }
    const result = await withTransaction(async ({ query }) => {
      const tenancy = tenancyFactory({ query });
      const store = sessionStoreFactory({ query });
      const layer = sessionLayerFactory({ store });
      await setRlsIdentity({ query, subjectId: actorSubjectId });
      const deactivated = await tenancy.deactivateMembership({ tenantId, subjectId });
      if (!deactivated || deactivated.ok !== true) {
        return { deactivated, sessionsRevoked: false };
      }
      if (deactivated.deactivated !== true) {
        return { deactivated: { ...deactivated, ok: false, deactivated: false }, sessionsRevoked: false };
      }
      const authUserId =
        deactivated.membership?.auth_user_id ?? deactivated.membership?.authUserId;
      if (typeof authUserId !== 'string' || !UUID_PATTERN.test(authUserId)) {
        throw new TypeError('deactivated_membership_auth_user_id_required');
      }
      await setRlsIdentity({ query, subjectId, authUserId });
      const revokeResult = await layer.revokeAllForUser(subjectId);
      return { deactivated, sessionsRevoked: revokeResult };
    });
    if (result.deactivated && result.deactivated.ok !== true) {
      if (result.deactivated.deactivated === false) {
        return { ok: false, reason: 'deactivate_noop', deactivated: false, sessionsRevoked: false };
      }
      return { ok: false, reason: 'deactivate_failed', deactivated: false, sessionsRevoked: false };
    }
    const revokeOk =
      result.sessionsRevoked === true ||
      (result.sessionsRevoked &&
        result.sessionsRevoked.ok === true &&
        Number.isSafeInteger(result.sessionsRevoked.revoked) &&
        result.sessionsRevoked.revoked > 0);
    if (!revokeOk) {
      return { ok: false, reason: 'sessions_not_revoked', deactivated: true, sessionsRevoked: false };
    }
    return { ok: true, deactivated: true, sessionsRevoked: true };
  }

  return Object.freeze({
    login,
    logout,
    mfaEnroll,
    mfaVerify,
    requestRecovery,
    readReport,
    getDashboard,
    handleCompany,
    handleEmployees,
    handlePayRuns,
    deactivateMembershipAndRevokeSessions,
  });
}
