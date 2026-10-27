
/**
 * AI Viral Director
 * Telegram News Notifier - Daily Quota Version
 *
 * Daily quota (Singapore time):
 * - English: 9 articles
 * - Chinese: 9 articles
 *
 * Maximum per run:
 * - English: 3 articles
 * - Chinese: 3 articles
 *
 * News claims are controlled by Supabase RPC.
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

/**
 * Update news rows in Supabase.
 * Used for expiration and confirming delivery.
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

  const data: unknown = await response.json();

  if (!Array.isArray(data)) {
    throw new Error("Unexpected Supabase PATCH response");
  }

  return data as T[];
}

/**
 * Atomically claim news using the Supabase
 * daily quota database function.
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
    let errorCode = "";

    try {
      const errorData = await response.json() as {
        code?: string;
      };

      errorCode = errorData.code ?? "";
    } catch {
      // No structured error body.
    }

    throw new Error(
      `Supabase RPC HTTP ${response.status}` +
      (errorCode ? ` (${errorCode})` : "")
    );
  }

  const data: unknown = await response.json();

  if (!Array.isArray(data)) {
    throw new Error("Unexpected RPC response");
  }

  return data as NewsItem[];
}

/**
 * Format a compact Telegram summary.
 */
function formatNews(
  articles: NewsItem[],
  language: Language
): string {
  const heading =
    language === "en"
      ? "🌍 Instagram — 新英文科技新闻"
      : "🇨🇳 Douyin — 新中文科技新闻";

  const blocks = articles.map((article, index) => {
    const date = article.published_at
      ? new Date(article.published_at).toLocaleString(
          "zh-SG",
          {
            timeZone: "Asia/Singapore",
            hour12: false
          }
        )
      : "未知";

    const headline = article.headline.slice(0, 160);
    const source = article.source_name.slice(0, 80);

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
  });

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
 * Main Telegram notification function.
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

  // STEP 1: Expire pending news older than 24 hours.
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
  const errors: string[] = [];

  // STEP 2: Process each language separately.
  for (const language of ["en", "zh"] as const) {
    try {
      // STEP 3: Claim through daily quota RPC.
      // The database controls daily quota and locking.
      const claimedArticles = await claimNews(
        supabaseUrl,
        supabaseKey,
        language
      );

      if (claimedArticles.length === 0) {
        console.log(
          `[Telegram Notifier] ${language}: ` +
          "No claimable news or daily quota reached"
        );

        continue;
      }

      console.log(
        `[Telegram Notifier] ${language}: ` +
        `${claimedArticles.length} articles claimed`
      );

      // STEP 4: Prepare Telegram message.
      const message = formatNews(
        claimedArticles,
        language
      );

      // STEP 5: Send notification.
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

      // STEP 6: Record successful Telegram delivery.
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
          "Telegram delivered but database confirmation incomplete"
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

  // STEP 7: Return results to the API.
  return {
    success: errors.length === 0,
    sentArticles,
    sentMessages,
    errors
  };
}
