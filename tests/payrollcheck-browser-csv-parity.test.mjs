import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {parseAggregatePayrollCsv as core} from '../src/payrollcheck/aggregate-csv.mjs';

const source=await readFile(new URL('../public/payrollcheck/connect/csv-preview.mjs',import.meta.url),'utf8');
const {parseAggregatePayrollCsv:browser}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
const header='companyId,periodStart,periodEnd,grossPay,employeeCount,jurisdictions';
const valid=header+'\nSAMPLE-ONLY,2026-11-01,2026-11-15,1234.50,2,NY;PA';
test('browser parser is importable and accepts fabricated aggregate sample',()=>{
 const r=browser(valid);assert.equal(r.status,'normalized_unverified');assert.deepEqual(r,core(valid));
});
test('browser and core reject malformed CSV consistently',()=>{
 const cases=[
  header+'\n"demo"x,2026-11-01,2026-11-15,100,2,NY',
  header+'\n"demo\nnewline",2026-11-01,2026-11-15,100,2,NY',
  header+'\n"demo"garbage,2026-11-01,2026-11-15,100,2,NY',
  header+'\nSAMPLE,2026-02-30,2026-11-15,100,2,NY',
  header+'\nSAMPLE,2026-11-01,2026-11-15,100,9007199254740992,NY',
  valid+'\nEXTRA,2026-11-01,2026-11-15,100,2,NY',
  valid+' '.repeat(65536)
 ];
 for(const csv of cases){assert.equal(browser(csv).status,'invalid');assert.deepEqual(browser(csv),core(csv))}
});
test('browser and core parse quoted fields and CRLF identically',()=>{
 const csv='\uFEFF'+header+'\r\n"Example ""Payroll"", LLC",2026-11-01,2026-11-15,1234.50,2,NY';
 assert.equal(browser(csv).status,'normalized_unverified');assert.deepEqual(browser(csv),core(csv));
});
