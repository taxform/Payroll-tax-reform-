import test from 'node:test';import assert from 'node:assert/strict';import {comparePayrollPeriods} from '../src/payrollcheck/payroll-xray.mjs';
const p={companyId:'DEMO',periodStart:'2026-10-01',periodEnd:'2026-10-15',grossPay:'1000.00',employeeCount:3,jurisdictions:['NY']};
const c={...p,periodStart:'2026-11-01',periodEnd:'2026-11-15'};
test('large increase is a review flag, not compliance failure',()=>{const r=comparePayrollPeriods(p,{...c,grossPay:'1300.00'});assert.equal(r.status,'review_available');assert.equal(r.findings[0].code,'GROSS_PAY_INCREASE');assert.match(r.disclaimer,/not evidence/)});
test('threshold equality does not flag',()=>assert.equal(comparePayrollPeriods(p,{...c,grossPay:'1250.00'}).findings.length,0));
test('state and headcount changes are flagged',()=>{const r=comparePayrollPeriods(p,{...c,jurisdictions:['PA'],employeeCount:4});assert.deepEqual(r.findings.map(x=>x.code),['JURISDICTION_CHANGE','EMPLOYEE_COUNT_CHANGE'])});
test('no baseline is never a percentage alert',()=>assert.equal(comparePayrollPeriods({...p,grossPay:'0.00'},c).findings[0].code,'NO_BASELINE'));
test('different tenants, overlapping periods, invalid data and thresholds fail closed',()=>{for(const [a,b,o] of [[p,{...c,companyId:'OTHER'},{}],[p,{...c,periodStart:'2026-10-15'},{}],[p,{...c,grossPay:'NaN'},{}],[p,c,{increaseThresholdPercent:0}]])assert.equal(comparePayrollPeriods(a,b,o).status,'unable_to_review')});
