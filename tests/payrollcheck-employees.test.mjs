// PayrollCheck 360 - Slice 3 (Employees).
//
// A business can create, list and update its own employees, and deactivate
// them, in payrollcheck.payroll_employees, RLS-scoped to its tenant. The
// SSN is sealed (AES-256-GCM) before it reaches the database and is never
// returned in full: only the masked form (***-**-6789) leaves the server.
// The access tests use stubs throughout - no database access.

import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import {
  EMPLOYEE_ACTIONS,
  FILING_STATUSES,
  FILING_STATUS_LABELS,
  PAY_TYPES,
  parseEmployeeInput,
  parseEmployeeRequest,
  toEmployeeResponse,
  loadEmployeeById,
  listEmployeesByTenant,
  countEmployeesByTenant,
  createEmployeeLoader,
} from '../src/payrollcheck/payrollcheck-employees.mjs';
import {
  createSsnSealer,
  maskSsn,
  normalizeSsn,
  ssnLastFour,
} from '../src/payrollcheck/payrollcheck-ssn.mjs';
import { createEmployeeAccessHandler } from '../src/payrollcheck/payrollcheck-employees-access.mjs';

const BUSINESS_A = '11111111-1111-4111-8111-111111111111';
const BUSINESS_B = '22222222-2222-4222-8222-222222222222';
const BUSINESS_C = '33333333-3333-4333-8333-333333333333';
const SUBJECT_ID = 'subject-1';
const SESSION_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const AUTH_USER_ID = 'auth-user-1';
const NOW = '2026-11-25T12:00:00.000Z';
const SSN_KEY = randomBytes(32);

const EMPLOYEE_INPUT = {
  firstName: 'Ada',
  lastName: 'Lovelace',
  ssn: '123-45-6789',
  filingStatus: 'single',
  allowances: 2,
  extraWithholding: 25,
  payRate: 45.5,
  payType: 'hourly',
};

const EMPLOYEE_ROW_A = {
  employee_id: '55555555-5555-4555-8555-555555555555',
  tenant_id: BUSINESS_A,
  first_name: 'Ada',
  last_name: 'Lovelace',
  ssn_encrypted: 'sealed-ada',
  ssn_last_four: '6789',
  filing_status: 'single',
  allowances: 2,
  extra_withholding: 25,
  pay_rate: 45.5,
  pay_type: 'hourly',
  status: 'active',
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
};
const EMPLOYEE_ROW_B = {
  ...EMPLOYEE_ROW_A,
  employee_id: '66666666-6666-4666-8666-666666666666',
  tenant_id: BUSINESS_B,
  first_name: 'Grace',
  last_name: 'Hopper',
  ssn_encrypted: 'sealed-grace',
  ssn_last_four: '4321',
  filing_status: 'mfj',
  pay_type: 'salary',
  pay_rate: 95000,
};

// Memberships are camelCase { tenantId, role } - the shape
// resolveDashboardTenant matches on (same as the company tests).
const MEMBERSHIPS = [
  { tenantId: BUSINESS_A, role: 'business_owner' },
  { tenantId: BUSINESS_B, role: 'business_owner' },
];

test('parseEmployeeInput: a complete employee is accepted and normalized', () => {
  const parsed = parseEmployeeInput(EMPLOYEE_INPUT);
  assert.equal(parsed.ok, true);
  assert.deepEqual(parsed.employee, {
    firstName: 'Ada',
    lastName: 'Lovelace',
    ssn: '123456789',
    filingStatus: 'single',
    allowances: 2,
    extraWithholding: 25,
    payRate: 45.5,
    payType: 'hourly',
  });
});

test('parseEmployeeInput: names are trimmed and an update may omit the SSN', () => {
  const parsed = parseEmployeeInput({
    ...EMPLOYEE_INPUT,
    firstName: '  Ada  ',
    lastName: 'Lovelace ',
    ssn: undefined,
  }, { ssnRequired: false });
  assert.equal(parsed.ok, true);
  assert.equal(parsed.employee.firstName, 'Ada');
  assert.equal(parsed.employee.ssn, null);
});

