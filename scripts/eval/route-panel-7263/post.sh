#!/usr/bin/env bash
# PRIOR ART: batch.sh (the same stages' argv, under the stop rule). What is left of a cell after the stop rule ended:
# the noise floor (repeat reads, judged; 30 same texts judged again), controls, Latin's stored text, the second reader.
# usage: post.sh <cell>. Resumes: every stage skips what its files already hold.
set -uo pipefail
C=$1; H=$(cd "$(dirname "$0")" && pwd); O=${JOB_SCRATCH}/panel
N="node --env-file=/root/sourcelibrary/.env.production.local"
R=$(node -e "import('$H/lib.mjs').then(m=>console.log(m.CELLS['$C'].repeat))")
FINAL=$(python3 -c "import json;d=json.load(open('$O/$C/looks.json'));print(max(v['hist'][-1]['n'] for v in d.values() if v['hist']))")
$N "$H/arms.mjs" run --cell="$C" --arm="$R" --rep --upto=30 --conc=1
$N "$H/arms.mjs" retry-killed --cell="$C"
$N "$H/arms.mjs" run --cell="$C" --arm="$R" --rep --upto=30 --conc=1
$N "$H/judge.mjs" rep --cell="$C" --conc=3
$N "$H/judge.mjs" controls --cell="$C" --conc=3
[ "$C" = latin ] && $N "$H/judge.mjs" main --cell=latin --upto="$FINAL" --with-stored --conc=3
$N "$H/judge.mjs" second --cell="$C" --conc=3
echo "POST DONE $C"
