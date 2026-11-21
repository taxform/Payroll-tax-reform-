import test from 'node:test';
import assert from 'node:assert/strict';
import {validateSupabaseDevelopmentConfig as validate} from '../src/payrollcheck/supabase-development-config.mjs';
test('accepts a development project origin without enabling production',()=>{
 assert.deepEqual(validate({projectUrl:'https://demo-project.supabase.co/',environment:'development'}),{
  ok:true,issuer:'https://demo-project.supabase.co/auth/v1',
  projectOrigin:'https://demo-project.supabase.co',productionEnabled:false
 });
});
test('rejects production, unsafe and malformed URLs',()=>{
 for(const patch of [
  {environment:'production'},{allowProduction:true},
  {projectUrl:'http://demo-project.supabase.co/'},
  {projectUrl:'https://demo-project.supabase.co.evil.test/'},
  {projectUrl:'https://user:password@demo-project.supabase.co/'},
  {projectUrl:'https://demo-project.supabase.co/auth/v1'},
  {projectUrl:'https://demo-project.supabase.co/?token=secret'},
  {projectUrl:'https://demo--project.supabase.co/'}
 ])assert.equal(validate({projectUrl:'https://demo-project.supabase.co/',environment:'development',...patch}).ok,false);
});
