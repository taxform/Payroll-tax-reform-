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
- **Next action:** run manual browser QA on an unpublished preview, record evidence, then choose identity provider/backend before production implementation. Do not close Milestone 1 until complete.
