// Company profile (Slice 2): pure validation, RLS-bound loader, and the
// access handler. Mirrors tests/payrollcheck-dashboard.test.mjs. The EIN is
// stored as nine digits and is never returned in full: every response shows
// only the masked EIN and its last four digits.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PAY_SCHEDULES,
  PAY_SCHEDULE_LABELS,
  PAY_SCHEDULE_PERIODS_PER_YEAR,
  normalizeEin,
  maskEin,
  parseCompanyInput,
  parseCompanyRequest,
  toCompanyResponse,
  loadCompanyByTenant,
  createCompanyLoader,
} from '../src/payrollcheck/payrollcheck-company.mjs';
import { createCompanyAccessHandler } from '../src/payrollcheck/payrollcheck-company-access.mjs';

const BUSINESS_A = '11111111-1111-4111-8111-111111111111';
const BUSINESS_B = '22222222-2222-4222-8222-222222222222';
const BUSINESS_C = '33333333-3333-4333-8333-333333333333';
const SUBJECT_ID = 'subject-1';
const SESSION_ID = '44444444-4444-4444-8444-444444444444';
const AUTH_USER_ID = 'auth-user-1';
const NOW = '2026-11-25T12:00:00.000Z';

const COMPANY_INPUT = {
  legalName: 'Acme Widgets LLC',
  ein: '12-3456789',
  addressLine1: '1 Main St',
  addressLine2: 'Suite 100',
  city: 'Springfield',
  state: 'il',
  postalCode: '62701-1234',
  paySchedule: 'biweekly',
    contactEmail: 'Payroll@Acme.example',
    contactPhone: '(518) 555-0100',
    businessType: 'llc',
    signingAuthority: 'Jane Acme',
};

const COMPANY_ROW_A = {
  company_id: '55555555-5555-4555-8555-555555555555',
  tenant_id: BUSINESS_A,
  legal_name: 'Acme Widgets LLC',
  ein: '123456789',
  address_line1: '1 Main St',
  address_line2: 'Suite 100',
  city: 'Springfield',
  state: 'IL',
  postal_code: '62701-1234',
  pay_schedule: 'biweekly',
    contact_email: 'payroll@acme.example',
    contact_phone: '5185550100',
    business_type: 'llc',
    signing_authority: 'Jane Acme',
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
};

const COMPANY_ROW_B = {
  ...COMPANY_ROW_A,
  company_id: '66666666-6666-4666-8666-666666666666',
  tenant_id: BUSINESS_B,
  legal_name: 'Beta Bakery Inc',
  ein: '987654321',
  pay_schedule: 'monthly',
};

// --- pure validation -------------------------------------------------------

test('parseCompanyInput: a complete profile is accepted and normalized', () => {
  const parsed = parseCompanyInput(COMPANY_INPUT);
  assert.equal(parsed.ok, true);
  assert.deepEqual(parsed.company, {
    legalName: 'Acme Widgets LLC',
    ein: '123456789',
    addressLine1: '1 Main St',
    addressLine2: 'Suite 100',
    city: 'Springfield',
    state: 'IL',
    postalCode: '62701-1234',
    paySchedule: 'biweekly',
        contactEmail: 'payroll@acme.example',
        contactPhone: '5185550100',
        businessType: 'llc',
        signingAuthority: 'Jane Acme',
  });
});

test('parseCompanyInput: an absent address line 2 is null, and a 5-digit postal code is fine', () => {
  const parsed = parseCompanyInput({ ...COMPANY_INPUT, addressLine2: '', postalCode: '62701' });
  assert.equal(parsed.ok, true);
  assert.equal(parsed.company.addressLine2, null);
  assert.equal(parsed.company.postalCode, '62701');
});

