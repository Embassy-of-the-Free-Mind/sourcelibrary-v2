#!/usr/bin/env bash
# second reader (SECOND-READER.md v1) on every serious call, one claude -p Opus call per packet
REPO=/data/scratch/sl/sourcelibrary/.claude/worktrees/job-zh-held-quality-8053; S=$JOB_SCRATCH/second
for g in held control; do
 ( body=$(sed -n '/^# Second reader/,$p' $REPO/scripts/eval/spot-check/SECOND-READER.md)
   printf '%s\n\nThe packet carries, for context only, `previous_page_ocr_tail` and `next_page_ocr_head` (the stored OCR of the neighbouring leaves).\nPACKET_FILE: %s\nOUTPUT_FILE: %s\n' "$body" "$S/packets/$g.json" "$S/out/$g.json" | (cd $REPO && claude -p --model opus --output-format json --allowedTools "Read" "Write" "Bash(curl:*)" "Bash(mkdir:*)" "Bash(ls:*)" "Bash(python3:*)" "Bash(sips:*)") > $S/meta-$g.json 2> $S/meta-$g.err
   echo "$g done $(test -s $S/out/$g.json && echo ok || echo MISSING)" >> $S/done.log ) &
done
wait; echo ALL_DONE >> $S/done.log
