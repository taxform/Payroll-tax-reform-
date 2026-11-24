-- Read-only security regression check for the dedicated Supabase development project.
-- Returns zero rows on success; any row indicates unexpected access or RLS drift.
-- UPDATED Nov 23, 2026 (M2 step 7): this used to check the deny-by-default
-- posture (zero policies, five tables). The step-7 policies are now the
-- reviewed posture, so this checks THAT instead: RLS enabled + forced on
-- all six tables, exactly the fifteen app_* policies, no policy granting
-- anon/authenticated/public, no table grants to anon/authenticated, no
-- schema USAGE for anon/authenticated, six tables. Run it against the
-- Supabase dev project (where anon/authenticated exist), NOT disposable
-- Postgres. If a future step adds or changes a policy, update the
-- expected_policies list here in the same PR.
WITH protected_tables AS (
 SELECT c.oid,c.relname,c.relrowsecurity,c.relforcerowsecurity
 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='payrollcheck' AND c.relkind='r'
), expected_policies(table_name, policy_name) AS (
 VALUES
  ('tenants','app_tenants_select'),
  ('memberships','app_memberships_select'),
  ('memberships','app_memberships_insert'),
  ('memberships','app_memberships_update'),
  ('reports','app_reports_select'),
  ('client_grants','app_client_grants_select'),
  ('client_grants','app_client_grants_insert'),
  ('client_grants','app_client_grants_approve'),
  ('client_grants','app_client_grants_revoke'),
  ('access_audit','app_access_audit_select'),
  ('access_audit','app_access_audit_insert'),
  ('sessions','app_sessions_select'),
  ('sessions','app_sessions_insert'),
  ('sessions','app_sessions_update'),
  ('sessions','app_sessions_delete')
), unexpected AS (
 SELECT relname AS table_name,
  CASE WHEN NOT relrowsecurity OR NOT relforcerowsecurity THEN 'rls_not_forced'
       WHEN NOT EXISTS (SELECT 1 FROM pg_policies p WHERE p.schemaname='payrollcheck' AND p.tablename=relname) THEN 'missing_rls_policy'
       WHEN EXISTS (SELECT 1 FROM pg_policies p WHERE p.schemaname='payrollcheck' AND p.tablename=relname AND p.policyname NOT IN (SELECT policy_name FROM expected_policies WHERE table_name=relname)) THEN 'unexpected_rls_policy'
       WHEN EXISTS (SELECT 1 FROM pg_policies p WHERE p.schemaname='payrollcheck' AND p.tablename=relname AND (p.roles @> ARRAY['anon'] OR p.roles @> ARRAY['authenticated'] OR p.roles @> ARRAY['public'])) THEN 'policy_grants_public_role'
       WHEN has_table_privilege('anon',oid,'SELECT') OR has_table_privilege('authenticated',oid,'SELECT')
         OR has_table_privilege('authenticated',oid,'INSERT') OR has_table_privilege('authenticated',oid,'UPDATE')
         OR has_table_privilege('authenticated',oid,'DELETE') THEN 'unexpected_table_grant'
       ELSE NULL END AS issue
 FROM protected_tables
)
SELECT table_name,issue FROM unexpected WHERE issue IS NOT NULL
UNION ALL
SELECT table_name,'missing_expected_policy' FROM expected_policies ep
WHERE NOT EXISTS (SELECT 1 FROM pg_policies p WHERE p.schemaname='payrollcheck' AND p.tablename=ep.table_name AND p.policyname=ep.policy_name)
UNION ALL
SELECT '(schema)','unexpected_schema_usage'
WHERE has_schema_privilege('anon','payrollcheck','USAGE')
 OR has_schema_privilege('authenticated','payrollcheck','USAGE')
UNION ALL
SELECT '(tables)','expected_six_tables'
WHERE (SELECT count(*) FROM protected_tables)<>6;