test('parseEmployeeInput: a bad SSN, filing status, pay type, allowances or rate is invalid_request with the field', () => {
  const cases = [
    [{ ...EMPLOYEE_INPUT, ssn: '123-45-678' }, 'ssn'],
    [{ ...EMPLOYEE_INPUT, ssn: '123-45-67890' }, 'ssn'],
    [{ ...EMPLOYEE_INPUT, filingStatus: 'married' }, 'filingStatus'],
    [{ ...EMPLOYEE_INPUT, payType: 'daily' }, 'payType'],
    [{ ...EMPLOYEE_INPUT, allowances: -1 }, 'allowances'],
    [{ ...EMPLOYEE_INPUT, allowances: 100 }, 'allowances'],
    [{ ...EMPLOYEE_INPUT, allowances: 1.5 }, 'allowances'],
    [{ ...EMPLOYEE_INPUT, extraWithholding: -1 }, 'extraWithholding'],
    [{ ...EMPLOYEE_INPUT, extraWithholding: 1.234 }, 'extraWithholding'],
    [{ ...EMPLOYEE_INPUT, payRate: 0 }, 'payRate'],
    [{ ...EMPLOYEE_INPUT, payRate: -5 }, 'payRate'],
    [{ ...EMPLOYEE_INPUT, payRate: 10.999 }, 'payRate'],
    [{ ...EMPLOYEE_INPUT, firstName: '   ' }, 'firstName'],
    [{ ...EMPLOYEE_INPUT, lastName: '' }, 'lastName'],
    [{ ...EMPLOYEE_INPUT, ssn: undefined }, 'ssn'],
  ];
  for (const [input, field] of cases) {
    const parsed = parseEmployeeInput(input);
    assert.equal(parsed.ok, false, JSON.stringify(input));
    assert.equal(parsed.error, 'invalid_request');
    assert.equal(parsed.field, field);
  }
});

test('SSN helpers: only the last four digits are ever shown', () => {
  assert.equal(normalizeSsn('123-45-6789'), '123456789');
  assert.equal(normalizeSsn('123 45 6789'), '123456789');
  assert.equal(normalizeSsn('12345678'), null);
  assert.equal(ssnLastFour('123456789'), '6789');
  assert.equal(maskSsn('6789'), '***-**-6789');
  assert.equal(maskSsn('678'), null);
});

test('SSN sealer: the sealed value round-trips, never contains the SSN, and differs on every seal', () => {
  const sealer = createSsnSealer({ key: SSN_KEY });
  const sealed = sealer.seal('123-45-6789');
  assert.equal(typeof sealed, 'string');
  assert.ok(!sealed.includes('123456789'));
  assert.equal(sealer.open(sealed), '123456789');
  assert.notEqual(sealer.seal('123456789'), sealed);
  assert.equal(sealer.open('not-a-sealed-blob'), null);
  assert.equal(sealer.open(sealed.slice(0, -4) + 'AAAA'), null);
  assert.throws(() => createSsnSealer({ key: randomBytes(16) }), /32-byte/);
  const other = createSsnSealer({ key: randomBytes(32) });
  assert.equal(other.open(sealed), null);
});

test('employee vocabularies: W-4 statuses match the site calculator, pay types are hourly/salary, and the lists are frozen', () => {
  assert.deepEqual([...FILING_STATUSES], ['single', 'mfj', 'hoh', 'mfs']);
  assert.deepEqual(FILING_STATUS_LABELS, {
    single: 'Single',
    mfj: 'Married filing jointly',
    hoh: 'Head of household',
    mfs: 'Married filing separately',
  });
  assert.deepEqual([...PAY_TYPES], ['hourly', 'salary']);
  assert.deepEqual([...EMPLOYEE_ACTIONS], ['list', 'create', 'update', 'deactivate']);
  assert.ok(Object.isFrozen(FILING_STATUSES));
  assert.ok(Object.isFrozen(PAY_TYPES));
  assert.ok(Object.isFrozen(EMPLOYEE_ACTIONS));
});

