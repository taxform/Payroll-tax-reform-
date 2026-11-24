# PayrollCheck 360° — tenant report-access security specification (draft)

**Status:** design only; no production authorization or policy is approved. Existing Supabase development tables remain private with FORCE RLS and zero policies.

## Authorization contract

The trusted server must authenticate the bearer token with Supabase Auth, independently verify `aal2` on the same token, require confirmed nonanonymous user, and resolve the user by `memberships.auth_user_id` (never user metadata or caller-supplied subject). Authorization must be reevaluated for every request, not cached across revocation.

**Business owner:** may view a report only if its `business_tenant_id` matches the owner's active membership tenant and that tenant has `tenant_type='business'`.

**Accounting reviewer/admin:** may view a report only if they have active membership in a `tenant_type='accounting_firm'` tenant AND a matching `client_grants` row where `firm_tenant_id` is their firm, `business_tenant_id` matches the report, `status='active'`, and `view_report = ANY(scopes)`. Neither a pending request nor a revoked grant authorizes viewing. A `review_finding` scope alone must not authorize `view_report`.

**Denied by default:** all other roles, inactive memberships, unknown tenants, mismatched report IDs, expired/invalid tokens, `aal1` sessions, unconfirmed users, anonymous users, and database failures. Do not return report existence information on denial.

## Database implementation gates

1. Keep `payrollcheck` out of public Data API exposure. Do not grant `anon` or `authenticated` schema/table privileges during design.
2. Use a dedicated non-owner, non-`BYPASSRLS` application database role, with a controlled identity context bound to a verified session and set inside a transaction. Never trust arbitrary request-provided `SET` values from SQL clients.
3. Design policies for `reports` with explicit business/firm paths. Cross-table membership and grant reads must work under RLS without recursion or broad grants; review any security-definer helper for restricted schema, fixed search_path, and EXECUTE privileges. Do not deploy helpers or policies until reviewed.
4. Grant lifecycle must be authorized separately: only a verified business owner may approve or revoke a firm-client grant; firm users may request but not self-approve. Validate tenant types in database transaction. Record actor identity and audit event atomically.
5. Recheck revocation within the report-read transaction; verify no cross-tenant access or stale grant after revocation. Test race conditions and isolation with two businesses and two firms.
6. Do not create actual users, tenant memberships, sample payroll data, or live API endpoints without an approved test plan.

## Required acceptance tests

| Scenario | Expected |
| --- | --- |
| Business A owner reads A report | Allow |
| Business A owner reads B report | Deny |
| Inactive owner reads A report | Deny |
| Firm X reviewer reads A with active `view_report` grant | Allow |
| Firm X reviewer reads A with pending/revoked grant | Deny |
| Firm X reviewer reads A with `review_finding` only | Deny |
| Firm Y reviewer reads A with only Firm X grant | Deny |
| Firm X reviewer reads B with only A grant | Deny |
| Accounting admin self-approves own request | Deny |
| Anonymous, unconfirmed or `aal1` user | Deny |
| Client revokes grant, firm retries | Deny |
| Database or identity provider unavailable | Deny |

**Current verification:** application-level synthetic tests and read-only database lockdown checks only. Positive authorization against real Supabase RLS has not been implemented or verified.
