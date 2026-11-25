// Company profile (Slice 2).
// Pure helpers and the RLS-bound loader for payrollcheck.payroll_companies
// (one row per tenant). The EIN is stored as nine digits and is never
// returned in full: every read path goes through toCompanyResponse, which
// exposes only the masked EIN and its last four digits. The pay schedules
// and their periods per year are the ones the site's payroll tax calculator
// already uses (public/tools/payroll-tax-calculator.html).

export const PAY_SCHEDULES = Object.freeze(['weekly', 'biweekly', 'semi_monthly', 'monthly']);

export const PAY_SCHEDULE_LABELS = Object.freeze({
  weekly: 'Weekly',
  biweekly: 'Every two weeks',
  semi_monthly: 'Twice a month',
  monthly: 'Monthly',
});

export const PAY_SCHEDULE_PERIODS_PER_YEAR = Object.freeze({
  weekly: 52,
  biweekly: 26,
  semi_monthly: 24,
  monthly: 12,
});

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EIN_PATTERN = /^[0-9]{9}$/;
const STATE_PATTERN = /^[A-Z]{2}$/;
const POSTAL_CODE_PATTERN = /^[0-9]{5}(-[0-9]{4})?$/;

const COMPANY_COLUMNS =
  'company_id, tenant_id, legal_name, ein, address_line1, address_line2, city, state, postal_code, pay_schedule, created_at, updated_at';

export function normalizeEin(value) {
  return String(value ?? '').replace(/\D/g, '');
}

export function maskEin(einDigits) {
  const digits = normalizeEin(einDigits);
  return digits.length === 9 ? `***-**-${digits.slice(5)}` : '***-**-****';
}

function textField(value, { min = 1, max = 255 } = {}) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length >= min && trimmed.length <= max ? trimmed : null;
}

// Validate a company profile as submitted by the caller. The EIN is required
// only when there is no stored profile yet (einRequired); an existing
// business leaves it blank to keep the EIN already on file.
export function parseCompanyInput(input, { einRequired = true } = {}) {
  const errors = [];
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, reason: 'invalid_request', errors: ['company'] };
  }
  const legalName = textField(input.legalName);
  if (legalName === null) errors.push('legalName');
  const addressLine1 = textField(input.addressLine1);
  if (addressLine1 === null) errors.push('addressLine1');
  let addressLine2 = null;
  if (input.addressLine2 !== undefined && input.addressLine2 !== null && String(input.addressLine2).trim() !== '') {
    addressLine2 = textField(input.addressLine2);
    if (addressLine2 === null) errors.push('addressLine2');
  }
  const city = textField(input.city, { max: 100 });
  if (city === null) errors.push('city');
  const state = typeof input.state === 'string' ? input.state.trim().toUpperCase() : '';
  if (!STATE_PATTERN.test(state)) errors.push('state');
  const postalCode = typeof input.postalCode === 'string' ? input.postalCode.trim() : '';
  if (!POSTAL_CODE_PATTERN.test(postalCode)) errors.push('postalCode');
  if (!PAY_SCHEDULES.includes(input.paySchedule)) errors.push('paySchedule');
  let ein = null;
  const einDigits = normalizeEin(input.ein);
  if (einDigits === '') {
    if (einRequired) errors.push('ein');
  } else if (!EIN_PATTERN.test(einDigits)) {
    errors.push('ein');
  } else {
    ein = einDigits;
  }
  if (errors.length > 0) return { ok: false, reason: 'invalid_request', errors };
  return {
    ok: true,
    company: { legalName, ein, addressLine1, addressLine2, city, state, postalCode, paySchedule: input.paySchedule },
  };
}

// Validate the request envelope for the company endpoint: an action and an
// optional tenant selection. The tenant id only selects among the caller's
// own memberships; a tenant the caller is not a member of is 'not_found'.
export function parseCompanyRequest(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, reason: 'invalid_request' };
  }
  if (body.action !== 'read' && body.action !== 'write') {
    return { ok: false, reason: 'invalid_request' };
  }
  if (body.tenantId !== undefined && body.tenantId !== null && (typeof body.tenantId !== 'string' || !UUID_PATTERN.test(body.tenantId))) {
    return { ok: false, reason: 'invalid_request' };
  }
  return { ok: true, tenantId: body.tenantId ?? null, action: body.action };
}

// The only shape a company profile ever leaves the server in. The full EIN
// is never included: callers see the mask and the last four digits only.
export function toCompanyResponse(row) {
  if (!row) return null;
  const einDigits = normalizeEin(row.ein);
  return {
    tenantId: row.tenant_id,
    legalName: row.legal_name,
    einMasked: maskEin(einDigits),
    einLast4: einDigits.slice(5),
    address: {
      line1: row.address_line1,
      line2: row.address_line2,
      city: row.city,
      state: row.state,
      postalCode: row.postal_code,
    },
    paySchedule: row.pay_schedule,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// One tenant's company row, through the RLS-bound query. The RLS identity is
// set by the caller (auth composition) before this runs, so a business only
// ever sees its own row.
export async function loadCompanyByTenant(query, tenantId) {
  const result = await query(
    `SELECT ${COMPANY_COLUMNS} FROM payrollcheck.payroll_companies WHERE tenant_id = $1 LIMIT 1`,
    [tenantId],
  );
  return result.rows[0] ?? null;
}

export function createCompanyLoader({ query } = {}) {
  if (typeof query !== 'function') throw new TypeError('createCompanyLoader requires a query function');

  async function loadMemberships(subjectId) {
    const result = await query(
      'SELECT subject_id, tenant_id, role, active FROM payrollcheck.memberships WHERE subject_id = $1 AND active = true LIMIT 50',
      [subjectId],
    );
    return result.rows.map((row) => ({ tenantId: row.tenant_id, role: row.role }));
  }

  // Memberships first, then one company row per membership, in order. No
  // Promise.all over tenant loads: the plan requires sequential loads inside
  // one request-scoped transaction at READ COMMITTED.
  async function loadCompanyProfile({ subjectId } = {}) {
    const memberships = await loadMemberships(subjectId);
    const companiesByTenant = {};
    for (const membership of memberships) {
      const company = await loadCompanyByTenant(query, membership.tenantId);
      if (company) companiesByTenant[membership.tenantId] = company;
    }
    return { memberships, companiesByTenant };
  }

  // One row per tenant: insert, or update the existing row for the tenant.
  // The caller always passes a full nine-digit EIN (for an update that keeps
  // the stored EIN, the handler fills it in from the existing row first).
  async function saveCompany(tenantId, company) {
    const result = await query(
      `INSERT INTO payrollcheck.payroll_companies (tenant_id, legal_name, ein, address_line1, address_line2, city, state, postal_code, pay_schedule) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) ON CONFLICT (tenant_id) DO UPDATE SET legal_name = EXCLUDED.legal_name, ein = EXCLUDED.ein, address_line1 = EXCLUDED.address_line1, address_line2 = EXCLUDED.address_line2, city = EXCLUDED.city, state = EXCLUDED.state, postal_code = EXCLUDED.postal_code, pay_schedule = EXCLUDED.pay_schedule, updated_at = now() RETURNING ${COMPANY_COLUMNS}`,
      [tenantId, company.legalName, company.ein, company.addressLine1, company.addressLine2, company.city, company.state, company.postalCode, company.paySchedule],
    );
    return result.rows[0] ?? null;
  }

  return { loadCompanyProfile, saveCompany };
}
