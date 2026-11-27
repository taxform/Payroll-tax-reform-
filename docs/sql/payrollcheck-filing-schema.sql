-- Slice 6 — TaxBandits sandbox filing (docs/payrollcheck-360-integration-plan.md).
-- Adds the company contact fields the Nov 25 sandbox 941 test showed were
-- missing, a tenant-scoped tax_filings queue, and widens the access_audit
-- action list to include the filing actions.
-- Sandbox only: filing goes to the TaxBandits test system. Nothing in this
-- migration enables production filing, and no credential is stored here.
-- Apply after docs/sql/payrollcheck-tax-center-schema.sql. Do not apply to
-- production until the slice is merged and the production rollout is approved
-- separately.

alter table payrollcheck.payroll_companies
  add column if not exists contact_email text,
  add column if not exists contact_phone text,
  add column if not exists business_type text,
  add column if not exists signing_authority text;

create table if not exists payrollcheck.tax_filings (
  filing_id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references payrollcheck.tenants (tenant_id),
  form text not null check (form in ('941', '940', 'W-2')),
  tax_year integer not null check (tax_year between 2000 and 2100),
  quarter integer check (quarter between 1 and 4),
  status text not null default 'queued' check (status in ('queued', 'submitted', 'accepted', 'rejected', 'failed')),
  sandbox_submission_id text,
  total_tax numeric(12, 2) not null default 0,
  submitted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tax_filings_quarter_required_for_941 check (form <> '941' or quarter is not null),
  constraint tax_filings_quarter_only_for_941 check (form = '941' or quarter is null)
);

create index if not exists tax_filings_tenant_created_idx
  on payrollcheck.tax_filings (tenant_id, created_at desc);

alter table payrollcheck.tax_filings enable row level security;

revoke all on payrollcheck.tax_filings from public;

grant select, insert, update on payrollcheck.tax_filings to app_payrollcheck_rw;

create policy app_payrollcheck_rw_tax_filings on payrollcheck.tax_filings
  for all to app_payrollcheck_rw
  using (tenant_id = payrollcheck.current_tenant_id())
  with check (tenant_id = payrollcheck.current_tenant_id());

alter table payrollcheck.access_audit
  drop constraint if exists access_audit_action_check,
  add constraint access_audit_action_check check (action in (
    'view_report',
    'review_finding',
    'dashboard_read',
    'company_read',
    'company_write',
    'employee_read',
    'employee_write',
    'pay_run_read',
    'pay_run_write',
    'tax_center_read',
    'filing_read',
    'filing_write'
  ));
