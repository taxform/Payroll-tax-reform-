// PayrollCheck 360 app shell (Slice 1): dashboard data for a signed-in business.
//
// This module is pure except for createDashboardLoader, which runs its queries
// through the caller-supplied RLS-bound query inside one request-scoped
// transaction (see payrollcheck-auth-composition.mjs, getDashboard). The tenant
// id always comes from the verified session's memberships, never from the
// request body: a body tenant id is only a selection among the caller's own
// memberships, and a selection the caller is not a member of is `not_found`.
// The dashboard reads only the existing payrollcheck.tenants, memberships and
// reports tables, so Slice 1 needs no SQL migration. The business display name
// arrives with the company profile in Slice 2 (payroll_companies.legal_name);
// until then the dashboard shows the tenant type and id, which is all the
// existing schema holds.
//
// Honest-claims boundary: the compliance check is an independent review of the
// customer's payroll software's own records (941s/940, W-2s/W-3, deposit dates
// against the filing rules). It is NOT proof from IRS records. There is no
// TDS/IVES access and no direct IRS channel, and none is claimed here.

import { loadCompanyByTenant, maskEin } from './payrollcheck-company.mjs';

export const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// The modules of the integrated app, in the order a business works through
// them. Only the compliance check reads data that already exists (the 360's own
// reports, via the existing report endpoint); the payroll modules are built in
// later slices and are shown as coming soon, with no fake data and no fake
// counts, until their slice lands.
export const PAYROLLCHECK_APP_MODULES = Object.freeze([
  Object.freeze({
    id: 'company',
    label: 'Company',
    href: '#company',
    status: 'available',
    slice: 2,
    note: 'Set up your company profile — legal name, EIN, address and pay schedule.',
  }),
  Object.freeze({
    id: 'employees',
    label: 'Employees',
    href: '#employees',
    status: 'coming_soon',
    slice: 3,
    note: 'Employees arrive in Slice 3.',
  }),
  Object.freeze({
    id: 'pay-runs',
    label: 'Pay runs',
    href: '#pay-runs',
    status: 'coming_soon',
    slice: 4,
    note: 'Pay runs arrive in Slice 4.',
  }),
  Object.freeze({
    id: 'tax-center',
    label: 'Tax center',
    href: '#tax-center',
    status: 'coming_soon',
    slice: 5,
    note: 'The 941 / 940 tax center arrives in Slice 5.',
  }),
  Object.freeze({
    id: 'filing',
    label: 'Filing',
    href: '#filing',
    status: 'coming_soon',
    slice: 6,
    note: 'Filing arrives in Slice 6 (TaxBandits sandbox first).',
  }),
  Object.freeze({
    id: 'compliance-check',
    label: 'Compliance check',
    href: '#compliance',
    status: 'available',
    slice: 1,
    note: 'Independent review of your payroll software\'s own records — not proof from IRS records.',
  }),
]);

export function isUuid(value) {
  return typeof value === 'string' && UUID_PATTERN.test(value);
}

// Validate the dashboard request body. The body is optional and may only carry
// an optional tenantId selecting among the caller's own memberships. Anything
// else is an invalid request; the tenant id is never trusted on its own.
export function parseDashboardRequest(body) {
  if (body === undefined || body === null) return { ok: true, tenantId: null };
  if (typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, error: 'invalid_request' };
  }
  const { tenantId } = body;
  if (tenantId === undefined || tenantId === null) return { ok: true, tenantId: null };
  if (!isUuid(tenantId)) return { ok: false, error: 'invalid_request' };
  return { ok: true, tenantId };
}

// Resolve which tenant the dashboard shows, from the caller's memberships.
// memberships: [{ tenantId, tenantType, role }] as loaded for the verified
// subject. A requested tenant the caller is not a member of is `not_found`
// (generic: it must not reveal whether that tenant exists). With no request,
// the first membership (ordered by tenant id) is selected.
export function resolveDashboardTenant({ memberships, requestedTenantId }) {
  const members = Array.isArray(memberships) ? memberships : [];
  if (members.length === 0) {
    return { ok: false, status: 404, error: 'not_found' };
  }
  if (requestedTenantId === null || requestedTenantId === undefined) {
    return { ok: true, tenant: members[0], memberships: members };
  }
  const tenant = members.find((m) => m.tenantId === requestedTenantId);
  if (!tenant) return { ok: false, status: 404, error: 'not_found' };
  return { ok: true, tenant, memberships: members };
}

