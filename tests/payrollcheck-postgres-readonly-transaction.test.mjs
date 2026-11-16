import test from 'node:test';
import assert from 'node:assert/strict';
import {withReadOnlyAuthorizationTransaction as transact} from '../src/payrollcheck/postgres-readonly-transaction.mjs';
const makePool=({failOn}={})=>{
 const statements=[];
 let released=0;
 const client={
  async query(sql,params){statements.push({sql,params});if(sql===failOn)throw Error('private DB error');return {rows:[]}},
  release(){released++}
 };
 return {pool:{connect:async()=>client},statements,get released(){return released}};
};
test('starts a read-only repeatable-read transaction and commits',async()=>{
 const fixture=makePool();
 const decision=await transact({pool:fixture.pool,operation:async({query})=>{await query('SELECT report_id FROM payrollcheck.reports WHERE report_id=$1',['r1']);return 'checked'}});
 assert.deepEqual(decision,{ok:true,result:'checked'});
 assert.deepEqual(fixture.statements.map(x=>x.sql),['BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY','SELECT report_id FROM payrollcheck.reports WHERE report_id=$1','COMMIT']);
 assert.equal(fixture.released,1);
});
test('rolls back and releases connection on failed operation',async()=>{
 const fixture=makePool();
 const decision=await transact({pool:fixture.pool,operation:async()=>{throw Error('sensitive detail')}});
 assert.deepEqual(decision,{ok:false,reason:'authorization_transaction_failed'});
 assert.deepEqual(fixture.statements.map(x=>x.sql),['BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY','ROLLBACK']);
 assert.equal(fixture.released,1);
});
test('handles begin failure without leaking client or attempting invalid rollback',async()=>{
 const fixture=makePool({failOn:'BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY'});
 const decision=await transact({pool:fixture.pool,operation:async()=>{throw Error('not reached')}});
 assert.equal(decision.ok,false);
 assert.deepEqual(fixture.statements.map(x=>x.sql),['BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY']);
 assert.equal(fixture.released,1);
});
test('rejects malformed transaction dependencies',async()=>{
 assert.deepEqual(await transact({}),{ok:false,reason:'invalid_transaction_config'});
 assert.deepEqual(await transact({pool:{connect:async()=>({query:async()=>{}})},operation:async()=>true}),{ok:false,reason:'invalid_database_client'});
});
