# PR backlog sweep + the dependency blind spot — 2026-07-29

One triage session. Started as "anything to merge or close?", ended with the whole
open-PR tail unblocked and a monitoring gap closed. Recording it because three of
the findings are the kind that look like nothing and aren't.

## Outcome

- **7 PRs merged** (#3393, #3417, #3390, #3325, #3380, #3316, #3397), each diff read.
- **11 PRs unblocked**: 4 on missing DCO signoff, 6 on conflicts, 1 on a "failing test"
  that was not a test.
- **4 PRs opened**: #3426 (tenant footer), #3431 (security bumps), #3432 (dependency
  monitoring), #3430 (doc correction).
- **1 issue filed**: #3427 (production dependency vulnerabilities).
- End state: 20 open PRs, **0 conflicting, 0 failing**.

## Finding 1 — the footer was never wired to the tenant block list (#3426)

`GLOBAL_ONLY_TENANT_PAGE_PATHS` exists as ONE list so the proxy block and the site
nav can never disagree. `SiteHeader` was wired to it in #3364. `GlobalFooter` never
was. Measured live on bph.sourcelibrary.org: `/about`, `/about/progress`, `/vision`,
`/census`, `/research`, `/blog`, `/contribute`, `/support`, `/sponsors`, `/libraries`
— **ten links, all 404**, on EFM's public face.

**Why the leak audit passed the whole time.** It asks whether links resolve
*off-domain*. These resolve on-domain perfectly; the destination just doesn't exist.
Same shape as #3364 (relative hrefs, clean audit, 102 foreign books rendered): a
hostname check cannot see a content or existence problem. When you add a tenant
surface, ask what it *renders* and what its links *reach*, not only where they point.

The filter moved to `src/lib/footer-nav.ts` so the guard can call it. The repo has no
DOM test harness, and a test that grepped `GlobalFooter.tsx` for a string could only
catch deletion — the failure mode CLAUDE.md already documents from #3383. Negative
control run: reverting the filter to a pass-through fails 2 of 6.

## Finding 2 — a transitive advisory is not cleared by bumping the package you think owns it (#3431)

`npm audit --omit=dev` reported 3 criticals in production deps, one being an Auth.js
advisory where *configuration errors can cause existence-based auth checks to fail
open* — directly relevant to the tenant permission model.

Bumping `next-auth` to beta.32 did **not** clear it. beta.32 already depends on the
patched `@auth/core@0.41.3`, but `@auth/mongodb-adapter@3.11.1` pinned `0.41.1`, and
npm hoisted the **vulnerable** copy to the top of the tree. `npm ls @auth/core` showed
both. The fix was bumping the adapter — a package nobody suspected, which consumes
`@auth/core` for types only (`import type { Adapter }`), so the change is inert at
runtime and the real effect is the dedupe.

**Rule: when a vulnerability survives an upgrade of its own package, run `npm ls
<pkg>` and look for a second parent before concluding the bump failed.**

Second half of the same finding: the closed PR #2946 proposed `nodemailer@9.0.3`.
`next-auth@5.0.0-beta.32` declares its peer as `^7.0.7 || ^8.0.5`, and we use
`next-auth/providers/nodemailer` for magic-link sign-in — 9.x is outside the supported
range for the only path that consumes it. Went to 8.0.11 instead. That PR being closed
unmerged was accidentally lucky.

Criticals: 3 → 1. The remainder is `protobufjs`, needing the `@xenova/transformers`
major (CLIP embeddings) — deliberately deferred.

## Finding 3 — nothing watched dependencies at all (#3427 / #3432)

No `.github/dependabot.yml`, no CI audit. The only instrument was a line in CLAUDE.md
telling a human to run `npm audit --omit=dev` during a `/reap-prs` sweep. Someone did,
on 2026-07-03, opened #2946 — and it sat 25 days and was closed unmerged on 07-28,
almost certainly by a stale-PR sweep.

