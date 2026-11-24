// Proves the full step-2 + step-3 chain: the real JWKS verifier, the real
// Admin-API email check, and the real membership mapping plug into
// verifySupabasePayrollSession. Fully offline — real RSA keypairs, stubbed
// JWKS + Admin API + database. No live Supabase.
import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync, createSign} from 'node:crypto';
import {createSupabaseJwksVerifier} from '../src/payrollcheck/supabase-jwks-verifier.mjs';
import {createSupabaseEmailConfirmation} from '../src/payrollcheck/supabase-admin-email-check.mjs';
import {createSupabaseInternalUserMapping} from '../src/payrollcheck/supabase-internal-user-mapping.mjs';
import {verifySupabasePayrollSession} from '../src/payrollcheck/supabase-identity-boundary.mjs';

const ISSUER = 'https://demo-project.supabase.co/auth/v1';
const PROJECT_URL = 'https://demo-project.supabase.co';
const NOW_SECONDS = 1500;
const SUB = '11111111-1111-4111-8111-111111111111';

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
    sub: SUB,
    session_id: '22222222-2222-4222-8222-222222222222',
    role: 'authenticated',
    aal: 'aal2',
    email: 'owner@example.test',
    iat: 1000,
    exp: 2000,
    ...overrides,
  };
}

function setup({emailConfirmed = true, subjectRows = [{subject_id: 'owner1'}]} = {}) {
  const {privateKey, publicKey} = generateKeyPairSync('rsa', {modulusLength: 2048});
  const jwk = {...publicKey.export({format: 'jwk'}), kid: 'key-1', use: 'sig', alg: 'RS256'};
  const jwksFetch = async () => ({ok: true, json: async () => ({keys: [jwk]})});
  const {verifyAccessToken} = createSupabaseJwksVerifier({
    issuer: ISSUER,
    audience: 'authenticated',
    fetchImpl: jwksFetch,
    clock: () => NOW_SECONDS,
  });
  const adminUser = {
    id: SUB,
    email: 'owner@example.test',
    email_confirmed_at: emailConfirmed ? '2026-01-01T00:00:00Z' : null,
    is_anonymous: false,
  };
  const adminFetch = async () => ({ok: true, json: async () => adminUser});
  const {verifyEmailConfirmed} = createSupabaseEmailConfirmation({
    projectUrl: PROJECT_URL,
    serviceRoleKey: 'test-service-role-key',
    fetchImpl: adminFetch,
  });
  const query = async () => ({rows: subjectRows});
  const {resolveInternalUserId} = createSupabaseInternalUserMapping({query});
  return {privateKey, verifyAccessToken, verifyEmailConfirmed, resolveInternalUserId};
}

async function verifyAll({privateKey, verifyAccessToken, verifyEmailConfirmed, resolveInternalUserId}) {
  const accessToken = signToken({privateKey, kid: 'key-1', claims: baseClaims()});
  return verifySupabasePayrollSession({
    accessToken,
    verifyAccessToken,
    resolveInternalUserId,
    verifyEmailConfirmed,
    expectedIssuer: ISSUER,
    nowSeconds: NOW_SECONDS,
  });
}

test('full chain accepts a confirmed user with an active membership', async () => {
  const result = await verifyAll(setup());
  assert.equal(result.ok, true);
  assert.equal(result.session.userId, 'owner1');
  assert.equal(result.session.sessionId, '22222222-2222-4222-8222-222222222222');
  assert.equal(result.session.mfaVerified, true);
});

test('full chain denies an unconfirmed email', async () => {
  const result = await verifyAll(setup({emailConfirmed: false}));
  assert.deepEqual(result, {ok: false, reason: 'unconfirmed_email'});
});

test('full chain denies an unknown user', async () => {
  const result = await verifyAll(setup({subjectRows: []}));
  assert.deepEqual(result, {ok: false, reason: 'unknown_internal_identity'});
});
