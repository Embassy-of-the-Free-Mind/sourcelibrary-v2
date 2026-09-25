#!/usr/bin/env bash
# PRIOR ART: .github/workflows/doc-staleness.yml and prompt-defaults-watch.yml each
# inline their own "find the open issue, else create" lookup. This is that
# pattern as one helper, so the weekly detectors stop filing a new issue per run.
#
# Usage: file-or-update-issue.sh "<title prefix>" "<full dated title>" <body-file> [label]
#
# Recurring detectors re-measure the whole set each run, so a new dated issue
# per run only buries the thread where someone is working the finding
# (the 2026-09-25 triage closed five such duplicates). If an open issue's title
# starts with the prefix, the new report goes on it as a comment and the title
# takes the new date. Otherwise a new issue is created.
set -euo pipefail
PREFIX="$1"; TITLE="$2"; BODY_FILE="$3"; LABEL="${4:-}"

EXISTING=$(gh issue list --state open --limit 100 --search "\"$PREFIX\" in:title" \
  --json number,title \
  --jq "[.[] | select(.title | startswith(\"$PREFIX\"))] | sort_by(.number) | last | .number // empty")

if [ -n "$EXISTING" ]; then
  gh issue comment "$EXISTING" --body-file "$BODY_FILE"
  gh issue edit "$EXISTING" --title "$TITLE"
  echo "Updated open issue #$EXISTING"
elif [ -n "$LABEL" ]; then
  gh issue create --title "$TITLE" --body-file "$BODY_FILE" --label "$LABEL"
else
  gh issue create --title "$TITLE" --body-file "$BODY_FILE"
fi
