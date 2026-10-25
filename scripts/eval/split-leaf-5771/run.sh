#!/usr/bin/env bash
# PRIOR ART: scripts/eval/opus-tib-sa-6948/read-loop.sh and that job's run-audit.sh (claude -p under the job's caps,
# waiting on the meter file only, never a probe, #7118). This chains the stage-1 steps of job split-leaves-5771 so they
# run unattended across the GPU queue and a weekly reset; each step is resumable and skips what is done.
# run.sh  — needs JOB_SCRATCH; logs to $JOB_SCRATCH/run.log; writes $JOB_SCRATCH/run.state (the last step finished).
#   1 pull   wait for gex45's 81-split-leaf-5771 task to finish; rsync its leaf reads to $JOB_SCRATCH/leafread/txt
#   2 translate  cut.mjs (arm 2), then leaf-translate.mjs (Opus) for arms 2 and 3, waits at the caps (80% 5-hour / 85% week)
#   3 packet     packet.mjs: both arms + the #6948 controls in one shuffled set (same images, same prompt)
#   4 audit      run-claude-arm.py, Opus, parallel 3, in chunks of 24, waiting at the caps
#   5 score + attribute (audit.mjs, unchanged)
set -uo pipefail
ROOT=$(cd "$(dirname "$0")/../../.." && pwd); S=$JOB_SCRATCH; cd "$ROOT"
export PATH=/root/.local/bin:$PATH CLAUDE_SESSION_MAX_PCT=80 CLAUDE_WEEKLY_MAX_PCT=85
G=root@65.108.136.89; J=/root/jobs/split-leaves-5771
P6948=$S/p6948/audit
log() { echo "$(date -u +%FT%TZ) $*"; }
state() { echo "$1" > "$S/run.state"; log "STEP $1"; }
waitcap() { node --input-type=module -e "const m=await import('$ROOT/scripts/lib/model-limits.mjs'); const ok=await m.waitWhileBlocked(()=>m.claudeBlocked({sessionMax:80,weeklyMax:85}),{maxWaitH:200}); process.exit(ok?0:4)"; }

# 1 pull
until ssh -o ConnectTimeout=20 $G "ls /root/gpu-queue/done/81-split-leaf-5771.sh /root/gpu-queue/failed/81-split-leaf-5771.sh 2>/dev/null | grep -q ." ; do sleep 600; done
mkdir -p $S/leafread && rsync -a $G:$J/out/txt $G:$J/out/leaves.jsonl $S/leafread/
n=$(ls $S/leafread/txt | grep -c '\.txt$'); log "leaf reads pulled: $n"
[ "$n" -ge 180 ] || { log "too few leaf reads ($n); stopping"; state pull-short; exit 2; }
state pulled

# 2 translate: arm 2 (CUT: the stored read cut at its seams, cut.mjs) and arm 3 (REREAD: the leaf reads)
node scripts/eval/split-leaf-5771/cut.mjs --frames=$S/frames.jsonl --req=$P6948/req.jsonl --out=$S/arm2/txt
for arm in cut:$S/arm2/txt reread:$S/leafread/txt; do
  name=${arm%%:*}; txt=${arm#*:}
  for i in $(seq 1 30); do
    waitcap || exit 4
    node --env-file=.env.production.local scripts/eval/split-leaf-5771/leaf-translate.mjs --frames=$S/frames.jsonl --txt=$txt --out=$S/translate-$name
    rc=$?; [ $rc -eq 0 ] && break; [ $rc -eq 3 ] || { log "translate $name rc=$rc"; sleep 300; }
  done
done
state translated

# 3 packet
mkdir -p $S/audit
node --env-file=.env.production.local scripts/eval/split-leaf-5771/packet.mjs --frames=$S/frames.jsonl --arms=cut:$S/arm2/txt:$S/translate-cut/frames,reread:$S/leafread/txt:$S/translate-reread/frames --plants=$P6948/plants.json --req=$S/audit/req.jsonl --key=$S/audit/key.json || exit 5
state packeted

# 4 audit
t=$(wc -l < $S/audit/req.jsonl)
for i in $(seq 1 40); do
  waitcap || exit 4
  python3 scripts/eval/replicate-6547/run-claude-arm.py --requests $S/audit/req.jsonl --out $S/audit/out.jsonl --arm split-leaf-audit --model opus --timeout 900 --parallel 3 --limit 24 --workdir $S/claude-ws
  n=$(python3 -c "import json;print(sum(1 for l in open('$S/audit/out.jsonl') if json.loads(l).get('text')))" 2>/dev/null || echo 0)
  log "audit chunk $i: answered $n/$t"; [ "$n" -ge "$t" ] && break
done
state audited

# 5 score + attribute
node scripts/eval/opus-tib-sa-6948/audit.mjs score --key=$S/audit/key.json --replies=$S/audit/out.jsonl --out=$S/audit/score.json > $S/audit/score.log
waitcap || exit 4
node scripts/eval/opus-tib-sa-6948/audit.mjs attribute --key=$S/audit/key.json --replies=$S/audit/out.jsonl --req=$S/audit/req.jsonl --out=$S/audit/attr.json
state done
