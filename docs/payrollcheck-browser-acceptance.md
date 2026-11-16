# PayrollCheck 360° — browser acceptance checklist

**Scope:** Unpublished synthetic-data prototype. These checks are **not completed** by writing this document or by Node smoke tests. Use a preview build of PR #74, never live customer payroll.

## Preconditions
- Verify the preview is built from branch `feature/payrollcheck-free-audit`.
- Confirm the fixture URL `/payrollcheck/xray-fixtures.json` is accessible on the preview.
- Use fictional records only. Do not enter personal, tax, bank or real payroll data.
- Record device/browser/version, date, preview commit, outcome, and screenshot reference for each case.

## Business and accounting dashboard
- [ ] Desktop Chrome: open `/payrollcheck/business/` and `/payrollcheck/accounting/`. Confirm sample labels, X-Ray results and navigation.
- [ ] iPhone Safari or equivalent 375px viewport: confirm no horizontal page overflow, readable cards, accessible navigation and usable touch targets.
- [ ] Android Chrome or equivalent 360px viewport: confirm the same.
- [ ] Keyboard-only: Tab through every link; visible focus; no keyboard trap; logical focus order.
- [ ] 200% and 400% zoom: readable content and no lost controls.
- [ ] Screen reader: headings and landmark navigation; sample list announced in order; load/failure status announced.
- [ ] Reduced-motion setting: no unexpected animation.
- [ ] Confirm footer appears after X-Ray sample findings and all claims clearly say fictional/demo.

## Failure states and privacy
- [ ] Block `/payrollcheck/xray-fixtures.json`: confirm friendly unavailable message, no crash or endless spinner.
- [ ] Return malformed fixture JSON: confirm unavailable message.
- [ ] Confirm browser Network panel contains no payroll uploads, third-party tracking from demo module, or provider authentication requests.
- [ ] Confirm no data in localStorage/sessionStorage, no cookies created by demo module, no live account login or payment action.
- [ ] Confirm `noindex,nofollow` on both previews.

## Exit gate
Record each result as PASS/FAIL/BLOCKED and attach evidence. **Milestone 1 remains open until browser checks actually pass.** Automated CI is necessary but not sufficient.
