import type { Config } from "@netlify/functions";
import {
  getAuthComposition,
  clientIp,
  readJsonBody,
  jsonResponse,
  methodNotAllowed,
  unavailable,
} from "../lib/payrollcheck-auth.mjs";

// POST /payrollcheck/api/mfa/verify
// { pendingBlob, factorId?, code } -> the composition's mfaVerify: opens
// the sealed aal1 token, challenges + verifies the TOTP code, re-checks
// aal2 via JWKS, then issues the server session (Set-Cookie +
// { ok: true, csrfToken, mfaEnrolled }). The pending blob is ciphertext
// the browser carries transiently; it never authorizes anything alone.
export default async (req: Request) => {
  if (req.method !== "POST") return methodNotAllowed();
  try {
    const body = await readJsonBody(req);
    const auth = getAuthComposition();
    const result = await auth.mfaVerify({
      pendingBlob: body.pendingBlob,
      factorId: body.factorId,
      code: body.code,
      ip: clientIp(req),
    });
    return jsonResponse(result);
  } catch (error) {
    return unavailable(error);
  }
};

export const config: Config = {
  path: "/payrollcheck/api/mfa/verify",
  method: "POST",
};
