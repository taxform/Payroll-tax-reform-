// Company profile access (Slice 2).
// Mirrors payrollcheck-dashboard-access.mjs: rate limit, server-side verified
// user, Auth-UUID-to-subject mapping, AAL2, membership check, one audit row
// per access decision. A cross-tenant request is a generic not_found,
// audited. Company profiles are business-owner-only, matching the RLS
// policies in docs/sql/payrollcheck-rls-policies.sql: a firm reviewer with a
// view_report grant on a business never sees that business's company profile.
// The EIN is never returned in full (see payrollcheck-company.mjs).
import { parseCompanyInput, parseCompanyRequest, toCompanyResponse, normalizeEin } from './payrollcheck-company.mjs';
import { resolveDashboardTenant } from './payrollcheck-dashboard.mjs';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RATE_LIMIT_KEY_PREFIX = 'company:';

export function createCompanyAccessHandler({
  getVerifiedUser,
  requireAal2,
  resolveSubjectId,
  recordAudit,
  checkRateLimit,
  getSession,
  generateId,
  now,
  loadCompanyProfile,
  saveCompany,
} = {}) {
  const required = { getVerifiedUser, requireAal2, resolveSubjectId, recordAudit, checkRateLimit, getSession, generateId, now, loadCompanyProfile, saveCompany };
  for (const [name, fn] of Object.entries(required)) {
    if (typeof fn !== 'function') throw new TypeError(`${name} is required`);
  }

  async function handleCompanyAccess({ accessToken, sessionId, tenantId, action, company, requestId, clientIp }) {
    const effectiveRequestId = typeof requestId === 'string' && requestId ? requestId : generateId();
    const auditAction = action === 'write' ? 'company_write' : 'company_read';

    async function deny(status, reason, { requestId: denyRequestId, clientIp: denyClientIp, subjectId, tenantId: denyTenantId }) {
      if (subjectId) {
        await recordAudit({
          requestId: denyRequestId,
          actorSubjectId: subjectId,
          reportId: null,
          action: auditAction,
          allowed: false,
          reason,
        });
      }
      return { status, ok: false, reason, requestId: denyRequestId, clientIp: denyClientIp, tenantId: denyTenantId };
    }

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

    // 2. Server-side verified user.
    if (typeof accessToken !== 'string' || !UUID_PATTERN.test(accessToken)) {
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

    // 3. Auth UUID to subject id.
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

    // 4. MFA (AAL2). No audit row: no authorization decision was made.
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
        clientIp,
        tenantId: null,
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
      session.revokedAt !== true;
    if (!sessionLive) {
      return deny(401, 'invalid_session', {
        requestId: effectiveRequestId,
        clientIp,
        subjectId,
        tenantId: tenantId ?? null,
      });
    }

    // 6. Company rows through the RLS-bound loader, then tenant selection.
    // The requested tenant id is only a selection among the caller's own
    // memberships; anything else is 'not_found'.
    let profile;
    try {
      profile = await loadCompanyProfile({ subjectId });
    } catch {
      return {
        status: 503,
        ok: false,
        reason: 'unavailable',
        requestId: effectiveRequestId,
      };
    }
    const parsed = parseCompanyRequest({ tenantId, action });
    if (!parsed.ok) {
      return deny(400, 'invalid_request', {
        requestId: effectiveRequestId,
        clientIp,
        subjectId,
        tenantId: tenantId ?? null,
      });
    }
    const resolved = resolveDashboardTenant({
      memberships: profile.memberships,
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
    const selectedTenantId = resolved.tenant.tenantId;
    if (resolved.tenant.role !== 'business_owner') {
      return deny(404, 'not_found', {
        requestId: effectiveRequestId,
        clientIp,
        subjectId,
        tenantId: selectedTenantId,
      });
    }
    const existing = profile.companiesByTenant[selectedTenantId] ?? null;

    if (parsed.action === 'read') {
      await recordAudit({
        requestId: effectiveRequestId,
        actorSubjectId: subjectId,
        reportId: null,
        action: 'company_read',
        allowed: true,
        reason: 'allowed',
      });
      return {
        status: 200,
        ok: true,
        reason: 'allowed',
        company: toCompanyResponse(existing),
        isSetUp: existing !== null,
        requestId: effectiveRequestId,
        clientIp,
        tenantId: selectedTenantId,
      };
    }

    // 7. Write: validate, keeping the stored EIN when none is supplied.
    const validated = parseCompanyInput(company, { einRequired: !existing });
    if (!validated.ok) {
      return deny(400, 'invalid_request', {
        requestId: effectiveRequestId,
        clientIp,
        subjectId,
        tenantId: selectedTenantId,
      });
    }
    const toSave = {
      ...validated.company,
      ein: validated.company.ein ?? normalizeEin(existing.ein),
    };
    let saved;
    try {
      saved = await saveCompany(selectedTenantId, toSave);
    } catch {
      return {
        status: 503,
        ok: false,
        reason: 'unavailable',
        requestId: effectiveRequestId,
      };
    }
    if (!saved) {
      return {
        status: 503,
        ok: false,
        reason: 'unavailable',
        requestId: effectiveRequestId,
      };
    }
    await recordAudit({
      requestId: effectiveRequestId,
      actorSubjectId: subjectId,
      reportId: null,
      action: 'company_write',
      allowed: true,
      reason: 'allowed',
    });
    return {
      status: 200,
      ok: true,
        reason: 'allowed',
      company: toCompanyResponse(saved),
      isSetUp: true,
      requestId: effectiveRequestId,
      clientIp,
      tenantId: selectedTenantId,
    };
  }

  return { handleCompanyAccess };
}
