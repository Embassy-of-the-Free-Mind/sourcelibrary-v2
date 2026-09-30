#!/usr/bin/env bash
# SessionStart hook: say which of YOUR open PRs conflict with main, so a PR that
# went CONFLICTING overnight is rebased by its opener, not closed by a sweep.
# Sibling of ~/.claude/hooks/dead-jobs-warn.py ("[bg-jobs] N died"). The label is
# applied by .github/workflows/pr-needs-rebase.yml (#5415). One `gh` call; prints
# nothing and never fails the start if gh is missing, unauthenticated, or offline.
command -v gh >/dev/null 2>&1 || exit 0
cd "$(dirname "$0")/../.." 2>/dev/null || exit 0
out=$(gh pr list --author @me --label needs-rebase --state open --limit 50 --json number 2>/dev/null) || exit 0
nums=$(printf '%s' "$out" | python3 -c 'import json,sys; print(" ".join("#%d"%p["number"] for p in json.load(sys.stdin)))' 2>/dev/null) || exit 0
[ -n "$nums" ] || exit 0
count=$(printf '%s\n' "$nums" | wc -w | tr -d ' ')
echo "[prs] $count of your open PRs need a rebase: $nums — main moved under them; \`gh pr view <n> --comments\` names the overlapping files. A PR that conflicts on the day it is opened is the opener's job, not a sweep's (#5415)."
exit 0
