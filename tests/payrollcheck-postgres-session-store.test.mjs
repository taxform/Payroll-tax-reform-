// Tests for postgres-session-store.mjs — fully offline. The database is a
// stubbed query function that captures SQL + values. No live Postgres.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createPostgresSessionStore} from '../src/payrollcheck/postgres-session-store.mjs';

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
  assert.equal(calls.length, 1);
  assert.match(calls[0].sql, /INSERT INTO payrollcheck\.sessions/);
  assert.match(calls[0].sql, /ON CONFLICT \(session_id\) DO UPDATE SET/);
  assert.match(calls[0].sql, /last_seen_at = EXCLUDED\.last_seen_at/);
  const values = calls[0].values;
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
  await store.deleteByUserId(USER_ID);
  assert.match(calls[1].sql, /DELETE FROM payrollcheck\.sessions WHERE user_id = \$1::text/);
  assert.deepEqual(calls[1].values, [USER_ID]);
  await store.delete('bad id!!');
  await store.deleteByUserId('bad id!!');
  assert.equal(calls.length, 2);
});

test('rejects a bad factory config', () => {
  assert.throws(() => createPostgresSessionStore({}), TypeError);
  assert.throws(() => createPostgresSessionStore(), TypeError);
});
