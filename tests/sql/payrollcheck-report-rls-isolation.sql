-- Disposable PostgreSQL test. No real customers or Supabase Auth identities.
BEGIN;
INSERT INTO payrollcheck.tenants(tenant_id,tenant_type) VALUES
 ('eaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','business'),
 ('ebbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','business'),
 ('eccccccc-cccc-4ccc-8ccc-cccccccccccc','accounting_firm'),
 ('eddddddd-dddd-4ddd-8ddd-dddddddddddd','accounting_firm');
INSERT INTO payrollcheck.memberships(membership_id,tenant_id,subject_id,role,active,auth_user_id) VALUES
 ('10000000-0000-4000-8000-000000000001','eaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','ownerA','business_owner',true,'11111111-1111-4111-8111-111111111111'),
 ('10000000-0000-4000-8000-000000000002','ebbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','ownerB','business_owner',false,'22222222-2222-4222-8222-222222222222'),
 ('10000000-0000-4000-8000-000000000003','eccccccc-cccc-4ccc-8ccc-cccccccccccc','reviewerX','accounting_reviewer',true,'33333333-3333-4333-8333-333333333333'),
 ('10000000-0000-4000-8000-000000000004','eddddddd-dddd-4ddd-8ddd-dddddddddddd','reviewerY','accounting_reviewer',true,'44444444-4444-4444-8444-444444444444');
INSERT INTO payrollcheck.reports(report_id,business_tenant_id,client_id,status) VALUES
 ('50000000-0000-4000-8000-000000000001','eaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','clientA','preview_only'),
 ('50000000-0000-4000-8000-000000000002','ebbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','clientB','preview_only');
INSERT INTO payrollcheck.client_grants(grant_id,firm_tenant_id,business_tenant_id,scopes,status,requested_by_subject,approved_by_subject,approved_at) VALUES
 ('60000000-0000-4000-8000-000000000001','eccccccc-cccc-4ccc-8ccc-cccccccccccc','eaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',ARRAY['view_report'],'active','reviewerX','ownerA',now());
-- Trusted test harness injects identity; never expose this setting to an SQL-capable client.
SELECT set_config('payrollcheck.test_auth_uid','11111111-1111-4111-8111-111111111111',true);
SET LOCAL ROLE payrollcheck_rls_fixture;
DO $$ BEGIN
 IF (SELECT array_agg(report_id ORDER BY report_id) FROM payrollcheck.reports) IS DISTINCT FROM ARRAY['50000000-0000-4000-8000-000000000001'::uuid] THEN RAISE EXCEPTION 'owner A exact report isolation failed'; END IF;
END $$;
RESET ROLE;
SELECT set_config('payrollcheck.test_auth_uid','22222222-2222-4222-8222-222222222222',true);
SET LOCAL ROLE payrollcheck_rls_fixture;
DO $$ BEGIN
 IF (SELECT count(*) FROM payrollcheck.reports)<>0 THEN RAISE EXCEPTION 'inactive owner isolation failed'; END IF;
END $$;
RESET ROLE;
SELECT set_config('payrollcheck.test_auth_uid','33333333-3333-4333-8333-333333333333',true);
SET LOCAL ROLE payrollcheck_rls_fixture;
DO $$ BEGIN
 IF (SELECT array_agg(report_id ORDER BY report_id) FROM payrollcheck.reports) IS DISTINCT FROM ARRAY['50000000-0000-4000-8000-000000000001'::uuid] THEN RAISE EXCEPTION 'firm exact client report isolation failed'; END IF;
END $$;
RESET ROLE;
SELECT set_config('payrollcheck.test_auth_uid','44444444-4444-4444-8444-444444444444',true);
SET LOCAL ROLE payrollcheck_rls_fixture;
DO $$ BEGIN
 IF (SELECT count(*) FROM payrollcheck.reports)<>0 THEN RAISE EXCEPTION 'other firm isolation failed'; END IF;
END $$;
RESET ROLE;
UPDATE payrollcheck.client_grants SET status='revoked',revoked_by_subject='ownerA',revoked_at=now()
 WHERE grant_id='60000000-0000-4000-8000-000000000001';
SELECT set_config('payrollcheck.test_auth_uid','33333333-3333-4333-8333-333333333333',true);
SET LOCAL ROLE payrollcheck_rls_fixture;
DO $$ BEGIN
 IF (SELECT count(*) FROM payrollcheck.reports)<>0 THEN RAISE EXCEPTION 'revocation isolation failed'; END IF;
END $$;
RESET ROLE;
-- A grant for reviewing findings alone must not authorize reading reports.
UPDATE payrollcheck.client_grants SET status='active',revoked_by_subject=NULL,revoked_at=NULL,scopes=ARRAY['review_finding']
 WHERE grant_id='60000000-0000-4000-8000-000000000001';
SELECT set_config('payrollcheck.test_auth_uid','33333333-3333-4333-8333-333333333333',true);
SET LOCAL ROLE payrollcheck_rls_fixture;
DO $ BEGIN
 IF EXISTS (SELECT 1 FROM payrollcheck.reports) THEN RAISE EXCEPTION 'review-only scope incorrectly authorized report'; END IF;
END $;
RESET ROLE;
ROLLBACK;
