#!/bin/bash
# runs fleet-cycle.sh every 10 min until the fleet state is done/stopped or LOOP-STOP exists
cd /root/gpu-backlog-5660/zh
while [ ! -f LOOP-STOP ]; do
  bash fleet-cycle.sh >> fleet-cycle.out 2>&1
  python3 -c "import json,sys; sys.exit(0 if json.load(open('fleet-state.json')).get('status') in ('done','stopped','budget-stopped') else 1)" && break
  sleep 600
done
echo "$(date -u +%FT%TZ) loop exit" >> fleet-cycle.out
