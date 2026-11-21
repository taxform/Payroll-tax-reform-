# PayrollCheck 360° — authenticated report endpoint integration contract

**Status: design-only; no server endpoint or live database exists.** This contract describes the minimum safe integration for `checkAuthenticatedReportAccess`.

## Trusted request sequence

1. Terminate TLS and enforce rate limits and request-size limits at the server edge.
2. Verify an OIDC token/session using a maintained server library: signature, algorithm allowlist, trusted JWKS/key rotation, issuer, audience, token type, expiration, not-before, revocation, and required MFA. Never accept browser-supplied `verified: true` as proof.
3. Extract `verifiedClaims` only from successful middleware verification. Use server-controlled issuer, audience and current time. Map subject identifiers consistently to membership records.
4. Parse and validate the requested report ID and allowlisted action; reject unsupported actions before querying storage.
5. In one appropriately isolated database transaction, load the report, the caller's active memberships, and current consent grants through a least-privilege database role. Do not trust tenant IDs, membership, grant status, or report ownership from request JSON.
6. Use `checkAuthenticatedReportAccess` as a *secondary* policy check. Database RLS must independently prevent cross-tenant reads and writes. The adapter cannot establish record provenance or prove that a grant was legitimately approved.
7. On denial, return a generic 403/404 without revealing whether another tenant's report exists. Never return a report body until both database and policy authorization succeed.
8. Record a privacy-minimized audit event using a durable server-side logging pipeline. Audit-write failure behavior must be explicitly chosen and tested.
9. Recheck consent immediately before data release for long-running report operations; revoke access to pending exports and download URLs on grant revocation.

## Integration acceptance tests

- Anonymous, expired, forged, wrong-issuer, wrong-audience, and revoked sessions denied.
- Firm membership and business ownership loaded from the trusted database, not the browser.
- Pending, revoked, wrong-business, wrong-firm, duplicate and out-of-scope grants denied.
- Concurrent revocation and report read tested under a documented isolation policy.
- Direct SQL and object-storage access cannot bypass report policy.
- Database outage, missing audit sink and invalid records fail safely without payroll leakage.
- Logs never contain payroll amounts, raw employee details, access tokens or credentials.

## Open decisions

Choose a managed OIDC provider, Node/TypeScript backend, PostgreSQL hosting, secrets manager, migration strategy, transactional audit design, MFA policy, data retention and independent security reviewer before any production implementation. No integration credentials should be committed to GitHub.
