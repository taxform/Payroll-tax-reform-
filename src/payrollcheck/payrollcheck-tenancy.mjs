// Tenancy, memberships, client grants, and access audit for
// PayrollCheck 360 (M2 step 6; approveClientGrant tightened in step 8).
//
// Step-8 change (only approveClientGrant + the new getActiveMembershipRole
// helper): the step-7 policy app_client_grants_update requires the
// approver to be an active business_owner of the business tenant AND
// never the requester, but the step-6 module approved for ANY active
// business member with no self-approve check, then reported the
// misleading reason 'not_pending' when the DB denied the write. The
// module now enforces the same rule (new reasons 'not_business_owner'
// and 'self_approve') so module and policy agree and a denial is
// diagnosed here, not as a confusing DB error. Everything else is
// byte-identical to the step-6 version.
//
// Pure module: all SQL runs through an injected pg-style
// `query(sql, values) => { rows }` on the caller's least-privilege,
// non-BYPASSRLS connection — never service_role/BYPASSRLS. IDs are
// generated server-side (injected `generateId` / `generateSubjectId`
// so tests stay deterministic). Nothing is logged.
//
// Schema (docs/sql/payrollcheck-deny-by-default-schema.sql +
// payrollcheck-dev-auth-identity-link.sql, verified Nov 23):
//   tenants(tenant_id uuid PK, tenant_type IN ('business',
//     'accounting_firm'), created_at)
//   memberships(membership_id uuid PK, tenant_id FK, subject_id text
//     1-255, role IN ('business_owner','accounting_admin',
//     'accounting_reviewer'), active bool DEFAULT true,
//     UNIQUE (tenant_id, subject_id); auth_user_id uuid ->
//     auth.users(id), UNIQUE (tenant_id, auth_user_id) WHERE NOT NULL)
//   client_grants(grant_id uuid PK, firm_tenant_id FK,
//     business_tenant_id FK, scopes text[] 1-2 of
//     ['view_report','review_finding'], status IN ('pending','active',
//     'revoked'), requested_by_subject, approved_by_subject,
//     revoked_by_subject, requested_at, approved_at, revoked_at,
//     CHECK firm <> business, status-consistency CHECK, one active
//     grant per (firm, business) pair)
//   access_audit(event_id uuid PK, request_id, actor_subject_id,
//     report_id NULL, action IN ('view_report','review_finding'),
//     allowed bool, reason, occurred_at)
//
// Fail-closed split (documented in m2-step6-design.md):
//   - Reads (getTenant, getClientGrant, listActiveGrantsForBusiness)
//     return null / [] on DB error.
//   - Admin writes throw on DB error, except duplicate conflicts,
//     which return structured { ok: false, reason }.
//   - Duplicate conflicts are classified by re-query, never by parsing
//     constraint names (Postgres auto-names one of them).
import { randomBytes, randomUUID } from 'node:crypto';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SUBJECT_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const ROLES = ['business_owner', 'accounting_admin', 'accounting_reviewer'];
const TENANT_TYPES = ['business', 'accounting_firm'];
const GRANT_SCOPES = ['view_report', 'review_finding'];
const AUDIT_ACTIONS = ['view_report', 'review_finding', 'dashboard_read', 'company_read', 'company_write', 'employee_read', 'employee_write', 'pay_run_read', 'pay_run_write', 'tax_center_read'];

function defaultGenerateSubjectId() {
  // 'usr_' + 21 chars from the base64url alphabet -> 25 chars, inside
  // [A-Za-z0-9_-]{1,64}. Same shape step 3's mapping enforces.
  return `usr_${randomBytes(16).toString('base64url').slice(0, 21)}`;
}

function assertUuid(value, name) {
  if (typeof value !== 'string' || !UUID_PATTERN.test(value)) {
    throw new TypeError(`${name}_must_be_a_uuid`);
  }
  return value;
}