test('toEmployeeResponse: the full SSN and the sealed blob never leave the server', () => {
  const response = toEmployeeResponse(EMPLOYEE_ROW_A);
  assert.deepEqual(response, {
    employeeId: '55555555-5555-4555-8555-555555555555',
    tenantId: BUSINESS_A,
    firstName: 'Ada',
    lastName: 'Lovelace',
    ssnMasked: '***-**-6789',
    ssnLast4: '6789',
    filingStatus: 'single',
    filingStatusLabel: 'Single',
    allowances: 2,
    extraWithholding: 25,
    payRate: 45.5,
    payType: 'hourly',
    payTypeLabel: 'Hourly',
    status: 'active',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  });
  assert.ok(!JSON.stringify(response).includes('123456789'));
  assert.ok(!JSON.stringify(response).includes('sealed-ada'));
  assert.equal(toEmployeeResponse(null), null);
});

test('parseEmployeeRequest: list/create/update/deactivate only; the tenant id only selects a list', () => {
  assert.deepEqual(parseEmployeeRequest({ tenantId: BUSINESS_A, action: 'list' }), { ok: true, tenantId: BUSINESS_A, action: 'list', employeeId: null });
  assert.deepEqual(parseEmployeeRequest({ tenantId: null, action: 'list' }), { ok: true, tenantId: null, action: 'list', employeeId: null });
  assert.deepEqual(parseEmployeeRequest({ tenantId: BUSINESS_A, action: 'create' }), { ok: true, tenantId: null, action: 'create', employeeId: null });
  assert.deepEqual(parseEmployeeRequest({ tenantId: BUSINESS_A, action: 'update', employeeId: EMPLOYEE_ROW_A.employee_id }), { ok: true, tenantId: null, action: 'update', employeeId: EMPLOYEE_ROW_A.employee_id });
  assert.deepEqual(parseEmployeeRequest({ tenantId: BUSINESS_A, action: 'deactivate', employeeId: EMPLOYEE_ROW_A.employee_id }), { ok: true, tenantId: null, action: 'deactivate', employeeId: EMPLOYEE_ROW_A.employee_id });
  for (const request of [
    { tenantId: BUSINESS_A, action: 'delete' },
    { tenantId: 'not-a-uuid', action: 'list' },
    { tenantId: BUSINESS_A, action: 'list', employeeId: EMPLOYEE_ROW_A.employee_id },
    { tenantId: BUSINESS_A, action: 'create', employeeId: EMPLOYEE_ROW_A.employee_id },
    { tenantId: BUSINESS_A, action: 'update' },
    { tenantId: BUSINESS_A, action: 'update', employeeId: 'not-a-uuid' },
    { tenantId: BUSINESS_A, action: 'deactivate' },
    null,
  ]) {
    const parsed = parseEmployeeRequest(request);
    assert.equal(parsed.ok, false, JSON.stringify(request));
    assert.equal(parsed.error, 'invalid_request');
  }
});

test('createEmployeeLoader requires a query function', () => {
  assert.throws(() => createEmployeeLoader(), /query function is required/);
  assert.throws(() => createEmployeeLoader({ query: 'nope' }), /query function is required/);
});

test('loadMemberships: database rows are mapped to camelCase memberships for tenant resolution', async () => {
  const calls = [];
  const query = async (text, params) => {
    calls.push({ text, params });
    return { rows: [
      { subject_id: SUBJECT_ID, tenant_id: BUSINESS_A, role: 'business_owner', active: true },
      { subject_id: SUBJECT_ID, tenant_id: BUSINESS_B, role: 'business_owner', active: true },
    ] };
  };
  const loader = createEmployeeLoader({ query, sealSsn: () => 'sealed' });
  assert.deepEqual(await loader.loadMemberships(SUBJECT_ID), [
    { tenantId: BUSINESS_A, role: 'business_owner' },
    { tenantId: BUSINESS_B, role: 'business_owner' },
  ]);
  assert.ok(calls[0].text.includes('FROM payrollcheck.memberships'));
  assert.deepEqual(calls[0].params, [SUBJECT_ID]);
});