test('parseCompanyInput: a bad EIN, state, postal code, pay schedule or missing field is invalid_request with field names', () => {
  const cases = [
    [{ ...COMPANY_INPUT, ein: '12345' }, ['ein']],
    [{ ...COMPANY_INPUT, ein: '12-345678' }, ['ein']],
    [{ ...COMPANY_INPUT, state: 'ILL' }, ['state']],
    [{ ...COMPANY_INPUT, state: '1L' }, ['state']],
    [{ ...COMPANY_INPUT, postalCode: '6270' }, ['postalCode']],
    [{ ...COMPANY_INPUT, postalCode: '62701-123' }, ['postalCode']],
    [{ ...COMPANY_INPUT, paySchedule: 'daily' }, ['paySchedule']],
    [{ ...COMPANY_INPUT, legalName: '  ' }, ['legalName']],
    [{ ...COMPANY_INPUT, addressLine1: '' }, ['addressLine1']],
    [{ ...COMPANY_INPUT, city: '' }, ['city']],
        [{ ...COMPANY_INPUT, contactEmail: 'not-an-email' }, ['contactEmail']],
        [{ ...COMPANY_INPUT, contactPhone: '123' }, ['contactPhone']],
        [{ ...COMPANY_INPUT, businessType: 'trust' }, ['businessType']],
        [{ ...COMPANY_INPUT, signingAuthority: 'A'.repeat(121) }, ['signingAuthority']],
    [null, ['company']],
  ];
  for (const [input, fields] of cases) {
    const parsed = parseCompanyInput(input);
    assert.equal(parsed.ok, false);
    assert.equal(parsed.reason, 'invalid_request');
    assert.deepEqual(parsed.errors, fields);
  }
});
test('parseCompanyInput: the filing contact fields are optional and stay null when absent', () => {
    const { contactEmail, contactPhone, businessType, signingAuthority, ...rest } = COMPANY_INPUT;
    const parsed = parseCompanyInput(rest);
    assert.equal(parsed.ok, true);
    assert.equal(parsed.company.contactEmail, null);
    assert.equal(parsed.company.contactPhone, null);
    assert.equal(parsed.company.businessType, null);
    assert.equal(parsed.company.signingAuthority, null);
});

test('parseCompanyInput: a blank EIN is allowed only when a profile already exists', () => {
  const keeping = parseCompanyInput({ ...COMPANY_INPUT, ein: '' }, { einRequired: false });
  assert.equal(keeping.ok, true);
  assert.equal(keeping.company.ein, null);
  const fresh = parseCompanyInput({ ...COMPANY_INPUT, ein: '' }, { einRequired: true });
  assert.equal(fresh.ok, false);
  assert.deepEqual(fresh.errors, ['ein']);
  const bad = parseCompanyInput({ ...COMPANY_INPUT, ein: '123' }, { einRequired: false });
  assert.equal(bad.ok, false);
  assert.deepEqual(bad.errors, ['ein']);
});

test('maskEin and normalizeEin: only the last four digits are ever shown', () => {
  assert.equal(normalizeEin('12-3456789'), '123456789');
  assert.equal(normalizeEin('12 345 6789'), '123456789');
  assert.equal(maskEin('123456789'), '***-**-6789');
  assert.equal(maskEin('12-3456789'), '***-**-6789');
  assert.equal(maskEin(''), '***-**-****');
});

test('pay schedules: the four schedules from the payroll tax calculator, frozen', () => {
  assert.deepEqual(PAY_SCHEDULES, ['weekly', 'biweekly', 'semi_monthly', 'monthly']);
  assert.deepEqual(PAY_SCHEDULE_LABELS, { weekly: 'Weekly', biweekly: 'Every two weeks', semi_monthly: 'Twice a month', monthly: 'Monthly' });
  assert.deepEqual(PAY_SCHEDULE_PERIODS_PER_YEAR, { weekly: 52, biweekly: 26, semi_monthly: 24, monthly: 12 });
  assert.ok(Object.isFrozen(PAY_SCHEDULES));
  assert.ok(Object.isFrozen(PAY_SCHEDULE_LABELS));
  assert.ok(Object.isFrozen(PAY_SCHEDULE_PERIODS_PER_YEAR));
});

