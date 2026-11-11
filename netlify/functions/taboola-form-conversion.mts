import type { FormSubmittedEvent } from "@netlify/functions";
import { cleanClickId, sendTaboolaConversions, TABOOLA_EVENTS } from "../lib/taboola.js";

// Reports a Taboola "lead" conversion for every verified Netlify Forms submission
// (contact, advertiser inquiry, media request, tax alerts) from a visitor who arrived via a Taboola ad.
// The click ID is carried in the hidden "tblci" field that /taboola.js fills in.
export default {
  async formSubmitted(event: FormSubmittedEvent) {
    const clickId = cleanClickId(event.data?.tblci);
    if (!clickId) return;
    try {
      await sendTaboolaConversions([{ clickId, name: TABOOLA_EVENTS.lead() }]);
    } catch (err) {
      console.error("Taboola form conversion failed", err);
    }
  },
};
