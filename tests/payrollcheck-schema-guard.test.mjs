import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const sql=readFileSync(new URL('../docs/sql/payrollcheck-deny-by-default-schema.sql',import.meta.url),'utf8');
const tables=['tenants','memberships','reports','client_grants','access_audit'];
test('draft schema enables and forces row-level security on every table',()=>{
 for(const table of tables){
  assert.match(sql,new RegExp('ALTER TABLE payrollcheck\\.'+table+' ENABLE ROW LEVEL SECURITY;'));
  assert.match(sql,new RegExp('ALTER TABLE payrollcheck\\.'+table+' FORCE ROW LEVEL SECURITY;'));
 }
});
test('draft schema intentionally has no access policies or grants',()=>{
 assert.doesNotMatch(sql,/^\s*CREATE\s+POLICY\b/im);
 assert.doesNotMatch(sql,/^\s*GRANT\s+/im);
 assert.doesNotMatch(sql,/^\s*ALTER\s+ROLE\b/im);
});
test('draft has tenant and consent state constraints',()=>{
 assert.match(sql,/firm_tenant_id <> business_tenant_id/);
 assert.match(sql,/status='pending'/);
 assert.match(sql,/status='active'/);
 assert.match(sql,/status='revoked'/);
 assert.match(sql,/REFERENCES payrollcheck\.tenants\(tenant_id\)/);
});

test('draft schema captures report client identity and scoped consent',()=>{
 assert.match(sql,/client_id text NOT NULL CHECK/);
 assert.match(sql,/scopes text\[\] NOT NULL CHECK/);
 assert.match(sql,/scopes <@ ARRAY\['view_report','review_finding'\]/);
 assert.match(sql,/array_position\(scopes,NULL\) IS NULL/);
 assert.match(sql,/CREATE UNIQUE INDEX client_grants_one_active_per_pair/);
 assert.match(sql,/WHERE status='active'/);
});