test('toCompanyResponse: the full EIN never leaves the server', () => {
  const response = toCompanyResponse(COMPANY_ROW_A);
  assert.deepEqual(response, {
    tenantId: BUSINESS_A,
    legalName: 'Acme Widgets LLC',
    einMasked: '***-**-6789',
    einLast4: '6789',
    address: { line1: '1 Main St', line2: 'Suite 100', city: 'Springfield', state: 'IL', postalCode: '62701-1234' },
    paySchedule: 'biweekly',
        contactEmail: 'payroll@acme.example',
        contactPhone: '5185550100',
        businessType: 'llc',
        signingAuthority: 'Jane Acme',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  });
  assert.ok(!JSON.stringify(response).includes('123456789'));
  assert.equal(toCompanyResponse(null), null);
});

test('parseCompanyRequest: read and write are the only actions; a tenant id only selects', () => {
  assert.deepEqual(parseCompanyRequest({ tenantId: BUSINESS_A, action: 'read' }), { ok: true, tenantId: BUSINESS_A, action: 'read' });
  assert.deepEqual(parseCompanyRequest({ action: 'write' }), { ok: true, tenantId: null, action: 'write' });
  assert.equal(parseCompanyRequest({ tenantId: BUSINESS_A, action: 'delete' }).ok, false);
  assert.equal(parseCompanyRequest({ tenantId: 'not-a-uuid', action: 'read' }).ok, false);
  assert.equal(parseCompanyRequest(null).ok, false);
  assert.equal(parseCompanyRequest({ tenantId: BUSINESS_A }).ok, false);
});

// --- loader ----------------------------------------------------------------

test('createCompanyLoader requires a query function', () => {
  assert.throws(() => createCompanyLoader({}), /requires a query function/);
  assert.throws(() => createCompanyLoader(), /requires a query function/);
});

test('loadCompanyByTenant: parameterized, one row or null', async () => {
  const calls = [];
  const query = async (sql, params) => {
    calls.push({ sql, params });
    return { rows: [COMPANY_ROW_A] };
  };
  const row = await loadCompanyByTenant(query, BUSINESS_A);
  assert.deepEqual(row, COMPANY_ROW_A);
  assert.equal(calls.length, 1);
  assert.ok(calls[0].sql.includes('FROM payrollcheck.payroll_companies'));
  assert.ok(calls[0].sql.includes('WHERE tenant_id = $1'));
  assert.ok(!calls[0].sql.includes(BUSINESS_A));
  assert.deepEqual(calls[0].params, [BUSINESS_A]);
  const missing = await loadCompanyByTenant(async () => ({ rows: [] }), BUSINESS_B);
  assert.equal(missing, null);
});

test('loadCompanyProfile: memberships first, then one company per membership, in order', async () => {
  const calls = [];
  const query = async (sql, params) => {
    calls.push({ sql, params });
    if (sql.includes('FROM payrollcheck.memberships')) {
      return { rows: [
        { subject_id: SUBJECT_ID, tenant_id: BUSINESS_A, role: 'business_owner', active: true },
        { subject_id: SUBJECT_ID, tenant_id: BUSINESS_B, role: 'business_owner', active: true },
      ] };
    }
    if (sql.includes('FROM payrollcheck.payroll_companies')) {
      return { rows: params[0] === BUSINESS_A ? [COMPANY_ROW_A] : [COMPANY_ROW_B] };
    }
    throw new Error(`unexpected query: ${sql}`);
  };
  const loader = createCompanyLoader({ query });
  const profile = await loader.loadCompanyProfile({ subjectId: SUBJECT_ID });
  assert.deepEqual(profile, {
    memberships: [
      { tenantId: BUSINESS_A, role: 'business_owner' },
      { tenantId: BUSINESS_B, role: 'business_owner' },
    ],
    companiesByTenant: { [BUSINESS_A]: COMPANY_ROW_A, [BUSINESS_B]: COMPANY_ROW_B },
  });
  assert.deepEqual(
    calls.map((c) => c.sql.match(/FROM payrollcheck\.(\w+)/)[1]),
    ['memberships', 'payroll_companies', 'payroll_companies'],
  );
  assert.deepEqual(calls[0].params, [SUBJECT_ID]);
  assert.deepEqual(calls[1].params, [BUSINESS_A]);
  assert.deepEqual(calls[2].params, [BUSINESS_B]);
});

