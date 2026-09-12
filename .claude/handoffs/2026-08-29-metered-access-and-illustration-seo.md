# Metered access (#4357): illustration SEO live, wall built and flip-ready — 2026-08-29

Derek's direction: all illustrations indexed by Google; ~20% of each book freely
readable, the rest behind login, eventually a paid tier. Plan, decisions, and running
status: **issue #4357** (read its comments — two architecture corrections live there,
not in the issue body).

## Shipped (three PRs, all merged and deployed)

- **#4364 — illustration sitemaps, LIVE.** Chunks 2000+ = ~142K public gallery-image
  pages (gallery_quality ≥ 0.7, visible book, image_url present) with `<image:loc>`;
  3000+ = ~16K `/artwork/` pages. Offsets duplicated in `sitemap-index/route.ts` —
  keep them in sync or the index advertises 404 chunks. Gallery-image pages were
  ALREADY indexable (the layout's noindex is only on error variants — a survey agent
  misread this); the missing piece was purely sitemap discovery.
- **#4365 — the metered reader, merged, INERT.** Master switch = `METERED_READER` env
  (unset in prod). Policy `src/lib/free-preview.ts`; enforcement `src/lib/metered-gate.ts`
  + the four pages API routes + the ISR reader page. Free set = first 20%
  (math shared with bot-gate, cannot drift) ∪ `seo_indexable` pages. TEXT is gated,
  images are not (nav list embeds every image URL in ISR HTML anyway). The
  seo_indexable-always-free rule is what removes all cloaking exposure: indexed pages
  never gate, so no paywall structured data is needed and the existing
  `isAccessibleForFree: true` stays honest. Pinned by `tests/unit/free-preview.test.ts`.
- **#4368 — flip-readiness, merged, INERT.** `/q/` shortlinks mint per-page HMAC
  capabilities (`?cite=`, `src/lib/citation-token.ts`) so citations resolve forever;
  DTS document + `/api/books/[id]/text` clamp anon humans to the bot sample; IIIF
  canvas ocr/translation 403s beyond it; FAQ + /contribute "no paywalls" copy is
  flag-conditional and flips in the same deploy as the wall.

## Lessons worth keeping

- **The secret is `AUTH_SECRET`, not `NEXTAUTH_SECRET`** (auth.ts:220, NextAuth v5
  naming). citation-token.ts originally read the old name and would have failed closed
  in prod — caught only by the live smoke test, not by tsc or unit tests. When keying
  anything on "the auth secret", read auth.ts first.
- **Exemption is by SURFACE, not by book**: tenant/embed requests pass, apex requests
  meter — but the proxy's referer-based tenant inference means partner-tenant books can
  arrive exempt on the apex too. Documented as policy (partner collections stay open).
- `cp -Rc` of node_modules into a worktree copies a stray self-referential
  `node_modules/node_modules` symlink that panics Turbopack — `rm` it after cloning.

## Next (Derek's call, no code)

Flip day: announcement/framing first, then `METERED_READER=1` in prod env + redeploy.
ISR pages rendered pre-flip serve full text ≤24h. Watch `analytics_events` for
`gate_hit` rows (`feature: 'metered-reader'`) — the wall→signup conversion signal that
should shape the Phase 3 paid tier. Beta page copy only needs changing when a PAID
tier ships (free registration = full access remains true through Phase 2).
