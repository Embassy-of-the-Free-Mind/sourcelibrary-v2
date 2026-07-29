#!/usr/bin/env bash
#
# Production deploy for sourcelibrary.org — the ONLY safe way to ship frontend.
#
# Why this exists: a bare `vercel --prod` ships new asset hashes and purges the
# previous deploy's CSS/JS chunks, but it does NOT clear the CDN-cached HTML.
# next.config.ts caches rendered HTML at the edge for 24h (`CDN-Cache-Control:
# max-age=86400`) on /collections/*, /book/*, /author/*, /gallery/*, /browse/*,
# etc. So any page cached just before a deploy keeps pointing at a now-404'd
# /_next/static/chunks/*.css and renders FULLY UNSTYLED (looks like "broken
# images / junk content") for up to 24h. The automated post-deploy-warm.yml
# only fires on push-to-main, which does NOT deploy prod — so manual deploys
# skip the purge entirely. This wrapper closes that gap: deploy, then purge +
# warm, every time.
#
# Caching caveat (#3309): a Cloudflare purge clears the shared CDN edge, NOT
# browsers' private HTTP caches. An API response sent as `public, s-maxage=<n>`
# with no `max-age` is cached by the browser under RFC 9111 heuristic freshness
# and served with zero network requests — so a data correction (backfill,
# visibility flip, re-sync) can stay invisible in an already-open tab for days
# even after this purge runs. Content-derived API routes therefore ship
# `max-age=0` (browser revalidates; s-maxage still feeds the CDN). If a
# correction must be visible immediately to existing sessions, the response
# needs `max-age=0` BEFORE the stale copies are minted — purging afterwards is
# too late for copies already in browsers. Invariant pinned by
# tests/unit/api-cache-max-age.test.ts.
#
# Usage:  npm run deploy:prod   (or)   ./scripts/deploy-prod.sh
#
# Requires CLOUDFLARE_API_TOKEN, CLOUDFLARE_ZONE_ID, CRON_SECRET in
# .env.production.local (gitignored, Vercel-managed). NOTE: the purge needs
# CLOUDFLARE_API_TOKEN (Cache Purge scope) — CF_API_TOKEN is WAF-scoped only
# and returns an auth error on purge.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# 1. Guard: production deploys only from the main directory on `main`.
#    `vercel --prod` deploys whatever is on disk, ignoring Vercel's branch
#    setting — shipping a feature branch to prod is a real foot-gun.
BRANCH="$(git branch --show-current)"
if [ "$BRANCH" != "main" ]; then
  echo "✗ Refusing to deploy prod from branch '$BRANCH'. Switch the main directory to 'main' first." >&2
  exit 1
fi

# 1b. Guard: the branch must also be CURRENT, not merely named `main`.
#
#     Being on `main` says nothing about whether `main` is up to date. On
#     2026-07-27 the shared main checkout sat 125 commits behind origin/main —
#     it passed the branch check above cleanly, and `vercel --prod` ships what
#     is on disk, so a deploy from it would have silently reverted months of
#     merged work on the live site. Nothing in the deploy output would have
#     said so: the build succeeds, the purge succeeds, the summary prints "✓".
#
#     This checkout is shared by ~10 concurrent sessions, so it goes stale
#     without anyone doing anything wrong — no one session owns pulling it.
#
#     Override with ALLOW_STALE=1 for a deliberate rollback to an older commit.
if [ "${ALLOW_STALE:-}" != "1" ]; then
  echo "▸ Checking that main is current…"
  if git fetch --quiet origin main 2>/dev/null; then
    BEHIND="$(git rev-list --count HEAD..origin/main 2>/dev/null || echo 0)"
    AHEAD="$(git rev-list --count origin/main..HEAD 2>/dev/null || echo 0)"
    if [ "$BEHIND" -gt 0 ]; then
      echo "✗ Refusing to deploy: local main is $BEHIND commit(s) BEHIND origin/main." >&2
      echo "  Those commits are merged but would NOT be on the live site." >&2
      echo "  Fix:  git pull --ff-only origin main && npm install" >&2
      echo "  (npm install matters — a merged package.json change leaves node_modules stale.)" >&2
      echo "  Deliberate rollback to an older commit?  ALLOW_STALE=1 npm run deploy:prod" >&2
      exit 1
    fi
    if [ "$AHEAD" -gt 0 ]; then
      # Not fatal: `vercel --prod` deploys the working tree either way, so this
      # is about telling the operator what they are actually shipping.
      echo "  ⚠ local main is $AHEAD commit(s) AHEAD of origin/main — deploying unpushed work."
    else
      echo "  ✓ main is current with origin/main."
    fi
  else
    # No network / no remote: warn, don't block. A deploy that can't reach
    # GitHub can still be a legitimate emergency deploy.
    echo "  ⚠ could not fetch origin — skipping the freshness check." >&2
  fi
