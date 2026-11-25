// Tests for payrollcheck-server-session.mjs — fully offline. The session
// store is an in-memory Map; the clock is fake and advanced by hand. No live
// Supabase, no network, no real secrets (the secret here is a fake test value).
import test from 'node:test';
import assert from 'node:assert/strict';
import {createServerSession} from '../src/payrollcheck/payrollcheck-server-session.mjs';

const SECRET = 'test-session-secret-that-is-long-enough-1234';
const USER_ID = 'owner1';
const AUTH_USER_ID = '11111111-1111-4111-8111-111111111111';

function memoryStore() {
  const byId = new Map();
  return {
    async get(sessionId) {
      return byId.get(sessionId) ?? null;
    },
    async getByPreviousSessionId(sessionId) {
      for (const record of byId.values()) {
        if (record.previousSessionId === sessionId) return record;
      }
      return null;
    },
    async set(record) {
      byId.set(record.sessionId, {...record});
    },
    async delete(sessionId) {
      byId.delete(sessionId);
    },
    async deleteByUserId(userId) {
      let count = 0;
      for (const [sessionId, record] of byId.entries()) {
        if (record.userId === userId) {
          byId.delete(sessionId);
          count += 1;
        }
      }
      return count;
    },
    size() {
      return byId.size;
    },
  };
}

function setup() {
  let now = 1000000;
  const store = memoryStore();
  const sessions = createServerSession({store, secret: SECRET, clock: () => now});
  return {store, sessions, advance: (seconds) => { now += seconds; }, now: () => now};
}

async function issued(setupResult, overrides = {}) {
  const result = await setupResult.sessions.issue({userId: USER_ID, authUserId: AUTH_USER_ID, aal2: true, ...overrides});
  assert.ok(result, 'issue should succeed');
  return result;
}

test('issue returns a secure cookie and a verifiable CSRF token; load accepts it', async () => {
  const s = setup();
  const result = await issued(s);
  assert.match(result.cookie, /^__Host-payrollcheck-session=[A-Za-z0-9_-]+; HttpOnly; Secure; SameSite=Lax; Path=\/; Max-Age=43200$/);
  assert.equal(s.sessions.verifyCsrf(result.sessionId, result.csrfToken), true);
  const loaded = await s.sessions.load(result.cookie);
  assert.equal(loaded.ok, true);
  assert.equal(loaded.session.userId, USER_ID);
  assert.equal(loaded.session.authUserId, AUTH_USER_ID);
  assert.equal(loaded.session.aal2, true);
  assert.equal(loaded.rotated, false);
  assert.equal(loaded.csrfToken, result.csrfToken);
});

test('load rejects missing, unknown, and malformed cookies', async () => {
  const s = setup();
  assert.deepEqual(await s.sessions.load(''), {ok: false, reason: 'no_session'});
  assert.deepEqual(await s.sessions.load(null), {ok: false, reason: 'no_session'});
  assert.deepEqual(await s.sessions.load('other=abc'), {ok: false, reason: 'no_session'});
  assert.deepEqual(await s.sessions.load('__Host-payrollcheck-session=not-a-real-id'), {
    ok: false,
    reason: 'unknown_session',
  });
});

test('load enforces absolute expiry and idle timeout', async () => {
  const s = setup();
  const result = await issued(s);
  s.advance(12 * 3600);
  assert.deepEqual(await s.sessions.load(result.cookie), {ok: false, reason: 'expired'});

  const s2 = setup();
  let cookie = (await issued(s2)).cookie;
  s2.advance(29 * 60);
  let loaded = await s2.sessions.load(cookie);
  assert.equal(loaded.ok, true); // slides the idle window (and rotates: 29 min > 15 min)
  if (loaded.cookie) cookie = loaded.cookie; // follow the rotated cookie
  s2.advance(29 * 60);
  loaded = await s2.sessions.load(cookie);
  assert.equal(loaded.ok, true);
  if (loaded.cookie) cookie = loaded.cookie;
  s2.advance(31 * 60);
  assert.deepEqual(await s2.sessions.load(cookie), {ok: false, reason: 'idle_timeout'});
});

test('load rotates an old session and the previous id works inside the grace window only', async () => {
  const s = setup();
  const result = await issued(s);
  s.advance(16 * 60);
  const loaded = await s.sessions.load(result.cookie);
  assert.equal(loaded.ok, true);
  assert.equal(loaded.rotated, true);
  assert.notEqual(loaded.session.sessionId, result.sessionId);
  assert.ok(loaded.cookie.startsWith('__Host-payrollcheck-session='));
  // The old id still resolves to the NEW session inside the 60s grace window.
  const viaOld = await s.sessions.load(result.cookie);
  assert.equal(viaOld.ok, true);
  assert.equal(viaOld.session.sessionId, loaded.session.sessionId);
  // Past the grace window, the old id is denied; the new id still works.
  s.advance(61);
  assert.deepEqual(await s.sessions.load(result.cookie), {ok: false, reason: 'unknown_session'});
  assert.equal((await s.sessions.load(loaded.cookie)).ok, true);
});

