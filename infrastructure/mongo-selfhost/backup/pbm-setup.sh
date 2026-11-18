#!/bin/bash
# Apply the PBM storage config (and optionally turn PITR on) against the cluster PBM_MONGODB_URI names.
# PRIOR ART: stage 0 runbook (#346, sl-web-1:/root/stage0/RUNBOOK.md) — same commands, filesystem storage.
# Usage: pbm-setup.sh [--pitr on|off]     (restore-test.sh calls it with PBM_MONGODB_URI pointing at the scratch cluster)
HERE=$(cd "$(dirname "$0")" && pwd)
. "$HERE/common.sh"
umask 077
tmp=$(mktemp /run/pbm-config.XXXXXX.yaml)
trap 'rm -f "$tmp"' EXIT
envsubst '${S3_ENDPOINT} ${S3_BUCKET} ${AWS_ACCESS_KEY_ID} ${AWS_SECRET_ACCESS_KEY}' < "$HERE/pbm-config.tmpl.yaml" > "$tmp"
# the template says pitr.enabled: false; without --pitr, keep whatever the cluster has now
pitr_now=$(pbmc config 2>/dev/null | awk '/^pitr:/{p=1} p&&/enabled:/{print $2; exit}')
pbmc config --file "$tmp" >/dev/null || { log "pbm config failed"; exit 1; }
if [ "${1:-}" = "--pitr" ]; then pbmc config --set pitr.enabled=$([ "${2:-on}" = on ] && echo true || echo false) >/dev/null
elif [ "$pitr_now" = true ]; then pbmc config --set pitr.enabled=true >/dev/null; fi
log "pbm config applied (pitr: $(pbmc config 2>/dev/null | awk '/^pitr:/{p=1} p&&/enabled:/{print $2; exit}'))"
