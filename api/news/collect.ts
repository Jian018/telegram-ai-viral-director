
import { collectNews } from "../../src/news-hunter.js";

/**
 * AI Viral Director
 * Secure News Hunter API
 *
 * POST /api/news/collect
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

  // 1. Check server-side secret
  const expectedSecret =
    process.env.NEWS_COLLECT_SECRET?.trim();

  if (!expectedSecret || expectedSecret.length < 32) {
    return json({
      ok: false,
      error: "News collection is not configured"
    }, 503);
  }

  // 2. Protect API against unauthorized access
  const authorization =
    request.headers.get("authorization");

  if (authorization !== `Bearer ${expectedSecret}`) {
    return json({
      ok: false,
      error: "Unauthorized"
    }, 403);
  }

  // 3. Run News Hunter
  try {
    console.log("[News Hunter] Collection started");

    const result = await collectNews();

    console.log(
      "[News Hunter] Collection completed",
      {
        scanned: result.scanned,
        saved: result.saved,
        errors: result.errors.length
      }
    );

    return json({
      ok: result.success,
      scanned: result.scanned,
      saved: result.saved,
      errors: result.errors
    });

  } catch (error) {
    console.error(
      "[News Hunter] Collection failed:",
      error
    );

    return json({
      ok: false,
      error: "News collection failed. Check server logs."
    }, 500);
  }
}

// Do not allow browser GET requests to start a scan.
export function GET(): Response {
  return json({
    ok: false,
    message: "This endpoint only accepts authorized POST requests"
  }, 405);
}
