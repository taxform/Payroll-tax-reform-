// Server-only session-to-membership adapter. No network or Supabase client instantiated.
// getVerifiedUser must call Supabase Auth getUser(accessToken) on the server,
// not getSession(), getClaims() without signature validation, or decoded JWT payload.
// requireAal2 must independently verify the authenticated session's MFA assurance.
// Database query must run with reviewed tenant-scoped RLS, never service_role/BYPASSRLS.
import {loadVerifiedTenantMembership} from './supabase-tenant-membership.mjs';
const uuid=x=>typeof x==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(x);
const deny=reason=>Object.freeze({ok:false,reason});
export async function authorizeSupabaseTenantSession({
 accessToken,tenantId,getVerifiedUser,requireAal2,query
}={}){
 if(typeof accessToken!=='string'||accessToken.length<1||accessToken.length>16384||
 !uuid(tenantId)||typeof getVerifiedUser!=='function'||
 typeof requireAal2!=='function'||typeof query!=='function')return deny('invalid_request');
 try{
  const user=await getVerifiedUser(accessToken);
  if(!user||!uuid(user.id)||!user.email_confirmed_at||
   user.is_anonymous===true)return deny('unverified_user');
  // MFA must be established from independently verified session claims.
  if(await requireAal2(accessToken,user.id)!==true)return deny('mfa_required');
  const membership=await loadVerifiedTenantMembership({query,authUserId:user.id,tenantId});
  if(!membership.ok)return deny('membership_denied');
  return Object.freeze({ok:true,principal:Object.freeze({
   authUserId:user.id,tenantId,role:membership.membership.role,
   membershipId:membership.membership.membershipId
  })});
 }catch{return deny('authentication_failed')}
}
