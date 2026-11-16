import test from 'node:test';
import assert from 'node:assert/strict';
import {loadReportAuthorizationRecords as load} from '../src/payrollcheck/postgres-report-loader.mjs';
const reportUuid='11111111-1111-4111-8111-111111111111';
const businessUuid='22222222-2222-4222-8222-222222222222';
const firmUuid='33333333-3333-4333-8333-333333333333';
const queries=[];
const query=async(sql,params)=>{
 queries.push({sql,params});
 if(sql.includes('payrollcheck.reports'))return {rows:[{report_id:reportUuid,business_tenant_id:businessUuid,client_id:'clientA',status:'preview_only'}]};
 if(sql.includes('payrollcheck.memberships'))return {rows:[{subject_id:'user1',tenant_id:firmUuid,role:'accounting_reviewer',active:true}]};
 return {rows:[{firm_tenant_id:firmUuid,business_tenant_id:businessUuid,scopes:['view_report'],status:'active',requested_by_subject:'admin1',approved_by_subject:'owner1',revoked_by_subject:null}]};
};
const options=()=>({query,userId:'user1',reportId:'report1',resolveReportUuid:async()=>reportUuid,resolveTenantId:async u=>u===businessUuid?'businessA':u===firmUuid?'firmA':null});
test('uses parameterized SQL and trusted UUID mappings for complete consent record',async()=>{
 queries.length=0;
 const result=await load(options());
 assert.equal(queries.length,3);
 assert.deepEqual(queries[0].params,[reportUuid]);
 assert.deepEqual(queries[1].params,['user1']);
 assert.deepEqual(queries[2].params,[businessUuid]);
 assert.deepEqual(result.grants[0],{firmTenantId:'firmA',businessTenantId:'businessA',scopes:['view_report'],status:'active',requestedBy:'admin1',approvedBy:'owner1',revokedBy:null});
 assert.equal(result.reports[0].businessTenantId,'businessA');
});
test('rejects missing mapping, invalid identifiers, and oversized query results',async()=>{
 await assert.rejects(()=>load({...options(),resolveTenantId:async()=>null}),/invalid_tenant_mapping/);
 await assert.rejects(()=>load({...options(),userId:'bad;DROP TABLE'}),/invalid_loader_config/);
 await assert.rejects(()=>load({...options(),query:async()=>({rows:Array(502).fill({})})}),/invalid_query_result/);
});
test('does not query memberships or grants for absent reports',async()=>{
 let count=0;
 const result=await load({...options(),query:async()=>{count++;return {rows:[]}}});
 assert.equal(count,1);
 assert.deepEqual(result,{memberships:[],reports:[],grants:[]});
});
