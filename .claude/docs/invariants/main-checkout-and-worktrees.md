# The shared main checkout and its worktrees

**Read this when:** diagnosing from files in the main directory, running any git operation in a worktree, setting up a fresh worktree, reaping worktrees, or the main checkout shows staged changes nobody remembers making.

*Demoted from `CLAUDE.md` on 2026-08-27. The rules stay in the body's Multi-Session Awareness section; this file keeps the incidents and mechanics.*

---

## A stale checkout produces a confident, coherent, WRONG diagnosis

On 2026-08-04 a reader-reported bug ("I can't click the cover to set it any more") was traced to
`CoverImagePicker` mounting only in the embed-only block of `src/app/book/[id]/page.tsx` — specific,
internally consistent, and about a tree nobody runs: the main directory was sitting on another
session's `feat/measure-ai-agent-requests`, which predates the fix (#3533, merged the same day the
feedback arrived). An issue was filed against code that had already been fixed. **The session had
flagged the unexpected branch in its first message and then reasoned from the files anyway** —
noticing is not the same as acting on it.

Before diagnosing from source, confirm the tree: `git merge-base --is-ancestor <suspected-fix>
origin/main`, or read the file with `git show origin/main:<path>`. "Verify a flagged bug against
current code" means *current* = `origin/main`, not whatever is on disk.

**The same ghost bites EDITS (#3916, 2026-08-11):** `BookInfo` in `src/app/book/[id]/page.tsx` has
TWO top-level returns — the standard layout and an embed-only one — and a panel mounted in the embed
return shipped invisibly to every real book page; five infrastructure theories died by measurement
before a local repro with debug logs found the branch that never renders. Before mounting anything in
that file, find WHICH return renders the surface you mean — and when a deployed change doesn't
render, reproduce locally FIRST, theorize second.

## A worktree isolates the FILES, not production — the `locus_anchors` clobber

Mongo, Supabase and R2 are shared by every session, so a new collection is shared mutable state
the moment you name it, and two sessions can each believe they own it.

On 2026-08-08 two sessions implemented #3661 in parallel. Both wrote `locus_anchors`, with
**incompatible schemas** (`ref_page` vs `page`). The second extractor replaced 6,324 rows with
4,279 **four minutes after the first PR merged**, and `/api/locus` then answered *every* reference
with `witness_count: 0` and an honest "no witness holds an anchor at this reference" — a message
indistinguishable from a genuine gap in the corpus. The feature was dead and looked merely empty.

Three consequences, and the third is the one people skip:

- **Claim the issue before starting** — a "taking this" comment. This was the **fifth** time
  parallel work on one issue cost real effort.
- **A row count is not an integrity check.** The foreign rows carried `book_id`, so every per-book
  count passed while the feature was dead. Assert the SHAPE, not the cardinality.
- **A write-time guard cannot help here.** The clobbering writer is another session's script and
  does not run your guards. The check has to live on the READ side, or in an audit that both sides
  run. This is why "add validation to the writer" is the wrong instinct for shared-state races.

## A moved `main` ref strands the main checkout — phantom staged changes

On 2026-08-25 and again 2026-08-27, `git checkout -B main origin/main` run **from a worktree** wrote
"branch: Reset to origin/main" into the branch reflog and moved the shared `main` ref — without
touching the main directory's index or files. The main checkout was left describing a 6-day-old
commit: `git status` showed **157 files "staged"** that were actually a mass revert of a week of
merged work, and every session in the main directory read week-old code and doctrine. Committing that
state would have shipped the revert.

- **A large staged diff you didn't create is a moved ref, not in-progress work.** Diagnose with
  `git reflog show main` ("branch: Reset to …" = someone force-moved it) and compare
  `git diff --cached <old-head>` — if the index is byte-identical to an old commit, nothing is lost
  and `git reset --hard HEAD` completes the interrupted sync.
- The branch-guard hook blocks `checkout -B main` / `switch -C main` / `branch -f main` from
  anywhere in the repo, including worktrees. A worktree that needs current main should `git fetch` and
  branch from `origin/main`, never take the `main` ref itself.

## A detached job writing into a worktree makes every git operation there destructive

`git reset`, `git checkout <branch>`, and `git stash` restore tracked files from the index —
including the file a `nohup`'d sweep is appending to right now. This cost ~96 rows of paid OCR eval
output (≈$1.20) on 2026-07-19 (#3235): the reset rolled the outputs JSONL back to its committed
325-line state mid-run, and the raw model text was unrecoverable because only a human-readable
summary log survived. **The tell is invisible** — `git status` shows the file as plain "modified,"
indistinguishable from ordinary uncommitted work.

- Before any git op in a worktree, check for live writers (`ps aux | grep`, or `lsof <file>`).
- When starting a long append-only job, snapshot its output to the scratchpad on a timer so a stray
  reset can't destroy it.
- Never gate a downstream job on an **absolute line count** of such a file (the driver waiting for
  "469 lines" could never be satisfied after the truncation) — gate on the producer's liveness or a
  per-unit completeness check.

## Fresh-worktree setup

- **`vercel` from a fresh worktree silently creates a NEW Vercel project** (named after the worktree
  dir) and deploys it as that project's Production — the link file `.vercel/project.json` is
  gitignored and absent from new checkouts. Before any `vercel` invocation in a worktree:
  `mkdir -p .vercel && cp <main-dir>/.vercel/project.json .vercel/`. Junk project cleanup:
  `vercel remove <name> --yes`.
- **Fresh worktrees fail the pre-commit `check-imports` hook** because
  `src/lib/vendor/lamejs-bundle.js` is gitignored and absent from a new checkout. Before your first
  commit: `mkdir -p src/lib/vendor && cp <main-dir>/src/lib/vendor/lamejs-bundle.js src/lib/vendor/`.
  The `mkdir` is load-bearing — that directory contains nothing but the gitignored bundle, so it does
  not exist in a fresh worktree and the bare `cp` fails.

## Reaping

- **Worktrees accumulate structurally, not from sloppiness.** A worktree can't be removed while its
  PR is open, and the PR merges *after* the creating session ends — so nothing is left to reap it.
  Per-session `ExitWorktree` discipline cannot fix this. `/gnite` runs the reaper; `/reap-worktrees`
  runs it on demand.
- **Judge a worktree by occupancy, never by a global session count.** `reap-worktrees.mjs` keeps a
  worktree iff a live process has its cwd inside it (`lsof -d cwd`), its git lock names a running
  pid, or it holds real uncommitted work. Everything else is an orphan. Asked per worktree the
  question is exact, so reaping is safe with other sessions open. The old `ps | grep -i claude` count
  reported **34 sessions on a machine running 3** (it matched the desktop app, the dashboard, and MCP
  helpers), so `--apply` always refused and the habit became `--force` — the one genuinely dangerous
  flag. A noisy safety check doesn't fail closed; it trains people to bypass it.
- **`git worktree remove --force` refuses a *locked* worktree** — git wants `-f -f`. Don't force
  twice. `EnterWorktree` writes its session pid into the lock reason, so a dead pid means a stale
  lock (unlock, then reap) and a live pid means someone is working (keep). Locking is a deliberate
  "don't touch" signal; the reaper honors it.
