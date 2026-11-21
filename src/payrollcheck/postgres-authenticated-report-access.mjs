// Server-only composition prototype. No live PostgreSQL connection or OIDC verification.
// The pool must use a least-privilege, non-BYPASSRLS application role with reviewed RLS.
// Never treat this helper as proof of production isolation.
import {checkAuthenticatedReportAccess} from './authenticated-report-boundary.mjs';
import {loadReportAuthorizationRecords} from './postgres-report-loader.mjs';
import {withReadOnlyAuthorizationTransaction} from './postgres-readonly-transaction.mjs';

const deny=reason=>Object.freeze({allowed:false,reason});
export async function checkPostgresBackedReportAccess({verifiedClaims,identityConfig,reportId,action,pool,resolveReportUuid,resolveTenantId}={}){
 if(!pool||typeof resolveReportUuid!=='function'||typeof resolveTenantId!=='function')return deny('invalid_database_config');
 // The identity check runs before acquiring a database connection.
 return checkAuthenticatedReportAccess({
  verifiedClaims,identityConfig,reportId,action,
  loadTrustedRecords:async({userId,reportId:requestedReportId})=>{
   const transaction=await withReadOnlyAuthorizationTransaction({
    pool,
    operation:({query})=>loadReportAuthorizationRecords({
     query,userId,reportId:requestedReportId,resolveReportUuid,resolveTenantId
    })
   });
   if(!transaction.ok)throw Error('authorization_transaction_failed');
   return transaction.result;
  }
 });
}
