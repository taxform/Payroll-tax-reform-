// Tax center (Slice 5): quarterly Form 941 and annual Form 940 views built
// only from finalized pay runs. Draft pay runs never contribute. Period
// totals are summed from the pay-run lines, and each period reports whether
// those sums reconcile to the finalized runs' header totals. Deposit dates
// are the pay dates of the finalized pay runs in the period. This is an
// independent review of the customer's own records; it is not proof from
// IRS records, and it files nothing.

export const TAX_CENTER_ACTIONS = Object.freeze(['summary']);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RUN_COLUMNS = 'pay_run_id, tenant_id, status, pay_period_start, pay_period_end, pay_date, frequency, gross_total, federal_withholding_total, fica_total, net_total, finalized_at, created_at, updated_at';
const LINE_COLUMNS = 'line_id, pay_run_id, tenant_id, employee_id, hours, filing_status, gross, federal_withholding, social_security, medicare, additional_medicare, net_pay, created_at';

export function parseTaxCenterRequest(request) {
  if (!request || typeof request !== 'object' || Array.isArray(request)) return { ok: false, error: 'invalid_request', field: 'request' };
  const { tenantId, action } = request;
  if (typeof action !== 'string' || !TAX_CENTER_ACTIONS.includes(action)) return { ok: false, error: 'invalid_request', field: 'action' };
  if (tenantId !== undefined && tenantId !== null && (typeof tenantId !== 'string' || !UUID_RE.test(tenantId))) return { ok: false, error: 'invalid_request', field: 'tenantId' };
  return { ok: true, tenantId: tenantId ?? null, action };
}

function toCents(value) {
  const amount = Number(value);
  return Number.isFinite(amount) ? Math.round(amount * 100) : 0;
}

function fromCents(cents) {
  return cents / 100;
}

function toIsoDate(value) {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    const year = value.getUTCFullYear();
    const month = String(value.getUTCMonth() + 1).padStart(2, '0');
    const day = String(value.getUTCDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }
  if (typeof value !== 'string') return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  return match ? `${match[1]}-${match[2]}-${match[3]}` : null;
}

function quarterOf(payDate) {
  const isoDate = toIsoDate(payDate);
  if (!isoDate) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (month < 1 || month > 12) return null;
  return { year, quarter: Math.floor((month - 1) / 3) + 1 };
}

function newPeriod(base) {
  return {
    ...base,
    payRunCount: 0,
    payRunIds: [],
    depositDates: [],
    deposits: [],
    wages: 0,
    federalWithholding: 0,
    socialSecurity: 0,
    medicare: 0,
    additionalMedicare: 0,
    fica: 0,
    totalTax: 0,
    reconciled: true,
  };
}

function addRunToPeriod(period, totals, deposit) {
  period.payRunCount += 1;
  period.deposits.push(deposit);
  period.wages += totals.gross;
  period.federalWithholding += totals.federalWithholding;
  period.socialSecurity += totals.socialSecurity;
  period.medicare += totals.medicare;
  period.additionalMedicare += totals.additionalMedicare;
  period.fica += totals.fica;
  period.totalTax += totals.totalTax;
  if (!totals.reconciled) period.reconciled = false;
}

function finalizePeriod(period) {
  period.deposits.sort((a, b) => (a.payDate < b.payDate ? -1 : a.payDate > b.payDate ? 1 : (a.payRunId < b.payRunId ? -1 : 1)));
  period.payRunIds = period.deposits.map((deposit) => deposit.payRunId);
  period.depositDates = [...new Set(period.deposits.map((deposit) => deposit.payDate))].sort();
  period.wages = fromCents(period.wages);
  period.federalWithholding = fromCents(period.federalWithholding);
  period.socialSecurity = fromCents(period.socialSecurity);
  period.medicare = fromCents(period.medicare);
  period.additionalMedicare = fromCents(period.additionalMedicare);
  period.fica = fromCents(period.fica);
  period.totalTax = fromCents(period.totalTax);
  return period;
}

