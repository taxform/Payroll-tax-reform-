// Slice 6 — TaxBandits sandbox filing (docs/payrollcheck-360-integration-plan.md).
//
// The 360 app files Form 941/940/W-2 through the TaxBandits SANDBOX API only.
// Production filing is a separate, explicitly approved step and is NOT enabled
// by this slice: every request this module builds goes to the test system
// (testapi.taxbandits.com) and the client refuses any other host.
//
// Credentials stay server-side only (client id, secret, user token). This module
// never reads them: the server composition injects a getAccessToken function and
// this module never logs a token, a credential or a signing PIN. The 8879-EMP
// PIN is sent in the sandbox request and is never stored in the filing queue.
//
// Filing is included in the $299/year plan (docs/payrollcheck-360-integration-plan.md
// Slice 6): there is no per-form fee, so no fee is charged or sent to the provider.
//
// The Nov 25 standalone-app test filing was accepted by the sandbox but returned
// validation errors for the business fields the app did not collect (email, phone,
// address line 1, city, zip, business type, signing authority). validateFilingCompany
// below requires every one of those fields before a filing can be submitted, and
// buildTaxBandits941Payload includes them in the request.
import { BUSINESS_TYPES, loadCompanyByTenant, normalizeEin } from './payrollcheck-company.mjs';
import { createTaxCenterLoader } from './payrollcheck-tax-center.mjs';

export const TAX_BANDITS_SANDBOX_BASE_URL = 'https://testapi.taxbandits.com';
export const TAX_BANDITS_SANDBOX_API_BASE_URL = `${TAX_BANDITS_SANDBOX_BASE_URL}/v1`;
export const TAX_BANDITS_SANDBOX_HOST = 'testapi.taxbandits.com';
export const FILING_ENVIRONMENT = 'sandbox';
export const FILING_SANDBOX_NOTICE = 'TEST system only, nothing reaches the IRS.';
export const FILING_FEE_NOTE = 'Filing is included in the $299/year plan. There is no per-form fee.';
export const FILING_FORMS = ['941', '940', 'W-2'];
export const FILING_STATUSES = ['queued', 'submitted', 'accepted', 'rejected', 'failed'];
export const FILING_ACTIONS = ['queue', 'submit-filing', 'refresh-status'];
// TaxBandits rejects this test EIN (it is on the provider's blocked fake-EIN list).
export const TAX_BANDITS_BLOCKED_EINS = ['123456789'];

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PIN_PATTERN = /^\d{5}$/;

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

export function roundCents(value) {
  return Math.round(Number(value) * 100) / 100;
}

// Parse a filing request the way parseTaxCenterRequest parses a tax-center request.
// submit-filing needs the form, tax year, quarter (941 only) and the 8879-EMP PIN;
// refresh-status needs the filing id; queue needs nothing else.
export function parseFilingRequest(input = {}) {
  const errors = [];
  const tenantId = typeof input.tenantId === 'string' ? input.tenantId.trim() : '';
  if (!tenantId) errors.push('tenantId');
  const action = typeof input.action === 'string' ? input.action.trim() : '';
  if (!FILING_ACTIONS.includes(action)) errors.push('action');
  const form = typeof input.form === 'string' ? input.form.trim() : '';
  const taxYear = Number(input.taxYear);
  const quarter = input.quarter === undefined || input.quarter === null ? null : Number(input.quarter);
  let pin = null;
  let filingId = null;
  if (action === 'submit-filing') {
    if (!FILING_FORMS.includes(form)) errors.push('form');
    if (!Number.isInteger(taxYear) || taxYear < 2000 || taxYear > 2100) errors.push('taxYear');
    if (form === '941') {
      if (!Number.isInteger(quarter) || quarter < 1 || quarter > 4) errors.push('quarter');
    } else if (quarter !== null) {
      errors.push('quarter');
    }
    pin = typeof input.pin === 'string' ? input.pin.trim() : '';
    if (!PIN_PATTERN.test(pin)) errors.push('pin');
  }
  if (action === 'refresh-status') {
    filingId = typeof input.filingId === 'string' ? input.filingId.trim() : '';
    if (!filingId) errors.push('filingId');
  }
  if (errors.length > 0) return { ok: false, errors };
  return {
    ok: true,
    tenantId,
    action,
    form: form || null,
    taxYear: Number.isInteger(taxYear) ? taxYear : null,
    quarter,
    pin,
    filingId,
  };
}

