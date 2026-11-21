import test from 'node:test';import assert from 'node:assert/strict';import {authorizePayrollAction as check} from '../src/payrollcheck/tenant-access.mjs';
const owner={userId:'u1',tenantId:'businessA',role:'business_owner',active:true};
const resource={tenantId:'businessA',clientId:'clientA',active:true};
const reviewer={userId:'u2',tenantId:'firm1',firmId:'firm1',role:'accounting_reviewer',active:true};
const grant={firmId:'firm1',clientId:'clientA',tenantId:'businessA',active:true,approved:true};
test('owner can read own business only',()=>{assert.equal(check({actor:owner,resource,action:'view_report',grants:[]}).allowed,true);assert.equal(check({actor:owner,resource:{...resource,tenantId:'businessB'},action:'view_report',grants:[]}).allowed,false)});
test('accounting reviewer requires explicit matching grant',()=>{assert.equal(check({actor:reviewer,resource,action:'view_report',grants:[grant]}).allowed,true);for(const g of [[],[{...grant,approved:false}],[{...grant,clientId:'other'}],[grant,grant]])assert.equal(check({actor:reviewer,resource,action:'view_report',grants:g}).allowed,false)});
test('reviewer cannot manage client access',()=>assert.equal(check({actor:reviewer,resource,action:'manage_client_access',grants:[grant]}).allowed,false));
test('inactive users, unknown actions and missing identity fail closed',()=>{for(const a of [{...owner,active:false},{...owner,userId:''},{...owner,role:'superadmin'}])assert.equal(check({actor:a,resource,action:'view_report',grants:[]}).allowed,false);assert.equal(check({actor:owner,resource,action:'delete_payroll',grants:[]}).allowed,false)});
