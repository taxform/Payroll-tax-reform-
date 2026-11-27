// TaxBandits sandbox wiring tests (Slice 6): the live filing endpoint's token
// exchange and filing-client factory. Every TaxBandits call is a stub: no test
// here reaches TaxBandits, the sandbox or any other host.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import {
  TAXBANDITS_SANDBOX_TOKEN_URL,
  TAXBANDITS_SANDBOX_ENV_VARS,
  createTaxBanditsSandboxJws,
  createTaxBanditsSandboxTokenProvider,
  createTaxBanditsSandboxFilingClientFactory,
} from '../src/payrollcheck/payrollcheck-taxbandits-sandbox.mjs';
import { createFilingLoader } from '../src/payrollcheck/payrollcheck-filing.mjs';

const CLIENT_ID = 'sandbox-client-id';
const CLIENT_SECRET = 'sandbox-client-secret';
const USER_TOKEN = 'sandbox-user-token';
const NOW_SECONDS = 1793000000;
const SANDBOX_ENV = Object.freeze({
  TAXBANDITS_SANDBOX_CLIENT_ID: CLIENT_ID,
  TAXBANDITS_SANDBOX_CLIENT_SECRET: CLIENT_SECRET,
  TAXBANDITS_SANDBOX_USER_TOKEN: USER_TOKEN,
});
const SANDBOX_FORM_941_URL = 'https://testapi.taxbandits.com/v1/Form941/Create';
const SANDBOX_FORM_941_STATUS_URL =
  'https://testapi.taxbandits.com/v1/Form941/Status?SubmissionId=sub-1';

// Decode a JWS and check its HS256 signature against the client secret.
function verifySandboxJws(jws) {
  const [header, payload, signature] = jws.split('.');
  assert.equal([header, payload, signature].filter(Boolean).length, 3);
  assert.deepEqual(
    JSON.parse(Buffer.from(header, 'base64url').toString('utf8')),
    { alg: 'HS256', typ: 'JWT' },
  );
  const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  const expected = createHmac('sha256', CLIENT_SECRET)
    .update(`${header}.${payload}`)
    .digest();
  assert.deepEqual(Buffer.from(signature, 'base64url'), expected);
  return claims;
}

function makeTokenFetch({ token = 'sandbox-access-token', expiresIn = 3600, status = 200 } = {}) {
  const calls = [];
  const fetchMock = async (url, options = {}) => {
    calls.push({ url, options });
    if (url !== TAXBANDITS_SANDBOX_TOKEN_URL) throw new Error(`unexpected fetch: ${url}`);
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => ({
        StatusCode: status,
        AccessToken: token,
        TokenType: 'Bearer',
        ExpiresIn: expiresIn,
      }),
    };
  };
  return { calls, fetch: fetchMock };
}

function makeSandboxCredentials(overrides = {}) {
  return {
    clientId: CLIENT_ID,
    clientSecret: CLIENT_SECRET,
    userToken: USER_TOKEN,
    ...overrides,
  };
}

test('sandbox JWS carries the TaxBandits claims and an HS256 signature keyed by the client secret', async () => {
  const jws = await createTaxBanditsSandboxJws({
    clientId: CLIENT_ID,
    clientSecret: CLIENT_SECRET,
    userToken: USER_TOKEN,
    nowSeconds: NOW_SECONDS,
  });
  assert.deepEqual(verifySandboxJws(jws), {
    iss: CLIENT_ID,
    sub: CLIENT_ID,
    aud: USER_TOKEN,
    iat: NOW_SECONDS,
  });
});

test('sandbox JWS rejects missing credentials', async () => {
  await assert.rejects(
    () => createTaxBanditsSandboxJws({ clientSecret: CLIENT_SECRET, userToken: USER_TOKEN }),
    /TaxBandits sandbox credentials are required/,
  );
  await assert.rejects(
    () => createTaxBanditsSandboxJws({ clientId: CLIENT_ID, userToken: USER_TOKEN }),
    /TaxBandits sandbox credentials are required/,
  );
  await assert.rejects(
    () => createTaxBanditsSandboxJws({ clientId: CLIENT_ID, clientSecret: CLIENT_SECRET }),
    /TaxBandits sandbox credentials are required/,
  );
});

