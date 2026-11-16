// Server-side authorization boundary prototype. Not an HTTP endpoint or deployed security.
// Only call with identities and records loaded from verified server-side auth and storage.
import {authorizePayrollAction} from './tenant-access.mjs';
import {grantAllows} from './client-consent.mjs';

const id=x=>typeof x==='string'&&/^[A-Za-z0-9_-]{1,64}$/.test(x);
const deny=reason=>({allowed:false,reason});
export function authorizeReportRequest({session,membership,report,grant,action}={}){
 if(!session||session.verified!==true||!id(session.userId)||!id(session.sessionId)||session.active!==true)return deny('unverified_session');
 if(!membership||membership.userId!==session.userId||membership.active!==true||!id(membership.tenantId))return deny('inactive_or_mismatched_membership');
 if(!report||!id(report.id)||!id(report.businessTenantId)||report.active!==true)return deny('invalid_report');
 if(!['view_report','review_finding'].includes(action))return deny('unsupported_action');
 const actor={userId:session.userId,tenantId:membership.tenantId,role:membership.role,active:true,firmId:membership.role?.startsWith('accounting_')?membership.tenantId:undefined};
 const resource={tenantId:report.businessTenantId,clientId:report.clientId,active:true};
 if(membership.role==='business_owner')return authorizePayrollAction({actor,resource,action,grants:[]});
 if(!id(report.clientId)||!grantAllows({grant,firmTenantId:membership.tenantId,businessTenantId:report.businessTenantId,action}))return deny('missing_client_consent');
 const legacyGrant={firmId:membership.tenantId,clientId:report.clientId,tenantId:report.businessTenantId,active:true,approved:true};
 return authorizePayrollAction({actor,resource,action,grants:[legacyGrant]});
}
