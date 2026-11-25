import type { Config } from "@netlify/functions";
import {
  getAuthComposition,
  clientIp,
  readJsonBody,
  jsonResponse,
  methodNotAllowed,
  unavailable,
} from "../lib/payrollcheck-auth.mjs";

// The session cookie the login and verify flows set. An additional factor
// (S9) requires an existing session for the same user, so the handler
// forwards the session id from this cookie (or an explicit sessionId in
// the body) to the composition's mfaEnroll.

function sessionIdFromCookie(cookieHeader: string | null): string | undefined {
  if (!cookieHeader) return undefined;
  const match = /__Host-payrollcheck-session=([^;]+)/.exec(cookieHeader);
  return match ? match[1] : undefined;
}

// POST /payrollcheck/api/mfa/enroll
// { email, password, sessionId? } -> the composition's mfaEnroll:
// re-authenticates, enrolls a TOTP factor, returns { factorId, qrCode,
// secret, uri, pendingBlob }. The secret is shown ONCE by the login page
// and never stored server-side. The optional sessionId (or the session
// cookie) proves an existing session for the same user; it is required
// when the user already has a factor, and ignored for the first factor.
export default async (req: Request) => {
  if (req.method !== "POST") return methodNotAllowed();
  try {
    const body = await readJsonBody(req);
    const auth = getAuthComposition();
    const sessionId =
      sessionIdFromCookie(req.headers.get('cookie')) ??
      (typeof body.sessionId === 'string' && body.sessionId ? body.sessionId : undefined);
    const result = await auth.mfaEnroll({
      email: body.email,
      password: body.password,
      ip: clientIp(req),
      sessionId,
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