test('listEmployeesByTenant: parameterized, ordered, and scoped to one tenant', async () => {
  const calls = [];
  const query = async (text, params) => {
    calls.push({ text, params });
    return { rows: [EMPLOYEE_ROW_A] };
  };
  const rows = await listEmployeesByTenant(query, BUSINESS_A);
  assert.deepEqual(rows, [EMPLOYEE_ROW_A]);
  assert.equal(calls.length, 1);
  assert.ok(calls[0].text.includes('FROM payrollcheck.payroll_employees'));
  assert.ok(calls[0].text.includes('WHERE tenant_id = $1'));
  assert.ok(calls[0].text.includes('ORDER BY last_name ASC, first_name ASC, employee_id ASC'));
  assert.deepEqual(calls[0].params, [BUSINESS_A]);
  const activeCalls = [];
  const activeQuery = async (text, params) => {
    activeCalls.push({ text, params });
    return { rows: [] };
  };
  await listEmployeesByTenant(activeQuery, BUSINESS_A, { includeInactive: false });
  assert.ok(activeCalls[0].text.includes("status = 'active'"));
});

test('loadEmployeeById: parameterized, one row or null', async () => {
  const calls = [];
  const query = async (text, params) => {
    calls.push({ text, params });
    return { rows: [EMPLOYEE_ROW_A] };
  };
  assert.deepEqual(await loadEmployeeById(query, BUSINESS_A, EMPLOYEE_ROW_A.employee_id), EMPLOYEE_ROW_A);
  assert.ok(calls[0].text.includes('WHERE tenant_id = $1 AND employee_id = $2'));
  assert.deepEqual(calls[0].params, [BUSINESS_A, EMPLOYEE_ROW_A.employee_id]);
  const empty = async () => ({ rows: [] });
  assert.equal(await loadEmployeeById(empty, BUSINESS_A, EMPLOYEE_ROW_A.employee_id), null);
});

test('countEmployeesByTenant: parameterized, counts total and active', async () => {
  const calls = [];
  const query = async (text, params) => {
    calls.push({ text, params });
    return { rows: [{ total: '3', active: '2' }] };
  };
  assert.deepEqual(await countEmployeesByTenant(query, BUSINESS_A), { total: 3, active: 2 });
  assert.ok(calls[0].text.includes('FROM payrollcheck.payroll_employees'));
  assert.ok(calls[0].text.includes("status = 'active'"));
  assert.deepEqual(calls[0].params, [BUSINESS_A]);
});

test('createEmployee: the SSN is sealed before insert, only the last four are stored in the clear', async () => {
  const sealer = createSsnSealer({ key: SSN_KEY });
  const calls = [];
  const query = async (text, params) => {
    calls.push({ text, params });
    return { rows: [EMPLOYEE_ROW_A] };
  };
  const loader = createEmployeeLoader({ query, sealSsn: (ssn) => sealer.seal(ssn) });
  const created = await loader.createEmployee({ tenantId: BUSINESS_A, employee: parseEmployeeInput(EMPLOYEE_INPUT).employee });
  assert.deepEqual(created, EMPLOYEE_ROW_A);
  assert.equal(calls.length, 1);
  assert.ok(calls[0].text.includes('INSERT INTO payrollcheck.payroll_employees'));
  assert.ok(calls[0].text.includes('RETURNING'));
  assert.equal(calls[0].params[0], BUSINESS_A);
  assert.equal(calls[0].params[1], 'Ada');
  assert.equal(calls[0].params[2], 'Lovelace');
  assert.equal(typeof calls[0].params[3], 'string');
  assert.ok(!calls[0].params[3].includes('123456789'));
  assert.equal(sealer.open(calls[0].params[3]), '123456789');
  assert.equal(calls[0].params[4], '6789');
  assert.equal(calls[0].params[5], 'single');
  assert.equal(calls[0].params[6], 2);
  assert.equal(calls[0].params[7], 25);
  assert.equal(calls[0].params[8], 45.5);
  assert.equal(calls[0].params[9], 'hourly');
});

test('createEmployee: without an SSN sealer the write fails closed', async () => {
  const query = async () => ({ rows: [EMPLOYEE_ROW_A] });
  const loader = createEmployeeLoader({ query });
  await assert.rejects(
    () => loader.createEmployee({ tenantId: BUSINESS_A, employee: parseEmployeeInput(EMPLOYEE_INPUT).employee }),
    /SSN sealer is not configured/,
  );
});

