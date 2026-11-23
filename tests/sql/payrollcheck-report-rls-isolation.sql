-- Disposable PostgreSQL test. No real customers or Supabase Auth identities.
--
-- FIX (Nov 23, 2026) — replaces the transaction-local identity handoff.
-- The previous version set the test identity with
--   SELECT set_config('payrollcheck.test_auth_uid','<uid>',true);
--   SET LOCAL ROLE payrollcheck_rls_fixture;
-- and the postgres-rls CI step "Test business and firm tenant isolation and
-- grant revocation" failed on commit cb7e9a3 (run 43811914129) while every
-- earlier step in the same workflow passed.
--
-- Static analysis found the test data, foreign keys, CHECK constraints, UUIDs
-- and the RLS policy logic all internally consistent, and hand-simulation of
-- all six checks shows the expected results under PostgreSQL 16 semantics.
-- The failure is therefore in the execution mechanism, and the single point of
-- fragility is the identity handoff: a transaction-local setting
-- (set_config ..., true) read back inside RLS policy evaluation after a
-- SET LOCAL ROLE. This version removes that fragility:
--   * identity is set with session-level SET (not transaction-local
--     set_config), which cannot be lost by transaction/role transitions;
--   * the role is switched with session-level SET ROLE (not SET LOCAL ROLE);
--   * a guard before every assertion verifies the identity setting is exactly
--     what the check expects, and a RAISE NOTICE prints the report IDs the
--     fixture role can actually see — so if a check still fails, the CI log
--     shows precisely what was visible instead of a bare assertion message.
-- Test data, inserts, updates and all six assertions are UNCHANGED.
-- The fixture policies (tests/sql/payrollcheck-report-rls-fixture.sql) and the
-- deny-by-default schema need NO change.
--
-- VERIFICATION STATUS: UNVERIFIED. This file was authored by static analysis
-- only and has NOT been executed against PostgreSQL here. Apply it by copying
-- it over tests/sql/payrollcheck-report-rls-isolation.sql on branch
-- feature/payrollcheck-free-audit, push, and watch the postgres-rls workflow.
-- Do not claim the CI failure is fixed until that workflow run is green.
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
-- Identity is set session-level (SET, not set_config(...,true)) so it cannot
-- be lost across the role switch below.
SET payrollcheck.test_auth_uid = '11111111-1111-4111-8111-111111111111';
SET ROLE payrollcheck_rls_fixture;
DO $$ BEGIN
 IF current_setting('payrollcheck.test_auth_uid',true) IS DISTINCT FROM '11111111-1111-4111-8111-111111111111' THEN
  RAISE EXCEPTION 'test identity not set for owner A: expected 11111111-1111-4111-8111-111111111111, got %', current_setting('payrollcheck.test_auth_uid',true);
 END IF;
 RAISE NOTICE 'owner A sees reports: %', (SELECT coalesce(array_agg(report_id ORDER BY report_id)::text,'<none>') FROM payrollcheck.reports);
END $$;
DO $$ BEGIN
 IF (SELECT array_agg(report_id ORDER BY report_id) FROM payrollcheck.reports) IS DISTINCT FROM ARRAY['50000000-0000-4000-8000-000000000001'::uuid] THEN RAISE EXCEPTION 'owner A exact report isolation failed'; END IF;
END $$;
RESET ROLE;
SET payrollcheck.test_auth_uid = '22222222-2222-4222-8222-222222222222';
SET ROLE payrollcheck_rls_fixture;
DO $$ BEGIN
 IF current_setting('payrollcheck.test_auth_uid',true) IS DISTINCT FROM '22222222-2222-4222-8222-222222222222' THEN
  RAISE EXCEPTION 'test identity not set for owner B: expected 22222222-2222-4222-8222-222222222222, got %', current_setting('payrollcheck.test_auth_uid',true);
 END IF;
 RAISE NOTICE 'inactive owner B sees reports: %', (SELECT coalesce(array_agg(report_id ORDER BY report_id)::text,'<none>') FROM payrollcheck.reports);
END $$;
DO $$ BEGIN
 IF (SELECT count(*) FROM payrollcheck.reports)<>0 THEN RAISE EXCEPTION 'inactive owner isolation failed'; END IF;
