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
  curation problem, and the skew window is the thing to check first.
- **A "failed" `deploy:prod` may still have shipped.** The CLI can die (`write EPIPE`) after the build
  promoted but before purge + warm. Run `npx vercel inspect sourcelibrary.org` before re-running;
  `target production / status Ready` means it shipped.
- **Merging a PR to `main` deploys production** and `post-deploy-warm.yml` handles purge + warm
  automatically. Do not reflexively run `npm run deploy:prod` after a merge.

## Reading the Vercel bill as a diagnostic

The invoice line items measure the stack, not just the money:

- **`Fast Origin Transfer`** is literally the Vercel→Cloudflare pipe. High = the CDN is missing.
- **ISR Writes vs ISR Reads** — see above.
- **Image Optimization Cache Writes vs Reads** — same shape, same meaning.
- **Function Invocations exceeding Edge Requests** is expected, not alarming: `src/proxy.ts`
  middleware runs on nearly every request, so one request bills two events.

Line items are in the plaintext body of the Vercel receipt emails. Current figures and how to re-pull
them live in the private ops repo (`costs/infrastructure-costs.md`) — not here.
