#!/usr/bin/env bash
# public-mirror.sh — publish the code of the private working repo (sourcelibrary-v3) to the public
# repo (sourcelibrary-v2), one commit per run, weekly from the Hetzner crontab.
#
# Why: work moved to a private repo on 2026-11-12, but the code is AGPL and outside contributors'
# commits are in it, so the source of what runs on sourcelibrary.org stays public. What stays
# private is the working layer: branches, PRs, issues, agent doctrine and handoffs, and evaluation
# data (#7822: numbers in public, page text out).
#
# The public tree is v3's main minus EXCLUDES. Anything the app imports must NOT be excluded, or the
# public copy stops being the source of the running site: the script refuses to publish if a file
# under src/ imports an excluded path.
#
# PRIOR ART: scripts/maintenance/export-mirror.mjs — a Parquet mirror of Mongo `books`, not of code.
# none other — looked in scripts/maintenance, scripts/workers, infrastructure/ for mirror/publish/sync.
#
# Usage: public-mirror.sh [--dry-run]
set -euo pipefail

PRIVATE=https://github.com/Embassy-of-the-Free-Mind/sourcelibrary-v3.git
PUBLIC=https://github.com/Embassy-of-the-Free-Mind/sourcelibrary-v2.git
WORK=${PUBLIC_MIRROR_DIR:-/mnt/HC_Volume_105839809/public-mirror}
DRY=0; [ "${1:-}" = --dry-run ] && DRY=1

EXCLUDES=(
  .claude/            # agent doctrine, skills, hooks, handoffs
  memory/             # team memory notes
  CLAUDE.md AGENTS.md
  scripts/eval/results/   # raw model output, carries page text (#7822)
  scripts/eval/dataset/   # evaluation sets, a product of their own (#7822)
  logs/ ocr-output/ ocr-submission.log .tsc.log
)

log() { echo "[public-mirror] $*"; }

sync_clone() {  # $1 url, $2 dir: a shallow clone of main at origin's tip
  if [ -d "$2/.git" ]; then git -C "$2" fetch -q --depth 1 origin main && git -C "$2" reset -q --hard FETCH_HEAD
  else git clone -q --depth 1 --branch main "$1" "$2"; fi
}

mkdir -p "$WORK"
sync_clone "$PRIVATE" "$WORK/private"
sync_clone "$PUBLIC" "$WORK/public"
sha=$(git -C "$WORK/private" rev-parse HEAD)

# Guard: the app must not import anything this mirror withholds.
for ex in "${EXCLUDES[@]}"; do
  case "$ex" in */) ;; *) continue ;; esac
  if git -C "$WORK/private" grep -qE "['\"](\.\./)+${ex%/}/" -- src; then
    log "REFUSED: src/ imports from excluded ${ex} — the public copy would not build. Narrow EXCLUDES."
    exit 2
  fi
done

# Copy everything but .git, then remove the withheld paths from the public copy (they were public
# before the move). No --delete-excluded: older rsyncs delete the public .git with it.
rsync -a --delete --exclude=/.git "$WORK/private/" "$WORK/public/"
for ex in "${EXCLUDES[@]}"; do rm -rf "${WORK:?}/public/${ex%/}"; done

# Remove box addresses and personal logins from the public copy, and refuse to publish a live secret.
python3 -I "$(dirname "$(readlink -f "$0")")/mirror-scrub.py" "$WORK/public" "$WORK/private/scripts/workers/box.sh" \
  "${MIRROR_ENV_FILE:-/root/sourcelibrary/.env.production.local}" || { log "REFUSED: mirror-scrub failed, nothing published"; exit 3; }

cd "$WORK/public"
git add -A
if git diff --cached --quiet; then log "nothing changed since the last mirror (v3@${sha:0:9})"; exit 0; fi
n=$(git diff --cached --name-only | wc -l | tr -d ' ')
if [ "$DRY" = 1 ]; then log "dry run: would publish $n changed file(s) from v3@${sha:0:9}"; git reset -q; exit 0; fi
git -c user.name="J. Derek Lomas" -c user.email="j.d.lomas@tudelft.nl" commit -q -s \
  -m "mirror: sourcelibrary-v3@${sha:0:9}" \
  -m "Weekly public copy of the code that runs sourcelibrary.org (AGPL-3.0). Work happens in a private repo; this tree is its main branch minus agent doctrine, handoffs and evaluation data."
git push -q origin HEAD:main
log "published $n changed file(s) from v3@${sha:0:9} as $(git rev-parse --short HEAD)"
