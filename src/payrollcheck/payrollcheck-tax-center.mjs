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
}

function finalizePeriod(period) {
  const depositDates = [...new Set(period.deposits.map((deposit) => deposit.payDate))].sort();
  return {
    period: period.period,
    year: period.year,
    quarter: period.quarter ?? null,
    payRunCount: period.payRunCount,
    payRunIds: [...period.payRunIds].sort(),
    depositDates,
    deposits: [...period.deposits].sort((a, b) => (a.payDate < b.payDate ? -1 : a.payDate > b.payDate ? 1 : 0)),
    wages: fromCents(period.wages),
    federalWithholding: fromCents(period.federalWithholding),
    socialSecurity: fromCents(period.socialSecurity),
    medicare: fromCents(period.medicare),
    additionalMedicare: fromCents(period.additionalMedicare),
    fica: fromCents(period.fica),
    totalTax: fromCents(period.totalTax),
    reconciled: period.reconciled,
  };
}

export function buildTaxCenterSummary({ runs = [], linesByPayRunId = {} } = {}) {
  const periods941 = new Map();
  const periods940 = new Map();
  for (const run of runs) {
    if (run.status !== 'final') continue;
    const period = quarterOf(run.pay_date ?? run.payDate);
    if (!period) continue;
    const lines = linesByPayRunId[run.pay_run_id ?? run.payRunId] ?? [];
    const totals = {
      gross: 0,
      federalWithholding: 0,
      socialSecurity: 0,
      medicare: 0,
      additionalMedicare: 0,
      fica: 0,
      totalTax: 0,
    };
    for (const line of lines) {
      const gross = toCents(line.gross);
      const federalWithholding = toCents(line.federal_withholding ?? line.federalWithholding);
      const socialSecurity = toCents(line.social_security ?? line.socialSecurity);
      const medicare = toCents(line.medicare);
      const additionalMedicare = toCents(line.additional_medicare ?? line.additionalMedicare);
      const fica = socialSecurity + medicare + additionalMedicare;
      totals.gross += gross;
      totals.federalWithholding += federalWithholding;
      totals.socialSecurity += socialSecurity;
      totals.medicare += medicare;
      totals.additionalMedicare += additionalMedicare;
      totals.fica += fica;
      totals.totalTax += federalWithholding + fica;
    }
    const deposit = {
      payRunId: run.pay_run_id ?? run.payRunId,
      payDate: toIsoDate(run.pay_date ?? run.payDate),
      gross: fromCents(totals.gross),
      federalWithholding: fromCents(totals.federalWithholding),
      socialSecurity: fromCents(totals.socialSecurity),
      medicare: fromCents(totals.medicare),
      additionalMedicare: fromCents(totals.additionalMedicare),
      fica: fromCents(totals.fica),
      totalTax: fromCents(totals.totalTax),
    };
    const period941Key = `${period.year}-Q${period.quarter}`;
    if (!periods941.has(period941Key)) periods941.set(period941Key, newPeriod({ period: period941Key, year: period.year, quarter: period.quarter }));
    const period941 = periods941.get(period941Key);
    period941.payRunIds.push(run.pay_run_id ?? run.payRunId);
    addRunToPeriod(period941, totals, deposit);
    const period940Key = `${period.year}`;
    if (!periods940.has(period940Key)) periods940.set(period940Key, newPeriod({ period: period940Key, year: period.year, quarter: null }));
    const period940 = periods940.get(period940Key);
    period940.payRunIds.push(run.pay_run_id ?? run.payRunId);
    addRunToPeriod(period940, totals, deposit);
    const headerTotal = toCents(run.federal_withholding_total ?? run.federalWithholdingTotal) + toCents(run.fica_total ?? run.ficaTotal);
    if (totals.totalTax !== headerTotal || totals.gross !== toCents(run.gross_total ?? run.grossTotal)) {
      period941.reconciled = false;
      period940.reconciled = false;
    }
  }
  return {
    form941: [...periods941.values()].sort((a, b) => (a.period < b.period ? -1 : 1)).map(finalizePeriod),
    form940: [...periods940.values()].sort((a, b) => (a.period < b.period ? -1 : 1)).map(finalizePeriod),
  };
}

export function createTaxCenterLoader({ database, audit, runSql } = {}) {
  if (!database || typeof database.query !== 'function') throw new TypeError('database.query is required');
  if (!audit || typeof audit.record !== 'function') throw new TypeError('audit.record is required');
  if (typeof runSql !== 'function') throw new TypeError('runSql is required');
  return async ({ tenantId }) => {
    const sql = `
      select ${RUN_COLUMNS} from payrollcheck.pay_runs
      where tenant_id = $1 and status = 'final'
      order by pay_date asc, pay_run_id asc`;
    const runs = await database.query(sql, [tenantId]);
    const runIds = runs.map((run) => run.pay_run_id);
    let lines = [];
    if (runIds.length > 0) {
      lines = await database.query(
        `select ${LINE_COLUMNS} from payrollcheck.pay_run_lines where tenant_id = $1 and pay_run_id = any($2::uuid[]) order by pay_run_id asc, line_id asc`,
        [tenantId, runIds],
      );
    }
    const linesByPayRunId = {};
    for (const line of lines) {
      const runLines = linesByPayRunId[line.pay_run_id] ?? [];
      runLines.push(line);
      linesByPayRunId[line.pay_run_id] = runLines;
    }
    await audit.record({
      tenantId,
      userId: null,
      action: 'tax_center_read',
      resourceType: 'tax_center',
      resourceId: null,
      allowed: true,
      reason: 'allowed',
    });
    const summary = buildTaxCenterSummary({ runs, linesByPayRunId });
    return { tenantId, ...summary };
  };
}
