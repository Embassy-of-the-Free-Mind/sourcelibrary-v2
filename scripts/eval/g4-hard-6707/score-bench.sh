#!/bin/bash
# PRIOR ART: ocr-pareto-6293/import-cli-arm.py + benchmark-score.mjs, used as is; the cohort references must be unpacked (--refs-dir), as engine-wave2-6011 notes.
# Panels 3-5: lay a G4L raw file into the bench copy (import-cli-arm.py), score with benchmark-score.mjs against the
# unpacked references, then G4L rows as build-ocr-pareto.mjs toRow(): failure (ONE FAILURE RULE) not scored; an
# unplaced read (not aligned / no CER) is a scored 1.0; CER capped at 1.
set -e
P=$1; STRATA=$2
S=/mnt/HC_Volume_105839809/jobs/g4-hard2-6707; E=gemini-4-argon-low+antigravity-cli
cd /mnt/HC_Volume_105839809/worktrees/job-g4-hard2-6707
rm -rf $S/bench/*/out/$E  # one panel at a time: zh-ms and zh-print share strata
python3 scripts/eval/ocr-pareto-6293/import-cli-arm.py --bench $S/bench --raw $S/raw/G4L-$P.raw.jsonl --engine $E --results $S/results-g4/$P
node $S/an/classify.mjs $S/raw/G4L-$P.raw.jsonl $S/an/cls-$P.json
rm -rf $S/scored-g4/$P; mkdir -p $S/scored-g4/$P
node scripts/eval/benchmark-score.mjs --root=$S/bench --stratum=$STRATA --refs-dir=$S/refs --out=$S/scored-g4/$P > $S/scored-g4/$P.log 2>&1
node $S/an/g4rows.mjs $P
# Guard: adding G4L must not move any stored cell (committed 2026-10-09 scored files).
python3 - $P <<'PY'
import json,glob,sys
P=sys.argv[1]; S='/mnt/HC_Volume_105839809/jobs/g4-hard2-6707'; old='/mnt/HC_Volume_105839809/worktrees/job-g4-hard2-6707/scripts/eval/results/ocr-pareto-6293/scored'
n=d=0
for f in glob.glob(f'{S}/scored-g4/{P}/*.json'):
    b=f.split('/')[-1]
    if b.startswith('summary'): continue
    O={p['slug']:p for p in json.load(open(f"{old}/{b.rsplit('-2026',1)[0]}-2026-10-09.json"))['pages']}
    for p in json.load(open(f))['pages']:
        for e,v in p['engines'].items():
            o=O.get(p['slug'],{}).get('engines',{}).get(e)
            if o is None: continue
            n+=1; d+= any(o.get(k)!=v.get(k) for k in ('cer','aligned','refused','empty','loop','invention_ref'))
print(f'guard: {n} stored cells, {d} moved')
PY
