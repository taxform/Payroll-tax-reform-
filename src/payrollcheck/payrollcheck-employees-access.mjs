// PayrollCheck 360 - Slice 3 (Employees).
//
// Business-owner-only access to a tenant's employees. The caller proves who
// they are (verified user + session), proves MFA (AAL2) and proves they own
// the business before any employee row is listed, created, updated or
// deactivated. Every allow/deny decision writes one audit row - except MFA
// and anonymous-identity failures, which never reach the audit trail (same as
// the company profile handler in Slice 2).
//
// Steps, in order:
//   1. Rate limit (per client IP; a failing store degrades to allow).
//   2. Credential verification - the access token must belong to a verified
//      (email-confirmed) user, or the call is `invalid_session`.
//   3. Subject resolution - the verified user's internal subject id.
//   4. MFA (AAL2) - without it the call is `mfa_required` (403, no audit row).
//   5. Session re-check - the named session must still be live for that user.
//   6. Memberships - loaded through the RLS-bound loader.
//   7. Request shape - the action must be list/create/update/deactivate and
//      the tenant / employee ids must be well formed.
//   8. Tenant selection - the requested tenant must be one of the caller's
//      own memberships; anything else is `not_found`.
//   9. Business owner - only a `business_owner` membership may manage
//      employees; any other role is `not_found` (no role leak).
//  10. List/create/update/deactivate through the RLS-bound loader, scoped to
//      the selected tenant, with one `employee_read` / `employee_write` audit
//      row per decision. Unknown or cross-tenant employees are `not_found`.

import {
  parseEmployeeInput,
  parseEmployeeRequest,
  toEmployeeResponse,
} from './payrollcheck-employees.mjs';
import { resolveDashboardTenant } from './payrollcheck-dashboard.mjs';

const MAX_TOKEN_LENGTH = 16384;
const RATE_LIMIT_KEY_PREFIX = 'employees:';

