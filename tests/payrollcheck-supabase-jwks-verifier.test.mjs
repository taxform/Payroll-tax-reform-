// Tests for supabase-jwks-verifier.mjs — fully offline. Real RSA keypairs are
// generated in-test; the JWKS endpoint is a stubbed fetch. No live Supabase,
// no network, no secrets.
import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync, createSign} from 'node:crypto';
import {createSupabaseJwksVerifier} from '../src/payrollcheck/supabase-jwks-verifier.mjs';

const ISSUER = 'https://demo-project.supabase.co/auth/v1';
const AUDIENCE = 'authenticated';
const NOW = 1500;
const clock = () => NOW;

function base64url(input) {
  return Buffer.from(input).toString('base64url');
}

function signToken({privateKey, kid, alg = 'RS256', claims}) {
  const header = {alg, kid, typ: 'JWT'};
  const signingInput = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(claims))}`;
  if (alg === 'none') return `${signingInput}.`;
  const signature = createSign('RSA-SHA256').update(signingInput).sign(privateKey);
  return `${signingInput}.${signature.toString('base64url')}`;
}

function jwksFor(publicKey, kid) {
  const jwk = publicKey.export({format: 'jwk'});
  return {keys: [{...jwk, kid, use: 'sig', alg: 'RS256'}]};
}

function baseClaims(overrides = {}) {
  return {
    iss: ISSUER,
    aud: AUDIENCE,
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

function keypair() {
  return generateKeyPairSync('rsa', {modulusLength: 2048});
}

function verifierFor(jwks, calls = []) {
  const fetchImpl = async (url) => {
    calls.push(url);
    return {ok: true, json: async () => jwks};
  };
  return createSupabaseJwksVerifier({issuer: ISSUER, audience: AUDIENCE, fetchImpl, clock});
}

function hasCode(code) {
  return (error) => error instanceof Error && error.code === code;
}

test('accepts a valid RS256 token and returns its claims', async () => {
  const {privateKey, publicKey} = keypair();
  const verifier = verifierFor(jwksFor(publicKey, 'key-1'));
  const token = signToken({privateKey, kid: 'key-1', claims: baseClaims()});
  const claims = await verifier.verifyAccessToken(token);
  assert.equal(claims.sub, '11111111-1111-4111-8111-111111111111');
  assert.equal(claims.session_id, '22222222-2222-4222-8222-222222222222');
  assert.equal(claims.role, 'authenticated');
  assert.equal(claims.aal, 'aal2');
  assert.equal(claims.email, 'owner@example.test');
});

test('rejects HS256 tokens', async () => {
  const {privateKey, publicKey} = keypair();
  const verifier = verifierFor(jwksFor(publicKey, 'key-1'));
  const token = signToken({privateKey, kid: 'key-1', alg: 'HS256', claims: baseClaims()});
  await assert.rejects(() => verifier.verifyAccessToken(token), hasCode('unsupported_algorithm'));
});

test('rejects alg none tokens', async () => {
  const {publicKey} = keypair();
  const verifier = verifierFor(jwksFor(publicKey, 'key-1'));
  const token = signToken({privateKey: null, kid: 'key-1', alg: 'none', claims: baseClaims()});
  await assert.rejects(() => verifier.verifyAccessToken(token), hasCode('unsupported_algorithm'));
});

test('rejects a token with the wrong issuer', async () => {
  const {privateKey, publicKey} = keypair();
  const verifier = verifierFor(jwksFor(publicKey, 'key-1'));
  const token = signToken({privateKey, kid: 'key-1', claims: baseClaims({iss: 'https://evil.supabase.co/auth/v1'})});
  await assert.rejects(() => verifier.verifyAccessToken(token), hasCode('invalid_issuer'));
});

test('rejects a token with the wrong audience', async () => {
  const {privateKey, publicKey} = keypair();
  const verifier = verifierFor(jwksFor(publicKey, 'key-1'));
  const token = signToken({privateKey, kid: 'key-1', claims: baseClaims({aud: 'someone-else'})});
  await assert.rejects(() => verifier.verifyAccessToken(token), hasCode('invalid_audience'));
});

test('rejects an expired token', async () => {
  const {privateKey, publicKey} = keypair();
  const verifier = verifierFor(jwksFor(publicKey, 'key-1'));
  const token = signToken({privateKey, kid: 'key-1', claims: baseClaims({exp: 1400})});
  await assert.rejects(() => verifier.verifyAccessToken(token), hasCode('token_expired'));
});

test('rejects a token with iat in the future', async () => {
  const {privateKey, publicKey} = keypair();
  const verifier = verifierFor(jwksFor(publicKey, 'key-1'));
  const token = signToken({privateKey, kid: 'key-1', claims: baseClaims({iat: 1600, exp: 2600})});
  await assert.rejects(() => verifier.verifyAccessToken(token), hasCode('token_not_yet_valid'));
});

test('rejects a tampered payload', async () => {
  const {privateKey, publicKey} = keypair();
  const verifier = verifierFor(jwksFor(publicKey, 'key-1'));
  const token = signToken({privateKey, kid: 'key-1', claims: baseClaims()});
  const [header, payload, signature] = token.split('.');
  const tamperedPayload = base64url(
    Buffer.from(payload, 'base64url').toString('utf8').replace('"exp":2000', '"exp":2001'),
  );
  await assert.rejects(
    () => verifier.verifyAccessToken(`${header}.${tamperedPayload}.${signature}`),
    hasCode('invalid_signature'),
  );
});

test('rejects a token signed by a different key', async () => {
  const {publicKey} = keypair();
  const {privateKey: otherPrivate} = keypair();
  const verifier = verifierFor(jwksFor(publicKey, 'key-1'));
  const token = signToken({privateKey: otherPrivate, kid: 'key-1', claims: baseClaims()});
  await assert.rejects(() => verifier.verifyAccessToken(token), hasCode('invalid_signature'));
});

test('unknown kid fails closed, then verifies after key rotation', async () => {
  const {privateKey: priv1, publicKey: pub1} = keypair();
  const {privateKey: priv2, publicKey: pub2} = keypair();
  let currentJwks = jwksFor(pub1, 'key-1');
  const calls = [];
  const fetchImpl = async () => {
    calls.push(1);
    return {ok: true, json: async () => currentJwks};
  };
  const verifier = createSupabaseJwksVerifier({issuer: ISSUER, audience: AUDIENCE, fetchImpl, clock});
  const token = signToken({privateKey: priv2, kid: 'key-2', claims: baseClaims()});
  // key-2 is not in the JWKS yet: rotation refetch still finds nothing.
  await assert.rejects(() => verifier.verifyAccessToken(token), hasCode('unknown_key'));
  assert.equal(calls.length, 2); // initial load + rotation refetch
  // The key set rotates: key-2 is now published.
  currentJwks = jwksFor(pub2, 'key-2');
  const claims = await verifier.verifyAccessToken(token);
  assert.equal(claims.sub, '11111111-1111-4111-8111-111111111111');
});

test('caches the JWKS: two verifications, one fetch', async () => {
  const {privateKey, publicKey} = keypair();
  const calls = [];
  const verifier = verifierFor(jwksFor(publicKey, 'key-1'), calls);
  const token = signToken({privateKey, kid: 'key-1', claims: baseClaims()});
  await verifier.verifyAccessToken(token);
  await verifier.verifyAccessToken(token);
  assert.equal(calls.length, 1);
  assert.equal(calls[0], `${ISSUER}/.well-known/jwks.json`);
});

test('rejects malformed tokens', async () => {
  const {publicKey} = keypair();
  const verifier = verifierFor(jwksFor(publicKey, 'key-1'));
  await assert.rejects(() => verifier.verifyAccessToken(''), hasCode('invalid_token_format'));
  await assert.rejects(() => verifier.verifyAccessToken('only.two'), hasCode('invalid_token_format'));
  await assert.rejects(() => verifier.verifyAccessToken('not-json.not-json.sig'), hasCode('invalid_token_format'));
  await assert.rejects(() => verifier.verifyAccessToken(null), hasCode('invalid_token_format'));
});

test('rejects when the JWKS endpoint is unavailable', async () => {
  const fetchImpl = async () => ({ok: false, json: async () => ({})});
  const verifier = createSupabaseJwksVerifier({issuer: ISSUER, audience: AUDIENCE, fetchImpl, clock});
  const {privateKey} = keypair();
  const token = signToken({privateKey, kid: 'key-1', claims: baseClaims()});
  await assert.rejects(() => verifier.verifyAccessToken(token), hasCode('jwks_unavailable'));
  const throwingFetch = async () => {
    throw new Error('offline');
  };
  const verifier2 = createSupabaseJwksVerifier({issuer: ISSUER, audience: AUDIENCE, fetchImpl: throwingFetch, clock});
  await assert.rejects(() => verifier2.verifyAccessToken(token), hasCode('jwks_unavailable'));
});

test('rejects a bad factory config', () => {
  assert.throws(() => createSupabaseJwksVerifier({issuer: 'http://demo.supabase.co/auth/v1'}), TypeError);
  assert.throws(() => createSupabaseJwksVerifier({issuer: ISSUER, audience: ''}), TypeError);
  assert.throws(() => createSupabaseJwksVerifier({issuer: ISSUER, fetchImpl: null}), TypeError);
});
