// PayrollCheck 360 - Slice 3 (Employees).
//
// A business can create, list and update its own employees in
// payrollcheck.payroll_employees, RLS-scoped to its tenant, and deactivate
// them (status 'inactive'; there is no DELETE). Employee SSNs are sealed
// with AES-256-GCM before they reach the database (see payrollcheck-ssn.mjs)
// and are never returned in full: the API only ever exposes the masked form
// (***-**-1234) derived from the stored last four digits.
//
// No pay math happens here (Slice 3): filing status, allowances / extra
// withholding, pay rate and pay type are stored for later slices to use.

import { maskSsn, normalizeSsn, ssnLastFour } from './payrollcheck-ssn.mjs';

export const EMPLOYEE_ACTIONS = Object.freeze(['list', 'create', 'update', 'deactivate']);
// W-4 filing statuses, using the same short values as the site's payroll
// tax calculator (public/tools/payroll-tax-calculator.html).
export const FILING_STATUSES = Object.freeze(['single', 'mfj', 'hoh', 'mfs']);
export const FILING_STATUS_LABELS = Object.freeze({
  single: 'Single',
  mfj: 'Married filing jointly',
  hoh: 'Head of household',
  mfs: 'Married filing separately',
});
export const PAY_TYPES = Object.freeze(['hourly', 'salary']);
export const PAY_TYPE_LABELS = Object.freeze({ hourly: 'Hourly', salary: 'Salary' });
export const EMPLOYEE_STATUSES = Object.freeze(['active', 'inactive']);

const EMPLOYEE_COLUMNS =
  'employee_id, tenant_id, first_name, last_name, ssn_encrypted, ssn_last_four, ' +
  'filing_status, allowances, extra_withholding, pay_rate, pay_type, status, created_at, updated_at';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isEmployeeId(value) {
  return typeof value === 'string' && UUID_RE.test(value);
}

function invalid(field) {
  return { ok: false, error: 'invalid_request', field };
}

function parseName(value) {
  if (typeof value !== 'string') return null;
  const name = value.trim();
  if (name.length < 1 || name.length > 100) return null;
  return name;
}

function parseAllowances(value) {
  if (typeof value === 'number') {
    return Number.isInteger(value) && value >= 0 && value <= 99 ? value : null;
  }
  if (typeof value === 'string' && /^[0-9]+$/.test(value.trim())) {
    const parsed = Number(value.trim());
    return Number.isInteger(parsed) && parsed >= 0 && parsed <= 99 ? parsed : null;
  }
  return null;
}

// Money: a finite number with at most two decimal places. Accepts a number
// or a numeric string (the JSON the UI sends uses numbers).
function parseMoney(value, { minimum = 0 } = {}) {
  let amount = null;
  if (typeof value === 'number') {
    amount = value;
  } else if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) {
    amount = Number(value);
  }
  if (amount === null || !Number.isFinite(amount) || amount < minimum) return null;
  const cents = Math.round(amount * 100);
  if (Math.abs(amount * 100 - cents) > 1e-6) return null;
  return cents / 100;
}

export function parseEmployeeInput(input, { ssnRequired = true } = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return invalid('employee');
  const firstName = parseName(input.firstName);
  if (firstName === null) return invalid('firstName');
  const lastName = parseName(input.lastName);
  if (lastName === null) return invalid('lastName');
  let ssn = null;
  if (input.ssn === undefined || input.ssn === null || input.ssn === '') {
    if (ssnRequired) return invalid('ssn');
  } else {
    ssn = normalizeSsn(input.ssn);
    if (ssn === null) return invalid('ssn');
  }
  if (typeof input.filingStatus !== 'string' || !FILING_STATUSES.includes(input.filingStatus)) {
    return invalid('filingStatus');
  }
  const allowances = parseAllowances(input.allowances);
  if (allowances === null) return invalid('allowances');
  const extraWithholding = parseMoney(input.extraWithholding, { minimum: 0 });
  if (extraWithholding === null) return invalid('extraWithholding');
  const payRate = parseMoney(input.payRate, { minimum: 0 });
  if (payRate === null || payRate <= 0) return invalid('payRate');
  if (typeof input.payType !== 'string' || !PAY_TYPES.includes(input.payType)) {
    return invalid('payType');
  }
  return {
    ok: true,
    employee: {
      firstName,
      lastName,
      ssn,
      filingStatus: input.filingStatus,
      allowances,
      extraWithholding,
      payRate,
      payType: input.payType,
    },
  };
}

