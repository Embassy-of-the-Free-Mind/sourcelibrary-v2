#!/usr/bin/env bash
# PRIOR ART: ../translation-corpus-audit/monthly-draw.sh (the monthly audit's stage 1; this is that script with the
# fortnightly cadence, the spot-check draw and #5914 as the alarm issue). Stage 1 of 2 of the FORTNIGHTLY spot check
# (#5914, runbook ROUTINE.md): the DRAW, which needs Mongo and so runs on Hetzner. No model call, no spend.
#
#   crontab (Hetzner), every Monday; the script itself skips the off weeks:
#   0 5 * * 1 [ -f /root/sourcelibrary/scripts/eval/spot-check/fortnightly-draw.sh ] && flock -n /tmp/sl-spot-check.lock bash /root/sourcelibrary/scripts/eval/spot-check/fortnightly-draw.sh >> /var/log/sourcelibrary/spot-check.log 2>&1
#
# Cron cannot say "every other Monday", so the parity lives here: a draw week is a whole even number of weeks after
# ANCHOR. ROUTINE.md uses the same anchor to tell an off week from a failed draw — change both together.
#
# It draws 10 public books (3 consecutive translated pages each), writes the packet to
# scripts/eval/results/spot-check/<date>/ in a SEPARATE clone (never the auto-pull checkout), commits it to branch
# spot-check-<date> and pushes. Stage 2, a claude.ai routine on the Tuesday, reviews the packets with Opus subagents,
# scores, adds the series row and opens the PR.
#
# Failure is loud: any error comments RED on #5914 and exits non-zero. A branch that already exists for the date
# means the draw already ran — exit 0 without drawing again.
set -euo pipefail

REPO=/root/sourcelibrary                 # auto-pull checkout: code + node_modules + .env, read-only here
WORK=/root/spot-check-work               # our own clone; branches are made here
SLUG=Embassy-of-the-Free-Mind/sourcelibrary-v2
ISSUE=5914
ANCHOR=2026-10-19                        # the first draw Monday
DATE=${SPOT_DATE:-$(date -u +%Y-%m-%d)}
REF=${SPOT_REF:-main}                    # the code the draw runs with; a branch name only for testing before merge
FORCE=${SPOT_FORCE:-0}                   # 1 = draw even in an off week (a hand re-run)
BRANCH=spot-check-$DATE
OUT=scripts/eval/results/spot-check/$DATE
GIT_AUTH=(-c "credential.helper=" -c "credential.helper=!gh auth git-credential")

red() {
  local msg="RED — fortnightly spot-check draw for $DATE failed on Hetzner: $1. Log: /var/log/sourcelibrary/spot-check.log. The review routine will find no branch spot-check-$DATE and must not report. Runbook: scripts/eval/spot-check/ROUTINE.md (#5914)."
  echo "$msg" >&2
  gh issue comment "$ISSUE" --repo "$SLUG" --body "$msg" || true
  exit 1
}
trap 'red "command failed at line $LINENO"' ERR

DAYS=$(( ( $(date -u -d "$DATE" +%s) - $(date -u -d "$ANCHOR" +%s) ) / 86400 ))
if [ "$FORCE" != 1 ] && { [ "$DAYS" -lt 0 ] || [ $(( DAYS % 14 )) -ne 0 ]; }; then
  echo "== $(date -u +%FT%TZ) $DATE is not a draw day ($DAYS days from anchor $ANCHOR) — nothing to do"
  exit 0
fi

echo "== $(date -u +%FT%TZ) spot-check draw $DATE → $BRANCH"

if [ ! -d "$WORK/.git" ]; then
  git "${GIT_AUTH[@]}" clone --filter=blob:none "https://github.com/$SLUG.git" "$WORK"
fi
cd "$WORK"
git "${GIT_AUTH[@]}" fetch --quiet origin "$REF"
if git "${GIT_AUTH[@]}" ls-remote --exit-code --heads origin "$BRANCH" >/dev/null 2>&1; then
  echo "branch $BRANCH already exists on origin — this fortnight is drawn; nothing to do"
  exit 0
fi
git checkout --quiet -B "$BRANCH" "origin/$REF"
ln -sfn "$REPO/node_modules" node_modules
[ ! -e "$OUT" ] || red "$OUT already exists on $REF — refusing to draw over another run"

set -a; . "$REPO/.env.production.local"; set +a
node scripts/eval/spot-check/draw.mjs --date "$DATE" --out "$OUT" --frame public --n 10

# Shape check before publishing: a thin draw or dead images is a failed draw, not a small fortnight.
read -r BOOKS PAGES IMG_OK < <(node -e '
  const l = require(process.argv[1]); console.log(l.n_books, l.n_page_records, l.images.ok);' "$WORK/$OUT/draw-log.json")
[ "$BOOKS" -eq 10 ] || red "only $BOOKS books drawn (expected 10)"
[ "$PAGES" -ge 30 ] || red "only $PAGES page records (expected ≥ 30)"
[ "$IMG_OK" -ge $(( PAGES - 3 )) ] || red "only $IMG_OK of $PAGES page images returned 200"

git add "$OUT"
git -c user.name="Hetzner" -c user.email="ops@sourcelibrary.org" commit --quiet -s \
  -m "eval(spot-check): fortnightly draw $DATE — $BOOKS books, $PAGES pages, images $IMG_OK/$PAGES (#5914)" \
  -m "Stage 1 of 2 (Hetzner). Stage 2, the review routine, runs on the Tuesday and opens the PR."
git "${GIT_AUTH[@]}" push --quiet origin "$BRANCH"
echo "pushed $BRANCH: $BOOKS books, $PAGES pages, images $IMG_OK/$PAGES"
