#!/bin/bash
# PRIOR ART: hetzner:/root/tibetan-reocr/yig-rem-tend.py + sl-mitra-1:/root/yig/rem.sh (#4722 remainder, 2026-09-28) —
# same box, same lease/poweroff discipline; this is the #5250 one-shot version (start, push inputs, run, pull, stop).
# Run on Hetzner from /root/pp5250.  Steps are separate so each can be checked:
#   tibetan-gpu.sh start   lease 4 h (owner 5250) FIRST, then API poweron, wait for ssh
#   tibetan-gpu.sh push    inputs -> box:/root/pp5250 (images, manifest, worker)
#   tibetan-gpu.sh run     on the box: idle-poweroff.sh run -- (worker; mark exit; sleep 25 min for the pull)
#   tibetan-gpu.sh pull    box outputs -> tibetan/out
#   tibetan-gpu.sh stop    API poweroff, confirm stopped
#   tibetan-gpu.sh tend    (round 2) wait for the box job, pull, stop — run detached on Hetzner
# ROUND=2 (#5250 round 2): push/run/pull use /root/pp5250/r2 on Hetzner and /root/pp5250r2 on the box, and `run`
# launches box-r2.sh (Yigdzin arms, then Kraken on the freed GPU). After `start`, the box has lost Hetzner's ssh key
# (cloud-init resets authorized_keys on every poweron): re-add it from the laptop before `push`.
set -eu
ROUND=${ROUND:-1}
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
  if [ "$ROUND" = 2 ]; then
    $SSH $B 'mkdir -p /root/pp5250r2/tibetan /root/pp5250r2/syriac /root/pp5250r2/code'
    rsync -a -e "$SSH" /root/pp5250/r2/tibetan/img /root/pp5250/r2/tibetan/manifest.jsonl $B:/root/pp5250r2/tibetan/
    rsync -a -e "$SSH" /root/pp5250/r2/syriac/img $B:/root/pp5250r2/syriac/
    rsync -a -e "$SSH" /root/pp5250/code/pp_worker.py /root/pp5250/code/syriac-run.sh /root/pp5250/code/box-r2.sh \
      /root/sourcelibrary/scripts/gpu/idle-poweroff.sh $B:/root/pp5250r2/code/
    $SSH $B 'wc -l < /root/pp5250r2/tibetan/manifest.jsonl; ls /root/pp5250r2/syriac/img; ls -la /etc/gpu-idle.env /root/pp5250/models/sophro-mhiro.mlmodel /root/kvenv/bin/kraken; nvidia-smi --query-gpu=name,memory.used --format=csv,noheader'
    exit 0
  fi
  $SSH $B 'mkdir -p /root/pp5250/tibetan /root/pp5250/code'
  rsync -a -e "$SSH" /root/pp5250/tibetan/img /root/pp5250/tibetan/manifest.jsonl $B:/root/pp5250/tibetan/
  rsync -a -e "$SSH" /root/pp5250/code/pp_worker.py $B:/root/pp5250/code/
  rsync -a -e "$SSH" /root/sourcelibrary/scripts/gpu/idle-poweroff.sh $B:/root/pp5250/code/
  $SSH $B 'ls /root/pp5250/tibetan/img | tr "\n" " "; wc -l < /root/pp5250/tibetan/manifest.jsonl; ls -la /etc/gpu-idle.env; nvidia-smi --query-gpu=name,memory.used --format=csv,noheader' ;;
run)
  B=root@$(ip)
  if [ "$ROUND" = 2 ]; then
    $SSH $B 'nohup bash /root/pp5250r2/code/idle-poweroff.sh run -- bash /root/pp5250r2/code/box-r2.sh > /root/pp5250r2/idle.log 2>&1 < /dev/null & echo launched'
    exit 0
  fi
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
  if [ "$ROUND" = 2 ]; then
    mkdir -p /root/pp5250/r2/tibetan/out /root/pp5250/r2/syriac/out
    rsync -a -e "$SSH" $B:/root/pp5250r2/out/ /root/pp5250/r2/tibetan/out/
    rsync -a -e "$SSH" $B:/root/pp5250r2/syriac/out/ /root/pp5250/r2/syriac/out/
    rsync -a -e "$SSH" $B:/root/pp5250r2/worker.log $B:/root/pp5250r2/idle.log $B:/root/pp5250r2/syriac/timings.jsonl $B:/root/pp5250r2/syriac/run.out /root/pp5250/r2/ 2>/dev/null || true
    $SSH $B 'cat /root/pp5250r2/tib.exit /root/pp5250r2/syr.exit 2>/dev/null; tail -1 /root/pp5250r2/worker.log'
    exit 0
  fi
  mkdir -p /root/pp5250/tibetan/out
  rsync -a -e "$SSH" $B:/root/pp5250/out/ /root/pp5250/tibetan/out/
  rsync -a -e "$SSH" $B:/root/pp5250/worker.log $B:/root/pp5250/idle.log /root/pp5250/tibetan/ 2>/dev/null || true
  $SSH $B 'cat /root/pp5250/job.exit 2>/dev/null; tail -1 /root/pp5250/worker.log' ;;
tend)
  # Round 2: run DETACHED on Hetzner right after `run` (never a laptop loop). Waits for the box's syr.exit (or the
  # box leaving `running`), pulls, then API-poweroff + confirm. Deadline 200 min, inside the 4 h lease.
  for i in $(seq 1 100); do
    s=$(state); [ "${s%% *}" = running ] || { echo "$(date -u +%T) box $s before syr.exit"; break; }
    $SSH root@$(ip) 'test -f /root/pp5250r2/syr.exit' 2>/dev/null && { echo "$(date -u +%T) syr.exit seen"; break; }
    sleep 120
  done
  s=$(state); [ "${s%% *}" = running ] && ROUND=2 bash "$0" pull
  bash "$0" stop; echo "tend-done $(date -u +%FT%TZ)" ;;
stop)
  action poweroff
  for i in $(seq 1 30); do s=$(state); echo "$(date -u +%T) $s"; [ "${s%% *}" = stopped ] && { echo STOPPED; exit 0; }; sleep 15; done
  echo NOT-CONFIRMED; exit 1 ;;
*) echo "usage: $0 start|push|run|pull|tend|stop"; exit 2 ;;
esac
