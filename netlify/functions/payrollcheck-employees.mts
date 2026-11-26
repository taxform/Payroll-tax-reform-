import type { Config } from "@netlify/functions";
import {
  getAuthComposition,
  clientIp,
  readJsonBody,
  jsonResponse,
  methodNotAllowed,
  unavailable,
} from "../lib/payrollcheck-auth.mjs";

// POST /payrollcheck/api/employees
// { tenantId?, action: 'list' | 'create' | 'update' | 'deactivate',
//   employee?, employeeId? } + Cookie + X-CSRF-Token header -> the
// composition's handleEmployees: the signed-in business's own employees,
// RLS-scoped to its tenant. A rotation returns the new Set-Cookie AND the
// new CSRF token in the body, so the app page can update the token it stores.
// A tenant id, when given, only selects among the caller's own memberships
// (list); writes target the caller's own tenant, resolved from memberships.
// Anything else is 'not_found'. The SSN is never returned in full: only
// its last four digits and the masked form leave the server, and the sealed
// SSN is never logged.
export default async function handler(req: Request) {
  if (req.method !== "POST") return methodNotAllowed();
  try {
    const body = await readJsonBody(req);
    const auth = getAuthComposition();
    const result = await auth.handleEmployees({
      cookieHeader: req.headers.get("cookie") ?? "",
      csrfToken: req.headers.get("x-csrf-token") ?? undefined,
      tenantId: body.tenantId,
      action: body.action,
      employee: body.employee,
      employeeId: body.employeeId,
      ip: clientIp(req),
      requestId: req.headers.get("x-request-id") ?? undefined,
    });
    return jsonResponse(result);
  } catch (error) {
    return unavailable(error);
  }
}

export const config: Config = {
  path: "/payrollcheck/api/employees",
  method: "POST",
};
