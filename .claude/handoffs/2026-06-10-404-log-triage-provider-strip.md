# 404-log triage → provider-strip regression fix + bare /page redirect (2026-06-09/10)

## What happened

Derek asked to "check our 404 logging." The logging itself is healthy:
`NotFoundContent.tsx` fires a client-side POST to `/api/analytics/not-found`,
which upserts into Mongo `not_found_reports` (hourly dedupe per URL +
anonymized /24 IP). 12,425 reports since 2026-05-04, ~1,450/week. Caveats:
write-only (no dashboard reads it), client-JS-based so non-JS bots are
invisible, referrer almost always empty.

Triage of the last 7 days surfaced two real problems, both fixed, merged,
and deployed to production this session:

### 1. Provider-prefix 308 regression — PR #2505 (merged + deployed)

Top 404 bucket: ~770 hits/week on `/internet-archive/*`, `/bodleian/*`, etc.
Commit 8e348991 (Mayank, 2026-05-28, "Remove source provider URL strip to
accommodate for the wrongly added providers as tenant") removed the PR #2025
proxy strip, so provider-prefixed URLs 404'd for ~2 weeks. These links are
still in Google's index and AI-chat citations (`utm_source=chatgpt.com` seen).

Fix: `src/lib/provider-prefix.ts` — static set from `LIBRARY_PARTNERS` keys
minus routing tenants (`TENANT_ROOT_PATHS` moved into that module so the two
sets stay mutually exclusive). No Mongo query, nothing reads the legacy
`kind:'provider'` tenants rows, so the conflict that motivated 8e348991
cannot recur. Bare provider roots (`/internet-archive`) now 308 to
`/libraries/<slug>` instead of `/`. Guard test:
`tests/unit/provider-prefix-redirect.test.ts` (includes a source-level check
that proxy.ts calls the helper with a 308).

### 2. Bare /book/<id>/page → 308 to book overview — PR #2506 (merged + deployed)

~230 hits/week on `/book/<slug>/page` with no page number (browser UAs, no
referrer — links pasted out of AI chats). First attempt was a `page.tsx`
calling `permanentRedirect()` — **verified on preview it streams a 200 shell
with a client-side NEXT_REDIRECT payload, not a real 308** (same RSC gotcha
documented on the proxy's author-canonical block). Reworked as a proxy-level
pathname regex next to the author block. Guard test:
`tests/unit/bare-page-redirect.test.ts` (also pins that no page.tsx
reappears in `src/app/book/[id]/page/`).

## Verified live on production (2026-06-10 ~00:40 CET)

- `/internet-archive/book/<slug>` → 308 → `/book/<slug>` → 200
- `/internet-archive` → 308 → `/libraries/internet-archive`
- `/book/<slug>/page` → 308 → `/book/<slug>`; `/page/16` still 200
- `/bph` and homepage 200, BPH subdomain unaffected
- Both deploys via `npm run deploy:prod` (purge + warm ran clean)

## Open follow-ups, in priority order

1. **Delete the 29 legacy `kind:'provider'` rows from `tenants`** — nothing
   reads them after #2505; CLAUDE.md already marks them deletion candidates.
   Data deletion → needs Derek's explicit go-ahead.
2. **BPH catalog leak:** `bph.sourcelibrary.org/embed/bph/catalog/2666` links
   to `/embed/bph/book/chymische-hochzeit-christiani-rosencreutz-andreae`
   which 404s (internal referrer, real reader). Check the catalog's
   slug mapping.
3. **`/author/*` 404s (~280/week):** spot-checked samples now resolve
   (likely fixed by author-thesaurus read-path). Re-run the numbers ~2026-06-16
   before acting.
4. **`/undefined` + `/default` prefixes (~73/week):** generator already fixed
   (`GalleryClient.tsx` hardcodes `tenantPrefix = ''`); remaining traffic is
   stale external links. Optional: add both to the proxy strip; otherwise let
   Google drop them.
5. Optional: small admin view over `not_found_reports` (it's write-only today).

## Useful query

```js
db.not_found_reports.aggregate([
  { $match: { created_at: { $gte: new Date(Date.now() - 7*24*3600*1000) } } },
  { $group: { _id: '$url', hits: { $sum: { $ifNull: ['$hit_count', 1] } } } },
  { $sort: { hits: -1 } }, { $limit: 20 },
])
```

## CLAUDE.md check

Done — this PR updates the "Source Library is the destination" section
(invariant 1) to describe the static `provider-prefix.ts` mechanism and the
8e348991 regression, replacing the stale `kind:'provider'` description.
