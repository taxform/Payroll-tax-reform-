import type { Config } from "@netlify/functions";
import {
  getAuthComposition,
  clientIp,
  readJsonBody,
  jsonResponse,
  methodNotAllowed,
  unavailable,
} from "../lib/payrollcheck-auth.mjs";

// POST /payrollcheck/api/mfa/enroll
// { email, password } -> the composition's mfaEnroll: re-authenticates,
// enrolls a TOTP factor, returns { factorId, qrCode, secret, uri,
// pendingBlob }. The secret is shown ONCE by the login page and never
// stored server-side.
export default async (req: Request) => {
  if (req.method !== "POST") return methodNotAllowed();
  try {
    const body = await readJsonBody(req);
    const auth = getAuthComposition();
    const result = await auth.mfaEnroll({
      email: body.email,
      password: body.password,
      ip: clientIp(req),
    });
    return jsonResponse(result);
  } catch (error) {
    return unavailable(error);
  }
};

export const config: Config = {
  path: "/payrollcheck/api/mfa/enroll",
  method: "POST",
};
