import type { Config } from "@netlify/functions";
import {
  getAuthComposition,
  clientIp,
  readJsonBody,
  jsonResponse,
  methodNotAllowed,
  unavailable,
} from "../lib/payrollcheck-auth.mjs";

export default async function handler(req: Request) {
  if (req.method !== "POST") return methodNotAllowed();
  try {
    const body = await readJsonBody(req);
    const auth = getAuthComposition();
    const result = await auth.handleTaxCenter({
      cookieHeader: req.headers.get("cookie") ?? "",
      csrfToken: req.headers.get("x-csrf-token") ?? undefined,
      tenantId: body.tenantId,
      action: body.action,
      ip: clientIp(req),
      requestId: req.headers.get("x-request-id") ?? undefined,
    });
    return jsonResponse(result);
  } catch (error) {
    return unavailable(error);
  }
}

export const config: Config = {
  path: "/payrollcheck/api/tax-center",
  method: "POST",
};
