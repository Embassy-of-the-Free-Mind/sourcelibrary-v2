#!/bin/bash
# Aliveness atlas (#6652): finish the CLI judge across quota windows. The judge stops itself on a quota error; this
# loop retries every 30 minutes until (1) the lexical lane is fully judged and (2) 1,200 embedding-lane positives are
# (a random sample: classified-aliveness.jsonl is in shuffled order), then writes JUDGE-DONE. Run under setsid nohup.
cd /root/aliveness || exit 1
export SL_REPO=/root/sourcelibrary
M=gemini-3.8-flash-low
pos() { python3 -c "import json,sys; print(sum(1 for l in open(sys.argv[1]) if (lambda r: r['felt'] or r['world'] or r['made'])(json.loads(l))))" "$1"; }
LEX_TOTAL=$(pos classified-lex.jsonl)
while true; do
  node judge-aliveness.mjs classified-lex.jsonl judged-lex.jsonl --texts hits-lex.jsonl --model $M --conc 15 >> judge-lex.log 2>&1
  if [ "$(wc -l < judged-lex.jsonl)" -ge "$LEX_TOTAL" ]; then
    LEFT=$(( 1200 - $(wc -l < judged-aliveness.jsonl) ))
    [ "$LEFT" -le 0 ] && { date > JUDGE-DONE; exit 0; }
    node judge-aliveness.mjs classified-aliveness.jsonl judged-aliveness.jsonl --texts hits-v5-merged.jsonl --model $M --conc 15 --max $LEFT >> judge.log 2>&1
    [ "$(wc -l < judged-aliveness.jsonl)" -ge 1200 ] && { date > JUDGE-DONE; exit 0; }
  fi
  sleep 1800
done
