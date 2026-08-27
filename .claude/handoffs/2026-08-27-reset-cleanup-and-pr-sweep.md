# Post-reset cleanup + PR backlog sweep — 2026-08-27

Purely technical; no PII or business material. Committed deliberately (`git add -f`).

## Context

All terminals reset; this session asked "what needs cleanup?" and then swept the PR
backlog. Ran concurrently with several live re-opened sessions — one committed the
Fludd handoff (64c486eb) mid-cleanup, which briefly looked like ghost activity.

## Cleanup done

- **The stranded-`main` worktree is gone.** `fix+getty-csp-page-images` was the leftover
  of the 08-25/08-27 moved-ref incident: it held `main` with a phantom "staged" diff
  (index byte-identical to old commit bb9169aa — verified via `git write-tree` before
  touching anything). Completed the interrupted sync per
  `invariants/main-checkout-and-worktrees.md`, rescued its one unique file
  (`scripts/maintenance/reconcile-pages-archived-4190.mjs`, now untracked in the main
  checkout — exists nowhere in git; belongs to #4190), reaped the worktree. Only the
  main directory holds `main` now.
- Reaped 6 dead worktrees total (branches preserved); 2 had stale locks (dead pids).
- Deleted 5 unregistered leftover dirs in `.claude/worktrees/` (not git worktrees —
  no `.git` file). Unique content preserved first:
  `.sibling-bak/connector-directory-docs-2026-05/` (page3/4/6 + a diverged all-pages
  draft, never committed).
- **Kept, needs an owner:** `feat+corpus-dataset` worktree (uncommitted blog-page edit +
  `public/data/corpus/` — belongs to parked PR #3656) and `feat-lexicon-lookup`
  (`scripts/lexicon/output/`). Stash `wip blog-revisions` (Aug 16) still parked; its
  blog PR #4243 is open.

## PR sweep (56 → 42 open; every merged diff was read)

**Merged (14):** #3398 (`.vercelignore` excludes `.env*.local` — manual prod deploys had
been shipping real secrets in the bundle), #3765 (status-truth guard — after fixing a
verified crasher on its branch: projection listed both `pipeline_auto` and
`pipeline_auto.status`, a Mongo path collision that would throw on all 53
`setPipelineStatus` sites), #4266 (new: nanoid 3.3.18 — **`npm audit --omit=dev` is now
0 vulnerabilities**), docs/eval #3636 #4065 #4018 #3777 #3637 #3683, press page #4049,
dependabot #3621 #3706 #3995 (astrologuy) + #4003 #4004 #4005 (dev deps; #4005 is
eslint 10 — if lint misbehaves, revert that one).

**Blocked (label + comment on each):**
- **#3575** — superseded by #4205: main gates transliteration at limit 15 with
  `allowBotBypass:false`; the PR would regress to limit 200, UA-spoofable. Salvage: the
  machine-readable error code + sign-in CTA + twin-parameterized test, rewritten to
  main's 429 shape. Review also found a **pre-existing hidden-book leak** in the
  transliterate route (cached `transliteration.data` served for any page id, no
  `book-access` check) — NOT yet filed; Derek to decide public vs ops tracker.
- **#3546** hero mosaic — writes 7 `books` fields unregistered in
  `books-known-fields.json` (the field-sprawl PR lint postdates its green checks;
  merging breaks the lint for every later PR), plus a retry hole where a
  `MIN_TILES`-failing book re-runs a ~64-fetch rebuild every 10 min forever and
  `cacheNegative()` nulls a previously working mosaic.
- **#4006** prod dep group — red test is real: supabase-js 2.112 needs native
  WebSocket ⇒ CI needs Node ≥22 (or pin supabase). No longer security-urgent
  (nanoid shipped separately in #4266).

**Deliberately untouched:** #3441 (@google/genai 1→2) and #3442 (stripe 20→22) — major
bumps of the SDKs running the OCR pipeline and donations; tsc/type-green cannot prove
runtime safety for untyped `scripts/workers/*.mjs`. Need a tested bump. #2956 stays
NEEDS_WORK (55d, security). The **22 conflicting PRs** are mostly aged docs PRs that
the 08-27 CLAUDE.md restructure moved under — each claim needs re-verifying before
rebase/close; that's a dedicated session.

## Deploy

Tip of `main` built and **Ready** in production (5m build); purge+warm is the
automatic workflow.

## Lessons

- The stranded-checkout playbook worked exactly as written — including the
  `write-tree`-vs-old-commit verification that makes `reset --hard` provably lossless.
- New private memory: **Bash cwd persists across tool calls** — a `cd` chain left the
  shell inside a worktree and every subsequent git/ls read was coherent, confident, and
  about the wrong checkout (misread as "main has a phantom diff" and "directories
  vanished"). Print `pwd` in the same command as any state-changing git op.
- A dependabot lockfile family merges one-at-a-time: merge one, `@dependabot rebase`
  the rest (auto-merge is disabled repo-wide; a plain `gh pr merge` after rebase works).