Monitoring added in #3432 is shaped around the repo's own lesson that *an alarm nobody
reads is not an instrument*: dependabot grouped and capped at 5 PRs (ungrouped would
open ~15/week here, and a flood gets swept closed exactly the way #2946 was), and a
weekly audit that keeps ONE tracking issue in sync rather than filing a new one. It
fails the job on a critical so the run goes red, but is deliberately **not** a required
PR check — failing a contributor's unrelated PR is the alarm people learn to click past.

## Finding 4 — "test failure" was the typechecker (#3312)

#3312 showed `test: FAILURE` for a week. Every unit test passed. The failure was the
`npx tsc --noEmit` step inside the same job: `TS1501`, the `s` (dotAll) regex flag
against an ES2017 target. **The check name is the job, not the step that failed** —
read `--log-failed` before assuming a red `test` means a broken test.

Its conflict was semantic, not textual: main had rewritten the book page's metadata
block around `buildSeoTitle`/`buildSeoDescription` (`src/lib/book-seo.ts`), and those
helpers interpolate `year` **raw**. Merging main's version as-is would have
reintroduced the exact free-text-date bug the PR exists to fix, in a new location.

## Process notes worth keeping

- **I truncated #2902 and caught it on a verification step.** Pushed mid-rebase after
  resolving only the first of three commits, dropping two. Recovered the pre-push tip
  from `git reflog show refs/remotes/origin/<branch>`, finished the rebase, and
  confirmed the branch delta matched the original exactly (244 files, 9,629
  insertions, identical file set) before re-pushing. **Never push from inside a
  rebase; a multi-commit branch conflicts more than once.**
- **A pre-commit hook can silently abort `--amend`.** The missing-lamejs
  `check-imports` failure aborted an amend on #3297 while I read the *following*
  command's output as success, and I force-pushed the unfixed commit. Copy
  `src/lib/vendor/lamejs-bundle.js` into every fresh worktree before the first commit,
  and check `git status` after an amend.
- **Rebase re-litigates decisions a branch already made; merge preserves them.**
  #3350 had two merge commits deliberately yielding its calibration scorecard to
  #3336. Rebasing fought all of it; merging collapsed the branch to its true delta of
  one file (the rest superseded by #3336 and #3346).
- **A stale branch can silently revert main.** #3297's `CLAUDE.md` line referenced
  `scripts/maintenance/bulk-flag-tibetan-ft.mjs`; main had since moved it to
  `scripts/_archived/`. My first resolution took the branch's side. Caught it on the
  numstat showing a deletion where a pure append should have shown none.
- The branch-guard hook keys off the **session cwd**, not a leading `cd` — a `cd` inside
  a compound command doesn't satisfy it. Use `EnterWorktree` (including `path:` for an
  existing worktree) to do branch work.

## Re-measured issue claims

| issue | claim | measured 2026-07-29 |
|---|---|---|
| #3419 | 99 rows of raw model output in `gallery_images.type` | **99** — exact |
| #3407 | 14 unread feedback, 4 volunteers | 14 unread ✓, **11** volunteers |
| #3307 | 1,446 books with fabricated year 1700 | **1,660** |
| #3332/#3334 | ~6.3K visible books with stale `hidden_reason` | **0** — cleanup landed |
| #2266 | `/browse` renders zero crawlable book links | still **0** |

## CLAUDE.md

PR #3430 corrects the `hidden_reason` claim, which read as live and measures zero.

The two new invariants worth adding — the transitive-hoisting rule and "the nav filter
must cover the footer, not just the header" — are stated in #3431 and #3426 rather than
in CLAUDE.md, because both are already implied by existing sections (the one-list rule
and the paired-artifacts rule). If either recurs, promote them.

## Open

- `sharp` and `@xenova/transformers` majors (last critical) — need real verification,
  not a version bump.
- #3432's `gh issue` sync path is unverified until its first scheduled run (Mondays 07:00 UTC).
- #3426 needs confirming on the real subdomain after deploy — a Vercel preview cannot
  verify it, since a preview host is not a `.sourcelibrary.org` subdomain and
  `useEmbedContext` reads false there.
