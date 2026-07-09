Wrap up the session: commit, push, reap, hand off.

"gnite" means **this window is closing** — not that every window is. Other Claude
sessions are usually still running, and that's fine: every step below is safe to run
concurrently with them. No new work, no questions, no strategic advice.

## 1. Commit and push whatever is here

- `git status` — if there are uncommitted changes, commit them with a clear message
  and `Signed-off-by: JDerekLomas <j.d.lomas@tudelft.nl>` (the DCO bot blocks PRs without it).
- Push. If this is a worktree with a feature branch and the work is complete,
  open a PR (`gh pr create --base main`).
- **Never leave uncommitted work in a worktree** — it's invisible to every other session,
  and the reaper will keep the worktree around rather than touch it.

## 2. Reap dead worktrees

Run from the main checkout:

```
node scripts/maintenance/reap-worktrees.mjs --apply --merged-only --prune-branches
```

This is safe with other windows open. The reaper decides by **occupancy**, not by
counting sessions: a worktree is kept if a live process has its cwd inside it, if its
git lock names a running pid, or if it holds real uncommitted work. Everything else is
an orphan whose session ended — which is exactly what accumulates, because a worktree
can't be removed while its PR is open, and the PR merges after the session is gone.

So each `gnite` cleans up after the *dead*, not after the living. One window at a time
is the intended cadence. `--merged-only` additionally keeps any worktree whose PR is
still open, so in-flight work survives even if its session ended.

Show the user what was removed, and surface anything kept for stranded uncommitted
work so they can deal with it. Don't pass `--force` — it exists only for the case
where `lsof` is unavailable and occupancy can't be determined.

## 3. Hand off if the session was complex

Write `.claude/handoffs/YYYY-MM-DD-topic.md` covering: files modified, task state,
test/deploy outcomes, what was agreed. Skip for short or routine sessions.

**This repo is public (AGPL).** Operational and business material — fundraising,
contacts, outreach, budgets, donors, sponsors — goes in the private
`sourcelibrary-ops` repo (`~/sourcelibrary-ops`), never here.

Then ask the handoff question: **does `CLAUDE.md` need a new invariant?** If this
session hit a non-obvious failure that would bite the next person, PR the doc change
now. Otherwise the lesson lives only in the handoff and decays.

## 4. Say goodnight

A short summary of where we left off and what's next. That's all.
