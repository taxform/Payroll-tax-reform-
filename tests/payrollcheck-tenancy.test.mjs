import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPayrollcheckTenancy } from '../src/payrollcheck/payrollcheck-tenancy.mjs';

const TENANT_ID = '11111111-1111-4111-8111-111111111111';
const FIRM_TENANT_ID = '22222222-2222-4222-8222-222222222222';
const BUSINESS_TENANT_ID = '33333333-3333-4333-8333-333333333333';
const AUTH_USER_ID = '44444444-4444-4444-8444-444444444444';
const GRANT_ID = '55555555-5555-4555-8555-555555555555';
const REPORT_ID = '66666666-6666-4666-8666-666666666666';
const GENERATED_ID = '77777777-7777-4777-8777-777777777777';

function setup(impl, overrides = {}) {
  const calls = [];
  const query = async (sql, values) => {
    calls.push({ sql, values });
    return impl(sql, values, calls);
  };
  const api = createPayrollcheckTenancy({
    query,
    generateId: () => GENERATED_ID,
    generateSubjectId: () => 'usr_generatedsubject01',
    ...overrides,
  });
  return { api, calls };
}

const findCall = (calls, fragment) => calls.find((c) => c.sql.includes(fragment));

// --- Tenants ----------------------------------------------------------

test('createTenant inserts the generated id and type, returns the row', async () => {
  const row = { tenant_id: GENERATED_ID, tenant_type: 'business', created_at: '2026-11-23T00:00:00Z' };
  const { api, calls } = setup(async () => ({ rows: [row] }));
  const result = await api.createTenant({ tenantType: 'business' });
  assert.deepEqual(result, row);
  const insert = findCall(calls, 'INSERT INTO payrollcheck.tenants');
  assert.ok(insert);
  assert.equal(insert.values[0], GENERATED_ID);
  assert.equal(insert.values[1], 'business');
});

test('createTenant rejects an unknown tenant type and throws on no row', async () => {
  const { api } = setup(async () => ({ rows: [{ tenant_id: GENERATED_ID }] }));
  await assert.rejects(() => api.createTenant({ tenantType: 'person' }), /tenant_type_must_be_one_of/);
  await assert.rejects(() => api.createTenant({}), /tenant_type_must_be_one_of/);
  const noRow = setup(async () => ({ rows: [] }));
  await assert.rejects(() => noRow.api.createTenant({ tenantType: 'business' }), /tenant_creation_returned_no_row/);
});

test('getTenant returns the row, null when missing, null on bad uuid or DB error', async () => {
  const row = { tenant_id: TENANT_ID, tenant_type: 'accounting_firm', created_at: '2026-11-23T00:00:00Z' };
  const found = setup(async () => ({ rows: [row] }));
  assert.deepEqual(await found.api.getTenant({ tenantId: TENANT_ID }), row);
  const missing = setup(async () => ({ rows: [] }));
  assert.equal(await missing.api.getTenant({ tenantId: TENANT_ID }), null);
  assert.equal(await missing.api.getTenant({ tenantId: 'not-a-uuid' }), null);
  const failing = setup(async () => {
    throw new Error('db down');
  });
  assert.equal(await failing.api.getTenant({ tenantId: TENANT_ID }), null);
});

// --- Memberships ------------------------------------------------------

const membershipRow = {
  membership_id: GENERATED_ID,
  tenant_id: TENANT_ID,
  subject_id: 'usr_generatedsubject01',
  auth_user_id: AUTH_USER_ID,
  role: 'business_owner',
  active: true,
};

test('provisionMembership generates a subject id and inserts the row', async () => {
  const { api, calls } = setup(async () => ({ rows: [membershipRow] }));
  const result = await api.provisionMembership({ tenantId: TENANT_ID, authUserId: AUTH_USER_ID, role: 'business_owner' });
  assert.deepEqual(result, { ok: true, membership: membershipRow });
  const insert = findCall(calls, 'INSERT INTO payrollcheck.memberships');
  assert.ok(insert);
  assert.equal(insert.values[2], 'usr_generatedsubject01');
  assert.equal(insert.values[3], AUTH_USER_ID);
  assert.equal(insert.values[4], 'business_owner');
});