// Build the dashboard summary the app page renders. reportCountsByTenant maps
// tenant id to the number of compliance-check reports for that tenant (0 when
// absent). Counts are the caller's own tenants only; no other tenant's data is
// ever passed in, so none can leak out.
export function buildDashboardSummary({ memberships, reportCountsByTenant, companiesByTenant, selectedTenantId }) {
  const members = Array.isArray(memberships) ? memberships : [];
  const counts =
    reportCountsByTenant && typeof reportCountsByTenant === 'object'
      ? reportCountsByTenant
      : {};
  const tenants = members.map((m) => ({
    tenantId: m.tenantId,
    tenantType: m.tenantType ?? null,
    role: m.role,
    reportCount: Number.isFinite(counts[m.tenantId]) ? counts[m.tenantId] : 0,
  }));
  const selected =
    tenants.find((t) => t.tenantId === selectedTenantId) ?? tenants[0] ?? null;
  const companies =
    companiesByTenant && typeof companiesByTenant === 'object' ? companiesByTenant : {};
  const companyRow = selected ? companies[selected.tenantId] ?? null : null;
  const company = companyRow
    ? {
        isSetUp: true,
        legalName: companyRow.legal_name,
        einMasked: maskEin(companyRow.ein),
        paySchedule: companyRow.pay_schedule,
      }
    : { isSetUp: false };
  return {
    selectedTenant: selected,
    company,
    tenants,
    totals: {
      tenants: tenants.length,
      reports: tenants.reduce((sum, t) => sum + t.reportCount, 0),
    },
    modules: PAYROLLCHECK_APP_MODULES,
  };
}

// Load the dashboard rows through the RLS-bound query, sequentially, inside the
// caller's transaction (READ COMMITTED, one request scope — never Promise.all
// over tenant loads, per the repo's transaction rules). Column names match the
// live queries in postgres-report-loader.mjs and payrollcheck-tenancy.mjs.
export function createDashboardLoader({ query }) {
  if (typeof query !== 'function') throw new Error('query is required');

  async function loadMemberships(subjectId) {
    const { rows } = await query(
      'SELECT subject_id, tenant_id, role, active FROM payrollcheck.memberships ' +
        'WHERE subject_id = $1 AND active = true LIMIT 501',
      [subjectId],
    );
    return rows.map((row) => ({
      tenantId: row.tenant_id,
      role: row.role,
    }));
  }

  async function loadTenantType(tenantId) {
    const { rows } = await query(
      'SELECT tenant_id, tenant_type, created_at FROM payrollcheck.tenants ' +
        'WHERE tenant_id = $1::uuid',
      [tenantId],
    );
    if (rows.length === 0) throw new Error('tenant lookup failed');
    return rows[0].tenant_type;
  }

  async function loadReportCount(tenantId) {
    const { rows } = await query(
      'SELECT COUNT(*) AS count FROM payrollcheck.reports ' +
        'WHERE business_tenant_id = $1::uuid',
      [tenantId],
    );
    return Number(rows[0]?.count ?? 0);
  }

  async function loadDashboard({ subjectId }) {
    const memberships = await loadMemberships(subjectId);
    const reportCountsByTenant = {};
    for (const membership of memberships) {
      membership.tenantType = await loadTenantType(membership.tenantId);
      reportCountsByTenant[membership.tenantId] = await loadReportCount(
        membership.tenantId,
      );
    }
    const companiesByTenant = {};
  for (const membership of memberships) {
    // The company profile is optional: a tenant with no saved profile has
    // no row, and the profile table may not exist yet where the Slice 2
    // migration has not been applied (prod, 2026-11-25: the dashboard
    // returned 503 unavailable for every signed-in user because this
    // lookup threw "relation payrollcheck.payroll_companies does not
    // exist"). A failed company lookup must not take the whole dashboard
    // down; treat it as "no company profile for this tenant".
    let company = null;
    try {
      company = await loadCompanyByTenant(query, membership.tenantId);
    } catch {
      company = null;
    }
    if (company) companiesByTenant[membership.tenantId] = company;
  }
  return { memberships, reportCountsByTenant, companiesByTenant };
  }

  return { loadMemberships, loadTenantType, loadReportCount, loadDashboard };
}
