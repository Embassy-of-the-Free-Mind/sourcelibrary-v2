# Open-model arm for the #5660 engine comparison: any vLLM OpenAI-compatible VLM over a bench manifest.
# usage: qwen-arm.py <manifest.tsv> <out root> <model> [clients]
import base64, json, os, sys, time, concurrent.futures as cf, urllib.request
M, R, MODEL = sys.argv[1:4]; C = int(sys.argv[4]) if len(sys.argv) > 4 else 8
PROMPT = ('This is a page of a classical Chinese book (a manuscript copy). Transcribe ALL the Chinese text on the page exactly as written, '
          'reading the vertical columns from right to left, each column top to bottom. Keep the original characters (traditional forms, variants); '
          'do not add punctuation, do not translate, do not comment. Output only the transcription, one line per column.')
rows = [l.rstrip('\n').split('\t') for l in open(M) if l.strip()]
base = os.path.dirname(M)
def img(src):
    if src.startswith('http'):
        req = urllib.request.Request(src, headers={'User-Agent': 'sourcelibrary-eval/5660'})
        with urllib.request.urlopen(req, timeout=60) as r: return r.read()
    return open(os.path.join(base, src) if not os.path.isabs(src) else src, 'rb').read()
def one(row):
    bid, pn, src = row
    o = os.path.join(R, 'out', bid, f'{pn}.txt')
    if os.path.exists(o): return None
    t0 = time.time()
    try:
        b64 = base64.b64encode(img(src)).decode()
        body = {'model': MODEL, 'temperature': 0, 'max_tokens': 3000, 'messages': [{'role': 'user', 'content': [
            {'type': 'image_url', 'image_url': {'url': f'data:image/jpeg;base64,{b64}'}}, {'type': 'text', 'text': PROMPT}]}]}
        req = urllib.request.Request('http://127.0.0.1:8000/v1/chat/completions', data=json.dumps(body).encode(), headers={'Content-Type': 'application/json'})
        with urllib.request.urlopen(req, timeout=300) as r: d = json.load(r)
        text = d['choices'][0]['message']['content'] or ''
        os.makedirs(os.path.dirname(o), exist_ok=True)
        open(o + '.part', 'w').write(text); os.replace(o + '.part', o)
        return {'bid': bid, 'pn': pn, 'secs': round(time.time() - t0, 2), 'out_tokens': d.get('usage', {}).get('completion_tokens'), 'finish': d['choices'][0].get('finish_reason')}
    except Exception as e:
        return {'bid': bid, 'pn': pn, 'error': str(e)[:200]}
os.makedirs(R, exist_ok=True)
t0 = time.time(); log = open(os.path.join(R, 'timings.jsonl'), 'a')
with cf.ThreadPoolExecutor(C) as ex:
    for r in ex.map(one, rows):
        if r: log.write(json.dumps(r) + '\n'); log.flush()
wall = time.time() - t0
json.dump({'model': MODEL, 'clients': C, 'rows': len(rows), 'wall_secs': round(wall, 1)}, open(os.path.join(R, 'arm-run.json'), 'w'))
print('done', len(rows), 'rows in', round(wall, 1), 's')
