-- RLS regression for the step-7 policies (M2 step 7).
-- Run only in a disposable PostgreSQL database, after applying in order:
--   psql -X -v ON_ERROR_STOP=1 -f docs/sql/payrollcheck-deny-by-default-schema.sql
--   psql -X -v ON_ERROR_STOP=1 -f docs/sql/payrollcheck-sessions-schema.sql
--   psql -X -v ON_ERROR_STOP=1 -f docs/sql/payrollcheck-rls-policies.sql
--   psql -X -v ON_ERROR_STOP=1 -f tests/sql/payrollcheck-rls-regression.sql
--
-- Supersedes tests/sql/payrollcheck-report-rls-fixture.sql +
-- tests/sql/payrollcheck-report-rls-isolation.sql (deleted by this step):
-- it covers the same six isolation scenarios against the REAL policies
-- (owner reads own report; inactive owner denied; firm reads via active
-- grant; other firm denied; revocation denies; review-only scope denies)
-- plus the write paths the fixture never tested: membership provisioning,
-- grant approve/revoke authorization, audit actor binding, sessions
-- isolation, cross-tenant writes, and deny-by-default with no identity.
--
-- Identity is set session-level (SET, not transaction-local set_config)
-- and the role is switched with session-level SET ROLE, with a guard
-- before every assertion — the pattern fix #1 proved in CI, after the
-- transaction-local handoff failed. At runtime the server instead uses
-- SET LOCAL inside a transaction (see payrollcheck-rls-identity.mjs);
-- the policies read the same three settings either way.
--
-- Seed data is synthetic (two businesses, two firms, five users, two
-- reports, four grants, three sessions). Any failure raises an
-- exception. Rolls back at the end so no rows remain.
BEGIN;

-- Structural guard: the eight tables have RLS enabled + forced, the 18
-- step-7/step-10 policies exist, and the app role exists without BYPASSRLS.
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace
    WHERE ns.nspname = 'payrollcheck' AND c.relkind = 'r'
    AND c.relname IN ('tenants','memberships','reports','client_grants','access_audit','sessions','auth_limits','payroll_companies')
    AND c.relrowsecurity AND c.relforcerowsecurity;
  IF n <> 8 THEN RAISE EXCEPTION 'expected 8 tables with RLS enabled+forced, got %', n; END IF;
  SELECT count(*) INTO n FROM pg_policies WHERE schemaname = 'payrollcheck' AND policyname LIKE 'app\_%';
  IF n <> 18 THEN RAISE EXCEPTION 'expected 18 app policies, got %', n; END IF;
IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'payrollcheck' AND policyname IN ('app_tenants_all', 'app_reports_all', 'app_client_grants_delete', 'app_memberships_read')) THEN
  RAISE EXCEPTION 'non-canonical app policies present (app_tenants_all, app_reports_all, app_client_grants_delete, app_memberships_read); drop them with docs/sql/payrollcheck-policy-reconciliation-migration.sql';
END IF;
IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'payrollcheck' AND table_name = 'memberships' AND column_name = 'membership_id') THEN
  RAISE EXCEPTION 'memberships.membership_id is missing; add it with docs/sql/payrollcheck-policy-reconciliation-migration.sql';
END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'payrollcheck_app' AND rolbypassrls = false) THEN
    RAISE EXCEPTION 'payrollcheck_app role missing or BYPASSRLS';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
    WHERE ns.nspname = 'payrollcheck' AND p.proname = 'is_business_owner_of'
    AND p.prosecdef = true) THEN
    RAISE EXCEPTION 'is_business_owner_of missing or not SECURITY DEFINER';
  END IF;
END $$;

-- The deny-by-default schema has no auth_user_id column; the
-- identity-link migration adds it in Supabase (with an FK to
-- auth.users, which does not exist in disposable Postgres). Same
-- approach as the old fixture: add the bare column for the test.
ALTER TABLE payrollcheck.memberships ADD COLUMN IF NOT EXISTS auth_user_id uuid;

INSERT INTO payrollcheck.tenants(tenant_id,tenant_type) VALUES
 ('eaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','business'),
 ('ebbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','business'),
 ('eccccccc-cccc-4ccc-8ccc-cccccccccccc','accounting_firm'),
 ('eddddddd-dddd-4ddd-8ddd-dddddddddddd','accounting_firm');
INSERT INTO payrollcheck.memberships(membership_id,tenant_id,subject_id,role,active,auth_user_id) VALUES
 ('10000000-0000-4000-8000-000000000001','eaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','ownerA','business_owner',true,'11111111-1111-4111-8111-111111111111'),
 ('10000000-0000-4000-8000-000000000002','ebbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','ownerB','business_owner',false,'22222222-2222-4222-8222-222222222222'),
 ('10000000-0000-4000-8000-000000000003','eaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','staffA','accounting_admin',true,'55555555-5555-4555-8555-555555555555'),
 ('10000000-0000-4000-8000-000000000004','eccccccc-cccc-4ccc-8ccc-cccccccccccc','reviewerX','accounting_reviewer',true,'33333333-3333-4333-8333-333333333333'),
 ('10000000-0000-4000-8000-000000000005','eddddddd-dddd-4ddd-8ddd-dddddddddddd','reviewerY','accounting_reviewer',true,'44444444-4444-4444-8444-444444444444');
INSERT INTO payrollcheck.reports(report_id,business_tenant_id,client_id,status) VALUES
 ('50000000-0000-4000-8000-000000000001','eaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','clientA','preview_only'),
 ('50000000-0000-4000-8000-000000000002','ebbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','clientB','preview_only');
