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

## 4. Reflect — both directions of the ratchet

This is the point of `gnite` beyond tidying: the session is over, the lesson is fresh,
and nobody will ever be better placed to write it down or throw it away. Ask **both**
questions, not just the first. The first one alone is why `CLAUDE.md` grew from ~290
lines to 827 in three months.

**Up — does `CLAUDE.md` or an invariant doc need something new?** If this session hit a
non-obvious failure that would bite the next person, PR the doc change now. Otherwise
the lesson lives only in the handoff and decays. Decide *which tier*:

- Applies no matter what you're working on → `CLAUDE.md`.
- Fires only when you touch a subsystem → a new or existing
  `.claude/docs/invariants/<name>.md`, with a one-line trigger entry added to the
  routing table in `CLAUDE.md`. **If you can name the file or subsystem that triggers
  the rule, it goes here.**

**Down — is anything in `CLAUDE.md` no longer earning its place?** Do not skip this
because nothing feels wrong; it never feels wrong. Concretely:

- `wc -l CLAUDE.md` — the budget is **~250 lines**. Over it, something must be demoted
  to `invariants/` before anything is added.
- Did this session read a section that turned out to be **conditional**? Demote it.
- Did it hit a rule that **contradicts** another, or a second write-up of the same
  incident under a different aphorism? Merge them — don't append a correction beside the
  thing it corrects.
- Did it find a **stale stat, dead pointer, or fixed-and-closed backlog** stated as
  current? Fix it in place, in this repo *and* in `~/.claude/CLAUDE.md` if it appears
  there too. A rule in two files diverges; check the twin.
- Anything dated more than ~14 days that this session actually depended on: re-measure
  or mark it unverified.

**Then sweep the private memory store.** `~/.claude/projects/<project>/memory/` is
per-machine and gitignored, and it accretes faster than the repo does:

- New entries from this session: is any of it **team knowledge**? Run
  `/promote-lessons` to propose moving it into the repo (or the ops repo). A lesson only
  Claude-on-this-machine knows is one laptop away from being lost.
- `MEMORY.md` is loaded every session — keep it a one-line-per-memory index. Entries
  that have gone cold move down into the `_index-*.md` recall tier rather than being
  deleted.
- Contradictions and superseded entries: delete or correct them. A wrong memory is
  worse than a missing one, because it is trusted.
- `/audit-memory` does this systematically when it's been a while.

Keep this pass short — a couple of minutes. It is a *sweep*, not a project. If it turns
up something big, file an issue rather than starting work.

## 5. Say goodnight

A short summary of where we left off and what's next. That's all.
