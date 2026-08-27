# Deploy, the CDN, and the two caches

*Read this when you touch: `src/app/api/deploy-warm/route.ts`, `scripts/deploy-prod.sh`,
`.github/workflows/post-deploy-warm.yml`, any `CDN-Cache-Control` header in `next.config.ts`, any
`revalidatePath` / `revalidateTag` call, or Vercel project settings.*

## There are two independent caches, and a deploy can empty both

```
reader → Cloudflare (CDN + WAF) → Vercel edge → Vercel function → ISR cache → Atlas / Supabase / R2
```

- **Cloudflare** holds rendered HTML for 24h. That is set by `CDN-Cache-Control: public,
  max-age=86400, stale-while-revalidate=3600` in `next.config.ts` on `/book/*`, `/collections/*`,
  `/browse/*` and friends. `CDN-Cache-Control` is read by the CDN and ignored by browsers — that
  header is Next.js instructing Cloudflare.
- **Vercel ISR** holds pre-rendered HTML per route, governed by each page's `export const revalidate`.

They are independent, and that is the point: **whichever one survives shields the layer below it.**
Empty only Cloudflare and ISR serves cheap cached HTML while the CDN refills. Empty only ISR and
Cloudflare shields the origin while ISR refills. **Empty both in the same operation and every request
falls through to a full render with live database queries.**

## The invariant: skew max-age MUST exceed the CDN TTL

Vercel **Skew Protection** (`skewProtectionMaxAge`, a *project setting* — not in this repo) keeps a
previous deployment's assets resolvable. That is what makes CDN-cached HTML referencing an older JS
chunk safe.

**If the skew window is shorter than the CDN TTL, there is a gap**: HTML cached between those two
ages references chunks Skew Protection has stopped covering, and the page renders **fully unstyled**
— cards collapse, images lose their frame. It reads as "broken images / junk content" and it is the
single most-repeated deploy complaint in this project's history.

It was **12h against a 24h TTL** until 2026-08-05, which is exactly that gap. Now **48h**.

- Raising the CDN TTL past the skew window reopens it. So does lowering skew.
- **No test in this repo can pin this** — one side lives in Vercel's project settings. Read it with
  `GET https://api.vercel.com/v9/projects/<id>?teamId=<team>` and look at `skewProtectionMaxAge`.
- Corollary of the "a test that greps source is not a guard" rule: a repo-only check would be
  decoration here, because half the invariant is not in the repo.

**Grepping the repo cannot tell you whether a platform feature is on.** Skew Protection was asserted
to be disabled during the #3645 audit on the basis that `next.config.ts` and `vercel.json` did not
mention it. It had been enabled all along. Read the platform's own API before concluding a platform
feature is off.

## Purging and invalidating are workarounds, not requirements

`purge_everything` (`post-deploy-warm.yml`, `scripts/deploy-prod.sh`) and the blanket
`revalidatePath(..., 'layout')` calls both existed for one stated reason: stale HTML pointing at
deleted chunks. **With the skew window correctly sized, that reason is gone.** Treat either as
something to justify, not something to preserve by default.

