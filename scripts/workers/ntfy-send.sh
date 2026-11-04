#!/usr/bin/env bash
# PRIOR ART: scripts/lib/ntfy-send.mjs (node twin) — shell senders each ran their own curl.
# Usage: ntfy-send.sh <topic-url> <title> <priority> <tags> <message>
# Appends "— src: <caller>@<host>" to the message and one JSONL line to the alarm log
# (ALARM_LOG, else /var/log/sourcelibrary/alarms.jsonl, else ~/.sourcelibrary/alarms.jsonl).
# Logging failure never fails the send. Exit status = curl's.
# Caller name: set NTFY_SRC=<script>.sh in the caller (a child process cannot see its parent script).
topic=$1; title=$2; prio=${3:-default}; tags=${4:-}; msg=$5
src=${NTFY_SRC:-unknown-shell-caller}@$(hostname)
log_line=$(printf '{"at":"%s","src":"%s","topic":"%s","title":"%s","priority":"%s"}' \
  "$(date -u +%FT%TZ)" "$src" "${topic##*/}" "$(printf %s "$title" | tr -d '"\\')" "$prio")
for f in "${ALARM_LOG:-}" /var/log/sourcelibrary/alarms.jsonl "$HOME/.sourcelibrary/alarms.jsonl"; do
  [ -n "$f" ] || continue
  { mkdir -p "$(dirname "$f")" && printf '%s\n' "$log_line" >> "$f"; } 2>/dev/null && break
done
curl -fsS -m 15 -H "Title: $title" -H "Priority: $prio" ${tags:+-H "Tags: $tags"} -d "$msg
— src: $src" "$topic" >/dev/null