test('provisionMembership uses an explicit subject id when supplied', async () => {
  const { api, calls } = setup(async () => ({ rows: [membershipRow] }));
  await api.provisionMembership({
    tenantId: TENANT_ID,
    subjectId: 'owner-42',
    authUserId: AUTH_USER_ID,
    role: 'accounting_admin',
  });
  const insert = findCall(calls, 'INSERT INTO payrollcheck.memberships');
  assert.equal(insert.values[2], 'owner-42');
});

test('provisionMembership rejects bad role, bad uuids, bad subject', async () => {
  const { api } = setup(async () => ({ rows: [membershipRow] }));
  await assert.rejects(
    () => api.provisionMembership({ tenantId: TENANT_ID, authUserId: AUTH_USER_ID, role: 'super_admin' }),
    /role_must_be_one_of/,
  );
  await assert.rejects(
    () => api.provisionMembership({ tenantId: 'x', authUserId: AUTH_USER_ID, role: 'business_owner' }),
    /tenant_id_must_be_a_uuid/,
  );
  await assert.rejects(
    () => api.provisionMembership({ tenantId: TENANT_ID, authUserId: 'x', role: 'business_owner' }),
    /auth_user_id_must_be_a_uuid/,
  );
  await assert.rejects(
    () => api.provisionMembership({ tenantId: TENANT_ID, subjectId: 'bad subject!', authUserId: AUTH_USER_ID, role: 'business_owner' }),
    /subject_id_must_match/,
  );
});

test('provisionMembership classifies a duplicate subject id via re-query', async () => {
  const { api, calls } = setup(async (sql) => {
    if (sql.includes('INSERT INTO payrollcheck.memberships')) {
      const error = new Error('duplicate key value violates unique constraint');
      error.code = '23505';
      throw error;
    }
    if (sql.includes('subject_id = $2')) return { rows: [{ one: 1 }] };
    return { rows: [] };
  });
  const result = await api.provisionMembership({ tenantId: TENANT_ID, authUserId: AUTH_USER_ID, role: 'business_owner' });
  assert.deepEqual(result, { ok: false, reason: 'duplicate_subject_id' });
  assert.equal(calls.filter((c) => c.sql.includes('SELECT 1 AS one')).length, 2);
});

test('provisionMembership classifies a duplicate auth user id via re-query', async () => {
  const { api } = setup(async (sql) => {
    if (sql.includes('INSERT INTO payrollcheck.memberships')) {
      const error = new Error('duplicate key value violates unique constraint');
      error.code = '23505';
      throw error;
    }
    if (sql.includes('auth_user_id = $2')) return { rows: [{ one: 1 }] };
    return { rows: [] };
  });
  const result = await api.provisionMembership({ tenantId: TENANT_ID, authUserId: AUTH_USER_ID, role: 'business_owner' });
  assert.deepEqual(result, { ok: false, reason: 'duplicate_auth_user_id' });
});

test('provisionMembership returns generic duplicate when neither re-query finds a row', async () => {
  const { api } = setup(async (sql) => {
    if (sql.includes('INSERT INTO payrollcheck.memberships')) {
      const error = new Error('duplicate key value violates unique constraint');
      error.code = '23505';
      throw error;
    }
    return { rows: [] };
  });
  const result = await api.provisionMembership({ tenantId: TENANT_ID, authUserId: AUTH_USER_ID, role: 'business_owner' });
  assert.deepEqual(result, { ok: false, reason: 'duplicate' });
});