test('saveCompany: one row per tenant via upsert, parameterized, returns the row', async () => {
  const calls = [];
  const query = async (sql, params) => {
    calls.push({ sql, params });
    return { rows: [COMPANY_ROW_A] };
  };
  const loader = createCompanyLoader({ query });
  const saved = await loader.saveCompany(BUSINESS_A, {
    legalName: 'Acme Widgets LLC',
    ein: '123456789',
    addressLine1: '1 Main St',
    addressLine2: 'Suite 100',
    city: 'Springfield',
    state: 'IL',
    postalCode: '62701-1234',
    paySchedule: 'biweekly',
        contactEmail: 'payroll@acme.example',
        contactPhone: '5185550100',
        businessType: 'llc',
        signingAuthority: 'Jane Acme',
  });
  assert.deepEqual(saved, COMPANY_ROW_A);
  assert.equal(calls.length, 1);
  assert.ok(calls[0].sql.includes('INSERT INTO payrollcheck.payroll_companies'));
  assert.ok(calls[0].sql.includes('ON CONFLICT (tenant_id) DO UPDATE'));
  assert.ok(calls[0].sql.includes('RETURNING'));
    assert.ok(calls[0].sql.includes('contact_email, contact_phone, business_type, signing_authority'));
    assert.ok(calls[0].sql.includes('($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)'));
  assert.deepEqual(calls[0].params, [BUSINESS_A, 'Acme Widgets LLC', '123456789', '1 Main St', 'Suite 100', 'Springfield', 'IL', '62701-1234', 'biweekly', 'payroll@acme.example', '5185550100', 'llc', 'Jane Acme']);
});

// --- access handler --------------------------------------------------------

const MEMBERSHIPS = [
  { tenantId: BUSINESS_A, role: 'business_owner' },
  { tenantId: BUSINESS_B, role: 'business_owner' },
];

function makeHandler(overrides = {}) {
  const audits = [];
  const saves = [];
  const handler = createCompanyAccessHandler({
    getVerifiedUser: async () => ({ id: AUTH_USER_ID, email_confirmed_at: '2026-01-01T00:00:00Z', is_anonymous: false }),
    requireAal2: async () => true,
    resolveSubjectId: async () => SUBJECT_ID,
    recordAudit: async (audit) => { audits.push(audit); return { ok: true }; },
    checkRateLimit: async () => ({ allowed: true }),
    getSession: async () => ({ authUserId: AUTH_USER_ID }),
    generateId: () => 'req-1',
    now: () => NOW,
    loadCompanyProfile: async () => ({
      memberships: MEMBERSHIPS,
      companiesByTenant: { [BUSINESS_A]: COMPANY_ROW_A, [BUSINESS_B]: COMPANY_ROW_B },
    }),
    saveCompany: async (tenantId, company) => {
      saves.push({ tenantId, company });
      return { ...COMPANY_ROW_A, tenant_id: tenantId, legal_name: company.legalName, ein: company.ein, pay_schedule: company.paySchedule };
    },
    ...overrides,
  });
  return { handler, audits, saves };
}

async function call(handler, { tenantId = BUSINESS_A, action = 'read', company } = {}) {
  return handler.handleCompanyAccess({
    accessToken: SESSION_ID,
    sessionId: SESSION_ID,
    tenantId,
    action,
    company,
    requestId: 'req-1',
    clientIp: '203.0.113.10',
  });
}

