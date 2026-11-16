import test from 'node:test';
import assert from 'node:assert/strict';
import {checkPostgresBackedReportAccess as check} from '../src/payrollcheck/postgres-authenticated-report-access.mjs';
const reportUuid='11111111-1111-4111-8111-111111111111';
const businessUuid='22222222-2222-4222-8222-222222222222';
const firmUuid='33333333-3333-4333-8333-333333333333';
const claims={iss:'https://issuer.example',aud:'payrollcheck-api',sub:'reviewer1',sid:'session1',iat:1000,exp:2000};
const identityConfig={issuer:claims.iss,audience:claims.aud,nowSeconds:1500};
const fake=({grants=true,fail=false}={})=>{
 const statements=[];let released=0,connected=0;
 const client={
  async query(sql,params){
   statements.push({sql,params});
   if(fail&&sql.includes('payrollcheck.reports'))throw Error('private DB error');
   if(sql.includes('payrollcheck.reports'))return {rows:[{report_id:reportUuid,business_tenant_id:businessUuid,client_id:'clientA',status:'preview_only'}]};
   if(sql.includes('payrollcheck.memberships'))return {rows:[{subject_id:'reviewer1',tenant_id:firmUuid,role:'accounting_reviewer',active:true}]};
   if(sql.includes('payrollcheck.client_grants'))return {rows:grants?[{firm_tenant_id:firmUuid,business_tenant_id:businessUuid,scopes:['view_report'],status:'active',requested_by_subject:'admin1',approved_by_subject:'owner1',revoked_by_subject:null}]:[]};
   return {rows:[]};
  },
  release(){released++}
 };
 return {pool:{async connect(){connected++;return client}},statements,get connected(){return connected},get released(){return released}};
};
const input=(fixture,overrides={})=>({
 verifiedClaims:claims,identityConfig,reportId:'report1',action:'view_report',
 pool:fixture.pool,resolveReportUuid:async()=>reportUuid,
 resolveTenantId:async uuid=>uuid===businessUuid?'businessA':uuid===firmUuid?'firmA':null,
 ...overrides
});
test('successful firm authorization uses read-only transaction and releases connection',async()=>{
 const fixture=fake();
 const decision=await check(input(fixture));
 assert.deepEqual(decision,{allowed:true,reason:'explicit_active_client_grant'});
 assert.deepEqual(fixture.statements.map(x=>x.sql).filter(s=>s==='COMMIT'||s.startsWith('BEGIN')),['BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY','COMMIT']);
 assert.equal(fixture.released,1);
});
test('invalid identity does not acquire a database connection',async()=>{
 const fixture=fake();
 assert.equal((await check(input(fixture,{verifiedClaims:{...claims,exp:1400}}))).allowed,false);
 assert.equal(fixture.connected,0);
});
test('missing consent is denied after transaction cleanup',async()=>{
 const fixture=fake({grants:false});
 assert.equal((await check(input(fixture))).allowed,false);
 assert.equal(fixture.released,1);
});
test('SQL failure rolls back and denies without exposing database exception',async()=>{
 const fixture=fake({fail:true});
 assert.deepEqual(await check(input(fixture)),{allowed:false,reason:'trusted_record_lookup_failed'});
 assert.equal(fixture.statements.at(-1).sql,'ROLLBACK');
 assert.equal(fixture.released,1);
});
