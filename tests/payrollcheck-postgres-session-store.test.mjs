// Tests for postgres-session-store.mjs — fully offline. The database is a
// stubbed query function that captures SQL + values. No live Postgres.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createPostgresSessionStore} from '../src/payrollcheck/postgres-session-store.mjs';
import {setRlsIdentity} from '../src/payrollcheck/payrollcheck-rls-identity.mjs';

const SESSION_ID = 'sess-a-000000000000000000000000000001';
const PREVIOUS_ID = 'sess-old-0000000000000000000000000001';
const USER_ID = 'owner1';
const AUTH_USER_ID = '11111111-1111-4111-8111-111111111111';
const T0 = 1767225600; // 2026-01-01T00:00:00Z

function row(overrides = {}) {
  return {
    session_id: SESSION_ID,
    previous_session_id: null,
    grace_until: null,
    user_id: USER_ID,
    auth_user_id: AUTH_USER_ID,
    aal2: true,
    created_at: new Date(T0 * 1000),
    rotated_at: new Date(T0 * 1000),
    last_seen_at: new Date(T0 * 1000),
    expires_at: new Date((T0 + 43200) * 1000),
    revoked: false,
    ...overrides,
  };
}

function record(overrides = {}) {
  return {
    sessionId: SESSION_ID,
    previousSessionId: null,
    graceUntil: null,
    userId: USER_ID,
    authUserId: AUTH_USER_ID,
    aal2: true,
    createdAt: T0,
    rotatedAt: T0,
    lastSeenAt: T0,
    expiresAt: T0 + 43200,
    revoked: false,
    ...overrides,
  };
}

function storeFor(rows, calls = []) {
  const query = async (sql, values) => {
    calls.push({sql, values});
    return {rows};
  };
  return {calls, store: createPostgresSessionStore({query})};
}

// RLS mirror for payrollcheck.sessions — the write side only. It mirrors
// docs/sql/payrollcheck-rls-policies.sql (confirmed live on
// payrollcheck-360-dev on 2026-11-24): an INSERT ... ON CONFLICT DO UPDATE is
// checked against BOTH app_sessions_insert WITH CHECK and app_sessions_update
// WITH CHECK, and both require user_id = current_subject_id AND
// auth_user_id = current_auth_user_id. A caller that only holds the presented
// session id (the report path after PR #114) is therefore denied the upsert
// unless the identity is completed from the row itself first (root cause #6).
// Reads stay ungated here: the read side is covered by the #114 tests in
// payrollcheck-auth-composition.test.mjs.
function rlsMirroringQuery() {
  const calls = [];
  const identity = {subjectId: null, authUserId: null, sessionId: null};
  async function query(sql, values = []) {
    calls.push({sql, values});
    if (sql.includes('set_config(')) {
      // setRlsIdentity issues one SELECT with a set_config per supplied GUC,
      // in subject, auth, session order; the values line up in that order.
      const names = [];
      for (const key of ['subject_id', 'auth_user_id', 'session_id']) {
        if (sql.includes('current_' + key)) names.push(key);
      }
      names.forEach((name, index) => {
        if (name === 'subject_id') identity.subjectId = values[index];
        if (name === 'auth_user_id') identity.authUserId = values[index];
        if (name === 'session_id') identity.sessionId = values[index];
      });
      return {rows: []};
    }
    if (sql.includes('INSERT INTO payrollcheck.sessions')) {
      const userId = values[3];
      const authUserId = values[4];
      if (identity.subjectId !== userId || identity.authUserId !== authUserId) {
        const error = new Error(
          'new row violates row-level security policy "app_sessions_insert" for table "sessions"',
        );
        error.code = '42501';
        throw error;
      }
      return {rows: []};
    }
    throw new Error('unexpected SQL in the RLS mirror: ' + sql);
  }
  return {query, calls, identity};
}

