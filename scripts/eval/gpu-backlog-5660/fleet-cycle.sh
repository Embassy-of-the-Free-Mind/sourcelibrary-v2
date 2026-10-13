#!/bin/bash
# #5660 job gpu-backlog-5660 — one Paddle fleet cycle for the SKQS manuscript lane. Stop: touch /root/gpu-backlog-5660/zh/STOP
# Config: the #5600 fleet recipe (vLLM server, 8 clients, no layout); wave 1 (never-read pages) + its one retry; previews keep their reading.
# GATE_PAGES is raised only after a quality gate passes (gate file: gate-pages). Lease-only (no progress tag): the gate pause
# would trip the Mongo idle rule; the on-box loop (QUEUE_IDLE_MIN) and GATE_IDLE_MAX_MIN are the idle guards.
cd /root/gpu-backlog-5660/zh || exit 1
[ -f fleet-state.json ] && python3 -c "import json,sys; sys.exit(0 if json.load(open('fleet-state.json')).get('status') in ('done','stopped','budget-stopped') else 1)" && exit 0
exec flock -n /tmp/sl-paddle-fleet-5660.lock env LANE_DIR=/root/gpu-backlog-5660/zh PADDLE_ZH_ISSUE=5660 PADDLE_ZH_HOLD=gpu-backlog-5660 \
  PADDLE_ZH_HOLD_RELEASE='first OCR of these SKQS volumes was job gpu-backlog-5660 (#5660, OCR only); translation is its own priced decision; release with --to ocr_complete' \
  BOX_PREFIX=g WAVES=1,3 GATE_PAGES=$(cat gate-pages) GATE_IDLE_MAX_MIN=75 PROGRESS= \
  MAX_BOXES=${MAX_BOXES:-3} MAX_PODS=0 ZONES=pl-waw-2,fr-par-2,fr-par-1 TYPE=L4-1-24G STOP_EUR=180 CHUNK_PAGES=2500 QUEUE_DEPTH=1 LEASE_H=3 \
  BOX_ENV="BACKEND=server CLIENTS=8 LAYOUT=0 QUEUE_IDLE_MIN=90" nice -n 5 /usr/bin/node --env-file=/root/sourcelibrary/.env.production.local \
  /root/gpu-backlog-5660/zh/code/scripts/gpu/paddle-zh-fleet.mjs
