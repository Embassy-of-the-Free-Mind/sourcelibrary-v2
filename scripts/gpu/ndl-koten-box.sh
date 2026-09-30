#!/usr/bin/env bash
# ndl-koten-box.sh — the GPU half of the NDL classical-OCR lane (#4925). Runs ON a rented Scaleway
# L4 (Ubuntu Noble GPU OS: docker + the NVIDIA container runtime come with the image).
#
# PRIOR ART: scripts/eval/ocr-preprocessing/tibetan-gpu.sh (#5250 — start/push/run/pull/stop driven
# from Hetzner; this file is only the on-box part, the driving is the lane worker's `plan` + an rsync),
# and the #4745 benchmark's NDL run, whose two traps are handled here: the image ships `python3`
# with no `python` on PATH, and when the output dir already exists the CLI renames its output to a
# sibling OUTSIDE the mounted volume — so every run writes to a fresh `out-<stamp>` inside /work.
#
#   ndl-koten-box.sh setup     clone ndlkotenocr_cli at the pinned commit, build the docker image
#   ndl-koten-box.sh fetch     download every image in manifest.tsv (bid, pn, url) to input/img/<bid>/
#   ndl-koten-box.sh infer     run NDL over input/ with `-s b` (one directory per book)
#   ndl-koten-box.sh collect   out-<stamp>/**/<bid>/txt/<pn>.txt -> out/<bid>/<pn>.txt, write box.json
#   ndl-koten-box.sh all       the four in order, then touch DONE
# Run it under scripts/gpu/idle-poweroff.sh so the box stops itself when the job ends:
#   idle-poweroff.sh run -- bash -c 'ndl-koten-box.sh all; sleep 1800'   (30 min to pull the outputs)
# The output file per page IS the checkpoint: `fetch` skips images on disk, `collect` is idempotent.
set -euo pipefail
W=${NDL_WORK:-/root/ndl}
REPO=https://github.com/ndl-lab/ndlkotenocr_cli
COMMIT=${NDL_COMMIT:-939cbfaf617eb8fd7e54cf1daeb66fb5a92749ec}   # master, 2025-10-14 (ver.3)
TAG=kotenocr-cli-py310
mkdir -p "$W"
log() { echo "$(date -u +%FT%TZ) $*" | tee -a "$W/box.log"; }

setup() {
  if [ ! -d "$W/ndlkotenocr_cli" ]; then git clone -q "$REPO" "$W/ndlkotenocr_cli"; fi
  git -C "$W/ndlkotenocr_cli" checkout -q "$COMMIT"
  if ! docker image inspect "$TAG" >/dev/null 2>&1; then
    log "building $TAG at $COMMIT"
    (cd "$W/ndlkotenocr_cli" && sh ./docker/dockerbuild.sh) >> "$W/build.log" 2>&1
  fi
  log "setup ok: $(git -C "$W/ndlkotenocr_cli" rev-parse HEAD) $(nvidia-smi --query-gpu=name,driver_version --format=csv,noheader)"
}

fetch() {
  mkdir -p "$W/input/img"
  # zero-padded page names keep NDL's per-book order equal to page order
  awk -F'\t' 'NF==3 {printf "%s\t%05d\t%s\n", $1, $2, $3}' "$W/manifest.tsv" |
    while IFS=$'\t' read -r bid pn url; do
      f="$W/input/img/$bid/$pn.jpg"
      [ -s "$f" ] || printf '%s\t%s\n' "$f" "$url"
    done | xargs -P 16 -L 1 bash -c 'mkdir -p "$(dirname "$0")"; curl -sfL --retry 3 -o "$0" "$1" || echo "FETCH-FAIL $1"' | tee -a "$W/fetch-fail.log" || true
  log "fetch: $(find "$W/input/img" -name '*.jpg' | wc -l) images on disk, $(grep -c FETCH-FAIL "$W/fetch-fail.log" 2>/dev/null || echo 0) failures logged"
}

infer() {
  STAMP=$(date -u +%Y%m%dT%H%M%SZ)
  echo "$STAMP" > "$W/last-stamp"
  local t0=$(date +%s)
  log "infer start out-$STAMP"
  docker run --gpus all --rm -v "$W":/work "$TAG" python3 main.py infer /work/input /work/out-$STAMP -s b >> "$W/infer.log" 2>&1
  local t1=$(date +%s)
  echo $((t1 - t0)) > "$W/infer-secs"
  log "infer done in $((t1 - t0)) s"
}

collect() {
  STAMP=$(cat "$W/last-stamp")
  local n=0
  while IFS= read -r f; do
    bid=$(basename "$(dirname "$(dirname "$f")")")
    pn=$((10#$(basename "$f" .txt)))
    mkdir -p "$W/out/$bid"
    cp "$f" "$W/out/$bid/$pn.txt"
    n=$((n + 1))
  done < <(find "$W/out-$STAMP" -path '*/txt/*.txt')
  local secs=$(cat "$W/infer-secs" 2>/dev/null || echo 0)
  python3 - "$W" "$n" "$secs" "$(git -C "$W/ndlkotenocr_cli" rev-parse HEAD)" "$(hostname)" "$(nvidia-smi --query-gpu=name --format=csv,noheader | head -1)" <<'EOF'
import json, sys
w, n, secs, commit, host, gpu = sys.argv[1], int(sys.argv[2]), int(sys.argv[3]), sys.argv[4], sys.argv[5], sys.argv[6]
json.dump({"commit": commit, "host": host, "gpu": gpu, "pages_out": n, "infer_secs": secs,
           "secs_per_page": round(secs / n, 2) if n else None}, open(f"{w}/box.json", "w"), indent=1)
EOF
  log "collect: $n page texts -> out/ ; $(cat "$W/box.json" | tr -d '\n ')"
}

case ${1:-} in
  setup) setup ;; fetch) fetch ;; infer) infer ;; collect) collect ;;
  all) setup; fetch; infer; collect; touch "$W/DONE"; log DONE ;;
  *) echo "usage: $0 setup|fetch|infer|collect|all"; exit 1 ;;
esac
