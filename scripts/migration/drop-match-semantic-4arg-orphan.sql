-- Drop the orphaned 4-arg match_semantic from Supabase.
--
-- Background: the original match_semantic was deployed with 4 args
-- (query_embedding, match_threshold, match_count, filter_tenant_id) in PR #1769.
-- PR #1776 added language and year filters by extending the signature to 7 args.
-- Postgres treats different-arity functions as separate definitions, so the
-- CREATE OR REPLACE in PR #1776 *added* the 7-arg version without removing the
-- 4-arg one. Both versions coexisted for ~30 minutes on 2026-05-16, breaking
-- all calls that didn't pass every arg by name — supabase.rpc() reported:
--
--   "Could not choose the best candidate function between:
--      public.match_semantic(vector, double precision, integer, text),
--      public.match_semantic(vector, double precision, integer, text, text, integer, integer)"
--
-- The lib was updated to always pass all 7 named args, which restored service.
-- This migration removes the now-orphan 4-arg version so future callers can
-- safely use defaults again.
--
-- Safe to run: no current caller passes exactly 4 args (verified in
-- src/lib/semantic-search.ts after PR #1776).

DROP FUNCTION IF EXISTS match_semantic(
  vector(768),
  FLOAT,
  INT,
  TEXT
);

-- Verify only the 7-arg version remains:
--   SELECT pg_get_function_identity_arguments(oid)
--   FROM pg_proc
--   WHERE proname = 'match_semantic';
-- Should return one row.
