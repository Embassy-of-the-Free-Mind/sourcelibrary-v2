#!/bin/bash
# PRIOR ART: scripts/gpu/paddle-zh-gpu.sh (#5600 — the same create/push/ssh/pull/delete lifecycle for a
# Scaleway box). A RunPod pod differs where it matters for money and access: the deadline is in the pod
# NAME (sl-5600-<label>-until-<UTC>, read by scripts/maintenance/runpod-pod-watchdog.mjs on Hetzner every
# 10 min), billing ends only at TERMINATE (DELETE /pods/{id}), ssh is a mapped port on the pod's public IP,
# and the pod is a container (no idle-poweroff.sh: a container cannot power off its host).
#
#   POD=r4090 GPU="NVIDIA GeForce RTX 4090" CLOUD=COMMUNITY MINUTES=120 paddle-zh-runpod.sh create
#   POD=r4090 paddle-zh-runpod.sh push | ssh <cmd> | pull <arm> | status | terminate
# State: $LANE_DIR/runpod-pods/<POD>/{pod-id,name,created-at,cost-per-hr,gpu,cloud,driver.log,terminated-at}.
# Progress (what the watchdog reads): $LANE_DIR/runpod/<pod id>/ — `pull` copies the pod's arm outputs there.
# The API key comes from the environment (RUNPOD_API_KEY) and is never echoed.
set -eu
LANE_DIR=${LANE_DIR:-/root/paddle-zh-5600}
POD=${POD:?POD=<label> required}
D=$LANE_DIR/runpod-pods/$POD
mkdir -p "$D"
HERE=$(cd "$(dirname "$0")" && pwd)
: "${RUNPOD_API_KEY:?RUNPOD_API_KEY not set}"
API=https://rest.runpod.io/v1
AUTH=(-H "Authorization: Bearer $RUNPOD_API_KEY" -H "Content-Type: application/json")
IMAGE=${IMAGE:-runpod/pytorch:1.1.0-cu1281-torch280-ubuntu2404}
log() { echo "$(date -u +%FT%TZ) [$POD] $*" | tee -a "$D/driver.log" >> "$LANE_DIR/fleet.log"; echo "$(date -u +%FT%TZ) [$POD] $*"; }
pid() { cat "$D/pod-id"; }
info() { curl -s "${AUTH[@]}" "$API/pods/$(pid)"; }
addr() { info | python3 -c 'import json,sys; d=json.load(sys.stdin); p=(d.get("portMappings") or {}).get("22"); print((d.get("publicIp") or "")+" "+str(p or ""))'; }
SSHO=(-o BatchMode=yes -o ConnectTimeout=15 -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o LogLevel=ERROR -o ServerAliveInterval=30)
sshp() { read -r ip port < <(addr); ssh "${SSHO[@]}" -p "$port" root@"$ip" "$@"; }
rs() { read -r ip port < <(addr); local args=(); for x in "$@"; do args+=("${x/#POD:/root@$ip:}"); done; rsync -a -e "ssh ${SSHO[*]} -p $port" "${args[@]}"; }

