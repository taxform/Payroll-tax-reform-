# PostgreSQL prototype security review gates

The SQL in `docs/sql/payrollcheck-deny-by-default-schema.sql` is **unapplied design material**, not a production migration. It intentionally enables and forces RLS on each table **without creating any policies**. Application access must remain denied until identity, policy and operational controls have been selected and independently reviewed.

## Required before staging use

1. Select managed PostgreSQL, OIDC provider and backend runtime; document security owners.
2. Create separate migration and application roles; application roles must not own tables, be superusers or possess `BYPASSRLS`. Revoke broad `PUBLIC` privileges and audit default privileges.
3. Design and test tenant-scoped RLS policies with verified session identity from the backend, never from arbitrary client-supplied tenant IDs or session settings.
4. Verify tenant type consistency for every grant and report using trusted transactional checks; a foreign key alone does not establish that a tenant is a business or accounting firm.
5. Define immutable consent history and transactional revocation, including concurrent requests and immediate access invalidation. Current status constraints alone are insufficient.
6. Define approved scopes, expiry, audit event retention and tamper resistance. Keep payroll values and personal email addresses out of access audit records.
7. Validate denial for anonymous, inactive, revoked, cross-tenant, stale-session and duplicate-membership cases, including SQL injection and privilege escalation.
8. Run PostgreSQL integration tests against a disposable database and obtain an independent security review before any real payroll data.

## Explicit limitations

The draft does not define production RLS policies, user authentication, encryption keys, audit-log delivery, data deletion, provider integration or billing. A successful Node test suite cannot prove database isolation. Never apply this SQL to a live database without migration review and rollback planning.
