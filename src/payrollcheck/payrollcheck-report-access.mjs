// Authenticated report-access handler for PayrollCheck 360 (M2 step 8).
//
// The backend API logic core for the endpoint contract
// (docs/payrollcheck-authenticated-endpoint-contract.md). It answers one
// question — "may this caller read this report?" — by composing the
// step 2-7 pieces: token verification, subject mapping, MFA, server
// sessions, rate limits, tenancy/consent, and the step-7 RLS policies.
//
// TRUST MODEL. The only trust anchors are (a) the access token,
// re-verified server-side on every request, and (b) the database, read
// through the least-privilege payrollcheck_app connection with RLS
// enforced. The handler takes NO caller object and NO tenant/role
// input: it derives the user (getVerifiedUser), the subject
// (resolveSubjectId, step 3), and the authorization facts (memberships
// + grants, loaded from the DB) itself. RLS is the primary gate on the
// report load; authorizeTenantSession (the step-5 seam,
// authorizeSupabaseTenantSession) is the secondary policy check, run
// per candidate tenant; the grant-scope match is the pure helper
// findAuthorizingGrant.
//
// CALLER CONTRACT (step-9 handlers):
//   - `query` runs on ONE connection inside a transaction with RLS
//     identity already set (step-7 §8: BEGIN + setRlsIdentity). The
//     transaction MUST be READ COMMITTED (the Postgres default): the
//     consent recheck immediately before release only observes a
//     concurrent revocation under READ COMMITTED. Never use REPEATABLE
//     READ or SERIALIZABLE for report reads.
//   - Loads run sequentially, never Promise.all: the injected query is
//     one pooled connection.
//   - Never release the report body unless the result has status 200.
//
// DENIALS. Authorization denials are always generic 404 `not_found`
// to the client, so an attacker cannot probe whether a report exists,
// which tenant owns it, or why access was refused. Identity denials
// (401/403) reveal only the caller's own state. See m2-step8-design.md
// §4 for the full mapping table.
//
// AUDIT. One access_audit row per decision for a known subject, allow
// AND deny, via the injected recordAudit (step-6 recordAccessAudit).
// An audit-write failure FAILS CLOSED: 503 `unavailable`, nothing
// released — the audit trail is the accountability control for
// payroll-data access and must be loud when it is down, not silent.
// Decisions that fail before a subject is known (bad input, rate
// limit, unverified token, unmapped user) have no attributable actor
// and are not written to access_audit; the step-9 handler logs those
// at the edge (request id + decision class only).
//
// Nothing is logged here. No tokens, no payroll amounts, no report
// content ever leaves in an error or a denial reason.
import { randomUUID } from 'node:crypto';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SUBJECT_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const ACTIONS = ['view_report', 'review_finding'];
const MAX_REQUEST_ID_LENGTH = 128;
const MAX_TOKEN_LENGTH = 16384;
const MAX_CLIENT_IP_LENGTH = 256;
const DEFAULT_IDLE_TIMEOUT_SECONDS = 30 * 60;
const RATE_LIMIT_KEY_PREFIX = 'report:ip:';

function isUuid(value) {
  return typeof value === 'string' && UUID_PATTERN.test(value);
}

function isSubjectId(value) {
  return typeof value === 'string' && SUBJECT_PATTERN.test(value);
}

function deny(status, reason, extra = {}) {
  return Object.freeze({ ok: false, status, reason, ...extra });
}

// Pure grant-scope match, exported for tests and for future endpoints
// (exports, finding review) that need the same decision.
// `grants` are active-grant rows for the business; returns the first
// grant that authorizes `action` for (firmTenantId, businessTenantId),
// or null. Pending/revoked rows, wrong-firm, wrong-business, and
// out-of-scope rows never authorize.
export function findAuthorizingGrant({ grants, firmTenantId, businessTenantId, action } = {}) {
  if (!Array.isArray(grants)) return null;
  if (!isUuid(firmTenantId) || !isUuid(businessTenantId)) return null;
  if (typeof action !== 'string' || !ACTIONS.includes(action)) return null;
  for (const grant of grants) {
    if (!grant || grant.status !== 'active') continue;
    if (grant.firm_tenant_id !== firmTenantId) continue;
    if (grant.business_tenant_id !== businessTenantId) continue;
    if (!Array.isArray(grant.scopes) || !grant.scopes.includes(action)) continue;
    return grant;
  }
  return null;
}