function assertSubjectId(value, name = 'subject_id') {
  if (typeof value !== 'string' || !SUBJECT_PATTERN.test(value)) {
    throw new TypeError(`${name}_must_match_[A-Za-z0-9_-]{1,64}`);
  }
  return value;
}

function assertRole(role) {
  if (typeof role !== 'string' || !ROLES.includes(role)) {
    throw new TypeError(`role_must_be_one_of_${ROLES.join('_')}`);
  }
  return role;
}

function isUniqueViolation(error) {
  return Boolean(error) && error.code === '23505';
}

export function createPayrollcheckTenancy({
  query,
  generateId = () => randomUUID(),
  generateSubjectId = defaultGenerateSubjectId,
} = {}) {
  if (typeof query !== 'function') throw new TypeError('query_required');
  if (typeof generateId !== 'function') throw new TypeError('generate_id_required');
  if (typeof generateSubjectId !== 'function') throw new TypeError('generate_subject_id_required');

  async function isActiveMember(tenantId, subjectId) {
    const result = await query(
      'SELECT 1 AS one FROM payrollcheck.memberships WHERE tenant_id = $1::uuid AND subject_id = $2 AND active = true LIMIT 1',
      [tenantId, subjectId],
    );
    return Array.isArray(result.rows) && result.rows.length > 0;
  }

  // --- Tenants -------------------------------------------------------
  async function createTenant({ tenantType } = {}) {
    if (typeof tenantType !== 'string' || !TENANT_TYPES.includes(tenantType)) {
      throw new TypeError(`tenant_type_must_be_one_of_${TENANT_TYPES.join('_')}`);
    }
    const result = await query(
      'INSERT INTO payrollcheck.tenants (tenant_id, tenant_type) VALUES ($1::uuid, $2) RETURNING tenant_id, tenant_type, created_at',
      [generateId(), tenantType],
    );
    if (!Array.isArray(result.rows) || result.rows.length !== 1) {
      throw new Error('tenant_creation_returned_no_row');
    }
    return result.rows[0];
  }

  async function getTenant({ tenantId } = {}) {
    if (typeof tenantId !== 'string' || !UUID_PATTERN.test(tenantId)) return null;
    let result;
    try {
      result = await query(
        'SELECT tenant_id, tenant_type, created_at FROM payrollcheck.tenants WHERE tenant_id = $1::uuid',
        [tenantId],
      );
    } catch {
      return null;
    }
    if (!Array.isArray(result.rows) || result.rows.length !== 1) return null;
    return result.rows[0];
  }

  // --- Memberships ---------------------------------------------------
  async function classifyMembershipDuplicate(tenantId, subjectId, authUserId) {
    const [bySubject, byAuthUser] = await Promise.all([
      query(
        'SELECT 1 AS one FROM payrollcheck.memberships WHERE tenant_id = $1::uuid AND subject_id = $2 LIMIT 1',
        [tenantId, subjectId],
      ).catch(() => null),
      query(
        'SELECT 1 AS one FROM payrollcheck.memberships WHERE tenant_id = $1::uuid AND auth_user_id = $2::uuid LIMIT 1',
        [tenantId, authUserId],
      ).catch(() => null),
    ]);
    if (bySubject && Array.isArray(bySubject.rows) && bySubject.rows.length > 0) {
      return 'duplicate_subject_id';
    }
    if (byAuthUser && Array.isArray(byAuthUser.rows) && byAuthUser.rows.length > 0) {
      return 'duplicate_auth_user_id';
    }
    return 'duplicate';
  }

  async function provisionMembership({ tenantId, subjectId, authUserId, role } = {}) {
    assertUuid(tenantId, 'tenant_id');
    assertUuid(authUserId, 'auth_user_id');
    assertRole(role);
    const subject =
      subjectId === undefined ? generateSubjectId() : assertSubjectId(subjectId);
    let result;
    try {
      result = await query(
        'INSERT INTO payrollcheck.memberships (membership_id, tenant_id, subject_id, auth_user_id, role, active) VALUES ($1::uuid, $2::uuid, $3, $4::uuid, $5, true) RETURNING membership_id, tenant_id, subject_id, auth_user_id, role, active',
        [generateId(), tenantId, subject, authUserId, role],
      );
    } catch (error) {
      if (isUniqueViolation(error)) {
        return { ok: false, reason: await classifyMembershipDuplicate(tenantId, subject, authUserId) };
      }
      throw error;
    }
    if (!Array.isArray(result.rows) || result.rows.length !== 1) {
      throw new Error('membership_insert_returned_no_row');
    }
    return { ok: true, membership: result.rows[0] };
  }

  async function setMembershipActive({ tenantId, subjectId, active }) {
    assertUuid(tenantId, 'tenant_id');
    assertSubjectId(subjectId);
    const result = await query(
      'UPDATE payrollcheck.memberships SET active = $3 WHERE tenant_id = $1::uuid AND subject_id = $2 AND active = $4 RETURNING membership_id, tenant_id, subject_id, auth_user_id, role, active',
      [tenantId, subjectId, active, !active],
    );
    if (!Array.isArray(result.rows)) throw new Error('membership_update_failed');
    if (result.rows.length === 0) return { ok: true, changed: false };
    return { ok: true, changed: true, membership: result.rows[0] };
  }

  async function deactivateMembership({ tenantId, subjectId } = {}) {
    const result = await setMembershipActive({ tenantId, subjectId, active: false });
    return {
      ok: result.changed,
      deactivated: result.changed,
      ...(result.membership ? { membership: result.membership } : {}),
    };
  }

  async function reactivateMembership({ tenantId, subjectId } = {}) {
    const result = await setMembershipActive({ tenantId, subjectId, active: true });
    return { ok: true, reactivated: result.changed, ...(result.membership ? { membership: result.membership } : {}) };
  }

  async function revokeUserEverywhere({ authUserId } = {}) {
    assertUuid(authUserId, 'auth_user_id');
    const result = await query(
      'UPDATE payrollcheck.memberships SET active = false WHERE auth_user_id = $1::uuid AND active = true RETURNING membership_id',
      [authUserId],
    );
    if (!Array.isArray(result.rows)) throw new Error('revoke_all_failed');
    const count = result.rows.length;
    return { ok: count > 0, count };
  }

  // --- Client grants -------------------------------------------------
  function assertScopes(scopes) {
    if (!Array.isArray(scopes) || scopes.length < 1 || scopes.length > 2) {
      throw new TypeError('scopes_must_be_1_or_2_items');
    }
    for (const scope of scopes) {
      if (typeof scope !== 'string' || !GRANT_SCOPES.includes(scope)) {
        throw new TypeError(`scope_must_be_one_of_${GRANT_SCOPES.join('_')}`);
      }
    }
    if (new Set(scopes).size !== scopes.length) {
      throw new TypeError('scopes_must_not_repeat');
    }
    return scopes;
  }

  async function requestClientGrant({ firmTenantId, businessTenantId, scopes, requestedBySubject } = {}) {
    assertUuid(firmTenantId, 'firm_tenant_id');
    assertUuid(businessTenantId, 'business_tenant_id');
    if (firmTenantId === businessTenantId) {
      throw new TypeError('firm_and_business_tenants_must_differ');
    }
    assertScopes(scopes);
    assertSubjectId(requestedBySubject, 'requested_by_subject');
    // The requester must actually belong to the firm tenant.
    if (!(await isActiveMember(firmTenantId, requestedBySubject))) {
      return { ok: false, reason: 'requester_not_member' };
    }
    const pending = await query(
      "SELECT grant_id FROM payrollcheck.client_grants WHERE firm_tenant_id = $1::uuid AND business_tenant_id = $2::uuid AND status = 'pending' LIMIT 1",
      [firmTenantId, businessTenantId],
    );
    if (Array.isArray(pending.rows) && pending.rows.length > 0) {
      return { ok: false, reason: 'pending_grant_exists' };
    }
    const result = await query(
      "INSERT INTO payrollcheck.client_grants (grant_id, firm_tenant_id, business_tenant_id, scopes, status, requested_by_subject) VALUES ($1::uuid, $2::uuid, $3::uuid, $4, 'pending', $5) RETURNING grant_id, firm_tenant_id, business_tenant_id, scopes, status, requested_by_subject, approved_by_subject, revoked_by_subject, requested_at, approved_at, revoked_at",
      [generateId(), firmTenantId, businessTenantId, scopes, requestedBySubject],
    );
    if (!Array.isArray(result.rows) || result.rows.length !== 1) {
      throw new Error('grant_insert_returned_no_row');
    }
    return { ok: true, grant: result.rows[0] };
  }

  async function getClientGrant({ grantId } = {}) {
    if (typeof grantId !== 'string' || !UUID_PATTERN.test(grantId)) return null;
    let result;
    try {
      result = await query(
        'SELECT grant_id, firm_tenant_id, business_tenant_id, scopes, status, requested_by_subject, approved_by_subject, revoked_by_subject, requested_at, approved_at, revoked_at FROM payrollcheck.client_grants WHERE grant_id = $1::uuid',
        [grantId],
      );
    } catch {
      return null;
    }
    if (!Array.isArray(result.rows) || result.rows.length !== 1) return null;
    return result.rows[0];
  }

  async function getActiveMembershipRole(tenantId, subjectId) {
    // Returns the caller's active role in the tenant, or null when they
    // hold no active membership there. DB errors propagate (admin-write
    // fail-closed split). Added in step 8 for the approve tightening.
    const result = await query(
      'SELECT role FROM payrollcheck.memberships WHERE tenant_id = $1::uuid AND subject_id = $2 AND active = true LIMIT 1',
      [tenantId, subjectId],
    );
    if (!Array.isArray(result.rows) || result.rows.length !== 1) return null;
    const role = result.rows[0] && result.rows[0].role;
    return ROLES.includes(role) ? role : null;
  }

  async function approveClientGrant({ grantId, approvedBySubject } = {}) {
    assertUuid(grantId, 'grant_id');
    assertSubjectId(approvedBySubject, 'approved_by_subject');
    const grant = await getClientGrant({ grantId });
    if (!grant) return { ok: false, reason: 'not_found' };
    if (grant.status !== 'pending') return { ok: false, reason: 'not_pending' };
    // The business approves access to its own reports. The step-7
    // policy requires the approver to be an active business_owner of
    // the business tenant, never the requester — the module enforces
    // the same rule so the denial is diagnosed here. Check order is
    // role first, then self-approve: a non-owner who is also the
    // requester gets 'not_business_owner'. Both deny.
    const approverRole = await getActiveMembershipRole(
      grant.business_tenant_id,
      approvedBySubject,
    );
    if (approverRole === null) {
      return { ok: false, reason: 'approver_not_member' };
    }
    if (approverRole !== 'business_owner') {
      return { ok: false, reason: 'not_business_owner' };
    }
    if (approvedBySubject === grant.requested_by_subject) {
      return { ok: false, reason: 'self_approve' };
    }
    let result;
    try {
      result = await query(
        "UPDATE payrollcheck.client_grants SET status = 'active', approved_by_subject = $2, approved_at = now() WHERE grant_id = $1::uuid AND status = 'pending' RETURNING grant_id, firm_tenant_id, business_tenant_id, scopes, status, requested_by_subject, approved_by_subject, revoked_by_subject, requested_at, approved_at, revoked_at",
        [grantId, approvedBySubject],
      );
    } catch (error) {
      if (isUniqueViolation(error)) return { ok: false, reason: 'active_grant_exists' };
      throw error;
    }
    if (!Array.isArray(result.rows) || result.rows.length === 0) {
      return { ok: false, reason: 'not_pending' };
    }
    return { ok: true, grant: result.rows[0] };
  }

  async function revokeClientGrant({ grantId, revokedBySubject } = {}) {
    assertUuid(grantId, 'grant_id');
    assertSubjectId(revokedBySubject, 'revoked_by_subject');
    const grant = await getClientGrant({ grantId });
    if (!grant) return { ok: false, reason: 'not_found' };
    if (grant.status === 'revoked') return { ok: false, reason: 'already_revoked' };
    // Either side may revoke.
    const [inFirm, inBusiness] = await Promise.all([
      isActiveMember(grant.firm_tenant_id, revokedBySubject).catch(() => false),
      isActiveMember(grant.business_tenant_id, revokedBySubject).catch(() => false),
    ]);
    if (!inFirm && !inBusiness) return { ok: false, reason: 'revoker_not_member' };
    const result = await query(
      "UPDATE payrollcheck.client_grants SET status = 'revoked', revoked_by_subject = $2, revoked_at = now() WHERE grant_id = $1::uuid AND status IN ('pending', 'active') RETURNING grant_id, firm_tenant_id, business_tenant_id, scopes, status, requested_by_subject, approved_by_subject, revoked_by_subject, requested_at, approved_at, revoked_at",
      [grantId, revokedBySubject],
    );
    if (!Array.isArray(result.rows) || result.rows.length === 0) {
      return { ok: false, reason: 'already_revoked' };
    }
    return { ok: true, grant: result.rows[0] };
  }

  async function listActiveGrantsForBusiness({ businessTenantId } = {}) {
    if (typeof businessTenantId !== 'string' || !UUID_PATTERN.test(businessTenantId)) return [];
    let result;
    try {
      result = await query(
        "SELECT grant_id, firm_tenant_id, business_tenant_id, scopes, status, requested_by_subject, approved_by_subject, revoked_by_subject, requested_at, approved_at, revoked_at FROM payrollcheck.client_grants WHERE business_tenant_id = $1::uuid AND status = 'active' ORDER BY approved_at ASC",
        [businessTenantId],
      );
    } catch {
      return [];
    }
    return Array.isArray(result.rows) ? result.rows : [];
  }

  // --- Access audit --------------------------------------------------
  async function recordAccessAudit({ requestId, actorSubjectId, reportId, action, allowed, reason } = {}) {
    if (typeof requestId !== 'string' || requestId.length === 0 || requestId.length > 128) {
      throw new TypeError('request_id_must_be_a_non_empty_string_up_to_128_chars');
    }
    assertSubjectId(actorSubjectId, 'actor_subject_id');
    if (reportId !== null && reportId !== undefined) assertUuid(reportId, 'report_id');
    if (typeof action !== 'string' || !AUDIT_ACTIONS.includes(action)) {
      throw new TypeError(`action_must_be_one_of_${AUDIT_ACTIONS.join('_')}`);
    }
    if (typeof allowed !== 'boolean') throw new TypeError('allowed_must_be_a_boolean');
    if (typeof reason !== 'string' || reason.length === 0 || reason.length > 256) {
      throw new TypeError('reason_must_be_a_non_empty_string_up_to_256_chars');
    }
    const result = await query(
      'INSERT INTO payrollcheck.access_audit (event_id, request_id, actor_subject_id, report_id, action, allowed, reason) VALUES ($1::uuid, $2, $3, $4::uuid, $5, $6, $7) RETURNING event_id, request_id, actor_subject_id, report_id, action, allowed, reason, occurred_at',
      [generateId(), requestId, actorSubjectId, reportId ?? null, action, allowed, reason],
    );
    if (!Array.isArray(result.rows) || result.rows.length !== 1) {
      throw new Error('audit_insert_returned_no_row');
    }
    return result.rows[0];
  }

  return Object.freeze({
    createTenant,
    getTenant,
    provisionMembership,
    deactivateMembership,
    reactivateMembership,
    revokeUserEverywhere,
    requestClientGrant,
    approveClientGrant,
    revokeClientGrant,
    getClientGrant,
    listActiveGrantsForBusiness,
    recordAccessAudit,
  });
}
