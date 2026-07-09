Clean up finished git worktrees safely.

Run `node scripts/maintenance/reap-worktrees.mjs $ARGUMENTS` from the main checkout.

- With no arguments it's a **dry-run**: it lists what would be removed and what it's
  keeping (in-use, stranded work, open PR). Show the user that output.
- To actually remove them, run with `--apply`. Add `--merged-only` to keep worktrees
  whose PR is still open, and `--prune-branches` to also delete the local branches.
- The script preserves all branches and commits — a removed worktree is just
  re-checkout-able. Only the working directory goes.

**It is safe to run while other Claude sessions are open.** The reaper decides by
occupancy, not by counting sessions: a worktree is kept if a live process has its cwd
inside it, if its git lock names a running pid, or if it holds real uncommitted work.
Everything else is an orphan whose session already ended. This is why `/gnite` can reap
one window at a time — each pass cleans up after the dead, never the living.

Don't reach for `--force`. It only exists for the case where `lsof` is unavailable and
occupancy can't be determined, at which point the script falls back to a conservative
"any other session ⇒ refuse" check. Forcing past a *live* occupancy result would yank a
working directory out from under a running session.

Stale locks (lock pid is dead) are unlocked and reaped automatically. Live locks are
kept — `git worktree remove --force` refuses a locked worktree anyway (git wants
`-f -f`), so unlocking is a deliberate, checked step rather than a flag.

After it runs, briefly summarize what was removed and surface any worktree it kept for
stranded uncommitted work, so the user can deal with it.
