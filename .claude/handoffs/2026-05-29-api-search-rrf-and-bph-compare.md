# Handoff — /api/search RRF (flag-gated) + BPH librarian compare-page plan

**Date:** 2026-05-29
**Author session:** "ship-hybrid-search" (the config-fix + shipping session)
**Branch:** work landed on `main` (3 PRs merged) + 1 open PR (#2154) on `worktree-feat-api-search-hybrid`
**Reads with:** `.claude/handoffs/2026-05-29-librarian-search-eval.md` (the eval/golden-set session) — **read that one too; it changes the conclusion below.**

---

## TL;DR

- Fixed the config bug that stranded the main dir on a merged branch (stale worktree on `main` + a warn-only branch hook). Hook now actually blocks. **Merged #2146, #2148.**
- Shipped the Librarian hybrid RRF search. **Merged #2137.**
- Added flag-gated RRF ranking to the user-facing `/api/search`. **Open: #2154 — held for review, NOT to be merged until validated.**
- **The other session's eval says wholesale RRF is the wrong default** (halves verbatim-quote recall). So #2154 should be treated as A/B *plumbing*, and the real direction is query-aware routing. See "Reconciliation" below.
- Next build: a **BPH librarian compare page** to collect human preferences (the chosen form of validation). Design decided; one open access decision blocks the build.

---

## ✅ SESSION COMPLETE — final state (supersedes the planning sections below)

Everything below this line was the plan; here's what actually shipped.

- **Found + fixed a CRITICAL tenant leak (#2159, MERGED):** `/api/search`'s semantic BOOK lane returned global/other-tenant books in a partner subdomain's results (up to 18/25 for "hermetic philosophy and the soul" on bph). `match_books_semantic` is global (no `tenant_id` column) and the Mongo materialization didn't re-apply `tenantId`. Fixed both semantic materializations + added `scripts/audit/search-tenant-purity.mjs` (re-runnable guard: pre-fix 43 leaked across 5 queries → post-fix 0).
- **BPH compare page is LIVE (#2161, preview-only, NOT merged):** access decision resolved as a **tenant-explicit compare API** served on a **preview** (honors "hold #2154"). Built leak-safe (single tenantId-scoped book join). Features delivered:
  - Two labeled columns: **Current (ladder)** vs **New (RRF)**, per-result 👍/👎 + overall winner + note → `search_compare_votes` (anonymous).
  - **Scope checkbox** "Restrict to BPH books only" (default on); unchecked compares against the whole Source Library; scope recorded with each vote.
  - **Clickable results** → BPH books open on `bph.sourcelibrary.org`, others on `sourcelibrary.org` (per-result `tenantOwned` flag; non-tenant rows tagged "main").
  - **Librarian URL:** `https://sourcelibrary-v2-git-worktree-bph-se-a1b3f4-dereklomas-projects.vercel.app/embed/bph/search-compare`
  - Files: `src/lib/search/compare-search.ts`, `src/app/api/search/compare/{route,vote/route}.ts`, `src/app/embed/[tenant]/search-compare/{page,SearchCompareClient}.tsx`.

**Pending human action (nothing blocked on code):**
1. Review/merge **#2154** (flag-gated RRF; default unchanged — safe).
2. Share the compare URL with BPH librarians; collect votes in `search_compare_votes`.
3. Decide RRF's fate from the votes — flip `SEARCH_RANKING_DEFAULT=rrf`, or (per the eval) pivot to **query-aware routing**. A small votes-summary view can be built when wanted.

**Worktrees still live (intentionally — back open PRs):** `feat-api-search-hybrid` (#2154), `bph-search-compare` (#2161). Remove after those PRs resolve.

---

## What this session shipped

| PR | What | State |
|----|------|-------|
| #2146 | `branch-guard.sh` — PreToolUse hook now **blocks** `git checkout` off `main` in the main dir (was warn-only; couldn't stop anything). | **Merged**, live in main checkout. |
| #2148 | Replaced the obsolete `NON_TENANT_PATHS` test (grepped a Set deleted in `61603c89`) with a `[tenant]` `notFound()` guard. Unblocked green CI on every PR. | **Merged.** |
| #2137 | Librarian unified hybrid search — `src/lib/search/librarian-search.ts` (`hybridSearch`), `src/lib/embassy/librarian.ts` rewired to one `search` tool (old names kept as aliases). | **Merged.** Live at /librarian. |
| #2154 | Opt-in RRF ranking for `/api/search` via `?ranking=rrf` (default `ladder` unchanged; `SEARCH_RANKING_DEFAULT` can flip). New pure util `src/lib/search/rrf.ts` + 5 unit tests. | **OPEN — hold for review.** |

Also removed the stale `fix-efm-stripe-link` worktree (was squatting on `main`, the root cause), updated stale auto-memory `lesson_proxy_non_tenant_paths.md`, filed planning issue **#2149**.

### #2154 specifics (for the reviewer)
- Default behavior is **byte-for-byte unchanged**: with `ranking=ladder` the only added work is an unused score map; the ladder logic is the same code extracted verbatim into a `ladderCompare` comparator.
- RRF fuses the four lanes' ranked id-lists (keyed by `result.id`: `book.id` for books, `${book_id}-p${n}` for pages), primary sort by fused score, ladder as tiebreaker.
- Live preview check (query "alchemical transformation of the soul"): same 61 candidates both ways; RRF blends primary-source passages with books where ladder returns only title-keyword books. PR has the side-by-side.

---

## ⚠️ Reconciliation with the eval session — READ THIS

The librarian-search-eval handoff ran the quantitative eval (same RRF algorithm) and concluded:

- RRF wins **overall** (P@1 0.529, MRR 0.632) and **nearly doubles niche-passage recall** (0.185→0.362). ✓ (matches my live impression)
- **BUT RRF regresses the mission-critical categories: verbatim-quote 0.750→0.375, broad-theme 0.400→0.200.** For a "read and quote" library, halving quote recall is a bad wholesale trade.
- **Their conclusion: no single variant wins across query types → query-aware routing is the answer** (use the `ai-expand` HINT to route: verbatim→book-then-page/exact, niche→fusion). The `ai-expand` route already emits intent + expanded terms; wiring it to retrieval is the real opportunity.

**Implication for #2154:** do NOT flip `SEARCH_RANKING_DEFAULT=rrf` wholesale. #2154 is fine as **A/B plumbing** and as the engine for the BPH compare page, but the destination is likely *routing* (pick ladder/rrf/exact per query intent), not "rrf always." The `?ranking=` param is forward-compatible with that — a router can choose the strategy per request.

**Also flag for the other dev:** #2137 already **replaced** `librarian.ts`'s `search_collection`/`search_semantic` with a single unified `search` → `hybridSearch`. The eval handoff's description of "the Librarian picks search_collection/search_semantic" is now **historical** — that tool-selection layer is gone on `main`.

---

## NEXT BUILD: BPH librarian compare page (the human eval)

**Why (the point):** Let the BPH librarians — the people who actually use this corpus — judge current vs RRF ordering on their own queries. Their collected preferences ARE the validation to decide #2154 (chosen over a quantitative golden-set eval). Start from their experience, not our metrics.

**Decided design (Derek, 2026-05-29):**
- **Validation = this page.** No separate quantitative web eval.
- **Labeled** comparison — show "Current" vs "New (RRF)" openly (not blind).
- **Open / anonymous** on the BPH subdomain — no login; aggregate A/B + per-result thumb counts.
- **Feedback = per-result thumbs (up/down) + an overall winner** per query.

**Tenant lockdown (CRITICAL — must hold):**
- Page lives under the tenant embed tree: `src/app/embed/[tenant]/search-compare/page.tsx` (BPH subdomain rewrites `/search-compare` → `/embed/bph/search-compare` via `proxy.ts`).
- Search must be **scoped to BPH content only**. Today `/api/search` scopes by tenant **headers set from the subdomain** — there is **no `/api/[tenant]/search`** route; the embed search page just re-exports root `SearchPage` with `forceEmbedded`.
- Result links must be **relative** (`/book/<slug>`) so they resolve on-subdomain; no absolute `sourcelibrary.org` URLs.

**⛔ OPEN DECISION blocking the build — access vs "hold #2154":**
The compare page needs the `?ranking=rrf` param (only on #2154, unmerged) AND BPH librarians need to *reach* it. Tension:
1. **Ship to prod, RRF default off.** Merge #2154 (flag-gated, zero behavior change) + the compare page → librarians use `bph.sourcelibrary.org/search-compare` (real subdomain → real BPH scoping). Cleanest UX, but contradicts "leave #2154 for review."
2. **Preview only.** Serve the page on a Vercel preview off the compare branch (which includes #2154). Problem: no `bph` subdomain on a preview, and header-based scoping won't fire. Needs either path-based tenant resolution on the preview OR a tenant-explicit compare API.
3. **Tenant-explicit compare API** (`/api/search/compare?q=&tenant=bph` returning BOTH orderings from one lane execution → fair, single candidate set). Works on any host incl. preview; keeps `/api/search` clean. More code, but the fairest comparison and unblocks the preview path. **Recommended if we honor "hold #2154."**

**Proposed implementation (assuming option 3):**
- `src/app/api/search/compare/route.ts` — runs the four lanes once for a given tenant, returns `{ candidates, order_ladder:[ids], order_rrf:[ids] }`. Reuses `rrfScores` + the ladder comparator (extract the comparator to a shared helper to avoid a third copy).
- `src/app/embed/[tenant]/search-compare/page.tsx` + a client component: query box → two labeled columns → per-result 👍/👎 + an overall "Which is better? Current / New / Tie" + optional note.
- `POST /api/search/compare/vote` (tenant-scoped) → Mongo `search_compare_votes` `{ tenant, query, winner, thumbs:[{ranking, book_id, page_number, vote}], ts, ua }`.
- Build on a branch **based off `worktree-feat-api-search-hybrid`** (needs the RRF code). It can't merge before #2154; that's fine — it's the validation harness for #2154.

**Watch:** include verbatim-quote and broad-theme queries in whatever sample queries we seed/suggest — those are exactly where the eval says RRF hurts, so librarian preference there is the decisive signal.

---

## Open decisions for Derek / the other dev
1. **Access path for the BPH compare page** (option 1/2/3 above). Blocks the build. I lean option 3 (tenant-explicit compare API → works on a preview, honors "hold #2154").
2. **Strategic:** given the eval's verbatim-quote regression, do we still want a "flip RRF default" path at all, or pivot #2154 toward **query-aware routing** (ladder/rrf/exact by `ai-expand` intent)? The compare-page data should inform this.

## CLAUDE.md invariant check
- No new CRITICAL invariant needed. Reinforces two existing ones: Tenant Subdomain Lockdown (the compare page must scope to BPH + relative links) and the "main dir stays on main" hook (now enforced via #2146).
