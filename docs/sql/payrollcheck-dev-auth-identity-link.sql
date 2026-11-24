-- Development-only: bind memberships to Supabase Auth UUIDs, not client-submitted subject IDs.
-- No data is migrated, no permissions or policies are granted.
BEGIN;
ALTER TABLE payrollcheck.memberships
 ADD COLUMN auth_user_id uuid REFERENCES auth.users(id) ON DELETE RESTRICT;
CREATE UNIQUE INDEX memberships_tenant_auth_user_unique
 ON payrollcheck.memberships(tenant_id, auth_user_id)
 WHERE auth_user_id IS NOT NULL;
COMMENT ON COLUMN payrollcheck.memberships.auth_user_id IS
 'Trusted server-provisioned Supabase Auth user UUID; not writable by browser clients.';
COMMIT;