test('token provider GETs the sandbox token endpoint with the JWS and returns the access token', async () => {
  const { calls, fetch } = makeTokenFetch();
  const provider = createTaxBanditsSandboxTokenProvider({
    ...makeSandboxCredentials(),
    fetch,
    nowSeconds: () => NOW_SECONDS,
  });
  assert.equal(await provider.getAccessToken(), 'sandbox-access-token');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, TAXBANDITS_SANDBOX_TOKEN_URL);
  assert.equal(calls[0].options.method, 'GET');
  const claims = verifySandboxJws(calls[0].options.headers.Authentication);
  assert.equal(claims.iss, CLIENT_ID);
  assert.equal(claims.aud, USER_TOKEN);
  assert.equal(claims.iat, NOW_SECONDS);
});

test('token provider reuses the access token until shortly before expiry', async () => {
  const { calls, fetch } = makeTokenFetch({ expiresIn: 3600 });
  let now = NOW_SECONDS;
  const provider = createTaxBanditsSandboxTokenProvider({
    ...makeSandboxCredentials(),
    fetch,
    nowSeconds: () => now,
  });
  assert.equal(await provider.getAccessToken(), 'sandbox-access-token');
  assert.equal(await provider.getAccessToken(), 'sandbox-access-token');
  assert.equal(calls.length, 1);
  now = NOW_SECONDS + 3600 - 61;
  assert.equal(await provider.getAccessToken(), 'sandbox-access-token');
  assert.equal(calls.length, 1);
  now = NOW_SECONDS + 3600 - 60;
  assert.equal(await provider.getAccessToken(), 'sandbox-access-token');
  assert.equal(calls.length, 2);
});

test('token provider rejects a failed sandbox token exchange', async () => {
  const { fetch } = makeTokenFetch({ status: 401 });
  const provider = createTaxBanditsSandboxTokenProvider({
    ...makeSandboxCredentials(),
    fetch,
    nowSeconds: () => NOW_SECONDS,
  });
  await assert.rejects(() => provider.getAccessToken(), /TaxBandits sandbox token exchange failed: 401/);
});

test('token provider rejects a sandbox token exchange with no access token', async () => {
  const { fetch } = makeTokenFetch({ token: '' });
  const provider = createTaxBanditsSandboxTokenProvider({
    ...makeSandboxCredentials(),
    fetch,
    nowSeconds: () => NOW_SECONDS,
  });
  await assert.rejects(() => provider.getAccessToken(), /returned no access token/);
});

test('token provider refuses any token endpoint other than the sandbox one', () => {
  assert.throws(
    () => createTaxBanditsSandboxTokenProvider({
      ...makeSandboxCredentials(),
      tokenUrl: 'https://oauth.expressauth.net/v2/tbsauth',
    }),
    /TaxBandits sandbox token endpoint only/,
  );
});

test('filing-client factory is null when any sandbox credential is missing', () => {
  assert.deepEqual(TAXBANDITS_SANDBOX_ENV_VARS, [
    'TAXBANDITS_SANDBOX_CLIENT_ID',
    'TAXBANDITS_SANDBOX_CLIENT_SECRET',
    'TAXBANDITS_SANDBOX_USER_TOKEN',
  ]);
  assert.equal(createTaxBanditsSandboxFilingClientFactory({ env: {} }), null);
  for (const name of TAXBANDITS_SANDBOX_ENV_VARS) {
    const empty = { ...SANDBOX_ENV, [name]: '' };
    assert.equal(createTaxBanditsSandboxFilingClientFactory({ env: empty }), null);
    const missing = { ...SANDBOX_ENV };
    delete missing[name];
    assert.equal(createTaxBanditsSandboxFilingClientFactory({ env: missing }), null);
  }
});

