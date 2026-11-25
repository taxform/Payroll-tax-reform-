// Server-only session layer for PayrollCheck 360. No framework, no SDK.
// After Supabase verification (steps 2-3), the server issues an opaque
// session id in a secure cookie and keeps the session record in an injected
// store. The browser never chooses session ids, tenant, role, or expiry.
// Cookie: __Host-payrollcheck-session; HttpOnly; Secure; SameSite=Lax; Path=/.
// CSRF: HMAC(secret, sessionId) token, sent by the client in X-CSRF-Token.
// Expiry: absolute 12h from creation, idle 30 min (choices — see
// m2-step4-design.md). Rotation: new id on issue, on privilege change, and
// when the session is older than 15 min; the previous id stays valid for a
// 60s grace window. Revocation: delete (logout) or revoke-all-for-user.
// Loading rejects missing, expired, idle-timed-out, or revoked sessions.
// Fail closed throughout. The secret arrives as injected config (server-side
// only); never log it, the session id, or the CSRF token.
import {createHmac, randomBytes, timingSafeEqual} from 'node:crypto';

const COOKIE_NAME = '__Host-payrollcheck-session';
const SESSION_ID_BYTES = 32;

const uuid = (x) =>
  typeof x === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(x);
const id = (x) => typeof x === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(x);

function positiveInt(value, fallback) {
  return Number.isSafeInteger(value) && value > 0 ? value : fallback;
}

