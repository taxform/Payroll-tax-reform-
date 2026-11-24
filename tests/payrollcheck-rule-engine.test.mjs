import test from 'node:test';
import assert from 'node:assert/strict';
import {STATES,CATEGORIES,validateRule,selectRules} from '../src/payrollcheck/rule-engine.mjs';
const base={id:'TEST-ONLY',jurisdiction:'NY',category:'income_withholding',sourceUrl:'https://example.gov/rule',sourcePublished:'2026-01-01',effectiveFrom:'2026-01-01',effectiveTo:null,reviewedAt:'2026-01-02',reviewer:'Example reviewer',status:'validated',applicability:'Test only; not a legal rule',exceptions:'Test only; unknown',testCaseIds:['EXAMPLE-1']};
test('exactly 50 unique states in scope',()=>{assert.equal(STATES.length,50);assert.equal(new Set(STATES).size,50)});
test('empty catalog never claims compliance for any state/category',()=>{
 for(const state of STATES)for(const category of CATEGORIES)assert.equal(selectRules({state,category,onDate:'2026-11-15'}).status,'unable_to_determine');
});
test('draft rules cannot be used',()=>assert.equal(selectRules({state:'NY',category:base.category,onDate:'2026-11-15',rules:[{...base,status:'draft'}]}).status,'unable_to_determine'));
test('validated metadata is not a compliance pass',()=>{
 const r=selectRules({state:'NY',category:base.category,onDate:'2026-11-15',rules:[base]});
 assert.equal(r.status,'rule_available');assert.match(r.reason,/applicability still requires evaluation/);
});
test('out of date and future rules are unavailable',()=>{
 for(const date of ['2025-12-31','2027-01-01'])assert.equal(selectRules({state:'NY',category:base.category,onDate:date,rules:[{...base,effectiveTo:'2026-12-31'}]}).status,'unable_to_determine');
});
test('overlapping validated rules fail closed',()=>assert.equal(selectRules({state:'NY',category:base.category,onDate:'2026-11-15',rules:[base,{...base,id:'OTHER'}]}).status,'unable_to_determine'));
test('missing provenance, invalid dates and unreviewed rules rejected',()=>{
 assert.ok(validateRule({...base,sourceUrl:'http://example.com'}).length);
 assert.ok(validateRule({...base,effectiveFrom:'2026-02-30'}).length);
 assert.ok(validateRule({...base,reviewer:''}).length);
});
