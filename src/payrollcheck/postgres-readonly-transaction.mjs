// Server-only transaction boundary prototype. Does not create a database connection.
// Caller supplies a trusted pool.connect() and a transaction-scoped operation.
// RLS remains deny-by-default in the unapplied SQL draft.
const deny=reason=>Object.freeze({ok:false,reason});
export async function withReadOnlyAuthorizationTransaction({pool,operation}={}){
 if(!pool||typeof pool.connect!=='function'||typeof operation!=='function')return deny('invalid_transaction_config');
 let client,started=false;
 try{
  client=await pool.connect();
  if(!client||typeof client.query!=='function'||typeof client.release!=='function')return deny('invalid_database_client');
  await client.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
  started=true;
  const result=await operation({query:(sql,params)=>client.query(sql,params)});
  await client.query('COMMIT');
  started=false;
  return Object.freeze({ok:true,result});
 }catch{
  if(started){try{await client.query('ROLLBACK')}catch{}}
  return deny('authorization_transaction_failed');
 }finally{
  if(client&&typeof client.release==='function'){try{client.release()}catch{}}
 }
}
