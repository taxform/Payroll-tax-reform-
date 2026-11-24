// Server-only Supabase Auth REST client for PayrollCheck 360 (M2 step 9).
//
// Plain fetch against the GoTrue REST endpoints — no @supabase/supabase-js
// dependency exists in this repo (package.json has no Supabase SDK), so the
// login handler talks to Auth the same way steps 5/6 do: injected fetch,
// injected config, status-only errors, nothing logged.
//
// Two operations, both server-side only:
//   - getVerifiedUser(accessToken): GET /auth/v1/user with the user's
//     Bearer token + the anon apiKey. This is Supabase Auth getUser on the
//     server — the "verified user" the step-2 adapter and the step-8
//     handler require. Throws on any non-2xx (a forged/expired/revoked
//     token must fail loudly here; callers map it to 401).
//   - signInWithPassword({ email, password }): POST
//     /auth/v1/token?grant_type=password. Returns the GoTrue session
//     ({ access_token, refresh_token, user, ... }). The access token is
//     returned to the CALLER (the server login handler), never to the
//     browser — the handler seals it into a pending blob (MFA) or uses
//     it once and discards it (no-MFA login).
//
// Validation runs before any fetch. Non-2xx throws
// Error('supabase auth request failed with status N') — status only, no
// body echo (a body could contain user data). Network errors propagate.
// No token, password, or response body is ever logged.
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_TOKEN_LENGTH = 16384;
const MAX_PASSWORD_LENGTH = 256;

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

export function createSupabaseAuthRest({
  supabaseUrl,
  anonKey,
  fetchImpl = globalThis.fetch,
} = {}) {
  if (!validProjectUrl(supabaseUrl)) throw new TypeError('invalid_supabase_url');
  if (typeof anonKey !== 'string' || !anonKey) {
    throw new TypeError('anon_key_required');
  }
  if (typeof fetchImpl !== 'function') throw new TypeError('fetch_required');
  const origin = new URL(supabaseUrl).origin;

  async function request(path, { method = 'GET', headers = {}, body } = {}) {
    let response;
    try {
      response = await fetchImpl(`${origin}${path}`, {
        method,
        headers: { apikey: anonKey, ...headers },
        ...(body !== undefined ? { body } : {}),
      });
    } catch (error) {
      throw error;
    }
    if (!response || response.ok !== true) {
      const status =
        response && Number.isSafeInteger(response.status) ? response.status : 0;
      throw new Error(`supabase auth request failed with status ${status}`);
    }
    let data;
    try {
      data = await response.json();
    } catch {
      throw new Error('supabase auth request failed with status 0');
    }
    return data;
  }

  async function getVerifiedUser(accessToken) {
    if (
      typeof accessToken !== 'string' ||
      accessToken.length === 0 ||
      accessToken.length > MAX_TOKEN_LENGTH
    ) {
      throw new TypeError('access_token_invalid');
    }
    const data = await request('/auth/v1/user', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const user = data && typeof data === 'object' ? (data.user ?? data) : null;
    if (!user || typeof user !== 'object' || !UUID_PATTERN.test(user.id)) {
      throw new Error('supabase auth request failed with status 0');
    }
    return user;
  }

  async function signInWithPassword({ email, password } = {}) {
    if (typeof email !== 'string' || !EMAIL_PATTERN.test(email)) {
      throw new TypeError('email_invalid');
    }
    if (
      typeof password !== 'string' ||
      password.length === 0 ||
      password.length > MAX_PASSWORD_LENGTH
    ) {
      throw new TypeError('password_invalid');
    }
    const data = await request('/auth/v1/token?grant_type=password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    if (
      !data ||
      typeof data !== 'object' ||
      typeof data.access_token !== 'string' ||
      !data.access_token ||
      !data.user ||
      typeof data.user !== 'object' ||
      !UUID_PATTERN.test(data.user.id)
    ) {
      throw new Error('supabase auth request failed with status 0');
    }
    return data;
  }

  return Object.freeze({ getVerifiedUser, signInWithPassword });
}
