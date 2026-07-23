# Weekly site digest routine + first-digest fixes — 2026-07-23

## What was built

**Weekly monitoring digest** (health + progress + usage), emailed every Monday
08:15 Amsterdam. Cloud routine `trig_01UUrZexQUuDZm6rV1f3qWu3`
(claude.ai/code/routines) curls two admin endpoints and POSTs the composed
digest to `/api/admin/alert` (Resend → ALERT_RECIPIENT, default
derek@playpowerlabs.com). Complements — does not replace — the hourly Hetzner
failure alerts. The old daily cloud health-alert routine was found deleted;
deliberately NOT recreated.

- **New endpoint:** `GET /api/admin/metrics-snapshot` (PR #3321) — read-only
  JSON of cached snapshots (`metrics_snapshot`, `metrics_history` via
  `?history=N`, `data_page_snapshot`, `homepage_stats`, pause flag +
  `batch_health`). Admin session or Bearer CRON_SECRET. No new aggregation.
- **Routine env gotcha:** the Default cloud environment uses "Trusted" egress,
  which **blocks sourcelibrary.org** (CONNECT 403 at the sandbox proxy — first
  test run failed this way). The routine runs on its own environment
  `env_01EwCaRYbeeNm8o8iQAYEL97` ("Digest (sourcelibrary.org only)", Custom
  allowlist = sourcelibrary.org only). Any future cloud routine that must reach
  the site needs a Custom env, not Default.
- CRON_SECRET is embedded in the routine prompt (approved trade-off). Rotating
  the secret requires updating the routine.
- Details + IDs in auto-memory `reference_pipeline_health_routine.md`.

## First digest's three flags → PR #3328 (merged, deployed)

The first real digest (in Derek's inbox, `[WARN] … 2026-07-23`) flagged three
things; two were monitoring bugs, one real:

1. **Top-books raw IDs (real, fixed):** pageview keys are slug OR Mongo `_id`
   hex OR the string `id` field (a different 24-hex value). Both
   `scripts/analytics/snapshot-metrics.mjs` and `usage-deepdive.mjs` only
   resolved `_id`; now all three, plus same-book merge (Fludd Vol. 1 was
   double-counted via slug+id). Snapshot re-run — dashboard clean. Newly
   visible: Etteilla's *Cours du livre de Thot* is the #2 most-read book.
2. **supabase_sync permanent warning (monitoring bug, fixed):** anon key gets
   42501 on `sync_health()` → silent fallback → hardcoded `warning`, forever.
   Now uses `supabaseAdmin`. Trap: the RPC's live signal (`gemini_usage` lag)
   measures the *pause* while the pipeline is paused — fixing the client alone
   would flip warning→false CRITICAL. `getSupabaseSyncHealth` now takes
   `{pipelinePaused}` (route fetches the pause flag first). Same class as
   PR #2556 (lesson_health_monitors_respect_pause).
3. **Librarian broken_citation (guard working, reporting refined):** rows are
   the #3114 citation guard catching + repairing fabricated links. Health
   status now keys on `citation_unrepaired_24h` (currently 0) + non-citation
   errors; catches remain info. Digest routine prompt updated to interpret all
   three signals.

## Open / next

- **Engagement decline is real and untouched:** MAU −22%, avg DAU −48%, dwell
  −56%, pageviews −42% WoW; daily traffic below the pre-HN-spike baseline.
  Product question, not a code fix. The digest will keep tracking it weekly.
- entities/pages Supabase sync remains manual-cadence by design (Gap D).
- Next digest fires Mon 2026-07-27 06:15 UTC on the corrected interpretation
  rules.

## CLAUDE.md check

No new invariant needed: the anon-RPC fallback trap and the id/_id/slug key
resolution are documented as code comments at the fix sites; the cloud-env
egress gotcha is account-specific and lives in auto-memory.
