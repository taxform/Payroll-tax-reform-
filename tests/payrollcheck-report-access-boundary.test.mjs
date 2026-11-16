import test from 'node:test';
import assert from 'node:assert/strict';
import {authorizeReportRequest as check} from '../src/payrollcheck/report-access-boundary.mjs';
import {requestClientGrant,approveClientGrant,revokeClientGrant} from '../src/payrollcheck/client-consent.mjs';
const session={userId:'u1',sessionId:'s1',verified:true,active:true};
const business={userId:'u1',tenantId:'businessA',role:'business_owner',active:true};
const firm={userId:'u1',tenantId:'firmA',role:'accounting_reviewer',active:true};
const report={id:'r1',businessTenantId:'businessA',clientId:'clientA',active:true};
const requested=requestClientGrant({firmTenantId:'firmA',businessTenantId:'businessA',requestedBy:'admin1',scopes:['view_report']}).grant;
const approved=approveClientGrant({grant:requested,actor:{userId:'owner',tenantId:'businessA',role:'business_owner',active:true}}).grant;
const input=(overrides={})=>({session,membership:business,report,action:'view_report',...overrides});
test('trusted business owner reads own reports only',()=>{
 assert.equal(check(input()).allowed,true);
 assert.equal(check(input({report:{...report,businessTenantId:'businessB'}})).allowed,false);
});
test('unverified identity, wrong membership and unsupported actions fail closed',()=>{
 for(const s of [{...session,verified:false},{...session,active:false},{...session,sessionId:''}])assert.equal(check(input({session:s})).allowed,false);
 assert.equal(check(input({membership:{...business,userId:'other'}})).allowed,false);
 assert.equal(check(input({action:'delete_report'})).allowed,false);
});
test('accounting reviewer requires active scoped business consent',()=>{
 assert.equal(check(input({membership:firm,grant:requested})).allowed,false);
 assert.equal(check(input({membership:firm,grant:approved})).allowed,true);
 assert.equal(check(input({membership:firm,grant:approved,action:'review_finding'})).allowed,false);
 assert.equal(check(input({membership:firm,grant:approved,report:{...report,businessTenantId:'other'}})).allowed,false);
 const revoked=revokeClientGrant({grant:approved,actor:{userId:'owner',tenantId:'businessA',role:'business_owner',active:true}}).grant;
 assert.equal(check(input({membership:firm,grant:revoked})).allowed,false);
});
