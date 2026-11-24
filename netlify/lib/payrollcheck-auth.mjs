// Shared Netlify adapter for the PayrollCheck 360 staging login flow
// (M2 step 9). Builds the step-9 auth composition ONCE per function
// instance, wiring the real step 2–8 collaborators behind it, and gives
// each .mts function the small HTTP helpers it needs.
//
// Env (server-side only, Netlify site settings — never in the repo):
//   PAYROLLCHECK_SUPABASE_URL            e.g. https://<ref>.supabase.co
//   PAYROLLCHECK_SUPABASE_ANON_KEY       anon/public key (GoTrue + MFA)
//   PAYROLLCHECK_SUPABASE_SERVICE_ROLE_KEY  service-role key (Admin API + recovery)
//   PAYROLLCHECK_DATABASE_URL            Supabase Postgres, sslmode=require,
//                                        payrollcheck_app role (step 7)
//   PAYROLLCHECK_SESSION_SECRET          >= 32 chars, server-session HMAC
//   PAYROLLCHECK_PENDING_KEY             32 bytes, base64 (pending MFA blob)
//   PAYROLLCHECK_APP_URL                 default https://payrolltaxreform.com
//
// A missing/invalid variable fails LOUDLY at first use: the function
// answers 503 { error: 'unavailable' } and logs only the VARIABLE NAME,
// never a value. Nothing in this file logs a token, a password, an
// email, a session id, or report content.
//
// STAGING LIMIT (do not carry into prod): the auth-limits store below
// is an in-memory Map per function instance. Lockout and rate-limit
// state therefore does not survive a cold start and is not shared
// across instances. That is acceptable for staging (fabricated data,
// a handful of test accounts) and NOT for production: step 10 must
// back createAuthLimits with the Postgres auth_limits table (see the
// step-9 design note) before any prod pilot.
import pg from 'pg';
import { createPayrollcheckRequestScope } from '../../src/payrollcheck/payrollcheck-request-scope.mjs';
import { setRlsIdentity } from '../../src/payrollcheck/payrollcheck-rls-identity.mjs';
import { createSupabaseAuthRest } from '../../src/payrollcheck/supabase-auth-rest.mjs';
import { createSupabaseAdminUser } from '../../src/payrollcheck/payrollcheck-admin-user.mjs';
import { createSupabaseEmailConfirmation } from '../../src/payrollcheck/supabase-admin-email-check.mjs';
import { createSupabaseJwksVerifier } from '../../src/payrollcheck/supabase-jwks-verifier.mjs';
import { createRequireAal2 } from '../../src/payrollcheck/supabase-aal2-check.mjs';
import { createSupabaseInternalUserMapping } from '../../src/payrollcheck/supabase-internal-user-mapping.mjs';
import { createPayrollcheckTenancy } from '../../src/payrollcheck/payrollcheck-tenancy.mjs';
import { createPostgresSessionStore } from '../../src/payrollcheck/postgres-session-store.mjs';
import { createServerSession } from '../../src/payrollcheck/payrollcheck-server-session.mjs';
import { createReportAccessHandler } from '../../src/payrollcheck/payrollcheck-report-access.mjs';
import { createReportSessionLookup } from '../../src/payrollcheck/payrollcheck-report-session-lookup.mjs';
import { authorizeSupabaseTenantSession } from '../../src/payrollcheck/supabase-session-membership.mjs';
import { createAuthLimits } from '../../src/payrollcheck/payrollcheck-auth-limits.mjs';
import {
  listMfaFactors,
  enrollTotpFactor,
  challengeMfaFactor,
  verifyMfaChallenge,
} from '../../src/payrollcheck/supabase-mfa.mjs';
import { requestPasswordRecovery } from '../../src/payrollcheck/payrollcheck-password-recovery.mjs';
import { createPendingTokenSealer } from '../../src/payrollcheck/payrollcheck-pending-token.mjs';
import { createPayrollcheckAuth } from '../../src/payrollcheck/payrollcheck-auth-composition.mjs';

const { Pool } = pg;

export const MAX_BODY_BYTES = 64 * 1024;

function requiredEnv(name) {
  const value = process.env[name];
  if (typeof value !== 'string' || value.length === 0) {
    const error = new Error(`missing_env_${name}`);
    error.code = 'missing_env';
    error.envName = name;
    throw error;
  }
  return value;
}

function createInMemoryLimitsStore() {
  // STAGING ONLY — see the file header. Same get/set/delete shape the
  // step-4c module expects; values are plain attempt/rate records.
  const data = new Map();
  return {
    get: async (key) => (data.has(key) ? data.get(key) : null),
    set: async (key, value) => {
      data.set(key, value);
    },
    delete: async (key) => {
      data.delete(key);
    },
  };
}

let cached = null;

