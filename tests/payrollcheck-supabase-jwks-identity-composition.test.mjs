// Proves the real JWKS verifier plugs into verifySupabasePayrollSession: a
// genuinely signed RS256 token passes the boundary, and a token signed by an
// unknown key is denied. Fully offline — real RSA keypairs generated in-test,
// JWKS endpoint stubbed. No live Supabase.
import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync, createSign} from 'node:crypto';
import {createSupabaseJwksVerifier} from '../src/payrollcheck/supabase-jwks-verifier.mjs';
import {verifySupabasePayrollSession} from '../src/payrollcheck/supabase-identity-boundary.mjs';

const ISSUER = 'https://demo-project.supabase.co/auth/v1';
const NOW_SECONDS = 1500;

function base64url(input) {
  return Buffer.from(input).toString('base64url');
}

function signToken({privateKey, kid, claims}) {
  const header = {alg: 'RS256', kid, typ: 'JWT'};
  const signingInput = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(claims))}`;
  const signature = createSign('RSA-SHA256').update(signingInput).sign(privateKey);
  return `${signingInput}.${signature.toString('base64url')}`;
}

function baseClaims(overrides = {}) {
  return {
    iss: ISSUER,
    aud: 'authenticated',
    sub: '11111111-1111-4111-8111-111111111111',
    session_id: '22222222-2222-4222-8222-222222222222',
    role: 'authenticated',
    aal: 'aal2',
    email: 'owner@example.test',
    iat: 1000,
    exp: 2000,
    ...overrides,
  };
}

async function setup() {
  const {privateKey, publicKey} = generateKeyPairSync('rsa', {modulusLength: 2048});
  const jwk = {...publicKey.export({format: 'jwk'}), kid: 'key-1', use: 'sig', alg: 'RS256'};
  const fetchImpl = async () => ({ok: true, json: async () => ({keys: [jwk]})});
  const {verifyAccessToken} = createSupabaseJwksVerifier({
    issuer: ISSUER,
    audience: 'authenticated',
    fetchImpl,
    clock: () => NOW_SECONDS,
  });
  return {privateKey, verifyAccessToken};
}

test('real verifier + boundary accepts a genuinely signed MFA session', async () => {
  const {privateKey, verifyAccessToken} = await setup();
  const accessToken = signToken({privateKey, kid: 'key-1', claims: baseClaims()});
  const result = await verifySupabasePayrollSession({
    accessToken,
    verifyAccessToken,
    resolveInternalUserId: async () => 'owner1',
    verifyEmailConfirmed: async () => true,
    expectedIssuer: ISSUER,
    nowSeconds: NOW_SECONDS,
  });
  assert.equal(result.ok, true);
  assert.equal(result.session.userId, 'owner1');
  assert.equal(result.session.sessionId, '22222222-2222-4222-8222-222222222222');
  assert.equal(result.session.mfaVerified, true);
});

test('real verifier + boundary denies a token signed by an unknown key', async () => {
  const {verifyAccessToken} = await setup();
  const {privateKey: otherPrivate} = generateKeyPairSync('rsa', {modulusLength: 2048});
  const accessToken = signToken({privateKey: otherPrivate, kid: 'key-1', claims: baseClaims()});
  const result = await verifySupabasePayrollSession({
    accessToken,
    verifyAccessToken,
    resolveInternalUserId: async () => 'owner1',
    verifyEmailConfirmed: async () => true,
    expectedIssuer: ISSUER,
    nowSeconds: NOW_SECONDS,
  });
  assert.deepEqual(result, {ok: false, reason: 'identity_verification_failed'});
});