export function createReportAccessHandler({
  query,
  getVerifiedUser,
  requireAal2,
  resolveSubjectId,
  authorizeTenantSession,
  recordAudit,
  checkRateLimit,
  getSession,
  generateId = () => randomUUID(),
  now = () => Math.floor(Date.now() / 1000),
  idleTimeoutSeconds = DEFAULT_IDLE_TIMEOUT_SECONDS,
} = {}) {
  if (typeof query !== 'function') throw new TypeError('query_required');
  if (typeof getVerifiedUser !== 'function') throw new TypeError('get_verified_user_required');
  if (typeof requireAal2 !== 'function') throw new TypeError('require_aal2_required');
  if (typeof resolveSubjectId !== 'function') throw new TypeError('resolve_subject_id_required');
  if (typeof authorizeTenantSession !== 'function') {
    throw new TypeError('authorize_tenant_session_required');
  }
  if (typeof recordAudit !== 'function') throw new TypeError('record_audit_required');
  if (checkRateLimit !== undefined && typeof checkRateLimit !== 'function') {
    throw new TypeError('check_rate_limit_must_be_a_function');
  }
  if (getSession !== undefined && typeof getSession !== 'function') {
    throw new TypeError('get_session_must_be_a_function');
  }
  if (typeof generateId !== 'function') throw new TypeError('generate_id_required');
  if (typeof now !== 'function') throw new TypeError('now_required');
  if (!Number.isSafeInteger(idleTimeoutSeconds) || idleTimeoutSeconds < 0) {
    throw new TypeError('idle_timeout_seconds_must_be_a_non_negative_integer');
  }

  async function handleReportAccess({
    accessToken,
    sessionId,
    reportId,
    action,
    requestId,
    clientIp,
  } = {}) {
    // 0. Validate input before any query. No audit row: no subject yet.
    // The request id is settled first so every result carries it.
    let effectiveRequestId = requestId;
    if (effectiveRequestId === undefined) effectiveRequestId = generateId();
    if (
      typeof effectiveRequestId !== 'string' ||
      effectiveRequestId.length === 0 ||
      effectiveRequestId.length > MAX_REQUEST_ID_LENGTH
    ) {
      return deny(400, 'invalid_request');
    }
    if (typeof action !== 'string' || !ACTIONS.includes(action)) {
      return deny(400, 'invalid_request', { requestId: effectiveRequestId });
    }
    if (!isUuid(reportId)) {
      return deny(400, 'invalid_request', { requestId: effectiveRequestId });
    }
    if (
      typeof accessToken !== 'string' ||
      accessToken.length === 0 ||
      accessToken.length > MAX_TOKEN_LENGTH
    ) {
      return deny(401, 'unauthorized', { requestId: effectiveRequestId });
    }

    // 1. Rate limit (abuse friction, not identity). A limiter that
    // throws is treated as degraded-allow, per the step-4c precedent:
    // a rate-limit store outage must not lock users out.
    if (
      typeof checkRateLimit === 'function' &&
      typeof clientIp === 'string' &&
      clientIp.length > 0 &&
      clientIp.length <= MAX_CLIENT_IP_LENGTH
    ) {
      let rate;
      try {
        rate = await checkRateLimit({ key: `${RATE_LIMIT_KEY_PREFIX}${clientIp}` });
      } catch {
        rate = null;
      }
      if (rate && rate.allowed === false) {
        return deny(429, 'rate_limited', {
          requestId: effectiveRequestId,
          retryAfterMs: typeof rate.resetMs === 'number' ? rate.resetMs : null,
        });
      }
    }

    // 2. Verify the token server-side. Throws, or an unconfirmed /
    // anonymous / malformed user, is an authentication failure.
    let user;
    try {
      user = await getVerifiedUser(accessToken);
    } catch {
      return deny(401, 'unauthorized', { requestId: effectiveRequestId });
    }
    if (
      !user ||
      !isUuid(user.id) ||
      !user.email_confirmed_at ||
      user.is_anonymous === true
    ) {
      return deny(401, 'unauthorized', { requestId: effectiveRequestId });
    }

    // 3. Map the Auth UUID to the internal subject (step 3). Null means
    // no active membership or inconsistent data — a generic 404, so a
    // caller cannot probe whether the Auth user exists.
    let subjectId;
    try {
      subjectId = await resolveSubjectId(user.id);
    } catch {
      subjectId = null;
    }
    if (!isSubjectId(subjectId)) {
      return deny(404, 'not_found', { requestId: effectiveRequestId });
    }

    // From here the subject is known, so every decision is audited.
    // An audit-write failure fails closed (503) — see the module header.
    async function audit(allowed, reason, reportIdForAudit) {
      await recordAudit({
        requestId: effectiveRequestId,
        actorSubjectId: subjectId,
        reportId: reportIdForAudit === undefined ? reportId : reportIdForAudit,
        action,
        allowed,
        reason,
      });
    }
    async function denyAudited(status, clientReason, auditReason) {
      try {
        await audit(false, auditReason);
      } catch {
        return deny(503, 'unavailable', { requestId: effectiveRequestId });
      }
      return deny(status, clientReason, { requestId: effectiveRequestId });
    }

    // 4. MFA: aal2 is required for all report access (step-5 boundary).
    let aal2;
    try {
      aal2 = await requireAal2(accessToken, user.id);
    } catch {
      aal2 = false;
    }
    if (aal2 !== true) {
      return denyAudited(403, 'mfa_required', 'mfa_required');
    }

    // 5. Session re-check, only when a server session id was presented.
    // The token may verify while the server session is revoked (logout /
    // revoke-all) — the session record is the authority here.
    if (sessionId !== undefined && sessionId !== null) {
      if (typeof getSession !== 'function') {
        // A presented session that cannot be checked must not be bypassed.
        return deny(503, 'unavailable', { requestId: effectiveRequestId });
      }
      if (!isSubjectId(sessionId)) {
        return denyAudited(401, 'unknown_session', 'unknown_session');
      }
      let record;
      try {
        record = await getSession(sessionId);
      } catch {
        return denyAudited(401, 'session_lookup_failed', 'session_lookup_failed');
      }
      const nowSeconds = now();
      const matchesCurrent = Boolean(record) && record.sessionId === sessionId;
      const matchesGrace =
        Boolean(record) &&
        record.previousSessionId === sessionId &&
        record.graceUntil !== null &&
        record.graceUntil !== undefined &&
        nowSeconds < record.graceUntil;
      if (!record || (!matchesCurrent && !matchesGrace)) {
        return denyAudited(401, 'unknown_session', 'unknown_session');
      }
      if (record.revoked === true) {
        return denyAudited(401, 'session_revoked', 'session_revoked');
      }
      if (typeof record.expiresAt === 'number' && nowSeconds >= record.expiresAt) {
        return denyAudited(401, 'session_expired', 'session_expired');
      }
      if (
        typeof record.lastSeenAt === 'number' &&
        nowSeconds - record.lastSeenAt > idleTimeoutSeconds
      ) {
        return denyAudited(401, 'session_idle_timeout', 'session_idle_timeout');
      }
      if (record.authUserId !== user.id || record.userId !== subjectId) {
        return denyAudited(401, 'session_mismatch', 'session_mismatch');
      }
    }

    // 6. Load the report. RLS is the primary gate: zero rows means
    // missing OR unauthorized, never distinguished.
    let report;
    try {
      const result = await query(
        'SELECT report_id, business_tenant_id, client_id, status, created_at FROM payrollcheck.reports WHERE report_id = $1::uuid',
        [reportId],
      );
      const rows = result && Array.isArray(result.rows) ? result.rows : null;
      if (!rows || rows.length !== 1) {
        return denyAudited(404, 'not_found', 'report_not_found_or_denied');
      }
      report = rows[0];
    } catch {
      return deny(503, 'unavailable', { requestId: effectiveRequestId });
    }
    if (!report || !isUuid(report.business_tenant_id)) {
      return denyAudited(503, 'unavailable', 'invalid_record');
    }
    const businessTenantId = report.business_tenant_id;

    // 7. Load the caller's active memberships (with tenant types) and
    // the business's active grants, in the same transaction.
    let memberships;
    let grants;
    try {
      const membershipResult = await query(
        'SELECT m.tenant_id, m.role, t.tenant_type FROM payrollcheck.memberships m JOIN payrollcheck.tenants t ON t.tenant_id = m.tenant_id WHERE m.subject_id = $1 AND m.active = true',
        [subjectId],
      );
      const grantResult = await query(
        "SELECT grant_id, firm_tenant_id, business_tenant_id, scopes, status FROM payrollcheck.client_grants WHERE business_tenant_id = $1::uuid AND status = 'active' ORDER BY approved_at ASC",
        [businessTenantId],
      );
      memberships =
        membershipResult && Array.isArray(membershipResult.rows)
          ? membershipResult.rows
          : null;
      grants =
        grantResult && Array.isArray(grantResult.rows) ? grantResult.rows : null;
      if (!memberships || !grants) throw new Error('load_failed');
    } catch {
      return deny(503, 'unavailable', { requestId: effectiveRequestId });
    }

    // 8. Secondary policy check: authorizeSupabaseTenantSession per
    // candidate tenant, plus the grant-scope match. The authorize call
    // re-verifies the token and the MFA assurance from the database,
    // so a spoofed caller object cannot authorize anything on its own.
    async function authorizeTenant(tenantId) {
      try {
        return await authorizeTenantSession({
          accessToken,
          tenantId,
          getVerifiedUser,
          requireAal2,
          query,
        });
      } catch {
        return { ok: false, reason: 'authorization_failed' };
      }
    }

    let decision = null;
    // Business path: active business_owner of the owning tenant.
    const businessAuth = await authorizeTenant(businessTenantId);
    if (businessAuth && businessAuth.reason === 'mfa_required') {
      return denyAudited(403, 'mfa_required', 'mfa_required');
    }
    if (businessAuth && businessAuth.reason === 'unverified_user') {
      return denyAudited(401, 'unauthorized', 'unverified_user');
    }
    if (
      businessAuth &&
      businessAuth.ok === true &&
      businessAuth.principal &&
      businessAuth.principal.role === 'business_owner'
    ) {
      decision = { path: 'business' };
    }

    // Firm path: active admin/reviewer of a firm tenant + an active
    // grant carrying the requested action's scope for this business.
    if (!decision) {
      const firmTenantIds = [];
      for (const m of memberships) {
        if (
          m &&
          (m.role === 'accounting_admin' || m.role === 'accounting_reviewer') &&
          m.tenant_type === 'accounting_firm' &&
          isUuid(m.tenant_id)
        ) {
          firmTenantIds.push(m.tenant_id);
        }
      }
      for (const firmTenantId of firmTenantIds) {
        const firmAuth = await authorizeTenant(firmTenantId);
        if (firmAuth && firmAuth.reason === 'mfa_required') {
          return denyAudited(403, 'mfa_required', 'mfa_required');
        }
        if (firmAuth && firmAuth.reason === 'unverified_user') {
          return denyAudited(401, 'unauthorized', 'unverified_user');
        }
        if (!firmAuth || firmAuth.ok !== true) continue;
        const grant = findAuthorizingGrant({
          grants,
          firmTenantId,
          businessTenantId,
          action,
        });
        if (grant) {
          decision = { path: 'firm', firmTenantId, grantId: grant.grant_id };
          break;
        }
      }
    }

    if (!decision) {
      const sawGrantForPair = grants.some(
        (g) =>
          g &&
          g.status === 'active' &&
          memberships.some((m) => m && m.tenant_id === g.firm_tenant_id),
      );
      const auditReason =
        memberships.length === 0
          ? 'membership_denied'
          : sawGrantForPair
            ? 'scope_denied'
            : 'grant_denied';
      return denyAudited(404, 'not_found', auditReason);
    }

    // 9. Consent recheck immediately before release: fresh SELECTs in
    // the same READ COMMITTED transaction, so a concurrent revocation
    // is visible here. A stale decision never releases data.
    // Staging-only test hook (PAYROLLCHECK_TEST_DELAY_MS): pause here, between the
  // report load and the consent recheck, so a concurrent revoke can land mid-flight
  // (M2 live acceptance item (g)). Unset or 0: no delay, no extra query, no log line.
  const testDelayMs = Math.min(
    Math.max(Number.parseInt(process.env.PAYROLLCHECK_TEST_DELAY_MS, 10) || 0, 0),
    30000,
  );
  if (testDelayMs > 0) {
    await new Promise((resolve) => setTimeout(resolve, testDelayMs));
  }

  let recheckOk = false;
    try {
      if (decision.path === 'business') {
        const recheck = await query(
          "SELECT 1 AS one FROM payrollcheck.memberships WHERE tenant_id = $1::uuid AND subject_id = $2 AND role = 'business_owner' AND active = true LIMIT 1",
          [businessTenantId, subjectId],
        );
        recheckOk = Array.isArray(recheck.rows) && recheck.rows.length === 1;
      } else {
        const grantRecheck = await query(
          'SELECT grant_id, firm_tenant_id, business_tenant_id, scopes, status FROM payrollcheck.client_grants WHERE grant_id = $1::uuid',
          [decision.grantId],
        );
        const grantRow =
          grantRecheck && Array.isArray(grantRecheck.rows) && grantRecheck.rows.length === 1
            ? grantRecheck.rows[0]
            : null;
        const grantStillAuthorizes =
          Boolean(grantRow) &&
          grantRow.status === 'active' &&
          grantRow.firm_tenant_id === decision.firmTenantId &&
          grantRow.business_tenant_id === businessTenantId &&
          Array.isArray(grantRow.scopes) &&
          grantRow.scopes.includes(action);
        const membershipRecheck = await query(
          "SELECT 1 AS one FROM payrollcheck.memberships WHERE tenant_id = $1::uuid AND subject_id = $2 AND role IN ('accounting_admin', 'accounting_reviewer') AND active = true LIMIT 1",
          [decision.firmTenantId, subjectId],
        );
        const membershipStillActive =
          Array.isArray(membershipRecheck.rows) && membershipRecheck.rows.length === 1;
        recheckOk = grantStillAuthorizes && membershipStillActive;
      }
    } catch {
      return deny(503, 'unavailable', { requestId: effectiveRequestId });
    }
    if (!recheckOk) {
      return denyAudited(404, 'not_found', 'consent_revoked');
    }

    // 10. Audit the allow, then release. An audit-write failure fails
    // closed: 503, no data.
    try {
      await audit(true, 'allowed');
    } catch {
      return deny(503, 'unavailable', { requestId: effectiveRequestId });
    }
    return Object.freeze({
      ok: true,
      status: 200,
      report: Object.freeze({ ...report }),
      path: decision.path,
      requestId: effectiveRequestId,
    });
  }

  return Object.freeze({ handleReportAccess });
}
