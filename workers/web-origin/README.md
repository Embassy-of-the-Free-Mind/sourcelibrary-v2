# web-origin Worker (#8384)

Sends a share of anonymous `/book/*` readers to the reader-origin box
(`infrastructure/web-box/`), with Vercel as the live fallback. **Not deployed.** See the
header of `src/index.ts` for the rules and `wrangler.toml` for the deploy steps, which
need Derek.

- Kill switch: set `PERCENT` to `0` (`npx wrangler deploy --var PERCENT:0`, or the
  dashboard). Takes effect in under a minute.
- Stage 0: staff set the cookie `sl_box_staff=<STAFF_TOKEN>` on sourcelibrary.org and sign
  out (a session cookie always wins and keeps you on Vercel). Every response carries
  `X-SL-Origin: box | vercel | vercel-fallback`.
- Counters: Analytics Engine dataset `sl_web_origin`, e.g.
  `SELECT blob1 AS outcome, blob2 AS reason, count() FROM sl_web_origin WHERE timestamp > NOW() - INTERVAL '5' MINUTE GROUP BY outcome, reason`.
  The automatic stop (over 2% fallbacks in 5 minutes sets PERCENT to 0) is not built yet.
- Tests: `tests/unit/web-origin-worker.test.ts` (run with the repo's vitest).
