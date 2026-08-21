---
description: Triage the open-PR backlog — what's mergeable, superseded, conflicting, or blocked.
---

Run the PR triage report and act on it.

```bash
node scripts/maintenance/reap-prs.mjs --stale 7
```

## Why this exists

PRs pile up for the same structural reason worktrees do: **the session that opens a PR ends before the PR merges**, so nothing is left around to finish the job. `/reap-worktrees` solved this for checkouts; this is the sibling for PRs.

The cost is not tidiness. On 2026-07-28 the tail included **#2946**, a security dependency bump (`next` / `axios` / `nodemailer`) that sat mergeable-clean for 25 days while `npm audit --omit=dev` reported **3 criticals** in production dependencies — including `next-auth`. Throughput was fine that whole month (300 PRs merged in 30 days). A healthy merge rate hides a stale tail completely.

## How to read the output

- **MERGE_READY** — mergeable, gating checks green, nobody has blocked it. This is a *review queue*, not a merge list. Main has moved hundreds of commits under a 30-day-old PR; green checks say nothing about whether the code is still correct.
- **SUPERSEDED** — every file it changes is already byte-identical on main. Usually means the work was copied into the main checkout and pushed separately. Close it, don't merge it.
- **NEEDS_WORK** — carries a blocking review or the `blocked` label. Leave it alone until the finding is addressed.
- **CONFLICTING** — needs a rebase. For a small docs PR it is often faster to redo the change on a fresh branch than to rebase — but **re-verify the claim first**, because a conflicting docs PR is usually conflicting *because the doc moved under it*, and its assertion may now be false.
- **CHECKS_RED** — `test` or `DCO` failing. Vercel is deliberately not treated as gating: its first result is often a spurious failure that an automatic retry flips to pass.

## Rules when acting on it

1. **Read the diff before merging anything.** Do not batch-merge on classification alone. The 2026-07-28 sweep found an unvalidated `bookId` flowing straight into an R2 object key in #2956 — the exact #3362 footgun — in a PR that classified as MERGE_READY with all checks green.
2. **If you review a PR and find a problem, add the `blocked` label.** GitHub refuses `--request-changes` on your own PR, and nearly every PR here is self-authored, so `reviewDecision` is almost always null. The label is the only signal that survives to the next session.
3. **A PR touching `src/` still needs a prod deploy after merge.** Merging does not deploy; run `npm run deploy:prod` from `main` in the main checkout. Script-only changes (`scripts/**`) need no deploy — Hetzner auto-pulls.
4. **Check `npm audit --omit=dev` while you're here.** It is the thing most likely to have silently regressed, and no check reports it.
