# Claude Code Guidelines for Source Library

## Mission
Source Library is a digital library of historical primary sources — alchemy, Hermetica, Kabbalah, Rosicrucianism, early modern science, and adjacent traditions — with AI-aided OCR, translation, and curation that make these texts readable and citable. The core experience is *reading and quoting* originals (`/book/...`, shortlinks, DOIs via Zenodo); curation surfaces them through collections, galleries, and editorial pages. Tenant subdomains (BPH/EFM, etc.) host curated subsets as standalone reading rooms for partner institutions.

When making product decisions, lead with: who reads this, what experience are they having, and does this serve the goal of putting primary sources into people's hands. Technical choices flow from that. The CRITICAL sections below are scar tissue from real incidents — read them, but don't mistake them for the point of the project.

## Development Workflow — CRITICAL
- **Feature branches off `main`.** One branch per feature/task: `feat/ai-search`, `fix/cover-thumbnails`, etc. No long-running dev branches.
- **Create a branch via worktree:** Use `EnterWorktree` at session start — it creates an isolated checkout with its own branch. Do NOT `git checkout -b` in the main directory (see Multi-Session Awareness above).
- **PR when done:** `gh pr create --base main`. Keep PRs focused (5-15 commits). Small PRs merge fast.
- **After merge, clean up:** Delete the worktree branch. The main directory stays on `main`.
- **NEVER run `vercel --prod` from a feature branch.** The CLI deploys whatever is on disk — it ignores the Vercel production branch setting. Use `vercel` (no `--prod`) for preview deploys from branches.
- **NEVER push directly to main.** All changes go through PRs.
- **Preview URL:** Push the branch (`git push`) and Vercel auto-deploys a shareable preview. Use that for testing and sharing with the other dev.
- The production site (sourcelibrary.org) stays untouched until a PR is reviewed and merged.
- **Merging a PR does NOT deploy production.** `sourcelibrary.org` is served by a manual prod deploy (not git-integrated). To ship a merged frontend change: in the main directory on `main`, `git pull origin main` then **`npm run deploy:prod`** (see below). **Exception:** pipeline/worker scripts (`scripts/**`) need no Vercel deploy — the Hetzner box auto-pulls `main` every ~5 min, so script changes go live on their own. Tell: a merged frontend behavior that's absent on prod = not deployed yet.
- **Deploy prod with `npm run deploy:prod`, NOT bare `vercel --prod`.** A bare `vercel --prod` ships new asset hashes and purges the previous deploy's CSS/JS chunks, but does NOT clear the CDN-cached HTML. `next.config.ts` caches rendered HTML at the edge for 24h (`CDN-Cache-Control: max-age=86400`) on `/collections/*`, `/book/*`, `/author/*`, `/gallery/*`, `/browse/*`, etc. So any page cached just before a deploy then points at a now-404'd `/_next/static/chunks/*.css` and renders **fully unstyled** (cards collapse, images lose their frame — it reads as "broken images / junk content") for up to 24h. `scripts/deploy-prod.sh` (= `npm run deploy:prod`) does deploy → Cloudflare `purge_everything` → re-warm, closing that gap. The automated `post-deploy-warm.yml` only fires on **push-to-main**, which does NOT deploy prod — it can't cover a manual deploy. **Tell that you hit this:** a page's referenced `/_next/static/chunks/*.css` returns 404 while the homepage's returns 200 → it's stale-HTML/dead-CSS, NOT a data or curation problem. Emergency unstick without a redeploy: `set -a; source .env.production.local; set +a; curl -s -X POST "https://api.cloudflare.com/client/v4/zones/$CLOUDFLARE_ZONE_ID/purge_cache" -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" -H "Content-Type: application/json" --data '{"purge_everything":true}'`. (Purge needs `CLOUDFLARE_API_TOKEN` — `CF_API_TOKEN` is WAF-scoped only.)

## PR Conventions
Lessons from PR #1980 (see `.claude/handoffs/2026-05-25-pr1980-split.md`). Apply to all contributors — internal, external, and AI-assisted.

