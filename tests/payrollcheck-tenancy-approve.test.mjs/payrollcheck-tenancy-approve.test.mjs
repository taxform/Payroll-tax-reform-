import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPayrollcheckTenancy } from '../src/payrollcheck/payrollcheck-tenancy.mjs';

// Step-8 tightening of approveClientGrant (m2-step8-design.md §7): the
// step-7 policy requires the approver to be an active business_owner of
// the business tenant AND never the requester. The step-6 module
// approved for any active business member with no self-approve check.
// These tests prove the module now denies both cases at the module
// layer — before the database ever sees the UPDATE — with distinct
// reasons, and that the happy path still works.

const FIRM_TENANT_ID = '22222222-2222-4222-8222-222222222222';
const BUSINESS_TENANT_ID = '33333333-3333-4333-8333-333333333333';
const GRANT_ID = '55555555-5555-4555-8555-555555555555';
const GENERATED_ID = '77777777-7777-4777-8777-777777777777';

const PENDING_GRANT = {
  grant_id: GRANT_ID,
  firm_tenant_id: FIRM_TENANT_ID,
  business_tenant_id: BUSINESS_TENANT_ID,
  scopes: ['view_report'],
  status: 'pending',
  requested_by_subject: 'usr_firmrequester',
  approved_by_subject: null,
  revoked_by_subject: null,
  requested_at: '2026-11-20T00:00:00Z',
  approved_at: null,
  revoked_at: null,
};

// roles: subject -> active role in the business tenant (null = no membership)
function setup(rolesInBusiness = {}) {
  const calls = [];
  const query = async (sql, values) => {
    calls.push({ sql, values });
    // getClientGrant lookup.
    if (sql.includes('FROM payrollcheck.client_grants WHERE grant_id')) {
      return { rows: [{ ...PENDING_GRANT }] };
    }
    // getActiveMembershipRole lookup (step-8 helper).
    if (sql.includes('SELECT role FROM payrollcheck.memberships')) {
      const subject = values[1];
      const role = rolesInBusiness[subject] ?? null;
      return { rows: role ? [{ role }] : [] };
    }
    // isActiveMember lookups (other grant flows) — not used here.
    if (sql.includes('SELECT 1 AS one FROM payrollcheck.memberships')) {
      return { rows: [] };
    }
    // The approve UPDATE.
    if (sql.includes("UPDATE payrollcheck.client_grants SET status = 'active'")) {
      return {
        rows: [
          {
            ...PENDING_GRANT,
            status: 'active',
            approved_by_subject: values[1],
            approved_at: '2026-11-23T00:00:00Z',
          },
        ],
      };
    }
    throw new Error(`unexpected query: ${sql}`);
  };
  const api = createPayrollcheckTenancy({
    query,
    generateId: () => GENERATED_ID,
    generateSubjectId: () => 'usr_generatedsubject01',
  });
  const updateCalls = () =>
    calls.filter((c) => c.sql.includes('UPDATE payrollcheck.client_grants'));
  return { api, calls, updateCalls };
}

test('non-owner business member (accounting_admin) cannot approve: not_business_owner, no UPDATE', async () => {
  const { api, updateCalls } = setup({ usr_staffmember: 'accounting_admin' });
  const result = await api.approveClientGrant({
    grantId: GRANT_ID,
    approvedBySubject: 'usr_staffmember',
  });
  assert.deepEqual(result, { ok: false, reason: 'not_business_owner' });
  assert.equal(updateCalls().length, 0);
});

test('non-owner business member (accounting_reviewer) cannot approve either', async () => {
  const { api, updateCalls } = setup({ usr_reviewer: 'accounting_reviewer' });
  const result = await api.approveClientGrant({
    grantId: GRANT_ID,
    approvedBySubject: 'usr_reviewer',
  });
  assert.deepEqual(result, { ok: false, reason: 'not_business_owner' });
  assert.equal(updateCalls().length, 0);
});

