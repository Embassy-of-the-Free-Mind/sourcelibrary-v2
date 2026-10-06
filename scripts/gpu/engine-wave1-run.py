#!/usr/bin/env python3
# PRIOR ART: scripts/gpu/paddle-vl-run.py — the same output-file-is-the-checkpoint contract
# (<out>/<engine>/<stratum>/<slug>.txt + a timings jsonl), but it drives the PaddleOCR pipeline in
# process; these three engines are served by vLLM and read over its OpenAI-compatible API.
"""engine-wave1-run.py — read every bench image with one vLLM-served engine (#6011 wave 1).

  python engine-wave1-run.py --engine deepseek-ocr|qwen3-vl-8b|chandra-ocr-2 --bench /root/ew1/bench --out /root/ew1/out

A page whose .txt exists is never re-read. Every call is timed into <out>/<engine>/_meter.jsonl.
Prompts are the preregistered ones (PREREGISTRATION-engine-wave1-6011.md).
"""
import argparse, base64, json, os, sys, time
from concurrent.futures import ThreadPoolExecutor

import requests

GENERIC = ('Transcribe ALL text visible in this image using the appropriate Unicode script. '
           'Output ONLY the raw text. No commentary, no translation, no labels, no markdown.')
API = 'http://127.0.0.1:8000/v1/chat/completions'

ap = argparse.ArgumentParser()
ap.add_argument('--engine', required=True)
ap.add_argument('--bench', required=True)
ap.add_argument('--out', required=True)
ap.add_argument('--workers', type=int, default=16)
ap.add_argument('--timeout', type=int, default=600)
a = ap.parse_args()

pages = []
for stratum in sorted(os.listdir(a.bench)):
    d = os.path.join(a.bench, stratum)
    if not os.path.isdir(d) or stratum.startswith('_'):
        continue
    for f in sorted(os.listdir(d)):
        if f.endswith('.jpg'):
            pages.append((stratum, f[:-4], os.path.join(d, f)))
outdir = os.path.join(a.out, a.engine)
meter = os.path.join(outdir, '_meter.jsonl')
todo = [p for p in pages if not os.path.exists(os.path.join(outdir, p[0], p[1] + '.txt'))]
print(f'{a.engine}: {len(todo)} of {len(pages)} pages to read', flush=True)


def b64(path):
    with open(path, 'rb') as fh:
        return base64.b64encode(fh.read()).decode()


def chat(content, **extra):
    body = {'model': 'm', 'messages': [{'role': 'user', 'content': content}], 'temperature': 0.0, 'max_tokens': 8192, **extra}
    r = requests.post(API, json=body, timeout=a.timeout)
    r.raise_for_status()
    j = r.json()
    return j['choices'][0]['message']['content'] or '', j['choices'][0].get('finish_reason'), j.get('usage', {})


if a.engine == 'chandra-ocr-2':
    os.environ['VLLM_MODEL_NAME'] = 'm'   # read by chandra.settings at import time
    from PIL import Image
    from chandra.model.schema import BatchInputItem
    from chandra.model.vllm import generate_vllm
    from chandra.output import parse_markdown


def read(p):
    stratum, slug, path = p
    t0 = time.time()
    err = None
    text, finish, usage, raw_len = '', None, {}, 0
    try:
        if a.engine == 'deepseek-ocr':
            content = [{'type': 'image_url', 'image_url': {'url': 'data:image/jpeg;base64,' + b64(path)}}, {'type': 'text', 'text': 'Free OCR.'}]
            try:
                text, finish, usage = chat(content, skip_special_tokens=False,
                                           vllm_xargs={'ngram_size': 30, 'window_size': 90, 'whitelist_token_ids': [128821, 128822]})
            except requests.HTTPError as e:   # served without the n-gram processor (fallback): plain request
                if e.response is None or e.response.status_code != 400:
                    raise
                text, finish, usage = chat(content, skip_special_tokens=False)
        elif a.engine == 'qwen3-vl-8b':
            content = [{'type': 'image_url', 'image_url': {'url': 'data:image/jpeg;base64,' + b64(path)}}, {'type': 'text', 'text': GENERIC}]
            text, finish, usage = chat(content)
        elif a.engine == 'chandra-ocr-2':
            # The vendor's own client: its OCR prompt, its scale_to_fit, its repeat-token retry.
            res = generate_vllm([BatchInputItem(image=Image.open(path).convert('RGB'), prompt_type='ocr')], max_workers=1)[0]
            raw_len = len(res.raw or '')
            # Headers/footers kept: the references include running heads where the page prints them.
            text = parse_markdown(res.raw or '', include_headers_footers=True, include_images=False)
            usage = {'completion_tokens': res.token_count}
            err = 'vllm error' if res.error else None
        else:
            raise SystemExit(f'unknown engine {a.engine}')
    except Exception as e:  # noqa: BLE001 — recorded, the page is retried on the next pass
        err = str(e)[:200]
    secs = round(time.time() - t0, 2)
    row = {'stratum': stratum, 'slug': slug, 'engine': a.engine, 'finishReason': finish, 'outputTokens': usage.get('completion_tokens'),
           'inputTokens': usage.get('prompt_tokens'), 'secs': secs, 'chars': len(text), 'raw_chars': raw_len or None, 'error': err,
           'at': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())}
    with open(meter, 'a') as fh:
        fh.write(json.dumps(row) + '\n')
    if err is None:
        os.makedirs(os.path.join(outdir, stratum), exist_ok=True)
        with open(os.path.join(outdir, stratum, slug + '.txt'), 'w') as fh:
            fh.write(text)
    return err is None


os.makedirs(outdir, exist_ok=True)
t0 = time.time()
with ThreadPoolExecutor(max_workers=a.workers) as ex:
    ok = sum(ex.map(read, todo))
wall = round(time.time() - t0, 1)
with open(os.path.join(outdir, '_run.json'), 'a') as fh:
    fh.write(json.dumps({'engine': a.engine, 'pages': len(todo), 'ok': ok, 'wall_secs': wall, 'workers': a.workers}) + '\n')
print(f'{a.engine}: {ok}/{len(todo)} ok in {wall} s', flush=True)
sys.exit(0 if ok == len(todo) else 3)
