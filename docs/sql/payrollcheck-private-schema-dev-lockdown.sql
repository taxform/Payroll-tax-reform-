-- Development-only defense in depth: private PayrollCheck schema is not exposed
-- to Supabase Data API roles. No application grants or RLS policies added.
BEGIN;
REVOKE ALL ON SCHEMA payrollcheck FROM PUBLIC, anon, authenticated;
REVOKE ALL ON ALL TABLES IN SCHEMA payrollcheck FROM PUBLIC, anon, authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA payrollcheck FROM PUBLIC, anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA payrollcheck REVOKE ALL ON TABLES FROM PUBLIC, anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA payrollcheck REVOKE ALL ON SEQUENCES FROM PUBLIC, anon, authenticated;
COMMIT;
