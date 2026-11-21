import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const html=readFileSync('public/payrollcheck/connect/index.html','utf8');
test('connection preview clearly states no live integration or billing',()=>{assert.match(html,/noindex,nofollow/);assert.match(html,/not available for purchase/);assert.match(html,/connection is not available yet/);assert.match(html,/Use only fabricated sample data/);});
test('sample preview has no remote form, token storage or automatic payment',()=>{assert.doesNotMatch(html,/<form\b|localStorage|sessionStorage|fetch\(|XMLHttpRequest|Stripe\(/i);assert.match(html,/type="file"/);assert.match(html,/64 KB maximum/);});
