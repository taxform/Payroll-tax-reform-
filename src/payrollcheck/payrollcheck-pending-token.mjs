// Stateless pending-token sealer for PayrollCheck 360 (M2 step 9).
//
// The MFA gap: after password login the server holds a Supabase aal1
// access token, and the user still has to type a TOTP code — a second
// request. The token must survive between those two requests WITHOUT
// being stored in the browser in plaintext and WITHOUT a new database
// table (see the design note for why the pending_logins-table alternative
// was rejected: a 7th RLS table, a new GUC, and smoke/posture updates
// for a 10-minute pointer).
//
// Instead the token is sealed into an opaque blob the browser carries
// transiently: AES-256-GCM (node:crypto), key from injected server-side
// config (PAYROLLCHECK_PENDING_KEY, 32 bytes, base64). The blob is
// ciphertext, never the token — the browser cannot read it, and the
// server decrypts it only inside the verify request. The GCM tag
// authenticates the whole ciphertext, so the payload fields (purpose,
// authUserId) cannot be altered or spliced from another blob without
// failing the tag. The blob alone authorizes NOTHING: the verify
// endpoint still requires the 6-digit TOTP code, so a captured blob
// without the code is useless, and the blob expires after
// PENDING_TTL_SECONDS (default 10 minutes).
//
// Payload: { purpose: 'login' | 'enroll', authUserId, accessToken,
// factorId?, exp }. seal() validates the payload; open() returns the
// payload or null (bad base64, bad tag, wrong key, expired, wrong
// shape, wrong purpose) — it never throws for a bad blob. The key is
// never logged, and neither is the access token.
//
// Purpose is recorded, not enforced: mfaVerify intentionally accepts
// BOTH 'login' and 'enroll' blobs (the enroll flow depends on it). The
// purpose only sets the mfaEnrolled flag in the verify response. Both
// blob types are issued only after password authentication of the same
// user, and both still require the 6-digit TOTP code, so accepting both
// is not a privilege boundary - do not describe it as "purpose-bound".
//
// LIMITATION (documented, not hidden): the blob is stateless, so a
// failed verify cannot "consume" it — it stays usable until expiry.
// That is safe here because every use still requires the TOTP code and
// the endpoint is per-IP rate-limited (step 4c). If the security review
// wants server-side single-use enforcement, the pending_logins-table
// alternative in the design note is the upgrade path.
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PURPOSES = ['login', 'enroll'];
const DEFAULT_TTL_SECONDS = 10 * 60;
const MAX_TOKEN_LENGTH = 16384;
const MAX_FACTOR_ID_LENGTH = 128;

function parseKey(key) {
  if (Buffer.isBuffer(key) && key.length === 32) return key;
  if (typeof key === 'string' && key.length > 0) {
    const decoded = Buffer.from(key, 'base64');
    if (decoded.length === 32) return decoded;
  }
  throw new TypeError('pending_key_must_be_32_bytes');
}

export function createPendingTokenSealer({
  key,
  ttlSeconds = DEFAULT_TTL_SECONDS,
  now = () => Math.floor(Date.now() / 1000),
} = {}) {
  const keyBytes = parseKey(key);
  if (!Number.isSafeInteger(ttlSeconds) || ttlSeconds <= 0) {
    throw new TypeError('ttl_seconds_must_be_a_positive_integer');
  }
  if (typeof now !== 'function') throw new TypeError('now_required');

  function seal({ purpose, authUserId, accessToken, factorId } = {}) {
    if (typeof purpose !== 'string' || !PURPOSES.includes(purpose)) {
      throw new TypeError('purpose_must_be_login_or_enroll');
    }
    if (typeof authUserId !== 'string' || !UUID_PATTERN.test(authUserId)) {
      throw new TypeError('auth_user_id_must_be_a_uuid');
    }
    if (
      typeof accessToken !== 'string' ||
      accessToken.length === 0 ||
      accessToken.length > MAX_TOKEN_LENGTH
    ) {
      throw new TypeError('access_token_invalid');
    }
    if (
      factorId !== undefined &&
      (typeof factorId !== 'string' ||
        factorId.length === 0 ||
        factorId.length > MAX_FACTOR_ID_LENGTH)
    ) {
      throw new TypeError('factor_id_invalid');
    }
    const payload = {
      purpose,
      authUserId,
      accessToken,
      ...(factorId !== undefined ? { factorId } : {}),
      exp: now() + ttlSeconds,
    };
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', keyBytes, iv);
    const ciphertext = Buffer.concat([
      cipher.update(JSON.stringify(payload), 'utf8'),
      cipher.final(),
    ]);
    const tag = cipher.getAuthTag();
    return Buffer.concat([iv, tag, ciphertext]).toString('base64url');
  }

  function open(blob) {
    if (typeof blob !== 'string' || blob.length === 0) return null;
    let raw;
    try {
      raw = Buffer.from(blob, 'base64url');
    } catch {
      return null;
    }
    if (raw.length < 12 + 16 + 1) return null;
    const iv = raw.subarray(0, 12);
    const tag = raw.subarray(12, 28);
    const ciphertext = raw.subarray(28);
    let payload;
    try {
      const decipher = createDecipheriv('aes-256-gcm', keyBytes, iv);
      decipher.setAuthTag(tag);
      const plain = Buffer.concat([
        decipher.update(ciphertext),
        decipher.final(),
      ]);
      payload = JSON.parse(plain.toString('utf8'));
    } catch {
      return null;
    }
    if (
      !payload ||
      typeof payload !== 'object' ||
      !PURPOSES.includes(payload.purpose) ||
      typeof payload.authUserId !== 'string' ||
      !UUID_PATTERN.test(payload.authUserId) ||
      typeof payload.accessToken !== 'string' ||
      !payload.accessToken ||
      payload.accessToken.length > MAX_TOKEN_LENGTH ||
      !Number.isSafeInteger(payload.exp)
    ) {
      return null;
    }
    if (
      payload.factorId !== undefined &&
      (typeof payload.factorId !== 'string' ||
        !payload.factorId ||
        payload.factorId.length > MAX_FACTOR_ID_LENGTH)
    ) {
      return null;
    }
    if (now() >= payload.exp) return null;
    return Object.freeze({
      purpose: payload.purpose,
      authUserId: payload.authUserId,
      accessToken: payload.accessToken,
      ...(payload.factorId !== undefined ? { factorId: payload.factorId } : {}),
      exp: payload.exp,
    });
  }

  return Object.freeze({ seal, open });
}