export function createEmployeeAccessHandler({
  getVerifiedUser,
  requireAal2,
  resolveSubjectId,
  recordAudit,
  checkRateLimit,
  getSession,
  generateId,
  now,
  loadMemberships,
  listEmployees,
  createEmployee,
  updateEmployee,
  deactivateEmployee,
} = {}) {
  const required = {
    getVerifiedUser,
    requireAal2,
    resolveSubjectId,
    recordAudit,
    checkRateLimit,
    getSession,
    generateId,
    now,
    loadMemberships,
    listEmployees,
    createEmployee,
    updateEmployee,
    deactivateEmployee,
  };
  for (const [name, fn] of Object.entries(required)) {
    if (typeof fn !== 'function') throw new TypeError(`${name} is required`);
  }

  async function handleEmployeeAccess({
    accessToken,
    sessionId,
    tenantId,
    action,
    employee,
    employeeId,
    requestId,
    clientIp,
  }) {
    const effectiveRequestId =
      typeof requestId === 'string' && requestId ? requestId : generateId();
    const auditAction = action === 'list' ? 'employee_read' : 'employee_write';

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
      return {
        status,
        ok: false,
        reason,
        requestId: denyRequestId,
        clientIp: denyClientIp,
        tenantId: denyTenantId,
      };
    }

    function unavailable() {
      return {
        status: 503,
        ok: false,
        reason: 'unavailable',
        requestId: effectiveRequestId,
        clientIp,
        tenantId: tenantId ?? null,
      };
    }

    // 1. Rate limit (per client IP; a failing store degrades to allow).
    let rate = null;
    try {
      rate = await checkRateLimit({ key: `${RATE_LIMIT_KEY_PREFIX}${clientIp ?? 'unknown'}` });
    } catch {
      rate = null;
    }
    if (rate?.allowed === false) {
      return deny(429, 'rate_limited', {
        requestId: effectiveRequestId,
        clientIp,
        subjectId: null,
        tenantId: tenantId ?? null,
      });
    }

    // 2. Credential verification.
    if (
      typeof accessToken !== 'string' ||
      accessToken.length < 1 ||
      accessToken.length > MAX_TOKEN_LENGTH
    ) {
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
      return unavailable();
    }
    if (!verified || typeof verified.id !== 'string' || !verified.email_confirmed_at) {
      return deny(401, 'invalid_session', {
        requestId: effectiveRequestId,
        clientIp,
        subjectId: null,
        tenantId: tenantId ?? null,
      });
    }

    // 3. Subject resolution.
    let subjectId;
    try {
      subjectId = await resolveSubjectId(verified.id);
    } catch {
      return unavailable();
    }
    if (typeof subjectId !== 'string' || !subjectId) {
      return deny(401, 'invalid_session', {
        requestId: effectiveRequestId,
        clientIp,
        subjectId: null,
        tenantId: tenantId ?? null,
      });
    }

    // 4. MFA (AAL2) - no audit row for this failure.
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

    // 5. Session re-check.
    let session;
    try {
      session = await getSession(sessionId);
    } catch {
      return unavailable();
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

    // 6. Memberships through the RLS-bound loader.
    let memberships;
    try {
      memberships = await loadMemberships(subjectId);
    } catch {
      return unavailable();
    }

    // 7. Request shape.
    const parsed = parseEmployeeRequest({ tenantId, action, employeeId });
    if (!parsed.ok) {
      return deny(400, parsed.error, {
        requestId: effectiveRequestId,
        clientIp,
        subjectId,
        tenantId: tenantId ?? null,
      });
    }

    // 8. Tenant selection - only the caller's own memberships.
    const resolved = resolveDashboardTenant({
      memberships,
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

    // 9. Business owner only.
    const selectedTenantId = resolved.tenant.tenantId;
    if (resolved.tenant.role !== 'business_owner') {
      return deny(404, 'not_found', {
        requestId: effectiveRequestId,
        clientIp,
        subjectId,
        tenantId: selectedTenantId,
      });
    }

    // 10. List / create / update / deactivate, scoped to the selected tenant.
    if (parsed.action === 'list') {
      let rows;
      try {
        rows = await listEmployees({ tenantId: selectedTenantId });
      } catch {
        return unavailable();
      }
      await recordAudit({
        requestId: effectiveRequestId,
        actorSubjectId: subjectId,
        reportId: null,
        action: 'employee_read',
        allowed: true,
        reason: 'allowed',
      });
      return {
        status: 200,
        ok: true,
        reason: 'allowed',
        employees: rows.map(toEmployeeResponse),
        tenantId: selectedTenantId,
        requestId: effectiveRequestId,
        clientIp,
      };
    }

    if (parsed.action === 'create') {
      const validated = parseEmployeeInput(employee, { ssnRequired: true });
      if (!validated.ok) {
        return deny(400, validated.error, {
          requestId: effectiveRequestId,
          clientIp,
          subjectId,
          tenantId: selectedTenantId,
        });
      }
      let created;
      try {
        created = await createEmployee({ tenantId: selectedTenantId, employee: validated.employee });
      } catch {
        return unavailable();
      }
      if (!created) return unavailable();
      await recordAudit({
        requestId: effectiveRequestId,
        actorSubjectId: subjectId,
        reportId: null,
        action: 'employee_write',
        allowed: true,
        reason: 'allowed',
      });
      return {
        status: 200,
        ok: true,
        reason: 'allowed',
        employee: toEmployeeResponse(created),
        tenantId: selectedTenantId,
        requestId: effectiveRequestId,
        clientIp,
      };
    }

    if (parsed.action === 'update') {
      const validated = parseEmployeeInput(employee, { ssnRequired: false });
      if (!validated.ok) {
        return deny(400, validated.error, {
          requestId: effectiveRequestId,
          clientIp,
          subjectId,
          tenantId: selectedTenantId,
        });
      }
      let updated;
      try {
        updated = await updateEmployee({
          tenantId: selectedTenantId,
          employeeId: parsed.employeeId,
          employee: validated.employee,
        });
      } catch {
        return unavailable();
      }
      if (!updated) {
        return deny(404, 'not_found', {
          requestId: effectiveRequestId,
          clientIp,
          subjectId,
          tenantId: selectedTenantId,
        });
      }
      await recordAudit({
        requestId: effectiveRequestId,
        actorSubjectId: subjectId,
        reportId: null,
        action: 'employee_write',
        allowed: true,
        reason: 'allowed',
      });
      return {
        status: 200,
        ok: true,
        reason: 'allowed',
        employee: toEmployeeResponse(updated),
        tenantId: selectedTenantId,
        requestId: effectiveRequestId,
        clientIp,
      };
    }

    // Deactivate: status flips to 'inactive'; there is no DELETE.
    let deactivated;
    try {
      deactivated = await deactivateEmployee({
        tenantId: selectedTenantId,
        employeeId: parsed.employeeId,
      });
    } catch {
      return unavailable();
    }
    if (!deactivated) {
      return deny(404, 'not_found', {
        requestId: effectiveRequestId,
        clientIp,
        subjectId,
        tenantId: selectedTenantId,
      });
    }
    await recordAudit({
      requestId: effectiveRequestId,
      actorSubjectId: subjectId,
      reportId: null,
      action: 'employee_write',
      allowed: true,
      reason: 'allowed',
    });
    return {
      status: 200,
      ok: true,
      reason: 'allowed',
      employee: toEmployeeResponse(deactivated),
      tenantId: selectedTenantId,
      requestId: effectiveRequestId,
      clientIp,
    };
  }

  return Object.freeze({ handleEmployeeAccess });
}
