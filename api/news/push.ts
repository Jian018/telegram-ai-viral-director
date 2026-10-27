
import { pushPendingNews } from "../../src/telegram-notifier.js";

/**
 * AI Viral Director
 * Secure Telegram News Push API
 *
 * POST /api/news/push
 *
 * Requires:
 * Authorization: Bearer NEWS_COLLECT_SECRET
 */

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store"
    }
  });
}

export async function POST(
  request: Request
): Promise<Response> {

  // 1. Verify server-side secret
  const expectedSecret =
    process.env.NEWS_COLLECT_SECRET?.trim();

  if (!expectedSecret || expectedSecret.length < 32) {
    return json({
      ok: false,
      error: "Telegram push is not configured"
    }, 503);
  }

  // 2. Block unauthorized requests
  const authorization =
    request.headers.get("authorization");

  if (authorization !== `Bearer ${expectedSecret}`) {
    return json({
      ok: false,
      error: "Unauthorized"
    }, 403);
  }

  // 3. Run Telegram notifier
  try {
    console.log("[Telegram Push] Starting");

    const result = await pushPendingNews();

    console.log("[Telegram Push] Completed", {
      success: result.success,
      sentArticles: result.sentArticles,
      sentMessages: result.sentMessages,
      errors: result.errors.length
    });

    return json({
      ok: result.success,
      sentArticles: result.sentArticles,
      sentMessages: result.sentMessages,
      errors: result.errors
    }, result.success ? 200 : 500);

  } catch (error) {
    console.error("[Telegram Push] Failed:", error);

    return json({
      ok: false,
      error: "Telegram push failed. Check Vercel Logs."
    }, 500);
  }
}

// Prevent browser GET requests from triggering push.
export function GET(): Response {
  return json({
    ok: false,
    message: "This endpoint requires authorized POST"
  }, 405);
}
