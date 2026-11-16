import test from 'node:test';
import assert from 'node:assert/strict';
import {loadVerifiedTenantMembership as load} from '../src/payrollcheck/supabase-tenant-membership.mjs';
const uid='11111111-1111-4111-8111-111111111111';
const tid='22222222-2222-4222-8222-222222222222';
const mid='33333333-3333-4333-8333-333333333333';
const membership={membership_id:mid,tenant_id:tid,auth_user_id:uid,role:'business_owner',active:true};
const args=(query)=>({query,authUserId:uid,tenantId:tid});
test('uses parameterized tenant and verified identity filters',async()=>{
 let seen;
 const result=await load(args(async(sql,values)=>{seen={sql,values};return {rows:[membership]}}));
 assert.equal(result.ok,true);
 assert.deepEqual(seen.values,[uid,tid]);
 assert.match(seen.sql,/auth_user_id=\$1::uuid AND tenant_id=\$2::uuid/);
});
test('fails closed for missing, duplicate, inactive, mismatched and malformed memberships',async()=>{
 for(const rows of [[],[membership,membership],[{...membership,active:false}],[{...membership,tenant_id:uid}],[{...membership,role:'admin'}],[{...membership,membership_id:'bad'}]]){
  assert.equal((await load(args(async()=>({rows})))).ok,false);
 }
});
test('rejects malformed inputs and database failures',async()=>{
 assert.equal((await load({query:async()=>({rows:[membership]}),authUserId:'bad',tenantId:tid})).ok,false);
 assert.deepEqual(await load(args(async()=>{throw Error('database down')})),{ok:false,reason:'membership_lookup_failed'});
});
