
/**
 * AI Viral Director
 * Telegram Notifier - Midnight Safety Version
 *
 * Daily quota:
 * EN: 9 articles
 * ZH: 9 articles
 *
 * Singapore midnight protection:
 * Pause between 23:45 and 00:15 SGT.
 *
 * The database permanently reserves quota.
 */

type Language = "en" | "zh";

type NewsItem = {
  id: string;
  headline: string;
  source_name: string;
  source_url: string;
  published_at: string | null;
  collected_at: string;
};

type IdRow = {
  id: string;
};

const MAX_PER_LANGUAGE = 3;
const PENDING_MAX_AGE_HOURS = 24;

const SGT_OFFSET_MS = 8 * 60 * 60 * 1000;

type SendGate = {
  allowed: boolean;
  day: string;
  time: string;
  reason: string;
};

/**
 * Safely calculate Singapore date and time.
 * Singapore observes UTC+8 year-round.
 *
 * Optional Date input also allows future
 * deterministic unit testing.
 */
export function checkSendGate(
  at: Date = new Date(),
  expectedDay?: string
): SendGate {

  const shifted = new Date(
    at.getTime() + SGT_OFFSET_MS
  );

  const iso = shifted.toISOString();

  const day = iso.slice(0, 10);
  const time = iso.slice(11, 16);

  const minutes =
    shifted.getUTCHours() * 60 +
    shifted.getUTCMinutes();

  // Block 23:45 until 00:15 Singapore time.
  const inQuietWindow =
    minutes >= 23 * 60 + 45 ||
    minutes < 15;

  if (inQuietWindow) {
    return {
      allowed: false,
      day,
      time,
      reason: "Singapore midnight safety window"
    };
  }

  // Block claims that crossed to another day.
  if (expectedDay && day !== expectedDay) {
    return {
      allowed: false,
      day,
      time,
      reason: "Singapore date changed before sending"
    };
  }

  return {
    allowed: true,
    day,
    time,
    reason: "Safe to send"
  };
}

/**
 * Update selected Supabase news records.
 */
async function patchNews<T>(
  baseUrl: string,
  apiKey: string,
  query: URLSearchParams,
  payload: Record<string, unknown>
): Promise<T[]> {

  const response = await fetch(
    `${baseUrl}/rest/v1/news_items?${query.toString()}`,
    {
      method: "PATCH",
      headers: {
        apikey: apiKey,
        Accept: "application/json",
        "Content-Type": "application/json",
        Prefer: "return=representation"
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10000)
    }
  );

  if (!response.ok) {
    throw new Error(
      `Supabase PATCH HTTP ${response.status}`
    );
  }

  const result: unknown = await response.json();

  if (!Array.isArray(result)) {
    throw new Error("Unexpected PATCH response");
  }

  return result as T[];
}

/**
 * Claim news using permanent daily quota RPC.
 */
async function claimNews(
  baseUrl: string,
  apiKey: string,
  language: Language
): Promise<NewsItem[]> {

  const response = await fetch(
    `${baseUrl}/rest/v1/rpc/claim_telegram_news`,
    {
      method: "POST",
      headers: {
        apikey: apiKey,
        Accept: "application/json",
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        p_language: language,
        p_requested: MAX_PER_LANGUAGE
      }),
      signal: AbortSignal.timeout(10000)
    }
  );

  if (!response.ok) {
    throw new Error(
      `Supabase RPC HTTP ${response.status}`
    );
  }

  const result: unknown = await response.json();

  if (!Array.isArray(result)) {
    throw new Error("Unexpected RPC response");
  }

  return result as NewsItem[];
}

/**
 * Safely skip claimed news that must not be sent.
 *
 * Important:
 * The permanent quota reservation is retained.
 * Skipped news will not be automatically reclaimed.
 */
async function skipClaimedNews(
  baseUrl: string,
  apiKey: string,
  articles: NewsItem[]
): Promise<void> {

  if (articles.length === 0) return;

  const ids = articles.map(
    (article) => article.id
  );

  const query = new URLSearchParams({
    id: `in.(${ids.join(",")})`,
    telegram_push_status: "eq.sending",
    select: "id"
  });

  const updated = await patchNews<IdRow>(
    baseUrl,
    apiKey,
    query,
    {
      telegram_push_status: "skipped"
    }
  );

  if (updated.length !== articles.length) {
    throw new Error(
      "Safety skip incomplete. Manual review required."
    );
  }

  console.warn(
    `[Telegram Safety] Skipped ${updated.length} unsent articles`
  );
}

/**
 * Format English/Chinese Telegram summary.
 */
function formatNews(
  articles: NewsItem[],
  language: Language
): string {

  const heading =
    language === "en"
      ? "🌍 Instagram — 新英文科技新闻"
      : "🇨🇳 Douyin — 新中文科技新闻";

  const blocks = articles.map(
    (article, index) => {

      const date = article.published_at
        ? new Date(
            article.published_at
          ).toLocaleString("zh-SG", {
            timeZone: "Asia/Singapore",
            hour12: false
          })
        : "未知";

      const headline =
        article.headline.slice(0, 160);

      const source =
        article.source_name.slice(0, 80);

      const link =
        article.source_url.length <= 500
          ? article.source_url
          : "链接较长，请使用 /today 查看";

      return [
        `${index + 1}. ${headline}`,
        `📡 来源：${source}`,
        `🕒 发布时间：${date} SGT`,
        `🔗 ${link}`
      ].join("\n");
    }
  );

  return [
    heading,
    "",
    blocks.join("\n\n"),
    "",
    "⚠️ 自动收集，尚未经过真实性审核。",
    "📊 每日配额：英文9条 / 中文9条",
    "💡 输入 /today 查看更多新闻。"
  ].join("\n");
}

