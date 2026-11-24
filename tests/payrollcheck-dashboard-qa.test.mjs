import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import {buildXrayReport} from '../src/payrollcheck/xray-report.mjs';
const fixtures=JSON.parse(readFileSync('public/payrollcheck/xray-fixtures.json','utf8')).clients;
test('visible review metrics agree with engine-generated fixture priorities',()=>{
 const reports=fixtures.map(c=>buildXrayReport(c.previous,c.current));
 const business=readFileSync('public/payrollcheck/business/index.html','utf8');
 const firm=readFileSync('public/payrollcheck/accounting/index.html','utf8');
 assert.match(business,new RegExp('Potential issues</div><div class="metric">'+reports[0].summary.needsReview+'</div>'));
 assert.match(firm,new RegExp('Open review items</div><div class="metric">'+reports.reduce((n,r)=>n+r.summary.needsReview,0)+'</div>'));
 for(let i=0;i<fixtures.length;i++)assert.match(firm,new RegExp(fixtures[i].name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));
});
test('dashboard previews have keyboard focus, responsive layout and a footer after sample',()=>{
 const css=readFileSync('public/payrollcheck/dashboard.css','utf8');
 assert.match(css,/:focus-visible/);assert.match(css,/@media\(max-width:480px\)/);assert.match(css,/prefers-reduced-motion/);
 for(const role of ['business','accounting']){
  const html=readFileSync('public/payrollcheck/'+role+'/index.html','utf8');
  assert.ok(html.indexOf('data-xray-demo')<html.indexOf('<footer>'));
  assert.match(html,/name="viewport"/);assert.match(html,/noindex,nofollow/);
 }
});
test('browser fixture preview shows loading and failure text without real data submission',()=>{
 const js=readFileSync('public/payrollcheck/xray-demo.mjs','utf8');
 assert.match(js,/Loading sample data/);assert.match(js,/temporarily unavailable/);assert.match(js,/credentials:'omit'/);
 assert.doesNotMatch(js,/innerHTML|localStorage|sessionStorage|sendBeacon/);
});
