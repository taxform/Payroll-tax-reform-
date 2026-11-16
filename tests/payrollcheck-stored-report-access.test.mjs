import test from 'node:test';
import assert from 'node:assert/strict';
import {authorizeStoredReportAccess as check} from '../src/payrollcheck/stored-report-access.mjs';
import {requestClientGrant,approveClientGrant,revokeClientGrant} from '../src/payrollcheck/client-consent.mjs';
const session={userId:'u1',sessionId:'s1',verified:true,active:true};
const business={userId:'u1',tenantId:'businessA',role:'business_owner',active:true};
const firm={userId:'u1',tenantId:'firmA',role:'accounting_reviewer',active:true};
const report={id:'r1',businessTenantId:'businessA',clientId:'clientA',active:true};
const pending=requestClientGrant({firmTenantId:'firmA',businessTenantId:'businessA',requestedBy:'admin',scopes:['view_report']}).grant;
const approved=approveClientGrant({grant:pending,actor:{userId:'owner',tenantId:'businessA',role:'business_owner',active:true}}).grant;
const input=(overrides={})=>({session,memberships:[business],reports:[report],grants:[],reportId:'r1',action:'view_report',...overrides});
test('business owner allowed only with unique trusted records',()=>{
 assert.equal(check(input()).allowed,true);
 for(const changes of [{reports:[]},{reports:[report,report]},{memberships:[business,business]},{session:{...session,verified:false}},{reportId:'other'}])assert.equal(check(input(changes)).allowed,false);
});
test('accounting firm requires exactly one active scoped consent',()=>{
 assert.equal(check(input({memberships:[firm],grants:[approved]})).allowed,true);
 for(const grants of [[],[pending],[approved,approved],[{...approved,businessTenantId:'other'}]])assert.equal(check(input({memberships:[firm],grants})).allowed,false);
 const revoked=revokeClientGrant({grant:approved,actor:{userId:'owner',tenantId:'businessA',role:'business_owner',active:true}}).grant;
 assert.equal(check(input({memberships:[firm],grants:[revoked]})).allowed,false);
 assert.equal(check(input({memberships:[firm],grants:[approved],action:'review_finding'})).allowed,false);
});
test('multiple active memberships and malformed record containers fail closed',()=>{
 assert.equal(check(input({memberships:[business,firm]})).allowed,false);
 assert.equal(check(input({grants:null})).allowed,false);
 assert.equal(check(input({reports:Array(501).fill(report)})).allowed,false);
});
