import { webhookCallback } from "grammy";
import { bot } from "../../src/bot.js";

// The route is /api/telegram/webhook on Vercel.
// Important: this must be a webhook, never bot.start() / long polling.
export default {
  async fetch(request: Request): Promise<Response> {
    if (request.method !== "POST") {
      return new Response("Method Not Allowed", { status: 405 });
    }

    const expectedSecret = process.env.TELEGRAM_WEBHOOK_SECRET;
    if (!expectedSecret) {
      return new Response("Webhook secret not configured", { status: 503 });
    }

    // Telegram sends this secret header after setWebhook(secret_token=...).
    if (
      request.headers.get("x-telegram-bot-api-secret-token") !==
      expectedSecret
    ) {
      return new Response("Forbidden", { status: 403 });
    }

    try {
      const handleUpdate = webhookCallback(bot, "std/http");
      return await handleUpdate(request);
    } catch (error) {
      console.error("Failed to handle Telegram update", error);
      return new Response("Webhook processing error", { status: 500 });
    }
  },
};
