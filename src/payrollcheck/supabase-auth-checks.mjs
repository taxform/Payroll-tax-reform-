// Server-side Supabase Auth verifier factory. Requires an injected trusted Supabase client.
// The caller must configure a dedicated server client and must not use user-provided URL/keys.
// getUser(token) contacts Supabase Auth to verify the bearer token; getClaims(token)
// must verify the JWT signature (or use Supabase Auth validation where applicable).
// Both independently must agree on the same user ID. No browser-trusted claims.
const uuid=x=>typeof x==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(x);
export function createSupabaseAuthChecks(client){
 if(!client||typeof client.auth?.getUser!=='function'||typeof client.auth?.getClaims!=='function')
  throw new TypeError('trusted_supabase_client_required');
 const getVerifiedUser=async token=>{
  if(typeof token!=='string'||!token||token.length>16384)return null;
  try{
   const {data,error}=await client.auth.getUser(token);
   if(error||!data?.user||!uuid(data.user.id))return null;
   return data.user;
  }catch{return null}
 };
 const requireAal2=async(token,expectedUserId)=>{
  if(typeof token!=='string'||!token||token.length>16384||!uuid(expectedUserId))return false;
  try{
   const {data,error}=await client.auth.getClaims(token);
   if(error||!data?.claims)return false;
   const c=data.claims;
   return c.sub===expectedUserId&&c.role==='authenticated'&&
    c.aal==='aal2'&&c.is_anonymous!==true&&uuid(c.session_id);
  }catch{return false}
 };
 return Object.freeze({getVerifiedUser,requireAal2});
}
