-- PayrollCheck 360: UNDEPLOYED PostgreSQL schema proposal, not a runnable production migration.
-- No customer data should be loaded. All application access is denied by default.
-- Security review required before applying to any environment.
BEGIN;
CREATE SCHEMA IF NOT EXISTS payrollcheck;
CREATE TABLE payrollcheck.tenants (
  tenant_id uuid PRIMARY KEY,
  tenant_type text NOT NULL CHECK (tenant_type IN ('business','accounting_firm')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE payrollcheck.memberships (
  membership_id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES payrollcheck.tenants(tenant_id),
  subject_id text NOT NULL CHECK (length(subject_id) BETWEEN 1 AND 255),
  role text NOT NULL CHECK (role IN ('business_owner','accounting_admin','accounting_reviewer')),
  active boolean NOT NULL DEFAULT true,
  UNIQUE (tenant_id, subject_id)
);
CREATE TABLE payrollcheck.reports (
  report_id uuid PRIMARY KEY,
  business_tenant_id uuid NOT NULL REFERENCES payrollcheck.tenants(tenant_id),
  client_id text NOT NULL CHECK (length(client_id) BETWEEN 1 AND 64 AND client_id ~ '^[A-Za-z0-9_-]+,'pending_review','archived')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE payrollcheck.client_grants (
  grant_id uuid PRIMARY KEY,
  firm_tenant_id uuid NOT NULL REFERENCES payrollcheck.tenants(tenant_id),
  business_tenant_id uuid NOT NULL REFERENCES payrollcheck.tenants(tenant_id),
  scopes text[] NOT NULL CHECK (cardinality(scopes) BETWEEN 1 AND 2 AND scopes <@ ARRAY['view_report','review_finding']::text[] AND array_position(scopes,NULL) IS NULL AND (cardinality(scopes)=1 OR scopes[1]<>scopes[2])),
  status text NOT NULL CHECK (status IN ('pending','active','revoked')),
  requested_by_subject text NOT NULL CHECK (length(requested_by_subject) BETWEEN 1 AND 64 AND requested_by_subject ~ '^[A-Za-z0-9_-]+
  revoked_by_subject text,
  requested_at timestamptz NOT NULL DEFAULT now(),
  approved_at timestamptz,
  revoked_at timestamptz,
  CHECK (firm_tenant_id <> business_tenant_id),
  CHECK (
    (status='pending' AND approved_by_subject IS NULL AND revoked_by_subject IS NULL AND approved_at IS NULL AND revoked_at IS NULL)
    OR (status='active' AND approved_by_subject IS NOT NULL AND approved_at IS NOT NULL AND revoked_by_subject IS NULL AND revoked_at IS NULL)
    OR (status='revoked' AND revoked_by_subject IS NOT NULL AND revoked_at IS NOT NULL)
  )
);
-- At most one active grant per firm/business pair; pending and revoked history may coexist.
CREATE UNIQUE INDEX client_grants_one_active_per_pair ON payrollcheck.client_grants(firm_tenant_id,business_tenant_id) WHERE status='active';
CREATE TABLE payrollcheck.access_audit (
  event_id uuid PRIMARY KEY,
  request_id text NOT NULL,
  actor_subject_id text NOT NULL,
  report_id uuid,
  action text NOT NULL CHECK (action IN ('view_report','review_finding')),
  allowed boolean NOT NULL,
  reason text NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE payrollcheck.tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE payrollcheck.tenants FORCE ROW LEVEL SECURITY;
ALTER TABLE payrollcheck.memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE payrollcheck.memberships FORCE ROW LEVEL SECURITY;
ALTER TABLE payrollcheck.reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE payrollcheck.reports FORCE ROW LEVEL SECURITY;
ALTER TABLE payrollcheck.client_grants ENABLE ROW LEVEL SECURITY;
ALTER TABLE payrollcheck.client_grants FORCE ROW LEVEL SECURITY;
ALTER TABLE payrollcheck.access_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE payrollcheck.access_audit FORCE ROW LEVEL SECURITY;
-- Intentionally NO RLS policies. Non-bypass roles receive zero rows and cannot write.
-- IMPORTANT: table owners, superusers and BYPASSRLS roles require separate hardening.
-- Do not grant schema/table privileges to application roles before reviewed policies.
COMMIT;
),
  status text NOT NULL CHECK (status IN ('preview_only','pending_review','archived')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE payrollcheck.client_grants (
  grant_id uuid PRIMARY KEY,
  firm_tenant_id uuid NOT NULL REFERENCES payrollcheck.tenants(tenant_id),
  business_tenant_id uuid NOT NULL REFERENCES payrollcheck.tenants(tenant_id),
  status text NOT NULL CHECK (status IN ('pending','active','revoked')),
  approved_by_subject text,
  revoked_by_subject text,
  requested_at timestamptz NOT NULL DEFAULT now(),
  approved_at timestamptz,
  revoked_at timestamptz,
  CHECK (firm_tenant_id <> business_tenant_id),
  CHECK (
    (status='pending' AND approved_by_subject IS NULL AND revoked_by_subject IS NULL AND approved_at IS NULL AND revoked_at IS NULL)
    OR (status='active' AND approved_by_subject IS NOT NULL AND approved_at IS NOT NULL AND revoked_by_subject IS NULL AND revoked_at IS NULL)
    OR (status='revoked' AND revoked_by_subject IS NOT NULL AND revoked_at IS NOT NULL)
  )
);
CREATE TABLE payrollcheck.access_audit (
  event_id uuid PRIMARY KEY,
  request_id text NOT NULL,
  actor_subject_id text NOT NULL,
  report_id uuid,
  action text NOT NULL CHECK (action IN ('view_report','review_finding')),
  allowed boolean NOT NULL,
  reason text NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE payrollcheck.tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE payrollcheck.tenants FORCE ROW LEVEL SECURITY;
ALTER TABLE payrollcheck.memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE payrollcheck.memberships FORCE ROW LEVEL SECURITY;
ALTER TABLE payrollcheck.reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE payrollcheck.reports FORCE ROW LEVEL SECURITY;
ALTER TABLE payrollcheck.client_grants ENABLE ROW LEVEL SECURITY;
ALTER TABLE payrollcheck.client_grants FORCE ROW LEVEL SECURITY;
ALTER TABLE payrollcheck.access_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE payrollcheck.access_audit FORCE ROW LEVEL SECURITY;
-- Intentionally NO RLS policies. Non-bypass roles receive zero rows and cannot write.
-- IMPORTANT: table owners, superusers and BYPASSRLS roles require separate hardening.
-- Do not grant schema/table privileges to application roles before reviewed policies.
COMMIT;
),
  approved_by_subject text,
  revoked_by_subject text,
  requested_at timestamptz NOT NULL DEFAULT now(),
  approved_at timestamptz,
  revoked_at timestamptz,
  CHECK (firm_tenant_id <> business_tenant_id),
  CHECK (
    (status='pending' AND approved_by_subject IS NULL AND revoked_by_subject IS NULL AND approved_at IS NULL AND revoked_at IS NULL)
    OR (status='active' AND approved_by_subject IS NOT NULL AND approved_at IS NOT NULL AND revoked_by_subject IS NULL AND revoked_at IS NULL)
    OR (status='revoked' AND revoked_by_subject IS NOT NULL AND revoked_at IS NOT NULL)
  )
);
-- At most one active grant per firm/business pair; pending and revoked history may coexist.
CREATE UNIQUE INDEX client_grants_one_active_per_pair ON payrollcheck.client_grants(firm_tenant_id,business_tenant_id) WHERE status='active';
CREATE TABLE payrollcheck.access_audit (
  event_id uuid PRIMARY KEY,
  request_id text NOT NULL,
  actor_subject_id text NOT NULL,
  report_id uuid,
  action text NOT NULL CHECK (action IN ('view_report','review_finding')),
  allowed boolean NOT NULL,
  reason text NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE payrollcheck.tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE payrollcheck.tenants FORCE ROW LEVEL SECURITY;
ALTER TABLE payrollcheck.memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE payrollcheck.memberships FORCE ROW LEVEL SECURITY;
ALTER TABLE payrollcheck.reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE payrollcheck.reports FORCE ROW LEVEL SECURITY;
ALTER TABLE payrollcheck.client_grants ENABLE ROW LEVEL SECURITY;
ALTER TABLE payrollcheck.client_grants FORCE ROW LEVEL SECURITY;
ALTER TABLE payrollcheck.access_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE payrollcheck.access_audit FORCE ROW LEVEL SECURITY;
-- Intentionally NO RLS policies. Non-bypass roles receive zero rows and cannot write.
-- IMPORTANT: table owners, superusers and BYPASSRLS roles require separate hardening.
-- Do not grant schema/table privileges to application roles before reviewed policies.
COMMIT;
),
  status text NOT NULL CHECK (status IN ('preview_only','pending_review','archived')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE payrollcheck.client_grants (
  grant_id uuid PRIMARY KEY,
  firm_tenant_id uuid NOT NULL REFERENCES payrollcheck.tenants(tenant_id),
  business_tenant_id uuid NOT NULL REFERENCES payrollcheck.tenants(tenant_id),
  status text NOT NULL CHECK (status IN ('pending','active','revoked')),
  approved_by_subject text,
  revoked_by_subject text,
  requested_at timestamptz NOT NULL DEFAULT now(),
  approved_at timestamptz,
  revoked_at timestamptz,
  CHECK (firm_tenant_id <> business_tenant_id),
  CHECK (
    (status='pending' AND approved_by_subject IS NULL AND revoked_by_subject IS NULL AND approved_at IS NULL AND revoked_at IS NULL)
    OR (status='active' AND approved_by_subject IS NOT NULL AND approved_at IS NOT NULL AND revoked_by_subject IS NULL AND revoked_at IS NULL)
    OR (status='revoked' AND revoked_by_subject IS NOT NULL AND revoked_at IS NOT NULL)
  )
);
CREATE TABLE payrollcheck.access_audit (
  event_id uuid PRIMARY KEY,
  request_id text NOT NULL,
  actor_subject_id text NOT NULL,
  report_id uuid,
  action text NOT NULL CHECK (action IN ('view_report','review_finding')),
  allowed boolean NOT NULL,
  reason text NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE payrollcheck.tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE payrollcheck.tenants FORCE ROW LEVEL SECURITY;
ALTER TABLE payrollcheck.memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE payrollcheck.memberships FORCE ROW LEVEL SECURITY;
ALTER TABLE payrollcheck.reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE payrollcheck.reports FORCE ROW LEVEL SECURITY;
ALTER TABLE payrollcheck.client_grants ENABLE ROW LEVEL SECURITY;
ALTER TABLE payrollcheck.client_grants FORCE ROW LEVEL SECURITY;
ALTER TABLE payrollcheck.access_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE payrollcheck.access_audit FORCE ROW LEVEL SECURITY;
-- Intentionally NO RLS policies. Non-bypass roles receive zero rows and cannot write.
-- IMPORTANT: table owners, superusers and BYPASSRLS roles require separate hardening.
-- Do not grant schema/table privileges to application roles before reviewed policies.
COMMIT;