test('company read: a business reads its own profile, masked, with one audit row', async () => {
  const { handler, audits } = makeHandler();
  const result = await call(handler, { action: 'read' });
  assert.equal(result.status, 200);
  assert.equal(result.ok, true);
  assert.equal(result.isSetUp, true);
  assert.deepEqual(result.company, toCompanyResponse(COMPANY_ROW_A));
  assert.ok(!JSON.stringify(result).includes('123456789'));
  assert.equal(audits.length, 1);
  assert.deepEqual(audits[0], { requestId: 'req-1', actorSubjectId: SUBJECT_ID, reportId: null, action: 'company_read', allowed: true, reason: 'allowed' });
});

test('company read: no profile yet is not set up, and another tenant company never leaks in', async () => {
  const { handler, audits } = makeHandler({
    loadCompanyProfile: async () => ({ memberships: MEMBERSHIPS, companiesByTenant: { [BUSINESS_B]: COMPANY_ROW_B } }),
  });
  const result = await call(handler, { action: 'read' });
  assert.equal(result.status, 200);
  assert.equal(result.company, null);
  assert.equal(result.isSetUp, false);
  assert.ok(!JSON.stringify(result).includes('Beta Bakery Inc'));
  assert.equal(audits.length, 1);
  assert.equal(audits[0].action, 'company_read');
});

test('company write: a business saves its own profile, normalized, with one audit row', async () => {
  const { handler, audits, saves } = makeHandler({
    loadCompanyProfile: async () => ({ memberships: MEMBERSHIPS, companiesByTenant: {} }),
  });
  const result = await call(handler, { action: 'write', company: COMPANY_INPUT });
  assert.equal(result.status, 200);
  assert.equal(result.ok, true);
  assert.equal(result.isSetUp, true);
  assert.equal(result.company.legalName, 'Acme Widgets LLC');
  assert.equal(result.company.einMasked, '***-**-6789');
  assert.ok(!JSON.stringify(result).includes('123456789'));
  assert.equal(saves.length, 1);
  assert.deepEqual(saves[0], {
    tenantId: BUSINESS_A,
    company: { legalName: 'Acme Widgets LLC', ein: '123456789', addressLine1: '1 Main St', addressLine2: 'Suite 100', city: 'Springfield', state: 'IL', postalCode: '62701-1234', paySchedule: 'biweekly', contactEmail: 'payroll@acme.example', contactPhone: '5185550100', businessType: 'llc', signingAuthority: 'Jane Acme' },
  });
  assert.equal(audits.length, 1);
  assert.deepEqual(audits[0], { requestId: 'req-1', actorSubjectId: SUBJECT_ID, reportId: null, action: 'company_write', allowed: true, reason: 'allowed' });
});

test('company write: a blank EIN keeps the stored EIN', async () => {
  const { handler, saves } = makeHandler();
  const result = await call(handler, { action: 'write', company: { ...COMPANY_INPUT, ein: '' } });
  assert.equal(result.status, 200);
  assert.equal(saves.length, 1);
  assert.equal(saves[0].company.ein, '123456789');
});

test('company write: invalid input is invalid_request, audited, and nothing is saved', async () => {
  const { handler, audits, saves } = makeHandler();
  const result = await call(handler, { action: 'write', company: { ...COMPANY_INPUT, paySchedule: 'daily' } });
  assert.equal(result.status, 400);
  assert.equal(result.reason, 'invalid_request');
  assert.equal(saves.length, 0);
  assert.equal(audits.length, 1);
  assert.equal(audits[0].action, 'company_write');
  assert.equal(audits[0].allowed, false);
  assert.equal(audits[0].reason, 'invalid_request');
});

test('company access: a tenant the caller is not a member of is not_found, audited, for read and write', async () => {
  const { handler, audits } = makeHandler({
    loadCompanyProfile: async () => ({ memberships: [{ tenantId: BUSINESS_A, role: 'business_owner' }], companiesByTenant: { [BUSINESS_A]: COMPANY_ROW_A } }),
  });
  for (const action of ['read', 'write']) {
    audits.length = 0;
    const result = await call(handler, { tenantId: BUSINESS_C, action, company: COMPANY_INPUT });
    assert.equal(result.status, 404);
    assert.equal(result.reason, 'not_found');
    assert.equal(audits.length, 1);
    assert.equal(audits[0].action, action === 'read' ? 'company_read' : 'company_write');
    assert.equal(audits[0].allowed, false);
  }
});

