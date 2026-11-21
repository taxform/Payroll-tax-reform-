import test from 'node:test';
import assert from 'node:assert/strict';
import {checkAuthenticatedReportAccess as check} from '../src/payrollcheck/authenticated-report-boundary.mjs';
import {loadReportAuthorizationRecords as load} from '../src/payrollcheck/postgres-report-loader.mjs';

// Entirely fabricated SQL rows and preverified-claims fixture; no live DB or token verification.
const reportUuid='11111111-1111-4111-8111-111111111111';
const businessUuid='22222222-2222-4222-8222-222222222222';
const firmUuid='33333333-3333-4333-8333-333333333333';
const claims={iss:'https://issuer.example',aud:'payrollcheck-api',sub:'reviewer1',sid:'session1',iat:1000,exp:2000};
const identityConfig={issuer:claims.iss,audience:claims.aud,nowSeconds:1500};
const report={report_id:reportUuid,business_tenant_id:businessUuid,client_id:'clientA',status:'preview_only'};
const membership={subject_id:'reviewer1',tenant_id:firmUuid,role:'accounting_reviewer',active:true};
const grant={firm_tenant_id:firmUuid,business_tenant_id:businessUuid,scopes:['view_report'],status:'active',requested_by_subject:'admin1',approved_by_subject:'owner1',revoked_by_subject:null};
const makeQuery=({reportRow=report,membershipRows=[membership],grantRows=[grant]}={})=>async sql=>{
 if(sql.includes('payrollcheck.reports'))return {rows:reportRow?[reportRow]:[]};
 if(sql.includes('payrollcheck.memberships'))return {rows:membershipRows};
 if(sql.includes('payrollcheck.client_grants'))return {rows:grantRows};
 throw Error('unexpected query');
};
const invoke=({query=makeQuery(),verifiedClaims=claims,action='view_report'}={})=>check({
 verifiedClaims,identityConfig,reportId:'report1',action,
 loadTrustedRecords:({userId,reportId})=>load({
  query,userId,reportId,
  resolveReportUuid:async()=>reportUuid,
  resolveTenantId:async u=>u===businessUuid?'businessA':u===firmUuid?'firmA':null
 })
});
test('fabricated SQL firm grant flows through authenticated authorization boundary',async()=>{
 const decision=await invoke();
 assert.deepEqual(decision,{allowed:true,reason:'explicit_active_client_grant'});
});
test('firm cannot use an ungranted action or a revoked grant',async()=>{
 assert.equal((await invoke({action:'review_finding'})).allowed,false);
 assert.equal((await invoke({query:makeQuery({grantRows:[]})})).allowed,false);
});
test('cross-tenant and missing membership are denied',async()=>{
 assert.equal((await invoke({query:makeQuery({membershipRows:[]})})).allowed,false);
 assert.equal((await invoke({query:makeQuery({membershipRows:[{...membership,tenant_id:businessUuid}]})})).allowed,false);
});
test('unverified claims stop before any SQL lookup',async()=>{
 let called=false;
 const decision=await invoke({verifiedClaims:{...claims,exp:1499},query:async()=>{called=true;throw Error('must not query')}});
 assert.equal(decision.allowed,false);
 assert.equal(called,false);
});
test('query failures are denied without exposing database errors',async()=>{
 const decision=await invoke({query:async()=>{throw Error('private connection details')}});
 assert.deepEqual(decision,{allowed:false,reason:'trusted_record_lookup_failed'});
});
