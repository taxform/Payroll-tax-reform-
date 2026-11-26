// Dashboard access decision for the PayrollCheck 360 app shell (Slice 1).
//
// Mirrors payrollcheck-report-access.mjs, minus the report and the grant: the
// dashboard shows the caller's own tenants and their compliance-check report
// counts, so there is no report to load and no firm grant to match. The steps
// that stay are the ones that establish who the caller is and whether they may
// see a tenant at all:
//
//   1. Rate limit, degraded-allow: a limit-store failure never locks a caller
//      out, it only skips the limit for that request (same as the report path).
//  2. The presented credential is verified server-side on every request. The
//     credential is the server session id the composition passes as
//     `accessToken` (a 43-character base64url string, never a UUID); the
//     verified user must have a confirmed email (email_confirmed_at), must
//     not be an anonymous user.
//   3. The Auth UUID is mapped to the internal subject id. Nothing below this
//      step uses the Auth UUID.
//   4. MFA is required: the session must be AAL2 (requireAal2), otherwise the
//      caller is told `mfa_required` (403) and no audit row is written — the
//      request never reached an authorization decision.
//   5. The session is re-checked (it must exist, belong to the verified user,
//      and not be revoked or expired).
//   6. The dashboard rows are loaded through the RLS-bound query (memberships
//      for the subject, active only). That load is the primary gate: a tenant
//      the caller is not a member of never appears, and a requested tenant
//      outside the memberships is `not_found` — generic, it must not reveal
//      whether that tenant exists.
//   7. Exactly one audit row per decision, via recordAudit, with action
//      `dashboard_read` (added to AUDIT_ACTIONS in payrollcheck-tenancy.mjs).
//
// Denials are generic, as in the report path: `invalid_session` (401),
// `mfa_required` (403), `rate_limited` (429), `not_found` (404), `unavailable`
// (503). No internals leak into the error body.
import {
  buildDashboardSummary,
  parseDashboardRequest,
  resolveDashboardTenant,
} from './payrollcheck-dashboard.mjs';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Upper bound for a presented credential, mirroring
// payrollcheck-report-access.mjs. The token is never parsed as a UUID.
const MAX_TOKEN_LENGTH = 16384;
const RATE_LIMIT_KEY_PREFIX = 'dashboard:';

