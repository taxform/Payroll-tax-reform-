// Admin provisioning orchestrator for PayrollCheck 360 (M2 step 6).
//
// The full "create a user for a tenant" flow, wiring the two halves
// together:
//   1. createAuthUser (supabase-admin-provisioning.mjs) — the Supabase
//      Auth user, via the Admin API.
//   2. provisionMembership (payrollcheck-tenancy.mjs) — the membership
//      row binding that Auth user to a tenant, a server-assigned
//      subject_id, and a role.
// If step 2 fails, the Auth user is deleted as rollback (best effort)
// and the failure is reported — never an orphaned Auth user with no
// membership, and never a membership with no Auth user.
//
// Both halves are injected as functions, so this unit-tests without
// Supabase or a database. The tenant must already exist (created by
// createTenant); this flow does not create tenants.
//
// Caller authorization is the step-9 admin handler's job (only an
// existing business_owner of the tenant, or a platform admin, may
// provision). This module validates the inputs and reports the outcome.
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SUBJECT_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const ROLES = ['business_owner', 'accounting_admin', 'accounting_reviewer'];

export async function provisionTenantUser({
  createAuthUser,
  deleteAuthUser,
  provisionMembership,
  tenantId,
  email,
  role,
  password,
  emailConfirm = true,
  subjectId,
} = {}) {
  if (typeof createAuthUser !== 'function') throw new TypeError('create_auth_user_required');
  if (typeof deleteAuthUser !== 'function') throw new TypeError('delete_auth_user_required');
  if (typeof provisionMembership !== 'function') throw new TypeError('provision_membership_required');
  if (typeof tenantId !== 'string' || !UUID_PATTERN.test(tenantId)) {
    throw new TypeError('tenant_id_must_be_a_uuid');
  }
  if (typeof email !== 'string' || email.length === 0) {
    throw new TypeError('email_must_be_a_non_empty_string');
  }
  if (typeof role !== 'string' || !ROLES.includes(role)) {
    throw new TypeError(`role_must_be_one_of_${ROLES.join('_')}`);
  }
  if (subjectId !== undefined && (typeof subjectId !== 'string' || !SUBJECT_PATTERN.test(subjectId))) {
    throw new TypeError('subject_id_must_match_[A-Za-z0-9_-]{1,64}');
  }

  let authUser;
  try {
    // Only pass password when the caller supplied one: omitting it is
    // the invite path (user sets a password via the recovery email).
    authUser = await createAuthUser({
      email,
      ...(password !== undefined ? { password } : {}),
      emailConfirm,
    });
  } catch (error) {
    return { ok: false, reason: 'auth_user_creation_failed', detail: error.message };
  }
  if (!authUser || typeof authUser.id !== 'string' || !authUser.id) {
    return { ok: false, reason: 'auth_user_creation_failed', detail: 'missing user id' };
  }

  let membershipResult;
  try {
    membershipResult = await provisionMembership({
      tenantId,
      subjectId,
      authUserId: authUser.id,
      role,
    });
  } catch (error) {
    // Membership write failed after the Auth user exists: roll the Auth
    // user back so no orphaned account remains. Rollback failure is
    // reported, not hidden — the caller must know an orphan may exist.
    let rolledBack = false;
    try {
      await deleteAuthUser({ authUserId: authUser.id });
      rolledBack = true;
    } catch {
      rolledBack = false;
    }
    return { ok: false, reason: 'membership_failed', detail: error.message, rolledBack };
  }
  if (!membershipResult || membershipResult.ok !== true) {
    let rolledBack = false;
    try {
      await deleteAuthUser({ authUserId: authUser.id });
      rolledBack = true;
    } catch {
      rolledBack = false;
    }
    return {
      ok: false,
      reason: membershipResult && membershipResult.reason ? membershipResult.reason : 'membership_failed',
      rolledBack,
    };
  }
  return { ok: true, authUserId: authUser.id, membership: membershipResult.membership };
}
