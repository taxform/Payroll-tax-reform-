import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSupabaseAuthRest } from '../src/payrollcheck/supabase-auth-rest.mjs';

const URL = 'https://izqzclahjijkhyxvhtif.supabase.co';
const USER_ID = '11111111-aaaa-4111-8111-111111111111';

function fakeFetch(routes) {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url, options });
    const route = routes[url];
    if (!route) return { ok: false, status: 404, json: async () => ({}) };
    if (route instanceof Error) throw route;
    return route;
  };
  return { fetchImpl, calls };
}

test('factory validates config before any fetch', () => {
  assert.throws(() => createSupabaseAuthRest({}), /invalid_supabase_url/);
  assert.throws(
    () => createSupabaseAuthRest({ supabaseUrl: 'http://x.supabase.co' }),
    /invalid_supabase_url/,
  );
  assert.throws(
    () => createSupabaseAuthRest({ supabaseUrl: URL }),
    /anon_key_required/,
  );
  assert.throws(
    () => createSupabaseAuthRest({ supabaseUrl: URL, anonKey: 'k', fetchImpl: 1 }),
    /fetch_required/,
  );
});

test('getVerifiedUser returns the user on 200', async () => {
  const user = { id: USER_ID, email_confirmed_at: '2026-01-01T00:00:00Z', is_anonymous: false };
  const { fetchImpl, calls } = fakeFetch({
    [`${URL}/auth/v1/user`]: { ok: true, status: 200, json: async () => user },
  });
  const auth = createSupabaseAuthRest({ supabaseUrl: URL, anonKey: 'anon-key', fetchImpl });
  const result = await auth.getVerifiedUser('tok-abc');
  assert.deepEqual(result, user);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.headers.Authorization, 'Bearer tok-abc');
  assert.equal(calls[0].options.headers.apikey, 'anon-key');
});

test('getVerifiedUser unwraps the { user } envelope', async () => {
  const user = { id: USER_ID, email_confirmed_at: '2026-01-01T00:00:00Z' };
  const { fetchImpl } = fakeFetch({
    [`${URL}/auth/v1/user`]: { ok: true, status: 200, json: async () => ({ user }) },
  });
  const auth = createSupabaseAuthRest({ supabaseUrl: URL, anonKey: 'k', fetchImpl });
  assert.deepEqual(await auth.getVerifiedUser('tok-abc'), user);
});

test('getVerifiedUser throws status-only on non-2xx and on a bad user', async () => {
  const { fetchImpl } = fakeFetch({
    [`${URL}/auth/v1/user`]: { ok: false, status: 401, json: async () => ({ msg: 'bad token' }) },
  });
  const auth = createSupabaseAuthRest({ supabaseUrl: URL, anonKey: 'k', fetchImpl });
  await assert.rejects(() => auth.getVerifiedUser('tok-bad'), /status 401/);
  // No secret or body echo in the error.
  await assert.rejects(() => auth.getVerifiedUser('tok-bad'), (err) => !/bad token/.test(err.message));

  const badUser = fakeFetch({
    [`${URL}/auth/v1/user`]: { ok: true, status: 200, json: async () => ({ id: 'not-a-uuid' }) },
  });
  const auth2 = createSupabaseAuthRest({ supabaseUrl: URL, anonKey: 'k', fetchImpl: badUser.fetchImpl });
  await assert.rejects(() => auth2.getVerifiedUser('tok-abc'), /status 0/);
});

test('getVerifiedUser validates the token before fetching', async () => {
  const { fetchImpl, calls } = fakeFetch({});
  const auth = createSupabaseAuthRest({ supabaseUrl: URL, anonKey: 'k', fetchImpl });
  await assert.rejects(() => auth.getVerifiedUser(''), /access_token_invalid/);
  await assert.rejects(() => auth.getVerifiedUser('x'.repeat(16385)), /access_token_invalid/);
  assert.equal(calls.length, 0);
});

test('signInWithPassword posts to the token endpoint and returns the session', async () => {
  const session = {
    access_token: 'tok-new',
    refresh_token: 'ref-new',
    user: { id: USER_ID, email: 'owner@example.com' },
  };
  const { fetchImpl, calls } = fakeFetch({
    [`${URL}/auth/v1/token?grant_type=password`]: { ok: true, status: 200, json: async () => session },
  });
  const auth = createSupabaseAuthRest({ supabaseUrl: URL, anonKey: 'k', fetchImpl });
  const result = await auth.signInWithPassword({ email: 'owner@example.com', password: 'correct horse' });
  assert.deepEqual(result, session);
  assert.equal(calls[0].options.method, 'POST');
  assert.equal(calls[0].options.headers['Content-Type'], 'application/json');
  const body = JSON.parse(calls[0].options.body);
  assert.equal(body.email, 'owner@example.com');
  assert.equal(body.password, 'correct horse');
});

test('signInWithPassword throws status-only on a bad password', async () => {
  const { fetchImpl } = fakeFetch({
    [`${URL}/auth/v1/token?grant_type=password`]: { ok: false, status: 400, json: async () => ({ error: 'invalid grant' }) },
  });
  const auth = createSupabaseAuthRest({ supabaseUrl: URL, anonKey: 'k', fetchImpl });
  await assert.rejects(
    () => auth.signInWithPassword({ email: 'owner@example.com', password: 'wrong' }),
    /status 400/,
  );
});

test('signInWithPassword validates input before fetching', async () => {
  const { fetchImpl, calls } = fakeFetch({});
  const auth = createSupabaseAuthRest({ supabaseUrl: URL, anonKey: 'k', fetchImpl });
  await assert.rejects(() => auth.signInWithPassword({ email: 'not-an-email', password: 'x' }), /email_invalid/);
  await assert.rejects(() => auth.signInWithPassword({ email: 'a@b.co', password: '' }), /password_invalid/);
  assert.equal(calls.length, 0);
});

test('network errors propagate', async () => {
  const { fetchImpl } = fakeFetch({
    [`${URL}/auth/v1/user`]: new Error('fetch failed'),
  });
  const auth = createSupabaseAuthRest({ supabaseUrl: URL, anonKey: 'k', fetchImpl });
  await assert.rejects(() => auth.getVerifiedUser('tok-abc'), /fetch failed/);
});
