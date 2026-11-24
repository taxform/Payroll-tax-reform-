// Server-only Supabase Auth admin provisioning for PayrollCheck 360
// (M2 step 6).
//
// Creates and deletes Supabase Auth users through the Auth Admin API
// (POST/DELETE {projectUrl}/auth/v1/admin/users) using the service-role
// key. This is the first half of admin provisioning: the second half —
// the membership row that binds the Auth user to a tenant and a
// server-assigned subject_id — lives in payrollcheck-tenancy.mjs, and
// the two are orchestrated by payrollcheck-provisioning.mjs (which rolls
// the Auth user back if the membership insert fails).
//
// The service-role key arrives as injected config (server-side only —
// the call site reads it from its environment, e.g.
// SUPABASE_SERVICE_ROLE_KEY). Never log the key, the password, or the
// response body.
//
// NOTE: the endpoint shapes are from Supabase Auth's public API surface
// (GoTrue Admin API) and have not yet been exercised against the dev
// project. Step 9 acceptance must create a real Auth user in the dev
// project before provisioning is offered to admins.

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

function validEmail(value) {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= 256 &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
  );
}

function assertCommon({ projectUrl, serviceRoleKey, fetchImpl }) {
  if (!validProjectUrl(projectUrl)) throw new TypeError('invalid_project_url');
  if (typeof serviceRoleKey !== 'string' || !serviceRoleKey) {
    throw new TypeError('service_role_key_required');
  }
  if (typeof fetchImpl !== 'function') throw new TypeError('fetch_required');
  return new URL(projectUrl).origin;
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function createAuthUser({
  projectUrl,
  serviceRoleKey,
  email,
  password,
  emailConfirm = true,
  userMetadata,
  fetchImpl = globalThis.fetch,
} = {}) {
  const origin = assertCommon({ projectUrl, serviceRoleKey, fetchImpl });
  if (!validEmail(email)) throw new TypeError('invalid_email');
  if (typeof emailConfirm !== 'boolean') throw new TypeError('email_confirm_must_be_boolean');
  // Password is optional: without one the user is created with no password
  // and sets it via the step-4c recovery email (the invite path). When
  // supplied it must be at least 8 characters (GoTrue's default minimum
  // is 6; 8 is this step's choice).
  if (password !== undefined && (typeof password !== 'string' || password.length < 8)) {
    throw new TypeError('password_must_be_at_least_8_characters');
  }
  if (
    userMetadata !== undefined &&
    (typeof userMetadata !== 'object' || userMetadata === null || Array.isArray(userMetadata))
  ) {
    throw new TypeError('user_metadata_must_be_an_object');
  }
  const body = { email, email_confirm: emailConfirm };
  if (password !== undefined) body.password = password;
  if (userMetadata !== undefined) body.user_metadata = userMetadata;
  const response = await fetchImpl(`${origin}/auth/v1/admin/users`, {
    method: 'POST',
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!response || response.ok === false) {
    // Status only, no body echo.
    throw new Error(`admin user creation failed with status ${response ? response.status : 'unknown'}`);
  }
  const created = await response.json();
  const user = created && typeof created === 'object' ? (created.user ?? created) : null;
  if (!user || typeof user !== 'object' || typeof user.id !== 'string' || !user.id) {
    throw new Error('admin user creation returned an unexpected response');
  }
  return user;
}

export async function deleteAuthUser({
  projectUrl,
  serviceRoleKey,
  authUserId,
  fetchImpl = globalThis.fetch,
} = {}) {
  const origin = assertCommon({ projectUrl, serviceRoleKey, fetchImpl });
  if (typeof authUserId !== 'string' || !UUID_PATTERN.test(authUserId)) {
    throw new TypeError('auth_user_id_must_be_a_uuid');
  }
  const response = await fetchImpl(
    `${origin}/auth/v1/admin/users/${encodeURIComponent(authUserId)}`,
    {
      method: 'DELETE',
      headers: {
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
      },
    },
  );
  if (!response || response.ok === false) {
    throw new Error(`admin user deletion failed with status ${response ? response.status : 'unknown'}`);
  }
  return { ok: true };
}
