import type { Config } from "@netlify/functions";
import {
  getAuthComposition,
  clientIp,
  readJsonBody,
  jsonResponse,
  methodNotAllowed,
  unavailable,
} from "../lib/payrollcheck-auth.mjs";

// POST /payrollcheck/api/company
// { tenantId?, action: 'read' | 'write', company? } + Cookie + X-CSRF-Token
// header -> the composition's handleCompany: the signed-in business's own
// company profile (legal name, EIN, address, pay schedule), one row per
// tenant. A rotation returns the new Set-Cookie AND the new CSRF token in the
// body, so the app page can update the token it stores. A tenant id, when
// given, only selects among the caller's own memberships; anything else is
// 'not_found'. The EIN is never returned in full: only its last four digits
// and the masked form leave the server.
export default async function handler(req: Request) {
  if (req.method !== "POST") return methodNotAllowed();
  try {
    const body = await readJsonBody(req);
    const auth = getAuthComposition();
    const result = await auth.handleCompany({
      cookieHeader: req.headers.get("cookie") ?? "",
      csrfToken: req.headers.get("x-csrf-token") ?? undefined,
      tenantId: body.tenantId,
      action: body.action,
      company: body.company,
      ip: clientIp(req),
    });
    return jsonResponse(result);
  } catch (error) {
    return unavailable(error);
  }
}

export const config: Config = {
  path: "/payrollcheck/api/company",
  method: "POST",
};