test('provisionMembership propagates non-unique DB errors', async () => {
  const { api } = setup(async () => {
    throw new Error('connection refused');
  });
  await assert.rejects(
    () => api.provisionMembership({ tenantId: TENANT_ID, authUserId: AUTH_USER_ID, role: 'business_owner' }),
    /connection refused/,
  );
});

test('deactivateMembership is idempotent; reactivateMembership reverses it', async () => {
  const deactivated = setup(async () => ({ rows: [membershipRow] }));
  const off = await deactivated.api.deactivateMembership({ tenantId: TENANT_ID, subjectId: 'usr_generatedsubject01' });
  assert.equal(off.ok, true);
  assert.equal(off.deactivated, true);
  assert.deepEqual(off.membership, membershipRow);
  const update = findCall(deactivated.calls, 'UPDATE payrollcheck.memberships SET active');
  assert.equal(update.values[2], false);

  const alreadyOff = setup(async () => ({ rows: [] }));
  assert.deepEqual(await alreadyOff.api.deactivateMembership({ tenantId: TENANT_ID, subjectId: 'usr_generatedsubject01' }), {
    ok: false,
    deactivated: false,
  });

  const reactivated = setup(async () => ({ rows: [{ ...membershipRow, active: true }] }));
  const on = await reactivated.api.reactivateMembership({ tenantId: TENANT_ID, subjectId: 'usr_generatedsubject01' });
  assert.equal(on.ok, true);
  assert.equal(on.reactivated, true);
});

test('revokeUserEverywhere deactivates all rows for the auth user and returns the count', async () => {
  const { api, calls } = setup(async () => ({ rows: [{ membership_id: 'a' }, { membership_id: 'b' }] }));
  const result = await api.revokeUserEverywhere({ authUserId: AUTH_USER_ID });
  assert.deepEqual(result, { ok: true, count: 2 });
  const update = findCall(calls, 'UPDATE payrollcheck.memberships SET active = false WHERE auth_user_id');
  assert.ok(update);
  const zero = setup(async () => ({ rows: [] }));
  assert.deepEqual(await zero.api.revokeUserEverywhere({ authUserId: AUTH_USER_ID }), { ok: false, count: 0 });
  await assert.rejects(() => api.revokeUserEverywhere({ authUserId: 'x' }), /auth_user_id_must_be_a_uuid/);
});

// --- Client grants ----------------------------------------------------

const grantRow = {
  grant_id: GRANT_ID,
  firm_tenant_id: FIRM_TENANT_ID,
  business_tenant_id: BUSINESS_TENANT_ID,
  scopes: ['view_report'],
  status: 'pending',
  requested_by_subject: 'firm-user-1',
  approved_by_subject: null,
  revoked_by_subject: null,
  requested_at: '2026-11-23T00:00:00Z',
  approved_at: null,
  revoked_at: null,
};

function grantSetup(impl) {
  return setup(impl);
}

test('requestClientGrant inserts a pending grant when the requester is a firm member', async () => {
  const { api, calls } = setup(async (sql) => {
    if (sql.includes('FROM payrollcheck.memberships')) return { rows: [{ one: 1 }] };
    if (sql.includes("status = 'pending'")) return { rows: [] };
    if (sql.includes('INSERT INTO payrollcheck.client_grants')) return { rows: [grantRow] };
    return { rows: [] };
  });
  const result = await api.requestClientGrant({
    firmTenantId: FIRM_TENANT_ID,
    businessTenantId: BUSINESS_TENANT_ID,
    scopes: ['view_report'],
    requestedBySubject: 'firm-user-1',
  });
  assert.deepEqual(result, { ok: true, grant: grantRow });
  const insert = findCall(calls, 'INSERT INTO payrollcheck.client_grants');
  assert.equal(insert.values[4], 'firm-user-1');
});

