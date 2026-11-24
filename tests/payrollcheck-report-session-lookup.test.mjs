import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createReportSessionLookup } from '../src/payrollcheck/payrollcheck-report-session-lookup.mjs';

function makeStore(rows = {}) {
  const byId = new Map(Object.entries(rows));
  const calls = [];
  return {
    calls,
    get: async (id) => {
      calls.push(['get', id]);
      return byId.get(id) ?? null;
    },
    getByPreviousSessionId: async (id) => {
      calls.push(['getByPrevious', id]);
      for (const row of byId.values()) {
        if (row.previousSessionId === id) return row;
      }
      return null;
    },
  };
}

const CURRENT = {
  sessionId: 'sess_current_aaa',
  previousSessionId: 'sess_prev_aaa',
  graceUntil: 1794000600,
  userId: 'usr_ownerA',
  authUserId: '11111111-aaaa-4111-8111-111111111111',
  aal2: true,
  createdAt: 1793999000,
  rotatedAt: 1793999900,
  lastSeenAt: 1794000000,
  expiresAt: 1794043200,
  revoked: false,
};

test('factory requires a store with both lookups', () => {
  assert.throws(() => createReportSessionLookup({}), /session_store_required/);
  assert.throws(() => createReportSessionLookup({ store: { get: async () => null } }), /session_store_required/);
});

test('current session id resolves by the current lookup, without the previous lookup', async () => {
  const store = makeStore({ [CURRENT.sessionId]: CURRENT });
  const lookup = createReportSessionLookup({ store });
  const result = await lookup.getSession(CURRENT.sessionId);
  assert.equal(result, CURRENT);
  assert.deepEqual(store.calls, [['get', CURRENT.sessionId]]);
});

test('previous session id resolves via the previous lookup — the grace case', async () => {
  // This is the bug step 9 fixes: binding store.get directly would
  // return null here and the step-8 handler would deny unknown_session
  // even though the session is live inside its grace window.
  const store = makeStore({ [CURRENT.sessionId]: CURRENT });
  const lookup = createReportSessionLookup({ store });
  const result = await lookup.getSession(CURRENT.previousSessionId);
  assert.equal(result, CURRENT);
  assert.deepEqual(store.calls, [
    ['get', CURRENT.previousSessionId],
    ['getByPrevious', CURRENT.previousSessionId],
  ]);
});

test('unknown id returns null after both lookups', async () => {
  const store = makeStore({ [CURRENT.sessionId]: CURRENT });
  const lookup = createReportSessionLookup({ store });
  assert.equal(await lookup.getSession('sess_nope'), null);
});

test('store errors propagate (the handler fails closed on them)', async () => {
  const store = {
    get: async () => {
      throw new Error('db down');
    },
    getByPreviousSessionId: async () => null,
  };
  const lookup = createReportSessionLookup({ store });
  await assert.rejects(() => lookup.getSession('sess_x'), /db down/);
});

test('the returned record is already camelCase — no column mapping is needed', async () => {
  // Regression guard for the step-8 handoff note: the step-4b store's
  // toRecord converts timestamptz/snake_case to camelCase epoch fields.
  // This lookup must pass the record through untouched.
  const store = makeStore({ [CURRENT.sessionId]: CURRENT });
  const lookup = createReportSessionLookup({ store });
  const result = await lookup.getSession(CURRENT.sessionId);
  assert.equal(result.sessionId, 'sess_current_aaa');
  assert.equal(result.previousSessionId, 'sess_prev_aaa');
  assert.equal(result.graceUntil, 1794000600);
  assert.equal(result.authUserId, '11111111-aaaa-4111-8111-111111111111');
  assert.equal('session_id' in result, false);
  assert.equal('auth_user_id' in result, false);
});
