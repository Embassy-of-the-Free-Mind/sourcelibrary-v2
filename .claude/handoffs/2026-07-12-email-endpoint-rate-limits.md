# Email-endpoint rate limits + situational-awareness plan

**Date:** 2026-07-12
**Branch/worktree:** `worktree-fix+email-endpoint-rate-limits`
**PR:** #3123 (open, all checks green) · **Issue:** #3124

## What prompted it
Started from "should we add Altcha to stop email bots?" Stepping back to "how would we
even know someone was messing with the site?" surfaced two distinct problems: two
unauthenticated endpoints are open email relays, and almost nothing that we log is
watched by a human.

## Shipped (PR #3123)
Two files changed:
- `src/app/api/donate/route.ts`
- `src/app/api/beta/subscribe/route.ts`

Both send mail to the address in the request body and had **no** rate limit / captcha /
origin check. Now both go through `checkRateLimitShared` (the Mongo-backed global
limiter already behind the magic-link send) at **3/hour per IP**.

- On subscribe the gate sits **after** the existing-subscriber early-return, so a
  returning subscriber still gets `Already subscribed` without spending budget — only
  the mail-sending path is metered.
- `donate` also now HTML-escapes the submitted `name`/`email`/`message`/`referrer`,
  which were being interpolated raw into the notification email (HTML injection into
  Derek's inbox).

### Verification
Drove the real routes on a local dev server with `RESEND_API_KEY` blanked (no mail
sent). donate: 3×200 then 429 w/ `Retry-After`; different IP still 200. subscribe:
3 fresh addresses 200, 4th 429, returning subscriber from the blocked IP still
`200 {"alreadySubscribed":true}`. `npx tsc --noEmit` clean.

Test writes to **production** stores (dev uses `.env.production.local`): 5 rows in
`beta_subscribers`, 4 in `donation_intentions` — all deleted by exact id/email,
both collections confirmed back to pre-test counts (13 and 3). No mail sent.

## Filed for later (Issue #3124) — NOT built
Situational-awareness plan, three independent layers (don't bundle):
1. `security_events` collection (copy the `src/lib/api-usage.ts` pattern) — emit on
   limiter denials, outbound email sends, failed sign-ins, role/membership changes,
   admin API calls. Today none of these are recorded; `rate_limits` holds 1 row.
2. Add abuse checks to the `health-check` cron (it already owns scheduler + Resend +
   cooldown). Alert on outbound-mail spikes, denial spikes, subscriber/donation
   bursts, **any** role change, per-route 5xx.
3. Decouple the alarm from Resend (2nd key or a non-email dead-man's-switch) — right
   now silence is indistinguishable from health.

## Corrections to earlier claims this session
- The magic-link limiter does **not** fail open — on Mongo error/timeout
  `checkRateLimitShared` degrades to the in-memory `checkRateLimit`, a weaker cap.
- `/api/cron/health-check` **does** run (last fired 2026-07-07 per
  `system_config.health_alert_state`) despite not being in `vercel.json`, workflows,
  or scripts — so an out-of-repo scheduler invokes it. Finding + version-controlling
  that scheduler is part of #3124.

## Gotcha (now in auto-memory `lesson_proxy_bot_limiter_breaks_curl_tests`)
`src/proxy.ts:803` rate-limits any bot-ish UA (incl. `curl`) to 10 req/60s and returns
a 429 crawler pitch page that reads like your own limiter. Test API routes with a
browser UA. Also noted: proxy.ts resolves client IP as `x-forwarded-for → x-real-ip →
cf-connecting-ip` while `src/lib/rate-limit.ts` uses `cf-connecting-ip → …` — the two
layers can bucket the same request differently (flagged in #3124, likely benign
behind CF+Vercel).

## CLAUDE.md invariant check
No new invariant needed. The crawler three-layer gate is already documented; the
proxy-limiter-vs-curl issue is a per-machine testing footgun (captured in auto-memory),
not a codebase invariant. The IP-header divergence is tracked in #3124.

## Next
- Merge #3123 after review, then `npm run deploy:prod` from main (frontend routes).
- Optionally: enable the **already-wired** Turnstile (just needs
  `NEXT_PUBLIC_TURNSTILE_SITE_KEY` + `TURNSTILE_SECRET_KEY` set) and extend the widget
  to these two forms. Altcha is a later optional swap, not needed now.
- Pick up #3124 when there's appetite for the observability build.