test('requestClientGrant refuses a non-member requester and a second pending grant', async () => {
  const nonMember = grantSetup(async (sql) => {
    if (sql.includes('FROM payrollcheck.memberships')) return { rows: [] };
    return { rows: [] };
  });
  assert.deepEqual(
    await nonMember.api.requestClientGrant({
      firmTenantId: FIRM_TENANT_ID,
      businessTenantId: BUSINESS_TENANT_ID,
      scopes: ['view_report'],
      requestedBySubject: 'outsider',
    }),
    { ok: false, reason: 'requester_not_member' },
  );
  assert.equal(nonMember.calls.filter((c) => c.sql.includes('INSERT INTO payrollcheck.client_grants')).length, 0);

  const pendingExists = grantSetup(async (sql) => {
    if (sql.includes('FROM payrollcheck.memberships')) return { rows: [{ one: 1 }] };
    if (sql.includes("status = 'pending'")) return { rows: [{ grant_id: GRANT_ID }] };
    return { rows: [] };
  });
  assert.deepEqual(
    await pendingExists.api.requestClientGrant({
      firmTenantId: FIRM_TENANT_ID,
      businessTenantId: BUSINESS_TENANT_ID,
      scopes: ['view_report'],
      requestedBySubject: 'firm-user-1',
    }),
    { ok: false, reason: 'pending_grant_exists' },
  );
});

test('requestClientGrant validates firm/business, scopes, and subject', async () => {
  const { api } = grantSetup(async () => ({ rows: [{ one: 1 }] }));
  await assert.rejects(
    () =>
      api.requestClientGrant({
        firmTenantId: FIRM_TENANT_ID,
        businessTenantId: FIRM_TENANT_ID,
        scopes: ['view_report'],
        requestedBySubject: 'firm-user-1',
      }),
    /firm_and_business_tenants_must_differ/,
  );
  await assert.rejects(
    () =>
      api.requestClientGrant({
        firmTenantId: FIRM_TENANT_ID,
        businessTenantId: BUSINESS_TENANT_ID,
        scopes: [],
        requestedBySubject: 'firm-user-1',
      }),
    /scopes_must_be_1_or_2_items/,
  );
  await assert.rejects(
    () =>
      api.requestClientGrant({
        firmTenantId: FIRM_TENANT_ID,
        businessTenantId: BUSINESS_TENANT_ID,
        scopes: ['view_report', 'delete_everything'],
        requestedBySubject: 'firm-user-1',
      }),
    /scope_must_be_one_of/,
  );
  await assert.rejects(
    () =>
      api.requestClientGrant({
        firmTenantId: FIRM_TENANT_ID,
        businessTenantId: BUSINESS_TENANT_ID,
        scopes: ['view_report', 'view_report'],
        requestedBySubject: 'firm-user-1',
      }),
    /scopes_must_not_repeat/,
  );
});

test('approveClientGrant activates a pending grant when the approver is a business owner', async () => {
  const activeRow = { ...grantRow, status: 'active', approved_by_subject: 'biz-owner-1', approved_at: '2026-11-23T01:00:00Z' };
  const { api, calls } = setup(async (sql) => {
    if (sql.includes('FROM payrollcheck.client_grants WHERE grant_id')) return { rows: [grantRow] };
if (sql.includes('SELECT role FROM payrollcheck.memberships')) return { rows: [{ role: 'business_owner' }] };
    if (sql.includes('FROM payrollcheck.memberships')) return { rows: [{ one: 1 }] };
    if (sql.includes("SET status = 'active'")) return { rows: [activeRow] };
    return { rows: [] };
  });
  const result = await api.approveClientGrant({ grantId: GRANT_ID, approvedBySubject: 'biz-owner-1' });
  assert.deepEqual(result, { ok: true, grant: activeRow });
  const update = findCall(calls, "SET status = 'active'");
  assert.equal(update.values[1], 'biz-owner-1');
});

