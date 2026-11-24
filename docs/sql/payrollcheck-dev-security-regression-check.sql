-- Read-only security regression check for the dedicated Supabase development project.
-- Returns zero rows on success; any row indicates unexpected access or RLS drift.
-- This intentionally checks deny-by-default posture, NOT authorized tenant access.
WITH protected_tables AS (
 SELECT c.oid,c.relname,c.relrowsecurity,c.relforcerowsecurity
 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='payrollcheck' AND c.relkind='r'
), unexpected AS (
 SELECT relname AS table_name,
  CASE WHEN NOT relrowsecurity OR NOT relforcerowsecurity THEN 'rls_not_forced'
       WHEN EXISTS (SELECT 1 FROM pg_policies p WHERE p.schemaname='payrollcheck' AND p.tablename=relname) THEN 'unexpected_rls_policy'
       WHEN has_table_privilege('anon',oid,'SELECT') OR has_table_privilege('authenticated',oid,'SELECT')
         OR has_table_privilege('authenticated',oid,'INSERT') OR has_table_privilege('authenticated',oid,'UPDATE')
         OR has_table_privilege('authenticated',oid,'DELETE') THEN 'unexpected_table_grant'
       ELSE NULL END AS issue
 FROM protected_tables
)
SELECT table_name,issue FROM unexpected WHERE issue IS NOT NULL
UNION ALL
SELECT '(schema)','unexpected_schema_usage'
WHERE has_schema_privilege('anon','payrollcheck','USAGE')
 OR has_schema_privilege('authenticated','payrollcheck','USAGE')
UNION ALL
SELECT '(tables)','expected_five_tables'
WHERE (SELECT count(*) FROM protected_tables)<>5;
