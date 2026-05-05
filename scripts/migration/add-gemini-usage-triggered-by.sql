-- Add provenance source attribution to gemini_usage.
-- Tracks who/what triggered the AI call:
--   cron          — scheduled job (Hetzner cron, Vercel cron)
--   manual        — HTTP-triggered admin action
--   auto_recovery — Lambda re-runner picking up stuck jobs
--   worker        — unattended worker loop on Hetzner
--   unknown       — legacy rows or unset (default)
--
-- Safe to run repeatedly; column add and index are idempotent.

ALTER TABLE gemini_usage ADD COLUMN IF NOT EXISTS triggered_by TEXT;

CREATE INDEX IF NOT EXISTS idx_gemini_usage_triggered_by
  ON gemini_usage (triggered_by, timestamp DESC)
  WHERE triggered_by IS NOT NULL;

COMMENT ON COLUMN gemini_usage.triggered_by IS
  'Provenance source: cron | manual | auto_recovery | worker | unknown';
