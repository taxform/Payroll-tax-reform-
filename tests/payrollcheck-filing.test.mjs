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
