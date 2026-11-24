# PayrollCheck 360° — Identity, tenant isolation and client access gates

Status: design and pure authorization prototype only. **No production authentication, server-side enforcement, client permissions, encryption architecture or secure storage is deployed.**

## Required identities and boundaries
- Every authenticated human user belongs to an explicitly verified business or accounting firm tenant. Server assigns user ID, tenant ID, role and active status; the browser must never choose these values.
- A business owner can access only resources belonging to the same verified business tenant.
- Accounting firms may see a client's payroll only after a separately recorded, explicit, active client authorization. Firm membership by itself grants no client access.
- Accounting reviewers cannot grant themselves client access. Revocation must take effect immediately.
- All database reads and writes must enforce tenant/client authorization on the server and at the database policy layer, including report exports, background jobs and file storage.

## Production acceptance gates (not implemented)
1. Select authentication provider and implement verified email, MFA for privileged users, session expiry, CSRF protection, and secure cookie configuration.
2. Define server-side tenant membership and client consent schema, revocation, audit log, and least-privilege roles.
3. Enforce row-level tenant isolation for business data and firm-client grants in every query and object storage path.
4. Test cross-tenant ID guessing, forged browser roles, revoked grants, privilege escalation, export links and concurrent sessions.
5. Implement encryption in transit/at rest, key rotation, retention/deletion and breach response, with counsel/security review for payroll PII.
6. Run independent security testing before allowing real payroll uploads, provider OAuth or production billing.
7. Verify all 50 state rules and payroll compliance claims separately. An anomaly flag is not a legal finding.

The `tenant-access.mjs` helper demonstrates **policy decisions on trusted input only**. It must never be treated as a substitute for production authorization middleware.