export function buildTaxCenterSummary({ runs, linesByPayRunId } = {}) {
  const quarters = new Map();
  const years = new Map();
  const list = Array.isArray(runs) ? runs : [];
  for (const run of list) {
    if (!run || run.status !== 'final') continue;
    const period = quarterOf(run.pay_date ?? run.payDate);
    if (!period) continue;
    const lines = (linesByPayRunId && (linesByPayRunId[run.pay_run_id] ?? linesByPayRunId[run.payRunId])) || [];
    const totals = { gross: 0, federalWithholding: 0, socialSecurity: 0, medicare: 0, additionalMedicare: 0, netPay: 0 };
    for (const line of lines) {
      totals.gross += toCents(line.gross);
      totals.federalWithholding += toCents(line.federal_withholding ?? line.federalWithholding);
      totals.socialSecurity += toCents(line.social_security ?? line.socialSecurity);
      totals.medicare += toCents(line.medicare);
      totals.additionalMedicare += toCents(line.additional_medicare ?? line.additionalMedicare);
      totals.netPay += toCents(line.net_pay ?? line.netPay);
    }
    totals.fica = totals.socialSecurity + totals.medicare + totals.additionalMedicare;
    totals.totalTax = totals.federalWithholding + totals.fica;
    totals.reconciled =
      toCents(run.gross_total ?? run.grossTotal) === totals.gross &&
      toCents(run.federal_withholding_total ?? run.federalWithholdingTotal) === totals.federalWithholding &&
      toCents(run.fica_total ?? run.ficaTotal) === totals.fica &&
      toCents(run.net_total ?? run.netTotal) === totals.netPay;
    const deposit = {
      payRunId: run.pay_run_id ?? run.payRunId,
      payDate: toIsoDate(run.pay_date ?? run.payDate),
      federalWithholding: fromCents(totals.federalWithholding),
      socialSecurity: fromCents(totals.socialSecurity),
      medicare: fromCents(totals.medicare),
      additionalMedicare: fromCents(totals.additionalMedicare),
      totalTax: fromCents(totals.totalTax),
    };
    const quarterKey = `${period.year}-Q${period.quarter}`;
    if (!quarters.has(quarterKey)) quarters.set(quarterKey, newPeriod({ form: '941', year: period.year, quarter: period.quarter, period: quarterKey }));
    addRunToPeriod(quarters.get(quarterKey), totals, deposit);
    const yearKey = `${period.year}`;
    if (!years.has(yearKey)) years.set(yearKey, newPeriod({ form: '940', year: period.year, period: yearKey }));
    addRunToPeriod(years.get(yearKey), totals, deposit);
  }
  const form941 = [...quarters.values()].sort((a, b) => (a.year - b.year) || (a.quarter - b.quarter)).map(finalizePeriod);
  const form940 = [...years.values()].sort((a, b) => a.year - b.year).map(finalizePeriod);
  return { form941, form940 };
}

export function createTaxCenterLoader({ query } = {}) {
  if (typeof query !== 'function') throw new Error('query function is required');

  async function loadMemberships(subjectId) {
    const result = await query(
      'SELECT tenant_id, role FROM payrollcheck.memberships WHERE subject_id = $1 AND active = true LIMIT 50',
      [subjectId],
    );
    return result.rows.map((row) => ({ tenantId: row.tenant_id, role: row.role }));
  }

  async function loadFinalizedPayRuns(tenantId) {
    const result = await query(
      `SELECT ${RUN_COLUMNS} FROM payrollcheck.payroll_pay_runs WHERE tenant_id = $1 AND status = 'final' ORDER BY pay_date DESC, created_at DESC, pay_run_id DESC`,
      [tenantId],
    );
    return result.rows;
  }

  async function loadPayRunLines(tenantId, payRunId) {
    const result = await query(
      `SELECT ${LINE_COLUMNS} FROM payrollcheck.payroll_pay_run_lines WHERE tenant_id = $1 AND pay_run_id = $2 ORDER BY line_id`,
      [tenantId, payRunId],
    );
    return result.rows;
  }

  async function loadTaxCenter(tenantId) {
    const runs = await loadFinalizedPayRuns(tenantId);
    const linesByPayRunId = {};
    for (const run of runs) {
      linesByPayRunId[run.pay_run_id] = await loadPayRunLines(tenantId, run.pay_run_id);
    }
    return { tenantId, ...buildTaxCenterSummary({ runs, linesByPayRunId }) };
  }

  return Object.freeze({ loadMemberships, loadFinalizedPayRuns, loadPayRunLines, loadTaxCenter });
}
