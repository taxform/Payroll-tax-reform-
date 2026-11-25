# PayrollCheck 360: integrated payroll app — integration plan

Status: Slice 1 in progress (branch `payrollcheck-360-app-shell-slice-1`).
Base: `main` at `d67d757`. Date: 2026-11-25.

Goal: a signed-in business runs payroll, gets the compliance check, and files,
all on payrolltaxreform.com/payrollcheck — a real web app: log in, nothing to
download. Price: $299/year, filing fees included.

Honest-claims boundary (non-negotiable, applies to every slice): PayrollCheck 360
is an independent review of the customer's payroll software's own records. It
checks 941s/940, W-2s/W-3 and deposit dates against the filing rules. It is NOT
proof from IRS records. There is no TDS/IVES access and no direct IRS channel,
and none is claimed anywhere in code, copy, or PR descriptions.

## 1. Decision: rebuild as Netlify functions + Supabase tables under the existing tenancy

The standalone payroll software is rebuilt inside this repo, module by module,
as Netlify functions (`netlify/functions/payrollcheck-*.mts`) backed by Supabase
tables in the `payrollcheck` schema, under the existing login / MFA / tenancy
(`src/payrollcheck/`, `netlify/lib/payrollcheck-auth.mjs`). No new data store, no
new filing channel, no IRS access is invented.

Evidence for the decision (read from the repo at `d67d757`):

- The 360 login / MFA / tenancy is done and live: `public/payrollcheck/login.html`
  posts to `/payrollcheck/api/login`, `/mfa/verify`, `/mfa/enroll`; sessions live in
  `payrollcheck.sessions` via `src/payrollcheck/payrollcheck-server-session.mjs`;
  memberships / tenants / grants are resolved in
  `src/payrollcheck/payrollcheck-tenancy.mjs` (`isActiveMember`, `recordAccessAudit`);
  every read goes through the least-privilege `payrollcheck_app` connection with RLS
  enforced (`src/payrollcheck/payrollcheck-rls-identity.mjs`, `setRlsIdentity` in the
  step-7 order, `docs/sql/payrollcheck-rls-policies.sql`).
- The authenticated-endpoint pattern already exists and is tested:
  `netlify/functions/payrollcheck-report.mts` (POST, session cookie + `X-CSRF-Token`)
  calls `getAuthComposition().readReport(...)` in
  `src/payrollcheck/payrollcheck-auth-composition.mjs`; denials are generic
  (`invalid_session` 401, `csrf_failed` 403, `not_found` 404, `unavailable` 503) and
  every decision writes one audit row. About 50 `tests/payrollcheck-*.test.mjs` files
  pin this behaviour (`npm test` runs `node --test tests/payrollcheck-*.test.mjs`).
- There is no payroll code in this repo to embed: a repo-wide search for
  `taxbandit` / `pay run` / `payrun` finds only blog and tool-page mentions. The
  standalone app's company / employee / pay-run / tax-center / filing data lives in
  that app's own server storage, not in Supabase. Its verified pieces that must be
  ported, not re-derived, are the withholding math (verified against IRS Pub. 15-T,
  e.g. $2,000 biweekly, single = $156.15) and the TaxBandits sandbox filing
  (a 941 for Q4 at $462.15 was verified in the sandbox; sandbox only).
- Pricing wording is already fixed in the repo: `public/index.html` says
  "One flat $299 a year, filing fees included." and
  `tests/payrollcheck-homepage-focus.test.mjs` asserts that exact string.

Rejected alternatives:

- Embed / iframe the standalone app: payroll data would stay outside Supabase
  tenancy and RLS, the 360 session / MFA would not cover it, and TaxBandits
  credentials (client id, secret, user token) would stay in a separate server
  store. The cross-tenant guarantee ("no business can read another's data") could
  not be made or tested in this repo.
- Link out to the standalone app: same data problem, and it breaks the product
  promise — run payroll, check, and file in one place, behind one login.

## 2. Architecture (target)

```
public/payrollcheck/app.html  ->  POST /payrollcheck/api/dashboard
  (session cookie + X-CSRF-Token, same as the report endpoint)
netlify/functions/payrollcheck-dashboard.mts  ->  getAuthComposition().getDashboard(...)
src/payrollcheck/payrollcheck-auth-composition.mjs  (session load, CSRF, RLS identity,
  tenancy resolution — the same preamble as readReport; no caller-supplied tenant)
src/payrollcheck/payrollcheck-dashboard.mjs        (pure: module catalogue, tenant
  scoping, summary shape — unit-tested without a database)
src/payrollcheck/payrollcheck-dashboard-access.mjs (access decision, mirroring
  payrollcheck-report-access.mjs: rate limit, server-side verified user,
  Auth-UUID to subject mapping, AAL2, membership check, one audit row)
Supabase payrollcheck schema: tenants, memberships, reports (exist) +
  payroll_companies, payroll_employees, payroll_pay_runs, payroll_pay_run_lines,
  payroll_filings (added by later slices, one migration each, RLS enabled,
  app_* policies, deny by default — see docs/sql/ convention)
```

