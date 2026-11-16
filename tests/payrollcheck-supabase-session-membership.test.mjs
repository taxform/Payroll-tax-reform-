import test from 'node:test';
import assert from 'node:assert/strict';
import {authorizeSupabaseTenantSession as authorize} from '../src/payrollcheck/supabase-session-membership.mjs';
const userId='11111111-1111-4111-8111-111111111111';
const tenantId='22222222-2222-4222-8222-222222222222';
const membershipId='33333333-3333-4333-8333-333333333333';
const user={id:userId,email_confirmed_at:'2026-01-01T00:00:00Z',is_anonymous:false};
const row={membership_id:membershipId,tenant_id:tenantId,auth_user_id:userId,role:'business_owner',active:true};
const base=()=>({accessToken:'synthetic-token',tenantId,getVerifiedUser:async()=>user,requireAal2:async()=>true,query:async()=>({rows:[row]})});
test('requires verified user, MFA and tenant membership',async()=>{
 const r=await authorize(base());
 assert.equal(r.ok,true,JSON.stringify(r));assert.equal(r.principal.tenantId,tenantId);
 assert.equal(r.principal.authUserId,userId);
});
test('denies absent verified user, anonymous, unconfirmed, MFA failure',async()=>{
 for(const u of [null,{...user,email_confirmed_at:null},{...user,is_anonymous:true},{...user,id:'bad'}]){
  assert.equal((await authorize({...base(),getVerifiedUser:async()=>u})).ok,false);
 }
 assert.equal((await authorize({...base(),requireAal2:async()=>false})).ok,false);
});
test('denies wrong tenant, inactive membership, duplicate rows and errors',async()=>{
 for(const rows of [[],[{...row,tenant_id:userId}],[{...row,active:false}],[row,row]]){
  assert.equal((await authorize({...base(),query:async()=>({rows})})).ok,false);
 }
 assert.equal((await authorize({...base(),getVerifiedUser:async()=>{throw Error('auth unavailable')}})).ok,false);
 assert.equal((await authorize({...base(),accessToken:''})).ok,false);
});
