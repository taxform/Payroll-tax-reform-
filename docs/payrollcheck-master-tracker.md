# PayrollCheck 360° — Master completion tracker

**Status:** Unpublished development. **Source of truth:** this file, updated with each work session and referenced in draft PR #74. No item is complete merely because a mockup, helper, or test file exists.

## Operating rules
- Work in priority order. Finish the active milestone's acceptance gates before starting unrelated features.
- For each session: record commits, tests, blockers, and next action here. Never claim a deployment, connection, approval, or payment without evidence.
- Do not merge to main, publish, enable billing, ingest real payroll, or make legal-compliance claims without explicit owner approval and production security gates.
- Mark complete only with repeatable test evidence and, where applicable, production verification. Tests passing on static prototypes do not establish production readiness.

## Milestone 1 — Prototype integrity and automated testing (ACTIVE)
- [x] Educational payroll self-check and Before You Pay static previews; not audits.
- [x] Business and accounting firm sample dashboard pages; fictional data only.
- [x] Provider-neutral aggregate CSV parser and offline preview; fabricated data only.
- [x] Payroll X-Ray aggregate period comparison module and report/firm queue models.
- [x] Rule engine that fails closed when validated jurisdiction rules are unavailable.
- [x] Automated Node test workflow and initial tests.
- [x] Confirm access-policy CI passes (GitHub Actions runs 43803598404, 43803601322, 43803604779).
- [x] Add CSV regression tests for quoting, malformed input, overflow, dates and duplicate fields; parser hardening committed. Parser fix passed GitHub Actions run 43804119997.
- [x] Repair broken browser CSV module and add importability/parity tests against hardened core parser (commits `580ed6a`, `f497def`; CI passed: GitHub Actions runs 43805314006 and 43805325025).
- [x] Display fabricated X-Ray findings on both static dashboards using local browser-only demonstration data.
- [x] Dashboard demo reads shared synthetic fixtures; automated tests check fixture finding codes against the actual X-Ray engine (browser does not calculate live reports).
- [x] Add automated smoke checks for sample metric consistency, responsive CSS, keyboard focus, and demo error messaging (GitHub Actions 43804394989 passed).
- [x] Write reproducible manual browser and privacy acceptance checklist in `docs/payrollcheck-browser-acceptance.md`.
- [ ] Execute manual browser accessibility, mobile, error-state and quality-gate verification (not yet performed).
**Exit:** All prototype tests green, demo workflow documented and manually checked.

## Milestone 2 — Production identity and data isolation (NOT STARTED)
- [x] Pure authorization-policy prototype and tests (not deployed enforcement).
- [x] Pure client-consent approval/revocation prototype and tests (not persisted or wired to authenticated server requests).
- [x] Trusted-context report-access boundary prototype and regression tests (not a deployed API, and session verification/database persistence not implemented).
- [x] Trusted-record authorization adapter with unique-record and revoked-consent tests (not connected to a database or session provider).
- [x] Privacy-minimized authorization audit event model and tests (no persistence or event delivery).
- [x] Unapplied deny-by-default PostgreSQL schema proposal and security review checklist (not an approved database design or migration).
- [x] Static schema guard tests check all draft tables have forced RLS and no grant/policy statements; does not replace PostgreSQL integration tests.
- [x] Pure OIDC-claims-to-session adapter and negative tests (assumes upstream cryptographic verification; not login or session service).
- [x] Identity/security requirements document.
- [x] Draft production identity architecture and adversarial acceptance tests (proposal only; provider/backend not selected).
- [ ] Choose backend, authentication and data storage design.
- [ ] Implement verified login, MFA for privileged users, sessions, password recovery, and server-side role assignment.
- [ ] Implement business tenant isolation, accounting firm/client consent grants, immediate revocation, database policies and audit logs.
- [ ] Penetration tests for forged identities, cross-tenant reads, exports, file access and privilege escalation.
- [ ] Encryption, secrets management, retention/deletion, backup and incident response.
**Exit:** Independent security review and end-to-end tenant isolation tests passed.

