import { Bot, InlineKeyboard } from "grammy";

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

bot.command("today", (ctx) =>
  ctx.reply("📰 今日热点：暂未连接真实新闻来源。下一阶段开放。")
);
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

bot.callbackQuery(/^menu:(today|ideas|prompts|review|history|settings)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const names: Record<string, string> = {
    today: "📰 今日热点：新闻抓取将在下一阶段开放。",
    ideas: "💡 AI 创意：OpenAI 还未接入。",
    prompts: "🎬 视频 Prompt：OpenAI 还未接入。",
    review: "🔍 审核中心：AI Critic 还未接入。",
    history: "🗂 历史记录：Supabase 还未接入。",
    settings: "⚙️ 设置：当前为私人机器人，后续会增加更多配置。",
  };
  const action = ctx.callbackQuery.data.slice("menu:".length);
  await ctx.reply(names[action] ?? "未知功能", { reply_markup: menu });
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


bot.on("message:text", (ctx) =>
  ctx.reply("请输入 /start 打开主菜单，或 /myid 查看自己的 Telegram User ID。")
);
