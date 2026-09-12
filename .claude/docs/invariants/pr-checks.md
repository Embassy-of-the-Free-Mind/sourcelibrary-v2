# A PR's check list can be wrong, missing, or stale — judge the mechanism, not the colour

**Read this when:** deciding whether a PR is mergeable, reading a red/green check list, sweeping the PR backlog, or a PR's CI looks odd (missing runs, old runs, a red Vercel check).

*Demoted from `CLAUDE.md` on 2026-08-27. The incidents are unchanged; the body keeps only the rules.*

---

## The Vercel check can be red while the build succeeded

The Vercel check often shows "fail" on the first build, then an automatic retry flips it to pass (the
deployment is frequently still "Building" when GitHub reports the fail). Sometimes it **never** flips
even though the retry succeeded (PR #3813): the check status belongs to the first attempt and a
Vercel-side retry doesn't always update it.

When `test`/DCO are green and only Vercel is red, judge by `npx vercel ls sourcelibrary-v2` — a
`● Ready` Preview build **for the branch** means merge. **Those last three words are load-bearing and
were missing until 2026-08-18**, when a red check on #4027 was nearly waved through on the strength of
a `● Ready` Preview sitting at the top of the list: it belonged to somebody else's branch. `vercel ls`
is shared across every session's worktree, and several are usually building at once, so scope it —
`npx vercel ls sourcelibrary-v2 --meta githubCommitRef=<branch>`, or `--meta githubCommitSha=$SHA`
when you want the one deployment for the commit in hand — or confirm ownership with
`npx vercel inspect <url>` and read the `Aliases` line, which carries the branch name.

The #4027 failure was real: #4024 had added `scripts/output` to `.vercelignore` and swept away three
tracked JSONs that `src/app/read/gilgamesh/page.tsx` imports at build time; #4029 fixed it four
minutes after that build ran. **Tell that you are in the real-failure case rather than the flake
case:** the branch's OWN newest deployment is `● Error` with a short duration (a resolve/compile
failure), not `● Building`. When the breakage was somebody else's and is already patched on main,
merge `origin/main` in and let it rebuild.

## A PR whose CI never RAN looks greener than one that failed

On 2026-08-21 #4120 showed `DCO pass` + `Vercel pass` and nothing else; `gh run list --branch
<branch>` returned **no runs at all**, while other branches were building normally the same minute.
Every check present was green, so "are the checks green" said merge — and would have shipped untested
code.

- **Count the checks.** This repo's PRs carry `test` and `field-write-lint`; if either is absent, CI
  did not run, which is not the same as passing. `unit-tests.yml` has no path filters and fires on
  every PR to `main`, so absence is always anomalous.
- **The usual cause is a CONFLICTING PR**, and the diagnosis is a one-liner:
  `gh pr view <n> --json mergeable`. GitHub builds the `pull_request` run against the *merge* commit;
  when main has moved into a conflict it cannot compute one and silently queues nothing — no failure,
  no annotation, just a short check list. Seen again on #4159 the same day: three pushes produced no
  runs while `mergeable` read `CONFLICTING`. Fix: merge `origin/main` into the branch, resolve, push —
  `test` then passed in 2m27s. Check `mergeable` first so "merge main and it wakes up" is a mechanism,
  not a superstition.
- **A recreated branch gets no CI either** — deleting and recreating a branch under an open PR leaves
  the PR pointing at runs that will never re-fire.

## A long-open PR shows the opposite tell: a FULL green list that is simply old

#3127 (2026-08-21) carried `test pass` + `field-write-lint pass` + `DCO pass` — nothing short about
it — from a run dated **24 days earlier**, because the branch only went `CONFLICTING` *after* that
run, and a conflicting branch produces no new runs to replace the stale ones. Counting checks says
merge; the timestamp is the tell. Read the age column on anything open more than a few days, and run
`gh pr view <n> --json mergeable` BEFORE trusting a green list, not only when the list looks short.

## Sweeping the backlog

- **A healthy merge rate hides a stale PR tail — sweep it with `/reap-prs`.** PRs accumulate for the
  same structural reason worktrees do: the session that opens one ends before it merges, so nothing is
  left around to finish the job. On 2026-07-28 the repo was merging 300 PRs/30 days while 18 PRs sat
  >20 days untouched — including **#2946**, a mergeable-clean security dependency bump open 25 days
  while `npm audit --omit=dev` reported 3 criticals in production deps, `next-auth` among them. No
  check reports that, so run `npm audit --omit=dev` when you sweep.
- **Never batch-merge on classification alone — read every diff.** "Mergeable + checks green" says
  nothing about whether code is still correct after main has moved hundreds of commits under it. The
  sweep that motivated `/reap-prs` found an unvalidated `bookId` interpolated straight into an R2
  object key (reproducing #3362) in a PR that classified MERGE_READY with everything green. Green
  checks measure that a PR *can* merge, never that it *should*.
