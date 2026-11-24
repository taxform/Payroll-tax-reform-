// Pure, non-cryptographic validation of already-verified identity-provider claims.
// This does NOT cryptographically verify JWT signatures, issuer keys or MFA itself.
// Only pass claims after a trusted OIDC middleware verifies the signed token.
const id=x=>typeof x==='string'&&/^[A-Za-z0-9_-]{1,64}$/.test(x);
const nonempty=x=>typeof x==='string'&&x.length>0&&x.length<=255;
export function mapVerifiedIdentity({claims,expectedIssuer,expectedAudience,nowSeconds}={}){
 if(!claims||typeof claims!=='object'||Array.isArray(claims)||!nonempty(expectedIssuer)||!nonempty(expectedAudience)||!Number.isSafeInteger(nowSeconds)||nowSeconds<0)return null;
 if(claims.iss!==expectedIssuer||!((typeof claims.aud==='string'&&claims.aud===expectedAudience)||(Array.isArray(claims.aud)&&claims.aud.length>0&&claims.aud.every(nonempty)&&new Set(claims.aud).size===claims.aud.length&&claims.aud.includes(expectedAudience))))return null;
 if(!id(claims.sub)||!id(claims.sid)||!Number.isSafeInteger(claims.exp)||claims.exp<=nowSeconds||!Number.isSafeInteger(claims.iat)||claims.iat>nowSeconds||claims.iat<0||claims.exp<=claims.iat||claims.nbf!==undefined&&(!Number.isSafeInteger(claims.nbf)||claims.nbf>nowSeconds||claims.nbf<0))return null;
 if(Array.isArray(claims.aud)&&(claims.aud.length>1||claims.azp!==undefined)&&claims.azp!==expectedAudience)return null;
 if(claims.email_verified===false||claims.active===false||claims.auth_time!==undefined&&(!Number.isSafeInteger(claims.auth_time)||claims.auth_time<0||claims.auth_time>nowSeconds))return null;
 return Object.freeze({userId:claims.sub,sessionId:claims.sid,verified:true,active:true});
}
