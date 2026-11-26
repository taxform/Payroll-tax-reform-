import { calculatePayLine, PAY_FREQUENCY_PERIODS } from './payrollcheck-withholding.mjs';

export const PAY_RUN_ACTIONS = Object.freeze(['preview', 'create', 'list', 'get', 'delete', 'finalize']);
export const PAY_RUN_STATUSES = Object.freeze(['draft', 'final']);
export const PAY_FREQUENCIES = Object.freeze(['weekly', 'biweekly', 'semimonthly', 'monthly']);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RUN_COLUMNS = 'pay_run_id, tenant_id, status, pay_period_start, pay_period_end, pay_date, frequency, gross_total, federal_withholding_total, fica_total, net_total, finalized_at, created_at, updated_at';

export function isPayRunId(value) { return typeof value === 'string' && UUID_RE.test(value); }
function parseDate(value) { return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null; }

export function parsePayRunRequest(request) {
  if (!request || typeof request !== 'object' || Array.isArray(request)) return { ok: false, error: 'invalid_request', field: 'request' };
  const { tenantId, action, payRunId } = request;
  if (typeof action !== 'string' || !PAY_RUN_ACTIONS.includes(action)) return { ok: false, error: 'invalid_request', field: 'action' };
  if (tenantId !== undefined && tenantId !== null && !isPayRunId(tenantId)) return { ok: false, error: 'invalid_request', field: 'tenantId' };
  if (action === 'preview' || action === 'create') {
    if (payRunId !== undefined && payRunId !== null) return { ok: false, error: 'invalid_request', field: 'payRunId' };
    return { ok: true, tenantId: null, action, payRunId: null };
  }
  if (action === 'list') return { ok: true, tenantId: tenantId ?? null, action, payRunId: null };
  if (!isPayRunId(payRunId)) return { ok: false, error: 'invalid_request', field: 'payRunId' };
  return { ok: true, tenantId: null, action, payRunId };
}

export function parsePayRunInput(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { ok: false, error: 'invalid_request', field: 'payRun' };
  const payPeriodStart = parseDate(input.payPeriodStart);
  const payPeriodEnd = parseDate(input.payPeriodEnd);
  const payDate = parseDate(input.payDate);
  if (!payPeriodStart) return { ok: false, error: 'invalid_request', field: 'payPeriodStart' };
  if (!payPeriodEnd) return { ok: false, error: 'invalid_request', field: 'payPeriodEnd' };
  if (!payDate) return { ok: false, error: 'invalid_request', field: 'payDate' };
  if (!PAY_FREQUENCIES.includes(input.frequency)) return { ok: false, error: 'invalid_request', field: 'frequency' };
  const lines = input.lines === undefined ? [] : Array.isArray(input.lines) ? input.lines : null;
  if (!lines) return { ok: false, error: 'invalid_request', field: 'lines' };
  return { ok: true, payRun: { payPeriodStart, payPeriodEnd, payDate, frequency: input.frequency, lines } };
}

function grossForEmployee(employee, line, frequency) {
  const payRate = Number(employee.pay_rate ?? employee.payRate);
  if (!Number.isFinite(payRate)) return 0;
  if (employee.pay_type === 'hourly' || employee.payType === 'hourly') {
    const defaults = { weekly: 40, biweekly: 80, semimonthly: 86.67, monthly: 173.33 };
    const hours = Number(line?.hours ?? defaults[frequency]);
    return Math.round(payRate * (Number.isFinite(hours) ? hours : defaults[frequency]) * 100) / 100;
  }
  return Math.round(payRate / PAY_FREQUENCY_PERIODS[frequency] * 100) / 100;
}