## Milestone 3 — Payroll import and provider integrations (NOT STARTED)
- [ ] Design and implement secure real-data CSV upload, schema versioning, validation, consent and deletion.
- [ ] Apply for/verify provider API access: QuickBooks Payroll, Gusto, ADP, Paychex; record provider-specific limitations.
- [ ] Implement authorized read-only OAuth connections, token rotation/revocation and connection health where permitted.
- [ ] Verify data mapping against real provider test fixtures with no real payroll PII in source control.
- [ ] Provide a secure manual import fallback when APIs are unavailable.
**Exit:** End-to-end authorized test imports and provider connections verified individually.

## Milestone 4 — Accuracy and compliance (NOT STARTED)
- [ ] Research and verify federal and all 50-state payroll rules using official sources, effective dates and reviewer sign-off.
- [ ] Build versioned calculation and jurisdiction applicability tests, including edge cases and annual changes.
- [ ] Validate Payroll X-Ray false-positive/false-negative behavior on representative test datasets.
- [ ] Distinguish anomaly detection from legally verified errors; add human review and corrections.
- [ ] Define safe customer-facing accuracy claims and legal disclaimers.
**Exit:** Documented independent validation and ongoing rules-maintenance process.

## Milestone 5 — Customer workflows and payments (NOT STARTED)
- [ ] Business dashboard: authorized uploads/connections, report history, findings review, Before You Pay.
- [ ] Accounting dashboard: consented multi-client queue, invitations, revocation, exports, reviewer permissions.
- [ ] Decide final subscriptions (proposed $29 Pro, $49 Business; optional $7.99 Universal Payroll Connect add-on); verify unit economics.
- [ ] Implement Stripe test-mode products, entitlements, webhook verification, invoices, refunds and cancellation.
- [ ] Test failed payments, downgrades, revocation, duplicate webhooks and subscription lifecycle.
**Exit:** Fully tested sandbox customer journeys, approved pricing and billing terms.

## Milestone 6 — Launch (NOT STARTED)
- [ ] Legal/privacy/security review, terms, disclosures, support and incident response readiness.
- [ ] Accessibility and performance checks, monitoring, backups and disaster recovery tests.
- [ ] Production staging and owner acceptance tests.
- [ ] Obtain explicit approval to merge/deploy and activate payments.
- [ ] Launch limited beta before broad marketing; monitor quality and support.
**Exit:** Approved live deployment with documented evidence.

## Separate backlog
- [ ] Mobile app concept: PR #75 is a coming-soon banner, not built apps. Do not advertise availability.
- [ ] SEO and marketing rollout for PayrollCheck 360° after product validation.
- [ ] Branding claims (e.g. no second opinion) require evidence and review before use.

## Latest recorded development
- Draft PR: https://github.com/taxform/Payroll-tax-reform-/pull/74
- Branch: `feature/payrollcheck-free-audit`
- Last code additions before tracker: `2fcb613` security plan; `89faa656` access-policy tests; `83d966d` access-policy helper.
- CSV parser fix passed CI at `5207f32`; fixture browser module added at `8453cca` (CI passed).
- Dashboard sample metrics corrected at `a479758` and responsive/focus CSS added at `09e95b4`; QA smoke tests at `2d07949` (GitHub Actions 43804394989 passed).
- Browser acceptance checklist committed at `e0ca0a0`; no manual pass has been claimed.
- Synthetic demo validation/status accessibility hardening at `5a06d1c` (CI passed).
- Proposed backend/authentication architecture documented at `85481b4` (not implemented or approved).
- Manual browser checklist expanded for CSV preview at `2726ebf`; **manual browser runs still NOT executed** (no browser test environment or verified preview available in this session).
- Consent lifecycle prototype commits `4cadef0` and `993820e` (CI passed: run 43805710387; no production enforcement).
- Hardened consent prototype to reject forged active approval metadata at `9eeeff1`; added regression tests at `e145318` (new CI pending).
- Consent-hardening CI passed (run 43805823509).
- Trusted-context report-access boundary commits `11c48b6` and `b937a8b` (CI pending).
- Report-boundary CI passed (run 43806452238). Trusted-record adapter commits `b903c3b` and `ec999f4` (CI pending).
- **Next action:** verify latest CI; run manual browser QA; choose identity provider/backend, then implement real server session validation and database enforcement. Do not close Milestone 1 until complete.

