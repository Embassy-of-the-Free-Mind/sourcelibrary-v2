#!/usr/bin/env bash
# PRIOR ART: ./chained-draw.sh (commits a draw to a branch for a claude.ai routine — one branch per run). The rolling
# gate needs ONE branch that accumulates windows, so the routine can find "the newest window without a verdict" and
# the Hetzner poller can read the verdicts back. Pushes /root/speedtest-a/gate/<NAME> to branch
# eval/speedtest-a-gate-windows under scripts/eval/results/speedtest-a-gate/<NAME>/. Runbook: GATE.md.
#
#   bash gate-publish.sh w-1001T1015
set -euo pipefail
NAME=${1:?window name}
SRC=/root/speedtest-a/gate/$NAME
REPO=/root/speedtest-a/gate-repo
BRANCH=eval/speedtest-a-gate-windows
SLUG=Embassy-of-the-Free-Mind/sourcelibrary-v2
DEST=scripts/eval/results/speedtest-a-gate/$NAME
GIT_AUTH=(-c "credential.helper=" -c "credential.helper=!gh auth git-credential")
[ -e "$SRC/manifest.jsonl" ] || { echo "publish: $SRC has no manifest — nothing to publish"; exit 1; }
if [ ! -d "$REPO/.git" ]; then
  git "${GIT_AUTH[@]}" clone --quiet --filter=blob:none --no-checkout --branch "$BRANCH" "https://github.com/$SLUG.git" "$REPO"
  git -C "$REPO" sparse-checkout set --no-cone /scripts/eval/results/speedtest-a-gate/ /scripts/eval/translation-corpus-audit/
  git -C "$REPO" checkout --quiet "$BRANCH"
fi
cd "$REPO"
for attempt in 1 2 3; do
  git "${GIT_AUTH[@]}" fetch --quiet origin "$BRANCH"
  git reset --quiet --hard "origin/$BRANCH"
  if [ -e "$DEST/manifest.jsonl" ]; then echo "publish: $DEST already on $BRANCH"; exit 0; fi
  mkdir -p "$DEST"
  cp -r "$SRC"/. "$DEST"/
  git add "$DEST"
  git -c user.name="Hetzner" -c user.email="ops@sourcelibrary.org" commit --quiet -s \
    -m "eval(speedtest-a-gate): window $NAME drawn — $(grep -c '"kind":"main"' "$DEST/manifest.jsonl") main pages (#4681)" \
    -m "Judged by the claude.ai routine at :40 (GATE.md)."
  if git "${GIT_AUTH[@]}" push --quiet origin "HEAD:$BRANCH"; then echo "published $NAME → $BRANCH"; exit 0; fi
  echo "publish: push refused (attempt $attempt) — refetching"
  sleep 5
done
echo "publish: FAILED to push $NAME"; exit 1
