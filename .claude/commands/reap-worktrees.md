Clean up finished git worktrees safely.

Run `node scripts/maintenance/reap-worktrees.mjs $ARGUMENTS` from the main checkout.

- With no arguments it's a **dry-run**: it lists which worktrees would be removed and flags any with real uncommitted work (those are kept). Show the user that output.
- If the user wants to actually remove them, run with `--apply`. Add `--merged-only` to keep worktrees whose PR is still open, or `--prune-branches` to also delete the local branches.
- The script removes only worktrees with no real uncommitted work and preserves all branches/commits (a removed worktree is just re-checkout-able). It refuses `--apply` while other claude sessions look active — best run when sessions are closed.

After it runs, briefly summarize what was removed and surface any worktrees it kept for having stranded uncommitted work, so the user can deal with them.
