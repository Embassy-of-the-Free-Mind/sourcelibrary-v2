#!/bin/bash
# #5924: the RunPod helper's verbs (create | push | ssh | pull <arm> | status | terminate) for ONE leased Scaleway GPU,
# so run-r4.sh can drive either (S=…/scw-box.sh). RunPod refused to rent on 2026-10-06 (account balance −$0.06).
#
# PRIOR ART: ../ocr-bakeoff-r4-5924/paddle-zh-runpod.sh (the verbs and the state layout this mirrors);
# glm-english-scw.sh on PR #5816 (#5660 job glm-english-5660d: the Scaleway create, GPU OS image, cloud-init root key,
# lease via scripts/maintenance/gpu-lease-watchdog.mjs --lease, provider-API poweroff + server AND volume delete),
# copied in the few lines needed. The lease is the Hetzner watchdog's: it powers the box off when the lease expires.
# A guest shutdown would leave it billed; `terminate` powers off through the API, deletes the server and its volumes,
# and confirms it is gone.
#
#   LANE_DIR=… POD=<label> [TYPE=L4-1-24G ZONES="fr-par-2 pl-waw-2" LEASE_H=6] scw-box.sh create
# State: $LANE_DIR/runpod-pods/<POD>/{pod-id,name,zone,created-at,cost-per-hr,gpu,terminated-at} (same layout as RunPod's).
set -eu
set -a; . /root/.scaleway.env; set +a
LANE_DIR=${LANE_DIR:?}; POD=${POD:?POD=<label> required}
D=$LANE_DIR/runpod-pods/$POD; mkdir -p "$D"
HERE=$(cd "$(dirname "$0")" && pwd); REPO=${REPO:-/root/sourcelibrary}   # gpu-lease-watchdog.mjs lives on main
TYPE=${TYPE:-L4-1-24G}; ZONES=${ZONES:-fr-par-2 pl-waw-2}; LEASE_H=${LEASE_H:-6}; ROOT_GB=${ROOT_GB:-120}; EUR_USD=${EUR_USD:-1.17}
PROJECT=${SCW_PROJECT:-873752fd-c333-4f03-87ab-9db2af36a853}
H=(-H "X-Auth-Token: $SCALEWAY_SECRET_KEY" -H "Content-Type: application/json")
SSHO=(-o BatchMode=yes -o ConnectTimeout=15 -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o LogLevel=ERROR -o ServerAliveInterval=30)
log() { echo "$(date -u +%FT%TZ) [$POD] $*" | tee -a "$D/driver.log"; }
sid() { cat "$D/pod-id"; }
zone() { cat "$D/zone"; }
api() { echo "https://api.scaleway.com/instance/v1/zones/$(zone)"; }
state() { curl -s "${H[@]}" "$(api)/servers/$(sid)" | python3 -c 'import json,sys; d=json.load(sys.stdin); s=d.get("server"); print((s["state"]+" "+((s.get("public_ip") or {}).get("address",""))) if s else "gone -")'; }
ip() { state | awk '{print $2}'; }
sshp() { ssh "${SSHO[@]}" root@"$(ip)" "$@"; }
rs() { local a=(); for x in "$@"; do a+=("${x/#POD:/root@$(ip):}"); done; rsync -a -e "ssh ${SSHO[*]}" "${a[@]}"; }

