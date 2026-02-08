Commit all staged and unstaged changes, push, and create a PR.

1. Run `git status` and `git diff` to understand all changes
2. Stage all relevant files (not .env files or secrets)
3. Write a concise commit message focused on the "why"
4. Commit, push to current branch (create remote branch if needed with -u)
5. Create a PR with `gh pr create` — short title, bulleted summary, test plan
6. Return the PR URL so I can open it

If on main, create a feature branch first with a descriptive name.
