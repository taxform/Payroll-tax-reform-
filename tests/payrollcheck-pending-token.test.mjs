import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { createPendingTokenSealer } from '../src/payrollcheck/payrollcheck-pending-token.mjs';

const KEY = randomBytes(32);
const USER_ID = '11111111-aaaa-4111-8111-111111111111';
const OTHER_USER = '22222222-bbbb-4222-8222-222222222222';

test('factory validates the key and ttl', () => {
  assert.throws(() => createPendingTokenSealer({}), /pending_key_must_be_32_bytes/);
  assert.throws(() => createPendingTokenSealer({ key: randomBytes(16) }), /pending_key_must_be_32_bytes/);
  assert.throws(() => createPendingTokenSealer({ key: KEY, ttlSeconds: 0 }), /ttl_seconds_must_be_a_positive_integer/);
  // A base64 32-byte key is accepted.
  const sealer = createPendingTokenSealer({ key: KEY.toString('base64') });
  assert.equal(typeof sealer.seal, 'function');
});

test('seal/open round-trips the payload, including the factor id', () => {
  let now = 1794000000;
  const sealer = createPendingTokenSealer({ key: KEY, now: () => now });
  const blob = sealer.seal({
    purpose: 'enroll',
    authUserId: USER_ID,
    accessToken: 'tok-aal1-abc',
    factorId: 'factor-1',
  });
  assert.equal(typeof blob, 'string');
  assert.equal(blob.includes('tok-aal1-abc'), false, 'blob must be ciphertext, not the token');
  assert.equal(blob.includes(USER_ID), false, 'blob must not leak the user id in cleartext');
  const payload = sealer.open(blob);
  assert.deepEqual(payload, {
    purpose: 'enroll',
    authUserId: USER_ID,
    accessToken: 'tok-aal1-abc',
    factorId: 'factor-1',
    exp: 1794000000 + 600,
  });
});

test('an expired blob opens to null', () => {
  let now = 1794000000;
  const sealer = createPendingTokenSealer({ key: KEY, now: () => now });
  const blob = sealer.seal({ purpose: 'login', authUserId: USER_ID, accessToken: 'tok' });
  now += 600; // exactly at expiry
  assert.equal(sealer.open(blob), null);
  now = 1794000000 + 599; // one second before expiry
  assert.notEqual(sealer.open(blob), null);
});

test('a tampered blob opens to null', () => {
  const sealer = createPendingTokenSealer({ key: KEY });
  const blob = sealer.seal({ purpose: 'login', authUserId: USER_ID, accessToken: 'tok-secret' });
  const tampered = blob.slice(0, -4) + (blob.endsWith('AAAA') ? 'BBBB' : 'AAAA');
  assert.equal(sealer.open(tampered), null);
  assert.equal(sealer.open('not-base64!!!'), null);
  assert.equal(sealer.open(''), null);
  assert.equal(sealer.open(null), null);
  assert.equal(sealer.open(42), null);
});

test('a blob sealed under another key opens to null', () => {
  const sealerA = createPendingTokenSealer({ key: randomBytes(32) });
  const sealerB = createPendingTokenSealer({ key: randomBytes(32) });
  const blob = sealerA.seal({ purpose: 'login', authUserId: USER_ID, accessToken: 'tok' });
  assert.equal(sealerB.open(blob), null);
});

test('seal validates its inputs', () => {
  const sealer = createPendingTokenSealer({ key: KEY });
  assert.throws(() => sealer.seal({ purpose: 'reset', authUserId: USER_ID, accessToken: 't' }), /purpose_must_be_login_or_enroll/);
  assert.throws(() => sealer.seal({ purpose: 'login', authUserId: 'not-a-uuid', accessToken: 't' }), /auth_user_id_must_be_a_uuid/);
  assert.throws(() => sealer.seal({ purpose: 'login', authUserId: USER_ID, accessToken: '' }), /access_token_invalid/);
  assert.throws(() => sealer.seal({ purpose: 'login', authUserId: OTHER_USER, accessToken: 't', factorId: '' }), /factor_id_invalid/);
});

test('purpose and user are bound: a login blob cannot be used as enroll', () => {
  // The binding is enforced by the caller checking payload.purpose —
  // prove the payload carries the sealed purpose and user faithfully.
  const sealer = createPendingTokenSealer({ key: KEY });
  const loginBlob = sealer.seal({ purpose: 'login', authUserId: USER_ID, accessToken: 'tok' });
  const payload = sealer.open(loginBlob);
  assert.equal(payload.purpose, 'login');
  assert.equal(payload.authUserId, USER_ID);
  assert.equal(payload.factorId, undefined);
});