// The company fields a filing needs. The company profile keeps these optional
// (a profile can be saved before filing), but a filing cannot be submitted
// without all of them — that is the Nov 25 sandbox validation failure.
export function validateFilingCompany(company = {}) {
  const errors = [];
  if (!isNonEmptyString(company.legalName)) errors.push('legalName');
  let ein = null;
  try {
    ein = normalizeEin(company.ein);
  } catch {
    ein = null;
  }
  if (!ein) {
    errors.push('ein');
  } else if (TAX_BANDITS_BLOCKED_EINS.includes(ein.replace(/\D/g, ''))) {
    errors.push('ein');
  }
  if (!isNonEmptyString(company.addressLine1)) errors.push('addressLine1');
  if (!isNonEmptyString(company.city)) errors.push('city');
  if (!isNonEmptyString(company.state)) errors.push('state');
  if (!isNonEmptyString(company.postalCode)) errors.push('postalCode');
  if (!isNonEmptyString(company.contactEmail) || !EMAIL_PATTERN.test(company.contactEmail.trim())) {
    errors.push('contactEmail');
  }
  const phoneDigits = typeof company.contactPhone === 'string' ? company.contactPhone.replace(/\D/g, '') : '';
  if (phoneDigits.length < 7 || phoneDigits.length > 15) errors.push('contactPhone');
  if (!isNonEmptyString(company.businessType) || !BUSINESS_TYPES.includes(company.businessType)) {
    errors.push('businessType');
  }
  if (!isNonEmptyString(company.signingAuthority) || company.signingAuthority.trim().length > 120) {
    errors.push('signingAuthority');
  }
  if (errors.length > 0) return { ok: false, errors };
  return {
    ok: true,
    company: {
      legalName: company.legalName.trim(),
      ein: ein.slice(0, 2) + '-' + ein.slice(2),
      addressLine1: company.addressLine1.trim(),
      addressLine2: isNonEmptyString(company.addressLine2) ? company.addressLine2.trim() : null,
      city: company.city.trim(),
      state: company.state.trim().toUpperCase(),
      postalCode: company.postalCode.trim(),
      contactEmail: company.contactEmail.trim(),
      contactPhone: phoneDigits,
      businessType: company.businessType,
      signingAuthority: company.signingAuthority.trim(),
    },
  };
}

// The tax-center summary totals are the employee side only (see
// src/payrollcheck/payrollcheck-tax-center.mjs: a pay-run line carries the
// employee's Social Security and Medicare). A 941 total also carries the
// employer's matching FICA, so the sandbox 941 total doubles the employee FICA:
// federalWithholding + 2 x (socialSecurity + medicare + additionalMedicare).
// Known-good run ($2,000 biweekly): gross 2000, federal 156.15, SS 124,
// Medicare 29, so the tax-center totalTax is 309.15 and the sandbox 941 total
// is 462.15.
export function computeSandbox941Totals(totals = {}) {
  const errors = [];
  const fields = ['wages', 'federalWithholding', 'socialSecurity', 'medicare', 'additionalMedicare'];
  for (const field of fields) {
    if (!isFiniteNumber(totals[field])) errors.push(field);
  }
  if (errors.length > 0) return { ok: false, errors };
  const federalWithholding = roundCents(totals.federalWithholding);
  const socialSecurity = roundCents(totals.socialSecurity);
  const medicare = roundCents(totals.medicare);
  const additionalMedicare = roundCents(totals.additionalMedicare);
  const employeeFica = roundCents(socialSecurity + medicare + additionalMedicare);
  return {
    ok: true,
    wages: roundCents(totals.wages),
    federalWithholding,
    employeeSocialSecurity: socialSecurity,
    employerSocialSecurity: socialSecurity,
    employeeMedicare: medicare,
    employerMedicare: medicare,
    employeeAdditionalMedicare: additionalMedicare,
    employerAdditionalMedicare: additionalMedicare,
    employeeFica,
    employerFica: employeeFica,
    taxCenterTotalTax: roundCents(federalWithholding + employeeFica),
    totalTax: roundCents(federalWithholding + 2 * employeeFica),
  };
}

