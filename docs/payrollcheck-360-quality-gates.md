# PayrollCheck 360° — Prelaunch quality gates

Status: development prototype only. Do not merge, publish, accept payments, or market as an operational payroll compliance tool until approved.

## Existing prototype inventory (reviewed 2026-11-15)
- `public/payrollcheck/index.html`: 15-point self-reported payroll readiness questionnaire, print view, optional simplified failure-to-deposit illustration. No IRS verification.
- `public/payrollcheck/before-you-pay.html`: 8-item pre-payroll checklist, issue summary, print view. No payroll-provider integration.
- Both pages currently declare `noindex` and do not ask for or upload payroll documents.

## Manual browser acceptance tests — NOT YET EXECUTED
| ID | Test | Expected result |
| --- | --- | --- |
| AUD-01 | Submit the audit with a question unanswered | Native form validation prevents a report |
| AUD-02 | Mark all 15 answers Yes | Score is 100/100, with explicit disclaimer that answers are unverified |
| AUD-03 | Mark all 15 Not applicable | No scorable answers; no compliance certification |
| AUD-04 | Mix Yes/No/Not sure/Not applicable | Score counts only applicable answers; each non-Yes answer has a follow-up |
| AUD-05 | Change illustrative penalty amount or tier | Display updates, with no implication of assessed liability |
| AUD-06 | Try negative, nonnumeric, and extremely large penalty inputs | Invalid amounts are rejected or clearly labeled; no misleading result |
| AUD-07 | Print report on mobile and desktop | Questions and buttons are hidden, results remain readable |
| PAY-01 | Submit pre-payroll checklist with unanswered item | Submission is blocked |
| PAY-02 | Mark all 8 Reviewed | Summary says 8 reviewed but does not approve payroll |
| PAY-03 | Mark one Needs investigation and one Not sure | Two corresponding follow-up actions appear |
| PAY-04 | Reset the form after results | Previous results are hidden and answers cleared |
| PAY-05 | Reload page after entering answers | No sensitive information is stored or transmitted |
| SEC-01 | Inspect network requests and page source | No payroll data collection, unexpected third-party trackers, or exposed secrets |
| A11Y-01 | Use keyboard and screen reader | Labels, radio groups, form errors, and results are understandable |
| MOB-01 | Test narrow mobile viewport | No clipped controls, horizontal scrolling, or unreadable content |

## Blocking product requirements
1. **Rules:** Maintain a versioned, sourced rule catalog with jurisdiction, tax year, effective date, applicability, exceptions, and last-review date. No generic state-specific compliance guarantees.
2. **Accuracy:** Have qualified payroll-tax reviewers validate each rule and its tests. Correct or remove any unsupported penalty estimates before launch.
3. **Security:** Threat model, data minimization, encryption, least-privilege access, audit logging, retention/deletion policies, and an independent security review before accepting employee data.
4. **Billing:** Sandbox-test $29/$49 subscriptions, failed payments, cancellations, refunds, tax treatment, receipts, and entitlement checks. Never use production keys in repository files.
5. **Operational safety:** Clearly distinguish user-reported answers from verified provider/IRS data. No claims of direct IRS monitoring without a supported integration.
6. **Conversion tracking:** Test opt-in analytics and conversions without transmitting sensitive payroll information.
7. **Release:** Obtain explicit approval before merging, publishing, charging, emailing customers, or advertising. Mobile apps require separate testing and store approvals.

## Development order
- Validate both existing prototypes in browsers and repair defects.
- Extract rule logic into testable modules with authoritative citations.
- Design secure account and subscription architecture.
- Implement integrations one at a time with sandbox data.
- Run end-to-end regression and security checks.
- Only then seek launch approval.

This document records a test plan, **not passing test results**.