## Latest work session — 2026-11-15
- Confirmed GitHub Actions success for stored-report authorization adapter and tracker (run 43806621802).
- Added privacy-minimized report access audit event model and regression tests (commits `48eb0e1`, `ff794fd`). CI pending.
- No live backend, audit storage, verified session service or customer-data handling. Next: verify CI and choose server identity/database architecture before implementing real enforcement.

## Follow-up development session — 2026-11-15
- Verified CI passed for audit event model and tests (GitHub Actions run 43806779678).
- Drafted unapplied PostgreSQL tables for tenants, memberships, reports, grants and access audit, with forced RLS and intentionally no policies (commits `18e2880`, `33ea8c0`). No database or runtime was connected.
- Blockers: identity/backend/database selection, reviewed RLS policies, PostgreSQL integration tests, manual browser QA and independent security review.

## Schema verification session — 2026-11-15
- Confirmed prior PostgreSQL proposal and tracker CI passed (run 43806861478).
- Added static schema guard tests (commit `6cc582d`), latest CI pending.
- Remaining: real database tests, session verification, RLS policies, manual browser QA and independent security review.

## Identity boundary session — 2026-11-15
- Verified static schema guard CI passed (GitHub Actions run 43806902386).
- Added and hardened a fail-closed mapping adapter for *already cryptographically verified* OIDC claims with negative tests (commits `5dfc7a6`, `3a9c147`, `ad63b9f`). Latest CI pending.
- No actual identity provider, JWT signature verification, MFA, secure session service or database connection exists. Do not treat this adapter as authentication.

## OIDC claim hardening session — 2026-11-15
- Confirmed prior identity adapter CI passed (GitHub Actions run 43806979591).
- Hardened already-verified claims mapping against malformed/duplicate audiences, future not-before and authentication times, and inconsistent issued/expiry timestamps (commits `4d3104d`, `8ffac0b`; CI pending).
- This is **not JWT verification or real login**. A production OIDC middleware must verify signatures, issuer/audience, algorithm, keys, expiry, token type, session revocation and MFA before using these helpers. Manual browser QA and database integration remain open.

## Authenticated-boundary prototype — 2026-11-15
- Added an async composition boundary for already-verified identity claims and trusted report/membership/grant records, with fail-closed lookup tests (commits for `src/payrollcheck/authenticated-report-boundary.mjs` and `de1b7f9`).
- This is not an HTTP endpoint or cryptographic token verifier. The callback must be implemented against trusted server-side storage; no production session or database service exists.
- Next: verify CI, select actual identity/backend/database stack, implement verified middleware and transaction-safe data access, and run manual browser QA.

## Report authorization integration tests — 2026-11-15
- Confirmed prior authenticated-boundary CI passed (GitHub Actions run 43807123955).
- Added end-to-end *prototype* tests covering accounting firm pending/approved/revoked grants and scope restrictions (commit `8f34e83`).
- Reject unsupported report actions before any trusted-record lookup; added negative test (commits `508168c`, `ca898ae`). Latest CI pending.
- These are in-memory tests only, not a real OIDC provider, database transaction, or browser test. Milestone 1 manual QA and Milestone 2 production implementation remain incomplete.

## Authenticated endpoint integration contract — 2026-11-15
- Verified previous report-boundary CI passed (GitHub Actions run 43807265164).
- Added regression cases for duplicate active firm grants, ambiguous memberships/reports and malformed trusted record containers (commit `f1dfba2`).
- Documented a future server endpoint's verified OIDC, transactional database, RLS, revocation and audit requirements (commit `e3e0a12`).
- Latest CI pending. No HTTP endpoint, real database, OIDC integration or deployment exists. Manual browser QA remains open.

## Malformed role hardening — 2026-11-15
- Previous authorization regression CI passed (run 43807339956).
- Changed stored report authorization to deny non-string membership roles instead of risking a thrown exception (commit `a8a8367`).
- Added malformed-role regression tests (commit `a6f5752`); latest CI pending.
- Still prototype-only. No live authentication, production database, real payroll data or deployment.

