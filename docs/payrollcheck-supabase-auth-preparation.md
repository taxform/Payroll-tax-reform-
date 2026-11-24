# PayrollCheck 360° — Supabase Auth integration preparation

**Status:** development-branch scaffolding only. No Supabase project, JWT verifier, login page, user mapping table, email lookup, or production environment is connected.

## Decision
Recommend Supabase Auth + PostgreSQL for a cost-conscious first beta. Published pricing as reviewed November 2026: free development tier and Pro starting at $25/month; additional infrastructure, email delivery, backups and security services may cost extra. Free projects can pause after inactivity. Production pricing and legal/security requirements must be rechecked before purchase.

## Security contract
- Keep PayrollTaxReform.com public content separate from private PayrollCheck 360 application.
- Authenticate with Supabase server-side. Verify access-token signature using trusted JWKS, strict algorithm allowlist, issuer and audience `authenticated`, timestamps and key rotation; do not merely decode JWT.
- Require `aal2` for all payroll report access. Server checks confirmed email via trusted Supabase admin lookup; do not assume the access token contains an `email_confirmed_at` claim.
- Map Supabase UUID subjects to opaque internal user IDs through trusted database records. Never trust client-supplied tenant, organization, role or membership.
- Use HttpOnly Secure SameSite session cookies and CSRF protections, rate limits, session revocation, logout and recovery workflows.
- Preserve deny-by-default PostgreSQL RLS until reviewed tenant policies, non-BYPASSRLS database role, transactional authorization and revocation tests are implemented.
- Use only fabricated data in staging until independent security review and legal/privacy sign-off.
- Keep service-role keys and DB credentials exclusively on the server; never commit secrets or expose them to the public Netlify frontend.

## Next implementation gates
1. Owner creates a separate Supabase development project and authorizes connection; obtain project URL and public project identifier through approved configuration, not secrets in chat.
2. Implement real server-side JWKS verification and trusted confirmed-email and identity-mapping lookups, plus signature/key-rotation tests.
3. Implement tenant membership, consent, session and audited RLS policies; test real cross-tenant access in disposable PostgreSQL.
4. Add secure staging login UI, MFA enrollment/recovery, and end-to-end browser checks before considering production.

The helper `src/payrollcheck/supabase-identity-boundary.mjs` requires injected *trusted* verification and lookup functions. Its tests use synthetic claims; it does not itself verify cryptographic signatures or establish an authenticated session.
