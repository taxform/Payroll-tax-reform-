import { test } from 'node:test';
import assert from 'node:assert/strict';
import { requestPasswordRecovery } from '../src/payrollcheck/payrollcheck-password-recovery.mjs';

test('posts to /auth/v1/recover with apikey + Bearer and the email', async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    return { ok: true, status: 200 };
  };
  const result = await requestPasswordRecovery({
    supabaseUrl: 'https://izqzclahjijkhyxvhtif.supabase.co/',
    serviceRoleKey: 'test-service-role-key',
    email: 'user@example.com',
    fetchImpl,
  });
  assert.deepEqual(result, { ok: true });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://izqzclahjijkhyxvhtif.supabase.co/auth/v1/recover');
  assert.equal(calls[0].options.method, 'POST');
  assert.equal(calls[0].options.headers.apikey, 'test-service-role-key');
  assert.equal(calls[0].options.headers.Authorization, 'Bearer test-service-role-key');
  assert.equal(calls[0].options.headers['Content-Type'], 'application/json');
  assert.deepEqual(JSON.parse(calls[0].options.body), { email: 'user@example.com' });
});

test('includes redirect_to when a redirect URL is given', async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    return { ok: true, status: 200 };
  };
  await requestPasswordRecovery({
    supabaseUrl: 'https://izqzclahjijkhyxvhtif.supabase.co',
    serviceRoleKey: 'key',
    email: 'user@example.com',
    redirectTo: 'https://payrolltaxreform.com/payrollcheck/reset',
    fetchImpl,
  });
  assert.deepEqual(JSON.parse(calls[0].options.body), {
    email: 'user@example.com',
    redirect_to: 'https://payrolltaxreform.com/payrollcheck/reset',
  });
});

test('non-2xx throws with the status and no body echo', async () => {
  const fetchImpl = async () => ({ ok: false, status: 429 });
  await assert.rejects(
    () =>
      requestPasswordRecovery({
        supabaseUrl: 'https://izqzclahjijkhyxvhtif.supabase.co',
        serviceRoleKey: 'key',
        email: 'user@example.com',
        fetchImpl,
      }),
    /status 429/,
  );
});

test('invalid email throws before any fetch', async () => {
  let called = false;
  const fetchImpl = async () => {
    called = true;
    return { ok: true, status: 200 };
  };
  await assert.rejects(
    () =>
      requestPasswordRecovery({
        supabaseUrl: 'https://izqzclahjijkhyxvhtif.supabase.co',
        serviceRoleKey: 'key',
        email: 'not-an-email',
        fetchImpl,
      }),
    /valid email/,
  );
  assert.equal(called, false);
});

test('non-https supabase URL and missing key throw before any fetch', async () => {
  let called = false;
  const fetchImpl = async () => {
    called = true;
    return { ok: true, status: 200 };
  };
  await assert.rejects(
    () =>
      requestPasswordRecovery({
        supabaseUrl: 'http://izqzclahjijkhyxvhtif.supabase.co',
        serviceRoleKey: 'key',
        email: 'user@example.com',
        fetchImpl,
      }),
    /https/,
  );
  await assert.rejects(
    () =>
      requestPasswordRecovery({
        supabaseUrl: 'https://izqzclahjijkhyxvhtif.supabase.co',
        serviceRoleKey: '',
        email: 'user@example.com',
        fetchImpl,
      }),
    /serviceRoleKey/,
  );
  assert.equal(called, false);
});

test('network errors propagate', async () => {
  const fetchImpl = async () => {
    throw new Error('network down');
  };
  await assert.rejects(
    () =>
      requestPasswordRecovery({
        supabaseUrl: 'https://izqzclahjijkhyxvhtif.supabase.co',
        serviceRoleKey: 'key',
        email: 'user@example.com',
        fetchImpl,
      }),
    /network down/,
  );
});
