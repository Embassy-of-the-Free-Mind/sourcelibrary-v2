#!/bin/bash
#
# atlas-egress-meter.sh — count every byte this box receives from MongoDB Atlas, once a day,
# and page when it is over budget (#5189).
#
# PRIOR ART: scripts/audit/atlas-egress-sample.mjs + atlas-egress-report.mjs — a sampler run by
# hand for a few hours to ATTRIBUTE bytes to processes. It is not continuous and misses short
# connections. This is the opposite instrument: a firewall counter that sees every packet from
# Atlas, all day, with no attribution. Use this to notice, the sampler to explain.
#
# WHY: October 2026 Atlas "Data Transfer (Internet)" was 7,283 GB ($655), up from 1,702 GB in
# September. Atlas bills every byte that leaves AWS for our Hetzner boxes at $0.09/GB, and nobody
# saw the climb until the invoice arrived. Post-mortem: #5189.
#
# HOW: a separate nftables table (inet sl_meter) with one named counter on packets whose TCP
# source port is 27017 — every Atlas reply, whatever node IP. The chain only counts: policy
# accept, no drop rules, so it cannot change what ufw/iptables allow (a verdict in one table
# never ends evaluation in another). The counter is wire bytes after compression, which is
# what Atlas bills (plus TCP/IP headers, ~3%).
#
#   atlas-egress-meter.sh ensure   create the table if missing (idempotent; @reboot)
#   atlas-egress-meter.sh sample   hourly: run the socket sampler ~55 min into today's file
#   atlas-egress-meter.sh report   read-and-reset the counter, log one line, page if over budget,
#                                  naming the top readers from yesterday's samples
#   atlas-egress-meter.sh top [D]  print the top readers for UTC day D (default today)
#
# ATTRIBUTION (2026-11-09): the counter alone said "155 GB" but not WHICH job, so every page
# sent a session hunting with a hand-run sampler after the bytes were gone. `sample` keeps
# atlas-egress-sample.mjs running all day (ss every 30 s: bytes_received per socket, by pid;
# $currentOp only every 15 min, it is the costly half), and `report` reads the day's file with
# atlas-egress-report.mjs, so the page itself names the processes and their GB.
#
# Budget: ATLAS_EGRESS_DAILY_GB_MAX (default 40 GB per box per day ≈ $3.60). The whole October
# fleet averaged 235 GB/day; a 40 GB/box line would have paged on 2026-10-03, the first day of
# the climb. A report that runs after a reboot covers only the time since the reboot.
#
# Log: /var/log/sourcelibrary/atlas-egress-meter.log — "<iso> <host> <GB> GB since <prev iso>".
#
set -uo pipefail
MAX_GB="${ATLAS_EGRESS_DAILY_GB_MAX:-40}"
LOG="${LOG:-/var/log/sourcelibrary/atlas-egress-meter.log}"
NTFY="https://ntfy.sh/sourcelibrary-uptime"
STATE=/var/lib/sl-atlas-egress-meter.last
SAMPLES="${SAMPLES:-/var/log/sourcelibrary/atlas-egress-samples}"
# The checkout this script lives in (main/gex45: /root/sourcelibrary; cloudlayer/l7a: /data/scratch/sl/...).
REPO="${REPO:-$(cd "$(dirname "$(readlink -f "$0")")/../.." && pwd)}"
mkdir -p "$(dirname "$LOG")" "$SAMPLES"

sample() {
  # One file per UTC day. The sampler appends, so the hourly runs chain into one series and the
  # report's per-socket deltas carry across hour boundaries. 55 min, so runs never overlap.
  local out="$SAMPLES/$(date -u +%F).jsonl"
  [ -f "$REPO/scripts/audit/atlas-egress-sample.mjs" ] || { echo "[$(date -Is)] sample: no sampler in $REPO" >> "$LOG"; return 1; }
  cd "$REPO" || return 1
  timeout 3400 nice -n 19 node --env-file=.env.production.local scripts/audit/atlas-egress-sample.mjs \
    --out "$out" --minutes 55 --ss-every 30 --op-every 900 >/dev/null 2>>"$LOG"
  find "$SAMPLES" -name '*.jsonl' -mtime +14 -delete 2>/dev/null
}

# "<GB/day> <job>" for the top 3 measured readers in one UTC day's samples, joined by "; ".
# Prints nothing when there are no samples, so the page says so instead of guessing.
top_readers() {
  local in="$SAMPLES/$1.jsonl" js
  [ -s "$in" ] || return 0
  js=$(mktemp)
  if (cd "$REPO" && timeout 300 node scripts/audit/atlas-egress-report.mjs --in "$in" --json "$js" >/dev/null 2>&1); then
    node -e 'const r=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));
      console.log((r.measured||[]).slice(0,3).map(x=>`${(x.bytesPerDay/1e9).toFixed(1)} GB/day ${x.job}`).join("; "))' "$js" 2>/dev/null
  fi
  rm -f "$js"
}

ensure() {
  nft list counter inet sl_meter atlas_in >/dev/null 2>&1 && return 0
  nft -f - <<'EOF'
table inet sl_meter {
  counter atlas_in { }
  chain input {
    type filter hook input priority -310; policy accept;
    tcp sport 27017 counter name atlas_in
  }
}
EOF
}

report() {
  ensure || { echo "[$(date -Is)] $(hostname) ERROR: could not create nft counter" >> "$LOG"; exit 1; }
  local bytes prev now gb
  # reset returns the value it cleared, so no byte is counted twice or lost between read and reset
  bytes=$(nft reset counter inet sl_meter atlas_in 2>/dev/null | grep -o 'bytes [0-9]*' | awk '{print $2}')
  bytes=${bytes:-0}
  now=$(date -Is); prev=$(cat "$STATE" 2>/dev/null || echo "boot/install"); echo "$now" > "$STATE"
  gb=$(awk -v b="$bytes" 'BEGIN{printf "%.1f", b/1e9}')
  local top; top=$(top_readers "$(date -u -d yesterday +%F)")
  echo "[$now] $(hostname) $gb GB since $prev | top: ${top:-no samples}" >> "$LOG"
  if awk -v g="$gb" -v m="$MAX_GB" 'BEGIN{exit !(g>m)}'; then
    curl -s -m 10 -H "Title: Atlas egress over budget on $(hostname)" -H "Priority: high" -H "Tags: moneybag" \
      -d "$gb GB from Atlas since $prev (budget $MAX_GB GB/day, \$0.09/GB = \$$(awk -v g="$gb" 'BEGIN{printf "%.0f", g*0.09}')). Top readers (sampled): ${top:-no samples, is the hourly sample line running?}. Log: $LOG (#5189)." \
      "$NTFY" >/dev/null 2>&1 || echo "[$now] ntfy push failed" >> "$LOG"
  fi
}

case "${1:-}" in
  ensure) ensure ;;
  sample) sample ;;
  report) report ;;
  top) top_readers "${2:-$(date -u +%F)}" ;;
  *) echo "usage: $0 ensure|sample|report|top [YYYY-MM-DD]" >&2; exit 2 ;;
esac
