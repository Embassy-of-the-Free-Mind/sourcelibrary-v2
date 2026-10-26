# PRIOR ART: scripts/gpu/gex45-bench-6871/vlm-bench.py (speed card: OCR prompts against a local vLLM server; no
# classification prompt, no JSON parse). Zero-shot page classification against a local OpenAI-compatible vLLM
# server: the same three questions the Opus check set answers, from the image alone. Resumable. Read only.
# Usage: python vlm-classify.py MANIFEST IMGDIR OUT.jsonl [clients]
import sys, json, hashlib, base64, os, time, urllib.request, concurrent.futures as cf
man, imgdir, outp = sys.argv[1:4]; C = int(sys.argv[4]) if len(sys.argv) > 4 else 16
URL = os.environ.get('VLM_URL', 'http://127.0.0.1:8000/v1/chat/completions')
PROMPT = """Classify this page image. Do not transcribe it. Answer with ONE line of JSON only:
{"script": "<ISO 15924 code of the main writing: Latn, Grek, Hebr, Arab, Syrc, Hani, Jpan (kana with or without kanji), Kore, Cyrl, Armn, Geor, Deva, Beng, Tibt, Ethi, Copt, Mong, Thai, other, or none>",
 "kind": "<prose | table | date-dense | music | plate | blank>",
 "leaves": <integer: how many distinct book pages/leaves are photographed in this image; a thin sliver of the next page or a colour chart does not count>}
kind: prose = running text (verse, commentary, columns, footnotes) not dense in numbers; table = a grid or aligned columns read across rows; date-dense = running text or lists with at least ~6 numbers of 2-4 digits (years, dates, page or chapter references); music = musical notation fills much of the page; plate = an illustration, diagram, map or chart fills most of the page; blank = no writing."""
key = lambda u: hashlib.sha1(u.encode()).hexdigest()[:16]
rows = [json.loads(l) for l in open(man)]
done = set()
if os.path.exists(outp):
    for l in open(outp):
        try:
            o = json.loads(l)
            if not o['raw'].startswith('ERROR'): done.add(o['uid'])  # a transport error is retried on the next run
        except Exception: pass
todo = [r for r in rows if r['uid'] not in done and os.path.exists(f"{imgdir}/{key(r['image_url'])}.jpg")]
print('todo', len(todo), 'done', len(done), flush=True)
def one(r):
    b64 = base64.b64encode(open(f"{imgdir}/{key(r['image_url'])}.jpg", 'rb').read()).decode()
    body = {'model': 'm', 'temperature': 0, 'max_tokens': 120, 'messages': [{'role': 'user', 'content': [
        {'type': 'image_url', 'image_url': {'url': f'data:image/jpeg;base64,{b64}'}}, {'type': 'text', 'text': PROMPT}]}]}
    t = time.time()
    for a in range(3):
        try:
            req = urllib.request.Request(URL, json.dumps(body).encode(), {'Content-Type': 'application/json'})
            txt = json.loads(urllib.request.urlopen(req, timeout=300).read())['choices'][0]['message']['content']
            break
        except Exception as e: txt = f'ERROR {e}'; time.sleep(2)
    try: j = json.loads(txt[txt.index('{'): txt.rindex('}') + 1])
    except Exception: j = {}
    return {'uid': r['uid'], 'raw': txt[:400], 'pred': j, 'secs': round(time.time() - t, 2)}
with open(outp, 'a') as f, cf.ThreadPoolExecutor(C) as ex:
    for i, o in enumerate(ex.map(one, todo)):
        f.write(json.dumps(o, ensure_ascii=False) + '\n')
        if i % 200 == 0: f.flush(); print(i, o['secs'], flush=True)
