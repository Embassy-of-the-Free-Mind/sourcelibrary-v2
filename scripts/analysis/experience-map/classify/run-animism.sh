#!/bin/bash
# Animism layer of the aliveness atlas (#6652) on the Hetzner box, in /root/aliveness. Every step resumes by page_id;
# ANIM-DONE or ANIM-FAILED (holding the step name) tells a watcher finished from dead.
#   1. flash-lite screen of the phrase draw (hits-lex-animism.jsonl, ~3.5K pages, paid ~$1.75)
#   2. flash-lite screen of the 745-page random baseline (paid ~$0.36) — the base rate
#   3. judge (Gemini CLI, $0) on both sets of screen positives; on a quota stop, wait 30 min and resume
cd /root/aliveness || exit 1
export SL_REPO=/root/sourcelibrary ALIVE_OUT=/root/aliveness
ENV=/root/sourcelibrary/.env.production.local
JUDGE_MODEL=${JUDGE_MODEL:-gemini-3.8-flash-low}
rm -f ANIM-DONE ANIM-FAILED
node --env-file=$ENV classify-animism.mjs > screen-animism.log 2>&1 || { echo screen > ANIM-FAILED; exit 1; }
CLASSIFY_IN=baseline-input.jsonl CLASSIFY_OUT=baseline-animism.jsonl node --env-file=$ENV classify-animism.mjs > screen-animism-baseline.log 2>&1 || { echo screen-baseline > ANIM-FAILED; exit 1; }
judge() { # in out texts log
  for try in $(seq 1 12); do
    node judge-animism.mjs "$1" "$2" --texts "$3" --model $JUDGE_MODEL --conc 15 >> "$4" 2>&1 || return 1
    grep -q 'stopped on quota' <(tail -1 "$4") || return 0
    sleep 1800
  done
}
judge baseline-animism.jsonl baseline-animism-judged.jsonl baseline-input.jsonl judge-animism-baseline.log || { echo judge-baseline > ANIM-FAILED; exit 1; }
judge classified-animism.jsonl judged-animism.jsonl hits-lex-animism.jsonl judge-animism.log || { echo judge > ANIM-FAILED; exit 1; }
date > ANIM-DONE
