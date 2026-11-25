// Server-only Postgres session store for PayrollCheck 360. No SDK.
// Implements the store interface required by payrollcheck-server-session.mjs
// (get, getByPreviousSessionId, set, delete, deleteByUserId) on an injected
// pg-style query(sql, values) => {rows} against payrollcheck.sessions.
// The connection behind query must be a least-privilege, non-BYPASSRLS role
// with reviewed tenant-scoped RLS — never service_role/BYPASSRLS.
// Times are stored as timestamptz and converted to/from epoch seconds.
// Database errors propagate (the session layer fails closed on them); a
// missing row returns null. Never log session ids or query results.
import {setRlsIdentity} from './payrollcheck-rls-identity.mjs';

const uuid = (x) =>
  typeof x === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(x);
const id = (x) => typeof x === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(x);

const COLUMNS = [
  'session_id',
  'previous_session_id',
  'grace_until',
  'user_id',
  'auth_user_id',
  'aal2',
  'created_at',
  'rotated_at',
  'last_seen_at',
  'expires_at',
  'revoked',
];
const SELECT_LIST = COLUMNS.map((c) => `"${c}"`).join(', ');

function toEpoch(value) {
  if (value === null || value === undefined) return null;
  const ms = value instanceof Date ? value.getTime() : Date.parse(value);
  if (!Number.isSafeInteger(ms)) return null;
  return Math.floor(ms / 1000);
}

function toDate(seconds) {
  if (seconds === null || seconds === undefined) return null;
  if (!Number.isSafeInteger(seconds)) throw new TypeError('invalid_timestamp');
  return new Date(seconds * 1000);
}

function toRecord(row) {
  if (!row || typeof row !== 'object') return null;
  if (!id(row.session_id)) return null;
  if (
    row.previous_session_id !== null &&
    row.previous_session_id !== undefined &&
    !id(row.previous_session_id)
  ) {
    return null;
  }
  if (!id(row.user_id)) return null;
  if (!uuid(row.auth_user_id)) return null;
  if (typeof row.aal2 !== 'boolean' || typeof row.revoked !== 'boolean') return null;
  const createdAt = toEpoch(row.created_at);
  const rotatedAt = toEpoch(row.rotated_at);
  const lastSeenAt = toEpoch(row.last_seen_at);
  const expiresAt = toEpoch(row.expires_at);
  if (createdAt === null || rotatedAt === null || lastSeenAt === null || expiresAt === null) return null;
  const graceUntil =
    row.grace_until === null || row.grace_until === undefined ? null : toEpoch(row.grace_until);
  if (row.grace_until !== null && row.grace_until !== undefined && graceUntil === null) return null;
  return Object.freeze({
    sessionId: row.session_id,
    previousSessionId: row.previous_session_id ?? null,
    graceUntil,
    userId: row.user_id,
    authUserId: row.auth_user_id,
    aal2: row.aal2,
    createdAt,
    rotatedAt,
    lastSeenAt,
    expiresAt,
    revoked: row.revoked,
  });
}

function validateRecord(record) {
  if (!record || typeof record !== 'object') throw new TypeError('invalid_session_record');
  if (!id(record.sessionId)) throw new TypeError('invalid_session_record');
  if (
    record.previousSessionId !== null &&
    record.previousSessionId !== undefined &&
    !id(record.previousSessionId)
  ) {
    throw new TypeError('invalid_session_record');
  }
  if (
    record.graceUntil !== null &&
    record.graceUntil !== undefined &&
    !Number.isSafeInteger(record.graceUntil)
  ) {
    throw new TypeError('invalid_session_record');
  }
  if (!id(record.userId)) throw new TypeError('invalid_session_record');
  if (!uuid(record.authUserId)) throw new TypeError('invalid_session_record');
  if (typeof record.aal2 !== 'boolean' || typeof record.revoked !== 'boolean') {
    throw new TypeError('invalid_session_record');
  }
  for (const key of ['createdAt', 'rotatedAt', 'lastSeenAt', 'expiresAt']) {
    if (!Number.isSafeInteger(record[key])) throw new TypeError('invalid_session_record');
  }
}

