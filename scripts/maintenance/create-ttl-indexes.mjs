#!/usr/bin/env node
/**
 * RETIRED — do not run. Kept as the historical record cited by the
 * ensure-indexes.mjs manifest `why` fields.
 *
 * This script used to create TTL indexes for analytics collections
 * (analytics_pageviews 90d, analytics_events 90d, loading_metrics 30d).
 *
 * Per the #2976 decision (Derek, 2026-07-05, "nine minus the heartbeats"),
 * retention TTLs are removed on six telemetry collections (api_usage,
 * gemini_usage, analytics_events, mcp_tool_calls, search_queries,
 * analytics_pageviews); the 30d heartbeat TTLs on cron_runs / uptime_checks /
 * loading_metrics are deliberately KEPT (their canonical specs now live in
 * ensure-indexes.mjs). Telemetry retention is manual and human-triggered via
 * scripts/maintenance/prune-telemetry.mjs (dry-run by default, exports a
 * backup before deleting, allowlisted collections only, never cronned).
 *
 * The prod TTL → plain-index swap for the six collections is done
 * post-deploy by scripts/maintenance/swap-ttl-to-plain-indexes.mjs.
 *
 * Do not resurrect the createIndex(..., { expireAfterSeconds }) calls that
 * lived here — that would silently reintroduce automated retention.
 */

console.error(
  'create-ttl-indexes.mjs is RETIRED per #2976 (no automated retention, 2026-07-05).\n' +
  'Nothing was created. For manual pruning use scripts/maintenance/prune-telemetry.mjs;\n' +
  'for the TTL→plain index swap use scripts/maintenance/swap-ttl-to-plain-indexes.mjs.'
);
process.exit(1);
