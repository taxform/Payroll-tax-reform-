// Server-only Supabase JWT verifier (JWKS). No SDK, no new dependency.
// Verifies RS256 and ES256 access tokens issued by a Supabase Auth server:
// - fetches the JWKS from {issuer}/.well-known/jwks.json (cached; refetched
//   on unknown kid, i.e. key rotation)
// - rejects any algorithm other than RS256 or ES256, unknown keys, bad
//   signatures. ES256 signatures arrive in JWS raw R||S form and are
//   converted to DER before verifying (Node's verifier expects DER).
// - checks issuer, audience, exp/iat (after the signature is verified)
// Returns the decoded claims on success. Throws an Error with a stable `code`
// on failure. Fail closed: any error means "do not trust this token".
// Never log the token.
// NOTE: Supabase projects created after the ES256 migration sign tokens
// with ES256 (EC P-256 keys). A verifier that only accepts RS256 rejects
// every token from such a project, so requireAal2 can never pass —
// that is what broke the staging MFA verify (Nov 24, 2026: the dev
// project's JWKS carries a single EC/ES256 key).
// NOTE 2: do NOT "fix" ES256 by passing dsaEncoding: 'ieee-p1363' to
// createVerify. On the Node versions we run that option is ignored:
// verified Nov 24, 2026 on Node v24.22.1 — a raw 64-byte JWS signature
// verifies false with AND without the option, while the DER-converted
// form verifies true, and createSign with the option still emits DER.
// The ignored option is exactly why the staging MFA verify failed with
// invalid_signature even after the ES256 fix (PR #111): the local tests
// round-tripped DER through both sides, so they passed while every real
// GoTrue token (raw R||S) failed. Convert raw to DER explicitly.
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

// Convert a JWS ES256 signature (raw R||S, exactly 64 bytes) to DER, the
// form Node's verifier expects. Each 32-byte half becomes a DER INTEGER,
// with a leading 0x00 byte when its top bit is set (otherwise the integer
// would read as negative).
function rawEs256SignatureToDer(raw) {
  const encodeInteger = (half) => {
    let start = 0;
    while (start < half.length - 1 && half[start] === 0) start++;
    const value = half.subarray(start);
    const pad = value[0] & 0x80 ? 1 : 0;
    const out = Buffer.alloc(2 + pad + value.length);
    out[0] = 0x02;
    out[1] = pad + value.length;
    if (pad) out[2] = 0x00;
    value.copy(out, 2 + pad);
    return out;
  };
  const r = encodeInteger(raw.subarray(0, 32));
  const s = encodeInteger(raw.subarray(32, 64));
  const out = Buffer.alloc(2 + r.length + s.length);
  out[0] = 0x30;
  out[1] = r.length + s.length;
  r.copy(out, 2);
  s.copy(out, 2 + r.length);
  return out;
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
    if (!jwk || typeof jwk !== 'object') return null;
    if (jwk.kty === 'RSA') {
      if (typeof jwk.n !== 'string' || typeof jwk.e !== 'string') return null;
    } else if (jwk.kty === 'EC') {
      // ES256 uses the P-256 curve only.
      if (jwk.crv !== 'P-256' || typeof jwk.x !== 'string' || typeof jwk.y !== 'string') return null;
    } else {
      return null;
    }
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
    if (header.alg !== 'RS256' && header.alg !== 'ES256') throw fail('unsupported_algorithm');
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
      if (header.alg === 'ES256') {
        // JWS ES256 signatures are raw R||S (64 bytes). Node's verifier
        // expects DER, so convert first (see NOTE 2 above — the
        // dsaEncoding option does not do this on our Node versions).
        if (signature.length !== 64) throw fail('invalid_signature');
        valid = createVerify('SHA256')
          .update(`${headerSegment}.${payloadSegment}`)
          .verify(publicKey, rawEs256SignatureToDer(signature));
      } else {
        valid = createVerify('RSA-SHA256')
          .update(`${headerSegment}.${payloadSegment}`)
          .verify(publicKey, signature);
      }
    } catch (error) {
      if (error && error.code === 'invalid_signature') throw error;
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
