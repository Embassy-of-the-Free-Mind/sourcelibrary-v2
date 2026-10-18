#!/usr/bin/env bash
# paddle.sh — P0 (production Paddle, layout off) over the fresh draw, one short /root/gpu.lock hold (#6871 row 3).
# PRIOR ART: scripts/eval/zh-residue-bakeoff-6871/drive.sh paddle() (copied: server first, then paddle-zh-box.sh arm, then stop).
set -uo pipefail
J=/root/jobs/zh-confirm-6871; IMG=$J/in; export VLLM_USE_FLASHINFER_SAMPLER=0 HF_HUB_OFFLINE=1
gpu_mib() { nvidia-smi --query-gpu=memory.used --format=csv,noheader,nounits; }
[ -n "$(ls /root/gpu-queue/running 2>/dev/null)" ] && { echo "queue task running; skip"; exit 4; }
exec 9>/root/gpu.lock; flock -w 300 9 || { echo "lock busy"; exit 5; }
echo "lock taken $(date -u +%FT%TZ) GPU $(gpu_mib) MiB"
ls $IMG | sed "s/.jpg$//" | awk -v d=$IMG "{print \$1\"\t1\t\"d\"/\"\$1\".jpg\"}" > $J/paddle-manifest.tsv
PATH=/root/pz/srv/bin:$PATH nohup /root/pz/srv/bin/paddlex_genai_server --model_name PaddleOCR-VL-1.6-0.9B --backend vllm --port 8118 > $J/serve-paddle.log 2>&1 < /dev/null &
SP=$!
for i in $(seq 1 120); do curl -sf http://127.0.0.1:8118/v1/models >/dev/null 2>&1 && break; sleep 5; done
name=zhconfirm6871-l0; rm -rf /root/pz/arms/$name
PV_WORK=/root/pz BACKEND=server CLIENTS=8 LAYOUT=0 timeout 600 bash /root/pz/code/paddle-zh-box.sh arm $name $J/paddle-manifest.tsv >> $J/paddle.log 2>&1
cp /root/pz/arms/$name/arm-run.json $J/P0.run.json
/root/pz/venv/bin/python - /root/pz/arms/$name/out $J/P0.jsonl <<'PY'
import json, os, sys
d, o = sys.argv[1:]
with open(o, "w") as f:
    for pid in sorted(os.listdir(d)):
        t = os.path.join(d, pid, "1.txt"); e = os.path.join(d, pid, "1.err")
        row = {"page_id": pid, "text": open(t).read()} if os.path.exists(t) else {"page_id": pid, "text": "", "error": open(e).read()[:300] if os.path.exists(e) else "missing"}
        f.write(json.dumps(row, ensure_ascii=False) + "\n")
PY
pkill -TERM -P $SP; kill $SP; sleep 8; pkill -9 -f "[p]addlex_genai_server.*--port 8118"; sleep 3
echo "done $(date -u +%FT%TZ) GPU $(gpu_mib) MiB; $(cat $J/P0.run.json | tr -d "\n ")"
