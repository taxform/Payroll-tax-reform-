// Slice 6 — TaxBandits sandbox filing (docs/payrollcheck-360-integration-plan.md).
// Access handler for the filing queue, submit-filing and refresh-status
// operations. Mirrors src/payrollcheck/payrollcheck-tax-center-access.mjs:
// the same verified session, AAL2, tenant membership, business-owner role and
// per-client-IP rate limit, with the filing audit actions (filing_read for the
// queue and status refresh, filing_write for a submission).
import { parseFilingRequest } from './payrollcheck-filing.mjs';
import { resolveDashboardTenant } from './payrollcheck-dashboard.mjs';

const MAX_TOKEN_LENGTH = 16384;
const RATE_LIMIT_KEY_PREFIX = 'filing:';

export function createFilingAccessHandler({
  getVerifiedUser,
  requireAal2,
  resolveSubjectId,
  recordAudit,
  checkRateLimit,
  getSession,
  generateId,
  loadMemberships,
  loadFiling,
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
    loadFiling,
  };
  for (const [name, fn] of Object.entries(required)) {
    if (typeof fn !== 'function') throw new TypeError(`${name} is required`);
  }

  async function handleFilingAccess({
    accessToken,
    sessionId,
    tenantId,
    action,
    requestId,
    clientIp,
    form,
    taxYear,
    quarter,
    pin,
    filingId,
  }) {
    const effectiveRequestId = typeof requestId === 'string' && requestId ? requestId : generateId();
    const auditAction = action === 'submit-filing' ? 'filing_write' : 'filing_read';
    async function deny(status, reason, subjectId, selectedTenantId) {
      if (subjectId) {
        await recordAudit({
          requestId: effectiveRequestId,
          actorSubjectId: subjectId,
          reportId: null,
          action: auditAction,
          allowed: false,
          reason,
          tenantId: selectedTenantId ?? null,
          detail: { action, reason },
        });
      }
      return {
        status,
        ok: false,
        reason,
        requestId: effectiveRequestId,
        clientIp: clientIp ?? null,
        tenantId: selectedTenantId ?? null,
      };
    }
    async function unavailable(subjectId) {
      return {
        status: 503,
        ok: false,
        reason: 'unavailable',
        requestId: effectiveRequestId,
        clientIp: clientIp ?? null,
        tenantId: null,
      };
    }
    const rate = await checkRateLimit({ key: `${RATE_LIMIT_KEY_PREFIX}${clientIp ?? 'unknown'}` });
    if (rate?.allowed === false) return deny(429, 'rate_limited', null, tenantId ?? null);
    if (typeof accessToken !== 'string' || !accessToken || accessToken.length > MAX_TOKEN_LENGTH) {
      return deny(401, 'invalid_session', null, tenantId ?? null);
    }
    let verified;
    try {
      verified = await getVerifiedUser(accessToken);
    } catch {
      return unavailable(null);
    }
    if (!verified?.id || !verified.email_confirmed_at) {
      return deny(401, 'invalid_session', null, tenantId ?? null);
    }
    let subjectId;
    try {
      subjectId = await resolveSubjectId(verified.id);
    } catch {
      return unavailable(null);
    }
    if (!subjectId) return deny(401, 'invalid_session', null, tenantId ?? null);
    let aal2 = false;
    try {
      aal2 = (await requireAal2()) === true;
    } catch {
      aal2 = false;
    }
    if (!aal2) return { status: 403, ok: false, reason: 'mfa_required', requestId: effectiveRequestId };
    const session = await getSession(sessionId);
    if (!session || session.authUserId !== verified.id || session.revoked === true || session.revokedAt === true) {
      return deny(401, 'invalid_session', subjectId, tenantId ?? null);
    }
    let memberships;
    try {
      memberships = await loadMemberships(subjectId);
    } catch {
      return unavailable(subjectId);
    }
    const parsed = parseFilingRequest({ tenantId, action, form, taxYear, quarter, pin, filingId });
    if (!parsed.ok) return deny(400, parsed.errors[0], subjectId, tenantId ?? null);
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
        tenantId: selectedTenantId,
        detail: { action, reason, ...payload },
      });
      return {
        status: 200,
        ok: true,
        reason,
        requestId: effectiveRequestId,
        clientIp: clientIp ?? null,
        tenantId: selectedTenantId,
        ...payload,
      };
    }
    let result;
    try {
      result = await loadFiling({
        tenantId: selectedTenantId,
        action: parsed.action,
        form: parsed.form,
        taxYear: parsed.taxYear,
        quarter: parsed.quarter,
        pin: parsed.pin,
        filingId: parsed.filingId,
      });
    } catch {
      return unavailable(subjectId);
    }
    if (!result || typeof result !== 'object') return unavailable(subjectId);
    if (result.ok === false) return deny(result.status ?? 400, result.error ?? 'filing_failed', subjectId, selectedTenantId);
    const { ok: _ok, status: _status, error: _error, ...payload } = result;
    return allow('allowed', payload);
  }

  return { handleFilingAccess };
}
