#!/usr/bin/env python3
"""chandra-arm.py — Chandra OCR 2 over the #7243 pages through the vendor client (arm C), against a vLLM server.

PRIOR ART: scripts/gpu/engine-wave1-run.py (#6011 wave 2: chandra.model.vllm.generate_vllm with prompt_type 'ocr',
the vendor's own prompt, scale_to_fit and repeat-token retry; copied). That one wrote a .txt per page on a rented pod.
  VLLM_API_BASE=http://127.0.0.1:8010/v1 VLLM_MODEL_NAME=m chandra-arm.py <img dir> <out.jsonl> [--workers 8]
"""
import json, os, sys, time, threading
from PIL import Image
from chandra.model.schema import BatchInputItem
from chandra.model.vllm import generate_vllm
from chandra.output import parse_markdown
imgs, out = sys.argv[1], sys.argv[2]; W = int(sys.argv[sys.argv.index('--workers') + 1]) if '--workers' in sys.argv else 8
names = sorted(f for f in os.listdir(imgs) if f.endswith('.jpg')); q = list(names); lock = threading.Lock(); sink = open(out, 'w')
def run():
    while True:
        with lock:
            if not q: return
            n = q.pop(0)
        s = time.time(); rec = {'page_id': n[:-4]}
        try:
            res = generate_vllm([BatchInputItem(image=Image.open(os.path.join(imgs, n)).convert('RGB'), prompt_type='ocr')], max_workers=1)[0]
            raw = getattr(res, 'raw', '') or ''
            rec.update(text=parse_markdown(raw, include_headers_footers=True, include_images=False), secs=round(time.time() - s, 2), out_tok=getattr(res, 'token_count', None))
            if getattr(res, 'error', None): rec['error'] = 'vllm error'
        except Exception as e:  # noqa: BLE001
            rec['error'] = str(e)[:300]
        with lock: sink.write(json.dumps(rec, ensure_ascii=False) + '\n'); sink.flush()
t0 = time.time(); ths = [threading.Thread(target=run) for _ in range(W)]
[t.start() for t in ths]; [t.join() for t in ths]; wall = time.time() - t0
json.dump({'pages': len(names), 'wall_secs': round(wall, 1), 'pages_per_hour': round(len(names) / wall * 3600), 'workers': W}, open(out + '.run.json', 'w'))
