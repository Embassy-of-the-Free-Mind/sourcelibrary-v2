#!/usr/bin/env bash
# PRIOR ART: .github/workflows/doc-staleness.yml and prompt-defaults-watch.yml each
# inline their own "find the open issue, else create" lookup. This is that
# pattern as one helper, so the weekly detectors stop filing a new issue per run.
#
# Usage: file-or-update-issue.sh "<title prefix>" "<full dated title>" <body-file> [label]
#        file-or-update-issue.sh --close "<title prefix>" "<comment>"
#
# Recurring detectors re-measure the whole set each run, so a new dated issue
# per run only buries the thread where someone is working the finding
# (the 2026-09-25 triage closed five such duplicates). If an open issue's title
# starts with the prefix, the new report goes on it as a comment and the title
# takes the new date. Otherwise a new issue is created.
#
# --close is the other half: call it from the detector's clean-run branch, and
# every open issue whose title starts with the prefix is closed with the
# comment. A detector closes what it files (#7277: five detectors filed through
# this helper and none closed, so a fixed finding stayed open until a triage).
set -euo pipefail

open_issues() {
  gh issue list --state open --limit 100 --search "\"$1\" in:title" \
    --json number,title \
    --jq "[.[] | select(.title | startswith(\"$1\"))] | sort_by(.number) | .[].number"
}

if [ "${1:-}" = "--close" ]; then
  PREFIX="$2"; COMMENT="$3"
  for N in $(open_issues "$PREFIX"); do
    gh issue close "$N" --reason completed --comment "$COMMENT"
    echo "Closed #$N"
  done
  exit 0
fi

PREFIX="$1"; TITLE="$2"; BODY_FILE="$3"; LABEL="${4:-}"

EXISTING=$(open_issues "$PREFIX" | tail -1)

if [ -n "$EXISTING" ]; then
  gh issue comment "$EXISTING" --body-file "$BODY_FILE"
  gh issue edit "$EXISTING" --title "$TITLE"
  echo "Updated open issue #$EXISTING"
elif [ -n "$LABEL" ]; then
  gh issue create --title "$TITLE" --body-file "$BODY_FILE" --label "$LABEL"
else
  gh issue create --title "$TITLE" --body-file "$BODY_FILE"
fi