- **One concern per PR.** Don't bundle dead-code removal with tooling adoption, or refactors with feature work. The two halves of #1980 had very different risk profiles; bundled, they couldn't be reviewed cleanly. If the diff has more than one "why," split it.
- **Verify before deleting.** Static analysis (graph audits, IDE "find unused") can confidently miss dynamic requires, framework conventions (Next.js routing, cron triggers, server actions), and recent additions. Always `grep -rn '<name>' src/` for every deletion. `InputWidget.tsx` in #1980 was flagged dead but actively imported by `/founding-donors` — one grep would have caught it.
- **Verify a flagged bug against current code + data before "fixing" it.** Audits, manifests, migration plans, and stale comments drift from the code — a "bug" they surface may not exist, or the code may already be correct. Read the actual code at the line and run a quick data query to confirm the failure case is real and non-negligible before adding a branch or a fix. Don't kill long-but-finite queries and mistake them for timeouts. Sometimes the documentation is the bug, not the code — fix the doc too.
- **On PRs, trust `test`/DCO, not the first Vercel result.** The Vercel check often shows "fail" on the first build, then an automatic retry flips it to pass (the deployment is frequently still "Building" when GitHub reports the fail). Wait for the retry to settle; don't bail or assume a real failure while `test`/DCO are green.
- **Run `npx tsc --noEmit` locally before opening a PR that touches dependencies.** It's the #1 source of wasted deploy cycles.
- **Tooling additions need provenance + opt-in + install docs.** A PR that adds a third-party CLI, MCP server, or `*ToolUse` hook must include: source link, install command, what network/telemetry access it has, an opt-out path. The default must be "if not installed, repo still works."
- **Doctrine lives in `CLAUDE.md`, not six files.** No appending the same instructions to `AGENTS.md`, `GEMINI.md`, `.cursorrules`, `.windsurfrules`, `.kiro/steering/`, etc. One source of truth; cross-tool agents can read `CLAUDE.md` directly.
- **Never replace a CRITICAL hook silently.** The `PreToolUse` branch-safety hook in `.claude/settings.json` is load-bearing (see Multi-Session Awareness). New hooks go alongside, not in place of, existing ones. Hooks that run on every tool call need explicit review — they tax every Bash and Edit.
- **PR description should state what's in scope AND what's out of scope.** "I considered X but kept it for a separate PR because Y" is more valuable than a feature list. Reviewers need to know what was deliberately left undone.

## Multi-Session Awareness — CRITICAL
Derek runs ~10 Claude Code terminals simultaneously, all sharing the main working directory. Branch switches in one terminal silently break all others.

**The rule is simple: the main directory stays on `main`. Always.**

- **NEVER run `git checkout <branch>` in the main directory.** This is the #1 source of cross-session chaos.
- **All feature work happens in worktrees.** At session start, if your task needs a feature branch, immediately call `EnterWorktree` to get an isolated copy. Branch switches in worktrees are safe — they don't affect other terminals.
- **Read-only tasks (searching code, reading files, running queries) can stay in the main directory on `main`.** No worktree needed.
- **If you're on an unexpected branch** (not `main` in the main directory), tell the user: "This directory is on `X` — another session may have switched it. Want me to switch back to `main`?" Do NOT silently switch or start working on the wrong branch.
- **At session start, check your branch** with `git branch --show-current`. If it's not `main` and you're in the main directory, flag it immediately.
- **Commit and push before exiting a worktree.** Uncommitted worktree changes are invisible to other sessions.
- **Set the terminal title at session start.** Run: `printf '\033]0;CC: <task-description>\007'` (e.g., `CC: embeddings`, `CC: pipeline-monitor`). This labels the Ghostty tab so Derek can find the right terminal. Use a short, descriptive name based on what you're working on.

**Worktree quick reference:**
- `EnterWorktree` — creates an isolated checkout with its own branch
- Active worktrees: `git worktree list`
- Worktrees live in `.claude/worktrees/`
- **Fresh worktrees fail the pre-commit `check-imports` hook** because `src/lib/vendor/lamejs-bundle.js` is gitignored and absent from a new checkout. Before your first commit, copy it from the main checkout: `cp <main-dir>/src/lib/vendor/lamejs-bundle.js src/lib/vendor/`.

## Data Protection — CRITICAL
- **NEVER** delete books, pages, or source material without explicit confirmation
- **NEVER** batch delete — list items first, wait for approval
- `deleted_books` collection has recoverable items: `POST /api/books/restore/[id]`
- Assume all books are valuable, even without IA identifiers