INSERT INTO payrollcheck.client_grants(grant_id,firm_tenant_id,business_tenant_id,scopes,status,requested_by_subject,approved_by_subject,approved_at) VALUES
 ('60000000-0000-4000-8000-000000000001','eccccccc-cccc-4ccc-8ccc-cccccccccccc','eaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',ARRAY['view_report'],'active','reviewerX','ownerA',now()),
 ('60000000-0000-4000-8000-000000000002','eccccccc-cccc-4ccc-8ccc-cccccccccccc','ebbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',ARRAY['view_report'],'pending','reviewerX',NULL,NULL),
 ('60000000-0000-4000-8000-000000000003','eddddddd-dddd-4ddd-8ddd-dddddddddddd','eaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',ARRAY['view_report'],'pending','reviewerY',NULL,NULL),
 ('60000000-0000-4000-8000-000000000004','eccccccc-cccc-4ccc-8ccc-cccccccccccc','eaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',ARRAY['view_report'],'pending','reviewerX',NULL,NULL);
INSERT INTO payrollcheck.sessions(session_id,previous_session_id,grace_until,user_id,auth_user_id,aal2,created_at,rotated_at,last_seen_at,expires_at,revoked) VALUES
 ('sess-owner-a-000000000000000000001',NULL,NULL,'ownerA','11111111-1111-4111-8111-111111111111',true,'2026-01-01 00:00:00+00','2026-01-01 00:00:00+00','2026-01-01 00:00:00+00','2026-01-01 12:00:00+00',false),
 ('sess-owner-a-000000000000000000002','sess-owner-a-000000000000000000001','2026-01-01 00:01:00+00','ownerA','11111111-1111-4111-8111-111111111111',true,'2026-01-01 00:00:00+00','2026-01-01 00:00:00+00','2026-01-01 00:00:00+00','2026-01-01 12:00:00+00',false),
 ('sess-reviewer-x-000000000000000001',NULL,NULL,'reviewerX','33333333-3333-4333-8333-333333333333',true,'2026-01-01 00:00:00+00','2026-01-01 00:00:00+00','2026-01-01 00:00:00+00','2026-01-01 12:00:00+00',false);
INSERT INTO payrollcheck.access_audit(event_id,request_id,actor_subject_id,report_id,action,allowed,reason) VALUES
 ('70000000-0000-4000-8000-000000000001','req-owner-a','ownerA','50000000-0000-4000-8000-000000000001','view_report',true,'owner read'),
 ('70000000-0000-4000-8000-000000000002','req-reviewer-x','reviewerX','50000000-0000-4000-8000-000000000001','view_report',true,'firm read');

-- Check 1: no identity set — the app role sees nothing anywhere, and
-- writes are denied. (Deny by default.)
RESET payrollcheck.current_subject_id;
RESET payrollcheck.current_auth_user_id;
RESET payrollcheck.current_session_id;
SET ROLE payrollcheck_app;
DO $$ DECLARE n int; BEGIN
  SELECT count(*) INTO n FROM payrollcheck.tenants; IF n <> 0 THEN RAISE EXCEPTION 'no-identity tenants leaked % rows', n; END IF;
  SELECT count(*) INTO n FROM payrollcheck.memberships; IF n <> 0 THEN RAISE EXCEPTION 'no-identity memberships leaked % rows', n; END IF;
  SELECT count(*) INTO n FROM payrollcheck.reports; IF n <> 0 THEN RAISE EXCEPTION 'no-identity reports leaked % rows', n; END IF;
  SELECT count(*) INTO n FROM payrollcheck.client_grants; IF n <> 0 THEN RAISE EXCEPTION 'no-identity grants leaked % rows', n; END IF;
  SELECT count(*) INTO n FROM payrollcheck.access_audit; IF n <> 0 THEN RAISE EXCEPTION 'no-identity audit leaked % rows', n; END IF;
  SELECT count(*) INTO n FROM payrollcheck.sessions; IF n <> 0 THEN RAISE EXCEPTION 'no-identity sessions leaked % rows', n; END IF;
  BEGIN
    INSERT INTO payrollcheck.tenants(tenant_id,tenant_type) VALUES ('99999999-9999-4999-8999-999999999999','business');
    RAISE EXCEPTION 'no-identity tenant insert unexpectedly succeeded';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    INSERT INTO payrollcheck.sessions(session_id,user_id,auth_user_id,expires_at) VALUES ('sess-nobody-000000000000000000001','nobody','99999999-9999-4999-8999-999999999999','2027-01-01 12:00:00+00');
    RAISE EXCEPTION 'no-identity session insert unexpectedly succeeded';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
RESET ROLE;