test('get returns the mapped record and converts timestamps to epoch seconds', async () => {
  const {store, calls} = storeFor([row()]);
  const found = await store.get(SESSION_ID);
  assert.equal(found.sessionId, SESSION_ID);
  assert.equal(found.previousSessionId, null);
  assert.equal(found.graceUntil, null);
  assert.equal(found.userId, USER_ID);
  assert.equal(found.authUserId, AUTH_USER_ID);
  assert.equal(found.aal2, true);
  assert.equal(found.createdAt, T0);
  assert.equal(found.expiresAt, T0 + 43200);
  assert.equal(found.revoked, false);
  assert.equal(calls.length, 1);
  assert.match(calls[0].sql, /FROM payrollcheck\.sessions WHERE session_id = \$1::text LIMIT 2/);
  assert.deepEqual(calls[0].values, [SESSION_ID]);
});

test('get accepts ISO-string timestamps and a previous id with grace', async () => {
  const {store} = storeFor([
    row({
      previous_session_id: PREVIOUS_ID,
      grace_until: '2026-01-01T00:01:00.000Z',
    }),
  ]);
  const found = await store.get(SESSION_ID);
  assert.equal(found.previousSessionId, PREVIOUS_ID);
  assert.equal(found.graceUntil, T0 + 60);
});

test('getByPreviousSessionId queries the previous id', async () => {
  const {store, calls} = storeFor([row({previous_session_id: PREVIOUS_ID})]);
  const found = await store.getByPreviousSessionId(PREVIOUS_ID);
  assert.equal(found.sessionId, SESSION_ID);
  assert.match(calls[0].sql, /WHERE previous_session_id = \$1::text LIMIT 2/);
  assert.deepEqual(calls[0].values, [PREVIOUS_ID]);
});

test('get returns null for missing rows, duplicates, corrupt rows, and bad ids', async () => {
  const {store} = storeFor([]);
  assert.equal(await store.get(SESSION_ID), null);
  const {store: store2} = storeFor([row(), row()]);
  assert.equal(await store2.get(SESSION_ID), null);
  const {store: store3} = storeFor([row({user_id: 'owner@example.com'})]);
  assert.equal(await store3.get(SESSION_ID), null);
  const {store: store4} = storeFor([row({created_at: 'not-a-date'})]);
  assert.equal(await store4.get(SESSION_ID), null);
  const calls = [];
  const {store: store5} = storeFor([row()], calls);
  assert.equal(await store5.get('not-a-valid-id!!'), null);
  assert.equal(calls.length, 0);
});

test('get propagates database errors', async () => {
  const query = async () => {
    throw new Error('database down');
  };
  const store = createPostgresSessionStore({query});
  await assert.rejects(() => store.get(SESSION_ID), /database down/);
});

test('set upserts all eleven columns in order', async () => {
  const {store, calls} = storeFor([]);
  await store.set(record({previousSessionId: PREVIOUS_ID, graceUntil: T0 + 60}));
  // set() completes the RLS identity from the record first (root cause #6):
  // the set_config call carries the record's own subject/auth/session, then
  // the upsert runs.
  assert.equal(calls.length, 2);
  assert.ok(calls[0].sql.includes("set_config('payrollcheck.current_subject_id'"));
  assert.deepEqual(calls[0].values, [USER_ID, AUTH_USER_ID, SESSION_ID]);
  assert.match(calls[1].sql, /INSERT INTO payrollcheck\.sessions/);
  assert.match(calls[1].sql, /ON CONFLICT \(session_id\) DO UPDATE SET/);
  assert.match(calls[1].sql, /last_seen_at = EXCLUDED\.last_seen_at/);
  const values = calls[1].values;
  assert.equal(values[0], SESSION_ID);
  assert.equal(values[1], PREVIOUS_ID);
  assert.ok(values[2] instanceof Date && values[2].getTime() === (T0 + 60) * 1000);
  assert.equal(values[3], USER_ID);
  assert.equal(values[4], AUTH_USER_ID);
  assert.equal(values[5], true);
  assert.ok(values[6] instanceof Date && values[6].getTime() === T0 * 1000);
  assert.ok(values[9] instanceof Date && values[9].getTime() === (T0 + 43200) * 1000);
  assert.equal(values[10], false);
});

