import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  setRlsIdentity,
  clearRlsIdentity,
} from '../src/payrollcheck/payrollcheck-rls-identity.mjs';

const AUTH_USER_ID = '11111111-2222-3333-4444-555555555555';

function stubQuery(impl = async () => ({ rows: [{}] })) {
  const calls = [];
  const query = async (sql, values) => {
    calls.push({ sql, values });
    return impl(sql, values);
  };
  return { calls, query };
}

test('setRlsIdentity sets all three GUCs transaction-local in one statement', async () => {
  const { calls, query } = stubQuery();
  const result = await setRlsIdentity({
    query,
    subjectId: 'usr_owner01',
    authUserId: AUTH_USER_ID,
    sessionId: 'sess-abc123',
  });
  assert.deepEqual(result, {
    ok: true,
    set: [
      'payrollcheck.current_subject_id',
      'payrollcheck.current_auth_user_id',
      'payrollcheck.current_session_id',
    ],
  });
  assert.equal(calls.length, 1);
  assert.equal(
    calls[0].sql,
    "SELECT set_config('payrollcheck.current_subject_id', $1, true), " +
      "set_config('payrollcheck.current_auth_user_id', $2, true), " +
      "set_config('payrollcheck.current_session_id', $3, true)",
  );
  assert.deepEqual(calls[0].values, ['usr_owner01', AUTH_USER_ID, 'sess-abc123']);
});

test('setRlsIdentity sets only the supplied GUCs (login/mapping path: auth user only)', async () => {
  const { calls, query } = stubQuery();
  const result = await setRlsIdentity({ query, authUserId: AUTH_USER_ID });
  assert.deepEqual(result, { ok: true, set: ['payrollcheck.current_auth_user_id'] });
  assert.equal(
    calls[0].sql,
    "SELECT set_config('payrollcheck.current_auth_user_id', $1, true)",
  );
  assert.deepEqual(calls[0].values, [AUTH_USER_ID]);
});

test('setRlsIdentity sets subject + auth without a session id', async () => {
  const { calls, query } = stubQuery();
  await setRlsIdentity({ query, subjectId: 'usr_owner01', authUserId: AUTH_USER_ID });
  assert.equal(
    calls[0].sql,
    "SELECT set_config('payrollcheck.current_subject_id', $1, true), " +
      "set_config('payrollcheck.current_auth_user_id', $2, true)",
  );
  assert.deepEqual(calls[0].values, ['usr_owner01', AUTH_USER_ID]);
});

test('setRlsIdentity rejects bad values before any query runs', async () => {
  const { calls, query } = stubQuery();
  await assert.rejects(
    () => setRlsIdentity({ query, subjectId: 'bad subject!' }),
    /subjectId_must_match_\[A-Za-z0-9_-\]\{1,64\}/,
  );
  await assert.rejects(
    () => setRlsIdentity({ query, subjectId: '' }),
    /subjectId_must_match/,
  );
  await assert.rejects(
    () => setRlsIdentity({ query, authUserId: 'not-a-uuid' }),
    /auth_user_id_must_be_a_uuid/,
  );
  await assert.rejects(
    () => setRlsIdentity({ query, sessionId: 'bad session!' }),
    /sessionId_must_match/,
  );
  await assert.rejects(
    () => setRlsIdentity({ query, subjectId: 'x'.repeat(65) }),
    /subjectId_must_match/,
  );
  await assert.rejects(
    () => setRlsIdentity({ query }),
    /at_least_one_identity_value_required/,
  );
  await assert.rejects(
    () => setRlsIdentity({ subjectId: 'usr_owner01' }),
    /query_required/,
  );
  assert.equal(calls.length, 0);
});

test('setRlsIdentity propagates a store error (caller must abort the request)', async () => {
  const { query } = stubQuery(async () => {
    throw new Error('connection refused');
  });
  await assert.rejects(
    () => setRlsIdentity({ query, authUserId: AUTH_USER_ID }),
    /connection refused/,
  );
});

test('clearRlsIdentity resets all three GUCs to empty', async () => {
  const { calls, query } = stubQuery();
  const result = await clearRlsIdentity({ query });
  assert.deepEqual(result, { ok: true });
  assert.equal(calls.length, 1);
  assert.equal(
    calls[0].sql,
    "SELECT set_config('payrollcheck.current_subject_id', '', true), " +
      "set_config('payrollcheck.current_auth_user_id', '', true), " +
      "set_config('payrollcheck.current_session_id', '', true)",
  );
  assert.deepEqual(calls[0].values, undefined);
  await assert.rejects(() => clearRlsIdentity({}), /query_required/);
});
