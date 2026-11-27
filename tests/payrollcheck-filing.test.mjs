// Slice 6 — TaxBandits sandbox filing (docs/payrollcheck-360-integration-plan.md).
// The known-good numbers come from the assignment's Nov 25 sandbox test filing:
// a $2,000 biweekly run (gross 2000, federal 156.15, SS 124/124, Medicare 29/29,
// net 1690.85, FUTA 12) gives a TaxBandits sandbox 941 total of 462.15, which
// is the tax-center totalTax of 309.15 plus the employer's matching FICA (153).
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  TAX_BANDITS_SANDBOX_BASE_URL,
  FILING_ENVIRONMENT,
  FILING_SANDBOX_NOTICE,
  FILING_FEE_NOTE,
  parseFilingRequest,
  validateFilingCompany,
  computeSandbox941Totals,
  buildTaxBandits941Payload,
  buildFilingQueueItem,
  filingCreatePath,
  filingStatusPath,
  parseTaxBanditsStatus,
    createFilingLoader,
    createTaxBanditsSandboxClient,
} from '../src/payrollcheck/payrollcheck-filing.mjs';

const TEST_COMPANY = {
  legalName: 'TEST ONLY - Verification Company',
  ein: '26-4839175',
  addressLine1: '1 Test Way',
  addressLine2: null,
  city: 'Albany',
  state: 'NY',
  postalCode: '12201',
  contactEmail: 'test@example.com',
  contactPhone: '(518) 555-0100',
  businessType: 'llc',
  signingAuthority: 'Test Signer, President',
};

// The known-good $2,000 biweekly run: employee-side totals from the tax center.
const KNOWN_GOOD_TOTALS = {
  wages: 2000,
  federalWithholding: 156.15,
  socialSecurity: 124,
  medicare: 29,
  additionalMedicare: 0,
};

test('filing is sandbox only and carries no per-form fee', () => {
  assert.equal(TAX_BANDITS_SANDBOX_BASE_URL, 'https://testapi.taxbandits.com');
  assert.equal(FILING_ENVIRONMENT, 'sandbox');
  assert.match(FILING_SANDBOX_NOTICE, /TEST system only, nothing reaches the IRS/);
  assert.match(FILING_FEE_NOTE, /\$299\/year/);
  assert.match(FILING_FEE_NOTE, /no per-form fee/);
});

test('parseFilingRequest accepts a queue request', () => {
  const parsed = parseFilingRequest({ tenantId: 'tenant-1', action: 'queue' });
  assert.deepEqual(parsed, {
    ok: true,
    tenantId: 'tenant-1',
    action: 'queue',
    form: null,
    taxYear: null,
    quarter: null,
    pin: null,
    filingId: null,
  });
});

test('parseFilingRequest accepts a 941 submit with a 5-digit 8879-EMP PIN', () => {
  const parsed = parseFilingRequest({
    tenantId: 'tenant-1',
    action: 'submit-filing',
    form: '941',
    taxYear: 2026,
    quarter: 4,
    pin: '12345',
  });
  assert.equal(parsed.ok, true);
  assert.equal(parsed.form, '941');
  assert.equal(parsed.quarter, 4);
  assert.equal(parsed.pin, '12345');
});

test('parseFilingRequest rejects a 941 submit without a quarter', () => {
  const parsed = parseFilingRequest({
    tenantId: 'tenant-1',
    action: 'submit-filing',
    form: '941',
    taxYear: 2026,
    pin: '12345',
  });
  assert.equal(parsed.ok, false);
  assert.ok(parsed.errors.includes('quarter'));
});

test('parseFilingRequest rejects an annual form with a quarter and a bad PIN', () => {
  const withQuarter = parseFilingRequest({
    tenantId: 'tenant-1',
    action: 'submit-filing',
    form: '940',
    taxYear: 2026,
    quarter: 1,
    pin: '12345',
  });
  assert.equal(withQuarter.ok, false);
  assert.ok(withQuarter.errors.includes('quarter'));
  const badPin = parseFilingRequest({
    tenantId: 'tenant-1',
    action: 'submit-filing',
    form: '941',
    taxYear: 2026,
    quarter: 4,
    pin: '1234',
  });
  assert.equal(badPin.ok, false);
  assert.ok(badPin.errors.includes('pin'));
});

