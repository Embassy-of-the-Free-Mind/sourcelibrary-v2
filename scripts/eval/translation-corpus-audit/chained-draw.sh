#!/usr/bin/env bash
# PRIOR ART: ./monthly-draw.sh (stage 1 of the MONTHLY corpus audit: draw on Hetzner, push a branch, a claude.ai
# routine judges). Same two-stage shape, different frame: this draws from pages the CHAINED Batch lane wrote
# (draw-chained.mjs, #4681) instead of the whole corpus, and is run on demand, not by cron. Runbook: CHAINED.md.
#
#   on Hetzner:  TCA_REF=<branch-or-main> bash chained-draw.sh          (DATE defaults to today, UTC)
#
# Why Hetzner + a routine and not a laptop session: the first attempt (bg session a94680f7, 2026-09-30) died
# when the laptop slept, mid-draw, and nothing noticed for a day. The draw needs Mongo, so it runs on the box;
# the judge needs a Claude subscription, so it runs as a claude.ai routine; neither depends on a laptop being awake.
set -euo pipefail

REPO=/root/sourcelibrary                 # auto-pull checkout: code + node_modules + .env, read-only here
WORK=/root/tca-work                      # our own clone; branches are made here
SLUG=Embassy-of-the-Free-Mind/sourcelibrary-v2
ISSUE=4681
DATE=${TCA_DATE:-$(date -u +%Y-%m-%d)}
REF=${TCA_REF:-main}                     # the code the draw runs with; a branch name before the scripts are merged
SEED=${DATE//-/}
BOOKS=${TCA_BOOKS:-60}
SEAMS=${TCA_SEAMS:-15}
NAME=translation-corpus-audit-chained-$DATE
BRANCH=eval/tca-chained-$DATE
OUT=scripts/eval/results/$NAME
GIT_AUTH=(-c "credential.helper=" -c "credential.helper=!gh auth git-credential")

red() {
  local msg="RED — chained-lane quality sample draw for $DATE failed on Hetzner: $1. Log: /var/log/sourcelibrary/tca-chained.log. Stage 2 (the judge routine) will find no branch and must not report. Runbook: scripts/eval/translation-corpus-audit/CHAINED.md (#4681)."
  echo "$msg" >&2
  gh issue comment "$ISSUE" --repo "$SLUG" --body "$msg" || true
  exit 1
}
trap 'red "command failed at line $LINENO"' ERR

echo "== $(date -u +%FT%TZ) chained draw $NAME (seed $SEED, ref $REF) → $BRANCH"

if [ ! -d "$WORK/.git" ]; then
  git "${GIT_AUTH[@]}" clone --filter=blob:none "https://github.com/$SLUG.git" "$WORK"
fi
cd "$WORK"
git "${GIT_AUTH[@]}" fetch --quiet origin "$REF"
if git "${GIT_AUTH[@]}" ls-remote --exit-code --heads origin "$BRANCH" >/dev/null 2>&1; then
  echo "branch $BRANCH already exists on origin — this draw already ran; nothing to do"
  exit 0
fi
git checkout --quiet -B "$BRANCH" "origin/$REF"
ln -sfn "$REPO/node_modules" node_modules
[ ! -e "$OUT" ] || red "$OUT already exists on $REF — refusing to draw over another run"

set -a; . "$REPO/.env.production.local"; set +a
node scripts/eval/translation-corpus-audit/draw-chained.mjs --out "$OUT" --seed "$SEED" --books "$BOOKS" --seams "$SEAMS"
node scripts/eval/translation-corpus-audit/build-packets.mjs --dir "$OUT" --seed "$SEED"

MAIN=$(grep -c '"kind":"main"' "$OUT/manifest.jsonl" || true)
CTRL=$(grep -c -E '"kind":"(swap|drop|repeat)"' "$OUT/manifest.jsonl" || true)
[ "$MAIN" -ge 30 ] || red "only $MAIN main items drawn (expected ~$((BOOKS + SEAMS)))"
[ "$CTRL" -ge 30 ] || red "only $CTRL controls drawn (expected 45; the gate needs ≥ 10 of each kind)"

git add "$OUT"
git -c user.name="Hetzner" -c user.email="ops@sourcelibrary.org" commit --quiet -s \
  -m "eval(translation-corpus-audit): chained-lane draw $DATE — $MAIN pages + $CTRL controls, seed $SEED (#4681)" \
  -m "Stage 1 of 2 (Hetzner). Stage 2, the judge routine, reads this branch and opens the PR. Refs #$ISSUE."
git "${GIT_AUTH[@]}" push --quiet origin "$BRANCH"
echo "pushed $BRANCH: $MAIN main + $CTRL controls"
