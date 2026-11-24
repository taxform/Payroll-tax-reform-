// Server-only mapping from a Supabase Auth UUID to the opaque internal user
// ID. The memberships table is the trusted record: each row binds one
// Supabase Auth user (auth_user_id) to one server-assigned opaque subject
// (subject_id) inside one tenant. A user may hold memberships in several
// tenants, but all of their rows carry the same subject_id, so the mapping is:
//   SELECT DISTINCT subject_id FROM payrollcheck.memberships
//   WHERE auth_user_id = $1::uuid AND active = true
// It resolves only when exactly one distinct subject_id comes back and it
// matches the internal-id shape ([A-Za-z0-9_-]{1,64}); anything else returns
// null — unknown user, inconsistent data, or no active membership.
// The query runs on the caller's non-BYPASSRLS connection with reviewed
// tenant-scoped RLS — never service_role/BYPASSRLS.
const uuid = (x) =>
  typeof x === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(x);
const id = (x) => typeof x === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(x);

export function createSupabaseInternalUserMapping({query} = {}) {
  if (typeof query !== 'function') throw new TypeError('query_required');

  async function resolveInternalUserId(sub) {
    if (!uuid(sub)) return null;
    let result;
    try {
      result = await query(
        'SELECT DISTINCT subject_id FROM payrollcheck.memberships WHERE auth_user_id = $1::uuid AND active = true',
        [sub],
      );
    } catch {
      return null;
    }
    const rows = result && Array.isArray(result.rows) ? result.rows : null;
    if (!rows || rows.length !== 1) return null;
    const subjectId = rows[0] && rows[0].subject_id;
    if (!id(subjectId)) return null;
    return subjectId;
  }

  return Object.freeze({resolveInternalUserId});
}