test('revoke and revoke-all-for-user deny later loads', async () => {
  const s = setup();
  const first = await issued(s);
  const second = await issued(s);
  assert.equal(await s.sessions.revoke(first.sessionId), true);
  assert.deepEqual(await s.sessions.load(first.cookie), {ok: false, reason: 'unknown_session'});
  assert.equal((await s.sessions.load(second.cookie)).ok, true);
  assert.deepEqual(await s.sessions.revokeAllForUser(USER_ID), {ok: true, revoked: 1});
  assert.deepEqual(await s.sessions.load(second.cookie), {ok: false, reason: 'unknown_session'});
  assert.equal(s.store.size(), 0);
});

test('revokeAllForUser reports zero-row revocation as ok false', async () => {
  const s = setup();
  assert.deepEqual(await s.sessions.revokeAllForUser('nobody'), {ok: false, revoked: 0});
});

test('rotate issues a new id on demand and rejects bad ids', async () => {
  const s = setup();
  const result = await issued(s);
  const rotated = await s.sessions.rotate(result.sessionId);
  assert.ok(rotated);
  assert.notEqual(rotated.sessionId, result.sessionId);
  assert.equal((await s.sessions.load(rotated.cookie)).ok, true);
  assert.equal(await s.sessions.rotate('not-a-real-id'), null);
  assert.equal(await s.sessions.rotate(result.sessionId), null); // old id is gone
});

test('CSRF verification rejects wrong tokens and wrong sessions', async () => {
  const s = setup();
  const first = await issued(s);
  const second = await issued(s);
  assert.equal(s.sessions.verifyCsrf(first.sessionId, first.csrfToken), true);
  assert.equal(s.sessions.verifyCsrf(first.sessionId, second.csrfToken), false);
  assert.equal(s.sessions.verifyCsrf(second.sessionId, first.csrfToken), false);
  assert.equal(s.sessions.verifyCsrf(first.sessionId, 'tampered'), false);
  assert.equal(s.sessions.verifyCsrf(first.sessionId, null), false);
});

test('parseSessionId finds the cookie among others and rejects malformed values', async () => {
  const s = setup();
  const result = await issued(s);
  assert.equal(
    s.sessions.parseSessionId(`other=abc; ${result.cookie.split(';')[0]}; theme=dark`),
    result.sessionId,
  );
  assert.equal(s.sessions.parseSessionId('__Host-payrollcheck-session='), null);
  assert.equal(s.sessions.parseSessionId('__Host-payrollcheck-session=bad value!'), null);
  assert.equal(s.sessions.clearCookie(), '__Host-payrollcheck-session=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0');
});

test('issue rejects bad input without touching the store', async () => {
  const s = setup();
  assert.equal(await s.sessions.issue({userId: 'owner@example.com', authUserId: AUTH_USER_ID, aal2: true}), null);
  assert.equal(await s.sessions.issue({userId: USER_ID, authUserId: 'not-a-uuid', aal2: true}), null);
  assert.equal(await s.sessions.issue({userId: USER_ID, authUserId: AUTH_USER_ID, aal2: 'yes'}), null);
  assert.equal(s.store.size(), 0);
});

test('rejects a bad factory config', () => {
  const store = memoryStore();
  assert.throws(() => createServerSession({store, secret: 'too-short'}), TypeError);
  assert.throws(() => createServerSession({secret: SECRET}), TypeError);
  assert.throws(() => createServerSession({store: {}, secret: SECRET}), TypeError);
  assert.throws(() => createServerSession({store, secret: SECRET, clock: 'not-a-function'}), TypeError);
});

// Root cause #6: load() swallowed the store error, so a denied write-back
// surfaced only as a bare session_lookup_failed. Both catch blocks must log
// the underlying error's code and message (never session values) so a future
// RLS denial is diagnosable.
test('load logs only the store error code when the read fails (never the message)', async () => {
  const logged = [];
  const originalError = console.error;
  console.error = (...args) => { logged.push(args.map((arg) => String(arg)).join(' ')); };
  try {
    const s = setup();
    const result = await issued(s);
    s.store.get = async () => {
      const error = new Error('new row violates row-level security policy "app_sessions_select" for table "sessions"');
      error.code = '42501';
      throw error;
    };
    const loaded = await s.sessions.load(result.cookie);
    assert.deepEqual(loaded, {ok: false, reason: 'session_lookup_failed'});
    assert.equal(logged.length, 1);
    assert.match(logged[0], /42501/);
    // S7: pg messages can echo input values, so only the code is logged.
    assert.doesNotMatch(logged[0], /app_sessions_select/);
    assert.doesNotMatch(logged[0], /sess-/);
  } finally {
    console.error = originalError;
  }
});

test('load logs only the store error code when the write-back fails (never the message)', async () => {
  const logged = [];
  const originalError = console.error;
  console.error = (...args) => { logged.push(args.map((arg) => String(arg)).join(' ')); };
  try {
    const s = setup();
    const result = await issued(s);
    s.store.set = async () => {
      const error = new Error('new row violates row-level security policy "app_sessions_insert" for table "sessions"');
      error.code = '42501';
      throw error;
    };
    const loaded = await s.sessions.load(result.cookie);
    assert.deepEqual(loaded, {ok: false, reason: 'session_lookup_failed'});
    assert.equal(logged.length, 1);
    assert.match(logged[0], /42501/);
    // S7: pg messages can echo input values, so only the code is logged.
    assert.doesNotMatch(logged[0], /app_sessions_insert/);
    assert.doesNotMatch(logged[0], /sess-/);
  } finally {
    console.error = originalError;
  }
});
