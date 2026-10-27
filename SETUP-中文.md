# 从 0 到 Telegram `/start` 可以回复 — 新手操作指南

你已经有 Telegram Bot、GitHub Repository、OpenAI 账号、Supabase 项目 `AI Viral Director`。
**这次先不连接 OpenAI 与 Supabase。**

## 第一步：把真正的代码放进 GitHub

1. 下载并解压 `telegram-ai-viral-director-phase1.zip`。
2. 打开 GitHub 的 `telegram-ai-viral-director` 仓库。
3. 点击 **Add file → Upload files**。
4. 将解压后的文件和文件夹（`api`、`src`、`public`、`.github`、`package.json`、`tsconfig.json`、`README.md` 等）拖入上传区。**要上传文件夹内部的真实文件，不能只上传 ZIP。**
5. 如有 `.github` 隐藏不显示，Mac Finder 可用 Command + Shift + . 显示隐藏文件，再拖入；也可以在 GitHub 直接按路径建立 `.github/workflows/register-telegram-webhook.yml`。
6. 点击底部 **Commit changes**。
7. 回到 GitHub 仓库首页，确保能看到 `api/`、`src/`、`.github/` 等目录。

## 第二步：将 GitHub Repo 连接 Vercel

1. 打开 https://vercel.com/new
2. Import Git Repository，选择 `telegram-ai-viral-director`。
3. 如果没有列出仓库，点击 Vercel 的 **Adjust GitHub App Permissions**，授权这个仓库；再次返回 Import。
4. Framework Preset 选择 **Other**；Root Directory 维持 `./`；不要指定额外的 Build Command。
5. 在 Environment Variables 中增加：
   - `TELEGRAM_BOT_TOKEN` = BotFather 提供的真实 Token
   - `TELEGRAM_WEBHOOK_SECRET` = 你自己生成的随机密钥（例如 40+ 位仅英文大小写、数字、下划线和连字符）
6. 不要把这些密钥发给任何人，也不要写入 GitHub 文件。
7. Deploy。
8. 到部署的 **Production** 域名打开 `https://你的域名.vercel.app/api/health`。
9. 预期：`{"ok":true,"name":"AI Viral Director",...}`。

> 要先完成接下来的第三步，Telegram 才会回复 `/start`。部署网站不等于 Webhook 已经自动注册。

## 第三步：在 GitHub 注册 Telegram Webhook（无须终端）

1. GitHub 仓库打开 **Settings → Secrets and variables → Actions**。
2. 在 **Repository secrets** 中点击 **New repository secret**，分别建立：
   - `TELEGRAM_BOT_TOKEN`：和 Vercel 完全相同的 Token
   - `TELEGRAM_WEBHOOK_SECRET`：和 Vercel 完全相同的 Secret
3. GitHub 仓库打开 **Actions**。
4. 左侧选择 **Register Telegram Webhook**。
5. 点击 **Run workflow**。
6. `deployment_url` 输入你的 **生产域名**，如 `https://你的项目.vercel.app`（不要加 `/api/health`）。
7. 再次点击 **Run workflow**，等待任务显示绿色成功标记。
8. 如果左侧没有这个工作流，检查 `.github/workflows/register-telegram-webhook.yml` 是否上传，或是否需要在仓库 Actions 中启用工作流。

## 第四步：取得自己的 Telegram ID

1. 打开自己创建的 Telegram Bot，点击 **Start** 或发送 `/myid`。
2. 收到 `Telegram User ID` 和 `Chat ID`。
3. 返回 Vercel → Project → Settings → Environment Variables。
4. 新增 `TELEGRAM_ADMIN_USER_ID`，值为 User ID（纯数字）。
5. 在 Vercel **Deployments** 页面选择最新生产部署并 **Redeploy**，使新的管理员变量生效。
6. 回到 Telegram，发送 `/start`。
7. 机器人应回复欢迎词和六个按钮；按钮对应下一阶段功能，会诚实回复“尚未接入”。

## 常见问题

- `/start` 完全没有回应：先看 GitHub Actions Webhook 注册是否绿色成功，再看 Vercel → Logs（Functions）。检查是否使用 **Production** 域名、Token 是否正确。
- `/myid` 回复了但 `/start` 说需要管理员：检查 `TELEGRAM_ADMIN_USER_ID` 和是否重新部署。
- Vercel 看不到 GitHub Repo：确认仓库里有真正的文件；然后检查 Vercel 的 GitHub 安装授权是否包括这个仓库。
- 健康检查 404：检查 `api/health.ts` 是否存在，部署的根目录是否正确。
- GitHub Actions 找不到工作流：检查隐藏 `.github` 文件夹是否成功上传。
- 不要将 Bot Token、OpenAI API Key 或 Supabase Secret 截图/粘贴到聊天中。

## 下一阶段

确保 `/start` 正常后，再连接 `AI Viral Director` Supabase，最后接 OpenAI 和实时新闻源。
