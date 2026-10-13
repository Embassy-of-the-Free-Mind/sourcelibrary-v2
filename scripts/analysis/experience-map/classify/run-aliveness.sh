#!/bin/bash
# Aliveness atlas (#6652) on the Hetzner box: the flash-lite screen (paid, ~$5 for 10K passages) then the Gemini CLI
# judge ($0) over the screen's positives. Both steps resume by page_id. Writes DONE or FAILED (with the step) so a
# watcher can tell finished from dead. Inputs in /root/aliveness: hits-v5-merged.jsonl, classify-aliveness.mjs,
# judge-aliveness.mjs.
cd /root/aliveness || exit 1
export SL_REPO=/root/sourcelibrary ALIVE_OUT=/root/aliveness
rm -f DONE FAILED
node --env-file=/root/sourcelibrary/.env.production.local classify-aliveness.mjs > screen.log 2>&1 || { echo screen > FAILED; exit 1; }
node judge-aliveness.mjs classified-aliveness.jsonl judged-aliveness.jsonl --texts hits-v5-merged.jsonl --conc 14 > judge.log 2>&1 || { echo judge > FAILED; exit 1; }
date > DONE
