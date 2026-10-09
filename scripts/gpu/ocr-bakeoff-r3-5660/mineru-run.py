#!/usr/bin/env python3
"""#5660 round 3: MinerU2.5-Pro (vLLM server + mineru-vl-utils http-client, two-step: layout then content) over the
bench manifest, one .txt per page.  mineru-run.py <manifest.tsv> <arm dir> <server url>

two_step_extract is the model card's documented call (image_analysis off). Page text = every block that carries
text content, in the order the client returns them (the model's reading order), joined by newlines; image/chart
blocks without text are skipped. The block list is kept as <slug>.raw (JSON) for by-eye reads.
"""
import json, os, sys, threading, time
from PIL import Image
from mineru_vl_utils import MinerUClient

man, root, url = sys.argv[1], sys.argv[2], sys.argv[3]
CLIENTS = int(os.environ.get('CLIENTS', '8')); BENCH = os.environ.get('BENCH', '/root/pz/bench')
rows = [l.rstrip('\n').split('\t') for l in open(man) if l.strip()]
out = os.path.join(root, 'out', '_bench'); os.makedirs(out, exist_ok=True)
lock = threading.Lock(); q = list(rows); tl = open(os.path.join(root, 'timings.jsonl'), 'a')


def as_dict(b):
    if isinstance(b, dict): return b
    return {k: getattr(b, k, None) for k in ('type', 'bbox', 'angle', 'content')}


def work():
    client = MinerUClient(backend='http-client', server_url=url, image_analysis=False)
    while True:
        with lock:
            if not q: return
            _, pn, src = q.pop(0)
        dst = os.path.join(out, f'{pn}.txt')
        if os.path.exists(dst): continue
        s = time.time()
        try:
            blocks = [as_dict(b) for b in client.two_step_extract(Image.open(os.path.join(BENCH, src)).convert('RGB'))]
            t = '\n'.join(str(b['content']) for b in blocks if b.get('content'))
            open(os.path.join(out, f'{pn}.raw'), 'w').write(json.dumps(blocks, ensure_ascii=False, default=str))
            open(dst, 'w').write(t)
            rec = {'pn': pn, 'secs': round(time.time() - s, 2), 'blocks': len(blocks), 'types': sorted({str(b.get('type')) for b in blocks}), 'chars': len(t)}
        except Exception as e:  # noqa: BLE001
            open(os.path.join(out, f'{pn}.err'), 'w').write(str(e)[:300]); rec = {'pn': pn, 'error': str(e)[:200]}
        with lock: tl.write(json.dumps(rec) + '\n'); tl.flush()


t0 = time.time(); ths = [threading.Thread(target=work) for _ in range(CLIENTS)]
for t in ths: t.start()
for t in ths: t.join()
json.dump({'pages': len(rows), 'wall_secs': round(time.time() - t0, 1), 'clients': CLIENTS, 'mode': 'mineru-two-step'}, open(os.path.join(root, 'arm-run.json'), 'w'))
print(open(os.path.join(root, 'arm-run.json')).read())
