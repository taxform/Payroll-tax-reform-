import test from 'node:test';
import assert from 'node:assert/strict';
import {requestClientGrant,approveClientGrant,revokeClientGrant,grantAllows} from '../src/payrollcheck/client-consent.mjs';
const owner={userId:'owner1',tenantId:'business1',role:'business_owner',active:true};
const admin={userId:'admin1',tenantId:'firm1',role:'accounting_admin',active:true};
const reviewer={userId:'reviewer1',tenantId:'firm1',role:'accounting_reviewer',active:true};
const request=()=>requestClientGrant({firmTenantId:'firm1',businessTenantId:'business1',requestedBy:'admin1',scopes:['view_report']});
test('grant starts pending and requires explicit business approval',()=>{
 const pending=request();assert.equal(pending.ok,true);
 assert.equal(grantAllows({grant:pending.grant,firmTenantId:'firm1',businessTenantId:'business1',action:'view_report'}),false);
 assert.equal(approveClientGrant({grant:pending.grant,actor:reviewer}).ok,false);
 assert.equal(approveClientGrant({grant:pending.grant,actor:{...owner,tenantId:'other'}}).ok,false);
 const active=approveClientGrant({grant:pending.grant,actor:owner});assert.equal(active.ok,true);
 assert.equal(grantAllows({grant:active.grant,firmTenantId:'firm1',businessTenantId:'business1',action:'view_report'}),true);
 assert.equal(grantAllows({grant:active.grant,firmTenantId:'firm1',businessTenantId:'business1',action:'review_finding'}),false);
 assert.equal(grantAllows({grant:active.grant,firmTenantId:'firm2',businessTenantId:'business1',action:'view_report'}),false);
 assert.equal(approveClientGrant({grant:active.grant,actor:owner}).ok,false);
});
test('revocation immediately invalidates authorization and cannot be reversed by approval',()=>{
 const active=approveClientGrant({grant:request().grant,actor:owner}).grant;
 assert.equal(revokeClientGrant({grant:active,actor:reviewer}).ok,false);
 const revoked=revokeClientGrant({grant:active,actor:admin});assert.equal(revoked.ok,true);
 assert.equal(grantAllows({grant:revoked.grant,firmTenantId:'firm1',businessTenantId:'business1',action:'view_report'}),false);
 assert.equal(approveClientGrant({grant:revoked.grant,actor:owner}).ok,false);
 assert.equal(revokeClientGrant({grant:revoked.grant,actor:owner}).ok,false);
});
test('malformed grants, invalid scopes, impersonation and inactive actors fail closed',()=>{
 for(const scopes of [[],['view_report','view_report'],['export_everything']])assert.equal(requestClientGrant({firmTenantId:'firm1',businessTenantId:'business1',requestedBy:'admin1',scopes}).ok,false);
 assert.equal(requestClientGrant({firmTenantId:'firm1',businessTenantId:'firm1',requestedBy:'admin1',scopes:['view_report']}).ok,false);
 assert.equal(approveClientGrant({grant:request().grant,actor:{...owner,active:false}}).ok,false);
 assert.equal(grantAllows({grant:{...request().grant,status:'active',scopes:['delete']},firmTenantId:'firm1',businessTenantId:'business1',action:'delete'}),false);
});
