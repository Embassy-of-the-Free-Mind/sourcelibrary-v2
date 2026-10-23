#!/usr/bin/env python3
# PRIOR ART: scripts/gpu/gex45-bench-6871/vlm-bench.py (threaded OpenAI-API client, per-item timing) — that one sends
# images for OCR with one fixed prompt; this sends the stored production translation prompt per page and keeps the text.
#
# #6101 Qwen translation eval: send each request in REQS (jsonl: {key, prompt}) to a local vLLM server, thinking off,
# and write {key, text, finish, prompt_tokens, completion_tokens, secs} to OUT (resumable: keys already in OUT are skipped).
#   client.py REQS OUT --concurrency 16 --max-model-len 12288 [--seed 6101]
import json, sys, time, threading, urllib.request, argparse, os
from concurrent.futures import ThreadPoolExecutor

ap = argparse.ArgumentParser()
ap.add_argument('reqs'); ap.add_argument('out')
ap.add_argument('--concurrency', type=int, default=16)
ap.add_argument('--max-model-len', type=int, default=12288)
ap.add_argument('--max-tokens', type=int, default=6144)
ap.add_argument('--seed', type=int, default=6101)
ap.add_argument('--url', default='http://127.0.0.1:8000')
a = ap.parse_args()

def post(path, body, timeout=3600):
    r = urllib.request.Request(a.url + path, data=json.dumps(body).encode(), headers={'Content-Type': 'application/json'})
    with urllib.request.urlopen(r, timeout=timeout) as f: return json.load(f)

done = set()
if os.path.exists(a.out):
    for l in open(a.out): done.add(json.loads(l)['key'])
reqs = [json.loads(l) for l in open(a.reqs)]
todo = [r for r in reqs if r['key'] not in done]
lock = threading.Lock(); out = open(a.out, 'a')

def one(r):
    msgs = [{'role': 'user', 'content': r['prompt']}]
    n = post('/tokenize', {'model': 'm', 'messages': msgs, 'add_generation_prompt': True,
                           'chat_template_kwargs': {'enable_thinking': False}})['count']
    mt = min(a.max_tokens, a.max_model_len - n - 16)
    t0 = time.time()
    try:
        j = post('/v1/chat/completions', {
            'model': 'm', 'messages': msgs, 'max_tokens': mt, 'seed': a.seed + r.get('rep', 0),
            # Qwen's published non-thinking sampling (model cards: temperature 0.7, top_p 0.8, top_k 20)
            'temperature': 0.7, 'top_p': 0.8, 'top_k': 20,
            'chat_template_kwargs': {'enable_thinking': False}})
        c = j['choices'][0]; u = j['usage']
        rec = {'key': r['key'], 'text': c['message']['content'], 'finish': c['finish_reason'], 'max_tokens': mt,
               'prompt_tokens': u['prompt_tokens'], 'completion_tokens': u['completion_tokens'], 'secs': round(time.time() - t0, 2),
               't_end': time.time()}
    except Exception as e:
        rec = {'key': r['key'], 'error': str(e)[:300], 'prompt_tokens': n, 'secs': round(time.time() - t0, 2), 't_end': time.time()}
    with lock: out.write(json.dumps(rec, ensure_ascii=False) + '\n'); out.flush()
    return rec

t0 = time.time()
with ThreadPoolExecutor(a.concurrency) as ex: recs = list(ex.map(one, todo))
wall = time.time() - t0
ok = [r for r in recs if 'text' in r]
toks = sum(r['completion_tokens'] for r in ok)
print(json.dumps({'reqs': len(todo), 'ok': len(ok), 'errors': len(recs) - len(ok), 'hit_cap': sum(r.get('finish') == 'length' for r in ok),
                  'wall_secs': round(wall, 1), 'out_tok': toks, 'in_tok': sum(r['prompt_tokens'] for r in ok),
                  'out_tok_per_s': round(toks / wall, 1) if wall else None, 'pages_per_hour': round(len(ok) / wall * 3600) if wall else None,
                  'concurrency': a.concurrency}))
