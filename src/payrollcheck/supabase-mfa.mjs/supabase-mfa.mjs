// Supabase Auth MFA (TOTP) lifecycle for PayrollCheck 360 (M2 step 5).
//
// The calls a user needs to reach aal2: list factors, enroll a TOTP factor,
// challenge a factor, verify a challenge (returns a new session whose
// access token carries aal "aal2"), and unenroll a factor.
//
// All calls act on the calling user, so they authenticate with the USER's
// access token (Bearer) — never the service-role key. `apiKey` is the
// project's Supabase anon key, injected config, server-side only. Nothing
// is logged.
//
// The enroll response contains totp.secret / totp.qr_code / totp.uri. The
// caller must show the secret/QR to the user once and never log or store
// it. This module returns the parsed response as-is.
//
// NOTE: the endpoint shapes are from Supabase Auth's public API surface
// (GoTrue MFA) and have not yet been exercised against the dev project.
// Step 9 acceptance must run a real enroll -> challenge -> verify
// round-trip against the staging project and confirm the returned token
// carries aal "aal2" before MFA is offered to users.

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

function assertApiKey(apiKey) {
  if (typeof apiKey !== 'string' || apiKey.length === 0) {
    throw new Error('apiKey must be a non-empty string');
  }
  return apiKey;
}

function assertAccessToken(accessToken) {
  if (typeof accessToken !== 'string' || accessToken.length === 0) {
    throw new Error('accessToken must be a non-empty string');
  }
  return accessToken;
}

function assertUuid(value, name) {
  if (typeof value !== 'string' || !UUID_PATTERN.test(value)) {
    throw new Error(`${name} must be a UUID`);
  }
  return value;
}

function assertFetch(fetchImpl) {
  if (typeof fetchImpl !== 'function') {
    throw new Error('fetchImpl must be a function');
  }
  return fetchImpl;
}

async function mfaRequest({ baseUrl, apiKey, accessToken, fetchImpl, path, method, body }) {
  const response = await fetchImpl(`${baseUrl}${path}`, {
    method,
    headers: {
      apikey: apiKey,
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (!response.ok) {
    // Status only, no body echo: error bodies can carry details that do
    // not belong in logs or user-facing messages.
    throw new Error(`mfa request failed with status ${response.status}`);
  }
  if (response.status === 204) {
    return { ok: true };
  }
  return response.json();
}

function common({ supabaseUrl, apiKey, accessToken, fetchImpl }) {
  return {
    baseUrl: assertHttpsUrl(supabaseUrl, 'supabaseUrl'),
    apiKey: assertApiKey(apiKey),
    accessToken: assertAccessToken(accessToken),
    fetchImpl: assertFetch(fetchImpl),
  };
}

export async function listMfaFactors({ supabaseUrl, apiKey, accessToken, fetchImpl = globalThis.fetch } = {}) {
  const { baseUrl, ...rest } = common({ supabaseUrl, apiKey, accessToken, fetchImpl });
  return mfaRequest({ baseUrl, ...rest, path: '/auth/v1/factors', method: 'GET' });
}

export async function enrollTotpFactor({
  supabaseUrl,
  apiKey,
  accessToken,
  friendlyName,
  issuer,
  fetchImpl = globalThis.fetch,
} = {}) {
  const { baseUrl, ...rest } = common({ supabaseUrl, apiKey, accessToken, fetchImpl });
  if (typeof friendlyName !== 'string' || friendlyName.trim().length === 0) {
    throw new Error('friendlyName must be a non-empty string');
  }
  if (typeof issuer !== 'string' || issuer.trim().length === 0) {
    throw new Error('issuer must be a non-empty string');
  }
  return mfaRequest({
    baseUrl,
    ...rest,
    path: '/auth/v1/factors',
    method: 'POST',
    body: { friendly_name: friendlyName.trim(), factor_type: 'totp', issuer: issuer.trim() },
  });
}

export async function challengeMfaFactor({
  supabaseUrl,
  apiKey,
  accessToken,
  factorId,
  fetchImpl = globalThis.fetch,
} = {}) {
  const { baseUrl, ...rest } = common({ supabaseUrl, apiKey, accessToken, fetchImpl });
  const id = assertUuid(factorId, 'factorId');
  return mfaRequest({
    baseUrl,
    ...rest,
    path: `/auth/v1/factors/${id}/challenge`,
    method: 'POST',
    body: {},
  });
}

export async function verifyMfaChallenge({
  supabaseUrl,
  apiKey,
  accessToken,
  factorId,
  challengeId,
  code,
  fetchImpl = globalThis.fetch,
} = {}) {
  const { baseUrl, ...rest } = common({ supabaseUrl, apiKey, accessToken, fetchImpl });
  const factor = assertUuid(factorId, 'factorId');
  const challenge = assertUuid(challengeId, 'challengeId');
  if (typeof code !== 'string' || !/^\d{6}$/.test(code)) {
    throw new Error('code must be a 6-digit string');
  }
  return mfaRequest({
    baseUrl,
    ...rest,
    path: '/auth/v1/verify',
    method: 'POST',
    body: { type: 'totp', factor_id: factor, challenge_id: challenge, code },
  });
}

export async function unenrollMfaFactor({
  supabaseUrl,
  apiKey,
  accessToken,
  factorId,
  fetchImpl = globalThis.fetch,
} = {}) {
  const { baseUrl, ...rest } = common({ supabaseUrl, apiKey, accessToken, fetchImpl });
  const id = assertUuid(factorId, 'factorId');
  return mfaRequest({
    baseUrl,
    ...rest,
    path: `/auth/v1/factors/${id}`,
    method: 'DELETE',
  });
}
