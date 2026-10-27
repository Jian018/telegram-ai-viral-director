import { Bot, InlineKeyboard, type Context } from "grammy";


const telegramToken = process.env.TELEGRAM_BOT_TOKEN;
if (!telegramToken) {
  throw new Error("TELEGRAM_BOT_TOKEN must be set on the server");
}

export const bot = new Bot(telegramToken);

const menu = new InlineKeyboard()
  .text("📰 今日热点", "menu:today")
  .text("💡 AI 创意", "menu:ideas")
  .row()
  .text("🎬 视频 Prompt", "menu:prompts")
  .text("🔍 审核中心", "menu:review")
  .row()
  .text("🗂 历史记录", "menu:history")
  .text("⚙️ 设置", "menu:settings");

// /myid is deliberately public: it shows the sender ONLY their own IDs.
// Use it once, then configure TELEGRAM_ADMIN_USER_ID on Vercel.
bot.command("myid", async (ctx) => {
  await ctx.reply(
    `你的 Telegram User ID：${ctx.from?.id ?? "未知"}\n` +
      `当前 Chat ID：${ctx.chat?.id ?? "未知"}\n\n` +
      "将 User ID 填入 Vercel 的 TELEGRAM_ADMIN_USER_ID，随后重新部署。"
  );
});

// Phase 1 is admin-only; until an admin is configured, only /myid works.
bot.use(async (ctx, next) => {
  const adminId = process.env.TELEGRAM_ADMIN_USER_ID?.trim();
  if (!adminId) {
    if (ctx.chat?.type === "private") {
      await ctx.reply(
        "机器人已连接！请先发送 /myid，接着到 Vercel 设置 TELEGRAM_ADMIN_USER_ID，并重新部署。"
      );
    }
    return;
  }

  if (ctx.chat?.type !== "private" || String(ctx.from?.id) !== adminId) {
    // Never disclose bot functionality to strangers or group chats.
    return;
  }
  await next();
});

bot.command("start", (ctx) =>
  ctx.reply(
    "🎬 欢迎使用 AI Viral Director！\n\n" +
      "这里将成为你的私人 AI 热点视频策划工作室。\n" +
      "第一阶段：Telegram 连接成功。\n\n" +
      "👇 请选择功能：",
    { reply_markup: menu }
  )
);



async function sendTodayNews(ctx: Context) {
  const supabaseUrl = process.env.SUPABASE_URL?.trim();
  const supabaseKey = process.env.SUPABASE_SECRET_KEY?.trim();

  if (!supabaseUrl || !supabaseKey) {
    await ctx.reply("❌ Supabase 尚未配置。");
    return;
  }

  try {
    for (const language of ["en", "zh"] as const) {
      const query = new URLSearchParams({
        select: "headline,source_name,source_url,published_at",
        language: `eq.${language}`,
        published_at: "not.is.null",
        order: "published_at.desc",
        limit: "3"
      });

      const endpoint =
        `${supabaseUrl.replace(/\/+$/, "")}` +
        `/rest/v1/news_items?${query.toString()}`;

      const response = await fetch(endpoint, {
        method: "GET",
        headers: {
          apikey: supabaseKey,
          Accept: "application/json"
        },
        signal: AbortSignal.timeout(10000)
      });

      if (!response.ok) {
        throw new Error(`Supabase HTTP ${response.status}`);
      }

      const articles = (await response.json()) as Array<{
        headline: string;
        source_name: string;
        source_url: string;
        published_at: string;
      }>;

      const heading =
        language === "en"
          ? "🌍 Instagram — 英文科技热点"
          : "🇨🇳 Douyin — 中文科技热点";

      if (articles.length === 0) {
        await ctx.reply(`${heading}\n\n暂无新闻。`);
        continue;
      }

      const newsText = articles
        .map((article, index) => {
          const published = new Date(
            article.published_at
          ).toLocaleString("zh-SG", {
            timeZone: "Asia/Singapore",
            hour12: false
          });

          return [
            `${index + 1}. ${article.headline.slice(0, 200)}`,
            `📡 来源：${article.source_name}`,
            `🕒 发布时间：${published} SGT`,
            `🔗 ${article.source_url}`
          ].join("\n");
        })
        .join("\n\n");

      await ctx.reply(
        `${heading}\n\n${newsText}` +
          "\n\n⚠️ 自动采集新闻，尚未核实。",
        {
          link_preview_options: {
            is_disabled: true
          }
        }
      );
    }
  } catch (error) {
    console.error("[Today News] Error:", error);

    await ctx.reply(
      "❌ 读取最新新闻失败，请检查 Vercel Logs。"
    );
  }
}
bot.command("today", sendTodayNews);

/**
 * AI Viral Director
 * Telegram Push Review Center
 *
 * Read-only: displays news requiring
 * manual Telegram delivery verification.
 */