test('self-approving business_owner is denied: self_approve, no UPDATE', async () => {
  // The requester (usr_firmrequester) is also a business_owner of the
  // business tenant — a dual member approving their own request.
  const { api, updateCalls } = setup({ usr_firmrequester: 'business_owner' });
  const result = await api.approveClientGrant({
    grantId: GRANT_ID,
    approvedBySubject: 'usr_firmrequester',
  });
  assert.deepEqual(result, { ok: false, reason: 'self_approve' });
  assert.equal(updateCalls().length, 0);
});

test('business_owner approving someone else’s request still works (happy path)', async () => {
  const { api, updateCalls } = setup({ usr_owner: 'business_owner' });
  const result = await api.approveClientGrant({
    grantId: GRANT_ID,
    approvedBySubject: 'usr_owner',
  });
  assert.equal(result.ok, true);
  assert.equal(result.grant.status, 'active');
  assert.equal(result.grant.approved_by_subject, 'usr_owner');
  assert.equal(updateCalls().length, 1);
  // The UPDATE still carries the pending-only guard (concurrency).
  assert.ok(updateCalls()[0].sql.includes("AND status = 'pending'"));
});

test('approver with no business membership is still approver_not_member', async () => {
  const { api, updateCalls } = setup({});
  const result = await api.approveClientGrant({
    grantId: GRANT_ID,
    approvedBySubject: 'usr_outsider',
  });
  assert.deepEqual(result, { ok: false, reason: 'approver_not_member' });
  assert.equal(updateCalls().length, 0);
});

test('role is checked before self-approve: non-owner requester gets not_business_owner', async () => {
  // The requester is a business accounting_admin, not an owner.
  const { api, updateCalls } = setup({ usr_firmrequester: 'accounting_admin' });
  const result = await api.approveClientGrant({
    grantId: GRANT_ID,
    approvedBySubject: 'usr_firmrequester',
  });
  assert.deepEqual(result, { ok: false, reason: 'not_business_owner' });
  assert.equal(updateCalls().length, 0);
});

test('role-lookup DB error propagates (admin-write fail-closed split)', async () => {
  const query = async (sql) => {
    if (sql.includes('FROM payrollcheck.client_grants WHERE grant_id')) {
      return { rows: [{ ...PENDING_GRANT }] };
    }
    if (sql.includes('SELECT role FROM payrollcheck.memberships')) {
      throw new Error('db down');
    }
    throw new Error(`unexpected query: ${sql}`);
  };
  const api = createPayrollcheckTenancy({
    query,
    generateId: () => GENERATED_ID,
    generateSubjectId: () => 'usr_generatedsubject01',
  });
  await assert.rejects(
    () => api.approveClientGrant({ grantId: GRANT_ID, approvedBySubject: 'usr_owner' }),
    /db down/,
  );
});

test('not_pending and not_found reasons are unchanged', async () => {
  // not_found: grant lookup returns no row.
  const noGrantQuery = async (sql) => {
    if (sql.includes('FROM payrollcheck.client_grants WHERE grant_id')) return { rows: [] };
    throw new Error(`unexpected query: ${sql}`);
  };
  const noGrantApi = createPayrollcheckTenancy({
    query: noGrantQuery,
    generateId: () => GENERATED_ID,
    generateSubjectId: () => 'usr_generatedsubject01',
  });
  assert.deepEqual(
    await noGrantApi.approveClientGrant({ grantId: GRANT_ID, approvedBySubject: 'usr_owner' }),
    { ok: false, reason: 'not_found' },
  );

  // not_pending: grant is already active.
  const activeQuery = async (sql) => {
    if (sql.includes('FROM payrollcheck.client_grants WHERE grant_id')) {
      return { rows: [{ ...PENDING_GRANT, status: 'active' }] };
    }
    throw new Error(`unexpected query: ${sql}`);
  };
  const activeApi = createPayrollcheckTenancy({
    query: activeQuery,
    generateId: () => GENERATED_ID,
    generateSubjectId: () => 'usr_generatedsubject01',
  });
  assert.deepEqual(
    await activeApi.approveClientGrant({ grantId: GRANT_ID, approvedBySubject: 'usr_owner' }),
    { ok: false, reason: 'not_pending' },
  );
});
