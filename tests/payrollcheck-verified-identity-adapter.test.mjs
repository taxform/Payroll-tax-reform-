import test from 'node:test';
import assert from 'node:assert/strict';
import {mapVerifiedIdentity as map} from '../src/payrollcheck/verified-identity-adapter.mjs';
const claims={iss:'https://issuer.example',aud:'payrollcheck-api',sub:'user1',sid:'session1',exp:2000,iat:1000};
const input=(overrides={})=>({claims,expectedIssuer:claims.iss,expectedAudience:claims.aud,nowSeconds:1500,...overrides});
test('maps preverified claims to minimal authorization session',()=>{
 assert.deepEqual(map(input()),{userId:'user1',sessionId:'session1',verified:true,active:true});
 assert.equal(Object.isFrozen(map(input())),true);
});
test('rejects issuer, audience, expiry, future issuance and malformed identity',()=>{
 for(const patch of [{iss:'https://wrong.example'},{aud:'other'},{exp:1500},{iat:1600},{sub:'email@example.com'},{sid:''},{active:false},{email_verified:false}])assert.equal(map(input({claims:{...claims,...patch}})),null);
 assert.equal(map(input({nowSeconds:NaN})),null);
});
test('multiple audiences require explicit authorized party',()=>{
 assert.equal(map(input({claims:{...claims,aud:['payrollcheck-api','other']}})),null);
 assert.ok(map(input({claims:{...claims,aud:['payrollcheck-api','other'],azp:'payrollcheck-api'}})));
});
