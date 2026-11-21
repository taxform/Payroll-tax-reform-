// Pure client-consent lifecycle prototype. No database, identity provider, or live authorization.
// The caller MUST derive actor identity and membership from trusted server-side sources.
const validId=x=>typeof x==='string'&&/^[A-Za-z0-9_-]{1,64}$/.test(x);
const scopes=new Set(['view_report','review_finding']);
const fail=reason=>({ok:false,reason,grant:null});
const copy=g=>({...g,scopes:[...g.scopes]});
export function requestClientGrant({firmTenantId,businessTenantId,requestedBy,scopes:requestedScopes}={}){
 if(!validId(firmTenantId)||!validId(businessTenantId)||!validId(requestedBy)||firmTenantId===businessTenantId)return fail('invalid_tenants_or_requester');
 if(!Array.isArray(requestedScopes)||!requestedScopes.length||requestedScopes.length>scopes.size||new Set(requestedScopes).size!==requestedScopes.length||requestedScopes.some(s=>!scopes.has(s)))return fail('invalid_scopes');
 return {ok:true,reason:'pending_business_approval',grant:{firmTenantId,businessTenantId,requestedBy,scopes:[...requestedScopes],status:'pending',approvedBy:null,revokedBy:null}};
}
export function approveClientGrant({grant,actor}={}){
 if(!isGrant(grant)||grant.status!=='pending')return fail('not_pending');
 if(!isBusinessOwner(actor,grant.businessTenantId))return fail('business_owner_required');
 return {ok:true,reason:'approved',grant:{...copy(grant),status:'active',approvedBy:actor.userId}};
}
export function revokeClientGrant({grant,actor}={}){
 if(!isGrant(grant)||!['pending','active'].includes(grant.status))return fail('not_revocable');
 const owner=isBusinessOwner(actor,grant.businessTenantId);
 const firmAdmin=actor&&actor.active===true&&actor.role==='accounting_admin'&&validId(actor.userId)&&actor.tenantId===grant.firmTenantId;
 if(!owner&&!firmAdmin)return fail('revocation_not_authorized');
 return {ok:true,reason:'revoked',grant:{...copy(grant),status:'revoked',revokedBy:actor.userId}};
}
export function grantAllows({grant,firmTenantId,businessTenantId,action}={}){
 return isGrant(grant)&&grant.status==='active'&&validId(grant.approvedBy)&&grant.revokedBy===null&&validId(firmTenantId)&&validId(businessTenantId)&&grant.firmTenantId===firmTenantId&&grant.businessTenantId===businessTenantId&&scopes.has(action)&&grant.scopes.includes(action);
}
function isBusinessOwner(actor,tenantId){return actor&&actor.active===true&&actor.role==='business_owner'&&validId(actor.userId)&&actor.tenantId===tenantId}
function isGrant(g){return g&&validId(g.firmTenantId)&&validId(g.businessTenantId)&&g.firmTenantId!==g.businessTenantId&&validId(g.requestedBy)&&Array.isArray(g.scopes)&&g.scopes.length>0&&g.scopes.length<=scopes.size&&new Set(g.scopes).size===g.scopes.length&&g.scopes.every(s=>scopes.has(s))&&['pending','active','revoked'].includes(g.status)&&((g.status==='pending'&&g.approvedBy===null&&g.revokedBy===null)||(g.status==='active'&&validId(g.approvedBy)&&g.revokedBy===null)||(g.status==='revoked'&&validId(g.revokedBy)&&(g.approvedBy===null||validId(g.approvedBy))))}
