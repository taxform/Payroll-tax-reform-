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