## Security — CRITICAL
- Reading `.env*` files is OK for understanding what variables exist
- **NEVER** embed secrets in code — use `process.env.VAR` with no fallback
- Review scripts for hardcoded credentials before committing

## Visibility & Stats Invariants
Lessons from PR #2055 (see `.claude/handoffs/`). The homepage and most public surfaces filter on `visible: true`, but `hidden: true` exists as a parallel flag. When the two disagree, books leak into public counts.

- **`visible` and `hidden` must be opposites.** Every writer that sets `hidden: true` must also set `visible: false` (and vice versa for un-hide). Don't write one without the other. Active writers: `scripts/maintenance/hide-{unarchived,efm-duplicates}.mjs`, `scripts/maintenance/set-launch-books.mjs`, `scripts/workers/pipeline-orchestrator.mjs`, `src/app/api/admin/duplicates/route.ts`, `src/app/api/books/[id]/visibility/route.ts`. Historical drift cleaned up by `scripts/maintenance/fix-conflicting-visibility.mjs` — re-run if `db.books.countDocuments({ visible: true, hidden: true })` ever climbs above zero again.
- **Homepage stats live in `system_config.homepage_stats`** (Mongo). Refreshed daily at 05:00 by `scripts/maintenance/prewarm-browse.mjs`, also writable on demand by `scripts/maintenance/update-homepage-stats.mjs`. Both scripts now share the same canonical filters — keep them in sync if you touch either. The canonical filters are:
  - `totalBooks` / `authorCount` / `languageCount`: `visible: true && pages_count > 0` (plus `pages_translated > 0` for authors/languages)
  - `translatedToEnglish`: ≥90% "readable" — `pages_translated >= 0.9 * (pages_ocr - pages_blank)`
  - `artworkCount`: `visible: true && content_type: 'artwork'` — single-object entries (paintings, prints, sculptures, etc.), distinguished from books by being non-sequential. They typically have `pages_count: 0` (image + metadata only) or a handful of non-sequential images of the same object. Don't filter on `resource_type` here — it's a finer-grained sub-category (sculpture, religious, allegory, manuscript-illumination…) that under-counts if used alone.
  - `illustrationCount`: `gallery_images.countDocuments({})`
- **`is_first_translation: true` ≠ "we have it in English."** It's a bibliographic claim that gets set by batch-flag scripts (e.g. `scripts/maintenance/bulk-flag-tibetan-ft.mjs`) before translation completes. Render gates that show the "First Translation" badge must require `pages_translated > 0` — otherwise readers see a badge on a book they can't read. Pattern: `book.is_first_translation && (book.pages_translated ?? 0) > 0`.

## Tenant Subdomain Lockdown — CRITICAL
Tenant subdomains (e.g. `bph.sourcelibrary.org`) MUST be a closed system. Visitors must never be able to land on, follow a link to, or be redirected to non-tenant content. EFM and other partners use these subdomains as their public face — leaks break the trust model.

**Invariants** — verify every change against these:

1. **No proxy redirect off the tenant subdomain.** `src/proxy.ts` rewrites every BPH path to `/embed/bph/...`. Never add a branch that issues a redirect to `sourcelibrary.org/...` (the original `/gallery` redirect was the canonical bug). Rewrites stay on-host; redirects must too.
2. **Every server query touching a tenant page filters by tenant.** When rendered under `/embed/[tenant]/*` or `/[tenant]/*` with a tenant subdomain host, all data fetches must include the tenant constraint. The default for `held_by` / `image_source.provider` (Supabase) and `tenantId` (Atlas) is GLOBAL — explicit filtering is required. This applies to: book listings, related-books, related-editions, gallery images, collection highlights, exhibition books, mentioned books.
3. **Pre-computed cross-references are not safe in embed mode.** `book.related_books`, `book.author_cross_ref`, and similar fields are computed across the whole library. Gate them behind `embedPolicy.show*` flags (defined in `src/lib/embed-ui-policy.ts`) — they must be `false` when `isEmbedded`.
4. **Share/quote URLs use the request host.** `getShortUrl()` and the `/api/[tenant]/books/[id]/quote` route accept a `baseUrl` derived from the request via `getRequestBaseUrl(headers)`. Don't hardcode `https://sourcelibrary.org` in user-facing URLs returned from the API.
5. **Internal anchor links are relative, not absolute.** `/book/...`, `/collections/...`, `/gallery/...` resolve against the tenant subdomain via `proxy.ts` rewrites. Any `https://sourcelibrary.org/...` href in component output is a leak.