export function parseEmployeeRequest(request) {
  if (!request || typeof request !== 'object' || Array.isArray(request)) {
    return { ok: false, error: 'invalid_request', field: 'request' };
  }
  const { tenantId, action, employeeId } = request;
  if (typeof action !== 'string' || !EMPLOYEE_ACTIONS.includes(action)) {
    return { ok: false, error: 'invalid_request', field: 'action' };
  }
  if (action === 'list') {
    if (tenantId !== undefined && tenantId !== null && !isEmployeeId(tenantId)) {
      return { ok: false, error: 'invalid_request', field: 'tenantId' };
    }
    if (employeeId !== undefined && employeeId !== null) {
      return { ok: false, error: 'invalid_request', field: 'employeeId' };
    }
    return { ok: true, tenantId: tenantId ?? null, action, employeeId: null };
  }
  if (action === 'create') {
    if (employeeId !== undefined && employeeId !== null) {
      return { ok: false, error: 'invalid_request', field: 'employeeId' };
    }
    // Writes target the caller's own tenant, resolved from memberships -
    // a caller-supplied tenant id is never trusted for a write (same as
    // the company profile write in Slice 2).
    return { ok: true, tenantId: null, action, employeeId: null };
  }
  if (!isEmployeeId(employeeId)) {
    return { ok: false, error: 'invalid_request', field: 'employeeId' };
  }
  return { ok: true, tenantId: null, action, employeeId };
}