/**
 * Main Telegram push function.
 */
export async function pushPendingNews() {

  const supabaseUrl =
    process.env.SUPABASE_URL
      ?.trim()
      ?.replace(/\/+$/, "");

  const supabaseKey =
    process.env.SUPABASE_SECRET_KEY?.trim();

  const telegramToken =
    process.env.TELEGRAM_BOT_TOKEN?.trim();

  const adminChatId =
    process.env.TELEGRAM_ADMIN_USER_ID?.trim();

  if (
    !supabaseUrl ||
    !supabaseKey ||
    !telegramToken ||
    !adminChatId
  ) {
    throw new Error(
      "Telegram notifier environment variables missing"
    );
  }

  // STEP 1: Expire old pending news.
  const cutoff = new Date(
    Date.now() -
    PENDING_MAX_AGE_HOURS * 60 * 60 * 1000
  ).toISOString();

  const expireQuery = new URLSearchParams({
    select: "id",
    telegram_push_status: "eq.pending",
    language: "in.(en,zh)",
    collected_at: `lt.${cutoff}`
  });

  const expiredRows = await patchNews<IdRow>(
    supabaseUrl,
    supabaseKey,
    expireQuery,
    {
      telegram_push_status: "skipped"
    }
  );

  console.log(
    `[Telegram Notifier] Expired: ${expiredRows.length}`
  );

  let sentArticles = 0;
  let sentMessages = 0;
  let safetySkipped = 0;

  const errors: string[] = [];

  // STEP 2: Process English and Chinese news.
  for (const language of ["en", "zh"] as const) {

    try {

      // STEP 3: First safety check.
      const beforeClaim = checkSendGate();

      if (!beforeClaim.allowed) {
        console.log(
          `[Telegram Safety] ${language}: ` +
          `Paused at ${beforeClaim.day} ` +
          `${beforeClaim.time} SGT`
        );

        continue;
      }

      // STEP 4: Claim through permanent quota RPC.
      const claimedArticles = await claimNews(
        supabaseUrl,
        supabaseKey,
        language
      );

      if (claimedArticles.length === 0) {
        console.log(
          `[Telegram Notifier] ${language}: ` +
          "No pending news or quota reached"
        );

        continue;
      }

      // STEP 5: Prepare the message.
      const message = formatNews(
        claimedArticles,
        language
      );

      // STEP 6: Check AGAIN immediately before sending.
      const beforeSend = checkSendGate(
        new Date(),
        beforeClaim.day
      );

      if (!beforeSend.allowed) {
        console.warn(
          `[Telegram Safety] ${language}: ` +
          beforeSend.reason
        );

        // Telegram has NOT been called yet.
        // Mark this batch as skipped conservatively.
        await skipClaimedNews(
          supabaseUrl,
          supabaseKey,
          claimedArticles
        );

        safetySkipped += claimedArticles.length;

        continue;
      }

      // STEP 7: Send to Telegram.
      const telegramResponse = await fetch(
        `https://api.telegram.org/bot${telegramToken}/sendMessage`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            chat_id: adminChatId,
            text: message,
            link_preview_options: {
              is_disabled: true
            }
          }),
          signal: AbortSignal.timeout(12000)
        }
      );

      const telegramResult =
        await telegramResponse.json() as {
          ok: boolean;
          description?: string;
        };

      if (
        !telegramResponse.ok ||
        telegramResult.ok !== true
      ) {
        throw new Error(
          `Telegram HTTP ${telegramResponse.status}: ` +
          (telegramResult.description ?? "Send failed")
        );
      }

      // STEP 8: Confirm successful delivery.
      const ids = claimedArticles.map(
        (article) => article.id
      );

      const finishQuery = new URLSearchParams({
        id: `in.(${ids.join(",")})`,
        telegram_push_status: "eq.sending",
        select: "id"
      });

      const updatedRows = await patchNews<IdRow>(
        supabaseUrl,
        supabaseKey,
        finishQuery,
        {
          telegram_push_status: "sent",
          telegram_pushed_at: new Date().toISOString()
        }
      );

      if (updatedRows.length !== claimedArticles.length) {
        throw new Error(
          "Telegram delivered, database confirmation incomplete"
        );
      }

      sentArticles += claimedArticles.length;
      sentMessages++;

      console.log(
        `[Telegram Notifier] ${language}: ` +
        `${claimedArticles.length} articles sent`
      );

    } catch (error) {

      const message =
        error instanceof Error
          ? error.message
          : "Unknown error";

      console.error(
        `[Telegram Notifier] ${language}: ${message}`
      );

      errors.push(`${language}: ${message}`);
    }
  }

  // STEP 9: Return results.
  return {
    success: errors.length === 0,
    sentArticles,
    sentMessages,
    safetySkipped,
    errors
  };
}