**Verifying the invariant**

`node scripts/audit-bph-leaks.mjs` crawls the BPH subdomain, follows internal links to a configurable depth, and exits non-zero if any anchor or one-hop redirect resolves off-subdomain. Run it after touching anything in `src/proxy.ts`, `src/app/embed/**`, `src/app/[tenant]/**`, or any component that builds URLs.

## Source Library is the destination — content URLs & library pages
Content lives on Source Library. We re-host books from many digital libraries
(Internet Archive, Gallica, Bodleian, Wellcome, …) and we credit them, but a
reader who landed on a book here never has to leave to read it. The URL shape
encodes that:

1. **Books, pages, gallery, collections live at tenant-agnostic URLs.**
   `/book/<slug>`, `/book/<slug>/page/<n>`, `/gallery`, `/gallery/image/<id>`,
   `/collections/<slug>`. Never `/internet-archive/book/foo`,
   `/gallica/gallery`, or any other `/<provider-slug>/*` prefix for content.
   This was patched in two waves: PR #1918 dropped the tenant prefix from
   book-page gallery links; PR #2025 added a proxy-level strip so every
   provider-prefixed URL 308s to its global equivalent. The strip's original
   Mongo lookup (`kind:'provider'` rows in `tenants`) was removed in commit
   8e348991 (providers were wrongly resolving as tenants), which silently
   killed the redirect for ~2 weeks (~770 404s/week in `not_found_reports`).
   PR #2505 restored it as a static lookup in `src/lib/provider-prefix.ts`,
   keyed off `LIBRARY_PARTNERS` with routing tenants excluded — a guard test
   (`tests/unit/provider-prefix-redirect.test.ts`) now pins the proxy wiring.
   Don't reintroduce provider-prefixed content paths, and don't replace the
   static lookup with a `tenants`-collection query.
2. **Each contributing library has its own page on Source Library at
   `/libraries/<slug>`.** The page credits the institution (name, description,
   hero image), shows the books we have from them, and may link out to the
   institution's own site. The `LIBRARY_PARTNERS` lookup in
   `src/lib/library-partners.ts` is the source of truth for this metadata —
   adding a new library is an edit to that file, not a DB change.
3. **Bibliographic data on a specific book may link out.** The
   `book.image_source.source_url` link in `BibliographicInfo.tsx` (and the
   IIIF manifest link beside it) point at the original record for citation
   and scholarly accountability. Keep these — they're per-book provenance,
   not "leave Source Library" prompts.
4. **The `tenants` Mongo collection is for subdomain partners, not for
   contributing libraries.** Subdomain tenants (`bph`, `kloss-collection`,
   `bhutan`) have their own scoped UI under a partner subdomain. The 29
   legacy `kind:'provider'` rows (from when routing doubled as an attribution
   registry) were **deleted on 2026-06-10** — backup at
   `scripts/output/tenants-provider-rows-backup-2026-06-10.json` in Derek's
   main checkout. Don't recreate them (`create-all-provider-tenants.mjs` is
   the legacy writer — don't run it). New contributing libraries go in
   `LIBRARY_PARTNERS`, not in the `tenants` collection.

## Author identity — the `authors` thesaurus (read this before touching author code)
"Who wrote this, and is *this* Andreas the same as *that* Andreas?" is answered by the canonical **`authors`** collection — one doc per person, `_id` = canonical slug, with `variants[]` / `variant_slugs[]` / `viaf_id` / `wikidata_id`. It **supersedes** the legacy `entities` layer. Umbrella issue #2179.

