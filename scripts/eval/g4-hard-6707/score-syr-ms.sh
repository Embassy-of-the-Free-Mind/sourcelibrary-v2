#!/bin/bash
# PRIOR ART: benchmark/syriac-retest/score-syriac-retest.py with SYRIAC_IMAGES/SYRIAC_SCORE_OUT, as #6011 wave 2 used it.
# Lay G4L Syriac-manuscript replies (text between the markers; a filter stub cut at Gemini's message, as import-cli-arm.py)
# into a G4L-only tree and score it with score-syriac-retest.py (cer_n2), the chart's Syriac instrument.
S=/mnt/HC_Volume_105839809/jobs/g4-hard2-6707; E=gemini-4-argon-low+antigravity-cli; T=$S/syr-g4/syriac-gt
rm -rf $S/syr-g4; mkdir -p $T/out/$E
for f in $S/syr/syriac-gt/*.jpg; do ln -s $(readlink -f $f) $T/; done
python3 - <<PY
import json,re
M="This request was blocked by Gemini's filters"
rows={}
for l in open('$S/raw/G4L-syr-ms.raw.jsonl'):
    r=json.loads(l); rows[r['uid']]=r
for u,r in rows.items():
    t=r.get('text') or ''
    if M in t: t=re.sub(r"<[^>\n]*$","",t[:t.index(M)].rstrip()).rstrip()
    open('$T/out/$E/'+u.split('|',1)[1]+'.txt','w').write(t)
print(len(rows),'laid')
PY
cd /mnt/HC_Volume_105839809/worktrees/job-g4-hard2-6707
SYRIAC_IMAGES=$S/syr-g4 SYRIAC_SCORE_OUT=$S/an/syr-ms-score-g4l.json python3 scripts/eval/benchmark/syriac-retest/score-syriac-retest.py > $S/an/syr-ms-score.log 2>&1
echo scored $?