test('company access: a non-owner member cannot read or write the company profile', async () => {
  const { handler, audits } = makeHandler({
    loadCompanyProfile: async () => ({ memberships: [{ tenantId: BUSINESS_A, role: 'accounting_reviewer' }], companiesByTenant: { [BUSINESS_A]: COMPANY_ROW_A } }),
  });
  const result = await call(handler, { action: 'read' });
  assert.equal(result.status, 404);
  assert.equal(result.reason, 'not_found');
  assert.equal(audits.length, 1);
  assert.equal(audits[0].allowed, false);
});

test('company access: no memberships at all is not_found, audited', async () => {
  const { handler, audits } = makeHandler({
    loadCompanyProfile: async () => ({ memberships: [], companiesByTenant: {} }),
  });
  const result = await call(handler, { action: 'read' });
  assert.equal(result.status, 404);
  assert.equal(result.reason, 'not_found');
  assert.equal(audits.length, 1);
});

test('company access: without MFA the caller is told mfa_required and no audit row is written', async () => {
  const { handler, audits } = makeHandler({ requireAal2: async () => false });
  const result = await call(handler, { action: 'read' });
  assert.equal(result.status, 403);
  assert.equal(result.reason, 'mfa_required');
  assert.equal(audits.length, 0);
});

test('company access: an anonymous or unconfirmed user is invalid_session with no audit row', async () => {
  const { handler, audits } = makeHandler({ getVerifiedUser: async () => null });
  const result = await call(handler, { action: 'read' });
  assert.equal(result.status, 401);
  assert.equal(result.reason, 'invalid_session');
  assert.equal(audits.length, 0);
});

test('company access: a revoked session is invalid_session, audited', async () => {
  const { handler, audits } = makeHandler({
    getSession: async () => ({ authUserId: AUTH_USER_ID, revoked: true }),
  });
  const result = await call(handler, { action: 'read' });
  assert.equal(result.status, 401);
  assert.equal(result.reason, 'invalid_session');
  assert.equal(audits.length, 1);
  assert.equal(audits[0].allowed, false);
});

test('company access: rate-limited is 429 with no audit row; a failing rate-limit store degrades to allow', async () => {
  const limited = makeHandler({ checkRateLimit: async () => ({ allowed: false }) });
  const denied = await call(limited.handler, { action: 'read' });
  assert.equal(denied.status, 429);
  assert.equal(denied.reason, 'rate_limited');
  assert.equal(limited.audits.length, 0);
  const degraded = makeHandler({ checkRateLimit: async () => { throw new Error('store down'); } });
  const allowed = await call(degraded.handler, { action: 'read' });
  assert.equal(allowed.status, 200);
});

test('company access: a malformed tenant id or unknown action is invalid_request, audited', async () => {
  const { handler, audits } = makeHandler();
  const badTenant = await call(handler, { tenantId: 'not-a-uuid', action: 'read' });
  assert.equal(badTenant.status, 400);
  assert.equal(badTenant.reason, 'invalid_request');
  assert.equal(audits.length, 1);
  const badAction = await call(handler, { action: 'delete' });
  assert.equal(badAction.status, 400);
  assert.equal(badAction.reason, 'invalid_request');
  assert.equal(audits.length, 2);
});

test('company access: a failing company load is unavailable with no audit row', async () => {
  const { handler, audits } = makeHandler({
    loadCompanyProfile: async () => { throw new Error('db down'); },
  });
  const result = await call(handler, { action: 'read' });
  assert.equal(result.status, 503);
  assert.equal(result.reason, 'unavailable');
  assert.equal(audits.length, 0);
});

test('createCompanyAccessHandler requires its collaborators', () => {
  assert.throws(() => createCompanyAccessHandler({}), /getVerifiedUser is required/);
});
