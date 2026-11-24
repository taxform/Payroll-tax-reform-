import test from 'node:test';
import assert from 'node:assert/strict';
import {createSupabaseAuthChecks} from '../src/payrollcheck/supabase-auth-checks.mjs';
const uid='11111111-1111-4111-8111-111111111111';
const sid='22222222-2222-4222-8222-222222222222';
const user={id:uid,email_confirmed_at:'2026-01-01T00:00:00Z'};
const claims={sub:uid,session_id:sid,role:'authenticated',aal:'aal2',is_anonymous:false};
const factory=(u=user,c=claims)=>createSupabaseAuthChecks({auth:{
 getUser:async()=>({data:{user:u},error:null}),
 getClaims:async()=>({data:{claims:c},error:null})
}});
test('accepts trusted Supabase user and MFA claims for matching UUID',async()=>{
 const checks=factory();
 assert.deepEqual(await checks.getVerifiedUser('synthetic-token'),user);
 assert.equal(await checks.requireAal2('synthetic-token',uid),true);
});
test('rejects missing or mismatched identity and insufficient MFA',async()=>{
 for(const c of [{...claims,aal:'aal1'},{...claims,sub:sid},{...claims,session_id:null},{...claims,is_anonymous:true},{...claims,role:'anon'}])
  assert.equal(await factory(user,c).requireAal2('synthetic-token',uid),false);
 assert.equal(await factory(null).getVerifiedUser('synthetic-token'),null);
 assert.equal(await factory().requireAal2('',uid),false);
});
test('fails closed on provider errors and invalid client',async()=>{
 assert.throws(()=>createSupabaseAuthChecks({}),TypeError);
 const checks=createSupabaseAuthChecks({auth:{
  getUser:async()=>{throw Error('offline')},getClaims:async()=>{throw Error('offline')}
 }});
 assert.equal(await checks.getVerifiedUser('synthetic-token'),null);
 assert.equal(await checks.requireAal2('synthetic-token',uid),false);
});
