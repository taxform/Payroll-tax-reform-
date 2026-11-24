// Concrete aal2 (MFA assurance) check for PayrollCheck 360 (M2 step 5).
//
// This is the real implementation of the `requireAal2` dependency injected
// into authorizeSupabaseTenantSession (supabase-session-membership.mjs),
// which denies with 'mfa_required' unless it returns true.
//
// It verifies the access token with the step-2 JWKS verifier and requires
// claims.aal === 'aal2' (and claims.sub matching the verified user id).
// Supabase issues aal "aal1" after password login and "aal2" after a
// verified MFA challenge, so this is the whole enforcement point for the
// boundary rule "aal2/MFA for all report access".
//
// Fail closed: any verifier error, a missing/invalid aal claim, a sub
// mismatch, or invalid input returns false. This function never throws.

export function createRequireAal2({ verifyAccessToken } = {}) {
  if (typeof verifyAccessToken !== 'function') {
    throw new Error('createRequireAal2 requires a verifyAccessToken function');
  }

  return async function requireAal2(accessToken, authUserId) {
    if (typeof accessToken !== 'string' || accessToken.length === 0) {
      // TEMPORARY DEBUG — revert once the staging MFA verify is diagnosed.
      // Logs only the failure reason, never a token, user id, or email.
      console.info(JSON.stringify({source: 'payrollcheck-auth', event: 'aal2_check_failed', reason: 'bad_input'}));
      return false;
    }
    if (typeof authUserId !== 'string' || authUserId.length === 0) {
      console.info(JSON.stringify({source: 'payrollcheck-auth', event: 'aal2_check_failed', reason: 'bad_input'}));
      return false;
    }
    let claims;
    try {
      claims = await verifyAccessToken(accessToken);
    } catch (error) {
      // TEMPORARY DEBUG — revert once the staging MFA verify is diagnosed.
      // Logs only the verifier's error code, never a token.
      console.info(JSON.stringify({source: 'payrollcheck-auth', event: 'aal2_check_failed', reason: 'verify_threw', code: error && typeof error.code === 'string' ? error.code : 'unknown'}));
      return false;
    }
    if (!claims || typeof claims !== 'object') {
      console.info(JSON.stringify({source: 'payrollcheck-auth', event: 'aal2_check_failed', reason: 'no_claims'}));
      return false;
    }
    if (claims.aal !== 'aal2') {
      console.info(JSON.stringify({source: 'payrollcheck-auth', event: 'aal2_check_failed', reason: 'aal_not_aal2', aal: typeof claims.aal === 'string' ? claims.aal : null}));
      return false;
    }
    if (claims.sub !== authUserId) {
      console.info(JSON.stringify({source: 'payrollcheck-auth', event: 'aal2_check_failed', reason: 'sub_mismatch'}));
      return false;
    }
    return true;
  };
}