-- Check 2: business owner A reads exactly their own report, tenant,
-- membership rows (owner + staff of tenant A — the owner branch of
-- the memberships SELECT policy), grants (business side), audit row,
-- and sessions.
SET payrollcheck.current_subject_id = 'ownerA';
SET payrollcheck.current_auth_user_id = '11111111-1111-4111-8111-111111111111';
SET ROLE payrollcheck_app;
DO $$ BEGIN
  IF current_setting('payrollcheck.current_subject_id', true) IS DISTINCT FROM 'ownerA' THEN RAISE EXCEPTION 'identity guard: ownerA subject'; END IF;
  RAISE NOTICE 'ownerA sees reports: %', (SELECT coalesce(array_agg(report_id ORDER BY report_id)::text, '<none>') FROM payrollcheck.reports);
  IF (SELECT array_agg(report_id ORDER BY report_id) FROM payrollcheck.reports) IS DISTINCT FROM ARRAY['50000000-0000-4000-8000-000000000001'::uuid] THEN RAISE EXCEPTION 'ownerA report isolation failed'; END IF;
  IF (SELECT array_agg(tenant_id ORDER BY tenant_id) FROM payrollcheck.tenants) IS DISTINCT FROM ARRAY['eaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid] THEN RAISE EXCEPTION 'ownerA tenant isolation failed'; END IF;
  IF (SELECT array_agg(subject_id ORDER BY subject_id) FROM payrollcheck.memberships) IS DISTINCT FROM ARRAY['ownerA','staffA'] THEN RAISE EXCEPTION 'ownerA membership isolation failed'; END IF;
  IF (SELECT count(*) FROM payrollcheck.client_grants) <> 3 THEN RAISE EXCEPTION 'ownerA grant visibility failed'; END IF;
  IF (SELECT count(*) FROM payrollcheck.access_audit) <> 1 THEN RAISE EXCEPTION 'ownerA audit isolation failed'; END IF;
  IF (SELECT count(*) FROM payrollcheck.sessions) <> 2 THEN RAISE EXCEPTION 'ownerA session isolation failed'; END IF;
END $$;
RESET ROLE;

-- Check 3: inactive owner B — deactivated membership authorizes
-- nothing. (Their own inactive row is still visible to them; visibility
-- grants nothing, every authorization path re-checks active.)
SET payrollcheck.current_subject_id = 'ownerB';
SET payrollcheck.current_auth_user_id = '22222222-2222-4222-8222-222222222222';
SET ROLE payrollcheck_app;
DO $$ BEGIN
  IF current_setting('payrollcheck.current_subject_id', true) IS DISTINCT FROM 'ownerB' THEN RAISE EXCEPTION 'identity guard: ownerB subject'; END IF;
  IF (SELECT count(*) FROM payrollcheck.reports) <> 0 THEN RAISE EXCEPTION 'inactive owner report isolation failed'; END IF;
  IF (SELECT count(*) FROM payrollcheck.tenants) <> 0 THEN RAISE EXCEPTION 'inactive owner tenant isolation failed'; END IF;
  IF (SELECT count(*) FROM payrollcheck.client_grants) <> 0 THEN RAISE EXCEPTION 'inactive owner grant isolation failed'; END IF;
  IF (SELECT count(*) FROM payrollcheck.sessions) <> 0 THEN RAISE EXCEPTION 'inactive owner session isolation failed'; END IF;
  IF (SELECT array_agg(subject_id) FROM payrollcheck.memberships) IS DISTINCT FROM ARRAY['ownerB'] THEN RAISE EXCEPTION 'inactive owner membership row unexpected'; END IF;
END $$;
RESET ROLE;

-- Check 4: business staff (accounting_admin of business A) — the
-- business report path is business_owner only per the spec, so staff
-- see the tenant and the grants but no reports.
SET payrollcheck.current_subject_id = 'staffA';
SET payrollcheck.current_auth_user_id = '55555555-5555-4555-8555-555555555555';
SET ROLE payrollcheck_app;
DO $$ BEGIN
  IF current_setting('payrollcheck.current_subject_id', true) IS DISTINCT FROM 'staffA' THEN RAISE EXCEPTION 'identity guard: staffA subject'; END IF;
  IF (SELECT count(*) FROM payrollcheck.reports) <> 0 THEN RAISE EXCEPTION 'business staff report isolation failed'; END IF;
  IF (SELECT array_agg(tenant_id) FROM payrollcheck.tenants) IS DISTINCT FROM ARRAY['eaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid] THEN RAISE EXCEPTION 'business staff tenant isolation failed'; END IF;
  IF (SELECT count(*) FROM payrollcheck.client_grants) <> 3 THEN RAISE EXCEPTION 'business staff grant visibility failed'; END IF;
END $$;
RESET ROLE;

-- Check 5: firm reviewer X reads business A's report via the active
-- view_report grant; the pending grant to B authorizes nothing.
SET payrollcheck.current_subject_id = 'reviewerX';
SET payrollcheck.current_auth_user_id = '33333333-3333-4333-8333-333333333333';
SET ROLE payrollcheck_app;
DO $$ BEGIN
  IF current_setting('payrollcheck.current_subject_id', true) IS DISTINCT FROM 'reviewerX' THEN RAISE EXCEPTION 'identity guard: reviewerX subject'; END IF;
  RAISE NOTICE 'reviewerX sees reports: %', (SELECT coalesce(array_agg(report_id ORDER BY report_id)::text, '<none>') FROM payrollcheck.reports);
  IF (SELECT array_agg(report_id ORDER BY report_id) FROM payrollcheck.reports) IS DISTINCT FROM ARRAY['50000000-0000-4000-8000-000000000001'::uuid] THEN RAISE EXCEPTION 'firm report isolation failed'; END IF;
  IF (SELECT array_agg(tenant_id ORDER BY tenant_id) FROM payrollcheck.tenants) IS DISTINCT FROM ARRAY['eccccccc-cccc-4ccc-8ccc-cccccccccccc'::uuid] THEN RAISE EXCEPTION 'firm tenant isolation failed'; END IF;
  IF (SELECT count(*) FROM payrollcheck.client_grants) <> 3 THEN RAISE EXCEPTION 'firm grant visibility failed'; END IF;
  IF (SELECT count(*) FROM payrollcheck.sessions) <> 1 THEN RAISE EXCEPTION 'firm session isolation failed'; END IF;
END $$;
RESET ROLE;

-- Check 6: other firm reviewer Y — no active grant to A, only a pending
-- one — sees no reports.
SET payrollcheck.current_subject_id = 'reviewerY';
SET payrollcheck.current_auth_user_id = '44444444-4444-4444-8444-444444444444';
SET ROLE payrollcheck_app;
DO $$ BEGIN
  IF current_setting('payrollcheck.current_subject_id', true) IS DISTINCT FROM 'reviewerY' THEN RAISE EXCEPTION 'identity guard: reviewerY subject'; END IF;
  IF (SELECT count(*) FROM payrollcheck.reports) <> 0 THEN RAISE EXCEPTION 'other firm isolation failed'; END IF;
  IF (SELECT count(*) FROM payrollcheck.client_grants) <> 1 THEN RAISE EXCEPTION 'other firm grant visibility failed'; END IF;
END $$;
RESET ROLE;

-- Check 7: revocation takes effect immediately; a review finding-only
-- grant authorizes no report reads; restoring the grant restores access.
-- Scopes are immutable on UPDATE (S6 trigger), so the review finding-only
-- case is exercised with a separate grant created with those scopes, and
-- the restore keeps grant ...0001's original scopes.
UPDATE payrollcheck.client_grants SET status='revoked',revoked_by_subject='ownerA',revoked_at=now()
 WHERE grant_id='60000000-0000-4000-8000-000000000001';
SET payrollcheck.current_subject_id = 'reviewerX';
SET payrollcheck.current_auth_user_id = '33333333-3333-4333-8333-333333333333';
SET ROLE payrollcheck_app;
DO $$ BEGIN
  IF (SELECT count(*) FROM payrollcheck.reports) <> 0 THEN RAISE EXCEPTION 'revocation isolation failed'; END IF;
END $$;
RESET ROLE;
INSERT INTO payrollcheck.client_grants(grant_id,firm_tenant_id,business_tenant_id,scopes,status,requested_by_subject,approved_by_subject,approved_at)
 VALUES ('60000000-0000-4000-8000-000000000099','eccccccc-cccc-4ccc-8ccc-cccccccccccc','eaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',ARRAY['review_finding'],'active','reviewerX','ownerA',now());
SET ROLE payrollcheck_app;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM payrollcheck.reports) THEN RAISE EXCEPTION 'review-only scope incorrectly authorized report'; END IF;
END $$;
RESET ROLE;
DELETE FROM payrollcheck.client_grants WHERE grant_id='60000000-0000-4000-8000-000000000099';
UPDATE payrollcheck.client_grants SET status='active',revoked_by_subject=NULL,revoked_at=NULL
 WHERE grant_id='60000000-0000-4000-8000-000000000001';
SET ROLE payrollcheck_app;
DO $$ BEGIN
  IF (SELECT count(*) FROM payrollcheck.reports) <> 1 THEN RAISE EXCEPTION 'restored grant did not restore access'; END IF;
END $$;
RESET ROLE;

-- Check 8: self-approval is denied — reviewer Y (who requested grant
-- Y→A) cannot approve it, even though they are a member of the firm.
-- Approve and revoke share one UPDATE policy (two permissive UPDATE
-- policies would be OR-combined by Postgres and let a requester
-- self-approve via the revoke USING + approve WITH CHECK). The row is
-- visible to the firm member via USING, but no valid transition exists
-- for a self-approval, so Postgres raises insufficient_privilege; the
-- grant stays pending.
SET payrollcheck.current_subject_id = 'reviewerY';
SET payrollcheck.current_auth_user_id = '44444444-4444-4444-8444-444444444444';
SET ROLE payrollcheck_app;
DO $$ BEGIN
  BEGIN
    UPDATE payrollcheck.client_grants SET status='active',approved_by_subject='reviewerY',approved_at=now()
     WHERE grant_id='60000000-0000-4000-8000-000000000003';
    RAISE EXCEPTION 'self-approve unexpectedly succeeded';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
RESET ROLE;
DO $$ DECLARE s text; BEGIN
  SELECT status INTO s FROM payrollcheck.client_grants WHERE grant_id='60000000-0000-4000-8000-000000000003';
  IF s <> 'pending' THEN RAISE EXCEPTION 'self-approve changed grant status to %', s; END IF;
END $$;

-- Check 9: business owner A approves grant Y→A; reviewer Y can then
-- read business A's report.
SET payrollcheck.current_subject_id = 'ownerA';
SET payrollcheck.current_auth_user_id = '11111111-1111-4111-8111-111111111111';
SET ROLE payrollcheck_app;
DO $$ DECLARE n int; BEGIN
  UPDATE payrollcheck.client_grants SET status='active',approved_by_subject='ownerA',approved_at=now()
   WHERE grant_id='60000000-0000-4000-8000-000000000003';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'owner approve affected % rows, expected 1', n; END IF;
END $$;
RESET ROLE;
SET payrollcheck.current_subject_id = 'reviewerY';
SET payrollcheck.current_auth_user_id = '44444444-4444-4444-8444-444444444444';
SET ROLE payrollcheck_app;
DO $$ BEGIN
  IF (SELECT array_agg(report_id) FROM payrollcheck.reports) IS DISTINCT FROM ARRAY['50000000-0000-4000-8000-000000000001'::uuid] THEN RAISE EXCEPTION 'approved grant did not authorize firm read'; END IF;
END $$;
RESET ROLE;

-- Check 10: the firm side may revoke — reviewer Y ends grant Y→A and
-- immediately loses access.
SET payrollcheck.current_subject_id = 'reviewerY';
SET payrollcheck.current_auth_user_id = '44444444-4444-4444-8444-444444444444';
SET ROLE payrollcheck_app;
DO $$ DECLARE n int; BEGIN
  IF current_setting('payrollcheck.current_subject_id', true) IS DISTINCT FROM 'reviewerY' THEN RAISE EXCEPTION 'identity guard: reviewerY subject'; END IF;
  UPDATE payrollcheck.client_grants SET status='revoked',revoked_by_subject='reviewerY',revoked_at=now()
   WHERE grant_id='60000000-0000-4000-8000-000000000003';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'firm revoke affected % rows, expected 1', n; END IF;
  IF (SELECT count(*) FROM payrollcheck.reports) <> 0 THEN RAISE EXCEPTION 'firm-revoked grant still authorized reads'; END IF;
END $$;
RESET ROLE;

-- Check 11: WITH CHECK binding — owner A approving pending grant X→A(2)
-- with approved_by_subject set to someone else must fail, and the grant
-- stays pending.
SET payrollcheck.current_subject_id = 'ownerA';
SET payrollcheck.current_auth_user_id = '11111111-1111-4111-8111-111111111111';
SET ROLE payrollcheck_app;
DO $$ BEGIN
  BEGIN
    UPDATE payrollcheck.client_grants SET status='active',approved_by_subject='reviewerX',approved_at=now()
     WHERE grant_id='60000000-0000-4000-8000-000000000004';
    RAISE EXCEPTION 'approve with foreign approved_by_subject unexpectedly succeeded';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
RESET ROLE;
DO $$ DECLARE s text; BEGIN
  SELECT status INTO s FROM payrollcheck.client_grants WHERE grant_id='60000000-0000-4000-8000-000000000004';
  IF s <> 'pending' THEN RAISE EXCEPTION 'WITH CHECK failure changed grant status to %', s; END IF;
END $$;

-- Check 12: membership writes — an owner may provision, deactivate,
-- and reactivate members of their own tenant, and nothing else.
-- (The new row IS visible to the owner via SELECT: the memberships
-- read policy includes the owner's tenant members, which Postgres
-- requires for the UPDATE below to find the row. The superuser check
-- still verifies the provisioned row independently.)
SET payrollcheck.current_subject_id = 'ownerA';
SET payrollcheck.current_auth_user_id = '11111111-1111-4111-8111-111111111111';
SET ROLE payrollcheck_app;
DO $$ DECLARE n int; BEGIN
  IF current_setting('payrollcheck.current_subject_id', true) IS DISTINCT FROM 'ownerA' THEN RAISE EXCEPTION 'identity guard: ownerA subject'; END IF;
  INSERT INTO payrollcheck.memberships(membership_id,tenant_id,subject_id,auth_user_id,role,active)
   VALUES ('10000000-0000-4000-8000-000000000006','eaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','newhire1','66666666-6666-4666-8666-666666666666','accounting_reviewer',true);
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'owner provision affected % rows, expected 1', n; END IF;
END $$;
RESET ROLE;
DO $$ DECLARE a boolean; BEGIN
  SELECT active INTO a FROM payrollcheck.memberships WHERE subject_id='newhire1';
  IF a IS DISTINCT FROM true THEN RAISE EXCEPTION 'provisioned membership not active'; END IF;
END $$;
SET ROLE payrollcheck_app;
DO $$ DECLARE n int; BEGIN
  UPDATE payrollcheck.memberships SET active=false WHERE subject_id='newhire1';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'owner deactivate affected % rows, expected 1', n; END IF;
  UPDATE payrollcheck.memberships SET active=true WHERE subject_id='newhire1';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'owner reactivate affected % rows, expected 1', n; END IF;
END $$;
RESET ROLE;
DO $$ DECLARE a boolean; BEGIN
  SELECT active INTO a FROM payrollcheck.memberships WHERE subject_id='newhire1';
  IF a IS DISTINCT FROM true THEN RAISE EXCEPTION 'reactivated membership not active'; END IF;
END $$;
SET ROLE payrollcheck_app;
DO $$ BEGIN
  BEGIN
    INSERT INTO payrollcheck.memberships(membership_id,tenant_id,subject_id,auth_user_id,role,active)
     VALUES ('10000000-0000-4000-8000-000000000007','ebbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','intruder1','66666666-6666-4666-8666-666666666666','accounting_reviewer',true);
    RAISE EXCEPTION 'cross-tenant provision unexpectedly succeeded';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
RESET ROLE;
SET payrollcheck.current_subject_id = 'reviewerX';
SET payrollcheck.current_auth_user_id = '33333333-3333-4333-8333-333333333333';
SET ROLE payrollcheck_app;
DO $$ BEGIN
  BEGIN
    INSERT INTO payrollcheck.memberships(membership_id,tenant_id,subject_id,auth_user_id,role,active)
     VALUES ('10000000-0000-4000-8000-000000000008','eaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','intruder2','66666666-6666-4666-8666-666666666666','accounting_reviewer',true);
    RAISE EXCEPTION 'non-owner provision unexpectedly succeeded';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
RESET ROLE;

-- Check 13: sessions — readable by presented session id (including the
-- rotation-grace previous id) or by owning user; writable only for the
-- verified identity; never for another user.
-- (Subject/auth GUCs are cleared first so the session-id path is tested
-- in isolation, not masked by the user-scoped disjunct.)
RESET payrollcheck.current_subject_id;
RESET payrollcheck.current_auth_user_id;
SET payrollcheck.current_session_id = 'sess-owner-a-000000000000000000001';
SET ROLE payrollcheck_app;
DO $$ BEGIN
  IF current_setting('payrollcheck.current_session_id', true) IS DISTINCT FROM 'sess-owner-a-000000000000000000001' THEN RAISE EXCEPTION 'identity guard: session id'; END IF;
  IF (SELECT count(*) FROM payrollcheck.sessions) <> 2 THEN RAISE EXCEPTION 'session-id read failed (expected own + grace row)'; END IF;
END $$;
RESET ROLE;
RESET payrollcheck.current_session_id;
SET payrollcheck.current_session_id = 'sess-reviewer-x-000000000000000001';
SET ROLE payrollcheck_app;
DO $$ BEGIN
  IF (SELECT count(*) FROM payrollcheck.sessions) <> 1 THEN RAISE EXCEPTION 'other-user session leaked via session id'; END IF;
END $$;
RESET ROLE;
RESET payrollcheck.current_session_id;
SET payrollcheck.current_subject_id = 'ownerA';
SET payrollcheck.current_auth_user_id = '11111111-1111-4111-8111-111111111111';
SET ROLE payrollcheck_app;
DO $$ DECLARE n int; BEGIN
  IF (SELECT count(*) FROM payrollcheck.sessions) <> 2 THEN RAISE EXCEPTION 'user-scoped session read failed'; END IF;
  INSERT INTO payrollcheck.sessions(session_id,user_id,auth_user_id,expires_at)
   VALUES ('sess-owner-a-000000000000000000003','ownerA','11111111-1111-4111-8111-111111111111','2027-01-01 12:00:00+00');
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'own session insert affected % rows', n; END IF;
  IF (SELECT count(*) FROM payrollcheck.sessions) <> 3 THEN RAISE EXCEPTION 'inserted session not visible to owner'; END IF;
  BEGIN
    INSERT INTO payrollcheck.sessions(session_id,user_id,auth_user_id,expires_at)
     VALUES ('sess-owner-a-000000000000000000004','reviewerX','33333333-3333-4333-8333-333333333333','2027-01-01 12:00:00+00');
    RAISE EXCEPTION 'foreign session insert unexpectedly succeeded';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
RESET ROLE;
SET payrollcheck.current_session_id = 'sess-owner-a-000000000000000000003';
SET ROLE payrollcheck_app;
DO $$ DECLARE n int; BEGIN
  DELETE FROM payrollcheck.sessions WHERE session_id='sess-owner-a-000000000000000000003';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'own session delete affected % rows, expected 1', n; END IF;
END $$;
RESET ROLE;
SET payrollcheck.current_session_id = 'sess-owner-a-000000000000000000001';
SET ROLE payrollcheck_app;
DO $$ DECLARE n int; BEGIN
  DELETE FROM payrollcheck.sessions WHERE session_id='sess-reviewer-x-000000000000000001';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 0 THEN RAISE EXCEPTION 'foreign session delete affected % rows', n; END IF;
END $$;
RESET ROLE;
RESET payrollcheck.current_session_id;
RESET payrollcheck.current_subject_id;
RESET payrollcheck.current_auth_user_id;

-- Check 14: audit — a caller writes and reads only their own actor rows.
SET payrollcheck.current_subject_id = 'ownerA';
SET payrollcheck.current_auth_user_id = '11111111-1111-4111-8111-111111111111';
SET ROLE payrollcheck_app;
DO $$ DECLARE n int; BEGIN
  IF (SELECT count(*) FROM payrollcheck.access_audit) <> 1 THEN RAISE EXCEPTION 'owner audit isolation failed'; END IF;
  INSERT INTO payrollcheck.access_audit(event_id,request_id,actor_subject_id,report_id,action,allowed,reason)
   VALUES ('70000000-0000-4000-8000-000000000003','req-owner-a-2','ownerA','50000000-0000-4000-8000-000000000001','view_report',true,'owner read 2');
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'own audit insert affected % rows', n; END IF;
  IF (SELECT count(*) FROM payrollcheck.access_audit) <> 2 THEN RAISE EXCEPTION 'inserted audit row not visible to actor'; END IF;
  BEGIN
    INSERT INTO payrollcheck.access_audit(event_id,request_id,actor_subject_id,report_id,action,allowed,reason)
     VALUES ('70000000-0000-4000-8000-000000000004','req-forged','reviewerX','50000000-0000-4000-8000-000000000001','view_report',true,'forged actor');
    RAISE EXCEPTION 'foreign-actor audit insert unexpectedly succeeded';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
RESET ROLE;
SET payrollcheck.current_subject_id = 'reviewerX';
SET payrollcheck.current_auth_user_id = '33333333-3333-4333-8333-333333333333';
SET ROLE payrollcheck_app;
DO $$ BEGIN
  IF (SELECT count(*) FROM payrollcheck.access_audit) <> 1 THEN RAISE EXCEPTION 'firm audit isolation failed'; END IF;
END $$;
RESET ROLE;

-- Check 15: reports are read-only for the app role — no insert, and a
-- delete must leave the row in place.
SET payrollcheck.current_subject_id = 'reviewerX';
SET payrollcheck.current_auth_user_id = '33333333-3333-4333-8333-333333333333';
SET ROLE payrollcheck_app;
DO $$ BEGIN
  BEGIN
    INSERT INTO payrollcheck.reports(report_id,business_tenant_id,client_id,status)
     VALUES ('50000000-0000-4000-8000-000000000099','eaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','clientZ','preview_only');
    RAISE EXCEPTION 'firm report insert unexpectedly succeeded';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
RESET ROLE;
SET payrollcheck.current_subject_id = 'ownerA';
SET payrollcheck.current_auth_user_id = '11111111-1111-4111-8111-111111111111';
SET ROLE payrollcheck_app;
DO $$ DECLARE before int; after int; BEGIN
  SELECT count(*) INTO before FROM payrollcheck.reports WHERE report_id='50000000-0000-4000-8000-000000000001';
  BEGIN
    DELETE FROM payrollcheck.reports WHERE report_id='50000000-0000-4000-8000-000000000001';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  SELECT count(*) INTO after FROM payrollcheck.reports WHERE report_id='50000000-0000-4000-8000-000000000001';
  IF before <> 1 OR after <> 1 THEN RAISE EXCEPTION 'owner report delete not denied'; END IF;
  BEGIN
    INSERT INTO payrollcheck.reports(report_id,business_tenant_id,client_id,status)
     VALUES ('50000000-0000-4000-8000-000000000098','eaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','clientZ','preview_only');
    RAISE EXCEPTION 'owner report insert unexpectedly succeeded';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
RESET ROLE;

-- Check 16: grant scopes are immutable on UPDATE (S6). An approver cannot
-- widen a grant's scopes in the same UPDATE that approves it. The RLS
-- approve WITH CHECK does not bind scopes, so only the BEFORE UPDATE
-- trigger (payrollcheck.prevent_client_grant_reassignment) stops this;
-- without it the approve below would succeed with the wider scopes.
SET payrollcheck.current_subject_id = 'ownerA';
SET payrollcheck.current_auth_user_id = '11111111-1111-4111-8111-111111111111';
SET ROLE payrollcheck_app;
DO $$ BEGIN
  BEGIN
    UPDATE payrollcheck.client_grants
       SET status='active', approved_by_subject='ownerA', approved_at=now(),
           scopes=ARRAY['view_report','review_finding']
     WHERE grant_id='60000000-0000-4000-8000-000000000004';
    RAISE EXCEPTION 'scope-widening approve was not refused with insufficient_privilege';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
RESET ROLE;
DO $$ DECLARE s text; sc text[]; BEGIN
  SELECT status, scopes INTO s, sc FROM payrollcheck.client_grants
   WHERE grant_id='60000000-0000-4000-8000-000000000004';
  IF s <> 'pending' OR sc <> ARRAY['view_report']::text[] THEN
    RAISE EXCEPTION 'scope-widening approve changed grant 60000000-0000-4000-8000-000000000004';
  END IF;
END $$;

-- Check 17: firm_tenant_id is immutable on UPDATE (S6). An approver cannot
-- move a grant to another firm in the same UPDATE that approves it. The RLS
-- approve WITH CHECK does not bind firm_tenant_id, so only the BEFORE
-- UPDATE trigger stops this; without it the approve below would succeed
-- with the grant moved to firm Y.
SET payrollcheck.current_subject_id = 'ownerA';
SET payrollcheck.current_auth_user_id = '11111111-1111-4111-8111-111111111111';
SET ROLE payrollcheck_app;
DO $$ BEGIN
  BEGIN
    UPDATE payrollcheck.client_grants
       SET status='active', approved_by_subject='ownerA', approved_at=now(),
           firm_tenant_id='eddddddd-dddd-4ddd-8ddd-dddddddddddd'
     WHERE grant_id='60000000-0000-4000-8000-000000000004';
    RAISE EXCEPTION 'firm-reassignment approve was not refused with insufficient_privilege';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
RESET ROLE;
DO $$ DECLARE s text; f uuid; BEGIN
  SELECT status, firm_tenant_id INTO s, f FROM payrollcheck.client_grants
   WHERE grant_id='60000000-0000-4000-8000-000000000004';
  IF s <> 'pending' OR f <> 'eccccccc-cccc-4ccc-8ccc-cccccccccccc' THEN
    RAISE EXCEPTION 'firm-reassignment approve changed grant 60000000-0000-4000-8000-000000000004';
  END IF;
END $$;

-- Check 18: business_tenant_id is immutable on UPDATE (S6). An approver
-- cannot move a grant to another business in the same UPDATE that approves
-- it. The RLS approve WITH CHECK would also refuse a business the approver
-- does not own (returning zero rows); the trigger is what makes the attempt
-- fail loudly with insufficient_privilege instead.
SET payrollcheck.current_subject_id = 'ownerA';
SET payrollcheck.current_auth_user_id = '11111111-1111-4111-8111-111111111111';
SET ROLE payrollcheck_app;
DO $$ BEGIN
  BEGIN
    UPDATE payrollcheck.client_grants
       SET status='active', approved_by_subject='ownerA', approved_at=now(),
           business_tenant_id='ebbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
     WHERE grant_id='60000000-0000-4000-8000-000000000004';
    RAISE EXCEPTION 'business-reassignment approve was not refused with insufficient_privilege';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
RESET ROLE;
DO $$ DECLARE s text; b uuid; BEGIN
  SELECT status, business_tenant_id INTO s, b FROM payrollcheck.client_grants
   WHERE grant_id='60000000-0000-4000-8000-000000000004';
  IF s <> 'pending' OR b <> 'eaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' THEN
    RAISE EXCEPTION 'business-reassignment approve changed grant 60000000-0000-4000-8000-000000000004';
  END IF;
END $$;

-- Check 19: a membership role is immutable on UPDATE (S6). A business owner
-- cannot promote a member by editing the role in place. The memberships
-- UPDATE policy permits any column change by the owner, so only the BEFORE
-- UPDATE trigger (payrollcheck.prevent_membership_role_change) stops this;
-- the active-flag flips in Check 12 still work.
SET payrollcheck.current_subject_id = 'ownerA';
SET payrollcheck.current_auth_user_id = '11111111-1111-4111-8111-111111111111';
SET ROLE payrollcheck_app;
DO $$ BEGIN
  BEGIN
    UPDATE payrollcheck.memberships SET role='business_owner'
     WHERE subject_id='newhire1';
    RAISE EXCEPTION 'membership role change was not refused with insufficient_privilege';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
RESET ROLE;
DO $$ DECLARE r text; BEGIN
  SELECT role INTO r FROM payrollcheck.memberships WHERE subject_id='newhire1';
  IF r <> 'accounting_reviewer' THEN
    RAISE EXCEPTION 'membership role change altered newhire1';
  END IF;
END $$;

RESET payrollcheck.current_subject_id;
RESET payrollcheck.current_auth_user_id;
RESET payrollcheck.current_session_id;
-- Check 20: company profile (Slice 2) — one row per tenant, business-owner-only.
-- The owner of A saves and reads A's company; a plain second insert is refused
-- by the one-row-per-tenant unique constraint, while an upsert updates in place.
-- A non-owner member of A, an inactive owner of B, and a firm reviewer with an
-- active view_report grant to A all see nothing and cannot write. The fixture's
-- ownerB is deactivated (Check 3), so provision an active owner of B first.
INSERT INTO payrollcheck.memberships
  (membership_id, tenant_id, subject_id, role, active, auth_user_id)
VALUES
  ('10000000-0000-4000-8000-000000000010', 'ebbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
   'ownerB2', 'business_owner', true, '22222222-2222-4222-8222-222222222222');
SET payrollcheck.current_subject_id = 'ownerA';
SET payrollcheck.current_auth_user_id = '11111111-1111-4111-8111-111111111111';
SET ROLE payrollcheck_app;
DO $$ BEGIN
  INSERT INTO payrollcheck.payroll_companies
    (tenant_id, legal_name, ein, address_line1, address_line2, city, state, postal_code, pay_schedule)
  VALUES
    ('eaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Acme Widgets LLC', '123456789',
     '1 Main St', 'Suite 100', 'Springfield', 'IL', '62701-1234', 'biweekly');
END $$;
DO $$ DECLARE n int; BEGIN
  SELECT count(*) INTO n FROM payrollcheck.payroll_companies;
  IF n <> 1 THEN
    RAISE EXCEPTION 'ownerA company insert: expected 1 visible row, got %', n;
  END IF;
END $$;
-- A plain second insert for the same tenant is refused by the unique constraint.
DO $$ BEGIN
  BEGIN
    INSERT INTO payrollcheck.payroll_companies
      (tenant_id, legal_name, ein, address_line1, city, state, postal_code, pay_schedule)
    VALUES
      ('eaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Acme Widgets LLC', '123456789',
       '1 Main St', 'Springfield', 'IL', '62701', 'biweekly');
    RAISE EXCEPTION 'second company row for tenant A unexpectedly succeeded';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
END $$;
-- An upsert updates the one row in place instead of adding another.
DO $$ BEGIN
  INSERT INTO payrollcheck.payroll_companies
    (tenant_id, legal_name, ein, address_line1, city, state, postal_code, pay_schedule)
  VALUES
    ('eaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Acme Widgets LLC Updated', '123456789',
     '1 Main St', 'Springfield', 'IL', '62701', 'biweekly')
  ON CONFLICT (tenant_id) DO UPDATE
    SET legal_name = EXCLUDED.legal_name, postal_code = EXCLUDED.postal_code, updated_at = now();
END $$;
DO $$ DECLARE n int; r text; BEGIN
  SELECT count(*), max(legal_name) INTO n, r FROM payrollcheck.payroll_companies;
  IF n <> 1 OR r <> 'Acme Widgets LLC Updated' THEN
    RAISE EXCEPTION 'ownerA company upsert failed: % rows, legal_name %', n, r;
  END IF;
END $$;
-- A bad EIN is refused by the CHECK constraint.
DO $$ BEGIN
  BEGIN
    INSERT INTO payrollcheck.payroll_companies
      (tenant_id, legal_name, ein, address_line1, city, state, postal_code, pay_schedule)
    VALUES
      ('eaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Bad EIN LLC', '123',
       '1 Main St', 'Springfield', 'IL', '62701', 'weekly');
    RAISE EXCEPTION 'bad-EIN company insert unexpectedly succeeded';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
END $$;
RESET ROLE;
-- The active owner of B sees nothing of A and cannot write for A.
SET payrollcheck.current_subject_id = 'ownerB2';
SET payrollcheck.current_auth_user_id = '22222222-2222-4222-8222-222222222222';
SET ROLE payrollcheck_app;
DO $$ DECLARE n int; BEGIN
  SELECT count(*) INTO n FROM payrollcheck.payroll_companies;
  IF n <> 0 THEN
    RAISE EXCEPTION 'ownerB2 sees % company rows of tenant A', n;
  END IF;
  BEGIN
    INSERT INTO payrollcheck.payroll_companies
      (tenant_id, legal_name, ein, address_line1, city, state, postal_code, pay_schedule)
    VALUES
      ('eaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Hacked LLC', '111111111',
       '9 Evil Way', 'Nowhere', 'XX', '00000', 'weekly');
    RAISE EXCEPTION 'ownerB2 cross-tenant company insert unexpectedly succeeded';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
RESET ROLE;
-- A non-owner member of A sees nothing and cannot write.
SET payrollcheck.current_subject_id = 'staffA';
SET payrollcheck.current_auth_user_id = '55555555-5555-4555-8555-555555555555';
SET ROLE payrollcheck_app;
DO $$ DECLARE n int; BEGIN
  SELECT count(*) INTO n FROM payrollcheck.payroll_companies;
  IF n <> 0 THEN
    RAISE EXCEPTION 'staffA sees % company rows', n;
  END IF;
  BEGIN
    INSERT INTO payrollcheck.payroll_companies
      (tenant_id, legal_name, ein, address_line1, city, state, postal_code, pay_schedule)
    VALUES
      ('eaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Member LLC', '111111111',
       '3 Third St', 'Springfield', 'IL', '62701', 'monthly');
    RAISE EXCEPTION 'staffA company insert unexpectedly succeeded';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
RESET ROLE;
-- A firm reviewer with an active view_report grant to A sees nothing and cannot write.
SET payrollcheck.current_subject_id = 'reviewerX';
SET payrollcheck.current_auth_user_id = '33333333-3333-4333-8333-333333333333';
SET ROLE payrollcheck_app;
DO $$ DECLARE n int; BEGIN
  SELECT count(*) INTO n FROM payrollcheck.payroll_companies;
  IF n <> 0 THEN
    RAISE EXCEPTION 'reviewerX sees % company rows', n;
  END IF;
  BEGIN
    INSERT INTO payrollcheck.payroll_companies
      (tenant_id, legal_name, ein, address_line1, city, state, postal_code, pay_schedule)
    VALUES
      ('eaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Firm LLC', '111111111',
       '4 Fourth St', 'Springfield', 'IL', '62701', 'monthly');
    RAISE EXCEPTION 'reviewerX company insert unexpectedly succeeded';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
RESET ROLE;
-- The inactive owner of B cannot write for B either.
SET payrollcheck.current_subject_id = 'ownerB';
SET payrollcheck.current_auth_user_id = '22222222-2222-4222-8222-222222222222';
SET ROLE payrollcheck_app;
DO $$ BEGIN
  BEGIN
    INSERT INTO payrollcheck.payroll_companies
      (tenant_id, legal_name, ein, address_line1, city, state, postal_code, pay_schedule)
    VALUES
      ('ebbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'Beta Bakery Inc', '987654321',
       '2 Oak Ave', 'Shelbyville', 'IL', '62565', 'weekly');
    RAISE EXCEPTION 'inactive ownerB company insert unexpectedly succeeded';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
RESET ROLE;
-- The new audit actions are accepted by the access_audit check (written as the app role).
SET payrollcheck.current_subject_id = 'ownerA';
SET payrollcheck.current_auth_user_id = '11111111-1111-4111-8111-111111111111';
SET ROLE payrollcheck_app;
INSERT INTO payrollcheck.access_audit
  (event_id, request_id, actor_subject_id, action, allowed, reason)
VALUES
  (gen_random_uuid(), 'req-company-read', 'ownerA', 'company_read', true, 'allowed'),
  (gen_random_uuid(), 'req-company-write', 'ownerA', 'company_write', true, 'allowed');
DO $$ DECLARE n int; BEGIN
  SELECT count(*) INTO n FROM payrollcheck.access_audit
  WHERE actor_subject_id = 'ownerA' AND action IN ('company_read', 'company_write');
  IF n <> 2 THEN
    RAISE EXCEPTION 'company audit rows: expected 2, got %', n;
  END IF;
END $$;
RESET ROLE;
RESET payrollcheck.current_subject_id;
RESET payrollcheck.current_auth_user_id;
RESET payrollcheck.current_session_id;
ROLLBACK;