## Direct report authorization role hardening — 2026-11-15
- Confirmed previous role hardening CI success (run 43807458016).
- Hardened the direct report access boundary to handle non-string role values without throwing (commit `619b1c2`).
- Added direct-boundary regression tests for malformed roles (commit `05d7021`).
- Latest CI pending; this is still a pure prototype without production OIDC, database or HTTP route.

## Database schema contract alignment — 2026-11-16
- Previous direct-boundary hardening CI passed (run 43807568227).
- Updated **unapplied draft** PostgreSQL schema to include a report client identifier, consent action scopes, and a partial unique index preventing multiple simultaneously active grants for the same firm/business pair (commit `25eecd5`).
- Added static schema guard regression tests for the above constraints (commit `971035f`). Latest CI pending.
- Schema remains design-only and unreviewed: no database instance, real OIDC integration, migration execution or PostgreSQL runtime tests. Database UUID identifiers still require a reviewed mapping to current prototype IDs.

## Fail-closed authenticated boundary hardening — 2026-11-16
- Confirmed draft SQL schema guard CI passed (run 43807675228).
- Wrapped trusted-record authorization in a fail-closed error boundary so unexpected record adapter exceptions cannot expose internal exception text (commit `0b20070`).
- Added regression tests for a throwing trusted-record getter and malformed membership roles (commit `fb88e87`). Latest CI pending.
- This remains a non-cryptographic, in-memory authorization prototype; no real OIDC, database, server endpoint or payroll processing is deployed.

## Parameterized PostgreSQL loader scaffold — 2026-11-16
- Confirmed previous fail-closed authorization CI success (run 43807834687).
- Added a **server-only, unconnected** parameterized SQL record loader requiring injected query and trusted UUID-to-prototype-ID mapping functions (commits `949dcfe`, `8cd3784`).
- Added required requester metadata to the **unapplied** SQL draft (commit `bbfa6f2`).
- Added fake-query tests for parameterization, consent field mapping, missing reports and malformed inputs (commit `039ff82`). CI pending.
- This is not a real PostgreSQL connection, transaction, RLS test, identity integration, or production endpoint. The schema remains unreviewed; live data remains prohibited.

## PostgreSQL loader provenance validation — 2026-11-16
- Confirmed previous loader scaffold CI passed (run 43807946321).
- Hardened server-only fake-query adapter to reject unexpected report status, mismatched SQL row identities, malformed grant metadata and tenant UUID-to-ID collisions (commit `5424008`).
- Added regression tests for invalid SQL rows and tenant mapping collisions (commit `b9bda0f`). Latest CI pending.
- No live PostgreSQL instance, actual transaction, OIDC provider, runtime RLS verification or real payroll data. Integration remains unconnected.

## SQL consent scope consistency — 2026-11-16
- Verified previous SQL row provenance CI success (run 43808039273).
- Tightened unconnected PostgreSQL loader to reject duplicate or excessive consent scopes, matching pure consent model and draft SQL expectations (commit `00e6689`).
- Added fake-query negative tests (commit `21028bf`); latest CI pending.
- Still no managed database, OIDC integration, RLS runtime test, live deployment or customer payroll data.

## SQL loader to authorization boundary integration — 2026-11-16
- Verified previous SQL consent-scope tests passed (run 43808152398).
- Added fabricated-record end-to-end Node integration tests for the PostgreSQL loader wired to authenticated report authorization, including valid firm consent, revoked/missing consent, ungranted actions, mismatched membership, expired claims and query failures (commit `cd25d2a`).
- CI pending. These are mock SQL rows, not a running PostgreSQL server; token signatures, RLS, transactions, live identity, and browser behavior remain untested. No production deployment.

## Read-only PostgreSQL transaction scaffold — 2026-11-16
- Verified mocked SQL-to-authorization integration CI success (run 43808352571).
- Added a server-only read-only repeatable-read transaction wrapper with rollback and connection release handling (commit `1ba80cd`).
- Added fake-pool tests for commit, rollback, begin failure and malformed client; corrected a test assertion (commits `e4d0b44`, `0407fe2`). Latest CI pending.
- No actual PostgreSQL server or RLS runtime test. This wrapper does not confer tenant isolation and must not be used with real payroll data before reviewed policies and independent security verification.