test('parseFilingRequest requires a filing id for refresh-status', () => {
  const parsed = parseFilingRequest({ tenantId: 'tenant-1', action: 'refresh-status' });
  assert.equal(parsed.ok, false);
  assert.ok(parsed.errors.includes('filingId'));
  assert.equal(parseFilingRequest({ tenantId: 'tenant-1', action: 'refresh-status', filingId: 'filing-1' }).ok, true);
});

test('sandbox 941 total is 462.15 for the known-good $2,000 run', () => {
  const computed = computeSandbox941Totals(KNOWN_GOOD_TOTALS);
  assert.equal(computed.ok, true);
  assert.equal(computed.wages, 2000);
  assert.equal(computed.federalWithholding, 156.15);
  assert.equal(computed.employeeSocialSecurity, 124);
  assert.equal(computed.employerSocialSecurity, 124);
  assert.equal(computed.employeeMedicare, 29);
  assert.equal(computed.employerMedicare, 29);
  // The tax-center totalTax is federal + employee FICA only.
  assert.equal(computed.taxCenterTotalTax, 309.15);
  // The 941 total adds the employer's matching FICA.
  assert.equal(computed.totalTax, 462.15);
});

test('computeSandbox941Totals rejects missing or negative totals', () => {
  assert.equal(computeSandbox941Totals({ ...KNOWN_GOOD_TOTALS, socialSecurity: -1 }).ok, false);
  assert.equal(computeSandbox941Totals({ wages: 2000 }).ok, false);
});

test('validateFilingCompany accepts a complete company', () => {
  const validated = validateFilingCompany(TEST_COMPANY);
  assert.equal(validated.ok, true);
  assert.equal(validated.company.ein, '26-4839175');
  assert.equal(validated.company.contactPhone, '5185550100');
  assert.equal(validated.company.state, 'NY');
});

test('validateFilingCompany requires every field the Nov 25 sandbox filing missed', () => {
  const missing = ['contactEmail', 'contactPhone', 'addressLine1', 'city', 'postalCode', 'businessType', 'signingAuthority'];
  for (const field of missing) {
    const company = { ...TEST_COMPANY, [field]: '' };
    const validated = validateFilingCompany(company);
    assert.equal(validated.ok, false, `${field} must be required`);
    assert.ok(validated.errors.includes(field), `${field} must be reported`);
  }
});

test('validateFilingCompany rejects the blocked fake EIN and a bad email', () => {
  assert.ok(validateFilingCompany({ ...TEST_COMPANY, ein: '12-3456789' }).errors.includes('ein'));
  assert.ok(validateFilingCompany({ ...TEST_COMPANY, contactEmail: 'not-an-email' }).errors.includes('contactEmail'));
  assert.ok(validateFilingCompany({ ...TEST_COMPANY, businessType: 'mystery' }).errors.includes('businessType'));
});

test('941 payload carries the business fields and the 462.15 total', () => {
  const built = buildTaxBandits941Payload({
    company: TEST_COMPANY,
    totals: KNOWN_GOOD_TOTALS,
    taxYear: 2026,
    quarter: 4,
    pin: '12345',
  });
  assert.equal(built.ok, true);
  assert.equal(built.payload.environment, 'sandbox');
  assert.equal(built.payload.form, '941');
  assert.equal(built.payload.taxYear, 2026);
  assert.equal(built.payload.quarter, 4);
  assert.equal(built.payload.business.legalName, 'TEST ONLY - Verification Company');
  assert.equal(built.payload.business.ein, '26-4839175');
  assert.equal(built.payload.business.addressLine1, '1 Test Way');
  assert.equal(built.payload.business.city, 'Albany');
  assert.equal(built.payload.business.postalCode, '12201');
  assert.equal(built.payload.business.contactEmail, 'test@example.com');
  assert.equal(built.payload.business.contactPhone, '5185550100');
  assert.equal(built.payload.business.businessType, 'llc');
  assert.equal(built.payload.business.signingAuthority, 'Test Signer, President');
  assert.equal(built.payload.totals.totalTax, 462.15);
  assert.equal(built.payload.signature.method, '8879-EMP');
  assert.equal(built.payload.signature.pin, '12345');
});

