# PayrollCheck 360° — proposed production identity architecture (decision pending)

**Status:** engineering proposal, NOT a deployed system or final vendor selection. This document is not authorization to ingest payroll, connect providers, or collect payments.

## Candidate implementation
- **Frontend:** retain the existing Netlify-hosted educational site as a public shell; keep payroll customer workflows behind a separate authenticated application boundary.
- **Backend:** TypeScript/Node server API with managed PostgreSQL; all payroll operations server-side. Do not expose database service credentials to browser JavaScript or commit secrets.
- **Authentication:** choose an established managed OIDC provider after evaluating MFA, session management, account recovery, logs, pricing and data processing terms. Verify tokens server-side (issuer, audience, expiry, signature, algorithm and nonce/state as applicable); do not trust client-provided user IDs, roles or tenant IDs.
- **Session:** secure, HttpOnly, SameSite cookies; session rotation after authentication and privilege changes; CSRF defense for state-changing requests; rate limits and account recovery protections.
- **Data:** separate business tenants and accounting firm tenants; client consent is explicit, revocable and audited. Database row-level security (RLS) must be tested with separate non-admin database roles; never rely solely on UI filters.
- **Files:** encrypted private object storage with tenant-bound keys, short-lived scoped access, virus/content checks, retention limits, deletion workflow and audit records.
- **Deployment:** isolated preview/staging/production environments; staging uses fabricated records only until legal and security gates pass.

## Minimal logical schema (illustrative, not migrations)
- `tenants(id, kind, status)` — kind business or accounting_firm.
- `users(id, external_subject, status)` — identity subject verified by server.
- `memberships(user_id, tenant_id, role, status)` — role assigned server-side.
- `client_grants(id, firm_tenant_id, business_tenant_id, approved_by_business_user_id, approved_at, revoked_at, scope, status)` — no implied grants.
- `payroll_reports(id, business_tenant_id, period, source_kind, status, created_at)` — private data; never query without verified tenant scope.
- `review_events(id, report_id, actor_user_id, action, occurred_at)` — immutable append-only audit trail.
- `access_events(id, actor_user_id, tenant_id, action, outcome, occurred_at)` — include denials and grant revocations.

## Required request path
1. Validate session and bind server-verified user subject.
2. Load active membership(s) from trusted database.
3. Select a tenant context only from active memberships; never accept arbitrary tenant IDs as authority.
4. For accounting-to-business access, verify exactly one active, business-approved grant covering requested action, with revocation enforced on every request.
5. Enforce matching RLS and private storage policy; deny ambiguous, missing or stale authorization.
6. Record access/review decisions; do not log payroll values, access tokens or sensitive identifiers.

## Adversarial acceptance tests before live use
- Forged role, changed tenant ID, changed client ID, expired session, missing CSRF token, replayed OAuth state, compromised reviewer invitation.
- Cross-tenant report IDs, client grant revocation while a tab remains open, concurrent role downgrade, firm membership removal.
- Export URL sharing, object key guessing, deleted-record access, background job acting under wrong tenant, cached response leakage.
- Failed recovery/MFA bypass, credential stuffing, rate-limit enforcement and audit log tampering.

## Decisions requiring owner/security review
1. Managed identity provider and exact MFA policy.
2. Backend hosting region, PostgreSQL provider and cost ceiling.
3. Data classification, retention period, breach response, legal/privacy review.
4. Whether any payroll PII is necessary for the first beta; prefer aggregate synthetic-only tests until security review.
5. Independent penetration testing and sign-off before enabling real data.

**Current gate:** no real login, database, client authorization, provider OAuth, payments or production backend exists. This proposal must not be described as implemented.
