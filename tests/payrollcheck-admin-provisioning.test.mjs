import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createAuthUser,
  deleteAuthUser,
} from '../src/payrollcheck/supabase-admin-provisioning.mjs';

const BASE = 'https://izqzclahjijkhyxvhtif.supabase.co';
const KEY = 'test-service-role-key';
const AUTH_USER_ID = '11111111-2222-3333-4444-555555555555';

function stubFetch(response) {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    return response;
  };
  return { calls, fetchImpl };
}

function okJson(body) {
  return { ok: true, status: 200, json: async () => body };
}

test('createAuthUser POSTs to /auth/v1/admin/users with service-role headers and email_confirm', async () => {
  const { calls, fetchImpl } = stubFetch(okJson({ id: AUTH_USER_ID, email: 'owner@example.test' }));
  const user = await createAuthUser({
    projectUrl: BASE,
    serviceRoleKey: KEY,
    email: 'owner@example.test',
    fetchImpl,
  });
  assert.equal(user.id, AUTH_USER_ID);
  assert.equal(calls[0].url, `${BASE}/auth/v1/admin/users`);
  assert.equal(calls[0].options.method, 'POST');
  assert.equal(calls[0].options.headers.apikey, KEY);
  assert.equal(calls[0].options.headers.Authorization, `Bearer ${KEY}`);
  const body = JSON.parse(calls[0].options.body);
  assert.equal(body.email, 'owner@example.test');
  assert.equal(body.email_confirm, true);
  assert.equal('password' in body, false);
});

test('createAuthUser includes password and user_metadata when supplied', async () => {
  const { calls, fetchImpl } = stubFetch(okJson({ user: { id: AUTH_USER_ID, email: 'a@example.test' } }));
  const user = await createAuthUser({
    projectUrl: BASE,
    serviceRoleKey: KEY,
    email: 'a@example.test',
    password: 'correct horse',
    emailConfirm: false,
    userMetadata: { invited_by: 'admin' },
    fetchImpl,
  });
  assert.equal(user.id, AUTH_USER_ID);
  const body = JSON.parse(calls[0].options.body);
  assert.equal(body.password, 'correct horse');
  assert.equal(body.email_confirm, false);
  assert.deepEqual(body.user_metadata, { invited_by: 'admin' });
});

test('createAuthUser rejects http project URL, bad email, short password', async () => {
  const { fetchImpl } = stubFetch(okJson({ id: AUTH_USER_ID }));
  await assert.rejects(
    () => createAuthUser({ projectUrl: 'http://x.supabase.co', serviceRoleKey: KEY, email: 'a@b.co', fetchImpl }),
    /invalid_project_url/,
  );
  await assert.rejects(
    () => createAuthUser({ projectUrl: BASE, serviceRoleKey: KEY, email: 'not-an-email', fetchImpl }),
    /invalid_email/,
  );
  await assert.rejects(
    () => createAuthUser({ projectUrl: BASE, serviceRoleKey: KEY, email: 'a@b.co', password: 'short', fetchImpl }),
    /password_must_be_at_least_8_characters/,
  );
  await assert.rejects(
    () => createAuthUser({ projectUrl: BASE, serviceRoleKey: '', email: 'a@b.co', fetchImpl }),
    /service_role_key_required/,
  );
});

test('createAuthUser throws status-only on non-2xx and propagates network errors', async () => {
  const { fetchImpl } = stubFetch({ ok: false, status: 409 });
  await assert.rejects(
    () => createAuthUser({ projectUrl: BASE, serviceRoleKey: KEY, email: 'a@b.co', fetchImpl }),
    /admin user creation failed with status 409/,
  );
  const failingFetch = async () => {
    throw new Error('network down');
  };
  await assert.rejects(
    () => createAuthUser({ projectUrl: BASE, serviceRoleKey: KEY, email: 'a@b.co', fetchImpl: failingFetch }),
    /network down/,
  );
});

test('createAuthUser throws when the response has no user id', async () => {
  const { fetchImpl } = stubFetch(okJson({ email: 'a@b.co' }));
  await assert.rejects(
    () => createAuthUser({ projectUrl: BASE, serviceRoleKey: KEY, email: 'a@b.co', fetchImpl }),
    /unexpected response/,
  );
});

test('deleteAuthUser DELETEs the admin user URL and returns ok', async () => {
  const { calls, fetchImpl } = stubFetch({ ok: true, status: 200, json: async () => ({}) });
  const result = await deleteAuthUser({
    projectUrl: BASE,
    serviceRoleKey: KEY,
    authUserId: AUTH_USER_ID,
    fetchImpl,
  });
  assert.deepEqual(result, { ok: true });
  assert.equal(calls[0].url, `${BASE}/auth/v1/admin/users/${AUTH_USER_ID}`);
  assert.equal(calls[0].options.method, 'DELETE');
  assert.equal(calls[0].options.headers.Authorization, `Bearer ${KEY}`);
});

test('deleteAuthUser rejects a non-UUID and throws status-only on failure', async () => {
  const { fetchImpl } = stubFetch({ ok: false, status: 404 });
  await assert.rejects(
    () => deleteAuthUser({ projectUrl: BASE, serviceRoleKey: KEY, authUserId: 'not-a-uuid', fetchImpl }),
    /auth_user_id_must_be_a_uuid/,
  );
  await assert.rejects(
    () => deleteAuthUser({ projectUrl: BASE, serviceRoleKey: KEY, authUserId: AUTH_USER_ID, fetchImpl }),
    /admin user deletion failed with status 404/,
  );
});
