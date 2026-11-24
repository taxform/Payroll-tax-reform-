// Server-only Supabase email-confirmation lookup. No SDK.
// Checks a user's confirmed-email status through the trusted Supabase Auth
// Admin API (GET {projectUrl}/auth/v1/admin/users/{sub}) using the
// service-role key. The access token is NEVER trusted for this: the docs
// forbid assuming email_confirmed_at from token claims.
// Confirmed means: the Admin API returns the user, user.email_confirmed_at
// is a non-empty string, and user.is_anonymous is not true.
// Fail closed: any error, non-OK response, or unexpected shape returns false.
// The service-role key arrives as injected config (server-side only — the
// call site reads it from its environment, e.g. SUPABASE_SERVICE_ROLE_KEY).
// Never log the key or the response body.
const uuid = (x) =>
  typeof x === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(x);

function validProjectUrl(value) {
  if (typeof value !== 'string' || !value) return false;
  let url;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  return (
    url.protocol === 'https:' &&
    /^[a-z0-9-]+\.supabase\.co$/.test(url.hostname) &&
    url.pathname === '/' &&
    !url.username &&
    !url.password &&
    !url.search &&
    !url.hash
  );
}

export function createSupabaseEmailConfirmation({
  projectUrl,
  serviceRoleKey,
  fetchImpl = globalThis.fetch,
} = {}) {
  if (!validProjectUrl(projectUrl)) throw new TypeError('invalid_project_url');
  if (typeof serviceRoleKey !== 'string' || !serviceRoleKey) {
    throw new TypeError('service_role_key_required');
  }
  if (typeof fetchImpl !== 'function') throw new TypeError('fetch_required');
  const origin = new URL(projectUrl).origin;

  async function verifyEmailConfirmed(sub) {
    if (!uuid(sub)) return false;
    let response;
    try {
      response = await fetchImpl(`${origin}/auth/v1/admin/users/${encodeURIComponent(sub)}`, {
        headers: {apikey: serviceRoleKey, Authorization: `Bearer ${serviceRoleKey}`},
      });
    } catch {
      return false;
    }
    if (!response || response.ok === false) return false;
    let body;
    try {
      body = await response.json();
    } catch {
      return false;
    }
    const user = body && typeof body === 'object' ? (body.user ?? body) : null;
    if (!user || typeof user !== 'object') return false;
    if (user.id !== sub) return false;
    if (user.is_anonymous === true) return false;
    return typeof user.email_confirmed_at === 'string' && user.email_confirmed_at.length > 0;
  }

  return Object.freeze({verifyEmailConfirmed});
}
