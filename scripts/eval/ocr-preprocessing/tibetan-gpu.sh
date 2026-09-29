#!/bin/bash
# PRIOR ART: hetzner:/root/tibetan-reocr/yig-rem-tend.py + sl-mitra-1:/root/yig/rem.sh (#4722 remainder, 2026-09-28) —
# same box, same lease/poweroff discipline; this is the #5250 one-shot version (start, push inputs, run, pull, stop).
# Run on Hetzner from /root/pp5250.  Steps are separate so each can be checked:
#   tibetan-gpu.sh start   lease 4 h (owner 5250) FIRST, then API poweron, wait for ssh
#   tibetan-gpu.sh push    inputs -> box:/root/pp5250 (images, manifest, worker)
#   tibetan-gpu.sh run     on the box: idle-poweroff.sh run -- (worker; mark exit; sleep 25 min for the pull)
#   tibetan-gpu.sh pull    box outputs -> tibetan/out
#   tibetan-gpu.sh stop    API poweroff, confirm stopped
set -eu
SID=b40e6c57-8d1c-4f31-953a-1c898fe5aaf6; ZONE=fr-par-2
API=https://api.scaleway.com/instance/v1/zones/$ZONE/servers/$SID
set -a; . /root/.scaleway.env; set +a
state() { curl -s -H "X-Auth-Token: $SCALEWAY_SECRET_KEY" $API | python3 -c 'import json,sys; s=json.load(sys.stdin)["server"]; print(s["state"], (s.get("public_ip") or {}).get("address",""))'; }
action() { curl -s -X POST -H "X-Auth-Token: $SCALEWAY_SECRET_KEY" -H "Content-Type: application/json" -d "{\"action\":\"$1\"}" $API/action; echo; }
ip() { state | awk '{print $2}'; }
SSH="ssh -o BatchMode=yes -o ConnectTimeout=15 -o StrictHostKeyChecking=accept-new"
case ${1:-} in
start)
  (cd /root/sourcelibrary && node scripts/maintenance/gpu-lease-watchdog.mjs --lease $SID --zone $ZONE --hours 4 --owner 5250)
  s=$(state); echo "state: $s"
  [ "${s%% *}" = stopped ] && action poweron
  for i in $(seq 1 40); do s=$(state); echo "$(date -u +%T) $s"; [ "${s%% *}" = running ] && break; sleep 15; done
  for i in $(seq 1 40); do $SSH root@$(ip) true 2>/dev/null && { echo SSH-OK; exit 0; }; sleep 15; done
  echo SSH-FAIL; exit 1 ;;
push)
  B=root@$(ip)
  $SSH $B 'mkdir -p /root/pp5250/tibetan /root/pp5250/code'
  rsync -a -e "$SSH" /root/pp5250/tibetan/img /root/pp5250/tibetan/manifest.jsonl $B:/root/pp5250/tibetan/
  rsync -a -e "$SSH" /root/pp5250/code/pp_worker.py $B:/root/pp5250/code/
  rsync -a -e "$SSH" /root/sourcelibrary/scripts/gpu/idle-poweroff.sh $B:/root/pp5250/code/
  $SSH $B 'ls /root/pp5250/tibetan/img | tr "\n" " "; wc -l < /root/pp5250/tibetan/manifest.jsonl; ls -la /etc/gpu-idle.env; nvidia-smi --query-gpu=name,memory.used --format=csv,noheader' ;;
run)
  B=root@$(ip)
  $SSH $B 'cat > /root/pp5250/job.sh <<EOF
cd /root/pp5250
export VLLM_USE_FLASHINFER_SAMPLER=0 OCR_VLLM_IMAGE_TOKEN_POSITIONS=sequential
/root/venv/bin/python code/pp_worker.py --todo tibetan/manifest.jsonl --out /root/pp5250/out --model /root/yig/model --batch 128 --stop-file /root/pp5250/STOP >> /root/pp5250/worker.log 2>&1
echo "exit=\$? \$(date -u +%FT%TZ)" > /root/pp5250/job.exit
sleep 1500
EOF
nohup bash /root/pp5250/code/idle-poweroff.sh run -- bash /root/pp5250/job.sh > /root/pp5250/idle.log 2>&1 < /dev/null & echo launched' ;;
pull)
  B=root@$(ip)
  mkdir -p /root/pp5250/tibetan/out
  rsync -a -e "$SSH" $B:/root/pp5250/out/ /root/pp5250/tibetan/out/
  rsync -a -e "$SSH" $B:/root/pp5250/worker.log $B:/root/pp5250/idle.log /root/pp5250/tibetan/ 2>/dev/null || true
  $SSH $B 'cat /root/pp5250/job.exit 2>/dev/null; tail -1 /root/pp5250/worker.log' ;;
stop)
  action poweroff
  for i in $(seq 1 30); do s=$(state); echo "$(date -u +%T) $s"; [ "${s%% *}" = stopped ] && { echo STOPPED; exit 0; }; sleep 15; done
  echo NOT-CONFIRMED; exit 1 ;;
*) echo "usage: $0 start|push|run|pull|stop"; exit 2 ;;
esac
