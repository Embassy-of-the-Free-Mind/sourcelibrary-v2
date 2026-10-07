#!/bin/bash
# Pod setup for #5793 (runpod/pytorch:1.1.0-cu1281-torch280-ubuntu2404: torch 2.8.0, Python 3.12).
# vLLM 0.10.2 / transformers 4.57.6 are the #5660 pins that ran on this image (H100 and RTX PRO 4000 Blackwell).
set -eux
cd /root/st
export HF_HUB_ENABLE_HF_TRANSFER=1
pip install --break-system-packages -q "vllm==0.10.2" "transformers==4.57.6" "trl==0.24.0" "peft==0.17.1" datasets accelerate hf_transfer > pip.log 2>&1
# flash-attn: a prebuilt wheel only (no compile); without it train.py falls back to sdpa (no padding-free)
timeout 300 pip install --break-system-packages -q --no-build-isolation "flash-attn==2.8.3" > fa.log 2>&1 && echo FA_OK > fa.status || echo FA_FAIL > fa.status
python -c "import vllm, trl, peft, transformers, torch; print(vllm.__version__, trl.__version__, peft.__version__, transformers.__version__, torch.__version__)" > versions.txt
echo SETUP_DONE > setup.status
