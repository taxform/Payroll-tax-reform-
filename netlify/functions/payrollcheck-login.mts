import type { Config } from "@netlify/functions";
import {
  getAuthComposition,
  clientIp,
  readJsonBody,
  jsonResponse,
  methodNotAllowed,
  unavailable,
} from "../lib/payrollcheck-auth.mjs";

// POST /payrollcheck/api/login
// { email, password } -> the composition's login: password check, subject
// mapping, MFA factor list. MFA enrolled: { mfaRequired: true, factors,
// pendingBlob } and NO session. No factor: Set-Cookie session +
// { ok: true, csrfToken, mfaSetupRequired: true }.
export default async (req: Request) => {
  if (req.method !== "POST") return methodNotAllowed();
  try {
    const body = await readJsonBody(req);
    const auth = getAuthComposition();
    const result = await auth.login({
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
  path: "/payrollcheck/api/login",
  method: "POST",
};
