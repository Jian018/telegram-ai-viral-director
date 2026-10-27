-- AI Viral Director — Step 16.5
-- Separate daily limit for creative-potential scoring, independent of fact-check quota.
-- This migration does not call OpenAI and does not modify existing review data.
BEGIN;

CREATE TABLE IF NOT EXISTS public.news_ai_score_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  news_id uuid NOT NULL REFERENCES public.news_items(id) ON DELETE RESTRICT,
  quota_day_sgt date NOT NULL,
  status text NOT NULL DEFAULT 'reserved'
    CHECK (status IN ('reserved', 'completed', 'failed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (news_id, quota_day_sgt)
);

CREATE INDEX IF NOT EXISTS idx_news_ai_score_attempts_day
  ON public.news_ai_score_attempts (quota_day_sgt);

ALTER TABLE public.news_ai_score_attempts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.news_ai_score_attempts FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.news_ai_score_attempts TO service_role;

CREATE OR REPLACE FUNCTION public.reserve_news_ai_score(p_news_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_day date;
  v_used integer;
  v_reservation uuid;
  v_verdict text;
  v_en integer;
  v_zh integer;
BEGIN
  IF p_news_id IS NULL THEN
    RETURN pg_catalog.jsonb_build_object('allowed', false, 'reason', 'missing_news_id');
  END IF;

  -- Serialize today's quota claims; also protects concurrent requests for the same news.
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('ai_viral_daily_creative_scores')
  );

  v_day := (pg_catalog.clock_timestamp() AT TIME ZONE 'Asia/Singapore')::date;

  IF NOT EXISTS (
    SELECT 1 FROM public.news_items
    WHERE id = p_news_id AND status <> 'archived'
  ) THEN
    RETURN pg_catalog.jsonb_build_object('allowed', false, 'reason', 'news_missing_or_archived');
  END IF;

  SELECT r.verification_result, r.instagram_score, r.douyin_score
  INTO v_verdict, v_en, v_zh
  FROM public.news_ai_reviews AS r
  WHERE r.news_id = p_news_id
  ORDER BY r.reviewed_at DESC, r.id DESC
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN pg_catalog.jsonb_build_object('allowed', false, 'reason', 'verify_first');
  END IF;

  IF v_verdict = 'rejected' THEN
    RETURN pg_catalog.jsonb_build_object('allowed', false, 'reason', 'rejected_news');
  END IF;

  IF v_en IS NOT NULL OR v_zh IS NOT NULL THEN
    RETURN pg_catalog.jsonb_build_object('allowed', false, 'reason', 'latest_review_already_scored');
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.news_ai_score_attempts
    WHERE news_id = p_news_id AND quota_day_sgt = v_day
  ) THEN
    RETURN pg_catalog.jsonb_build_object('allowed', false, 'reason', 'already_attempted_today');
  END IF;

  SELECT COUNT(*)::integer INTO v_used
  FROM public.news_ai_score_attempts
  WHERE quota_day_sgt = v_day;

  IF v_used >= 3 THEN
    RETURN pg_catalog.jsonb_build_object('allowed', false, 'reason', 'daily_score_limit_reached');
  END IF;

  INSERT INTO public.news_ai_score_attempts(news_id, quota_day_sgt)
  VALUES (p_news_id, v_day)
  RETURNING id INTO v_reservation;

  RETURN pg_catalog.jsonb_build_object(
    'allowed', true,
    'reservation_id', v_reservation,
    'remaining_today', 2 - v_used
  );
END;
$$;

REVOKE ALL ON FUNCTION public.reserve_news_ai_score(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_news_ai_score(uuid) TO service_role;

NOTIFY pgrst, 'reload schema';
COMMIT;
