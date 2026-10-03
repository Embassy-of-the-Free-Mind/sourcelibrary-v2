#!/bin/bash
# PRIOR ART: hetzner:/mnt/HC_Volume_105839809/greek-ms-align-5619/kraken/run.sh (the #5619 pilot's
# 10-page runner) — same model, flags and caps; it read a fixed sample.json, this reads every page of
# the five manuscripts that locate in a public-domain print we hold, with a per-page checkpoint.
#
# #5619 full fit: Kraken greek-cllg (CPU, non-generative) over every page image of
#   Grec 1841, Marcianus gr. 299, the Cambridge Psellos, the Laurenziana Ars sacra, Grec 1839.
# Reads Mongo for image URLs only; writes only under $W. At most 3 Kraken processes, nice -n 10.
#   bash scripts/eval/greek-ms-kraken-5619.sh            # (re)start; finished pages are skipped
# PAGE_TIMEOUT (s, default 4 h): a starved spread at nice 10 on a load-25 box took > 45 min.
# Per page: <book>-<page>.txt (Kraken text) + <book>-<page>.ok (checkpoint) or .err (failed).
set -u
REPO=$(cd "$(dirname "$0")/../.." && pwd)
W=${W:-/mnt/HC_Volume_105839809/greek-ms-align-5619/kraken-full}
K=/root/bench2-kraken/venv/bin/kraken; M=/root/bench2-kraken/models/greek-cllg.safetensors
BOOKS=${BOOKS:-69a5e5e985fa13e734e41cba,6a45298cc6d95bc278fbc8c3,69938921ce15387065946912,69b4c04d978ca9526eda33f7,69a5e5e385fa13e734e41894}
export OMP_NUM_THREADS=2 MKL_NUM_THREADS=2 W K M PAGE_TIMEOUT
mkdir -p "$W"
cd "$REPO" && node --env-file=/root/sourcelibrary/.env.production.local -e '
const { withMongo } = await import("./scripts/lib/mongo.mjs");
const fs = await import("node:fs");
await withMongo(async (db) => {
  const out = [];
  for (const id of process.argv[1].split(",")) {
    const ps = await db.collection("pages").find({ book_id: id, page_number: { $gte: 0 } }, { projection: { _id: 0, page_number: 1, photo: 1, archived_photo: 1 } }).sort({ page_number: 1 }).toArray();
    for (const p of ps) if (p.archived_photo || p.photo) out.push(`${id}-${p.page_number} ${p.archived_photo || p.photo}`);
  }
  fs.writeFileSync(process.env.W + "/queue.txt", out.join("\n") + "\n");
});' "$BOOKS" 2>&1 | grep -v '^\[' || true
echo "queue: $(wc -l < "$W/queue.txt") pages"

one() {
  slug=$1; url=$2
  [ -e "$W/$slug.ok" ] && return 0
  [ -s "$W/$slug.jpg" ] || curl -sf --retry 3 -o "$W/$slug.jpg" "$url" || { echo "download $url" > "$W/$slug.err"; return 0; }
  if timeout ${PAGE_TIMEOUT:-14400} nice -n 10 "$K" -i "$W/$slug.jpg" "$W/$slug.txt" segment -bl ocr -m "$M" >> "$W/kraken.log" 2>&1; then
    rm -f "$W/$slug.err"; date -u +%FT%TZ > "$W/$slug.ok"
  else echo "kraken exit $?" > "$W/$slug.err"; fi
}
export -f one
xargs -P 3 -L 1 bash -c 'one "$0" "$1"' < "$W/queue.txt"
echo DONE > "$W/done.flag"