test('941 payload is refused when a business field is missing', () => {
  const built = buildTaxBandits941Payload({
    company: { ...TEST_COMPANY, contactEmail: '' },
    totals: KNOWN_GOOD_TOTALS,
    taxYear: 2026,
    quarter: 4,
    pin: '12345',
  });
  assert.equal(built.ok, false);
  assert.ok(built.errors.includes('contactEmail'));
});

test('filing queue item never stores the signing PIN', () => {
  const built = buildFilingQueueItem({
    tenantId: 'tenant-1',
    form: '941',
    taxYear: 2026,
    quarter: 4,
    totalTax: 462.15,
    filingId: 'filing-1',
    now: '2026-11-27T00:00:00.000Z',
  });
  assert.equal(built.ok, true);
  assert.equal(built.filing.status, 'queued');
  assert.equal(built.filing.totalTax, 462.15);
  assert.equal(built.filing.environment, 'sandbox');
  assert.ok(!('pin' in built.filing));
  assert.ok(!JSON.stringify(built.filing).includes('12345'));
});

test('filing endpoint paths are sandbox paths per form', () => {
  assert.equal(filingCreatePath('941'), '/v1/Form941/Create');
  assert.equal(filingCreatePath('940'), '/v1/Form940/Create');
  assert.equal(filingCreatePath('W-2'), '/v1/FormW2/Create');
  assert.equal(filingStatusPath('941', 'sub-1'), '/v1/Form941/Status?SubmissionId=sub-1');
  assert.throws(() => filingCreatePath('1040'), /unsupported filing form/);
});

test('provider statuses map onto filing statuses, unknown ones do not', () => {
  assert.deepEqual(parseTaxBanditsStatus({ Status: 'Accepted' }), { ok: true, status: 'accepted' });
  assert.deepEqual(parseTaxBanditsStatus({ Status: 'Transmitted' }), { ok: true, status: 'submitted' });
  assert.deepEqual(parseTaxBanditsStatus({ Status: 'Rejected' }), { ok: true, status: 'rejected' });
  assert.equal(parseTaxBanditsStatus({ Status: 'Mystery' }).ok, false);
  assert.equal(parseTaxBanditsStatus({}).ok, false);
});

test('sandbox client submits only to the sandbox host', async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    return { ok: true, status: 200, json: async () => ({ SubmissionId: 'sub-1', Status: 'Transmitted' }) };
  };
  const client = createTaxBanditsSandboxClient({ fetch: fetchImpl, getAccessToken: async () => 'sandbox-token' });
  const result = await client.submitFiling({
    form: '941',
    payload: buildTaxBandits941Payload({
      company: TEST_COMPANY,
      totals: KNOWN_GOOD_TOTALS,
      taxYear: 2026,
      quarter: 4,
      pin: '12345',
    }).payload,
  });
  assert.equal(result.ok, true);
  assert.equal(result.submissionId, 'sub-1');
  assert.equal(result.status, 'submitted');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://testapi.taxbandits.com/v1/Form941/Create');
  assert.equal(calls[0].options.method, 'POST');
  assert.equal(calls[0].options.headers.Authorization, 'Bearer sandbox-token');
  assert.ok(calls[0].options.body.includes('462.15'));
});

test('sandbox client refreshes status from the sandbox only', async () => {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    return { ok: true, status: 200, json: async () => ({ Status: 'Accepted' }) };
  };
  const client = createTaxBanditsSandboxClient({ fetch: fetchImpl, getAccessToken: async () => 'sandbox-token' });
  const result = await client.refreshFilingStatus({ form: '941', submissionId: 'sub-1' });
  assert.equal(result.ok, true);
  assert.equal(result.status, 'accepted');
  assert.equal(calls[0], 'https://testapi.taxbandits.com/v1/Form941/Status?SubmissionId=sub-1');
});