export function createServerSession({
  store,
  secret,
  clock = () => Math.floor(Date.now() / 1000),
  absoluteLifetimeSeconds = 12 * 3600,
  idleTimeoutSeconds = 30 * 60,
  rotationIntervalSeconds = 15 * 60,
  rotationGraceSeconds = 60,
} = {}) {
  if (
    !store ||
    typeof store.get !== 'function' ||
    typeof store.getByPreviousSessionId !== 'function' ||
    typeof store.set !== 'function' ||
    typeof store.delete !== 'function' ||
    typeof store.deleteByUserId !== 'function'
  ) {
    throw new TypeError('session_store_required');
  }
  if (typeof secret !== 'string' || secret.length < 32) {
    throw new TypeError('session_secret_required');
  }
  if (typeof clock !== 'function') throw new TypeError('clock_required');
  const absolute = positiveInt(absoluteLifetimeSeconds, 12 * 3600);
  const idle = positiveInt(idleTimeoutSeconds, 30 * 60);
  const rotationInterval = positiveInt(rotationIntervalSeconds, 15 * 60);
  const grace = positiveInt(rotationGraceSeconds, 60);

  function newSessionId() {
    return randomBytes(SESSION_ID_BYTES).toString('base64url');
  }

  function cookieFor(sessionId, maxAgeSeconds) {
    return `${COOKIE_NAME}=${sessionId}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${maxAgeSeconds}`;
  }

  function clearCookie() {
    return `${COOKIE_NAME}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`;
  }

  function csrfFor(sessionId) {
    return createHmac('sha256', secret).update(sessionId).digest('base64url');
  }

  function verifyCsrf(sessionId, token) {
    if (!id(sessionId) || typeof token !== 'string' || !token) return false;
    const expected = csrfFor(sessionId);
    if (token.length !== expected.length) return false;
    try {
      return timingSafeEqual(Buffer.from(token), Buffer.from(expected));
    } catch {
      return false;
    }
  }

  function parseSessionId(cookieHeader) {
    if (typeof cookieHeader !== 'string' || !cookieHeader) return null;
    for (const part of cookieHeader.split(';')) {
      const trimmed = part.trim();
      if (!trimmed.startsWith(`${COOKIE_NAME}=`)) continue;
      const value = trimmed.slice(COOKIE_NAME.length + 1);
      return id(value) ? value : null;
    }
    return null;
  }

  function publicSession(record) {
    return Object.freeze({
      sessionId: record.sessionId,
      userId: record.userId,
      authUserId: record.authUserId,
      aal2: record.aal2,
      createdAt: record.createdAt,
      expiresAt: record.expiresAt,
    });
  }

  async function doRotate(record, now) {
    const newId = newSessionId();
    const rotated = {
      ...record,
      sessionId: newId,
      previousSessionId: record.sessionId,
      graceUntil: now + grace,
      rotatedAt: now,
      lastSeenAt: now,
    };
    await store.set(rotated);
    await store.delete(record.sessionId);
    return rotated;
  }

  async function issue({userId, authUserId, aal2} = {}) {
    if (!id(userId) || !uuid(authUserId) || typeof aal2 !== 'boolean') return null;
    const now = clock();
    if (!Number.isSafeInteger(now)) return null;
    const record = {
      sessionId: newSessionId(),
      previousSessionId: null,
      graceUntil: null,
      userId,
      authUserId,
      aal2,
      createdAt: now,
      rotatedAt: now,
      lastSeenAt: now,
      expiresAt: now + absolute,
      revoked: false,
    };
    try {
      await store.set(record);
    } catch {
      return null;
    }
    return Object.freeze({
      sessionId: record.sessionId,
      cookie: cookieFor(record.sessionId, absolute),
      csrfToken: csrfFor(record.sessionId),
      expiresAt: record.expiresAt,
    });
  }

  async function load(cookieHeader) {
    const presentedId = parseSessionId(cookieHeader);
    if (!presentedId) return {ok: false, reason: 'no_session'};
    const now = clock();
    if (!Number.isSafeInteger(now)) return {ok: false, reason: 'no_session'};
    let record = null;
    let viaGrace = false;
    try {
      record = await store.get(presentedId);
      if (!record || record.sessionId !== presentedId) {
        const previous = await store.getByPreviousSessionId(presentedId);
        if (
          previous &&
          previous.previousSessionId === presentedId &&
          previous.graceUntil !== null &&
          now < previous.graceUntil
        ) {
          record = previous;
          viaGrace = true;
        } else {
          record = null;
        }
      }
    } catch (error) {
      console.error('payrollcheck-server-session load read failed', error?.code, error?.message);
      return {ok: false, reason: 'session_lookup_failed'};
    }
    if (!record) return {ok: false, reason: 'unknown_session'};
    if (record.revoked) return {ok: false, reason: 'revoked'};
    if (now >= record.expiresAt) {
      try {
        await store.delete(record.sessionId);
      } catch {
        // Best-effort cleanup; the denial stands.
      }
      return {ok: false, reason: 'expired'};
    }
    if (now - record.lastSeenAt > idle) {
      try {
        await store.delete(record.sessionId);
      } catch {
        // Best-effort cleanup; the denial stands.
      }
      return {ok: false, reason: 'idle_timeout'};
    }
    let current = record;
    let rotated = false;
    try {
      if (viaGrace) {
        // Presenting the previous id: hand back the current session (and its
        // cookie) and refresh activity, without rotating again.
        rotated = true;
        current = {...record, lastSeenAt: now};
        await store.set(current);
      } else if (now - record.rotatedAt >= rotationInterval) {
        current = await doRotate(record, now);
        rotated = true;
      } else {
        current = {...record, lastSeenAt: now};
        await store.set(current);
      }
    } catch (error) {
      console.error('payrollcheck-server-session load write-back failed', error?.code, error?.message);
      return {ok: false, reason: 'session_lookup_failed'};
    }
    const result = {
      ok: true,
      session: publicSession(current),
      csrfToken: csrfFor(current.sessionId),
      rotated,
    };
    if (rotated) {
      result.cookie = cookieFor(current.sessionId, Math.max(0, current.expiresAt - now));
    }
    return Object.freeze(result);
  }

  async function rotate(sessionId) {
    if (!id(sessionId)) return null;
    const now = clock();
    if (!Number.isSafeInteger(now)) return null;
    let record;
    try {
      record = await store.get(sessionId);
    } catch {
      return null;
    }
    if (!record || record.sessionId !== sessionId || record.revoked) return null;
    if (now >= record.expiresAt || now - record.lastSeenAt > idle) return null;
    let rotated;
    try {
      rotated = await doRotate(record, now);
    } catch {
      return null;
    }
    return Object.freeze({
      sessionId: rotated.sessionId,
      cookie: cookieFor(rotated.sessionId, Math.max(0, rotated.expiresAt - now)),
      csrfToken: csrfFor(rotated.sessionId),
      expiresAt: rotated.expiresAt,
    });
  }

  async function revoke(sessionId) {
    if (!id(sessionId)) return false;
    try {
      await store.delete(sessionId);
      return true;
    } catch {
      return false;
    }
  }

  async function revokeAllForUser(userId) {
    if (!id(userId)) return {ok: false, revoked: 0};
    try {
      const count = await store.deleteByUserId(userId);
      const revoked = Number.isSafeInteger(count) && count > 0 ? count : 0;
      return {ok: revoked > 0, revoked};
    } catch {
      return {ok: false, revoked: 0};
    }
  }

  return Object.freeze({
    issue,
    load,
    rotate,
    revoke,
    revokeAllForUser,
    csrfToken: csrfFor,
    verifyCsrf,
    cookieFor,
    clearCookie,
    parseSessionId,
  });
}