## Transaction-backed authorization composition — 2026-11-16
- Confirmed read-only transaction wrapper CI passed (run 43808436688).
- Added a server-only composition module wiring preverified identity, read-only transaction, parameterized record loader and report authorization together (commit `a24ed69`).
- Added fake-pool tests covering valid scoped firm access, expired identity before connection, missing grant, rollback and connection release on query failure (commit `cf8d7e0`). Latest CI pending.
- This is **not** an HTTP endpoint, cryptographic token verifier, real PostgreSQL connection or runtime RLS test. Real data and production deployment remain prohibited.

## Disposable PostgreSQL 16 CI milestone — 2026-11-16
- Previous authenticated PostgreSQL composition tests passed (run for `4ab3ee8`).
- Discovered malformed and duplicated SQL in the unapplied schema draft; rewrote it to a single valid-looking deny-by-default schema (`903837a`). This requires execution verification.
- Added a separate GitHub Actions workflow with a disposable PostgreSQL 16 service (`6e04790`) and SQL checks for forced RLS, no policies, invisible seeded rows and rejected inserts for a non-BYPASSRLS role (`af7d4ca`). CI pending; do not claim successful real database execution yet.
- No live database, RLS access policies, OIDC verification, production migration or deployment.

## Live PostgreSQL CI constraint checks — 2026-11-16
- Verified disposable PostgreSQL 16 RLS schema test succeeded on commit `af7d4ca` (run 43808641430); earlier workflow-only commit failed before SQL test file existed.
- Added PostgreSQL SQL integration checks for duplicate active consent, duplicate scopes, and active grants lacking approval (commit `eeb9231`), wired into isolated PostgreSQL CI (commit `d81d241`). Latest CI pending.
- These tests use synthetic records in a disposable database. Production RLS policies, JWT signature validation, sessions, app service, persistent audit, real user access and deployment remain absent.

## PostgreSQL consent revocation regression — 2026-11-16
- Confirmed disposable PostgreSQL consent constraint test succeeded (run 43808761792).
- Extended SQL integration coverage to revoke an active consent, assert it disappears from active grants, then approve a replacement grant for the same firm/business pair (`e92df99`). CI pending.
- Production login still blocked on explicit identity-provider selection and MFA/session security design; no provider chosen or connected.

## Supabase Auth provider decision and development preparation — 2026-11-16
- Recommended Supabase Auth + PostgreSQL for cost-conscious B2B prototype; published Free and Pro $25/month baseline, subject to infrastructure and production requirements.
- Added server-only Supabase identity boundary requiring independently verified JWT claims, AAL2 MFA, trusted email confirmation lookup, and trusted UUID-to-internal-user mapping (commits `6bc604a`, `ea7f10c`).
- Added synthetic identity tests (`36a5fc3`) and integration decision/security checklist (`86097d6`). CI pending.
- No Supabase project, cryptographic JWT verifier, actual user login, sessions, production database, live payroll or deployment connected. Owner must approve provider account connection before live integration.

## Supabase development configuration gate — 2026-11-16
- Confirmed latest Supabase identity prototype smoke tests passed on commit `66a1ab6`.
- Added development-only Supabase project URL validation and tests (`9d380ca`, `cc54567`). Production and non-Supabase URLs are rejected. Latest CI pending.
- No connected Supabase project, server-side JWT cryptographic verifier, real user login, MFA enrollment, session cookies or deployment.
- Next owner action: create/authorize a Supabase development project and supply only its public project URL; never share service-role keys or passwords in chat.

## Connected Supabase discovery — 2026-11-16
- Supabase connection verified; one project `First`, reference `sfsazfknbhnnyvavfmhv`, US East, healthy PostgreSQL 17. No tables returned in `public` or `payrollcheck` schemas.
- Public project URL: `https://sfsazfknbhnnyvavfmhv.supabase.co`. **Do not assume this is a dedicated PayrollCheck development project**: existing project is named First.
- Security advisor flags `public.rls_auto_enable()` SECURITY DEFINER as callable by anon and authenticated. Review before any sensitive data; do not change without owner approval.
- No SQL migrations or Supabase settings changed. Ask whether to use First or create a separate development project before applying PayrollCheck schema.