export function toEmployeeResponse(row) {
  if (!row || typeof row !== 'object') return null;
  return {
    employeeId: row.employee_id,
    tenantId: row.tenant_id,
    firstName: row.first_name,
    lastName: row.last_name,
    ssnMasked: maskSsn(row.ssn_last_four),
    ssnLast4: row.ssn_last_four,
    filingStatus: row.filing_status,
    filingStatusLabel: FILING_STATUS_LABELS[row.filing_status] ?? row.filing_status,
    allowances: Number(row.allowances),
    extraWithholding: Number(row.extra_withholding),
    payRate: Number(row.pay_rate),
    payType: row.pay_type,
    payTypeLabel: PAY_TYPE_LABELS[row.pay_type] ?? row.pay_type,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function listEmployeesByTenant(query, tenantId, { includeInactive = true } = {}) {
  if (typeof query !== 'function') throw new Error('query function is required');
  const where = includeInactive
    ? 'WHERE tenant_id = $1'
    : "WHERE tenant_id = $1 AND status = 'active'";
  const result = await query(
    `SELECT ${EMPLOYEE_COLUMNS} FROM payrollcheck.payroll_employees ` +
      `${where} ORDER BY last_name ASC, first_name ASC, employee_id ASC`,
    [tenantId],
  );
  return result.rows;
}

export async function loadEmployeeById(query, tenantId, employeeId) {
  if (typeof query !== 'function') throw new Error('query function is required');
  const result = await query(
    `SELECT ${EMPLOYEE_COLUMNS} FROM payrollcheck.payroll_employees ` +
      'WHERE tenant_id = $1 AND employee_id = $2 LIMIT 1',
    [tenantId, employeeId],
  );
  return result.rows[0] ?? null;
}

export async function countEmployeesByTenant(query, tenantId) {
  if (typeof query !== 'function') throw new Error('query function is required');
  const result = await query(
    'SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE status = \'active\')::int AS active ' +
      'FROM payrollcheck.payroll_employees WHERE tenant_id = $1',
    [tenantId],
  );
  const row = result.rows[0] ?? { total: 0, active: 0 };
  return { total: Number(row.total) || 0, active: Number(row.active) || 0 };
}

export function createEmployeeLoader({ query, sealSsn } = {}) {
  if (typeof query !== 'function') throw new Error('query function is required');

  async function loadMemberships(subjectId) {
    const result = await query(
      'SELECT subject_id, tenant_id, role, active FROM payrollcheck.memberships ' +
        'WHERE subject_id = $1 AND active = true LIMIT 50',
      [subjectId],
    );
    // resolveDashboardTenant matches on camelCase tenantId, so the rows
    // are mapped here (same as the company loader in Slice 2).
    return result.rows.map((row) => ({ tenantId: row.tenant_id, role: row.role }));
  }

  function requireSealer() {
    if (typeof sealSsn !== 'function') {
      throw new Error('SSN sealer is not configured');
    }
    return sealSsn;
  }

  async function listEmployees({ tenantId, includeInactive = true } = {}) {
    return listEmployeesByTenant(query, tenantId, { includeInactive });
  }

  async function createEmployee({ tenantId, employee } = {}) {
    const seal = requireSealer();
    const ssnEncrypted = seal(employee.ssn);
    const result = await query(
      'INSERT INTO payrollcheck.payroll_employees ' +
        '(tenant_id, first_name, last_name, ssn_encrypted, ssn_last_four, filing_status, ' +
        'allowances, extra_withholding, pay_rate, pay_type) ' +
        'VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) ' +
        `RETURNING ${EMPLOYEE_COLUMNS}`,
      [
        tenantId,
        employee.firstName,
        employee.lastName,
        ssnEncrypted,
        ssnLastFour(employee.ssn),
        employee.filingStatus,
        employee.allowances,
        employee.extraWithholding,
        employee.payRate,
        employee.payType,
      ],
    );
    return result.rows[0] ?? null;
  }

  async function updateEmployee({ tenantId, employeeId, employee } = {}) {
    const sets = [
      'first_name = $3',
      'last_name = $4',
      'filing_status = $5',
      'allowances = $6',
      'extra_withholding = $7',
      'pay_rate = $8',
      'pay_type = $9',
    ];
    const values = [
      tenantId,
      employeeId,
      employee.firstName,
      employee.lastName,
      employee.filingStatus,
      employee.allowances,
      employee.extraWithholding,
      employee.payRate,
      employee.payType,
    ];
    if (employee.ssn) {
      const seal = requireSealer();
      sets.push(`ssn_encrypted = $${values.length + 1}`);
      values.push(seal(employee.ssn));
      sets.push(`ssn_last_four = $${values.length + 1}`);
      values.push(ssnLastFour(employee.ssn));
    }
    sets.push('updated_at = now()');
    const result = await query(
      `UPDATE payrollcheck.payroll_employees SET ${sets.join(', ')} ` +
        'WHERE tenant_id = $1 AND employee_id = $2 ' +
        `RETURNING ${EMPLOYEE_COLUMNS}`,
      values,
    );
    return result.rows[0] ?? null;
  }

  async function deactivateEmployee({ tenantId, employeeId } = {}) {
    const result = await query(
      "UPDATE payrollcheck.payroll_employees SET status = 'inactive', updated_at = now() " +
        'WHERE tenant_id = $1 AND employee_id = $2 ' +
        `RETURNING ${EMPLOYEE_COLUMNS}`,
      [tenantId, employeeId],
    );
    return result.rows[0] ?? null;
  }

  return Object.freeze({
    loadMemberships,
    listEmployees,
    createEmployee,
    updateEmployee,
    deactivateEmployee,
    loadEmployeeById: (tenantId, employeeId) => loadEmployeeById(query, tenantId, employeeId),
    countEmployeesByTenant: (tenantId) => countEmployeesByTenant(query, tenantId),
  });
}