Rules every slice follows: the tenant id always comes from the verified session's
memberships, never from the request body (a body tenant id is only a selection
among the caller's own memberships, and a non-member selection is `not_found`);
all dashboard / payroll reads run inside one request-scoped transaction at
READ COMMITTED, sequentially, through the RLS-bound query; no `Promise.all` over
tenant loads; every access decision writes one audit row; error bodies stay
generic; no new Netlify environment variable in Slice 1 (TaxBandits stays
sandbox-only and is not wired until its slice).

## 3. Slices, in order (each one PR, each shippable on its own)

### Slice 1 — App shell (this PR)
Done when: a signed-in (MFA, AAL2) business opens `/payrollcheck/app`, sees its business tenant (type and id — the display name arrives with the company profile in Slice 2), its membership role, its compliance-check report count, and
navigation to Company, Employees, Pay runs, Tax center, Filing and Compliance
check; payroll modules are shown as coming in their slice (no fake data, no
fake counts); an unauthenticated or non-member request gets 401 / 404 and no
data; a request for another tenant's dashboard gets `not_found` and no data;
`npm test` passes. No new Supabase tables: the shell reads only the existing
`tenants`, `memberships` and `reports` tables through RLS, so no migration is
needed in this slice (the first payroll migration lands in Slice 2).

### Slice 2 — Company profile
Done when: a business can save and read its own company profile (legal name,
EIN — stored, never displayed in full — address, pay schedule) in
`payrollcheck.payroll_companies`, RLS-scoped to its tenant, one row per tenant;
the dashboard shows the company as set up; cross-tenant read/write is denied
and audited. Includes the `docs/sql/` migration, validated on a disposable
Postgres first, plus tests. Migration only, no TaxBandits.

### Slice 3 — Employees
Done when: a business can create, list and update its own employees in
`payrollcheck.payroll_employees` (W-4 filing status, allowances / extra
withholding, pay rate, pay type), RLS-scoped to its tenant; employee SSNs are
stored encrypted at rest per the existing secret handling and never returned in
full. Includes migration + tests. No pay math yet.

### Slice 4 — Pay runs (preview + create + finalize)
Done when: a business can preview, create, list, get, delete and finalize pay
runs (`payroll_pay_runs`, `payroll_pay_run_lines`), with the ported withholding
math verified against IRS Pub. 15-T — the existing test vector ($2,000
biweekly, single = $156.15) plus the standalone app's other verified vectors
must pass in this repo before the slice ships. Finalize is irreversible and
writes the lines the compliance check reads. Includes migration + tests.

### Slice 5 — Tax center (941 / 940)
Done when: the tax center aggregates finalized pay runs into 941 (quarterly)
and 940 (annual) views per tenant, with deposit-date tracking; the numbers
reconcile to the pay-run lines (a reconciliation test pins this). The 360
compliance check reads these aggregates — it is still an independent review of
the customer's own records, not proof from IRS records. Includes tests; no new
filing channel.

### Slice 6 — Filing (TaxBandits sandbox, then production-gated)
Done when: the filing queue, submit-filing and refresh-status operations run
behind the same tenancy and RLS, against the TaxBandits sandbox first, with the
sandbox 941 for Q4 at $462.15 re-verified from this repo; production filing is
a separate, explicitly approved step and is not enabled by this slice. TaxBandits
credentials stay server-side only (client id, secret, user token), never in the
browser. Includes migration + tests.

### Slice 7 — Compliance check over payroll data
Done when: the 360 check runs over the business's own finalized pay runs and
filings (941s/940, W-2s/W-3, deposit dates) and reports mismatches, reusing the
existing report pipeline (`readReport`, audit, RLS). Copy keeps the boundary:
"independent review of your payroll software's own records — not proof from
IRS records." Includes tests.

## 4. Non-goals

No TDS/IVES access, no direct IRS channel, no IRS verification claim, no new
auth system, no change to the login / MFA flow, no Netlify environment variable
in Slice 1, no touch to the prod or dev databases (read-only checks only).
