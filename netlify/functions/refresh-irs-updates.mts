import type { Config } from "@netlify/functions";
import { refreshIrsUpdates } from "../lib/irs.js";

export default async () => {
  const result = await refreshIrsUpdates();
  console.log("IRS refresh:", JSON.stringify(result));
};

// 11:00 UTC daily — 6 AM Eastern (standard time) / 7 AM Eastern (daylight time)
export const config: Config = {
  schedule: "0 11 * * *",
};
