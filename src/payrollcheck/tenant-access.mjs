// Authorization decision prototype ONLY. Caller identity and grants MUST come from
// verified server-side authentication and a trusted database, never client input.
const ROLES=new Set(['business_owner','accounting_admin','accounting_reviewer']);
const ACTIONS=new Set(['view_report','review_finding','manage_client_access']);
const id=x=>typeof x==='string'&&/^[a-zA-Z0-9_-]{1,64}$/.test(x);
export function authorizePayrollAction({actor,resource,action,grants}={}){
 const deny=reason=>({allowed:false,reason});
 if(!actor||!resource||!id(actor.userId)||!id(actor.tenantId)||!id(resource.tenantId)||!ACTIONS.has(action)||!Array.isArray(grants)||grants.length>500)return deny('invalid_request');
 if(!ROLES.has(actor.role)||actor.active!==true||resource.active!==true)return deny('inactive_or_unknown_role');
 if(actor.role==='business_owner'){
  if(actor.tenantId!==resource.tenantId)return deny('tenant_mismatch');
  return {allowed:true,reason:'same_business_tenant'};
 }
 if(!id(resource.clientId)||!id(actor.firmId)||actor.tenantId!==actor.firmId)return deny('invalid_firm_or_client');
 if(action==='manage_client_access'&&actor.role!=='accounting_admin')return deny('insufficient_role');
 const matches=grants.filter(g=>g&&g.firmId===actor.firmId&&g.clientId===resource.clientId&&g.tenantId===resource.tenantId&&g.active===true&&g.approved===true);
 if(matches.length!==1)return deny('missing_or_ambiguous_client_grant');
 return {allowed:true,reason:'explicit_active_client_grant'};
}