async function sendReviewQueue(ctx: Context) {
  const supabaseUrl = process.env.SUPABASE_URL?.trim();
  const supabaseKey = process.env.SUPABASE_SECRET_KEY?.trim();

  if (!supabaseUrl || !supabaseKey) {
    await ctx.reply("❌ Supabase 尚未配置。");
    return;
  }

  try {
    const query = new URLSearchParams({
      select:
        "headline,language,source_name,source_url," +
        "telegram_push_claimed_at," +
        "telegram_review_flagged_at," +
        "telegram_review_reason",
      telegram_push_status: "eq.needs_review",
      order: "telegram_review_flagged_at.desc.nullslast",
      limit: "5"
    });

    const endpoint =
      `${supabaseUrl.replace(/\/+$/, "")}` +
      `/rest/v1/news_items?${query.toString()}`;

    const response = await fetch(endpoint, {
      method: "GET",
      headers: {
        apikey: supabaseKey,
        Accept: "application/json"
      },
      signal: AbortSignal.timeout(10000)
    });

    if (!response.ok) {
      throw new Error(
        `Supabase Review HTTP ${response.status}`
      );
    }

    type ReviewNews = {
      headline: string;
      language: string;
      source_name: string;
      source_url: string;
      telegram_push_claimed_at: string | null;
      telegram_review_flagged_at: string | null;
      telegram_review_reason: string | null;
    };

    const articles: unknown = await response.json();

    if (!Array.isArray(articles)) {
      throw new Error("Unexpected review response");
    }

    const news = articles as ReviewNews[];

    // No news currently requires manual review.
    if (news.length === 0) {
      await ctx.reply(
        "🔍 AI Viral Director — 推送异常审核中心\n\n" +
        "✅ 当前没有需要人工核查的推送异常。\n\n" +
        "系统会继续检查超时的 sending 记录。\n\n" +
        "注意：这里检查的是 Telegram 推送异常，" +
        "不是新闻真实性审核。"
      );
      return;
    }

    const formatDate = (value: string | null): string => {
      if (!value) return "未记录";

      const date = new Date(value);

      if (Number.isNaN(date.getTime())) {
        return "时间格式异常";
      }

      return date.toLocaleString("zh-SG", {
        timeZone: "Asia/Singapore",
        hour12: false
      }) + " SGT";
    };

    const blocks = news.map((item, index) => {
      const platform =
        item.language === "en"
          ? "🌍 Instagram"
          : "🇨🇳 Douyin";

      const link =
        item.source_url.length <= 250
          ? item.source_url
          : "链接较长，请在 Supabase 查看";

      return [
        `${index + 1}. ${item.headline.slice(0, 160)}`,
        `📱 平台：${platform}`,
        `📡 来源：${item.source_name.slice(0, 60)}`,
        `🕒 领取：${formatDate(item.telegram_push_claimed_at)}`,
        `⚠️ 标记：${formatDate(item.telegram_review_flagged_at)}`,
        `📝 原因：${(item.telegram_review_reason ?? "发送结果未确认").slice(0, 150)}`,
        `🔗 ${link}`
      ].join("\n");
    });

    const message =
      "🔍 AI Viral Director — 推送异常审核中心\n\n" +
      `最近 ${news.length} 条待核查记录：\n\n` +
      blocks.join("\n\n") +
      "\n\n⚠️ 请先检查 Telegram 是否实际收到消息。" +
      "\n不要直接重发，也不要删除永久配额记录。";

    await ctx.reply(message, {
      link_preview_options: {
        is_disabled: true
      }
    });

  } catch (error) {
    console.error("[Review Center] Error:", error);

    await ctx.reply(
      "❌ 读取审核中心失败，请检查 Vercel Logs。"
    );
  }
}

// Allow manual review using /review.
bot.command("review", sendReviewQueue);

bot.command("latest", (ctx) =>
  ctx.reply("🔄 最新新闻抓取：下一阶段开放；目前不会提供虚假热点。")
);
bot.command("ideas", (ctx) =>
  ctx.reply("💡 AI 创意：下一阶段接入 OpenAI 后开放。")
);
bot.command("prompts", (ctx) =>
  ctx.reply("🎬 Prompt 生成：下一阶段开放。")
);
bot.command("history", (ctx) =>
  ctx.reply("🗂 历史记录：下一阶段连接 Supabase 后开放。")
);
bot.command("settings", (ctx) =>
  ctx.reply("⚙️ 当前已启用私人管理员限制。详细设置下一阶段开放。")
);


bot.callbackQuery(
  /^menu:(today|ideas|prompts|review|history|settings)$/,
  async (ctx) => {
    await ctx.answerCallbackQuery();

    const action = ctx.callbackQuery.data.slice(
      "menu:".length
    );

    // 📰 Today News: read real news from Supabase
    if (action === "today") {
      await sendTodayNews(ctx);
      return;
    }

    if (action === "review") {
      await sendReviewQueue(ctx);
      return;
    }

    
    // Other menu functions remain unchanged
    const names: Record<string, string> = {
      ideas: "💡 AI 创意：OpenAI 还未接入。",
      prompts: "🎬 视频 Prompt：OpenAI 还未接入。",
      review: "🔍 审核中心：AI Critic 还未接入。",
      history: "🗂 历史记录：Supabase 还未接入。",
      settings: "⚙️ 设置：当前为私人机器人，后续会增加更多配置。"
    };

    await ctx.reply(
      names[action] ?? "未知功能",
      { reply_markup: menu }
    );
  }
);



