import type { Config } from "@netlify/functions";
import {
  getAuthComposition,
  clientIp,
  readJsonBody,
  jsonResponse,
  methodNotAllowed,
  unavailable,
} from "../lib/payrollcheck-auth.mjs";

// POST /payrollcheck/api/dashboard
// { tenantId? } + Cookie + X-CSRF-Token header -> the composition's
// getDashboard: the signed-in business's app shell (its tenants, its
// compliance-check report counts, the module catalogue). A rotation returns
// the new Set-Cookie AND the new CSRF token in the body, so the app page can
// update the token it stores. A tenant id, when given, only selects among
// the caller's own memberships; anything else is `not_found`.
export default async (req: Request) => {
  if (req.method !== "POST") return methodNotAllowed();
  try {
    const body = await readJsonBody(req);
    const auth = getAuthComposition();
    const result = await auth.getDashboard({
      cookieHeader: req.headers.get("cookie") ?? "",
      csrfToken: req.headers.get("x-csrf-token") ?? undefined,
      tenantId: body.tenantId,
      ip: clientIp(req),
    });
    return jsonResponse(result);
  } catch (error) {
    return unavailable(error);
  }
};

export const config: Config = {
  path: "/payrollcheck/api/dashboard",
  method: "POST",
};