export function createDashboardAccessHandler({
  getVerifiedUser,
  requireAal2,
  resolveSubjectId,
  recordAudit,
  checkRateLimit,
  getSession,
  generateId,
  now,
  loadDashboard,
}) {
  const required = {
    getVerifiedUser,
    requireAal2,
    resolveSubjectId,
    recordAudit,
    checkRateLimit,
    getSession,
    generateId,
    now,
    loadDashboard,
  };
  for (const [name, fn] of Object.entries(required)) {
    if (typeof fn !== 'function') throw new TypeError(`${name} is required`);
  }

  async function deny(status, reason, { requestId, clientIp, subjectId, tenantId }) {
    if (subjectId) {
      await recordAudit({
        requestId,
        actorSubjectId: subjectId,
        reportId: null,
        action: 'dashboard_read',
        allowed: false,
        reason,
      });
    }
    return { status, ok: false, reason, requestId, clientIp, tenantId };
  }

  async function handleDashboardAccess({
    accessToken,
    sessionId,
    tenantId,
    requestId,
    clientIp,
  }) {
    const effectiveRequestId =
      typeof requestId === 'string' && requestId ? requestId : generateId();

    // 1. Rate limit, degraded-allow.
    let rate = null;
    try {
      rate = await checkRateLimit({
        key: `${RATE_LIMIT_KEY_PREFIX}${clientIp ?? 'unknown'}`,
      });
    } catch {
      rate = null;
    }
    if (rate && rate.allowed === false) {
      return deny(429, 'rate_limited', {
        requestId: effectiveRequestId,
        clientIp,
        subjectId: null,
        tenantId: tenantId ?? null,
      });
    }

  // 2. The presented credential is verified server-side. The credential is
  // the server session id the composition passes as `accessToken`, so only
  // its presence and length are checked here (same as the report handler).
  // The verified user must have a confirmed email address, must not be
  // anonymous.
    if (typeof accessToken !== 'string' || accessToken.length === 0 || accessToken.length > MAX_TOKEN_LENGTH) {
      return deny(401, 'invalid_session', {
        requestId: effectiveRequestId,
        clientIp,
        subjectId: null,
        tenantId: tenantId ?? null,
      });
    }
    let verified;
    try {
      verified = await getVerifiedUser(accessToken);
    } catch {
      return {
        status: 503,
        ok: false,
        reason: 'unavailable',
        requestId: effectiveRequestId,
      };
    }
    if (
      !verified ||
      typeof verified.id !== 'string' ||
      !verified.email_confirmed_at ||
      verified.is_anonymous === true
    ) {
      return deny(401, 'invalid_session', {
        requestId: effectiveRequestId,
        clientIp,
        subjectId: null,
        tenantId: tenantId ?? null,
      });
    }

    // 3. Auth UUID -> internal subject id.
    let subjectId;
    try {
      subjectId = await resolveSubjectId(verified.id);
    } catch {
      return {
        status: 503,
        ok: false,
        reason: 'unavailable',
        requestId: effectiveRequestId,
      };
    }
    if (typeof subjectId !== 'string' || !subjectId) {
      return deny(401, 'invalid_session', {
        requestId: effectiveRequestId,
        clientIp,
        subjectId: null,
        tenantId: tenantId ?? null,
      });
    }

    // 4. MFA (AAL2) required. No audit row: no authorization decision was made.
    let aal2 = false;
    try {
      aal2 = (await requireAal2()) === true;
    } catch {
      aal2 = false;
    }
    if (!aal2) {
      return {
        status: 403,
        ok: false,
        reason: 'mfa_required',
        requestId: effectiveRequestId,
      };
    }

    // 5. Session re-check: must exist, belong to the verified user, and be live.
    let session = null;
    try {
      session = await getSession(sessionId);
    } catch {
      session = null;
    }
    const sessionLive =
      session &&
      session.authUserId === verified.id &&
      session.revoked !== true &&
      session.revokedAt !== true &&
      session.revoked_at !== true;
    if (!sessionLive) {
      return deny(401, 'invalid_session', {
        requestId: effectiveRequestId,
        clientIp,
        subjectId,
        tenantId: tenantId ?? null,
      });
    }

    // 6. Dashboard rows through the RLS-bound loader, then tenant selection.
    // The requested tenant id is only a selection among the caller's own
    // memberships; anything else is `not_found`.
    let loaded;
    try {
      loaded = await loadDashboard({ subjectId });
    } catch {
      return {
        status: 503,
        ok: false,
        reason: 'unavailable',
        requestId: effectiveRequestId,
      };
    }
    const parsed = parseDashboardRequest({ tenantId });
    if (!parsed.ok) {
      return deny(400, 'invalid_request', {
        requestId: effectiveRequestId,
        clientIp,
        subjectId,
        tenantId: tenantId ?? null,
      });
    }
    const resolved = resolveDashboardTenant({
      memberships: loaded.memberships,
      requestedTenantId: parsed.tenantId,
    });
    if (!resolved.ok) {
      return deny(resolved.status, resolved.error, {
        requestId: effectiveRequestId,
        clientIp,
        subjectId,
        tenantId: tenantId ?? null,
      });
    }
    const dashboard = buildDashboardSummary({
      memberships: resolved.memberships,
      reportCountsByTenant: loaded.reportCountsByTenant,
      companiesByTenant: loaded.companiesByTenant,
      employeeCountsByTenant: loaded.employeeCountsByTenant,
      selectedTenantId: resolved.tenant.tenantId,
    });

    // 7. One audit row for the allowed decision.
    await recordAudit({
      requestId: effectiveRequestId,
      actorSubjectId: subjectId,
      reportId: null,
      action: 'dashboard_read',
      allowed: true,
      reason: 'allowed',
    });
    return {
      status: 200,
      ok: true,
      reason: 'allowed',
      dashboard,
      requestId: effectiveRequestId,
    };
  }

  return { handleDashboardAccess };
}
