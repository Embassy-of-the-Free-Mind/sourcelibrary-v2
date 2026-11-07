#!/usr/bin/env bash
# timeout: 2h
# issue: 5274
# PRIOR ART: scripts/gpu/paddle-zh-queue-task.sh (server start/stop and runner call, copied; that task's manifest is
# built from a lane's plan/ dir and it ends in a Mongo apply, neither wanted here).
# P1 arms of #5274 ditto restore: PaddleOCR-VL 1.6 on 35 pages, four inputs. No Mongo, files only.
#   r2           the stored 660 px image, same settings as the production run (repeat noise of P0)
#   ia           the Archive's full-size file (about 3x wider), no resize
#   ia-nolayout  the same, layout stage off (#5600: the mark read as 一 with layout on, 丨 off)
#   up3          the stored image upscaled 3x (does upscaling alone restore marks?)
set -uo pipefail
J=${J:-/root/jobs/zh-ditto-restore-5274/w}
CODE_DIR=${CODE_DIR:-/root/worktrees/job-zh-ditto-restore-5274}
export VLLM_USE_FLASHINFER_SAMPLER=0 HF_HUB_OFFLINE=1
gpu_mib() { nvidia-smi --query-gpu=memory.used --format=csv,noheader,nounits; }
stop_server() {
  [ -n "${SP:-}" ] || return 0
  pkill -TERM -P "$SP" 2>/dev/null; kill "$SP" 2>/dev/null; SP=
  sleep 8; pkill -9 -f "[p]addlex_genai_server.*--port 8118"; sleep 3
  for i in $(seq 1 30); do [ "$(gpu_mib)" -lt 600 ] && break; sleep 2; done
  echo "$(date -u +%FT%TZ) server stopped, GPU $(gpu_mib) MiB"
}
trap stop_server EXIT
mkdir -p "$J/img/up3"
/root/pz/venv/bin/python - "$J" <<'PY'
import glob, os, sys
from PIL import Image
J = sys.argv[1]
for f in glob.glob(f'{J}/img/r2/*.jpg'):
    im = Image.open(f).convert('RGB'); im.resize((im.width * 3, im.height * 3), Image.LANCZOS).save(f'{J}/img/up3/{os.path.basename(f)}', 'JPEG', quality=92)
PY
PATH=/root/pz/srv/bin:$PATH nohup /root/pz/srv/bin/paddlex_genai_server --model_name PaddleOCR-VL-1.6-0.9B --backend vllm --port 8118 > "$J/p1/serve.log" 2>&1 < /dev/null &
SP=$!
for i in $(seq 1 120); do curl -sf http://127.0.0.1:8118/v1/models >/dev/null 2>&1 && break; sleep 5; done
curl -sf http://127.0.0.1:8118/v1/models >/dev/null || { echo "genai server did not come up"; tail -20 "$J/p1/serve.log"; exit 1; }
echo "$(date -u +%FT%TZ) server up, GPU $(gpu_mib) MiB"
for arm in r2 ia ia-nolayout up3; do
  R=$J/p1/$arm; layout=1; [ "$arm" = ia-nolayout ] && layout=0
  s=$(date +%s); pids=()
  for w in 0 1 2 3; do
    ( while :; do
        /root/pz/venv/bin/python "$CODE_DIR/scripts/gpu/paddle-zh-run.py" --manifest "$R/manifest.tsv" --root "$R" --worker $w --workers 4 \
          --page-timeout 120 --layout $layout --backend server --prefetch 2 --max-width 0 >> "$R/worker-$w.log" 2>&1
        rc=$?; [ $rc -eq 3 ] || break
      done ) & pids+=($!)
  done
  wait "${pids[@]}"
  e=$(( $(date +%s) - s )); echo "$arm: $e s wall, $(find "$R/out" -name '*.txt' | wc -l) txt, $(find "$R/out" -name '*.err' | wc -l) err"
  echo "{\"arm\":\"$arm\",\"wall_secs\":$e,\"workers\":4,\"pages\":$(wc -l < "$R/manifest.tsv")}" > "$R/wall.json"
done
stop_server
touch "$J/p1/DONE"
