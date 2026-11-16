// Privacy-minimized authorization audit event prototype. No persistence or delivery.
// Call only with trusted server-sourced request metadata; never log payroll amounts or files.
const id=x=>typeof x==='string'&&/^[A-Za-z0-9_-]{1,64}$/.test(x);
const actions=new Set(['view_report','review_finding']);
const reasons=new Set(['same_business_tenant','explicit_active_client_grant','unverified_session','invalid_records','too_many_records','missing_or_ambiguous_report','missing_or_ambiguous_membership','unsupported_role','missing_or_ambiguous_grant','inactive_or_mismatched_membership','invalid_report','unsupported_action','missing_client_consent','tenant_mismatch','invalid_request','inactive_or_unknown_role','invalid_firm_or_client','insufficient_role','missing_or_ambiguous_client_grant']);
export function makeReportAccessAuditEvent({requestId,session,reportId,action,decision,occurredAt}={}){
 if(!id(requestId)||!id(reportId)||!actions.has(action)||!session||!id(session.userId)||!id(session.sessionId)||!decision||typeof decision.allowed!=='boolean'||!reasons.has(decision.reason))return null;
 if(typeof occurredAt!=='string'||!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(occurredAt)||!Number.isFinite(Date.parse(occurredAt)))return null;
 return Object.freeze({eventType:'payrollcheck.report_access_decision',requestId,actorUserId:session.userId,reportId,action,allowed:decision.allowed,reason:decision.reason,occurredAt});
}
