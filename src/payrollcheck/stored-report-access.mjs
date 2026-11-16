// Trusted-record adapter prototype. NOT a database, authentication provider, or HTTP handler.
// Caller must fetch session, membership, report and grants from a trusted server database.
// Do not pass browser-controlled objects into this adapter.
import {authorizeReportRequest} from './report-access-boundary.mjs';
const id=x=>typeof x==='string'&&/^[A-Za-z0-9_-]{1,64}$/.test(x);
const deny=reason=>({allowed:false,reason});
export function authorizeStoredReportAccess({session, memberships, reports, grants, reportId, action}={}){
 if(!session||session.verified!==true||session.active!==true||!id(session.userId)||!id(session.sessionId))return deny('unverified_session');
 if(!id(reportId)||!Array.isArray(memberships)||!Array.isArray(reports)||!Array.isArray(grants))return deny('invalid_records');
 if(memberships.length>500||reports.length>500||grants.length>500)return deny('too_many_records');
 const matchingReports=reports.filter(r=>r&&r.id===reportId);
 if(matchingReports.length!==1)return deny('missing_or_ambiguous_report');
 const report=matchingReports[0];
 const activeMemberships=memberships.filter(m=>m&&m.userId===session.userId&&m.active===true);
 if(activeMemberships.length!==1)return deny('missing_or_ambiguous_membership');
 const membership=activeMemberships[0];
 if(membership.role==='business_owner')return authorizeReportRequest({session,membership,report,action});
 if(!membership.role?.startsWith('accounting_'))return deny('unsupported_role');
 const matchingGrants=grants.filter(g=>g&&g.firmTenantId===membership.tenantId&&g.businessTenantId===report.businessTenantId&&g.status==='active');
 if(matchingGrants.length!==1)return deny('missing_or_ambiguous_grant');
 return authorizeReportRequest({session,membership,report,grant:matchingGrants[0],action});
}
