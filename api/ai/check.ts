
/**
 * AI Viral Director
 * OpenAI API Connection Test
 *
 * POST /api/ai/check
 *
 * Protected by NEWS_COLLECT_SECRET.
 * Makes one small, fixed OpenAI API request.
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
  const secret = process.env.NEWS_COLLECT_SECRET?.trim();
  const apiKey = process.env.OPENAI_API_KEY?.trim();

  if (!secret || secret.length < 32) {
    return json({
      ok: false,
      error: "Test authentication is not configured"
    }, 503);
  }

  if (
    request.headers.get("authorization") !==
    `Bearer ${secret}`
  ) {
    return json({
      ok: false,
      error: "Unauthorized"
    }, 403);
  }

  if (!apiKey) {
    return json({
      ok: false,
      error: "OPENAI_API_KEY is missing"
    }, 503);
  }

  try {
    const response = await fetch(
      "https://api.openai.com/v1/responses",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model: "gpt-4o-mini",
          input: "Reply with exactly OK.",
          max_output_tokens: 16,
          store: false
        }),
        signal: AbortSignal.timeout(20000)
      }
    );

    if (!response.ok) {
      const errorBody = await response.json().catch(
        () => ({})
      ) as {
        error?: { code?: string };
      };

      return json({
        ok: false,
        openaiStatus: response.status,
        errorCode: errorBody.error?.code ?? "unknown"
      }, 502);
    }

    const data = await response.json() as {
      model?: string;
      status?: string;
      output?: Array<{
        content?: Array<{
          type?: string;
          text?: string;
        }>;
      }>;
      usage?: {
        input_tokens?: number;
        output_tokens?: number;
      };
    };

    const reply = (data.output ?? [])
      .flatMap(item => item.content ?? [])
      .filter(item => item.type === "output_text")
      .map(item => item.text ?? "")
      .join("")
      .trim();

    return json({
      ok: data.status === "completed" && /^OK[.!]?$/i.test(reply),
      model: data.model,
      reply,
      usage: {
        inputTokens: data.usage?.input_tokens ?? 0,
        outputTokens: data.usage?.output_tokens ?? 0
      }
    });

  } catch (error) {
    console.error("[OpenAI Test] Failed:", error);

    return json({
      ok: false,
      error: "OpenAI request failed"
    }, 500);
  }
}

export function GET(): Response {
  return json({
    ok: false,
    error: "Use authorized POST request"
  }, 405);
}
