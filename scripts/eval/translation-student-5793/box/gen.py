# PRIOR ART: /root/olmocr-5660b/code/olm-run.py (#5660, vLLM on a RunPod pod, timings per page) — an OCR client of a
# vLLM server over images; this is offline text generation with an optional LoRA, the #5793 prompt, and the timing
# fields the $/1,000-pages figure needs.
"""Translate a JSONL of Latin pages with vLLM (offline), temperature 0, the #5793 prompt.

  python gen.py --model Qwen/Qwen3-8B --input dev.jsonl --out out.jsonl [--lora /path/adapter] [--max-model-len 16384]
Input rows: {id|book_id+page_number, source}. Output rows: {id, text, prompt_tokens, completion_tokens, finish}.
A timing record goes to <out>.timing.json: wall seconds of generate() only (model load excluded), tokens, tok/s.
"""
import argparse, json, time, os

PROMPT = ('Translate this page of a historical Latin book into English. Translate all of it, faithfully, '
          'in plain modern English. Do not add notes, glosses or commentary.\n\n')

ap = argparse.ArgumentParser()
ap.add_argument('--model', required=True)
ap.add_argument('--input', required=True)
ap.add_argument('--out', required=True)
ap.add_argument('--lora')
ap.add_argument('--max-model-len', type=int, default=16384)
ap.add_argument('--gpu-mem', type=float, default=0.90)
ap.add_argument('--quant')
ap.add_argument('--repeat', type=int, default=1, help='repeat the input N times (throughput runs)')
a = ap.parse_args()

from vllm import LLM, SamplingParams
from vllm.lora.request import LoRARequest
from transformers import AutoTokenizer

tok = AutoTokenizer.from_pretrained(a.model)
rows = [json.loads(l) for l in open(a.input) if l.strip()]
for r in rows:
    r.setdefault('id', f"{r.get('book_id')}_{r.get('page_number')}")


def prompt_of(src):
    return tok.apply_chat_template([{'role': 'user', 'content': PROMPT + src}], tokenize=False,
                                   add_generation_prompt=True, enable_thinking=False)


prompts, params = [], []
for r in rows * a.repeat:
    p = prompt_of(r['source'])
    n = len(tok(p).input_ids)
    mt = max(256, min(a.max_model_len - n - 8, int(n * 2.5) + 256))  # caps a temperature-0 loop
    prompts.append(p)
    params.append(SamplingParams(temperature=0, max_tokens=mt))

kw = dict(model=a.model, max_model_len=a.max_model_len, gpu_memory_utilization=a.gpu_mem, seed=5793)
if a.lora:
    kw.update(enable_lora=True, max_lora_rank=64, max_loras=1)
if a.quant:
    kw['quantization'] = a.quant
llm = LLM(**kw)
lr = LoRARequest('student', 1, a.lora) if a.lora else None
t0 = time.time()
outs = llm.generate(prompts, params, lora_request=lr)
wall = time.time() - t0
pt = ct = 0
with open(a.out, 'w') as f:
    for i, o in enumerate(outs[:len(rows)]):
        c = o.outputs[0]
        f.write(json.dumps({'id': rows[i]['id'], 'text': c.text, 'prompt_tokens': len(o.prompt_token_ids),
                            'completion_tokens': len(c.token_ids), 'finish': c.finish_reason}, ensure_ascii=False) + '\n')
for o in outs:
    pt += len(o.prompt_token_ids); ct += len(o.outputs[0].token_ids)
timing = {'model': a.model, 'lora': bool(a.lora), 'quant': a.quant, 'pages': len(outs), 'wall_s': round(wall, 1),
          'prompt_tokens': pt, 'completion_tokens': ct, 'out_tok_per_s': round(ct / wall, 1),
          'pages_per_hour': round(len(outs) / wall * 3600, 1), 'max_model_len': a.max_model_len,
          'gpu': os.popen('nvidia-smi --query-gpu=name --format=csv,noheader').read().strip()}
json.dump(timing, open(a.out + '.timing.json', 'w'), indent=1)
print(json.dumps(timing))
