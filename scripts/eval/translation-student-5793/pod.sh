#!/bin/bash
# PRIOR ART: scripts/gpu/paddle-zh-runpod.sh (#5600; copy at /root/paddle-zh-5600/code/scripts/gpu/) — create/ssh/
# terminate are delegated to it unchanged (sl-5600-<label>-until-<UTC> name, watchdog-enforced). It has no generic
# push/pull, and the watchdog only sees /root/paddle-zh-5600/runpod/<id>/, so this wrapper adds both (#5793).
#   POD=<label> pod.sh create|push <files…>|pull <remote> <local>|ssh <cmd>|beat|terminate
set -eu
export LANE_DIR=${LANE_DIR:-/root/student-5793}
RP=/root/paddle-zh-5600/code/scripts/gpu/paddle-zh-runpod.sh
D=$LANE_DIR/runpod-pods/${POD:?}
SSHO="-o BatchMode=yes -o ConnectTimeout=15 -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o LogLevel=ERROR -o ServerAliveInterval=30"
addr() { "$RP" status | python3 -c 'import ast,sys; d=ast.literal_eval(sys.stdin.read()); print(d["publicIp"], (d["portMappings"] or {}).get("22"))'; }
beat() { mkdir -p /root/paddle-zh-5600/runpod/$(cat $D/pod-id); date -u +%s > /root/paddle-zh-5600/runpod/$(cat $D/pod-id)/progress; }
case $1 in
create) "$RP" create; beat ;;
push) shift; read -r ip port < <(addr); "$RP" ssh 'mkdir -p /root/st'; rsync -a -e "ssh $SSHO -p $port" "$@" root@$ip:/root/st/; beat ;;
pull) read -r ip port < <(addr); mkdir -p "$3"; rsync -a -e "ssh $SSHO -p $port" root@$ip:"$2" "$3"; beat ;;
ssh) shift; "$RP" ssh "$@"; beat ;;
beat) beat ;;
terminate) "$RP" terminate ;;
*) echo usage; exit 2 ;;
esac