test('set rejects a malformed record without querying', async () => {
  const calls = [];
  const {store} = storeFor([], calls);
  await assert.rejects(() => store.set(record({sessionId: 'bad id!!'})), TypeError);
  await assert.rejects(() => store.set(record({expiresAt: 'soon'})), TypeError);
  assert.equal(calls.length, 0);
});

test('delete and deleteByUserId run parameterized deletes', async () => {
  const {store, calls} = storeFor([]);
  await store.delete(SESSION_ID);
  assert.match(calls[0].sql, /DELETE FROM payrollcheck\.sessions WHERE session_id = \$1::text/);
  assert.deepEqual(calls[0].values, [SESSION_ID]);
  const deleted = await store.deleteByUserId(USER_ID);
  assert.match(calls[1].sql, /DELETE FROM payrollcheck\.sessions WHERE user_id = \$1::text/);
  assert.deepEqual(calls[1].values, [USER_ID]);
  assert.equal(deleted, 0);
  await store.delete('bad id!!');
  await store.deleteByUserId('bad id!!');
  assert.equal(calls.length, 2);
});

test('deleteByUserId returns the deleted row count', async () => {
  const {store} = storeFor([{session_id: 'sess-a'}, {session_id: 'sess-b'}]);
  assert.equal(await store.deleteByUserId(USER_ID), 2);
});

test('rejects a bad factory config', () => {
  assert.throws(() => createPostgresSessionStore({}), TypeError);
  assert.throws(() => createPostgresSessionStore(), TypeError);
});

test('set completes the RLS identity from the record before the upsert (root cause #6)', async () => {
  const fake = rlsMirroringQuery();
  // The report path after PR #114: only the presented session id is set
  // before load(), so the write-back runs under a session-only identity.
  await setRlsIdentity({query: fake.query, sessionId: SESSION_ID});
  const store = createPostgresSessionStore({query: fake.query});
  await store.set(record());
  // The upsert ran: under a session-only identity it is denied by RLS
  // (42501) unless set() completes the identity from the record first.
  const identityCall = fake.calls.find((call) => call.sql.includes("set_config('payrollcheck.current_subject_id'"));
  assert.ok(identityCall, 'set() should complete the RLS identity before the upsert');
  assert.deepEqual(identityCall.values, [USER_ID, AUTH_USER_ID, SESSION_ID]);
  const upsert = fake.calls.find((call) => call.sql.includes('INSERT INTO payrollcheck.sessions'));
  assert.ok(upsert, 'the upsert should run after the identity is completed');
  assert.ok(fake.calls.indexOf(upsert) > fake.calls.indexOf(identityCall));
  assert.equal(fake.identity.subjectId, USER_ID);
  assert.equal(fake.identity.authUserId, AUTH_USER_ID);
  assert.equal(fake.identity.sessionId, SESSION_ID);
});

test('set keeps working when the caller already set a full identity (sign-in path)', async () => {
  const fake = rlsMirroringQuery();
  await setRlsIdentity({query: fake.query, subjectId: USER_ID, authUserId: AUTH_USER_ID, sessionId: SESSION_ID});
  const store = createPostgresSessionStore({query: fake.query});
  await store.set(record());
  assert.ok(fake.calls.some((call) => call.sql.includes('INSERT INTO payrollcheck.sessions')));
});

test('the RLS mirror denies the upsert under a session-only identity', async () => {
  const fake = rlsMirroringQuery();
  await setRlsIdentity({query: fake.query, sessionId: SESSION_ID});
  await assert.rejects(
    fake.query(
      'INSERT INTO payrollcheck.sessions (session_id, previous_session_id, grace_until, user_id, auth_user_id, aal2, created_at, rotated_at, last_seen_at, expires_at, revoked) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) ON CONFLICT (session_id) DO UPDATE SET last_seen_at = EXCLUDED.last_seen_at',
      [SESSION_ID, null, null, USER_ID, AUTH_USER_ID, true, new Date(T0 * 1000), new Date(T0 * 1000), new Date(T0 * 1000), new Date((T0 + 43200) * 1000), false],
    ),
    (error) => error.code === '42501' && error.message.includes('app_sessions_insert'),
  );
});
