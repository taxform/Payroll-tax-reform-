import test from 'node:test';
import assert from 'node:assert/strict';
import {verifySupabasePayrollSession as verify} from '../src/payrollcheck/supabase-identity-boundary.mjs';
const claims={iss:'https://example.supabase.co/auth/v1',aud:'authenticated',sub:'11111111-1111-4111-8111-111111111111',session_id:'22222222-2222-4222-8222-222222222222',role:'authenticated',aal:'aal2',email:'owner@example.test',iat:1000,exp:2000};
const setup=(overrides={})=>({
 accessToken:'synthetic-test-token',
 verifyAccessToken:async()=>claims,
 resolveInternalUserId:async()=> 'owner1',
 verifyEmailConfirmed:async()=>true,
 expectedIssuer:claims.iss,nowSeconds:1500,...overrides
});
test('accepts verified MFA session and maps UUID to internal user',async()=>{
 const r=await verify(setup());
 assert.equal(r.ok,true);
 assert.equal(r.session.userId,'owner1');
 assert.equal(r.session.mfaVerified,true);
});
test('rejects absent MFA, expired token, wrong issuer and forged role',async()=>{
 for(const patch of [{aal:'aal1'},{exp:1500},{iss:'https://other.supabase.co/auth/v1'},{role:'service_role'},{sub:'fake'}]){
  assert.equal((await verify(setup({verifyAccessToken:async()=>({...claims,...patch})}))).ok,false);
 }
});
test('requires confirmed email and trusted identity mapping',async()=>{
 assert.deepEqual(await verify(setup({verifyEmailConfirmed:async()=>false})),{ok:false,reason:'unconfirmed_email'});
 assert.deepEqual(await verify(setup({resolveInternalUserId:async()=>null})),{ok:false,reason:'unknown_internal_identity'});
});
test('rejects failed signature verification and invalid configuration',async()=>{
 assert.deepEqual(await verify(setup({verifyAccessToken:async()=>{throw Error('bad signature')}})),{ok:false,reason:'identity_verification_failed'});
 assert.equal((await verify(setup({verifyAccessToken:null}))).ok,false);
});
