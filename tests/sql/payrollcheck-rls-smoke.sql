-- Run only in a disposable CI PostgreSQL database.
-- Deny-by-default gate: runs AFTER the schemas are applied and BEFORE
-- any policy file, so it asserts zero policies on all six tables
-- (sessions included since step 7) plus RLS enabled + forced.
CREATE ROLE payrollcheck_test_reader NOLOGIN NOBYPASSRLS;
GRANT USAGE ON SCHEMA payrollcheck TO payrollcheck_test_reader;
GRANT SELECT, INSERT ON ALL TABLES IN SCHEMA payrollcheck TO payrollcheck_test_reader;
INSERT INTO payrollcheck.tenants(tenant_id,tenant_type)
VALUES ('11111111-1111-4111-8111-111111111111','business');
DO $$
DECLARE t text; n bigint; enabled boolean; forced boolean;
BEGIN
 FOR t IN SELECT unnest(ARRAY['tenants','memberships','reports','client_grants','access_audit','sessions','auth_limits'])
 LOOP
  SELECT relrowsecurity,relforcerowsecurity INTO enabled,forced
  FROM pg_class WHERE oid=('payrollcheck.'||t)::regclass;
  IF enabled IS DISTINCT FROM true OR forced IS DISTINCT FROM true THEN
   RAISE EXCEPTION 'RLS missing on %',t;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='payrollcheck' AND tablename=t) THEN
   RAISE EXCEPTION 'Unexpected RLS policy on %',t;
  END IF;
 END LOOP;
END $$;
SET ROLE payrollcheck_test_reader;
DO $$
DECLARE n bigint;
BEGIN
 SELECT count(*) INTO n FROM payrollcheck.tenants;
 IF n<>0 THEN RAISE EXCEPTION 'RLS exposed tenant rows'; END IF;
 BEGIN
  INSERT INTO payrollcheck.tenants(tenant_id,tenant_type)
  VALUES ('22222222-2222-4222-8222-222222222222','business');
  RAISE EXCEPTION 'RLS incorrectly permitted insert';
 EXCEPTION WHEN insufficient_privilege THEN NULL;
 END;
END $$;
RESET ROLE;