test('updateEmployee: fields update in place; the sealed SSN is kept unless a new one is given', async () => {
  const sealer = createSsnSealer({ key: SSN_KEY });
  const calls = [];
  const query = async (text, params) => {
    calls.push({ text, params });
    return { rows: [EMPLOYEE_ROW_A] };
  };
  const loader = createEmployeeLoader({ query, sealSsn: (ssn) => sealer.seal(ssn) });
  const updated = await loader.updateEmployee({
    tenantId: BUSINESS_A,
    employeeId: EMPLOYEE_ROW_A.employee_id,
    employee: parseEmployeeInput({ ...EMPLOYEE_INPUT, firstName: 'Augusta', ssn: undefined }, { ssnRequired: false }).employee,
  });
  assert.deepEqual(updated, EMPLOYEE_ROW_A);
  assert.ok(calls[0].text.includes('UPDATE payrollcheck.payroll_employees'));
  // The RETURNING clause lists every column; only the SET clause must not
  // touch the sealed SSN when no new SSN was given.
  const setClause = calls[0].text.split('RETURNING')[0];
  assert.ok(!setClause.includes('ssn_encrypted'));
  assert.ok(!setClause.includes('ssn_last_four'));
  assert.ok(calls[0].text.includes('WHERE tenant_id = $1 AND employee_id = $2'));
  assert.equal(calls[0].params[2], 'Augusta');
  const calls2 = [];
  const query2 = async (text, params) => {
    calls2.push({ text, params });
    return { rows: [EMPLOYEE_ROW_A] };
  };
  const loader2 = createEmployeeLoader({ query: query2, sealSsn: (ssn) => sealer.seal(ssn) });
  await loader2.updateEmployee({
    tenantId: BUSINESS_A,
    employeeId: EMPLOYEE_ROW_A.employee_id,
    employee: parseEmployeeInput({ ...EMPLOYEE_INPUT, ssn: '987-65-4321' }).employee,
  });
  const setClause2 = calls2[0].text.split('RETURNING')[0];
  assert.ok(setClause2.includes('ssn_encrypted'));
  assert.ok(setClause2.includes('ssn_last_four'));
  assert.equal(sealer.open(calls2[0].params[9]), '987654321');
  assert.equal(calls2[0].params[10], '4321');
  const empty = async () => ({ rows: [] });
  const loader3 = createEmployeeLoader({ query: empty, sealSsn: (ssn) => sealer.seal(ssn) });
  assert.equal(await loader3.updateEmployee({
    tenantId: BUSINESS_A,
    employeeId: EMPLOYEE_ROW_A.employee_id,
    employee: parseEmployeeInput(EMPLOYEE_INPUT).employee,
  }), null);
});

test('deactivateEmployee: status flips to inactive, scoped by tenant and employee', async () => {
  const calls = [];
  const query = async (text, params) => {
    calls.push({ text, params });
    return { rows: [{ ...EMPLOYEE_ROW_A, status: 'inactive' }] };
  };
  const loader = createEmployeeLoader({ query, sealSsn: () => 'sealed' });
  const deactivated = await loader.deactivateEmployee({ tenantId: BUSINESS_A, employeeId: EMPLOYEE_ROW_A.employee_id });
  assert.equal(deactivated.status, 'inactive');
  assert.ok(calls[0].text.includes("SET status = 'inactive'"));
  assert.ok(calls[0].text.includes('WHERE tenant_id = $1 AND employee_id = $2'));
  assert.ok(!calls[0].text.includes('DELETE'));
  assert.deepEqual(calls[0].params, [BUSINESS_A, EMPLOYEE_ROW_A.employee_id]);
  const empty = async () => ({ rows: [] });
  const loader2 = createEmployeeLoader({ query: empty, sealSsn: () => 'sealed' });
  assert.equal(await loader2.deactivateEmployee({ tenantId: BUSINESS_A, employeeId: EMPLOYEE_ROW_A.employee_id }), null);
});

