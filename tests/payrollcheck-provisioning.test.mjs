import { test } from 'node:test';
import assert from 'node:assert/strict';
import { provisionTenantUser } from '../src/payrollcheck/payrollcheck-provisioning.mjs';

const TENANT_ID = '11111111-1111-4111-8111-111111111111';
const AUTH_USER_ID = '22222222-2222-4222-8222-222222222222';

const membershipRow = {
  membership_id: '33333333-3333-4333-8333-333333333333',
  tenant_id: TENANT_ID,
  subject_id: 'usr_generatedsubject01',
  auth_user_id: AUTH_USER_ID,
  role: 'business_owner',
  active: true,
};

function setup({ createResult, membershipResult, membershipError, deleteError } = {}) {
  const calls = { create: [], membership: [], del: [] };
  const createAuthUser = async (args) => {
    calls.create.push(args);
    if (createResult instanceof Error) throw createResult;
    return createResult ?? { id: AUTH_USER_ID, email: 'owner@example.test' };
  };
  const deleteAuthUser = async (args) => {
    calls.del.push(args);
    if (deleteError) throw deleteError;
    return { ok: true };
  };
  const provisionMembership = async (args) => {
    calls.membership.push(args);
    if (membershipError) throw membershipError;
    return membershipResult ?? { ok: true, membership: membershipRow };
  };
  return { calls, createAuthUser, deleteAuthUser, provisionMembership };
}

const baseArgs = (overrides = {}) => ({
  tenantId: TENANT_ID,
  email: 'owner@example.test',
  role: 'business_owner',
  ...overrides,
});

test('provisionTenantUser creates the Auth user then the membership and returns both', async () => {
  const { calls, ...deps } = setup();
  const result = await provisionTenantUser({ ...deps, ...baseArgs({ password: 'correct horse' }) });
  assert.deepEqual(result, { ok: true, authUserId: AUTH_USER_ID, membership: membershipRow });
  assert.equal(calls.create.length, 1);
  assert.equal(calls.create[0].email, 'owner@example.test');
  assert.equal(calls.create[0].password, 'correct horse');
  assert.equal(calls.create[0].emailConfirm, true);
  assert.equal(calls.membership.length, 1);
  assert.equal(calls.membership[0].tenantId, TENANT_ID);
  assert.equal(calls.membership[0].authUserId, AUTH_USER_ID);
  assert.equal(calls.membership[0].role, 'business_owner');
  assert.equal(calls.del.length, 0);
});

test('provisionTenantUser omits the password by default (invite path)', async () => {
  const { calls, ...deps } = setup();
  await provisionTenantUser({ ...deps, ...baseArgs() });
  assert.equal('password' in calls.create[0], false);
});

test('provisionTenantUser rolls back the Auth user on a duplicate membership', async () => {
  const { calls, ...deps } = setup({ membershipResult: { ok: false, reason: 'duplicate_auth_user_id' } });
  const result = await provisionTenantUser({ ...deps, ...baseArgs() });
  assert.deepEqual(result, { ok: false, reason: 'duplicate_auth_user_id', rolledBack: true });
  assert.equal(calls.del.length, 1);
  assert.equal(calls.del[0].authUserId, AUTH_USER_ID);
});

test('provisionTenantUser rolls back the Auth user when the membership write throws', async () => {
  const { calls, ...deps } = setup({ membershipError: new Error('connection refused') });
  const result = await provisionTenantUser({ ...deps, ...baseArgs() });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'membership_failed');
  assert.equal(result.detail, 'connection refused');
  assert.equal(result.rolledBack, true);
  assert.equal(calls.del.length, 1);
});

test('provisionTenantUser reports a failed rollback instead of hiding it', async () => {
  const { ...deps } = setup({
    membershipResult: { ok: false, reason: 'duplicate_subject_id' },
    deleteError: new Error('admin api down'),
  });
  const result = await provisionTenantUser({ ...deps, ...baseArgs() });
  assert.deepEqual(result, { ok: false, reason: 'duplicate_subject_id', rolledBack: false });
});

test('provisionTenantUser reports Auth user creation failure and never touches memberships', async () => {
  const { calls, ...deps } = setup({ createResult: new Error('email already registered') });
  const result = await provisionTenantUser({ ...deps, ...baseArgs() });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'auth_user_creation_failed');
  assert.equal(result.detail, 'email already registered');
  assert.equal(calls.membership.length, 0);
  assert.equal(calls.del.length, 0);
});

test('provisionTenantUser validates inputs before any call', async () => {
  const { calls, ...deps } = setup();
  await assert.rejects(() => provisionTenantUser({ ...deps, ...baseArgs({ tenantId: 'x' }) }), /tenant_id_must_be_a_uuid/);
  await assert.rejects(() => provisionTenantUser({ ...deps, ...baseArgs({ role: 'super_admin' }) }), /role_must_be_one_of/);
  await assert.rejects(() => provisionTenantUser({ ...deps, ...baseArgs({ subjectId: 'bad subject!' }) }), /subject_id_must_match/);
  await assert.rejects(() => provisionTenantUser({ ...deps, ...baseArgs({ email: '' }) }), /email_must_be_a_non_empty_string/);
  assert.equal(calls.create.length, 0);
  assert.equal(calls.membership.length, 0);
});
