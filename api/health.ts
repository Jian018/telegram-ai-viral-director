export default {
  fetch(): Response {
    return Response.json({
      ok: true,
      name: "AI Viral Director",
      phase: "phase-1",
      note: "Telegram bot API health check (no news or AI integration yet)",
    });
  },
};
