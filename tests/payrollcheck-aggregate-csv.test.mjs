import test from 'node:test';
import assert from 'node:assert/strict';
import {parseAggregatePayrollCsv} from '../src/payrollcheck/aggregate-csv.mjs';
const header='companyId,periodStart,periodEnd,grossPay,employeeCount,jurisdictions';
const row='sample-company,2026-11-01,2026-11-15,1234.50,2,NY;PA';
test('one aggregate row can be normalized, never verified',()=>{
 const r=parseAggregatePayrollCsv(header+'\n'+row);
 assert.equal(r.status,'normalized_unverified');assert.equal(r.data.grossPay,'1234.50');
});
test('malformed or extra data fails closed',()=>{
 for(const csv of [header+'\n'+row+'\n'+row,header+'\n',header+'\n'+row+',extra',header.replace('companyId','grossPay')+'\n'+row,header+'\n'+row.replace('1234.50','-3'),header+'\n'+row.replace('NY;PA',''),header+'\n'+row.replace('2,NY','2.5,NY'),'a'.repeat(65537),header+'\n"unclosed'])assert.equal(parseAggregatePayrollCsv(csv).status,'invalid');
});
test('quoted CSV fields are supported',()=>{
 const r=parseAggregatePayrollCsv(header+'\n"Example, Inc.",2026-11-01,2026-11-15,1234.50,2,NY');
 assert.equal(r.data.companyId,'Example, Inc.');
});
