-- ISOLATED TEST ONLY. Never deploy this file to Supabase or production.
-- Demonstrates report RLS for a database role whose identity is supplied by a
-- trusted transaction controller. PostgreSQL custom settings are spoofable by
-- any role with SQL execution: this is NOT a safe direct-client auth design.
BEGIN;
ALTER TABLE payrollcheck.memberships ADD COLUMN auth_user_id uuid;
CREATE ROLE payrollcheck_rls_fixture NOLOGIN NOBYPASSRLS;
GRANT USAGE ON SCHEMA payrollcheck TO payrollcheck_rls_fixture;
GRANT SELECT ON payrollcheck.tenants,payrollcheck.memberships,
 payrollcheck.client_grants,payrollcheck.reports TO payrollcheck_rls_fixture;
CREATE POLICY fixture_tenants_read ON payrollcheck.tenants
 FOR SELECT TO payrollcheck_rls_fixture USING (true);
CREATE POLICY fixture_memberships_read ON payrollcheck.memberships
 FOR SELECT TO payrollcheck_rls_fixture USING (
  auth_user_id = NULLIF(current_setting('payrollcheck.test_auth_uid',true),'')::uuid
 );
CREATE POLICY fixture_grants_read ON payrollcheck.client_grants
 FOR SELECT TO payrollcheck_rls_fixture USING (true);
CREATE POLICY fixture_reports_read ON payrollcheck.reports
 FOR SELECT TO payrollcheck_rls_fixture USING (
  EXISTS (
   SELECT 1 FROM payrollcheck.memberships m
   JOIN payrollcheck.tenants t ON t.tenant_id=m.tenant_id
   WHERE m.auth_user_id=NULLIF(current_setting('payrollcheck.test_auth_uid',true),'')::uuid
    AND m.active=true AND (
     (m.role='business_owner' AND t.tenant_type='business'
       AND m.tenant_id=business_tenant_id)
     OR
     (m.role IN ('accounting_admin','accounting_reviewer')
       AND t.tenant_type='accounting_firm'
       AND EXISTS (
        SELECT 1 FROM payrollcheck.client_grants g
        WHERE g.firm_tenant_id=m.tenant_id
         AND g.business_tenant_id=business_tenant_id
         AND g.status='active' AND 'view_report'=ANY(g.scopes)
       ))
    )
  )
 );
COMMIT;
