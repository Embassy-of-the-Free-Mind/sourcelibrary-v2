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
#   atlas-egress-meter.sh report   read-and-reset the counter, log one line, page if over budget
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
mkdir -p "$(dirname "$LOG")"

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
  echo "[$now] $(hostname) $gb GB since $prev" >> "$LOG"
  if awk -v g="$gb" -v m="$MAX_GB" 'BEGIN{exit !(g>m)}'; then
    curl -s -m 10 -H "Title: Atlas egress over budget on $(hostname)" -H "Priority: high" -H "Tags: moneybag" \
      -d "$gb GB from Atlas since $prev (budget $MAX_GB GB/day, \$0.09/GB = \$$(awk -v g="$gb" 'BEGIN{printf "%.0f", g*0.09}')). Find the reader: node scripts/audit/atlas-egress-sample.mjs (#5189)." \
      "$NTFY" >/dev/null 2>&1 || echo "[$now] ntfy push failed" >> "$LOG"
  fi
}

case "${1:-}" in
  ensure) ensure ;;
  report) report ;;
  *) echo "usage: $0 ensure|report" >&2; exit 2 ;;
esac
