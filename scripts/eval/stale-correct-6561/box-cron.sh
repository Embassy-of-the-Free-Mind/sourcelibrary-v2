#!/usr/bin/env bash
# PRIOR ART: scripts/eval/paddle-correct-6561/batch/cron.sh (the table run's restart / 6-hourly report / upload cron on
# cloudlayer). It does not fit as is: one box, hard-coded paths, and it hands over to a review job. Here the same loop
# runs on each of three boxes for its shard of the stale pages and stops at the upload; the review is job b's.
#
# #6561 item 1, hourly on each box that runs a shard of the Opus correct over the stale pages:
#   - runner not finished: restart it if it died (at most 8 times); a progress comment on #6561 every 6 h.
#   - runner finished (runner.done): upload the corrections to the staging collection stale_corrections_6561 (nothing
#     else reads it; `pages` is not written), comment, remove this cron line.
# Settings (all required, set on the cron line): SC_BOX (main|cloudlayer|l7a), SC_DIR (the shard's scratch dir, holding
# pages.jsonl + prompt.json), SC_CODE (a checkout of the PR branch), SC_ENV (the .env.production.local), SC_ACCOUNT
# (the subscription account, for provenance), SC_CLAUDE_BIN (the current claude CLI; see run.mjs).
# DRY=1 prints what it would do and changes nothing.
#   25 * * * * SC_BOX=… SC_DIR=… SC_CODE=… SC_ENV=… SC_ACCOUNT='…' SC_CLAUDE_BIN=… <SC_CODE>/scripts/eval/stale-correct-6561/box-cron.sh >> <SC_DIR>/cron.log 2>&1  # stale-correct-6561-<box>
set -u
export PATH=/root/bin:/root/.local/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
export HOME=${HOME:-/root}
: "${SC_BOX:?}" "${SC_DIR:?}" "${SC_CODE:?}" "${SC_ENV:?}" "${SC_ACCOUNT:?}" "${SC_CLAUDE_BIN:?}"
B=$SC_CODE/scripts/eval/paddle-correct-6561/batch
REPO=Embassy-of-the-Free-Mind/sourcelibrary-v2; ISSUE=6561; TAG="stale-correct-6561-$SC_BOX"; RUN=opus-correct-6561-stale
COLL=stale_corrections_6561
DRY=${DRY:-0}
cd "$SC_DIR" || exit 1
exec 9> "$SC_DIR/cron.lock"; flock -n 9 || exit 0
say() { echo "$(date -u +%FT%TZ) $*"; }
comment() { if [ "$DRY" = 1 ]; then say "DRY comment:"; echo "$1"; else gh issue comment "$ISSUE" -R "$REPO" --body "$1" >/dev/null && say "commented"; fi; }
unschedule() { if [ "$DRY" = 1 ]; then say "DRY would remove the cron line"; else crontab -l | grep -v "# $TAG\$" | crontab - && say "cron line removed"; fi; }
# this shard's runner: its cwd is SC_DIR
alive() { local p; for p in $(pgrep -f '[b]atch/run\.mjs'); do [ "$(readlink /proc/$p/cwd)" = "$SC_DIR" ] && return 0; done; return 1; }
start() {
  local cap=""; command -v systemd-run >/dev/null && systemctl list-units --type=slice 2>/dev/null | grep -q sourcelibrary.slice && cap="systemd-run --quiet --scope --slice=sourcelibrary.slice --"
  CLAUDE_BIN=$SC_CLAUDE_BIN setsid nohup $cap node "$B/run.mjs" --par=2 --run=$RUN >> run.log 2>&1 < /dev/null &
}
[ "${1:-}" = start ] && { alive && { say "already running"; exit 0; }; [ "$DRY" = 1 ] && { say "DRY would start"; exit 0; }; start; say "started"; exit 0; }

if [ ! -f runner.done ]; then
  if ! alive && [ ! -f runner.stop ]; then
    n=$(cat restarts 2>/dev/null || echo 0)
    if [ "$n" -ge 8 ]; then
      comment "**Opus-correct of the stale pages stopped on $SC_BOX and did not finish (job stale-correct-6561).** The runner died $n times. Nothing from this shard was uploaded.
$(node "$B/status.mjs" "$SC_DIR")
Log: \`$SC_DIR/run.log\` on $SC_BOX. Restart: \`rm $SC_DIR/restarts\` and run this cron line by hand with the argument \`start\`."
      unschedule; exit 0
    fi
    say "runner not alive, restart $((n + 1))"
    [ "$DRY" = 1 ] || { echo $((n + 1)) > restarts; start; }
  fi
  last=$(stat -c %Y last-comment 2>/dev/null || echo 0)
  if [ $(( $(date +%s) - last )) -ge 21300 ]; then
    comment "**Opus-correct of the stale pages, shard $SC_BOX (job stale-correct-6561; files only, nothing written to \`pages\`).**
$(node "$B/status.mjs" "$SC_DIR")"
    [ "$DRY" = 1 ] || touch last-comment
  fi
  exit 0
fi

# The runner finished: stage the corrections.
if [ ! -f upload.done ]; then
  args=(--coll=$COLL "--account=$SC_ACCOUNT ($SC_BOX)" "--draft=current ocr.data: the paddle-zh-2026-10 reading (stale English, old-vs-new CER >= 0.1)")
  if [ "$DRY" = 1 ]; then node --env-file="$SC_ENV" "$B/upload.mjs" "${args[@]}"; exit 0; fi
  node --env-file="$SC_ENV" "$B/upload.mjs" --apply "${args[@]}" || { say "upload failed"; n=$(cat upload-fails 2>/dev/null || echo 0); echo $((n + 1)) > upload-fails
    [ "$n" -eq 2 ] && comment "**Upload of the stale-page Opus corrections failed three times on $SC_BOX (job stale-correct-6561).** The corrections are safe in \`$SC_DIR/out.jsonl\`. Log: \`$SC_DIR/cron.log\`."
    exit 1; }
fi
comment "**Opus-correct of the stale pages finished on $SC_BOX; its corrections are staged, nothing is served.** (job stale-correct-6561)
$(node "$B/status.mjs" "$SC_DIR")
- Staged: Mongo \`$COLL\` ($(cat upload.done)). No cron or worker reads that collection; \`pages\` was not written.
- Serving waits for the pilot gate and the review (job stale-correct-6561-b on main).
- This shard's cron has removed itself."
unschedule
