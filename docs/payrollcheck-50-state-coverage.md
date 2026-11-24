# PayrollCheck 360° — Nationwide compliance coverage specification

**Status: planning only.** All 50 states are in scope. No jurisdiction is certified, verified, or implemented by this document. The District of Columbia and local jurisdictions require separate tracking.

## Required rule categories
- State income-tax withholding: registration, taxable wages, withholding methods, deposits, returns, year-end reconciliation.
- State unemployment insurance: registration, wage bases, employer-specific rates, deposits and wage reports.
- Wage-and-hour: minimum wage, overtime, pay frequency, final pay, pay statements, deductions, and recordkeeping.
- Paid leave and employer payroll contributions where applicable.
- Local withholding and employer payroll taxes, where applicable.
- State-specific effective dates, employer thresholds, exceptions, and cross-border/remote work situations.

## Rules engine record contract (design target)
Each rule must include: unique rule ID; state and any local jurisdiction; category; authoritative source URL; source publication date; effective start and end dates; applicability and exceptions; employer size or industry conditions; review date; reviewer; validation status; test cases; and superseded rule reference.

Validation states: `unresearched`, `draft`, `review_pending`, `validated`, `retired`. Only reviewed, validated, effective-dated rules may power user-facing conclusions. Missing or conflicting data must return **unable to determine** and an explanation, not a false compliance pass.

## Live update pipeline (not implemented)
1. Poll authoritative state agency and legislative sources for changes.
2. Store source snapshots and detect changes.
3. Queue rule revisions for qualified human review.
4. Verify effective dates, exceptions and edge cases; execute regression tests.
5. Publish a versioned rule release with an audit trail and customer notices.
6. Monitor for agency corrections, emergency rules and retroactive changes.

No unsupported promise of instant or comprehensive real-time updates. Monitoring frequency, source access and review staffing must be established before launch.

## State coverage register
| State | Source research | Rule validation | Tests |
| --- | --- | --- | --- |
| AL | Not researched | Not validated | Not tested |
| AK | Not researched | Not validated | Not tested |
| AZ | Not researched | Not validated | Not tested |
| AR | Not researched | Not validated | Not tested |
| CA | Not researched | Not validated | Not tested |
| CO | Not researched | Not validated | Not tested |
| CT | Not researched | Not validated | Not tested |
| DE | Not researched | Not validated | Not tested |
| FL | Not researched | Not validated | Not tested |
| GA | Not researched | Not validated | Not tested |
| HI | Not researched | Not validated | Not tested |
| ID | Not researched | Not validated | Not tested |
| IL | Not researched | Not validated | Not tested |
| IN | Not researched | Not validated | Not tested |
| IA | Not researched | Not validated | Not tested |
| KS | Not researched | Not validated | Not tested |
| KY | Not researched | Not validated | Not tested |
| LA | Not researched | Not validated | Not tested |
| ME | Not researched | Not validated | Not tested |
| MD | Not researched | Not validated | Not tested |
| MA | Not researched | Not validated | Not tested |
| MI | Not researched | Not validated | Not tested |
| MN | Not researched | Not validated | Not tested |
| MS | Not researched | Not validated | Not tested |
| MO | Not researched | Not validated | Not tested |
| MT | Not researched | Not validated | Not tested |
| NE | Not researched | Not validated | Not tested |
| NV | Not researched | Not validated | Not tested |
| NH | Not researched | Not validated | Not tested |
| NJ | Not researched | Not validated | Not tested |
| NM | Not researched | Not validated | Not tested |
| NY | Not researched | Not validated | Not tested |
| NC | Not researched | Not validated | Not tested |
| ND | Not researched | Not validated | Not tested |
| OH | Not researched | Not validated | Not tested |
| OK | Not researched | Not validated | Not tested |
| OR | Not researched | Not validated | Not tested |
| PA | Not researched | Not validated | Not tested |
| RI | Not researched | Not validated | Not tested |
| SC | Not researched | Not validated | Not tested |
| SD | Not researched | Not validated | Not tested |
| TN | Not researched | Not validated | Not tested |
| TX | Not researched | Not validated | Not tested |
| UT | Not researched | Not validated | Not tested |
| VT | Not researched | Not validated | Not tested |
| VA | Not researched | Not validated | Not tested |
| WA | Not researched | Not validated | Not tested |
| WV | Not researched | Not validated | Not tested |
| WI | Not researched | Not validated | Not tested |
| WY | Not researched | Not validated | Not tested |

## Release gates
- Every advertised jurisdiction and category has current authoritative citations and reviewed, passing tests.
- No 50-state compliance claims until every advertised coverage category meets its gate.
- Payroll data integrations, security, privacy, billing, and incident response have separate launch gates.
- Record coverage gaps prominently in product UI and marketing.
- Explicit owner approval required before production deployment or paid promotion.
