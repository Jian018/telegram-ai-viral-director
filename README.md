# AI Viral Director — Telegram Bot Phase 1

这是可以部署的 Telegram 私人机器人项目。**当前仅实现 `/start`、`/myid`、菜单和占位回复**，没有真实新闻采集、OpenAI 调用、Supabase 数据库，也没有自动发布。

请看 [SETUP-中文.md](SETUP-中文.md) 获取完整新手部署流程。

## 结构

- `api/health.ts`: Vercel 健康检查
- `api/telegram/webhook.ts`: Telegram Webhook（校验 secret header）
- `src/bot.ts`: 私人 Telegram Bot 和按钮
- `.github/workflows/register-telegram-webhook.yml`: GitHub Actions 一键注册 Webhook
- `public/index.html`: 简单服务说明

## 本地检查（可选）

```bash
npm install
npm run typecheck
```

## 安全

- 不要上传真实 `.env` 或分享 Bot Token。
- `TELEGRAM_BOT_TOKEN` 和 `TELEGRAM_WEBHOOK_SECRET` 在 **Vercel 环境变量** 和 **GitHub Actions Secrets** 中分别设置。
- 管理员 ID 在 Telegram `/myid` 查到后，写入 Vercel `TELEGRAM_ADMIN_USER_ID` 并重新部署。
- 不要将 Telegram Bot Token 放入浏览器网址或 GitHub 仓库。