test('sandbox client refuses a production host and reports a missing token', async () => {
  assert.throws(
    () => createTaxBanditsSandboxClient({
      fetch: async () => ({}),
      getAccessToken: async () => 'token',
      baseUrl: 'https://api.taxbandits.com/v1',
    }),
    /sandbox only/,
  );
  const client = createTaxBanditsSandboxClient({
    fetch: async () => { throw new Error('must not be called'); },
    getAccessToken: async () => '',
  });
  assert.deepEqual(await client.submitFiling({ form: '941', payload: {} }), { ok: false, error: 'taxbandits_not_configured' });
});

// --------------------------------------------------
// createFilingLoader: the filing queue, submit-filing and
// refresh-status operations, behind the same tenant-scoped
// queries as the rest of the app.
// --------------------------------------------------

const FILING_TENANT = '33333333-cccc-4333-8333-333333333333';

const COMPANY_ROW = {
    company_id: 'company-1',
    tenant_id: FILING_TENANT,
    legal_name: 'TEST ONLY - Verification Company',
    ein: '26-4839175',
    address_line1: '1 Test Way',
    address_line2: null,
    city: 'Albany',
    state: 'NY',
    postal_code: '12201',
    pay_schedule: 'biweekly',
    contact_email: 'test@example.com',
    contact_phone: '(518) 555-0100',
    business_type: 'llc',
    signing_authority: 'Test Signer, President',
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
};

const TAX_CENTER_PERIOD = {
    form: '941',
    year: 2026,
    quarter: 4,
    payRunCount: 1,
    payRunIds: ['pay-run-1'],
    depositDates: [],
    deposits: [],
    ...KNOWN_GOOD_TOTALS,
    fica: 153,
    totalTax: 309.15,
    reconciled: true,
};

const QUEUED_ROW = {
    filing_id: 'filing-1',
    tenant_id: FILING_TENANT,
    form_text: '941',
    tax_year: 2026,
    quarter: 4,
    status: 'queued',
    sandbox_submission_id: null,
    total_tax: '462.15',
    submitted_at: null,
    created_at: '2026-11-27T00:00:00.000Z',
    updated_at: '2026-11-27T00:00:00.000Z',
};

const SUBMITTED_ROW = {
    ...QUEUED_ROW,
    status: 'submitted',
    sandbox_submission_id: 'sub-1',
    submitted_at: '2026-11-27T00:00:00.000Z',
};

const SUBMIT_ARGS = {
    tenantId: FILING_TENANT,
    action: 'submit-filing',
    form: '941',
    taxYear: 2026,
    quarter: 4,
    pin: '12345',
};

const REFRESH_ARGS = {
    tenantId: FILING_TENANT,
    action: 'refresh-status',
    filingId: 'filing-1',
};

function assertFilingError(result, status, error) {
    assert.equal(result.ok, false);
    assert.equal(result.status, status);
    assert.equal(result.error, error);
}

function makeFilingQuery({ companyRow = COMPANY_ROW, filings = [SUBMITTED_ROW] } = {}) {
    const calls = [];
    let inserted = null;
    const query = async (sql, params = []) => {
          calls.push({ sql, params });
          if (sql.includes('payroll_companies')) {
                  return { rows: companyRow ? [companyRow] : [] };
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
                                        ...(inserted ?? SUBMITTED_ROW),
                                        status: 'submitted',
                                        sandbox_submission_id: params[0],
                                        submitted_at: '2026-11-27T00:00:00.000Z',
                            }],
                  };
          }
          if (sql.includes("SET status = 'failed'")) return { rows: [] };
          if (sql.includes('SET status = $1')) {
                  return { rows: [{ ...SUBMITTED_ROW, status: params[0] } ] };
          }
          if (sql.includes('FROM payrollcheck.tax_filings')) {
                  if (sql.includes('ORDER BY')) return { rows: filings };
                  return { rows: filings.slice(0, 1) };
          }
          throw new Error(`unexpected query: ${sql}`);
    };
    return { query, calls };
}

