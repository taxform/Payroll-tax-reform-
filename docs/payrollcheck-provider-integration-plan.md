# PayrollCheck 360° — Existing Payroll Software Integration Plan

**Status: design only. No provider API is connected or authorized.**

## Product goal
Employers should be able to keep their current payroll software and authorize a limited, read-only connection to PayrollCheck 360° for independent review. Availability depends on each provider's developer access, permissions, API capabilities, and commercial terms.

## Candidate providers (not verified as available integrations)
- QuickBooks Payroll / Intuit
- Gusto
- ADP
- Paychex

## Customer flow
1. Choose a supported payroll provider.
2. Review precisely what data will be read, retention period, and permitted use.
3. Redirect to the provider's official OAuth/authorization experience where supported; never ask for payroll passwords.
4. Exchange credentials server-side and encrypt tokens at rest; use least-privilege read-only scopes where available.
5. Confirm employer identity and selected payroll company, then sync a minimum necessary subset.
6. Normalize the data and show last successful sync, completeness, and missing fields.
7. Evaluate only independently validated, effective-dated rules for the applicable jurisdictions.
8. Present findings as potential issues with supporting rule citations and explicit uncertainty, not certified compliance.
9. Allow disconnect and token revocation, deletion requests, and access audits.

## Canonical adapter interface (proposed)
`connect(provider, authorizationCode, state)`, `listCompanies(connection)`, `getPayrollPeriods(connection, company, since)`, `getPayrollSummary(connection, company, period)`, `getTaxLiabilities(connection, company, period)`, `disconnect(connection)`.

Each adapter must return structured `supported`, `unsupported`, or `unavailable` for each capability. Never synthesize missing payroll values or treat a partial sync as a complete review.

## Security and privacy gates
- No direct deposit or bank account modification, payroll execution, employee editing, or tax filing permissions.
- No tokens or payroll data in browser localStorage, logs, URLs, or public source files.
- Explicit consent, tenant isolation, encryption in transit and at rest, rotation and revocation, webhook signature verification, replay protection, rate limits, audit logging, and incident response.
- Define retention, data minimization, privacy notices, breach response, and subprocessors before production.
- Independent security assessment and integration-specific test environments before onboarding real customers.

## Rollout gates
1. Verify current official API documentation, developer eligibility, scopes, data endpoints, pricing, and commercial restrictions for each provider.
2. Choose first provider based on feasible read-only access and useful payroll data coverage.
3. Build a mock adapter with synthetic data and automated contract tests.
4. Complete sandbox integration and consent/revocation tests.
5. Validate rule accuracy and report language with qualified payroll/tax reviewers.
6. Pilot with explicitly consenting businesses, then separately approve production launch.

**Not a promise:** No live sync, 50-state compliance certification, or one-click connection is operational today.
