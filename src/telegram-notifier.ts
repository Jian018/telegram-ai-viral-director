
/**
 * AI Viral Director
 * Telegram News Notifier - Phase 1
 *
 * Sends new, pending news to the private admin.
 * Maximum 3 English + 3 Chinese news per run.
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


async function databaseRows<T>(
  baseUrl: string,
  apiKey: string,
  query: URLSearchParams,
  method: "GET" | "PATCH" = "GET",
  payload?: Record<string, unknown>
): Promise<T[]> {
  const headers: Record<string, string> = {
    apikey: apiKey,
    Accept: "application/json"
  };

  if (method === "PATCH") {
    headers["Content-Type"] = "application/json";
    headers["Prefer"] = "return=representation";
  }

  const response = await fetch(
    `${baseUrl}/rest/v1/news_items?${query.toString()}`,
    {
      method,
      headers,
      body: payload ? JSON.stringify(payload) : undefined,
      signal: AbortSignal.timeout(10000)
    }
  );

  if (!response.ok) {
    throw new Error(
      `Supabase HTTP ${response.status}`
    );
  }

  const data: unknown = await response.json();

  if (!Array.isArray(data)) {
    throw new Error("Unexpected Supabase response");
  }

  return data as T[];
}

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

    // Keep Telegram messages below the size limit.
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
    "💡 输入 /today 查看更多新闻。"
  ].join("\n");
}

export async function pushPendingNews() {
  const supabaseUrl =
    process.env.SUPABASE_URL?.trim()?.replace(/\/+$/, "");

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

  // Skip pending news collected over 24 hours ago.
  const cutoff = new Date(
    Date.now() - PENDING_MAX_AGE_HOURS * 60 * 60 * 1000
  ).toISOString();

  const expireQuery = new URLSearchParams({
    select: "id",
    telegram_push_status: "eq.pending",
    language: "in.(en,zh)",
    collected_at: `lt.${cutoff}`
  });

  const expiredRows = await databaseRows<IdRow>(
    supabaseUrl,
    supabaseKey,
    expireQuery,
    "PATCH",
    {
      telegram_push_status: "skipped"
    }
  );

  console.log(
    `[Telegram Notifier] Expired pending news: ${expiredRows.length}`
  );

  let sentArticles = 0;
  let sentMessages = 0;
  const errors: string[] = [];

  for (const language of ["en", "zh"] as const) {
    try {
      // 1. Get news not yet pushed to Telegram.
     const findQuery = new URLSearchParams({
  select:
    "id,headline,source_name,source_url,published_at,collected_at",
  telegram_push_status: "eq.pending",
  language: `eq.${language}`,
  collected_at: `gte.${cutoff}`,
  order: "collected_at.desc",
  limit: String(MAX_PER_LANGUAGE)
});


      const candidates = await databaseRows<NewsItem>(
        supabaseUrl,
        supabaseKey,
        findQuery
      );

      if (candidates.length === 0) {
        console.log(
          `[Telegram Notifier] No pending ${language} news`
        );
        continue;
      }

      // 2. Claim pending rows before sending.
      // Conditional updates help prevent concurrent jobs
      // from claiming the same rows.
      const ids = candidates.map((item) => item.id);

      const claimQuery = new URLSearchParams({
        id: `in.(${ids.join(",")})`,
        telegram_push_status: "eq.pending",
        select: "id"
      });

      const claimedRows = await databaseRows<IdRow>(
        supabaseUrl,
        supabaseKey,
        claimQuery,
        "PATCH",
        {
          telegram_push_status: "sending",
          telegram_push_claimed_at:
            new Date().toISOString()
        }
      );

      const claimedIds = new Set(
        claimedRows.map((item) => item.id)
      );

      const claimedArticles = candidates.filter(
        (item) => claimedIds.has(item.id)
      );

      if (claimedArticles.length === 0) {
        continue;
      }

      // 3. Send one summary message per language.
      const message = formatNews(
        claimedArticles,
        language
      );

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

      const telegramResult = await telegramResponse.json() as {
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

      // 4. Record successful delivery in Supabase.
      const finishQuery = new URLSearchParams({
        id: `in.(${claimedArticles.map(
          (item) => item.id
        ).join(",")})`,
        telegram_push_status: "eq.sending",
        select: "id"
      });

      const updatedRows = await databaseRows<IdRow>(
        supabaseUrl,
        supabaseKey,
        finishQuery,
        "PATCH",
        {
          telegram_push_status: "sent",
          telegram_pushed_at: new Date().toISOString()
        }
      );

      if (updatedRows.length !== claimedArticles.length) {
        throw new Error(
          "Telegram delivered, but not all database rows were confirmed"
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

  return {
    success: errors.length === 0,
    sentArticles,
    sentMessages,
    errors
  };
}