// Build the sandbox 941 request. The PIN is part of the request only: it is
// never copied into the stored filing queue item (see buildFilingQueueItem).
export function buildTaxBandits941Payload({ company, totals, taxYear, quarter, pin } = {}) {
  const validatedCompany = validateFilingCompany(company);
  if (!validatedCompany.ok) return { ok: false, errors: validatedCompany.errors };
  const computed = computeSandbox941Totals(totals);
  if (!computed.ok) return { ok: false, errors: computed.errors };
  if (!Number.isInteger(taxYear) || taxYear < 2000 || taxYear > 2100) return { ok: false, errors: ['taxYear'] };
  if (!Number.isInteger(quarter) || quarter < 1 || quarter > 4) return { ok: false, errors: ['quarter'] };
  if (typeof pin !== 'string' || !PIN_PATTERN.test(pin.trim())) return { ok: false, errors: ['pin'] };
  const business = validatedCompany.company;
  return {
    ok: true,
    payload: {
      environment: FILING_ENVIRONMENT,
      form: '941',
      taxYear,
      quarter,
      business: {
        legalName: business.legalName,
        ein: business.ein,
        addressLine1: business.addressLine1,
        addressLine2: business.addressLine2,
        city: business.city,
        state: business.state,
        postalCode: business.postalCode,
        contactEmail: business.contactEmail,
        contactPhone: business.contactPhone,
        businessType: business.businessType,
        signingAuthority: business.signingAuthority,
      },
      totals: {
        wages: computed.wages,
        federalWithholding: computed.federalWithholding,
        employeeSocialSecurity: computed.employeeSocialSecurity,
        employerSocialSecurity: computed.employerSocialSecurity,
        employeeMedicare: computed.employeeMedicare,
        employerMedicare: computed.employerMedicare,
        employeeAdditionalMedicare: computed.employeeAdditionalMedicare,
        employerAdditionalMedicare: computed.employerAdditionalMedicare,
        totalTax: computed.totalTax,
      },
      signature: { method: '8879-EMP', pin: pin.trim() },
    },
  };
}

// The stored queue record. It carries the totals and the sandbox submission id,
// never the PIN and never a credential.
export function buildFilingQueueItem({ tenantId, form, taxYear, quarter, totalTax, filingId, now } = {}) {
  const errors = [];
  if (!isNonEmptyString(tenantId)) errors.push('tenantId');
  if (!FILING_FORMS.includes(form)) errors.push('form');
  if (!Number.isInteger(taxYear) || taxYear < 2000 || taxYear > 2100) errors.push('taxYear');
  if (form === '941' && (!Number.isInteger(quarter) || quarter < 1 || quarter > 4)) errors.push('quarter');
  if (!isFiniteNumber(totalTax)) errors.push('totalTax');
  if (errors.length > 0) return { ok: false, errors };
  return {
    ok: true,
    filing: {
      filingId: isNonEmptyString(filingId) ? filingId : null,
      tenantId: tenantId.trim(),
      form,
      taxYear,
      quarter: form === '941' ? quarter : null,
      status: 'queued',
      sandboxSubmissionId: null,
      totalTax: roundCents(totalTax),
      environment: FILING_ENVIRONMENT,
      feeNote: FILING_FEE_NOTE,
      createdAt: now ?? new Date().toISOString(),
    },
  };
}

