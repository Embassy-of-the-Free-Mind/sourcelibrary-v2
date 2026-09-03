#!/usr/bin/env bash
# Controls for prior-art-guard.mjs.
#
# The gate is UNCONDITIONAL inside watched roots: a new file must declare its
# prior art. So the tests assert the BOUNDARIES — which roots are watched, what
# counts as a declaration, and that every failure mode fails open. A guard that
# wedges file creation on a malformed payload is worse than no guard.
#
#   bash .claude/hooks/test-prior-art-guard.sh
HOOK="$(cd "$(dirname "$0")" && pwd)/prior-art-guard.mjs"
PASS=0; FAIL=0

check() { # name expected_exit json
  local name="$1" want="$2" json="$3"
  printf '%s' "$json" | node "$HOOK" >/dev/null 2>/tmp/pag-err.txt
  local got=$?
  if [ "$got" = "$want" ]; then PASS=$((PASS+1)); printf '  ok    %s\n' "$name"
  else FAIL=$((FAIL+1)); printf '  FAIL  %s (want exit %s, got %s)\n' "$name" "$want" "$got"; sed 's/^/          /' /tmp/pag-err.txt | head -6; fi
}

payload() { python3 -c '
import json,sys
print(json.dumps({"tool_name":"Write","tool_input":{"file_path":sys.argv[1],"content":sys.argv[2]}}))' "$1" "$2"; }

R=/Users/dereklomas/sourcelibrary

echo "MUST BLOCK (exit 2) — new file in a watched root, no declaration:"
check "eval harness"        2 "$(payload $R/scripts/eval/prompt-ab.mjs 'Paired A/B for OCR prompt versions.')"
check "eval lib"            2 "$(payload $R/scripts/eval/lib/paired-stats.mjs 'Sign test, Wilcoxon, bootstrap CI.')"
check "maintenance sweep"   2 "$(payload $R/scripts/maintenance/reconcile-stripe-invoices.mjs 'Reconcile Stripe invoices against pledges.')"
check "src/lib module"      2 "$(payload $R/src/lib/quote-shortener.ts 'Shorten a quote for display.')"
check "new invariant doc"   2 "$(payload $R/.claude/docs/some-new-invariant.md 'Read this when touching X.')"

echo "MUST ALLOW (exit 0):"
check "declared prior art"          0 "$(payload $R/scripts/eval/prompt-ab.mjs 'PRIOR ART: scripts/eval/prompt-ablation.mjs — scores against pinned ground truth; this is reference-free.')"
check "declared none"               0 "$(payload $R/scripts/eval/prompt-ab.mjs 'PRIOR ART: none — checked ls scripts/eval and git grep.')"
check "hyphenated spelling"         0 "$(payload $R/scripts/eval/prompt-ab.mjs 'PRIOR-ART: none — checked.')"
check "import script (not watched)" 0 "$(payload $R/scripts/import/harvard-batch-7.mjs 'Import batch 7.')"
check "app route (not watched)"     0 "$(payload $R/src/app/explore/page.tsx 'Explore page.')"
check "scratch file exempt"         0 "$(payload $R/scripts/eval/_tmp-probe.mjs 'quick probe')"
check "existing file is an edit"    0 "$(payload $R/scripts/eval/prompt-ablation.mjs 'anything')"
check "non-Write tool ignored"      0 '{"tool_name":"Edit","tool_input":{"file_path":"/Users/dereklomas/sourcelibrary/scripts/eval/x.mjs","content":"y"}}'
check "malformed payload"           0 'not json at all'
check "empty payload"               0 ''
check "path outside repo"           0 "$(payload /tmp/scratch/thing.mjs 'x')"

echo
echo "passed $PASS, failed $FAIL"
[ "$FAIL" = 0 ]
