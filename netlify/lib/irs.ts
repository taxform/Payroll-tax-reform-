import { asc, desc, sql } from "drizzle-orm";
import { db } from "../../db/index.js";
import { feedChecks, irsUpdates } from "../../db/schema.js";

const SOURCE_URL = "https://www.irs.gov/newsroom/news-releases-for-current-month";
const MAX_ITEMS = 25;

export interface IrsRelease {
  url: string;
  title: string;
  releaseNumber: string;
  releaseDate: string;
  publishedOn: string | null;
  summary: string;
}

const decode = (s: string) =>
  s
    .replace(/<[^>]*>/g, "")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&quot;/g, '"')
    .replace(/&#039;|&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();

// Parses the teaser list on the IRS "News releases for current month" page.
export function parseReleases(html: string): IrsRelease[] {
  const releases: IrsRelease[] = [];
  const blocks = html.split('class="field_pup_media_document_teaser"').slice(1);
  for (const block of blocks) {
    const link = block.match(/<a\s+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/);
    if (!link) continue;
    let url: URL;
    try {
      url = new URL(link[1], "https://www.irs.gov");
    } catch {
      continue;
    }
    if (url.protocol !== "https:" || !["irs.gov", "www.irs.gov"].includes(url.hostname)) continue;
    const title = decode(link[2]).slice(0, 300);
    if (!title) continue;

    const abstract = block.match(/field--name-field-pup-description-abstract[^>]*>([\s\S]*?)<\/div>/);
    const text = abstract ? decode(abstract[1]) : "";
    // Abstracts look like "IR-2026-129, Oct. 29, 2026 — Summary text"
    const meta = text.match(/^(IR-\d{4}-\d+),\s*([^—–-]+?)\s*[—–-]\s*([\s\S]*)$/);
    if (!meta) continue; // skip archive links and other non-release teasers
    const releaseDate = meta[2].replace(/\.(?=\d)/, ". ");
    const parsed = new Date(`${releaseDate.replace(/\./g, "").replace("Sept", "Sep")} UTC`);
    releases.push({
      url: url.href,
      title,
      releaseNumber: meta[1],
      releaseDate,
      publishedOn: !isNaN(parsed.getTime()) ? parsed.toISOString().slice(0, 10) : null,
      summary: meta[3].slice(0, 600),
    });
    if (releases.length >= MAX_ITEMS) break;
  }
  return releases;
}

// Fetches the IRS newsroom and stores any releases not seen before.
export async function refreshIrsUpdates() {
  try {
    const res = await fetch(SOURCE_URL, {
      headers: { "User-Agent": "PayrollTaxReform.com official-link-monitor (+https://payrolltaxreform.com)" },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) throw new Error(`IRS responded with HTTP ${res.status}`);
    const releases = parseReleases(await res.text());
    if (!releases.length) throw new Error("No releases found; the IRS page layout may have changed");

    await db.insert(irsUpdates).values(releases).onConflictDoNothing({ target: irsUpdates.url });
    await db.insert(feedChecks).values({ status: "ok", itemsFound: releases.length });
    return { ok: true, itemsFound: releases.length };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("IRS refresh failed:", message);
    await db.insert(feedChecks).values({ status: "error", error: message.slice(0, 500) });
    return { ok: false, error: message };
  }
}

export async function getLatestUpdates(limit = 20) {
  const [items, [lastCheck]] = await Promise.all([
    db
      .select({
        title: irsUpdates.title,
        url: irsUpdates.url,
        releaseNumber: irsUpdates.releaseNumber,
        releaseDate: irsUpdates.releaseDate,
        summary: irsUpdates.summary,
      })
      .from(irsUpdates)
      .orderBy(sql`${irsUpdates.publishedOn} desc nulls last`, desc(irsUpdates.firstSeenAt), asc(irsUpdates.id))
      .limit(limit),
    db.select().from(feedChecks).orderBy(desc(feedChecks.checkedAt)).limit(1),
  ]);
  return { items, lastCheck: lastCheck ?? null };
}
