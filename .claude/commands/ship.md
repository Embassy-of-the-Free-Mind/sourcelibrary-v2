Commit all staged and unstaged changes, push, create a PR, merge, deploy, and warm caches.

1. Run `git status` and `git diff` to understand all changes
2. Stage all relevant files (not .env files or secrets)
3. Write a concise commit message focused on the "why"
4. Commit, push to current branch (create remote branch if needed with -u)
5. Create a PR with `gh pr create` — short title, bulleted summary, test plan
6. Merge the PR with `gh pr merge --squash --admin`
7. Announce the merge to affected peer sessions: run `ListAgents`, and if the change
   plausibly lands under another session's open work (schema change, shared lib,
   `src/lib/**`, pipeline behavior — not a leaf page or doc tweak), `SendMessage` those
   peers a one-liner: what merged, what moved, whether they should rebase. Skip when
   nothing is affected or no peers are listed.
8. Switch back to main and pull: `git checkout main && git pull origin main`
9. Deploy to production: `vercel --prod --yes`
10. After deploy succeeds, purge Cloudflare cache and warm:
   ```
   set -a; source .env.production.local; set +a
   curl -s -X POST "https://api.cloudflare.com/client/v4/zones/${CLOUDFLARE_ZONE_ID}/purge_cache" \
     -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" \
     -H "Content-Type: application/json" \
     -d '{"purge_everything": true}'
   curl -s "https://sourcelibrary.org/api/cron/warm" -H "X-Warm-Ping: 1"
   ```
11. Verify the site is serving HTML (not RSC data): `curl -s -o /dev/null -w "%{content_type}" "https://sourcelibrary.org/"`
12. Return the PR URL

If on main, create a feature branch first with a descriptive name.
If in a worktree, after merge exit the worktree and clean up.