bot.command("dbcheck", async (ctx) => {
  const supabaseUrl = process.env.SUPABASE_URL?.trim();
  const supabaseKey = process.env.SUPABASE_SECRET_KEY?.trim();

  if (!supabaseUrl || !supabaseKey) {
    await ctx.reply(
      "❌ Supabase 环境变量尚未配置。"
    );
    return;
  }

  try {
    const response = await fetch(
      `${supabaseUrl.replace(/\/+$/, "")}/rest/v1/news_items?select=id&limit=1`,
      {
        method: "GET",
        headers: {
          apikey: supabaseKey,
          Accept: "application/json"
        },
        signal: AbortSignal.timeout(8000)
      }
    );

    if (!response.ok) {
      console.error(
        "Supabase check failed:",
        response.status
      );

      await ctx.reply(
        `❌ Supabase 连接失败。\nHTTP Status: ${response.status}`
      );
      return;
    }

    const data: unknown = await response.json();

    if (!Array.isArray(data)) {
      throw new Error("Unexpected database response");
    }

    await ctx.reply(
      "✅ Supabase 数据库连接成功！\n\n" +
      "📁 Project: AI Viral Director\n" +
      "📊 Table: news_items\n" +
      "🔒 Access: Private Server\n\n" +
      "数据库已经可以读取。"
    );

  } catch (error) {
    console.error("Supabase connection error:", error);

    await ctx.reply(
      "❌ 数据库连接测试出现错误。\n请检查 Vercel Logs。"
    );
  }
});


/**
 * NEWS HUNTER - PHASE 1
 * Manually save real news to Supabase.
 *
 * Usage:
 * /savenews Title | https://article-url | Source
 */

bot.command("savenews", async (ctx) => {
  const input = ctx.match.trim();
  const parts = input.split("|").map((x) => x.trim());

  if (parts.length !== 3 || parts.some((x) => !x)) {
    await ctx.reply(
      "📰 新闻储存格式：\n\n" +
      "/savenews 新闻标题 | 新闻网址 | 新闻来源\n\n" +
      "请提供真实新闻链接。"
    );
    return;
  }

  const [headline, sourceUrl, sourceName] = parts;

  if (headline.length > 300 || sourceName.length > 100) {
    await ctx.reply("❌ 新闻标题或来源名称过长。");
    return;
  }

  let parsedUrl: URL;

  try {
    parsedUrl = new URL(sourceUrl);

    if (
      parsedUrl.protocol !== "https:" ||
      !parsedUrl.hostname.includes(".")
    ) {
      throw new Error("Invalid HTTPS URL");
    }
  } catch {
    await ctx.reply("❌ 请输入有效的 HTTPS 新闻链接。");
    return;
  }

  const supabaseUrl = process.env.SUPABASE_URL?.trim();
  const supabaseKey = process.env.SUPABASE_SECRET_KEY?.trim();

  if (!supabaseUrl || !supabaseKey) {
    await ctx.reply("❌ Supabase 环境变量未配置。");
    return;
  }

  try {
    const response = await fetch(
      `${supabaseUrl.replace(/\/+$/, "")}/rest/v1/news_items`,
      {
        method: "POST",
        headers: {
          apikey: supabaseKey,
          "Content-Type": "application/json",
          Prefer: "return=minimal"
        },
        body: JSON.stringify({
          headline,
          source_url: parsedUrl.href,
          source_name: sourceName,
          language: /[\u3400-\u9fff]/.test(headline)
            ? "zh"
            : "en",
          verification_status: "pending",
          status: "new"
        }),
        signal: AbortSignal.timeout(8000)
      }
    );

    if (response.status === 409) {
      await ctx.reply(
        "ℹ️ 这条新闻的网址已存在于数据库，不需要重复保存。"
      );
      return;
    }

    if (!response.ok) {
      console.error("News insert failed:", response.status);
      await ctx.reply(
        `❌ 新闻保存失败。\nHTTP Status: ${response.status}`
      );
      return;
    }

    await ctx.reply(
      "✅ 新闻保存成功！\n\n" +
      `📰 标题：${headline}\n` +
      `📡 来源：${sourceName}\n` +
      `🔗 链接：${parsedUrl.href}\n\n` +
      "📁 已储存到 Supabase\n" +
      "🔍 状态：待核实\n\n" +
      "下一阶段将加入自动新闻收集和 AI 热点分析。",
      { link_preview_options: { is_disabled: true } }
    );

  } catch (error) {
    console.error("News storage error:", error);

    await ctx.reply(
      "❌ 新闻保存时出现错误，请检查 Vercel Logs。"
    );
  }
});


bot.on("message:text", (ctx) =>
  ctx.reply("请输入 /start 打开主菜单，或 /myid 查看自己的 Telegram User ID。")
);
