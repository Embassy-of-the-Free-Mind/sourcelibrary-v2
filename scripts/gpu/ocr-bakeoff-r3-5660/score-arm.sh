#!/bin/bash
# score-arm.sh <lane arm dir name> <engine label> — #5660 round 3 scoring, prereg Amendment 2.
# Own bench root per arm (lite, lite-b, flash-preview + this arm only), scorer unchanged, cost-lane rule unchanged,
# on the 657-page cells-r3 map AND the original 632-page cells map.
set -eu
arm=$1; engine=$2
W=/root/sourcelibrary/.claude/worktrees/job-ocr-bakeoff-5660c; RES=$W/scripts/eval/results/open-engine-print-5660
R=/root/r3-bench-5660/$arm; LANE=/root/ocr-bakeoff-5660c/lane
cd $W
[ -d $R ] || cp -al /root/r3-bench-5660/base $R
node scripts/eval/open-engine-print-5660.mjs paddle-in --root=$R --lane=$LANE --arm=$arm --engine=$engine
node scripts/eval/benchmark-score.mjs --root=$R --out=$RES/scored-$arm > /tmp/score-$arm.log 2>&1 || { tail -5 /tmp/score-$arm.log; exit 1; }
ST=eebo-tcp-5488,eebo-tcp-latin-5660,english-ia-5124,ref-ws,greek,greek-ext,greek-ext2
node scripts/eval/benchmark-cost-lane.mjs --strata=$ST --engine=$engine --cells=$RES/cells-r3.json --results=$RES/scored-$arm --out=$RES/cost-lane-$arm.json > /dev/null
node scripts/eval/benchmark-cost-lane.mjs --strata=$ST --engine=$engine --cells=$RES/cells.json --results=$RES/scored-$arm --out=$RES/cost-lane-$arm-632.json > /dev/null
node scripts/eval/open-engine-print-5660.mjs report --engines=$engine --scored=scored-$arm --summary=summary-$arm.json --cells=cells-r3.json --cost-lane=cost-lane-$arm.json --arm-run=$LANE/bench/arms/$arm/arm-run.json --lane=$LANE > /dev/null
node scripts/eval/open-engine-print-5660.mjs report --engines=$engine --scored=scored-$arm --summary=summary-$arm-632.json --cells=cells.json --cost-lane=cost-lane-$arm-632.json --arm-run=$LANE/bench/arms/$arm/arm-run.json --lane=$LANE > /dev/null
node scripts/eval/open-engine-print-5660.mjs tally --root=$R --weak=weak-spots-$arm.json > /dev/null
node -e '
const s=require(process.argv[1]); const e=Object.keys(s.engines)[0];
for (const [c,v] of Object.entries(s.engines[e])) console.log(c.padEnd(18), `n=${v.n_pages}(${v.n_library})`, `lite ${v.lite_cer} arm ${v.engine_cer}`, `Δ ${v.delta} ${JSON.stringify(v.delta_ci95)}`, v.wlt, `cat ${v.catastrophic.engine}/${v.catastrophic.lite}`, `inv ${v.invention?.engine ?? JSON.stringify(v.invention)}`, v.verdict);
console.log("agreement", JSON.stringify(s.agreement)); console.log("cost", JSON.stringify(s.cost));' $RES/summary-$arm.json
