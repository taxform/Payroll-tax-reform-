import type { Config } from "@netlify/functions";
import {
  getAuthComposition,
  clientIp,
  readJsonBody,
  jsonResponse,
  methodNotAllowed,
  unavailable,
} from "../lib/payrollcheck-auth.mjs";

// POST /payrollcheck/api/report
// { reportId, action } + Cookie + X-CSRF-Token header -> the composition's
// readReport: the step-8 handler over the cookie binding. A rotation
// returns the new Set-Cookie AND the new CSRF token in the body, so the
// login page can update the token it stores.
export default async (req: Request) => {
  if (req.method !== "POST") return methodNotAllowed();
  try {
    const body = await readJsonBody(req);
    const auth = getAuthComposition();
    const result = await auth.readReport({
      cookieHeader: req.headers.get("cookie") ?? "",
      csrfToken: req.headers.get("x-csrf-token") ?? undefined,
      reportId: body.reportId,
      action: body.action,
      ip: clientIp(req),
    });
    return jsonResponse(result);
  } catch (error) {
    return unavailable(error);
  }
};

export const config: Config = {
  path: "/payrollcheck/api/report",
  method: "POST",
};
