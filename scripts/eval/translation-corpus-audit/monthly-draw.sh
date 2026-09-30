#!/usr/bin/env bash
# PRIOR ART: scripts/eval/ft-census-daily.sh (a Hetzner cron wrapper around an eval script; it writes to Mongo,
# not a branch). This is stage 1 of 2 of the MONTHLY translation corpus audit (#5301, runbook MONTHLY.md):
# the DRAW, which needs Mongo and so runs on Hetzner. No model call, no spend.
#
#   crontab (Hetzner):  30 4 1 * *  bash /root/sourcelibrary/scripts/eval/translation-corpus-audit/monthly-draw.sh
#
# It draws ~100 books (one interior page each) + 45 blinded controls with a fresh seed (the run date), builds the
# 15-item packets, commits the run dir to branch eval/tca-<YYYY-MM> in a SEPARATE clone (never the auto-pull
# checkout) and pushes it. Stage 2 — the judge — is a claude.ai scheduled routine that fires on the 2nd, reads that
# branch, judges the packets with Opus subagents, scores, and opens the PR.
#
# Failure is loud: any error comments RED on #5274 and exits non-zero. A branch that already exists for the month
# means the draw already ran — exit 0 without drawing again (a re-draw would change the sample mid-month).
set -euo pipefail

REPO=/root/sourcelibrary                 # auto-pull checkout: code + node_modules + .env, read-only here
WORK=/root/tca-work                      # our own clone; branches are made here
SLUG=Embassy-of-the-Free-Mind/sourcelibrary-v2
ISSUE=5274
DATE=${TCA_DATE:-$(date -u +%Y-%m-%d)}
REF=${TCA_REF:-main}                     # the code the draw runs with; a branch name only for testing before merge
MONTH=${DATE:0:7}
SEED=${DATE//-/}
NAME=translation-corpus-audit-monthly-$MONTH   # never the bare date: the 2026-09-30 one-off already owns that name
BRANCH=eval/tca-$MONTH
OUT=scripts/eval/results/$NAME
GIT_AUTH=(-c "credential.helper=" -c "credential.helper=!gh auth git-credential")

red() {
  local msg="RED — monthly translation corpus audit draw for $MONTH failed on Hetzner: $1. Log: /var/log/sourcelibrary/tca-monthly.log. Stage 2 (the judge routine on the 2nd) will find no branch and must not report. Runbook: scripts/eval/translation-corpus-audit/MONTHLY.md (#5301)."
  echo "$msg" >&2
  gh issue comment "$ISSUE" --repo "$SLUG" --body "$msg" || true
  exit 1
}
trap 'red "command failed at line $LINENO"' ERR

echo "== $(date -u +%FT%TZ) monthly draw $NAME (seed $SEED) → $BRANCH"

if [ ! -d "$WORK/.git" ]; then
  git "${GIT_AUTH[@]}" clone --filter=blob:none "https://github.com/$SLUG.git" "$WORK"
fi
cd "$WORK"
git "${GIT_AUTH[@]}" fetch --quiet origin "$REF"
if git "${GIT_AUTH[@]}" ls-remote --exit-code --heads origin "$BRANCH" >/dev/null 2>&1; then
  echo "branch $BRANCH already exists on origin — this month is drawn; nothing to do"
  exit 0
fi
git checkout --quiet -B "$BRANCH" "origin/$REF"
ln -sfn "$REPO/node_modules" node_modules
[ ! -e "$OUT" ] || red "$OUT already exists on $REF — refusing to draw over another run"

set -a; . "$REPO/.env.production.local"; set +a
node scripts/eval/translation-corpus-audit/draw.mjs --out "$OUT" --seed "$SEED" --scale 0.32 --arm-quota off --extra-per-lang 4
node scripts/eval/translation-corpus-audit/build-packets.mjs --dir "$OUT" --seed "$SEED"

# Shape check before publishing: a draw that came back thin is a failed draw, not a small month.
MAIN=$(grep -c '"kind":"main"' "$OUT/manifest.jsonl" || true)
CTRL=$(grep -c -E '"kind":"(swap|drop|repeat)"' "$OUT/manifest.jsonl" || true)
[ "$MAIN" -ge 80 ] || red "only $MAIN main items drawn (expected ~100)"
[ "$CTRL" -ge 40 ] || red "only $CTRL controls drawn (expected 45)"

git add "$OUT"
git -c user.name="Hetzner" -c user.email="ops@sourcelibrary.org" commit --quiet -s \
  -m "eval(translation-corpus-audit): monthly draw $DATE — $MAIN pages + $CTRL controls, seed $SEED (#5301)" \
  -m "Stage 1 of 2 (Hetzner). Stage 2, the judge routine, runs on the 2nd and opens the PR. Refs #$ISSUE."
git "${GIT_AUTH[@]}" push --quiet origin "$BRANCH"
echo "pushed $BRANCH: $MAIN main + $CTRL controls"
