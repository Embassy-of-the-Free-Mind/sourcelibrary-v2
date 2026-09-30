#!/bin/bash
# PRIOR ART: box-syriac.sh (round 1) — same one-wrapper discipline. #5250 ROUND 2 on sl-mitra-1, as ONE job under
# `idle-poweroff.sh run --` (the box's only poweroff path): the Yigdzin arms first, then — after vLLM has exited and
# freed the L4 — the Kraken Syriac arms on the GPU (round 1's device, so `none` must reproduce round 1). Kraken beside
# vLLM OOMs silently (rc 0, zero characters), hence strictly sequential. Then 25 min for the Hetzner pull.
cd /root/pp5250r2
export VLLM_USE_FLASHINFER_SAMPLER=0 OCR_VLLM_IMAGE_TOKEN_POSITIONS=sequential
/root/venv/bin/python code/pp_worker.py --todo tibetan/manifest.jsonl --out /root/pp5250r2/out --img-root /root/pp5250r2/tibetan/img \
  --model /root/yig/model --batch 128 --stop-file /root/pp5250r2/STOP >> /root/pp5250r2/worker.log 2>&1
echo "exit=$? $(date -u +%FT%TZ)" > /root/pp5250r2/tib.exit
export W=/root/pp5250r2 S=/root/pp5250r2/syriac K=/root/kvenv/bin/kraken MODEL=/root/pp5250/models/sophro-mhiro.mlmodel \
  ARMS="none unsharp gamma08 gamma12 flatten gray denoise" DARK_ARMS=sauvola CROPS=0 KOPTS="-d cuda:0"
bash code/syriac-run.sh run ${P:-3} > /root/pp5250r2/syriac/run.out 2>&1
echo "exit=$? $(date -u +%FT%TZ)" > /root/pp5250r2/syr.exit
sleep 1500
