#!/bin/sh
# Run the fresh prior-translation search over a batch directory (#7598): one lean Sonnet
# `claude -p` per book, P in parallel. Resumable: run it again and finished books are skipped.
#
#   CLAUDE_CONFIG_DIR=~/.claude-team scripts/ft-search/run-batch.sh <dir> [parallel=4]
#
# Detached on the laptop:
#   nohup caffeinate -i scripts/ft-search/run-batch.sh <dir> 4 >/dev/null 2>&1 & disown
# progress.log gets one line per book and BATCHDONE at the end. Touch <dir>/STOP to refuse a start.
HERE=$(cd "$(dirname "$0")" && pwd)
DIR=$1; P=${2:-4}
cd "$DIR" || exit 1
[ -f STOP ] && { echo "STOP file present in $DIR; remove it to run"; exit 1; }
xargs -P "$P" -n1 "$HERE/search-one.sh" < ids.txt
echo BATCHDONE >> progress.log
