// Per-request Postgres transaction scope for PayrollCheck 360 (M2 step 9).
//
// One pooled connection per request, in the exact order the step-7
// wiring requires (step-7 §8):
//   1. BEGIN
//   2. the caller's queries (including setRlsIdentity — the caller owns
//      the identity sequence, this module only owns the transaction)
//   3. COMMIT on a returned result, ROLLBACK on a throw
//   4. release the client back to the pool, always
//
// COMMIT-ON-DENY (the rule that makes the audit trail work): the
// callback returns normally for a *handled* decision — including a
// step-8 denial — so the transaction COMMITS and the audit row the
// handler just wrote persists. ROLLBACK happens only when the callback
// throws (an unexpected error / DB failure); the audit row is lost
// with it, but then the failure itself is the loud signal and the edge
// log records the request id + failure class. Rolling back on a denial
// would silently erase the audit row — the exact failure the step-8
// audit design forbids.
//
// READ COMMITTED (the step-8 recheck requirement): this module NEVER
// issues a SET TRANSACTION ISOLATION LEVEL — Postgres defaults to READ
// COMMITTED, and each statement then sees a new snapshot, so the
// consent recheck immediately before release observes a concurrent
// revocation. A stricter level would make the recheck useless. The
// test asserts no isolation statement is ever sent.
//
// The pool is injected ({ connect() -> client { query, release } } —
// the pg Pool shape). The client is released in a finally, even when
// BEGIN itself throws (a client that failed to BEGIN is still released;
// a connect() failure means there is no client to release).
export function createPayrollcheckRequestScope({ pool } = {}) {
  if (!pool || typeof pool.connect !== 'function') {
    throw new TypeError('pool_required');
  }

  async function withTransaction(fn) {
    if (typeof fn !== 'function') throw new TypeError('transaction_fn_required');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const query = (sql, values) => client.query(sql, values);
      const result = await fn({ query });
      await client.query('COMMIT');
      return result;
    } catch (error) {
      try {
        await client.query('ROLLBACK');
      } catch {
        // Best effort: the original error is the one that matters.
      }
      throw error;
    } finally {
      client.release();
    }
  }

  return Object.freeze({ withTransaction });
}