function makeHandler(overrides = {}) {
  const audits = [];
  const lists = [];
  const creates = [];
  const updates = [];
  const deactivations = [];
  const handler = createEmployeeAccessHandler({
    getVerifiedUser: async () => ({ id: AUTH_USER_ID, email_confirmed_at: '2026-01-01T00:00:00Z', is_anonymous: false }),
    requireAal2: async () => true,
    resolveSubjectId: async () => SUBJECT_ID,
    recordAudit: async (audit) => {
      audits.push(audit);
      return { ok: true };
    },
    checkRateLimit: async () => ({ allowed: true }),
    getSession: async () => ({ authUserId: AUTH_USER_ID }),
    generateId: () => 'req-1',
    now: () => NOW,
    loadMemberships: async () => MEMBERSHIPS,
    listEmployees: async ({ tenantId }) => {
      lists.push({ tenantId });
      return tenantId === BUSINESS_A ? [EMPLOYEE_ROW_A] : [EMPLOYEE_ROW_B];
    },
    createEmployee: async ({ tenantId, employee }) => {
      creates.push({ tenantId, employee });
      return {
        ...EMPLOYEE_ROW_A,
        tenant_id: tenantId,
        first_name: employee.firstName,
        last_name: employee.lastName,
        filing_status: employee.filingStatus,
        allowances: employee.allowances,
        extra_withholding: employee.extraWithholding,
        pay_rate: employee.payRate,
        pay_type: employee.payType,
      };
    },
    updateEmployee: async ({ tenantId, employeeId, employee }) => {
      updates.push({ tenantId, employeeId, employee });
      if (employeeId === EMPLOYEE_ROW_A.employee_id && tenantId === BUSINESS_A) {
        return {
          ...EMPLOYEE_ROW_A,
          first_name: employee.firstName,
          last_name: employee.lastName,
          filing_status: employee.filingStatus,
          allowances: employee.allowances,
          extra_withholding: employee.extraWithholding,
          pay_rate: employee.payRate,
          pay_type: employee.payType,
        };
      }
      return null;
    },
    deactivateEmployee: async ({ tenantId, employeeId }) => {
      deactivations.push({ tenantId, employeeId });
      if (employeeId === EMPLOYEE_ROW_A.employee_id && tenantId === BUSINESS_A) {
        return { ...EMPLOYEE_ROW_A, status: 'inactive' };
      }
      return null;
    },
    ...overrides,
  });
  return { handler, audits, lists, creates, updates, deactivations };
}

async function call(handler, { tenantId = BUSINESS_A, action = 'list', employee, employeeId } = {}) {
  return handler.handleEmployeeAccess({
    accessToken: SESSION_ID,
    sessionId: SESSION_ID,
    tenantId,
    action,
    employee,
    employeeId,
    requestId: 'req-1',
    clientIp: '203.0.113.10',
  });
}

test('employees list: a business lists its own employees, masked, with one audit row', async () => {
  const { handler, audits, lists } = makeHandler();
  const result = await call(handler, { action: 'list' });
  assert.equal(result.status, 200);
  assert.equal(result.ok, true);
  assert.deepEqual(result.employees, [toEmployeeResponse(EMPLOYEE_ROW_A)]);
  assert.equal(result.tenantId, BUSINESS_A);
  assert.ok(!JSON.stringify(result).includes('123456789'));
  assert.deepEqual(lists, [{ tenantId: BUSINESS_A }]);
  assert.equal(audits.length, 1);
  assert.deepEqual(audits[0], { requestId: 'req-1', actorSubjectId: SUBJECT_ID, reportId: null, action: 'employee_read', allowed: true, reason: 'allowed' });
});

test('employees list: another tenant\'s employees never leak', async () => {
  const { handler, audits, lists } = makeHandler();
  const result = await call(handler, { tenantId: BUSINESS_B, action: 'list' });
  assert.equal(result.status, 200);
  assert.deepEqual(result.employees, [toEmployeeResponse(EMPLOYEE_ROW_B)]);
  assert.equal(result.tenantId, BUSINESS_B);
  assert.deepEqual(lists, [{ tenantId: BUSINESS_B }]);
  assert.equal(audits.length, 1);
  assert.equal(audits[0].action, 'employee_read');
});

