import { parseTaxCenterRequest } from './payrollcheck-tax-center.mjs';
import { resolveDashboardTenant } from './payrollcheck-dashboard.mjs';

const MAX_TOKEN_LENGTH = 16384;
const RATE_LIMIT_KEY_PREFIX = 'tax-center:';

export function createTaxCenterAccessHandler({
  getVerifiedUser,
  requireAal2,
  resolveSubjectId,
  recordAudit,
  checkRateLimit,
  getSession,
  generateId,
  loadMemberships,
  loadTaxCenter,
} = {}) {
  const required = {
    getVerifiedUser,
    requireAal2,
    resolveSubjectId,
    recordAudit,
    checkRateLimit,
    getSession,
    generateId,
    loadMemberships,
    loadTaxCenter,
  };
  for (const [name, fn] of Object.entries(required)) {
    if (typeof fn !== 'function') throw new TypeError(`${name} is required`);
  }

  async function handleTaxCenterAccess({ accessToken, sessionId, tenantId, action, requestId, clientIp }) {
    const effectiveRequestId = typeof requestId === 'string' && requestId ? requestId : generateId();
    const auditAction = 'tax_center_read';

    async function deny(status, reason, subjectId, selectedTenantId) {
      if (subjectId) await recordAudit({
        requestId: effectiveRequestId,
        actorSubjectId: subjectId,
        reportId: null,
        action: auditAction,
        allowed: false,
        reason,
      });
      return { status, ok: false, reason, requestId: effectiveRequestId, clientIp, tenantId: selectedTenantId ?? tenantId ?? null };
    }
    const unavailable = (subjectId) => ({
      status: 503,
      ok: false,
      reason: 'unavailable',
      requestId: effectiveRequestId,
      clientIp,
      tenantId: subjectId ? tenantId ?? null : null,
    });

    let rate;
    try {
      rate = await checkRateLimit({ key: `${RATE_LIMIT_KEY_PREFIX}${clientIp ?? 'unknown'}` });
    } catch {
      rate = null;
    }
    if (rate?.allowed === false) return deny(429, 'rate_limited', null, tenantId ?? null);
    if (typeof accessToken !== 'string' || accessToken.length < 1 || accessToken.length > MAX_TOKEN_LENGTH) {
      return deny(401, 'invalid_session', null, tenantId ?? null);
    }
    let verified;
    try {
      verified = await getVerifiedUser(accessToken);
    } catch {
      return unavailable(null);
    }
    if (!verified?.id || !verified.email_confirmed_at) return deny(401, 'invalid_session', null, tenantId ?? null);
    let subjectId;
    try {
      subjectId = await resolveSubjectId(verified.id);
    } catch {
      return unavailable(null);
    }
    if (!subjectId) return deny(401, 'invalid_session', null, tenantId ?? null);
    let aal2;
    try {
      aal2 = (await requireAal2()) === true;
    } catch {
      aal2 = false;
    }
    if (!aal2) return { status: 403, ok: false, reason: 'mfa_required', requestId: effectiveRequestId, clientIp, tenantId: null };
    let session;
    try {
      session = await getSession(sessionId);
    } catch {
      return unavailable(subjectId);
    }
    if (!session || session.authUserId !== verified.id || session.revoked === true || session.revokedAt === true) {
      return deny(401, 'invalid_session', subjectId, tenantId ?? null);
    }
    let memberships;
    try {
      memberships = await loadMemberships(subjectId);
    } catch {
      return unavailable(subjectId);
    }

    const parsed = parseTaxCenterRequest({ tenantId, action });
    if (!parsed.ok) return deny(400, parsed.error, subjectId, tenantId ?? null);
    const resolved = resolveDashboardTenant({ memberships, requestedTenantId: parsed.tenantId });
    if (!resolved.ok) return deny(resolved.status, resolved.error, subjectId, tenantId ?? null);
    const selectedTenantId = resolved.tenant.tenantId;
    if (resolved.tenant.role !== 'business_owner') return deny(404, 'not_found', subjectId, selectedTenantId);

    async function allow(reason, payload) {
      await recordAudit({
        requestId: effectiveRequestId,
        actorSubjectId: subjectId,
        reportId: null,
        action: auditAction,
        allowed: true,
        reason: 'allowed',
      });
      return { status: 200, ok: true, reason, requestId: effectiveRequestId, clientIp, tenantId: selectedTenantId, ...payload };
    }

    let summary;
    try {
      summary = await loadTaxCenter(selectedTenantId);
    } catch {
      return unavailable(subjectId);
    }
    return allow('allowed', { taxCenter: summary });
  }

  return Object.freeze({ handleTaxCenterAccess });
}
