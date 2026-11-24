// Server-side RLS identity context for PayrollCheck 360 (M2 step 7).
//
// The payrollcheck RLS policies (docs/sql/payrollcheck-rls-policies.sql)
// read the caller's identity from three transaction-local settings:
//
//   payrollcheck.current_subject_id   — the step-3 mapped internal id
//     (memberships.subject_id, [A-Za-z0-9_-]{1,64})
//   payrollcheck.current_auth_user_id — the verified Supabase Auth UUID
//     (the JWT sub, verified by the step-2 JWKS verifier)
//   payrollcheck.current_session_id   — the presented server session id
//     (the __Host-payrollcheck-session cookie value, step 4a)
//
// This module is the only place that writes those settings. Values come
// from server-verified sources only — never from client input — and are
// validated here before any query runs. The settings are set with
// set_config(..., true), i.e. SET LOCAL: they live only inside the
// caller's transaction and vanish on COMMIT/ROLLBACK, so a pooled
// connection cannot leak one request's identity into the next.
//
// CALLER CONTRACT (step 9 handlers):
//   1. BEGIN
//   2. setRlsIdentity({ subjectId, authUserId, sessionId? })
//      - Login/mapping path: authUserId only (the subject is not known
//        until the step-3 mapping query runs).
//      - Authenticated requests: subjectId + authUserId (both verified).
//      - Session-store operations: also pass sessionId (the cookie value)
//        so the sessions-table policies can match the presented session.
//   3. Run the request's queries on the same connection.
//   4. COMMIT on success, ROLLBACK on error.
// If setRlsIdentity throws or the query fails, the handler must abort the
// request — an unset identity denies everything (fail closed), but a
// half-set identity must never be used.
//
// Nothing is logged. No SDK, no direct database access: the pg-style
// `query(sql, values) => { rows }` is injected, same pattern as steps 2-6.

const SUBJECT_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Fixed literals owned by this module. GUC names are never caller input.
const IDENTITY_GUCS = [
  ['subjectId', 'payrollcheck.current_subject_id'],
  ['authUserId', 'payrollcheck.current_auth_user_id'],
  ['sessionId', 'payrollcheck.current_session_id'],
];

function validateValue(key, value) {
  if (key === 'authUserId') {
    if (typeof value !== 'string' || !UUID_PATTERN.test(value)) {
      throw new TypeError('auth_user_id_must_be_a_uuid');
    }
    return;
  }
  // subjectId and sessionId share the [A-Za-z0-9_-]{1,64} shape
  // (memberships.subject_id and sessions.session_id CHECKs).
  if (typeof value !== 'string' || !SUBJECT_PATTERN.test(value)) {
    throw new TypeError(`${key}_must_match_[A-Za-z0-9_-]{1,64}`);
  }
}

export async function setRlsIdentity({ query, subjectId, authUserId, sessionId } = {}) {
  if (typeof query !== 'function') throw new TypeError('query_required');
  const supplied = { subjectId, authUserId, sessionId };
  const sets = [];
  for (const [key, gucName] of IDENTITY_GUCS) {
    if (supplied[key] === undefined) continue;
    validateValue(key, supplied[key]);
    sets.push([gucName, supplied[key]]);
  }
  if (sets.length === 0) {
    throw new TypeError('at_least_one_identity_value_required');
  }
  const expressions = sets
    .map(([gucName], i) => `set_config('${gucName}', $${i + 1}, true)`)
    .join(', ');
  await query(`SELECT ${expressions}`, sets.map(([, value]) => value));
  return { ok: true, set: sets.map(([gucName]) => gucName) };
}

export async function clearRlsIdentity({ query } = {}) {
  if (typeof query !== 'function') throw new TypeError('query_required');
  // Empty string is "unset" for the policies (they guard with
  // nullif(current_setting(...), '')). SET LOCAL values vanish at
  // transaction end anyway; this is defense in depth for a caller that
  // reuses a transaction.
  await query(
    `SELECT set_config('payrollcheck.current_subject_id', '', true), ` +
      `set_config('payrollcheck.current_auth_user_id', '', true), ` +
      `set_config('payrollcheck.current_session_id', '', true)`,
  );
  return { ok: true };
}