END $$;
RESET ROLE;
SET payrollcheck.test_auth_uid = '33333333-3333-4333-8333-333333333333';
SET ROLE payrollcheck_rls_fixture;
DO $$ BEGIN
 IF current_setting('payrollcheck.test_auth_uid',true) IS DISTINCT FROM '33333333-3333-4333-8333-333333333333' THEN
  RAISE EXCEPTION 'test identity not set for reviewer X: expected 33333333-3333-4333-8333-333333333333, got %', current_setting('payrollcheck.test_auth_uid',true);
 END IF;
 RAISE NOTICE 'reviewer X sees reports: %', (SELECT coalesce(array_agg(report_id ORDER BY report_id)::text,'<none>') FROM payrollcheck.reports);
END $$;
DO $$ BEGIN
 IF (SELECT array_agg(report_id ORDER BY report_id) FROM payrollcheck.reports) IS DISTINCT FROM ARRAY['50000000-0000-4000-8000-000000000001'::uuid] THEN RAISE EXCEPTION 'firm exact client report isolation failed'; END IF;
END $$;
RESET ROLE;
SET payrollcheck.test_auth_uid = '44444444-4444-4444-8444-444444444444';
SET ROLE payrollcheck_rls_fixture;
DO $$ BEGIN
 IF current_setting('payrollcheck.test_auth_uid',true) IS DISTINCT FROM '44444444-4444-4444-8444-444444444444' THEN
  RAISE EXCEPTION 'test identity not set for reviewer Y: expected 44444444-4444-4444-8444-444444444444, got %', current_setting('payrollcheck.test_auth_uid',true);
 END IF;
 RAISE NOTICE 'other firm reviewer Y sees reports: %', (SELECT coalesce(array_agg(report_id ORDER BY report_id)::text,'<none>') FROM payrollcheck.reports);
END $$;
DO $$ BEGIN
 IF (SELECT count(*) FROM payrollcheck.reports)<>0 THEN RAISE EXCEPTION 'other firm isolation failed'; END IF;
END $$;
RESET ROLE;
UPDATE payrollcheck.client_grants SET status='revoked',revoked_by_subject='ownerA',revoked_at=now()
 WHERE grant_id='60000000-0000-4000-8000-000000000001';
SET payrollcheck.test_auth_uid = '33333333-3333-4333-8333-333333333333';
SET ROLE payrollcheck_rls_fixture;
DO $$ BEGIN
 IF current_setting('payrollcheck.test_auth_uid',true) IS DISTINCT FROM '33333333-3333-4333-8333-333333333333' THEN
  RAISE EXCEPTION 'test identity not set for reviewer X after revocation: expected 33333333-3333-4333-8333-333333333333, got %', current_setting('payrollcheck.test_auth_uid',true);
 END IF;
 RAISE NOTICE 'reviewer X after revocation sees reports: %', (SELECT coalesce(array_agg(report_id ORDER BY report_id)::text,'<none>') FROM payrollcheck.reports);
END $$;
DO $$ BEGIN
 IF (SELECT count(*) FROM payrollcheck.reports)<>0 THEN RAISE EXCEPTION 'revocation isolation failed'; END IF;
END $$;
RESET ROLE;
-- A grant for reviewing findings alone must not authorize reading reports.
UPDATE payrollcheck.client_grants SET status='active',revoked_by_subject=NULL,revoked_at=NULL,scopes=ARRAY['review_finding']
 WHERE grant_id='60000000-0000-4000-8000-000000000001';
SET payrollcheck.test_auth_uid = '33333333-3333-4333-8333-333333333333';
SET ROLE payrollcheck_rls_fixture;
DO $$ BEGIN
 IF current_setting('payrollcheck.test_auth_uid',true) IS DISTINCT FROM '33333333-3333-4333-8333-333333333333' THEN
  RAISE EXCEPTION 'test identity not set for reviewer X (review-only scope): expected 33333333-3333-4333-8333-333333333333, got %', current_setting('payrollcheck.test_auth_uid',true);
 END IF;
 RAISE NOTICE 'reviewer X with review-only scope sees reports: %', (SELECT coalesce(array_agg(report_id ORDER BY report_id)::text,'<none>') FROM payrollcheck.reports);
END $$;
DO $$ BEGIN
 IF EXISTS (SELECT 1 FROM payrollcheck.reports) THEN RAISE EXCEPTION 'review-only scope incorrectly authorized report'; END IF;
END $$;
RESET ROLE;
RESET payrollcheck.test_auth_uid;
ROLLBACK;
