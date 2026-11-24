// Report-path session lookup for PayrollCheck 360 (M2 step 9).
//
// THE GRACE BUG THIS FIXES: the step-8 handler calls
// `getSession(sessionId)` once and checks
// `record.previousSessionId === sessionId` for the 60s rotation grace.
// But the step-4b store's `get()` only matches the CURRENT session_id —
// a presented *previous* id returns null, so the handler's grace branch
// could never fire when bound directly to `store.get`. A client that
// presents the old id inside the grace window (an in-flight request
// racing a rotation) would be denied `unknown_session` even though the
// session is live.
//
// The fix is this one-line composition: try the current id, then the
// previous id. The step-4a `load()` already does exactly this internally
// (get + getByPreviousSessionId); the step-8 handler needs the same
// lookup behind its single `getSession` injection.
//
// NO snake_case→camelCase mapping is needed here (the step-8 handoff
// flagged it as an open item): the step-4b store's `toRecord` already
// returns camelCase records (sessionId, previousSessionId, graceUntil,
// userId, authUserId, aal2, createdAt, rotatedAt, lastSeenAt, expiresAt,
// revoked) — exactly the shape the handler expects. That concern is
// resolved by the store itself; this module only adds the grace lookup.
//
// Store errors propagate: the handler catches a throwing getSession and
// denies `session_lookup_failed` (401). A missing row returns null.
export function createReportSessionLookup({ store } = {}) {
  if (
    !store ||
    typeof store.get !== 'function' ||
    typeof store.getByPreviousSessionId !== 'function'
  ) {
    throw new TypeError('session_store_required');
  }

  async function getSession(sessionId) {
    const current = await store.get(sessionId);
    if (current) return current;
    return store.getByPreviousSessionId(sessionId);
  }

  return Object.freeze({ getSession });
}