export function getAuthComposition() {
  if (cached) return cached;

  const supabaseUrl = requiredEnv('PAYROLLCHECK_SUPABASE_URL');
  const anonKey = requiredEnv('PAYROLLCHECK_SUPABASE_ANON_KEY');
  const serviceRoleKey = requiredEnv('PAYROLLCHECK_SUPABASE_SERVICE_ROLE_KEY');
  const databaseUrl = requiredEnv('PAYROLLCHECK_DATABASE_URL');
  const sessionSecret = requiredEnv('PAYROLLCHECK_SESSION_SECRET');
  const pendingKey = requiredEnv('PAYROLLCHECK_PENDING_KEY');
  const appUrl = process.env.PAYROLLCHECK_APP_URL || 'https://payrolltaxreform.com';

  // One pool per function instance. The connection string must carry
  // sslmode=require (Supabase Postgres requires TLS), but the Supabase
  // transaction pooler presents a certificate chain Node's default CA
  // store does not trust, so verification must be off: without
  // rejectUnauthorized: false the pooler connection fails with
  // "self-signed certificate in certificate chain" (diagnosed Nov 24,
  // 2026). TLS still encrypts the connection; only chain verification
  // is skipped. Staging only — step 10 should pin Supabase's CA
  // certificate instead before any prod pilot.
  const pool = new Pool({
    connectionString: databaseUrl,
    max: 5,
    ssl: { rejectUnauthorized: false },
  });
  // TEMPORARY DEBUG — revert once the staging login 503 is diagnosed.
  // Logs only whether the connection string carries sslmode=no-verify,
  // never the URL or any credential.
  console.info(
    JSON.stringify({
      source: 'payrollcheck-auth',
      event: 'pool_config',
      sslNoVerify: databaseUrl.includes('sslmode=no-verify'),
    }),
  );
  pool.on('error', (error) => {
    console.error('payrollcheck pool error:', error instanceof Error ? error.message : 'unknown');
  });

  const { withTransaction } = createPayrollcheckRequestScope({ pool });

  const authRest = createSupabaseAuthRest({ supabaseUrl, anonKey });
  const adminUser = createSupabaseAdminUser({ supabaseUrl, serviceRoleKey });
  const emailConfirmation = createSupabaseEmailConfirmation({
    projectUrl: supabaseUrl,
    serviceRoleKey,
  });
  const jwksVerifier = createSupabaseJwksVerifier({ issuer: `${supabaseUrl}/auth/v1` });
  const requireAal2 = createRequireAal2({ verifyAccessToken: jwksVerifier.verifyAccessToken });
  const pendingSealer = createPendingTokenSealer({ key: pendingKey });
  const authLimits = createAuthLimits({ store: createInMemoryLimitsStore() });

  const composition = createPayrollcheckAuth({
    withTransaction,
    setRlsIdentity,
    signInWithPassword: (args) => authRest.signInWithPassword(args),
    fetchAdminUser: (authUserId) => adminUser.fetchAdminUser(authUserId),
    verifyEmailConfirmed: (authUserId) => emailConfirmation.verifyEmailConfirmed(authUserId),
    requireAal2,
    mappingFactory: ({ query }) => createSupabaseInternalUserMapping({ query }),
    tenancyFactory: ({ query }) => createPayrollcheckTenancy({ query }),
    sessionStoreFactory: ({ query }) => createPostgresSessionStore({ query }),
    sessionLayerFactory: ({ store }) => createServerSession({ store, secret: sessionSecret }),
    reportHandlerFactory: (deps) => createReportAccessHandler(deps),
    reportSessionLookupFactory: ({ store }) => createReportSessionLookup({ store }),
    authorizeTenantSession: authorizeSupabaseTenantSession,
    authLimits,
    listMfaFactors: (args) => listMfaFactors({ supabaseUrl, apiKey: anonKey, ...args }),
    enrollTotpFactor: (args) => enrollTotpFactor({ supabaseUrl, apiKey: anonKey, ...args }),
    challengeMfaFactor: (args) => challengeMfaFactor({ supabaseUrl, apiKey: anonKey, ...args }),
    verifyMfaChallenge: (args) => verifyMfaChallenge({ supabaseUrl, apiKey: anonKey, ...args }),
    requestPasswordRecovery: (args) =>
      requestPasswordRecovery({ supabaseUrl, serviceRoleKey, ...args }),
    pendingSeal: (payload) => pendingSealer.seal(payload),
    pendingOpen: (blob) => pendingSealer.open(blob),
    appUrl,
    log: (event) => {
      // The composition's log events carry only { requestId, route,
      // status, reason } — safe to emit to the function logs.
      console.info(JSON.stringify({ source: 'payrollcheck-auth', ...event }));
    },
  });

  cached = composition;
  return composition;
}

export function clientIp(req) {
  const forwarded = req.headers.get('x-forwarded-for');
  if (typeof forwarded === 'string' && forwarded) {
    const first = forwarded.split(',')[0].trim();
    if (first) return first;
  }
  return 'unknown';
}

export async function readJsonBody(req) {
  const text = await req.text();
  if (text.length > MAX_BODY_BYTES) {
    const error = new Error('body_too_large');
    error.code = 'body_too_large';
    throw error;
  }
  if (!text) return {};
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    const error = new Error('body_invalid_json');
    error.code = 'body_invalid_json';
    throw error;
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    const error = new Error('body_invalid_json');
    error.code = 'body_invalid_json';
    throw error;
  }
  return data;
}

export function jsonResponse({ status, headers = {}, body = {} }) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      ...headers,
    },
  });
}

export function methodNotAllowed() {
  return jsonResponse({
    status: 405,
    headers: { Allow: 'POST' },
    body: { error: 'method_not_allowed' },
  });
}

export function unavailable(error) {
  if (error && error.code === 'missing_env') {
    console.error(`payrollcheck auth misconfigured: missing ${error.envName}`);
  } else if (error && error.code === 'body_too_large') {
    return jsonResponse({ status: 413, body: { error: 'invalid_request' } });
  } else if (error && error.code === 'body_invalid_json') {
    return jsonResponse({ status: 400, body: { error: 'invalid_request' } });
  }
  console.error('payrollcheck auth unavailable:', error instanceof Error ? error.message : 'unknown');
  return jsonResponse({ status: 503, body: { error: 'unavailable' } });
}