export function calculatePayRunLines({ employees = [], lines = [], frequency = 'weekly', ytdByEmployee = {} } = {}) {
  const computed = [];
  let grossTotal = 0, federalTotal = 0, ssTotal = 0, medicareTotal = 0, additionalTotal = 0, netTotal = 0;
  for (const employee of employees) {
    const employeeId = employee.employee_id ?? employee.employeeId;
    const requestLine = lines.find((line) => (line.employeeId ?? line.employee_id) === employeeId) ?? {};
    const filingStatus = requestLine.filingStatus ?? employee.filing_status ?? employee.filingStatus ?? 'single';
    const employeeFrequency = requestLine.frequency ?? employee.pay_frequency ?? employee.payFrequency ?? frequency;
  const gross = grossForEmployee(employee, requestLine, employeeFrequency);
    const ytd = Number(ytdByEmployee[employeeId] ?? 0);
    const pay = calculatePayLine({ gross, frequency: employeeFrequency, filingStatus, ytdWages: ytd });
    const extra = Number(requestLine.extraWithholding ?? employee.extra_withholding ?? employee.extraWithholding ?? 0);
    const federal = Math.round((pay.federalWithholding + (Number.isFinite(extra) ? extra : 0)) * 100) / 100;
    const net = Math.round((gross - federal - pay.socialSecurity - pay.medicare - pay.additionalMedicare) * 100) / 100;
    const row = {
      employeeId,
      gross,
      federalWithholding: federal,
      socialSecurity: pay.socialSecurity,
      medicare: pay.medicare,
      additionalMedicare: pay.additionalMedicare,
      netPay: net,
      hours: requestLine.hours,
      filingStatus,
    };
    computed.push(row);
    grossTotal += gross; federalTotal += federal; ssTotal += pay.socialSecurity;
    medicareTotal += pay.medicare; additionalTotal += pay.additionalMedicare; netTotal += net;
  }
  return {
    lines: computed,
    totals: {
      gross: Math.round(grossTotal * 100) / 100,
      federalWithholding: Math.round(federalTotal * 100) / 100,
      socialSecurity: Math.round(ssTotal * 100) / 100,
      medicare: Math.round(medicareTotal * 100) / 100,
      additionalMedicare: Math.round(additionalTotal * 100) / 100,
      fica: Math.round((ssTotal + medicareTotal + additionalTotal) * 100) / 100,
      net: Math.round(netTotal * 100) / 100,
    },
  };
}

