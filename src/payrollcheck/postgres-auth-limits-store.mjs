// Postgres-backed auth limits store for PayrollCheck 360.
// Implements the get/set/delete plus atomic increment interface required by
// payrollcheck-auth-limits.mjs against payrollcheck.auth_limits.

function key(value) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new TypeError('auth_limit_key_required');
  }
  if (value.length > 256) throw new TypeError('auth_limit_key_too_long');
  return value;
}

function parseValue(row) {
  if (!row || typeof row !== 'object') return null;
  if (typeof row.value === 'string') {
    try {
      return JSON.parse(row.value);
    } catch {
      return null;
    }
  }
  return row.value && typeof row.value === 'object' ? row.value : null;
}

export function createPostgresAuthLimitsStore({query} = {}) {
  if (typeof query !== 'function') throw new TypeError('query_required');

  async function get(storeKey) {
    const normalized = key(storeKey);
    const result = await query(
      'SELECT value FROM payrollcheck.auth_limits WHERE key = $1::text',
      [normalized],
    );
    const rows = result && Array.isArray(result.rows) ? result.rows : [];
    return rows.length === 1 ? parseValue(rows[0]) : null;
  }

  async function set(storeKey, value) {
    const normalized = key(storeKey);
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new TypeError('auth_limit_value_required');
    }
    await query(
      'INSERT INTO payrollcheck.auth_limits (key, value) VALUES ($1::text, $2::jsonb) ' +
        'ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()',
      [normalized, JSON.stringify(value)],
    );
  }

  async function deleteStoreValue(storeKey) {
    const normalized = key(storeKey);
    await query(
      'DELETE FROM payrollcheck.auth_limits WHERE key = $1::text',
      [normalized],
    );
  }

  async function incrementAttempts({
    key: storeKey,
    now,
    maxFailedAttempts,
    lockoutMs,
  } = {}) {
    const normalized = key(storeKey);
    if (!Number.isSafeInteger(now) || !Number.isInteger(maxFailedAttempts) ||
        maxFailedAttempts < 1 || !Number.isSafeInteger(lockoutMs) || lockoutMs < 1) {
      throw new TypeError('invalid_attempt_increment');
    }
    const result = await query(
      `INSERT INTO payrollcheck.auth_limits (key, value)
       VALUES (
         $1::text,
         jsonb_build_object(
           'count', 1,
           'firstFailureAt', $2::bigint,
           'lockedUntil', 0
         )
       )
       ON CONFLICT (key) DO UPDATE SET
         value = CASE
           WHEN COALESCE((payrollcheck.auth_limits.value->>'lockedUntil')::bigint, 0) > 0
             AND $2::bigint >= (payrollcheck.auth_limits.value->>'lockedUntil')::bigint
           THEN jsonb_build_object(
             'count', 1,
             'firstFailureAt', $2::bigint,
             'lockedUntil', 0
           )
           ELSE jsonb_build_object(
             'count', COALESCE((payrollcheck.auth_limits.value->>'count')::integer, 0) + 1,
             'firstFailureAt',
               CASE
                 WHEN COALESCE((payrollcheck.auth_limits.value->>'firstFailureAt')::bigint, 0) > 0
                 THEN (payrollcheck.auth_limits.value->>'firstFailureAt')::bigint
                 ELSE $2::bigint
               END,
             'lockedUntil',
               CASE
                 WHEN COALESCE((payrollcheck.auth_limits.value->>'count')::integer, 0) + 1 >= $3
                 THEN $2::bigint + $4::bigint
                 ELSE 0
               END
           )
         END,
         updated_at = now()
       RETURNING value`,
      [normalized, now, maxFailedAttempts, lockoutMs],
    );
    const rows = result && Array.isArray(result.rows) ? result.rows : [];
    return rows.length === 1 ? parseValue(rows[0]) : null;
  }

  async function incrementRateLimit({
    key: storeKey,
    now,
    windowMs,
    maxRequests,
  } = {}) {
    const normalized = key(storeKey);
    if (!Number.isSafeInteger(now) || !Number.isSafeInteger(windowMs) || windowMs < 1 ||
        !Number.isInteger(maxRequests) || maxRequests < 1) {
      throw new TypeError('invalid_rate_increment');
    }
    const result = await query(
      `INSERT INTO payrollcheck.auth_limits (key, value)
       VALUES (
         $1::text,
         jsonb_build_object('count', 1, 'windowStart', $2::bigint)
       )
       ON CONFLICT (key) DO UPDATE SET
         value = CASE
           WHEN COALESCE((payrollcheck.auth_limits.value->>'windowStart')::bigint, 0) = 0
             OR $2::bigint - (payrollcheck.auth_limits.value->>'windowStart')::bigint >= $3::bigint
           THEN jsonb_build_object('count', 1, 'windowStart', $2::bigint)
           ELSE jsonb_build_object(
             'count', COALESCE((payrollcheck.auth_limits.value->>'count')::integer, 0) + 1,
             'windowStart', (payrollcheck.auth_limits.value->>'windowStart')::bigint
           )
         END,
         updated_at = now()
       RETURNING value`,
      [normalized, now, windowMs],
    );
    const rows = result && Array.isArray(result.rows) ? result.rows : [];
    return rows.length === 1 ? parseValue(rows[0]) : null;
  }

  return Object.freeze({
    get,
    set,
    delete: deleteStoreValue,
    incrementAttempts,
    incrementRateLimit,
  });
}
