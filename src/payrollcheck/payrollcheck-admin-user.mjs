// Server-only Supabase Admin API user fetch for PayrollCheck 360 (M2 step 9).
//
// The cookie binding's `getVerifiedUser`: the report endpoint has no
// Supabase access token at request time (the browser holds only the
// server session cookie — the Supabase tokens were discarded at login),
// so the step-8 handler's token verification is satisfied by a FRESH
// server-side Admin API read instead: GET /auth/v1/admin/users/{id}
// with the injected service-role key returns the full user object
// (id, email_confirmed_at, is_anonymous) straight from Auth. Nothing
// is assumed from the session and nothing is fabricated — the
// `email_confirmed_at` the handler checks comes from this live read.
//
// This is a deliberate, documented deviation from the handler's Bearer
// flow (see the design note §3): the session layer already verified the
// user at login, and this read re-verifies the account state on every
// report request. Cost: one Admin API call per report request. If that
// cost matters later, the session-attested alternative (return the
// session's issuance proof instead of a fresh read) is a follow-up the
// security review can rule on — it is NOT done here, because a fresh
// read is the fail-closed choice.
//
// Validation runs before any fetch. Non-2xx throws
// Error('admin user request failed with status N') — status only, no
// body echo. Network errors propagate. Nothing is logged.
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function validProjectUrl(value) {
  if (typeof value !== 'string') return false;
  let url;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  return (
    url.protocol === 'https:' &&
    url.hostname.endsWith('.supabase.co') &&
    !url.search &&
    !url.hash
  );
}

export function createSupabaseAdminUser({
  supabaseUrl,
  serviceRoleKey,
  fetchImpl = globalThis.fetch,
} = {}) {
  if (!validProjectUrl(supabaseUrl)) throw new TypeError('invalid_supabase_url');
  if (typeof serviceRoleKey !== 'string' || !serviceRoleKey) {
    throw new TypeError('service_role_key_required');
  }
  if (typeof fetchImpl !== 'function') throw new TypeError('fetch_required');
  const origin = new URL(supabaseUrl).origin;

  async function fetchAdminUser(authUserId) {
    if (typeof authUserId !== 'string' || !UUID_PATTERN.test(authUserId)) {
      throw new TypeError('auth_user_id_must_be_a_uuid');
    }
    let response;
    try {
      response = await fetchImpl(
        `${origin}/auth/v1/admin/users/${encodeURIComponent(authUserId)}`,
        {
          headers: {
            apikey: serviceRoleKey,
            Authorization: `Bearer ${serviceRoleKey}`,
          },
        },
      );
    } catch (error) {
      throw error;
    }
    if (!response || response.ok !== true) {
      const status =
        response && Number.isSafeInteger(response.status) ? response.status : 0;
      throw new Error(`admin user request failed with status ${status}`);
    }
    let body;
    try {
      body = await response.json();
    } catch {
      throw new Error('admin user request failed with status 0');
    }
    const user = body && typeof body === 'object' ? (body.user ?? body) : null;
    if (!user || typeof user !== 'object' || user.id !== authUserId) {
      throw new Error('admin user request failed with status 0');
    }
    return user;
  }

  return Object.freeze({ fetchAdminUser });
}