function makeSandboxFetch() {
  const calls = [];
  const fetchMock = async (url, options = {}) => {
    calls.push({ url, options });
    if (url === TAXBANDITS_SANDBOX_TOKEN_URL) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          StatusCode: 200,
          AccessToken: 'sandbox-access-token',
          TokenType: 'Bearer',
          ExpiresIn: 3600,
        }),
      };
    }
    if (url === SANDBOX_FORM_941_URL) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ SubmissionId: 'sub-1', Status: 'Transmitted' }),
      };
    }
    if (url === SANDBOX_FORM_941_STATUS_URL) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ Status: 'Accepted' }),
      };
    }
    throw new Error(`unexpected fetch: ${url}`);
  };
  return { calls, fetch: fetchMock };
}

test('factory client submits Form 941 to the sandbox with the exchanged Bearer token', async () => {
  const { calls, fetch } = makeSandboxFetch();
  const factory = createTaxBanditsSandboxFilingClientFactory({ env: SANDBOX_ENV, fetch });
  assert.equal(typeof factory, 'function');
  const client = factory();
  const result = await client.submitFiling({ form: '941', payload: { Form941: { TaxYear: 2026 } } });
  assert.equal(result.ok, true);
  assert.equal(result.submissionId, 'sub-1');
  assert.equal(result.status, 'submitted');
  assert.equal(calls.length, 2);
  assert.equal(calls[0].url, TAXBANDITS_SANDBOX_TOKEN_URL);
  assert.equal(calls[1].url, SANDBOX_FORM_941_URL);
  assert.equal(calls[1].options.method, 'POST');
  assert.equal(calls[1].options.headers.Authorization, 'Bearer sandbox-access-token');
  assert.deepEqual(JSON.parse(calls[1].options.body), { Form941: { TaxYear: 2026 } });
  for (const call of calls) {
    assert.ok(
      call.url.startsWith('https://testoauth.expressauth.net/')
        || call.url.startsWith('https://testapi.taxbandits.com/'),
    );
  }
});

// Filing-loader fixtures: the same Q4 2026 period the filing tests use, so the
// sandbox 941 total is $462.15 (federal $156.15 plus twice the $153 FICA).
const FILING_TENANT = 'tenant-sandbox';
const COMPANY_ROW = Object.freeze({
  legal_name: 'Acme Widgets LLC',
  ein: '98-7654321',
  address_line1: '1 Factory Way',
  address_line2: null,
  city: 'Springfield',
  state: 'IL',
  postal_code: '62701',
  pay_schedule: 'biweekly',
  contact_email: 'filings@acme.example',
  contact_phone: '+1 (555) 010-1234',
  business_type: 'llc',
  signing_authority: 'Ada Lovelace, Owner',
});
const TAX_CENTER_PERIOD = Object.freeze({
  form: '941',
  year: 2026,
  quarter: 4,
  wages: 2000,
  federalWithholding: 156.15,
  socialSecurity: 124,
  medicare: 29,
  additionalMedicare: 0,
  totalTax: 309.15,
  reconciled: true,
  payRunCount: 1,
  payRunIds: ['pay-run-1'],
  depositDates: [],
  deposits: [],
});
const SUBMITTED_ROW = Object.freeze({
  filing_id: 'filing-1',
  tenant_id: FILING_TENANT,
  form_text: '941',
  tax_year: 2026,
  quarter: 4,
  status: 'submitted',
  sandbox_submission_id: 'sub-1',
  total_tax: 462.15,
  submitted_at: '2026-11-27T00:00:00.000Z',
  created_at: '2026-11-27T00:00:00.000Z',
  updated_at: '2026-11-27T00:00:00.000Z',
});
const SUBMIT_ARGS = Object.freeze({
  tenantId: FILING_TENANT,
  action: 'submit-filing',
  companyEIN: '98-7654321',
  form: '941',
  taxYear: 2026,
  quarter: 4,
  pin: '12345',
});
const REFRESH_ARGS = Object.freeze({
  tenantId: FILING_TENANT,
  action: 'refresh-status',
  filingId: 'filing-1',
});