case ${1:-} in
create)
  [ -s "$D/pod-id" ] && { echo "box exists: $(sid)"; exit 1; }
  for Z in $ZONES; do
    echo "$Z" > "$D/zone"
    IMAGE=$(curl -s "${H[@]}" "https://api.scaleway.com/marketplace/v2/local-images?zone=$Z&type=instance_sbs&page_size=100&image_label=ubuntu_noble_gpu_os_12" \
      | TYPE=$TYPE python3 -c 'import json,sys,os; t=os.environ["TYPE"]; L=[i for i in json.load(sys.stdin).get("local_images",[]) if t in i.get("compatible_commercial_types",[])]; print(L[0]["id"] if L else "")')
    [ -n "$IMAGE" ] || { log "no GPU OS image for $TYPE in $Z"; continue; }
    until=$(date -u -d "+${LEASE_H} hours" +%FT%TZ); name="sl-latin-r4-5924-$POD"
    body=$(printf '{"name":"%s","commercial_type":"%s","image":"%s","project":"%s","dynamic_ip_required":true,"tags":["lease-until=%s","owner=5924"],"volumes":{"0":{"size":%s,"volume_type":"sbs_volume"}}}' "$name" "$TYPE" "$IMAGE" "$PROJECT" "$until" "$((ROOT_GB*1000000000))")
    r=$(curl -s -X POST "${H[@]}" "https://api.scaleway.com/instance/v1/zones/$Z/servers" -d "$body")
    if echo "$r" | python3 -c 'import json,sys; print(json.load(sys.stdin)["server"]["id"])' > "$D/pod-id" 2>/dev/null; then break; fi
    rm -f "$D/pod-id"; log "create failed ($TYPE $Z): ${r:0:300}"
  done
  [ -s "$D/pod-id" ] || exit 1
  hp=$(curl -s "${H[@]}" "$(api)/products/servers?per_page=100" | TYPE=$TYPE python3 -c 'import json,sys,os; print(json.load(sys.stdin)["servers"][os.environ["TYPE"]]["hourly_price"])')
  python3 -c "print(round($hp*$EUR_USD,4))" > "$D/cost-per-hr"; echo "$name" > "$D/name"; echo "$TYPE" > "$D/gpu"; date -u +%s > "$D/created-at"
  log "created $(sid) $name $TYPE $(zone) (€$hp/h ≈ \$$(cat "$D/cost-per-hr")/h) lease-until=$until"
  printf '#cloud-config\nssh_authorized_keys:\n  - %s\n' "$(cat /root/.ssh/id_ed25519.pub)" > "$D/user-data"
  curl -s -X PATCH -H "X-Auth-Token: $SCALEWAY_SECRET_KEY" -H "Content-Type: text/plain" --data-binary @"$D/user-data" "$(api)/servers/$(sid)/user_data/cloud-init" >/dev/null
  curl -s -X POST "${H[@]}" "$(api)/servers/$(sid)/action" -d '{"action":"poweron"}' >/dev/null
  ok=0; for i in $(seq 1 60); do s=$(state); [ "${s%% *}" = running ] && { ok=1; break; }; sleep 10; done
  [ $ok = 1 ] || { log "did not reach running ($(state)) — deleting"; "$0" terminate; exit 1; }
  (cd "$REPO" && set -a && . /root/sourcelibrary/.env.production.local && set +a && node scripts/maintenance/gpu-lease-watchdog.mjs --lease "$(sid)" --zone "$(zone)" --hours "$LEASE_H" --owner 5924) 2>&1 | tail -1 | tee -a "$D/driver.log"
  for i in $(seq 1 90); do ssh "${SSHO[@]}" ubuntu@"$(ip)" "sudo bash -c 'cat /home/ubuntu/.ssh/authorized_keys >> /root/.ssh/authorized_keys'" 2>/dev/null && sshp true 2>/dev/null && break; sleep 10; done
  sshp true || { log "SSH-FAIL — deleting"; "$0" terminate; exit 1; }
  log "SSH-OK $(ip)" ;;
push)
  sshp 'mkdir -p /root/pz/code /root/pz/bench && (command -v rsync >/dev/null || (apt-get -qq update && apt-get -qq install -y rsync libgl1 libglib2.0-0 python3-venv >/dev/null 2>&1))'
  rs "$HERE/" POD:/root/pz/code/
  rs "$LANE_DIR"/bench/*.tsv POD:/root/pz/bench/
  rs "$LANE_DIR/bench/img" POD:/root/pz/bench/
  log "pushed code + bench" ;;
ssh) shift; sshp "$@" ;;
status) state ;;
pull)
  arm=${2:?arm}; mkdir -p "$LANE_DIR/bench/arms/$arm"
  rs --exclude img POD:/root/pz/arms/$arm/ "$LANE_DIR/bench/arms/$arm/" || true ;;
terminate)
  [ -s "$D/pod-id" ] || { echo "no box"; exit 0; }
  curl -s -X POST "${H[@]}" "$(api)/servers/$(sid)/action" -d '{"action":"poweroff"}' >/dev/null || true
  for i in $(seq 1 40); do s=$(state); [ "${s%% *}" = stopped ] || [ "${s%% *}" = gone ] && break; sleep 15; done
  vols=$(curl -s "${H[@]}" "$(api)/servers/$(sid)" | python3 -c 'import json,sys; d=json.load(sys.stdin).get("server"); print(" ".join(v["id"] for v in (d or {}).get("volumes",{}).values()))')
  curl -s -X DELETE "${H[@]}" "$(api)/servers/$(sid)" >/dev/null || true
  for v in $vols; do for i in $(seq 1 12); do r=$(curl -s -o /dev/null -w '%{http_code}' -X DELETE -H "X-Auth-Token: $SCALEWAY_SECRET_KEY" "https://api.scaleway.com/block/v1alpha1/zones/$(zone)/volumes/$v"); [ "$r" = 204 ] && break; sleep 10; done; log "volume $v delete -> $r"; done
  for i in $(seq 1 12); do s=$(state); [ "${s%% *}" = gone ] && break; sleep 5; done
  if [ "${s%% *}" = gone ]; then date -u +%s > "$D/terminated-at"; log "TERMINATED $(sid) (confirmed gone); billed ≈ \$$(python3 -c "print(round(($(cat "$D/terminated-at")-$(cat "$D/created-at"))/3600*$(cat "$D/cost-per-hr"),3))")"; mv "$D/pod-id" "$D/pod-id.terminated"; exit 0; fi
  log "TERMINATE NOT CONFIRMED $(sid) (state: $s)"; exit 2 ;;
*) echo "usage: POD=<label> $0 create|push|ssh|status|pull <arm>|terminate"; exit 2 ;;
esac
