#!/bin/bash
# PRIOR ART: scripts/eval/xlref-t1 — reused. Its judges (and #5695 T4's) were dispatched by an uncommitted bin/dispatch.sh on the job box: one `claude -p --model opus` session per packet chunk, N at a time, resumable from the verdict files. This is that script with the paths made arguments.
# Run the translation-vs-reference judge chunks of one packet as separate Opus sessions on the subscription.
# usage: dispatch.sh <packet_dir> <gate|main|all> [concurrency] ; writes <packet_dir>/dispatch-<section>.done when every chunk has been tried
P=$1; SEC=$2; N=${3:-6}
REPO=$(git rev-parse --show-toplevel); export REPO
cd "$P" || exit 1
mkdir -p logs; rm -f "dispatch-$SEC.done"
grep -E '^- \[j[0-9]\]' DISPATCH.md | sed 's/^- \[\(j[0-9]\)\] //' | while read -r line; do
  in=$(echo "$line" | sed -n 's/.*INPUT_FILE=\([^ ]*\).*/\1/p'); out=$(echo "$line" | sed -n 's/.*OUTPUT_FILE=\([^ ]*\).*/\1/p')
  base=$(basename "$in"); [[ "$SEC" != all && "$base" != $SEC-* ]] && continue
  echo "$in|$out|$line"
done > "queue-$SEC.txt"
run_one() {
  IFS='|' read -r in out line <<< "$1"
  want=$(wc -l < "$in"); have=0; [ -f "$out" ] && have=$(wc -l < "$out")
  [ "$have" -ge "$want" ] && exit 0
  rm -f "$out"; tag=$(echo "$out" | awk -F/ '{print $(NF-1)"-"$NF}')
  systemd-run --quiet --scope --slice=sourcelibrary.slice -- /root/.local/bin/claude -p "$line" --model opus --permission-mode acceptEdits --add-dir "$REPO" --add-dir "$(dirname "$(pwd)")" > "logs/$tag.log" 2>&1
}
export -f run_one
xargs -a "queue-$SEC.txt" -d '\n' -P "$N" -I{} bash -c 'run_one "$@"' _ {}
echo ALLDONE > "dispatch-$SEC.done"
