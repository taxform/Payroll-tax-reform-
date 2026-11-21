import test from 'node:test';
import assert from 'node:assert/strict';
import {makeReportAccessAuditEvent as audit} from '../src/payrollcheck/report-access-audit.mjs';
const base={requestId:'req1',session:{userId:'user1',sessionId:'session1',email:'private@example.com'},reportId:'report1',action:'view_report',decision:{allowed:false,reason:'missing_client_consent'},occurredAt:'2026-11-15T22:00:00Z',payrollAmount:12345};
test('audit event includes only allowlisted metadata and no payroll or email',()=>{
 const event=audit(base);
 assert.deepEqual(Object.keys(event),['eventType','requestId','actorUserId','reportId','action','allowed','reason','occurredAt']);
 assert.equal(event.allowed,false);
 assert.equal(JSON.stringify(event).includes('private@example.com'),false);
 assert.equal(JSON.stringify(event).includes('12345'),false);
 assert.equal(Object.isFrozen(event),true);
});
test('rejects invalid or untrusted audit inputs',()=>{
 for(const change of [{requestId:'../unsafe'},{reportId:''},{action:'export_payroll'},{decision:{allowed:'yes',reason:'missing_client_consent'}},{decision:{allowed:true,reason:'arbitrary_text'}},{occurredAt:'yesterday'},{session:{userId:'',sessionId:'s1'}}])assert.equal(audit({...base,...change}),null);
});
