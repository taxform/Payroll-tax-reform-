// Slice 6 — TaxBandits sandbox filing (docs/payrollcheck-360-integration-plan.md).
// Filing queue, submit-filing and refresh-status, behind the same tenancy and
// RLS as the tax center. Mirrors netlify/functions/payrollcheck-tax-center.mts.
// Sandbox only: the filing module refuses any host other than the TaxBandits
// test system, and the 8879-EMP PIN travels in the request body only.
import type { Config } from "@netlify/functions";
import {
  getAuthComposition,
  clientIp,
  readJsonBody,
  jsonResponse,
  methodNotAllowed,
  unavailable,
} from "../lib/payrollcheck-auth.mjs";
import { createTaxBanditsSandboxFilingClientFactory } from "../../src/payrollcheck/payrollcheck-taxbandits-sandbox.mjs";

export default async function handler(req: Request) {
  if (req.method !== "POST") return methodNotAllowed();
  try {
    const body = await readJsonBody(req);
// Live sandbox submission: the factory reads TAXBANDITS_SANDBOX_CLIENT_ID,
// TAXBANDITS_SANDBOX_CLIENT_SECRET and TAXBANDITS_SANDBOX_USER_TOKEN from the
// Netlify environment; it is null when any are missing, so the endpoint
// stays queue-only until they are set.
    const filingClientFactory = createTaxBanditsSandboxFilingClientFactory({ env: process.env }); 
const auth = getAuthComposition({ filingClientFactory });
    const result = await auth.handleFiling({
      cookieHeader: req.headers.get("cookie") ?? "",
      csrfToken: req.headers.get("x-csrf-token") ?? undefined,
      tenantId: body.tenantId,
      action: body.action,
      form: body.form,
      taxYear: body.taxYear,
      quarter: body.quarter,
      pin: body.pin,
      filingId: body.filingId,
      ip: clientIp(req),
      requestId: req.headers.get("x-request-id") ?? undefined,
    });
    return jsonResponse(result);
  } catch (error) {
    return unavailable(error);
  }
}

export const config: Config = {
  path: "/payrollcheck/api/filing",
  method: "POST",
};