fi

# 2. Load production env (CF token, zone, cron secret). No secrets are hardcoded.
if [ ! -f .env.production.local ]; then
  echo "✗ .env.production.local not found — cannot read CLOUDFLARE_API_TOKEN/ZONE_ID/CRON_SECRET." >&2
  exit 1
fi
set -a; source .env.production.local; set +a

for var in CLOUDFLARE_API_TOKEN CLOUDFLARE_ZONE_ID CRON_SECRET; do
  if [ -z "${!var:-}" ]; then
    echo "✗ $var is not set in .env.production.local." >&2
    exit 1
  fi
done

# 3. Refresh blog revision dates from git history ("Last revised …" in the
#    note footer). Non-fatal: the committed JSON is a good-enough fallback.
echo "▸ Refreshing blog revision dates…"
node scripts/maintenance/generate-blog-revisions.mjs || echo "  (skipped — using committed blog-revisions.json)"

# 4. Typecheck before burning a deploy cycle (the #1 source of wasted deploys).
echo "▸ Typechecking (npx tsc --noEmit)…"
npx tsc --noEmit

# 5. Deploy to production.
#    Do NOT let a nonzero exit from the CLI abort the script before the purge:
#    `vercel --prod` can deploy SUCCESSFULLY and then exit nonzero on a
#    post-deploy status-poll timeout (ETIMEDOUT against api.vercel.com — bit us
#    2026-06-04). Skipping the purge is far worse than purging after a failed
#    deploy (a purge is always safe; stale HTML pointing at purged CSS is not).
#    Resolve the CLI: prefer a global `vercel`, fall back to `npx vercel` so the
#    script self-heals if ~/.npm-global/bin/vercel ever goes dangling (a removed
#    global package left a broken symlink behind — bit us 2026-06-26).
if command -v vercel >/dev/null 2>&1; then
  VERCEL=(vercel)
else
  echo "  (global 'vercel' not found — using 'npx vercel')" >&2
  VERCEL=(npx --yes vercel)
fi
echo "▸ Deploying to production (${VERCEL[*]} --prod)…"
DEPLOY_EXIT=0
"${VERCEL[@]}" --prod || DEPLOY_EXIT=$?
if [ "$DEPLOY_EXIT" -ne 0 ]; then
  echo "  ⚠ vercel exited $DEPLOY_EXIT — verifying whether the deployment actually shipped…" >&2
  PROD_OK=$(curl -s -o /dev/null -w "%{http_code}" --max-time 30 "https://sourcelibrary.org/" || echo 000)
  echo "  prod / responds: HTTP $PROD_OK — continuing to purge + warm regardless." >&2
fi

# 6. Purge the CDN so cached HTML can't outlive the assets it references.
echo "▸ Purging Cloudflare cache (purge_everything)…"
PURGE=$(curl -s -X POST \
  "https://api.cloudflare.com/client/v4/zones/${CLOUDFLARE_ZONE_ID}/purge_cache" \
  -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" \
  -H "Content-Type: application/json" \
  --data '{"purge_everything":true}')
if echo "$PURGE" | grep -q '"success":true'; then
  echo "  ✓ Cloudflare cache purged."
else
  echo "  ✗ Cloudflare purge failed: $PURGE" >&2
  echo "    (Pages may serve stale HTML/dead CSS until this is re-run.)" >&2
  exit 1
fi

# 7. Re-warm top pages so the next visitor gets a fresh, styled page from cache.
echo "▸ Warming caches (/api/deploy-warm)…"
WARM_CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST \
  "https://sourcelibrary.org/api/deploy-warm" \
  -H "Authorization: Bearer ${CRON_SECRET}" \
  -H "Content-Type: application/json" \
  --max-time 300 || true)
echo "  deploy-warm → HTTP $WARM_CODE"

if [ "$DEPLOY_EXIT" -ne 0 ]; then
  echo "⚠ Purge + warm completed, but the vercel CLI exited $DEPLOY_EXIT — verify the deployment shipped (vercel ls sourcelibrary-v2 | head -2)." >&2
  exit "$DEPLOY_EXIT"
fi
echo "✓ Production deploy complete (deployed → purged → warmed)."
