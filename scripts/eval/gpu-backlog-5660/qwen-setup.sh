#!/bin/bash
# install vLLM (latest) in its own venv and serve the open model; logs to /root/qw/
set -u; mkdir -p /root/qw; cd /root/qw
MODEL=${MODEL:-Qwen/Qwen3-VL-8B-Instruct}
t0=$(date +%s)
[ -x /root/qw/venv/bin/vllm ] || { python3 -m venv /root/qw/venv && /root/qw/venv/bin/pip install -q --upgrade pip && /root/qw/venv/bin/pip install -q vllm > /root/qw/pip.log 2>&1; }
echo "install $(( $(date +%s) - t0 )) s; vllm $(/root/qw/venv/bin/python -c 'import vllm;print(vllm.__version__)' 2>&1 | tail -1)" > /root/qw/setup.txt
nohup /root/qw/venv/bin/vllm serve "$MODEL" --port 8000 --max-model-len 16384 --gpu-memory-utilization ${GMU:-0.45} --limit-mm-per-prompt '{"image":1}' > /root/qw/serve.log 2>&1 &
for i in $(seq 1 180); do curl -sf http://127.0.0.1:8000/v1/models >/dev/null && break; sleep 5; done
curl -sf http://127.0.0.1:8000/v1/models >/dev/null && echo "served after $(( $(date +%s) - t0 )) s" >> /root/qw/setup.txt || { echo "SERVE FAILED" >> /root/qw/setup.txt; tail -30 /root/qw/serve.log >> /root/qw/setup.txt; }
