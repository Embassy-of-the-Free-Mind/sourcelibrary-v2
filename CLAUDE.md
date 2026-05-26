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

## PR Conventions
Lessons from PR #1980 (see `.claude/handoffs/2026-05-25-pr1980-split.md`). Apply to all contributors — internal, external, and AI-assisted.

- **One concern per PR.** Don't bundle dead-code removal with tooling adoption, or refactors with feature work. The two halves of #1980 had very different risk profiles; bundled, they couldn't be reviewed cleanly. If the diff has more than one "why," split it.
- **Verify before deleting.** Static analysis (graph audits, IDE "find unused") can confidently miss dynamic requires, framework conventions (Next.js routing, cron triggers, server actions), and recent additions. Always `grep -rn '<name>' src/` for every deletion. `InputWidget.tsx` in #1980 was flagged dead but actively imported by `/founding-donors` — one grep would have caught it.
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

## Data Protection — CRITICAL
- **NEVER** delete books, pages, or source material without explicit confirmation
- **NEVER** batch delete — list items first, wait for approval
- `deleted_books` collection has recoverable items: `POST /api/books/restore/[id]`
- Assume all books are valuable, even without IA identifiers

## Security — CRITICAL
- Reading `.env*` files is OK for understanding what variables exist
- **NEVER** embed secrets in code — use `process.env.VAR` with no fallback
- Review scripts for hardcoded credentials before committing

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
   book-page gallery links; PR #2025 added a proxy-level strip for any
   `kind:'provider'` first segment so every provider-prefixed URL 308s to its
   global equivalent. Don't reintroduce provider-prefixed content paths.
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
   provider rows that also live there are legacy from when routing tried to
   double as an attribution registry — they're no longer used for routing
   after PR #2025 and are candidates for deletion. New contributing libraries
   go in `LIBRARY_PARTNERS`, not in the `tenants` collection.

## Authentication across subdomains

The NextAuth session cookie is set on `.sourcelibrary.org` (with the leading dot) in production, so signing in on `sourcelibrary.org` carries through to every tenant subdomain (`bph.sourcelibrary.org` today, `kloss/jung/...` later) and vice versa. Gated on `VERCEL_ENV === 'production'` — Vercel previews and localhost stay host-scoped.

**Identity shares, permissions do not.** Role checks still run via `memberships` collection lookups per tenant (`getTenantMembershipRole` in `src/lib/auth-helpers.ts`). A user signed in on the parent site does not inherit any tenant role just by visiting a subdomain; the `withAuth(handler, { minRole })` wrapper (and role-specific shorthands like `withEditorAuth`, `withAdminAuth`) continues to enforce per-tenant gates.

**CSRF token stays per-host** (`__Host-` prefix forbids the `domain` attribute, and each subdomain hits its own `/api/auth/*` routes).

Source: `src/lib/auth.ts` (cookies block). See `.claude/docs/auth-tenant-cookies.md` for the full rationale and rollback notes.

## Stack
- Next.js 16, MongoDB Atlas, Gemini AI, Vercel deployment
- Production database: `bookstore`, NOT `sourcelibrary_research`. As of 2026-05-26: ~46K total docs, ~29K `visible: true` (publicly shown), ~15K with `pages_count > 0` (actually processed), ~14K with any OCR. The `tier` field is legacy (only used by `src/app/page.tsx` homepage ranking, seeded by `scripts/tmp-write-highlighted-books.mjs`); current canonical "live" filter across all public APIs is `visible: true && pages_count > 0` (see `/api/books/library`).

## AI Models — IMPORTANT
- Summary/Index generation: enrich-worker uses `gemini-3.1-flash-lite-preview` for all phases — summary+index (Phase 6), chapters (Phase 7), quality scoring (Phase 7.5), collection assignment (Phase 7.6). NEVER use models older than v3.
- OCR/Translation routing: `gemini-3-flash-preview` for BPH books, `gemini-3.1-flash-lite-preview` for everything else (50% cheaper). See `src/lib/types/ai-models.ts`.
- Reference: https://ai.google.dev/gemini-api/docs/models

## Quality systems — two distinct scores
Image extraction emits two separate quality signals in the **same Gemini call**. They answer different questions and get stored in different places — don't conflate them.

- **`gallery_quality`** (per detected illustration, range 0.0–1.0) — *Is this image worth showing in the curated gallery?* Lives on `pages.detected_images[].gallery_quality` (source of truth) and `gallery_images.gallery_quality` (materialized view). Current rubric is 4-tier (0.4–0.6 musical scores / 0.6–0.8 non-figural illustrations / 0.8–0.9 figural / 0.9–1.0 exceptional). The gallery materialization threshold is **0.5** — anything below is filtered out before write. **Rubric drift watch:** the archived prompt at `prompts/image-extraction/image-extraction-v0.md` shows the *old* 6-tier rubric; the live prompt is inline in `scripts/workers/image-extract-worker.mjs`, `scripts/workers/pipeline-orchestrator.mjs`, and `src/lib/image-extraction.ts`. PR #450 (2026-03-27) made the change.

- **`scan_quality`** (per page, range 0–100 score + class enum) — *How cleanly was this page digitized?* Classes include `color_photo`, `bitonal_clean`, `bitonal_microfilm`, `microfiche`, `scanner_metadata`, `blank`, `corrupt`. Lives on `pages.scan_quality` (per page) + `books.scan_quality` (book rollup with `dominant_scan_class`, `median_score`, `has_microfilm_pages`, etc). **Currently only ~0.2% of pages have it** — scan_quality only fires when image extraction fires, and image extraction only fires on illustration-candidate pages. Design rationale + extension plan in `.claude/docs/automated-image-quality-system.md`.

A famous Kircher diagram has `gallery_quality: 0.9` whether the scan is pristine or microfilmed; the same diagram on microfilm has `scan_quality.scan_class: bitonal_microfilm` regardless of how gallery-worthy it is. See `/blog/what-makes-a-good-scan` for the user-facing version.

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
- **Book acquisition / curation:** `/curator` or `/library-curator`
- **Quality auditing:** `/qa-audit`
- **Batch processing:** `/batch-translate`
- **Handoffs:** `.claude/handoffs/` (read by date/topic)
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
