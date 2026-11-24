# Universal Payroll Connect™ — proposed paid add-on

**Status: pricing proposal, not live.** No payment products, subscriptions, checkout, charges or production integrations have been created.

## Proposed monthly pricing (USD)
| Base plan | Base price | Optional Connect add-on | Combined |
|---|---:|---:|---:|
| Pro | $29.00 | $7.99 | $36.99 |
| Business | $49.00 | $7.99 | $56.99 |

## Positioning
“Keep your payroll software. Add another layer of review.”

Connect is optional, and the core PayrollCheck product must remain usable without it. File-import capability and supported live connections must be described separately; do not imply every provider is supported.

## Entitlement and billing requirements
- Add-on entitlement is a separate, revocable subscription line item associated with an active base plan.
- Only the billing backend may determine entitlement; never trust browser flags.
- Show the $7.99 recurring price, billing interval, taxes if applicable, renewal terms and cancellation terms before checkout.
- Obtain affirmative authorization for any paid subscription; no default opt-in.
- Define proration, upgrades, downgrades, cancellation and failed-payment behavior before launch.
- Keep subscription state synchronized from authenticated, signature-verified payment webhooks with idempotency.
- No live Stripe product, price, checkout, payment link or billing portal changes until explicitly approved.
- Do not enable paid Connect unless at least one advertised integration or supported import workflow is actually available, secure and tested.

## Product gates
- Confirm provider API licensing, scope availability, per-customer cost and rate limits.
- Define limits (connections, sync frequency, retention) from measured provider costs, not assumptions.
- Ensure privacy/security reviews and verified payroll rule coverage before promising compliance checks.
- Display a per-provider support matrix and clear partial-data warnings.