test('approveClientGrant refuses missing, non-pending, and non-member approvers', async () => {
  const notFound = grantSetup(async () => ({ rows: [] }));
  assert.deepEqual(await notFound.api.approveClientGrant({ grantId: GRANT_ID, approvedBySubject: 'biz-owner-1' }), {
    ok: false,
    reason: 'not_found',
  });
  const notPending = grantSetup(async (sql) => {
    if (sql.includes('FROM payrollcheck.client_grants')) return { rows: [{ ...grantRow, status: 'active' }] };
    return { rows: [] };
  });
  assert.deepEqual(await notPending.api.approveClientGrant({ grantId: GRANT_ID, approvedBySubject: 'biz-owner-1' }), {
    ok: false,
    reason: 'not_pending',
  });
  const nonMember = grantSetup(async (sql) => {
    if (sql.includes('FROM payrollcheck.client_grants')) return { rows: [grantRow] };
    if (sql.includes('FROM payrollcheck.memberships')) return { rows: [] };
    return { rows: [] };
  });
  assert.deepEqual(await nonMember.api.approveClientGrant({ grantId: GRANT_ID, approvedBySubject: 'outsider' }), {
    ok: false,
    reason: 'approver_not_member',
  });
});

test('approveClientGrant reports active_grant_exists on a unique violation', async () => {
  const { api } = setup(async (sql) => {
    if (sql.includes('FROM payrollcheck.client_grants')) return { rows: [grantRow] };
    if (sql.includes('SELECT role FROM payrollcheck.memberships')) return { rows: [{ role: 'business_owner' }] };
    if (sql.includes('FROM payrollcheck.memberships')) return { rows: [{ one: 1 }] };
    if (sql.includes("SET status = 'active'")) {
      const error = new Error('duplicate key value violates unique constraint');
      error.code = '23505';
      throw error;
    }
    return { rows: [] };
  });
  assert.deepEqual(await api.approveClientGrant({ grantId: GRANT_ID, approvedBySubject: 'biz-owner-1' }), {
    ok: false,
    reason: 'active_grant_exists',
  });
});

test('revokeClientGrant revokes from either side and refuses outsiders and already-revoked grants', async () => {
  const activeRow = { ...grantRow, status: 'active' };
  const revokedRow = { ...activeRow, status: 'revoked', revoked_by_subject: 'firm-user-1', revoked_at: '2026-11-23T02:00:00Z' };
  const { api, calls } = setup(async (sql) => {
    if (sql.includes('FROM payrollcheck.client_grants')) return { rows: [activeRow] };
    if (sql.includes('FROM payrollcheck.memberships')) {
      // Revoker is a member of the firm tenant only.
      return { rows: [{ one: 1 }] };
    }
    if (sql.includes("SET status = 'revoked'")) return { rows: [revokedRow] };
    return { rows: [] };
  });
  const result = await api.revokeClientGrant({ grantId: GRANT_ID, revokedBySubject: 'firm-user-1' });
  assert.deepEqual(result, { ok: true, grant: revokedRow });

  const outsider = setup(async (sql) => {
    if (sql.includes('FROM payrollcheck.client_grants')) return { rows: [activeRow] };
    if (sql.includes('FROM payrollcheck.memberships')) return { rows: [] };
    return { rows: [] };
  });
  assert.deepEqual(await outsider.api.revokeClientGrant({ grantId: GRANT_ID, revokedBySubject: 'outsider' }), {
    ok: false,
    reason: 'revoker_not_member',
  });
  assert.equal(outsider.calls.filter((c) => c.sql.includes("SET status = 'revoked'")).length, 0);

  const already = setup(async (sql) => {
    if (sql.includes('FROM payrollcheck.client_grants')) return { rows: [revokedRow] };
    return { rows: [] };
  });
  assert.deepEqual(await already.api.revokeClientGrant({ grantId: GRANT_ID, revokedBySubject: 'firm-user-1' }), {
    ok: false,
    reason: 'already_revoked',
  });
});

