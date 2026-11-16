// PostgreSQL trusted-record loader prototype. Server-only; no database connection here.
// The caller must supply a transaction-bound, least-privilege query function with RLS
// and independently verified identity. This adapter alone does NOT enforce RLS.
const id=x=>typeof x==='string'&&/^[A-Za-z0-9_-]{1,64}$/.test(x);
const uuid=x=>typeof x==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(x);
const requiredRows=(result,max)=>{if(!result||!Array.isArray(result.rows)||result.rows.length>max)throw Error('invalid_query_result');return result.rows;};
export async function loadReportAuthorizationRecords({query,userId,reportId,resolveReportUuid}={}){
 if(typeof query!=='function'||!id(userId)||!id(reportId)||typeof resolveReportUuid!=='function')throw Error('invalid_loader_config');
 // Current prototype report IDs are not UUIDs. Only a trusted server-side mapping may resolve them.
 const reportUuid=await resolveReportUuid(reportId);
 if(!uuid(reportUuid))throw Error('invalid_report_mapping');
 const reports=requiredRows(await query(
  'SELECT report_id, business_tenant_id, client_id, status FROM payrollcheck.reports WHERE report_id=$1 LIMIT 2',[reportUuid]),2);
 if(reports.length!==1)return {memberships:[],reports:[],grants:[]};
 const report=reports[0];
 if(!report||!uuid(report.business_tenant_id)||!id(report.client_id))throw Error('invalid_report_row');
 const memberships=requiredRows(await query(
  'SELECT subject_id, tenant_id, role, active FROM payrollcheck.memberships WHERE subject_id=$1 AND active=true LIMIT 501',[userId]),501);
 const grants=requiredRows(await query(
  "SELECT firm_tenant_id, business_tenant_id, scopes, status, approved_by_subject, approved_at, revoked_at FROM payrollcheck.client_grants WHERE business_tenant_id=$1 AND status='active' LIMIT 501",[report.business_tenant_id]),501);
 return {
  reports:[{id:reportId,businessTenantId:report.business_tenant_id,clientId:report.client_id,active:report.status!=='archived'}],
  memberships:memberships.map(m=>({userId:m.subject_id,tenantId:m.tenant_id,role:m.role,active:m.active})),
  grants:grants.map(g=>({firmTenantId:g.firm_tenant_id,businessTenantId:g.business_tenant_id,scopes:g.scopes,status:g.status,approvedBy:g.approved_by_subject,approvedAt:g.approved_at,revokedAt:g.revoked_at}))
 };
}
