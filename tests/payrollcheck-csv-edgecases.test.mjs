import test from 'node:test';
import assert from 'node:assert/strict';
import {parseAggregatePayrollCsv as parse} from '../src/payrollcheck/aggregate-csv.mjs';
const h='companyId,periodStart,periodEnd,grossPay,employeeCount,jurisdictions';
const row='demo,2026-11-01,2026-11-15,100.00,2,NY;PA';
test('BOM, CRLF, column reordering and escaped quotes',()=>{
 const a=parse('\uFEFF'+h+'\r\n"Acme ""Example"", LLC",2026-11-01,2026-11-15,100.00,2,NY');
 assert.equal(a.status,'normalized_unverified');assert.equal(a.data.companyId,'Acme "Example", LLC');
 const b=parse('grossPay,companyId,employeeCount,jurisdictions,periodEnd,periodStart\n100.00,demo,2,NY,2026-11-15,2026-11-01');
 assert.equal(b.status,'normalized_unverified');
});
test('malformed quotes, multiline records, duplicate columns and extra rows fail closed',()=>{
 for(const csv of [h+'\n"demo"x,2026-11-01,2026-11-15,100.00,2,NY',h+'\n"demo"garbage,2026-11-01,2026-11-15,100.00,2,NY',h+'\n"demo\nnewline",2026-11-01,2026-11-15,100.00,2,NY',h.replace('employeeCount','grossPay')+'\n'+row,h+'\n'+row+'\n'+row])assert.equal(parse(csv).status,'invalid',csv);
});
test('invalid dates, huge counts, numeric overflow and excessive input fail closed',()=>{
 for(const r of [row.replace('2026-11-15','2026-02-30'),row.replace('2026-11-01','2026-12-01'),row.replace(',2,',',9007199254740992,'),row.replace('100.00','1e309'),row.replace('100.00','-1'),row.replace('NY;PA','XX;bad')])assert.equal(parse(h+'\n'+r).status,'invalid',r);
 assert.equal(parse(h+'\n'+row+' '.repeat(65536)).status,'invalid');
});
