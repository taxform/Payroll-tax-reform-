// Run: node --test tests/payrollcheck-prototype.test.mjs
// Source-level regression checks only; not a replacement for browser, tax, or security testing.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const audit=readFileSync(new URL('../public/payrollcheck/index.html',import.meta.url),'utf8');
const prepay=readFileSync(new URL('../public/payrollcheck/before-you-pay.html',import.meta.url),'utf8');
for(const [name,html] of [['readiness audit',audit],['pre-payroll review',prepay]]){
 test(name+' is not indexable during development',()=>{
  assert.match(html,/<meta\s+name="robots"\s+content="[^"]*noindex/i);
 });
 test(name+' does not contain common browser persistence or outbound submission calls',()=>{
  assert.doesNotMatch(html,/\b(?:localStorage|sessionStorage|indexedDB|XMLHttpRequest|sendBeacon)\b/);
  assert.doesNotMatch(html,/\bfetch\s*\(/);
  assert.doesNotMatch(html,/<form\b[^>]*\baction\s*=/i);
 });
 test(name+' has explicit form and result landmarks',()=>{
  assert.match(html,/<form\b/i);
  assert.match(html,/aria-live="polite"/);
  assert.match(html,/type="submit"/);
 });
}
test('readiness audit retains 15 screening questions and non-certification language',()=>{
 assert.match(audit,/15-point/);
 assert.match(audit,/IRS verification: Not performed/);
 assert.match(audit,/not independently validated compliance/);
 assert.match(audit,/if\(value!=='na'\)/);
});
test('pre-payroll review retains 8 checklist items and no approval claims',()=>{
 assert.match(prepay,/No external validation was performed/);
 assert.match(prepay,/Not a payroll approval/);
 assert.match(prepay,/No payroll-provider integration/);
 assert.match(prepay,/items\.length/);
});
