// Server-only Supabase Auth adapter scaffold. No SDK, network connection, or login UI.
// verifyAccessToken MUST independently verify JWT signature/JWKS, algorithm, issuer,
// audience and expiry server-side; never pass decoded browser claims directly.
// resolveInternalUserId MUST use trusted server-side identity mapping, not browser roles.
const uuid=x=>typeof x==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(x);
const id=x=>typeof x==='string'&&/^[A-Za-z0-9_-]{1,64}$/.test(x);
const deny=reason=>Object.freeze({ok:false,reason});
export async function verifySupabasePayrollSession({
 accessToken,verifyAccessToken,resolveInternalUserId,expectedIssuer,nowSeconds
}={}){
 if(typeof accessToken!=='string'||!accessToken||accessToken.length>16384||
 typeof verifyAccessToken!=='function'||typeof resolveInternalUserId!=='function'||
 typeof expectedIssuer!=='string'||!/^https:\/\/.+\/auth\/v1$/.test(expectedIssuer)||
 !Number.isSafeInteger(nowSeconds))return deny('invalid_auth_config');
 try{
  // Trusted verifier must reject untrusted JWT algorithms and enforce key rotation.
  const claims=await verifyAccessToken(accessToken,{issuer:expectedIssuer,audience:'authenticated'});
  if(!claims||typeof claims!=='object'||Array.isArray(claims)||
   claims.iss!==expectedIssuer||claims.aud!=='authenticated'||
   !uuid(claims.sub)||!uuid(claims.session_id)||
   claims.role!=='authenticated'||claims.aal!=='aal2'||
   !claims.email||claims.email_confirmed_at===null||claims.email_confirmed_at===undefined||
   !Number.isSafeInteger(claims.iat)||claims.iat>nowSeconds||
   !Number.isSafeInteger(claims.exp)||claims.exp<=nowSeconds||
   claims.exp<=claims.iat)return deny('invalid_or_insufficient_identity');
  const userId=await resolveInternalUserId(claims.sub);
  if(!id(userId))return deny('unknown_internal_identity');
  return Object.freeze({ok:true,session:Object.freeze({
   userId,sessionId:claims.session_id,verified:true,active:true,mfaVerified:true
  })});
 }catch{return deny('identity_verification_failed')}
}
