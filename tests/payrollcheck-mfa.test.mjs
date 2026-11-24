import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  listMfaFactors,
  enrollTotpFactor,
  challengeMfaFactor,
  verifyMfaChallenge,
  unenrollMfaFactor,
} from '../src/payrollcheck/supabase-mfa.mjs';

const BASE = 'https://izqzclahjijkhyxvhtif.supabase.co';
const API_KEY = 'test-anon-key';
const TOKEN = 'user-access-token';
const FACTOR_ID = '11111111-2222-3333-4444-555555555555';
const CHALLENGE_ID = '22222222-3333-4444-5555-666666666666';

function stubFetch(response) {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    return response;
  };
  return { calls, fetchImpl };
}

test('listMfaFactors GETs /auth/v1/user and returns user.factors', async () => {
  const factors = [
    { id: FACTOR_ID, friendly_name: 'My phone', factor_type: 'totp', status: 'verified' },
  ];
  const { calls, fetchImpl } = stubFetch({
    ok: true,
    status: 200,
    json: async () => ({ id: 'user-1', email: 'test@example.com', factors }),
  });
  const result = await listMfaFactors({ supabaseUrl: BASE, apiKey: API_KEY, accessToken: TOKEN, fetchImpl });
  assert.deepEqual(result, factors);
  assert.equal(calls[0].url, `${BASE}/auth/v1/user`);
  assert.equal(calls[0].options.method, 'GET');
  assert.equal(calls[0].options.headers.apikey, API_KEY);
  assert.equal(calls[0].options.headers.Authorization, `Bearer ${TOKEN}`);
});

test('listMfaFactors returns [] when the user has no factors array', async () => {
  const { fetchImpl } = stubFetch({
    ok: true,
    status: 200,
    json: async () => ({ id: 'user-1', email: 'test@example.com' }),
  });
  const result = await listMfaFactors({ supabaseUrl: BASE, apiKey: API_KEY, accessToken: TOKEN, fetchImpl });
  assert.deepEqual(result, []);
});

test('enrollTotpFactor posts friendly_name, factor_type totp and issuer', async () => {
  const { calls, fetchImpl } = stubFetch({
    ok: true,
    status: 200,
    json: async () => ({
      id: FACTOR_ID,
      factor_type: 'totp',
      status: 'unverified',
      totp: { qr_code: 'data:image/png;base64,xxx', secret: 'SECRET', uri: 'otpauth://totp/x' },
    }),
  });
  const result = await enrollTotpFactor({
    supabaseUrl: BASE,
    apiKey: API_KEY,
    accessToken: TOKEN,
    friendlyName: 'My phone',
    issuer: 'PayrollCheck 360',
    fetchImpl,
  });
  assert.equal(result.id, FACTOR_ID);
  assert.equal(result.totp.secret, 'SECRET');
  assert.equal(calls[0].url, `${BASE}/auth/v1/factors`);
  assert.equal(calls[0].options.method, 'POST');
  assert.deepEqual(JSON.parse(calls[0].options.body), {
    friendly_name: 'My phone',
    factor_type: 'totp',
    issuer: 'PayrollCheck 360',
  });
});

test('challengeMfaFactor posts to the factor challenge endpoint', async () => {
  const { calls, fetchImpl } = stubFetch({
    ok: true,
    status: 200,
    json: async () => ({ id: CHALLENGE_ID, expires_at: 1234567890 }),
  });
  const result = await challengeMfaFactor({
    supabaseUrl: BASE,
    apiKey: API_KEY,
    accessToken: TOKEN,
    factorId: FACTOR_ID,
    fetchImpl,
  });
  assert.equal(result.id, CHALLENGE_ID);
  assert.equal(calls[0].url, `${BASE}/auth/v1/factors/${FACTOR_ID}/challenge`);
  assert.equal(calls[0].options.method, 'POST');
});

test('verifyMfaChallenge posts type totp with factor, challenge and code, returns the session', async () => {
  const { calls, fetchImpl } = stubFetch({
    ok: true,
    status: 200,
    json: async () => ({ access_token: 'aal2-token', user: { id: 'u1' } }),
  });
  const result = await verifyMfaChallenge({
    supabaseUrl: BASE,
    apiKey: API_KEY,
    accessToken: TOKEN,
    factorId: FACTOR_ID,
    challengeId: CHALLENGE_ID,
    code: '123456',
    fetchImpl,
  });
  assert.equal(result.access_token, 'aal2-token');
  assert.equal(calls[0].url, `${BASE}/auth/v1/verify`);
  assert.equal(calls[0].options.method, 'POST');
  assert.deepEqual(JSON.parse(calls[0].options.body), {
    type: 'totp',
    factor_id: FACTOR_ID,
    challenge_id: CHALLENGE_ID,
    code: '123456',
  });
});

test('unenrollMfaFactor DELETEs the factor', async () => {
  const { calls, fetchImpl } = stubFetch({ ok: true, status: 200, json: async () => ({}) });
  const result = await unenrollMfaFactor({
    supabaseUrl: BASE,
    apiKey: API_KEY,
    accessToken: TOKEN,
    factorId: FACTOR_ID,
    fetchImpl,
  });
  assert.deepEqual(result, {});
  assert.equal(calls[0].url, `${BASE}/auth/v1/factors/${FACTOR_ID}`);
  assert.equal(calls[0].options.method, 'DELETE');
});

test('non-2xx throws with the status and no body echo', async () => {
  const { fetchImpl } = stubFetch({ ok: false, status: 422 });
  await assert.rejects(
    () => listMfaFactors({ supabaseUrl: BASE, apiKey: API_KEY, accessToken: TOKEN, fetchImpl }),
    /status 422/,
  );
});

test('invalid code throws before any fetch', async () => {
  let called = false;
  const fetchImpl = async () => {
    called = true;
    return { ok: true, status: 200, json: async () => ({}) };
  };
  await assert.rejects(
    () =>
      verifyMfaChallenge({
        supabaseUrl: BASE,
        apiKey: API_KEY,
        accessToken: TOKEN,
        factorId: FACTOR_ID,
        challengeId: CHALLENGE_ID,
        code: '12345',
        fetchImpl,
      }),
    /6-digit/,
  );
  assert.equal(called, false);
});

test('invalid factor id and non-https URL throw before any fetch', async () => {
  let called = false;
  const fetchImpl = async () => {
    called = true;
    return { ok: true, status: 200, json: async () => ({}) };
  };
  await assert.rejects(
    () =>
      challengeMfaFactor({
        supabaseUrl: BASE,
        apiKey: API_KEY,
        accessToken: TOKEN,
        factorId: 'not-a-uuid',
        fetchImpl,
      }),
    /UUID/,
  );
  await assert.rejects(
    () =>
      listMfaFactors({
        supabaseUrl: 'http://izqzclahjijkhyxvhtif.supabase.co',
        apiKey: API_KEY,
        accessToken: TOKEN,
        fetchImpl,
      }),
    /https/,
  );
  await assert.rejects(
    () =>
      listMfaFactors({ supabaseUrl: BASE, apiKey: API_KEY, accessToken: '', fetchImpl }),
    /accessToken/,
  );
  assert.equal(called, false);
});

test('network errors propagate', async () => {
  const fetchImpl = async () => {
    throw new Error('network down');
  };
  await assert.rejects(
    () => listMfaFactors({ supabaseUrl: BASE, apiKey: API_KEY, accessToken: TOKEN, fetchImpl }),
    /network down/,
  );
});
