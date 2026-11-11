#!/usr/bin/env bash
# kraken-arm.sh — arm K of the #5924 Latin bake-off (prereg Amendment 4): Kraken 7.1 + CATMuS-Print on gex45's CPU.
#
# PRIOR ART: scripts/eval/kraken-refused-4686/run-arms.sh (the same `kraken segment -bl ocr -m` call per page, niced,
# resumable); this runs P processes side by side over the bake-off's fed images and packs one jsonl row per page.
#
#   nohup bash kraken-arm.sh > kraken.out 2>&1 &        Env: J, P (10 processes), THREADS (2 per process)
# Writes $J/out/K.jsonl {page_id, text, secs, rc} and $J/out/K.jsonl.run.json {wall_secs, pages_per_hour}.
set -uo pipefail
J=${J:-/root/jobs/latin-bakeoff-5924}; K=/root/bench/kraken/bin/kraken; P=${P:-10}; THREADS=${THREADS:-2}
MODEL=$(ls /root/.local/share/htrmopo/*/catmus-print-fondue-large.mlmodel | head -1)
D=$J/kraken; mkdir -p "$D" "$J/out"
one() {
  local img=$1 slug; slug=$(basename "$img" .jpg)
  [ -s "$D/$slug.txt" ] && return 0
  local t0; t0=$(date +%s.%N)
  OMP_NUM_THREADS=$THREADS timeout 1800 nice -n 10 "$K" -i "$img" "$D/$slug.txt" segment -bl ocr -m "$MODEL" >/dev/null 2>"$D/$slug.err"
  local rc=$?
  [ -f "$D/$slug.txt" ] || : > "$D/$slug.txt"
  printf '%s\t%s\t%s\n' "$slug" "$rc" "$(echo "$(date +%s.%N) - $t0" | bc)" >> "$D/_timings.tsv"
}
export -f one; export D K MODEL THREADS
t0=$(date +%s)
ls "$J"/in/*.jpg | xargs -P "$P" -I{} bash -c 'one "$@"' _ {}
wall=$(( $(date +%s) - t0 ))
python3 - "$D" "$J/out/K.jsonl" "$wall" "$P" "$THREADS" "$MODEL" <<'PY'
import json, os, sys
d, out, wall, p, th, model = sys.argv[1:]
tim = {}
for l in open(os.path.join(d, '_timings.tsv')):
    s, rc, secs = l.rstrip('\n').split('\t'); tim[s] = (int(rc), float(secs))
n = 0
with open(out, 'w') as f:
    for fn in sorted(x for x in os.listdir(d) if x.endswith('.txt')):
        s = fn[:-4]; rc, secs = tim.get(s, (None, None))
        f.write(json.dumps({'page_id': s, 'text': open(os.path.join(d, fn)).read(), 'secs': secs, 'rc': rc}, ensure_ascii=False) + '\n'); n += 1
json.dump({'mode': 'kraken', 'model': os.path.basename(model), 'pages': n, 'processes': int(p), 'threads_each': int(th),
           'wall_secs': int(wall), 'pages_per_hour': round(n / int(wall) * 3600) if int(wall) else None,
           'cpu_secs_per_page_median': sorted(v[1] for v in tim.values())[len(tim) // 2] if tim else None},
          open(out + '.run.json', 'w'), indent=1)
print(open(out + '.run.json').read())
PY
