import test from 'node:test';
import assert from 'node:assert/strict';
import {PROVIDERS,normalizePayrollSummary,describeConnection} from '../src/payrollcheck/universal-connect.mjs';
const sample={companyId:'test-tenant',periodStart:'2026-11-01',periodEnd:'2026-11-15',grossPay:'1234.56',employeeCount:2,jurisdictions:['NY','NY','PA']};
test('provider catalog never claims live access',()=>{assert.equal(PROVIDERS.length,5);for(const p of PROVIDERS)assert.equal(describeConnection(p.id).status,'not_connected')});
test('valid summary normalizes without claiming verification',()=>{const r=normalizePayrollSummary(sample);assert.equal(r.status,'normalized_unverified');assert.deepEqual(r.data.jurisdictions,['NY','PA'])});
test('invalid or incomplete payroll fails closed',()=>{for(const x of [{...sample,grossPay:1234.56},{...sample,grossPay:'-1'},{...sample,periodEnd:'2026-10-01'},{...sample,employeeCount:-1},{...sample,jurisdictions:[]},{}])assert.equal(normalizePayrollSummary(x).status,'invalid')});
test('unsupported provider and partial capabilities explicit',()=>{assert.equal(describeConnection('other').status,'unsupported');const r=describeConnection('gusto',{payrollSummary:true});assert.deepEqual(r.available,['payrollSummary']);assert.ok(r.missing.includes('taxLiabilities'))});