function makeTaxBanditsClient({ submitResult = null, refreshResult = null } = {}) {
    const calls = { submit: [], refresh: [] };
    const client = {
          submitFiling: async (args) => {
                  calls.submit.push(args);
                  return submitResult ?? { ok: true, submissionId: 'sub-1', status: 'submitted', providerStatus: 'Transmitted' };
          },
          refreshFilingStatus: async (args) => {
                  calls.refresh.push(args);
                  return refreshResult ?? { ok: true, status: 'accepted', providerStatus: 'Accepted' };
          },
    };
    return { calls, client };
}

const loadTaxCenter = async (tenantId) => ({
    tenantId,
    form941: [TAX_CENTER_PERIOD],
    form940: [],
});

test('createFilingLoader: a query function is required', () => {
    assert.throws(() => createFilingLoader({}), /query_required/);
    assert.throws(() => createFilingLoader({ query: async () => ({}), createTaxBanditsClient: 'nope' }), /create_tax_bandits_client_required/);
    assert.throws(() => createFilingLoader({ query: async () => ({}), loadTaxCenter: 'nope' }), /load_tax_center_required/);
});

test('filing loader submits the Q4 941 to the sandbox at 462.15', async () => {
    const { query, calls } = makeFilingQuery();
    const fake = makeTaxBanditsClient();
    const loader = createFilingLoader({ query, createTaxBanditsClient: () => fake.client, loadTaxCenter });
    const result = await loader.loadFiling(SUBMIT_ARGS);
    assert.equal(result.ok, true);
    assert.equal(result.filing.status, 'submitted');
    assert.equal(result.filing.sandboxSubmissionId, 'sub-1');
    assert.equal(result.filing.totalTax, 462.15);
    assert.equal(result.filing.environment, 'sandbox');
    assert.equal(result.filing.feeNote, FILING_FEE_NOTE);
    assert.equal(JSON.stringify(result.filing).includes('12345'), false);
    const insert = calls.find((call) => call.sql.includes('INSERT INTO payrollcheck.tax_filings'));
    assert.equal(insert.params[4], 462.15);
    assert.equal(insert.params.includes('12345'), false);
    assert.equal(fake.calls.submit.length, 1);
    assert.equal(fake.calls.submit[0].form, '941');
    assert.equal(fake.calls.submit[0].payload.totals.totalTax, 462.15);
});

test('filing loader queues without a sandbox client', async () => {
    const { query, calls } = makeFilingQuery();
    const loader = createFilingLoader({ query, loadTaxCenter });
    const result = await loader.loadFiling(SUBMIT_ARGS);
    assert.equal(result.ok, true);
    assert.equal(result.filing.status, 'queued');
    assert.equal(result.filing.sandboxSubmissionId, null);
    assert.equal(result.filing.totalTax, 462.15);
    assert.equal(calls.some((call) => call.sql.includes('INSERT INTO payrollcheck.tax_filings')), true);
});

test('filing loader lists the tenant filings in order', async () => {
    const { query, calls } = makeFilingQuery({ filings: [SUBMITTED_ROW, { ...QUEUED_ROW, filing_id: 'filing-2', total_tax: 100 }] });
    const loader = createFilingLoader({ query });
    const result = await loader.loadFiling({ tenantId: FILING_TENANT, action: 'queue' });
    assert.equal(result.ok, true);
    assert.equal(result.filings.length, 2);
    assert.equal(result.filings[0].filingId, 'filing-1');
    assert.equal(result.filings[0].totalTax, 462.15);
    assert.equal(result.filings[1].filingId, 'filing-2');
    assert.equal(result.filings[1].totalTax, 100);
    const select = calls.find((call) => call.sql.includes('FROM payrollcheck.tax_filings'));
    assert.deepEqual(select.params, [FILING_TENANT]);
});

test('filing loader rejects a filing when the company profile is incomplete', async () => {
    const missing = makeFilingQuery({ companyRow: null });
    const missingLoader = createFilingLoader({ query: missing.query, loadTaxCenter });
    const missingResult = await missingLoader.loadFiling(SUBMIT_ARGS);
    assertFilingError(missingResult, 400, 'invalid_company');
    const incomplete = makeFilingQuery({ companyRow: { ...COMPANY_ROW, contact_email: null } });
    const incompleteLoader = createFilingLoader({ query: incomplete.query, loadTaxCenter });
    const incompleteResult = await incompleteLoader.loadFiling(SUBMIT_ARGS);
    assertFilingError(incompleteResult, 400, 'invalid_company');
});

