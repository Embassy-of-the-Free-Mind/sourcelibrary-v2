#!/usr/bin/env bash
# run-all.sh — every arm of the GEX45 capability card (#6871) in turn, ON gex45, one lock hold per arm.
# An arm whose lock wait times out (exit 75) is retried after the others; a 60 s gap between holds lets
# the priority job (gpu-screener-6742) or Earthlove take the lock between arms.
#   nohup run-all.sh [arm ...] > run-all.out 2>&1 &
J=${J:-/root/jobs/gpu-bench-6871}
ARMS=${*:-paddle-vl glm-ocr mineru25-pro dots-ocr qwen25vl7b-awq olmocr2-fp8 qwen3-8b-awq qwen3-14b-awq bge-m3 qwen3-emb-0.6b qwen3-emb-4b siglip2-base siglip2-so400m clip-b32}
for round in $(seq 1 30); do
  left=()
  for a in $ARMS; do
    [ -e "$J/arms/$a${ARM_TAG:-}/DONE" ] && continue
    bash "$J/code/card.sh" "$a"; rc=$?
    if [ $rc = 75 ]; then left+=("$a"); continue; fi
    touch "$J/arms/$a${ARM_TAG:-}/DONE"; sleep 60
  done
  [ ${#left[@]} = 0 ] && break
  ARMS="${left[*]}"
done
echo "RUN-ALL-END $(date -u +%FT%TZ)" >> "$J/card.log"
