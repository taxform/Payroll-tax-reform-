import { parsePayRunInput, parsePayRunRequest, toPayRunResponse } from './payrollcheck-pay-runs.mjs';
import { resolveDashboardTenant } from './payrollcheck-dashboard.mjs';

const MAX_TOKEN_LENGTH = 16384;
const RATE_LIMIT_KEY_PREFIX = 'pay-runs:';

export function createPayRunAccessHandler({
  getVerifiedUser,
  requireAal2,
  resolveSubjectId,
  recordAudit,
  checkRateLimit,
  getSession,
  generateId,
  loadMemberships,
  previewPayRun,
  createPayRun,
  listPayRuns,
  getPayRun,
  loadPayRunLines,
  deletePayRun,
  finalizePayRun,
} = {}) {
  const required = { getVerifiedUser, requireAal2, resolveSubjectId, recordAudit, checkRateLimit,
    getSession, generateId, loadMemberships, previewPayRun, createPayRun, listPayRuns,
    getPayRun, loadPayRunLines, deletePayRun, finalizePayRun };
  for (const [name, fn] of Object.entries(required)) {
    if (typeof fn !== 'function') throw new TypeError(`${name} is required`);
  }

  async function handlePayRunAccess({ accessToken, sessionId, tenantId, action, payRunId, payRun, requestId, clientIp }) {
    const effectiveRequestId = typeof requestId === 'string' && requestId ? requestId : generateId();
    const auditAction = action === 'list' || action === 'get' || action === 'preview' ? 'pay_run_read' : 'pay_run_write';

    async function deny(status, reason, subjectId, selectedTenantId) {
      if (subjectId) await recordAudit({
        requestId: effectiveRequestId, actorSubjectId: subjectId, reportId: null,
        action: auditAction, allowed: false, reason,
      });
      return { status, ok: false, reason, requestId: effectiveRequestId, clientIp, tenantId: selectedTenantId ?? tenantId ?? null };
    }
    const unavailable = (subjectId) => ({
      status: 503, ok: false, reason: 'unavailable', requestId: effectiveRequestId,
      clientIp, tenantId: subjectId ? tenantId ?? null : null,
    });

    let rate;
    try { rate = await checkRateLimit({ key: `${RATE_LIMIT_KEY_PREFIX}${clientIp ?? 'unknown'}` }); } catch { rate = null; }
    if (rate?.allowed === false) return deny(429, 'rate_limited', null, tenantId ?? null);
    if (typeof accessToken !== 'string' || accessToken.length < 1 || accessToken.length > MAX_TOKEN_LENGTH) {
      return deny(401, 'invalid_session', null, tenantId ?? null);
    }
    let verified;
    try { verified = await getVerifiedUser(accessToken); } catch { return unavailable(null); }
    if (!verified?.id || !verified.email_confirmed_at) return deny(401, 'invalid_session', null, tenantId ?? null);
    let subjectId;
    try { subjectId = await resolveSubjectId(verified.id); } catch { return unavailable(null); }
    if (!subjectId) return deny(401, 'invalid_session', null, tenantId ?? null);
    let aal2;
    try { aal2 = (await requireAal2()) === true; } catch { aal2 = false; }
    if (!aal2) return { status: 403, ok: false, reason: 'mfa_required', requestId: effectiveRequestId, clientIp, tenantId: null };
    let session;
    try { session = await getSession(sessionId); } catch { return unavailable(subjectId); }
    if (!session || session.authUserId !== verified.id || session.revoked === true || session.revokedAt === true) {
      return deny(401, 'invalid_session', subjectId, tenantId ?? null);
    }
    let memberships;
    try { memberships = await loadMemberships(subjectId); } catch { return unavailable(subjectId); }

    const parsed = parsePayRunRequest({ tenantId, action, payRunId });
    if (!parsed.ok) return deny(400, parsed.error, subjectId, tenantId ?? null);
    const resolved = resolveDashboardTenant({ memberships, requestedTenantId: parsed.tenantId });
    if (!resolved.ok) return deny(resolved.status, resolved.error, subjectId, tenantId ?? null);
    const selectedTenantId = resolved.tenant.tenantId;
    if (resolved.tenant.role !== 'business_owner') return deny(404, 'not_found', subjectId, selectedTenantId);

    async function allow(reason, payload) {
      await recordAudit({ requestId: effectiveRequestId, actorSubjectId: subjectId, reportId: null,
        action: auditAction, allowed: true, reason: 'allowed' });
      return { status: 200, ok: true, reason, requestId: effectiveRequestId, clientIp,
        tenantId: selectedTenantId, ...payload };
    }

    if (parsed.action === 'list') {
      let rows;
      try { rows = await listPayRuns(selectedTenantId); } catch { return unavailable(subjectId); }
      return allow('allowed', { payRuns: rows.map((row) => toPayRunResponse(row, [])) });
    }
    if (parsed.action === 'preview' || parsed.action === 'create') {
      const validated = parsePayRunInput(payRun);
      if (!validated.ok) return deny(400, validated.error, subjectId, selectedTenantId);
      if (parsed.action === 'preview') {
        let preview;
        try { preview = await previewPayRun({ tenantId: selectedTenantId, payRun: validated.payRun }); } catch { return unavailable(subjectId); }
        return allow('allowed', { preview });
      }
      let created;
      try { created = await createPayRun({ tenantId: selectedTenantId, payRun: validated.payRun }); } catch { return unavailable(subjectId); }
      if (!created) return unavailable(subjectId);
      let lines = [];
      try { lines = await loadPayRunLines(selectedTenantId, created.pay_run_id); } catch { return unavailable(subjectId); }
      return allow('allowed', { payRun: toPayRunResponse(created, lines) });
    }
    let row;
    try {
      row = await getPayRun(selectedTenantId, parsed.payRunId);
    } catch { return unavailable(subjectId); }
    if (!row) return deny(404, 'not_found', subjectId, selectedTenantId);
    if (parsed.action === 'get') {
      let lines;
      try { lines = await loadPayRunLines(selectedTenantId, parsed.payRunId); } catch { return unavailable(subjectId); }
      return allow('allowed', { payRun: toPayRunResponse(row, lines) });
    }
    if (row.status === 'final') return deny(404, 'not_found', subjectId, selectedTenantId);
    let changed;
    if (parsed.action === 'delete') {
      try { changed = await deletePayRun({ tenantId: selectedTenantId, payRunId: parsed.payRunId }); } catch { return unavailable(subjectId); }
    } else if (parsed.action === 'finalize') {
      try { changed = await finalizePayRun({ tenantId: selectedTenantId, payRunId: parsed.payRunId }); } catch { return unavailable(subjectId); }
    }
    if (!changed) return deny(404, 'not_found', subjectId, selectedTenantId);
    let lines = [];
    if (changed.status === 'final') {
      try { lines = await loadPayRunLines(selectedTenantId, parsed.payRunId); } catch { return unavailable(subjectId); }
    }
    return allow('allowed', { payRun: toPayRunResponse(changed, lines) });
  }
  return Object.freeze({ handlePayRunAccess });
}
