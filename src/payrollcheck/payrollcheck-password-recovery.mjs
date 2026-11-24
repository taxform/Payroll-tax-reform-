// Password-reset email via the Supabase Auth API (M2 step 4c).
//
// Server-side only: the service-role key is injected config, never stored
// in the repo and never logged (this module logs nothing at all).
//
// Supabase's /auth/v1/recover returns 200 even for unknown emails (no
// account enumeration), so callers must always show the same message:
// "if an account exists, an email is on its way" — never reveal whether
// the email exists.
//
// NOTE: the endpoint shape is from Supabase Auth's public API surface and
// has not yet been exercised against the dev project. Step 9 acceptance
// must fire one real recovery request against the staging project and
// confirm the email arrives before recovery is offered to users.

function assertHttpsUrl(value, name) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${name} must be a non-empty string`);
  }
  let parsed;
  try {
    parsed = new URL(value.trim());
  } catch {
    throw new Error(`${name} must be a valid URL`);
  }
  if (parsed.protocol !== 'https:') {
    throw new Error(`${name} must use https`);
  }
  return value.trim().replace(/\/+$/, '');
}

export async function requestPasswordRecovery({
  supabaseUrl,
  serviceRoleKey,
  email,
  redirectTo,
  fetchImpl = globalThis.fetch,
} = {}) {
  const baseUrl = assertHttpsUrl(supabaseUrl, 'supabaseUrl');
  if (typeof serviceRoleKey !== 'string' || serviceRoleKey.length === 0) {
    throw new Error('serviceRoleKey must be a non-empty string');
  }
  if (
    typeof email !== 'string' ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())
  ) {
    throw new Error('email must be a valid email address');
  }
  const redirect = redirectTo === undefined ? undefined : assertHttpsUrl(redirectTo, 'redirectTo');
  if (typeof fetchImpl !== 'function') {
    throw new Error('fetchImpl must be a function');
  }

  const body = { email: email.trim() };
  if (redirect !== undefined) {
    body.redirect_to = redirect;
  }

  const response = await fetchImpl(`${baseUrl}/auth/v1/recover`, {
    method: 'POST',
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    // Status only, no body echo: error bodies can carry details that do
    // not belong in logs or user-facing messages.
    throw new Error(`password recovery request failed with status ${response.status}`);
  }
  return { ok: true };
}