## Dedicated Supabase development project created — 2026-11-16
- Owner approved separate project under `payrolltaxreform organization`; cost tool quoted $0/month and creation succeeded.
- Project `payrollcheck-360-dev`, ref `izqzclahjijkhyxvhtif`, URL `https://izqzclahjijkhyxvhtif.supabase.co`, region `us-east-1`, ACTIVE_HEALTHY.
- New project public schema contains no tables at inspection. Existing project `First` not changed.
- No PayrollCheck schema applied, login enabled, production deployed or customer data imported. Next: review Supabase Auth docs and create/test dev-only deny-by-default schema with owner authorization for changes.

## Dedicated Supabase development schema applied — 2026-11-16
- Applied `docs/sql/payrollcheck-deny-by-default-schema.sql` to project `izqzclahjijkhyxvhtif` using migration `payrollcheck_dev_deny_by_default_schema`. Migration returned success.
- Verified five empty tables in private `payrollcheck` schema: tenants, memberships, reports, client_grants, access_audit.
- Independently queried pg_catalog: all five have RLS enabled and forced, with zero policies. Supabase advisor reports expected informational `rls_enabled_no_policy` notices, not an authorization bypass.
- No authentication users, customer data, API access grants, production deployment, payment integration, or real payroll ingestion. Next: design and test explicit RLS policies and secure identity binding, without loosening access prematurely.

## Supabase private schema lockdown — 2026-11-16
- Added `docs/sql/payrollcheck-private-schema-dev-lockdown.sql` commit `54d0ace` and applied `payrollcheck_dev_private_schema_lockdown` to dedicated development project `izqzclahjijkhyxvhtif`.
- Live SQL verification: all five tables retain RLS enabled + FORCE RLS and zero policies; `anon` and `authenticated` have neither schema USAGE nor table SELECT privileges. No data inserted.
- This is defense in depth, not completed authentication or tenant isolation. Server-side JWT verification, reviewed per-tenant policies, live access audit and real endpoint remain unimplemented. Production remains untouched.

## Supabase Auth identity link — 2026-11-16
- Applied development migration `payrollcheck_dev_auth_identity_link` to dedicated Supabase project; SQL source in `docs/sql/payrollcheck-dev-auth-identity-link.sql`, commit `5d09cee`.
- `payrollcheck.memberships.auth_user_id` nullable UUID references `auth.users(id)`; unique partial index per tenant/user. No existing memberships or Auth users were modified.
- Live verification: UUID column and index present; zero membership rows; FORCE RLS remains enabled; authenticated role has no SELECT access.
- Remaining: real verified login/session, MFA enrollment, trusted membership provisioning, server-side access checks and tenant isolation tests. No production access.

## Supabase tenant membership lookup scaffold — 2026-11-16
- Added `src/payrollcheck/supabase-tenant-membership.mjs` (`085959c`) and synthetic tests `tests/payrollcheck-supabase-tenant-membership.test.mjs` (`f8c0842`).
- Adapter requires trusted, verified Supabase UUID and tenant UUID, parameterized SQL, exactly one active membership, and allowed role; fails closed for missing, duplicate, malformed or mismatched records.
- This is **not** a live login, RLS policy, actual database connection, JWT verification, or authorization endpoint. Current dev database intentionally denies all application access; do not use a bypass-RLS connection as a workaround.
- Previous CI on `2f99b61` passed; new commit tests pending at time of update.

## Supabase session-to-membership scaffold — 2026-11-16
- Added `src/payrollcheck/supabase-session-membership.mjs` (`34e47c9`) and synthetic unit tests `tests/payrollcheck-supabase-session-membership.test.mjs` (`d060642`).
- Fail-closed composition expects server-trusted `getVerifiedUser`, independent `requireAal2` and tenant-scoped membership query; rejects anonymous/unconfirmed users and missing MFA.
- **Important:** callbacks are not implemented against a real Supabase Auth service; no session token signature verification or live RLS tenant access is proven. Tests use synthetic callbacks. No production deployment.