test('employees create: a business saves a new employee, masked, with one audit row', async () => {
  const { handler, audits, creates } = makeHandler();
  const result = await call(handler, { action: 'create', employee: EMPLOYEE_INPUT });
  assert.equal(result.status, 200);
  assert.equal(result.ok, true);
  assert.equal(result.employee.firstName, 'Ada');
  assert.equal(result.employee.ssnMasked, '***-**-6789');
  assert.ok(!JSON.stringify(result).includes('123456789'));
  assert.deepEqual(creates[0].employee, parseEmployeeInput(EMPLOYEE_INPUT).employee);
  assert.equal(creates[0].tenantId, BUSINESS_A);
  assert.equal(audits.length, 1);
  assert.deepEqual(audits[0], { requestId: 'req-1', actorSubjectId: SUBJECT_ID, reportId: null, action: 'employee_write', allowed: true, reason: 'allowed' });
});

test('employees create: invalid input is invalid_request, audited, and nothing is saved', async () => {
  const { handler, audits, creates } = makeHandler();
  const result = await call(handler, { action: 'create', employee: { ...EMPLOYEE_INPUT, ssn: '123' } });
  assert.equal(result.status, 400);
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'invalid_request');
  assert.equal(creates.length, 0);
  assert.equal(audits.length, 1);
  assert.deepEqual(audits[0], { requestId: 'req-1', actorSubjectId: SUBJECT_ID, reportId: null, action: 'employee_write', allowed: false, reason: 'invalid_request' });
});

test('employees update: a business updates its own employee, with one audit row', async () => {
  const { handler, audits, updates } = makeHandler();
  const result = await call(handler, {
    action: 'update',
    employeeId: EMPLOYEE_ROW_A.employee_id,
    employee: { ...EMPLOYEE_INPUT, firstName: 'Augusta', ssn: undefined },
  });
  assert.equal(result.status, 200);
  assert.equal(result.employee.firstName, 'Augusta');
  assert.equal(result.employee.ssnMasked, '***-**-6789');
  assert.equal(updates[0].employee.ssn, null);
  assert.equal(audits.length, 1);
  assert.equal(audits[0].action, 'employee_write');
  assert.equal(audits[0].allowed, true);
});

test('employees update and deactivate: an unknown or cross-tenant employee is not_found, audited', async () => {
  const { handler, audits } = makeHandler();
  const updated = await call(handler, {
    action: 'update',
    employeeId: EMPLOYEE_ROW_B.employee_id,
    employee: EMPLOYEE_INPUT,
  });
  assert.equal(updated.status, 404);
  assert.equal(updated.reason, 'not_found');
  const deactivated = await call(handler, { action: 'deactivate', employeeId: EMPLOYEE_ROW_B.employee_id });
  assert.equal(deactivated.status, 404);
  assert.equal(deactivated.reason, 'not_found');
  assert.equal(audits.length, 2);
  assert.ok(audits.every((audit) => audit.action === 'employee_write' && audit.allowed === false && audit.reason === 'not_found'));
});

test('employees deactivate: a business deactivates its own employee, with one audit row', async () => {
  const { handler, audits, deactivations } = makeHandler();
  const result = await call(handler, { action: 'deactivate', employeeId: EMPLOYEE_ROW_A.employee_id });
  assert.equal(result.status, 200);
  assert.equal(result.employee.status, 'inactive');
  assert.deepEqual(deactivations, [{ tenantId: BUSINESS_A, employeeId: EMPLOYEE_ROW_A.employee_id }]);
  assert.equal(audits.length, 1);
  assert.deepEqual(audits[0], { requestId: 'req-1', actorSubjectId: SUBJECT_ID, reportId: null, action: 'employee_write', allowed: true, reason: 'allowed' });
});

test('employees access: a caller who is not a member of the tenant is not_found, audited, for list and create', async () => {
  const { handler, audits, lists, creates } = makeHandler({
    loadMemberships: async () => [],
  });
  for (const action of ['list', 'create']) {
    const result = await call(handler, { action, employee: EMPLOYEE_INPUT });
    assert.equal(result.status, 404);
    assert.equal(result.reason, 'not_found');
  }
  assert.equal(lists.length, 0);
  assert.equal(creates.length, 0);
  assert.equal(audits.length, 2);
  assert.deepEqual(audits.map((audit) => audit.action), ['employee_read', 'employee_write']);
  assert.ok(audits.every((audit) => audit.allowed === false && audit.reason === 'not_found'));
});

