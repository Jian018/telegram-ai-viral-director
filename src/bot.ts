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
 * Telegram Push Review Center
 * The administrator can inspect news awaiting manual confirmation.
 * Each item has its own buttons; changes are made by a protected Supabase RPC.
 */

type ReviewNews = {
  id: string;
  headline: string;
  language: string;
  source_name: string;
  source_url: string;
  telegram_push_claimed_at: string | null;
  telegram_review_flagged_at: string | null;
  telegram_review_reason: string | null;
};

function reviewButtons(newsId: string): InlineKeyboard {
  return new InlineKeyboard()
    .text("✅ 确认已收到", `review:choose:received:${newsId}`)
    .text("❓ 无法确认", `review:choose:unconfirmed:${newsId}`);
}

function formatReviewDate(value: string | null): string {
  if (!value) return "未记录";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "时间格式异常";

  return (
    date.toLocaleString("zh-SG", {
      timeZone: "Asia/Singapore",
      hour12: false
    }) + " SGT"
  );
}

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
        "id,headline,language,source_name,source_url," +
        "telegram_push_claimed_at," +
        "telegram_review_flagged_at," +
        "telegram_review_reason",
      telegram_push_status: "eq.needs_review",
      order: "telegram_review_flagged_at.desc.nullslast",
      limit: "5"
    });

    const response = await fetch(
      `${supabaseUrl.replace(/\/+$/, "")}/rest/v1/news_items?${query.toString()}`,
      {
        method: "GET",
        headers: {
          apikey: supabaseKey,
          Accept: "application/json"
        },
        signal: AbortSignal.timeout(10000)
      }
    );

    if (!response.ok) {
      throw new Error(`Supabase Review HTTP ${response.status}`);
    }

    const data: unknown = await response.json();
    if (!Array.isArray(data)) {
      throw new Error("Unexpected review response");
    }

    const articles = data as ReviewNews[];
    if (articles.length === 0) {
      await ctx.reply(
        "🔍 AI Viral Director — 推送异常审核中心\n\n" +
          "✅ 当前没有需要人工核查的推送异常。\n\n" +
          "这里只检查 Telegram 推送异常，不是新闻真实性审核。"
      );
      return;
    }

    await ctx.reply(
      "🔍 AI Viral Director — 推送异常审核中心\n\n" +
        `找到 ${articles.length} 条待核查记录。\n\n` +
        "请先核对 Telegram 是否收到对应新闻，再点击按钮。"
    );

    for (const article of articles) {
      const platform =
        article.language === "en" ? "🌍 Instagram" : "🇨🇳 Douyin";

      const link =
        article.source_url.length <= 300
          ? article.source_url
          : "链接较长，请在 Supabase 查看";

      const message = [
        "🔍 推送异常待审核",
        "",
        `📰 ${article.headline.slice(0, 180)}`,
        `📱 平台：${platform}`,
        `📡 来源：${article.source_name.slice(0, 80)}`,
        `🕒 领取：${formatReviewDate(article.telegram_push_claimed_at)}`,
        `⚠️ 标记：${formatReviewDate(article.telegram_review_flagged_at)}`,
        `📝 原因：${(article.telegram_review_reason ?? "发送结果未确认").slice(0, 180)}`,
        `🔗 ${link}`,
        "",
        "请核对 Telegram 收件记录，再选择操作。"
      ].join("\n");

      await ctx.reply(message, {
        reply_markup: reviewButtons(article.id),
        link_preview_options: { is_disabled: true }
      });
    }
  } catch (error) {
    console.error("[Review Center] Error:", error);
    await ctx.reply("❌ 审核中心读取失败，请检查 Vercel Logs。");
  }
}

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



/**
 * Telegram manual review actions, with a two-tap confirmation.
 * The admin-only middleware above also protects these callbacks.
 * A successful database operation writes telegram_push_review_audit.
 */
