// Boundary adapter for an eventual authenticated server route. NOT an HTTP handler.
// All dependencies must be trusted server implementations; do not expose this to browser code.
import {mapVerifiedIdentity} from './verified-identity-adapter.mjs';
import {authorizeStoredReportAccess} from './stored-report-access.mjs';

const id=x=>typeof x==='string'&&/^[A-Za-z0-9_-]{1,64}$/.test(x);
const deny=reason=>Object.freeze({allowed:false,reason});
export async function checkAuthenticatedReportAccess({verifiedClaims,identityConfig,reportId,action,loadTrustedRecords}={}){
 if(typeof loadTrustedRecords!=='function'||!identityConfig||!id(reportId))return deny('invalid_boundary_config');
 if(!['view_report','review_finding'].includes(action))return deny('unsupported_action');
 const session=mapVerifiedIdentity({claims:verifiedClaims,expectedIssuer:identityConfig.issuer,expectedAudience:identityConfig.audience,nowSeconds:identityConfig.nowSeconds});
 if(!session)return deny('unverified_session');
 let records;
 try{records=await loadTrustedRecords({userId:session.userId,reportId});}
 catch{return deny('trusted_record_lookup_failed');}
 if(!records||typeof records!=='object'||Array.isArray(records))return deny('trusted_record_lookup_failed');
 try{
  const decision=authorizeStoredReportAccess({session,memberships:records.memberships,reports:records.reports,grants:records.grants,reportId,action});
  return Object.freeze({allowed:decision.allowed===true,reason:decision.reason});
 }catch{
  return deny('invalid_trusted_records');
 }
}
