import type { Config } from "@netlify/functions";
import {
  getAuthComposition,
  jsonResponse,
  methodNotAllowed,
  unavailable,
} from "../lib/payrollcheck-auth.mjs";

// POST /payrollcheck/api/logout
// Cookie + X-CSRF-Token header -> the composition's logout: revokes the
// session and clears the cookie. Idempotent when no session is presented.
// A wrong CSRF token refuses to revoke (403) — the session survives.
export default async (req: Request) => {
  if (req.method !== "POST") return methodNotAllowed();
  try {
    const auth = getAuthComposition();
    const result = await auth.logout({
      cookieHeader: req.headers.get("cookie") ?? "",
      csrfToken: req.headers.get("x-csrf-token") ?? undefined,
    });
    return jsonResponse(result);
  } catch (error) {
    return unavailable(error);
  }
};

export const config: Config = {
  path: "/payrollcheck/api/logout",
  method: "POST",
};
