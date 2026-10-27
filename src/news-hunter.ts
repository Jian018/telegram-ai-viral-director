
import { XMLParser } from "fast-xml-parser";

/**
 * AI VIRAL DIRECTOR
 * News Hunter - Phase 1
 *
 * Fetch RSS news, filter recent articles,
 * deduplicate and save to Supabase.
 */

const NEWS_FEEDS = [
  {
    name: "Google News Technology",
    url: "https://news.google.com/rss/headlines/section/topic/TECHNOLOGY?hl=en-US&gl=US&ceid=US:en",
    region: "global",
    language: "en"
  },
  {
    name: "IT之家",
    url: "https://www.ithome.com/rss/",
    region: "china",
    language: "zh"
  }
] as const;

const parser = new XMLParser({
  ignoreAttributes: false,
  parseTagValue: false,
  trimValues: true
});

const MAX_NEWS_PER_FEED = 20;
const MAX_AGE_HOURS = 48;

function asText(value: unknown): string {
  if (typeof value === "string") return value;

  if (typeof value === "number") {
    return String(value);
  }

  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    return asText(obj["#text"]);
  }

  return "";
}

function validArticleUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:";
  } catch {
    return false;
  }
}

export async function collectNews() {
  const supabaseUrl = process.env.SUPABASE_URL?.trim();
  const supabaseKey = process.env.SUPABASE_SECRET_KEY?.trim();

  if (!supabaseUrl || !supabaseKey) {
    throw new Error("Supabase environment variables missing");
  }

  let scanned = 0;
  let saved = 0;
  let successfulFeeds = 0;
  const errors: string[] = [];

  const now = Date.now();
  const cutoff = now - MAX_AGE_HOURS * 60 * 60 * 1000;

  for (const feed of NEWS_FEEDS) {
    try {
      const response = await fetch(feed.url, {
        headers: {
          "User-Agent": "AI-Viral-Director-RSS/1.0",
          Accept: "application/rss+xml, application/xml, text/xml"
        },
        signal: AbortSignal.timeout(12000)
      });

      if (!response.ok) {
        throw new Error(`RSS HTTP ${response.status}`);
      }

      const xml = await response.text();
      const parsed = parser.parse(xml);

      const rawItems = parsed?.rss?.channel?.item;

      if (!rawItems) {
        throw new Error("No RSS items found");
      }

      const items: Record<string, unknown>[] =
        Array.isArray(rawItems) ? rawItems : [rawItems];

      const records = [];
      const seenUrls = new Set<string>();

      for (const item of items) {
        scanned++;

        const headline = asText(item.title).trim();
        const link = asText(item.link).trim();
        const source = asText(item.source).trim();

        const dateText =
          asText(item.pubDate) ||
          asText(item.published);

        const dateValue = Date.parse(dateText);

        if (!headline || !validArticleUrl(link)) continue;

        if (!Number.isFinite(dateValue)) continue;

        if (dateValue < cutoff || dateValue > now + 3600000) {
          continue;
        }

        if (seenUrls.has(link)) continue;
        seenUrls.add(link);

        records.push({
          headline: headline.slice(0, 500),
          source_url: link,
          source_name: source || feed.name,
          region: feed.region,
          language: feed.language,
          published_at: new Date(dateValue).toISOString(),
          verification_status: "pending",
          status: "new"
        });

        if (records.length >= MAX_NEWS_PER_FEED) {
          break;
        }
      }

      if (records.length > 0) {
        const dbResponse = await fetch(
          `${supabaseUrl.replace(/\/+$/, "")}/rest/v1/news_items?on_conflict=source_url`,
          {
            method: "POST",
            headers: {
              apikey: supabaseKey,
              "Content-Type": "application/json",
              Prefer:
                "resolution=ignore-duplicates,return=representation"
            },
            body: JSON.stringify(records),
            signal: AbortSignal.timeout(12000)
          }
        );

        if (!dbResponse.ok) {
          throw new Error(
            `Supabase HTTP ${dbResponse.status}`
          );
        }

        const inserted: unknown = await dbResponse.json();

        if (!Array.isArray(inserted)) {
          throw new Error("Unexpected Supabase response");
        }

        saved += inserted.length;
      }

      successfulFeeds++;

      console.log(
        `[News Hunter] ${feed.name}: processed ${records.length} candidates`
      );

    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unknown error";

      errors.push(`${feed.name}: ${message}`);
      console.error(`[News Hunter] ${feed.name}: ${message}`);
    }
  }

  if (successfulFeeds === 0) {
    throw new Error(
      `All RSS feeds failed: ${errors.join("; ")}`
    );
  }

  console.log(
    `[News Hunter] Scanned: ${scanned}, newly saved: ${saved}`
  );

  return {
    success: errors.length === 0,
    scanned,
    saved,
    errors
  };
}