// Sandbox endpoint paths, one per form. The client only ever calls these
// against TAX_BANDITS_SANDBOX_BASE_URL.
export function filingCreatePath(form) {
  if (!FILING_FORMS.includes(form)) throw new TypeError(`unsupported filing form: ${form}`);
  const resource = form === 'W-2' ? 'FormW2' : `Form${form}`;
  return `/v1/${resource}/Create`;
}

export function filingStatusPath(form, submissionId) {
  if (!FILING_FORMS.includes(form)) throw new TypeError(`unsupported filing form: ${form}`);
  if (!isNonEmptyString(submissionId)) throw new TypeError('submissionId is required');
  const resource = form === 'W-2' ? 'FormW2' : `Form${form}`;
  return `/v1/${resource}/Status?SubmissionId=${encodeURIComponent(submissionId)}`;
}

// Map a provider status string onto a filing status. Unknown provider statuses
// return ok: false so the queue keeps its current status instead of guessing.
export function parseTaxBanditsStatus(body = {}) {
  const raw = typeof body?.Status === 'string' ? body.Status.trim().toLowerCase() : '';
  if (!raw) return { ok: false, error: 'status' };
  if (raw.includes('accept')) return { ok: true, status: 'accepted' };
  if (raw.includes('reject')) return { ok: true, status: 'rejected' };
  if (raw.includes('transmit') || raw.includes('submit')) return { ok: true, status: 'submitted' };
  return { ok: false, error: 'status' };
}

function assertSandboxUrl(url) {
  const parsed = new URL(url);
  if (parsed.hostname !== TAX_BANDITS_SANDBOX_HOST) {
    throw new Error('TaxBandits filing is sandbox only');
  }
  return parsed;
}

