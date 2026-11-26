-- PayrollCheck 360 - Slice 5 (Tax Center).
--
-- Follow-up to PR #148: the JavaScript AUDIT_ACTIONS list in
-- src/payrollcheck/payrollcheck-tenancy.mjs already includes 'tax_center_read',
-- but the production access_audit check constraint still lists only the nine
-- earlier actions, so the Tax Center audit insert fails with a
-- check-constraint violation (23514) and the endpoint returns 503.
--
-- Run in order after payrollcheck-pay-runs-schema.sql, against the production
-- database, after applying payrollcheck-migrations. Apply to the production
-- database only after this change merges; opening this pull request applies
-- nothing to production. This migration only widens access_audit_action_check;
-- it creates no tables.

BEGIN;

-- Slice 5 (Tax Center): allow 'tax_center_read' in the access_audit action list.
ALTER TABLE payrollcheck.access_audit DROP CONSTRAINT IF EXISTS access_audit_action_check;
ALTER TABLE payrollcheck.access_audit ADD CONSTRAINT access_audit_action_check CHECK (
  action IN (
    'view_report', 'review_finding', 'dashboard_read', 'company_read', 'company_write',
    'employee_read', 'employee_write', 'pay_run_read', 'pay_run_write', 'tax_center_read'
  )
);

COMMIT;