function makeSandboxFilingQuery({ filings = [SUBMITTED_ROW] } = {}) {
  const calls = [];
  let inserted = null;
  async function query(sql, params = []) {
    calls.push({ sql, params });
    if (sql.includes('payroll_companies')) {
      return { rows: [COMPANY_ROW] };
    }
    if (sql.includes('INSERT INTO payrollcheck.tax_filings')) {
      inserted = {
        filing_id: 'filing-1',
        tenant_id: params[0],
        form_text: params[1],
        tax_year: params[2],
        quarter: params[3],
        status: 'queued',
        sandbox_submission_id: null,
        total_tax: params[4],
        submitted_at: null,
        created_at: '2026-11-27T00:00:00.000Z',
        updated_at: '2026-11-27T00:00:00.000Z',
      };
      return { rows: [inserted] };
    }
    if (sql.includes("SET status = 'submitted'")) {
      return {
        rows: [{
          ...inserted,
          status: 'submitted',
          sandbox_submission_id: params[0],
          submitted_at: '2026-11-27T00:00:00.000Z',
        }],
      };
    }
    if (sql.includes("SET status = 'failed'")) {
      return { rows: [{ ...inserted, status: 'failed' }] };
    }
    if (sql.includes('SET status = $1')) {
      return {
        rows: [{ ...filings[0], status: params[0], updated_at: '2026-11-27T00:00:00.000Z' }],
      };
    }
    if (sql.includes('FROM payrollcheck.tax_filings')) {
      return { rows: filings.slice(0, 1) };
    }
    throw new Error(`unexpected query: ${sql}`);
  }
  return { calls, query };
}

function makeSandboxLoader(fetch) {
  const { query } = makeSandboxFilingQuery();
  const factory = createTaxBanditsSandboxFilingClientFactory({ env: SANDBOX_ENV, fetch });
  return createFilingLoader({
    query,
    createTaxBanditsClient: factory,
    loadTaxCenter: async (tenantId) => ({
      tenantId,
      form941: [TAX_CENTER_PERIOD],
      form940: [],
    }),
  });
}

test('factory wired through the filing loader submits the Q4 941 at $462.15 instead of queueing', async () => {
  const { calls, fetch } = makeSandboxFetch();
  const loader = makeSandboxLoader(fetch);
  const result = await loader.loadFiling(SUBMIT_ARGS);
  assert.equal(result.ok, true);
  assert.equal(result.filing.status, 'submitted');
  assert.equal(result.filing.sandboxSubmissionId, 'sub-1');
  assert.equal(result.filing.totalTax, 462.15);
  assert.equal(calls[0].url, TAXBANDITS_SANDBOX_TOKEN_URL);
  const createCall = calls.find((call) => call.url === SANDBOX_FORM_941_URL);
  assert.equal(createCall.options.headers.Authorization, 'Bearer sandbox-access-token');
  assert.equal(JSON.parse(createCall.options.body).totals.totalTax, 462.15);
});

test('factory wired through the filing loader refreshes a submitted filing to accepted', async () => {
  const { calls, fetch } = makeSandboxFetch();
  const loader = makeSandboxLoader(fetch);
  const result = await loader.loadFiling(REFRESH_ARGS);
  assert.equal(result.ok, true);
  assert.equal(result.filing.status, 'accepted');
  assert.equal(result.filing.sandboxSubmissionId, 'sub-1');
  const statusCall = calls.find((call) => call.url === SANDBOX_FORM_941_STATUS_URL);
  assert.equal(statusCall.options.method, 'GET');
  assert.equal(statusCall.options.headers.Authorization, 'Bearer sandbox-access-token');
});