// Sandbox client. fetch and getAccessToken are injected: the server composition
// supplies the global fetch and the server-side access token, and this module
// never sees a client id, secret or user token. The PIN travels in the request
// body only and is never logged or stored by this client.
export function createTaxBanditsSandboxClient({ fetch: fetchImpl, getAccessToken, baseUrl = TAX_BANDITS_SANDBOX_BASE_URL } = {}) {
  if (typeof fetchImpl !== 'function') throw new TypeError('fetch is required');
  if (typeof getAccessToken !== 'function') throw new TypeError('getAccessToken is required');
  assertSandboxUrl(baseUrl);
  const base = baseUrl.replace(/\/$/, '');
  async function submitFiling({ form, payload } = {}) {
    const token = await getAccessToken();
    if (!isNonEmptyString(token)) return { ok: false, error: 'taxbandits_not_configured' };
    const response = await fetchImpl(`${base}${filingCreatePath(form)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(payload),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) return { ok: false, error: 'taxbandits_rejected', statusCode: response.status };
    const submissionId = typeof body?.SubmissionId === 'string' ? body.SubmissionId : null;
    return { ok: true, submissionId, status: 'submitted', providerStatus: typeof body?.Status === 'string' ? body.Status : null };
  }
  async function refreshFilingStatus({ form, submissionId } = {}) {
    const token = await getAccessToken();
    if (!isNonEmptyString(token)) return { ok: false, error: 'taxbandits_not_configured' };
    const response = await fetchImpl(`${base}${filingStatusPath(form, submissionId)}`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) return { ok: false, error: 'taxbandits_rejected', statusCode: response.status };
    const parsed = parseTaxBanditsStatus(body);
    if (!parsed.ok) return { ok: false, error: 'status' };
    return { ok: true, status: parsed.status, providerStatus: typeof body?.Status === 'string' ? body.Status : null };
  }
  return { submitFiling, refreshFilingStatus };

// Filing loader (Slice 6). Runs inside the composition's transaction, behind the same tenancy and RLS as the rest of the app: every query is scoped to the tenant the access handler selected, and the tax_filings table enforces tenant_id = current_tenant_id() at the database level.
  // The TaxBandits sandbox client is injected as a factory. Without one, submit-filing only queues the filing and refresh-status reports the service unavailable, so the queue works before any token exchange is wired and no filing leaves the repo without a configured sandbox client.
  const FILING_ROW_COLUMNS = [
      'filing_id',
      'tenant_id',
      'form_text',
      'tax_year',
      'quarter',
      'status',
      'sandbox_submission_id',
      'total_tax',
      'submitted_at',
      'created_at',
      'updated_at',
    ].join(', ');

  function toFilingResponse(row) {
      if (!row || typeof row !== 'object') return null;
      return {
            filingId: row.filing_id ?? null,
            tenantId: row.tenant_id ?? null,
            form: row.form_text ?? null,
            taxYear: row.tax_year ?? null,
            quarter: row.quarter ?? null,
            status: row.status ?? null,
            sandboxSubmissionId: row.sandbox_submission_id ?? null,
            totalTax:
                    row.total_tax === null || row.total_tax === undefined
              ? null
                    : Number(row.total_tax),
            environment: FILING_ENVIRONMENT,
            feeNote: FILING_FEE_NOTE,
            submittedAt: row.submitted_at ?? null,
            createdAt: row.created_at ?? null,
            updatedAt: row.updated_at ?? null,
      };
  }

  function toFilingCompanyInput(row) {
      return {
            legalName: row.legal_name,
            ein: row.ein,
            addressLine1: row.address_line1,
            addressLine2: row.address_line2,
            city: row.city,
            state: row.state,
            postalCode: row.postal_code,
            paySchedule: row.pay_schedule,
            contactEmail: row.contact_email,
            contactPhone: row.contact_phone,
            businessType: row.business_type,
            signingAuthority: row.signing_authority,
      };
  }

  export function createFilingLoader({ query, createTaxBanditsClient = null, loadTaxCenter = null } = {}) {
      if (typeof query !== 'function') throw new TypeError('query_required');
      if (createTaxBanditsClient !== null && typeof createTaxBanditsClient !== 'function') {
            throw new TypeError('create_tax_bandits_client_required');
      }
      if (loadTaxCenter !== null && typeof loadTaxCenter !== 'function') {
            throw new TypeError('load_tax_center_required');
      }
      const loadTaxCenterForTenant =
            loadTaxCenter ?? createTaxCenterLoader({ query }).loadTaxCenter;

      function taxBanditsClient() {
            if (typeof createTaxBanditsClient !== 'function') return null;
            const client = createTaxBanditsClient();
            if (!client || typeof client !== 'object') return null;
            return client;
      }

      async function loadCompanyForFiling(tenantId) {
            const row = await loadCompanyByTenant(query, tenantId);
            if (!row) return { ok: false, status: 400, error: 'invalid_company' };
            const validated = validateFilingCompany(toFilingCompanyInput(row));
            if (!validated.ok) return { ok: false, status: 400, error: 'invalid_company' };
            return { ok: true, company: validated.company };
      }

      async function loadQuarterTotals({ tenantId, taxYear, quarter }) {
            const summary = await loadTaxCenterForTenant(tenantId);
            const period = Array.isArray(summary?.form941)
              ? summary.form941.find((entry) => entry.year === taxYear && entry.quarter === quarter)
                    : undefined;
            if (!period) return { ok: false, status: 404, error: 'filing_period_not_found' };
            const computed = computeSandbox941Totals(period);
            if (!computed.ok) return { ok: false, status: 404, error: 'filing_period_not_found' };
            return { ok: true, totals: period, totalTax: computed.totalTax };
      }

      async function queueFilings(tenantId) {
            const result = await query(
                    `SELECT ${FILING_ROW_COLUMNS} FROM payrollcheck.tax_filings WHERE tenant_id = $1 ORDER BY created_at DESC, filing_id DESC`,
                    [tenantId],
                  );
            return { ok: true, filings: result.rows.map((row) => toFilingResponse(row)) };
      }

      async function submitFiling({ tenantId, form, taxYear, quarter, pin }) {
            if (form !== '941') return { ok: false, status: 400, error: 'unsupported_form' };
            const company = await loadCompanyForFiling(tenantId);
            if (!company.ok) return company;
            const quarterTotals = await loadQuarterTotals({ tenantId, taxYear, quarter });
            if (!quarterTotals.ok) return quarterTotals;
            const built = buildTaxBandits941Payload({
                    company: company.company,
                    totals: quarterTotals.totals,
                    taxYear,
                    quarter,
                    pin,
            });
            if (!built.ok) return { ok: false, status: 400, error: 'invalid_request' };
            const inserted = await query(
                    `INSERT INTO payrollcheck.tax_filings (tenant_id, form_text, tax_year, quarter, status, sandbox_submission_id, total_tax) VALUES ($1, $2, $3, $4, 'queued', NULL, $5) RETURNING ${FILING_ROW_COLUMNS}`,
                    [tenantId, form, taxYear, quarter, quarterTotals.totalTax],
                  );
            const filingRow = inserted.rows[0];
            if (!filingRow) return { ok: false, status: 503, error: 'unavailable' };
            const client = taxBanditsClient();
            if (!client) return { ok: true, filing: toFilingResponse(filingRow) };
            let submitted;
            try {
                    submitted = await client.submitFiling({ form, payload: built.payload });
            } catch {
                    submitted = { ok: false, error: 'taxbandits_rejected' };
            }
            if (!submitted || submitted.ok !== true) {
                    await query(
                              `UPDATE payrollcheck.tax_filings SET status = 'failed', updated_at = NOW() WHERE filing_id = $1 AND tenant_id = $2`,
                              [filingRow.filing_id, tenantId],
                            );
                    return { ok: false, status: 503, error: submitted?.error ?? 'taxbandits_rejected' };
            }
            const updated = await query(
                    `UPDATE payrollcheck.tax_filings SET status = 'submitted', sandbox_submission_id = $1, submitted_at = NOW(), updated_at = NOW() WHERE filing_id = $2 AND tenant_id = $3 RETURNING ${FILING_ROW_COLUMNS}`,
                    [submitted.submissionId, filingRow.filing_id, tenantId],
                  );
            return { ok: true, filing: toFilingResponse(updated.rows[0] ?? filingRow) };
      }

      async function refreshFilingStatus({ tenantId, filingId }) {
            const found = await query(
                    `SELECT ${FILING_ROW_COLUMNS} FROM payrollcheck.tax_filings WHERE tenant_id = $1 AND filing_id = $2`,
                    [tenantId, filingId],
                  );
            const row = found.rows[0];
            if (!row) return { ok: false, status: 404, error: 'filing_not_found' };
            if (!row.sandbox_submission_id) return { ok: false, status: 409, error: 'filing_not_submitted' };
            const client = taxBanditsClient();
            if (!client) return { ok: false, status: 503, error: 'unavailable' };
            let refreshed;
            try {
                    refreshed = await client.refreshFilingStatus({ form: row.form_text, submissionId: row.sandbox_submission_id });
            } catch {
                    refreshed = { ok: false, error: 'taxbandits_rejected' };
            }
            if (!refreshed || refreshed.ok !== true) {
                    return { ok: false, status: 503, error: refreshed?.error ?? 'taxbandits_rejected' };
            }
            if (refreshed.status !== 'submitted' && refreshed.status !== 'accepted' && refreshed.status !== 'rejected') {
                    return { ok: true, filing: toFilingResponse(row) };
            }
            const updated = await query(
                    `UPDATE payrollcheck.tax_filings SET status = $1, updated_at = NOW() WHERE filing_id = $2 AND tenant_id = $3 RETURNING ${FILING_ROW_COLUMNS}`,
                    [refreshed.status, filingId, tenantId],
                  );
            return { ok: true, filing: toFilingResponse(updated.rows[0] ?? row) };
      }

      async function loadFiling({ tenantId, action, form, taxYear, quarter, pin, filingId }) {
            if (action === 'queue') return queueFilings(tenantId);
            if (action === 'submit-filing') return submitFiling({ tenantId, form, taxYear, quarter, pin });
            if (action === 'refresh-status') return refreshFilingStatus({ tenantId, filingId });
            return { ok: false, status: 400, error: 'invalid_request' };
      }

      return Object.freeze({ loadFiling });
  }
  
}
