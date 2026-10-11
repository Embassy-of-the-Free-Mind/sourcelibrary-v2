#!/usr/bin/env bash
# PRIOR ART: scripts/workers/claude-job.sh — the wrapper writes the inbox (`note`) and exports JOB_INBOX; nothing
# delivered it to a running `claude -p`, whose prompt is fixed at start (#6534). This is the delivery half.
#
# PostToolUse hook for headless jobs on the job boxes. When the job's inbox has lines this job has not been
# shown yet, it hands them to the model as additionalContext and remembers how many it has shown.
# Outside a job (JOB_INBOX unset) or with nothing new it prints nothing and exits 0, so it costs one test(1).
#
# Install on a box: add to /root/.claude/settings.json
#   "hooks": {"PostToolUse": [{"matcher": "", "hooks": [{"type": "command", "command": "/root/bin/job-inbox-hook.sh"}]}]}
# and copy this file to /root/bin (install-claude-job.sh does the copy).

[ -n "${JOB_INBOX:-}" ] && [ -s "$JOB_INBOX" ] || exit 0
seen_file="$JOB_INBOX.seen"
total=$(wc -l < "$JOB_INBOX" | tr -d ' ')
seen=$(cat "$seen_file" 2>/dev/null || echo 0)
[ "$total" -gt "$seen" ] 2>/dev/null || exit 0
new=$(tail -n +"$((seen + 1))" "$JOB_INBOX")
echo "$total" > "$seen_file"
python3 - "$new" <<'PY'
import json, sys
msg = ("NEW NOTE(S) FROM DEREK'S SESSION for this job (claude-job.sh inbox, #6534). "
       "A note overrides your brief where they conflict; act on it now and say in your next "
       "issue/PR comment which notes you acted on.\n" + sys.argv[1])
print(json.dumps({"hookSpecificOutput": {"hookEventName": "PostToolUse", "additionalContext": msg}}))
PY
exit 0
