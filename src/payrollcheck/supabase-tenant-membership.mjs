// Server-only: read membership by independently verified Supabase user UUID.
// Caller must supply a non-BYPASSRLS database connection with approved RLS policies.
// This is an isolated query adapter, not a working login endpoint or authorization grant.
const uuid=x=>typeof x==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(x);
const deny=reason=>Object.freeze({ok:false,reason});
export async function loadVerifiedTenantMembership({query,authUserId,tenantId}={}){
 if(typeof query!=='function'||!uuid(authUserId)||!uuid(tenantId))return deny('invalid_request');
 try{
  const result=await query(
   'SELECT membership_id,tenant_id,auth_user_id,role,active FROM payrollcheck.memberships WHERE auth_user_id=$1::uuid AND tenant_id=$2::uuid LIMIT 2',
   [authUserId,tenantId]
  );
  if(!result||!Array.isArray(result.rows)||result.rows.length!==1)return deny('membership_not_unique_or_missing');
  const m=result.rows[0];
  if(!m||m.auth_user_id!==authUserId||m.tenant_id!==tenantId||
   !uuid(m.membership_id)||m.active!==true||
   !['business_owner','accounting_admin','accounting_reviewer'].includes(m.role))
   return deny('invalid_membership');
  return Object.freeze({ok:true,membership:Object.freeze({
   membershipId:m.membership_id,tenantId,authUserId,role:m.role
  })});
 }catch{return deny('membership_lookup_failed')}
}