What the blanket invalidation cost, measured over the Jul 2026 cycle (#3645):

- **54,613,998 ISR writes against 16,815,548 reads** — $282.46 of writes buying $8.47 of reads.
- Writes exceeded reads in **every** month on record, 2.4×–6.5×.
- Plus the full renders behind them: Fluid Active CPU $477.50, Provisioned Memory $226.23.

**A cache written more often than it is read is not a cache.** That ratio is the diagnostic — if ISR
writes exceed ISR reads on an invoice, something is emptying the cache faster than it can serve.

`revalidatePath(path, 'layout')` invalidates the **entire subtree**, not the path. On `/book` that is
every visible book. There were 106 merges to `main` in 30 days, each one a deploy.

## Diagnosing a deploy-related rendering complaint

- **Unstyled page after a deploy** → check whether the referenced `/_next/static/chunks/*.css`
  returns 404 while the homepage's returns 200. If so it is stale-HTML/dead-CSS, **not** a data or
  curation problem, and the skew window is the thing to check first. Emergency unstick without a
  redeploy: `set -a; source .env.production.local; set +a; curl -s -X POST
  "https://api.cloudflare.com/client/v4/zones/$CLOUDFLARE_ZONE_ID/purge_cache" -H "Authorization:
  Bearer $CLOUDFLARE_API_TOKEN" -H "Content-Type: application/json" --data
  '{"purge_everything":true}'` — and READ the success line. (Purge needs `CLOUDFLARE_API_TOKEN`;
  `CF_API_TOKEN` is WAF-scoped only.)
- **A "failed" `deploy:prod` may still have shipped.** The CLI can die (`write EPIPE`) after the build
  promoted but before purge + warm. Run `npx vercel inspect sourcelibrary.org` before re-running;
  `target production / status Ready` means it shipped — then run the purge above plus
  `curl -s -X POST https://sourcelibrary.org/api/deploy-warm -H "Authorization: Bearer $CRON_SECRET"`.
- **Merging a PR to `main` deploys production** and `post-deploy-warm.yml` handles purge + warm
  automatically. Do not reflexively run `npm run deploy:prod` after a merge. When a merge's behaviour
  is missing from prod, check the workflow run: if it failed with "not purging" while the Production
  build is `● Ready`, run the manual purge + warm above. Verify the purge STEP via
  `actions/runs/<id>/jobs`, not just the run conclusion — a workflow can go green while skipping it
  (#4060, closed).

## Did my merge actually ship?

- **Verify the COMMIT, not the alias status.** `npx vercel inspect sourcelibrary.org` answers "what
  is the alias serving *now*" — while a build runs it reports the PREVIOUS deployment as
  `target production / status Ready`. On 2026-08-06 that read as a green light and produced a
  confident, wrong "the merged change doesn't work" (it was simply not deployed yet). The one-liner:
  `npx vercel ls sourcelibrary-v2 --meta githubCommitSha=$SHA` returns only YOUR commit's deployment
  and its `● Building`/`● Ready`/`● Error`. Builds run 5–6 min, so the still-building window is the
  common case after a merge, not a rarity.
- **A Production build showing Canceled after ~12s** is usually the *ignored build step* skipping a
  no-op (docs/scripts-only) merge — that owes no purge at all; check who canceled before diagnosing.
- **Pipeline/worker scripts (`scripts/**`) need no Vercel deploy** — the Hetzner box auto-pulls
  `main` hourly at :17 (its crontab: `17 * * * * … auto-pull.sh`), so a scripts-only merge missing
  from behaviour is usually waiting for that pull, not a failed deploy.
- **History (#4025, open):** the GitHub→Vercel integration (the `frondular` scope) failed/canceled
  builds on 2026-08-17 and measured healthy from 08-18 onward. Posture: treat it as capable of
  intermittency — verify the commit per above rather than assuming either success or failure, and
  keep `npm run deploy:prod` as the recovery tool when a merge demonstrably did not ship.

## The `/explore` prerender interlock: pause `entities` bulk sweeps before any prod build

`/explore` is ISR (`revalidate = 86400`), so it prerenders **at build time**, and its counts
(`countDocuments` + `distinct('type')` over `entities`, ~1M docs) run with `maxTimeMS: 25000` —
already close to the cap. A concurrent bulk writer (`scripts/maintenance/repair-entity-page-attribution.mjs`
is the current one) tips them over and `npm run build` exits 1, losing the whole ten-minute deploy.
Since every merge to `main` is a production build, this interlock applies at MERGE time.

- **Preferred check (works from anywhere, catches any machine):**
  `node --env-file=.env.production.local scripts/audit/entities-sweep-active.mjs` — asks Atlas
  whether anything has bulk-written `entities` recently; exits 2 (not 0) when it can't reach the DB.
- Process checks if you must: `ssh root@46.224.122.120 'pgrep -af "[r]epair-entity"'` AND the same
  locally. The `[r]` bracket is load-bearing — without it the pattern matches its own command line
  over ssh and can never report clean. Read the matched line, don't count exit status. When ssh
  cannot answer, the interlock is UNKNOWN, not clear.
- **Tell:** `MongoServerError: operation exceeded time limit` + `Error occurred prerendering page
  "/explore"` in the build log — it reads like a code error; it isn't. The collision is intermittent,
  so one green deploy with a sweep running proves nothing.
- Real fix is precomputing the counts like `system_config.homepage_stats` — #3373.

## Reading the Vercel bill as a diagnostic

The invoice line items measure the stack, not just the money:

- **`Fast Origin Transfer`** is literally the Vercel→Cloudflare pipe. High = the CDN is missing.
- **ISR Writes vs ISR Reads** — see above.
- **Image Optimization Cache Writes vs Reads** — same shape, same meaning.
- **Function Invocations exceeding Edge Requests** is expected, not alarming: `src/proxy.ts`
  middleware runs on nearly every request, so one request bills two events.

Line items are in the plaintext body of the Vercel receipt emails. Current figures and how to re-pull
them live in the private ops repo (`costs/infrastructure-costs.md`) — not here.

## Verifying a content change on prod — never trust the bare URL

**A stale cached page and a failed write look identical from `curl`.** Separate them with
a cache-busting query string *before* diagnosing anything:
`curl "https://sourcelibrary.org/collections/<slug>?cb=$RANDOM"`. The query string is part
of the edge cache key but **not** part of the Next route/ISR key, so it forces a fresh
render of the same page while bypassing both Cloudflare and Vercel's edge copy. If `?cb=`
shows the new content, the write landed and the render is fine — you have a cache problem,
not a data problem, and you should stop reading application code.

Measured 2026-08-18 (Secret Societies recuration): after a Mongo edit, a successful
`POST /api/admin/revalidate`, and a Cloudflare purge that returned `success: true`,
`/collections/freemasonry` still served the pre-edit prose and the pre-edit
`numberOfItems` with `x-vercel-cache: HIT` and `age` climbing past 5,000s. **In the same
minute, on the same route, with identical cache headers, two sibling collection pages
served fresh content.** So do not conclude "revalidatePath doesn't work" — conclude that
it can silently fail to take on a *given path*, which is exactly the case that fools you,
because the paths you spot-check may be the ones that worked.

Two corollaries:

- **Purge order matters.** Purging Cloudflare before the origin has regenerated just
  re-caches the stale copy from Vercel. Purge, confirm fresh at origin with `?cb=`, then
  purge again. (Same shape as "a purge is only safe if the origin can refill it".)
- **A deployment is the reliable flush** when a path stays stuck. `/collections/:path*`
  carries `CDN-Cache-Control: public, max-age=86400` in `next.config.ts`, so a stuck entry
  otherwise sits for 24h.