test('filing loader reports a missing quarter as filing_period_not_found', async () => {
    const { query } = makeFilingQuery();
    const loader = createFilingLoader({
          query,
          loadTaxCenter: async (tenantId) => ({ tenantId, form941: [], form940: [] }),
    });
    const result = await loader.loadFiling(SUBMIT_ARGS);
    assertFilingError(result, 404, 'filing_period_not_found');
});

test('filing loader rejects a non-941 submit as unsupported_form', async () => {
    const { query } = makeFilingQuery();
    const loader = createFilingLoader({ query, loadTaxCenter });
    const result = await loader.loadFiling({ ...SUBMIT_ARGS, form: '940', quarter: null });
    assertFilingError(result, 400, 'unsupported_form');
});

test('filing loader refreshes a submitted filing to accepted', async () => {
    const { query, calls } = makeFilingQuery();
    const fake = makeTaxBanditsClient();
    const loader = createFilingLoader({ query, createTaxBanditsClient: () => fake.client, loadTaxCenter });
    const result = await loader.loadFiling(REFRESH_ARGS);
    assert.equal(result.ok, true);
    assert.equal(result.filing.status, 'accepted');
    assert.equal(result.filing.sandboxSubmissionId, 'sub-1');
    assert.equal(fake.calls.refresh.length, 1);
    assert.deepEqual(fake.calls.refresh[0], { form: '941', submissionId: 'sub-1' });
    const update = calls.find((call) => call.sql.includes('SET status = $1'));
    assert.equal(update.params[0], 'accepted');
});

test('filing loader reports an unknown filing as filing_not_found', async () => {
    const { query } = makeFilingQuery({ filings: [] });
    const fake = makeTaxBanditsClient();
    const loader = createFilingLoader({ query, createTaxBanditsClient: () => fake.client, loadTaxCenter });
    const result = await loader.loadFiling({ ...REFRESH_ARGS, filingId: 'filing-9' });
    assertFilingError(result, 404, 'filing_not_found');
    assert.equal(fake.calls.refresh.length, 0);
});

test('filing loader reports a never-submitted filing as filing_not_submitted', async () => {
    const { query } = makeFilingQuery({ filings: [QUEUED_ROW] });
    const fake = makeTaxBanditsClient();
    const loader = createFilingLoader({ query, createTaxBanditsClient: () => fake.client, loadTaxCenter });
    const result = await loader.loadFiling(REFRESH_ARGS);
    assertFilingError(result, 409, 'filing_not_submitted');
    assert.equal(fake.calls.refresh.length, 0);
});

test('filing loader reports a missing sandbox client on refresh as unavailable', async () => {
    const { query } = makeFilingQuery();
    const loader = createFilingLoader({ query, loadTaxCenter });
    const result = await loader.loadFiling(REFRESH_ARGS);
    assertFilingError(result, 503, 'unavailable');
});

test('filing loader marks a rejected submit as failed', async () => {
    const { query, calls } = makeFilingQuery();
    const fake = makeTaxBanditsClient({ submitResult: { ok: false, error: 'taxbandits_rejected', statusCode: 502 } });
    const loader = createFilingLoader({ query, createTaxBanditsClient: () => fake.client, loadTaxCenter });
    const result = await loader.loadFiling(SUBMIT_ARGS);
    assertFilingError(result, 503, 'taxbandits_rejected');
    assert.equal(calls.some((call) => call.sql.includes("SET status = 'failed'")), true);
});

test('filing loader rejects an unknown action', async () => {
    const { query } = makeFilingQuery();
    const loader = createFilingLoader({ query });
    const result = await loader.loadFiling({ tenantId: FILING_TENANT, action: 'bogus' });
    assertFilingError(result, 400, 'invalid_request');
});