- **Read `books.author_id` → `authors._id`, not `author_entity_id`.** `author_id` is the canonical FK (~74% of live books linked); `author_entity_id` → `entities` is transitional and being retired. Both are written during migration.
- **Don't render `authors.book_count`** — it's a stale build snapshot. The true count is the read-path union query.
- **Build/enrich scripts:** `scripts/maintenance/build-authors-collection.mjs` writes the collection (deterministic name-key ∪ VIAF ∪ Wikidata, #2202); `reconcile-authors-grounded.mjs` anchors the tail to Wikidata/VIAF using each author's books as evidence (#2218). The similarly-named `build-canonical-authors.mjs` is a read-only sizer that does NOT write — don't run it to rebuild.
- **Read-path** (`/author/[slug]` → `src/lib/author-thesaurus.ts`) is flag-gated by `AUTHOR_THESAURUS_READPATH` and redirects every variant slug to the canonical one. Full design, provenance, and migration status: **`.claude/docs/author-identity-system.md`**.

## Authentication across subdomains

The NextAuth session cookie is set on `.sourcelibrary.org` (with the leading dot) in production, so signing in on `sourcelibrary.org` carries through to every tenant subdomain (`bph.sourcelibrary.org` today, `kloss/jung/...` later) and vice versa. Gated on `VERCEL_ENV === 'production'` — Vercel previews and localhost stay host-scoped.

**Identity shares, permissions do not.** Role checks still run via `memberships` collection lookups per tenant (`getTenantMembershipRole` in `src/lib/auth-helpers.ts`). A user signed in on the parent site does not inherit any tenant role just by visiting a subdomain; the `withAuth(handler, { minRole })` wrapper (and role-specific shorthands like `withEditorAuth`, `withAdminAuth`) continues to enforce per-tenant gates.

**CSRF token stays per-host** (`__Host-` prefix forbids the `domain` attribute, and each subdomain hits its own `/api/auth/*` routes).

Source: `src/lib/auth.ts` (cookies block). See `.claude/docs/auth-tenant-cookies.md` for the full rationale and rollback notes.

## Stack
- Next.js 16, MongoDB Atlas, Gemini AI, Vercel deployment
- Production database: `bookstore`, NOT `sourcelibrary_research`. As of 2026-05-26: ~46K total docs, ~29K `visible: true` (publicly shown), ~15K with `pages_count > 0` (actually processed), ~14K with any OCR. The `tier` field is legacy (only used by `src/app/page.tsx` homepage ranking, seeded by `scripts/tmp-write-highlighted-books.mjs`); current canonical "live" filter across all public APIs is `visible: true && pages_count > 0` (see `/api/books/library`).

## AI Models — IMPORTANT
- Summary/Index generation: enrich-worker uses `gemini-3.1-flash-lite` for all phases — summary+index (Phase 6), chapters (Phase 7), quality scoring (Phase 7.5), collection assignment (Phase 7.6). NEVER use models older than v3.
- OCR/Translation routing: `gemini-3-flash-preview` for BPH books, `gemini-3.1-flash-lite` for everything else (50% cheaper). See `src/lib/types/ai-models.ts`.
- Reference: https://ai.google.dev/gemini-api/docs/models

## Quality systems — two distinct scores
Image extraction emits two separate quality signals in the **same Gemini call**. They answer different questions and get stored in different places — don't conflate them.

- **`gallery_quality`** (per detected illustration, range 0.0–1.0) — *Is this image worth showing in the curated gallery?* Lives on `pages.detected_images[].gallery_quality` (source of truth) and `gallery_images.gallery_quality` (materialized view). Current rubric is 4-tier (0.4–0.6 musical scores / 0.6–0.8 non-figural illustrations / 0.8–0.9 figural / 0.9–1.0 exceptional). The gallery materialization threshold is **0.5** — anything below is filtered out before write. **Rubric drift watch:** the archived prompt at `prompts/image-extraction/image-extraction-v0.md` shows the *old* 6-tier rubric; the live prompt is inline in `scripts/workers/image-extract-worker.mjs`, `scripts/workers/pipeline-orchestrator.mjs`, and `src/lib/image-extraction.ts`. PR #450 (2026-03-27) made the change.

- **`scan_quality`** (per page, range 0–100 score + class enum) — *How cleanly was this page digitized?* Classes include `color_photo`, `bitonal_clean`, `bitonal_microfilm`, `microfiche`, `scanner_metadata`, `blank`, `corrupt`. Lives on `pages.scan_quality` (per page) + `books.scan_quality` (book rollup with `dominant_scan_class`, `median_score`, `has_microfilm_pages`, etc). **Currently only ~0.2% of pages have it** — scan_quality only fires when image extraction fires, and image extraction only fires on illustration-candidate pages. Design rationale + extension plan in `.claude/docs/automated-image-quality-system.md`.

A famous Kircher diagram has `gallery_quality: 0.9` whether the scan is pristine or microfilmed; the same diagram on microfilm has `scan_quality.scan_class: bitonal_microfilm` regardless of how gallery-worthy it is. See `/blog/what-makes-a-good-scan` for the user-facing version.

**Bbox coordinate-space invariant (PRs #2516/#2517):** `detected_images[].bbox` / `gallery_images.bbox` are normalized to the image returned by `getPageSource()` (`scripts/lib/page-image-url.mjs`; TS twin `getPageImageUrl()` in `src/lib/utils.ts`) — on split pages that's the half, NOT `archived_photo` (the full spread). Every crop writer (extracted/thumbnail/hires generators, current: `generate-thumbnails.mjs`, `backfill-hires-gallery.mjs`, `gallery-image-gen.ts` callers) must resolve its source with that same function, never an ad-hoc `archived_photo || cropped_photo` priority. Symptom of getting it wrong: gutter-spanning junk crops in the gallery, and the `/gallery/image/[id]` magnifier showing different content than the displayed image (the lens crops on-the-fly from the correct source — check the data before debugging lens math). Repair sweep: `scripts/maintenance/regen-split-gallery-images.mjs` (`--dry-run` / `--clear` / `--regenerate`).

## Quote & snippet integrity — CRITICAL
Lessons from PRs #2232/#2233 (the "mercury on page 89" misquote — Nirmal, 2026-05-30).

OCR/translation text in `pages.{ocr,translation}.data` is wrapped in AI-written **editorial annotation blocks**. There are **two distinct families**: the translation-side page descriptions `<meta>`, `<summary>`, `<keywords>`, `<vocab>`, and the OCR-side page-level metadata envelope `<language>`, `<scan-quality>`, `<script>`, `<page-type>`, `<columns>`, `<warning>` (the tags `enrich-worker.mjs:1125` already skips). Both *describe* the page/scan and routinely name content from **adjacent** pages ("the previous page focused on perpetual motion wheels using mercury…"). They are **never verbatim source** — quoting or embedding them fabricates citations to words that aren't on the page, which strikes at the core "read and quote the original" promise.

- **Never serve any of those wrapper blocks as quotable text.** Strip the *content*, not just the tag. The classic bug is `replace(/<[^>]+>/g, '')` — it deletes the tag but keeps the editorial prose. Use `stripEditorialWrappers()` from `src/lib/strip-editorial-wrappers.ts` (it knows **both** wrapper families) **before** any generic tag strip.
- **Every search/snippet surface reads its own copy of the page text — fixes do NOT propagate.** Known text-cleaning paths: `/api/search`, `/api/books/[id]/search`, `src/lib/search/librarian-search.ts`, `src/lib/semantic-alignment.ts`, `scripts/workers/embed-gemini.mjs` (`cleanText`), `/api/likes/{popular,mine}` (+ tenant), `/api/learn`, the **quote API** `/api/books/[id]/quote` (+ tenant twin, PR #2420 — was missed in the #2232 sweep and served raw `<meta>` blocks as quotable text until 2026-06-03), and the **IIIF surfaces** `/api/iiif/[id]/canvas/[n]/{ocr,translation}` + `/api/iiif/[id]/search` (PR #2323/#2327). Route them all through `stripEditorialWrappers`. When you add a new surface that snippets page text, wire it through too. (See [[project_search_three_surfaces]] and `.claude/docs/iiif-api.md`.)
- **Inline glosses (`<note>`/`<term>`/`<margin>`/`<gloss>`/`<unclear>`/`<insert>`) and real page marks (`<header>`/`<catchword>`/`<sig>`/`<page-num>`) are NOT editorial wrappers** — they sit on / are real body text. Keep their content; they aid recall and reading.
- **The leak is frozen into stored artifacts.** `page_translations.translation` (the semantic-search snippet column) and the embedding vectors were written by the old `cleanText`, so the editorial prose is baked in with the tags already gone — a read-time re-strip can't recover it. Re-derive the snippet column from Mongo with `scripts/maintenance/backfill-clean-snippets.mjs` (UPDATE-only, zero Gemini cost — does NOT touch embeddings). Re-embedding (paid) is separate and only changes *ranking*; decide it on an eval, not reflexively.

## System Map
- **Interactive diagram:** https://sourcelibrary.org/platform/admin/system-map — click any node for details, key files, collections, gotchas (requires platform login)
- **Markdown reference:** `.claude/docs/system-map.md` — full text version with file layout, collection inventory, dead code list
- **Dead code cleanup:** GitHub issue #258 (closed) — most cleaned up, some camera components may remain. Note: rithmomachia is a live feature (`/[tenant]/rithmomachia`), not dead code.

## Domain Context

Detect the work domain from the user's prompt and load the right context automatically:
- **System overview / "where does X live?":** read `.claude/docs/system-map.md`
- **Pipeline/cron/Lambda/OCR/translation:** read `memory/pipeline-ops.md` (or `/pipeline-context`)
- **UI/frontend/navigation:** read `memory/ui-navigation.md` (or `/ui-context`)
- **Data fixes/maintenance/stuck books:** read `memory/data-quality.md` (or `/maintenance`)
- **MCP server/CLI:** read `memory/mcp-server.md`
- **Embeddings / semantic search:** read `.claude/docs/embeddings.md` — five Supabase tables (`page_translations`, `book_embeddings`, `artwork_embeddings`, `gallery_text_embeddings`, `clip_embeddings`), three workers, five RPCs.
- **Book acquisition / curation:** `/curator` or `/library-curator`. For importing at scale without duplicates, follow the canonical loop in `.claude/docs/import-workflow.md` (enumerate → dedupe → subject-filter → source → import hidden → process → QA → visible). Dedup runs in `src/lib/dedup.ts` (matches hidden books too — don't reintroduce a `visible:true` filter); reusable tool `scripts/import/enumerate-dedupe-source.ts`; sources that 429 datacenter IPs (Harvard, likely Gallica) use the residential direct-insert pattern (`scripts/import/harvard-wuzhen-direct.mjs`). Work-level dedup is not yet automatic — issue #2318.
- **Quality auditing:** `/qa-audit`
- **Batch processing:** `/batch-translate`
- **Handoffs:** `.claude/handoffs/` (read by date/topic). **This repo is PUBLIC (AGPL).** New handoffs and all operational/business material (fundraising, contacts, outreach, budgets, donors, sponsors) go in the **private** repo `Embassy-of-the-Free-Mind/sourcelibrary-ops` (clone at `~/sourcelibrary-ops`), which is gitignored here — never commit them to this repo. Only genuinely public-worthy *technical* postmortems (no PII/secrets/business strategy) belong in `.claude/handoffs/` here, and only by deliberate `git add -f`.
- **Reference docs:** `.claude/docs/` (read on demand, never all at once)

### Optional: code-review-graph

If `code-review-graph` is installed (per-machine, see `.claude/docs/code-review-graph.md`), use it at **PR-open time** — `detect_changes_tool` + `get_review_context_tool` give a risk-scored summary with test-gap detection and "wide blast radius, consider splitting" warnings. Also useful for `get_impact_radius_tool` ("what does changing this file affect?") and `query_graph(callers_of=X)` when grep would be noisy. **Never trust `refactor_tool(mode="dead_code")` output as a deletion list** — measured on this repo it produced 2,509 "dead" functions including active Next.js `GET` route handlers (validated 2026-05-25, see doc). Memory files win for *why* questions (decisions, incidents, domain invariants). Always grep-verify before any destructive action the graph informed.

## Knowledge Maintenance
- **After fixing a non-trivial bug**, proactively update the relevant memory file following the `/lesson` workflow. Don't wait to be asked.
- When reading memory files, flag anything that contradicts the current codebase and fix it.
- Memory entries with dates >14 days old: verify before trusting stats/counts.
- **Two memory systems, in plain terms:** repo memory = *team facts* (committed, shared with collaborators). Auto-memory = *Claude's per-machine notes* about the user (gitignored, private). The `/lesson` workflow writes to repo memory. Locations: `<repo>/memory/` (loaded by skills like `/pipeline-context`); `~/.claude/projects/<project>/memory/` (managed by Claude across sessions, has its own `MEMORY.md` + `_index-*.md` hierarchy).
- **Every incident handoff ends with a CLAUDE.md check.** When writing a handoff in `.claude/handoffs/`, the last step is: "does CLAUDE.md need a new invariant?" If yes, PR the doc change the same session. Otherwise the lesson lives only in the handoff and decays. Both big CRITICAL sections in this file were written this way.

## Compaction Instructions
When compacting (`/compact`), ALWAYS preserve:
- List of files modified this session
- Current task state and what was agreed with the user
- Any test results, errors, or deployment outcomes
- Which domain memory files were already read (avoid re-reading)
