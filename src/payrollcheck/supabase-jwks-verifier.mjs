// Server-only Supabase JWT verifier (JWKS). No SDK, no new dependency.
// Verifies RS256 access tokens issued by a Supabase Auth server:
// - fetches the JWKS from {issuer}/.well-known/jwks.json (cached; refetched
//   on unknown kid, i.e. key rotation)
// - rejects any algorithm other than RS256, unknown keys, bad signatures
// - checks issuer, audience, exp/iat (after the signature is verified)
// Returns the decoded claims on success. Throws an Error with a stable `code`
// on failure. Fail closed: any error means "do not trust this token".
// Never log the token.
import {createPublicKey, createVerify} from 'node:crypto';

const MAX_TOKEN_LENGTH = 16384;
const DEFAULT_JWKS_TTL_MS = 600_000;

function fail(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function decodeSegment(segment) {
  if (typeof segment !== 'string' || !segment) throw fail('invalid_token_format');
  const buf = Buffer.from(segment, 'base64url');
  if (buf.length === 0) throw fail('invalid_token_format');
  return buf;
}

function decodeJsonSegment(segment) {
  let value;
  try {
    value = JSON.parse(decodeSegment(segment).toString('utf8'));
  } catch {
    throw fail('invalid_token_format');
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw fail('invalid_token_format');
  return value;
}

function audienceIncludes(aud, expected) {
  if (typeof aud === 'string') return aud === expected;
  if (Array.isArray(aud)) return aud.includes(expected);
  return false;
}

export function createSupabaseJwksVerifier({
  issuer,
  audience = 'authenticated',
  fetchImpl = globalThis.fetch,
  jwksTtlMs = DEFAULT_JWKS_TTL_MS,
  clock = () => Math.floor(Date.now() / 1000),
} = {}) {
  if (typeof issuer !== 'string' || !/^https:\/\/.+\/auth\/v1$/.test(issuer)) {
    throw new TypeError('invalid_issuer');
  }
  if (typeof audience !== 'string' || !audience) throw new TypeError('invalid_audience');
  if (typeof fetchImpl !== 'function') throw new TypeError('fetch_required');
  if (typeof clock !== 'function') throw new TypeError('clock_required');

  const jwksUrl = `${issuer}/.well-known/jwks.json`;
  let cache = null; // {keys: Map<kid, jwk>, fetchedAtMs}

  async function loadJwks({force = false} = {}) {
    const nowMs = Date.now();
    if (!force && cache && nowMs - cache.fetchedAtMs < jwksTtlMs) return cache.keys;
    let response;
    try {
      response = await fetchImpl(jwksUrl);
    } catch {
      throw fail('jwks_unavailable');
    }
    if (!response || response.ok === false) throw fail('jwks_unavailable');
    let body;
    try {
      body = await response.json();
    } catch {
      throw fail('jwks_unavailable');
    }
    if (!body || !Array.isArray(body.keys)) throw fail('jwks_unavailable');
    const keys = new Map();
    for (const jwk of body.keys) {
      if (jwk && typeof jwk === 'object' && typeof jwk.kid === 'string' && jwk.kid) {
        keys.set(jwk.kid, jwk);
      }
    }
    cache = {keys, fetchedAtMs: nowMs};
    return keys;
  }

  function publicKeyFor(jwk) {
    if (!jwk || jwk.kty !== 'RSA' || typeof jwk.n !== 'string' || typeof jwk.e !== 'string') return null;
    try {
      return createPublicKey({key: jwk, format: 'jwk'});
    } catch {
      return null;
    }
  }

  async function verifyAccessToken(accessToken, {issuer: expectedIssuer = issuer, audience: expectedAudience = audience} = {}) {
    if (typeof accessToken !== 'string' || !accessToken || accessToken.length > MAX_TOKEN_LENGTH) {
      throw fail('invalid_token_format');
    }
    if (typeof expectedIssuer !== 'string' || !expectedIssuer) throw fail('invalid_issuer');
    if (typeof expectedAudience !== 'string' || !expectedAudience) throw fail('invalid_audience');
    const nowSeconds = clock();
    if (!Number.isSafeInteger(nowSeconds)) throw fail('invalid_token_format');

    const parts = accessToken.split('.');
    if (parts.length !== 3) throw fail('invalid_token_format');
    const [headerSegment, payloadSegment, signatureSegment] = parts;
    const header = decodeJsonSegment(headerSegment);
    if (header.alg !== 'RS256') throw fail('unsupported_algorithm');
    if (typeof header.kid !== 'string' || !header.kid) throw fail('unknown_key');
    // Decode the payload for structure only — its values are not trusted until
    // the signature below verifies.
    const claims = decodeJsonSegment(payloadSegment);

    let keys = await loadJwks();
    let jwk = keys.get(header.kid);
    let publicKey = jwk ? publicKeyFor(jwk) : null;
    if (!publicKey) {
      // Unknown kid: keys may have rotated — refetch once, then fail closed.
      keys = await loadJwks({force: true});
      jwk = keys.get(header.kid);
      publicKey = jwk ? publicKeyFor(jwk) : null;
      if (!publicKey) throw fail('unknown_key');
    }

    const signature = decodeSegment(signatureSegment);
    let valid = false;
    try {
      valid = createVerify('RSA-SHA256')
        .update(`${headerSegment}.${payloadSegment}`)
        .verify(publicKey, signature);
    } catch {
      throw fail('invalid_signature');
    }
    if (!valid) throw fail('invalid_signature');

    // Signature verified — now the claims can be trusted and checked.
    if (!Number.isSafeInteger(claims.exp) || !Number.isSafeInteger(claims.iat)) {
      throw fail('invalid_token_format');
    }
    if (claims.exp <= nowSeconds) throw fail('token_expired');
    if (claims.iat > nowSeconds) throw fail('token_not_yet_valid');
    if (claims.exp <= claims.iat) throw fail('invalid_token_format');
    if (claims.iss !== expectedIssuer) throw fail('invalid_issuer');
    if (!audienceIncludes(claims.aud, expectedAudience)) throw fail('invalid_audience');
    return claims;
  }

  return Object.freeze({verifyAccessToken});
}