## Supabase Auth client adapter — 2026-11-16
- Added `src/payrollcheck/supabase-auth-checks.mjs` commit `b9ab803` and synthetic tests `tests/payrollcheck-supabase-auth-checks.test.mjs` commit `f4bb3b0`.
- Uses injected trusted Supabase client's `auth.getUser(token)` and `auth.getClaims(token)` and enforces matching user ID, `aal2`, authenticated role, nonanonymous identity and UUID session ID; rejects failures.
- No actual client instantiation, live token, credential, user enrollment, session cookie, or tenant-scoped database integration yet. CI to be verified; no production deployment.

## CI diagnosis and UUID fix — 2026-11-16
- Investigated GitHub Actions smoke failure: positive session-membership test returned `invalid_request` because `src/payrollcheck/supabase-session-membership.mjs` UUID regex omitted one 4-digit UUID group.
- Fixed regex to full 8-4-4-4-12 format in commit `1575d00`. No DB or production changes. Await successful post-fix CI before calling it verified.

## Post-fix CI and development DB security recheck — 2026-11-16
- GitHub Actions smoke tests on `1575d00` and `3ebb50b` both completed successfully after fixing the malformed UUID validator.
- Rechecked dedicated Supabase development project: all five private tables have RLS and FORCE RLS, zero policies, and no anon/authenticated SELECT or authenticated INSERT/UPDATE grants.
- Added reusable read-only drift check `docs/sql/payrollcheck-dev-security-regression-check.sql` (`6f4d236`). This verifies closed access, not positive per-tenant access.
- Still blocked from customer use: no authorized tenant RLS policies, live user enrollment, real API/session binding or database role/transaction design.

## Tenant RLS authorization specification — 2026-11-16
- Added `docs/payrollcheck-tenant-rls-access-spec.md` (`6c1a5be`) specifying business-only report access, firm-client active `view_report` consent, revocation, MFA, identity, audit and cross-tenant tests.
- Design only: no RLS policy/grant/schema/user data changes made. Next work is a disposable Postgres RLS implementation and positive/negative isolation tests, then review before any dedicated dev deployment.

## Disposable tenant RLS policy tests — 2026-11-16
- Added isolated-only SQL policy fixture `tests/sql/payrollcheck-report-rls-fixture.sql` (`7d6e79b`, corrected `210fe52`) and isolation/revocation tests `tests/sql/payrollcheck-report-rls-isolation.sql` (`290789a`).
- Updated disposable PostgreSQL CI workflow (`1c4b36f`) to run fixture and tests. CI was in progress at tracker update.
- Fixture uses a custom PostgreSQL setting for synthetic identity and intentionally broad supporting-table SELECT policies. **Not secure for direct SQL clients and never to be applied to Supabase dev/production.**
- Remaining: review trustworthy transaction-bound identity, least-privilege supporting-table access, RLS policies, actual verified Supabase Auth and tenant-consent lifecycle, then independently test before dev migration.

## Disposable PostgreSQL CI repair — 2026-11-16
- Isolated PostgreSQL workflow `43811553211` failed with duplicate tenant primary key: new isolation test reused tenant IDs persisted by earlier consent-constraint test.
- Updated synthetic tenant UUIDs in `tests/sql/payrollcheck-report-rls-isolation.sql` (commit `469bf45`); new PostgreSQL run `43811699902` started and was in progress at checkpoint.
- Existing smoke tests passed. This fix only changes synthetic fixture data; Supabase development database remains untouched.

## Correlated RLS policy defect found in CI — 2026-11-16
- PostgreSQL run `43811699902` failed the positive accounting-firm access assertion. Investigation identified unqualified `business_tenant_id` inside a nested client-grant EXISTS; PostgreSQL can bind it to the inner grant table, making the intended report ownership comparison tautological.
- Qualified as `g.business_tenant_id = payrollcheck.reports.business_tenant_id` in disposable fixture (commit `20eb7d3`). CI rerun `43811831763` was in progress at checkpoint.
- No live Supabase policy changes. This illustrates why positive AND negative tenant-isolation tests are mandatory before authorization deployment.