const reviewActionPattern =
  /^review:(choose|apply|cancel):(received|unconfirmed):([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

bot.callbackQuery(reviewActionPattern, async (ctx) => {
  const adminId = process.env.TELEGRAM_ADMIN_USER_ID?.trim();

  // Require the same private administrator as the main bot.
  if (
    !adminId ||
    ctx.chat?.type !== "private" ||
    String(ctx.from?.id) !== adminId
  ) {
    await ctx.answerCallbackQuery({
      text: "没有操作权限",
      show_alert: true
    });
    return;
  }

  const match = ctx.callbackQuery.data.match(reviewActionPattern);
  if (!match) {
    await ctx.answerCallbackQuery({ text: "无效的审核操作" });
    return;
  }

  const [, stage, action, newsId] = match;

  if (stage === "choose") {
    await ctx.answerCallbackQuery({ text: "请再次确认操作" });

    const label =
      action === "received" ? "✅ 最终确认已收到" : "❓ 确认无法确认";

    const keyboard = new InlineKeyboard()
      .text(label, `review:apply:${action}:${newsId}`)
      .text("↩️ 取消", `review:cancel:${action}:${newsId}`);

    await ctx.editMessageReplyMarkup({ reply_markup: keyboard });
    return;
  }

  if (stage === "cancel") {
    await ctx.answerCallbackQuery({ text: "已取消" });
    await ctx.editMessageReplyMarkup({
      reply_markup: reviewButtons(newsId)
    });
    return;
  }

  // Applying a decision may update Supabase. Acknowledge the tap first.
  await ctx.answerCallbackQuery({ text: "正在保存人工审核结果" });

  const supabaseUrl = process.env.SUPABASE_URL?.trim();
  const supabaseKey = process.env.SUPABASE_SECRET_KEY?.trim();

  if (!supabaseUrl || !supabaseKey) {
    await ctx.reply("❌ Supabase 环境变量缺失，审核未执行。");
    return;
  }

  const decision =
    action === "received" ? "confirmed_received" : "unconfirmed";

  try {
    const response = await fetch(
      `${supabaseUrl.replace(/\/+$/, "")}/rest/v1/rpc/resolve_telegram_push_review`,
      {
        method: "POST",
        headers: {
          apikey: supabaseKey,
          Accept: "application/json",
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          p_news_id: newsId,
          p_decision: decision,
          p_reviewer_telegram_id: String(ctx.from.id)
        }),
        signal: AbortSignal.timeout(10000)
      }
    );

    if (!response.ok) {
      console.error("[Review Action] RPC failed:", response.status);
      await ctx.reply(
        "⚠️ 审核未能确认完成。\n" +
          `HTTP Status: ${response.status}\n` +
          "请先发送 /review 刷新，勿连续重复点击。"
      );
      return;
    }

    const result: unknown = await response.json();
    if (
      !result ||
      typeof result !== "object" ||
      !("success" in result) ||
      result.success !== true
    ) {
      throw new Error("Unexpected review RPC result");
    }

    // Clear buttons only after the database confirmed the decision.
    try {
      await ctx.editMessageReplyMarkup({
        reply_markup: new InlineKeyboard()
      });
    } catch (editError) {
      console.error("[Review Action] Button removal failed:", editError);
    }

    if (decision === "confirmed_received") {
      await ctx.reply(
        "✅ 人工审核完成！\n\n" +
          "确认：Telegram 已收到该新闻。\n" +
          "状态：needs_review → sent\n" +
          "审核日志已保存。\n\n" +
          "原始发送时间和永久配额保持不变。"
      );
    } else {
      await ctx.reply(
        "📝 审核记录已保存。\n\n" +
          "结果：无法确认 Telegram 是否收到。\n" +
          "状态：仍为 needs_review。\n" +
          "系统不会自动重发或释放配额。"
      );
    }
  } catch (error) {
    console.error("[Review Action] Error:", error);
    await ctx.reply(
      "❌ 审核操作出现错误，结果可能尚未确认。\n" +
        "请先检查 Supabase 审核记录并发送 /review 刷新，" +
        "不要连续重复点击。"
    );
  }
});

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
