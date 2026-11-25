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
      return false;
    }
    if (typeof authUserId !== 'string' || authUserId.length === 0) {
      return false;
    }
    let claims;
    try {
      claims = await verifyAccessToken(accessToken);
    } catch {
      return false;
    }
    if (!claims || typeof claims !== 'object') {
      return false;
    }
    if (claims.aal !== 'aal2') {
      return false;
    }
    if (claims.sub !== authUserId) {
      return false;
    }
    return true;
  };
}