test('employees access: a non-owner member cannot list, create, update or deactivate', async () => {
  const { handler, audits } = makeHandler({
    loadMemberships: async () => [
      { tenantId: BUSINESS_A, role: 'member' },
    ],
  });
  for (const [action, extra] of [
    ['list', {}],
    ['create', { employee: EMPLOYEE_INPUT }],
    ['update', { employeeId: EMPLOYEE_ROW_A.employee_id, employee: EMPLOYEE_INPUT }],
    ['deactivate', { employeeId: EMPLOYEE_ROW_A.employee_id }],
  ]) {
    const result = await call(handler, { action, ...extra });
    assert.equal(result.status, 404, action);
    assert.equal(result.reason, 'not_found', action);
  }
  assert.equal(audits.length, 4);
  assert.ok(audits.every((audit) => audit.allowed === false && audit.reason === 'not_found'));
});

test('employees access: without MFA the caller is told mfa_required, with no audit row', async () => {
  const { handler, audits } = makeHandler({ requireAal2: async () => false });
  const result = await call(handler, { action: 'list' });
  assert.equal(result.status, 403);
  assert.equal(result.reason, 'mfa_required');
  assert.equal(audits.length, 0);
});

test('employees access: an anonymous or unconfirmed user is invalid_session, with no audit row', async () => {
  const { handler, audits } = makeHandler({
    getVerifiedUser: async () => ({ id: AUTH_USER_ID, email_confirmed_at: null, is_anonymous: true }),
  });
  const result = await call(handler, { action: 'list' });
  assert.equal(result.status, 401);
  assert.equal(result.reason, 'invalid_session');
  assert.equal(audits.length, 0);
});

test('employees access: a revoked session is invalid_session, audited', async () => {
  const { handler, audits } = makeHandler({
    getSession: async () => ({ authUserId: AUTH_USER_ID, revoked: true }),
  });
  const result = await call(handler, { action: 'list' });
  assert.equal(result.status, 401);
  assert.equal(result.reason, 'invalid_session');
  assert.equal(audits.length, 1);
  assert.equal(audits[0].action, 'employee_read');
  assert.equal(audits[0].allowed, false);
});

test('employees access: rate-limited is 429 with no audit row; a failing rate-limit store degrades to allow', async () => {
  const limited = makeHandler({ checkRateLimit: async () => ({ allowed: false }) });
  const denied = await call(limited.handler, { action: 'list' });
  assert.equal(denied.status, 429);
  assert.equal(denied.reason, 'rate_limited');
  assert.equal(limited.audits.length, 0);
  const failing = makeHandler({ checkRateLimit: async () => { throw new Error('store down'); } });
  const allowed = await call(failing.handler, { action: 'list' });
  assert.equal(allowed.status, 200);
  assert.equal(failing.audits.length, 1);
});

test('employees access: a malformed tenant id or unknown action is invalid_request, audited', async () => {
  const { handler, audits } = makeHandler();
  const badTenant = await call(handler, { tenantId: 'not-a-uuid', action: 'list' });
  assert.equal(badTenant.status, 400);
  assert.equal(badTenant.reason, 'invalid_request');
  const badAction = await call(handler, { action: 'delete' });
  assert.equal(badAction.status, 400);
  assert.equal(badAction.reason, 'invalid_request');
  assert.equal(audits.length, 2);
});

test('employees access: a failing employee load is unavailable with no audit row', async () => {
  const { handler, audits } = makeHandler({
    loadMemberships: async () => { throw new Error('db down'); },
  });
  const result = await call(handler, { action: 'list' });
  assert.equal(result.status, 503);
  assert.equal(result.reason, 'unavailable');
  assert.equal(audits.length, 0);
});

test('createEmployeeAccessHandler requires its collaborators', () => {
  assert.throws(() => createEmployeeAccessHandler(), /is required/);
  assert.throws(() => createEmployeeAccessHandler({ getVerifiedUser: async () => null }), /requireAal2 is required/);
});
