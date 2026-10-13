#!/bin/bash
# Aliveness atlas (#6652) on the Hetzner box, in /root/aliveness. Every step resumes by page_id; DONE or FAILED
# (holding the step name) tells a watcher finished from dead.
#   1. embedding lane: flash-lite screen of hits-v5-merged.jsonl (paid, ~$5 for 10K)
#   2. lexical lane:   flash-lite screen of hits-lex.jsonl (paid, ~$2 for 4K)
#   3. judge (Gemini CLI, $0) on the lexical screen positives, then the embedding ones.
# The judge model is gemini-3.8-flash-low: on 30 baseline rows it agreed with flash-high on 31/31 layer verdicts at
# ~10x the speed (35 s vs ~6 min); flash-high would have needed >12 h for the embedding lane alone.
cd /root/aliveness || exit 1
export SL_REPO=/root/sourcelibrary ALIVE_OUT=/root/aliveness
ENV=/root/sourcelibrary/.env.production.local
JUDGE_MODEL=${JUDGE_MODEL:-gemini-3.8-flash-low}
rm -f DONE FAILED
node --env-file=$ENV classify-aliveness.mjs > screen.log 2>&1 || { echo screen > FAILED; exit 1; }
CLASSIFY_IN=hits-lex.jsonl CLASSIFY_OUT=classified-lex.jsonl node --env-file=$ENV classify-aliveness.mjs > screen-lex.log 2>&1 || { echo screen-lex > FAILED; exit 1; }
node judge-aliveness.mjs classified-lex.jsonl judged-lex.jsonl --texts hits-lex.jsonl --model $JUDGE_MODEL --conc 15 > judge-lex.log 2>&1 || { echo judge-lex > FAILED; exit 1; }
node judge-aliveness.mjs classified-aliveness.jsonl judged-aliveness.jsonl --texts hits-v5-merged.jsonl --model $JUDGE_MODEL --conc 15 > judge.log 2>&1 || { echo judge > FAILED; exit 1; }
date > DONE