export function toPayRunResponse(row, lines = []) {
  if (!row) return null;
  return {
    payRunId: row.pay_run_id,
    tenantId: row.tenant_id,
    status: row.status,
    payPeriodStart: row.pay_period_start,
    payPeriodEnd: row.pay_period_end,
    payDate: row.pay_date,
    frequency: row.frequency,
    totals: {
      gross: Number(row.gross_total ?? 0),
      federalWithholding: Number(row.federal_withholding_total ?? 0),
      fica: Number(row.fica_total ?? 0),
      net: Number(row.net_total ?? 0),
    },
    lines: lines.map((line) => ({
      lineId: line.line_id,
      payRunId: line.pay_run_id,
      employeeId: line.employee_id,
      hours: line.hours == null ? null : Number(line.hours),
      filingStatus: line.filing_status,
      gross: Number(line.gross),
      federalWithholding: Number(line.federal_withholding),
      socialSecurity: Number(line.social_security),
      medicare: Number(line.medicare),
      additionalMedicare: Number(line.additional_medicare),
      netPay: Number(line.net_pay),
    })),
    finalizedAt: row.finalized_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function listPayRunsByTenant(query, tenantId) {
  const result = await query(`SELECT ${RUN_COLUMNS} FROM payrollcheck.payroll_pay_runs WHERE tenant_id = $1 ORDER BY pay_period_start DESC, created_at DESC, pay_run_id DESC`, [tenantId]);
  return result.rows;
}

export async function loadPayRunById(query, tenantId, payRunId) {
  const result = await query(`SELECT ${RUN_COLUMNS} FROM payrollcheck.payroll_pay_runs WHERE tenant_id = $1 AND pay_run_id = $2 LIMIT 1`, [tenantId, payRunId]);
  return result.rows[0] ?? null;
}

export async function loadPayRunLines(query, tenantId, payRunId) {
  const result = await query(
    'SELECT line_id, pay_run_id, tenant_id, employee_id, hours, filing_status, gross, federal_withholding, social_security, medicare, additional_medicare, net_pay, created_at ' +
    'FROM payrollcheck.payroll_pay_run_lines WHERE tenant_id = $1 AND pay_run_id = $2 ORDER BY line_id',
    [tenantId, payRunId],
  );
  return result.rows;
}

export function createPayRunLoader({ query, generateId } = {}) {
  if (typeof query !== 'function') throw new Error('query function is required');
  async function loadMemberships(subjectId) {
    const result = await query(
      'SELECT tenant_id, role FROM payrollcheck.memberships WHERE subject_id = $1 AND active = true LIMIT 50',
      [subjectId],
    );
    return result.rows.map((row) => ({ tenantId: row.tenant_id, role: row.role }));
  }
  async function listEmployees(tenantId) {
    const result = await query(
      "SELECT employee_id, tenant_id, first_name, last_name, filing_status, allowances, extra_withholding, pay_rate, pay_type, status FROM payrollcheck.payroll_employees WHERE tenant_id = $1 AND status = 'active'",
      [tenantId],
    );
    return result.rows;
  }
  async function previewPayRun({ tenantId, payRun }) {
    const employees = await listEmployees(tenantId);
    return calculatePayRunLines({ employees, lines: payRun.lines, frequency: payRun.frequency });
  }
  async function createPayRun({ tenantId, payRun }) {
    const employees = await listEmployees(tenantId);
    const computed = calculatePayRunLines({ employees, lines: payRun.lines, frequency: payRun.frequency });
    const totals = computed.totals;
    const payRunId = typeof generateId === 'function' ? generateId() : undefined;
    const values = [payRunId, tenantId, payRun.payPeriodStart, payRun.payPeriodEnd, payRun.payDate, payRun.frequency,
      totals.gross, totals.federalWithholding, totals.fica, totals.net];
    const insert = payRunId
      ? `INSERT INTO payrollcheck.payroll_pay_runs (pay_run_id, tenant_id, status, pay_period_start, pay_period_end, pay_date, frequency, gross_total, federal_withholding_total, fica_total, net_total) VALUES ($1::uuid, $2::uuid, 'draft', $3, $4, $5, $6, $7, $8, $9, $10) RETURNING ${RUN_COLUMNS}`
      : `INSERT INTO payrollcheck.payroll_pay_runs (tenant_id, status, pay_period_start, pay_period_end, pay_date, frequency, gross_total, federal_withholding_total, fica_total, net_total) VALUES ($1::uuid, 'draft', $2, $3, $4, $5, $6, $7, $8, $9) RETURNING ${RUN_COLUMNS}`;
    const params = payRunId ? values : values.slice(1);
    const result = await query(insert, params);
    const row = result.rows[0];
    if (!row) return null;
    for (const line of computed.lines) {
      await query(
        'INSERT INTO payrollcheck.payroll_pay_run_lines (pay_run_id, tenant_id, employee_id, hours, filing_status, gross, federal_withholding, social_security, medicare, additional_medicare, net_pay) ' +
        'VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5, $6, $7, $8, $9, $10, $11)',
        [row.pay_run_id, tenantId, line.employeeId, line.hours ?? null, line.filingStatus, line.gross, line.federalWithholding,
          line.socialSecurity, line.medicare, line.additionalMedicare, line.netPay],
      );
    }
    return row;
  }
  async function deletePayRun({ tenantId, payRunId }) {
    const result = await query(
      "DELETE FROM payrollcheck.payroll_pay_runs WHERE tenant_id = $1 AND pay_run_id = $2 AND status = 'draft' RETURNING " + RUN_COLUMNS,
      [tenantId, payRunId],
    );
    return result.rows[0] ?? null;
  }
  async function finalizePayRun({ tenantId, payRunId }) {
    const result = await query(
      "UPDATE payrollcheck.payroll_pay_runs SET status = 'final', finalized_at = now(), updated_at = now() WHERE tenant_id = $1 AND pay_run_id = $2 AND status = 'draft' RETURNING " + RUN_COLUMNS,
      [tenantId, payRunId],
    );
    return result.rows[0] ?? null;
  }
  return Object.freeze({
    loadMemberships,
    previewPayRun,
    createPayRun,
    listPayRuns: (tenantId) => listPayRunsByTenant(query, tenantId),
    getPayRun: (tenantId, payRunId) => loadPayRunById(query, tenantId, payRunId),
    loadPayRunLines: (tenantId, payRunId) => loadPayRunLines(query, tenantId, payRunId),
    deletePayRun,
    finalizePayRun,
  });
}