case ${1:-} in
create)
  [ -s "$D/pod-id" ] && { echo "pod exists: $(pid)"; exit 1; }
  until=$(date -u -d "+${MINUTES:-120} min" +%Y%m%dT%H%MZ)
  name="sl-5600-$POD-until-$until"
  body=$(python3 - "$name" "$GPU" "${CLOUD:-COMMUNITY}" "$IMAGE" "$(cat /root/.ssh/id_ed25519.pub)" "${DISK_GB:-80}" <<'PY'
import json, sys
name, gpu, cloud, image, key, disk = sys.argv[1:]
print(json.dumps({'name': name, 'computeType': 'GPU', 'gpuTypeIds': [gpu], 'gpuCount': 1, 'cloudType': cloud,
  'imageName': image, 'containerDiskInGb': int(disk), 'volumeInGb': 0, 'ports': ['22/tcp'], 'supportPublicIp': True,
  'allowedCudaVersions': ['12.8', '12.9', '13.0'], 'minRAMPerGPU': 16, 'minVCPUPerGPU': 4, 'env': {'PUBLIC_KEY': key}}))
PY
)
  r=$(curl -s -X POST "${AUTH[@]}" "$API/pods" -d "$body")
  echo "$r" | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d["id"])' > "$D/pod-id" 2>/dev/null || { rm -f "$D/pod-id"; log "create REFUSED ($GPU ${CLOUD:-COMMUNITY}): ${r:0:300}"; exit 1; }
  date -u +%s > "$D/created-at"; echo "$name" > "$D/name"; echo "$GPU" > "$D/gpu"; echo "${CLOUD:-COMMUNITY}" > "$D/cloud"
  echo "$r" | python3 -c 'import json,sys; print(json.load(sys.stdin).get("costPerHr"))' > "$D/cost-per-hr"
  mkdir -p "$LANE_DIR/runpod/$(pid)"
  log "created $(pid) $name ($GPU, ${CLOUD:-COMMUNITY}, \$$(cat "$D/cost-per-hr")/h)"
  for i in $(seq 1 90); do
    read -r ip port < <(addr) || true
    if [ -n "${ip:-}" ] && [ -n "${port:-}" ] && ssh "${SSHO[@]}" -p "$port" root@"$ip" true 2>/dev/null; then
      date -u +%s > "$D/ssh-at"; log "SSH-OK $ip:$port after $(( $(date +%s) - $(cat "$D/created-at") )) s"; exit 0; fi
    sleep 10
  done
  log "SSH-FAIL after 15 min — terminating"; "$0" terminate; exit 1 ;;
push)
  sshp 'mkdir -p /root/pz/code && (command -v rsync >/dev/null || (apt-get -qq update && apt-get -qq install -y rsync libgl1 libglib2.0-0 python3-venv >/dev/null 2>&1))'
  rs "$HERE/paddle-zh-box.sh" "$HERE/paddle-zh-run.py" "$HERE/paddle-vl-box.sh" POD:/root/pz/code/
  rs "$LANE_DIR/bench/acc.tsv" "$LANE_DIR/bench/tput.tsv" POD:/root/pz/bench/
  rs "$LANE_DIR/bench/img" POD:/root/pz/bench/
  log "pushed code + bench" ;;
ssh) shift; sshp "$@" ;;
status) info | python3 -c 'import json,sys; d=json.load(sys.stdin); print({k: d.get(k) for k in ["id","name","desiredStatus","costPerHr","publicIp","portMappings","lastStartedAt"]})' ;;
pull)  # pull <arm>: the arm's outputs into the progress dir and the bench arms dir
  arm=${2:?arm}; mkdir -p "$LANE_DIR/runpod/$(pid)/$arm" "$LANE_DIR/bench/arms/$arm"
  rs POD:/root/pz/arms/$arm/ "$LANE_DIR/runpod/$(pid)/$arm/" || true
  rs --exclude img POD:/root/pz/arms/$arm/ "$LANE_DIR/bench/arms/$arm/" || true ;;
terminate)
  [ -s "$D/pod-id" ] || { echo "no pod"; exit 0; }
  curl -s -o /dev/null -w '%{http_code}\n' -X DELETE "${AUTH[@]}" "$API/pods/$(pid)" > "$D/terminate.http"
  for i in $(seq 1 12); do curl -s "${AUTH[@]}" "$API/pods" | python3 -c "import json,sys; sys.exit(0 if '$(pid)' not in [p['id'] for p in json.load(sys.stdin)] else 1)" && { date -u +%s > "$D/terminated-at"; log "TERMINATED $(pid) (confirmed gone); billed ≈ \$$(python3 -c "print(round(($(cat "$D/terminated-at")-$(cat "$D/created-at"))/3600*$(cat "$D/cost-per-hr"),3))")"; mv "$D/pod-id" "$D/pod-id.terminated"; exit 0; }; sleep 5; done
  log "TERMINATE NOT CONFIRMED $(pid)"; exit 2 ;;
*) echo "usage: POD=<label> $0 create|push|ssh|status|pull <arm>|terminate"; exit 2 ;;
esac
