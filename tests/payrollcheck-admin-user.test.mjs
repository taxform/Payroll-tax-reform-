import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSupabaseAdminUser } from '../src/payrollcheck/payrollcheck-admin-user.mjs';

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
  assert.throws(() => createSupabaseAdminUser({}), /invalid_supabase_url/);
  assert.throws(
    () => createSupabaseAdminUser({ supabaseUrl: 'http://x.supabase.co' }),
    /invalid_supabase_url/,
  );
  assert.throws(
    () => createSupabaseAdminUser({ supabaseUrl: URL }),
    /service_role_key_required/,
  );
  assert.throws(
    () => createSupabaseAdminUser({ supabaseUrl: URL, serviceRoleKey: 'k', fetchImpl: 1 }),
    /fetch_required/,
  );
});

test('fetchAdminUser returns the user on 200 and sends the service-role key', async () => {
  const user = { id: USER_ID, email: 'owner@example.com', email_confirmed_at: '2026-01-01T00:00:00Z', is_anonymous: false };
  const { fetchImpl, calls } = fakeFetch({
    [`${URL}/auth/v1/admin/users/${USER_ID}`]: { ok: true, status: 200, json: async () => user },
  });
  const admin = createSupabaseAdminUser({ supabaseUrl: URL, serviceRoleKey: 'srv-key', fetchImpl });
  const result = await admin.fetchAdminUser(USER_ID);
  assert.deepEqual(result, user);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.headers.apikey, 'srv-key');
  assert.equal(calls[0].options.headers.Authorization, 'Bearer srv-key');
});

test('fetchAdminUser unwraps the { user } envelope', async () => {
  const user = { id: USER_ID, email_confirmed_at: '2026-01-01T00:00:00Z' };
  const { fetchImpl } = fakeFetch({
    [`${URL}/auth/v1/admin/users/${USER_ID}`]: { ok: true, status: 200, json: async () => ({ user }) },
  });
  const admin = createSupabaseAdminUser({ supabaseUrl: URL, serviceRoleKey: 'k', fetchImpl });
  assert.deepEqual(await admin.fetchAdminUser(USER_ID), user);
});

test('fetchAdminUser throws status-only on non-2xx and on an id mismatch', async () => {
  const { fetchImpl } = fakeFetch({
    [`${URL}/auth/v1/admin/users/${USER_ID}`]: { ok: false, status: 404, json: async () => ({ msg: 'not found' }) },
  });
  const admin = createSupabaseAdminUser({ supabaseUrl: URL, serviceRoleKey: 'k', fetchImpl });
  await assert.rejects(() => admin.fetchAdminUser(USER_ID), /status 404/);
  await assert.rejects(() => admin.fetchAdminUser(USER_ID), (err) => !/not found/.test(err.message));

  const mismatched = fakeFetch({
    [`${URL}/auth/v1/admin/users/${USER_ID}`]: {
      ok: true,
      status: 200,
      json: async () => ({ id: '22222222-bbbb-4222-8222-222222222222' }),
    },
  });
  const admin2 = createSupabaseAdminUser({ supabaseUrl: URL, serviceRoleKey: 'k', fetchImpl: mismatched.fetchImpl });
  await assert.rejects(() => admin2.fetchAdminUser(USER_ID), /status 0/);
});

test('fetchAdminUser validates the id before fetching', async () => {
  const { fetchImpl, calls } = fakeFetch({});
  const admin = createSupabaseAdminUser({ supabaseUrl: URL, serviceRoleKey: 'k', fetchImpl });
  await assert.rejects(() => admin.fetchAdminUser('not-a-uuid'), /auth_user_id_must_be_a_uuid/);
  await assert.rejects(() => admin.fetchAdminUser(''), /auth_user_id_must_be_a_uuid/);
  assert.equal(calls.length, 0);
});

test('network errors propagate', async () => {
  const { fetchImpl } = fakeFetch({
    [`${URL}/auth/v1/admin/users/${USER_ID}`]: new Error('fetch failed'),
  });
  const admin = createSupabaseAdminUser({ supabaseUrl: URL, serviceRoleKey: 'k', fetchImpl });
  await assert.rejects(() => admin.fetchAdminUser(USER_ID), /fetch failed/);
});
