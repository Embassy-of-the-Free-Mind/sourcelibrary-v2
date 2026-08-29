# API hardening + the R2 egress hole — 2026-08-29/30

A long session that started as "what is recent API key usage?" and ended in a
full API design pass plus closing a corpus-scale image-egress hole. Six PRs, all
merged + deployed + verified live.

## What shipped (in order)

1. **#4363 — keyed, budgeted image proxy.** `/api/image` + `/api/crop-image` had
   no identity layer: a full-tier partner bulk-pulling scans was indistinguishable
   from an anonymous bot, throttled, and counted nowhere. New `src/lib/image-gate.ts`:
   browsers pass free (Sec-Fetch-Dest / own-Referer), our own fetchers carry an HMAC
   `itk` token (`src/lib/image-proxy-auth.ts`, signed centrally in
   `src/lib/api-client/images.ts`), keys are tier-budgeted + logged as `route:'image'`,
   anon non-browser gets 500/day then 429. Image budget pool is SEPARATE from /text.

2. **#4371 — API coherence (#4366 phases 1–2).** Fixed the inversion: free Explorer
   keys were 100 pages/day, BELOW anon (500) and session (1000) — getting a key was a
   downgrade. Now 2,000/day + enforced 60 rpm. `src/lib/api-limits.ts` is the single
   source of truth (docs pinned to it by `api-limits-coherence.test.ts`). Enforced the
   long-dead promises: per-key rpm, `expires_at`, and a latent ObjectId bug where
   self-serve key revocation NEVER matched. Added `/dataset/v1/{usage,keys/rotate}`;
   admin usage page now reads `api_usage` (was reading collections only the bulk-dump
   route writes → every key showed zero). Leveled gates on /books, /stats, /quote,
   /ngrams, DTS, IIIF. RSL `public/license.xml` + robots `License:` line; openapi 4→18
   paths. Migration `upgrade-explorer-key-limits-2026-08.mjs` ran (38 keys).

3. **#4372 — clean serving as a paid capability.** `?clean=1` serves visibly
   unmarked images to full-scope keys or `permissions.clean_images` (admin grant);
   others 403 (never a marked fallback — CDN cache poisoning); clean responses
   `private, no-store`. INVISIBLE marks (EXIF + keyed watermark) stay on every tier —
   the training-use evidence layer. Closed a bypass: crop-image served UNMARKED bytes,
   so a full-frame "crop" defeated every visible mark. Marking unified in
   `src/lib/image-marks.ts`.

4. **#4379 — free R2 egress spike detector.** See the hole below.

## The hole (the important part)

Investigating egress, found the `sourcelibrary` R2 bucket's managed subdomain
`pub-<id>.r2.dev` was **enabled** — a public front door OUTSIDE our Cloudflare zone,
where no WAF/bot/rate rule applies. It served full-res unmarked masters to a bare curl.
**Disabled it** (verified 401; custom domain + reader unaffected; no r2.dev URLs in code
or DB). This is the "every hostname is a separate front door" lesson (#3446) in a new
mechanism — now documented in `crawler-access-gate.md`.

Then, via R2 op-metrics (Cloudflare GraphQL, through the newly-installed Cloudflare
plugin MCP): an **unattributed bulk extraction on 2026-08-02/03 — ~3.0M objects / ~3.5 TB
in 48h**, read-only (no matching writes), page-master-sized. Permanently unattributable:
the pull hit the bucket directly (no app log), zone analytics retain ~7 days, R2 metrics
carry no client dimension, and Logpush was never configured. The attribution method that
worked retroactively: reads-vs-writes — our pipeline reads masters + writes variants
(GETs and PUTs rise together), an extraction only reads.

That discriminator is now the detector (#4379): flags a read spike that outran writes AND
clears a 700 GB floor (real data showed serving-heavy days are also read-only at
~250–300 GB, so the ratio alone false-alarms). $0/month. Can't name the puller.

## Open — needs Derek (all on issue #4373)

- **Turn the detector on**: create a CF "Account Analytics: Read" token → `CF_ANALYTICS_TOKEN`
  in `.env.production.local` + Hetzner; add daily Hetzner crontab line (both in #4379).
  Until then it's dormant code. Neither existing CF token has that scope.
- **`/archived/` rate rule** (staged, not applied): Cloudflare rate-limit on
  non-browser bulk traffic to `images.sourcelibrary.org/archived/*`, 403 → keyed path.
  Full proposal + exemptions on #4373. Blocked on asking Rik (rik@n4.io, Makepad — a
  full-tier key holder) what he pulls, so we don't cut him off mid-run.
- **Log Explorer**: Derek activated the subscription but it's EMPTY (0 datasets) = $0.
  Leave or cancel; do NOT add the HTTP-requests dataset (~$75–90/mo full-zone ingest).
- **Stripe → tier provisioning** and the rest of #4366 phase 3 remain open.

## Tooling note

Installed the Cloudflare plugin (`cloudflare@cloudflare`, OAuth per session). It can
read/write account resources our static tokens can't (R2 settings, GraphQL analytics) —
this is what let us find + close r2.dev and audit the egress. It CANNOT create API tokens
or Logpush jobs with creds (those still need the dashboard).

## Design artifact

"The Access Ledger" (private artifact) — field research on 20 peer institutions' API
access models + the 17-finding audit + target design. The through-line the whole session
kept confirming: **identity, not payment, is the gating currency** (Wikimedia, Met,
Unsplash all landed there), and money enters only at corpus grain.