test('getClientGrant returns the row or null; listActiveGrantsForBusiness returns active rows', async () => {
  const found = setup(async () => ({ rows: [grantRow] }));
  assert.deepEqual(await found.api.getClientGrant({ grantId: GRANT_ID }), grantRow);
  const missing = setup(async () => ({ rows: [] }));
  assert.equal(await missing.api.getClientGrant({ grantId: GRANT_ID }), null);
  assert.equal(await missing.api.getClientGrant({ grantId: 'bad' }), null);
  const failing = setup(async () => {
    throw new Error('db down');
  });
  assert.equal(await failing.api.getClientGrant({ grantId: GRANT_ID }), null);
  assert.deepEqual(await failing.api.listActiveGrantsForBusiness({ businessTenantId: BUSINESS_TENANT_ID }), []);
  assert.deepEqual(await failing.api.listActiveGrantsForBusiness({ businessTenantId: 'bad' }), []);
  const listed = setup(async () => ({ rows: [grantRow, { ...grantRow, grant_id: '88888888-8888-4888-8888-888888888888' }] }));
  const grants = await listed.api.listActiveGrantsForBusiness({ businessTenantId: BUSINESS_TENANT_ID });
  assert.equal(grants.length, 2);
});

// --- Access audit -----------------------------------------------------

test('recordAccessAudit inserts the row with a null report id allowed', async () => {
  const auditRow = {
    event_id: GENERATED_ID,
    request_id: 'req-1',
    actor_subject_id: 'usr_generatedsubject01',
    report_id: null,
    action: 'view_report',
    allowed: false,
    reason: 'mfa_required',
    occurred_at: '2026-11-23T00:00:00Z',
  };
  const { api, calls } = setup(async () => ({ rows: [auditRow] }));
  const result = await api.recordAccessAudit({
    requestId: 'req-1',
    actorSubjectId: 'usr_generatedsubject01',
    reportId: null,
    action: 'view_report',
    allowed: false,
    reason: 'mfa_required',
  });
  assert.deepEqual(result, auditRow);
  const insert = findCall(calls, 'INSERT INTO payrollcheck.access_audit');
  assert.equal(insert.values[3], null);
  assert.equal(insert.values[4], 'view_report');
});

test('recordAccessAudit validates action, reason, actor, and request id', async () => {
  const { api } = setup(async () => ({ rows: [{}] }));
  const base = { requestId: 'req-1', actorSubjectId: 'user-1', reportId: REPORT_ID, action: 'view_report', allowed: true, reason: 'ok' };
  await assert.rejects(() => api.recordAccessAudit({ ...base, action: 'delete_report' }), /action_must_be_one_of/);
  await assert.rejects(() => api.recordAccessAudit({ ...base, reason: '' }), /reason_must_be_a_non_empty_string/);
  await assert.rejects(() => api.recordAccessAudit({ ...base, reason: 'x'.repeat(257) }), /reason_must_be_a_non_empty_string/);
  await assert.rejects(() => api.recordAccessAudit({ ...base, actorSubjectId: 'bad subject!' }), /actor_subject_id_must_match/);
  await assert.rejects(() => api.recordAccessAudit({ ...base, requestId: '' }), /request_id_must_be_a_non_empty_string/);
  await assert.rejects(() => api.recordAccessAudit({ ...base, allowed: 'yes' }), /allowed_must_be_a_boolean/);
});

test('recordAccessAudit accepts tax_center_read (Slice 5 Tax Center)', async () => {
  const { api, calls } = setup(async () => ({ rows: [{}] }));
  await api.recordAccessAudit({
    requestId: 'req-1',
    actorSubjectId: 'user-1',
    reportId: null,
    action: 'tax_center_read',
    allowed: true,
    reason: 'allowed',
  });
  const insert = findCall(calls, 'INSERT INTO payrollcheck.access_audit');
  assert.equal(insert.values[4], 'tax_center_read');
});
