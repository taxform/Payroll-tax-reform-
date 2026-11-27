import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';

import { getAuthComposition } from '../netlify/lib/payrollcheck-auth.mjs';

// Regression test for the Slice 3 sign-in outage (PR #140, main 11631cc).
// getAuthComposition() passed the raw PAYROLLCHECK_PENDING_KEY string to
// createSsnSealer(), which requires a 32-byte Buffer, so the sealer threw
// "SSN sealer needs a 32-byte key" on every call — before any credential
// check — and every PayrollCheck sign-in returned 503 "temporarily
// unavailable" (logged as the bare "Error": errorCode() reports
// error.name when the error has no .code). In production the key is a
// base64 string encoding 32 bytes; the pending-token sealer accepts that
// shape, the SSN sealer does not. The fix decodes it to a Buffer first.
//
// getAuthComposition() caches the composition it builds, so the
// malformed-key test runs first: it throws before anything is cached.

function setTestEnv(pendingKey) {
  process.env.PAYROLLCHECK_SUPABASE_URL = 'https://example.supabase.co';
  process.env.PAYROLLCHECK_SUPABASE_ANON_KEY = 'test-anon-key';
  process.env.PAYROLLCHECK_SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key';
  process.env.PAYROLLCHECK_DATABASE_URL =
    'postgres://payrollcheck:test@localhost:5432/payrollcheck?sslmode=require';
  process.env.PAYROLLCHECK_SESSION_SECRET =
    'test-session-secret-0123456789abcdef0123456789abcdef0123456789abcdef';
  process.env.PAYROLLCHECK_PENDING_KEY = pendingKey;
}

test('getAuthComposition rejects a PAYROLLCHECK_PENDING_KEY that does not decode to 32 bytes', () => {
  setTestEnv('not-a-32-byte-key');
    assert.throws(() => getAuthComposition(), /pending_key_must_be_32_bytes/);
});

test('getAuthComposition builds with a base64 PAYROLLCHECK_PENDING_KEY (production shape)', () => {
  setTestEnv(randomBytes(32).toString('base64'));
  const composition = getAuthComposition();
  assert.equal(typeof composition, 'object');
  assert.equal(typeof composition.login, 'function');
});

test('a filing client factory builds a fresh composition instead of reusing the cached one', () => {
  const composition = getAuthComposition();
  const filingClientFactory = () => ({});
  const withFiling = getAuthComposition({ filingClientFactory });
  assert.notEqual(withFiling, composition);
  assert.equal(typeof withFiling.handleFiling, 'function');
  assert.equal(getAuthComposition(), composition);
});
