import test from 'node:test';
import assert from 'node:assert/strict';
import {checkAuthenticatedReportAccess as check} from '../src/payrollcheck/authenticated-report-boundary.mjs';
const claims={iss:'https://issuer.example',aud:'payrollcheck-api',sub:'user1',sid:'session1',iat:1000,exp:2000};
const identityConfig={issuer:claims.iss,audience:claims.aud,nowSeconds:1500};
const records={memberships:[{userId:'user1',tenantId:'businessA',role:'business_owner',active:true}],reports:[{id:'report1',businessTenantId:'businessA',active:true}],grants:[]};
const input=(overrides={})=>({verifiedClaims:claims,identityConfig,reportId:'report1',action:'view_report',loadTrustedRecords:async()=>records,...overrides});
test('preverified identity and trusted records permit owner access',async()=>{
 const decision=await check(input());
 assert.deepEqual(decision,{allowed:true,reason:'same_business_tenant'});
 assert.equal(Object.isFrozen(decision),true);
});
test('rejects unverified claims without querying records',async()=>{
 let called=false;
 const decision=await check(input({verifiedClaims:{...claims,exp:1000},loadTrustedRecords:async()=>{called=true;return records;}}));
 assert.equal(decision.allowed,false);
 assert.equal(called,false);
});
test('fails closed on unavailable or ambiguous trusted records',async()=>{
 for(const loadTrustedRecords of [async()=>{throw Error('offline')},async()=>null,async()=>({...records,reports:[...records.reports,...records.reports]})]){
  assert.equal((await check(input({loadTrustedRecords}))).allowed,false);
 }
});
test('does not permit cross-tenant report access',async()=>{
 const loadTrustedRecords=async()=>({...records,reports:[{id:'report1',businessTenantId:'businessB',active:true}]});
 assert.equal((await check(input({loadTrustedRecords}))).allowed,false);
});

test('accounting firm requires approved, scoped, non-revoked consent end to end',async()=>{
 const {requestClientGrant,approveClientGrant,revokeClientGrant}=await import('../src/payrollcheck/client-consent.mjs');
 const requested=requestClientGrant({firmTenantId:'firmA',businessTenantId:'businessA',requestedBy:'admin1',scopes:['view_report']}).grant;
 const owner={userId:'owner1',tenantId:'businessA',role:'business_owner',active:true};
 const approved=approveClientGrant({grant:requested,actor:owner}).grant;
 const firmRecords=(grant)=>({
  memberships:[{userId:'user1',tenantId:'firmA',role:'accounting_reviewer',active:true}],
  reports:[{id:'report1',businessTenantId:'businessA',clientId:'clientA',active:true}],
  grants:[grant]
 });
 const call=(grant,action='view_report')=>check(input({action,loadTrustedRecords:async()=>firmRecords(grant)}));
 assert.equal((await call(requested)).allowed,false);
 assert.equal((await call(approved)).allowed,true);
 assert.equal((await call(approved,'review_finding')).allowed,false);
 assert.equal((await call(revokeClientGrant({grant:approved,actor:owner}).grant)).allowed,false);
});
test('does not allow unverified session or callback failure to grant access',async()=>{
 assert.equal((await check(input({verifiedClaims:{...claims,iss:'https://attacker.example'}}))).allowed,false);
 assert.equal((await check(input({loadTrustedRecords:async()=>{throw Error('db unavailable')}}))).allowed,false);
});

test('unsupported action never triggers trusted record query',async()=>{
 let called=false;
 const decision=await check(input({action:'delete_report',loadTrustedRecords:async()=>{called=true;return records;}}));
 assert.equal(decision.allowed,false);
 assert.equal(decision.reason,'unsupported_action');
 assert.equal(called,false);
});

test('rejects duplicate memberships and duplicate active firm grants',async()=>{
 const {requestClientGrant,approveClientGrant}=await import('../src/payrollcheck/client-consent.mjs');
 const pending=requestClientGrant({firmTenantId:'firmA',businessTenantId:'businessA',requestedBy:'admin1',scopes:['view_report']}).grant;
 const grant=approveClientGrant({grant:pending,actor:{userId:'owner1',tenantId:'businessA',role:'business_owner',active:true}}).grant;
 const membership={userId:'user1',tenantId:'firmA',role:'accounting_reviewer',active:true};
 const report={id:'report1',businessTenantId:'businessA',clientId:'clientA',active:true};
 for(const stored of [
  {memberships:[membership,membership],reports:[report],grants:[grant]},
  {memberships:[membership],reports:[report],grants:[grant,grant]},
  {memberships:[membership],reports:[report,report],grants:[grant]}
 ]){
  assert.equal((await check(input({loadTrustedRecords:async()=>stored}))).allowed,false);
 }
});
test('rejects malformed trusted record collections and unsupported roles',async()=>{
 for(const stored of [
  {...records,memberships:null},
  {...records,grants:null},
  {...records,memberships:[{userId:'user1',tenantId:'businessA',role:'unknown',active:true}]}
 ]){
  assert.equal((await check(input({loadTrustedRecords:async()=>stored}))).allowed,false);
 }
});

test('malformed role types fail closed without throwing',async()=>{
 for(const role of [42,{},[],true]){
  const decision=await check(input({loadTrustedRecords:async()=>({
   ...records,memberships:[{userId:'user1',tenantId:'businessA',role,active:true}]
  })}));
  assert.equal(decision.allowed,false);
  assert.equal(decision.reason,'unsupported_role');
 }
});

test('unexpected trusted record getter errors fail closed without exposing details',async()=>{
 const recordsWithThrowingGetter={
  get memberships(){throw Error('sensitive database diagnostic')},
  reports:records.reports,
  grants:records.grants
 };
 const decision=await check(input({loadTrustedRecords:async()=>recordsWithThrowingGetter}));
 assert.deepEqual(decision,{allowed:false,reason:'invalid_trusted_records'});
 assert.equal(Object.isFrozen(decision),true);
});
test('unexpected malformed membership entries fail closed rather than throwing',async()=>{
 const malformed={...records,memberships:[{userId:'user1',tenantId:'businessA',role:{startsWith(){throw Error('unsafe role')}},active:true}]};
 const decision=await check(input({loadTrustedRecords:async()=>malformed}));
 assert.equal(decision.allowed,false);
});
