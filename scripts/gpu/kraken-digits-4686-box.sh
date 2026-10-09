#!/bin/bash
# The on-box half of kraken-digits-4686-scw.sh (#4686): run under `idle-poweroff.sh run --`, so the box powers
# itself off (provider API) when this exits. Reads /root/pz/code/manifest.tsv (book \t page \t image url).
#   1. GLM-OCR over the manifest (glm-english-run.py, the #5660 r3 / PR #5816 client, unchanged) — vLLM already up.
#   2. Kraken 7.1 CATMuS-Print on the GPU over the same pages (archived master, `segment -bl ocr`), 2 processes.
#   3. Writes /root/pz/run.end, then waits (≤ 30 min) for the Hetzner driver to pull and touch /root/pz/pulled.
set -u
cd /root/pz
mkdir -p out kr img
( CLIENTS=${CLIENTS:-12} /root/pz/vl/bin/python code/glm-english-run.py code/manifest.tsv /root/pz/out http://127.0.0.1:8200/v1 m ${MAX_TOKENS:-8192} > glm.out 2>&1; echo END > glm.end ) &
G=$!
# images for Kraken (the GLM client fetches its own, downscaled)
/root/pz/vl/bin/python - <<'PY'
import os, urllib.request, concurrent.futures as cf
rows = [l.rstrip('\n').split('\t') for l in open('/root/pz/code/manifest.tsv') if l.strip()]
def get(r):
    b, p, u = r; dst = f'/root/pz/img/{b}_{p}.jpg'
    if os.path.exists(dst): return
    for i in range(4):
        try:
            d = urllib.request.urlopen(urllib.request.Request(u, headers={'User-Agent': 'SourceLibrary-kraken-digits/1 (#4686)'}), timeout=60).read()
            open(dst + '.tmp', 'wb').write(d); os.replace(dst + '.tmp', dst); return
        except Exception as e: err = e
    open(dst + '.err', 'w').write(str(err))
with cf.ThreadPoolExecutor(16) as ex: list(ex.map(get, rows))
PY
ls img/*.jpg | sort > kr/all.txt
split -n l/2 -d kr/all.txt kr/part.
t0=$(date +%s); kp=()
for part in kr/part.00 kr/part.01; do
  ( args=(); while read -r f; do b=$(basename "$f" .jpg); [ -s "kr/$b.txt" ] || args+=(-i "$f" "kr/$b.txt"); done < "$part"
    [ ${#args[@]} -gt 0 ] && /root/pz/kr/bin/kraken -d cuda:0 "${args[@]}" segment -bl ocr -m /root/pz/code/catmus-print-fondue-large.mlmodel > "$part.log" 2>&1
    echo "rc=$?" >> "$part.log" ) &
  kp+=($!)
done
wait "${kp[@]}"
# second pass, one page per call, for any page a batch lost
while read -r f; do b=$(basename "$f" .jpg); [ -s "kr/$b.txt" ] || /root/pz/kr/bin/kraken -d cuda:0 -i "$f" "kr/$b.txt" segment -bl ocr -m /root/pz/code/catmus-print-fondue-large.mlmodel >> kr/retry.log 2>&1; done < kr/all.txt
echo "kraken wall $(( $(date +%s) - t0 ))s" > kr/timing.txt
wait $G
echo END > run.end
for i in $(seq 1 180); do [ -f pulled ] && break; sleep 10; done