export function createPostgresSessionStore({query} = {}) {
  if (typeof query !== 'function') throw new TypeError('query_required');

  async function getOne(sql, values) {
    const result = await query(sql, values);
    const rows = result && Array.isArray(result.rows) ? result.rows : null;
    if (!rows || rows.length !== 1) return null;
    return toRecord(rows[0]);
  }

  async function get(sessionId) {
    if (!id(sessionId)) return null;
    return getOne(
      `SELECT ${SELECT_LIST} FROM payrollcheck.sessions WHERE session_id = $1::text LIMIT 2`,
      [sessionId],
    );
  }

  async function getByPreviousSessionId(sessionId) {
    if (!id(sessionId)) return null;
    return getOne(
      `SELECT ${SELECT_LIST} FROM payrollcheck.sessions WHERE previous_session_id = $1::text LIMIT 2`,
      [sessionId],
    );
  }

  async function set(record) {
    validateRecord(record);
    // The upsert below is checked against BOTH app_sessions_insert WITH CHECK
    // and app_sessions_update WITH CHECK; both require user_id =
    // current_subject_id AND auth_user_id = current_auth_user_id. load()'s
    // write-back runs under a session-only identity (PR #114 sets only the
    // presented session id before load), so without this the write-back is
    // denied by RLS and load() reports session_lookup_failed (root cause #6).
    // Complete the identity from the record's own user_id, auth_user_id and
    // session_id — the same values this upsert writes — before running it.
    // The row was already authenticated by session_id on read, so this
    // grants nothing new; it only satisfies the WITH CHECKs for that same
    // row. Same-transaction SET LOCAL on the store's query client; callers
    // that already set a full identity (sign-in) see the same values
    // re-asserted.
    await setRlsIdentity({
      query,
      subjectId: record.userId,
      authUserId: record.authUserId,
      sessionId: record.sessionId,
    });
    const values = [
      record.sessionId,
      record.previousSessionId ?? null,
      toDate(record.graceUntil),
      record.userId,
      record.authUserId,
      record.aal2,
      toDate(record.createdAt),
      toDate(record.rotatedAt),
      toDate(record.lastSeenAt),
      toDate(record.expiresAt),
      record.revoked,
    ];
    await query(
      `INSERT INTO payrollcheck.sessions (${SELECT_LIST}) VALUES ` +
        `($1::text, $2::text, $3::timestamptz, $4::text, $5::uuid, $6::boolean, ` +
        `$7::timestamptz, $8::timestamptz, $9::timestamptz, $10::timestamptz, $11::boolean) ` +
        `ON CONFLICT (session_id) DO UPDATE SET ` +
        `previous_session_id = EXCLUDED.previous_session_id, ` +
        `grace_until = EXCLUDED.grace_until, ` +
        `user_id = EXCLUDED.user_id, ` +
        `auth_user_id = EXCLUDED.auth_user_id, ` +
        `aal2 = EXCLUDED.aal2, ` +
        `created_at = EXCLUDED.created_at, ` +
        `rotated_at = EXCLUDED.rotated_at, ` +
        `last_seen_at = EXCLUDED.last_seen_at, ` +
        `expires_at = EXCLUDED.expires_at, ` +
        `revoked = EXCLUDED.revoked`,
      values,
    );
  }

  async function remove(sessionId) {
    if (!id(sessionId)) return;
    await query('DELETE FROM payrollcheck.sessions WHERE session_id = $1::text', [sessionId]);
  }

  async function deleteByUserId(userId) {
    if (!id(userId)) return 0;
    const result = await query(
      'DELETE FROM payrollcheck.sessions WHERE user_id = $1::text RETURNING session_id',
      [userId],
    );
    return Array.isArray(result?.rows) ? result.rows.length : 0;
  }

  return Object.freeze({get, getByPreviousSessionId, set, delete: remove, deleteByUserId});
}
